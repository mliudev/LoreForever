// Contribute codes (LOR-234): one line of Forever text from the add-on's Contribute button, as a single line of plain
// text, shared by /contribute (it reads the code from the address and shows it field by field before sending) and the
// server (functions/api/contribute.js decodes nothing itself, but site/tests use this to round-trip the add-on's own
// codes). The add-on writes them in Capture.Code (addon/LoreForever/Capture.lua): keep the two in step. Fields, split
// by ~:
//   LFC1 ~ add-on version.locale ~ kind ~ id ~ part ~ speaker ~ player ~ text ~ checksum
// kind     quest | gossip | book | say
// id       quest id; gossip/say: the NPC's id (gossip from before ids were kept: "n:" + the NPC's name); book: its title
// part     quest: detail | objectives | progress | complete | title; book: the page number; gossip/say: a text hash
// speaker  "<npc id>.<UnitSex>.<creature type>.<name>" (empty parts allowed, the name last so it may hold dots);
//          an object (a wanted poster) is "o<id>"; empty for books
// player   "<race file>.<class file>.<UnitSex>" of the character who saw it, e.g. "Human.WARRIOR.2"
// text     the text as the game showed it, the character's name, class and race replaced by $N, $C and $R
// checksum djb2 (mod 2^32, 8 hex digits) of the UTF-8 bytes of everything before the last ~, so a code cut short when
//          copied is caught
// In every field but the checksum, % ~ CR and LF are written as %25 %7E %0D %0A. The in-game link is
// https://loreforeverwow.com/contribute#c=<the code, percent-encoded again>: the fragment never reaches the server.

export const PREFIX = "LFC1";
export const MAX_CODE = 8000;   // longer codes aren't made: the add-on gives the text and this page's address instead
export const KINDS = ["quest", "gossip", "book", "say"];
export const QUEST_PARTS = ["detail", "objectives", "progress", "complete", "title"];

const utf8 = new TextEncoder();

// djb2 over bytes, mod 2^32, as 8 hex digits (Lua 5.1 has no bit operations; this stays exact in doubles).
export function djb2(bytes) {
  let h = 5381;
  for (const b of bytes) h = (h * 33 + b) % 4294967296;
  return h.toString(16).padStart(8, "0");
}
export const checksum = s => djb2(utf8.encode(s));

const ESCAPES = { "%": "%25", "~": "%7E", "\r": "%0D", "\n": "%0A" };
export const escapeField = s => String(s ?? "").replace(/[%~\r\n]/g, c => ESCAPES[c]);

// Undoes escapeField; null when a % starts anything else (the code was mangled on the way).
export function unescapeField(s) {
  let bad = false;
  const out = s.replace(/%(..)?/g, (m, h) => {
    const c = { "25": "%", "7E": "~", "0D": "\r", "0A": "\n" }[(h || "").toUpperCase()];
    if (c === undefined) bad = true;
    return c ?? m;
  });
  return bad ? null : out;
}

export function speakerField(sp) {
  if (!sp) return "";
  if (sp.object) return "o" + sp.object;
  const parts = [sp.id ?? "", sp.sex ?? "", sp.type ?? "", sp.name ?? ""].map(String);
  return parts.join(".").replace(/\.+$/, "");
}

export function parseSpeaker(s) {
  if (!s) return null;
  const o = /^o(\d{1,8})$/.exec(s);
  if (o) return { object: o[1] };
  const [id, sex, type, ...name] = s.split(".");
  const sp = {};
  if (/^\d{1,8}$/.test(id)) sp.id = id;
  if (/^[0-3]$/.test(sex || "")) sp.sex = Number(sex);
  if (type) sp.type = type.slice(0, 40);
  if (name.length && name.join(".")) sp.name = name.join(".").slice(0, 80);
  return Object.keys(sp).length ? sp : null;
}

export function parsePlayer(s) {
  const m = /^([A-Za-z]{2,20})\.([A-Z]{2,20})\.([0-3])$/.exec(s || "");
  return m ? { race: m[1], class: m[2], sex: Number(m[3]), tag: s } : null;
}

// The code for a line ({kind, ref_id, part, locale, version, text, speaker, player}); the site only needs this in tests.
export function encode(line) {
  const fields = [PREFIX, `${line.version || "-"}.${line.locale || "enUS"}`, line.kind, escapeField(line.ref_id),
    escapeField(line.part), escapeField(speakerField(line.speaker)), escapeField(line.player || ""),
    escapeField(line.text)];
  const body = fields.join("~");
  return body + "~" + checksum(body);
}

// The code in whatever was pasted or arrived in the address: the bare code, the whole link (or its #c= / ?c= part), or
// a message around the link. null when there's none.
export function findCode(text) {
  let s = String(text ?? "").trim();
  const link = /[#?&]c=([^\s#&]+)/.exec(s);
  if (link) {
    try { s = decodeURIComponent(link[1]); } catch (e) { return { broken: true }; }
  }
  const i = s.indexOf(PREFIX + "~");
  return i < 0 ? null : s.slice(i).replace(/\s+$/, "");
}

// {ok: true, line} or {ok: false, error} for a code (or anything findCode reads one from).
export function decode(input) {
  const code = findCode(input);
  if (!code) return { ok: false, error: "There's no Lore Forever code in that." };
  if (code.broken) return { ok: false, error: "That link was cut short when it was copied. Copy it again from the game." };
  if (code.length > MAX_CODE * 3) return { ok: false, error: "That code is too long." };
  const cut = code.lastIndexOf("~");
  const body = code.slice(0, cut), sum = code.slice(cut + 1);
  const f = body.split("~");
  if (f.length !== 8 || !/^[0-9a-f]{8}$/.test(sum) || checksum(body) !== sum) {
    return { ok: false, error: "That code was cut short or changed when it was copied. Copy it again from the game." };
  }
  const fields = f.slice(3).map(unescapeField);
  if (fields.some(x => x === null)) return { ok: false, error: "That code was changed when it was copied." };
  const [ref, part, speaker, player, text] = fields;
  const vm = /^(.*)\.([a-z]{2}[A-Z]{2})$/.exec(f[1]);
  if (!vm) return { ok: false, error: "That code doesn't say which language the game is in." };
  if (!KINDS.includes(f[2])) return { ok: false, error: "That code is from a newer Lore Forever than this page knows." };
  return {
    ok: true,
    line: {
      kind: f[2], ref_id: ref, part, locale: vm[2], version: vm[1] === "-" ? null : vm[1], text,
      speaker: parseSpeaker(speaker), player: player || null, playerInfo: parsePlayer(player),
    },
  };
}
