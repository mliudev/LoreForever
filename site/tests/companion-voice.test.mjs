// Willo's spoken replies (lib/companion-voice.js, functions/api/companion/speak.js, LOR-490): which voice says each
// plan's answers, a reply counted once across its pieces, Legend's finest voice for its first replies of the month,
// the voice stepping down (finest, studio, the PC) before a month would cost more than the plan brings or when a
// provider fails, a reply nothing could say given back, and the hosted voice's cost apart from the text cap. Gemini and
// the voice providers are mocked through fetch; D1 is node:sqlite (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { onRequest as speakApi } from "../functions/api/companion/speak.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { setupBilling, planFor, poolWindow, userSpend, capState, PLANS, LEGEND_BEST_PER_MONTH, LEGEND_BEST_MODEL,
  STARTER_ANSWERS } from "../lib/billing.js";
import { allowance, answerBudgetUsed } from "../lib/companion-answers.js";
import { willoPick, hostedSpellings, AZEROTH_STUDIO, AZEROTH_PICKS } from "../lib/companion-voice.js";
import { CHARACTER_VOICES } from "../lib/character-voices.js";

import { d1, assets } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const NOW = Date.parse("2026-10-11T12:00:00Z");
// The names respelled for the voices, as the site ships them (pipeline/lore/site_lore.py hosted_respellings).
const HOSTED = JSON.parse(readFileSync(new URL("../public/lore/data/respell-hosted.json", import.meta.url), "utf8"));
const env = { DB: d1(), GEMINI_API_KEY: "test-key", SITE_FEATURES: "plans", DEEPINFRA_API_KEY: "di-test",
              INWORLD_API_KEY: "iw-test", ASSETS: assets({ "/lore/data/respell-hosted.json": HOSTED }),
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
                       "entitlements", "answer_user_spend", "answer_packs", "answer_holds", "starter_claims", "voice_replies",
                       "best_first", "best_first_days"])
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
             body: type.startsWith("audio/") ? Buffer.from(await res.arrayBuffer()) : res.status === 204 ? null : await res.json() };
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
  // Their first answers at Willo's best (lib/best-first.js): `used` of the 20 answered, `voices` finest replies owed.
  const tasted = (used = 20, voices = 0) => env.DB.sqlite.prepare("INSERT OR REPLACE INTO best_first (claim, user_id, " +
    "used, voices) VALUES (?, ?, ?, ?)").run(`taste:test-${user.id}`, user.id, used, voices);
  return { user, speak, voice, saidBest, spent, tasted };
}

test("who says each plan's answers: the studio voice for Free's first ones and Hero, Champion's choice, Legend's finest", async () => {
  const free = await companionPlayer("free"), hero = await companionPlayer("hero", "hero");
  const champion = await companionPlayer("champ", "champion"), legend = await companionPlayer("legend", "legend");
  const studio = { tier: "hosted", top: "studio", now: "studio", choice: false };
  assert.deepEqual(await free.voice(), { ...studio, now: "finest", starterLeft: STARTER_ANSWERS },
    "its first answers at Willo's best (below)");
  free.tasted();
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

test("Voices of Azeroth (LOR-609): Champion and Legend may pick a people's voice as Willo's; NPCs keep their own", async () => {
  const champion = await companionPlayer("champ", "champion"), legend = await companionPlayer("legend", "legend");
  const hero = await companionPlayer("hero", "hero");
  const idOf = async (player, body) => {
    const said = await player.speak({ text: "Lok'tar ogar.", ...body });
    assert.equal(said.status, 200);
    return [calls.at(-1).provider, calls.at(-1).body.voice_id ?? calls.at(-1).body.voiceId, said.voice];
  };
  assert.equal(AZEROTH_PICKS.length, 22);
  // Champion's studio voice: the slot's Chatterbox clone; Legend's finest: its Inworld clone, the same reference.
  assert.deepEqual(await idOf(champion, { pick: "dwarf-male" }), ["deepinfra", AZEROTH_STUDIO["dwarf-male"], null]);
  assert.deepEqual(await idOf(legend, { pick: "nightelf-female" }),
    ["inworld", CHARACTER_VOICES["nightelf-female"].inworld, null]);
  // Her own lines in the borrowed voice too, kept by the companion under its name.
  assert.deepEqual(await idOf(champion, { pick: "orc-female", line: true, text: "Westfall was farmland once." }),
    ["deepinfra", AZEROTH_STUDIO["orc-female"], "studio:orc-female"]);
  // Her male partners (LOR-610) are her own picks too, in both voices.
  assert.deepEqual((await idOf(champion, { pick: "puck" })).slice(0, 2), ["deepinfra", "rbo1dwi5xclqs2rgluhk"]);
  assert.deepEqual((await idOf(legend, { pick: "kestrel" })).slice(0, 2),
    ["inworld", "humble-aspen-1573__design-voice-b10f5442"]);
  // Hero has no choice, and a slot that isn't one of ours is no pick: Sprite.
  assert.deepEqual((await idOf(hero, { pick: "dwarf-male" })).slice(0, 2), ["deepinfra", "willo-studio"]);
  assert.deepEqual((await idOf(champion, { pick: "kobold-male" })).slice(0, 2), ["deepinfra", "willo-studio"]);
  assert.equal(willoPick({ voice: { voice: "chatterbox", choice: true } }, "troll-male"), "troll-male");
  assert.equal(willoPick({ voice: { voice: "chatterbox", choice: false } }, "troll-male"), "sprite");
  // An orc who answers in person keeps an orc's own voice, whatever Willo borrows (LOR-477).
  assert.deepEqual((await idOf(champion, { voice: "orc-male", pick: "dwarf-female" })).slice(0, 2),
    ["inworld", CHARACTER_VOICES["orc-male"].inworld]);
  // A slot whose rights aren't cleared any more is never said, for Willo either: Sprite instead.
  env.CHARACTER_VOICES = JSON.stringify({ "dwarf-male": { ...CHARACTER_VOICES["dwarf-male"], provenance: "a trailer" } });
  try {
    assert.deepEqual((await idOf(champion, { pick: "dwarf-male" })).slice(0, 2), ["deepinfra", "willo-studio"]);
  } finally { delete env.CHARACTER_VOICES; }
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
  // Inworld said a reply's first piece and fails on the next: no studio voice mid-reply (LOR-596), the piece fails
  // so the companion asks again and then shows captions; asked again once Inworld is back, Inworld says it. Still
  // one finest reply.
  failing.clear();
  assert.equal((await speak({ text: "Strength.", reply: "reply-mixed" })).status, 200);
  failing.add("inworld");
  const lost = await speak({ text: "And honor.", reply: "reply-mixed" });
  assert.deepEqual([lost.status, lost.body.reason], [503, "unavailable"]);
  failing.clear();
  assert.equal((await speak({ text: "And honor.", reply: "reply-mixed" })).status, 200);
  assert.deepEqual(calls.slice(6).map(c => c.provider), ["inworld", "inworld", "inworld"]);
  assert.equal((await voice()).bestLeft, LEGEND_BEST_PER_MONTH - 1, "one reply, one count");
});

test("a reply stays in the voice that said its first piece, when room runs short or pieces come at once", async () => {
  const { speak, spent } = await companionPlayer("legend", "legend");
  const net = PLANS.legend.totalCapMicro;
  // Room for one whole finest reply and a little: its first piece takes some of it, and the rest of the reply,
  // which the room held from the start, is still Inworld's.
  spent(9_000_000, net - 9_000_000 - 600 * 15 - 50);
  for (const text of ["Strength.", "And honor, always."])
    assert.equal((await speak({ text, reply: "reply-tight" })).status, 200);
  assert.deepEqual(calls.map(c => c.provider), ["inworld", "inworld"]);

  // The companion asks for the next piece while the first is on its way. Inworld fails the first after the second
  // has started in Inworld: the first can't go to the studio voice, so it fails too (the companion says the reply
  // on the PC), and nothing of the reply is ever in two hosted voices.
  env.DB.sqlite.exec("DELETE FROM answer_user_spend");
  calls = [];
  let open, waiting = 0;
  const gate = new Promise(resolve => { open = resolve; });
  const mocked = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (new URL(url).hostname !== "api.inworld.ai") return mocked(url, options);
    waiting++;
    await gate;
    if (JSON.parse(options.body).text !== "Lok'tar.") return mocked(url, options);
    calls.push({ provider: "inworld" });
    return new Response("overloaded", { status: 503 });
  };
  const until = async ok => { for (let i = 0; i < 500 && !ok(); i++) await new Promise(setImmediate); assert.ok(ok()); };
  const first = speak({ text: "Lok'tar.", reply: "reply-both" });
  await until(() => waiting === 1);
  const second = speak({ text: "Victory or death.", reply: "reply-both" });
  await until(() => waiting === 2);
  open();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual([a.status, b.status], [503, 200]);
  assert.deepEqual(calls.map(c => c.provider), ["inworld", "inworld"], "never the studio voice");
});

test("the free plan's first replies in the studio voice, paid by the shared free budget; then its answers are text", async () => {
  const { user, speak, voice, tasted } = await companionPlayer("newcomer");
  tasted();
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
  assert.notEqual(await capState(env, user.id, await planFor(env, user.id)), "capped",
    "the voice's cost never takes the answers away");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM voice_replies").get().n, 1, "the reply nothing said is gone");
});

test("Willo's tips in the voice its replies get, costing what a reply would but never counted as one", async () => {
  const tip = "Westfall was farmland once, before the Defias came.";
  // The free plan's starter: a tip in the studio voice on the shared free budget, never one of its 30. After it: text.
  const free = await companionPlayer("newcomer");
  free.tasted();
  assert.equal((await free.speak({ text: tip, line: true })).voice, "studio:sprite");
  assert.deepEqual([(await free.voice()).starterLeft, await answerBudgetUsed(env)], [STARTER_ANSWERS, tip.length]);
  // A reading (the add-on's answer read aloud) during the starter: the PC's, the shared free budget untouched.
  const freeRead = await free.speak({ text: tip, line: true, reading: true });
  assert.deepEqual([freeRead.status, freeRead.body.reason, calls.length, await answerBudgetUsed(env)],
    [402, "reading", 1, tip.length]);
  const add =env.DB.sqlite.prepare("INSERT INTO voice_replies (user_id, reply, period, pieces, heard, created) " +
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
  // The add-on's short answer read aloud (LOR-547) is always the PC's (Mike, 10/15): no provider, nothing spent.
  const asked = calls.length;
  const read = await speak({ text: tip, line: true, reading: true, pick: "moonwell" });
  assert.deepEqual([read.status, read.body.reason, calls.length], [402, "reading", asked]);
  assert.equal(await userSpend(env, user.id, new Date(), { total: true }), 15 * tip.length);
  // It steps down with the replies: no room for a whole finest reply, the studio voice; none for a studio one, the PC.
  const net = PLANS.legend.totalCapMicro;
  spent(9_000_000, net - 9_000_000 - 5_000);
  assert.deepEqual([(await speak({ text: tip, line: true })).voice, calls.at(-1).provider], ["studio:sprite", "deepinfra"]);
  spent(9_000_000, net - 9_000_000 - 500);
  const out = await speak({ text: tip, line: true });
  assert.deepEqual([out.status, out.body.reason, calls.length], [402, "spent", 2]);
});

test("a free player's first answers asked out loud are said in Willo's finest voice, on the taste's day cap", async () => {
  const { user, speak, voice, tasted } = await companionPlayer("newcomer");
  const day = () => env.DB.sqlite.prepare("SELECT replies, lines, capped, unreachable, spent_micro FROM best_first_days").get();
  const owed = () => env.DB.sqlite.prepare("SELECT voices FROM best_first WHERE user_id = ?").get(user.id).voices;
  // One spoken taste answer earned one finest reply (site/tests/billing.test.mjs): both its pieces in Inworld's Sprite,
  // paid from the shared free budget, never one of the starter's 30.
  tasted(1, 1);
  for (const text of ["Welcome, traveler.", "The rest of it."]) {
    const said = await speak({ text, reply: "taste-01" });
    assert.deepEqual([said.status, said.voice], [200, "finest:sprite"]);
  }
  const letters = "Welcome, traveler.The rest of it.".length;
  assert.deepEqual(calls.map(c => [c.provider, c.body.voiceId]), [["inworld", "willo-finest"], ["inworld", "willo-finest"]]);
  assert.deepEqual([owed(), (await voice()).starterLeft, await answerBudgetUsed(env)], [0, STARTER_ANSWERS, 15 * letters]);
  assert.deepEqual([day().replies, day().spent_micro], [1, 15 * letters]);
  // A reply no taste answer earned: the plan's own (the free starter's studio voice).
  assert.equal((await speak({ text: "Hello again.", reply: "plain-01" })).voice, null);
  assert.equal(calls.at(-1).provider, "deepinfra");
  // Inworld down: the studio voice says it, still the taste's; nothing can: its place goes back.
  tasted(2, 1);
  failing.add("inworld");
  assert.equal((await speak({ text: "Through the mist.", reply: "taste-02" })).voice, "studio:sprite");
  tasted(3, 1);
  failing.add("deepinfra");
  assert.equal((await speak({ text: "Nobody hears this.", reply: "taste-03" })).status, 503);
  failing.clear();
  assert.deepEqual([owed(), day().unreachable], [1, 1]);
  // Willo's own tip while the taste lasts: the finest voice, never one of its replies.
  const tip = await speak({ text: "Westfall was farmland once.", line: true });
  assert.deepEqual([tip.voice, owed(), day().lines], ["finest:sprite", 1, 1]);
  // The day's cap reached: the plan's own path, counted, and the finest reply kept for later.
  env.TASTE_DAY_USD = "0";
  try {
    assert.equal((await voice()).now, "studio");
    assert.equal((await speak({ text: "Later, then.", reply: "taste-04" })).voice, null);
    assert.equal(calls.at(-1).provider, "deepinfra");
    assert.deepEqual([owed(), day().capped], [1, 1]);
  } finally { delete env.TASTE_DAY_USD; }
  // All 20 answered and said: the free plan's own voice from then on.
  tasted(20, 0);
  assert.equal((await voice()).now, "studio");
  assert.equal((await speak({ text: "Westfall was farmland once.", line: true })).voice, "studio:sprite");
});

test("a piece asked for again counts its letters once, and a later piece's voice gets the time the companion waits", async () => {
  // LOR-673: the companion gave up on a slow later piece and asked again; the site had counted its letters when it
  // started, so the second ask counted them twice and a reply past about 300 letters was refused as too long (413),
  // the rest of it in captions. Each piece is numbered now, and counted once.
  const { user, speak } = await companionPlayer("again", "hero");
  const row = () => env.DB.sqlite.prepare("SELECT chars, pieces FROM voice_replies WHERE user_id = ? AND reply = 'long-reply'")
    .get(user.id);
  const first = "Thrall leads the Horde from Orgrimmar.", rest = "x".repeat(300);
  assert.equal((await speak({ text: first, reply: "long-reply", piece: 0 })).status, 200);
  assert.equal((await speak({ text: rest, reply: "long-reply", piece: 1 })).status, 200);
  const again = await speak({ text: rest, reply: "long-reply", piece: 1 });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.deepEqual({ ...row() }, { chars: first.length + rest.length, pieces: 2 });
  // Asked again and nothing can say it: the letters an earlier ask counted stay; the reply isn't given back.
  failing.add("deepinfra");
  assert.equal((await speak({ text: rest, reply: "long-reply", piece: 1 })).status, 503);
  failing.clear();
  assert.deepEqual({ ...row() }, { chars: first.length + rest.length, pieces: 2 });
  // A piece that couldn't be said the first time is counted when it's asked for again.
  failing.add("deepinfra");
  assert.equal((await speak({ text: "And Durotar.", reply: "long-reply", piece: 2 })).status, 503);
  failing.clear();
  assert.equal((await speak({ text: "And Durotar.", reply: "long-reply", piece: 2 })).status, 200);
  assert.deepEqual({ ...row() }, { chars: first.length + rest.length + "And Durotar.".length, pieces: 3 });
  assert.equal((await speak({ text: "y", reply: "long-reply", piece: 31 })).status, 400);
  // An older companion numbers nothing: each ask counts, as before.
  assert.equal((await speak({ text: rest + "!", reply: "old-reply" })).status, 200);
  assert.equal((await speak({ text: rest + "!", reply: "old-reply" })).body.reason, "long", "301 letters twice");

  // A later piece's voice may take longer than a first piece's 2.5 s (LATER_PIECE_MS); a first piece may not.
  const slow = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    await new Promise((done, stop) => {
      const t = setTimeout(done, 2700);
      options.signal?.addEventListener("abort", () => { clearTimeout(t); stop(options.signal.reason); });
    });
    return slow(url, options);
  };
  try {
    assert.equal((await speak({ text: "A slow first piece.", reply: "slow-reply", piece: 0 })).status, 503);
    globalThis.fetch = slow;
    assert.equal((await speak({ text: "Hello.", reply: "slow-two", piece: 0 })).status, 200);
    globalThis.fetch = async (url, options) => {
      await new Promise(done => setTimeout(done, 2700));
      return slow(url, options);
    };
    assert.equal((await speak({ text: "A slow later piece.", reply: "slow-two", piece: 1 })).status, 200);
  } finally { globalThis.fetch = slow; }
});

test("a reply the companion gave up on before its first piece came back gives back its place, not what it cost", async () => {
  // LOR-673: the companion waits PIECE_WAIT for a reply's first piece, then says the whole reply in Willo's own voice on
  // the PC; the piece it gave up on was still said and counted here, so a player lost a finest reply they never heard.
  env.UNHEARD_SETTLE_MS = "0";
  try {
    const legend = await companionPlayer("legend-late", "legend");
    await legend.saidBest(LEGEND_BEST_PER_MONTH - 1);
    assert.equal((await legend.speak({ text: "Strength and honor.", reply: "reply-late" })).status, 200);
    assert.equal((await legend.voice()).bestLeft, 0);
    const cost = await userSpend(env, legend.user.id, new Date(), { total: true });
    assert.deepEqual(await legend.speak({ reply: "reply-late", unheard: true }), { status: 204, type: "", voice: null, body: null });
    assert.equal((await legend.voice()).bestLeft, 1, "the finest reply is back");
    assert.equal(await userSpend(env, legend.user.id, new Date(), { total: true }), cost, "what it cost stays counted");
    await legend.speak({ reply: "reply-late", unheard: true });
    assert.equal((await legend.voice()).bestLeft, 1, "given back once");
    assert.equal((await legend.speak({ reply: "not a reply id!", unheard: true })).status, 400);

    // The free plan's starter, and a new player's finest reply (best first): each back where it came from.
    const free = await companionPlayer("free-late");
    assert.equal((await free.speak({ text: "Welcome, traveler.", reply: "starter-late" })).status, 200);
    assert.equal((await free.voice()).starterLeft, STARTER_ANSWERS - 1);
    await free.speak({ reply: "starter-late", unheard: true });
    assert.equal((await free.voice()).starterLeft, STARTER_ANSWERS);
    free.tasted(1, 1);
    assert.equal((await free.speak({ text: "Welcome, traveler.", reply: "taste-late" })).voice, "finest:sprite");
    const owed = () => env.DB.sqlite.prepare("SELECT voices FROM best_first WHERE user_id = ?").get(free.user.id).voices;
    assert.equal(owed(), 0);
    await free.speak({ reply: "taste-late", unheard: true });
    assert.equal(owed(), 1, "the finest reply her taste answer earned is owed again");

    // Only a reply from the last couple of minutes: the app says so the moment it gives up.
    assert.equal((await legend.speak({ text: "Long ago.", reply: "reply-old" })).status, 200);
    env.DB.sqlite.prepare("UPDATE voice_replies SET created = ? WHERE reply = 'reply-old'").run(new Date(NOW - 600e3).toISOString());
    const before = (await legend.voice()).bestLeft;
    await legend.speak({ reply: "reply-old", unheard: true });
    assert.equal((await legend.voice()).bestLeft, before);
  } finally { delete env.UNHEARD_SETTLE_MS; }
});

test("names are sent to the providers respelled so they're said right (LOR-653); every other word is as written", async () => {
  // The line players heard wrong: "Dun Morogh" came out "Dunmarogue" and "Arathi" was corrected by a player.
  for (const name of ["Dun Morogh", "Arathi", "Teldrassil"]) assert.ok(HOSTED[name], `${name} is in the shipped list`);
  const text = "Deneb Walker is in Stromgarde Keep in the Arathi Highlands, past Dun Morogh. Teldrassil's far.";
  const said = text.replace("Dun Morogh", HOSTED["Dun Morogh"]).replace("Arathi", HOSTED.Arathi)
    .replace("Teldrassil", HOSTED.Teldrassil);
  assert.notEqual(said, text);

  // Chatterbox (a Champion's reply), Inworld (a Legend's finest), and one of Willo's own lines in that voice.
  const champion = await companionPlayer("champ", "champion"), legend = await companionPlayer("legend", "legend");
  assert.equal((await champion.speak({ text, reply: "reply-names" })).status, 200);
  assert.equal((await legend.speak({ text, reply: "reply-names" })).status, 200);
  assert.equal((await legend.speak({ text, line: true })).status, 200);
  assert.deepEqual(calls.map(c => [c.provider, c.body.text]), [["deepinfra", said], ["inworld", said], ["inworld", said]]);

  // A deploy without the list (a missing file is the site's home page, not a 404) sends the text as written.
  const home = { ASSETS: { fetch: async () => new Response("<!doctype html><title>Lore Forever</title>") } };
  assert.deepEqual(await hostedSpellings(home, ORIGIN), {});
});
