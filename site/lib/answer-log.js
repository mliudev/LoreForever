// Every live Willo answer, kept KEEP_DAYS and then deleted (Mike, 2026-10-16), so the nightly answer-quality check
// (scheduled task "nightly-willo-feedback") sees every conversation, not only the ones players flag
// (lib/answer-feedback.js). Only while the player leaves "Help improve Willo's answers" on in the companion app: the
// companion sends keep: true with each question while it's on, and nothing else is kept (an older companion, which has
// no switch, sends nothing, so its answers aren't kept either). public/privacy.html says what's kept and for how long.
//
// answer_log, one row per answer (or failed answer):
//   created     when it was answered (ISO)
//   player      a salted SHA-256 of the account id (answer_log_salt): the same player's answers can be read together,
//               but it can't be turned back into the account without the salt. Never an email, account id or IP.
//   operation   "answer" (Willo) or "character" (a character answering in person); npc: their lore key, when known
//   spoken      1 when it was asked out loud
//   zone, sub   where they were
//   question    what the player asked; answer: what came back (the action it offered: action). The account's
//               character names (sent with the question for this alone, never kept) become {player} in both.
//   model, model_ms, total_ms   who wrote it and how long it took
//   looked_up   "no", "quick", "required", "cached" or "facts" (the answer endpoint's looked_up); lookups: what else it used
//               ("forever_facts,web,help,..."); facts: the Forever facts' titles it was given (JSON)
//   feedback    "correction" or "frustration" when the question disputed the answer before it
//   outcome     "answered", "unverified" (required research found no evidence: VERIFICATION_FAILED) or "failed";
//               error: what failed, for "failed"
//
// Old rows go three ways, so none outlives KEEP_DAYS by much even on a quiet day: with every new row (same batch),
// before every read (answerLogReport), and with every companion's daily check-in (sweepAnswerLog). Reads also never
// return anything older. "Delete my account" removes the account's rows (forgetAnswerLog).

export const KEEP_DAYS = 14;

const SETUP = [
  `CREATE TABLE IF NOT EXISTS answer_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL, player TEXT NOT NULL, operation TEXT NOT NULL,
    npc TEXT, spoken INTEGER NOT NULL DEFAULT 0, zone TEXT, sub TEXT, question TEXT NOT NULL, answer TEXT, action TEXT,
    model TEXT, model_ms INTEGER, total_ms INTEGER, looked_up TEXT, lookups TEXT, facts TEXT, feedback TEXT,
    outcome TEXT NOT NULL, error TEXT)`,
  "CREATE INDEX IF NOT EXISTS answer_log_created ON answer_log (created)",
  "CREATE INDEX IF NOT EXISTS answer_log_player ON answer_log (player, created)",
  "CREATE TABLE IF NOT EXISTS answer_log_salt (id INTEGER PRIMARY KEY CHECK (id = 1), salt TEXT NOT NULL)",
];
export const OUTCOMES = ["answered", "unverified", "failed"];

const ready = new WeakMap();
const salts = new WeakMap();   // env.DB -> the salt
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

export async function setupAnswerLog(env) {
  if (ready.get(env.DB)) return;
  await env.DB.batch(SETUP.map(sql => env.DB.prepare(sql)));
  ready.set(env.DB, true);
}

// The player's key: made once per database, like lib/billing.js's billing_salt. Two isolates can make it at once: both
// insert, one wins, and both read back the winner's.
async function playerKey(env, userId) {
  if (!salts.has(env.DB)) {
    await env.DB.prepare("INSERT OR IGNORE INTO answer_log_salt (id, salt) VALUES (1, ?)")
      .bind(hex(crypto.getRandomValues(new Uint8Array(32)))).run();
    salts.set(env.DB, (await env.DB.prepare("SELECT salt FROM answer_log_salt WHERE id = 1").first()).salt);
  }
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salts.get(env.DB)}:${userId}`))).slice(0, 32);
}

const cutoff = now => new Date(now.getTime() - KEEP_DAYS * 864e5).toISOString();
const clip = (s, n) => (typeof s === "string" ? s : "").trim().slice(0, n) || null;
const whole = n => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : null);

// The account's character names (the companion sends them with keep), as {player}: whole words, any case, two letters
// or more, longest first, as the companion's own name_scrubber does for shared game text (contribute.py).
export function scrubNames(text, names) {
  if (typeof text !== "string" || !text) return text;
  const list = [...new Set((Array.isArray(names) ? names : []).filter(n => typeof n === "string")
    .map(n => n.trim()).filter(n => n.length >= 2 && n.length <= 40))].sort((a, b) => b.length - a.length).slice(0, 60);
  if (!list.length) return text;
  const escaped = list.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped})(?![\\p{L}\\p{N}])`, "giu"), "{player}");
}

// One answer, and the rows past KEEP_DAYS out, in one batch. Never throws: keeping it must never cost the player their
// answer.
export async function logAnswer(env, userId, entry = {}, { names = [], now = new Date() } = {}) {
  const question = clip(scrubNames(entry.question, names), 1000);
  if (!question || !OUTCOMES.includes(entry.outcome)) return false;
  try {
    await setupAnswerLog(env);
    const list = v => (Array.isArray(v) && v.length ? v : null);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO answer_log (created, player, operation, npc, spoken, zone, sub, question, answer, " +
        "action, model, model_ms, total_ms, looked_up, lookups, facts, feedback, outcome, error) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(now.toISOString(),
        await playerKey(env, userId), entry.operation === "character" ? "character" : "answer", clip(entry.npc, 80),
        entry.spoken ? 1 : 0, clip(entry.zone, 80), clip(entry.sub, 80), question,
        clip(scrubNames(entry.answer, names), 2000), clip(entry.action, 40), clip(entry.model, 60),
        whole(entry.model_ms), whole(entry.total_ms), clip(entry.looked_up, 16),
        list(entry.lookups)?.join(",").slice(0, 120) ?? null,
        list(entry.facts) ? JSON.stringify(entry.facts.slice(0, 12).map(t => String(t).slice(0, 80))) : null,
        clip(entry.feedback, 16),
        entry.outcome, clip(entry.error, 200)),
      env.DB.prepare("DELETE FROM answer_log WHERE created < ?").bind(cutoff(now)),
    ]);
    return true;
  } catch (e) {
    console.warn(`answer log: ${e?.message || e}`);
    return false;
  }
}

// The rows past KEEP_DAYS, out (a companion's daily check-in calls this, so they go even on a day nobody asks Willo
// anything). Never throws.
export async function sweepAnswerLog(env, now = new Date()) {
  try {
    await setupAnswerLog(env);
    await env.DB.prepare("DELETE FROM answer_log WHERE created < ?").bind(cutoff(now)).run();
    return true;
  } catch (e) {
    console.warn(`answer log sweep: ${e?.message || e}`);
    return false;
  }
}

// The nightly check and /admin (GET /api/admin/willo?answers=1): what was kept since `since` (default: all of it),
// oldest first, `limit` rows after the row `after` (an id, for the next page), and the totals over the same rows:
//   {keep_days, since, total, players, outcomes: {answered, ...}, operations: {...}, looked_up: {...},
//    models: {...}, avg_total_ms, rows: [...], next}   next: the `after` for the next page, or null
export async function answerLogReport(env, { since = null, after = 0, limit = 200, now = new Date() } = {}) {
  await setupAnswerLog(env);
  const oldest = cutoff(now);
  await env.DB.prepare("DELETE FROM answer_log WHERE created < ?").bind(oldest).run();
  const from = typeof since === "string" && !Number.isNaN(Date.parse(since)) && new Date(since).toISOString() > oldest
    ? new Date(since).toISOString() : oldest;
  const n = Math.min(Math.max(Number.parseInt(limit, 10) || 200, 1), 1000);
  const start = Math.max(Number.parseInt(after, 10) || 0, 0);
  const group = col => env.DB.prepare(`SELECT COALESCE(${col}, '') AS k, COUNT(*) AS n FROM answer_log ` +
    "WHERE created >= ? GROUP BY k").bind(from).all().then(r => Object.fromEntries(r.results.map(x => [x.k, x.n])));
  const [totals, outcomes, operations, lookedUp, models, rows] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total, COUNT(DISTINCT player) AS players, CAST(AVG(total_ms) AS INTEGER) AS avg_ms " +
      "FROM answer_log WHERE created >= ?").bind(from).first(),
    group("outcome"), group("operation"), group("looked_up"), group("model"),
    env.DB.prepare("SELECT id, created, player, operation, npc, spoken, zone, sub, question, answer, action, model, " +
      "model_ms, total_ms, looked_up, lookups, facts, feedback, outcome, error FROM answer_log " +
      "WHERE created >= ? AND id > ? ORDER BY id LIMIT ?").bind(from, start, n + 1).all(),
  ]);
  const page = rows.results.slice(0, n);
  return { keep_days: KEEP_DAYS, since: from, total: totals?.total || 0, players: totals?.players || 0, outcomes,
    operations, looked_up: lookedUp, models, avg_total_ms: totals?.avg_ms ?? null,
    rows: page.map(r => ({ ...r, facts: r.facts ? JSON.parse(r.facts) : [] })),
    next: rows.results.length > n ? page.at(-1).id : null };
}

// "Delete my account" (lib/accounts.js deleteUser): every answer kept for the account.
export async function forgetAnswerLog(env, userId) {
  await setupAnswerLog(env);
  await env.DB.prepare("DELETE FROM answer_log WHERE player = ?").bind(await playerKey(env, userId)).run();
}
