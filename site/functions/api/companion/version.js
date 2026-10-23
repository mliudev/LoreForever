// Each app's oldest supported version and the newest (lib/client-version.js clientVersions):
//   GET /api/companion/version -> {"schema": 1,
//     "willo": {"min": "0.1.0", "latest": "0.25.0", "download": "https://loreforeverwow.com/download/willo"},
//     "ios":   {"min": "0.1.0", "latest": "0.2.0",  "download": "https://loreforeverwow.com/willo"},
//     "addon": {"min": "0.1.0", "latest": "0.25.0", "download": "https://loreforeverwow.com/download"}}
// Willo on a PC (companion/lore_companion/updates.py) and for iPhone (mobile/src/lib/update.ts) read it and show
// "Update Willo" below their min; Willo tells the add-on its min (addon/LoreForever/Updates.lua). Public, like the
// Download button: no account, nothing about the player.
import { clientVersions } from "../../../lib/client-version.js";

export async function onRequestGet({ request, env }) {
  let published = null;
  try {
    const res = await env.ASSETS?.fetch(new URL("/data/download-files.json", request.url));
    if (res?.ok) published = (await res.json())?.publishedTag ?? null;
  } catch (e) { /* the minimums still go out */ }
  return Response.json(clientVersions(env, published, new URL(request.url).origin),
    { headers: { "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" } });
}
