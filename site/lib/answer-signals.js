// What Willo's answers tell us without anyone pressing a button (Mike, 10/18: "understand when people are frustrated,
// when they are not getting what they want, and when we have a bad answer"): word rules and the app's own facts about
// the answer before, never an extra model call. The app sends those facts with the next question (`last`, below), so
// they cost no request of their own; the site reads them, tags the earlier answer's row in the answer log
// (lib/answer-log.js tagAnswer) and puts a strong one in the review queue (lib/answer-feedback.js, kind "signal").
//
// Signals on an answer (answer_log.signals, comma-separated; SIGNALS has each one's weight):
//   corrected            the next message said it was wrong, or "no, I meant…" (answer-feedback.js feedbackKind), or
//                        doubted it ("that doesn't sound right", "are you sure?", "I already did that": DOUBT, a signal
//                        only, never a change to how she answers)
//   mispronounced        the next message says how a name is said ("it's actually pronounced Dun Morogh": answer.js
//                        SOUNDS), for her voice
//   frustrated, gave_up  "that's useless", "you're not listening"; "never mind", "forget it"
//   rephrased            the same question asked again, in other words or the same ones, within a minute
//   repeated_after_fail  asked again after the answer failed
//   typed_after_voice_fail  asked out loud, then typed right after the answer missed (failed, cut off, unheard, asked again)
//   interrupted          the player cut her off mid-answer (the talk key while she was saying it)
//   voice_dropped        she was to say it and the voice never played (her words came as text only)
//   retried, failed      the app asked again (its Retry button or its own second ask), or the answer failed
//   reported, liked      a 👎 "Not right" (or Something's wrong) on it, or a quiet 👍 (functions/api/companion/feedback.js)
// A signal row in the queue needs weight 2 or more without a word report already made for it: one rephrase alone
// is normal talk; a rephrase after she was cut off, or a question asked again after a failure, is a miss.

export const SIGNALS = {
  corrected: 2, frustrated: 2, gave_up: 2, repeated_after_fail: 2, typed_after_voice_fail: 2, mispronounced: 2,
  rephrased: 1, interrupted: 1, voice_dropped: 1, retried: 0.5, failed: 0.5, reported: 0, liked: 0,
};
// The ones that say the player didn't get what they wanted: the "frustration rate" (lib/willo-quality.js).
export const MISSED = ["corrected", "frustrated", "gave_up", "rephrased", "repeated_after_fail", "typed_after_voice_fail"];
export const HEARD = ["full", "interrupted", "dropped", "text"];
const REPHRASE_MS = 60_000, AGAIN_MS = 5 * 60_000, SWITCH_MS = 2 * 60_000;
export const ANSWER_ID = /^[0-9a-f]{16}$/;

// A fresh id for one answer: the app keeps it on the turn and sends it back with a report or the next question.
export const newAnswerId = () => [...crypto.getRandomValues(new Uint8Array(8))]
  .map(b => b.toString(16).padStart(2, "0")).join("");

// What the app says about the answer before this question, or null:
//   {answer_id?, ms?: milliseconds since it came, heard?: "full" | "interrupted" | "dropped" | "text",
//    failed?: true, retried?: true, spoken?: true (it was asked out loud),
//    speed?: {up, heard?, prep?, picture?, answer?, held?, audio?} (asked out loud: milliseconds from the talk key coming
//    up to her first sound, and its pieces; the companion's talk/talker.py asked_speed, LOR-856 E4)}
export const SPEED_PIECES = ["up", "heard", "prep", "picture", "answer", "held", "audio"];
const SPEED_MAX_MS = 120_000;
function speedOf(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = Object.fromEntries(SPEED_PIECES.filter(k => Number.isFinite(value[k]) && value[k] >= 0 && value[k] <= SPEED_MAX_MS)
    .map(k => [k, Math.round(value[k])]));
  return "up" in out ? out : null;
}
export function lastOf(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const ms = Number.isFinite(value.ms) && value.ms >= 0 ? Math.min(Math.round(value.ms), 864e5) : null;
  const last = { answer_id: typeof value.answer_id === "string" && ANSWER_ID.test(value.answer_id) ? value.answer_id : null,
    ms, heard: HEARD.includes(value.heard) ? value.heard : null, failed: value.failed === true,
    retried: value.retried === true, spoken: value.spoken === true, speed: speedOf(value.speed) };
  return last.answer_id || last.ms !== null || last.heard || last.failed || last.retried ? last : null;
}

const STOP = new Set(("the and for are was were you your what where which who whom how why when can could would should " +
  "does did this that these those there here with from into about have has had any some get got just tell me please " +
  "willo know want need also then than its it's i'm im is to do of in on at a an my i").split(" "));
const words = s => new Set((String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "")
  .match(/[\p{L}\p{N}']+/gu) || []).map(w => w.replace(/'s$/, "")).filter(w => w.length >= 3 && !STOP.has(w)));
// The same question again: the same words, or at least half of what either asks in common ("where's the Southshore
// boat" and "which boat goes to Southshore"). A short follow-up ("why?", "tell me more") shares nothing and isn't one.
export function sameQuestion(a, b) {
  const norm = s => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!norm(a) || !norm(b)) return false;
  if (norm(a) === norm(b)) return true;
  const x = words(a), y = words(b);
  if (x.size < 2 || y.size < 2) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both >= 2 && both / new Set([...x, ...y]).size >= 0.5;
}

// Doubting the answer without the words feedbackKind takes as a correction (the live log, 10/18: "I think that must be
// wrong", "That doesn't sound right", "But I already did that, Willo"). Only after an answer.
const DOUBT = new RegExp([
  String.raw`\b(?:that|this|it)(?: just)? (?:doesn'?t|does not) (?:sound|seem|look) right\b`,
  String.raw`\b(?:that|this|it) (?:must|might|can'?t|cannot) be (?:wrong|right)\b`, String.raw`\bare you sure\b`,
  String.raw`\bi (?:already|just) (?:did|done|finished|have) (?:that|it|this)\b`, String.raw`\bthat'?s not it\b`,
  String.raw`\bi don'?t (?:see|think) (?:anything like that|that'?s right|so)\b`,
].join("|"), "i");

// The signals this question gives the answer before it. dispute: feedbackKind's ("correction", "misheard",
// "frustration", "gave_up" or null); spoken: this question was asked out loud; sounds: it says how a name is said
// (answer.js SOUNDS); answered: there was an answer before it.
export function signalsFor({ question, previousQuestion, last, spoken = false, dispute = null, sounds = false,
  answered = true }) {
  const tags = new Set();
  if (dispute === "correction" || dispute === "misheard") tags.add("corrected");
  else if (!dispute && answered && DOUBT.test(String(question || "").replace(/[’‘]/g, "'"))) tags.add("corrected");
  if (sounds) tags.add("mispronounced");
  if (dispute === "frustration") tags.add("frustrated");
  if (dispute === "gave_up") tags.add("gave_up");
  if (last) {
    const ms = last.ms ?? Infinity;
    const again = Boolean(previousQuestion) && sameQuestion(question, previousQuestion);
    if (last.failed) tags.add("failed");
    if (last.retried) tags.add("retried");
    if (last.heard === "interrupted") tags.add("interrupted");
    if (last.heard === "dropped") tags.add("voice_dropped");
    if (again && last.failed && ms <= AGAIN_MS) tags.add("repeated_after_fail");
    else if (again && ms <= REPHRASE_MS) tags.add("rephrased");
    if (last.spoken && !spoken && ms <= SWITCH_MS &&
        (last.failed || again || dispute || ["dropped", "interrupted"].includes(last.heard))) tags.add("typed_after_voice_fail");
  }
  return [...tags];
}

// The signals in plain words, for the queue's "said" (/admin, the nightly check).
const WORDS = {
  corrected: "said it was wrong", mispronounced: "said how a name is said", frustrated: "got frustrated", gave_up: "gave up on it", rephrased: "asked again within a minute",
  repeated_after_fail: "asked again after it failed", typed_after_voice_fail: "typed it right after asking out loud",
  interrupted: "cut her off mid-answer", voice_dropped: "her voice never played", retried: "the app asked again",
  failed: "the answer failed", reported: "pressed Not right", liked: "pressed thumbs up",
};
export const signalWords = tags => tags.map(t => WORDS[t] || t).join(", ").replace(/^./, c => c.toUpperCase()) || "No words";

export const weightOf = tags => tags.reduce((sum, t) => sum + (SIGNALS[t] || 0), 0);
// Worth a row in the review queue of its own: strong, and not already there as the player's own words.
export const queueWorthy = (tags, dispute) => !dispute && weightOf(tags) >= 2;

// What a question is about, by its words (no model): the demand view groups by it. Willo's own help, her notebook and a
// character answering in person come from how it was answered; the rest from the question.
export const TOPICS = {
  next: "What to do next", here: "Who or what is here", quest: "Quests", route: "Routes: getting somewhere", place: "Places",
  item: "Items and gear", profession: "Professions", class: "Classes, spells and stats", dungeon: "Dungeons and raids",
  progress: "Leveling, reputation, gold, mounts", lore: "Lore and story", willo: "Willo herself",
  notebook: "Notebook, goals and pins", character: "Characters in person", chat: "Chat and greetings",
  other: "Everything else",
};
// Words before the question that say nothing of it: her name ("Hey Willo," and how speech-to-text spells it), fillers.
const LEAD = /^(?:\W*(?:hey|hi|hello|ok(?:ay)?|so|well|uh+|um+|mm+)?\W*(?:willo|willow|wilo)\b\W*|\W*(?:uh+|um+|so|well|okay|ok)\b[\s,.]*)+/i;
const RULES = [
  ["chat", /^\W*(?:(?:hi|hello|hey|hiya|yo|thanks|thank you|thx|ty|good (?:morning|night|evening|to know)|how are you(?: doing)?|ok(?:ay)?|cool|nice|lol|yeah|yes|yep|no|nope|mm+|hm+|great|got it|i see|i appreciate it|are you there|this is (?:just )?a test|willo|willow)\b[\s\W]*)+$/i],
  ["willo", /\b(?:your (?:settings|colou?r|voice|name|light)|(?:can|could|do|will) you (?:speak|talk|see|hear|open|change|switch|understand|remember|tell me when)|speak (?:aloud|to me|out loud)|switch to \w+|change your|about you(?:rself)?|who are you|what can you do|did you do|my friends?)\b/i],
  ["next", /\bwhat (?:should|can|do) i do\b|\bwhat now\b|\bwhere should i go\b|\bnext steps?\b|\bgive me \w+ steps\b|\bwhat(?:'s| is) next\b/i],
  ["here", /\bwho(?:'s| is| do you think) (?:this|that)\b|\bthis guy\b|\bwhat am i looking at\b|\bwhat is (?:this|that)(?: place)?\W*$|\bwhat(?:'s| is) (?:he|she|it|that \w+) doing\b|\bwhat is going on\b|\bis this (?:enemy|mob|monster)\b|\bwhat is he guarding\b/i],
  // The way somewhere, apart from where a place is (the PM, 10/19: routes on their own on the accuracy card); a level
  // or a skill to get to isn't a place ("how do I get to 150 skinning?"), and where a boat leaves from is one.
  ["route", /\bhow (?:do|can|would|should|to) (?:i |we )?(?:get|go|travel|make (?:my|our) way)(?: back| over)? (?:to|into|there|from)\b(?! (?:level|lvl|\d))|\b(?:get|go|travel|head|fly) (?:back )?to\b(?! (?:level|lvl|\d))|\b(?:fastest|quickest|best|shortest) way\b|\bway (?:to|from)\b|\broute\b|\bdirections?\b|\b(?:get|take|catch|ride|hop on)(?: a| the)? (?:boat|ship|zeppelin|tram|flight)s? (?:to|from)\b|\bis there an? (?:boat|ship|zeppelin|tram|flight)\b|\bwhich way\b|\bhow far\b/i],
  ["quest", /\bquests?\b|\bturn(?:-| )?in\b|\bquest ?giver\b|\bobjective\b|\bwhere do i (?:take|bring|hand)\b/i],
  ["profession", /\b(?:trainers?|teach me|train(?:ing)?|professions?|herbalism|herbs?|mining|ore|skinning|alchemy|potions?|blacksmith(?:ing)?|enchant(?:ing|er)?|engineer(?:ing)?|tailor(?:ing)?|leatherworking|cooking|fishing|first aid|recipes?|skill (?:up|points?))\b/i],
  ["item", /\b(?:items?|weapons?|armou?r|swords?|axes?|maces?|daggers?|staff|staves|bows?|guns?|shields?|rings?|trinkets?|necklace|cloak|helm|boots|gloves|drops?|loot|bis|gear|upgrades?|vendors? (?:sell|has))\b/i],
  ["class", /\b(?:talents?|specs?|rotation|spells?|abilit(?:y|ies)|warriors?|paladins?|hunters?|rogues?|priests?|shamans?|mages?|warlocks?|druids?|class(?:es)?|pet|totems?|strength|stamina|agility|intellect|spirit|attack power|armou?r|crit(?:ical)?|dodge|parry|regen(?:eration)?|damage|dps|tank(?:ing)?|heal(?:er|ing)?|macros?|#showtooltip|cooldowns?)\b/i],
  ["dungeon", /\b(?:dungeons?|raids?|instances?|deadmines|stockade|wailing caverns|shadowfang|blackfathom|gnomeregan|scarlet monastery|razorfen|uldaman|zul'?farrak|maraudon|sunken temple|blackrock|scholomance|stratholme|dire maul|molten core|onyxia|boss(?:es)?)\b/i],
  ["place", /\bwhere\b|\bhow (?:do|can|to) i? ?(?:get|go|reach|find)\b|\bget (?:out of|there|to)\b|\bway to\b|\bdirections?\b|\bboats?\b|\bzeppelins?\b|\bfl(?:y|ight) ?(?:path|master)?\b|\bfly to\b|\bportals?\b|\bnorth|\bsouth|\beast\b|\bwest\b|\b(?:zone|town|village|city|camp|keep|harbou?r|graveyard|inn)\b|\bthis place\b|\bthrough (?:the )?\w+|\b(?:find|direct me to|take me to) (?:the|a)\b/i],
  ["progress", /\b(?:level(?:ing)?|xp|experience|reputation|rep|honou?r|gold|money|silver(?! lining)|mounts?|riding|bags?|bank|auction)\b/i],
  ["lore", /\b(?:who (?:is|was|were|are|leads|led|rules|ruled|founded|killed|made)|history|story|backstory|lore|what happened|legend|king|queen|prince|war|why (?:is|was|did|are|were)|tell me (?:a little )?(?:more )?(?:bit )?about|tell me more|what can you tell me about|what is \w+|what are the)\b/i],
];
export function topicOf(question, { operation = "answer", lookups = [], action = null } = {}) {
  if (operation === "character") return "character";
  if (Array.isArray(lookups) && lookups.includes("help")) return "willo";
  if (Array.isArray(lookups) && (lookups.includes("notebook") || lookups.includes("goals")) ||
      /^(?:notebook_|goal_)/.test(action || "")) return "notebook";
  const asked = String(question || "").replace(/[’‘]/g, "'");
  const q = asked.replace(LEAD, "");
  if (!q.trim() && asked.trim()) return "chat";           // only her name: "Hey, Willo."
  for (const [topic, rule] of RULES) if (rule.test(q)) return topic;
  return "other";
}
