// The Terms say what the plans give (Mike, 2026-10-21: "Legend gets 6,000 answers a month, not 4,000"; plan cards,
// /account, /willo and the Terms must all say the same thing): each paid plan's price, month's answers and day's most,
// and the free plan's day, from lib/billing.js PLANS. The numbers, not the sentence they sit in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLANS, PAID } from "../lib/billing.js";

test("the Terms list each plan's price, answers and day's most as the plans have them", () => {
  const terms = readFileSync(new URL("../public/terms.html", import.meta.url), "utf8").replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
  for (const id of PAID) {
    const p = PLANS[id];
    const at = terms.indexOf(`${p.name}:`);
    assert.ok(at >= 0, `${p.name} is in the Terms`);
    const said = terms.slice(at, at + 200);
    for (const n of [`$${(p.monthly / 100).toFixed(2)}`, p.answersPerMonth.toLocaleString("en-US"), String(p.answersPerDay)])
      assert.ok(said.includes(n), `${p.name}: ${n} in "${said}"`);
  }
  assert.match(terms, new RegExp(`\\b${PLANS.free.answersPerDay} answers a day`));
});
