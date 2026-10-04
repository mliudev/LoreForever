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
    { name: "Westfall Gloves", quality: 2, reward: true, sub: "Sentinel Hill", zone: "Westfall" },
  ]);
  assert.deepEqual(d.levels, [{ level: 24, zone: "Wetlands" }]);
  assert.deepEqual(d.spells, [{ name: "Bear Form" }]);
  assert.deepEqual(d.mounts, [{ name: "Striped Nightsaber", zone: "Darnassus" }]);
  assert.deepEqual(d.profs, [{ name: "Herbalism", rank: 150 }]);
  assert.deepEqual(d.rep, [{ faction: "Darnassus", standing: "Honored" }]);
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
  assert.deepEqual(de.rep, [{ faction: "Orgrimmar", standing: "Wohlwollend" }]);
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
