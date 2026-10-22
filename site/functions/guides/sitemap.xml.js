// /guides/sitemap.xml (named in public/robots.txt): /guides and every published article; empty until the first one.

import { loadIndex, sitemap, guideResponse } from "../../lib/guides.js";

export async function onRequestGet({ request, env }) {
  return guideResponse(async () => new Response(sitemap(await loadIndex(env, request)), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  }));
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
