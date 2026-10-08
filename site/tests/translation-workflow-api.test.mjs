import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/translations/[action].js";
import { setup, findOrCreateUser, startSession } from "../lib/accounts.js";
import { d1 } from "./helpers.mjs";

test("my edits include their English source so an old correction cannot replace new English", async () => {
  const env = { DB: d1() }, origin = "https://preview.example";
  await setup(env);
  const user = await findOrCreateUser(env, { email: "translator@example.com", googleSub: "translator" });
  const other = await findOrCreateUser(env, { email: "other@example.com", googleSub: "other" });
  const cookie = (await startSession(env, new Request(origin), user.id)).split(";")[0];
  for (const owner of [user, other]) {
    await env.DB.prepare("INSERT INTO translation_edits (user_id, locale, string_id, en, text, created, updated, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(owner.id, "frFR", "zone:elwynn/s", "Old English", "Ancien texte", "2026-10-07", "2026-10-07", "new").run();
  }
  const call = cookie => onRequest({ env, params: { action: "edits" },
    request: new Request(origin + "/api/translations/edits?locale=frFR", { headers: cookie ? { Cookie: cookie } : {} }) });
  assert.equal((await call(null)).status, 401);
  const res = await call(cookie), body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.edits.length, 1, "another contributor's edits remain private");
  assert.equal(body.edits[0].en, "Old English");
  assert.equal(body.edits[0].text, "Ancien texte");
  assert.equal(body.edits[0].status, "new");
});
