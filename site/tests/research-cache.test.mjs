// A quick look online for spoken answers no Forever fact covers, and findings shared between players (LOR-446).
// In-process on node:sqlite (helpers.mjs); Gemini is a stub. Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { ANSWER_MODEL, ANSWER_RESERVATION_MICRO, LOOKUP_RESERVATION_MICRO } from "../lib/companion-answers.js";
import { keepFinding, wantsSearch, realWorld } from "../lib/research-cache.js";
import { helpBlock } from "../lib/willo-help.js";
import { d1 } from "./helpers.mjs";

// RESEARCH_SHARED: these tests cover sharing a finding with the next player, which stays off in production until a search
// provider's terms allow it (lib/research-cache.js sharedFindings); the last test checks it's off by default.
const env = { DB: d1(), GEMINI_API_KEY: "test-key", RESEARCH_SHARED: "1" };
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

test("only practical or current questions and corrections no fact covers look online; where am I and lore never do", () => {
  for (const q of ["Where am I?", "Willow, tell me, are you able to see your sky and know where you are?",
    "Willow. Who am I looking at?", "What's this place?", "Hi Willo, what do you see?", "Tell me about Ironforge.",
    "Tell me about the history of Ironforge.", "Where is King Magni?", "I want to learn about the orcs."])
    assert.equal(wantsSearch(q, null, []), false, q);
  for (const q of ["Where can I buy Simple Flour in Goldshire?", "Where am I able to buy Mild Spices?",
    "Where is the cooking trainer in the Crossroads?", "How do I get Berserker Stance?", "What is the best way to farm cloth?",
    "where do I go to learn mining", "What changed in the latest patch?"])
    assert.equal(wantsSearch(q, null, []), true, q);
  assert.equal(wantsSearch("I'm pretty sure that's Dalaran.", "correction", []), true);
  assert.equal(wantsSearch("Where can I buy Simple Flour in Goldshire?", null, [{ asked: true }]), false, "a fact covers it");
});

test("the player's own world looks online, typed too, and Willo's own help never does (LOR-545)", async () => {
  for (const q of ["What's the best graphics card for WoW?", "Can you recommend a good laptop for playing WoW?",
    "My FPS drops a lot in Stormwind, what can I do?", "What's a good UI addon?", "Are the servers down?",
    "What's the weather like in Seattle today?"])
    assert.equal(realWorld(q), true, q);
  for (const q of ["Where can I get a ram mount?", "Any news from the front?", "What's the weather like today?",
    "Tell me about Ironforge.", "How do I change your voice?"])
    assert.equal(realWorld(q), false, q);
  assert.equal(realWorld("Seattle", "What's the weather like today?"), true, "the town, after the weather");
  assert.equal(realWorld("thanks!", "What's the best graphics card for WoW?"), false);
  const token = await linked();
  // Typed (no research "auto"): the look-up is its own, about the question alone, never where or who asked.
  const typed = await ask(token, "What's the best graphics card for WoW?", "Stormwind City", { style: undefined, research: undefined });
  assert.equal(typed.looked_up, "quick");
  assert.match(calls[0].system, /Today is \d{4}-\d{2}-\d{2}\. Always run one or two short Google searches first for current information/);
  assert.equal(calls[0].user, "Question: What's the best graphics card for WoW?");
  // A question about Willo herself gets her help, and no look-up even asked out loud.
  calls = [];
  const self = await ask(token, "How do I change the talk key?");
  assert.equal(self.looked_up, "no");
  assert.equal(calls.length, 1);
  assert.match(calls[0].system, /WILLO HELP[^]*Talk key: in your window, Settings › Willo › Talk with Willo/);
});

test("Willo's help answers questions about her and stays out of lore and the player's own world", () => {
  for (const [q, topic] of [["How do I change your voice?", /Your voice:/], ["Why can't you see who I'm targeting?", /Seeing the game:/],
    ["What does Legend add?", /Your plans[^]*Legend: /], ["How do I change the talk key?", /Talk key:/],
    ["What do you keep about me?", /What you keep:/]])
    assert.match(helpBlock(q), topic, q);
  for (const q of ["Tell me about King Magni.", "What does the Legend of Stalvan give?", "Who is Gryan Stoutmantle?",
    "What city is that across the bay?", "What's the best graphics card for WoW?", "What do you see?"])
    assert.equal(helpBlock(q), "", q);
  assert.equal(helpBlock("What does Legend add?", { plans: false }), "", "no plans for sale, no plans topic");
  // The "Willo and the game" card is only in the Willo builds that have it.
  assert.doesNotMatch(helpBlock("No sound from you", { client: "companion/0.18.2" }), /and the game" card/);
  assert.match(helpBlock("No sound from you", { client: "companion/0.19.0" }), /and the game" card/);
  assert.match(helpBlock("What does Legend add?", { usage: { remaining: 488, period: "month", resetsAt: "2026-11-13T00:00:00Z" } }),
    /488 left this month, more on November 13/);
});

test("Willo's own state goes to her help for a question about her, and out of every other answer (LOR-546)", async () => {
  const token = await linked();
  const prompt = q => "PLAYER CONTEXT\nzone: Westfall\nrace: Human\nclass: Warrior\nlevel: 15\nfaction: Alliance\n\n" +
    "WILLO STATE\nlive: bad, Live game info is unticked in the add-on\ntalking out loud: on\n\nSOURCES\n\n" + `QUESTION\n${q}`;
  const self = await ask(token, "", "", { prompt: prompt("Why can't you see who I'm targeting?"), style: undefined });
  assert.deepEqual(self.lookups, ["help", "state"]);
  assert.match(calls[0].system, /RIGHT NOW in their Willo[^]*live: bad, Live game info is unticked in the add-on/);
  assert.doesNotMatch(calls[0].user, /WILLO STATE/);
  calls = [];
  await ask(token, "", "", { prompt: prompt("Who are the Defias Brotherhood?"), style: undefined });
  assert.doesNotMatch(calls[0].system, /RIGHT NOW in their|WILLO HELP \(/);
  assert.doesNotMatch(calls[0].user, /WILLO STATE|unticked/);
});

test("the Great Forge 'where you are' question (10/14) gets no look-up and no earlier finding; flour in Goldshire does", async () => {
  const question = "Willow, tell me, are you able to see your sky and know where you are?";
  // What that answer's search kept for the next player.
  await keepFinding(env, { question, zone: "Ironforge", faction: "Alliance" }, "WoW Forever's Great Forge is in Ironforge.",
    [{ title: "method.gg", url: "https://www.method.gg/ironforge" }]);
  const here = await ask(await linked(), question);
  assert.equal(here.looked_up, "no");
  assert.equal(here.web_search.status, "not_needed");
  assert.equal(here.web_search.suggestions_html, "", "no Google chip");
  assert.deepEqual(here.web_sources, []);
  assert.ok(calls.every(c => !c.body.tools?.some(t => t.googleSearch)), "no search");
  const flour = await ask(await linked(), "Where can I buy Simple Flour in Goldshire?", "Elwynn Forest");
  assert.equal(flour.looked_up, "quick");
  assert.equal(flour.web_search.status, "searched");
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

test("by default a Google finding is never kept or served to another player (grounding terms)", async () => {
  const { cachedFinding, keepFinding } = await import("../lib/research-cache.js");
  const off = { DB: env.DB };
  const parts = { question: "Where can I buy Simple Flour?", zone: "Goldshire", faction: "Alliance" };
  assert.equal(await keepFinding(off, parts, "From the innkeeper.", [{ title: "Simple Flour", url: "https://example.com" }]), false);
  assert.equal(await cachedFinding(off, parts), null);
});
