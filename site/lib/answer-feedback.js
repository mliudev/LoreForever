// What players think of Willo's answers (LOR-446): every time one says an answer is wrong, gets frustrated, or flags
// it, it comes back to us here, with the question, the answer and where they were, for /admin and the nightly check.
//
// answer_feedback, one row per signal:
//   kind      "correction" (they say it's wrong or tell what's true: "I'm pretty sure that's Dalaran"),
//             "frustration" ("that's useless", "you're not listening"), or "flag" (the Wrong answer button, or saying
//             "that's wrong" to Willo out loud, through POST /api/companion/feedback)
//   said      what the player said (their message, or the flag's note)
//   question  the question the answer was for, when known; answer: what the companion said
//   zone, sub where they were; persona, spoken: who answered and how
//   user_hash SHA-256 of the account id, so independent players can be counted without naming anyone
//   status    "new", then "checked" (looked at, nothing to change), "fact" (became a Forever fact: fact_id) or
//             "dismissed" (spam, a joke, a test)
// Nothing here is shown to other players. A correction never becomes a shared fact without checking.

const SETUP = [
  `CREATE TABLE IF NOT EXISTS answer_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, said TEXT NOT NULL, question TEXT, answer TEXT,
    zone TEXT, sub TEXT, persona TEXT, spoken INTEGER NOT NULL DEFAULT 0, user_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new', fact_id TEXT, note TEXT, created TEXT NOT NULL, updated TEXT)`,
  "CREATE INDEX IF NOT EXISTS answer_feedback_status ON answer_feedback (status, created)",
];
export const FEEDBACK_KINDS = ["correction", "frustration", "flag"];
export const FEEDBACK_STATUSES = ["new", "checked", "fact", "dismissed"];

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
const plain = text => String(text || "").replace(/[’‘]/g, "'").trim();
// "frustration", "correction" or null for what a player said. Only after an answer (previous: the companion's last
// answer in this chat): with nothing said yet there's nothing to dispute.
export function feedbackKind(said, previous = "") {
  const text = plain(said);
  if (!text || !plain(previous)) return null;
  if (FRUSTRATION.test(text)) return "frustration";
  if (CORRECTION.test(text) || (!text.endsWith("?") && (DISAGREES.test(text) || disputingNo(text, plain(previous)))))
    return "correction";
  return null;
}

const ready = new WeakMap();
export async function setupFeedback(env) {
  if (ready.get(env.DB)) return;
  await env.DB.batch(SETUP.map(sql => env.DB.prepare(sql)));
  ready.set(env.DB, true);
}

const userHash = async id => [...new Uint8Array(await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(`answer-feedback:${id}`)))].map(b => b.toString(16).padStart(2, "0")).join("");
const clip = (s, n) => (typeof s === "string" ? s : "").trim().slice(0, n) || null;

// Kept this long, then deleted (public/privacy.html says so); facts made from them stay.
export const KEEP_DAYS = 90;

// Keep one signal, and now and then let the old ones go. Never throws: feedback must never cost the player their
// answer.
export async function logFeedback(env, userId, { kind, said, question, answer, zone, sub, persona, spoken } = {}) {
  if (!FEEDBACK_KINDS.includes(kind) || !clip(said, 1)) return false;
  try {
    await setupFeedback(env);
    const now = new Date();
    await env.DB.prepare("INSERT INTO answer_feedback (kind, said, question, answer, zone, sub, persona, spoken, " +
      "user_hash, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(kind, clip(said, 600), clip(question, 600),
      clip(answer, 1200), clip(zone, 80), clip(sub, 80), clip(persona, 16), spoken ? 1 : 0, await userHash(userId),
      now.toISOString()).run();
    if (Math.random() < 0.05) {
      await env.DB.prepare("DELETE FROM answer_feedback WHERE created < ?")
        .bind(new Date(now.getTime() - KEEP_DAYS * 864e5).toISOString()).run();
    }
    return true;
  } catch (e) {
    console.warn(`answer feedback: ${e?.message || e}`);
    return false;
  }
}

// /admin: counts by kind and status, and the newest signals (new first). Players repeating the same complaint about
// the same place show as separate rows; `players` counts the distinct accounts behind a zone's new signals.
export async function feedbackReport(env, limit = 100) {
  await setupFeedback(env);
  const [counts, rows, zones] = await Promise.all([
    env.DB.prepare("SELECT kind, status, COUNT(*) AS n FROM answer_feedback GROUP BY kind, status").all(),
    env.DB.prepare("SELECT id, kind, said, question, answer, zone, sub, persona, spoken, status, fact_id, note, created, " +
      "substr(user_hash, 1, 10) AS player " +
      "FROM answer_feedback ORDER BY status = 'new' DESC, id DESC LIMIT ?").bind(limit).all(),
    env.DB.prepare("SELECT COALESCE(zone, '') AS zone, COUNT(*) AS n, COUNT(DISTINCT user_hash) AS players " +
      "FROM answer_feedback WHERE status = 'new' GROUP BY zone ORDER BY n DESC LIMIT 20").all(),
  ]);
  return { counts: counts.results, rows: rows.results, zones: zones.results };
}

// "Delete my account" (lib/accounts.js deleteUser): every signal the account sent. Facts made from them stay.
export async function forgetFeedback(env, userId) {
  await env.DB.prepare("DELETE FROM answer_feedback WHERE user_hash = ?").bind(await userHash(userId)).run();
}

export async function setFeedbackStatus(env, id, status, { factId = null, note = null } = {}) {
  if (!FEEDBACK_STATUSES.includes(status) || !Number.isSafeInteger(id)) return false;
  await setupFeedback(env);
  const r = await env.DB.prepare("UPDATE answer_feedback SET status = ?, fact_id = COALESCE(?, fact_id), " +
    "note = COALESCE(?, note), updated = ? WHERE id = ?").bind(status, factId, clip(note, 600), new Date().toISOString(), id).run();
  return r.meta.changes > 0;
}
