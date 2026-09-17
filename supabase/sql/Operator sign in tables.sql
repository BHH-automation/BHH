-- British Heritage Hosts
-- Operator sign in tables, phase 1 of the app
-- Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd
-- Written 18 September 2026
--
-- Run this whole file once in the Supabase dashboard, SQL Editor, on project
-- BHH-Database (pwqdzitsezblncmewxsf). The SQL Editor runs a paste as one
-- transaction, so if any statement fails nothing is applied.
--
-- These two tables let a person who works for us sign in on their phone with
-- their mobile number and a 6 digit code, the same pattern the venue handover
-- already uses. Nothing here touches the existing tables.


-- ---------------------------------------------------------------------------
-- 1. The codes we text to a person who is signing in
-- ---------------------------------------------------------------------------
create table if not exists public.operator_logins (
  id          uuid primary key default gen_random_uuid(),
  mobile      text        not null,
  code        text        not null,
  expires_at  timestamptz not null,
  used        boolean     not null default false,
  attempts    smallint    not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists operator_logins_mobile_idx
  on public.operator_logins (mobile, used, expires_at desc);


-- ---------------------------------------------------------------------------
-- 2. The signed in session, kept on the person's own phone
-- ---------------------------------------------------------------------------
-- role says which kind of person this is, so the same table can later carry
-- hosts, scouts, guides, drivers and interpreters, not only cooks.

create table if not exists public.operator_sessions (
  token       text primary key,
  person_id   uuid        not null,
  role        text        not null,
  mobile      text        not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);

create index if not exists operator_sessions_person_idx
  on public.operator_sessions (person_id, expires_at desc);


-- ---------------------------------------------------------------------------
-- 3. Lock both tables away from the public
-- ---------------------------------------------------------------------------
-- Row Level Security on with no policies means nobody reaches these tables
-- through the public key. Only the service role, which lives inside the Edge
-- Function and never leaves the server, can read or write them.

alter table public.operator_logins   enable row level security;
alter table public.operator_sessions enable row level security;

revoke all on public.operator_logins   from anon, authenticated;
revoke all on public.operator_sessions from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. Housekeeping, removes codes and sessions that have run out
-- ---------------------------------------------------------------------------
create or replace function public.purge_operator_expired()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.operator_logins   where expires_at < now() - interval '1 day';
  delete from public.operator_sessions where expires_at < now() - interval '1 day';
$$;

revoke all on function public.purge_operator_expired() from public;
