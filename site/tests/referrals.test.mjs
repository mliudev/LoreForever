// Inviting friends and the creator program (lib/referrals.js). The rules that guard money and abuse: a friend counts
// only once Willo has given them a first real answer, once per Google account, never from the inviter's computer,
// browser or card; every second friend gives a free month (one a calendar month) and the fifth of each ten bonus
// answers, each once (a Stripe credit for a paying plan, a month on us for a free one), at most ten a month; a creator
// earns their tier's share (60% rising to 90%) of a subscriber's first payment without tax, during their term only,
// payable after the hold, taken back on a refund, paid once; they get Champion free for the term; and their audience
// gets 15% off its first month with the creator's link or code. Stripe and Gemini are mocked through
// fetch; D1 is node:sqlite (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { onRequestGet as shareLink } from "../functions/w/[code].js";
import { onRequest as device } from "../functions/api/device/[action].js";
import { onRequest as billing } from "../functions/api/billing/[action].js";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { onRequest as creatorsPage } from "../functions/api/creators/[action].js";
import { findOrCreateUser, startSession, setup, deleteUser } from "../lib/accounts.js";
import { startLink, claimToken } from "../lib/devices.js";
import { setupBilling, planFor } from "../lib/billing.js";
import { bonusAnswersFor, setupReferrals, shareCode, saveCreator, referralReport, shareSummary, noteJoin, noteBrowser, activateReferral,
  settleRewards, payoutList, payCreator, retireCreator, applyCreator, decideApplication, REWARDS, PAYOUTS, CREATOR_TIERS,
  CREATOR_TERM } from "../lib/referrals.js";

import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const NOW = Date.parse("2026-10-16T12:00:00Z");
const DAY = 86400;
const env = { DB: d1(), GEMINI_API_KEY: "test-key", STRIPE_SECRET_KEY: "sk_test_123", STRIPE_WEBHOOK_SECRET: "whsec_test",
              SITE_FEATURES: "plans" };
const originalFetch = globalThis.fetch;
let stripeCalls, subscriptions, invoices, routes;

beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  await setup(env);
  await setupBilling(env);
  await setupReferrals(env);
  for (const table of ["users", "sessions", "devices", "device_links", "rate_limits", "answer_spend", "free_pool_days", "answer_days",
                       "entitlements", "billing_events", "answer_user_spend", "answer_packs", "starter_claims",
                       "promo_claims", "share_codes", "referrals", "creators", "creator_earnings", "referral_rewards",
                       "plan_grants", "creator_applications", "creator_payouts", "browser_seen"])
    env.DB.sqlite.exec(`DELETE FROM ${table}`);
  env.DB.sqlite.exec("DELETE FROM referral_settings WHERE key != 'schema'");
  stripeCalls = [];
  subscriptions = {};
  invoices = {};
  routes = {};
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    if (u.hostname === "generativelanguage.googleapis.com")
      return Response.json({ candidates: [{ content: { parts: [{ text: "Mild Spices are sold in Goldshire." }] } }],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40 } });
    const call = { method: options.method, path: u.pathname.replace("/v1/", ""), query: u.searchParams,
                   body: new URLSearchParams(options.body || ""), key: options.headers?.["Idempotency-Key"] };
    stripeCalls.push(call);
    const route = `${call.method} ${call.path}`;
    if (routes[route]) return routes[route](call);
    if (route === "POST coupons") return Response.json({ id: call.body.get("id") });
    if (route === "GET prices") return Response.json({ data: [{ id: "price_hero_m", lookup_key: "hero_monthly" }] });
    if (route === "POST customers") return Response.json({ id: `cus_${stripeCalls.filter(c => c.path === "customers" && c.method === "POST").length}` });
    if (route === "GET customers") return Response.json({ data: [] });
    if (route === "GET subscriptions" || route === "GET checkout/sessions") return Response.json({ data: [] });
    if (route === "POST checkout/sessions") return Response.json({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
    if (route === "GET invoice_payments") return Response.json({ data: [] });
    if (call.method === "GET" && subscriptions[call.path.replace("subscriptions/", "")])
      return Response.json(subscriptions[call.path.replace("subscriptions/", "")]);
    if (call.method === "GET" && invoices[call.path.replace("invoices/", "")])
      return Response.json(invoices[call.path.replace("invoices/", "")]);
    return Response.json({ error: { message: `No such route: ${route}` } }, { status: 404 });
  };
});
afterEach((t) => { globalThis.fetch = originalFetch; t.mock.timers.reset(); });

let made = 0;
const player = (sub, email = `${sub}@example.com`) => findOrCreateUser(env, { email, googleSub: sub, name: sub });
const session = async user => (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
const browser = id => `lf_b=${id.padStart(32, "0")}`;
const machine = n => String(n).padStart(32, "a");

// Opening /w/<code>: where it goes and the cookie it leaves.
async function open(code) {
  const res = await shareLink({ request: new Request(`${ORIGIN}/w/${code}`), env, params: { code }, waitUntil: p => p });
  return { to: res.headers.get("Location"), cookie: (res.headers.get("Set-Cookie") || "").split(";")[0] };
}
// A new account signing in on the site in a browser with these cookies (functions/api/auth/[action].js google).
async function signUp(sub, cookies = "", email) {
  const user = await player(sub, email);
  const request = new Request(ORIGIN, { headers: { Cookie: cookies } });
  await noteBrowser(env, request, user.id);
  await noteJoin(env, request, user);
  return user;
}
// The account connects Willo on /link, in a browser with these cookies, as the page does: Willo's token.
async function connect(user, cookies = "") {
  const link = await startLink(env);
  const request = new Request(`${ORIGIN}/api/device/approve`, { method: "POST", body: JSON.stringify({ code: link.user_code }),
    headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: [await session(user), cookies].filter(Boolean).join("; ") } });
  const res = await device({ request, env, params: { action: "approve" } });
  assert.equal(res.status, 200);
  return (await claimToken(env, link.device_code)).token;
}
// A question to Willo through the real endpoint, from a computer.
async function ask(token, computer = null) {
  const res = await answer({ env, request: new Request(ORIGIN + "/api/companion/answer", { method: "POST",
    headers: { "X-LF-Client": "companion/0.21.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json",
               ...(computer ? { "X-LF-Machine": computer } : {}) },
    body: JSON.stringify({ prompt: "QUESTION\nWhere can I buy Mild Spices?" }) }) });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body;
}
// A friend who joined with the cookie and had their first answer, from their own computer (activateReferral directly),
// now or at `at`.
async function friend(cookie, n = ++made, at = undefined) {
  const user = await signUp(`friend-${n}`, `${cookie}; ${browser(`f${n}`)}`);
  const sent = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lf-machine:${machine(n)}`));
  await activateReferral(env, { userId: user.id, machine: [...new Uint8Array(sent)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32) }, at);
  return user;
}
const summary = user => shareSummary(env, user.id, ORIGIN);
const row = user => env.DB.sqlite.prepare("SELECT * FROM referrals WHERE user_id = ?").get(user.id);
const paying = (user, plan = "hero", extra = {}) => env.DB.prepare("INSERT INTO entitlements (user_id, customer_id, " +
  "subscription_id, plan, status, current_period_end, cancel_at_period_end, updated) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)")
  .bind(user.id, extra.customer || `cus_${user.id.slice(0, 6)}`, `sub_${user.id.slice(0, 6)}`, plan,
    new Date(NOW + 20 * DAY * 1000).toISOString(), extra.cancelling ? 1 : 0, new Date(NOW).toISOString()).run();

test("a friend counts after Willo's first real answer, not on the click or the connect; once per Google account", async () => {
  const sharer = await player("sharer");
  const code = await shareCode(env, sharer.id);
  const { to, cookie } = await open(code);
  assert.equal(to, `${ORIGIN}/willo?shared=${code}`);
  assert.match(cookie, new RegExp(`^lf_share=${code}$`));

  const pal = await signUp("pal", cookie);
  let s = await summary(sharer);
  assert.deepEqual([s.joined, s.waiting, s.progress.have], [1, 1, 0], "joined, not counted");
  const token = await connect(pal, cookie);
  assert.equal((await summary(sharer)).progress.have, 0, "connecting Willo isn't enough");
  await ask(token, machine(1));
  s = await summary(sharer);
  assert.deepEqual([s.joined, s.waiting, s.progress.have, s.progress.left], [1, 0, 1, 1]);
  assert.equal(s.tally, "1 / 2 friends joined — 1 more until a free month of Hero.");
  assert.equal(s.invite, "Invite a friend to awaken their Willo");
  assert.match(s.about, new RegExp(`Every 2 friends: a free month of Hero, one a month\\. Your 5th, 15th, 25th friend and so on: ` +
    `${bonusAnswersFor("free")} bonus answers\\.`));
  assert.doesNotMatch(s.about, /\b10\b|Up to/, "no 'up to 10' on the card: a free month is 2 friends (Mike, 10/21)");
  assert.ok(row(pal).machine, "Willo's computer noted, one-way");

  // The same Google account again, after Delete my account: not a second friend.
  await deleteUser(env, pal);
  await signUp("pal", cookie);
  assert.equal((await summary(sharer)).joined, 1);
  // Not the sharer's own link, and not an account that had Willo already.
  assert.equal(await noteJoin(env, new Request(ORIGIN, { headers: { Cookie: cookie } }), sharer), null);
  const veteran = await player("veteran");
  await connect(veteran);
  await connect(veteran, cookie);
  assert.equal(row(veteran), undefined);
  // Someone who already had an account but never used Willo joins at their first connect.
  const late = await player("late");
  await ask(await connect(late, cookie), machine(2));
  s = await summary(sharer);
  assert.deepEqual([s.progress.friends, s.progress.have, s.progress.months], [2, 0, 1], "two friends: a free month");
});

test("every second friend gives a free Hero month, one a calendar month; every friend counts for the fifth's bonus; the eleventh waits", async () => {
  const sharer = await player("sharer");
  const { cookie } = await open(await shareCode(env, sharer.id));
  await friend(cookie);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM referral_rewards").get().n, 0);
  await friend(cookie);
  let grants = env.DB.sqlite.prepare("SELECT * FROM plan_grants WHERE user_id = ? ORDER BY starts").all(sharer.id);
  assert.equal(grants.length, 1);
  assert.equal(grants[0].plan, "hero");
  assert.equal(Date.parse(grants[0].ends) - Date.parse(grants[0].starts), 30 * DAY * 1000);
  const plan = await planFor(env, sharer.id);
  assert.deepEqual([plan.id, plan.reward, plan.unlimited], ["hero", true, true]);
  let s = await summary(sharer);
  assert.equal(s.tally, "0 / 2 friends joined. This month's free month is yours: friends who join from November 1 move " +
    "the next one on, and until then they still count toward bonus answers.");
  assert.equal(s.rewards.find(r => r.kind === "month").text.startsWith("A free month of Hero, October 16 to November 15"), true);
  await settleRewards(env, sharer.id);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM plan_grants").get().n, 1, "once");

  // The third to the tenth this month: no second month, but the fifth's bonus.
  for (let i = 0; i < 3; i++) await friend(cookie);
  const bonus = env.DB.sqlite.prepare("SELECT * FROM answer_packs WHERE user_id = ? AND kind = 'share'").all(sharer.id);
  assert.deepEqual(bonus.map(p => [p.id, p.answers]), [[`bonus:${sharer.id}:0`, bonusAnswersFor("hero")]],
    "the bonus, though Hero's answers are unlimited: it keeps for a later free month");
  for (let i = 0; i < 5; i++) await friend(cookie);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM plan_grants").get().n, 1, "one free month a calendar month");
  s = await summary(sharer);
  assert.deepEqual([s.progress.friends, s.progress.toward, s.progress.months], [10, 2, 1]);
  assert.match(s.earned, new RegExp(`1 free month and ${bonusAnswersFor("hero")} bonus answers`));

  // The eleventh this month joins but doesn't count until next month.
  const eleventh = await friend(cookie);
  assert.equal(row(eleventh).counted, 0);
  s = await summary(sharer);
  assert.equal(s.progress.friends, 10);
  assert.match(s.tally, /That's this month's 10; friends who join from November 1 count again/);

  // November: its second friend gives the next month, after the first.
  const nov = new Date("2026-11-02T12:00:00Z");
  await friend(cookie, undefined, nov);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM plan_grants").get().n, 1);
  assert.match((await shareSummary(env, sharer.id, ORIGIN, nov)).tally, /^1 \/ 2 friends joined — 1 more until/);
  await friend(cookie, undefined, nov);
  grants = env.DB.sqlite.prepare("SELECT * FROM plan_grants WHERE user_id = ? ORDER BY starts").all(sharer.id);
  assert.equal(grants.length, 2);
  assert.equal(grants[1].starts, grants[0].ends, "the second month starts when the first ends");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_packs WHERE kind = 'share'").get().n, 1);
});

test("players partway under the old ten get this month's free month at their next settle, once, however often it runs", async () => {
  const three = await player("three"), seven = await player("seven");
  const old = REWARDS.monthAt;
  REWARDS.monthAt = 10;
  try {
    const a = (await open(await shareCode(env, three.id))).cookie, b = (await open(await shareCode(env, seven.id))).cookie;
    for (let i = 0; i < 3; i++) await friend(a);
    for (let i = 0; i < 7; i++) await friend(b);
  } finally { REWARDS.monthAt = old; }
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM plan_grants").get().n, 0, "nothing under the old ten");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM referral_rewards WHERE kind = 'month'").get().n, 0);

  // The share card's next look (or the next friend) settles: two at once, and again after, give each month once.
  await Promise.all([summary(three), settleRewards(env, three.id), settleRewards(env, seven.id), summary(seven)]);
  await settleRewards(env, three.id);
  await settleRewards(env, seven.id);
  const months = id => env.DB.sqlite.prepare("SELECT id, status FROM referral_rewards WHERE user_id = ? AND kind = 'month' " +
    "ORDER BY cycle").all(id).map(r => `${r.id.split(":")[2]} ${r.status}`);
  assert.deepEqual(months(three.id), ["1 applied"], "3 friends: one month");
  assert.deepEqual(months(seven.id), ["1 applied"], "7 friends this month: still one month");
  const grants = id => env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM plan_grants WHERE user_id = ?").get(id).n;
  assert.deepEqual([grants(three.id), grants(seven.id)], [1, 1]);
  const s = await summary(three);
  assert.deepEqual([s.progress.friends, s.progress.months], [3, 1]);
  assert.match(s.tally, /This month's free month is yours/);
  assert.match(s.earned, /1 free month/);
});

test("a paying player's free month is a Stripe credit as big as their next charge, made once even when Stripe fails first", async () => {
  const sharer = await player("sharer");
  await paying(sharer, "champion", { customer: "cus_s" });
  let fail = true;
  routes["POST invoices/create_preview"] = () => Response.json({ total: 999, amount_due: 0 });
  routes["POST customers/cus_s/balance_transactions"] = () => fail
    ? Response.json({ error: { message: "Stripe is down" } }, { status: 500 }) : Response.json({ id: "cbtxn_1" });
  const { cookie } = await open(await shareCode(env, sharer.id));
  for (let i = 0; i < REWARDS.monthAt; i++) await friend(cookie);
  let reward = env.DB.sqlite.prepare("SELECT * FROM referral_rewards WHERE kind = 'month'").get();
  assert.equal(reward.status, "failed");

  fail = false;
  env.DB.sqlite.prepare("UPDATE referral_rewards SET tried = '2026-01-01T00:00:00.000Z'").run();
  const s = await summary(sharer);   // the share card tries again
  reward = env.DB.sqlite.prepare("SELECT * FROM referral_rewards WHERE kind = 'month'").get();
  assert.deepEqual([reward.status, reward.method, reward.cents, reward.stripe_id], ["applied", "credit", 999, "cbtxn_1"]);
  const credits = stripeCalls.filter(c => c.path === "customers/cus_s/balance_transactions");
  assert.equal(credits.length, 2);
  assert.ok(credits.every(c => c.key === `lf-reward-month:${sharer.id}:1` && c.body.get("amount") === "-999"),
    "one idempotency key for every try");
  assert.equal(s.rewards.find(r => r.kind === "month").text, "A free month of Champion: $9.99 off your next bill");
  assert.match(s.about, /your next month of Champion free, as a credit on your bill/);
  await settleRewards(env, sharer.id);
  assert.equal(stripeCalls.filter(c => c.path === "customers/cus_s/balance_transactions").length, 2, "applied: no more tries");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM referral_rewards").get().n, 1, "one month, no bonus yet");
});

test("the inviter's computer or browser, another friend's computer and throwaway addresses don't count", async () => {
  const sharer = await player("sharer");
  const { cookie } = await open(await shareCode(env, sharer.id));
  // The inviter's own Willo, on their computer.
  const mine = await connect(sharer);
  await ask(mine, machine(7));
  const same = await signUp("alt", cookie);
  await ask(await connect(same, cookie), machine(7));
  assert.equal(row(same).void, "inviter's computer");

  const first = await signUp("first", cookie), second = await signUp("second", cookie);
  await ask(await connect(first, cookie), machine(8));
  await ask(await connect(second, cookie), machine(8));
  assert.equal(row(first).void, null);
  assert.equal(row(second).void, "computer of another friend");

  await noteBrowser(env, new Request(ORIGIN, { headers: { Cookie: browser("beef") } }), sharer.id);
  const couch = await signUp("couch", `${cookie}; ${browser("beef")}`);
  assert.equal(row(couch).void, "inviter's browser");
  const temp = await signUp("temp", cookie, "x1@mailinator.com");
  assert.equal(row(temp).void, "throwaway address");
  await ask(await connect(temp, cookie), machine(9));
  assert.equal(row(temp).activated, null, "a void friend is never activated");

  const s = await summary(sharer);
  assert.deepEqual([s.joined, s.progress.friends], [1, 1], "only the one real friend");
  const report = await referralReport(env, ORIGIN);
  assert.deepEqual(Object.fromEntries(report.voids.map(v => [v.why, v.n])),
    { "inviter's computer": 1, "computer of another friend": 1, "inviter's browser": 1, "throwaway address": 1 });
});

const sign = body => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex")}`;
};
async function hook(event) {
  const body = JSON.stringify(event);
  const res = await billing({ env, params: { action: "webhook" }, request: new Request(ORIGIN + "/api/billing/webhook",
    { method: "POST", headers: { "Stripe-Signature": sign(body), "Content-Type": "application/json" }, body }) });
  assert.equal(res.status, 200);
}
// A paid invoice of the customer's subscription for the days from `from` to `to` (days from now).
function paidInvoice(id, customer, from, to, { amount = 499, tax = 0, discounts = [], pi = `pi_${id}` } = {}) {
  subscriptions[`sub_${customer}`] = { id: `sub_${customer}`, customer, status: "active", metadata: {},
    items: { data: [{ current_period_end: NOW / 1000 + to * DAY, price: { id: "price_hero_m", lookup_key: "hero_monthly" } }] } };
  invoices[id] = { id, payments: pi };
  return { id: `evt_${id}`, type: "invoice.paid", livemode: false, data: { object: { id, object: "invoice", customer,
    amount_paid: amount, total_taxes: tax ? [{ amount: tax }] : [], discounts, status_transitions: { paid_at: NOW / 1000 + from * DAY },
    lines: { data: [{ period: { start: NOW / 1000 + from * DAY, end: NOW / 1000 + to * DAY } }] },
    parent: { subscription_details: { subscription: `sub_${customer}` } } } } };
}
// Which invoice a payment paid, and the card it was paid with, as Stripe says.
function payments(cards = {}) {
  routes["GET invoice_payments"] = call => {
    const pi = call.query.get("payment[payment_intent]"), inv = call.query.get("invoice");
    const id = inv || Object.keys(invoices).find(k => invoices[k].payments === pi);
    return Response.json({ data: id ? [{ invoice: id, payment: { payment_intent: invoices[id].payments } }] : [] });
  };
  for (const [pi, print] of Object.entries(cards)) routes[`GET payment_intents/${pi}`] = () =>
    Response.json({ id: pi, latest_charge: { payment_method_details: { card: { fingerprint: print } } } });
}

// The creator's Stripe promotion code, as Stripe makes it.
const promoCodes = () => { routes["POST promotion_codes"] = call =>
  Response.json({ id: `promo_${call.body.get("code").toLowerCase()}`, code: call.body.get("code"), active: true }); };

// Days from NOW (10/16) to the first day of the agreement's term, and a creator's term as /admin sets it.
const TERM_DAY = (Date.parse(`${CREATOR_TERM.start}T00:00:00Z`) - NOW) / (DAY * 1000);
const creatorsApi = async (user, action, body) => creatorsPage({ env, params: { action }, request: new Request(`${ORIGIN}/api/creators/${action}`,
  body ? { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: await session(user) } }
    : { headers: { Cookie: await session(user) } }) }).then(r => r.json());

test("a creator earns 60% of a Conversion's first payment, without tax; upgrades and renewals earn nothing; paid once, after the hold", async () => {
  const owner = await player("ziqo-owner", "ziqo@example.com");
  promoCodes();
  const saved = await saveCreator(env, { code: "Ziqo", name: "Ziqo", account: "ziqo@example.com" });
  assert.deepEqual([saved.creator.code, saved.creator.share_pct, saved.creator.discount, saved.creator.gift, saved.creator.user_id],
    ["ziqo", CREATOR_TIERS[0].pct, 15, 0, owner.id], "the deal: 60% to start, 15% off for fans");
  assert.equal(saved.creator.term_start, CREATOR_TERM.start, "the agreement's start date");
  // Their code for the audience: 15% off a first month, once, first payment only.
  const coupon = stripeCalls.find(c => c.method === "POST" && c.path === "coupons").body;
  assert.deepEqual([coupon.get("id"), coupon.get("percent_off"), coupon.get("duration")], ["lore_forever_creator_15", "15", "once"]);
  const promo = stripeCalls.find(c => c.path === "promotion_codes").body;
  assert.deepEqual([promo.get("code"), promo.get("restrictions[first_time_transaction]"), promo.get("metadata[creator]")],
    ["ZIQO", "true", "ziqo"]);
  assert.equal(saved.creator.promo_id, "promo_ziqo");

  const { cookie } = await open("ziqo");
  const fan = await signUp("fan", cookie);
  await ask(await connect(fan, cookie), machine(3));
  assert.ok(row(fan).activated);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_packs WHERE kind = 'share'").get().n, 0, "no gift");
  const res = await billing({ env, params: { action: "checkout" }, request: new Request(ORIGIN + "/api/billing/checkout", {
    method: "POST", body: JSON.stringify({ plan: "hero" }),
    headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: await session(fan) } }) });
  assert.equal(res.status, 200);
  const checkout = stripeCalls.find(c => c.method === "POST" && c.path === "checkout/sessions").body;
  assert.equal(checkout.get("subscription_data[metadata][creator]"), "ziqo");
  assert.equal(checkout.get("discounts[0][promotion_code]"), "promo_ziqo", "their link takes the 15% off");

  payments();
  const customer = env.DB.sqlite.prepare("SELECT customer_id FROM entitlements WHERE user_id = ?").get(fan.id).customer_id;
  // In the term: the first payment (Legend, tax left out), sent twice, an upgrade within the month, then the renewal.
  const first = TERM_DAY + 2;
  await hook(paidInvoice("in_m1", customer, first, first + 31, { amount: 2199, tax: 200 }));
  await hook(paidInvoice("in_m1", customer, first, first + 31, { amount: 2199, tax: 200 }));
  await hook(paidInvoice("in_up", customer, first + 10, first + 31, { amount: 300 }));
  await hook(paidInvoice("in_m2", customer, first + 31, first + 61, { amount: 999 }));
  const earned = env.DB.sqlite.prepare("SELECT invoice_id, paid_cents, share_cents, pct FROM creator_earnings ORDER BY paid_at").all()
    .map(r => ({ ...r }));
  assert.deepEqual(earned, [{ invoice_id: "in_m1", paid_cents: 1999, share_cents: 1199, pct: 60 }]);

  // The creator gives their PayPal email on their dashboard; until then the list says nothing about where to send it.
  assert.match((await creatorsApi(owner, "payout", { method: "paypal", email: "" })).error, /PayPal/);
  assert.equal((await creatorsApi(owner, "payout", { method: "paypal", email: "Ziqo@Example.com" })).ok, true);

  // In the hold: nothing due yet. After it: one payout, for the cycle that ended, once.
  const at = days => new Date(NOW + days * DAY * 1000);
  assert.equal((await payoutList(env, at(first + 20))).due.length, 0);
  const later = at(first + PAYOUTS.holdDays + 5);
  const list = await payoutList(env, later);
  assert.deepEqual(list.due.map(d => [d.code, d.due, d.payout.method, d.payout.email, d.taxForm, d.cycle.n]),
    [["ziqo", 1199, "paypal", "ziqo@example.com", null, 1]]);
  const paid = await payCreator(env, "ziqo", { note: "PayPal 5TY123", now: later });
  assert.deepEqual([paid.payout.cents, paid.payout.items, paid.payout.status, paid.payout.cycle], [1199, 1, "paid", 1]);
  assert.match((await payCreator(env, "ziqo", { now: later })).error, /Nothing is due/);

  // A refund after the payout comes off the next one, and the Conversion no longer counts.
  await hook({ id: "evt_refund", type: "charge.refunded", livemode: false,
    data: { object: { id: "ch_1", object: "charge", payment_intent: "pi_in_m1", refunded: true, amount_refunded: 2199 } } });
  assert.equal((await referralReport(env, ORIGIN, later)).ledger.find(e => e.invoice_id === "in_m1").state, "reversed after payout");
  assert.equal((await payoutList(env, later)).held.find(h => h.code === "ziqo"), undefined, "owed less than nothing: not on the list");
  const dash = (await creatorsApi(owner, "me")).creator;
  assert.deepEqual([dash.numbers.clicks, dash.numbers.signups, dash.numbers.activated, dash.numbers.paying, dash.numbers.conversions,
                    dash.numbers.earned, dash.numbers.paidOut, dash.numbers.reversed], [1, 1, 1, 1, 0, 0, 1199, 1199]);
  assert.deepEqual([dash.promoCode, dash.terms.discount, dash.payouts.method, dash.payouts.email], ["ZIQO", 15, "paypal", "ziqo@example.com"]);
  assert.deepEqual([dash.tier.pct, dash.tier.next.pct, dash.tier.next.more], [CREATOR_TIERS[0].pct, CREATOR_TIERS[1].pct, CREATOR_TIERS[1].from]);
});

test("anyone may type a creator's code at checkout: the subscriber is the creator's, and earns them 60%", async () => {
  promoCodes();
  await saveCreator(env, { code: "ziqo", name: "Ziqo" });
  const viewer = await typed("ziqo", "viewer", TERM_DAY + 1);
  assert.deepEqual([row(viewer).creator, row(viewer).via], ["ziqo", "code"]);
  const earned = env.DB.sqlite.prepare("SELECT creator, paid_cents, share_cents, pct FROM creator_earnings").get();
  assert.deepEqual({ ...earned }, { creator: "ziqo", paid_cents: 424, share_cents: 254, pct: 60 });
});

// A subscriber who types the creator's code at checkout and pays Hero at 15% off (499 - 75, as Stripe charges it) on
// day `day` (days from now): their first payment.
async function typed(code, sub, day) {
  const viewer = await player(sub);
  await env.DB.prepare("INSERT INTO entitlements (user_id, customer_id, updated) VALUES (?, ?, ?)")
    .bind(viewer.id, `cus_${sub}`, new Date(NOW).toISOString()).run();
  payments();
  const promo = env.DB.sqlite.prepare("SELECT promo_id FROM creators WHERE code = ?").get(code).promo_id;
  routes[`GET invoices/in_${sub}`] = () => Response.json({ id: `in_${sub}`, discounts: [{ promotion_code: promo }] });
  await hook(paidInvoice(`in_${sub}`, `cus_${sub}`, day, day + 31, { amount: 424, discounts: ["di_1"] }));
  return viewer;
}

test("the tiers: the Conversion that reaches a step earns its rate, earlier ones keep theirs; only during the term", async () => {
  promoCodes();
  await saveCreator(env, { code: "ziqo", name: "Ziqo" });
  const day = TERM_DAY + 3;
  const pctOf = sub => env.DB.sqlite.prepare("SELECT pct FROM creator_earnings WHERE invoice_id = ?").get(`in_${sub}`)?.pct;
  // Before the term starts, a first payment earns nothing.
  await typed("ziqo", "early", TERM_DAY - 1);
  assert.equal(pctOf("early"), undefined);
  // The step below 65%: Conversions already made in the term.
  const step = CREATOR_TIERS[1];
  for (let n = 1; n < step.from - 1; n++)
    await env.DB.prepare("INSERT INTO creator_earnings (invoice_id, creator, paid_cents, share_cents, pct, paid_at, recorded, payable_at) " +
      "VALUES (?, 'ziqo', 424, 254, 60, ?, ?, ?)").bind(`in_seed_${n}`, new Date(NOW + day * DAY * 1000).toISOString(),
      new Date(NOW).toISOString(), new Date(NOW + (day + 30) * DAY * 1000).toISOString()).run();
  await typed("ziqo", "last-of-tier", day + 1);
  assert.equal(pctOf("last-of-tier"), CREATOR_TIERS[0].pct);
  await typed("ziqo", "reaches", day + 2);
  assert.equal(pctOf("reaches"), step.pct, "the 50th earns 65%");
  assert.equal(pctOf("last-of-tier"), CREATOR_TIERS[0].pct, "earlier ones keep theirs");
  const report = (await referralReport(env, ORIGIN)).creators.find(c => c.code === "ziqo");
  assert.deepEqual([report.conversions, report.tier.pct, report.tier.next.pct], [step.from, step.pct, CREATOR_TIERS[2].pct]);
  // After the last day of the term, a first payment earns nothing.
  const after = (Date.parse(`${report.term_end}T00:00:00Z`) - NOW) / (DAY * 1000) + 1;
  await typed("ziqo", "late", after);
  assert.equal(pctOf("late"), undefined);
});

// A creator with earnings rows of the given cents, past their hold (reversed: after they were paid out, clawed back).
async function owed(code, rows) {
  await env.DB.prepare("INSERT INTO creators (code, name, discount, share_pct, months, gift, created) VALUES (?, ?, 15, 60, 1, 0, ?)")
    .bind(code, code, new Date(NOW).toISOString()).run();
  let n = 0;
  for (const [cents, kind] of rows) {
    const paidOut = kind === "clawback" ? new Date(NOW - 20 * DAY * 1000).toISOString() : null;
    const reversed = kind === "clawback" ? new Date(NOW - 5 * DAY * 1000).toISOString() : null;
    await env.DB.prepare("INSERT INTO creator_earnings (invoice_id, creator, paid_cents, share_cents, pct, paid_at, recorded, " +
      "payable_at, paid_out, reversed) VALUES (?, ?, ?, ?, 60, ?, ?, ?, ?, ?)").bind(`in_${code}_${++n}`, code, cents, cents,
      new Date(NOW - 40 * DAY * 1000).toISOString(), new Date(NOW).toISOString(), new Date(NOW - 10 * DAY * 1000).toISOString(),
      paidOut, reversed).run();
  }
}
const earnings = code => env.DB.sqlite.prepare("SELECT payout_id, clawed FROM creator_earnings WHERE creator = ?").all(code);
const payouts = (code, status) => env.DB.sqlite.prepare("SELECT * FROM creator_payouts WHERE creator = ? AND status = ?").all(code, status);

test("a creator under the $10 minimum isn't paid: it's carried over, untied, and paid once there's enough", async () => {
  await owed("small", [[509]]);
  assert.equal((await payoutList(env)).due.length, 0, "not on the list");
  const refused = await payCreator(env, "small", { method: "manual" });
  assert.equal(refused.error, "Under $10.00 is carried to the next payout: small has $5.09 due.");
  assert.equal(refused.payout, undefined);
  assert.deepEqual(earnings("small").map(e => e.payout_id), [null], "still payable later");
  assert.equal(payouts("small", "paid").length, 0);
  assert.deepEqual(payouts("small", "failed").map(p => p.error), ["below minimum"]);
  // More arrives: now it is due, and the carried amount goes with it.
  await env.DB.prepare("INSERT INTO creator_earnings (invoice_id, creator, paid_cents, share_cents, pct, paid_at, recorded, " +
    "payable_at) VALUES ('in_small_more', 'small', 600, 600, 60, ?, ?, ?)").bind(new Date(NOW - 40 * DAY * 1000).toISOString(),
    new Date(NOW).toISOString(), new Date(NOW - 10 * DAY * 1000).toISOString()).run();
  assert.equal((await payoutList(env)).due[0].due, 1109);
  assert.equal((await payCreator(env, "small", { method: "manual" })).payout.cents, 1109);
});

test("exactly $10 is paid, and one cent under is not", async () => {
  await owed("edge", [[1000]]);
  await owed("short", [[999]]);
  assert.deepEqual((await payoutList(env)).due.map(d => d.code), ["edge"], "the list and the payout agree");
  assert.match((await payCreator(env, "short", { method: "manual" })).error, /Under \$10\.00 .* \$9\.99 due/);
  const { payout } = await payCreator(env, "edge", { method: "manual" });
  assert.deepEqual([payout.cents, payout.status], [1000, "paid"]);
});

test("a clawback that takes what's due under $10 is refused, and stays to be taken off later", async () => {
  await owed("clawed", [[1500], [600, "clawback"]]);
  assert.equal((await payoutList(env)).due.length, 0, "1500 less 600 is 900");
  assert.match((await payCreator(env, "clawed", { method: "manual" })).error, /Under \$10\.00 .* \$9\.00 due/);
  assert.equal(earnings("clawed").every(e => e.payout_id === null && e.clawed === null), true, "clawback not taken off yet");
  assert.equal(payouts("clawed", "paid").length, 0);
  // Reviewed amount too: the same refusal after the amount check.
  assert.match((await payCreator(env, "clawed", { method: "manual", expectedCents: 900 })).error, /Under \$10\.00/);
});

test("a subscriber who pays with the creator's own card brings them nothing", async () => {
  const owner = await player("ziqo-owner", "ziqo@example.com");
  await saveCreator(env, { code: "ziqo", name: "Ziqo", account: "ziqo@example.com" });
  await paying(owner, "hero", { customer: "cus_owner" });
  routes["GET customers/cus_owner/payment_methods"] = () => Response.json({ data: [{ card: { fingerprint: "fp_owner" } }] });
  const { cookie } = await open("ziqo");
  const sock = await signUp("sock", cookie);
  await ask(await connect(sock, cookie), machine(4));
  await env.DB.prepare("INSERT INTO entitlements (user_id, customer_id, updated) VALUES (?, 'cus_sock', ?)")
    .bind(sock.id, new Date(NOW).toISOString()).run();
  payments({ pi_in_s: "fp_owner" });
  await hook(paidInvoice("in_s", "cus_sock", 0, 30));
  assert.equal(row(sock).void, "inviter's card");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM creator_earnings").get().n, 0);
});

test("creators apply, /admin approves them with Champion free for the term, and ending the agreement stops new earnings and the plan", async () => {
  const fan = await player("lorenerd", "nerd@example.com");
  assert.match((await applyCreator(env, fan, { name: "Lore Nerd", channel: "youtube.com/nerd", agree: true })).error, /link/);
  assert.match((await applyCreator(env, fan, { name: "Lore Nerd", channel: "https://youtube.com/@nerd" })).error, /terms/);
  const { application } = await applyCreator(env, fan, { name: "Lore Nerd", channel: "https://youtube.com/@nerd", agree: true });
  assert.equal(application.status, "pending");
  promoCodes();
  const { creator } = await decideApplication(env, application.id, { approve: true });
  assert.deepEqual([creator.code, creator.user_id, creator.share_pct, creator.discount], ["lore-nerd", fan.id, 60, 15]);
  assert.equal((await planFor(env, fan.id)).id, "champion", "free Champion from the day they're in");
  const lastDay = new Date(Date.parse(`${creator.term_end}T12:00:00Z`));
  assert.equal((await planFor(env, fan.id, lastDay)).id, "champion", "through the term's last day");
  assert.equal((await planFor(env, fan.id, new Date(lastDay.getTime() + DAY * 1000))).id, "free", "and not after it");

  // /admin ends the agreement: the plan ends now, the link stops, and a first payment after that earns nothing; what
  // was earned before is still paid.
  const day = TERM_DAY + 2;
  await typed("lore-nerd", "before-end", day);
  await retireCreator(env, "lore-nerd", true, new Date(NOW + (day + 1) * DAY * 1000));
  assert.equal((await planFor(env, fan.id, new Date(NOW + (day + 2) * DAY * 1000))).id, "free");
  assert.equal((await open("lore-nerd")).cookie, "", "the link no longer brings anyone");
  await typed("lore-nerd", "after-end", day + 2);
  assert.deepEqual(env.DB.sqlite.prepare("SELECT invoice_id FROM creator_earnings").all().map(e => e.invoice_id), ["in_before-end"]);
  const later = new Date(NOW + (day + PAYOUTS.holdDays + 60) * DAY * 1000);
  await env.DB.prepare("UPDATE creator_earnings SET share_cents = 1200").run();
  assert.equal((await payCreator(env, "lore-nerd", { now: later })).payout.cents, 1200, "paid on the normal schedule after the end");
});
