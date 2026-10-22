// What one of Willo's answers may offer to do for the player (LOR-546 slice 2): the site offers the answer model a few
// actions from a fixed list and returns the one it picks beside the answer; it never runs one. In-process on node:sqlite
// (helpers.mjs); Gemini is a stub. Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { actionsFor, actionOf, offerLine } from "../lib/willo-tools.js";
import { helpTopics, helpBlock } from "../lib/willo-help.js";
import { picksFor, pickNamed, AZEROTH_PICKS } from "../lib/companion-voice.js";
import { ACTIONS_MAX_BYTES } from "../lib/companion-answers.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key" };
const originalFetch = globalThis.fetch;
let calls, reply;

beforeEach(async () => {
  await setup(env);
  calls = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    return Response.json(reply(body));
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

let n = 0;
async function linked() {
  const sub = `actor${++n}`;
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  return (await claimToken(env, link.device_code)).token;
}
const STATE = "WILLO STATE\ntalk: warn, F5 is on your action bar in game; fix: the Use F9 button in Settings › Willo and the " +
  "game\ntalking out loud: on; seeing the game when asked out loud: on; talk key: F5\nvoice now: Sprite";
const ask = async (token, question, extra = {}, client = "companion/0.19.0") => (await answer({ env, request: new Request(
  "https://example.test/api/companion/answer", { method: "POST", headers: { "X-LF-Client": client,
    Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: `PLAYER CONTEXT\nzone: Teldrassil\nrace: Night Elf\nclass: Druid\nlevel: 8\n\n${STATE}\n\n` +
    `SOURCES\n\nQUESTION\n${question}`, persona: "willo", ...extra }) }) })).json();
const called = (name, args) => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name, args } }] } }],
  usageMetadata: { promptTokenCount: 4000, candidatesTokenCount: 90 } });

test("her answer offers one action from the list, with the answer, and the site never runs it", async () => {
  reply = () => called("set_talk_key", { answer: "F5 is on your action bar, so the game takes it. Want me to use F9?",
    key: "f9" });
  const out = await ask(await linked(), "My talk key doesn't work");
  assert.equal(out.answer, "F5 is on your action bar, so the game takes it. Want me to use F9?");
  assert.deepEqual(out.action, { id: "set_talk_key", args: { key: "f9" }, label: "Use F9" });
  // Offered as a required call that carries the answer (Flash-Lite won't write and call in one turn), and only the
  // free key Willo's own check found.
  const [{ tools, toolConfig, systemInstruction }] = calls;
  assert.equal(toolConfig.functionCallingConfig.mode, "ANY");
  const offered = Object.fromEntries(tools[0].functionDeclarations.map(d => [d.name, d]));
  assert.ok(offered.answer_only);
  assert.deepEqual(offered.set_talk_key.parameters.properties.key.enum, ["f9"]);
  assert.match(systemInstruction.parts[0].text, /WILLO ACTIONS: [^]*never say you've done it/);
});

test("an action outside the offer is dropped, and an answer that says it's done becomes an offer", async () => {
  const token = await linked();
  reply = () => called("set_talk_key", { answer: "Let's use F8.", key: "f8" });
  const wrong = await ask(token, "My talk key doesn't work");
  assert.equal(wrong.answer, "Let's use F8.");
  assert.equal(wrong.action, undefined, "never a key the game uses");
  reply = () => called("new_chat", { answer: "Of course! I've cleared our recent history." });
  const fresh = await ask(token, "Can we start over?");
  assert.equal(fresh.action.id, "new_chat");
  assert.doesNotMatch(fresh.answer, /cleared/, "only a tap or a yes does it");
  // Nothing offered for a question that isn't about her: no functions, just the answer.
  reply = () => ({ candidates: [{ content: { parts: [{ text: "Teldrassil is the night elves' great tree." }] } }] });
  calls = [];
  const lore = await ask(token, "What is Teldrassil?");
  assert.equal(lore.action, undefined);
  assert.equal(calls[0].tools, undefined);
});

test("money is a tap in her window: never offered out loud, never without plans for sale", () => {
  const names = (topics, opts) => actionsFor(topics, opts).map(d => d.name);
  assert.deepEqual(names(["plans"], { plans: true }), ["open_plans", "open_billing"]);
  assert.deepEqual(names(["plans"], { plans: true, spoken: true }), []);
  assert.deepEqual(names(["plans"], { plans: false }), []);
  // Her voices only where the plan picks one, never the one she has now.
  const voice = actionsFor(["voice"], { voices: ["sprite", "moonwell"], current: "Sprite" });
  assert.deepEqual(voice.find(d => d.name === "set_voice").parameters.properties.voice.enum, ["moonwell"]);
  assert.ok(!names(["voice"], {}).includes("set_voice"));
});

test("the Voices of Azeroth are offered only to a companion whose picker has them, in players' words (LOR-609)", () => {
  assert.deepEqual(picksFor("companion/0.20.0"), ["sprite", "sunbeam", "moonwell", "fenlight", "starling"]);
  assert.equal(picksFor("companion/0.1.0").length, 5, "a build without a release version: her own five");
  // From then: her five with their male partners (LOR-610), then the Voices of Azeroth on a plan that has them
  // (Legend's, and the first-run trial's: the voices and plans picks, 10/21).
  const legend = { voice: { choice: true, azeroth: true } }, champion = { voice: { choice: true } };
  assert.deepEqual(picksFor("companion/0.20.1", legend).slice(0, 10), ["sprite", "puck", "sunbeam", "daybreak", "moonwell",
    "moonshade", "fenlight", "fenfire", "starling", "kestrel"]);
  assert.deepEqual(picksFor("companion/0.20.1", legend).slice(10), AZEROTH_PICKS);
  assert.equal(picksFor("companion/0.21.0", legend).length, 32);
  assert.equal(picksFor("companion/0.21.0", champion).length, 10);
  // WILLO STATE's "voice now" names her voice as Settings does: never offered the one she has.
  assert.deepEqual([pickNamed("Dwarf, man"), pickNamed("Sprite"), pickNamed("Heart "), pickNamed("")], ["dwarf-male", "sprite", "", ""]);
  const all = ["problems", "talk", "voice", "wisp", "sight", "live", "plans", "chat", "color", "settings"];
  const offered = actionsFor(all, { voices: picksFor("companion/0.21.0", legend), current: "dwarf-male", key: "f9",
    off: { live: true, sight: true }, plans: true });
  const enumOf = offered.find(d => d.name === "set_voice").parameters.properties.voice.enum;
  assert.ok(enumOf.includes("nightelf-female") && !enumOf.includes("dwarf-male"));
  assert.ok(new TextEncoder().encode(JSON.stringify(offered)).length <= ACTIONS_MAX_BYTES, "every action at once still fits");
  const action = actionOf({ name: "set_voice", args: { voice: "nightelf-female" } }, offered);
  assert.deepEqual([action.label, offerLine(action)], ["Switch to Night elf, woman",
    "How about a night elf woman's voice? Want me to switch?"]);
  assert.equal(offerLine({ id: "set_voice", args: { voice: "orc-male" } }), "How about an orc man's voice? Want me to switch?");
  assert.equal(offerLine({ id: "set_voice", args: { voice: "moonwell" } }), "How about Moonwell? Want me to switch?");
  assert.equal(offerLine({ id: "set_voice", args: { voice: "kestrel" } }), "How about Kestrel? Want me to switch?");
});

test("consent is offered only for what's off in her window, and seeing the game only on a plan with it", () => {
  const names = (topics, opts) => actionsFor(topics, opts).map(d => d.name);
  assert.ok(names(["live"], { off: { live: true } }).includes("live_game_info"));
  assert.ok(!names(["live"], { off: { live: true } }).includes("open_settings"), "its explanation, not the bare card");
  assert.ok(!names(["live"], {}).includes("live_game_info"), "on already: nothing to offer");
  assert.ok(names(["sight"], { off: { sight: true } }).includes("see_the_game"));
  assert.ok(!names(["sight"], { off: { sight: true }, sight: false }).includes("see_the_game"), "the free plan");
});

test("her color and her Settings: help and a button for a Willo with them, never a card an older one lacks", async () => {
  // Mike, 10/17: "I want to change your color" got "I cannot change my color", "can you open your settings?" got "I
  // don't have settings", and neither a button ("I was expecting one of those chips to open settings").
  const sections = (q, client) => actionsFor(helpTopics(q, { client }), { client })
    .find(d => d.name === "open_settings")?.parameters.properties.section.enum || [];
  assert.deepEqual(helpTopics("I want to change your color", { client: "companion/0.21.0" }), ["color"]);
  assert.deepEqual(sections("I want to change your color", "companion/0.21.1"), ["color"]);
  assert.deepEqual(sections("can you open your settings?", "companion/0.22.0"), ["settings"]);
  // 0.21.0 has her color's card (its help) but no button to it or to her Settings: it would drop one.
  assert.deepEqual(sections("I want to change your color", "companion/0.21.0"), []);
  assert.match(helpBlock("I want to change your color", { client: "companion/0.21.0" }),
    /Settings › Willo › Willo's color: tap a swatch/);
  assert.match(helpBlock("can you open your settings?", { client: "companion/0.21.0" }),
    /Your Settings: in your window, Settings in the bar at the top[^]*Willo's color, Talk with Willo/);
  // 0.20.0 has neither her color's card nor the settings section: no button, and no color it can't show.
  assert.deepEqual(helpTopics("I want to change your color", { client: "companion/0.20.0" }), []);
  assert.deepEqual(sections("can you open your settings?", "companion/0.20.0"), []);
  assert.doesNotMatch(helpBlock("can you open your settings?", { client: "companion/0.20.0" }), /color/);
  for (const [q, topic] of [["When I want to change willo settings it doesn't let me", "settings"],
    ["How do I change your settings?", "settings"], ["Can you turn Willo purple?", "color"], ["What's your color?", "color"]])
    assert.deepEqual(helpTopics(q, { client: "companion/0.21.0" }), [topic], q);
  // The world's colors and the game's own settings stay the world's (lore, or a look online).
  for (const q of ["What color is the Scarlet Crusade's tabard?", "Can you tell me the color of the Defias bandanas?",
    "What graphics settings do you recommend for my PC?", "How do I open the settings in WoW?"])
    assert.deepEqual(helpTopics(q, { client: "companion/0.21.0" }), [], q);
  assert.deepEqual(actionOf({ name: "open_settings", args: { section: "color" } }, actionsFor(["color"])),
    { id: "open_settings", args: { section: "color" }, label: "Show my colors" });
  // Through the site: the companion's version decides.
  reply = () => called("open_settings", { answer: "Pick any color you like in my Settings!", section: "color" });
  const out = await ask(await linked(), "I want to change your color", {}, "companion/0.21.1");
  assert.deepEqual(out.action, { id: "open_settings", args: { section: "color" }, label: "Show my colors" });
});

test("a voice switch only when they ask for another voice; talk about her voices gets her voices' card (LOR-649)", async () => {
  // Mike, 10/17, out loud: "Just testing your various voices." got "Switch to Starling", beside her words offering a
  // dwarf or a night elf. A voice talked about offers her voices' card ("Show my voices"), never a switch.
  const voices = picksFor("companion/0.21.0");
  const offered = q => actionsFor(helpTopics(q), { voices, current: "sprite", asked: q }).map(d => d.name);
  for (const q of ["Just testing your various voices.", "I love your voice", "Why is your voice so quiet?"]) {
    assert.ok(!offered(q).includes("set_voice"), q);
    assert.ok(offered(q).includes("open_settings"), q);
  }
  for (const q of ["Hey Willow, can I change your voice?", "Can you switch your voice to Starling?", "Use Moonwell as your voice",
    "Can you sound like a dwarf?", "Can you try a different voice?"])
    assert.ok(offered(q).includes("set_voice"), q);
  // Through the site, for a Champion player, whose plan picks her voice.
  const user = await findOrCreateUser(env, { email: "voices@example.com", googleSub: "voices", name: "voices" });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  const { token } = await claimToken(env, link.device_code);
  await env.DB.prepare("INSERT INTO entitlements (user_id, subscription_id, plan, status, current_period_end, updated) " +
    "VALUES (?, ?, 'champion', 'active', ?, ?)").bind(user.id, "sub-voices", new Date(Date.now() + 20 * 86400e3).toISOString(),
    new Date().toISOString()).run();
  const declared = async q => {
    calls = [];
    reply = () => called("answer_only", { answer: "Happy to help!" });
    await ask(token, q, {}, "companion/0.21.0");
    return calls[0].tools[0].functionDeclarations.map(d => d.name);
  };
  env.SITE_FEATURES = "plans";                     // plans on sale: Champion picks her voice
  try {
    assert.ok(!(await declared("Just testing your various voices.")).includes("set_voice"));
    assert.ok((await declared("Hey Willow, can I change your voice?")).includes("set_voice"), "asked for: offered");
  } finally { delete env.SITE_FEATURES; }
});

test("the key for the one you're targeting: told only by a Willo that has it", () => {
  // LOR-658: the talk key always reaches Willo; a second key asks the one you target. Her app says it has that key in
  // WILLO STATE; an older one doesn't, and she never names a key it lacks.
  const state = "talking out loud: on; seeing the game when asked out loud: on; talk key: F6\n" +
    "key for the one you're targeting: none picked";
  assert.deepEqual(helpTopics("How do I talk to my target?"), ["talk"]);
  assert.match(helpBlock("How do I talk to my target?", { state }), /under "Ask who you're targeting"/);
  assert.doesNotMatch(helpBlock("How do I talk to my target?", { state: state.split("\n")[0] }), /Ask who you're targeting/);
});

test("her friends: where they come from, never the game's social panel (QA 10/19)", () => {
  for (const q of ["Are any of my friends online?", "Where are my friends?", "How do I add a friend?", "Who's on my friends list?"]) {
    assert.deepEqual(helpTopics(q), ["friends"], q);
  }
  assert.match(helpBlock("Are any of my friends online?"), /Friends tab[^.]*next to Notebook/);
  for (const q of ["My friend and I want to run the Deadmines, any tips?", "Who are Thrall's friends?"]) {
    assert.deepEqual(helpTopics(q), [], q);
  }
});
