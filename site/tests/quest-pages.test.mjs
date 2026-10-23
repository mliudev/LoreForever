// The quest pages Willo reads aloud (lib/quest-pages.js, written by pipeline/lore/site_lore.py quest_pages): the files
// the site ships must hold only voices it can say (the studio clones of the recorded quest-giver packs' references),
// scripts that fit one request, and be found by the id // 100 the reader looks in. Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { questPage, QUEST_KEY } from "../lib/quest-pages.js";
import { AZEROTH_STUDIO, SPEAK_MAX_CHARS } from "../lib/companion-voice.js";
import { CHARACTER_VOICES } from "../lib/character-voices.js";

const FOLDER = new URL("../public/lore/data/quest-pages/", import.meta.url);
const files = readdirSync(FOLDER).filter(f => /^\d+\.json$/.test(f));
const read = name => JSON.parse(readFileSync(new URL(name, FOLDER), "utf8"));
// The deploy's static files, as Pages serves them: a missing one is the home page, 200.
const assets = { async fetch(url) {
  const m = /\/quest-pages\/(\d+\.json)$/.exec(new URL(url).pathname);
  return m && files.includes(m[1]) ? new Response(readFileSync(new URL(m[1], FOLDER))) : new Response("<!doctype html>", { status: 200 });
} };

test("every quest page is under its shard, in a voice the site can say, and short enough to say in one go", () => {
  assert.ok(files.length > 100, "the shards are there");
  let pages = 0;
  for (const file of files) {
    for (const [id, quest] of Object.entries(read(file))) {
      assert.equal(String(Math.floor(Number(id) / 100)), file.replace(".json", ""), `${id} is in ${file}`);
      assert.ok(Object.keys(quest).length && Object.keys(quest).every(k => ["d", "p", "c"].includes(k)), `${id}: ${Object.keys(quest)}`);
      for (const [script, voice] of Object.values(quest)) {
        pages++;
        assert.ok(typeof script === "string" && script.trim() && script.length <= SPEAK_MAX_CHARS, `${id}: ${script?.length}`);
        assert.ok(voice === null || (AZEROTH_STUDIO[voice] && CHARACTER_VOICES[voice]), `${id}: no voice ${voice}`);
        assert.ok(!/<[^>]+>/.test(script), `${id}: a placeholder is left in the words`);
      }
    }
  }
  assert.ok(pages > 4000);
});

test("a page is found by its key; anything else, and a missing shard (the home page), is none", async () => {
  const env = { ASSETS: assets }, origin = "https://site.example";
  const talen = await questPage(env, origin, "quest:1007#progress");
  assert.deepEqual(talen, { script: "Have you found the statuette, friend?", voice: "nightelf-male" });
  assert.equal((await questPage(env, origin, "quest:100#detail")).voice, null, "a brazier is read by the narrator");
  assert.equal((await questPage(env, origin, "quest:1007#nope")), null);
  assert.equal(await questPage(env, origin, "quest:3#detail"), null, "a quest the shard doesn't have");
  assert.equal(await questPage(env, origin, "quest:9999999#detail"), null, "a shard that isn't there");
  assert.equal(await questPage({}, origin, "quest:1007#detail"), null, "no static files");
  assert.equal(await questPage(env, origin, "constructor"), null);
  assert.ok(QUEST_KEY.test("quest:4194303#complete") && !QUEST_KEY.test("quest:01#detail") && !QUEST_KEY.test("quest:5#detail\n"));
});
