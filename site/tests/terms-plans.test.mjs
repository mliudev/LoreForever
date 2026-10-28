// The Terms say what the plans give (Mike, 2026-10-21: plan cards, /account, /willo and the Terms must all say the same
// thing): each paid plan's price and its unlimited answers (Mike, 10/28), and the free plan's day, from lib/billing.js
// PLANS. The numbers and the meaning, not the sentence they sit in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLANS, PAID } from "../lib/billing.js";

test("the Terms list each plan's price and answers as the plans have them", () => {
  const terms = readFileSync(new URL("../public/terms.html", import.meta.url), "utf8").replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
  for (const id of PAID) {
    const p = PLANS[id];
    const at = terms.indexOf(`${p.name}:`);
    assert.ok(at >= 0, `${p.name} is in the Terms`);
    const said = terms.slice(at, at + 200);
    assert.ok(said.includes(`${(p.monthly / 100).toFixed(2)}`), `${p.name}'s price in "${said}"`);
    assert.ok(p.unlimited && /unlimited answers/i.test(said) && !/answers a (day|month)/i.test(said), `${p.name}: "${said}"`);
  }
  assert.match(terms, new RegExp(`\\b${PLANS.free.answersPerDay} answers a day`));
});
