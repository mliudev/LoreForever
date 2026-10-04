// The /voices page (functions/voices/index.js; /downloads redirects there): every file a player might want, built
// from the same data the rest of the site uses, so a voice or language added there shows up here with no code
// change.
//   - voices: public/voices/voices.json (lib/voices.js). A voice with "included": true comes with the add-on; any
//     other live voice with a download is listed with its core pack and its "packs" (lands packs, an all-in-one zip).
//   - languages: public/translate/packs.json (lib/translations.js). A pack with "included": true comes with the
//     add-on; the rest get a download button.
// Sizes: a pack's optional "size" (bytes) is shown as is. Otherwise each download row carries data-asset (the release
// asset's tag and file name) and public/voices-page.js fills the size in from GitHub's release API in the browser.
//
// Copy rule (as for /voices): never say how a voice or a translation is made.

import { escape, likeButton } from "./voices.js";

const plural = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
// voices.json coverage is written to follow "Covers ..."; on its own line it starts with a capital and ends with a stop.
const sentence = s => { const t = String(s).trim(); return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : "."); };

export function formatSize(bytes) {
  if (!(bytes > 0)) return "";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  if (bytes >= 1e6) return Math.round(bytes / 1e6) + " MB";
  return Math.max(1, Math.round(bytes / 1e3)) + " KB";
}

// "latest:LoreForever.zip" or "<tag>:<file>" for a GitHub release asset of the public repo, so the browser can look
// up its size. The site's own /download/<file> links stand for assets of the latest release.
const SITE_FILES = { zip: "LoreForever.zip", installer: "LoreForever-Setup.exe", complete: "LoreForever-complete.zip" };
export function assetRef(url) {
  const u = String(url || "");
  let m = /^\/download\/(zip|installer|complete)$/.exec(u);
  if (m) return "latest:" + SITE_FILES[m[1]];
  m = /\/releases\/latest\/download\/([^/?#]+)$/.exec(u);
  if (m) return "latest:" + decodeURIComponent(m[1]);
  m = /\/releases\/download\/([^/]+)\/([^/?#]+)$/.exec(u);
  if (m) return decodeURIComponent(m[1]) + ":" + decodeURIComponent(m[2]);
  return "";
}

// Alliance, Horde, or both, from a pack's "faction" or else its id ("female-alliance-lands").
export function packFaction(p) {
  const f = String(p.faction || p.id || "").toLowerCase();
  return /alliance/.test(f) ? "alliance" : /horde/.test(f) ? "horde" : "";
}
const FACTION_LABEL = { alliance: "Alliance", horde: "Horde" };

function sizeCell(item, href) {
  const known = formatSize(item.size);
  const ref = known ? "" : assetRef(item.download && /^https:/.test(item.download) ? item.download : href);
  return `<span class="dl-size"${ref ? ` data-asset="${escape(ref)}"` : ""}>${known}</span>`;
}

// How much of the catalog a pack records. Partial packs (voices.json "total": the catalog's line count for the
// pack's locale) read "140 of 842 narrations" with a thin meter, plus "races" when it's for certain peoples.
function amount(clips, item) {
  if (!clips) return "";
  const total = item.total > 0 ? item.total : 0;
  if (!total || clips >= total) return plural(clips, "narration", "narrations");
  const pct = Math.max(2, Math.round(clips / total * 100));
  return `${clips.toLocaleString("en-US")} of ${plural(total, "narration", "narrations")} ` +
    `<span class="dl-meter" role="img" aria-label="${pct}% of all narrations"><span style="width:${pct}%"></span></span>`;
}
const races = item => (item.races || []).filter(Boolean).map(r => String(r).charAt(0).toUpperCase() + String(r).slice(1));

const packHref = p => p.download.startsWith("/") ? p.download : `/download/voice/${p.id}`;
const isAll = p => !packFaction(p) && /complete|all|everything/i.test(p.id + " " + p.name);
const DOT = '<span class="dl-dot" aria-hidden="true"> &middot; </span>';

function playButton(v) {
  const s = v.sample;
  if (!s) return "";
  return `<button class="dl-play" type="button" aria-label="Play a sample of ${escape(v.name)}: ${escape(s.title)}"
          title="${escape(s.title)}${s.length ? " · " + escape(s.length) : ""}">&#9654;</button>
        <audio class="dl-audio" preload="none" src="${escape(s.src)}"></audio>`;
}

// One voice. A voice that comes with the add-on just says so. Any other voice gets one big Download: its
// all-in-one zip when it has one ("Download everything"), else its own pack. Its other packs (the core, Alliance and
// Horde lands) follow as small links. Every file keeps its id as an anchor, and data-pack is the id a later
// "download several" checkbox would send.
export function voiceBlock(v, likes) {
  const packs = (v.packs || []).filter(p => p.download && p.status !== "soon");
  const files = [];
  if (!v.included && v.download) {
    files.push({ id: packs.length ? `${v.id}-core` : `${v.id}-file`, name: packs.length ? "Core" : v.name,
      href: `/download/voice/${v.id}`, item: v, pack: v.id, clips: v.clips });
  }
  for (const p of packs) files.push({ id: p.id, name: p.name, href: packHref(p), item: p, pack: p.id, clips: p.clips,
    faction: packFaction(p), all: isAll(p) });
  const main = v.included ? null : files.find(f => f.all) || files[0];
  const rest = files.filter(f => f !== main && !v.included);
  const who = [`by ${escape(v.contributor?.name || v.credit)}`, escape(v.language),
    escape(races(v).join(", "))].filter(Boolean).join(" &middot; ");
  let get;
  if (v.included) {
    get = `<p class="dl-included"><span class="dl-check" aria-hidden="true">&#10003;</span> Comes with Lore Forever</p>`;
  } else if (main) {
    get = `<a class="btn-download dl-big" id="${escape(main.id)}" data-pack="${escape(main.pack)}" href="${escape(main.href)}"
          aria-label="Download ${escape(v.name)}${main.all ? ", everything" : ""}">${main.all ? "Download everything" : "Download"}</a>
        <p class="dl-file-meta">${[amount(main.clips, main.item), sizeCell(main.item, main.href)].filter(Boolean).join(DOT)}</p>`;
  } else {
    get = `<p class="dl-included">Download coming soon</p>`;
  }
  const small = rest.length
    ? `<p class="dl-parts">Or just one part:
          ${rest.map(f => `<a id="${escape(f.id)}" data-pack="${escape(f.pack)}" href="${escape(f.href)}" aria-label="Download ${escape(v.name)}, ${escape(f.name)}">${escape(f.name)}</a>${f.faction ? ` <span class="dl-faction dl-${f.faction}">${FACTION_LABEL[f.faction]}</span>` : ""} <span class="dl-file-meta">(${[f.clips ? f.clips.toLocaleString("en-US") : "", sizeCell(f.item, f.href)].filter(Boolean).join('<span class="dl-dot" aria-hidden="true">, </span>')})</span>`).join(DOT)}</p>`
    : "";
  // The voice's own coverage line describes its core pack, so a voice with an all-in-one zip leaves it to the parts.
  const cover = v.coverage && !(main && main.all) ? `<p class="dl-cover">${escape(sentence(v.coverage))}</p>` : "";
  const most = Math.max(v.clips || 0, ...packs.map(p => p.clips || 0));
  return `<article class="dl-card dl-voice${v.included ? " dl-voice-included" : ""}" id="${escape(v.id)}">
      <div class="dl-voice-head">
        ${playButton(v)}
        <div>
          <h3><a href="/voices/${escape(v.id)}">${escape(v.name)}</a>${v.included ? ' <span class="tag">Default</span>' : ""}</h3>
          <p class="dl-sub">${who}${most ? " &middot; " + plural(most, "narration", "narrations") : ""}</p>
          ${cover}
          ${likes ? likeButton(v, likes[v.id]) : ""}
        </div>
      </div>
      <div class="dl-voice-get">
        ${get}
      </div>
      ${small}
    </article>`;
}

// Voices you download come first, then the ones that come with the add-on.
// likes: {voice id: count} (lib/voices.js likeCounts), or omitted for no like buttons.
export function voicesSection(voices, likes) {
  const live = voices.filter(v => v.status === "live");
  return [...live.filter(v => !v.included), ...live.filter(v => v.included)].map(v => voiceBlock(v, likes))
    .join("\n    ");
}

// One language: its name, then "comes with the add-on" or a download button.
export function languageRow(p) {
  const href = `/download/lang/${p.locale}`;
  const right = p.included
    ? `<span class="dl-included-chip"><span class="dl-check" aria-hidden="true">&#10003;</span> Included</span>`
    : `<a class="btn-small dl-get" href="${escape(href)}" aria-label="Download ${escape(p.name)}">Download</a>`;
  const meta = p.included ? "In the main download" : sizeCell(p, href);
  return `<li class="dl-file" id="lang-${escape(p.locale)}">
          <div class="dl-file-main">
            <p class="dl-file-name" lang="${escape(p.locale.slice(0, 2).toLowerCase())}">${escape(p.name)}</p>
            <p class="dl-file-meta">${meta}</p>
          </div>
          ${right}
        </li>`;
}

export function languagesSection(packs) {
  const list = arr => arr.length > 1 ? arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1] : arr[0] || "";
  const included = ["English", ...packs.filter(p => p.locale && p.included).map(p => escape(p.name))];
  const separate = packs.filter(p => p.locale && !p.included && p.download);
  return `<p class="dl-langs">${list(included)} come with the add-on. Pick one in Options &rsaquo; Language.</p>` +
    (separate.length ? `\n      <ul class="dl-files">\n        ${separate.map(languageRow).join("\n        ")}\n      </ul>` : "");
}

// The "what's inside" line under the main download: the voices and languages that come with it.
export function includedLine(voices, packs) {
  const v = voices.filter(x => x.included && x.status === "live")
    .map(x => `the ${escape(x.name.replace(/^Lore Forever /, ""))}${x.clips ? ` (${plural(x.clips, "narration", "narrations")})` : ""}`);
  const langs = ["English", ...packs.filter(p => p.included).map(p => escape(p.name))];
  const list = arr => arr.length > 1 ? arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1] : arr[0] || "";
  return `Comes with the whole lore library in ${list(langs)}${v.length ? `, and ${list(v)}` : ""}.`;
}
