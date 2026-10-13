// /guides/sitemap.xml (named in public/robots.txt): /guides and every published article; empty until the first one.

import { loadIndex, sitemap } from "../../lib/guides.js";

export async function onRequestGet({ request, env }) {
  return new Response(sitemap(await loadIndex(env, request)), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
