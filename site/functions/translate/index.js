// /translate: fills the language list in public/translate.html from public/translate/languages.json, with each
// language's like count, its translator credits and, for languages with a published pack (packs.json), its download,
// so the cards show without JavaScript and nothing moves when the page loads.

import { loadLanguages, loadPacks, likeCounts, languageCard, translatorCredits } from "../../lib/translations.js";

const MARK = "<!-- language-list -->";

export async function onRequestGet({ request, env }) {
  // A plain fetch of the page (no If-None-Match), so it never comes back as an empty 304.
  const page = await env.ASSETS.fetch(new URL("/translate", request.url));
  const html = await page.text();
  if (!html.includes(MARK)) return new Response(html, page);
  const [languages, likes, credits, packs] = await Promise.all([loadLanguages(env, request), likeCounts(env),
    translatorCredits(env), loadPacks(env, request)]);
  const byLocale = Object.fromEntries(packs.map(p => [p.locale, p]));
  const cards = languages.map(l => languageCard(l, likes[l.locale], credits[l.locale], byLocale[l.locale]))
    .join("\n    ");
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-cache");
  headers.delete("Content-Length");
  headers.delete("ETag");
  return new Response(html.replace(MARK, cards), { status: page.status, headers });
}
