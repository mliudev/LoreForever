// GET /api/credits: who to thank (LOR-239), public, the same people and counts as /contributors (lib/credits.js).
//   GET /api/credits                   {ok, narrators: [{name, links, voices: [id]}], translators: [{name, links,
//                                       languages: {locale: strings}, strings}], finders: [{name, links, lines}],
//                                       community: [{name, voices: [{id, name, language}]}]}: community is the
//                                       players' own voices, for the home page's "Made with the community" strip.
//   GET /api/credits?release=0.8.0     {ok, release, lines, names}: the community lines that shipped in that release
//                                       (`lore.contrib mark-shipped`) and the finders to thank, for the credit line
//                                       scripts/post-release.sh adds to the Discord announcement draft.
// Alphabetical, accepted work only, names only of people who chose to show them.

import { allCredits, releaseCredits, communityNarrators } from "../../lib/credits.js";

const VERSION = /^\d+\.\d+\.\d+$/;
const headers = { "Cache-Control": "public, max-age=60", "Access-Control-Allow-Origin": "*" };

export async function onRequestGet({ request, env }) {
  const release = new URL(request.url).searchParams.get("release");
  if (release !== null) {
    if (!VERSION.test(release)) return Response.json({ ok: false, error: "release must look like 0.8.0" }, { status: 400, headers });
    return Response.json(await releaseCredits(env, release), { headers });
  }
  const { narrators, translators, finders } = await allCredits(env, request);
  return Response.json({
    ok: true,
    narrators: narrators.map(g => ({ name: g.name, links: g.links, voices: g.voices.map(v => v.id) })),
    translators: translators.map(p => ({
      name: p.name, links: p.links, strings: p.strings,
      languages: Object.fromEntries(p.languages.map(l => [l.locale, l.strings])),
    })),
    finders: finders.map(p => ({ name: p.name, links: p.links, lines: p.lines })),
    community: communityNarrators(narrators),
  }, { headers });
}
