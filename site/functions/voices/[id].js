// /voices/<id>: a voice's profile page (lib/voices.js), for every voice in public/voices/voices.json, house voices
// included. Any other /voices/<name> (guide, submit, account, ...) is the static page of that name.

import { publicVoices, likeCounts, profilePage } from "../../lib/voices.js";
import { loadLines } from "../../lib/studio.js";
import { featureOn } from "../../lib/features.js";

// The zones a contributor's voice narrated on the upload page ("Claim a zone", LOR-231), by name; [] on any trouble,
// and while the zones feature is off (lib/features.js).
async function zonesOf(env, request, voice) {
  if (!voice.owner || !env.DB || !featureOn(env, "zones")) return [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT zone, locale FROM studio_claims WHERE voice_id = ? AND owner = ? AND status = 'done' ORDER BY finished"
    ).bind(voice.id, voice.owner).all();
    if (!results.length) return [];
    const names = Object.fromEntries(((await loadLines(env, request)).zones || []).map(z => [z.key, z.name]));
    return results.map(r => names[r.zone]?.[r.locale] || names[r.zone]?.enUS || r.zone);
  } catch (e) {
    return [];   // no claims table yet, or D1 is down: the page shows without them
  }
}

export async function onRequestGet({ request, env, params, next }) {
  const id = String(params.id);
  if (!/^[a-z0-9-]+$/.test(id)) return next();
  const voice = (await publicVoices(env, request)).find(v => v.id === id);
  if (!voice) return next();
  const likes = await likeCounts(env);
  return new Response(profilePage(voice, likes[id], { zones: await zonesOf(env, request, voice) }), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
