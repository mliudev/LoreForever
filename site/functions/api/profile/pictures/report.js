// POST /api/profile/pictures/report {id}: reports a picture on a profile's picture book (lib/pictures.js
// reportPicture) -> {hidden}. Anyone can, signed in or not, from our own pages; nobody reviews them: reports from
// REPORTS_TO_HIDE independent senders hide it for good. REPORTS_PER_DAY a day per sender (the day's IP hash).

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../../lib/accounts.js";
import { perDayFromIp } from "../../../../lib/ratelimit.js";
import { reportPicture, REPORTS_PER_DAY } from "../../../../lib/pictures.js";

export async function onRequest({ request, env }) {
  if (!env.DB) return fail(503, "Reports aren't set up yet.");
  if (request.method !== "POST") return fail(405, "Use POST.");
  // A page elsewhere could make its visitors report pictures here; browsers always send Origin on a POST.
  if (!sameOrigin(request)) return fail(403, "Please use the page on loreforeverwow.com.");
  await setup(env);
  let input;
  try { input = await request.json(); } catch (e) { return fail(400, "Couldn't read that."); }
  if (!(await perDayFromIp(env, request, "picture-report", REPORTS_PER_DAY))) {
    return fail(429, "That's a lot of reports for one day. Thank you! Please send the rest tomorrow.");
  }
  const { status, body } = await reportPicture(env, request, input?.id, await currentUser(env, request));
  return Response.json(body, { status, headers: noStore });
}
