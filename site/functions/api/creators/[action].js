// The creator program (lib/referrals.js, LOR-503, CC-72): /creators' page, for a signed-in account.
//   GET  /api/creators/me       -> {signedIn, creator (lib/referrals.js creatorDashboard: their link, terms, numbers and
//                                  payouts; null when the account isn't a creator), application ({status: "pending" |
//                                  "approved" | "declined", ...} or null), program: {sharePct, months, holdDays,
//                                  minimum (US cents)}, stripe (payouts through Stripe are on)}
//   POST /api/creators/apply    {name, channel (a link), audience?, contact?, note?, agree: true} -> {application}
//   POST /api/creators/payouts  {country (two letters)} -> {url}: Stripe's page to set up the creator's payouts (their
//                               Express account), once Stripe payouts are on
//   POST /api/creators/stripe   -> {url}: Stripe's page for the creator's payouts and bank details
// POSTs need our Origin; apply 5 an hour, the others 10 a minute per account.

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { perMinute, perHour, slowDown } from "../../../lib/ratelimit.js";
import { creatorDashboard, applicationOf, applyCreator, creatorOfUser, startConnect, connectLogin, stripePayoutsOn,
  CREATOR_DEFAULTS, PAYOUTS } from "../../../lib/referrals.js";

const ok = body => Response.json({ ok: true, ...body }, { headers: noStore });
const program = { sharePct: CREATOR_DEFAULTS.sharePct, months: CREATOR_DEFAULTS.months, holdDays: PAYOUTS.holdDays,
                  minimum: PAYOUTS.minimumCents };

export async function onRequest({ request, env, params }) {
  const action = String(params.action);
  if (!["me", "apply", "payouts", "stripe"].includes(action)) return fail(404, "Not found.");
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  await setup(env);
  const method = action === "me" ? "GET" : "POST";
  if (request.method !== method) return fail(405, `Use ${method}.`);
  const user = await currentUser(env, request);
  const origin = new URL(request.url).origin;
  if (action === "me") {
    if (!user) return ok({ signedIn: false, creator: null, application: null, program, stripe: false });
    const [creator, application, stripe] = await Promise.all([creatorDashboard(env, user.id, origin),
      applicationOf(env, user.id), stripePayoutsOn(env)]);
    return ok({ signedIn: true, creator, application, program, stripe });
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
  const out = action === "payouts" ? await startConnect(env, creator, origin, { country: input?.country, email: user.email })
    : await connectLogin(env, creator);
  return out.error ? fail(400, out.error) : ok({ url: out.url });
}
