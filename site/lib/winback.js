// A note to a player who cancelled their Willo plan, asking why (Patrick, 2026-10-19: "send an email to the one who
// cancelled to ask them about that was the issue and how we could improve"; Mike's go the same day). Written on /admin's
// Growth > Retention, one player at a time, and sent by the site (lib/email.js, Cloudflare Email Sending) from
// patrick@loreforeverwow.com with replies to that address, which Email Routing forwards to Patrick. Whoever writes it
// never sees the player's address: the site looks it up and sends. Plain text, with the same unsubscribe line as every
// email from us, and never to an address that unsubscribed (lib/email.js sendOnce).
//
// One note per cancelled subscription, ever (sendOnce's id winback:<subscription id>), never to a comped or team
// account (lib/cancellations.js counted), and not once the player has taken the cancellation back.
//
// winback_notes (subscription_id): what was written and when, the cancellation it answered, and what became of it
// (sendOnce's status: sent, off, opted_out, no_address; a failed send leaves no row, so it can be tried again). Never the
// address. Kept after "Delete my account": it has nothing about who.

import { sendOnce, optedOut, UNSUBSCRIBE_URL } from "./email.js";
import { setupCancellations } from "./cancellations.js";

export const FROM_PATRICK = "Patrick from Lore Forever <patrick@loreforeverwow.com>";
export const REPLY_PATRICK = "patrick@loreforeverwow.com";
export const SUBJECT_MAX = 120;
export const TEXT_MAX = 3000;
// What the box starts with; {name} is the player's first name (from Google), or nothing.
export const TEMPLATE = {
  subject: "Quick question about your Willo plan",
  text: "Hey {name},\n\nI'm Patrick, I work on Lore Forever with Mike. I saw you cancelled your Willo plan, and I'd " +
    "really like to know why. Was something missing, something off, or just not worth it for you?\n\nEven one line " +
    "helps us make Willo better. Just hit reply, it comes straight to me.\n\nThanks for giving it a go,\nPatrick",
};
const WRITABLE = ["scheduled", "now"];

const SETUP = [
  `CREATE TABLE IF NOT EXISTS winback_notes (subscription_id TEXT PRIMARY KEY, cancellation_id TEXT NOT NULL,
    subject TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL)`,
];
const ready = new WeakMap();
export function setupWinback(env) {
  if (!ready.has(env.DB)) ready.set(env.DB, (async () => {
    await setupCancellations(env);
    await env.DB.batch(SETUP.map(s => env.DB.prepare(s)));
  })().catch(e => { ready.delete(env.DB); throw e; }));
  return ready.get(env.DB);
}

// Plain text as it goes out: no control characters but line breaks, trimmed, at most `max`.
const plain = (s, max) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
  .trim().slice(0, max);
const firstName = name => String(name || "").trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{M}'’-]/gu, "").slice(0, 40) || "";

// The email: Patrick's words with {name} filled in, and the footer.
export function noteEmail({ subject, text, name = "" }) {
  const body = text.replace(/\{name\}/g, firstName(name)).replace(/^Hey ,/, "Hey,");
  return {
    subject,
    text: `${body}\n\n--\nYou're getting this because you cancelled a Willo plan on loreforeverwow.com. Reply to reach ` +
      `Patrick. Don't want email from us? ${UNSUBSCRIBE_URL}\n`,
    from: FROM_PATRICK, replyTo: REPLY_PATRICK,
  };
}

// Whether each cancellation (lib/retention.js's list, by id) can get a note: {id: "yes" | "written" | "taken back" |
// "no account" | "opted out" | "not counted" | "not this one"}, and the notes written: {subscription_id: {status, at}}.
// The addresses are read here only to check for an unsubscribe; nothing about them leaves this function.
export async function noteStates(env, ids) {
  await setupWinback(env);
  if (!ids.length) return { states: {}, notes: {} };
  const marks = ids.map(() => "?").join(", ");
  const { results } = await env.DB.prepare(
    "SELECT c.id, c.subscription_id, c.kind, c.counted, u.email, w.status AS note, w.created AS noted, " +
    "(SELECT kind FROM plan_cancellations l WHERE l.subscription_id = c.subscription_id AND l.kind != 'replaced' " +
    "ORDER BY l.at DESC, l.created DESC LIMIT 1) AS latest " +
    `FROM plan_cancellations c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN winback_notes w ON w.subscription_id = c.subscription_id WHERE c.id IN (${marks})`
  ).bind(...ids).all();
  const states = {}, notes = {};
  for (const r of results) {
    if (r.note) notes[r.subscription_id] = { status: r.note, at: r.noted };
    states[r.id] = r.note ? "written" : !r.counted ? "not counted" : !WRITABLE.includes(r.kind) ? "not this one"
      : r.latest === "undone" ? "taken back" : !r.email ? "no account" : await optedOut(env, r.email) ? "opted out" : "yes";
  }
  return { states, notes };
}

// Sends the note for cancellation `id` (plan_cancellations.id): {status} (sent, off: no email service set up, opted_out,
// no_address, seen: one was sent already, failed), or {error} for a note that can't go.
export async function writeNote(env, { id, subject, text }) {
  await setupWinback(env);
  subject = plain(subject, SUBJECT_MAX).replace(/\n/g, " ");
  text = plain(text, TEXT_MAX);
  if (!subject || !text) return { error: "Write a subject and a message." };
  const { states } = await noteStates(env, [String(id || "")]);
  const state = states[String(id || "")];
  const why = { written: "That player already got a note about this cancellation.",
    "not counted": "That's a comped or team account.", "not this one": "Write from the cancellation itself, not its end.",
    "taken back": "They took the cancellation back, so there's nothing to ask.",
    "no account": "Their account is gone, so there's no one to write to.", "opted out": "They unsubscribed from our email." };
  if (!state) return { error: "No such cancellation." };
  if (state !== "yes") return { error: why[state] };
  const row = await env.DB.prepare("SELECT c.subscription_id, c.user_id, u.email, u.display_name FROM plan_cancellations c " +
    "JOIN users u ON u.id = c.user_id WHERE c.id = ?").bind(id).first();
  const message = { to: row.email, ...noteEmail({ subject, text, name: row.display_name }) };
  const status = await sendOnce(env, { id: `winback:${row.subscription_id}`, kind: "winback", userId: row.user_id, message });
  if (status === "failed") return { error: "The email service didn't take it. Try again in a minute." };
  if (status !== "seen") {
    await env.DB.prepare("INSERT OR IGNORE INTO winback_notes (subscription_id, cancellation_id, subject, text, status, created) " +
      "VALUES (?, ?, ?, ?, ?, ?)").bind(row.subscription_id, id, subject, text, status, new Date().toISOString()).run();
  }
  return { status };
}
