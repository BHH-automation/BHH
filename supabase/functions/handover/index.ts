// British Heritage Hosts - venue handover Edge Function
// Deno runtime. Uses the service role key only. Never import or use the anon key here.
//
// Actions (POST JSON, or GET ?action=load&token=...):
//   load       { token }
//   send_code  { token, stage }
//   sign       { token, stage, code, checks, photos[], signature, lat, lng, comments }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";

const BUCKET = "handovers";
const FROM_EMAIL = "enquiries@britishheritagehosts.com";
const OFFICE_EMAIL = "info@britishheritagehosts.com";
const OTP_MINUTES = 10;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function fail(code: string, message: string, status: number): Response {
  return json({ ok: false, error: code, message }, status);
}

// ---------------------------------------------------------------- helpers

function stripDataUrl(value: string): string {
  const comma = value.indexOf(",");
  return value.startsWith("data:") && comma > -1 ? value.slice(comma + 1) : value;
}

function base64ToBytes(value: string): Uint8Array {
  const clean = stripDataUrl(value).replace(/\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function sixDigitCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1000000).padStart(6, "0");
}

function isValidToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9._~-]{48}$/.test(token);
}

function daysInPast(bookingDate: string): number {
  const event = Date.parse(`${String(bookingDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(event)) return 0;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - event) / 86400000);
}

function humanDate(value: string): string {
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(value ?? "");
  return d.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

const CHECK_LABELS: Record<string, string> = {
  grassAndGround: "Grass and ground",
  fencesAndFixtures: "Fences and fixtures",
  toilets: "Toilets",
  bins: "Bins",
  existingDamage: "Existing damage note",
  grillRemoved: "Grill extinguished and removed",
  ashRemoved: "Ash removed",
  tablesRemoved: "Tables and tableware removed",
  wasteRemoved: "Waste removed",
  areaSwept: "Area swept",
  noBurnMarks: "No burn marks or grease",
  toiletsClean: "Toilets clean",
  gatesAndDoors: "Gates and doors as found",
  signedBy: "Signed by",
};

function checkLabel(key: string): string {
  if (CHECK_LABELS[key]) return CHECK_LABELS[key];
  const spaced = key.replace(/([A-Z])/g, " $1").replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ---------------------------------------------------------------- data access

async function loadByToken(token: string) {
  const { data: handover, error } = await admin
    .from("handovers")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error(`handover lookup failed: ${error.message}`);
  if (!handover) return null;

  const { data: booking } = await admin
    .from("bookings")
    .select("*")
    .eq("booking_id", handover.booking_id)
    .maybeSingle();
  if (!booking) return null;

  const { data: venue } = booking.venue_id
    ? await admin.from("venues").select("*").eq("id", booking.venue_id).maybeSingle()
    : { data: null };
  const { data: cook } = booking.cook_id
    ? await admin.from("cooks").select("*").eq("id", booking.cook_id).maybeSingle()
    : { data: null };

  return { handover, booking, venue, cook };
}

// ---------------------------------------------------------------- outbound

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

async function sendEmail(to: string[], subject: string, html: string, pdfBase64: string, filename: string) {
  if (!RESEND_API_KEY) throw new Error("Resend is not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `British Heritage Hosts <${FROM_EMAIL}>`,
      to,
      subject,
      html,
      attachments: [{ filename, content: pdfBase64 }],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${text}`);
  return text;
}

// ---------------------------------------------------------------- storage

async function uploadBytes(path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`upload ${path} failed: ${error.message}`);
  return path;
}

async function downloadBytes(path: string): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

// ---------------------------------------------------------------- pdf

const NAVY = rgb(0.05, 0.106, 0.165);
const GOLD = rgb(0.788, 0.658, 0.298);
const GREY = rgb(0.35, 0.35, 0.35);

async function buildPdf(ctx: {
  handover: Record<string, unknown>;
  booking: Record<string, unknown>;
  venue: Record<string, unknown> | null;
  cook: Record<string, unknown> | null;
}): Promise<Uint8Array> {
  const { handover, booking, venue, cook } = ctx;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const left = 42;
  const right = 595.28 - 42;
  let y = 800;

  const draw = (text: string, size: number, font = regular, color = NAVY, x = left) => {
    page.drawText(text, { x, y, size, font, color });
  };

  const wrap = (text: string, size: number, maxWidth: number, font = regular): string[] => {
    const words = String(text ?? "").split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const attempt = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(attempt, size) > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = attempt;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : ["-"];
  };

  const rule = (color = GOLD) => {
    page.drawRectangle({ x: left, y, width: right - left, height: 1, color });
    y -= 12;
  };

  const heading = (text: string) => {
    y -= 6;
    draw(text.toUpperCase(), 9.5, bold, GOLD);
    y -= 10;
    rule(rgb(0.85, 0.85, 0.85));
  };

  const row = (label: string, value: string) => {
    draw(label, 8.5, bold, GREY);
    const lines = wrap(value || "-", 9.5, right - left - 150, regular);
    page.drawText(lines[0], { x: left + 150, y, size: 9.5, font: regular, color: NAVY });
    y -= 12;
    for (const extra of lines.slice(1)) {
      page.drawText(extra, { x: left + 150, y, size: 9.5, font: regular, color: NAVY });
      y -= 12;
    }
  };

  const checkBlock = (checks: unknown) => {
    const obj = (checks && typeof checks === "object" ? checks : {}) as Record<string, any>;
    const keys = Object.keys(obj);
    if (!keys.length) {
      draw("No checks recorded", 9, regular, GREY);
      y -= 12;
      return;
    }
    for (const key of keys) {
      const entry = obj[key] ?? {};
      const rating = typeof entry === "string" ? entry : (entry.rating ?? entry.value ?? "-");
      const note = typeof entry === "string" ? "" : (entry.note ?? "");
      draw(`${checkLabel(key)}`, 9, regular, NAVY);
      page.drawText(String(rating), { x: left + 230, y, size: 9, font: bold, color: NAVY });
      y -= 11;
      if (note) {
        for (const line of wrap(String(note), 8, right - left - 20, regular).slice(0, 2)) {
          page.drawText(line, { x: left + 12, y, size: 8, font: regular, color: GREY });
          y -= 10;
        }
      }
    }
    y -= 4;
  };

  // header band
  page.drawRectangle({ x: 0, y: 782, width: 595.28, height: 60, color: NAVY });
  page.drawText("BRITISH HERITAGE HOSTS", { x: left, y: 812, size: 15, font: bold, color: GOLD });
  page.drawText("Venue handover record", { x: left, y: 794, size: 10, font: regular, color: rgb(1, 1, 1) });
  y = 762;

  heading("Booking");
  row("Booking reference", String(booking.booking_id ?? ""));
  row("Event date", humanDate(String(booking.booking_date ?? "")));
  row("Event time", String(booking.booking_time ?? "-"));
  row("Guest name", String(booking.guest_name ?? "-"));
  row(
    "Guest count",
    `${booking.guest_count_adults ?? 0} adults, ${booking.guest_count_children ?? 0} children`,
  );

  heading("Venue and people");
  row("Venue", `${venue?.name ?? "-"}`);
  row("Address", `${venue?.address ?? "-"}`);
  row("Venue representative", `${venue?.rep_name ?? "-"}`);
  row("Representative mobile", `${handover.rep_verified_mobile ?? venue?.rep_mobile ?? "-"}`);
  row("Cook", `${cook?.name ?? "-"}`);

  heading("Arrival");
  row("Signed at", handover.arrival_time ? new Date(String(handover.arrival_time)).toUTCString() : "-");
  row("GPS", handover.arrival_lat != null ? `${handover.arrival_lat}, ${handover.arrival_lng}` : "not captured");
  checkBlock(handover.arrival_checks);

  heading("Departure");
  row("Signed at", handover.departure_time ? new Date(String(handover.departure_time)).toUTCString() : "-");
  row("GPS", handover.departure_lat != null ? `${handover.departure_lat}, ${handover.departure_lng}` : "not captured");
  checkBlock(handover.departure_checks);

  heading("Comments");
  for (const line of wrap(String(handover.comments || "None recorded"), 9, right - left, regular).slice(0, 4)) {
    draw(line, 9, regular, NAVY);
    y -= 11;
  }

  // signatures
  y -= 6;
  heading("Signatures");
  const sigTop = Math.max(y, 152);
  const boxW = (right - left - 20) / 2;
  const boxH = 70;
  const embedSig = async (path: unknown, x: number, caption: string) => {
    page.drawRectangle({
      x, y: sigTop - boxH, width: boxW, height: boxH,
      borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1,
    });
    page.drawText(caption, { x, y: sigTop - boxH - 12, size: 8, font: bold, color: GREY });
    if (typeof path !== "string" || !path) return;
    const bytes = await downloadBytes(path);
    if (!bytes) return;
    try {
      const img = await pdf.embedPng(bytes);
      const scale = Math.min((boxW - 12) / img.width, (boxH - 12) / img.height);
      page.drawImage(img, {
        x: x + 6,
        y: sigTop - boxH + 6,
        width: img.width * scale,
        height: img.height * scale,
      });
    } catch (_) { /* signature not embeddable, leave the box empty */ }
  };
  await embedSig(handover.arrival_signature, left, "Arrival signature");
  await embedSig(handover.departure_signature, left + boxW + 20, "Departure signature");
  y = sigTop - boxH - 28;

  // footer
  page.drawRectangle({ x: left, y: 52, width: right - left, height: 1, color: GOLD });
  page.drawText(
    `Handover id ${handover.id ?? "-"}`,
    { x: left, y: 40, size: 7.5, font: regular, color: GREY },
  );
  page.drawText(
    `Generated ${new Date().toISOString()}`,
    { x: left, y: 30, size: 7.5, font: regular, color: GREY },
  );
  page.drawText(
    "British Heritage Hosts",
    { x: right - regular.widthOfTextAtSize("British Heritage Hosts", 7.5), y: 30, size: 7.5, font: regular, color: GREY },
  );

  return await pdf.save();
}

// ---------------------------------------------------------------- actions

async function actionLoad(token: string): Promise<Response> {
  const found = await loadByToken(token);
  if (!found) return fail("not_found", "This handover link is not recognised.", 404);
  const { handover, booking, venue, cook } = found;

  if (handover.status === "departure_signed") {
    return fail("completed", "This handover has already been signed off and sealed.", 409);
  }
  if (daysInPast(String(booking.booking_date)) > 1) {
    return fail("expired", "This handover link has expired. Please contact the office.", 410);
  }

  return json({
    ok: true,
    status: handover.status,
    handover: {
      id: handover.id,
      status: handover.status,
      arrival_time: handover.arrival_time,
      departure_time: handover.departure_time,
    },
    booking: {
      booking_id: booking.booking_id,
      guest_name: booking.guest_name,
      booking_date: booking.booking_date,
      booking_time: booking.booking_time,
      guest_count_adults: booking.guest_count_adults,
      guest_count_children: booking.guest_count_children,
      status: booking.status,
    },
    venue: venue
      ? { name: venue.name, address: venue.address, rep_name: venue.rep_name, rep_mobile: maskMobile(venue.rep_mobile) }
      : null,
    cook: cook ? { name: cook.name } : null,
  });
}

function maskMobile(mobile: unknown): string {
  const s = String(mobile ?? "");
  if (s.length < 4) return s;
  return `${"•".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

async function actionSendCode(token: string, stage: string): Promise<Response> {
  if (stage !== "arrival" && stage !== "departure") {
    return fail("bad_stage", "Stage must be arrival or departure.", 400);
  }
  const found = await loadByToken(token);
  if (!found) return fail("not_found", "This handover link is not recognised.", 404);
  const { handover, booking, venue } = found;

  if (handover.status === "departure_signed") {
    return fail("completed", "This handover has already been signed off and sealed.", 409);
  }
  if (daysInPast(String(booking.booking_date)) > 1) {
    return fail("expired", "This handover link has expired. Please contact the office.", 410);
  }
  if (stage === "arrival" && handover.status !== "issued") {
    return fail("bad_stage", "Arrival has already been signed.", 409);
  }
  if (stage === "departure" && handover.status !== "arrival_signed") {
    return fail("bad_stage", "Please complete the arrival handover first.", 409);
  }
  const mobile = String(venue?.rep_mobile ?? "").trim();
  if (!mobile) {
    return fail("no_mobile", "No mobile number is on file for the venue representative.", 400);
  }

  const code = sixDigitCode();
  const expires = new Date(Date.now() + OTP_MINUTES * 60000).toISOString();
  const { error: insertError } = await admin.from("otp_codes").insert({
    handover_id: handover.id,
    stage,
    code,
    expires_at: expires,
    used: false,
  });
  if (insertError) return fail("db_error", `Could not store the code: ${insertError.message}`, 500);

  try {
    await sendSms(
      mobile,
      `British Heritage Hosts: your venue handover code is ${code}. Valid 10 minutes.`,
    );
  } catch (e) {
    return fail("sms_failed", `We could not send the text message. ${String((e as Error).message)}`, 502);
  }

  return json({ ok: true, sent_to: maskMobile(mobile), expires_at: expires });
}

async function actionSign(payload: Record<string, any>): Promise<Response> {
  const token = payload.token;
  const stage = payload.stage;
  if (stage !== "arrival" && stage !== "departure") {
    return fail("bad_stage", "Stage must be arrival or departure.", 400);
  }
  const code = String(payload.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) return fail("bad_code", "Enter the 6 digit code from the text message.", 400);
  const signature = payload.signature;
  if (typeof signature !== "string" || !signature) {
    return fail("no_signature", "A signature is required.", 400);
  }

  const found = await loadByToken(token);
  if (!found) return fail("not_found", "This handover link is not recognised.", 404);
  const { handover, booking, venue, cook } = found;

  if (handover.status === "departure_signed") {
    return fail("completed", "This handover has already been signed off and sealed.", 409);
  }
  if (daysInPast(String(booking.booking_date)) > 1) {
    return fail("expired", "This handover link has expired. Please contact the office.", 410);
  }
  if (stage === "arrival" && handover.status !== "issued") {
    return fail("bad_stage", "Arrival has already been signed.", 409);
  }
  if (stage === "departure" && handover.status !== "arrival_signed") {
    return fail("bad_stage", "Please complete the arrival handover first.", 409);
  }

  // verify the one time code
  const { data: otp, error: otpError } = await admin
    .from("otp_codes")
    .select("*")
    .eq("handover_id", handover.id)
    .eq("stage", stage)
    .eq("code", code)
    .eq("used", false)
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (otpError) return fail("db_error", `Could not check the code: ${otpError.message}`, 500);
  if (!otp) return fail("bad_code", "That code is not valid or has expired. Please request a new one.", 401);

  const { error: usedError } = await admin.from("otp_codes").update({ used: true }).eq("id", otp.id);
  if (usedError) return fail("db_error", `Could not consume the code: ${usedError.message}`, 500);

  // uploads
  const photos: string[] = Array.isArray(payload.photos) ? payload.photos : [];
  const photoPaths: string[] = [];
  try {
    let index = 1;
    for (const photo of photos) {
      if (typeof photo !== "string" || !photo) continue;
      const path = `${token}/${stage}/photo${index}.jpg`;
      await uploadBytes(path, base64ToBytes(photo), "image/jpeg");
      photoPaths.push(path);
      index++;
    }
  } catch (e) {
    return fail("upload_failed", `A photo could not be saved. ${String((e as Error).message)}`, 502);
  }

  let signaturePath = "";
  try {
    signaturePath = `${token}/${stage}/signature.png`;
    await uploadBytes(signaturePath, base64ToBytes(signature), "image/png");
  } catch (e) {
    return fail("upload_failed", `The signature could not be saved. ${String((e as Error).message)}`, 502);
  }

  const nowIso = new Date().toISOString();
  const lat = payload.lat == null ? null : Number(payload.lat);
  const lng = payload.lng == null ? null : Number(payload.lng);
  const update: Record<string, unknown> = {
    rep_verified_mobile: venue?.rep_mobile ?? null,
  };
  if (typeof payload.comments === "string" && payload.comments.trim()) {
    update.comments = payload.comments.trim();
  }

  if (stage === "arrival") {
    update.arrival_time = nowIso;
    update.arrival_checks = payload.checks ?? {};
    update.arrival_photos = photoPaths;
    update.arrival_signature = signaturePath;
    update.arrival_lat = Number.isFinite(lat as number) ? lat : null;
    update.arrival_lng = Number.isFinite(lng as number) ? lng : null;
    update.status = "arrival_signed";
  } else {
    update.departure_time = nowIso;
    update.departure_checks = payload.checks ?? {};
    update.departure_photos = photoPaths;
    update.departure_signature = signaturePath;
    update.departure_lat = Number.isFinite(lat as number) ? lat : null;
    update.departure_lng = Number.isFinite(lng as number) ? lng : null;
    update.status = "departure_signed";
  }

  const { data: saved, error: saveError } = await admin
    .from("handovers")
    .update(update)
    .eq("id", handover.id)
    .select("*")
    .maybeSingle();
  if (saveError) return fail("db_error", `Could not save the handover: ${saveError.message}`, 500);

  if (stage === "arrival") {
    return json({ ok: true, status: "arrival_signed", arrival_time: nowIso, photos: photoPaths.length });
  }

  // departure: build, store and email the record
  const result: Record<string, unknown> = {
    ok: true,
    status: "departure_signed",
    departure_time: nowIso,
    photos: photoPaths.length,
  };

  let pdfBytes: Uint8Array | null = null;
  try {
    pdfBytes = await buildPdf({
      handover: saved ?? { ...handover, ...update },
      booking,
      venue,
      cook,
    });
    const pdfPath = `${token}/handover.pdf`;
    await uploadBytes(pdfPath, pdfBytes, "application/pdf");
    await admin.from("handovers").update({ pdf_url: pdfPath }).eq("id", handover.id);
    result.pdf_url = pdfPath;
  } catch (e) {
    result.pdf_error = String((e as Error).message);
  }

  if (pdfBytes) {
    const recipients = [venue?.rep_email, cook?.email, OFFICE_EMAIL]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter((v) => v.length > 0);
    const unique = Array.from(new Set(recipients));
    const venueName = String(venue?.name ?? "venue");
    const dateText = humanDate(String(booking.booking_date ?? ""));
    try {
      await sendEmail(
        unique,
        `Venue handover record, ${venueName}, ${dateText}`,
        `<div style="font-family:Georgia,serif;color:#0D1B2A">
           <h2 style="color:#0D1B2A;margin:0 0 8px">British Heritage Hosts</h2>
           <p>The venue handover for <strong>${venueName}</strong> on <strong>${dateText}</strong> has been completed and signed.</p>
           <p>Booking reference ${booking.booking_id}. The signed record is attached as a PDF.</p>
           <p style="color:#6b6b6b;font-size:12px">This message was sent automatically. Please do not reply.</p>
         </div>`,
        bytesToBase64(pdfBytes),
        "handover.pdf",
      );
      result.emailed_to = unique;
    } catch (e) {
      result.email_error = String((e as Error).message);
    }
  }

  return json(result);
}

// ---------------------------------------------------------------- entry

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    let payload: Record<string, any> = {};
    if (req.method === "GET") {
      const url = new URL(req.url);
      payload = Object.fromEntries(url.searchParams.entries());
    } else if (req.method === "POST") {
      payload = await req.json().catch(() => ({}));
    } else {
      return fail("bad_method", "Use GET or POST.", 405);
    }

    const action = String(payload.action ?? "load");
    const token = payload.token;
    if (!isValidToken(token)) {
      return fail("bad_token", "This handover link is not recognised.", 404);
    }

    if (action === "load") return await actionLoad(token);
    if (action === "send_code") return await actionSendCode(token, String(payload.stage ?? ""));
    if (action === "sign") return await actionSign(payload);
    return fail("bad_action", `Unknown action ${action}.`, 400);
  } catch (e) {
    console.error(e);
    return fail("server_error", "Something went wrong. Please try again.", 500);
  }
});
