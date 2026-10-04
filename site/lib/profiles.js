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
// later). Without the key, or when writing fails or strays from the era (offCanon), it's a summary built from the
// record (templateStory). Players only ever see "story", never how it was made.

import { escape, page, linkList } from "./voices.js";
import { slug } from "./accounts.js";
import { SPECS } from "./journey.js";

export const STORIES_PER_DAY = 3;
export const STORY_MODEL = "gemini-3.1-flash-lite";
const API = "https://generativelanguage.googleapis.com/v1beta/models";
const STORY_TIMEOUT_MS = 15000;   // a story usually takes 2-3 seconds; past this the player gets the summary

const RESERVED = new Set(["me", "new", "edit", "settings", "admin", "account", "api"]);

// ---- Rows ----

const fromRow = row => {
  if (!row) return null;
  let data = null;
  try { data = JSON.parse(row.data); } catch (e) {}
  return data ? { ...row, data } : null;
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
  // And nothing about how it was written. Case matters for the short ones: French "j'ai", Portuguese "Ai, que frio".
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
const budgetMicro = env => {
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

// Whether a story may be written now: a priced model, and this month's spend under the budget.
export async function storyBudgetLeft(env, now = new Date()) {
  if (!STORY_PRICES[storyModel(env)]) return false;
  return (await storySpend(env, now)).micro_usd < budgetMicro(env);
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

// ---- The page ----

const host = u => new URL(u).hostname.replace(/^www\./, "");
const paragraphs = text => String(text || "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  .map(p => `<p>${escape(p)}</p>`).join("\n      ");
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
  // newest of: "3+".
  const more = d.cut ? "+" : "";
  return [
    ["Level", d.level], ["Quests done", t.quests], ["Places", t.places], ["People met", t.people], ["Foes", t.foes],
    ["Bosses", t.bosses], ["Dungeons", dungeons.length, more], ["Deaths", d.deaths.length, more],
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

function cards(d) {
  const { dungeons } = road(d);
  const bosses = [...d.bosses].reverse();
  const kills = [...d.kills].reverse();
  const finds = [...d.loot].filter(l => l.quality >= 2).sort((a, b) => b.quality - a.quality).slice(0, 8);
  const books = [...d.books].reverse();
  const out = [
    card("Bosses defeated", bosses.slice(0, 12).map(b => escape(b.name) + where(b)), bosses.length - 12),
    card("Dungeons", dungeons.map(escape)),
    card("Notable kills", kills.slice(0, 10).map(k => escape(k.name) + (k.rank ? ` <span class="pf-rank">${escape({ elite: "elite", rare: "rare", rareelite: "rare elite", worldboss: "world boss" }[k.rank])}</span>` : "")), kills.length - 10),
    card("Most fought", d.fought.map(f => `${escape(f.name)} <span class="pf-n">${count(f.n)}</span>`)),
    card("Best finds", finds.map(l => `<span class="${QUALITY_CLASS[l.quality] || ""}">${escape(l.name)}</span>${l.reward ? ' <span class="pf-where">quest reward</span>' : ""}`)),
    card("Mounts", d.mounts.map(m => escape(m.name))),
    card("Professions", d.profs.map(p => `${escape(p.name)} <span class="pf-n">${p.rank}</span>`)),
    card("Reputation", d.rep.slice(-10).map(r => `${escape(r.standing)} with ${escape(r.faction)}`), d.rep.length - 10),
    card("Books read", books.slice(0, 8).map(b => `<cite>${escape(b.title)}</cite>`), books.length - 8),
  ];
  return out.filter(Boolean).join("\n      ");
}

// The bar only the owner sees: whether others can, and the buttons to change it (public/js/profile.js).
function ownerBar(p) {
  const msg = p.public
    ? "This is your profile. Anyone with the link can see it."
    : "Only you can see this page. Make it public to share it.";
  return `<div class="pf-owner" id="pf-owner" data-public="${p.public ? 1 : 0}">
    <p>${msg}</p>
    <p class="vp-actions">
      ${p.public ? '<button class="btn-small" type="button" data-copy>Copy link</button>' : ""}
      <button class="btn-small" type="button" data-set-public="${p.public ? 0 : 1}">${p.public ? "Make it private" : "Make it public"}</button>
      <a class="btn-small" href="/account#profile">Update it</a>
    </p>
    <p class="fb-status" role="status" hidden></p>
  </div>`;
}

// /u/<handle>. links: the owner's account links (https only). owner: the viewer owns it (shows ownerBar).
export function profilePage(p, { links = [], owner = false } = {}) {
  const d = p.data;
  const { zones } = road(d);
  const title = `${d.name}${sheetLine(d) ? ", " + sheetLine(d).replace(/^Level/, "level") : ""}`;
  const facts = [sheetLine(d), d.faction, d.realm].filter(Boolean).map(escape).join(" &middot; ");
  const linkLine = links.length
    ? `<p class="vpr-links">${links.map(u => `<a href="${escape(u)}" rel="nofollow ugc noopener">${escape(host(u))}</a>`).join(" &middot; ")}</p>`
    : "";
  const updated = shortDate(p.updated);
  const body = `  ${owner ? ownerBar(p) : ""}
  <div class="vpr-head pf-head">
    <span class="vpr-avatar vpr-initial pf-${escape(d.factionKey || "none")}" aria-hidden="true">${escape(Array.from(d.name)[0] || "?")}</span>
    <div>
      <h1>${escape(d.name)}</h1>
      <p class="zone-where">${facts}</p>
      ${p.spec ? `<p class="pf-spec">Favorite spec: <strong>${escape(p.spec)}</strong></p>` : ""}
      ${linkLine}
    </div>
  </div>
  <ul class="pf-stats">${tiles(d)}</ul>
  <section class="vp-section pf-story" aria-labelledby="story-title">
    <h2 id="story-title">${escape(d.name)}'s story</h2>
    <div lang="${d.locale === "en" || p.story_source !== "written" ? "en" : escape(d.locale)}">
      ${paragraphs(p.story)}
    </div>
  </section>
  ${zones.length ? `<section class="vp-section" aria-labelledby="road-title">
    <h2 id="road-title">The road so far</h2>
    <ol class="pf-road">${zones.map(z => `<li>${escape(z)}</li>`).join("")}</ol>
  </section>` : ""}
  <div class="zone-grid pf-grid">
      ${cards(d)}
  </div>
  <section class="fb-done pf-cta" aria-labelledby="cta-title">
    <h2 id="cta-title">Make your own</h2>
    <p>Lore Forever is a free add-on for WoW Forever that tells the story of where you are and keeps a journal of your
      journey. Play a while, then turn it into a page like this one.</p>
    <p class="vp-actions"><a class="btn-small" href="/download/installer">Download for Windows</a>
      <a class="btn-small" href="/account#profile">Make your profile</a> <a class="pf-what" href="/">What it does</a></p>
  </section>
  <p class="vp-note">${d.since ? `Journey recorded since ${escape(d.since)}. ` : ""}${updated ? `Updated ${escape(updated)}.` : ""}</p>`;
  return page({
    title,
    description: firstSentence(p.story) || `${d.name}'s journey in WoW Forever, on Lore Forever.`,
    path: "/u/" + p.handle,
    crumbs: `<a href="/">Lore Forever</a> &rsaquo; ${escape(d.name)}`,
    body,
    robots: "noindex",
    foot: `<p>Played WoW Forever with Lore Forever? <a href="/account#profile">Make your own profile</a>.</p>`,
    scripts: owner ? '<script src="/js/profile.js" defer></script>' : "",
  });
}

// /u/<handle> when there's no such profile, or it's private.
export function missingPage(handle) {
  return page({
    title: "No profile here",
    description: "This Lore Forever profile doesn't exist, or its owner keeps it private.",
    path: "/u/" + slug(handle),
    crumbs: '<a href="/">Lore Forever</a> &rsaquo; Profile',
    body: `  <h1>No profile here</h1>
  <p class="pitch">This profile doesn't exist, or its owner keeps it private.</p>
  <p class="vp-actions"><a class="btn-small" href="/account#profile">Make your own profile</a> <a class="btn-small" href="/">What's Lore Forever?</a></p>`,
    robots: "noindex",
    foot: "",
    scripts: "",
  });
}

export const publicLinks = user => linkList(user?.links);
