// The lore pages (LOR-233, site/LORE_PAGES.md): /lore, /lore/<type>/<id>, the sitemap, the recordings at
// /audio/clip/ and the narration API, against the generated data in public/lore/data (pipeline/lore/site_lore.py)
// with R2 in memory. Run: node --test 'site/tests/*.test.mjs'

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { SITE, ROOT, r2 } from "./helpers.mjs";

import { audioKey, MANIFEST_KEY } from "../lib/lore.js";

import { onRequestGet as entryGet } from "../functions/lore/[type]/[id].js";
import { onRequestGet as indexGet } from "../functions/lore/index.js";
import { onRequestGet as sitemapGet } from "../functions/lore/sitemap.xml.js";

import { onRequest as audioGet, parseRange } from "../functions/audio/clip/[voice]/[file].js";
import { onRequest as narration } from "../functions/api/narration/[action].js";

const PUBLIC = join(SITE, "public");
const HOME = "https://loreforeverwow.com";
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// ASSETS serving the real public/ folder (the generated lore data included).
const ASSETS = { async fetch(url) {
  const p = join(PUBLIC, decodeURIComponent(new URL(url).pathname));
  return existsSync(p) && !p.endsWith("/") ? new Response(readFileSync(p)) : new Response("not found", { status: 404 });
} };
const entryJson = key => JSON.parse(readFileSync(join(PUBLIC, "lore/data/e", key.replace(":", "_") + ".json"), "utf8"));
const env = (extra = {}) => ({ ASSETS, ...extra });

async function entry(path, e = env()) {
  const url = new URL(path, HOME);
  const [, , type, id] = url.pathname.split("/");
  return entryGet({ request: new Request(url), env: e, params: { type, id }, next: async () => new Response("static") });
}

// A bucket whose manifest lists these recordings (and holds them, a few bytes each).
async function bucketWith(keys) {
  const b = r2();
  for (const k of keys) await b.put("narration/" + k, new TextEncoder().encode("ID3" + k));
  await b.put(MANIFEST_KEY, JSON.stringify({ updated: "2026-10-04T00:00:00Z", keys }));
  return b;
}

test("with recordings in R2: a player per voice and the report form; only what the manifest lists plays", async () => {
  const e = entryJson("zone:stormwind");
  const story = e.clips.find(c => c.part === "narration");
  const male = audioKey("male-narrator", story.id, story.voices["male-narrator"]);
  const STUDIO = await bucketWith([male]);
  const res = await entry("/lore/zone/stormwind", env({ STUDIO }));
  const html = await res.text();
  assert.ok(html.includes(`href="/audio/clip/${male}"`), male);
  assert.equal((html.match(/class="lp-btn"/g) || []).length, 1, "the female recording isn't in the manifest");
  assert.match(html, /<span class="lp-vn">Male narrator<\/span> <span class="lp-len">\d+:\d\d<\/span>/);
  assert.match(html, /id="lp-report"/);
  assert.match(html, /<button type="button" class="lp-rep" hidden>Report a problem with this line<\/button>\s*<span class="lp-open" hidden><\/span>/);
  assert.match(html, new RegExp(`data-clip="${story.id}" data-hash="${story.hash}"`));
  assert.match(html, /class="lp-speed"/);
  for (const reason of ["name", "voice", "cut", "stage", "quality", "text", "other"]) assert.match(html, new RegExp(`value="${reason}"`));
});

test("spoilers: a narration whose summary gives a story away plays nothing and shows the safe summary", async () => {
  const spoilers = JSON.parse(readFileSync(join(ROOT, "data/spoilers.json"), "utf8"));
  const lore = JSON.parse(readFileSync(join(ROOT, "data/lore/npc_onyxia.json"), "utf8"));
  const html = await (await entry("/lore/npc/onyxia")).text();
  const safe = spoilers["npc:onyxia"].summary;
  assert.ok(safe, "the test needs a rewritten summary");
  const esc = s => s.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
  assert.ok(html.includes(esc(safe.slice(0, 60))));
  let at = 0;   // where the rewrite parts from the original: what follows there is the spoiler
  while (at < lore.summary.length && lore.summary[at] === safe[at]) at++;
  assert.ok(!html.includes(esc(lore.summary.slice(at, at + 40))), "the original summary isn't shown");
  for (const s of lore.sections.filter(s => s.spoiler > 0)) assert.ok(!html.includes(s.body.slice(0, 50)), s.title);
  assert.ok(!html.includes('class="lp-clip'), "no narration");
});

test("an entry with no recording is a page of its spoiler-free text, with nothing to play (LOR-20)", async () => {
  const lore = JSON.parse(readFileSync(join(ROOT, "data/lore/item_dalin-s-heart.json"), "utf8"));
  const res = await entry("/lore/item/dalin-s-heart");
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Robots-Tag"), null, "indexable");
  assert.match(html, /<title>Dalin&#39;s Heart – WoW Forever Lore \| Lore Forever<\/title>/);
  for (const s of lore.sections.filter(s => s.spoiler === 0)) assert.ok(html.includes(`<h2>${s.title}</h2>`), s.title);
  assert.ok(html.includes("https://www.wowhead.com/forever/item="), "Look it up links its game ID");
  assert.ok(html.includes('href="/lore/quest/1476-hearts-of-the-pure"'), "an item links its quest");
  assert.ok(!html.includes("lp-clip") && !html.includes("lp-btn") && !html.includes('id="lp-report"'), "no Listen box");
  // (pipeline/tests/test_site_lore.py checks that no spoiler section of any entry reaches a page.)
});

test("search results: the title says WoW Forever and where, the description is whole sentences, breadcrumbs for Google", async () => {
  const head = async path => {
    const html = await (await entry(path)).text();
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)[1]);
    return { title: /<title>(.*?)<\/title>/.exec(html)[1], desc: /<meta name="description" content="(.*?)">/.exec(html)[1], ld };
  };
  // Search Console 9/28-10/13: "bandarion keep" 158 impressions at 8.5, no clicks, with "Bandarion Keep: lore and
  // narration" over the summary cut mid-sentence.
  const place = await head("/lore/subzone/bandarion-keep");
  assert.equal(place.title, "Bandarion Keep, Tirisfal Glades – WoW Forever Lore");
  assert.match(place.desc, /^Bandarion Keep is a fortified redoubt .*\.$/);
  assert.deepEqual(place.ld.itemListElement.map(i => [i.position, i.name, i.item]), [
    [1, "Lore", "https://loreforeverwow.com/lore"], [2, "Tirisfal Glades", "https://loreforeverwow.com/lore/zone/tirisfal"],
    [3, "Bandarion Keep", "https://loreforeverwow.com/lore/subzone/bandarion-keep"]]);
  const quest = await head("/lore/quest/92706-wanted-bruuz");
  assert.equal(quest.title, "WANTED: Bruuz – WoW Forever Quest in The Barrens");
  assert.match(quest.desc, /\. A level 20 WoW Forever quest in The Barrens, with the quest giver&#39;s words read aloud\.$/);
  assert.ok(quest.desc.length <= 160 + 4, quest.desc);   // + the escaped apostrophe
});

test("a page of a line or two is noindex and left out of the sitemap; the rest is indexed", async () => {
  const more = JSON.parse(readFileSync(join(PUBLIC, "lore/data/more.json"), "utf8")).pages;
  const index = JSON.parse(readFileSync(join(PUBLIC, "lore/data/index.json"), "utf8")).pages;
  const thin = more.filter(p => p.x);
  assert.ok(thin.length > 0 && thin.length < more.length / 10, `${thin.length} thin pages of ${more.length}`);
  assert.ok(index.every(p => !p.x), "a page with a recording is never thin");
  const res = await entry(thin[0].p);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex");
  assert.match(await res.text(), /<meta name="robots" content="noindex">/);

  const sitemap = await (await sitemapGet({ request: new Request(`${HOME}/lore/sitemap.xml`), env: env() })).text();
  const locs = sitemap.match(/<loc>[^<]+<\/loc>/g);
  assert.equal(locs.length, 1 + index.length + more.length - thin.length);
  assert.ok(sitemap.includes("/lore/item/dalin-s-heart</loc>") && sitemap.includes("/lore/zone/stormwind</loc>"));
  assert.ok(!sitemap.includes(`${thin[0].p}</loc>`), thin[0].p);
});

test("/lore lists the pages with nothing to play too, and links the topics no zone page does", async () => {
  const more = JSON.parse(readFileSync(join(PUBLIC, "lore/data/more.json"), "utf8")).pages;
  const html = await (await indexGet({ request: new Request(`${HOME}/lore`), env: env() })).text();
  assert.ok(html.includes('href="/lore/topic/lordaeron"'), "a topic");
  assert.ok(more.some(p => p.k === "item") && more.some(p => p.k === "topic"));
  assert.match(html, /<h3>Topics <span class="lp-count">\d+<\/span><\/h3>/);
});

test("/audio/clip/: whole files, ranges, 304s, 404s, and previews sent to production", async () => {
  const key = "male-narrator/zone_stormwind-0123456789.mp3";
  const STUDIO = r2();
  const bytes = new TextEncoder().encode("ID3abcdefghijklmnopqrstuvwxyz");
  await STUDIO.put("narration/" + key, bytes);
  const [voice, file] = key.split("/");
  const get = (headers = {}, host = HOME, method = "GET", f = file) => audioGet({
    request: new Request(`${host}/audio/clip/${voice}/${f}`, { method, headers }), env: { STUDIO }, params: { voice, file: f } });

  let res = await get();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "audio/mpeg");
  assert.equal(res.headers.get("Accept-Ranges"), "bytes");
  assert.match(res.headers.get("Cache-Control"), /immutable/);
  assert.equal(res.headers.get("ETag"), '"0123456789"');
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);

  res = await get({ Range: "bytes=0-1" });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("Content-Range"), `bytes 0-1/${bytes.length}`);
  assert.equal(new TextDecoder().decode(await res.arrayBuffer()), "ID");
  res = await get({ Range: "bytes=-3" });
  assert.equal(res.headers.get("Content-Range"), `bytes ${bytes.length - 3}-${bytes.length - 1}/${bytes.length}`);
  assert.equal(new TextDecoder().decode(await res.arrayBuffer()), "xyz");
  res = await get({ Range: "bytes=10-" });
  assert.equal(res.status, 206);
  assert.equal(Number(res.headers.get("Content-Length")), bytes.length - 10);
  res = await get({ Range: "bytes=999-" });
  assert.equal(res.status, 416);
  assert.equal(res.headers.get("Content-Range"), `bytes */${bytes.length}`);
  res = await get({}, HOME, "HEAD");
  assert.equal(res.headers.get("Content-Length"), String(bytes.length));
  res = await get({ "If-None-Match": '"0123456789"' });
  assert.equal(res.status, 304);

  const missing = "zone_stormwind-9999999999.mp3";
  assert.equal((await get({}, HOME, "GET", missing)).status, 404);
  res = await get({}, "https://abc123.lore-forever.pages.dev", "GET", missing);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), `${HOME}/audio/clip/${voice}/${missing}`);
  assert.equal((await get({}, HOME, "GET", "../../secret.mp3")).status, 404);
  assert.equal((await get({}, HOME, "POST")).status, 405);

  assert.deepEqual(parseRange("bytes=5-9"), { offset: 5, length: 5 });
  assert.deepEqual(parseRange("bytes=-4"), { suffix: 4 });
  assert.equal(parseRange("bytes=9-5"), null);
  assert.equal(parseRange("bytes=0-1,4-5"), null);
  assert.equal(parseRange(null), null);
});

test("the narration API: admin uploads (checked), the manifest, and the public list", async () => {
  const STUDIO = r2();
  const e = { STUDIO, ADMIN_KEY: "k" };
  const call = (action, { method = "GET", query = "", body, auth = "k", host = HOME } = {}) => narration({
    request: new Request(`${host}/api/narration/${action}${query}`, {
      method, body, headers: auth ? { Authorization: `Bearer ${auth}` } : {} }),
    env: e, params: { action } });
  const mp3 = new TextEncoder().encode("ID3\u0004\u0000 a narration");
  const sha = createHash("sha256").update(mp3).digest("hex");
  const key = `male-narrator/zone_elwynn-${sha.slice(0, 10)}.mp3`;
  const q = (k, s) => `?key=${encodeURIComponent(k)}&sha256=${s}`;

  assert.equal((await call("audio", { auth: "" })).status, 401);
  assert.equal((await call("audio", { auth: "wrong" })).status, 401);
  assert.equal((await call("nothing")).status, 404);
  assert.equal((await call("audio", { method: "PUT", query: q("bad key", sha), body: mp3 })).status, 400);
  assert.equal((await call("audio", { method: "PUT", query: q(`male-narrator/zone_elwynn-${"0".repeat(10)}.mp3`, sha), body: mp3 })).status, 400,
    "the key's sha must be the file's");
  const wav = new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WAVEfmt ");
  const wsha = createHash("sha256").update(wav).digest("hex");
  assert.equal((await call("audio", { method: "PUT", query: q(`male-narrator/x-${wsha.slice(0, 10)}.mp3`, wsha), body: wav })).status, 415);
  // A body that isn't what the sha256 says: R2 refuses it.
  const other = new TextEncoder().encode("ID3 something else");
  assert.equal((await call("audio", { method: "PUT", query: q(key, sha), body: other })).status, 400);

  let res = await call("audio", { method: "PUT", query: q(key, sha), body: mp3 });
  assert.deepEqual(await res.json(), { ok: true, key, stored: true });
  assert.equal(STUDIO.objects.get("narration/" + key).opts.httpMetadata.contentType, "audio/mpeg");
  res = await call("audio", { method: "PUT", query: q(key, sha), body: mp3 });
  assert.equal((await res.json()).stored, false);
  assert.deepEqual((await (await call("audio")).json()).keys, [key]);

  res = await call("manifest", { method: "POST", body: "{}" });
  assert.deepEqual(await res.json(), { ok: true, files: 1 });
  const manifest = JSON.parse(new TextDecoder().decode(STUDIO.objects.get(MANIFEST_KEY).bytes));
  assert.deepEqual(manifest.keys, [key]);
  res = await call("live", { auth: "" });
  assert.deepEqual(await res.json(), { keys: [key] });
  assert.match(res.headers.get("Cache-Control"), /max-age=300/);
});
