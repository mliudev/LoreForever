// The voice list (public/voices/voices.json), its likes, and the pages built from it: the cards on /voices and each
// voice's profile at /voices/<id> (/contributors, which groups the voices by who made them, is lib/credits.js).
// Shared by those Functions, /api/voices/like(s) and /download/voice/<id>. Kept outside functions/ so Pages doesn't
// route it.
//
// House voices and community voices are the same kind of entry. A community voice has "owner": the id of the
// contributor's account (lib/accounts.js); its bio and the contributor's name and links then come from their
// account, and the voice drops off the site if the account is deleted.

import { senderHash } from "./form.js";

// Reads voices.json from the deployed static files, so a voice added there needs no code change.
export async function loadVoices(env, request) {
  const res = await env.ASSETS.fetch(new URL("/voices/voices.json", request.url));
  if (!res.ok) return [];
  const { voices } = await res.json();
  return voices || [];
}

// The voices to show, with each owner's bio, name and links merged in.
export async function publicVoices(env, request) {
  const voices = await loadVoices(env, request);
  const owned = voices.filter(v => v.owner);
  if (!owned.length || !env.DB) return voices;
  let rows;
  try {
    const marks = owned.map(() => "?").join(",");
    ({ results: rows } = await env.DB.prepare(
      `SELECT v.id, v.owner, v.bio, u.display_name, u.links, u.show_public FROM voices v JOIN users u ON u.id = v.owner
       WHERE v.id IN (${marks})`
    ).bind(...owned.map(v => v.id)).all());
  } catch (e) {
    return voices;   // accounts not set up yet, or D1 is down: show the list as published
  }
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  return voices.flatMap(v => {
    if (!v.owner) return [v];
    const r = byId[v.id];
    if (!r || r.owner !== v.owner) return [];   // owner deleted their account
    return [{
      ...v,
      bio: r.bio || v.bio,
      contributor: r.show_public ? { name: r.display_name || v.credit, links: linkList(r.links) } : null,
    }];
  });
}

export const escape = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// A contributor's links: up to three https addresses, one per line.
export function linkList(text) {
  return String(text || "").split(/\s+/).filter(u => {
    try { return new URL(u).protocol === "https:"; } catch (e) { return false; }
  }).slice(0, 3);
}

// One row per voice, per day, per sender (a daily hash of the IP, as for the forms), so a like counts once a day.
const SETUP = `CREATE TABLE IF NOT EXISTS voice_likes (
  voice_id TEXT NOT NULL, day TEXT NOT NULL, ip_hash TEXT NOT NULL, PRIMARY KEY (voice_id, day, ip_hash))`;

// {voice id: total likes}. Empty when there's no database or it fails: the page still shows, with 0.
export async function likeCounts(env) {
  if (!env.DB) return {};
  try {
    await env.DB.prepare(SETUP).run();
    const { results } = await env.DB.prepare("SELECT voice_id, COUNT(*) AS n FROM voice_likes GROUP BY voice_id").all();
    return Object.fromEntries(results.map(r => [r.voice_id, r.n]));
  } catch (e) {
    return {};
  }
}

// Adds today's like from this sender, if there isn't one yet. Returns the voice's new total.
export async function addLike(env, request, id) {
  const day = new Date().toISOString().slice(0, 10);
  const hash = await senderHash(env, request.headers.get("CF-Connecting-IP") || "", day);
  await env.DB.batch([
    env.DB.prepare(SETUP),
    env.DB.prepare("INSERT OR IGNORE INTO voice_likes (voice_id, day, ip_hash) VALUES (?, ?, ?)").bind(id, day, hash),
  ]);
  return env.DB.prepare("SELECT COUNT(*) AS n FROM voice_likes WHERE voice_id = ?").bind(id).first("n");
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const creditName = v => v.contributor?.name || v.credit;
export const contributorAnchor = name => "c-" + (String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x");

// "by Jane", or "voice by Jane" for a voice made from a lent recording (voices.json "donated": true, LOR-230).
function facts(v, linkCredit) {
  const who = escape(creditName(v));
  return [
    `${v.donated ? "voice by" : "by"} ${linkCredit ? `<a href="/contributors#${contributorAnchor(creditName(v))}">${who}</a>` : who}`,
    escape(v.language),
    v.clips ? plural(v.clips, "narration", "narrations") : "",
  ].filter(Boolean).join(" &middot; ");
}

const tag = v => v.included ? '<span class="tag">Default</span>' : v.status === "soon" ? '<span class="tag tag-soon">Coming soon</span>' : "";

function audio(s) {
  return `<p class="vc-sample-title">${escape(s.title)}${s.length ? ` &middot; ${escape(s.length)}` : ""}</p>
        <audio controls preload="none" src="${escape(s.src)}"></audio>`;
}
const noSample = `<p class="vc-sample-title">Sample</p>
        <p class="vc-sample-soon">Not ready yet. Check back soon.</p>`;

function getIt(v) {
  return getMain(v) + getPacks(v);
}

function getMain(v) {
  if (v.included) return `<p class="vc-install">Comes with Lore Forever. Nothing to install.</p>`;
  if (!v.download) return `<p class="vc-install">Download coming soon.</p>`;
  const cf = v.curseforge ? ` <a href="${escape(v.curseforge)}">Get it on CurseForge</a>.` : "";
  return `<p class="vc-install"><a class="btn-small" href="/download/voice/${escape(v.id)}">Download</a>
          Unzip into <code>Interface\\AddOns</code>, type <code>/reload</code> in game, then pick it under Narration voice.${cf}</p>`;
}

// A voice's optional packs (voices.json "packs"): its lands packs (the places and people of Alliance or Horde zones,
// contested zones in both) and an all-in-one zip. Each downloads through /download/voice/<pack id>, or straight from
// its own link when that's one of the site's. /voices (lib/downloads.js) lists the same packs with sizes.
function getPacks(v) {
  const packs = (v.packs || []).filter(p => p.download && p.status !== "soon");   // soon: not released yet
  if (!packs.length) return "";
  const links = packs.map(p => {
    const href = p.download.startsWith("/") ? p.download : `/download/voice/${p.id}`;
    return `<a href="${escape(href)}">${escape(p.name)}</a>${p.clips ? ` (${plural(p.clips, "narration", "narrations")})` : ""}`;
  }).join(" &middot; ");
  return `<p class="vc-packs">More narration, optional: ${links}. Unzip into <code>Interface\\AddOns</code> next to
          Lore Forever. <a href="/downloads#${escape(v.id)}">Which one do I need?</a></p>`;
}

// The voice or pack with this id (a pack takes its voice's status unless it has its own), or undefined.
export function findDownload(voices, id) {
  for (const v of voices) {
    if (v.id === id) return v;
    const p = (v.packs || []).find(x => x.id === id);
    if (p) return { ...p, status: p.status || v.status };
  }
}

export function likeButton(v, likes) {
  return `<form class="vc-like" method="post" action="/api/voices/like">
          <input type="hidden" name="id" value="${escape(v.id)}">
          <button type="submit" data-id="${escape(v.id)}" aria-label="Like ${escape(v.name)}">
            <span aria-hidden="true">&#128077;</span> <span class="vc-count">${likes || 0}</span>
          </button>
        </form>`;
}

// A voice card for the /voices list. Plays its main sample in the page, likes without an account, and works without
// JavaScript (the like button is a small form that comes back to the page).
export function voiceCard(v, likes) {
  return `<article class="zone vc" id="voice-${escape(v.id)}">
      <div class="zone-body">
        <h3><a href="/voices/${escape(v.id)}">${escape(v.name)}</a> ${tag(v)}</h3>
        <p class="zone-where">${facts(v, false)}</p>
        <p class="vc-tagline">${escape(v.tagline)}</p>
        ${v.coverage ? `<p class="vc-coverage">Covers: ${escape(v.coverage)}</p>` : ""}
        ${v.sample ? audio(v.sample) : noSample}
        ${getIt(v)}
        <p class="vc-more"><a href="/voices/${escape(v.id)}">Profile and more samples</a></p>
        ${likeButton(v, likes)}
      </div>
    </article>`;
}

// A row for the /voices list: play button, name and credit, one-line tagline, like, and how to get it. Compact, so
// the page still reads well with dozens of voices. public/voices/player.js plays the sample in place and filters and
// sorts the rows; without JavaScript every row shows, in voices.json order, and the name links to the samples.
export function voiceRow(v, likes, order) {
  const s = v.sample;
  const play = s
    ? `<button class="vr-play" type="button" aria-label="Play a sample of ${escape(v.name)}: ${escape(s.title)}"
          title="${escape(s.title)}${s.length ? " · " + escape(s.length) : ""}">&#9654;</button>
        <audio class="vr-audio" preload="none" src="${escape(s.src)}"></audio>`
    : `<button class="vr-play" type="button" disabled aria-label="No sample yet" title="No sample yet">&#9654;</button>`;
  const get = v.included
    ? `<span class="vr-note">Included</span>`
    : v.download
      ? `<a class="btn-small" href="/download/voice/${escape(v.id)}">Download</a>`
      : `<span class="vr-note">Soon</span>`;
  return `<article class="vr" id="voice-${escape(v.id)}" data-lang="${escape(v.language)}" data-likes="${likes || 0}"
      data-order="${order}">
      <div class="vr-left">${play}</div>
      <div class="vr-main">
        <h3><a href="/voices/${escape(v.id)}">${escape(v.name)}</a> ${tag(v)}</h3>
        <p class="zone-where">${facts(v, false)}</p>
        <p class="vc-tagline">${escape(v.tagline)}</p>
      </div>
      <div class="vr-actions">
        ${likeButton(v, likes)}
        ${get}
      </div>
    </article>`;
}

// The filter and sort buttons above the list. Language buttons only appear once there's more than one language.
export function voiceFilters(voices) {
  const langs = [...new Set(voices.map(v => v.language).filter(Boolean))];
  const langButtons = langs.length > 1
    ? [`<button type="button" data-lang="" aria-pressed="true">All</button>`,
       ...langs.map(l => `<button type="button" data-lang="${escape(l)}" aria-pressed="false">${escape(l)}</button>`)]
      .join("")
    : "";
  return `<div class="vl-group" role="group" aria-label="Language">${langButtons}</div>
      <div class="vl-group" role="group" aria-label="Sort">
        <button type="button" data-sort="order" aria-pressed="true">Featured</button><button type="button"
          data-sort="likes" aria-pressed="false">Most liked</button>
      </div>`;
}

// ---- Whole pages (profile, contributors; player profiles in lib/profiles.js) ----

// The site header (LOR-222), the same on every page: the static pages carry a copy of it, and
// site/tests/nav.test.mjs checks they all match this one. public/header.js brings it to life. The inline script runs
// before any of it is drawn, so nothing in it changes afterwards: it puts hd-wait on <html> (with JavaScript on, the
// profile link's spot keeps its place but stays blank until header.js knows whether you're signed in), and hd-nolore
// when the site features header.js remembers (lf-features) say the Lore link is off (style.css). Lore is in the
// markup while the "lore" feature is on (lib/features.js; nav.test.mjs keeps them in step).
export const SITE_NAV = `  <nav class="wrap nav" aria-label="Lore Forever">
    <script>(c => { c.add("hd-wait"); try { if (JSON.parse(localStorage.getItem("lf-features")).lore === false) c.add("hd-nolore"); } catch (e) {} })(document.documentElement.classList)</script>
    <a class="brand" href="/"><img src="/img/logo.svg" alt="" width="30" height="30"><span>Lore Forever</span></a>
    <div class="nav-links">
      <a class="nl" id="nav-download" href="/downloads">Download</a>
      <a class="nl" id="nav-lore" href="/lore">Lore</a>
      <a class="nl" id="nav-new" href="/whats-new">What's new</a>
      <a class="nl" id="nav-community" href="/feedback">Community</a>
    </div>
    <div class="head-actions"><a class="nl nl-pf" id="nav-profile" href="/account#profile"><svg class="nl-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg><span class="hd-wide">Make your profile</span><span class="hd-narrow">Profile</span></a></div>
  </nav>`;

// The name on the header's account chip: the account's name, else the start of its email (public/header.js does the
// same with GET /api/auth/me's answer).
const chipName = user => user.display_name || String(user.email || "").split("@")[0] || "Your account";

// The header for a page rendered for whoever asked: a Function that knows they're signed in (/u/<handle>) passes them
// (lib/accounts.js currentUser) as viewer, and header.js shows them signed in at once, without waiting for GET
// /api/auth/me: the chip's name, and when this sign-in ends. Never the email; such a page must not be cached for anyone
// else (Cache-Control: private, no-store).
export const siteNav = viewer => viewer
  ? SITE_NAV.replace('<div class="head-actions">', `<div class="head-actions" data-auth="in" data-name="${escape(chipName(viewer))}"` +
      (viewer.session_expires ? ` data-until="${escape(viewer.session_expires)}">` : ">"))
  : SITE_NAV;

// crumbs, foot and scripts replace the voice pages' breadcrumb (under the header; "" for none), footer line and player
// script; robots adds a robots meta tag; head adds tags after the site stylesheet (a page's own stylesheet). viewer:
// the signed-in user the page is for (siteNav), if the Function knows.
export function page({ title, description, path, crumb, body, image, crumbs, foot, scripts, robots, head, viewer }) {
  const url = "https://loreforeverwow.com" + path;
  const trail = crumbs ?? `<a href="/downloads">Downloads</a> &rsaquo; ${escape(crumb)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} - Lore Forever</title>
<meta name="description" content="${escape(description)}">
${robots ? `<meta name="robots" content="${escape(robots)}">\n` : ""}<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Lore Forever">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${escape(image || "https://loreforeverwow.com/img/social-card.png")}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/img/logo.svg" type="image/svg+xml">
<link rel="icon" href="/img/logo.png" type="image/png" sizes="512x512">
<link rel="apple-touch-icon" href="/img/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&display=swap">
<link rel="stylesheet" href="/style.css">
${head ? head + "\n" : ""}<script src="/header.js" defer></script>
</head>
<body>

<header class="top">
${siteNav(viewer)}${trail ? `
  <div class="wrap subcrumb"><span class="crumb">${trail}</span></div>` : ""}
</header>

<main class="wrap vp-page">
${body}
</main>

<footer class="wrap foot">
  ${foot ?? `<p>Want a page like this for your own voice? <a href="/voices/studio">Open the narrator dashboard</a>.</p>`}
  <p>Lore Forever in other languages: <a href="/translate">see the languages, or help translate</a>.</p>
  <p><a href="/privacy">Privacy</a>: what we keep and why.</p>
  <p>Lore Forever is a fan-made add-on. World of Warcraft and Warcraft are trademarks of Blizzard Entertainment, Inc.
    Not affiliated with or endorsed by Blizzard.</p>
</footer>
${scripts ?? '<script src="/voices/player.js" defer></script>'}
</body>
</html>`;
}

const paragraphs = text => String(text || "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  .map(p => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`).join("\n    ");

function avatar(v) {
  if (v.avatar) return `<img class="vpr-avatar" src="${escape(v.avatar)}" alt="" width="96" height="96">`;
  return `<span class="vpr-avatar vpr-initial" aria-hidden="true">${escape((v.name || "?").replace(/^Lore Forever /, "").charAt(0).toUpperCase())}</span>`;
}

// /voices/<id>: everything about one voice. Built the same way for house and community voices. zones: the names of the
// zones this voice narrated on the upload page ("Claim a zone", LOR-231), if any.
export function profilePage(v, likes, { zones = [] } = {}) {
  const samples = v.samples?.length ? v.samples : v.sample ? [v.sample] : [];
  const links = v.contributor?.links?.length
    ? `<p class="vpr-links">${v.contributor.links.map(u => `<a href="${escape(u)}" rel="nofollow ugc noopener">${escape(new URL(u).hostname.replace(/^www\./, ""))}</a>`).join(" &middot; ")}</p>`
    : "";
  const body = `  <div class="vpr-head">
    ${avatar(v)}
    <div>
      <h1>${escape(v.name)} ${tag(v)}</h1>
      <p class="zone-where">${facts(v, true)}</p>
      ${links}
    </div>
  </div>
  <section class="vpr-bio">
    ${paragraphs(v.bio || v.tagline)}
    ${v.coverage ? `<p class="vc-coverage">Covers: ${escape(v.coverage)}</p>` : ""}
    ${zones.length ? `<p class="vc-coverage">Zones narrated: ${zones.map(escape).join(", ")}. <a href="/voices/zones">Every zone's narrators</a></p>` : ""}
  </section>
  <div class="vpr-actions vc">
    ${likeButton(v, likes)}
    ${getIt(v)}
  </div>
  <section class="vp-section" aria-labelledby="samples-title">
    <h2 id="samples-title">Samples</h2>
    <div class="samples">
      ${samples.length ? samples.map(s => `<figure class="audio-sample vc">${audio(s)}</figure>`).join("\n      ")
        : `<figure class="audio-sample vc">${noSample}</figure>`}
    </div>
  </section>
  <p class="vp-note"><a href="/downloads#voices">&larr; All voices</a> &middot; <a href="/downloads#install">Installing a voice</a></p>`;
  return page({
    title: v.name,
    description: `${v.name}, a narration voice for Lore Forever. ${v.tagline || ""}`.trim(),
    path: "/voices/" + v.id,
    crumb: v.name,
    body,
  });
}

// /contributors (narrators, translators and text finders) is in lib/credits.js.
