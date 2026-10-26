// The launch as every plan's pay day (lib/billing.js, Mike, 2026-10-17: "half off for the beta period only, then full
// price for when the full game launches"): payDay moves every live plan's next charge to the launch, once, with or
// without a credit for days already paid after it (/admin's "pay-day"); before the launch an upgrade charges nothing
// until then (a trial, or a pre-order anchored at the launch), and after it the rest of the month at full price; a
// downgrade keeps the trial; a paying plan moved to the launch
// still counts as paying, and /plans and /account say when it renews. (Checkout's anchor and the free Hero month:
// launch.test.mjs.) Stripe is mocked through fetch; D1 is node:sqlite (helpers.mjs).
// Run: node --test 'site/tests/*.test.mjs'

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { onRequest as billing } from "../functions/api/billing/[action].js";
import { findOrCreateUser, startSession, setup } from "../lib/accounts.js";
import { setupBilling, planFor, payDay, changePlan, subscriptionReport, preorderText, BETA_HALF } from "../lib/billing.js";

import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const NOW = Date.parse("2026-10-20T12:00:00Z");   // the real clock: the beta
const LAUNCH = "2026-11-04T15:00:00-08:00", L = Date.parse(LAUNCH);
// The play gap's key that the 11 moved on 2026-10-18 carry in their metadata before the pay day moved them again.
const KEY = "2026-10-22T07:00:00.000Z";
const MINUTE = 60e3, HOUR = 60 * MINUTE, DAY = 24 * HOUR, MONTH = 30 * DAY;
const at = iso => Date.parse(iso);
const s = ms => Math.floor(ms / 1000);
const env = { DB: d1(), STRIPE_SECRET_KEY: "sk_test_123", STRIPE_WEBHOOK_SECRET: "whsec_test", SITE_FEATURES: "plans",
              ADMIN_KEY: "admin-test", LAUNCH_WEEK_START: "2026-10-14T19:00:00.000Z" };
const PRICES = { price_hero_m: "hero_monthly", price_champion_m: "champion_monthly", price_legend_m: "legend_monthly" };
const originalFetch = globalThis.fetch;
let subscriptions, schedules, stripeCalls, invoices, balances, coupons;

beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  await setup(env);
  await setupBilling(env);
  env.DB.sqlite.exec("CREATE TABLE IF NOT EXISTS excluded_accounts (user_id TEXT PRIMARY KEY, reason TEXT NOT NULL, " +
    "created TEXT NOT NULL)");
  for (const table of ["users", "sessions", "devices", "rate_limits", "entitlements", "billing_events", "answer_user_spend",
                       "answer_packs", "promo_claims", "plan_log", "billing_locks"])
    env.DB.sqlite.exec(`DELETE FROM ${table}`);
  subscriptions = {};
  schedules = {};
  invoices = {};
  balances = {};
  coupons = new Set([BETA_HALF.id]);
  stripeCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url), path = u.pathname.replace("/v1/", ""), route = `${options.method} ${path}`;
    const body = new URLSearchParams(options.body || "");
    stripeCalls.push({ route, body, key: options.headers?.["Idempotency-Key"] });
    if (route === "GET prices") return Response.json({ data: Object.entries(PRICES).map(([id, lookup_key]) => ({ id, lookup_key })) });
    if (route === "GET subscriptions") {
      // By customer (checkout, a plan change), or by status a page of two at a time (payDay).
      const customer = u.searchParams.get("customer"), status = u.searchParams.get("status");
      const all = Object.values(subscriptions).filter(x => customer ? x.customer === customer : x.status === status);
      const from = u.searchParams.get("starting_after") ? all.findIndex(x => x.id === u.searchParams.get("starting_after")) + 1 : 0;
      return Response.json(customer ? { data: all } : { data: all.slice(from, from + 2), has_more: from + 2 < all.length });
    }
    if (route === "GET checkout/sessions") return Response.json({ data: [] });
    if (route === "POST customers") return Response.json({ id: "cus_new" });
    if (route === "POST checkout/sessions") return Response.json({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
    if (route === "GET invoices") return Response.json({ data: invoices[u.searchParams.get("subscription")] || [] });
    // A plan change's preview (999), or a subscription's next invoice: its price, nothing for a comped one, less the
    // customer's balance credit, as Stripe's own preview has it.
    if (route === "POST invoices/create_preview") {
      const next = subscriptions[body.get("subscription")];
      const amount = body.has("subscription_details[items][0][price]") || !next ? 999
        : next.metadata.comp ? 0 : { hero: 499, champion: 999, legend: 1999 }[next.items.data[0].price.lookup_key.split("_")[0]];
      return Response.json({ amount_due: Math.max(0, amount + (next ? balances[next.customer] || 0 : 0)),
        parent: { subscription_details: { subscription_proration_date: s(Date.now()) } }, lines: { data: [] } });
    }
    if (options.method === "POST" && /^customers\/[^/]+\/balance_transactions$/.test(path)) {
      const customer = path.split("/")[1];
      balances[customer] = (balances[customer] || 0) + Number(body.get("amount"));
      return Response.json({ id: "cbtxn_1", amount: Number(body.get("amount")) });
    }
    if (options.method === "GET" && path.startsWith("coupons/"))
      return coupons.has(path.slice(8)) ? Response.json({ id: path.slice(8), percent_off: 50 })
        : Response.json({ error: { message: "No such coupon" } }, { status: 404 });
    if (route === "POST coupons") {
      if (body.get("id") === "refused") return Response.json({ error: { message: "This key can't" } }, { status: 403 });
      coupons.add(body.get("id"));
      return Response.json({ id: body.get("id") });
    }
    const sub = subscriptions[path.replace("subscriptions/", "")];
    if (options.method === "GET" && sub) return Response.json(sub);
    if (options.method === "POST" && sub) {
      // What Stripe does with the fields these tests send: a trial moves the period's end, a price swap the item.
      if (body.has("trial_end") && body.get("trial_end") !== "now") {
        sub.status = "trialing";
        sub.trial_end = Number(body.get("trial_end"));
        sub.items.data[0].current_period_end = sub.trial_end;
      }
      if (body.has("cancel_at")) sub.cancel_at = Number(body.get("cancel_at"));
      if (body.has("items[0][price]")) sub.items.data[0].price = price(body.get("items[0][price]"));
      for (const [k, v] of body) if (k.startsWith("metadata[")) sub.metadata[k.slice(9, -1)] = v;
      return Response.json({ ...sub, latest_invoice: null });
    }
    if (route === "POST subscription_schedules")
      return Response.json(schedules.sched_new = { id: "sched_new", phases: [{ start_date: s(at("2026-10-01T12:00:00Z")), discounts: [] }] });
    const schedule = schedules[path.replace("subscription_schedules/", "")];
    if (options.method === "GET" && schedule) return Response.json(schedule);
    if (options.method === "POST" && schedule) {
      for (const [k, v] of body) if (k.startsWith("metadata[")) (schedule.metadata ||= {})[k.slice(9, -1)] = v;
      return Response.json(schedule);
    }
    return Response.json({ error: { message: `No such route: ${route}` } }, { status: 404 });
  };
});
afterEach((t) => { globalThis.fetch = originalFetch; t.mock.timers.reset(); });

const price = id => ({ id, lookup_key: PRICES[id] || "other_monthly", product: PRICES[id] ? `lore_forever_${PRICES[id].split("_")[0]}` : "prod_other",
                       recurring: { interval: "month" } });
// A subscription as Stripe has it: the plan's price, its period's end on the item, when it began (start_date).
function sub(id, { plan = "hero", status = "active", ends, began = at("2026-09-01T12:00:00Z"), customer = `cus_${id}`,
                   metadata = {}, ...rest }) {
  return subscriptions[id] = { id, object: "subscription", customer, status, start_date: s(began), created: s(began),
    cancel_at_period_end: false, cancel_at: null, metadata: { ...metadata }, schedule: null,
    ...(status === "trialing" ? { trial_end: s(ends) } : {}),
    items: { data: [{ id: `si_${id}`, current_period_end: s(ends), price: price(plan === "other" ? "price_other" : `price_${plan}_m`) }] },
    ...rest };
}
const posts = route => stripeCalls.filter(c => c.route === route);
const player = name => findOrCreateUser(env, { email: `${name}@example.com`, googleSub: name, name });
const sign = body => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex")}`;
};
let events = 0;
async function hook(type, id, e = env) {
  const body = JSON.stringify({ id: `evt_${++events}`, type, data: { object: { id } } });
  const res = await billing({ env: e, params: { action: "webhook" }, request: new Request(ORIGIN + "/api/billing/webhook",
    { method: "POST", headers: { "Stripe-Signature": sign(body), "Content-Type": "application/json" }, body }) });
  assert.equal(res.status, 200, await res.clone().text());
}
const plansFor = async (e, cookie) => (await billing({ env: e, params: { action: "plans" },
  request: new Request(ORIGIN + "/api/billing/plans", cookie ? { headers: { Cookie: cookie } } : {}) })).json();
const promo = ms => ({ ...env, PROMO_NOW: new Date(ms).toISOString() });

test("the pay day: each plan's charge on the launch, with or without a credit for days already paid, once", async () => {
  const DAY_AT = LAUNCH, D = s(L);
  const paid = (id, amount, start, end) => (invoices[id] ||= []).push({ id: `in_${id}_${amount}`, status: "paid",
    amount_paid: amount, lines: { data: [{ period: { start: s(at(start)), end: s(at(end)) } }] } });
  // A Legend whose charge moved +14 (paid $19.99 for Oct 15 – Nov 15), and its $0 invoice for the move.
  sub("sub_l", { plan: "legend", status: "trialing", ends: at("2026-11-29T04:21:00Z"),
                 metadata: { play_gap: KEY, play_gap_from: "active" } });
  paid("sub_l", 0, "2026-10-17T03:00:00Z", "2026-11-29T04:21:00Z");
  paid("sub_l", 1999, "2026-10-15T04:21:00Z", "2026-11-15T04:21:00Z");
  // A Champion on its 50% first month ($4.99), a Keep Hero trial (nothing paid), a comped Legend, a failing one.
  sub("sub_c", { plan: "champion", status: "trialing", ends: at("2026-11-30T20:53:00Z"),
                 metadata: { play_gap: KEY, play_gap_from: "active" } });
  paid("sub_c", 499, "2026-10-16T20:53:00Z", "2026-11-16T20:53:00Z");
  sub("sub_k", { status: "trialing", ends: at("2026-11-29T01:21:00Z"), metadata: { launch: "hero", play_gap: KEY } });
  sub("sub_comp", { plan: "legend", ends: at("2026-11-20T00:00:00Z"), metadata: { comp: "1" } });
  paid("sub_comp", 0, "2026-10-20T00:00:00Z", "2026-11-20T00:00:00Z");
  sub("sub_pd", { status: "past_due", ends: at("2026-10-25T00:00:00Z") });
  // Cancelled: a Keep Hero trial (flexible billing's cancel_at), and a paid Legend whose month runs to Nov 15.
  sub("sub_kx", { status: "trialing", ends: at("2026-11-30T14:18:00Z"), cancel_at: s(at("2026-11-30T14:18:00Z")),
                  metadata: { launch: "hero", play_gap: KEY } });
  sub("sub_lx", { plan: "legend", status: "trialing", ends: at("2026-11-29T11:19:00Z"), cancel_at_period_end: true,
                  metadata: { play_gap: KEY, play_gap_from: "active" } });
  paid("sub_lx", 999, "2026-10-15T11:19:00Z", "2026-11-15T11:19:00Z");
  const view = out => Object.fromEntries(out.subscriptions.map(r => [r.id, [r.why, r.lastPaid, r.unusedDays, r.credit, r.charge]]));

  const plain = await payDay(env, { at: DAY_AT });
  assert.deepEqual(view(plain), {
    sub_l: ["would move", 1999, 10.2, 0, 1999], sub_c: ["would move", 499, 11.9, 0, 999], sub_k: ["would move", 0, 0, 0, 499],
    sub_comp: ["would move", 0, 0, 0, 0], sub_pd: ["payment failing", undefined, undefined, undefined, undefined],
    sub_kx: ["would move", 0, 0, 0, 0], sub_lx: ["would move", 999, 10.5, 0, 0] });
  const ends = Object.fromEntries(plain.subscriptions.map(r => [r.id, r.to]));
  assert.deepEqual([ends.sub_kx, ends.sub_lx], [new Date(at(DAY_AT)).toISOString(), "2026-11-15T11:19:00.000Z"],
    "cancelled: a trial ends at the day, a paid month when what it paid for ends; neither is charged");
  assert.equal(posts("POST invoices/create_preview").filter(c => ["sub_kx", "sub_lx"].includes(c.body.get("subscription"))).length, 0);
  assert.deepEqual(plain.totals, { charge: 3497, credit: 0 }, "without a credit, the paid days after it are lost");
  const credited = await payDay(env, { at: DAY_AT, credit: true });
  assert.deepEqual(view(credited), {
    sub_l: ["would move", 1999, 10.2, 659, 1340], sub_c: ["would move", 499, 11.9, 192, 807], sub_k: ["would move", 0, 0, 0, 499],
    sub_comp: ["would move", 0, 0, 0, 0], sub_pd: ["payment failing", undefined, undefined, undefined, undefined],
    sub_kx: ["would move", 0, 0, 0, 0], sub_lx: ["would move", 999, 10.5, 0, 0] });
  assert.deepEqual(credited.totals, { charge: 2646, credit: 851 }, "what was paid for those days, in proportion: half for a 50% month");
  assert.equal(stripeCalls.filter(c => c.route.startsWith("POST") && !c.route.endsWith("create_preview")).length, 0,
    "dry runs change nothing");

  const done = await payDay(env, { at: DAY_AT, credit: true, dry: false });
  assert.deepEqual(done.counts, { moved: 6, "payment failing": 1 });
  assert.deepEqual([posts("POST subscriptions/sub_kx")[0].body.get("trial_end"), posts("POST subscriptions/sub_kx")[0].body.get("cancel_at")],
    [String(D), String(D)], "the cancelled trial ends at the day, never charged");
  assert.deepEqual([posts("POST subscriptions/sub_lx")[0].body.get("trial_end"), posts("POST subscriptions/sub_lx")[0].body.get("cancel_at")],
    [String(s(at("2026-11-15T11:19:00Z"))), null], "cancel_at_period_end follows the paid end by itself");
  const sent = posts("POST subscriptions/sub_l")[0].body;
  assert.deepEqual([sent.get("trial_end"), sent.get("proration_behavior"), sent.get("metadata[pay_day]"),
    sent.get("metadata[play_gap_from]")], [String(D), "none", new Date(L).toISOString(), "active"]);
  assert.deepEqual(posts("POST customers/cus_sub_l/balance_transactions").map(c => [c.body.get("amount"), c.key]),
    [["-659", "lf-payday-2026-11-04-sub_l-credit"]]);
  assert.equal(posts("POST customers/cus_sub_k/balance_transactions").length, 0, "nothing paid, nothing credited");
  stripeCalls = [];
  const again = await payDay(env, { credit: true, dry: false });   // the launch by default (the promo's end)
  assert.deepEqual([again.at, again.counts], [new Date(L).toISOString(), { "already on the day": 6, "payment failing": 1 }]);
  assert.equal(stripeCalls.filter(c => c.route.startsWith("POST") && !c.route.endsWith("create_preview")).length, 0, "once");
  assert.deepEqual([view(again).sub_l, again.totals], [["already on the day", 1999, 10.2, 659, 1340], { charge: 2646, credit: 851 }],
    "on the day, Stripe's preview has the credit already: it isn't taken off twice");
  assert.match((await payDay(env, { at: "November 4" })).error, /ISO/);
});

test("before the launch, an upgrade costs nothing until the launch, then the full price; after it, the rest of the month", async () => {
  const user = await player("upgrader");
  const row = (who, id, cus, plan) => env.DB.prepare("INSERT INTO entitlements (user_id, customer_id, subscription_id, plan, " +
    "status, current_period_end, updated) VALUES (?, ?, ?, ?, 'trialing', ?, ?)").bind(who.id, cus, id, plan,
    new Date(L).toISOString(), new Date(NOW).toISOString()).run();
  await row(user, "sub_up", "cus_up", "hero");
  sub("sub_up", { status: "trialing", ends: L, customer: "cus_up",
                  metadata: { user_id: user.id, pay_day: new Date(L).toISOString(), play_gap_from: "active" } });
  const preview = await changePlan(env, user, "champion");
  assert.equal(preview.preview.text, "Champion starts now, with nothing to pay until November 4: then $9.99 a month.");
  assert.equal(preview.preview.amount, 0);
  assert.equal(posts("POST invoices/create_preview").length, 0, "nothing to preview: nothing is charged now");
  const done = await changePlan(env, user, "champion", { confirm: true, from: "hero", quote: preview.preview.quote });
  assert.equal(done.text, "You're on Champion now, with nothing to pay until November 4: then $9.99 a month.");
  const change = posts("POST subscriptions/sub_up")[0].body;
  assert.deepEqual([change.get("items[0][price]"), change.get("items[0][discounts][0][coupon]"), change.get("proration_behavior"),
    change.get("trial_end"), change.get("payment_behavior")], ["price_champion_m", null, "none", null, null],
    "the trial carries on to the launch, and no coupon: full price from it");

  // A pre-order (active, its month anchored at the launch, nothing paid): the same, nothing now (LOR-835).
  const payer = await player("payer");
  await env.DB.prepare("INSERT INTO entitlements (user_id, customer_id, subscription_id, plan, status, current_period_end, " +
    "updated) VALUES (?, 'cus_pay', 'sub_pay', 'champion', 'active', ?, ?)").bind(payer.id, new Date(L).toISOString(),
    new Date(NOW).toISOString()).run();
  sub("sub_pay", { plan: "champion", ends: L, customer: "cus_pay", metadata: { user_id: payer.id, preorder: "1" } });
  stripeCalls = [];
  const up = await changePlan(env, payer, "legend");
  assert.deepEqual([up.preview.amount, posts("POST invoices/create_preview").length], [0, 0], "nothing charged now");
  assert.match(up.preview.text, /nothing to pay until November 4.*\$19\.99 a month/i);
  // After the launch: the rest of the month at full price, Stripe's own sum; a trial (if any were left) ends now.
  const after = promo(L + DAY);
  await changePlan(after, payer, "legend");
  const asked = posts("POST invoices/create_preview")[0].body;
  assert.deepEqual([asked.get("subscription_details[items][0][discounts][0][coupon]"), asked.get("subscription_details[proration_behavior]")],
    [null, "always_invoice"]);
  stripeCalls = [];
  await changePlan(env, payer, "legend", { confirm: true, from: "champion", quote: up.preview.quote });
  const swap = posts("POST subscriptions/sub_pay")[0].body;
  assert.deepEqual([swap.get("items[0][price]"), swap.get("items[0][discounts][0][coupon]"), swap.get("proration_behavior")],
    ["price_legend_m", null, "none"]);
  const keeper = await player("keeper");
  await row(keeper, "sub_keep", "cus_keep", "hero");
  sub("sub_keep", { status: "trialing", ends: L + 20 * DAY, customer: "cus_keep", metadata: { user_id: keeper.id, launch: "hero" } });
  stripeCalls = [];
  await changePlan(after, keeper, "champion");
  assert.equal(posts("POST invoices/create_preview")[0].body.get("subscription_details[trial_end]"), "now");

  // A downgrade from a plan free until the launch: this phase stays a trial to its end, then the smaller plan.
  const down = await player("downer");
  await row(down, "sub_down", "cus_down", "champion");
  sub("sub_down", { plan: "champion", status: "trialing", ends: L, customer: "cus_down",
                    metadata: { user_id: down.id, pay_day: new Date(L).toISOString(), play_gap_from: "active" } });
  const q = (await changePlan(env, down, "hero")).preview.quote;
  stripeCalls = [];
  await changePlan(env, down, "hero", { confirm: true, from: "champion", quote: q });
  const phases = posts("POST subscription_schedules/sched_new")[0].body;
  assert.deepEqual([phases.get("phases[0][end_date]"), phases.get("phases[0][trial_end]"), phases.get("phases[1][items][0][price]")],
    [String(s(L)), String(s(L)), "price_hero_m"]);
});

test("a paying plan moved to the launch still counts as paying, and /plans and /account say when it renews", async () => {
  const user = await player("buyer");
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  sub("sub_m", { plan: "legend", status: "trialing", ends: L, metadata: { user_id: user.id, pay_day: new Date(L).toISOString(),
                                                                          play_gap_from: "active" } });
  await hook("customer.subscription.updated", "sub_m");
  const plan = await planFor(env, user.id);
  assert.deepEqual([plan.id, plan.status, plan.renews, plan.paidBefore], ["legend", "trialing", new Date(L).toISOString(), true]);
  const report = await subscriptionReport(env);
  assert.deepEqual([report.paying, report.trialing.legend, report.monthlyUsd], [1, 0, 19.99]);
  // A Keep Hero trial isn't a paying plan yet.
  const other = await player("keeper");
  sub("sub_k2", { status: "trialing", ends: L, metadata: { user_id: other.id, launch: "hero" } });
  await hook("customer.subscription.updated", "sub_k2");
  assert.equal((await planFor(env, other.id)).paidBefore, undefined);
  assert.equal((await subscriptionReport(env)).trialing.hero, 1);
  const page = await plansFor(env, cookie);
  assert.equal(page.launch, preorderText(env));
  assert.equal(page.current.paidBefore, true);
  assert.equal(page.gap, undefined, "the play gap's line is gone");
});
