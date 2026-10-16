// Willo's spoken replies (lib/companion-voice.js, functions/api/companion/speak.js, LOR-490): which voice says each
// plan's answers, a reply counted once across its pieces, Legend's finest voice for its first replies of the month,
// the voice stepping down (finest, studio, the PC) before a month would cost more than the plan brings or when a
// provider fails, a reply nothing could say given back, and the hosted voice's cost apart from the text cap. Gemini and
// the voice providers are mocked through fetch; D1 is node:sqlite (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { onRequest as speakApi } from "../functions/api/companion/speak.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { setupBilling, planFor, poolWindow, userSpend, overTextCap, PLANS, LEGEND_BEST_PER_MONTH, LEGEND_BEST_MODEL,
  STARTER_ANSWERS } from "../lib/billing.js";
import { allowance, answerBudgetUsed } from "../lib/companion-answers.js";
import { willoPick } from "../lib/companion-voice.js";

import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const NOW = Date.parse("2026-10-11T12:00:00Z");
const env = { DB: d1(), GEMINI_API_KEY: "test-key", SITE_FEATURES: "plans", DEEPINFRA_API_KEY: "di-test",
              INWORLD_API_KEY: "iw-test",
              HOSTED_VOICES: JSON.stringify({ willo: { deepinfra: "willo-studio", inworld: "willo-finest" } }) };
const originalFetch = globalThis.fetch;
// Two made-up MP3 halves: Inworld streams them as two chunks, DeepInfra sends them whole.
const MP3 = Buffer.from("ID3\x04\x00\x00fake-mp3-frames", "latin1");
let calls, failing;

beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  await setup(env);
  await setupBilling(env);
  for (const table of ["users", "sessions", "devices", "device_links", "rate_limits", "answer_spend", "story_spend",
                       "entitlements", "answer_user_spend", "answer_packs", "answer_holds", "starter_claims", "voice_replies"])
    env.DB.sqlite.exec(`DELETE FROM ${table}`);
  calls = [];
  failing = new Set();
  globalThis.fetch = async (url, options = {}) => {
    const host = new URL(url).hostname;
    const provider = host === "api.inworld.ai" ? "inworld" : host === "api.deepinfra.com" ? "deepinfra" : null;
    if (!provider) throw new Error(`unexpected fetch ${url}`);
    calls.push({ provider, headers: options.headers, body: JSON.parse(options.body) });
    if (failing.has(provider)) return new Response("overloaded", { status: 503 });
    if (provider === "deepinfra") return Response.json({ audio: "data:audio/mpeg;base64," + MP3.toString("base64") });
    const half = MP3.length >> 1;
    return new Response([MP3.subarray(0, half), MP3.subarray(half)]
      .map(part => JSON.stringify({ result: { audioContent: part.toString("base64") } })).join("\n") + "\n");
  };
});
afterEach((t) => { globalThis.fetch = originalFetch; t.mock.timers.reset(); });

// A player on `plan` (none: free) with a connected companion and a renewal 20 days off, and their spoken pieces.
async function companionPlayer(sub, plan) {
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const link = await startLink(env);
  assert.equal(await decideLink(env, link.user_code, user, true), true);
  const { token } = await claimToken(env, link.device_code);
  if (plan) {
    await env.DB.prepare("INSERT INTO entitlements (user_id, subscription_id, plan, status, current_period_end, updated) " +
      "VALUES (?, ?, ?, 'active', ?, ?)").bind(user.id, `sub-${user.id}`, plan, new Date(NOW + 20 * 86400e3).toISOString(),
      new Date(NOW).toISOString()).run();
  }
  const headers = { "X-LF-Client": "companion/0.1.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const speak = async body => {
    const res = await speakApi({ env, request: new Request(ORIGIN + "/api/companion/speak", { method: "POST", headers,
      body: JSON.stringify({ voice: "willo", ...body }) }) });
    const type = res.headers.get("Content-Type") || "";
    return { status: res.status, type, voice: res.headers.get("X-LF-Voice"),
             body: type.startsWith("audio/") ? Buffer.from(await res.arrayBuffer()) : await res.json() };
  };
  const voice = async () => (await allowance(env, user.id)).voice;
  // `n` replies already said this plan month by the finest voice.
  const saidBest = async n => {
    const period = poolWindow(await planFor(env, user.id)).key;
    const add = env.DB.sqlite.prepare("INSERT INTO voice_replies (user_id, reply, period, pieces, heard, best, created) " +
      "VALUES (?, ?, ?, 1, 1, 1, ?)");
    for (let i = 0; i < n; i++) add.run(user.id, `earlier-${i}`, period, new Date(NOW).toISOString());
  };
  // What this calendar month cost so far: `text` of answers, `voice` of hosted voice.
  const spent = (text, voice = 0) => env.DB.sqlite.prepare("INSERT OR REPLACE INTO answer_user_spend " +
    "(user_id, month, micro, calls, voice_micro) VALUES (?, '2026-10', ?, 1, ?)").run(user.id, text + voice, voice);
  return { user, speak, voice, saidBest, spent };
}

test("who says each plan's answers: the studio voice for Free's first ones and Hero, Champion's choice, Legend's finest", async () => {
  const free = await companionPlayer("free"), hero = await companionPlayer("hero", "hero");
  const champion = await companionPlayer("champ", "champion"), legend = await companionPlayer("legend", "legend");
  const studio = { tier: "hosted", top: "studio", now: "studio", choice: false };
  assert.deepEqual(await free.voice(), { ...studio, starterLeft: STARTER_ANSWERS });
  assert.deepEqual(await hero.voice(), studio);
  assert.deepEqual(await champion.voice(), { tier: "hosted", top: "studio", now: "studio", choice: true });
  assert.deepEqual(await legend.voice(), { tier: "hosted", top: "finest", now: "finest", choice: true,
                                           bestLeft: LEGEND_BEST_PER_MONTH });
  // The free plan: while its starter lasts it may ask out loud, and those questions are answered aloud (below);
  // typed questions get text (Mike, 2026-10-14).
  const features = async () => (await allowance(env, free.user.id)).features;
  assert.deepEqual([(await features()).voices, (await features()).push_to_talk], ["default", true]);
  assert.deepEqual((await allowance(env, hero.user.id)).features.voices, "all", "Hero: Willo's voices on the PC stand in");

  // Without a provider's key, or Willo's own voice id, a hosted plan's replies stay on the PC.
  const keys = [env.DEEPINFRA_API_KEY, env.INWORLD_API_KEY];
  delete env.DEEPINFRA_API_KEY; delete env.INWORLD_API_KEY;
  try {
    assert.equal((await champion.voice()).tier, "local");
    assert.equal((await champion.speak({ text: "For the Horde!" })).status, 503);
  } finally { [env.DEEPINFRA_API_KEY, env.INWORLD_API_KEY] = keys; }
  delete env.SITE_FEATURES;
  try {
    assert.equal((await allowance(env, champion.user.id)).voice, undefined, "plans off: Willo talks on the PC, as before");
    const res = await champion.speak({ text: "For the Horde!" });
    assert.deepEqual([res.status, res.body.reason], [404, "off"]);
  } finally { env.SITE_FEATURES = "plans"; }
  assert.equal(calls.length, 0);
});

test("Willo speaks as Sprite; Champion and Legend in the voice the player picks, Sprite for an unknown one", async () => {
  const champion = await companionPlayer("champ", "champion"), legend = await companionPlayer("legend", "legend");
  const idOf = async (player, pick) => {
    assert.equal((await player.speak({ text: "Lok'tar ogar.", ...(pick ? { pick } : {}) })).status, 200);
    return calls.at(-1).body.voice_id ?? calls.at(-1).body.voiceId;
  };
  assert.equal(await idOf(champion), "willo-studio", "no pick: Sprite, the Pages variable's willo ids");
  assert.equal(await idOf(champion, "moonwell"), "1lm6bxrwur1pipen43ce", "Moonwell's studio voice, the code's id");
  assert.equal(await idOf(champion, "gloomshade"), "willo-studio");
  assert.equal(await idOf(legend, "fenlight"), "humble-aspen-1573__design-voice-22a59081", "Fenlight's finest voice");
  // A hosted voice on a plan without a choice is always Sprite.
  assert.equal(willoPick({ voice: { voice: "chatterbox", choice: false } }, "moonwell"), "sprite");
});

test("Champion: every reply in Chatterbox, counted once across its pieces, its cost apart from the text cap", async () => {
  const { user, speak } = await companionPlayer("champ", "champion");
  const pieces = ["Thrall leads the Horde,", "from his seat in Orgrimmar, beyond the gates of Durotar."];
  for (const text of pieces) {
    const res = await speak({ text, reply: "reply-0001" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.type, "audio/mpeg");
    assert.deepEqual(res.body, MP3, "DeepInfra's base64 audio, data: prefix and all");
  }
  assert.deepEqual(calls.map(c => [c.provider, c.body.voice_id, c.body.text]), pieces.map(t => ["deepinfra", "willo-studio", t]));
  assert.equal(calls[0].headers.Authorization, "Bearer di-test");
  assert.deepEqual([calls[0].body.response_format, calls[0].body.exaggeration, calls[0].body.cfg], ["mp3", 0.5, 0.5]);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM voice_replies").get().n, 1, "two pieces, one reply");

  // $1 a million letters, on the player's month as voice: the whole net counts it, the text half doesn't, and the
  // free players' budget doesn't move.
  const letters = pieces.join("").length;
  assert.deepEqual([await userSpend(env, user.id, new Date(), { total: true }), await userSpend(env, user.id)], [letters, 0]);
  assert.equal(await answerBudgetUsed(env), 0);

  // Chatterbox down: the PC says it (never up to the dearer finest voice), and the reply isn't kept.
  failing.add("deepinfra");
  const down = await speak({ text: "Nobody hears this.", reply: "reply-lost" });
  assert.deepEqual([down.status, down.body.speak, down.body.reason], [503, "local", "unavailable"]);
  assert.deepEqual(calls.slice(2).map(c => c.provider), ["deepinfra"]);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM voice_replies").get().n, 1);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_holds").get().n, 0, "its hold went back");
  failing.clear();

  // A voice is Willo's or a character's people and gender (site/tests/character-voices.test.mjs), and a reply is at
  // most 600 letters across its pieces.
  assert.equal((await speak({ text: "Lok'tar ogar.", voice: "Orc Male!" })).status, 400);
  assert.equal((await speak({ text: "a".repeat(600), reply: "reply-0002" })).status, 200);
  const more = await speak({ text: "And more.", reply: "reply-0002" });
  assert.deepEqual([more.status, more.body.reason], [413, "long"]);
  assert.equal((await speak({ text: "a".repeat(601) })).status, 400);
});

test("Legend: Inworld's finest voice for the first replies of its plan month, then Chatterbox until the renewal", async () => {
  const { user, speak, voice, saidBest } = await companionPlayer("legend", "legend");
  await saidBest(LEGEND_BEST_PER_MONTH - 1);
  const finest = await speak({ text: "Strength and honor.", reply: "reply-best" });
  assert.equal(finest.status, 200);
  assert.deepEqual(finest.body, MP3, "Inworld's streamed chunks, joined");
  assert.deepEqual([calls[0].provider, calls[0].headers.Authorization, calls[0].body.voiceId, calls[0].body.modelId,
                    calls[0].body.audioConfig], ["inworld", "Basic iw-test", "willo-finest", LEGEND_BEST_MODEL,
                    { audioEncoding: "MP3" }]);
  assert.equal(LEGEND_BEST_MODEL, "inworld-tts-2-flash");
  assert.equal(await userSpend(env, user.id, new Date(), { total: true }), 15 * "Strength and honor.".length,
    "TTS 2 Flash: $15 a million letters");
  assert.equal((await speak({ text: "The rest of it.", reply: "reply-best" })).status, 200);
  assert.equal(calls[1].provider, "inworld", "a reply keeps its voice");
  assert.deepEqual(await voice(), { tier: "hosted", top: "finest", now: "studio", back: "2026-10-31T12:00:00.000Z",
                                    choice: true, bestLeft: 0 }, "the studio voice until the plan month renews");
  assert.equal((await speak({ text: "Then the studio voice.", reply: "reply-next" })).status, 200);
  assert.equal(calls[2].provider, "deepinfra");

  // Inworld down for a finest reply: the studio voice says it, all of it, and it isn't one of the month's finest.
  env.DB.sqlite.exec("DELETE FROM voice_replies");
  failing.add("inworld");
  assert.equal((await speak({ text: "Still heard.", reply: "reply-down" })).status, 200);
  assert.deepEqual(calls.slice(3).map(c => c.provider), ["inworld", "deepinfra"]);
  assert.equal((await voice()).bestLeft, LEGEND_BEST_PER_MONTH, "only a reply Inworld said counts");
  assert.equal((await speak({ text: "Its second piece.", reply: "reply-down" })).status, 200);
  assert.deepEqual(calls.slice(5).map(c => c.provider), ["deepinfra"], "the rest of it stays in the studio voice");
  // Inworld said a reply's first piece and fails on the next: still one finest reply.
  failing.clear();
  assert.equal((await speak({ text: "Strength.", reply: "reply-mixed" })).status, 200);
  failing.add("inworld");
  assert.equal((await speak({ text: "And honor.", reply: "reply-mixed" })).status, 200);
  assert.deepEqual(calls.slice(6).map(c => c.provider), ["inworld", "inworld", "deepinfra"]);
  assert.equal((await voice()).bestLeft, LEGEND_BEST_PER_MONTH - 1, "one reply, one count");
});

test("the free plan's first replies in the studio voice, paid by the shared free budget; then its answers are text", async () => {
  const { user, speak, voice } = await companionPlayer("newcomer");
  for (const text of ["Welcome, traveler.", "The rest of it."])
    assert.equal((await speak({ text, reply: "starter-01" })).status, 200);
  assert.deepEqual(calls.map(c => [c.provider, c.body.voice_id]), [["deepinfra", "willo-studio"], ["deepinfra", "willo-studio"]]);
  const said = "Welcome, traveler.The rest of it.".length;
  assert.equal(await answerBudgetUsed(env), said, "the free budget pays for it");
  assert.equal(await userSpend(env, user.id, new Date(), { total: true }), 0);
  assert.equal((await voice()).starterLeft, STARTER_ANSWERS - 1, "two pieces, one reply");
  // A reply nothing could say isn't one of them, and its cost goes back.
  failing.add("deepinfra");
  assert.equal((await speak({ text: "Nobody hears this.", reply: "starter-lost" })).status, 503);
  failing.clear();
  assert.deepEqual([(await voice()).starterLeft, await answerBudgetUsed(env)], [STARTER_ANSWERS - 1, said]);
  // The last one, then text: nothing more is said, here or on the PC.
  const add = env.DB.sqlite.prepare("INSERT INTO voice_replies (user_id, reply, period, pieces, heard, created) " +
    "VALUES (?, ?, 'starter', 1, 1, ?)");
  for (let i = 2; i < STARTER_ANSWERS; i++) add.run(user.id, `starter-${i}`, new Date(NOW).toISOString());
  assert.equal((await speak({ text: "The last one.", reply: "starter-30" })).status, 200);
  const after = await allowance(env, user.id);
  assert.deepEqual([after.voice.starterLeft, after.voice.tier, after.features.voices], [0, "local", "none"]);
  const more = await speak({ text: "One more?", reply: "starter-31" });
  assert.deepEqual([more.status, more.body.reason], [402, "spent"]);
});

test("the voice steps down, finest to studio to the PC, before a month would cost more than the plan brings", async () => {
  const { user, speak, voice, spent } = await companionPlayer("legend", "legend");
  const net = PLANS.legend.totalCapMicro;   // $18.41
  assert.deepEqual([PLANS.legend.costCapMicro, net, PLANS.champion.costCapMicro, PLANS.champion.totalCapMicro,
                    PLANS.hero.costCapMicro], [9_200_000, 18_410_000, 4_520_000, 9_050_000, 2_180_000],
    "answers may cost half the net, answers and voice the whole net");
  // Room for a whole studio reply (600 letters at $1 a million) but not a finest one ($15): the studio voice, back
  // when the calendar month turns.
  spent(9_000_000, net - 9_000_000 - 5_000);
  assert.deepEqual([(await voice()).now, (await voice()).back], ["studio", "2026-11-01T00:00:00.000Z"]);
  assert.equal((await speak({ text: "Hail, champion." })).status, 200);
  assert.deepEqual(calls.map(c => c.provider), ["deepinfra"]);
  // No room for a whole studio reply: Willo's voice on the PC, and nothing is spent past the net.
  spent(9_000_000, net - 9_000_000 - 500);
  assert.deepEqual([(await voice()).tier, (await voice()).now], ["local", "everyday"]);
  const out = await speak({ text: "Hail." });
  assert.deepEqual([out.status, out.body.speak, out.body.reason], [402, "local", "spent"]);
  assert.equal(calls.length, 1);
  assert.ok(await userSpend(env, user.id, new Date(), { total: true }) <= net);
  assert.equal(await overTextCap(env, user.id, await planFor(env, user.id)), false,
    "the voice's cost never takes the answers away");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM voice_replies").get().n, 1, "the reply nothing said is gone");
});

test("Willo's tips in the voice its replies get, costing what a reply would but never counted as one", async () => {
  const tip = "Westfall was farmland once, before the Defias came.";
  // The free plan's starter: a tip in the studio voice on the shared free budget, never one of its 30. After it: text.
  const free = await companionPlayer("newcomer");
  assert.equal((await free.speak({ text: tip, line: true })).voice, "studio:sprite");
  assert.deepEqual([(await free.voice()).starterLeft, await answerBudgetUsed(env)], [STARTER_ANSWERS, tip.length]);
  const add = env.DB.sqlite.prepare("INSERT INTO voice_replies (user_id, reply, period, pieces, heard, created) " +
    "VALUES (?, ?, 'starter', 1, 1, ?)");
  for (let i = 0; i < STARTER_ANSWERS; i++) add.run(free.user.id, `starter-${i}`, new Date(NOW).toISOString());
  const after = await free.speak({ text: tip, line: true });
  assert.deepEqual([after.status, after.body.reason, calls.length], [402, "spent", 1]);

  // Legend: the finest voice in the player's pick, on their month inside the total cap; the month's finest replies,
  // and its replies, don't move.
  calls.length = 0;
  const { user, speak, voice, spent } = await companionPlayer("legend", "legend");
  const said = await speak({ text: tip, line: true, pick: "moonwell" });
  assert.deepEqual([said.status, said.voice, calls[0].provider, calls[0].body.voiceId],
    [200, "finest:moonwell", "inworld", "humble-aspen-1573__design-voice-1a47e9a9"]);
  assert.equal(await userSpend(env, user.id, new Date(), { total: true }), 15 * tip.length);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM voice_replies WHERE user_id = ?").get(user.id).n, 0);
  assert.equal((await voice()).bestLeft, LEGEND_BEST_PER_MONTH);
  // The add-on's short answer read aloud (LOR-547) is a line too, but never in the finest voice: the studio one.
  const read = await speak({ text: tip, line: true, reading: true, pick: "moonwell" });
  assert.deepEqual([read.status, read.voice, calls.at(-1).provider], [200, "studio:moonwell", "deepinfra"]);
  // It steps down with the replies: no room for a whole finest reply, the studio voice; none for a studio one, the PC.
  const net = PLANS.legend.totalCapMicro;
  spent(9_000_000, net - 9_000_000 - 5_000);
  assert.deepEqual([(await speak({ text: tip, line: true })).voice, calls.at(-1).provider], ["studio:sprite", "deepinfra"]);
  spent(9_000_000, net - 9_000_000 - 500);
  const out = await speak({ text: tip, line: true });
  assert.deepEqual([out.status, out.body.reason, calls.length], [402, "spent", 3]);
});
