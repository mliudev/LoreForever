// /downloads: fills public/downloads.html with the narration voices (public/voices/voices.json; listed first, since
// most visitors already have the add-on) and the languages (public/translate/packs.json), so the page shows without
// JavaScript and follows those files. lib/downloads.js builds the parts. The add-on's "missing narration" notice points players here.

import { publicVoices } from "../../lib/voices.js";
import { loadPacks } from "../../lib/translations.js";
import { voicesSection, languagesSection, includedLine } from "../../lib/downloads.js";

export async function onRequestGet({ request, env }) {
  // A plain fetch of the page (no If-None-Match), so it never comes back as an empty 304.
  const page = await env.ASSETS.fetch(new URL("/downloads", request.url));
  const html = await page.text();
  if (!html.includes("<!-- dl-voices -->")) return new Response(html, page);
  const [voices, packs] = await Promise.all([publicVoices(env, request), loadPacks(env, request)]);
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-cache");
  headers.delete("Content-Length");
  headers.delete("ETag");
  const out = html
    .replace("<!-- dl-included -->", includedLine(voices, packs))
    .replace("<!-- dl-voices -->", voicesSection(voices))
    .replace("<!-- dl-languages -->", languagesSection(packs));
  return new Response(out, { status: page.status, headers });
}
