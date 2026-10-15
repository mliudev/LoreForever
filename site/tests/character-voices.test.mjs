// Characters in a voice of their own (lib/character-voices.js, lib/companion-voice.js speakPiece): a reference whose
// provenance doesn't name a source we have the rights to is refused, by the site and by the import script; Champion's
// month of character replies; Legend's shared with its finest replies; Free and Hero in Willo's voice unless a pack
// pays; a slot's Inworld voice first, then Fish; and every fallback to Willo's voice. Inworld, Fish (OpenRouter) and
// DeepInfra are mocked through fetch; D1 is node:sqlite and R2 in memory (helpers.mjs).
// Run: node --test 'site/tests/*.test.mjs'

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { onRequest as speakApi } from "../functions/api/companion/speak.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { setupBilling, planFor, poolWindow, CHAMPION_CHARACTER_REPLIES, LEGEND_BEST_PER_MONTH, VOICE_PACK,
  CHARACTER_MODEL } from "../lib/billing.js";
import { CHARACTER_VOICES, characterVoices } from "../lib/character-voices.js";
import { FISH_MICRO_PER_BYTE, MICRO_PER_CHAR, CHARACTER_FIRST_AUDIO_MS, PROVIDER_MS } from "../lib/companion-voice.js";

import { d1, r2 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const NOW = Date.parse("2026-11-20T12:00:00Z");   // after the founders' date: no founder voices here
const DWARF = { r2: "character-voices/dwarf-male.wav", text: "Aye, the forge burns hot today.", cue: "[gruff, warm]",
                provenance: "our own design (Inworld voice design, 2026-10-13)" };
// A slot with its own Inworld voice as well as Fish's reference (dwarf-male has only the reference).
const TROLL = { ...DWARF, r2: "character-voices/troll-male.wav", cue: "[relaxed lilting rhythm]",
                inworld: "test-ws__lf-char-clone-troll-male" };
const env = { DB: d1(), STUDIO: r2(), SITE_FEATURES: "plans", DEEPINFRA_API_KEY: "di-test", INWORLD_API_KEY: "iw-test",
              OPENROUTER_API_KEY: "or-test",
              // dwarf-female's reference is never put in R2.
              CHARACTER_VOICES: JSON.stringify({ "dwarf-male": DWARF, "troll-male": TROLL,
                "dwarf-female": { ...DWARF, r2: "character-voices/dwarf-female.wav" } }),
              HOSTED_VOICES: JSON.stringify({ willo: { deepinfra: "willo-studio", inworld: "willo-finest" } }) };
const WAV = Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt fake-reference", "latin1");
const MP3 = Buffer.from("ID3\x04\x00\x00fake-mp3-frames", "latin1");
const originalFetch = globalThis.fetch;
// failing: providers that answer 503; slow: ones that answer 200 and then send nothing until they're stopped.
let calls, failing, slow;

beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  await setup(env);
  await setupBilling(env);
  for (const table of ["users", "sessions", "devices", "device_links", "rate_limits", "entitlements", "answer_user_spend",
                       "answer_packs", "answer_holds", "starter_claims", "voice_replies", "answer_spend"])
    env.DB.sqlite.exec(`DELETE FROM ${table}`);
  await env.STUDIO.put(DWARF.r2, WAV);
  await env.STUDIO.put(TROLL.r2, WAV);
  calls = [];
  failing = new Set();
  slow = new Set();
  globalThis.fetch = async (url, options = {}) => {
    const host = new URL(url).hostname;
    const provider = { "openrouter.ai": "fish", "api.inworld.ai": "inworld", "api.deepinfra.com": "deepinfra" }[host];
    if (!provider) throw new Error(`unexpected fetch ${url}`);
    calls.push({ provider, url: String(url), headers: options.headers, body: JSON.parse(options.body) });
    if (failing.has(provider)) return new Response("overloaded", { status: 503 });
    if (slow.has(provider)) return new Response(new ReadableStream({ start(stream) {
      options.signal?.addEventListener("abort", () => stream.error(options.signal.reason));
    } }));
    if (provider === "fish") return new Response(MP3, { headers: { "Content-Type": "audio/mpeg" } });
    if (provider === "deepinfra") return Response.json({ audio: MP3.toString("base64") });
    return new Response(JSON.stringify({ result: { audioContent: MP3.toString("base64") } }) + "\n");
  };
});
afterEach((t) => { globalThis.fetch = originalFetch; t.mock.timers.reset(); });

// A player on `plan` with a connected companion, and their spoken pieces in `voice`.
async function player(sub, plan) {
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const link = await startLink(env);
  assert.equal(await decideLink(env, link.user_code, user, true), true);
  const { token } = await claimToken(env, link.device_code);
  await env.DB.prepare("INSERT INTO entitlements (user_id, subscription_id, plan, status, current_period_end, updated) " +
    "VALUES (?, ?, ?, 'active', ?, ?)").bind(user.id, `sub-${user.id}`, plan, new Date(NOW + 20 * 86400e3).toISOString(),
    new Date(NOW).toISOString()).run();
  const speak = async (text, voice = "dwarf-male") => {
    const res = await speakApi({ env, request: new Request(ORIGIN + "/api/companion/speak", { method: "POST",
      headers: { "X-LF-Client": "companion/0.1.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }) }) });
    return res.status;
  };
  // `n` replies already said this plan month, as `column` (best: Legend's finest; npc: Champion's characters).
  const said = async (n, column) => {
    const period = poolWindow(await planFor(env, user.id)).key;
    const add = env.DB.sqlite.prepare(`INSERT INTO voice_replies (user_id, reply, period, pieces, heard, ${column}, created) ` +
      "VALUES (?, ?, ?, 1, 1, 1, ?)");
    for (let i = 0; i < n; i++) add.run(user.id, `earlier-${i}`, period, new Date(NOW).toISOString());
  };
  return { user, speak, said };
}

test("a character's reference without provenance naming our own design, a consent or a license is refused", () => {
  const voices = characterVoices({ CHARACTER_VOICES: JSON.stringify({
    "dwarf-male": DWARF,
    "orc-male": { ...DWARF, r2: "character-voices/orc-male.wav", provenance: "" },
    "troll-female": { ...DWARF, r2: "character-voices/troll-female.wav", provenance: "from a game trailer" },
    "gnome-female": { ...DWARF, r2: "character-voices/gnome-female.wav", provenance: "consented actor, release on file" },
    "elf-male": { ...DWARF, r2: "character-voices/elf-male.wav", provenance: undefined },
  }) }, {});
  assert.deepEqual(Object.keys(voices).sort(), ["dwarf-male", "gnome-female"]);
  // Every reference shipped in the code passes the same rule, and has its Inworld clone (never a published design).
  assert.deepEqual(Object.keys(characterVoices({})).sort(), Object.keys(CHARACTER_VOICES).sort());
  for (const [slot, entry] of Object.entries(CHARACTER_VOICES)) assert.match(entry.inworld, /__lf-char-clone-/, slot);
  assert.equal(voices["dwarf-male"].cue, "[gruff, warm]");

  // The import script holds to the same rule, prints the R2 uploads, writes only what passed, and carries each slot's
  // Inworld clone from the --inworld file, so a rerun keeps them.
  const dir = mkdtempSync(join(tmpdir(), "character-refs-"));
  for (const slot of ["dwarf-male", "orc-male"]) writeFileSync(join(dir, `${slot}.wav`), WAV);
  writeFileSync(join(dir, "refs.json"), JSON.stringify({
    "dwarf-male": { wav: "dwarf-male.wav", transcript: DWARF.text, cue: DWARF.cue, provenance: DWARF.provenance,
                    brief: "a smith of Ironforge", inworld_design: "ws__design-voice-x", seconds: 14 },
    "orc-male": { wav: "orc-male.wav", transcript: "Lok'tar.", cue: "[low]", brief: "a grunt", seconds: 12 },
  }));
  writeFileSync(join(dir, "clones.json"), JSON.stringify({ "dwarf-male": "ws__lf-char-clone-dwarf-male" }));
  const script = fileURLToPath(new URL("../../scripts/character-voices-import.mjs", import.meta.url));
  const run = spawnSync(process.execPath, [script, join(dir, "refs.json"), "--inworld", join(dir, "clones.json"),
                                           "--dry-run"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /refused orc-male: no provenance/);
  assert.match(run.stdout, /npx wrangler r2 object put lore-forever-voices\/character-voices\/dwarf-male\.wav --file /);
  assert.match(run.stdout, /lore-forever-voices-preview\/character-voices\/dwarf-male\.wav/);
  assert.doesNotMatch(run.stdout, /character-voices\/orc-male\.wav/);
  assert.match(run.stdout, /"dwarf-male": \{\n\s+"r2": "character-voices\/dwarf-male\.wav"/);
  assert.match(run.stdout, /"inworld": "ws__lf-char-clone-dwarf-male"/);
  assert.doesNotMatch(run.stdout, /design-voice/);
});

test("Champion: the month's character replies in their own voice, then Willo's studio voice", async () => {
  const { user, speak, said } = await player("champ", "champion");
  await said(CHAMPION_CHARACTER_REPLIES - 1, "npc");
  assert.equal(await speak("Mind the anvil, lad."), 200);
  const [fish] = calls;
  assert.equal(fish.provider, "fish");
  assert.equal(fish.url, "https://openrouter.ai/api/v1/audio/speech");
  assert.equal(fish.headers.Authorization, "Bearer or-test");
  assert.deepEqual([fish.body.model, fish.body.input, fish.body.response_format, fish.body.provider],
    ["fish-audio/s2.1-pro", "[gruff, warm] Mind the anvil, lad.", "mp3", { data_collection: "deny" }],
    "the cues inline at the start, nothing else outside the words, never the free tier or data collection");
  assert.deepEqual(fish.body.input_references, [
    { type: "input_audio", input_audio: { data: "data:audio/wav;base64," + WAV.toString("base64") } },
    { type: "text", text: DWARF.text }]);
  const cost = Math.ceil(Buffer.byteLength("[gruff, warm] Mind the anvil, lad.") * FISH_MICRO_PER_BYTE);
  assert.equal(env.DB.sqlite.prepare("SELECT voice_micro FROM answer_user_spend WHERE user_id = ?").get(user.id).voice_micro,
    cost, "on the plan's month, toward its whole net");
  assert.equal(await speak("And mind your fingers."), 200);
  assert.equal(calls[1].provider, "deepinfra", "the month's character replies are said: Willo's studio voice");
  assert.equal(await speak("Willo's own words.", "willo"), 200);
  assert.equal(calls[2].provider, "deepinfra");
});

test("Legend's characters share its finest replies; Hero's speak in Willo's studio voice unless a finest-voice pack pays", async () => {
  const legend = await player("legend", "legend");
  await legend.said(LEGEND_BEST_PER_MONTH - 1, "best");
  assert.equal(await legend.speak("The last of the month's finest."), 200);
  assert.equal(calls[0].provider, "fish");
  assert.equal(await legend.speak("Willo again.", "willo"), 200);
  assert.equal(calls[1].provider, "deepinfra", "one pool: the character took its last place");

  const hero = await player("hero", "hero");
  assert.equal(await hero.speak("Hail, friend."), 200);
  assert.equal(calls.at(-1).provider, "deepinfra", "Hero: the character in Willo's studio voice");
  await env.DB.prepare("INSERT INTO answer_packs (id, user_id, kind, answers, remaining, created) VALUES " +
    "('cs_voice', ?, 'voice', ?, 5, ?)").bind(hero.user.id, VOICE_PACK.replies, new Date(NOW).toISOString()).run();
  assert.equal(await hero.speak("Hail, friend."), 200);
  assert.equal(calls.at(-1).provider, "fish");
  assert.equal(env.DB.sqlite.prepare("SELECT remaining FROM answer_packs WHERE id = 'cs_voice'").get().remaining, 4);
});

test("Fish failing, a missing reference or a people without one: the character speaks in Willo's voice", async () => {
  const { speak } = await player("champ", "champion");
  failing.add("fish");
  assert.equal(await speak("Nobody hears the dwarf."), 200);
  assert.deepEqual(calls.map(c => c.provider), ["fish", "deepinfra"]);
  failing.clear();
  assert.equal(await speak("No reference yet.", "dwarf-female"), 200);
  assert.deepEqual(calls.slice(2).map(c => c.provider), ["deepinfra"], "Fish isn't even asked without its reference");
  assert.equal(await speak("An ogre speaks.", "ogre-male"), 200);
  assert.equal(calls.at(-1).provider, "deepinfra");
  assert.equal(env.DB.sqlite.prepare("SELECT COALESCE(SUM(npc), 0) AS n FROM voice_replies").get().n, 0,
    "a character Fish didn't say took none of the month's character replies, nor the ogre without a voice of its own");
});

test("A slot's Inworld voice says it first; Fish when Inworld fails or is slow; it counts whichever said it", async () => {
  const { user, speak, said } = await player("champ", "champion");
  const npc = () => env.DB.sqlite.prepare("SELECT COALESCE(SUM(npc), 0) AS n FROM voice_replies WHERE user_id = ?")
    .get(user.id).n;
  await said(CHAMPION_CHARACTER_REPLIES - 3, "npc");
  assert.equal(await speak("Stay sharp, mon.", "troll-male"), 200);
  assert.deepEqual(calls.map(c => c.provider), ["inworld"]);
  assert.deepEqual([calls[0].headers.Authorization, calls[0].body.voiceId, calls[0].body.modelId, calls[0].body.text],
    ["Basic iw-test", TROLL.inworld, CHARACTER_MODEL, "Stay sharp, mon."], "the slot's own clone on Flash, no Fish cues");
  assert.equal(env.DB.sqlite.prepare("SELECT voice_micro FROM answer_user_spend WHERE user_id = ?").get(user.id).voice_micro,
    "Stay sharp, mon.".length * MICRO_PER_CHAR[CHARACTER_MODEL]);
  assert.equal(npc(), CHAMPION_CHARACTER_REPLIES - 2);

  failing.add("inworld");
  assert.equal(await speak("Da spirits be restless.", "troll-male"), 200);
  assert.deepEqual(calls.slice(1).map(c => c.provider), ["inworld", "fish"]);
  assert.equal(calls[2].body.input, `${TROLL.cue} Da spirits be restless.`);
  assert.equal(npc(), CHAMPION_CHARACTER_REPLIES - 1, "Fish said it: one of the month's character replies");

  // Inworld answers but sends no audio: Fish is asked once CHARACTER_FIRST_AUDIO_MS is up, not the whole PROVIDER_MS.
  failing.clear();
  slow.add("inworld");
  const started = performance.now();
  assert.equal(await speak("Go to da Echo Isles.", "troll-male"), 200);
  const took = performance.now() - started;
  assert.deepEqual(calls.slice(3).map(c => c.provider), ["inworld", "fish"]);
  assert.ok(took >= CHARACTER_FIRST_AUDIO_MS - 50 && took < PROVIDER_MS, `Fish said it after ${Math.round(took)} ms`);
  assert.equal(npc(), CHAMPION_CHARACTER_REPLIES);

  slow.clear();
  assert.equal(await speak("One more, mon.", "troll-male"), 200);
  assert.equal(calls.at(-1).provider, "deepinfra", "the month's character replies are said: Willo's studio voice");
});
