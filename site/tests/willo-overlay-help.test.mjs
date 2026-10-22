import { test } from "node:test";
import assert from "node:assert/strict";
import { helpBlock, helpTopics } from "../lib/willo-help.js";

test("text beside Willo's blue dot gets the overlay control, even with voice or live-info help", () => {
  for (const question of [
    "Willow I turned live game info off and you're still showing text in the game window. How do I turn it off?",
    "No, I mean the text right next to the blue dot that's over the game. How do I turn them on off and just listen to your voice?",
    "How do I hide the captions next to the blue dot?",
    "How do I turn your captions off?",
  ]) {
    assert.ok(helpTopics(question).includes("wisp"), question);
    const help = helpBlock(question, { client: "companion/0.23.0" });
    assert.match(help, /Settings › Willo › Willo over the game › "Show Willo over the game"/, question);
    assert.match(help, /(?:wisp|blue dot).*text.*together/i, question);
    assert.match(help, /no separate.*(?:text|captions)/i, question);
    assert.match(help, /Live game info.*does not.*(?:hide|control)/i, question);
    assert.match(help, /Talk with Willo.*(?:on|enabled).*voice/i, question);
  }
});

test("a blue dot in the game world is not Willo overlay help", () => {
  for (const question of [
    "What is the blue dot on my map?",
    "Can you tell me what the blue dot beside this quest means?",
    "What does the text next to the blue dot on my map mean?",
  ]) {
    assert.ok(!helpTopics(question).includes("wisp"), question);
  }
});
