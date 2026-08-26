# Handover Edge Function

Signing flow for British Heritage Hosts venue handovers. Everything is keyed by the 48
character `handovers.token`. The function runs with the **service role key** only, so the
anon key is never used and no RLS policy is needed for the tables it touches.

Base URL

```
https://pwqdzitsezblncmewxsf.supabase.co/functions/v1/handover
```

## 1. Storage bucket

Run once in the SQL editor. The bucket is **private**: every object is reached through the
service role or a short lived signed URL.

```sql
-- private bucket for handover photos, signatures and PDFs
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'handovers',
  'handovers',
  false,
  15728640,                                              -- 15 MB per object
  array['image/jpeg','image/png','application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- no public policies on purpose. Deny everything that is not the service role.
alter table storage.objects enable row level security;

drop policy if exists "handovers service role only" on storage.objects;
create policy "handovers service role only"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'handovers')
  with check (bucket_id = 'handovers');
```

Object layout inside the bucket:

```
{token}/arrival/photo1.jpg      ... photoN.jpg
{token}/arrival/signature.png
{token}/departure/photo1.jpg    ... photoN.jpg
{token}/departure/signature.png
{token}/handover.pdf
```

## 2. Secrets

Already set on the project: `RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_FROM_NUMBER`, plus the built in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## 3. Actions

All actions accept `POST` with a JSON body. `load` also accepts `GET` with query string
parameters. CORS is open, so the static `handover.html` page can call it from anywhere.

Set a token first:

```bash
BASE=https://pwqdzitsezblncmewxsf.supabase.co/functions/v1/handover
TOKEN=paste_the_48_character_token_here
```

### load

Returns booking, venue, cook and handover status. `404` if the token is unknown, `410` if
the event date is more than one day in the past, `409` if the handover is already
`departure_signed`.

```bash
curl -s -X POST "$BASE" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"load\",\"token\":\"$TOKEN\"}"
```

Or as a GET:

```bash
curl -s "$BASE?action=load&token=$TOKEN"
```

### send_code

Generates a 6 digit code, stores it in `otp_codes` with a 10 minute expiry and texts it to
`venues.rep_mobile` through the Twilio REST API.

```bash
curl -s -X POST "$BASE" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"send_code\",\"token\":\"$TOKEN\",\"stage\":\"arrival\"}"
```

```bash
curl -s -X POST "$BASE" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"send_code\",\"token\":\"$TOKEN\",\"stage\":\"departure\"}"
```

### sign

Verifies the code, marks it used, uploads the photos and signature, writes the handover
row and moves the status on. Photos are base64 JPEG, the signature is a base64 PNG. Data
URL prefixes are accepted and stripped.

Arrival:

```bash
curl -s -X POST "$BASE" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "sign",
    "token": "'"$TOKEN"'",
    "stage": "arrival",
    "code": "123456",
    "checks": {
      "grassAndGround":    { "rating": "Good", "note": "" },
      "fencesAndFixtures": { "rating": "Fair", "note": "Loose post by the gate" },
      "toilets":           { "rating": "Good", "note": "" },
      "bins":              { "rating": "Good", "note": "" },
      "existingDamage":    { "rating": "Fair", "note": "Chip in the patio slab" }
    },
    "photos": ["/9j/4AAQSkZJRgABAQAAAQABAAD..."],
    "signature": "iVBORw0KGgoAAAANSUhEUg...",
    "lat": 51.5074,
    "lng": -0.1278
  }'
```

Departure. This also builds the one page PDF, stores it at `{token}/handover.pdf`, saves
that path in `handovers.pdf_url` and emails it from `enquiries@britishheritagehosts.com`
to `venues.rep_email`, `cooks.email` and `info@britishheritagehosts.com`.

```bash
curl -s -X POST "$BASE" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "sign",
    "token": "'"$TOKEN"'",
    "stage": "departure",
    "code": "654321",
    "checks": {
      "grillRemoved":   { "rating": "Good", "note": "" },
      "ashRemoved":     { "rating": "Good", "note": "" },
      "tablesRemoved":  { "rating": "Good", "note": "" },
      "wasteRemoved":   { "rating": "Good", "note": "" },
      "areaSwept":      { "rating": "Good", "note": "" },
      "noBurnMarks":    { "rating": "Fair", "note": "Light grease mark on the paving" },
      "toiletsClean":   { "rating": "Good", "note": "" },
      "gatesAndDoors":  { "rating": "Good", "note": "" }
    },
    "photos": ["/9j/4AAQSkZJRgABAQAAAQABAAD..."],
    "signature": "iVBORw0KGgoAAAANSUhEUg...",
    "lat": 51.5074,
    "lng": -0.1278,
    "comments": "Handed back in good order, representative happy."
  }'
```

Handy way to build a base64 payload from a local file:

```bash
base64 -w0 signature.png > signature.txt
base64 -w0 photo1.jpg   > photo1.txt
```

### Fetching a stored PDF

```bash
curl -s -X POST "https://pwqdzitsezblncmewxsf.supabase.co/storage/v1/object/sign/handovers/$TOKEN/handover.pdf" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"expiresIn": 3600}'
```

## 4. Error codes

| code | http | meaning |
| --- | --- | --- |
| `bad_token` / `not_found` | 404 | token missing, malformed or unknown |
| `expired` | 410 | event date is more than one day in the past |
| `completed` | 409 | already `departure_signed` |
| `bad_stage` | 400 / 409 | stage missing, or out of order |
| `no_mobile` | 400 | venue has no representative mobile on file |
| `bad_code` | 400 / 401 | code malformed, wrong, used or expired |
| `sms_failed` | 502 | Twilio rejected the message |
| `upload_failed` | 502 | storage rejected a photo or signature |
| `db_error` | 500 | database write failed |

On a successful departure sign the response may still carry `pdf_error` or `email_error`.
The signature itself is saved either way, so the record is never lost because Resend or
storage had a bad moment.

## 5. Deploying, when you are ready

Not run yet, on purpose.

```bash
supabase functions deploy handover --project-ref pwqdzitsezblncmewxsf
```
