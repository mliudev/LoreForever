// /guides: every published guide and lore article, newest first (lib/guides.js, LOR-414; site/GUIDES.md).

import { loadIndex, indexPage, published, htmlHeaders, guideResponse } from "../../lib/guides.js";
import { edgeCached } from "../../lib/edge-cache.js";

// Kept at the edge for a minute (lib/edge-cache.js); the editor's save forgets this data center's copy.
export const onRequestGet = context => edgeCached(context, () => render(context), { ttl: 60 });

async function render({ request, env }) {
  return guideResponse(async () => {
    const index = await loadIndex(env, request);
    return new Response(indexPage(index), { headers: htmlHeaders(published(index).length ? undefined : "noindex") });
  });
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
