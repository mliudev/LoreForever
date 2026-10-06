// Helpers shared by the public forms (/api/feedback, /api/voices). Kept outside functions/ so Pages doesn't route it.

// A form value as a trimmed string with Unix line breaks, cut to `max` characters.
export const clean = (v, max) => String(v ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);

// A ticked checkbox, from a form post ("on") or JSON (true).
export const ticked = v => v === true || v === "on" || v === "1";

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");

// A random salt per day (UTC) for senderHash, in the D1 table daily_salts. Without one, a stored hash could be turned
// back into its IP address by trying every IPv4 address. Salts older than yesterday are deleted.
const SALTS = "CREATE TABLE IF NOT EXISTS daily_salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL)";

// Where senderHash values are kept: [table, hash column, date column]. The caps and likes only compare today's, so
// once a day is over its hashes are replaced with random ones. Row counts don't change (a like stays a row; OR IGNORE
// leaves a row as it is in the unlikely case its random value is taken). A hash is 24 hex characters and the
// replacement 12, so each row is replaced once, including the unsalted hashes from before daily_salts.
const HASHED = [
  ["voice_likes", "ip_hash", "day"], ["translation_likes", "ip_hash", "day"],
  ["feedback", "sender", "created"], ["voice_submissions", "sender", "created"],
  ["translation_submissions", "sender", "created"], ["translation_reports", "sender", "created"],
  ["clip_reports", "sender", "created"],
];
// Shared-text uploads (lib/contribute.js) keep theirs HASH_DAYS days to tell senders apart, then drop them
// (expireHashes). Picture reports (lib/pictures.js) don't use these: theirs are per picture and never change.

// Run by the request that makes a new day's salt: drops old salts and replaces earlier days' hashes. Tables are made on
// first use, so one that doesn't exist yet is skipped.
async function forgetOldHashes(env, day) {
  const yesterday = new Date(Date.parse(day) - 86400e3).toISOString().slice(0, 10);
  await env.DB.prepare("DELETE FROM daily_salts WHERE day < ?").bind(yesterday).run();
  for (const [table, column, date] of HASHED) {
    try {
      await env.DB.prepare(
        `UPDATE OR IGNORE ${table} SET ${column} = lower(hex(randomblob(6))) WHERE ${date} < ? AND length(${column}) = 24`
      ).bind(day).run();
    } catch (e) {}
  }
  // A clip report sent signed out also names its sender as "ip:<hash>". Each such value from an earlier day gets one
  // random stand-in, so that day's reports from one sender still go together (rejecting a sender's spam).
  try {
    const { results } = await env.DB.prepare(
      "SELECT DISTINCT uploader FROM clip_reports WHERE created < ? AND uploader LIKE 'ip:%' AND length(uploader) = 27"
    ).bind(day).all();
    if (results.length) await env.DB.batch(results.map(r => env.DB.prepare(
      "UPDATE clip_reports SET uploader = ? WHERE uploader = ? AND created < ?"
    ).bind("ip:" + hex(crypto.getRandomValues(new Uint8Array(6))), r.uploader, day)));
  } catch (e) {}
}

const salts = new WeakMap();   // env.DB -> {day, salt}, so most requests skip the lookup

async function daySalt(env, day) {
  const known = salts.get(env.DB);
  if (known?.day === day) return known.salt;
  await env.DB.prepare(SALTS).run();
  let salt = await env.DB.prepare("SELECT salt FROM daily_salts WHERE day = ?").bind(day).first("salt");
  if (!salt) {
    // Two requests can get here at once: both insert, one wins, and both read back the winner's salt.
    const made = await env.DB.prepare("INSERT OR IGNORE INTO daily_salts (day, salt) VALUES (?, ?)")
      .bind(day, hex(crypto.getRandomValues(new Uint8Array(32)))).run();
    if (made.meta.changes) await forgetOldHashes(env, day);
    salt = await env.DB.prepare("SELECT salt FROM daily_salts WHERE day = ?").bind(day).first("salt");
  }
  salts.set(env.DB, { day, salt });
  return salt;
}

// A per-day hash of the sender's IP, only used to cap how many times one person can send a form or like something in
// a day. Salted with that day's random salt (needs env.DB), so it can't be traced back to the address.
export async function senderHash(env, ip, day) {
  if (!env?.DB) throw new TypeError("senderHash(env, ip, day) needs env.DB for the day's salt");
  const salt = await daySalt(env, day);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + day + ":" + ip));
  return hex(bytes).slice(0, 24);
}

// Posts a message to a Discord webhook. Best effort: a failure never blocks saving the form.
export async function postWebhook(webhook, content) {
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
  } catch (e) {}
}
