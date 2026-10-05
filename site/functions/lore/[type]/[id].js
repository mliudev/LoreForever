// /lore/<type>/<id>: one lore entry's page (lib/lore.js entryPage) from public/lore/data/e/<type>_<id>.json, with a
// player for each recording R2 has. A quest's address carries its title (/lore/quest/176-wanted-hogger); any other
// spelling of the same entry (/lore/quest/176, an old title, capitals) gets a 301 to it, so the add-on can link
// /lore/quest/<id> (LOR-23). Unknown entries get a 404 page. /lore/data/* is static (excluded in _routes.json).

import { keyOf, loadEntry, liveKeys, voiceNames, entryPage, missingLorePage, htmlHeaders } from "../../../lib/lore.js";
import { loadVoices } from "../../../lib/voices.js";

export async function onRequestGet({ request, env, params, next }) {
  if (String(params.type) === "data" && next) return next();
  const key = keyOf(params.type, params.id);
  const entry = key ? await loadEntry(env, request, key) : null;
  if (!entry) return new Response(missingLorePage(env), { status: 404, headers: htmlHeaders(env) });
  const url = new URL(request.url);
  if (url.pathname !== entry.path) return Response.redirect(new URL(entry.path + url.search, url).toString(), 301);
  const [live, voices] = await Promise.all([liveKeys(env, request), loadVoices(env, request)]);
  return new Response(entryPage(entry, { live, names: voiceNames(voices), env }), { headers: htmlHeaders(env) });
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
