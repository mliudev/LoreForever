// Lore Forever accounts: users, sessions, and what they contribute (voices so far). Contributors need one, and so
// does anyone sending feedback (/feedback, LOR-106); playing, listening and liking don't. The page is /account. Kept
// outside functions/ so Pages doesn't route it.
//
// Sign-in is Google only (Mike, 2026-09-30): Google Identity Services gives the browser an ID token, verifyGoogle
// checks it against Google's keys and our client ID, and the browser gets a random session token in an HttpOnly
// cookie; D1 keeps only its SHA-256, so a leaked table can't sign anyone in. Users are keyed on the Google account
// (google_sub); email is kept to reach them. Another sign-in method would call findOrCreateUser + startSession too.
//
// Pages setting (Settings > Variables and Secrets):
//   GOOGLE_CLIENT_ID  the OAuth web client ID (public; GCP project under mike.liu.dev@gmail.com). Without it sign-in is off.

const SETUP = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE, google_sub TEXT UNIQUE, display_name TEXT, links TEXT,
    show_public INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL)`,
  // A contributor's voice. status: pending (sent, waiting for us) or draft. It's public only once public/voices/
  // voices.json has an entry with the same id and "owner": the user's id.
  `CREATE TABLE IF NOT EXISTS voices (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', bio TEXT,
    created TEXT NOT NULL, updated TEXT NOT NULL)`,
  // Translators (functions/api/translations/[action].js): the languages they translate, and their edits from
  // /translate/dashboard. status: new (saved; no approval step), rejected (spam, from /admin), pulled (in data/i18n via
  // lore.kit pull, or on main for lore.kit community). accepted is treated like new.
  `CREATE TABLE IF NOT EXISTS translator_languages (
    user_id TEXT NOT NULL, locale TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY (user_id, locale))`,
  `CREATE TABLE IF NOT EXISTS translation_edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, locale TEXT NOT NULL, string_id TEXT NOT NULL,
    en TEXT NOT NULL, text TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new', reviewed TEXT)`,
  "CREATE INDEX IF NOT EXISTS translation_edits_user ON translation_edits (user_id, locale, string_id)",
  "CREATE INDEX IF NOT EXISTS translation_edits_status ON translation_edits (status, locale)",
  // The upload page (/voices/studio, lib/studio.js): one file per line of a voice, kept in R2 (binding STUDIO) under
  // r2_key; the narrator release each contributor agreed to there; and a per-day upload count.
  `CREATE TABLE IF NOT EXISTS studio_takes (
    voice_id TEXT NOT NULL, line_id TEXT NOT NULL, owner TEXT NOT NULL, r2_key TEXT NOT NULL, file_name TEXT, ext TEXT NOT NULL,
    bytes INTEGER NOT NULL, duration_ms INTEGER, hash TEXT NOT NULL, checks TEXT, created TEXT NOT NULL,
    PRIMARY KEY (voice_id, line_id))`,
  `CREATE TABLE IF NOT EXISTS studio_release (
    user_id TEXT PRIMARY KEY, version TEXT NOT NULL, signature TEXT NOT NULL, adult_or_guardian INTEGER NOT NULL, created TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS studio_uploads (owner TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (owner, day))`,
  // Requests per account per minute for zip and kit uploads (lib/ratelimit.js); bucket is "<scope>:<minute>".
  `CREATE TABLE IF NOT EXISTS rate_limits (user_id TEXT NOT NULL, bucket TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (user_id, bucket))`,
];

let ready = false;
export async function setup(env) {
  if (ready) return;
  await env.DB.batch(SETUP.map(s => env.DB.prepare(s)));
  ready = true;
}

const COOKIE = "lf_session";
const SESSION_DAYS = 30;

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const sha256 = async s => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const later = ms => new Date(Date.now() + ms).toISOString();

export const noStore = { "Cache-Control": "no-store" };
export const fail = (status, error) => Response.json({ ok: false, error }, { status, headers: noStore });

// State-changing requests must come from our own pages: browsers always send Origin on a POST.
export function sameOrigin(request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

function cookieValue(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

const cookie = (request, value, maxAge) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` +
  (new URL(request.url).protocol === "https:" ? "; Secure" : "");

// The signed-in user for this request, or null.
export async function currentUser(env, request) {
  const token = cookieValue(request, COOKIE);
  if (!env.DB || !/^[0-9a-f]{64}$/.test(token)) return null;
  await setup(env);
  return env.DB.prepare(
    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?"
  ).bind(await sha256(token), new Date().toISOString()).first();
}

// Starts a session for the user; returns the Set-Cookie header value.
export async function startSession(env, request, userId) {
  const token = randomToken();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires < ?").bind(now),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)")
      .bind(await sha256(token), userId, now, later(SESSION_DAYS * 86400e3)),
  ]);
  return cookie(request, token, SESSION_DAYS * 86400);
}

export async function endSession(env, request) {
  const token = cookieValue(request, COOKIE);
  if (env.DB && token) {
    await setup(env);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }
  return cookie(request, "", 0);
}

// Finds the user by Google account (or by verified email, for a user made some other way), or creates one.
export async function findOrCreateUser(env, { email, googleSub, name }) {
  await setup(env);
  let user = googleSub && await env.DB.prepare("SELECT * FROM users WHERE google_sub = ?").bind(googleSub).first();
  if (!user && email) user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (user) {
    if (googleSub && !user.google_sub) {
      await env.DB.prepare("UPDATE users SET google_sub = ? WHERE id = ?").bind(googleSub, user.id).run();
    }
    return user;
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users (id, email, google_sub, display_name, created) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, email || null, googleSub || null, (name || "").slice(0, 60) || null, new Date().toISOString()).run();
  return env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
}

// Everything we hold about a user, deleted in one batch by "Delete my account". A feature that stores per-user rows
// adds its CREATE TABLE to SETUP above (so the table exists here) and a line here. `users` must stay last.
// A published voice whose owner is gone drops off the site (lib/voices.js).
const USER_DATA = [
  ["DELETE FROM sessions WHERE user_id = ?", u => u.id],
  ["DELETE FROM voices WHERE owner = ?", u => u.id],
  // Text already pulled into a language pack stays there (CC BY-SA), without a link back to the account.
  ["DELETE FROM translator_languages WHERE user_id = ?", u => u.id],
  ["DELETE FROM translation_edits WHERE user_id = ?", u => u.id],
  ["DELETE FROM studio_takes WHERE owner = ?", u => u.id],
  ["DELETE FROM studio_release WHERE user_id = ?", u => u.id],
  ["DELETE FROM studio_uploads WHERE owner = ?", u => u.id],
  ["DELETE FROM rate_limits WHERE user_id = ?", u => u.id],
  ["DELETE FROM users WHERE id = ?", u => u.id],
];

export async function deleteUser(env, user) {
  await setup(env);
  // Their uploaded recordings (R2 keys studio/<user id>/...) go first, so no file outlives its row.
  if (env.STUDIO) {
    let cursor;
    do {
      const page = await env.STUDIO.list({ prefix: `studio/${user.id}/`, cursor });
      if (page.objects.length) await env.STUDIO.delete(page.objects.map(o => o.key));
      cursor = page.truncated ? page.cursor : null;
    } while (cursor);
  }
  await env.DB.batch(USER_DATA.map(([sql, arg]) => env.DB.prepare(sql).bind(arg(user))));
}

// ---- Google ID tokens ----

const b64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const GOOGLE_KEYS = "https://www.googleapis.com/oauth2/v3/certs";
let googleKeys = { at: 0, keys: [] };

async function googleKey(kid) {
  if (Date.now() - googleKeys.at > 3600e3 || !googleKeys.keys.some(k => k.kid === kid)) {
    const res = await fetch(GOOGLE_KEYS, { cf: { cacheTtl: 3600 } });
    if (!res.ok) throw new Error("Couldn't fetch Google's keys");
    googleKeys = { at: Date.now(), keys: (await res.json()).keys || [] };
  }
  return googleKeys.keys.find(k => k.kid === kid);
}

// Checks a Google ID token (signature, issuer, audience, expiry, verified email). Returns its claims or null.
export async function verifyGoogle(env, credential) {
  const clientId = env.GOOGLE_CLIENT_ID;
  const parts = String(credential || "").split(".");
  if (!clientId || parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
    if (header.alg !== "RS256") return null;
    const jwk = await googleKey(header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]),
                                          new TextEncoder().encode(parts[0] + "." + parts[1]));
    const now = Date.now() / 1000;
    if (!ok || claims.aud !== clientId || claims.exp < now || claims.iat > now + 300) return null;
    if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") return null;
    if (!claims.sub || !claims.email || claims.email_verified !== true) return null;
    return claims;
  } catch (e) {
    return null;
  }
}

// ---- Voices owned by contributors ----

export const RESERVED = new Set(["guide", "submit", "release", "thanks", "contributors", "account", "voices", "clips",
                                  "studio", "lines"]);

export function slug(name) {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

// Creates the user's voice for a submitted pack, or refreshes it if they already sent one by that name.
// Returns its id: the pack name as a slug, made unique against other people's voices and the site's own pages.
export async function claimVoice(env, user, packName, takenIds) {
  await setup(env);
  const base = slug(packName) || "voice";
  const now = new Date().toISOString();
  for (let n = 1; n < 50; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (RESERVED.has(id)) continue;
    const row = await env.DB.prepare("SELECT owner FROM voices WHERE id = ?").bind(id).first();
    if (row && row.owner === user.id) {
      await env.DB.prepare("UPDATE voices SET name = ?, status = 'pending', updated = ? WHERE id = ?").bind(packName, now, id).run();
      return id;
    }
    if (row || takenIds.has(id)) continue;
    await env.DB.prepare("INSERT INTO voices (id, owner, name, status, created, updated) VALUES (?, ?, ?, 'pending', ?, ?)")
      .bind(id, user.id, packName, now, now).run();
    return id;
  }
  return null;
}
