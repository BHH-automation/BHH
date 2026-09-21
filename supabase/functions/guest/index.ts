// British Heritage Hosts Ltd, guest sign in Edge Function
// Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd
// Written 20 September 2026. Deno runtime.
//
// Lets a guest open their own booking on their own phone. The guest types
// either the email address or the mobile number held on their booking. The 6
// digit code is sent to that same route, never to the other one, so nobody can
// have a code delivered to a guest's email by guessing their mobile number.
//
// Actions, all POST JSON:
//   start     { contact }              sends a 6 digit code by email or text
//   verify    { contact, code }        returns a session token
//   bookings  { session }              returns that guest's bookings
//   signout   { session }              ends the session
//
// Uses the service role key only, exactly like the operator and handover
// functions, so the tables stay closed to the public key and no Row Level
// Security policy is needed.
//
// This function never says whether a booking exists. "start" always answers
// the same way, so the page cannot be used to test whether a person is a
// client of ours.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";

const FROM_EMAIL = "enquiries@britishheritagehosts.com";
const OTP_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;
const SESSION_DAYS = 30;

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

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

// ---------------------------------------------------------------- helpers

// A guest types either an email address or a mobile number. Anything with an
// at sign is treated as an email, everything else as a number.
function readContact(raw: unknown): { contact: string; channel: "email" | "mobile" } | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  if (text.includes("@")) {
    const email = text.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return { contact: email, channel: "email" };
  }

  const digits = text.replace(/[^0-9]/g, "");
  if (digits.length < 7) return null;
  return { contact: digits, channel: "mobile" };
}

// Guests are international, so a number cannot be reduced the way a United
// Kingdom mobile is. The last 9 digits are the part that stays the same
// however the guest writes the country code, the leading zero or the spaces.
function tail(digits: string): string {
  return digits.slice(-9);
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

async function sendEmail(to: string, code: string) {
  if (!RESEND_API_KEY) throw new Error("Resend is not configured");
  const html = `
<div style="font-family:Georgia,serif;background:#F5F0E8;padding:28px">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid rgba(201,168,76,0.4)">
    <div style="background:#0D1B2A;padding:22px;text-align:center">
      <div style="color:#C9A84C;font-size:20px;letter-spacing:0.08em">BRITISH HERITAGE HOSTS</div>
    </div>
    <div style="padding:26px 24px;color:#1A1A1A">
      <p style="margin:0 0 16px;font-size:16px">Your code for opening your booking is</p>
      <p style="margin:0 0 18px;font-size:34px;letter-spacing:0.28em;color:#0D1B2A"><strong>${esc(code)}</strong></p>
      <p style="margin:0 0 8px;font-size:15px;color:#666055">It lasts ${OTP_MINUTES} minutes and can be used once.</p>
      <p style="margin:0;font-size:15px;color:#666055">If you did not ask for this code, you can ignore this message. Nobody can reach your booking without it.</p>
    </div>
  </div>
</div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `British Heritage Hosts <${FROM_EMAIL}>`,
      to: [to],
      subject: `${code} is your code for your booking`,
      html,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${text}`);
  return text;
}

// Finds every booking that belongs to this contact.
async function bookingsFor(contact: string, channel: "email" | "mobile") {
  if (channel === "email") {
    const { data, error } = await admin
      .from("bookings")
      .select("*")
      .ilike("guest_email", contact);
    if (error) throw new Error(`booking lookup failed: ${error.message}`);
    return data ?? [];
  }

  const { data, error } = await admin
    .from("bookings")
    .select("*")
    .like("guest_phone_digits", `%${tail(contact)}`);
  if (error) throw new Error(`booking lookup failed: ${error.message}`);
  return data ?? [];
}

async function sessionGuest(token: unknown) {
  const t = String(token ?? "");
  if (t.length < 20) return null;
  const { data: s } = await admin
    .from("guest_sessions")
    .select("*")
    .eq("token", t)
    .maybeSingle();
  if (!s) return null;
  if (new Date(s.expires_at as string).getTime() < Date.now()) return null;
  await admin.from("guest_sessions").update({ last_seen: new Date().toISOString() }).eq("token", t);
  return s;
}

// ---------------------------------------------------------------- actions

async function actionStart(body: Record<string, unknown>) {
  const read = readContact(body.contact);
  if (!read) {
    return fail("bad_contact", "Please enter the email address or the mobile number on your booking.", 400);
  }

  // Too many codes in an hour means somebody is working through a list of
  // addresses, so we stop answering with a new code. The guest sees the same
  // friendly reply either way.
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const { count } = await admin
    .from("guest_logins")
    .select("id", { count: "exact", head: true })
    .eq("contact", read.contact)
    .gt("created_at", hourAgo);
  if ((count ?? 0) >= MAX_CODES_PER_HOUR) return json({ ok: true, sent: true, channel: read.channel });

  const found = await bookingsFor(read.contact, read.channel);
  if (found.length === 0) return json({ ok: true, sent: true, channel: read.channel });

  const code = sixDigitCode();
  const expires = new Date(Date.now() + OTP_MINUTES * 60 * 1000).toISOString();

  const { error } = await admin.from("guest_logins").insert({
    contact: read.contact,
    channel: read.channel,
    code,
    expires_at: expires,
  });
  if (error) return fail("db_error", "The code could not be saved. Please try again.", 500);

  try {
    if (read.channel === "email") {
      await sendEmail(read.contact, code);
    } else {
      await sendSms(
        "+" + read.contact,
        `${code} is your British Heritage Hosts code. It lasts ${OTP_MINUTES} minutes.`,
      );
    }
  } catch (e) {
    console.error("code send failed", String(e));
    return fail("send_failed", "The code could not be sent. Please try the other way, or contact us.", 502);
  }

  return json({ ok: true, sent: true, channel: read.channel });
}

async function actionVerify(body: Record<string, unknown>) {
  const read = readContact(body.contact);
  if (!read) return fail("bad_contact", "Please start again.", 400);

  const code = String(body.code ?? "").replace(/[^0-9]/g, "");
  if (code.length !== 6) return fail("bad_code", "Please enter the 6 digit code.", 400);

  const { data: rows } = await admin
    .from("guest_logins")
    .select("*")
    .eq("contact", read.contact)
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
    await admin.from("guest_logins")
      .update({ attempts: (row.attempts as number) + 1 })
      .eq("id", row.id);
    return fail("bad_code", "That code is not right.", 401);
  }

  const found = await bookingsFor(read.contact, read.channel);
  if (found.length === 0) return fail("not_found", "We could not find your booking.", 404);

  await admin.from("guest_logins").update({ used: true }).eq("id", row.id);

  const token = sessionToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  const { error } = await admin.from("guest_sessions").insert({
    token,
    contact: read.contact,
    channel: read.channel,
    guest_name: found[0].guest_name ?? null,
    expires_at: expires,
  });
  if (error) return fail("db_error", "Sign in could not be completed.", 500);

  return json({ ok: true, session: token, name: found[0].guest_name ?? "" });
}

// What the guest is allowed to see. Deliberately narrow: what is booked, when,
// how many of them, where it stands and what was quoted. Nothing about the
// host, the cook or any other party is returned.
async function actionBookings(body: Record<string, unknown>) {
  const s = await sessionGuest(body.session);
  if (!s) return fail("no_session", "Please sign in again.", 401);

  let rows: Record<string, unknown>[] = [];
  try {
    rows = await bookingsFor(s.contact as string, s.channel as "email" | "mobile");
  } catch (_e) {
    return fail("db_error", "Your booking could not be loaded.", 500);
  }

  rows.sort((a, b) => String(a.booking_date ?? "").localeCompare(String(b.booking_date ?? "")));

  const bookings = [];
  for (const b of rows) {
    let service = "";
    if (b.service_id) {
      const { data: sv } = await admin
        .from("services")
        .select("*")
        .eq("service_id", b.service_id)
        .maybeSingle();
      service = String(sv?.service_name ?? "");
    }
    bookings.push({
      reference: String(b.booking_id ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase(),
      service,
      date: b.booking_date ?? null,
      time: b.booking_time ?? null,
      adults: Number(b.guest_count_adults ?? 0) || null,
      children: Number(b.guest_count_children ?? 0) || null,
      status: String(b.status ?? ""),
      price_quoted: b.price_quoted ?? null,
    });
  }

  return json({ ok: true, name: s.guest_name ?? "", bookings });
}

async function actionSignout(body: Record<string, unknown>) {
  const t = String(body.session ?? "");
  if (t) await admin.from("guest_sessions").delete().eq("token", t);
  return json({ ok: true });
}

// ---------------------------------------------------------------- entry

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("bad_method", "Use POST.", 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (_e) {
    return fail("bad_body", "The request could not be read.", 400);
  }

  const action = String(body.action ?? "");
  try {
    if (action === "start") return await actionStart(body);
    if (action === "verify") return await actionVerify(body);
    if (action === "bookings") return await actionBookings(body);
    if (action === "signout") return await actionSignout(body);
    return fail("bad_action", "That request is not understood.", 400);
  } catch (e) {
    console.error("guest function failed", String(e));
    return fail("server_error", "Something went wrong. Please try again shortly.", 500);
  }
});
