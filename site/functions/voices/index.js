// /voices: fills the voice list in public/voices.html from public/voices/voices.json, one row per voice with its like
// count, plus the filter buttons, so the list shows without JavaScript and nothing moves when the page loads.

import { publicVoices, likeCounts, voiceRow, voiceFilters } from "../../lib/voices.js";

const LIST = "<!-- voice-list -->";
const FILTERS = "<!-- voice-filters -->";

export async function onRequestGet({ request, env }) {
  // A plain fetch of the page (no If-None-Match), so it never comes back as an empty 304.
  const page = await env.ASSETS.fetch(new URL("/voices", request.url));
  const html = await page.text();
  if (!html.includes(LIST)) return new Response(html, page);
  const [voices, likes] = await Promise.all([publicVoices(env, request), likeCounts(env)]);
  const rows = voices.map((v, i) => voiceRow(v, likes[v.id], i)).join("\n    ");
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-cache");
  headers.delete("Content-Length");
  headers.delete("ETag");
  return new Response(html.replace(LIST, rows).replace(FILTERS, voiceFilters(voices)), { status: page.status, headers });
}
