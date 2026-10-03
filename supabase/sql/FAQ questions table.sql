-- British Heritage Hosts
-- FAQ questions table: questions visitors send from the FAQ page
-- Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd
-- Written 3 October 2026
--
-- Run this whole file once in the Supabase dashboard, SQL Editor, on project
-- BHH-Database. It adds one new table and changes nothing else.
-- status: new (not yet answered), answered, hidden (removed from the list).

create table if not exists public.faq_questions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  question    text not null,
  lang        text not null default 'en' check (lang in ('en','ar')),
  status      text not null default 'new' check (status in ('new','answered','hidden')),
  created_at  timestamptz not null default now()
);

create index if not exists faq_questions_email_idx on public.faq_questions (email, created_at desc);

alter table public.faq_questions enable row level security;
revoke all on public.faq_questions from anon, authenticated;
