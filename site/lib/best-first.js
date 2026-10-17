// Willo's best first (LOR-602; Mike and Patrick, 2026-10-16: "Important to work on free users getting best experience
// for limited QA", "I guess I need to subsidize good voices for the free plan", and Patrick's "give you like 20
// interactions with premium voices"). A player who isn't paying (the free plan, or the beta's free Hero month:
// lib/billing.js planFor launch) gets their account's first TASTE_ANSWERS live answers at the top: asked out loud,
// Willo answers in her finest voice (Inworld's, lib/companion-voice.js speakTaste) and a character they talk to in
// their own; on the free plan those answers may also look online (up to TASTE_LOOKUPS, the stronger research path
// where a question needs it) and see the game, as a paid plan's do. Then Willo steps down to the plan's own path, and
// the companion shows it in her window as the Moonwell chorus going quiet (companion/lore_companion/core.py).
//
// Counted right: only live answers count (functions/api/companion/answer.js: an answer or a character's reply, never
// chat memory), each once and only when it's answered (a failed one gives its place back). Typed questions get text
// (Mike, 2026-10-14), so a taste answer asked out loud earns one reply in the finest voice (best_first.voices), which
// the reply's first piece takes (takeVoice); Willo's own lines (tips, hello) are in that voice while the taste lasts,
// without counting. The add-on's short answers read aloud never come here (lib/companion-voice.js keeps them on the PC,
// #914). Once per Google account, kept after "Delete my account" (the claim, as the starter's is), so deleting the
// account and signing in again doesn't bring another 20. Not on top of a paid plan: a paying player hears their plan.
//
// What it costs (10/16 prices): Inworld TTS 2 Flash at $15 a million letters, a spoken reply about 200 letters
// ($0.003; at most SPEAK_MAX_CHARS, $0.009), a quick look online about $0.03 ($0.05 for required research), an answer
// $0.0018 (the free plan's anyway). A typical new player (half their 20 asked out loud, two look-ups, a few tips) costs
// about $0.12; the most one can is about $0.45 (20 longest replies, TASTE_LOOKUPS look-ups, tips). All of it is paid
// from the shared monthly budget (lib/companion-answers.js, $100 for every free answer and voice), and a day's taste
// may cost at most TASTE_DAY_USD ($2: about 16 typical new players a day, $60 a month at the very most), so a spike
// can't spend the month in a day. Past it, the day's answers and replies take the plan's own path, uncounted (so
// nobody loses their 20), with the chorus resting in Willo's window until the next UTC day. The Pages variable
// TASTE_DAY_USD changes the cap without a code change.
//
// Tables (lib/billing.js SETUP): best_first, one row per Google account (claim: "taste:" and its one-way code, or
// "taste:user:<id>" without one): user_id (NULL once the account is deleted, so the count stays with the claim), used
// (taste answers so far), voices (finest replies earned and not yet said), lookups, started and finished (ISO).
// best_first_days, one row per UTC day: reserved_micro (what the day's taste holds and has spent, for the cap),
// spent_micro, answers, replies (in the finest voice), lines (Willo's own), starts (accounts' first taste answer),
// capped (answers or replies the cap sent down the plan's own path) and unreachable (finest replies no provider could
// say). /admin's Willo panel and the daily analytics post read them (tasteReport).

import { plansOn, setupBilling, claimOf, PAID, TASTE_ANSWERS } from "./billing.js";
import { counted } from "./activity.js";

export { TASTE_ANSWERS };
export const TASTE_LOOKUPS = 4;
export const TASTE_DAY_USD = 2;
// voice_replies' period for a reply in the taste's finest voice (lib/companion-voice.js speakTaste).
export const TASTE_PERIOD = "taste";
// A whole reply in the finest voice (SPEAK_MAX_CHARS letters at $15 a million): the room a reply needs on the day.
export const TASTE_REPLY_MICRO = 9_000;

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const dayOf = now => now.toISOString().slice(0, 10);

export function tasteDayMicro(env) {
  const usd = Number(env?.TASTE_DAY_USD ?? TASTE_DAY_USD);
  return Math.round((Number.isFinite(usd) && usd >= 0 ? usd : TASTE_DAY_USD) * 1e6);
}

// Whether this plan gets the taste at all: the free plan and the beta's free Hero month, while plans are on.
export const tasteFor = (env, plan) => plansOn(env) && Boolean(plan) && (plan.id === "free" || Boolean(plan.launch));

// The account's taste now, for the allowance: {of, left (answers), voices (finest replies earned, not yet said),
// on, why ("used": all 20 answered and said; "resting": the day's cap is reached)}; null for a plan without one.
export async function tasteState(env, userId, plan, now = new Date()) {
  if (!tasteFor(env, plan)) return null;
  await setupBilling(env);
  const [mine, day] = await env.DB.batch([
    env.DB.prepare("SELECT used, voices FROM best_first WHERE user_id = ?").bind(userId),
    env.DB.prepare("SELECT reserved_micro FROM best_first_days WHERE day = ?").bind(dayOf(now)),
  ]);
  // No row yet: a new account, or its Google account's from before "Delete my account", which becomes this one's.
  const row = mine.results?.[0] ?? await env.DB.prepare("UPDATE best_first SET user_id = ? WHERE claim = ? AND " +
    "user_id IS NULL RETURNING used, voices").bind(userId, await claimOf(env, userId, "taste")).first();
  const left = Math.max(0, TASTE_ANSWERS - (row?.used || 0)), voices = Math.max(0, row?.voices || 0);
  const resting = (day.results?.[0]?.reserved_micro || 0) + TASTE_REPLY_MICRO > tasteDayMicro(env);
  const why = !left && !voices ? "used" : resting ? "resting" : null;
  return { of: TASTE_ANSWERS, left, voices, on: !why, ...(why ? { why } : {}) };
}

// Takes one of the account's taste answers for a live answer about to be written, in one statement, so two questions
// at once can't both take the last; spoken: asked out loud, so it earns a reply in the finest voice. {claim, used,
// spoken}, or null: not this plan's, all 20 used, or the day's cap reached (counted as capped). An account's first
// take makes its row, or finds its Google account's from before "Delete my account".
export async function takeTaste(env, userId, plan, now = new Date(), { spoken = false } = {}) {
  if (!tasteFor(env, plan)) return null;
  await setupBilling(env);
  const at = iso(now.getTime());
  const take = () => env.DB.prepare(
    "UPDATE best_first SET used = used + 1, voices = voices + ?, started = COALESCE(started, ?), " +
    "finished = CASE WHEN used + 1 >= ? THEN ? ELSE finished END WHERE user_id = ? AND used < ? AND " +
    "COALESCE((SELECT reserved_micro FROM best_first_days WHERE day = ?), 0) < ? RETURNING claim, used"
  ).bind(spoken ? 1 : 0, at, TASTE_ANSWERS, at, userId, TASTE_ANSWERS, dayOf(now), tasteDayMicro(env)).first();
  let row = await take();
  if (!row) {
    const mine = await env.DB.prepare("SELECT used FROM best_first WHERE user_id = ?").bind(userId).first();
    if (mine) {
      if (mine.used < TASTE_ANSWERS) await countDay(env, now, "capped");
      return null;
    }
    const claim = await claimOf(env, userId, "taste");
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO best_first (claim, user_id) VALUES (?, ?)").bind(claim, userId),
      env.DB.prepare("UPDATE best_first SET user_id = ? WHERE claim = ? AND user_id IS NULL").bind(userId, claim),
    ]);
    row = await take();
    if (!row) {
      const used = (await env.DB.prepare("SELECT used FROM best_first WHERE user_id = ?").bind(userId).first())?.used;
      if (used !== undefined && used < TASTE_ANSWERS) await countDay(env, now, "capped");
      return null;
    }
  }
  return { claim: row.claim, used: row.used, spoken: Boolean(spoken) };
}

// A taste answer that failed, or never reached the model: its place back, and its finest reply if it earned one.
export async function returnTaste(env, taste) {
  if (!taste) return;
  await env.DB.prepare("UPDATE best_first SET used = MAX(0, used - 1), voices = MAX(0, voices - ?), finished = NULL " +
    "WHERE claim = ?").bind(taste.spoken ? 1 : 0, taste.claim).run();
}

// One of the taste's look-ups online (TASTE_LOOKUPS, a quiet guard like a paid plan's), in one statement.
export async function takeTasteLookup(env, taste) {
  return Boolean(taste && await env.DB.prepare("UPDATE best_first SET lookups = lookups + 1 WHERE claim = ? AND lookups < ? " +
    "RETURNING lookups").bind(taste.claim, TASTE_LOOKUPS).first());
}

// Holds `micro` on the day's cap, while it fits: {day, micro}, or null. settleDay then keeps what it cost.
export async function holdDay(env, micro, now = new Date()) {
  const day = dayOf(now);
  const [, held] = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO best_first_days (day) VALUES (?)").bind(day),
    env.DB.prepare("UPDATE best_first_days SET reserved_micro = reserved_micro + ? WHERE day = ? AND " +
      "reserved_micro + ? <= ? RETURNING reserved_micro").bind(micro, day, micro, tasteDayMicro(env)),
  ]);
  return held.results?.length ? { day, micro } : null;
}

const COUNTS = ["answers", "replies", "lines", "starts", "capped", "unreachable"];
// What a held taste cost (spent; 0 gives the hold back) and what it was (counts: {answers: 1, ...}), on the hold's day
// (hold: holdDay's, or null for a cost that wasn't held: then on today's).
export async function settleDay(env, hold, spent, counts = {}, now = new Date()) {
  const cost = Math.max(0, Math.round(Number(spent) || 0)), held = hold?.micro || 0, day = hold?.day || dayOf(now);
  const add = COUNTS.filter(k => Number.isInteger(counts[k]) && counts[k] > 0);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO best_first_days (day) VALUES (?)").bind(day),
    env.DB.prepare("UPDATE best_first_days SET reserved_micro = MAX(0, reserved_micro - ? + ?), spent_micro = spent_micro + ?" +
      add.map(k => `, ${k} = ${k} + ?`).join("") + " WHERE day = ?").bind(held, cost, cost, ...add.map(k => counts[k]), day),
  ]);
}
export const countDay = (env, now, what) => settleDay(env, null, 0, { [what]: 1 }, now);

// A reply's place among the finest replies the taste earned (best_first.voices), taken when its first piece is said;
// giveVoice puts it back for a reply nothing could say.
export async function takeVoice(env, userId) {
  return Boolean(await env.DB.prepare("UPDATE best_first SET voices = voices - 1 WHERE user_id = ? AND voices > 0 RETURNING voices")
    .bind(userId).first());
}
export async function giveVoice(env, userId) {
  await env.DB.prepare("UPDATE best_first SET voices = voices + 1 WHERE user_id = ?").bind(userId).run();
}

// For /admin's Willo panel and the daily analytics post (lib/willo-stats.js): what the taste did and cost, and whether
// it helps. days: the last `days` UTC days {day, usd, answers, replies, lines, starts, capped, unreachable}; tasters:
// accounts that had a taste answer (finished: all 20), usd: all it cost, perTaster: usd over tasters; capUsd: today's
// cap. cohorts {taste, before}: players who asked Willo since the taste began and had it, and players whose first
// question came before it began: {players, paid (started a plan since, comped and owner plans left out, a Keep Hero
// trial counted), returned (asked again on a later day), week (asked again 7 or more days after their first)}.
// Admin and test accounts are left out (lib/activity.js counted). Before the first taste answer: null.
export async function tasteReport(env, now = new Date(), days = 14) {
  await setupBilling(env);
  const all = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
  const since = (await env.DB.prepare("SELECT MIN(started) AS at FROM best_first").first())?.at;
  if (!since) return null;
  const from = new Date(now.getTime() - (days - 1) * 864e5).toISOString().slice(0, 10);
  const first = "(SELECT user_id, MIN(day) AS first, MAX(day) AS last FROM answer_days GROUP BY user_id)";
  const paid = "EXISTS (SELECT 1 FROM plan_log p WHERE p.user_id = f.user_id AND COALESCE(p.comp, '') = '' AND " +
    `p.plan IN (${PAID.map(() => "?").join(", ")}))`;
  const cohort = where => all(`SELECT COUNT(*) AS players, COALESCE(SUM(${paid}), 0) AS paid, ` +
    "COALESCE(SUM(f.last > f.first), 0) AS returned, COALESCE(SUM(julianday(f.last) - julianday(f.first) >= 7), 0) AS week " +
    `FROM ${first} f WHERE ${counted("f.user_id")} AND ${where}`, ...PAID, since.slice(0, 10));
  const tasted = "EXISTS (SELECT 1 FROM best_first b WHERE b.user_id = f.user_id AND b.used > 0)";
  const [rows, totals, spent, taste, before] = await Promise.all([
    all("SELECT * FROM best_first_days WHERE day >= ? ORDER BY day", from),
    env.DB.prepare(`SELECT COUNT(*) AS tasters, COALESCE(SUM(used >= ?), 0) AS finished FROM best_first WHERE used > 0 ` +
      `AND (user_id IS NULL OR ${counted("user_id")})`).bind(TASTE_ANSWERS).first(),
    env.DB.prepare("SELECT COALESCE(SUM(spent_micro), 0) AS micro FROM best_first_days").first(),
    cohort(`f.first >= ? AND ${tasted}`),
    cohort(`f.first < ? AND NOT ${tasted}`),
  ]);
  const usd = (spent?.micro || 0) / 1e6, tasters = totals?.tasters || 0;
  const pick = r => ({ players: r?.players || 0, paid: r?.paid || 0, returned: r?.returned || 0, week: r?.week || 0 });
  return {
    since, tasters, finished: totals?.finished || 0, usd, perTaster: tasters ? usd / tasters : 0,
    capUsd: tasteDayMicro(env) / 1e6,
    days: rows.map(r => ({ day: r.day, usd: r.spent_micro / 1e6, answers: r.answers, replies: r.replies, lines: r.lines,
                           starts: r.starts, capped: r.capped, unreachable: r.unreachable })),
    cohorts: { taste: pick(taste[0]), before: pick(before[0]) },
  };
}
