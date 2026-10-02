// lib/langtest.js: Lua escaping, which edits go in a test pack, and the zip. Run: node --test site/tests/
// (pipeline/tests/test_langtest.py also runs the escaping through real Lua, and lang_sim.py loads a pack in game.)
import test from "node:test";
import assert from "node:assert/strict";
import { crc32, hook, luaString, packZip, renderPack, selectEdits } from "../lib/langtest.js";

test("luaString escapes what Lua needs and keeps UTF-8", () => {
  assert.equal(luaString('a "b" \\ c'), '"a \\"b\\" \\\\ c"');
  assert.equal(luaString("one\ntwo\r\tend"), '"one\\ntwo\\r\\tend"');
  assert.equal(luaString("\u0000" + "1"), '"\\0001"');   // three digits, so the 1 stays a 1
  assert.equal(luaString("\u0007\u007f"), '"\\007\\127"');
  assert.equal(luaString("Grüße ]] [[ |cff00ff00x|r"), '"Grüße ]] [[ |cff00ff00x|r"');
  assert.equal(luaString("\ud800"), '"�"');
  assert.equal(luaString(undefined), '""');
});

test("hook matches compile_lua.hook", () => {
  assert.equal(hook("Erster Satz. Zweiter Satz."), "Erster Satz.");
  const long = "Wort ".repeat(40).trim() + ".";
  const h = hook(long);
  assert.ok(h.endsWith("...") && Array.from(h).length <= 113 && !h.includes("Wort...W"));
});

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

test("renderPack writes a TOC and Lua files the add-on reads", () => {
  const s = selectEdits([{ id: 1, string_id: "npc:hogger/s", en: "Hogger is a gnoll.", text: 'Er sagt "Hallo"\nund geht.' }], english, fp);
  const files = renderPack(s, { locale: "deDE", english: "v1", interface: "16001", languageName: "Deutsch", built: "2026-10-01 12:00 UTC" });
  const toc = files["LoreForever_LangTest_deDE.toc"];
  assert.match(toc, /^## X-LoreForever-Pack: lang-overlay$/m);
  assert.match(toc, /^## X-LoreForever-Locale: deDE$/m);
  assert.match(toc, /^## Dependencies: LoreForever$/m);
  assert.match(toc, /^UI\.lua\nStrings_1\.lua\n$/m);
  assert.match(files["Strings_1.lua"], /^P\.strings\["npc:hogger\/s"\] = "Er sagt \\"Hallo\\"\\nund geht\."$/m);
  assert.match(files["Strings_1.lua"], /^P\.fp\["npc:hogger"\] = "10,20"$/m);
});

test("zip is a valid stored zip with every file in the pack folder", () => {
  const s = selectEdits([], english, fp);
  const z = packZip(s, { locale: "deDE", english: "v1", interface: "16001" }, new Date(Date.UTC(2026, 0, 1)));
  const v = new DataView(z.buffer);
  const end = z.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const names = [];
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(at, true), 0x02014b50);
    const n = v.getUint16(at + 28, true);
    names.push(new TextDecoder().decode(z.slice(at + 46, at + 46 + n)));
    at += 46 + n;
  }
  assert.deepEqual(names, ["LoreForever_LangTest_deDE/LoreForever_LangTest_deDE.toc", "LoreForever_LangTest_deDE/UI.lua"]);
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});
