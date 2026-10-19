// One click from Willo, the companion app, to the site, already signed in: its "Change plan" and "Billing" buttons and
// its "Available on Hero" links open the browser on the same account Willo is signed in to, with no second Google
// sign-in. The app asks POST /api/companion/web-login with its device token (lib/devices.js currentDevice) and gets a
// short-lived one-time link; the browser opens GET /link/web?t=...&next=/plans (functions/link/web.js), which takes
// the link, signs the browser in with an ordinary session (lib/accounts.js startSession, as Google sign-in does) and
// goes on to `next`. Kept outside functions/ so Pages doesn't route it.
//   - Single use: taking a link deletes it in the same statement, so two opens of it can't both sign in.
//   - Short-lived: WEB_LOGIN_SECONDS, long enough for the browser to open, too short to be worth taking from a history.
//   - Hashed: D1 keeps only the link's SHA-256 (web_logins, lib/accounts.js SETUP), like sessions and device tokens.
//   - Bound to the app: a link signs in only the account of the app that asked, and only while that app is still
//     connected (Disconnect on /account or Sign out in the app, and its open links stop working).
//   - `next` is an allowlist (safeNext): /plans, /account, /privacy or /willo/keeps (What Willo keeps, LOR-666), an
//     optional ?from=willo-<word> for counting where players came from, and an optional #anchor. Never another site,
//     so it's no open redirect.
// A link that's expired, used or made up lands on the sign-in page (/account) with a plain line, never an error page.

import { sha256 } from "./accounts.js";

export const WEB_LOGIN_SECONDS = 120;

const NEXT = /^\/(plans|account|privacy|willo\/keeps)(\?from=willo-[a-z]{1,20})?(#[a-z][a-z0-9-]{0,30})?$/;

// `next` when it's one of the pages Willo may open, else null.
export const safeNext = next => typeof next === "string" && NEXT.test(next) ? next : null;

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
const iso = ms => new Date(ms).toISOString();

// A new one-time link's secret for this app's account (app: lib/devices.js currentDevice). Old links go first.
export async function issueWebLogin(env, app, now = Date.now()) {
  await env.DB.prepare("DELETE FROM web_logins WHERE expires <= ?").bind(iso(now)).run();
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO web_logins (token_hash, user_id, device_id, created, expires) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(token), app.user.id, app.device.id, iso(now), iso(now + WEB_LOGIN_SECONDS * 1000)).run();
  return token;
}

// The account id a link signs in, taking the link (once); null when it's expired, used, made up, or its app has
// been disconnected since.
export async function takeWebLogin(env, token, now = Date.now()) {
  if (!/^[0-9a-f]{64}$/.test(String(token || ""))) return null;
  const row = await env.DB.prepare("DELETE FROM web_logins WHERE token_hash = ? RETURNING user_id, device_id, expires")
    .bind(await sha256(token)).first();
  if (!row || row.expires <= iso(now)) return null;
  const app = await env.DB.prepare("SELECT 1 AS y FROM devices WHERE id = ? AND user_id = ?")
    .bind(row.device_id, row.user_id).first();
  return app ? row.user_id : null;
}
