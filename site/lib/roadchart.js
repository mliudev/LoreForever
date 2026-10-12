// The road chart on a player profile (LOR-248): the lands the character has reached as stops on our own schematic
// chart of Azeroth (no map art from the game: Mike's call, 10/4), with the roads between them in the order they were
// travelled. Behind them, our own drawing of the coasts of Kalimdor and the Eastern Kingdoms (lib/coasts.js, LOR-303).
// Built on the server as an inline SVG; public/js/roadchart.js zooms and pans it.
//
// It sits beside the chapters (lib/chapters.js, Mike 10/11): each road and stop knows the chapters it belongs to
// (data-ch), and public/js/journey.js tells the chart which chapter is being read, so its roads and lands light up and
// the chart moves to them. A stop is a link to the chapter where that land was first reached, on the same page; the
// newest chapters have their number on the chart, at the land where most of each happened. chapterMap draws one
// chapter's road on its own, small, for a narrow screen where the chart can't stay beside the reading. The land is as
// far as a moment's position goes: the synced journey carries no map position (the companion keeps it on the
// player's PC), so every moment is shown at its land.
//
// The route comes from the moments (lib/trails.js): one leg each time the next moment is in another land. With the
// companion's journey (LOR-248, lib/journey.js readJourney) a leg knows how it was travelled (a new place's "how": on
// foot, flight, boat, hearthstone, portal), and the chart draws flights and the like dashed; from a pasted record
// every leg is just a road. Only lands the player reached get a name; the others are faint dots, so nothing is
// spoiled. Names match English ones (a record in another language shows the lands it can match, and lists the rest
// under the chart); a building or other place the game names instead of its zone counts for its land (lib/trails.js
// landOf), and a place with no stop of its own inside a land is drawn at that land (PLACED).

import { escape } from "./voices.js";
import { norm, landOf } from "./trails.js";
import { COASTS } from "./coasts.js";

export const W = 1000, H = 640;   // the chart's own units (the viewBox keeps this shape)
const PX = 760;                   // the width the chart is first drawn for; roadchart.js resizes markers to the real one
const MINI_PX = 300;              // the same for a chapter's own small chart

// [key, English name, x, y, kind]: z a zone, c a capital, d a dungeon. Kalimdor on the left, the Eastern Kingdoms on
// the right, north up; places Forever added sit where their lore puts them (Shen'dralas between Feralas, Mulgore and
// Desolace; the Riverglades east of the Burning Steppes and Badlands; Zephras Isle up in Skywall).
export const LANDS = [
  ["teldrassil", "Teldrassil", 135, 70, "z"], ["darnassus", "Darnassus", 100, 52, "c"],
  ["moonglade", "Moonglade", 250, 72, "z"], ["winterspring", "Winterspring", 330, 92, "z"],
  ["darkshore", "Darkshore", 180, 135, "z"], ["felwood", "Felwood", 258, 150, "z"], ["azshara", "Azshara", 375, 165, "z"],
  ["ashenvale", "Ashenvale", 225, 210, "z"], ["blackfathom", "Blackfathom Deeps", 168, 196, "d"],
  ["stonetalon", "Stonetalon Mountains", 145, 268, "z"], ["desolace", "Desolace", 95, 330, "z"],
  ["barrens", "The Barrens", 285, 305, "z"], ["wailing", "Wailing Caverns", 258, 285, "d"],
  ["orgrimmar", "Orgrimmar", 345, 228, "c"], ["ragefire", "Ragefire Chasm", 365, 214, "d"],
  ["durotar", "Durotar", 368, 272, "z"], ["mulgore", "Mulgore", 200, 368, "z"], ["thunderbluff", "Thunder Bluff", 178, 352, "c"],
  ["shendralas", "Shen'dralas", 132, 400, "z"], ["razorfenkraul", "Razorfen Kraul", 262, 390, "d"],
  ["dustwallow", "Dustwallow Marsh", 362, 385, "z"], ["feralas", "Feralas", 110, 460, "z"],
  ["thousandneedles", "Thousand Needles", 270, 452, "z"], ["tanaris", "Tanaris", 335, 530, "z"],
  ["ungoro", "Un'Goro Crater", 230, 535, "z"], ["silithus", "Silithus", 130, 565, "z"],
  ["zephras", "Zephras Isle", 495, 70, "z"],
  ["tirisfal", "Tirisfal Glades", 600, 110, "z"], ["undercity", "Undercity", 632, 128, "c"],
  ["ruinsoflordaeron", "Ruins of Lordaeron", 648, 108, "d"], ["scarlet", "Scarlet Monastery", 688, 92, "d"],
  ["westernplaguelands", "Western Plaguelands", 735, 122, "z"], ["easternplaguelands", "Eastern Plaguelands", 818, 110, "z"],
  ["silverpine", "Silverpine Forest", 585, 182, "z"], ["shadowfang", "Shadowfang Keep", 562, 196, "d"],
  ["alterac", "Alterac Mountains", 680, 176, "z"], ["hillsbrad", "Hillsbrad Foothills", 652, 216, "z"],
  ["hinterlands", "The Hinterlands", 792, 186, "z"], ["arathi", "Arathi Highlands", 752, 240, "z"],
  ["wetlands", "Wetlands", 748, 300, "z"], ["dunmorogh", "Dun Morogh", 700, 362, "z"], ["ironforge", "Ironforge", 726, 346, "c"],
  ["gnomeregan", "Gnomeregan", 666, 352, "d"], ["hallofthanes", "Hall of Thanes", 744, 332, "d"],
  ["lochmodan", "Loch Modan", 802, 356, "z"], ["badlands", "Badlands", 806, 408, "z"],
  ["searinggorge", "Searing Gorge", 722, 412, "z"], ["burningsteppes", "Burning Steppes", 738, 448, "z"],
  ["riverglades", "Riverglades", 852, 444, "z"], ["redridge", "Redridge Mountains", 792, 482, "z"],
  ["elwynn", "Elwynn Forest", 692, 492, "z"], ["stormwind", "Stormwind City", 652, 476, "c"],
  ["stockade", "The Stockade", 636, 462, "d"], ["westfall", "Westfall", 632, 542, "z"], ["deadmines", "The Deadmines", 606, 558, "d"],
  ["duskwood", "Duskwood", 702, 548, "z"], ["deadwind", "Deadwind Pass", 762, 548, "z"],
  ["swampofsorrows", "Swamp of Sorrows", 818, 532, "z"], ["blastedlands", "Blasted Lands", 822, 588, "z"],
  ["stranglethorn", "Stranglethorn Vale", 680, 610, "z"],
];
const BY_NAME = new Map(LANDS.map(l => [norm(l[1]), l]));
// Places with no stop of their own, drawn at the land they're in (seen in profiles' records, 10/11). Unlike
// lib/trails.js IN_LAND they keep their own name everywhere else on the page: a chapter in the City of Dalaran is told
// as that, not as the Alterac Mountains.
const PLACED = new Map(Object.entries({ "Excavation Site: Wetlands": "Wetlands", "City of Dalaran": "Alterac Mountains" })
  .map(([place, land]) => [norm(place), norm(land)]));
// The chart's land for a zone name, or null.
export const landAt = zone => {
  const k = norm(landOf(zone));
  return BY_NAME.get(k) ?? BY_NAME.get(PLACED.get(k)) ?? null;
};
const TRAVEL = new Set(["flight", "boat", "hearth", "portal"]);   // drawn dashed: not a road walked

// The legs of the road: [{from, to, how, o}] between known lands, in time order, from the moments (o: the moment that
// arrived); and the lands in the order first reached, with their first and latest moment and how many there were;
// plus names no land matched.
export function route(list) {
  const lands = new Map(), legs = [], unknown = new Set();
  let prev = null;
  for (const m of list) {
    const zone = m.e?.zone;
    if (!zone) continue;
    const land = landAt(zone);
    if (!land) { unknown.add(zone); continue; }
    if (!lands.has(land[0])) lands.set(land[0], { land, first: m, last: m, n: 0, order: lands.size + 1 });
    const l = lands.get(land[0]);
    l.last = m;
    l.n++;
    if (prev && prev !== land[0]) legs.push({ from: prev, to: land[0], how: m.k === "places" ? m.e.how || null : null, o: m.o });
    prev = land[0];
  }
  return { lands, legs, unknown: [...unknown] };
}

const r1 = n => Math.round(n * 10) / 10;

// The view that first shows: around the lands reached (with room for their names: pad, left and right), in the
// chart's shape.
export function fitView(points, pad = [70, 130]) {
  if (!points.length) return [0, 0, W, H];
  let x0 = Math.min(...points.map(p => p[0])) - pad[0], x1 = Math.max(...points.map(p => p[0])) + pad[1];
  let y0 = Math.min(...points.map(p => p[1])) - 50, y1 = Math.max(...points.map(p => p[1])) + 50;
  let w = Math.max(x1 - x0, 320), h = Math.max(y1 - y0, 320 * H / W);
  if (w / h > W / H) h = w * H / W; else w = h * W / H;
  w = Math.min(w, W); h = Math.min(h, H);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const x = Math.min(Math.max(cx - w / 2, 0), W - w), y = Math.min(Math.max(cy - h / 2, 0), H - h);
  return [r1(x), r1(y), r1(w), r1(h)];
}

// The chapter a moment is in (lib/chapters.js: each covers the moments first..last), or 0.
function chapterOf(chapters) {
  return o => chapters.find(c => o >= c.first && o <= c.last)?.n || 0;
}

// Each pair of lands once: how many times it was travelled, how (dashed when most known trips weren't on foot),
// whether it's the latest leg, and the chapters it was travelled in.
function roadPairs(legs, chapter) {
  const pairs = new Map();
  legs.forEach((leg, i) => {
    const key = [leg.from, leg.to].sort().join("|");
    const p = pairs.get(key) || { a: leg.from, b: leg.to, n: 0, travel: 0, road: 0, last: false, ch: new Set() };
    p.n++;
    if (TRAVEL.has(leg.how)) p.travel++; else if (leg.how) p.road++;
    if (i === legs.length - 1) p.last = true;
    const n = chapter(leg.o);
    if (n) p.ch.add(n);
    pairs.set(key, p);
  });
  return [...pairs.values()];
}

const byKey = new Map(LANDS.map(l => [l[0], l]));
// A gentle curve, so a road there and back isn't one straight line.
const curve = p => {
  const [, , x1, y1] = byKey.get(p.a), [, , x2, y2] = byKey.get(p.b);
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(40, len * 0.18);
  return `M${x1} ${y1}Q${r1((x1 + x2) / 2 - dy / len * bend)} ${r1((y1 + y2) / 2 + dx / len * bend)} ${x2} ${y2}`;
};
const chList = set => ` ${[...set].sort((a, b) => a - b).join(" ")} `;

// The chart, or "" with fewer than two lands to connect. name: the character's, for the chart's label. chapters: the
// journey's chapters (lib/chapters.js), so roads and stops know theirs and a stop links its first one; numbered: the
// chapters whose number goes on the chart (the ones shown in full).
export function roadChart(list, { name = "", chapters = [], numbered = [] } = {}) {
  const { lands, legs, unknown } = route(list);
  if (lands.size < 2) return "";
  const chapter = chapterOf(chapters);
  const pairs = roadPairs(legs, chapter);
  const roads = pairs.sort((p, q) => Number(p.last) - Number(q.last)).map(p =>
    `<path class="pf-ch-road${p.travel > p.road ? " pf-ch-travel" : ""}${p.last ? " pf-ch-latest" : ""}" d="${curve(p)}" ` +
    `${p.ch.size ? `data-ch="${chList(p.ch)}" ` : ""}style="stroke-width:${r1(1.4 + Math.min(3, Math.log2(p.n)))}px"/>`).join("");
  // The chapters each land comes up in.
  const inChapters = new Map();
  for (const m of list) {
    const land = m.e?.zone ? landAt(m.e.zone) : null, n = chapter(m.o);
    if (!land || !n) continue;
    if (!inChapters.has(land[0])) inChapters.set(land[0], new Set());
    inChapters.get(land[0]).add(n);
  }
  const latest = [...lands.values()].sort((p, q) => q.last.o - p.last.o)[0];
  const stops = [...lands.values()].map(l => {
    const [key, label, x, y, kind] = l.land;
    const ch = inChapters.get(key);
    const first = ch?.size ? Math.min(...ch) : 0;
    const what = first ? `${label}: first reached in chapter ${first}` : `${label}: reached ${ordinal(l.order)}`;
    // A capital or dungeon sits next to its zone: its name goes on the other side, so the two don't overlap.
    const text = kind === "z" ? `<text x="10" y="4">` : `<text x="-10" y="4" text-anchor="end">`;
    return `<a class="pf-ch-stop pf-ch-${kind}${l === latest ? " pf-ch-now" : ""}" href="#${first ? `ch-${first}` : `m-${l.first.o}`}" ` +
      `data-land="${escape(norm(label))}"${ch?.size ? ` data-ch="${chList(ch)}"` : ""} data-x="${x}" data-y="${y}" data-name="${escape(label)}" ` +
      `aria-label="${escape(what)}"><g transform="translate(${x} ${y})"><g class="pf-ch-s"><circle r="6"/>${text}${escape(label)}</text></g></g></a>`;
  }).join("");
  // The numbered chapters, each at its busiest land on the chart; chapters at the same land share a marker.
  const at = new Map();
  for (const c of numbered) {
    const n = new Map();
    for (const m of c.ms) {
      const land = m.e?.zone ? landAt(m.e.zone) : null;
      if (land) n.set(land[0], (n.get(land[0]) || 0) + 1);
    }
    const top = [...n].sort((a, b) => b[1] - a[1])[0];
    if (!top) continue;
    if (!at.has(top[0])) at.set(top[0], []);
    at.get(top[0]).push(c.n);
  }
  const pins = [...at].map(([key, ns]) => {
    const [, label, x, y] = byKey.get(key);
    const text = ns.length > 3 ? `${ns.slice(0, 2).join(",")},…` : ns.join(",");
    const w = 14 + (text.length - 1) * 6.4;
    return `<a class="pf-ch-pin" href="#ch-${ns.at(-1)}" aria-label="${escape(`Chapter${ns.length > 1 ? "s" : ""} ${ns.join(", ")}: ${label}`)}">` +
      `<g transform="translate(${x} ${y})"><g class="pf-ch-s"><g transform="translate(0 -16)"><rect x="${r1(-w / 2)}" y="-9" width="${r1(w)}" height="18" rx="9"/>` +
      `<text y="4" text-anchor="middle">${escape(text)}</text></g></g></g></a>`;
  }).join("");
  const faint = LANDS.filter(l => !lands.has(l[0]))
    .map(l => `<g transform="translate(${l[2]} ${l[3]})"><g class="pf-ch-s"><circle class="pf-ch-dot" r="2.5"/></g></g>`).join("");
  const fit = fitView([...lands.values()].map(l => [l.land[2], l.land[3]]));
  const z = r1(fit[2] / PX * 1000) / 1000;
  const anyTravel = legs.some(l => l.how);
  return `<figure class="pf-chart" id="road-chart">
    <div class="pf-chart-tools" role="group" aria-label="Chart view" hidden>
      <button type="button" data-zoom="in" aria-label="Zoom in">+</button><button type="button" data-zoom="out" aria-label="Zoom out">&minus;</button><button type="button" data-zoom="fit" aria-label="Show the whole road">&#10530;</button>
    </div>
    <svg class="pf-chart-svg" viewBox="${fit.join(" ")}" data-fit="${fit.join(" ")}" preserveAspectRatio="xMidYMid meet"
      role="group" aria-label="${escape(`Road chart of the lands ${name || "this character"} has reached`)}" style="--z:${z}" tabindex="0">
      <g class="pf-ch-world" aria-hidden="true">
        ${COASTS}
        <text class="pf-ch-sea" x="240" y="633">Kalimdor</text><text class="pf-ch-sea" x="700" y="37">Eastern Kingdoms</text>
        ${faint}
      </g>
      <g class="pf-ch-roads" aria-hidden="true">${roads}</g>
      <g class="pf-ch-stops">${stops}</g>
      <g class="pf-ch-pins">${pins}</g>
    </svg>
    <figcaption>${anyTravel ? "Roads walked or ridden are solid; flights, boats, hearthstones and portals are dashed. " : ""}Pick a land or a chapter number to read about it.${unknown.length ? ` Not on the chart: ${unknown.slice(0, 8).map(escape).join(", ")}${unknown.length > 8 ? " and more" : ""}.` : ""}</figcaption>
  </figure>`;
}

// One chapter's road on its own small chart (it uses the coasts the full chart above defines, so it goes on the same
// page), or "" when none of its lands is on the chart. Its lands are named and its roads gold; the rest of the journey
// stays faint around them, for where it is.
export function chapterMap(list, c) {
  const { lands, legs } = route(list);
  if (lands.size < 2) return "";
  const mine = new Set();
  for (const m of c.ms) { const land = m.e?.zone ? landAt(m.e.zone) : null; if (land) mine.add(land[0]); }
  if (!mine.size) return "";
  const pairs = roadPairs(legs, o => (o >= c.first && o <= c.last ? c.n : 0));
  const faint = pairs.map(p => `<path class="pf-ch-road pf-ch-ctx" d="${curve(p)}"/>`).join("");
  const gold = pairs.filter(p => p.ch.size).map(p => `<path class="pf-ch-road pf-ch-on${p.travel > p.road ? " pf-ch-travel" : ""}" d="${curve(p)}"/>`).join("");
  const others = [...lands.keys()].filter(k => !mine.has(k)).map(k => { const [, , x, y] = byKey.get(k);
    return `<g transform="translate(${x} ${y})"><g class="pf-ch-s"><circle class="pf-ch-been" r="2.6"/></g></g>`; }).join("");
  const stops = [...mine].map(k => { const [, label, x, y, kind] = byKey.get(k);
    const text = kind === "z" ? `<text x="9" y="4">` : `<text x="-9" y="4" text-anchor="end">`;
    return `<g class="pf-ch-stop pf-ch-${kind} pf-ch-on"><g transform="translate(${x} ${y})"><g class="pf-ch-s"><circle r="5"/>${text}${escape(label)}</text></g></g></g>`; }).join("");
  const fit = fitView([...mine].map(k => [byKey.get(k)[2], byKey.get(k)[3]]), [125, 130]);
  const names = [...mine].map(k => byKey.get(k)[1]);
  return `<svg class="pf-chart-svg pf-mini" viewBox="${fit.join(" ")}" role="img" style="--z:${r1(fit[2] / MINI_PX * 1000) / 1000}"
      aria-label="${escape(`Chapter ${c.n} on the chart: ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]}`)}">
      <g aria-hidden="true"><use href="#pf-ch-coastline" class="pf-ch-shallows"/><use href="#pf-ch-coastline" class="pf-ch-coast"/>${others}${faint}${gold}${stops}</g>
    </svg>`;
}

function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  return `${n}${s}`;
}
