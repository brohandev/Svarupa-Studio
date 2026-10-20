// Cloudflare Worker for Svarupa Studio.
//
// The site itself is served as static assets (see wrangler.jsonc). This script only runs for requests that don't
// match a static file, which is how the /api/ routes reach it:
//
//   GET  /api/turnstile-config  -> the public Turnstile site key, so the page can render the human check.
//   POST /api/enquiry           -> verifies Turnstile, validates the commission form, and emails it to the artist
//                                  through Cloudflare Email Routing.
//
// Settings (Cloudflare dashboard > Workers & Pages > this Worker > Settings > Variables and Secrets, type "Secret";
// for local testing with `npx wrangler dev`, put them in a git-ignored .dev.vars file):
//   ARTIST_EMAIL          where enquiries are delivered; must be a verified Email Routing destination address.
//   SENDER_EMAIL          the From address, e.g. enquiries@yourdomain.com; must be on the domain using Email Routing.
//   TURNSTILE_SITE_KEY    public key of the Turnstile widget.
//   TURNSTILE_SECRET_KEY  secret key of the same widget.

import { EmailMessage } from "cloudflare:email";

const LIMITS = { name: 100, email: 254, phone: 30, commissionSubject: 200, dimensions: 60, medium: 60, budget: 60, notes: 2000 };
const PRIVATE_COMMISSION = "Private commission";
const MAX_SUBJECTS = 50;
const MAX_SUBJECT_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

function field(form, name) {
  return String(form.get(name) || "").trim();
}

// Collapses line breaks and runs of whitespace; used for single-line values so they can't inject email headers.
function singleLine(value) {
  return value.replace(/\s+/g, " ").trim();
}

function validateEnquiry(form) {
  const enquiry = {
    name: singleLine(field(form, "name")),
    email: singleLine(field(form, "email")),
    phone: singleLine(field(form, "phone")),
    // "subject" is the artwork multi-select, so it can arrive several times; empty and duplicate picks are dropped.
    subjects: [...new Set(form.getAll("subject").map((value) => singleLine(String(value))).filter(Boolean))],
    commissionSubject: singleLine(field(form, "commission_subject")),
    dimensions: singleLine(field(form, "dimensions")),
    medium: singleLine(field(form, "medium")),
    budget: singleLine(field(form, "budget")),
    notes: field(form, "notes").replace(/\r\n?/g, "\n"),
  };

  for (const required of ["name", "phone", "dimensions", "medium", "budget"]) {
    if (!enquiry[required]) return { error: "Please fill in every required field." };
  }
  if (enquiry.subjects.length === 0) {
    return { error: "Please choose at least one artwork, or Private commission." };
  }
  if (enquiry.subjects.length > MAX_SUBJECTS || enquiry.subjects.some((subject) => subject.length > MAX_SUBJECT_LENGTH)) {
    return { error: "One of the fields is too long. Please shorten it and try again." };
  }
  const wantsCommission = enquiry.subjects.includes(PRIVATE_COMMISSION);
  if (wantsCommission && !enquiry.commissionSubject) {
    return { error: "Please tell us the scene, figure or teaching you would like painted." };
  }
  if (!wantsCommission) enquiry.commissionSubject = "";
  for (const [key, max] of Object.entries(LIMITS)) {
    if (enquiry[key].length > max) return { error: "One of the fields is too long. Please shorten it and try again." };
  }

  const phoneDigits = enquiry.phone.replace(/\D/g, "");
  if (!/^\+[\d\s\-().]+$/.test(enquiry.phone) || phoneDigits.length < 8 || phoneDigits.length > 15) {
    return { error: "Please enter your phone number with its country code, for example +65 8123 4567." };
  }
  if (enquiry.email && !EMAIL_PATTERN.test(enquiry.email)) {
    return { error: "Please check your email address, or leave it blank." };
  }
  return { enquiry };
}

async function verifyTurnstile(token, request, env) {
  if (!token) return false;
  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET_KEY);
  body.set("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) body.set("remoteip", ip);
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const outcome = await result.json().catch(() => ({}));
  return outcome.success === true;
}

// --- Plain-text email (RFC 5322) -------------------------------------------------------------------------------

function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Header values may contain non-ASCII text (e.g. names with accents), so they are sent as encoded words.
function encodeHeader(text) {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${base64Utf8(text)}?=`;
}

function buildEmail({ from, to, replyTo, subject, text }) {
  const domain = from.split("@")[1];
  const headers = [
    `From: ${encodeHeader("Svarupa Studio website")} <${from}>`,
    `To: <${to}>`,
    replyTo ? `Reply-To: <${replyTo}>` : null,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  const body = base64Utf8(text.replace(/\r?\n/g, "\r\n")).replace(/.{1,76}/g, "$&\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

// e.g. "Artwork enquiry: Krishna's Counsel +1 more & private commission" or "Commission enquiry: Ganga at dawn".
function enquirySubjectLine(enquiry) {
  const artworks = enquiry.subjects.filter((subject) => subject !== PRIVATE_COMMISSION);
  if (artworks.length === 0) return `Commission enquiry: ${enquiry.commissionSubject} (${enquiry.name})`;
  const more = artworks.length > 1 ? ` +${artworks.length - 1} more` : "";
  const commission = enquiry.commissionSubject ? " & private commission" : "";
  return `Artwork enquiry: ${artworks[0]}${more}${commission} (${enquiry.name})`;
}

function enquiryText(enquiry) {
  const sentAt = new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", dateStyle: "full", timeStyle: "short" });
  const interests = enquiry.subjects.map((subject) =>
    subject === PRIVATE_COMMISSION ? `  - Private commission: ${enquiry.commissionSubject}` : `  - ${subject}`);
  return [
    "New enquiry from the Svarupa Studio website.",
    "",
    `Name: ${enquiry.name}`,
    `Phone: ${enquiry.phone}`,
    `Email: ${enquiry.email || "Not provided"}`,
    "",
    "Enquiring about:",
    ...interests,
    "",
    `Approximate dimensions: ${enquiry.dimensions}`,
    `Preferred medium: ${enquiry.medium}`,
    `Budget: ${enquiry.budget}`,
    "",
    "What draws them to this story:",
    enquiry.notes || "(No notes given)",
    "",
    "The buyer has acknowledged that fulfilment is currently limited to Singapore.",
    `Sent ${sentAt} (Singapore time).`,
    enquiry.email ? "Reply to this email to answer the buyer directly." : "The buyer did not give an email address; please reply by phone.",
  ].join("\n");
}

// --- Routes ----------------------------------------------------------------------------------------------------

async function handleEnquiry(request, env) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  if (!env.ARTIST_EMAIL || !env.SENDER_EMAIL || !env.TURNSTILE_SECRET_KEY || !env.SEND_EMAIL) {
    return json({ ok: false, error: "Enquiries are temporarily unavailable. Please try again later." }, 503);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "Something went wrong reading your enquiry. Please try again." }, 400);
  }

  // Honeypot: the "company" field is hidden from people, so only bots fill it in. Pretend success and send nothing.
  if (field(form, "company")) return json({ ok: true });

  if (!(await verifyTurnstile(field(form, "cf-turnstile-response"), request, env))) {
    return json({ ok: false, error: "We couldn't confirm you're not a robot. Please complete the check and try again." }, 403);
  }

  const { enquiry, error } = validateEnquiry(form);
  if (error) return json({ ok: false, error }, 400);

  const raw = buildEmail({
    from: env.SENDER_EMAIL,
    to: env.ARTIST_EMAIL,
    replyTo: enquiry.email,
    subject: enquirySubjectLine(enquiry),
    text: enquiryText(enquiry),
  });

  try {
    await env.SEND_EMAIL.send(new EmailMessage(env.SENDER_EMAIL, env.ARTIST_EMAIL, raw));
  } catch (sendError) {
    console.error("Enquiry email failed:", sendError);
    return json({ ok: false, error: "Your enquiry couldn't be sent just now. Please try again in a few minutes." }, 502);
  }
  return json({ ok: true });
}

function handleTurnstileConfig(env) {
  return json({ siteKey: env.TURNSTILE_SITE_KEY || null });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/enquiry") return handleEnquiry(request, env);
    if (pathname === "/api/turnstile-config") return handleTurnstileConfig(env);
    return env.ASSETS.fetch(request);
  },
};
