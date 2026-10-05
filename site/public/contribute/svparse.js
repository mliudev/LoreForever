// Reads a dropped LoreForever.lua (the game's SavedVariables file) in the browser, for /contribute (LOR-235), and
// picks out the Forever text Lore Forever kept: the raw file never leaves the player's PC, only these lines are sent.
// site/tests/contribute.test.mjs runs the same module.
//
// parseSavedVariables is a strict reader for what the game writes, never eval: a list of `Name = value` statements,
// where a value is a table constructor ({ [key] = value, name = value, value, ... } with , or ; between fields), a
// string ("..." or '...', with Lua 5.1's escapes: \n \t \" \\ \ddd and the rest), a number (decimal or hex, with an
// optional minus), true, false or nil, and `--` comments to the end of a line. Anything else (a function call, an
// operator, a long string, a block comment, a key that's a table) is refused with the line it's on. Limits keep a huge
// or hostile file from hanging the page: size, nesting depth, values and string length (LIMITS).
//
// extractLines(db) reads LoreForeverDB (or the old LorewalkerDB) into the lines POST /api/contribute takes:
//   quests[id] = {title, text, objectives, progress, completion, starter, ender}   -> kind quest, part title, detail,
//                                                                                     objectives, progress, complete
//   texts.gossip[npc name][hash] = text, texts.npcs[npc name] = {id, sex, ctype}   -> kind gossip (ref: the NPC's id,
//                                                                                     else "n:" + its name)
//   texts.books[title][page] = text                                                -> kind book, part: the page
//   texts.say[npc id][hash] = {text, kind = "say" | "yell", name, sex, ctype}      -> kind say, mode say or yell
//   capture = {v, build, locale, version, install, sent = {[line key] = true}, by = {[line key] = "Race.CLASS.sex"}}
// Line keys (capture.sent, capture.by): quest:<id>#<part>, gossip:<npc name>#<hash>, book:<title>#<page>,
// say:<npc id>#<hash>. Lines in capture.sent (shared before, then "Mark all as sent" in game) are left out. The
// account's character names (LoreForeverDB.journey) are replaced with $N in every text, behind the add-on's own scrub
// (older versions wrote <name>; the server reads both).

export class SVError extends Error {}

export const LIMITS = { bytes: 64 * 1024 * 1024, depth: 48, values: 4_000_000, string: 4 * 1024 * 1024 };

const SPACE = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0b, 0x0c]);
const isDigit = b => b >= 0x30 && b <= 0x39;
const isAlpha = b => (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x5f;
const ESC = { 0x61: 7, 0x62: 8, 0x66: 12, 0x6e: 10, 0x72: 13, 0x74: 9, 0x76: 11, 0x5c: 0x5c, 0x22: 0x22, 0x27: 0x27,
  0x0a: 10, 0x0d: 10 };
const utf8 = new TextDecoder("utf-8");

// A Lua table: keys are JS numbers or strings, kept apart ([1] and ["1"] are different keys, as in Lua).
export class LuaTable {
  constructor() { this.map = new Map(); }
  get(k) { return this.map.get(k); }
  has(k) { return this.map.has(k); }
  get size() { return this.map.size; }
  entries() { return this.map.entries(); }
}

export function parseSavedVariables(input, limits = LIMITS) {
  const src = typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (!(src instanceof Uint8Array)) throw new SVError("Expected the file's bytes.");
  if (src.length > limits.bytes) throw new SVError("That file is too big to be a Lore Forever SavedVariables file.");
  let i = 0, values = 0;
  // Skip a UTF-8 byte order mark, which some editors add.
  if (src[0] === 0xef && src[1] === 0xbb && src[2] === 0xbf) i = 3;

  const lineAt = p => { let n = 1; for (let k = 0; k < p && k < src.length; k++) if (src[k] === 10) n++; return n; };
  const fail = msg => { throw new SVError(`${msg} (line ${lineAt(i)})`); };

  function skip() {
    for (;;) {
      while (i < src.length && SPACE.has(src[i])) i++;
      if (src[i] === 0x2d && src[i + 1] === 0x2d) {
        if (src[i + 2] === 0x5b && (src[i + 3] === 0x5b || src[i + 3] === 0x3d)) fail("Block comments aren't allowed");
        while (i < src.length && src[i] !== 10) i++;
        continue;
      }
      return;
    }
  }

  function name() {
    const start = i;
    if (!isAlpha(src[i])) return null;
    while (i < src.length && (isAlpha(src[i]) || isDigit(src[i]))) i++;
    if (i - start > 200) fail("A name is too long");
    return String.fromCharCode(...src.subarray(start, i));
  }

  function string() {
    const q = src[i++];
    const start = i;
    // Fast path: no escapes.
    while (i < src.length && src[i] !== q && src[i] !== 0x5c && src[i] !== 10 && src[i] !== 13) i++;
    if (src[i] === q) {
      if (i - start > limits.string) fail("A string is too long");
      const s = utf8.decode(src.subarray(start, i));
      i++;
      return s;
    }
    const out = Array.from(src.subarray(start, i));
    for (;;) {
      if (i >= src.length) fail("A string never ends");
      const b = src[i];
      if (b === q) { i++; break; }
      if (b === 10 || b === 13) fail("A string runs over the end of its line");
      if (b === 0x5c) {
        const e = src[i + 1];
        if (isDigit(e)) {
          let n = 0, k = 0;
          while (k < 3 && isDigit(src[i + 1 + k])) { n = n * 10 + src[i + 1 + k] - 0x30; k++; }
          if (n > 255) fail("A string has a bad \\ escape");
          out.push(n);
          i += 1 + k;
        } else if (e in ESC) {
          out.push(ESC[e]);
          i += 2;
          if (e === 0x0d && src[i] === 0x0a) i++;   // \ then CRLF is one line break
        } else {
          fail("A string has an escape Lua 5.1 doesn't know");
        }
      } else {
        out.push(b);
        i++;
      }
      if (out.length > limits.string) fail("A string is too long");
    }
    return utf8.decode(Uint8Array.from(out));
  }

  function number() {
    const start = i;
    if (src[i] === 0x2d) i++;
    let s;
    if (src[i] === 0x30 && (src[i + 1] === 0x78 || src[i + 1] === 0x58)) {
      i += 2;
      const h = i;
      while (i < src.length && /[0-9a-fA-F]/.test(String.fromCharCode(src[i]))) i++;
      if (i === h || i - start > 64) fail("A number is malformed");
      s = String.fromCharCode(...src.subarray(start, i));
      const v = parseInt(s.replace("0x", "").replace("0X", ""), 16);
      return s.startsWith("-") ? -Math.abs(v) : v;
    }
    while (i < src.length && (isDigit(src[i]) || src[i] === 0x2e || src[i] === 0x65 || src[i] === 0x45
      || ((src[i] === 0x2b || src[i] === 0x2d) && (src[i - 1] === 0x65 || src[i - 1] === 0x45)))) i++;
    if (i - start > 64) fail("A number is malformed");
    s = String.fromCharCode(...src.subarray(start, i));
    if (!/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) fail("A number is malformed");
    if (isAlpha(src[i])) fail("A number runs into a name");
    return Number(s);
  }

  function value(depth) {
    if (++values > limits.values) fail("The file has too many values");
    skip();
    const b = src[i];
    if (b === 0x7b) return table(depth + 1);
    if (b === 0x22 || b === 0x27) return string();
    if (isDigit(b) || b === 0x2d || (b === 0x2e && isDigit(src[i + 1]))) {
      if (b === 0x2d && !(isDigit(src[i + 1]) || src[i + 1] === 0x2e)) fail("Only literal values are allowed");
      return number();
    }
    if (b === 0x5b && (src[i + 1] === 0x5b || src[i + 1] === 0x3d)) fail("Long strings aren't allowed");
    const save = i;
    const n = name();
    if (n === "true") return true;
    if (n === "false") return false;
    if (n === "nil") return null;
    i = save;
    return fail(i >= src.length ? "The file ends in the middle of a value" : "Only literal values are allowed");
  }

  function table(depth) {
    if (depth > limits.depth) fail("Tables are nested too deeply");
    i++;   // {
    const t = new LuaTable();
    let next = 1;
    for (;;) {
      skip();
      if (src[i] === 0x7d) { i++; return t; }
      if (i >= src.length) fail("A table never ends");
      let key, val;
      if (src[i] === 0x5b) {
        i++;
        skip();
        const k = value(depth);
        if (typeof k !== "string" && typeof k !== "number" && typeof k !== "boolean") fail("A key must be a string or number");
        if (typeof k === "number" && Number.isNaN(k)) fail("A key can't be NaN");
        skip();
        if (src[i] !== 0x5d) fail("Expected ] after a key");
        i++;
        skip();
        if (src[i] !== 0x3d) fail("Expected = after a key");
        i++;
        key = k;
        val = value(depth);
      } else {
        const save = i;
        const n = name();
        skip();
        if (n !== null && src[i] === 0x3d && src[i + 1] !== 0x3d && !["true", "false", "nil"].includes(n)) {
          i++;
          key = n;
          val = value(depth);
        } else {
          i = save;
          key = next++;
          val = value(depth);
        }
      }
      if (val !== null) t.map.set(key, val);
      skip();
      if (src[i] === 0x2c || src[i] === 0x3b) { i++; continue; }
      if (src[i] === 0x7d) { i++; return t; }
      fail("Expected , or } in a table");
    }
  }

  const globals = new Map();
  for (;;) {
    skip();
    if (i >= src.length) break;
    const n = name();
    if (n === null) fail("Expected a name at the start of a statement");
    skip();
    if (src[i] !== 0x3d || src[i + 1] === 0x3d) fail(`Expected = after ${n}`);
    i++;
    globals.set(n, value(0));
    skip();
    if (src[i] === 0x3b) i++;
  }
  return globals;
}

// ---- What to send ----

const T = v => (v instanceof LuaTable ? v : null);
const str = v => (typeof v === "string" && v.trim() ? v : null);
const QUEST_FIELDS = [["title", "title"], ["text", "detail"], ["objectives", "objectives"], ["progress", "progress"],
  ["completion", "complete"]];
export const MAX_TEXT = 4000;

function speakerOf(who) {
  who = T(who);
  if (!who) return null;
  const id = who.get("id");
  if (who.get("kind") === "object") return Number.isInteger(id) ? { object: String(id) } : null;
  const sp = {};
  if (Number.isInteger(id) && id > 0) sp.id = String(id);
  if (str(who.get("name"))) sp.name = who.get("name").slice(0, 80);
  if ([0, 1, 2, 3].includes(who.get("sex"))) sp.sex = who.get("sex");
  if (str(who.get("ctype"))) sp.type = who.get("ctype").slice(0, 40);
  return Object.keys(sp).length ? sp : null;
}

// A replacer for this account's character names (journey.chars: "Name-Realm" keys and their name fields) -> $N.
function nameScrubber(db) {
  const chars = T(T(db.get("journey"))?.get("chars"));
  const names = new Set();
  for (const [k, c] of chars ? chars.entries() : []) {
    const n = str(T(c)?.get("name")) || (typeof k === "string" ? k.split("-")[0] : null);
    if (n && n.length >= 2) names.add(n);
  }
  if (!names.size) return s => s;
  const esc = [...names].sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const rx = new RegExp(`(?<![\\p{L}\\p{N}])(?:${esc.join("|")})(?![\\p{L}\\p{N}])`, "giu");
  return s => s.replace(rx, "$$N");
}

// {meta, lines, counts, sent, tooLong, hasCapture} from the parsed file (parseSavedVariables' result).
export function extractLines(globals) {
  const db = T(globals.get("LoreForeverDB")) || T(globals.get("LorewalkerDB"));
  if (!db) throw new SVError("This isn't Lore Forever's file: it has no LoreForeverDB. Pick LoreForever.lua.");
  const cap = T(db.get("capture"));
  const sent = T(cap?.get("sent")), by = T(cap?.get("by"));
  const meta = {
    build: str(cap?.get("build")) || "",
    locale: /^[a-z]{2}[A-Z]{2}$/.test(cap?.get("locale") || "") ? cap.get("locale") : null,
    version: str(cap?.get("version")) || null,
    install: /^[0-9a-f]{8,64}$/.test(cap?.get("install") || "") ? cap.get("install") : null,
  };
  const scrub = nameScrubber(db);
  const lines = [], counts = { quest: 0, gossip: 0, book: 0, say: 0 };
  let skippedSent = 0, tooLong = 0;
  const add = (key, line) => {
    if (sent?.get(key)) { skippedSent++; return; }
    let text = line.text.replace(/\r\n?/g, "\n").trim();
    if (!text) return;
    if (text.length > MAX_TEXT) { tooLong++; return; }
    line.text = scrub(text);
    const p = by?.get(key);
    if (typeof p === "string" && /^[A-Za-z]{2,20}\.[A-Z]{2,20}\.[0-3]$/.test(p)) line.player = p;
    lines.push(line);
    counts[line.kind]++;
  };

  for (const [id, q] of T(db.get("quests"))?.entries() || []) {
    const rec = T(q);
    if (!rec || !Number.isInteger(id) || id <= 0) continue;
    const starter = speakerOf(rec.get("starter")), ender = speakerOf(rec.get("ender"));
    const player = typeof rec.get("player") === "string" ? rec.get("player") : null;
    for (const [field, part] of QUEST_FIELDS) {
      const text = str(rec.get(field));
      if (!text) continue;
      const line = { kind: "quest", ref_id: String(id), part, text };
      const sp = part === "progress" || part === "complete" ? ender : starter;
      if (sp) line.speaker = sp;
      if (player) line.player = player;
      add(`quest:${id}#${part}`, line);
    }
  }
  const texts = T(db.get("texts"));
  const npcs = T(texts?.get("npcs"));
  for (const [npc, said] of T(texts?.get("gossip"))?.entries() || []) {
    if (typeof npc !== "string" || !T(said)) continue;
    const who = speakerOf(npcs?.get(npc)) || {};
    if (!who.name) who.name = npc.slice(0, 80);
    const ref = who.id ? who.id : "n:" + npc.slice(0, 80);
    for (const [hash, text] of said.entries()) {
      if (!str(text)) continue;
      add(`gossip:${npc}#${hash}`, { kind: "gossip", ref_id: ref, part: String(hash), text, speaker: who });
    }
  }
  for (const [title, pages] of T(texts?.get("books"))?.entries() || []) {
    if (typeof title !== "string" || !T(pages)) continue;
    for (const [page, text] of pages.entries()) {
      if (!Number.isInteger(page) || page < 1 || !str(text)) continue;
      add(`book:${title}#${page}`, { kind: "book", ref_id: title.slice(0, 120), part: String(page), text });
    }
  }
  for (const [npcId, said] of T(texts?.get("say"))?.entries() || []) {
    if (!Number.isInteger(npcId) || !T(said)) continue;
    for (const [hash, rec] of said.entries()) {
      const r = T(rec);
      const text = r ? str(r.get("text")) : str(rec);
      if (!text) continue;
      const sp = { id: String(npcId) };
      if (r && str(r.get("name"))) sp.name = r.get("name").slice(0, 80);
      if (r && [0, 1, 2, 3].includes(r.get("sex"))) sp.sex = r.get("sex");
      if (r && str(r.get("ctype"))) sp.type = r.get("ctype").slice(0, 40);
      const line = { kind: "say", ref_id: String(npcId), part: String(hash), text, speaker: sp };
      if (r && (r.get("kind") === "say" || r.get("kind") === "yell")) line.mode = r.get("kind");
      add(`say:${npcId}#${hash}`, line);
    }
  }
  return { meta, lines, counts, sent: skippedSent, tooLong, hasCapture: Boolean(cap) };
}
