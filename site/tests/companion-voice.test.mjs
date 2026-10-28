// Willo's spoken replies (lib/companion-voice.js, functions/api/companion/speak.js, LOR-490): which voice says each
// plan's answers (Free's studio voice, Hero's and Champion's finest, Legend's richer), a reply counted once across its
// pieces, the finest voice for a plan month's replies, the voice stepping down (finest, studio, the PC) before a month
// would cost more than the plan brings or when a
// provider fails, a reply nothing could say given back, and the hosted voice's cost apart from the text cap. Gemini and
// the voice providers are mocked through fetch; D1 is node:sqlite (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { onRequest as speakApi } from "../functions/api/companion/speak.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { setupBilling, planFor, poolWindow, userSpend, capState, PLANS, PLAN_VOICE, LEGEND_BEST_PER_MONTH,
  RICHER_MODEL, STARTER_ANSWERS } from "../lib/billing.js";
import { allowance, answerBudgetUsed } from "../lib/companion-answers.js";
import { cutAtSentence } from "../lib/quest-pages.js";
import { willoPick, hostedSpellings, AZEROTH_STUDIO, AZEROTH_PICKS, WILLO_PICKS, picksFor, NARRATOR_STUDIO, readsAloud,
  replyMax, WHOLE_MAX_CHARS, SPEAK_MAX_CHARS, readsQuests } from "../lib/companion-voice.js";
import { TRIAL, TASTE_ANSWERS, TRIAL_DAYS } from "../lib/best-first.js";
import { CHARACTER_VOICES } from "../lib/character-voices.js";

import { d1, assets } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const NOW = Date.parse("2026-10-11T12:00:00Z");
// The names respelled for the voices, as the site ships them (pipeline/lore/site_lore.py hosted_respellings).
const HOSTED = JSON.parse(readFileSync(new URL("../public/lore/data/respell-hosted.json", import.meta.url), "utf8"));
// A few quest pages as the site ships them (pipeline/lore/site_lore.py quest_pages: quest-pages/<id // 100>.json). 1001 is
// a dwarf man's, with a night elf woman taking it in; 1002 a note nobody speaks; 1003 a giver whose people we have no
// voice for; 1101 a page past SPEAK_MAX_CHARS.
const LONG = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} of a very long page, said at some length.`).join(" ");
const QUEST_PAGES = {
  "/lore/data/quest-pages/10.json": {
    "1001": { d: ["Bring me three boar tusks, friend. They're troubling the farm.", "dwarf-male"],
              p: ["Have you the tusks?", "dwarf-male"], c: ["The farm is safe, thanks to you.", "nightelf-female"] },
    "1002": { d: ["A weathered note: the vault lies under the old mill.", null] },
    "1003": { d: ["Mind the pit, friend.", "draenei-male"] } },
  "/lore/data/quest-pages/11.json": { "1101": { d: [LONG, "orc-male"] } },
};
const env = { DB: d1(), GEMINI_API_KEY: "test-key", SITE_FEATURES: "plans", DEEPINFRA_API_KEY: "di-test",
              INWORLD_API_KEY: "iw-test", ASSETS: assets({ "/lore/data/respell-hosted.json": HOSTED, ...QUEST_PAGES }),
              HOSTED_VOICES: JSON.stringify({ willo: { deepinfra: "willo-studio", inworld: "willo-finest" } }) };
const originalFetch = globalThis.fetch;
// Two made-up MP3 halves: Inworld streams them as two chunks, DeepInfra sends them whole.
const MP3 = Buffer.from("ID3\x04\x00\x00fake-mp3-frames", "latin1");
let calls, failing;

beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  await setup(env);
  await setupBilling(env);
  for (const table of ["users", "sessions", "devices", "device_links", "rate_limits", "answer_spend", "free_pool_days", "story_spend",
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
             ...(res.headers.has("X-LF-Text") ? { text: decodeURIComponent(res.headers.get("X-LF-Text")) } : {}),
             body: type.startsWith("audio/") ? Buffer.from(await res.arrayBuffer()) : res.status === 204 ? null : await res.json() };
  };
  // The response itself, for one read as it comes.
  const call = body => speakApi({ env, request: new Request(ORIGIN + "/api/companion/speak", { method: "POST", headers,
    body: JSON.stringify({ voice: "willo", ...body }) }) });
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
  // Their first answers at Willo's best (lib/best-first.js): `used` of the 20 answered, `voices` finest replies owed,
  // the first `daysAgo` (null: the first-run trial's days not started yet; past TRIAL_DAYS: over).
  const tasted = (used = TASTE_ANSWERS, voices = 0, daysAgo = null) => env.DB.sqlite.prepare("INSERT OR REPLACE INTO best_first " +
    "(claim, user_id, used, voices, started) VALUES (?, ?, ?, ?, ?)").run(`taste:test-${user.id}`, user.id, used, voices,
    daysAgo === null ? null : new Date(NOW - daysAgo * 86400e3).toISOString());
  return { user, speak, call, voice, saidBest, spent, tasted };
}

// Every plan hears her whole answer since 10/21 (PLAN_VOICE whole, replies to WHOLE_MAX_CHARS); a test of the
// SPEAK_MAX_CHARS cap a reply had before turns it off for its plans, put back when it ends.
function shortReplies(t, ...ids) {
  const was = ids.map(id => PLAN_VOICE[id].whole);
  for (const id of ids) PLAN_VOICE[id].whole = false;
  t.after(() => ids.forEach((id, i) => { PLAN_VOICE[id].whole = was[i]; }));
}

// A Champion whose plan month's finest replies are all said: its Willo voice is the studio one until the renewal.
async function tiredChampion(sub) {
  const champion = await companionPlayer(sub, "champion");
  await champion.saidBest(3000);
  return champion;
}

// The free plan as it was before 10/19: a spoken starter of STARTER_ANSWERS replies, counted for good, then text
// (PLAN_VOICE.free.starter). No plan has one now, but speakPiece, speakLine and voiceAllowance still do, so a test
// that calls this runs with that voice config in place of the real free plan's (always: the studio voice on every
// spoken answer), put back when it ends.
function freeStarter(t) {
  const real = PLAN_VOICE.free;
  PLAN_VOICE.free = { voice: "chatterbox", choice: false, starter: true };
  t.after(() => { PLAN_VOICE.free = real; });
}

test("her first sound goes back as soon as her finest voice sends it, not once the whole piece is made (LOR-856 E4)", async () => {
  const hero = await companionPlayer("e4-hero", "hero");
  let release;
  const rest = new Promise(r => { release = r; });
  const half = MP3.length >> 1;
  const line = part => new TextEncoder().encode(JSON.stringify({ result: { audioContent: part.toString("base64") } }) + "\n");
  globalThis.fetch = async () => new Response(new ReadableStream({ async start(c) {
    c.enqueue(line(MP3.subarray(0, half)));
    await rest;                                  // the rest of the piece isn't made until the first sound is back
    c.enqueue(line(MP3.subarray(half)));
    c.close();
  } }));
  const res = await Promise.race([hero.call({ text: "Edwin VanCleef leads the Defias.", reply: "reply-stream", piece: 0 }),
    new Promise((_, no) => setTimeout(() => no(new Error("no audio until the whole piece was made")), 2000))]);
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const first = await reader.read();
  assert.deepEqual(Buffer.from(first.value), MP3.subarray(0, half));
  release();
  const chunks = [first.value];
  for (let r = await reader.read(); !r.done; r = await reader.read()) chunks.push(r.value);
  assert.deepEqual(Buffer.concat(chunks), MP3);
});

test("who says each plan's answers: Free's studio voice, Hero's finest, Champion's finest by choice, Legend's richer", async () => {
  const free = await companionPlayer("free"), hero = await companionPlayer("hero", "hero");
  const champion = await companionPlayer("champ", "champion"), legend = await companionPlayer("legend", "legend");
  // azeroth, whole, readings (the voices and plans picks, 10/21): the Voices of Azeroth in her picker and her whole
  // answer spoken are Legend's (and the trial tries Legend's voices); the narrator reads short answers from Hero up.
  // npcReadings: quest pages with no recording in the giver's voice (speakQuestPage): Champion and up, and the trial.
  const plain = { azeroth: false, whole: true, readings: false, npcReadings: false, pick: "sprite" };
  const studio = { tier: "hosted", top: "studio", now: "studio", choice: false, ...plain };
  const finest = { tier: "hosted", top: "finest", now: "finest", ...plain, readings: true };
  assert.deepEqual(await free.voice(), { ...studio, now: "finest", choice: true, azeroth: true, readings: true,
    starterLeft: 0 },
    "its first answers at Willo's best (below), her voice picked from all of hers in its first-run trial's days");
  free.tasted(TASTE_ANSWERS, 0, 15);
  assert.deepEqual(await free.voice(), { ...studio, starterLeft: 0 }, "the studio voice always: no starter to count down");
  assert.deepEqual(await hero.voice(), { ...finest, choice: false, bestLeft: 1500 });
  assert.deepEqual(await champion.voice(), { ...finest, choice: true, npcReadings: true, bestLeft: 3000 });
  assert.deepEqual(await legend.voice(), { ...finest, choice: true, azeroth: true, whole: true, npcReadings: true,
                                           bestLeft: LEGEND_BEST_PER_MONTH });
  assert.equal(LEGEND_BEST_PER_MONTH, 6000);
  // The free plan asks out loud, and those questions are answered aloud (below) in the studio voice, at any time of
  // the month; typed questions get text (Mike, 2026-10-14; always, Mike, 2026-10-19).
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

test("Hero's and Champion's finest voice is Inworld TTS 2 Flash, Legend's the richer TTS 2; past the month's finest replies, the studio voice", async () => {
  const hero = await companionPlayer("hero", "hero"), champion = await companionPlayer("champ", "champion");
  const legend = await companionPlayer("legend", "legend");
  const text = "Strength and honor.";
  for (const [player, model, perLetter] of [[hero, "inworld-tts-2-flash", 15], [champion, "inworld-tts-2-flash", 15],
                                           [legend, RICHER_MODEL, 25]]) {
    assert.equal((await player.speak({ text, reply: "reply-one", pick: "moonwell" })).status, 200);
    assert.deepEqual([calls.at(-1).provider, calls.at(-1).body.modelId], ["inworld", model]);
    assert.equal(await userSpend(env, player.user.id, new Date(), { total: true }), perLetter * text.length);
  }
  assert.equal(RICHER_MODEL, "inworld-tts-2");
  assert.deepEqual(calls.map(c => c.body.voiceId), ["willo-finest", "humble-aspen-1573__design-voice-1a47e9a9",
    "humble-aspen-1573__design-voice-1a47e9a9"], "Hero has no choice (Sprite); Champion and Legend: Moonwell's finest");
  // Every Hero reply is the finest one, counted on the plan month: the 1,500th is the last, then the studio voice.
  assert.equal((await hero.voice()).bestLeft, 1499);
  await hero.saidBest(1498);
  assert.equal((await hero.speak({ text, reply: "reply-last" })).status, 200);
  assert.equal(calls.at(-1).provider, "inworld");
  assert.equal((await hero.speak({ text, reply: "reply-after" })).status, 200);
  assert.equal(calls.at(-1).provider, "deepinfra");
  assert.deepEqual([(await hero.voice()).now, (await hero.voice()).bestLeft], ["studio", 0]);
});

test("Willo speaks as Sprite; Champion and Legend in the voice the player picks, Sprite for an unknown one", async () => {
  const champion = await companionPlayer("champ", "champion"), legend = await companionPlayer("legend", "legend");
  const tired = await tiredChampion("tired");
  const idOf = async (player, pick) => {
    assert.equal((await player.speak({ text: "Lok'tar ogar.", ...(pick ? { pick } : {}) })).status, 200);
    return calls.at(-1).body.voice_id ?? calls.at(-1).body.voiceId;
  };
  assert.equal(await idOf(champion), "willo-finest", "no pick: Sprite, the Pages variable's willo ids");
  assert.equal(await idOf(champion, "moonwell"), "humble-aspen-1573__design-voice-1a47e9a9", "Moonwell's finest voice");
  // Once the month's finest replies are said, the studio voice in the same pick.
  assert.equal(await idOf(tired), "willo-studio", "no pick: Sprite, the Pages variable's willo ids");
  assert.equal(await idOf(tired, "moonwell"), "1lm6bxrwur1pipen43ce", "Moonwell's studio voice, the code's id");
  assert.equal(await idOf(tired, "gloomshade"), "willo-studio");
  assert.equal(await idOf(legend, "fenlight"), "humble-aspen-1573__design-voice-22a59081", "Fenlight's finest voice");
  // A hosted voice on a plan without a choice is always Sprite.
  assert.equal(willoPick({ voice: { voice: "chatterbox", choice: false } }, "moonwell"), "sprite");
});

test("Voices of Azeroth (LOR-609): Legend may pick a people's voice as Willo's, Champion picks her own; NPCs keep their own", async () => {
  const champion = await companionPlayer("champ", "champion"), legend = await companionPlayer("legend", "legend");
  const hero = await companionPlayer("hero", "hero"), tired = await companionPlayer("tired", "legend");
  await tired.saidBest(6000);
  const tiredChamp = await tiredChampion("tired-champ");
  const idOf = async (player, body) => {
    const said = await player.speak({ text: "Lok'tar ogar.", ...body });
    assert.equal(said.status, 200);
    return [calls.at(-1).provider, calls.at(-1).body.voice_id ?? calls.at(-1).body.voiceId, said.voice];
  };
  assert.equal(AZEROTH_PICKS.length, 22);
  // The finest voice (Legend's): the slot's Inworld clone. A Legend whose month's finest replies are said has the
  // studio voice: the slot's Chatterbox clone, the same reference.
  assert.deepEqual(await idOf(legend, { pick: "dwarf-male" }), ["inworld", CHARACTER_VOICES["dwarf-male"].inworld, null]);
  assert.deepEqual(await idOf(tired, { pick: "dwarf-male" }), ["deepinfra", AZEROTH_STUDIO["dwarf-male"], null]);
  assert.deepEqual(await idOf(legend, { pick: "nightelf-female" }),
    ["inworld", CHARACTER_VOICES["nightelf-female"].inworld, null]);
  // Her own lines in the borrowed voice too, kept by the companion under its name.
  assert.deepEqual(await idOf(tired, { pick: "orc-female", line: true, text: "Westfall was farmland once." }),
    ["deepinfra", AZEROTH_STUDIO["orc-female"], "studio:orc-female"]);
  assert.deepEqual(await idOf(legend, { pick: "orc-female", line: true, text: "Westfall was farmland once." }),
    ["inworld", CHARACTER_VOICES["orc-female"].inworld, "finest:orc-female"]);
  // The Voices of Azeroth are Legend's (the voices and plans picks, 10/21): Champion's pick of one is Sprite.
  assert.deepEqual((await idOf(champion, { pick: "dwarf-male" })).slice(0, 2), ["inworld", "willo-finest"]);
  assert.deepEqual((await idOf(tiredChamp, { pick: "dwarf-male" })).slice(0, 2), ["deepinfra", "willo-studio"]);
  // Her male partners (LOR-610) are her own picks, Champion's too, in both voices.
  assert.deepEqual((await idOf(tiredChamp, { pick: "puck" })).slice(0, 2), ["deepinfra", "rbo1dwi5xclqs2rgluhk"]);
  assert.deepEqual((await idOf(champion, { pick: "kestrel" })).slice(0, 2),
    ["inworld", "humble-aspen-1573__design-voice-b10f5442"]);
  // Hero has no choice, and a slot that isn't one of ours is no pick: Sprite.
  assert.deepEqual((await idOf(hero, { pick: "dwarf-male" })).slice(0, 2), ["inworld", "willo-finest"]);
  assert.deepEqual((await idOf(tired, { pick: "kobold-male" })).slice(0, 2), ["deepinfra", "willo-studio"]);
  assert.deepEqual((await idOf(legend, { pick: "kobold-male" })).slice(0, 2), ["inworld", "willo-finest"]);
  assert.equal(willoPick({ voice: { voice: "chatterbox", choice: true, azeroth: true } }, "troll-male"), "troll-male");
  assert.equal(willoPick({ voice: { voice: "chatterbox", choice: true } }, "troll-male"), "sprite");
  assert.equal(willoPick({ voice: { voice: "chatterbox", choice: true } }, "puck"), "puck");
  assert.equal(willoPick({ voice: { voice: "chatterbox", choice: false } }, "troll-male"), "sprite");
  // What the companion is offered: the Voices of Azeroth only on Legend, her own ten on Champion, five to an old app.
  const now = "companion/0.22.0";
  assert.equal(picksFor(now, { voice: PLAN_VOICE.legend }).length, 32);
  assert.deepEqual(picksFor(now, { voice: PLAN_VOICE.champion }), Object.keys(WILLO_PICKS));
  assert.equal(picksFor("companion/0.19.0", { voice: PLAN_VOICE.legend }).length, 5);
  // An orc who answers in person keeps an orc's own voice, whatever Willo borrows (LOR-477).
  assert.deepEqual((await idOf(legend, { voice: "orc-male", pick: "dwarf-female" })).slice(0, 2),
    ["inworld", CHARACTER_VOICES["orc-male"].inworld]);
  // A slot whose rights aren't cleared any more is never said, for Willo either: Sprite instead.
  env.CHARACTER_VOICES = JSON.stringify({ "dwarf-male": { ...CHARACTER_VOICES["dwarf-male"], provenance: "a trailer" } });
  try {
    assert.deepEqual((await idOf(tired, { pick: "dwarf-male" })).slice(0, 2), ["deepinfra", "willo-studio"]);
    assert.deepEqual((await idOf(legend, { pick: "dwarf-male" })).slice(0, 2), ["inworld", "willo-finest"]);
  } finally { delete env.CHARACTER_VOICES; }
});

test("Champion past its month's finest replies: every reply in Chatterbox, counted once across its pieces, its cost apart from the text cap", async (t) => {
  shortReplies(t, "champion");
  const { user, speak } = await tiredChampion("champ");
  const earlier = "SELECT COUNT(*) AS n FROM voice_replies WHERE reply NOT LIKE 'earlier-%'";
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
  assert.equal(env.DB.sqlite.prepare(earlier).get().n, 1, "two pieces, one reply");

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
  assert.equal(env.DB.sqlite.prepare(earlier).get().n, 1);
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

test("Legend: Inworld's richer voice for the 6,000 replies of its plan month, then Chatterbox until the renewal", async () => {
  const { user, speak, voice, saidBest } = await companionPlayer("legend", "legend");
  await saidBest(LEGEND_BEST_PER_MONTH - 1);
  const finest = await speak({ text: "Strength and honor.", reply: "reply-best" });
  assert.equal(finest.status, 200);
  assert.deepEqual(finest.body, MP3, "Inworld's streamed chunks, joined");
  assert.deepEqual([calls[0].provider, calls[0].headers.Authorization, calls[0].body.voiceId, calls[0].body.modelId,
                    calls[0].body.audioConfig], ["inworld", "Basic iw-test", "willo-finest", RICHER_MODEL,
                    { audioEncoding: "MP3" }]);
  assert.equal(RICHER_MODEL, "inworld-tts-2");
  assert.equal(await userSpend(env, user.id, new Date(), { total: true }), 25 * "Strength and honor.".length,
    "TTS 2: $25 a million letters");
  assert.equal((await speak({ text: "The rest of it.", reply: "reply-best" })).status, 200);
  assert.equal(calls[1].provider, "inworld", "a reply keeps its voice");
  assert.deepEqual(await voice(), { tier: "hosted", top: "finest", now: "studio", back: "2026-10-31T12:00:00.000Z",
                                    choice: true, azeroth: true, whole: true, readings: true, npcReadings: true, pick: "sprite", bestLeft: 0 },
                   "the studio voice until the plan month renews");
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
  spent(9_000_000, net - 9_000_000 - WHOLE_MAX_CHARS * 25 - 50);
  for (const text of ["Strength.", "And honor, always."])
    assert.equal((await speak({ text, reply: "reply-tight" })).status, 200);
  assert.deepEqual(calls.map(c => c.provider), ["inworld", "inworld"]);

  // The companion asks for the next piece while the first is on its way. Inworld fails the first after the second
  // has started in Inworld: the first can't go to the studio voice, so it fails too (the companion says the reply
  // on the PC), and nothing of the reply is ever in two hosted voices.
  env.DB.sqlite.exec("DELETE FROM answer_user_spend");
  calls = [];
  let open, arrived = () => {}, waiting = 0;
  const gate = new Promise(resolve => { open = resolve; });
  const mocked = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (new URL(url).hostname !== "api.inworld.ai") return mocked(url, options);
    waiting++;
    arrived();
    await gate;
    if (JSON.parse(options.body).text !== "Lok'tar.") return mocked(url, options);
    calls.push({ provider: "inworld" });
    return new Response("overloaded", { status: 503 });
  };
  // Each piece is waited for until it reaches Inworld (not for a number of event-loop turns: the way there is async
  // work of its own, which a busy runner can take longer over), or fails the test if it answers without asking.
  const send = async body => {
    const there = new Promise(resolve => { arrived = resolve; });
    const piece = speak(body);
    await Promise.race([there, piece.then(r => assert.fail(`answered ${r.status} without asking Inworld`))]);
    return { piece };        // (wrapped: an async function returning the promise itself would wait for its answer)
  };
  const { piece: first } = await send({ text: "Lok'tar.", reply: "reply-both" });
  assert.equal(waiting, 1);
  const { piece: second } = await send({ text: "Victory or death.", reply: "reply-both" });
  assert.equal(waiting, 2);
  open();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual([a.status, b.status], [503, 200]);
  assert.deepEqual(calls.map(c => c.provider), ["inworld", "inworld"], "never the studio voice");
});

test("the free plan's replies are all in the studio voice, counted by the calendar month and paid by the shared free budget: no starter to run out", async (t) => {
  const { user, speak, voice, tasted } = await companionPlayer("newcomer");
  tasted(TASTE_ANSWERS, 0, 15);
  const plan = await planFor(env, user.id);
  for (const text of ["Welcome, traveler.", "The rest of it."])
    assert.equal((await speak({ text, reply: "free-reply-01" })).status, 200);
  assert.deepEqual(calls.map(c => [c.provider, c.body.voice_id]), [["deepinfra", "willo-studio"], ["deepinfra", "willo-studio"]]);
  const said = "Welcome, traveler.The rest of it.".length;
  assert.equal(await answerBudgetUsed(env), said, "the free budget pays for it");
  assert.equal(await userSpend(env, user.id, new Date(), { total: true }), 0);
  const rows = () => env.DB.sqlite.prepare("SELECT reply, period, pieces FROM voice_replies WHERE user_id = ?").all(user.id)
    .map(r => ({ ...r }));
  assert.deepEqual(rows(), [{ reply: "free-reply-01", period: "2026-10-01", pieces: 2 }], "two pieces, one reply, on the calendar month");
  assert.equal(poolWindow(plan).key, "2026-10-01");
  // More than the old starter's 30, and still spoken; nothing counts down, and the PC is never asked to stand in.
  for (let i = 2; i <= STARTER_ANSWERS + 2; i++) assert.equal((await speak({ text: "Again.", reply: `free-reply-${i}` })).status, 200);
  assert.equal(rows().length, STARTER_ANSWERS + 2);
  const after = await allowance(env, user.id);
  assert.deepEqual([after.voice.starterLeft, after.voice.tier, after.features.voices, after.features.push_to_talk],
    [0, "hosted", "default", true]);
  // A reply nothing could say isn't kept, and its cost goes back.
  const used = await answerBudgetUsed(env);
  failing.add("deepinfra");
  assert.equal((await speak({ text: "Nobody hears this.", reply: "free-reply-lost" })).status, 503);
  failing.clear();
  assert.deepEqual([rows().length, await answerBudgetUsed(env)], [STARTER_ANSWERS + 2, used]);
  // The shared free budget spent: the PC says it, as it does for every free spoken answer then.
  env.STORY_BUDGET_USD = "0";
  try {
    const spent = await speak({ text: "No budget left.", reply: "free-reply-spent" });
    assert.deepEqual([spent.status, spent.body.reason], [402, "spent"]);
  } finally { delete env.STORY_BUDGET_USD; }
  // A new calendar month starts the count again; the old month's replies are gone.
  t.mock.timers.setTime(Date.parse("2026-11-02T12:00:00Z"));
  assert.equal((await speak({ text: "A new month.", reply: "free-reply-nov" })).status, 200);
  assert.deepEqual(rows().map(r => [r.reply, r.period]), [["free-reply-nov", "2026-11-01"]]);
});

test("the voice steps down, finest to studio to the PC, before a month would cost more than the plan brings", async () => {
  const { user, speak, voice, spent } = await companionPlayer("legend", "legend");
  const net = PLANS.legend.totalCapMicro;   // $18.41
  assert.deepEqual([PLANS.legend.costCapMicro, net, PLANS.champion.costCapMicro, PLANS.champion.totalCapMicro,
                    PLANS.hero.costCapMicro], [9_200_000, 18_410_000, 4_520_000, 9_050_000, 2_180_000],
    "answers may cost half the net, answers and voice the whole net");
  // Room for a whole studio reply (600 letters at $1 a million) but not a finest one ($25): the studio voice, back
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
  // The free plan: a tip in the studio voice on the shared free budget, never one of its replies.
  const free = await companionPlayer("newcomer");
  free.tasted();
  assert.equal((await free.speak({ text: tip, line: true })).voice, "studio:sprite");
  assert.deepEqual([(await free.voice()).starterLeft, await answerBudgetUsed(env),
    env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM voice_replies WHERE user_id = ?").get(free.user.id).n], [0, tip.length, 0]);
  // A reading (the add-on's answer read aloud): the PC's, the shared free budget untouched.
  const freeRead = await free.speak({ text: tip, line: true, reading: true });
  assert.deepEqual([freeRead.status, freeRead.body.reason, calls.length, await answerBudgetUsed(env)],
    [402, "reading", 1, tip.length]);

  // Legend: the finest voice in the player's pick, on their month inside the total cap; the month's finest replies,
  // and its replies, don't move.
  calls.length = 0;
  const { user, speak, voice, spent } = await companionPlayer("legend", "legend");
  const said = await speak({ text: tip, line: true, pick: "moonwell" });
  assert.deepEqual([said.status, said.voice, calls[0].provider, calls[0].body.voiceId],
    [200, "finest:moonwell", "inworld", "humble-aspen-1573__design-voice-1a47e9a9"]);
  assert.equal(await userSpend(env, user.id, new Date(), { total: true }), 25 * tip.length);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM voice_replies WHERE user_id = ?").get(user.id).n, 0);
  assert.equal((await voice()).bestLeft, LEGEND_BEST_PER_MONTH);
  // The add-on's short answer read aloud (LOR-547) is always the PC's (Mike, 10/15): no provider, nothing spent.
  const asked = calls.length;
  const read = await speak({ text: tip, line: true, reading: true, pick: "moonwell" });
  assert.deepEqual([read.status, read.body.reason, calls.length], [402, "reading", asked]);
  assert.equal(await userSpend(env, user.id, new Date(), { total: true }), 25 * tip.length);
  // It steps down with the replies: no room for a whole finest reply, the studio voice; none for a studio one, the PC.
  const net = PLANS.legend.totalCapMicro;
  spent(9_000_000, net - 9_000_000 - 5_000);
  // (Sent without a pick, the one this account last sent: Moonwell, above.)
  assert.deepEqual([(await speak({ text: tip, line: true })).voice, calls.at(-1).provider], ["studio:moonwell", "deepinfra"]);
  spent(9_000_000, net - 9_000_000 - 500);
  const out = await speak({ text: tip, line: true });
  assert.deepEqual([out.status, out.body.reason, calls.length], [402, "spent", 2]);
});

test("a free player's first answers asked out loud are said in Willo's finest voice, on the taste's day cap", async () => {
  const { user, speak, voice, tasted } = await companionPlayer("newcomer");
  const day = () => env.DB.sqlite.prepare("SELECT replies, lines, capped, unreachable, spent_micro FROM best_first_days").get();
  const owed = () => env.DB.sqlite.prepare("SELECT voices FROM best_first WHERE user_id = ?").get(user.id).voices;
  // One spoken taste answer earned one finest reply (site/tests/billing.test.mjs): both its pieces in Inworld's Sprite,
  // paid from the shared free budget, never among the plan month's replies.
  tasted(1, 1);
  for (const text of ["Welcome, traveler.", "The rest of it."]) {
    const said = await speak({ text, reply: "taste-01" });
    assert.deepEqual([said.status, said.voice], [200, "finest:sprite"]);
  }
  const letters = "Welcome, traveler.The rest of it.".length;
  assert.deepEqual(calls.map(c => [c.provider, c.body.voiceId]), [["inworld", "willo-finest"], ["inworld", "willo-finest"]]);
  assert.deepEqual([owed(), await answerBudgetUsed(env)], [0, day().spent_micro], "on the taste's own cap, inside the free pool");
  assert.deepEqual(env.DB.sqlite.prepare("SELECT DISTINCT period FROM voice_replies").all().map(r => r.period), ["taste"]);
  assert.deepEqual([day().replies, day().spent_micro], [1, 15 * letters]);
  // A reply no taste answer earned: the plan's own (the free plan's studio voice).
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
  tasted(TASTE_ANSWERS, 0);
  assert.equal((await voice()).now, "studio");
  assert.equal((await speak({ text: "Westfall was farmland once.", line: true })).voice, "studio:sprite");
});

test("a new player's first-run trial: her voice from all of hers, and characters in their own voices a few times", async (t) => {
  // Mike, 2026-10-19: "the best voice models and all the features that Willow has to offer for a limited time, like a
  // limited number of uses for just about everything" (lib/best-first.js TRIAL).
  const { user, speak, voice, tasted } = await companionPlayer("trier");
  const tries = () => JSON.parse(env.DB.sqlite.prepare("SELECT tries FROM best_first WHERE user_id = ?").get(user.id).tries || "{}");
  const owed = () => env.DB.sqlite.prepare("SELECT voices FROM best_first WHERE user_id = ?").get(user.id).voices;
  const idOf = said => [said.status, calls.at(-1).provider, calls.at(-1).body.voiceId ?? calls.at(-1).body.voice_id, said.voice];
  tasted(3, 3, 1);
  assert.equal((await voice()).choice, true, "the companion offers all of her voices");
  // Willo's finest reply in the voice they picked (Inworld's Moonwell), at the price of Sprite's.
  assert.deepEqual(idOf(await speak({ text: "Welcome, traveler.", reply: "pick-001", pick: "moonwell" })),
    [200, "inworld", WILLO_PICKS.moonwell.inworld, "finest:moonwell"]);
  // A character who answers in person: their own voice, one of the trial's, and the finest reply it was owed.
  assert.deepEqual(idOf(await speak({ text: "Lok'tar.", voice: "orc-male", reply: "orc-0001" })),
    [200, "inworld", CHARACTER_VOICES["orc-male"].inworld, "finest:orc-male"]);
  assert.deepEqual([tries(), owed()], [{ cast: 1 }, 1]);
  // The trial's character voices used: Willo's finest voice says the character's reply, from what the taste owes.
  env.DB.sqlite.prepare("UPDATE best_first SET tries = ? WHERE user_id = ?").run(JSON.stringify({ cast: TRIAL.cast }), user.id);
  // (In the voice they last picked, Moonwell: lib/plan-usage.js savedPick.)
  assert.deepEqual(idOf(await speak({ text: "Strength and honor.", voice: "orc-male", reply: "orc-0002" })),
    [200, "inworld", WILLO_PICKS.moonwell.inworld, "finest:moonwell"]);
  assert.equal(owed(), 0);
  // The taste's finest replies all said, one of the trial's still left: a character's own voice from it alone.
  env.DB.sqlite.prepare("UPDATE best_first SET used = ?, tries = ? WHERE user_id = ?")
    .run(TASTE_ANSWERS, JSON.stringify({ cast: TRIAL.cast - 1 }), user.id);
  assert.deepEqual(idOf(await speak({ text: "For the Horde.", voice: "orc-male", reply: "orc-0003" })),
    [200, "inworld", CHARACTER_VOICES["orc-male"].inworld, "finest:orc-male"]);
  assert.deepEqual(tries(), { cast: TRIAL.cast });
  // Nothing could say it: the trial's place goes back.
  env.DB.sqlite.prepare("UPDATE best_first SET tries = ? WHERE user_id = ?").run(JSON.stringify({ cast: TRIAL.cast - 1 }), user.id);
  failing.add("inworld"); failing.add("deepinfra");
  assert.equal((await speak({ text: "Nobody hears this.", voice: "orc-male", reply: "orc-0004" })).status, 503);
  failing.clear();
  assert.deepEqual(tries(), { cast: TRIAL.cast - 1 });
  // The plan's own path in the trial's days (the free plan's studio voice): still the voice they picked.
  assert.deepEqual(idOf(await speak({ text: "Hello again.", reply: "plain-001", pick: "moonwell" })),
    [200, "deepinfra", WILLO_PICKS.moonwell.deepinfra, null]);
  // The trial's days over: Sprite, and characters in Willo's voice, as the free plan's.
  t.mock.timers.setTime(NOW + 7 * 86400e3);
  assert.equal((await voice()).choice, false);
  assert.deepEqual(idOf(await speak({ text: "Hello once more.", reply: "plain-002", pick: "moonwell" })),
    [200, "deepinfra", "willo-studio", null]);
});

test("a piece asked for again counts its letters once, and a later piece's voice gets the time the companion waits", async (t) => {
  shortReplies(t, "hero");
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
  failing.add("inworld"); failing.add("deepinfra");   // Hero's finest voice, then the studio voice
  assert.equal((await speak({ text: rest, reply: "long-reply", piece: 1 })).status, 503);
  failing.clear();
  assert.deepEqual({ ...row() }, { chars: first.length + rest.length, pieces: 2 });
  // A piece that couldn't be said the first time is counted when it's asked for again.
  failing.add("inworld"); failing.add("deepinfra");
  assert.equal((await speak({ text: "And Durotar.", reply: "long-reply", piece: 2 })).status, 503);
  failing.clear();
  assert.equal((await speak({ text: "And Durotar.", reply: "long-reply", piece: 2 })).status, 200);
  assert.deepEqual({ ...row() }, { chars: first.length + rest.length + "And Durotar.".length, pieces: 3 });
  assert.equal((await speak({ text: "y", reply: "long-reply", piece: 31 })).status, 400);
  // An older companion numbers nothing: each ask counts, as before.
  assert.equal((await speak({ text: rest + "!", reply: "old-reply" })).status, 200);
  assert.equal((await speak({ text: rest + "!", reply: "old-reply" })).body.reason, "long", "301 letters twice");

  // A later piece's voice may take longer than a first piece's 3.5 s (PROVIDER_MS, LATER_PIECE_MS); a first piece
  // may not.
  const slow = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    await new Promise((done, stop) => {
      const t = setTimeout(done, 3700);
      options.signal?.addEventListener("abort", () => { clearTimeout(t); stop(options.signal.reason); });
    });
    return slow(url, options);
  };
  try {
    assert.equal((await speak({ text: "A slow first piece.", reply: "slow-reply", piece: 0 })).status, 503);
    globalThis.fetch = slow;
    assert.equal((await speak({ text: "Hello.", reply: "slow-two", piece: 0 })).status, 200);
    globalThis.fetch = async (url, options) => {
      await new Promise(done => setTimeout(done, 3700));
      return slow(url, options);
    };
    assert.equal((await speak({ text: "A slow later piece.", reply: "slow-two", piece: 1 })).status, 200);
  } finally { globalThis.fetch = slow; }
});

test("a reply the companion gave up on before its first piece came back gives back its place, not what it cost", async (t) => {
  // LOR-673: the companion waits PIECE_WAIT for a reply's first piece, then says the whole reply in Willo's own voice on
  // the PC; the piece it gave up on was still said and counted here, so a player lost a finest reply they never heard.
  // The free plan's spoken starter (a place also goes back to it) is no plan's now, so the free player below has it put back.
  freeStarter(t);
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

  // Chatterbox (a free player's reply), Inworld (a Legend's finest), and one of Willo's own lines in that voice.
  const free = await companionPlayer("free"), legend = await companionPlayer("legend", "legend");
  free.tasted(TASTE_ANSWERS, 0, 15);
  assert.equal((await free.speak({ text, reply: "reply-names" })).status, 200);
  assert.equal((await legend.speak({ text, reply: "reply-names" })).status, 200);
  assert.equal((await legend.speak({ text, line: true })).status, 200);
  assert.deepEqual(calls.map(c => [c.provider, c.body.text]), [["deepinfra", said], ["inworld", said], ["inworld", said]]);

  // A deploy without the list (a missing file is the site's home page, not a 404) sends the text as written.
  const home = { ASSETS: { fetch: async () => new Response("<!doctype html><title>Lore Forever</title>") } };
  assert.deepEqual(await hostedSpellings(home, ORIGIN), {});
});

test("short answers in the narrator's voice (the 10/21 picks): Hero and up, the studio engine, never an answer counted", async () => {
  const hero = await companionPlayer("hero-reads", "hero"), legend = await companionPlayer("legend-reads", "legend");
  const free = await companionPlayer("free-reads");
  const text = "Thrall chose this land because its red earth reminded the orcs of Draenor.";
  const read = await hero.speak({ text, reading: true, narrator: "chronicler" });
  assert.equal(read.status, 200);
  assert.equal(read.voice, "studio:chronicler");
  assert.deepEqual(read.body, MP3);
  assert.equal(calls.at(-1).provider, "deepinfra");
  assert.equal(calls.at(-1).body.voice_id, NARRATOR_STUDIO.chronicler);
  assert.equal((await legend.speak({ text, reading: true, narrator: "female" })).voice, "studio:female");
  assert.equal(calls.at(-1).body.voice_id, NARRATOR_STUDIO.female);
  // Not an answer: no reply counted; what it cost is on the player's month.
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM voice_replies").get().n, 0);
  assert.equal(env.DB.sqlite.prepare("SELECT voice_micro FROM answer_user_spend WHERE user_id = ?").get(hero.user.id)
    .voice_micro, text.length);
  // The free plan's first-run trial hears them too (the PM, 10/21: "try everything" means everything), on the shared
  // free budget, not the player's month; after its days, Free sees short answers as text.
  assert.equal((await free.speak({ text, reading: true, narrator: "chronicler" })).voice, "studio:chronicler");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_user_spend WHERE user_id = ?").get(free.user.id).n, 0);
  free.tasted(TASTE_ANSWERS, 0, 15);
  // A narrator that isn't ours (a community narrator is never copied) is no reading.
  const before = calls.length;
  assert.deepEqual((await free.speak({ text, reading: true, narrator: "chronicler" })).body,
    { ok: false, speak: "local", reason: "plan" });
  assert.equal((await hero.speak({ text, reading: true, narrator: "kael-community" })).body.reason, "narrator");
  // An older companion's reading as one of Willo's lines is still said on the PC.
  assert.equal((await hero.speak({ text, line: true, reading: true })).body.reason, "reading");
  assert.equal(calls.length, before, "none of those reached a provider");
  // The studio voice down: text, and nothing held on the month.
  failing.add("deepinfra");
  assert.equal((await hero.speak({ text, reading: true, narrator: "chronicler" })).body.reason, "unavailable");
  failing.delete("deepinfra");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_holds").get().n, 0);
  // Past the plan's net for the month: text.
  hero.spent(PLANS.hero.totalCapMicro);
  assert.equal((await hero.speak({ text, reading: true, narrator: "chronicler" })).body.reason, "spent");
  // NARRATOR_VOICES replaces an id.
  env.NARRATOR_VOICES = JSON.stringify({ female: "new-female" });
  try {
    await legend.speak({ text, reading: true, narrator: "female" });
    assert.equal(calls.at(-1).body.voice_id, "new-female");
  } finally { delete env.NARRATOR_VOICES; }
  assert.equal(readsAloud(PLANS.free), false);
  assert.equal(readsAloud({ ...PLANS.hero, voice: PLAN_VOICE.hero }), true);
});

test("quest pages with no recording: the giver's people and gender in the studio voice, a narrator for a book (Champion and up)", async () => {
  const champion = await companionPlayer("champ-quest", "champion"), legend = await companionPlayer("legend-quest", "legend");
  const read = (who, quest, narrator = "chronicler", more = {}) => who.speak({ reading: true, quest, narrator, ...more });
  // A dwarf man gives the quest: the studio clone of his reference (the one the recorded packs use), and the words the
  // site has, sent back for the captions.
  const given = await read(champion, "quest:1001#detail");
  assert.deepEqual([given.status, given.voice, given.body], [200, "studio:dwarf-male", MP3]);
  assert.equal(given.text, "Bring me three boar tusks, friend. They're troubling the farm.");
  assert.deepEqual([calls.at(-1).provider, calls.at(-1).body.voice_id, calls.at(-1).body.text], ["deepinfra",
    AZEROTH_STUDIO["dwarf-male"], given.text]);
  // The progress is his too; the completion is a night elf woman's, whatever narrator the player has.
  assert.equal((await read(champion, "quest:1001#progress", "female")).voice, "studio:dwarf-male");
  const done = await read(legend, "quest:1001#complete", "female");
  assert.deepEqual([done.voice, calls.at(-1).body.voice_id], ["studio:nightelf-female", AZEROTH_STUDIO["nightelf-female"]]);
  // A note nobody speaks is the narrator at the top of the player's list; a giver of a people we have no voice for too.
  assert.deepEqual([(await read(champion, "quest:1002#detail")).voice, calls.at(-1).body.voice_id],
    ["studio:chronicler", NARRATOR_STUDIO.chronicler]);
  assert.deepEqual([(await read(legend, "quest:1002#detail", "female")).voice, calls.at(-1).body.voice_id],
    ["studio:female", NARRATOR_STUDIO.female]);
  assert.deepEqual([(await read(legend, "quest:1003#detail", "female")).voice, calls.at(-1).body.voice_id],
    ["studio:female", NARRATOR_STUDIO.female]);
  assert.equal(calls.every(c => c.provider === "deepinfra"), true, "the studio engine only");
  // Not an answer: no reply counted. Its cost, the studio engine's $1 a million letters, is on the player's month.
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM voice_replies").get().n, 0);
  assert.equal(env.DB.sqlite.prepare("SELECT voice_micro FROM answer_user_spend WHERE user_id = ?").get(champion.user.id).voice_micro,
    "Bring me three boar tusks, friend. They're troubling the farm.".length + "Have you the tusks?".length
      + "A weathered note: the vault lies under the old mill.".length);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_holds").get().n, 0);
  // Counted in the plan's usage as readings, by who said them.
  assert.deepEqual(env.DB.sqlite.prepare("SELECT said, replies FROM voice_days WHERE kind = 'reading' AND user_id = ? ORDER BY said")
    .all(champion.user.id).map(r => [r.said, r.replies]), [["studio:chronicler", 1], ["studio:dwarf-male", 2]]);
  // The Pages variables change a voice without a code change: HOSTED_VOICES for a slot, NARRATOR_VOICES for a narrator.
  env.HOSTED_VOICES = JSON.stringify({ "dwarf-male": { deepinfra: "new-dwarf" }, willo: { deepinfra: "willo-studio", inworld: "willo-finest" } });
  try {
    await read(champion, "quest:1001#detail");
    assert.equal(calls.at(-1).body.voice_id, "new-dwarf");
  } finally { env.HOSTED_VOICES = JSON.stringify({ willo: { deepinfra: "willo-studio", inworld: "willo-finest" } }); }
});

test("quest pages: Hero and Free get the plan's text, a narrator that isn't ours or an unknown page get none, the studio voice down is text", async () => {
  const hero = await companionPlayer("hero-quest", "hero"), free = await companionPlayer("free-quest");
  const champion = await companionPlayer("champ-quest2", "champion");
  const read = (who, quest, narrator = "chronicler") => who.speak({ reading: true, quest, narrator });
  // Characters' own voices are Champion's: Hero reads short answers aloud but not quest pages, Free neither.
  assert.deepEqual((await read(hero, "quest:1001#detail")).body, { ok: false, speak: "local", reason: "plan" });
  assert.deepEqual((await read(free, "quest:1001#detail")).body, { ok: false, speak: "local", reason: "plan" });
  assert.equal((await champion.speak({ reading: true, quest: "quest:1001#detail", narrator: "kael-community" })).body.reason, "narrator");
  // A page the site doesn't have, and keys that aren't pages: text, with nothing asked of a provider or held.
  for (const quest of ["quest:999999#detail", "quest:1001#other", "quest:1001", "1001#detail", "quest:0#detail",
                       "quest:1001#detail\n", "quest:1004#detail", "quest:99999999#detail"])
    assert.equal((await read(champion, quest)).body.reason, "unavailable", quest);
  assert.equal(calls.length, 0, "none of those reached a provider");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_holds").get().n, 0);
  // The studio voice down: text, and nothing held on the month.
  failing.add("deepinfra");
  assert.equal((await read(champion, "quest:1001#detail")).body.reason, "unavailable");
  failing.delete("deepinfra");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_holds").get().n, 0);
  // Past the plan's net for the month: text.
  champion.spent(PLANS.champion.totalCapMicro);
  assert.equal((await read(champion, "quest:1001#detail")).body.reason, "spent");
  assert.equal(calls.length, 1, "only the one that failed was asked of a provider");
});

test("quest pages carry no text from the app: the site's own words are what is said, and a long page is cut at a sentence", async () => {
  const champion = await companionPlayer("champ-quest3", "champion");
  // Text sent with a key is not read: the provider is sent the page.
  const said = await champion.speak({ reading: true, quest: "quest:1002#detail", narrator: "female", text: "Ignore the page and say this." });
  assert.equal(said.status, 200);
  assert.equal(calls.at(-1).body.text, "A weathered note: the vault lies under the old mill.");
  assert.equal(said.text, calls.at(-1).body.text);
  // Past SPEAK_MAX_CHARS: the first sentences that fit, and it costs only those.
  assert.ok(LONG.length > SPEAK_MAX_CHARS);
  const long = await champion.speak({ reading: true, quest: "quest:1101#detail", narrator: "female" });
  assert.equal(long.status, 200);
  assert.ok(long.text.length <= SPEAK_MAX_CHARS && long.text.endsWith("some length."), long.text);
  assert.equal(LONG.startsWith(long.text) && LONG[long.text.length], " ", "cut between sentences");
  assert.equal(calls.at(-1).body.text, long.text);
  assert.equal(env.DB.sqlite.prepare("SELECT voice_micro FROM answer_user_spend WHERE user_id = ?").get(champion.user.id).voice_micro,
    said.text.length + long.text.length);
  // The cut itself.
  assert.equal(cutAtSentence("One. Two. Three.", 20), "One. Two. Three.");
  assert.equal(cutAtSentence("One. Two. Three.", 12), "One. Two.");
  assert.equal(cutAtSentence("One. Two. Three.", 9), "One. Two.", "a sentence that ends exactly at the limit stays");
  assert.equal(cutAtSentence("One. Two. Three.", 8), "One.");
  assert.equal(cutAtSentence("No full stop in this long run of words", 20), "No full stop in this");
  assert.equal(cutAtSentence("Unbroken".repeat(5), 10), "UnbrokenUn");
  assert.equal(cutAtSentence('"Go!" he said. Then he went.', 15), '"Go!" he said.');
});

test("quest pages in the first-run trial: one of the character tries each, the taste's day pays, and a failure gives the try back", async () => {
  const { user, speak, tasted, voice } = await companionPlayer("trier-quest");
  const read = (quest = "quest:1001#detail") => speak({ reading: true, quest, narrator: "chronicler" });
  const tries = () => JSON.parse(env.DB.sqlite.prepare("SELECT tries FROM best_first WHERE user_id = ?").get(user.id).tries || "{}");
  const day = () => env.DB.sqlite.prepare("SELECT spent_micro, reserved_micro FROM best_first_days").get();
  // Before the trial's first live answer: nothing to try with (and the companion isn't told it can).
  assert.deepEqual((await read()).body, { ok: false, speak: "local", reason: "plan" });
  assert.equal((await voice()).npcReadings, false);
  tasted(TASTE_ANSWERS, 0, 1);
  assert.equal((await voice()).npcReadings, true);
  const first = await read();
  assert.deepEqual([first.status, first.voice, calls.at(-1).body.voice_id], [200, "studio:dwarf-male", AZEROTH_STUDIO["dwarf-male"]]);
  assert.deepEqual(tries(), { cast: 1 });
  // On the taste's day, inside the free pool (lib/free-pool.js), never a player's month.
  const letters = first.text.length;
  assert.deepEqual([await answerBudgetUsed(env), day().spent_micro, day().reserved_micro], [letters, letters, letters]);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_user_spend").get().n, 0);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM voice_replies").get().n, 0);
  // The same page again is another try; a page the site doesn't have takes none.
  assert.equal((await read()).status, 200);
  assert.equal((await read("quest:999999#detail")).body.reason, "unavailable");
  assert.deepEqual(tries(), { cast: 2 });
  // Nothing could say it: the try goes back, and so does what was held.
  failing.add("deepinfra");
  assert.equal((await read()).body.reason, "unavailable");
  failing.delete("deepinfra");
  assert.deepEqual([tries(), day().reserved_micro], [{ cast: 2 }, 2 * letters]);
  // The day's cap reached: text, and the try goes back.
  env.TASTE_DAY_USD = "0";
  try {
    assert.equal((await read()).body.reason, "spent");
    assert.deepEqual(tries(), { cast: 2 });
  } finally { delete env.TASTE_DAY_USD; }
  // All the tries used (they are the characters' replies' too): text, and the companion is no longer told.
  env.DB.sqlite.prepare("UPDATE best_first SET tries = ? WHERE user_id = ?").run(JSON.stringify({ cast: TRIAL.cast }), user.id);
  assert.equal((await read()).body.reason, "plan");
  assert.equal((await voice()).npcReadings, false);
  // One left: the last, then none.
  env.DB.sqlite.prepare("UPDATE best_first SET tries = ? WHERE user_id = ?").run(JSON.stringify({ cast: TRIAL.cast - 1 }), user.id);
  assert.equal((await read()).status, 200);
  assert.equal((await read()).body.reason, "plan");
  // The trial's days over: text.
  env.DB.sqlite.prepare("UPDATE best_first SET tries = '{}' WHERE user_id = ?").run(user.id);
  tasted(TASTE_ANSWERS, 0, TRIAL_DAYS + 1);
  assert.equal((await read()).body.reason, "plan");
  assert.equal((await voice()).npcReadings, false);
});

test("quest pages: the allowance says who may ask (Champion and up, the trial), and Hero's free beta month tries them too", async () => {
  const hero = await companionPlayer("hero-flag", "hero"), champion = await companionPlayer("champ-flag", "champion");
  const legend = await companionPlayer("legend-flag", "legend"), free = await companionPlayer("free-flag");
  assert.deepEqual([hero, champion, legend, free].length, 4);
  assert.deepEqual(await Promise.all([hero, champion, legend, free].map(async p => (await p.voice()).npcReadings)),
    [false, true, true, false]);
  assert.equal(readsQuests({ voice: PLAN_VOICE.champion }), true);
  assert.equal(readsQuests({ voice: PLAN_VOICE.hero }), false);
  assert.equal(readsQuests({ voice: PLAN_VOICE.hero }, { claim: "c", on: true, left: { cast: 3 } }), true);
  assert.equal(readsQuests({ voice: PLAN_VOICE.hero }, { claim: "c", on: true, left: { cast: 0 } }), false);
  assert.equal(readsQuests({ voice: PLAN_VOICE.hero }, { claim: null, on: true, left: { cast: 20 } }), false,
    "a trial that hasn't started (no live answer yet) has no tries to take");
});

test("every plan hears her whole answer spoken (10/21): replies run to WHOLE_MAX_CHARS; without it, SPEAK_MAX_CHARS", async (t) => {
  shortReplies(t, "champion");
  const legend = await companionPlayer("legend-whole", "legend"), champion = await companionPlayer("champ-whole", "champion");
  const piece = "Thrall chose Durotar for its red earth, which reminded the orcs of Draenor, and named it for his father. "
    .repeat(3).slice(0, 300);
  for (let i = 0; i < 5; i++) {
    assert.equal((await legend.speak({ text: piece, reply: "reply-whole", piece: i })).status, 200, `Legend piece ${i}`);
  }
  assert.equal((await legend.speak({ text: piece, reply: "reply-whole", piece: 5 })).status, 413, "past 1,500 letters");
  assert.equal((await champion.speak({ text: piece, reply: "reply-short", piece: 0 })).status, 200);
  assert.equal((await champion.speak({ text: piece, reply: "reply-short", piece: 1 })).status, 200);
  assert.equal((await champion.speak({ text: piece, reply: "reply-short", piece: 2 })).status, 413, "past 600 letters");
  assert.equal(replyMax({ voice: PLAN_VOICE.legend }), WHOLE_MAX_CHARS);
  assert.equal(replyMax({ voice: PLAN_VOICE.champion }), SPEAK_MAX_CHARS);
  for (const id of ["free", "hero", "legend"]) assert.equal(replyMax({ voice: PLAN_VOICE[id] }), WHOLE_MAX_CHARS, id);
});

test("the voice an account last picked on its PC is remembered: a phone's speak without a pick hears it, within its plan", async () => {
  const legend = await companionPlayer("legend-pick", "legend");
  assert.equal((await legend.voice()).pick, "sprite", "none picked yet");
  assert.equal((await legend.speak({ text: "Hello.", reply: "reply-pc-01", pick: "dwarf-male" })).status, 200);
  assert.equal((await legend.voice()).pick, "dwarf-male");
  await legend.speak({ text: "Hello again.", reply: "reply-ph-01" });
  assert.equal(calls.at(-1).body.voiceId, CHARACTER_VOICES["dwarf-male"].inworld, "the phone hears the PC's pick");
  // The same pick on a plan without the Voices of Azeroth: Sprite, as willoPick allows.
  const champ = await companionPlayer("champ-pick", "champion");
  await champ.speak({ text: "Hello.", reply: "reply-pc-02", pick: "dwarf-male" });
  assert.equal((await champ.voice()).pick, "sprite");
  await champ.speak({ text: "Hello.", reply: "reply-pc-03", pick: "moonwell" });
  assert.equal((await champ.voice()).pick, "moonwell");
});

test("the last finest reply of a new player's first answers is said whole: its later pieces stay with it, never 'long'", async () => {
  // Mike's 0.25.0 QA (10/21): with his first answers' finest replies just used, the rest of a reply went to captions
  // ("long") and the next replies to the PC's voice. Once the taste was all said (tasteSaid), this isolate sent a reply's
  // later pieces down the plan's own path, which found the reply under the taste's period and called it too long.
  const { speak, tasted } = await companionPlayer("last-finest");
  tasted(TASTE_ANSWERS, 1, 1);
  const p = n => "Sten Stoutarm has a courier task for you, Coldridge Valley Mail Delivery, out by the road. ".slice(0, n);
  const said = [];
  for (const [i, t] of [[0, p(60)], [1, p(90)], [2, p(90)]])
    said.push(await speak({ text: t, reply: "last-0001", piece: i }));
  assert.deepEqual(said.map(r => [r.status, r.body?.reason]), [[200, undefined], [200, undefined], [200, undefined]]);
  assert.deepEqual(calls.slice(-3).map(c => c.provider), ["inworld", "inworld", "inworld"], "one voice, the finest");
  // The next reply: the plan's own (Free's studio voice), whole.
  for (const [i, t] of [[0, p(60)], [1, p(90)]])
    assert.equal((await speak({ text: t, reply: "next-0001", piece: i })).status, 200);
  assert.deepEqual(calls.slice(-2).map(c => c.provider), ["deepinfra", "deepinfra"]);
});
