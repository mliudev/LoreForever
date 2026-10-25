// The public read of the narration recordings the lore pages play (lib/lore.js, site/LORE_PAGES.md).
//   GET /api/narration/live     public: {keys: [...]}, the recordings the manifest lists (a preview without its own
//                               asks loreforeverwow.com). Cached 5 min. The site, the add-on's Player, the iPhone app
//                               and the scripts read it.
// Uploading moved under /api/admin/ (admin/narration/[action].js) so Cloudflare Access covers it: the old
// /api/narration/audio and /manifest answer 410 Gone and name the new path. Nothing sends them any more; the 410
// can go once a release has passed.

import { fail } from "../../../lib/accounts.js";
import { liveKeys } from "../../../lib/lore.js";

export async function onRequest({ request, env, params }) {
  const action = String(params.action || "");
  if (action === "live") {
    if (request.method !== "GET" && request.method !== "HEAD") return fail(405, "Use GET.");
    const keys = [...(await liveKeys(env, request))].sort();
    return Response.json({ keys }, { headers: { "Cache-Control": "public, max-age=300" } });
  }
  if (action === "audio" || action === "manifest") return fail(410, `Moved to /api/admin/narration/${action}.`);
  return fail(404, "Not found.");
}
