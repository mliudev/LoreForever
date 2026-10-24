// What each download pack holds (LOR-437): on /downloads, "Comes with it" next to the download buttons, then a tile
// per extra pack (what it adds, lines to hear, its count, and under "Get it" each pack's size, needs and links) and
// "Your language", which gathers every pack in one language (text, narrators, quest dialogue, community voices); on
// /lore/<type>/<id>, which packs have that page's recording. The facts come from public/data/packs.json and
// pack-entries.json, which pipeline/lore/site_packs.py writes from the packs the release ships (counts, examples,
// CurseForge projects), so nothing here is a hand-written number. The words around them are here.
// Whether a pack shows is decided now, from voices.json and translate/packs.json (a pack goes live there after its
// release), so the generated files list every pack the release builds.
// The examples play from /audio/clip/ like the lore pages (R2; site_packs upload puts them there), only on a click,
// and only when R2's manifest has them.

import { escape } from "./voices.js";
import { AUDIO } from "./lore.js";

const n = x => Number(x || 0).toLocaleString("en-US");
const list = arr => arr.length > 1 ? arr.slice(0, -1).join(", ") + " and " + arr.at(-1) : arr[0] || "";
const released = item => item && (!item.status || item.status === "live");
const plural = (k, word, words = word + "s") => `${n(k)} ${k === 1 ? word : words}`;
const upper = s => String(s).replace(/^./, c => c.toUpperCase());
const CF = "https://www.curseforge.com/wow/addons/";
const SLUG = /^[a-z0-9-]+$/;
const ASSET = /^[A-Za-z0-9.+_-]+:[A-Za-z0-9 ._()+-]+$/;
const LOCALE = /^[a-z]{2}[A-Z]{2}$/;

const locale = folder => /_([a-z]{2}[A-Z]{2})$/.exec(folder)?.[1] || "";

export const anchorOf = folder => "pack-" + String(folder).replace(/^LoreForever_/, "").toLowerCase().replace(/_/g, "-");
export const groupAnchor = id => "packs-" + id;

async function assetJson(env, request, path) {
  try {
    const res = await env.ASSETS.fetch(new URL(path, request.url));
    return res.ok ? await res.json() : null;
  } catch (e) {
    return null;
  }
}
export const loadPacks = (env, request) => assetJson(env, request, "/data/packs.json");
export const loadPackEntries = (env, request) => assetJson(env, request, "/data/pack-entries.json");
export const loadSizes = (env, request) => assetJson(env, request, "/data/download-files.json");

// The catalog row behind a pack folder: [voice, its pack or null], from voices.json.
function catalogRow(voices, folder) {
  for (const v of voices || []) {
    if (v.addon === folder || v.edition?.textAddon === folder) return [v, null];
    for (const p of v.packs || []) if (p.addon === folder) return [v, p];
  }
  return [null, null];
}

// The folders whose pack is out: the main download's, and the rest once voices.json (or translate/packs.json, for
// the text packs) says they're released. An edition's text add-on shows with its recordings.
export function visiblePacks(data, voices = [], langs = []) {
  const out = new Set();
  for (const [folder, f] of Object.entries(data?.packs || {})) {
    if (f.in_main) { out.add(folder); continue; }
    if (f.kind === "text") { if (langs.some(p => `LoreForever_Lang_${p.locale}` === folder && p.download)) out.add(folder); continue; }
    if (f.kind === "edition-text") continue;
    const [v, p] = catalogRow(voices, folder);
    if (v && released(v) && (!p || released(p))) out.add(folder);
  }
  return out;
}

// "Pick the voice" words for a pack's kinds: {zone: 43, capital: 6, subzone: 7} -> "49 zones and capitals and 7 places".
export function kindsPhrase(f) {
  const k = f.kinds || {};
  if (k.quest) return `${plural(k.quest, "recording")} for ${plural(f.entries, "quest")}`;
  const parts = [];
  const zones = (k.zone || 0) + (k.capital || 0);
  if (zones) parts.push(k.capital ? `${n(zones)} zones and capitals` : plural(zones, "zone"));
  if (k.dungeon) parts.push(plural(k.dungeon, "dungeon"));
  if (k.subzone) parts.push(plural(k.subzone, "place"));
  if (k.npc) parts.push(plural(k.npc, "character"));
  if (k.boss) parts.push(plural(k.boss, "boss", "bosses"));
  if (k.topic) parts.push(plural(k.topic, "topic"));
  if (k.answer) parts.push(plural(k.answer, "answer"));
  return list(parts);
}

// The answers packs' subjects (site_packs.py ANSWER_PARTS), as the answers tile says them, in its order.
const ANSWERS_ABOUT = { "zones and places": "places", people: "people", quests: "quests", "lore and items": "lore and items" };
const RACES = { human: "human", dwarf: "dwarf", forsaken: "Forsaken", orc: "orc", troll: "troll", goblin: "goblin",
  skyborne: "Skyborne", gnome: "gnome", tauren: "tauren", nightelf: "night elf" };
const raceOf = id => RACES[String(id).split("-")[0]] || String(id).split("-")[0];
function racesOf(voices) {
  const seen = [];
  for (const id of Object.keys(voices || {})) if (!seen.includes(raceOf(id))) seen.push(raceOf(id));
  return seen;
}

// Size of a release file ("latest:LoreForever.zip", "languages:LoreForever_Lang_deDE-0.14.0.zip") from the release
// snapshot (public/data/download-files.json); voices-page.js refreshes it from /api/download-files.
function bytesOf(ref, sizes) {
  const i = ref.indexOf(":"), tag = ref.slice(0, i) === "latest" ? sizes?.publishedTag : ref.slice(0, i);
  const v = sizes?.byTag?.[tag]?.[ref.slice(i + 1)];
  return typeof v === "number" && v > 0 ? v : null;
}
export function formatBytes(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "";
  return bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + " GB" : bytes >= 1e6 ? Math.round(bytes / 1e6) + " MB" : Math.max(1, Math.round(bytes / 1e3)) + " KB";
}
function sizeSpan(refs, sizes) {
  refs = [...new Set(refs.filter(r => ASSET.test(r || "")))];
  if (!refs.length) return "";
  const bytes = refs.map(r => bytesOf(r, sizes));
  const shown = bytes.every(b => b) ? formatBytes(bytes.reduce((a, b) => a + b, 0)) : "";
  const attr = refs.length === 1 ? ` data-asset="${escape(refs[0])}"` : ` data-assets="${escape(JSON.stringify(refs))}"`;
  return `<span class="dl-size"${attr}>${shown || "Size unavailable"}</span>`;
}

// ---- The words: a tile per extra pack, then "Your language" ----

const ICONS = {
  voice: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>',
  answer: '<path d="M4 5h16v11H9l-5 4z"/><path d="M10 9.2a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.5M12 14.2h0"/>',
  quest: '<path d="M7 4h11a2 2 0 0 1 0 4h-1v10a2 2 0 0 1-2 2H6a2 2 0 0 1 0-4h1z"/><path d="M7 16V4M10 9h4M10 12h4"/>',
  givers: '<circle cx="8" cy="9" r="3"/><circle cx="16.5" cy="8" r="2.5"/><path d="M2.5 19c.5-3 2.7-5 5.5-5s5 2 5.5 5M13 14.2c1-.8 2.2-1.2 3.5-1.2 2.6 0 4.5 1.8 5 4.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
};
const icon = k => `<span class="pk-ico" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[k]}</svg></span>`;

// The English tiles, in this order; every pack in another language goes to "Your language".
const TILES = {
  female: {
    icon: "voice", title: "Female narrator", line: "The same stories in a second voice.",
    meta: f => `<strong>${n(f.recordings)}</strong> recordings`,
    hint: () => "Keep both narrators and choose who goes first, in Options.",
  },
  original: {
    icon: "voice", title: "Original male narrator", line: "The voice Lore Forever started with.",
    meta: f => `<strong>${n(f.recordings)}</strong> recordings`,
    hint: () => "Once installed his stories play first. Move him down in Options to hear the new narrator again.",
  },
  answers: {
    icon: "answer", title: "Recorded answers", line: "Ask about anything and hear the answer.",
    meta: f => ["female", "male"].filter(w => f.byVoice[w]).map(w => `<strong>${n(f.byVoice[w])}</strong> ${w}`).join(" · ") + " answers",
    hint: f => `Answers about ${list(f.parts)}, in parts. Get the ones for the narrator you use.`,
  },
  quests: {
    icon: "quest", title: "Quest dialogue", line: "Quest givers read their words aloud.",
    meta: f => `<strong>${n(f.quests)}</strong> quests`,
    hint: () => "Then turn on Speak quest dialogue in Options. Skip it if Spoken or another add-on already voices your quests.",
  },
  questgivers: {
    icon: "givers", title: "Quest givers' voices", line: "A dwarf sounds like a dwarf.",
    meta: f => `<strong>${n(f.recordings)}</strong> lines`,
    hint: f => `${upper(list(f.races))} quest givers; the rest use your narrator's quest dialogue.`,
  },
};
// Groups whose packs all go to "Your language", and the order its rows take.
const LANGUAGE_GROUPS = ["text", "languages", "quests", "answers", "community"];

// The numbers a tile's words use, from its packs that are out.
function groupFacts(id, folders, data) {
  const ps = folders.map(f => data.packs[f]);
  const out = { recordings: ps.reduce((a, p) => a + (p.recordings || 0), 0), byVoice: {} };
  // Per narrator, for the tiles whose packs come in both voices: what one player gets.
  folders.forEach((f, i) => {
    const who = /_Female(_|$)/.test(f) ? "female" : /_Default(_|$)/.test(f) ? "male" : "";
    if (who) out.byVoice[who] = (out.byVoice[who] || 0) + (ps[i].recordings || 0);
  });
  if (id === "answers") {
    const about = ps.map(p => String(p.name).replace(/^.*?answers about /, "").replace(/, levels? .*$/, ""));
    out.parts = Object.entries(ANSWERS_ABOUT).filter(([k]) => about.includes(k)).map(([, v]) => v);
  }
  if (id === "quests") out.quests = Math.max(0, ...ps.map(p => p.entries || 0));
  if (id === "questgivers") out.races = racesOf(ps[0]?.voices);
  return out;
}

// ▶ chips: each is a link to its recording (so it works without JavaScript; /js/packs.js plays it in the page), and
// its line sits in a caption that shows while it plays. Only examples R2 has get a chip.
function chips(examples, live, data, ids) {
  const playable = examples.filter(ex => ex.audio && live.has(ex.audio));
  if (!playable.length) return "";
  const parts = playable.map(ex => {
    const pack = data.packs[ex.pack] || {};
    const id = `pk-cap-${++ids.n}`;
    const lang = escape(ex.lang || "en");
    const who = ex.speaker ? upper(raceOf(ex.speaker)) : "";
    const label = who ? `${who}: ${ex.title}` : ex.title;
    const chip = `<a class="pk-play" href="${escape(AUDIO + ex.audio)}" role="button" aria-label="Play ${escape([ex.title, pack.name].filter(Boolean).join(", "))}" data-cap="${id}"><span class="pk-pl" aria-hidden="true">&#9654;</span><span class="pk-t" lang="${lang}">${escape(label)}</span></a>`;
    const where = [ex.where, who && `${who} quest giver`, pack.name].filter(Boolean).join(" · ");
    const cap = `<p class="pk-cap" id="${id}" hidden><small>${escape(where)}</small> <span lang="${lang}">${escape(ex.text)}</span></p>`;
    return [chip, cap];
  });
  return `<div class="pk-chips">${parts.map(p => p[0]).join("")}</div>${parts.map(p => p[1]).join("")}`;
}

// One pack under "Get it": its name, what it holds, what it needs, and its links and size; extra goes under its words.
// A CurseForge project that holds several of a tile's packs gets one button, on the first of them (seen: its slugs).
function packRow(folder, f, data, sizes, label = f.name, extra = "", seen = new Set()) {
  const name = x => data.packs[x]?.name || x;
  const onlyAnswers = Object.keys(f.kinds || {}).join() === "answer";
  let what = "";
  if (f.recordings) what = onlyAnswers ? plural(f.recordings, "answer")
    : `${plural(f.recordings, "recording")}${f.kinds?.quest ? ` for ${plural(f.entries, "quest")}` : `: ${kindsPhrase(f)}`}`;
  else if (f.kind === "text") what = `${plural(f.entries, "entry", "entries")} translated, with the menus`;
  const needs = (f.needs || []).filter(x => data.packs[x] && data.packs[x].kind !== "edition-text").map(name);
  const get = [];
  const slug = f.curseforge && SLUG.test(f.curseforge.slug || "") ? f.curseforge.slug : "";
  if (slug && !seen.has(slug)) {
    seen.add(slug);
    const together = (f.curseforge.with || []).filter(x => data.packs[x]).length;
    get.push(`<a class="btn-small pk-cf" href="${CF}${escape(slug)}" aria-label="Get ${escape(f.name)} on CurseForge">CurseForge</a>${together ? ` <small>all ${together + 1} in one</small>` : ""}`);
  }
  if (/^\/download\/(voice|lang)\/[A-Za-z0-9-]+$/.test(f.download || "")) get.push(`<a class="dl-link" href="${escape(f.download)}" aria-label="Download ${escape(f.name)} as a ZIP">ZIP</a>`);
  const size = sizeSpan([f.file], sizes);
  return `<li class="pk-row" id="${escape(anchorOf(folder))}">
        <div class="pk-row-main"><p class="pk-row-name">${escape(label)}</p><p class="pk-row-what">${escape(what)}${needs.length ? `. Needs ${escape(list(needs))}` : ""}</p>${extra}</div>
        <p class="pk-row-get">${get.join(" ")}${size ? ` ${size}` : ""}</p>
      </li>`;
}

// /downloads, next to the download buttons: what every install has, with lines to hear. The packs' own anchors
// (#pack-voice-default-alliance, from the lore pages) are on their words.
export function comesSection(data, { voices = [], langs = [], live = new Set() } = {}) {
  const main = (data?.groups || []).find(g => g.id === "main");
  if (!main || !data.packs) return "";
  const shown = visiblePacks(data, voices, langs);
  const folders = main.packs.filter(f => data.packs[f] && shown.has(f));
  const core = folders.find(f => !data.packs[f].recordings);
  const byWho = new Map();
  for (const f of folders.filter(x => data.packs[x].recordings)) {
    const [, who, what] = /^(.*?): (.*)$/.exec(data.packs[f].name) || [, "Narrator", data.packs[f].name];
    if (!byWho.has(who)) byWho.set(who, []);
    byWho.get(who).push([f, what]);
  }
  const voiceLines = [...byWho].map(([who, parts]) => {
    const total = parts.reduce((a, [f]) => a + data.packs[f].recordings, 0);
    return `<li>The ${escape(who.toLowerCase())}, <strong>${n(total)}</strong> recordings: ${list(parts.map(([f, what]) => `<span id="${escape(anchorOf(f))}">${escape(what)}</span>`))}</li>`;
  });
  const ids = { n: 0 };
  return `<aside class="pk-comes" id="${groupAnchor("main")}" aria-labelledby="${groupAnchor("main")}-title">
      <h2 id="${groupAnchor("main")}-title">Comes with it <span class="pk-tag">In every install</span></h2>
      <ul>
        ${core ? `<li id="${escape(anchorOf(core))}"><strong>${n(data.packs[core].entries)}</strong> lore entries to read and ask about</li>` : ""}
        ${voiceLines.join("\n        ")}
      </ul>
      ${chips((main.examples || []).filter(ex => shown.has(ex.pack)), live, data, ids)}
    </aside>`;
}

// /downloads: a tile per English extra pack, then "Your language" with the rest, by language.
export function extrasSection(data, { voices = [], langs = [], sizes = null, live = new Set() } = {}) {
  if (!data?.groups || !data.packs) return "";
  const shown = visiblePacks(data, voices, langs);
  const english = f => !data.packs[f].locale || data.packs[f].locale === "enUS";
  const ids = { n: 1000 };
  const tiles = Object.entries(TILES).map(([id, words]) => {
    const g = data.groups.find(x => x.id === id);
    const folders = (g?.packs || []).filter(f => data.packs[f] && shown.has(f) && english(f));
    if (!folders.length) return "";
    const facts = groupFacts(id, folders, data);
    const oneVoice = Object.keys(facts.byVoice).length <= 1 || id === "female";
    const total = oneVoice ? sizeSpan(folders.map(f => data.packs[f].file).filter(Boolean), sizes) : "";
    const examples = (g.examples || []).filter(ex => folders.includes(ex.pack));
    const anchor = groupAnchor(id), seen = new Set();
    return `<article class="pk-tile dl-card" id="${anchor}" aria-labelledby="${anchor}-title">
      <div class="pk-head">${icon(words.icon)}<div><h3 id="${anchor}-title">${escape(words.title)}</h3><p>${escape(words.line)}</p></div></div>
      ${chips(examples, live, data, ids)}
      <details class="pk-get">
        <summary><span class="pk-meta">${words.meta(facts)}${total ? ` · ${total}` : ""}</span><span class="pk-get-btn">Get it</span></summary>
        <ul class="pk-rows">
      ${folders.map(f => packRow(f, data.packs[f], data, sizes, undefined, "", seen)).join("\n      ")}
        </ul>
        <p class="pk-hint">${escape(words.hint(facts))}</p>
      </details>
    </article>`;
  });
  return tiles.join("\n") + languagesTile(data, shown, langs, sizes, live, ids);
}

// "Your language": every pack in a language other than English, a panel per language (text first, then narrators,
// quest dialogue, answers, community voices). /js/packs.js turns the panels into a language picker.
function languagesTile(data, shown, langs, sizes, live, ids) {
  const byLocale = new Map();
  for (const gid of LANGUAGE_GROUPS) {
    const g = data.groups.find(x => x.id === gid);
    for (const f of g?.packs || []) {
      const p = data.packs[f];
      if (!p || !shown.has(f) || p.in_main || p.kind === "edition-text") continue;
      const loc = p.locale || locale(f);
      if (!LOCALE.test(loc) || (loc === "enUS" && !["community", "text"].includes(gid))) continue;
      if (!byLocale.has(loc)) byLocale.set(loc, { folders: [], examples: [] });
      byLocale.get(loc).folders.push(f);
      byLocale.get(loc).examples.push(...(g.examples || []).filter(ex => ex.pack === f));
    }
  }
  if (!byLocale.size) return "";
  const nameOf = loc => langs.find(p => p.locale === loc)?.name || loc;
  const textOrder = data.groups.find(g => g.id === "text")?.packs.map(locale) || [];
  const locales = [...byLocale.keys()].sort((a, b) => (textOrder.indexOf(a) + 1 || 99) - (textOrder.indexOf(b) + 1 || 99));
  const short = (p, lang) => p.kind === "text" ? "Text" : String(p.name).replace(new RegExp(`[:,] ${lang.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
  const panels = locales.map(loc => {
    const { folders, examples } = byLocale.get(loc), lang = nameOf(loc), tag = loc.slice(0, 2);
    const seen = new Set();
    const rows = folders.map(f => packRow(f, data.packs[f], data, sizes, short(data.packs[f], lang),
      chips(examples.filter(e => e.pack === f).slice(0, 1), live, data, ids), seen));
    return `<div class="pk-lang" data-lang="${escape(loc)}">
        <h4 lang="${escape(tag)}">${escape(lang)}</h4>
        <ul class="pk-rows">
        ${rows.join("\n        ")}
        </ul>
      </div>`;
  });
  const anchor = groupAnchor("languages");
  return `
    <article class="pk-tile pk-tile-wide dl-card" id="${anchor}" aria-labelledby="${anchor}-title">
      <div class="pk-head">${icon("globe")}<div><h3 id="${anchor}-title"><span id="languages"></span><span id="${groupAnchor("text")}"></span><span id="${groupAnchor("community")}"></span>Your language</h3><p>Text, narrators and quest dialogue in your language.</p></div></div>
      <div class="pk-langs" role="group" aria-label="Pick your language" hidden>
        ${locales.map(loc => `<button type="button" data-lang="${escape(loc)}" lang="${escape(loc.slice(0, 2))}" aria-pressed="false">${escape(nameOf(loc).replace(/ \(.*\)$/, ""))}</button>`).join("\n        ")}
      </div>
      <p class="pk-lang-hint" hidden>Pick yours to see its text and voices.</p>
      ${panels.join("\n      ")}
      <p class="pk-hint">Lore Forever follows your WoW client's language. Change it in Options &rsaquo; Lore Forever &rsaquo; Language, or type <code>/lore lang</code>. Missing yours? <a href="/translate">Help translate</a>.</p>
    </article>`;
}

// /lore/<type>/<id>: the packs that have a recording of this page, [{name, href, main}], packs out only.
export function packsForEntry(key, entries, data, shown) {
  const idx = entries?.entries?.[key];
  if (!Array.isArray(idx) || !data?.packs) return [];
  return idx.map(i => entries.packs[i]).filter(f => f && data.packs[f] && (!shown || shown.has(f)))
    .map(f => ({ name: data.packs[f].name, href: `/downloads#${anchorOf(f)}`, main: Boolean(data.packs[f].in_main) }));
}

// The language a pack's recordings speak, in English, for /lore's "plays in French in the add-on".
const LANGUAGE = { deDE: "German", frFR: "French", esES: "Spanish", esMX: "Spanish", ptBR: "Brazilian Portuguese",
  itIT: "Italian", ruRU: "Russian", ukUA: "Ukrainian", zhCN: "Simplified Chinese" };

// What /lore plays when a pack is picked (site_packs.py writes it): an English narrator's pack plays its narrator's
// recordings in the list where it has them ({voice}); where it has none (another language, the "more" packs, the
// quest givers), /lore says what language it plays in, in the add-on, and offers the pack's own sample ({lang,
// sample}), or none ("No sample yet"), never the English recording.
export function packPlays(folder, data) {
  const f = data?.packs?.[folder];
  if (!f) return {};
  const loc = f.locale || locale(folder);
  const out = f.lore_voice ? { voice: f.lore_voice } : {};
  const lang = LANGUAGE[loc] || (loc && !/^en/.test(loc) ? loc : "");
  if (lang) out.lang = lang;
  if (f.sample?.audio) out.sample = { audio: f.sample.audio, title: f.sample.title || "", lang: f.sample.lang || loc.slice(0, 2), key: f.sample.key || "" };
  return out;
}

// /lore's pack filter: the packs that have recordings of some page, as <option>s, each with what it plays (packPlays)
// and where to get it.
export function packOptions(entries, data, shown) {
  if (!entries?.packs || !data?.packs) return [];
  return entries.packs.filter(f => data.packs[f] && (!shown || shown.has(f)))
    .map(f => ({ value: f, name: data.packs[f].name, href: `/downloads#${anchorOf(f)}`, ...packPlays(f, data) }));
}
