// Willo's answers kept 14 days for the nightly check (lib/answer-log.js): only while the player's switch is on, with
// their character names out and no account in it, and gone after 14 days. D1 is node:sqlite (helpers.mjs).

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup, deleteUser } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { logAnswer, sweepAnswerLog, answerLogReport, setupAnswerLog, rescrubAnswerLog, scrubNames, KEEP_DAYS }
  from "../lib/answer-log.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key" };
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  await setup(env);
  for (const table of ["devices", "device_links", "rate_limits", "answer_spend", "free_pool_days", "users"]) env.DB.sqlite.exec(`DELETE FROM ${table}`);
  await setupAnswerLog(env);
  env.DB.sqlite.exec("DELETE FROM answer_log");
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: "Well met, Húrin! Sentinel Hill is east." }] } }],
    usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40 } });
});
afterEach(() => { globalThis.fetch = originalFetch; });

async function linked() {
  const user = await findOrCreateUser(env, { email: "hurin@example.com", googleSub: "hurin", name: "Hurin" });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return { user, token: (await claimToken(env, link.device_code)).token };
}
const ask = (token, extra) => onRequest({ env, request: new Request("https://example.test/api/companion/answer", {
  method: "POST", headers: { "X-LF-Client": "companion/0.17.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "PLAYER CONTEXT\nzone: Westfall\n\nQUESTION\nI'm Húrin. Where is Sentinel Hill?", persona: "willo", ...extra }) }) });
const rows = () => env.DB.sqlite.prepare("SELECT * FROM answer_log").all();

test("an answer is kept only while the switch is on, without names or the account", async () => {
  const { user, token } = await linked();
  assert.equal((await ask(token, {})).status, 200, "an older companion sends no keep");
  assert.equal((await ask(token, { keep: false, names: ["Húrin"] })).status, 200);
  assert.equal(rows().length, 0, "switch off: nothing kept");
  assert.equal((await ask(token, { keep: true, names: ["Húrin", "Melkor"] })).status, 200);
  const [row] = rows();
  assert.equal(row.question, "I'm {player}. Where is Sentinel Hill?");
  assert.equal(row.answer, "Well met, {player}! Sentinel Hill is east.");
  assert.equal(row.zone, "Westfall");
  assert.equal(row.outcome, "answered");
  assert.equal(row.plan, "free", "the plan it was answered on, for pricing (lib/plan-usage.js planLabel)");
  assert.ok(row.model && Number.isInteger(row.total_ms));
  assert.doesNotMatch(JSON.stringify(row), new RegExp(`${user.id}|hurin@example|Húrin`, "i"));
  await deleteUser(env, user);
  assert.equal(rows().length, 0, "Delete my account takes them too");
});

test("answers older than 14 days are deleted, and never read back", async () => {
  const day = 864e5, start = new Date("2026-10-01T12:00:00Z");
  await logAnswer(env, "u1", { question: "Old?", answer: "Old.", outcome: "answered" }, { now: start });
  await logAnswer(env, "u1", { question: "Recent?", answer: "Yes.", outcome: "answered" },
    { now: new Date(start.getTime() + 3 * day) });
  const later = new Date(start.getTime() + (KEEP_DAYS + 1) * day);
  assert.deepEqual((await answerLogReport(env, { now: later })).rows.map(r => r.question), ["Recent?"]);
  assert.equal(rows().length, 1, "reading cleared the old one");
  await sweepAnswerLog(env, new Date(start.getTime() + (KEEP_DAYS + 4) * day));
  assert.equal(rows().length, 0, "the check-in sweep clears the rest");
  await logAnswer(env, "u1", { question: "Q?", outcome: "failed", error: "Gemini HTTP 503" }, { now: start });
  await logAnswer(env, "u1", { question: "New?", outcome: "answered" }, { now: later });
  assert.deepEqual(rows().map(r => r.question), ["New?"], "a new answer clears the old ones too");
});

// LOR-628: Willo answered in Czech and called the player "Húrine"; only the exact name was taken out.
test("inflected, possessive and accent-less forms of a name are taken out too", () => {
  const names = ["Húrin-Forever", "Lena"];
  assert.equal(scrubNames("Ahoj Húrine! Hurinovi patří meč. HURIN's sword, Hurins too.", names),
    "Ahoj {player}! {player} patří meč. {player}'s sword, {player} too.");
  assert.equal(scrubNames("Leno, Leny a Lenou; lens, length and Forever stay.", names),
    "{player}, {player} a {player}; lens, length and Forever stay.");
});

test("rows kept before the wider scrub are scrubbed again, by the account the site knows", async () => {
  const { user } = await linked();
  await env.DB.prepare("INSERT INTO profiles (user_id, handle, data, created, updated) VALUES (?, ?, ?, ?, ?)")
    .bind(user.id, "hurin", JSON.stringify({ name: "Húrin" }), "2026-10-17", "2026-10-17").run();
  const now = new Date();
  await logAnswer(env, user.id, { question: "Kde je Brill?", answer: "Húrine, Brill je na východ.", outcome: "answered" },
    { now });
  assert.equal(rows()[0].answer, "{player}, Brill je na východ.", "the site's own names scrub new rows");
  env.DB.sqlite.prepare("UPDATE answer_log SET answer = ?").run("Húrine, Brill je na východ.");   // as kept before
  const dry = await rescrubAnswerLog(env, { dryRun: true });
  assert.deepEqual([dry.rows, dry.players, dry.matched, dry.changed], [1, 1, 1, [rows()[0].id]]);
  assert.equal(rows()[0].answer, "Húrine, Brill je na východ.", "a dry run changes nothing");
  await rescrubAnswerLog(env);
  assert.equal(rows()[0].answer, "{player}, Brill je na východ.");
  assert.deepEqual((await rescrubAnswerLog(env)).changed, [], "nothing left to change");
});

test("an answer that says she can't see where they are is marked, so her screen look-up grows from real misses", async () => {
  // LOR-802 (the PM, 10/23): the app takes the screen for questions it recognizes; the ones it passed over, where she
  // then said she couldn't see or tell, are marked "unseen" among the kept answer's look-ups.
  const { token } = await linked();
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: "I can't see where you are from here. Where are you?" }] } }],
    usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40 } });
  assert.equal((await ask(token, { keep: true, prompt: "PLAYER CONTEXT\nrace: Human\n\nQUESTION\nIs this the right way to go?" })).status, 200);
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: "Sentinel Hill is east." }] } }],
    usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40 } });
  assert.equal((await ask(token, { keep: true })).status, 200);
  const [missed, fine] = rows();
  assert.match(missed.lookups || "", /\bunseen\b/);
  assert.doesNotMatch(fine.lookups || "", /\bunseen\b/);
});
