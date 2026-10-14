// Plans (LOR-252, lib/billing.js): what /plans and the plan card on /account show, and the Stripe pages they send players to.
//   GET  /api/billing/plans     -> {on, plans: [{id, name, monthly, yearly (US cents), answersPerDay, answersPerMonth,
//                                  lookupsPerMonth, sellable, features}] (not hidden ones), current, topup: {price
//                                  (US cents), answers, monthMax, boughtThisMonth, remaining}}:
//                                  current is the signed-in player's plan (lib/billing.js planFor), or null when signed
//                                  out, when topup has no boughtThisMonth or remaining either. {on: false} while plans
//                                  are off.
//   POST /api/billing/checkout  {plan, interval: "month" | "year"} -> {url}: Stripe's payment page, or the billing
//                               portal for a player who already has a plan
//   POST /api/billing/topup     -> {url}: Stripe's payment page for a top-up (400 once this month's are bought)
//   POST /api/billing/portal    -> {url}: Stripe's billing portal (change plan or card, cancel, invoices)
//   POST /api/billing/webhook   from Stripe, signed (Stripe-Signature): 400 on a bad signature, else {received: true}
// Checkout, top-up and portal need a signed-in player and our Origin, 10 a minute per account. Everything but plans is
// a 503 while plans are off (no STRIPE_SECRET_KEY).

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import {
  billingOn, setupBilling, sellablePlans, planFor, topupFor, createCheckout, createTopup, createPortal, verifyWebhook,
  applyEvent, PLANS, FEATURES, TOPUP,
} from "../../../lib/billing.js";
import { perMinute, slowDown } from "../../../lib/ratelimit.js";

const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });

async function plans({ request, env }) {
  const user = await currentUser(env, request);
  const sellable = sellablePlans(env);
  let current = null, mine = {};
  if (user) {
    const { costCapMicro, ...shown } = await planFor(env, user.id);
    current = shown;
    mine = await topupFor(env, user.id);
  }
  return ok({
    on: true, current,
    plans: Object.values(PLANS).filter(p => !p.hidden).map(p => ({ id: p.id, name: p.name, monthly: p.monthly,
      yearly: p.yearly, answersPerDay: p.answersPerDay, answersPerMonth: p.answersPerMonth, lookupsPerMonth: p.lookupsPerMonth,
      sellable: sellable.includes(p.id),
      features: FEATURES[p.id] })),
    topup: { price: TOPUP.price, answers: TOPUP.answers, monthMax: TOPUP.monthMax, ...mine },
  });
}

// Checkout or the portal: Stripe's page for this player, or why not.
async function stripePage({ request, env }, user, make) {
  if (!(await perMinute(env, user.id, "billing", 10))) return slowDown();
  try {
    const out = await make(new URL(request.url).origin);
    return out.error ? fail(400, out.error) : ok({ url: out.url });
  } catch (e) {
    console.warn(`billing: ${e?.message || e}`);
    return fail(502, "Couldn't open Stripe's page just now. Please try again in a moment.");
  }
}

// Stripe sends it again until it gets a 2xx, so a failure to apply the event is a 500.
async function webhook({ request, env }) {
  const event = await verifyWebhook(env, await request.text(), request.headers.get("Stripe-Signature"));
  if (!event) return fail(400, "That isn't a signed Stripe event.");
  try {
    await applyEvent(env, event);
  } catch (e) {
    console.warn(`billing webhook ${event.type} ${event.id}: ${e?.message || e}`);
    return fail(500, "Couldn't apply that event.");
  }
  return Response.json({ received: true }, { headers: noStore });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const action = String(params.action);
  if (!["plans", "checkout", "topup", "portal", "webhook"].includes(action)) return fail(404, "Not found.");
  // Stripe's events are applied whenever Stripe is set up, plans on or off, so a renewal or cancellation is never lost.
  const webhookOn = action === "webhook" && env.DB && env.STRIPE_SECRET_KEY;
  if (!billingOn(env) && !webhookOn)
    return action === "plans" && request.method === "GET" ? ok({ on: false }) : fail(503, "Plans aren't open yet.");
  await setup(env);
  await setupBilling(env);
  if (action === "plans") return request.method === "GET" ? plans(context) : fail(405, "Use GET.");
  if (request.method !== "POST") return fail(405, "Use POST.");
  if (action === "webhook") return webhook(context);   // signed by Stripe: no session or Origin
  if (!sameOrigin(request)) return fail(403, "Please use the page on loreforeverwow.com.");
  const user = await currentUser(env, request);
  if (!user) return fail(401, "You're signed out. Please sign in again.");
  if (action === "portal") return stripePage(context, user, origin => createPortal(env, user, origin));
  if (action === "topup") return stripePage(context, user, origin => createTopup(env, user, origin));
  let input;
  try { input = await request.json(); } catch (e) { return fail(400, "Couldn't read that."); }
  if (!input || typeof input !== "object") return fail(400, "Couldn't read that.");
  return stripePage(context, user, origin => createCheckout(env, user, String(input.plan || ""), input.interval, origin));
}
