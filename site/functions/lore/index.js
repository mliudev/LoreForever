// /lore: every narration we ship, with filters, search and a player (lib/lore.js indexPage; the list itself is
// built in the browser by public/lore/lore.js from public/lore/data/index.json). noindex while the "lore" site
// feature (lib/features.js) is off. The download filter's choices are the packs that are out (lib/packs.js, LOR-437).

import { loadIndex, loadMore, indexPage, htmlHeaders } from "../../lib/lore.js";
import { loadVoices } from "../../lib/voices.js";
import { loadPacks, loadPackEntries, visiblePacks, packOptions } from "../../lib/packs.js";

export async function onRequestGet({ request, env }) {
  const [index, more, voices, packData, packEntries] = await Promise.all([loadIndex(env, request), loadMore(env, request),
    loadVoices(env, request), loadPacks(env, request), loadPackEntries(env, request)]);
  const packs = packOptions(packEntries, packData, visiblePacks(packData, voices));
  return new Response(indexPage(index, { more, env, packs }), { headers: htmlHeaders(env) });
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
