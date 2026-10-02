-- British Heritage Hosts
-- Payments tables: proposals, paid bookings, refunds and booking rules
-- Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd
-- Written 2 October 2026
--
-- Run this whole file once in the Supabase dashboard, SQL Editor, on project
-- BHH-Database (pwqdzitsezblncmewxsf). The SQL Editor runs a paste as one
-- transaction, so if any statement fails nothing is applied.
--
-- Nothing here changes an existing table. Every new table is closed to the
-- public key. Only the payments Edge Function, which holds the service role
-- key on the server, can read or write them.


-- ---------------------------------------------------------------------------
-- 1. Proposals: one priced visit for one family
-- ---------------------------------------------------------------------------
-- items holds the experiences in the proposal, one entry each:
--   { "service": "English Tea", "date": "2027-05-14", "adults": 2,
--     "children": 2, "price_pence": 45000, "note": "" }
-- Only the six services British Heritage Hosts sells may appear here. The
-- Edge Function refuses anything else, as clause 12 of the Terms requires.
--
-- status runs:
--   sent              proposal sent, waiting for the guest to pay
--   paid              paid in full, booking confirmed (clause 2)
--   cancel_requested  the guest asked to cancel, waiting for the Director
--   refunded          cancelled and the refund has been sent
--   cancelled         cancelled with no refund due
--   withdrawn         the Director withdrew an unpaid proposal

create table if not exists public.proposals (
  id                    uuid primary key default gen_random_uuid(),
  reference             text unique not null,
  access_key            text not null,
  guest_name            text not null,
  guest_email           text not null,
  guest_phone           text,
  guest_phone_digits    text,
  nationality           text,
  preferred_area        text,
  items                 jsonb not null default '[]'::jsonb,
  total_pence           integer not null check (total_pence > 0),
  currency              text not null default 'gbp',
  first_date            date,
  last_date             date,
  status                text not null default 'sent'
                        check (status in ('sent','paid','cancel_requested','refunded','cancelled','withdrawn')),
  stripe_session_id     text,
  stripe_payment_intent text,
  paid_at               timestamptz,
  cancel_requested_at   timestamptz,
  cancelled_by          text check (cancelled_by in ('guest','bhh')),
  refund_due_pence      integer,
  refund_pence          integer,
  stripe_refund_id      text,
  refunded_at           timestamptz,
  director_note         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists proposals_email_idx  on public.proposals (lower(guest_email));
create index if not exists proposals_phone_idx  on public.proposals (guest_phone_digits);
create index if not exists proposals_status_idx on public.proposals (status, first_date);

create or replace function public.proposals_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.guest_phone_digits := regexp_replace(coalesce(new.guest_phone, ''), '[^0-9]', '', 'g');
  return new;
end;
$$;

drop trigger if exists trg_proposals_touch on public.proposals;
create trigger trg_proposals_touch
  before insert or update on public.proposals
  for each row execute function public.proposals_touch();


-- ---------------------------------------------------------------------------
-- 2. Booking rules the Director can change from his own page
-- ---------------------------------------------------------------------------
-- min_lead_days: how many days ahead a family must ask for, so there is time
-- to arrange the host or guide. Starts at 7 and is changed on the Director page.

create table if not exists public.booking_settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

insert into public.booking_settings (key, value)
values ('min_lead_days', '7')
on conflict (key) do nothing;

-- Dates on which no experience can be arranged. The enquiry form will not
-- accept them.
create table if not exists public.unavailable_dates (
  day         date primary key,
  note        text,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 3. The Director's own sign in, a code sent to the company inbox only
-- ---------------------------------------------------------------------------
create table if not exists public.director_logins (
  id          uuid primary key default gen_random_uuid(),
  code        text        not null,
  expires_at  timestamptz not null,
  used        boolean     not null default false,
  attempts    smallint    not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.director_sessions (
  token       text primary key,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 4. A record of every payment event Stripe tells us about
-- ---------------------------------------------------------------------------
-- Stripe can send the same event twice. Keeping its id here means we act on
-- each event once only.
create table if not exists public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 5. Lock every new table away from the public
-- ---------------------------------------------------------------------------
alter table public.proposals         enable row level security;
alter table public.booking_settings  enable row level security;
alter table public.unavailable_dates enable row level security;
alter table public.director_logins   enable row level security;
alter table public.director_sessions enable row level security;
alter table public.stripe_events     enable row level security;

revoke all on public.proposals         from anon, authenticated;
revoke all on public.booking_settings  from anon, authenticated;
revoke all on public.unavailable_dates from anon, authenticated;
revoke all on public.director_logins   from anon, authenticated;
revoke all on public.director_sessions from anon, authenticated;
revoke all on public.stripe_events     from anon, authenticated;
