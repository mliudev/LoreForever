// Counts from the /discord redirect, for the weekly funnel check. Needs the admin key
// ("Authorization: Bearer <key>", same as /api/admin).
//   GET /api/discord  returns {"total": N, "sources": {"site": 3, ...}, "days": [{"day": "2026-09-29", "src": "site", "n": 3}, ...]}

import { authorized } from "../../lib/auth.js";
import { SETUP } from "../../lib/discord.js";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env))) return Response.json({ error: "Needs the admin key." }, { status: 401, headers: NO_STORE });
  if (!env.DB) return Response.json({ total: 0, sources: {}, days: [], note: "No D1 database bound as DB" }, { headers: NO_STORE });
  await env.DB.prepare(SETUP).run();
  const { results: bySource } = await env.DB.prepare(
    "SELECT src, SUM(n) AS n FROM discord_clicks GROUP BY src ORDER BY n DESC",
  ).all();
  const { results: days } = await env.DB.prepare(
    "SELECT day, src, n FROM discord_clicks ORDER BY day DESC, src LIMIT 200",
  ).all();
  const sources = Object.fromEntries(bySource.map((r) => [r.src, r.n]));
  const total = bySource.reduce((sum, r) => sum + r.n, 0);
  return Response.json({ total, sources, days }, { headers: NO_STORE });
}
