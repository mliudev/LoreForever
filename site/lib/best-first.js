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
// account and signing in again doesn't bring them again. Not on top of a paid plan: a paying player hears their plan.
//
// What it costs (10/16 prices): Inworld TTS 2 Flash at $15 a million letters, a spoken reply about 200 letters
// ($0.003; at most SPEAK_MAX_CHARS, $0.009), a quick look online about $0.03 ($0.05 for required research), an answer
// $0.0018 (the free plan's anyway). With 20 of them (10/16), a typical new player (half asked out loud, two look-ups, a
// few tips) cost about $0.12, the most one could about $0.45; the first-run trial's 50 are costed below. All of it is paid
// from the shared monthly budget (lib/companion-answers.js, $100 for every free answer and voice), and a day's taste
// may cost at most TASTE_DAY_USD ($5 since option D, Mike, 2026-10-19, so a busy launch day doesn't run new players'
// first answers out of her best; real spend was about $0.20 a day in October), so a spike can't spend the month in a
// day. Since 10/22 (Mike: "agree with both") it's inside the free players' $150 pool too (lib/free-pool.js), so all free
// spend together never passes it: while the pool is on its soft step (its day's allowance used), the taste rests as it
// does past its own cap. Past either, the day's answers and replies take the plan's own path, uncounted (so nobody
// loses theirs), with the chorus resting in Willo's window until there's room again. The Pages variable TASTE_DAY_USD
// changes the cap without a code change.
//
// Tables (lib/billing.js SETUP): best_first, one row per Google account (claim: "taste:" and its one-way code, or
// "taste:user:<id>" without one): user_id (NULL once the account is deleted, so the count stays with the claim), used
// (taste answers so far), voices (finest replies earned and not yet said), lookups, started and finished (ISO).
// best_first_days, one row per UTC day: reserved_micro (what the day's taste holds and has spent, for the cap),
// spent_micro, answers, replies (in the finest voice), lines (Willo's own), starts (accounts' first taste answer),
// capped (answers or replies the cap sent down the plan's own path) and unreachable (finest replies no provider could
// say). /admin's Willo panel and the daily analytics post read them (tasteReport).
//
// The first-run trial (Mike, 2026-10-19: "We need to give the first-time user the best experience possible. That means
// we should be giving them the best voice models and all the features that Willow has to offer for a limited time, like
// a limited number of uses for just about everything."). The taste grows into it: for TRIAL_DAYS from the account's
// first live answer (best_first.started; the Pages variable TRIAL_DAYS changes it without a code change), an account
// the taste is for also tries what its plan doesn't have. What costs us something per use is counted (TRIAL):
// look-ups online (best_first.lookups), answers that see the game and characters' replies in their own voices
// (best_first.tries, JSON {sight, cast}; lib/companion-voice.js speakTaste for the voices). What costs next to nothing
// is open for the whole window: Willo's voice picked from all of hers (PLAN_VOICE choice: her finest voice says the
// pick while the taste's replies last), Champion's longer chat memory, her style in the player's own words and up to
// TRIAL.tales tales (lib/willo-custom.js), goals and reminders, asking out loud and all her voices on the PC
// (lib/billing.js companionFeatures). The taste's answers in her finest voice end with the window too. Then the
// plan's own path, as before; what they saved (a style, tales) stays for when a plan has it. The companion shows what
// they're trying in her window (the allowance's `trial`, lib/companion-answers.js; companion core.trial()).
//
// What it costs (the pricing review's measured costs, 10/19: Inworld at our $10 a million letters, most of it prepaid
// by the month's unused credit; Google's bill): 50 answers in her finest voice at about $0.0019 a reply ($0.006 at
// most), 5 look-ups at $0.015-$0.05, 50 pictures at $0.0001-$0.0003, 20 character lines at about $0.003: about $0.55 a
// player at the very most, about $0.80 at the code's list prices, and in practice about a cent (real taste players
// used 7.8 of 20, $0.36 for 44 of them). All of it is held on the same day's cap (TASTE_DAY_USD), which still bounds a
// day's spend. The open features cost about nothing: a pick is said at the same price as Sprite, longer memory adds
// about $0.0004 to a rare compaction, a style or a tale only prompt text (and one $0.0003 check when saved).

import { plansOn, setupBilling, claimOf, PAID, TASTE_ANSWERS, TRIAL_DAYS } from "./billing.js";
import { counted } from "./activity.js";
import { fits } from "./free-pool.js";

export { TASTE_ANSWERS, TRIAL_DAYS };
// The trial's uses where a use costs something (sized from the pricing review's measured costs, 10/19): look-ups
// online, answers that see the game (as many as her finest answers), characters' replies in their own voices, tales.
export const TRIAL = { lookups: 5, sight: TASTE_ANSWERS, cast: 20, tales: 3 };
export const TASTE_LOOKUPS = TRIAL.lookups;
export const TASTE_DAY_USD = 5;
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

// Whether the taste has room now, as SQL with its binds: its day under its own cap (TASTE_DAY_USD) by a whole reply,
// and the free pool under the day's allowance (lib/free-pool.js; on its soft step the taste rests). tasteRoom selects
// it as `room` for a batch, and roomIn reads that.
function room(env, now) {
  const pool = fits(env, now, TASTE_REPLY_MICRO, "soft");
  return { sql: `(COALESCE((SELECT reserved_micro FROM best_first_days WHERE day = ?), 0) + ? <= ? AND ${pool.sql})`,
           binds: [dayOf(now), TASTE_REPLY_MICRO, tasteDayMicro(env), ...pool.binds] };
}
export const tasteRoom = (env, now) => {
  const r = room(env, now);
  return env.DB.prepare(`SELECT ${r.sql} AS room`).bind(...r.binds);
};
export const roomIn = result => Boolean(result?.results?.[0]?.room);

// Whether this plan gets the taste at all: the free plan and the beta's free Hero month, while plans are on.
export const tasteFor = (env, plan) => plansOn(env) && Boolean(plan) && (plan.id === "free" || Boolean(plan.launch));

export function trialDays(env) {
  const days = Number(env?.TRIAL_DAYS ?? TRIAL_DAYS);
  return Number.isFinite(days) && days >= 0 ? days : TRIAL_DAYS;
}
// The window's start for an answer now: an account whose first live answer came after it is still trying.
const windowFrom = (env, now) => iso(now.getTime() - trialDays(env) * 864e5);
// What best_first keeps for the trial, read with the taste's own columns.
const ROW = "claim, used, voices, lookups, started, tries";
const triesOf = row => {
  try {
    const t = JSON.parse(row?.tries || "{}");
    return t && typeof t === "object" ? t : {};
  } catch (e) {
    return {};
  }
};
// The trial as the account's best_first row has it (null: no row yet, a new account): {claim, on, until (ISO; null
// before the first live answer, when the window hasn't started), left: {lookups, sight, cast}}; null on a plan the
// taste isn't for (a paying player's).
export function trialOf(env, plan, row, now = new Date()) {
  if (!tasteFor(env, plan)) return null;
  const until = row?.started ? Date.parse(row.started) + trialDays(env) * 864e5 : null;
  const tries = triesOf(row), left = (n, used) => Math.max(0, n - (Number(used) || 0));
  return { claim: row?.claim ?? null, on: until === null || now.getTime() < until,
           until: until === null ? null : iso(until),
           left: { lookups: left(TRIAL.lookups, row?.lookups), sight: left(TRIAL.sight, tries.sight),
                   cast: left(TRIAL.cast, tries.cast) } };
}
// The account's trial now, read on its own (Willo's style page, her goals' check, a chat memory's compaction): trialOf.
export async function trialFor(env, userId, plan, now = new Date()) {
  if (!tasteFor(env, plan)) return null;
  await setupBilling(env);
  const row = await env.DB.prepare(`SELECT ${ROW} FROM best_first WHERE user_id = ?`).bind(userId).first();
  return trialOf(env, plan, row, now);
}
// One of the trial's counted uses ("sight" or "cast"), in one statement, while the window lasts and it has room: whether
// it took. untry gives one back (a reply nothing could say).
export async function tryOnce(env, claim, what, now = new Date()) {
  if (!claim || !Object.hasOwn(TRIAL, what)) return false;
  const path = `$.${what}`;
  return Boolean(await env.DB.prepare("UPDATE best_first SET tries = json_set(COALESCE(tries, '{}'), ?, " +
    "COALESCE(json_extract(tries, ?), 0) + 1) WHERE claim = ? AND COALESCE(json_extract(tries, ?), 0) < ? AND " +
    "(started IS NULL OR started > ?) RETURNING claim").bind(path, path, claim, path, TRIAL[what], windowFrom(env, now)).first());
}
export async function untry(env, userId, what) {
  if (!Object.hasOwn(TRIAL, what)) return;
  const path = `$.${what}`;
  await env.DB.prepare("UPDATE best_first SET tries = json_set(COALESCE(tries, '{}'), ?, " +
    "MAX(0, COALESCE(json_extract(tries, ?), 0) - 1)) WHERE user_id = ?").bind(path, path, userId).run();
}
// The account's row as trialOf reads it, for a caller that batches it with its own (lib/companion-voice.js speakTaste).
export const trialRow = (env, userId) => env.DB.prepare(`SELECT ${ROW} FROM best_first WHERE user_id = ?`).bind(userId);
// A plan as the trial has it, for what's open all the window: Willo's voice picked from all of hers (PLAN_VOICE choice,
// lib/companion-voice.js willoPick), and the narrator reading the add-on's short answers (readings: the PM, 10/21: "try
// everything" means everything; lib/companion-voice.js speakReading, on the shared free budget).
export const withTrial = (plan, trial) => trial?.on && plan?.voice
  && !(plan.voice.choice && plan.voice.azeroth && plan.voice.readings)
  ? { ...plan, voice: { ...plan.voice, choice: true, azeroth: true, readings: true } } : plan;
// What the companion is told of the trial, with the allowance (lib/companion-answers.js): {on, until (ISO, or none
// before the first answer), uses: {web, sight, characters: {of, left}}, opens: [...]}, only what the plan doesn't have
// itself (the beta's free Hero month already looks online, sees the game, keeps goals and picks a preset style).
// opens: "voices" (her voice picked from all of hers), "memory" (longer chat memory), "style" (her style in their own
// words; presets too on the free plan), "tales", "goals" (goals and reminders), "talk" (asking out loud, her voices on
// the PC), "readings" (the narrator reads the add-on's short answers).
export function trialView(plan, trial) {
  if (!trial) return null;
  const free = plan.id === "free";
  const use = (of, left) => ({ of, left });
  return { on: trial.on, ...(trial.until ? { until: trial.until } : {}),
    uses: { ...(free ? { web: use(TRIAL.lookups, trial.left.lookups), sight: use(TRIAL.sight, trial.left.sight) } : {}),
            characters: use(TRIAL.cast, trial.left.cast) },
    opens: ["voices", "memory", "style", "tales", ...(free ? ["goals", "talk", "readings"] : [])] };
}

// The account's taste now, for the allowance: {of, left (answers), voices (finest replies earned, not yet said),
// on, why ("used": all of them answered and said; "ended": the trial's days are over; "resting": the day's cap is reached),
// trial (trialOf)}; null for a plan without one. Resting: the day's cap, or the free pool's soft step (tasteRoom).
export async function tasteState(env, userId, plan, now = new Date()) {
  if (!tasteFor(env, plan)) return null;
  await setupBilling(env);
  const [mine, day] = await env.DB.batch([
    env.DB.prepare(`SELECT ${ROW} FROM best_first WHERE user_id = ?`).bind(userId),
    tasteRoom(env, now),
  ]);
  // No row yet: a new account, or its Google account's from before "Delete my account", which becomes this one's.
  const row = mine.results?.[0] ?? await env.DB.prepare("UPDATE best_first SET user_id = ? WHERE claim = ? AND " +
    `user_id IS NULL RETURNING ${ROW}`).bind(userId, await claimOf(env, userId, "taste")).first();
  const trial = trialOf(env, plan, row, now);
  const left = trial.on ? Math.max(0, TASTE_ANSWERS - (row?.used || 0)) : 0;
  const voices = trial.on ? Math.max(0, row?.voices || 0) : 0;
  const resting = !roomIn(day);
  const why = !trial.on ? "ended" : !left && !voices ? "used" : resting ? "resting" : null;
  return { of: TASTE_ANSWERS, left, voices, on: !why, ...(why ? { why } : {}), trial };
}

// Takes one of the account's taste answers for a live answer about to be written, in one statement, so two questions
// at once can't both take the last; spoken: asked out loud, so it earns a reply in the finest voice. {claim, used,
// spoken}, or null: not this plan's, all of them used, the trial's days over, or no room (tasteRoom: the day's cap or the
// free pool's soft step; counted as capped).
// takeFirst also says the trial (trialOf, after this answer's take), read in the same round trip, and starts the
// trial's days on the account's first live answer even when the taste can't take it. An account's first take makes its
// row, or finds its Google account's from before "Delete my account".
export async function takeTaste(env, userId, plan, now = new Date(), opts = {}) {
  return (await takeFirst(env, userId, plan, now, opts)).taste;
}
export async function takeFirst(env, userId, plan, now = new Date(), { spoken = false } = {}) {
  if (!tasteFor(env, plan)) return { taste: null, trial: null };
  await setupBilling(env);
  const at = iso(now.getTime());
  const r = room(env, now);
  const taking = () => env.DB.prepare(
    "UPDATE best_first SET used = used + 1, voices = voices + ?, started = COALESCE(started, ?), " +
    "finished = CASE WHEN used + 1 >= ? THEN ? ELSE finished END WHERE user_id = ? AND used < ? AND " +
    `(started IS NULL OR started > ?) AND ${r.sql} RETURNING claim, used`
  ).bind(spoken ? 1 : 0, at, TASTE_ANSWERS, at, userId, TASTE_ANSWERS, windowFrom(env, now), ...r.binds);
  // The take, the trial's days started when the take couldn't (no room), and the account's row as it stands
  // after both, in one round trip: most accounts that aren't paying have used their 20, and each of their answers
  // waited for both one after the other (LOR-654).
  const after = () => [taking(),
    env.DB.prepare("UPDATE best_first SET started = ? WHERE user_id = ? AND started IS NULL").bind(at, userId),
    env.DB.prepare(`SELECT ${ROW} FROM best_first WHERE user_id = ?`).bind(userId)];
  let results = await env.DB.batch(after());
  if (!results.at(-1).results?.[0]) {
    const claim = await claimOf(env, userId, "taste");
    results = (await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO best_first (claim, user_id) VALUES (?, ?)").bind(claim, userId),
      env.DB.prepare("UPDATE best_first SET user_id = ? WHERE claim = ? AND user_id IS NULL").bind(userId, claim),
      ...after()])).slice(2);
  }
  const took = results[0].results?.[0], mine = results.at(-1).results?.[0];
  const trial = trialOf(env, plan, mine, now);
  if (!took) {
    if (mine && mine.used < TASTE_ANSWERS && trial.on) await countDay(env, now, "capped");
    return { taste: null, trial };
  }
  return { taste: { claim: took.claim, used: took.used, spoken: Boolean(spoken) }, trial };
}

// A taste answer that failed, or never reached the model: its place back, and its finest reply if it earned one.
export async function returnTaste(env, taste) {
  if (!taste) return;
  await env.DB.prepare("UPDATE best_first SET used = MAX(0, used - 1), voices = MAX(0, voices - ?), finished = NULL " +
    "WHERE claim = ?").bind(taste.spoken ? 1 : 0, taste.claim).run();
}

// One of the trial's look-ups online (TASTE_LOOKUPS, a quiet guard like a paid plan's), in one statement, for a taste
// answer or one in the trial's days (anything with the account's claim).
export async function takeTasteLookup(env, taste, now = new Date()) {
  return Boolean(taste?.claim && await env.DB.prepare("UPDATE best_first SET lookups = lookups + 1 WHERE claim = ? AND " +
    "lookups < ? AND (started IS NULL OR started > ?) RETURNING lookups")
    .bind(taste.claim, TASTE_LOOKUPS, windowFrom(env, now)).first());
}

// A look-up the day's cap then turned away (functions/api/companion/answer.js): its place back.
export async function giveTasteLookup(env, taste) {
  if (!taste?.claim) return;
  await env.DB.prepare("UPDATE best_first SET lookups = MAX(0, lookups - 1) WHERE claim = ?").bind(taste.claim).run();
}

// Holds `micro` on the day's cap, while it fits: {day, micro}, or null. settleDay then keeps what it cost.
export async function holdDay(env, micro, now = new Date()) {
  return heldDay(await env.DB.batch(holdDayStatements(env, micro, now)), micro, now);
}
// holdDay's statements, for a caller that batches them with its own (lib/companion-voice.js: a taste piece's claim on
// its reply); also: {sql, binds}, one more condition on the hold. heldDay reads the batch's results.
export function holdDayStatements(env, micro, now = new Date(), also = null) {
  const day = dayOf(now);
  return [
    env.DB.prepare("INSERT OR IGNORE INTO best_first_days (day) VALUES (?)").bind(day),
    env.DB.prepare("UPDATE best_first_days SET reserved_micro = reserved_micro + ? WHERE day = ? AND " +
      `reserved_micro + ? <= ?${also ? ` AND ${also.sql}` : ""} RETURNING reserved_micro`)
      .bind(micro, day, micro, tasteDayMicro(env), ...(also ? also.binds : [])),
  ];
}
export const heldDay = (results, micro, now = new Date()) => (results.at(-1)?.results?.length ? { day: dayOf(now), micro } : null);

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
// accounts that had a taste answer (finished: all of them, of), usd: all it cost, perTaster: usd over tasters; capUsd: today's
// cap. cohorts {taste, before}: players who asked Willo since the taste began and had it, and players whose first
// question came before it began: {players, paid (started a plan since, comped and owner plans left out, a Keep Hero
// trial counted), returned (asked again on a later day), week (asked again 7 or more days after their first)}.
// trial: the first-run trial's uses so far, for tuning TRIAL: {trying (accounts in its days now), lookups, sight, cast
// (all of them, and the accounts that used each: lookupsBy, sightBy, castBy)}.
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
  const [rows, totals, spent, taste, before, tries] = await Promise.all([
    all("SELECT * FROM best_first_days WHERE day >= ? ORDER BY day", from),
    env.DB.prepare(`SELECT COUNT(*) AS tasters, COALESCE(SUM(used >= ?), 0) AS finished FROM best_first WHERE used > 0 ` +
      `AND (user_id IS NULL OR ${counted("user_id")})`).bind(TASTE_ANSWERS).first(),
    env.DB.prepare("SELECT COALESCE(SUM(spent_micro), 0) AS micro FROM best_first_days").first(),
    cohort(`f.first >= ? AND ${tasted}`),
    cohort(`f.first < ? AND NOT ${tasted}`),
    env.DB.prepare("SELECT COALESCE(SUM(started > ?), 0) AS trying, COALESCE(SUM(lookups), 0) AS lookups, " +
      "COALESCE(SUM(lookups > 0), 0) AS lookupsBy, COALESCE(SUM(json_extract(tries, '$.sight')), 0) AS sight, " +
      "COALESCE(SUM(json_extract(tries, '$.sight') > 0), 0) AS sightBy, COALESCE(SUM(json_extract(tries, '$.cast')), 0) AS cast, " +
      `COALESCE(SUM(json_extract(tries, '$.cast') > 0), 0) AS castBy FROM best_first WHERE (user_id IS NULL OR ${counted("user_id")})`)
      .bind(windowFrom(env, now)).first(),
  ]);
  const usd = (spent?.micro || 0) / 1e6, tasters = totals?.tasters || 0;
  const pick = r => ({ players: r?.players || 0, paid: r?.paid || 0, returned: r?.returned || 0, week: r?.week || 0 });
  return {
    since, of: TASTE_ANSWERS, tasters, finished: totals?.finished || 0, usd, perTaster: tasters ? usd / tasters : 0,
    capUsd: tasteDayMicro(env) / 1e6,
    days: rows.map(r => ({ day: r.day, usd: r.spent_micro / 1e6, answers: r.answers, replies: r.replies, lines: r.lines,
                           starts: r.starts, capped: r.capped, unreachable: r.unreachable })),
    cohorts: { taste: pick(taste[0]), before: pick(before[0]) },
    trial: Object.fromEntries(["trying", "lookups", "lookupsBy", "sight", "sightBy", "cast", "castBy"]
      .map(k => [k, Number(tries?.[k]) || 0])),
  };
}
