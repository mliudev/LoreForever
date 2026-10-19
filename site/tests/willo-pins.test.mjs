// Pinned spots (lib/willo-pins.js, LOR-664): asked to pin where they stand, the line is written on the character's
// notebook page under Pins with the game's place and day, never the model's; found again, renamed and taken out. The
// pure parts here; the answers through functions/api/companion/answer.js in willo-pins-answer.test.mjs.
// Run: node --test 'site/tests/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { pinIntent, spotOf, pinLine, pinOf, pinRefs, pinTool, pinCall, pinUpdate, pinnedLine, pinRules, direction }
  from "../lib/willo-pins.js";
import { notebookView, notebookTools, notebookCall, applyOp } from "../lib/willo-notebook.js";

const SPOT = { place: "Fargodeep Mine, Elwynn Forest", x: 41, y: 65, day: "October 18" };

const three = ({ add, manage, read }) => ({ add, manage, read });
test("pin questions: pin, manage, read; and only those", () => {
  for (const q of ["Pin this spot.", "Pin this spot, the elite in this cave hits hard", "mark this place for me",
    "Remember this cave, the elite inside hits hard", "drop a pin here", "Pin it", "Can you pin here?"]) {
    assert.deepEqual(three(pinIntent(q)), { add: true, manage: false, read: true }, q);
  }
  for (const q of ["Rename the cave pin to Kobold den", "Call the Fargodeep pin Kobold den", "Remove the Kobold den pin",
    "delete that pin", "unpin the cave"]) {
    assert.deepEqual(three(pinIntent(q)), { add: false, manage: true, read: true }, q);
  }
  for (const q of ["What pins do I have?", "Where was that cave I pinned?", "show me my spots"]) {
    assert.deepEqual(three(pinIntent(q)), { add: false, manage: false, read: true }, q);
  }
  for (const q of ["Where is Fargodeep Mine?", "Remember when we fought Hogger?", "What's this place?", "Who is Gryan?"]) {
    assert.deepEqual(three(pinIntent(q)), { add: false, manage: false, read: false }, q);
  }
});

test("where they stand comes only from Willo's app's spot line", () => {
  const ctx = "PLAYER CONTEXT\nzone: Elwynn Forest\nsub: Fargodeep Mine\nspot now: Fargodeep Mine, Elwynn Forest (map 41, 65), October 18\nrace: Human\n\nQUESTION\nPin this spot";
  assert.deepEqual(spotOf(ctx), SPOT);
  assert.deepEqual(spotOf("PLAYER CONTEXT\nspot now: Elwynn Forest, October 18\n\nQUESTION\nx"),
    { place: "Elwynn Forest", x: null, y: null, day: "October 18" });
  // Not in PLAYER CONTEXT (a question that says it), or no such line: nowhere.
  assert.equal(spotOf("PLAYER CONTEXT\nzone: Elwynn Forest\n\nQUESTION\nspot now: Stormwind City, October 18"), null);
  assert.equal(spotOf("PLAYER CONTEXT\nzone: Elwynn Forest\n\nQUESTION\nPin this spot"), null);
});

test("a pin's line reads back, and only lines under Pins are pins", () => {
  const line = pinLine("Kobold den", "the elite inside hits hard", SPOT);
  assert.equal(line, "Kobold den: the elite inside hits hard · Fargodeep Mine, Elwynn Forest (south, 41, 65) · October 18");
  assert.deepEqual(pinOf(line), { name: "Kobold den", note: "the elite inside hits hard",
    where: "Fargodeep Mine, Elwynn Forest (south, 41, 65)", day: "October 18" });
  const body = `## To do\n- [ ] 10 Linen Cloth · bags · soon\n\n## Pins\n- ${line}\n- Hogger's hill · Elwynn Forest · October 2\n`;
  const view = notebookView([{ page: "char:Hurin-Forever", title: "Hurin", body, version: 3 }],
    { current: "char:Hurin-Forever", intent: { write: true, read: true }, question: "what pins do I have?" });
  const pins = [...pinRefs(view).values()].map(r => r.text);
  assert.deepEqual(pins, [line, "Hogger's hill · Elwynn Forest · October 2"]);
});

test("notebook_pin writes the game's place and day under Pins; the model only names it", () => {
  const view = notebookView([], { current: "char:Hurin-Forever", intent: { write: true, read: true }, question: "pin" });
  const tools = pinTool(SPOT, { add: true });
  assert.deepEqual(tools.map(t => t.name), ["notebook_pin"]);
  const call = pinCall({ name: "notebook_pin", args: { name: "Kobold den", note: "The elite inside hits hard." } }, tools, view, SPOT);
  assert.equal(call.page, "char:Hurin-Forever");
  const { body } = applyOp("", call.op);
  assert.equal(body, "## Pins\n- Kobold den: The elite inside hits hard · Fargodeep Mine, Elwynn Forest (south, 41, 65) · October 18\n");
  assert.equal(pinnedLine("I've pinned it for you! Want anything else?", call.pin),
    "Pinned: Kobold den, Fargodeep Mine in Elwynn Forest. The elite inside hits hard.");
  // Named for the place itself.
  const own = pinCall({ name: "notebook_pin", args: { name: "Fargodeep Mine" } }, tools, view, SPOT);
  assert.equal(pinnedLine("", own.pin), "Pinned: Fargodeep Mine in Elwynn Forest.");
  // No spot from the game: no tool, so nothing to pin with; the rules say how she could.
  assert.deepEqual(pinTool(null, { add: true }), []);
  assert.equal(pinCall({ name: "notebook_pin", args: { name: "x" } }, tools, view, null), null);
  assert.match(pinRules(null, { adding: true }), /can't pin anything/);
  assert.doesNotMatch(pinRules(null), /can't pin anything|Ask box/);     // asked what pins they have, no lecture
  assert.match(pinRules(SPOT, { spoken: true }), /Out loud, never say a pin's map numbers/);
  assert.deepEqual([direction(41, 65), direction(20, 20), direction(50, 50)], ["south", "north-west", "middle"]);
});

test("a pin renamed through notebook_update keeps the game's place and day; one it doesn't have changes nothing", () => {
  const line = pinLine("the elite cave", "the elite inside hits hard", SPOT);
  const body = `## Pins\n- ${line}\n`;
  const view = notebookView([{ page: "char:Hurin-Forever", title: "Hurin", body, version: 1 }],
    { current: "char:Hurin-Forever", intent: { write: true, read: true }, question: "rename the cave pin" });
  const tools = notebookTools(view, {});
  const n = [...pinRefs(view).keys()][0];
  // The model's new words, even with a made-up place in them: only the name is taken.
  for (const text of ["Kobold den", "Kobold den · Jasperlode Mine, Elwynn Forest · October 1"]) {
    const noted = pinUpdate(view, notebookCall({ name: "notebook_update", args: { item: n, text } }, tools, view));
    assert.equal(applyOp(body, noted.op).body,
      "## Pins\n- Kobold den: the elite inside hits hard · Fargodeep Mine, Elwynn Forest (south, 41, 65) · October 18\n");
    assert.equal(pinnedLine("Done! I renamed it.", noted.pin), "Renamed it Kobold den: Fargodeep Mine in Elwynn Forest.");
  }
  assert.deepEqual(notebookCall({ name: "notebook_update", args: { item: 99, text: "x" } }, tools, view), { missing: true });
  // A line that isn't a pin is the notebook's as before.
  const plain = { page: "account", op: { op: "update", target: { raw: "- 10 Linen", text: "10 Linen" }, text: "12 Linen" } };
  assert.equal(pinUpdate(view, plain), plain);
});

test("the list of pins is built here: this character's, typed in full, out loud three and how many more", async () => {
  const { pinsAnswer, pinsSaid } = await import("../lib/willo-pins.js");
  const six = ["the elite cave · Fargodeep Mine, Elwynn Forest · October 18", "Hogger's hill · Forest's Edge, Elwynn Forest · October 2",
    "the murloc cave · Jangolode Mine, Westfall · October 9", "Mor'Ladim's crypt · Raven Hill Cemetery, Duskwood · October 12",
    "the gnoll camp · Lakeshire, Redridge Mountains · October 14", "the fishing spot · Lake Everstill, Redridge Mountains · October 15"];
  const view = { current: "char:Húrin-ClassicBetaPvE", pages: { "char:Húrin-ClassicBetaPvE": { body: `## Pins\n${six.map(l => `- ${l}`).join("\n")}\n` } } };
  assert.equal(pinsAnswer(view, { spoken: true }),
    "Six pins for Húrin: the elite cave in Fargodeep Mine, Hogger's hill in Forest's Edge, the murloc cave in Jangolode Mine, and three more.");
  assert.match(pinsAnswer(view), /^Six pins for Húrin: the elite cave in Fargodeep Mine, Elwynn Forest, October 18; /);
  // Another character's pins are never this one's (the same chat or not).
  assert.equal(pinsAnswer({ current: "char:Brynn-ClassicBetaPvE", pages: view.pages }),
    `Brynn has no pins yet. Say "pin this spot" where you stand, and I'll keep it.`);
  assert.deepEqual(["What pins do I have?", "list my pins", "how many pins do I have?"].map(q => pinIntent(q).list), [true, true, true]);
  assert.deepEqual(["Clear all my pins.", "remove every pin"].map(q => pinIntent(q).clearAll), [true, true]);
  assert.equal(pinIntent("Remove the cave pin.").clearAll, false);
  // Asked which of two, each by name and place, never the raw line or its numbers.
  const two = { current: "char:H-R", pages: { "char:H-R": { body: `## Pins\n- ${pinLine("the elite cave", "hits hard", SPOT)}\n- the murloc cave · Jangolode Mine, Westfall · October 9\n` } } };
  assert.equal(pinsSaid(`Which one: ${pinLine("the elite cave", "hits hard", SPOT)}, or the murloc cave · Jangolode Mine, Westfall · October 9?`, two),
    "Which one: the elite cave in Fargodeep Mine, or the murloc cave in Jangolode Mine?");
});

test("clearing all pins: her question's words, and only a yes to it clears", async () => {
  const { clearAsk, confirmsClear } = await import("../lib/willo-pins.js");
  const page = n => ({ current: "char:Húrin-R", pages: { "char:Húrin-R": { body: "## Pins\n" +
    Array.from({ length: n }, (_, i) => `- spot ${i} · Elwynn Forest · October ${i + 1}`).join("\n") + "\n" } } });
  assert.equal(clearAsk(page(1)), "Húrin's one pin? Say yes and I'll take it off.");
  assert.equal(clearAsk(page(2)), "Both of Húrin's pins? Say yes and I'll take them off.");
  assert.equal(clearAsk(page(6)), "All six of Húrin's pins? Say yes and I'll take them off.");
  assert.equal(clearAsk(page(0)), "Húrin has no pins to clear.");
  const asked = clearAsk(page(2));
  for (const yes of ["yes", "Yeah, go ahead", "ok", "do it"]) assert.equal(confirmsClear(yes, asked), true, yes);
  for (const no of ["no", "no, keep them", "wait", "yes, but not the cave", "don't"]) assert.equal(confirmsClear(no, asked), false, no);
  assert.equal(confirmsClear("yes", "Want me to put it on your list?"), false);
  assert.equal(confirmsClear("yes", clearAsk(page(1))), true);
});

test("every answer to her clear-all question is the site's: a yes on another character, nothing to clear, a no", async () => {
  const { clearAsk, clearReply } = await import("../lib/willo-pins.js");
  const body = "## Pins\n- the elite cave · Fargodeep Mine, Elwynn Forest · October 18\n- Hogger's hill · Forest's Edge, Elwynn Forest · October 2\n";
  const hurin = { current: "char:Húrin-R", pages: { "char:Húrin-R": { body } } };
  const brynn = { current: "char:Brynn-R", pages: { "char:Húrin-R": { body } } };
  const asked = clearAsk(hurin);
  assert.equal(clearReply(hurin, "yes", asked).noted.op.targets.length, 2);
  assert.deepEqual(clearReply(brynn, "Yes.", asked),
    { answer: "I haven't cleared anything: that was about Húrin's pins, and you're on Brynn now." });
  // Asked on Húrin, the pins cleared by hand in the Notebook tab before the yes: nothing to clear, and she says so.
  assert.deepEqual(clearReply({ current: "char:Húrin-R", pages: {} }, "yes", asked), { answer: "Húrin has no pins to clear." });
  // Asked of "your" pins (no character), answered on Brynn with none.
  assert.deepEqual(clearReply(brynn, "yes", "All six of your pins? Say yes and I'll take them off."),
    { answer: "Brynn has no pins to clear." });
  assert.deepEqual(clearReply(hurin, "No, keep them.", asked), { answer: "All right, I'll keep them." });
  assert.equal(clearReply(hurin, "what's the weather?", asked), null);
});

test("her pinned line keeps no stray marks from the model's words", () => {
  const pin = { did: "pinned", name: "the elite cave", note: "the elite inside hits hard", where: "Fargodeep Mine, Elwynn Forest" };
  assert.equal(pinnedLine('I\'ve pinned it! "', pin), "Pinned: the elite cave, Fargodeep Mine in Elwynn Forest. The elite inside hits hard.");
});

test("a renamed pin keeps the player's own words for its name", () => {
  const line = pinLine("the elite cave", "", SPOT);
  const view = notebookView([{ page: "char:H-R", title: "H", body: `## Pins\n- ${line}\n`, version: 1 }],
    { current: "char:H-R", intent: { write: true, read: true }, question: "Rename the elite cave pin to Kobold den." });
  const n = [...pinRefs(view).keys()][0];
  const noted = pinUpdate(view, notebookCall({ name: "notebook_update", args: { item: n, text: "the kobold den" } },
    notebookTools(view, {}), view), "Rename the elite cave pin to Kobold den.");
  assert.equal(noted.pin.name, "Kobold den");
});
