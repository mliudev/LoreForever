// /downloads, "Pick a bundle" (LOR-848, Mike's pick 10/26): what each of the three cards holds for each language and
// narrator, worked out from the release's own facts so no pack, size or project is typed in here: public/data/packs.json
// (each pack's folder, CurseForge project, ZIP and what it needs), voices.json and translate/packs.json (what's out, and
// the one-ZIP bundles), and the release snapshot (public/data/download-files.json) for sizes. public/js/bundles.js draws it.
//   The add-on   English: the core (the male narrator), or the female narrator with her Alliance and Horde lands.
//                Another language: its narration, which carries that language's text.
//   Storyteller  English: the narrator's more places, people, quest and item stories. Another language: more people.
//   Everything   Storyteller plus quest dialogue; in English also the quest givers' voices (English only).
// A language with no narration (Russian) is its text plus an English narrator. Never on the page (Mike, 10/26): the
// original male narrator (his packs keep working in game for the players who have him), and a "text only" choice for
// a language that has a narrator.

import { visiblePacks, anchorOf, formatBytes } from "./packs.js";
import { AUDIO } from "./lore.js";
import { escape } from "./voices.js";

// The bar's languages, in order. One shows once it has narration or its text is out.
const LANGS = [["en", "enUS"], ["de", "deDE"], ["es", "esES"], ["fr", "frFR"], ["pt", "ptBR"], ["it", "itIT"],
  ["ru", "ruRU"], ["uk", "ukUA"], ["ro", "roRO"]];
const ENGLISH = { deDE: "German", esES: "Spanish", frFR: "French", ptBR: "Portuguese", itIT: "Italian", ruRU: "Russian",
  ukUA: "Ukrainian", roRO: "Romanian", zhCN: "Chinese" };
const CORE = { slug: "lore-forever", name: "Lore Forever" };
// Rows 0.29.0's Setup offers on its voice page, by its own names. The releases after it read the pick from the file's
// name and have a row per card (release/installer/LoreForever.iss PickedVoice): the English cards come ticked, and a
// card says only what Setup can't install yet.
const SETUP_ROW = { Female: "Female narrator", Default: "Quest dialogue and more (male narrator)" };
export const SETUP_PICKS_AFTER = "0.29.0";
const newer = (tag, than) => {
  const a = String(tag || "").replace(/^v/, "").split(".").map(Number), b = than.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i];
  return false;
};
const ORIGINAL = /^LoreForever_Voice_Original(_|$)/;

const upper = s => String(s).replace(/^./, c => c.toUpperCase());
const english = loc => ENGLISH[loc] || loc;
const narration = folder => /^LoreForever_Voice_(Default|Female)_[a-z]{2}[A-Z]{2}$/.test(folder);

function bytesOf(ref, sizes) {
  const i = String(ref || "").indexOf(":");
  if (i < 1) return 0;
  const tag = ref.slice(0, i) === "latest" ? sizes?.publishedTag : ref.slice(0, i);
  const v = sizes?.byTag?.[tag]?.[ref.slice(i + 1)];
  return typeof v === "number" && v > 0 ? v : 0;
}
const releaseRef = url => {
  const m = /\/releases\/(?:latest\/download|download\/([^/]+))\/([^/]+)$/.exec(String(url || ""));
  return m ? `${m[1] || "latest"}:${decodeURIComponent(m[2])}` : "";
};

// The quest levels a card's packs cover: "all levels", or the bands recorded so far.
const BANDS = { Quests: "1-25", Quests2: "26-50", Quests3: "51-60", QuestGivers: "1-30", QuestGivers2: "31-50", QuestGivers3: "51-60" };
function levels(folders) {
  const have = folders.map(f => /_(Quests[23]?|QuestGivers[23]?)$/.exec(f)?.[1]).filter(Boolean);
  if (have.length !== folders.length || have.length === 3) return "all levels";
  return `levels ${BANDS[have[0]].split("-")[0]}-${BANDS[have.at(-1)].split("-")[1]}`;
}

// A pack's name in "Every file" and the ZIP lists, without the narrator and language its heading already says.
export function rowName(folder, f) {
  if (narration(folder)) return `Stories, with the ${english(f.locale)} text`;
  if (/_Female$/.test(folder)) return "Zone, place and dungeon stories";
  if (f.kind === "text") return `${english(f.locale)} text`;
  return upper(String(f.name || folder).replace(/^Lore Forever: /, "").replace(/^(Male|Female) narrator: /, "")
    .replace(/ \((male|female) narrator\)/, "").replace(/( -|,) (Deutsch|Español.*|Français|Português.*|Italiano)$/, ""));
}
// A pack's CurseForge project, as a card's links name it.
function projectName(folder, f) {
  if (/^LoreForever_Voice_Female(_Alliance)?$/.test(folder)) return "Female Narrator";
  if (/_QuestGivers/.test(folder)) return "Quest givers' voices";
  if (/_Quests[23]?(_|$)/.test(folder)) return "Quest dialogue";
  if (narration(folder)) return `${english(f.locale)} narration`;
  return rowName(folder, f);
}

export function buildCatalog(data, { voices = [], langs = [], sizes = null, live = new Set() } = {}) {
  if (!data?.packs) return null;
  const P = data.packs, shown = visiblePacks(data, voices, langs);
  const has = f => Boolean(P[f]) && shown.has(f) && !ORIGINAL.test(f);
  const picks = newer(sizes?.publishedTag, SETUP_PICKS_AFTER);   // the published Setup reads its name
  const langName = loc => loc === "enUS" ? "English" : String(langs.find(p => p.locale === loc)?.name || loc).replace(/ \(.*\)$/, "");
  const sample = f => {
    const s = P[f]?.sample;
    return s?.audio && live.has(s.audio) ? { src: AUDIO + s.audio, title: s.title || "" } : null;
  };
  const mainZip = { href: "/download/zip", name: "Lore Forever add-on", bytes: bytesOf("latest:LoreForever.zip", sizes) };
  // One-ZIP bundles (voices.json packs with "contains": the female narrator's stories and lands in one ZIP).
  const ones = voices.filter(v => v.status === "live").flatMap(v => (v.packs || []).filter(p => p.contains?.length && p.download)
    .map(p => ({ ids: p.contains, zip: { href: `/download/voice/${p.id}`, name: p.name, bytes: bytesOf(releaseRef(p.download), sizes) } })));

  // The CurseForge projects that install a card's packs, each once, in order. A pack that a project listed before it
  // brings (that project's file requires it: packs.json "needs") is left out, so Female Narrator alone brings her lands
  // once it requires them. A pack with no project of its own leaves the card without a CurseForge way.
  function projects(folders, lead = []) {
    const out = [...lead], brought = new Set();
    for (const f of folders) {
      const cf = P[f].curseforge;
      if (brought.has(f)) continue;
      if (!cf?.slug) return [];
      if (!out.some(p => p.slug === cf.slug)) out.push({ slug: cf.slug, name: projectName(f, P[f]) });
      for (const n of [...(P[f].needs || []), ...(cf.with || [])]) brought.add(n);
    }
    return out.length ? out : [CORE];   // the core alone: the add-on with the male narrator
  }
  function zipsOf(folders) {
    let rest = folders.filter(f => P[f].download);
    const out = [mainZip];
    for (const one of ones) {
      const parts = rest.filter(f => one.ids.includes(P[f].catalog));
      if (parts.length === one.ids.length) { out.push(one.zip); rest = rest.filter(f => !parts.includes(f)); }
    }
    return out.concat(rest.map(f => ({ href: P[f].download, name: rowName(f, P[f]), bytes: bytesOf(P[f].file, sizes) })));
  }
  // A narrator's live "Complete" project that brings all of these packs (packs.json bundles, from release/curseforge.json).
  const bundleFor = folders => folders.length ? (data.bundles || []).find(b => folders.every(f => b.folders?.includes(f))) : null;
  // A card from its packs beyond the main download. inSetup: Setup can install its voices. bundle: the Complete
  // project that brings the first of them, opened first on CurseForge.
  function card(folders, lines, { setup = "", tick = "", inSetup = true, bundle = null } = {}) {
    const zips = zipsOf(folders);
    const lead = bundle ? [{ slug: bundle.slug, name: String(bundle.name).replace(/^Lore Forever - /, "") }] : [];
    return { ok: true, lines, setup, tick, inSetup, zips,
      extra: zips.filter(z => z !== mainZip).reduce((a, z) => a + z.bytes, 0),
      cf: projects(folders.filter(f => !bundle?.folders.includes(f)), lead) };
  }
  const off = why => ({ ok: false, why });

  // English for a narrator ("Default" or "Female"); text: a language's text pack when that language has no narration.
  function englishCards(V, text = "") {
    const who = V === "Female" ? "female" : "male", t = text ? [text] : [];
    const addon = V === "Female" ? ["", "_Alliance", "_Horde"].map(s => `LoreForever_Voice_Female${s}`).filter(has) : [];
    const more = ["MorePlaces", "MorePeople", "MoreItems", "MoreQuests1", "MoreQuests2", "MoreQuests3"].map(s => `LoreForever_Voice_${V}_${s}`).filter(has);
    const quests = ["", "2", "3"].map(s => `LoreForever_Voice_${V}_Quests${s}`).filter(has);
    const givers = ["", "2", "3"].map(s => `LoreForever_Voice_QuestGivers${s}`).filter(has);
    const textNote = text ? `The ${english(P[text].locale)} text isn't in Setup yet: add it with the ZIP or on CurseForge.` : "";
    // A Setup that reads its name ticks the whole card: only a language's text is left to say.
    const tick = (row, rest = "") => picks ? textNote : [`In Setup, tick “${row}”.${rest}`, textNote].filter(Boolean).join(" ");
    // Setup's name says the narration's language: English, also under a language that's read in English (Russian).
    const setup = s => `${who}, en, ${s}`, bundle = bundleFor([...addon, ...more]);
    const addonTick = V === "Female" ? tick(SETUP_ROW.Female) : textNote && (picks ? textNote : `Setup installs the add-on. ${textNote}`);
    // 0.29.0's male row brings his quest dialogue too, which Storyteller doesn't have: say so rather than hide it.
    const storyTick = tick(SETUP_ROW[V], V === "Default" ? " That row adds quest dialogue too." : "");
    const cards = {
      addon: card([...t, ...addon], [text ? `Every lore entry in ${english(P[text].locale)}` : "Every lore entry, to read and ask about",
        `The ${who} narrator reads zones, cities and dungeons${text ? " in English" : ""}`], { setup: setup("addon"), tick: addonTick }),
      storyteller: more.length
        ? card([...t, ...addon, ...more], ["Everything in The add-on", "People and bosses, more places, quest stories and item stories"],
          { setup: setup("storyteller"), tick: storyTick, bundle })
        : off("No more stories recorded for this narrator yet."),
    };
    cards.everything = quests.length || givers.length
      ? card([...t, ...addon, ...more, ...quests, ...givers], [more.length ? "Everything in Storyteller" : "Everything in The add-on",
        ...(quests.length ? [`Quest dialogue, ${levels(quests)}`] : []), ...(givers.length ? [`Quest givers' voices, ${levels(givers)}`] : [])],
        { setup: setup("everything"), bundle,
          tick: tick(SETUP_ROW[V], ` ${V === "Female" ? "Her quest dialogue and the" : "The"} quest givers' voices aren't in Setup yet: add them with the ZIP or on CurseForge.`) })
      : off("No quest dialogue recorded for this narrator yet.");
    return cards;
  }
  // Another language, for a narrator ("Default" or "Female"), from its narration pack (which carries the text). Setup
  // can't install it yet, so on Windows too its cards' button is CurseForge (or the ZIP), and the bar says why once.
  function languageCards(V, code, loc) {
    const base = `LoreForever_Voice_${V}_${loc}`, who = V === "Female" ? "female" : "male", name = english(loc);
    const more = [`LoreForever_Voice_${V}_MorePeople_${loc}`].filter(has), quests = [`LoreForever_Voice_${V}_Quests_${loc}`].filter(has);
    const setup = s => `${who}, ${code}, ${s}`, inSetup = false;
    return {
      addon: card([base], [`Every lore entry in ${name}`, `The ${who} narrator reads zones, cities and dungeons`], { setup: setup("addon"), inSetup }),
      storyteller: more.length ? card([base, ...more], ["Everything in The add-on", "People and bosses"], { setup: setup("storyteller"), inSetup })
        : off(`People and bosses aren't recorded in ${name} yet.`),
      everything: quests.length ? card([base, ...more, ...quests], [more.length ? "Everything in Storyteller" : "Everything in The add-on", "Quest dialogue, all levels"],
        { setup: setup("everything"), inSetup }) : off(`No quest dialogue in ${name} yet.`),
    };
  }
  // A community narrator (the Ukrainian narrator, Densuad's Spanish edition): The add-on only. An edition carries its
  // own text and has no CurseForge project: the add-on, then its ZIP.
  function communityCards(f, code, edition) {
    const lines = edition ? [`${P[f].credit || "The narrator"}'s own text and voice, together`, "Zone, people and boss stories"]
      : [`Every lore entry in ${english(P[f].locale)}`, `The ${P[f].name.toLowerCase()} reads zones, cities and dungeons`];
    return {
      addon: card([f], lines, { setup: `${edition ? "edition" : "community"}, ${code}, addon`, inSetup: false }),
      storyteller: off("Everything this narrator has recorded is in The add-on."),
      everything: off("No quest dialogue for this narrator yet."),
    };
  }
  // winNote: the bar's one line on Windows when Setup can't install this narrator's voices.
  const narrator = (id, name, who, f, cards, winNote = "") => ({ id, name, who, sample: sample(f), cards, winNote });

  const out = [];
  for (const [code, loc] of LANGS) {
    const narrators = [];
    let note = "";
    if (code === "en") {
      narrators.push(narrator("male", "Male narrator", "The main narrator. Comes with the add-on", "LoreForever_Voice_Default", englishCards("Default")));
      if (has("LoreForever_Voice_Female")) narrators.push(narrator("female", "Female narrator", "The same stories in a second voice", "LoreForever_Voice_Female", englishCards("Female")));
    } else {
      for (const [V, id] of [["Default", "male"], ["Female", "female"]]) {
        const f = `LoreForever_Voice_${V}_${loc}`;
        if (has(f) && P[f].group !== "community") narrators.push(narrator(id, `${upper(id)} narrator`, id === "male" ? "The main narrator" : "The same stories in a second voice", f,
          languageCards(V, code, loc), `Setup can't install ${english(loc)} voices yet, so they come from CurseForge or a ZIP.`));
      }
      for (const [f, p] of Object.entries(P)) {
        if (p.group !== "community" || p.kind !== "voice" || p.locale !== loc || !has(f)) continue;
        const edition = f.startsWith("LoreForever_Edition_");
        narrators.push(narrator(edition ? "edition" : "community", p.name,
          `Community narrator${p.credit ? `: ${p.credit}` : ""}${edition ? ". Their own text and voice" : ""}`, f, communityCards(f, code, edition),
          `Setup can't install ${edition ? "this edition" : `the ${p.name.toLowerCase()}`} yet, so it comes ${edition ? "as a ZIP" : "from CurseForge or a ZIP"}.`));
      }
      const text = `LoreForever_Lang_${loc}`;
      if (!narrators.length && has(text) && P[text].download) {
        note = "Stories are read in English for now.";
        narrators.push(narrator("male", "Male narrator, in English", "The main narrator", "LoreForever_Voice_Default", englishCards("Default", text)));
        if (has("LoreForever_Voice_Female")) narrators.push(narrator("female", "Female narrator, in English", "The same stories in a second voice", "LoreForever_Voice_Female", englishCards("Female", text)));
      }
    }
    if (narrators.length) out.push({ code, locale: loc, name: langName(loc), note, narrators });
  }
  return { version: data.version || "", base: { win: bytesOf("latest:LoreForever-Setup.exe", sizes), zip: mainZip.bytes }, langs: out };
}

// "Every file, by language and voice", folded under the cards for a player who wants one piece: each language, then
// each voice's files, with its size and its CurseForge project and ZIP. The rows keep the pack anchors the lore pages
// link to (#pack-voice-female-alliance). /js/downloads.js shows the picked language's files first.
export function everyFileHtml(data, { voices = [], langs = [], sizes = null } = {}) {
  if (!data?.packs) return "";
  const P = data.packs, shown = visiblePacks(data, voices, langs), done = new Set();
  const has = f => Boolean(P[f]) && shown.has(f) && !ORIGINAL.test(f);
  const cfLink = slug => `<a href="https://www.curseforge.com/wow/addons/${escape(slug)}">CurseForge</a>`;
  const row = (folders, name, { zip, ref, slug } = {}) => {
    const f = folders[0], ids = folders.filter(x => !done.has(x)).map(anchorOf);
    folders.forEach(x => done.add(x));
    const bytes = bytesOf(ref ?? P[f]?.file, sizes), href = zip ?? P[f]?.download, cf = slug ?? P[f]?.curseforge?.slug;
    return `<li class="ef-row"${ids.length ? ` id="${escape(ids[0])}"` : ""}>${ids.slice(1).map(i => `<span id="${escape(i)}"></span>`).join("")}` +
      `<span class="ef-name">${escape(name)}</span><span class="ef-size">${bytes ? formatBytes(bytes) : ""}</span>` +
      `<span class="ef-get">${[cf ? cfLink(cf) : "", href ? `<a href="${escape(href)}">ZIP</a>` : ""].filter(Boolean).join(" &middot; ")}</span></li>`;
  };
  const group = (title, rows) => rows.length ? `<h4>${escape(title)}</h4><ul class="ef-rows">${rows.join("")}</ul>` : "";
  const packRows = list => list.filter(has).map(f => row([f], rowName(f, P[f])));
  const narrator = (V, loc) => loc === "enUS"
    ? [...(V === "Default" ? [row(["LoreForever", "LoreForever_Voice_Default", "LoreForever_Voice_Default_Alliance", "LoreForever_Voice_Default_Horde"],
        "The add-on, with his stories and his Alliance and Horde lands", { zip: "/download/zip", ref: "latest:LoreForever.zip", slug: CORE.slug })]
      : packRows(["", "_Alliance", "_Horde"].map(s => `LoreForever_Voice_Female${s}`))),
      ...packRows(["MorePlaces", "MorePeople", "MoreItems", "MoreQuests1", "MoreQuests2", "MoreQuests3", "Quests", "Quests2", "Quests3"].map(s => `LoreForever_Voice_${V}_${s}`))]
    : packRows([`LoreForever_Voice_${V}_${loc}`, `LoreForever_Voice_${V}_MorePeople_${loc}`, `LoreForever_Voice_${V}_Quests_${loc}`]
      .filter(f => P[f]?.group !== "community"));
  const nameOf = loc => loc === "enUS" ? "English" : String(langs.find(p => p.locale === loc)?.name || loc).replace(/ \(.*\)$/, "");
  const locales = [...LANGS.map(l => l[1]), ...langs.map(p => p.locale).filter(l => !LANGS.some(x => x[1] === l))];
  const sections = locales.map(loc => {
    const code = LANGS.find(l => l[1] === loc)?.[0] || loc.slice(0, 2);
    const parts = [group("Male narrator", narrator("Default", loc)), group("Female narrator", narrator("Female", loc))];
    if (loc === "enUS") parts.push(group("Quest givers' voices", packRows(["", "2", "3"].map(s => `LoreForever_Voice_QuestGivers${s}`))));
    const community = Object.entries(P).filter(([f, p]) => p.group === "community" && p.kind === "voice" && p.locale === loc && has(f));
    for (const [f, p] of community) parts.push(group(p.name, [row(f.startsWith("LoreForever_Edition_") ? [f, ...(P[f].needs || [])] : [f], "Stories, with the text")]));
    // A language with no narrator of its own: its text, read by an English narrator. A language with one carries its
    // text in each narration download, so there's no text-only file to pick.
    const text = `LoreForever_Lang_${loc}`;
    if (!parts.some(Boolean) && has(text) && P[text].download) parts.push(group("Text", [row([text], `${nameOf(loc)} text, with an English narrator`)]));
    const body = parts.filter(Boolean).join("");
    return body ? `<section class="ef-lang" data-lang="${escape(code)}"><h3 lang="${escape(code)}">${escape(nameOf(loc))}</h3>${body}</section>` : "";
  });
  return sections.join("\n");
}
