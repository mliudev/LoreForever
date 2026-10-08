// Language pack downloads: /download/lang/<locale>. Counts each download per day in the same D1 `downloads` table
// as the add-on and the voice packs (file = "lang:<locale>"), then redirects to the pack's zip: the `download` of
// that locale in public/translate/packs.json (a release asset of the public repo's "languages" release, written by
// scripts/publish-language-packs.sh). Locales without one get a 404.
//   GET /download/lang/<locale> -> 302 to the pack's zip

import { loadPacks } from "../../../lib/translations.js";

const SETUP = `CREATE TABLE IF NOT EXISTS downloads (
  day TEXT NOT NULL, file TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, file))`;
// Link previews and crawlers fetch links too; don't count them as downloads.
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|discord|slack|telegram|whatsapp/i;

export async function onRequestGet({ params, env, request }) {
  const pack = (await loadPacks(env, request)).find(p => p.locale === params.locale);
  const url = /^https:\/\//.test(pack?.download || "") ? pack.download : null;
  if (!url) return new Response("Not found", { status: 404 });
  if (request.method === "GET" && env.DB && !BOT.test(request.headers.get("user-agent") || "")) {
    const day = new Date().toISOString().slice(0, 10);
    try {
      await env.DB.batch([
        env.DB.prepare(SETUP),
        env.DB.prepare("INSERT INTO downloads (day, file, n) VALUES (?, ?, 1) ON CONFLICT(day, file) DO UPDATE SET n = n + 1")
          .bind(day, "lang:" + params.locale),
      ]);
    } catch (e) {}   // never block a download on the counter
  }
  return Response.redirect(url, 302);
}

export const onRequestHead = onRequestGet;
