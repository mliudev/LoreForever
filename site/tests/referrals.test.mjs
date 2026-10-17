// Share Willo (lib/referrals.js): a friend who opens a player's link and then connects Willo for the first time gives
// the player answers, once per Google account and at most SHARES_PER_MONTH friends a month; those answers are used
// once the day's run out; a creator's link gives their audience answers and a first-month discount at checkout, and
// the creator a share of what those players pay in their first months. Stripe and Gemini are mocked through fetch; D1
// is node:sqlite (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { onRequestGet as shareLink } from "../functions/w/[code].js";
import { onRequest as device } from "../functions/api/device/[action].js";
import { onRequest as billing } from "../functions/api/billing/[action].js";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { findOrCreateUser, startSession, setup, deleteUser } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { setupBilling } from "../lib/billing.js";
import { setupReferrals, shareCode, saveCreator, referralReport, SHARES_PER_MONTH } from "../lib/referrals.js";

import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const NOW = Date.parse("2026-10-16T12:00:00Z");
const DAY = 86400;
const env = { DB: d1(), GEMINI_API_KEY: "test-key", STRIPE_SECRET_KEY: "sk_test_123", STRIPE_WEBHOOK_SECRET: "whsec_test",
              SITE_FEATURES: "plans" };
const originalFetch = globalThis.fetch;
let stripeCalls, subscriptions, invoices;

beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  await setup(env);
  await setupBilling(env);
  await setupReferrals(env);
  for (const table of ["users", "sessions", "devices", "device_links", "rate_limits", "answer_spend", "answer_days",
                       "entitlements", "billing_events", "answer_user_spend", "answer_packs", "starter_claims",
                       "promo_claims", "share_codes", "referrals", "creators", "creator_earnings"])
    env.DB.sqlite.exec(`DELETE FROM ${table}`);
  stripeCalls = [];
  subscriptions = {};
  invoices = {};
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    if (u.hostname === "generativelanguage.googleapis.com")
      return Response.json({ candidates: [{ content: { parts: [{ text: "Mild Spices are sold in Goldshire." }] } }],
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40 } });
    const call = { method: options.method, path: u.pathname.replace("/v1/", ""), query: u.searchParams,
                   body: new URLSearchParams(options.body || "") };
    stripeCalls.push(call);
    const route = `${call.method} ${call.path}`;
    if (route === "GET coupons/lore_forever_creator_50") return Response.json({ error: { message: "No such coupon" } }, { status: 404 });
    if (route === "POST coupons") return Response.json({ id: call.body.get("id") });
    if (route === "POST promotion_codes") return Response.json({ id: "promo_ziqo", code: call.body.get("code"), active: true });
    if (route === "GET prices") return Response.json({ data: [{ id: "price_hero_m", lookup_key: "hero_monthly" }] });
    if (route === "POST customers") return Response.json({ id: `cus_${stripeCalls.filter(c => c.path === "customers").length}` });
    if (route === "POST checkout/sessions") return Response.json({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
    if (call.method === "GET" && subscriptions[call.path.replace("subscriptions/", "")])
      return Response.json(subscriptions[call.path.replace("subscriptions/", "")]);
    if (call.method === "GET" && invoices[call.path.replace("invoices/", "")])
      return Response.json(invoices[call.path.replace("invoices/", "")]);
    return Response.json({ error: { message: `No such route: ${route}` } }, { status: 404 });
  };
});
afterEach((t) => { globalThis.fetch = originalFetch; t.mock.timers.reset(); });

const player = sub => findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
const session = async user => (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];

// Opening /w/<code>: where it goes and the cookie it leaves.
async function open(code) {
  const res = await shareLink({ request: new Request(`${ORIGIN}/w/${code}`), env, params: { code }, waitUntil: p => p });
  return { to: res.headers.get("Location"), cookie: (res.headers.get("Set-Cookie") || "").split(";")[0] };
}

// The account connects Willo on /link, in a browser with `cookie` (the share link's), as the page does.
async function connect(user, cookie = "") {
  const link = await startLink(env);
  const request = new Request(`${ORIGIN}/api/device/approve`, { method: "POST", body: JSON.stringify({ code: link.user_code }),
    headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: [await session(user), cookie].filter(Boolean).join("; ") } });
  const res = await device({ request, env, params: { action: "approve" } });
  assert.equal(res.status, 200);
  await claimToken(env, link.device_code);
}

const shared = user => env.DB.sqlite.prepare("SELECT COALESCE(SUM(answers), 0) AS a, COALESCE(SUM(remaining), 0) AS r " +
  "FROM answer_packs WHERE user_id = ? AND kind = 'share'").get(user.id);

test("a friend who connects Willo through a share link gives the sharer a tenth of their plan's month, once per Google account", async () => {
  const sharer = await player("sharer");
  const code = await shareCode(env, sharer.id);
  assert.equal(await shareCode(env, sharer.id), code, "one link per account");
  const { to, cookie } = await open(code);
  assert.equal(to, `${ORIGIN}/willo?shared=${code}`);
  assert.match(cookie, new RegExp(`^lf_share=${code}$`));

  await connect(await player("friend"), cookie);
  assert.equal(shared(sharer).a, 60, "the free plan's 600 a month: 60 for a friend");

  // The same Google account again, after Delete my account: not a second friend.
  await deleteUser(env, await player("friend"));
  await connect(await player("friend"), cookie);
  assert.equal(shared(sharer).a, 60);

  // Not the sharer's own link, and not an account that had Willo already.
  await connect(sharer, cookie);
  const veteran = await player("veteran");
  await connect(veteran);
  await connect(veteran, cookie);
  assert.equal(shared(sharer).a, 60);

  // On Hero, a friend gives 90 (900 a month).
  await env.DB.prepare("INSERT INTO entitlements (user_id, plan, status, current_period_end, updated) VALUES (?, 'hero', 'active', ?, ?)")
    .bind(sharer.id, new Date(NOW + 20 * DAY * 1000).toISOString(), new Date(NOW).toISOString()).run();
  await connect(await player("friend-2"), cookie);
  assert.equal(shared(sharer).a, 150);
});

test("ten friends a month give answers, the eleventh doesn't; they're used once the day's answers are gone", async () => {
  const sharer = await player("sharer");
  const { cookie } = await open(await shareCode(env, sharer.id));
  for (let i = 0; i <= SHARES_PER_MONTH; i++) await connect(await player(`friend-${i}`), cookie);
  assert.equal(shared(sharer).a, SHARES_PER_MONTH * 60);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM referrals WHERE sharer_id = ?").get(sharer.id).n,
    SHARES_PER_MONTH + 1, "the eleventh still counts as a friend, without answers");

  // The sharer's Willo: today's 20 and the starter used, so the next answer is one of theirs from friends.
  const link = await startLink(env);
  await decideLink(env, link.user_code, sharer, true);
  const { token } = await claimToken(env, link.device_code);
  await env.DB.prepare("INSERT INTO answer_packs (id, user_id, kind, answers, remaining, created) VALUES (?, ?, 'starter', 30, 0, ?)")
    .bind(`starter:${sharer.id}`, sharer.id, new Date(NOW).toISOString()).run();
  await env.DB.prepare("INSERT INTO rate_limits (user_id, bucket, n) VALUES (?, 'companion-answer:2026-10-16', 20)").bind(sharer.id).run();
  const res = await answer({ env, request: new Request(ORIGIN + "/api/companion/answer", { method: "POST",
    headers: { "X-LF-Client": "companion/0.1.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "QUESTION\nWhere can I buy Mild Spices?" }) }) });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(shared(sharer).r, SHARES_PER_MONTH * 60 - 1);
  assert.equal(body.allowance.remaining, SHARES_PER_MONTH * 60 - 1);
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
// A paid Hero invoice of the customer's subscription, `days` after now.
function paidInvoice(id, customer, days, { amount = 499, tax = 0, discounts = [] } = {}) {
  subscriptions[`sub_${customer}`] = { id: `sub_${customer}`, customer, status: "active", metadata: {},
    items: { data: [{ current_period_end: NOW / 1000 + (days + 30) * DAY, price: { id: "price_hero_m", lookup_key: "hero_monthly" } }] } };
  return { id: `evt_${id}`, type: "invoice.paid", livemode: false, data: { object: { id, object: "invoice", customer,
    amount_paid: amount, total_taxes: tax ? [{ amount: tax }] : [], discounts, status_transitions: { paid_at: NOW / 1000 + days * DAY },
    parent: { subscription_details: { subscription: `sub_${customer}` } } } } };
}

test("a creator's link: answers for their audience, their discount at checkout, and 20% of the first 3 months", async () => {
  const saved = await saveCreator(env, { code: "Ziqo", name: "Ziqo" });
  assert.equal(saved.creator.code, "ziqo", "codes are lowercase");
  assert.equal((await saveCreator(env, { code: "ziqo2", name: "" })).error, "A creator needs a name.");
  assert.equal(saved.creator.promo_id, "promo_ziqo");
  const promo = stripeCalls.find(c => c.path === "promotion_codes").body;
  assert.equal(promo.get("code"), "ZIQO");
  assert.equal(promo.get("restrictions[first_time_transaction]"), "true");

  const fan = await player("fan");
  const { cookie } = await open("ziqo");
  await connect(fan, cookie);
  assert.equal(shared(fan).a, 100, "the creator's audience gets 100 answers");

  // Checkout takes the creator's code by itself (no beta here) and names the creator on the subscription.
  const res = await billing({ env, params: { action: "checkout" }, request: new Request(ORIGIN + "/api/billing/checkout", {
    method: "POST", body: JSON.stringify({ plan: "hero" }),
    headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: await session(fan) } }) });
  assert.equal(res.status, 200);
  const checkout = stripeCalls.find(c => c.path === "checkout/sessions").body;
  assert.equal(checkout.get("discounts[0][promotion_code]"), "promo_ziqo");
  assert.equal(checkout.get("subscription_data[metadata][creator]"), "ziqo");
  assert.equal(checkout.get("allow_promotion_codes"), null);

  // Paid invoices: 20% of what was paid without tax, for 3 months from the first payment, once per invoice.
  const customer = env.DB.sqlite.prepare("SELECT customer_id FROM entitlements WHERE user_id = ?").get(fan.id).customer_id;
  await hook(paidInvoice("in_1", customer, 0, { amount: 250, discounts: ["di_1"] }));
  await hook(paidInvoice("in_1", customer, 0, { amount: 250, discounts: ["di_1"] }));
  await hook(paidInvoice("in_2", customer, 30, { amount: 549, tax: 50 }));
  await hook(paidInvoice("in_4", customer, 95));
  const earned = env.DB.sqlite.prepare("SELECT invoice_id, paid_cents, share_cents FROM creator_earnings ORDER BY invoice_id").all()
    .map(r => ({ ...r }));
  assert.deepEqual(earned, [{ invoice_id: "in_1", paid_cents: 250, share_cents: 50 },
                            { invoice_id: "in_2", paid_cents: 499, share_cents: 100 }]);

  // A viewer on a phone types ZIQO at checkout instead: the invoice's discount names the creator's promotion code.
  const typed = await player("typed");
  await env.DB.prepare("INSERT INTO entitlements (user_id, customer_id, updated) VALUES (?, 'cus_typed', ?)")
    .bind(typed.id, new Date(NOW).toISOString()).run();
  invoices.in_t = { id: "in_t", discounts: [{ id: "di_t", promotion_code: "promo_ziqo" }] };
  await hook(paidInvoice("in_t", "cus_typed", 1, { discounts: ["di_t"] }));

  const report = await referralReport(env, ORIGIN);
  const ziqo = report.creators[0];
  assert.equal(ziqo.url, `${ORIGIN}/w/ziqo`);
  assert.deepEqual([ziqo.clicks, ziqo.joined, ziqo.paying, ziqo.owed], [1, 2, 2, 50 + 100 + 100]);
});
