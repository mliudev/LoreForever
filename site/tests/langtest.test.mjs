// lib/langtest.js: Lua escaping, which edits go in a test pack, and the zip. Run: node --test site/tests/
// (pipeline/tests/test_langtest.py also runs the escaping through real Lua, and lang_sim.py loads a pack in game.)
import test from "node:test";
import assert from "node:assert/strict";
import { selectEdits } from "../lib/langtest.js";

const fp = { english: "v1", entries: { "npc:hogger": ["10,20", "npcs_01"], "zone:elwynn": ["5,6", "zones_01"] } };
const english = { "ui/0123456789": "Zone hints", "npc:hogger/s": "Hogger is a gnoll.", "npc:hogger/kw": "hogger",
  "zone:elwynn/n": "Elwynn Forest" };

test("selectEdits keeps the latest current edit of each string and counts stale ones", () => {
  const edits = [
    { id: 1, string_id: "npc:hogger/s", en: "Hogger is a gnoll.", text: "Alt.", updated: "2026-10-01T10:00" },
    { id: 2, string_id: "npc:hogger/s", en: "Hogger is a gnoll.", text: "Hogger ist ein Gnoll. Mehr.", updated: "2026-10-01T11:00" },
    { id: 3, string_id: "ui/0123456789", en: "Zone hints", text: "Zonenhinweise", updated: "2026-10-01T10:00" },
    { id: 4, string_id: "zone:elwynn/n", en: "Elwynn (old English)", text: "Wald", updated: "2026-10-01T10:00" },
    { id: 5, string_id: "npc:gone/s", en: "x", text: "y", updated: "2026-10-01T10:00" },
    { id: 6, string_id: "npc:hogger/kw", en: "hogger", text: "   ", updated: "2026-10-01T10:00" },
  ];
  const s = selectEdits(edits, english, fp);
  assert.equal(s.included, 2);
  assert.equal(s.stale, 2);
  assert.deepEqual(s.ui, { "Zone hints": "Zonenhinweise" });
  assert.deepEqual(s.entries, { "npc:hogger": { fp: "10,20", strings: { s: "Hogger ist ein Gnoll. Mehr.", h: "Hogger ist ein Gnoll." } } });
});
