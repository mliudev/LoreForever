// Willo's goals (LOR-665; one of Mike's top-5 second-brain picks, 10/18): a player tells her a goal ("I want my mount at
// 40", "Tailoring 225", "Exalted with Ironforge") and she says what it takes with Forever's numbers, checks progress as
// they play ("28 gold short, about three evenings") and cheers when they get there. Hero and up.
//
// A goal is a to-do line under a "Goals" heading on the character's notebook page (lib/willo-notebook.js), so it's the
// player's to read, tick, edit and erase like any other line (the Notebook tab, "What Willo keeps"). Its words are the
// goal: goalOf reads "Riding at level 40: 100 gold" back as a riding goal with its price, so a hand edit, or a price the
// player saw ("the trainer asked me 95"), changes what she counts toward.
//
// Every number is worked out here, never by the answer model (LOR-652: numbers are where she makes things up): Forever's
// prices (RIDING, the same numbers as the riding facts), what the add-on last saved of the character (stockOf: gold,
// level, skills, reputation, riding; Willo's app sends it with each answer) and their pace over their last evenings.
// Her answer gets them as THEIR GOALS (goalsBlock) and only puts them into words; a gold amount in it that the site
// didn't give her is swapped for the plan's own line (wrongGold). No extra model call: it's all worked out on the
// notebook read the answer already makes.
//
// After a save in the game (a /reload or logging out), Willo's app asks how the goals stand (goalChecks, POST
// /api/notebook/goals): a goal reached is ticked and gets one cheer, and one short check-in when something meaningful
// moved (a level, a quarter of the gold, 25 skill points, a standing); never every login, and one sentence turns them
// off (goal_checkins). She only advises: nothing here, or in her app, does anything in the game.
import { RIDING, RIDING_HONORED_OFF, ridingPeople, PROFESSION_RANKS, ARTISAN_TRAINERS } from "./forever-game-facts.js";
import { ACCOUNT_PAGE, linesOf, headingKey, cleanItem, titleOf } from "./willo-notebook.js";

export const GOALS_HEADING = "Goals";
// What THEIR GOALS may add to an answer's system prompt (lib/companion-answers.js KNOWLEDGE_MAX_BYTES counts it).
export const GOALS_MAX_BYTES = 2400;
// A save older than this is told as "as of your last save" (the quality bar's stale case).
const STALE_SECONDS = 3 * 3600;
// An evening: a day they played at least this long (shorter days don't say much about a pace).
const EVENING_SECONDS = 15 * 60;
const PACE_EVENINGS = 7, PACE_MIN = 2, EVENINGS_MAX = 365;

// The professions, as the game names them in English. secondary: their ranks past Journeyman come from books and quests,
// not a trainer.
export const PROFESSIONS = ["Alchemy", "Blacksmithing", "Enchanting", "Engineering", "Herbalism", "Leatherworking",
  "Mining", "Skinning", "Tailoring", "Cooking", "First Aid", "Fishing"];
const SECONDARY = new Set(["Cooking", "First Aid", "Fishing"]);
// A profession's ranks (lib/forever-game-facts.js PROFESSION_RANKS, the profession-ranks fact's).
const RANKS = PROFESSION_RANKS;
// Reputation standings (the game's 1..8) and how much each one holds.
export const STANDINGS = ["Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"];
const STANDING_SIZE = { 1: 36000, 2: 3000, 3: 3000, 4: 3000, 5: 6000, 6: 12000, 7: 21000, 8: 1000 };
const standingOf = name => STANDINGS.findIndex(s => s.toLowerCase() === String(name || "").toLowerCase().replace("honour", "honor")) + 1;

// Each people's home city (Honored with it takes RIDING_HONORED_OFF off riding) and riding trainer
// (lib/forever-game-facts.js RIDING_PEOPLES, the same table the riding-trainers fact says), by the add-on's race token
// and its English name (ridingPeople). The skyborne's aren't known yet.
const peopleOf = ridingPeople;

const fmt = n => Math.round(n).toLocaleString("en-US");
const num = s => Number(String(s).replace(/,/g, ""));
const EPS = 1e-9;
// "1 level", "3 levels"; "about 1 evening".
const plural = (n, word) => `${fmt(n)} ${word}${Math.round(n) === 1 ? "" : "s"}`;
// Pace figures: "9", "0.8", "1.5".
const rate = n => n >= 10 ? fmt(n) : String(Math.round(n * 10) / 10);
const ago = seconds => seconds < 2 * 3600 ? "an hour or so ago" : seconds < 36 * 3600 ? `${Math.round(seconds / 3600)} hours ago`
  : `${Math.round(seconds / 86400)} days ago`;

// ---- What the add-on saved ----

// The character as the add-on last saved it (Journey.lua char.stock and char.days; Willo's app sends them with each
// answer as `stock`), checked: {t, level, xp, xpMax, money (copper), riding (skill: 0, 75, 150), race, skills: {name:
// [rank, max]}, rep: {name: [standing 1-8, value, min, max]}, days: [{d, m0, m, l0, l, on}]}, or null. days: one per day
// played, oldest first: money and level (with the bar's fraction) at its first and last look, and seconds online.
export function stockOf(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const n = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  const word = (v, max = 48) => typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
  const stock = { t: n(raw.t, 1e9, 4e9), level: n(raw.level, 1, 80), xp: n(raw.xp, 0, 1e8), xpMax: n(raw.xpMax, 1, 1e8),
    money: n(raw.money, 0, 1e11), riding: n(raw.riding, 0, 1000), race: word(raw.race, 24), skills: null, rep: null, days: [] };
  if (raw.skills && typeof raw.skills === "object" && !Array.isArray(raw.skills)) {
    stock.skills = {};
    for (const [name, v] of Object.entries(raw.skills).slice(0, 40)) {
      const rank = n(Array.isArray(v) ? v[0] : v, 0, 1000), max = n(Array.isArray(v) ? v[1] : null, 0, 1000);
      if (word(name) && rank !== null) stock.skills[name.trim()] = [rank, max ?? rank];
    }
  }
  if (raw.rep && typeof raw.rep === "object" && !Array.isArray(raw.rep)) {
    stock.rep = {};
    for (const [name, v] of Object.entries(raw.rep).slice(0, 150)) {
      if (!word(name) || !Array.isArray(v)) continue;
      const [st, value, min, max] = [n(v[0], 1, 8), n(v[1], -50000, 50000), n(v[2], -50000, 50000), n(v[3], -50000, 50000)];
      if (st !== null) stock.rep[name.trim()] = [st, value, min, max];
    }
  }
  for (const d of Array.isArray(raw.days) ? raw.days.slice(-14) : []) {
    if (!d || typeof d !== "object") continue;
    const day = { d: word(d.d, 10), m0: n(d.m0, 0, 1e11), m: n(d.m, 0, 1e11), l0: n(d.l0, 1, 81), l: n(d.l, 1, 81), on: n(d.on, 0, 86400 * 2) };
    if (day.d && day.on !== null) stock.days.push(day);
  }
  const known = stock.level !== null || stock.money !== null || stock.skills || stock.rep;
  return known ? stock : null;
}

// Their level with the bar's fraction (36.6), from the save, or the live level when it's newer (Live game info).
function levelOf(stock, live) {
  const saved = stock?.level ?? null;
  const fraction = saved && saved < 60 && stock.xpMax ? Math.min(0.99, (stock.xp || 0) / stock.xpMax) : 0;
  if (Number.isInteger(live) && live > (saved || 0)) return live;
  return saved === null ? (Number.isInteger(live) ? live : null) : saved + fraction;
}

// Their pace from their last evenings: gold (in gold) and levels an evening, or null with fewer than PACE_MIN.
export function paceOf(stock) {
  const days = (stock?.days || []).filter(d => d.on >= EVENING_SECONDS).slice(-PACE_EVENINGS);
  if (days.length < PACE_MIN) return null;
  const avg = f => days.reduce((s, d) => s + f(d), 0) / days.length;
  const gold = days.every(d => d.m0 !== null && d.m !== null) ? avg(d => (d.m - d.m0) / 10000) : null;
  const levels = days.every(d => d.l0 !== null && d.l !== null) ? avg(d => d.l - d.l0) : null;
  return { evenings: days.length, gold, levels };
}
// About how many evenings a gap takes at a pace: a number, FAR past EVENINGS_MAX, or null when the pace doesn't
// close it (none, or their purse isn't growing).
const FAR = Infinity;
const eveningsFor = (gap, perEvening) => {
  if (!(gap > 0) || !(perEvening > EPS)) return null;
  const n = Math.max(1, Math.round(gap / perEvening));
  return n <= EVENINGS_MAX ? n : FAR;
};
// "about 3 evenings", "more than 60 evenings at this pace"; for a pace that doesn't close it, `none`.
const inEvenings = (n, none) => n === FAR ? `more than ${EVENINGS_MAX} evenings at this pace` : n ? `about ${plural(n, "evening")}` : none;
const finite = n => n && n !== FAR ? n : 0;

// ---- A goal, as a line ----

const PROF_NAMES = new Map(PROFESSIONS.map(p => [p.toLowerCase(), p]));
const PROF_RE = PROFESSIONS.map(p => p.replace(" ", "\\s+")).join("|");
const profession = s => PROF_NAMES.get(String(s || "").toLowerCase().replace(/\s+/g, " ")) || null;
const STAND_RE = "friendly|honou?red|revered|exalted";
const EPIC = /\b(?:epic|swift|fast(?:er)?|journeyman|100\s*%|level\s*60)\b/i;

// What a goal's line says it is: {kind: "riding", skill: 75 | 150, gold: a price they gave or null, at: the level they
// chose to ride at when it's later than Forever's, else null}, {kind: "level",
// level}, {kind: "gold", gold}, {kind: "skill", skill, rank}, {kind: "rep", standing: 1-8, faction}, or {kind: "other",
// text}. Reads the lines goalLine writes, and a hand edit in the same words.
export function goalOf(text) {
  const t = String(text || "").replace(/[.!]+$/, "").trim();
  let m;
  if ((m = /^(?:(journeyman|epic|swift|fast(?:er)?)\s+)?(?:riding|mount|horse)\b[^:]*(?::\s*([\d,]+)\s*(?:gold|g)\b)?/i.exec(t))) {
    const skill = m[1] || /\blevel\s*60\b/i.test(t) ? 150 : 75;
    return { kind: "riding", skill, gold: m[2] ? num(m[2]) : null, at: atLevel(t, skill) };
  }
  if ((m = /^(?:reach\s+|hit\s+)?level\s+(\d{1,2})$/i.exec(t)) && +m[1] >= 2 && +m[1] <= 60) return { kind: "level", level: +m[1] };
  if ((m = /^(?:save\s+(?:up\s+)?)?([\d,]+)\s*(?:gold|g)$/i.exec(t)) && num(m[1]) > 0) return { kind: "gold", gold: num(m[1]) };
  if ((m = new RegExp(`^(${PROF_RE})\\s+(?:to\\s+|at\\s+)?(\\d{1,3})$`, "i").exec(t)) && +m[2] > 0 && +m[2] <= 300)
    return { kind: "skill", skill: profession(m[1]), rank: +m[2] };
  if ((m = new RegExp(`^(${STAND_RE})\\s+(?:with|among|in)\\s+(?:the\\s+)?(.{2,40})$`, "i").exec(t)))
    return { kind: "rep", standing: standingOf(m[1]), faction: m[2].trim() };
  return { kind: "other", text: t };
}

// The level a riding goal is for: the one its words name ("at level 45", "by 45") when it's later than Forever's (a
// player who'd rather ride at 45; never earlier, which Forever doesn't allow), else null (Forever's own).
function atLevel(text, skill) {
  const m = /\b(?:at|by|when\s+i(?:'m|\s+am|\s+hit|\s+reach)?)\s+(?:level\s+)?(\d{1,2})\b/i.exec(String(text || ""));
  const at = m ? +m[1] : null;
  return at && at > RIDING[skill].level && at <= 60 ? at : null;
}
// The level a riding goal is counted toward: theirs, or Forever's.
const rideAt = goal => goal.at || RIDING[goal.skill].level;

// A goal's line in the notebook, the words goalOf reads back.
export function goalLine(goal) {
  if (goal.kind === "riding") {
    const R = RIDING[goal.skill];
    return `${R.name} at level ${rideAt(goal)}: ${fmt(goal.gold ?? R.gold)} gold`;
  }
  if (goal.kind === "level") return `Level ${goal.level}`;
  if (goal.kind === "gold") return `Save ${fmt(goal.gold)} gold`;
  if (goal.kind === "skill") return `${goal.skill} ${goal.rank}`;
  if (goal.kind === "rep") return `${STANDINGS[goal.standing - 1]} with ${goal.faction}`;
  return cleanItem(goal.text);
}

// Two goals about the same thing (a change replaces, never adds a second).
function sameSubject(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === "riding") return a.skill === b.skill;
  if (a.kind === "skill") return a.skill === b.skill;
  if (a.kind === "rep") return a.faction.toLowerCase() === b.faction.toLowerCase();
  if (a.kind === "other") return a.text.toLowerCase() === b.text.toLowerCase();
  return true;   // one level goal, one gold goal
}

// The goal a question asks about, from its words ("I want my mount at 40", "Tailoring to 225", "Exalted with
// Ironforge", "save 200 gold", "level 40"), so her answer can say what it takes in the same reply that keeps it; null
// when it names none. A price only when the player says one ("the trainer asked me 95").
export function askedGoal(question) {
  const q = String(question || "").replace(/’/g, "'");
  let m;
  if (/\b(?:mount|horse|riding|ride|ram|kodo|raptor|wolf|nightsaber|mechanostrider)\b/i.test(q) && !/\bfly(?:ing)?\b/i.test(q)) {
    const said = /(\d[\d,]*)\s*(?:gold|g)\b/i.exec(q) || /\b(?:asked|asks|costs?|charged?|price)\b[^.?!\d]{0,20}(\d[\d,]*)\b/i.exec(q);
    const price = said && num(said[1]) >= 5 && num(said[1]) <= 5000 ? num(said[1]) : null;
    const skill = EPIC.test(q) ? 150 : 75;
    return { kind: "riding", skill, gold: price, at: atLevel(q.replace(/(\d[\d,]*)\s*(?:gold|g)\b/gi, ""), skill) };
  }
  if ((m = new RegExp(`\\b(${PROF_RE})\\b[^.?!\\d]{0,20}?(\\d{2,3})\\b|\\b(\\d{2,3})\\s+(${PROF_RE})\\b`, "i").exec(q))) {
    const rank = +(m[2] || m[3]);
    if (rank > 0 && rank <= 300) return { kind: "skill", skill: profession(m[1] || m[4]), rank };
  }
  if ((m = new RegExp(`\\b(${STAND_RE})\\b\\s+(?:with|among|in|for)\\s+(?:the\\s+)?([A-Z][\\w'’ ]{1,38}?)(?=[.?!,]|\\s+(?:by|before|this|next|soon|please)\\b|$)`, "i").exec(q)))
    return { kind: "rep", standing: standingOf(m[1]), faction: m[2].trim() };
  if ((m = /(\d[\d,]*)\s*(?:gold|g)\b/i.exec(q)) && num(m[1]) > 0) return { kind: "gold", gold: num(m[1]) };
  if ((m = /\b(?:level|lvl|hit|reach|ding)\s+(\d{1,2})\b/i.exec(q)) && +m[1] >= 2 && +m[1] <= 60) return { kind: "level", level: +m[1] };
  // A goal said in so many words with nothing to count ("my goal is the Kirin Tor tabard", "new goal: finish the
  // Onyxia attunement"): kept in their words.
  if ((m = /\b(?:my\s+(?:next\s+|new\s+|big\s+|main\s+)?goal\s+(?:is|will\s+be)|(?:new|set\s+a)\s+goal\s*:?|goal\s*:)\s+(?:to\s+(?:get|earn|buy|finish|have|do|reach)\s+)?(?:the\s+|my\s+|a\s+|an\s+)?([^.?!]{3,60})/i.exec(q))) {
    const text = cleanItem(m[1].replace(/\s+(?:please|for me|by\s+\w+)$/i, ""), 60);
    if (text) return { kind: "other", text: text.charAt(0).toUpperCase() + text.slice(1) };
  }
  return null;
}

// ---- When she keeps one ----

const PROF_WORD = PROFESSIONS.map(p => p.toLowerCase().replace(" ", "\\s+")).join("|");
// Telling her a goal: "my goal is…", "set a goal", "I want my mount at 40", "I'm saving up for…", "help me hit 40".
// Never a question about a thing ("how much is the mount?", "I want to know about mounts").
const SET = new RegExp([
  String.raw`\bmy\s+(?:next\s+|new\s+|big\s+|main\s+)?goals?\s+(?:is|are|will\s+be)\b`,
  String.raw`\b(?:set|make|add|keep|track)\s+(?:me\s+|up\s+)?(?:a\s+|another\s+)?(?:new\s+)?goal\b`, String.raw`\bnew\s+goal\b`,
  String.raw`\bgoal\s*:`,
  String.raw`\b(?:make|keep)\s+(?:it|that|this)\s+(?:a|my)\s+goal\b`,
  String.raw`\bi(?:\s+really)?(?:\s+(?:want|wanna|would\s+like)|'d\s+(?:really\s+)?like)\s+(?:to\s+(?:get|reach|hit|be|have|make|earn|save|buy|learn|train)\s+)?(?:my\s+|a\s+|an\s+|the\s+)?(?:own\s+|first\s+)?(?:mount|horse|riding|epic\s+mount|swift\s+mount|level\s+\d|\d[\d,]*\s*(?:gold|g)\b|(?:${STAND_RE})\b|(?:${PROF_WORD})\b)`,
  String.raw`\bi(?:'m|\s+am)\s+(?:saving|aiming|working|going)\s+(?:up\s+)?(?:for|towards?|to\s+(?:get|reach|hit))\b`,
  String.raw`\bsaving\s+(?:up\s+)?(?:for\b|\d)`,
  String.raw`\bhelp\s+me\s+(?:get|reach|hit|save|ding)\b`,
  String.raw`\b(?:add|put)\b[^.?!]{0,60}\b(?:to|on|in)\s+my\s+goals\b`,
  // Told, not asked: "Get Mining to 150", "get me to level 40", "willo, take my tailoring up to 225" (never "how do I
  // get my mining to 150?").
  String.raw`(?:^|[,.!]\s*)(?:please\s+|let'?s\s+)?(?:get|raise|level|push|take|bring)\s+(?:my\s+|me\s+)?(?:(?:${PROF_WORD})|level|rep(?:utation)?)?\b[^.?!]{0,30}?\b(?:to|up\s+to)\s+(?:level\s+)?\d`,
].join("|"), "i");
const CHANGE = /\b(?:change|update|edit|switch|swap|make|set|bump|raise|lower)\b[^.?!]{0,40}\bgoals?\b|\bgoals?\b[^.?!]{0,40}\b(?:instead|to\s+\d)|\binstead\b|\b(?:costs?|asks?|asked|charges?|charged)\b[^.?!\d]{0,20}\d|\bprice\b[^.?!\d]{0,20}\d/i;
const DROP = new RegExp(String.raw`\b(?:drop|forget|cancel|remove|delete|scrap|abandon|clear|ditch|give\s+up(?:\s+on)?|never\s*mind|stop)\b[^.?!]{0,40}\bgoals?\b|\b(?:forget|drop|scrap|ditch|cancel)\s+(?:the|my|that)\s+(?:mount|riding|level|gold|${PROF_WORD})\b`, "i");
const QUIET_OFF = /\b(?:stop|quit|no\s+more|don'?t|do\s+not|enough(?:\s+of)?)\b[^.?!]{0,40}\b(?:check(?:ing)?[- ]?ins?|updates?|reminders?|reminding|telling|nagging|bugging|mention(?:ing)?)\b[^.?!]{0,40}\bgoals?\b|\bgoals?\b[^.?!]{0,30}\b(?:check[- ]?ins?|updates?)\b[^.?!]{0,20}\boff\b/i;
const QUIET_ON = /\b(?:start|resume|turn\s+on|bring\s+back|again)\b[^.?!]{0,40}\b(?:check[- ]?ins?|updates?)\b|\b(?:tell|update)\s+me\s+about\s+my\s+goals\s+again\b|\bgoal\s+check[- ]?ins?\b[^.?!]{0,20}\bon\b/i;
const READ = /\bgoals?\b|\bhow\s+(?:close|far|long|near|much\s+(?:more|longer|left))\b|\bon\s+track\b|\bprogress\b|\bhow\s+am\s+i\s+doing\b|\bam\s+i\s+(?:close|there|ready|near)\b|\bhow\s+many\s+more\b|\bshort\b/i;

// {set, change, drop, quiet: true (off) | false (on) | null, read}: what a question asks of her goals. change and drop
// only count when they have goals (have), and "instead" or a price only with one.
export function goalIntent(question, { have = false } = {}) {
  const q = String(question || "").replace(/’/g, "'");
  const quiet = QUIET_OFF.test(q) ? true : QUIET_ON.test(q) ? false : null;
  const drop = have && quiet === null && DROP.test(q);
  const change = have && !drop && quiet === null && CHANGE.test(q);
  const set = quiet === null && !drop && SET.test(q);
  return { set, change, drop, quiet, read: set || change || drop || READ.test(q) };
}
// She's offered the goals' tools.
export const writesGoals = intent => intent.set || intent.change || intent.drop || intent.quiet !== null;

// The goals on the pages her answer read (lib/willo-notebook.js notebookView: this character's page, then the
// account's): the lines under a "Goals" heading, with the numbers NOTEBOOK names them by (when it's numbered).
// [{page, raw, text, done, num, goal}].
export function goalsOf(view) {
  const out = [];
  // (Reminders are numbered there too, with no line of a page: LOR-663.)
  const numbers = new Map([...(view?.refs || new Map())].filter(([, r]) => typeof r?.raw === "string")
    .map(([n, r]) => [`${r.page}\n${r.raw.trim()}`, n]));
  for (const page of [view?.current, ACCOUNT_PAGE].filter((p, i, a) => p && a.indexOf(p) === i)) {
    let level = 0, inGoals = false;
    for (const l of linesOf(view?.pages?.[page]?.body)) {
      if (l.kind === "heading") {
        if (inGoals && l.level <= level) inGoals = false;
        if (headingKey(l.text) === "goals") [inGoals, level] = [true, l.level];
        continue;
      }
      if (!inGoals || !["todo", "bullet", "text"].includes(l.kind) || !l.text) continue;
      out.push({ page, raw: l.raw, text: l.text, done: l.kind === "todo" && l.done, num: numbers.get(`${page}\n${l.raw.trim()}`) ?? null,
        goal: goalOf(l.text) });
    }
  }
  return out;
}

// ---- How a goal stands ----

// How one goal stands for this character: {reached, facts: lines for THEIR GOALS, numbers (every number she may say),
// summary (her own short line of it), mark (what a check-in compares), checkin, cheer}. stock: stockOf; live: the live
// level, if the question carried one.
export function progressOf(goal, stock, { live = null, race = null, pace = paceOf(stock), stale = false } = {}) {
  const facts = [], numbers = new Set();
  // A save older than STALE_SECONDS: its numbers are told as of then (the quality bar's case 4).
  const old = stale ? " (as of their last save)" : "";
  const say = (...ns) => ns.forEach(n => Number.isFinite(n) && numbers.add(Math.round(n)));
  const level = levelOf(stock, live);
  const L = level === null ? null : Math.floor(level + EPS);
  const money = stock?.money ?? null;
  const have = money === null ? null : Math.floor(money / 10000 + EPS);
  const unseen = what => `you can't see their ${what} yet: say so, and that you will after their next /reload or log out ` +
    `in the game (never guess it)`;
  const paceNote = stock ? "their pace: not enough evenings saved yet; say you'll know it after a couple more evenings"
    : "their pace: nothing saved yet, so no estimate";
  if (goal.kind === "riding") {
    const R = RIDING[goal.skill];
    const people = peopleOf(stock?.race || race);
    const told = goal.gold !== null && goal.gold !== R.gold;
    const cityStanding = people && stock?.rep ? repOf(stock, people.city)?.[1]?.[0] ?? null : null;
    const honored = !told && cityStanding !== null && cityStanding >= 6;
    const price = told ? goal.gold : honored ? Math.round(R.gold * (1 - RIDING_HONORED_OFF)) : R.gold;
    const reached = stock?.riding != null && stock.riding >= goal.skill;
    say(R.level, R.gold, price, R.mounts, Math.round(R.gold * (1 - RIDING_HONORED_OFF)), goal.skill);
    // Journeyman: whether a swift mount comes with it isn't known, so the training and one from the vendor together is
    // a fair sum to say (never for the first riding, which gives the mount).
    if (goal.skill === 150) say(price + R.mounts, Math.round(R.gold * (1 - RIDING_HONORED_OFF)) + R.mounts);
    // T: the level they ride at, Forever's or a later one they chose ("I'll get it at 45 instead").
    const T = rideAt(goal);
    const dings = L === null ? null : Math.max(0, T - L);
    const short = have === null ? null : Math.max(0, Math.ceil(price - money / 10000 - EPS));
    say(L, dings, have, short, T);
    // Short of the Honored price too, a sum she may say ("only 18 short once you're Honored").
    if (have !== null && !told && !honored) say(Math.max(0, Math.ceil(R.gold * (1 - RIDING_HONORED_OFF) - money / 10000 - EPS)));
    const chose = T > R.level ? ` (riding opens at ${R.level}; they chose to ride at ${T})` : "";
    facts.push(L === null ? `Level ${T} needed${chose}: ${unseen("level")}.`
      : dings > 0 ? `Level: ${L}${old} of ${T}, ${plural(dings, "level")} to go${chose}.`
      : `Level: ${L}${old}, old enough to learn it${chose}.`);
    // The Honored price in the site's own words, with what it saves and the shortfall then: she said "saving you 18
    // gold" for a 10 gold saving (18 was the gap at that price; the blind check, 10/18).
    const off = Math.round(R.gold * RIDING_HONORED_OFF), atHonored = R.gold - off;
    const shortThen = have === null ? null : Math.max(0, Math.ceil(atHonored - money / 10000 - EPS));
    const discount = told ? " (the price they told you they saw)" : honored ? ` (with ${RIDING_HONORED_OFF * 100}% off: ` +
      `they're Honored with ${people.city})` : people ? ` (${fmt(atHonored)} once they're Honored with ${people.city}, ` +
      `${fmt(off)} less${shortThen !== null ? `, which would leave them ${fmt(shortThen)} short` : ""}` +
      `${cityStanding ? `; they're ${STANDINGS[cityStanding - 1]}` : ""})` : "";
    facts.push(`Gold: the riding trainer asks ${fmt(price)} gold${discount}. ` + (have === null ? `Their gold: ${unseen("purse")}.`
      : short > 0 ? `They have ${fmt(have)} gold${old}: ${fmt(short)} short.` : `They have ${fmt(have)} gold${old}: enough.`));
    facts.push((people ? `Where: their people's riding trainer is ${people.trainer}. ` : `Where their people learn to ride: ` +
      `you don't know yet, so say so. `) + (goal.skill === 75 ? `Learning riding gives their first mount, so there's no ` +
      `mount to buy; only if they want another, their people's vendor sells more for ${R.mounts} gold each.`
      : `Swift mounts from their people's vendor are ${R.mounts} gold; whether one comes with this training you don't ` +
      `know yet, so say so if it matters.`));
    const goldIn = short > 0 && pace?.gold != null ? eveningsFor(price - money / 10000, pace.gold) : null;
    const levelIn = dings > 0 && pace?.levels != null ? eveningsFor(T - level, pace.levels) : null;
    if (!reached && (short > 0 || dings > 0)) {
      if (!pace) facts.push(`Pace: ${paceNote}.`);
      else {
        say(pace.evenings, finite(goldIn), finite(levelIn), Math.max(finite(goldIn), finite(levelIn)), EVENINGS_MAX);
        const bits = [short > 0 ? `the gold in ${inEvenings(goldIn, "no telling: their purse hasn't been growing")}` : "",
          dings > 0 ? `level ${T} in ${inEvenings(levelIn, "no telling yet")}` : ""].filter(Boolean);
        const per = [pace.gold != null ? `${rate(pace.gold)} gold` : "", pace.levels != null ? `${rate(pace.levels)} levels` : ""]
          .filter(Boolean).join(" and ");
        facts.push(`Pace (their last ${plural(pace.evenings, "evening")}${per ? `: about ${per} an evening` : ""}): ` +
          `${bits.join(", ")}.`);
      }
    }
    const togo = [dings > 0 ? plural(dings, "level") : "", short > 0 ? `${fmt(short)} gold` : ""].filter(Boolean).join(" and ");
    const longest = goldIn === FAR || levelIn === FAR ? 0 : Math.max(finite(goldIn), finite(levelIn));
    const summary = reached ? `You can ride now. Your first mount is yours.`
      : togo ? `${R.name} is ${fmt(price)} gold at level ${T}${people ? ` from ${people.trainer.split(" at ")[0].split(" in ")[0]}` : ""}` +
        `${goal.skill === 75 ? ", and it gives you your first mount" : ` (a swift mount from your people's vendor is ` +
          `${fmt(R.mounts)} more, if one doesn't come with it)`}: ${togo} to go` +
        `${longest ? `, about ${plural(longest, "evening")} at your pace` : ""}.`
      : L !== null && have !== null ? `You're ready: ${R.name.toLowerCase()} from your trainer for ${fmt(price)} gold.` : "";
    return { reached, facts, numbers, summary,
      togo: reached ? "" : togo ? `${togo} to go` : L !== null && have !== null ? "ready now" : "",
      mark: `${L ?? "?"}|${have === null ? "?" : Math.min(4, Math.floor((money / 10000) / price * 4 + EPS))}`,
      // Old enough with the gold, not trained yet: ready, and where (the quality bar's case 5).
      checkin: reached || L === null || have === null ? "" : !togo ? `You're ready to ride: ` +
        (people ? `${people.trainer} teaches it for ${fmt(price)} gold.` : `your people's riding trainer asks ${fmt(price)} gold.`)
        : dings > 0 ? `Level ${L}: ${togo} to go for your riding.`
        : `${fmt(have)} of ${fmt(price)} gold: ${fmt(short)} more and you can ride.`,
      cheer: goal.skill === 75 ? `${L !== null ? `Level ${L} and riding` : "Riding"} at last! Your first mount is yours.`
        : `${R.name}! The roads of Azeroth just got a lot shorter.` };
  }
  if (goal.kind === "level") {
    const reached = L !== null && L >= goal.level;
    const dings = L === null ? null : Math.max(0, goal.level - L);
    say(goal.level, L, dings);
    if (L === null) facts.push(`Level ${goal.level}: ${unseen("level")}.`);
    else if (!reached) facts.push(`Level: ${L}${old} of ${goal.level}, ${plural(dings, "level")} to go.`);
    const levelIn = !reached && pace?.levels != null ? eveningsFor(goal.level - level, pace.levels) : null;
    if (!reached && L !== null) {
      if (!pace) facts.push(`Pace: ${paceNote}.`);
      else {
        say(pace.evenings, finite(levelIn), EVENINGS_MAX);
        facts.push(`Pace (their last ${plural(pace.evenings, "evening")}: about ${rate(pace.levels ?? 0)} levels an ` +
          `evening): level ${goal.level} in ${inEvenings(levelIn, "no telling yet")}.`);
      }
    }
    return { reached, facts, numbers,
      summary: reached ? `Level ${goal.level}: done!` : L === null ? "" : `${plural(dings, "level")} to level ${goal.level}` +
        `${finite(levelIn) ? `: about ${plural(levelIn, "evening")} at your pace` : ""}.`,
      togo: reached || L === null ? "" : `${plural(dings, "level")} to go`,
      mark: `${L ?? "?"}`, checkin: reached || L === null ? "" : `Level ${L}: ${plural(dings, "level")} more to ${goal.level}.`,
      cheer: `Level ${goal.level}! You made it.` };
  }
  if (goal.kind === "gold") {
    const reached = money !== null && money / 10000 >= goal.gold - EPS;
    const short = money === null ? null : Math.max(0, Math.ceil(goal.gold - money / 10000 - EPS));
    say(goal.gold, have, short);
    facts.push(have === null ? `Gold: ${unseen("purse")}.` : reached ? `Gold: ${fmt(have)}${old}, they've saved it.`
      : `Gold: ${fmt(have)}${old} of ${fmt(goal.gold)}, ${fmt(short)} to go.`);
    const goldIn = short > 0 && pace?.gold != null ? eveningsFor(goal.gold - money / 10000, pace.gold) : null;
    if (short > 0) {
      if (!pace) facts.push(`Pace: ${paceNote}.`);
      else {
        say(pace.evenings, finite(goldIn), EVENINGS_MAX);
        facts.push(`Pace (their last ${plural(pace.evenings, "evening")}: about ${rate(pace.gold ?? 0)} gold an ` +
          `evening): ${inEvenings(goldIn, "no telling: their purse hasn't been growing")} to go.`);
      }
    }
    return { reached, facts, numbers,
      summary: reached ? `${fmt(goal.gold)} gold saved!` : have === null ? "" : `${fmt(have)} of ${fmt(goal.gold)} gold: ` +
        `${fmt(short)} to go${finite(goldIn) ? `, about ${plural(goldIn, "evening")} at your pace` : ""}.`,
      togo: reached || have === null ? "" : `${fmt(short)} to go`,
      mark: have === null ? "?" : `${Math.min(4, Math.floor(money / 10000 / goal.gold * 4 + EPS))}`,
      checkin: reached || have === null ? "" : `${fmt(have)} of ${fmt(goal.gold)} gold saved.`,
      cheer: `${fmt(goal.gold)} gold saved. Well done!` };
  }
  if (goal.kind === "skill") {
    const s = stock?.skills ? Object.entries(stock.skills).find(([n]) => n.toLowerCase() === goal.skill.toLowerCase())?.[1] : null;
    const [rank, max] = s || [null, null];
    const reached = rank !== null && rank >= goal.rank;
    say(goal.rank, rank, max, rank === null ? null : goal.rank - rank);
    if (!stock?.skills) facts.push(`${goal.skill}: ${unseen("skills")}.`);
    else if (rank === null) facts.push(`${goal.skill}: not among the skills in their last save. Say you don't see it ` +
      `yet; if they haven't learned it, a ${goal.skill.toLowerCase()} trainer teaches it.`);
    else if (!reached) {
      facts.push(`${goal.skill}: their skill is ${rank} (their rank stops at ${max}); ${goal.rank - rank} points to go.`);
      // Every rank between what their training allows and the goal, each with the skill and level it's taught from
      // (the profession-ranks fact's), and who teaches Artisan on their side: told only the next one, she guessed the
      // rest ("Artisan at 225", the blind check, 10/18).
      const side = peopleOf(stock?.race || race)?.side;
      // A rank is needed when the one before it stops short of the goal (Expert's 225 is enough for "Tailoring 225").
      for (const r of RANKS.filter((r, i) => i > 0 && r.cap > max && RANKS[i - 1].cap < goal.rank)) {
        say(r.from, r.level, r.cap);
        if (SECONDARY.has(goal.skill) && r.cap > 150) {
          facts.push(`${r.name} ${goal.skill} (up to ${r.cap}) comes from ${r.cap === 225 ? "a book" : "a quest"}, ` +
            `not a trainer; which one here you're not sure, so say so if they ask.`);
          continue;
        }
        const now = rank >= r.from && (L === null || L >= r.level);
        const who = r.name === "Artisan" && ARTISAN_TRAINERS[goal.skill]?.[side]
          ? ` Their side's Artisan ${goal.skill.toLowerCase()} trainer is ${ARTISAN_TRAINERS[goal.skill][side]}.` : "";
        // Not yet: what's missing, in so many words ("you can train Expert now" at skill 120, the blind check, 10/18).
        const missing = [rank < r.from ? `${r.from - rank} more skill point${r.from - rank === 1 ? "" : "s"} (they're at ` +
          `${rank})` : "", L !== null && L < r.level ? `level ${r.level} (they're ${L})` : ""].filter(Boolean);
        say(...(rank < r.from ? [r.from - rank] : []));
        facts.push(`${r.name} (up to ${r.cap}): taught from skill ${r.from} at level ${r.level}` +
          (now ? `; they already qualify, so a ${goal.skill.toLowerCase()} trainer can teach it now.`
            : missing.length ? `; not yet: they need ${missing.join(" and ")} first.` : ".") + who);
      }
      // The rank they have is no step at all: "first train Journeyman once you hit 150" (the blind check, 10/18).
      const have = RANKS.find(r => r.cap === max);
      if (have && have.from > 0) facts.push(`They already have ${have.name}: don't bring it up as a step.`);
      // Ranks past the goal are noise that drifts ("after 225, Artisan from …" with a made-up trainer, live 10/18).
      if (goal.rank < 300) facts.push(`Their goal stops at ${goal.rank}: leave ranks past it out unless they ask.`);
    }
    return { reached, facts, numbers,
      summary: reached ? `${goal.skill} ${goal.rank}: done!` : rank === null ? "" : `${goal.skill} ${rank}: ` +
        `${goal.rank - rank} to go.`,
      togo: reached || rank === null ? "" : `at ${rank}, ${goal.rank - rank} to go`,
      mark: rank === null ? "?" : `${Math.floor(rank / 25)}|${max}`,
      checkin: reached || rank === null ? "" : `${goal.skill} ${rank}: ${goal.rank - rank} to go` +
        (max <= rank && max < goal.rank ? `. Time to train the next rank.` : "."),
      cheer: `${goal.skill} ${goal.rank}! Nicely done.` };
  }
  if (goal.kind === "rep") {
    const found = stock?.rep ? repOf(stock, goal.faction) : null;
    const T = goal.standing, target = STANDINGS[T - 1];
    if (!stock?.rep) {
      facts.push(`${goal.faction}: ${unseen("standing")}.`);
      return { reached: false, facts, numbers, summary: "", mark: "?", checkin: "", cheer: "" };
    }
    if (!found) {
      facts.push(`${goal.faction}: not among the reputations in their last save; say you don't see it yet.`);
      return { reached: false, facts, numbers, summary: "", mark: "?", checkin: "", cheer: "" };
    }
    const [name, [st, value, min, max]] = found;
    const reached = st >= T;
    let left = null;
    if (!reached && value !== null && min !== null && max !== null) {
      left = Math.max(0, max - value);
      for (let k = st + 1; k < T; k++) left += STANDING_SIZE[k];
      say(value - min, max - min, max - value, left, ...Array.from({ length: T - st - 1 }, (_, i) => STANDING_SIZE[st + 1 + i]));
    }
    facts.push(reached ? `${name}: ${STANDINGS[st - 1]}, so they're there.` : `${name}: ${STANDINGS[st - 1]}` +
      (left === null ? `; ${target} is ${T - st} standing${T - st === 1 ? "" : "s"} up.` : `, ${fmt(value - min)} of ` +
      `${fmt(max - min)}; ${fmt(max - value)} to ${STANDINGS[st]}` + (T > st + 1 ? `, then ` + Array.from({ length: T - st - 1 },
        (_, i) => `${fmt(STANDING_SIZE[st + 1 + i])} to ${STANDINGS[st + 1 + i]}`).join(", ") : "") + `: ${fmt(left)} in all.`) +
      (reached ? "" : " What moves it you may say in general (their quests and deeds), never how much each gives."));
    return { reached, facts, numbers,
      summary: reached ? `${target} with ${name}: done!` : left === null ? "" : `${fmt(left)} reputation to ${target} with ${name}.`,
      togo: reached ? "" : `${STANDINGS[st - 1]} now${left !== null ? `, ${fmt(left)} to go` : ""}`,
      mark: `${st}`, checkin: reached ? "" : `${STANDINGS[st - 1]} with ${name} now${left !== null ? `: ${fmt(left)} to ${target}` : ""}.`,
      cheer: `${target} with ${name}! Well earned.` };
  }
  facts.push("No numbers you can count for it. Help with the next step only when they ask (only the next one, and no " +
    "twists ahead); say plainly when you don't know a price or a step, and offer to look it up.");
  return { reached: false, facts, numbers, summary: "", mark: "", checkin: "", cheer: "" };
}
// Their reputation with a faction, by its name as they say it ("ironforge", "the Darkspear"): [name, [st, value, min, max]].
function repOf(stock, faction) {
  const want = String(faction || "").toLowerCase().replace(/^the\s+/, "").trim();
  const all = Object.entries(stock?.rep || {});
  return all.find(([n]) => n.toLowerCase() === want) || all.find(([n]) => n.toLowerCase().startsWith(want))
    || all.find(([n]) => want.length >= 4 && n.toLowerCase().includes(want)) || null;
}

// ---- What her answer reads ----

// The words that tie a question to a goal: "mount" to riding, "Ironforge" to an Ironforge goal.
const KIND_WORDS = { riding: /\b(?:mount|horse|riding|ride|trainer)\b/i, level: /\blevel|\bding\b|\bxp\b/i,
  gold: /\bgold\b|\bpurse\b|\bmoney\b|\bsaving\b/i };
const touches = (g, q) => KIND_WORDS[g.goal.kind]?.test(q) || (g.goal.kind === "riding" && /\bgold\b/i.test(q))
  || (g.goal.kind === "skill" && new RegExp(`\\b${g.goal.skill}\\b`, "i").test(q))
  || (g.goal.kind === "rep" && new RegExp(`\\b${g.goal.faction.split(/\s+/)[0].replace(/[^\w']/g, "")}\\b`, "i").test(q));

// THEIR GOALS for an answer: {block, reached: the open goals the save shows reached, asked: the goal the question names
// (setting one), numbers: every number she may say about them}. goals: goalsOf; intent: goalIntent; asked: askedGoal
// (when they're setting one); now: for how old the save is. Empty when nothing bears on the question.
export function goalsBlock(goals, stock, { intent, question = "", asked = null, live = null, race = null,
  now = new Date() } = {}) {
  const numbers = new Set();
  const pace = paceOf(stock);
  const open = goals.filter(g => !g.done);
  const old = stock?.t ? Math.floor(now.getTime() / 1000) - stock.t : null;
  const stale = old !== null && old > STALE_SECONDS;
  const states = open.map(g => ({ g, p: progressOf(g.goal, stock, { live, race, pace, stale }) }));
  const reached = states.filter(s => s.p.reached).map(s => s.g);
  // The goals the question names ("my mount"), or all of them for one about their goals ("what are my goals?").
  const named = states.filter(s => touches(s.g, question));
  const bears = intent.read || writesGoals(intent);
  const shown = states.filter(s => s.p.reached || named.includes(s) || (bears && !named.length));
  // The goal they're asking for: a new one, or one they're changing ("I'll get it at level 45 instead"), told as they
  // want it now in place of the old one's numbers.
  const was = asked ? open.find(g => sameSubject(g.goal, asked)) : null;
  const changing = Boolean(was) && goalLine(asked) !== was.text;
  const fresh = asked && (!was || changing) ? progressOf(asked, stock, { live, race, pace, stale }) : null;
  if (!shown.length && !fresh && !(intent.read && goals.length)) return { block: "", reached, asked: fresh ? asked : null,
    numbers, cheer: "", stale };
  const head = "THEIR GOALS (kept in their notebook; worked out for you from Forever's prices and what their add-on " +
    "last saved" + (stale ? `, ${ago(old)}: say "as of your last save", for their level too` : "") + ". Use these " +
    "numbers exactly: never your own sums or prices you remember, no prices for what they could sell, and no places " +
    "or steps it doesn't name. " + (bears && !named.length && intent.read && !writesGoals(intent)
      ? "They asked about their goals: name every one below, one short line each.)"
      : "Bring up only the goals the question bears on.)");
  // One section a goal; whole ones that fit, the goal they're setting and the ones reached first.
  const section = (title, p) => ({ lines: [title, ...p.facts.map(f => `   - ${f}`)], p });
  const sections = [];
  if (fresh) sections.push(section(changing ? `THE GOAL AS THEY'RE CHANGING IT (in place of "${was.text}"; goal_set ` +
    `keeps the change): ${goalLine(asked)}` : `THE GOAL THEY'RE ASKING FOR (not kept yet: keep it with goal_set if they ` +
    `want it kept): ${goalLine(asked)}`, fresh));
  // A goal reached is cheered by the site itself, before her answer (cheers), and never shown as still to do.
  if (reached.length) sections.push({ lines: ["Just reached, by their last save (already cheered before your answer; " +
    "don't repeat it): " + reached.map(g => g.text).join("; ") + "."] });
  if (!open.length && intent.read && goals.length) sections.push({ lines: ["All their goals are done: " +
    goals.map(g => g.text).join("; ") + "."] });
  for (const { g, p } of shown) if (!p.reached && !(changing && g === was)) sections.push(section(`${g.num ? `${g.num}. ` : "- "}[ ] ${g.text}`, p));
  const bytes = t => new TextEncoder().encode(t).length;
  const kept = [head];
  for (const sec of sections) {
    const next = [...kept, ...sec.lines].join("\n");
    if (bytes(next) > GOALS_MAX_BYTES) continue;
    kept.push(...sec.lines);
    sec.p?.numbers.forEach(n => numbers.add(n));
  }
  const block = kept.length > 1 ? kept.join("\n") : "";
  const cheers = cheersOf(states.filter(s => s.p.reached));
  return { block, reached, asked: fresh ? asked : null, numbers, cheer: cheers, stale };
}

// A spoken answer about their goals from a save older than STALE_SECONDS that gives numbers as now: "As of your last
// save, ..." (LOR-673; the vision session's goalcheck, 10/18: out loud, 5 of 6 answers gave a 3-day-old save's gold and
// levels as current, though THEIR GOALS told her to say so; written and typed ones did). Anything that already says when,
// or gives no number, is as it was.
const LAST_SAVE = /\b(?:last|latest) save\b|\blast saved\b|\bwhen you (?:last )?saved\b/i;
const SAYS_NUMBER = /\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/i;
const LOWER_FIRST = /^(?:You|Your|You're|You've|You'll|It|It's|That|That's|There|There's|The|At|With|Right|Just)\b/;
export function asOfSave(text) {
  const t = String(text || "").trim();
  if (!t || LAST_SAVE.test(t) || !SAYS_NUMBER.test(t)) return text;
  return `As of your last save, ${LOWER_FIRST.test(t) ? t[0].toLowerCase() + t.slice(1) : t}`;
}

// The cheers for goals reached together, once each: a level goal reached with the riding at that level is the
// riding's cheer ("Level 40 and riding at last!"), not two.
function cheersOf(done) {
  const riding = done.filter(s => s.g.goal.kind === "riding").map(s => RIDING[s.g.goal.skill].level);
  return done.filter(s => !(s.g.goal.kind === "level" && riding.includes(s.g.goal.level))).map(s => s.p.cheer)
    .filter(Boolean).join(" ");
}

// ---- Her tools ----

export const GOAL_TOOLS = ["goal_set", "goal_checkins"];
export const isGoalTool = name => GOAL_TOOLS.includes(name);
// What her answer is told when it's offered the goals' tools (lib/companion-answers.js systemPrompt), like the
// notebook's NOTEBOOK_RULES: these are done the moment she calls one.
export const GOAL_RULES = "THEIR GOALS: they've told you a goal they want, or want one changed or dropped. Keep a goal " +
  "they say they want with goal_set (change one with goal_set and replaces: its NOTEBOOK number; drop one with " +
  "notebook_remove). Never keep a goal they only ask about, never one that doesn't exist in this age (no flying " +
  "mounts), and never give goal_set a price they didn't say themselves. Then in two or three short lines say what it " +
  "takes and where they stand, with only the numbers in THEIR GOALS, never your own. A price or step it doesn't " +
  "have: say plainly you don't know it yet, and offer to look it up. You advise only: you never buy, sell, train or " +
  "do anything in the game for them.";
// Nothing here ever suggests a goal (the quality bar's case 21, from players who want none): the goals' tools, rules
// and THEIR GOALS come only with a goal the player set or a question about one.

// The goals' tools for an answer whose question sets, changes or drops a goal, or turns her check-ins off or on
// (goalIntent), as provider-neutral declarations like lib/willo-notebook.js notebookTools'. notebookTools: that view's
// own (for notebook_remove, to drop one).
export function goalTools(intent, { goals = [], noteTools = [] } = {}) {
  const out = [];
  if (intent.set || intent.change) out.push({ name: "goal_set",
    description: "Keep a goal they say they want under Goals in their notebook, or change one (replaces).",
    parameters: { type: "object", properties: {
      what: { type: "string", enum: ["riding", "journeyman_riding", "level", "gold", "profession", "reputation", "other"],
        description: "riding: first mount (level 40); journeyman_riding: the faster one (60)." },
      level: { type: "integer" },
      gold: { type: "integer", description: "gold to save; for riding only a price they said." },
      profession: { type: "string", enum: PROFESSIONS },
      skill: { type: "integer" },
      faction: { type: "string" },
      standing: { type: "string", enum: STANDINGS.slice(4) },
      text: { type: "string", description: "other: a few of their words." },
      ...(goals.some(g => g.num) ? { replaces: { type: "integer", description: "NOTEBOOK number of the goal it changes." } }
        : {}),
    }, required: ["what"] } });
  if (intent.drop || intent.change) out.push(...noteTools.filter(t => t.name === "notebook_remove"));
  if (intent.quiet !== null) out.push({ name: "goal_checkins",
    description: "Your short goal check-ins after they play: off or back on, as they ask.",
    parameters: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"] } });
  return out;
}

// A goal from goal_set's arguments, checked: null for one that makes no sense. question: a riding price counts only
// when the player said that number.
function goalFrom(args, question) {
  const a = args && typeof args === "object" ? args : {};
  const int = (v, lo, hi) => Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null;
  const what = String(a.what || "");
  if (what === "riding" || what === "journeyman_riding") {
    const gold = int(a.gold, 1, 100000);
    const said = gold !== null && new RegExp(`(?<![\\d,])${gold.toLocaleString("en-US").replace(",", ",?")}(?![\\d,])`).test(String(question || ""));
    const skill = what === "riding" ? 75 : 150, level = int(a.level, 1, 60);
    return { kind: "riding", skill, gold: said ? gold : null,
      at: level && level > RIDING[skill].level ? level : null };
  }
  if (what === "level") { const level = int(a.level, 2, 60); return level ? { kind: "level", level } : null; }
  if (what === "gold") { const gold = int(a.gold, 1, 1000000); return gold ? { kind: "gold", gold } : null; }
  if (what === "profession") {
    const skill = profession(a.profession), rank = int(a.skill, 1, 300);
    return skill && rank ? { kind: "skill", skill, rank } : null;
  }
  if (what === "reputation") {
    const standing = standingOf(a.standing), faction = cleanItem(a.faction, 40).replace(/^the\s+/i, "");
    return standing >= 5 && faction ? { kind: "rep", standing, faction } : null;
  }
  if (what === "other") { const text = cleanItem(a.text, 80); return text ? { kind: "other", text } : null; }
  return null;
}

// The change a goal tool's call asks for, checked against what was offered: {page, op, goal} for the notebook (lib/
// willo-notebook.js applyOp's op: add under Goals, or update the goal it changes), {same: true} when it's kept already,
// {checkins: bool}, or null. view: the notebook her answer read; goals: goalsOf(view); stock: for the faction's name as
// the game spells it. asked: the goal the player's own words name (askedGoal), which is the one kept whatever the call's
// arguments say: Flash-Lite called goal_set for "I want my Tailoring at 225" with skill 120 (their skill now) and for
// "I'm saving up 200 gold" with no gold at all, then said "I've added it" (10/18). The site decides by the words, as the
// notebook's does.
// change: the question changes a goal (goalIntent change). Only then does the call's `replaces` count, and only for a
// goal of the same kind: live (10/18) Flash-Lite passed replaces 1 for "I want my Tailoring at 225" and the riding goal
// on line 1 became Tailoring. Otherwise a goal replaces only one about the same thing (sameSubject).
export function goalCall(call, offered, view, goals, { question = "", stock = null, asked = null, change = false } = {}) {
  if (!call || !isGoalTool(call.name) || !(offered || []).some(t => t.name === call.name)) return null;
  if (call.name === "goal_checkins") return { checkins: call.args?.on !== false };
  const goal = asked ? { ...asked } : goalFrom(call.args, question);
  if (!goal) return null;
  if (goal.kind === "rep" && stock?.rep) goal.faction = repOf(stock, goal.faction)?.[0] || goal.faction;
  const text = goalLine(goal);
  const named = change && Number.isInteger(call.args?.replaces)
    ? goals.find(g => g.num === call.args.replaces && !g.done && g.goal.kind === goal.kind) : null;
  const same = named || goals.find(g => !g.done && sameSubject(g.goal, goal));
  if (same) return same.text === text ? { same: true, goal } : { page: same.page, op: { op: "update", target: { raw: same.raw }, text }, goal };
  return { page: view?.current || ACCOUNT_PAGE, op: { op: "add", kind: "todo", items: [text], heading: GOALS_HEADING }, goal };
}
// The free plan while plans are sold (typed only: out loud she never names a plan): she says what it takes, and that she
// keeps goals from Hero up, in one plain line.
export const GOALS_ON_HERO = "GOALS: they'd like you to keep a goal for them. Keeping goals and checking how they're " +
  "going comes with Hero, so you can't keep this one for them: say what it takes from what you know, then end with " +
  "one plain line that you can keep their goals and check their progress once they have the Hero plan. Never claim " +
  "you've kept it, or that you're keeping track.";
// A goal in words, as she says it: "riding at level 40 for 100 gold", "Tailoring 225".
function goalSaid(goal) {
  if (goal.kind === "riding") {
    const R = RIDING[goal.skill];
    return `${R.name.toLowerCase()} at level ${rideAt(goal)} for ${fmt(goal.gold ?? R.gold)} gold`;
  }
  if (goal.kind === "gold") return `saving ${fmt(goal.gold)} gold`;
  return goal.kind === "level" ? `level ${goal.level}` : goalLine(goal);
}
export const keptLine = goal => `Goal kept: ${goalSaid(goal)}.`;
// Her sentences that claim she kept, noted or saved something: the site's own line says what was written instead.
const CLAIMS = /\bI(?:'ve|’ve| have|'ll|’ll| will)?\s+(?:already\s+)?(?:kept|keep|noted|note|added|add|written|write|saved|save|set|put|tracked|track|recorded|record|updated|update|changed|change|removed|remove|dropped|drop|deleted|delete|taken)\b/i;
// A sentence that's only a confirmation ("Dropped.", "Done!", "Noted: your goal is updated to level 45."), which the
// site's line says instead (her own after it repeated it, the blind check, 10/18).
const BARE = /^\s*(?:dropped|done|kept|noted|changed|removed|got it|all set|okay|ok)\s*[.!]*\s*$|^\s*(?:noted|updated|changed|done|kept|saved|got it|all set)\s*[:!,-][^.!?]{0,120}\bgoals?\b|\byour\s+(?:\w+\s+)?goal\s+is\s+(?:now|updated|set|changed)\b/i;
// What she says for a goal kept (op add), changed (op update), dropped (op remove: goal is the first one taken off,
// dropped all of them) or already kept (op null): the site's line from what it wrote, then her own sentences about what
// it takes and where they stand (as lib/willo-notebook.js confirmed does for a note; the model's "I've added it" never
// stands in for the save).
export function goalConfirmed(answer, goal, op, dropped = [goal]) {
  const line = !op ? `That's already one of your goals: ${goalSaid(goal)}.` : op.op === "update"
    ? `Goal changed: ${goalSaid(goal)}.` : op.op === "remove" ? `Goal dropped: ${dropped.map(goalSaid).join(", ")}.`
    : keptLine(goal);
  const rest = (String(answer || "").match(/[^.!?]+[.!?]*\s*/g) || []).filter(t => !CLAIMS.test(t) && !BARE.test(t)
    && !GOAL_CLAIM.test(t)).join("").trim();
  return rest ? `${line} ${rest}` : line;
}
export const QUIET_LINES = { true: "I'll keep quiet about your goals until you ask.", false: "I'll tell you how your goals are going again." };

// Her answer without its sentences that claim she kept, changed or saved something, for when nothing was written
// (a goal_set whose arguments made no sense): never "I've added it" for nothing. Empty: her line asking what they're
// aiming for.
export const ASK_GOAL_LINE = "Tell me what you're aiming for, with its number (a level, the gold, a skill or a standing), and I'll keep it.";
export function withoutClaims(answer) {
  const rest = (String(answer || "").match(/[^.!?]+[.!?]*\s*/g) || []).filter(t => !CLAIMS.test(t) && !BARE.test(t)
    && !GOAL_CLAIM.test(t) && !/\b(?:added|kept|updated|changed|noted|saved)\b[^.!?]{0,40}\b(?:goals?|notebook|list)\b/i
      .test(t)).join("").trim();
  return rest || ASK_GOAL_LINE;
}

// ---- Goals named, and listed, by the site ----

// The open goals a question names by what they're about, for dropping one: "forget the mount goal" when the line reads
// "Riding at level 40" (the notebook's word match can't know mount means riding: the blind check, case 7). Mount,
// horse, ride and steed are riding (epic, swift and journeyman the faster one); a profession by its name; a reputation
// by its faction, or "rep" when there's one; a level, gold or saving; any other goal by a word they share.
const RIDE_WORDS = /\b(?:mount|horse|ride|riding|steed)\b/i;
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function goalsNamed(question, goals) {
  const q = String(question || "").replace(/’/g, "'");
  const open = goals.filter(g => !g.done);
  const reps = open.filter(g => g.goal.kind === "rep").length;
  let hit = open.filter(({ goal: k, text }) => {
    if (k.kind === "riding") return RIDE_WORDS.test(q) && (!EPIC.test(q) || k.skill === 150);
    if (k.kind === "level") return /\blevel(?:ing)?\b|\bding\b/i.test(q) && !RIDE_WORDS.test(q);
    if (k.kind === "gold") return /\b(?:gold|sav(?:e|ing|ings)|money)\b/i.test(q) && !RIDE_WORDS.test(q);
    if (k.kind === "skill") return new RegExp(`\\b${esc(k.skill).replace(" ", "\\s+")}\\b`, "i").test(q);
    if (k.kind === "rep") return new RegExp(`\\b${esc(k.faction.split(/\s+/)[0])}\\b`, "i").test(q)
      || (reps === 1 && /\b(?:rep|reputation|standing)\b/i.test(q));
    const theirs = new Set((text.toLowerCase().match(/\p{L}{4,}/gu) || []).filter(w => w !== "goal"));
    return (q.toLowerCase().match(/\p{L}{4,}/gu) || []).some(w => theirs.has(w));
  });
  // "The mount goal" with both ridings kept: the first one, unless they said the faster.
  if (!EPIC.test(q) && hit.some(g => g.goal.kind === "riding" && g.goal.skill === 75))
    hit = hit.filter(g => !(g.goal.kind === "riding" && g.goal.skill === 150));
  return hit;
}
export const whichLine = named => `Which one: ${named.slice(0, -1).map(g => goalSaid(g.goal)).join(", ")} or ` +
  `${goalSaid(named[named.length - 1].goal)}?`;

// "What are my goals?": answered by the site from this character's Goals and the account's, never from the chat (the
// blind check, case 11: Brynn, after Húrin set his goal in the same chat, heard Húrin's goal as hers).
export const GOAL_LIST = /\bwhat(?:'s|\s+is|\s+are|\s+were)\s+(?:all\s+)?(?:of\s+)?(?:my|our)\s+(?:current\s+|open\s+)?goals?\b|\b(?:list|show|read|tell)\s+(?:me\s+)?(?:all\s+)?(?:of\s+)?my\s+goals\b|\bwhat\s+goals\s+(?:do|have)\s+(?:i|we)\b|\bdo\s+i\s+have\s+(?:any\s+)?goals\b|^\s*(?:my\s+)?goals\s*\??\s*$/i;
// One goal in a line of the list: what it is and how far to go.
function listLine(goal, p) {
  const said = goalSaid(goal);
  const to = p.togo;
  return to ? `${said}: ${to}` : said;
}
export function goalsList(goals, stock, { current = null, live = null, race = null, now = new Date() } = {}) {
  const name = current ? titleOf(current) : "";
  const pace = paceOf(stock);
  const stale = stock?.t ? Math.floor(now.getTime() / 1000) - stock.t > STALE_SECONDS : false;
  const open = goals.filter(g => !g.done);
  const of = page => open.filter(g => g.page === page).map(g => listLine(g.goal, progressOf(g.goal, stock, { live, race, pace })));
  const mine = current ? of(current) : [], all = of(ACCOUNT_PAGE);
  if (!mine.length && !all.length) {
    const done = goals.filter(g => g.done).map(g => goalSaid(g.goal));
    return done.length ? `Every goal ${name ? `${name} set` : "you set"} is done: ${done.join(", ")}.`
      : `${name || "You"} ${name ? "has" : "have"} no goals yet.`;
  }
  const parts = [];
  if (mine.length) parts.push(`${name ? `${name}'s` : "Your"} goals: ${mine.join("; ")}.`);
  if (all.length) parts.push(`For all your characters: ${all.join("; ")}.`);
  if (stale && (mine.length || all.length)) parts.push("That's as of your last save.");
  return parts.join(" ");
}

// Her sentences that say a goal was kept, changed or dropped ("Goal updated: riding at level 45", the blind check, case
// 6; "That goal's gone: riding at level 40." after the site's "Goal dropped: ..." line, LOR-686), for an answer where
// nothing was written: only the site's own line may say so.
const GOAL_CLAIM = /\bgoal(?:'s|’s|\s+is|\s+has\s+been)\s+(?:now\s+)?(?:gone|removed|dropped|deleted|cleared|taken\s+off)\b|\bno\s+longer\s+(?:one\s+of\s+)?your\s+goals?\b|^\s*(?:your\s+)?goals?\s+(?:kept|changed|updated|dropped|set|added|saved|removed|noted)\b|\b(?:that|it|this)(?:'s|\s+is)\s+already\s+(?:one\s+of\s+)?(?:your|a)\s+goals?\b|\bgoals?\s+(?:has|have)\s+been\s+(?:kept|changed|updated|dropped|set|added|saved|removed)\b|\b(?:updated|changed|set|saved|added|kept)\s+(?:your|the|that|this)\s+(?:\w+\s+)?goals?\b/i;
export function withoutGoalClaims(answer, fallback = "") {
  const sentences = String(answer || "").match(/[^.!?]+[.!?]*\s*/g) || [];
  const kept = sentences.filter(t => !GOAL_CLAIM.test(t) && !(CLAIMS.test(t) && /\bgoals?\b/i.test(t))).join("").trim();
  return kept || fallback || ASK_GOAL_LINE;
}

// ---- The wrong-number guard ----

// Every number a text holds ("1,000" as 1000), for what her answer may say: what the site gave her and what they asked.
export function numbersIn(...texts) {
  const out = new Set();
  for (const t of texts) for (const m of String(t || "").matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(Math.round(num(m[0])));
  return out;
}
// A gold amount in her answer that nothing she was given holds ("80 gold" remembered from the original game): true.
export function wrongGold(answer, allowed) {
  return [...String(answer || "").matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:gold|g)\b/gi)].some(m => !allowed.has(Math.round(num(m[1]))));
}
// Her plan's own words in place of an answer with a wrong number: the goal the question names, or the first one it bears on.
export function planLine(goals, stock, { asked = null, question = "", live = null, race = null } = {}) {
  const pace = paceOf(stock);
  const pick = asked || goals.find(g => !g.done && touches(g, question))?.goal || goals.find(g => !g.done)?.goal;
  if (!pick) return "";
  const p = progressOf(pick, stock, { live, race, pace });
  if (p.summary) return p.summary;
  if (pick.kind === "riding") {
    const R = RIDING[pick.skill];
    return `${R.name} is level ${R.level} and ${fmt(pick.gold ?? R.gold)} gold from your people's riding trainer.`;
  }
  return "";
}

// ---- After a save: how the goals stand (POST /api/notebook/goals) ----

// The open goals with their check-in for Willo's app: [{goal (its words), page, raw, reached, mark, line}]: line is her
// cheer for a goal reached, else her check-in (said only when mark changed since she last told it, which her app keeps).
export function goalChecks(goals, stock) {
  const pace = paceOf(stock);
  const states = goals.filter(g => !g.done && g.goal.kind !== "other").map(g => ({ g, p: progressOf(g.goal, stock, { pace }) }));
  const riding = states.filter(s => s.p.reached && s.g.goal.kind === "riding").map(s => RIDING[s.g.goal.skill].level);
  return states.map(({ g, p }) => ({ goal: g.text, page: g.page, raw: g.raw, reached: p.reached, mark: p.mark,
    // A level goal reached with the riding at that level: ticked too, cheered once (the riding's).
    line: p.reached ? (g.goal.kind === "level" && riding.includes(g.goal.level) ? "" : p.cheer) : p.checkin }))
    .filter(c => c.reached || c.mark !== "?");
}
