// Counts clicks on the landing page's download button, per day, in a free Cloudflare D1 database.
// Needs a D1 database bound as DB in the Pages project settings; without it, clicks are ignored.
//   POST /api/click  adds one (sent by the page when someone clicks Download): only from this site's own pages, and at
//                    most CLICKS_PER_DAY from one sender a day (lib/ratelimit.js perDayFromIp); the rest are a 204
//                    that counts nothing, so a script can't run the count up (the architect's launch review, 10/21)
//   GET  /api/click  returns {"total": N, "days": [{"day": "2026-09-27", "n": 3}, ...]}; needs the admin key
//                    ("Authorization: Bearer <key>", same as /api/admin)

import { authorized } from "../../lib/auth.js";
import { perDayFromIp } from "../../lib/ratelimit.js";

const SETUP = "CREATE TABLE IF NOT EXISTS clicks (day TEXT PRIMARY KEY, n INTEGER NOT NULL)";
const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
export const CLICKS_PER_DAY = 30;

// A browser says where a request came from (Sec-Fetch-Site, else Origin); one that says nothing (an old browser) is
// let through, the day's limit still holding it.
function ownPage(request) {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("Origin");
  try { return !origin || new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

export async function onRequestPost({ request, env }) {
  if (env.DB && ownPage(request) && await perDayFromIp(env, request, "click", CLICKS_PER_DAY)) {
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.batch([
      env.DB.prepare(SETUP),
      env.DB.prepare("INSERT INTO clicks (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1").bind(day),
    ]);
  }
  return new Response(null, { status: 204 });
}

export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env))) return Response.json({ error: "Needs the admin key." }, { status: 401, headers: NO_STORE });
  if (!env.DB) return Response.json({ total: 0, days: [], note: "No D1 database bound as DB" }, { headers: NO_STORE });
  await env.DB.prepare(SETUP).run();
  const total = await env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS total FROM clicks").first("total");
  const { results } = await env.DB.prepare("SELECT day, n FROM clicks ORDER BY day DESC LIMIT 90").all();
  return Response.json({ total, days: results }, { headers: NO_STORE });
}
