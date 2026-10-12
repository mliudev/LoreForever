// The journey told in chapters on a player profile (/u/<handle>, Mike 10/11: the page tells the story of the journey,
// not a wall of features). The moments (lib/trails.js moments) by play day: one chapter a day, a day with fewer than
// MIN_MOMENTS going in with the next. Each chapter gets a title (its main places), the road it took, one line told
// from its facts (summary), its highlights (a level, a dungeon and the bosses there, new lands, quests, deaths...),
// its pictures, and every moment folded inside it. The newest OPEN chapters are shown in full beside the road chart
// (lib/roadchart.js, which lights up the chapter being read); older ones fold to a line each, so a long journey stays
// a page you can read. Used by lib/profiles.js. Kept outside functions/ so Pages doesn't route it.
//
// Nothing here is written by a model: the lines are templates over the record's own facts, in English like the
// rest of the page's own words (the story above it is the told part).

import { escape } from "./voices.js";
import { norm, landOf, dayText } from "./trails.js";
import { BATTLEGROUNDS, battleground } from "./battlegrounds.js";

export const MIN_MOMENTS = 10;   // a day with fewer moments goes in with the next day (the newest stays its own)
export const OPEN = 8;           // the newest chapters shown in full
export const LISTED = 400;       // moments listed in one chapter's fold at most (the newest of them)
export const PICS = 6;           // pictures shown in a chapter; the rest are a "+N" away in the picture viewer
const ROUTE = 9;                 // lands named on a chapter's road

const CAPITALS = new Set(["Stormwind City", "Ironforge", "Darnassus", "Orgrimmar", "Thunder Bluff", "Undercity"].map(norm));
const RANK = { elite: "elite", rare: "rare", rareelite: "rare elite", worldboss: "world boss" };

const count = n => String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const listOf = items => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const some = (items, n) => items.length > n ? `${items.slice(0, n).join(", ")} and ${count(items.length - n)} more` : listOf(items);
const lowerThe = s => s.replace(/^The /, "the ");
const unique = list => [...new Set(list.filter(Boolean))];

// The land a moment counts for (a building the game names instead of its zone counts as its zone), as [key, name].
const landKey = e => (e?.zone ? norm(landOf(e.zone)) : null);
const landName = e => landOf(e.zone);

// The chapters, oldest first: {n, days (YYYY-MM-DD, or null for moments without one), first, last (the moments'
// numbers, o), ms (its moments), lands ([{key, name, n}] in the order reached), fresh (lands first reached here),
// title, summary, hi ([{icon, label, text}]), dungeons, battles, levels}. name: the character's, for the summary; side:
// the faction they fight for ("Alliance" or "Horde"), for a battle's line.
export function chapters(list, name = "", side = "") {
  const days = [];
  for (const m of list) {
    // A moment without a day stays with the moments around it.
    const day = m.day || days.at(-1)?.day || null;
    if (!days.length || days.at(-1).day !== day) days.push({ day, ms: [] });
    days.at(-1).ms.push(m);
  }
  const groups = [];
  let carry = null;
  days.forEach((g, i) => {
    const cur = carry ? { days: [...carry.days, g.day], ms: [...carry.ms, ...g.ms] } : { days: [g.day], ms: g.ms };
    if (cur.ms.length < MIN_MOMENTS && i < days.length - 1) { carry = cur; return; }
    carry = null;
    groups.push(cur);
  });

  // A place is a dungeon when the record says so or a boss fell there.
  const dungeon = new Set();
  for (const m of list) if ((m.k === "places" && m.e.dungeon) || m.k === "bosses") if (landKey(m.e)) dungeon.add(landKey(m.e));
  // A battleground is a battle (LOR-430): told as one, with the falls there, never as a land first seen or a dungeon.
  const battle = new Set();
  for (const m of list) {
    const key = landKey(m.e);
    if (key && (m.k === "battles" || (m.k === "places" && (m.e.battleground || battleground(m.e.zone))))) battle.add(key);
  }
  const foe = { Alliance: "Horde", Horde: "Alliance" }[side] || "";
  const seen = new Set();
  return groups.map((g, i) => {
    const n = i + 1, ms = g.ms;
    const lands = new Map();
    for (const m of ms) {
      const key = landKey(m.e);
      if (!key) continue;
      if (!lands.has(key)) lands.set(key, { key, name: landName(m.e), n: 0 });
      lands.get(key).n++;
    }
    const fresh = [...lands.keys()].filter(k => !seen.has(k));
    fresh.forEach(k => seen.add(k));

    // The title: where most of it happened (a dungeon counts double, a capital less), and the next place when it's
    // close behind.
    const weight = l => l.n * (dungeon.has(l.key) || battle.has(l.key) ? 2 : 1) * (CAPITALS.has(l.key) ? 0.4 : 1);
    const ranked = [...lands.values()].sort((a, b) => weight(b) - weight(a));
    const title = !ranked.length ? (n === 1 ? "The journey begins" : "On the road")
      : ranked[1] && weight(ranked[1]) >= weight(ranked[0]) * 0.5 ? `${ranked[0].name} and ${lowerThe(ranked[1].name)}` : ranked[0].name;

    const of = k => ms.filter(m => m.k === k);
    const levels = of("levels").map(m => Number(m.e.level)).filter(Number.isFinite);
    const bosses = new Map();
    for (const m of of("bosses")) {
      const key = landKey(m.e) || "";
      if (!bosses.has(key)) bosses.set(key, { name: key ? landName(m.e) : "", bosses: [] });
      bosses.get(key).bosses.push(m.e.name);
    }
    const dungeons = [...bosses.values()].map(x => ({ ...x, bosses: unique(x.bosses) }));
    const quests = unique(of("quests").map(m => m.e.title));
    const foes = unique(of("kills").map(m => `${m.e.name}${Object.hasOwn(RANK, m.e.rank ?? "") ? ` (${RANK[m.e.rank]})` : ""}`));
    // Each battleground fought in: how the battles there ended (when the game said) and the falls there.
    const battles = new Map();
    for (const m of ms) {
      const key = landKey(m.e);
      if (!key || !battle.has(key) || !["places", "battles", "deaths"].includes(m.k)) continue;
      if (!battles.has(key)) battles.set(key, { name: landName(m.e), falls: 0, outs: [] });
      const b = battles.get(key);
      if (m.k === "deaths") b.falls++;
      if (m.k === "battles" && (m.e.out || m.e.left)) b.outs.push(m.e.out || "left");
    }
    const deaths = new Map();
    for (const m of of("deaths")) {
      const key = landKey(m.e) || "";
      if (battle.has(key)) continue;   // told with its battle
      if (!deaths.has(key)) deaths.set(key, { name: key ? landName(m.e) : "", n: 0, by: [] });
      deaths.get(key).n++;
      if (m.e.by) deaths.get(key).by.push(m.e.by);
    }
    const finds = unique(of("loot").filter(m => m.e.quality >= 3).map(m => m.e.name));
    const books = unique(of("books").map(m => m.e.title));
    const mounts = unique(of("mounts").map(m => m.e.name));
    const rep = unique(of("rep").map(m => `${m.e.standing} with ${m.e.faction}`));
    const people = unique(of("people").map(m => m.e.name));
    const newLands = fresh.filter(k => !dungeon.has(k) && !battle.has(k)).map(k => lands.get(k).name);
    const fought = [...battles.values()];

    // One line, from the biggest things that happened.
    const said = [];
    if (n === 1 && ranked.length) said.push(`set out from ${lowerThe(lands.values().next().value.name)}`);
    if (levels.length) said.push(`reached level ${Math.max(...levels)}`);
    const big = [...dungeons].filter(x => x.name).sort((a, b) => b.bosses.length - a.bosses.length).slice(0, 2);
    if (big.length) said.push(`fought through ${listOf(big.map(x => lowerThe(x.name)))}`);
    if (fought.length) {
      const r = fought.length === 1 ? results(fought[0].outs) : "";
      said.push(`fought${side ? ` for the ${side}` : ""} at ${listOf(fought.map(x => lowerThe(x.name)))}${r ? ` (${r})` : ""}`);
    }
    if (n > 1 && newLands.length) {
      said.push(`first saw ${newLands.length > 2 ? `${newLands.slice(0, 2).map(lowerThe).join(", ")} and more` : listOf(newLands.map(lowerThe))}`);
    }
    if (quests.length > 1) said.push(`finished ${count(quests.length)} quests`);
    const worst = [...deaths.values()].sort((a, b) => b.n - a.n)[0];
    if (worst && worst.n >= 3) said.push(`fell ${count(worst.n)} times${worst.name ? ` in ${lowerThe(worst.name)}` : ""}`);
    if (mounts.length) said.push(`rode off on ${listOf(mounts)}`);
    const summary = said.length ? `${name} ${listOf(said.slice(0, 3))}.` : `${name} travelled on.`;

    const hi = [];
    if (levels.length) hi.push({ icon: "level", label: `Reached level ${Math.max(...levels)}`, text: "" });
    for (const x of dungeons) hi.push({ icon: "dungeon", label: x.name || "Bosses", text: `${some(x.bosses, 3)} fell` });
    for (const x of fought) {
      const b = BATTLEGROUNDS[battleground(x.name)], r = results(x.outs);
      hi.push({ icon: "battle", label: `Battle at ${lowerThe(x.name)}`, text: [
        [side && `for the ${side}`, foe && `against the ${foe}`, b?.short].filter(Boolean).join(" "),
        r, x.falls && `fell ${x.falls === 1 ? "once" : x.falls === 2 ? "twice" : `${count(x.falls)} times`} and fought on`,
      ].filter(Boolean).join("; ") });
    }
    if (newLands.length) hi.push({ icon: "land", label: n === 1 ? "Travelled through" : "New lands", text: some(newLands, 4) });
    if (quests.length) hi.push({ icon: "quest", label: quests.length === 1 ? "Quest" : `${count(quests.length)} quests`, text: some(quests, 2) });
    if (foes.length) hi.push({ icon: "foe", label: "Notable foes", text: some(foes, 2) });
    for (const x of deaths.values()) {
      if (x.n < 2 && deaths.size > 1) continue;
      hi.push({ icon: "death", label: x.n === 1 ? "Fell once" : x.n === 2 ? "Fell twice" : `Fell ${count(x.n)} times`,
        text: [x.name, unique(x.by).length ? `to ${listOf(unique(x.by).slice(0, 3))}` : ""].filter(Boolean).join(", ") });
    }
    if (mounts.length) hi.push({ icon: "mount", label: "New mount", text: listOf(mounts) });
    if (books.length) hi.push({ icon: "book", label: "Read", text: some(books, 3) });
    if (rep.length) hi.push({ icon: "rep", label: "Standing", text: some(rep, 2) });
    if (finds.length) hi.push({ icon: "find", label: `${count(finds.length)} rare find${finds.length === 1 ? "" : "s"}`, text: some(finds, 2) });
    const notable = people.filter(p => p.includes(" "));
    if (people.length && hi.length < 5) hi.push({ icon: "people", label: `Met ${count(people.length)}`, text: some(notable.length ? notable : people, 2) });

    return { n, days: unique(g.days), first: ms[0].o, last: ms.at(-1).o, ms, lands: [...lands.values()], fresh, title,
      summary, hi, dungeons, battles: fought, levels };
  });
}

// How a battleground's battles ended: "won", "lost twice", "won 2, lost 1", or "" when the game didn't say.
const OUTCOME = { win: "won", loss: "lost", draw: "drawn", left: "left early" };
function results(outs) {
  const n = new Map();
  for (const o of outs) if (Object.hasOwn(OUTCOME, o)) n.set(o, (n.get(o) || 0) + 1);
  if (n.size === 1) {
    const [[k, c]] = n;
    return OUTCOME[k] + (c === 1 ? "" : c === 2 ? " twice" : ` ${count(c)} times`);
  }
  return [...n].map(([k, c]) => `${OUTCOME[k]} ${count(c)}`).join(", ");
}

// "Oct 2, 2026", or "Oct 5 to Oct 6, 2026" for a chapter over several days.
export function chapterWhen(c) {
  const days = c.days.filter(Boolean);
  if (!days.length) return "Date not recorded";
  if (days.length === 1) return dayText(days[0]);
  const [a, b] = [dayText(days[0]), dayText(days.at(-1))];
  return a.slice(-4) === b.slice(-4) ? `${a.slice(0, -6)} to ${b}` : `${a} to ${b}`;
}

// ---- The section ----

// Small line icons (16 units), one per kind of highlight and moment.
const ICONS = {
  level: '<path d="M8 13.5V3M3.8 7.2 8 3l4.2 4.2"/>',
  dungeon: '<path d="M3 14V7.5a5 5 0 0 1 10 0V14M2 14h12M6.3 14v-3.5a1.7 1.7 0 0 1 3.4 0V14"/>',
  boss: '<path d="M3 3l8.5 8.5M13 3 4.5 11.5M10 13.5l3.5-3.5M6 13.5 2.5 10"/>',
  battle: '<path d="M3 3l8.5 8.5M13 3 4.5 11.5M10 13.5l3.5-3.5M6 13.5 2.5 10"/><path d="M8 1.5v2"/>',
  foe: '<path d="M3 13 12.5 3.5M10 3h3v3M4.5 9.5l2 2"/>',
  land: '<path d="M4 14.5V2.5M4 3h8l-1.8 2.7L12 8.5H4"/>',
  quest: '<path d="M2.8 8.6l3.2 3.2 7.2-7.6"/>',
  taken: '<path d="M4 2.5h8v11H4zM6.3 6h3.4M6.3 9h3.4"/>',
  people: '<circle cx="8" cy="5.2" r="2.6"/><path d="M2.8 14c.7-3 2.7-4.5 5.2-4.5s4.5 1.5 5.2 4.5"/>',
  place: '<path d="M8 14.5s4.6-4.3 4.6-7.8a4.6 4.6 0 0 0-9.2 0c0 3.5 4.6 7.8 4.6 7.8z"/><circle cx="8" cy="6.6" r="1.6"/>',
  find: '<path d="M4 6.2 6 3h4l2 3.2-4 7.3zM4 6.2h8"/>',
  death: '<path d="M3.8 9.8V7.4a4.2 4.2 0 0 1 8.4 0v2.4l-1.2 1.2V13H5v-2z"/><circle cx="6.3" cy="7.8" r=".9"/><circle cx="9.7" cy="7.8" r=".9"/>',
  picture: '<path d="M2.3 5.3h2.3l1.3-2h4.2l1.3 2h2.3v7.4H2.3z"/><circle cx="8" cy="8.9" r="2.2"/>',
  book: '<path d="M2.5 3.3h4.3c.7 0 1.2.5 1.2 1.2v9.2c0-.8-.7-1.5-1.5-1.5h-4zM13.5 3.3H9.2c-.7 0-1.2.5-1.2 1.2v9.2c0-.8.7-1.5 1.5-1.5h4z"/>',
  rep: '<path d="M8 2l5 2v4c0 3.1-2.2 5.1-5 6.1C5.2 13.1 3 11.1 3 8V4z"/>',
  mount: '<path d="M3 13l1.5-5L8 6l2-3 1 2 2 1-1.5 1.5L12 13M6.5 13l.5-3.5"/>',
};
export const iconSprite = () => `<svg width="0" height="0" class="pf-sprite" aria-hidden="true"><defs>${Object.entries(ICONS)
  .map(([k, v]) => `<symbol id="pf-i-${k}" viewBox="0 0 16 16">${v}</symbol>`).join("")}</defs></svg>`;
const icon = k => `<svg class="pf-ic" viewBox="0 0 16 16" aria-hidden="true"><use href="#pf-i-${k}"/></svg>`;
const KIND_ICON = { places: "place", people: "people", bosses: "boss", kills: "foe", quests: "quest", taken: "taken", loot: "find",
  deaths: "death", levels: "level", pictures: "picture", books: "book", rep: "rep", mounts: "mount", battles: "battle" };

// A moment in the chapter's fold: what happened, the place within the land, and one link: its lore page while the
// lore pages are on, else its Wowhead page (LOR-263; never the wiki's search, which is a guess).
function momentRow(m, lore) {
  const e = m.e;
  const what = {
    places: () => [`${e.dungeon || e.battleground ? "Entered" : "Reached"} `, e.sub || e.zone, lore && (e.sub ? lore.place(e.sub, e.zone) : lore.zone(e.zone))],
    battles: () => ["Fought at ", e.zone, lore?.zone(e.zone)],
    quests: () => ["Finished ", e.title, m.quest?.p], taken: () => ["Took on ", e.title, m.quest?.p],
    people: () => ["Met ", e.name, lore?.person(e.name)], bosses: () => ["Defeated ", e.name, lore?.person(e.name)],
    kills: () => ["Defeated ", e.name + (Object.hasOwn(RANK, e.rank ?? "") ? ` (${RANK[e.rank]})` : ""), lore?.person(e.name)],
    loot: () => [e.reward ? "Earned " : "Found ", e.name], levels: () => ["Reached level ", count(e.level)],
    mounts: () => ["New mount: ", e.name], rep: () => ["", `${e.standing} with ${e.faction}`], books: () => ["Read ", e.title],
    pictures: () => ["Took a journey picture", ""], deaths: () => (e.by ? ["Slain by ", e.by, lore?.person(e.by)] : ["Died", ""]),
  }[m.k];
  const [verb, thing, page] = what ? what() : ["", ""];
  const out = !page && m.out?.site === "Wowhead" ? m.out.url : null;
  const named = !thing ? "" : page && lore ? `<a href="${escape(page)}">${escape(thing)}</a>`
    : out ? `<a class="pf-out" href="${escape(out)}" target="_blank" rel="noopener" aria-label="${escape(`${thing} on Wowhead`)}">${escape(thing)}</a>`
    : `<span class="pf-thing${m.k === "loot" && Number.isInteger(e.quality) ? ` q${Math.min(5, Math.max(0, e.quality))}` : ""}">${escape(thing)}</span>`;
  const sub = m.k === "battles" ? (e.out || e.left ? ` <span class="pf-sub">${escape(results([e.out || "left"]))}</span>` : "")
    : m.k !== "places" && e.sub ? ` <span class="pf-sub">${escape(e.sub)}</span>` : "";
  return `<li class="pf-mk-${m.k}" id="m-${m.o}" tabindex="-1">${icon(KIND_ICON[m.k] || "place")}<span>${escape(verb)}${named}${sub}</span></li>`;
}

// The visits of a chapter: runs of moments in one land, each under its name.
function visits(ms) {
  const out = [];
  for (const m of ms) {
    const key = landKey(m.e);
    if (!out.length || (key && out.at(-1).key !== key)) out.push({ key, name: key ? landName(m.e) : "", ms: [] });
    out.at(-1).ms.push(m);
  }
  return out;
}

// The chapters for the page. matched: lib/trails.js timelinePictures (moment -> pictures beside it); picture(p, i): a
// picture's link (lib/pictures.js pictureLink); map(c): the chapter on the chart (lib/roadchart.js chapterMap), or "";
// lore: lib/trails.js lookups while the lore pages are on, else null.
export function chaptersSection(chs, { lore = null, matched = new Map(), picture = () => "", map = () => "" } = {}) {
  if (!chs.length) return "";
  const older = chs.slice(0, -OPEN), open = chs.slice(-OPEN);
  const pics = c => c.ms.flatMap(m => matched.get(m) || []);
  const shots = c => {
    const all = pics(c);
    if (!all.length) return "";
    // The first PICS shown; past that, the last one shown says how many more, and the rest open from the viewer.
    return `<div class="pf-shots${all.length === 1 ? " pf-shots-one" : ""}">${all.map((p, i) => picture(p, {
      hidden: i >= PICS, more: i === PICS - 1 && all.length > PICS ? all.length - PICS : 0 })).join("")}</div>`;
  };
  const highlights = c => `<ul class="pf-hi">${c.hi.slice(0, 8).map(h => `<li class="pf-h-${h.icon}">${icon(h.icon)}<span><strong>${escape(h.label)}</strong>${h.text ? ` ${escape(h.text)}` : ""}</span></li>`).join("")}</ul>`;
  // The lands in the order reached; a long day's road ends in "and N more".
  const route = c => c.lands.length > 1 ? `<p class="pf-route">${c.lands.slice(0, ROUTE).map(l => escape(l.name)).join('<span aria-hidden="true"> &rarr; </span>')}${
    c.lands.length > ROUTE ? ` <span class="pf-sub">and ${count(c.lands.length - ROUTE)} more</span>` : ""}</p>` : "";
  const fold = c => {
    const ms = c.ms.slice(-LISTED);
    return `<details class="pf-all"><summary>Every moment of this chapter <span class="pf-n">${count(c.ms.length)}</span></summary>${c.ms.length > ms.length
      ? `\n        <p class="pf-note">The newest ${count(ms.length)} of them.</p>` : ""}
        ${visits(ms).map(v => `<div class="pf-visit">${v.name ? `<h4>${escape(v.name)}</h4>` : ""}<ul>${v.ms.map(m => momentRow(m, lore)).join("")}</ul></div>`).join("\n        ")}
      </details>`;
  };
  const head = (c, tag) => `<p class="pf-eyebrow">Chapter ${c.n} <span aria-hidden="true">&middot;</span> ${escape(chapterWhen(c))}</p>
      <${tag} id="ch-${c.n}-title">${escape(c.title)}</${tag}>`;
  const range = c => `data-n="${c.n}" data-from="${c.first}" data-to="${c.last}"`;
  const earlier = older.length ? `<div class="pf-earlier">
    <h3 class="pf-earlier-title">Earlier chapters</h3>
    <ol class="pf-chx-list">
      ${older.map(c => `<li><details class="pf-chx" id="ch-${c.n}" ${range(c)}><summary><span class="pf-chx-n">${c.n}</span><span class="pf-chx-t">${escape(c.title)}</span><span class="pf-chx-d">${escape(chapterWhen(c))}</span></summary>
        <div class="pf-chx-body"><p class="pf-sum">${escape(c.summary)}</p>${route(c)}${highlights(c)}${shots(c)}</div></details></li>`).join("\n      ")}
    </ol>
  </div>` : "";
  return `<section class="pf-chapters" id="chapters" aria-label="Chapters">
  ${earlier}
  ${open.map(c => `<article class="pf-ch" id="ch-${c.n}" ${range(c)} aria-labelledby="ch-${c.n}-title">
    <header>${head(c, "h3")}
      ${route(c)}</header>
    <div class="pf-ch-body">
      <div class="pf-ch-text"><p class="pf-sum">${escape(c.summary)}</p>
        ${highlights(c)}${shots(c)}
        ${fold(c)}</div>
      ${map(c) ? `<div class="pf-ch-map">${map(c)}</div>` : ""}
    </div>
  </article>`).join("\n  ")}
  </section>`;
}
