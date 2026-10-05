// /lore: every narration we ship, with filters, search and a player (lib/lore.js indexPage; the list itself is
// built in the browser by public/lore/lore.js from public/lore/data/index.json). noindex while the "lore" site
// feature (lib/features.js) is off.

import { loadIndex, indexPage, htmlHeaders } from "../../lib/lore.js";

export async function onRequestGet({ request, env }) {
  const index = await loadIndex(env, request);
  return new Response(indexPage(index, { env }), { headers: htmlHeaders(env) });
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
