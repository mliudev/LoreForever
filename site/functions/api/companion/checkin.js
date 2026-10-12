// The companion's once-a-day check-in (LOR-422, lib/checkins.js): counts companion installs in use, with no account.
//   POST /api/companion/checkin  {"v": 1, "install": "<SHA-256 hex of a random id made on that PC>",
//                                 "companion": "0.1.0", "addon": "0.14.0",
//                                 "usage": {"v": 2, "days": {...}}}   -> 204
// "usage" (LOR-435, lib/featureuse.js) is optional: the add-on's and the companion's anonymous usage counts per day,
// numbers only, unless the player turned off "Share anonymous usage counts". Older companions send none and are
// counted as before. Keys outside lib/featureuse.js KEYS are dropped, never stored; a body over MAX_BODY characters
// is a 413 (the companion then checks in without its counts).
// It needs "X-LF-Client: companion/<version>", which a page on another site can't send without a preflight we never
// answer. No account, no cookie, no name, no game text, and the IP isn't kept. Anything else is a 400; a database
// failure is a 503, so the companion tries again later.

import { readCheckin, saveCheckin, isInternal } from "../../../lib/checkins.js";
import { readFeatureUsage, saveFeatureUsage, dailyUpkeep, MAX_BODY } from "../../../lib/featureuse.js";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const answer = status => new Response(null, { status, headers: NO_STORE });

export async function onRequestPost({ request, env, waitUntil }) {
  if (!/^companion\/[\w.+-]{1,32}$/.test(request.headers.get("X-LF-Client") || "")) return answer(400);
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) return answer(413);
  let input = null;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return answer(413);
    input = JSON.parse(text);
  } catch (e) { /* not JSON */ }
  const checkin = readCheckin(input);
  if (!checkin) return answer(400);
  const usage = readFeatureUsage(input.usage);
  if (!env.DB) return answer(204);
  try {
    await saveCheckin(env, checkin);
    if (usage) await saveFeatureUsage(env, checkin.install, usage, isInternal(checkin));
  } catch (e) { return answer(503); }
  // The day's upkeep (old rows out, rollups) never holds up or fails a check-in.
  if (usage) {
    const upkeep = dailyUpkeep(env).catch(() => {});
    if (typeof waitUntil === "function") waitUntil(upkeep); else await upkeep;
  }
  return answer(204);
}
