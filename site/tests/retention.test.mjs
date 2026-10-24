// /admin's Retention (lib/retention.js, functions/api/admin/retention.js, public/retention-csv.js): Willo plans by the
// week they started, how many are still on after each week, cancellations and their reasons, Patrick's one-line
// summary, and the CSVs. Comped plans and team accounts are left out; the beta's plans that first pay on November 4
// count from the day they started. Stripe is mocked through fetch; D1 is node:sqlite (helpers.mjs).
// Run: node --test 'site/tests/*.test.mjs'

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { onRequestGet as retention } from "../functions/api/admin/retention.js";
import { setup } from "../lib/accounts.js";
import { setupBilling } from "../lib/billing.js";
import { setupCancellations } from "../lib/cancellations.js";
import { retentionReport, summaryLine, cohorts } from "../lib/retention.js";
import { cohortCsv, subscriberCsv } from "../public/retention-csv.js";

import { d1 } from "./helpers.mjs";

const NOW = Date.parse("2026-10-19T12:00:00Z");   // a Monday
const DAY = 86400e3;
const env = { DB: d1(), STRIPE_SECRET_KEY: "sk_test_123", ADMIN_KEY: "admin-key" };
const originalFetch = globalThis.fetch;
let invoices, reads;

beforeEach(async () => {
  await setup(env);
  await setupBilling(env);
  await setupCancellations(env);
  for (const table of ["plan_log", "entitlements", "plan_cancellations", "plan_payments", "plan_payments_read", "excluded_accounts"])
    env.DB.sqlite.exec(`DELETE FROM ${table}`);
  invoices = {};
  reads = 0;
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname === "/v1/invoices") {
      reads++;
      return Response.json({ data: (invoices[u.searchParams.get("subscription")] || [])
        .map((cents, i) => ({ id: `in_${u.searchParams.get("subscription")}_${i}`, amount_paid: cents, status: "paid", created: NOW / 1000 })) });
    }
    return Response.json({ error: { message: "No such route" } }, { status: 404 });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

const iso = ms => new Date(ms).toISOString();
// A plan in plan_log, started `days` ago; cancelled `cancelledAfter` days after it started; paid `paid` (cents, per
// invoice) at Stripe.
function plan(id, { days, plan = "hero", cancelledAfter = null, ended = false, paid = [499], comp = "", user = `u_${id}`,
                     status = cancelledAfter === null ? "active" : ended ? "canceled" : "active" } = {}) {
  const started = NOW - days * DAY, canceled = cancelledAfter === null ? null : started + cancelledAfter * DAY;
  env.DB.sqlite.prepare("INSERT INTO plan_log (subscription_id, user_id, plan, status, started, canceled, ended, discounts, comp, updated) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)").run(id, user, plan, status, iso(started), canceled && iso(canceled),
    ended ? iso(canceled) : null, comp, iso(NOW));
  invoices[id] = paid;
}
const reason = (sub, feedback, comment = null) => env.DB.sqlite.prepare(
  "INSERT INTO plan_cancellations (id, subscription_id, user_id, plan, kind, at, days, paid_cents, reason, feedback, comment, counted, created) " +
  "VALUES (?, ?, ?, 'hero', 'scheduled', ?, 3, 250, 'cancellation_requested', ?, ?, 1, ?)").run(`evt_c${sub.slice(3)}`, sub, `u_${sub}`,
  iso(NOW - DAY), feedback, comment, iso(NOW));

// Patrick's example: 4 kept 2 weeks, 1 kept 1 week, 3 cancelled.
function patricksEight() {
  for (const id of ["a", "b", "c", "d"]) plan(`sub_${id}`, { days: 15 });
  plan("sub_e", { days: 9 });
  plan("sub_f", { days: 16, cancelledAfter: 3 });
  plan("sub_g", { days: 16, cancelledAfter: 5, ended: true, paid: [] });   // a trial cancelled, never charged
  plan("sub_h", { days: 10, cancelledAfter: 8, plan: "champion", paid: [500] });
}

test("Patrick's line, the weeks table and the cancellation reasons", async () => {
  patricksEight();
  reason("sub_f", "too_expensive", "Too pricey for me right now");
  const r = await retentionReport(env, { now: NOW });
  assert.equal(r.summary, "8 subscribers: 4 kept 2 weeks, 1 kept 1 week; 3 cancelled (2 in their first week, 1 after 1 week)");
  assert.deepEqual(r.totals, { subscribers: 8, on: 5, cancelled: 3, notCharged: 1, unread: 0, paidCents: 7 * 499 + 500 - 499 });
  // Started the week of Oct 5 (16 and 15 days ago: Oct 3 and 4 are the week of Sep 28) and Oct 12 (10 and 9 days ago).
  assert.deepEqual(r.cohorts.map(c => [c.week, c.n, c.cancelled, c.notCharged]),
    [["2026-10-05", 2, 1, 0], ["2026-09-28", 6, 2, 1]]);
  const [recent, older] = r.cohorts;
  assert.equal(r.weeks, 2);
  assert.deepEqual(older.kept, [{ after: 1, kept: 4, of: 6 }, { after: 2, kept: 4, of: 6 }]);
  assert.deepEqual(older.cancelledBy, { 0: 2 });
  assert.deepEqual(recent.kept, [{ after: 1, kept: 2, of: 2 }, null], "a week still to come isn't churn");
  assert.deepEqual(recent.cancelledBy, { 1: 1 });
  const f = r.subscribers.find(s => s.start === iso(NOW - 16 * DAY) && s.reason);
  assert.deepEqual([f.reason, f.comment, f.state], ["too expensive", "Too pricey for me right now", "cancelled"]);
  assert.equal(r.subscribers.find(s => s.notCharged).state, "ended");
  assert.equal(JSON.stringify(r).match(/u_sub|sub_[a-h]/), null, "never who: no account or subscription ids");
  // Every cancelled plan is in the log, those cancelled before it began too (without a reason: none was logged).
  assert.equal(r.cancellations.length, r.totals.cancelled);
  assert.deepEqual(r.cancellations.filter(c => c.comment).map(c => [c.kind, c.kept, c.reason, c.comment]),
    [["scheduled", "3 days", "too expensive", "Too pricey for me right now"]]);
  assert.deepEqual(r.cancellations.filter(c => !c.comment).map(c => c.kind).sort(), ["now", "scheduled"],
    "the trial that ended, and the plan still running to its end");
});

test("comped plans and team accounts are left out; only-paid leaves out what first pays on November 4", async () => {
  patricksEight();
  plan("sub_mike", { days: 20, plan: "legend", comp: "owner-legend-free", paid: [] });
  plan("sub_team", { days: 12, user: "u_team" });
  env.DB.sqlite.prepare("INSERT INTO excluded_accounts (user_id, reason, created) VALUES ('u_team', 'admin', 'x')").run();
  // Keep Hero, moved to the launch: on, nothing charged yet.
  plan("sub_keep", { days: 6, paid: [0] });
  const r = await retentionReport(env, { now: NOW });
  assert.deepEqual([r.totals.subscribers, r.totals.notCharged, r.leftOut.comped, r.leftOut.team], [9, 2, 1, 1]);
  assert.match(r.summary, /^9 subscribers: 4 kept 2 weeks, 1 kept 1 week, 1 in their first week; 3 cancelled/);
  const paid = await retentionReport(env, { now: NOW, paidOnly: true });
  assert.deepEqual([paid.totals.subscribers, paid.leftOut.notCharged], [7, 2]);
  assert.equal(paid.summary, "7 subscribers: 4 kept 2 weeks, 1 kept 1 week; 2 cancelled (1 in their first week, 1 after 1 week)");
});

test("what plans paid is read from Stripe a few at a time, once each, and an extra subscription that was replaced isn't a plan", async () => {
  plan("sub_x", { days: 3, paid: [250, 499] });
  plan("sub_y", { days: 3 });
  env.DB.sqlite.prepare("INSERT INTO plan_cancellations (id, subscription_id, plan, kind, at, counted, created) " +
    "VALUES ('evt_y', 'sub_y', 'hero', 'replaced', ?, 0, ?)").run(iso(NOW), iso(NOW));
  const r = await retentionReport(env, { now: NOW });
  assert.deepEqual([r.totals.subscribers, r.totals.paidCents, reads], [1, 749, 1]);
  await retentionReport(env, { now: NOW });
  assert.equal(reads, 1, "read once");
  // Stripe down: the plan still counts, its payments unknown.
  globalThis.fetch = async () => Response.json({ error: { message: "down" } }, { status: 500 });
  plan("sub_z", { days: 1 });
  const down = await retentionReport(env, { now: NOW });
  assert.deepEqual([down.totals.subscribers, down.totals.unread], [2, 1]);
});

test("the endpoint needs the admin key, and the CSVs have one line per week and per subscriber", async () => {
  patricksEight();
  const get = (headers, q = "") => retention({ env, request: new Request(`https://x.example/api/admin/retention${q}`, { headers }) });
  assert.equal((await get({})).status, 401);
  assert.equal((await get({ Authorization: "Bearer admin-key", Origin: "https://elsewhere.example" })).status, 403);
  const res = await get({ Authorization: "Bearer admin-key" }, "?paid=1");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.paidOnly, true);
  const report = await retentionReport(env, { now: NOW });
  const weeks = cohortCsv(report).trim().split("\n");
  assert.equal(weeks[0], "Start week (Monday),Plans,Not charged yet,Cancelled,Still on after 1 week,Still on after 2 weeks");
  assert.equal(weeks[2], "2026-09-28,6,1,2,4 of 6,4 of 6");
  assert.match(weeks.at(-1), /^Summary,"8 subscribers: 4 kept 2 weeks/);
  const subs = subscriberCsv(report).trim().split("\n");
  assert.equal(subs.length, 9);
  assert.equal(subs[0], "Started,Start week (Monday),Plan,Now,Paid so far (USD),Not charged yet,Cancelled or ended,Days kept,Weeks kept,Reason,What they wrote");
});

test("the summary and cohorts on their own", () => {
  assert.equal(summaryLine([]), "No subscribers yet.");
  const s = (daysAgo, churnAfter = null) => ({ start: iso(NOW - daysAgo * DAY), week: "w",
    churn: churnAfter === null ? null : iso(NOW - (daysAgo - churnAfter) * DAY), weeks: Math.floor((churnAfter ?? daysAgo) / 7) });
  assert.equal(summaryLine([s(2), s(30)]), "2 subscribers: 1 kept 4 weeks, 1 in their first week; none cancelled");
  assert.equal(summaryLine([s(10, 1)]), "1 subscriber: none still on; 1 cancelled (1 in their first week)");
  const { weeks, rows } = cohorts([s(200)], NOW);
  assert.deepEqual([weeks, rows[0].kept.length, rows[0].kept[11]], [12, 12, { after: 12, kept: 1, of: 1 }]);
});
