// What each pack holds (LOR-437, lib/packs.js): /downloads' bundle cards and every file (LOR-848, lib/bundles.js), and
// the lore pages' "Hear it in game", from the generated public/data/packs.json and pack-entries.json (pipeline/lore/site_packs.py), with R2 in
// memory. Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SITE, r2 } from "./helpers.mjs";
import { MANIFEST_KEY } from "../lib/lore.js";
import { visiblePacks, packPlays, anchorOf } from "../lib/packs.js";
import { SETUP_PICKS_AFTER } from "../lib/bundles.js";
import { onRequestGet as downloadsGet } from "../functions/downloads/index.js";
import { onRequestGet as entryGet } from "../functions/lore/[type]/[id].js";
import { onRequestGet as indexGet } from "../functions/lore/index.js";

const PUBLIC = join(SITE, "public");
const HOME = "https://loreforeverwow.com";
const packs = JSON.parse(readFileSync(join(PUBLIC, "data/packs.json"), "utf8"));

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

// The catalog /downloads draws its cards from (LOR-848), as the page carries it for /js/downloads.js.
const catalogOf = html => JSON.parse(/<script type="application\/json" id="bx-catalog">([\s\S]*?)<\/script>/.exec(html)[1]);

test("/downloads: each language's add-on card gets that language's narrator, the Windows button says the pick, and the original male narrator and text-only choices are nowhere", async () => {
  const html = await downloads({ ASSETS: assets(), STUDIO: await bucketWith([]) });
  const cat = catalogOf(html);
  // Every narration the release has, by language and narrator, from packs.json: each is that language's narrator on
  // its add-on card, which downloads its ZIP and opens its CurseForge project.
  const voices = JSON.parse(readFileSync(join(PUBLIC, "voices/voices.json"), "utf8")).voices;
  const out = visiblePacks(packs, voices, JSON.parse(readFileSync(join(PUBLIC, "translate/packs.json"), "utf8")).packs);
  const narrations = Object.entries(packs.packs).filter(([f, p]) => /^LoreForever_Voice_(Default|Female)_[a-z]{2}[A-Z]{2}$/.test(f)
    && p.group !== "community" && out.has(f));
  assert.ok(narrations.length >= 8, "the release has narration in several languages");
  for (const [folder, p] of narrations) {
    const lang = cat.langs.find(l => l.locale === p.locale), who = folder.includes("_Female_") ? "female" : "male";
    assert.ok(lang, `${p.locale} is in the bar`);
    const card = lang.narrators.find(n => n.id === who)?.cards.addon;
    assert.ok(card?.ok, `${p.locale} ${who}: an add-on card`);
    assert.ok(card.zips.some(z => z.href === p.download), `${p.locale} ${who}: its ZIP`);
    if (p.curseforge?.slug) assert.ok(card.cf.some(c => c.slug === p.curseforge.slug), `${p.locale} ${who}: its CurseForge project`);
    assert.equal(card.setup, `${who}, ${lang.code}, addon`, `${p.locale} ${who}: Setup gets the pick`);
  }
  // English: the female narrator's add-on card brings her stories and both lands.
  const female = cat.langs.find(l => l.code === "en").narrators.find(n => n.id === "female").cards.addon;
  const herZips = female.zips.map(z => z.href).join(" ");
  assert.ok(/female-complete/.test(herZips) || ["", "_Alliance", "_Horde"].every(s => herZips.includes(packs.packs[`LoreForever_Voice_Female${s}`].download)));
  // The original male narrator is off the page, and no language that has a narrator offers its text alone.
  const original = Object.entries(packs.packs).filter(([, p]) => p.lore_voice === "original-male-narrator");
  assert.ok(original.length, "packs.json still lists his packs (they keep working in game)");
  for (const [f, p] of original) {
    assert.ok(!html.includes(p.download) && !html.includes(anchorOf(f)), `${f} is not on /downloads`);
    if (p.curseforge?.slug) assert.ok(!html.includes(p.curseforge.slug), `${f}'s project is not on /downloads`);
  }
  assert.doesNotMatch(html, /original male/i);
  assert.doesNotMatch(html, /text only/i);
  for (const lang of cat.langs) {
    const narrated = narrations.some(([, p]) => p.locale === lang.locale) || lang.narrators.some(n => !/in English/.test(n.name));
    if (narrated) assert.ok(!html.includes(`id="${anchorOf(`LoreForever_Lang_${lang.locale}`)}"`), `${lang.name}: no text-only file`);
  }
});

test("/downloads: once the published Setup reads the pick from its name, the English cards need no ticking and a German card still says what Setup can't install", async () => {
  const feed = JSON.parse(readFileSync(join(PUBLIC, "data/download-files.json"), "utf8"));
  const draw = async tag => catalogOf(await downloads({ ASSETS: assets({ "/data/download-files.json": { ...feed, publishedTag: tag } }),
    STUDIO: await bucketWith([]) }));
  const ticks = (cat, code) => cat.langs.find(l => l.code === code).narrators.flatMap(n => Object.values(n.cards)).filter(c => c.ok).map(c => c.tick);
  assert.ok(ticks(await draw(`v${SETUP_PICKS_AFTER}`), "en").some(Boolean), "that release's Setup is ticked by hand");
  const [major, minor] = SETUP_PICKS_AFTER.split(".").map(Number);
  const later = await draw(`v${major}.${minor + 1}.0`);
  assert.deepEqual(ticks(later, "en").filter(Boolean), [], "the next one comes ticked");
  assert.ok(ticks(later, "de").length && ticks(later, "de").every(t => /german/i.test(t)), "German narration isn't in Setup yet");
});

test("/downloads: a pack that isn't out yet stays off the page; a missing packs.json leaves the rest of it working", async () => {
  const voices = JSON.parse(readFileSync(join(PUBLIC, "voices/voices.json"), "utf8"));
  const lore = voices.voices.find(v => v.id === "female-narrator").packs.find(p => p.addon === "LoreForever_Voice_Female_MorePlaces");
  lore.status = "soon";
  const html = await downloads({ ASSETS: assets({ "/voices/voices.json": voices }), STUDIO: await bucketWith([]) });
  assert.ok(!ids(html).has("pack-voice-female-moreplaces"));
  assert.ok(ids(html).has("pack-voice-female-morepeople"));
  assert.ok(!html.includes(packs.packs.LoreForever_Voice_Female_MorePlaces.download), "not in any card");
  const bare = await downloads({ ASSETS: assets({ "/data/packs.json": { nope: 1 } }), STUDIO: await bucketWith([]) });
  assert.match(bare, /id="voices"/);
  assert.doesNotMatch(bare, /id="bx-catalog"/);
  assert.match(bare, /id="installer"/);
});

test("a lore page links the downloads that have its recording, to rows /downloads has", async () => {
  const env = { ASSETS: assets(), STUDIO: await bucketWith([]) };
  // A place both narrators have recorded in the Alliance packs, from the data: rewording a page retires its recordings
  // until it is re-recorded, so no named page is certain to have them.
  const inPacks = JSON.parse(readFileSync(join(PUBLIC, "data/pack-entries.json"), "utf8"));
  const alliance = ["LoreForever_Voice_Default_Alliance", "LoreForever_Voice_Female_Alliance"].map(p => inPacks.packs.indexOf(p));
  const key = Object.keys(inPacks.entries).sort().find(k => k.startsWith("subzone:") && alliance.every(i => inPacks.entries[k].includes(i)));
  assert.ok(key, "some place has a recording in both Alliance packs");
  const id = key.slice("subzone:".length);
  const page = await (await entryGet({ request: new Request(HOME + "/lore/subzone/" + id), env,
    params: { type: "subzone", id }, next: async () => new Response("static") })).text();
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
