// Spell and talent facts (lib/forever-spell-facts.js): which questions get which spells, and that what they say comes from
// the data. The data itself is generated (pipeline/lore/spell_facts.py); these use spells whose numbers Forever changed
// and that won't go away. Run: node --test 'site/tests/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { spellFacts, spellBlock, SPELL_FACTS_MAX_BYTES, SPELL_SOURCES } from "../lib/forever-spell-facts.js";

const titles = facts => facts.map(f => f.title);
const ask = (question, cls = "", level = "", more = {}) => spellFacts({ question, class: cls, level: String(level), ...more });
const text = facts => facts.map(f => f.text).join("\n");

test("a seal's duration for a paladin is Forever's, 30 seconds, at the rank their level has", () => {
  // Mike's case: the model said the original game's numbers for Seal of Righteousness.
  const facts = ask("How long does Seal of Righteousness last?", "Paladin", 8);
  assert.deepEqual(titles(facts), ["Spell: Seal of Righteousness"]);
  assert.match(facts[0].text, /rank 1 of 8, learned at level 1\): lasts 30 sec/);
  // They count as answering the question (no quick look-up), with the records as sources.
  assert.ok(facts.every(f => f.asked && f.sources === SPELL_SOURCES));
  // A higher level has a higher rank, and the top rank's differences come beside it.
  assert.match(text(ask("How long does Seal of Righteousness last?", "Paladin", 40)), /rank 5 of 8[^]*Top rank 8 \(level \d+\): \d+ mana/);
});

test("what Forever changed is said with what the original game had, and renamed spells are found by the old name", () => {
  const might = text(ask("how long does blessing of might last", "Paladin", 30));
  assert.match(might, /lasts 1 hour/);
  assert.match(might, /Forever change: duration \(1\.12: 5 min\)/);
  assert.match(text(ask("what does holy strike do", "Paladin", 20)), /Not in the 1\.12 database/);
  const wall = text(ask("shield wall cooldown", "Warrior", 40));
  assert.match(wall, /12 sec; 15 min cooldown/);
  assert.match(wall, /cooldown \(1\.12: 30 min\)/);
  // Curse of Agony is Bane of Agony now.
  const agony = ask("how long does curse of agony last", "Warlock", 40);
  assert.deepEqual(titles(agony), ["Spell: Bane of Agony"]);
  assert.match(agony[0].text, /lasts 24 sec/);
  assert.match(agony[0].text, /original game's name was Curse of Agony/);
  // Judgment, short forms, plurals and a "the".
  assert.deepEqual(titles(ask("What does Judgment of Light do?", "Paladin", 40)), ["Spell: Judgement of Light"]);
  assert.deepEqual(titles(ask("How long does SoR last?", "Paladin", 20)), ["Spell: Seal of Righteousness"]);
  assert.deepEqual(titles(ask("how long does curse of elements last", "Warlock", 30)), ["Spell: Curse of the Elements"]);
  assert.deepEqual(titles(ask("what does frostbolts do", "Mage", 30)), ["Spell: Frostbolt"]);
});

test("a word that is also plain English counts only for the class that has the spell", () => {
  assert.deepEqual(titles(ask("how does rend work", "Warrior", 12)), ["Spell: Rend"]);
  assert.deepEqual(titles(ask("how does rend work", "Mage", 12)), []);
  // A racial for the player's own people, or the ones the question names.
  assert.deepEqual(titles(ask("how long does Blood Fury last", "Warrior", 20, { race: "Orc" })), ["Spell: Blood Fury"]);
  assert.deepEqual(titles(ask("how long does Blood Fury last", "Warrior", 20, { race: "Human" })), []);
});

test("a kind of spell the class has, or its abilities, come as a short list when they fit", () => {
  const seals = ask("what does my seal do", "Paladin", 30);
  assert.equal(seals.length, 1);
  assert.match(seals[0].text, /Seal of Righteousness \(lasts 30 sec/);
  assert.ok(new TextEncoder().encode(seals[0].text).length < 700);
  // "The seal" with two learned is both; with one, that one.
  assert.match(text(ask("how long does the seal last", "Paladin", 8)), /Seal of Righteousness \(lasts 30 sec[^]*Seal of the Crusader/);
  assert.deepEqual(titles(ask("how long does the seal last", "Paladin", 2)), ["Spell: Seal of Righteousness"]);
  assert.match(text(ask("which paladin abilities do I have", "Paladin", 12)), /Hammer of Justice 8/);
  // No level, no list of everything.
  assert.deepEqual(ask("which paladin abilities do I have", "Paladin"), []);
});

test("lore questions, a character's reply and a question about something else get none", () => {
  for (const question of ["Who is Uther?", "Tell me about the history of Ironforge.", "Who is Thrall?", "Where am I?",
    "Where can I buy a better sword?", "How do I get to the Frey Allen from here?", "What happened to the Lightbringer?"])
    assert.deepEqual(titles(ask(question, "Paladin", 30)), [], question);
  assert.deepEqual(spellFacts({ question: "How long does Seal of Righteousness last?", class: "Paladin" }, { character: true }), []);
  // An item that is called by a spell's one word is the item.
  assert.deepEqual(titles(spellFacts({ question: "What's the proc chance for Shoney's disarm?", class: "Warrior", level: "30" },
    { claimed: ["Item: Shoni's Disarming Tool"] })), []);
  // Where to learn one isn't in the records: the facts come, but the question keeps its quick look-up.
  const where = ask("How do I get Cat Form?", "Druid", 18);
  assert.deepEqual(titles(where), ["Spell: Cat Form"]);
  assert.ok(where.every(f => !f.asked));
  // Nor is whether it's any good.
  assert.ok(ask("Is Seal of Righteousness good for leveling?", "Paladin", 20).every(f => !f.asked));
  assert.ok(ask("How long does Seal of Righteousness last, is it good?", "Paladin", 20).every(f => f.asked));
});

test("a short follow-up about a spell is about the one before it", () => {
  const before = { previousQuestion: "Tell me about Seal of Command" };
  assert.deepEqual(titles(ask("How long does it last?", "Paladin", 20, before)), ["Spell: Seal of Command"]);
  assert.deepEqual(titles(ask("What about its cooldown?", "Paladin", 20, before)), ["Spell: Seal of Command"]);
  assert.deepEqual(titles(ask("How do I get to Ironforge from here?", "Paladin", 20, before)), []);
  assert.deepEqual(titles(ask("How long does it last?", "Paladin", 20, { previousQuestion: "Who is Uther?" })), []);
});

test("the block stays within its bound, however many spells and however long their text", () => {
  const questions = ["Compare Seal of Righteousness, Seal of Command and Seal of Justice.",
    "What do Frostbolt, Fireball, Arcane Missiles and Polymorph cost and last?",
    "Tell me about Mortal Strike, Bloodthirst, Whirlwind and Shield Wall.",
    "What are troll racials?", "what does my seal do", "Tell me everything about Blessing of Kings, Blessing of Might and Blessing of Wisdom."];
  for (const [i, question] of questions.entries()) {
    const facts = ask(question, ["Paladin", "Mage", "Warrior", "Hunter", "Paladin", "Paladin"][i], 60, { race: "Troll" });
    const block = spellBlock(facts);
    assert.ok(facts.length > 0, question);
    assert.match(block, /^SPELL FACTS/);
    assert.ok(new TextEncoder().encode(block).length <= SPELL_FACTS_MAX_BYTES, `${question}: ${new TextEncoder().encode(block).length}`);
  }
  assert.equal(spellBlock([]), "");
});
