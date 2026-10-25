// /<lang>/lore/sitemap.xml (named in public/robots.txt): the pages that language has (lib/lore.js sitemap), once the
// "lore" site feature is on; empty until then, and for a segment that isn't one of the languages.

import { loadI18nIndex, sitemap } from "../../../lib/lore.js";

export async function onRequestGet({ env, params }) {
  const i18n = await loadI18nIndex(env);
  return new Response(sitemap(null, env, null, String(params.lang), i18n), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
