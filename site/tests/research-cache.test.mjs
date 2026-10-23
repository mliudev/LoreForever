// A quick look online for spoken answers no Forever fact covers, and findings shared between players (LOR-446).
// In-process on node:sqlite (helpers.mjs); Gemini is a stub. Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { LITE_MODEL, ANSWER_RESERVATION_MICRO, LOOKUP_RESERVATION_MICRO } from "../lib/companion-answers.js";
import { keepFinding, wantsSearch, realWorld, searchesBefore, ofThisEra } from "../lib/research-cache.js";
import { helpBlock, helpQuestion } from "../lib/willo-help.js";
import { d1 } from "./helpers.mjs";
// The facts are checked for the names and numbers they carry, not the sentence around them.
const says = (text, ...facts) => { for (const f of facts) assert.ok(String(text).toLowerCase().includes(String(f).toLowerCase()),
  `${JSON.stringify(text)} should say ${f}`); };

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
  for (const table of ["answer_spend", "free_pool_days", "research_cache"]) {
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
  const first = await ask(await linked(), "Where can I buy Simple Flour?");
  assert.equal(first.looked_up, "quick");
  assert.equal(calls.length, 2, "the look-up, then the answer");
  assert.match(calls[0].url, new RegExp(`${LITE_MODEL}:generateContent$`));
  assert.deepEqual(calls[0].body.tools, [{ googleSearch: {} }]);
  assert.match(calls[0].system, /You look things up/);
  assert.equal(calls[0].user, "Question: Where can I buy Simple Flour?\nAsked in: Ironforge, by a Human Warrior level 45 Alliance.");
  assert.equal(calls[1].body.tools, undefined);
  assert.match(calls[1].system, /EARLIER RESEARCH[^]*level 30 quest The Islander/);
  assert.equal(first.answer, "Take The Islander from your trainer at level thirty.");
  assert.equal(first.web_search.status, "searched");
  assert.equal(first.web_sources[0].title, "Berserker Stance (Forever)");
  // Another player, same question and place: no look-up, the finding with its sources.
  const second = await ask(await linked(), "where can i buy simple flour");
  assert.equal(second.looked_up, "cached");
  assert.equal(calls.length, 3);
  assert.equal(calls[2].body.tools, undefined);
  assert.match(calls[2].system, /EARLIER RESEARCH[^]*Berserker Stance \(Forever\)/);
  assert.equal(second.web_sources[0].url, "https://warcraft.wiki.gg/wiki/Berserker_Stance");
  // Elsewhere it's a new question.
  assert.equal((await ask(await linked(), "Where can I buy Simple Flour?", "Orgrimmar")).looked_up, "quick");
});

test("no look-up when a Forever fact covers it, for lore and chat, or without research auto", async () => {
  const token = await linked();
  assert.equal((await ask(token, "Where does the boat from Southshore go?", "Hillsbrad Foothills")).looked_up, "no");
  assert.equal((await ask(token, "Tell me about Ironforge.")).looked_up, "no");
  assert.equal((await ask(token, "Where can I buy Simple Flour?", "Ironforge", { research: undefined })).looked_up, "no");
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
  // Mike's stream, 10/15 (LOR-593): an item's proc chance, a doubt and "search it" always look; a bare request or doubt
  // looks up what was asked before.
  assert.equal(wantsSearch("Hey Willow, what's the proc chance for Shoney's disarm?", null, []), true);
  for (const q of ["Are you sure?", "Hey Willow, can you search on the interwebs?"])
    assert.equal(wantsSearch(q, null, [{ asked: true }]), true, q);        // even when a fact seems to cover it
  // The 10/18 log (LOR-652): "...just to make sure?" was looked up as itself, and answered "I cannot search the web".
  assert.deepEqual(["Hey Willow, can you search on the interwebs?", "Are you sure?", "Search for Shoni's Disarming Tool",
    "Can you do a search online just to make sure?"].map(searchesBefore), [true, true, false, true]);
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
  assert.match(calls[0].system, /\b\d{4}-\d{2}-\d{2}\b/, "today's date");
  assert.match(calls[0].system, /Google search/i);
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
    ["What do you keep about me?", /What you keep:/],
    // LOR-623: turning her off got the add-on's folder to delete; her window's character gate got "no need to pick".
    ["How do I turn you off?", /never hides or removes you[^]*tray icon › Quit/],
    ["I don't see the option to pick a character but it says I have to pick a character", /Choose a character with a saved game account first" means/],
    // The 10/18 answer log: a guess about what she sees, and "close other programs" for her own slow answers.
    ["Can you see the quiz I'm doing right now?", /Seeing the game:/],
    ["You respond very slowly. Is that something we can improve?", /How fast you answer:[^]*doesn't depend on their computer/]])
    assert.match(helpBlock(q), topic, q);
  // A short follow-up to a question about her gets the same help, by the question or by her answer before it.
  assert.match(helpBlock(helpQuestion("it isnt there", "How do I turn you off?")), /tray icon › Quit/);
  assert.match(helpBlock(helpQuestion("what now", "it isnt there", "Right-click your tray icon › Quit.")), /tray icon › Quit/);
  assert.equal(helpBlock(helpQuestion("and the inn?", "Where is Goldshire?", "South of Northshire.")), "");
  for (const q of ["Tell me about King Magni.", "What does the Legend of Stalvan give?", "Who is Gryan Stoutmantle?",
    "What city is that across the bay?", "What's the best graphics card for WoW?", "What do you see?",
    "Do you know why I lag in Stormwind?"])
    assert.equal(helpBlock(q), "", q);
  assert.equal(helpBlock("What does Legend add?", { plans: false }), "", "no plans for sale, no plans topic");
  // The "Willo and the game" card is only in the Willo builds that have it.
  assert.doesNotMatch(helpBlock("No sound from you", { client: "companion/0.18.2" }), /and the game" card/);
  assert.match(helpBlock("No sound from you", { client: "companion/0.19.0" }), /and the game" card/);
  // The Voices of Azeroth only for a Willo whose picker has them (LOR-609); her own five for every other.
  assert.doesNotMatch(helpBlock("How do I change your voice?", { client: "companion/0.20.0" }), /Azeroth/);
  assert.match(helpBlock("How do I change your voice?", { client: "companion/0.20.0" }), /one of five voices there/);
  assert.match(helpBlock("How do I change your voice?", { client: "companion/0.21.0" }),
    /your own ten, a woman's and a man's voice of each kind \(Sprite[^]*Puck[^]*Kestrel[^]*"Voices of Azeroth"[^]*dwarf, Forsaken[^]*keep their own/);
  assert.match(helpBlock("What does Champion add?", { client: "companion/0.21.0" }), /her own 10, women's and men's, or one of 22 voices of Azeroth's peoples/);
  assert.doesNotMatch(helpBlock("How do I change your voice?", { client: "companion/0.20.0" }), /Puck|Kestrel/);
  assert.match(helpBlock("What does Champion add?", { client: "companion/0.20.0" }), /Pick Willo's voice from 5/);
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
  const slow = await ask(await linked(), "Where can I buy Simple Flour?");
  assert.equal(slow.answer, "Take The Islander from your trainer at level thirty.");
  assert.equal(slow.looked_up, "empty");                // it looked and found nothing in time
  assert.equal(slow.web_search.status, "not_needed");
  // A timed-out look-up's charges are unknown: its part stays reserved; the answer part settles on usage.
  const spend = () => env.DB.sqlite.prepare("SELECT reserved_micro FROM answer_spend").get().reserved_micro;
  assert.ok(spend() >= LOOKUP_RESERVATION_MICRO && spend() < LOOKUP_RESERVATION_MICRO + ANSWER_RESERVATION_MICRO);
  // No search evidence: nothing kept, answered plainly.
  reply = body => (body.tools ? plain : plain);
  const empty = await ask(await linked(), "Where can I buy Simple Flour?");
  assert.equal(empty.looked_up, "empty");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM research_cache").get().n, 0);
});

test("by default a Google finding is never kept or served to another player (grounding terms)", async () => {
  const { cachedFinding, keepFinding } = await import("../lib/research-cache.js");
  const off = { DB: env.DB };
  const parts = { question: "Where can I buy Simple Flour?", zone: "Goldshire", faction: "Alliance" };
  assert.equal(await keepFinding(off, parts, "From the innkeeper.", [{ title: "Simple Flour", url: "https://example.com" }]), false);
  assert.equal(await cachedFinding(off, parts), null);
});

test("a look-up finding loses what only later versions of the game have, and keeps this era's lore (cause grid, 10/18)", () => {
  // The finding behind "Critical Strike and Haste" for a beast mastery hunter: the later game's stats go, Agility stays.
  assert.equal(ofThisEra("Beast Mastery hunters want Agility first. Prioritize Haste and Mastery after that. " +
    "Critical strike rating is also strong."), "Beast Mastery hunters want Agility first.");
  // Words that are also this era's: the Scarlet Crusade's monks, an inscription on a stone, the Cataclysm as a story.
  const lore = "Scarlet monks guard the Library wing. An inscription on the stone names Uther.";
  assert.equal(ofThisEra(lore), lore);
});

test("something coming out of the world is the game's, a release date is the player's own", async () => {
  // The gold set, 10/18: "Why is there lava coming out of the roof?" was looked up online and told it was a glitch.
  const { realWorld } = await import("../lib/research-cache.js");
  assert.equal(realWorld("Why is there lava coming out of the roof?"), false);
  assert.equal(realWorld("What is that smoke coming out of the chimney?"), false);
  assert.equal(realWorld("When does the next phase come out?"), true);
  assert.equal(realWorld("Is the new raid coming out soon?"), true);
});
