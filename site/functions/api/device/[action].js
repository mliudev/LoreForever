// Connected apps (lib/devices.js, LOR-148): linking the companion app to an account, so it keeps the player's profile
// up to date (POST /api/profile/sync), and disconnecting it.
//   From the companion (X-LF-Client: companion/<version>, no Origin):
//     POST /api/device/start       {} -> {device_code, user_code, verification_uri, verification_uri_complete,
//                                  expires_in, interval}: the companion opens verification_uri_complete (/link?code=)
//     POST /api/device/token       {device_code}, every `interval` seconds -> 202 {pending} until the player clicks
//                                  Connect, then {token} (once); 410 {expired} or 403 {denied} when it's over
//     GET  /api/device/status      (Authorization: Bearer <token>) -> {connected, profile}: the profile's summary
//                                  (null until there is one), so the companion knows which character to send
//     POST /api/device/disconnect  (Authorization: Bearer <token>) -> the token stops working
//   From our pages (signed in; POSTs with our Origin), for /link and /account:
//     GET  /api/device/link?code=  -> {link: {code, label, expires}}: the open link with that code (404 when none)
//     POST /api/device/approve     {code} -> connects the app showing that code to your account
//     POST /api/device/deny        {code}
//     GET  /api/device/list        -> {devices: [{id, label, created, last_used, last_sync}]}
//     POST /api/device/revoke      {id} -> Disconnect
// Rate limits: start 20 an hour and token 60 a minute per sender (daily IP hash), the signed-in ones 10 a minute per
// account, status 30 a minute per account.

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { profileOf, sheetLine } from "../../../lib/profiles.js";
import {
  startLink, openLink, decideLink, claimToken, currentDevice, listDevices, revokeDevice, forgetDevice, normalizeCode,
} from "../../../lib/devices.js";
import { perMinute, perHour, slowDown } from "../../../lib/ratelimit.js";
import { senderHash } from "../../../lib/form.js";
import { historyEnabled } from "../../../lib/history.js";

const ok = (body = {}, status = 200) => Response.json({ ok: true, ...body }, { status, headers: noStore });
const COMPANION = /^companion\/[\w.-]{1,24}$/;
const fromCompanion = request => COMPANION.test(request.headers.get("X-LF-Client") || "") && !request.headers.get("Origin");
const ipKey = async (env, request) =>
  "ip:" + await senderHash(env, request.headers.get("CF-Connecting-IP") || "", new Date().toISOString().slice(0, 10));
const tooMany = (retryAfter = 3600) => Response.json({ ok: false, error: "Too many tries. Please wait a while.", retryAfter },
  { status: 429, headers: { ...noStore, "Retry-After": String(retryAfter) } });

const NO_LINK = "That code has expired or was already used. In the companion, click Connect to my profile again.";

// ---- The companion ----

async function start({ request, env }) {
  if (!(await perHour(env, await ipKey(env, request), "device-start", 20))) return tooMany();
  const link = await startLink(env);
  const origin = new URL(request.url).origin;
  return ok({ ...link, verification_uri: `${origin}/link`,
              verification_uri_complete: `${origin}/link?code=${encodeURIComponent(link.user_code)}` });
}

async function token({ request, env }, input) {
  if (!(await perMinute(env, await ipKey(env, request), "device-poll", 60))) return slowDown();
  const out = await claimToken(env, input.device_code);
  if (out.pending) return Response.json({ ok: false, pending: true }, { status: 202, headers: noStore });
  if (out.gone === "denied") return Response.json({ ok: false, denied: true, error: "The connection was turned down." },
    { status: 403, headers: noStore });
  if (out.gone) return Response.json({ ok: false, expired: true, error: NO_LINK }, { status: 410, headers: noStore });
  return ok({ token: out.token, device: out.device });
}

async function status({ env }, app) {
  if (!(await perMinute(env, app.user.id, "device-status", 30))) return slowDown();
  const p = await profileOf(env, app.user.id);
  return ok({
    ...(historyEnabled(env) ? { historyVersion: 2 } : {}),
    connected: true, device: { id: app.device.id, last_sync: app.device.last_sync },
    profile: p ? { name: p.data.name, realm: p.data.realm, sheet: sheetLine(p.data), handle: p.handle,
                   url: "/u/" + p.handle, public: Boolean(p.public), updated: p.updated } : null,
  });
}

async function disconnect({ env }, app) {
  await forgetDevice(env, app.device.id);
  return ok({ connected: false });
}

// ---- Our pages ----

async function link({ request, env }, user) {
  if (!(await perMinute(env, user.id, "device-link", 10))) return slowDown();
  const row = await openLink(env, new URL(request.url).searchParams.get("code"));
  return row ? ok({ link: { code: row.user_code, label: row.label, expires: row.expires } }) : fail(404, NO_LINK);
}

async function decide({ env }, input, user, approve) {
  if (!(await perMinute(env, user.id, "device-link", 10))) return slowDown();
  if (!normalizeCode(input.code)) return fail(400, "Type the 8-letter code the companion shows.");
  if (!(await decideLink(env, input.code, user, approve))) return fail(404, NO_LINK);
  return ok({ connected: approve });
}

async function list({ env }, user) {
  return ok({ devices: await listDevices(env, user.id) });
}

async function revoke({ env }, input, user) {
  return (await revokeDevice(env, user.id, input.id)) ? ok({ devices: await listDevices(env, user.id) })
    : fail(404, "That app isn't connected to your account.");
}

const PAGE_GETS = { link, list };
const PAGE_POSTS = {
  approve: (c, input, user) => decide(c, input, user, true),
  deny: (c, input, user) => decide(c, input, user, false),
  revoke,
};

export async function onRequest(context) {
  const { request, env, params } = context;
  const action = String(params.action);
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  await setup(env);

  if (action === "start" || action === "token" || action === "status" || action === "disconnect") {
    if (!fromCompanion(request)) return fail(403, "This is for the Lore Forever companion app.");
    const method = action === "status" ? "GET" : "POST";
    if (request.method !== method) return fail(405, `Use ${method}.`);
    if (action === "start" || action === "token") {
      let input = {};
      try { input = await request.json(); } catch (e) {}
      return action === "start" ? start(context) : token(context, input && typeof input === "object" ? input : {});
    }
    const app = await currentDevice(env, request);
    if (!app) return fail(401, "This app isn't connected to an account any more.");
    return action === "status" ? status(context, app) : disconnect(context, app);
  }

  if (request.method === "GET") {
    if (!PAGE_GETS[action]) return fail(404, "Not found.");
    const user = await currentUser(env, request);
    return user ? PAGE_GETS[action](context, user) : fail(401, "You're signed out. Please sign in again.");
  }
  if (request.method !== "POST") return fail(405, "Use POST.");
  if (!PAGE_POSTS[action]) return fail(404, "Not found.");
  if (!sameOrigin(request)) return fail(403, "Please use the page on loreforeverwow.com.");
  const user = await currentUser(env, request);
  if (!user) return fail(401, "You're signed out. Please sign in again.");
  let input;
  try { input = await request.json(); } catch (e) { return fail(400, "Couldn't read that."); }
  if (!input || typeof input !== "object") return fail(400, "Couldn't read that.");
  return PAGE_POSTS[action](context, input, user);
}
