// The Terms say what the plans give (Mike, 2026-10-21: "Legend gets 6,000 answers a month, not 4,000"; plan cards,
// /account, /willo and the Terms must all say the same thing): each paid plan's price, month's answers and day's most,
// and the free plan's day, from lib/billing.js PLANS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLANS, PAID } from "../lib/billing.js";

test("the Terms list each plan's price, answers and day's most as the plans have them", () => {
  const terms = readFileSync(new URL("../public/terms.html", import.meta.url), "utf8").replace(/\s+/g, " ");
  assert.doesNotMatch(terms, /4,000 answers|1,900 answers|900 answers a month/);
  for (const id of PAID) {
    const p = PLANS[id];
    assert.match(terms, new RegExp(`<strong>${p.name}</strong>: \\$${(p.monthly / 100).toFixed(2)} a month\\. ` +
      `${p.answersPerMonth.toLocaleString("en-US")} answers a month, up to ${p.answersPerDay} a day\\.`), p.name);
  }
  assert.match(terms, new RegExp(`answers for free too: ${PLANS.free.answersPerDay} answers a day`));
});
