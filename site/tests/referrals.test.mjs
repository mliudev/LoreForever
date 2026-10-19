// Inviting friends and the creator program (lib/referrals.js). The rules that guard money and abuse: a friend counts
// only once Willo has given them a first real answer, once per Google account, never from the inviter's computer,
// browser or card; the fifth friend gives bonus answers and the tenth a free month, each once (a Stripe credit for a
// paying plan, a month on us for a free one), at most ten a month; a creator earns 70% of a subscriber's first paid
// month without tax, payable after the hold, taken back on a refund, paid once. Stripe and Gemini are mocked through
// fetch; D1 is node:sqlite (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { onRequestGet as shareLink } from "../functions/w/[code].js";
import { onRequest as device } from "../functions/api/device/[action].js";
import { onRequest as billing } from "../functions/api/billing/[action].js";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { findOrCreateUser, startSession, setup, deleteUser } from "../lib/accounts.js";
import { startLink, claimToken } from "../lib/devices.js";
import { setupBilling, planFor } from "../lib/billing.js";
import { setupReferrals, shareCode, saveCreator, referralReport, shareSummary, noteJoin, noteBrowser, activateReferral,
  settleRewards, payoutList, payCreator, setStripePayouts, startConnect, refreshConnect, applyCreator, decideApplication,
  creatorDashboard, REWARDS, PAYOUTS } from "../lib/referrals.js";

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
  for (const table of ["users", "sessions", "devices", "device_links", "rate_limits", "answer_spend", "answer_days",
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
    if (route === "POST customers") return Response.json({ id: `cus_${stripeCalls.filter(c => c.path === "customers").length}` });
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
// A friend who joined with the cookie and had their first answer, from their own computer (activateReferral directly).
async function friend(cookie, n = ++made) {
  const user = await signUp(`friend-${n}`, `${cookie}; ${browser(`f${n}`)}`);
  const sent = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lf-machine:${machine(n)}`));
  await activateReferral(env, { userId: user.id, machine: [...new Uint8Array(sent)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32) });
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
  assert.deepEqual([s.joined, s.waiting, s.progress.have, s.progress.left], [1, 0, 1, 9]);
  assert.equal(s.tally, "1 / 10 friends joined — 9 more until a free month of Hero.");
  assert.equal(s.invite, "Invite a friend to awaken their Willo");
  assert.match(s.about, /5 friends: 300 bonus answers\. 10 friends: a free month of Hero\./);
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
  assert.equal((await summary(sharer)).progress.have, 2);
});

test("the fifth friend gives bonus answers and the tenth a free Hero month, each once; the eleventh in a month waits", async () => {
  const sharer = await player("sharer");
  const { cookie } = await open(await shareCode(env, sharer.id));
  for (let i = 0; i < 4; i++) await friend(cookie);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM referral_rewards").get().n, 0);
  await friend(cookie);
  const bonus = env.DB.sqlite.prepare("SELECT * FROM answer_packs WHERE user_id = ? AND kind = 'share'").all(sharer.id);
  assert.deepEqual(bonus.map(p => [p.id, p.answers]), [[`bonus:${sharer.id}:0`, 300]], "half the free plan's 600");
  await settleRewards(env, sharer.id);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_packs WHERE kind = 'share'").get().n, 1, "once");

  for (let i = 0; i < 5; i++) await friend(cookie);
  const grant = env.DB.sqlite.prepare("SELECT * FROM plan_grants WHERE user_id = ?").all(sharer.id);
  assert.equal(grant.length, 1);
  assert.equal(grant[0].plan, "hero");
  assert.equal(Date.parse(grant[0].ends) - Date.parse(grant[0].starts), 30 * DAY * 1000);
  const plan = await planFor(env, sharer.id);
  assert.deepEqual([plan.id, plan.reward, plan.answersPerMonth], ["hero", true, 900]);
  let s = await summary(sharer);
  assert.equal(s.tally.split(" —")[0], "0 / 10 friends joined");
  assert.match(s.earned, /1 free month and 300 bonus answers/);
  assert.equal(s.rewards.find(r => r.kind === "month").text.startsWith("A free month of Hero, October 16 to November 15"), true);

  // The eleventh this month joins but doesn't count until next month.
  const eleventh = await friend(cookie);
  assert.equal(row(eleventh).counted, 0);
  s = await summary(sharer);
  assert.equal(s.progress.friends, 10);
  assert.match(s.tally, /count again/);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM plan_grants").get().n, 1);
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
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_packs WHERE kind = 'share'").get().n, 1,
    "and the fifth's bonus");
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

test("a creator earns 70% of a subscriber's first paid month, without tax; later months are ours; paid once, after the hold", async () => {
  const owner = await player("ziqo-owner", "ziqo@example.com");
  const saved = await saveCreator(env, { code: "Ziqo", name: "Ziqo", account: "ziqo@example.com" });
  assert.deepEqual([saved.creator.code, saved.creator.share_pct, saved.creator.months, saved.creator.discount, saved.creator.gift,
                    saved.creator.user_id], ["ziqo", 70, 1, 0, 0, owner.id], "Patrick's terms, no fan discount by default");
  assert.equal(stripeCalls.filter(c => c.path === "promotion_codes").length, 0);

  const { cookie } = await open("ziqo");
  const fan = await signUp("fan", cookie);
  await ask(await connect(fan, cookie), machine(3));
  assert.ok(row(fan).activated);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_packs WHERE kind = 'share'").get().n, 0, "no gift");
  const res = await billing({ env, params: { action: "checkout" }, request: new Request(ORIGIN + "/api/billing/checkout", {
    method: "POST", body: JSON.stringify({ plan: "hero" }),
    headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: await session(fan) } }) });
  assert.equal(res.status, 200);
  const checkout = stripeCalls.find(c => c.path === "checkout/sessions").body;
  assert.equal(checkout.get("subscription_data[metadata][creator]"), "ziqo");
  assert.equal(checkout.get("allow_promotion_codes"), "true");

  payments();
  const customer = env.DB.sqlite.prepare("SELECT customer_id FROM entitlements WHERE user_id = ?").get(fan.id).customer_id;
  // A few half-price beta days, then the first whole month (tax left out), an upgrade within it, then the renewal.
  await hook(paidInvoice("in_beta", customer, 0, 10, { amount: 250 }));
  await hook(paidInvoice("in_beta", customer, 0, 10, { amount: 250 }));
  // (October 26 to November 26: a calendar month, as Stripe's are.)
  await hook(paidInvoice("in_m1", customer, 10, 41, { amount: 999, tax: 90 }));
  await hook(paidInvoice("in_up", customer, 20, 41, { amount: 300 }));
  await hook(paidInvoice("in_m2", customer, 41, 71, { amount: 999 }));
  const earned = env.DB.sqlite.prepare("SELECT invoice_id, paid_cents, share_cents FROM creator_earnings ORDER BY paid_at").all()
    .map(r => ({ ...r }));
  assert.deepEqual(earned, [{ invoice_id: "in_beta", paid_cents: 250, share_cents: 175 },
                            { invoice_id: "in_m1", paid_cents: 909, share_cents: 636 },
                            { invoice_id: "in_up", paid_cents: 300, share_cents: 210 }]);

  // In the hold: nothing due yet. After it: one payout, once.
  assert.equal((await payoutList(env, new Date(NOW + 20 * DAY * 1000))).due.length, 0);
  const later = new Date(NOW + (20 + PAYOUTS.holdDays) * DAY * 1000);
  const list = await payoutList(env, later);
  assert.deepEqual(list.due.map(d => [d.code, d.due, d.method]), [["ziqo", 1021, "manual"]]);
  const paid = await payCreator(env, "ziqo", { method: "manual", now: later });
  assert.deepEqual([paid.payout.cents, paid.payout.items, paid.payout.status], [1021, 3, "paid"]);
  assert.match((await payCreator(env, "ziqo", { now: later })).error, /Nothing is due/);

  // A refund after the payout comes off the next one.
  await hook({ id: "evt_refund", type: "charge.refunded", livemode: false,
    data: { object: { id: "ch_1", object: "charge", payment_intent: "pi_in_m1", refunded: true, amount_refunded: 999 } } });
  const after = (await payoutList(env, later)).held.find(h => h.code === "ziqo");
  assert.equal((await referralReport(env, ORIGIN, later)).ledger.find(e => e.invoice_id === "in_m1").state, "reversed after payout");
  assert.equal(after, undefined, "owed less than nothing: not on the list");
  const dash = await creatorDashboard(env, owner.id, ORIGIN, later);
  assert.deepEqual([dash.numbers.clicks, dash.numbers.signups, dash.numbers.activated, dash.numbers.paying,
                    dash.numbers.earned, dash.numbers.paidOut, dash.numbers.reversed], [1, 1, 1, 1, 385, 1021, 636]);
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

test("creators apply, /admin approves them, and Stripe payouts go by transfer once they're switched on", async () => {
  const fan = await player("lorenerd", "nerd@example.com");
  assert.match((await applyCreator(env, fan, { name: "Lore Nerd", channel: "youtube.com/nerd", agree: true })).error, /link/);
  assert.match((await applyCreator(env, fan, { name: "Lore Nerd", channel: "https://youtube.com/@nerd" })).error, /terms/);
  const { application } = await applyCreator(env, fan, { name: "Lore Nerd", channel: "https://youtube.com/@nerd", agree: true });
  assert.equal(application.status, "pending");
  const { creator } = await decideApplication(env, application.id, { approve: true });
  assert.deepEqual([creator.code, creator.user_id, creator.share_pct], ["lore-nerd", fan.id, 70]);

  // Payouts through Stripe wait for the switch, then an Express account the creator sets up.
  assert.match((await startConnect(env, creator, ORIGIN)).error, /aren't open yet/);
  // The switch proves Connect works with the site's key: an empty Express account, made and deleted.
  routes["POST accounts"] = () => Response.json({ error: { message: "You can only create new accounts if you've signed up for Connect" } }, { status: 400 });
  assert.match((await setStripePayouts(env, true)).error, /signed up for Connect/);
  routes["POST accounts"] = () => Response.json({ id: "acct_probe" });
  routes["DELETE accounts/acct_probe"] = () => Response.json({ id: "acct_probe", deleted: true });
  assert.deepEqual(await setStripePayouts(env, true), { on: true });
  assert.ok(stripeCalls.some(c => c.method === "DELETE" && c.path === "accounts/acct_probe"));
  stripeCalls.length = 0;
  routes["POST accounts"] = () => Response.json({ id: "acct_nerd" });
  routes["POST account_links"] = () => Response.json({ url: "https://connect.stripe.com/setup/e/acct_nerd" });
  assert.equal((await startConnect(env, creator, ORIGIN, { country: "us" })).url, "https://connect.stripe.com/setup/e/acct_nerd");
  const acct = stripeCalls.find(c => c.path === "accounts" && c.method === "POST").body;
  assert.deepEqual([acct.get("type"), acct.get("country"), acct.get("capabilities[transfers][requested]")], ["express", "US", "true"]);
  routes["GET accounts/acct_nerd"] = () => Response.json({ id: "acct_nerd", payouts_enabled: true, capabilities: { transfers: "active" } });
  const row = env.DB.sqlite.prepare("SELECT * FROM creators WHERE code = 'lore-nerd'").get();
  assert.equal((await refreshConnect(env, row)).ready, true);

  await env.DB.prepare("INSERT INTO creator_earnings (invoice_id, creator, paid_cents, share_cents, pct, paid_at, recorded, " +
    "payable_at) VALUES ('in_a', 'lore-nerd', 1999, 1399, 70, ?, ?, ?)").bind(new Date(NOW - 40 * DAY * 1000).toISOString(),
    new Date(NOW).toISOString(), new Date(NOW - 10 * DAY * 1000).toISOString()).run();
  let down = true;
  routes["POST transfers"] = () => down ? Response.json({ error: { message: "Insufficient funds" } }, { status: 400 })
    : Response.json({ id: "tr_1" });
  assert.match((await payCreator(env, "lore-nerd", { method: "stripe" })).error, /Insufficient funds/);
  assert.equal((await payoutList(env)).due[0].due, 1399, "a failed transfer leaves it due");
  down = false;
  const { payout } = await payCreator(env, "lore-nerd", { method: "stripe" });
  assert.deepEqual([payout.cents, payout.transfer_id, payout.method], [1399, "tr_1", "stripe"]);
  const transfer = stripeCalls.filter(c => c.path === "transfers").at(-1);
  assert.deepEqual([transfer.body.get("amount"), transfer.body.get("destination"), transfer.key], ["1399", "acct_nerd", `lf-payout-${payout.id}`]);
  const dash = await creatorDashboard(env, fan.id, ORIGIN);
  assert.deepEqual([dash.payouts.ready, dash.payouts.last.cents, dash.numbers.payable], [true, 1399, 0]);
});
