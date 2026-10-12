// /admin's funnel stages (public/admin-funnel.js): a share only where the stage is part of the one it's measured
// against. Accounts measured against site downloads read as "25% of site downloads" when most players came through
// CurseForge (Mike, 10/11), so that mustn't come back.
import { test } from "node:test";
import assert from "node:assert/strict";

import { funnelStages } from "../public/admin-funnel.js";

const funnel = (stores, companions = null) => ({
  stages: { downloads: 292, installer: 175, accounts: 73, profiles: 40, companion: 7, returning: 12 }, stores, companions });

test("shares only for real subsets; installs from every source add CurseForge to GitHub, which holds the site's", () => {
  const stages = Object.fromEntries(funnelStages(funnel({ inUse: { n: 3369, name: "Lore Forever 0.13.1" },
    github: { downloads: 1505 } })).map(s => [s.key, s]));
  assert.equal(stages.reach.n, 3369 + 1505);
  assert.deepEqual(stages.site.share, { pct: "6%", of: "installs, every source" });
  for (const key of ["reach", "companion", "accounts"]) assert.equal(stages[key].share, null, key);
  assert.deepEqual([stages.profiles.share.of, stages.synced.share.of, stages.returning.share.of], ["accounts", "profiles", "accounts"]);
  assert.equal(stages.companion.n, null, "no check-ins yet is not 0");

  // Without GitHub's numbers the site's own downloads stand in; without CurseForge's there's no total at all.
  assert.equal(funnelStages(funnel({ inUse: { n: 3000, name: "x" }, github: null })).find(s => s.key === "reach").n, 3292);
  const none = funnelStages(funnel({}));
  assert.equal(none.find(s => s.key === "reach").n, null);
  assert.equal(none.find(s => s.key === "site").share, null);
});
