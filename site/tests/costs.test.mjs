import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { onRequestGet, onRequestPost } from "../functions/api/admin/costs.js";
import { costsView } from "../public/admin-costs.js";
import { d1 } from "./helpers.mjs";

const SEED = JSON.parse(/'(\{"taken_at".*\})'/.exec(readFileSync(new URL("../migrations/cost-snapshots.sql", import.meta.url), "utf8"))[1]);
const URL_ = "https://loreforeverwow.com/api/admin/costs";

test("costs: both routes need the admin key, and a posted snapshot comes back from GET", async () => {
  const env = { DB: d1(), ADMIN_KEY: "k" };
  const post = (headers, payload) => onRequestPost({ env, request: new Request(URL_,
    { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) }) });
  const get = headers => onRequestGet({ env, request: new Request(URL_, { headers }) });
  const auth = { Authorization: "Bearer k" };

  assert.equal((await get({})).status, 401);
  assert.equal((await get({ Authorization: "Bearer nope" })).status, 401);
  assert.equal((await post({}, SEED)).status, 401);
  assert.equal((await post({ ...auth, Origin: "https://elsewhere.example" }, SEED)).status, 403);
  assert.equal((await post(auth, { ...SEED, services: [{ name: "x", kind: "free" }] })).status, 400);
  assert.deepEqual(await (await get(auth)).json(), { ok: true, snapshot: null, kept: 0 });

  const posted = await post({ ...auth, Origin: "https://loreforeverwow.com" }, SEED);
  assert.deepEqual(await posted.json(), { ok: true, taken_at: "2026-10-16", services: SEED.services.length });
  const res = await get(auth);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const back = await res.json();
  assert.deepEqual(back.snapshot, SEED);
  assert.equal(back.kept, 1);

  // The same day again replaces it; a new day adds one; only the newest 30 stay.
  await post(auth, { ...SEED, budget_monthly: 150 });
  assert.equal((await (await get(auth)).json()).kept, 1);
  for (let d = 1; d <= 32; d++) await post(auth, { ...SEED, taken_at: "2026-11-" + String(d % 28 + 1).padStart(2, "0") + (d > 28 ? "T12:00:00Z" : "") });
  assert.equal((await (await get(auth)).json()).kept, 30);
});

test("costs: totals and shares are worked out from the services, and the worst problem is the one shown", () => {
  const v = costsView(SEED, Date.parse("2026-10-17"));
  assert.equal(v.monthToDate, 309.28);
  assert.equal(v.estimate, 390);
  assert.equal(v.services[0].name, "Google Gemini API");
  assert.equal(Math.round(v.services[0].share * 100), 77);
  assert.equal(v.over, true);
  assert.equal(v.budgetState.severity, "crit");
  assert.match(v.budgetState.words, /Over budget by \$290/);
  assert.equal(v.attention.severity, "crit");
  assert.match(v.attention.title, /Google Gemini API/);

  const fine = costsView({ ...SEED, budget_monthly: 500 }, Date.parse("2026-10-17"));
  assert.equal(fine.budgetState.severity, "good");
  assert.match(fine.budgetState.words, /Under budget by \$110/);
  assert.equal(fine.attention.severity, "warn", "Gemini is still past 75% of its cap");
  const quiet = { ...SEED, budget_monthly: 500, services: SEED.services.filter(s => s.cap == null) };
  assert.equal(costsView(quiet, Date.parse("2026-10-17")).attention.title, "Nothing needs attention");
  assert.equal(costsView(quiet, Date.parse("2026-11-20")).attention.title, "These figures are 35 days old");
});
