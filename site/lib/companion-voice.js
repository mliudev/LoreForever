// Willo's spoken replies in a paying player's hosted voice (LOR-490): which voice says their next reply and when a
// lower one comes back up (voiceAllowance, sent with the companion's allowance), and saying them (speakPiece, for
// functions/api/companion/speak.js). Each plan's voice is lib/billing.js PLAN_VOICE.
//
// Every answer can be spoken, and a spoken reply is just an answer read aloud, counted once, as an answer. Willo has
// three voices, as players hear of them: its everyday voice, made on the player's PC (only when a hosted one is slow or
// down, or the month's room for it is used, and nothing is counted here); its studio voice, DeepInfra's Chatterbox
// Turbo (Hero's and Champion's, a launch-week Hero's first month as Champion: lib/billing.js LAUNCH_WEEK_START, and the
// free plan's first STARTER_ANSWERS replies); and its finest voice, Inworld's (Legend's, for the first
// PLAN_VOICE.legend.best replies of its plan month, then the studio voice). A finest-voice pack (lib/billing.js
// VOICE_PACK, any paid plan) says replies in the finest voice too, after the plan's own finest ones and before the
// voice steps down, and the pack pays for them, not the plan. A reply goes in the pieces the companion speaks it in
// (its first sentence, then the rest), each piece in one request, and is counted on its first piece, at most
// SPEAK_MAX_CHARS letters in all; one that couldn't be said at all is given back. A finest reply, the plan's or a
// pack's, is one Inworld said: one whose first piece the studio voice said instead goes back to the month's finest
// ones or to its pack. A reply is said in one voice, start to end (LOR-596): its pieces all go to the provider that
// took its first (voice_replies provider), and one that fails there fails, so the companion asks again and then
// shows the rest in captions, never in another voice.
//
// The free plan's spoken starter (PLAN_VOICE.free.starter): its first STARTER_ANSWERS replies ever (voice_replies,
// period "starter", kept for good), in the studio voice, paid for by the shared free budget (reserveFreeVoice, on the
// month's answer_spend) while it has room; then its answers are text (lib/billing.js companionFeatures).
//
// Willo's own lines (nano lore's tips, its hello, "Fresh start!": a piece with line: true) are said in the voice the
// player's replies get now, so Willo never changes voice between a tip and an answer (Mike, 2026-10-13). They aren't
// answers: no place among the month's replies, its finest ones, a character's, a pack's or the starter (speakLine).
//
// No player ever costs more than they pay (Mike, 2026-10-13): what the hosted voice costs goes on the player's
// calendar month (lib/billing.js addVoiceSpend) and, with their answers, stays within their plan's net
// (totalCapMicro). Each piece holds its cost against that first (holdUserSpend), so the voice steps down, finest to
// studio to everyday, before the month's total would pass it; a provider that fails at a reply's start steps down too. Never up: the
// studio voice failing goes to the everyday voice, not the dearer finest one. The companion says what the site can't in
// the everyday voice, and tells the player once per step per month, warmly, when it comes back (voiceAllowance's back).
// The shared budget for free players never pays for a paying player's.
//
// Willo's best first (lib/best-first.js, LOR-602): a player who isn't paying (the free plan, the beta's free Hero
// month) hears the finest voice on the replies their first answers earned (speakTaste), and a character they talk to
// in their own; Willo's own lines are in it too while the taste lasts (speakLine). Paid like the free plan's starter,
// from the shared free budget, and held on the taste's daily cap; the voice steps down to the studio voice when Inworld
// can't say it, and to the plan's own path once the taste is used or the day's cap is reached.
//
// Off while the "plans" site feature is (lib/features.js): then Willo talks on the PC, as before. Also needs the Pages
// secrets DEEPINFRA_API_KEY and/or INWORLD_API_KEY and Willo's voice ids (HOSTED_VOICES); without them the plans'
// replies stay on the PC.

import { plansOn, poolWindow, setupBilling, holdUserSpend, releaseUserSpend, addVoiceSpend, userSpend, STARTER_ANSWERS,
  VOICE_PACK, LEGEND_BEST_MODEL, CHARACTER_MODEL } from "./billing.js";
import { reserveFreeVoice, settleFreeVoice } from "./companion-answers.js";
import { characterVoices, CHARACTER_KEY } from "./character-voices.js";
import { tasteFor, tasteState, tasteDayMicro, takeVoice, giveVoice, holdDay, settleDay, countDay, TASTE_PERIOD,
  TASTE_REPLY_MICRO, TASTE_ANSWERS } from "./best-first.js";

export const PROVIDERS = {
  inworld: { key: "INWORLD_API_KEY", url: "https://api.inworld.ai/tts/v1/voice:stream" },
  deepinfra: { key: "DEEPINFRA_API_KEY", url: "https://api.deepinfra.com/v1/inference/ResembleAI/chatterbox-turbo" },
};
// What a letter of text costs (millionths of a dollar): Chatterbox Turbo on DeepInfra $1 a million characters; Inworld
// by its model, TTS 2 Flash $15, TTS 2 $25 (an Inworld model not listed is priced as TTS 2).
export const MICRO_PER_CHAR = { deepinfra: 1, "inworld-tts-2-flash": 15, "inworld-tts-2": 25 };
const rate = (provider, model) => provider === "deepinfra" ? MICRO_PER_CHAR.deepinfra : MICRO_PER_CHAR[model] ?? 25;
// A request's text, and a reply's pieces together, at most (the companion says up to 420 letters of an answer, and the
// names it respells for the voice can make that a little longer). A voice steps down once the month's room can't hold
// a whole reply of this in it.
export const SPEAK_MAX_CHARS = 600;
// How long a provider gets for a piece: the companion waits about 2.5 s for one before it talks on the PC.
export const PROVIDER_MS = 2500;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;   // a 600-letter piece is well under a minute of MP3
// A reply's id: the companion's, the same for each of its pieces.
export const REPLY_ID = /^[A-Za-z0-9_-]{8,40}$/;

// Willo's five hosted voices (Mike, 2026-10-13), by the name the companion sends as a piece's pick: each provider's
// voice id (each Chatterbox voice, the studio voice, is a clone of the Inworld design of the same name, the finest).
// Sprite is every hosted plan's; a plan with PLAN_VOICE choice (Champion, Legend) says its player's pick (willoPick).
export const DEFAULT_PICK = "sprite";
export const WILLO_PICKS = {
  sprite: { inworld: "humble-aspen-1573__design-voice-9e34aa30", deepinfra: "3mv3hv3v3pqpntlw1wf3" },
  sunbeam: { inworld: "humble-aspen-1573__design-voice-3c3710eb", deepinfra: "amd1vu97liqiczmceyvn" },
  moonwell: { inworld: "humble-aspen-1573__design-voice-1a47e9a9", deepinfra: "1lm6bxrwur1pipen43ce" },
  fenlight: { inworld: "humble-aspen-1573__design-voice-22a59081", deepinfra: "py2zcbsej5mt9mnunjnn" },
  starling: { inworld: "humble-aspen-1573__design-voice-fa611e40", deepinfra: "3gkdtxqxel3rzbktyly6" },
};

// The hosted voices, by the companion's voice key: each provider's voice id. Only Willo's own, Sprite's ids (the
// player's pick replaces them, willoIds): characters who answer in person speak in Willo's voice too. The Pages
// variable HOSTED_VOICES (JSON in this shape, e.g. {"willo": {"deepinfra": "...", "inworld": "..."}}, or by a pick's
// name, "moonwell": {...}) replaces the ids without a code change; "willo" and "sprite" are the same voice. The
// narrators' voices are never here.
export const HOSTED_VOICES = {
  willo: { ...WILLO_PICKS[DEFAULT_PICK] },
};
export const VOICE_KEYS = Object.keys(HOSTED_VOICES);
// What a request may ask for: Willo's own voice, or a character's people and gender (lib/character-voices.js).
export const isVoiceKey = key => VOICE_KEYS.includes(key) || (typeof key === "string" && CHARACTER_KEY.test(key));

// Characters in a voice of their own (lib/character-voices.js): Inworld first (Mike, 2026-10-13 late), TTS 2 Flash
// (lib/billing.js CHARACTER_MODEL, $15 a million letters, about $0.0045 a 300-letter line) in the slot's own Inworld
// voice, a clone of its reference (its first audio came in 0.40 to 0.66 s, 10/13). Inworld gets CHARACTER_FIRST_AUDIO_MS
// for its first audio, and the whole piece PROVIDER_MS, as Willo's own; one that's slower, or fails, and Fish says the
// piece instead, in time for the companion's 2.5 s wait. A slot without an Inworld voice is Fish's alone.
export const CHARACTER_FIRST_AUDIO_MS = 1200;
// Fish S2.1 Pro through OpenRouter, the paid model, never a free one, and never with data collection. $15 a million
// bytes of text, its cues too, and OpenRouter's 5.5% (Mike measured about $0.0047 a 300-letter reply and 0.83 to
// 1.76 s to the first audio, 10/13).
export const FISH = { key: "OPENROUTER_API_KEY", url: "https://openrouter.ai/api/v1/audio/speech", model: "fish-audio/s2.1-pro" };
export const FISH_MICRO_PER_BYTE = 15 * 1.055;
const MAX_REFERENCE_BYTES = 4 * 1024 * 1024;   // a reference is 11 to 22 s of 24 kHz mono WAV, about 1 MB
const fishCost = text => Math.ceil(new TextEncoder().encode(text).length * FISH_MICRO_PER_BYTE);
const VOICE_ID = /^[\w .:/@-]{1,200}$/;
// HOSTED_VOICES and WILLO_PICKS with the Pages variable's ids over them.
export function hostedVoices(env) {
  const voices = Object.fromEntries([...Object.entries(WILLO_PICKS), ...Object.entries(HOSTED_VOICES)]
    .map(([k, v]) => [k, { ...v }]));
  let extra = {};
  try { extra = env?.HOSTED_VOICES ? JSON.parse(env.HOSTED_VOICES) : {}; }
  catch (e) { console.warn("companion voice: HOSTED_VOICES isn't JSON; using the ids in the code"); }
  for (const key of Object.keys(voices)) {
    const ids = extra?.[key];
    if (!ids || typeof ids !== "object") continue;
    for (const p of Object.keys(PROVIDERS)) if (typeof ids[p] === "string" && VOICE_ID.test(ids[p])) {
      voices[key][p] = ids[p];
      if (key === "willo" || key === DEFAULT_PICK) voices[key === "willo" ? DEFAULT_PICK : "willo"][p] = ids[p];
    }
  }
  return voices;
}

// The pick a plan's player hears: theirs when the plan has choice and it's one of WILLO_PICKS, else Sprite.
export const willoPick = (plan, pick) =>
  plan?.voice?.choice && Object.hasOwn(WILLO_PICKS, pick) ? pick : DEFAULT_PICK;
// Willo's voice for that pick: {name, ids} (Sprite's, "willo", when the pick has no ids here).
function willoVoice(env, plan, pick) {
  const voices = hostedVoices(env), name = willoPick(plan, pick), ids = voices[name];
  return Object.keys(PROVIDERS).some(p => env?.[PROVIDERS[p].key] && ids?.[p]) ? { name, ids }
    : { name: DEFAULT_PICK, ids: voices.willo };
}
const willoIds = (env, plan, pick) => willoVoice(env, plan, pick).ids;

// The providers that can say `voice` here: a key for them and the voice's id there.
const readyFor = (env, voice) => Object.keys(PROVIDERS).filter(p => env?.[PROVIDERS[p].key] && hostedVoices(env)[voice]?.[p]);
// Which of Willo's voices a plan's voice starts at.
const TOP = { local: "everyday", chatterbox: "studio", inworld: "finest" };
const nextMonth = now => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

// A paying player's finest-voice packs with replies left (lib/billing.js VOICE_PACK), oldest first; and whether one of
// them still has room for a whole reply in the finest voice.
const openPacks = (env, userId) => env.DB.prepare("SELECT id, remaining, spent_micro FROM answer_packs WHERE " +
  "user_id = ? AND kind = 'voice' AND status = 'active' AND remaining > 0 ORDER BY created, id").bind(userId).all()
  .then(r => r.results || []);
const packRoom = pack => VOICE_PACK.costCapMicro - pack.spent_micro >= SPEAK_MAX_CHARS * rate("inworld", PACK_MODEL);
const PACK_MODEL = LEGEND_BEST_MODEL;
// A paid plan: not the free one, nor the beta's free Hero (lib/billing.js planFor launch), which has no packs.
const paying = plan => plan.id !== "free" && !plan.launch;

// The voice the player's next reply gets: {now: "finest" | "studio" | "everyday", back (when now is below the plan's
// own: when the one above it comes back, ISO)}. finest while the plan month's best replies last and the calendar
// month's room (totalCapMicro less what it cost so far) holds a whole reply in it, or after them while a finest-voice
// pack has replies and room left (its own, not the plan's); studio, on a plan with a hosted voice, while the room holds
// one of those; else everyday. A step for the best replies comes back on the plan month's renewal day, one for the
// room on the next calendar month's first. A local plan's top is everyday, so a pack running out is no step.
async function standing(env, userId, plan, now) {
  const pv = plan.voice, ready = readyFor(env, "willo"), window = poolWindow(plan, now);
  const room = plan.totalCapMicro - await userSpend(env, userId, now, { total: true, launch: Boolean(plan.launch) });
  let best = 0;
  if (pv.voice === "inworld") {
    const row = await env.DB.prepare("SELECT COALESCE(SUM(best), 0) AS n FROM voice_replies WHERE user_id = ? AND period = ?")
      .bind(userId, window.key).first();
    best = row?.n || 0;
  }
  const bestLeft = pv.voice === "inworld" ? Math.max(0, (pv.best || 0) - best) : 0;
  if (pv.voice === "inworld" && ready.includes("inworld") && bestLeft > 0 && room >= SPEAK_MAX_CHARS * rate("inworld", pv.model))
    return { now: "finest", bestLeft };
  if (ready.includes("inworld") && (await openPacks(env, userId)).some(packRoom)) return { now: "finest", bestLeft, pack: true };
  if (pv.voice === "local") return { now: "everyday", bestLeft };
  const back = pv.voice === "inworld" && bestLeft === 0 ? window.resetsAt : nextMonth(now);
  if (ready.includes("deepinfra") && room >= SPEAK_MAX_CHARS * rate("deepinfra"))
    return { now: "studio", bestLeft, ...(pv.voice === "inworld" ? { back } : {}) };
  return { now: "everyday", bestLeft, back: nextMonth(now) };
}

// The free plan's spoken starter: its replies so far, for good (speakPiece).
const STARTER_PERIOD = "starter";
const starterSaid = async (env, userId) => (await env.DB.prepare(
  "SELECT COUNT(*) AS n FROM voice_replies WHERE user_id = ? AND period = ?").bind(userId, STARTER_PERIOD).first())?.n || 0;

// What the companion is told about spoken replies, with the allowance (lib/companion-answers.js), while plans are on:
// {tier: "local" | "hosted" (whether to ask the site to say the next reply), top (the plan's own voice), now (the one
// its next reply gets), back (standing), choice (PLAN_VOICE), bestLeft (Legend's finest replies left this plan
// month), starterLeft (the free plan's spoken starter replies left)}. A plan whose hosted voice isn't set up here yet is
// "local" from the top; a plan whose voice is the PC's is "hosted" while a finest-voice pack has replies. null while
// plans are off. taste: the account's best first (lib/best-first.js tasteState), when the caller has it: while it's on
// and the finest voice is set up here, now is "finest" (top stays the plan's own).
export async function voiceAllowance(env, userId, plan, now = new Date(), taste = undefined) {
  if (!plansOn(env) || !plan?.voice) return null;
  if (taste === undefined) taste = await tasteState(env, userId, plan, now);
  const own = await planVoice(env, userId, plan, now);
  return taste?.on && readyFor(env, "willo").includes("inworld") ? { ...own, tier: "hosted", now: "finest" } : own;
}
async function planVoice(env, userId, plan, now) {
  const pv = plan.voice, choice = Boolean(pv.choice);
  const pc = { tier: "local", top: "everyday", now: "everyday", choice };
  if (plan.id === "free") {
    if (!pv.starter) return { ...pc, starterLeft: 0 };
    await setupBilling(env);
    const starterLeft = Math.max(0, STARTER_ANSWERS - await starterSaid(env, userId));
    return starterLeft > 0 && readyFor(env, "willo").includes("deepinfra")
      ? { tier: "hosted", top: "studio", now: "studio", choice, starterLeft } : { ...pc, starterLeft };
  }
  if (!readyFor(env, "willo").length || (pv.voice === "local" && !paying(plan))) return pc;
  await setupBilling(env);
  const s = await standing(env, userId, plan, now);
  if (pv.voice === "local" && s.now !== "finest") return pc;
  return { tier: s.now === "everyday" ? "local" : "hosted", top: TOP[pv.voice], now: s.now,
           ...(s.back ? { back: s.back } : {}), choice, ...(pv.voice === "inworld" ? { bestLeft: s.bestLeft } : {}) };
}

const fromBase64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
function joined(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// The providers' calls: the text in that voice as MP3 bytes, or a throw. Inworld streams NDJSON lines whose
// result.audioContent is a base64 chunk of the MP3, read as they come, so that with firstAudioMs (a character's,
// CHARACTER_FIRST_AUDIO_MS) a first chunk that's slower than that stops it; DeepInfra answers JSON whose audio is
// base64 (with or without a data: prefix).
async function inworld(env, text, voiceId, model, firstAudioMs = 0) {
  const stop = new AbortController();
  const late = (ms, what) => setTimeout(() => stop.abort(new Error(`Inworld: ${what} in ${ms} ms`)), ms);
  const whole = late(PROVIDER_MS, "not done"), first = firstAudioMs ? late(firstAudioMs, "no audio") : null;
  try {
    const res = await fetch(PROVIDERS.inworld.url, {
      method: "POST", headers: { Authorization: `Basic ${env.INWORLD_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceId, modelId: model, audioConfig: { audioEncoding: "MP3" } }),
      signal: stop.signal,
    });
    if (!res.ok) throw new Error(`Inworld HTTP ${res.status}`);
    const parts = [];
    const take = line => {
      if (!line.trim()) return;
      let message;
      try { message = JSON.parse(line); } catch (e) { throw new Error("Inworld sent a line that isn't JSON"); }
      if (message?.error) throw new Error(`Inworld: ${String(message.error.message || "error").slice(0, 200)}`);
      const chunk = message?.result?.audioContent;
      if (typeof chunk === "string" && chunk) { parts.push(fromBase64(chunk)); clearTimeout(first); }
    };
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let rest = "";
    for (let done = false; !done;) {
      const read = await reader.read();
      done = read.done;
      const lines = (rest + decoder.decode(read.value, { stream: !done })).split("\n");
      rest = done ? "" : lines.pop();
      lines.forEach(take);
    }
    return joined(parts);
  } catch (e) {
    const why = stop.signal.aborted ? stop.signal.reason : e;
    stop.abort();   // a stream it stopped reading is let go
    throw why;
  } finally {
    clearTimeout(whole);
    clearTimeout(first);
  }
}

async function deepinfra(env, text, voiceId) {
  const res = await fetch(PROVIDERS.deepinfra.url, {
    method: "POST", headers: { Authorization: `Bearer ${env.DEEPINFRA_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_id: voiceId, response_format: "mp3", exaggeration: 0.5, cfg: 0.5 }),
    signal: AbortSignal.timeout(PROVIDER_MS),
  });
  if (!res.ok) throw new Error(`DeepInfra HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  const audio = typeof data?.audio === "string" ? data.audio.replace(/^data:[^,]*,/, "") : "";
  return audio ? fromBase64(audio) : new Uint8Array(0);
}
const CALLS = { inworld, deepinfra, fish };

function base64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
// A character's reference for Fish: {audio (a data: address), text}, read from R2 once per isolate (the site's alone:
// it's never sent to a player), or null when it isn't there yet (not kept, so an upload shows up).
const references = new Map();
async function reference(env, character) {
  if (!references.has(character.r2)) {
    const obj = env.STUDIO ? await env.STUDIO.get(character.r2) : null;
    const bytes = obj ? new Uint8Array(await new Response(obj.body).arrayBuffer()) : null;
    if (!bytes?.length || bytes.length > MAX_REFERENCE_BYTES) return null;
    references.set(character.r2, "data:audio/wav;base64," + base64(bytes));
  }
  return { audio: references.get(character.r2), text: character.text };
}

// Fish's call: the character's words in the voice of their reference, with its delivery cues first (anything Fish is
// told outside them it reads aloud).
async function fish(env, input, ref) {
  const res = await fetch(FISH.url, {
    method: "POST", headers: { Authorization: `Bearer ${env[FISH.key]}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: FISH.model, input, response_format: "mp3", provider: { data_collection: "deny" },
      input_references: [{ type: "input_audio", input_audio: { data: ref.audio } }, { type: "text", text: ref.text }] }),
    signal: AbortSignal.timeout(PROVIDER_MS),
  });
  if (!res.ok) throw new Error(`Fish HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// A said piece's bookkeeping (its cost, that it was heard): after its audio has gone back when the request can wait
// for it (later, its waitUntil), so the first audio doesn't wait on the database; else here, before it's returned.
function afterAudio(settled, later, provider) {
  if (!later) return settled;
  later(Promise.resolve(settled).catch(e => console.warn(`companion voice: ${provider}: couldn't write what it cost: ${e?.message || e}`)));
}

// One piece of a reply said by a hosted voice: {audio (MP3 bytes), provider}, or {local: reason, status} when the
// companion should say it in Willo's everyday voice on the PC: "plan" (the plan's replies are said on the PC), "spent"
// (the month's room for the hosted voice is used, or the free plan's spoken starter or the shared free budget), "long"
// (the reply is past SPEAK_MAX_CHARS), "unavailable" (no voice set up here, or no provider could say it). piece: {text,
// voice ("willo", or a character's people and gender: isVoiceKey), reply (its REPLY_ID, the same for each of its
// pieces), pick (the player's Willo voice, as willoPick allows it)}.
//
// A character speaks in a voice of their own where their people and gender has one (lib/character-voices.js: an
// Inworld voice, a reference for Fish, or both) and the reply is one the plan gives characters (PLAN_VOICE characters:
// Champion's own count, Legend's out of its finest replies) or a finest-voice pack's; otherwise in Willo's voice,
// exactly as Willo's own reply would be. Their own voice is Inworld's (CHARACTER_MODEL), then Fish's when Inworld
// fails or sends no audio in CHARACTER_FIRST_AUDIO_MS; when neither can, or the month's room won't hold it, the
// character steps down to Willo's studio voice (a hosted plan), or the PC, silently. The free plan's spoken starter is
// Willo's own voice, characters' replies too. line: one of Willo's own lines, not a reply (speakLine); reading: a line
// that is the add-on's own short answer read aloud (LOR-547), always said on the PC ({local: "reading"}).
//
// later (the request's waitUntil, optional): what a said piece cost and that it was heard are written after its audio
// has gone back, not before (its hold on the month's cap counts until then); without it, before speakPiece returns.
export async function speakPiece(env, userId, plan, { text, voice, reply, pick, line = false, reading = false },
                                 now = new Date(), later = null) {
  // The add-on's short answers read aloud are always said in Willo's voice on the PC (Mike, 10/15): no provider, and
  // nothing on the player's month or the free budget. Today's companion never asks; an older one hears this.
  if (line && reading) return { local: "reading", status: 402 };
  const pv = plan?.voice;
  const free = plan?.id === "free";
  if (!plansOn(env) || !pv || (free && !pv.starter)) return { local: "plan", status: 402 };
  if (line) return speakLine(env, userId, plan, { text, pick }, now, later);
  // A reply the account's best first earned is said in the finest voice (speakTaste); any other, the plan's way below.
  if (tasteFor(env, plan)) {
    const tasted = await speakTaste(env, userId, plan, { text, voice, reply, pick }, now, later);
    if (tasted) return tasted;
  }
  const hostedPlan = pv.voice !== "local";
  const character = voice !== "willo" ? characterVoices(env)[voice] : null;
  const ownInworld = character?.inworld && env[PROVIDERS.inworld.key] ? character.inworld : null;
  const ownFish = Boolean(character && env[FISH.key] && env.STUDIO);
  const cast = Boolean(!free && character && (ownInworld || ownFish));
  const ids = willoIds(env, plan, pick);
  const ready = readyFor(env, "willo");
  // Who says a reply's finest voice: the character's own (Inworld, then Fish) for a character in a voice of their
  // own, Inworld for Willo. A finest-voice pack is any paid plan's, a plan whose own voice is the PC's too.
  const finestReady = cast || ready.includes("inworld");
  const packs = paying(plan) && finestReady;
  if (!hostedPlan && !packs) return { local: "plan", status: 402 };
  if (!ready.length && !cast) return { local: "unavailable", status: 503 };
  await setupBilling(env);
  // The free plan's spoken starter is counted for good (STARTER_PERIOD), a plan's replies by its plan month.
  const period = free ? STARTER_PERIOD : poolWindow(plan, now).key;
  // A new reply (one statement, so two said at once can't both take the month's last place, or the starter's last);
  // an older plan month's go first. best: Legend's finest replies say it (Willo's Inworld voice, or a character's own,
  // which shares them); npc: one of Champion's character replies.
  const best = pv.voice === "inworld" && finestReady && (!cast || pv.characters === "best") ? pv.best || 0 : 0;
  const npc = cast && Number.isInteger(pv.characters) ? pv.characters : 0;
  const mine = "FROM voice_replies WHERE user_id = ? AND period = ?";
  const [, made] = await env.DB.batch([
    env.DB.prepare("DELETE FROM voice_replies WHERE user_id = ? AND period < ?").bind(userId, period),
    env.DB.prepare(
      "INSERT OR IGNORE INTO voice_replies (user_id, reply, period, best, npc, created) SELECT ?, ?, ?, " +
      `CASE WHEN (SELECT COALESCE(SUM(best), 0) ${mine}) < ? THEN 1 ELSE 0 END, ` +
      `CASE WHEN (SELECT COALESCE(SUM(npc), 0) ${mine}) < ? THEN 1 ELSE 0 END, ? ` +
      `WHERE ? = 0 OR (SELECT COUNT(*) ${mine}) < ? RETURNING best, npc`
    ).bind(userId, reply, period, userId, period, best, userId, period, npc, now.toISOString(), free ? 1 : 0, userId,
           period, STARTER_ANSWERS),
  ]);
  // The free plan's starter is said: the rest are text (lib/billing.js companionFeatures).
  if (free && !made.meta.changes && !(await env.DB.prepare("SELECT 1 AS y FROM voice_replies WHERE user_id = ? AND " +
      "reply = ?").bind(userId, reply).first())) return { local: "spent", status: 402 };
  // A reply the plan's own finest voice doesn't say takes one of a finest-voice pack's (the oldest with room), once,
  // when it starts; a PC plan's reply without one is said on the PC.
  if (made.meta.changes && packs) {
    const row = made.results?.[0] ?? await env.DB.prepare("SELECT best, npc FROM voice_replies WHERE user_id = ? AND " +
      "reply = ?").bind(userId, reply).first();
    const own = row?.best || row?.npc;
    const pack = own ? null : (await openPacks(env, userId)).find(packRoom);
    const took = pack && await env.DB.prepare("UPDATE answer_packs SET remaining = remaining - 1 WHERE id = ? AND " +
      "status = 'active' AND remaining > 0 RETURNING id").bind(pack.id).first();
    if (took) {
      await env.DB.prepare("UPDATE voice_replies SET pack = ? WHERE user_id = ? AND reply = ?").bind(took.id, userId, reply).run();
    } else if (!hostedPlan && !own) {
      await env.DB.prepare("DELETE FROM voice_replies WHERE user_id = ? AND reply = ?").bind(userId, reply).run();
      return { local: "plan", status: 402 };
    }
  }
  const chars = text.length;
  const taken = await env.DB.prepare(
    "UPDATE voice_replies SET chars = chars + ?, pieces = pieces + 1 WHERE user_id = ? AND reply = ? AND period = ? " +
    "AND chars + ? <= ? RETURNING best, npc, pack, chars"
  ).bind(chars, userId, reply, period, chars, SPEAK_MAX_CHARS).first();
  if (!taken) return { local: "long", status: 413 };
  // The reply's letters before this piece: the month's room held a whole reply when it started, so a later piece only
  // needs room for what's left of it, and a reply that started in a voice can finish in it.
  const before = taken.chars - chars;
  // The reply's finest voice when it has one (a character's own: Inworld, then Fish; else Willo's Inworld voice), then
  // studio (a PC plan has no studio voice). Each holds its cost first, while the rest of the reply in that voice still
  // fits: a pack's against the pack, the free plan's starter on the shared free budget, the rest against the month's
  // total. One that won't steps down, and so does one whose provider fails, but only while nothing else of the reply
  // is said or on its way (the companion asks for the next piece while one plays): each first takes the reply for its
  // provider (claim), and the reply's other pieces then go only there (LOR-596).
  const input = cast && character.cue ? `${character.cue} ${text}` : text;
  const finest = !(taken.best || taken.npc || taken.pack) ? []
    : cast ? [...(ownInworld ? [{ provider: "inworld", model: CHARACTER_MODEL, pack: taken.pack, voiceId: ownInworld,
                                  firstAudioMs: CHARACTER_FIRST_AUDIO_MS }] : []),
              ...(ownFish ? [{ provider: "fish", pack: taken.pack }] : [])]
    : [{ provider: "inworld", model: taken.best ? pv.model : PACK_MODEL, pack: taken.best ? null : taken.pack }];
  const order = [...finest, ...(hostedPlan ? [{ provider: "deepinfra" }] : [])]
    .filter(s => s.voiceId || s.provider === "fish" || ready.includes(s.provider));
  const claim = provider => env.DB.prepare("UPDATE voice_replies SET provider = ? WHERE user_id = ? AND reply = ? AND " +
    "(provider IS NULL OR provider = ? OR (heard = 0 AND pieces = 1)) RETURNING provider")
    .bind(provider, userId, reply, provider).first();
  let full = false;
  for (const { provider, model, pack, voiceId, firstAudioMs } of order) {
    if (!(await claim(provider))) continue;
    const micro = provider === "fish" ? fishCost(input) : chars * rate(provider, model);
    const left = SPEAK_MAX_CHARS - before;
    const need = provider === "fish" ? Math.ceil(left * FISH_MICRO_PER_BYTE) : left * rate(provider, model);
    const hold = free ? await reserveFreeVoice(env, micro, now) : await holdUserSpend(env, userId, micro, now, pack
      ? { packId: pack, packCap: VOICE_PACK.costCapMicro, total: true, need }
      : { cap: plan.totalCapMicro, total: true, need, launch: Boolean(plan.launch) });
    if (!hold) { full = true; continue; }
    try {
      let audio;
      if (provider === "fish") {
        const ref = await reference(env, character);
        if (!ref) throw new Error(`no reference for ${voice} in R2 (${character.r2})`);
        audio = await fish(env, input, ref);
      } else audio = await CALLS[provider](env, text, voiceId || ids[provider], model, firstAudioMs);
      if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new Error(`${provider} sent ${audio.length} bytes of audio`);
      // A finest reply counts only once its finest voice (Willo's Inworld voice, or a character's own, Inworld's or
      // Fish's, whichever said it) said it: one whose first piece the studio voice says gives its place back, the plan
      // month's (best, npc) or its pack's (pack), and the rest of it stays in the studio voice; after a finest piece, it
      // stays one.
      const studioFirst = provider === "deepinfra";
      const settled = Promise.all([free ? settleFreeVoice(env, micro, true, now)
        : addVoiceSpend(env, userId, micro, now, hold, pack || null, Boolean(plan.launch)),
        env.DB.batch([
          ...(studioFirst ? [env.DB.prepare("UPDATE answer_packs SET remaining = remaining + 1 WHERE id = (SELECT pack " +
            "FROM voice_replies WHERE user_id = ? AND reply = ? AND heard = 0) AND status = 'active' AND remaining < answers")
            .bind(userId, reply)] : []),
          env.DB.prepare("UPDATE voice_replies SET heard = heard + 1" + (studioFirst
            ? ", best = CASE WHEN heard = 0 THEN 0 ELSE best END, npc = CASE WHEN heard = 0 THEN 0 ELSE npc END, " +
              "pack = CASE WHEN heard = 0 THEN NULL ELSE pack END" : "") +
            " WHERE user_id = ? AND reply = ?").bind(userId, reply),
        ])]);
      await afterAudio(settled, later, provider);
      return { audio, provider };
    } catch (e) {
      await (free ? settleFreeVoice(env, micro, false, now) : releaseUserSpend(env, hold));
      console.warn(`companion voice: ${provider}${voiceId || provider === "fish" ? ` (${voice})` : ""}: ${e?.message || e}`);
    }
  }
  // Nothing could say it: this piece's letters go back, and the reply too when none of its pieces is said or on its
  // way (its place among the plan's with it, and a pack's reply to its pack).
  await env.DB.batch([
    env.DB.prepare("UPDATE voice_replies SET chars = chars - ?, pieces = pieces - 1 WHERE user_id = ? AND reply = ?")
      .bind(chars, userId, reply),
    env.DB.prepare("UPDATE answer_packs SET remaining = remaining + 1 WHERE id = (SELECT pack FROM voice_replies WHERE " +
      "user_id = ? AND reply = ? AND pieces <= 0 AND heard = 0) AND status = 'active' AND remaining < answers")
      .bind(userId, reply),
    env.DB.prepare("DELETE FROM voice_replies WHERE user_id = ? AND reply = ? AND pieces <= 0 AND heard = 0")
      .bind(userId, reply),
  ]);
  return full ? { local: "spent", status: 402 } : { local: "unavailable", status: 503 };
}

// The taste's voice (lib/best-first.js) is paid like the free plan's starter, from the shared monthly budget
// (reserveFreeVoice), and held on the taste's daily cap too: {day} when both hold `micro`, else null (neither kept).
async function holdTaste(env, micro, now) {
  const [shared, day] = await Promise.all([reserveFreeVoice(env, micro, now), holdDay(env, micro, now)]);
  if (shared && day) return { day };
  await Promise.all([shared ? settleFreeVoice(env, micro, false, now) : null, day ? settleDay(env, day, 0, {}, now) : null]);
  return null;
}
const settleTaste = (env, hold, micro, said, counts, now) => Promise.all([settleFreeVoice(env, micro, said, now),
  settleDay(env, hold.day, said ? micro : 0, said ? counts : {}, now)]);

// A reply in the taste's finest voice (lib/best-first.js, LOR-602): {audio, provider, voice ("finest:sprite", or
// "studio:sprite" when Inworld couldn't and the studio voice said it)} or {local, status} as speakPiece's; null when
// this reply isn't the taste's, so the plan's own path says it. A new reply is the taste's when the account has a
// finest reply its taste answers earned (best_first.voices, takeVoice) and the day's cap has room for a whole one (a
// reply the cap turns away is counted, and keeps its place for later); it's kept in voice_replies under TASTE_PERIOD,
// counted for good, never among the plan month's or the starter's. Willo in her finest voice (Inworld, Sprite's: the
// free plan and the free Hero month have no pick), a character in their own (Inworld, then Fish), stepping down to
// Willo's studio voice when those fail; one voice a reply, as speakPiece's (LOR-596). A reply nothing could say gives
// its place back. tasteDone: accounts whose taste is all said, so their replies skip the look here (this isolate's).
const tasteDone = new Set();
async function speakTaste(env, userId, plan, { text, voice, reply, pick }, now, later) {
  const character = voice !== "willo" ? characterVoices(env)[voice] : null;
  const ownInworld = character?.inworld && env[PROVIDERS.inworld.key] ? character.inworld : null;
  const ownFish = Boolean(character && env[FISH.key] && env.STUDIO);
  const cast = Boolean(character && (ownInworld || ownFish));
  const ready = readyFor(env, "willo");
  if ((!cast && !ready.includes("inworld")) || tasteDone.has(userId)) return null;
  await setupBilling(env);
  const [mine, owed, day] = await env.DB.batch([
    env.DB.prepare("SELECT period FROM voice_replies WHERE user_id = ? AND reply = ?").bind(userId, reply),
    env.DB.prepare("SELECT voices, used FROM best_first WHERE user_id = ?").bind(userId),
    env.DB.prepare("SELECT reserved_micro FROM best_first_days WHERE day = ?").bind(now.toISOString().slice(0, 10)),
  ]);
  const period = mine.results?.[0]?.period, taste = owed.results?.[0];
  if (period && period !== TASTE_PERIOD) return null;
  if (!period) {
    if (!(taste?.voices > 0)) {
      if (taste?.used >= TASTE_ANSWERS) tasteDone.add(userId);
      return null;
    }
    if ((day.results?.[0]?.reserved_micro || 0) + TASTE_REPLY_MICRO > tasteDayMicro(env)) {
      await countDay(env, now, "capped");
      return null;
    }
    if (!(await takeVoice(env, userId))) return null;
    const made = await env.DB.prepare("INSERT OR IGNORE INTO voice_replies (user_id, reply, period, best, created) " +
      "VALUES (?, ?, ?, 1, ?)").bind(userId, reply, TASTE_PERIOD, now.toISOString()).run();
    if (!made.meta.changes) {
      await giveVoice(env, userId);
      return null;
    }
  }
  const chars = text.length;
  const taken = await env.DB.prepare("UPDATE voice_replies SET chars = chars + ?, pieces = pieces + 1 WHERE user_id = ? " +
    "AND reply = ? AND period = ? AND chars + ? <= ? RETURNING chars")
    .bind(chars, userId, reply, TASTE_PERIOD, chars, SPEAK_MAX_CHARS).first();
  if (!taken) return { local: "long", status: 413 };
  const first = taken.chars === chars;
  const { name, ids } = willoVoice(env, plan, pick);
  const input = cast && character.cue ? `${character.cue} ${text}` : text;
  const order = [...(cast
    ? [...(ownInworld ? [{ provider: "inworld", model: CHARACTER_MODEL, voiceId: ownInworld,
                          firstAudioMs: CHARACTER_FIRST_AUDIO_MS }] : []), ...(ownFish ? [{ provider: "fish" }] : [])]
    : [{ provider: "inworld", model: LEGEND_BEST_MODEL }]), { provider: "deepinfra" }]
    .filter(s => s.voiceId || s.provider === "fish" || ready.includes(s.provider));
  const claim = provider => env.DB.prepare("UPDATE voice_replies SET provider = ? WHERE user_id = ? AND reply = ? AND " +
    "(provider IS NULL OR provider = ? OR (heard = 0 AND pieces = 1)) RETURNING provider")
    .bind(provider, userId, reply, provider).first();
  let full = false;
  for (const { provider, model, voiceId, firstAudioMs } of order) {
    if (!(await claim(provider))) continue;
    const micro = provider === "fish" ? fishCost(input) : chars * rate(provider, model);
    const hold = await holdTaste(env, micro, now);
    if (!hold) { full = true; continue; }
    try {
      let audio;
      if (provider === "fish") {
        const ref = await reference(env, character);
        if (!ref) throw new Error(`no reference for ${voice} in R2 (${character.r2})`);
        audio = await fish(env, input, ref);
      } else audio = await CALLS[provider](env, text, voiceId || ids[provider], model, firstAudioMs);
      if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new Error(`${provider} sent ${audio.length} bytes of audio`);
      await afterAudio(Promise.all([settleTaste(env, hold, micro, true, first ? { replies: 1 } : {}, now),
        env.DB.prepare("UPDATE voice_replies SET heard = heard + 1 WHERE user_id = ? AND reply = ?").bind(userId, reply).run()]),
        later, provider);
      return { audio, provider, voice: `${provider === "deepinfra" ? "studio" : "finest"}:${cast && provider !== "deepinfra" ? voice : name}` };
    } catch (e) {
      await settleTaste(env, hold, micro, false, {}, now);
      console.warn(`companion voice: a first reply: ${provider}${voiceId || provider === "fish" ? ` (${voice})` : ""}: ${e?.message || e}`);
    }
  }
  const [, gone] = await env.DB.batch([
    env.DB.prepare("UPDATE voice_replies SET chars = chars - ?, pieces = pieces - 1 WHERE user_id = ? AND reply = ?")
      .bind(chars, userId, reply),
    env.DB.prepare("DELETE FROM voice_replies WHERE user_id = ? AND reply = ? AND pieces <= 0 AND heard = 0")
      .bind(userId, reply),
  ]);
  await Promise.all([gone.meta.changes ? giveVoice(env, userId) : null, countDay(env, now, "unreachable")]);
  return full ? { local: "spent", status: 402 } : { local: "unavailable", status: 503 };
}

// One of Willo's own lines (nano lore's tips, its hello, "Fresh start!"; never an answer), in the voice the player's
// replies get now (standing): finest, studio, or the PC's. It isn't a reply: it takes no place among the plan month's
// replies, its finest ones, a character's or a pack's, nor the free plan's starter (which only has to last). Its cost
// is a reply's: on the player's month inside the total cap (never a pack's), or the shared free budget during the free
// plan's starter; and it steps down as a reply does, finest to studio to the PC, once the month won't hold a whole reply
// in that voice or a provider fails. {audio, provider, voice: the voice that said it and its pick ("studio:sprite"), by
// which the companion keeps it (talk/linecache.py)}, or {local, status} as speakPiece's. The add-on's short answers
// read aloud (LOR-547) never come here: speakPiece keeps them on the PC, so they cost nothing.
async function speakLine(env, userId, plan, { text, pick }, now, later = null) {
  const pv = plan.voice, free = plan.id === "free", ready = readyFor(env, "willo");
  if (!ready.length) return { local: "unavailable", status: 503 };
  await setupBilling(env);
  // While the account's best first is on (lib/best-first.js), her lines are in the voice its replies get: the finest,
  // then the studio voice, both on the taste's budget (holdTaste).
  const taste = tasteFor(env, plan) && ready.includes("inworld") && (await tasteState(env, userId, plan, now))?.on;
  let steps;
  if (taste) {
    steps = [{ voice: "finest", provider: "inworld", model: LEGEND_BEST_MODEL, taste }, { voice: "studio", provider: "deepinfra", taste }];
  } else if (free) {
    if (await starterSaid(env, userId) >= STARTER_ANSWERS) return { local: "spent", status: 402 };
    steps = [{ voice: "studio", provider: "deepinfra" }];
  } else {
    if (pv.voice === "local" && !paying(plan)) return { local: "plan", status: 402 };
    const s = await standing(env, userId, plan, now);
    steps = [...(s.now === "finest" ? [{ voice: "finest", provider: "inworld", model: pv.model || PACK_MODEL }] : []),
             ...(s.now !== "everyday" && pv.voice !== "local" ? [{ voice: "studio", provider: "deepinfra" }] : [])];
  }
  steps = steps.filter(s => ready.includes(s.provider));
  const { name, ids } = willoVoice(env, plan, pick);
  let full = !steps.length;
  for (const { voice, provider, model, taste: tasted } of steps) {
    const micro = text.length * rate(provider, model);
    const hold = tasted ? await holdTaste(env, micro, now) : free ? await reserveFreeVoice(env, micro, now)
      : await holdUserSpend(env, userId, micro, now,
        { cap: plan.totalCapMicro, total: true, need: SPEAK_MAX_CHARS * rate(provider, model), launch: Boolean(plan.launch) });
    if (!hold) { full = true; continue; }
    try {
      const audio = await CALLS[provider](env, text, ids[provider], model);
      if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new Error(`${provider} sent ${audio.length} bytes of audio`);
      await afterAudio(tasted ? settleTaste(env, hold, micro, true, { lines: 1 }, now) : free ? settleFreeVoice(env, micro, true, now)
        : addVoiceSpend(env, userId, micro, now, hold, null, Boolean(plan.launch)), later, provider);
      return { audio, provider, voice: `${voice}:${name}` };
    } catch (e) {
      await (tasted ? settleTaste(env, hold, micro, false, {}, now) : free ? settleFreeVoice(env, micro, false, now)
        : releaseUserSpend(env, hold));
      console.warn(`companion voice: a line: ${provider}: ${e?.message || e}`);
    }
  }
  return full ? { local: "spent", status: 402 } : { local: "unavailable", status: 503 };
}
