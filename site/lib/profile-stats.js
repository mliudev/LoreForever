// The journey in numbers on a player profile (LOR-246): how far the character walked, the foes they slew, deaths and
// time played, from the record's "Journey stats" (lib/journey.js statsOf; the add-on's tally, Journey.lua). It's
// their story and road, told for fun: no ranks, no comparing with other players, no combat detail. Bosses stay
// "Bosses defeated" on the page. Used by lib/profiles.js profilePage; empty for a record from an older add-on.
// Distance is told in steps (Mike, 2026-10-04), with miles or kilometres beside it: miles in the page, and Kilometres
// switches them all (public/js/units.js, remembered in the browser).

import { escape } from "./voices.js";

const MILE = 1760, MARATHON = 26.2 * MILE;   // yards
export const STEPS = 1.2;   // steps to the yard, a step of 2.5 feet: the add-on's JourneyRecord.lua counts the same
// A road each faction knows, roughly, in yards (the straight line between them in the world, plus the road's bends):
// for "the road from Goldshire to Booty Bay 3 times over". Fun, not a survey.
const ROADS = {
  alliance: { from: "Goldshire", to: "Booty Bay", yards: 6000 },
  horde: { from: "Orgrimmar", to: "the Crossroads", yards: 3000 },
};

const count = n => String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const times = (n, one, many = one + "s") => `${count(n)} ${n === 1 ? one : many}`;
const tenths = n => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
export const miles = yards => tenths(yards / MILE);
export const km = yards => tenths(yards * 0.9144 / 1000);
export const steps = yards => count(Math.round(yards * STEPS));
// A distance, in miles until the reader picks kilometres (public/js/units.js swaps the text).
const dist = yards => `<span class="pf-dist" data-mi="${miles(yards)} mi" data-km="${km(yards)} km">${miles(yards)} mi</span>`;

// "3 days 4 hours", "11 hours", "40 minutes".
export function duration(hours) {
  if (hours < 1) return times(Math.max(1, Math.round(hours * 60)), "minute");
  const h = Math.round(hours);
  if (h >= 48) return `${times(Math.floor(h / 24), "day")}${h % 24 ? ` ${times(h % 24, "hour")}` : ""}`;
  return times(h, "hour");
}

// How far, against a road the character's faction knows, or nothing when it's too short to say.
function roadLine(yards, factionKey) {
  const road = ROADS[factionKey] || ROADS.alliance;
  const n = yards / road.yards;
  const way = `the road from ${road.from} to ${road.to}`;
  if (n >= 2) return `That's ${way} ${n >= 10 ? count(Math.floor(n)) : tenths(Math.floor(n * 2) / 2)} times over.`;
  if (n >= 1) return `That's the whole of ${way}, and then some.`;
  if (n >= 0.5) return `That's most of ${way}.`;
  return null;
}

// The lines under the tiles, about the character in the third person.
export function funLines(d) {
  const s = d.stats, name = d.name, out = [];
  if (s.yards >= MILE / 10) {
    const road = roadLine(s.yards, d.factionKey);
    if (road) out.push(road);
    const marathons = Math.floor(s.yards / MARATHON);
    if (marathons) out.push(`More than ${marathons === 1 ? "a marathon" : times(marathons, "marathon")} on foot.`);
    const most = s.walk[0];
    if (most && s.walk.length > 1 && most.yards >= MILE / 10) out.push(`Walked the most in ${most.zone}: ${steps(most.yards)} steps.`);
  }
  if (s.slain > 0) {
    const different = d.totals?.foes > 1 && d.totals.foes < s.slain ? `, ${count(d.totals.foes)} different ones` : "";
    out.push(`${times(s.slain, "foe")} slain${different}.`);
    const top = s.kinds[0];
    if (top && top.n > 1) out.push(`The most common kind of foe: ${top.kind} (${count(top.n)}).`);
    if (s.deaths === 0) out.push(`Not a single death yet.`);
  }
  if (s.deaths > 0) out.push(`${times(s.deaths, "death")} along the way, each one a lesson for ${name}.`);
  // The land that claimed them most (LOR-262), from the deaths the record lists.
  const where = {};
  for (const x of d.deaths || []) if (x.zone) where[x.zone] = (where[x.zone] || 0) + 1;
  const [land, n] = Object.entries(where).sort((a, b) => b[1] - a[1])[0] || [];
  const often = k => k === 1 ? "once" : k === 2 ? "twice" : `${count(k)} times`;
  if (n > 1) out.push(`${land} claimed ${name} ${often(n)}${d.cut ? " (at least)" : ""}.`);
  // LOR-262: a nemesis, the sea, famous company, patrons, homes, fish, days, the story's length.
  const nemesis = s.killers?.[0];
  if (nemesis && nemesis.n > 1) out.push(`Nemesis: ${nemesis.name}, who slew ${name} ${often(nemesis.n)}.`);
  const drowned = (d.deaths || []).filter(x => x.cause === "drown" || x.cause === "fatigue").length;
  if (drowned) out.push(`The sea took ${name} ${often(drowned)}.`);
  const met = famous(d.people || []);
  if (met.length) out.push(`Has met ${listOf(met.slice(0, 4))}${met.length > 4 ? " and others of renown" : ""}.`);
  const patron = s.patrons?.[0];
  if (patron && patron.n > 1) out.push(`Most loyal patron: ${patron.name}, with ${times(patron.n, "quest")} done for them.`);
  const home = s.time?.[0];
  if (home && home.minutes >= 60) out.push(`Home is ${home.zone}: ${duration(home.minutes / 60)} spent there.`);
  if (s.inns?.length) out.push(`Has called ${listOf(s.inns.slice(0, 4).map(i => i.name))} home.`);
  if (s.fish > 0) out.push(`Caught ${times(s.fish, "fish", "fish")}.`);
  if (s.days > 1) out.push(`Played on ${times(s.days, "day")}${s.best > 1 ? `, ${count(s.best)} of them in a row at best` : ""}.`);
  if (s.played >= 24) out.push(`${tenths(s.played / 24)} days in Azeroth, all told.`);
  if (s.words >= 150) out.push(`${name}'s story so far would take about ${duration(s.words / 150 / 60)} to read aloud.`);
  if (s.heard > 0) out.push(`${times(s.heard, "narration")} heard along the way.`);
  return out;
}

const listOf = items => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

// Figures of renown of WoW Forever's time (after Warcraft III), as their names appear in the people a record met.
const FAMOUS = ["Thrall", "Cairne Bloodhoof", "Vol'jin", "Sylvanas Windrunner", "Varimathras", "Saurfang", "Eitrigg",
  "Rexxar", "Drek'Thar", "Jaina Proudmoore", "Bolvar Fordragon", "Katrana Prestor", "Anduin Wrynn", "Magni Bronzebeard",
  "Mekkatorque", "Tyrande Whisperwind", "Fandral Staghelm", "Vanndar Stormpike", "Mankrik"];
const FAMOUS_RE = new RegExp(`(^|\\s)(${FAMOUS.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);
function famous(people) {
  const out = [];
  for (const p of people) if (FAMOUS_RE.test(p.name) && !out.includes(p.name)) out.push(p.name);
  return out;
}

// "On this day" (LOR-262): what the character did a week, a month or a year ago today (the record's moments by day,
// lib/journey.js timeline), the most notable of that day. now: the page's time (UTC).
const AGO_ORDER = ["bosses", "levels", "mounts", "places", "kills", "quests", "people", "loot", "rep", "books", "deaths"];
function didThis(k, e) {
  switch (k) {
    case "bosses": return `defeated ${e.name}`;
    case "levels": return `reached level ${e.level}`;
    case "mounts": return `got the ${e.name}`;
    case "places": return e.dungeon ? `entered ${e.zone}` : `reached ${e.sub ? `${e.sub}, ${e.zone}` : e.zone}`;
    case "kills": return `defeated ${e.name}`;
    case "quests": return `finished "${e.title}"`;
    case "people": return `met ${e.name}`;
    case "loot": return `found ${e.name}`;
    case "rep": return `became ${e.standing} with ${e.faction}`;
    case "books": return `read "${e.title}"`;
    case "deaths": return e.zone ? `fell in ${e.zone}` : "fell";
  }
  return null;
}
export function onThisDay(d, now = new Date()) {
  if (!Array.isArray(d.timeline)) return null;
  const iso = t => t.toISOString().slice(0, 10);
  const back = (days, months, years) => {
    const t = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth() - months, now.getUTCDate() - days, 12));
    return days || t.getUTCDate() === now.getUTCDate() ? iso(t) : null;   // no "a month ago today" from the 31st
  };
  for (const [day, when] of [[back(7, 0, 0), "A week ago today"], [back(0, 1, 0), "A month ago today"],
                             [back(0, 0, 1), "A year ago today"]]) {
    if (!day) continue;
    let best = null;
    for (const [k, i, at] of d.timeline) {
      const rank = AGO_ORDER.indexOf(k), e = d[k]?.[i];
      if (at === day && rank >= 0 && e && (!best || rank <= best.rank)) best = { rank, k, e };   // the day's latest
    }
    const did = best && didThis(best.k, best.e);
    if (did) return `${when}, ${d.name} ${did}.`;
  }
  return null;
}

// The section, or "" when the record has no journey stats. now: the page's time, for "on this day".
export function numbersSection(d, now = new Date()) {
  const s = d?.stats;
  if (!s || !(s.yards > 0 || s.slain > 0 || s.recorded > 0 || s.played)) return "";
  const walking = s.yards >= 1, distances = walking || s.flown >= 1;
  const tiles = [
    walking && [steps(s.yards), "Steps walked", null, dist(s.yards)],
    [count(s.slain), "Foes slain"],
    s.elites > 0 && [count(s.elites), "Elites slain"],
    s.rares > 0 && [count(s.rares), "Rares slain"],
    s.played ? [duration(s.played), "Time played"] : s.recorded > 0 && [duration(s.recorded), "Time recorded",
      "Time played while Lore Forever kept the journey"],
    s.days > 0 && [count(s.days), "Days played"],
    s.fish > 0 && [count(s.fish), "Fish caught"],
  ].filter(Boolean).map(([n, label, title, more]) =>
    `<li${title ? ` title="${escape(title)}"` : ""}><strong>${escape(n)}</strong><span>${label}</span>${more ? `<span class="pf-sub">${more}</span>` : ""}</li>`).join("");
  const today = onThisDay(d, now);
  const fun = [...(today ? [today] : []), ...funLines(d)];
  const walked = s.walk.slice(0, 6).map(w => `${escape(w.zone)} <span class="pf-n">${steps(w.yards)} steps</span> <span class="pf-where">${dist(w.yards)}</span>`);
  const kinds = s.kinds.slice(0, 6).map(k => `${escape(k.kind)} <span class="pf-n">${count(k.n)}</span>`);
  // How they traveled (LOR-262): on foot is the walk less what was ridden or swum.
  const foot = Math.max(0, s.yards - (s.ride || 0) - (s.swim || 0));
  const flights = s.flights ? ` <span class="pf-where">${times(s.flights, "flight")}</span>` : "";
  const travel = s.ride || s.swim || s.flown || s.boats ? [
    foot >= 1 && `On foot <span class="pf-n">${steps(foot)} steps</span> <span class="pf-where">${dist(foot)}</span>`,
    s.ride >= 1 && `Riding <span class="pf-n">${dist(s.ride)}</span>`,
    s.swim >= 1 && `Swimming <span class="pf-n">${dist(s.swim)}</span>`,
    s.flown >= 1 && `Flying <span class="pf-n">${dist(s.flown)}</span>${flights}`,
    s.boats > 0 && `By boat <span class="pf-n">${times(s.boats, "crossing")}</span>`,
  ].filter(Boolean) : [];
  const time = (s.time || []).slice(0, 6).map(t => `${escape(t.zone)} <span class="pf-n">${duration(t.minutes / 60)}</span>`);
  const patrons = (s.patrons || []).slice(0, 6).map(p => `${escape(p.name)} <span class="pf-n">${times(p.n, "quest")}</span>`);
  const list = (title, items) => items.length ? `<div><h3>${title}</h3><ul>${items.map(i => `<li>${i}</li>`).join("")}</ul></div>` : "";
  const lists = list("Where the steps went", walked) + list("How they traveled", travel) + list("Where the time went", time) +
    list("Foes by kind", kinds) + list("Most loyal patrons", patrons);
  // Miles or kilometres: shown once the script is there to switch them.
  const units = distances ? `<p class="pf-units" hidden>Distances in <button class="btn-small" type="button" data-units="mi" aria-pressed="true">miles</button>
      <button class="btn-small btn-small-alt" type="button" data-units="km" aria-pressed="false">kilometres</button></p>
    <script src="/js/units.js" defer></script>` : "";
  return `<section class="vp-section pf-nums" aria-labelledby="nums-title">
    <h2 id="nums-title">The journey in numbers</h2>
    <ul class="pf-stats">${tiles}</ul>
    ${fun.length ? `<ul class="pf-fun">${fun.map(l => `<li>${escape(l)}</li>`).join("")}</ul>` : ""}
    ${lists ? `<div class="pf-nums-lists">${lists}</div>` : ""}
    ${units}
  </section>`;
}
