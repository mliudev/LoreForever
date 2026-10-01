// POST /api/voices/like  {"id": "<voice id>"}: one thumbs-up for a voice on /voices. Counts once per voice, per
// sender, per day (lib/voices.js); liking again the same day changes nothing. No account needed.
// A JSON post gets {"ok": true, "count": n}; the plain form (the page without JavaScript) is sent back to the page.

import { loadVoices, addLike } from "../../../lib/voices.js";
import { clean } from "../../../lib/form.js";

const fail = (status, error) => Response.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });

// Back to the page the like came from (a voice card on /voices, or a profile page), never another site.
function backTo(request, id) {
  const back = new URL("/voices", request.url);
  try {
    const ref = new URL(request.headers.get("Referer") || "");
    if (ref.origin === back.origin && ref.pathname.startsWith("/voices")) back.pathname = ref.pathname;
  } catch (e) {}
  back.hash = back.pathname === "/voices" ? "voice-" + id : "";
  return Response.redirect(back.href, 303);
}

export async function onRequestPost({ request, env }) {
  const json = (request.headers.get("Content-Type") || "").includes("application/json");
  let input;
  try {
    input = json ? await request.json() : Object.fromEntries(await request.formData());
  } catch (e) {
    return fail(400, "Couldn't read the like.");
  }
  const id = clean(input.id, 60);
  const voices = await loadVoices(env, request);
  if (!voices.some(v => v.id === id)) return fail(404, "No such voice.");
  if (!env.DB) return fail(503, "Likes aren't set up yet.");
  const count = await addLike(env, request, id);
  return json ? Response.json({ ok: true, count }, { headers: { "Cache-Control": "no-store" } }) : backTo(request, id);
}
