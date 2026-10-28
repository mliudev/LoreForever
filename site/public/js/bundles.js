// /downloads, "Pick a bundle" (LOR-848, Mike's pick 10/26): the language and narrator bar, its chooser and the three
// bundle cards (The add-on, Storyteller, Everything), drawn from the catalog site/lib/bundles.js builds. Shared: the
// page function draws English, Windows and the main narrator with these, so the page works without JavaScript, and
// /js/downloads.js draws the visitor's own pick with the same functions.

export const BUNDLES = [
  { key: "addon", title: "The add-on" },
  { key: "storyteller", title: "Storyteller", rec: true },
  { key: "everything", title: "Everything" },
];
const CF = "https://www.curseforge.com/wow/addons/";

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function fmt(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "";
  return bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + " GB" : bytes >= 1e6 ? Math.round(bytes / 1e6) + " MB" : Math.max(1, Math.round(bytes / 1e3)) + " KB";
}
const sep = '<span aria-hidden="true"> &middot; </span>';
// "Other ways: a · b": each way after the first keeps its dot with it, so a narrow card never starts a line with "·".
const ways = items => items.filter(Boolean).map((w, i) => i ? `<span class="bx-nw">${sep}${w}</span>` : w).join("");

// The language and narrator a pick names, falling back to the language's first narrator and then to English.
export function current(cat, pick) {
  const lang = cat.langs.find(l => l.code === pick.lang) || cat.langs[0];
  const narrator = lang.narrators.find(n => n.id === pick.narrator) || lang.narrators[0];
  return { lang, narrator };
}

// A list of links: one link as it is, more as a fold that opens under the card ("Other ways: CurseForge · ZIP").
function links(label, items, id = "") {
  if (!items.length) return "";
  if (items.length === 1) return `<a class="bx-way" href="${esc(items[0].href)}"${id ? ` id="${id}"` : ""}>${esc(label)}</a>`;
  return `<details class="bx-ways"${id ? ` id="${id}"` : ""}><summary>${esc(label)}</summary><ul>${items.map(i =>
    `<li><a href="${esc(i.href)}">${esc(i.name)}</a>${i.bytes ? ` <small>${fmt(i.bytes)}</small>` : ""}</li>`).join("")}</ul></details>`;
}
const cfItems = card => card.cf.map(p => ({ href: CF + p.slug, name: p.name }));

// The card's one button: on Windows, Setup named for the pick, when Setup can install the card's voices; otherwise
// CurseForge, or the ZIPs where not all of it is on CurseForge yet. The other ways go under it.
function cta(cat, card, key, os) {
  const first = key === "addon";   // the add-on card keeps the page's old anchors (#installer, #curseforge, #zip)
  const cf = cfItems(card), zips = card.zips.map(z => ({ href: z.href, name: z.name, bytes: z.bytes }));
  const href = `/download/setup/${card.setup.split(", ").map(encodeURIComponent).join("/")}`;
  if (os === "win" && card.inSetup !== false) {
    return `<a class="ch-btn ch-primary bx-go" href="${esc(href)}"${first ? ' id="installer"' : ""}>Download for Windows</a>` +
      (card.tick ? `<p class="bx-tick">${esc(card.tick)}</p>` : "") +
      `<div class="bx-other">Other ways: ${ways([links("CurseForge", cf, first ? "curseforge" : ""), links("ZIP", zips, first ? "zip" : "")])}</div>`;
  }
  // Setup as another way on Windows: it installs the add-on with the English narration.
  const setup = os === "win" ? `<a class="bx-way" href="${esc(href)}"${first ? ' id="installer"' : ""}>Setup (English narration)</a>` : "<span>Setup is for Windows</span>";
  if (!cf.length) {
    const main = zips.length === 1 ? `<a class="ch-btn ch-primary bx-go" href="${esc(zips[0].href)}">Download the ZIP</a>`
      : `<details class="bx-ways bx-zips"><summary class="ch-btn ch-primary bx-go">Download the ${zips.length} ZIPs</summary><ul>${zips.map(z =>
        `<li><a href="${esc(z.href)}">${esc(z.name)}</a>${z.bytes ? ` <small>${fmt(z.bytes)}</small>` : ""}</li>`).join("")}</ul></details>`;
    return `${main}<p>Unzip ${zips.length === 1 ? "it" : "them"} into your AddOns folder.</p><div class="bx-other">Other ways: ${setup}</div>`;
  }
  const also = cf.slice(1);
  return `<a class="ch-btn ch-primary bx-go" href="${esc(cf[0].href)}"${first ? ' id="curseforge"' : ""}>Get it on CurseForge</a>` +
    (also.length ? `<p class="bx-tick">Then add ${also.length === 1 ? "it" : "these"} on CurseForge too: ${also.map(i => `<a href="${esc(i.href)}">${esc(i.name)}</a>`).join(sep)}</p>` : "") +
    `<div class="bx-other">Other ways: ${ways([links("ZIP", zips, first ? "zip" : ""), setup])}</div>`;
}

// One card: its size, what it holds and one button; dimmed with one line where the language has nothing recorded for it.
export function cardHtml(cat, pick, b) {
  const { narrator } = current(cat, pick), card = narrator.cards[b.key], os = pick.os === "mac" ? "mac" : "win";
  const rec = b.rec && card.ok;
  const head = `<div class="bx-head"><h2 id="bundle-${b.key}-title">${esc(b.title)}</h2>${rec ? '<span class="bx-badge">Recommended</span>' : ""}</div>`;
  if (!card.ok) return `<article class="bx-card bx-off" id="bundle-${b.key}" aria-labelledby="bundle-${b.key}-title">${head}<p class="bx-why">${esc(card.why)}</p></article>`;
  const bytes = (os === "win" ? cat.base.win : cat.base.zip) + card.extra;
  return `<article class="bx-card${rec ? " bx-rec" : ""}" id="bundle-${b.key}" aria-labelledby="bundle-${b.key}-title">${head}
    <p class="bx-size">${fmt(bytes) || "&nbsp;"}</p>
    <ul class="bx-has">${card.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>
    <div class="bx-cta">${cta(cat, card, b.key, os)}</div></article>`;
}
export const cardsHtml = (cat, pick) => BUNDLES.map(b => cardHtml(cat, pick, b)).join("\n");

// The bar: what's picked, and Change. The note says it was picked for you until you change it.
export function barHtml(cat, pick, open = false) {
  const { lang, narrator } = current(cat, pick);
  const note = pick.auto ? (pick.fallback ? "Your browser's language isn't offered yet, so English is picked." : "Picked from your browser's language and your computer.") : "";
  const notes = [note, lang.note, pick.os !== "mac" && narrator.winNote].filter(Boolean);
  return `<div class="bx-bar-text"><span class="bx-lab">Your language and narrator</span><b>${esc(lang.name)}${sep}${esc(narrator.name)}</b>` +
    `${notes.map(n => `<span class="bx-note">${esc(n)}</span>`).join("")}</div>` +
    `<button type="button" class="ch-btn ch-ghost ch-small bx-change" aria-expanded="${open}" aria-controls="bx-choose">${open ? "Close" : "Change"}</button>`;
}

// Change: a chip per language, a card per narrator (each with ▶ to hear it), and the computer.
export function chooserHtml(cat, pick, playing = "") {
  const { lang, narrator } = current(cat, pick), os = pick.os === "mac" ? "mac" : "win";
  const chips = cat.langs.map(l => `<button type="button" class="bx-chip" data-lang="${esc(l.code)}" lang="${esc(l.code)}" aria-pressed="${l === lang}">${esc(l.name)}</button>`).join("");
  const cards = lang.narrators.map(n => {
    const on = n === narrator, pl = playing === n.id;
    const play = n.sample ? `<button type="button" class="bx-play" data-play="${esc(n.id)}" aria-pressed="${pl}" aria-label="${pl ? "Stop" : "Play"} a sample of ${esc(n.name)}: ${esc(n.sample.title)}">${pl ? "&#9632;" : "&#9654;&#xFE0E;"}</button>` : "";
    return `<div class="bx-vc${on ? " bx-on" : ""}">${play}<button type="button" class="bx-vsel" role="radio" aria-checked="${on}" data-narrator="${esc(n.id)}">` +
      `<b>${esc(n.name)}</b><span>${esc(n.who)}</span>${pl ? `<span class="bx-now">Playing: ${esc(n.sample.title)}</span>` : ""}</button></div>`;
  }).join("");
  const comp = [["win", "Windows"], ["mac", "Mac"]].map(([k, v]) => `<button type="button" class="bx-chip" data-os="${k}" aria-pressed="${os === k}">${v}</button>`).join("");
  return `<span class="bx-lab">Language</span><div class="bx-chips" role="group" aria-label="Language">${chips}</div>` +
    `<span class="bx-lab">Narrator</span><div class="bx-vcs" role="radiogroup" aria-label="Narrator">${cards}</div>` +
    `<span class="bx-lab">Computer</span><div class="bx-chips" role="group" aria-label="Computer">${comp}</div>` +
    `<p><button type="button" class="ch-btn ch-ghost ch-small bx-done">Done</button></p>`;
}
