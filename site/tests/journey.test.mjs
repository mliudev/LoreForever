// lib/journey.js: reading a pasted "Copy my journey record" back into a profile's facts (LOR-181).
// Run: node --test site/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parseRecord } from "../lib/journey.js";
import { SITE } from "./helpers.mjs";
import { RECORD } from "./fixtures/journey/record.mjs";

test("other players never get in: the group part is dropped and counted, unknown killers are dropped", () => {
  const d = parseRecord(RECORD);
  const json = JSON.stringify(d);
  assert.ok(!json.includes("Dwarf Priest") && !json.includes("Human Warrior") && !json.includes("with "), json);
  assert.equal(d.grouped, 4);   // the quest, the boss, the elite and the death
  assert.deepEqual(d.deaths, [
    { sub: "Auberdine", zone: "Darkshore", by: "Murloc Forager" },   // a foe the record lists: kept
    { sub: "Auberdine", zone: "Darkshore" },                         // Gravenx isn't one: could be a player
    { zone: "The Deadmines" },
  ]);
  assert.ok(!json.includes("Gravenx"));
  assert.ok(!json.includes("Journey record"), "the record's text isn't kept");
});

test("a paste with chat above it, Windows line breaks and a squeezed double space still reads", () => {
  const messy = "[12:01] Me: here it is\r\n\r\n" + RECORD.replace(/\n/g, "\r\n")
    .replace("- Oct 01 14:30  The Balance of Nature", "- Oct 01 14:30 The Balance of Nature");
  const d = parseRecord(messy);
  assert.equal(d.name, "Aelric");
  assert.equal(d.quests[0].title, "The Balance of Nature");
  assert.equal(d.places.length, 7);
});

test("a paste that lost its blank lines still finds every section", () => {
  const squeezed = parseRecord(RECORD.replace(/\n\n/g, "\n"));
  const d = parseRecord(RECORD);
  for (const k of ["places", "quests", "people", "bosses", "kills", "loot", "deaths", "fought"]) {
    assert.equal(squeezed[k].length, d[k].length, k);
  }
  assert.deepEqual(squeezed.totals, d.totals);
});

test("names that are also object keys find nothing", () => {
  const d = parseRecord("Journey record: Aelric - Forever\nLevel 24 Night Elf constructor, __proto__\n\nNotable kills\n" +
    "- Oct 01 14:00  Hogger · constructor · Elwynn Forest\n\nLoot and quest rewards\n- Oct 01 14:01  Thing · __proto__\n");
  assert.deepEqual([d.classKey, d.factionKey, d.kills[0].rank, d.loot[0].quality], [null, null, null, null]);
});

// Records made by the add-on itself under the Lua mock (tests/fixtures/journey/make_fixtures.py), when present.
const FIXTURES = `${SITE}tests/fixtures/journey/`;
for (const [file, locale] of [["en.txt", "en"], ["de.txt", "de"], ["fr.txt", "fr"], ["es.txt", "es"], ["pt.txt", "pt"]]) {
  test(`the add-on's own ${file} reads in full`, { skip: !existsSync(FIXTURES + file) }, () => {
    const d = parseRecord(readFileSync(FIXTURES + file, "utf8"));
    assert.equal(d.locale, locale);
    assert.equal(d.name, "Aelric");
    assert.equal(d.classKey, "DRUID");
    assert.ok(d.level > 1 && d.places.length > 3 && d.quests.length > 3 && d.bosses.length > 0, JSON.stringify(d).slice(0, 400));
    assert.ok(d.places.some(p => p.dungeon), "a dungeon");
    assert.ok(d.fought.length > 3, "most fought");
    const json = JSON.stringify(d);
    for (const other of ["Brannoc", "Lyssa", "Gravenx"]) assert.ok(!json.includes(other), `${other} isn't kept`);
  });
}

// The journey in numbers (LOR-246): the "Journey stats" the add-on prints first since then.
const STATS = {
  yards: 59320, slain: 192, elites: 7, rares: 3, deaths: 3, recorded: 23.5, played: 26,
  walk: [{ zone: "Teldrassil", yards: 21400 }, { zone: "Darkshore", yards: 18250 }, { zone: "Ashenvale", yards: 9100 },
    { zone: "Westfall", yards: 6420 }, { zone: "Darnassus", yards: 2210 }, { zone: "Wetlands", yards: 1300 },
    { zone: "Moonglade", yards: 640 }],
  kinds: [{ kind: "Beast", n: 98 }, { kind: "Humanoid", n: 61 }, { kind: "Elemental", n: 21 }, { kind: "Undead", n: 4 }],
  // LOR-262
  ride: 14200, swim: 1880, flown: 41300, flights: 7, flownTo: 3, boats: 2, fish: 17, days: 9, best: 6, words: 21400,
  heard: 64,
  time: [{ zone: "Teldrassil", minutes: 840 }, { zone: "Darkshore", minutes: 660 }, { zone: "Ashenvale", minutes: 420 },
    { zone: "Westfall", minutes: 210 }, { zone: "Darnassus", minutes: 120 }],
  killers: [{ name: "Murloc Forager", n: 1 }],
  patrons: [{ name: "Gershala Nightwhisper", n: 4 }, { name: "Conservator Ilthalaine", n: 3 },
    { name: "Gryan Stoutmantle", n: 2 }, { name: "Raene Wolfrunner", n: 2 }],
  inns: [{ name: "Auberdine", n: 2 }, { name: "Astranaar", n: 1 }, { name: "Dolanaar", n: 1 }],
  destinations: [{ name: "Auberdine", n: 3 }, { name: "Astranaar", n: 2 }, { name: "Rut'theran Village", n: 2 }],
};
const fixture = file => readFileSync(FIXTURES + file, "utf8");
const hasFixtures = existsSync(FIXTURES + "en.txt") && fixture("en.txt").includes("Journey stats");

test("journey stats: the add-on's own records read the same in every language", { skip: !hasFixtures }, () => {
  for (const file of ["en.txt", "en-tricky.txt", "en-cut.txt", "de.txt", "fr.txt", "es.txt", "pt.txt"]) {
    const d = parseRecord(fixture(file));
    assert.deepEqual(d.stats, STATS, file);
    assert.ok(d.places.length > 3 && d.fought.length > 3, `${file}: the sections after them still read`);
  }
  // A record kept before the add-on had a tally: its numbers are its kills and deaths.
  const mid = parseRecord(fixture("en-midlife.txt"));
  assert.deepEqual([mid.stats.yards, mid.stats.slain, mid.stats.deaths, mid.stats.recorded, mid.stats.played, mid.stats.walk],
    [0, 106, 3, 0, null, []]);
});

test("journey stats: a record from an add-on before them still reads in full, with none", { skip: !existsSync(FIXTURES + "en-0.8.txt") }, () => {
  const old = parseRecord(fixture("en-0.8.txt"));
  assert.equal(old.stats, null);
  if (!hasFixtures) return;
  const now = parseRecord(fixture("en.txt"));
  const { stats, ...rest } = now;
  const deaths = rest.deaths.map(({ cause, ...d }) => d);   // LOR-262 says how one happened
  assert.deepEqual({ ...rest, deaths, stats: null }, old, "everything else is the same as before");
  assert.deepEqual(now.deaths.map(d => d.cause ?? null), [null, "drown", null]);
  assert.equal(parseRecord(RECORD).stats, null);
});

test("journey stats: a killer is kept when the record lists it among the creatures that slew them", () => {
  const d = parseRecord(`Journey record: Aelric - Forever

Slain by
Hogger: 2

Deaths
- Oct 01 14:30  Elwynn Forest · slain by Hogger
- Oct 01 15:30  Elwynn Forest · slain by Somebody
- Oct 01 16:30  Loch Modan · drowned
`);
  assert.deepEqual(d.deaths, [{ zone: "Elwynn Forest", by: "Hogger" }, { zone: "Elwynn Forest" }, { zone: "Loch Modan", cause: "drown" }]);
  assert.deepEqual(d.stats.killers, [{ name: "Hogger", n: 2 }]);
});
