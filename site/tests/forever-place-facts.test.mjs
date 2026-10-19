// Town and road facts (lib/forever-place-facts.js): which questions get a town's services or the way to a zone. The
// towns are generated (pipeline/lore/town_services.py); these use the accuracy lab's failures (10/16), with places
// that won't go away. Run: node --test 'site/tests/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { placeFacts, placeBlock, PLACE_FACTS_MAX_BYTES } from "../lib/forever-place-facts.js";
import { DUNGEONS, ZONE_SIDES } from "../lib/dungeon-places.js";

const text = (question, context = {}) =>
  placeFacts({ question, faction: "Alliance", ...context }).map(f => f.text).join("\n");
const textAs = (faction, question, context = {}) =>
  placeFacts({ question, faction, ...context }).map(f => f.text).join("\n");

test("a town's service: who and where, in the town named or where they stand", () => {
  assert.match(text("Hey Willow, where's the Battle Master in Stormwind?", { zone: "Stormwind City" }),
    /Stormwind City has 3 battlemasters: Thelman Slatefist <Alterac Valley Battlemaster> in Stormwind Keep \(\d+, \d+\)/);
  assert.match(text("Where is the hunter trainer in Stormwind?", { zone: "Stormwind City", sub: "Trade District" }),
    /hunter trainers: Einris Brightspear in the Dwarven District/);
  assert.match(text("Is there a mailbox in Lakeshire?", { zone: "Redridge Mountains" }), /Lakeshire.* has a mailbox \(\d+, \d+\)/);
  assert.match(text("where can I learn mining?", { zone: "Stormwind City", sub: "Dwarven District" }), /Gelman Stonehand/);
  assert.ok(placeFacts({ question: "is there a bank in Booty Bay?" }).every(f => f.asked));
});

test("a town without it says so, what it has, and the nearest that has it, with the way there", () => {
  const redridge = text("is there a bank in redridge?", { zone: "Ironforge" });
  assert.match(redridge, /^No town in the Redridge Mountains has a bank\. The nearest: Stormwind City has a bank in the Trade District, with bankers /);
  assert.match(redridge, /into Elwynn Forest, then northwest through the city gates/);
  assert.match(text("is there a bank in Lakeshire?", { zone: "Redridge Mountains" }),
    /Lakeshire, in the Redridge Mountains, has no bank\. Lakeshire has an inn \(Innkeeper Brianna/);
});

test("the way to a zone: the roads and passes, and the flight, ship or tram that saves the walk", () => {
  const alterac = text("How do I get to Alterac?", { zone: "Wetlands", sub: "Menethil Harbor" });
  assert.match(alterac, /fly from Menethil Harbor to Southshore/);
  assert.match(alterac, /Without flying: take the ship Serenity's Shore from Menethil Harbor to Southshore/);
  assert.match(alterac, /On foot instead: go north over the Thandol Span into the Arathi Highlands, west .* into the Hillsbrad Foothills, then north .* into the Alterac Mountains/);
  // Misheard by speech ("m lock mod"), from Stormwind: without flying, the tram first.
  assert.match(text("How do I get to m lock mod from here, Willow?", { zone: "Stormwind City" }),
    /Without flying: take the Deeprun Tram from Stormwind City to Ironforge, .* into Dun Morogh, then east .* into Loch Modan/);
  // Next door on foot, and the new flight straight there.
  assert.match(text("How do I get to the Riverglades from here?", { zone: "Redridge Mountains", sub: "Lakeshire" }),
    /Blackrock Pass.* Or fly from Lakeshire to Farholde Keep/);
  // A town the ship lands in: the ship, not the road across its zone.
  assert.match(text("How do I get to Ratchet from Ironforge?", { zone: "Ironforge" }), /the goblin ship from Booty Bay to Ratchet/);
  // The other side's zeppelins and flights aren't on an Alliance player's way.
  assert.doesNotMatch(text("how do I get to Durotar?", { zone: "Tirisfal Glades" }), /zeppelin|Undercity/);
});

test("each fact names its sources, so typed research it answers is answered from it (LOR-614)", () => {
  const urls = (question, context) => placeFacts({ question, faction: "Alliance", ...context })
    .flatMap(f => f.sources.map(s => s.url));
  assert.ok(urls("Is there a bank in Booty Bay?", {}).includes("https://github.com/vmangos/core"));
  const alterac = urls("How do I get to Alterac?", { zone: "Wetlands", sub: "Menethil Harbor" });
  assert.ok(alterac.includes("https://warcraft.wiki.gg/wiki/Alterac_Mountains_(Classic)"), alterac.join(" "));
  assert.ok(alterac.includes("https://wago.tools/db2/TaxiPath") && alterac.includes("https://wago.tools/db2/TaxiPathNode"));
});

test("no facts for questions about something else, nor for a character's reply", () => {
  assert.equal(text("Who leads the Defias Brotherhood?", { zone: "Wetlands" }), "");
  // Fray Island is a place now, by name or as speech hears it (the gold set, 10/18: "the Frey Allen").
  assert.match(text("How do I get to the Frey Allen from here?", { zone: "Ironforge" }),
    /to Fray Island: .*goblin ship from Booty Bay to Ratchet.*south of Ratchet/);
  // A question about a place gets its card, as background: it doesn't answer the question, so look-ups still run.
  assert.ok(placeFacts({ question: "Tell me about the Wetlands.", zone: "Wetlands", faction: "Alliance" }).every(f => !f.asked));
  assert.deepEqual(placeFacts({ question: "where is the bank?", zone: "Stormwind City" }, { character: true }), []);
});

test("the block stays within its bound", () => {
  const facts = placeFacts({ question: "where can I learn tailoring and alchemy?", zone: "Ironforge", faction: "Alliance" });
  assert.ok(new TextEncoder().encode(placeBlock([...facts, ...facts, ...facts])).length <= PLACE_FACTS_MAX_BYTES);
});

// LOR-670 (answer log 10/18): an Alliance warrior in Arathi asked the way to the Scarlet Monastery and was sent through
// the Undercity and offered the Sepulcher's flight point, both Horde.
test("the way to a dungeon goes round the other side's land, to the nearest flight point that is the asker's own", () => {
  const sm = text("Hey Willow, how do I get to the Scarlet Monastery?", { zone: "Arathi Highlands", sub: "Refuge Pointe" });
  assert.match(sm, /fly from Southshore to Chillwind Camp in the Western Plaguelands, then west through the Bulwark into Tirisfal Glades/);
  assert.match(sm, /The Scarlet Monastery is in the northeast corner of Tirisfal Glades/);
  assert.match(sm, /Tirisfal Glades is Horde land, where the guards attack Alliance players on sight/);
  assert.doesNotMatch(sm, /Undercity|Sepulcher|zeppelin|Silverpine|Ruins of Lordaeron/);
  // The same road to the zone itself, and without flying (the walk keeps out of Silverpine too).
  assert.match(text("How do I get to Tirisfal Glades?", { zone: "Arathi Highlands" }), /Chillwind Camp.*Horde land/);
  assert.match(sm, /Without flying: .*into the Alterac Mountains.* into the Western Plaguelands, then west through the Bulwark/);
  // The Horde asker gets its own roads, and the Alliance's flights and ships are never offered to it.
  const stockade = textAs("Horde", "How do I get to the Stockade?", { zone: "Durotar" });
  assert.match(stockade, /Duskwood, Elwynn Forest and Stormwind City are Alliance land, where the guards attack Horde players on sight/);
  assert.match(stockade, /The Stockade is in Stormwind City, in the canal district/);
  assert.doesNotMatch(stockade, /Mistbound|Serenity|Proudmoore|Moonspray|Chillwind|Auberdine|Deeprun/);
  assert.match(textAs("Horde", "How do I get to the Scarlet Monastery?", { zone: "Orgrimmar" }), /zeppelin.*Brill/);
  assert.doesNotMatch(textAs("Horde", "How do I get to the Scarlet Monastery?", { zone: "Orgrimmar" }), /Horde land/);
  // A neutral town in their land (Ratchet) is safe; a dungeon in their zone is not; and the asker may not be known.
  assert.doesNotMatch(text("How do I get to Ratchet?", { zone: "Stormwind City" }), /land/);
  assert.match(text("How do I get to Wailing Caverns?", { zone: "Stormwind City" }), /The Barrens is Horde land/);
  assert.match(textAs("", "How do I get to the Scarlet Monastery?", { zone: "Orgrimmar" }),
    /Tirisfal Glades is Horde land, where the guards attack Alliance players on sight/);
  // Blackrock Mountain lies between two zones: the nearer one, from where the asker is.
  assert.match(text("How do I get to Blackrock Depths?", { zone: "Ironforge" }), /Thorium Point in Searing Gorge/);
  assert.match(text("how do I get to Upper Blackrock Spire", { zone: "Redridge Mountains" }), /into the Burning Steppes/);
});

test("every dungeon and raid of the original game can be asked for, by name or by the short name players use", () => {
  const original = ["Ragefire Chasm", "Wailing Caverns", "the Deadmines", "Shadowfang Keep", "Blackfathom Deeps", "the Stockade",
    "Gnomeregan", "Razorfen Kraul", "Razorfen Downs", "the Scarlet Monastery", "Uldaman", "Zul'Farrak", "Maraudon",
    "the Sunken Temple", "Blackrock Depths", "Blackrock Spire", "Dire Maul", "Stratholme", "Scholomance", "Molten Core",
    "Blackwing Lair", "Onyxia's Lair", "Zul'Gurub", "the Ruins of Ahn'Qiraj", "the Temple of Ahn'Qiraj", "Naxxramas"];
  const bare = name => name.replace(/^the /, "");
  for (const name of original) assert.ok(DUNGEONS.some(d => bare(d[0]) === bare(name)), `${name} is placed`);
  for (const [label, others, , where] of DUNGEONS) {
    const sentence = `${label[0].toUpperCase()}${label.slice(1)} ${where}.`;
    for (const name of [bare(label), ...others]) for (const [faction, zone] of [["Alliance", "Stormwind City"], ["Horde", "Orgrimmar"]]) {
      const facts = placeFacts({ question: `How do I get to ${name}?`, faction, zone });
      assert.equal(facts.length, 1, `${name} for ${faction}`);
      assert.ok(facts[0].text.includes(sentence), `${name}: ${facts[0].text}`);
      assert.ok(facts[0].sources.some(s => s.url.startsWith("https://warcraft.wiki.gg/wiki/")), name);
      assert.ok(new TextEncoder().encode(placeBlock(facts)).length <= PLACE_FACTS_MAX_BYTES, name);
    }
  }
  // Asked in the ways players put it.
  assert.match(text("Where is the entrance to the Deadmines?", { zone: "Elwynn Forest" }), /go west along the road west from Goldshire into Westfall\. The Deadmines are in southwestern Westfall/);
  assert.match(text("how do i enter wailing caverns", { zone: "The Barrens" }), /^Wailing Caverns is in the Barrens, south of the Crossroads/);
  assert.match(text("Which way to the stockades from Ironforge", { zone: "Dun Morogh" }), /^From Ironforge to the Stockade/);
  assert.match(text("How do I get from Stormwind to the Deadmines?", { zone: "Wetlands" }), /^From Stormwind City to the Deadmines/);
});

test("a dungeon's name in a question about something else gets no way, so its research isn't skipped", () => {
  for (const question of ["Where is the best loot in the Deadmines?", "What level is the Scarlet Monastery?",
    "How do I get to level 40 in the Scarlet Monastery?", "Who is the last boss in Shadowfang Keep?",
    "What drops from the boss in Uldaman and where do I turn it in?"])
    assert.equal(text(question, { zone: "Stormwind City" }), "", question);
});

test("who holds a zone is data/zone_factions.json's, in step with the table the routes use", () => {
  const json = JSON.parse(readFileSync(new URL("../../data/zone_factions.json", import.meta.url), "utf8"));
  // The file names zones by their first word ("elwynn", "stormwind"), and a few instances ("stockade") of its own.
  const slug = zone => zone.toLowerCase().replace(/^the /, "").replace(/[^a-z]/g, "");
  const instances = new Set(["deadmines", "gnomeregan", "hallofthanes", "stockade", "ragefire", "razorfenkraul",
    "ruinsoflordaeron", "shadowfang", "wailing"]);
  for (const [side, zones] of Object.entries(ZONE_SIDES)) {
    for (const zone of zones) {
      assert.ok(json[side.toLowerCase()].some(s => slug(zone).startsWith(s)), `${zone} isn't ${side}'s`);
      // Spelled as the roads spell it, so the route can tell whose land it is.
      assert.ok(placeFacts({ question: `How do I get to ${zone}?`, faction: "Alliance", zone: zone === "Ironforge" ? "Westfall" : "Ironforge" }).length, zone);
    }
    for (const s of json[side.toLowerCase()]) assert.ok(instances.has(s) || zones.some(z => slug(z).startsWith(s)), `${s} is ${side}'s`);
  }
});

test("riding: each people's own trainer, asked any way, with the way there", () => {
  // 10/18 live runs: "Where can I learn riding?" got Goldshire's warrior trainer, and a human was sent to Unger
  // Statforth, Bralla Cloudwing and Katie Hunter "at the Stormwind stables".
  const human = text("Where can I learn riding?", { zone: "Elwynn Forest", sub: "Goldshire", race: "Human", class: "Warrior" });
  assert.match(human, /Humans learn to ride .*Eastvale Logging Camp, in Elwynn Forest, has a riding trainer: Randal Hunter \(\d+, \d+\)/);
  assert.doesNotMatch(human, /warrior trainer|The way from/);
  assert.match(text("When can I get my first mount?", { zone: "Dun Morogh", race: "Dwarf" }), /Ultham Ironhorn/);
  assert.match(text("Where do I learn to ride?", { zone: "Elwynn Forest", race: "Gnome" }),
    /Binjy Featherwhistle .*The way from Elwynn Forest: /);
  assert.match(textAs("Horde", "where's the riding trainer", { zone: "Durotar", race: "Orc" }), /Kildar in the Valley of Honor/);
  assert.match(textAs("Horde", "Where can I learn riding?", { zone: "Tirisfal Glades", race: "Undead" }), /Velma Warnam/);
  // A people with no trainer known (the skyborne) gets the nearest, as before.
  assert.match(text("Where can I learn riding?", { zone: "Elwynn Forest", race: "Skyborne" }), /Randal Hunter/);
});

test("a place's card: a town's services and rides, a zone's levels, towns and borders", () => {
  // The gold set, 10/18: "Tell me about Brill." had none of its zeppelins, inn or trainers; "tell me more about
  // durotar" no levels, towns or borders.
  const brill = textAs("Horde", "Tell me about Brill.", { zone: "Tirisfal Glades" });
  assert.match(brill, /Brill is a Horde town in Tirisfal Glades \(levels \d+ to \d+\)/);
  assert.match(brill, /an inn \(Innkeeper Renee/);
  assert.match(brill, /zeppelin to the zeppelin tower outside Orgrimmar in Durotar/);
  const durotar = textAs("Horde", "tell me more about durotar", { zone: "Durotar" });
  assert.match(durotar, /Durotar is Horde land, for levels 1 to 10\. Its towns include .*Razor Hill/);
  assert.match(durotar, /borders the Barrens to the west/);
  assert.match(text("What level is Stranglethorn Vale?", { zone: "Elwynn Forest" }), /for levels \d+ to \d+.*Zul'Gurub/);
  assert.match(text("Tell me about Southshore", { zone: "Hillsbrad Foothills" }), /^Southshore is an Alliance town/);
  // Not a place, or a way there: no card.
  assert.equal(text("Tell me about Deathwing", { zone: "Wetlands" }), "");
  assert.doesNotMatch(text("How do I get to Brill?", { zone: "Silverpine Forest" }), /is a Horde town/);
});

test("one bank, auction house or inn however many work there; a town no side holds is open to both", () => {
  // The gold set, 10/18: "Booty Bay has 2 banks" was told as two banks, and the neutral port wasn't said to be open to
  // an Alliance player.
  const booty = text("Is there a bank in Booty Bay?", { zone: "Stranglethorn Vale" });
  assert.match(booty, /^Booty Bay, in Stranglethorn Vale \(open to both sides\), has a bank, with bankers Viznik Goldgrubber/);
  assert.match(text("Where is the auction house in Ironforge?", { zone: "Ironforge" }),
    /^Ironforge has an auction house, with Auctioneer Buckler \(\d+, \d+\)/);
});
