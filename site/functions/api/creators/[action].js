// The creator program (lib/referrals.js, LOR-503, CC-72, LOR-836): /creators' page, for a signed-in account.
//   GET  /api/creators/me       -> {signedIn, creator (lib/referrals.js creatorDashboard: their link, terms, numbers, tier
//                                  and payouts; null when the account isn't a creator), application ({status: "pending" |
//                                  "approved" | "declined", ...} or null), program: {sharePct, discount (the audience's %
//                                  off its first month), holdDays, minimum (US cents), tiers, term: {start, days,
//                                  cycleDays, runDays}}}
//   POST /api/creators/apply    {name, channel (a link), audience?, contact?, note?, agree: true} -> {application}
//   POST /api/creators/payout   {method: "paypal" | "wire", email (their PayPal's; for a wire, optional: where we write
//                               for the bank details)} -> {payout: {method, email}}
// POSTs need our Origin; apply 5 an hour, payout 10 a minute per account.

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { perMinute, perHour, slowDown } from "../../../lib/ratelimit.js";
import { creatorDashboard, applicationOf, applyCreator, creatorOfUser, savePayoutDetails, CREATOR_DEFAULTS, CREATOR_TIERS,
  CREATOR_TERM, PAYOUTS } from "../../../lib/referrals.js";

const ok = body => Response.json({ ok: true, ...body }, { headers: noStore });
const program = { sharePct: CREATOR_DEFAULTS.sharePct, discount: CREATOR_DEFAULTS.discount, holdDays: PAYOUTS.holdDays,
                  minimum: PAYOUTS.minimumCents, tiers: CREATOR_TIERS, term: CREATOR_TERM };

export async function onRequest({ request, env, params }) {
  const action = String(params.action);
  if (!["me", "apply", "payout"].includes(action)) return fail(404, "Not found.");
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  await setup(env);
  const method = action === "me" ? "GET" : "POST";
  if (request.method !== method) return fail(405, `Use ${method}.`);
  const user = await currentUser(env, request);
  const origin = new URL(request.url).origin;
  if (action === "me") {
    if (!user) return ok({ signedIn: false, creator: null, application: null, program });
    const [creator, application] = await Promise.all([creatorDashboard(env, user.id, origin), applicationOf(env, user.id)]);
    return ok({ signedIn: true, creator, application, program });
  }
  if (!sameOrigin(request)) return fail(403, "Please use the page on loreforeverwow.com.");
  if (!user) return fail(401, "You're signed out. Please sign in again.");
  let input = {};
  try { input = await request.json(); } catch (e) { input = {}; }
  if (action === "apply") {
    if (!(await perHour(env, user.id, "creator-apply", 5))) return slowDown();
    const out = await applyCreator(env, user, input || {});
    return out.error ? fail(400, out.error) : ok({ application: out.application });
  }
  if (!(await perMinute(env, user.id, "creator-payouts", 10))) return slowDown();
  const creator = await creatorOfUser(env, user.id);
  if (!creator) return fail(403, "That's for creators in the program.");
  const out = await savePayoutDetails(env, creator, { method: input?.method, email: input?.email });
  return out.error ? fail(400, out.error) : ok({ payout: out.payout });
}
