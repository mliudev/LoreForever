// Click trails and lore links on a player profile (LOR-248), the site's take on the add-on's Journey tab (LOR-242):
// the record's moments in time order (lib/journey.js keeps them as `timeline`), each linked to its lore page and to
// the moments it's tied to: where the same place comes up again, who gave a quest (and when the player met them),
// the rest of a storyline the player followed, the quest an item was the reward for, and the foe that killed them
// and was beaten later. A trail only ever links moments the record has, so it never leads past what the player did.
// Used by lib/profiles.js (the page) and functions/u/[handle].js. Kept outside functions/ so Pages doesn't route it.
//
// Lore links follow the "lore" site feature (lib/features.js): the lore pages are noindex and linked from nowhere
// until it's on, so until then a profile names things without linking them. Pages exist for zones, capitals,
// dungeons, places (subzones), characters, bosses and quests with dialogue (site/LORE_PAGES.md). Items, books, mounts
// and factions have none: those moments link the place they happened. The names come from
// public/lore/data/links.json (pipeline/lore/site_lore.py profile_links) and are matched by name, as the record has
// no IDs; the lore pages are in English, so a record in another language links only the names that read the same.
//
// Links out (LOR-263): each moment also links what it names on Wowhead's WoW Forever database, by the game ID
// links.json has for the name (refs), else the Warcraft Wiki's search. Those are other sites, not our unreleased
// pages, so they show whatever the "lore" feature says.

import { escape } from "./voices.js";
import { wowheadUrl, wikiSearch } from "./lore.js";

export const LINKS = "/lore/data/links.json";
export const RECENT = 25;   // moments shown before "Show N earlier moments"

// ---- Names -> pages ----

// A name as matched: no accents, case, quotes or "(Northshire)"-style notes, one kind of apostrophe.
export const norm = s => String(s ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/\s*\([^)]*\)\s*$/, "").replace(/[‘’`´]/g, "'").replace(/["“”«»]/g, "").replace(/\s+/g, " ").trim();

// Zone names in records that are inside a land of the road chart (lib/roadchart.js), or another name for one: buildings
// the game names instead of their zone (a tower, a town hall, an inn), the Barrens' cave outside the dungeon, Dalaran in
// the Alterac Mountains, and the Stockade under its WoW Forever name. All seen in profiles' records (10/5). A moment
// keeps the name it was recorded with; this only says which land it counts for on the chart and its filter.
const IN_LAND = new Map(Object.entries({
  "Sentinel Tower": "Westfall", "Lakeshire Town Hall": "Redridge Mountains", "Lakeshire Inn": "Redridge Mountains",
  "Darkshire Town Hall": "Duskwood", "Scarlet Raven Tavern": "Duskwood", "Deepwater Tavern": "Wetlands",
  "The Wailing Caverns": "The Barrens", "Dalaran": "Alterac Mountains", "Stormwind Stockade": "The Stockade",
}).map(([name, land]) => [norm(name), land]));
export const landOf = zone => IN_LAND.get(norm(zone)) ?? zone;

// Lookups over links.json (null: none, so nothing links). quest(title, zone, nth): the nth time (from 0) the record
// finished a quest of that title, turned in in `zone`. Quests that share a title are told apart by the zone, and a
// storyline's same-titled chapters (The Defias Brotherhood) by nth, in chapter order: a record cut short counts too
// few, so it can only ever land on an earlier chapter, never one the player hasn't done.
export function linker(data) {
  const zones = new Map(), places = new Map(), people = new Map(), quests = new Map(), byId = new Map();
  const ok = a => Array.isArray(a) ? a : [];
  for (const [name, zone, p] of ok(data?.places)) {
    if (!zone) zones.set(norm(name), p);
    else places.set(`${norm(name)}|${norm(zone)}`, p);
  }
  for (const [name, p] of ok(data?.people)) if (!people.has(norm(name))) people.set(norm(name), p);
  for (const [title, zone, p, giver, sl] of ok(data?.quests)) {
    const k = norm(title);
    if (!quests.has(k)) quests.set(k, []);
    const q = { p, zone: norm(zone), giver: giver || null, sl: sl || 0 };
    quests.get(k).push(q);
    const id = /^\/lore\/quest\/(\d+)-/.exec(String(p))?.[1];
    if (id) byId.set(Number(id), q);
  }
  const lines = ok(data?.storylines);
  const refs = {};   // kind -> Map(name -> game ID), for links out to Wowhead (LOR-263)
  for (const kind of ["npc", "item", "zone", "faction"]) {
    refs[kind] = new Map(ok(data?.refs?.[kind]).filter(r => Number.isInteger(r?.[1])).map(([name, id]) => [norm(name), id]));
  }
  return {
    // "npc=639" for a name of that kind, or null.
    ref: (kind, name) => (refs[kind]?.has(norm(name)) ? `${kind}=${refs[kind].get(norm(name))}` : null),
    zone: z => zones.get(norm(z)) ?? null,
    place: (sub, zone) => places.get(`${norm(sub)}|${norm(zone)}`) ?? null,
    person: name => people.get(norm(name)) ?? null,
    quest(title, zone, nth = 0) {
      const all = quests.get(norm(title));
      if (!all) return null;
      let pool = all;
      if (all.length > 1 && !all.every(q => q.sl && q.sl === all[0].sl)) {
        pool = all.filter(q => q.zone === norm(zone));
        if (!pool.length) return null;   // the same title in other zones, none here: can't tell which
      }
      return pool[Math.min(nth, pool.length - 1)];
    },
    // A quest by its ID (the companion's journey has them), or null when it has no lore page.
    questById: id => byId.get(id) ?? null,
    storyline: n => (lines[n - 1] ? { name: lines[n - 1][0], zone: lines[n - 1][1] } : null),
  };
}

// The lookups for this deploy: links.json through ASSETS, read once per isolate. Without it (tests, a broken
// deploy) nothing links and the trails that need it (quest givers, storylines) are left out.
const cache = new WeakMap();
export async function loadLinks(env, request) {
  const assets = env?.ASSETS;
  if (!assets) return linker(null);
  if (cache.has(assets)) return cache.get(assets);
  try {
    const res = await assets.fetch(new URL(LINKS, request.url));
    if (res.ok) {
      const l = linker(await res.json());
      cache.set(assets, l);
      return l;
    }
  } catch (e) {}
  return linker(null);
}

// ---- The moments and their trails ----

// The filter chip each section is under. "taken" (a quest taken) comes only from the companion's journey.
const GROUP = { places: "places", quests: "quests", taken: "quests", people: "people", bosses: "foes", kills: "foes",
  loot: "finds", deaths: "deaths", levels: "more", mounts: "more", rep: "more", books: "more" };
export const SHOWN = 600;   // moments on the page at most (the newest); the road chart uses them all

const isDay = day => typeof day === "string" && /^\d{4}-\d\d-\d\d$/.test(day);

// The record's moments (lib/journey.js timeline), as {k, e, day}.
function fromRecord(d) {
  const out = [];
  for (const t of Array.isArray(d?.timeline) ? d.timeline : []) {
    const [k, i, day] = Array.isArray(t) ? t : [];
    const e = Object.hasOwn(GROUP, k) && k !== "taken" && Array.isArray(d[k]) && Number.isInteger(i) ? d[k][i] : null;
    if (e && typeof e === "object") out.push({ k, e, day: isDay(day) ? day : null });
  }
  return out;
}

// The companion's journey (lib/journey.js readJourney) as the same {k, e, day}, its entries shaped like the record's
// plus the game IDs (e.id: a quest's; e.qid: the quest an item rewarded) and how a place was reached (e.how).
const STANDINGS = ["Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"];
function fromJourney(j) {
  const offset = value => Number.isInteger(value) && Math.abs(value) <= 840 ? value : null;
  const out = [];
  for (const m of Array.isArray(j?.moments) ? j.moments : []) {
    if (!m || typeof m !== "object" || !Number.isInteger(m.t)) continue;
    const at = { ...(m.s && m.s !== m.z ? { sub: m.s } : {}), ...(m.z ? { zone: m.z } : {}) };
    const entry = {
      zone: () => ["places", { ...at, ...(m.inst ? { dungeon: true } : {}), ...(m.how ? { how: m.how } : {}) }],
      qt: () => ["quests", { title: m.n || `Quest ${m.id}`, id: m.id, ...at }],
      qa: () => ["taken", { title: m.n || `Quest ${m.id}`, id: m.id, ...at }],
      npc: () => ["people", { name: m.n, ...at }], boss: () => ["bosses", { name: m.n, ...at }],
      kill: () => ["kills", { name: m.n, rank: m.cls || null, ...at }], lvl: () => ["levels", { level: m.lv, ...at }],
      death: () => ["deaths", { ...at, ...(m.by ? { by: m.by } : {}) }], book: () => ["books", { title: m.n, ...at }],
      loot: () => ["loot", { name: m.n, quality: Number.isInteger(m.ql) ? m.ql : null, ...(m.qid ? { reward: true, qid: m.qid } : {}), ...at }],
      mount: () => ["mounts", { name: m.n, ...at }],
      rep: () => ["rep", { faction: m.n, standing: STANDINGS[m.st - 1] || "?", ...at }],
    }[m.k];
    if (!entry) continue;
    const [k, e] = entry();
    const tz = (offset(m.tz) ?? offset(j?.tz) ?? 0) * 60;
    out.push({ k, e, t: m.t, day: new Date((m.t + tz) * 1000).toISOString().slice(0, 10) });
  }
  return out;
}
const CHIPS = [["places", "Places"], ["quests", "Quests"], ["people", "People"], ["foes", "Foes"], ["finds", "Finds"],
  ["deaths", "Deaths"], ["more", "More"]];

const placeKey = e => (e?.zone ? (e.sub ? `${norm(e.sub)}|${norm(e.zone)}` : norm(e.zone)) : null);

const byKey = (list, key) => {
  const out = new Map();
  for (const m of list) {
    const k = key(m);
    if (k === null || k === undefined || k === "") continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(m);
  }
  return out;
};

// Where a moment links out (LOR-263): {site: "Wowhead"|"Warcraft Wiki", url, name}: its Wowhead page when the game ID
// of what it names is known (a quest by its lore page's ID; a person, foe, item, zone or faction by name), else the
// wiki's search for that name (it opens the article when one has the name). A level-up and a death without a killer
// name nothing to look up.
function lookUp(m, names) {
  const e = m.e;
  const what = {
    places: () => (e.sub ? [null, e.sub] : [names.ref("zone", e.zone), e.zone]),
    quests: () => {
      const id = Number.isInteger(e.id) ? e.id : /^\/lore\/quest\/(\d+)/.exec(m.quest?.p || "")?.[1];
      return [id ? `quest=${id}` : null, e.title];
    },
    taken: () => [Number.isInteger(e.id) ? `quest=${e.id}` : null, e.title],
    people: () => [names.ref("npc", e.name), e.name], bosses: () => [names.ref("npc", e.name), e.name],
    kills: () => [names.ref("npc", e.name), e.name], loot: () => [names.ref("item", e.name), e.name],
    rep: () => [names.ref("faction", e.faction), e.faction], books: () => [null, e.title], mounts: () => [null, e.name],
    deaths: () => (e.by ? [names.ref("npc", e.by), e.by] : [null, null]), levels: () => [null, null],
  }[m.k];
  const [ref, name] = what ? what() : [null, null];
  const wowhead = wowheadUrl(ref);
  if (wowhead) return { site: "Wowhead", url: wowhead, name };
  const wiki = wikiSearch(name);
  return wiki ? { site: "Warcraft Wiki", url: wiki, name } : null;
}

// The visits to each place: {place key: [[moments of one visit], ...]}. A visit ends at a moment somewhere else:
// another zone, or another place in the same zone (a moment that names only the zone, like most level-ups, doesn't
// end one). So "Last time here" skips the moments right before it and leads back to when the player was here before.
function revisits(list) {
  const places = new Map(), open = new Set();
  for (const m of list) {
    if (!m.here) continue;
    const zone = norm(m.e.zone), sub = Boolean(m.e.sub);
    for (const k of open) {
      const p = places.get(k);
      if (k !== m.here && (p.zone !== zone || (p.sub && sub))) open.delete(k);
    }
    if (!places.has(m.here)) places.set(m.here, { zone, sub, visits: [] });
    const p = places.get(m.here);
    if (!open.has(m.here)) { p.visits.push([]); open.add(m.here); }
    p.visits.at(-1).push(m);
  }
  return new Map([...places].map(([k, p]) => [k, p.visits]));
}

// The record's moments in time order: {o (its number on the page), k (section), group, day, e (the entry), quest
// (links.json's, for a quest), here (where it happened, matched), and its trails: prevHere/nextHere (the last moment
// of the visit before to the same place, the first of the next one),
// giver/met (who gave a quest, their "Met" moment), story/prevStory/nextStory (a storyline), gave (a person's quests),
// reward (an item's quest), avenged (a death's killer, beaten later), and from the companion's journey taken/done (a
// quest's moment where it was taken, and the one where it was turned in, by ID)}. journey: the companion's data
// (readJourney), which replaces the record's moments when the profile has it. Profiles saved before LOR-248 have no
// timeline: none.
export function moments(d, names = linker(null), journey = null) {
  const out = [];
  const seen = new Map();   // quest title -> times finished so far
  const fromCompanion = Array.isArray(journey?.moments) && journey.moments.length > 0;
  for (const { k, e, day, t } of fromCompanion ? fromJourney(journey) : fromRecord(d)) {
    const m = { o: out.length, k, group: GROUP[k], day, e, here: placeKey(e), ...(t ? { t } : {}) };
    if (k === "quests" || k === "taken") {
      if (Number.isInteger(e.id)) m.quest = names.questById(e.id) || { id: e.id };
      else {
        const n = seen.get(norm(e.title)) || 0;
        seen.set(norm(e.title), n + 1);
        m.quest = names.quest(e.title, e.zone, n);
      }
    }
    m.out = lookUp(m, names);
    out.push(m);
  }
  // A quest taken and turned in, by ID: each turn-in's latest taking before it.
  const taken = new Map();
  for (const m of out) {
    if (m.k === "taken") taken.set(m.e.id, m);
    else if (m.k === "quests" && Number.isInteger(m.e.id) && taken.has(m.e.id)) {
      m.taken = taken.get(m.e.id);
      m.taken.done = m;
      taken.delete(m.e.id);
    }
  }

  for (const visits of revisits(out).values()) {
    visits.forEach((visit, j) => {
      for (const m of visit) { m.prevHere = visits[j - 1]?.at(-1) || null; m.nextHere = visits[j + 1]?.[0] || null; }
    });
  }
  const met = new Map();
  for (const m of out) if (m.k === "people" && !met.has(norm(m.e.name))) met.set(norm(m.e.name), m);
  const quests = out.filter(m => m.k === "quests");
  for (const m of out.filter(m => m.k === "quests" || m.k === "taken")) {
    m.giver = m.quest?.giver || null;
    m.met = m.giver ? met.get(norm(m.giver)) || null : null;
    m.story = m.k === "quests" && m.quest?.sl ? names.storyline(m.quest.sl) : null;
  }
  for (const list of byKey(quests.filter(m => m.story), m => m.quest.sl).values()) {
    list.forEach((m, j) => { m.prevStory = list[j - 1] || null; m.nextStory = list[j + 1] || null; });
  }
  const gave = byKey(quests, m => m.giver && norm(m.giver));
  const finished = byKey(quests, m => norm(m.e.title));
  const beaten = byKey(out.filter(m => m.k === "kills" || m.k === "bosses"), m => norm(m.e.name));
  for (const m of out) {
    if (m.k === "people") m.gave = gave.get(norm(m.e.name)) || [];
    if (m.k === "loot" && (m.e.quest || m.e.qid)) {
      const done = m.e.qid ? quests.filter(q => q.e.id === m.e.qid) : finished.get(norm(m.e.quest)) || [];
      m.reward = [...done].reverse().find(q => q.o <= m.o) || done[0] || null;
      if (m.reward && !m.e.quest) m.e.quest = m.reward.e.title;
    }
    if (m.k === "deaths" && m.e.by) m.avenged = (beaten.get(norm(m.e.by)) || []).find(x => x.o > m.o) || null;
  }
  return out;
}

// ---- The page section ----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayText = day => {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(day || "");
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : "";
};
const count = n => String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const RANK = { elite: "elite", rare: "rare", rareelite: "rare elite", worldboss: "world boss" };

// A moment in a few plain words, for a trail link's label: "Met Gryan Stoutmantle, Sep 21, 2026".
function plain(m) {
  const e = m.e;
  const what = {
    places: () => `${e.dungeon ? "Entered" : "Reached"} ${e.sub || e.zone}`, quests: () => `Finished ${e.title}`,
    taken: () => `Took on ${e.title}`,
    people: () => `Met ${e.name}`, bosses: () => `Defeated ${e.name}`, kills: () => `Defeated ${e.name}`,
    loot: () => `${e.reward ? "Earned" : "Found"} ${e.name}`, levels: () => `Reached level ${e.level}`,
    mounts: () => `New mount: ${e.name}`, rep: () => `${e.standing} with ${e.faction}`, books: () => `Read ${e.title}`,
    deaths: () => (e.by ? `Slain by ${e.by}` : "Died"),
  }[m.k]();
  return [what, dayText(m.day)].filter(Boolean).join(", ");
}

// The section: the moments newest first, by day, the latest RECENT open and the rest folded; filter chips (shown by
// public/js/journey.js); each moment's lore links (lore: lookups to link with, or null while the lore pages are off)
// and trail links (#m-<o>, which journey.js follows: it unfolds, unfilters and marks the moment).
export function journeySection(all, { lore = null } = {}) {
  if (!all.length) return "";
  // A long journey from the companion shows its newest SHOWN moments; a trail to one before them is just its name.
  const list = all.length > SHOWN ? all.slice(-SHOWN) : all;
  const first = list[0].o;
  const a = (text, p) => (lore && p ? `<a href="${escape(p)}">${escape(text)}</a>` : escape(text));
  const name = (text, p) => (lore && p ? `<a href="${escape(p)}">${escape(text)}</a>` : `<strong>${escape(text)}</strong>`);
  const where = e => (e.zone ? (e.sub ? `${a(e.sub, lore?.place(e.sub, e.zone))}, ${a(e.zone, lore?.zone(e.zone))}` : a(e.zone, lore?.zone(e.zone))) : "");
  // A trail link, or "" when its moment isn't on the page (then a name shows as plain text, and a step is left out).
  const go = (to, text, label) => (to && to.o >= first
    ? `<a class="pf-go" href="#m-${to.o}" aria-label="${escape(`${label}: ${plain(to)}`)}">${text}</a>` : "");
  const placeName = e => escape(e.sub || e.zone || "somewhere");

  function what(m) {
    const e = m.e;
    switch (m.k) {
      case "places": return `${e.dungeon ? "Entered" : "Reached"} <strong>${where(e)}</strong>`;
      case "quests": return `Finished ${name(e.title, m.quest?.p)}`;
      case "taken": return `Took on ${name(e.title, m.quest?.p)}`;
      case "people": return `Met ${name(e.name, lore?.person(e.name))}`;
      case "bosses": return `Defeated ${name(e.name, lore?.person(e.name))}`;
      case "kills": return `Defeated ${name(e.name, lore?.person(e.name))}${Object.hasOwn(RANK, e.rank ?? "") ? ` <span class="pf-rank">${RANK[e.rank]}</span>` : ""}`;
      case "loot": return `${e.reward ? "Earned" : "Found"} <span class="pf-item${Number.isInteger(e.quality) ? ` q${Math.min(5, Math.max(0, e.quality))}` : ""}">${escape(e.name)}</span>`;
      case "levels": return `Reached <strong>level ${count(e.level)}</strong>`;
      case "mounts": return `New mount: <strong>${escape(e.name)}</strong>`;
      case "rep": return `<strong>${escape(e.standing)}</strong> with ${escape(e.faction)}`;
      case "books": return `Read <cite>${escape(e.title)}</cite>`;
      case "deaths": return e.by ? `Slain by ${name(e.by, lore?.person(e.by))}` : "Died";
    }
    return "";
  }

  const dot = ' <span aria-hidden="true">&middot;</span> ';
  function trail(m) {
    const out = [];
    // The companion's journey: where a quest was taken, and where it was turned in.
    if (m.taken) out.push(`Taken at ${go(m.taken, placeName(m.taken.e), "Where it was taken") || placeName(m.taken.e)}`);
    if (m.done) out.push(`Turned in at ${go(m.done, placeName(m.done.e), "Where it was turned in") || placeName(m.done.e)}`);
    if (m.giver) out.push(`Taken from ${go(m.met, escape(m.giver), `Met ${m.giver}`) || a(m.giver, lore?.person(m.giver))}`);
    if (m.story) {
      // Mike's wording for storylines: just "Storyline · <zone>: <name>", no step numbers.
      const steps = [m.prevStory && go(m.prevStory, "&larr; earlier", "Earlier in this storyline"),
        m.nextStory && go(m.nextStory, "later &rarr;", "Later in this storyline")].filter(Boolean);
      out.push(`<span class="pf-sl">Storyline &middot; ${escape([m.story.zone, m.story.name].filter(Boolean).join(": "))}</span>${steps.length ? " " + steps.join(" ") : ""}`);
    }
    if (m.gave?.length) {
      const shown = m.gave.slice(0, 2).map(q => go(q, escape(q.e.title), "Their quest") || escape(q.e.title));
      out.push(`Their quests: ${shown.join(", ")}${m.gave.length > 2 ? ` and ${count(m.gave.length - 2)} more` : ""}`);
    }
    if (m.k === "loot" && m.e.quest) out.push(`Reward for ${go(m.reward, escape(m.e.quest), "The quest") || escape(m.e.quest)}`);
    if (m.avenged && go(m.avenged, "", "")) out.push(go(m.avenged, "Beaten later", `Beat ${m.e.by} later`));
    const here = [m.prevHere && go(m.prevHere, "&larr; Last time here", "Last time here"),
      m.nextHere && go(m.nextHere, "Next time here &rarr;", "Next time here")].filter(Boolean);
    out.push(...here);
    return out.length ? `\n          <p class="pf-trail">${out.join(dot)}</p>` : "";
  }

  // A small link out after the moment (LOR-263): Wowhead, or the wiki.
  const out = m => (m.out ? ` <a class="pf-out" href="${escape(m.out.url)}" rel="noopener" aria-label="${escape(`${m.out.name} on ${m.out.site === "Wowhead" ? "Wowhead" : "the Warcraft Wiki"}`)}">${m.out.site === "Wowhead" ? "Wowhead" : "Wiki"}</a>` : "");
  const row = m => `<li class="pf-m pf-k-${m.k}" id="m-${m.o}" data-g="${m.group}"${m.e.zone ? ` data-land="${escape(norm(landOf(m.e.zone)))}"` : ""} tabindex="-1">
          <span class="pf-bead" aria-hidden="true"></span>
          <div><p class="pf-m-what">${what(m)}${out(m)}</p>${m.k !== "places" && m.e.zone ? `\n          <p class="pf-m-where">${where(m.e)}</p>` : ""}${trail(m)}</div>
        </li>`;
  const days = ms => {
    const out = [];
    for (const m of ms) {
      if (!out.length || out[out.length - 1].day !== m.day) out.push({ day: m.day, ms: [] });
      out[out.length - 1].ms.push(m);
    }
    return `<ol class="pf-days">${out.map(g => `
      <li class="pf-day"><h3 class="pf-date">${dayText(g.day) || "Date not recorded"}</h3>
        <ol class="pf-moments">
        ${g.ms.map(row).join("\n        ")}
        </ol></li>`).join("")}
    </ol>`;
  };
  const newest = [...list].reverse();
  const older = newest.slice(RECENT);
  const groups = CHIPS.filter(([g]) => list.some(m => m.group === g));
  const chips = groups.length > 1 ? `<div class="pf-filter" role="group" aria-label="Show only" hidden>
      <button type="button" data-f="" aria-pressed="true">All <span class="pf-n">${count(list.length)}</span></button>
      ${groups.map(([g, label]) => `<button type="button" data-f="${g}" aria-pressed="false">${label} <span class="pf-n">${count(list.filter(m => m.group === g).length)}</span></button>`).join("\n      ")}
    </div>
    <p class="pf-shown" role="status"></p>` : "";
  return `<section class="vp-section pf-journey pf-view" id="timeline" aria-labelledby="journey-title">
    <h2 id="journey-title">The journey, moment by moment</h2>
    <p class="pf-lead">Newest first. Follow a trail from any moment to the ones it ties in with${lore ? ", or open its lore" : ""}.${all.length > list.length ? ` The latest ${count(list.length)} of ${count(all.length)} moments.` : ""}</p>
    ${chips}
    ${days(newest.slice(0, RECENT))}
    ${older.length ? `<details class="pf-older"><summary>Show ${count(older.length)} earlier moment${older.length === 1 ? "" : "s"}</summary>
    ${days(older)}
    </details>` : ""}
  </section>`;
}
