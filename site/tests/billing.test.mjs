// Plans (lib/billing.js, functions/api/billing/[action].js): Stripe's webhook signatures, subscriptions becoming plans,
// how many live answers each plan gets a day and what kind, the free plan's starter, checkout, a paying player's cost
// cap, and top-ups: credited once, used after the day's plan answers within the day's most, their cost cap, and the
// offers when answers run out. Stripe and Gemini are mocked through fetch; D1 is node:sqlite (helpers.mjs).
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
import { setupBilling, planFor, INTEGRATION_ID } from "../lib/billing.js";
import { allowance, ANSWER_MODEL, RESEARCH_MODEL } from "../lib/companion-answers.js";

import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const NOW = Date.parse("2026-10-11T12:00:00Z");
const env = { DB: d1(), GEMINI_API_KEY: "test-key", STRIPE_SECRET_KEY: "sk_test_123", STRIPE_WEBHOOK_SECRET: "whsec_test",
              SITE_FEATURES: "plans" };
const originalFetch = globalThis.fetch;
let stripeCalls, gemini, subscriptions, checkoutSessions;

beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  await setup(env);
  await setupBilling(env);
  for (const table of ["users", "sessions", "devices", "device_links", "rate_limits", "answer_spend", "story_spend",
                       "entitlements", "billing_events", "answer_user_spend", "answer_packs", "answer_holds",
                       "starter_claims"])
    env.DB.sqlite.exec(`DELETE FROM ${table}`);
  stripeCalls = [];
  gemini = [];
  subscriptions = {};
  checkoutSessions = {};
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
      { id: "price_hero_m", lookup_key: "hero_monthly" }, { id: "price_hero_y", lookup_key: "hero_yearly" },
      { id: "price_topup", lookup_key: "topup_300" }] });
    if (route === "POST customers") return Response.json({ id: "cus_1" });
    if (route === "POST checkout/sessions") return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    if (route === "GET checkout/sessions") return Response.json({ data: [] });
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
    assert.deepEqual([a.remaining, a.upgrade, a.features, a.topup], [20, undefined, undefined, undefined],
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

test("daily answers: free, Hero while active or past due, Champion, an ended period, and the brake", async () => {
  const free = await linkedDaysAgo("free", 30), hero = await linkedDaysAgo("hero", 30), champion = await linkedDaysAgo("champ", 3);
  assert.deepEqual(await daily(free), ["free", 20]);
  await entitle(hero, "hero", "active", 20);
  assert.deepEqual(await daily(hero), ["hero", 100]);
  await entitle(hero, "hero", "past_due", 20);
  assert.deepEqual(await daily(hero), ["hero", 100], "a failed payment keeps the plan while Stripe retries");
  await entitle(champion, "champion", "active", 20);
  assert.deepEqual(await daily(champion), ["champion", 200]);
  await entitle(hero, "hero", "active", -1);
  assert.deepEqual(await daily(hero), ["free", 20], "a period that ended is the free plan");

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
  assert.deepEqual((await allowance(env, free.id)).features,
    { voices: "default", push_to_talk: false, sight: false, npc_voices: false, research: false });
  for (const user of [hero, champion]) {
    assert.deepEqual((await allowance(env, user.id)).features,
      { voices: "all", push_to_talk: true, sight: true, npc_voices: true, research: true });
  }
});

test("what paying players' answers cost never uses up the free players' budget", async () => {
  const free = await linkedDaysAgo("free", 30);
  // $90 of this month's answers so far, all of them paying players'.
  env.DB.sqlite.exec("INSERT INTO answer_spend (month, reserved_micro, actual_micro, calls) VALUES ('2026-10', 90000000, 90000000, 9000)");
  env.DB.sqlite.exec("INSERT INTO answer_user_spend (user_id, month, micro, calls) VALUES ('someone', '2026-10', 90000000, 9000)");
  const a = await allowance(env, free.id);
  assert.deepEqual([a.limit, a.available], [20, true], "no brake, and the shared budget is still open");
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
  assert.equal((await post("checkout", { plan: "legend", interval: "month" }, { cookie })).status, 400);
  assert.equal(stripeCalls.length, 0, "nothing reaches Stripe for a plan that isn't for sale");

  const res = await post("checkout", { plan: "hero", interval: "year" }, { cookie });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.url, "https://checkout.stripe.com/c/pay/cs_test_1");
  const session = stripeCalls.find(c => c.path === "checkout/sessions");
  assert.equal(session.headers.Authorization, "Bearer sk_test_123");
  assert.equal(session.body.get("mode"), "subscription");
  assert.equal(session.body.get("client_reference_id"), user.id);
  assert.equal(session.body.get("subscription_data[metadata][user_id]"), user.id);
  assert.equal(session.body.get("line_items[0][price]"), "price_hero_y");
  assert.equal(session.body.get("customer"), "cus_1");
  assert.equal(session.body.get("integration_identifier"), INTEGRATION_ID);
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

test("a paying player skips the shared budget, and past the cost cap research becomes an ordinary answer", async () => {
  const user = await player("hero");
  const link = await startLink(env);
  assert.equal(await decideLink(env, link.user_code, user, true), true);
  const { token } = await claimToken(env, link.device_code);
  await entitle(user, "hero", "active", 20);
  const ask = async () => {
    const res = await answer({ env, request: new Request(ORIGIN + "/api/companion/answer", { method: "POST",
      headers: { "X-LF-Client": "companion/0.1.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "QUESTION\nWhere can I buy Mild Spices?", research_required: true }) }) });
    return { status: res.status, body: await res.json() };
  };
  env.STORY_BUDGET_USD = "0";   // the shared budget is spent: a free player would get a 429 now
  try {
    assert.equal((await ask()).status, 200);
    assert.deepEqual(gemini[0].body.tools, [{ googleSearch: {} }], "under the cap, research searches the web");
    const spent = env.DB.sqlite.prepare("SELECT micro, calls FROM answer_user_spend WHERE user_id = ?").get(user.id);
    assert.equal(spent.calls, 1);
    assert.ok(spent.micro > 0);

    env.DB.sqlite.prepare("UPDATE answer_user_spend SET micro = 2500000 WHERE user_id = ?").run(user.id);
    const capped = await ask();
    assert.equal(capped.status, 200);
    assert.equal(gemini[1].body.tools, undefined, "past the cap: no web search");
    assert.match(gemini[1].url, /gemini-3\.1-flash-lite:generateContent$/);
    assert.equal(capped.body.answer, "Mild Spices are sold in Goldshire.");
    assert.deepEqual(capped.body.allowance.fair_use, { lookups: false, until: "2026-11-01T00:00:00.000Z" },
      "the companion is told: no web look-ups until next month (a Hero has no stronger mind to lose)");
    assert.equal(capped.body.allowance.plan.id, "hero");
    assert.equal(capped.body.counted, undefined, "the cost stays on the server");
  } finally { delete env.STORY_BUDGET_USD; }
});

test("research questions sent all at once by a player just under the cost cap: only one looks online", async () => {
  const { user, ask } = await companionPlayer("burst", { plan: "hero" });
  env.DB.sqlite.prepare("INSERT INTO answer_user_spend (user_id, month, micro, calls) VALUES (?, '2026-10', ?, 1)")
    .run(user.id, 2_490_000);   // a cent under Hero's $2.50
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
  assert.equal(spent - 2_490_000, cost);
});

// ---- Top-ups ----

// A top-up's Checkout Session as its webhook events carry it.
// A top-up's checkout session as an event carries it; GET checkout/sessions/<id> then returns the same, as Stripe would.
const topupSession = (id, user, paymentStatus = "paid") => (checkoutSessions[id] = { id, object: "checkout.session",
  mode: "payment", customer: "cus_1", client_reference_id: user.id, payment_status: paymentStatus,
  payment_intent: `pi_${id}`, metadata: { kind: "topup" } });
const stripeEvent = (id, type, object) => ({ id, type, data: { object } });
const packs = user => env.DB.sqlite.prepare("SELECT id, answers, remaining, spent_micro, status FROM answer_packs " +
  "WHERE user_id = ? AND kind = 'topup' ORDER BY created, id").all(user.id).map(p => ({ ...p }));
const starterLeft = user => env.DB.sqlite.prepare("SELECT remaining FROM answer_packs WHERE user_id = ? AND kind = 'starter'")
  .all(user.id).map(p => p.remaining);
const addPack = (user, id, { remaining = 300, spent = 0, daysAgo = 0 } = {}) => env.DB.prepare(
  "INSERT INTO answer_packs (id, user_id, answers, remaining, spent_micro, payment_intent, created) VALUES (?, ?, 300, ?, ?, ?, ?)"
).bind(id, user.id, remaining, spent, `pi_${id}`, new Date(NOW - daysAgo * 86400e3).toISOString()).run();
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
      body: JSON.stringify({ prompt: "QUESTION\nWhere can I buy Mild Spices?", ...fields }) }) });
    return { status: res.status, body: await res.json() };
  };
  return { user, ask };
}
// A free player whose starter is used up.
const freePlayer = sub => companionPlayer(sub, { starter: 0 });

test("a paid top-up credits 300 answers once, whatever events arrive; a refund or a dispute takes them back", async () => {
  const user = await player("buyer");
  assert.equal((await hook(stripeEvent("evt_1", "checkout.session.completed", topupSession("cs_bank", user, "unpaid")))).status, 200);
  assert.deepEqual(packs(user), [], "a payment still on its way credits nothing");

  const paid = stripeEvent("evt_2", "checkout.session.completed", topupSession("cs_card", user));
  assert.equal((await hook(paid)).status, 200);
  env.DB.sqlite.prepare("UPDATE answer_packs SET remaining = 250 WHERE id = 'cs_card'").run();   // 50 used since
  assert.equal((await hook(paid)).status, 200, "Stripe sends it again");
  assert.equal((await hook(stripeEvent("evt_3", "checkout.session.async_payment_succeeded", topupSession("cs_card", user)))).status, 200);
  assert.equal((await hook(stripeEvent("evt_4", "checkout.session.async_payment_succeeded", topupSession("cs_bank", user)))).status, 200);
  assert.deepEqual(packs(user).map(p => [p.id, p.remaining]), [["cs_bank", 300], ["cs_card", 250]],
    "one pack per checkout: the card's once, and the bank debit's once it's paid");
  assert.ok(stripeCalls.every(c => c.method === "GET"), "the sessions are only read back from Stripe");

  // An event claiming a payment Stripe doesn't know of (made with a leaked webhook secret, say) credits nothing.
  const forged = { ...topupSession("cs_forged", user, "unpaid"), payment_status: "paid" };
  assert.equal((await hook(stripeEvent("evt_forged", "checkout.session.completed", forged))).status, 200);
  assert.equal(packs(user).length, 2, "Stripe says it's unpaid");

  const refund = { id: "ch_1", object: "charge", payment_intent: "pi_cs_card", refunded: true };
  assert.equal((await hook(stripeEvent("evt_5", "charge.refunded", refund))).status, 200);
  assert.deepEqual(packs(user).map(p => [p.id, p.remaining, p.status]), [["cs_bank", 300, "active"], ["cs_card", 0, "refunded"]]);
  const chargeback = { id: "dp_1", object: "dispute", charge: "ch_2", payment_intent: "pi_cs_bank", status: "needs_response" };
  assert.equal((await hook(stripeEvent("evt_6", "charge.dispute.created", chargeback))).status, 200);
  assert.deepEqual(packs(user).map(p => [p.id, p.remaining, p.status]), [["cs_bank", 0, "disputed"], ["cs_card", 0, "refunded"]]);

  await deleteUser(env, user);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_packs").get().n, 0, "Delete my account removes them");
});

test("top-up checkout is a one-time payment for the account, refused after this month's 3 and while plans are off", async () => {
  const user = await player("buyer");
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  const res = await post("topup", {}, { cookie });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const session = stripeCalls.find(c => c.path === "checkout/sessions").body;
  assert.equal(session.get("mode"), "payment");
  assert.equal(session.get("line_items[0][price]"), "price_topup");
  assert.equal(session.get("client_reference_id"), user.id);
  assert.equal(session.get("metadata[kind]"), "topup");
  assert.equal(session.get("payment_intent_data[metadata][user_id]"), user.id);
  assert.equal(session.get("success_url"), `${ORIGIN}/plans?topup=done#topup`);

  // The free starter, credited this month, is never a top-up bought.
  await env.DB.prepare("INSERT INTO answer_packs (id, user_id, kind, answers, remaining, created) VALUES (?, ?, 'starter', 30, 30, ?)")
    .bind(`starter:${user.id}`, user.id, new Date(NOW).toISOString()).run();
  for (const id of ["cs_a", "cs_b"]) await addPack(user, id);
  await addPack(user, "cs_last_month", { daysAgo: 20 });
  assert.equal((await post("topup", {}, { cookie })).status, 200, "two this month, and the starter doesn't count");
  await addPack(user, "cs_c");
  const calls = stripeCalls.length;
  const full = await post("topup", {}, { cookie });
  assert.equal(full.status, 400);
  assert.match(full.body.error, /this month's 3 top-ups/);
  assert.equal(stripeCalls.length, calls, "nothing reaches Stripe");

  delete env.SITE_FEATURES;
  try {
    assert.equal((await post("topup", {}, { cookie })).status, 503);
  } finally { env.SITE_FEATURES = "plans"; }
});

test("once the day's free answers are gone, the next comes out of a top-up, past the shared budget", async () => {
  const { user, ask } = await freePlayer("topper");
  await addPack(user, "cs_1");
  await usedToday(user, "companion-answer", 20);
  env.STORY_BUDGET_USD = "0";   // the shared budget is spent: a free answer would get a 429 now
  try {
    const res = await ask();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.allowance.topup.remaining, 299);
    assert.equal(res.body.allowance.remaining, 199, "the companion keeps asking while top-up answers are left, within 200 a day");
  } finally { delete env.STORY_BUDGET_USD; }
  const [pack] = packs(user);
  assert.equal(pack.remaining, 299);
  assert.ok(pack.spent_micro > 0, "the pack counts what its answers cost");
  const spend = env.DB.sqlite.prepare("SELECT micro, topup_micro FROM answer_user_spend WHERE user_id = ?").get(user.id);
  assert.deepEqual([spend.micro, spend.topup_micro], [pack.spent_micro, pack.spent_micro],
    "counted as paid for, so the shared budget leaves it out, and kept apart from a plan's cost cap");
});

test("a full shared budget falls back to the player's top-up, and a failed answer gives its top-up answer back", async () => {
  const { user, ask } = await freePlayer("budget");
  await addPack(user, "cs_1");
  env.STORY_BUDGET_USD = "0";   // free answers are left today, but the shared budget is spent
  try {
    assert.equal((await ask()).status, 200, "answered from the top-up instead of 'at capacity'");
    assert.equal(packs(user)[0].remaining, 299);
    const working = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ error: { message: "overloaded" } }, { status: 503 });
    try { assert.equal((await ask()).status, 502); } finally { globalThis.fetch = working; }
    assert.equal(packs(user)[0].remaining, 299, "the failed answer's top-up answer came back");
  } finally { delete env.STORY_BUDGET_USD; }
});

test("out of answers: the 429 offers Hero and a top-up to a free player, nothing with plans off or past 200 a day", async () => {
  const { user, ask } = await freePlayer("broke");
  await usedToday(user, "companion-answer", 20);
  const out = await ask();
  assert.equal(out.status, 429);
  assert.equal(out.body.error, "You've used today's 20 live answers. They come back tomorrow. " +
    "Top-ups and plans are on loreforeverwow.com/plans.");
  assert.deepEqual(out.body.offers, [
    { id: "hero", text: "Get Hero: 900 answers a month", url: "/plans" },
    { id: "topup", text: "Top-up: 300 answers for $2.99", url: "/plans#topup" }]);

  // With plans off, the 20 free answers a day and nothing for sale: a pack waits, untouched.
  await addPack(user, "cs_1");
  delete env.SITE_FEATURES;
  try {
    await usedToday(user, "companion-answer", 20);
    const off = await ask();
    assert.equal(off.status, 429);
    assert.equal(off.body.offers, undefined);
    assert.equal(off.body.error, "You've used today's 20 free answers. They come back tomorrow.", "as before plans");
  } finally { env.SITE_FEATURES = "plans"; }
  assert.equal(packs(user)[0].remaining, 300);

  // 200 live answers today in all: no more, whatever is left in the pack.
  await usedToday(user, "companion-day", 200);
  const most = await ask();
  assert.equal(most.status, 429);
  assert.equal(most.body.error, "That's the most live answers for one day. They come back tomorrow.");
  assert.equal(most.body.offers, undefined);
  assert.equal(packs(user)[0].remaining, 300);
  assert.equal(gemini.length, 0);
});

test("top-up answers come out of the oldest pack first, and past $1.50 a pack's research questions get ordinary answers", async () => {
  // Hero, past the day's 100: a free player's answers never look online, top-up or not.
  const { user, ask } = await companionPlayer("scholar", { plan: "hero" });
  await addPack(user, "cs_old", { remaining: 1, spent: 1_500_000, daysAgo: 5 });
  await addPack(user, "cs_new");
  await usedToday(user, "companion-answer", 100);
  assert.equal((await ask({ research_required: true })).status, 200);
  assert.equal(gemini[0].body.tools, undefined, "the old pack is past its cap: no web search");
  assert.match(gemini[0].url, /gemini-3\.1-flash-lite:generateContent$/);
  assert.equal((await ask({ research_required: true })).status, 200);
  assert.deepEqual(gemini[1].body.tools, [{ googleSearch: {} }], "the new pack is under it");
  assert.deepEqual(packs(user).map(p => [p.id, p.remaining]), [["cs_old", 0], ["cs_new", 299]]);
});

// ---- The launch plans (Mike, 2026-10-12) ----

test("free with plans on: 20 a day, then the 30-answer starter, once per Google account, then a 429 with offers", async () => {
  const { user, ask } = await companionPlayer("newcomer");
  const first = await allowance(env, user.id);
  assert.deepEqual([first.limit, first.remaining], [20, 50], "the day's 20 and the starter");
  for (let i = 0; i < 50; i++) assert.equal((await ask()).status, 200, `answer ${i + 1}`);
  assert.deepEqual(starterLeft(user), [0]);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_user_spend").get().n, 0,
    "starter answers are free: none of their cost is the player's");
  const out = await ask();
  assert.equal(out.status, 429);
  assert.match(out.body.error, /^You've used today's 20 live answers\./);
  assert.deepEqual(out.body.offers.map(o => o.id), ["hero", "topup"]);
  assert.equal(gemini.length, 50);
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
  assert.equal((await allowance(env, again.user.id)).remaining, 20, "today's 20, and no starter");
});

test("starter answers wait for the shared budget like free ones, and one that can't be answered goes back", async () => {
  const { user, ask } = await companionPlayer("thrifty");
  await usedToday(user, "companion-answer", 20);
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

test("free answers stay with the lore: no looking online, no game picture, and the LORE FOCUS block", async () => {
  const { ask } = await companionPlayer("lorekeeper");
  const required = await ask({ research_required: true, persona: "willo", style: "spoken", image: jpeg });
  assert.equal(required.status, 200, JSON.stringify(required.body));
  assert.equal(required.body.looked_up, "no");
  const auto = await ask({ research: "auto", persona: "willo", style: "spoken", image: jpeg });
  assert.equal(auto.status, 200);
  assert.equal(gemini.length, 2, "no quick look online before either");
  for (const { url, body } of gemini) {
    assert.match(url, /gemini-3\.1-flash-lite:generateContent$/);
    assert.equal(body.tools, undefined);
    assert.equal(body.contents[0].parts.length, 1, "the picture isn't sent");
    const system = body.systemInstruction.parts[0].text;
    assert.match(system, /LORE FOCUS: answer from the world's lore and story/);
    assert.match(system, /Willo says this answer out loud/, "Willo still speaks");
  }
});

test("Champion answers on the ordinary model with a longer chat memory: no stronger mind at launch", async () => {
  const { ask } = await companionPlayer("champ", { plan: "champion" });
  const said = await ask();
  assert.equal(said.status, 200, JSON.stringify(said.body));
  assert.equal(said.body.model, ANSWER_MODEL);
  assert.match(gemini[0].url, /gemini-3\.1-flash-lite:generateContent$/);
  assert.equal((await ask({ operation: "compact", prompt: "PREVIOUS MEMORY\nPepper" })).status, 200);
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
  await used(850);
  const late = await allowance(env, user.id);
  assert.deepEqual([late.period, late.limit, late.remaining, late.resetsAt], ["month", 900, 50, "2026-10-31T00:00:00.000Z"]);
  await used(900);
  const out = await ask();
  assert.equal(out.status, 429);
  assert.match(out.body.error, /^You've used this month's 900 live answers\. They come back on October 31\./);
  assert.equal(gemini.length, 0);
  await addPack(user, "cs_more");
  const topped = await allowance(env, user.id);
  assert.deepEqual([topped.period, topped.topup], ["month", { remaining: 300, active: true }],
    "the month's answers are gone, so answers come from the top-up");

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
function stripeSetup(args, keys) {
  const blocked = "data:text/javascript,globalThis.fetch=async()=>{throw new Error('no network in tests')}";
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
