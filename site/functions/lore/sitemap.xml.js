// /lore/sitemap.xml (named in public/robots.txt): /lore and every lore page once the "lore" site feature
// (lib/features.js) is on; an empty sitemap until then, so robots.txt can name it from the start.

import { loadIndex, sitemap } from "../../lib/lore.js";

export async function onRequestGet({ request, env }) {
  const index = await loadIndex(env, request);
  return new Response(sitemap(index, env), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
