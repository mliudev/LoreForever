// Last checks on a written answer, in code, so they cost no time (Mike: speed is key): what the answer model makes up
// even when told not to, taken out after it writes (functions/api/companion/answer.js). Prompt rules alone measured no
// effect on made-up details (the accuracy lab, 10/16); these hold every time.
//
// - Map coordinates nothing supplied gave (LOR-652): "Deneb Walker ... on your map at roughly sixty-eight,
//   forty-three", then "closer to fifty-one, forty-eight" when the player said that was Hammerfall. Kept only when the
//   answer's facts, sources, look-up or the player's context hold that place (within a step on the map).
// - Willo talking as one of the player's people (LOR-626): "the beating heart of our people", "our druids". She's a
//   wisp who rides along, so it's "your people". Her own answers only: a character speaks for their people.
// - A player's note on how a name sounds becoming its spelling (LOR-653): told "It's actually pronounced Dun Moreau",
//   she wrote "Dun Moreau" in her answers about Helm's Bed Lake. The name is spelled as the game spells it.

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const DIGIT = String.raw`\d{1,3}(?:\.\d+)?`;
const SPELLED = String.raw`(?:(?:${TENS.slice(2).join("|")})(?:[- ](?:${ONES.slice(1, 10).join("|")}))?|hundred|${[...ONES].reverse().join("|")})` +
  String.raw`(?: point (?:${ONES.slice(0, 10).join("|")}))?`;
const NUMBER = String.raw`\b(?:${DIGIT}|${SPELLED})\b`;
const HAS_NUMBER = new RegExp(NUMBER, "i");

// A number as said or written ("sixty-eight", "68", "ten point five") -> 68, 10.5; NaN for anything else.
export function numberOf(text) {
  const t = String(text).toLowerCase().trim();
  if (/^\d/.test(t)) return Number(t);
  const [whole, tenth] = t.split(" point ");
  const words = whole.split(/[- ]/);
  let n = whole === "hundred" ? 100 : 0;
  for (const w of words) n += ONES.includes(w) ? ONES.indexOf(w) : TENS.includes(w) && w ? TENS.indexOf(w) * 10 : 0;
  if (!words.every(w => ONES.includes(w) || (TENS.includes(w) && w) || w === "hundred")) return NaN;
  return tenth ? n + ONES.indexOf(tenth) / 10 : n;
}

// The places on a map that supplied text gives: every "x, y" of numbers from 0 to 100, as written there.
function placesIn(text) {
  const out = [];
  for (const m of String(text || "").matchAll(new RegExp(`(${DIGIT})\\s*,\\s*(${DIGIT})`, "g"))) {
    const [x, y] = [Number(m[1]), Number(m[2])];
    if (x <= 100 && y <= 100) out.push([x, y]);
  }
  return out;
}

// A coordinate in an answer, with the words that lead into it and follow it, so all of it comes out together:
// ", on your map at roughly sixty-eight, forty-three", " at coordinates (63, 45) on your map", " near the coordinates
// fifty-one, forty-eight", ", about 68, 43".
const LEAD = String.raw`(?:,?\s*(?:which is |that's |located |found |standing |sitting )?(?:(?:on|at) (?:your|the) map )?` +
  String.raw`(?:at|near|around|by|to|is)\s+)?(?:(?:roughly|about|around|approximately|exactly|precisely|closer to|right at)\s+)?` +
  String.raw`(?:(?:the\s+)?(?:map\s+)?coord(?:inate)?s\s+(?:of\s+)?)?`;
const COORDINATE = new RegExp(`${LEAD}(\\(\\s*)?(${NUMBER})\\s*,\\s*(${NUMBER})(\\s*\\))?(\\s+on\\s+(?:your|the)\\s+map)?`, "gi");
const MAP_WORDS = /\bcoord(?:inate)?s?\b|\bon (?:your|the) map\b|\bmap\b/i;

// The answer without coordinates nothing supplied gives. supplied: everything the answer model was given (its
// prompt, facts, look-up finding, help). A sentence left talking about coordinates it no longer gives loses that part.
export function unsuppliedPlaces(answer, supplied) {
  const known = placesIn(supplied);
  const near = (x, y) => known.some(([a, b]) => Math.abs(a - x) <= 1.5 && Math.abs(b - y) <= 1.5);
  let cut = false;
  const sentences = String(answer).split(/(?<=[.!?])\s+/);
  const kept = sentences.map(sentence => {
    let changed = false;
    const out = sentence.replace(COORDINATE, (whole, open, a, b, close, onMap) => {
      const [x, y] = [numberOf(a), numberOf(b)];
      if (!Number.isFinite(x) || !Number.isFinite(y) || x > 100 || y > 100) return whole;
      // A coordinate, not just two numbers: in brackets, with "map" or "coordinates" in its sentence, or digits after a
      // place word ("about 68, 43").
      const digits = /^\d/.test(a) && /^\d/.test(b);
      const placed = /\b(?:at|near|around|about|roughly|approximately|closer to)\s*$/i.test(whole.slice(0, whole.indexOf(a)));
      if (!(open && close) && !onMap && !MAP_WORDS.test(sentence) && !(digits && placed)) return whole;
      if (near(x, y)) return whole;
      changed = true;
      return "";
    });
    if (!changed) return sentence;
    cut = true;
    // "...but the coordinates for his location are." loses that clause; a sentence with nothing left goes.
    const clauses = out.split(/(?<=[,;])\s+/);
    const left = clauses.filter(c => !/\bcoord(?:inate)?s?\b/i.test(c) || HAS_NUMBER.test(c)).join(" ")
      .replace(/[,;]\s*$/, "").replace(/\s+([,.;!?])/g, "$1").replace(/,\s*([.!?])/g, "$1").trim();
    if (!left) return "";
    return /[.!?]$/.test(left) ? left : `${left}${/[.!?]$/.test(sentence) ? sentence.slice(-1) : "."}`;
  });
  return cut ? kept.filter(Boolean).join(" ").trim() : String(answer);
}

// Willo's own "our people" (she's a wisp, not one of them): "your people".
const OURS = /\b(our)\s+(people|peoples|kind|race|folk|ancestors|forefathers|homeland|druids|elders|tribes?|clans?|warchief|chieftain|capital)\b/gi;
export const asCompanion = answer => String(answer).replace(OURS, (_, our, what) => `${our[0] === "O" ? "Your" : "your"} ${what}`);
// The game's own name at the end of a sentence about the world ("You can play an undead paladin in WoW Forever."):
// she speaks from inside it (IMMERSION), so the sentence ends before it. A question about the game itself, which names
// it elsewhere in the sentence ("WoW Forever's launcher..."), keeps it. The blind check, 10/18: 2 of 116 answers.
const GAME_NAME = /\s+(?:here\s+)?(?:in|on|within|throughout)\s+(?:the\s+(?:world\s+of\s+)?)?(?:WoW|World of Warcraft):?\s+Forever(?=\s*[.!?](?:\s|$))/g;
export const inWorld = answer => String(answer).replace(GAME_NAME, "");

// How the player says a name sounds ("It's actually pronounced Dun Moreau.", "you called it Dunmarogue"): a note on
// the voice, never a correction of the facts (functions/api/companion/answer.js).
export const SOUNDS = /\bpronounc(?:e|ed|es|ing|iation)\b|\byou (?:say|said|called|call) it\b/i;
const HEARD = /\bpronounced\s+(?:as\s+|like\s+)?["“']?([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,3})/g;
// The names the player spelled as they sound, in their notes of this conversation, mapped to the place they meant: a
// name from PLAYER CONTEXT (zone, subzone, target) with as many words, each starting the same two letters.
export function soundSpellings(notes, names) {
  const out = new Map();
  for (const note of notes) {
    for (const m of String(note || "").matchAll(HEARD)) {
      const heard = m[1].replace(/[.,!?]+$/, "").trim(), said = heard.split(/\s+/);
      const meant = names.filter(Boolean).find(n => {
        const w = n.split(/\s+/);
        return n.toLowerCase() !== heard.toLowerCase() && w.length === said.length &&
          w.every((x, i) => x.slice(0, 2).toLowerCase() === said[i].slice(0, 2).toLowerCase());
      });
      if (meant) out.set(heard, meant);
    }
  }
  return out;
}
export function spelledRight(answer, spellings) {
  let text = String(answer);
  for (const [heard, meant] of spellings) {
    text = text.replace(new RegExp(`\\b${heard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), meant);
  }
  return text;
}

// What the player said in a companion prompt's conversation: their turns (answer.py memory.render: one line of JSON)
// and its summary of earlier ones, which may keep a note from hours before; then the question itself.
export function playerLines(prompt, question) {
  const text = String(prompt || "");
  const recent = /RECENT CONVERSATION \(oldest first\)\n(\[.*\])/.exec(text);
  let turns = [];
  try { turns = recent ? JSON.parse(recent[1]) : []; } catch { turns = []; }
  const start = text.lastIndexOf("\nCONVERSATION\n"), end = text.lastIndexOf("\n\nQUESTION\n");
  const summary = start >= 0 && end > start ? text.slice(start, end).replace(recent?.[0] || "", "") : "";
  return [...turns.map(t => (typeof t?.player === "string" ? t.player : "")), summary, String(question || "")];
}

// What a companion prompt supplies as evidence: all of it but the conversation, whose earlier answers are Willo's own
// (a made-up coordinate would vouch for itself the next time: "closer to fifty-one, forty-eight", then the same again
// when asked to check), and then the player's own lines from it.
export function evidenceOf(prompt, question = "") {
  const text = String(prompt || "");
  const start = text.lastIndexOf("\nCONVERSATION\n"), end = text.lastIndexOf("\n\nQUESTION\n");
  const without = start >= 0 && end > start ? text.slice(0, start) + text.slice(end) : text;
  const recent = /RECENT CONVERSATION \(oldest first\)\n(\[.*\])/.exec(text);
  let turns = [];
  try { turns = recent ? JSON.parse(recent[1]) : []; } catch { turns = []; }
  return [without, ...turns.map(t => (typeof t?.player === "string" ? t.player : "")), String(question || "")].join("\n");
}

// All of them, for one written answer. own: Willo's own answer (not a character's); researched: required research,
// whose search results aren't in `supplied`, so its coordinates stay.
export function guardAnswer(answer, { supplied = "", own = true, researched = false, prompt = "", question = "",
  names = [] } = {}) {
  if (typeof answer !== "string" || !answer) return answer;
  let text = researched ? answer : unsuppliedPlaces(answer, supplied);
  if (own) text = inWorld(asCompanion(text));
  const spellings = soundSpellings(playerLines(prompt, question).filter(l => SOUNDS.test(l)), names);
  return spellings.size ? spelledRight(text, spellings) : text;
}

// The written answer of a spoken answer in two layers (LOR-673): what it says beyond her spoken words keeps only names
// and numbers that something she was given (`supplied`), or her spoken words, holds. A sentence with one nothing holds
// is left out, so the written answer adds the steps, places and numbers she was handed and never fills a gap from
// memory (the accuracy re-score, 10/18: the longer written answer raised wrong claims 7.6 -> 11.4%; the prompt's
// rule alone left item drops, quest steps and a graveyard in Ironforge in it). Words that start a sentence, and a few
// everyday capitalised ones, aren't names. With nothing left beyond her words, it's her words.
const NOT_NAMES = new Set(["I", "I'm", "I've", "I'll", "I'd", "You", "You're", "You'll", "Your", "The", "A", "An", "If",
  "When", "Then", "Once", "After", "Before", "Head", "Go", "Look", "Find", "Ask", "Take", "Bring", "Talk", "Speak",
  "Remember", "Keep", "Note", "Also", "And", "But", "Or", "So", "From", "To", "At", "In", "On", "For", "With", "This",
  "That", "These", "Those", "There", "It", "It's", "He", "She", "They", "We", "My", "Our", "Their", "His", "Her",
  "Level", "Levels"]);
const nameWords = sentence => sentence.split(/\s+/).slice(1).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
  .filter(w => /^\p{Lu}/u.test(w) && !NOT_NAMES.has(w));
const LIST_MARK = /^(\s*)(\d+[.)]|[-*•])(\s+)/;
export function groundedWritten(text, say, supplied) {
  if (typeof text !== "string" || !text.trim()) return text;
  const known = `${supplied || ""}\n${say || ""}`.toLowerCase();
  const said = String(say || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
  const backed = sentence => {
    const flat = sentence.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!flat || said.includes(flat)) return true;
    const numbers = sentence.match(/\d+(?:\.\d+)?/g) || [];
    return [...nameWords(sentence), ...numbers].every(t => known.includes(t.toLowerCase()));
  };
  // A list that loses any of its items: the written answer is her spoken words. What's left of it read as the whole
  // list, or a lead-in with no list ("collect the following items:", even with a blank line before the list), or a
  // sentence after it pointing at it ("Once you have these") (the blind checks, 10/18: mike-125, mike-316).
  const rows = text.split("\n").map(line => {
    const mark = LIST_MARK.exec(line);
    const body = mark ? line.slice(mark[0].length) : line;
    return { line, mark, kept: body.split(/(?<=[.!?])\s+/).filter(backed).join(" ").trim() };
  });
  if (rows.some(r => r.mark && !r.kept)) return String(say || text).trim();
  let n = 0;
  const lines = rows.map(({ mark, kept }) => {
    if (!kept) return null;
    if (!mark) return kept;
    return /\d/.test(mark[2]) ? `${mark[1]}${++n}.${mark[3]}${kept}` : `${mark[1]}${mark[2]}${mark[3]}${kept}`;
  }).filter(l => l !== null);
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  // Never less than her words: a written answer shorter than what she said is her words.
  return out && out.length >= String(say || "").trim().length ? out : String(say || text).trim();
}
