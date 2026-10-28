// Willo quality (Mike, 10/18: the feedback loop): how often players report her answers or show they missed, what they
// ask for most and what she fails at most, from what's already kept: the answer log (lib/answer-log.js, its signals and
// topics; only players who keep "Help improve Willo's answers" on), the review queue (lib/answer-feedback.js) and the
// apps' anonymous daily counts (lib/featureuse.js, every install that shares them). /admin's Willo quality and the
// leader dashboards read it: GET /api/admin/willo?quality=1&days=<1-14>.
//
//   answers          kept answers in the window (Willo's and characters'), from `players` players
//   report_rate      kept answers with a 👎 "Not right" (signal "reported") / answers
//   frustration_rate kept answers the player showed they missed (MISSED: corrected, frustrated, gave up, asked again,
//                    asked again after a failure, typed right after asking out loud) / answers
//   failure_rate     kept answers that failed / answers; voice: cut off mid-answer, voice never played
//   backup           her own answers written by the Gemini backup (lib/companion-answers.js ANSWER_MODEL) / answers,
//                    as a count and backup_rate: while her brain is on Together (lib/together.js), the answers it fell
//                    back on. LOR-856 E1 (the Architect, 10/28): the backup stays the rules' Flash-Lite while it's rare,
//                    so a rise is the cue to look at it again.
//   speed            asked out loud, the talk key coming up to her first sound on the player's PC, less any time a
//                    narration held her answer (the app's times for the answer, sent with their next question:
//                    lib/answer-signals.js lastOf speed, lib/answer-log.js timeAnswer): answers timed, p50
//                    and p90 in ms against SPEED_BAR, and the same for each piece (heard, prep, answer, audio); by_day
//                    has p50 and p90 too; site: her spoken answers' time on the site (from the answer log, every
//                    app), before it asked the model (pre), the model's, and her first words out (first); pre_lookup
//                    and pre_plain, the time before the model with and without a look-up first; by_route, the model's
//                    time and first words out by the route she answered on (routeOf). LOR-856 E4.
//   days             the same per day, oldest first
//   topics           per topic (lib/answer-signals.js TOPICS): asked, missed (any MISSED or reported), failed, and
//                    miss_rate; asked_top (most asked first) and failing_top (most missed first, 3+ asked)
//   questions        the questions asked most (the same words, any case), with how many players and misses
//   reports          the queue's rows in the window by kind and reason, the open queue by status and class, and how many
//                    were fixed
//   installs         the apps' daily counts (all installs, numbers only): answers, 👎, 👍, failures by kind, voice
//                    failures, dropped takes

import { setupAnswerLog, KEEP_DAYS as LOG_DAYS } from "./answer-log.js";
import { setupFeedback, prepareFeedbackRead, REASONS, SAID_KINDS } from "./answer-feedback.js";
import { MISSED, TOPICS, topicOf } from "./answer-signals.js";
import { ANSWER_MODEL } from "./companion-answers.js";

const like = tags => `(${tags.map(() => "signals LIKE ?").join(" OR ")})`;
const likes = tags => tags.map(t => `%${t}%`);
const rate = (n, d) => (d ? Math.round((1000 * n) / d) / 1000 : null);
const MISS = like(MISSED), MISS_OR_REPORT = like([...MISSED, "reported"]);
// Her own answer on the backup: Willo's (no character speaking), on Gemini's answer model.
const BACKUP = "SUM(CASE WHEN operation = 'answer' AND COALESCE(npc, '') = '' AND model = ? THEN 1 ELSE 0 END)";
// The app counts (lib/featureuse.js KEYS): failures by kind, and the counts beside them.
export const INSTALL_METRICS = ["answer", "report", "like", "interrupt"];
export const INSTALL_KINDS = ["afail", "vfail", "take"];
// Willo's speed bar (Mike, 10/28: "Yes, use 1 s typical and 2 s at the slow end as Willo's speed bar"): the talk key
// coming up to her first sound, in ms.
export const SPEED_BAR = { p50: 1000, p90: 2000 };
const SPEED_SHOWN = ["heard", "prep", "answer", "audio"];
const SPEED_ROWS = 20_000;

// The value at fraction p of sorted numbers (nearest rank), or null with none.
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null);
const spread = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return { n: sorted.length, p50: pct(sorted, 0.5), p90: pct(sorted, 0.9) };
};
// Timed spoken answers ({day, speed_ms, speed}) to the report's speed.
// The route a spoken answer went by: its picture's (lib/companion-answers.js writeAnswer: deepseek, look,
// picture-direct, picture-fallback), else the model it was on (deepseek, gemini).
export const routeOf = r => /(?:^|,)route-([a-z-]+)/.exec(String(r.lookups || ""))?.[1]
  ?? (String(r.model || "").startsWith("together:") ? "deepseek" : "gemini");
function siteSpeed(rows) {
  const by = {};
  for (const r of rows) (by[routeOf(r)] ||= []).push(r);
  const looked = r => r.looked_up && !["no", "off", "facts"].includes(r.looked_up);
  return { pre: spread(rows.map(r => r.pre_ms)), model: spread(rows.map(r => r.model_ms)),
    first: spread(rows.map(r => r.first_ms)), pre_lookup: spread(rows.filter(looked).map(r => r.pre_ms)),
    pre_plain: spread(rows.filter(r => !looked(r)).map(r => r.pre_ms)),
    by_route: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { model: spread(v.map(r => r.model_ms)),
      first: spread(v.map(r => r.first_ms)) }])) };
}
function speedOf(rows) {
  const pieces = rows.map(r => { try { return JSON.parse(r.speed) || {}; } catch { return {}; } });
  const days = new Map();
  for (const r of rows) (days.get(r.day) || days.set(r.day, []).get(r.day)).push(r.speed_ms);
  return {
    bar: SPEED_BAR, ...spread(rows.map(r => r.speed_ms)),
    pieces: Object.fromEntries(SPEED_SHOWN.map(k => [k, spread(pieces.map(p => p[k]))])),
    by_day: new Map([...days].map(([day, ms]) => [day, spread(ms)])),
  };
}

// Rows of the answer log to one per topic: {topic, asked, players, missed, failed}.
function byTopic(rows) {
  const out = new Map();
  for (const r of rows) {
    const topic = r.topic || topicOf(r.question, { operation: r.operation, lookups: String(r.lookups || "").split(","),
      action: r.action });
    const t = out.get(topic) || out.set(topic, { topic, asked: 0, who: new Set(), missed: 0, failed: 0 }).get(topic);
    t.asked++; t.who.add(r.player); t.missed += r.missed; t.failed += r.failed;
  }
  return [...out.values()].map(({ who, ...t }) => ({ ...t, players: who.size }));
}

export async function qualityReport(env, { days = 7, now = new Date() } = {}) {
  const span = Math.min(Math.max(Number.parseInt(days, 10) || 7, 1), LOG_DAYS);
  const from = new Date(now.getTime() - span * 864e5).toISOString();
  await Promise.all([setupAnswerLog(env), setupFeedback(env)]);
  const all = (sql, ...binds) => prepareFeedbackRead(env, sql, now).bind(...binds).all().then(r => r.results);
  const [totals, byDay, topics, questions, kinds, reasons, open, fixed, installs, timed, site] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS answers, COUNT(DISTINCT player) AS players, " +
      "SUM(CASE WHEN signals LIKE '%reported%' THEN 1 ELSE 0 END) AS reported, " +
      "SUM(CASE WHEN signals LIKE '%liked%' THEN 1 ELSE 0 END) AS liked, " +
      `SUM(CASE WHEN ${MISS} THEN 1 ELSE 0 END) AS missed, ` +
      "SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed, " +
      "SUM(CASE WHEN signals LIKE '%interrupted%' THEN 1 ELSE 0 END) AS interrupted, " +
      "SUM(CASE WHEN signals LIKE '%voice_dropped%' THEN 1 ELSE 0 END) AS voice_dropped, " +
      `${BACKUP} AS backup, ` +
      "SUM(spoken) AS spoken FROM answer_log WHERE created >= ?").bind(...likes(MISSED), ANSWER_MODEL, from).first(),
    all("SELECT substr(created, 1, 10) AS day, COUNT(*) AS answers, " +
      "SUM(CASE WHEN signals LIKE '%reported%' THEN 1 ELSE 0 END) AS reported, " +
      `SUM(CASE WHEN ${MISS} THEN 1 ELSE 0 END) AS missed, ` +
      `${BACKUP} AS backup, ` +
      "SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed " +
      "FROM answer_log WHERE created >= ? GROUP BY day ORDER BY day", ...likes(MISSED), ANSWER_MODEL, from),
    // By topic, worked out from the question for what was kept before topics were (10/18: those 417 of 552 were
    // "everything else", a second row beside the real one).
    all("SELECT topic, question, operation, lookups, action, player, " +
      `CASE WHEN ${MISS_OR_REPORT} THEN 1 ELSE 0 END AS missed, ` +
      "CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END AS failed " +
      "FROM answer_log WHERE created >= ?", ...likes([...MISSED, "reported"]), from).then(byTopic),
    all("SELECT lower(trim(question, ' ?!.')) AS q, MIN(question) AS question, COUNT(*) AS asked, " +
      `COUNT(DISTINCT player) AS players, SUM(CASE WHEN ${MISS_OR_REPORT} THEN 1 ELSE 0 END) AS missed, ` +
      "MIN(COALESCE(topic, 'other')) AS topic FROM answer_log WHERE created >= ? AND operation = 'answer' " +
      "GROUP BY q HAVING COUNT(*) >= 2 ORDER BY players DESC, asked DESC LIMIT 15", ...likes([...MISSED, "reported"]), from),
    all("SELECT kind, COUNT(*) AS n, COUNT(DISTINCT user_hash) AS players FROM answer_feedback WHERE created >= ? " +
      "GROUP BY kind", from),
    all("SELECT reasons FROM answer_feedback WHERE created >= ? AND reasons IS NOT NULL", from),
    all("SELECT status, COALESCE(class, '') AS class, COUNT(*) AS n FROM answer_feedback " +
      "WHERE status IN ('new', 'triaged') GROUP BY status, class"),
    prepareFeedbackRead(env, "SELECT COUNT(*) AS n, SUM(CASE WHEN followup = 1 THEN 1 ELSE 0 END) AS followups, " +
      "SUM(CASE WHEN told_at IS NOT NULL THEN 1 ELSE 0 END) AS told FROM answer_feedback " +
      "WHERE status IN ('fixed', 'fact') AND COALESCE(fixed_at, updated, created) >= ?", now).bind(from).first(),
    installCounts(env, from.slice(0, 10)),
    all("SELECT substr(created, 1, 10) AS day, speed_ms, speed FROM answer_log WHERE created >= ? AND speed_ms IS NOT NULL " +
      `ORDER BY id DESC LIMIT ${SPEED_ROWS}`, from).then(speedOf),
    all("SELECT pre_ms, model_ms, first_ms, model, looked_up, lookups FROM answer_log WHERE created >= ? AND spoken = 1 " +
      `AND operation = 'answer' AND COALESCE(npc, '') = '' AND model_ms IS NOT NULL ORDER BY id DESC LIMIT ${SPEED_ROWS}`,
      from).then(siteSpeed),
  ]);
  const answers = totals?.answers || 0;
  const topicRows = topics.map(t => ({ topic: t.topic, label: TOPICS[t.topic] || t.topic, asked: t.asked, players: t.players,
    missed: t.missed || 0, failed: t.failed || 0, miss_rate: rate((t.missed || 0) + (t.failed || 0), t.asked) }));
  const reasonCounts = Object.fromEntries(Object.keys(REASONS).map(r => [r, 0]));
  for (const row of reasons) for (const r of String(row.reasons).split(",")) if (r in reasonCounts) reasonCounts[r]++;
  const byKind = Object.fromEntries(kinds.map(k => [k.kind, k.n]));
  return {
    days: span, since: from, answers, players: totals?.players || 0, spoken: totals?.spoken || 0,
    reported: totals?.reported || 0, liked: totals?.liked || 0, missed: totals?.missed || 0, failed: totals?.failed || 0,
    report_rate: rate(totals?.reported || 0, answers), frustration_rate: rate(totals?.missed || 0, answers),
    failure_rate: rate(totals?.failed || 0, answers),
    backup: totals?.backup || 0, backup_rate: rate(totals?.backup || 0, answers),
    voice: { interrupted: totals?.interrupted || 0, voice_dropped: totals?.voice_dropped || 0,
      interrupt_rate: rate(totals?.interrupted || 0, totals?.spoken || 0), drop_rate: rate(totals?.voice_dropped || 0, totals?.spoken || 0) },
    speed: { bar: timed.bar, timed: timed.n, p50: timed.p50, p90: timed.p90, pieces: timed.pieces, site },
    by_day: byDay.map(d => ({ ...d, report_rate: rate(d.reported, d.answers), frustration_rate: rate(d.missed, d.answers),
      backup_rate: rate(d.backup, d.answers), speed: timed.by_day.get(d.day) || { n: 0, p50: null, p90: null } })),
    topics: {
      asked_top: [...topicRows].sort((a, b) => b.asked - a.asked),
      failing_top: topicRows.filter(t => t.asked >= 3).sort((a, b) => b.missed + b.failed - (a.missed + a.failed) ||
        (b.miss_rate || 0) - (a.miss_rate || 0)),
    },
    questions: questions.map(q => ({ question: q.question, topic: q.topic, asked: q.asked, players: q.players, missed: q.missed })),
    reports: {
      by_kind: byKind, said: SAID_KINDS.reduce((n, k) => n + (byKind[k] || 0), 0), signals: byKind.signal || 0,
      players: kinds.filter(k => k.kind !== "signal").reduce((n, k) => Math.max(n, k.players), 0),
      reasons: reasonCounts,
      open: open.reduce((o, r) => ({ ...o, [r.status]: (o[r.status] || 0) + r.n }), {}),
      open_by_class: open.filter(r => r.class).reduce((o, r) => ({ ...o, [r.class]: (o[r.class] || 0) + r.n }), {}),
      fixed: fixed?.n || 0, followups_fixed: fixed?.followups || 0, told: fixed?.told || 0,
    },
    installs,
  };
}

// The apps' anonymous daily counts since `day` (lib/featureuse.js usage_rollup), summed: none yet is all zeros.
async function installCounts(env, day) {
  const out = { answer: 0, report: 0, like: 0, interrupt: 0, afail: {}, vfail: {}, take: {} };
  try {
    const { results } = await env.DB.prepare("SELECT metric, SUM(n) AS n FROM usage_rollup WHERE day >= ? AND (" +
      INSTALL_METRICS.map(() => "metric = ?").join(" OR ") + " OR " + INSTALL_KINDS.map(() => "metric LIKE ?").join(" OR ") +
      ") GROUP BY metric").bind(day, ...INSTALL_METRICS, ...INSTALL_KINDS.map(k => `${k}.%`)).all();
    for (const { metric, n } of results) {
      const [kind, sub] = metric.split(".");
      if (sub && out[kind] && typeof out[kind] === "object") out[kind][sub] = n;
      else if (kind in out && !sub) out[kind] = n;
    }
  } catch (e) { /* no counts yet */ }
  return out;
}
