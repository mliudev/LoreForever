// Willo's last checks in code (lib/willo-guards.js), on the 10/18 answer log's own answers.
import test from "node:test";
import assert from "node:assert/strict";
import { guardAnswer, evidenceOf, fromWhereLast, noCompanion } from "../lib/willo-guards.js";

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

test("the place the game last saved is said as where they were last, never where they are (the vision check, 10/19)", () => {
  const at = "Sentinel Hill, Westfall";
  assert.equal(fromWhereLast("You are standing right in the heart of Sentinel Hill, where Innkeeper Heather keeps the inn.", at),
    "You were last in the heart of Sentinel Hill, where Innkeeper Heather keeps the inn.");
  assert.equal(fromWhereLast("You can find repair services right here.", at),
    "From Sentinel Hill, where you were last, you can find repair services there.");
  assert.equal(fromWhereLast("Dungar Longdrink is the nearest gryphon master.", at),
    "From Sentinel Hill, where you were last, Dungar Longdrink is the nearest gryphon master.", "a name stays as it is");
  assert.equal(fromWhereLast("If you're not in Sentinel Hill anymore, tell me where you are.", at),
    "If you're not in Sentinel Hill anymore, tell me where you are.", "it says so already");
  assert.equal(guardAnswer("You are at Sentinel Hill.", { savedPlace: at }), "You were last at Sentinel Hill.");
  assert.equal(fromWhereLast("To reach the Wetlands from Sentinel Hill, fly to Stormwind.", at),
    "To reach the Wetlands from Sentinel Hill, where you were last, fly to Stormwind.", "the town once, not twice");
  assert.equal(fromWhereLast("Your trainer is there in Sentinel Hill.", at), "Your trainer is there in Sentinel Hill, where you were last.");
  assert.equal(fromWhereLast("You are standing right at the inn in Sentinel Hill.", at), "You were last at the inn in Sentinel Hill.");
  assert.equal(fromWhereLast("You are at the inn here in Sentinel Hill.", at), "You were last at the inn in Sentinel Hill.");
  assert.equal(fromWhereLast("Booty Bay is south from Gromgol Base Camp.", "Grom'gol Base Camp, Stranglethorn Vale"),
    "Booty Bay is south from Gromgol Base Camp, where you were last.", "her words may drop the apostrophe");
  assert.equal(fromWhereLast("Since you are at level 18, try the Deadmines.", at),
    "From Sentinel Hill, where you were last, since you are at level 18, try the Deadmines.", "only a place is where they were");
  assert.equal(guardAnswer("You are at Sentinel Hill."), "You are at Sentinel Hill.", "live: as it is");
});

// Silver's iPhone QA (10/19): the journey had level 1 on October 10 and level 11 on October 13, and she said Hogger
// fell "on October 12, when you were level 11" and Mother Fang at "level 6".
const JOURNEY = "PLAYER CONTEXT\nzone: Elwynn Forest\n\nFROM THEIR JOURNEY (Hurin's: what the game kept. Today is October 19.)\n" +
  "Their journey begins October 10, at level 1, with 0 quests already done before it.\n" +
  "- October 10, level 1, at Northshire Abbey, Elwynn Forest: arrived for the first time\n" +
  "- October 12, at Forest's Edge, Westfall: fought and beat Hogger, a rare elite, for the first time\n" +
  "- October 13, level 11, at Goldshire, Elwynn Forest: reached level 11\n" +
  "- October 13, level 12, at Goldshire, Elwynn Forest: reached level 12\n\nSOURCES\n=== Hogger ===\nLevel 11 gnoll.";
const guarded = text => guardAnswer(text, { prompt: JOURNEY, supplied: JOURNEY });

test("a level said for a day of their journey stays only when the journey gives it that day", () => {
  assert.equal(guarded("Yes! You beat Hogger at Forest's Edge back on October 12, when you were level 11."),
    "Yes! You beat Hogger at Forest's Edge back on October 12.");
  assert.equal(guarded("When you were level eleven, you beat Hogger on October 12. Well fought!"),
    "You beat Hogger on October 12. Well fought!");
  assert.equal(guarded("On October 12, at level 6, you took down Hogger."), "On October 12, you took down Hogger.");
  // Said out loud, the day in words.
  assert.equal(guarded("You beat Hogger back on October twelfth, when you were level eleven."),
    "You beat Hogger back on October twelfth.");
  assert.equal(guarded("You reached Goldshire on October the thirteenth, when you were level twelve."),
    "You reached Goldshire on October the thirteenth, when you were level twelve.");
  // Given that day, or about and between that day's levels: it stays.
  assert.equal(guarded("You reached Goldshire on October 13, when you were level 11."),
    "You reached Goldshire on October 13, when you were level 11.");
  assert.equal(guarded("On October 13, at around level 11, you reached Goldshire."),
    "On October 13, at around level 11, you reached Goldshire.");
  // No day named: a level the journey holds at all stays, one it never gives goes.
  assert.equal(guarded("You beat Mother Fang when you were level 6."), "You beat Mother Fang.");
  assert.equal(guarded("You were in Goldshire when you were level 12."), "You were in Goldshire when you were level 12.");
  // Not about a day of the journey: untouched, and without the journey nothing changes.
  assert.equal(guarded("You can learn riding at level 40."), "You can learn riding at level 40.");
  assert.equal(guardAnswer("Back on October 12, when you were level 11.", { prompt: "PLAYER CONTEXT\nzone: Elwynn" }),
    "Back on October 12, when you were level 11.");
});

test("a character never sends the adventurer to their wisp: the answer log's own replies (Mike, 10/19)", () => {
  // 12 of the 23 character replies in the answer log, 10/16 to 10/19, ended this way.
  const cases = [
    ["The Defias are a secretive lot, and their true leader remains a shadow even to us. If ye seek more answers on such " +
      "dangerous matters, perhaps that wisp of yours can shed some light on the subject.",
     "The Defias are a secretive lot, and their true leader remains a shadow even to us."],
    ["You can find a simple fishing pole for sale at the trade supplies stall right here in Bloodhoof Village. If you " +
      "need more help with your journey, you might ask your wisp, Willo, to guide your way.",
     "You can find a simple fishing pole for sale at the trade supplies stall right here in Bloodhoof Village."],
    ["It adds directly to the total health ye carry into the fray. If ye be curious how those numbers shift with yer " +
      "gear or strange contraptions, best ye ask Willo about it.", "It adds directly to the total health ye carry into the fray."],
    ["I have no concept of your strange machines or how they track the passing of your hours. Perhaps you should ask " +
      "your little wisp of light, for I care only for the work we have yet to finish here in the glades.",
     "I have no concept of your strange machines or how they track the passing of your hours."],
    ["As for your strange inquiries regarding settings, I suggest you consult your little wisp, Willo. Do try not to die " +
      "before your next flight.", "Do try not to die before your next flight."],
    ["I be Master Gadrin, a witch doctor of the Darkspear tribe. If ye be lookin' for more, speak wit' yer little wisp " +
      "friend, for I have much work to tend to.", "I be Master Gadrin, a witch doctor of the Darkspear tribe."],
    ["Aye, ye have it, lad. If ye be lookin' for something else, best ask that wee wisp o' light floatin' by yer shoulder.",
     "Aye, ye have it, lad."],
    ["Ask yer little wisp friend if ye be lookin' for strange magic.", "I couldn't say, friend."],
  ];
  for (const [said, kept] of cases) assert.equal(noCompanion(said), kept);
  // The world's own wisps, and the Light, stay.
  for (const said of ["The wisps of Teldrassil guard the ancient groves. Ishnu-alah.", "May the Light guide you, friend.",
    "Have you dealt with that wisp near the moonwell yet?"]) assert.equal(noCompanion(said), said);
  // Only in a character's reply: Willo's own answers say her name freely.
  assert.equal(guardAnswer("Ask your wisp, she knows.", { own: false }), "Ask your wisp, she knows.");
  assert.equal(guardAnswer("Ask your wisp, she knows.", { own: false, character: true }), "I couldn't say, friend.");
});
