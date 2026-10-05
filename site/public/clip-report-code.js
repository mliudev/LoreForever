// Clip report codes (LOR-232): "Report a problem with this narration" in the add-on gives a link to /clip-report with
// a code in its fragment. Shared by /clip-report (the preview), functions/api/clip-report.js (it checks every report
// with these rules, coded or not) and the tests. The add-on writes the code in Log.ClipReportCode
// (addon/LoreForever/Log.lua): keep the two in step. Fields, split by ~:
//   LCR1 ~ add-on version.locale ~ voice pack (without LoreForever_Voice_) ~ clip id@hash ~ reason ~ name
//        ~ how the name should sound ~ note ~ checksum
// Name, sound and note are percent-encoded (%, ~ and control characters). The checksum is 6 hex digits of a djb2
// hash (32-bit) of the UTF-8 bytes of everything before the last ~, so a copy that lost its end is caught.
// The link is https://loreforeverwow.com/clip-report#c=<the code, URL-encoded>. API: site/CLIP_REPORT_API.md.

export const REASONS = {
  name: "A name is said wrong",
  voice: "Wrong voice or gender",
  cut: "Cut off, garbled or words missing",
  quality: "Poor sound: noise, echo or too quiet",
  stage: "It reads out a stage direction",
  text: "The words don't match the text",
  other: "Something else",
};
export const MAX = { name: 60, say_as: 80, note: 300 };   // characters
export const CLIP_ID = /^[a-z]{2,12}:[a-z0-9][a-z0-9-]{0,79}(?:#faq[1-9]\d{0,2}|#(?:detail|progress|complete))?$/;
export const HASH = /^[0-9a-f]{6}$/;
const VOICE = /^LoreForever_Voice_[A-Za-z0-9_]{1,48}$/;
const PREFIX = "LoreForever_Voice_";
// The site's names for our narrators (public/voices/voices.json ids) -> their packs.
const SITE_VOICES = { "male-narrator": "LoreForever_Voice_Default", "female-narrator": "LoreForever_Voice_Female" };

// A voice as the folder name of its narrator's pack, so reports from the add-on (which names the pack that played,
// lands and quest dialogue packs included) and from the site (voices.json ids) group together:
// "male-narrator", "Default", "Default_Horde", "LoreForever_Voice_Default_Quests" -> "LoreForever_Voice_Default";
// "LoreForever_Voice_Female_Quests_deDE" -> "LoreForever_Voice_Female_deDE". Other packs keep their name (the quest
// givers' voices, a community voice). null if it isn't a voice pack name.
export function normalizeVoice(v) {
  let s = String(v ?? "").trim();
  if (SITE_VOICES[s]) return SITE_VOICES[s];
  if (!s.startsWith(PREFIX)) s = PREFIX + s;
  s = s.replace(/^(LoreForever_Voice_(?:Default|Female))(?:_(?:Alliance|Horde|Quests))+(_[a-z]{2}[A-Z]{2})?$/, "$1$2");
  return VOICE.test(s) ? s : null;
}

// "zone:stormwind#faq3@1a2b3c" or "zone:stormwind#faq3" -> {clip, hash}; null if the id isn't a clip id.
export function splitClip(s, hash) {
  const [id, h = ""] = String(s ?? "").trim().split("@");
  const hh = String(h || hash || "").trim().toLowerCase();
  if (!CLIP_ID.test(id) || (hh && !HASH.test(hh))) return null;
  return { clip: id, hash: hh || null };
}

export function checksum(s) {
  let h = 5381;
  for (const b of new TextEncoder().encode(s)) h = (h * 33 + b) % 4294967296;
  return (h % 16777216).toString(16).padStart(6, "0");
}

// Percent-encoding of the free-text fields, and back.
const encodeField = s => String(s ?? "").replace(/[%~\x00-\x1f\x7f]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
function decodeField(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

// Free text as the API keeps it: one line (the note keeps line breaks), no control characters, at most `max`
// characters (not UTF-16 units: an emoji counts once).
export function cleanText(v, max, lines = false) {
  let s = String(v ?? "").replace(/\r\n?/g, "\n");
  s = lines ? s.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n")
            : s.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ");
  return [...s.trim()].slice(0, max).join("").trim();
}

// The code in whatever was pasted or opened: the link (its #c= fragment, or ?c=), the code itself, or a message around
// either. Returns the code as the add-on wrote it (URL encoding undone), or null.
export function findClipCode(text) {
  let s = String(text ?? "");
  const m = s.match(/[#?&]c=([^&\s"'<>]*)/);
  if (m) {
    try { s = decodeURIComponent(m[1]); } catch (e) { s = m[1]; }
  } else if (/LCR1%7E/i.test(s)) {
    s = s.slice(s.search(/LCR1%7E/i)).split(/[\s"'<>]/)[0];
    try { s = decodeURIComponent(s); } catch (e) {}
  }
  const i = s.indexOf("LCR1~");
  if (i < 0) return null;
  s = s.slice(i);
  // A code copied from the address bar without the #c= keeps its URL encoding: its clip field shows it.
  const clipField = s.split("~")[3] || "";
  if (/%(?:23|40|3a)/i.test(clipField)) {
    try { s = decodeURIComponent(s); } catch (e) {}
  }
  return s;
}

// The report in a code: {ok: true, code, version, locale, voice, clip, hash, reason, name, say_as, note}, or
// {ok: false, error, code} for a code that's cut short, damaged or not ours, or null when there's no code at all.
export function decodeClipReport(text) {
  const code = findClipCode(text);
  if (!code) return null;
  const f = code.split("~");
  if (f.length < 9) return { ok: false, code, error: "cut" };
  const sum = (f[8].match(/^[0-9a-f]{6}/) || [])[0];
  const body = f.slice(0, 8).join("~");
  const full = body + "~" + (sum || f[8]);
  if (!sum) return { ok: false, code: full, error: "cut" };
  if (checksum(body) !== sum) return { ok: false, code: full, error: "checksum" };
  const vl = f[1].match(/^(.*)\.([a-z]{2}[A-Z]{2})$/);
  const voice = normalizeVoice(f[2]);
  const clip = splitClip(f[3]);
  if (!voice || !clip || !REASONS[f[4]]) return { ok: false, code: full, error: "fields" };
  return {
    ok: true,
    code: full,
    version: (vl ? vl[1] : f[1]).slice(0, 20) || null,
    locale: vl ? vl[2] : null,
    voice,
    clip: clip.clip,
    hash: clip.hash,
    reason: f[4],
    name: f[4] === "name" ? cleanText(decodeField(f[5]), MAX.name) || null : null,
    say_as: f[4] === "name" ? cleanText(decodeField(f[6]), MAX.say_as) || null : null,
    note: cleanText(decodeField(f[7]), MAX.note, true) || null,
  };
}

// The code for a report (the add-on's format; for tests and for pages that want to build a link). Like the add-on,
// it names the pack as given (a lands pack stays one); the API folds it into its narrator when it saves.
export function encodeClipReport({ version = "-", locale = "enUS", voice, clip, hash = "", reason, name = "", say_as = "", note = "" }) {
  const v = String(SITE_VOICES[voice] || voice || "-").replace(PREFIX, "");
  const named = reason === "name";
  const body = ["LCR1", `${version}.${locale}`, v, `${clip}@${hash || ""}`, reason,
    named ? encodeField(cleanText(name, MAX.name)) : "", named ? encodeField(cleanText(say_as, MAX.say_as)) : "",
    encodeField(cleanText(note, MAX.note))].join("~");
  return body + "~" + checksum(body);
}

// A clip id in words, for the preview: "zone:stormwind#faq3" -> "Stormwind (answer 3)",
// "quest:176#detail" -> "Quest 176 (what the quest giver asks)".
const PARTS = { detail: "what the quest giver asks", progress: "while you're still at it", complete: "the quest giver's thanks" };
const KINDS = { zone: "", subzone: "", npc: "", topic: "", item: "", quest: "Quest " };
export function describeClip(id) {
  const m = String(id || "").match(/^([a-z]+):([a-z0-9-]+)(?:#faq(\d+)|#(detail|progress|complete))?$/);
  if (!m) return String(id || "");
  const words = m[2].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const name = (KINDS[m[1]] ?? "") + words;
  return name + (m[3] ? ` (answer ${m[3]})` : m[4] ? ` (${PARTS[m[4]]})` : "");
}

// A voice pack in words: LoreForever_Voice_Default_Horde -> "Default Horde".
export const describeVoice = v => String(v || "").replace(PREFIX, "").replace(/_/g, " ");
