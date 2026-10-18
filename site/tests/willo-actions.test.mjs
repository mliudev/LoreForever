// What one of Willo's answers may offer to do for the player (LOR-546 slice 2): the site offers the answer model a few
// actions from a fixed list and returns the one it picks beside the answer; it never runs one. In-process on node:sqlite
// (helpers.mjs); Gemini is a stub. Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { actionsFor, actionOf, offerLine } from "../lib/willo-tools.js";
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
const ask = async (token, question, extra = {}) => (await answer({ env, request: new Request(
  "https://example.test/api/companion/answer", { method: "POST", headers: { "X-LF-Client": "companion/0.19.0",
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
  // From then: her five with their male partners (LOR-610), then the Voices of Azeroth.
  assert.deepEqual(picksFor("companion/0.20.1").slice(0, 10), ["sprite", "puck", "sunbeam", "daybreak", "moonwell",
    "moonshade", "fenlight", "fenfire", "starling", "kestrel"]);
  assert.deepEqual(picksFor("companion/0.20.1").slice(10), AZEROTH_PICKS);
  assert.equal(picksFor("companion/0.21.0").length, 32);
  // WILLO STATE's "voice now" names her voice as Settings does: never offered the one she has.
  assert.deepEqual([pickNamed("Dwarf, man"), pickNamed("Sprite"), pickNamed("Heart "), pickNamed("")], ["dwarf-male", "sprite", "", ""]);
  const all = ["problems", "talk", "voice", "wisp", "sight", "live", "plans", "chat"];
  const offered = actionsFor(all, { voices: picksFor("companion/0.21.0"), current: "dwarf-male", key: "f9",
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
