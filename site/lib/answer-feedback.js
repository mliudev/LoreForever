import { isReportRead } from "./report-read.js";
// What players think of Willo's answers (LOR-446), and the one review queue for them (Mike, 10/18: the feedback loop):
// every time a player says an answer is wrong, gets frustrated, presses 👎 "Not right", or the answer log's signals
// say an answer missed, it lands here, with the question, the answer and where they were, for /admin's Willo quality,
// the nightly check and the accuracy loop (classify, a fact and a gold case, a blind check), which writes back here.
//
// answer_feedback, one row per signal:
//   kind      "report" (👎 "Not right" on an answer, with reasons: POST /api/companion/feedback), "flag" (the same from
//             an app before reasons, or "Something's wrong"), "correction" (they say it's wrong or tell what's true:
//             "I'm pretty sure that's Dalaran"), "misheard" ("no, I meant…"), "frustration" ("that's useless", "you're not
//             listening"), "gave_up" ("never mind"), or "signal" (no words: the answer log's signals added up,
//             lib/answer-signals.js queueWorthy)
//   said      what the player said (their message, or the report's note, or its reasons in words)
//   question  the question the answer was for, when known; answer: what Willo said
//   zone, sub where they were; persona, spoken: who answered and how
//   user_hash the answer log's salted player key (lib/answer-log.js playerKey): one player's rows can be read together,
//             never turned back into the account. Rows from before 10/18 hold an unsalted hash until
//             rehashFeedback turns them into the key.
//   answer_ref the answer's id (answer_log.ref), so the queue reads its log row; reasons: the report's quick reasons
//             (REASONS, comma-separated); signals: the answer log's signals behind it; source: where it came from
//             (SOURCES); topic: lib/answer-signals.js topicOf
//   followup  1 when the player said yes to "Tell me when it's fixed": kept until then (past KEEP_DAYS, up to
//             FOLLOWUP_DAYS), and Willo says once, in-world, that she's learned it (learnedFor, told_at)
//   status    "new"; "triaged" (the accuracy loop classed it: class, gold_id, note); "fixed" (fixed_at, fixed_how:
//             fact, lore, prompt, code or voice; fixed_ref: the fact id or PR) or "fact" (became a Forever fact: fact_id);
//             "checked" (looked at, nothing to change) or "dismissed" (spam, a joke, a test)
// Nothing here is shown to other players. A correction never becomes a shared fact without checking. Each new word
// or tap report is also forwarded to Slack #player-feedback when SLACK_FEEDBACK_WEBHOOK is set (lib/slack-feedback.js),
// with the account's character names taken out; a "signal" never is. Names are taken out of what's kept too.
//
// How long (public/privacy.html): what players report (every kind but "signal") KEEP_DAYS; a "signal" is the answer
// log's, so its KEEP_DAYS (14); a followup until FIXED_DAYS after it's fixed, at most FOLLOWUP_DAYS. Facts made from
// them stay.

import { forwardFeedback } from "./slack-feedback.js";
import { playerKey, accountNames, scrubNames, setupAnswerLog, keepingOff, KEEP_DAYS as LOG_DAYS } from "./answer-log.js";
import { ANSWER_ID, SIGNALS, topicOf } from "./answer-signals.js";

const SETUP = [
  `CREATE TABLE IF NOT EXISTS answer_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, said TEXT NOT NULL, question TEXT, answer TEXT,
    zone TEXT, sub TEXT, persona TEXT, spoken INTEGER NOT NULL DEFAULT 0, user_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new', fact_id TEXT, note TEXT, created TEXT NOT NULL, updated TEXT)`,
  "CREATE INDEX IF NOT EXISTS answer_feedback_status ON answer_feedback (status, created)",
];
// Added since the table was first made (10/18): added once, where missing (setupFeedback).
const ADDED = ["answer_ref TEXT", "reasons TEXT", "signals TEXT", "source TEXT", "topic TEXT", "followup INTEGER",
  "class TEXT", "gold_id TEXT", "fixed_at TEXT", "fixed_how TEXT", "fixed_ref TEXT", "told_at TEXT"];
const AFTER_ADDED = ["CREATE INDEX IF NOT EXISTS answer_feedback_player ON answer_feedback (user_hash, created)"];
export const FEEDBACK_KINDS = ["report", "flag", "correction", "misheard", "frustration", "gave_up", "signal"];
// What a player said in words, or tapped: theirs to send, so kept whether or not the answer log's switch is on, except
// IMPLICIT_KINDS: "never mind" and "no, I meant…" aren't said to report anything, so they're kept only while "Help
// improve Willo's answers" is on, like the signals (vision blind check, 10/18).
export const SAID_KINDS = FEEDBACK_KINDS.filter(k => k !== "signal");
export const IMPLICIT_KINDS = ["misheard", "gave_up", "signal"];
export const FEEDBACK_STATUSES = ["new", "triaged", "fixed", "fact", "checked", "dismissed"];
export const FIXED = ["fixed", "fact"];
// The 👎 "Not right" quick reasons, in the order the apps show them.
export const REASONS = { wrong_fact: "Wrong fact", not_my_question: "Didn't answer my question", too_long: "Too long",
  too_short: "Too short", couldnt_hear: "Couldn't hear her", other: "Something else" };
// Where a report came from: her window, her chat over the game, the answer window over the game (overlay.py), the
// iPhone, or said (out loud or typed) as the next question.
export const SOURCES = ["window", "overgame", "overlay", "iphone", "voice", "typed"];
// What the accuracy loop says a miss was (queue-triage): a fact we don't have, the wrong records found, the model got
// it wrong with the right records, her voice, the app; or not a miss.
export const CLASSES = ["missing_fact", "retrieval", "model", "voice", "ux", "not_a_miss"];
export const FIX_HOW = ["fact", "lore", "prompt", "code", "voice"];

// A player telling the companion its last answer is wrong, or what's true in Forever. Plain words always count:
// "you're wrong", "that's not right", "make a note that ...".
const CORRECTION = new RegExp([
  String.raw`\b(?:you(?:'re| are)|that(?:'s| is| was)|it(?:'s| is| was)|this(?:'s| is)|you(?:'ve| have) got (?:it|that)) (?:wrong|not right|incorrect|outdated|mistaken)\b`,
  String.raw`\b(?:make|take) a note\b`, String.raw`\bthat(?:'s| is) not (?:true|how it is|what|where|right)\b`,
  String.raw`^\W*(?:wrong|not true|not right)\s*[,.!]`,
].join("|"), "i");
// ...and a statement (not a question) that disagrees: "I'm pretty sure that's Dalaran", "Actually it's rebuilt",
// "But I can choose undead paladin in WoW Forever".
const DISAGREES = new RegExp([
  String.raw`\bi(?:'m| am) (?:pretty |quite |fairly |very )?(?:sure|certain|positive) (?:that|it|this|they|there)\b`,
  String.raw`^\W*actually,? (?:it|that|this|there|they)(?:'s| is| was| are| goes| sails)\b`,
  // "The disarming tool I have is actually an off-hand weapon" (LOR-593, Mike's stream 10/15).
  String.raw`\b(?:is|are|was|were|it's|that's) actually\b`,
  String.raw`\b(?:can|is|are|has|have|goes|does|do)\b.*\bin (?:wow )?forever\b`,
].join("|"), "i");
// A "no" only disputes when it goes on to say how it is: "No, this boat goes to Southshore", "Nope, Thrall is
// warchief". A bare "no", a "no" answering something the companion asked, or a polite one ("nope, not yet, thank
// you", "no thanks, that's all") is just chat (nightly review, 10/15); after a question it needs an "actually".
const NO = /^\W*(?:no|nope)\b[\s,.!]*/i;
const NO_CLAIM = new RegExp([
  String.raw`^(?:it|that|this|they|there|the|he|she)\b`,
  String.raw`\b(?:actually|is|are|was|were|isn't|aren't|wasn't|weren't)\b`,
].join("|"), "i");
const POLITE = /\b(?:thanks?|thank you|thx|ty|not (?:yet|now|really|today)|i'?m (?:good|fine|ok|okay|set|all set)|that'?s (?:all|ok|okay|fine|it|alright)|all good|no worries|maybe later)\b/i;
function disputingNo(text, previous) {
  const rest = text.match(NO) ? text.replace(NO, "") : null;
  if (!rest || POLITE.test(rest) || !NO_CLAIM.test(rest)) return false;
  return !/\?\W*$/.test(previous) || /\bactually\b/i.test(rest);
}
// A player losing patience with the answers: said at the answers or at the companion, not about an item or a place.
const FRUSTRATION = new RegExp([
  String.raw`\b(?:you(?:'re| are)|that(?:'s| is| was)|this is|your answers?(?: (?:are|is))?) (?:so |just |really )?(?:useless|worthless|pointless|nonsense|rubbish|garbage|not (?:helping|helpful|listening)|no help|stupid|dumb|making (?:things|stuff|it) up)\b`,
  String.raw`\b(?:makes no sense|doesn'?t make (?:any )?sense|what are you talking about|are you even listening|listen to me)\b`,
  String.raw`\byou (?:keep|always) (?:saying|getting|telling)\b`, String.raw`^\W*(?:wtf|ffs)\b`,
  String.raw`\b(?:i (?:already )?told you|i just said|that'?s not what i asked)\b`,
].join("|"), "i");
// "No, I meant…" (PM, 10/18): she took the question for another; this message says what they meant.
const MISHEARD = new RegExp([
  String.raw`^\W*(?:no|nope|nah|sorry)?[\s,.!]*(?:i meant|i mean|i said|i asked(?: about| for)?|what i meant (?:is|was))\b`,
  String.raw`\b(?:that'?s|that is|it'?s) not what i (?:meant|said)\b`, String.raw`\byou misheard\b`,
].join("|"), "i");
// "Never mind" (PM, 10/18): giving up on what she said. Not when they found it themselves ("never mind, found it").
const GAVE_UP = /^\W*(?:never ?mind|nevermind|nvm|forget it|forget (?:that|i asked)|whatever|ugh+)\b/i;
const FOUND = /\b(?:found it|got it|figured (?:it )?out|my bad|thanks?|thank you|ty)\b/i;
const plain = text => String(text || "").replace(/[’‘]/g, "'").trim();
// "frustration", "gave_up", "misheard", "correction" or null for what a player said. Only after an answer (previous:
// the companion's last answer in this chat): with nothing said yet there's nothing to dispute.
export function feedbackKind(said, previous = "") {
  const text = plain(said);
  if (!text || !plain(previous)) return null;
  if (FRUSTRATION.test(text)) return "frustration";
  if (CORRECTION.test(text) || (!text.endsWith("?") && (DISAGREES.test(text) || disputingNo(text, plain(previous)))))
    return "correction";
  // After the two above, so nothing they caught changes kind: these two get no words of their own in her prompt
  // (lib/companion-answers.js DISPUTE_SYSTEM), and her answer is as it was.
  if (MISHEARD.test(text)) return "misheard";
  if (GAVE_UP.test(text) && !FOUND.test(text)) return "gave_up";
  return null;
}

const ready = new WeakMap();
export async function setupFeedback(env) {
  if (isReportRead(env)) return;
  if (ready.get(env.DB)) return;
  // The answer log's too: its salt keys these rows, and the queue reads its rows.
  await Promise.all([env.DB.batch(SETUP.map(sql => env.DB.prepare(sql))), setupAnswerLog(env)]);
  const have = new Set((await env.DB.prepare("PRAGMA table_info(answer_feedback)").all()).results.map(c => c.name));
  for (const column of ADDED) {
    if (have.has(column.split(" ")[0])) continue;
    try { await env.DB.prepare(`ALTER TABLE answer_feedback ADD COLUMN ${column}`).run(); }
    catch (e) { if (!/duplicate column/i.test(String(e?.message))) throw e; }
  }
  await env.DB.batch(AFTER_ADDED.map(sql => env.DB.prepare(sql)));
  ready.set(env.DB, true);
}

// Before 10/18 rows were keyed by an unsalted hash of the account id; reads and erases match both until
// rehashFeedback has turned every one into the salted key.
const legacyHash = async id => [...new Uint8Array(await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(`answer-feedback:${id}`)))].map(b => b.toString(16).padStart(2, "0")).join("");
async function withKeys(env, userId) {
  await setupAnswerLog(env);
  return [await playerKey(env, userId), await legacyHash(userId)];
}
const clip = (s, n) => (typeof s === "string" ? s : "").trim().slice(0, n) || null;

// Kept this long, then deleted (public/privacy.html says so); facts made from them stay. A "signal" is the answer
// log's (LOG_DAYS). A followup stays until FIXED_DAYS after it's fixed (time for Willo to say so), at most
// FOLLOWUP_DAYS.
export const KEEP_DAYS = 90;
export const FOLLOWUP_DAYS = 365;
export const FIXED_DAYS = 14;
const SAME_SIGNAL_MS = 10_000;
const ago = (now, days) => new Date(now.getTime() - days * 864e5).toISOString();

// Every row past its time, out. Before every read, and with every new row.
function purge(env, now = new Date()) {
  return env.DB.prepare("DELETE FROM answer_feedback WHERE (kind = 'signal' AND created < ?) OR (created < ? AND " +
    "(followup IS NOT 1 OR created < ? OR (fixed_at IS NOT NULL AND fixed_at < ?)))")
    .bind(ago(now, LOG_DAYS), ago(now, KEEP_DAYS), ago(now, FOLLOWUP_DAYS), ago(now, FIXED_DAYS));
}

// The private dashboard has no cleanup privilege. Apply the same expiry to reads,
// including related log rows, without waiting for the next writer to delete them.
export function prepareFeedbackRead(env, sql, now = new Date()) {
  if (!isReportRead(env)) return env.DB.prepare(sql);
  const args = [ago(now, LOG_DAYS), ago(now, KEEP_DAYS), ago(now, FOLLOWUP_DAYS), ago(now, FIXED_DAYS), ago(now, LOG_DAYS)];
  const statement = env.DB.prepare(`WITH retained_feedback AS (
    SELECT * FROM answer_feedback WHERE NOT ((kind = 'signal' AND created < ?) OR (created < ? AND
      (followup IS NOT 1 OR created < ? OR (fixed_at IS NOT NULL AND fixed_at < ?)))))
    , retained_log AS (SELECT * FROM answer_log WHERE created >= ?) ` +
    sql.replace(/\banswer_feedback\b/g, "retained_feedback").replace(/\banswer_log\b/g, "retained_log"));
  return { bind: (...values) => statement.bind(...args, ...values),
    all: () => statement.bind(...args).all(), first: (...values) => statement.bind(...args).first(...values) };
}

const list = (values, allowed) => [...new Set((Array.isArray(values) ? values : [])
  .filter(v => typeof v === "string" && (Array.isArray(allowed) ? allowed.includes(v) : Object.hasOwn(allowed, v))))];

// Keep one signal. Never throws: feedback must never cost the player their answer. forward: {context (the Pages
// context), names (character names to take out), client (X-LF-Client)} to forward a new one to Slack (never a
// "signal"). The account's character names (names, and what the site knows: accountNames) are taken out of what's
// kept. IMPLICIT_KINDS only while the account's "Help improve Willo's answers" isn't off on the page (the app sends
// them only while its own switch is on: answer.js). Returns the row's id, or false.
export async function logFeedback(env, userId, { kind, said, question, answer, zone, sub, persona, spoken, answerRef,
  reasons, signals, source, followup } = {}, { context = null, names = [], client = null, now = new Date() } = {}) {
  if (!FEEDBACK_KINDS.includes(kind) || !clip(said, 1)) return false;
  try {
    if (IMPLICIT_KINDS.includes(kind) && await keepingOff(env, userId)) return false;
    await setupFeedback(env);
    const scrubbed = [...(Array.isArray(names) ? names : []), ...await accountNames(env, userId)];
    const out = (s, n) => clip(scrubNames(typeof s === "string" ? s : "", scrubbed), n);
    const hash = await playerKey(env, userId);
    const why = list(reasons, REASONS), tags = list(signals, SIGNALS);
    const ref = ANSWER_ID.test(answerRef || "") ? answerRef : null;
    const q = out(question, 600), a = out(answer, 1200);
    // The same signal again within SAME_SIGNAL_MS (a double press: LOR-623, two rows half a second apart) is one.
    const [row] = await env.DB.batch([
      env.DB.prepare("INSERT INTO answer_feedback (kind, said, question, answer, zone, sub, persona, spoken, user_hash, " +
        "created, answer_ref, reasons, signals, source, topic, followup) " +
        "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM answer_feedback " +
        "WHERE user_hash = ? AND kind = ? AND question IS ? AND answer IS ? AND created > ?) RETURNING id").bind(kind,
        out(said, 600), q, a, clip(zone, 80), clip(sub, 80), clip(persona, 16), spoken ? 1 : 0, hash, now.toISOString(),
        ref, why.join(",") || null, tags.join(",") || null, SOURCES.includes(source) ? source : null,
        topicOf(question), followup === true ? 1 : null,
        hash, kind, q, a, new Date(now.getTime() - SAME_SIGNAL_MS).toISOString()),
      purge(env, now),
    ]);
    const id = row?.results?.[0]?.id;
    if (id && context && kind !== "signal") forwardFeedback(context, "willo", { id, kind, said, question, answer, zone,
      sub, persona, spoken, userId, names, client, reasons: why, source });
    return id || true;
  } catch (e) {
    console.warn(`answer feedback: ${e?.message || e}`);
    return false;
  }
}

const COLUMNS = "id, kind, said, question, answer, zone, sub, persona, spoken, status, fact_id, note, created, " +
  "answer_ref, reasons, signals, source, topic, followup, class, gold_id, fixed_at, fixed_how, fixed_ref, told_at";
const split = v => (v ? String(v).split(",").filter(Boolean) : []);
const shaped = r => ({ ...r, reasons: split(r.reasons), signals: split(r.signals), followup: r.followup === 1 });

// /admin: counts by kind and status, and the newest signals (new first). Players repeating the same complaint about
// the same place show as separate rows; `players` counts the distinct accounts behind a zone's new signals.
export async function feedbackReport(env, limit = 200) {
  await setupFeedback(env);
  if (!isReportRead(env)) await purge(env).run();
  const [counts, rows, zones] = await Promise.all([
    prepareFeedbackRead(env, "SELECT kind, status, COUNT(*) AS n FROM answer_feedback GROUP BY kind, status").all(),
    prepareFeedbackRead(env, `SELECT ${COLUMNS}, substr(user_hash, 1, 10) AS player ` +
      "FROM answer_feedback ORDER BY status IN ('new', 'triaged') DESC, id DESC LIMIT ?").bind(limit).all(),
    prepareFeedbackRead(env, "SELECT COALESCE(zone, '') AS zone, COUNT(*) AS n, COUNT(DISTINCT user_hash) AS players " +
      "FROM answer_feedback WHERE status = 'new' GROUP BY zone ORDER BY n DESC LIMIT 20").all(),
  ]);
  return { counts: counts.results, rows: rows.results.map(shaped), zones: zones.results };
}

// The review queue, for the accuracy loop's nightly run and /admin's Willo quality (GET /api/admin/willo?queue=1):
// oldest first after `after`, of one status ("open": new and triaged; "all"), each with its answer log row when the
// answer was kept (log: model, looked_up, lookups, facts, outcome, error, total_ms; ctx: race, class, level, faction,
// target; spoken; say: what she said out loud when that wasn't the whole answer; previous: {question, answer} of the
// turn before; or null) and how many players asked the same question in the same place among the open rows
// (players_same).
export async function queueReport(env, { status = "open", since = null, after = 0, limit = 200, now = new Date() } = {}) {
  await setupFeedback(env);
  if (!isReportRead(env)) await purge(env, now).run();
  const statuses = status === "all" ? FEEDBACK_STATUSES : status === "open" ? ["new", "triaged"]
    : FEEDBACK_STATUSES.includes(status) ? [status] : ["new"];
  const from = typeof since === "string" && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : "";
  const n = Math.min(Math.max(Number.parseInt(limit, 10) || 200, 1), 500);
  const start = Math.max(Number.parseInt(after, 10) || 0, 0);
  const marks = statuses.map(() => "?").join(", ");
  let logged = true;
  const query = joined => prepareFeedbackRead(env, `SELECT ${COLUMNS.split(", ").map(c => `f.${c}`).join(", ")}, ` +
    "substr(f.user_hash, 1, 10) AS player, (SELECT COUNT(DISTINCT g.user_hash) FROM answer_feedback g " +
    "WHERE g.status IN ('new', 'triaged') AND lower(g.question) = lower(f.question) AND g.zone IS f.zone) AS players_same" +
    (joined ? ", l.model AS l_model, l.looked_up AS l_looked_up, l.lookups AS l_lookups, l.facts AS l_facts, " +
      "l.outcome AS l_outcome, l.error AS l_error, l.total_ms AS l_total_ms, l.id AS l_id, l.ctx AS l_ctx, " +
      "l.say AS l_say, l.spoken AS l_spoken, l.created AS l_created, " +
      // The turn before the answer (the same player's kept answer just before it, within the hour), for context.
      "(SELECT json_object('question', p.question, 'answer', p.answer) FROM answer_log p WHERE p.player = l.player " +
      "AND p.id < l.id AND p.created >= strftime('%Y-%m-%dT%H:%M:%fZ', l.created, '-1 hour') ORDER BY p.id DESC LIMIT 1) AS l_previous " +
      "FROM answer_feedback f LEFT JOIN answer_log l ON l.ref = f.answer_ref AND f.answer_ref IS NOT NULL "
      : "FROM answer_feedback f ") +
    `WHERE f.status IN (${marks}) AND f.created >= ? AND f.id > ? ORDER BY f.id LIMIT ?`, now)
    .bind(...statuses, from, start, n + 1).all();
  // No answer log yet (no player has kept an answer): the rows without it.
  const { results } = await query(true).catch(() => { logged = false; return query(false); });
  const page = results.slice(0, n).map(r => {
    const row = shaped(Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("l_"))));
    row.log = logged && r.l_id ? { model: r.l_model, looked_up: r.l_looked_up, lookups: split(r.l_lookups),
      facts: r.l_facts ? JSON.parse(r.l_facts) : [], outcome: r.l_outcome, error: r.l_error, total_ms: r.l_total_ms,
      ctx: r.l_ctx ? JSON.parse(r.l_ctx) : null, spoken: r.l_spoken === 1, say: r.l_say || null,
      previous: r.l_previous ? JSON.parse(r.l_previous) : null } : null;
    return row;
  });
  return { status, rows: page, next: results.length > n ? page.at(-1).id : null };
}

// "What Willo keeps" (lib/willo-keeps.js, LOR-666): the account's own signals, newest first, and one of them erased.
// A "signal" is the answer log's, shown there on the answer it's about (lib/answer-log.js signals), not here.
export async function playerFeedback(env, userId, { limit = 200, now = new Date() } = {}) {
  await setupFeedback(env);
  await purge(env, now).run();
  const [key, legacy] = await withKeys(env, userId);
  const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM answer_feedback WHERE user_hash IN (?, ?) ` +
    "AND kind != 'signal' ORDER BY id DESC LIMIT ?").bind(key, legacy, limit + 1).all();
  return { rows: results.slice(0, limit).map(shaped), more: results.length > limit };
}

export async function eraseFeedback(env, userId, id) {
  await setupFeedback(env);
  const [key, legacy] = await withKeys(env, userId);
  const res = await env.DB.prepare("DELETE FROM answer_feedback WHERE id = ? AND user_hash IN (?, ?)")
    .bind(Number(id), key, legacy).run();
  return res.meta.changes > 0;
}

// "Delete my account" (lib/accounts.js deleteUser) and "Erase everything" (lib/willo-keeps.js): every signal the account
// sent. Facts made from them stay.
export async function forgetFeedback(env, userId) {
  const [key, legacy] = await withKeys(env, userId);
  await env.DB.prepare("DELETE FROM answer_feedback WHERE user_hash IN (?, ?)").bind(key, legacy).run();
}

// /admin and the nightly check: one row's status. "fixed" stamps fixed_at (once), so a followup is told.
export async function setFeedbackStatus(env, id, status, { factId = null, note = null, now = new Date() } = {}) {
  if (!FEEDBACK_STATUSES.includes(status) || !Number.isSafeInteger(id)) return false;
  await setupFeedback(env);
  const fixed = FIXED.includes(status);
  const r = await env.DB.prepare("UPDATE answer_feedback SET status = ?, fact_id = COALESCE(?, fact_id), " +
    "note = COALESCE(?, note), updated = ?, fixed_at = CASE WHEN ? THEN COALESCE(fixed_at, ?) ELSE NULL END, " +
    "fixed_how = CASE WHEN ? THEN COALESCE(fixed_how, ?) ELSE NULL END WHERE id = ?").bind(status, factId,
    clip(note, 600), now.toISOString(), fixed ? 1 : 0, now.toISOString(), fixed ? 1 : 0, factId ? "fact" : null, id).run();
  return r.meta.changes > 0;
}

const ids = values => [...new Set((Array.isArray(values) ? values : [values]).map(v => Number.parseInt(v, 10))
  .filter(v => Number.isSafeInteger(v) && v > 0))].slice(0, 200);

// The accuracy loop's verdict on rows (POST /api/admin/willo {"action": "queue-triage"}): what the miss was (CLASSES),
// one line why, and the fact and gold case it drafted, when it did. Returns how many rows took it.
export async function triageFeedback(env, rowIds, { cls, note = null, factId = null, goldId = null, now = new Date() } = {}) {
  const list_ = ids(rowIds);
  if (!CLASSES.includes(cls) || !list_.length) return 0;
  await setupFeedback(env);
  const res = await env.DB.batch(list_.map(id => env.DB.prepare("UPDATE answer_feedback SET status = CASE WHEN " +
    "status IN ('new', 'triaged') THEN 'triaged' ELSE status END, class = ?, note = COALESCE(?, note), " +
    "fact_id = COALESCE(?, fact_id), gold_id = COALESCE(?, gold_id), updated = ? WHERE id = ?")
    .bind(cls, clip(note, 600), clip(factId, 80), clip(goldId, 80), now.toISOString(), id)));
  return res.reduce((n, r) => n + (r.meta?.changes || 0), 0);
}

// A fix landed (POST /api/admin/willo {"action": "queue-fixed"}, or Fixed in /admin): how (FIX_HOW) and where (a fact
// id, a PR). A followup player hears it once at their next answer (learnedFor). Returns how many rows took it.
export async function markFixed(env, rowIds, { how, ref = null, note = null, now = new Date() } = {}) {
  const list_ = ids(rowIds);
  if (!FIX_HOW.includes(how) || !list_.length) return 0;
  await setupFeedback(env);
  const res = await env.DB.batch(list_.map(id => env.DB.prepare("UPDATE answer_feedback SET status = 'fixed', " +
    "fixed_at = COALESCE(fixed_at, ?), fixed_how = ?, fixed_ref = COALESCE(?, fixed_ref), note = COALESCE(?, note), " +
    "updated = ? WHERE id = ?").bind(now.toISOString(), how, clip(ref, 80), clip(note, 600), now.toISOString(), id)));
  return res.reduce((n, r) => n + (r.meta?.changes || 0), 0);
}

// What Willo may say she's learned (GET /api/keeps/changes `learned`): the account's reports it asked to hear about,
// fixed and not said yet. Willo's app says each once, in-world, after her next answer, and says so (markTold).
export async function learnedFor(env, userId, { limit = 3 } = {}) {
  await setupFeedback(env);
  const [key, legacy] = await withKeys(env, userId);
  const { results } = await env.DB.prepare("SELECT id, question, said FROM answer_feedback WHERE user_hash IN (?, ?) " +
    "AND followup = 1 AND status IN ('fixed', 'fact') AND told_at IS NULL ORDER BY id LIMIT ?").bind(key, legacy, limit).all();
  return results.map(r => ({ id: r.id, question: (r.question || r.said || "").replaceAll("{player}", "you").slice(0, 160),
    line: learnedLine(r.question) }));
}

// Her words for it: in-world, never a form, an id or a ticket (Mike's immersion rule).
export function learnedLine(question) {
  const q = String(question || "").replaceAll("{player}", "you").replace(/\s+/g, " ").trim();
  const asked = q && q.length <= 90 ? `“${q.replace(/[.?!]+$/, "")}?”` : "";
  return asked ? `Remember when you asked me ${asked} I had it wrong then. I've learned it now. Thank you for telling me!`
    : "That answer you told me I got wrong? I've learned it now. Thank you for telling me!";
}

export async function markTold(env, userId, rowIds, { now = new Date() } = {}) {
  const list_ = ids(rowIds);
  if (!list_.length) return 0;
  await setupFeedback(env);
  const [key, legacy] = await withKeys(env, userId);
  const res = await env.DB.batch(list_.map(id => env.DB.prepare("UPDATE answer_feedback SET told_at = ? " +
    "WHERE id = ? AND user_hash IN (?, ?) AND told_at IS NULL").bind(now.toISOString(), id, key, legacy)));
  return res.reduce((n, r) => n + (r.meta?.changes || 0), 0);
}

// Rows from before 10/18, brought up to the answer log's rules (PM, 10/18): their unsalted hash becomes the salted
// player key, and the account's character names come out of what they kept. POST /api/admin/willo
// {"action": "feedback-rehash", "dry_run"?}: counts only, never text. Accounts come from connected apps (every Willo
// report came through one) and the users table.
export async function rehashFeedback(env, { dryRun = false } = {}) {
  await setupFeedback(env);
  const hashes = new Set((await env.DB.prepare("SELECT DISTINCT user_hash AS h FROM answer_feedback").all()).results.map(r => r.h));
  const accounts = new Set((await Promise.all(["SELECT DISTINCT user_id AS id FROM devices", "SELECT id FROM users"]
    .map(sql => env.DB.prepare(sql).all().then(r => r.results.map(x => x.id), () => [])))).flat());
  let moved = 0, rescrubbed = 0;
  for (const userId of accounts) {
    if (!hashes.size) break;
    const [key, legacy] = await withKeys(env, userId);
    const has = hashes.delete(legacy), keyed = hashes.delete(key);
    if (!has && !keyed) continue;
    const names = await accountNames(env, userId);
    const { results } = await env.DB.prepare("SELECT id, said, question, answer FROM answer_feedback WHERE user_hash IN (?, ?)")
      .bind(key, legacy).all();
    const writes = [];
    if (has) {
      moved += results.length;
      writes.push(env.DB.prepare("UPDATE answer_feedback SET user_hash = ? WHERE user_hash = ?").bind(key, legacy));
    }
    for (const r of results) {
      const [said, question, answer] = [r.said, r.question, r.answer].map(s => (s ? scrubNames(s, names) : s));
      if (said === r.said && question === r.question && answer === r.answer) continue;
      rescrubbed++;
      writes.push(env.DB.prepare("UPDATE answer_feedback SET said = ?, question = ?, answer = ? WHERE id = ?")
        .bind(said, question, answer, r.id));
    }
    if (!dryRun && writes.length) await env.DB.batch(writes);
  }
  return { rows_moved: moved, rows_rescrubbed: rescrubbed, unmatched_players: hashes.size, dry_run: dryRun };
}

// "What you sent" (lib/contributions.js): the reports the account made in its own words or taps, newest first, with
// their status, for what became of each. Never a "signal", which the player didn't send.
export async function sentFeedback(env, userId, limit = 100) {
  await setupFeedback(env);
  const [key, legacy] = await withKeys(env, userId);
  const { results } = await env.DB.prepare("SELECT created, kind, said, question, status FROM answer_feedback " +
    "WHERE user_hash IN (?, ?) AND kind IN ('report', 'flag', 'correction', 'misheard') ORDER BY id DESC LIMIT ?")
    .bind(key, legacy, limit).all();
  return results;
}
