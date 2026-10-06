// The picture book (lib/pictures.js; the "pictures" feature, lib/features.js):
//   POST   /api/profile/pictures           multipart: meta (JSON {cid, t, realm, faction, race, class, lv, z, s, at,
//                                          w, h, clean, caption, restore}) and image (the JPEG, at most 1 MB) ->
//                                          {picture, created}. The same cid again updates that picture; without image,
//                                          only its meta (404 {missing} when there's no such picture yet). 409 {full}
//                                          at 500. 410 {removed} for a picture its owner removed on the page, unless
//                                          it's the whole picture with restore: true ("On my profile" turned on again)
//   DELETE /api/profile/pictures?cid=     (or ?id=) removes one of your pictures and its file -> {removed} (false when
//                                          there was none, so twice is fine). From the page, its cid is remembered
//                                          (the 410 above); from the companion, not.
//   GET    /api/profile/pictures?handle=  that profile's pictures, newest first -> {pictures: [{id, url, t, w, h, lv,
//                                          zone, subzone, caption}]}: a public profile's, not hidden, while the feature
//                                          is on (or with &pictures=1); its owner always gets all of theirs, hidden ones
//                                          marked (with cid, clean and hidden).
// POST and DELETE take the companion's token ("Authorization: Bearer <token>", lib/devices.js; no Origin, as for
// /api/profile/sync), or a session from our own pages (Origin check). 30 a minute and 600 an hour per account.

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../../lib/accounts.js";
import { currentDevice } from "../../../../lib/devices.js";
import { profileByHandle } from "../../../../lib/profiles.js";
import { featureOn } from "../../../../lib/features.js";
import { perMinute, perHour, slowDown } from "../../../../lib/ratelimit.js";
import {
  readMeta, savePicture, removePicture, listPictures, shown, MAX_BYTES, PER_MINUTE, PER_HOUR,
} from "../../../../lib/pictures.js";

const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });
const MAX_BODY = MAX_BYTES + 64 * 1024;   // the image, the meta and the multipart framing

// The request body as bytes, or null once it's longer than `max` (stops reading there, Content-Length or not).
async function readCapped(request, max) {
  if (Number(request.headers.get("Content-Length") || 0) > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.byteLength; }
  return bytes;
}

// Who's asking: the companion (its token, no Origin: it isn't a browser), or our own pages (their Origin, which
// browsers always send on a POST or DELETE, and a session). {user} or {error}.
async function caller(env, request) {
  const origin = request.headers.get("Origin");
  if (origin && !sameOrigin(request)) return { error: fail(403, "Please use the page on loreforeverwow.com.") };
  if (!origin || request.headers.get("Authorization")) {
    const app = await currentDevice(env, request);
    return app ? { user: app.user }
      : { error: fail(401, "This app isn't connected to an account. Connect it again from the companion.") };
  }
  const user = await currentUser(env, request);
  return user ? { user, onPage: true } : { error: fail(401, "You're signed out. Please sign in again.") };
}

async function limited(env, user) {
  if (!(await perMinute(env, user.id, "pictures", PER_MINUTE))) return slowDown();
  if (!(await perHour(env, user.id, "pictures-hour", PER_HOUR))) {
    const retryAfter = 3600 - (Math.floor(Date.now() / 1000) % 3600);
    return Response.json({ ok: false, error: "Too many pictures this hour.", retryAfter },
      { status: 429, headers: { ...noStore, "Retry-After": String(retryAfter) } });
  }
  return null;
}

async function upload(env, request, user) {
  if (!/^multipart\/form-data/i.test(request.headers.get("Content-Type") || "")) {
    return fail(400, "Send the picture as multipart/form-data (meta and image).");
  }
  const bytes = await readCapped(request, MAX_BODY);
  if (bytes === null) return fail(413, "That picture is over 1 MB.");
  let form;
  try {
    form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("Content-Type") } }).formData();
  } catch (e) {
    return fail(400, "Couldn't read that.");
  }
  const rawMeta = form.get("meta");
  const meta = readMeta(typeof rawMeta === "string" ? rawMeta : rawMeta ? await rawMeta.text() : "");
  if (meta.error) return fail(400, meta.error);
  const file = form.get("image");
  if (file !== null && typeof file === "string") return fail(415, "Only JPEG pictures, please.");
  const image = file ? new Uint8Array(await file.arrayBuffer()) : null;
  const { status, body } = await savePicture(env, user.id, meta, image);
  return Response.json(body, { status, headers: noStore });
}

async function remove(env, request, user, onPage) {
  const q = new URL(request.url).searchParams;
  const id = q.get("id") || "", cid = q.get("cid") || "";
  if (!id && !cid) return fail(400, "Say which picture (cid or id).");
  return ok({ removed: await removePicture(env, user.id, { id, cid }, { onPage }) });
}

async function list(env, request) {
  const q = new URL(request.url).searchParams;
  const handle = String(q.get("handle") || "").toLowerCase();
  const p = /^[a-z0-9-]{1,40}$/.test(handle) ? await profileByHandle(env, handle) : null;
  const viewer = request.headers.get("Authorization") ? (await currentDevice(env, request))?.user
    : await currentUser(env, request);
  const owner = Boolean(p && viewer && viewer.id === p.user_id);
  // Like the page: a private profile is "not found" for everyone but its owner, and so is the picture book while the
  // feature is off (unless asked for with pictures=1).
  if (!p || (!p.public && !owner) || (!owner && !featureOn(env, "pictures") && q.get("pictures") !== "1")) {
    return fail(404, "No pictures here.");
  }
  return ok({ pictures: (await listPictures(env, p.user_id, { all: owner })).map(r => shown(r, owner)) });
}

export async function onRequest({ request, env }) {
  if (!env.DB) return fail(503, "Profiles aren't set up yet.");
  await setup(env);
  if (request.method === "GET") return list(env, request);
  if (request.method !== "POST" && request.method !== "DELETE") return fail(405, "Use POST, DELETE or GET.");
  if (!env.STUDIO) return fail(503, "Pictures aren't set up yet.");
  const { user, onPage, error } = await caller(env, request);
  if (error) return error;
  const slow = await limited(env, user);
  if (slow) return slow;
  return request.method === "POST" ? upload(env, request, user) : remove(env, request, user, onPage);
}
