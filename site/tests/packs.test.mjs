// What each pack holds (LOR-437, lib/packs.js): /downloads' "Comes with it", extra-pack tiles and "Your language", and
// the lore pages' "Hear it in game", from the generated public/data/packs.json and pack-entries.json (pipeline/lore/site_packs.py), with R2 in
// memory. Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SITE, r2 } from "./helpers.mjs";
import { MANIFEST_KEY } from "../lib/lore.js";
import { visiblePacks, packPlays } from "../lib/packs.js";
import { onRequestGet as downloadsGet } from "../functions/downloads/index.js";
import { onRequestGet as entryGet } from "../functions/lore/[type]/[id].js";
import { onRequestGet as indexGet } from "../functions/lore/index.js";

const PUBLIC = join(SITE, "public");
const HOME = "https://loreforeverwow.com";
const packs = JSON.parse(readFileSync(join(PUBLIC, "data/packs.json"), "utf8"));
const examples = packs.groups.flatMap(g => g.examples).filter(ex => ex.audio);

// ASSETS serving public/, with some files replaced ({path: json}).
const assets = (over = {}) => ({ async fetch(url) {
  const path = decodeURIComponent(new URL(url).pathname);
  if (over[path]) return Response.json(over[path]);
  const p = join(PUBLIC, path === "/downloads" ? "downloads.html" : path);
  return existsSync(p) && !p.endsWith("/") ? new Response(readFileSync(p)) : new Response("not found", { status: 404 });
} });
async function bucketWith(keys) {
  const b = r2();
  await b.put(MANIFEST_KEY, JSON.stringify({ updated: "2026-10-11T00:00:00Z", keys }));
  return b;
}
const downloads = async env => (await downloadsGet({ request: new Request(HOME + "/downloads"), env })).text();
const ids = html => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

test("/downloads: what comes with it, a tile per extra pack, each language's packs together, and an example plays only once R2 has it", async () => {
  const [inR2, notYet] = examples;
  const html = await downloads({ ASSETS: assets(), STUDIO: await bucketWith([inR2.audio]) });
  assert.match(html, /Comes with it/);
  assert.match(html, /Add more, if you like/);
  // A card for every group with a pack that's out (the original male narrator's stay "soon" until a release has them).
  const voices = JSON.parse(readFileSync(join(PUBLIC, "voices/voices.json"), "utf8")).voices;
  const out = visiblePacks(packs, voices, JSON.parse(readFileSync(join(PUBLIC, "translate/packs.json"), "utf8")).packs);
  for (const g of packs.groups) {
    if (g.packs.some(f => out.has(f))) assert.ok(ids(html).has(`packs-${g.id}`), `card ${g.id}`);
  }
  // The counts are the generated ones, never typed in: the female narrator's stories pack, as packs.json has it.
  const female = packs.packs.LoreForever_Voice_Female;
  assert.ok(html.includes(`${female.recordings.toLocaleString("en-US")} recordings: `), "female narrator's count");
  assert.ok(html.includes(`href="/audio/clip/${inR2.audio}"`), "an example R2 has plays");
  assert.ok(!html.includes(`/audio/clip/${notYet.audio}`), "an example R2 lacks has no player");
  // Nothing plays or loads by itself: the examples are links, played by /js/packs.js on a click.
  assert.equal((html.match(/<audio/g) || []).length, (html.match(/class="dl-audio"/g) || []).length);
  assert.doesNotMatch(html, /<!-- dl-(comes|packs) -->/);
  // A pack in another language sits in that language's panel, not in an English tile.
  const deDE = html.slice(html.indexOf('class="pk-lang" data-lang="deDE"'), html.indexOf('class="pk-lang" data-lang="esES"'));
  assert.ok(deDE.includes('id="pack-voice-default-dede"'), "German stories under Deutsch");
});

test("/downloads: a pack that isn't out yet stays off the page; a missing packs.json leaves the rest of it working", async () => {
  const voices = JSON.parse(readFileSync(join(PUBLIC, "voices/voices.json"), "utf8"));
  const lore = voices.voices.find(v => v.id === "female-narrator").packs.find(p => p.addon === "LoreForever_Voice_Female_MorePlaces");
  lore.status = "soon";
  const html = await downloads({ ASSETS: assets({ "/voices/voices.json": voices }), STUDIO: await bucketWith([]) });
  assert.ok(!ids(html).has("pack-voice-female-moreplaces"));
  assert.ok(ids(html).has("pack-voice-female-morepeople"));
  const bare = await downloads({ ASSETS: assets({ "/data/packs.json": { nope: 1 } }), STUDIO: await bucketWith([]) });
  assert.match(bare, /id="voices"/);
  assert.doesNotMatch(bare, /class="pk-tile |class="pk-comes"/);
  assert.match(bare, /id="installer"/);
});

test("a lore page links the downloads that have its recording, to rows /downloads has", async () => {
  const env = { ASSETS: assets(), STUDIO: await bucketWith([]) };
  const page = await (await entryGet({ request: new Request(HOME + "/lore/subzone/goldshire"), env,
    params: { type: "subzone", id: "goldshire" }, next: async () => new Response("static") })).text();
  const links = [...page.matchAll(/href="\/downloads#([^"]+)"/g)].map(m => m[1]);
  assert.ok(links.includes("pack-voice-default-alliance") && links.includes("pack-voice-female-alliance"), links.join());
  assert.match(page, /Hear it in game/);
  const there = ids(await downloads(env));
  for (const a of links) assert.ok(there.has(a), `#${a} is on /downloads`);
  const list = await (await indexGet({ request: new Request(HOME + "/lore"), env })).text();
  assert.match(list, /<select name="p">/);
  assert.match(list, /<option value="LoreForever_Voice_Female_Alliance" data-href="\/downloads#pack-voice-female-alliance" data-voice="female-narrator" data-sample="female-narrator\/[^"]+"[^>]*>Female narrator: Alliance lands<\/option>/);
});

test("/lore's pack filter: a pick plays its own narrator or its own sample, in its own language, never English", async () => {
  // An English narrator's pack plays its narrator's recordings in the list, and has a sample for when the list has
  // none of its pages (the "more" packs).
  assert.equal(packPlays("LoreForever_Voice_Female_MorePlaces", packs).voice, "female-narrator");
  assert.equal(packPlays("LoreForever_Voice_Original_Horde", packs).voice, "original-male-narrator");
  assert.ok(packPlays("LoreForever_Voice_Female_MorePlaces", packs).sample.audio);
  assert.equal(packPlays("LoreForever_Voice_Female_MorePlaces", packs).lang, undefined);
  // A narrator in another language plays its own sample: that narrator, that language.
  for (const [folder, lang, seg] of [["LoreForever_Voice_Default_frFR", "French", "voice-default-frfr/"],
    ["LoreForever_Voice_Female_frFR", "French", "voice-female-frfr/"], ["LoreForever_Voice_Default_deDE", "German", "voice-default-dede/"],
    ["LoreForever_Voice_Female_esES", "Spanish", "voice-female-eses/"], ["LoreForever_Voice_Female_ptBR", "Brazilian Portuguese", "voice-female-ptbr/"],
    ["LoreForever_Voice_Default_itIT", "Italian", "voice-default-itit/"]]) {
    const p = packPlays(folder, packs);
    assert.equal(p.voice, undefined, folder);
    assert.equal(p.lang, lang, folder);
    assert.ok(p.sample?.audio.startsWith(seg) && p.sample.title, folder);
    assert.equal(p.sample.lang, packs.packs[folder].locale.slice(0, 2), folder);
  }
  // A pack with no sample recorded says so (lore.js: "No sample yet") rather than borrowing one.
  const bare = structuredClone(packs);
  delete bare.packs.LoreForever_Voice_Female_itIT.sample;
  assert.deepEqual(packPlays("LoreForever_Voice_Female_itIT", bare), { lang: "Italian" });
  delete bare.packs.LoreForever_Voice_Female_Alliance.sample;
  assert.deepEqual(packPlays("LoreForever_Voice_Female_Alliance", bare), { voice: "female-narrator" });
  assert.deepEqual(packPlays("LoreForever_Nope", packs), {});
  // Rendered on the option /lore's script reads.
  const env = { ASSETS: assets(), STUDIO: await bucketWith([]) };
  const list = await (await indexGet({ request: new Request(HOME + "/lore"), env })).text();
  const fr = packPlays("LoreForever_Voice_Default_frFR", packs);
  assert.ok(list.includes(`<option value="LoreForever_Voice_Default_frFR" data-href="/downloads#pack-voice-default-frfr" ` +
    `data-lang="French" data-sample="${fr.sample.audio}"`), "the French narrator's option carries his sample");
  assert.match(list, /<p class="lx-packnote" hidden><\/p>/);
});

test("packs.json: every voice pack plays on /lore, every one in another language with a sample of its own", () => {
  // Built in a sparse worktree (no translated lore) every language pack lost its sample and /downloads its
  // examples (10/21); site_packs build now refuses there, and this catches a file built that way anyway.
  for (const [folder, f] of Object.entries(packs.packs)) {
    if (f.kind !== "voice") continue;
    assert.ok(f.sample?.audio, `${folder}: no sample for /lore`);
    if (!/^en/.test(f.locale)) assert.ok(f.sample?.audio && !f.lore_voice, `${folder}: no sample in its own language`);
  }
  assert.ok(packs.groups.find(g => g.id === "languages").examples.filter(ex => ex.audio).length >= 2,
    "the language card on /downloads has examples to hear");
});

test("/voices, the link voice actors were sent to record, still goes to /downloads, which opens with the recorder", async () => {
  const { onRequestGet: voicesGet } = await import("../functions/voices/index.js");
  for (const path of ["/voices", "/voices/", "/voices?x=1"]) {
    const r = voicesGet({ request: new Request(HOME + path) });
    assert.equal(r.status, 301);
    const to = new URL(r.headers.get("Location"));
    assert.equal(to.pathname, "/downloads");
    assert.equal(to.searchParams.get("from"), "voices");
    if (path.includes("x=1")) assert.equal(to.searchParams.get("x"), "1");      // its query kept
  }
  const env = { ASSETS: assets(), STUDIO: await bucketWith([]) };
  const from = await (await downloadsGet({ request: new Request(HOME + "/downloads?from=voices"), env })).text();
  const card = from.indexOf('class="dl-record"');
  assert.ok(card > 0 && card < from.indexOf('id="addon-title"'), "the recording card comes first");
  assert.match(from, /<b>Recording for Lore Forever\?<\/b> <a class="h-btn h-sm" href="\/voices\/lend">Start here<\/a>/);
  assert.doesNotMatch(await downloads(env), /class="dl-record"/);  // players who come to Downloads don't see it
});
