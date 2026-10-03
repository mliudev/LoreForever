// Translation test packs (LOR-119): a translator's own saved edits from /translate/dashboard as a small add-on,
// LoreForever_LangTest_<locale>, that the add-on lays over the language pack (addon/LoreForever/Lang.lua, kind
// lang-overlay). GET /api/translations/pack builds it; this file is the part with no bindings, so
// site/tests/langtest.test.mjs and pipeline/tests/lang_sim.py run it under Node.
//
// It needs translate/fp.json (written by `python -m lore.kit site`): each entry's English fingerprint and the section
// file under translate/data/en/ that holds its current English. An edit whose English changed since it was saved is
// stale and left out, so it never sits on text it wasn't written for. The add-on checks fp again in game.
// Kept outside functions/ so Pages doesn't route it.

export const FOLDER_PREFIX = "LoreForever_LangTest_";
export const folderName = locale => FOLDER_PREFIX + locale;
const LINES_PER_FILE = 2000;   // well under Lua 5.1's per-function constant limit

// A Lua 5.1 string literal. Bytes other than printable ASCII and UTF-8 go out as \ddd (always three digits, so a
// digit after it can't join the escape).
export function luaString(s) {
  let out = '"';
  for (const ch of String(s ?? "")) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 32 || c === 127) out += "\\" + String(c).padStart(3, "0");
    else if (c >= 0xd800 && c <= 0xdfff) out += "�";   // a lone surrogate isn't valid UTF-8
    else out += ch;
  }
  return out + '"';
}

// The tooltip hook of a summary, as pipeline/lore/compile_lua.py hook() makes it: the first sentence, cut to 110
// characters at a word.
export function hook(summary, limit = 110) {
  const s = String(summary).trim().split(/(?<=[.!?])\s+/, 1)[0];
  const chars = Array.from(s);
  if (chars.length <= limit) return s;
  let cut = chars.slice(0, limit).join("");
  const space = cut.lastIndexOf(" ");
  if (space >= 0) cut = cut.slice(0, space);
  return cut.replace(/[,;:]+$/, "") + "...";
}

const isUi = id => id.startsWith("ui/");
const keyOf = id => id.split("/", 1)[0];

// The section files whose English the edits need: ["ui", "zones_01", ...].
export function sectionsFor(edits, fp) {
  const out = new Set();
  for (const e of edits) {
    if (isUi(e.string_id)) out.add("ui");
    else if (fp.entries[keyOf(e.string_id)]) out.add(fp.entries[keyOf(e.string_id)][1]);
  }
  return [...out];
}

// Sorts the edits into what goes in the pack. edits: the translator's saved rows [{string_id, en, text, updated}]
// (any order; the latest of a string wins). english: {id: today's English} for the ids the sections hold.
// Returns {ui: {english: text}, entries: {key: {fp, strings: {path: text}}}, included, stale}.
export function selectEdits(edits, english, fp) {
  const latest = new Map();
  for (const e of [...edits].sort((a, b) => String(a.updated || "").localeCompare(String(b.updated || "")) || (a.id || 0) - (b.id || 0))) {
    if (e && typeof e.string_id === "string" && typeof e.text === "string" && e.text.trim()) latest.set(e.string_id, e);
  }
  const ui = {}, entries = {};
  let included = 0, stale = 0;
  for (const [id, e] of latest) {
    const now = english[id];
    const entry = isUi(id) ? null : fp.entries[keyOf(id)];
    if (now === undefined || now !== e.en || (!isUi(id) && !entry)) { stale++; continue; }
    included++;
    if (isUi(id)) { ui[now] = e.text; continue; }
    const key = keyOf(id), path = id.slice(key.length + 1);
    const t = (entries[key] ||= { fp: entry[0], strings: {} });
    t.strings[path] = e.text;
    if (path === "s") t.strings.h = hook(e.text);   // the tooltip line follows the summary
  }
  return { ui, entries, included, stale };
}

// {file name: text} for the pack folder. info: {locale, english, interface, languageName, ttsVoices, built}.
export function renderPack(selected, info) {
  const name = folderName(info.locale);
  const header = [
    "-- Your own translations from loreforeverwow.com/translate, to try in game. Made by the site; download it again",
    "-- for your latest edits. Translations are shared under CC BY-SA 4.0, like the lore text they translate.",
    `local P = LoreForeverPacks and LoreForeverPacks.Begin(${luaString(name)})`,
    "if not P then return end",
  ];
  const files = {};
  const ui = Object.keys(selected.ui).sort().map(k => `P.ui[${luaString(k)}] = ${luaString(selected.ui[k])}`);
  files["UI.lua"] = [...header, ...ui].join("\n") + "\n";
  const lines = [];
  for (const key of Object.keys(selected.entries).sort()) {
    const t = selected.entries[key];
    lines.push(`P.fp[${luaString(key)}] = ${luaString(t.fp)}`);
    for (const path of Object.keys(t.strings).sort()) {
      lines.push(`P.strings[${luaString(key + "/" + path)}] = ${luaString(t.strings[path])}`);
    }
  }
  const chunks = [];
  for (let i = 0; i < lines.length; i += LINES_PER_FILE) chunks.push(lines.slice(i, i + LINES_PER_FILE));
  chunks.forEach((chunk, i) => { files[`Strings_${i + 1}.lua`] = [...header, ...chunk].join("\n") + "\n"; });
  const meta = v => String(v ?? "").replace(/[\r\n]+/g, " ").trim();
  // The .toc lists only Lang.xml, which lists the files. The game reads a .toc once, at launch, but Lang.xml again on
  // every /reload, so a new download with more Strings_N.lua files than the last one works after a /reload.
  const xml = [
    '<Ui xmlns="http://www.blizzard.com/wow/ui/">',
    "  <!-- Your translations from loreforeverwow.com/translate: the pack's files in load order. -->",
    ...Object.keys(files).map(f => `  <Script file="${f}"/>`),
    "</Ui>",
  ];
  const toc = [
    `## Interface: ${meta(info.interface)}`,
    `## Title: Lore Forever - my translations (${meta(info.languageName || info.locale)})`,
    "## Notes: Your own edits from loreforeverwow.com/translate, to try in game before the next language update.",
    `## Version: ${meta(info.built)}`,
    "## Dependencies: LoreForever",
    "## LoadOnDemand: 1",
    "## X-LoreForever-Pack: lang-overlay",
    `## X-LoreForever-Locale: ${meta(info.locale)}`,
    "## X-LoreForever-Format: 1",
    `## X-LoreForever-DataVersion: ${meta(info.english)}`,
    `## X-LoreForever-LanguageName: ${meta(info.languageName || info.locale)}`,
    ...(info.ttsVoices ? [`## X-LoreForever-TTSVoices: ${meta(info.ttsVoices)}`] : []),
    "",
    "Lang.xml",
  ];
  return { [`${name}.toc`]: toc.join("\n") + "\n", "Lang.xml": xml.join("\n") + "\n", ...files };
}

// ---- zip (stored, no compression: the pack is small, and this needs no library) ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: {path in the zip: string | Uint8Array}. Returns the zip as a Uint8Array.
export function zip(files, date = new Date()) {
  const enc = new TextEncoder();
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  const dosDate = ((Math.max(1980, date.getUTCFullYear()) - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  const locals = [], centrals = [];
  let offset = 0;
  for (const [path, body] of Object.entries(files)) {
    const name = enc.encode(path);
    const data = typeof body === "string" ? enc.encode(body) : body;
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true);   // names are UTF-8
    head.setUint16(8, 0, true);        // stored
    head.setUint16(10, dosTime, true);
    head.setUint16(12, dosDate, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, name.length, true);
    head.setUint16(28, 0, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, dosTime, true);
    cen.setUint16(14, dosDate, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(38, 0o644 << 16, true);   // external attributes: a plain file
    cen.setUint32(42, offset, true);
    locals.push(new Uint8Array(head.buffer), name, data);
    centrals.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = centrals.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of parts) { out.set(b, at); at += b.length; }
  return out;
}

// The whole pack as a zip: every file inside LoreForever_LangTest_<locale>/, so it unzips straight into AddOns.
export function packZip(selected, info, date = new Date()) {
  const folder = folderName(info.locale);
  const files = renderPack(selected, info);
  return zip(Object.fromEntries(Object.entries(files).map(([n, t]) => [`${folder}/${n}`, t])), date);
}
