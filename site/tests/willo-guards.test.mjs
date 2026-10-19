// Willo's last checks in code (lib/willo-guards.js), on the 10/18 answer log's own answers.
import test from "node:test";
import assert from "node:assert/strict";
import { guardAnswer, evidenceOf } from "../lib/willo-guards.js";

const FACTS = "TOWN AND ROAD FACTS\n- Menethil Harbor, in the Wetlands, has a first aid trainer: Fremal Doohickey in the " +
  "Deepwater Tavern (11, 61).";

test("map coordinates nothing supplied gives come out, whole; supplied ones stay (LOR-652)", () => {
  assert.equal(guardAnswer("Deneb Walker is tucked away in a small house near the eastern edge of Stromgarde Keep, on " +
    "your map at roughly sixty-eight, forty-three.", { supplied: FACTS }),
  "Deneb Walker is tucked away in a small house near the eastern edge of Stromgarde Keep.");
  assert.equal(guardAnswer("You are right; Deneb Walker is in a small house on the eastern side of Stromgarde Keep, but " +
    "the coordinates for his location are closer to fifty-one, forty-eight.", { supplied: FACTS }),
  "You are right; Deneb Walker is in a small house on the eastern side of Stromgarde Keep.");
  const kept = "Fremal Doohickey is in the Deepwater Tavern, at eleven, sixty-one on your map.";
  assert.equal(guardAnswer(kept, { supplied: FACTS }), kept);
  // Her own earlier answer is no evidence for the same made-up place.
  const prompt = `${FACTS}\n\nCONVERSATION\nRECENT CONVERSATION (oldest first)\n` +
    JSON.stringify([{ player: "Where is he?", willo: "Closer to fifty-one, forty-eight (51, 48)." }]) +
    "\n\nQUESTION\nCan you check?";
  assert.equal(guardAnswer("He stays on the eastern side of the city, near the coordinates fifty-one, forty-eight on " +
    "your map.", { supplied: evidenceOf(prompt, "Can you check?") }), "He stays on the eastern side of the city.");
  // Two numbers that aren't a place stay.
  const levels = "Come back at levels ten, twenty and thirty.";
  assert.equal(guardAnswer(levels, { supplied: "" }), levels);
});

test("Willo's own answer says your people, a character's keeps its own (LOR-626)", () => {
  assert.equal(guardAnswer("Orgrimmar is the beating heart of our people.", { own: true }),
    "Orgrimmar is the beating heart of your people.");
  assert.equal(guardAnswer("Our people have long memories.", { own: false }), "Our people have long memories.");
});

test("a player's note on how a name sounds never becomes its spelling (LOR-653)", () => {
  const prompt = "CONVERSATION\nRECENT CONVERSATION (oldest first)\n" +
    JSON.stringify([{ player: "It's actually pronounced Dun Moreau.", willo: "Thank you!" }]) +
    "\n\nQUESTION\nWhat is Helm's Bed Lake?";
  assert.equal(guardAnswer("Helm's Bed Lake is a frozen lake in southeastern Dun Moreau.",
    { prompt, question: "What is Helm's Bed Lake?", names: ["Dun Morogh", "Helm's Bed Lake"] }),
  "Helm's Bed Lake is a frozen lake in southeastern Dun Morogh.");
});
