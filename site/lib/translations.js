// The language list (public/translate/languages.json, written by `python -m lore.kit site`) and its likes, shared by
// /translate and /api/translations/*. Kept outside functions/ so Pages doesn't route it.

import { senderHash } from "./form.js";

// Reads languages.json from the deployed static files, so new coverage numbers need no code change.
export async function loadLanguages(env, request) {
  try {
    const res = await env.ASSETS.fetch(new URL("/translate/languages.json", request.url));
    if (!res.ok) return [];
    const { languages } = await res.json();
    return languages || [];
  } catch (e) {
    return [];
  }
}

// The published language packs (public/translate/packs.json, written by scripts/publish-language-packs.sh):
// [{locale, name, version, file, size, download}]. Shared by /translate and /download/lang/<locale>.
export async function loadPacks(env, request) {
  try {
    const res = await env.ASSETS.fetch(new URL("/translate/packs.json", request.url));
    if (!res.ok) return [];
    const { packs } = await res.json();
    return packs || [];
  } catch (e) {
    return [];
  }
}

export const escape = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// A WoW locale code, the only language ids the forms and likes accept.
export const LOCALE = /^[a-z]{2}[A-Z]{2}$/;

// One row per language, per day, per sender (a daily hash of the IP, as for the forms), so a like counts once a day.
const SETUP = `CREATE TABLE IF NOT EXISTS translation_likes (
  locale TEXT NOT NULL, day TEXT NOT NULL, ip_hash TEXT NOT NULL, PRIMARY KEY (locale, day, ip_hash))`;

// {locale: total likes}. Empty when there's no database or it fails: the page still shows, with 0.
export async function likeCounts(env) {
  if (!env.DB) return {};
  try {
    await env.DB.prepare(SETUP).run();
    const { results } = await env.DB.prepare("SELECT locale, COUNT(*) AS n FROM translation_likes GROUP BY locale").all();
    return Object.fromEntries(results.map(r => [r.locale, r.n]));
  } catch (e) {
    return {};
  }
}

// Adds today's like from this sender, if there isn't one yet. Returns the language's new total.
export async function addLike(env, request, locale) {
  const day = new Date().toISOString().slice(0, 10);
  const hash = await senderHash(request.headers.get("CF-Connecting-IP") || "", day);
  await env.DB.batch([
    env.DB.prepare(SETUP),
    env.DB.prepare("INSERT OR IGNORE INTO translation_likes (locale, day, ip_hash) VALUES (?, ?, ?)").bind(locale, day, hash),
  ]);
  return env.DB.prepare("SELECT COUNT(*) AS n FROM translation_likes WHERE locale = ?").bind(locale).first("n");
}

// Without JavaScript the forms post directly, so an error comes back as a page of its own. `back` is the form's page.
export function errorPage(status, error, back, crumb) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Not sent yet - Lore Forever</title>
<link rel="icon" href="/img/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css"></head>
<body><header class="top"><div class="wrap"><span class="crumb"><a href="/">Lore Forever</a> &rsaquo;
<a href="/translate">Translate</a> &rsaquo; ${escape(crumb)}</span></div></header>
<main class="wrap fb-page"><h1>Not sent yet</h1>
<div class="fb-done"><p>${escape(error)}</p>
${status === 401
  ? `<p><a href="/account?next=${escape(back.split("#")[0])}">Sign in or create your Lore Forever account</a>, then send the form again.</p>`
  : `<p>Use your browser's Back button to fix it: what you typed is still there. Or <a href="${escape(back)}">start over</a>.</p>`}</div>
</main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

// {locale: [display names]} of translators with accepted edits who chose to be shown (lib/accounts.js show_public),
// most edits first. Empty when nobody has been accepted yet or the tables don't exist.
export async function translatorCredits(env) {
  if (!env.DB) return {};
  try {
    const { results } = await env.DB.prepare(
      "SELECT e.locale, u.display_name AS name, COUNT(*) AS n FROM translation_edits e JOIN users u ON u.id = e.user_id " +
      "WHERE e.status IN ('accepted', 'pulled') AND u.show_public = 1 AND u.display_name IS NOT NULL " +
      "GROUP BY e.locale, u.id ORDER BY n DESC"
    ).all();
    const out = {};
    for (const r of results) (out[r.locale] ||= []).push(r.name);
    return out;
  } catch (e) {
    return {};
  }
}

const mb = bytes => (bytes / 1024 / 1024).toFixed(1) + " MB";

// Whole percent, except that anything started shows at least "<1%".
function percent(p) {
  if (!p) return "0%";
  return p < 1 ? "&lt;1%" : Math.floor(p) + "%";
}

// A language card for the /translate list. Works without JavaScript (the like button is a small form that comes back
// to /translate). `pack` (from packs.json) adds the player download: the pack itself, not the translator kit.
export function languageCard(lang, likes, translators = [], pack = null) {
  const c = lang.coverage || {};
  const p = c.percent || 0;
  const started = p > 0;
  const tag = lang.reviewed
    ? '<span class="tag">Reviewed</span>'
    : started ? '<span class="tag tag-draft">Draft</span>' : "";
  const facts = [
    escape(lang.englishName),
    started ? `${(c.entries?.[0] ?? 0).toLocaleString("en-US")} of ${(c.entries?.[1] ?? 0).toLocaleString("en-US")} entries` : "not started",
    c.ui && c.ui[0] ? `interface ${Math.floor(100 * c.ui[0] / c.ui[1])}%` : "",
  ].filter(Boolean).join(" &middot; ");
  const review = lang.reviewed
    ? "Checked by native speakers."
    : started ? "Not reviewed by a native speaker yet." : "Be the first to start it.";
  return `<article class="zone tl" id="lang-${escape(lang.locale)}" lang="${escape(lang.locale.slice(0, 2))}">
      <div class="zone-body">
        <h3>${escape(lang.name)} ${tag}</h3>
        <p class="zone-where">${facts}</p>
        <div class="tl-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"
          aria-label="${escape(lang.englishName)}: ${p}% translated"><span style="width:${Math.min(100, p)}%"></span></div>
        <p class="tl-percent"><strong>${percent(p)}</strong> translated</p>
        <p class="tl-review" lang="en">${review}</p>
        ${translators.length ? `<p class="tl-credits"><span lang="en">Translated by</span> ${translators.map(escape).join(", ")}</p>` : ""}${pack ? `
        <p class="tl-get tl-pack" lang="en"><a class="btn-small" href="/download/lang/${escape(lang.locale)}">Download to play</a>
          <span class="tl-size">${pack.size ? mb(pack.size) + " zip" : ""}</span></p>
        <p class="tl-install" lang="en">Unzip it into <code>Interface\\AddOns</code> next to LoreForever, then restart the
          game. It switches on by itself on a ${escape(lang.englishName)} game client, or pick it in Options &gt; AddOns
          &gt; Lore Forever &gt; Language.</p>` : ""}
        <p class="tl-get" lang="en"><a class="btn-small" href="/translate/dashboard?lang=${escape(lang.locale)}">Translate</a>
          <a class="tl-kit" href="${escape(lang.kit)}" download>or download the kit</a>
          <span class="tl-size">${lang.kitSize ? "(" + mb(lang.kitSize) + ")" : ""}</span></p>
        <form class="tl-like" method="post" action="/api/translations/like" lang="en">
          <input type="hidden" name="locale" value="${escape(lang.locale)}">
          <button type="submit" data-locale="${escape(lang.locale)}" aria-label="I want ${escape(lang.englishName)}">
            <span aria-hidden="true">&#128077;</span> <span class="tl-count">${likes || 0}</span>
          </button>
        </form>
      </div>
    </article>`;
}
