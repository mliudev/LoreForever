// What each pack holds (LOR-437, lib/packs.js): /downloads' "Comes with it", extra-pack tiles and "Your language", and
// the lore pages' "Hear it in game", from the generated public/data/packs.json and pack-entries.json (pipeline/lore/site_packs.py), with R2 in
// memory. Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SITE, r2 } from "./helpers.mjs";
import { MANIFEST_KEY } from "../lib/lore.js";
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
  for (const g of packs.groups) assert.ok(ids(html).has(`packs-${g.id}`), `card ${g.id}`);
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
  assert.ok(deDE.includes('id="pack-voice-default-quests-dede"'), "German quest dialogue under Deutsch");
});

test("/downloads: a pack that isn't out yet stays off the page; a missing packs.json leaves the rest of it working", async () => {
  const voices = JSON.parse(readFileSync(join(PUBLIC, "voices/voices.json"), "utf8"));
  const lore = voices.voices.find(v => v.id === "female-narrator").packs.find(p => p.addon === "LoreForever_Voice_Female_Answers_Lore");
  lore.status = "soon";
  const html = await downloads({ ASSETS: assets({ "/voices/voices.json": voices }), STUDIO: await bucketWith([]) });
  assert.ok(!ids(html).has("pack-voice-female-answers-lore"));
  assert.ok(ids(html).has("pack-voice-female-answers-places"));
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
  assert.match(list, /<option value="LoreForever_Voice_Female_Alliance">Female narrator: Alliance lands<\/option>/);
});
