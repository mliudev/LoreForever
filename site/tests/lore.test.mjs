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
import { onRequestGet as langEntryGet } from "../functions/[lang]/lore/[type]/[id].js";
import { onRequestGet as narrationListGet } from "../functions/[lang]/lore/narration.json.js";
import { onRequest as i18nAdmin } from "../functions/api/admin/lore-i18n.js";
import { tr } from "../lib/lore-strings.js";

import { onRequest as audioGet, parseRange } from "../functions/audio/clip/[voice]/[file].js";
import { onRequest as narrationPublic } from "../functions/api/narration/[action].js";
import { onRequest as narrationAdmin } from "../functions/api/admin/narration/[action].js";

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

// A zone page the male narrator has recorded, from the data: rewording a page retires its recordings until it is
// re-recorded, so no named page is certain to have them.
function recordedZone() {
  const index = JSON.parse(readFileSync(join(PUBLIC, "lore/data/index.json"), "utf8"));
  for (const p of index.pages.filter(p => p.k === "zone")) {
    const key = "zone:" + p.p.split("/").pop();
    const e = entryJson(key);
    const story = e.clips.find(c => c.part === "narration");
    if (story?.voices?.["male-narrator"]) return { key, path: p.p, entry: e, story };
  }
  assert.fail("no zone page has a male narrator recording");
}

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
  const { path, story } = recordedZone();
  const male = audioKey("male-narrator", story.id, story.voices["male-narrator"]);
  const STUDIO = await bucketWith([male]);
  const res = await entry(path, env({ STUDIO }));
  const html = await res.text();
  assert.ok(html.includes(`href="/audio/clip/${male}"`), male);
  assert.equal((html.match(/class="lp-btn"/g) || []).length, 1, "the female recording isn't in the manifest");
  assert.match(html, /class="lp-vn">Male narrator</);
  assert.match(html, /class="lp-len">\d+:\d\d</);
  assert.match(html, /id="lp-report"/);
  assert.match(html, /class="lp-rep"/);
  assert.match(html, /class="lp-open"/);
  assert.match(html, new RegExp(`data-clip="${story.id}" data-hash="${story.hash}"`));
  assert.match(html, /class="lp-speed"/);
  for (const reason of ["name", "voice", "cut", "stage", "quality", "text", "other"]) assert.match(html, new RegExp(`value="${reason}"`));
});

test("Next plays on goes to a later page in /lore's order that has a recording; the last page has nowhere to go", async () => {
  const index = JSON.parse(readFileSync(join(PUBLIC, "lore/data/index.json"), "utf8"));
  const order = index.pages.map(p => p.p);
  const recorded = p => (p.c || []).some(c => (c[2] || []).some(Boolean));
  const first = recordedZone().path;
  const html = await (await entry(first)).text();
  const next = /data-next="([^"]+)"/.exec(html)?.[1];
  assert.ok(next, first + " has a page to go on to");
  assert.ok(order.indexOf(next) > order.indexOf(first), next);
  assert.ok(recorded(index.pages.find(p => p.p === next)), `${next} has a recording`);
  assert.equal((await entry(next)).status, 200);
  const last = order[order.length - 1];
  assert.doesNotMatch(await (await entry(last)).text(), /data-next=/, last);
});

test("an entry adapted from a Wowpedia article is looked up on Wowpedia, not the Warcraft Wiki", async () => {
  const e = entryJson("zone:elwynn");
  e.sources = [{ kind: "wiki", site: "Wowpedia", title: "Elwynn Forest", url: "https://wowpedia.fandom.com/wiki/Elwynn_Forest",
                 license: "CC BY-SA 3.0", license_url: "https://creativecommons.org/licenses/by-sa/3.0/" }];
  const assets = { async fetch(url) {
    return new URL(url).pathname.endsWith("/e/zone_elwynn.json") ? new Response(JSON.stringify(e)) : ASSETS.fetch(url);
  } };
  const html = await (await entry("/lore/zone/elwynn", { ASSETS: assets })).text();
  assert.match(html, /href="https:\/\/wowpedia\.fandom\.com\/wiki\/Elwynn_Forest"[^>]*>Elwynn Forest on Wowpedia<\/a>/i);
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
  // Any item page the lore data lists without a recording that links a quest (which pages those are moves with every
  // story that gets narrated, so the data says, not a name).
  const more = JSON.parse(readFileSync(join(PUBLIC, "lore/data/more.json"), "utf8")).pages;
  const pick = more.filter(p => p.k === "item" && !p.x).map(p => ({ p, e: entryJson("item:" + p.p.split("/")[3]) }))
    .find(({ e }) => e.clips.length === 0 && e.wowhead && e.related.some(r => r.p.startsWith("/lore/quest/")));
  assert.ok(pick, "the lore data has no unnarrated item that links a quest: pick another kind of page");
  const lore = JSON.parse(readFileSync(join(ROOT, "data/lore/item_" + pick.p.p.split("/")[3] + ".json"), "utf8"));
  const res = await entry(pick.p.p);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Robots-Tag"), null, "indexable");
  assert.ok(html.includes("<title>" + pick.p.n.replace(/&/g, "&amp;").replace(/'/g, "&#39;")), "the title names the entry");
  const esc = t => t.replace(/&/g, "&amp;").replace(/'/g, "&#39;");
  assert.ok(pick.e.sections.length > 0, "the page has sections of its own");
  for (const s of pick.e.sections) assert.ok(html.includes(`<h2>${esc(s.t)}</h2>`), s.t);
  for (const s of lore.sections.filter(s => s.spoiler > 0)) assert.ok(!html.includes(s.body.slice(0, 50)), "no spoiler: " + s.title);
  assert.ok(html.includes("https://www.wowhead.com/forever/item="), "Look it up links its game ID");
  const quest = pick.e.related.find(r => r.p.startsWith("/lore/quest/")).p;
  assert.ok(html.includes(`href="${quest}"`), "an item links its quest");
  // (The report form is in every page: the foot player can report whatever the playlist is playing.)
  assert.ok(!html.includes("lp-clip") && !html.includes("lp-btn") && !html.includes("lp-listen"), "no Listen box");
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
  for (const fact of ["level 20", "The Barrens"]) assert.ok(quest.desc.includes(fact), fact);
  assert.match(quest.desc, /\.$/);
  assert.ok(quest.desc.length <= 160 + 4, quest.desc);   // + the escaped apostrophe
});

test("a page of a line or two is noindex and left out of the sitemap; the rest is indexed", async () => {
  const more = JSON.parse(readFileSync(join(PUBLIC, "lore/data/more.json"), "utf8")).pages;
  const index = JSON.parse(readFileSync(join(PUBLIC, "lore/data/index.json"), "utf8")).pages;
  const thin = more.filter(p => p.x);
  // (a few pages, not most of them: thin ones stay under one page in a hundred)
  assert.ok(thin.length > 0 && thin.length < (more.length + index.length) / 100, `${thin.length} thin pages of ${more.length + index.length}`);
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
  assert.match(html, /Topics <span class="lp-count">\d+</);
  // It ends on the download link, written out (it once printed the template's own source).
  assert.match(html, /<a class="btn-download" href="[^"]+">Get Lore Forever<\/a>/i);
  assert.ok(!html.includes("${"), "template code on the page");
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

test("the narration API: admin uploads (checked, under /api/admin/), the manifest, and the public list", async () => {
  const STUDIO = r2();
  const e = { STUDIO, ADMIN_KEY: "k", FEEDBACK_KEY: "f",   // Access set up, as in production (the script gate itself: access-service.test.mjs)
    ACCESS_ISSUER: "https://lore-test.cloudflareaccess.com", ACCESS_AUD: "aud", ACCESS_SCRIPT_TOKENS: "script.access" };
  // Uploads and the bucket listing live under /api/admin/ (where Cloudflare Access is); the public list stays at /api/narration/.
  const call = (action, { method = "GET", query = "", body, auth = "k", host = HOME } = {}) => {
    const handler = action === "live" ? narrationPublic : narrationAdmin;
    const path = action === "live" ? "/api/narration" : "/api/admin/narration";
    return handler({
      request: new Request(`${host}${path}/${action}${query}`, {
        method, body, headers: auth ? { Authorization: `Bearer ${auth}` } : {} }),
      env: e, params: { action } });
  };
  const mp3 = new TextEncoder().encode("ID3\u0004\u0000 a narration");
  const sha = createHash("sha256").update(mp3).digest("hex");
  const key = `male-narrator/zone_elwynn-${sha.slice(0, 10)}.mp3`;
  const q = (k, s) => `?key=${encodeURIComponent(k)}&sha256=${s}`;

  assert.equal((await call("audio", { auth: "" })).status, 401);
  assert.equal((await call("audio", { auth: "wrong" })).status, 401);
  assert.equal((await call("audio", { auth: "f" })).status, 401, "the routines' FEEDBACK_KEY can't write recordings");
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

  // The old upload address is gone for good (it sat outside Access): 410 even with the right key, and it names the new one.
  for (const [action, method] of [["audio", "GET"], ["audio", "PUT"], ["manifest", "POST"]]) {
    res = await narrationPublic({ request: new Request(`${HOME}/api/narration/${action}`, { method, body: method === "GET" ? undefined : "{}",
      headers: { Authorization: "Bearer k" } }), env: e, params: { action } });
    assert.equal(res.status, 410, `${method} /api/narration/${action}`);
    assert.match((await res.json()).error, new RegExp(`/api/admin/narration/${action}`));
  }
});

// The pages in other languages (LOR-809): R2's lore-i18n/ objects (pipeline/lore/site_i18n.py), in the shape of the
// English page plus its language, served at /<lang>/lore/..., and named by the English page's language switch.
test("a translated page reads in its language with the English page and its other languages as alternates; a language it lacks goes to English", async () => {
  const en = entryJson("zone:elwynn");
  const STUDIO = r2();
  const put = (key, obj) => STUDIO.put("lore-i18n/" + key, new TextEncoder().encode(JSON.stringify(obj)));
  await put("index.json", { format: 1, langs: [{ seg: "de", hreflang: "de", name: "Deutsch" },
    { seg: "fr", hreflang: "fr", name: "Français" }, { seg: "zh", hreflang: "zh-Hans", name: "简体中文" }],
  pages: { [en.path]: 0b101 } });
  await put("de/zone/elwynn.json", { ...en, lang: "de", en: en.path, path: "/de" + en.path, name: "Wald von Elwynn",
    intro: ["Der Wald von Elwynn ist ein friedlicher Wald."], sections: [], clips: [] });
  const e = env({ STUDIO });
  const lang = (seg, path) => langEntryGet({ request: new Request(HOME + path), env: e,
    params: { lang: seg, type: "zone", id: "elwynn" }, next: async () => new Response("static") });

  const res = await lang("de", "/de" + en.path);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<html lang="de">/);
  assert.match(html, /<h1>Wald von Elwynn<\/h1>/);
  assert.match(html, new RegExp(`rel="canonical" href="${HOME}/de${en.path}"`));
  for (const [hl, path] of [["en", en.path], ["de", "/de" + en.path], ["zh-Hans", "/zh" + en.path], ["x-default", en.path]]) {
    assert.match(html, new RegExp(`rel="alternate" hreflang="${hl}" href="${HOME}${path}"`), hl);
  }
  assert.doesNotMatch(html, /hreflang="fr"/, "French isn't one of this page's languages");
  assert.doesNotMatch(html, /class="lp-mine"/, "the profile line names English pages only");
  // No English narrator under German text: the page says there's no recording in German, and plays nothing.
  assert.match(html, /class="lp-ingame lp-norec"/);
  assert.doesNotMatch(html, /English page/i);
  assert.doesNotMatch(html, /class="lp-btn"|class="lp-all"/);

  // French: not in this page's mask. Chinese: in the mask, but R2 has no object (an upload under way). Both go to English.
  for (const seg of ["fr", "zh"]) {
    const away = await lang(seg, `/${seg}${en.path}`);
    assert.equal(away.status, 302, seg);
    assert.equal(new URL(away.headers.get("Location")).pathname, en.path, seg);
  }
  // Not a language at all: the 404 page.
  assert.equal((await lang("xx", "/xx" + en.path)).status, 404);

  // The English page links to the languages it reads in.
  const english = await (await entry(en.path, e)).text();
  assert.match(english, new RegExp(`<a href="/de${en.path}" hreflang="de"`));
  assert.match(english, new RegExp(`rel="alternate" hreflang="zh-Hans" href="${HOME}/zh${en.path}"`));
});

// The /lore list in another language plays that language's narrators: the upload's list of them (site_i18n.py
// narration_list, a few hundred KB, more than a page may be), read back with the narrators named in the language.
test("the /lore list's recordings in another language: uploaded, then served with its narrators named in it", async () => {
  const STUDIO = r2();
  const e = env({ STUDIO, ADMIN_KEY: "k", FEEDBACK_KEY: "f",
    ACCESS_ISSUER: "https://lore-test.cloudflareaccess.com", ACCESS_AUD: "aud", ACCESS_SCRIPT_TOKENS: "script.access" });
  await STUDIO.put("lore-i18n/index.json", JSON.stringify({ format: 1, pages: {},
    langs: [{ seg: "de", hreflang: "de", name: "Deutsch" }, { seg: "fr", hreflang: "fr", name: "Français" }] }));
  const list = { format: 1, voices: ["female-narrator-de", "male-narrator-de"], pages: Array.from({ length: 9000 }, (_, i) =>
    ({ p: `/lore/npc/someone-${i}`, c: [["", "abc123", [["0123456789", 42], null]]] })) };
  const body = new TextEncoder().encode(JSON.stringify(list));
  assert.ok(body.length > 512 * 1024, "bigger than a page may be");
  const sha = createHash("sha256").update(body).digest("hex");
  const put = await i18nAdmin({ request: new Request(`${HOME}/api/admin/lore-i18n?key=de/narration.json&sha256=${sha}`,
    { method: "PUT", body, headers: { Authorization: "Bearer k" } }), env: e });
  assert.equal(put.status, 200, await put.clone().text());

  const get = seg => narrationListGet({ request: new Request(`${HOME}/${seg}/lore/narration.json`), env: e, params: { lang: seg } });
  const res = await get("de");
  assert.equal(res.status, 200);
  const got = await res.json();
  assert.deepEqual(got.list, list);
  assert.equal(got.names["female-narrator-de"], tr("de", "Female narrator"), "named in German");
  assert.equal((await get("fr")).status, 404, "no French list uploaded yet: the list then sends listeners to the pages");
  assert.equal((await get("xx")).status, 404, "not one of the languages");
});

// Mike, 10/26: a page in a language the add-on has recordings in plays them, in that language's narrators.
test("a translated page with recordings in its language plays them, and only those", async () => {
  const en = entryJson("zone:elwynn");
  const story = { id: "zone:elwynn", part: "narration", anchor: "story", title: "The story", hash: "abc123",
    paras: ["Der Wald von Elwynn ist ein friedlicher Wald."], voices: { "female-narrator-de": { sha: "0123456789", sec: 42 },
      "male-narrator-de": { sha: "abcdefabcd", sec: 40 } } };
  const german = audioKey("female-narrator-de", story.id, story.voices["female-narrator-de"]);
  const STUDIO = await bucketWith([german]);
  const put = (key, obj) => STUDIO.put("lore-i18n/" + key, new TextEncoder().encode(JSON.stringify(obj)));
  await put("index.json", { format: 1, langs: [{ seg: "de", hreflang: "de", name: "Deutsch" }], pages: { [en.path]: 1 } });
  await put("de/zone/elwynn.json", { ...en, lang: "de", en: en.path, path: "/de" + en.path, name: "Wald von Elwynn",
    intro: [], sections: [{ t: "Ein trügerischer Friede", p: ["Doch der Friede trügt."] }], clips: [story] });
  const res = await langEntryGet({ request: new Request(`${HOME}/de${en.path}`), env: env({ STUDIO }),
    params: { lang: "de", type: "zone", id: "elwynn" }, next: async () => new Response("static") });
  const html = await res.text();
  assert.ok(html.includes(`href="/audio/clip/${german}"`), "the German recording R2 has");
  assert.equal((html.match(/class="lp-btn"/g) || []).length, 1, "the male German take isn't in R2");
  assert.match(html, /class="lp-all"/, "Listen");
  assert.match(html, /class="lp-speed"/);
  assert.doesNotMatch(html, /class="lp-ingame lp-norec"/, "it has a recording");
  assert.doesNotMatch(html, /class="lp-vn">Female narrator</i, "named in German, not English");
  assert.ok(html.indexOf('id="story"') < html.indexOf("Ein trügerischer Friede"), "the story, then what it doesn't read");
});
