// Player profiles (LOR-181): a signed-in player pastes their journey record on /account (lib/journey.js reads it) and
// gets a page at /u/<handle> with their character's stats, the road they took, the bosses they beat and their story.
// Used by functions/api/profile/[action].js and functions/u/[handle].js. Kept outside functions/ so Pages doesn't
// route it.
//
// One profile per account: the character of the latest record pasted. It's private until its owner makes it public;
// until then only they can open it. The table is in lib/accounts.js SETUP (and USER_DATA), so "Delete my account"
// removes it. The page never shows the account's name (often a real name from Google), only the character and the
// links the player added to their account.
//
// The story: with the Pages secret GEMINI_API_KEY, each import writes one (STORY_MODEL, or the STORY_MODEL variable;
// at most STORIES_PER_DAY a day per account, and story_count keeps the total, so writing it again can be gated
// later). An update from the companion app (POST /api/profile/sync, LOR-148) writes one only now and then
// (storyDue: something new to tell, and STORY_SYNC_HOURS since the last try). Without the key, or when writing fails or strays from the era (offCanon), it's a summary built from the
// record (templateStory). The page calls either one the "story" and doesn't talk about models; that's UI copy, not a
// secret: how stories are made is said plainly wherever someone asks.

import { escape, page, linkList } from "./voices.js";
import { slug } from "./accounts.js";
import { SPECS } from "./journey.js";
import { numbersSection } from "./profile-stats.js";
import { linker, moments, journeySection } from "./trails.js";
import { roadChart } from "./roadchart.js";
import { picturesSection, pictureUrl } from "./pictures.js";
import { cardKey, cardUrl } from "./sharecard.js";

export const STORIES_PER_DAY = 3;
export const STORY_MODEL = "gemini-3.1-flash-lite";
const API = "https://generativelanguage.googleapis.com/v1beta/models";
const STORY_TIMEOUT_MS = 15000;   // a story usually takes 2-3 seconds; past this the player gets the summary

const RESERVED = new Set(["me", "new", "edit", "settings", "admin", "account", "api"]);

// ---- Rows ----

const fromRow = row => {
  if (!row) return null;
  let data = null, journey = null;
  try { data = JSON.parse(row.data); } catch (e) {}
  try { journey = row.journey ? JSON.parse(row.journey) : null; } catch (e) {}
  return data ? { ...row, data, journey } : null;
};

export async function profileOf(env, userId) {
  return fromRow(await env.DB.prepare("SELECT * FROM profiles WHERE user_id = ?").bind(userId).first());
}

export async function profileByHandle(env, handle) {
  return fromRow(await env.DB.prepare("SELECT * FROM profiles WHERE handle = ?").bind(handle).first());
}

// The page address for a new profile: the character's name as a slug, made unique ("aelric", "aelric-2", ...).
export async function newHandle(env, name) {
  const base = slug(name).slice(0, 24) || "player";
  for (let n = 1; n < 30; n++) {
    const handle = n === 1 ? base : `${base}-${n}`;
    if (RESERVED.has(handle)) continue;
    if (!(await env.DB.prepare("SELECT 1 FROM profiles WHERE handle = ?").bind(handle).first())) return handle;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

// An address a player picks for their profile: 3 to 24 lowercase letters, digits or dashes, not starting or ending
// with a dash, and not one of the site's own words.
export const validHandle = h => /^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$/.test(h) && !RESERVED.has(h);

// The specs a player can pick as their favorite: their class's talent trees (none when the class wasn't recognized).
export const specsFor = data => (Object.hasOwn(SPECS, data?.classKey ?? "") ? SPECS[data.classKey] : []);

// ---- What the page and the story are built from ----

// "1,234". Not toLocaleString: its first call costs more CPU than the whole page on a fresh Worker.
export const count = n => String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const plural = (n, one, many = one + "s") => `${count(n)} ${n === 1 ? one : many}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = iso => {
  const t = new Date(iso);
  return isNaN(t) ? "" : `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}`;
};
const listOf = items => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const article = word => (/^[aeiou]/i.test(word) ? "an " : "a ") + word;
const unique = list => [...new Set(list.filter(Boolean))];

// The lands in the order first reached, and the dungeons entered.
export function road(d) {
  const dungeons = unique(d.places.filter(p => p.dungeon).map(p => p.zone));
  const zones = unique(d.places.filter(p => !p.dungeon).map(p => p.zone)).filter(z => !dungeons.includes(z));
  return { zones, dungeons };
}

// "Level 24 Night Elf Druid".
export const sheetLine = d => [d.level ? `Level ${d.level}` : "", d.race, d.className].filter(Boolean).join(" ");

const STANDINGS = ["Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"];
const bestStanding = rep => [...rep].sort((a, b) => STANDINGS.indexOf(b.standing) - STANDINGS.indexOf(a.standing))[0];

// The place most of the deaths happened, if one stands out.
function deadliest(deaths) {
  const n = {};
  for (const d of deaths) if (d.zone) n[d.zone] = (n[d.zone] || 0) + 1;
  const [zone, count] = Object.entries(n).sort((a, b) => b[1] - a[1])[0] || [];
  return count > 1 ? zone : null;
}

// People with a full name (most likely someone of note) first.
const notablePeople = people => [...people.filter(p => p.name.includes(" ")), ...people.filter(p => !p.name.includes(" "))];

// The story when none is written: a few plain paragraphs from the record, in English.
export function templateStory(d) {
  const name = d.name;
  const who = [d.race, d.className].filter(Boolean).join(" ") || "adventurer";
  const { zones, dungeons } = road(d);
  const t = d.totals;

  const first = [`${name} is ${d.level ? `a level ${d.level} ${who}` : article(who)}${d.faction ? ` of the ${d.faction}` : ""}.`];
  if (zones.length && d.cut) {
    // A long record keeps only its newest entries (JourneyRecord.lua): its first place isn't where it all began.
    first.push(`The latest stretch of the road has led through ${listOf(zones.slice(-6))}.`);
  } else if (zones.length) {
    const began = d.fromLevel > 1 ? `${name}'s journal opens at level ${d.fromLevel}, in ${zones[0]}` : `The journey began in ${zones[0]}`;
    const since = d.since ? ` on ${d.since}` : "";
    const on = zones.slice(1, 6).concat(zones.length > 6 ? [plural(zones.length - 6, "more land")] : []);
    first.push(on.length ? `${began}${since}, and the road has led on through ${listOf(on)}.` : `${began}${since}.`);
  }

  const second = [];
  const met = notablePeople(d.people).slice(0, 3).map(p => p.name);
  if (t.quests || t.people) {
    const did = [t.quests && `finished ${plural(t.quests, "quest")}`, t.people && `met ${plural(t.people, "person", "people")}`];
    second.push(`Along the way ${name} has ${listOf(did.filter(Boolean))}${met.length ? `, among them ${listOf(met)}` : ""}.`);
  }
  if (dungeons.length) second.push(`${name} has braved ${listOf(dungeons.slice(0, 4))}${dungeons.length > 4 ? " and more" : ""}.`);
  const bosses = unique(d.bosses.map(b => b.name)).slice(0, 4);
  if (bosses.length) second.push(`${listOf(bosses)} ${bosses.length === 1 ? "has" : "have"} fallen to ${name}.`);

  const third = [];
  if (d.fought[0]) third.push(`${name}'s most fought foe: ${d.fought[0].name}, ${plural(d.fought[0].n, "time")}.`);
  if (d.deaths.length) {
    const where = deadliest(d.deaths);
    third.push(`${name} has died ${d.cut ? "at least " : ""}${plural(d.deaths.length, "time")}${where ? `, most often in ${where}` : ""}, and got back up every time.`);
  }
  const rep = bestStanding(d.rep);
  if (rep) third.push(`${name} is ${rep.standing} with ${rep.faction}.`);
  if (d.mounts.length) third.push(`${name} rides ${article(d.mounts[d.mounts.length - 1].name)}.`);
  const prof = [...d.profs].sort((a, b) => b.rank - a.rank)[0];
  if (prof) third.push(`In ${prof.name}, ${name} has reached ${prof.rank}.`);
  if (d.books.length === 1) third.push(`${name} has read "${d.books[0].title}".`);
  else if (d.books.length) third.push(`${name} has read ${plural(d.books.length, "book")}, among them "${d.books[0].title}".`);

  return [first, second, third].filter(p => p.length).map(p => p.join(" ")).join("\n\n");
}

// The record as the facts a story may use, one per line.
function facts(d, spec) {
  const { zones, dungeons } = road(d);
  const t = d.totals;
  const out = [`Character: ${d.name}, ${[d.race, d.className].filter(Boolean).join(" ") || "an adventurer"}` +
    `${d.faction ? ` of the ${d.faction}` : ""}${d.level ? `, level ${d.level}` : ""}${spec ? `, favorite talent spec ${spec}` : ""}.`];
  if (d.cut) {
    out.push(`Journal kept since ${d.since || "long ago"}, but only its most recent part is listed below: the older deeds ` +
      "were left out, so don't tell where the journey began or claim anything was a first.");
  } else if (d.since) {
    out.push(`Journal kept since ${d.since}${d.fromLevel > 1 ? `, starting at level ${d.fromLevel}` : ", from the very start"}.`);
  }
  if (zones.length) out.push(`Lands, in the order first reached${d.cut ? " (recent part only)" : ""}: ${zones.join(" -> ")}.`);
  if (dungeons.length) out.push(`Dungeons entered: ${dungeons.join(", ")}.`);
  if (d.bosses.length) out.push(`Bosses defeated: ${d.bosses.map(b => b.name + (b.zone ? ` (${b.zone})` : "")).join("; ")}.`);
  if (d.quests.length) {
    out.push(`Quests finished: ${t.quests} in all. Some of them, oldest first: ` +
      d.quests.slice(-30).map(q => q.title + (q.zone ? ` (${q.zone})` : "")).join("; ") + ".");
  }
  if (d.people.length) out.push(`People met (${t.people} in all), some of them: ${notablePeople(d.people).slice(0, 25).map(p => p.name).join(", ")}.`);
  if (d.kills.length) out.push(`Notable foes slain: ${d.kills.slice(-15).map(k => k.name + (k.rank ? ` (${k.rank})` : "")).join(", ")}.`);
  if (d.fought.length) out.push(`Foes fought most: ${d.fought.slice(0, 5).map(f => `${f.name} (${plural(f.n, "time")})`).join(", ")}.`);
  if (d.deaths.length) {
    // Each death with its place, so a story never has to guess where it happened (it once moved one to Darkshore).
    const where = d.deaths.slice(-8).map(x => [x.sub && x.zone ? `${x.sub}, ${x.zone}` : x.zone || "somewhere unrecorded",
      x.by && `slain by ${x.by}`].filter(Boolean).join(", "));
    out.push(`Died ${d.cut ? "at least " : ""}${plural(d.deaths.length, "time")}${d.deaths.length > 8 ? " (the latest 8 listed)" : ""}: ` +
      `${where.join("; ")}.`);
  }
  const finds = d.loot.filter(l => l.quality >= 3).slice(-8);
  if (finds.length) out.push(`Treasured finds: ${finds.map(l => l.name).join(", ")}.`);
  if (d.mounts.length) out.push(`Mounts: ${d.mounts.map(m => m.name).join(", ")}.`);
  if (d.profs.length) out.push(`Professions: ${d.profs.map(p => `${p.name} ${p.rank}`).join(", ")}.`);
  if (d.rep.length) out.push(`Reputation: ${d.rep.map(r => `${r.standing} with ${r.faction}`).join(", ")}.`);
  if (d.books.length) out.push(`Books read: ${d.books.slice(0, 10).map(b => `"${b.title}"`).join(", ")}.`);
  if (d.grouped) out.push(`${d.grouped} of these moments happened in a group with other adventurers.`);
  return out.join("\n");
}

const LANGUAGES = { en: "English", de: "German", fr: "French", es: "Spanish (Spain)", pt: "Brazilian Portuguese" };

const SYSTEM = `You write the short story of a World of Warcraft character for their profile page on Lore Forever, a site where players share their journeys. Their friends will read it.

Canon:
- The world is WoW Forever: Azeroth just after Warcraft III (25 years after the Dark Portal opened). That time is "now". Never mention, hint at or foreshadow anything later in Warcraft history, and never say that something hasn't happened yet. No Outland, no draenei, nothing from later expansions.
- Don't reveal a secret or twist unless the facts show this character uncovering it.

How to write:
- Use only the facts given. Never invent a deed, place, person, item or outcome. You may add a little colour from the lore of that era about who someone is or why a place matters.
- Third person, past tense, about the character by name. If you need a pronoun, use "they".
- Warm and lively, like a tale told in a tavern, with a little wit. The reader should feel these deeds mattered.
- Leave out game mechanics: no levels, experience, loot, kill counts, "quests", "NPCs" or "mobs". Say what happened in the world instead.
- 120 to 200 words in two or three short paragraphs, separated by a blank line. Plain text: no title, no markdown, no lists.`;

const SCHEMA = { type: "object", properties: { story: { type: "string" } }, required: ["story"] };

// Anything after Forever's era. Mirrors companion/lore_companion/lint.py (HARD and CHAPTER), plus the main names in
// the bundled languages. A match the record itself contains doesn't count: the player lived it.
const ERA = [
  /\bCataclysm\b|\bthe Shattering\b(?! of)|\bBroken Shore\b/,   // case matters: "Darkshore's broken shore" is fine
  /\bgarrosh\b/i, /\bvanessa vancleef\b/i, /burning of teldrassil|war of thorns|teldrassil (burned|was burned|burns)/i,
  /shadowlands|\bthe jailer\b|\bzovaal\b/i, /bolvar[^.]{0,60}lich king|lich king[^.]{0,40}bolvar/i,
  /high king anduin|king anduin[^.]{0,40}(grown|adult|leads the alliance)/i,
  /wrath of the lich king|mists of pandaria|warlords of draenor|battle for azeroth|the war within|\bazerite\b|\bdragon isles\b/i,
  /\bdracthyr\b|\bvoid elf|\bnightborne\b|\bevokers?\b|\bebon blade\b|\bacherus\b|\bmag'har\b|\bvulpera\b|\bmechagnome|\blightforged\b/i,
  /warchief sylvanas|sylvanas,? (the )?warchief|warchief vol'jin|\bcalia\b|desolate council|\bwarchief baine\b|\bthrall[^.]{0,30}world-shaman/i,
  /wrathgate|icecrown citadel|angrathar|\bnaxxramas\b[^.]{0,40}northrend/i,
  /gilneas (joined|rejoin|rejoined)|genn greymane[^.]{0,40}worgen/i,
  /\b(has|have)(n't| not) (yet )?happened( yet)?\b|\bnot happened yet\b|\boutside (of )?(forever's|the|this) (timeline|era)\b|\bbeyond the current (time|era)\b|\blater expansions?\b|\bin retail\b|\bretail (wow|world of warcraft)\b/i,
  /\boutland\b|\bdraenei\b|\bhellfire (peninsula|citadel)\b|\bshattrath\b|\bexodar\b|\bburning crusade\b/i,
  /\bscherbenwelt\b|\boutreterre\b|\bterrallende\b|\bterralém\b|\bkataklysm|\bcataclysme\b|\bcataclismo\b|\bdraene[iï]\b/i,
  // And no talk of how it was written: the story is just the story. Case matters for the short ones: French "j'ai",
  // Portuguese "Ai, que frio".
  /\bAI\b|\bA\.I\.|\bKI\b|\bIA\b/,
  /language model|\bllm\b|\bchatbot\b|\bgemini\b|\bas an assistant\b|\bgenerated by\b/i,
];

export function offCanon(story, known = "") {
  const plain = s => String(s).replace(/[’‘]/g, "'");
  return ERA.some(re => re.test(plain(story)) && !re.test(plain(known)));
}

// A written story as stored: plain paragraphs, nothing that looks like markdown, a sane length. null if it isn't one.
function cleanStory(text) {
  const paras = String(text || "").replace(/\r\n?/g, "\n").replace(/[*_#`]+/g, "").split(/\n\s*\n/)
    .map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const story = (paras.length === 1 ? splitParagraphs(paras[0]) : paras.slice(0, 5)).join("\n\n");
  return story.length >= 200 && story.length <= 2600 ? story : null;
}

// One long block (the reply often has no blank lines) as two or three paragraphs, broken between sentences.
export function splitParagraphs(text) {
  const sentences = text.match(/[^.!?]+[.!?]+["'’”)\]]*(\s+|$)/g);
  const words = text.split(/\s+/).length;
  if (!sentences || sentences.join("") !== text || sentences.length < 4 || words < 90) return [text];
  const parts = words > 160 ? 3 : 2, target = words / parts, out = [];
  let cur = "", n = 0;
  for (const s of sentences) {
    cur += s;
    n += s.trim().split(/\s+/).length;
    if (n >= target && out.length < parts - 1) { out.push(cur.trim()); cur = ""; n = 0; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ---- The monthly budget ----

// Gemini's published paid-tier prices, USD per million tokens (ai.google.dev/gemini-api/docs/pricing, checked
// 2026-10-03): text input, and output including thinking. A model missing here is never called, since its cost
// couldn't be counted.
export const STORY_PRICES = { "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 } };
export const STORY_BUDGET_USD = 100;   // a month, all accounts together; the STORY_BUDGET_USD variable overrides it

const month = (now = new Date()) => now.toISOString().slice(0, 7);
const storyModel = env => env.STORY_MODEL || STORY_MODEL;
export const budgetMicro = env => {
  const usd = Number(env.STORY_BUDGET_USD ?? STORY_BUDGET_USD);
  return Math.round((Number.isFinite(usd) && usd >= 0 ? usd : STORY_BUDGET_USD) * 1e6);
};

// What one reply cost, in millionths of a dollar (rounded up), from its usageMetadata.
export function storyCost(usage, model) {
  const price = STORY_PRICES[model];
  if (!price || !usage) return 0;
  const output = (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
  return Math.ceil((usage.promptTokenCount || 0) * price.input + output * price.output);
}

// This month's spend so far: {month, micro_usd, calls, stories}.
export async function storySpend(env, now = new Date()) {
  const row = await env.DB.prepare("SELECT * FROM story_spend WHERE month = ?").bind(month(now)).first();
  return row || { month: month(now), micro_usd: 0, calls: 0, stories: 0 };
}

// Whether a story may be written now: a priced model, and this month's spend under the budget. The spend includes
// the stories' recordings (lib/storyvoice.js, voice_micro_usd: a column that exists once that feature has run).
export async function storyBudgetLeft(env, now = new Date()) {
  if (!STORY_PRICES[storyModel(env)]) return false;
  const s = await storySpend(env, now);
  return s.micro_usd + (s.voice_micro_usd || 0) < budgetMicro(env);
}

async function addSpend(env, micro, kept) {
  await env.DB.prepare(
    "INSERT INTO story_spend (month, micro_usd, calls, stories) VALUES (?, ?, 1, ?) ON CONFLICT (month) DO UPDATE SET " +
    "micro_usd = micro_usd + excluded.micro_usd, calls = calls + 1, stories = stories + excluded.stories"
  ).bind(month(), micro, kept ? 1 : 0).run();
}

// Writes a story with Gemini and adds what it cost to this month's spend. Returns {text, why}: text is null when
// there's no story, and why says what happened (written, off, unpriced, http-<status>, timeout, network, unreadable,
// length, era; also in the Functions log).
export async function writeStory(env, d, spec) {
  const key = env.GEMINI_API_KEY, model = storyModel(env);
  if (!key) return { text: null, why: "off" };
  if (!STORY_PRICES[model]) { console.warn(`profile story: no price for ${model}, not calling it`); return { text: null, why: "unpriced" }; }
  const known = facts(d, spec);
  const prompt = `${known}\n\nWrite ${d.name}'s story in ${LANGUAGES[d.locale] || "English"}.`;
  let out;
  try {
    const res = await fetch(`${API}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        // Thinking counts against maxOutputTokens, so leave room beyond the story itself.
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.8, maxOutputTokens: 8192 },
      }),
      signal: AbortSignal.timeout(STORY_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`profile story: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
      await addSpend(env, 0, false);
      return { text: null, why: `http-${res.status}` };
    }
    out = await res.json();
  } catch (e) {
    console.warn(`profile story: ${e.name}: ${e.message}`);
    return { text: null, why: e.name === "TimeoutError" ? "timeout" : "network" };
  }
  let story = null, why = "written";
  try {
    const text = (out.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
    story = cleanStory(JSON.parse(text).story);
    if (!story) why = "length";
    else if (offCanon(story, known)) [story, why] = [null, "era"];
  } catch (e) {
    why = "unreadable";
  }
  if (!story) console.warn(`profile story: ${why}`);
  await addSpend(env, storyCost(out.usageMetadata, model), Boolean(story));
  return { text: story, why };
}

// ---- When the companion's updates write a new story (LOR-148) ----

// A pasted record writes a story each time (within the daily allowance). The companion sends the record after every
// /reload and logout (lib/devices.js, POST /api/profile/sync), and the add-on can't tell those apart (the game's
// PLAYER_LOGOUT fires on both), so an update writes a new story only when there's something new to tell
// (movedOn) and the last try is at least STORY_SYNC_HOURS old; the daily allowance and monthly budget still apply.
// A profile whose story was never written gets one on its first update.
export const STORY_SYNC_HOURS = 6;
export const STORY_SYNC_QUESTS = 5;   // this many more quests done is something new to tell

// Columns added after the table was made (lib/accounts.js has them in CREATE TABLE for a new database).
const MIGRATE = [
  "ALTER TABLE profiles ADD COLUMN story_at TEXT",      // when a story was last tried (written or not)
  "ALTER TABLE profiles ADD COLUMN story_basis TEXT",   // storyBasis of the record the written story was told from
  "ALTER TABLE profiles ADD COLUMN journey TEXT",       // the companion's journey data (lib/journey.js readJourney)
  "ALTER TABLE profiles ADD COLUMN card_sha TEXT",      // the share card's address (lib/sharecard.js, LOR-150)
  "ALTER TABLE profiles ADD COLUMN card_key TEXT",      // which version of the profile it was drawn from (cardKey)
];
let migrated = false;
export async function setupProfiles(env) {
  if (migrated) return;
  for (const sql of MIGRATE) {
    try { await env.DB.prepare(sql).run(); } catch (e) {}   // fails once the column exists
  }
  migrated = true;
}

// What a story was told from: the level, quests and bosses done, and the lands, dungeons and mounts.
export function storyBasis(d) {
  const { zones, dungeons } = road(d);
  return { level: d.level || 0, quests: d.totals?.quests || 0, bosses: d.totals?.bosses || 0, lands: zones, dungeons,
           mounts: unique(d.mounts.map(m => m.name)) };
}

// Whether the record has something new to tell since `basis` (storyBasis of the record the story was told from): a
// level, a new land, dungeon, boss or mount, or STORY_SYNC_QUESTS more quests.
export function movedOn(basis, d) {
  if (!basis || typeof basis !== "object") return true;
  const now = storyBasis(d);
  const added = k => now[k].some(x => !(Array.isArray(basis[k]) ? basis[k] : []).includes(x));
  return now.level > (basis.level || 0) || now.quests >= (basis.quests || 0) + STORY_SYNC_QUESTS ||
    now.bosses > (basis.bosses || 0) || added("lands") || added("dungeons") || added("mounts");
}

// Whether an update from the companion should try a new story for profile `p` (null: none yet) from record `d`.
export function storyDue(p, d, now = new Date()) {
  if (!p) return true;
  const last = Date.parse(p.story_at || "");
  const rested = !Number.isFinite(last) || now - last >= STORY_SYNC_HOURS * 3600e3;
  if (p.story_source !== "written") return rested;   // never written yet (or the last try failed)
  let basis = null;
  try { basis = JSON.parse(p.story_basis || "null"); } catch (e) {}
  return rested && movedOn(basis, d);
}

// The same character (a record of another one replaces the profile; an update from the companion never does).
export const sameCharacter = (a, b) => a?.name === b?.name && a?.realm === b?.realm;

// ---- The page ----

const host =u => new URL(u).hostname.replace(/^www\./, "");
// data-para: the paragraph's place, for the Listen box's read-along (lib/storyvoice.js storyParts counts the same way).
const paragraphs = text => String(text || "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  .map((p, i) => `<p data-para="${i}">${escape(p)}</p>`).join("\n      ");
const firstSentence = text => {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  const m = /^.{20,200}?[.!?](?=\s|$)/.exec(s);
  return m ? m[0] : s.slice(0, 200);
};
const QUALITY_CLASS = ["q0", "q1", "q2", "q3", "q4", "q5"];

function tiles(d) {
  const { dungeons } = road(d);
  const t = d.totals;
  // The totals line counts everything; dungeons and deaths come from the lists, which a cut record keeps only the
  // newest of: "3+". The journey stats count every death (LOR-246).
  const more = d.cut ? "+" : "";
  return [
    ["Level", d.level], ["Quests done", t.quests], ["Places", t.places], ["People met", t.people], ["Foes", t.foes],
    ["Bosses", t.bosses], ["Dungeons", dungeons.length, more],
    d.stats ? ["Deaths", d.stats.deaths] : ["Deaths", d.deaths.length, more],
  ].filter(([, n]) => n !== null && n !== undefined)
    .map(([label, n, plus = ""]) => `<li><strong>${count(n)}${plus}</strong><span>${label}</span></li>`).join("");
}

// A card of one list, or nothing when it's empty.
function card(title, items, more = 0) {
  if (!items.length) return "";
  return `<section class="zone pf-card"><div class="zone-body">
        <h3>${escape(title)}</h3>
        <ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>${more > 0 ? `\n        <p class="pf-more">and ${more} more</p>` : ""}
      </div></section>`;
}

const where = x => x.zone ? ` <span class="pf-where">${escape(x.sub ? `${x.sub}, ${x.zone}` : x.zone)}</span>` : "";

// A name linked to its lore page (LOR-248) when the lore pages are on and it has one, else just the name.
const loreLink = (text, path) => (path ? `<a href="${escape(path)}">${escape(text)}</a>` : escape(text));

// lore: lib/trails.js lookups while the lore pages are on, else null.
function cards(d, lore) {
  const { dungeons } = road(d);
  const bosses = [...d.bosses].reverse();
  const kills = [...d.kills].reverse();
  const finds = [...d.loot].filter(l => l.quality >= 2).sort((a, b) => b.quality - a.quality).slice(0, 8);
  const books = [...d.books].reverse();
  const out = [
    card("Bosses defeated", bosses.slice(0, 12).map(b => loreLink(b.name, lore?.person(b.name)) + where(b)), bosses.length - 12),
    card("Dungeons", dungeons.map(z => loreLink(z, lore?.zone(z)))),
    card("Notable kills", kills.slice(0, 10).map(k => loreLink(k.name, lore?.person(k.name)) + (k.rank ? ` <span class="pf-rank">${escape({ elite: "elite", rare: "rare", rareelite: "rare elite", worldboss: "world boss" }[k.rank])}</span>` : "")), kills.length - 10),
    card("Most fought", d.fought.map(f => `${escape(f.name)} <span class="pf-n">${count(f.n)}</span>`)),
    card("Best finds", finds.map(l => `<span class="${QUALITY_CLASS[l.quality] || ""}">${escape(l.name)}</span>${l.reward ? ' <span class="pf-where">quest reward</span>' : ""}`)),
    card("Mounts", d.mounts.map(m => escape(m.name))),
    card("Professions", d.profs.map(p => `${escape(p.name)} <span class="pf-n">${p.rank}</span>`)),
    card("Reputation", d.rep.slice(-10).map(r => `${escape(r.standing)} with ${escape(r.faction)}`), d.rep.length - 10),
    card("Books read", books.slice(0, 8).map(b => `<cite>${escape(b.title)}</cite>`), books.length - 8),
  ];
  return out.filter(Boolean).join("\n      ");
}

// The profile's own address with `params` ("as=visitor", "pictures=1"; empty ones left out).
const selfPath = (handle, ...params) => {
  const q = params.filter(Boolean).join("&");
  return escape(`/u/${handle}${q ? "?" + q : ""}`);
};

// Share (LOR-150): the share sheet, or the link copied (public/js/profile.js and share.js).
const shareButton = name => `<button class="btn-small" type="button" data-share data-share-text="${escape(`${name}'s journey in WoW Forever`)}">Share</button>`;

// The bar only the owner sees: whether others can, then Share, View as a visitor (LOR-302) and the switch together,
// the links that open on a view, and Update it (public/js/profile.js). Share on a private page says to make it public
// first. views: which of the journey's views the page has (Map, Timeline), to copy a link that opens on one of them.
// query: what to keep in the visitor view's address ("pictures=1").
function ownerBar(p, views = {}, query = "") {
  const msg = p.public
    ? "This is your profile. Anyone with the link can see it."
    : "Only you can see this page. Make it public to share it.";
  const copy = p.public ? [
    views.map && '<button class="btn-small btn-small-alt" type="button" data-copy="map">Copy map link</button>',
    views.timeline && '<button class="btn-small btn-small-alt" type="button" data-copy="timeline">Copy timeline link</button>']
    .filter(Boolean).map(b => "\n      " + b).join("") : "";
  return `<div class="pf-owner" id="pf-owner" data-bar data-public="${p.public ? 1 : 0}">
    <p>${msg}</p>
    <p class="vp-actions">
      ${shareButton(p.data.name)}
      <a class="btn-small" href="${selfPath(p.handle, query, "as=visitor")}" data-keep-view>View as a visitor</a>
      <button class="btn-small" type="button" data-set-public="${p.public ? 0 : 1}">${p.public ? "Make it private" : "Make it public"}</button>${copy}
      <a class="btn-small btn-small-alt" href="/account#profile">Update it</a>
    </p>
    <p class="fb-status" role="status" hidden></p>
  </div>`;
}

// View as a visitor (LOR-302): the owner gets the page exactly as everyone else does (profilePage without owner, or
// missingPage while it's private), and this bar on top is the only thing added. It stays in view while they scroll.
export function visitorBar(p, query = "") {
  const msg = p.public
    ? "You're viewing your profile as a visitor. This is what anyone with the link sees."
    : "Your profile is private, so visitors see what's below: No profile here.";
  return `<div class="pf-owner pf-visitor" id="pf-visitor" data-bar data-public="${p.public ? 1 : 0}">
    <p>${msg}</p>
    <p class="vp-actions">
      <a class="btn-small" href="${selfPath(p.handle, query)}" data-keep-view>Back to my view</a>${p.public ? "" : `
      <button class="btn-small btn-small-alt" type="button" data-set-public="1">Make it public</button>`}
    </p>
    <p class="fb-status" role="status" hidden></p>
  </div>`;
}

// For visitors, under someone's profile (the sign-in pull, LOR-222): a blank sheet where their own character would
// go, and the two ways in.
function makeYourOwn() {
  const tiles = ["Quests done", "Places", "Bosses", "Deaths"].map(t => `<li><strong>?</strong><span>${t}</span></li>`).join("");
  return `<section class="pf-cta pf-mine" aria-labelledby="cta-title">
    <div class="pf-ghost" aria-hidden="true">
      <div class="ss-head"><span class="vpr-avatar vpr-initial ss-avatar">?</span>
        <div><p class="ss-name">Your character</p><p class="ss-sub">Level ?? &middot; your race and class</p></div></div>
      <ul class="ss-stats ss-stats-4">${tiles}</ul>
    </div>
    <div>
      <h2 id="cta-title">This could be your page</h2>
      <p>Lore Forever is a free add-on for WoW Forever. It tells the story of where you are and keeps a journal of your
        road. One paste turns that journal into a page like this one.</p>
      <p class="vp-actions"><a class="btn-small" href="/account#profile">Make your profile</a>
        <a class="btn-small btn-small-alt" href="/download/installer">Download for Windows</a>
        <a class="pf-what" href="/">What it does</a></p>
    </div>
  </section>`;
}

// For the owner of a profile saved before the record kept its moments in order (LOR-248, 10/4), where the Map and
// Timeline would be. Only the record's facts are stored, not its times, so nothing on our side can rebuild them: a new
// paste does (and so does the companion's first update). Shown where the two views would be, with the steps, because
// a quiet note there went unnoticed (Mike, 10/5).
function updateNote() {
  return `<section class="pf-behind" aria-labelledby="behind-title">
    <h2 id="behind-title">Add your map and timeline</h2>
    <p>Your profile was made before it could show your road on a map and your journey moment by moment. Paste your
      journey record again and both appear here. Only you see this note.</p>
    <ol class="pf-steps">
      <li>In game, open Journey (<code>/lore journey</code>), click <strong>Copy my journey record</strong> and press
        <strong>Ctrl+C</strong>.</li>
      <li>On your account page, paste it and click <strong>Update my profile</strong>.</li>
    </ol>
    <p class="vp-actions"><a class="btn-small" href="/account#profile">Update my profile</a></p>
  </section>`;
}

// Small badges under the head for the account's accepted contributions (lib/credits.js contributionBadges, LOR-239):
// Narrator, Translator, Contributed N lines. Nothing when there are none.
function badgeLine(badges) {
  if (!badges.length) return "";
  return `<p class="pf-badges">${badges.map(b => `<a class="pf-badge pf-badge-${escape(b.kind)}" href="${escape(b.href)}" title="${escape(b.title)}">${escape(b.label)}</a>`).join(" ")}</p>`;
}

// /u/<handle>. links: the owner's account links (https only). owner: the viewer owns it (shows ownerBar, and no
// "This could be your page" or Share in the head). badges: their contribution badges. names: lib/trails.js lookups
// (loadLinks), for the journey's trails; lore: whether the lore pages are on (the "lore" feature), so names link to
// them (LOR-248). pictures: the picture book's pictures (lib/pictures.js listPictures) while it's shown (the
// "pictures" feature, or ?pictures=1), else null. asVisitor: the owner is viewing it as a visitor (LOR-302; pass
// owner false): the visitor's page with visitorBar on top. query: what the owner's links keep ("pictures=1").
// viewer: whoever is signed in, for the header (lib/voices.js siteNav); still the owner when viewing as a visitor.
// herald: Harold, the Lore Forever herald (LOR-266), signs the story (the "companion" feature).
// listen: the Listen box over the story (lib/storyvoice.js listenBox, LOR-316), or "".
export function profilePage(p, { links = [], owner = false, badges = [], names = linker(null), lore = false,
                                 pictures = null, asVisitor = false, query = "", viewer = null, herald = false,
                                 listen = "" } = {}) {
  const d = p.data;
  const { zones } = road(d);
  const L = lore ? names : null;
  // The moments: the companion's journey when it has sent one (LOR-248), else the record's.
  const list = moments(d, names, p.journey);
  const journey = journeySection(list, { lore: L });
  const chart = roadChart(list, { name: d.name });
  // A profile saved before the record kept its moments' order (before 10/4): its owner is told how to get them.
  const behind = owner && !journey && !Array.isArray(d.timeline) ? updateNote() : "";
  const title = `${d.name}${sheetLine(d) ? ", " + sheetLine(d).replace(/^Level/, "level") : ""}`;
  const facts = [sheetLine(d), d.faction, d.realm].filter(Boolean).map(escape).join(" &middot; ");
  const linkLine = links.length
    ? `<p class="vpr-links">${links.map(u => `<a href="${escape(u)}" rel="nofollow ugc noopener">${escape(host(u))}</a>`).join(" &middot; ")}</p>`
    : "";
  const updated = shortDate(p.updated);
  // The trek first (Mike, 10/4: whoever a player shares their page with follows the journey): two views right under
  // the head, Map (the road chart) and Timeline (the moments), each with its own link (/u/<handle>#map, #timeline).
  // public/js/journey.js shows one at a time; without it both are there, one after the other.
  const views = journey ? `<nav class="pf-views" aria-label="Follow the journey" hidden>
    ${chart ? '<a href="#map" data-view="map">Map</a>' : ""}<a href="#timeline" data-view="timeline">Timeline</a>
  </nav>
  ${chart ? `<section class="vp-section pf-view pf-map" id="map" aria-labelledby="map-title">
    <h2 id="map-title">The road on a chart</h2>
    ${chart}
  </section>` : ""}
  ${journey}` : "";
  // The picture book, right after the trek (Mike, 10/5): the pictures the companion put on the profile.
  const book = pictures ? picturesSection(pictures, { owner, tz: p.journey?.tz ?? 0 }) : "";
  // Visitors share from the head (LOR-150); the owner from their bar.
  const share = owner ? "" : `
    <div class="pf-head-share" data-bar>
      ${shareButton(d.name)}
      <p class="fb-status" role="status" hidden></p>
    </div>`;
  const bar = owner ? ownerBar(p, { map: Boolean(chart), timeline: Boolean(journey) }, query)
    : asVisitor ? visitorBar(p, query) : "";
  const body = `  ${bar}
  <div class="vpr-head pf-head">
    <span class="vpr-avatar vpr-initial pf-${escape(d.factionKey || "none")}" aria-hidden="true">${escape(Array.from(d.name)[0] || "?")}</span>
    <div class="pf-head-main">
      <h1>${escape(d.name)}</h1>
      <p class="zone-where">${facts}</p>
      ${p.spec ? `<p class="pf-spec">Favorite spec: <strong>${escape(p.spec)}</strong></p>` : ""}
      ${badgeLine(badges)}
      ${linkLine}
    </div>${share}
  </div>
  ${views}${behind}${book}
  <ul class="pf-stats">${tiles(d)}</ul>
  ${numbersSection(d)}
  <section class="vp-section pf-story" aria-labelledby="story-title">
    <h2 id="story-title">${escape(d.name)}'s story</h2>${listen ? `\n    ${listen}` : ""}
    <div class="pf-story-text" lang="${d.locale === "en" || p.story_source !== "written" ? "en" : escape(d.locale)}">
      ${paragraphs(p.story)}
    </div>${herald ? `
    <p class="pf-signed"><img src="/img/harold-head.svg" alt="" width="48" height="48"><span>Written by Harold, the Lore Forever herald</span></p>` : ""}
  </section>
  ${zones.length ? `<section class="vp-section" aria-labelledby="road-title">
    <h2 id="road-title">The road so far</h2>
    <ol class="pf-road">${zones.map(z => `<li>${loreLink(z, L?.zone(z))}</li>`).join("")}</ol>
  </section>` : ""}
  <div class="zone-grid pf-grid">
      ${cards(d, L)}
  </div>
  ${owner ? "" : makeYourOwn()}
  <p class="vp-note">${d.since ? `Journey recorded since ${escape(d.since)}. ` : ""}${updated ? `Updated ${escape(updated)}.` : ""}</p>`;
  // The share card (lib/sharecard.js): the owner's page draws it again when the public profile has changed since.
  const redraw = owner && p.public && p.card_key !== cardKey(p, herald);
  return page({
    title,
    description: firstSentence(p.story) || `${d.name}'s journey in WoW Forever, on Lore Forever.`,
    path: "/u/" + p.handle,
    crumbs: "",
    body: body + (redraw ? `\n  <script type="application/json" id="pf-sharecard">${cardJson(p, herald)}</script>` : ""),
    // A link to the profile shows its share card, or before it has one, its newest picture (or the site's card).
    image: cardUrl(p) || (pictures?.length ? "https://loreforeverwow.com" + pictureUrl(pictures[0]) : undefined),
    robots: "noindex",
    foot: `<p>Played WoW Forever with Lore Forever? <a href="/account#profile">Make your own profile</a>.</p>`,
    scripts: ['<script src="/js/share.js" defer></script>', '<script src="/js/profile.js" defer></script>',
      journey && '<script src="/js/journey.js" defer></script>',
      chart && '<script src="/js/roadchart.js" defer></script>',
      pictures?.length && '<script src="/js/pictures.js" defer></script>',
      redraw && '<script src="/js/card.js" defer></script>',
      listen && '<script src="/js/storyvoice.js" defer></script>'].filter(Boolean).join("\n"),
    viewer,
  });
}

// What public/js/card.js draws the share card from (lib/sharecard.js), as JSON safe inside a <script> element.
export function cardFacts(p, herald = false) {
  const d = p.data;
  const deaths = d.stats ? d.stats.deaths : d.deaths.length;
  return {
    key: cardKey(p, herald), name: d.name, sheet: sheetLine(d), faction: d.faction || "", realm: d.realm || "",
    factionKey: d.factionKey || "none", line: firstSentence(p.story), address: `loreforeverwow.com/u/${p.handle}`,
    tiles: [["Quests done", d.totals?.quests], ["Places", d.totals?.places], ["Bosses", d.totals?.bosses], ["Deaths", deaths]]
      .map(([label, n]) => [label, Number(n) || 0]),
    herald: Boolean(herald),
  };
}
const cardJson = (p, herald) => JSON.stringify(cardFacts(p, herald)).replace(/</g, "\\u003c");

// /u/<handle> when there's no such profile, or it's private. bar: visitorBar on top, when its owner views their private
// profile as a visitor (LOR-302). viewer: as for profilePage.
export function missingPage(handle, { bar = "", viewer = null } = {}) {
  return page({
    title: "No profile here",
    description: "This Lore Forever profile doesn't exist, or its owner keeps it private.",
    path: "/u/" + slug(handle),
    crumbs: "",
    body: `  ${bar ? bar + "\n  " : ""}<h1>No profile here</h1>
  <p class="pitch">This profile doesn't exist, or its owner keeps it private.</p>
  <p class="vp-actions"><a class="btn-small" href="/account#profile">Make your own profile</a> <a class="btn-small" href="/">What's Lore Forever?</a></p>`,
    robots: "noindex",
    foot: "",
    scripts: bar ? '<script src="/js/profile.js" defer></script>' : "",
    viewer,
  });
}

export const publicLinks = user => linkList(user?.links);
