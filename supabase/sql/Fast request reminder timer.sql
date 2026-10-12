-- British Heritage Hosts
-- Fast request reminder timer
-- Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd
-- Written 12 October 2026
--
-- Run this whole file once in the Supabase dashboard, SQL Editor, on project
-- BHH-Database. Every 15 minutes it asks the Payments function to email the
-- Director when a partner has not answered a fast request in time
-- (1 hour when the trip is within 2 days, otherwise 4 hours).
-- It changes no table.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('bhh fast request reminders')
where exists (select 1 from cron.job where jobname = 'bhh fast request reminders');

select cron.schedule(
  'bhh fast request reminders',
  '*/15 * * * *',
  $$ select net.http_post(
       url := 'https://pwqdzitsezblncmewxsf.supabase.co/functions/v1/Payments',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{"action": "reminders"}'::jsonb
     ); $$
);
