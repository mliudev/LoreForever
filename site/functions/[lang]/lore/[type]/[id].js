// /<lang>/lore/<type>/<id>: a lore page in another language (LOR-809; /de/lore/zone/westfall), from R2's
// lore-i18n/<lang>/<type>/<id>.json (pipeline/lore/site_i18n.py), rendered by the same lib/lore.js entryPage as the
// English page in functions/lore/. The address follows the English one (a quest's title in English, so the switch
// only swaps the first segment); any other spelling gets a 301 to it. A page with no current translation, or a
// language R2 doesn't have it in, is a 302 to the English page, so a link never dead-ends. A segment that isn't one of
// the languages is the site's 404. The Lore Forever domain only (lib/doors.js LORE_PAGES).

import { keyOf, loadEntry, loadI18nIndex, translationsOf, loadTranslated, entryPage, missingLorePage, htmlHeaders }
  from "../../../../lib/lore.js";
import { loadVoices } from "../../../../lib/voices.js";
import { loadPacks, loadPackEntries, visiblePacks, packOptions } from "../../../../lib/packs.js";
import { edgeCached } from "../../../../lib/edge-cache.js";

// Kept at the edge like the English pages, under a new key once an upload changes the index (its etag) or a deploy
// changes the lore data.
export async function onRequestGet(context) {
  const index = await loadI18nIndex(context.env);
  const url = new URL(context.request.url);
  url.searchParams.set("_i18n", String(index?.etag || "").replace(/[^A-Za-z0-9-]/g, ""));
  const keyed = { ...context, request: new Request(url.toString(), context.request) };
  return edgeCached(keyed, () => render(context, index), { ttl: 600, versioned: true });
}

async function render({ request, env, params }, index) {
  const seg = String(params.lang);
  const key = keyOf(params.type, params.id);
  const known = (index?.langs || []).some(l => l.seg === seg);
  const entry = key && known ? await loadEntry(env, request, key) : null;
  if (!entry) return new Response(missingLorePage(env), { status: 404, headers: htmlHeaders(env) });
  const url = new URL(request.url);
  const english = () => Response.redirect(new URL(entry.path + url.search, url).toString(), 302);
  const langs = translationsOf(index, entry.path);
  if (!langs.some(l => l.seg === seg)) return english();
  const here = `/${seg}${entry.path}`;
  if (url.pathname !== here) return Response.redirect(new URL(here + url.search, url).toString(), 301);
  const page = await loadTranslated(env, seg, entry.path);
  if (!page) return english();
  const hreflang = langs.find(l => l.seg === seg).hreflang;
  const [voices, packData, packEntries] = await Promise.all([loadVoices(env, request), loadPacks(env, request), loadPackEntries(env, request)]);
  const shelfPacks = packOptions(packEntries, packData, visiblePacks(packData, voices));
  return new Response(entryPage(page, { env, lang: seg, langs, allLangs: index.langs || [], shelfPacks }),
    { headers: htmlHeaders(env, entry, hreflang) });
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
