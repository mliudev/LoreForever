import { createMissing } from "./schema.js";
// Lore Forever's own Lua errors and blocked actions, sent by the companion app only after the player said yes to
// "Send Lore Forever's error reports" (off until then). The add-on already keeps them in LoreForeverDB.errors
// (addon/LoreForever/Errors.lua: its own errors only, the same message counted up, at most 20, the top of the stack),
// and /lore errors shows them to copy; this way we see them without asking the player to paste anything.
//
//   POST /api/companion/addon-errors (functions/api/companion/addon-errors.js), "X-LF-Client: companion/<version>":
//     {"v": 1, "install": "<SHA-256 hex of the companion's random install id>", "companion": "0.22.0",
//      "addon": "0.22.0", "client": "1.60.1.70450", "locale": "enUS",
//      "errors": [{"msg": "...", "stack": "...", "n": 3, "first": 1792224572, "last": 1792312293, "v": "0.22.0"}]}
//
//   addon_errors (sig, install) one row per error message and install, replaced by each send (the add-on's own count
//     and times), kept KEEP_DAYS after it was last seen. sig: the message with its numbers taken out, hashed, so one
//     bug from two versions (other line numbers) is one error.
//
// What's kept is the add-on's error text, the top of its stack (file names and lines in Lore Forever's own files),
// the versions and the game's language: no account, name or game data. The companion takes this account's character
// names out of the text first, as it does for shared game text. A message seen for the first time from any install
// goes to Slack #player-feedback (lib/slack-feedback.js "addon-error"), once.

export const MAX_ROWS = 20;        // the add-on keeps at most 20 (Errors.lua MAX)
export const MSG_MAX = 400;        // Errors.lua MSG
export const STACK_MAX = 1200;     // Errors.lua STACK_LETTERS
export const MAX_BODY = 40_000;
export const KEEP_DAYS = 90;
export const PER_HOUR = 4;         // sends an hour from one install (the companion sends at most once a day)

const SETUP = [
  `CREATE TABLE IF NOT EXISTS addon_errors (sig TEXT NOT NULL, install TEXT NOT NULL, msg TEXT NOT NULL, stack TEXT,
    n INTEGER NOT NULL, first INTEGER, last INTEGER, v TEXT, client TEXT, locale TEXT, companion TEXT,
    received TEXT NOT NULL, PRIMARY KEY (sig, install))`,
  "CREATE INDEX IF NOT EXISTS addon_errors_last ON addon_errors (last)",
];
const ready = new WeakMap();
export async function setup(env) {
  if (ready.get(env.DB)) return;
  await createMissing(env, SETUP);
  ready.set(env.DB, true);
}

const INSTALL = /^[0-9a-f]{64}$/;
const VERSION = /^\d{1,4}(\.\d{1,6}){0,3}([-+][0-9A-Za-z.-]{1,20})?$/;
const LOCALE = /^[a-z]{2}[A-Z]{2}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const version = v => typeof v === "string" && VERSION.test(v) ? v : null;
const text = (s, max) => typeof s === "string" ? s.replace(CONTROL, "").replace(/\r\n?/g, "\n").trim().slice(0, max) : "";
const count = v => Number.isInteger(v) && v > 0 ? Math.min(v, 1e9) : null;
// A time() from the PC: kept only when it's plausible (after 2025, not more than a day ahead).
const when = (v, now) => Number.isInteger(v) && v > 1735689600 && v < now + 86400 ? v : null;

// The send's fields, or null when it isn't one. Rows without a message are dropped; past MAX_ROWS, the rest.
export function readAddonErrors(input, now = Math.floor(Date.now() / 1000)) {
  if (!input || typeof input !== "object" || input.v !== 1 || !INSTALL.test(input.install || "")) return null;
  if (!Array.isArray(input.errors)) return null;
  const errors = [];
  for (const e of input.errors.slice(0, MAX_ROWS)) {
    if (!e || typeof e !== "object") continue;
    const msg = text(e.msg, MSG_MAX);
    if (!msg) continue;
    errors.push({ msg, stack: text(e.stack, STACK_MAX) || null, n: count(e.n) || 1, first: when(e.first, now),
                  last: when(e.last, now), v: version(e.v) });
  }
  return {
    install: input.install, companion: version(input.companion), addon: version(input.addon),
    client: version(input.client), locale: typeof input.locale === "string" && LOCALE.test(input.locale) ? input.locale : null,
    errors,
  };
}

// The error's signature: its message with every number taken out (line numbers, counts), hashed (16 hex digits).
export async function sigOf(msg) {
  const norm = String(msg).replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return [...new Uint8Array(digest)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Keeps a send. Returns the rows whose message no install had sent before (for Slack), with their sig.
export async function saveAddonErrors(env, report, now = Date.now()) {
  await setup(env);
  if (!report.errors.length) return [];
  const rows = await Promise.all(report.errors.map(async e => ({ ...e, sig: await sigOf(e.msg) })));
  const sigs = [...new Set(rows.map(r => r.sig))];
  const { results: seen } = await env.DB.prepare(
    "SELECT DISTINCT sig FROM addon_errors WHERE sig IN (SELECT value FROM json_each(?))").bind(JSON.stringify(sigs)).all();
  const known = new Set(seen.map(r => r.sig));
  const received = new Date(now).toISOString();
  await env.DB.batch([
    ...rows.map(r => env.DB.prepare(
      `INSERT INTO addon_errors (sig, install, msg, stack, n, first, last, v, client, locale, companion, received)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sig, install) DO UPDATE SET msg = excluded.msg, stack = excluded.stack, n = excluded.n,
         first = excluded.first, last = excluded.last, v = excluded.v, client = excluded.client,
         locale = excluded.locale, companion = excluded.companion, received = excluded.received`)
      .bind(r.sig, report.install, r.msg, r.stack, r.n, r.first, r.last, r.v || report.addon, report.client,
            report.locale, report.companion, received)),
    env.DB.prepare("DELETE FROM addon_errors WHERE COALESCE(last, 0) < ? AND received < ?")
      .bind(Math.floor(now / 1000) - KEEP_DAYS * 86400, new Date(now - KEEP_DAYS * 864e5).toISOString()),
  ]);
  const fresh = new Map();
  for (const r of rows) {
    if (!known.has(r.sig) && !fresh.has(r.sig)) {
      fresh.set(r.sig, { ...r, v: r.v || report.addon, client: report.client, locale: report.locale });
    }
  }
  return [...fresh.values()];
}

// Every error kept, the most players first, then the most recent: for the routines and /admin (GET with the admin
// key). installs: how many installs sent it; n: times in all; versions: the add-on versions it happened in.
export async function addonErrorReport(env, { limit = 100 } = {}) {
  await setup(env);
  const { results } = await env.DB.prepare(
    `SELECT sig, MAX(msg) AS msg, COUNT(*) AS installs, SUM(n) AS n, MIN(first) AS first, MAX(last) AS last,
       GROUP_CONCAT(DISTINCT v) AS versions, GROUP_CONCAT(DISTINCT locale) AS locales,
       (SELECT stack FROM addon_errors s WHERE s.sig = e.sig ORDER BY s.last DESC LIMIT 1) AS stack
     FROM addon_errors e GROUP BY sig ORDER BY installs DESC, last DESC LIMIT ?`).bind(limit).all();
  return results.map(r => ({ ...r, versions: r.versions ? r.versions.split(",").sort() : [],
                             locales: r.locales ? r.locales.split(",").sort() : [] }));
}
