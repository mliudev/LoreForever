// Server-rendered language/narrator choices. Existing catalog links work without JavaScript.
import { escape, likeButton } from "./voices.js";
const list = arr => arr.length > 1 ? arr.slice(0, -1).join(", ") + " and " + arr.at(-1) : arr[0] || "";
const count = n => Number.isSafeInteger(n) && n > 0 ? n : 0;
const validId = value => typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value);
const released = item => item && (!item.status || item.status === "live");
const safeDownload = value => typeof value === "string" && (/^\/download\/[a-zA-Z0-9/_-]+$/.test(value) || /^https:\/\//.test(value));
const cfHref = value => /^https:\/\/www\.curseforge\.com\/wow\/addons\/[a-z0-9-]+\/?$/.test(value || "") ? value : "";
const versionTag = value => /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(value || "") ? `v${value}` : "";
export function formatSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "";
  return bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + " GB" : bytes >= 1e6 ? Math.round(bytes / 1e6) + " MB" : Math.max(1, Math.round(bytes / 1e3)) + " KB";
}
const SITE_FILES = { zip: "LoreForever.zip", installer: "LoreForever-Setup.exe", complete: "LoreForever.zip" };
export function assetRef(url) {
  const u = String(url || ""), local = /^\/download\/(zip|installer|complete)$/.exec(u);
  if (local) return "latest:" + SITE_FILES[local[1]];
  try {
    const parsed = new URL(u);
    if (parsed.origin !== "https://github.com" || parsed.search || parsed.hash) return "";
    let m = /^\/mliudev\/LoreForever\/releases\/latest\/download\/([^/]+)$/.exec(parsed.pathname);
    if (m) return "latest:" + decodeURIComponent(m[1]);
    m = /^\/mliudev\/LoreForever\/releases\/download\/([^/]+)\/([^/]+)$/.exec(parsed.pathname);
    if (m) return decodeURIComponent(m[1]) + ":" + decodeURIComponent(m[2]);
  } catch {}
  return "";
}
export function packFaction(p) {
  const f = String(p.faction || p.id || "").toLowerCase();
  return /alliance/.test(f) ? "alliance" : /horde/.test(f) ? "horde" : "";
}
function sizeCell(item, href) {
  const ref = assetRef(item.download) || assetRef(href);
  return `<span class="dl-size"${ref ? ` data-asset="${escape(ref)}"` : ""}>${formatSize(item.size) || "Size unavailable"}</span>`;
}
function playButton(v) {
  const s = v.sample;
  if (!s || typeof s.src !== "string" || !/^\/(?!\/)[a-zA-Z0-9/_.-]+$/.test(s.src)) return "";
  return `<button class="dl-play" type="button" aria-pressed="false" aria-label="Play a sample of ${escape(v.name)}: ${escape(s.title)}" title="${escape(s.title)}">&#9654;</button>
    <audio class="dl-audio" preload="none" src="${escape(s.src)}">
    </audio>`;
}
// Choose released bundles instead of members; counts always use distinct leaf components.
function fallbackFiles(files) {
  const leaves = files.filter(f => !f.item.contains?.length), byId = new Map(leaves.map(f => [f.pack, f]));
  const covered = new Set(), chosen = [];
  const bundles = files.filter(f => Array.isArray(f.item.contains) && f.item.contains.length && f.item.contains.every(id => byId.has(id))).sort((a, b) => b.item.contains.length - a.item.contains.length);
  for (const bundle of bundles) {
    if (bundle.item.contains.some(id => covered.has(id))) continue;
    chosen.push(bundle); bundle.item.contains.forEach(id => covered.add(id));
  }
  return { leaves, downloads: [...chosen, ...leaves.filter(f => !covered.has(f.pack))] };
}
function translationFor(group, packs) {
  const locale = group.files.map(f => /_([a-z]{2}[A-Z]{2})$/.exec(f.item.addon || "")?.[1]).find(Boolean);
  return packs.find(p => p.locale === locale);
}
function preferredBundle(v, group, packs) {
  if (!/^LoreForever_Voice_(Default|Female)$/.test(v.addon || "") || group.included || group.extra) return "";
  const translation = translationFor(group, packs), versions = [...new Set(packs.map(p => p.version).filter(Boolean))];
  const tag = versionTag(translation?.version || (group.language === "English" && versions.length === 1 ? versions[0] : ""));
  const locale = translation?.locale || (group.language === "English" ? "enUS" : "");
  // Metadata only: no href is supplied until the exact tag and filename exist.
  return tag && locale ? `${tag}:${v.addon}_${locale}-complete.zip` : "";
}
export function voiceChoices(v, packs = []) {
  if (!validId(v?.id) || !released(v)) return [];
  const baseLanguage = v.language || "English", groups = new Map();
  const add = (language, file, extra = false) => {
    const key = extra ? file.pack : language;
    if (!groups.has(key)) groups.set(key, { language, files: [], extra, included: false });
    groups.get(key).files.push(file);
  };
  if (v.included) groups.set(baseLanguage, { language: baseLanguage, files: [], included: true, extra: false });
  else if (safeDownload(v.download)) add(baseLanguage, { id: v.packs?.length ? `${v.id}-core` : `${v.id}-file`, name: v.packs?.length ? "Core stories" : v.name, href: `/download/voice/${v.id}`, item: v, pack: v.id });
  for (const p of Array.isArray(v.packs) ? v.packs : []) {
    if (!validId(p?.id) || !released(p) || !safeDownload(p.download)) continue;
    if (v.included && !p.language && p.included !== false) continue;
    const questDialogue = /_Quests(?:_|$)|_QuestGivers$/.test(p.addon || "");
    add(p.language || baseLanguage, { id: p.id, name: p.name, href: p.download.startsWith("/") ? p.download : `/download/voice/${p.id}`, item: p, pack: p.id }, p.included === false || questDialogue);
  }
  return [...groups.values()].map(group => {
    const { leaves, downloads } = fallbackFiles(group.files), translation = translationFor(group, packs);
    if (!group.extra && translation && !translation.included && released(translation) && safeDownload(translation.download)) downloads.push({ id: `lang-${translation.locale}-${v.id}`, name: `${translation.name} text`, href: `/download/lang/${translation.locale}`, item: translation, pack: `lang-${translation.locale}` });
    const clips = group.included ? count(v.clips) : leaves.every(f => count(f.item.clips)) ? leaves.reduce((n, f) => n + f.item.clips, 0) : 0;
    const id = group.extra ? group.files[0].pack : group.language === baseLanguage ? v.id : `${v.id}-${translation?.locale || group.files[0].pack}`;
    return { ...group, id, leaves, downloads, translation, clips, preferred: preferredBundle(v, group, packs) };
  });
}
function fileLink(file, includeId = true) {
  return `<li class="dl-file"${includeId ? ` id="${escape(file.id)}"` : ""}>
    <div class="dl-file-main">
    <p class="dl-file-name">${escape(file.name)}</p>
    <p class="dl-file-meta">Download size: ${sizeCell(file.item, file.href)}</p>${file.item.coverage ? `<p class="dl-cover">${escape(file.item.coverage)}</p>` : ""}</div>
    <a class="btn-small dl-get" data-pack="${escape(file.pack)}" href="${escape(file.href)}" aria-label="Download ${escape(file.name)} as a ZIP">Manual ZIP</a>
    </li>`;
}
function curseforgeChoices(v, group) {
  const ids = new Set(group.leaves.map(f => f.pack)), links = [], covered = new Set();
  if (cfHref(v.curseforge) && Array.isArray(v.curseforgeContains) && v.curseforgeContains.length && v.curseforgeContains.every(id => ids.has(id))) {
    const contents = group.leaves.filter(f => v.curseforgeContains.includes(f.pack));
    v.curseforgeContains.forEach(id => covered.add(id));
    links.push(`<li id="${escape(v.id)}-curseforge">
    <a href="${escape(v.curseforge)}">${escape(v.curseforgeLabel || "Stories on CurseForge")}</a>
    <p>Includes ${list(contents.map(f => escape(f.name)))} (${contents.reduce((n, f) => n + count(f.item.clips), 0).toLocaleString("en-US")} recordings). ${escape(v.curseforgeBundleNote || "")}</p>
    </li>`);
  }
  for (const file of group.leaves) {
    const url = cfHref(file.item.curseforge);
    if (!url || covered.has(file.pack) || file.item.curseforgeContains?.length > 1) continue;
    covered.add(file.pack); links.push(`<li>
    <a href="${escape(url)}">${escape(file.name)} on CurseForge</a>
    <p>${escape(file.item.coverage || "")}</p>
    </li>`);
  }
  const extras = group.leaves.filter(f => !covered.has(f.pack));
  return links.length ? `<h4>CurseForge</h4>
    <ul class="dl-cf-choices">${links.join("")}</ul>${extras.length ? `<p class="dl-pack-note">Also install the manual ZIP${extras.length === 1 ? "" : "s"} for ${list(extras.map(f => escape(f.name)))} to get all ${group.clips.toLocaleString("en-US")} recordings in this choice.</p>` : ""}` : "";
}
function choiceRow(v, group, likes, languageAnchor = "") {
  const included = group.included, name = group.extra ? group.files[0].name : v.name.replace(/^Lore Forever /, "");
  const assets = group.downloads.map(f => assetRef(f.item.download) || assetRef(f.href));
  const knownSize = group.downloads.every(f => formatSize(f.item.size)) ? formatSize(group.downloads.reduce((n, f) => n + f.item.size, 0)) : "";
  const size = included ? `<span class="dl-included-chip">In main add-on</span>` : `<span class="dl-size dl-total-size"${assets.every(Boolean) ? ` data-assets="${escape(JSON.stringify(assets))}"` : ""}>${knownSize || "Size unavailable"}</span>
    <small class="dl-size-kind">${group.downloads.length > 1 ? "Total download" : "ZIP download"}</small>`;
  const alternatives = group.files.filter(f => !group.downloads.includes(f));
  const manual = `<div class="dl-preferred" hidden>
    <p>
    <a class="btn-small dl-get" data-preferred-link>Get one manual ZIP</a>
    </p>
    <p>Includes all available ${group.extra ? "recordings" : "stories and answers"} in this choice${group.translation ? " and the matching translated text" : ""}.</p>
    </div>
    <div class="dl-fallback">
    <h4 class="dl-fallback-title">Manual download${group.downloads.length > 1 ? "s" : ""}</h4>${group.downloads.length > 1 ? `<p class="dl-fallback-note">Install all ${group.downloads.length} ZIPs for this choice. The table shows their total compressed download size.</p>` : ""}<ul class="dl-files">${group.downloads.map(f => fileLink(f, f.id !== group.id)).join("")}</ul>
    </div>
    ${alternatives.length ? `<details class="dl-alternatives">
    <summary>Individual alternatives</summary>
    <ul class="dl-files">${alternatives.map(f => fileLink(f)).join("")}</ul>
    </details>` : ""}`;
  const action = included ? `<a class="dl-included-chip" href="#addon">Included with add-on</a>` : `<details class="dl-install-choice" name="voice-install"${group.preferred ? ` data-preferred="${escape(group.preferred)}"` : ""}>
    <summary class="btn-small" aria-label="Get ${escape(group.language)} ${escape(name)} voice pack">Get voice pack</summary>
    <div class="dl-install-panel">
    <h3>${escape(group.language)} &middot; ${escape(name)}</h3>
    <p>${group.clips ? group.clips.toLocaleString("en-US") + " available recordings." : "Recording count unavailable."} Other entries remain readable as text.</p>${group.translation ? `<p>${escape(group.translation.name)} text ${group.translation.included ? "is included with the main add-on." : "comes with this voice choice."}</p>` : ""}${curseforgeChoices(v, group)}${manual}<p>
    <a href="#install">Install help</a> &middot; Pick the voice in game with <code>/lore voice</code>.</p>
    </div>
    </details>`;
  return `<tr class="dl-voice dl-choice${included ? " dl-choice-included" : ""}" id="${escape(group.id)}" data-recording data-voice="${escape(group.extra ? group.id : v.id)}" data-voice-name="${escape(name)}" data-language="${escape(group.language)}">
    <td data-label="Language">
    ${languageAnchor ? `<span id="lang-${escape(languageAnchor)}"></span>` : ""}
    <strong>${escape(group.language)}</strong>
    <small class="dl-text-note">${group.language === "English" ? "English text" : group.translation ? "Matching translated text" : "Text availability varies"}</small>
    </td>
    <td data-label="Voice">
    <div class="dl-voice-head">${group.language === (v.language || "English") && !group.extra ? playButton(v) : ""}<div>
    <a class="dl-narrator" href="/voices/${escape(v.id)}">${escape(name)}</a>
    <small class="dl-sub">by ${escape(v.contributor?.name || v.credit || "Community narrator")}</small>
    </div>
    </div>
    ${likes && !group.extra ? likeButton(v, likes[v.id]) : ""}</td>
    <td data-label="Recordings">
    <span class="dl-recording-count">${group.clips ? group.clips.toLocaleString("en-US") : "Count unavailable"}</span>
    <small>Partial coverage</small>
    </td>
    <td data-label="Download size">${size}</td>
    <td class="dl-choice-action">${action}</td>
    </tr>`;
}
export function voiceBlock(v, likes, packs = []) { return voiceChoices(v, packs).map(group => choiceRow(v, group, likes)).join("\n"); }
export function voicesSection(voices, likes, packs = []) {
  const choices = voices.filter(v => v.status === "live" && validId(v.id)).flatMap(v => voiceChoices(v, packs).map(group => ({ v, group })));
  choices.sort((a, b) => (a.group.language === b.group.language ? 0 : a.group.language === "English" ? -1 : b.group.language === "English" ? 1 : a.group.language.localeCompare(b.group.language)) || Number(b.group.included) - Number(a.group.included) || a.v.name.localeCompare(b.v.name));
  const languages = new Set();
  return choices.map(({ v, group }) => {
    const locale = group.translation?.locale;
    const anchor = /^[a-z]{2}[A-Z]{2}$/.test(locale || "") && !languages.has(locale) ? locale : "";
    if (anchor) languages.add(anchor);
    return choiceRow(v, group, likes, anchor);
  }).join("\n");
}
export function languagesSection() { return `<p class="dl-intro">Matching translations are shown with their voices above. Lore Forever follows your WoW client\'s language. Change it under Options &rsaquo; AddOns &rsaquo; Lore Forever &rsaquo; Language, or type <code>/lore lang</code>.</p>`; }
export function includedLine(voices) {
  const included = voices.filter(v => v.included && v.status === "live");
  return `English text and ${list(included.map(v => `${escape(v.name.replace(/^Lore Forever /, ""))}${count(v.clips) ? ` (${v.clips.toLocaleString("en-US")} recordings)` : ""}`)) || "English male narration"} come with the main add-on.`;
}
