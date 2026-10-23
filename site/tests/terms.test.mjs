// Signing in agrees to the Terms and Privacy (every sign-in page says so): the account keeps which version and when,
// once per version, and loses the record with the account.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findOrCreateUser, recordTerms, deleteUser, TERMS_VERSION } from "../lib/accounts.js";
import { d1 } from "./helpers.mjs";

test("a sign-in records the Terms it agreed to, once per version, and the record goes with the account", async () => {
  const env = { DB: d1() };
  const user = await findOrCreateUser(env, { email: "a@example.test", googleSub: "g-1", name: "A" });
  await recordTerms(env, user.id);
  await recordTerms(env, user.id);
  const rows = (await env.DB.prepare("SELECT version, accepted FROM terms_acceptances WHERE user_id = ?").bind(user.id).all()).results;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version, TERMS_VERSION);
  await deleteUser(env, user);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM terms_acceptances").first()).n, 0);
});

test("the sign-in pages link the Terms, and the version is the Terms page's date", () => {
  for (const page of ["link.html", "account.html"]) {
    const html = readFileSync(new URL(`../public/${page}`, import.meta.url), "utf8");
    assert.match(html, /agree/i, page);
    assert.match(html, /href="\/terms"/, page);
  }
  assert.ok(readFileSync(new URL("../public/terms.html", import.meta.url), "utf8").includes(TERMS_VERSION));
});
