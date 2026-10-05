-- British Heritage Hosts
-- Fast requests: partners and the requests sent to them for a quick yes or no
-- Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd
-- Written 5 October 2026
--
-- Run this whole file once in the Supabase dashboard, SQL Editor, on project
-- BHH-Database. It adds three new tables and changes nothing else.
--
-- How it works: when a guest asks for any BHH service, every active partner
-- for that service (host, guide, interpreter, transport or boat company) gets
-- an email (and a WhatsApp message once that is set up) with Accept and
-- Decline buttons. The first
-- partner to accept takes the job, the guest is told at once, and the Director
-- is asked to send the booking and payment link.

create table if not exists public.partners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  services    text[] not null default '{}',
  email       text,
  whatsapp    text,
  active      boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.dispatches (
  id            uuid primary key default gen_random_uuid(),
  service       text not null,
  guest_name    text not null,
  guest_email   text not null,
  guest_phone   text,
  day           date,
  day_to        date,
  party_size    int,
  details       text,
  lang          text not null default 'en' check (lang in ('en','ar')),
  status        text not null default 'open' check (status in ('open','accepted','declined','cancelled')),
  accepted_by   uuid references public.partners(id),
  accepted_at   timestamptz,
  price_pence   int,
  partner_note  text,
  created_at    timestamptz not null default now()
);

create table if not exists public.dispatch_offers (
  id           uuid primary key default gen_random_uuid(),
  dispatch_id  uuid not null references public.dispatches(id) on delete cascade,
  partner_id   uuid not null references public.partners(id),
  key          text not null,
  answer       text not null default 'pending' check (answer in ('pending','accepted','declined','late')),
  answered_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists dispatches_created_idx on public.dispatches (created_at desc);
create index if not exists dispatch_offers_dispatch_idx on public.dispatch_offers (dispatch_id);

alter table public.partners enable row level security;
alter table public.dispatches enable row level security;
alter table public.dispatch_offers enable row level security;
revoke all on public.partners from anon, authenticated;
revoke all on public.dispatches from anon, authenticated;
revoke all on public.dispatch_offers from anon, authenticated;
