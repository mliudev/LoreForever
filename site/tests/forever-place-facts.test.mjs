// Town and road facts (lib/forever-place-facts.js): which questions get a town's services or the way to a zone. The
// towns are generated (pipeline/lore/town_services.py); these use the accuracy lab's failures (10/16), with places
// that won't go away. Run: node --test 'site/tests/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeFacts, placeBlock, PLACE_FACTS_MAX_BYTES } from "../lib/forever-place-facts.js";

const text = (question, context = {}) =>
  placeFacts({ question, faction: "Alliance", ...context }).map(f => f.text).join("\n");

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
  assert.match(redridge, /^No town in the Redridge Mountains has a bank\. The nearest: Stormwind City has 3 banks/);
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
  for (const question of ["Tell me about the Wetlands.", "Who leads the Defias Brotherhood?", "How do I get to Fray Island?"])
    assert.equal(text(question, { zone: "Wetlands" }), "", question);
  assert.deepEqual(placeFacts({ question: "where is the bank?", zone: "Stormwind City" }, { character: true }), []);
});

test("the block stays within its bound", () => {
  const facts = placeFacts({ question: "where can I learn tailoring and alchemy?", zone: "Ironforge", faction: "Alliance" });
  assert.ok(new TextEncoder().encode(placeBlock([...facts, ...facts, ...facts])).length <= PLACE_FACTS_MAX_BYTES);
});
