// Email from the site (LOR-640): one small sender any feature can use. The first use is the thank-you to a new Willo
// subscriber (lib/thanks.js); a contributor's outcome email (LOR-632) would be the next. sendOnce sends a message at
// most once per id (a D1 row claims it before anything goes out), so Stripe's retries and events that arrive together
// never send it twice.
//
// The service is Cloudflare Email Sending on Mike's account (Operations, 2026-10-17), set up for loreforeverwow.com.
// The domain's DMARC is p=reject, so mail goes out only From an @loreforeverwow.com address (senderOf refuses any
// other) and only through Cloudflare; Resend and Postmark stay as fallbacks behind the same interface, unused.
// Pages settings (Settings > Variables and Secrets). The service is the first one set, in this order:
//   EMAIL                    a send_email binding (Cloudflare's Workers API). Pages offers no such binding today; kept
//                            for a Worker, or for the day Pages does
//   CLOUDFLARE_EMAIL_TOKEN   an API token that may send email (secret), with CLOUDFLARE_ACCOUNT_ID (Mike's account id,
//                            plain text): Cloudflare's REST API. This is how the site sends today
//   RESEND_API_KEY           Resend's API key (re_...); fallback only
//   POSTMARK_SERVER_TOKEN    Postmark's server API token; fallback only
//   EMAIL_FROM               optional: who it's from (default FROM); only an @loreforeverwow.com address is used
//   EMAIL_REPLY_TO           optional: where replies go (default REPLY_TO, which forwards to Mike's Gmail)
//   EMAIL_POSTAL_ADDRESS     optional: a mailing address for the footer
// With none of the services set, email is off (the flag for a missing key): sendOnce logs "would send", records it,
// and nothing goes out. A feature can also hold its emails back on its own (sendOnce's `off`).
//
// /unsubscribe (functions/api/unsubscribe.js) keeps a one-way hash of the address in email_optouts (optOut), and
// sendOnce never sends to an address there, so "That address won't get any more emails from us" stays true. Kept
// outside functions/ so Pages doesn't route it.

import { isReportRead, refuseReportEffect } from "./report-read.js";
import { markActionUncertain, actionIsUncertain, isDashboardAction } from "./dashboard-action.js";
import { createMissing } from "./schema.js";

export const DOMAIN = "loreforeverwow.com";
export const FROM = `Mike from Lore Forever <hello@${DOMAIN}>`;
export const REPLY_TO = `hello@${DOMAIN}`;   // Email Routing forwards it to Mike's Gmail
export const UNSUBSCRIBE_URL = `https://${DOMAIN}/unsubscribe`;
const TIMEOUT_MS = 5000;   // the webhook waits for the send, so a slow service never holds it long

// email_sends: one row per email sendOnce claimed (id: the feature's own key, like "thanks:<user id>"), never the
// address or the text. status: sending (claimed, on its way), sent, off (no service set up, or the feature held it
// back: logged "would send"), opted_out or no_address. A failed send drops its row, so the next try sends. Delete my
// account removes the rows (EMAIL_USER_DATA, lib/accounts.js). email_optouts: addresses that unsubscribed, as SHA-256
// hashes.
export const EMAIL_SETUP = [
  `CREATE TABLE IF NOT EXISTS email_sends (id TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id TEXT, status TEXT NOT NULL,
    provider TEXT, message_id TEXT, created TEXT NOT NULL, updated TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS email_sends_user ON email_sends (user_id)",
  "CREATE TABLE IF NOT EXISTS email_optouts (hash TEXT PRIMARY KEY, created TEXT NOT NULL)",
];
export const EMAIL_USER_DATA = [["DELETE FROM email_sends WHERE user_id = ?", u => u.id]];

const ready = new WeakSet();
async function setupEmail(env) {
  if (isReportRead(env)) return;
  if (ready.has(env.DB)) return;
  await createMissing(env, EMAIL_SETUP);
  ready.add(env.DB);
}

const iso = () => new Date().toISOString();
const ADDRESS = /^[^\s@<>]{1,64}@[^\s@<>.]+(\.[^\s@<>.]+)+$/;
// An address as typed, trimmed and lowercased, or "" when it can't be one.
export const cleanAddress = raw => {
  const email = String(raw ?? "").trim().toLowerCase();
  return email.length <= 254 && ADDRESS.test(email) ? email : "";
};
const hashOf = async email => [...new Uint8Array(await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(`lore-forever-optout:${email}`)))].map(b => b.toString(16).padStart(2, "0")).join("");

// "Name <address>" as {name, email}.
function parseFrom(from) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1].replace(/^"|"$/g, ""), email: m[2].trim() } : { email: from.trim() };
}

// The services: each sends {from, to, subject, text, html, replyTo, headers} and returns the service's message id
// (null when it gives none), or throws.
async function post(url, headers, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json",
    ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.success === false) {
    const why = data?.errors?.map?.(e => `${e.code}: ${e.message}`).join("; ") || data?.message || data?.Message ||
      data?.name || "no details";
    throw new Error(`HTTP ${res.status}: ${why}`);
  }
  return data;
}
const SERVICES = {
  // https://developers.cloudflare.com/email-service/api/send-emails/workers-api/ (Reply-To is its own field: as a
  // header it's refused, E_HEADER_USE_API_FIELD; List-Unsubscribe is allowed with an https address).
  cloudflare: async (env, m) => (await env.EMAIL.send({ from: parseFrom(m.from), to: m.to, subject: m.subject,
    text: m.text, html: m.html, headers: m.headers, ...(m.replyTo ? { replyTo: m.replyTo } : {}) }))?.messageId ?? null,
  // https://developers.cloudflare.com/api/resources/email_sending/methods/send: unlike the Workers API, a named sender
  // is {address, name}, `to` a list, and Reply-To is reply_to (anything else is invalid_request_schema). It answers
  // with what was delivered or queued, without a message id.
  "cloudflare-api": async (env, m) => {
    const { email: address, name } = parseFrom(m.from);
    await post(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}` +
      "/email/sending/send", { Authorization: `Bearer ${env.CLOUDFLARE_EMAIL_TOKEN}` },
      { from: name ? { address, name } : address, to: [m.to], subject: m.subject, text: m.text, html: m.html,
        headers: m.headers, ...(m.replyTo ? { reply_to: m.replyTo } : {}) });
    return null;
  },
  // https://resend.com/docs/api-reference/emails/send-email; its Idempotency-Key makes a repeat within 24 hours a no-op.
  resend: async (env, m, key) => (await post("https://api.resend.com/emails",
    { Authorization: `Bearer ${env.RESEND_API_KEY}`, ...(key ? { "Idempotency-Key": key } : {}) },
    { from: m.from, to: [m.to], subject: m.subject, text: m.text, html: m.html, headers: m.headers,
      ...(m.replyTo ? { reply_to: m.replyTo } : {}) }))?.id ?? null,
  // https://postmarkapp.com/developer/user-guide/send-email-with-api
  postmark: async (env, m) => {
    const data = await post("https://api.postmarkapp.com/email", { "X-Postmark-Server-Token": env.POSTMARK_SERVER_TOKEN },
      { From: m.from, To: m.to, Subject: m.subject, TextBody: m.text, HtmlBody: m.html, MessageStream: "outbound",
        Headers: Object.entries(m.headers || {}).map(([Name, Value]) => ({ Name, Value })),
        ...(m.replyTo ? { ReplyTo: m.replyTo } : {}) });
    if (data?.ErrorCode) throw new Error(`Postmark ${data.ErrorCode}: ${data.Message}`);
    return data?.MessageID ?? null;
  },
};

// The email service set up here ("cloudflare", "cloudflare-api", "resend" or "postmark"), or null: email is off.
export function emailService(env) {
  if (typeof env?.EMAIL?.send === "function") return "cloudflare";
  if (env?.CLOUDFLARE_EMAIL_TOKEN && env?.CLOUDFLARE_ACCOUNT_ID) return "cloudflare-api";
  if (env?.RESEND_API_KEY) return "resend";
  if (env?.POSTMARK_SERVER_TOKEN) return "postmark";
  return null;
}

// Who every email is from (EMAIL_FROM when it's an @loreforeverwow.com address, else FROM: the domain's DMARC rejects
// any other), where replies go (EMAIL_REPLY_TO, else REPLY_TO), and the footer's mailing address, if any.
export function senderOf(env) {
  const set = String(env?.EMAIL_FROM || "").trim();
  const ours = set && parseFrom(set).email.toLowerCase().endsWith(`@${DOMAIN}`);
  return { from: ours ? set : FROM, replyTo: cleanAddress(env?.EMAIL_REPLY_TO) || REPLY_TO,
           postal: String(env?.EMAIL_POSTAL_ADDRESS || "").trim() || null };
}

// Sends `message` ({to, subject, text, html, from?, replyTo?}) now, through the service set up here, with the sender's
// From and Reply-To (or the message's own, when they're @loreforeverwow.com addresses: a note from Patrick, lib/winback.js)
// and a List-Unsubscribe header to /unsubscribe: {service, messageId}. Throws when no service is set up or
// the send fails. key: an idempotency key, for services that take one. sendOnce is what features use; this is for
// tests by hand (/api/admin "email-test") and for sign-in codes (lib/email-signin.js), whose message says
// transactional: true, so it goes out without the List-Unsubscribe header (a sign-in code isn't news).
export async function sendEmail(env, message, key = null) {
  refuseReportEffect(env, "sending email");
  const service = emailService(env);
  if (!service) throw new Error("No email service is set up.");
  const to = cleanAddress(message.to);
  if (!to) throw new Error("That isn't an email address.");
  const sender = senderOf(env);
  const ours = address => typeof address === "string" && parseFrom(address).email.toLowerCase().endsWith(`@${DOMAIN}`);
  let messageId;
  try {
    const { transactional, ...rest } = message;
    messageId = await SERVICES[service](env, { ...rest, to, from: ours(message.from) ? message.from : sender.from,
      replyTo: ours(message.replyTo) ? cleanAddress(message.replyTo) : sender.replyTo,
      headers: { ...(transactional ? {} : { "List-Unsubscribe": `<${UNSUBSCRIBE_URL}>` }), ...message.headers } }, key);
  } catch (error) { markActionUncertain(env); throw error; }
  return { service, messageId };
}

// Sends `message` ({to, subject, text, html}) once ever for `id`, for the account userId (kind: what it is, for
// email_sends). off: the feature holds its emails back for now (only logged, like having no service). Never throws: a
// failure is logged, its claim dropped so a later call tries again, and "failed" returned. Otherwise the status:
// "sent", "off" (logged "would send"), "seen" (already claimed), "opted_out" or "no_address".
export async function sendOnce(env, { id, kind, userId = null, message, off = false }) {
  try {
    await setupEmail(env);
    const service = emailService(env), to = cleanAddress(message.to);
    const status = !to ? "no_address" : await optedOut(env, to) ? "opted_out" : service && !off ? "sending" : "off";
    const claimed = await env.DB.prepare("INSERT OR IGNORE INTO email_sends (id, kind, user_id, status, provider, " +
      "created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, kind, userId, status, service, iso(), iso()).run();
    if (!claimed.meta.changes) {
      if (isDashboardAction(env)) {
        // A new request key must not turn an unresolved prior send into success.
        // Keep the product claim and the new dashboard audit outcome uncertain.
        const previous = await env.DB.prepare("SELECT status FROM email_sends WHERE id = ?").bind(id).first()
          .catch(error => { markActionUncertain(env); throw error; });
        if (!["sent", "off", "opted_out", "no_address"].includes(previous?.status)) markActionUncertain(env);
      }
      return "seen";
    }
    if (status === "off") console.log(`email: would send ${kind} (${id}); ${service ? "held back" : "no email service is set up"}`);
    if (status !== "sending") return status;
    let accepted = false;
    try {
      const { messageId } = await sendEmail(env, message, id);
      accepted = true;
      await env.DB.prepare("UPDATE email_sends SET status = 'sent', message_id = ?, updated = ? WHERE id = ?")
        .bind(messageId ? String(messageId) : null, iso(), id).run();
      return "sent";
    } catch (e) {
      if (accepted) markActionUncertain(env);
      if (!actionIsUncertain(env)) await env.DB.prepare("DELETE FROM email_sends WHERE id = ? AND status = 'sending'").bind(id).run();
      throw e;
    }
  } catch (e) {
    console.warn(`email: ${kind} (${id}) failed: ${String(e?.message || e).replace(/\bre_\w+/g, "[key]")}`);
    return "failed";
  }
}

// Unsubscribing: no email from us reaches this address again (only a one-way hash of it is kept).
export async function optOut(env, email) {
  const address = cleanAddress(email);
  if (!address || !env?.DB) return;
  await setupEmail(env);
  await env.DB.prepare("INSERT OR IGNORE INTO email_optouts (hash, created) VALUES (?, ?)")
    .bind(await hashOf(address), iso()).run();
}
export async function optedOut(env, email) {
  await setupEmail(env);
  return Boolean(await env.DB.prepare("SELECT 1 AS y FROM email_optouts WHERE hash = ?")
    .bind(await hashOf(cleanAddress(email))).first());
}

// Text for HTML.
export const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
