// The hidden lore passages a character has reached, for Willo on the phone (story as you play, slice 5,
// docs/story-beats.md; lib/willo-passages.js). The phone names the entries a question is about; the site answers with
// the spoiler sections whose story beats that character's last save has all opened (lib/willo-stock.js `beats`, sent
// by the PC's app with its profile update). Nothing hidden is ever public: a character with no save, or no beats in it,
// gets none, and Willo answers from the spoiler-free pages as before.
//   POST /api/companion/passages  {"character": the add-on's "Name-Realm", "keys": ["topic:defias-brotherhood", ...]}
//   -> {"ok": true, "passages": [{"id": "zone:westfall#section4", "key", "title", "text"}]}
// Needs the companion's account link (Authorization: Bearer <device token>) and "X-LF-Client: companion/<version>".
// Costs no answer; at most PER_DAY a day per account.

import { setup, fail, noStore } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { perDay } from "../../../lib/ratelimit.js";
import { pageOf } from "../../../lib/willo-notebook.js";
import { savedStock } from "../../../lib/willo-stock.js";
import { passagesFor } from "../../../lib/willo-passages.js";

const CLIENT = /^companion\/[\w.-]{1,24}$/;
const MAX_BODY_BYTES = 4 * 1024;
export const PER_DAY = 1000;

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  if (!CLIENT.test(request.headers.get("X-LF-Client") || "") || request.headers.get("Origin"))
    return fail(403, "This is for the Lore Forever companion app.");
  await setup(env);
  const app = await currentDevice(env, request);
  if (!app) return fail(401, "Connect the companion to your account first.");
  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail(413, "That's too long to send.");
    body = JSON.parse(text);
  } catch { return fail(400, "Couldn't read that."); }
  const page = pageOf(body?.character);
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  if (!page || page === "account" || !keys.length) return Response.json({ ok: true, passages: [] }, { headers: noStore });
  if (!(await perDay(env, app.user.id, "companion-passages", PER_DAY))) return fail(429, "That's plenty for today.");
  const row = await env.DB.prepare("SELECT stock FROM willo_stock WHERE user_id = ? AND character = ?")
    .bind(app.user.id, page.slice(5)).first();
  const stock = row ? savedStock(row.stock) : null;
  return Response.json({ ok: true, passages: passagesFor(stock?.beats, keys) }, { headers: noStore });
}
