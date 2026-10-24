// Willo's numbers for /admin and the daily stats post (LOR-524, lib/willo-stats.js, lib/billing.js
// subscriptionReport): comped plans and the admin's own never count as revenue, and Willo's daily and weekly players
// are accounts that asked her, admin and test accounts left out. Stripe is mocked through fetch; D1 is node:sqlite
// (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { setup, findOrCreateUser } from "../lib/accounts.js";
import { setupBilling, billingReport, claimOf, TASTE_ANSWERS } from "../lib/billing.js";
import { markAsked, utcDay } from "../lib/activity.js";
import { willoReport } from "../lib/willo-stats.js";
import { d1 } from "./helpers.mjs";

const NOW = Date.parse("2026-10-15T18:00:00Z");
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

test("paying plans and the monthly revenue leave out comped plans and the admin's own; trials are apart", async () => {
  const env = { DB: d1(), STRIPE_SECRET_KEY: "sk_test_1" };
  await setup(env);
  await setupBilling(env);
  const subs = {}, calls = [];
  const add = async (name, plan, { status = "active", coupon = null, cancelling = false } = {}) => {
    const user = await findOrCreateUser(env, { email: `${name}@example.com`, googleSub: name, name });
    subs[`sub_${name}`] = { id: `sub_${name}`, status, start_date: NOW / 1000 - 3600,
      items: { data: [{ price: { lookup_key: `${plan}_monthly` } }] },
      discounts: coupon ? [{ id: `di_${name}`, object: "discount", source: { type: "coupon", coupon } }] : [] };
    env.DB.sqlite.prepare("INSERT INTO entitlements (user_id, subscription_id, plan, status, current_period_end, " +
      "cancel_at_period_end, updated) VALUES (?, ?, ?, ?, ?, ?, ?)").run(user.id, `sub_${name}`, plan, status,
      new Date(NOW + 30 * 864e5).toISOString(), cancelling ? 1 : 0, new Date(NOW).toISOString());
    return user;
  };
  await add("half", "legend", { coupon: "lore_forever_launch_legend" });   // the beta's 50% first month: paying
  await add("owner", "legend", { coupon: "owner-legend-free" });           // Mike's own Legend
  const admin = await add("admin", "legend");                              // the account /admin is opened from
  await add("trial", "hero", { status: "trialing" });                     // Keep Hero, nothing charged yet
  await add("leaving", "hero", { cancelling: true });                     // cancelled: on Hero until it ends, never charged
  env.DB.sqlite.prepare("INSERT INTO excluded_accounts VALUES (?, 'admin', ?)").run(admin.id, new Date(NOW).toISOString());
  globalThis.fetch = async (url) => {
    const id = new URL(url).pathname.split("/").pop();
    calls.push(id);
    return subs[id] ? Response.json(subs[id]) : Response.json({ error: { message: "no such thing" } }, { status: 404 });
  };

  const report = await billingReport(env, new Date(NOW));
  assert.deepEqual([report.paying, report.monthlyUsd, report.comped, report.owner, report.trialing], [1, 19.99, 1, 1, 1]);
  const s = report.subscriptions;
  assert.deepEqual([s.byPlan.legend, s.comped.legend, s.owner.legend, s.trialing.hero, s.unchecked], [1, 1, 1, 1, 0]);
  assert.deepEqual([s.cancelling.hero, s.byPlan.hero, s.onPlan.cancelling], [1, 0, 1], "a cancelled plan isn't paying");
  assert.deepEqual(s.renewing, { count: 2, usd: 24.98 }, "renewing: the paying plan and the trial, at full price");
  assert.equal(s.days.at(-1).started, 3, "the paying, trial and cancelled plans started today; comped and admin's don't");
  assert.equal(calls.length, 5, "each subscription's coupons read once");
  await billingReport(env, new Date(NOW));
  assert.equal(calls.length, 5, "and not again while nothing changed");
});

test("on a plan: everyone above Adventurer once (paid, Keep Hero trial, the beta's free Hero month, comped or owner)", async () => {
  const env = { DB: d1(), LAUNCH_WEEK_START: "2026-10-14T00:00:00-07:00" };
  await setup(env);
  await setupBilling(env);
  const at = new Date(NOW).toISOString();
  const user = async name => (await findOrCreateUser(env, { email: `${name}@example.com`, googleSub: name, name })).id;
  const plan = async (name, plan, status, comp = "") => {
    const id = await user(name);
    env.DB.sqlite.prepare("INSERT INTO entitlements (user_id, subscription_id, plan, status, current_period_end, updated) " +
      "VALUES (?, ?, ?, ?, ?, ?)").run(id, `sub_${name}`, plan, status, new Date(NOW + 20 * 864e5).toISOString(), at);
    env.DB.sqlite.prepare("INSERT INTO plan_log (subscription_id, user_id, plan, status, comp, updated) VALUES (?, ?, ?, ?, ?, ?)")
      .run(`sub_${name}`, id, plan, status, comp, at);
    return id;
  };
  const freeMonth = async (id, daysAgo) => env.DB.sqlite.prepare("INSERT INTO promo_claims (claim, subscription_id, created) " +
    "VALUES (?, '', ?)").run(await claimOf(env, id, "free"), new Date(NOW - daysAgo * 864e5).toISOString());
  await plan("paid", "hero", "active");
  await plan("late", "champion", "past_due");
  await plan("comped", "legend", "active", "owner-legend-free");
  await freeMonth(await plan("keep", "hero", "trialing"), 5);       // took Keep Hero in its free month: one account, once
  await freeMonth(await user("month"), 3);                           // a free Hero month and nothing else
  await freeMonth(await user("month2"), 29);                         // the last day or so of one
  await freeMonth(await user("over"), 31);                           // ended yesterday: back on Adventurer
  const tester = await user("tester");
  await freeMonth(tester, 1);                                        // a test account's free month
  env.DB.sqlite.prepare("INSERT INTO excluded_accounts VALUES (?, 'config', ?)").run(tester, at);
  env.DB.sqlite.prepare("INSERT INTO promo_claims (claim, subscription_id, created) VALUES ('hero:x', 'sub_x', ?)").run(at);

  const on = async () => (await billingReport(env, new Date(NOW))).onPlan;
  assert.deepEqual(await on(), { total: 7, paid: 2, trial: 1, cancelling: 0, freeMonth: 2, comped: 2, freeUnread: false,
                                 byPlan: { hero: 5, champion: 1, legend: 1 } },
    "paid and late, 1 trial, 2 free Hero months, the comped Legend and the test account's free month");

  env.DB.sqlite.prepare("INSERT INTO answer_user_spend (user_id, month, launch_micro) VALUES ('x', '2026-10', 300000000)").run();
  assert.deepEqual([(await on()).freeMonth, (await on()).total], [0, 4], "the promo's brake stops the free months");
  assert.equal((await billingReport(env, new Date(NOW))).paying, 2, "paying is what it was");
});

test("on a plan: no free Hero months without a beta promo, and a plan that ran out isn't one", async () => {
  const env = { DB: d1() };
  await setup(env);
  await setupBilling(env);
  const user = await findOrCreateUser(env, { email: "a@example.com", googleSub: "a", name: "a" });
  env.DB.sqlite.prepare("INSERT INTO promo_claims (claim, subscription_id, created) VALUES (?, '', ?)")
    .run(await claimOf(env, user.id, "free"), new Date(NOW - 864e5).toISOString());
  env.DB.sqlite.prepare("INSERT INTO entitlements (user_id, subscription_id, plan, status, current_period_end, updated) " +
    "VALUES ('gone', 'sub_gone', 'legend', 'canceled', ?, ?)").run(new Date(NOW - 864e5).toISOString(), new Date(NOW).toISOString());
  const { onPlan } = await billingReport(env, new Date(NOW));
  assert.equal(onPlan.total, 0, "no LAUNCH_WEEK_START: planFor gives no free month, whatever promo_claims holds");
  assert.deepEqual(onPlan.byPlan, { hero: 0, champion: 0, legend: 0 });
});

test("Willo's daily and weekly players: accounts that asked her, admin's left out; downloads by day and in all", async () => {
  const env = { DB: d1() };
  // A database from before: the daily limit's count of yesterday's answers starts the week off.
  env.DB.sqlite.exec("CREATE TABLE rate_limits (user_id TEXT NOT NULL, bucket TEXT NOT NULL, n INTEGER NOT NULL, " +
    "PRIMARY KEY (user_id, bucket))");
  env.DB.sqlite.prepare("INSERT INTO rate_limits VALUES ('old', ?, 4), ('ip:x', ?, 1)")
    .run(`companion-answer:${utcDay(NOW, -1)}`, `companion-answer:${utcDay(NOW, -1)}`);
  await setup(env);
  env.DB.sqlite.exec("CREATE TABLE IF NOT EXISTS companion_days (day TEXT NOT NULL, install TEXT NOT NULL, companion TEXT, " +
    "addon TEXT, PRIMARY KEY (day, install))");
  env.DB.sqlite.exec("CREATE TABLE IF NOT EXISTS downloads (day TEXT NOT NULL, file TEXT NOT NULL, n INTEGER NOT NULL, " +
    "PRIMARY KEY (day, file))");
  env.DB.sqlite.prepare("INSERT INTO excluded_accounts VALUES ('mike', 'admin', ?)").run(new Date(NOW).toISOString());
  for (const [who, daysAgo] of [["a", 0], ["a", 0], ["a", 3], ["b", 1], ["mike", 1], ["c", 9]])
    await markAsked(env, who, NOW - daysAgo * 864e5);
  for (const [daysAgo, install, companion] of [[1, "i1", "0.18.0"], [1, "i2", "0.18.0-qa10"], [4, "i3", "0.17.0"]])
    env.DB.sqlite.prepare("INSERT INTO companion_days VALUES (?, ?, ?, '0.18.0')").run(utcDay(NOW, -daysAgo), install, companion);
  for (const [daysAgo, file, n] of [[0, "willo", 3], [1, "willo", 40], [1, "installer", 9], [12, "willo", 5]])
    env.DB.sqlite.prepare("INSERT INTO downloads VALUES (?, ?, ?)").run(utcDay(NOW, -daysAgo), file, n);

  const { summary: s, days } = await willoReport(env, NOW);
  assert.equal(s.day, utcDay(NOW, -1), "the last whole UTC day");
  assert.deepEqual([s.dau.day, s.wau.day, s.today.dau], [2, 3, 1], "yesterday: b and old; the week: a, b and old");
  assert.equal(days.at(-1).answers, 2);
  assert.deepEqual([s.running.day, s.running.week], [1, 2], "a -qa build is internal");
  assert.deepEqual(s.downloads, { day: 40, week: 40, prevWeek: 5, total: 48 });
  assert.equal(s.today.downloads, 3);
});

test("Willo's best first: what it cost a day, and plans and returns for the players who had it against those before", async () => {
  const { tasteReport } = await import("../lib/best-first.js");
  const env = { DB: d1() };
  await setup(env);
  await setupBilling(env);
  assert.equal(await tasteReport(env, new Date(NOW)), null, "nothing until a first answer at her best");
  const user = async name => (await findOrCreateUser(env, { email: `${name}@example.com`, googleSub: name, name })).id;
  const asked = (id, ...days) => days.forEach(day =>
    env.DB.sqlite.prepare("INSERT INTO answer_days (day, user_id, n) VALUES (?, ?, 1)").run(day, id));
  const [old, oldBack, fresh, freshPaid, test] = await Promise.all(["old", "oldback", "fresh", "paid", "tester"].map(user));
  asked(old, "2026-10-12");
  asked(oldBack, "2026-10-12", "2026-10-14");
  asked(fresh, "2026-10-15");
  asked(freshPaid, "2026-10-15");
  asked(test, "2026-10-15");
  for (const [id, used] of [[fresh, TASTE_ANSWERS], [freshPaid, 3], [test, 5]])
    env.DB.sqlite.prepare("INSERT INTO best_first (claim, user_id, used, started) VALUES (?, ?, ?, '2026-10-15T01:00:00Z')")
      .run(`taste:${id}`, id, used);
  env.DB.sqlite.prepare("INSERT INTO plan_log (subscription_id, user_id, plan, status, comp, updated) VALUES " +
    "('sub_1', ?, 'hero', 'trialing', '', ?)").run(freshPaid, new Date(NOW).toISOString());
  env.DB.sqlite.prepare("INSERT INTO excluded_accounts VALUES (?, 'config', ?)").run(test, new Date(NOW).toISOString());
  env.DB.sqlite.prepare("INSERT INTO best_first_days (day, spent_micro, reserved_micro, answers, capped) VALUES " +
    "('2026-10-15', 240000, 240000, 23, 2)").run();
  const r = await tasteReport(env, new Date(NOW));
  assert.deepEqual([r.tasters, r.finished, r.usd, r.capUsd], [2, 1, 0.24, 5], "the test account left out; the day's cap is $5");
  assert.equal(r.perTaster, 0.12);
  assert.deepEqual(r.days, [{ day: "2026-10-15", usd: 0.24, answers: 23, replies: 0, lines: 0, starts: 0, capped: 2, unreachable: 0 }]);
  assert.deepEqual(r.cohorts, { taste: { players: 2, paid: 1, returned: 0, week: 0 },
                                before: { players: 2, paid: 0, returned: 1, week: 0 } });
  // The first-run trial's uses (lib/best-first.js TRIAL), the test account left out.
  env.DB.sqlite.prepare("UPDATE best_first SET lookups = 2, tries = '{\"sight\":3,\"cast\":1}' WHERE user_id IN (?, ?)")
    .run(fresh, test);
  assert.deepEqual((await tasteReport(env, new Date(NOW))).trial,
    { trying: 2, lookups: 2, lookupsBy: 1, sight: 3, sightBy: 1, cast: 1, castBy: 1 });
});
