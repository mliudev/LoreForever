// Plans (LOR-252): what a player's subscription gives them, paid through Stripe. The free plan is Adventurer; Hero,
// Champion and Legend are monthly or yearly subscriptions. A plan sets how many live answers Willo, the companion,
// gets a day and a month, and what kind (lib/companion-answers.js, functions/api/companion/answer.js): free answers
// stay with the world's lore, without web research or the game picture; paid ones may check the web, and Champion's
// keep a longer chat memory. It also sets how much a paying player's month may cost us, and what the companion app may
// do on its own PC (COMPANION_FEATURES: Willo's voices, push-to-talk, sight). Launch plans: Mike, 2026-10-12. Legend
// is hidden until its features exist.
//
// How a subscription reaches us: /plans asks POST /api/billing/checkout (functions/api/billing/[action].js), which
// makes a Stripe Checkout page (createCheckout) and sends the player there. Stripe then calls our webhook
// (POST /api/billing/webhook) with signed events (verifyWebhook); applyEvent fetches the subscription from Stripe and
// stores what it says now in `entitlements`, so an event that comes twice or out of order changes nothing. Changing
// plan or card and cancelling happen on Stripe's billing portal (createPortal). We never see card details: D1 keeps
// the plan, its status and dates, and Stripe's ids for the customer and the subscription. "Delete my account" cancels
// the subscription and removes those rows (lib/accounts.js deleteUser, cancelPlan here).
//
// Top-ups (LOR-431): a one-time pack of TOPUP.answers live answers that never expire, for anyone signed in, on any
// plan. POST /api/billing/topup makes a Checkout page in payment mode (createTopup); the webhook credits the pack once
// per checkout session (creditTopup) and a refund or a dispute takes its answers back (refundTopup). Its answers are
// used only once the day's plan answers are gone, oldest pack first (useTopup), within the day's most (dayMax).
//
// The starter: the free plan's one-time STARTER_ANSWERS answers, kept with the top-ups (answer_packs, kind 'starter')
// and used like them after the day's free answers, but free: they wait for the shared monthly budget like any free
// answer, can't be bought, never count as a month's top-up, and a refund never touches them. Once per Google account,
// even after "Delete my account" (creditStarter).
//
// The "plans" site feature (lib/features.js) switches all of it: while it's off (the default), nothing is for sale,
// stored subscriptions are ignored and every account gets OFF_ANSWERS a day, with research and pictures, as before
// plans. SITE_FEATURES=plans turns it on.
//
// Pages settings (Settings > Variables and Secrets):
//   STRIPE_SECRET_KEY        a key: restricted (rk_..., what Stripe recommends) or secret (sk_...); a test one on Preview
//                            (develop), a live one in Production. Without it nothing is for sale, and live answers use
//                            the free plan's limits.
//   STRIPE_WEBHOOK_SECRET    the webhook's signing secret (whsec_...), from scripts/stripe-setup.mjs --webhook. With
//                            --live it's written to .env as STRIPE_LIVE_WEBHOOK_SECRET, and Production may keep it
//                            under that name instead (verifyWebhook reads either, STRIPE_WEBHOOK_SECRET first).
//   BILLING_PLANS            optional: which plans are for sale, e.g. "hero,champion" (default: SELLABLE)
//   STRIPE_MANAGED_PAYMENTS  "1" makes Stripe the merchant of record (it handles VAT and sales tax). Only once
//                            Managed Payments is turned on in the Stripe Dashboard.
//   STRIPE_LIVE              "1" lets a live key work, in Production only. Unset, a live key is refused, so one pasted
//                            into the wrong place can't charge anyone.
// scripts/stripe-setup.mjs makes the products, prices, portal settings and webhook from the constants below.
// Kept outside functions/ so Pages doesn't route it.

import { featureOn } from "./features.js";
import { COMPANION_NAME } from "./brand.js";

// The plans, cheapest first. Prices in US cents. A paid plan's answers are a month's pool (answersPerMonth) with a most
// in one day (answersPerDay), and lookupsPerMonth of them may look online (required research or a quick look-up; a
// finding another player's search kept is free). Its month runs from its renewal day (poolWindow), so a month paid for
// never holds two pools. Sized so half the price is margin even when every answer is used (Mike, 2026-10-12: "pare
// down the plans then so I'm making 50% margin"): at about $0.0018 an answer and $0.05 a look-up, Hero's month costs
// at most about $2.12 of the $4.37 it brings after Stripe's fees, Champion's $4.42 of $9.05. The free plan has only
// its daily answers. costCapMicro: what a paying player's live answers may cost us in a month (millionths of a
// dollar), a safety net the sizes stay under; past it, answers go back to the ordinary model without web research
// until the month ends (fair_use in the allowance). Nobody is cut off by it. longMemory: chat memory keeps twice as
// much. stronger: answers and character replies on the stronger model (lib/companion-answers.js RESEARCH_MODEL); no
// plan for sale has it, since it costs three times as much.
export const PLANS = {
  free: { id: "free", name: "Adventurer", monthly: 0, yearly: 0, answersPerDay: 20, lookupsPerMonth: 0, costCapMicro: 0 },
  hero: { id: "hero", name: "Hero", monthly: 499, yearly: 4999, answersPerDay: 100, answersPerMonth: 900,
          lookupsPerMonth: 10, costCapMicro: 2_500_000 },
  champion: { id: "champion", name: "Champion", monthly: 999, yearly: 9999, answersPerDay: 200, answersPerMonth: 1900,
              lookupsPerMonth: 20, costCapMicro: 5_000_000, longMemory: true },
  // Not built yet (Mike, 2026-10-12): off /plans and never for sale.
  legend: { id: "legend", name: "Legend", monthly: 1999, yearly: 19999, answersPerDay: 300, answersPerMonth: 4000,
            lookupsPerMonth: 40, costCapMicro: 10_000_000, longMemory: true, stronger: true, hidden: true },
};
export const PAID = Object.keys(PLANS).filter(id => id !== "free");

// The free plan's one-time starter: answers for each account, used after the day's free answers (creditStarter).
export const STARTER_ANSWERS = 30;
// Willo's voices in the companion app (companion/lore_companion/talk/tts.py KOKORO_VOICES); the free plan has its
// default one.
export const WILLO_VOICES = 7;

// What the companion app may do on each plan, sent with the allowance (lib/companion-answers.js `features`): Willo's
// session turns its own features on or off by it. voices: "all" of Willo's voices, or only its "default" one;
// push_to_talk: asking out loud; sight: Willo sees the game (the site also drops a free player's picture); npc_voices:
// unused since characters answer in Willo's own voice (older companions still read it); research: answers that check the web (the site also enforces it).
export const COMPANION_FEATURES = {
  free: { voices: "default", push_to_talk: false, sight: false, npc_voices: false, research: false },
  paid: { voices: "all", push_to_talk: true, sight: true, npc_voices: true, research: true },
};
export const companionFeatures = plan => plan.id === "free" ? COMPANION_FEATURES.free : COMPANION_FEATURES.paid;

// What /plans lists on each plan's card, in plain words. The style and the tales are /willo (lib/willo-custom.js).
const NAME = COMPANION_NAME;
const count = n => n.toLocaleString("en-US");
const pool = plan => `${count(plan.answersPerMonth)} ${NAME} answers a month, up to ${plan.answersPerDay} a day`;
export const FEATURES = {
  free: [`${STARTER_ANSWERS} ${NAME} answers to start, then ${PLANS.free.answersPerDay} a day`,
         `${NAME} speaks in its own voice`, "The whole add-on, every narration pack and language"],
  hero: [pool(PLANS.hero), `${PLANS.hero.lookupsPerMonth} web look-ups a month`, `All ${WILLO_VOICES} ${NAME} voices`,
         "Push-to-talk", `${NAME} sees your game`, `Preset ${NAME} styles`],
  champion: [pool(PLANS.champion), `${PLANS.champion.lookupsPerMonth} web look-ups a month`, `${NAME}'s longer memory`,
             `Write ${NAME}'s personality`, "Rewrite NPCs as your own tale", `Create your own ${NAME} voice (coming soon)`],
  // Not on /plans (hidden) until these exist.
  legend: [pool(PLANS.legend), `Talk with ${NAME} hands-free while you play`, `${NAME} on your own AI model`,
           "Your journey's chapters, narrated"],
};

// The line under each plan's name on Stripe's checkout page, invoices and billing portal (its product's description,
// set by scripts/stripe-setup.mjs).
export const BLURBS = {
  hero: `${pool(PLANS.hero)}, with ${PLANS.hero.lookupsPerMonth} web look-ups, all ${WILLO_VOICES} of ${NAME}'s voices, ` +
        `push-to-talk, and ${NAME} sees your game.`,
  champion: `${pool(PLANS.champion)}, with ${PLANS.champion.lookupsPerMonth} web look-ups, ${NAME}'s longer memory, ` +
            `${NAME}'s personality in your words, and NPCs rewritten as your own tale. Everything in Hero too. ` +
            `Create your own ${NAME} voice (coming soon).`,
  legend: `${pool(PLANS.legend)}, hands-free chat while you play, and everything in Champion.`,
  topup: `300 more ${NAME} answers, used after your plan's answers. They never expire.`,
};

// For sale unless BILLING_PLANS says otherwise. A hidden plan (Legend) is never for sale or listed.
export const SELLABLE = ["hero", "champion"];

// A top-up: answers in a pack, its price (US cents), how many an account can buy a calendar month (UTC), and what a
// pack's answers may cost us (millionths of a dollar) before they go back to the ordinary model without web research.
// Nobody is cut off by it. key: its Stripe price's lookup key; product: its Stripe product's id.
export const TOPUP = { answers: 300, price: 299, monthMax: 3, costCapMicro: 1_500_000, key: "topup_300",
                       product: "lore_forever_topup" };
// The most live answers an account gets in one day, plan, starter and top-ups together, whatever was bought; a plan
// with more of its own (Legend) gets those (dayMax).
export const DAY_MAX = 200;
export const dayMax = plan => Math.max(DAY_MAX, plan.answersPerDay);

// A paid plan's month, for its answer pool and web look-ups: from its renewal day (the day of the month its paid period
// ends, `renews` from planFor, clamped to a shorter month's last day) to the same day the next month, UTC, so a month
// paid for never holds two pools; the calendar month without a renewal day. {key: the month's first day (YYYY-MM-DD,
// for the rate_limits bucket), resetsAt: when the next one starts (ISO)}.
export function poolWindow(plan, now = new Date()) {
  const renews = plan?.renews ? new Date(plan.renews) : null;
  const anchor = renews && !isNaN(renews) ? renews.getUTCDate() : 1;
  const on = (y, m) => new Date(Date.UTC(y, m, Math.min(anchor, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())));
  let start = on(now.getUTCFullYear(), now.getUTCMonth());
  if (start > now) start = on(now.getUTCFullYear(), now.getUTCMonth() - 1);
  return { key: start.toISOString().slice(0, 10), resetsAt: on(start.getUTCFullYear(), start.getUTCMonth() + 1).toISOString() };
}

// The free plan's brake: once this month's free spend (free live answers, profile stories and their voice) passes
// this, free players get BRAKE_ANSWERS a day until the month ends, so the site's monthly budget lasts. Starter answers
// still need that budget; paying players are unaffected.
export const BRAKE_MICRO = 80_000_000;
export const BRAKE_ANSWERS = 5;

// Stripe statuses that keep the plan until the paid period ends. past_due: a payment failed and Stripe is retrying it.
export const ACTIVE = ["active", "trialing", "past_due"];
export const STRIPE_VERSION = "2026-08-26.dahlia";   // every call, and the webhook's events, use this API version
export const WEBHOOK_TOLERANCE = 300;                // seconds a webhook's signature stays good, as Stripe's libraries allow
// Stripe asks each integration to label its Checkout Sessions: a name and 8 random letters, kept the same.
export const INTEGRATION_ID = "willo_plans_qkzmhtra";
// Events that can change a plan. Each fetches the subscription from Stripe and stores what it says now.
const PLAN_EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded",
                     "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
                     "invoice.paid", "invoice.payment_failed"];
// A paid checkout in payment mode (the first two of PLAN_EVENTS) credits a top-up instead; a refund or a dispute takes
// one back. scripts/stripe-setup.mjs --webhook subscribes the webhook to them.
const TOPUP_EVENTS = ["charge.refunded", "charge.dispute.created"];
// What the webhook subscribes to: those, and a delayed payment that failed, which is only recorded (its subscription
// never became active, and a top-up is credited only once paid, so there's nothing to take away).
export const WEBHOOK_EVENTS = [...PLAN_EVENTS, ...TOPUP_EVENTS, "checkout.session.async_payment_failed"];

// Live answers a day for every account while the plans feature is off: the number from before plans.
export const OFF_ANSWERS = 20;
export const plansOn = env => featureOn(env, "plans");
export const billingOn = env => plansOn(env) && Boolean(env.STRIPE_SECRET_KEY && env.DB);
export const lookupKey = (planId, interval) => `${planId}_${interval === "year" ? "yearly" : "monthly"}`;

// The plans for sale: BILLING_PLANS when it's set, else SELLABLE. Never the free one.
export function sellablePlans(env) {
  const set = String(env.BILLING_PLANS ?? "").trim();
  return (set ? set.split(",").map(s => s.trim()) : SELLABLE).filter(id => PAID.includes(id) && !PLANS[id].hidden);
}

const month = (now = new Date()) => now.toISOString().slice(0, 7);
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
const idOf = v => typeof v === "string" ? v : typeof v?.id === "string" ? v.id : null;

// ---- The tables ----

// Created here rather than in lib/accounts.js SETUP, since only plans use them; "Delete my account" removes their rows.
// entitlements: one row per account that ever opened checkout. plan: free unless the subscription is in ACTIVE;
// interval: month or year; current_period_end: when the paid period ends (ISO). billing_events: the webhook events
// already applied (Stripe's event id), so a repeat is skipped. answer_user_spend: what a player's paid-for live answers
// cost this month (UTC, "2026-10"): micro is all of it, topup_micro the part top-up answers cost, so a plan's cost cap
// counts only the plan's answers (also in lib/accounts.js SETUP, since the shared budget reads it). answer_packs: one
// row per top-up bought, keyed by its Checkout Session's id so a pack is credited once, and the account's starter
// (kind 'starter', keyed "starter:<user id>", so it's credited once too); remaining: its answers left; spent_micro:
// what a top-up's answers have cost, for TOPUP.costCapMicro; payment_intent: Stripe's payment, which a refund or a
// dispute names (none for a starter); status: active, refunded or disputed. answer_holds: what answers still being
// written hold against a plan's cost cap (pack_id null) or a top-up's (holdUserSpend), one row per answer, gone once
// it's settled. starter_claims: the Google accounts that have had a starter, by a salted hash of their Google ID
// (starterClaim), kept after "Delete my account" so deleting it and signing in again doesn't bring another;
// billing_salt: that hash's random salt, made once.
const SETUP = [
  `CREATE TABLE IF NOT EXISTS entitlements (
    user_id TEXT PRIMARY KEY, customer_id TEXT UNIQUE, subscription_id TEXT, plan TEXT NOT NULL DEFAULT 'free',
    interval TEXT, status TEXT, current_period_end TEXT, cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    updated TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS billing_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, created TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS answer_user_spend (
    user_id TEXT NOT NULL, month TEXT NOT NULL, micro INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0,
    topup_micro INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, month))`,
  `CREATE TABLE IF NOT EXISTS answer_packs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, answers INTEGER NOT NULL, remaining INTEGER NOT NULL,
    spent_micro INTEGER NOT NULL DEFAULT 0, payment_intent TEXT, status TEXT NOT NULL DEFAULT 'active', created TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'topup')`,
  "CREATE INDEX IF NOT EXISTS answer_packs_user ON answer_packs (user_id, created)",
  `CREATE TABLE IF NOT EXISTS answer_holds (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, pack_id TEXT, micro INTEGER NOT NULL, created TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS answer_holds_user ON answer_holds (user_id, created)",
  "CREATE TABLE IF NOT EXISTS starter_claims (sub_hash TEXT PRIMARY KEY, created TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS billing_salt (id INTEGER PRIMARY KEY CHECK (id = 1), salt TEXT NOT NULL)",
];
// Columns added after their table was first made. Packs from before the starter are all top-ups.
const MIGRATE = ["ALTER TABLE answer_user_spend ADD COLUMN topup_micro INTEGER NOT NULL DEFAULT 0",
                 "ALTER TABLE answer_packs ADD COLUMN kind TEXT NOT NULL DEFAULT 'topup'"];
const ready = new WeakSet();
export async function setupBilling(env) {
  if (ready.has(env.DB)) return;
  await env.DB.batch(SETUP.map(s => env.DB.prepare(s)));
  for (const sql of MIGRATE) {
    try { await env.DB.prepare(sql).run(); } catch (e) {}   // fails once the column exists
  }
  ready.add(env.DB);
}

// ---- Stripe ----

// Stripe's form encoding: nested objects and arrays as bracketed keys (line_items[0][price]=...).
export function formBody(params, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") formBody(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

// One call to Stripe's API. Throws with Stripe's own message when it fails, with anything that looks like a key taken
// out, so no key reaches a log. A live key is refused unless STRIPE_LIVE is "1", so a key pasted into the wrong place
// (Preview, say) can't charge anyone.
export async function stripe(env, method, path, params, { idempotencyKey } = {}) {
  const key = String(env.STRIPE_SECRET_KEY || "");
  if (!key) throw new Error("Stripe isn't set up (no STRIPE_SECRET_KEY).");
  if (/^[sr]k_live_/.test(key) && env.STRIPE_LIVE !== "1")
    throw new Error("STRIPE_SECRET_KEY is a live key, and STRIPE_LIVE isn't \"1\" here. Use a test key (rk_test_ or sk_test_).");
  const body = formBody(params).toString();
  const headers = { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_VERSION };
  if (method !== "GET") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`https://api.stripe.com/v1/${path}${method === "GET" && body ? "?" + body : ""}`,
    { method, headers, body: method === "GET" ? undefined : body, signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = String(data?.error?.message || `Stripe HTTP ${res.status}`).replace(/\b(?:[sr]k|whsec)_[\w*]+/g, "[key]");
    throw Object.assign(new Error(message), { status: res.status });
  }
  return data;
}

// Price ids by lookup key ("hero_monthly", "topup_300"), kept for the life of the isolate: a key only moves to a new
// price when scripts/stripe-setup.mjs changes an amount, and the next deploy or cold start picks that up.
const prices = new Map();
async function priceId(env, key) {
  if (!prices.has(key)) {
    const keys = [...PAID.flatMap(id => [lookupKey(id, "month"), lookupKey(id, "year")]), TOPUP.key];
    const list = await stripe(env, "GET", "prices", { lookup_keys: keys, active: true, limit: 100 });
    for (const p of list?.data || []) if (p.lookup_key) prices.set(p.lookup_key, p.id);
  }
  return prices.get(key) || null;
}

// The billing portal settings scripts/stripe-setup.mjs made for plans (metadata lore_forever=plans), or null for the
// Stripe account's default ones. Looked up once per isolate.
let portalSettings;
async function portalConfiguration(env) {
  if (portalSettings === undefined) {
    const list = await stripe(env, "GET", "billing_portal/configurations", { active: true, limit: 100 });
    portalSettings = (list?.data || []).find(c => c.metadata?.lore_forever === "plans")?.id || null;
  }
  return portalSettings;
}

// ---- Plans ----

const entitlement = (env, userId) => env.DB.prepare("SELECT * FROM entitlements WHERE user_id = ?").bind(userId).first();

// Whether a stored subscription still gives its plan: a status in ACTIVE and a paid period that hasn't ended.
function paidNow(row, now = new Date()) {
  return Boolean(row && PAID.includes(row.plan) && ACTIVE.includes(row.status) &&
    (!row.current_period_end || Date.parse(row.current_period_end) > now.getTime()));
}

// This month's paid calls site-wide that the shared budget pays for (what the free plan's brake looks at), as
// lib/companion-answers.js counts them: paying players' answers are left out, since their plans pay for those.
async function paidSpend(env, now) {
  const row = await env.DB.prepare(
    "SELECT COALESCE((SELECT reserved_micro FROM answer_spend WHERE month = ?), 0) - " +
    "COALESCE((SELECT SUM(micro) FROM answer_user_spend WHERE month = ?), 0) + " +
    "COALESCE((SELECT micro_usd + voice_micro_usd + reserved_micro FROM story_spend WHERE month = ?), 0) AS micro"
  ).bind(month(now), month(now), month(now)).first();
  return row?.micro || 0;
}

// The free plan's starter: STARTER_ANSWERS answers, credited once per account, the first time its plan is looked at
// while a companion is connected (the companion's allowance check, usually). Keyed by the account, so two checks at
// once, or a companion connected again, never credit it twice; the row stays at 0 once it's used up. And once per
// Google account (security review L3): its claim (starterClaim) is kept after "Delete my account", so deleting the
// account and signing in again doesn't bring another. The pack and the claim go in one batch.
async function creditStarter(env, userId, now) {
  const id = `starter:${userId}`;
  if (await env.DB.prepare("SELECT 1 AS y FROM answer_packs WHERE id = ?").bind(id).first()) return;
  const claim = await starterClaim(env, userId);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO answer_packs (id, user_id, kind, answers, remaining, created) " +
      "SELECT ?, ?, 'starter', ?, ?, ? WHERE EXISTS (SELECT 1 FROM devices WHERE user_id = ?) " +
      "AND NOT EXISTS (SELECT 1 FROM starter_claims WHERE sub_hash = ?)"
    ).bind(id, userId, STARTER_ANSWERS, STARTER_ANSWERS, iso(now.getTime()), userId, claim),
    ...(claim ? [env.DB.prepare("INSERT OR IGNORE INTO starter_claims (sub_hash, created) " +
      "SELECT ?, ? WHERE EXISTS (SELECT 1 FROM answer_packs WHERE id = ?)").bind(claim, iso(now.getTime()), id)] : []),
  ]);
}

// The account's Google ID (users.google_sub) as a salted SHA-256, for starter_claims: it can be matched against a
// Google account signing in, but doesn't hold the ID itself. null for an account without one.
const salts = new WeakMap();   // env.DB -> the salt, so most checks skip the lookup
async function starterClaim(env, userId) {
  const user = await env.DB.prepare("SELECT google_sub FROM users WHERE id = ?").bind(userId).first();
  if (!user?.google_sub) return null;
  if (!salts.has(env.DB)) {
    // Two isolates can get here at once: both insert, one wins, and both read back the winner's salt.
    await env.DB.prepare("INSERT OR IGNORE INTO billing_salt (id, salt) VALUES (1, ?)")
      .bind(hex(crypto.getRandomValues(new Uint8Array(32)))).run();
    salts.set(env.DB, (await env.DB.prepare("SELECT salt FROM billing_salt WHERE id = 1").first()).salt);
  }
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salts.get(env.DB)}:${user.google_sub}`)));
}

// The plan an account has right now: {id, name, answersPerDay, answersPerMonth (a paid plan's), lookupsPerMonth,
// costCapMicro, status, renews, cancelAtPeriodEnd, portal}. renews: when the paid period ends (it renews then unless cancelAtPeriodEnd). portal: they have a
// subscription to manage on the billing portal, even an ended one. On the free plan, answersPerDay is the brake's when
// it applies (with brake: true), and the account gets its starter (creditStarter).
export async function planFor(env, userId, now = new Date()) {
  // Plans switched off: everyone has the free plan with the answers from before plans, whatever is stored.
  if (!plansOn(env)) {
    return { id: "free", name: PLANS.free.name, answersPerDay: OFF_ANSWERS, costCapMicro: 0, status: null, renews: null,
             cancelAtPeriodEnd: false, portal: false };
  }
  await setupBilling(env);
  const row = await entitlement(env, userId);
  const portal = Boolean(row?.subscription_id);
  if (paidNow(row, now)) {
    const plan = PLANS[row.plan];
    return { id: plan.id, name: plan.name, answersPerDay: plan.answersPerDay, answersPerMonth: plan.answersPerMonth,
             lookupsPerMonth: plan.lookupsPerMonth, costCapMicro: plan.costCapMicro, status: row.status, renews: row.current_period_end, cancelAtPeriodEnd: Boolean(row.cancel_at_period_end), portal };
  }
  const [spent] = await Promise.all([paidSpend(env, now), creditStarter(env, userId, now)]);
  const brake = spent > BRAKE_MICRO;
  const free = PLANS.free;
  return { id: free.id, name: free.name, costCapMicro: 0, lookupsPerMonth: 0, status: null, renews: null,
           cancelAtPeriodEnd: false, portal,
           answersPerDay: brake ? BRAKE_ANSWERS : free.answersPerDay, ...(brake ? { brake: true } : {}) };
}

// Holds `micro` (what lib/companion-answers.js answerReservation reserves for an answer) against the cost cap that
// pays for the answer, before it's written: a top-up pack's (packId, TOPUP.costCapMicro) or the plan's month (cap,
// its costCapMicro). One statement, and only while the cap isn't reached yet, counting the holds of answers still
// being written, so questions asked at the same moment can't all get in under a cap one of them reaches (security
// review M3). A hold counts for HOLD_SECONDS at most, longer than any answer takes, so one whose request was cut off
// before it could settle (the player disconnected, say) doesn't keep their cap for the rest of the month. The hold's
// id when it's held, else null; addUserSpend settles it with what the answer cost, and releaseUserSpend gives it back.
export const HOLD_SECONDS = 300;
export async function holdUserSpend(env, userId, micro, now = new Date(), { packId = null, cap = 0 } = {}) {
  await setupBilling(env);
  if (!packId && !(cap > 0)) return null;
  const id = crypto.randomUUID(), since = iso(now.getTime() - HOLD_SECONDS * 1000);
  const spent = packId ? "(SELECT spent_micro FROM answer_packs WHERE id = ?)"
    : "COALESCE((SELECT micro - topup_micro FROM answer_user_spend WHERE user_id = ? AND month = ?), 0)";
  const [, held] = await env.DB.batch([
    env.DB.prepare("DELETE FROM answer_holds WHERE user_id = ? AND created <= ?").bind(userId, since),
    env.DB.prepare(
      "INSERT INTO answer_holds (id, user_id, pack_id, micro, created) SELECT ?, ?, ?, ?, ? WHERE " +
      `${spent} + (SELECT COALESCE(SUM(micro), 0) FROM answer_holds WHERE user_id = ? AND pack_id IS ? AND created > ?) < ?`
    ).bind(id, userId, packId, micro, iso(now.getTime()), ...(packId ? [packId] : [userId, month(now)]),
           userId, packId, since, packId ? TOPUP.costCapMicro : cap),
  ]);
  return held.meta.changes ? id : null;
}

// Gives back a hold (holdUserSpend), for an answer that ended without being written; with `keep`, only down to that,
// for an answer that needs less.
export async function releaseUserSpend(env, holdId, keep = 0) {
  await setupBilling(env);
  await (keep ? env.DB.prepare("UPDATE answer_holds SET micro = ? WHERE id = ?").bind(keep, holdId)
    : env.DB.prepare("DELETE FROM answer_holds WHERE id = ?").bind(holdId)).run();
}

// What a paid-for live answer cost, by a plan or by a top-up pack (packId), for their cost caps
// (lib/companion-answers.js counts each answer's cost; functions/api/companion/answer.js adds it here). Both go into
// answer_user_spend, so the shared budget leaves them out; a top-up's also into its pack. holdId: the answer's hold
// on its cap (holdUserSpend), which goes in the same batch.
export async function addUserSpend(env, userId, micro, now = new Date(), packId = null, holdId = null) {
  await setupBilling(env);
  const cost = Math.max(0, Math.round(Number(micro) || 0));
  const statements = [env.DB.prepare(
    "INSERT INTO answer_user_spend (user_id, month, micro, calls, topup_micro) VALUES (?, ?, ?, 1, ?) " +
    "ON CONFLICT (user_id, month) DO UPDATE SET micro = micro + excluded.micro, calls = calls + 1, " +
    "topup_micro = topup_micro + excluded.topup_micro"
  ).bind(userId, month(now), cost, packId ? cost : 0)];
  if (packId) statements.push(env.DB.prepare("UPDATE answer_packs SET spent_micro = spent_micro + ? WHERE id = ?").bind(cost, packId));
  if (holdId) statements.push(env.DB.prepare("DELETE FROM answer_holds WHERE id = ?").bind(holdId));
  await env.DB.batch(statements);
}

// What the plan's answers cost this month, for its cost cap: top-up answers pay for themselves. Holds of answers still
// being written aren't counted.
export async function userSpend(env, userId, now = new Date()) {
  await setupBilling(env);
  const row = await env.DB.prepare("SELECT micro - topup_micro AS micro FROM answer_user_spend WHERE user_id = ? AND month = ?")
    .bind(userId, month(now)).first();
  return row?.micro || 0;
}

// ---- Top-ups ----

// The account's top-up answers left (every active top-up), its starter answers left, and the top-ups it bought this
// month (a refunded one isn't counted, nor the starter): {remaining, starter, boughtThisMonth}.
export async function topupFor(env, userId, now = new Date()) {
  await setupBilling(env);
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(CASE WHEN status = 'active' AND kind = 'topup' THEN remaining ELSE 0 END), 0) AS remaining, " +
    "COALESCE(SUM(CASE WHEN status = 'active' AND kind = 'starter' THEN remaining ELSE 0 END), 0) AS starter, " +
    "COALESCE(SUM(kind = 'topup' AND status != 'refunded' AND substr(created, 1, 7) = ?), 0) AS bought " +
    "FROM answer_packs WHERE user_id = ?"
  ).bind(month(now), userId).first();
  return { remaining: row?.remaining || 0, starter: row?.starter || 0, boughtThisMonth: row?.bought || 0 };
}

// Takes one answer from the account's packs, in one statement, so two questions at once can't spend the same answer:
// the starter first when `starter` (the free plan's, which costs the player nothing), then the oldest top-up with any
// left. The pack ({id, kind, spent_micro}), or null when none has any left.
export async function useTopup(env, userId, { starter = false } = {}) {
  await setupBilling(env);
  return env.DB.prepare(
    "UPDATE answer_packs SET remaining = remaining - 1 WHERE id = (SELECT id FROM answer_packs WHERE user_id = ? AND " +
    "status = 'active' AND remaining > 0 AND (kind = 'topup' OR ? = 1) ORDER BY kind = 'topup', created, id LIMIT 1) " +
    "AND remaining > 0 RETURNING id, kind, spent_micro"
  ).bind(userId, starter ? 1 : 0).first();
}

// Gives back a pack's answer whose live answer failed, or never reached the model (functions/api/companion/answer.js):
// the player paid for answers, not attempts. Only while the pack is still active (a refunded one stays empty).
export async function returnTopup(env, packId) {
  await env.DB.prepare("UPDATE answer_packs SET remaining = remaining + 1 WHERE id = ? AND status = 'active' AND remaining < answers")
    .bind(packId).run();
}

// What the companion offers a player whose answers ran out today (functions/api/companion/answer.js): the next plan up
// while it's for sale, and a top-up while they can buy one this month. Nothing while nothing is for sale.
export async function offersFor(env, userId, plan, now = new Date()) {
  if (!billingOn(env)) return [];
  const offers = [];
  const next = PLANS[PAID[PAID.indexOf(plan.id) + 1]];   // the free plan isn't in PAID, so its next is Hero
  if (next && sellablePlans(env).includes(next.id))
    offers.push({ id: next.id, text: `Get ${next.name}: ${count(next.answersPerMonth)} answers a month`, url: "/plans" });
  if ((await topupFor(env, userId, now)).boughtThisMonth < TOPUP.monthMax)
    offers.push({ id: "topup", text: `Top-up: ${TOPUP.answers} answers for $${(TOPUP.price / 100).toFixed(2)}`, url: "/plans#topup" });
  return offers;
}

// ---- Checkout and the billing portal ----

// Stripe's payment page for a plan: {url}, or {error} for a plan that isn't for sale. A player who already has a plan
// gets the billing portal instead, where they can switch, so nobody ends up with two subscriptions.
export async function createCheckout(env, user, planId, interval, origin) {
  await setupBilling(env);
  if (!sellablePlans(env).includes(planId)) return { error: "That plan isn't open yet." };
  if (interval !== "month" && interval !== "year") return { error: "Pick monthly or yearly." };
  const row = await entitlement(env, user.id);
  if (paidNow(row)) return createPortal(env, user, origin);
  const price = await priceId(env, lookupKey(planId, interval));
  if (!price) throw new Error(`No Stripe price has the lookup key ${lookupKey(planId, interval)}; run scripts/stripe-setup.mjs`);
  const customer = row?.customer_id || await newCustomer(env, user);
  // A plan's checkout page left open in another tab could start a second subscription: earlier ones are closed first.
  if (row?.customer_id) await closeOpenCheckouts(env, customer);
  // Payment methods come from the Dashboard's settings (so no payment_method_types here), and tax from Managed
  // Payments when it's on (so no automatic_tax): prices include tax, and players pay exactly what's listed.
  const session = await stripe(env, "POST", "checkout/sessions", {
    mode: "subscription", customer, line_items: [{ price, quantity: 1 }], client_reference_id: user.id,
    subscription_data: { metadata: { user_id: user.id } }, allow_promotion_codes: true,
    integration_identifier: INTEGRATION_ID,
    ...(env.STRIPE_MANAGED_PAYMENTS === "1" ? { managed_payments: { enabled: true } } : {}),
    success_url: `${origin}/plans?billing=done`, cancel_url: `${origin}/plans`,
  });
  return { url: session.url };
}

// Stripe's payment page for a top-up: {url}, or {error} once the account has bought this month's TOPUP.monthMax (the
// webhook counts them again when the payment lands). Any signed-in player can buy one, on any plan.
export async function createTopup(env, user, origin, now = new Date()) {
  await setupBilling(env);
  if ((await topupFor(env, user.id, now)).boughtThisMonth >= TOPUP.monthMax)
    return { error: `You've bought this month's ${TOPUP.monthMax} top-ups. You can buy more next month.` };
  const price = await priceId(env, TOPUP.key);
  if (!price) throw new Error(`No Stripe price has the lookup key ${TOPUP.key}; run scripts/stripe-setup.mjs`);
  const customer = (await entitlement(env, user.id))?.customer_id || await newCustomer(env, user);
  // As for plans: payment methods from the Dashboard, tax from Managed Payments. metadata.kind tells the webhook it's
  // a top-up; the payment carries the account too, for Stripe's dashboard.
  const session = await stripe(env, "POST", "checkout/sessions", {
    mode: "payment", customer, line_items: [{ price, quantity: 1 }], client_reference_id: user.id,
    metadata: { kind: "topup" }, payment_intent_data: { metadata: { user_id: user.id } },
    integration_identifier: INTEGRATION_ID,
    ...(env.STRIPE_MANAGED_PAYMENTS === "1" ? { managed_payments: { enabled: true } } : {}),
    success_url: `${origin}/plans?topup=done#topup`, cancel_url: `${origin}/plans#topup`,
  });
  return { url: session.url };
}

// The account's Stripe customer, made the first time they open checkout. The idempotency key gives a double click
// (two checkouts at once) the same customer.
// Closes the customer's plan checkout pages that are still open (best effort: logged when Stripe can't be reached).
async function closeOpenCheckouts(env, customer) {
  try {
    const open = await stripe(env, "GET", "checkout/sessions", { customer, status: "open", limit: 20 });
    for (const s of open?.data || [])
      if (s.mode === "subscription") await stripe(env, "POST", `checkout/sessions/${encodeURIComponent(s.id)}/expire`);
  } catch (e) { console.warn(`billing: couldn't close earlier checkouts for ${customer}: ${e?.message || e}`); }
}

async function newCustomer(env, user) {
  const customer = await stripe(env, "POST", "customers", { email: user.email, metadata: { user_id: user.id } },
    { idempotencyKey: `customer-${user.id}` });
  await env.DB.prepare(
    "INSERT INTO entitlements (user_id, customer_id, updated) VALUES (?, ?, ?) " +
    "ON CONFLICT (user_id) DO UPDATE SET customer_id = excluded.customer_id, updated = excluded.updated"
  ).bind(user.id, customer.id, iso()).run();
  return customer.id;
}

// Stripe's billing portal (change plan, card, cancel, invoices): {url}, or {error} when there's nothing to manage.
export async function createPortal(env, user, origin) {
  await setupBilling(env);
  const row = await entitlement(env, user.id);
  if (!row?.customer_id) return { error: "There's no plan on this account to manage yet." };
  const configuration = await portalConfiguration(env);
  const session = await stripe(env, "POST", "billing_portal/sessions",
    { customer: row.customer_id, return_url: `${origin}/plans`, configuration });
  return { url: session.url };
}

// "Delete my account" (lib/accounts.js deleteUser): ends a subscription that could still charge, right away. Best
// effort: a failure is logged (cancel it by hand in Stripe's dashboard), and the account goes either way.
export async function cancelPlan(env, userId) {
  await setupBilling(env);
  const row = await entitlement(env, userId);
  if (!row?.customer_id) return;
  if (!env.STRIPE_SECRET_KEY) {
    if (row.subscription_id) console.warn(`billing: no Stripe key to cancel ${row.subscription_id} for a deleted account`);
    return;
  }
  try {
    const list = await stripe(env, "GET", "subscriptions", { customer: row.customer_id, status: "all", limit: 100 });
    for (const s of list?.data || [])
      if (!["canceled", "incomplete_expired"].includes(s.status))
        await stripe(env, "DELETE", `subscriptions/${encodeURIComponent(s.id)}`);
  } catch (e) {
    throw Object.assign(new Error(`couldn't cancel ${row.customer_id}'s plan: ${e?.message || e}`), { billing: true });
  }
}

// ---- The webhook ----

// The event, when the Stripe-Signature header ("t=<unix seconds>,v1=<hex>", more than one v1 while a secret is being
// rolled) is an HMAC-SHA256 of "<t>.<raw body>" with STRIPE_WEBHOOK_SECRET made in the last WEBHOOK_TOLERANCE
// seconds; null otherwise.
export async function verifyWebhook(env, rawBody, signatureHeader, now = new Date()) {
  // Production keeps the live webhook's secret under the name scripts/stripe-setup.mjs --live writes it as; each one
  // set is tried, so a test secret left beside it can't turn the live events away.
  const secrets = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_LIVE_WEBHOOK_SECRET].filter(s => typeof s === "string" && s);
  if (!secrets.length || typeof rawBody !== "string") return null;
  let t = "";
  const signatures = [];
  for (const part of String(signatureHeader || "").split(",")) {
    const at = part.indexOf("=");
    const k = part.slice(0, at).trim(), v = part.slice(at + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") signatures.push(v);
  }
  if (!/^\d{1,12}$/.test(t) || !signatures.length) return null;
  if (Math.abs(now.getTime() / 1000 - Number(t)) > WEBHOOK_TOLERANCE) return null;
  const signed = new TextEncoder().encode(`${t}.${rawBody}`);
  const expected = await Promise.all(secrets.map(async secret => hex(await crypto.subtle.sign("HMAC",
    await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    signed))));
  // Compared in constant time, so the answer's timing says nothing about how close a guess was.
  const same = (s, want) => {
    if (s.length !== want.length) return false;
    let diff = 0;
    for (let i = 0; i < s.length; i++) diff |= s.charCodeAt(i) ^ want.charCodeAt(i);
    return diff === 0;
  };
  if (!signatures.some(s => expected.some(want => same(s, want)))) return null;
  try {
    const event = JSON.parse(rawBody);
    return event && typeof event.id === "string" && typeof event.type === "string" ? event : null;
  } catch (e) { return null; }
}

// Applies a verified event once (a repeat of its id is skipped). Plan events fetch the subscription from Stripe and
// store what it says now, so their order doesn't matter. A checkout in payment mode is a top-up, and a refund takes
// one back. Other events are recorded and ignored. Throws when Stripe or D1 fails; the event is forgotten then, so
// Stripe's retry gets another go.
export async function applyEvent(env, event) {
  await setupBilling(env);
  const fresh = await env.DB.prepare("INSERT OR IGNORE INTO billing_events (id, type, created) VALUES (?, ?, ?)")
    .bind(event.id, event.type, iso()).run();
  if (!fresh.meta.changes) return { skipped: "seen" };
  if (!PLAN_EVENTS.includes(event.type) && !TOPUP_EVENTS.includes(event.type)) return { skipped: "recorded" };
  // A test-mode event reaching the live site (or the reverse) never credits anything.
  if (typeof event.livemode === "boolean" && event.livemode !== /^[sr]k_live_/.test(String(env.STRIPE_SECRET_KEY || "")))
    return { skipped: "other mode" };
  const object = event.data?.object || {};
  try {
    if (event.type === "charge.refunded") return await refundTopup(env, object);
    if (event.type === "charge.dispute.created") return await refundTopup(env, object, "disputed");
    if (event.type.startsWith("checkout.session.") && object.mode === "payment") return await creditTopup(env, object);
    return await applySubscription(env, event);
  } catch (e) {
    await env.DB.prepare("DELETE FROM billing_events WHERE id = ?").bind(event.id).run();
    throw e;
  }
}

async function applySubscription(env, event) {
  const object = event.data?.object || {};
  const checkout = event.type.startsWith("checkout.session.");
  // A checkout whose payment is still on its way (a bank debit, say) gives nothing yet; async_payment_succeeded follows.
  if (checkout && object.payment_status === "unpaid") return { skipped: "unpaid" };
  // An invoice names its subscription under parent since API version 2025-03-31, directly before that.
  const subscriptionId = idOf(checkout ? object.subscription : event.type.startsWith("invoice.")
    ? object.parent?.subscription_details?.subscription ?? object.subscription : object.id);
  if (!subscriptionId) return { skipped: "no subscription" };
  const subscription = await stripe(env, "GET", `subscriptions/${encodeURIComponent(subscriptionId)}`);
  const userId = await userFor(env, idOf(subscription.customer) || idOf(object.customer),
    checkout ? object.client_reference_id : null, subscription.metadata?.user_id);
  if (!userId) return { skipped: "no account" };
  return storeSubscription(env, userId, subscription);
}

// The account a subscription is for, through Stripe's own objects first: the customer we made for the account, then a
// checkout's client_reference_id, and only then the user id we put in the subscription's metadata. null for an
// account that's gone.
async function userFor(env, customerId, ...claimed) {
  if (customerId) {
    const row = await env.DB.prepare("SELECT user_id FROM entitlements WHERE customer_id = ?").bind(customerId).first();
    if (row) return row.user_id;
  }
  for (const id of claimed) {
    if (typeof id !== "string" || !id) continue;
    const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
    if (user) return user.id;
  }
  return null;
}

async function storeSubscription(env, userId, subscription) {
  const item = subscription.items?.data?.[0];
  const key = String(item?.price?.lookup_key || "");
  // By the price's lookup key, or, for an older price whose key moved to a newer one (scripts/stripe-setup.mjs), by
  // its product (lore_forever_<plan>).
  const byKey = key.replace(/_(monthly|yearly)$/, "");
  const planId = PAID.includes(byKey) ? byKey : String(idOf(item?.price?.product) || "").replace(/^lore_forever_/, "");
  const status = String(subscription.status || "");
  // Deleted, cancelled, unpaid and the like are the free plan; the row keeps its status for /admin.
  const plan = ACTIVE.includes(status) && PAID.includes(planId) ? planId : "free";
  const interval = item?.price?.recurring?.interval || (key.endsWith("_yearly") ? "year" : key.endsWith("_monthly") ? "month" : null);
  // Since API version 2025-03-31 the period is on the subscription's item; older versions have it on the subscription.
  const end = item?.current_period_end ?? subscription.current_period_end;
  const row = await entitlement(env, userId);
  // An old subscription's late news (it was cancelled, say) never replaces a newer one that's still paid.
  if (plan === "free" && row?.subscription_id && row.subscription_id !== subscription.id && paidNow(row))
    return { skipped: "older subscription" };
  await env.DB.prepare(
    "INSERT INTO entitlements (user_id, customer_id, subscription_id, plan, interval, status, current_period_end, " +
    "cancel_at_period_end, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET " +
    "customer_id = COALESCE(excluded.customer_id, entitlements.customer_id), subscription_id = excluded.subscription_id, " +
    "plan = excluded.plan, interval = excluded.interval, status = excluded.status, " +
    "current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end, " +
    "updated = excluded.updated"
  ).bind(userId, idOf(subscription.customer), subscription.id, plan, interval, status,
         Number.isFinite(end) ? iso(end * 1000) : null, subscription.cancel_at_period_end || subscription.cancel_at ? 1 : 0,
         iso()).run();
  return { user: userId, plan, status };
}

// A paid top-up checkout (completed, or its delayed payment succeeded): one pack for the account, keyed by the session's
// id, so its events together credit it once. What's credited is what Stripe says about the session now, as for plans,
// not what the event carried. A purchase past the month's TOPUP.monthMax (two checkouts opened at once) was paid for,
// so it still credits, and is logged.
async function creditTopup(env, sent) {
  if (sent.metadata?.kind !== "topup" || typeof sent.id !== "string") return { skipped: "not a top-up" };
  const session = await stripe(env, "GET", `checkout/sessions/${encodeURIComponent(sent.id)}`);
  if (session.mode !== "payment" || session.metadata?.kind !== "topup") return { skipped: "not a top-up" };
  if (session.payment_status !== "paid") return { skipped: "unpaid" };
  const userId = await userFor(env, idOf(session.customer), session.client_reference_id);
  if (!userId) return { skipped: "no account" };
  const { boughtThisMonth } = await topupFor(env, userId);
  const made = await env.DB.prepare(
    "INSERT OR IGNORE INTO answer_packs (id, user_id, answers, remaining, payment_intent, created) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(session.id, userId, TOPUP.answers, TOPUP.answers, idOf(session.payment_intent), iso()).run();
  if (!made.meta.changes) return { skipped: "credited" };
  if (boughtThisMonth >= TOPUP.monthMax)
    console.warn(`billing: top-up ${session.id} is number ${boughtThisMonth + 1} this month for ${userId}; credited anyway`);
  return { user: userId, topup: TOPUP.answers };
}

// A refunded top-up payment (Stripe sends charge.refunded for a partial refund too), or a disputed one (a chargeback:
// charge.dispute.created, with status "disputed"; security review L5): the pack's answers left go, and it's marked
// so. A refund or dispute of a plan's payment matches no pack, and a starter, never bought, is never touched. A
// disputed pack still counts as one of the month's top-ups (topupFor).
async function refundTopup(env, charge, status = "refunded") {
  const paymentIntent = idOf(charge.payment_intent);
  if (!paymentIntent) return { skipped: "no payment" };
  const res = await env.DB.prepare(
    "UPDATE answer_packs SET remaining = 0, status = ? WHERE payment_intent = ? AND kind = 'topup'"
  ).bind(status, paymentIntent).run();
  return res.meta.changes ? { [status]: paymentIntent } : { skipped: "not a top-up" };
}

// ---- /admin ----

// For the Plans tile: accounts by plan and status, paying players, what they bring in a month (active subscriptions,
// a yearly one as a twelfth, before Stripe's fees) and what paying players' live answers cost this month; and top-ups:
// sold this month, answers bought and still unused, and what top-up answers cost this month.
export async function billingReport(env, now = new Date()) {
  await setupBilling(env);
  const [{ results }, spend, packs] = await Promise.all([
    env.DB.prepare("SELECT plan, status, interval, current_period_end FROM entitlements WHERE subscription_id IS NOT NULL").all(),
    env.DB.prepare("SELECT COALESCE(SUM(micro > topup_micro), 0) AS players, COALESCE(SUM(micro - topup_micro), 0) AS micro, " +
                   "COALESCE(SUM(calls), 0) AS calls, COALESCE(SUM(topup_micro), 0) AS topup_micro " +
                   "FROM answer_user_spend WHERE month = ?").bind(month(now)).first(),
    env.DB.prepare("SELECT COALESCE(SUM(substr(created, 1, 7) = ?), 0) AS sold, " +
                   "COALESCE(SUM(CASE WHEN status = 'active' THEN remaining ELSE 0 END), 0) AS unused FROM answer_packs " +
                   "WHERE kind = 'topup'").bind(month(now)).first(),
  ]);
  const counts = {};
  let paying = 0, cents = 0;
  for (const r of results) {
    const k = `${r.plan}:${r.status}`;
    counts[k] = { plan: r.plan, status: r.status, n: (counts[k]?.n || 0) + 1 };
    if (!paidNow(r, now)) continue;
    paying++;
    if (r.status === "active") cents += r.interval === "year" ? PLANS[r.plan].yearly / 12 : PLANS[r.plan].monthly;
  }
  return { on: billingOn(env), paying, counts: Object.values(counts), monthlyUsd: Math.round(cents) / 100,
           spend: { usd: (spend?.micro || 0) / 1e6, players: spend?.players || 0, calls: spend?.calls || 0 },
           topups: { sold: packs?.sold || 0, unused: packs?.unused || 0, usd: (spend?.topup_micro || 0) / 1e6 } };
}
