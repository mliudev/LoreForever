// /voices/contributors: everyone whose voice is on the site, linking to the profiles (lib/voices.js).

import { publicVoices, contributorsPage } from "../../lib/voices.js";

export async function onRequestGet({ request, env }) {
  return new Response(contributorsPage(await publicVoices(env, request)), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
