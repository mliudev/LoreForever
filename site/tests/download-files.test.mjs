// The public download-file metadata endpoint, with GitHub and the edge cache mocked.
// Run: node --test site/tests/download-files.test.mjs
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/download-files.js";
import { publishedFiles } from "../lib/download-files.js";
import { readFileSync } from "node:fs";

const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realCaches === undefined) delete globalThis.caches;
  else globalThis.caches = realCaches;
});

const API = "https://api.github.com/repos/mliudev/LoreForever/releases";
const release = (tag_name, ...assets) => ({ tag_name, assets: assets.map(([name, size]) => ({ name, size })) });
const LATEST = release("v0.9.0", ["LoreForever.zip", 8712359923], ["LoreForever-Setup.exe", 27861504],
  ["LoreForever-complete.zip", 9153457654]);
const OLD = release("v0.8.9", ["LoreForever.zip", 8456781234], ["LoreForever_Voice_Female.zip", 135345345]);
const AUDIO = release("audio", ["LoreForever_Voice_Default-0123456789abcdef.zip", 7654321]);
const latestFiles = Object.fromEntries(LATEST.assets.map(a => [a.name, a.size]));
const latestOnly = { latestTag: "v0.9.0", byTag: { latest: latestFiles, "v0.9.0": latestFiles } };
const snapshot = JSON.parse(readFileSync(new URL("./fixtures/download-catalog/download-files.json", import.meta.url)));

// Bodies may be a status, a Response, or a callback to simulate a thrown network error.
function fake(latest = LATEST, recent = [LATEST, OLD, AUDIO]) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), ...opts });
    assert.ok(url === API + "/latest" || url === API + "?per_page=30", "fixed official metadata URLs only");
    const value = url === API + "/latest" ? latest : recent;
    const body = typeof value === "function" ? await value(opts) : value;
    if (body instanceof Response) return body;
    return typeof body === "number" ? new Response("unavailable", { status: body }) : Response.json(body);
  };
  return calls;
}
const get = (env = {}, extra = {}) => onRequestGet({
  request: new Request("https://loreforeverwow.com/api/download-files"), env, ...extra,
});

function edgeCache() {
  const stored = new Map(), matches = [], puts = [];
  let now = 0;
  globalThis.caches = { default: {
    async match(key) {
      matches.push(key.url);
      const item = stored.get(key.url);
      return item && item.expires > now ? item.response.clone() : undefined;
    },
    async put(key, value) {
      puts.push(key.url);
      const ttl = Number(/max-age=(\d+)/.exec(value.headers.get("Cache-Control"))?.[1] || 0);
      stored.set(key.url, { response: value.clone(), expires: now + ttl });
    },
  } };
  return { stored, matches, puts, advance: seconds => { now += seconds; } };
}

test("exact file bytes, authoritative version, and recent tag lookups use a stable public contract", async () => {
  const calls = fake(LATEST, [OLD, AUDIO]); // latest need not appear in the recent list
  const res = await get();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=300");
  assert.deepEqual(await res.json(), { ...latestOnly, byTag: { ...latestOnly.byTag,
    "v0.8.9": { "LoreForever.zip": 8456781234, "LoreForever_Voice_Female.zip": 135345345 },
    audio: { "LoreForever_Voice_Default-0123456789abcdef.zip": 7654321 },
  } });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.headers.Accept, "application/vnd.github+json");
    assert.equal(call.headers.Authorization, undefined);
    assert.equal(call.redirect, "manual");
    assert.ok(call.signal instanceof AbortSignal);
  }
});

test("authenticated recent metadata never exposes unpublished draft bundles", async () => {
  const draft = { ...release("v0.11.0", ["LoreForever_Voice_Female_enUS-complete.zip", 2000]), draft: true };
  fake(LATEST, [draft, OLD]);
  const res = await get({ GITHUB_TOKEN: "mock-token" });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(Object.hasOwn(data.byTag, "v0.11.0"), false);
  assert.ok(data.byTag[OLD.tag_name]);
});

test("a draft returned as latest cannot confirm a public download", async () => {
  fake({ ...LATEST, draft: true });
  assert.equal((await get({ GITHUB_TOKEN: "mock-token" })).status, 503);
});

test("optional server authentication is used for both requests and never returned", async () => {
  const token = "private-server-token";
  const calls = fake();
  const res = await get({ GITHUB_TOKEN: token });
  for (const call of calls) assert.equal(call.headers.Authorization, "Bearer " + token);
  assert.equal((await res.text()).includes(token), false);
  assert.equal([...res.headers].some(([key, value]) => key === "authorization" || value.includes(token)), false);
});

test("failed, rate-limited, invalid JSON, or network-failed latest is a no-store 503 with no older fallback", async () => {
  for (const latest of [401, 403, 429, 500, new Response("not json"),
    new Response(null, { status: 302, headers: { Location: "https://untrusted.example/files" } }),
    () => { throw new Error("private-server-token"); }]) {
    const cache = edgeCache();
    fake(latest, [OLD]);
    const res = await get({ GITHUB_TOKEN: "private-server-token" });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await res.json(), { error: "Download file details are temporarily unavailable." });
    assert.deepEqual(cache.puts, ["https://loreforeverwow.com/api/download-files?internal=cooldown-v2"]);
  }
});

test("malformed latest release or asset metadata cannot be published as file sizes", async () => {
  const badAssets = [
    null, { name: "", size: 10 }, { name: "   ", size: 10 }, { name: 12, size: 10 },
    { name: "file.zip", size: "12" }, { name: "file.zip", size: 0 }, { name: "file.zip", size: -1 },
    { name: "file.zip", size: 1.5 }, { name: "file.zip", size: Number.MAX_SAFE_INTEGER + 1 },
    { name: "file.zip", size: Infinity },
  ];
  const malformed = [null, {}, [], { tag_name: "", assets: [] }, { tag_name: "  ", assets: [] },
    { tag_name: 9, assets: [] }, { tag_name: "v1", assets: {} }, release("v1"),
    release("v1", ["file.zip", 1], ["file.zip", 2]),
    ...badAssets.map(asset => ({ tag_name: "v1", assets: [asset] })),
  ];
  for (const latest of malformed) {
    fake(latest);
    const res = await get();
    assert.equal(res.status, 503, JSON.stringify(latest));
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  }
});

test("failed or malformed recent list retains only latest, with a private edge cooldown and outward no-store", async () => {
  const missing = [403, 429, 500, null, {}, new Response("not json"), [OLD, null],
    [OLD, { tag_name: "bad", assets: [{ name: "bad.zip", size: -1 }] }],
    () => { throw new Error("network failure"); }];
  for (const recent of missing) {
    const cache = edgeCache();
    const calls = fake(LATEST, recent);
    const res = await get();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await res.json(), latestOnly);
    assert.deepEqual(cache.puts, ["https://loreforeverwow.com/api/download-files?internal=cooldown-v2"]);
    const held = await get();
    assert.equal(held.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await held.json(), latestOnly);
    assert.equal(calls.length, 2, "visits inside the cooldown do not call GitHub");
    cache.advance(3600);
    await get();
    assert.equal(calls.length, 4, "incomplete answers retry after the cooldown");
  }
});

test("complete edge-cache hits avoid GitHub and query strings share the fixed cache key", async () => {
  const cache = edgeCache();
  const calls = fake();
  const waits = [];
  const first = await get({}, { waitUntil: promise => waits.push(promise), request: new Request(
    "https://loreforeverwow.com/api/download-files?url=https://untrusted.example/files", {
      headers: { Authorization: "Bearer visitor-token" },
    }) });
  await Promise.all(waits);
  const second = await get({ GITHUB_TOKEN: "other-server-token" });
  assert.deepEqual(await second.json(), await first.json());
  assert.equal(calls.length, 2);
  assert.equal(waits.length, 1);
  assert.deepEqual(cache.puts, ["https://loreforeverwow.com/api/download-files"]);
  assert.deepEqual(cache.matches, ["https://loreforeverwow.com/api/download-files",
    "https://loreforeverwow.com/api/download-files?internal=cooldown-v2",
    "https://loreforeverwow.com/api/download-files"]);
  for (const call of calls) assert.equal(call.headers.Authorization, undefined);
});

test("cache read and write failures do not fail public metadata", async () => {
  globalThis.caches = { default: {
    async match() { throw new Error("cache unavailable"); },
    async put() { throw new Error("cache unavailable"); },
  } };
  fake();
  const res = await get();
  assert.equal(res.status, 200);
  assert.equal((await res.json()).latestTag, "v0.9.0");
});

test("rate limits and retry headers set safe bounded internal cooldowns", async () => {
  const reset = Math.floor(Date.now() / 1000) + 900;
  const date = new Date(Date.now() + 600000).toUTCString();
  const cases = [
    [403, { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(reset) }, 900],
    [429, { "Retry-After": "1800" }, 1800],
    [503, { "Retry-After": date }, 600],
    [429, { "Retry-After": "864000" }, 3600],
    [429, { "Retry-After": "Infinity", "X-RateLimit-Reset": "not-a-time" }, 300],
    [500, { "Retry-After": "-1" }, 60],
    [500, { "Retry-After": "1" }, 60],
  ];
  for (const [status, headers, seconds] of cases) {
    const cache = edgeCache();
    const calls = fake(() => new Response(null, { status, headers }));
    await get();
    const internal = cache.stored.get(cache.puts[0]).response;
    assert.equal(internal.headers.get("Cache-Control"), `public, max-age=${seconds}`);
    cache.advance(seconds - 1);
    const held = await get();
    assert.equal(held.status, 503);
    assert.equal(held.headers.get("Cache-Control"), "no-store");
    assert.equal(calls.length, 2);
    cache.advance(1);
    await get();
    assert.equal(calls.length, 4);
  }
});

test("an expired complete cache never supplies old latest files when a refresh fails", async () => {
  const cache = edgeCache();
  let fail = false;
  const calls = fake(() => fail ? new Response(null, { status: 500 }) : LATEST);
  await get();
  cache.advance(299);
  assert.equal((await get()).status, 200);
  assert.equal(calls.length, 2);
  cache.advance(1);
  fail = true;
  const res = await get();
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "Download file details are temporarily unavailable." });
  assert.equal(calls.length, 4);
});

test("upstream outage serves exact published metadata and pinned links without claiming latest", async () => {
  const cache = edgeCache(), calls = fake(403);
  const env = { ASSETS: { fetch: async url => {
    assert.equal(url.pathname, "/data/download-files.json");
    return Response.json(snapshot);
  } } };
  const first = await get(env), data = await first.json();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Cache-Control"), "no-store");
  assert.equal(data.latestTag, undefined);
  assert.equal(data.byTag.latest, undefined);
  assert.equal(data.publishedTag, snapshot.publishedTag);
  assert.equal(data.byTag[data.publishedTag]["LoreForever.zip"], 356086600);
  assert.equal(data.downloads["/download/zip"], "https://github.com/mliudev/LoreForever/releases/download/v0.11.0/LoreForever.zip");
  assert.deepEqual(await (await get(env)).json(), data);
  assert.equal(calls.length, 2, "snapshot answers share the bounded retry cooldown");
  cache.advance(3600);
  fake();
  const recovered = await (await get(env)).json();
  assert.equal(recovered.latestTag, "v0.9.0");
  assert.equal(recovered.publishedTag, undefined);
});

test("unverified snapshots cannot invent sizes, latest metadata, or arbitrary download links", async () => {
  for (const mutate of [s => s.publishedTag = "unknown", s => s.byTag.latest = {},
    s => s.downloads["/download/zip"] = "v0.11.0:missing.zip", s => s.downloads["https://evil.test"] = "v0.11.0:LoreForever.zip",
    s => s.byTag["v0.11.0"]["LoreForever.zip"] = -1]) {
    const bad = structuredClone(snapshot); mutate(bad);
    assert.throws(() => publishedFiles(bad));
    fake(500);
    assert.equal((await get({ ASSETS: { fetch: async () => Response.json(bad) } })).status, 503);
  }
});

test("a failed recent list can use verified tagged files while live latest retains precedence", async () => {
  fake(LATEST, 503);
  const res = await get({ ASSETS: { fetch: async () => Response.json(snapshot) } });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.latestTag, LATEST.tag_name);
  assert.equal(data.publishedTag, undefined);
  assert.deepEqual(data.byTag.latest, latestFiles);
  assert.deepEqual(data.byTag.languages, snapshot.byTag.languages);
});
