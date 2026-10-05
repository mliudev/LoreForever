// Connected apps (LOR-148): the Lore Forever companion on a player's PC, linked to their account, keeps their profile
// up to date by itself (POST /api/profile/sync after each /reload or logout), so nobody copies and pastes their journey
// record again. API in functions/api/device/[action].js; the page that approves a link is public/link.html; /account
// lists them under "Connected apps". Kept outside functions/ so Pages doesn't route it.
//
// Linking is a device code, as a TV signs in: the companion asks for a link (startLink) and opens
// /link?code=BCDF-GHJK in the browser; the player, signed in there, clicks Connect (approveLink); the companion, asking
// every few seconds (claimToken), then gets its own token, once. Codes last LINK_MINUTES. D1 keeps only SHA-256
// hashes, of the link's secret device code and of each app's token, as it does for sessions (lib/accounts.js), so a
// leaked table can't act for anyone. A token can only update its account's profile and read that profile's summary.
// It's revoked from /account (revokeDevice) or by the companion's Disconnect (forgetDevice), stops working after
// TOKEN_DAYS without use, and goes with the account (lib/accounts.js USER_DATA: devices, device_links).

import { sha256 } from "./accounts.js";

export const LINK_MINUTES = 10;
export const POLL_SECONDS = 3;          // how often the companion asks whether its link was approved
export const TOKEN_DAYS = 365;          // a token unused this long stops working
export const LABEL = "Lore Forever companion";

// Link codes: 8 characters people can read out and type, without vowels (no words) or look-alikes (0/O, 1/I/L).
const ALPHABET = "BCDFGHJKMNPQRSTVWXZ23456789";

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
const randomHex = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)));
const iso = (ms = Date.now()) => new Date(ms).toISOString();

// A random link code, "BCDF-GHJK" (unbiased: bytes past the last whole multiple of the alphabet are skipped).
export function newUserCode() {
  const max = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < max && out.length < 8) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out.slice(0, 4) + "-" + out.slice(4);
}

// A code as typed ("bcdf ghjk", "BCDF-GHJK") in its stored form, or null when it can't be one.
export function normalizeCode(s) {
  const c = String(s ?? "").toUpperCase().replace(/[\s-]+/g, "");
  return c.length === 8 && [...c].every(ch => ALPHABET.includes(ch)) ? c.slice(0, 4) + "-" + c.slice(4) : null;
}

// ---- Linking ----

// A new link for a companion: {device_code (its secret, only ever sent to it), user_code, expires_in, interval}.
export async function startLink(env, label = LABEL) {
  const now = Date.now();
  await env.DB.prepare("DELETE FROM device_links WHERE expires < ?").bind(iso(now)).run();
  const deviceCode = randomHex();
  for (let attempt = 0; ; attempt++) {
    const userCode = newUserCode();
    try {
      await env.DB.prepare(
        "INSERT INTO device_links (code_hash, user_code, label, status, created, expires) VALUES (?, ?, ?, 'pending', ?, ?)"
      ).bind(await sha256(deviceCode), userCode, label, iso(now), iso(now + LINK_MINUTES * 60e3)).run();
      return { device_code: deviceCode, user_code: userCode, expires_in: LINK_MINUTES * 60, interval: POLL_SECONDS };
    } catch (e) {
      if (attempt >= 4) throw e;   // the same code as another open link: draw again
    }
  }
}

// The open (pending, not expired) link with this code, or null.
export async function openLink(env, code) {
  const c = normalizeCode(code);
  if (!c) return null;
  return env.DB.prepare("SELECT user_code, label, expires FROM device_links WHERE user_code = ? AND status = 'pending' AND expires > ?")
    .bind(c, iso()).first();
}

// The signed-in player approves (or turns down) the link with this code. False when there's no such open link.
export async function decideLink(env, code, user, approve) {
  const c = normalizeCode(code);
  if (!c) return false;
  const res = await env.DB.prepare(
    "UPDATE device_links SET status = ?, user_id = ? WHERE user_code = ? AND status = 'pending' AND expires > ?"
  ).bind(approve ? "approved" : "denied", user.id, c, iso()).run();
  return res.meta.changes > 0;
}

// The companion asks whether its link went through. {pending} while waiting; {token, device} once approved (only the
// first ask gets it: the link is gone after that); {gone: "expired" | "denied"} otherwise.
export async function claimToken(env, deviceCode) {
  if (!/^[0-9a-f]{64}$/.test(String(deviceCode || ""))) return { gone: "expired" };
  const hash = await sha256(deviceCode);
  const link = await env.DB.prepare("SELECT status, expires FROM device_links WHERE code_hash = ?").bind(hash).first();
  if (!link || link.expires <= iso()) return { gone: "expired" };
  if (link.status === "pending") return { pending: true };
  if (link.status === "denied") {
    await env.DB.prepare("DELETE FROM device_links WHERE code_hash = ?").bind(hash).run();
    return { gone: "denied" };
  }
  // Approved: taken by exactly one ask, even when two arrive together.
  const taken = await env.DB.prepare(
    "DELETE FROM device_links WHERE code_hash = ? AND status = 'approved' RETURNING user_id, label"
  ).bind(hash).first();
  if (!taken?.user_id) return { gone: "expired" };
  const token = randomHex(), id = crypto.randomUUID(), now = iso();
  await env.DB.prepare(
    "INSERT INTO devices (id, token_hash, user_id, label, created, last_used) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, await sha256(token), taken.user_id, taken.label || LABEL, now, now).run();
  return { token, device: { id, label: taken.label || LABEL, created: now } };
}

// ---- Using a token ----

// The app and its account for a request with "Authorization: Bearer <token>", or null (no token, revoked, unused for
// TOKEN_DAYS, or the account is gone). Notes when it was last used.
export async function currentDevice(env, request) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!env.DB || !/^[0-9a-f]{64}$/.test(token)) return null;
  const now = Date.now();
  const row = await env.DB.prepare(
    "SELECT d.id AS device_id, d.label AS device_label, d.last_sync AS device_last_sync, u.* FROM devices d " +
    "JOIN users u ON u.id = d.user_id WHERE d.token_hash = ? AND COALESCE(d.last_used, d.created) > ?"
  ).bind(await sha256(token), iso(now - TOKEN_DAYS * 86400e3)).first();
  if (!row) return null;
  await env.DB.prepare("UPDATE devices SET last_used = ? WHERE id = ?").bind(iso(now), row.device_id).run();
  const { device_id, device_label, device_last_sync, ...user } = row;
  return { device: { id: device_id, label: device_label, last_sync: device_last_sync }, user };
}

export async function markSynced(env, deviceId) {
  await env.DB.prepare("UPDATE devices SET last_sync = ? WHERE id = ?").bind(iso(), deviceId).run();
}

// ---- What /account shows and does ----

export async function listDevices(env, userId) {
  const { results } = await env.DB.prepare(
    "SELECT id, label, created, last_used, last_sync FROM devices WHERE user_id = ? ORDER BY created"
  ).bind(userId).all();
  return results;
}

// Disconnect from /account: the app's token stops working at once. False when it isn't one of this account's.
export async function revokeDevice(env, userId, id) {
  const res = await env.DB.prepare("DELETE FROM devices WHERE id = ? AND user_id = ?").bind(String(id || ""), userId).run();
  return res.meta.changes > 0;
}

// Disconnect from the companion itself.
export async function forgetDevice(env, deviceId) {
  await env.DB.prepare("DELETE FROM devices WHERE id = ?").bind(deviceId).run();
}
