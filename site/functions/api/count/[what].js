// Counts something a page did, per day, as a plain number (lib/usage.js countSite, LOR-151): nothing about who.
//   POST /api/count/share   Share pressed or a profile link copied (public/js/profile.js, /account), sent as a beacon
// Only from our own pages (Origin); anything else is a 404. /admin shows the counts in its Usage section.

import { sameOrigin } from "../../../lib/accounts.js";
import { countSite } from "../../../lib/usage.js";

const METRICS = { share: "profile.share" };
const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

export async function onRequestPost({ request, env, params }) {
  const metric = METRICS[params.what];
  if (!metric) return new Response("Not found", { status: 404, headers: NO_STORE });
  if (env.DB && sameOrigin(request)) {
    try { await countSite(env, [metric]); } catch (e) {}   // a counter never fails the page
  }
  return new Response(null, { status: 204, headers: NO_STORE });
}
