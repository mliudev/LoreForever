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
// Where they were last, said as such (the vision check, 10/19): with only the place the game last saved, she said "You
// are standing right in the heart of Sentinel Hill" or "right here in Darkshire" 6 times in 12. Present-tense
// "you are in/at" becomes "you were last in/at", "right here" becomes "there", and words that don't say it's from
// where they were last start "From <place>, where you were last, ".
// Only before a place (a name, or the heart, edge or town of one): "since you are at level 18" stays as it is.
// (Case by hand, not /i: with it, \p{Lu} takes "level" too.)
const YOU_ARE_AT = /\b([Yy]ou)(?:'re| are)(?: (?:standing|currently|now|still))*(?: right)? (in|at|near|by) (?=(?:the )?(?:heart|town|edge|middle|center|centre|outskirts|village|city|camp|ruins|gates?) of\b|the(?: \p{Ll}+){1,2} (?:in|of) \p{Lu}|(?:the )?\p{Lu})/gu;
const LAST_SAID = /\bwhere you were last\b|\byou were last\b|\blast (?:saved|saw)\b|\bif you(?:'re| are)(?: not| no longer| still)\b|\banymore\b/i;
const OPENERS = /^(?:The|You|Your|Head|Go|Take|Fly|Travel|Walk|Ride|It|There|A|An|Just|To|Follow|Find|Look|Make|Once|First|If|When|Since)\b/;
// said: false is only the rewrite of the present tense (away from the game, where the zone she was given is stale but she
// may still answer a question that has nothing to do with it): no "From <place>, where you were last," added.
export function fromWhereLast(text, place, { said = true } = {}) {
  if (typeof text !== "string" || !text.trim() || !place) return text;
  let out = text.replace(YOU_ARE_AT, (_, you, at) => `${you} were last ${at} `)
    // "at the inn here in Sentinel Hill": the "here" goes (the vision check: 2 of 3).
    .replace(/\b(?:right )?here (?=(?:in|at) \p{Lu})/gu, "").replace(/\bright here\b/gi, "there").replace(/\b(?:is |are )?just ahead of you\b/gi, m => m.replace(/just ahead of you/i, "near there"));
  // "You are standing right here in X": the "here" goes first, then the present tense (away, nothing follows to say it).
  if (!said) out = out.replace(YOU_ARE_AT, (_, you, at) => `${you} were last ${at} `);
  if (said && !LAST_SAID.test(out)) {
    const town = String(place).split(",")[0].trim();     // the town, not its zone too
    // Words that name the town already get it after its first mention, not the town twice (the vision re-check,
    // 10/19: "From Darkshire, where you were last, to reach the Wetlands from Darkshire, ...").
    // (An apostrophe her words may drop: "Gromgol Base Camp".)
    const named = new RegExp(`\\b${town.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]?")}\\b`, "i").exec(out);
    if (named) {
      const end = named.index + named[0].length;
      out = `${out.slice(0, end)}, where you were last${/^[.,!?;:]/.test(out.slice(end)) ? "" : ","}${out.slice(end)}`;
    } else {
      const first = out.trimStart();
      const rest = OPENERS.test(first) ? first[0].toLowerCase() + first.slice(1) : first;
      out = `From ${town}, where you were last, ${rest}`;
    }
  }
  return out;
}

// A level she gives for a day of their journey (Silver's iPhone QA, 10/19: "Did I ever kill Hogger?" got "...back on
// October 12, when you were level 11" from a journey with level 1 on October 10 and level 11 on October 13, and Mother
// Fang "level 6"). It stays only when FROM THEIR JOURNEY gives that level on a day the sentence names, or, said as
// about ("around level 6"), lies between the levels it gives that day; in a sentence naming no day of it, only a level
// it gives at all. Otherwise the level goes and the rest of the sentence stays.
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const A_DAY = `(?:${MONTHS}) \\d{1,2}(?:, \\d{4})?`;
const LINE_DAY = new RegExp(`^(?:- (?:[^:\\n]{1,40}: )?|Their journey begins )(${A_DAY})(?:,(?: at)? level (\\d{1,2})\\b)?`, "gm");
// A day as she writes or says it ("October 12", "October 12th", "October the twelfth"): "October 12".
const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
  "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth",
  "twentieth"];
const ordinal = word => {
  const w = word.toLowerCase(), [tens, ones] = w.split(/[- ]/);
  if (ORDINALS.includes(w)) return ORDINALS.indexOf(w);
  if (w === "thirtieth") return 30;
  return ones && ORDINALS.includes(ones) ? { twenty: 20, thirty: 30 }[tens] + ORDINALS.indexOf(ones) : NaN;
};
const SAID_DAY = new RegExp(`\\b(${MONTHS})\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b|\\b(${MONTHS})\\s+(?:the\\s+)?` +
  `((?:twenty|thirty)[- ](?:${ORDINALS.slice(1, 10).join("|")})|${ORDINALS.slice(1).reverse().join("|")}|thirtieth)\\b`, "gi");
const daysIn = sentence => [...sentence.matchAll(SAID_DAY)].map(([, month, digits, month2, word]) => {
  const name = month || month2;
  return `${name[0].toUpperCase()}${name.slice(1).toLowerCase()} ${digits ? Number(digits) : ordinal(word)}`;
});
const LEVEL_SAID = new RegExp(`(,?\\s*\\b(?:back\\s+)?(?:[Ww]hen|[Ww]hile)\\s+you\\s+were\\s+(?:still\\s+|only\\s+|just\\s+)?|` +
  `,?\\s+(?=(?:at|around|about)\\s+level\\b))((?:at|around|about)\\s+)?level\\s+(${NUMBER})`, "g");
export function journeyLevels(text, prompt) {
  const source = String(prompt || ""), at = source.indexOf("FROM THEIR JOURNEY (");
  if (typeof text !== "string" || at < 0) return text;
  const end = source.indexOf("\n\n", at);
  const byDay = new Map();
  for (const [, line, lv] of source.slice(at, end < 0 ? undefined : end).matchAll(LINE_DAY)) {
    const day = line.replace(/, \d{4}$/, "");
    byDay.set(day, byDay.get(day) || []);
    if (lv) byDay.get(day).push(Number(lv));
  }
  const all = [...byDay.values()].flat();
  return (text.match(/[^.!?]+(?:[.!?]+|$)\s*/g) || [text]).map(sentence => {
    const days = daysIn(sentence).filter(d => byDay.has(d));
    return sentence.replace(LEVEL_SAID, (said, lead, about, n, offset) => {
      // "at level" only where the sentence is about a day of the journey ("you can ride at level 40" stays).
      if (!/\bwere\b/.test(lead) && !days.length) return said;
      const level = numberOf(n), near = Boolean(about && /around|about/.test(about));
      const fits = levels => levels.includes(level) || (near && levels.length > 0 && level >= Math.min(...levels) &&
        level <= Math.max(...levels));
      if (days.length ? days.some(d => fits(byDay.get(d))) : all.includes(level)) return said;
      // Said first in its sentence ("When you were level 11, you..."): its comma goes, and the next word leads.
      return offset === 0 || /^\s*$/.test(sentence.slice(0, offset)) ? "\u0000" : "";
    }).replace(/^(\s*)\u0000,?\s*(\S)/, (_, space, first) => space + first.toUpperCase());
  }).join("");
}

// A character's reply never sends the adventurer to their companion (Mike, 10/19: "The characters keep telling me to
// ask the willow wisp of light by my shoulder"; 12 of 23 character replies in the answer log did, "ask your little
// wisp of light", "speak wit' yer little wisp friend"): a sentence naming Willo, or a wisp or light that's theirs, is
// left out. The wisps of the night elves' world ("the wisps of Teldrassil") are no one's companion and stay.
const COMPANION_MENTION = new RegExp([
  String.raw`\bwillow?\b`,
  String.raw`\b(?:your|yer|ye|thy)\s+(?:[\p{L}']+\s+){0,2}wisps?\b`,
  String.raw`\bwisps?\s+(?:of\s+yours|friend)\b`,
  String.raw`\b(?:your|yer|thy)\s+companion\b`,
  String.raw`\b(?:light|wisp)\b[^.!?]{0,40}\b(?:by|at|on|over)\s+(?:your|yer|thy)\s+shoulder\b`,
].join("|"), "iu");
const NO_IDEA = "I couldn't say, friend.";
export function noCompanion(text) {
  if (typeof text !== "string" || !COMPANION_MENTION.test(text)) return text;
  const kept = (text.match(/[^.!?]+(?:[.!?]+["”’']?|$)\s*/g) || [text]).filter(s => !COMPANION_MENTION.test(s));
  return kept.join("").trim() || NO_IDEA;
}

export function guardAnswer(answer, { supplied = "", own = true, researched = false, prompt = "", question = "",
  names = [], savedPlace = "", lastPlace = "", character = false } = {}) {
  if (typeof answer !== "string" || !answer) return answer;
  let text = researched ? answer : unsuppliedPlaces(answer, supplied);
  if (own) text = journeyLevels(inWorld(asCompanion(text)), prompt);
  if (character) text = noCompanion(text);
  if (own && savedPlace) text = fromWhereLast(text, savedPlace);
  else if (own && lastPlace) text = fromWhereLast(text, lastPlace, { said: false });
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
