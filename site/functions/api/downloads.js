// The public download count on the home page (index.html's #downloads): the zip and installer downloads of every
// GitHub release (the site's own /download/* links redirect there, so they're in it) plus CurseForge's total.
// Counted here rather than in each visitor's browser so the number is exact and the same for everyone:
//   - CurseForge: the official API when CURSEFORGE_API_KEY is set (a free key from console.curseforge.com); else
//     cfwidget's exact total (cfwidget refreshes it about hourly); else shields.io's rounded badge ("5.2k").
//   - GitHub: every page of the releases API, with GITHUB_TOKEN if set (5,000 calls an hour instead of 60).
// The answer is cached at the edge for a minute, so the page can ask every minute and each source is still called
// at most once a minute per Cloudflare location. A source that fails comes back null and the page fills it in itself.
//   GET /api/downloads -> {"total": N, "github": N|null, "curseforge": N|null, "curseforgeSource": "api"|"cfwidget"|"shields"|null}

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

export async function githubDownloads(env) {
  const auth = env.GITHUB_TOKEN ? { Authorization: "Bearer " + env.GITHUB_TOKEN } : {};
  let url = `https://api.github.com/repos/${REPO}/releases?per_page=100`, n = 0;
  for (let page = 0; url && page < 10; page++) {
    const r = await getJson(url, { Accept: "application/vnd.github+json", ...auth });
    for (const rel of await r.json()) {
      for (const a of rel.assets || []) if (/\.(zip|exe)$/i.test(a.name)) n += a.download_count || 0;
    }
    url = /<([^>]+)>;\s*rel="next"/.exec(r.headers.get("link") || "")?.[1];
  }
  return n;
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

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = globalThis.caches?.default;
  const key = new Request(new URL("/api/downloads", request.url).toString());
  const hit = cache && await cache.match(key).catch(() => null);
  if (hit) return hit;

  const [github, cf] = await Promise.all([githubDownloads(env).catch(() => null), curseforgeDownloads(env)]);
  const res = Response.json({ total: (github || 0) + (cf.curseforge || 0), github, ...cf },
    { headers: { "Cache-Control": `public, max-age=${TTL}` } });
  // Only cache a complete answer, so a GitHub or CurseForge hiccup is retried on the next visit.
  if (cache && github != null && cf.curseforge != null) {
    const put = cache.put(key, res.clone()).catch(() => {});
    if (waitUntil) waitUntil(put); else await put;
  }
  return res;
}
