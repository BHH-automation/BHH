// British Heritage Hosts Ltd, payments Edge Function
// Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd
// Written 2 October 2026. Deno runtime.
//
// Turns a priced proposal into one exact card payment through Stripe, confirms
// the booking the moment Stripe reports the payment (Terms clause 2), works out
// the refund under the cancellation policy (Terms clause 3), and sends that
// refund only after the Director approves it.
//
// Only the six services British Heritage Hosts sells can ever be priced here.
// Transport, Narrowboat Holiday and the Canal Day Cruise are refused, because
// clause 12 says BHH never sells or takes payment for them.
//
// Requests, all POST JSON with an "action", except Stripe's own webhook calls,
// which carry a Stripe-Signature header and are recognised by it.
//
// Public, no sign in:
//   settings                       minimum days ahead and blocked dates
//   view      { ref, key }         the proposal, as the guest may see it
//   checkout  { ref, key }         makes the Stripe payment page, returns its address
//   cancel    { ref, key }         the guest asks to cancel; refund worked out
//   letter    { ref, key }         details for the booking confirmation letter
//   ask       { name, email, question, lang, consent }  a question from the FAQ page
//
// Director, after signing in with a code sent to the company inbox:
//   d_start / d_verify { code } / d_signout
//   d_list                         every proposal, newest first
//   d_create  { proposal }         saves a proposal and emails the payment link
//   d_resend  { id }               emails the payment link again
//   d_withdraw { id }              withdraws an unpaid proposal
//   d_refund  { id }               approves and sends the refund the guest asked for
//   d_cancel  { id }               BHH cancels: full refund (clause 3)
//   d_settings { min_lead_days, block, unblock, note }
//   d_question { id, status }      marks a FAQ question answered or hides it

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SITE_URL = (Deno.env.get("BHH_SITE_URL") ?? "https://britishheritagehosts.com").replace(/\/$/, "");
const DIRECTOR_EMAIL = Deno.env.get("BHH_DIRECTOR_EMAIL") ?? "info@britishheritagehosts.com";

const FROM_EMAIL = "enquiries@britishheritagehosts.com";
const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const SESSION_HOURS = 12;

// The only services BHH sells and invoices (Terms clauses 1 and 12, and the
// classification decided on 27 August 2026: tourist services only).
const SELLABLE = [
  "British Dinner",
  "English Tea",
  "Heritage Guide",
  "Riverside Grill",
  "Cultural Immersion Programme",
  "Personal Interpreter Service",
];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Row = Record<string, unknown>;
type Item = { service: string; date: string; adults: number; children: number; price_pence: number; note?: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function fail(error: string, message: string, status: number): Response {
  return json({ ok: false, error, message }, status);
}
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}
function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function sixDigitCode(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(100000 + (n[0] % 900000));
}
// A reference a guest can read over the phone: no 0, O, 1, I or L.
function newReference(): string {
  const letters = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return "BHH" + Array.from(b).map((x) => letters[x % letters.length]).join("");
}
function pounds(pence: number): string {
  const n = (pence || 0) / 100;
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

// ------------------------------------------------------------ dates, London

// Today's date as people in London read it, so a family abroad late at night
// is not given a different answer from the one the Terms intend.
function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}
function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000);
}
function validDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
}

// ------------------------------------------------------------ clause 3

// Terms of Service, clause 3, applied to each experience by its own date:
//   more than 14 days before   full refund
//   7 to 14 days before        50% refund
//   less than 7 days before    no refund (unless BHH can rearrange the date)
//   BHH cancels                full refund
function refundFor(items: Item[], cancelledBy: "guest" | "bhh", today = londonToday()) {
  const lines = items.map((it) => {
    const days = daysBetween(today, it.date);
    let share = 0;
    let rule = "";
    if (cancelledBy === "bhh") { share = 1; rule = "BHH cancelled: full refund"; }
    else if (days > 14) { share = 1; rule = "More than 14 days before: full refund"; }
    else if (days >= 7) { share = 0.5; rule = "7 to 14 days before: 50% refund"; }
    else { share = 0; rule = "Less than 7 days before: no refund, unless BHH can rearrange the date"; }
    return { service: it.service, date: it.date, days, price_pence: it.price_pence, refund_pence: Math.round(it.price_pence * share), rule };
  });
  return { lines, total_pence: lines.reduce((s, l) => s + l.refund_pence, 0) };
}

// ------------------------------------------------------------ email

async function sendEmail(to: string, subject: string, bodyHtml: string, replyTo?: string) {
  if (!RESEND_API_KEY) throw new Error("Resend is not configured");
  const html = `
<div style="font-family:Georgia,serif;background:#F5F0E8;padding:28px">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid rgba(201,168,76,0.4)">
    <div style="background:#0D1B2A;padding:22px;text-align:center">
      <div style="color:#C9A84C;font-size:20px;letter-spacing:0.08em">BRITISH HERITAGE HOSTS</div>
    </div>
    <div style="padding:26px 24px;color:#1A1A1A;font-size:16px;line-height:1.6">${bodyHtml}</div>
    <div style="padding:14px 24px 22px;color:#666055;font-size:13px">British Heritage Hosts Ltd, Company No. 17103555, registered in England and Wales.</div>
  </div>
</div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `British Heritage Hosts <${FROM_EMAIL}>`, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

function button(href: string, label: string): string {
  return `<p style="margin:22px 0"><a href="${esc(href)}" style="background:#C9A84C;color:#0D1B2A;padding:14px 22px;text-decoration:none;letter-spacing:0.1em;font-family:Arial,sans-serif;font-size:14px">${esc(label)}</a></p>`;
}
function itemsTable(items: Item[]): string {
  return `<table style="width:100%;border-collapse:collapse;font-size:15px">${items.map((it) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${esc(it.service)}<br><span style="color:#666055">${esc(niceDate(it.date))}</span></td>
     <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right">${pounds(it.price_pence)}</td></tr>`).join("")}</table>`;
}
function niceDate(d: string): string {
  if (!validDate(d)) return d;
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
function guestLink(p: Row): string {
  return `${SITE_URL}/app/pay.html?r=${encodeURIComponent(String(p.reference))}&k=${encodeURIComponent(String(p.access_key))}`;
}

async function emailProposal(p: Row) {
  const items = p.items as Item[];
  await sendEmail(String(p.guest_email), `Your British Heritage Hosts proposal ${p.reference}`, `
    <p>Dear ${esc(p.guest_name)},</p>
    <p>Thank you for your enquiry. Your personal proposal is ready.</p>
    ${itemsTable(items)}
    <p style="font-size:18px;margin-top:14px"><strong>Total ${pounds(Number(p.total_pence))}</strong></p>
    <p>Your booking is confirmed as soon as payment is received. You can pay securely by card on the page below, where you can also read our Terms of Service and cancellation policy.</p>
    ${button(guestLink(p), "VIEW AND PAY")}
    <p style="color:#666055;font-size:14px">Your reference is ${esc(p.reference)}.</p>`);
}

// ------------------------------------------------------------ Stripe

async function stripe(path: string, params: Record<string, string>, idempotencyKey?: string) {
  if (!STRIPE_SECRET_KEY) throw new Error("Stripe is not configured");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { method: "POST", headers, body: new URLSearchParams(params).toString() });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${data?.error?.message ?? "error"}`);
  return data;
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// Proves the call really came from Stripe: the signature is made with the
// webhook secret only Stripe and this function know.
async function stripeSignatureOk(raw: string, header: string): Promise<boolean> {
  if (!STRIPE_WEBHOOK_SECRET) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=", 2) as [string, string]));
  const t = parts["t"];
  const sigs = header.split(",").filter((kv) => kv.startsWith("v1=")).map((kv) => kv.slice(3));
  if (!t || sigs.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`)));
  return sigs.some((s) => sameText(s, mac));
}

// ------------------------------------------------------------ lookups

async function proposalByRef(ref: unknown, key: unknown): Promise<Row | null> {
  const r = String(ref ?? "").trim().toUpperCase();
  const k = String(key ?? "").trim();
  if (!/^BHH[A-Z0-9]{6}$/.test(r) || k.length < 20) return null;
  const { data } = await admin.from("proposals").select("*").eq("reference", r).maybeSingle();
  if (!data || !sameText(String(data.access_key), k)) return null;
  return data;
}

function guestView(p: Row) {
  const items = (p.items as Item[]) ?? [];
  const out: Row = {
    reference: p.reference,
    name: p.guest_name,
    status: p.status,
    items,
    total_pence: p.total_pence,
    paid_at: p.paid_at,
    refund_due_pence: p.refund_due_pence,
    refund_pence: p.refund_pence,
    cancelled_by: p.cancelled_by,
    preferred_area: p.preferred_area,
  };
  if (p.status === "paid") out.cancel_preview = refundFor(items, "guest");
  return out;
}

async function settings() {
  const { data: s } = await admin.from("booking_settings").select("*");
  const map = Object.fromEntries((s ?? []).map((r) => [r.key, r.value]));
  const { data: d } = await admin.from("unavailable_dates").select("day, note").gte("day", londonToday()).order("day");
  return { min_lead_days: Number(map.min_lead_days ?? 7), unavailable: (d ?? []).map((r) => r.day), unavailable_notes: d ?? [] };
}

// ------------------------------------------------------------ public actions

async function actionView(body: Row) {
  const p = await proposalByRef(body.ref, body.key);
  if (!p) return fail("not_found", "We could not find this proposal. Please use the link in your email.", 404);
  return json({ ok: true, proposal: guestView(p), sellable: SELLABLE });
}

async function actionCheckout(body: Row) {
  const p = await proposalByRef(body.ref, body.key);
  if (!p) return fail("not_found", "We could not find this proposal.", 404);
  if (p.status !== "sent") return fail("not_payable", "This proposal is no longer waiting for payment.", 409);

  const items = p.items as Item[];
  // A proposal whose first experience is already in the past cannot be paid.
  if (p.first_date && daysBetween(londonToday(), String(p.first_date)) < 0) {
    return fail("expired", "The dates in this proposal have passed. Please contact us for a new proposal.", 409);
  }

  const back = guestLink(p);
  const params: Record<string, string> = {
    mode: "payment",
    client_reference_id: String(p.reference),
    customer_email: String(p.guest_email),
    success_url: back + "&paid=1",
    cancel_url: back,
    "metadata[reference]": String(p.reference),
    "payment_intent_data[metadata][reference]": String(p.reference),
    "payment_intent_data[description]": `British Heritage Hosts booking ${p.reference}`,
    expires_at: String(Math.floor(Date.now() / 1000) + 60 * 60),
    // Guests pay in pounds sterling, as the Terms say. Stripe's own currency
    // switch adds a conversion fee for the guest, so it is turned off here.
    "adaptive_pricing[enabled]": "false",
  };
  items.forEach((it, i) => {
    params[`line_items[${i}][quantity]`] = "1";
    params[`line_items[${i}][price_data][currency]`] = "gbp";
    params[`line_items[${i}][price_data][unit_amount]`] = String(it.price_pence);
    params[`line_items[${i}][price_data][product_data][name]`] = `${it.service}, ${niceDate(it.date)}`;
  });

  const session = await stripe("checkout/sessions", params);
  await admin.from("proposals").update({ stripe_session_id: session.id }).eq("id", p.id);
  return json({ ok: true, url: session.url });
}

async function actionCancel(body: Row) {
  const p = await proposalByRef(body.ref, body.key);
  if (!p) return fail("not_found", "We could not find this booking.", 404);
  if (p.status !== "paid") return fail("not_cancellable", "This booking cannot be cancelled online. Please contact us.", 409);

  const r = refundFor(p.items as Item[], "guest");
  await admin.from("proposals").update({
    status: "cancel_requested",
    cancel_requested_at: new Date().toISOString(),
    cancelled_by: "guest",
    refund_due_pence: r.total_pence,
  }).eq("id", p.id);

  const rows = r.lines.map((l) => `<li>${esc(l.service)}, ${esc(niceDate(l.date))}: ${esc(l.rule)}, ${pounds(l.refund_pence)}</li>`).join("");
  try {
    await sendEmail(String(p.guest_email), `Your cancellation request ${p.reference}`, `
      <p>Dear ${esc(p.guest_name)},</p>
      <p>We have received your request to cancel booking ${esc(p.reference)}. Under clause 3 of our Terms of Service the refund due is <strong>${pounds(r.total_pence)}</strong>.</p>
      <ul>${rows}</ul>
      <p>We will confirm the cancellation and send any refund to the card you paid with. Refunds usually reach the card within 5 to 10 working days.</p>`);
    await sendEmail(DIRECTOR_EMAIL, `Cancellation request ${p.reference}, refund due ${pounds(r.total_pence)}`, `
      <p>${esc(p.guest_name)} has asked to cancel booking ${esc(p.reference)}.</p><ul>${rows}</ul>
      ${button(`${SITE_URL}/app/director.html`, "OPEN THE DIRECTOR PAGE")}`);
  } catch (e) { console.error("cancel email failed", String(e)); }

  return json({ ok: true, refund: r });
}

async function actionLetter(body: Row) {
  const p = await proposalByRef(body.ref, body.key);
  if (!p) return fail("not_found", "We could not find this booking.", 404);
  if (p.status !== "paid") return fail("not_paid", "The confirmation letter is available once the booking is paid.", 409);
  return json({
    ok: true,
    letter: {
      reference: p.reference, name: p.guest_name, nationality: p.nationality ?? "",
      items: p.items, total_pence: p.total_pence, paid_at: p.paid_at,
      first_date: p.first_date, last_date: p.last_date,
    },
  });
}


// ------------------------------------------------------------ FAQ questions

// A visitor asks a question on the FAQ page. It is kept for the Director, he
// is emailed (a reply goes straight back to the visitor), and the visitor gets
// a short acknowledgement in the page's language. Nothing is published.
async function actionAsk(body: Row) {
  if (String(body.website ?? "").trim()) return json({ ok: true }); // robot trap
  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 200);
  const question = String(body.question ?? "").trim().slice(0, 2000);
  const lang = body.lang === "ar" ? "ar" : "en";
  if (!name || !question) return fail("missing", lang === "ar" ? "يرجى كتابة الاسم والسؤال." : "Please give your name and your question.", 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("bad_email", lang === "ar" ? "يرجى كتابة بريد إلكتروني صحيح." : "Please give a valid email address.", 400);
  if (body.consent !== true) return fail("consent", lang === "ar" ? "يرجى الموافقة على استخدام بياناتكم للرد." : "Please tick the consent box.", 400);

  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const { count } = await admin.from("faq_questions").select("id", { count: "exact", head: true }).eq("email", email).gt("created_at", hourAgo);
  if ((count ?? 0) >= 3) return json({ ok: true });

  const { error } = await admin.from("faq_questions").insert({ name, email, question, lang });
  if (error) return fail("db_error", lang === "ar" ? "تعذّر حفظ سؤالكم، يرجى المحاولة لاحقًا." : "Your question could not be saved. Please try again.", 500);

  try {
    await sendEmail(DIRECTOR_EMAIL, `New website question from ${name}`, `
      <p><strong>${esc(name)}</strong> (${esc(email)}) asked on the ${lang === "ar" ? "Arabic" : "English"} FAQ page:</p>
      <blockquote style="border-left:3px solid #C9A84C;margin:0;padding:8px 14px;background:#F5F0E8">${esc(question).replace(/\n/g, "<br>")}</blockquote>
      <p>Reply to this email to answer them directly. The question is also listed on your Director page.</p>
      ${button(`${SITE_URL}/app/director.html`, "OPEN THE DIRECTOR PAGE")}`, email);
    if (lang === "ar") {
      await sendEmail(email, "وصلنا سؤالكم، بريتش هيريتج هوستس", `<div dir="rtl" style="text-align:right">
        <p>مرحبًا ${esc(name)}،</p>
        <p>شكرًا لكم على سؤالكم. وصلنا وسنرد عليكم شخصيًا بالبريد الإلكتروني، غالبًا في اليوم نفسه.</p>
        <p style="color:#666055">سؤالكم: ${esc(question)}</p></div>`);
    } else {
      await sendEmail(email, "We have received your question, British Heritage Hosts", `
        <p>Dear ${esc(name)},</p>
        <p>Thank you for your question. It has reached us and we will reply to you personally by email, usually the same day.</p>
        <p style="color:#666055">Your question: ${esc(question)}</p>`);
    }
  } catch (e) { console.error("question email failed", String(e)); }
  return json({ ok: true });
}

// ------------------------------------------------------------ Stripe webhook

async function handleWebhook(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  if (!(await stripeSignatureOk(raw, sig))) return new Response("bad signature", { status: 400 });

  const event = JSON.parse(raw);
  const { error: dup } = await admin.from("stripe_events").insert({ id: event.id, type: event.type });
  if (dup) return new Response("already handled", { status: 200 });

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const s = event.data.object;
    if (s.payment_status !== "paid") return new Response("not paid yet", { status: 200 });
    const ref = String(s.client_reference_id ?? s.metadata?.reference ?? "");
    const { data: p } = await admin.from("proposals").select("*").eq("reference", ref).maybeSingle();
    if (!p) return new Response("unknown reference", { status: 200 });
    if (p.status !== "sent") return new Response("already settled", { status: 200 });
    // If a guest ever paid in another currency, Stripe reports the pounds
    // amount under currency_conversion; that is the figure to check.
    const gbpTotal = s.currency_conversion?.source_currency === "gbp" ? Number(s.currency_conversion.amount_total) : Number(s.amount_total);
    const gbpCurrency = s.currency_conversion?.source_currency ?? s.currency;
    if (gbpTotal !== Number(p.total_pence) || String(gbpCurrency) !== "gbp") {
      console.error("amount mismatch", ref, s.amount_total, p.total_pence);
      await sendEmail(DIRECTOR_EMAIL, `Check payment ${ref}`, `<p>Stripe reported ${esc(s.amount_total)} ${esc(s.currency)} for ${esc(ref)}, but the proposal total is ${esc(p.total_pence)} pence. The booking was NOT confirmed. Please check Stripe.</p>`).catch(() => {});
      return new Response("amount mismatch", { status: 200 });
    }

    await admin.from("proposals").update({
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_payment_intent: String(s.payment_intent ?? ""),
    }).eq("id", p.id);

    try {
      await sendEmail(String(p.guest_email), `Booking confirmed ${p.reference}`, `
        <p>Dear ${esc(p.guest_name)},</p>
        <p>Thank you. We have received your payment of <strong>${pounds(Number(p.total_pence))}</strong> and your booking is confirmed.</p>
        <p style="font-size:18px">Your booking reference is <strong>${esc(p.reference)}</strong></p>
        ${itemsTable(p.items as Item[])}
        <p>Your booking page shows your experiences, lets you download a booking confirmation letter, and is where you can cancel if you need to. Our cancellation terms, in clause 3 of the Terms of Service, apply from the moment of payment.</p>
        ${button(guestLink(p), "OPEN MY BOOKING")}`);
      await sendEmail(DIRECTOR_EMAIL, `Paid: ${p.reference}, ${pounds(Number(p.total_pence))}`, `<p>${esc(p.guest_name)} has paid booking ${esc(p.reference)}.</p>${itemsTable(p.items as Item[])}`);
    } catch (e) { console.error("confirmation email failed", String(e)); }
  }
  return new Response("ok", { status: 200 });
}

// ------------------------------------------------------------ Director

async function directorSession(token: unknown): Promise<boolean> {
  const t = String(token ?? "");
  if (t.length < 20) return false;
  const { data } = await admin.from("director_sessions").select("*").eq("token", t).maybeSingle();
  return !!data && new Date(String(data.expires_at)).getTime() > Date.now();
}

async function dStart() {
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const { count } = await admin.from("director_logins").select("id", { count: "exact", head: true }).gt("created_at", hourAgo);
  if ((count ?? 0) >= 6) return fail("too_many", "Too many codes this hour. Please wait.", 429);
  const code = sixDigitCode();
  await admin.from("director_logins").insert({ code, expires_at: new Date(Date.now() + CODE_MINUTES * 60000).toISOString() });
  await sendEmail(DIRECTOR_EMAIL, `${code} is your Director page code`, `<p>Your code for the British Heritage Hosts Director page is</p><p style="font-size:32px;letter-spacing:0.28em"><strong>${code}</strong></p><p>It lasts ${CODE_MINUTES} minutes.</p>`);
  return json({ ok: true, sent_to: DIRECTOR_EMAIL.replace(/^(.).*(@.*)$/, "$1…$2") });
}

async function dVerify(body: Row) {
  const code = String(body.code ?? "").replace(/[^0-9]/g, "");
  const { data: rows } = await admin.from("director_logins").select("*").eq("used", false)
    .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1);
  const row = rows?.[0];
  if (!row) return fail("bad_code", "That code has expired. Please ask for a new one.", 401);
  if (Number(row.attempts) >= MAX_ATTEMPTS) return fail("too_many", "Too many tries. Please ask for a new code.", 429);
  if (String(row.code) !== code) {
    await admin.from("director_logins").update({ attempts: Number(row.attempts) + 1 }).eq("id", row.id);
    return fail("bad_code", "That code is not right.", 401);
  }
  await admin.from("director_logins").update({ used: true }).eq("id", row.id);
  const token = randomHex(24);
  await admin.from("director_sessions").insert({ token, expires_at: new Date(Date.now() + SESSION_HOURS * 3600000).toISOString() });
  return json({ ok: true, session: token });
}

function cleanItems(raw: unknown): Item[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "Add at least one experience.";
  const out: Item[] = [];
  for (const r of raw as Row[]) {
    const service = String(r.service ?? "").trim();
    if (!SELLABLE.includes(service)) {
      return `${service || "That service"} cannot be sold by BHH. Transport, Narrowboat Holiday and the Canal Day Cruise are booked and paid directly with the provider (Terms clause 12).`;
    }
    if (!validDate(r.date)) return `Please give a date for ${service}.`;
    const price = Math.round(Number(r.price_pence));
    if (!Number.isFinite(price) || price < 100) return `Please give a price for ${service}.`;
    out.push({
      service, date: String(r.date), price_pence: price,
      adults: Math.max(0, Math.round(Number(r.adults) || 0)),
      children: Math.max(0, Math.round(Number(r.children) || 0)),
      note: String(r.note ?? "").slice(0, 300),
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

async function dCreate(body: Row) {
  const p = (body.proposal ?? {}) as Row;
  const items = cleanItems(p.items);
  if (typeof items === "string") return fail("bad_items", items, 400);
  const name = String(p.guest_name ?? "").trim();
  const email = String(p.guest_email ?? "").trim().toLowerCase();
  if (!name) return fail("bad_name", "Please give the guest's name.", 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("bad_email", "Please give the guest's email address.", 400);
  if (daysBetween(londonToday(), items[0].date) < 0) return fail("past", "The first experience date has already passed.", 400);

  let reference = newReference();
  for (let i = 0; i < 5; i++) {
    const { data } = await admin.from("proposals").select("id").eq("reference", reference).maybeSingle();
    if (!data) break;
    reference = newReference();
  }
  const row = {
    reference,
    access_key: randomHex(20),
    guest_name: name,
    guest_email: email,
    guest_phone: String(p.guest_phone ?? "").trim() || null,
    nationality: String(p.nationality ?? "").trim() || null,
    preferred_area: String(p.preferred_area ?? "").trim() || null,
    items,
    total_pence: items.reduce((s, it) => s + it.price_pence, 0),
    first_date: items[0].date,
    last_date: items[items.length - 1].date,
    director_note: String(p.director_note ?? "").slice(0, 1000) || null,
  };
  const { data: saved, error } = await admin.from("proposals").insert(row).select("*").single();
  if (error) return fail("db_error", "The proposal could not be saved: " + error.message, 500);

  let emailed = true;
  if (body.send !== false) {
    try { await emailProposal(saved); } catch (e) { emailed = false; console.error(String(e)); }
  }
  return json({ ok: true, proposal: saved, link: guestLink(saved), emailed });
}

async function dById(id: unknown): Promise<Row | null> {
  const { data } = await admin.from("proposals").select("*").eq("id", String(id ?? "")).maybeSingle();
  return data;
}

async function sendRefund(p: Row, amount: number, by: "guest" | "bhh") {
  const update: Row = { cancelled_by: by, refund_due_pence: amount };
  if (amount > 0) {
    const refund = await stripe("refunds", {
      payment_intent: String(p.stripe_payment_intent),
      amount: String(amount),
      "metadata[reference]": String(p.reference),
      reason: "requested_by_customer",
    }, `refund-${p.id}`);
    Object.assign(update, { status: "refunded", refund_pence: amount, stripe_refund_id: refund.id, refunded_at: new Date().toISOString() });
  } else {
    Object.assign(update, { status: "cancelled", refund_pence: 0 });
  }
  await admin.from("proposals").update(update).eq("id", p.id);

  const opening = by === "bhh"
    ? `We are very sorry: we have had to cancel booking ${esc(p.reference)}. As our Terms promise when we cancel, you receive a full refund of <strong>${pounds(amount)}</strong>.`
    : amount > 0
      ? `Your booking ${esc(p.reference)} is cancelled and a refund of <strong>${pounds(amount)}</strong> has been sent to the card you paid with.`
      : `Your booking ${esc(p.reference)} is cancelled. Under clause 3 of our Terms of Service no refund is due, because the cancellation was less than 7 days before the experience.`;
  try {
    await sendEmail(String(p.guest_email), `Booking ${p.reference} cancelled`, `<p>Dear ${esc(p.guest_name)},</p><p>${opening}</p>${amount > 0 ? "<p>Refunds usually reach the card within 5 to 10 working days.</p>" : ""}`);
  } catch (e) { console.error(String(e)); }
}

async function directorAction(action: string, body: Row) {
  if (!(await directorSession(body.session))) return fail("no_session", "Please sign in again.", 401);

  if (action === "d_signout") {
    await admin.from("director_sessions").delete().eq("token", String(body.session));
    return json({ ok: true });
  }
  if (action === "d_list") {
    const { data } = await admin.from("proposals").select("*").order("created_at", { ascending: false }).limit(200);
    const list = (data ?? []).map((p) => ({ ...p, link: guestLink(p), cancel_preview: p.status === "paid" ? refundFor(p.items as Item[], "guest") : null }));
    const { data: qs } = await admin.from("faq_questions").select("*").neq("status", "hidden").order("created_at", { ascending: false }).limit(100);
    return json({ ok: true, proposals: list, questions: qs ?? [], settings: await settings(), sellable: SELLABLE, today: londonToday() });
  }
  if (action === "d_create") return await dCreate(body);
  if (action === "d_question") {
    const status = String(body.status ?? "");
    if (!["new", "answered", "hidden"].includes(status)) return fail("bad_status", "Unknown status.", 400);
    await admin.from("faq_questions").update({ status }).eq("id", String(body.id ?? ""));
    return json({ ok: true });
  }

  if (action === "d_settings") {
    if (body.min_lead_days !== undefined) {
      const n = Math.max(0, Math.min(365, Math.round(Number(body.min_lead_days))));
      await admin.from("booking_settings").upsert({ key: "min_lead_days", value: String(n), updated_at: new Date().toISOString() });
    }
    if (validDate(body.block)) await admin.from("unavailable_dates").upsert({ day: body.block, note: String(body.note ?? "").slice(0, 200) || null });
    if (validDate(body.unblock)) await admin.from("unavailable_dates").delete().eq("day", body.unblock);
    return json({ ok: true, settings: await settings() });
  }

  const p = await dById(body.id);
  if (!p) return fail("not_found", "Proposal not found.", 404);

  if (action === "d_resend") {
    if (p.status !== "sent") return fail("bad_state", "Only an unpaid proposal can be resent.", 409);
    await emailProposal(p);
    return json({ ok: true });
  }
  if (action === "d_withdraw") {
    if (p.status !== "sent") return fail("bad_state", "Only an unpaid proposal can be withdrawn.", 409);
    await admin.from("proposals").update({ status: "withdrawn" }).eq("id", p.id);
    return json({ ok: true });
  }
  if (action === "d_refund") {
    if (p.status !== "cancel_requested") return fail("bad_state", "There is no cancellation request on this booking.", 409);
    // Worked out again from the day the guest asked, never from today, so a
    // delay in approving never reduces what the guest is owed.
    const asked = String(p.cancel_requested_at ?? "").slice(0, 10) || londonToday();
    const amount = refundFor(p.items as Item[], "guest", asked).total_pence;
    await sendRefund(p, amount, "guest");
    return json({ ok: true, refund_pence: amount });
  }
  if (action === "d_cancel") {
    if (p.status !== "paid" && p.status !== "cancel_requested") return fail("bad_state", "Only a paid booking can be cancelled by BHH.", 409);
    await sendRefund(p, Number(p.total_pence), "bhh");
    return json({ ok: true, refund_pence: p.total_pence });
  }
  return fail("bad_action", "That request is not understood.", 400);
}

// ------------------------------------------------------------ entry

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("bad_method", "Use POST.", 405);

  try {
    if (req.headers.get("stripe-signature")) return await handleWebhook(req);

    let body: Row;
    try { body = await req.json(); } catch (_e) { return fail("bad_body", "The request could not be read.", 400); }
    const action = String(body.action ?? "");

    if (action === "settings") return json({ ok: true, ...(await settings()) });
    if (action === "view") return await actionView(body);
    if (action === "checkout") return await actionCheckout(body);
    if (action === "cancel") return await actionCancel(body);
    if (action === "letter") return await actionLetter(body);
    if (action === "ask") return await actionAsk(body);
    if (action === "d_start") return await dStart();
    if (action === "d_verify") return await dVerify(body);
    if (action.startsWith("d_")) return await directorAction(action, body);
    return fail("bad_action", "That request is not understood.", 400);
  } catch (e) {
    console.error("payments function failed", String(e));
    return fail("server_error", "Something went wrong. Please try again shortly.", 500);
  }
});
