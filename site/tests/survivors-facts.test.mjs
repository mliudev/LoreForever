// Azeroth Survivors (lib/survivors-facts.js): a question about that other game gets the live game's own numbers and
// none of WoW Forever's, and lore about survivors stays lore. Run: node --test 'site/tests/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { knowledgeFor, promptParts } from "../lib/forever-knowledge.js";
import { SURVIVORS_FACTS_MAX_BYTES } from "../lib/survivors-facts.js";
import { SURVIVORS_LIVE } from "../lib/survivors-live.js";

// The prompt as the companion writes it: the recent turns (a question, or a question and her answer), then the question.
const turn = t => (typeof t === "string" ? { player: t, willo: "Sure." } : t);
const prompt = (question, before = []) => `PLAYER CONTEXT\nzone: Elwynn Forest\nclass: Mage\n\nCONVERSATION\n` +
  `RECENT CONVERSATION (oldest first)\n${JSON.stringify(before.map(turn))}\n\nQUESTION\n${question}`;
// No database here: Forever's search fails and its other facts still come, as when D1 is down.
const known = (question, before) => knowledgeFor({}, promptParts(prompt(question, before)));

const has = (block, text) => block.toLowerCase().includes(String(text).toLowerCase());

test("a question about Azeroth Survivors gets the live game's numbers, and none of Forever's spells or talents", async () => {
  const { block, facts } = await known("In Azeroth Survivors, is Fireball or Frostbolt better on a mage?");
  assert.match(block, /^SURVIVORS FACTS/);
  for (const key of ["fireball", "frostbolt"]) {
    const s = SURVIVORS_LIVE.abilities[key];
    assert.ok(has(block, `${s.name} (Mage spell`) && has(block, `${s.damage} damage`), `${s.name}'s rank 1 damage`);
  }
  assert.doesNotMatch(block, /SPELL FACTS|FOREVER FACTS|TALENT/);
  assert.ok(facts.some(f => f.asked) && facts.every(f => f.sources?.length), "covered, with its source for the fold");
  // Without the game's name it's a Forever question, and Forever's spell facts answer it.
  assert.doesNotMatch((await known("Is Fireball or Frostbolt better on a mage?")).block, /SURVIVORS/);
});

test("its talents and boss clocks are the game's own", async () => {
  const titan = SURVIVORS_LIVE.talents.Warrior.flatMap(t => t.talents).find(t => t.name === "Titan");
  assert.ok(has((await known("azeroth survivors: is Titan worth it on a warrior?")).block, titan.text), "Titan's own text");
  const naxx = SURVIVORS_LIVE.zones.find(z => z.name === "Naxxramas");
  const { block } = await known("in azeroth survivors, when do the bosses come in Naxxramas?");
  for (const [boss, minute] of naxx.bosses) assert.ok(has(block, `${boss} at ${minute}:00`), boss);
});

test("a follow-up in a Survivors chat stays on Survivors while it's about the game, and only the player's words say so", async () => {
  const before = ["what's the best warlock build in azeroth survivors?"];
  // Long ones too: in the 10/27 baseline of players' own questions, 11 of 30 lost the game this way.
  for (const q of ["and which talent should I take first?", "which is better?",
    "after a few levels, which passive cards should I reroll or banish to keep my damage up?",
    "How do talents work, and how do I earn talent points?", "Can I play this on my phone or Android?",
    // Its zones share names with WoW's (Elwynn Forest, Duskwood, Feralas…) and stay its own.
    "is Feralas harder than Duskwood?"])
    assert.match((await known(q, before)).block, /^SURVIVORS FACTS.*the chat has been/s, q);
  // The rest of WoW gets Forever's facts again (Software Architect, 10/27: players rarely say "Forever").
  for (const q of ["where's the warlock trainer in Stormwind?", "ok, in WoW Forever what talents should a warlock take?",
    "which rank of Frostbolt does the mage trainer teach?", "is a Deadmines run worth it for a hunter?",
    "how do I get to Ironforge?", "what level should I be for Redridge?",
    "Can you tell me a little about the history of the Burning Legion and its demons?"])
    assert.doesNotMatch((await known(q, before)).block, /SURVIVORS/, q);
  // Her own answer naming the game doesn't make the chat about it.
  const hers = [{ player: "what's a good mage build?", willo: "In Azeroth Survivors, Blizzard and Frost Nova carry early." }];
  assert.doesNotMatch((await known("which is better?", hers)).block, /SURVIVORS/);
});

test("lore about survivors is not the game", async () => {
  for (const q of ["How many survivors of Lordaeron are still left?", "Who were the survivors of Theramore?",
    "Tell me about the survivors from the Third War"])
    assert.doesNotMatch((await known(q)).block, /SURVIVORS FACTS/, q);
});

test("the block stays within its bound, however much a question names", async () => {
  const L = SURVIVORS_LIVE, talents = Object.values(L.talents).flat().flatMap(t => t.talents);
  const names = [...Object.values(L.abilities), ...talents, ...L.zones, ...L.races, ...L.perks, ...L.rings, ...L.amulets].map(s => s.name).join(", ");
  const { block } = await known(`azeroth survivors: compare ${names}, every class, pickup, cooldowns, crit, bosses, gear, co-op and cards`);
  assert.ok(new TextEncoder().encode(block).length <= SURVIVORS_FACTS_MAX_BYTES);
});

test("a question asked over the game is about it without naming it, and WoW's still go to Forever", async () => {
  // The app saw Azeroth Survivors in front (its browser tab or download) when they asked: answer.py SURVIVORS_ON_SCREEN.
  const over = question => knowledgeFor({}, promptParts(`PLAYER CONTEXT\non screen: Azeroth Survivors\n\nQUESTION\n${question}`));
  for (const q of ["which of these three cards should I take?", "is this boss going to enrage?"])
    assert.match((await over(q)).block, /^SURVIVORS FACTS \(this question was asked over Azeroth Survivors.*a picture that comes with this question is of it/is, q);
  for (const q of ["how do I get to Ironforge?", "in WoW Forever, what talents should a warlock take?"])
    assert.doesNotMatch((await over(q)).block, /SURVIVORS/, q);
  // Without the line, the same question in a WoW game is Forever's.
  assert.doesNotMatch((await known("which of these three cards should I take?")).block, /SURVIVORS/);
});
