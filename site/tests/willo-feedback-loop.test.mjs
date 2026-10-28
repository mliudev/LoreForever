// Willo's feedback loop (10/18): every answer has an id; 👎 "Not right" with reasons, "that's wrong", "no, I meant…" and
// "never mind" land in one review queue; the app's facts about the answer before (asked again, cut off, voice never
// played) tag it in the answer log with no model call, and a strong one is queued too; the accuracy loop triages and
// marks rows fixed through /api/admin/willo; a player who asked hears once, in-world, that she's learned it; reports
// follow the answer log's anonymity and go after 90 days (signals after 14); /admin's Willo quality counts it all.
// D1 is node:sqlite (helpers.mjs).

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { onRequest as answer } from "../functions/api/companion/answer.js";
import { onRequestPost as feedback, THANKS, THANKS_FOLLOWUP } from "../functions/api/companion/feedback.js";
import { onRequestGet as adminGet, onRequestPost as adminPost } from "../functions/api/admin/willo.js";
import { onRequest as keepsApi } from "../functions/api/keeps/[action].js";
import { findOrCreateUser, setup, startSession, deleteUser } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { setupAnswerLog, logAnswer, KEEP_DAYS as LOG_DAYS } from "../lib/answer-log.js";
import { setupFeedback, logFeedback, feedbackKind, playerFeedback, rehashFeedback, learnedLine, KEEP_DAYS,
  FOLLOWUP_DAYS } from "../lib/answer-feedback.js";
import { signalsFor, sameQuestion, lastOf, queueWorthy, topicOf, ANSWER_ID } from "../lib/answer-signals.js";
import { qualityReport } from "../lib/willo-quality.js";
import { TOGETHER_URL, resetBreaker } from "../lib/together.js";
import { d1 } from "./helpers.mjs";

const ORIGIN = "https://example.test";
const env = { DB: d1(), GEMINI_API_KEY: "test-key", ADMIN_KEY: "admin-test" };
const originalFetch = globalThis.fetch;
const rows = (table, where = "1", ...args) => env.DB.sqlite.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...args);
let reply = "Sentinel Hill is east of the farms.";

beforeEach(async () => {
  await setup(env);
  await setupAnswerLog(env);
  await setupFeedback(env);
  for (const t of ["users", "sessions", "devices", "device_links", "rate_limits", "answer_spend", "free_pool_days", "answer_log",
                   "answer_feedback"]) env.DB.sqlite.exec(`DELETE FROM ${t}`);
  reply = "Sentinel Hill is east of the farms.";
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: reply }] } }],
    usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40 } });
});
afterEach(() => { globalThis.fetch = originalFetch; });

let n = 0;
async function linked(name = `Hurin${++n}`) {
  const user = await findOrCreateUser(env, { email: `${name}@example.com`, googleSub: name, name });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  const { token } = await claimToken(env, link.device_code);
  const post = (path, body, client = "companion/0.22.0") => new Request(`${ORIGIN}/api/companion/${path}`, { method: "POST",
    headers: { "X-LF-Client": client, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body) });
  const ask = async (question, extra = {}, before = null) => (await answer({ request: post("answer", {
    prompt: `PLAYER CONTEXT\nzone: Westfall\n${before ? `\nRECENT CONVERSATION (oldest first)\n${JSON.stringify([before])}\n` : ""}` +
      `\nQUESTION\n${question}`, persona: "willo", keep: true, names: [name], ...extra }), env })).json();
  const rate = async body => { const res = await feedback({ request: post("feedback", body), env }); return { status: res.status, body: await res.json() }; };
  const keeps = async (action, body) => {
    const method = body === undefined ? "GET" : "POST";
    const res = await keepsApi({ request: new Request(`${ORIGIN}/api/keeps/${action}`, { method, headers: {
      "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined }), env, params: { action } });
    return res.json();
  };
  return { user, token, ask, rate, keeps, name };
}
const admin = async (method, body, query = "") => (await (method === "GET" ? adminGet : adminPost)({ request: new Request(
  `${ORIGIN}/api/admin/willo${query}`, { method, headers: { Authorization: "Bearer admin-test",
    ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }), env })).json();

test("the same question again, in other words or the same ones; a follow-up is not one", () => {
  assert.ok(sameQuestion("Where is the Southshore boat?", "where's the boat from Southshore"));
  assert.ok(sameQuestion("where is sentinel hill", "Where is Sentinel Hill?"));
  assert.ok(sameQuestion("Which boat goes to Southshore from Menethil?", "what boat goes from Menethil to Southshore"));
  for (const [a, b] of [["Why?", "Where is Sentinel Hill?"], ["Tell me more", "Where is Sentinel Hill?"],
    ["Where is the bank in Ironforge?", "Where is the flight master in Stormwind?"]]) assert.ok(!sameQuestion(a, b), a);
});

test("signals come from the app's facts and the words, never a model call", () => {
  const previousQuestion = "Where is the Southshore boat?";
  const quick = { answer_id: "0123456789abcdef", ms: 20_000 };
  assert.deepEqual(signalsFor({ question: "where's the boat from Southshore", previousQuestion, last: quick }), ["rephrased"]);
  assert.deepEqual(signalsFor({ question: "where's the boat from Southshore", previousQuestion, last: { ...quick, ms: 120_000 } }),
    [], "asked again two minutes on is just asking again");
  assert.deepEqual(signalsFor({ question: "Where is the Southshore boat?", previousQuestion, last: { ms: 200_000, failed: true } }),
    ["failed", "repeated_after_fail"]);
  assert.deepEqual(signalsFor({ question: "And the inn?", previousQuestion, last: { ...quick, heard: "interrupted" } }), ["interrupted"]);
  assert.deepEqual(signalsFor({ question: "where's the boat from Southshore", previousQuestion, spoken: false,
    last: { ...quick, spoken: true, heard: "dropped" } }), ["voice_dropped", "rephrased", "typed_after_voice_fail"]);
  assert.deepEqual(signalsFor({ question: "That's wrong", previousQuestion, last: null, dispute: "correction" }), ["corrected"]);
  // Doubt in other words (the live log, 10/18) is a miss too, as a signal only: her answer doesn't change for it.
  for (const q of ["I think that must be wrong. Sixty eight forty three is Hammerfall.", "That doesn't sound right.",
    "But I already did that, Willow.", "Are you sure?"])
    assert.deepEqual(signalsFor({ question: q, previousQuestion, last: null }), ["corrected"], q);
  assert.deepEqual(signalsFor({ question: "Are you sure?", previousQuestion, last: null, answered: false }), []);
  assert.deepEqual(signalsFor({ question: "It's actually pronounced Dun Morogh.", previousQuestion, last: null, sounds: true }),
    ["mispronounced"]);
  // A rephrase alone is normal talk; cut off and asked again, or asked again after a failure, is a miss.
  assert.ok(!queueWorthy(["rephrased"], null));
  assert.ok(queueWorthy(["interrupted", "rephrased"], null));
  assert.ok(queueWorthy(["failed", "repeated_after_fail"], null));
  assert.ok(!queueWorthy(["corrected"], "correction"), "the player's own words are queued as their own row");
  assert.equal(lastOf({ answer_id: "nope", ms: -3 }), null);
  assert.deepEqual(lastOf({ answer_id: "0123456789abcdef", ms: 1200.4, heard: "loud", failed: "yes", spoken: true }),
    { answer_id: "0123456789abcdef", ms: 1200, heard: null, failed: false, retried: false, spoken: true, speed: null });
});

test("\"no, I meant…\" and \"never mind\" are reports too, and a polite never mind isn't", () => {
  const before = "The boat to Auberdine leaves from Menethil Harbor.";
  assert.equal(feedbackKind("No, I meant the boat from Southshore", before), "misheard");
  assert.equal(feedbackKind("I said the inn, not the bank", before), "misheard");
  assert.equal(feedbackKind("that's not what I meant", before), "correction", "as before: her correction words");
  assert.equal(feedbackKind("never mind", before), "gave_up");
  assert.equal(feedbackKind("Nevermind, where's the inn?", before), "gave_up");
  assert.equal(feedbackKind("never mind, found it, thanks!", before), null);
  assert.equal(feedbackKind("I meant to ask about the inn", ""), null, "nothing answered yet");
});

test("note requests and reassurance do not report the previous answer as wrong (LOR-718)", async () => {
  const pairs = [
    ["Make a note to buy free action potions.", "You have 12 gold, 34 silver and 56 copper."],
    ["No, Willow, you're perfect just the way you are.", "Hold your talk key, speak, then let go."],
  ];
  const { ask, rate } = await linked();
  for (const [said, previous] of pairs) {
    assert.equal(feedbackKind(said, previous), null, said);
    assert.deepEqual(signalsFor({ question: said, previousQuestion: "How do I talk to you?",
      dispute: feedbackKind(said, previous) }), [], said);
    const result = await ask(said, {}, { question: "Previous question", answer: previous });
    assert.equal(result.feedback, undefined, said);
  }
  assert.equal(rows("answer_feedback").length, 0, "ordinary conversation adds no correction to the review queue");
  for (const said of ["That's wrong. The boat goes to Southshore.", "Make a note that your information is outdated.",
    "No, you're perfect just the way you are, but that's wrong. The boat goes to Southshore."]) {
    assert.equal(feedbackKind(said, pairs[0][1]), "correction", said);
  }
  const report = await rate({ question: "How much gold?", answer: pairs[0][1], reasons: ["wrong_fact"], source: "window" });
  assert.equal(report.body.ok, true);
  assert.equal(rows("answer_feedback", "kind = 'report'").length, 1, "manual Wrong answer reports still count");
});

test("topics by the question's words, and by how it was answered", () => {
  assert.equal(topicOf("Where do I turn in the Defias quest?"), "quest");
  assert.equal(topicOf("How do I get to Booty Bay?"), "route");
  assert.equal(topicOf("What's the fastest way to the Wetlands from where I am?"), "route");
  assert.equal(topicOf("Where is the closest graveyard?"), "place");
  assert.equal(topicOf("How do I get to 150 skinning?"), "profession");
  assert.equal(topicOf("Where can I get a flight to Booty Bay?"), "route");
  assert.equal(topicOf("Where is the Southshore boat?"), "place");
  assert.equal(topicOf("Is there any silver lining to their story?"), "lore");
  assert.equal(topicOf("Is this sword an upgrade?"), "item");
  assert.equal(topicOf("Where do I train herbalism?"), "profession");
  assert.equal(topicOf("Who was Arthas?"), "lore");
  assert.equal(topicOf("thanks!"), "chat");
  assert.equal(topicOf("can you change your voice", { lookups: ["help"] }), "willo");
  assert.equal(topicOf("hello", { operation: "character" }), "character");
  // As they come from the talk key (the live log, 10/18): her name and fillers first.
  assert.equal(topicOf("Hey Willow, what's the difference between uh ten attack power and five strength?"), "class");
  assert.equal(topicOf("Hey, Willow."), "chat");
  assert.equal(topicOf("Thanks, Willow. I appreciate it."), "chat");
  assert.equal(topicOf("What should I do now? Give me five steps."), "next");
  assert.equal(topicOf("Who do you think this guy is?"), "here");
  assert.equal(topicOf("Can you open your settings?"), "willo");
  assert.equal(topicOf("Tell me more about Durotar."), "lore");
  assert.equal(topicOf("Should I run to Orgrimmar or take the fly path?"), "place");
});

test("every answer carries its id; the next question tags it, and a strong signal is queued, only while kept", async () => {
  const hurin = await linked();
  const first = await hurin.ask("Where is Sentinel Hill?", { style: "spoken" });
  assert.match(first.answer_id, ANSWER_ID);
  assert.equal(rows("answer_log")[0].ref, first.answer_id);
  assert.equal(rows("answer_log")[0].topic, "place");
  // She was cut off, then asked the same thing again, typed, ten seconds on.
  const second = await hurin.ask("where's sentinel hill", { last: { answer_id: first.answer_id, ms: 10_000, heard: "interrupted",
    spoken: true } }, { player: "Where is Sentinel Hill?", willo: first.answer });
  assert.notEqual(second.answer_id, first.answer_id);
  const tagged = rows("answer_log", "ref = ?", first.answer_id)[0];
  assert.deepEqual(tagged.signals.split(",").sort(), ["interrupted", "rephrased", "typed_after_voice_fail"]);
  const [signal] = rows("answer_feedback", "kind = 'signal'");
  assert.equal(signal.answer_ref, first.answer_id);
  assert.match(signal.said, /cut her off mid-answer/i);
  assert.equal(signal.question, "Where is Sentinel Hill?");
  // With keep off, the app's facts are read for nothing and nothing is tagged or queued.
  env.DB.sqlite.exec("DELETE FROM answer_feedback");
  const third = await hurin.ask("where's sentinel hill", { keep: false, last: { answer_id: second.answer_id, ms: 5_000,
    heard: "interrupted" } }, { player: "where's sentinel hill", willo: second.answer });
  assert.equal(third.ok, true);
  assert.equal(rows("answer_log", "ref = ?", second.answer_id)[0].signals, null);
  assert.equal(rows("answer_feedback").length, 0);
});

test("a failed answer carries its id too, and asking again after it is a miss", async () => {
  const hurin = await linked();
  globalThis.fetch = async () => new Response("busy", { status: 503 });
  const res = await answer({ request: new Request(`${ORIGIN}/api/companion/answer`, { method: "POST", headers: {
    "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${hurin.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "PLAYER CONTEXT\nzone: Westfall\n\nQUESTION\nWhere is Sentinel Hill?", persona: "willo",
      keep: true }) }), env });
  const failed = await res.json();
  assert.equal(res.status, 502);
  assert.match(failed.answer_id, ANSWER_ID);
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: reply }] } }],
    usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40 } });
  await hurin.ask("Where is Sentinel Hill?", { last: { answer_id: failed.answer_id, ms: 30_000, failed: true } },
    { player: "Where is Sentinel Hill?", willo: "" });
  assert.deepEqual(rows("answer_log", "ref = ?", failed.answer_id)[0].signals.split(",").sort(), ["failed", "repeated_after_fail"]);
  assert.equal(rows("answer_feedback", "kind = 'signal'").length, 1);
});

test("👎 Not right with reasons lands in the queue, tags the answer, and thanks her way; 👍 is quiet", async () => {
  const hurin = await linked("Hurin");
  const a = await hurin.ask("Where is Sentinel Hill, Hurin?");
  const down = await hurin.rate({ answer_id: a.answer_id, question: "Where is Sentinel Hill, Hurin?", answer: a.answer,
    reasons: ["wrong_fact", "too_long", "made-up"], note: "It's north of the farms", source: "overgame", zone: "Westfall" });
  assert.equal(down.status, 200);
  assert.equal(down.body.line, THANKS);
  const [row] = rows("answer_feedback");
  assert.equal(row.kind, "report");
  assert.equal(row.reasons, "wrong_fact,too_long");
  assert.equal(row.source, "overgame");
  assert.equal(row.said, "It's north of the farms");
  assert.equal(row.question, "Where is Sentinel Hill, {player}?", "the character's name is out of what's kept");
  assert.equal(row.answer_ref, a.answer_id);
  assert.match(rows("answer_log", "ref = ?", a.answer_id)[0].signals, /reported/);
  // No note: the reasons in words. An older app with no id or reasons: a flag, as before.
  const b = await hurin.ask("Who leads the Defias?");
  await hurin.rate({ answer_id: b.answer_id, question: "Who leads the Defias?", answer: b.answer, reasons: ["not_my_question"],
    followup: true });
  assert.equal(rows("answer_feedback", "answer_ref = ?", b.answer_id)[0].said, "Didn't answer my question");
  assert.equal(rows("answer_feedback", "answer_ref = ?", b.answer_id)[0].followup, 1);
  const old = await hurin.rate({ question: "Q", answer: "An old app's wrong answer" });
  assert.equal(old.status, 200);
  assert.equal(rows("answer_feedback", "answer = ?", "An old app's wrong answer")[0].kind, "flag");
  // 👍: a tag on the kept answer, no row and nothing said back.
  const c = await hurin.ask("Where is the inn?");
  const up = await hurin.rate({ answer_id: c.answer_id, good: true });
  assert.deepEqual(up.body, { ok: true });
  assert.equal(rows("answer_log", "ref = ?", c.answer_id)[0].signals, "liked");
  assert.equal(rows("answer_feedback", "answer_ref = ?", c.answer_id).length, 0);
});

test("the accuracy loop reads the queue with each answer's log, triages, marks fixed, and she says she's learned it once", async () => {
  const hurin = await linked();
  const a = await hurin.ask("Where is the Southshore boat?");
  const rated = await hurin.rate({ answer_id: a.answer_id, question: "Where is the Southshore boat?", answer: a.answer,
    reasons: ["wrong_fact"], followup: true, source: "window" });
  assert.equal(rated.body.line, THANKS_FOLLOWUP);
  const { queue } = await admin("GET", null, "?queue=1");
  assert.equal(queue.rows.length, 1);
  const [row] = queue.rows;
  assert.deepEqual(row.reasons, ["wrong_fact"]);
  assert.equal(row.followup, true);
  assert.equal(row.log.outcome, "answered");
  assert.equal(row.players_same, 1);
  assert.equal((await admin("POST", { action: "queue-triage", ids: [row.id], class: "missing_fact", note: "no boat fact",
    gold_id: "player-0001" })).changed, 1);
  assert.equal((await admin("POST", { action: "queue-triage", ids: [row.id], class: "guess" })).ok, false);
  const triaged = (await admin("GET", null, "?queue=1&status=triaged")).queue.rows[0];
  assert.equal(triaged.class, "missing_fact");
  assert.equal(triaged.gold_id, "player-0001");
  // Not fixed yet: nothing to say.
  assert.deepEqual((await hurin.keeps("changes")).learned, []);
  assert.equal((await admin("POST", { action: "queue-fixed", ids: [row.id], how: "fact", ref: "fact-boat" })).changed, 1);
  const { learned } = await hurin.keeps("changes");
  assert.equal(learned.length, 1);
  assert.match(learned[0].line, /^Remember when you asked me “Where is the Southshore boat\?” I had it wrong then\. I've learned it now/);
  assert.doesNotMatch(learned[0].line, /fact|ticket|report|#/i, "in-world, never a form");
  assert.equal((await hurin.keeps("told", { ids: [learned[0].id] })).told, 1);
  assert.deepEqual((await hurin.keeps("changes")).learned, [], "said once");
  // Fixed without asking to hear: nothing said.
  const b = await hurin.ask("Who is Thrall?");
  await hurin.rate({ answer_id: b.answer_id, question: "Who is Thrall?", answer: b.answer, reasons: ["wrong_fact"] });
  const other = rows("answer_feedback", "answer_ref = ?", b.answer_id)[0];
  await admin("POST", { action: "queue-fixed", ids: [other.id], how: "lore" });
  assert.deepEqual((await hurin.keeps("changes")).learned, []);
  assert.equal(learnedLine("x".repeat(200)), "That answer you told me I got wrong? I've learned it now. Thank you for telling me!");
});

test("reports go after 90 days unless kept until fixed; a signal goes with the answer log at 14", async () => {
  const day = 864e5, start = new Date("2026-08-01T12:00:00Z");
  const at = d => new Date(start.getTime() + d * day);
  await logFeedback(env, "u1", { kind: "report", said: "plain", question: "Q1", answer: "A1" }, { now: start });
  await logFeedback(env, "u1", { kind: "report", said: "until fixed", question: "Q2", answer: "A2", followup: true }, { now: start });
  await logFeedback(env, "u1", { kind: "signal", said: "asked again", question: "Q3", answer: "A3" }, { now: start });
  const said = () => rows("answer_feedback").map(r => r.said).sort();
  await playerFeedback(env, "u1", { now: at(LOG_DAYS + 1) });
  assert.deepEqual(said(), ["plain", "until fixed"]);
  await playerFeedback(env, "u1", { now: at(KEEP_DAYS + 1) });
  assert.deepEqual(said(), ["until fixed"], "kept past 90 days while not fixed");
  const id = rows("answer_feedback")[0].id;
  env.DB.sqlite.prepare("UPDATE answer_feedback SET status = 'fixed', fixed_at = ? WHERE id = ?").run(at(KEEP_DAYS + 2).toISOString(), id);
  await playerFeedback(env, "u1", { now: at(KEEP_DAYS + 10) });
  assert.deepEqual(said(), ["until fixed"], "time for her to say so");
  await playerFeedback(env, "u1", { now: at(KEEP_DAYS + 20) });
  assert.deepEqual(said(), []);
  await logFeedback(env, "u1", { kind: "report", said: "never fixed", question: "Q4", answer: "A4", followup: true }, { now: start });
  await playerFeedback(env, "u1", { now: at(FOLLOWUP_DAYS + 1) });
  assert.deepEqual(said(), [], "a year at most");
});

test("rows from before are moved to the salted key, with names taken out; the account's erase takes both", async () => {
  const hurin = await linked("Hurin");
  const legacy = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`answer-feedback:${hurin.user.id}`)))]
    .map(b => b.toString(16).padStart(2, "0")).join("");
  env.DB.sqlite.prepare("INSERT INTO answer_feedback (kind, said, question, answer, user_hash, created) VALUES " +
    "('flag', 'Hurin says no', 'Where am I, Hurin?', 'Westfall, Hurin.', ?, ?)").run(legacy, new Date().toISOString());
  assert.equal((await playerFeedback(env, hurin.user.id)).rows.length, 1, "found before the move");
  const dry = await admin("POST", { action: "feedback-rehash", dry_run: true });
  assert.deepEqual([dry.rows_moved, dry.rows_rescrubbed, rows("answer_feedback")[0].user_hash], [1, 1, legacy]);
  const done = await admin("POST", { action: "feedback-rehash" });
  assert.equal(done.rows_moved, 1);
  const [row] = rows("answer_feedback");
  assert.notEqual(row.user_hash, legacy);
  assert.equal(row.question, "Where am I, {player}?");
  assert.equal(row.said, "{player} says no");
  assert.equal((await playerFeedback(env, hurin.user.id)).rows.length, 1, "found after the move");
  await deleteUser(env, hurin.user);
  assert.equal(rows("answer_feedback").length, 0);
});

test("Willo quality: report and frustration rates, what's asked most and what fails most", async () => {
  const hurin = await linked(), anduin = await linked();
  const a = await hurin.ask("Where is the Southshore boat?");
  await hurin.rate({ answer_id: a.answer_id, question: "Where is the Southshore boat?", answer: a.answer, reasons: ["wrong_fact"] });
  await hurin.ask("where's the boat from Southshore", { last: { answer_id: a.answer_id, ms: 8_000 } },
    { player: "Where is the Southshore boat?", willo: a.answer });
  await anduin.ask("Where is the Southshore boat?");
  const b = await anduin.ask("Who was Arthas?");
  await anduin.ask("thanks!", { last: { answer_id: b.answer_id, ms: 3_000 } }, { player: "Who was Arthas?", willo: b.answer });
  const q = await qualityReport(env);
  assert.equal(q.answers, 5);
  assert.equal(q.players, 2);
  assert.equal(q.reported, 1);
  assert.equal(q.report_rate, 0.2);
  assert.equal(q.missed, 1, "the rephrase");
  assert.equal(q.frustration_rate, 0.2);
  assert.equal(q.topics.asked_top[0].topic, "place");
  assert.equal(q.topics.asked_top[0].asked, 3);
  assert.equal(q.topics.failing_top[0].topic, "place");
  assert.equal(q.topics.failing_top[0].missed, 1, "one answer, reported and asked again");
  assert.deepEqual(q.questions.map(x => [x.question, x.players]), [["Where is the Southshore boat?", 2]]);
  assert.equal(q.reports.by_kind.report, 1);
  assert.equal(q.reports.reasons.wrong_fact, 1);
  assert.equal(q.reports.open.new, 1);
  const viaAdmin = await admin("GET", null, "?quality=1&days=14");
  assert.equal(viaAdmin.quality.days, 14);
  assert.equal(viaAdmin.quality.answers, 5);
});

// LOR-856 E1 (the Architect, 10/28): the rules' backup stays while it's rare, so the nightly review sees how often it
// answered.
test("Willo quality counts her answers the backup wrote while her brain is on Together", async () => {
  Object.assign(env, { TOGETHER_AI_API_KEY: "together-key", WILLO_ANSWER_HOST: "together:deepseek-ai/DeepSeek-V4.1-Flash" });
  resetBreaker();
  let down = false;
  globalThis.fetch = async url => String(url) === TOGETHER_URL
    ? (down ? new Response("busy", { status: 503 }) : new Response(new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`));
      c.close();
    } }), { headers: { "Content-Type": "text/event-stream" } }))
    : Response.json({ candidates: [{ content: { parts: [{ text: reply }] } }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40 } });
  try {
    const hurin = await linked();
    await hurin.ask("Where is Sentinel Hill?");
    down = true;
    await hurin.ask("Who was Arthas?");
    const q = await qualityReport(env);
    assert.deepEqual([q.answers, q.backup], [2, 1]);
    assert.equal(q.by_day.at(-1).backup, 1);
  } finally {
    delete env.TOGETHER_AI_API_KEY;
    delete env.WILLO_ANSWER_HOST;
    resetBreaker();
  }
});

test("Willo quality's speed: the talk key coming up to her first sound, from the app's times on the answer before", async () => {
  const hurin = await linked();
  const first = await hurin.ask("Where is Sentinel Hill?", { style: "spoken" });
  const second = await hurin.ask("Who was Arthas?", { style: "spoken", last: { answer_id: first.answer_id, ms: 9_000, spoken: true,
    speed: { up: 2400, heard: 250, prep: 400, answer: 900, audio: 850 } } }, { player: "Where is Sentinel Hill?", willo: first.answer });
  await hurin.ask("And the inn?", { style: "spoken", last: { answer_id: second.answer_id, ms: 7_000, spoken: true,
    speed: { up: 1800, heard: 200, prep: 300, answer: 700, audio: 600 } } }, { player: "Who was Arthas?", willo: second.answer });
  // Sent again (a retry), the answer before keeps the times it had.
  const third = await hurin.ask("And the inn?", { style: "spoken", last: { answer_id: second.answer_id, ms: 9_000, spoken: true,
    speed: { up: 9000, audio: 8000 } } }, { player: "Who was Arthas?", willo: second.answer });
  // A narration held this one 6 s: the bar counts her own 2.1 s, not the narration.
  await hurin.ask("Thanks.", { style: "spoken", last: { answer_id: third.answer_id, ms: 9_000, spoken: true,
    speed: { up: 8100, held: 6000, audio: 700 } } }, { player: "And the inn?", willo: third.answer });
  const { speed, by_day } = await qualityReport(env);
  assert.deepEqual([speed.timed, speed.p50, speed.p90], [3, 2100, 2400]);
  assert.deepEqual([speed.pieces.audio.p50, speed.pieces.audio.p90], [700, 850]);
  assert.equal(by_day.at(-1).speed.p90, 2400);
  // The site's own time on her spoken answers, from every app: before it asked the model, and the model's.
  assert.ok(speed.site.model.n >= 3 && speed.site.pre.n === speed.site.model.n, "the site's time before the model is logged");
  // Each spoken answer counts under the route it went by (LOR-856 E4: the picture's look race, or its model).
  assert.equal(Object.values(speed.site.by_route).reduce((n, r) => n + r.model.n, 0), speed.site.model.n);
});

test("\"never mind\" and \"no, I meant…\" are kept only while Help improve Willo's answers is on (vision check, 10/18)", async () => {
  const hurin = await linked();
  const before = { player: "Where is the Southshore boat?", willo: "It sails to Menethil." };
  await hurin.ask("never mind", { keep: false }, before);
  await hurin.ask("No, I meant the boat from Southshore", { keep: false }, before);
  await hurin.ask("I think that must be wrong.", { keep: false }, before);
  assert.equal(rows("answer_feedback").length, 0, "switch off in the app: none of them");
  await hurin.ask("That's wrong.", { keep: false }, before);
  assert.deepEqual(rows("answer_feedback").map(r => r.kind), ["correction"], "a correction is a report the player made");
  env.DB.sqlite.exec("DELETE FROM answer_feedback");
  await hurin.ask("never mind", {}, before);
  assert.deepEqual(rows("answer_feedback").map(r => r.kind), ["gave_up"], "switch on: kept");
  // Off on the page wins, whatever the app sends.
  env.DB.sqlite.exec("DELETE FROM answer_feedback");
  env.DB.sqlite.prepare("INSERT INTO keeps_settings (user_id, keep_answers, set_at) VALUES (?, 0, ?)").run(hurin.user.id,
    new Date().toISOString());
  await hurin.ask("No, I meant the boat from Southshore", {}, before);
  assert.equal(rows("answer_feedback").length, 0);
});

test("a queue row carries who was asking, what she said out loud and the turn before (accuracy loop, 10/18)", async () => {
  const hurin = await linked("Hurin");
  const first = await hurin.ask("Where is the Southshore boat?");
  const a = await answer({ request: new Request(`${ORIGIN}/api/companion/answer`, { method: "POST", headers: {
    "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${hurin.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "PLAYER CONTEXT\nzone: Hillsbrad Foothills\nrace: Dwarf\nclass: Paladin\nlevel: 24\n" +
      "faction: Alliance\ntarget: Hurin\n\nRECENT CONVERSATION (oldest first)\n" +
      JSON.stringify([{ player: "Where is the Southshore boat?", willo: first.answer }]) + "\n\nQUESTION\nAnd where does it go?",
      persona: "willo", keep: true, names: ["Hurin"] }) }), env }).then(r => r.json());
  await hurin.rate({ answer_id: a.answer_id, question: "And where does it go?", answer: a.answer, reasons: ["wrong_fact"] });
  const [row] = (await admin("GET", null, "?queue=1")).queue.rows;
  assert.deepEqual(row.log.ctx, { race: "Dwarf", class: "Paladin", level: "24", faction: "Alliance", target: "{player}" });
  assert.equal(row.log.spoken, false);
  assert.equal(row.log.say, null, "a typed answer is all written");
  assert.deepEqual(row.log.previous, { question: "Where is the Southshore boat?", answer: first.answer });
});
