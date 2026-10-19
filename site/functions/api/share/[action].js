// Inviting friends (lib/referrals.js): a player's own invite link and how far it has brought them.
//   GET  /api/share/mine       -> {share: {code, url, joined, waiting, friends, progress: {have, goal, left, bonusLeft,
//                                 months, ...}, month: {counted, max}, left, rewards: [{kind, status, text}], invite,
//                                 grows, about, tally, earned, waitingNote}} (lib/referrals.js shareSummary): /account,
//                                 the profile and Willo's window (older Willos show about and tally)
//   POST /api/share/new        -> the same, with a new code: the old link stops bringing friends (those it brought
//                                 already stay counted)
//   GET  /api/share/info?code= -> {name, kind ("player" | "creator"), self (it's the signed-in player's own)}: who a
//                                 link is from (name: a public profile's character, a creator's name, or null), 404
//                                 for an unknown or retired code
// mine and new take a signed-in player on our pages (a POST with our Origin) or Willo herself (X-LF-Client:
// companion/<version>, no Origin, Authorization: Bearer <her token>). new: 5 a minute per account.

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { perMinute, slowDown } from "../../../lib/ratelimit.js";
import { shareSummary, newShareCode, codeOwner } from "../../../lib/referrals.js";

const COMPANION = /^companion\/[\w.-]{1,24}$/;
const fromCompanion = request => COMPANION.test(request.headers.get("X-LF-Client") || "") && !request.headers.get("Origin");
const ok = body => Response.json({ ok: true, ...body }, { headers: noStore });

export async function onRequest({ request, env, params }) {
  const action = String(params.action);
  if (!["mine", "new", "info"].includes(action)) return fail(404, "Not found.");
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  await setup(env);
  const method = action === "new" ? "POST" : "GET";
  if (request.method !== method) return fail(405, `Use ${method}.`);
  const origin = new URL(request.url).origin;
  const companion = fromCompanion(request);
  const user = companion ? (await currentDevice(env, request))?.user : await currentUser(env, request);
  if (action === "info") {
    const owner = await codeOwner(env, new URL(request.url).searchParams.get("code"));
    if (!owner) return fail(404, "There's no such link.");
    return ok({ name: owner.name, kind: owner.kind, self: Boolean(user && owner.userId === user.id) });
  }
  if (!user) return fail(401, companion ? "Connect Willo to your account first." : "You're signed out. Please sign in again.");
  if (action === "new") {
    if (!companion && !sameOrigin(request)) return fail(403, "Please use the page on loreforeverwow.com.");
    if (!(await perMinute(env, user.id, "share-new", 5))) return slowDown();
    await newShareCode(env, user.id);
  }
  return ok({ share: await shareSummary(env, user.id, origin) });
}
