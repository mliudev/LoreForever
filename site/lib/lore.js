// Lore pages (LOR-233, the start of LOR-20 and LOR-22): /lore lists every narration we ship, with filters, search and
// a player, and /lore/<type>/<id> is one page per entry (site/LORE_PAGES.md has the address scheme). The data is
// generated: pipeline/lore/site_lore.py writes public/lore/data/index.json and public/lore/data/e/<key>.json from the
// lore data and our voice packs (scripts/rebuild-generated.sh runs it). The recordings are in R2 (the STUDIO bucket,
// under narration/), uploaded by scripts/upload-narration-r2.sh. A page plays only what R2's manifest lists, so every
// page works, as text with a "hear it in game" line, before anything is uploaded. Kept outside functions/ so Pages
// doesn't route it.

import { page, escape, FRESH } from "./voices.js";
import { featureOn } from "./features.js";
import { zoneCard, LORE_INDEX_CARD } from "./social.js";
import { tr, levelsIn } from "./lore-strings.js";

// The flag: the "lore" site feature (lib/features.js), off until the recordings are in R2 and Mike says go. While
// it's off every lore page is served, but with noindex (meta tag and X-Robots-Tag), the sitemap lists none of them
// and nothing links here; on, header.js adds a Lore link. SITE_FEATURES=lore (a Pages variable) turns it on for a
// preview.
export const isPublic = env => featureOn(env, "lore");

export const HOME = "loreforeverwow.com";
export const DATA = "/lore/data";
export const AUDIO = "/audio/clip/";            // functions/audio/clip/[voice]/[file].js
export const R2_PREFIX = "narration/";
export const MANIFEST_KEY = "narration/manifest.json";
// <voice>/<clip file stem>-<first 10 hex of the recording's SHA-256>.<ext>, as site_lore.py audio_key writes them.
export const AUDIO_KEY = /^[a-z0-9-]{1,40}\/[A-Za-z0-9_-]{1,160}-[0-9a-f]{10}\.(mp3|ogg)$/;
export const DOWNLOAD = "/downloads?src=lore";

// Links out (LOR-263): plain links to Wowhead's WoW Forever database by game ID ("quest=176", from the language packs'
// client names: pipeline/lore/site_lore.py game_refs; nothing on the site comes from Wowhead) and to the Warcraft
// Wiki, which our lore is adapted from. A name with no ID or article gets the wiki's search, which goes straight to
// the article when one has that title.
export const WOWHEAD = "https://www.wowhead.com/forever/";
export const WIKI_SEARCH = "https://warcraft.wiki.gg/wiki/Special:Search?go=Go&search=";
const WOWHEAD_REF = /^(quest|npc|item|zone|faction|spell|object)=\d{1,9}$/;
export const wowheadUrl = ref => (WOWHEAD_REF.test(String(ref || "")) ? WOWHEAD + ref : null);
export const wikiSearch = name => (String(name || "").trim() ? WIKI_SEARCH + encodeURIComponent(String(name).trim()) : null);
const LIVE_TTL = 60 * 1000;

// The pages in other languages (LOR-809, pipeline/lore/site_i18n.py): /de/lore/zone/westfall reads
// lore-i18n/de/zone/westfall.json from R2, rendered by the same entryPage in its language. lore-i18n/index.json names the
// languages and, for each English page, the ones it has (bit i of its mask: langs[i]); lore-i18n/recordings.json, the
// recordings each language's pages play (scripts/narration-watch.sh checks R2 has them); lore-i18n/de/narration.json, what
// the /lore list plays in German. functions/api/admin/lore-i18n.js fills them; functions/[lang]/lore/ serves them.
export const I18N_PREFIX = "lore-i18n/";
export const I18N_KEY = /^(?:index\.json|recordings\.json|[a-z]{2}(?:-[a-z]{2})?\/(?:narration|[a-z]+\/[a-z0-9-]+)\.json)$/;
const I18N_TTL = 5 * 60 * 1000;
const i18nCache = new WeakMap();

// lore-i18n/index.json with its etag ({format, langs, pages, etag}), looked up at most every 5 minutes per isolate; null
// when R2 has none (before the first upload, or locally).
export async function loadI18nIndex(env) {
  if (!env?.STUDIO) return null;
  const hit = i18nCache.get(env.STUDIO);
  if (hit && Date.now() - hit.at < I18N_TTL) return hit.v;
  let v = null;
  try {
    const obj = await env.STUDIO.get(I18N_PREFIX + "index.json");
    if (obj) v = { ...(await new Response(obj.body).json()), etag: obj.httpEtag || obj.etag || "" };
  } catch (e) { v = null; }
  i18nCache.set(env.STUDIO, { at: Date.now(), v });
  return v;
}

// The languages an English page also reads in, in the switch's order: [{seg, hreflang, name, path}].
export function translationsOf(index, enPath) {
  const mask = Number(index?.pages?.[enPath]) || 0;
  return (index?.langs || []).filter((l, bit) => mask & (1 << bit)).map(l => ({ ...l, path: `/${l.seg}${enPath}` }));
}

// One translated page (site_i18n.py's shape: e/*.json's, plus lang and en), or null.
export async function loadTranslated(env, seg, enPath) {
  try {
    const obj = await env.STUDIO.get(`${I18N_PREFIX}${seg}/${enPath.replace(/^\/lore\//, "")}.json`);
    return obj ? await new Response(obj.body).json() : null;
  } catch (e) { return null; }
}

export const KIND_GROUPS = { zone: "Zones", dungeon: "Dungeons", subzone: "Places", npc: "Characters", boss: "Bosses",
  quest: "Quests", item: "Items", topic: "Topics" };
const ZONE_TYPES = [["city", "Capitals"], ["zone", "Zones"], ["dungeon", "Dungeons"]];

// Report reasons, as POST /api/clip-report takes them (LOR-232, site/CLIP_REPORT_API.md once that's merged). Its
// GET /api/clip-report/counts gives each clip's open reports; public/lore/lore.js shows them, and shows the report
// buttons only when that endpoint answers.
export const REPORT_REASONS = [
  ["name", "A name is said wrong"], ["voice", "Wrong voice or gender"], ["cut", "Cut off or garbled"],
  ["stage", "Reads a stage direction out loud"], ["quality", "Sound quality"], ["text", "The words are wrong"],
  ["other", "Something else"],
];

// ---- Data ----

async function assetJson(env, request, path) {
  const res = await env.ASSETS.fetch(new URL(path, request.url));
  if (!res.ok) return null;
  try { return await res.json(); } catch (e) { return null; }
}

// index.json lists the pages with a recording or quest dialogue; more.json the rest (site_lore.py: the companion's
// lore player reads index.json and rejects page kinds it doesn't know). allPages is both, in no particular order.
export const loadIndex = (env, request) => assetJson(env, request, `${DATA}/index.json`);
export const loadMore = (env, request) => assetJson(env, request, `${DATA}/more.json`);
export const allPages = (index, more) => [...(index?.pages || []), ...(more?.pages || [])];
export const loadEntry = (env, request, key) => assetJson(env, request, `${DATA}/e/${key.replace(":", "_")}.json`);

// The entry key an address names, or null: (zone, stormwind) -> zone:stormwind; (quest, 176-wanted-hogger) and
// (quest, 176) -> quest:176. Matches site_lore.py page_key.
export function keyOf(type, id) {
  type = String(type || "").toLowerCase();
  id = String(id || "").toLowerCase();
  if (!/^[a-z]+$/.test(type) || type === "data") return null;
  if (type === "quest") {
    const m = /^(\d+)(?:-[a-z0-9-]*)?$/.exec(id);
    return m ? `quest:${m[1]}` : null;
  }
  return /^[a-z0-9-]+$/.test(id) ? `${type}:${id}` : null;
}

// The file stem the add-on and our packs use for a clip (pipeline/lore/clips.py stem): zone:stormwind#faq3 ->
// zone_stormwind__faq3, quest:176#detail -> quest_176__detail.
export function stem(cid) {
  const d = /^(quest):(\d+)#(detail|progress|complete)$/.exec(cid);
  if (d) return `quest_${d[2]}__${d[3]}`;
  const [base, faq] = String(cid).split("#faq");
  return base.replace(/[^\w-]/g, "_") + (faq ? `__faq${faq}` : "");
}

export const audioKey = (voice, cid, ref) => `${voice}/${stem(cid)}-${ref.sha}.${ref.ext || "mp3"}`;

// The recordings R2 holds, as a Set of audio keys: narration/manifest.json, written by POST /api/admin/narration/manifest
// after an upload. Empty without the STUDIO binding or a manifest, so pages show no players. A preview's own bucket
// (Preview's) has no recordings: it asks loreforeverwow.com, whose audio its /audio/clip/ redirects to. Cached a
// minute per isolate.
const liveCache = new WeakMap();
export async function liveKeys(env, request) {
  const holder = env.STUDIO || env;
  const hit = liveCache.get(holder);
  if (hit && Date.now() - hit.at < LIVE_TTL) return hit.keys;
  let keys = [];
  try {
    const obj = env.STUDIO ? await env.STUDIO.get(MANIFEST_KEY) : null;
    if (obj) keys = (await new Response(obj.body).json()).keys || [];
    else if (new URL(request.url).hostname !== HOME) {
      const res = await fetch(`https://${HOME}/api/narration/live`);
      if (res.ok) keys = (await res.json()).keys || [];
    }
  } catch (e) {
    keys = [];
  }
  const set = new Set(keys.filter(k => typeof k === "string" && AUDIO_KEY.test(k)));
  liveCache.set(holder, { at: Date.now(), keys: set });
  return set;
}

// {voice id: "Male narrator"} from voices.json's names; with a page's language, also each narrator in that language,
// named in it ("male-narrator-de": "Erzähler", the voice ids pipeline/lore/site_i18n.py native_voices gives them).
export function voiceNames(voices, lang = "en") {
  const out = {};
  for (const v of voices || []) {
    const s = String(v.name || v.id).replace(/^Lore Forever\s+/, "");
    out[v.id] = s.charAt(0).toUpperCase() + s.slice(1);
    if (lang !== "en") out[`${v.id}-${lang}`] = tr(lang, out[v.id]);
  }
  return out;
}

// ---- Bits of pages ----

export function fmtTime(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// A paragraph split into sentences, for the read-along highlight. Whatever the pattern misses stays in the last piece.
export function sentences(text) {
  const t = String(text || "");
  const parts = t.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*)?\s*/g) || [];
  const joined = parts.join("");
  if (joined.length < t.length) parts.push(t.slice(joined.length));
  return parts.filter(p => p.trim());
}

const readAlong = paras => paras.map(p => `<p>${sentences(p).map(s => `<span class="rl-s">${escape(s)}</span>`).join("")}</p>`)
  .join("\n      ");

// A clip's heading in the page's language: an answer's is its question, the rest are the page's words ("The story").
const clipTitle = (clip, lang) => (clip.part === "faq" ? clip.title : tr(lang, clip.title));

function players(clip, live, names, lang = "en") {
  const buttons = [];
  for (const [vid, ref] of Object.entries(clip.voices || {})) {
    const key = audioKey(vid, clip.id, ref);
    if (!live.has(key)) continue;
    buttons.push(`<a class="lp-btn" href="${AUDIO}${escape(key)}" data-voice="${escape(vid)}" data-sec="${Number(ref.sec) || 0}"
          aria-label="Play ${escape(clipTitle(clip, lang))}, ${escape(names[vid] || vid)}"><span class="lp-ic" aria-hidden="true">&#9654;</span>
          <span class="lp-vn">${escape(names[vid] || vid)}</span> <span class="lp-len">${fmtTime(ref.sec)}</span></a>`);
  }
  if (!buttons.length) {
    return { html: `<p class="lp-ingame">${tr(lang, "Hear this one in game:")} <a href="${DOWNLOAD}">${tr(lang, "get Lore Forever")}</a>.</p>`, n: 0 };
  }
  return { html: `<div class="lp-play">${buttons.join("\n        ")}</div>`, n: buttons.length };
}

function clipSection(clip, live, names, heading, lang = "en") {
  const p = players(clip, live, names, lang);
  const text = readAlong(clip.paras || []);
  // What a quest giver says when you turn the quest in can give the ending away: folded until asked for.
  const body = clip.part === "complete"
    ? `<details class="lp-fold"><summary>${tr(lang, "Show the words")}</summary><div class="lp-text">${text}</div></details>`
    : `<div class="lp-text">${text}</div>`;
  return `<section class="lp-clip lp-${escape(clip.part)}" id="${escape(clip.anchor)}" data-clip="${escape(clip.id)}" data-hash="${escape(clip.hash)}">
      <${heading}>${escape(clipTitle(clip, lang))}</${heading}>
      ${p.html}
      ${body}
      ${p.n ? `<p class="lp-tools"><button type="button" class="lp-rep" hidden>Report a problem with this line</button>
        <span class="lp-open" hidden></span></p>` : ""}
    </section>`;
}

const linkList = links => `<ul class="lp-links">
        ${links.map(l => `<li><a href="${escape(l.p)}">${escape(l.n)}</a></li>`).join("\n        ")}
      </ul>`;

function grouped(links, lang = "en") {
  const out = [];
  for (const [kind, label] of Object.entries(KIND_GROUPS)) {
    const some = links.filter(l => l.k === kind);
    if (some.length) out.push(`<h3>${tr(lang, label)} <span class="lp-count">${some.length}</span></h3>\n      ${linkList(some)}`);
  }
  return out.join("\n      ");
}

export const reportDialog = () => `<dialog class="lp-dlg" id="lp-report" aria-labelledby="lp-report-title">
  <form method="dialog" class="lp-form">
    <h2 id="lp-report-title">Report a problem with this line</h2>
    <p class="lp-what"></p>
    <fieldset>
      <legend>What's wrong?</legend>
      ${REPORT_REASONS.map(([v, l], i) => `<label><input type="radio" name="reason" value="${v}"${i === 0 ? " required" : ""}> ${l}</label>`).join("\n      ")}
    </fieldset>
    <div class="lp-name" hidden>
      <label>Which name? <input name="name" maxlength="60" autocomplete="off"></label>
      <label>How should it sound? <input name="say_as" maxlength="80" autocomplete="off" placeholder="e.g. THRALL rhymes with ball"></label>
    </div>
    <label>Anything else? (optional) <textarea name="note" maxlength="300" rows="3"></textarea></label>
    <label class="visually-hidden" aria-hidden="true">Website <input name="website" tabindex="-1" autocomplete="off"></label>
    <p class="lp-msg" role="status"></p>
    <div class="lp-actions"><button type="submit" class="btn-small" value="send">Send report</button>
      <button type="button" class="lp-cancel">Cancel</button></div>
  </form>
</dialog>`;

const cta = (lang = "en") => `<aside class="lp-cta">
    <h2>${tr(lang, "Hear it as you play")}</h2>
    <p>${tr(lang, "cta")}</p>
    <p><a class="btn-download" href="${DOWNLOAD}">${tr(lang, "Get Lore Forever")}</a></p>
  </aside>`;

// No line of their own over the footer: where the lore comes from and its licences are on /credits, linked from the
// footer once (Mike, 10/25: "consolidated and moved from the site too").
const foot = "";

// A thin page (site_lore.py THIN_CHARS: a line or two, nothing to play) is served but kept out of search: noindex in the
// header and the page, and out of the sitemap. Its links are still followed.
const noindex = (env, entry) => (isPublic(env) && !entry?.thin ? undefined : "noindex");
export const htmlHeaders = (env, entry, hreflang) => ({
  "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache",
  ...(noindex(env, entry) ? { "X-Robots-Tag": "noindex" } : {}),
  ...(hreflang ? { "Content-Language": hreflang } : {}),
});

// The book's reading face (Alegreya, as the profile pages load it) and its styles.
const HEAD = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400;0,600;1,400&display=swap">
<link rel="stylesheet" href="/lore/lore.css?${FRESH}">`;
const SCRIPTS = `<script src="/lore/lore.js?${FRESH}" defer></script>`;

// ---- What a search result shows (LOR-22) ----
// Search Console, 9/28-10/13: the lore pages showed on page one (mostly 5th to 10th) for their own names and
// "wow forever <name>", and almost nobody clicked. So the title says what the page is and where ("Bandarion Keep,
// Tirisfal Glades – WoW Forever Lore", "WANTED: Bruuz – WoW Forever Quest in The Barrens"), and the description is
// the entry's own first sentences, whole, then what the page has, as far as it fits.

const BRAND = " | Lore Forever";
const TITLE_MAX = 60;       // about what Google shows of a title
const DESC_MAX = 160;       // and of a description

// A name to show: the few quests whose title we don't know are named by their key ("quest:95214").
export const displayName = entry => String(entry.name || "").replace(/^quest:(\d+)$/, "Quest $1");

// Where an entry is, when that isn't the entry itself: a zone page's zone is its own.
const zoneOf = entry => (entry.zone?.name && entry.zone.path !== entry.path && entry.zone.name !== entry.name
  ? entry.zone.name : "");

// The <title>, and the same without the brand (og:title).
export function searchTitle(entry, lang = "en") {
  const name = displayName(entry);
  const zone = zoneOf(entry);
  const short = lang !== "en" ? `${name}${zone ? `, ${zone}` : ""} – WoW Forever` : entry.kind === "quest" ? `${name} – WoW Forever Quest${zone ? ` in ${zone}` : ""}`
    : entry.kind === "subzone" && zone ? `${name}, ${zone} – WoW Forever Lore`
      : `${name} – WoW Forever Lore`;
  return { short, full: short.length + BRAND.length <= TITLE_MAX ? short + BRAND : short };
}

// A text's sentences, split only where one ends: not after "Lt.", "St." or an initial ("John J. Keeshan"), not before a
// lowercase word.
const ABBR = /(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|St|Mt|Lt|Sgt|Capt|Gen|Col|Maj|Jr|Sr|Prof|vs|No|[A-Z])\.$/;
export function wholeSentences(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const out = [];
  let start = 0;
  for (const m of t.matchAll(/[.!?…]+["'”’)]*\s+(?=["'“‘(]?[A-Z0-9])/g)) {
    const end = m.index + m[0].trimEnd().length;
    if (ABBR.test(t.slice(start, end))) continue;
    out.push(t.slice(start, end));
    start = m.index + m[0].length;
  }
  if (start < t.length) out.push(t.slice(start));
  return out;
}

// As many whole sentences of text as fit in max characters; "" if not even the first does.
function fit(text, max) {
  let out = "";
  for (const s of wholeSentences(text)) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  return out;
}

// Text cut at a word to fit max characters, with "…" when it's cut.
function cut(text, max) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  return head.slice(0, Math.max(head.lastIndexOf(" "), 1)).replace(/[\s,;:–—-]+$/, "") + "…";
}

// The meta description: the entry's summary (or, for a quest we have no summary of, the quest giver's first words) in
// whole sentences, then what the page has (a quest's level and zone, "read aloud" when it's recorded) when that fits
// too. A first sentence too long for the space is cut at a word.
export function searchDescription(entry, lang = "en") {
  if (lang !== "en") {
    const t = entry.intro?.[0] || entry.sections?.[0]?.p?.[0] || "";
    return t ? fit(t, DESC_MAX) || cut(t, DESC_MAX) : `${displayName(entry)} – WoW Forever`;
  }
  const clips = entry.clips || [];
  const recorded = clips.some(c => Object.keys(c.voices || {}).length);
  const summary = entry.intro?.[0] || clips.find(c => c.part === "narration")?.paras?.[0]
    || entry.sections?.[0]?.p?.[0] || "";
  const zone = zoneOf(entry);
  if (entry.kind === "quest") {
    const level = /^Level (\d+)$/.exec(entry.levels || "")?.[1];
    const what = `${level ? `level ${level} ` : ""}WoW Forever quest${zone ? ` in ${zone}` : ""}`;
    const words = clips.find(c => c.part === "detail")?.paras?.join(" ") || "";
    if (!summary) {
      // "Mor'Ladim: a level 35 WoW Forever quest in Duskwood. “From what my scouts tell me, …”"
      const head = `${displayName(entry)}: a ${what}.`;
      if (!words) return head;
      const room = DESC_MAX - head.length - 3;
      return room > 30 ? `${head} “${fit(words, room) || cut(words, room)}”` : head;
    }
    const tails = [` A ${what}${recorded ? ", with the quest giver's words read aloud" : ""}.`, ` A ${what}.`];
    for (const tail of tails) {
      const lead = fit(summary, DESC_MAX - tail.length);
      if (lead) return lead + tail;
    }
    return fit(summary, DESC_MAX) || cut(summary, DESC_MAX);
  }
  if (!summary) return `${displayName(entry)}: WoW Forever lore${zone ? ` from ${zone}` : ""}.`;
  if (recorded) {
    const tail = " Read it, or hear it read aloud.";
    const lead = fit(summary, DESC_MAX - tail.length);
    if (lead) return lead + tail;
  }
  return fit(summary, DESC_MAX) || cut(summary, DESC_MAX);
}

// The page as an article for search (schema.org Article): its title, description and card, published by Lore Forever.
export function articleLd(entry, headline, description, card, inLanguage = "en") {
  const ld = {
    "@context": "https://schema.org", "@type": "Article", headline, description, inLanguage,
    image: `https://${HOME}${card.src}`, mainEntityOfPage: `https://${HOME}${entry.path}`,
    author: { "@type": "Organization", name: "Lore Forever", url: `https://${HOME}/` },
    publisher: { "@type": "Organization", name: "Lore Forever", url: `https://${HOME}/`,
      logo: { "@type": "ImageObject", url: `https://${HOME}/img/logo.png` } },
  };
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`;
}

// Breadcrumbs for search results (schema.org BreadcrumbList), the same trail as the page's own: Lore › zone › entry.
export function breadcrumbLd(entry) {
  const trail = [["Lore", "/lore"]];
  if (entry.zone?.path && entry.zone.path !== entry.path) trail.push([entry.zone.name, entry.zone.path]);
  trail.push([displayName(entry), entry.path]);
  const ld = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: trail.map(([name, p], i) => ({ "@type": "ListItem", position: i + 1, name, item: `https://${HOME}${p}` })),
  };
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`;
}

// ---- Pages ----

// "Hear it in game" (LOR-437): the downloads that have this page's recording, linked to their row on /downloads.
// packs: lib/packs.js packsForEntry, [{name, href, main}].
function packsSection(packs) {
  if (!packs?.length) return "";
  return `<section class="lp-packs" aria-labelledby="packs-title">
      <h2 id="packs-title">Hear it in game</h2>
      <p>Recordings of this page come in ${packs.length === 1 ? "this download" : "these downloads"}:</p>
      <ul class="lp-links">
        ${packs.map(p => `<li><a href="${escape(p.href)}">${escape(p.name)}</a>${p.main ? ` <span class="lp-count">in the main download</span>` : ""}</li>`).join("\n        ")}
      </ul>
    </section>`;
}

// The page that plays after this one when "Next plays on" is ticked: the next page in /lore's browsing order (zone,
// kind, name: index.json) that has a recording, or null at the end. index: loadIndex's.
export function nextPlayable(index, path) {
  const pages = index?.pages || [];
  const at = pages.findIndex(p => p.p === path);
  if (at < 0) return null;
  for (const p of pages.slice(at + 1)) {
    if ((p.c || []).some(c => (c[2] || []).some(Boolean))) return { p: p.p, n: p.n };
  }
  return null;
}

// "Listen": how many of the page's clips play here and how long they run, in the first voice each has; voice: the name of
// the first clip's.
function wholePage(entry, live, names = {}) {
  let n = 0, sec = 0, voice = "";
  for (const c of entry.clips || []) {
    const hit = Object.entries(c.voices || {}).find(([vid, r]) => live.has(audioKey(vid, c.id, r)));
    if (hit) { n++; sec += Number(hit[1].sec) || 0; if (!voice) voice = names[hit[0]] || hit[0]; }
  }
  return { n, sec, voice };
}

// ---- The open book (Mike picked "Lore 2", 2026-10-24: the reader and the playlist) ----
// /lore and every /lore/<type>/<id> are one open book on the leather: the left page reads the entry (or, on /lore, says what
// the book is), the right page finds and plays (a now-playing box, Up next, search, zone, kind, sort, language, Play all and
// the rows), and a foot player is pinned under both. The left page is the server's, so every address keeps its own title,
// description and text for search; public/lore/lore.js builds the right page from index.json and, on a click, fetches the
// next address's page and puts its left page in (history.pushState), so a click and a full load show the same thing.

// One sprite for the book's icons (a row's kind, a chip, the download arrow); the script draws the list with the same ids.
const ICON_PATHS = {
  zone: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zm6-.8v12.6l6 3V8.2z" fill-rule="evenodd"/>',
  place: '<path d="M5 21V4h1.6v1.2l10.6 3.1-10.6 3.4V21z"/><path d="M3 21h8v1.4H3z"/>',
  person: '<circle cx="12" cy="8" r="4.2"/><path d="M4 21c.6-4.6 3.8-7 8-7s7.4 2.4 8 7z"/>',
  boss: '<path d="M12 2c4.4 0 8 3.3 8 7.6 0 2.6-1.3 4.6-3 5.8V19h-3v-2h-1v2h-2v-2h-1v2H7v-3.6c-1.7-1.2-3-3.2-3-5.8C4 5.3 7.6 2 12 2zm-3.5 7a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6zm7 0a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6z"/>',
  item: '<path d="M9 3h6l-1 3h-4z"/><path d="M8 7h8c3 3 4 6 4 9 0 3-3 5-8 5s-8-2-8-5c0-3 1-6 4-9z"/>',
  quest: '<path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zm2 4v1.6h8V7zm0 4v1.6h8V11zm0 4v1.6h5V15z"/>',
  book: '<path d="M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zm16 0h-5a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h5z"/>',
  dl: '<path d="M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3z"/><path d="M4 18h16v3H4z"/>',
  prev: '<path d="M6 5h2.2v14H6zM19 5.5v13L9.5 12z"/>',
  next: '<path d="M15.8 5H18v14h-2.2zM5 5.5v13L14.5 12z"/>',
};
export const KIND_ICON = { zone: "zone", dungeon: "zone", subzone: "place", npc: "person", boss: "boss", quest: "quest", item: "item", topic: "book" };
const sprite = `<svg class="li-sprite" width="0" height="0" aria-hidden="true" focusable="false">${Object.entries(ICON_PATHS)
  .map(([k, p]) => `<symbol id="li-${k}" viewBox="0 0 24 24">${p}</symbol>`).join("")}</svg>`;
const icon = name => `<svg class="li" aria-hidden="true" focusable="false"><use href="#li-${name}"></use></svg>`;

const bookTitle = ({ where, who = "", count = "" }) => `<span class="bk-icon">${icon("book")}</span>
      <span class="bk-where" data-where>${escape(where)}</span><span class="bk-who" data-who>${escape(who)}</span><span class="bk-count" data-count>${escape(count)}</span>`;

// The right page: what the script fills in (public/lore/lore.js). packs: the downloads to filter by (LOR-437; lib/packs.js
// packOptions, [{value: pack folder, name, href, voice | lang, sample}]): lore.js reads /data/pack-entries.json when one is
// picked, plays the pack's narrator in the list (voice), or else says what it plays in the add-on and offers its sample
// (.lx-packnote). langs: the languages the pages come in, [{seg, name}] (English is always first).
const packOption = p => {
  const data = { href: p.href, voice: p.voice, lang: p.lang, sample: p.sample?.audio, "sample-title": p.sample?.title,
    "sample-lang": p.sample?.lang, "sample-key": p.sample?.key };
  const attrs = Object.entries(data).filter(([, v]) => v).map(([k, v]) => ` data-${k}="${escape(v)}"`).join("");
  return `<option value="${escape(p.value)}"${attrs}>${escape(p.name)}</option>`;
};

const shelfHtml = ({ packs = [], langs = [], lang = "en" }) => `<div class="pg-in lx" id="lore-shelf">
        <div class="nowbox">
          <button type="button" class="pp" aria-label="Play" disabled>&#9654;</button>
          <div class="nb-text"><b class="nb-title">Nothing playing</b><small class="nb-sub">Press &#9654; on a row, or Play all</small>
            <label class="lx-auto"><input type="checkbox"> Next plays on</label></div>
        </div>
        <p class="upnext" hidden>Up next: <b></b></p>
        <p class="lx-langnote" hidden></p>
        <p class="lx-soon" hidden>Listening here is on its way. Every line below already plays in game:
          <a href="${DOWNLOAD}">get Lore Forever</a>.</p>
        <form class="lx-bar" role="search" hidden>
          <div class="rowx">
            <label class="lx-search"><span class="visually-hidden">Search</span>
              <input type="search" name="q" placeholder="Search a place, person, quest or item" autocomplete="off"></label>
            ${langs.length > 1 ? `<label class="lx-sel lx-lang"><span class="visually-hidden">Language</span><select name="l">
              ${langs.map(l => `<option value="${escape(l.seg)}"${l.seg === lang ? " selected" : ""} lang="${escape(l.hreflang || l.seg)}">${escape(l.name)}</option>`).join("\n              ")}
            </select></label>` : ""}
          </div>
          <div class="rowx">
            <label class="lx-sel"><span class="visually-hidden">Zone</span><select name="z"><option value="">Every zone</option></select></label>
            <label class="lx-sel"><span class="visually-hidden">Kind</span><select name="k"><option value="">Every kind</option></select></label>
            <label class="lx-sel"><span class="visually-hidden">Sort</span><select name="s"><option value="zone">By zone</option>
              <option value="az">A to Z</option><option value="rec">Recorded first</option></select></label>
            ${packs.length ? `<label class="lx-sel lx-pack"><span class="visually-hidden">Download</span><select name="p"><option value="">Any download</option>
              ${packs.map(packOption).join("\n              ")}
            </select></label>` : ""}
          </div>
          <div class="rowx">
            <button type="button" class="lx-all chip">&#9654; Play all</button>
            <label class="lx-check"><input type="checkbox" name="playable"> Playable here</label>
            <label class="lx-check lx-mine" hidden><input type="checkbox" name="mine"> In my book</label>
            <span class="lx-count" aria-live="polite"></span>
          </div>
        </form>
        <p class="lx-packnote" hidden></p>
        <div class="lx-list"></div>
        <p class="lx-morep"><button type="button" class="lx-more btn-small" hidden>Show more</button></p>
        <p class="lx-keys" hidden><kbd>j</kbd>/<kbd>k</kbd> move &middot; <kbd>space</kbd> play or pause &middot; <kbd>enter</kbd> open
          &middot; <kbd>/</kbd> search &middot; <kbd>s</kbd> speed &middot; <kbd>v</kbd> narrator</p>
        <noscript><p class="lx-nojs">Search and the playlist need JavaScript. Every page is also reachable from
          <a href="/lore">the lore index</a> by zone.</p></noscript>
      </div>`;

// The foot player, pinned under both pages: play and pause, next, how far along, and Download.
const footHtml = () => `<div class="bk-foot" role="group" aria-label="Player">
      <div class="bk-ctl">
        <button type="button" class="fbtn bk-prev" aria-label="Previous">${icon("prev")}</button>
        <button type="button" class="fbtn play-main bk-pp" aria-label="Play" disabled>&#9654;</button>
        <button type="button" class="fbtn bk-next" aria-label="Next">${icon("next")}</button>
      </div>
      <div class="bk-now"><a class="bk-nt">Nothing playing</a><span class="bk-ns"></span>
        <input class="bk-seek" type="range" min="0" max="1000" value="0" aria-label="Position"></div>
      <span class="bk-time">0:00</span>
      <div class="bk-more">
        <button type="button" class="bk-voice" aria-label="Switch narrator" hidden></button>
        <button type="button" class="bk-rate" aria-label="Playback speed">1&times;</button>
        <button type="button" class="lp-rep bk-report" hidden>Report</button><span class="lp-open bk-open" hidden></span>
      </div>
      <a class="bk-dl" href="${DOWNLOAD}">${icon("dl")}<span>Download</span></a>
    </div>`;

// The book around a left page. left: the page's HTML (an <article class="lp">); the rest is the same on every address.
function bookHtml({ left, where, who, count = "", lang = "en", packs = [], langs = [] }) {
  return `${sprite}
  <div class="bk" data-book data-lang="${escape(lang)}">
    <div class="bk-plate">The Lore</div>
    <div class="bk-title">${bookTitle({ where, who, count })}</div>
    <div class="bk-body">
      <div class="pg l ch-sheet" id="lore-page" tabindex="-1">
${left}
      </div>
      <div class="pg r ch-sheet">
      ${shelfHtml({ packs, langs, lang })}
      </div>
    </div>
    ${footHtml()}
  </div>
  ${reportDialog()}`;
}

// The languages the select offers, English first: the site's i18n index (loadI18nIndex's langs), or just English.
const langChoices = langs => [{ seg: "en", hreflang: "en", name: "English" }, ...(langs || [])];

// /lore/<type>/<id>: one entry, on the left page of the book (LOR-809). live: the recordings R2 has (liveKeys); names:
// voiceNames; packs: the downloads with its recording (packsSection); next: nextPlayable. lang: "en", or a translated
// page's segment ("de"; the entry is then loadTranslated's); langs: the other languages this page reads in
// (translationsOf), for the language row and hreflang; allLangs: every language the site has pages in (the select);
// shelfPacks: the downloads /lore's filter offers (lib/packs.js packOptions).
export function entryPage(entry, { live = new Set(), names = {}, env, packs = [], next = null, lang = "en", langs = [],
  allLangs = [], shelfPacks = [] } = {}) {
  const zone = entry.zone;
  const enPath = lang === "en" ? entry.path : entry.en;
  const hreflang = lang === "en" ? "en" : langs.find(l => l.seg === lang)?.hreflang || lang;
  const langName = lang === "en" ? "English" : langs.find(l => l.seg === lang)?.name || lang;
  const where = [
    `<span class="tag lp-tag">${escape(tr(lang, entry.label))}</span>`,
    zone && zone.path !== entry.path ? (zone.path ? `<a href="${escape(zone.path)}">${escape(zone.name)}</a>` : escape(zone.name)) : "",
    escape(levelsIn(lang, entry.levels)),
  ].filter(Boolean).join(" &middot; ");
  // The story first, then the sections it doesn't read (a translated page's narrators read the summary and the first
  // section: pipeline/lore/site_i18n.py), then the rest.
  const story = (entry.clips || []).find(c => c.part === "narration");
  const clipsHtml = [];
  const faqs = (entry.clips || []).filter(c => c.part === "faq");
  for (const c of entry.clips || []) {
    if (c.part === "faq" || c === story) continue;
    clipsHtml.push(clipSection(c, live, names, "h2", lang));
  }
  if (faqs.length) {
    clipsHtml.push(`<h2 class="lp-faqs">Questions, answered</h2>\n    ${faqs.map(c => clipSection(c, live, names, "h3", lang)).join("\n    ")}`);
  }
  const playable = (entry.clips || []).some(c => players(c, live, names).n);
  const intro = (entry.intro || []).length ? `<div class="lp-intro">${(entry.intro || []).map(p => `<p>${escape(p)}</p>`).join("")}</div>` : "";
  // An entry with no recording reads as text: each spoiler-free section under its own heading (a narrated page has the
  // narration instead).
  const sections = (entry.sections || []).map(s => `<section class="lp-sec">
      <h2>${escape(s.t)}</h2>
      <div class="lp-text">${(s.p || []).map(p => `<p>${escape(p)}</p>`).join("")}</div>
    </section>`).join("\n    ");
  const speed = playable ? `<div class="lp-speed" role="group" aria-label="${tr(lang, "Playback speed")}" hidden>${tr(lang, "Speed")}
      <button type="button" data-rate="1" aria-pressed="true">1&times;</button><button type="button" data-rate="1.25"
        aria-pressed="false">1.25&times;</button><button type="button" data-rate="1.5" aria-pressed="false">1.5&times;</button>
    </div>` : "";
  // Listen, for everyone (no sign-in): the whole page in a row, in the narrator the listener picked. The button works only
  // with JavaScript (lore.js shows it); each clip's own play links work without. A page in another language plays its own
  // language's narrators, never the English ones. A page with no recording in its language says so.
  const whole = wholePage(entry, live, names);
  const listen = playable ? `<div class="lp-listen">
      <p class="lp-whole" hidden><button type="button" class="lp-all"><span class="lp-ic" aria-hidden="true">&#9654;</span>
        <span class="lp-al">${tr(lang, "Listen")}</span><span class="lp-nv">${whole.voice ? ` &middot; ${escape(whole.voice)}` : ""}</span></button>
        <span class="lp-count">${whole.n === 1 ? "" : `${tr(lang, "{n} recordings", whole.n)} &middot; `}${fmtTime(whole.sec)}</span></p>
      ${speed}
    </div>`
    : (entry.clips || []).length ? ""
      : lang !== "en" ? `<p class="lp-ingame lp-norec">${escape(tr(lang, "norec", langName))}</p>`
        : `<p class="lp-ingame lp-norec">No recording yet: read it here, and hear it in game once it's recorded.</p>`;
  // (Its sources aren't listed here: /credits says where the lore comes from, and the public data names each entry's
  // articles. Mike, 10/25.)
  const childCount = (entry.children || []).length;
  const children = childCount
    ? `<details class="lp-in"${childCount <= 12 ? " open" : ""}>
      <summary class="lp-h2">${tr(lang, "In {n}", escape(entry.name))} <span class="lp-count">${childCount}</span></summary>
      ${grouped(entry.children, lang)}
    </details>` : "";
  const related = (entry.related || []).length
    ? `<section class="lp-rel" aria-labelledby="rel-title">
      <h2 id="rel-title">${tr(lang, "On the same road")}</h2>
      <div class="lp-chips">
        ${entry.related.map(l => `<a class="lp-chip" href="${escape(l.p)}">${icon(KIND_ICON[l.k] || "book")}<span>${escape(l.n)}</span></a>`).join("\n        ")}
      </div>
    </section>` : "";
  // Look it up (LOR-263): its Wowhead page and its wiki article (the first one it was adapted from, else a search).
  const wowhead = wowheadUrl(entry.wowhead);
  const wikiSources = (entry.sources || []).filter(s => s.kind === "wiki");
  const wikiGg = wikiSources.find(s => /^https:\/\/warcraft\.wiki\.gg\//.test(s.url || ""))?.url;
  const wowpedia = wikiGg ? null : wikiSources.find(s => /^https:\/\/wowpedia\.fandom\.com\//.test(s.url || ""))?.url;
  const wiki = wikiGg || wowpedia || wikiSearch(entry.name);
  const lookup = `<section class="lp-out" aria-labelledby="out-title">
      <h2 id="out-title">${tr(lang, "Look it up")}</h2>
      <ul class="lp-links">
        ${wowhead ? `<li><a href="${escape(wowhead)}" rel="noopener">${escape(entry.name)} ${tr(lang, "on Wowhead")}</a> <span class="lp-count">${tr(lang, "WoW Forever database")}</span></li>` : ""}
        <li><a href="${escape(wiki)}" rel="noopener">${escape(entry.name)} ${wowpedia ? "on Wowpedia" : tr(lang, "on the Warcraft Wiki")}</a></li>
      </ul>
    </section>`;
  // Read in: English and each language this page has, the one shown marked (LOR-809). A translated page has no "Your
  // page" line: the profile's moments name the English pages.
  const langRow = langs.length ? `<p class="lp-langs"><span>${tr(lang, "Read in")}</span>
      ${[{ seg: "en", hreflang: "en", name: "English", path: enPath }, ...langs].map(l => l.seg === lang
        ? `<b aria-current="page" lang="${escape(l.hreflang)}">${escape(l.name)}</b>`
        : `<a href="${escape(l.path)}" hreflang="${escape(l.hreflang)}" lang="${escape(l.hreflang)}">${escape(l.name)}</a>`).join(" ")}</p>` : "";
  const alternates = langs.length ? [{ hreflang: "en", path: enPath }, ...langs, { hreflang: "x-default", path: enPath }]
    .map(l => `<link rel="alternate" hreflang="${escape(l.hreflang)}" href="https://${HOME}${escape(l.path)}">`).join("\n") : "";
  // The left page: where it is, its name, Listen, the text, what's on the same road, then what's in it, the
  // downloads that have its recording, the links out and the download box.
  const left = `        <article class="lp" data-key="${escape(entry.key)}" data-path="${escape(entry.path)}" data-en="${escape(enPath)}" data-lang="${escape(lang)}"${next ? ` data-next="${escape(next.p)}" data-next-name="${escape(next.n)}"` : ""}>
    <span class="ent-ico">${icon(KIND_ICON[entry.kind] || "book")}</span>
    <p class="lp-where">${where}</p>
    <h1>${escape(displayName(entry))}</h1>
    ${lang === "en" ? `<p class="lp-mine" hidden></p>` : ""}
    ${langRow}
    ${listen}
    ${intro}
    ${story ? clipSection(story, live, names, "h2", lang) : ""}
    ${sections}
    ${clipsHtml.join("\n    ")}
    ${related}
    ${children}
    ${packsSection(packs)}
    ${lookup}
    ${cta(lang)}
  </article>`;
  const body = bookHtml({ left, where: displayName(entry), who: zoneOf(entry), lang, packs: shelfPacks, langs: langChoices(allLangs) });
  const crumbs = [`<a href="/lore">Lore</a>`];
  if (zone && zone.path && zone.path !== entry.path) crumbs.push(`<a href="${escape(zone.path)}">${escape(zone.name)}</a>`);
  crumbs.push(escape(displayName(entry)));
  const { short, full } = searchTitle(entry, lang);
  // Shared, it shows the land it's in or about on our own map (lib/social.js), else the lore card.
  const card = zoneCard(entry.zone?.name, displayName(entry)) || LORE_INDEX_CARD;
  const description = searchDescription(entry, lang);
  return page({
    title: short, fullTitle: full, description, path: entry.path, body, image: card.src, imageAlt: card.alt,
    crumbs: crumbs.join(" &rsaquo; "), foot, scripts: SCRIPTS, robots: noindex(env, entry), lang: hreflang,
    head: `${HEAD}\n${alternates ? alternates + "\n" : ""}${breadcrumbLd(entry)}\n${articleLd(entry, short, description, card, hreflang)}`,
  });
}

// /lore: the book with no entry open. The left page says what it is and lists every zone (so every page is linked from
// here without JavaScript); the right page is the playlist (public/lore/lore.js reads index.json, more.json and the
// recordings R2 has). packs: shelfHtml's; allLangs: the languages the select offers.
export function indexPage(index, { more, env, packs = [], allLangs = [] } = {}) {
  const pages = allPages(index, more);
  const clipCount = (index?.pages || []).reduce((n, p) => n + p.c.length, 0);
  const byZone = {};
  for (const p of index?.pages || []) byZone[p.z] = (byZone[p.z] || 0) + p.c.length;
  const zones = index?.zones || [];
  const zoneGroups = ZONE_TYPES.map(([type, label]) => {
    const some = zones.filter(z => z.p && (z.type || "zone") === type);
    if (!some.length) return "";
    return `<h3>${label}</h3>
      <ul class="lp-links lx-zonelist">
        ${some.map(z => `<li><a href="${escape(z.p)}">${escape(z.name)}</a> <span class="lp-count">${byZone[z.key] || 0}</span></li>`).join("\n        ")}
      </ul>`;
  }).join("\n      ");
  // Pages no zone page lists (topics, and the few quests in a zone with no page of its own), so they're linked from here.
  const zonePages = new Set(zones.filter(z => z.p).map(z => z.key));
  const others = pages.filter(p => !zonePages.has(p.z)).map(p => ({ p: p.p, n: p.n, k: p.k }))
    .sort((a, b) => a.n.localeCompare(b.n));
  const narrators = (index?.voices || []).length;
  const left = `        <article class="lp lp-front" data-key="" data-path="/lore" data-en="/lore" data-lang="en" aria-labelledby="lx-title">
    <span class="ent-ico">${icon("book")}</span>
    <h1 id="lx-title">Hear the lore</h1>
    <p class="pitch">Every story Lore Forever tells: zones and capitals, the places and people in them, dungeon bosses,
      items and what quest givers say. Read one here, play the ones read aloud, then hear them in game as you get there.</p>
    <p class="lx-stats">${clipCount.toLocaleString("en-US")} narrations &middot; ${pages.length.toLocaleString("en-US")} pages &middot;
      ${narrators} narrators</p>
    <p class="lp-how">Pick a row on the right page to read it on this one. Press its &#9654; to hear it, or Play all to hear what
      the list shows, one after another.</p>
    <details class="lx-browse"><summary>Browse by zone</summary>
      ${zoneGroups}
      ${others.length ? `<h2 id="more-title">Topics and more</h2>
      ${grouped(others)}` : ""}
    </details>
    ${cta()}
  </article>`;
  const body = bookHtml({ left, where: "The Lore", who: "every zone, place, person, quest and item",
    count: `${pages.length.toLocaleString("en-US")} pages`, packs, langs: langChoices(allLangs) });
  return page({
    title: "WoW Forever Lore: every zone, place and quest", fullTitle: "WoW Forever Lore: every zone, place and quest | Lore Forever",
    description: "Read and listen to the stories of WoW Forever's zones, places, characters, items, dungeon bosses and " +
      "quest givers, as Lore Forever tells them in game. Search, filter by zone and play.",
    path: "/lore", body, crumbs: "", foot, scripts: SCRIPTS, robots: noindex(env), head: HEAD,
    image: LORE_INDEX_CARD.src, imageAlt: LORE_INDEX_CARD.alt,
  });
}

export function missingLorePage(env) {
  return page({
    title: "No lore page here",
    description: "This lore page doesn't exist (yet).",
    path: "/lore", crumbs: `<a href="/lore">Lore</a>`,
    body: `  <div class="ch-sheet lx-sheet">
  <h1>No lore page here</h1>
  <p class="pitch">We don't have a page at this address. It may have moved when its story was rewritten.</p>
  <p class="vp-actions"><a class="btn-small" href="/lore">All the lore</a> <a class="btn-small" href="/">What's Lore Forever?</a></p>
  </div>`,
    robots: "noindex", foot, scripts: "", head: HEAD,
  });
}

// /lore/sitemap.xml: /lore and every page that isn't thin (x), once the pages are public; an empty (valid) sitemap
// until then. With seg, /<seg>/lore/sitemap.xml: that language's pages (i18n: loadI18nIndex's; site_i18n.py leaves
// thin pages out).
export function sitemap(index, env, more, seg = null, i18n = null) {
  const bit = seg ? (i18n?.langs || []).findIndex(l => l.seg === seg) : -1;
  const urls = !isPublic(env) ? [] : seg
    ? (bit < 0 ? [] : Object.entries(i18n.pages || {}).filter(([, m]) => Number(m) & (1 << bit)).map(([p]) => `/${seg}${p}`))
    : ["/lore", ...allPages(index, more).filter(p => !p.x).map(p => p.p)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>https://${HOME}${escape(u)}</loc></url>`).join("\n")}
</urlset>
`;
}
