// /downloads, "Pick a bundle" (LOR-848): fills public/downloads.html so the page shows without JavaScript and follows
// the release's files. The bar, the three bundle cards and "Every file, by language and voice" come from the release's
// facts (public/data/packs.json, the narration voices in public/voices/voices.json, the languages in
// public/translate/packs.json and the release snapshot public/data/download-files.json) through lib/bundles.js; the
// cards are drawn for English, Windows and the main narrator, and the catalog goes in the page for /js/downloads.js to
// draw the visitor's own pick. /voices redirects here (functions/voices/index.js), and the add-on's missing-voice
// notice and Options point players here.

import { publicVoices } from "../../lib/voices.js";
import { loadPacks } from "../../lib/translations.js";
import { loadPacks as loadPackFacts, loadSizes } from "../../lib/packs.js";
import { liveKeys } from "../../lib/lore.js";
import { buildCatalog, everyFileHtml } from "../../lib/bundles.js";
import { barHtml, cardsHtml } from "../../public/js/bundles.js";

// Arriving from /voices (functions/voices/index.js), the address voice actors were sent to record: the recorder first.
const RECORDING = `<p class="dl-record"><b>Recording for Lore Forever?</b> <a class="h-btn h-sm" href="/voices/lend">` +
  `Start here</a></p>`;
const DEFAULT = { lang: "en", narrator: "male", os: "win" };

export async function onRequestGet({ request, env }) {
  // A plain fetch of the page (no If-None-Match), so it never comes back as an empty 304.
  const page = await env.ASSETS.fetch(new URL("/downloads", request.url));
  const html = await page.text();
  if (!html.includes("<!-- dl-files -->")) return new Response(html, page);
  const [voices, langs, facts, sizes, live] = await Promise.all([publicVoices(env, request), loadPacks(env, request),
    loadPackFacts(env, request), loadSizes(env, request), liveKeys(env, request)]);
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-cache");
  headers.delete("Content-Length");
  headers.delete("ETag");
  const ctx = { voices, langs, sizes, live };
  const cat = buildCatalog(facts, ctx);
  // Without packs.json the page keeps its fallback: the add-on's three ways.
  const bundles = cat?.langs.length ? `<div class="bx-bar" id="languages">${barHtml(cat, DEFAULT)}</div>
      <div class="bx-choose" id="bx-choose" hidden></div>
      <div class="bx-cards" id="voices">${cardsHtml(cat, DEFAULT)}</div>
      <script type="application/json" id="bx-catalog">${JSON.stringify(cat).replace(/</g, "\\u003c")}</script>` : null;
  let out = html.replace("<!-- dl-files -->", () => everyFileHtml(facts, ctx))
    .replace("<!-- dl-record -->", () => new URL(request.url).searchParams.get("from") === "voices" ? RECORDING : "");
  if (bundles) out = out.replace(/<!-- dl-bundles -->[\s\S]*?<!-- \/dl-bundles -->/, () => bundles);
  return new Response(out, { status: page.status, headers });
}
