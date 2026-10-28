// The player's own Azeroth Survivors build (lib/survivors-build.js, LOR-853): what Willo's app read of their save is
// named from the live game's own tables, and the run she saw is told beside it. Run: node --test 'site/tests/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { survivorsOf, buildBlock, BUILD_MAX_BYTES } from "../lib/survivors-build.js";
import { SURVIVORS_LIVE } from "../lib/survivors-live.js";

const has = (block, text) => block.toLowerCase().includes(String(text).toLowerCase());

test("their save's talents, gear, zones and perks are named for the class they play, and the run beside them", () => {
  const [arms] = SURVIVORS_LIVE.talents.Warrior, [first, second] = arms.talents;
  const perk = SURVIVORS_LIVE.perks[0], ring = SURVIVORS_LIVE.rings[0];
  const sent = { save: { pick: { class: 1, race: 1, zone: "wsg" },
    // 11,560 talent experience is 34 points (a real save's, all 34 spent).
    classes: { 1: { xp: 11560, talents: [[first.id, first.ranks], [second.id, 1]], equip: [[0, 101010], [6, 101400]],
      beat: ["elwynn", "duskwood"], open: "wsg" }, 8: { xp: 300, talents: [] } },
    seen: [[ring.id, 4]], perks: [[perk.id, 1]], stats: { runs: 14, wins: 7 } },
    run: { level: 14, clock: 580, age: 30, spells: [{ name: "Cleave", rank: 3 }], jewelry: [] } };
  const block = buildBlock(survivorsOf(sent), "which card should I take?");
  assert.match(block, /^THEIR BUILD/);
  for (const text of ["Human Warrior", "34 talent points", `${first.name} ${first.ranks}/${first.ranks}`, `${second.name} 1/${second.ranks}`,
    "head Uncommon", "legs Common", "Elwynn Forest", perk.name, ring.name, "Mage", "level 14", "9:40", "Cleave rank 3"]) {
    assert.ok(has(block, text), text);
  }
  // The question names their other class: that one's build is the one told (300 experience: points of 80, 95, 110).
  assert.ok(has(buildBlock(survivorsOf(sent), "what should my mage take?"), "Mage: 3 talent points"));
  assert.ok(new TextEncoder().encode(block).length <= BUILD_MAX_BYTES);
  assert.equal(buildBlock(survivorsOf({ save: "not a save" }), "x"), "");
});
