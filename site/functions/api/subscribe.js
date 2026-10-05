// Saves an email from the landing page's optional sign-up form in the D1 database bound as DB.
// No confirmation step: Mike wants the simplest flow ("get an email and move on"). Taking it off again is
// /unsubscribe (functions/api/unsubscribe.js).
//   POST /api/subscribe  {"email": "...", "source": "landing-page"}  -> 204, or 400 for a bad address, 403 from
//                        another site, 429 past PER_DAY.subscribe sign-ups from one sender today (lib/subscribers.js)
// There's deliberately no GET: read the list in the Cloudflare dashboard (D1 > loreforever > Console).

import { sameOrigin } from "../../lib/accounts.js";
import { perDayFromIp } from "../../lib/ratelimit.js";
import { SETUP, PER_DAY, listEmail } from "../../lib/subscribers.js";

const fail = (status, error) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return fail(403, "Please use the form on loreforeverwow.com.");
  let body = {};
  try { body = await request.json(); } catch (e) {}
  if (body.website) return new Response(null, { status: 204 });   // hidden field only bots fill in
  const email = listEmail(body.email);
  if (!email) return fail(400, "invalid email");
  const source = String(body.source || "").slice(0, 40);
  if (env.DB) {
    if (!(await perDayFromIp(env, request, "subscribe", PER_DAY.subscribe))) {
      return fail(429, "That's a lot of sign-ups for one day. Please try again tomorrow.");
    }
    await env.DB.batch([
      env.DB.prepare(SETUP),
      env.DB.prepare("INSERT INTO subscribers (email, source, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING")
        .bind(email, source, new Date().toISOString()),
    ]);
  }
  return new Response(null, { status: 204 });
}
