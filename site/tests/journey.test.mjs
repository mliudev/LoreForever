// lib/journey.js: reading a pasted "Copy my journey record" back into a profile's facts (LOR-181).
// Run: node --test site/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parseRecord, RecordError, MAX_BYTES } from "../lib/journey.js";
import { SITE } from "./helpers.mjs";
import { RECORD } from "./fixtures/journey/record.mjs";

test("an English record: the character, the totals and every section", () => {
  const d = parseRecord(RECORD);
  assert.equal(d.locale, "en");
  assert.deepEqual([d.name, d.realm, d.level, d.race, d.className, d.classKey, d.faction, d.factionKey],
    ["Aelric", "Forever", 24, "Night Elf", "Druid", "DRUID", "Alliance", "alliance"]);
  assert.equal(d.since, "Oct 01, 2026");
  assert.equal(d.fromLevel, null);
  assert.deepEqual(d.totals, { quests: 12, places: 9, people: 7, foes: 30, bosses: 2 });
  assert.deepEqual(d.places[0], { sub: "Shadowglen", zone: "Teldrassil" });
  assert.deepEqual(d.places[2], { zone: "Darnassus" });
  assert.deepEqual(d.places[5], { zone: "The Deadmines", dungeon: true });
  assert.deepEqual(d.quests[1], { title: "The Defias Brotherhood", sub: "Sentinel Hill", zone: "Westfall" });
  assert.deepEqual(d.people.map(p => p.name), ["Conservator Ilthalaine", "Gryan Stoutmantle"]);
  assert.deepEqual(d.bosses, [{ name: "Mor'Ladim" }, { name: "Edwin VanCleef", zone: "The Deadmines" }]);
  assert.deepEqual(d.kills.map(k => [k.name, k.rank, k.zone]),
    [["Mother Fang", "rare", "Elwynn Forest"], ["Foreman Thistlenettle", "elite", "The Deadmines"]]);
  assert.deepEqual(d.loot, [
    { name: "Cruel Barb", quality: 3, zone: "The Deadmines" },
    { name: "Westfall Gloves", quality: 2, reward: true, quest: "The Defias Brotherhood", sub: "Sentinel Hill", zone: "Westfall" },
  ]);
  assert.deepEqual(d.levels, [{ level: 24, zone: "Wetlands" }]);
  assert.deepEqual(d.spells, [{ name: "Bear Form" }]);
  assert.deepEqual(d.mounts, [{ name: "Striped Nightsaber", zone: "Darnassus" }]);
  assert.deepEqual(d.profs, [{ name: "Herbalism", rank: 150 }]);
  assert.deepEqual(d.rep, [{ faction: "Darnassus", standing: "Honored", zone: "Darnassus" }]);
  assert.deepEqual(d.books, [{ title: "The Seven Dragons", zone: "Darnassus" }]);
  assert.equal(d.shots, 1);
  assert.deepEqual(d.fought, [{ name: "Murloc Forager", n: 30 }, { name: "Defias Pillager", n: 12 }]);
  assert.equal(d.cut, false);
});

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

test("bad input: empty, too big, not a record", () => {
  const code = input => { try { parseRecord(input); return "parsed"; } catch (e) { assert.ok(e instanceof RecordError); return e.message; } };
  assert.equal(code(""), "empty");
  assert.equal(code("   \n  "), "empty");
  assert.equal(code(undefined), "empty");
  assert.equal(code("hello there\nthis is my story"), "not-a-record");
  assert.equal(code({ record: "x" }), "not-a-record");
  assert.equal(code("Journey record: \n"), "not-a-record");
  assert.equal(code(RECORD + "x".repeat(MAX_BYTES)), "too-big");
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

test("a record started mid-life, an empty one, and a cut one", () => {
  const mid = parseRecord(`Journey record: Brakka - Forever
Level 30 Orc Warrior, Horde
Recorded since Oct 01, 2026, from level 12.
0 quests done · 1 place · 0 people met · 0 foes · 0 bosses

Places recorded, in order
- Oct 01 14:00  Razor Hill, Durotar

Older entries were left out to keep this record short.
`);
  assert.deepEqual([mid.fromLevel, mid.places.length, mid.cut, mid.classKey, mid.factionKey], [12, 1, true, "WARRIOR", "horde"]);
  const empty = parseRecord("Journey record: Newbie - Forever\nLevel 1 Gnome Mage, Alliance\n0 quests done · 0 places · 0 people met · 0 foes · 0 bosses\n\nNothing recorded yet.\n");
  assert.deepEqual([empty.name, empty.level, empty.places.length, empty.totals.quests], ["Newbie", 1, 0, 0]);
});

test("names are tidied and capped, never interpreted", () => {
  const d = parseRecord(`Journey record: <b>Aelric</b> - Forever
Level 24 Night Elf Druid, Alliance

People met
- Oct 01 14:05  Gor'kan <the "Tamer"> · Shadowglen, Teldrassil
- Oct 01 14:06  ${"A".repeat(500)}

Loot and quest rewards
- Oct 03 10:41  Blade & <Script> · Epic · The Deadmines
`);
  assert.equal(d.name, "<b>Aelric</b>");   // kept as text; the page escapes it
  assert.equal(d.people[0].name, 'Gor\'kan <the "Tamer">');
  assert.equal(d.people[1].name.length, 80);
  assert.deepEqual(d.loot[0], { name: "Blade & <Script>", quality: 4, zone: "The Deadmines" });
});

test("German, French, Spanish and Portuguese records read through their own strings", () => {
  const de = parseRecord(`Reiseaufzeichnung: Brakka - Forever
Stufe 18 Orc Kriegerin, Horde
Aufgezeichnet seit Oct 01, 2026, ab Stufe 5.
3 Quests abgeschlossen · 4 Orte · 2 Personen getroffen · 10 Feinde · 1 Boss

Aufgezeichnete Orte, in Reihenfolge
- Oct 01 14:00  Klingenhügel, Durotar
- Oct 01 18:00  Der Flammenschlund · Dungeon

Abgeschlossene Quests
- Oct 01 14:30  Kein Ort für Schwächlinge · Klingenhügel, Durotar · mit Troll Schamane

Bosse besiegt
- Oct 01 19:00  Taragaman der Hungerleider · Der Flammenschlund

Bemerkenswerte Siege
- Oct 01 18:40  Jergosh der Herbeirufer · Elite · Der Flammenschlund · with Troll Schamane

Beute- und Questbelohnungen
- Oct 01 19:05  Klinge des Hungers · Rar · Der Flammenschlund

Ruf
- Oct 01 20:00  Wohlwollend mit Orgrimmar · Orgrimmar

Tode
- Oct 01 18:30  Der Flammenschlund · getötet von Taragaman der Hungerleider
- Oct 01 18:35  Gestorben

Am meisten bekämpft
Ragefireschamane: 5, Höhlenkriecher: 3
`);
  assert.deepEqual([de.locale, de.name, de.level, de.race, de.className, de.classKey, de.factionKey, de.fromLevel],
    ["de", "Brakka", 18, "Orc", "Kriegerin", "WARRIOR", "horde", 5]);
  assert.deepEqual(de.totals, { quests: 3, places: 4, people: 2, foes: 10, bosses: 1 });
  assert.deepEqual(de.places[1], { zone: "Der Flammenschlund", dungeon: true });
  assert.deepEqual(de.quests[0], { title: "Kein Ort für Schwächlinge", sub: "Klingenhügel", zone: "Durotar" });
  assert.deepEqual(de.kills[0], { name: "Jergosh der Herbeirufer", rank: "elite", zone: "Der Flammenschlund" });
  assert.equal(de.grouped, 2);   // "mit ..." and, from a string the pack lacked, "with ..."
  assert.deepEqual(de.loot[0].quality, 3);
  assert.deepEqual(de.rep, [{ faction: "Orgrimmar", standing: "Wohlwollend", zone: "Orgrimmar" }]);
  assert.deepEqual(de.deaths, [{ zone: "Der Flammenschlund", by: "Taragaman der Hungerleider" }, {}]);
  assert.deepEqual(de.fought.map(f => f.n), [5, 3]);
  assert.ok(!JSON.stringify(de).includes("Troll Schamane"));

  const fr = parseRecord("Rapport de périple : Lysandre - Forever\nNiveau 12 Elfe de la nuit Chasseresse, Alliance\n" +
    "Enregistré depuis le Oct 01, 2026.\n\nQuêtes terminées\n- Oct 01 14:30  Le sort de Teldrassil · Dolanaar, Teldrassil · avec Humain Prêtre\n");
  assert.deepEqual([fr.locale, fr.level, fr.race, fr.classKey, fr.quests.length, fr.grouped], ["fr", 12, "Elfe de la nuit", "HUNTER", 1, 1]);
  const es = parseRecord("Registro de viaje: Nuria - Forever\nNivel 9 Humana Sacerdotisa, Alianza\n\nMuertes\n- Oct 01 14:30  Ha muerto\n\nMuertes destacadas\n- Oct 01 14:31  Hogger · élite · Bosque de Elwynn\n");
  assert.deepEqual([es.locale, es.classKey, es.factionKey, es.deaths.length, es.kills[0].rank], ["es", "PRIEST", "alliance", 1, "elite"]);
  const pt = parseRecord("Registro de jornada: Tiago - Forever\nNível 7 Morto-vivo Bruxo, Horda\n\nSubidas de nível\n- Oct 01 14:30  Alcançou o nível 7 · Clareira de Tirisfal\n");
  assert.deepEqual([pt.locale, pt.level, pt.race, pt.classKey, pt.factionKey, pt.levels[0].level], ["pt", 7, "Morto-vivo", "WARLOCK", "horde", 7]);
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

test("journey stats: lines worded in a way the site doesn't know yet are read by their place", () => {
  const record = `Registro di viaggio: Aelric - Forever
Level 24 Night Elf Druid, Alliance

Statistiche del viaggio
- Metri percorsi: 41203
- Nemici uccisi: 2345
- Élite uccisi: 31
- Rari uccisi: 12
- Morti: 9
- Ore registrate: 75.3
- Ore giocate: 80,5

New places, in order
- Oct 01 14:00  Shadowglen, Teldrassil
`.replace("Registro di viaggio", "Journey record");
  const d = parseRecord(record);
  assert.deepEqual([d.stats.yards, d.stats.slain, d.stats.elites, d.stats.rares, d.stats.deaths, d.stats.recorded, d.stats.played],
    [41203, 2345, 31, 12, 9, 75.3, null]);   // the six by their place; hours played only by its words
  assert.deepEqual(d.places, [{ sub: "Shadowglen", zone: "Teldrassil" }]);
  // Known words in any order win over the place; an English line in a German record is read too.
  const de = parseRecord(`Reiseaufzeichnung: Brakka - Forever
Stufe 18 Orc Kriegerin, Horde

Reisestatistiken
- Tode: 4
- Gelaufene Meter: 900
- Foes slain: 12

Gelaufene Meter, nach Land
Durotar: 600, Die Brachlande: 300

Getötete Feinde, nach Art
Wildtier: 9, Humanoid: 3
`);
  assert.deepEqual({ ...de.stats, time: [], killers: [], patrons: [], inns: [], destinations: [] },
    { yards: 900, slain: 12, elites: 0, rares: 0, deaths: 4, recorded: 0, played: null,
      walk: [{ zone: "Durotar", yards: 600 }, { zone: "Die Brachlande", yards: 300 }],
      kinds: [{ kind: "Wildtier", n: 9 }, { kind: "Humanoid", n: 3 }],
      ride: 0, swim: 0, flown: 0, flights: 0, flownTo: 0, boats: 0, fish: 0, days: 0, best: 0, words: 0, heard: 0,
      time: [], killers: [], patrons: [], inns: [], destinations: [] });
  // LOR-262's lines come after the six, read by their words only: an unknown one after them is skipped.
  const late = parseRecord("Journey record: Aelric - Forever\n\nJourney stats\n- Yards walked: 10\n- Foes slain: 2\n" +
    "- Elites slain: 0\n- Rares slain: 0\n- Deaths: 0\n- Hours recorded: 1.0\n- Yards ridden: 7\n- Something new: 3\n" +
    "- Fish caught: 4\n");
  assert.deepEqual([late.stats.ride, late.stats.fish, late.stats.played], [7, 4, null]);
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

test("journey stats: odd values are capped, never trusted", () => {
  const d = parseRecord(`Journey record: Aelric - Forever

Journey stats
- Yards walked: 99999999999
- Foes slain: 12
- Hours played: lots

Yards walked, by land
${Array.from({ length: 60 }, (_, i) => `Land ${i}: ${i + 1}`).join(", ")}
`);
  assert.equal(d.stats.yards, 0);
  assert.equal(d.stats.slain, 12);
  assert.equal(d.stats.played, null);
  assert.equal(d.stats.walk.length, 40);
});
