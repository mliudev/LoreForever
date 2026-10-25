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
    // The one switch that hides the text, by its name in Settings; and the two it is not.
    assert.ok(help.includes("Show Willo over the game"), question);
    for (const other of ["Live game info", "Talk with Willo"]) assert.ok(help.includes(other), `${question}: ${other}`);
  }
});

test("the dots over the minimap get the live game info card with the switch that hides them", () => {
  // The answer log, 10/21: without the card she made up a "Show world markers" setting.
  for (const question of [
    "I don't understand why I'm seeing all these dots. Can you see my mini map?",
    "How do I get rid of the sparkles around my minimap?",
    "Are you able to move your sky?",
  ]) {
    assert.ok(helpTopics(question).includes("live"), question);
    const help = helpBlock(question, { client: "companion/0.23.0" }).toLowerCase();
    for (const words of ["show it all the time", "/lore sky"]) assert.ok(help.includes(words), `${question}: ${words}`);
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
