// The edge cache (lib/edge-cache.js) and the clips' copy of it: a page made for one player, or an error, is never kept
// for everyone, a hit gives browsers the page's own Cache-Control, and a range is cut right from a kept clip.
import test from "node:test";
import assert from "node:assert/strict";
import { edgeCached } from "../lib/edge-cache.js";
import { onRequest as audioGet } from "../functions/audio/clip/[voice]/[file].js";
import { r2 } from "./helpers.mjs";

function fakeCache() {
  const kept = new Map();
  return { kept, async match(req) { const r = kept.get(req.url); return r ? r.clone() : undefined; },
    async put(req, res) { kept.set(req.url, res); }, async delete(req) { return kept.delete(req.url); } };
}

test("edgeCached keeps only shareable 200s and hands browsers the page's own Cache-Control", async t => {
  const cache = fakeCache();
  globalThis.caches = { default: cache };
  t.after(() => { delete globalThis.caches; });
  const env = {};
  const ctx = path => ({ request: new Request("https://example.test" + path), env, waitUntil: p => p });
  let renders = 0;
  const page = (status, cc, extra = {}) => () => { renders++; return new Response("page", { status, headers: { "Cache-Control": cc, ...extra } }); };

  const first = await edgeCached(ctx("/lore/zone/elwynn"), page(200, "no-cache"));
  assert.equal(first.headers.get("X-Edge-Cache"), "MISS");
  const again = await edgeCached(ctx("/lore/zone/elwynn"), page(200, "no-cache"));
  assert.equal(again.headers.get("X-Edge-Cache"), "HIT");
  assert.equal(again.headers.get("Cache-Control"), "no-cache");
  assert.equal(await again.text(), "page");
  assert.equal(renders, 1);

  for (const [path, render] of [["/guides/draft", page(200, "private, no-store")], ["/lore/zone/nope", page(404, "no-cache")],
    ["/guides/cookie", page(200, "no-cache", { "Set-Cookie": "lf_session=x" })]]) {
    await edgeCached(ctx(path), render);
    const next = await edgeCached(ctx(path), render);
    assert.notEqual(next.headers.get("X-Edge-Cache"), "HIT", path);
  }
});

test("/audio/clip/ cuts ranges from the edge copy", async t => {
  const cache = fakeCache();
  globalThis.caches = { default: cache };
  t.after(() => { delete globalThis.caches; });
  const STUDIO = r2();
  const bytes = new Uint8Array(100).map((_, i) => i);
  const file = "zone_elwynn-0123456789.mp3";
  await STUDIO.put(`narration/male-narrator/${file}`, bytes);
  const get = headers => audioGet({ request: new Request(`https://loreforeverwow.com/audio/clip/male-narrator/${file}`, { headers }),
    env: { STUDIO }, params: { voice: "male-narrator", file }, waitUntil: p => p });

  const miss = await get({ Range: "bytes=0-9" });
  assert.equal(miss.status, 206);
  assert.equal(miss.headers.get("X-Edge-Cache"), "MISS");
  assert.deepEqual([...new Uint8Array(await miss.arrayBuffer())], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  STUDIO.objects.clear();   // served from the edge from now on
  const hit = await get({ Range: "bytes=-3" });
  assert.equal(hit.status, 206);
  assert.equal(hit.headers.get("X-Edge-Cache"), "HIT");
  assert.equal(hit.headers.get("Content-Range"), "bytes 97-99/100");
  assert.deepEqual([...new Uint8Array(await hit.arrayBuffer())], [97, 98, 99]);
  const whole = await get({});
  assert.equal(whole.status, 200);
  assert.equal((await whole.arrayBuffer()).byteLength, 100);
  assert.equal((await get({ Range: "bytes=200-" })).status, 416);
});
