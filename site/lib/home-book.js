// The home page's book (public/js/home-book.js): the add-on's Chronicle on the web, its four bookmarks filled from one
// real player's public profile, Húrin's (Mike, 10/24: "mirror the actual addon"). Here: a place's story and the
// add-on's own questions and answers there (lib/home-book-data.js). Found: the pages he found, zone by zone, with his
// pictures. Road: his chapters. Storylines: the storylines his quests are part of. It is the same record his page at
// /u/hurin shows (lib/profiles.js, lib/chapters.js, lib/pictures.js), so it stays true as he plays; nothing here is a
// copy. GET /api/home-book (functions/api/home-book.js) serves it, kept at the edge for a few minutes, since every
// visitor to the home page asks for the same book.
//
// Only what the public page already shows: a profile that isn't public (or isn't there) gives null, and the home page
// leaves the book out. Kept outside functions/ so Pages doesn't route it.

import { profileByHandle, sheetLine, sideOf } from "./profiles.js";
import { moments, timelinePictures, loadLinks, landOf, norm } from "./trails.js";
import { chapters, chapterWhen, momentWhat } from "./chapters.js";
import { listPictures, pictureUrl, placeOf } from "./pictures.js";
import { featureOn } from "./features.js";
import { battleground } from "./battlegrounds.js";
import { HERE, CHAPTERS } from "./home-book-data.js";

export const HOME_HANDLE = "hurin";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ROUTE = 9;        // lands named on a chapter's road
const FINDS = 10;       // pages shown for one chapter
const FOUND = 12;       // pages shown for each kind of a zone in the Found tab
const ZONE_PICTURES = 6; // pictures shown with a zone in the Found tab

const shortDay = day => {
  const m = /^\d{4}-(\d\d)-(\d\d)$/.exec(day || "");
  return m ? `${MONTHS[Number(m[1]) - 1]} ${Number(m[2])}` : "";
};
// "Oct 23", or "Oct 19 to 21" for a chapter over several days.
function shortWhen(c) {
  const days = c.days.filter(Boolean);
  if (!days.length) return "";
  const a = days[0], b = days.at(-1);
  if (a === b) return shortDay(a);
  return a.slice(0, 7) === b.slice(0, 7) ? `${shortDay(a)} to ${Number(b.slice(8))}` : `${shortDay(a)} to ${shortDay(b)}`;
}

// A highlight of a chapter (lib/chapters.js hi) as one line.
const factLine = h => (h.icon === "people" ? `Met ${h.text}` : h.text ? `${h.label}: ${h.text}` : h.label);

const KIND = { bosses: "boss", people: "person", places: "place", loot: "item", quests: "quest" };
const ORDER = ["boss", "zone", "place", "item", "person", "quest"];

// The pages the moments found: [{k, name, href}], most notable first, each page once.
function pagesOf(ms, names, { fresh = [], lands = [], limit = FINDS } = {}) {
  const seen = new Set(), out = [];
  const add = (k, name, href) => {
    if (!name || seen.has(name)) return;   // a dungeon is a land and a place: one card
    seen.add(name);
    out.push({ k, name, ...(href ? { href } : {}) });
  };
  for (const l of lands) if (fresh.includes(l.key)) add("zone", l.name, names?.zone(l.name));
  for (const m of ms) {
    const k = KIND[m.k];
    if (!k) continue;
    if (m.k === "loot" && !(m.e.quality >= 3)) continue;
    const [, thing, page] = momentWhat(m, names);
    add(k, thing, page);
  }
  return out.sort((a, b) => ORDER.indexOf(a.k) - ORDER.indexOf(b.k)).slice(0, limit);
}

// Here (lib/home-book-data.js): the place's story and its recording from its lore page's data (lore.site_lore build), and
// the add-on's questions there. Without the data (tests, a broken deploy) the questions stand alone.
async function hereOf(env, request) {
  const stem = HERE.key.replace(/[^\w-]/g, "_");
  let page = null, voices = [];
  try {
    const file = path => env.ASSETS.fetch(new URL(path, request.url)).then(r => (r.ok ? r.json() : null));
    [page, voices] = await Promise.all([file(`/lore/data/e/${stem}.json`), file("/lore/data/index.json").then(i => i?.voices || [])]);
  } catch (e) { /* none */ }
  const story = (page?.clips || []).find(c => c.part === "narration");
  const [id, take] = Object.entries(story?.voices || {}).find(([, v]) => /^[a-f0-9]{6,}$/.test(v?.sha || "")) || [];
  return {
    name: HERE.name, page: HERE.page, label: page?.label || "",
    story: story?.paras || (page?.description ? [page.description] : []),
    voice: take ? { who: (voices.find(v => v.id === id)?.name || "narrator").toLowerCase(),
      url: `/audio/clip/${id}/${stem}-${take.sha}.mp3`, sec: Number(take.sec) || 0 } : null,
    asks: HERE.asks,
  };
}

// The day a picture was taken, on the player's own clock when the journey says it (tz: minutes from UTC).
const pictureDay = (t, tz) => {
  const d = new Date((t + (Math.abs(tz) <= 840 ? tz : 0) * 60) * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

// The book, or null when the profile isn't public (or isn't there). request: for the lore links file.
export async function homeBook(env, request, handle = env.HOME_BOOK_HANDLE || HOME_HANDLE) {
  const p = await profileByHandle(env, String(handle).toLowerCase());
  if (!p || !p.public) return null;
  const d = p.data;
  const names = await loadLinks(env, request);
  const lore = featureOn(env, "lore") ? names : null;
  const list = moments(d, names, p.journey);
  const chs = chapters(list, d.name, sideOf(d));
  const tz = Number.isInteger(p.journey?.tz) ? p.journey.tz : 0;
  const pics = featureOn(env, "pictures") ? await listPictures(env, p.user_id) : [];
  const matched = timelinePictures(list, pics);
  const chapterOf = new Map();
  const picture = r => ({
    url: pictureUrl(r), w: Number(r.w) || 1920, h: Number(r.h) || 1080, where: placeOf(r),
    when: [pictureDay(r.t, tz), r.lv ? `Level ${r.lv}` : ""].filter(Boolean).join(" · "), caption: r.caption || "",
    ch: chapterOf.get(r.id) || 0,
  });
  const book = chs.map(c => {
    const shots = c.ms.flatMap(m => matched.get(m) || []);
    for (const r of shots) chapterOf.set(r.id, c.n);
    return { c, shots };
  });
  const chapterList = book.map(({ c, shots }) => ({
    n: c.n, when: shortWhen(c), long: chapterWhen(c), title: c.title,
    route: c.lands.slice(0, ROUTE).map(l => l.name),
    summary: c.summary,
    facts: c.hi.slice(0, 8).map(factLine),
    pictures: shots.slice(0, 3).map(picture),
    found: pagesOf(c.ms, lore, { fresh: c.fresh, lands: c.lands }),
  })).reverse();   // the newest first, as the profile reads

  // Found, as the add-on's: a chapter for each zone (the one he was in last first), its pages by kind out of the add-on's
  // own (lib/home-book-data.js CHAPTERS, his side's quests only), and the pictures he took there. People are the ones
  // he met and the bosses he beat.
  const side = String(d.faction || "").toLowerCase();
  const chaptersByName = new Map(Object.entries(CHAPTERS).map(([name, c]) => [norm(name), c]));
  const zones = new Map();
  for (const m of [...list].reverse()) {
    if (!KIND[m.k] || !m.e?.zone || m.e.battleground || battleground(m.e.zone)) continue;
    const key = landOf(m.e.zone);
    if (!zones.has(key)) zones.set(key, []);
    zones.get(key).push(m);
  }
  const shown = pics.filter(r => !r.hidden);
  const shelf = [...zones].map(([name, ms]) => {
    const pages = pagesOf(ms, lore, { limit: Infinity });
    const all = chaptersByName.get(norm(name));
    const total = { places: all?.places, people: all?.people, items: all?.items,
      quests: all && all.quests[0] + (side === "alliance" ? all.quests[1] : side === "horde" ? all.quests[2] : all.quests[1] + all.quests[2]) };
    const of = (kind, ...ks) => {
      const l = pages.filter(x => ks.includes(x.k));
      return { n: l.length, of: Math.max(l.length, total[kind] || 0), list: l.slice(0, FOUND) };
    };
    const kinds = { places: of("places", "zone", "place"), people: of("people", "person", "boss"), items: of("items", "item"),
      quests: of("quests", "quest") };
    return { name, n: pages.length, of: Object.values(kinds).reduce((a, k) => a + k.of, 0), ...kinds,
      pictures: shown.filter(r => r.zone && landOf(r.zone) === name).slice(0, ZONE_PICTURES).map(picture) };
  }).filter(z => z.n);

  // Storylines, as the add-on lists them: each storyline a quest he finished is part of, the one he was on last first,
  // with its quests he has done in the order he did them.
  const lines = new Map();
  for (const m of list) {
    if (m.k !== "quests" || !m.story) continue;
    if (!lines.has(m.quest.sl)) lines.set(m.quest.sl, { name: m.story.name, zone: m.story.zone, pages: m.story.pages, quests: [], last: 0 });
    const s = lines.get(m.quest.sl);
    if (!s.quests.some(q => q.name === m.e.title)) s.quests.push({ k: "quest", name: m.e.title, ...(lore && m.quest.p ? { href: m.quest.p } : {}) });
    s.last = m.o;
  }
  const storylines = [...lines.values()].sort((a, b) => b.last - a.last)
    .map(({ name, zone, pages, quests }) => ({ name, zone, n: quests.length, of: Math.max(quests.length, pages || 0), quests }));

  const t = d.totals || {};
  const deaths = d.stats ? d.stats.deaths : (d.deaths || []).length;
  const lands = new Set(chs.flatMap(c => c.lands.map(l => l.key))).size;
  const last = [...list].reverse().find(m => m.e?.zone && !m.e.battleground && !battleground(m.e.zone));

  return {
    ok: true, handle: p.handle, name: d.name, initial: Array.from(d.name || "?")[0],
    sheet: sheetLine(d), side: d.faction || "", realm: d.realm || "",
    seen: last ? { zone: last.e.zone, day: shortDay(last.day) } : null,
    stats: [[t.quests, "quests"], [t.places, "places"], [t.people, "people met"], [t.bosses, "bosses"], [lands, "lands"],
      [deaths, "deaths"]].filter(([n]) => Number.isFinite(Number(n))).map(([n, label]) => [Number(n), label]),
    here: await hereOf(env, request),
    found: { zones: shelf },
    chapters: chapterList,
    storylines,
    updated: p.updated || "",
  };
}
