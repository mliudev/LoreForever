#!/usr/bin/env node
// Writes site/lib/home-book-data.js: what the home book (lib/home-book.js, public/js/home-book.js) takes from the
// add-on itself, read from what it ships (addon/LoreForever/Data, made by pipeline/lore/compile_lua.py):
// - HERE: the add-on's Here list for one place: its top questions with the add-on's answers, ranked as the add-on ranks
//   them (Engine.RankedFaq: no spoilers or gameplay questions, the player's race only, then by intent), each answer
//   linking the lore pages it names (site/public/lore/data/index.json). The place's story and its recording are read
//   live from its lore page data, so only the questions are kept here.
// - CHAPTERS: each zone's pages in the add-on's Found tab, by kind, as Book.Index counts them ("Places 2 of 22"), with
//   the quests split by faction (a player's totals leave out the other faction's quests).
// Run it again when the add-on's lore changes:
//   node site/scripts/home-book-data.mjs [zone] [race]        (defaults: stormwind Human)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const DATA = new URL("addon/LoreForever/Data/", ROOT);
const [zone = "stormwind", race = "Human"] = process.argv.slice(2);
const KEY = `zone:${zone}`;
const ASKS = 4;   // the Here list's questions

// Engine.lua INTENT_RANK.
const RANK = { arrival: 1, purpose: 2, motive: 1, item: 2, why_me: 3, place: 3, in_charge: 4, target: 4, threat: 5,
  people: 6, history: 6, next_step: 7, identity: 2, for_you: 2, conflict: 2, power: 3, wants: 3, hostile: 3, fame: 3,
  origin: 3, why_wanted: 3, side: 4, why_here: 4, today: 4, leader: 5, allies: 5, residents: 5, ruin: 5, danger: 6,
  ties: 6, name: 7 };
// Book.lua KIND: an entry's type -> its kind of page in Found.
const KIND = { zone: "places", city: "places", dungeon: "places", subzone: "places", npc: "people", item: "items", quest: "quests" };

const unq = s => s.replace(/\\(.)/g, (_, c) => ({ n: "\n", t: "\t" }[c] ?? c));
const str = (body, field) => { const m = new RegExp(`(?:^|[{,])${field}="((?:[^"\\\\]|\\\\.)*)"`).exec(body); return m ? unq(m[1]) : null; };

// ---- Here ----
const lua = readFileSync(new URL(`Z_${zone}.lua`, DATA), "utf8");
const line = lua.split("\n").find(l => l.startsWith(`E["${KEY}"] = `));
if (!line) throw new Error(`no ${KEY} in Z_${zone}.lua`);
const name = str(line, "n");

// The faq={...} list: its {q=...,a=...} tables, split at the top level.
const faq = [];
const at = line.indexOf("faq={");
for (let i = at + 5, depth = 0, start = -1, quoted = false; i < line.length; i++) {
  const c = line[i];
  if (quoted) { if (c === "\\") i++; else if (c === '"') quoted = false; continue; }
  if (c === '"') quoted = true;
  else if (c === "{") { if (depth++ === 0) start = i; }
  else if (c === "}") { if (depth === 0) break; if (--depth === 0) faq.push(line.slice(start + 1, i)); }
}
const raceKey = s => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const asks = faq.map((body, i) => ({ i, q: str(body, "q"), a: str(body, "a"), it: str(body, "it"), rc: str(body, "rc"),
  sp: /(?:^|,)sp=1/.test(body), gp: /(?:^|,)gp=/.test(body), untr: /(?:^|,)untr=/.test(body) }))
  .filter(f => f.q && f.a && !f.sp && !f.gp && (!f.rc || raceKey(f.rc) === raceKey(race)))
  .sort((x, y) => (x.untr - y.untr) || ((RANK[x.it] ?? 9) - (RANK[y.it] ?? 9)) || (x.i - y.i))
  .slice(0, ASKS);

// The lore pages an answer names: people, places and topics, the longest names first, each once, never this page.
const pages = JSON.parse(readFileSync(new URL("site/public/lore/data/index.json", ROOT), "utf8")).pages
  .filter(p => ["npc", "boss", "zone", "subzone", "dungeon", "topic"].includes(p.k) && p.n !== name && p.n.length > 3)
  .sort((x, y) => y.n.length - x.n.length);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function links(text) {
  const out = [], taken = [];
  for (const p of pages) {
    const m = new RegExp(`(?<![\\p{L}'])${esc(p.n)}(?![\\p{L}])`, "u").exec(text);
    if (!m || out.some(l => l.name === p.n)) continue;
    const span = [m.index, m.index + p.n.length];
    if (taken.some(([a, b]) => span[0] < b && a < span[1])) continue;
    taken.push(span);
    out.push({ name: p.n, href: p.p });
  }
  return out;
}
const here = { key: KEY, name, page: `/lore/zone/${zone}`, race, asks: asks.map(f => ({ q: f.q, a: f.a, links: links(f.a) })) };

// ---- Found's chapters ----
const zoneNames = {};
for (const m of readFileSync(new URL("Index.lua", DATA), "utf8").matchAll(/(?:\{|,)(\w+)=\{n="((?:[^"\\]|\\.)*)",t="(\w+)"/g)) {
  zoneNames[m[1]] ??= unq(m[2]);
}
const chapters = {};
for (const file of readdirSync(DATA).filter(f => /^Z_.+\.lua$/.test(f)).sort()) {
  for (const l of readFileSync(new URL(file, DATA), "utf8").split("\n")) {
    const m = /^E\["[^"]+"\] = \{t="(\w+)"/.exec(l);
    const kind = m && KIND[m[1]];
    const z = kind && str(l, "z");
    if (!z || !zoneNames[z]) continue;
    const c = chapters[zoneNames[z]] ??= { places: 0, people: 0, items: 0, quests: [0, 0, 0] };
    if (kind !== "quests") { c[kind]++; continue; }
    const f = (/faction="(\w+)"/.exec(l)?.[1] || "").toLowerCase();
    c.quests[f === "alliance" ? 1 : f === "horde" ? 2 : 0]++;
  }
}

const out = `// Generated by site/scripts/home-book-data.mjs from what the add-on ships (addon/LoreForever/Data); don't edit by hand.
// HERE: the add-on's top questions at ${name}, with its answers (the home book's Here tab). CHAPTERS: each zone's pages
// in the add-on's Found tab by kind (quests: [either side, Alliance only, Horde only]).
export const HERE = ${JSON.stringify(here, null, 2)};

export const CHAPTERS = ${JSON.stringify(chapters)};
`;
writeFileSync(new URL("site/lib/home-book-data.js", ROOT), out);
console.log(`${name}: ${here.asks.map(a => a.q).join(" | ")}`);
console.log(`${Object.keys(chapters).length} chapters; Westfall ${JSON.stringify(chapters.Westfall)}`);
