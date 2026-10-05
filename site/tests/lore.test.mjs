// The lore pages (LOR-233, site/LORE_PAGES.md): /lore, /lore/<type>/<id>, the sitemap, the recordings at
// /audio/clip/ and the narration API, against the generated data in public/lore/data (pipeline/lore/site_lore.py)
// with R2 in memory. Run: node --test 'site/tests/*.test.mjs'

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { SITE, ROOT, r2, d1 } from "./helpers.mjs";
import { SITE_NAV } from "../lib/voices.js";
import { keyOf, stem, sentences, fmtTime, audioKey, isPublic, MANIFEST_KEY } from "../lib/lore.js";
import { FEATURES } from "../lib/features.js";
import { onRequest as authApi } from "../functions/api/auth/[action].js";
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

test("addresses, file stems and the read-along split", () => {
  assert.equal(keyOf("zone", "stormwind"), "zone:stormwind");
  assert.equal(keyOf("quest", "176-wanted-hogger"), "quest:176");
  assert.equal(keyOf("quest", "176"), "quest:176");
  assert.equal(keyOf("QUEST", "176-Wanted"), "quest:176");
  assert.equal(keyOf("data", "index.json"), null);
  assert.equal(keyOf("zone", "../x"), null);
  assert.equal(keyOf("quest", "hogger"), null);
  assert.equal(stem("quest:176#detail"), "quest_176__detail");
  assert.equal(stem("zone:stormwind#faq3"), "zone_stormwind__faq3");
  // The same stems as the clip list the narrators get (pipeline/lore/clips.py stem).
  const csv = readFileSync(join(PUBLIC, "voices/clips.csv"), "utf8").split("\n").slice(1).filter(Boolean);
  for (const line of csv.slice(0, 200)) {
    const [id, file] = line.split(",");
    assert.equal(stem(id) + ".mp3", file, id);
  }
  assert.deepEqual(sentences("One. Two? \"Three!\" Four"), ["One. ", "Two? ", "\"Three!\" ", "Four"]);
  assert.equal(sentences("Wanted: Hogger").join(""), "Wanted: Hogger");
  assert.equal(fmtTime(66), "1:06");
  assert.equal(audioKey("male-narrator", "zone:stormwind#faq1", { sha: "0123456789" }), "male-narrator/zone_stormwind__faq1-0123456789.mp3");
});

test("the flag: the \"lore\" site feature, off by default; SITE_FEATURES overrides it", () => {
  assert.equal(FEATURES.lore, false, "turn the lore feature on only once the recordings are in R2 (site/LORE_PAGES.md)");
  assert.equal(isPublic({}), false);
  assert.equal(isPublic({ SITE_FEATURES: "lore" }), true);
  assert.equal(isPublic({ SITE_FEATURES: "contribute,-lore" }), false);
});

test("the header's Lore link follows the feature (GET /api/auth/me)", async () => {
  const me = async e => (await authApi({ request: new Request(HOME + "/api/auth/me"), env: { DB: d1(), ...e },
    params: { action: "me" } })).json();
  assert.equal((await me({})).features.lore, false);
  assert.equal((await me({ SITE_FEATURES: "lore" })).features.lore, true);
  const header = readFileSync(join(PUBLIC, "header.js"), "utf8");
  assert.match(header, /me\.features && me\.features\.lore/);
  assert.match(header, /lore\.href = "\/lore"/);
});

test("an entry page before any upload: text, sources, links, no players, noindex", async () => {
  const res = await entry("/lore/zone/stormwind");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex");
  const html = await res.text();
  assert.ok(html.includes(SITE_NAV), "the site header");
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/loreforeverwow.com\/lore\/zone\/stormwind">/);
  assert.match(html, /<h1>Stormwind City<\/h1>/);
  assert.match(html, /<title>Stormwind City: lore and narration - Lore Forever<\/title>/);
  assert.match(html, /<a href="\/lore">Lore<\/a> &rsaquo; Stormwind City/);
  assert.ok(!html.includes('class="lp-btn"'), "no players without recordings");
  assert.match(html, /Hear this one in game: <a href="\/downloads\?src=lore">/);
  assert.match(html, /href="https:\/\/warcraft.wiki.gg\/wiki\/Stormwind_City"/);
  assert.match(html, /<h2 id="in-title">In Stormwind City<\/h2>/);
  assert.match(html, /<a class="btn-download" href="\/downloads\?src=lore">Get Lore Forever<\/a>/);
  assert.ok(!html.includes('id="lp-report"'), "no report form without anything to report");
  assert.match(html, /<span class="rl-s">/);
  assert.match(html, /<link rel="stylesheet" href="\/lore\/lore.css">/);
});

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

test("public: indexable pages and a sitemap of them", async () => {
  const pub = env({ SITE_FEATURES: "lore" });
  const res = await entry("/lore/zone/stormwind", pub);
  assert.equal(res.headers.get("X-Robots-Tag"), null);
  assert.ok(!(await res.text()).includes('name="robots"'));
  const hidden = await (await sitemapGet({ request: new Request(HOME + "/lore/sitemap.xml"), env: env() })).text();
  assert.ok(!hidden.includes("<loc>"), "no URLs while hidden");
  assert.match(hidden, /<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  const shown = await (await sitemapGet({ request: new Request(HOME + "/lore/sitemap.xml"), env: pub })).text();
  assert.match(shown, /<loc>https:\/\/loreforeverwow.com\/lore<\/loc>/);
  assert.match(shown, /<loc>https:\/\/loreforeverwow.com\/lore\/quest\/176-wanted-hogger<\/loc>/);
  const index = JSON.parse(readFileSync(join(PUBLIC, "lore/data/index.json"), "utf8"));
  assert.equal((shown.match(/<loc>/g) || []).length, index.pages.length + 1);
  assert.match(readFileSync(join(PUBLIC, "robots.txt"), "utf8"), /^Sitemap: https:\/\/loreforeverwow.com\/lore\/sitemap.xml$/m);
});

test("quests: the title is in the address, other spellings redirect, unknown entries 404", async () => {
  let res = await entry("/lore/quest/176");
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("Location"), HOME + "/lore/quest/176-wanted-hogger");
  res = await entry("/lore/quest/176-old-title?src=addon");
  assert.equal(res.headers.get("Location"), HOME + "/lore/quest/176-wanted-hogger?src=addon");
  res = await entry("/lore/Zone/Stormwind");
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("Location"), HOME + "/lore/zone/stormwind");
  res = await entry("/lore/quest/176-wanted-hogger");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<h2>Quest text<\/h2>/);
  assert.match(html, /<details class="lp-fold"><summary>Show the words<\/summary>/, "the completion text is folded");
  assert.match(html, /Quest text &copy; Blizzard Entertainment|Quest text © Blizzard Entertainment/);
  res = await entry("/lore/zone/nowhere-at-all");
  assert.equal(res.status, 404);
  assert.match(await res.text(), /No lore page here/);
  assert.equal(await (await entry("/lore/data/index.json")).text(), "static");
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

test("/lore: the list's frame, the zones without JavaScript, noindex", async () => {
  const res = await indexGet({ request: new Request(HOME + "/lore"), env: env() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex");
  const html = await res.text();
  assert.match(html, /<h1 id="lx-title">Hear the lore<\/h1>/);
  assert.match(html, /<a href="\/lore\/zone\/elwynn">Elwynn Forest<\/a>/);
  assert.match(html, /<a href="\/lore\/zone\/deadmines">/);
  assert.match(html, /class="lx-bar" role="search" hidden/);
  assert.match(html, /id="lp-report"/);
  assert.match(html, /\d[\d,]* narrations &middot; [\d,]+ pages/);
  assert.match(html, /<script src="\/lore\/lore.js" defer><\/script>/);
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

test("a preview without its own recordings plays production's", async () => {
  const keys = ["female-narrator/zone_elwynn-abcdefabcd.mp3"];
  globalThis.fetch = async url => {
    assert.equal(String(url), "https://loreforeverwow.com/api/narration/live");
    return Response.json({ keys });
  };
  const res = await narration({ request: new Request("https://abc.lore-forever.pages.dev/api/narration/live"),
    env: { STUDIO: r2() }, params: { action: "live" } });
  assert.deepEqual(await res.json(), { keys });
});
