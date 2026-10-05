// /contributors (LOR-239): the narrators, translators and text finders, with counts of their accepted work and never
// a rank (lib/credits.js). It was /voices/contributors, narrators only, until 2026-10-04; that address sends here.

import { allCredits, contributorsPage } from "../lib/credits.js";
import { loadLanguages } from "../lib/translations.js";
import { featureOn } from "../lib/features.js";

export async function onRequestGet({ request, env }) {
  const [credits, languages] = await Promise.all([allCredits(env, request), loadLanguages(env, request)]);
  const names = Object.fromEntries(languages.map(l => [l.locale, l.englishName || l.name]));
  return new Response(contributorsPage(credits, { languages: names, contribute: featureOn(env, "contribute") }), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
