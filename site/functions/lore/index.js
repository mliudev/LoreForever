// /lore: every narration we ship, with filters, search and a player (lib/lore.js indexPage; the list itself is
// built in the browser by public/lore/lore.js from public/lore/data/index.json). noindex while the "lore" site
// feature (lib/features.js) is off. The download filter's choices are the packs that are out (lib/packs.js, LOR-437).

import { loadIndex, loadMore, indexPage, htmlHeaders, loadI18nIndex } from "../../lib/lore.js";
import { loadVoices } from "../../lib/voices.js";
import { loadPacks, loadPackEntries, visiblePacks, packOptions } from "../../lib/packs.js";
import { edgeCached } from "../../lib/edge-cache.js";

// Kept at the edge like the entry pages (lib/edge-cache.js).
export const onRequestGet = context => edgeCached(context, () => render(context), { ttl: 600, versioned: true });

async function render({ request, env }) {
  const [index, more, voices, packData, packEntries, i18n] = await Promise.all([loadIndex(env, request), loadMore(env, request),
    loadVoices(env, request), loadPacks(env, request), loadPackEntries(env, request), loadI18nIndex(env)]);
  const packs = packOptions(packEntries, packData, visiblePacks(packData, voices));
  return new Response(indexPage(index, { more, env, packs, allLangs: i18n?.langs || [] }), { headers: htmlHeaders(env) });
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
