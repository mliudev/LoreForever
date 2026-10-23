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
// Her lines are checked for what they carry (the pin, the place, the character), not their wording.
const says = (text, ...facts) => { for (const f of facts) assert.ok(String(text).toLowerCase().includes(String(f).toLowerCase()),
  `${JSON.stringify(text)} should say ${f}`); };

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
  for (const q of ["What pins do I have?", "Where was that cave I pinned?", "show me my spots",
    "Where did I pin the fishing spot?", "When did I pin that cave?", "did I pin this spot already?"]) {
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
  const pinned = pinnedLine("I've pinned it for you! Want anything else?", call.pin);
  says(pinned, "Pinned", "Kobold den", "Fargodeep Mine", "The elite inside hits hard");
  assert.doesNotMatch(pinned, /anything else|"/);
  // Named for the place itself.
  const own = pinCall({ name: "notebook_pin", args: { name: "Fargodeep Mine" } }, tools, view, SPOT);
  says(pinnedLine("", own.pin), "Pinned", "Fargodeep Mine");
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
    says(pinnedLine("Done! I renamed it.", noted.pin), "Kobold den", "Fargodeep Mine");
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
  const spoken = pinsAnswer(view, { spoken: true });
  says(spoken, "six", "Húrin", "the elite cave", "Hogger's hill", "the murloc cave", "three more");
  assert.doesNotMatch(spoken, /Mor'Ladim|October/, "out loud: three and how many more");
  says(pinsAnswer(view), "the elite cave", "October 18", "the fishing spot");
  // Another character's pins are never this one's (the same chat or not).
  const brynn = pinsAnswer({ current: "char:Brynn-ClassicBetaPvE", pages: view.pages });
  says(brynn, "Brynn", "no pins");
  assert.doesNotMatch(brynn, /elite cave/);
  assert.deepEqual(["What pins do I have?", "list my pins", "how many pins do I have?"].map(q => pinIntent(q).list), [true, true, true]);
  assert.deepEqual(["Clear all my pins.", "remove every pin"].map(q => pinIntent(q).clearAll), [true, true]);
  assert.equal(pinIntent("Remove the cave pin.").clearAll, false);
  // Asked which of two, each by name and place, never the raw line or its numbers.
  const two = { current: "char:H-R", pages: { "char:H-R": { body: `## Pins\n- ${pinLine("the elite cave", "hits hard", SPOT)}\n- the murloc cave · Jangolode Mine, Westfall · October 9\n` } } };
  const which = pinsSaid(`Which one: ${pinLine("the elite cave", "hits hard", SPOT)}, or the murloc cave · Jangolode Mine, Westfall · October 9?`, two);
  says(which, "the elite cave", "Fargodeep Mine", "the murloc cave", "Jangolode Mine");
  assert.doesNotMatch(which, /·|41, 65/);
});

test("clearing all pins: her question's words, and only a yes to it clears", async () => {
  const { clearAsk, confirmsClear } = await import("../lib/willo-pins.js");
  const page = n => ({ current: "char:Húrin-R", pages: { "char:Húrin-R": { body: "## Pins\n" +
    Array.from({ length: n }, (_, i) => `- spot ${i} · Elwynn Forest · October ${i + 1}`).join("\n") + "\n" } } });
  for (const [n, count] of [[1, "one"], [2, "Húrin"], [6, "six"]]) says(clearAsk(page(n)), count, "yes");
  says(clearAsk(page(0)), "no pins");
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
  const elsewhere = clearReply(brynn, "Yes.", asked);
  assert.deepEqual(Object.keys(elsewhere), ["answer"], "nothing to write");
  says(elsewhere.answer, "haven't cleared", "Húrin", "Brynn");
  // Asked on Húrin, the pins cleared by hand in the Notebook tab before the yes: nothing to clear, and she says so.
  says(clearReply({ current: "char:Húrin-R", pages: {} }, "yes", asked).answer, "no pins");
  // Asked of "your" pins (no character), answered on Brynn with none.
  says(clearReply(brynn, "yes", "All six of your pins? Say yes and I'll take them off.").answer, "Brynn", "no pins");
  assert.deepEqual(Object.keys(clearReply(hurin, "No, keep them.", asked)), ["answer"], "a no writes nothing");
  assert.equal(clearReply(hurin, "what's the weather?", asked), null);
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
