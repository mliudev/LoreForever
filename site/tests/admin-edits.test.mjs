// /admin/edits' API (functions/api/translations/[action].js, admin key): review a page at a time with filters and a
// total, summary per language and translator, and decide for all of one translator's edits at once. The id form of
// decide (lore.kit pull) stays as it was. D1 is node:sqlite (helpers.mjs). Run: node --test site/tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as action } from "../functions/api/translations/[action].js";
import { setup, findOrCreateUser } from "../lib/accounts.js";
import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const KEY = "admin-secret";
const env = { DB: d1(), ADMIN_KEY: KEY };
let alice, bob;
let n = 0;

async function edit(user, locale, status, { text = "Text", en = "English", id = null, updated = null } = {}) {
  n += 1;
  const when = updated || new Date(Date.now() - (100 - n) * 60000).toISOString();   // later edits are newer
  await env.DB.prepare(
    "INSERT INTO translation_edits (user_id, locale, string_id, en, text, created, updated, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(user.id, locale, id || `ui/${String(n).padStart(10, "0")}`, en, text, when, when, status).run();
}

beforeEach(async () => {
  await setup(env);
  for (const table of ["translation_edits", "sessions", "users"]) env.DB.sqlite.exec(`DELETE FROM ${table}`);
  n = 0;
  alice = await findOrCreateUser(env, { email: "alice@example.com", googleSub: "alice", name: "Alice" });
  bob = await findOrCreateUser(env, { email: "bob@example.com", googleSub: "bob", name: "Bob" });
  await edit(alice, "deDE", "new", { text: "Willkommen in Sturmwind" });
  await edit(alice, "deDE", "accepted");
  await edit(alice, "deDE", "pulled");
  await edit(alice, "deDE", "rejected");
  await edit(alice, "frFR", "new");
  await edit(bob, "frFR", "new", { text: "100% spam_here" });
  await edit(bob, "frFR", "new", { id: "quest:the-defias/title" });
  await edit(bob, "esES", "new", { updated: "2026-01-01T00:00:00.000Z" });   // long ago: not in "last 7 days"
});

async function call(name, { query = "", body, key = KEY } = {}) {
  const headers = new Headers();
  if (key) headers.set("Authorization", "Bearer " + key);
  if (body) headers.set("Content-Type", "application/json");
  const request = new Request(`${ORIGIN}/api/translations/${name}${query}`,
    { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
  const res = await action({ request, env, params: { action: name } });
  return { status: res.status, body: await res.json() };
}
const statuses = () => Object.fromEntries(env.DB.sqlite.prepare("SELECT id, status FROM translation_edits").all().map(r => [r.id, r.status]));

test("review, summary and decide need the admin key", async () => {
  for (const name of ["review", "summary"]) assert.equal((await call(name, { key: "wrong" })).status, 401);
  assert.equal((await call("decide", { key: null, body: { user: alice.id, status: "rejected" } })).status, 401);
});

test("decide for one translator: reject every saved edit, restore every rejected one, pulled never changes", async () => {
  const before = statuses();
  let res = await call("decide", { body: { user: alice.id, status: "rejected" } });
  assert.equal(res.body.updated, 3);
  const after = statuses();
  for (const [id, s] of Object.entries(before)) {
    const mine = env.DB.sqlite.prepare("SELECT user_id FROM translation_edits WHERE id = ?").get(id).user_id === alice.id;
    assert.equal(after[id], mine && (s === "new" || s === "accepted") ? "rejected" : s);
  }
  res = await call("decide", { body: { user: alice.id, locale: "frFR", status: "new" } });   // one language back
  assert.equal(res.body.updated, 1);
  res = await call("decide", { body: { user: alice.id, status: "new" } });   // the rest, and the one rejected before
  assert.equal(res.body.updated, 3);
  assert.equal((await call("review", { query: `?status=rejected&user=${alice.id}` })).body.total, 0);
  assert.equal((await call("review", { query: "?status=pulled" })).body.total, 1);
  assert.equal((await call("review", { query: `?user=${bob.id}` })).body.total, 3);   // Bob untouched
});

test("decide refuses a bad translator or status, and the id form works as before", async () => {
  assert.equal((await call("decide", { body: { user: "x y", status: "rejected" } })).status, 400);
  assert.equal((await call("decide", { body: { user: alice.id, status: "accepted" } })).status, 400);
  assert.equal((await call("decide", { body: { user: 5, status: "rejected" } })).status, 400);
  assert.equal((await call("decide", { body: { status: "rejected" } })).status, 400);
  const ids = (await call("review", { query: `?user=${bob.id}&limit=2` })).body.edits.map(e => e.id);
  assert.equal((await call("decide", { body: { ids, status: "rejected" } })).body.updated, 2);
  assert.equal((await call("review", { query: `?user=${bob.id}` })).body.total, 1);
});
