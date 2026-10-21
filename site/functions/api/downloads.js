import { isReportRead } from "../../lib/report-read.js";
// The public download counts on the home page (index.html's #downloads). The add-on's: the zip and installer downloads
// of every GitHub release (the site's own /download/* links redirect there, so they're in it) plus CurseForge's total.
// Willo's: her own installer, Willo-Setup.exe (lib/willo.js), which is never in the add-on's.
// Counted here rather than in each visitor's browser so the number is exact and the same for everyone:
//   - CurseForge: the official API when CURSEFORGE_API_KEY is set (a free key from console.curseforge.com); else
//     cfwidget's exact total (cfwidget refreshes it about hourly); else shields.io's rounded badge ("5.2k").
//   - GitHub: every page of the releases API, with GITHUB_TOKEN if set (5,000 calls an hour instead of 60). The same
//     pages give Willo's count.
//   - Willo when GitHub fails: the site's own count of /download/willo (D1 table downloads, functions/download/[file].js),
//     which misses anyone who got it straight from GitHub; null without that either.
// The answer is cached at the edge for a minute, so the page can ask every minute and each source is still called
// at most once a minute per Cloudflare location. Only an answer with both GitHub and CurseForge in it is cached. A
// source that fails comes back null and the page fills it in itself.
//   GET /api/downloads -> {"total": N, "github": N|null, "curseforge": N|null, "curseforgeSource": "api"|"cfwidget"|"shields"|null,
//                          "willo": N|null, "willoSource": "github"|"site"|null}
// After answering, it keeps CurseForge's and GitHub's counts per release when a snapshot is due (lib/stores.js,
// LOR-421: hourly for the add-on, daily for the narration and language projects), for /admin. GitHub's are the
// add-on's only. That never changes or delays the answer.

import { snapshotStores } from "../../lib/stores.js";
import { WILLO_FILE } from "../../lib/willo.js";

const REPO = "mliudev/LoreForever";
const CURSEFORGE_PROJECT_ID = "1715510";
const TTL = 60;   // seconds
const UA = { "User-Agent": "loreforeverwow.com download counter" };

const getJson = (url, headers = {}) => fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(5000) })
  .then(r => { if (!r.ok) throw new Error(url + ": " + r.status); return r; });

// shields.io messages look like "0", "950", "1.2k" or "3M".
export function shieldsNumber(m) {
  const x = /^([\d.]+)([kKmM]?)$/.exec(m || "");
  return x ? Math.round(parseFloat(x[1]) * ({ k: 1e3, K: 1e3, m: 1e6, M: 1e6 }[x[2]] || 1)) : null;
}

// Each release's add-on downloads (its zips and installers) and, apart, Willo-Setup.exe's: [{tag, published, downloads,
// willo}].
export async function githubReleases(env) {
  const auth = env.GITHUB_TOKEN ? { Authorization: "Bearer " + env.GITHUB_TOKEN } : {};
  let url = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
  const out = [];
  for (let page = 0; url && page < 10; page++) {
    const r = await getJson(url, { Accept: "application/vnd.github+json", ...auth });
    for (const rel of await r.json()) {
      if (rel.tag_name === "audio") continue;   // the release build's recordings (LOR-133), not a player download
      let n = 0, willo = 0;
      for (const a of rel.assets || []) {
        if (a.name === WILLO_FILE) willo += a.download_count || 0;
        else if (/\.(zip|exe)$/i.test(a.name)) n += a.download_count || 0;
      }
      out.push({ tag: rel.tag_name, published: rel.published_at, downloads: n, willo });
    }
    url = /<([^>]+)>;\s*rel="next"/.exec(r.headers.get("link") || "")?.[1];
  }
  return out;
}

export async function githubDownloads(env) {
  return (await githubReleases(env)).reduce((n, r) => n + r.downloads, 0);
}

export async function curseforgeDownloads(env) {
  const sources = [
    ["api", async () => env.CURSEFORGE_API_KEY
      ? (await (await getJson(`https://api.curseforge.com/v1/mods/${CURSEFORGE_PROJECT_ID}`,
          { "x-api-key": env.CURSEFORGE_API_KEY })).json()).data?.downloadCount
      : null],
    ["cfwidget", async () => (await (await getJson(`https://api.cfwidget.com/${CURSEFORGE_PROJECT_ID}`)).json()).downloads?.total],
    ["shields", async () => shieldsNumber((await (await getJson(`https://img.shields.io/curseforge/dt/${CURSEFORGE_PROJECT_ID}.json`)).json()).message)],
  ];
  for (const [source, get] of sources) {
    try {
      const n = await get();
      if (Number.isFinite(n)) return { curseforge: n, curseforgeSource: source };
    } catch (e) {}
  }
  return { curseforge: null, curseforgeSource: null };
}

// Willo's downloads through the site's own link, /download/willo, added up over every day: null without the database,
// before its first download, or on any error.
export async function siteWilloDownloads(env) {
  try {
    const n = await env.DB.prepare("SELECT SUM(n) AS n FROM downloads WHERE file = 'willo'").first("n");
    return Number.isSafeInteger(n) ? n : null;
  } catch (e) {
    return null;
  }
}

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = !isReportRead(env) && globalThis.caches?.default;
  const key = new Request(new URL("/api/downloads", request.url).toString());
  const hit = cache && await cache.match(key).catch(() => null);
  if (hit) return hit;

  const gh = githubReleases(env).catch(() => null);
  // The site's Willo count only when GitHub didn't answer, still alongside CurseForge.
  const [releases, cf, siteWillo] = await Promise.all([gh, curseforgeDownloads(env),
    gh.then(r => r ? null : siteWilloDownloads(env))]);
  const github = releases && releases.reduce((n, r) => n + r.downloads, 0);
  const willo = releases ? releases.reduce((n, r) => n + r.willo, 0) : siteWillo;
  const willoSource = releases ? "github" : siteWillo != null ? "site" : null;
  const total = isReportRead(env) && (github == null || cf.curseforge == null) ? null : (github || 0) + (cf.curseforge || 0);
  const res = Response.json({ total, github, ...cf, willo, willoSource },
    { headers: { "Cache-Control": `public, max-age=${TTL}` } });
  if (isReportRead(env)) return res;
  const snapshot = snapshotStores(env, { github: releases, getGithub: () => githubReleases(env) })
    .catch(() => {});   // never the answer's problem
  if (waitUntil) waitUntil(snapshot); else await snapshot;
  // Only cache a complete answer, so a GitHub or CurseForge hiccup is retried on the next visit.
  if (cache && github != null && cf.curseforge != null) {
    const put = cache.put(key, res.clone()).catch(() => {});
    if (waitUntil) waitUntil(put); else await put;
  }
  return res;
}
