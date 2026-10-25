// /lore/<type>/<id>: one lore entry's page (lib/lore.js entryPage) from public/lore/data/e/<type>_<id>.json, with a
// player for each recording R2 has. A quest's address carries its title (/lore/quest/176-wanted-hogger); any other
// spelling of the same entry (/lore/quest/176, an old title, capitals) gets a 301 to it, so the add-on can link
// /lore/quest/<id> (LOR-23). Unknown entries get a 404 page. /lore/data/* is static (excluded in _routes.json).

import { keyOf, loadEntry, loadIndex, nextPlayable, liveKeys, voiceNames, entryPage, missingLorePage, htmlHeaders,
  loadI18nIndex, translationsOf }
  from "../../../lib/lore.js";
import { loadVoices } from "../../../lib/voices.js";
import { loadPacks, loadPackEntries, visiblePacks, packsForEntry, packOptions } from "../../../lib/packs.js";
import { edgeCached } from "../../../lib/edge-cache.js";

// Kept at the edge for 10 minutes, under a new key once the lore data changes (lib/edge-cache.js): the page is the
// same for everyone.
export async function onRequestGet(context) {
  const { params, next } = context;
  if (String(params.type) === "data" && next) return next();
  return edgeCached(context, () => render(context), { ttl: 600, versioned: true });
}

async function render({ request, env, params }) {
  const key = keyOf(params.type, params.id);
  const entry = key ? await loadEntry(env, request, key) : null;
  if (!entry) return new Response(missingLorePage(env), { status: 404, headers: htmlHeaders(env) });
  const url = new URL(request.url);
  if (url.pathname !== entry.path) return Response.redirect(new URL(entry.path + url.search, url).toString(), 301);
  const [live, voices, packData, packEntries, index, i18n] = await Promise.all([liveKeys(env, request), loadVoices(env, request),
    loadPacks(env, request), loadPackEntries(env, request), loadIndex(env, request), loadI18nIndex(env)]);
  // Which downloads have this page's recording (LOR-437): the packs that are out, linked to /downloads.
  const packs = packsForEntry(key, packEntries, packData, visiblePacks(packData, voices));
  const next = nextPlayable(index, entry.path);
  // The languages it also reads in (LOR-809), for its language switch and hreflang.
  const langs = translationsOf(i18n, entry.path);
  // The book's right page filters by download too (/lore's playlist), and offers every language the site has pages in.
  const shelfPacks = packOptions(packEntries, packData, visiblePacks(packData, voices));
  return new Response(entryPage(entry, { live, names: voiceNames(voices), env, packs, next, langs, allLangs: i18n?.langs || [], shelfPacks }),
    { headers: htmlHeaders(env, entry) });
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
