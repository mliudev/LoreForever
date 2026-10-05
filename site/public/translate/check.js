// The checks a translation has to pass, shared by the translation dashboard (in the browser, as you type) and
// functions/api/translations/[action].js (on save). Same rules as problem() in pipeline/lore/kit.py, which checks
// again on import: keep them in step.

import { BLOCKLIST } from "./blocklist.js";

// Lowercase without accents ("Nègre" -> "negre"), as kit.py's fold.
export const fold = s => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Whole words over folded text. No lookbehind, which older Safari can't parse.
const BLOCKED = Object.fromEntries(Object.entries(BLOCKLIST).map(([lang, words]) => [lang,
  new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${words.map(w => escapeRe(fold(w))).join("|")})(?![\\p{L}\\p{N}_])`, "u")]));

// Whether text has a word from the blocklist: its language's ("deDE" -> de) or the English one; any with no locale.
export function blocked(text, locale) {
  const lists = locale ? [BLOCKED.en, BLOCKED[locale.slice(0, 2).toLowerCase()]] : Object.values(BLOCKED);
  const t = fold(text);
  return lists.some(re => re && re.test(t));
}

// Under 30% or over 300% of the English, give or take this many characters (kit.py LENGTH_SLACK: tuned on every
// translation in data/i18n, none of which falls outside).
const LENGTH_SLACK = 20;

const FMT = /%(?:%|[-+ #0]*\d{0,2}(?:\.\d{0,2})?[cdeEfgGioqsuxX])/y;   // Lua 5.1 string.format specifiers
const PIPE = /\|(?:c[0-9a-fA-F]{8}|[rnTtHh|])/g;                     // WoW escapes: colour, reset, texture, link...

// The arguments string.format would take, in order; "%%" takes none, a stray % is listed as "bad %x".
export function fmtSpecs(s) {
  const out = [];
  let i = 0;
  while ((i = s.indexOf("%", i)) >= 0) {
    FMT.lastIndex = i;
    const m = FMT.exec(s);
    if (!m) { out.push("bad " + s.slice(i, i + 2)); i += 1; continue; }
    if (m[0] !== "%%") out.push(m[0]);
    i = FMT.lastIndex;
  }
  return out;
}

const count = list => list.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());

export const isList = id => /\/(kw|faq\/\d+\/al)$/.test(id);

// Why a translation can't be used as it stands, or null. `id` is the string's id ("ui/..." or "<key>/<path>"),
// `locale` the language it's in ("deDE"), for the blocklist.
export function problem(id, en, text, locale) {
  if (text.length > 3 * en.length + LENGTH_SLACK) return "Much longer than the English. Is something pasted twice?";
  if (text.length < 0.3 * en.length - LENGTH_SLACK) return "Much shorter than the English. Is part of it missing?";
  if (blocked(text, locale)) return "That has a word we don't allow in translations. Please reword it.";
  if (!isList(id)) {
    const have = count(en.match(PIPE) || []);
    for (const [code, n] of count(text.match(PIPE) || [])) {
      if (n > (have.get(code) || 0)) return `Has a ${code} code the English doesn't have. Keep the English ones and add none.`;
    }
  }
  if (id.startsWith("ui/")) {
    const a = fmtSpecs(en), b = fmtSpecs(text);
    if (a.join("\u0000") !== b.join("\u0000")) {
      return `Keep the % codes of the English, in the same order: ${a.join(" ") || "none"}.`;
    }
  }
  if (/[\u0000-\u0008\u000b-\u001f]/.test(text)) return "Has control characters. Retype it without them.";
  return null;
}
