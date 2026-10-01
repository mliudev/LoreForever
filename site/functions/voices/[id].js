// /voices/<id>: a voice's profile page (lib/voices.js), for every voice in public/voices/voices.json, house voices
// included. Any other /voices/<name> (guide, submit, account, ...) is the static page of that name.

import { publicVoices, likeCounts, profilePage } from "../../lib/voices.js";

export async function onRequestGet({ request, env, params, next }) {
  const id = String(params.id);
  if (!/^[a-z0-9-]+$/.test(id)) return next();
  const voice = (await publicVoices(env, request)).find(v => v.id === id);
  if (!voice) return next();
  const likes = await likeCounts(env);
  return new Response(profilePage(voice, likes[id]), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
