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
//   looked_up   "no", "quick", "empty" (looked, found nothing), "off" (would have looked; the plan or its look-ups
//               said no), "required", "cached" or "facts" (the answer endpoint's looked_up); lookups: what else it used
//               ("forever_facts,web,help,..."); facts: the Forever facts' titles it was given (JSON)
//   feedback    "correction", "misheard", "frustration" or "gave_up" when the question disputed the answer before it
//   outcome     "answered", "unverified" (required research found no evidence: VERIFICATION_FAILED) or "failed";
//               error: what failed, for "failed"
//   ref         the answer's id (lib/answer-signals.js newAnswerId), sent to the app with the answer, so a report or the
//               next question can name it
//   signals     what came after it, comma-separated (lib/answer-signals.js SIGNALS: rephrased, interrupted, reported...),
//               added by tagAnswer
//   topic       what it's about, by its words (lib/answer-signals.js topicOf), for the demand view
//   ctx         who was asking, as the question said it (JSON: race, class, level, faction, target), for the review
//               queue; say: what she said out loud when that wasn't the whole answer (speak short, show full)
//   plan        the plan it was answered on, as lib/plan-usage.js planLabel names it ("free", "beta-hero", "hero",
//               "legend-trialing"...): which features each plan really uses. Never anything about who.
//
// Old rows go three ways, so none outlives KEEP_DAYS by much even on a quiet day: with every new row (same batch),
// before every read (answerLogReport), and with every companion's daily check-in (sweepAnswerLog). Reads also never
// return anything older. "Delete my account" removes the account's rows (forgetAnswerLog).

import { ANSWER_ID, SIGNALS, topicOf } from "./answer-signals.js";

export const KEEP_DAYS = 14;

const SETUP = [
  `CREATE TABLE IF NOT EXISTS answer_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL, player TEXT NOT NULL, operation TEXT NOT NULL,
    npc TEXT, spoken INTEGER NOT NULL DEFAULT 0, zone TEXT, sub TEXT, question TEXT NOT NULL, answer TEXT, action TEXT,
    model TEXT, model_ms INTEGER, total_ms INTEGER, looked_up TEXT, lookups TEXT, facts TEXT, feedback TEXT,
    outcome TEXT NOT NULL, error TEXT, ref TEXT, signals TEXT, topic TEXT, ctx TEXT, say TEXT)`,
  "CREATE INDEX IF NOT EXISTS answer_log_created ON answer_log (created)",
  "CREATE INDEX IF NOT EXISTS answer_log_player ON answer_log (player, created)",
  "CREATE TABLE IF NOT EXISTS answer_log_salt (id INTEGER PRIMARY KEY CHECK (id = 1), salt TEXT NOT NULL)",
];
// Columns added since the table was first made (10/18, the feedback loop): added once, where missing.
const ADDED = ["ref TEXT", "signals TEXT", "topic TEXT", "ctx TEXT", "say TEXT", "plan TEXT"];
const AFTER_ADDED = ["CREATE INDEX IF NOT EXISTS answer_log_ref ON answer_log (ref)"];
export const OUTCOMES = ["answered", "unverified", "failed"];

const ready = new WeakMap();
const salts = new WeakMap();   // env.DB -> the salt
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

export async function setupAnswerLog(env) {
  if (ready.get(env.DB)) return;
  await env.DB.batch(SETUP.map(sql => env.DB.prepare(sql)));
  const have = new Set((await env.DB.prepare("PRAGMA table_info(answer_log)").all()).results.map(c => c.name));
  for (const column of ADDED) {
    if (have.has(column.split(" ")[0])) continue;
    // Another cold isolate may add it at the same moment.
    try { await env.DB.prepare(`ALTER TABLE answer_log ADD COLUMN ${column}`).run(); }
    catch (e) { if (!/duplicate column/i.test(String(e?.message))) throw e; }
  }
  await env.DB.batch(AFTER_ADDED.map(sql => env.DB.prepare(sql)));
  ready.set(env.DB, true);
}

// The player's key: made once per database, like lib/billing.js's billing_salt. Two isolates can make it at once: both
// insert, one wins, and both read back the winner's. The review queue (lib/answer-feedback.js) keys its rows by it too.
export async function playerKey(env, userId) {
  if (!salts.has(env.DB)) {
    await env.DB.prepare("INSERT OR IGNORE INTO answer_log_salt (id, salt) VALUES (1, ?)")
      .bind(hex(crypto.getRandomValues(new Uint8Array(32)))).run();
    salts.set(env.DB, (await env.DB.prepare("SELECT salt FROM answer_log_salt WHERE id = 1").first()).salt);
  }
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salts.get(env.DB)}:${userId}`))).slice(0, 32);
}

const cutoff = now => new Date(now.getTime() - KEEP_DAYS * 864e5).toISOString();
// Who was asking, as the question's PLAYER CONTEXT said it: never their name (a target that is one of their own
// characters comes out with the rest of their names).
const CTX = ["race", "class", "level", "faction", "target"];
function ctxOf(ctx, names) {
  if (!ctx || typeof ctx !== "object") return null;
  const out = Object.fromEntries(CTX.map(k => [k, typeof ctx[k] === "string" ? scrubNames(ctx[k].trim(), names).slice(0, 60) : ""])
    .filter(([, v]) => v));
  return Object.keys(out).length ? JSON.stringify(out) : null;
}
const clip = (s, n) => (typeof s === "string" ? s : "").trim().slice(0, n) || null;
const whole = n => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : null);

// The letters a name is compared by: any case, accents aside (Húrin, hurin, HURIN).
const fold = s => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
const WORD = /[\p{L}\p{M}\p{N}]+/gu;
// The names to take out: the character's part of "Name-Realm", each word of a display name, two letters or more.
const nameList = names => [...new Set((Array.isArray(names) ? names : []).filter(n => typeof n === "string")
  .flatMap(n => n.split("-")[0].match(WORD) || []).map(fold).filter(n => n.length >= 2 && n.length <= 40))].slice(0, 80);
// A word is the name as it is, or (names of 3+ letters) the name with up to 4 letters more: Willo inflects a name when
// she slips out of English (LOR-628: a Czech "Hurine", "Hurinovi") and English adds "Hurins". A name of 4+ letters
// ending in a vowel may change it instead (Lena: Leno, Leny, Lenou). Matching a common word now and then (a "Storm"
// takes "Stormy" too) only keeps less, never more.
const VOWEL = /[aeiouy]/;
const isName = (word, list) => list.some(n => word === n || (n.length >= 3 && word.startsWith(n) &&
  word.length - n.length <= 4) || (n.length >= 4 && VOWEL.test(n.at(-1)) && word.length >= n.length &&
  word.length - n.length <= 2 && word.startsWith(n.slice(0, -1)) && VOWEL.test(word[n.length - 1])));

// The account's names as {player}: its character names (the companion sends them with keep, and accountNames adds what
// the site knows) and its display name, whole words, any case or accents, inflected forms too (isName). Wider than the
// companion's own name_scrubber for shared game text (contribute.py), which only sees English game text.
export function scrubNames(text, names) {
  if (typeof text !== "string" || !text) return text;
  const list = nameList(names);
  if (!list.length) return text;
  return text.replace(WORD, word => (isName(fold(word), list) ? "{player}" : word));
}

// What the site itself knows the account is called: its profile's character, the characters whose journeys it keeps
// (lib/history.js historyCharacter: ["Name", "Realm"]) and its display name. A table not made yet is no names.
export async function accountNames(env, userId) {
  const all = sql => env.DB.prepare(sql).bind(userId).all().then(r => r.results.map(x => x.n), () => []);
  const found = await Promise.all([
    all("SELECT json_extract(data, '$.name') AS n FROM profiles WHERE user_id = ?"),
    all("SELECT DISTINCT json_extract(character, '$[0]') AS n FROM history_receipts WHERE user_id = ?"),
    all("SELECT display_name AS n FROM users WHERE id = ?"),
  ]);
  return found.flat().filter(n => typeof n === "string" && n);
}

// The rows already kept for one player key, scrubbed again with `names`: each read, scrubbed and written back only
// where it changed and only while it still reads as it did (a read-then-update). Returns the ids that changed.
async function rescrubPlayer(env, key, names, { write = true } = {}) {
  const { results } = await env.DB.prepare("SELECT id, question, answer FROM answer_log WHERE player = ?").bind(key).all();
  const changed = results.map(r => ({ ...r, q: scrubNames(r.question, names), a: scrubNames(r.answer, names) }))
    .filter(r => r.q !== r.question || r.a !== r.answer);
  if (write && changed.length) {
    await env.DB.batch(changed.map(r => env.DB.prepare("UPDATE answer_log SET question = ?, answer = ? " +
      "WHERE id = ? AND question = ? AND answer IS ?").bind(r.q, r.a, r.id, r.question, r.answer)));
  }
  return changed.map(r => r.id);
}

// Every row kept so far, scrubbed again with what the site knows of each account (accountNames), for rows kept before
// the scrub caught inflected names (LOR-628). POST /api/admin/willo {"action": "answer-log-rescrub", "dry_run"?}.
// Says how many rows and players there are, how many it could match to an account, and which row ids changed (never
// their text). Accounts come from connected apps, profiles and journeys: every kept answer came through a connected app.
export async function rescrubAnswerLog(env, { dryRun = false } = {}) {
  await setupAnswerLog(env);
  const players = new Set((await env.DB.prepare("SELECT DISTINCT player FROM answer_log").all()).results.map(r => r.player));
  const ids = async sql => env.DB.prepare(sql).all().then(r => r.results.map(x => x.id), () => []);
  const accounts = new Set((await Promise.all([ids("SELECT DISTINCT user_id AS id FROM devices"),
    ids("SELECT user_id AS id FROM profiles"), ids("SELECT DISTINCT user_id AS id FROM history_receipts")])).flat());
  const rows = (await env.DB.prepare("SELECT COUNT(*) AS n FROM answer_log").first())?.n || 0;
  let matched = 0;
  const changed = [];
  for (const userId of accounts) {
    if (!players.size) break;
    const key = await playerKey(env, userId);
    if (!players.delete(key)) continue;
    matched++;
    changed.push(...await rescrubPlayer(env, key, await accountNames(env, userId), { write: !dryRun }));
  }
  return { rows, players: matched + players.size, matched, changed: changed.sort((a, b) => a - b), dry_run: dryRun };
}

// The player keys whose earlier rows this isolate has scrubbed again with the companion's names (logAnswer).
const rescrubbed = new WeakMap();   // env.DB -> Set of player keys

// One answer, and the rows past KEEP_DAYS out, in one batch, unless the switch is off on the page (keepingOff). Never throws: keeping it must never cost the player their
// answer. names: the companion's; the site's own (accountNames) are added. The first answer an isolate keeps for a
// player also scrubs their earlier rows again with them, for characters only the companion knows (LOR-628).
export async function logAnswer(env, userId, entry = {}, { names = [], now = new Date() } = {}) {
  if (typeof entry.question !== "string" || !entry.question.trim() || !OUTCOMES.includes(entry.outcome)) return false;
  try {
    if (await keepingOff(env, userId)) return false;
    await setupAnswerLog(env);
    names = [...(Array.isArray(names) ? names : []), ...await accountNames(env, userId)];
    const question = clip(scrubNames(entry.question, names), 1000);
    if (!question) return false;
    const key = await playerKey(env, userId);
    if (!rescrubbed.has(env.DB)) rescrubbed.set(env.DB, new Set());
    if (names.length && !rescrubbed.get(env.DB).has(key)) {
      rescrubbed.get(env.DB).add(key);
      await rescrubPlayer(env, key, names);
    }
    const list = v => (Array.isArray(v) && v.length ? v : null);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO answer_log (created, player, operation, npc, spoken, zone, sub, question, answer, " +
        "action, model, model_ms, total_ms, looked_up, lookups, facts, feedback, outcome, error, ref, topic, ctx, say, plan) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(now.toISOString(),
        key, entry.operation === "character" ? "character" : "answer", clip(entry.npc, 80),
        entry.spoken ? 1 : 0, clip(entry.zone, 80), clip(entry.sub, 80), question,
        clip(scrubNames(entry.answer, names), 2000), clip(entry.action, 40), clip(entry.model, 60),
        whole(entry.model_ms), whole(entry.total_ms), clip(entry.looked_up, 16),
        list(entry.lookups)?.join(",").slice(0, 120) ?? null,
        list(entry.facts) ? JSON.stringify(entry.facts.slice(0, 12).map(t => String(t).slice(0, 80))) : null,
        clip(entry.feedback, 16),
        entry.outcome, clip(entry.error, 200), ANSWER_ID.test(entry.ref || "") ? entry.ref : null,
        topicOf(entry.question, { operation: entry.operation, lookups: entry.lookups, action: entry.action }),
        ctxOf(entry.ctx, names), clip(scrubNames(entry.say, names), 1000), clip(entry.plan, 24)),
      env.DB.prepare("DELETE FROM answer_log WHERE created < ?").bind(cutoff(now)),
    ]);
    return true;
  } catch (e) {
    console.warn(`answer log: ${e?.message || e}`);
    return false;
  }
}

// What came after an answer (lib/answer-signals.js SIGNALS), added to its row: the one with that ref, or without one
// (an older app) the player's latest within TAG_MS whose question is `question` when given. Only rows kept while the
// switch was on exist to tag. Never throws; true when a row took them.
const TAG_MS = 10 * 60_000;
export async function tagAnswer(env, userId, { ref = null, tags = [], question = null } = {}, { now = new Date() } = {}) {
  const add = [...new Set((Array.isArray(tags) ? tags : []).filter(t => Object.hasOwn(SIGNALS, t)))];
  if (!add.length) return false;
  try {
    await setupAnswerLog(env);
    const key = await playerKey(env, userId);
    const row = ANSWER_ID.test(ref || "")
      ? await env.DB.prepare("SELECT id, signals FROM answer_log WHERE ref = ? AND player = ?").bind(ref, key).first()
      : await env.DB.prepare("SELECT id, signals FROM answer_log WHERE player = ? AND created >= ?" +
        (question ? " AND question = ?" : "") + " ORDER BY id DESC LIMIT 1")
        .bind(...[key, new Date(now.getTime() - (question ? KEEP_DAYS * 864e5 : TAG_MS)).toISOString(),
          ...(question ? [clip(scrubNames(question, await accountNames(env, userId)), 1000)] : [])]).first();
    if (!row) return false;
    const merged = [...new Set([...(row.signals ? row.signals.split(",") : []), ...add])].join(",");
    if (merged === row.signals) return true;
    await env.DB.prepare("UPDATE answer_log SET signals = ? WHERE id = ? AND signals IS ?").bind(merged, row.id, row.signals).run();
    return true;
  } catch (e) {
    console.warn(`answer log tag: ${e?.message || e}`);
    return false;
  }
}

// One kept answer by its ref, for a report on it (lib/answer-feedback.js): what the queue shows beside the report.
export async function answerByRef(env, userId, ref) {
  if (!ANSWER_ID.test(ref || "")) return null;
  await setupAnswerLog(env);
  return env.DB.prepare("SELECT id, question, answer, zone, sub, spoken, topic, signals FROM answer_log " +
    "WHERE ref = ? AND player = ?").bind(ref, await playerKey(env, userId)).first();
}

// "Help improve Willo's answers" turned off on What Willo keeps (lib/willo-keeps.js keeps_settings): nothing is kept,
// whatever the app sends, until it's back on. No table yet is on. The review queue's implicit rows check it too.
export async function keepingOff(env, userId) {
  try {
    return (await env.DB.prepare("SELECT keep_answers FROM keeps_settings WHERE user_id = ?").bind(userId).first())
      ?.keep_answers === 0;
  } catch (e) {
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
//    models: {...}, plans: {...}, avg_total_ms, rows: [...], next}   next: the `after` for the next page, or null
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
  const [totals, outcomes, operations, lookedUp, models, plans, rows] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total, COUNT(DISTINCT player) AS players, CAST(AVG(total_ms) AS INTEGER) AS avg_ms " +
      "FROM answer_log WHERE created >= ?").bind(from).first(),
    group("outcome"), group("operation"), group("looked_up"), group("model"), group("plan"),
    env.DB.prepare("SELECT id, created, player, operation, npc, spoken, zone, sub, question, answer, action, model, " +
      "model_ms, total_ms, looked_up, lookups, facts, feedback, outcome, error, ref, signals, topic, ctx, say, plan FROM answer_log " +
      "WHERE created >= ? AND id > ? ORDER BY id LIMIT ?").bind(from, start, n + 1).all(),
  ]);
  const page = rows.results.slice(0, n);
  return { keep_days: KEEP_DAYS, since: from, total: totals?.total || 0, players: totals?.players || 0, outcomes,
    operations, looked_up: lookedUp, models, plans, avg_total_ms: totals?.avg_ms ?? null,
    rows: page.map(r => ({ ...r, facts: r.facts ? JSON.parse(r.facts) : [], ctx: r.ctx ? JSON.parse(r.ctx) : null })),
    next: rows.results.length > n ? page.at(-1).id : null };
}

// "What Willo keeps" (lib/willo-keeps.js, LOR-666): the account's own kept answers, newest first, and one of them
// erased. Like every read, old rows go first.
export async function playerAnswers(env, userId, { limit = 300, now = new Date() } = {}) {
  await setupAnswerLog(env);
  await env.DB.prepare("DELETE FROM answer_log WHERE created < ?").bind(cutoff(now)).run();
  const { results } = await env.DB.prepare("SELECT id, created, operation, npc, spoken, zone, sub, question, answer, " +
    "outcome, signals FROM answer_log WHERE player = ? ORDER BY id DESC LIMIT ?").bind(await playerKey(env, userId), limit + 1).all();
  return { rows: results.slice(0, limit), more: results.length > limit };
}

export async function eraseAnswer(env, userId, id) {
  await setupAnswerLog(env);
  const res = await env.DB.prepare("DELETE FROM answer_log WHERE id = ? AND player = ?")
    .bind(Number(id), await playerKey(env, userId)).run();
  return res.meta.changes > 0;
}

// "Delete my account" (lib/accounts.js deleteUser) and "Erase everything" (lib/willo-keeps.js): every answer kept for
// the account.
export async function forgetAnswerLog(env, userId) {
  await setupAnswerLog(env);
  await env.DB.prepare("DELETE FROM answer_log WHERE player = ?").bind(await playerKey(env, userId)).run();
}
