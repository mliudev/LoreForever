// Lore pages (LOR-233, the start of LOR-20 and LOR-22): /lore lists every narration we ship, with filters, search and
// a player, and /lore/<type>/<id> is one page per entry (site/LORE_PAGES.md has the address scheme). The data is
// generated: pipeline/lore/site_lore.py writes public/lore/data/index.json and public/lore/data/e/<key>.json from the
// lore data and our voice packs (scripts/rebuild-generated.sh runs it). The recordings are in R2 (the STUDIO bucket,
// under narration/), uploaded by scripts/upload-narration-r2.sh. A page plays only what R2's manifest lists, so every
// page works, as text with a "hear it in game" line, before anything is uploaded. Kept outside functions/ so Pages
// doesn't route it.

import { page, escape, FRESH } from "./voices.js";
import { featureOn } from "./features.js";

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

// The recordings R2 holds, as a Set of audio keys: narration/manifest.json, written by POST /api/narration/manifest
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

// {voice id: "Male narrator"} from voices.json's names.
export function voiceNames(voices) {
  const out = {};
  for (const v of voices || []) {
    const s = String(v.name || v.id).replace(/^Lore Forever\s+/, "");
    out[v.id] = s.charAt(0).toUpperCase() + s.slice(1);
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

function players(clip, live, names) {
  const buttons = [];
  for (const [vid, ref] of Object.entries(clip.voices || {})) {
    const key = audioKey(vid, clip.id, ref);
    if (!live.has(key)) continue;
    buttons.push(`<a class="lp-btn" href="${AUDIO}${escape(key)}" data-voice="${escape(vid)}" data-sec="${Number(ref.sec) || 0}"
          aria-label="Play ${escape(clip.title)}, ${escape(names[vid] || vid)}"><span class="lp-ic" aria-hidden="true">&#9654;</span>
          <span class="lp-vn">${escape(names[vid] || vid)}</span> <span class="lp-len">${fmtTime(ref.sec)}</span></a>`);
  }
  if (!buttons.length) return { html: `<p class="lp-ingame">Hear this one in game: <a href="${DOWNLOAD}">get Lore Forever</a>.</p>`, n: 0 };
  return { html: `<div class="lp-play">${buttons.join("\n        ")}</div>`, n: buttons.length };
}

function clipSection(clip, live, names, heading) {
  const p = players(clip, live, names);
  const text = readAlong(clip.paras || []);
  // What a quest giver says when you turn the quest in can give the ending away: folded until asked for.
  const body = clip.part === "complete"
    ? `<details class="lp-fold"><summary>Show the words</summary><div class="lp-text">${text}</div></details>`
    : `<div class="lp-text">${text}</div>`;
  return `<section class="lp-clip lp-${escape(clip.part)}" id="${escape(clip.anchor)}" data-clip="${escape(clip.id)}" data-hash="${escape(clip.hash)}">
      <${heading}>${escape(clip.title)}</${heading}>
      ${p.html}
      ${body}
      ${p.n ? `<p class="lp-tools"><button type="button" class="lp-rep" hidden>Report a problem with this line</button>
        <span class="lp-open" hidden></span></p>` : ""}
    </section>`;
}

function sourceItem(s) {
  if (s.kind === "wiki") {
    // An article from Wowpedia (lore.wowpedia) names itself and its own license; the default is Warcraft Wiki, CC BY-SA 4.0.
    const site = s.site === "Wowpedia" ? "Wowpedia" : "Warcraft Wiki";
    const [lic, licUrl] = site === "Wowpedia" ? ["CC BY-SA 3.0", "https://creativecommons.org/licenses/by-sa/3.0/"]
      : ["CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"];
    return `<li><span class="src src-wiki">Wiki</span> Adapted from the ${site} article
        <a href="${escape(s.url)}">${escape(s.title)}</a> (<a href="${licUrl}">${lic}</a>)</li>`;
  }
  if (s.kind === "forever") return `<li><span class="src src-forever">Forever</span> ${escape(s.title)}</li>`;
  if (s.kind === "community") return `<li><span class="src src-community">Community</span> ${escape(s.title)}</li>`;
  if (s.kind === "game") return `<li><span class="src src-game">Game</span> ${escape(s.title)}</li>`;
  if (s.kind === "web") return `<li><span class="src src-web">Web</span> <a href="${escape(s.url)}">${escape(s.title)}</a></li>`;
  return `<li class="src-note">${escape(s.title)}</li>`;
}

const linkList = links => `<ul class="lp-links">
        ${links.map(l => `<li><a href="${escape(l.p)}">${escape(l.n)}</a></li>`).join("\n        ")}
      </ul>`;

function grouped(links) {
  const out = [];
  for (const [kind, label] of Object.entries(KIND_GROUPS)) {
    const some = links.filter(l => l.k === kind);
    if (some.length) out.push(`<h3>${label} <span class="lp-count">${some.length}</span></h3>\n      ${linkList(some)}`);
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

const cta = `<aside class="lp-cta">
    <h2>Hear it as you play</h2>
    <p>Lore Forever tells you the story of each zone, place, character and quest as you reach it in WoW Forever, read
      aloud, and answers what you wonder about along the way.</p>
    <p><a class="btn-download" href="${DOWNLOAD}">Get Lore Forever</a></p>
  </aside>`;

const foot = `<p>Lore text is adapted from the <a href="https://warcraft.wiki.gg">Warcraft Wiki</a> under
    <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>; each page names its articles. Quest text
    is the game's own, &copy; Blizzard Entertainment.</p>`;

// A thin page (site_lore.py THIN_CHARS: a line or two, nothing to play) is served but kept out of search: noindex in the
// header and the page, and out of the sitemap. Its links are still followed.
const noindex = (env, entry) => (isPublic(env) && !entry?.thin ? undefined : "noindex");
export const htmlHeaders = (env, entry) => ({
  "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache",
  ...(noindex(env, entry) ? { "X-Robots-Tag": "noindex" } : {}),
});

const HEAD = `<link rel="stylesheet" href="/lore/lore.css?${FRESH}">`;
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
export function searchTitle(entry) {
  const name = displayName(entry);
  const zone = zoneOf(entry);
  const short = entry.kind === "quest" ? `${name} – WoW Forever Quest${zone ? ` in ${zone}` : ""}`
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
export function searchDescription(entry) {
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

// /lore/<type>/<id>: one entry. live: the recordings R2 has (liveKeys); names: voiceNames; packs: the downloads with
// its recording (packsSection).
export function entryPage(entry, { live = new Set(), names = {}, env, packs = [] } = {}) {
  const zone = entry.zone;
  const where = [
    `<span class="tag lp-tag">${escape(entry.label)}</span>`,
    zone && zone.path !== entry.path ? (zone.path ? `<a href="${escape(zone.path)}">${escape(zone.name)}</a>` : escape(zone.name)) : "",
    escape(entry.levels || ""),
  ].filter(Boolean).join(" &middot; ");
  const clipsHtml = [];
  const faqs = (entry.clips || []).filter(c => c.part === "faq");
  for (const c of entry.clips || []) {
    if (c.part === "faq") continue;
    clipsHtml.push(clipSection(c, live, names, "h2"));
  }
  if (faqs.length) {
    clipsHtml.push(`<h2 class="lp-faqs">Questions, answered</h2>\n    ${faqs.map(c => clipSection(c, live, names, "h3")).join("\n    ")}`);
  }
  const playable = (entry.clips || []).some(c => players(c, live, names).n);
  const intro = (entry.intro || []).length ? `<div class="lp-intro">${(entry.intro || []).map(p => `<p>${escape(p)}</p>`).join("")}</div>` : "";
  // An entry with no recording reads as text: each spoiler-free section under its own heading (a narrated page has the
  // narration instead).
  const sections = (entry.sections || []).map(s => `<section class="lp-sec">
      <h2>${escape(s.t)}</h2>
      <div class="lp-text">${(s.p || []).map(p => `<p>${escape(p)}</p>`).join("")}</div>
    </section>`).join("\n    ");
  const speed = playable ? `<div class="lp-speed" role="group" aria-label="Playback speed" hidden>Speed
      <button type="button" data-rate="1" aria-pressed="true">1&times;</button><button type="button" data-rate="1.25"
        aria-pressed="false">1.25&times;</button><button type="button" data-rate="1.5" aria-pressed="false">1.5&times;</button>
    </div>` : "";
  const sources = (entry.sources || []).length
    ? `<section class="lp-src" aria-labelledby="src-title">
      <h2 id="src-title">Sources</h2>
      <ul>
        ${entry.sources.map(sourceItem).join("\n        ")}
      </ul>
    </section>` : "";
  const children = (entry.children || []).length
    ? `<section class="lp-in" aria-labelledby="in-title">
      <h2 id="in-title">In ${escape(entry.name)}</h2>
      ${grouped(entry.children)}
    </section>` : "";
  const related = (entry.related || []).length
    ? `<section class="lp-rel" aria-labelledby="rel-title">
      <h2 id="rel-title">Related</h2>
      ${linkList(entry.related)}
    </section>` : "";
  // Look it up (LOR-263): its Wowhead page and its wiki article (the first one it was adapted from, else a search).
  const wowhead = wowheadUrl(entry.wowhead);
  const wikiSources = (entry.sources || []).filter(s => s.kind === "wiki");
  const wikiGg = wikiSources.find(s => /^https:\/\/warcraft\.wiki\.gg\//.test(s.url || ""))?.url;
  const wowpedia = wikiGg ? null : wikiSources.find(s => /^https:\/\/wowpedia\.fandom\.com\//.test(s.url || ""))?.url;
  const wiki = wikiGg || wowpedia || wikiSearch(entry.name);
  const lookup = `<section class="lp-out" aria-labelledby="out-title">
      <h2 id="out-title">Look it up</h2>
      <ul class="lp-links">
        ${wowhead ? `<li><a href="${escape(wowhead)}" rel="noopener">${escape(entry.name)} on Wowhead</a> <span class="lp-count">WoW Forever database</span></li>` : ""}
        <li><a href="${escape(wiki)}" rel="noopener">${escape(entry.name)} on ${wowpedia ? "Wowpedia" : "the Warcraft Wiki"}</a></li>
      </ul>
    </section>`;
  const body = `  <article class="lp" data-key="${escape(entry.key)}">
    <p class="lp-where">${where}</p>
    <h1>${escape(displayName(entry))}</h1>
    ${intro}
    ${speed}
    ${sections}
    ${clipsHtml.join("\n    ")}
    ${packsSection(packs)}
    ${sources}
    ${lookup}
    ${children}
    ${related}
  </article>
  ${cta}
  ${playable ? reportDialog() : ""}`;
  const crumbs = [`<a href="/lore">Lore</a>`];
  if (zone && zone.path && zone.path !== entry.path) crumbs.push(`<a href="${escape(zone.path)}">${escape(zone.name)}</a>`);
  crumbs.push(escape(displayName(entry)));
  const { short, full } = searchTitle(entry);
  return page({
    title: short, fullTitle: full, description: searchDescription(entry), path: entry.path, body,
    crumbs: crumbs.join(" &rsaquo; "), foot, scripts: SCRIPTS, robots: noindex(env, entry),
    head: `${HEAD}\n${breadcrumbLd(entry)}`,
  });
}

// /lore: the list. Filters, search and the player come from public/lore/lore.js reading index.json; without
// JavaScript the zones below still lead to every page. packs: the downloads to filter by (LOR-437; lib/packs.js
// packOptions, [{value: pack folder, name, href, voice | lang, sample}]): lore.js reads /data/pack-entries.json when
// one is picked, plays the pack's narrator in the list (voice), or else says what it plays in the add-on and offers
// its sample (.lx-packnote).
const packOption = p => {
  const data = { href: p.href, voice: p.voice, lang: p.lang, sample: p.sample?.audio, "sample-title": p.sample?.title,
    "sample-lang": p.sample?.lang, "sample-key": p.sample?.key };
  const attrs = Object.entries(data).filter(([, v]) => v).map(([k, v]) => ` data-${k}="${escape(v)}"`).join("");
  return `<option value="${escape(p.value)}"${attrs}>${escape(p.name)}</option>`;
};

export function indexPage(index, { more, env, packs = [] } = {}) {
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
  const body = `  <section class="lx" aria-labelledby="lx-title">
    <h1 id="lx-title">Hear the lore</h1>
    <p class="pitch">Every story Lore Forever tells: zones and capitals, the places and people in them, dungeon bosses,
      items and what quest givers say. Play the ones read aloud here, then hear them in game as you get there.</p>
    <p class="lx-stats">${clipCount.toLocaleString("en-US")} narrations &middot; ${pages.length.toLocaleString("en-US")} pages &middot;
      ${(index?.voices || []).length} narrators</p>
    <p class="lx-soon" hidden>Listening here is on its way. Every line below already plays in game:
      <a href="${DOWNLOAD}">get Lore Forever</a>.</p>
    <form class="lx-bar" role="search" hidden>
      <label class="lx-search"><span class="visually-hidden">Search</span>
        <input type="search" name="q" placeholder="Search a zone, place, character, quest or item" autocomplete="off"></label>
      <label class="lx-zone"><span class="visually-hidden">Zone</span><select name="z"><option value="">All zones</option></select></label>
      ${packs.length ? `<label class="lx-zone lx-pack"><span class="visually-hidden">Download</span><select name="p"><option value="">Any download</option>
        ${packs.map(packOption).join("\n        ")}
      </select></label>` : ""}
      <div class="lx-chips" role="group" aria-label="Kind"></div>
      <div class="lx-chips lx-voices" role="group" aria-label="Voice"></div>
      <label class="lx-check"><input type="checkbox" name="playable"> Playable here</label>
    </form>
    <p class="lx-packnote" hidden></p>
    <p class="lx-count" aria-live="polite"></p>
    <div class="lx-list" role="list"></div>
    <p><button type="button" class="lx-more btn-small" hidden>Show more</button></p>
    <p class="lx-keys" hidden><kbd>j</kbd>/<kbd>k</kbd> move &middot; <kbd>space</kbd> play or pause &middot; <kbd>enter</kbd> open
      &middot; <kbd>/</kbd> search &middot; <kbd>s</kbd> speed &middot; <kbd>v</kbd> voice</p>
  </section>
  <section class="lx-zones" aria-labelledby="zones-title">
    <h2 id="zones-title">Browse by zone</h2>
    ${zoneGroups}
  </section>
  ${others.length ? `<section class="lx-zones" aria-labelledby="more-title">
    <h2 id="more-title">Topics and more</h2>
    ${grouped(others)}
  </section>` : ""}
  ${cta}
  <div class="lx-player" hidden>
    <button type="button" class="lx-pp" aria-label="Play">&#9654;</button>
    <div class="lx-now"><a class="lx-title" href="#"></a><span class="lx-sub"></span>
      <input class="lx-seek" type="range" min="0" max="1000" value="0" aria-label="Position"></div>
    <span class="lx-time">0:00</span>
    <div class="lx-pctl">
      <button type="button" class="lx-prev" aria-label="Previous">&#9198;</button><button type="button" class="lx-next" aria-label="Next">&#9197;</button>
      <button type="button" class="lx-voice" aria-label="Switch voice"></button>
      <button type="button" class="lx-rate" aria-label="Playback speed">1&times;</button>
      <label class="lx-auto"><input type="checkbox"> Next plays on</label>
      <button type="button" class="lp-rep lx-report" hidden>Report</button><span class="lp-open lx-open" hidden></span>
    </div>
  </div>
  ${reportDialog()}`;
  return page({
    title: "WoW Forever Lore: every zone, place and quest", fullTitle: "WoW Forever Lore: every zone, place and quest | Lore Forever",
    description: "Read and listen to the stories of WoW Forever's zones, places, characters, items, dungeon bosses and " +
      "quest givers, as Lore Forever tells them in game. Search, filter by zone and play.",
    path: "/lore", body, crumbs: "", foot, scripts: SCRIPTS, robots: noindex(env), head: HEAD,
  });
}

export function missingLorePage(env) {
  return page({
    title: "No lore page here",
    description: "This lore page doesn't exist (yet).",
    path: "/lore", crumbs: `<a href="/lore">Lore</a>`,
    body: `  <h1>No lore page here</h1>
  <p class="pitch">We don't have a page at this address. It may have moved when its story was rewritten.</p>
  <p class="vp-actions"><a class="btn-small" href="/lore">All the lore</a> <a class="btn-small" href="/">What's Lore Forever?</a></p>`,
    robots: "noindex", foot, scripts: "", head: HEAD,
  });
}

// /lore/sitemap.xml: /lore and every page that isn't thin (x), once the pages are public; an empty (valid) sitemap
// until then.
export function sitemap(index, env, more) {
  const urls = isPublic(env) ? ["/lore", ...allPages(index, more).filter(p => !p.x).map(p => p.p)] : [];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>https://${HOME}${escape(u)}</loc></url>`).join("\n")}
</urlset>
`;
}
