// Totals for Patrick's "is the site the download source?" test: downloads through the site's own links
// (/download/installer, /download/zip), sign-ups, and Download clicks. Counts only; no email addresses.
//   GET /api/stats -> {"siteDownloads": {"total": N, "installer": N, "zip": N, "days": [...]},
//                      "signups": N, "clicks": N}

async function safe(query) { try { return await query; } catch (e) { return null; } }   // table may not exist yet

export async function onRequestGet({ env }) {
  if (!env.DB) return Response.json({ note: "No D1 database bound as DB" });
  const byFile = (await safe(env.DB.prepare("SELECT file, SUM(n) AS n FROM downloads GROUP BY file").all()))?.results || [];
  const days = (await safe(env.DB.prepare("SELECT day, file, n FROM downloads ORDER BY day DESC LIMIT 60").all()))?.results || [];
  const signups = (await safe(env.DB.prepare("SELECT COUNT(*) AS n FROM subscribers WHERE source != 'selftest'").first("n"))) || 0;
  const clicks = (await safe(env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM clicks").first("n"))) || 0;
  const count = f => byFile.find(r => r.file === f)?.n || 0;
  return Response.json({
    siteDownloads: { total: count("installer") + count("zip"), installer: count("installer"), zip: count("zip"), days },
    signups, clicks,
  }, { headers: { "cache-control": "no-store" } });
}
