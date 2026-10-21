import { isReportRead } from "./report-read.js";
// What each plan's players really use, for pricing decisions (Mike, 2026-10-19: "Our discussion about the pricing and
// features in each pricing needs to be validated against Data"). Bookkeeping only: nothing here changes what a plan
// gets, and every write happens off the answer's way (after the reply, or on a path that isn't an answer).
//
// limit_hits, per account and UTC day: each time a live answer was turned away because a limit was reached (kind:
// "day", the plan's answers a day; "month", a paid plan's month; "cost_cap", a paying player's month of answers and
// hosted voice cost the plan's whole net, lib/billing.js capState; "brake", the free plan's brake), with the plan label
// when it last happened (planLabel) and how many times. Answers stepped down to Flash-Lite past the text cap aren't
// turned away: answer_log.model shows them (planUsageView models).
// Written from functions/api/companion/answer.js outOfAnswers. The trial's own limits are already kept elsewhere
// (lib/best-first.js: best_first.finished, best_first_days.capped), and so is a paid plan's look-ups (rate_limits).
//
// voice_days, per account, UTC day and what said it: who spoke a reply (kind: "willo", "character" or "line", one of
// Willo's own lines), the voice that said it as the companion is told ("finest:moonwell", "studio:sprite") or, when
// the PC said it, "pc:<why>" (speak.js's reason: "room" when the month's room for a hosted voice is used, "long",
// "busy", "unavailable", "off"), the Willo voice the player picked (pick, '' for none) and the plan label; replies
// (first pieces), pieces and letters. Written from functions/api/companion/speak.js after the audio has gone back.
//
// Neither holds anything players said: counts by account, like answer_days. "Delete my account" removes both
// (PLAN_USAGE_USER_DATA). /api/admin's "planUsage" (planUsageReport) sums them by plan for the last days.

import { setupAnswerLog, KEEP_DAYS as ANSWER_LOG_DAYS } from "./answer-log.js";
import { setupBilling, PLANS } from "./billing.js";

export const KEEP_DAYS = 90;
const SETUP = [
  `CREATE TABLE IF NOT EXISTS limit_hits (user_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL,
    plan TEXT, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day, kind))`,
  "CREATE INDEX IF NOT EXISTS limit_hits_day ON limit_hits (day)",
  `CREATE TABLE IF NOT EXISTS voice_days (user_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL,
    said TEXT NOT NULL, pick TEXT NOT NULL DEFAULT '', plan TEXT, replies INTEGER NOT NULL DEFAULT 0,
    pieces INTEGER NOT NULL DEFAULT 0, chars INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day, kind, said, pick))`,
  "CREATE INDEX IF NOT EXISTS voice_days_day ON voice_days (day)",
];
export const LIMIT_KINDS = ["day", "month", "cost_cap", "brake"];
export const VOICE_KINDS = ["willo", "character", "line"];

const ready = new WeakMap();
export async function setupPlanUsage(env) {
  if (isReportRead(env)) return;
  if (ready.get(env.DB)) return;
  await env.DB.batch(SETUP.map(sql => env.DB.prepare(sql)));
  ready.set(env.DB, true);
}

const dayOf = now => now.toISOString().slice(0, 10);
const word = (s, n) => (typeof s === "string" ? s.trim().toLowerCase().replace(/[^a-z0-9:_-]/g, "").slice(0, n) : "");

// A plan as the reports group it (lib/billing.js planFor's shape): "free" or "free-brake"; "beta-hero" (the beta's free
// Hero month); "reward-<plan>" (a free month for friends brought); a paid plan's id, with "-trialing" while Stripe calls
// it a trial (a Keep Hero trial, or a paid plan whose next charge moved to the launch). null when there's no plan.
export function planLabel(plan) {
  if (!plan?.id) return null;
  if (plan.reward) return `reward-${plan.id}`;
  if (plan.launch) return "beta-hero";
  if (plan.id === "free") return plan.brake ? "free-brake" : "free";
  return plan.status === "trialing" ? `${plan.id}-trialing` : plan.id;
}

// A live answer turned away by a limit (LIMIT_KINDS). Never throws: it's bookkeeping.
export async function recordLimit(env, userId, plan, kind, now = new Date()) {
  if (!env?.DB || !userId || !LIMIT_KINDS.includes(kind)) return false;
  try {
    await setupPlanUsage(env);
    await env.DB.prepare("INSERT INTO limit_hits (user_id, day, kind, plan, n) VALUES (?, ?, ?, ?, 1) " +
      "ON CONFLICT (user_id, day, kind) DO UPDATE SET n = n + 1, plan = excluded.plan")
      .bind(userId, dayOf(now), kind, planLabel(plan)).run();
    return true;
  } catch (e) {
    console.warn(`plan usage: limit: ${e?.message || e}`);
    return false;
  }
}

// One piece of a spoken reply (speak.js): kind (VOICE_KINDS), said (the voice that said it, or "pc:<reason>"), pick
// (the player's Willo voice, if they sent one), first (the reply's first piece: a reply is counted once), chars. Never
// throws.
export async function recordVoice(env, userId, plan, { kind, said, pick = "", first = true, chars = 0 } = {},
  now = new Date()) {
  const s = word(said, 40);
  if (!env?.DB || !userId || !VOICE_KINDS.includes(kind) || !s) return false;
  try {
    await setupPlanUsage(env);
    await env.DB.prepare("INSERT INTO voice_days (user_id, day, kind, said, pick, plan, replies, pieces, chars) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT (user_id, day, kind, said, pick) DO UPDATE SET " +
      "replies = replies + excluded.replies, pieces = pieces + 1, chars = chars + excluded.chars, plan = excluded.plan")
      .bind(userId, dayOf(now), kind, s, word(pick, 30), planLabel(plan), first ? 1 : 0,
        Math.max(0, Math.round(Number(chars) || 0))).run();
    return true;
  } catch (e) {
    console.warn(`plan usage: voice: ${e?.message || e}`);
    return false;
  }
}

// "Delete my account" (lib/accounts.js USER_DATA): the account's rows here.
export const PLAN_USAGE_USER_DATA = [
  ["DELETE FROM limit_hits WHERE user_id = ?", u => u.id],
  ["DELETE FROM voice_days WHERE user_id = ?", u => u.id],
];

// The last `days` UTC days by plan label, for /api/admin (and the pricing page's numbers):
//   {days, since, limits: [{plan, kind, players, n}], voices: [{plan, kind, said, players, replies, chars}],
//    picks: [{plan, pick, players, replies}]}
// Rows older than KEEP_DAYS go first. now: a Date or milliseconds (/api/admin passes Date.now()).
export async function planUsageReport(env, { days = 14, now = new Date() } = {}) {
  now = new Date(now);
  await setupPlanUsage(env);
  const span = Math.min(Math.max(Number.parseInt(days, 10) || 14, 1), KEEP_DAYS);
  const since = dayOf(new Date(now.getTime() - (span - 1) * 864e5));
  const oldest = dayOf(new Date(now.getTime() - KEEP_DAYS * 864e5));
  if (!isReportRead(env)) await env.DB.batch([env.DB.prepare("DELETE FROM limit_hits WHERE day < ?").bind(oldest),
    env.DB.prepare("DELETE FROM voice_days WHERE day < ?").bind(oldest)]);
  const all = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).all().then(r => r.results);
  const [limits, voices, picks] = await Promise.all([
    all("SELECT COALESCE(plan, '') AS plan, kind, COUNT(DISTINCT user_id) AS players, SUM(n) AS n FROM limit_hits " +
      "WHERE day >= ? GROUP BY plan, kind ORDER BY plan, kind", since),
    all("SELECT COALESCE(plan, '') AS plan, kind, said, COUNT(DISTINCT user_id) AS players, SUM(replies) AS replies, " +
      "SUM(chars) AS chars FROM voice_days WHERE day >= ? GROUP BY plan, kind, said ORDER BY plan, kind, said", since),
    all("SELECT COALESCE(plan, '') AS plan, pick, COUNT(DISTINCT user_id) AS players, SUM(replies) AS replies " +
      "FROM voice_days WHERE day >= ? AND kind = 'willo' AND pick != '' GROUP BY plan, pick ORDER BY plan, pick", since),
  ]);
  return { days: span, since, limits, voices, picks };
}

// When the plan labels, limit hits, voices and checkout sources started being kept (PRs #1322, #1323): a day range
// that starts earlier only has them from here.
export const COLLECTING_SINCE = "2026-10-19";
// When her answers moved to 3.6 Flash, and a paying plan's past its text cap to Flash-Lite (PR #1328, live on the site
// 10/19 at 22:12 UTC, plus a few minutes for the deploy): before it every answer of hers was on Flash-Lite. Since PR
// #1339 (10/19, Mike: the smarter model is Legend's only) only a plan with `smarter` (lib/billing.js PLANS) is on 3.6
// Flash, so only its answers can step down: every other plan's are on Flash-Lite anyway. The models are
// lib/companion-answers.js SMART_MODEL and LITE_MODEL (modelFor), named here rather than imported, so this bookkeeping
// (lib/accounts.js imports it) doesn't pull in the answer path.
export const STEP_DOWN_SINCE = "2026-10-19T22:20:00.000Z";
const SMART_MODEL = "gemini-3.6-flash", LITE_MODEL = "gemini-3.1-flash-lite";
// A plan label (planLabel) whose plan has the smarter model: Legend, its Stripe trial, its free month for friends.
// The beta's free Hero month is Hero's.
const smarterLabel = p => Boolean(PLANS[(p || "").replace(/^reward-/, "").replace(/-trialing$/, "")]?.smarter);

// /admin's Growth > Plans & usage (functions/api/admin/plans-usage.js, public/admin-plans.js): planUsageReport, and
//   answers: [{plan, players, answers, spoken, typed, quick, required, sight, characters}]   from the kept answers
//            (lib/answer-log.js: only players who leave "Help improve Willo's answers" on, and at most its 14 days),
//            by the plan label each was answered on; answersDays: how many days those cover
//   models: [{plan, players, answers, flash, stepped, steppedPlayers, share}]   a smarter plan's answers of hers (not a
//            character's; smarterLabel: Legend's) among those kept answers, since the step-down began (modelsSince,
//            STEP_DOWN_SINCE): on 3.6 Flash (flash), or stepped down to Flash-Lite past the plan's text cap (stepped, for
//            steppedPlayers players; share: stepped of answers). No other plan's answers are on 3.6 Flash to step down
//   allAnswers: every live answer in the range (answer_days, all players, no plan)
//   sources: [{source, plan, n}]   plans by where their checkout started (plan_log, comped plans left out)
//   collectingSince
export async function planUsageView(env, { days = 14, now = new Date() } = {}) {
  now = new Date(now);
  const [usage] = await Promise.all([planUsageReport(env, { days, now }), setupAnswerLog(env), setupBilling(env)]);
  const sinceIso = new Date(`${usage.since}T00:00:00Z`).toISOString();
  const answersFrom = new Date(Math.max(Date.parse(sinceIso), now.getTime() - ANSWER_LOG_DAYS * 864e5)).toISOString();
  const all = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).all().then(r => r.results);
  const modelsSince = answersFrom > STEP_DOWN_SINCE ? answersFrom : STEP_DOWN_SINCE;
  const [answers, byModel, allAnswers, sources] = await Promise.all([
    all("SELECT COALESCE(plan, '') AS plan, COUNT(DISTINCT player) AS players, COUNT(*) AS answers, " +
      "SUM(spoken = 1) AS spoken, SUM(spoken = 0) AS typed, SUM(looked_up = 'quick') AS quick, " +
      "SUM(looked_up = 'required') AS required, SUM(',' || COALESCE(lookups, '') || ',' LIKE '%,sight,%') AS sight, " +
      "SUM(operation = 'character') AS characters FROM answer_log WHERE created >= ? AND outcome != 'failed' " +
      "GROUP BY plan ORDER BY answers DESC", answersFrom),
    all("SELECT COALESCE(plan, '') AS plan, COUNT(DISTINCT player) AS players, COUNT(*) AS answers, " +
      "SUM(model IS ?) AS flash, SUM(model IS ?) AS stepped, " +
      "COUNT(DISTINCT CASE WHEN model IS ? THEN player END) AS steppedPlayers FROM answer_log " +
      "WHERE created >= ? AND operation = 'answer' AND outcome != 'failed' GROUP BY plan ORDER BY answers DESC",
      SMART_MODEL, LITE_MODEL, LITE_MODEL, modelsSince),
    env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS answers, COUNT(DISTINCT user_id) AS players FROM answer_days WHERE day >= ?")
      .bind(usage.since).first().catch(() => ({ answers: 0, players: 0 })),
    all("SELECT COALESCE(source, '') AS source, plan, COUNT(*) AS n FROM plan_log WHERE plan IS NOT NULL " +
      "AND (comp IS NULL OR comp = '') GROUP BY source, plan ORDER BY n DESC"),
  ]);
  const models = byModel.filter(m => smarterLabel(m.plan))
    .map(m => ({ ...m, share: m.answers ? Math.round(1000 * m.stepped / m.answers) / 1000 : 0 }));
  return { ...usage, answers, answersDays: Math.ceil((now.getTime() - Date.parse(answersFrom)) / 864e5),
           models, modelsSince, allAnswers, sources, collectingSince: COLLECTING_SINCE };
}
