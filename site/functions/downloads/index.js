// /downloads: fills public/downloads.html with the narration voices (public/voices/voices.json, with each one's like
// count) and the languages (public/translate/packs.json), so the page shows without JavaScript and follows those
// files. lib/downloads.js builds the parts. /voices redirects here (functions/voices/index.js), and the add-on's
// missing-voice notice and Options point players here.

import { publicVoices, likeCounts } from "../../lib/voices.js";
import { loadPacks } from "../../lib/translations.js";
import { voicesSection, languagesSection, includedLine } from "../../lib/downloads.js";

export async function onRequestGet({ request, env }) {
  // A plain fetch of the page (no If-None-Match), so it never comes back as an empty 304.
  const page = await env.ASSETS.fetch(new URL("/downloads", request.url));
  const html = await page.text();
  if (!html.includes("<!-- dl-voices -->")) return new Response(html, page);
  const [voices, likes, packs] = await Promise.all([publicVoices(env, request), likeCounts(env), loadPacks(env, request)]);
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-cache");
  headers.delete("Content-Length");
  headers.delete("ETag");
  const out = html
    .replace("<!-- dl-included -->", includedLine(voices, packs))
    .replace("<!-- dl-voices -->", voicesSection(voices, likes))
    .replace("<!-- dl-languages -->", languagesSection(packs));
  return new Response(out, { status: page.status, headers });
}
