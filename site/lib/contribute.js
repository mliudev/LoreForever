// Community Forever text (LOR-235, LOR-236): what players share from the add-on's capture, how it's checked, and when
// it's trusted enough to go into Lore Forever. The API is in functions/api/contribute.js (POST) and
// functions/api/contribute/[action].js, the receipt page in functions/contribute/r/[id].js, the format and statuses
// in site/CONTRIBUTE_API.md. Kept outside functions/ so Pages doesn't route it.
//
// Nobody reviews lines by hand. Each line is a (kind, ref_id, part, locale, text) and gets a status:
//   single     one sender so far. Accepted once it's 48 hours old with nothing against it: with few contributors most
//              Forever text has one source (SpeakStone: 1,022 of 1,172 Forever passages), so this is what lets it ship
//   verified   two or more independent senders, or it matches the Forever client's own text in our harvest
//   conflict   another player's text for the same part (a player of the same gender) that no rule settles: both are
//              kept side by side until a sender or /admin settles it. Most settle by themselves (LOR-621, decide):
//              the client's own words win, then the version more independent players sent, then the one that
//              passes a check the other fails (not cut short, no broken placeholder); the other becomes unused.
//              A line that only differs from the client's own text is single: the nightly import keeps the game's
//              words over it (and says so, POST /api/contribute/unused) or folds a man's or woman's version in
//   flagged    looks like spam (a web address, a run of one character): never accepted on one sender, but two
//              independent senders verify it like any line
//   unused     not used: /admin picked another text for the part, or turned this one down, or lore.contrib kept the
//              game's own text instead (POST /api/contribute/unused; LOR-621)
//   rejected   every sender of it was rejected from /admin (Restore brings it back)
//   shipped    in a release (POST /api/contribute/shipped)
// picked (LOR-621): 1 when /admin chose this text ("Use this", it's verified), -1 when it was turned down ("Don't
// use", from /admin or lore.contrib); 0 otherwise.
// Lines identical to text the add-on already ships (public/contribute/known.json, from pipeline/lore/known_text.py)
// aren't stored at all; they count as "known". Independent senders need a different day's IP hash AND a different
// account or add-on install (independentSenders): one person's file and code uploads from one PC are one sender.
// Upload rows drop the IP hash after 30 days.

import { senderHash } from "./form.js";

export const LIMITS = { lines: 5000, text: 4000, title: 200, body: 8 * 1024 * 1024, nick: 24 };
export const RATE = { file: 10, companion: 10, code: 60, preview: 30 };   // per sender (day's IP hash) per hour
export const ACCEPT_AFTER = 48 * 3600;   // seconds before a single, unflagged line counts as accepted
export const HASH_DAYS = 30;             // upload rows keep the IP hash this long
export const KINDS = ["quest", "gossip", "book", "say"];
export const LOCALES = ["enUS", "enGB", "deDE", "frFR", "esES", "esMX", "ptBR", "ruRU", "itIT", "koKR", "zhCN", "zhTW"];
const ENGLISH = new Set(["enUS", "enGB"]);

const SETUP = [
  `CREATE TABLE IF NOT EXISTS contrib_lines (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref_id TEXT NOT NULL, part TEXT NOT NULL, locale TEXT NOT NULL,
    build TEXT, text TEXT NOT NULL, text_hash TEXT NOT NULL, status TEXT NOT NULL, uploads INTEGER NOT NULL DEFAULT 0,
    uploaders INTEGER NOT NULL DEFAULT 0, found_by_user TEXT, found_by_nick TEXT, first_seen INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, shipped_in TEXT, lkey TEXT NOT NULL, speaker TEXT, player TEXT, mode TEXT,
    corrects TEXT, flagged INTEGER NOT NULL DEFAULT 0, picked INTEGER NOT NULL DEFAULT 0, pick_reason TEXT,
    UNIQUE (kind, ref_id, part, locale, text_hash))`,
  "CREATE INDEX IF NOT EXISTS contrib_lines_lkey ON contrib_lines (lkey)",
  "CREATE INDEX IF NOT EXISTS contrib_lines_status ON contrib_lines (status, updated_at)",
  `CREATE TABLE IF NOT EXISTS contrib_uploads (
    id INTEGER PRIMARY KEY, line_id INTEGER NOT NULL, upload_id TEXT NOT NULL, user_id TEXT, nick TEXT, ip_hash TEXT,
    source TEXT NOT NULL, created_at INTEGER NOT NULL, uploader TEXT NOT NULL, player TEXT,
    rejected INTEGER NOT NULL DEFAULT 0)`,
  "CREATE INDEX IF NOT EXISTS contrib_uploads_line ON contrib_uploads (line_id)",
  "CREATE INDEX IF NOT EXISTS contrib_uploads_uploader ON contrib_uploads (uploader)",
  "CREATE INDEX IF NOT EXISTS contrib_uploads_batch ON contrib_uploads (upload_id)",
  `CREATE TABLE IF NOT EXISTS contrib_batches (
    upload_id TEXT PRIMARY KEY, user_id TEXT, nick TEXT, ip_hash TEXT, source TEXT NOT NULL, n_new INTEGER NOT NULL,
    n_known INTEGER NOT NULL, created_at INTEGER NOT NULL, uploader TEXT, n_confirmed INTEGER NOT NULL DEFAULT 0,
    n_invalid INTEGER NOT NULL DEFAULT 0, version TEXT, build TEXT, locale TEXT, rejected INTEGER NOT NULL DEFAULT 0)`,
  "CREATE INDEX IF NOT EXISTS contrib_batches_time ON contrib_batches (created_at)",
];

let ready = false;
export async function setup(env) {
  if (ready) return;
  await env.DB.batch(SETUP.map(s => env.DB.prepare(s)));
  // contrib_lines.picked and .pick_reason (LOR-621) on a table made before them. Another cold Worker may add one at the
  // same moment.
  for (const [column, type] of [["picked", "INTEGER NOT NULL DEFAULT 0"], ["pick_reason", "TEXT"]]) {
    const has = async () => (await env.DB.prepare("PRAGMA table_info(contrib_lines)").all()).results.some(c => c.name === column);
    if (await has()) continue;
    try { await env.DB.prepare(`ALTER TABLE contrib_lines ADD COLUMN ${column} ${type}`).run(); }
    catch (error) { if (!(await has())) throw error; }
  }
  ready = true;
}

export const nowSec = () => Math.floor(Date.now() / 1000);

// ---- Text ----

// The text as stored: Unix line breaks, trimmed, and the placeholders older add-ons wrote (<name>, <class>, <race>)
// as the game's own ($N, $C, $R).
export function normalizeText(s) {
  return String(s ?? "").replace(/\r\n?/g, "\n")
    .replace(/<name>/gi, "$$N").replace(/<class>/gi, "$$C").replace(/<race>/gi, "$$R")
    .replace(/\$([ncr])(?![A-Za-z])/g, (m, c) => "$" + c.toUpperCase())
    .trim();
}

// What two copies of a text are compared by: normalizeText with every run of white space as one space, SHA-256, the
// first 16 hex digits. pipeline/lore/known_text.py text_hash() must give the same (site/tests/fixtures/contribute/
// hashes.json pins both).
export async function textHash(s) {
  const flat = normalizeText(s).replace(/[ \t\n\r\f\v]+/g, " ").trim();
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(flat));
  return [...new Uint8Array(bytes)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}

const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
// Gossip and say lines name their NPC by id, or by name ("n:<name>") where the add-on only kept the name: older files,
// and the companion, which sends the bare name (normalized to "n:<name>" here).
const NPC_REF = /^([1-9]\d{0,7}|n:[^\x00-\x1f]{1,80})$/;
const REF = { quest: /^[1-9]\d{0,6}$/, gossip: NPC_REF, say: NPC_REF, book: /^[^\x00-\x1f]{1,120}$/ };
const PART = { quest: /^(detail|objectives|progress|complete|title)$/, book: /^[1-9]\d{0,2}$/ };
// Spam is a real link (a scheme, www., a Discord invite, or a bare lower-case domain standing as a word of its own:
// "cheapgold.com", "gold.ru/buy") or a run of one character. A sentence that lost its space ("the pelts.Com..." or
// "Stormwind.Org") isn't a link: the domain part is lower case only, and has to end at a space, the end or a slash.
const LINK = /https?:\/\/|\bwww\.|discord\.gg\//i;
const DOMAIN = /(?:^|[\s(<"'])[a-z0-9][a-z0-9-]*\.(?:com|net|org|ru|gg|io|xyz)(?=$|[\s/:)>"',!?]|\.(?:\s|$))/;
const RUN = /(.)\1{14,}/;

export const looksSpammy = text => LINK.test(text) || DOMAIN.test(text) || RUN.test(text);

// The speaker as {id, name, sex, type} or {object}; it may come as the add-on's own record ({kind = "npc" | "object",
// id, name, sex, ctype}, which the companion sends) too. Anything else in it is ignored, never refused.
function cleanSpeaker(sp) {
  if (!sp || typeof sp !== "object" || Array.isArray(sp)) return null;
  const objectId = sp.object ?? (sp.kind === "object" ? sp.id : undefined);
  if (objectId !== undefined) return /^\d{1,8}$/.test(String(objectId)) ? { object: String(objectId) } : null;
  const out = {};
  if (/^\d{1,8}$/.test(String(sp.id ?? ""))) out.id = String(sp.id);
  if (typeof sp.name === "string" && sp.name.trim() && !CONTROL.test(sp.name)) out.name = sp.name.trim().slice(0, 80);
  if ([0, 1, 2, 3].includes(Number(sp.sex)) && sp.sex !== null && sp.sex !== "") out.sex = Number(sp.sex);
  const type = typeof sp.type === "string" ? sp.type : sp.ctype;
  if (typeof type === "string" && type.trim() && !CONTROL.test(type)) out.type = type.trim().slice(0, 40);
  return Object.keys(out).length ? out : null;
}

const PLAYER = /^[A-Za-z]{2,20}\.[A-Z]{2,20}\.[0-3]$/;

// A line as sent ({kind, ref_id, part, locale, build, text, speaker?, player?, mode?}) checked and normalized, with its
// hash and key; or null when anything about it is off (it's skipped, never the whole upload).
export async function cleanLine(raw, fallback = {}) {
  if (!raw || typeof raw !== "object") return null;
  // Also read: kind "yell" (a say line, mode yell), say_kind for mode, and player as {race, class, sex}.
  const yell = raw.kind === "yell";
  const kind = yell ? "say" : raw.kind;
  const mode = yell ? "yell" : raw.mode ?? raw.say_kind;
  const p = raw.player && typeof raw.player === "object"
    ? `${raw.player.race}.${String(raw.player.class ?? "").toUpperCase()}.${raw.player.sex}` : raw.player;
  if (!KINDS.includes(kind)) return null;
  let ref = String(raw.ref_id ?? "").trim();
  if ((kind === "gossip" || kind === "say") && ref && !/^\d+$/.test(ref) && !ref.startsWith("n:")) ref = "n:" + ref;
  if (!REF[kind].test(ref)) return null;
  // A line that doesn't say its language takes the upload's, else English (the companion may not say).
  const locale = LOCALES.includes(raw.locale) ? raw.locale : LOCALES.includes(fallback.locale) ? fallback.locale
    : raw.locale === undefined || raw.locale === null || raw.locale === "" ? "enUS" : null;
  if (!locale) return null;
  if (typeof raw.text !== "string") return null;
  const text = normalizeText(raw.text);
  const max = raw.part === "title" ? LIMITS.title : LIMITS.text;
  if (!text || text.length > max || CONTROL.test(text) || !/\p{L}/u.test(text)) return null;
  const hash = await textHash(text);
  let part = String(raw.part ?? "");
  if (kind === "gossip" || kind === "say") part = hash.slice(0, 8);   // the text is its own part: recomputed here
  else if (!PART[kind].test(part)) return null;
  const build = typeof raw.build === "string" && /^[0-9.]{1,24}$/.test(raw.build) ? raw.build
    : typeof fallback.build === "string" && /^[0-9.]{1,24}$/.test(fallback.build) ? fallback.build : null;
  const line = { kind, ref_id: ref, part, locale, build, text, hash, lkey: `${kind}|${ref}|${part}|${locale}`,
    speaker: cleanSpeaker(raw.speaker), player: typeof p === "string" && PLAYER.test(p) ? p : null,
    mode: kind === "say" && (mode === "say" || mode === "yell") ? mode : null, flagged: looksSpammy(text) ? 1 : 0 };
  return line;
}

export function cleanNick(v) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS.nick);
  return /^[\p{L}\p{N} '_.-]{2,}$/u.test(s) ? s : null;
}

// ---- What the add-on already ships (public/contribute/known.json) ----
// {v, generated, lines: {"quest:176#detail": [shipped hash or "", Forever client's hash or ""], ...}}: "shipped" is the
// text the add-on narrates (data/quest_dialogue.json), "Forever" what the Forever client itself gave us
// (data/harvest). English only.

let knownCache = { at: 0, data: null };
export async function loadKnown(env, request) {
  if (knownCache.data && Date.now() - knownCache.at < 600e3) return knownCache.data;
  let data = { lines: {} };
  try {
    const res = await env.ASSETS.fetch(new URL("/contribute/known.json", request.url));
    if (res.ok) data = await res.json();
  } catch (e) { /* none yet: nothing counts as known */ }
  if (!data || typeof data.lines !== "object") data = { lines: {} };
  knownCache = { at: Date.now(), data };
  return data;
}
export function forgetKnown() { knownCache = { at: 0, data: null }; }

function knownRef(known, line) {
  if (!ENGLISH.has(line.locale)) return null;
  const r = known.lines[`${line.kind}:${line.ref_id}#${line.part}`];
  return Array.isArray(r) ? r : null;
}

// ---- Storing ----

function* chunks(list, maxBytes = 1_500_000) {
  let cur = [], size = 2;
  for (const x of list) {
    const n = JSON.stringify(x).length + 1;
    if (cur.length && size + n > maxBytes) { yield cur; cur = []; size = 2; }
    cur.push(x);
    size += n;
  }
  if (cur.length) yield cur;
}

async function selectIn(env, sql, values, ...before) {
  const out = [];
  for (const part of chunks(values)) {
    const { results } = await env.DB.prepare(sql).bind(...before, JSON.stringify(part)).all();
    out.push(...results);
  }
  return out;
}

// account: the account a connected Willo uploads for (functions/api/contribute.js), linked privately: it counts like
// user here and in the upload rows, but the lines aren't credited to it (found_by_user stays empty; only the nick).
export function uploaderOf({ user, account, install, ipHash }) {
  if (user || account) return "u:" + (user || account).id;
  if (install) return "i:" + install.slice(0, 32);
  return "h:" + ipHash;
}

const sexOf = p => (PLAYER.test(p || "") ? p.slice(-1) : null);
const sameSex = (a, b) => !sexOf(a) || !sexOf(b) || sexOf(a) === sexOf(b);

// The status a line should have (see the top of this file). `group` is every line with the same key.
// A text that fails a check its rival passes (LOR-621): cut short (its words are the start of the other's), a player's
// name, class or race where the other has the game's placeholder, or a broken placeholder (a $ that isn't the game's
// $N $C $R $B $G, a <...>, %s or {0} left in).
const BAD_TOKEN = /\$(?![NCRBGncrbg])|<[^<>]*>|%[sd]|\{\d*\}/;
const flat = t => String(t ?? "").replace(/\s+/g, " ").trim().toLowerCase().replace(/[\s.…!?,;:-]+$/, "");
// Words and the game's placeholders ($N, $C, $R...), each a token; punctuation apart.
const tokens = t => String(t ?? "").match(/\$[A-Za-z]|[\p{L}\p{N}'’-]+|[^\s\p{L}\p{N}]/gu) || [];
const PLACEHOLDER = /^\$[NCRncr]$/;
// Where two texts differ, once their common start and end are set aside: [a's tokens, b's tokens].
function middle(a, b) {
  const x = tokens(a), y = tokens(b);
  let i = 0;
  while (i < x.length && i < y.length && x[i].toLowerCase() === y[i].toLowerCase()) i++;
  let j = 0;
  while (j < x.length - i && j < y.length - i && x[x.length - 1 - j].toLowerCase() === y[y.length - 1 - j].toLowerCase()) j++;
  return [x.slice(i, x.length - j), y.slice(i, y.length - j)];
}
export function weaker(a, b) {
  const fa = flat(a.text), fb = flat(b.text);
  if (fa && fb.length > fa.length && fb.startsWith(fa)) return true;
  // Only case, spacing or the closing punctuation differ: the fuller one (its full stop kept).
  if (fa === fb) return String(a.text || "").trim().length < String(b.text || "").trim().length;
  // A player's own name, class or race written in where the other has the game's placeholder: the placeholder is
  // what every player reads (the add-on fills it in).
  const [ma, mb] = middle(a.text, b.text);
  if (mb.length && mb.every(w => PLACEHOLDER.test(w)) && ma.length && ma.length <= 3 && !ma.some(w => w.startsWith("$"))) {
    return true;
  }
  return BAD_TOKEN.test(a.text || "") && !BAD_TOKEN.test(b.text || "");
}

// The general text two players' versions of one line come from (LOR-621): each saw it with their own class (or race)
// written in, or one has the game's placeholder there. The line reads $C ($R) in that spot, as the client writes it;
// null when they differ in anything else.
const CLASSES = new Set(["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"]);
const RACES = new Set(["human", "dwarf", "gnome", "night elf", "high elf", "orc", "troll", "tauren", "undead",
  "forsaken", "goblin"]);
export function generalText(a, b) {
  a = String(a ?? ""), b = String(b ?? "");
  if (a === b) return null;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  while (i > 0 && /[\p{L}$]/u.test(a[i - 1])) i--;          // back to the start of the word
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  while (j > 0 && /\p{L}/u.test(a[a.length - j])) j--;       // and to its end
  const ma = a.slice(i, a.length - j), mb = b.slice(i, b.length - j);
  for (const [words, placeholder] of [[CLASSES, "$C"], [RACES, "$R"]]) {
    const fits = m => m === placeholder || words.has(m.toLowerCase());
    if (fits(ma) && fits(mb)) return a.slice(0, i) + placeholder + a.slice(a.length - j);
  }
  return null;
}

// Folds versions that differ only in a class or race into one line with the placeholder (generalText): its senders
// are all of theirs, so their receipts show the same line, usually confirmed by two players. Only quest and book
// parts (a gossip or shout is keyed by its own words, so it has no rivals), and only versions that would otherwise
// wait (conflict) or lose (unused). Returns how many lines were folded away.
async function foldFilledIn(env, groups, known, now) {
  let folded = 0;
  for (const group of groups.values()) {
    if (!["quest", "book"].includes(group[0].kind)) continue;
    const ref = knownRef(known, group[0]);
    const rows = group.filter(r => r.status !== "shipped" && r.live > 0 && !r.picked).sort((a, b) => a.id - b.id);
    const waiting = new Set(rows.filter(r => ["conflict", "unused"].includes(decide(r, group, ref))));
    for (const x of rows) {
      for (const y of rows) {
        if (x === y || x.gone || y.gone || !(waiting.has(x) || waiting.has(y))) continue;
        const text = generalText(x.text, y.text);
        if (!text) continue;
        const hash = await textHash(text);
        const same = group.find(r => r.text_hash === hash);
        if (same && (same.status === "rejected" || same.picked === -1)) continue;
        const target = same || (x.id < y.id ? x : y);
        if (target.text_hash !== hash) {
          await env.DB.prepare("UPDATE contrib_lines SET text = ?, text_hash = ?, flagged = ?, updated_at = ? WHERE id = ?")
            .bind(text, hash, looksSpammy(text) ? 1 : 0, now, target.id).run();
          Object.assign(target, { text, text_hash: hash });
        }
        for (const from of [x, y]) {
          if (from === target) continue;
          await env.DB.batch([
            env.DB.prepare("UPDATE contrib_uploads SET line_id = ? WHERE line_id = ?").bind(target.id, from.id),
            env.DB.prepare("DELETE FROM contrib_lines WHERE id = ?").bind(from.id),
          ]);
          from.gone = true;
          folded++;
        }
      }
    }
  }
  return folded;
}

// A flagged line is held only while it has one sender: two independent senders (or the client's own words) verify it
// like any other (LOR-621). /admin's pick wins over everything but shipped and rejected. Two versions of one part
// settle by rule where one can (LOR-621), so few wait for /admin: the picked one, the client's own words, or the one
// more independent players sent wins; with as many senders on each, the one that passes a check the other fails.
export function decide(row, group, ref) {
  if (row.status === "shipped") return "shipped";
  if (row.live === 0) return "rejected";
  if (row.picked === -1) return "unused";
  if (row.picked === 1) return "verified";
  const client = o => Boolean(ref && ref[1] && ref[1] === o.text_hash);
  if (client(row)) return "verified";
  const rivals = group.filter(o => o !== row && o.text_hash !== row.text_hash && sameSex(o.player, row.player)
    && o.picked !== -1 && (o.status === "shipped" || o.live > 0));
  if (rivals.some(o => o.picked === 1 || client(o) || o.live > Math.max(row.live, 1))) return "unused";
  if (row.live >= 2) return "verified";
  if (row.flagged) return "flagged";
  const live = rivals.filter(o => !o.flagged || o.live >= 2);
  if (!live.length) return "single";
  // Beaten by any one version (a check it fails that the other passes), with three or more too.
  if (live.some(o => weaker(row, o) && !weaker(o, row))) return "unused";
  if (live.every(o => weaker(o, row))) return "single";
  // A tie with the text already in Lore Forever: that stays, until a second player sends this one (then it's
  // verified, above, and replaces it).
  if (live.some(o => o.status === "shipped")) return "unused";
  return "conflict";
}

// How many independent senders these upload rows ({uploader, ip_hash}, not rejected) come from. Two uploads are one
// sender when they share the day's IP hash, or the same account or install (uploader u:/i:), or the same uploader
// key at all; that's chained (a file and a code from one PC on one day, then the same install from home, are one
// sender). So one person can't verify their own line by sending it twice in different ways: independent senders
// need a different IP hash AND a different account or install. Anonymous uploads (h:) are told apart by IP hash
// only, and expired ones (x:<upload id>) by their upload.
export function independentSenders(uploads) {
  const parent = uploads.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const seen = new Map();
  uploads.forEach((u, i) => {
    for (const k of [u.uploader && "k:" + u.uploader, u.ip_hash && "ip:" + u.ip_hash]) {
      if (!k) continue;
      if (seen.has(k)) parent[find(i)] = find(seen.get(k));
      else seen.set(k, i);
    }
  });
  return new Set(uploads.map((_, i) => find(i))).size;
}

// Recounts senders and sets the status of every line under these keys (after an upload, a reject or a restore).
export async function recompute(env, lkeys, known, now = nowSec(), fold = true) {
  const keys = [...new Set(lkeys)];
  if (!keys.length) return 0;
  const rows = await selectIn(env,
    `SELECT l.id, l.kind, l.ref_id, l.part, l.locale, l.lkey, l.text, l.text_hash, l.status, l.flagged, l.player,
       l.corrects, l.picked, l.uploads, l.uploaders, (SELECT COUNT(*) FROM contrib_uploads u WHERE u.line_id = l.id) AS n
     FROM contrib_lines l WHERE l.lkey IN (SELECT value FROM json_each(?))`, keys);
  const uploads = rows.length ? await selectIn(env,
    "SELECT line_id, uploader, ip_hash FROM contrib_uploads WHERE rejected = 0 AND line_id IN (SELECT value FROM json_each(?))",
    rows.map(r => r.id)) : [];
  const byLine = new Map();
  for (const u of uploads) {
    if (!byLine.has(u.line_id)) byLine.set(u.line_id, []);
    byLine.get(u.line_id).push(u);
  }
  for (const r of rows) r.live = independentSenders(byLine.get(r.id) || []);
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.lkey)) groups.set(r.lkey, []);
    groups.get(r.lkey).push(r);
  }
  // Versions that are one line with each player's class or race filled in become that line first (LOR-621).
  if (fold && await foldFilledIn(env, groups, known, now)) return 1 + await recompute(env, keys, known, now, false);
  const changes = [];
  for (const group of groups.values()) {
    const ref = knownRef(known, group[0]);
    for (const r of group) {
      const status = decide(r, group, ref);
      const corrects = ref ? ((ref[0] && ref[0] !== r.text_hash && ref[0]) || (ref[1] && ref[1] !== r.text_hash && ref[1])
        || null) : null;
      if (status !== r.status || r.n !== r.uploads || r.live !== r.uploaders || corrects !== r.corrects) {
        changes.push({ id: r.id, s: status, n: r.n, u: r.live, c: corrects });
      }
    }
  }
  for (const part of chunks(changes)) {
    await env.DB.prepare(
      `UPDATE contrib_lines SET
         updated_at = CASE WHEN status <> json_extract(j.value, '$.s') THEN ? ELSE updated_at END,
         status = json_extract(j.value, '$.s'), uploads = json_extract(j.value, '$.n'),
         uploaders = json_extract(j.value, '$.u'), corrects = json_extract(j.value, '$.c')
       FROM json_each(?) AS j WHERE contrib_lines.id = json_extract(j.value, '$.id')`
    ).bind(now, JSON.stringify(part)).run();
  }
  return changes.length;
}

// Takes cleaned lines from one sender. dry: count only (the page's preview). Returns {new, known, confirmed, total,
// upload_id}: new lines nobody had, lines we already had (shipped, or sent before by this sender: the same uploader
// key or today's IP hash), and lines someone else sent that this upload confirms.
export async function ingest(env, { lines, known, who, source, dry = false, meta = {}, now = nowSec() }) {
  const seen = new Set(), todo = [];
  let knownN = 0;
  for (const l of lines) {
    const k = l.lkey + "|" + l.hash;
    if (seen.has(k)) continue;
    seen.add(k);
    const ref = knownRef(known, l);
    if (ref && ref[0] && ref[0] === l.hash) { knownN++; continue; }   // the add-on ships these very words
    todo.push(l);
  }
  const existing = todo.length ? await selectIn(env,
    "SELECT id, lkey, text_hash, status FROM contrib_lines WHERE lkey IN (SELECT value FROM json_each(?))",
    [...new Set(todo.map(l => l.lkey))]) : [];
  const byKey = new Map(existing.map(r => [r.lkey + "|" + r.text_hash, r]));
  const matched = todo.map(l => byKey.get(l.lkey + "|" + l.hash)).filter(Boolean);
  const mine = new Set((matched.length ? await selectIn(env,
    `SELECT DISTINCT line_id FROM contrib_uploads WHERE (uploader = ? OR ip_hash = ?)
       AND line_id IN (SELECT value FROM json_each(?))`,
    matched.map(r => r.id), who.uploader, who.ipHash) : []).map(r => r.line_id));
  const fresh = [], confirm = [];
  for (const l of todo) {
    const row = byKey.get(l.lkey + "|" + l.hash);
    if (!row) fresh.push(l);
    else if (row.status === "shipped" || mine.has(row.id)) knownN++;
    else confirm.push({ id: row.id, player: l.player });
  }
  const result = { new: fresh.length, known: knownN, confirmed: confirm.length,
    total: fresh.length + knownN + confirm.length };
  if (dry || !(fresh.length + confirm.length)) {
    if (!dry) result.upload_id = await saveBatch(env, who, source, result, meta, now);
    return result;
  }

  for (const part of chunks(fresh.map(l => ({ kind: l.kind, ref: l.ref_id, part: l.part, locale: l.locale,
    build: l.build, text: l.text, hash: l.hash, lkey: l.lkey, speaker: l.speaker ? JSON.stringify(l.speaker) : null,
    player: l.player, mode: l.mode, flagged: l.flagged })))) {
    await env.DB.prepare(
      `INSERT INTO contrib_lines (kind, ref_id, part, locale, build, text, text_hash, status, uploads, uploaders,
         found_by_user, found_by_nick, first_seen, updated_at, lkey, speaker, player, mode, flagged)
       SELECT json_extract(value, '$.kind'), json_extract(value, '$.ref'), json_extract(value, '$.part'),
         json_extract(value, '$.locale'), json_extract(value, '$.build'), json_extract(value, '$.text'),
         json_extract(value, '$.hash'), 'single', 0, 0, ?, ?, ?, ?, json_extract(value, '$.lkey'),
         json_extract(value, '$.speaker'), json_extract(value, '$.player'), json_extract(value, '$.mode'),
         json_extract(value, '$.flagged')
       FROM json_each(?) WHERE true
       ON CONFLICT (kind, ref_id, part, locale, text_hash) DO NOTHING`
    ).bind(who.user ? who.user.id : null, who.nick, now, now, JSON.stringify(part)).run();
  }
  // Ids of the new lines (another upload may have added the same line a moment ago: that's fine, it's confirmed).
  const ids = fresh.length ? await selectIn(env,
    "SELECT id, lkey, text_hash FROM contrib_lines WHERE lkey IN (SELECT value FROM json_each(?))",
    [...new Set(fresh.map(l => l.lkey))]) : [];
  const idOf = new Map(ids.map(r => [r.lkey + "|" + r.text_hash, r.id]));
  const uploads = [...confirm];
  for (const l of fresh) {
    const id = idOf.get(l.lkey + "|" + l.hash);
    if (id) uploads.push({ id, player: l.player });
  }
  const uploadId = await saveBatch(env, who, source, result, meta, now);
  for (const part of chunks(uploads)) {
    await env.DB.prepare(
      `INSERT INTO contrib_uploads (line_id, upload_id, user_id, nick, ip_hash, source, created_at, uploader, player)
       SELECT json_extract(value, '$.id'), ?, ?, ?, ?, ?, ?, ?, json_extract(value, '$.player') FROM json_each(?)`
    ).bind(uploadId, (who.user || who.account)?.id ?? null, who.nick, who.ipHash, source, now, who.uploader,
           JSON.stringify(part)).run();
  }
  await recompute(env, todo.map(l => l.lkey), known, now);
  result.upload_id = uploadId;
  return result;
}

async function saveBatch(env, who, source, result, meta, now) {
  const uploadId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await env.DB.prepare(
    `INSERT INTO contrib_batches (upload_id, user_id, nick, ip_hash, source, n_new, n_known, created_at, uploader,
       n_confirmed, n_invalid, version, build, locale) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(uploadId, (who.user || who.account)?.id ?? null, who.nick, who.ipHash, source, result.new, result.known, now,
         who.uploader, result.confirmed, meta.invalid || 0, meta.version || null, meta.build || null,
         meta.locale || null).run();
  return uploadId;
}

// Upload rows and batches older than HASH_DAYS forget the IP hash. An uploader known only by it becomes the batch
// ("x:<upload id>"), so nothing links it to other uploads any more.
export async function expireHashes(env, now = nowSec()) {
  const cutoff = now - HASH_DAYS * 86400;
  await env.DB.batch(["contrib_uploads", "contrib_batches"].map(t => env.DB.prepare(
    `UPDATE ${t} SET ip_hash = NULL, uploader = CASE WHEN uploader LIKE 'h:%' THEN 'x:' || upload_id ELSE uploader END
     WHERE created_at < ? AND ip_hash IS NOT NULL`).bind(cutoff)));
}

// The sender's IP hash for today (lib/form.js senderHash: salted with that day's random salt, so it can't be turned
// back).
export const ipHashOf = (env, request, now = new Date()) =>
  senderHash(env, request.headers.get("CF-Connecting-IP") || "", now.toISOString().slice(0, 10));

// ---- Reading ----

// SQL for "accepted": verified, or single (so unflagged: a flagged line has status flagged) and older than ACCEPT_AFTER
// (`?` = now - ACCEPT_AFTER). Shipped lines were accepted too; lists that count them add `l.status = 'shipped'`.
// lib/credits.js (/contributors, LOR-239) uses the same rule.
export const ACCEPTED = "(l.status = 'verified' OR (l.status = 'single' AND l.flagged = 0 AND l.first_seen < ?))";

// The name a found line is credited under: an account's display name when it shows its name (users.show_public),
// else nothing for an account (even with a nickname typed); without an account, the nickname typed with the upload.
// The same rule as lib/credits.js.
const FOUND_BY = `CASE WHEN l.found_by_user IS NOT NULL THEN (CASE WHEN u.show_public = 1 THEN u.display_name END)
  ELSE l.found_by_nick END`;

export async function stats(env, now = nowSec()) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS lines, COALESCE(SUM(status = 'verified'), 0) AS verified,
       COALESCE(SUM(status = 'shipped'), 0) AS shipped,
       COALESCE(SUM(status = 'verified' OR (status = 'single' AND flagged = 0 AND first_seen < ?)), 0) AS accepted,
       COALESCE(SUM(kind = 'quest'), 0) AS quest, COALESCE(SUM(kind = 'gossip'), 0) AS gossip,
       COALESCE(SUM(kind = 'book'), 0) AS book, COALESCE(SUM(kind = 'say'), 0) AS say
     FROM contrib_lines WHERE status <> 'rejected'`).bind(now - ACCEPT_AFTER).first();
  const contributors = await env.DB.prepare(
    "SELECT COUNT(DISTINCT uploader) AS n FROM contrib_uploads WHERE rejected = 0").first("n");
  const last = await env.DB.prepare("SELECT MAX(created_at) AS t FROM contrib_batches WHERE rejected = 0").first("t");
  return { lines: row.lines, verified: row.verified, accepted: row.accepted, shipped: row.shipped,
    contributors: contributors || 0, last_upload: last || null,
    by_kind: { quest: row.quest, gossip: row.gossip, book: row.book, say: row.say } };
}

// Who found accepted (or shipped) lines, by the name they chose to show (FOUND_BY), alphabetical: never a rank. The
// same name in any case counts once. Anonymous uploads aren't listed. GET /api/contribute/contributors answers with
// this as it is; lib/credits.js (/contributors, the release credit, LOR-239) asks for two extras:
//   links: true        each person also gets `links`, the account's links text when it shows its name (else null)
//   release: "0.8.0"   only the lines that shipped in that release, instead of every accepted one
// (links is a plain column, not an aggregate: with MIN() the only aggregate, SQLite takes the bare columns, the name
// included, from the finder's earliest line, so a nickname reads as it was first typed.)
export async function contributors(env, now = nowSec(), { links = false, release = null } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT ${FOUND_BY} AS name, COUNT(*) AS n, MIN(l.first_seen) AS first,
       CASE WHEN l.found_by_user IS NOT NULL AND u.show_public = 1 THEN u.links END AS links
     FROM contrib_lines l LEFT JOIN users u ON u.id = l.found_by_user
     WHERE ${release ? "l.status = 'shipped' AND l.shipped_in = ?" : `(l.status = 'shipped' OR ${ACCEPTED})`}
     GROUP BY COALESCE(l.found_by_user, 'nick:' || lower(trim(l.found_by_nick)))`
  ).bind(release ? release : now - ACCEPT_AFTER).all();
  const people = new Map();
  for (const r of results) {
    const name = String(r.name ?? "").replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);
    if (!name) continue;
    const p = people.get(name.toLowerCase()) || { name, lines_accepted: 0, first_found: r.first, ...(links ? { links: null } : {}) };
    p.lines_accepted += r.n;
    p.first_found = Math.min(p.first_found, r.first);
    if (links && !p.links && r.links) p.links = r.links;
    people.set(name.toLowerCase(), p);
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

// "Delete my account" (lib/accounts.js deleteUser): the lines stay (they're community text, like a pulled
// translation) but nothing links them to the account any more.
export async function forgetUser(env, userId) {
  await env.DB.batch([
    env.DB.prepare("UPDATE contrib_lines SET found_by_user = NULL WHERE found_by_user = ?").bind(userId),
    env.DB.prepare(`UPDATE contrib_uploads SET user_id = NULL, uploader = 'x:' || upload_id WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`UPDATE contrib_batches SET user_id = NULL, uploader = 'x:' || upload_id WHERE user_id = ?`).bind(userId),
  ]);
}

export const EXPORT_STATUSES = ["accepted", "all", "single", "verified", "conflict", "flagged", "unused", "rejected",
  "shipped"];

// Lines for the pipeline (lore.contrib pull). since: only lines that changed, or became accepted by age, after then.
export async function exportLines(env, { since = 0, status = "accepted", limit = 20000, now = nowSec() }) {
  const where = status === "accepted" ? ACCEPTED : status === "all" ? "1 = 1" : "l.status = ?";
  const binds = status === "accepted" ? [now - ACCEPT_AFTER] : status === "all" ? [] : [status];
  // A quest line carries its quest's title when someone sent one (the confirmed one first), so a quest the pipeline
  // has never seen can become an entry (lore.contrib, LOR-237).
  const { results } = await env.DB.prepare(
    `SELECT l.id, l.kind, l.ref_id, l.part, l.locale, l.build, l.text, l.status, l.uploads, l.uploaders,
       l.first_seen, l.updated_at, l.shipped_in, l.speaker, l.player, l.mode, l.corrects, l.flagged,
       ${FOUND_BY} AS found_by,
       CASE WHEN l.kind = 'quest' THEN (SELECT t.text FROM contrib_lines t WHERE t.kind = 'quest'
         AND t.ref_id = l.ref_id AND t.locale = l.locale AND t.part = 'title' AND t.status NOT IN ('rejected', 'flagged')
         ORDER BY t.status IN ('verified', 'shipped') DESC, t.uploaders DESC, t.id LIMIT 1) END AS title
     FROM contrib_lines l LEFT JOIN users u ON u.id = l.found_by_user
     WHERE ${where} AND MAX(l.updated_at, CASE WHEN l.status = 'single' THEN l.first_seen + ${ACCEPT_AFTER} ELSE 0 END) > ?
     ORDER BY l.id LIMIT ?`).bind(...binds, since, limit).all();
  for (const r of results) {
    r.speaker = r.speaker ? JSON.parse(r.speaker) : null;
    r.say_kind = r.kind === "say" ? r.mode || "say" : null;   // what lore.contrib reads; mode is the same
    r.accepted = r.status === "verified" || (r.status === "single" && !r.flagged && r.first_seen < now - ACCEPT_AFTER);
  }
  return results;
}

export async function markShipped(env, ids, release, now = nowSec()) {
  let n = 0;
  for (const part of chunks(ids)) {
    const res = await env.DB.prepare(
      `UPDATE contrib_lines SET status = 'shipped', shipped_in = ?, updated_at = ?
       WHERE id IN (SELECT value FROM json_each(?)) AND status <> 'rejected'`).bind(release, now, JSON.stringify(part)).run();
    n += res.meta?.changes || 0;
  }
  return n;
}

// /admin's Contributions panel: counts by status, the latest batches with who sent them, and the parts in conflict
// (the oldest first, CONFLICT_KEYS of them): every text sent for each, to pick one ("Use this") or turn one down.
// game_differs: the Forever client's own text for that part is different from every one of them (known.json).
const CONFLICT_KEYS = 40;
export async function adminView(env, now = nowSec(), known = null) {
  const [{ results: counts }, accepted, { results: batches }, { results: conflicts }] = await Promise.all([
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM contrib_lines GROUP BY status").all(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM contrib_lines l WHERE ${ACCEPTED}`).bind(now - ACCEPT_AFTER).first("n"),
    env.DB.prepare(
      `SELECT b.upload_id, b.source, b.nick, b.n_new, b.n_known, b.n_confirmed, b.n_invalid, b.created_at, b.uploader,
         b.rejected, b.version, b.locale, u.display_name, u.email,
         (SELECT COUNT(*) FROM contrib_batches o WHERE o.uploader = b.uploader) AS batches_from
       FROM contrib_batches b LEFT JOIN users u ON u.id = b.user_id ORDER BY b.created_at DESC LIMIT 100`).all(),
    env.DB.prepare(
      `SELECT l.id, l.lkey, l.kind, l.ref_id, l.part, l.locale, l.text, l.text_hash, l.status, l.uploaders, l.first_seen,
         l.player, l.picked, json_extract(l.speaker, '$.name') AS speaker
       FROM contrib_lines l
       WHERE l.lkey IN (SELECT lkey FROM contrib_lines WHERE status = 'conflict' GROUP BY lkey ORDER BY MIN(first_seen)
         LIMIT ${CONFLICT_KEYS})
         AND l.status IN ('conflict', 'single', 'verified', 'flagged', 'unused', 'shipped')
       ORDER BY l.lkey, l.first_seen`).all(),
  ]);
  const groups = new Map();
  for (const l of conflicts) {
    if (!groups.has(l.lkey)) {
      const ref = known ? knownRef(known, l) : null;
      groups.set(l.lkey, { key: l.lkey, kind: l.kind, ref_id: l.ref_id, part: l.part, locale: l.locale,
        speaker: l.speaker, game: ref && ref[1] ? ref[1] : null, lines: [] });
    }
    const g = groups.get(l.lkey);
    g.speaker ||= l.speaker;
    g.lines.push({ id: l.id, text: l.text, status: l.status, uploaders: l.uploaders, first_seen: l.first_seen,
      player: l.player, picked: l.picked, matches_game: g.game ? g.game === l.text_hash : null });
  }
  const conflictKeys = [...groups.values()].map(({ game, ...g }) =>
    ({ ...g, game_differs: Boolean(game) && !g.lines.some(l => l.matches_game) }));
  return { counts: Object.fromEntries(counts.map(r => [r.status, r.n])), accepted: accepted || 0, batches,
    conflicts: conflictKeys };
}

// /admin's pick on one line (LOR-621): "use" makes it verified (the other texts for its part, from players of the same
// gender, become unused), "skip" makes it unused, "reset" undoes either. reason (skip only): why, which the sender's
// receipt and My contributions show as "Not used: <reason>" (the daily routine's "not confirmed by a second player");
// without one they say another version was picked. Returns the line's status after, or null for no such line or pick.
export async function pickLine(env, id, pick, known, now = nowSec(), reason = null) {
  const value = { use: 1, skip: -1, reset: 0 }[pick];
  if (value === undefined) return null;
  const row = await env.DB.prepare("SELECT lkey FROM contrib_lines WHERE id = ?").bind(id).first();
  if (!row) return null;
  const why = value === -1 ? String(reason ?? "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "").slice(0, 200) || null : null;
  await env.DB.prepare("UPDATE contrib_lines SET picked = ?, pick_reason = ? WHERE id = ?").bind(value, why, id).run();
  await recompute(env, [row.lkey], known, now);
  return env.DB.prepare("SELECT status FROM contrib_lines WHERE id = ?").bind(id).first("status");
}

// Every part that's waiting on two versions, decided again (after a rule change: /admin's "Settle by the rules",
// POST /api/admin contrib-settle). Returns {before, after}: how many lines were in conflict.
export async function settleConflicts(env, known, now = nowSec()) {
  const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM contrib_lines WHERE status = 'conflict'").first("n");
  // The parts in conflict, and those a rule settled against a version (unused, not /admin's or the import's pick),
  // which a later rule (foldFilledIn) may fold back in.
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT lkey FROM contrib_lines WHERE status = 'conflict' OR (status = 'unused' AND picked = 0)").all();
  await recompute(env, results.map(r => r.lkey), known, now);
  const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM contrib_lines WHERE status = 'conflict'").first("n");
  return { before: before || 0, after: after || 0 };
}

// lore.contrib pull's report (POST /api/contribute/unused): lines it took and didn't use, because the Forever
// client's own text for that part says it differently (its ledger outcome "conflict"). Each becomes unused, so its
// sender reads that instead of waiting for an update that won't carry it. A line already shipped, rejected or picked
// by /admin stays as it is.
export async function markUnused(env, ids, known, now = nowSec()) {
  const keys = [];
  for (const part of chunks(ids)) {
    const { results } = await env.DB.prepare(
      `UPDATE contrib_lines SET picked = -1 WHERE id IN (SELECT value FROM json_each(?)) AND picked = 0
         AND status NOT IN ('shipped', 'rejected') RETURNING lkey`).bind(JSON.stringify(part)).all();
    keys.push(...results.map(r => r.lkey));
  }
  await recompute(env, keys, known, now);
  return keys.length;
}

// Reject (or restore) everything one sender sent: their upload rows stop counting, and each line they touched gets
// its status again (a line nobody else sent becomes rejected; one someone else also sent stays).
export async function setUploaderRejected(env, uploader, rejected, known, now = nowSec()) {
  const flag = rejected ? 1 : 0;
  await env.DB.batch([
    env.DB.prepare("UPDATE contrib_uploads SET rejected = ? WHERE uploader = ?").bind(flag, uploader),
    env.DB.prepare("UPDATE contrib_batches SET rejected = ? WHERE uploader = ?").bind(flag, uploader),
  ]);
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT l.lkey FROM contrib_uploads u JOIN contrib_lines l ON l.id = u.line_id WHERE u.uploader = ?"
  ).bind(uploader).all();
  await recompute(env, results.map(r => r.lkey), known, now);
  return results.length;
}

// One upload's lines and what became of them, for its receipt page (no names, no hashes).
export async function receipt(env, uploadId, now = nowSec()) {
  if (!/^[0-9a-f]{16}$/.test(uploadId)) return null;
  const batch = await env.DB.prepare(
    "SELECT upload_id, source, n_new, n_known, n_confirmed, n_invalid, created_at, rejected FROM contrib_batches WHERE upload_id = ?"
  ).bind(uploadId).first();
  if (!batch) return null;
  const { results } = await env.DB.prepare(
    `SELECT l.kind, l.ref_id, l.part, l.text, l.status, l.first_seen, l.shipped_in, l.flagged, l.uploaders, u.rejected,
       l.pick_reason,
       json_extract(l.speaker, '$.name') AS speaker
     FROM contrib_uploads u JOIN contrib_lines l ON l.id = u.line_id WHERE u.upload_id = ?
     ORDER BY l.kind, l.ref_id, l.part LIMIT 5000`).bind(uploadId).all();
  for (const r of results) r.shown = shownStatus(r, now);
  return { batch, lines: results };
}

// What a player reads about a line's status.
export function shownStatus(r, now = nowSec()) {
  if (r.status === "shipped") return { key: "shipped", label: r.shipped_in ? `In Lore Forever ${r.shipped_in}` : "In Lore Forever" };
  if (r.status === "verified") return { key: "verified", label: "Confirmed by a second player" };
  if (r.status === "single" && !r.flagged && r.first_seen < now - ACCEPT_AFTER) {
    return { key: "accepted", label: "Accepted" };
  }
  if (r.status === "single") return { key: "new", label: "New: accepted after 48 hours" };
  if (r.status === "conflict") return { key: "conflict", label: "Another player sent different words: waiting for a second player to match one" };
  if (r.status === "flagged") return { key: "held", label: "Held: needs a second player to confirm it" };
  if (r.status === "unused") {
    return { key: "unused", label: r.pick_reason ? `Not used: ${r.pick_reason}` : "Not used: another version of it was picked" };
  }
  return { key: "removed", label: "Not used" };
}
