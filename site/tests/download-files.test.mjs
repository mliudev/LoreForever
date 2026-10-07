// The public download-file metadata endpoint, with GitHub and the edge cache mocked.
// Run: node --test site/tests/download-files.test.mjs
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/download-files.js";

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

test("latest and recent metadata requests begin in parallel", async () => {
  let resolveLatest, resolveRecent;
  const latest = new Promise(resolve => { resolveLatest = resolve; });
  const recent = new Promise(resolve => { resolveRecent = resolve; });
  const calls = fake(() => latest, () => recent);
  const pending = get();
  assert.equal(calls.length, 2);
  resolveLatest(LATEST);
  resolveRecent([OLD]);
  assert.equal((await pending).status, 200);
});

test("authenticated recent metadata never exposes unpublished draft bundles", async () => {
  const draft = { ...release("v0.10.0", ["LoreForever_Voice_Female_enUS-complete.zip", 2000]), draft: true };
  fake(LATEST, [draft, OLD]);
  const res = await get({ GITHUB_TOKEN: "mock-token" });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(Object.hasOwn(data.byTag, "v0.10.0"), false);
  assert.ok(data.byTag[OLD.tag_name]);
});

test("a draft returned as latest cannot confirm a public download", async () => {
  fake({ ...LATEST, draft: true });
  assert.equal((await get({ GITHUB_TOKEN: "mock-token" })).status, 503);
});

test("the latest endpoint wins over conflicting old metadata and duplicate tags", async () => {
  fake(LATEST, [release("v0.9.0", ["LoreForever.zip", 1]), OLD,
    release("v0.8.9", ["LoreForever.zip", 2])]);
  const data = await (await get()).json();
  assert.deepEqual(data.byTag.latest, latestFiles);
  assert.deepEqual(data.byTag["v0.9.0"], latestFiles);
  assert.equal(data.byTag["v0.8.9"]["LoreForever.zip"], 8456781234);
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
    assert.deepEqual(cache.puts, ["https://loreforeverwow.com/api/download-files?internal=cooldown"]);
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

test("file and tag names remain exact keys, including names special to JavaScript objects", async () => {
  fake(release("__proto__", ["__proto__", Number.MAX_SAFE_INTEGER], ["voice:deDE.zip", 1]),
    [release("constructor", ["constructor", 2])]);
  const data = await (await get()).json();
  assert.equal(data.latestTag, "__proto__");
  assert.deepEqual(Object.keys(data.byTag), ["latest", "__proto__", "constructor"]);
  assert.equal(data.byTag.latest["__proto__"], Number.MAX_SAFE_INTEGER);
  assert.equal(data.byTag["__proto__"]["voice:deDE.zip"], 1);
  assert.equal(data.byTag.constructor.constructor, 2);
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
    assert.deepEqual(cache.puts, ["https://loreforeverwow.com/api/download-files?internal=cooldown"]);
    const held = await get();
    assert.equal(held.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await held.json(), latestOnly);
    assert.equal(calls.length, 2, "visits inside the cooldown do not call GitHub");
    cache.advance(3600);
    await get();
    assert.equal(calls.length, 4, "incomplete answers retry after the cooldown");
  }
});

test("an empty recent list is a valid complete answer", async () => {
  const cache = edgeCache();
  fake(LATEST, []);
  const res = await get();
  assert.deepEqual(await res.json(), latestOnly);
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=300");
  assert.equal(cache.puts.length, 1);
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
    "https://loreforeverwow.com/api/download-files?internal=cooldown",
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

test("ordinary latest failure is held for 60 seconds and retried after expiry, without secret or old sizes", async () => {
  const cache = edgeCache();
  const calls = fake(() => { throw new Error("private-server-token"); }, [OLD]);
  const first = await get({ GITHUB_TOKEN: "private-server-token" });
  cache.advance(59);
  const held = await get();
  assert.equal(held.status, 503);
  assert.equal(held.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await held.json(), await first.json());
  assert.equal(calls.length, 2);
  const stored = cache.stored.get(cache.puts[0]).response;
  assert.equal(stored.status, 200, "only the internal envelope is cacheable");
  assert.equal(stored.headers.get("Cache-Control"), "public, max-age=60");
  const text = await stored.clone().text();
  assert.equal(text.includes("private-server-token"), false);
  assert.equal(text.includes("v0.8.9"), false);
  cache.advance(1);
  assert.equal((await get()).status, 503);
  assert.equal(calls.length, 4);
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

test("recent-list rate limits hold the latest-only answer without exposing the internal envelope", async () => {
  const cache = edgeCache();
  const calls = fake(LATEST, () => new Response(null, { status: 429, headers: { "Retry-After": "1200" } }));
  await get({ GITHUB_TOKEN: "private-server-token" });
  assert.equal(cache.stored.get(cache.puts[0]).response.headers.get("Cache-Control"), "public, max-age=1200");
  cache.advance(1199);
  const held = await get({}, { request: new Request(
    "https://loreforeverwow.com/api/download-files?internal=cooldown") });
  assert.equal(held.status, 200);
  assert.equal(held.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await held.json(), latestOnly);
  assert.equal(calls.length, 2);
  cache.advance(1);
  await get();
  assert.equal(calls.length, 4);
});
