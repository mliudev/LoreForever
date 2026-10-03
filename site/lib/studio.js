// The upload page (/voices/studio): contributors upload one recording per line of the clip list, per voice, and send
// the voice for review. Used by functions/api/studio/[action].js. Kept outside functions/ so Pages doesn't route it.
//
// Files live in R2 (binding STUDIO, bucket lore-forever-voices) at studio/<user id>/<voice id>/<file stem>.<ext>;
// D1 keeps one studio_takes row per file (tables in lib/accounts.js SETUP, so "Delete my account" removes them).
// A voice is a row of the accounts `voices` table with a locale: 'draft' until it's sent, then 'pending'.
// The lines come from public/voices/lines.json (pipeline: voicepack clips). Each take stores the hash of the text it
// was recorded against, so a line whose text changes afterwards shows as "text changed" and the pack build skips it.

import { slug, RESERVED } from "./accounts.js";

export const LIMITS = {
  bytes: 25 * 1024 * 1024,         // one file
  accountBytes: 1024 ** 3,         // everything one account keeps
  uploadsPerDay: 400,
  uploadsPerMinute: 60,            // a whole zip goes up one file at a time; the page waits when it hits this
  voices: 2,                       // voices one account can have on the upload page
};

// The audio we take, recognized by the file's first bytes rather than its name or Content-Type. Only mp3 and Ogg
// Vorbis play in game; the page converts the other kinds to mp3 first, so the server refuses them (PLAYABLE).
export function sniff(bytes) {
  const b = new Uint8Array(bytes.slice(0, 256));
  const ascii = (i, n) => String.fromCharCode(...b.slice(i, i + n));
  // An MPEG sync word with layer 0 is ADTS AAC, not mp3.
  if (ascii(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return { ext: "mp3", type: "audio/mpeg" };
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { ext: "aac", type: "audio/aac" };
  if (ascii(0, 4) === "OggS") {
    return ascii(28 + b[26], 6) === "vorbis" ? { ext: "ogg", type: "audio/ogg" } : { ext: "opus", type: "audio/ogg" };
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return { ext: "wav", type: "audio/wav" };
  if (ascii(0, 4) === "fLaC") return { ext: "flac", type: "audio/flac" };
  if (ascii(4, 4) === "ftyp") return { ext: "m4a", type: "audio/mp4" };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ext: "webm", type: "audio/webm" };
  return null;
}

const MIGRATE = [
  "ALTER TABLE voices ADD COLUMN locale TEXT",
  "ALTER TABLE studio_takes ADD COLUMN crc32 TEXT",   // the file's CRC-32 as the page sent it, for the test pack's zip
  "ALTER TABLE voices ADD COLUMN races TEXT",         // the races whose stories the voice suits: "orc,troll" (RACES keys)
];

// The races a narrator can say their voice suits, as data/clips.json names a story's narrator. They go in the pack's
// .toc as X-LoreForever-Races, where the add-on's "Prefer voices that suit the race" reads them (Voice.Races).
export const RACES = { human: "Human", dwarf: "Dwarf", gnome: "Gnome", nightelf: "Night elf", orc: "Orc", troll: "Troll",
                       tauren: "Tauren", forsaken: "Forsaken", skyborne: "Skyborne" };

// "orc,troll" from what the page sends (an array or a comma list), keeping known races in RACES order; "" for none.
export function cleanRaces(input) {
  const want = new Set((Array.isArray(input) ? input : String(input ?? "").split(",")).map(r => String(r).trim().toLowerCase()));
  return Object.keys(RACES).filter(r => want.has(r)).join(",");
}

// "Orc, Troll" for a .toc, or null.
export function racesLabel(races) {
  const names = String(races || "").split(",").filter(r => RACES[r]).map(r => RACES[r]);
  return names.length ? names.join(", ") : null;
}
let migrated = false;
export async function setupStudio(env) {
  if (migrated) return;
  for (const sql of MIGRATE) {
    try { await env.DB.prepare(sql).run(); } catch (e) {}   // fails once the column exists
  }
  migrated = true;
}

// lines.json from the deployed static files: {languages, groups: [{name, stories: [{key, name, voice, lines}]}]}.
export async function loadLines(env, request) {
  const res = await env.ASSETS.fetch(new URL("/voices/lines.json", request.url));
  if (!res.ok) throw new Error("lines.json is missing");
  return res.json();
}

// {line id: {file, hash: {locale: hash}}} for checking uploads.
export function lineIndex(data) {
  const out = {};
  for (const g of data.groups) for (const s of g.stories) for (const l of s.lines) out[l.id] = { file: l.file, hash: l.hash };
  return out;
}

export const r2Key = (owner, voiceId, file, ext) => `studio/${owner}/${voiceId}/${file}.${ext}`;

// The user's voice with this id, or null.
export function ownVoice(env, user, id) {
  return env.DB.prepare("SELECT * FROM voices WHERE id = ? AND owner = ?").bind(String(id || ""), user.id).first();
}

// A new draft voice for the upload page. Returns {id} or {error}.
export async function createVoice(env, user, name, locale, takenIds) {
  const { results } = await env.DB.prepare("SELECT id, name FROM voices WHERE owner = ? AND locale IS NOT NULL").bind(user.id).all();
  if (results.length >= LIMITS.voices) return { error: `You can have ${LIMITS.voices} voices here. Rename one of them instead, or ask us on Discord.` };
  if (results.some(v => v.name.toLowerCase() === name.toLowerCase())) return { error: "You already have a voice with that name." };
  const base = slug(name) || "voice";
  const now = new Date().toISOString();
  for (let n = 1; n < 50; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (RESERVED.has(id) || takenIds.has(id)) continue;
    if (await env.DB.prepare("SELECT 1 FROM voices WHERE id = ?").bind(id).first()) continue;
    await env.DB.prepare("INSERT INTO voices (id, owner, name, status, locale, created, updated) VALUES (?, ?, ?, 'draft', ?, ?, ?)")
      .bind(id, user.id, name, locale, now, now).run();
    return { id };
  }
  return { error: "Couldn't find a free name for that voice. Try another name." };
}

// Counts one upload for today; returns false when the account is over its daily limit.
export async function countUpload(env, user) {
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    "INSERT INTO studio_uploads (owner, day, n) VALUES (?, ?, 1) ON CONFLICT (owner, day) DO UPDATE SET n = n + 1 RETURNING n"
  ).bind(user.id, day).first();
  return (row?.n || 0) <= LIMITS.uploadsPerDay;
}

// Bytes the account keeps, not counting the file a new upload would replace.
export function storedBytes(env, user, exceptVoice, exceptLine) {
  return env.DB.prepare("SELECT COALESCE(SUM(bytes), 0) AS n FROM studio_takes WHERE owner = ? AND NOT (voice_id = ? AND line_id = ?)")
    .bind(user.id, exceptVoice, exceptLine).first("n");
}

// The browser's checks for a file (lib/../public/voices/studio.js), kept for display and review: a small object.
export function cleanChecks(raw) {
  try {
    const c = JSON.parse(raw || "{}");
    const out = {};
    for (const k of ["channels", "rate", "lufs", "peak", "lead", "tail", "duration", "bandwidth", "snr"]) {
      if (typeof c[k] === "number" && Number.isFinite(c[k])) out[k] = Math.round(c[k] * 100) / 100;
    }
    if (Array.isArray(c.warnings)) out.warnings = c.warnings.filter(w => typeof w === "string").slice(0, 8).map(w => w.slice(0, 40));
    return JSON.stringify(out);
  } catch (e) {
    return "{}";
  }
}
