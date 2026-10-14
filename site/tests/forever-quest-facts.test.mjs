// Quest and NPC facts (lib/forever-quest-facts.js): which questions get which quests and NPCs. The data itself is
// generated (pipeline/lore/quest_places.py); these check the lookup, using quests and NPCs that won't go away.
// Run: node --test 'site/tests/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { questFacts, questBlock } from "../lib/forever-quest-facts.js";

const titles = facts => facts.map(f => f.title);

test("a quest named in the question, even misheard, gets its facts; so does the quest in the log it asks about", () => {
  assert.deepEqual(titles(questFacts({ question: "who gave me the quest for retrieval for maren?", faction: "Alliance",
    level: "30" })), ["Quest: Retrieval for Mauren"]);
  const brill = questFacts({ question: "Where does this go?", zone: "Tirisfal Glades", level: "7", faction: "Horde",
    quests: [{ title: "At War With The Scarlet Crusade", id: "427" }] });
  assert.deepEqual(titles(brill), ["Quest: At War With The Scarlet Crusade"]);
  assert.match(brill[0].text, /Executor Zygand in Brill, Tirisfal Glades/);
  assert.match(brill[0].text, /Scarlet Warrior/);
  assert.ok(brill.every(f => f.asked));
});

test("an NPC named in the question gets where it stands", () => {
  const f = questFacts({ question: "Where is Shari Stilwell?" });
  assert.deepEqual(titles(f), ["NPC: Shari Stilwell"]);
  assert.match(f[0].text, /Brill, Tirisfal Glades \(\d+, \d+\)/);
});

test("lore questions and questions about something else get no quest facts, so they keep their look-up", () => {
  for (const question of ["Who leads the Defias Brotherhood?", "Tell me about Brill.", "I wanted to ask about the war.",
    "How do I get Berserker Stance?", "Where can I learn cooking?", "Willow, where can I buy a better sword?",
    "what drops linen cloth", "where do I go to train skinning"])
    assert.deepEqual(titles(questFacts({ question, target: "Innkeeper Renee", quests: [{ title: "At War With The Scarlet Crusade", id: "427" }] })), [],
      question);
});

test("a log quest's targets by name, a quest target by name, and the player's own faction's givers", () => {
  assert.deepEqual(titles(questFacts({ question: "where are the scarlet warriors", faction: "Horde",
    quests: [{ title: "At War With The Scarlet Crusade", id: "427" }] })),
  ["Quest: At War With The Scarlet Crusade", "NPC: Scarlet Warrior"]);
  assert.deepEqual(titles(questFacts({ question: "where's Hogger?" })), ["NPC: Hogger"]);
  const islander = questFacts({ question: "Who gives the quest The Islander?", faction: "Alliance", level: "30" });
  assert.doesNotMatch(islander[0].text, /Torm Ragetotem|Sorek/);
  assert.match(islander[0].text, /Kelv Sternhammer|Wu Shen/);
  assert.deepEqual(questFacts({ question: "Where is Shari Stilwell?" }, { character: true }), []);
});

test("the block stays within its budget", () => {
  const facts = questFacts({ question: "what do I need to kill for these quests?", quests: ["370", "371", "372", "427"]
    .map(id => ({ id, title: "At War With The Scarlet Crusade" })) });
  assert.ok(new TextEncoder().encode(questBlock(facts)).length <= 1800);
});
