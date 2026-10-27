// /<lang>/lore/narration.json: what the /lore list plays in that language (public/lore/lore.js reads it when the
// language is picked), so its rows play that language's own narrators and never the English under its text. R2's
// lore-i18n/<lang>/narration.json (pipeline/lore/site_i18n.py narration_list: each page's recordings in the language, by
// its English path, in /lore/data/index.json's shape) as `list`, with `names`: the narrators named in the language
// (lib/lore.js voiceNames). A 404 for a segment that isn't one of the languages, or before an upload has the list.

import { I18N_PREFIX, loadI18nIndex, voiceNames } from "../../../lib/lore.js";
import { loadVoices } from "../../../lib/voices.js";
import { fail } from "../../../lib/accounts.js";

export async function onRequestGet({ request, env, params }) {
  const seg = String(params.lang);
  const index = await loadI18nIndex(env);
  if (!(index?.langs || []).some(l => l.seg === seg)) return fail(404, "Not one of the languages.");
  let list = null;
  try {
    const obj = await env.STUDIO.get(`${I18N_PREFIX}${seg}/narration.json`);
    list = obj ? await new Response(obj.body).text() : null;
  } catch (e) { list = null; }
  if (!list) return fail(404, "No list in this language yet.");
  const names = voiceNames(await loadVoices(env, request), seg);
  // The list as R2 has it (the upload checked it's JSON), not parsed again: it's a few hundred KB.
  return new Response(`{"names":${JSON.stringify(names)},"list":${list}}`, {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
