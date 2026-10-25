import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { onRequest } from "../functions/api/companion/answer.js";
import { setup, findOrCreateUser } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { writeAnswer } from "../lib/companion-answers.js";
import { promptParts, withoutLive } from "../lib/forever-knowledge.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key" };
const originalFetch = globalThis.fetch;
let systems;
const NOW = new Date("2026-10-21T12:00:00Z");

beforeEach(async () => {
  await setup(env);
  for (const table of ["devices", "device_links", "rate_limits", "answer_spend", "free_pool_days", "story_spend", "users", "excluded_accounts"]) env.DB.sqlite.exec(`DELETE FROM ${table}`);
  try { env.DB.sqlite.exec("DELETE FROM research_cache"); } catch { /* made on first use */ }
  systems = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    // Each Flash-Lite request opens with its own tag (lib/companion-answers.js generate, LOR-761); compare the rest.
    systems.push(body.systemInstruction.parts[0].text.replace(/^\([0-9a-f]{8}\)\n/, ""));
    const text = body.generationConfig.responseMimeType ? JSON.stringify({ summary: "A summary." }) : "Say it.\n~~~\nWritten out.";
    return Response.json({ candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40, thoughtsTokenCount: 10 } });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

const sha = text => createHash("sha256").update(text).digest("hex").slice(0, 16);
const EXTRAS = { facts: "FOREVER FACTS\n- A fact.", help: "WILLO HELP\nA help.", dispute: "correction", custom: "Be brief." };
// Every way the system prompt is built for a request that is not away.
const CASES = {
  answer: ["Who is VanCleef?", false, "answer", {}],
  extras: ["Who is VanCleef?", false, "answer", EXTRAS],
  spoken: ["Who is VanCleef?", false, "answer", { style: "spoken" }],
  layered: ["Who is VanCleef?", false, "answer", { style: "spoken", layered: true }],
  picture: ["What is this?", false, "answer", { style: "spoken", image: `data:image/jpeg;base64,${"A".repeat(10)}` }],
  grounded: ["Where is the vendor?", true, "answer", {}],
  groundedExtras: ["Where is the vendor?", true, "answer", EXTRAS],
  character: ["Who are you?", false, "character", { style: "spoken" }],
  characterText: ["Who are you?", false, "character", {}],
  compact: ["Remember this.", false, "compact", {}],
};
async function built(persona, [question, research, operation, extra], more = {}) {
  systems = [];
  await writeAnswer(env, question, NOW, research, operation, { persona, ...extra, ...more });
  assert.equal(systems.length, 1);
  return systems[0];
}

// Hashes of the system prompts main built for each case before the away state existed (2026-10-21, commit 147b91e).
const MAIN = {
  "sam answer": "e554cb633d5a8a8f", "sam extras": "af9af481b2cbc180", "sam spoken": "bcf63de330ea933d",
  "sam layered": "7d25a6ae6b8dacad", "sam picture": "bcf63de330ea933d", "sam grounded": "735f89d9f1cfcccf",
  "sam groundedExtras": "e842c25873dfd83e", "sam character": "813ef01e36bad5b6", "sam characterText": "3659ea0ede473e1f",
  "sam compact": "7edf7db34438f427",
  "willo answer": "ab12322e8192691f", "willo extras": "83c5f653005c6c0a", "willo spoken": "8821e94a4b4ddde9",
  "willo layered": "779a398a7fd4ea48", "willo picture": "8821e94a4b4ddde9", "willo grounded": "8b592f6b0d3cdadd",
  "willo groundedExtras": "2c4ec6a06d83d73d", "willo character": "813ef01e36bad5b6",
  "willo characterText": "3659ea0ede473e1f", "willo compact": "847a22fc0913c8f8",
};
test("a request that is not away builds the same system prompt as before", async () => {
  const got = {};
  for (const persona of ["sam", "willo"]) for (const [name, spec] of Object.entries(CASES)) got[`${persona} ${name}`] = sha(await built(persona, spec));
  if (process.env.PRINT_MAIN) console.log(JSON.stringify(got, null, 2));
  assert.deepEqual(got, MAIN);
});

// ---- away from the game ----
const AWAY_TECH = /SavedVariables|\/reload|last save|saved variables/i;
test("away changes the system prompt: no in-game sentences, a short rule, past tense of where they were", async () => {
  for (const persona of ["sam", "willo"]) for (const name of ["answer", "extras", "spoken", "layered", "grounded", "groundedExtras"]) {
    const home = await built(persona, CASES[name]), away = await built(persona, CASES[name], { away: true });
    assert.notEqual(away, home, `${persona} ${name}`);
    assert.ok(away.includes("AWAY: zone and sub are where they last rested. Say it in the past tense"), `${persona} ${name} has the rule`);
    assert.ok(!home.includes("AWAY:"));
    assert.ok(!away.includes("over the game"), `${persona} ${name} speaks over nothing`);
    assert.ok(!away.includes("are in the game and can see"));
    assert.ok(away.includes("when you rested last, folk were about"), "people and places as last seen");
    assert.ok(!AWAY_TECH.test(away.replace(/Never say[^.]*\./, "")), "the rule never teaches a tech word");
    assert.ok(away.includes("from Darkshire, where you rested last") && away.includes('never "here", "now" or "right there", nor name or guess who is near'), "directions too");
  }
  const text = await built("willo", CASES.answer, { away: true });
  assert.ok(text.includes("they know their world and can see what you can't"));
  const spoken = await built("willo", CASES.spoken, { away: true });
  assert.ok(spoken.includes("Willo says this answer out loud. Reply with only"));
});

test("with no place given, she can't see where they are and asks: no past tense of a place", async () => {
  const none = await built("willo", CASES.answer, { away: "none" });
  assert.ok(none.includes("nothing says where they are: never guess a place"));
  assert.ok(none.includes("say you can't see where they are and ask where they last rested"), "asks in rest terms, not log-in ones");
  assert.ok(!none.includes("when you rested last you were in"));
  assert.ok(!none.includes("over the game") && !none.includes("are in the game and can see"));
  assert.ok(Buffer.byteLength(none) < Buffer.byteLength(await built("willo", CASES.answer, { away: true })));
});

test("away leaves a character's reply and the memory as they were", async () => {
  for (const name of ["character", "characterText", "compact"]) {
    assert.equal(await built("willo", CASES[name], { away: true }), await built("willo", CASES[name]), name);
  }
});

test("the away prompt stays about the size of the in-game one", async () => {
  for (const name of ["answer", "spoken", "layered", "grounded"]) {
    const home = Buffer.byteLength(await built("willo", CASES[name])), away = Buffer.byteLength(await built("willo", CASES[name], { away: true }));
    assert.ok(away - home <= 316, `${name}: ${home} -> ${away}`);
    if (process.env.PRINT_MAIN) console.log(`willo ${name}: main ${home} bytes, away ${away} bytes`);
  }
});

async function linked() {
  const user = await findOrCreateUser(env, { email: "away@example.com", googleSub: "away", name: "away" });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return (await claimToken(env, link.device_code)).token;
}
const sse = chunk => `data: ${JSON.stringify(chunk)}\r\n\r\n`;
let sentBodies = [];
async function askWith(token, { client = "companion/0.1.0", ...fields } = {}) {
  systems = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    systems.push(body.systemInstruction.parts[0].text.replace(/^\([0-9a-f]{8}\)\n/, ""));
    sentBodies.push(body);
    const text = "Thrall leads the Horde from Orgrimmar.\n~~~\nThrall leads the Horde from Orgrimmar, in Durotar.";
    if (String(url).includes(":streamGenerateContent")) {
      const usageMetadata = { promptTokenCount: 300, candidatesTokenCount: 90 };
      return new Response(sse({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata }),
        { headers: { "Content-Type": "text/event-stream" } });
    }
    return Response.json({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 90 } });
  };
  const res = await onRequest({ env, request: new Request("https://example.test/api/companion/answer", {
    method: "POST", headers: { "X-LF-Client": client, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "PLAYER CONTEXT\nzone: Tirisfal Glades\n\nQUESTION\nWho leads the Horde?", persona: "willo", ...fields }) }) });
  assert.equal(res.status, 200);
  return { res, text: await res.text() };
}

test("a request from the iPhone is away; from the PC it is not unless the body says so", async () => {
  const token = await linked();
  await askWith(token, { client: "companion/0.1.0" });
  assert.ok(!systems.at(-1).includes("AWAY:"), "the PC is in the game");
  await askWith(token, { client: "companion/0.1.0", away: false });
  assert.ok(!systems.at(-1).includes("AWAY:"));
  await askWith(token, { client: "companion/0.1.0", away: "yes" });
  assert.ok(!systems.at(-1).includes("AWAY:"), "only true counts");
  await askWith(token, { client: "companion/0.1.0", away: true });
  assert.ok(systems.at(-1).includes("AWAY:"), "the PC with no game running");
  await askWith(token, { client: "companion/ios-0.3.0" });
  assert.ok(systems.at(-1).includes("AWAY:"), "the iPhone");
});

test("the iPhone's spoken ask in two layers is away too, and its character line is read", async () => {
  const token = await linked();
  const { text } = await askWith(token, { client: "companion/ios-0.3.0", style: "spoken", layers: 2,
    prompt: "PLAYER CONTEXT\ncharacter: Level 22 Human Rogue\n\nQUESTION\nWho leads the Horde?" });
  assert.ok(text.includes("Thrall leads the Horde"));
  const system = systems.at(-1);
  assert.ok(system.includes("AWAY:"));
  assert.ok(system.includes("this answer out loud. Reply in two parts"), "the layered spoken rules, away");
  assert.ok(!system.includes("over the game"));
  const home = await askWith(token, { style: "spoken", layers: 2 });
  assert.ok(home.text.length > 0);
  assert.ok(systems.at(-1).includes("out loud over the game, with captions"), "in game it is as it was");
});

// ---- the phone's character line ----
const parts = lines => promptParts(`PLAYER CONTEXT\n${lines}\n\nQUESTION\nWhere do I buy a mount?`);
test("promptParts reads the phone's character line", () => {
  const p = parts("name: Húrin\nrealm: Forever\ncharacter: Level 22 Human Rogue\nThey are away from the game.");
  assert.deepEqual([p.level, p.race, p.class, p.faction], ["22", "Human", "Rogue", "Alliance"]);
  const horde = parts("character: Level 40 Orc Warrior");
  assert.deepEqual([horde.level, horde.race, horde.class, horde.faction], ["40", "Orc", "Warrior", "Horde"]);
  const undead = parts("character: Level 9 Undead Priest");
  assert.equal(undead.faction, "Horde");
});

test("a two-word people is read whole", () => {
  const p = parts("character: Level 31 Night Elf Druid");
  assert.deepEqual([p.level, p.race, p.class, p.faction], ["31", "Night Elf", "Druid", "Alliance"]);
});

test("a skyborne has no faction guessed: they can be either", () => {
  const p = parts("character: Level 12 Skyborne Mage");
  assert.deepEqual([p.level, p.race, p.class, p.faction], ["12", "Skyborne", "Mage", ""]);
});

test("explicit level, race, class and faction lines win over the character line", () => {
  const p = parts("character: Level 22 Human Rogue\nlevel: 30\nrace: Troll\nclass: Hunter\nfaction: Horde");
  assert.deepEqual([p.level, p.race, p.class, p.faction], ["30", "Troll", "Hunter", "Horde"]);
  const some = parts("character: Level 22 Human Rogue\nlevel: 30");
  assert.deepEqual([some.level, some.race, some.class, some.faction], ["30", "Human", "Rogue", "Alliance"]);
  const raced = parts("character: Level 22 Human Rogue\nrace: Skyborne");
  assert.equal(raced.faction, "", "an explicit people is not given the character line's side");
});

test("a line with no race, no level or no class says only what it has", () => {
  const noPeople = parts("character: Level 22 Rogue");
  assert.deepEqual([noPeople.level, noPeople.race, noPeople.class, noPeople.faction], ["", "", "", ""]);
  const noLevel = parts("character: Human Rogue");
  assert.deepEqual([noLevel.level, noLevel.race, noLevel.class], ["", "Human", "Rogue"]);
  const none = promptParts("PLAYER CONTEXT\nzone: Westfall\n\nQUESTION\nhi");
  assert.deepEqual([none.level, none.race, none.class, none.faction], ["", "", "", ""]);
});

// ---- the blind check's fixes (10/21) ----
test("a level and people with no class: the people from Forever's list, the class left empty", () => {
  const p = parts("character: Level 22 Night Elf");
  assert.deepEqual([p.level, p.race, p.class, p.faction], ["22", "Night Elf", "", "Alliance"]);
  const human = parts("character: Level 5 Human");
  assert.deepEqual([human.race, human.class], ["Human", ""]);
  const undead = parts("character: Undead");
  assert.deepEqual([undead.race, undead.class, undead.faction], ["Undead", "", "Horde"]);
  const sky = parts("character: Level 8 Skyborne");
  assert.deepEqual([sky.race, sky.class, sky.faction], ["Skyborne", "", ""]);
});

test("an away request loses the lines about what is around them now, and keeps where they last were", () => {
  const prompt = "PLAYER CONTEXT\nzone: Duskwood\nsub: Darkshire\ntarget: Madame Eva\nscreen: world\nlevel: 22\n\nSOURCES\ntarget: kept\n\nQUESTION\nWho is that?";
  const got = withoutLive(prompt);
  assert.equal(got, "PLAYER CONTEXT\nzone: Duskwood\nsub: Darkshire\nlevel: 22\n\nSOURCES\ntarget: kept\n\nQUESTION\nWho is that?");
  assert.equal(withoutLive("QUESTION\nhi"), "QUESTION\nhi");
});

test("a phone with no place gets the no-place rule; a PC with a stale zone gets the place rule and its target dropped", async () => {
  const token = await linked();
  await askWith(token, { client: "companion/ios-0.3.0", prompt: "PLAYER CONTEXT\ncharacter: Level 22 Human Rogue\n\nQUESTION\nwhere am I?" });
  assert.ok(systems.at(-1).includes("nothing says where they are"), "the phone knows no place");
  assert.ok(!systems.at(-1).includes("Say it in the past tense"));
  await askWith(token, { away: true, prompt: "PLAYER CONTEXT\nzone: Duskwood\nsub: Darkshire\ntarget: Madame Eva\n\nQUESTION\nWho is that NPC?" });
  assert.ok(systems.at(-1).includes("Say it in the past tense"));
  sentBodies = [];
  await askWith(token, { away: true, prompt: "PLAYER CONTEXT\nzone: Duskwood\nsub: Darkshire\ntarget: Madame Eva\n\nQUESTION\nWho is that NPC?" });
  assert.ok(!JSON.stringify(sentBodies[0].contents).includes("target: Madame Eva"), "the stale target never reaches her");
  const seen = JSON.stringify(sentBodies[0].contents);
  assert.ok(seen.includes("zone: Duskwood\\nsub: Darkshire"), "the zone and sub lines reach her exactly as in the game");
});

test("away from a PC, her 'right here' is said as from where they last were", async () => {
  const token = await linked();
  const reply = "You are standing right here in Darkshire. The flight master is at the inn here in Darkshire.";
  const { text } = await (async () => {
    systems = [];
    globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: reply }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 90 } });
    const res = await onRequest({ env, request: new Request("https://example.test/api/companion/answer", {
      method: "POST", headers: { "X-LF-Client": "companion/0.1.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "PLAYER CONTEXT\nzone: Duskwood\nsub: Darkshire\n\nQUESTION\nHow do I get to the flight master?",
        persona: "willo", away: true }) }) });
    return { text: await res.text() };
  })();
  assert.ok(!/right here/i.test(text), text);
  assert.ok(/You were last in Darkshire/.test(text), text);
});

