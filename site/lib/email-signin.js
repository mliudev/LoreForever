// Sign in by email (LOR-816; Mike, 10/25: "go for email"; design: claude.ai/artifact/YYonkjfA1xb9on9iEvnsnZ). A
// player who'd rather not use Google types their address, we email a 6-digit code, and they type it where they asked:
// on the site (functions/api/auth/[action].js email-start, email-verify: a session cookie, as Google gives) or in
// Willo on a PC or iPhone (functions/api/device/[action].js, the same two: an app token, as a claimed link gives). The
// code proves the player owns the inbox, the same proof Google's verified address gives, so it signs in to the
// account with that address (lib/accounts.js accountByEmail: plan, journey, profile and friends all there), or makes
// one. Kept outside functions/ so Pages doesn't route it.
//
// Codes: 6 digits, CODE_MINUTES, one use, MAX_TRIES wrong tries, a new one replaces the old. D1 keeps only one-way
// hashes (email_codes): of the inbox, and of the code with it, keyed by the EMAIL_CODE_KEY secret (oneWay), so the rows
// alone can't be worked back to a code, or matched against a list of addresses.
// Limits (rate_limits, lib/ratelimit.js; the network is the daily one-way IP code lib/form.js senderHash makes):
//   codes per inbox      PER_INBOX_15_MIN in a quarter hour, PER_INBOX_DAY a day
//   codes per network    PER_NETWORK_HOUR an hour, PER_NETWORK_DAY a day
//   code tries           MAX_TRIES per code; WRONG_PER_INBOX_DAY wrong ones a day per inbox, from anywhere (a new code
//                        starts its own MAX_TRIES); VERIFY_PER_NETWORK_HOUR tries an hour per network
//   new accounts         NEW_PER_NETWORK_DAY a day per network
//   the whole site       SITE_DAY code emails a day ("ALERT email sign-in" in the log at ALERT_AT, which DevOps
//                        routes to the dashboard like the free pool's alerts)
// Throwaway inboxes (lib/vendor/throwaway-domains.js) are refused. Every address gets the same answer, so nobody can
// learn from it whether an address has an account.
//
// The email is a sign-in email, not news: it ignores the news opt-out list and has no unsubscribe line (lib/email.js
// sendEmail, transactional). It's from hello@loreforeverwow.com, named Willo on her door and from her apps, Lore
// Forever on the add-on's.
//
// Develop (lib/test-players.js testPlayersOn): an @example.test address (Mira, Doran, Brann, or any made-up one) is
// never emailed; its code comes back in the answer as testCode for the test panel. Anywhere else such an address is
// refused, and no answer ever carries a code.
//
// Sign-in counts (signin_steps): per UTC day, per surface (site:willo, site:lore, site, pc, iphone), how many sign-in
// screens were shown, codes sent and accepted, and Google and Apple sign-ins done. Counts only, never an address.

import { accountByEmail, inboxOf, sha256, recordTerms } from "./accounts.js";
import { cleanAddress, emailService, sendEmail, escapeHtml } from "./email.js";
import { senderHash } from "./form.js";
import { createMissing } from "./schema.js";
import { testPlayersOn } from "./test-players.js";
import { doorOf } from "./doors.js";
import { readClient } from "./client-version.js";
import { THROWAWAY_DOMAINS } from "./vendor/throwaway-domains.js";

export const CODE_MINUTES = 10;
export const MAX_TRIES = 5;
export const RESEND_SECONDS = 30;          // the screens' "Send a new code in 0:30"
export const PER_INBOX_15_MIN = 3;
export const PER_INBOX_DAY = 10;
export const PER_NETWORK_HOUR = 10;
export const PER_NETWORK_DAY = 30;
export const VERIFY_PER_NETWORK_HOUR = 20;
export const WRONG_PER_INBOX_DAY = 15;
export const NEW_PER_NETWORK_DAY = 3;
export const SITE_DAY = 1000;
export const ALERT_AT = 800;

export const EMAIL_SIGNIN_SETUP = [
  `CREATE TABLE IF NOT EXISTS email_codes (inbox_hash TEXT PRIMARY KEY, code_hash TEXT NOT NULL,
    tries INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, expires TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS signin_steps (day TEXT NOT NULL, surface TEXT NOT NULL, step TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, surface, step))`,
];

// What each refusal says. reason is for the apps, which say it in their own words where they need to (the iPhone's
// send failure names Apple too).
export const SAY = {
  address: "That doesn't look like an email address.",
  throwaway: "Please use an email you keep, so you can get back in.",
  test: "That isn't a real address.",
  off: "Sign-in by email isn't set up yet. Please use Google.",
  inbox: "We just sent one. Check your email, or wait a few minutes.",
  network: "Too many tries from here. Wait a while, or use Google.",
  busy: "Email sign-in is busy. Use Google, or try again later.",
  send: "Couldn't send the email just now. Try again, or use Google.",
  format: "Type the 6-digit code from the email.",
  code: "That code didn't work. Check the newest email, or send a new one.",
  new: "Too many new accounts from here today.",
};

const ready = new WeakSet();
async function setupEmailSignIn(env) {
  if (ready.has(env.DB)) return;
  await createMissing(env, EMAIL_SIGNIN_SETUP);
  ready.add(env.DB);
}

const iso = ms => new Date(ms).toISOString();
const day = ms => iso(ms).slice(0, 10);
const TEST = /@example\.test$/;

let throwaway = null;
// True for an address at a throwaway domain, or under one ("x.mailinator.com").
export function isThrowaway(address) {
  throwaway ??= new Set(THROWAWAY_DOMAINS.split("\n").filter(Boolean));
  const parts = address.slice(address.lastIndexOf("@") + 1).split(".");
  for (let i = 0; i < parts.length - 1; i++) if (throwaway.has(parts.slice(i).join("."))) return true;
  return false;
}

// Where a sign-in happens, for the counts: the app from its header, else the site's door.
export function surfaceOf(request, env) {
  const app = readClient(request.headers.get("X-LF-Client"));
  if (app.valid && !request.headers.get("Origin")) return app.platform === "ios" ? "iphone" : "pc";
  const door = doorOf(request, env)?.door;
  return door ? `site:${door}` : "site";
}

// Counts one step; never fails a sign-in.
export async function noteStep(env, request, step, now = Date.now()) {
  try {
    await setupEmailSignIn(env);
    await env.DB.prepare("INSERT INTO signin_steps (day, surface, step, n) VALUES (?, ?, ?, 1) " +
      "ON CONFLICT (day, surface, step) DO UPDATE SET n = n + 1").bind(day(now), surfaceOf(request, env), step).run();
  } catch (e) {
    console.warn(`sign-in steps: ${e?.message || e}`);
  }
}

// Sign-in by email is open where email can go out, and on develop for its test addresses.
export const emailSignInOn = (env, request) => Boolean(emailService(env)) || testPlayersOn(env, request);

// One count in rate_limits (the same table and buckets as lib/ratelimit.js); returns the count so far.
async function count(env, key, bucket) {
  const row = await env.DB.prepare("INSERT INTO rate_limits (user_id, bucket, n) VALUES (?, ?, 1) " +
    "ON CONFLICT (user_id, bucket) DO UPDATE SET n = n + 1 RETURNING n").bind(key, bucket).first();
  return row?.n || 0;
}
const networkKey = async (env, request, now) =>
  "ip:" + await senderHash(env, request.headers.get("CF-Connecting-IP") || "", day(now));
// The one-way codes D1 keeps: an HMAC-SHA-256 with the EMAIL_CODE_KEY secret when it's set, so reading the rows isn't
// enough to try the million codes or confirm an address (the Software Architect's review, 10/25); a plain SHA-256
// until then. Setting or changing the key only fails the codes already sent (they last CODE_MINUTES).
const hmacKeys = new Map();   // the secret -> its imported key
async function oneWay(env, text) {
  const secret = env.EMAIL_CODE_KEY;
  if (!secret) return sha256(text);
  if (!hmacKeys.has(secret)) {
    hmacKeys.set(secret, await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" },
      false, ["sign"]));
  }
  const mac = await crypto.subtle.sign("HMAC", hmacKeys.get(secret), new TextEncoder().encode(text));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const inboxHash = (env, inbox) => oneWay(env, `lore-forever-signin:${inbox}`);
const codeHash = (env, inboxH, code) => oneWay(env, `${inboxH}:${code}`);

// A 6-digit code, every one as likely (draws past the last whole million are drawn again).
function newCode() {
  const max = 4294000000;   // 4294 * 1e6, the last whole million below 2^32
  for (;;) {
    const [n] = crypto.getRandomValues(new Uint32Array(1));
    if (n < max) return String(n % 1e6).padStart(6, "0");
  }
}

// The first sign-in code of a UTC day clears what earlier days left: codes long expired, and the limits' old counts
// for inboxes and networks (an inbox's key never changes, so its rows would otherwise stay).
async function tidy(env, now) {
  const today = day(now);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM email_codes WHERE expires < ?").bind(iso(now)),
    env.DB.prepare("DELETE FROM rate_limits WHERE (user_id LIKE 'inbox:%' OR user_id LIKE 'ip:%' OR user_id = 'site') AND " +
      "(bucket LIKE 'signin-%') AND substr(bucket, instr(bucket, ':') + 1, 10) < ?").bind(today),
  ]);
}

const brandOf = (env, request) => surfaceOf(request, env) === "site:lore" ? "Lore Forever" : "Willo";

function message(brand, to, code) {
  const text = `Your ${brand} sign-in code is\n\n${code}\n\nIt works for ${CODE_MINUTES} minutes. Type it where you asked ` +
    `for it.\n\nDidn't ask for this? You can ignore this email. Nobody can sign in without the code.\n\n` +
    `Sent because someone asked to sign in to ${brand} with this address.\n`;
  const html = `<p>Your ${escapeHtml(brand)} sign-in code is</p>` +
    `<p style="font-size:28px;letter-spacing:6px;font-family:monospace;margin:16px 0">${code}</p>` +
    `<p>It works for ${CODE_MINUTES} minutes. Type it where you asked for it.</p>` +
    `<p>Didn't ask for this? You can ignore this email. Nobody can sign in without the code.</p>` +
    `<p style="color:#6b7280;font-size:12px">Sent because someone asked to sign in to ${escapeHtml(brand)} with this address.</p>`;
  return { to, from: `${brand} <hello@loreforeverwow.com>`, subject: `${code} is your ${brand} sign-in code`, text, html,
           transactional: true };
}

// Emails a new code to `email`. {ok: true, to, expires_in, resend_after, testCode?} or {ok: false, status, reason}.
export async function startCode(env, request, email, now = Date.now()) {
  const to = cleanAddress(email);
  if (!to) return { ok: false, status: 400, reason: "address" };
  const test = TEST.test(to);
  if (test && !testPlayersOn(env, request)) return { ok: false, status: 400, reason: "test" };
  if (!test && isThrowaway(to)) return { ok: false, status: 400, reason: "throwaway" };
  if (!test && !emailService(env)) return { ok: false, status: 503, reason: "off" };
  await setupEmailSignIn(env);
  const network = await networkKey(env, request, now);
  const hour = iso(now).slice(0, 13), quarter = `${hour}:${Math.floor(new Date(now).getUTCMinutes() / 15)}`;
  if (await count(env, network, `signin-send-hour:${hour}`) > PER_NETWORK_HOUR ||
      await count(env, network, `signin-send-day:${day(now)}`) > PER_NETWORK_DAY) return { ok: false, status: 429, reason: "network" };
  const inbox = await inboxHash(env, inboxOf(to));
  if (await count(env, `inbox:${inbox.slice(0, 32)}`, `signin-inbox-15:${quarter}`) > PER_INBOX_15_MIN ||
      await count(env, `inbox:${inbox.slice(0, 32)}`, `signin-inbox-day:${day(now)}`) > PER_INBOX_DAY) {
    return { ok: false, status: 429, reason: "inbox" };
  }
  if (!test) {
    const sent = await count(env, "site", `signin-site-day:${day(now)}`);
    if (sent === 1) await tidy(env, now).catch(e => console.warn(`email sign-in: tidy: ${e?.message || e}`));
    if (sent === ALERT_AT) console.warn(`ALERT email sign-in: ${ALERT_AT} of the day's ${SITE_DAY} code emails sent`);
    if (sent > SITE_DAY) return { ok: false, status: 503, reason: "busy" };
  }
  const code = newCode();
  await env.DB.prepare("INSERT OR REPLACE INTO email_codes (inbox_hash, code_hash, tries, created, expires) VALUES (?, ?, 0, ?, ?)")
    .bind(inbox, await codeHash(env, inbox, code), iso(now), iso(now + CODE_MINUTES * 60e3)).run();
  if (!test) {
    try {
      await sendEmail(env, message(brandOf(env, request), to, code));
    } catch (e) {
      console.warn(`email sign-in: send failed: ${String(e?.message || e).slice(0, 200)}`);
      await env.DB.prepare("DELETE FROM email_codes WHERE inbox_hash = ?").bind(inbox).run();
      return { ok: false, status: 502, reason: "send" };
    }
  }
  await noteStep(env, request, "code_sent", now);
  return { ok: true, to, expires_in: CODE_MINUTES * 60, resend_after: RESEND_SECONDS, ...(test ? { testCode: code } : {}) };
}

// Takes the code typed for `email`. {ok: true, user, created} (the account with that address, or a new one, which has
// agreed to the Terms by signing in) or {ok: false, status, reason}.
export async function verifyCode(env, request, email, typed, now = Date.now()) {
  const to = cleanAddress(email);
  if (!to) return { ok: false, status: 400, reason: "address" };
  const code = String(typed ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, status: 400, reason: "format" };
  await setupEmailSignIn(env);
  const network = await networkKey(env, request, now);
  if (await count(env, network, `signin-verify-hour:${iso(now).slice(0, 13)}`) > VERIFY_PER_NETWORK_HOUR) {
    return { ok: false, status: 429, reason: "network" };
  }
  const inbox = await inboxHash(env, inboxOf(to));
  // An inbox that has had its day's wrong tries gets the same answer as a wrong code, whatever is typed.
  const wrongKey = `inbox:${inbox.slice(0, 32)}`, wrongBucket = `signin-wrong-day:${day(now)}`;
  const wrong = await env.DB.prepare("SELECT n FROM rate_limits WHERE user_id = ? AND bucket = ?").bind(wrongKey, wrongBucket).first();
  if ((wrong?.n || 0) >= WRONG_PER_INBOX_DAY) return { ok: false, status: 400, reason: "code" };
  // Taken only when it's right and still fresh, by exactly one request.
  const taken = await env.DB.prepare(
    "DELETE FROM email_codes WHERE inbox_hash = ? AND code_hash = ? AND expires > ? AND tries < ? RETURNING created")
    .bind(inbox, await codeHash(env, inbox, code), iso(now), MAX_TRIES).first();
  if (!taken) {
    await count(env, wrongKey, wrongBucket);
    const row = await env.DB.prepare("UPDATE email_codes SET tries = tries + 1 WHERE inbox_hash = ? RETURNING tries, expires")
      .bind(inbox).first();
    if (row && (row.tries >= MAX_TRIES || row.expires <= iso(now))) {
      await env.DB.prepare("DELETE FROM email_codes WHERE inbox_hash = ?").bind(inbox).run();
    }
    return { ok: false, status: 400, reason: "code" };
  }
  let user = await accountByEmail(env, to), created = false;
  if (!user) {
    if (await count(env, network, `signin-new-day:${day(now)}`) > NEW_PER_NETWORK_DAY) return { ok: false, status: 429, reason: "new" };
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare("INSERT INTO users (id, email, created) VALUES (?, ?, ?)").bind(id, to, iso(now)).run();
      created = true;
    } catch (e) {
      if (!(await accountByEmail(env, to))) throw e;   // the same address signed up at the same moment: that one wins
    }
    user = await accountByEmail(env, to);
  }
  await recordTerms(env, user.id);
  await noteStep(env, request, "code_ok", now);
  return { ok: true, user, created };
}

// A refusal as the API answers it: {ok: false, error, reason} with its status (429s say when to try again).
export function refusal({ status, reason }) {
  const headers = { "Cache-Control": "no-store" };
  if (status === 429) headers["Retry-After"] = reason === "inbox" ? "300" : "3600";
  return Response.json({ ok: false, error: SAY[reason] || SAY.code, reason }, { status, headers });
}
