// The free players' shared pool (LOR-742; the architect's launch review, 10/21): what free live answers, the free plan's
// spoken starters and profile stories may cost us, all free players together, so it never runs dry for everyone at once.
//
// Two Pages variables, which Operations sets with Mike (Mike, 10/21: "$150 a month in $5 daily slices"):
//   STORY_BUDGET_USD       the month's pool (FREE_POOL_USD while unset)
//   FREE_DAILY_SLICE_USD   each UTC day's slice (FREE_SLICE_USD while unset)
// A day may spend its slice plus what earlier days left unspent, that carry at most CARRY_SLICES slices, so a quiet start
// to the month never leaves the pool open to one spike; the month never passes the pool. Past the day's allowance
// (soft) free players are on the soft step: BRAKE_ANSWERS a day each (lib/billing.js planFor's brake) and Willo's own
// voice on their PC instead of a hosted one (lib/companion-voice.js), while answers keep coming. Only once the soft step
// has used SOFT_SLICES more slices (hard) does Willo say her light's spent until tomorrow, and the add-on's lore library
// answers. What went past the day's allowance comes out of the next days' carry.
//
// What counts: the month's answer_spend (every live answer's reservation and measured cost), less paying players' and the
// beta's free Hero month's (answer_user_spend, lib/billing.js addUserSpend) and Willo's best first and its trial's
// extras (best_first_days, held on their own daily cap in lib/best-first.js), plus profile stories and their voice
// (story_spend). free_pool_days keeps the month's free spend as each day began (start_micro), written by the day's first
// reservation, and pool_alerts the alerts already raised (alertsFor).
// Kept outside functions/ so Pages doesn't route it.

export const FREE_POOL_USD = 150;
export const FREE_SLICE_USD = 5;
export const CARRY_SLICES = 2;
export const SOFT_SLICES = 1;
// The alerts: these shares of the day's allowance and of the month's pool, each raised once (alertsFor).
export const ALERT_SHARES = [0.5, 0.8];

const usdOf = (value, fallback) => {
  const usd = Number(value ?? fallback);
  return Math.round((Number.isFinite(usd) && usd >= 0 ? usd : fallback) * 1e6);
};
export const poolMicro = env => usdOf(env.STORY_BUDGET_USD, FREE_POOL_USD);
export const sliceMicro = env => usdOf(env.FREE_DAILY_SLICE_USD, FREE_SLICE_USD);

const month = now => now.toISOString().slice(0, 7);
const day = now => now.toISOString().slice(0, 10);

// The month's free spend so far, as SQL with its binds.
export function freeSpend(now) {
  const m = month(now);
  return {
    sql: "(COALESCE((SELECT reserved_micro FROM answer_spend WHERE month = ?), 0) - " +
      "COALESCE((SELECT SUM(micro) FROM answer_user_spend WHERE month = ?), 0) - " +
      "COALESCE((SELECT SUM(reserved_micro) FROM best_first_days WHERE day LIKE ?), 0) + " +
      "COALESCE((SELECT micro_usd + voice_micro_usd + reserved_micro FROM story_spend WHERE month = ?), 0))",
    binds: [m, m, `${m}-%`, m],
  };
}

// The month's free spend at the day's start (its free_pool_days row; before the day's first reservation, now's).
function dayStart(now) {
  const spend = freeSpend(now);
  return { sql: `COALESCE((SELECT start_micro FROM free_pool_days WHERE day = ?), MAX(0, ${spend.sql}))`,
           binds: [day(now), ...spend.binds] };
}

// The most the month's free spend may reach today: soft, the day's allowance, where the soft step starts; hard, where
// free answers stop until tomorrow. As SQL with its binds.
export function limit(env, now, which = "hard") {
  const s = dayStart(now), slice = sliceMicro(env);
  const sql = `MIN(?, ${s.sql} + ? + MIN(?, ? - ${s.sql}))`;
  return { sql, binds: [poolMicro(env), ...s.binds, slice * (which === "hard" ? 1 + SOFT_SLICES : 1), CARRY_SLICES * slice,
                        slice * (now.getUTCDate() - 1), ...s.binds] };
}

// The day's free_pool_days row, made with the month's free spend so far by the day's first reservation, in its batch.
export function dayStatement(env, now) {
  const spend = freeSpend(now);
  return env.DB.prepare(`INSERT OR IGNORE INTO free_pool_days (day, start_micro) SELECT ?, MAX(0, ${spend.sql})`)
    .bind(day(now), ...spend.binds);
}

// A reservation's condition: `micro` more still fits under today's hard limit (soft: the soft one).
export function fits(env, now, micro, which = "hard") {
  const spend = freeSpend(now), most = limit(env, now, which);
  return { sql: `${spend.sql} + ? <= ${most.sql}`, binds: [...spend.binds, micro, ...most.binds] };
}

// Where the pool stands now, in one read: {used, start, soft, hard, pool, slice} in millionths of a dollar. soft:
// on the soft step from here. Read only, so a day without a reservation yet reads now's spend as its start.
export async function poolNow(env, now = new Date()) {
  const spend = freeSpend(now), s = dayStart(now), soft = limit(env, now, "soft"), hard = limit(env, now, "hard");
  const row = await env.DB.prepare(`SELECT MAX(0, ${spend.sql}) AS used, ${s.sql} AS start, ${soft.sql} AS soft, ` +
    `${hard.sql} AS hard`).bind(...spend.binds, ...s.binds, ...soft.binds, ...hard.binds).first();
  return { used: row?.used || 0, start: row?.start || 0, soft: row?.soft || 0, hard: row?.hard || 0,
           pool: poolMicro(env), slice: sliceMicro(env) };
}
// Whether free players are on the soft step now.
export const softStep = state => state.used >= state.soft;

// The alerts the pool has reached and not yet raised (50% and 80% of the day's allowance and of the month's pool),
// marked raised as they're returned, so each is raised once: [{key, kind ("day" | "month"), share, usedUsd, ofUsd}].
// Each also goes to the Functions log as "ALERT free pool: ...", for the alerts DevOps routes to dashboard cards and
// email; /admin lists the month's (functions/api/admin.js pool.alerts).
export async function alertsFor(env, now = new Date(), state = null) {
  state ??= await poolNow(env, now);
  const today = { kind: "day", key: day(now), used: state.used - state.start, of: state.soft - state.start };
  const whole = { kind: "month", key: month(now), used: state.used, of: state.pool };
  const due = [];
  for (const span of [today, whole]) for (const share of ALERT_SHARES) {
    if (span.of > 0 && span.used >= share * span.of) due.push({ ...span, key: `${span.kind}:${span.key}:${share}`, share });
  }
  if (!due.length) return [];
  const raised = [];
  for (const a of due) {
    const row = await env.DB.prepare("INSERT OR IGNORE INTO pool_alerts (key, kind, share, used_micro, of_micro, created) " +
      "VALUES (?, ?, ?, ?, ?, ?) RETURNING key").bind(a.key, a.kind, a.share, a.used, a.of, now.toISOString()).first();
    if (!row) continue;
    const alert = { key: a.key, kind: a.kind, share: a.share, usedUsd: a.used / 1e6, ofUsd: a.of / 1e6 };
    console.warn(`ALERT free pool: ${Math.round(a.share * 100)}% of the ${a.kind === "day" ? "day's allowance" : "month's pool"} ` +
      `used ($${alert.usedUsd.toFixed(2)} of $${alert.ofUsd.toFixed(2)})`);
    raised.push(alert);
  }
  return raised;
}

// Checks for alerts at most once a minute in each isolate, after an answer is on its way (functions/api/companion/
// answer.js), so busy minutes add no reads; never throws.
const checked = new WeakMap();
export function checkAlerts(env, now = new Date()) {
  const last = checked.get(env.DB) || 0;
  if (now.getTime() - last < 60e3) return null;
  checked.set(env.DB, now.getTime());
  return alertsFor(env, now).catch(e => console.warn(`free pool alerts: ${e?.message || e}`));
}

// The pool for /admin: dollars used of the month's pool, today's allowance (soft) and stop (hard), whether the soft step
// is on, the month's average a day, the UTC day the pool would be gone at that average (null: it lasts the month), and
// the month's alerts raised.
export async function poolReport(env, now = new Date()) {
  const state = await poolNow(env, now);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const perDay = state.used / Math.max((now.getTime() - start) / 86400e3, 1 / 24);
  const out = perDay > 0 ? start + (state.pool / perDay) * 86400e3 : Infinity;
  const { results } = await env.DB.prepare("SELECT key, kind, share, used_micro, of_micro, created FROM pool_alerts " +
    "WHERE key LIKE ? OR key LIKE ? ORDER BY created").bind(`day:${month(now)}-%`, `month:${month(now)}:%`).all();
  const usd = micro => Math.round(micro) / 1e6;
  return { poolUsd: usd(state.pool), sliceUsd: usd(state.slice), usedUsd: usd(state.used), todayUsd: usd(state.used - state.start),
           softUsd: usd(state.soft - state.start), hardUsd: usd(state.hard - state.start), soft: softStep(state),
           perDayUsd: usd(perDay), runsOut: out < end ? new Date(out).toISOString().slice(0, 10) : null,
           alerts: results.map(r => ({ key: r.key, kind: r.kind, share: r.share, usedUsd: usd(r.used_micro),
                                       ofUsd: usd(r.of_micro), at: r.created })) };
}
