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

import { plansOn, poolWindow, setupBilling, holdUserSpend, holdStatements, releaseUserSpend, addVoiceSpend, userSpend, STARTER_ANSWERS,
  VOICE_PACK, LEGEND_BEST_MODEL, CHARACTER_MODEL, READINGS_FROM, PLANS } from "./billing.js";
import { reserveFreeVoice, reserveFreeVoiceStatements, reservedFreeVoice, settleFreeVoice } from "./companion-answers.js";
import { characterVoices, CHARACTER_KEY, CHARACTER_VOICES, voiceLabel, hasAzeroth } from "./character-voices.js";
import { tasteFor, tasteState, tasteRoom, roomIn, takeVoice, giveVoice, holdDay, holdDayStatements, heldDay, settleDay,
  countDay, TASTE_PERIOD, TASTE_ANSWERS, trialOf, trialRow, tryOnce, untry, withTrial, trialFor
} from "./best-first.js";
import { questPage, cutAtSentence } from "./quest-pages.js";
import { respell, loadRespell } from "./respell.js";
import { savedPick } from "./plan-usage.js";

export const PROVIDERS = {
  inworld: { key: "INWORLD_API_KEY", url: "https://api.inworld.ai/tts/v1/voice:stream" },
  deepinfra: { key: "DEEPINFRA_API_KEY", url: "https://api.deepinfra.com/v1/inference/ResembleAI/chatterbox-turbo" },
};
// What a letter of text costs (millionths of a dollar): Chatterbox Turbo on DeepInfra $1 a million characters; Inworld
// by its model, TTS 2 Flash $15, TTS 2 $25 (an Inworld model not listed is priced as TTS 2).
export const MICRO_PER_CHAR = { deepinfra: 1, "inworld-tts-2-flash": 15, "inworld-tts-2": 25 };
const rate = (provider, model) => provider === "deepinfra" ? MICRO_PER_CHAR.deepinfra : MICRO_PER_CHAR[model] ?? 25;
// Names the pronunciation lexicon respells for these voices (lib/respell.js; data/pronunciation.json "hosted", else
// "qwen"; generated into respell-hosted.json): the provider is sent "Doon Mor-uh" for "Dun Morogh" so it says the name
// right, while the companion shows and times the real spelling. Only the text sent to a provider is respelled: what a
// piece costs and counts toward SPEAK_MAX_CHARS is the letters the companion sent, and a character's delivery cue is
// never touched. The companion already respells the names it knows by their "alias"; these are the rest.
export const HOSTED_RESPELL = "/lore/data/respell-hosted.json";
export const hostedSpellings = (env, origin) => loadRespell(env, origin, HOSTED_RESPELL);

// A request's text, and a reply's pieces together, at most (the companion says up to 420 letters of an answer, and the
// names it respells for the voice can make that a little longer). A voice steps down once the month's room can't hold
// a whole reply of this in it.
export const SPEAK_MAX_CHARS = 600;
// A plan that hears her whole answer spoken (lib/billing.js PLAN_VOICE whole: every plan's since 10/21): its replies'
// pieces together, at most; the written answer is under 140 words. Each piece is still at most SPEAK_MAX_CHARS, and each holds its
// cost against the month first, so the total cap steps the voice down as before.
export const WHOLE_MAX_CHARS = 1500;
export const replyMax = plan => plan?.voice?.whole ? WHOLE_MAX_CHARS : SPEAK_MAX_CHARS;
// How long a provider gets for a piece: the companion waits about 4 s for a reply's first one, her words on screen,
// before it says that reply on the PC (talk/tts.py PIECE_WAIT; 2.5 s before the voices and plans picks, 10/21, when a
// slow first word was a reply, and the minute after it, in a stand-in voice). The site gives up first. A later piece
// is asked for while the one before plays, and the companion waits 5.5 s for it (talk/tts.py
// PIECE_WAIT + RETRY_WAIT) before the rest of the reply is captions: its provider gets LATER_PIECE_MS, what's left of
// that after reading the account, so the site gives up (and gives its letters back) before the companion does
// (LOR-673: a later piece cut at 2.5 s was the rest of a reply gone quiet).
export const PROVIDER_MS = 3500;
export const LATER_PIECE_MS = 4500;
// A piece's number in its reply (the companion's, 0 for the first), as one bit of voice_replies.bits: its letters
// count once toward the reply's SPEAK_MAX_CHARS, however often it's asked for (LOR-673: a piece asked again after the
// companion gave up on it was counted twice, and a reply past about 300 letters was refused as too long, its rest in
// captions). A piece the companion doesn't number (an older one) counts every time, as before.
export const MAX_PIECE = 30;
const pieceBit = piece => (Number.isInteger(piece) && piece >= 0 && piece <= MAX_PIECE ? 2 ** piece : 0);
// A reply's letters with this piece's, once (pieceBit), in one batch with what was counted before it, so the caller
// knows whether this ask counted them (`again`: an earlier ask of the same piece did) and gives back only what it took.
// {taken: the row after (RETURNING), again} or {taken: null} when the reply would pass SPEAK_MAX_CHARS.
async function countPiece(env, userId, reply, period, chars, piece, returning, max = SPEAK_MAX_CHARS) {
  return countedPiece(await env.DB.batch(countStatements(env, userId, reply, period, chars, piece, returning, max)), piece);
}
// countPiece's two statements, for a caller that batches them with its own (speakPiece), and what their results say.
const countStatements = (env, userId, reply, period, chars, piece, returning, max = SPEAK_MAX_CHARS) => {
  const bit = pieceBit(piece);
  return [
    env.DB.prepare("SELECT bits FROM voice_replies WHERE user_id = ? AND reply = ? AND period = ?").bind(userId, reply, period),
    env.DB.prepare("UPDATE voice_replies SET chars = chars + CASE WHEN bits & ? THEN 0 ELSE ? END, " +
      "pieces = pieces + CASE WHEN bits & ? THEN 0 ELSE 1 END, bits = bits | ? WHERE user_id = ? AND reply = ? AND " +
      `period = ? AND (bits & ? OR chars + ? <= ?) RETURNING ${returning}`)
      .bind(bit, chars, bit, bit, userId, reply, period, bit, chars, max),
  ];
};
function countedPiece([before, after], piece) {
  const bit = pieceBit(piece), taken = after.results?.[0] ?? null;
  return { taken, again: Boolean(taken && bit && ((before.results?.[0]?.bits || 0) & bit)), bit };
}
// A piece's claim on its reply for `provider` (a reply is said in one voice: its first piece's provider's, or the next
// one's while nothing of it is said, LOR-596) and its cost held, in one round trip (LOR-673): null when the reply is
// another provider's; else {hold}, the hold's id (on the shared free budget: true), or null when there's no room for it
// (the voice steps down). The hold is made only where the claim took. Without opts: the shared free budget's (the free
// plan's starter, reserveFreeVoice); with them, the player's own (holdUserSpend's).
async function claimAndHold(env, userId, reply, provider, { micro, now, opts = null, taste = false }) {
  const claim = env.DB.prepare("UPDATE voice_replies SET provider = ? WHERE user_id = ? AND reply = ? AND " +
    "(provider IS NULL OR provider = ? OR (heard = 0 AND pieces = 1)) RETURNING provider")
    .bind(provider, userId, reply, provider);
  const also = { sql: "EXISTS (SELECT 1 FROM voice_replies WHERE user_id = ? AND reply = ? AND provider = ?)",
                 binds: [userId, reply, provider] };
  if (taste) {        // a reply of best first's: the shared free budget and the taste's day, both (holdTaste's)
    const results = await env.DB.batch([claim, ...reserveFreeVoiceStatements(env, micro, now, also),
      ...holdDayStatements(env, micro, now, also)]);
    if (!results[0].results?.[0]) return null;
    const [shared, day] = [reservedFreeVoice(results.slice(1, 3)), heldDay(results.slice(3), micro, now)];
    if (shared && day) return { hold: { day } };
    await Promise.all([shared ? settleFreeVoice(env, micro, false, now) : null, day ? settleDay(env, day, 0, {}, now) : null]);
    return { hold: null };
  }
  if (!opts) {
    const results = await env.DB.batch([claim, ...reserveFreeVoiceStatements(env, micro, now, also)]);
    return results[0].results?.[0] ? { hold: reservedFreeVoice(results) } : null;
  }
  const held = holdStatements(env, userId, micro, now, opts, also);
  const results = await env.DB.batch([claim, ...(held ? held.statements : [])]);
  if (!results[0].results?.[0]) return null;
  return { hold: held && results.at(-1).meta.changes ? held.id : null };
}

// This ask's letters back (a piece nothing could say), only when it counted them; `bit` with them.
const uncount = (env, userId, reply, chars, bit) => env.DB.prepare("UPDATE voice_replies SET chars = chars - ?, " +
  "pieces = pieces - 1, bits = bits & ~? WHERE user_id = ? AND reply = ?").bind(chars, bit, userId, reply);
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;   // a 600-letter piece is well under a minute of MP3
// A reply's id: the companion's, the same for each of its pieces.
export const REPLY_ID = /^[A-Za-z0-9_-]{8,40}$/;

// Willo's own hosted voices, by the name the companion sends as a piece's pick: each provider's voice id (each
// Chatterbox voice, the studio voice, is a clone of the Inworld design of the same name, the finest). Her five (Mike,
// 2026-10-13), each followed by his male partner (LOR-610, Mike, 2026-10-16: "done kept them all"; ids in
// ~/lore-voice-renders/experiments/willo-voice/r1/kept.json). Sprite is every hosted plan's; a plan with PLAN_VOICE
// choice (Champion, Legend) says its player's pick (willoPick).
export const DEFAULT_PICK = "sprite";
export const WILLO_PICKS = {
  sprite: { inworld: "humble-aspen-1573__design-voice-9e34aa30", deepinfra: "3mv3hv3v3pqpntlw1wf3" },
  puck: { inworld: "humble-aspen-1573__design-voice-5cb263a1", deepinfra: "rbo1dwi5xclqs2rgluhk" },
  sunbeam: { inworld: "humble-aspen-1573__design-voice-3c3710eb", deepinfra: "amd1vu97liqiczmceyvn" },
  daybreak: { inworld: "humble-aspen-1573__design-voice-a6ed38f4", deepinfra: "wh1ewt31iudvyhcxb3s6" },
  moonwell: { inworld: "humble-aspen-1573__design-voice-1a47e9a9", deepinfra: "1lm6bxrwur1pipen43ce" },
  moonshade: { inworld: "humble-aspen-1573__design-voice-ca232d30", deepinfra: "zm3m3nyoafxmfmdhrc5n" },
  fenlight: { inworld: "humble-aspen-1573__design-voice-22a59081", deepinfra: "py2zcbsej5mt9mnunjnn" },
  fenfire: { inworld: "humble-aspen-1573__design-voice-f9cba8a2", deepinfra: "ewvqqr1bcwlipqlvpffd" },
  starling: { inworld: "humble-aspen-1573__design-voice-fa611e40", deepinfra: "3gkdtxqxel3rzbktyly6" },
  kestrel: { inworld: "humble-aspen-1573__design-voice-b10f5442", deepinfra: "npdmreavbnjhdjr5kt7q" },
};
// The five every companion knows; her male partners came with the Voices of Azeroth (picksFor).
const FIRST_FIVE = ["sprite", "sunbeam", "moonwell", "fenlight", "starling"];
// Voices of Azeroth (LOR-609, Mike, 2026-10-16: "yes, start it for the next release"): a plan with choice may also
// pick one of the people-and-gender character voices (lib/character-voices.js) as Willo's everyday voice, by its slot
// ("dwarf-male"): she borrows it, and characters who answer in person keep their own. Its finest voice is the slot's
// Inworld clone (character-voices.js inworld), its studio voice a Chatterbox clone of the same reference, here
// (~/lore-voice-renders/experiments/willo-voice/azeroth.py); HOSTED_VOICES by the slot's name replaces either.
export const AZEROTH_STUDIO = {
  "dwarf-female": "6ehpzvsatxh68puj8zpj", "dwarf-male": "al479rk4wzxum85mjmho", "forsaken-female": "p56dz8d9cop6d1vcqlim",
  "forsaken-male": "m37sh5db0aw8v70ot59w", "gnome-female": "nqp4j1122ziuhncoe06c", "gnome-male": "y0r8r1e4eba0uka3mwv1",
  "goblin-female": "ri3plic4681fapq5r097", "goblin-male": "0hztttmrhtlb8bq3pow6", "highelf-female": "0257e3ifx42ghq5j1bo8",
  "highelf-male": "zds5q3ot7g3grpug47ap", "human-female": "bpbq49k6rdxtxqvdmub0", "human-male": "hv2ffug7hb8r2d2ha22l",
  "nightelf-female": "x9kpm8tny2yedjaiquay", "nightelf-male": "qy47s0jonl1kbd3eo8yq", "orc-female": "jof7in80gcv3n9t7kw0p",
  "orc-male": "k275zcoo9107rf43jtxf", "skyborne-female": "3iaymnan1zj4ldxj9rcj", "skyborne-male": "3byfsilqgwivdbxrt4qe",
  "tauren-female": "1zs5jnu59ws84c9uu44x", "tauren-male": "6bbl2x6amrzmu9dm3y0g", "troll-female": "8uzpdu2eira3gxiptfbu",
  "troll-male": "s59hrhio6uwb4qmousbw",
};
export const AZEROTH_PICKS = Object.keys(CHARACTER_VOICES).filter(slot => voiceLabel(slot));
// The Voices of Azeroth are Legend's (lib/billing.js PLAN_VOICE azeroth; the voices and plans picks, Mike, 2026-10-21),
// and the first-run trial's, which tries Legend's voices (lib/best-first.js withTrial).
const isPick = (pick, plan = null) => Object.hasOwn(WILLO_PICKS, pick) || (Boolean(plan?.voice?.azeroth) && AZEROTH_PICKS.includes(pick));
// The picks a companion can offer on a plan: her first five, and her male partners for a companion that has them
// (lib/character-voices.js hasAzeroth), so an older one is never offered a voice it can't switch to, and the Voices of
// Azeroth with them on a plan that has those.
export const picksFor = (client, plan = null) => !hasAzeroth(client) ? [...FIRST_FIVE]
  : [...Object.keys(WILLO_PICKS), ...(plan?.voice?.azeroth ? AZEROTH_PICKS : [])];
// The pick a voice's name in WILLO STATE ("voice now: Moonwell", "voice now: Dwarf, man") is, or "" (a voice on the
// PC, "Heart (on this PC)", is none of them).
export function pickNamed(name) {
  const said = String(name || "").trim().toLowerCase();
  return Object.keys(WILLO_PICKS).find(p => p === said)
    || AZEROTH_PICKS.find(p => voiceLabel(p).toLowerCase() === said) || "";
}

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
// piece instead, in time for the companion's 4 s wait. A slot without an Inworld voice is Fish's alone.
export const CHARACTER_FIRST_AUDIO_MS = 1200;
// Fish S2.1 Pro through OpenRouter, the paid model, never a free one, and never with data collection. $15 a million
// bytes of text, its cues too, and OpenRouter's 5.5% (Mike measured about $0.0047 a 300-letter reply and 0.83 to
// 1.76 s to the first audio, 10/13).
export const FISH = { key: "OPENROUTER_API_KEY", url: "https://openrouter.ai/api/v1/audio/speech", model: "fish-audio/s2.1-pro" };
export const FISH_MICRO_PER_BYTE = 15 * 1.055;
const MAX_REFERENCE_BYTES = 4 * 1024 * 1024;   // a reference is 11 to 22 s of 24 kHz mono WAV, about 1 MB
const fishCost = text => Math.ceil(new TextEncoder().encode(text).length * FISH_MICRO_PER_BYTE);
const VOICE_ID = /^[\w .:/@-]{1,200}$/;
// HOSTED_VOICES, WILLO_PICKS and the Voices of Azeroth (each slot's Inworld clone, and its studio clone) with the
// Pages variable's ids over them.
export function hostedVoices(env) {
  const azeroth = Object.entries(characterVoices(env)).filter(([slot]) => AZEROTH_PICKS.includes(slot))
    .map(([slot, c]) => [slot, { ...(c.inworld ? { inworld: c.inworld } : {}),
                                 ...(AZEROTH_STUDIO[slot] ? { deepinfra: AZEROTH_STUDIO[slot] } : {}) }]);
  const voices = Object.fromEntries([...Object.entries(WILLO_PICKS), ...azeroth, ...Object.entries(HOSTED_VOICES)]
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

// The pick a plan's player hears: theirs when the plan has choice and it's one of WILLO_PICKS, or of the Voices of
// Azeroth on a plan that has them, else Sprite.
export const willoPick = (plan, pick) => plan?.voice?.choice && isPick(pick, plan) ? pick : DEFAULT_PICK;
// Willo's voice for that pick: {name, ids, names (by provider, the pick each id is: Sprite's, "willo", where the pick
// has no id there, so a pick without a studio clone says the studio voice's replies as Sprite)}.
function willoVoice(env, plan, pick) {
  const voices = hostedVoices(env), name = willoPick(plan, pick), own = voices[name] || {};
  const ids = {}, names = {};
  for (const p of Object.keys(PROVIDERS)) [ids[p], names[p]] = own[p] ? [own[p], name] : [voices.willo[p], DEFAULT_PICK];
  return { name, ids, names };
}
const willoIds = (env, plan, pick) => willoVoice(env, plan, pick).ids;

// The providers that can say `voice` here: a key for them and the voice's id there.
const readyFor = (env, voice) => Object.keys(PROVIDERS).filter(p => env?.[PROVIDERS[p].key] && hostedVoices(env)[voice]?.[p]);
// Which of Willo's voices a plan's voice starts at.
const TOP = { local: "everyday", chatterbox: "studio", inworld: "finest" };
const nextMonth = now => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

// A paying player's finest-voice packs with replies left (lib/billing.js VOICE_PACK), oldest first; and whether one of
// them still has room for a whole reply in the finest voice.
const openPacksStatement = (env, userId) => env.DB.prepare("SELECT id, remaining, spent_micro FROM answer_packs WHERE " +
  "user_id = ? AND kind = 'voice' AND status = 'active' AND remaining > 0 ORDER BY created, id").bind(userId);
const openPacks = (env, userId) => openPacksStatement(env, userId).all().then(r => r.results || []);
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
  if (pv.voice === "inworld" && ready.includes("inworld") && bestLeft > 0 && room >= replyMax(plan) * rate("inworld", pv.model))
    return { now: "finest", bestLeft };
  if (ready.includes("inworld") && (await openPacks(env, userId)).some(packRoom)) return { now: "finest", bestLeft, pack: true };
  if (pv.voice === "local") return { now: "everyday", bestLeft };
  const back = pv.voice === "inworld" && bestLeft === 0 ? window.resetsAt : nextMonth(now);
  if (ready.includes("deepinfra") && room >= replyMax(plan) * rate("deepinfra"))
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
  // The first-run trial (lib/best-first.js) picks her voice from all of hers while its days last.
  const heard = withTrial(plan, taste?.trial);
  // pick: the Willo voice this plan hears, from the one the account last picked on its PC (lib/plan-usage.js
  // savedPick), so the iPhone can show it.
  const [own, saved] = await Promise.all([planVoice(env, userId, heard, now, taste?.trial), savedPick(env, userId)]);
  const pick = willoPick(heard, saved);
  return taste?.on && readyFor(env, "willo").includes("inworld") ? { ...own, tier: "hosted", now: "finest", pick }
    : { ...own, pick };
}
async function planVoice(env, userId, plan, now, trial = null) {
  const pv = plan.voice, choice = Boolean(pv.choice);
  // azeroth: the Voices of Azeroth are in her picker (Legend's, and the first-run trial's); whole: her whole answer is
  // spoken, not only its short spoken part (every plan's since 10/21); readings: the add-on's short answers in the
  // narrator's voice (speakReading, Hero and up); npcReadings: the add-on's quest pages with no recording in the giver's
  // voice (speakQuestPage, Champion and up, and the first-run trial's character tries). The companion shows and asks
  // by them.
  const more = { azeroth: Boolean(pv.azeroth), whole: Boolean(pv.whole), readings: readsAloud(plan),
                 npcReadings: readsQuests(plan, trial) };
  const pc = { tier: "local", top: "everyday", now: "everyday", choice, ...more };
  if (plan.id === "free") {
    // The free pool's soft step (lib/billing.js planFor's brake, lib/free-pool.js): her answers are text, said in her
    // own voice on the PC; the starter's hosted ones wait for the next day's slice.
    if (plan.brake) return { ...pc, starterLeft: 0 };
    if (pv.always) return readyFor(env, "willo").includes("deepinfra")
      ? { tier: "hosted", top: "studio", now: "studio", choice, ...more, starterLeft: 0 } : { ...pc, starterLeft: 0 };
    if (!pv.starter) return { ...pc, starterLeft: 0 };
    await setupBilling(env);
    const starterLeft = Math.max(0, STARTER_ANSWERS - await starterSaid(env, userId));
    return starterLeft > 0 && readyFor(env, "willo").includes("deepinfra")
      ? { tier: "hosted", top: "studio", now: "studio", choice, ...more, starterLeft } : { ...pc, starterLeft };
  }
  if (!readyFor(env, "willo").length || (pv.voice === "local" && !paying(plan))) return pc;
  await setupBilling(env);
  const s = await standing(env, userId, plan, now);
  if (pv.voice === "local" && s.now !== "finest") return pc;
  return { tier: s.now === "everyday" ? "local" : "hosted", top: TOP[pv.voice], now: s.now,
           ...(s.back ? { back: s.back } : {}), choice, ...more, ...(pv.voice === "inworld" ? { bestLeft: s.bestLeft } : {}) };
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
async function inworld(env, text, voiceId, model, firstAudioMs = 0, wholeMs = PROVIDER_MS) {
  const stop = new AbortController();
  const late = (ms, what) => setTimeout(() => stop.abort(new Error(`Inworld: ${what} in ${ms} ms`)), ms);
  const whole = late(wholeMs, "not done"), first = firstAudioMs ? late(firstAudioMs, "no audio") : null;
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

async function deepinfra(env, text, voiceId, model, firstAudioMs, wholeMs = PROVIDER_MS) {
  const res = await fetch(PROVIDERS.deepinfra.url, {
    method: "POST", headers: { Authorization: `Bearer ${env.DEEPINFRA_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_id: voiceId, response_format: "mp3", exaggeration: 0.5, cfg: 0.5 }),
    signal: AbortSignal.timeout(wholeMs),
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
async function fish(env, input, ref, wholeMs = PROVIDER_MS) {
  const res = await fetch(FISH.url, {
    method: "POST", headers: { Authorization: `Bearer ${env[FISH.key]}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: FISH.model, input, response_format: "mp3", provider: { data_collection: "deny" },
      input_references: [{ type: "input_audio", input_audio: { data: ref.audio } }, { type: "text", text: ref.text }] }),
    signal: AbortSignal.timeout(wholeMs),
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
// (the reply is past replyMax: SPEAK_MAX_CHARS, a whole-answer plan's WHOLE_MAX_CHARS), "unavailable" (no voice set up
// here, or no provider could say it). piece: {text,
// voice ("willo", or a character's people and gender: isVoiceKey), reply (its REPLY_ID, the same for each of its
// pieces), pick (the player's Willo voice, as willoPick allows it), spellings (hostedSpellings: the names respelled for
// the providers)}.
//
// A character speaks in a voice of their own where their people and gender has one (lib/character-voices.js: an
// Inworld voice, a reference for Fish, or both) and the reply is one the plan gives characters (PLAN_VOICE characters:
// Champion's own count, Legend's out of its finest replies) or a finest-voice pack's; otherwise in Willo's voice,
// exactly as Willo's own reply would be. Their own voice is Inworld's (CHARACTER_MODEL), then Fish's when Inworld
// fails or sends no audio in CHARACTER_FIRST_AUDIO_MS; when neither can, or the month's room won't hold it, the
// character steps down to Willo's studio voice (a hosted plan), or the PC, silently. The free plan's spoken starter is
// Willo's own voice, characters' replies too. line: one of Willo's own lines, not a reply (speakLine); reading: a line
// that is the add-on's own short answer read aloud (LOR-547), said on the PC ({local: "reading"}): readings in the
// narrator's voice are speakReading's.
//
// later (the request's waitUntil, optional): what a said piece cost and that it was heard are written after its audio
// has gone back, not before (its hold on the month's cap counts until then); without it, before speakPiece returns.
export async function speakPiece(env, userId, plan, { text, voice, reply, pick, piece, line = false, reading = false,
                                 spellings = {} }, now = new Date(), later = null) {
  // The add-on's short answers read aloud go through speakReading, in the narrator's voice; asked as one of Willo's own
  // lines (an older companion's way, which never asks), they're said on the PC.
  if (line && reading) return { local: "reading", status: 402 };
  const pv = plan?.voice;
  const free = plan?.id === "free";
  if (!plansOn(env) || !pv || (free && !pv.starter && !pv.always)) return { local: "plan", status: 402 };
  if (line) return speakLine(env, userId, plan, { text, pick, spellings }, now, later);
  // A reply the account's best first earned is said in the finest voice (speakTaste); any other, the plan's way below.
  if (tasteFor(env, plan)) {
    const seen = {};
    const tasted = await speakTaste(env, userId, plan, { text, voice, reply, pick, piece, spellings }, now, later, seen);
    if (tasted) return tasted;
    // The first-run trial's days (lib/best-first.js): her voice picked from all of hers on the plan's own path too.
    plan = withTrial(plan, seen.trial);
  }
  const hostedPlan = pv.voice !== "local";
  const character = voice !== "willo" ? characterVoices(env)[voice] : null;
  const ownInworld = character?.inworld && env[PROVIDERS.inworld.key] ? character.inworld : null;
  const ownFish = Boolean(character && env[FISH.key] && env.STUDIO);
  const cast = Boolean(!free && pv.characters && character && (ownInworld || ownFish));
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
  const period = free && !pv.always ? STARTER_PERIOD : poolWindow(plan, now).key;
  // A new reply (one statement, so two said at once can't both take the month's last place, or the starter's last);
  // an older plan month's go first. best: Legend's finest replies say it (Willo's Inworld voice, or a character's own,
  // which shares them); npc: one of Champion's character replies.
  const best = pv.voice === "inworld" && finestReady && (!cast || pv.characters === "best") ? pv.best || 0 : 0;
  const npc = cast && Number.isInteger(pv.characters) ? pv.characters : 0;
  const mine = "FROM voice_replies WHERE user_id = ? AND period = ?";
  // The reply made (or found), whether the free plan's starter has it, the account's finest-voice packs and this
  // piece's letters, in one round trip (LOR-673: one after another, a player far from the database waited about a
  // second before the voice even started, and the companion gives a first piece 2.5 s). Each decision below reads them
  // in the order they were made one at a time; a reply that turns out not to be said is deleted, letters and all.
  const chars = text.length;
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM voice_replies WHERE user_id = ? AND period < ?").bind(userId, period),
    env.DB.prepare(
      "INSERT OR IGNORE INTO voice_replies (user_id, reply, period, best, npc, created) SELECT ?, ?, ?, " +
      `CASE WHEN (SELECT COALESCE(SUM(best), 0) ${mine}) < ? THEN 1 ELSE 0 END, ` +
      `CASE WHEN (SELECT COALESCE(SUM(npc), 0) ${mine}) < ? THEN 1 ELSE 0 END, ? ` +
      `WHERE ? = 0 OR (SELECT COUNT(*) ${mine}) < ? RETURNING best, npc`
    ).bind(userId, reply, period, userId, period, best, userId, period, npc, now.toISOString(),
           free && !pv.always ? 1 : 0, userId, period, STARTER_ANSWERS),
    env.DB.prepare("SELECT 1 AS y FROM voice_replies WHERE user_id = ? AND reply = ?").bind(userId, reply),
    ...(packs ? [openPacksStatement(env, userId)] : []),
    ...countStatements(env, userId, reply, period, chars, piece, "best, npc, pack, chars", replyMax(plan)),
  ]);
  const [, made, kept] = results;
  // The free plan's starter is said: the rest are text (lib/billing.js companionFeatures).
  if (free && !made.meta.changes && !kept.results?.[0]) return { local: "spent", status: 402 };
  const { taken, again, bit } = countedPiece(results.slice(-2), piece);
  // A reply the plan's own finest voice doesn't say takes one of a finest-voice pack's (the oldest with room), once,
  // when it starts; a PC plan's reply without one is said on the PC.
  if (made.meta.changes && packs) {
    const row = made.results?.[0] ?? await env.DB.prepare("SELECT best, npc FROM voice_replies WHERE user_id = ? AND " +
      "reply = ?").bind(userId, reply).first();
    const own = row?.best || row?.npc;
    const pack = own ? null : (results[3].results || []).find(packRoom);
    const took = pack && await env.DB.prepare("UPDATE answer_packs SET remaining = remaining - 1 WHERE id = ? AND " +
      "status = 'active' AND remaining > 0 RETURNING id").bind(pack.id).first();
    if (took) {
      await env.DB.prepare("UPDATE voice_replies SET pack = ? WHERE user_id = ? AND reply = ?").bind(took.id, userId, reply).run();
      if (taken) taken.pack = took.id;
    } else if (!hostedPlan && !own) {
      await env.DB.prepare("DELETE FROM voice_replies WHERE user_id = ? AND reply = ?").bind(userId, reply).run();
      return { local: "plan", status: 402 };
    }
  }
  if (!taken) return { local: "long", status: 413 };
  // A later piece (the companion numbers them; an older one's: letters already counted) gets LATER_PIECE_MS.
  const wholeMs = piece > 0 || (piece === undefined && taken.chars > chars) ? LATER_PIECE_MS : PROVIDER_MS;
  // The reply's letters before this piece: the month's room held a whole reply when it started, so a later piece only
  // needs room for what's left of it, and a reply that started in a voice can finish in it.
  const before = taken.chars - chars;
  // The reply's finest voice when it has one (a character's own: Inworld, then Fish; else Willo's Inworld voice), then
  // studio (a PC plan has no studio voice). Each holds its cost first, while the rest of the reply in that voice still
  // fits: a pack's against the pack, the free plan's starter on the shared free budget, the rest against the month's
  // total. One that won't steps down, and so does one whose provider fails, but only while nothing else of the reply
  // is said or on its way (the companion asks for the next piece while one plays): each first takes the reply for its
  // provider (claim), and the reply's other pieces then go only there (LOR-596).
  const spoken = respell(text, spellings);
  const input = cast && character.cue ? `${character.cue} ${spoken}` : spoken;
  const finest = !(taken.best || taken.npc || taken.pack) ? []
    : cast ? [...(ownInworld ? [{ provider: "inworld", model: CHARACTER_MODEL, pack: taken.pack, voiceId: ownInworld,
                                  firstAudioMs: CHARACTER_FIRST_AUDIO_MS }] : []),
              ...(ownFish ? [{ provider: "fish", pack: taken.pack }] : [])]
    : [{ provider: "inworld", model: taken.best ? pv.model : PACK_MODEL, pack: taken.best ? null : taken.pack }];
  const order = [...finest, ...(hostedPlan ? [{ provider: "deepinfra" }] : [])]
    .filter(s => s.voiceId || s.provider === "fish" || ready.includes(s.provider));
  let full = false;
  for (const { provider, model, pack, voiceId, firstAudioMs } of order) {
    const micro = provider === "fish" ? fishCost(input) : chars * rate(provider, model);
    const left = replyMax(plan) - before;
    const need = provider === "fish" ? Math.ceil(left * FISH_MICRO_PER_BYTE) : left * rate(provider, model);
    // The reply taken for this provider and the piece's cost held, in one round trip: held only where the claim took.
    const claimed = await claimAndHold(env, userId, reply, provider, free ? { micro, now }
      : { micro, now, opts: pack ? { packId: pack, packCap: VOICE_PACK.costCapMicro, total: true, need }
        : { cap: plan.totalCapMicro, total: true, need, launch: Boolean(plan.launch) } });
    if (!claimed) continue;
    const hold = claimed.hold;
    if (!hold) { full = true; continue; }
    try {
      let audio;
      if (provider === "fish") {
        const ref = await reference(env, character);
        if (!ref) throw new Error(`no reference for ${voice} in R2 (${character.r2})`);
        audio = await fish(env, input, ref, wholeMs);
      } else audio = await CALLS[provider](env, spoken, voiceId || ids[provider], model, firstAudioMs, wholeMs);
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
  // Nothing could say it: this piece's letters go back (when this ask counted them: not an ask again of a piece
  // counted before), and the reply too when none of its pieces is said or on its way (its place among the plan's with
  // it, and a pack's reply to its pack).
  await env.DB.batch([
    ...(again ? [] : [uncount(env, userId, reply, chars, bit)]),
    env.DB.prepare("UPDATE answer_packs SET remaining = remaining + 1 WHERE id = (SELECT pack FROM voice_replies WHERE " +
      "user_id = ? AND reply = ? AND pieces <= 0 AND heard = 0) AND status = 'active' AND remaining < answers")
      .bind(userId, reply),
    env.DB.prepare("DELETE FROM voice_replies WHERE user_id = ? AND reply = ? AND pieces <= 0 AND heard = 0")
      .bind(userId, reply),
  ]);
  return full ? { local: "spent", status: 402 } : { local: "unavailable", status: 503 };
}

// A reply the companion gave up on before its first piece came back (PIECE_WAIT, companion/lore_companion/talk/tts.py),
// and said in Willo's own voice on the PC instead: POST /api/companion/speak {reply, unheard: true} (LOR-673). It
// isn't one of the hosted voice's replies, so its place goes back: one of a plan month's finest (Legend's best) or a
// character's (Champion's npc), one of the free starter's, a finest-voice pack's reply, or the finest reply a taste
// answer earned (best_first.voices). What its pieces cost stays where it went (the player's month, the shared budget
// and the taste's day): the providers were paid, and the caps are there for what we spend. The piece it gave up on may
// still be on its way here, so this waits settleMs for it to be counted first (a request's waitUntil); a reply older
// than UNHEARD_WITHIN_MS is left alone. Returns whether one went back.
export const UNHEARD_SETTLE_MS = 8000;
export const UNHEARD_WITHIN_MS = 120_000;
export async function forgetReply(env, userId, reply, now = new Date(), { settleMs = UNHEARD_SETTLE_MS } = {}) {
  if (settleMs > 0) await new Promise(done => setTimeout(done, settleMs));
  await setupBilling(env);
  const gone = await env.DB.prepare("DELETE FROM voice_replies WHERE user_id = ? AND reply = ? AND created >= ? " +
    "RETURNING period, pack, best, npc").bind(userId, reply, new Date(now.getTime() - UNHEARD_WITHIN_MS).toISOString()).first();
  if (!gone) return false;
  // A taste reply's finest place, and a character's own voice the first-run trial gave it (lib/best-first.js TRIAL).
  const taste = gone.period === TASTE_PERIOD;
  await Promise.all([taste && gone.best ? giveVoice(env, userId) : null, taste && gone.npc ? untry(env, userId, "cast") : null,
    gone.pack ? env.DB.prepare("UPDATE answer_packs SET remaining = remaining + 1 WHERE id = ? AND status = 'active' AND " +
      "remaining < answers").bind(gone.pack).run() : null]);
  return true;
}

// The taste's voice (lib/best-first.js) is held on the free pool like the free plan's studio voice (reserveFreeVoice,
// up to the day's allowance: on the soft step it rests) and on the taste's daily cap too: {day} when both hold
// `micro`, else null (neither kept).
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
// counted for good, never among the plan month's or the starter's. Willo in her finest voice (Inworld), a character in
// their own (Inworld, then Fish), stepping down to Willo's studio voice when those fail; one voice a reply, as
// speakPiece's (LOR-596). A reply nothing could say gives its place back.
// The first-run trial (lib/best-first.js TRIAL), while its days last: Willo in the voice they picked (withTrial), and
// a character in their own voice only with one of the trial's (cast: voice_replies.npc), which a character's reply may
// take after the taste's finest replies are gone too; without one, Willo's finest voice says a character's reply, as
// on the plans without characters' voices. seen.trial: the trial as it read it, for speakPiece's own path.
// tasteDone: accounts whose trial's days are over, so their replies skip the look here; tasteSaid: accounts whose
// taste is all said, by when their trial's days end, so Willo's own replies skip it too and only take their pick from
// it (this isolate's: the plan's own path waited a round trip to D1 for nothing, LOR-673).
const tasteDone = new Set(), tasteSaid = new Map();
async function speakTaste(env, userId, plan, { text, voice, reply, pick, piece, spellings }, now, later, seen = {}) {
  const character = voice !== "willo" ? characterVoices(env)[voice] : null;
  const ownInworld = character?.inworld && env[PROVIDERS.inworld.key] ? character.inworld : null;
  const ownFish = Boolean(character && env[FISH.key] && env.STUDIO);
  const castable = Boolean(character && (ownInworld || ownFish));
  const ready = readyFor(env, "willo");
  // A reply's later pieces always look (Mike's 0.25.0 QA, 10/21): the reply may be the taste's last finest one, begun
  // before tasteSaid knew it was all said, and its rest belongs with it, in its voice; the plan's own path would find
  // it under TASTE_PERIOD and call it too long.
  const rest = Number.isInteger(piece) && piece > 0;
  if ((!castable && !ready.includes("inworld")) || (tasteDone.has(userId) && !rest)) return null;
  const said = rest ? undefined : tasteSaid.get(userId);
  if (said && !castable) {
    if (now.getTime() < said) {
      seen.trial = { on: true };
      return null;
    }
    tasteDone.add(userId);
    return null;
  }
  await setupBilling(env);
  const [mine, owed, day] = await env.DB.batch([
    env.DB.prepare("SELECT period, best, npc FROM voice_replies WHERE user_id = ? AND reply = ?").bind(userId, reply),
    trialRow(env, userId),
    tasteRoom(env, now),
  ]);
  const given = mine.results?.[0], period = given?.period, taste = owed.results?.[0];
  const trial = seen.trial = trialOf(env, plan, taste, now);
  if (trial?.on && trial.until && taste.used >= TASTE_ANSWERS && !(taste.voices > 0)) tasteSaid.set(userId, Date.parse(trial.until));
  if (period && period !== TASTE_PERIOD) return null;
  // Whether the reply took one of the finest replies owed (best) and a character's own voice (cast).
  let best = Boolean(given?.best), cast = castable && Boolean(given?.npc);
  if (!period) {
    if (!trial?.on) {
      if (taste?.started) tasteDone.add(userId);
      return null;
    }
    const owes = taste?.voices > 0, castOk = castable && Boolean(taste) && trial.left.cast > 0;
    if (!owes && !castOk) return null;
    if (!roomIn(day)) {
      await countDay(env, now, "capped");
      return null;
    }
    [cast, best] = await Promise.all([castOk && tryOnce(env, taste.claim, "cast", now), owes && takeVoice(env, userId)]);
    cast = Boolean(cast);
    best = Boolean(best);
    if (!best && !cast) return null;
    const made = await env.DB.prepare("INSERT OR IGNORE INTO voice_replies (user_id, reply, period, best, npc, created) " +
      "VALUES (?, ?, ?, ?, ?, ?)").bind(userId, reply, TASTE_PERIOD, best ? 1 : 0, cast ? 1 : 0, now.toISOString()).run();
    if (!made.meta.changes) {
      await Promise.all([best ? giveVoice(env, userId) : null, cast ? untry(env, userId, "cast") : null]);
      return null;
    }
  }
  const chars = text.length;
  const { taken, again, bit } = await countPiece(env, userId, reply, TASTE_PERIOD, chars, piece, "chars",
    replyMax(plan));
  if (!taken) return { local: "long", status: 413 };
  const first = !again && taken.chars === chars;
  const wholeMs = piece > 0 || (piece === undefined && taken.chars > chars) ? LATER_PIECE_MS : PROVIDER_MS;
  const { ids, names } = willoVoice(env, withTrial(plan, trial), pick);
  const spoken = respell(text, spellings);
  const input = cast && character.cue ? `${character.cue} ${spoken}` : spoken;
  const order = [...(cast
    ? [...(ownInworld ? [{ provider: "inworld", model: CHARACTER_MODEL, voiceId: ownInworld,
                          firstAudioMs: CHARACTER_FIRST_AUDIO_MS }] : []), ...(ownFish ? [{ provider: "fish" }] : [])]
    : [{ provider: "inworld", model: LEGEND_BEST_MODEL }]), { provider: "deepinfra" }]
    .filter(s => s.voiceId || s.provider === "fish" || ready.includes(s.provider));
  let full = false;
  for (const { provider, model, voiceId, firstAudioMs } of order) {
    const micro = provider === "fish" ? fishCost(input) : chars * rate(provider, model);
    // The reply taken for this provider and the taste's holds, in one round trip (claimAndHold, LOR-673).
    const claimed = await claimAndHold(env, userId, reply, provider, { micro, now, taste: true });
    if (!claimed) continue;
    const hold = claimed.hold;
    if (!hold) { full = true; continue; }
    try {
      let audio;
      if (provider === "fish") {
        const ref = await reference(env, character);
        if (!ref) throw new Error(`no reference for ${voice} in R2 (${character.r2})`);
        audio = await fish(env, input, ref, wholeMs);
      } else audio = await CALLS[provider](env, spoken, voiceId || ids[provider], model, firstAudioMs, wholeMs);
      if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new Error(`${provider} sent ${audio.length} bytes of audio`);
      await afterAudio(Promise.all([settleTaste(env, hold, micro, true, first ? { replies: 1 } : {}, now),
        env.DB.prepare("UPDATE voice_replies SET heard = heard + 1 WHERE user_id = ? AND reply = ?").bind(userId, reply).run()]),
        later, provider);
      return { audio, provider, voice: `${provider === "deepinfra" ? "studio" : "finest"}:${cast && provider !== "deepinfra" ? voice : names[provider]}` };
    } catch (e) {
      await settleTaste(env, hold, micro, false, {}, now);
      console.warn(`companion voice: a first reply: ${provider}${voiceId || provider === "fish" ? ` (${voice})` : ""}: ${e?.message || e}`);
    }
  }
  const gone = (await env.DB.batch([
    ...(again ? [] : [uncount(env, userId, reply, chars, bit)]),
    env.DB.prepare("DELETE FROM voice_replies WHERE user_id = ? AND reply = ? AND pieces <= 0 AND heard = 0")
      .bind(userId, reply),
  ])).at(-1);
  await Promise.all([gone.meta.changes && best ? giveVoice(env, userId) : null,
    gone.meta.changes && cast ? untry(env, userId, "cast") : null, countDay(env, now, "unreachable")]);
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
// The add-on's short answers read aloud in the player's own narrator's voice (Mike, 2026-10-19: "We should host those
// voices and require a hero plan to listen to short answers"; the voices and plans picks, 10/21: the studio engine
// first). From Hero up (lib/billing.js READINGS_FROM; the beta's free Hero month and a friends' free month too), said
// live from the answer's text as the add-on shows it now, never recorded ahead. narrator: the narrator at the top of
// the player's narrator list, "chronicler" (the male narrator) or "female"; a community narrator's voice is never
// copied, so the companion shows those as text and never asks. The studio engine only (DeepInfra Chatterbox Turbo),
// cloned from the pack narrators' own references (experiments/voices/narrators/m-chronicler-1.wav and
// f-campfire-2.wav, the first 10 s; ~/lab/voice-pricing-picks/narrator-readings); the Pages variable NARRATOR_VOICES
// (JSON, {"chronicler": "<id>"}) replaces an id. A reading isn't an answer: nothing is counted, and its cost (about
// $0.0002 for a typical one) goes on the player's month within its total cap (holdUserSpend); in the free plan's
// first-run trial, on the shared free budget (reserveFreeVoice). Without room, or without the voice here, the companion shows the answer as text: {local: "spent" |
// "unavailable" | "plan" | "narrator"}.
export const NARRATOR_STUDIO = { chronicler: "wb5jgo95yl22fg3etv8g", female: "sk0s2twuhv4p8tyal7up" };
export const NARRATORS = Object.keys(NARRATOR_STUDIO);
// A reading isn't waited on as a reply's first word is: a 400-letter answer took the studio voice 2 to 5 s (10/21).
export const READING_MS = 8000;
const PLAN_ORDER = Object.keys(PLANS);
// The first-run trial reads them too (lib/best-first.js withTrial: voice.readings).
export const readsAloud = plan => Boolean(plan?.voice) && (plan.voice.readings === true
  || PLAN_ORDER.indexOf(plan.id) >= PLAN_ORDER.indexOf(READINGS_FROM));
export function narratorIds(env) {
  let extra = {};
  try { extra = env?.NARRATOR_VOICES ? JSON.parse(env.NARRATOR_VOICES) : {}; }
  catch (e) { console.warn("companion voice: NARRATOR_VOICES isn't JSON; using the ids in the code"); }
  return Object.fromEntries(NARRATORS.map(n => [n, typeof extra?.[n] === "string" && VOICE_ID.test(extra[n])
    ? extra[n] : NARRATOR_STUDIO[n]]));
}
export async function speakReading(env, userId, plan, { text, narrator, spellings = {} }, now = new Date(), later = null) {
  if (!plansOn(env)) return { local: "plan", status: 402 };
  if (!readsAloud(plan) && tasteFor(env, plan)) plan = withTrial(plan, await trialFor(env, userId, plan, now));
  if (!readsAloud(plan)) return { local: "plan", status: 402 };
  if (!NARRATORS.includes(narrator)) return { local: "narrator", status: 400 };
  const id = narratorIds(env)[narrator];
  if (!id || !env.DEEPINFRA_API_KEY) return { local: "unavailable", status: 503 };
  await setupBilling(env);
  const micro = text.length * rate("deepinfra"), free = plan.id === "free";
  const hold = free ? await reserveFreeVoice(env, micro, now)
    : await holdUserSpend(env, userId, micro, now, { cap: plan.totalCapMicro, total: true,
      need: SPEAK_MAX_CHARS * rate("deepinfra"), launch: Boolean(plan.launch) });
  if (!hold) return { local: "spent", status: 402 };
  try {
    const audio = await deepinfra(env, respell(text, spellings), id, null, null, READING_MS);
    if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new Error(`deepinfra sent ${audio.length} bytes of audio`);
    await afterAudio(free ? settleFreeVoice(env, micro, true, now)
      : addVoiceSpend(env, userId, micro, now, hold, null, Boolean(plan.launch)), later, "deepinfra");
    return { audio, provider: "deepinfra", voice: `studio:${narrator}` };
  } catch (e) {
    await (free ? settleFreeVoice(env, micro, false, now) : releaseUserSpend(env, hold));
    console.warn(`companion voice: a reading: deepinfra: ${e?.message || e}`);
    return { local: "unavailable", status: 503 };
  }
}

// The add-on's quest pages that have no recording, read aloud (Mike, 2026-10-21: "for Willo read quest audio … when no
// recording exists. It shouldn't be her own voice. It should be the race and gender of the quest giver, or if it's not a
// quest giver and it's a book, then it should be a narrator. This should be for the tiers that have access to the quest
// giver voices for Willo."). The add-on names the page it shows in the sky (companion/lore_companion/readaloud.py), so
// this is asked with a key and the player's narrator and nothing else: POST /api/companion/speak {reading: true, quest:
// "quest:176#detail", narrator}. The words are the site's own (lib/quest-pages.js, the same neutral script the quest
// givers' recordings read), never the app's, and come back in the reply (text) for the companion's captions.
// The giver's voice is the studio engine's clone of the same reference the recorded quest-giver packs use (AZEROTH_STUDIO,
// hostedVoices) for a giver of a people and gender we have a voice for, else (a book, an object, a beast, a giver
// nothing says the gender of) the player's narrator, as speakReading's. Only the studio engine, DeepInfra Chatterbox
// Turbo at $1 a million letters: a page is about 260 letters on average, $0.00026. A script past SPEAK_MAX_CHARS is
// cut at the end of a sentence (cutAtSentence); none is today (the longest is 526), so it isn't said in pieces.
// Allowed where characters speak in their own voices (lib/billing.js PLAN_VOICE characters, Champion and up), and in
// the first-run trial's character tries (lib/best-first.js TRIAL.cast, one for each page, given back if nothing could
// say it). Not an answer: nothing is counted among the replies. Its cost goes on the player's month inside the total
// cap (holdUserSpend), as a reading's, or, in the trial, on the shared free budget and the taste's day (holdTaste), as
// a character's reply in the trial. Without a plan for it, room or the voice: {local: "plan" | "spent" | "unavailable" |
// "narrator"} and the companion keeps quiet; the quest window is its own text.
export const readsQuests = (plan, trial = null) => Boolean(plan?.voice?.characters)
  || Boolean(trial?.on && trial.claim && trial.left?.cast > 0);
export async function speakQuestPage(env, userId, plan, { quest, narrator, origin, spellings = {} }, now = new Date(), later = null) {
  if (!plansOn(env) || !plan?.voice) return { local: "plan", status: 402 };
  if (!NARRATORS.includes(narrator)) return { local: "narrator", status: 400 };
  const viaPlan = Boolean(plan.voice.characters);
  let trial = null;
  if (!viaPlan) {
    trial = await trialFor(env, userId, plan, now);
    if (!trial?.on || !trial.claim || !(trial.left.cast > 0)) return { local: "plan", status: 402 };
  }
  const page = await questPage(env, origin, quest);
  if (!page) return { local: "unavailable", status: 404 };
  const giver = page.voice && hostedVoices(env)[page.voice]?.deepinfra ? page.voice : null;
  const id = giver ? hostedVoices(env)[giver].deepinfra : narratorIds(env)[narrator];
  if (!id || !env.DEEPINFRA_API_KEY) return { local: "unavailable", status: 503 };
  const text = cutAtSentence(page.script, SPEAK_MAX_CHARS);
  const micro = text.length * rate("deepinfra");
  await setupBilling(env);
  let hold;
  if (viaPlan) {
    hold = await holdUserSpend(env, userId, micro, now, { cap: plan.totalCapMicro, total: true,
      need: SPEAK_MAX_CHARS * rate("deepinfra"), launch: Boolean(plan.launch) });
  } else {
    if (!await tryOnce(env, trial.claim, "cast", now)) return { local: "plan", status: 402 };
    hold = await holdTaste(env, micro, now);
    if (!hold) await untry(env, userId, "cast");
  }
  if (!hold) return { local: "spent", status: 402 };
  try {
    const audio = await deepinfra(env, respell(text, spellings), id, null, null, READING_MS);
    if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new Error(`deepinfra sent ${audio.length} bytes of audio`);
    await afterAudio(viaPlan ? addVoiceSpend(env, userId, micro, now, hold, null, Boolean(plan.launch))
      : settleTaste(env, hold, micro, true, {}, now), later, "deepinfra");
    return { audio, provider: "deepinfra", voice: `studio:${giver || narrator}`, text };
  } catch (e) {
    await Promise.all([viaPlan ? releaseUserSpend(env, hold) : settleTaste(env, hold, micro, false, {}, now),
      viaPlan ? null : untry(env, userId, "cast")]);
    console.warn(`companion voice: a quest page: deepinfra: ${e?.message || e}`);
    return { local: "unavailable", status: 503 };
  }
}

async function speakLine(env, userId, plan, { text, pick, spellings }, now, later = null) {
  const pv = plan.voice, free = plan.id === "free", ready = readyFor(env, "willo");
  if (!ready.length) return { local: "unavailable", status: 503 };
  await setupBilling(env);
  // While the account's best first is on (lib/best-first.js), her lines are in the voice its replies get: the finest,
  // then the studio voice, both on the taste's budget (holdTaste); in the voice they picked while the trial's days last.
  const state = tasteFor(env, plan) ? await tasteState(env, userId, plan, now) : null;
  plan = withTrial(plan, state?.trial);
  const taste = ready.includes("inworld") && Boolean(state?.on);
  let steps;
  if (taste) {
    steps = [{ voice: "finest", provider: "inworld", model: LEGEND_BEST_MODEL, taste }, { voice: "studio", provider: "deepinfra", taste }];
  } else if (free) {
    if (!pv.always && await starterSaid(env, userId) >= STARTER_ANSWERS) return { local: "spent", status: 402 };
    steps = [{ voice: "studio", provider: "deepinfra" }];
  } else {
    if (pv.voice === "local" && !paying(plan)) return { local: "plan", status: 402 };
    const s = await standing(env, userId, plan, now);
    steps = [...(s.now === "finest" ? [{ voice: "finest", provider: "inworld", model: pv.model || PACK_MODEL }] : []),
             ...(s.now !== "everyday" && pv.voice !== "local" ? [{ voice: "studio", provider: "deepinfra" }] : [])];
  }
  steps = steps.filter(s => ready.includes(s.provider));
  const { ids, names } = willoVoice(env, plan, pick);
  let full = !steps.length;
  for (const { voice, provider, model, taste: tasted } of steps) {
    const micro = text.length * rate(provider, model);
    const hold = tasted ? await holdTaste(env, micro, now) : free ? await reserveFreeVoice(env, micro, now)
      : await holdUserSpend(env, userId, micro, now,
        { cap: plan.totalCapMicro, total: true, need: SPEAK_MAX_CHARS * rate(provider, model), launch: Boolean(plan.launch) });
    if (!hold) { full = true; continue; }
    try {
      const audio = await CALLS[provider](env, respell(text, spellings), ids[provider], model);
      if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new Error(`${provider} sent ${audio.length} bytes of audio`);
      await afterAudio(tasted ? settleTaste(env, hold, micro, true, { lines: 1 }, now) : free ? settleFreeVoice(env, micro, true, now)
        : addVoiceSpend(env, userId, micro, now, hold, null, Boolean(plan.launch)), later, provider);
      return { audio, provider, voice: `${voice}:${names[provider]}` };
    } catch (e) {
      await (tasted ? settleTaste(env, hold, micro, false, {}, now) : free ? settleFreeVoice(env, micro, false, now)
        : releaseUserSpend(env, hold));
      console.warn(`companion voice: a line: ${provider}: ${e?.message || e}`);
    }
  }
  return full ? { local: "spent", status: 402 } : { local: "unavailable", status: 503 };
}
