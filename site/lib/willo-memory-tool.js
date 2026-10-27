// Her memory as a tool (LOR-844 step 6, phase 1 of the memory plan, the Architect's option B, 10/26): the player asks
// her to remember something about themselves, to forget one, to forget everything, or what she remembers, by voice or
// typing. The model calls the `memory` tool (lib/willo-actions.json, offered by appOffer on DeepSeek and on the
// fallback's cue, memoryCue) and her app does it with /api/willo/memories, where the check runs again on the save.
// This is the site's look at her call before it goes to the app, from the one read of the player's memories
// (lib/willo-memories.js memoriesRead): a note the pre-filter refuses, or one she knows already, is never sent; a
// forget is matched here to the notes the player's words name (their ids go with it, so the app forgets those and Undo
// brings them back); more than FORGET_MOST of them, or "forget everything", reads back how many first. Recall stays the
// block (no tool for it). What she says stays in the world: "Okay", never memory, saved or data.
// Kept outside functions/ so Pages doesn't route it.

import { keywordsOf, stemOf, characterOf, MEMORY_MAX } from "./willo-memories.js";
import { memoryPreFilter } from "./willo-memory-rules.js";
import { clean } from "./willo-custom.js";
import { withNow, fitsAsked } from "./willo-tools.js";

// Her lines when the site does it instead of the app.
export const MEMORY_LINES = {
  refused: "That's one thing I can't keep in mind, but ask me anything.",
  known: "I know that already.",
  nothing: "I don't think you've told me anything about that.",
  none: "There's nothing for me to forget yet.",
  full: "I'm holding all I can about you already. Ask me to forget one, and I'll keep this.",
};
// The most notes one forget lets go of at once: more than that is read back with the count first, as everything is.
export const FORGET_MOST = 3;
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
// The words of a forget that say what to forget, never which ones name a note.
const FORGET_WORDS = new Set(["forget", "forgot", "remember", "said", "told", "tell", "thing", "about", "that", "let", "go",
  "stop", "anymore", "please", "know", "knew", "everything"].map(w => stemOf(w, false)));

// Just this character's when their words say so ("I'm a tank on this character", "on this one"), whatever the model
// picked: Flash-Lite kept "I main a hunter" for one character 9 times of 10 (the phase 1 lab, 10/26).
const THIS_CHARACTER = /\b(?:this|current) (?:character|char|toon|alt|one)\b|\bon here\b/i;

// The notes the player's words name, newest first: those sharing the most of their own words (no synonyms).
export function namedNotes(about, rows) {
  const asked = [...keywordsOf(about, { synonyms: false })].filter(w => !FORGET_WORDS.has(w));
  if (!asked.length) return [];
  const scored = rows.map(r => ({ r, n: asked.filter(w => keywordsOf(r.text, { synonyms: false }).has(w)).length }))
    .filter(s => s.n > 0);
  const top = Math.max(0, ...scored.map(s => s.n));
  return scored.filter(s => s.n === top).map(s => s.r);
}

// "Forget everything" her words don't ask for ("forget everything about my brother") is a forget of what they name:
// the notes their words share (settleMemory), more than a few read back first, never all of them (the Architect, 10/26).
export function narrowMemory(action, question) {
  if (action?.id !== "memory" || action.args?.op !== "forget_all" || fitsAsked(action, question)) return action;
  const forget = { ...action, args: { op: "forget" } };
  return fitsAsked(forget, question) ? forget : action;
}

// Their plain ask about what she keeps, when she answered it without calling anything (DeepSeek, 1 time of 2 on "you
// can forget about my mount now, I got it", 2 of 2 on "bear in mind that I only have an hour a night to play", the
// phase 1 lab, 10/27): the site takes it from their words, as it does a goal (lib/willo-goals.js goalCall), and
// settles it the same way. Never "forget everything", which waits for her read-back. What they ask besides stays out of
// a note ("Remember I main a hunter, and what level is the Deadmines?" keeps "I main a hunter"); a forget is taken from
// their words only when she picked a goal instead (misrouted) or the words point at them ("forget about my mount",
// "forget that I…"), never "forget about Westfall, let's head to Duskwood" with a note that names Westfall, nor one
// that asks something besides (the Architect, 10/27).
const KEEP_WORDS = /^.*?\b(?:remember|keep in mind|bear in mind|don'?t forget|do not forget)\b[\s:,-]+(?:that\s+)?/i;
const KEEP_AFTER = /,?\s*(?:please\s+)?(?:remember|keep in mind|bear in mind)(?:\s+that)?\W*$/i;
const ASKS_BESIDES = /[.!?;]|,?\s+(?:and|but|so|also|then)\s+(?:what|where|who|whom|how|when|which|why|can|could|should|shall|is|are|was|do|does|did|will|would|tell|show)\b/i;
const FORGET_MINE = /\b(?:forget|let go of|stop remembering)\s+(?:(?:all(?:\s+the\s+stuff)?|everything|the\s+stuff|the\s+things?)\s+)?(?:about\s+)?(?:that\s+)?(?:i\b|i'[a-z]+\b|my\b|me\b|what i (?:said|told you)\b)/i;
export function memoryFromWords(question, { misrouted = false } = {}) {
  const q = String(question || "").replace(/’/g, "'").trim();
  const asked = op => fitsAsked({ id: "memory", args: { op } }, q);
  if (asked("forget_all")) return null;
  if (asked("remember")) {
    const said = q.replace(KEEP_AFTER, "");
    const words = said === q ? said.replace(KEEP_WORDS, "") : said;
    const text = words.split(ASKS_BESIDES)[0].replace(/[\s,]+$/, "");
    return text ? { id: "memory", args: { op: "remember", text: text[0].toUpperCase() + text.slice(1) }, label: "Remember" } : null;
  }
  return asked("forget") && !q.includes("?") && (misrouted || FORGET_MINE.test(q))
    ? { id: "memory", args: { op: "forget" }, label: "Forget" } : null;
}

// Her memory call, settled: {action} for the app (with answer, her line for it, when the site words it), or
// {action: null, answer} when there's nothing to send.
// rows: the account's and this character's notes (memoriesRead); count: all the account keeps; character: the asking
// character's page or Name-Realm; question: the player's words (a note is this character's only when they say so);
// plain: the player plainly asked (lib/willo-tools.js plainAsk), so a change runs at once with Undo; held and room: how
// many the account keeps, turned-away ones too, and how many it may (a full one is told before, never refused after).
// Asking what she remembers always opens her list at once. A note she keeps is "Okay." out loud: the check passed it
// before her answer (answer.js, lib/willo-memories.js memoryVerdict), and her app's line says "Remembering…", then
// what she kept.
export function settleMemory(action, { rows = [], count = 0, held = 0, room = Infinity, character = null, question = "",
  plain = false } = {}) {
  const args = action.args, op = args.op;
  if (op === "list") return { action: withNow(action) };
  if (op === "forget_all") {
    if (!count) return { action: null, answer: MEMORY_LINES.none };
    return { action: { ...action, label: `Forget all ${count}` },
      answer: count === 1 ? "I know one thing about you. Shall I forget it?"
        : `I know ${count} things about you. Shall I forget them all?` };
  }
  if (op === "forget") {
    // Their words for it, or the question's when she gave none (Flash-Lite called it empty 1 time of 3, the lab).
    const notes = namedNotes(args.text || question || "", rows);
    if (!notes.length) return { action: null, answer: MEMORY_LINES.nothing };
    const forgetting = { ...action, args: { op, text: notes[0].text, ids: notes.map(n => n.id) },
      label: `Forget: ${notes.map(n => n.text).join("; ")}`.slice(0, 60) };
    if (notes.length > FORGET_MOST) return { action: { ...forgetting, label: `Forget these ${notes.length}` },
      answer: `That's ${notes.length} things you've told me. Shall I forget them all?` };
    return { action: plain ? withNow(forgetting) : forgetting };
  }
  // remember: their words as she'd keep them, never one the pre-filter refuses or she has already.
  const text = clean(args.text || "", MEMORY_MAX);
  if (!text || memoryPreFilter(text)) return { action: null, answer: MEMORY_LINES.refused };
  const scope = THIS_CHARACTER.test(String(question || "")) ? characterOf(character) : null;
  if (rows.some(r => same(r.text, text) && (!r.character || r.character === scope))) return { action: null, answer: MEMORY_LINES.known };
  if (held >= room) return { action: null, answer: MEMORY_LINES.full };
  const keeping = { ...action, args: { op, text, ...(scope ? { character: scope } : {}) },
    label: `Remember: ${text}`.slice(0, 60) };
  return plain ? { action: withNow(keeping), answer: "Okay." } : { action: keeping };
}
