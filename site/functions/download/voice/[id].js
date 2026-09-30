// Community voice pack downloads: /download/voice/<id>. Counts each download per day in the same D1 `downloads`
// table as the add-on itself (file = "voice:<id>"), then redirects to the pack's zip. Packs are published as assets
// on a GitHub release of the public repo; add each one here when its card goes on public/voices.html.
//   GET /download/voice/<id> -> 302 to VOICES[id]

const VOICES = {
  // ashen: "https://github.com/mliudev/LoreForever/releases/download/voices/LoreForever_Voice_Ashen-1.0.0.zip",
};
const SETUP = `CREATE TABLE IF NOT EXISTS downloads (
  day TEXT NOT NULL, file TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, file))`;
// Link previews and crawlers fetch links too; don't count them as downloads.
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|discord|slack|telegram|whatsapp/i;

export async function onRequestGet({ params, env, request }) {
  const url = Object.hasOwn(VOICES, params.id) ? VOICES[params.id] : null;
  if (!url) return new Response("Not found", { status: 404 });
  if (env.DB && !BOT.test(request.headers.get("user-agent") || "")) {
    const day = new Date().toISOString().slice(0, 10);
    try {
      await env.DB.batch([
        env.DB.prepare(SETUP),
        env.DB.prepare("INSERT INTO downloads (day, file, n) VALUES (?, ?, 1) ON CONFLICT(day, file) DO UPDATE SET n = n + 1")
          .bind(day, "voice:" + params.id),
      ]);
    } catch (e) {}   // never block a download on the counter
  }
  return Response.redirect(url, 302);
}
