// The translation checks (public/translate/check.js): the length bounds against the English and the slur blocklist
// (public/translate/blocklist.js), as the dashboard runs them and through the API's save and kit import. The test
// words come from the list itself. Same rules as pipeline/lore/kit.py (tests/test_kit.py). Run:
// node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";

import { BLOCKLIST } from "../public/translate/blocklist.js";
import { onRequest as translations } from "../functions/api/translations/[action].js";
import { findOrCreateUser, startSession, setup } from "../lib/accounts.js";
import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";

test("the API refuses such an edit with the message the dashboard shows", async () => {
  const env = { DB: d1() };
  await setup(env);
  const user = await findOrCreateUser(env, { email: "gate@example.com", googleSub: "gate", name: "gate" });
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  const post = async (action, body) => {
    const headers = new Headers({ Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" });
    const init = { method: "POST", headers, body: JSON.stringify(body) };
    const request = new Request(`${ORIGIN}/api/translations/${action}`, init);
    const res = await translations({ request, env, params: { action }, waitUntil: () => {} });
    return { status: res.status, body: await res.json() };
  };
  const en = "Hogger is a gnoll who has been terrorizing the people of Elwynn Forest for weeks, raiding farms and " +
    "attacking travelers on the road to Goldshire.";
  const word = BLOCKLIST.de[0];

  const save = text => post("save", { locale: "deDE", id: "npc:hogger/s", en, text });
  let r = await save(`Hogger ist ein ${word}, der den Wald plagt.`);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /don't allow/);
  r = await save("Hogger.");
  assert.equal(r.status, 400);
  assert.match(r.body.error, /shorter/);
  r = await save("Hogger ist ein Gnoll, der die Leute im Wald von Elwynn seit Wochen plagt.");
  assert.equal(r.status, 200, JSON.stringify(r.body));

  r = await post("import", { locale: "frFR", edits: [
    { id: "npc:hogger/s", en, text: "Lardeur est un gnoll qui terrorise la forêt d'Elwynn depuis des semaines." },
    { id: "npc:hogger/n", en: "Hogger", text: BLOCKLIST.en[0] },
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.saved, 1);
  assert.match(r.body.results.find(x => x.id === "npc:hogger/n").error, /don't allow/);
  const rows = env.DB.sqlite.prepare("SELECT locale, string_id FROM translation_edits ORDER BY id").all()
    .map(x => ({ ...x }));
  assert.deepEqual(rows, [{ locale: "deDE", string_id: "npc:hogger/s" }, { locale: "frFR", string_id: "npc:hogger/s" }]);
});
