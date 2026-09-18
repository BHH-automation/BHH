-- British Heritage Hosts, phase 1 test record
-- Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd
-- Created 18 September 2026
--
-- One test venue, one test cook carrying Faleh's own mobile, and one booking
-- three days from now that links the two. Fixed identifiers, so the clean up
-- block at the bottom removes exactly these three rows and nothing else.

insert into public.services (service_id, service_name, duration_hours, description)
values (
  '44444444-4444-4444-8444-444444444444',
  'River Side Grill, test entry',
  4,
  'Placeholder used only for the phase 1 test booking.'
)
on conflict (service_name) do nothing;

insert into public.venues (id, name, address, rep_name, rep_mobile, rep_email)
values (
  '11111111-1111-4111-8111-111111111111',
  'Test venue, riverside lawn',
  '1 Riverside Lane, Richmond, London TW9',
  'Test representative',
  '+447700900123',
  'info@britishheritagehosts.com'
)
on conflict (id) do nothing;

insert into public.cooks (id, name, mobile, email, insurance_ok)
values (
  '22222222-2222-4222-8222-222222222222',
  'Test cook',
  '+966507771349',
  'info@britishheritagehosts.com',
  true
)
on conflict (id) do nothing;

insert into public.bookings (
  booking_id, guest_name, guest_email, service_id,
  booking_date, booking_time,
  guest_count_adults, guest_count_children,
  status, venue_id, cook_id
)
values (
  '33333333-3333-4333-8333-333333333333',
  'Test guest',
  'info@britishheritagehosts.com',
  (select service_id from public.services order by created_at nulls first limit 1),
  current_date + 3,
  '18:00',
  6, 2,
  'confirmed',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
)
on conflict (booking_id) do nothing;

-- Clean up, run these on their own when the test is finished:
-- delete from public.bookings where booking_id = '33333333-3333-4333-8333-333333333333';
-- delete from public.cooks    where id = '22222222-2222-4222-8222-222222222222';
-- delete from public.venues   where id = '11111111-1111-4111-8111-111111111111';
-- delete from public.services where service_id = '44444444-4444-4444-8444-444444444444';
