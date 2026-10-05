// Uploading a zip, a folder or many files at once (LOR-121): the part with no page in it, so site/tests can run it
// under Node. bulk-upload.js draws the drop zone on /voices/studio and /translate/dashboard on top of this.
//
// Whatever is dropped becomes the same per-line records as uploading one line at a time: one studio take per
// recording (PUT /api/studio/take) or one translation edit per string (POST /api/translations/import, status new).
// Nothing dropped here is stored as it came: Lua and TOC files are never kept or run. From a test pack that comes back
// (LOR-119), the only thing read is Clips.lua's  c["<line id>"] = "<hash>"  lines, as plain text, so a recording made
// against older text stays marked as such.

import { openZip, ZipError } from "./unzip.js";
import { problem, isList } from "../translate/check.js";
import { crc32, crcHex } from "../voices/crc32.js";

export { ZipError };

// What one drop may hold. A whole voice is a few hundred files; a whole kit is about 25 MB of JSON (kit.py
// MAX_KIT_BYTES is the same 300 MB). A .wav may be large before the page turns it into an .mp3.
export const LIMITS = {
  voice: { maxFiles: 1000, maxBytes: 1536 * 1024 ** 2, maxRatio: 100, fileBytes: 200 * 1024 ** 2 },
  kit: { maxFiles: 500, maxBytes: 300 * 1024 ** 2, maxRatio: 100, fileBytes: 50 * 1024 ** 2 },
};

const JUNK = /(^|\/)(__MACOSX\/|\._|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;
export const AUDIO = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;   // the page converts all but mp3 and Ogg Vorbis
const base = path => path.split("/").pop();

// sources: [{name, size, blob}] (dropped or chosen files; name may be a path inside a folder). Zips are opened
// (not nested ones). Returns {files: [{path, size, read()}], ignored: [{path, why}]}; throws ZipError over a limit.
export async function gather(sources, kind) {
  const lim = LIMITS[kind];
  const files = [], ignored = [];
  let total = 0;
  const add = f => {
    if (JUNK.test(f.path)) return;
    if (files.length >= lim.maxFiles) throw new ZipError(`That's more than ${lim.maxFiles} files at once. Upload them in parts.`);
    if (f.size > lim.fileBytes) { ignored.push({ path: f.path, why: "too large" }); return; }
    total += f.size;
    if (total > lim.maxBytes) throw new ZipError(`That's more than ${Math.round(lim.maxBytes / 1024 ** 2)} MB at once. Upload it in parts.`);
    files.push(f);
  };
  for (const s of sources) {
    if (/\.zip$/i.test(s.name)) {
      const zip = await openZip(s.blob, lim);
      for (const e of zip.entries) {
        if (/\.zip$/i.test(e.name)) { ignored.push({ path: `${s.name}/${e.name}`, why: "a zip inside a zip" }); continue; }
        add({ path: e.name, size: e.size, read: () => zip.read(e) });
      }
    } else {
      add({ path: s.name, size: s.size, read: async () => new Uint8Array(await s.blob.arrayBuffer()) });
    }
  }
  return { files, ignored };
}

// Strict, like kit.py's utf-8-sig: a file saved in another encoding throws instead of turning letters into "\uFFFD".
const text = bytes => new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");

// ---- Voices ----

// Clips.lua of a test pack: {line id: hash}. Only lines shaped exactly like  c["id"] = "hash"  count; everything else
// in the file is ignored, and nothing in it is run.
const CLIP_LINE = /^\s*c\[\s*("(?:[^"\\\r\n]|\\["\\])*")\s*\]\s*=\s*"([0-9a-fA-F]{1,40})"\s*;?\s*$/;
export function parseClips(source) {
  const out = {};
  for (const line of String(source).split(/\r?\n/)) {
    const m = CLIP_LINE.exec(line);
    if (m) out[JSON.parse(m[1])] = m[2].toLowerCase();
  }
  return out;
}

// Levenshtein distance, for "did you mean" on file names.
export function distance(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

// Which line each recording is for. items: [{id, file, hash}] for the voice's language (hash null: no text yet).
// Returns {rows: [{path, size, read, it, hash}], unknown: [{path, why, suggest?}], stale: [{path, it}], other: n,
// pack: bool}. hash is the text the file was recorded against: Clips.lua's when it lists the line, else the current one.
export async function matchVoice(files, items) {
  const byFile = new Map(items.map(it => [it.file.toLowerCase(), it]));
  const clipsFile = files.find(f => base(f.path).toLowerCase() === "clips.lua" && f.size < 2 * 1024 ** 2);
  const clips = clipsFile ? parseClips(text(await clipsFile.read())) : {};
  const rows = [], unknown = [], stale = [], seen = new Set();
  let other = 0;
  for (const f of files) {
    if (!AUDIO.test(f.path)) { other++; continue; }
    const stem = base(f.path).replace(/\.[^.]+$/, "").toLowerCase();
    const it = byFile.get(stem);
    if (!it) {
      let best = null, bestD = Infinity;
      for (const k of byFile.keys()) { const d = distance(stem, k); if (d < bestD) { bestD = d; best = k; } }
      const near = best && bestD <= Math.max(3, Math.round(best.length * 0.3)) ? byFile.get(best) : null;
      unknown.push({ path: f.path, why: "name", suggest: near ? near.file : null });
      continue;
    }
    if (!it.hash) { unknown.push({ path: f.path, why: "notext", it }); continue; }
    if (seen.has(it.id)) { unknown.push({ path: f.path, why: "twice", it }); continue; }
    seen.add(it.id);
    const hash = clips[it.id] || it.hash;
    if (hash !== it.hash) { stale.push({ path: f.path, it }); continue; }
    rows.push({ ...f, it, hash });
  }
  return { rows, unknown, stale, other, pack: Boolean(clipsFile) };
}

// After the checks: what saving this file would do to the line. take: the line's current take ({hash, crc32}) or null.
export function voiceStatus(take, buf, hash) {
  if (!take) return "new";
  return take.hash === hash && take.crc32 && take.crc32 === crcHex(crc32(new Uint8Array(buf))) ? "unchanged" : "replaced";
}

// ---- Translation kits ----

export const STRING_ID = /^(ui\/[0-9a-f]{10}|[a-z]+:[a-z0-9-]+\/[A-Za-z0-9:\/_-]{1,120})$/;   // as the API's ID
export const LANGTEST = "LoreForever_LangTest_";
const sectionOf = (id, entrySection) => (id.startsWith("ui/") ? "ui" : entrySection[id.split("/", 1)[0]] || null);

// Lists (keywords, other ways to ask) compare as items, like kit.py split_list.
export const normalize = (id, s) => {
  const t = String(s ?? "").replace(/\r\n?/g, "\n").trim();
  return isList(id) ? [...new Set(t.split("|").map(x => x.trim()).filter(Boolean))].join(" | ") : t;
};

// The strings in a kit (kit.py read_kit): JSON files only, reference/ skipped. A test pack that comes back is noticed
// and not read: the edits in it are already saved. Returns {meta, rows: Map(id -> {en, text, file}), problems, langtest,
// other: n}.
export async function readKit(files) {
  const rows = new Map(), problems = [];
  let meta = null, other = 0, langtest = false;
  for (const f of files) {
    if (f.path.includes(LANGTEST)) { langtest = true; continue; }
    if (!/\.json$/i.test(f.path)) { other++; continue; }
    const parts = f.path.split("/");
    if (parts.slice(0, -1).includes("reference")) continue;
    let data;
    try {
      data = JSON.parse(text(await f.read()));
    } catch (e) {
      if (e instanceof ZipError) throw e;   // a damaged zip: say so rather than blame the file
      problems.push({ path: f.path, why: e instanceof SyntaxError ? "isn't valid JSON, so nothing in it was used"
        : "isn't saved as UTF-8, so nothing in it was used. Save it as UTF-8 and drop it again" });
      continue;
    }
    if (parts.at(-1) === "kit.json") { meta = data && typeof data === "object" && !Array.isArray(data) ? data : null; continue; }
    if (!Array.isArray(data)) { problems.push({ path: f.path, why: "isn't a list of strings, so it was skipped" }); continue; }
    data.forEach((row, n) => {
      if (!row || typeof row !== "object" || typeof row.id !== "string") { problems.push({ path: f.path, why: `item ${n + 1} has no id` }); return; }
      if (typeof row.en !== "string" || !(typeof row.text === "string" || row.text == null)) {
        problems.push({ path: f.path, why: `${row.id}: "en" and "text" must be text` });
        return;
      }
      rows.set(row.id, { en: row.en, text: row.text || "", file: f.path });
    });
  }
  return { meta, rows, problems, langtest, other };
}

// The section files a kit needs: their English (data/en/<sid>.json) and the language's text (data/<locale>/<sid>.json).
export function kitSections(rows, entrySection) {
  const out = new Set();
  for (const [id, r] of rows) if (r.text.trim() && STRING_ID.test(id)) { const s = sectionOf(id, entrySection); if (s) out.add(s); }
  return [...out];
}

// What importing the kit would do, string by string, with kit.py apply_strings' rule: a string whose English changed
// since the kit was made (or that the add-on no longer has) is skipped and stays English.
//   english: {id: today's English}   published: {id: the language's current text}   mine: {id: your saved edit's text}
//   locale: the kit's language, for the blocklist (check.js)
// Returns lists of {id, en, text, file, why?}: new, replaced, unchanged, unknown, stale, failed; and empty (a count).
export function planKit(rows, { english, published, mine, entrySection, locale }) {
  const out = { new: [], replaced: [], unchanged: [], unknown: [], stale: [], failed: [], empty: 0 };
  for (const [id, r] of rows) {
    const t = normalize(id, r.text);
    if (!t) { out.empty++; continue; }
    const row = { id, en: r.en, text: t, file: r.file };
    if (!STRING_ID.test(id)) { out.unknown.push(row); continue; }
    const now = sectionOf(id, entrySection) ? english[id] : undefined;
    if (now === undefined || now !== r.en) { out.stale.push(row); continue; }
    const why = problem(id, now, t, locale);
    if (why) { out.failed.push({ ...row, why }); continue; }
    const pub = normalize(id, published[id]), saved = mine[id] != null ? normalize(id, mine[id]) : null;
    if (t === pub || t === saved) out.unchanged.push(row);
    else if (saved != null || pub) out.replaced.push({ ...row, before: saved ?? pub });
    else out.new.push(row);
  }
  return out;
}
