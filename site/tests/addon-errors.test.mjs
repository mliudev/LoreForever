// Lore Forever's error reports from the companion app (lib/addon-errors.js, functions/api/companion/addon-errors.js):
// only the app can send them, only what the add-on noted is kept (one row per message and install), a message no
// install sent before goes to Slack once, and the routines read them back with the admin key. In-process on
// node:sqlite; Slack is a stubbed fetch. Run: node --test site/tests/
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost, onRequestGet } from "../functions/api/companion/addon-errors.js";
import { readAddonErrors, sigOf, PER_HOUR, MAX_ROWS } from "../lib/addon-errors.js";
import { d1 } from "./helpers.mjs";

const INSTALL = "a".repeat(64), OTHER = "b".repeat(64);
const HOOK = "https://hooks.slack.com/services/T000/B000/XXXX";
const NOW = Math.floor(Date.now() / 1000);
const BLOCKED = "ADDON_ACTION_FORBIDDEN: LoreForever tried to call SetPreferredGamepadInteractTarget()";
const LUA = "Interface/AddOns/LoreForever/Voice.lua:812: attempt to index field 'clip' (a nil value)";

let posts, realFetch;
beforeEach(() => {
  posts = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { posts.push(JSON.parse(init.body).text); return new Response("ok"); };
});
afterEach(() => { globalThis.fetch = realFetch; });

const body = (over = {}) => ({ v: 1, install: INSTALL, companion: "0.22.0", addon: "0.22.0", client: "1.60.1.70450",
  locale: "enUS", errors: [{ msg: BLOCKED, n: 2118, first: NOW - 3600, last: NOW - 60, v: "0.21.0" },
                           { msg: LUA, stack: "[string \"@Interface/AddOns/LoreForever/Voice.lua\"]:812: in function <...>",
                             n: 3, first: NOW - 7200, last: NOW - 120, v: "0.22.0" }], ...over });

function context(env, init) {
  const pending = [];
  return { env, request: new Request("https://loreforeverwow.com/api/companion/addon-errors", init),
           waitUntil: p => pending.push(p), done: () => Promise.all(pending) };
}
const send = async (env, payload, headers = { "X-LF-Client": "companion/0.22.0" }) => {
  const ctx = context(env, { method: "POST", headers: { "Content-Type": "application/json", ...headers },
                             body: typeof payload === "string" ? payload : JSON.stringify(payload) });
  const res = await onRequestPost(ctx);
  await ctx.done();
  return res;
};

test("a send keeps one row per message and install, replaced by the next send", async () => {
  const env = { DB: d1(), SLACK_FEEDBACK_WEBHOOK: HOOK };
  const res = await send(env, body());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, kept: 2 });
  const again = body();
  again.errors[0].n = 2200;
  assert.equal((await send(env, again)).status, 200);
  const rows = env.DB.sqlite.prepare("SELECT install, msg, n, v, client, locale, companion FROM addon_errors ORDER BY n")
    .all().map(r => ({ ...r }));
  assert.deepEqual(rows, [
    { install: INSTALL, msg: LUA, n: 3, v: "0.22.0", client: "1.60.1.70450", locale: "enUS", companion: "0.22.0" },
    { install: INSTALL, msg: BLOCKED, n: 2200, v: "0.21.0", client: "1.60.1.70450", locale: "enUS", companion: "0.22.0" },
  ]);
  assert.ok(!JSON.stringify(env.DB.sqlite.prepare("SELECT * FROM addon_errors").all()).includes("203.0.113"));
});

test("only the companion app can send, and only an error report", async () => {
  const env = { DB: d1() };
  for (const [payload, headers, status] of [
    [body(), {}, 400],                                                                // no X-LF-Client
    [body(), { "X-LF-Client": "companion/0.22.0", Origin: "https://evil.example" }, 400],   // from a page
    ["not json", undefined, 400],
    [body({ install: "Aelric" }), undefined, 400],
    [body({ errors: "lots" }), undefined, 400],
    [body({ errors: [{ msg: "x".repeat(60_000) }] }), undefined, 413],
  ]) assert.equal((await send(env, payload, headers)).status, status);
});

test("what's kept is cut to the add-on's own limits; times that can't be right are dropped", () => {
  const many = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({ msg: `error ${i}` }));
  const r = readAddonErrors(body({ errors: [{ msg: "m".repeat(900), stack: "s\r\n".repeat(900), n: -4, first: 12,
                                              last: NOW + 10 * 86400, v: "<b>" }, { msg: "  " }, null, ...many] }), NOW);
  assert.equal(r.errors.length, MAX_ROWS - 2, "the first MAX_ROWS entries are read; a blank one and a null aren't errors");
  const [e] = r.errors;
  assert.deepEqual([e.msg.length, e.stack.length <= 1200, e.stack.includes("\r"), e.n, e.first, e.last, e.v],
                   [400, true, false, 1, null, null, null]);
  assert.equal(readAddonErrors(body({ locale: "english", client: "1.60; drop table" }), NOW).locale, null);
});

test("one bug from two versions (other line numbers) is one error", async () => {
  assert.equal(await sigOf(LUA), await sigOf(LUA.replace("812", "815")));
  assert.notEqual(await sigOf(LUA), await sigOf(BLOCKED));
});

test("a message no install sent before goes to Slack once; the same from another install doesn't", async () => {
  const env = { DB: d1(), SLACK_FEEDBACK_WEBHOOK: HOOK };
  await send(env, body());
  assert.equal(posts.length, 2);
  assert.match(posts.join("\n"), /New add-on error · blocked action/);
  assert.match(posts.join("\n"), /SetPreferredGamepadInteractTarget/);
  assert.match(posts.join("\n"), /add-on 0\.21\.0 · WoW 1\.60\.1\.70450 · enUS · 2118× on that PC · sent from Willo/);
  await send(env, body({ install: OTHER }));
  await send(env, body());
  assert.equal(posts.length, 2);
  await send(env, body({ errors: [{ msg: "Interface/AddOns/LoreForever/UI.lua:9: something new", n: 1 }] }));
  assert.equal(posts.length, 3);
  assert.match(posts[2], /Lua error/);
});

test(`at most ${PER_HOUR} sends an hour from one install`, async () => {
  const env = { DB: d1() };
  for (let i = 0; i < PER_HOUR; i++) assert.equal((await send(env, body())).status, 200);
  const res = await send(env, body());
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "3600");
  assert.equal((await send(env, body({ install: OTHER }))).status, 200);
});

test("the routines read them back with the admin key: the most players first", async () => {
  const env = { DB: d1(), FEEDBACK_KEY: "k3y" };
  await send(env, body());
  await send(env, body({ install: OTHER, errors: [{ msg: BLOCKED.replace("call", "call"), n: 5, v: "0.22.0" }] }));
  const get = auth => onRequestGet({ env, request: new Request("https://loreforeverwow.com/api/companion/addon-errors",
    { headers: auth ? { Authorization: `Bearer ${auth}` } : {} }) });
  assert.equal((await get()).status, 401);
  assert.equal((await get("wrong")).status, 401);
  const { errors } = await (await get("k3y")).json();
  assert.equal(errors.length, 2);
  assert.deepEqual([errors[0].msg, errors[0].installs, errors[0].n, errors[0].versions], [BLOCKED, 2, 2123, ["0.21.0", "0.22.0"]]);
  assert.deepEqual([errors[1].installs, errors[1].stack.startsWith("[string")], [1, true]);
});
