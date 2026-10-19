// Item, recipe and profession facts (lib/forever-item-facts.js): which questions get which items, and that what they
// say comes from the data. The data itself is generated (pipeline/lore/item_facts.py); these use items, recipes and
// trainers that won't go away. Run: node --test 'site/tests/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { itemFacts, itemBlock, skillNumber, ITEM_FACTS_MAX_BYTES } from "../lib/forever-item-facts.js";

const titles = facts => facts.map(f => f.title);
const ask = (question, more = {}) => itemFacts({ question, faction: "Alliance", ...more });

test("an item named in the question gets its facts, however speech or the player wrote it", () => {
  assert.deepEqual(titles(ask("Hey Willow, where can I find uh Blood Scalp Tusks?")), ["Item: Bloodscalp Tusk"]);
  assert.deepEqual(titles(ask("Where can I learn to make runecloth bandages?")), ["Item: Runecloth Bandage"]);
  assert.deepEqual(titles(ask("Hey Willow, what's the proc chance for Shoney's disarm?")), ["Item: Shoni's Disarming Tool"]);
  // Forever renamed it; the name players remember still finds it.
  const giants = ask("What does Elixir of the Giants do?");
  assert.equal(giants[0].title, "Item: Elixir of Greater Strength");
  assert.match(giants[0].text, /once called Elixir of Giants/);
  assert.match(giants[0].text, /Strength by 25/);
  // A family, lowest tier first, and a list sharing its first word.
  assert.deepEqual(titles(ask("What do I need blasting powder for?")),
    ["Item: Rough Blasting Powder", "Item: Coarse Blasting Powder", "Item: Heavy Blasting Powder"]);
  assert.deepEqual(titles(ask("Hey Willow, what is elemental water, air, and fire useful?")),
    ["Item: Elemental Water", "Item: Elemental Air", "Item: Elemental Fire"]);
  // An ore by its metal.
  assert.deepEqual(titles(ask("Hey Willow, where do I go to mine silver?")), ["Item: Silver Ore"]);
  assert.ok(ask("What is swiftthistle used for?").every(f => f.asked));
});

test("the question before it counts too: what speech misheard there may be named right", () => {
  const f = ask("Where do I get the life fruit from?", { previousQuestion: "It says I need eight life root and thirty blood scalp tusks." });
  assert.deepEqual(titles(f).slice(0, 2), ["Item: Liferoot", "Item: Bloodscalp Tusk"]);
});

test("what the facts say is the world's records: who makes it, how many, and the player's side's vendors", () => {
  const [bronze] = ask("How do I make a bronze bar?");
  assert.match(bronze.text, /made with Mining \(learned at 65[^)]*\) from 1 Copper Bar, 1 Tin Bar, making 2/);
  const [casing] = ask("What do I need to make a Mithril Casing?");
  assert.match(casing.text, /made with Engineering .* from 3 Mithril Bar/);
  assert.doesNotMatch(casing.text, /Blacksmithing \(/);
  // A recipe learned from a manual brings the manual, with who sells it on the player's side.
  const silk = ask("Where can I learn how to make heavy silk bandages, Willow.");
  assert.deepEqual(titles(silk), ["Item: Heavy Silk Bandage", "Item: Manual: Heavy Silk Bandage"]);
  assert.match(silk[1].text, /Deneb Walker in Stromgarde Keep, Arathi Highlands/);
  assert.doesNotMatch(silk[1].text, /Balai Lok'Wein/);
  assert.match(ask("Where can I learn how to make heavy silk bandages?", { faction: "Horde" })[1].text, /Balai Lok'Wein/);
  // Forever's own recipe: its Rough Bronze Shoulders take a Shadowgem.
  assert.match(ask("How do I make Rough Bronze Shoulders?")[0].text, /5 Bronze Bar, 1 Shadowgem/);
  assert.match(ask("What's the proc chance for Shoni's Disarming Tool?")[0].text, /how often isn't known/);
});

test("sellers are the player's own side's, in their town and zone first; quests say who gives them; cloth drops from people", () => {
  // 10/18: asked in Stormwind, Leaded Vials were sent to Gadgetzan and Lakeshire (Maria Lumere never made the list).
  const stormwind = { zone: "Stormwind City", sub: "Trade District", faction: "Alliance" };
  const vial = ask("Where can I find a leaded vial?", stormwind)[0].text;
  assert.match(vial, /sold by Maria Lumere in .*Stormwind City/);
  assert.doesNotMatch(vial.split(". used in")[0], /Gadgetzan|Lakeshire|Orgrimmar/);
  const horde = ask("Where can I find a leaded vial?", { zone: "Orgrimmar", faction: "Horde" })[0].text;
  assert.match(horde, /sold by [^.]*in Orgrimmar/);
  assert.doesNotMatch(horde.split(". used in")[0], /Stormwind|\(Alliance\)/);
  // A material that only goes into another one says what that is for.
  assert.match(ask("What is copper ore used for?")[0].text, /Copper Bar \(itself used in Blacksmithing, Engineering, and with Tin Bar into Bronze Bar\)/);
  // A quest it's needed for comes with who gives it, and where.
  assert.match(ask("tell me about those crocolisk skins")[0].text, /Crocolisk Hunting, given by Marek Ironheart in .*Loch Modan/);
  assert.match(ask("Where do I get linen cloth?", { zone: "Elwynn Forest" })[0].text, /level 9-25, mostly humanoids \(people\)/);
  // Gems with no stone named: the crafts that use them, and no Jewelcrafting.
  const gems = ask("What are gems for?");
  assert.deepEqual(titles(gems), ["Item: Gems"]);
  assert.match(gems[0].text, /Blacksmithing.*Jewelcrafting isn't one of the professions/);
});

test("a profession question gets its ranks and the trainers' recipes for that skill", () => {
  assert.equal(skillNumber("what's the best way to go from one twenty five blacksmithing to one fifty?"), 125);
  assert.equal(skillNumber("higher than one fifty"), 150);
  assert.equal(skillNumber("at a hundred and fifteen"), 115);
  assert.equal(skillNumber("I'm at 115 blacksmithing"), 115);
  const smith = ask("Hey Willow, what's the best way to go from one twenty five blacksmithing to one fifty?");
  assert.deepEqual(titles(smith), ["Profession: Blacksmithing"]);
  assert.match(smith[0].text, /Expert \(up to 225, from skill 125/);
  assert.match(smith[0].text, /recipes for Blacksmithing at 125/);
  const aid = ask("Where can I train my first aid skill higher than one fifty?");
  assert.deepEqual(titles(aid), ["Profession: First Aid", "Item: Expert First Aid - Under Wraps"]);
  assert.match(aid[1].text, /sold by Deneb Walker/);
});

test("lore questions, a character's reply and things that aren't items get no item facts", () => {
  for (const question of ["Who leads the Horde?", "Tell me about the Ashbringer.", "What happened to Shadowfang Keep?",
    "Who is Thrall?", "Tell me about the history of Ironforge.", "Who is VanCleef?", "Where is King Magni?",
    "I want to learn about the orcs.", "What city is that across the bay?", "Who are the Darkspear trolls?",
    "Where am I?", "How do I get Berserker Stance?", "Where can I buy a better sword?"])
    assert.deepEqual(titles(ask(question)), [], question);
  assert.deepEqual(itemFacts({ question: "How do I make a bronze bar?" }, { character: true }), []);
});

test("the block stays within its bound", () => {
  const block = itemBlock(ask("What do I need blasting powder for?"));
  assert.match(block, /^ITEM FACTS/);
  assert.ok(new TextEncoder().encode(block).length <= ITEM_FACTS_MAX_BYTES);
  assert.equal(itemBlock([]), "");
});

test("a seller in a capital says the district the town data places them in", async () => {
  // The gold set, 10/18: Maria Lumere's Leaded Vials were told "in the Trade District"; she's in the Mage Quarter.
  const { itemFacts } = await import("../lib/forever-item-facts.js");
  const text = itemFacts({ question: "Where can I find a leaded vial?", zone: "Stormwind City", faction: "Alliance" })
    .map(f => f.text).join("\n");
  assert.match(text, /Maria Lumere in Mage Quarter, Stormwind City \(56, 86\)/);
});
