// Willo plan cancellations (lib/cancellations.js), through Stripe's webhook (functions/api/billing/[action].js): each
// change logged once, what the plan paid, and one plain line in Slack for each new cancellation, without anything about
// who. Stripe and Slack are mocked through fetch; D1 is node:sqlite (helpers.mjs).
// Run: node --test 'site/tests/*.test.mjs'

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { onRequest as billing } from "../functions/api/billing/[action].js";
import { findOrCreateUser, setup, deleteUser } from "../lib/accounts.js";
import { setupBilling } from "../lib/billing.js";
import { setupCancellations, changeOf, keptFor, cancellationLine, paidSoFar } from "../lib/cancellations.js";

import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const NOW = Date.parse("2026-10-19T12:00:00Z");
const DAY = 86400;
const HOOK = "https://hooks.slack.com/services/T000/B000/test";
const env = { DB: d1(), STRIPE_SECRET_KEY: "sk_test_123", STRIPE_WEBHOOK_SECRET: "whsec_test", SITE_FEATURES: "plans",
              SLACK_FEEDBACK_WEBHOOK: HOOK };
const originalFetch = globalThis.fetch;
let subscriptions, invoices, posts, stripeDown;

beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  await setup(env);
  await setupBilling(env);
  await setupCancellations(env);
  env.DB.sqlite.exec("CREATE TABLE IF NOT EXISTS slack_forwards (key TEXT PRIMARY KEY, source TEXT NOT NULL, " +
    "minute TEXT NOT NULL, state TEXT NOT NULL, created TEXT NOT NULL)");   // lib/slack-feedback.js makes it on its first post
  for (const table of ["users", "entitlements", "billing_events", "plan_log", "plan_cancellations", "plan_payments",
                       "plan_payments_read", "excluded_accounts", "slack_forwards", "email_sends"])
    env.DB.sqlite.exec(`DELETE FROM ${table}`);
  subscriptions = {};
  invoices = {};
  posts = [];
  stripeDown = false;
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    if (u.hostname === "hooks.slack.com") {
      posts.push(JSON.parse(options.body).text);
      return new Response("ok");
    }
    const path = u.pathname.replace("/v1/", ""), method = options.method || "GET";
    if (stripeDown && path === "invoices") return Response.json({ error: { message: "down" } }, { status: 500 });
    if (method === "GET" && path === "invoices") return Response.json({ data: Object.values(invoices)
      .filter(i => i.subscription === u.searchParams.get("subscription")) });
    if (method === "GET" && path === "subscriptions") return Response.json({ data: [] });   // Delete my account's check
    if (method === "GET" && path.startsWith("subscriptions/") && subscriptions[path.slice(14)])
      return Response.json(subscriptions[path.slice(14)]);
    if (method === "GET" && path.startsWith("coupons/")) return Response.json({ id: path.slice(8), percent_off: 50, duration: "once" });
    return Response.json({ error: { message: `No such route: ${method} ${path}` } }, { status: 404 });
  };
});
afterEach((t) => { globalThis.fetch = originalFetch; t.mock.timers.reset(); });

const sign = body => {
  const t = Math.floor(NOW / 1000);
  return `t=${t},v1=${createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex")}`;
};
async function hook(event) {
  const body = JSON.stringify(event);
  const request = new Request(ORIGIN + "/api/billing/webhook", { method: "POST",
    headers: { "Stripe-Signature": sign(body), "Content-Type": "application/json" }, body });
  const res = await billing({ request, env, params: { action: "webhook" } });
  return res.status;
}

const player = sub => findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
// A subscription as Stripe has it: started `days` ago, its period ending in `left` days.
function sub(id, user, { plan = "hero", days = 15, left = 15, status = "active", ...more } = {}) {
  return (subscriptions[id] = { id, object: "subscription", customer: `cus_${id}`, status, cancel_at_period_end: false,
    cancel_at: null, canceled_at: null, ended_at: null, start_date: NOW / 1000 - days * DAY, metadata: { user_id: user?.id },
    cancellation_details: { reason: null, feedback: null, comment: null },
    items: { data: [{ current_period_end: NOW / 1000 + left * DAY,
                      price: { id: `price_${plan}`, lookup_key: `${plan}_monthly`, recurring: { interval: "month" } } }] },
    ...more });
}
const paid = (id, subId, cents) => (invoices[id] = { id, subscription: subId, amount_paid: cents, status: "paid",
  status_transitions: { paid_at: NOW / 1000 - 10 * DAY } });
let n = 0;
const event = (type, object, previous) => ({ id: `evt_${++n}`, type, created: NOW / 1000, livemode: false,
  data: { object: structuredClone(object), ...(previous ? { previous_attributes: previous } : {}) } });
const rows = () => env.DB.sqlite.prepare("SELECT * FROM plan_cancellations ORDER BY at, created").all().map(r => ({ ...r }));
// The player cancels on Stripe's page: at the period's end, with the reason they picked.
function cancel(s, feedback = null, comment = null) {
  Object.assign(s, { cancel_at_period_end: true, canceled_at: NOW / 1000,
    cancellation_details: { reason: "cancellation_requested", feedback, comment } });
  return event("customer.subscription.updated", s, { cancel_at_period_end: false, canceled_at: null,
    cancellation_details: { reason: null, feedback: null, comment: null } });
}

test("a cancellation is logged once, with how long it was kept, what it paid and why, and posted as one plain line", async () => {
  const user = await player("thrall");
  const s = sub("sub_a", user, { days: 15 });
  paid("in_a1", "sub_a", 250);
  assert.equal(await hook(event("customer.subscription.created", s)), 200);
  const cancelled = cancel(s, "too_expensive", "Loved it, but money's tight. Mail me at thrall@example.com");
  assert.equal(await hook(cancelled), 200);
  const [row] = rows();
  assert.deepEqual([row.kind, row.plan, row.days, row.paid_cents, row.trial, row.reason, row.feedback, row.counted, row.user_id],
    ["scheduled", "hero", 15, 250, 0, "cancellation_requested", "too_expensive", 1, user.id]);
  assert.equal(row.ends, new Date(NOW + 15 * DAY * 1000).toISOString());
  assert.equal(posts.length, 1);
  assert.equal(posts[0].split("\n").length, 1, "one line");
  assert.match(posts[0], /^:door: \*Plan cancelled · Hero\* · 2 weeks subscribed · paid \$2\.50 · runs to Nov 3 · reason: too expensive · "Loved it, but money's tight\. Mail me at \[email\]" · <https:\/\/preview\.example\/admin#retention\|open in \/admin>$/);
  assert.doesNotMatch(posts[0], /thrall|example\.com|cus_|sub_|user/i, "never who");
  // Stripe sends it again: still one row and one post.
  assert.equal(await hook(cancelled), 200);
  assert.deepEqual([rows().length, posts.length], [1, 1]);
});

test("taken back, cancelled again and ended: an undo is posted, the end isn't (it's the same cancellation)", async () => {
  const user = await player("jaina");
  const s = sub("sub_b", user, { plan: "champion", days: 3 });
  paid("in_b1", "sub_b", 500);
  assert.equal(await hook(cancel(s)), 200);
  Object.assign(s, { cancel_at_period_end: false, canceled_at: null });
  assert.equal(await hook(event("customer.subscription.updated", s, { cancel_at_period_end: true, canceled_at: NOW / 1000 })), 200);
  assert.equal(await hook(cancel(s, "unused")), 200);
  Object.assign(s, { status: "canceled", ended_at: NOW / 1000 + 27 * DAY });
  assert.equal(await hook(event("customer.subscription.deleted", s)), 200);
  assert.deepEqual(rows().map(r => r.kind), ["scheduled", "undone", "scheduled", "ended"]);
  assert.equal(posts.length, 3);
  assert.match(posts[0], /Plan cancelled · Champion\* · 3 days subscribed · paid \$5\.00 · runs to Nov 3 · no reason given/);
  assert.match(posts[1], /^:door: \*Cancellation taken back · Champion\* · 3 days subscribed · paid \$5\.00 · </);
  assert.match(posts[2], /reason: not using it enough/);
  // Other changes (a plan switch, a renewal) aren't cancellations.
  const other = sub("sub_c", user, { plan: "legend" });
  assert.equal(changeOf(event("customer.subscription.updated", other, { items: {} })), null);
  assert.equal(changeOf(event("customer.subscription.updated", other, { status: "trialing" })), null);
  assert.equal(changeOf(event("invoice.paid", { id: "in_x", object: "invoice" })), null);
});

test("an end with no cancellation waiting is 'now', with Stripe's reason; a trial that never paid says so", async () => {
  const user = await player("garrosh");
  const s = sub("sub_d", user, { days: 40 });
  paid("in_d1", "sub_d", 250);
  paid("in_d2", "sub_d", 499);
  Object.assign(s, { status: "canceled", canceled_at: NOW / 1000, ended_at: NOW / 1000,
    cancellation_details: { reason: "payment_failed", feedback: null, comment: null } });
  assert.equal(await hook(event("customer.subscription.deleted", s)), 200);
  assert.match(posts[0], /^:door: \*Plan ended · Hero\* · 5 weeks subscribed · paid \$7\.49 · reason: payments failed · </);
  assert.equal(rows()[0].kind, "now");

  // Keep Hero: a trial to the launch, nothing charged, cancelled on Stripe's page.
  const trial = await player("sylvanas");
  const t = sub("sub_e", trial, { status: "trialing", days: 6, left: 16 });
  assert.equal(await hook(cancel(t, "missing_features")), 200);
  assert.match(posts[1], /Plan cancelled · Hero\* · 6 days subscribed · never charged · runs to Nov 4 · reason: missing features/);
  assert.deepEqual([rows()[1].trial, rows()[1].paid_cents], [1, 0]);
});

test("comped and team accounts are logged but marked; an extra subscription's end is 'replaced' and never posted", async () => {
  const mike = await player("mike");
  // Mike's own Legend, free forever by its coupon (lib/billing.js COMP_COUPONS).
  const legend = sub("sub_f", mike, { plan: "legend",
    discounts: [{ id: "di_1", coupon: { id: "owner-legend-free", percent_off: 100, duration: "forever" } }] });
  assert.equal(await hook(cancel(legend)), 200);
  assert.equal(rows()[0].counted, 0);
  assert.match(posts[0], /team or comped account, not counted/);

  const tester = await player("tester");
  env.DB.sqlite.prepare("INSERT INTO excluded_accounts (user_id, reason, created) VALUES (?, 'admin', ?)").run(tester.id, "x");
  assert.equal(await hook(cancel(sub("sub_g", tester))), 200);
  assert.equal(rows()[1].counted, 0);

  // Two checkouts paid at once: the second subscription is cancelled (lib/billing.js keepOldest) while the first stays.
  const both = await player("both");
  const kept = sub("sub_h1", both);
  kept.customer = "cus_both";
  assert.equal(await hook(event("customer.subscription.created", kept)), 200);
  const extra = sub("sub_h2", both, { days: 0, status: "canceled", canceled_at: NOW / 1000, ended_at: NOW / 1000 });
  extra.customer = "cus_both";
  assert.equal(await hook(event("customer.subscription.deleted", extra)), 200);
  const replaced = rows().find(r => r.subscription_id === "sub_h2");
  assert.deepEqual([replaced.kind, replaced.counted], ["replaced", 0]);
  assert.equal(posts.length, 2, "not posted");
});

test("Stripe or Slack failing never fails the webhook; the line goes out without what it paid", async () => {
  const user = await player("anduin");
  const s = sub("sub_i", user, { days: 8 });
  stripeDown = true;
  assert.equal(await hook(cancel(s, "other", "")), 200);
  assert.equal(rows()[0].paid_cents, null);
  assert.match(posts[0], /Plan cancelled · Hero\* · 1 week subscribed · runs to Nov 3 · reason: other · </);
  // Slack down: still a 200, still logged.
  globalThis.fetch = async (url, o) => new URL(url).hostname === "hooks.slack.com" ? new Response("no", { status: 500 }) : Response.json({ data: [] });
  const t = sub("sub_j", user);
  assert.equal(await hook(cancel(t)), 200);
  assert.equal(rows().length, 2);
});

test("paid invoices are counted once, from the webhook and from Stripe; Delete my account keeps the record without the account", async () => {
  const user = await player("varian");
  const s = sub("sub_k", user, { days: 20 });
  paid("in_k1", "sub_k", 250);
  paid("in_k2", "sub_k", 499);
  // invoice.paid noted one of them before the log read Stripe for the rest.
  assert.equal(await hook(event("invoice.paid", { id: "in_k2", object: "invoice", amount_paid: 499, customer: "cus_sub_k",
    parent: { subscription_details: { subscription: "sub_k" } }, status_transitions: { paid_at: NOW / 1000 } })), 200);
  assert.equal(await paidSoFar(env, "sub_k"), 749);
  assert.equal(await paidSoFar(env, "sub_k"), 749, "read from Stripe once");
  assert.equal(await hook(cancel(s)), 200);
  assert.equal(rows()[0].user_id, user.id);
  await deleteUser(env, { ...user, ...(await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first()) });
  const [row] = rows();
  assert.deepEqual([row.user_id, row.kind, row.paid_cents], [null, "scheduled", 749]);
});

test("words: how long, and the line's parts", () => {
  assert.deepEqual([0, 1, 6, 7, 13, 14, 40].map(keptFor), ["0 days", "1 day", "6 days", "1 week", "1 week", "2 weeks", "5 weeks"]);
  const line = cancellationLine({ kind: "now", plan: "legend", days: 2, paid_cents: null, reason: "cancellation_requested",
    feedback: null, comment: null, counted: 1 });
  assert.deepEqual([line.title, line.parts.filter(Boolean)], ["Plan cancelled now · Legend", ["2 days subscribed", "no reason given"]]);
});
