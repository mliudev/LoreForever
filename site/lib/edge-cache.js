// Pages everyone sees the same, kept in Cloudflare's edge cache (the Cache API, caches.default) so a launch-day crowd
// reading the same lore pages and guides doesn't render each one again on every view (the Software Architect's
// 10/21 review, item 2: about 4,500 lore pages were rendered per request with no-cache). Only a 200 whose
// Cache-Control isn't private or no-store and that sets no cookie is kept, so a page made for one player (a draft
// guide for its editor) or an error never reaches anyone else. Browsers still get the page's own Cache-Control
// (no-cache: they ask again each time, and the edge answers).
//
// A page's key is its address plus the data it's built from: FRESH (lib/voices.js, the styles and scripts) and, with
// `versioned`, the ETags of the generated files a lore page reads (DATA_FILES), looked up at most once a minute per
// isolate. So a deploy with new lore, voices or packs gets new keys within a minute, and the old copies are never
// read again. What changes without a deploy (R2's recordings manifest, a guide saved in the editor) waits out `ttl`.
// Kept outside functions/ so Pages doesn't route it.

import { FRESH } from "./voices.js";

const DATA_FILES = ["/lore/data/index.json", "/lore/data/more.json", "/voices/voices.json", "/data/packs.json",
  "/data/pack-entries.json"];
const VERSION_TTL = 60 * 1000;
const BROWSER_CC = "X-Browser-Cache-Control";
const versions = new WeakMap();

// The ETags of DATA_FILES, as one short string; "" when ASSETS can't say (local tests without ETags still cache by FRESH).
export async function dataVersion(env, request) {
  const holder = env.ASSETS || env;
  const hit = versions.get(holder);
  if (hit && Date.now() - hit.at < VERSION_TTL) return hit.v;
  let v = "";
  try {
    const tags = await Promise.all(DATA_FILES.map(async path => {
      const res = await env.ASSETS.fetch(new Request(new URL(path, request.url), { method: "HEAD" }));
      return res.headers.get("ETag") || "";
    }));
    v = tags.join(",").replace(/[^A-Za-z0-9,-]/g, "");
  } catch (e) { v = ""; }
  versions.set(holder, { at: Date.now(), v });
  return v;
}

export async function cacheKey(env, request, versioned) {
  const url = new URL(request.url);
  url.searchParams.set("_edge", FRESH + (versioned ? "." + await dataVersion(env, request) : ""));
  return new Request(url.toString(), { method: "GET" });
}

// May this response be kept for everyone?
export function shareable(res) {
  const cc = (res.headers.get("Cache-Control") || "").toLowerCase();
  return res.status === 200 && !/\b(private|no-store)\b/.test(cc) && !res.headers.has("Set-Cookie");
}

const mark = (res, state) => {
  const out = new Response(res.body, res);
  const browser = out.headers.get(BROWSER_CC);
  if (browser !== null) { out.headers.set("Cache-Control", browser); out.headers.delete(BROWSER_CC); }
  out.headers.set("X-Edge-Cache", state);
  return out;
};

// render()'s response for a GET or HEAD, from the edge cache when it has it. ttl: seconds the edge keeps it.
// context: the Pages context ({request, env, waitUntil}).
export async function edgeCached(context, render, { ttl = 600, versioned = false } = {}) {
  const { request, env } = context;
  const cache = globalThis.caches?.default;
  if (!cache || (request.method !== "GET" && request.method !== "HEAD")) return render();
  let key = null, hit = null;
  try {
    key = await cacheKey(env, request, versioned);
    hit = await cache.match(key);
  } catch (e) { hit = null; }
  if (hit) return mark(hit, "HIT");
  const res = await render();
  if (!key || !shareable(res)) return res;
  const copy = new Response(res.clone().body, res);
  copy.headers.set(BROWSER_CC, res.headers.get("Cache-Control") || "");
  copy.headers.set("Cache-Control", `public, max-age=${ttl}`);
  const kept = cache.put(key, copy).catch(e => console.warn(`edge cache: ${e?.message || e}`));
  if (typeof context.waitUntil === "function") context.waitUntil(kept); else await kept;
  return mark(res, "MISS");
}

// Forgets the copies of these paths in this data center (an editor's save: they see it at once; elsewhere it waits
// out the ttl). Never throws.
export async function dropEdgeCached(env, request, paths, { versioned = false } = {}) {
  const cache = globalThis.caches?.default;
  if (!cache) return;
  await Promise.all(paths.map(async path => {
    try { await cache.delete(await cacheKey(env, new Request(new URL(path, request.url)), versioned)); }
    catch (e) { /* not cached here */ }
  }));
}
