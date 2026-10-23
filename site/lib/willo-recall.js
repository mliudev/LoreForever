// Ask your journey from anywhere (LOR-672 part 4: Willo for iPhone): "where did I see that rare wolf?", "when did I first
// reach Westfall?", "how many times did I die in Duskwood?". Willo's app on the PC answers these from its own journal
// (companion/lore_companion/recall.py: FROM THEIR JOURNEY in the prompt it sends); a question that comes without one (the
// iPhone has no journal) is searched here, over the journey that app synced with the profile (lib/journey.js
// readJourney: at most MAX_MOMENTS of the character the profile shows; lib/saved-journey.js). The same rules and words
// as recall.py, so she answers the same on both: the moments that match go into the prompt with the day and the place,
// nothing matching is said in so many words (she says it isn't in their journey instead of guessing, LOR-652), a count
// is only what the journey holds, and other players are never named (the synced journey keeps none). What's synced
// has no map spots: never a direction or a map number. With nothing synced, she says in her own voice that she hasn't
// heard of their travels yet, never a guess.

export const RECALL_MAX_BYTES = 2000;   // what FROM THEIR JOURNEY may add to the prompt (recall.py MAX_BYTES)
const LINES = 10;                       // moments told in full
const NOTE = "what the game kept of this character's own road that matches this question. Answer a question about " +
  "their past from these lines only, with the place and the day (for a first arrival, their level then too), and say " +
  "what happened as the line has it (they beat it, met them, took it up). Never guess a place, day, name or count. " +
  "Several matches: name them briefly or ask which. Speak of it as their journey or the road you've traveled together, " +
  "never as records or logs.";
// From the phone only the journey's main moments are seen (the kinds Willo on the PC syncs, profile.py JOURNEY_KINDS):
// "nothing" means nothing she can see from here, never that it didn't happen (the blind check, 10/18: "no sign of a
// mount" for a paladin's Summon Warhorse, a spell, which isn't synced).
const SEEN_HERE = "From the phone you see only the main moments of their journey: new places and dungeons, quests taken up " +
  "and finished, people met, bosses, rares and elites beaten, deaths, levels, books read, loot, reputations, battles and " +
  "mounts the game announced. Anything else (spells learned, flights, who they were with, who handed out a quest) isn't " +
  "here: say you can't see it from the phone, never that it didn't happen.";
const NOTHING = "(Nothing in the part of their journey that reaches the phone matches this. Answer in one line that names " +
  "what they asked about and that you can't see it from here, like \"I can't see <it> on the road that reaches me " +
  "here{since}.\" Never that it didn't happen. No place, no map numbers, nothing about where such a thing is or lives, " +
  "never a place from SOURCES as where they saw it, never records.)";
// Nothing synced (P5): she hasn't heard of their road yet, said in her own voice. No phone, PC, sync, profile or
// setting (the immersion rule; the blind check, 10/21: "it only syncs once your computer connects to your Lore Forever
// profile" in 3 of 3 runs).
const ELSEWHERE = "(Their journey hasn't reached you yet. Answer in one short line, in your own voice, that you haven't " +
  "heard of their travels yet, and ask them to tell you where they've been, like \"I haven't heard of your travels yet; " +
  "tell me where you've been.\" Never a word about phones, computers, syncing, profiles, settings or apps. Never guess " +
  "what happened, where or when.)";
// "On any of my characters": only the one the profile shows is synced (the quality bar's case 12, from the phone).
const EVERYONE = /\b(?:any|all|which|each|every|other)\s+(?:of\s+)?(?:my\s+)?(?:characters?|alts?|toons?)\b|\bmy\s+(?:other\s+)?(?:alts?|toons?)\b/i;
const ONLY = "(Only {name}'s road reaches the phone: answer from {name}'s alone and say so, and that you can't see " +
  "their other characters' roads from here. Never a flat no for all of them.)";
// Asked about any of their characters by another one: the road that reaches the phone is one of theirs, so it's told,
// as that character's (the blind check, 10/18: a flat "no" though Hurin had been).
const ONE_OF = "(These lines are {name}'s, another of their characters, not the one asking: say it was {name}. You " +
  "can't see this character's own road or the others' from the phone: say so. Never a flat no for all of them.)";
const OTHER = "(Their journey here is {name}'s, not this character's: say in one line that you can only see {name}'s " +
  "road from the phone, and never tell {name}'s as theirs. Never guess.)";

// A question about the player's own past: what they did, saw, met, got or reached, and when or where (recall.py ASKS).
const ASKS = new RegExp([
  String.raw`\b(?:where|when|who|what|which|how)\b[^.?!]{0,50}\b(?:did|have|had|was|were)\s+(?:i|we)\b`,
  String.raw`\bwho\s+(?:gave|sent|asked|told|handed|offered)\s+(?:me|us)\b`,
  String.raw`\b(?:where|when|who|what|which)\s+(?:was|were)\s+(?:that|those)\b`,
  // Only of the past: "how many times have I died", "how often I've wiped", "how many rares I killed"; never "how many
  // rotations can I go through" (the accuracy eval, 10/21: she opened with "I can't see your journey").
  String.raw`\bhow\s+(?:many|often)\b[^.?!]{0,50}\b(?:(?:have|had)\s+(?:i|we)|i've|we've|(?:i|we)\s+(?:killed|died|beat|beaten|saw|seen|met|got|gotten|did|done|visited|reached|looted|found|fought|finished|completed|read|learned|bought|ran|went|turned))\b`,
  String.raw`\b(?:have|had|did)\s+(?:i|we)\s+(?:ever\s+|already\s+|yet\s+)?(?:been|seen|met|killed|beaten|beat|done|` +
    String.raw`finished|visited|gone|read|got|gotten|found|fought|died|reached|learned|looted|taken|picked|spotted|bought)\b`,
  // "did I ever kill that rare?", "did I see Lupos?" (a rare only seen is in the journey too, LOR-672)
  String.raw`\bdid\s+(?:i|we)\s+(?:ever\s+|already\s+|really\s+)?(?:kill|beat|defeat|slay|fight|see|spot|meet|buy|visit|` +
    String.raw`reach|loot|die)\b`,
  String.raw`\b(?:first|last)\s+time\s+(?:i|we)\b`,
  String.raw`\bwhen\s+(?:i|we)\s+(?:first|last)\b`,
  String.raw`\b(?:my|our)\s+(?:journey|road|travels|adventures?)\b`,
  String.raw`\b(?:i've|i\s+have|i\s+had|i'd)\s+(?:been|seen|met|killed|beaten|done|visited|died)\b`,
  String.raw`\b(?:what|who|which)\b[^.?!]{0,30}\b(?:killed|slew|got|felled|downed|took\s+down)\s+(?:me|us)\b`,
  String.raw`\b(?:who|what|which|where|when)\b[^.?!]{0,60}\b(?:i|we)\s+(?:ran|did|fought|grouped|went|met|killed|beat|` +
    String.raw`saw|got|took|found|read|died|reached|visited|learned|looted|picked|turned|finished|completed)\b`,
].join("|"), "i");
const FIRST = /\b(?:first|earliest|start(?:ed)?|begin|began)\b/i;
const LAST = /\b(?:last|latest|recent(?:ly)?|lately|most\s+recent)\b/i;
// Pinned spots are the notebook's (lib/willo-pins.js), never the journey's.
const PINS = /\b(?:pins?|pinned|unpin)\b|\b(?:mark|save|remember)\s+(?:this|that|the|my)\s+(?:spot|place|location)\b/i;

const RARE = new Set(["rare", "rareelite"]);
const ELITE = new Set(["elite", "rareelite", "worldboss"]);
const MOUNT = /^(?:reins of|horn of the|whistle of the)\b|\bbridle$|\bmechanostrider$|\bskeletal (?:horse|warhorse)$|^summon (?:felsteed|dreadsteed|warhorse|charger)$|\b(?:ram|kodo|stallion|mare|nightsaber|frostsaber|striped \w+saber|warhorse|steed)$/i;
// What a question asks about, by its words: the kinds of moment it means (recall.py KINDS, the ones the site keeps).
const KINDS = [
  [/\brares?\b/i, "rare"],
  [/\belites?\b/i, "elite"],
  [/\bboss(?:es)?\b/i, "boss"],
  [/\b(?:die|died|dying|dead|deaths?|slain|fell|wiped)\b|\b(?:killed|slew|got|felled|downed|took\s+down)\s+(?:me|us)\b/i, "death"],
  [/\b(?:mounts?|horse|ride|riding|steed)\b/i, "mount"],
  [/\b(?:level(?:ed)?|lvl|ding(?:ed)?)\b|\b(?:hit|reach(?:ed)?|got to|get to)\s+\d{1,2}\b/i, "lvl"],
  [/\b(?:finish(?:ed)?|complet(?:e|ed)|turn(?:ed)? in|done)\b/i, "qt"],
  [/\b(?:gave|give|sent|handed|offered|took up|picked up|accepted|started)\b/i, "qa"],
  [/\bquests?\b/i, "quest"],
  [/\b(?:met|meet|meeting|talked to|spoke(?:n)? to)\b/i, "npc"],
  [/\b(?:read|books?|tomes?)\b/i, "book"],
  [/\b(?:reach(?:ed)?|arrive[ds]?|visit(?:ed)?|been to|been in|go(?:ne)? to|went to|get to|got to|came to|enter(?:ed)?|discover(?:ed)?)\b/i, "zone"],
  [/\b(?:rep|reputation|honou?red|revered|exalted|friendly)\b/i, "rep"],
  [/\b(?:loot(?:ed)?|drop(?:ped)?|got (?:my|the|a|an)|find|found)\b/i, "loot"],
  [/\b(?:pictures?|screenshots?|photos?|snapshots?)\b/i, "shot"],
  [/\b(?:dungeons?|instances?|raids?)\b/i, "dungeon"],
  [/\b(?:battles?|battlegrounds?|bgs?|warsong|arathi basin|alterac valley)\b/i, "bg"],
  [/\b(?:kill(?:ed)?|beat(?:en)?|defeat(?:ed)?|fought|slew|slay)\b/i, "kill"],
];
// Words that say nothing about which moment (recall.py STOP), and the ones that only say which kind (KIND_WORDS).
const STOP = new Set(("about again also and any are around ask asked back been before being but can could day days did " +
  "does doing done each ever first for from gave get give going got had has have her here him his how into its just " +
  "last let like many may me might more most much must my near need never now off old once one only our out over " +
  "please really remember remind run saw say see seen she should since some still such tell than that the their them " +
  "then there these they thing things this those though time times told took town was way were what when where which " +
  "while who whom why will with would yet you your yours already where's what's who's i'm i've we've character " +
  "characters alt alts toon toons other others guy guys one ones place places spot spots area journey journeys road " +
  "travel travels adventure adventures far lately up hey willo willow today tonight yesterday night week weeks ago " +
  "evening morning afternoon month months two three four five six seven name names called most least").split(" "));
const KIND_WORDS = new Set(("rare rares elite elites boss bosses die died dying dead death deaths killed slain fell wiped " +
  "mount mounts horse ride riding steed level leveled lvl ding dinged hit reach reached finish finished complete " +
  "completed turn turned gave give sent handed offered took picked accepted started quest quests met meet meeting " +
  "talked spoke spoken read book books tome tomes arrive arrived arrives visit visited enter entered discover " +
  "discovered gone went came rep reputation honored honoured revered exalted friendly loot looted drop dropped find " +
  "found inn hearth hearthstone home picture pictures screenshot screenshots photo photos snapshot snapshots flight " +
  "flights flew fly profession professions spell spells learn learned train trained dungeon dungeons instance " +
  "instances raid raids kill beat beaten defeat defeated fought slew slay first earliest latest recent recently lately " +
  "note notes notebook list todo pin pins pinned spot spots battle battles battleground battlegrounds").split(" "));
const WORD = /\p{L}[\p{L}\p{N}_'’-]*/gu;

const stem = w => {
  w = w.toLowerCase().replace(/’/g, "'").replace(/'s$/, "").replace(/^['-]+|['-]+$/g, "");
  if (w.length > 4 && w.endsWith("ves")) return `${w.slice(0, -3)}f`;
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
};
export function words(text, drop = new Set()) {
  const out = new Set();
  for (const w of String(text || "").match(WORD) || []) {
    if (w.length >= 3 && !STOP.has(w.toLowerCase()) && !drop.has(w.toLowerCase())) out.add(stem(w));
  }
  return out;
}
// A word of the question names a word of a moment: the same word, or one starting the other ("Stranglethorn" for
// "Stranglethorn Vale"; the moment's starting the question's only as a word's ending, never "West" for "Westfall").
const match = (a, h) => a === h || (a.length >= 4 && h.startsWith(a)) || (h.length >= 4 && a.startsWith(h) && a.length - h.length <= 2);

export const asks = question => ASKS.test(String(question || "").replace(/’/g, "'"));
// What's still ahead ("what have I got left to do in Elwynn?", "which quests have I yet to finish?"): their own synced
// journey helps (what they've done there), but without it there's nothing of their past to say, so no journey line
// (the accuracy lab, 10/22). Only ahead: the question reads as past only through these words; "...and where did I die?"
// beside them is still about their past.
const AHEAD = /\b(?:have|had)\s+(?:i|we)\s+(?:still\s+)?(?:got\s+(?:left|to)|yet\s+to|left\s+to)\b|\b(?:i|we)(?:'ve|\s+have)\s+(?:still\s+)?got\s+(?:left|to)\b/gi;
export const onlyAhead = question => {
  const q = String(question || "").replace(/’/g, "'");
  return ASKS.test(q) && !ASKS.test(q.replace(AHEAD, " "));
};

// The kinds of moment the question asks about; a narrower kind wins over the broad one it's part of.
function kindsOf(q) {
  const kinds = new Set(KINDS.filter(([rx]) => rx.test(q)).map(([, k]) => k));
  if (kinds.has("mount")) kinds.delete("loot");
  if (kinds.has("death") && /\b(?:killed|slew|got|felled|downed)\s+(?:me|us)\b/i.test(q)) { kinds.delete("kill"); kinds.delete("loot"); }
  if (kinds.has("rare") || kinds.has("elite") || kinds.has("boss")) kinds.delete("kill");
  if (kinds.has("qa") || kinds.has("qt")) kinds.delete("quest");
  if (kinds.has("qa") && kinds.has("qt")) kinds.delete(/\b(?:gave|give|sent|handed|offered)\b/i.test(q) ? "qt" : "qa");
  return kinds;
}
// The kinds of moment this one is (recall.py tags), for the moments the site keeps.
function tags(e) {
  const out = new Set();
  if ((e.k === "kill" || e.k === "seen") && RARE.has(e.cls)) out.add("rare");
  if ((e.k === "kill" || e.k === "seen") && ELITE.has(e.cls)) out.add("elite");
  if (e.k === "kill" || e.k === "boss") out.add("kill");
  if (e.k === "mount" || (e.k === "loot" && MOUNT.test(e.n || ""))) out.add("mount");
  if (e.k === "qa" || e.k === "qt") out.add("quest");
  if (e.k === "zone") {
    if (e.new || e.inst) out.add("zone");
    if (e.inst) out.add("dungeon");
  } else if (["boss", "death", "lvl", "qa", "qt", "npc", "book", "rep", "loot", "shot", "bg"].includes(e.k)) out.add(e.k);
  return out;
}
const STANDING = ["", "Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"];
const names = e => [e.n, e.by, e.k === "rep" ? STANDING[e.st] : ""].filter(v => typeof v === "string" && v).join(" ");
const placeOf = e => (e.s && e.z && e.s !== e.z ? `${e.s}, ${e.z}` : e.s || e.z || "");

const MONTH = d => d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
// "October 11" on the player's calendar (minutes from UTC: the moment's own, else the journey's); the year only when
// it isn't this one.
export function dayOf(t, tz, now) {
  const d = new Date((t + (tz || 0) * 60) * 1000), today = new Date(now.getTime() + (tz || 0) * 60e3);
  return `${MONTH(d)} ${d.getUTCDate()}${d.getUTCFullYear() !== today.getUTCFullYear() ? `, ${d.getUTCFullYear()}` : ""}`;
}

const HOW = { flight: "by flight", hearth: "by hearthstone", boat: "by sea", portal: "through a portal", corpse: "as a spirit",
  instance: "into a dungeon" };
const CLS = { rare: "a rare", rareelite: "a rare elite", elite: "an elite", worldboss: "a world boss" };
// One moment, told (recall.py what), without its place: the line puts that first. beaten: the names this journey has
// beaten (its kills and bosses), so a rare only seen says so in so many words (LOR-672).
function what(e, beaten = null) {
  const where = placeOf(e), cls = CLS[e.cls] || "";
  switch (e.k) {
    case "zone":
      if (e.new) return `first arrived at ${where}${e.inst ? " (a dungeon)" : HOW[e.how] ? `, ${HOW[e.how]}` : ""}`;
      return e.inst ? `entered ${where} (a dungeon)` : null;
    case "qa": return `took up "${e.n || "a quest"}"`;
    case "qt": return `finished "${e.n || "a quest"}"`;
    case "npc": return `met ${e.n}`;
    case "kill": return `fought and beat ${e.n}${cls ? `, ${cls},` : ""} for the first time`;
    case "seen": return `first saw ${e.n}${cls ? `, ${cls}` : ""}` +
      (beaten && !beaten.has(e.n) ? " (only seen: no fight with it is in their journey)" : "");
    case "boss": return `defeated ${e.n}`;
    case "death": return `fell${e.by ? `, slain by ${e.by}` : " (what felled them wasn't kept)"}`;
    case "book": return `read "${e.n}"`;
    case "lvl": return e.lv ? `reached level ${e.lv}` : null;
    case "rep": return `became ${STANDING[e.st] || "better known"} with ${e.n}`;
    case "mount": return `${e.how === "bought" ? "bought" : "got"} a mount, ${e.n}`;
    case "loot": return `came by ${e.n}${MOUNT.test(e.n || "") ? ", a mount" : ""}`;
    case "shot": return "took a picture";
    case "bg": return `fought in ${e.n}${e.out === "win" ? " and won" : e.out === "loss" ? " and lost" : ""}${e.left ? " (they left early)" : ""}`;
    default: return null;
  }
}
// Their level at a moment (the quality bar's case 4: a first arrival, with their level then): the synced journey keeps a
// level only on its level-ups (profile.py journey_moment), so it's the last one reached by then, and only when that's
// certain: the next level-up the journey has is the very next level, or, after the last one, the profile says they're
// still that level (current). A gap (a session the add-on missed), no level-up before it, or a profile that's moved on:
// no level, never a guess (the blind check, 10/18: "arrived at level 30" where 31 was right).
export function levelAt(journey, t, current = null) {
  let before = null, after = null;
  for (const e of journey?.moments || []) {
    if (e?.k !== "lvl" || !Number.isInteger(e.lv)) continue;
    if (e.t <= t) before = e.lv;
    else if (after === null) after = e.lv;
  }
  return before !== null && (after !== null ? after === before + 1 : current === before) ? before : null;
}
// "- October 11, level 24, at Raven Hill Cemetery, Duskwood: fought and beat Lupos, a rare, for the first time". An
// arrival names its own place.
function line(e, journey, now, current = null, beaten = null) {
  const text = what(e, beaten);
  if (!text) return null;
  const place = placeOf(e);
  const where = place && e.k !== "zone" ? `, at ${place}` : "";
  // The moment's own level when it came with one (a first arrival's, from #1235's sync on), else worked out.
  const lv = e.k === "lvl" ? null : Number.isInteger(e.lv) ? e.lv : levelAt(journey, e.t, current);
  return `- ${dayOf(e.t, Number.isInteger(e.tz) ? e.tz : journey.tz, now)}${lv ? `, level ${lv}` : ""}${where}: ${text}`;
}

// The days a question asks about, as [from, to) in seconds on the player's clock (tz: minutes from UTC): today,
// yesterday (and last night), this week, last week, "three days ago", "a week ago". null when it names no time.
const NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
export function when(question, now, tz = 0) {
  const q = String(question || "").toLowerCase(), day = 86400, at = now.getTime() / 1000;
  const midnight = Math.floor((at + tz * 60) / day) * day - tz * 60;
  if (/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/.test(q)) return [midnight, at];
  if (/\b(?:yesterday|last night)\b/.test(q)) return [midnight - day, midnight + 6 * 3600];
  if (/\bthis week\b/.test(q)) return [midnight - 6 * day, at];
  if (/\blast week\b/.test(q)) return [midnight - 13 * day, midnight - 6 * day];
  const m = /\b(\d{1,2}|an?|one|two|three|four|five|six|seven) (days?|weeks?) ago\b/.exec(q);
  if (m) {
    const n = /^\d/.test(m[1]) ? Number(m[1]) : NUMBERS[m[1]];
    return m[2].startsWith("day") ? [midnight - n * day, midnight - (n - 1) * day]
      : [midnight - (7 * n + 3) * day, midnight - (7 * n - 4) * day];
  }
  return null;
}

// Kinds narrow enough to answer by alone when the question's other words name nothing ("that rare wolf": the rares).
const NARROW = new Set(["rare", "elite", "boss", "death", "mount", "lvl", "rep", "book", "shot", "dungeon", "bg"]);

// The moments that match the question, in the order they happened (recall.py search): a place it names is a must;
// then the best of: moments of the kind it asks about that it names, of a narrow kind alone, that it names whatever
// their kind, and, asked only about a place or a time, everything there or then but the quests taken up, which come
// back apart, to be counted. {best, errands}.
export function search(journey, question, about = "", now = new Date(), tz = 0) {
  const q = String(question || "").replace(/’/g, "'");
  const qWords = words(q, KIND_WORDS);
  const asked = qWords.size ? qWords : words(about, KIND_WORDS);
  const kinds = kindsOf(q);
  const number = Number(/\b(\d{1,2})\b/.exec(q)?.[1]) || null;
  const rows = (journey?.moments || []).filter(e => e && typeof e === "object" && what(e));
  const said = rows.map(e => words(names(e))), there = rows.map(e => words(placeOf(e)));
  const places = new Set([...asked].filter(a => there.some(w => [...w].some(h => match(a, h)))));
  const namesAsked = [...asked].filter(a => !places.has(a));
  const days = when(q, now, tz);
  const full = [], kindOnly = [], nameOnly = [], placeOnly = [], errands = [];
  rows.forEach((e, i) => {
    if ([...places].some(p => ![...there[i]].some(h => match(p, h)))) return;
    if (days && !(days[0] <= e.t && e.t < days[1])) return;
    let byName = namesAsked.some(a => [...said[i]].some(h => match(a, h)));
    const mine = tags(e);
    let wanted = [...kinds].some(k => mine.has(k));
    if (kinds.has("lvl") && number && e.k === "lvl") wanted = byName = e.lv === number;
    if ((wanted || !kinds.size) && (byName || !namesAsked.length)) {
      // "What did I do yesterday?": the day's story, with the quests taken up counted, not each told.
      (kinds.size || namesAsked.length ? full : e.k === "qa" ? errands : placeOnly).push(e);
    } else if (wanted) kindOnly.push(e);
    else if (byName) nameOnly.push(e);
  });
  const best = full.length ? full : (kinds.size && [...kinds].some(k => NARROW.has(k))) || !namesAsked.length
    ? (kindOnly.length ? kindOnly : nameOnly.length ? nameOnly : placeOnly) : nameOnly.length ? nameOnly : placeOnly;
  return { best, errands: best === placeOnly ? errands : [] };
}

// At most n, in the order they happened: the first ones when the question asks about a first time, else the latest
// (with the very first kept, for "since when").
function pick(events, n, question) {
  if (events.length <= n) return events;
  if (FIRST.test(question) && !LAST.test(question)) return events.slice(0, n);
  return [events[0], ...events.slice(-(n - 1))];
}

// Where this character's synced journey begins and the last day it holds: the game saves only at /reload or logout,
// and Willo on the PC sends it after that, so what happened since isn't in it yet.
function span(journey, now) {
  const ts = (journey?.moments || []).map(e => e.t).filter(Number.isFinite);
  if (!ts.length) return "";
  const tz = journey.tz || 0;
  return `Their journey begins ${dayOf(Math.min(...ts), tz, now)}. It holds what happened up to ` +
    `${dayOf(Math.max(...ts), tz, now)}; anything since the game last saved and Willo on their PC sent it isn't in it yet.`;
}

// {section, reminder} for a question about the player's own past asked without a journey of the app's own (Willo for
// iPhone), or null for any other question. saved: lib/saved-journey.js savedJourney ({journey, name, theirs});
// previous: the question before, for a follow-up that names nothing; tz: the player's clock (notebook.offset), else
// the journey's.
export function recall(question, saved, { previous = "", now = new Date(), tz = null, who = "" } = {}) {
  const q = String(question || "").replace(/’/g, "'");
  const about = words(q, KIND_WORDS).size ? "" : String(previous || "").replace(/’/g, "'");
  if (!asks(q) || PINS.test(q)) return null;
  if (onlyAhead(q) && !(saved?.journey && saved.theirs)) return null;
  const clock = Number.isInteger(tz) ? tz : saved?.journey?.tz || 0;
  if (!(words(q, KIND_WORDS).size || words(about, KIND_WORDS).size || kindsOf(q).size || when(q, now, clock))) return null;
  const name = saved?.name || who || "this character";
  const today = dayOf(Math.floor(now.getTime() / 1000), clock, now);
  if (!saved?.journey) {
    return { section: `FROM THEIR JOURNEY (Today is ${today}.)\nTheir journey hasn't reached you yet.`,
      reminder: ELSEWHERE };
  }
  const all = EVERYONE.test(q);
  if (!saved.theirs && !all) {
    return { section: `FROM THEIR JOURNEY (Today is ${today}.)\nThe journey on the phone is ${name}'s, not this ` +
      "character's.", reminder: OTHER.replaceAll("{name}", name) };
  }
  const whose = saved.theirs ? `${name}'s` : `${name}'s, another of their characters, not the one asking`;
  const head = `FROM THEIR JOURNEY (${whose}: ${NOTE} ${SEEN_HERE} Today is ${today}.)`;
  const { best, errands } = search(saved.journey, q, about, now, clock);
  const out = [head];
  const begins = span(saved.journey, now);
  if (begins) out.push(begins);
  const beaten = new Set(saved.journey.moments.filter(e => e.k === "kill" || e.k === "boss").map(e => e.n));
  const lines = pick(best, LINES, q).map(e => line(e, saved.journey, now, saved.level ?? null, beaten)).filter(Boolean);
  const everyone = !all ? "" : (saved.theirs ? ONLY : ONE_OF).replaceAll("{name}", name);
  if (!lines.length) {
    out.push("Nothing in their journey matches this question.");
    const began = /^Their journey begins ([A-Z][a-z]+ \d{1,2}(?:, \d{4})?)/.exec(begins)?.[1];
    return { section: out.join("\n"), reminder: [NOTHING.replace("{since}", began ? `, and our road began on ${began}` : ""),
      everyone].filter(Boolean).join("\n") };
  }
  const howMany = /\bhow\s+(?:many|often)\b/i.test(q);
  if (best.length > 1 || howMany) {
    // Said only when they ask how many (the blind check, 10/18: "one of the 2 moments our road kept" to a "when").
    out.push(`Matching moments in all: ${best.length}${best.length > LINES ? " (the first and the latest are below)" : ""}; ` +
      `that's only what their journey holds: ${howMany ? `say it as that ("${best.length} that our road kept"), never a flat count`
        : "tell a count only when they ask how many"}.`);
  }
  const deaths = new Map();
  for (const e of best) if (e.k === "death" && e.by) deaths.set(e.by, (deaths.get(e.by) || 0) + 1);
  if (deaths.size) {
    out.push(`Slain by: ${[...deaths].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([by, n]) => `${by} ${n} time${n === 1 ? "" : "s"}`).join(", ")}.`);
  }
  const bytes = s => new TextEncoder().encode(s).length;
  for (const l of lines) {
    if (bytes([...out, l].join("\n")) > RECALL_MAX_BYTES) break;
    out.push(l);
  }
  const also = errands.length ? `Also then: ${errands.length} quest${errands.length === 1 ? "" : "s"} taken up.` : "";
  if (also && bytes([...out, also].join("\n")) <= RECALL_MAX_BYTES) out.push(also);
  return { section: out.join("\n"), reminder: everyone };
}

// Where the section and its reminder go in the prompt, as Willo's app puts them (answer.py build): the section before
// SOURCES, the reminder right after the question (before any RESEARCH FOCUS), where a note weighs most. Unchanged when
// the prompt already has a journey of the app's own, or has no SOURCES or QUESTION.
export function withRecall(prompt, found) {
  const text = String(prompt || "");
  if (!found || /(?:^|\n)(?:FROM )?THEIR JOURNEY\b/.test(text)) return text;
  const sources = text.indexOf("\n\nSOURCES\n"), asked = text.lastIndexOf("\nQUESTION\n");
  if (sources < 0 || asked < 0 || asked < sources) return text;
  let out = `${text.slice(0, sources)}\n\n${found.section}${text.slice(sources)}`;
  if (found.reminder) {
    const focus = out.indexOf("\n\nRESEARCH FOCUS:", out.lastIndexOf("\nQUESTION\n"));
    out = focus >= 0 ? `${out.slice(0, focus)}\n${found.reminder}${out.slice(focus)}` : `${out}\n${found.reminder}`;
  }
  return out;
}

// A prompt that came with a journey of the app's own (Willo on the PC): nothing to search here.
export const hasJourney = prompt => /(?:^|\n)(?:FROM )?THEIR JOURNEY\b/.test(String(prompt || ""));
