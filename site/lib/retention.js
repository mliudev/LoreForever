import { isReportRead } from "./report-read.js";
// How long Willo plans are kept (Patrick, 2026-10-19: "a ratio of retention per week (4 users for 2 weeks 1 user for 1
// week 3 cancelled, etc)"), for /admin's Growth > Retention (functions/api/admin/retention.js, public/admin-retention.js).
// Read only, from plan_log (lib/billing.js: every subscription, when it started, was cancelled and ended), the
// cancellation log (lib/cancellations.js: the reason given) and what each plan has paid (plan_payments, older invoices
// read from Stripe a few at a time, GET only). Nothing here runs on the answer path.
//
// Who counts: every Willo plan a player started (Hero, Champion, Legend), not Mike's comped Legend or another comped
// plan (plan_log comp) or a team or test account (excluded_accounts), not a checkout that never became a plan
// (incomplete), and not an extra subscription an account's other one replaced (lib/cancellations.js "replaced").
// The beta's moved billing (lib/billing.js payDay, and checkouts anchored at the launch): several plans first pay on
// November 4, so a plan counts from the day it started whether it has been charged yet or not; notCharged says which
// have paid nothing so far, and paidOnly leaves those out.
//
// A plan is kept until the player cancels it (when they asked, though it runs to the end of what they paid for), or
// until it ended without a cancellation (failed payments, say). Weeks are whole weeks from the day it started; start
// weeks begin on Monday, UTC, as the funnel's do.

import { setupBilling, checkPlanLog, PAID, PLANS } from "./billing.js";
import { setupCancellations, paidSoFar, whyOf, keptFor, FEEDBACK } from "./cancellations.js";
import { weekOf } from "./activity.js";
import { noteStates, TEMPLATE } from "./winback.js";

const DAY_MS = 86400e3, WEEK_MS = 7 * DAY_MS;
export const MAX_WEEKS = 12;    // columns: after 1 to 12 weeks at most
export const READ_PER_LOAD = 20;   // subscriptions whose older invoices are read from Stripe per load

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const weeksWord = w => w === 0 ? "in their first week" : `after ${plural(w, "week")}`;

// One subscriber as /admin shows it, nothing about who: {start (ISO), week (its Monday), plan, state ("on",
// "cancelled": asked, still running to `ends`, "ended"), paid (cents, or null: not read yet), notCharged, churn (ISO:
// when it was cancelled or ended, else null), days, weeks (kept so far, or until churn), reason (in words, from the
// cancellation log), comment (what the player wrote on Stripe's page)}.
function subscriberOf(r, now) {
  const started = Date.parse(r.started);
  const churned = r.canceled ? Date.parse(r.canceled) : r.ended ? Date.parse(r.ended)
    : ["canceled", "unpaid"].includes(r.status) ? Date.parse(r.updated) : null;
  const until = churned ?? now;
  const days = Math.max(0, Math.floor((until - started) / DAY_MS));
  const paid = r.read || r.paid_cents ? r.paid_cents || 0 : null;
  const ended = Boolean(r.ended) || ["canceled", "unpaid", "incomplete_expired"].includes(r.status);
  return {
    start: new Date(started).toISOString(), week: weekOf(r.started.slice(0, 10)), plan: r.plan,
    state: ended ? "ended" : churned ? "cancelled" : "on", ends: r.ends || null,
    paid, notCharged: paid === 0, churn: churned ? new Date(churned).toISOString() : null, days, weeks: Math.floor(days / 7),
    reason: r.feedback || r.reason ? whyOf(r) : "", comment: r.comment || "",
  };
}

// The cohorts: one per start week, newest first: {week, n, notCharged, cancelled, cancelledBy: {weeks kept: n}, kept:
// [{after (weeks), kept, of} ...]}: of the plans `after` weeks old by now, how many weren't cancelled by then (only
// those old enough count, so a week still going says so instead of looking like churn). weeks: how many columns.
export function cohorts(subscribers, now = Date.now()) {
  const by = new Map();
  for (const s of subscribers) by.set(s.week, [...(by.get(s.week) || []), s]);
  const oldest = subscribers.reduce((m, s) => Math.min(m, Date.parse(s.start)), now);
  const weeks = Math.min(MAX_WEEKS, Math.max(1, Math.floor((now - oldest) / WEEK_MS)));
  const rows = [...by.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([week, list]) => {
    const kept = [];
    for (let after = 1; after <= weeks; after++) {
      const old = list.filter(s => Date.parse(s.start) + after * WEEK_MS <= now);
      kept.push(old.length ? { after, of: old.length,
        kept: old.filter(s => !s.churn || Date.parse(s.churn) >= Date.parse(s.start) + after * WEEK_MS).length } : null);
    }
    const cancelledBy = {};
    for (const s of list) if (s.churn) cancelledBy[s.weeks] = (cancelledBy[s.weeks] || 0) + 1;
    return { week, n: list.length, notCharged: list.filter(s => s.notCharged).length,
             cancelled: list.filter(s => s.churn).length, cancelledBy, kept };
  });
  return { weeks, rows };
}

// Patrick's line: "8 subscribers: 4 kept 2 weeks, 1 kept 1 week, 2 in their first week; 3 cancelled (2 in their
// first week, 1 after 1 week)". Still-on plans by the whole weeks they have so far, longest first.
export function summaryLine(subscribers) {
  if (!subscribers.length) return "No subscribers yet.";
  // By whole weeks: still-on plans longest first, cancellations soonest first.
  const count = (list, longest) => {
    const m = new Map();
    for (const s of list) m.set(s.weeks, (m.get(s.weeks) || 0) + 1);
    return [...m.entries()].sort((a, b) => longest ? b[0] - a[0] : a[0] - b[0]);
  };
  const on = count(subscribers.filter(s => !s.churn), true).map(([w, n]) => w === 0 ? `${n} in their first week` : `${n} kept ${plural(w, "week")}`);
  const gone = subscribers.filter(s => s.churn);
  const parts = [`${plural(subscribers.length, "subscriber")}: ${on.join(", ") || "none still on"}`];
  if (gone.length) parts.push(`${gone.length} cancelled (${count(gone, false).map(([w, n]) => `${n} ${weeksWord(w)}`).join(", ")})`);
  else parts.push("none cancelled");
  return parts.join("; ");
}

// The report. paidOnly: only plans that have paid something. now: for tests. Each cancellation also says whether
// Patrick can write to that player (note: lib/winback.js noteStates) and the note written (written: {status, at}), and
// template is what the box starts with.
export async function retentionReport(env, { paidOnly = false, now = Date.now() } = {}) {
  await setupBilling(env);
  await setupCancellations(env);
  // Comps first (checkPlanLog reads the coupons plan_log hasn't yet, GET only), then what older plans paid.
  try { await checkPlanLog(env); } catch (e) { console.warn(`retention: plan_log: ${e?.message || e}`); }
  const all = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
  const team = "COALESCE(p.user_id, '') IN (SELECT user_id FROM excluded_accounts WHERE reason != 'counted')";
  const replaced = "p.subscription_id IN (SELECT subscription_id FROM plan_cancellations WHERE kind = 'replaced')";
  const unread = await all("SELECT p.subscription_id FROM plan_log p WHERE p.started IS NOT NULL AND COALESCE(p.comp, '') = '' " +
    `AND NOT ${team} AND NOT ${replaced} AND p.subscription_id NOT IN (SELECT subscription_id FROM plan_payments_read) LIMIT ?`,
    READ_PER_LOAD);
  if (!isReportRead(env)) await Promise.all(unread.map(r => paidSoFar(env, r.subscription_id)));
  const [rows, left, log] = await Promise.all([
    // Each plan, its payments, and its newest cancellation's reason (lib/cancellations.js).
    all("SELECT p.subscription_id, p.plan, p.status, p.started, p.canceled, p.ended, p.updated, " +
        "(SELECT SUM(cents) FROM plan_payments m WHERE m.subscription_id = p.subscription_id) AS paid_cents, " +
        "EXISTS (SELECT 1 FROM plan_payments_read r WHERE r.subscription_id = p.subscription_id) AS read, " +
        "c.reason, c.feedback, c.comment, c.ends FROM plan_log p LEFT JOIN plan_cancellations c ON c.id = (" +
        "SELECT id FROM plan_cancellations WHERE subscription_id = p.subscription_id AND kind != 'undone' " +
        "ORDER BY at DESC, created DESC LIMIT 1) " +
        `WHERE p.started IS NOT NULL AND COALESCE(p.comp, '') = '' AND NOT ${team} AND NOT ${replaced} ` +
        "AND p.status NOT IN ('incomplete', 'incomplete_expired') ORDER BY p.started"),
    all(`SELECT SUM(COALESCE(p.comp, '') != '') AS comped, SUM(COALESCE(p.comp, '') = '' AND ${team}) AS team ` +
        "FROM plan_log p WHERE p.started IS NOT NULL"),
    all("SELECT id, subscription_id, kind, at, plan, days, paid_cents, ends, reason, feedback, comment FROM plan_cancellations " +
        "WHERE counted = 1 AND kind != 'replaced' ORDER BY at DESC LIMIT 200"),
  ]);
  // Whether Patrick can write to each (lib/winback.js), and the notes written.
  const { states, notes } = await noteStates(env, log.map(c => c.id));
  const everyone = rows.filter(r => PAID.includes(r.plan)).map(r => subscriberOf(r, now));
  const subscribers = paidOnly ? everyone.filter(s => s.paid > 0) : everyone;
  const { weeks, rows: table } = cohorts(subscribers, now);
  return {
    now: new Date(now).toISOString(), paidOnly, weeks, cohorts: table, summary: summaryLine(subscribers),
    totals: { subscribers: subscribers.length, on: subscribers.filter(s => !s.churn).length,
              cancelled: subscribers.filter(s => s.churn).length, notCharged: subscribers.filter(s => s.notCharged).length,
              unread: subscribers.filter(s => s.paid === null).length,
              paidCents: subscribers.reduce((a, s) => a + (s.paid || 0), 0) },
    leftOut: { comped: left[0]?.comped || 0, team: left[0]?.team || 0,
               notCharged: paidOnly ? everyone.length - subscribers.length : 0 },
    subscribers: [...subscribers].reverse(),
    cancellations: log.map(c => ({ id: c.id, kind: c.kind, at: c.at, plan: c.plan, planName: PLANS[c.plan]?.name || "",
      days: c.days, kept: keptFor(c.days), paid: c.paid_cents, ends: c.ends, reason: c.kind === "undone" ? "" : whyOf(c),
      feedback: FEEDBACK[c.feedback] ? c.feedback : null, comment: c.comment || "",
      note: states[c.id] || "not this one", written: notes[c.subscription_id] || null })),
    template: TEMPLATE,
  };
}
