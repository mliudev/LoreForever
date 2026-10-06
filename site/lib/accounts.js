// Lore Forever accounts: users, sessions, their player profile (/u/<handle>, LOR-181) and what they contribute.
// Contributors need one, and so does anyone sending feedback (/feedback, LOR-106) or making a profile; playing,
// downloading, listening and liking don't. The page is /account. Kept outside functions/ so Pages doesn't route it.
//
// Sign-in is Google only (Mike, 2026-09-30): Google Identity Services gives the browser an ID token, verifyGoogle
// checks it against Google's keys and our client ID, and the browser gets a random session token in an HttpOnly
// cookie; D1 keeps only its SHA-256, so a leaked table can't sign anyone in. Users are keyed on the Google account
// (google_sub); email is kept to reach them. Another sign-in method would call findOrCreateUser + startSession too.
//
// Pages setting (Settings > Variables and Secrets):
//   GOOGLE_CLIENT_ID  the OAuth web client ID (public; GCP project under mike.liu.dev@gmail.com). Without it sign-in is off.

import { forgetUser as forgetContributor } from "./contribute.js";
import { RECORD_ONLY } from "./donate.js";

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
  // "Claim a zone" (LOR-231, lib/claims.js): a narrator's claim on one zone, for one of their voices, in its language.
  // status: active (one per narrator), done (every line of the zone recorded; kept, with its credit, for the zone
  // list), expired (no upload for 14 days) or released (let go). One active or done claim per zone and language.
  `CREATE TABLE IF NOT EXISTS studio_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT, zone TEXT NOT NULL, locale TEXT NOT NULL, voice_id TEXT NOT NULL, owner TEXT NOT NULL,
    credit TEXT, status TEXT NOT NULL DEFAULT 'active', created TEXT NOT NULL, updated TEXT NOT NULL, finished TEXT)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS studio_claims_zone ON studio_claims (zone, locale) WHERE status IN ('active', 'done')",
  "CREATE UNIQUE INDEX IF NOT EXISTS studio_claims_owner ON studio_claims (owner) WHERE status = 'active'",
  // "Lend your voice" (LOR-230, lib/donate.js): a donated sample (in R2 under studio/<user id>/_donation/<id>/) that we
  // make a narrator voice from. status: donated, rendering, ready (a test pack is up), published or withdrawn (the
  // sample, test pack and credit gone; the row stays as the record of the agreement and its withdrawal, and after
  // "Delete my account" without the account: owner ""). One donation that isn't withdrawn per account.
  // donation_release: the donation terms each donor agreed to, like studio_release; each donation copies it
  // (consent_version, signature, adult, consented). consented and adult also come from lib/donate.js MIGRATE.
  `CREATE TABLE IF NOT EXISTS voice_donations (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, status TEXT NOT NULL, credit TEXT, r2_key TEXT, ext TEXT, bytes INTEGER,
    duration_ms INTEGER, checks TEXT, crc32 TEXT, script TEXT, consent_version TEXT NOT NULL, signature TEXT NOT NULL,
    pack_key TEXT, pack_bytes INTEGER, pack_lines INTEGER, pack_title TEXT, voice_id TEXT, created TEXT NOT NULL,
    updated TEXT NOT NULL, withdrawn TEXT, consented TEXT, adult INTEGER)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS voice_donations_owner ON voice_donations (owner) WHERE status != 'withdrawn'",
  `CREATE TABLE IF NOT EXISTS donation_release (
    user_id TEXT PRIMARY KEY, version TEXT NOT NULL, signature TEXT NOT NULL, adult INTEGER NOT NULL, created TEXT NOT NULL)`,
  // Requests per account per minute for zip and kit uploads (lib/ratelimit.js); bucket is "<scope>:<minute>".
  `CREATE TABLE IF NOT EXISTS rate_limits (user_id TEXT NOT NULL, bucket TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (user_id, bucket))`,
  // A player's profile (lib/profiles.js): the page /u/<handle>, built from their pasted journey record (data: what
  // lib/journey.js read from it, never the text itself). public: 0 until they make it public. story_source: written
  // or template; story_count: stories written for this account so far (today's tries are in rate_limits). story_at:
  // when a story was last tried; story_basis: what the written one covered (lib/profiles.js storyBasis), so the
  // companion's updates write a new one only now and then (storyDue). Both also come from lib/profiles.js MIGRATE.
  `CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, public INTEGER NOT NULL DEFAULT 0, spec TEXT, data TEXT NOT NULL,
    story TEXT, story_source TEXT, story_count INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, updated TEXT NOT NULL,
    story_at TEXT, story_basis TEXT, journey TEXT, card_sha TEXT, card_key TEXT)`,
  // Connected apps (lib/devices.js, LOR-148): the companion on a player's PC, which keeps their profile up to date.
  // device_links: a link waiting for the player's Connect on /link (code_hash: SHA-256 of the companion's secret
  // device code; user_code: what the player sees); devices: each connected app, with the SHA-256 of its token.
  `CREATE TABLE IF NOT EXISTS device_links (
    code_hash TEXT PRIMARY KEY, user_code TEXT NOT NULL UNIQUE, label TEXT, user_id TEXT, status TEXT NOT NULL DEFAULT 'pending',
    created TEXT NOT NULL, expires TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, label TEXT, created TEXT NOT NULL,
    last_used TEXT, last_sync TEXT)`,
  "CREATE INDEX IF NOT EXISTS devices_user ON devices (user_id)",
  // What writing profile stories cost, per calendar month (UTC, "2026-10"): micro_usd in millionths of a dollar,
  // calls made and stories kept. Site-wide, not per account. lib/profiles.js stops writing at the monthly budget.
  `CREATE TABLE IF NOT EXISTS story_spend (
    month TEXT PRIMARY KEY, micro_usd INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, stories INTEGER NOT NULL DEFAULT 0)`,
  // Reports on recordings (lib/clipreports.js, LOR-232). Anyone can send one; user_id is set when signed in.
  `CREATE TABLE IF NOT EXISTS clip_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL, updated TEXT NOT NULL, clip TEXT NOT NULL, hash TEXT,
    voice TEXT NOT NULL, reason TEXT NOT NULL, name TEXT, say_as TEXT, note TEXT, version TEXT, locale TEXT, source TEXT,
    user_id TEXT, sender TEXT NOT NULL, uploader TEXT NOT NULL, country TEXT, status TEXT NOT NULL DEFAULT 'open',
    resolved TEXT)`,
  "CREATE INDEX IF NOT EXISTS clip_reports_clip ON clip_reports (clip, voice, status)",
  "CREATE INDEX IF NOT EXISTS clip_reports_uploader ON clip_reports (uploader, status)",
  // The picture book (lib/pictures.js): pictures the companion took in game and put on the player's profile, in R2
  // (binding STUDIO) at pictures/<user id>/<id>.jpg. cid: the companion's own id for it (sending it again updates the
  // row); sha: the first 10 hex of the image's SHA-256, part of its address (/pictures/<id>-<sha>.jpg); clean: taken
  // with the picture key (the interface hidden). realm, map, x, y (thousandths of the map) and t (when it was taken,
  // Unix seconds) are for a later realm chronicle, pictures of one live event by many players: hence the two indexes.
  // reports: how many independent senders reported it; at lib/pictures.js REPORTS_TO_HIDE it's hidden for good.
  // report_salt: a random salt for this picture's reports' IP hashes (made by the first report).
  `CREATE TABLE IF NOT EXISTS profile_pictures (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, cid TEXT NOT NULL, realm TEXT, faction TEXT, race TEXT, class TEXT,
    lv INTEGER, zone TEXT, subzone TEXT, map INTEGER, x INTEGER, y INTEGER, t INTEGER NOT NULL, w INTEGER, h INTEGER,
    bytes INTEGER NOT NULL, sha TEXT NOT NULL, clean INTEGER NOT NULL DEFAULT 0, caption TEXT, created TEXT NOT NULL,
    reports INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, report_salt TEXT, UNIQUE (user_id, cid))`,
  "CREATE INDEX IF NOT EXISTS profile_pictures_realm ON profile_pictures (realm, t)",
  "CREATE INDEX IF NOT EXISTS profile_pictures_map ON profile_pictures (map, t)",
  // Reports on pictures: the account when signed in, and a hash of the sender's IP with the picture's report_salt.
  // Unlike the forms' daily hashes it doesn't change from day to day, so one person counts once, any day.
  `CREATE TABLE IF NOT EXISTS picture_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, picture_id TEXT NOT NULL, user_id TEXT, ip_hash TEXT NOT NULL, created TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS picture_reports_picture ON picture_reports (picture_id)",
  // The companion's ids (cid) of pictures their owner removed on the page, so the companion sending one again doesn't
  // bring it back (410), unless the player turns it on again there (restore).
  `CREATE TABLE IF NOT EXISTS picture_tombstones (
    user_id TEXT NOT NULL, cid TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY (user_id, cid))`,
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

// The signed-in user for this request, or null. session_expires: when this sign-in ends (the site header stops
// trusting what it remembers then, public/header.js).
export async function currentUser(env, request) {
  const token = cookieValue(request, COOKIE);
  if (!env.DB || !/^[0-9a-f]{64}$/.test(token)) return null;
  await setup(env);
  return env.DB.prepare(
    "SELECT u.*, s.expires AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?"
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

// Everything we hold about a user, deleted (or, for a record we must keep, stripped of the account) in one batch by
// "Delete my account". A feature that stores per-user rows adds its CREATE TABLE to SETUP above (so the table exists
// here) and a line here. `users` must stay last. A published voice whose owner is gone drops off the site
// (lib/voices.js). What stays is listed on public/privacy.html.
const USER_DATA = [
  ["DELETE FROM sessions WHERE user_id = ?", u => u.id],
  ["DELETE FROM voices WHERE owner = ?", u => u.id],
  // Text already pulled into a language pack stays there (CC BY-SA), without a link back to the account.
  ["DELETE FROM translator_languages WHERE user_id = ?", u => u.id],
  ["DELETE FROM translation_edits WHERE user_id = ?", u => u.id],
  ["DELETE FROM studio_takes WHERE owner = ?", u => u.id],
  ["DELETE FROM studio_release WHERE user_id = ?", u => u.id],
  ["DELETE FROM studio_uploads WHERE owner = ?", u => u.id],
  ["DELETE FROM studio_claims WHERE owner = ?", u => u.id],
  // A lent voice (lib/donate.js): the sample and test pack are R2 files under studio/<user id>/, deleted below. The
  // record of the terms the donor signed stays as proof of the license, like a sent voice's narrator release in
  // voice_submissions: withdrawn, without the account (owner ""), the credit or the files' details (RECORD_ONLY). Each
  // donation keeps its own copy of what was signed, so the per-account donation_release row goes.
  [`UPDATE voice_donations SET owner = '', status = 'withdrawn', ${RECORD_ONLY}, ` +
   "withdrawn = COALESCE(withdrawn, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updated = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') " +
   "WHERE owner = ?", u => u.id],
  ["DELETE FROM donation_release WHERE user_id = ?", u => u.id],
  ["DELETE FROM rate_limits WHERE user_id = ?", u => u.id],
  // Their pictures (the files under pictures/<user id>/, deleted below) and the reports on them, and the reports they
  // sent (a picture those helped hide stays hidden).
  ["DELETE FROM picture_reports WHERE picture_id IN (SELECT id FROM profile_pictures WHERE user_id = ?)", u => u.id],
  ["DELETE FROM picture_reports WHERE user_id = ?", u => u.id],
  ["DELETE FROM profile_pictures WHERE user_id = ?", u => u.id],
  ["DELETE FROM picture_tombstones WHERE user_id = ?", u => u.id],
  ["DELETE FROM profiles WHERE user_id = ?", u => u.id],
  ["DELETE FROM devices WHERE user_id = ?", u => u.id],
  ["DELETE FROM device_links WHERE user_id = ?", u => u.id],
  ["DELETE FROM clip_reports WHERE user_id = ?", u => u.id],
  ["DELETE FROM users WHERE id = ?", u => u.id],
];

export async function deleteUser(env, user) {
  await setup(env);
  // Their uploaded recordings (R2 keys studio/<user id>/...), pictures (pictures/<user id>/...) and their story's
  // recordings (story-voice/<user id>/..., lib/storyvoice.js) go first, so no file outlives its row.
  if (env.STUDIO) {
    for (const prefix of [`studio/${user.id}/`, `pictures/${user.id}/`, `story-voice/${user.id}/`]) {
      let cursor;
      do {
        const page = await env.STUDIO.list({ prefix, cursor });
        if (page.objects.length) await env.STUDIO.delete(page.objects.map(o => o.key));
        cursor = page.truncated ? page.cursor : null;
      } while (cursor);
    }
  }
  // Forever text they shared (lib/contribute.js) stays, without a link to the account. Its tables only exist after
  // the first upload, so this may have nothing to do.
  try { await forgetContributor(env, user.id); } catch (e) { /* no shared text yet */ }
  // The story recordings' rows (lib/storyvoice.js makes that table the first time it runs).
  try { await env.DB.prepare("DELETE FROM story_audio WHERE user_id = ?").bind(user.id).run(); } catch (e) { /* none yet */ }
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
                                  "studio", "lines", "lend", "lend-terms", "zones", "donation"]);

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
