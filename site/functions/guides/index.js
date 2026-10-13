// /guides: every published guide and lore article, newest first (lib/guides.js, LOR-414; site/GUIDES.md).

import { loadIndex, indexPage, published, htmlHeaders } from "../../lib/guides.js";

export async function onRequestGet({ request, env }) {
  const index = await loadIndex(env, request);
  return new Response(indexPage(index), { headers: htmlHeaders(published(index).length ? undefined : "noindex") });
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
