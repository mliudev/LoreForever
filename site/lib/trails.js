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

import { escape } from "./voices.js";

export const LINKS = "/lore/data/links.json";
export const RECENT = 25;   // moments shown before "Show N earlier moments"

// ---- Names -> pages ----

// A name as matched: no accents, case, quotes or "(Northshire)"-style notes, one kind of apostrophe.
export const norm = s => String(s ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/\s*\([^)]*\)\s*$/, "").replace(/[‘’`´]/g, "'").replace(/["“”«»]/g, "").replace(/\s+/g, " ").trim();

// Lookups over links.json (null: none, so nothing links). quest(title, zone, nth): the nth time (from 0) the record
// finished a quest of that title, turned in in `zone`. Quests that share a title are told apart by the zone, and a
// storyline's same-titled chapters (The Defias Brotherhood) by nth, in chapter order: a record cut short counts too
// few, so it can only ever land on an earlier chapter, never one the player hasn't done.
export function linker(data) {
  const zones = new Map(), places = new Map(), people = new Map(), quests = new Map();
  const ok = a => Array.isArray(a) ? a : [];
  for (const [name, zone, p] of ok(data?.places)) {
    if (!zone) zones.set(norm(name), p);
    else places.set(`${norm(name)}|${norm(zone)}`, p);
  }
  for (const [name, p] of ok(data?.people)) if (!people.has(norm(name))) people.set(norm(name), p);
  for (const [title, zone, p, giver, sl] of ok(data?.quests)) {
    const k = norm(title);
    if (!quests.has(k)) quests.set(k, []);
    quests.get(k).push({ p, zone: norm(zone), giver: giver || null, sl: sl || 0 });
  }
  const lines = ok(data?.storylines);
  return {
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

// The filter chip each section is under.
const GROUP = { places: "places", quests: "quests", people: "people", bosses: "foes", kills: "foes", loot: "finds",
  deaths: "deaths", levels: "more", mounts: "more", rep: "more", books: "more" };
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
// reward (an item's quest), avenged (a death's killer, beaten later)}. Profiles saved before LOR-248 have no
// timeline: none.
export function moments(d, names = linker(null)) {
  const out = [];
  const seen = new Map();   // quest title -> times finished so far
  for (const t of Array.isArray(d?.timeline) ? d.timeline : []) {
    const [k, i, day] = Array.isArray(t) ? t : [];
    const e = Object.hasOwn(GROUP, k) && Array.isArray(d[k]) && Number.isInteger(i) ? d[k][i] : null;
    if (!e || typeof e !== "object") continue;
    const m = { o: out.length, k, group: GROUP[k], day: typeof day === "string" && /^\d{4}-\d\d-\d\d$/.test(day) ? day : null, e,
                here: placeKey(e) };
    if (k === "quests") {
      const n = seen.get(norm(e.title)) || 0;
      seen.set(norm(e.title), n + 1);
      m.quest = names.quest(e.title, e.zone, n);
    }
    out.push(m);
  }

  for (const visits of revisits(out).values()) {
    visits.forEach((visit, j) => {
      for (const m of visit) { m.prevHere = visits[j - 1]?.at(-1) || null; m.nextHere = visits[j + 1]?.[0] || null; }
    });
  }
  const met = new Map();
  for (const m of out) if (m.k === "people" && !met.has(norm(m.e.name))) met.set(norm(m.e.name), m);
  const quests = out.filter(m => m.k === "quests");
  for (const m of quests) {
    m.giver = m.quest?.giver || null;
    m.met = m.giver ? met.get(norm(m.giver)) || null : null;
    m.story = m.quest?.sl ? names.storyline(m.quest.sl) : null;
  }
  for (const list of byKey(quests.filter(m => m.story), m => m.quest.sl).values()) {
    list.forEach((m, j) => { m.prevStory = list[j - 1] || null; m.nextStory = list[j + 1] || null; });
  }
  const gave = byKey(quests, m => m.giver && norm(m.giver));
  const finished = byKey(quests, m => norm(m.e.title));
  const beaten = byKey(out.filter(m => m.k === "kills" || m.k === "bosses"), m => norm(m.e.name));
  for (const m of out) {
    if (m.k === "people") m.gave = gave.get(norm(m.e.name)) || [];
    if (m.k === "loot" && m.e.quest) {
      const done = finished.get(norm(m.e.quest)) || [];
      m.reward = [...done].reverse().find(q => q.o <= m.o) || done[0] || null;
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
export function journeySection(list, { lore = null } = {}) {
  if (!list.length) return "";
  const a = (text, p) => (lore && p ? `<a href="${escape(p)}">${escape(text)}</a>` : escape(text));
  const name = (text, p) => (lore && p ? `<a href="${escape(p)}">${escape(text)}</a>` : `<strong>${escape(text)}</strong>`);
  const where = e => (e.zone ? (e.sub ? `${a(e.sub, lore?.place(e.sub, e.zone))}, ${a(e.zone, lore?.zone(e.zone))}` : a(e.zone, lore?.zone(e.zone))) : "");
  const go = (to, text, label) => `<a class="pf-go" href="#m-${to.o}" aria-label="${escape(`${label}: ${plain(to)}`)}">${text}</a>`;

  function what(m) {
    const e = m.e;
    switch (m.k) {
      case "places": return `${e.dungeon ? "Entered" : "Reached"} <strong>${where(e)}</strong>`;
      case "quests": return `Finished ${name(e.title, m.quest?.p)}`;
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
    if (m.giver) {
      out.push(m.met ? `Taken from ${go(m.met, escape(m.giver), `Met ${m.giver}`)}` : `Taken from ${a(m.giver, lore?.person(m.giver))}`);
    }
    if (m.story) {
      // Mike's wording for storylines: just "Storyline · <zone>: <name>", no step numbers.
      const steps = [m.prevStory && go(m.prevStory, "&larr; earlier", "Earlier in this storyline"),
        m.nextStory && go(m.nextStory, "later &rarr;", "Later in this storyline")].filter(Boolean);
      out.push(`<span class="pf-sl">Storyline &middot; ${escape([m.story.zone, m.story.name].filter(Boolean).join(": "))}</span>${steps.length ? " " + steps.join(" ") : ""}`);
    }
    if (m.gave?.length) {
      const shown = m.gave.slice(0, 2).map(q => go(q, escape(q.e.title), "Their quest"));
      out.push(`Their quests: ${shown.join(", ")}${m.gave.length > 2 ? ` and ${count(m.gave.length - 2)} more` : ""}`);
    }
    if (m.k === "loot" && m.e.quest) out.push(`Reward for ${m.reward ? go(m.reward, escape(m.e.quest), "The quest") : escape(m.e.quest)}`);
    if (m.avenged) out.push(go(m.avenged, "Beaten later", `Beat ${m.e.by} later`));
    const here = [m.prevHere && go(m.prevHere, "&larr; Last time here", "Last time here"),
      m.nextHere && go(m.nextHere, "Next time here &rarr;", "Next time here")].filter(Boolean);
    out.push(...here);
    return out.length ? `\n          <p class="pf-trail">${out.join(dot)}</p>` : "";
  }

  const row = m => `<li class="pf-m pf-k-${m.k}" id="m-${m.o}" data-g="${m.group}" tabindex="-1">
          <span class="pf-bead" aria-hidden="true"></span>
          <div><p class="pf-m-what">${what(m)}</p>${m.k !== "places" && m.e.zone ? `\n          <p class="pf-m-where">${where(m.e)}</p>` : ""}${trail(m)}</div>
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
  return `<section class="vp-section pf-journey" id="journey" aria-labelledby="journey-title">
    <h2 id="journey-title">The journey, moment by moment</h2>
    <p class="pf-lead">Newest first. Follow a trail from any moment to the ones it ties in with${lore ? ", or open its lore" : ""}.</p>
    ${chips}
    ${days(newest.slice(0, RECENT))}
    ${older.length ? `<details class="pf-older"><summary>Show ${count(older.length)} earlier moment${older.length === 1 ? "" : "s"}</summary>
    ${days(older)}
    </details>` : ""}
  </section>`;
}
