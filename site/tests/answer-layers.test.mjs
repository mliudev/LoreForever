// Speak short, show full (LOR-673): a spoken answer an app takes in two layers (layers: 2) is her spoken words, at most
// SAY_MAX_CHARS letters ending on a sentence, and the written answer with every detail. The spoken words are streamed
// out first (NDJSON) as soon as Gemini has written them, so she starts talking as fast as before; everything else
// answers as it did. Gemini is mocked through fetch, streamGenerateContent as server-sent events; D1 is node:sqlite.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { SAY_MAX_CHARS, REST_LINES, splitLayers, sayOf, spokenNumbers } from "../lib/companion-answers.js";
import { groundedWritten, inWorld } from "../lib/willo-guards.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key" };
const originalFetch = globalThis.fetch;
let calls, stream, release;

const SAID = "Thrall leads the Horde from Orgrimmar. I've written the rest out for you.";
// What she says of it: her line about the rest is one of REST_LINES, the same for the same words.
const SAYS = splitLayers(`${SAID}\n~~~\nmore`).say;
const WRITTEN = "Thrall leads the Horde from Orgrimmar, in Durotar.\n1. Take the zeppelin from Tirisfal Glades.\n" +
  "2. Walk west through the gates to the Valley of Wisdom.";
const sse = chunk => `data: ${JSON.stringify(chunk)}\r\n\r\n`;
const part = text => ({ candidates: [{ content: { parts: [{ text }] } }] });

beforeEach(async () => {
  await setup(env);
  for (const table of ["devices", "device_links", "rate_limits", "answer_spend", "users"]) env.DB.sqlite.exec(`DELETE FROM ${table}`);
  calls = [];
  // The rest of the stream waits for release(), so a test can see her words arrive before it.
  let open;
  const gate = new Promise(r => { open = r; });
  release = open;
  stream = [part(`${SAID}\n`), part("~~~\n"), part(WRITTEN),
    { candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 90 } }];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), body });
    if (!String(url).includes(":streamGenerateContent")) {
      return Response.json({ candidates: [{ content: { parts: [{ text: `${SAID}\n~~~\n${WRITTEN}` }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 90 } });
    }
    const chunks = stream.map(sse);
    return new Response(new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(chunks[0]));
        controller.enqueue(enc.encode(chunks[1]));
        await gate;
        for (const c of chunks.slice(2)) controller.enqueue(enc.encode(c));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream" } });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

async function linked() {
  const user = await findOrCreateUser(env, { email: "layers@example.com", googleSub: "layers", name: "layers" });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return (await claimToken(env, link.device_code)).token;
}
const ask = (token, fields) => onRequest({ env, request: new Request("https://example.test/api/companion/answer", {
  method: "POST", headers: { "X-LF-Client": "companion/0.1.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "PLAYER CONTEXT\nzone: Tirisfal Glades\n\nSOURCES\nThrall holds court in the Valley of Wisdom " +
    "in Orgrimmar, in Durotar. A zeppelin flies from Tirisfal Glades to Durotar.\n\nQUESTION\nHow do I get to Thrall?", persona: "willo",
    style: "spoken", ...fields }) }) });
// The NDJSON's lines as they come: the first one is read before the rest of the answer exists.
async function lines(res) {
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buf = "";
  return {
    async next() {
      while (!buf.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) return null;
        buf += decoder.decode(value, { stream: true });
      }
      const at = buf.indexOf("\n");
      const one = buf.slice(0, at);
      buf = buf.slice(at + 1);
      return JSON.parse(one);
    },
  };
}

test("her spoken words go out first, before the written answer is done, and the answer follows as before", async () => {
  const token = await linked();
  const res = await ask(token, { layers: 2 });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/x-ndjson");
  const read = await lines(res);
  assert.deepEqual(await read.next(), { say: SAYS }, "her words while Gemini is still writing the rest");
  release();
  const answer = await read.next();
  assert.equal(answer.ok, true);
  assert.equal(answer.answer, WRITTEN, "the written answer in full, without her spoken words or the mark");
  assert.equal(answer.say, SAYS);
  assert.equal(await read.next(), null);
  assert.match(calls[0].url, /:streamGenerateContent\?alt=sse$/);
  const system = calls[0].body.systemInstruction.parts[0].text;
  assert.match(system, /Reply in two parts, in this order\. First Willo's spoken words/);
  assert.match(system, new RegExp(`at most ${SAY_MAX_CHARS} letters`));
  assert.equal(calls[0].body.generationConfig.maxOutputTokens, 512, "room for both: a typed answer's");
});

test("without layers, or typed, or looked up, an answer is one JSON as before", async () => {
  const token = await linked();
  release();
  for (const fields of [{}, { style: undefined, layers: 2 }, { layers: 1 }]) {
    const res = await ask(token, fields);
    assert.equal(res.headers.get("Content-Type")?.startsWith("application/json"), true);
    const body = await res.json();
    assert.equal(body.say, undefined);
  }
  assert.ok(calls.every(c => c.url.endsWith(":generateContent")));
  assert.doesNotMatch(calls[0].body.systemInstruction.parts[0].text, /Reply in two parts/);
  assert.equal(calls[0].body.generationConfig.maxOutputTokens, 300, "a spoken answer alone keeps its room");
});

test("a reply with no mark is said from its start, cut at a sentence, and written whole", async () => {
  const token = await linked();
  const long = `${"Thrall leads the Horde from Orgrimmar in Durotar. ".repeat(12)}`.trim();
  stream = [part(long), part(""), { candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 90 } }];
  release();
  const res = await ask(token, { layers: 2 });
  assert.equal(res.headers.get("Content-Type")?.startsWith("application/json"), true, "nothing to say early");
  const body = await res.json();
  assert.equal(body.answer, long);
  const rest = REST_LINES.find(l => body.say.endsWith(` ${l}`));
  const words = body.say.slice(0, body.say.length - rest.length - 1);
  assert.ok(body.say.length <= SAY_MAX_CHARS && words.endsWith(".") && long.startsWith(words), body.say);
  assert.equal(body.rest, undefined, "her line about the rest is on her words when they go with the answer");
});

test("her spoken words get the answer's own last checks", async () => {
  const token = await linked();
  stream[0] = part("Our people built Orgrimmar. Find Thrall at 52, 31 on your map.\n");
  release();
  const res = await ask(token, { layers: 2 });
  const read = await lines(res);
  const { say } = await read.next();
  assert.match(say, /^Your people built Orgrimmar\./, "her people are the player's, never ours");
  assert.doesNotMatch(say, /52, 31/, "no coordinates nothing supplied gives");
});

test("the two layers split on the mark; her words are cut at a sentence within SAY_MAX_CHARS", () => {
  assert.deepEqual(splitLayers(`${SAID}\n~~~\n${WRITTEN}`), { say: SAYS, text: WRITTEN });
  assert.ok(SAYS.startsWith("Thrall leads the Horde from Orgrimmar. ") && REST_LINES.some(l => SAYS.endsWith(l)));
  // The blind check (10/18): 58 of 65 said the same line. Different words get different lines.
  const lines = new Set(["Go east.", "Go west.", "Ask the guard.", "Take the boat.", "See the smith.", "Fly north."]
    .map(w => splitLayers(`${w} I have written the rest out for you.\n~~~\nmore`).say.slice(w.length + 1)));
  assert.ok(lines.size >= 3 && [...lines].every(l => REST_LINES.includes(l)), [...lines].join(" | "));
  assert.deepEqual(splitLayers(WRITTEN), { text: WRITTEN, say: "Thrall leads the Horde from Orgrimmar, in Durotar. Take " +
    "the zeppelin from Tirisfal Glades. Walk west through the gates to the Valley of Wisdom." }, "no mark: its start, unlisted");
  assert.deepEqual(splitLayers(`Go [east](https://example.com).\n ~~~ \nSee https://example.com now.`),
    { say: "Go east.", text: "See  now." });
  // Glued to her last sentence (3.6 Flash, the vision check 10/19): she never says the mark or what comes after it.
  assert.deepEqual(splitLayers("You're in the Trade District.~~~That is Hurin, by the bank."),
    { say: "You're in the Trade District.", text: "That is Hurin, by the bank." });
  const words = "Thrall leads the Horde. ".repeat(30);
  const cut = sayOf(words);
  assert.ok(cut.length <= SAY_MAX_CHARS && cut.endsWith("Horde."));
  assert.equal(sayOf("Short."), "Short.");
  // Her spoken words never have digits (the blind check, 10/18: "level 18", "34, 51"); the written answer keeps them.
  assert.equal(spokenNumbers("Shadowfang Keep, from level 18. Head to 34, 51 on your map."),
    "Shadowfang Keep, from level eighteen. Head to thirty-four, fifty-one on your map.");
  assert.equal(spokenNumbers("Skill 120, patch 1.12"), "Skill one hundred twenty, patch 1.12");
  assert.deepEqual(splitLayers("Go to level 18.\n~~~\nLevel 18, at 34, 51."), { say: "Go to level eighteen.", text: "Level 18, at 34, 51." });
});

test("when the written answer says more than her early words, the answer carries her line about it to say after", async () => {
  const token = await linked();
  stream[0] = part("Thrall leads the Horde from Orgrimmar.\n");
  const res = await ask(token, { layers: 2 });
  const read = await lines(res);
  assert.deepEqual(await read.next(), { say: "Thrall leads the Horde from Orgrimmar." }, "her words, as written");
  release();
  const answer = await read.next();
  assert.ok(REST_LINES.includes(answer.rest), answer.rest);
  assert.equal(answer.say, "Thrall leads the Horde from Orgrimmar.");
});

test("the written answer adds only names and numbers what she was given holds", async () => {
  // The accuracy re-score (10/18): wrong claims rose 7.6 -> 11.4% with the longer written answer, which filled gaps
  // from memory: item drops, quest steps, a graveyard in Ironforge.
  const supplied = "FOREVER FACTS\nRandal Hunter at the Eastvale Logging Camp teaches riding: 100 gold, from level 40.";
  const say = "Randal Hunter teaches riding at the Eastvale Logging Camp.";
  const written = "Randal Hunter teaches riding at the Eastvale Logging Camp. Riding costs 100 gold from level 40. If you " +
    "are Honored with Stormwind, it costs 10 percent less.\n1. Head east along the road.\n2. Ask Maria Lumere in " +
    "Goldshire first.\n3. Bring 100 gold.";
  assert.equal(groundedWritten(written, say, supplied), say, "the list lost a step: her words");
  assert.equal(groundedWritten("Riding costs 100 gold.\n1. Head east along the road.\n2. Bring 100 gold.", say, supplied),
    "Riding costs 100 gold.\n1. Head east along the road.\n2. Bring 100 gold.", "a list all backed stays");
  assert.equal(groundedWritten("The Honored discount is 10 percent in Stormwind.", say, supplied), say,
    "nothing backed beyond her words: her words");

  // Through the answer: the stream's written answer loses what nothing supplied gives.
  const token = await linked();
  stream[2] = part(`${WRITTEN}\n3. Ask Grommash Hellscream for a writ of passage.`);
  release();
  const res = await ask(token, { layers: 2 });
  const read = await lines(res);
  await read.next();
  const answer = await read.next();
  assert.equal(answer.answer, answer.say, "a made-up step takes the written answer back to her words");
});

test("a list that loses an item loses all of it and its lead-in; the game's name never ends a sentence about the world", () => {
  // The blind check (10/18): mike-125 kept "you must collect the following items: 1. Eight Liferoot", as if that were
  // all; "You can play an undead paladin in WoW Forever." in 2 of 116 written answers.
  const supplied = "Liferoot: 8 needed. Stranglethorn Vale.";
  assert.equal(groundedWritten("To forge it you need the charms.\nYou must collect the following items:\n1. Eight Liferoot\n" +
    "2. Thirty Iron Ore from Grimtotem elites\nThen go to the summoning site.", "To forge it you need the charms.", supplied),
    "To forge it you need the charms.", "a pruned list: her words");
  // The re-check (10/18): with a blank line before the list, its lead-in stayed with nothing after it.
  assert.equal(groundedWritten("To summon Cyclonian, collect the following items:\n\n1. Thirty Iron Bars.\n2. Forty Worn Dragon " +
    "Scales.\n\nOnce you have these, summon him.", "To summon Cyclonian you need a few things.", "SOURCES Cyclonian."),
    "To summon Cyclonian you need a few things.");
  assert.equal(groundedWritten("Menethil Harbor has quests:", "Ask Tarrel Rockweaver and Flagongut in Menethil Harbor.",
    "Menethil Harbor"), "Ask Tarrel Rockweaver and Flagongut in Menethil Harbor.", "never less than her words");
  assert.equal(inWorld("You can play an undead paladin in WoW Forever. There are no training dummies in World of Warcraft: Forever!"),
    "You can play an undead paladin. There are no training dummies!");
  assert.equal(inWorld("WoW Forever's launcher keeps it up to date."), "WoW Forever's launcher keeps it up to date.",
    "a question about the game itself keeps its name");
});
