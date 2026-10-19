// Willo plan cancellations (Patrick, 2026-10-19: "Can you log canceling?"): every change Stripe's webhook tells us of,
// one row each, and one plain line in the team's Slack channel for each new one (lib/slack-feedback.js
// "cancellation": the plan, how long they had it, what they paid and the reason when Stripe has one; never an email,
// a name or an account). The webhook (functions/api/billing/[action].js) calls noteCancellation after lib/billing.js
// has applied the event; it never fails the webhook, and the Slack line goes out under waitUntil. /admin's Retention
// (lib/retention.js) reads the rows. Plain code, its own tables: nothing here runs on the answer path.
//
// A change is read from the event itself, the subscription as it was then and previous_attributes (what changed):
//   scheduled  the player cancelled; the plan runs to the end of what they paid for (or their trial), then ends
//   now        it ended without a cancellation waiting first: cancelled right away in Stripe's dashboard, by "Delete my
//              account" or a refund, or after payments failed (reason payment_failed)
//   ended      a scheduled one reached its end
//   undone     the player took a waiting cancellation back (Stripe's page, or Keep on /plans)
//   replaced   an account's extra subscription ended while another one stays (two checkouts paid at once,
//              lib/billing.js keepOldest): no one left, so it's never posted or counted
// Slack gets scheduled, now and undone: ended is the same cancellation reaching its date.
//
// Tables (setupCancellations):
//   plan_cancellations (id: the Stripe event's id, so a resent event is one row): subscription_id, user_id (NULL once
//     the account is deleted, lib/accounts.js), plan, kind, at (when: the cancellation's canceled_at, ended_at for an
//     end, the event's time for an undo), started (the subscription's start), ends (when the plan stops or stopped),
//     days (from started to at), paid_cents (what its invoices came to by then; NULL when Stripe couldn't be read),
//     trial (1: nothing had been charged yet, a trial or a plan whose first charge is at the launch, lib/billing.js
//     payDay), reason (Stripe's cancellation_details.reason: cancellation_requested, payment_failed,
//     payment_disputed), feedback (what the player picked on Stripe's page: too_expensive, missing_features, ...),
//     comment (what they wrote there), counted (0: a comped plan or a team account, lib/billing.js COMP_COUPONS and
//     lib/activity.js excluded_accounts), created.
//   plan_payments (invoice_id): what each paid invoice of a plan came to (cents, with tax, before any refund), from
//     invoice.paid (notePlanPayment), and from Stripe for invoices from before this log (paidSoFar);
//     plan_payments_read (subscription_id): the subscriptions whose older invoices have been read.

import { ACTIVE, PLANS, planOfPrice, stripe } from "./billing.js";
import { forwardFeedback } from "./slack-feedback.js";

export const CANCEL_EVENTS = ["customer.subscription.updated", "customer.subscription.deleted"];
export const KINDS = ["scheduled", "now", "ended", "undone", "replaced"];
export const POSTED = ["scheduled", "now", "undone"];
// Stripe's names for the portal's reasons and its own, as people say them.
export const FEEDBACK = { too_expensive: "too expensive", missing_features: "missing features",
  switched_service: "switched to something else", unused: "not using it enough", customer_service: "customer service",
  too_complex: "too complicated", low_quality: "quality", other: "other" };
export const REASONS = { cancellation_requested: "", payment_failed: "payments failed", payment_disputed: "payment disputed" };
// Statuses a plan has ended in. incomplete_expired is a checkout that was never paid: never a plan, so never logged.
const ENDED = ["canceled", "unpaid"];
const DAY_MS = 86400e3;

const SETUP = [
  `CREATE TABLE IF NOT EXISTS plan_cancellations (id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, user_id TEXT,
    plan TEXT, kind TEXT NOT NULL, at TEXT NOT NULL, started TEXT, ends TEXT, days INTEGER, paid_cents INTEGER,
    trial INTEGER NOT NULL DEFAULT 0, reason TEXT, feedback TEXT, comment TEXT, counted INTEGER NOT NULL DEFAULT 1,
    created TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS plan_cancellations_sub ON plan_cancellations (subscription_id, at)",
  "CREATE INDEX IF NOT EXISTS plan_cancellations_at ON plan_cancellations (at)",
  `CREATE TABLE IF NOT EXISTS plan_payments (invoice_id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL,
    cents INTEGER NOT NULL, paid TEXT NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS plan_payments_sub ON plan_payments (subscription_id)",
  "CREATE TABLE IF NOT EXISTS plan_payments_read (subscription_id TEXT PRIMARY KEY, read TEXT NOT NULL)",
];
const ready = new WeakMap();
export function setupCancellations(env) {
  if (!ready.has(env.DB)) ready.set(env.DB, env.DB.batch(SETUP.map(s => env.DB.prepare(s)))
    .catch(e => { ready.delete(env.DB); throw e; }));
  return ready.get(env.DB);
}

// "Delete my account" (lib/accounts.js USER_DATA): the record of a cancellation stays, without the account.
export const CANCELLATIONS_USER_DATA = [["UPDATE plan_cancellations SET user_id = NULL WHERE user_id = ?", u => u.id]];

const iso = ms => new Date(ms).toISOString();
const at = seconds => Number.isFinite(seconds) ? iso(seconds * 1000) : null;
const idOf = v => typeof v === "string" ? v : typeof v?.id === "string" ? v.id : null;
// A cancellation waiting for its date: at the period's end, or at a set time (cancel_at, newer API versions).
const waiting = s => Boolean(s?.cancel_at_period_end || s?.cancel_at);

// What an event changed about a subscription's cancellation: "scheduled", "undone" or "ended" (now or ended is decided
// against the log, noteCancellation), or null for anything else.
export function changeOf(event) {
  const s = event?.data?.object;
  if (!s || (s.object !== "subscription" && !String(s.id || "").startsWith("sub_"))) return null;
  if (event.type === "customer.subscription.deleted") return "ended";
  if (event.type !== "customer.subscription.updated") return null;
  const before = event.data.previous_attributes || {};
  const was = { ...s, ...before };   // previous_attributes holds the old value of each field that changed
  if (ENDED.includes(s.status) && !ENDED.includes(was.status)) return "ended";
  if (ENDED.includes(s.status) || s.status === "incomplete" || s.status === "incomplete_expired") return null;
  if (waiting(s) && !waiting(was)) return "scheduled";
  if (!waiting(s) && waiting(was) && ACTIVE.includes(s.status)) return "undone";
  return null;
}

// A paid invoice of a plan (invoice.paid), noted once. Never throws: it's only for these counts.
export async function notePlanPayment(env, invoice) {
  try {
    const sub = idOf(invoice?.parent?.subscription_details?.subscription ?? invoice?.subscription);
    if (!sub || typeof invoice.id !== "string" || !Number.isFinite(invoice.amount_paid)) return;
    await setupCancellations(env);
    const paid = at(invoice.status_transitions?.paid_at) || at(invoice.created) || iso(Date.now());
    await env.DB.prepare("INSERT OR IGNORE INTO plan_payments (invoice_id, subscription_id, cents, paid) VALUES (?, ?, ?, ?)")
      .bind(invoice.id, sub, invoice.amount_paid, paid).run();
  } catch (e) {
    console.warn(`cancellations: payment ${invoice?.id}: ${e?.message || e}`);
  }
}

// What a subscription's paid invoices came to (cents), its older invoices read from Stripe once (GET only), or null
// when they couldn't be read.
export async function paidSoFar(env, subscriptionId) {
  await setupCancellations(env);
  const read = await env.DB.prepare("SELECT 1 AS y FROM plan_payments_read WHERE subscription_id = ?").bind(subscriptionId).first();
  if (!read) {
    if (!env.STRIPE_SECRET_KEY) return null;
    try {
      const list = await stripe(env, "GET", "invoices", { subscription: subscriptionId, status: "paid", limit: 100 });
      const rows = (list?.data || []).filter(i => typeof i.id === "string" && Number.isFinite(i.amount_paid));
      await env.DB.batch([
        ...rows.map(i => env.DB.prepare("INSERT OR IGNORE INTO plan_payments (invoice_id, subscription_id, cents, paid) VALUES (?, ?, ?, ?)")
          .bind(i.id, subscriptionId, i.amount_paid, at(i.status_transitions?.paid_at) || at(i.created) || iso(Date.now()))),
        env.DB.prepare("INSERT OR IGNORE INTO plan_payments_read (subscription_id, read) VALUES (?, ?)").bind(subscriptionId, iso(Date.now())),
      ]);
    } catch (e) {
      console.warn(`cancellations: reading ${subscriptionId}'s invoices: ${e?.message || e}`);
      return null;
    }
  }
  const row = await env.DB.prepare("SELECT COALESCE(SUM(cents), 0) AS cents FROM plan_payments WHERE subscription_id = ?")
    .bind(subscriptionId).first();
  return row?.cents ?? 0;
}

// The account a subscription is for, as lib/billing.js stored it, and whether it counts: not a comped plan (plan_log)
// or a team account (excluded_accounts). Each table may not be there yet.
async function whoOf(env, s) {
  const customer = idOf(s.customer);
  const first = (sql, ...args) => env.DB.prepare(sql).bind(...args).first().catch(() => null);
  const [ent, log] = await Promise.all([
    customer ? first("SELECT user_id, subscription_id, plan FROM entitlements WHERE customer_id = ?", customer) : null,
    first("SELECT user_id, comp FROM plan_log WHERE subscription_id = ?", s.id),
  ]);
  let userId = ent?.user_id || log?.user_id || null;
  if (!userId && typeof s.metadata?.user_id === "string") {
    userId = (await first("SELECT id FROM users WHERE id = ?", s.metadata.user_id))?.id || null;
  }
  const team = userId ? await first("SELECT 1 AS y FROM excluded_accounts WHERE user_id = ? AND reason != 'counted'", userId) : null;
  return { userId, comp: Boolean(log?.comp), team: Boolean(team),
           other: ent && ent.subscription_id && ent.subscription_id !== s.id && ent.plan !== "free" };
}

// Logs what a verified Stripe event changed about a plan's cancellation (CANCEL_EVENTS), once per event, and posts a
// new one to Slack. Never throws. context: the Pages context ({env, request, waitUntil}). Returns the row, or null.
export async function noteCancellation(context, event) {
  const env = context?.env;
  try {
    let kind = changeOf(event);
    if (!kind || !env?.DB) return null;
    const s = event.data.object;
    await setupCancellations(env);
    const who = await whoOf(env, s);
    const created = Number.isFinite(event.created) ? event.created * 1000 : Date.now();
    if (kind === "ended") {
      // A cancellation waiting for this end (the newest row, unless it was taken back since): "ended", else "now".
      const last = await env.DB.prepare("SELECT kind FROM plan_cancellations WHERE subscription_id = ? AND kind != 'replaced' " +
        "ORDER BY at DESC, created DESC LIMIT 1").bind(s.id).first();
      kind = who.other ? "replaced" : last?.kind === "scheduled" ? "ended" : "now";
    }
    const whenMs = kind === "undone" ? created
      : (kind === "scheduled" ? s.canceled_at : kind === "now" ? s.canceled_at ?? s.ended_at : s.ended_at ?? s.canceled_at) * 1000;
    const when = Number.isFinite(whenMs) ? whenMs : created;
    const started = Number.isFinite(s.start_date ?? s.created) ? (s.start_date ?? s.created) * 1000 : null;
    const item = s.items?.data?.[0];
    const endsS = kind === "scheduled" ? s.cancel_at ?? item?.current_period_end ?? s.current_period_end
      : kind === "undone" ? null : s.ended_at ?? s.canceled_at;
    const planId = planOfPrice(item?.price);
    const details = s.cancellation_details || {};
    const row = {
      id: event.id, subscription_id: s.id, user_id: who.userId, plan: PLANS[planId] && planId !== "free" ? planId : null,
      kind, at: iso(when), started: started ? iso(started) : null, ends: at(endsS),
      days: started ? Math.max(0, Math.floor((when - started) / DAY_MS)) : null, paid_cents: null,
      trial: 0, reason: typeof details.reason === "string" ? details.reason : null,
      feedback: typeof details.feedback === "string" ? details.feedback : null,
      comment: typeof details.comment === "string" && details.comment.trim() ? details.comment.trim().slice(0, 1000) : null,
      counted: who.comp || who.team || kind === "replaced" ? 0 : 1, created: iso(Date.now()),
    };
    const added = await env.DB.prepare(
      "INSERT OR IGNORE INTO plan_cancellations (id, subscription_id, user_id, plan, kind, at, started, ends, days, paid_cents, " +
      "trial, reason, feedback, comment, counted, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(row.id, row.subscription_id, row.user_id, row.plan, row.kind, row.at, row.started, row.ends, row.days, null,
           0, row.reason, row.feedback, row.comment, row.counted, row.created).run();
    if (!added.meta.changes) return null;   // this event was logged already
    // What it paid, then the Slack line: after the webhook has answered.
    const job = (async () => {
      row.paid_cents = await paidSoFar(env, s.id);
      row.trial = row.paid_cents === 0 ? 1 : 0;
      await env.DB.prepare("UPDATE plan_cancellations SET paid_cents = ?, trial = ? WHERE id = ?")
        .bind(row.paid_cents, row.trial, row.id).run();
      if (POSTED.includes(kind)) await forwardFeedback({ env, request: context.request }, "cancellation",
        { id: row.id, ...cancellationLine(row) });
    })().catch(e => console.warn(`cancellations: ${event.id}: ${e?.message || e}`));
    if (typeof context.waitUntil === "function") context.waitUntil(job);
    else await job;
    return row;
  } catch (e) {
    console.warn(`cancellations: ${event?.type} ${event?.id}: ${e?.message || e}`);
    return null;
  }
}

// ---- Words ----

// How long a plan was kept, as people say it: "3 days", "1 week", "5 weeks".
export function keptFor(days) {
  if (!Number.isFinite(days)) return "";
  if (days < 7) return `${days} day${days === 1 ? "" : "s"}`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"}`;
}
export const dollars = cents => `$${(cents / 100).toFixed(2)}`;
const dayName = ms => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Why, in plain words: the player's pick, else Stripe's own reason (failed payments), and what they wrote. "" for none.
export function whyOf(row) {
  const picked = row.feedback ? FEEDBACK[row.feedback] || String(row.feedback).replace(/_/g, " ") : "";
  return picked || REASONS[row.reason] || "";
}

// The Slack line's parts, which lib/slack-feedback.js SOURCES.cancellation posts as one line: {title, parts[], comment}.
export function cancellationLine(row) {
  const plan = PLANS[row.plan]?.name || "Willo plan";
  const title = row.kind === "undone" ? `Cancellation taken back · ${plan}`
    : row.kind === "now" ? `${row.reason === "payment_failed" ? "Plan ended" : "Plan cancelled now"} · ${plan}`
    : `Plan cancelled · ${plan}`;
  const paid = row.paid_cents === null || row.paid_cents === undefined ? ""
    : row.paid_cents === 0 ? "never charged" : `paid ${dollars(row.paid_cents)}`;
  const ends = row.kind === "scheduled" && row.ends ? `runs to ${dayName(Date.parse(row.ends))}` : "";
  const why = row.kind === "undone" ? "" : whyOf(row);
  return {
    title,
    parts: [row.days === null || row.days === undefined ? "" : `${keptFor(row.days)} subscribed`, paid, ends,
            why ? `reason: ${why}` : row.kind === "undone" ? "" : "no reason given",
            row.counted ? "" : "team or comped account, not counted"],
    comment: row.kind === "undone" ? "" : row.comment || "",
  };
}
