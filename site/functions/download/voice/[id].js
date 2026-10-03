// Voice pack downloads: /download/voice/<id>. Counts each download per day in the same D1 `downloads` table as the
// add-on itself (file = "voice:<id>"), then redirects to the pack's zip: the `download` of that voice in
// public/voices/voices.json (a GitHub release asset of the public repo), or of one of its packs (a voice's "packs":
// its lands packs and complete bundle). Voices and packs without one get a 404. The default voice's old pack links
// (its lands packs and the complete zip, now all in the main zip) go to the main download.
//   GET /download/voice/<id> -> 302 to the voice's download

import { loadVoices, findDownload } from "../../../lib/voices.js";

const SETUP = `CREATE TABLE IF NOT EXISTS downloads (
  day TEXT NOT NULL, file TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, file))`;
// Link previews and crawlers fetch links too; don't count them as downloads.
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|discord|slack|telegram|whatsapp/i;

const IN_MAIN_ZIP = new Set(["male-alliance-lands", "male-horde-lands", "male-complete"]);

export async function onRequestGet({ params, env, request }) {
  if (IN_MAIN_ZIP.has(params.id)) return Response.redirect(new URL("/download/zip", request.url).toString(), 302);
  const item = findDownload(await loadVoices(env, request), params.id);
  const url = item?.status === "live" && /^https:\/\//.test(item.download || "") ? item.download : null;
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
