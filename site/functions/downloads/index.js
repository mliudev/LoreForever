// /downloads: fills public/downloads.html so the page shows without JavaScript and follows the release's files. What
// comes with the add-on and the extra packs, with lines to hear (LOR-437), come from public/data/packs.json through
// lib/packs.js; the folded table of every file by language and voice from the narration voices
// (public/voices/voices.json, with each one's like count) and the languages (public/translate/packs.json) through
// lib/downloads.js. /voices redirects here (functions/voices/index.js), and the add-on's missing-voice notice and
// Options point players here.

import { publicVoices, likeCounts } from "../../lib/voices.js";
import { loadPacks } from "../../lib/translations.js";
import { voicesSection, includedLine, communitySection } from "../../lib/downloads.js";
import { loadPacks as loadPackFacts, loadSizes, comesSection, extrasSection, languageSection } from "../../lib/packs.js";
import { liveKeys } from "../../lib/lore.js";

// Arriving from /voices (functions/voices/index.js), the address voice actors were sent to record: the recorder first.
const RECORDING = `<p class="dl-record"><b>Recording for Lore Forever?</b> <a class="h-btn h-sm" href="/voices/lend">` +
  `Start here</a></p>`;

export async function onRequestGet({ request, env }) {
  // A plain fetch of the page (no If-None-Match), so it never comes back as an empty 304.
  const page = await env.ASSETS.fetch(new URL("/downloads", request.url));
  const html = await page.text();
  if (!html.includes("<!-- dl-voices -->")) return new Response(html, page);
  const [voices, likes, packs, facts, sizes, live] = await Promise.all([publicVoices(env, request), likeCounts(env),
    loadPacks(env, request), loadPackFacts(env, request), loadSizes(env, request), liveKeys(env, request)]);
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-cache");
  headers.delete("Content-Length");
  headers.delete("ETag");
  const ctx = { voices, langs: packs, sizes, live };
  // Without packs.json the page still has its buttons, a line on what's included and the full table.
  const comes = comesSection(facts, ctx) || `<p class="dl-intro">${includedLine(voices, packs)}</p>`;
  const extras = extrasSection(facts, ctx) || `<p class="dl-intro"><a href="#all-files">See every file, by language and voice</a>.</p>`;
  const out = html
    .replace("<!-- dl-comes -->", () => comes)
    .replace("<!-- dl-language -->", () => languageSection(facts, ctx))
    .replace("<!-- dl-packs -->", () => extras)
    .replace(/<!-- dl-community:[^>]*-->/, () => communitySection(voices, likes))
    .replace("<!-- dl-voices -->", () => voicesSection(voices, likes, packs))
    .replace("<!-- dl-record -->", () => new URL(request.url).searchParams.get("from") === "voices" ? RECORDING : "");
  return new Response(out, { status: page.status, headers });
}
