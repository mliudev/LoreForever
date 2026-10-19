// Willo's note about the player's friends (lib/friends-note.js): a Willo 0.22.0 or older writes the old one, and the
// answer model gets the newer one in its place (they/them always, old sightings as last seen, never speaking for them).
// The note must stay the app's word for word (companion/lore_companion/answer.py FRIENDS_NOTE).
// In-process on node:sqlite (helpers.mjs); Gemini is a stub. Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as answer } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { OLD_FRIENDS_NOTE, FRIENDS_NOTE, withFriendsNote } from "../lib/friends-note.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1(), GEMINI_API_KEY: "test-key" };
const originalFetch = globalThis.fetch;
let sent;
beforeEach(async () => {
  await setup(env);
  sent = [];
  globalThis.fetch = async (url, options) => {
    sent.push(JSON.parse(options.body));
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Aelric was last seen in Darkshire." }] } }],
      usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 20 } });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

const LINE = "Aelric (playing Aelric): level 24, in Darkshire, Duskwood; last seen 2 days ago.";
test("an older Willo's friends note reaches the answer model as the newer one; anything else as it is", async () => {
  const prompt = `FRIENDS\n${OLD_FRIENDS_NOTE}\n${LINE}\n\nQUESTION\nWhat's Aelric doing?`;
  assert.equal(withFriendsNote(prompt), `FRIENDS\n${FRIENDS_NOTE}\n${LINE}\n\nQUESTION\nWhat's Aelric doing?`);
  assert.equal(withFriendsNote("QUESTION\nWho is Thrall?"), "QUESTION\nWho is Thrall?");
  assert.match(FRIENDS_NOTE, /always they\/them, never he or she/);

  const user = await findOrCreateUser(env, { email: "fn@example.com", googleSub: "fn", name: "fn" });
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  const { token } = await claimToken(env, link.device_code);
  const res = await answer({ env, request: new Request("https://example.test/api/companion/answer", { method: "POST",
    headers: { "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, persona: "willo" }) }) });
  assert.equal(res.status, 200);
  const asked = sent.map(b => JSON.stringify(b.contents)).join("");
  assert.ok(asked.includes("always they/them, never he or she"), "the newer note");
  assert.ok(!asked.includes("(they/them unless the player says otherwise)"), "not the old one");
});
