// A profile's story read aloud (LOR-316): the written story on /u/<handle> (lib/profiles.js), recorded in the male
// campfire narrator's voice, with a Listen button over it (public/js/storyvoice.js). Each story is recorded once,
// the first time its page is opened. Only written stories: a template story changes with every update, and the
// add-on's own summary isn't worth a recording.
//
// Two engines. With the Pages secret OPENROUTER_API_KEY: Fish Audio S2.1 Pro through OpenRouter's /audio/speech, a
// stateless clone of the narrator from a reference recording and its transcript sent with every part (Mike picked it
// by ear on 2026-10-10: it sounds better than fal and costs about a sixth). Each story language has its own reference,
// read by a native speaker of that language (the voice packs' native references), because a clone of the English
// narrator speaking Spanish sounded wrong; a language without one isn't recorded and its story stays text. The parts
// are recorded at once, in the background of the page view, and saved as they come back (no webhook). The references
// are in R2 at story-voice/_narrators/<voice>/<lang>.wav and .txt, put there with the admin key by
// experiments/voices/local/story_voice_refs.py. Without that key but with FAL_KEY: fal.ai's hosted Qwen3-TTS 1.7B
// (the first engine, described below), English stories only.
//
// How a story is recorded: storyVoice(..., {kick}) on a page view finds no recordings for the story, so record() sends
// each part (a paragraph, or a sentence group of a long one, CHUNK characters at most, as the packs do) in the
// selected narrator's voice to fal's queue, with a webhook back to /api/profile/voice/hook (functions/api/profile/voice/hook.js,
// saveTake). The webhook's address carries an HMAC of the part (made with FAL_KEY), so nobody else can post a take.
// A part that fails is sent again, MAX_TRIES times in all. The recordings are in R2 (binding STUDIO) at
// story-voice/<user id>/<story>/<voice>-<part>.mp3 and served at /audio/story/<story>-<voice>-<part>-<sha>.mp3
// (functions/audio/story/[file].js) to whoever may see the profile. A new story's recordings replace the old one's.
//
// The narrators' voices: a speaker embedding of each narrator's reference recording (fal's clone-voice endpoint), in R2
// at story-voice/_narrators/<voice>.safetensors, put there with the admin key by
// experiments/voices/local/story_voice_embed.py. They stay out of the repo, like the reference recordings.
//
// Off unless the "storyvoice" site feature is on (lib/features.js) and OPENROUTER_API_KEY or FAL_KEY is set. What the
// recordings cost counts against the profile stories' monthly budget (lib/profiles.js, story_spend.voice_micro_usd).
//
// The page never says how the recordings are made; that's UI copy, not a secret (the privacy page names the services).

import { featureOn } from "./features.js";
import { escape } from "./voices.js";
import { sha256 } from "./accounts.js";
import { sniff } from "./studio.js";
import { storySpend, budgetMicro } from "./profiles.js";
import { answerBudgetUsed, reserveOtherPaid } from "./companion-answers.js";

// Known narrator ids, retained for stored recordings and embedding uploads. Profiles use one narrator for now;
// a later setting can select a narrator without changing how the recordings are stored.
export const NARRATORS = { "male-narrator": "Male narrator", "female-narrator": "Female narrator" };
export const DEFAULT_NARRATOR = "male-narrator";
const LANGUAGES = { en: "English", de: "German", fr: "French", es: "Spanish", pt: "Portuguese" };
const QUEUE = "https://queue.fal.run/fal-ai/qwen-3-tts/text-to-speech/1.7b";
// fal.ai's published price for that endpoint (fal.ai/models/fal-ai/qwen-3-tts/text-to-speech/1.7b, checked
// 2026-10-05): $0.09 per 1,000 characters, so 90 millionths of a dollar a character.
export const MICRO_USD_PER_CHAR = 90;
const SPEECH = "https://openrouter.ai/api/v1/audio/speech";
export const FISH_MODEL = "fish-audio/s2.1-pro";
// OpenRouter's price for it (openrouter.ai/api/v1/models, checked 2026-10-10): $15 per million bytes of text.
export const MICRO_USD_PER_BYTE = 15;
export const MAX_REFERENCE = 4 * 1024 * 1024;   // a reference is about 15 s of WAV
export const CHUNK = 500;          // characters per part at most, like render_fal.py and render_pack.py
export const MAX_TRIES = 2;
export const STALE_MS = 20 * 60e3;   // a part still waiting this long is sent again (its webhook never came)
const MAX_TAKE = 8 * 1024 * 1024;   // a part is under a minute of 48-64 kbps MP3, about half a megabyte
export const MAX_EMBEDDING = 256 * 1024;
const R2_PREFIX = "story-voice/";
const RESPELL = "/lore/data/respell.json";   // pipeline/lore/site_lore.py: names the narrators say as written there

export const embeddingKey = voice => `${R2_PREFIX}_narrators/${voice}.safetensors`;
export const referenceKey = (voice, lang) => `${R2_PREFIX}_narrators/${voice}/${lang}.wav`;
export const transcriptKey = (voice, lang) => `${R2_PREFIX}_narrators/${voice}/${lang}.txt`;
export const STORY_LANGUAGES = Object.keys({ en: 1, de: 1, fr: 1, es: 1, pt: 1 });
export const takeKey = (userId, story, voice, part) => `${R2_PREFIX}${userId}/${story}/${voice}-${part}.mp3`;
export const takeUrl = r => `/audio/story/${r.story}-${r.voice}-${r.part}-${r.sha}.mp3`;
export const TAKE_FILE = /^([0-9a-f]{16})-([a-z]+-narrator)-(\d{1,2})-([0-9a-f]{10})\.mp3$/;

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");

// ---- The table ----

// Created here rather than in lib/accounts.js SETUP, since only this feature uses it; "Delete my account" and "Delete my
// profile" call forgetStoryVoice. story: storyKey; part: its place in the story (storyParts); para: the paragraph it
// reads; chars: what it cost; status: queued, done or failed; sha: the first 10 hex of the recording's SHA-256.
const SETUP = [
  `CREATE TABLE IF NOT EXISTS story_audio (
    user_id TEXT NOT NULL, story TEXT NOT NULL, voice TEXT NOT NULL, part INTEGER NOT NULL, para INTEGER NOT NULL,
    chars INTEGER NOT NULL, status TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 1, request_id TEXT, sha TEXT, sec REAL,
    error TEXT, created TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY (user_id, story, voice, part))`,
  "CREATE INDEX IF NOT EXISTS story_audio_story ON story_audio (story, voice, part)",
];
const MIGRATE = ["ALTER TABLE story_spend ADD COLUMN voice_micro_usd INTEGER NOT NULL DEFAULT 0"];
let ready = false;
export async function setupStoryVoice(env) {
  if (ready) return;
  await env.DB.batch(SETUP.map(s => env.DB.prepare(s)));
  for (const sql of MIGRATE) {
    try { await env.DB.prepare(sql).run(); } catch (e) {}   // fails once the column exists
  }
  ready = true;
}

// ---- The story, as the narrator reads it ----

// The paragraphs as the page shows them (lib/profiles.js paragraphs), each split between sentences into parts of at
// most CHUNK characters: [{para, text}].
export function storyParts(story) {
  const out = [];
  String(story || "").split(/\n\s*\n/).map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean).forEach((p, para) => {
    let cur = "";
    for (const s of p.split(/(?<=[.!?])\s+/)) {
      if (cur && cur.length + 1 + s.length > CHUNK) { out.push({ para, text: cur }); cur = s; }
      else cur = `${cur} ${s}`.trim();
    }
    if (cur) out.push({ para, text: cur });
  });
  return out;
}

// Which story the recordings read: the first 16 hex of SHA-256 of the account and the story's text. Part of the
// recordings' addresses, so they change with the story and can't be guessed from the profile.
export const storyKey = async (userId, story) => (await sha256(`${userId}\n${story}`)).slice(0, 16);

// Names the narrators say as the packs spell them for the voice (data/pronunciation.json "qwen", lore.pronounce.respell):
// longest first, whole words only, possessives kept. English only, like the packs' respellings.
export function respell(text, names) {
  const list = Object.keys(names || {}).sort((a, b) => b.length - a.length);
  if (!list.length) return text;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\p{L}\\p{N}_'’])(${list.map(esc).join("|")})(?![\\p{L}\\p{N}_])`, "gu");
  return text.replace(re, m => names[m]);
}

const respellings = new WeakMap();
async function loadRespell(env, origin) {
  const assets = env?.ASSETS;
  if (!assets) return {};
  if (respellings.has(assets)) return respellings.get(assets);
  try {
    const res = await assets.fetch(new URL(RESPELL, origin));
    if (res.ok) {
      const names = await res.json();
      respellings.set(assets, names);
      return names;
    }
  } catch (e) {}
  return {};
}

// ---- Recording ----

// Which engine records: "fish" (OpenRouter), else "fal", else none.
export const engine = env => (env.OPENROUTER_API_KEY ? "fish" : env.FAL_KEY ? "fal" : null);
const canRecord = env => Boolean(engine(env) && env.STUDIO && env.DB);

// Whether `voice` can read a story in `lang` now: Fish needs that language's own reference and transcript; fal reads
// English only, with the narrator's embedding.
async function voiceReady(env, voice, lang) {
  if (engine(env) === "fish") {
    const [wav, txt] = await Promise.all([env.STUDIO.head(referenceKey(voice, lang)), env.STUDIO.head(transcriptKey(voice, lang))]);
    return Boolean(wav && txt);
  }
  return lang === "en" && Boolean(await env.STUDIO.head(embeddingKey(voice)));
}

function base64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// A narrator's reference in `lang` for Fish: {audio (a data: address), text}, or null.
async function reference(env, voice, lang) {
  const [wav, txt] = await Promise.all([env.STUDIO.get(referenceKey(voice, lang)), env.STUDIO.get(transcriptKey(voice, lang))]);
  if (!wav || !txt) return null;
  return { audio: "data:audio/wav;base64," + base64(await new Response(wav.body).arrayBuffer()), text: (await new Response(txt.body).text()).trim() };
}

// An MP3's length in seconds from its first frame's bitrate (Fish sends constant-bitrate MPEG-1 Layer III), or null.
const KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
export function mp3Seconds(buf) {
  const b = new Uint8Array(buf);
  let i = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33 && b.length > 10)   // "ID3": skip the tag
    i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  for (; i + 4 <= b.length; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xfe) !== 0xfa) continue;   // sync, MPEG-1, Layer III
    const kbps = KBPS[b[i + 2] >> 4];
    if (!kbps) return null;
    return Math.round(((b.length - i) * 8) / (kbps * 1000) * 100) / 100;
  }
  return null;
}

// Records one part with Fish and saves it: the take in R2 and the row done, or the row failed with why.
async function sendFish(env, { userId, story, voice, part, text, ref }) {
  const where = [userId, story, voice, part];
  const fail = why => env.DB.prepare("UPDATE story_audio SET status = 'failed', error = ?, updated = ? WHERE user_id = ? AND story = ? AND voice = ? AND part = ?")
    .bind(String(why).slice(0, 300), new Date().toISOString(), ...where).run();
  const cost = new TextEncoder().encode(text).length * MICRO_USD_PER_BYTE;
  const started = new Date();
  if (!(await reserveOtherPaid(env, cost, started))) return fail("monthly budget is full");
  let bytes;
  try {
    const res = await fetch(SPEECH, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: FISH_MODEL, input: text, response_format: "mp3", provider: { data_collection: "deny" },
                             input_references: [{ type: "input_audio", input_audio: { data: ref.audio } }, { type: "text", text: ref.text }] }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    bytes = await res.arrayBuffer();
  } catch (e) {
    await env.DB.prepare("UPDATE story_spend SET reserved_micro = reserved_micro - ? WHERE month = ?")
      .bind(cost, started.toISOString().slice(0, 7)).run();
    console.warn(`story voice: ${e.message}`);
    return fail(e.message);
  }
  await env.DB.prepare("UPDATE story_spend SET voice_micro_usd = voice_micro_usd + ?, reserved_micro = reserved_micro - ? WHERE month = ?")
    .bind(cost, cost, started.toISOString().slice(0, 7)).run();
  if (!bytes.byteLength || bytes.byteLength > MAX_TAKE || sniff(bytes)?.ext !== "mp3") return fail("not an MP3");
  const sha = hex(await crypto.subtle.digest("SHA-256", bytes));
  await env.STUDIO.put(takeKey(userId, story, voice, part), bytes, { sha256: sha, httpMetadata: { contentType: "audio/mpeg" } });
  await env.DB.prepare("UPDATE story_audio SET status = 'done', sha = ?, sec = ?, error = NULL, updated = ? WHERE user_id = ? AND story = ? AND voice = ? AND part = ?")
    .bind(sha.slice(0, 10), mp3Seconds(bytes), new Date().toISOString(), ...where).run();
}

async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg))).slice(0, 32);
}
export const hookToken = (env, story, voice, part) => hmac(env.FAL_KEY, `story-voice|${story}|${voice}|${part}`);

export async function hookUrl(env, origin, story, voice, part) {
  const q = new URLSearchParams({ s: story, v: voice, i: String(part), t: await hookToken(env, story, voice, part) });
  return `${origin}/api/profile/voice/hook?${q}`;
}

// A narrator's voice for fal: its speaker embedding as a data: address (fal reads those like any file address).
async function embedding(env, voice) {
  const obj = await env.STUDIO.get(embeddingKey(voice));
  if (!obj) return null;
  return "data:application/octet-stream;base64," + base64(await new Response(obj.body).arrayBuffer());
}

// Whether this month's budget has room (lib/profiles.js: the stories and their recordings together).
async function budgetLeft(env) {
  const s = await storySpend(env);
  return (s.micro_usd || 0) + (s.voice_micro_usd || 0) + (s.reserved_micro || 0) +
    await answerBudgetUsed(env) < budgetMicro(env);
}

// Sends one part to fal's queue. Returns its request id; throws when fal says no.
async function send(env, origin, { story, voice, part, text, lang, voiceData }) {
  const hook = await hookUrl(env, origin, story, voice, part);
  const cost = text.length * MICRO_USD_PER_CHAR;
  const started = new Date();
  if (!(await reserveOtherPaid(env, cost, started))) throw new Error("monthly budget is full");
  const res = await fetch(`${QUEUE}?fal_webhook=${encodeURIComponent(hook)}`, {
    method: "POST",
    headers: { Authorization: `Key ${env.FAL_KEY}`, "Content-Type": "application/json" },
    // max_new_tokens: 12 codec frames a second, allowing 10 characters a second (the default stops at ~16 s).
    body: JSON.stringify({ text, language: LANGUAGES[lang] || "English", speaker_voice_embedding_file_url: voiceData,
                           max_new_tokens: 12 * (Math.floor(text.length / 10) + 5) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`fal ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  await env.DB.prepare("UPDATE story_spend SET voice_micro_usd = voice_micro_usd + ?, " +
    "reserved_micro = reserved_micro - ? WHERE month = ?")
    .bind(cost, cost, started.toISOString().slice(0, 7)).run();
  return (await res.json()).request_id || null;
}

// The text a part reads: the story's part, respelled for the voice in English.
async function partText(env, origin, p, part) {
  const parts = storyParts(p.story);
  if (!parts[part]) return null;
  const lang = p.data?.locale || "en";
  return { text: lang === "en" ? respell(parts[part].text, await loadRespell(env, origin)) : parts[part].text, lang };
}

// Records profile `p`'s story (storyKey `story`) in the default narrator: one row per part and voice, each sent to
// Fish (all at once) or fal. Then removes the recordings of the account's earlier stories.
export async function record(env, p, story, origin) {
  if (!(await budgetLeft(env))) { console.warn("story voice: budget"); return; }
  const parts = storyParts(p.story);
  const lang = p.data?.locale || "en";
  const names = lang === "en" ? await loadRespell(env, origin) : {};
  const now = new Date().toISOString();
  const voice = DEFAULT_NARRATOR;
  if (engine(env) === "fish") {
    const ref = await reference(env, voice, lang);
    if (!ref) { console.warn(`story voice: no ${lang} reference for ${voice}`); return; }
    const jobs = [];
    for (const [part, { para, text }] of parts.entries()) {
      const said = lang === "en" ? respell(text, names) : text;
      const ins = await env.DB.prepare(
        "INSERT OR IGNORE INTO story_audio (user_id, story, voice, part, para, chars, status, created, updated) " +
        "VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)"
      ).bind(p.user_id, story, voice, part, para, said.length, now, now).run();
      if (ins.meta?.changes) jobs.push(sendFish(env, { userId: p.user_id, story, voice, part, text: said, ref }));
    }
    await Promise.all(jobs);
    await forgetStoryVoice(env, p.user_id, { keep: story });
    return;
  }
  if (lang !== "en") return;   // fal reads English only: a clone of the English narrator speaking another language sounds wrong
  const voiceData = await embedding(env, voice);
  if (!voiceData) { console.warn(`story voice: no embedding for ${voice}`); return; }
  for (const [part, { para, text }] of parts.entries()) {
    const said = lang === "en" ? respell(text, names) : text;
    // The row first, so a webhook that's faster than this loop finds it. A second page view at the same moment
    // loses the insert and sends nothing.
    const ins = await env.DB.prepare(
      "INSERT OR IGNORE INTO story_audio (user_id, story, voice, part, para, chars, status, created, updated) " +
      "VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)"
    ).bind(p.user_id, story, voice, part, para, said.length, now, now).run();
    if (!ins.meta?.changes) continue;
    try {
      const id = await send(env, origin, { story, voice, part, text: said, lang, voiceData });
      await env.DB.prepare("UPDATE story_audio SET request_id = ? WHERE user_id = ? AND story = ? AND voice = ? AND part = ?")
        .bind(id, p.user_id, story, voice, part).run();
    } catch (e) {
      console.warn(`story voice: ${e.message}`);
      await env.DB.prepare("UPDATE story_audio SET status = 'failed', error = ? WHERE user_id = ? AND story = ? AND voice = ? AND part = ?")
        .bind(String(e.message).slice(0, 300), p.user_id, story, voice, part).run();
    }
  }
  await forgetStoryVoice(env, p.user_id, { keep: story });
}

// Sends again the parts of `rows` that failed or whose webhook never came, while they have tries left.
async function retry(env, p, rows, origin) {
  const now = Date.now();
  const due = rows.filter(r => r.status !== "done" && r.tries < MAX_TRIES &&
    (r.status === "failed" || now - Date.parse(r.updated) > STALE_MS));
  for (const r of due) await resend(env, p, r, origin);
}

async function resend(env, p, r, origin) {
  if (r.voice !== DEFAULT_NARRATOR) return;   // old requests for another voice never start another paid render
  const claim = await env.DB.prepare(
    "UPDATE story_audio SET status = 'queued', tries = tries + 1, error = NULL, updated = ? " +
    "WHERE user_id = ? AND story = ? AND voice = ? AND part = ? AND tries = ? AND status != 'done'"
  ).bind(new Date().toISOString(), r.user_id, r.story, r.voice, r.part, r.tries).run();
  if (!claim.meta?.changes) return;   // someone else is sending it
  if (engine(env) === "fish") {
    const said = await partText(env, origin, p, r.part);
    const ref = said && await reference(env, r.voice, said.lang);
    if (said && ref) return sendFish(env, { userId: r.user_id, story: r.story, voice: r.voice, part: r.part, text: said.text, ref });
    await env.DB.prepare("UPDATE story_audio SET status = 'failed', error = ? WHERE user_id = ? AND story = ? AND voice = ? AND part = ?")
      .bind(said ? `no ${said.lang} reference` : "no such part", r.user_id, r.story, r.voice, r.part).run();
    return;
  }
  const said = await partText(env, origin, p, r.part);
  const voiceData = said && await embedding(env, r.voice);
  try {
    if (!said || !voiceData) throw new Error(said ? `no embedding for ${r.voice}` : "no such part");
    const id = await send(env, origin, { story: r.story, voice: r.voice, part: r.part, ...said, voiceData });
    await env.DB.prepare("UPDATE story_audio SET request_id = ? WHERE user_id = ? AND story = ? AND voice = ? AND part = ?")
      .bind(id, r.user_id, r.story, r.voice, r.part).run();
  } catch (e) {
    console.warn(`story voice: ${e.message}`);
    await env.DB.prepare("UPDATE story_audio SET status = 'failed', error = ? WHERE user_id = ? AND story = ? AND voice = ? AND part = ?")
      .bind(String(e.message).slice(0, 300), r.user_id, r.story, r.voice, r.part).run();
  }
}

// ---- What the page shows ----

// The recordings of profile `p`'s story, or null when there are none to offer (the feature's off, or the story isn't
// a written one): {story, narrator, pending, voices: {<voice>: [{url, sec, para}]}}, only the default narrator,
// and only once every part is recorded. Older recordings of other narrators do not affect readiness or retries.
// pending: some are still being recorded. kick: start recording a story that has none yet, and send again parts that
// failed or got stuck (in the background, with waitUntil), when the key is set and the budget has room.
export async function storyVoice(env, p, { kick = false, origin = "", waitUntil = null } = {}) {
  if (!featureOn(env, "storyvoice") || !env.DB || p?.story_source !== "written" || !p.story) return null;
  await setupStoryVoice(env);
  const story = await storyKey(p.user_id, p.story);
  const rows = (await env.DB.prepare("SELECT * FROM story_audio WHERE user_id = ? AND story = ? AND voice = ? ORDER BY part")
    .bind(p.user_id, story, DEFAULT_NARRATOR).all()).results;
  const later = job => (waitUntil ? waitUntil(job.catch(e => console.warn(`story voice: ${e.message}`))) : job);
  let starting = false;
  if (kick && canRecord(env)) {
    if (!rows.length) {
      if (await voiceReady(env, DEFAULT_NARRATOR, p.data?.locale || "en") && await budgetLeft(env)) {
        starting = true;
        await later(record(env, p, story, origin));
      }
    } else await later(retry(env, p, rows, origin));
  }
  const parts = storyParts(p.story).length;
  const voices = {};
  const mine = rows.filter(r => r.status === "done");
  if (parts && mine.length === parts) voices[DEFAULT_NARRATOR] = mine.map(r => ({ url: takeUrl(r), sec: r.sec || 0, para: r.para }));
  const pending = starting || rows.some(r => r.status === "queued" || (r.status === "failed" && r.tries < MAX_TRIES));
  return { story, narrator: DEFAULT_NARRATOR, pending: pending && canRecord(env), voices };
}

// The Listen box over the story (public/js/storyvoice.js builds its buttons): nothing until a voice is recorded, except
// for the owner while it's being recorded ("data-wait": the script asks GET /api/profile/voice until it's there).
export function listenBox(state, { owner = false, name = "", handle = "" } = {}) {
  if (!state) return "";
  const ids = [DEFAULT_NARRATOR].filter(v => state.voices[v]);
  const waiting = owner && state.pending && !ids.length;
  if (!ids.length && !waiting) return "";
  const data = { handle, name, narrator: DEFAULT_NARRATOR, voices: Object.fromEntries(ids.map(v => [v, state.voices[v]])) };
  return `<div class="pf-listen" data-story-voice="${escape(JSON.stringify(data))}"${waiting ? " data-wait" : ""} hidden></div>`;
}

// ---- The webhook: a take from fal ----

// Saves the take fal sends for one part (body: fal's webhook, {status, payload: {audio: {url, duration}}, error}).
// Returns an HTTP status: 200 when it's done with (saved, or nothing to save), 401 for a bad token, 502 when the take
// couldn't be fetched or stored (fal sends the webhook again).
export async function saveTake(env, q, body, origin) {
  const story = q.get("s") || "", voice = q.get("v") || "", part = Number(q.get("i"));
  if (!env.FAL_KEY || !/^[0-9a-f]{16}$/.test(story) || !NARRATORS[voice] || !Number.isInteger(part) || part < 0 || part > 99) return 401;
  const token = q.get("t") || "", want = await hookToken(env, story, voice, part);
  let diff = token.length ^ want.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (token.charCodeAt(i) || 0);
  if (diff) return 401;
  await setupStoryVoice(env);
  const row = await env.DB.prepare("SELECT * FROM story_audio WHERE story = ? AND voice = ? AND part = ?").bind(story, voice, part).first();
  if (!row || row.status === "done") return 200;   // a story that's been replaced, or a webhook sent twice
  const p = await env.DB.prepare("SELECT user_id, story, story_source, data FROM profiles WHERE user_id = ?").bind(row.user_id).first();
  if (!p || p.story_source !== "written" || (await storyKey(p.user_id, p.story)) !== story) return 200;
  const audio = body?.status === "OK" ? body.payload?.audio : null;
  let host = "";
  try { host = new URL(audio?.url).hostname; } catch (e) {}
  if (!audio || !(host === "fal.media" || host.endsWith(".fal.media"))) {
    const why = String(body?.error || (audio ? `unexpected host ${host}` : "no audio")).slice(0, 300);
    await env.DB.prepare("UPDATE story_audio SET status = 'failed', error = ?, updated = ? WHERE user_id = ? AND story = ? AND voice = ? AND part = ?")
      .bind(why, new Date().toISOString(), row.user_id, story, voice, part).run();
    if (row.tries < MAX_TRIES) {
      let data = null;
      try { data = JSON.parse(p.data); } catch (e) {}
      await resend(env, { ...p, data }, { ...row, status: "failed" }, origin);
    }
    return 200;
  }
  let bytes;
  try {
    const res = await fetch(audio.url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bytes = await res.arrayBuffer();
  } catch (e) {
    console.warn(`story voice: take ${story}/${voice}/${part}: ${e.message}`);
    return 502;
  }
  if (!bytes.byteLength || bytes.byteLength > MAX_TAKE || sniff(bytes)?.ext !== "mp3") {
    await env.DB.prepare("UPDATE story_audio SET status = 'failed', tries = ?, error = 'not an MP3', updated = ? WHERE user_id = ? AND story = ? AND voice = ? AND part = ?")
      .bind(MAX_TRIES, new Date().toISOString(), row.user_id, story, voice, part).run();
    return 200;
  }
  const sha = hex(await crypto.subtle.digest("SHA-256", bytes));
  await env.STUDIO.put(takeKey(row.user_id, story, voice, part), bytes, { sha256: sha, httpMetadata: { contentType: "audio/mpeg" } });
  const sec = Number(audio.duration);
  await env.DB.prepare("UPDATE story_audio SET status = 'done', sha = ?, sec = ?, error = NULL, updated = ? WHERE user_id = ? AND story = ? AND voice = ? AND part = ?")
    .bind(sha.slice(0, 10), Number.isFinite(sec) ? Math.round(sec * 100) / 100 : null, new Date().toISOString(),
          row.user_id, story, voice, part).run();
  return 200;
}

// ---- Removing them ----

// Removes an account's story recordings, files and rows; keep: a story key whose recordings stay (the current story).
export async function forgetStoryVoice(env, userId, { keep = null } = {}) {
  if (!env.DB) return;
  await setupStoryVoice(env);
  if (env.STUDIO) {
    let cursor;
    do {
      const page = await env.STUDIO.list({ prefix: `${R2_PREFIX}${userId}/`, cursor });
      const gone = page.objects.map(o => o.key).filter(k => !keep || !k.startsWith(`${R2_PREFIX}${userId}/${keep}/`));
      if (gone.length) await env.STUDIO.delete(gone);
      cursor = page.truncated ? page.cursor : null;
    } while (cursor);
  }
  await env.DB.prepare(`DELETE FROM story_audio WHERE user_id = ?${keep ? " AND story != ?" : ""}`)
    .bind(...(keep ? [userId, keep] : [userId])).run();
}
