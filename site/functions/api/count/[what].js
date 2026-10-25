// Counts something a page did, per day, as a plain number (lib/usage.js countSite, LOR-151): nothing about who.
//   POST /api/count/share   Share pressed or a profile link copied (public/js/profile.js, /account), sent as a beacon
//   POST /api/count/lore-play     a recording started on a lore page or /lore (public/lore/lore.js)
//   POST /api/count/lore-whole    "Play the whole page" pressed
//   POST /api/count/lore-onward   "Next plays on" moved on to the next page
// Only from our own pages (Origin); anything else is a 404. /admin shows the counts in its Usage section.

import { sameOrigin } from "../../../lib/accounts.js";
import { countSite } from "../../../lib/usage.js";

const METRICS = { share: "profile.share", "lore-play": "lore.play", "lore-whole": "lore.whole", "lore-onward": "lore.onward" };
const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

export async function onRequestPost({ request, env, params }) {
  const metric = METRICS[params.what];
  if (!metric) return new Response("Not found", { status: 404, headers: NO_STORE });
  if (env.DB && sameOrigin(request)) {
    try { await countSite(env, [metric]); } catch (e) {}   // a counter never fails the page
  }
  return new Response(null, { status: 204, headers: NO_STORE });
}
