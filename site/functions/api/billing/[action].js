// Plans (LOR-252, lib/billing.js): what /plans and the plan card on /account show, and the Stripe pages they send players to.
//   GET  /api/billing/plans     -> {on, plans: [{id, name, monthly (US cents), answersPerDay, answersPerMonth,
//                                  sellable, features, promo (the beta's, lib/billing.js launchOffer: {price (US
//                                  cents paid now: 0, 499, 999), label ("Beta: free month" | "Beta: 50% off"), note
//                                  ("until November 13, then $4.99 a month" | "your first month, then $9.99")}, only while it
//                                  applies to this player now: left out once their once-ever offer is used)}] (not
//                                  hidden ones), compare (lib/billing.js planCompare: [{label, values: {free, hero,
//                                  champion, legend}}], strings, "✓" and "—" for yes and no), current, starter (the
//                                  free plan's starter answers left), voiceNote (the fine print about Willo's finest
//                                  voice), voicePack: {price, replies, monthMax, text, buy (its button's words, when not
//                                  the usual), boughtThisMonth, open (the player's plan can buy one)}, or null to leave
//                                  it out (lib/billing.js voicePackFor: Legend sees it only near its month's last finest
//                                  replies)}: current is the signed-in player's plan (lib/billing.js planFor, with
//                                  changesTo for a downgrade waiting for the renewal), or null when signed out, when
//                                  there's no starter, boughtThisMonth or open either. launch: the beta promo's banner
//                                  (launchText) during the beta, else null; launchEnds: its last day ("November 3"),
//                                  else null.
//                                  {on: false} while plans are off.
//   POST /api/billing/checkout  {plan} -> {url}: Stripe's payment page; /plans again for a player who already has a
//                               plan (they switch with change). Plans are monthly: an interval other than "month" is a 400.
//   POST /api/billing/change    {plan, from (the plan the page showed), confirm, quote (the preview's)} -> without
//                               confirm {preview: {kind, plan, from, text, amount, quote}}: what switching to that plan
//                               does, in plain words (an upgrade's amount is Stripe's own preview of the charge); with
//                               it {done, text}, or {url} when the payment needs Stripe's page (lib/billing.js
//                               changePlan). Errors may carry reload (load the plans again) or stale (a new preview).
//   POST /api/billing/voicepack -> {url}: Stripe's payment page for a finest-voice pack (400 without a paid plan, or
//                               once this month's are bought)
//   POST /api/billing/portal    -> {url}: Stripe's billing portal (card, invoices, cancel; no plan changes)
//   POST /api/billing/webhook   from Stripe, signed (Stripe-Signature): 400 on a bad signature, else {received: true}
// Checkout, change, the packs and the portal need a signed-in player and our Origin, 10 a minute per account (change
// 30, since a switch is a preview and a confirm). Everything but plans is a 503 while plans are off (no
// STRIPE_SECRET_KEY).

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import {
  billingOn, setupBilling, sellablePlans, planFor, packsFor, createCheckout, createVoicePack, createPortal, changePlan,
  verifyWebhook, applyEvent, launchWeek, launchText, launchEnds, launchOffers, voicePackFor, planCompare, PLANS, FEATURES, VOICE_PACK,
  VOICE_PACK_TEXT, VOICE_NOTE,
} from "../../../lib/billing.js";
import { ALLOWED } from "../../../lib/willo-custom.js";
import { perMinute, slowDown } from "../../../lib/ratelimit.js";

const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });

async function plans({ request, env }) {
  const user = await currentUser(env, request);
  const sellable = sellablePlans(env);
  let current = null, packs = null, pack = { text: VOICE_PACK_TEXT };
  if (user) {
    const { costCapMicro, totalCapMicro, ...shown } = await planFor(env, user.id);
    current = shown;
    [packs, pack] = await Promise.all([packsFor(env, user.id), voicePackFor(env, user.id, shown)]);
  }
  // The beta's offers this player can still have (once each per account), by plan.
  const offers = await launchOffers(env, user?.id || null);
  const beta = launchWeek(env);
  return ok({
    on: true, current,
    plans: Object.values(PLANS).filter(p => !p.hidden).map(p => ({ id: p.id, name: p.name, monthly: p.monthly,
      answersPerDay: p.answersPerDay, answersPerMonth: p.answersPerMonth, sellable: sellable.includes(p.id),
      features: FEATURES[p.id], ...(offers[p.id] && sellable.includes(p.id) ? { promo: offers[p.id] } : {}) })),
    compare: planCompare(ALLOWED),
    ...(packs ? { starter: packs.starter } : {}),
    voicePack: pack && { price: VOICE_PACK.price, replies: VOICE_PACK.replies, monthMax: VOICE_PACK.monthMax, ...pack,
      ...(packs ? { boughtThisMonth: packs.voice.boughtThisMonth, open: current.id !== "free" && !current.launch } : {}) },
    voiceNote: VOICE_NOTE,
    launch: beta ? launchText(env) : null,
    launchEnds: beta ? launchEnds(env) : null,
  });
}

// Checkout, the portal or a plan change: Stripe's page for this player, what a change does, or why not.
async function stripePage({ request, env }, user, make, perMin = 10) {
  if (!(await perMinute(env, user.id, "billing", perMin))) return slowDown();
  try {
    const out = await make(new URL(request.url).origin);
    if (out.error) return Response.json({ ok: false, error: out.error, ...(out.reload ? { reload: true } : {}) },
      { status: 400, headers: noStore });
    const { error, ...body } = out;
    return ok(body);
  } catch (e) {
    console.warn(`billing: ${e?.message || e}`);
    return fail(502, "Couldn't reach Stripe just now. Please try again in a moment.");
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
  if (!["plans", "checkout", "change", "voicepack", "portal", "webhook"].includes(action)) return fail(404, "Not found.");
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
  if (action === "voicepack") return stripePage(context, user, origin => createVoicePack(env, user, origin));
  let input;
  try { input = await request.json(); } catch (e) { return fail(400, "Couldn't read that."); }
  if (!input || typeof input !== "object") return fail(400, "Couldn't read that.");
  const plan = String(input.plan || "");
  if (action === "change") {
    const from = typeof input.from === "string" ? input.from : null;
    return stripePage(context, user, () => changePlan(env, user, plan,
      { confirm: input.confirm === true, from, quote: typeof input.quote === "string" ? input.quote : null }), 30);
  }
  return stripePage(context, user, origin => createCheckout(env, user, plan, input.interval, origin));
}
