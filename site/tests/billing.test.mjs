// Plans (lib/billing.js, functions/api/billing/[action].js): Stripe's webhook signatures, subscriptions becoming plans,
// how many live answers each plan gets a day and what kind, the free plan's starter, checkout, a paying player's cost
// cap, finest-voice packs credited once and taken back by a refund, and what's said and offered when answers run out.
// Stripe and Gemini are mocked through fetch; D1 is node:sqlite (helpers.mjs).
// Run: node --test 'site/tests/*.test.mjs'

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { onRequest as billing } from "../functions/api/billing/[action].js";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { findOrCreateUser, startSession, setup, deleteUser } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { setupBilling, planFor, companionFeatures, INTEGRATION_ID, PLANS, TASTE_ANSWERS } from "../lib/billing.js";
import { allowance, ANSWER_MODEL, LITE_MODEL, RESEARCH_MODEL, SMART_MODEL } from "../lib/companion-answers.js";
import { optOut } from "../lib/email.js";
import { setupWilloCustom } from "../lib/willo-custom.js";
import { TRIAL, trialView } from "../lib/best-first.js";

import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const NOW = Date.parse("2026-10-11T12:00:00Z");
const env = { DB: d1(), GEMINI_API_KEY: "test-key", STRIPE_SECRET_KEY: "sk_test_123", STRIPE_WEBHOOK_SECRET: "whsec_test",
              SITE_FEATURES: "plans" };
const originalFetch = globalThis.fetch;
let stripeCalls, gemini, subscriptions, checkoutSessions, charges, invoices;

beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  await setup(env);
  await setupBilling(env);
  for (const table of ["users", "sessions", "devices", "device_links", "rate_limits", "answer_spend", "story_spend",
                       "entitlements", "billing_events", "answer_user_spend", "answer_packs", "answer_holds",
                       "starter_claims", "best_first", "best_first_days", "email_sends", "email_optouts"])
    env.DB.sqlite.exec(`DELETE FROM ${table}`);
  stripeCalls = [];
  gemini = [];
  subscriptions = {};
  checkoutSessions = {};
  charges = {};
  invoices = {};
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    if (u.hostname === "generativelanguage.googleapis.com") {
      const body = JSON.parse(options.body);
      gemini.push({ url: String(url), body });
      // Chat memory asks for JSON with a summary; everything else gets the same answer.
      const text = body.generationConfig?.responseSchema ? JSON.stringify({ summary: "They asked about spices." })
        : "Mild Spices are sold in Goldshire.";
      return Response.json({ candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40 } });
    }
    const call = { method: options.method, path: u.pathname.replace("/v1/", ""), headers: options.headers,
                   body: new URLSearchParams(options.body || "") };
    stripeCalls.push(call);
    const route = `${call.method} ${call.path}`;
    if (route === "GET prices") return Response.json({ data: [
      { id: "price_hero_m", lookup_key: "hero_monthly" }, { id: "price_hero_y", lookup_key: "hero_yearly" }] });
    if (route === "POST customers") return Response.json({ id: "cus_1" });
    if (route === "POST checkout/sessions") return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    if (route === "GET checkout/sessions") return Response.json({ data: [] });
    // A payment's charge, as creditPack reads it: refunded or disputed when a test says so.
    if (call.method === "GET" && call.path.startsWith("payment_intents/"))
      return Response.json({ id: call.path.slice(16), latest_charge: charges[call.path.slice(16)] ||
        { refunded: false, amount_refunded: 0, disputed: false } });
    // A plan's payment has its invoice (invoices, by payment intent); a pack's has none, so a refund or dispute of it
    // is no plan's (endPlanFor).
    if (route === "GET invoice_payments") {
      const pi = u.searchParams.get("payment[payment_intent]");
      const invoice = Object.values(invoices).find(i => i.pi === pi);
      return Response.json({ data: invoice ? [{ invoice: invoice.id, status: "paid", payment: { type: "payment_intent", payment_intent: pi } }] : [] });
    }
    if (call.method === "GET" && invoices[call.path.replace("invoices/", "")])
      return Response.json(invoices[call.path.replace("invoices/", "")]);
    if (call.method === "GET" && call.path.startsWith("checkout/sessions/") && checkoutSessions[call.path.slice(18)])
      return Response.json(checkoutSessions[call.path.slice(18)]);
    if (route === "GET subscriptions") return Response.json({ data: Object.values(subscriptions)
      .filter(s => s.customer === u.searchParams.get("customer")) });
    if (call.method === "DELETE" && subscriptions[call.path.replace("subscriptions/", "")]) {
      const s = subscriptions[call.path.replace("subscriptions/", "")];
      s.status = "canceled";
      return Response.json(s);
    }
    if (call.method === "GET" && subscriptions[call.path.replace("subscriptions/", "")])
      return Response.json(subscriptions[call.path.replace("subscriptions/", "")]);
    return Response.json({ error: { message: `No such route: ${route}` } }, { status: 404 });
  };
});
afterEach((t) => { globalThis.fetch = originalFetch; t.mock.timers.reset(); });

// A subscription as GET /v1/subscriptions/<id> returns it (API version 2025-03-31: the period is on the item).
const subscription = (id, userId, { status = "active", key = "hero_monthly", endDays = 30 } = {}) => ({
  id, object: "subscription", customer: "cus_1", status, cancel_at_period_end: false, metadata: { user_id: userId },
  items: { data: [{ current_period_end: NOW / 1000 + endDays * 86400,
                    price: { id: "price_hero_m", lookup_key: key, recurring: { interval: "month" } } }] },
});

// Stripe's signature scheme, made independently of lib/billing.js: HMAC-SHA256 of "<t>.<body>" with the secret.
const sign = (body, t = Math.floor(NOW / 1000), secret = env.STRIPE_WEBHOOK_SECRET) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

async function hook(event, { body = JSON.stringify(event), signature = sign(body) } = {}) {
  const request = new Request(ORIGIN + "/api/billing/webhook", { method: "POST",
    headers: { "Stripe-Signature": signature, "Content-Type": "application/json" }, body });
  const res = await billing({ request, env, params: { action: "webhook" } });
  return { status: res.status, body: await res.json() };
}

async function post(action, body, { cookie, origin = ORIGIN } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  const request = new Request(`${ORIGIN}/api/billing/${action}`, { method: "POST", headers, body: JSON.stringify(body) });
  const res = await billing({ request, env, params: { action } });
  return { status: res.status, body: await res.json() };
}

const player = sub => findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });

// An account whose first companion connected `days` ago.
async function linkedDaysAgo(sub, days) {
  const user = await player(sub);
  await env.DB.prepare("INSERT INTO devices (id, token_hash, user_id, label, created) VALUES (?, ?, ?, 'companion', ?)")
    .bind(`device-${sub}`, `hash-${sub}`, user.id, new Date(NOW - days * 86400e3).toISOString()).run();
  return user;
}

const entitle = (user, plan, status, endDays) => env.DB.prepare(
  "INSERT OR REPLACE INTO entitlements (user_id, subscription_id, plan, status, current_period_end, updated) VALUES (?, ?, ?, ?, ?, ?)"
).bind(user.id, `sub-${user.id}`, plan, status, new Date(NOW + endDays * 86400e3).toISOString(), new Date(NOW).toISOString()).run();

// The account's first answers at Willo's best (lib/best-first.js) already had: `used` of them, the first `daysAgo`
// (null: its first-run trial's days not started yet; past TRIAL_DAYS: over).
const tasted = (user, used = TASTE_ANSWERS, daysAgo = null) => env.DB.prepare("INSERT OR REPLACE INTO best_first (claim, user_id, " +
  "used, started) VALUES (?, ?, ?, ?)").bind(`taste:test-${user.id}`, user.id, used,
  daysAgo === null ? null : new Date(NOW - daysAgo * 86400e3).toISOString()).run();

const daily = async user => {
  const a = await allowance(env, user.id);
  return [a.plan.id, a.limit];
};

test("with the plans feature off, nothing is for sale and everyone keeps 20 answers a day, even with Stripe keys", async () => {
  const hero = await linkedDaysAgo("hero", 2);
  await entitle(hero, "hero", "active", 20);
  delete env.SITE_FEATURES;   // lib/features.js: plans is off unless SITE_FEATURES turns it on
  try {
    assert.deepEqual(await daily(hero), ["free", 20], "a stored subscription waits for the switch");
    const a = await allowance(env, hero.id);
    assert.deepEqual([a.remaining, a.upgrade, a.features], [20, undefined, undefined],
      "no starter, no upgrade link and no features for the companion");
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_packs").get().n, 0, "no starter is credited");
    const plans = await billing({ env, params: { action: "plans" }, request: new Request(ORIGIN + "/api/billing/plans") });
    assert.deepEqual(await plans.json(), { ok: true, on: false });
    assert.equal((await post("checkout", { plan: "hero", interval: "month" })).status, 503);
    assert.equal(stripeCalls.length, 0);
  } finally { env.SITE_FEATURES = "plans"; }
});

test("webhooks need Stripe's signature over the exact body, made in the last five minutes", async () => {
  const event = { id: "evt_paid", type: "invoice.paid", data: { object: {} } };
  const body = JSON.stringify(event);
  assert.deepEqual(await hook(event), { status: 200, body: { received: true } });
  assert.equal((await hook(event, { body: body.replace("invoice.paid", "invoice.voided"), signature: sign(body) })).status, 400,
    "a changed body");
  assert.equal((await hook(event, { signature: sign(body, Math.floor(NOW / 1000) - 301) })).status, 400, "a stale timestamp");
  assert.equal((await hook(event, { signature: sign(body, undefined, "whsec_other") })).status, 400, "another secret");
  assert.equal((await hook(event, { signature: "" })).status, 400);
  const rolling = `${sign(body, undefined, "whsec_old")},v1=${sign(body).split("v1=")[1]}`;
  assert.equal((await hook(event, { signature: rolling })).status, 200, "one good v1 among several, while a secret rolls");
  const testSecret = env.STRIPE_WEBHOOK_SECRET;
  [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_LIVE_WEBHOOK_SECRET] = [undefined, "whsec_live"];
  try {
    assert.equal((await hook(event, { signature: sign(body, undefined, "whsec_live") })).status, 200,
      "Production's live secret, kept under the name stripe-setup --live gives it");
  } finally { [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_LIVE_WEBHOOK_SECRET] = [testSecret, undefined]; }
  assert.equal(stripeCalls.length, 0);
});

test("a paid checkout makes the account Hero, deletion makes it free, and a replayed event changes nothing", async () => {
  const user = await player("aelric");
  subscriptions.sub_1 = subscription("sub_1", user.id);
  const checkout = (id, type, paymentStatus) => ({ id, type, data: { object: { id: "cs_1", object: "checkout.session",
    customer: "cus_1", client_reference_id: user.id, subscription: "sub_1", payment_status: paymentStatus } } });
  assert.equal((await hook(checkout("evt_1", "checkout.session.completed", "unpaid"))).status, 200);
  assert.equal((await planFor(env, user.id)).id, "free", "a payment still on its way gives nothing yet");
  const paid = checkout("evt_2", "checkout.session.async_payment_succeeded", "paid");
  assert.equal((await hook(paid)).status, 200);
  const hero = await planFor(env, user.id);
  assert.deepEqual([hero.id, hero.name, hero.answersPerDay, hero.status], ["hero", "Hero", 100, "active"]);
  assert.equal(hero.renews, new Date(NOW + 30 * 86400e3).toISOString());

  // No metadata this time: the stored Stripe customer finds the account.
  subscriptions.sub_1 = subscription("sub_1", null, { status: "canceled" });
  const deleted = { id: "evt_3", type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1" } } };
  assert.equal((await hook(deleted)).status, 200);
  assert.equal((await planFor(env, user.id)).id, "free");

  const fetched = stripeCalls.length;
  subscriptions.sub_1 = subscription("sub_1", user.id);   // applied again, it would read an active subscription
  assert.equal((await hook(paid)).status, 200);
  assert.equal(stripeCalls.length, fetched, "a replayed event isn't applied again");
  assert.equal((await planFor(env, user.id)).id, "free");
});

test("a new subscriber gets one thank-you email: never twice for retries or a checkout's several events, never on a renewal or a plan change", async () => {
  const thanks = id => env.DB.sqlite.prepare("SELECT status FROM email_sends WHERE id = ?").get(`thanks:${id}`)?.status;
  const started = (id, user, customer, daysAgo, key) =>
    (subscriptions[id] = { ...subscription(id, user.id, { key }), customer, start_date: NOW / 1000 - daysAgo * 86400 });
  const event = (id, type, object) => ({ id, type, data: { object } });
  const created = (id, sub) => event(id, "customer.subscription.created", { id: sub });

  // Cloudflare's email REST API, as Production sends: the first send fails, the rest go through.
  const sent = [];
  const stripeFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (new URL(url).hostname !== "api.cloudflare.com") return stripeFetch(url, options);
    sent.push({ url: String(url), auth: options.headers.Authorization, body: JSON.parse(options.body) });
    return sent.length === 1 ? Response.json({ success: false, errors: [{ code: 10001, message: "overloaded" }] }, { status: 500 })
      : Response.json({ success: true, errors: [], result: { delivered: [], permanent_bounces: [], queued: ["x"] } });
  };
  Object.assign(env, { CLOUDFLARE_EMAIL_TOKEN: "cf-test-token", CLOUDFLARE_ACCOUNT_ID: "acct1" });
  try {
    // With the "thanks" feature switched off, a start is only noted as "would send", never sent.
    env.SITE_FEATURES = "plans,-thanks";
    const early = await player("early");
    started("sub_early", early, "cus_early", 0);
    assert.equal((await hook(created("evt_early", "sub_early"))).status, 200);
    assert.deepEqual([thanks(early.id), sent.length], ["off", 0]);
    // From here on, Production's settings: SITE_FEATURES "plans", and "thanks" on by default (lib/features.js).
    env.SITE_FEATURES = "plans";

    const user = await player("aelric");
    started("sub_new", user, "cus_new", 0);
    // The first try fails at the email service: the plan is stored anyway, and the next event tries again.
    assert.equal((await hook(created("evt_new_1", "sub_new"))).status, 200);
    assert.equal((await planFor(env, user.id)).id, "hero");
    assert.equal(thanks(user.id), undefined);
    // A checkout's other events arrive together: one email between them.
    const checkout = event("evt_new_2", "checkout.session.completed", { id: "cs_new", object: "checkout.session",
      mode: "subscription", customer: "cus_new", client_reference_id: user.id, subscription: "sub_new", payment_status: "paid" });
    const paid = event("evt_new_3", "invoice.paid", { customer: "cus_new", parent: { subscription_details: { subscription: "sub_new" } } });
    assert.deepEqual((await Promise.all([hook(checkout), hook(paid)])).map(r => r.status), [200, 200]);
    assert.equal(sent.length, 2);
    const { url, auth, body } = sent[1];
    assert.deepEqual([url, auth], ["https://api.cloudflare.com/client/v4/accounts/acct1/email/sending/send",
      "Bearer cf-test-token"]);
    // From and Reply-To are the site's own inbox (DMARC p=reject: only @loreforeverwow.com), Reply-To as its own field.
    assert.deepEqual([body.to, body.from, body.reply_to, body.subject, body.headers],
      [["aelric@example.com"], { address: "hello@loreforeverwow.com", name: "Mike from Lore Forever" },
       "hello@loreforeverwow.com", "Thanks for picking up Hero!",
       { "List-Unsubscribe": "<https://loreforeverwow.com/unsubscribe>" }]);
    assert.match(body.text, /^Hey aelric!/);
    assert.equal(thanks(user.id), "sent");
    // An event applied again (Stripe retries one the site failed), and a plan change, send nothing more.
    assert.equal((await hook({ ...paid, id: "evt_new_5" })).status, 200);
    started("sub_new", user, "cus_new", 0, "champion_monthly");
    assert.equal((await hook(event("evt_new_4", "customer.subscription.updated", { id: "sub_new" }))).status, 200);
    assert.equal((await planFor(env, user.id)).id, "champion");

    // A subscriber from before the email: their renewal isn't a start.
    const old = await player("veteran");
    started("sub_old", old, "cus_old", 40);
    assert.equal((await hook(event("evt_old", "invoice.paid", { customer: "cus_old",
      parent: { subscription_details: { subscription: "sub_old" } } }))).status, 200);
    assert.equal((await planFor(env, old.id)).id, "hero");
    assert.equal(thanks(old.id), undefined);

    // An address that unsubscribed gets nothing.
    const quiet = await player("quiet");
    await optOut(env, "Quiet@Example.com");
    started("sub_quiet", quiet, "cus_quiet", 0);
    assert.equal((await hook(created("evt_quiet", "sub_quiet"))).status, 200);
    assert.equal(thanks(quiet.id), "opted_out");
    assert.equal(sent.length, 2);
  } finally {
    delete env.CLOUDFLARE_EMAIL_TOKEN;
    delete env.CLOUDFLARE_ACCOUNT_ID;
    env.SITE_FEATURES = "plans";
    globalThis.fetch = stripeFetch;
  }
});

test("a whole refund of the current period's payment ends the plan; an older month's or an upgrade's is goodwill", async () => {
  const user = await player("refunded");
  const start = NOW / 1000 - 10 * 86400, end = NOW / 1000 + 20 * 86400, month = 30 * 86400;
  subscriptions.sub_r = { ...subscription("sub_r", user.id), items: { data: [{ id: "si_r", current_period_start: start,
    current_period_end: end, price: { id: "price_hero_m", lookup_key: "hero_monthly", recurring: { interval: "month" } } }] } };
  const event = (id, type, object) => ({ id, type, data: { object } });
  assert.equal((await hook(event("evt_sub_r", "customer.subscription.updated", { id: "sub_r", customer: "cus_1" }))).status, 200);
  // Its invoices, by the payment that paid each (Stripe's lines carry the period they're for).
  const invoice = (id, reason, periodStart) => (invoices[id] = { id, pi: `pi_${id}`, billing_reason: reason,
    parent: { subscription_details: { subscription: "sub_r" } }, lines: { data: [{ period: { start: periodStart, end: periodStart + month } }] } });
  invoice("in_last_month", "subscription_cycle", start - month);
  invoice("in_upgrade", "subscription_update", start + 5 * 86400);
  invoice("in_this_month", "subscription_cycle", start);
  const refund = (id, refunded = true) => hook(event(`evt_refund_${id}_${refunded}`, "charge.refunded",
    { id: `ch_${id}`, object: "charge", payment_intent: `pi_${id}`, refunded }));
  for (const id of ["in_last_month", "in_upgrade"]) {
    assert.equal((await refund(id)).status, 200);
    assert.equal((await planFor(env, user.id)).id, "hero", `${id}: goodwill, the plan stays`);
  }
  assert.equal((await refund("in_this_month", false)).status, 200);
  assert.equal((await planFor(env, user.id)).id, "hero", "part of this month's payment: the plan stays");
  assert.equal(stripeCalls.filter(c => c.method === "DELETE").length, 0);
  assert.equal((await hook(event("evt_refund_whole", "charge.refunded",
    { id: "ch_whole", object: "charge", payment_intent: "pi_in_this_month", refunded: true }))).status, 200);
  assert.deepEqual(stripeCalls.filter(c => c.method === "DELETE").map(c => c.path), ["subscriptions/sub_r"]);
  assert.equal((await planFor(env, user.id)).id, "free", "the whole of this month's payment: the plan ends now");
});

test("daily answers: free, Hero while active or past due, Champion, an ended period, and the brake", async () => {
  const free = await linkedDaysAgo("free", 30), hero = await linkedDaysAgo("hero", 30), champion = await linkedDaysAgo("champ", 3);
  assert.deepEqual(await daily(free), ["free", 30]);
  await entitle(hero, "hero", "active", 20);
  assert.deepEqual(await daily(hero), ["hero", 100]);
  await entitle(hero, "hero", "past_due", 20);
  assert.deepEqual(await daily(hero), ["hero", 100], "a failed payment keeps the plan while Stripe retries");
  await entitle(champion, "champion", "active", 20);
  assert.deepEqual(await daily(champion), ["champion", 200]);
  // The month's pool rides along, as plans are sold ("3,000 answers a month"): Mike's QA, 10/15; pools set 10/19.
  const month = (await allowance(env, champion.id)).month;
  assert.deepEqual([month.limit, month.remaining], [3000, 3000]);
  await entitle(hero, "hero", "active", -1);
  assert.deepEqual(await daily(hero), ["free", 30], "a period that ended is the free plan");

  await entitle(hero, "hero", "active", 20);
  await env.DB.prepare("INSERT INTO story_spend (month, micro_usd) VALUES ('2026-10', 80000001)").run();
  assert.deepEqual(await daily(free), ["free", 5], "past $80 of free spend");
  assert.deepEqual(await daily(hero), ["hero", 100], "paying players are unaffected");
  assert.equal((await allowance(env, free.id)).upgrade, "/plans");
});

test("the allowance tells the companion what each plan may do", async () => {
  const free = await linkedDaysAgo("free", 3), hero = await linkedDaysAgo("hero", 3), champion = await linkedDaysAgo("champ", 3);
  await entitle(hero, "hero", "active", 20);
  await entitle(champion, "champion", "active", 20);
  const trying = { voices: "all", push_to_talk: true, sight: true, npc_voices: false, research: true, reminders: true };
  assert.deepEqual((await allowance(env, free.id)).features, trying,
    "its first answers at Willo's best and its first-run trial (lib/best-first.js): asked out loud, seeing the game, " +
    "looking online, her voices on the PC, goals and reminders");
  await tasted(free, TASTE_ANSWERS, 3);
  assert.deepEqual((await allowance(env, free.id)).features, trying, "the trial's days go on after the 20");
  await env.DB.prepare("UPDATE best_first SET lookups = ?, tries = ? WHERE user_id = ?")
    .bind(TRIAL.lookups, JSON.stringify({ sight: TRIAL.sight }), free.id).run();
  assert.deepEqual((await allowance(env, free.id)).features, { ...trying, sight: false, research: false },
    "its look-ups and pictures used");
  await tasted(free, TASTE_ANSWERS, 15);
  assert.deepEqual((await allowance(env, free.id)).features,
    { voices: "default", push_to_talk: true, sight: false, npc_voices: false, research: false, reminders: false },
    "the trial's days over: asking out loud gets an answer aloud in Willo's default voice (site/tests/companion-voice.test.mjs)");
  // Option D (10/19): the free plan's studio voice is on every spoken answer, not a counted starter, so none left changes
  // nothing. (companionFeatures reads PLAN_VOICE.free itself, so the old text-only ending can't be given a plan here.)
  assert.deepEqual(companionFeatures(PLANS.free, { starter: 0 }),
    { voices: "default", push_to_talk: true, sight: false, npc_voices: false, research: false, reminders: false },
    "no starter count any more: always asking out loud, always her default voice");
  for (const user of [hero, champion]) {
    assert.deepEqual((await allowance(env, user.id)).features,
      { voices: "all", push_to_talk: true, sight: true, npc_voices: true, research: true, reminders: true });
  }
});

test("what paying players' answers cost never uses up the free players' budget", async () => {
  const free = await linkedDaysAgo("free", 30);
  // $90 of this month's answers so far, all of them paying players'.
  env.DB.sqlite.exec("INSERT INTO answer_spend (month, reserved_micro, actual_micro, calls) VALUES ('2026-10', 90000000, 90000000, 9000)");
  env.DB.sqlite.exec("INSERT INTO answer_user_spend (user_id, month, micro, calls) VALUES ('someone', '2026-10', 90000000, 9000)");
  const a = await allowance(env, free.id);
  assert.deepEqual([a.limit, a.available], [30, true], "no brake, and the shared budget is still open");
  // The same spend by free players: the brake is on and the budget is nearly gone.
  env.DB.sqlite.exec("DELETE FROM answer_user_spend");
  env.STORY_BUDGET_USD = "90";
  try {
    const b = await allowance(env, free.id);
    assert.deepEqual([b.limit, b.available], [5, false]);
  } finally { delete env.STORY_BUDGET_USD; }
});

test("checkout needs a signed-in player, refuses a plan that isn't for sale, and sends the account and the looked-up price", async () => {
  assert.equal((await post("checkout", { plan: "hero", interval: "month" })).status, 401);
  const user = await player("buyer");
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  assert.equal((await post("checkout", { plan: "hero", interval: "month" }, { cookie, origin: "https://elsewhere.example" })).status, 403);
  env.BILLING_PLANS = "hero,champion";
  try {
    assert.equal((await post("checkout", { plan: "legend", interval: "month" }, { cookie })).status, 400);
  } finally { delete env.BILLING_PLANS; }
  assert.equal(stripeCalls.length, 0, "nothing reaches Stripe for a plan that isn't for sale");

  // Plans are monthly (Mike, 2026-10-13): a yearly one is refused before Stripe hears of it.
  assert.deepEqual(await post("checkout", { plan: "hero", interval: "year" }, { cookie }),
    { status: 400, body: { ok: false, error: "Plans are monthly." } });
  assert.equal(stripeCalls.length, 0);
  const res = await post("checkout", { plan: "hero", source: "willo-empty" }, { cookie });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.url, "https://checkout.stripe.com/c/pay/cs_test_1");
  const session = stripeCalls.find(c => c.path === "checkout/sessions");
  assert.equal(session.headers.Authorization, "Bearer sk_test_123");
  assert.equal(session.body.get("mode"), "subscription");
  assert.equal(session.body.get("client_reference_id"), user.id);
  assert.equal(session.body.get("subscription_data[metadata][user_id]"), user.id);
  assert.equal(session.body.get("subscription_data[metadata][source]"), "willo-empty",
    "where the checkout started, for pricing (plan_log source)");
  assert.equal(session.body.get("line_items[0][price]"), "price_hero_m");
  assert.equal(session.body.get("customer"), "cus_1");
  assert.equal(session.body.get("integration_identifier"), INTEGRATION_ID);
  assert.equal(session.body.get("consent_collection[terms_of_service]"), "required",
    "the Terms, which say that starting now ends the EU/UK 14-day withdrawal right as far as the law allows");
  // Before the Dashboard has a Terms of service URL, Stripe refuses the box: checkout still opens, without it.
  const working = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => new URLSearchParams(options.body || "").has("consent_collection[terms_of_service]")
    ? Response.json({ error: { message: "You cannot collect consent to your terms of service unless a URL is set in the Stripe Dashboard." } }, { status: 400 })
    : working(url, options);
  try {
    const without = await post("checkout", { plan: "hero" }, { cookie });
    assert.equal(without.status, 200, JSON.stringify(without.body));
    assert.equal(stripeCalls.filter(c => c.path === "checkout/sessions").pop().body.get("consent_collection[terms_of_service]"), null);
  } finally { globalThis.fetch = working; }
  assert.ok(![...session.body.keys()].some(k => /^(payment_method_types|automatic_tax|managed_payments)/.test(k)),
    "payment methods come from the Dashboard; tax waits for Managed Payments");
  assert.equal(env.DB.sqlite.prepare("SELECT customer_id FROM entitlements WHERE user_id = ?").get(user.id).customer_id, "cus_1");

  env.STRIPE_MANAGED_PAYMENTS = "1";
  try {
    assert.equal((await post("checkout", { plan: "hero", interval: "month" }, { cookie })).status, 200);
    const managed = stripeCalls.filter(c => c.path === "checkout/sessions").pop();
    assert.equal(managed.body.get("managed_payments[enabled]"), "true");
    assert.equal(managed.body.get("line_items[0][price]"), "price_hero_m");
    assert.equal(stripeCalls.filter(c => c.path === "customers").length, 1, "the account keeps its Stripe customer");
  } finally { delete env.STRIPE_MANAGED_PAYMENTS; }
});

test("a paying player skips the shared budget; past half their plan's net a month answers step down to Flash-Lite, past all of it the lore library", async () => {
  const user = await player("hero");
  const link = await startLink(env);
  assert.equal(await decideLink(env, link.user_code, user, true), true);
  const { token } = await claimToken(env, link.device_code);
  await entitle(user, "hero", "active", 20);
  const ask = async () => {
    const res = await answer({ env, request: new Request(ORIGIN + "/api/companion/answer", { method: "POST",
      headers: { "X-LF-Client": "companion/0.1.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "QUESTION\nWhere can I buy Simple Flour?", research_required: true }) }) });
    return { status: res.status, body: await res.json() };
  };
  env.STORY_BUDGET_USD = "0";   // the shared budget is spent: a free player would get a 429 now
  try {
    assert.equal((await ask()).status, 200);
    assert.deepEqual(gemini[0].body.tools, [{ googleSearch: {} }], "under the cap, research searches the web");
    const spent = env.DB.sqlite.prepare("SELECT micro, calls FROM answer_user_spend WHERE user_id = ?").get(user.id);
    assert.equal(spent.calls, 1);
    assert.ok(spent.micro > 0);

    // Hero's net is $4.37: its answers may cost $2.18 a month on her own model. Past that they go on, on Flash-Lite and
    // without looking online (the step-down, 10/19), rather than to the lore library earlier than before.
    env.DB.sqlite.prepare("UPDATE answer_user_spend SET micro = 2180000 WHERE user_id = ?").run(user.id);
    const lite = await ask();
    assert.equal(lite.status, 200);
    assert.equal(lite.body.model, LITE_MODEL);
    assert.match(gemini[1].url, new RegExp(`${LITE_MODEL}:generateContent$`));
    assert.equal(gemini[1].body.tools, undefined, "past the text cap, no looking online");
    // Once its answers and hosted voice have cost the whole net, none of the plan's until November, with Willo's words
    // that only say when (the companion starts its lore-library answer with them), and nothing offered.
    env.DB.sqlite.prepare("UPDATE answer_user_spend SET micro = 4370000, voice_micro = 1000000 WHERE user_id = ?").run(user.id);
    const capped = await ask();
    assert.equal(capped.status, 429);
    assert.equal(capped.body.error, "My light's spent for this month. The Moonwell refills it on November 1.");
    assert.equal(capped.body.offers, undefined);
    assert.deepEqual([capped.body.allowance.remaining, capped.body.allowance.period, capped.body.allowance.resetsAt],
      [0, "month", "2026-11-01T00:00:00.000Z"]);
    assert.equal(capped.body.allowance.fair_use, undefined);
    assert.equal(gemini.length, 2, "nothing reached the model");
    // A hosted voice's cost counts toward the whole net, not the text cap: under both, answers go on as usual.
    env.DB.sqlite.prepare("UPDATE answer_user_spend SET micro = 4000000, voice_micro = 2000000 WHERE user_id = ?").run(user.id);
    assert.equal((await ask()).status, 200);
    assert.deepEqual(gemini[2].body.tools, [{ googleSearch: {} }]);
  } finally { delete env.STORY_BUDGET_USD; }
});

test("research questions sent all at once by a player just under the cost cap: only one looks online", async () => {
  const { user, ask } = await companionPlayer("burst", { plan: "hero" });
  env.DB.sqlite.prepare("INSERT INTO answer_user_spend (user_id, month, micro, calls) VALUES (?, '2026-10', ?, 1)")
    .run(user.id, 2_170_000);   // a cent under Hero's $2.18
  // Gemini answers none of them until all five have asked, as when a script sends them at once.
  const answering = globalThis.fetch, asked = [];
  globalThis.fetch = async (url, options) => {
    if (new URL(url).hostname === "generativelanguage.googleapis.com") await new Promise(go => {
      asked.push(go);
      if (asked.length === 5) asked.forEach(g => g());
      setTimeout(go, 2000).unref();
    });
    return answering(url, options);
  };
  const answers = await Promise.all(Array.from({ length: 5 }, () => ask({ research_required: true })));
  assert.deepEqual(answers.map(a => a.status), [200, 200, 200, 200, 200], "nobody is cut off");
  assert.equal(gemini.filter(g => g.body.tools).length, 1, "the rest are ordinary answers");
  // What the one answer held against the cap went once it was answered, and the month grew by what the answers cost.
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_holds").get().n, 0);
  const spent = env.DB.sqlite.prepare("SELECT micro FROM answer_user_spend WHERE user_id = ?").get(user.id).micro;
  const cost = env.DB.sqlite.prepare("SELECT reserved_micro FROM answer_spend WHERE month = '2026-10'").get().reserved_micro;
  assert.equal(spent - 2_170_000, cost);
});

// ---- Packs: the finest voice, and the starter ----

// A finest-voice pack's checkout session as an event carries it; GET checkout/sessions/<id> then returns the same, as
// Stripe would.
const packSession = (id, user, paymentStatus = "paid") => (checkoutSessions[id] = { id, object: "checkout.session",
  mode: "payment", customer: "cus_1", client_reference_id: user.id, payment_status: paymentStatus,
  payment_intent: `pi_${id}`, metadata: { kind: "voice" } });
const stripeEvent = (id, type, object) => ({ id, type, data: { object } });
const packs = user => env.DB.sqlite.prepare("SELECT id, answers, remaining, spent_micro, status FROM answer_packs " +
  "WHERE user_id = ? AND kind = 'voice' ORDER BY created, id").all(user.id).map(p => ({ ...p }));
const starterLeft = user => env.DB.sqlite.prepare("SELECT remaining FROM answer_packs WHERE user_id = ? AND kind = 'starter'")
  .all(user.id).map(p => p.remaining);
const usedToday = (user, bucket, n) => env.DB.prepare("INSERT OR REPLACE INTO rate_limits (user_id, bucket, n) VALUES (?, ?, ?)")
  .bind(user.id, `${bucket}:2026-10-11`, n).run();

// A player on `plan` (none: the free plan) with a connected companion, and their questions: fields go into the body
// with the prompt. starter: the free starter's answers left, already credited; without it, the account gets its
// starter the first time it's looked at, as a new player does.
async function companionPlayer(sub, { plan, starter } = {}) {
  const user = await player(sub);
  const link = await startLink(env);
  assert.equal(await decideLink(env, link.user_code, user, true), true);
  const { token } = await claimToken(env, link.device_code);
  if (plan) await entitle(user, plan, "active", 20);
  if (starter !== undefined) {
    await env.DB.prepare("INSERT INTO answer_packs (id, user_id, kind, answers, remaining, created) VALUES (?, ?, 'starter', 30, ?, ?)")
      .bind(`starter:${user.id}`, user.id, starter, new Date(NOW - 30 * 86400e3).toISOString()).run();
  }
  const ask = async (fields = {}) => {
    const res = await answer({ env, request: new Request(ORIGIN + "/api/companion/answer", { method: "POST",
      headers: { "X-LF-Client": "companion/0.1.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "QUESTION\nWhere can I buy Simple Flour?", ...fields }) }) });
    return { status: res.status, body: await res.json() };
  };
  return { user, ask };
}
// A free player whose starter is used up.
const freePlayer = sub => companionPlayer(sub, { starter: 0 });

test("a paid finest-voice pack is credited once, whatever events arrive; a refund or a dispute takes it back", async () => {
  const user = await player("buyer");
  assert.equal((await hook(stripeEvent("evt_1", "checkout.session.completed", packSession("cs_bank", user, "unpaid")))).status, 200);
  assert.deepEqual(packs(user), [], "a payment still on its way credits nothing");

  const paid = stripeEvent("evt_2", "checkout.session.completed", packSession("cs_card", user));
  assert.equal((await hook(paid)).status, 200);
  env.DB.sqlite.prepare("UPDATE answer_packs SET remaining = 350 WHERE id = 'cs_card'").run();   // 50 used since
  assert.equal((await hook(paid)).status, 200, "Stripe sends it again");
  assert.equal((await hook(stripeEvent("evt_3", "checkout.session.async_payment_succeeded", packSession("cs_card", user)))).status, 200);
  assert.equal((await hook(stripeEvent("evt_4", "checkout.session.async_payment_succeeded", packSession("cs_bank", user)))).status, 200);
  assert.deepEqual(packs(user).map(p => [p.id, p.remaining]), [["cs_bank", 400], ["cs_card", 350]],
    "one pack per checkout: the card's once, and the bank debit's once it's paid");
  assert.ok(stripeCalls.every(c => c.method === "GET"), "the sessions are only read back from Stripe");

  // An event claiming a payment Stripe doesn't know of (made with a leaked webhook secret, say) credits nothing.
  const forged = { ...packSession("cs_forged", user, "unpaid"), payment_status: "paid" };
  assert.equal((await hook(stripeEvent("evt_forged", "checkout.session.completed", forged))).status, 200);
  assert.equal(packs(user).length, 2, "Stripe says it's unpaid");

  const refund = { id: "ch_1", object: "charge", payment_intent: "pi_cs_card", refunded: true };
  assert.equal((await hook(stripeEvent("evt_5", "charge.refunded", refund))).status, 200);
  assert.deepEqual(packs(user).map(p => [p.id, p.remaining, p.status]), [["cs_bank", 400, "active"], ["cs_card", 0, "refunded"]]);
  const chargeback = { id: "dp_1", object: "dispute", charge: "ch_2", payment_intent: "pi_cs_bank", status: "needs_response" };
  assert.equal((await hook(stripeEvent("evt_6", "charge.dispute.created", chargeback))).status, 200);
  assert.deepEqual(packs(user).map(p => [p.id, p.remaining, p.status]), [["cs_bank", 0, "disputed"], ["cs_card", 0, "refunded"]]);

  // Stripe can send the dispute or the refund first, seconds before the checkout's own event (Mike's sandbox, 10/13):
  // the pack is kept as disputed or refunded, with no replies, and nothing else changes.
  for (const [id, kind, charge] of [["cs_dispute_first", "disputed", { disputed: true, refunded: false, amount_refunded: 0 }],
                                    ["cs_refund_first", "refunded", { disputed: false, refunded: true, amount_refunded: 299 }]]) {
    const session = packSession(id, user);
    const first = kind === "disputed"
      ? stripeEvent(`evt_${id}_1`, "charge.dispute.created", { id: `dp_${id}`, object: "dispute", payment_intent: session.payment_intent })
      : stripeEvent(`evt_${id}_1`, "charge.refunded", { id: `ch_${id}`, object: "charge", payment_intent: session.payment_intent, refunded: true });
    assert.equal((await hook(first)).status, 200);
    charges[session.payment_intent] = charge;
    assert.equal((await hook(stripeEvent(`evt_${id}_2`, "checkout.session.completed", session))).status, 200);
    assert.deepEqual(packs(user).filter(p => p.id === id).map(p => [p.remaining, p.status]), [[0, kind]], `${kind} first`);
  }
  assert.equal((await planFor(env, user.id)).id, "free", "a pack's dispute or refund touches no plan");

  await deleteUser(env, user);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_packs").get().n, 0, "Delete my account removes them");
});

test("a failed answer gives its starter answer back", async () => {
  const { user, ask } = await companionPlayer("budget", { starter: 30 });
  await usedToday(user, "companion-answer", 30);
  const working = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { message: "overloaded" } }, { status: 503 });
  try { assert.equal((await ask()).status, 502); } finally { globalThis.fetch = working; }
  assert.deepEqual(starterLeft(user), [30], "the player gets answers, not attempts");
});

// D1 failing for one statement: `sql` (a pattern) with any bound value starting `arg`, from the moment it's asked.
function failingD1(sql, arg = "") {
  const prepare = env.DB.prepare;
  env.DB.prepare = text => {
    const st = prepare(text);
    const broken = { first: async () => { throw new Error("D1_ERROR: Network connection lost."); },
                     run: async () => { throw new Error("D1_ERROR: Network connection lost."); } };
    return { ...st, bind: (...args) => sql.test(text) && args.some(a => String(a).startsWith(arg))
      ? { ...st.bind(...args), ...broken } : st.bind(...args) };
  };
  return () => { env.DB.prepare = prepare; };
}

test("a failed answer gives back the day and the month it was counted on, however it fails (LOR-673)", async () => {
  // A paid plan counts each answer on the day and on its month's pool (from Sept 30, its renewal day).
  const { user, ask } = await companionPlayer("unlucky", { plan: "hero" });
  const counts = () => Object.fromEntries(env.DB.sqlite.prepare("SELECT bucket, n FROM rate_limits WHERE user_id = ? " +
    "AND bucket IN ('companion-answer:2026-10-11', 'companion-month:2026-09-30')").all(user.id).map(r => [r.bucket.split(":")[0], r.n]));
  assert.equal((await ask()).status, 200);
  assert.deepEqual(counts(), { "companion-answer": 1, "companion-month": 1 });

  // The model failing: both back, so the companion's second ask (LOR-580) costs the one answer.
  const working = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { message: "overloaded" } }, { status: 503 });
  try { assert.equal((await ask()).status, 502); } finally { globalThis.fetch = working; }
  assert.deepEqual(counts(), { "companion-answer": 1, "companion-month": 1 });

  // D1 failing on the month's count after the day's went in: the day's goes back.
  let fixed = failingD1(/INSERT INTO rate_limits/, "companion-month:");
  try { assert.equal((await ask()).status, 502); } finally { fixed(); }
  assert.deepEqual(counts(), { "companion-answer": 1, "companion-month": 1 });

  // An error after counting, before the answer is written (a look online's hold on the plan's cost cap): both go back.
  fixed = failingD1(/INSERT INTO answer_holds/);
  try { assert.equal((await ask({ research_required: true })).status, 502); } finally { fixed(); }
  assert.deepEqual(counts(), { "companion-answer": 1, "companion-month": 1 });
  assert.equal(gemini.length, 1, "the hold failed before anything was asked of the model");

  // The shared budget refusing a free player's answer (the "at capacity" 429): the day's count goes back.
  const free = await companionPlayer("crowded", { starter: 30 });
  env.STORY_BUDGET_USD = "0";
  try { assert.equal((await free.ask()).status, 429); } finally { delete env.STORY_BUDGET_USD; }
  assert.equal(env.DB.sqlite.prepare("SELECT n FROM rate_limits WHERE user_id = ? AND bucket = 'companion-answer:2026-10-11'")
    .get(free.user.id)?.n ?? 0, 0);
  assert.deepEqual(starterLeft(free.user), [30]);
});

test("out of answers: Willo's words for when they come back, Hero the free plan's one offer, nothing for Legend", async () => {
  const { user, ask } = await freePlayer("broke");
  await usedToday(user, "companion-answer", 30);
  const out = await ask();
  assert.equal(out.status, 429);
  assert.equal(out.body.error, "My light's spent for today. The Moonwell refills it tomorrow.",
    "only when they come back: the companion starts its lore-library answer with these words");
  assert.deepEqual(out.body.offers, [{ id: "hero", text: "Get Hero: 1,500 answers a month", url: "/plans" }]);

  // With plans off, the 20 free answers a day and nothing for sale.
  delete env.SITE_FEATURES;
  try {
    await usedToday(user, "companion-answer", 20);
    const off = await ask();
    assert.equal(off.status, 429);
    assert.equal(off.body.offers, undefined);
    assert.equal(off.body.error, "You've used today's 20 free answers. They come back tomorrow.", "as before plans");
  } finally { env.SITE_FEATURES = "plans"; }

  // Legend at its day's most: nothing above it to offer, and no way to the plans page for more light.
  const legend = await companionPlayer("legend", { plan: "legend" });
  await usedToday(legend.user, "companion-answer", 300);
  const spent = await legend.ask();
  assert.equal(spent.status, 429);
  assert.deepEqual([spent.body.offers, spent.body.allowance.upgrade], [undefined, undefined]);
  assert.equal(gemini.length, 0);
});

// ---- The launch plans (Mike, 2026-10-12) ----

test("free with plans on: 30 a day, then the 30-answer starter, once per Google account, then a 429 with offers", async () => {
  const { user, ask } = await companionPlayer("newcomer");
  const first = await allowance(env, user.id);
  assert.deepEqual([first.limit, first.remaining, first.extra], [30, 60, 30], "the day's 30 and the starter");
  for (let i = 0; i < 30; i++) assert.equal((await ask()).status, 200, `answer ${i + 1}`);
  const dayGone = await allowance(env, user.id);
  assert.deepEqual([dayGone.limit, dayGone.remaining, dayGone.extra], [30, 30, 30], "today's are gone: the starter's left");
  for (let i = 30; i < 60; i++) assert.equal((await ask()).status, 200, `answer ${i + 1}`);
  assert.deepEqual(starterLeft(user), [0]);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_user_spend").get().n, 0,
    "starter answers are free: none of their cost is the player's");
  const out = await ask();
  assert.equal(out.status, 429);
  assert.match(out.body.error, /^My light's spent for today\./);
  assert.deepEqual(out.body.offers.map(o => o.id), ["hero"]);
  assert.equal(gemini.length, 60);
  // Connecting the companion again doesn't bring another starter.
  env.DB.sqlite.prepare("DELETE FROM devices WHERE user_id = ?").run(user.id);
  env.DB.sqlite.prepare("INSERT INTO devices (id, token_hash, user_id, label, created) VALUES ('again', 'again', ?, 'companion', ?)")
    .run(user.id, new Date(NOW).toISOString());
  assert.equal((await allowance(env, user.id)).remaining, 0);
  assert.deepEqual(starterLeft(user), [0]);
  // Nor does deleting the account and signing in again with the same Google account.
  await deleteUser(env, user);
  const again = await companionPlayer("newcomer");
  assert.notEqual(again.user.id, user.id);
  const fresh = await allowance(env, again.user.id);
  assert.deepEqual([fresh.remaining, fresh.extra], [30, 0], "today's 30, and no starter");
});

test("starter answers wait for the shared budget like free ones, and one that can't be answered goes back", async () => {
  const { user, ask } = await companionPlayer("thrifty");
  await usedToday(user, "companion-answer", 30);
  env.STORY_BUDGET_USD = "0";
  try {
    const full = await ask();
    assert.equal(full.status, 429);
    assert.match(full.body.error, /at capacity/);
  } finally { delete env.STORY_BUDGET_USD; }
  assert.deepEqual(starterLeft(user), [30]);
  assert.equal(gemini.length, 0);
});

// A stand-in JPEG: the site checks only its FF D8 FF start.
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(296, 7)]).toString("base64");

test("after their first-run trial, free answers stay with the lore: no looking online, no game picture, and the LORE FOCUS block", async () => {
  const { user, ask } = await companionPlayer("lorekeeper");
  await tasted(user, TASTE_ANSWERS, 15);
  const required = await ask({ research_required: true, persona: "willo", style: "spoken", image: jpeg });
  assert.equal(required.status, 200, JSON.stringify(required.body));
  assert.equal(required.body.looked_up, "off");          // asked to look; the free plan never does (LOR-627)
  const auto = await ask({ research: "auto", persona: "willo", style: "spoken", image: jpeg });
  assert.equal(auto.status, 200);
  assert.equal(gemini.length, 2, "no quick look online before either");
  for (const { url, body } of gemini) {
    assert.match(url, new RegExp(`${ANSWER_MODEL}:generateContent$`));
    assert.equal(body.tools, undefined);
    assert.equal(body.contents[0].parts.length, 1, "the picture isn't sent");
    const system = body.systemInstruction.parts[0].text;
    assert.match(system, /LORE FOCUS: answer from the world's lore and story/);
    assert.match(system, /Willo says this answer out loud/, "Willo still speaks");
  }
});

test("a new free player's first answers are at Willo's best, counted only when answered; the day's cap turns them away", async () => {
  const { user, ask } = await companionPlayer("newcomer");
  const mine = () => env.DB.prepare("SELECT used, voices, lookups FROM best_first WHERE user_id = ?").bind(user.id).first();
  const T = TASTE_ANSWERS;
  assert.deepEqual((await allowance(env, user.id)).taste, { of: T, left: T, on: true });
  // Asked out loud with a picture: Willo sees the game, without the free plan's LORE FOCUS, and the answer earns one
  // reply in her finest voice (site/tests/companion-voice.test.mjs says it).
  const spoken = await ask({ persona: "willo", style: "spoken", image: jpeg });
  assert.equal(spoken.status, 200, JSON.stringify(spoken.body));
  assert.equal(gemini[0].body.contents[0].parts.length, 2, "the picture goes with it");
  assert.doesNotMatch(gemini[0].body.systemInstruction.parts[0].text, /LORE FOCUS/);
  assert.deepEqual(spoken.body.allowance.taste, { of: T, left: T - 1, on: true });
  // Typed, with research: it looks online, one of its few look-ups, and earns no spoken reply.
  assert.equal((await ask({ research_required: true })).status, 200);
  assert.deepEqual(gemini[1].body.tools, [{ googleSearch: {} }]);
  assert.deepEqual(await mine(), { used: 2, voices: 1, lookups: 1 });
  // Chat memory isn't a live answer, and a failed answer gives its place back.
  assert.equal((await ask({ operation: "compact", prompt: "PREVIOUS MEMORY\nPepper" })).status, 200);
  const working = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { message: "overloaded" } }, { status: 503 });
  try { assert.equal((await ask({ style: "spoken" })).status, 502); } finally { globalThis.fetch = working; }
  assert.deepEqual(await mine(), { used: 2, voices: 1, lookups: 1 });
  // The day's cap reached: the plan's own free answer (the lore, nothing online), not counted, and kept for later.
  env.TASTE_DAY_USD = "0";
  try {
    const capped = await ask({ research_required: true });
    assert.equal(capped.status, 200);
    assert.equal(gemini.at(-1).body.tools, undefined);
    assert.doesNotMatch(gemini.at(-1).body.systemInstruction.parts[0].text, /LORE FOCUS/, "still in the trial's days");
    assert.deepEqual(capped.body.allowance.taste, { of: T, left: T - 2, on: false, why: "resting" });
    assert.deepEqual(await mine(), { used: 2, voices: 1, lookups: 1 }, "the look-up the cap turned away went back");
  } finally { delete env.TASTE_DAY_USD; }
  const day = env.DB.sqlite.prepare("SELECT answers, starts, capped, spent_micro FROM best_first_days").get();
  assert.deepEqual([day.answers, day.starts, day.capped], [2, 1, 1]);
  assert.ok(day.spent_micro > 0, "what they cost is on the day");
  // All 20 used: the free path, and once per Google account, even after "Delete my account".
  await env.DB.prepare("UPDATE best_first SET used = ? WHERE user_id = ?").bind(T, user.id).run();
  assert.deepEqual((await allowance(env, user.id)).taste, { of: T, left: 0, on: true }, "its last finest reply is still owed");
  await env.DB.prepare("UPDATE best_first SET voices = 0 WHERE user_id = ?").bind(user.id).run();
  assert.deepEqual((await allowance(env, user.id)).taste, { of: T, left: 0, on: false, why: "used" });
  await env.DB.prepare("DELETE FROM best_first").run();
  assert.equal((await ask()).status, 200);
  await deleteUser(env, user);
  const back = await companionPlayer("newcomer");
  assert.deepEqual((await allowance(env, back.user.id)).taste.left, T - 1, "the same Google account keeps its count");
});

test("in a new free player's first-run trial days after their 20: a few look-ups and pictures, her style, longer memory", async () => {
  // Mike, 2026-10-19: "the best voice models and all the features that Willow has to offer for a limited time, like a
  // limited number of uses for just about everything" (lib/best-first.js TRIAL).
  const { user, ask } = await companionPlayer("trier");
  await tasted(user, TASTE_ANSWERS, 3);
  const mine = () => env.DB.prepare("SELECT lookups, tries FROM best_first WHERE user_id = ?").bind(user.id).first();
  await setupWilloCustom(env);
  await env.DB.prepare("INSERT INTO custom_prompts (user_id, kind, target, tale, text, preset, status, created, updated) " +
    "VALUES (?, 'style', '', 'mine', 'Call me Captain.', 'bard', 'ok', ?, ?)").bind(user.id, "2026-10-10", "2026-10-10").run();
  const trial = (await allowance(env, user.id)).trial;
  assert.deepEqual(trial, { on: true, until: "2026-10-15T12:00:00.000Z",
    uses: { web: { of: TRIAL.lookups, left: TRIAL.lookups }, sight: { of: TRIAL.sight, left: TRIAL.sight },
            characters: { of: TRIAL.cast, left: TRIAL.cast } },
    opens: ["voices", "memory", "style", "tales", "goals", "talk"] });
  // Asked out loud with a picture: Willo sees the game, in the player's style, without the free plan's LORE FOCUS; the
  // picture is one of the trial's.
  const seen = await ask({ persona: "willo", style: "spoken", image: jpeg });
  assert.equal(seen.status, 200, JSON.stringify(seen.body));
  assert.equal(gemini[0].body.contents[0].parts.length, 2, "the picture goes with it");
  const system = gemini[0].body.systemInstruction.parts[0].text;
  assert.doesNotMatch(system, /LORE FOCUS/);
  assert.match(system, /In the player's own words: "Call me Captain\."/);
  assert.deepEqual(seen.body.lookups.includes("sight"), true);
  assert.deepEqual(JSON.parse((await mine()).tries), { sight: 1 });
  assert.deepEqual(seen.body.allowance.trial.uses.sight, { of: TRIAL.sight, left: TRIAL.sight - 1 }, "her window shows it");
  // Typed, with research: one of the trial's look-ups; its last gone, the lore and nothing online.
  const looked = await ask({ research_required: true });
  assert.equal(looked.status, 200);
  assert.deepEqual(gemini[1].body.tools, [{ googleSearch: {} }]);
  assert.equal((await mine()).lookups, 1);
  assert.deepEqual(looked.body.allowance.trial.uses.web, { of: TRIAL.lookups, left: TRIAL.lookups - 1 });
  // The last picture: the reply says none are left, and that she no longer sees the game.
  await env.DB.prepare("UPDATE best_first SET tries = ? WHERE user_id = ?")
    .bind(JSON.stringify({ sight: TRIAL.sight - 1 }), user.id).run();
  const last = await ask({ persona: "willo", style: "spoken", image: jpeg });
  assert.equal(gemini[2].body.contents[0].parts.length, 2);
  assert.deepEqual([last.body.allowance.trial.uses.sight.left, last.body.allowance.features.sight], [0, false]);
  await env.DB.prepare("UPDATE best_first SET lookups = ?, tries = ? WHERE user_id = ?")
    .bind(TRIAL.lookups, JSON.stringify({ sight: TRIAL.sight }), user.id).run();
  assert.equal((await ask({ research_required: true, style: "spoken", image: jpeg })).status, 200);
  assert.equal(gemini[3].body.tools, undefined);
  assert.equal(gemini[3].body.contents[0].parts.length, 1, "the trial's pictures are used");
  // Asked what they're trying: her help has the trial, plainly; a quest's "Trial of ..." isn't asked about her.
  assert.equal((await ask({ prompt: "QUESTION\nWhat am I trying right now?", persona: "willo" })).status, 200);
  assert.match(gemini.at(-1).body.systemInstruction.parts[0].text,
    /They're trying what their plan doesn't have yet, their first-run trial, until October 15: looking things up/);
  const { helpTopics } = await import("../lib/willo-help.js");
  for (const q of ["How many tries do I have left?", "What's in my trial?", "What am I trying?"])
    assert.ok(helpTopics(q).includes("plans"), q);
  for (const q of ["What am I trying to do in this quest?", "Where does the Trial of the Sea Lion start?"])
    assert.ok(!helpTopics(q).includes("plans"), q);
  gemini.splice(-1);
  // Chat memory keeps twice as much in the trial's days, as Champion's does.
  assert.equal((await ask({ operation: "compact", prompt: "PREVIOUS MEMORY\nPepper" })).status, 200);
  assert.match(gemini[4].body.systemInstruction.parts[0].text, /at most 700 words and 4,800 UTF-8 bytes/);
  // The trial's days over: the free plan's own answers, its style kept for a plan that has it.
  await env.DB.prepare("UPDATE best_first SET started = ? WHERE user_id = ?")
    .bind(new Date(NOW - 15 * 86400e3).toISOString(), user.id).run();
  assert.equal((await allowance(env, user.id)).trial.on, false);
  assert.equal((await ask({ style: "spoken", image: jpeg })).status, 200);
  assert.match(gemini[5].body.systemInstruction.parts[0].text, /LORE FOCUS/);
  assert.doesNotMatch(gemini[5].body.systemInstruction.parts[0].text, /Call me Captain/);
  assert.equal((await ask({ operation: "compact", prompt: "PREVIOUS MEMORY\nPepper" })).status, 200);
  assert.doesNotMatch(gemini[6].body.systemInstruction.parts[0].text, /at most 700 words/);
});

test("the beta's free Hero month tries Legend's: her own words, tales and longer memory, not the look-ups it already has", async () => {
  const trial = { on: true, left: { lookups: TRIAL.lookups, sight: TRIAL.sight, cast: TRIAL.cast } };
  const hero = { ...PLANS.hero, launch: true };
  assert.deepEqual(companionFeatures(hero, { taste: { on: true, left: TASTE_ANSWERS, trial } }),
    { voices: "all", push_to_talk: true, sight: true, npc_voices: true, research: true, reminders: true });
  assert.deepEqual(trialView(hero, trial), { on: true, uses: { characters: { of: TRIAL.cast, left: TRIAL.cast } },
    opens: ["voices", "memory", "style", "tales"] });
});

test("a paying player hears their plan; back on the free plan, the first answers at Willo's best they never had", async () => {
  const { user, ask } = await companionPlayer("beta", { plan: "hero" });
  assert.equal((await allowance(env, user.id)).taste, undefined, "a paying player hears their plan");
  await env.DB.prepare("DELETE FROM entitlements").run();
  assert.equal((await allowance(env, user.id)).taste.left, TASTE_ANSWERS, "back on the free plan, the taste they never had");
});

test("Legend's answers are on the smarter model, pictures too, and on Flash-Lite past its text cap; Hero's on Flash-Lite", async () => {
  const { user, ask } = await companionPlayer("legend-smart", { plan: "legend" });
  const said = await ask();
  assert.equal(said.status, 200, JSON.stringify(said.body));
  assert.equal(said.body.model, SMART_MODEL);
  assert.match(gemini[0].url, new RegExp(`/${SMART_MODEL}:generateContent$`));
  assert.equal((await ask({ persona: "willo", style: "spoken", image: jpeg })).status, 200);
  assert.match(gemini[1].url, new RegExp(`/${SMART_MODEL}:`));
  // Legend's text cap is $9.20 a month: past it, Flash-Lite (lib/billing.js capState "lite").
  env.DB.sqlite.prepare("UPDATE answer_user_spend SET micro = 9200000 WHERE user_id = ?").run(user.id);
  assert.equal((await ask()).body.model, LITE_MODEL);
  const hero = await companionPlayer("hero-lite", { plan: "hero" });
  assert.equal((await hero.ask()).body.model, ANSWER_MODEL);
  assert.equal(ANSWER_MODEL, LITE_MODEL, "every plan but a smarter one answers on Flash-Lite");
});

test("Champion answers on the ordinary model with a longer chat memory: no stronger mind at launch", async () => {
  const { ask } = await companionPlayer("champ", { plan: "champion" });
  const said = await ask();
  assert.equal(said.status, 200, JSON.stringify(said.body));
  assert.equal(said.body.model, ANSWER_MODEL);
  assert.match(gemini[0].url, new RegExp(`${ANSWER_MODEL}:generateContent$`));
  assert.equal((await ask({ operation: "compact", prompt: "PREVIOUS MEMORY\nPepper" })).status, 200);
  assert.match(gemini[1].url, new RegExp(`${LITE_MODEL}:generateContent$`), "chat memory stays on Flash-Lite");
  assert.match(gemini[1].body.systemInstruction.parts[0].text, /at most 700 words and 4,800 UTF-8 bytes/);
  assert.equal(gemini[1].body.generationConfig.maxOutputTokens, 2048);
});

test("a paid plan's answers and web look-ups are a month's pool from its renewal day, within today's most", async () => {
  // Hero renews on the 31st (20 days from 10/11), so its month started on Sept 30, September's last day.
  const { user, ask } = await companionPlayer("monthly", { plan: "hero" });
  const fresh = await allowance(env, user.id);
  assert.deepEqual([fresh.period, fresh.limit, fresh.remaining], ["day", 100, 100], "today's 100 run out first");
  const used = n => env.DB.prepare("INSERT OR REPLACE INTO rate_limits (user_id, bucket, n) VALUES (?, ?, ?)")
    .bind(user.id, "companion-month:2026-09-30", n).run();
  await used(1450);
  const late = await allowance(env, user.id);
  assert.deepEqual([late.period, late.limit, late.remaining, late.resetsAt], ["month", 1500, 50, "2026-10-31T12:00:00.000Z"],
    "the pool comes back with the renewal itself (noon), not at midnight before it");
  await used(1500);
  const out = await ask();
  assert.equal(out.status, 429);
  assert.equal(out.body.error, "My light's spent for this month. The Moonwell refills it on October 31.");
  assert.equal(gemini.length, 0);

  // The month's 10 web look-ups: the 10th searches, the 11th is answered without looking online.
  await env.DB.prepare("DELETE FROM rate_limits WHERE user_id = ?").bind(user.id).run();
  await env.DB.prepare("INSERT INTO rate_limits (user_id, bucket, n) VALUES (?, 'companion-lookup:2026-09-30', 9)")
    .bind(user.id).run();
  assert.equal((await ask({ research_required: true })).status, 200);
  assert.deepEqual(gemini[0].body.tools, [{ googleSearch: {} }]);
  assert.equal((await ask({ research_required: true })).status, 200);
  assert.equal(gemini[1].body.tools, undefined);
});

// scripts/stripe-setup.mjs, run with fetch blocked: the key checks come before any call to Stripe.
function stripeSetup(args, keys, blocked = "data:text/javascript,globalThis.fetch=async()=>{throw new Error('no network in tests')}") {
  const script = fileURLToPath(new URL("../../scripts/stripe-setup.mjs", import.meta.url));
  const environment = { PATH: process.env.PATH, ...keys };
  return spawnSync(process.execPath, ["--import", blocked, script, ...args], { env: environment, encoding: "utf8" });
}

test("stripe-setup --live says LIVE MODE first and takes only a live key; without it, a live key is refused", () => {
  const live = stripeSetup(["--live"], { STRIPE_LIVE_SECRET_KEY: "sk_test_123", STRIPE_SECRET_KEY: "sk_test_456" });
  assert.equal(live.status, 1);
  assert.match(live.stdout, /^LIVE MODE/);
  assert.match(live.stderr, /--live needs a live key/);
  const plain = stripeSetup([], { STRIPE_SECRET_KEY: "sk_live_123" });
  assert.equal(plain.status, 1);
  assert.doesNotMatch(plain.stdout, /LIVE MODE/);
  assert.match(plain.stderr, /That's a live key/);
});

test("Delete my account cancels every subscription that could still charge, and deletes nothing when Stripe can not", async () => {
  const user = await player("leaving");
  await env.DB.prepare("INSERT INTO entitlements (user_id, customer_id, subscription_id, plan, status, updated) " +
    "VALUES (?, \x27cus_1\x27, \x27sub_a\x27, \x27hero\x27, \x27active\x27, ?)").bind(user.id, new Date(NOW).toISOString()).run();
  subscriptions.sub_a = subscription("sub_a", user.id);
  subscriptions.sub_b = subscription("sub_b", user.id);   // a second one, from a checkout page left open in another tab
  subscriptions.sub_old = subscription("sub_old", user.id, { status: "canceled" });
  const stripeUp = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { message: "overloaded" } }, { status: 503 });
  await assert.rejects(deleteUser(env, user), e => e.billing === true);
  assert.ok(env.DB.sqlite.prepare("SELECT id FROM users WHERE id = ?").get(user.id), "nothing was deleted");
  globalThis.fetch = stripeUp;
  await deleteUser(env, user);
  assert.deepEqual(stripeCalls.filter(c => c.method === "DELETE").map(c => c.path).sort(),
    ["subscriptions/sub_a", "subscriptions/sub_b"]);
  assert.equal(env.DB.sqlite.prepare("SELECT id FROM users WHERE id = ?").get(user.id), undefined);
});

test("stripe-setup --portal-only turns on the portal's cancellation question and changes nothing else", () => {
  // A Stripe that has the script's portal settings and says what it was asked, one line a call.
  const fake = "data:text/javascript," + encodeURIComponent(`globalThis.fetch = async (url, o = {}) => {
    console.log("CALL " + (o.method || "GET") + " " + new URL(url).pathname + " " + decodeURIComponent(o.body || ""));
    if (new URL(url).pathname === "/v1/billing_portal/configurations" && (o.method || "GET") === "GET")
      return Response.json({ data: [{ id: "bpc_default", metadata: {} }, { id: "bpc_ours", metadata: { lore_forever: "plans" } }] });
    return Response.json({ id: "bpc_ours" });
  };`);
  const run = stripeSetup(["--portal-only"], { STRIPE_SECRET_KEY: "sk_test_123" }, fake);
  assert.equal(run.status, 0, run.stderr);
  const calls = run.stdout.split("\n").filter(l => l.startsWith("CALL "));
  assert.equal(calls.length, 2, run.stdout);
  assert.match(calls[0], /^CALL GET \/v1\/billing_portal\/configurations /);
  assert.match(calls[1], /^CALL POST \/v1\/billing_portal\/configurations\/bpc_ours features\[subscription_cancel\]\[cancellation_reason\]\[enabled\]=true&features\[subscription_cancel\]\[cancellation_reason\]\[options\]\[0\]=too_expensive&/);
  assert.match(calls[1], /\[options\]\[7\]=other$/);
  assert.match(run.stdout, /now ask why a player cancels \(8 reasons\); nothing else changed/);
});
