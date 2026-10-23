// The voice work dashboard's endpoint (functions/api/admin/voice-status.js, lib/voice-status.js): admin key only,
// same-origin for browsers, a format 1 snapshot with generated_at, the latest one back with when it arrived, and a
// day of small summaries for the sparkline. Run: node --test site/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { onRequestPost, onRequestGet } from "../functions/api/admin/voice-status.js";
import { summarize, HISTORY_KEEP } from "../lib/voice-status.js";
import { d1, SITE } from "./helpers.mjs";

const sample = JSON.parse(readFileSync(new URL("./fixtures/voice-status.json", import.meta.url), "utf8"));
const URL_ = "https://loreforeverwow.com/api/admin/voice-status";
const post = (env, body, headers = { Authorization: "Bearer k" }) => onRequestPost({ env, request: new Request(URL_,
  { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }) });
const get = (env, headers = { Authorization: "Bearer k" }) => onRequestGet({ env, request: new Request(URL_, { headers }) });

test("voice status: admin key only, and a browser only from our own pages", async () => {
  const env = { DB: d1(), ADMIN_KEY: "k", FEEDBACK_KEY: "f" };
  assert.equal((await post(env, sample, {})).status, 401);
  assert.equal((await post(env, sample, { Authorization: "Bearer nope" })).status, 401);
  assert.equal((await get(env, {})).status, 401);
  assert.equal((await post(env, sample, { Authorization: "Bearer k", Origin: "https://example.com" })).status, 403);
  assert.equal((await get(env, { Authorization: "Bearer k", Origin: "https://example.com" })).status, 403);
  assert.equal((await post(env, sample, { Authorization: "Bearer f" })).status, 200, "FEEDBACK_KEY works too");
  assert.equal((await get(env, { Authorization: "Bearer k", Origin: "https://loreforeverwow.com" })).status, 200);
  assert.equal((await post({ ADMIN_KEY: "k" }, sample)).status, 503, "no database bound");
});

test("voice status: nothing posted yet, then the latest comes back with when it arrived", async () => {
  const env = { DB: d1(), ADMIN_KEY: "k" };
  const empty = await (await get(env)).json();
  assert.deepEqual([empty.ok, empty.status, empty.received_at, empty.history], [true, null, null, []]);

  const res = await post(env, sample);
  assert.equal(res.status, 200);
  const sent = await res.json();
  assert.equal(sent.generated_at, sample.generated_at);
  assert.ok(Date.parse(sent.received_at) > Date.now() - 60e3);

  const got = await (await get(env)).json();
  assert.deepEqual(got.status, sample);
  assert.equal(got.received_at, sent.received_at);
  assert.equal(got.history.length, 1);
  assert.deepEqual(Object.keys(got.history[0]).sort(), ["at", "count", "current", "done", "total"]);

  // A newer one replaces it: still one row, the history grows, and the same snapshot again adds nothing.
  const newer = { ...sample, generated_at: "2026-10-16T21:22:00+00:00" };
  await post(env, newer);
  await post(env, newer);
  const after = await (await get(env)).json();
  assert.equal(after.status.generated_at, newer.generated_at);
  assert.deepEqual(after.history.map(h => h.at), [sample.generated_at, newer.generated_at]);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM voice_status").get().n, 1);
});

test("voice status: refuses what isn't a format 1 snapshot or is too big, and keeps only a day of history", async () => {
  const env = { DB: d1(), ADMIN_KEY: "k" };
  for (const bad of ["not json", "[1]", "null", { generated_at: sample.generated_at }, { ...sample, format: 2 },
    { ...sample, generated_at: undefined }, { ...sample, generated_at: "yesterday-ish" }, { ...sample, jobs: "none" }, { ...sample, matrix: [] }]) {
    const r = await post(env, bad);
    assert.equal(r.status, 400, JSON.stringify(bad)?.slice(0, 60));
    assert.equal((await r.json()).ok, false);
  }
  assert.equal((await get(env).then(r => r.json())).status, null, "nothing was stored");
  assert.equal((await post(env, { ...sample, events: [{ text: "x".repeat(1024 * 1024) }] })).status, 413);

  const t0 = Date.parse("2026-10-16T00:00:00Z");
  for (let i = 0; i < HISTORY_KEEP + 5; i++) await post(env, { ...sample, generated_at: new Date(t0 + i * 600e3).toISOString() });
  const { history } = await (await get(env)).json();
  assert.equal(history.length, HISTORY_KEEP);
  assert.equal(history.at(-1).at, new Date(t0 + (HISTORY_KEEP + 4) * 600e3).toISOString());
  assert.ok(history[0].at < history.at(-1).at, "oldest first");
});

test("voice status: the sparkline counts live recordings that are up to date, and the running jobs' progress", () => {
  const s = summarize(sample);
  const live = Object.values(sample.matrix.cells).filter(c => c.status === "live");
  const q = sample.matrix.questgivers;
  assert.equal(s.count, live.reduce((a, c) => a + c.count, 0) + q.count);
  assert.equal(s.current, live.reduce((a, c) => a + c.current, 0) + q.current);
  assert.ok(s.current > 0 && s.current <= s.count);
  assert.deepEqual([s.done, s.total], [9, 40], "the two running jobs");
  assert.deepEqual(summarize({ format: 1, generated_at: "x" }), { current: 0, count: 0, done: 0, total: 0 });
});

test("the dashboard page: noindex, no inline script (the CSP would block it), and it reads the voice status", () => {
  const html = readFileSync(SITE + "public/admin/voices.html", "utf8");
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, "/admin runs no inline script");
  assert.match(readFileSync(SITE + "public/admin-voices.js", "utf8"), /\/api\/admin\/voice-status/);
  // Voice work is a tab in the one admin frame (Mike 10/17: it opened a page without the tabs).
  assert.ok(readFileSync(SITE + "public/admin-shell.js", "utf8").includes('"/admin/voices"'));
});
