-- British Heritage Hosts
-- Guest sign in tables, phase 2 of the app
-- Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd
-- Written 20 September 2026
--
-- Run this whole file once in the Supabase dashboard, SQL Editor, on project
-- BHH-Database (pwqdzitsezblncmewxsf). The SQL Editor runs a paste as one
-- transaction, so if any statement fails nothing is applied.
--
-- These tables let a guest open their own booking on their phone. The guest
-- types either the email address or the mobile number held on their booking,
-- we send a 6 digit code to that same route, and they are in. There is no
-- account and no password: the booking itself is the record.
--
-- Nothing here changes any existing table. The operator tables from phase 1
-- are left exactly as they are, because a guest and a cook must never share a
-- session.


-- ---------------------------------------------------------------------------
-- 1. The codes we send to a guest who is signing in
-- ---------------------------------------------------------------------------
-- contact holds the email address in lower case, or the mobile reduced to its
-- digits. channel says which of the two it was, so the code is only ever sent
-- back to the route the guest typed.

create table if not exists public.guest_logins (
  id          uuid primary key default gen_random_uuid(),
  contact     text        not null,
  channel     text        not null check (channel in ('email','mobile')),
  code        text        not null,
  expires_at  timestamptz not null,
  used        boolean     not null default false,
  attempts    smallint    not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists guest_logins_contact_idx
  on public.guest_logins (contact, used, expires_at desc);

-- Used to count how many codes one contact has asked for in the last hour.
create index if not exists guest_logins_created_idx
  on public.guest_logins (contact, created_at desc);


-- ---------------------------------------------------------------------------
-- 2. The signed in session, kept on the guest's own phone
-- ---------------------------------------------------------------------------
-- The session is tied to the contact, not to one booking, so a family with
-- two bookings sees both without signing in twice.

create table if not exists public.guest_sessions (
  token       text primary key,
  contact     text        not null,
  channel     text        not null,
  guest_name  text,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);

create index if not exists guest_sessions_contact_idx
  on public.guest_sessions (contact, expires_at desc);


-- ---------------------------------------------------------------------------
-- 3. Lock both tables away from the public
-- ---------------------------------------------------------------------------
-- Row Level Security on with no policies means nobody reaches these tables
-- through the public key. Only the service role, which lives inside the Edge
-- Function and never leaves the server, can read or write them.

alter table public.guest_logins   enable row level security;
alter table public.guest_sessions enable row level security;

revoke all on public.guest_logins   from anon, authenticated;
revoke all on public.guest_sessions from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. A plain digits column on bookings, so a foreign mobile matches
-- ---------------------------------------------------------------------------
-- A guest may write their number as +966 50 777 1349, 00966507771349 or
-- 0507771349. This column keeps only the digits, so any of those forms can be
-- compared against what the guest types on the sign in page. It fills itself
-- and needs no attention from anyone.

alter table public.bookings
  add column if not exists guest_phone_digits text;

create or replace function public.set_guest_phone_digits()
returns trigger
language plpgsql
as $$
begin
  new.guest_phone_digits := regexp_replace(coalesce(new.guest_phone, ''), '[^0-9]', '', 'g');
  return new;
end;
$$;

drop trigger if exists trg_guest_phone_digits on public.bookings;
create trigger trg_guest_phone_digits
  before insert or update of guest_phone on public.bookings
  for each row execute function public.set_guest_phone_digits();

-- Fill it for the bookings already stored.
update public.bookings
   set guest_phone_digits = regexp_replace(coalesce(guest_phone, ''), '[^0-9]', '', 'g')
 where guest_phone_digits is null;

create index if not exists bookings_guest_phone_digits_idx
  on public.bookings (guest_phone_digits);

create index if not exists bookings_guest_email_idx
  on public.bookings (lower(guest_email));


-- ---------------------------------------------------------------------------
-- 5. Housekeeping, removes codes and sessions that have run out
-- ---------------------------------------------------------------------------
create or replace function public.purge_guest_expired()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.guest_logins   where expires_at < now() - interval '1 day';
  delete from public.guest_sessions where expires_at < now() - interval '1 day';
$$;

revoke all on function public.purge_guest_expired() from public;
