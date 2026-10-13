// A quick look online for spoken answers no Forever fact covers, and findings shared between players (LOR-446).
// In-process on node:sqlite (helpers.mjs); Gemini is a stub. Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { ANSWER_MODEL, ANSWER_RESERVATION_MICRO, LOOKUP_RESERVATION_MICRO } from "../lib/companion-answers.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key" };
const originalFetch = globalThis.fetch;
let calls, reply;
const found = { candidates: [{ content: { parts: [{ text: "In WoW Forever warriors earn Berserker Stance with the level 30 quest The Islander." }] },
  groundingMetadata: { webSearchQueries: ["WoW Forever berserker stance"],
    groundingChunks: [{ web: { title: "Berserker Stance (Forever)", uri: "https://warcraft.wiki.gg/wiki/Berserker_Stance" } }] } }],
  usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 60 } };
const plain = { candidates: [{ content: { parts: [{ text: "Take The Islander from your trainer at level thirty." }] } }],
  usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 30 } };

beforeEach(async () => {
  await setup(env);
  for (const table of ["answer_spend", "research_cache"]) {
    try { env.DB.sqlite.exec(`DELETE FROM ${table}`); } catch { /* made on first use */ }
  }
  calls = [];
  reply = body => (body.tools ? found : plain);
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body, system: body.systemInstruction.parts[0].text, user: body.contents[0].parts.at(-1).text });
    const r = reply(body);
    return r instanceof Error ? Promise.reject(r) : Response.json(r);
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

let n = 0;
async function linked() {
  const sub = `searcher${++n}`;
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return (await claimToken(env, link.device_code)).token;
}
const ask = async (token, question, zone = "Ironforge", extra = {}) => (await answer({ env, request: new Request(
  "https://example.test/api/companion/answer", { method: "POST", headers: { "X-LF-Client": "companion/0.16.0",
    Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: `PLAYER CONTEXT\nzone: ${zone}\nrace: Human\nclass: Warrior\nlevel: 45\nfaction: Alliance\n\n` +
    `QUESTION\n${question}`, persona: "willo", style: "spoken", research: "auto", ...extra }) }) })).json();

test("a spoken practical question no fact covers is looked up first, and the next player gets the finding", async () => {
  const first = await ask(await linked(), "How do I get the Whirlwind Axe?");
  assert.equal(first.looked_up, "quick");
  assert.equal(calls.length, 2, "the look-up, then the answer");
  assert.match(calls[0].url, new RegExp(`${ANSWER_MODEL}:generateContent$`));
  assert.deepEqual(calls[0].body.tools, [{ googleSearch: {} }]);
  assert.match(calls[0].system, /You look things up/);
  assert.equal(calls[0].user, "Question: How do I get the Whirlwind Axe?\nAsked in: Ironforge, by a Human Warrior level 45 Alliance.");
  assert.equal(calls[1].body.tools, undefined);
  assert.match(calls[1].system, /EARLIER RESEARCH[^]*level 30 quest The Islander/);
  assert.equal(first.answer, "Take The Islander from your trainer at level thirty.");
  assert.equal(first.web_search.status, "searched");
  assert.equal(first.web_sources[0].title, "Berserker Stance (Forever)");
  // Another player, same question and place: no look-up, the finding with its sources.
  const second = await ask(await linked(), "how do i get the whirlwind axe");
  assert.equal(second.looked_up, "cached");
  assert.equal(calls.length, 3);
  assert.equal(calls[2].body.tools, undefined);
  assert.match(calls[2].system, /EARLIER RESEARCH[^]*Berserker Stance \(Forever\)/);
  assert.equal(second.web_sources[0].url, "https://warcraft.wiki.gg/wiki/Berserker_Stance");
  // Elsewhere it's a new question.
  assert.equal((await ask(await linked(), "How do I get the Whirlwind Axe?", "Orgrimmar")).looked_up, "quick");
});

test("no look-up when a Forever fact covers it, for lore and chat, or without research auto", async () => {
  const token = await linked();
  assert.equal((await ask(token, "Where does the boat from Southshore go?", "Hillsbrad Foothills")).looked_up, "no");
  assert.equal((await ask(token, "Tell me about Ironforge.")).looked_up, "no");
  assert.equal((await ask(token, "How do I get the Whirlwind Axe?", "Ironforge", { research: undefined })).looked_up, "no");
  assert.ok(calls.every(c => !c.body.tools));
});

test("a look-up that times out or finds nothing is answered without it, and the budget settles", async () => {
  reply = body => (body.tools ? Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }) : plain);
  const slow = await ask(await linked(), "How do I get the Whirlwind Axe?");
  assert.equal(slow.answer, "Take The Islander from your trainer at level thirty.");
  assert.equal(slow.looked_up, "no");
  assert.equal(slow.web_search.status, "not_needed");
  // A timed-out look-up's charges are unknown: its part stays reserved; the answer part settles on usage.
  const spend = () => env.DB.sqlite.prepare("SELECT reserved_micro FROM answer_spend").get().reserved_micro;
  assert.ok(spend() >= LOOKUP_RESERVATION_MICRO && spend() < LOOKUP_RESERVATION_MICRO + ANSWER_RESERVATION_MICRO);
  // No search evidence: nothing kept, answered plainly.
  reply = body => (body.tools ? plain : plain);
  const empty = await ask(await linked(), "Where can I buy Mild Spices?");
  assert.equal(empty.looked_up, "no");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM research_cache").get().n, 0);
});
