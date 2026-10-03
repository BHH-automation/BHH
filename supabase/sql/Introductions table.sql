-- British Heritage Hosts
-- Introductions table: requests for an introduction to a transport or boat partner
-- Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd
-- Written 3 October 2026
--
-- Run this whole file once in the Supabase dashboard, SQL Editor, on project
-- BHH-Database. It adds one new table and changes nothing else.
--
-- Why it exists: BHH never sells transport or boats. It only introduces the
-- guest to a partner. So that an introduction can never join a BHH booking into
-- a linked travel arrangement, the system keeps a full day between the two:
-- an introduction is held until 25 hours after the same guest last paid BHH,
-- and a BHH payment is held until 25 hours after an introduction was sent.
--
-- status: held (waiting for its release time), ready (may be sent now),
--         sent (the Director has sent the introduction), declined.

create table if not exists public.introductions (
  id           uuid primary key default gen_random_uuid(),
  service      text not null check (service in ('Airport Transfer','Chauffeured Hire','Canal Day Cruise','Narrowboat Holiday')),
  name         text not null,
  email        text not null,
  phone        text,
  date_from    date,
  date_to      date,
  party_size   int,
  notes        text,
  lang         text not null default 'en' check (lang in ('en','ar')),
  status       text not null default 'ready' check (status in ('held','ready','sent','declined')),
  release_at   timestamptz not null default now(),
  held_because text,
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists introductions_email_idx on public.introductions (email, created_at desc);
create index if not exists introductions_sent_idx on public.introductions (sent_at desc);

alter table public.introductions enable row level security;
revoke all on public.introductions from anon, authenticated;
