// Where a visit started (lib/sources.js): header.js asks once per tab when a page is opened from another site, a
// tracked link or an address with ?src=, never for a click inside the site.
//   POST /api/visit {src (the page's ?src=), landing (its path), ref (document.referrer)} -> 204
// Counts the visit under its source and landing page, and keeps a browser's first source in its lf_src cookie (30
// days: the source and the page, nothing else). Our pages only (Origin), 30 a minute per sender; link previews and
// crawlers don't count.

import { sameOrigin } from "../../lib/accounts.js";
import { perMinute } from "../../lib/ratelimit.js";
import { senderHash } from "../../lib/form.js";
import { BOT } from "../../lib/usage.js";
import { visitSource, firstTouch, firstTouchCookie, countEvent } from "../../lib/sources.js";

const done = (cookie = null) => new Response(null, { status: 204,
  headers: { "Cache-Control": "no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) } });

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.DB || !sameOrigin(request) || BOT.test(request.headers.get("User-Agent") || "")) return done();
  let input;
  try { input = JSON.parse((await request.text()).slice(0, 2000)); } catch (e) { return done(); }
  if (!input || typeof input !== "object") return done();
  const host = new URL(request.url).hostname;
  const visit = visitSource({ asked: input.src, ref: input.ref, landing: input.landing }, host);
  if (!visit) return done();
  const day = new Date().toISOString().slice(0, 10);
  const key = "ip:" + await senderHash(env, request.headers.get("CF-Connecting-IP") || "", day);
  if (!(await perMinute(env, key, "visit", 30))) return done();
  const first = !firstTouch(request);
  const counting = Promise.all([countEvent(env, visit.src, visit.landing, "visit"),
    first ? countEvent(env, visit.src, visit.landing, "new") : null]);
  if (waitUntil) waitUntil(counting); else await counting;
  return done(first ? firstTouchCookie(request, visit.src, visit.landing) : null);
}
