// British Heritage Hosts Ltd, operator sign in Edge Function
// Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd
// Written 18 September 2026. Deno runtime.
//
// Lets a person who works for us sign in on their own phone with their mobile
// number and a 6 digit code, then see the jobs that belong to them. Uses the
// service role key only, exactly like the handover function, so the tables stay
// closed to the public key and no Row Level Security policy is needed.
//
// Actions, all POST JSON:
//   start    { mobile }                 texts a 6 digit code
//   verify   { mobile, code }           returns a session token
//   jobs     { session }                returns that person's jobs
//   signout  { session }                ends the session
//
// Phase 1 covers the charcoal grill cooks. The role column on the session is
// already there so hosts, scouts, guides, drivers and interpreters can follow
// without a second sign in system.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";

const OTP_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const SESSION_DAYS = 30;
const SITE_BASE = "https://britishheritagehosts.com";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function fail(error: string, message: string, status: number): Response {
  return json({ ok: false, error, message }, status);
}

// ---------------------------------------------------------------- helpers

// Reduces any way of writing a United Kingdom mobile to the same digits, so
// 07700 900123, 447700900123 and +44 7700 900123 all match one another.
function normaliseMobile(raw: unknown): string {
  let d = String(raw ?? "").replace(/[^0-9+]/g, "");
  d = d.replace(/^\+/, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "44" + d.slice(1);
  if (d.startsWith("44")) return d;
  return d;
}

function toE164(normalised: string): string {
  return "+" + normalised;
}

function sixDigitCode(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(100000 + (n[0] % 900000));
}

function sessionToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendSms(to: string, body: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    throw new Error("Twilio is not configured");
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const form = new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${text}`);
  return text;
}

// Finds the person behind a mobile number. Cooks only for now.
async function findPerson(normalised: string) {
  const { data: cooks, error } = await admin.from("cooks").select("id, name, mobile");
  if (error) throw new Error(`cook lookup failed: ${error.message}`);
  for (const c of cooks ?? []) {
    if (normaliseMobile(c.mobile) === normalised) {
      return { id: c.id as string, name: (c.name as string) ?? "", role: "cook" };
    }
  }
  return null;
}

async function sessionPerson(token: unknown) {
  const t = String(token ?? "");
  if (t.length < 20) return null;
  const { data: s } = await admin
    .from("operator_sessions")
    .select("*")
    .eq("token", t)
    .maybeSingle();
  if (!s) return null;
  if (new Date(s.expires_at as string).getTime() < Date.now()) return null;
  await admin.from("operator_sessions").update({ last_seen: new Date().toISOString() }).eq("token", t);
  return s;
}

// ---------------------------------------------------------------- actions

async function actionStart(body: Record<string, unknown>) {
  const normalised = normaliseMobile(body.mobile);
  if (normalised.length < 10) return fail("bad_mobile", "That does not look like a mobile number.", 400);

  const person = await findPerson(normalised);

  // The reply is the same whether or not we know the number, so the page can
  // never be used to work out who works for us.
  if (!person) return json({ ok: true, sent: true });

  const code = sixDigitCode();
  const expires = new Date(Date.now() + OTP_MINUTES * 60 * 1000).toISOString();

  const { error } = await admin.from("operator_logins").insert({
    mobile: normalised,
    code,
    expires_at: expires,
  });
  if (error) return fail("db_error", "The code could not be saved. Please try again.", 500);

  try {
    await sendSms(
      toE164(normalised),
      `${code} is your British Heritage Hosts code. It lasts ${OTP_MINUTES} minutes.`,
    );
  } catch (e) {
    console.error("sms failed", String(e));
    return fail("sms_failed", "The code could not be sent. Please try again shortly.", 502);
  }

  return json({ ok: true, sent: true });
}

async function actionVerify(body: Record<string, unknown>) {
  const normalised = normaliseMobile(body.mobile);
  const code = String(body.code ?? "").replace(/[^0-9]/g, "");
  if (code.length !== 6) return fail("bad_code", "Please enter the 6 digit code.", 400);

  const { data: rows } = await admin
    .from("operator_logins")
    .select("*")
    .eq("mobile", normalised)
    .eq("used", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);

  const row = rows?.[0];
  if (!row) return fail("bad_code", "That code has expired. Please ask for a new one.", 401);

  if ((row.attempts as number) >= MAX_ATTEMPTS) {
    return fail("too_many", "Too many tries. Please ask for a new code.", 429);
  }

  if (String(row.code) !== code) {
    await admin.from("operator_logins")
      .update({ attempts: (row.attempts as number) + 1 })
      .eq("id", row.id);
    return fail("bad_code", "That code is not right.", 401);
  }

  const person = await findPerson(normalised);
  if (!person) return fail("not_found", "We could not find your record.", 404);

  await admin.from("operator_logins").update({ used: true }).eq("id", row.id);

  const token = sessionToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  const { error } = await admin.from("operator_sessions").insert({
    token,
    person_id: person.id,
    role: person.role,
    mobile: normalised,
    expires_at: expires,
  });
  if (error) return fail("db_error", "Sign in could not be completed.", 500);

  return json({ ok: true, session: token, name: person.name, role: person.role });
}

async function actionJobs(body: Record<string, unknown>) {
  const s = await sessionPerson(body.session);
  if (!s) return fail("no_session", "Please sign in again.", 401);

  const since = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

  const { data: bookings, error } = await admin
    .from("bookings")
    .select("*")
    .eq("cook_id", s.person_id)
    .gte("booking_date", since)
    .order("booking_date", { ascending: true });
  if (error) return fail("db_error", "Your jobs could not be loaded.", 500);

  const jobs = [];
  for (const b of bookings ?? []) {
    const { data: venue } = b.venue_id
      ? await admin.from("venues").select("name, address, rep_name").eq("id", b.venue_id).maybeSingle()
      : { data: null };
    const { data: handover } = await admin
      .from("handovers")
      .select("token, status")
      .eq("booking_id", b.booking_id)
      .maybeSingle();

    jobs.push({
      reference: String(b.booking_id ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase(),
      date: b.booking_date,
      time: b.booking_time,
      guests: (Number(b.guest_count_adults ?? 0) + Number(b.guest_count_children ?? 0)) || null,
      status: b.status,
      venue_name: venue?.name ?? null,
      venue_address: venue?.address ?? null,
      venue_contact: venue?.rep_name ?? null,
      handover_status: handover?.status ?? null,
      handover_url: handover?.token ? `${SITE_BASE}/handover.html?token=${handover.token}` : null,
    });
  }

  let name = "";
  if (s.role === "cook") {
    const { data: c } = await admin.from("cooks").select("name").eq("id", s.person_id).maybeSingle();
    name = (c?.name as string) ?? "";
  }

  return json({ ok: true, name, role: s.role, jobs });
}

async function actionSignout(body: Record<string, unknown>) {
  const t = String(body.session ?? "");
  if (t) await admin.from("operator_sessions").delete().eq("token", t);
  return json({ ok: true });
}

// ---------------------------------------------------------------- entry

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("bad_method", "Use POST.", 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("bad_body", "The request was not readable.", 400);
  }

  const action = String(body.action ?? "");
  try {
    if (action === "start") return await actionStart(body);
    if (action === "verify") return await actionVerify(body);
    if (action === "jobs") return await actionJobs(body);
    if (action === "signout") return await actionSignout(body);
    return fail("bad_action", "Unknown action.", 400);
  } catch (e) {
    console.error("operator function error", String(e));
    return fail("server_error", "Something went wrong at our end.", 500);
  }
});
