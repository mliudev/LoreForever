// The site's own download links: /download/installer, /download/zip and /download/complete (the add-on with every
// narration: the default voice's lands packs bundled, from scripts/build-release.sh --complete). Each one counts the download per
// day in the D1 database (bound as DB), then redirects to the file on the latest GitHub release. This is
// the "downloads from the site" number; GitHub's own count also includes people who download from GitHub.
//   GET /download/installer -> 302 to .../releases/latest/download/LoreForever-Setup.exe
//   GET /download/zip       -> 302 to .../releases/latest/download/LoreForever.zip
//   GET /download/complete  -> 302 to .../releases/latest/download/LoreForever-complete.zip

const RELEASE = "https://github.com/mliudev/LoreForever/releases/latest/download/";
const FILES = { installer: "LoreForever-Setup.exe", zip: "LoreForever.zip", complete: "LoreForever-complete.zip" };
const SETUP = `CREATE TABLE IF NOT EXISTS downloads (
  day TEXT NOT NULL, file TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, file))`;
// Link previews and crawlers fetch links too; don't count them as downloads.
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|discord|slack|telegram|whatsapp/i;

export async function onRequestGet({ params, env, request }) {
  const file = FILES[params.file];
  if (!file) return new Response("Not found", { status: 404 });
  if (env.DB && !BOT.test(request.headers.get("user-agent") || "")) {
    const day = new Date().toISOString().slice(0, 10);
    try {
      await env.DB.batch([
        env.DB.prepare(SETUP),
        env.DB.prepare("INSERT INTO downloads (day, file, n) VALUES (?, ?, 1) ON CONFLICT(day, file) DO UPDATE SET n = n + 1")
          .bind(day, params.file),
      ]);
    } catch (e) {}   // never block a download on the counter
  }
  return Response.redirect(RELEASE + file, 302);
}
