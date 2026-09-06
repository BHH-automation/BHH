-- British Heritage Hosts
-- Handover issued email: when issue_handover() creates a handovers row, call the
-- handover Edge Function action "issue", which emails the cook the link and a QR code.
--
-- Run this whole file once in the Supabase dashboard, SQL Editor, on project
-- BHH-Database (pwqdzitsezblncmewxsf). The SQL Editor runs a paste as one
-- transaction, so if any statement fails nothing is applied.
--
-- Nothing secret is written into this file. The shared secret and the function URL
-- are read at run time from Supabase Vault. Section 1 stores them.


-- ---------------------------------------------------------------------------
-- 1. Store the secret and the function URL in Vault
-- ---------------------------------------------------------------------------
-- The value below must be the SAME string that is saved as the Edge Function
-- secret BHH_WEBHOOK_SECRET (Dashboard, Edge Functions, Secrets). Replace the
-- placeholder before running, then never store it anywhere else.

select vault.create_secret(
  'PASTE THE SAME VALUE AS THE EDGE FUNCTION SECRET BHH WEBHOOK SECRET',
  'bhh_webhook_secret',
  'Shared secret for the handover Edge Function issue action'
);

select vault.create_secret(
  'https://pwqdzitsezblncmewxsf.supabase.co/functions/v1/handover',
  'bhh_handover_function_url',
  'Base URL of the handover Edge Function'
);

-- To change a value later, do not run create_secret again. Run this instead:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'bhh_webhook_secret'),
--     'the new value'
--   );


-- ---------------------------------------------------------------------------
-- 2. Column that records the send, so a retry cannot email the cook twice
-- ---------------------------------------------------------------------------
alter table public.handovers
  add column if not exists issued_email_at timestamptz;


-- ---------------------------------------------------------------------------
-- 3. pg_net, the extension that lets Postgres make an HTTP call
-- ---------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;


-- ---------------------------------------------------------------------------
-- 4. The trigger function
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because vault.decrypted_secrets is readable by the owner only.
-- Every failure is swallowed and reported as a notice: a handover row must never
-- fail to be created because the email could not be posted.

create or replace function public.notify_handover_issued()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'bhh_handover_function_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'bhh_webhook_secret';

  if v_url is null or v_secret is null then
    raise notice 'notify_handover_issued: vault secrets missing, no email posted';
    return new;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-bhh-secret', v_secret
               ),
    body    := jsonb_build_object(
                 'action', 'issue',
                 'handover_id', new.id
               ),
    timeout_milliseconds := 8000
  );

  return new;
exception when others then
  raise notice 'notify_handover_issued failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.notify_handover_issued() from public;


-- ---------------------------------------------------------------------------
-- 5. The trigger itself
-- ---------------------------------------------------------------------------
drop trigger if exists trg_handover_issued_email on public.handovers;

create trigger trg_handover_issued_email
  after insert on public.handovers
  for each row
  execute function public.notify_handover_issued();


-- ---------------------------------------------------------------------------
-- 6. Checking it afterwards
-- ---------------------------------------------------------------------------
-- Every pg_net call and its reply are logged. After setting a test booking to
-- paid, run this in the SQL Editor to see the reply from the Edge Function:
--
--   select id, created, status_code, content
--     from net._http_response
--    order by id desc
--    limit 5;
--
-- A status_code of 200 with content containing "emailed_to" means the cook was
-- emailed. A 401 means the Vault secret and the Edge Function secret do not match.


-- ---------------------------------------------------------------------------
-- 7. Fallback, only if pg_net is not available on the project
-- ---------------------------------------------------------------------------
-- If section 3 fails with "extension pg_net is not available", skip sections 3,
-- 4 and 5 and create a Database Webhook in the dashboard instead. Sections 1
-- and 2 are still required.
--
--   Dashboard, Database, Webhooks, Create a new hook
--     Name                 handover issued email
--     Table                public.handovers
--     Events               Insert only
--     Type                 HTTP Request
--     Method               POST
--     URL                  https://pwqdzitsezblncmewxsf.supabase.co/functions/v1/handover
--     HTTP Headers         Content-Type: application/json
--                          x-bhh-secret: the same value as BHH_WEBHOOK_SECRET
--     HTTP Parameters      leave empty
--     Timeout              8000 ms
--
-- A Database Webhook posts a body shaped { "type": "INSERT", "record": { ... } }.
-- The Edge Function reads the handover id from either payload.handover_id or
-- payload.record.id, so this shape works with no change to the function.
