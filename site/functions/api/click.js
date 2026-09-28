// Counts clicks on the landing page's download button, per day, in a free Cloudflare D1 database.
// Needs a D1 database bound as DB in the Pages project settings; without it, clicks are ignored.
//   POST /api/click  adds one (sent by the page when someone clicks Download)
//   GET  /api/click  returns {"total": N, "days": [{"day": "2026-09-27", "n": 3}, ...]}

const SETUP = "CREATE TABLE IF NOT EXISTS clicks (day TEXT PRIMARY KEY, n INTEGER NOT NULL)";

export async function onRequestPost({ env }) {
  if (env.DB) {
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.batch([
      env.DB.prepare(SETUP),
      env.DB.prepare("INSERT INTO clicks (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1").bind(day),
    ]);
  }
  return new Response(null, { status: 204 });
}

export async function onRequestGet({ env }) {
  if (!env.DB) return Response.json({ total: 0, days: [], note: "No D1 database bound as DB" });
  await env.DB.prepare(SETUP).run();
  const total = await env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS total FROM clicks").first("total");
  const { results } = await env.DB.prepare("SELECT day, n FROM clicks ORDER BY day DESC LIMIT 90").all();
  return Response.json({ total, days: results });
}
