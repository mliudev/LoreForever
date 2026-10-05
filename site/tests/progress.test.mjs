// The public progress page, /contribute/progress (LOR-238): built from public/data/coverage.json (the nightly ingest
// writes it, LOR-237; tests/fixtures/coverage.json stands in), noindex while the "contribute" feature is off, and
// whole without the file or the counters API. Run: node --test site/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readCoverage, groupWanted, progressPage } from "../lib/progress.js";
import { onRequestGet as progressGet } from "../functions/contribute/progress.js";
import { assets } from "./helpers.mjs";

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/coverage.json", import.meta.url), "utf8"));
const request = new Request("https://preview.example/contribute/progress");
const visible = html => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

test("coverage.json is read defensively: whole numbers, counts within totals, plain names, known kinds", () => {
  const c = readCoverage({
    generated: 1790000000,
    forever_only: { quests_known: "845", quests_with_text: 900, narrated: -3 },
    zones: [{ zone: "Westfall", quests: 10, with_text: 12, narrated: 2.7 }, { zone: "Nowhere", quests: 0 }, { quests: 4, with_text: 1 }],
    wanted: [{ kind: "spell", id: 1, name: "  A\nquest  ", level: "9" }, { kind: "npc", name: "" }, null],
  });
  assert.deepEqual(c.forever, { known: 845, withText: 845, narrated: 0 });
  assert.deepEqual(c.zones, [
    { zone: "Westfall", quests: 10, withText: 10, narrated: 2 },
    { zone: "Other places", quests: 4, withText: 1, narrated: 0 },
  ]);
  assert.deepEqual(c.wanted, [{ kind: "quest", id: "1", name: "A quest", zone: "Other places", level: 9 }]);
  assert.equal(c.generated.toISOString(), "2026-09-21T14:13:20.000Z");
  for (const bad of [null, [], "x", 3]) assert.equal(readCoverage(bad), null);
  assert.deepEqual(readCoverage({}).zones, []);
});

test("the wanted list: zones from the lowest level up, each by level, entries without a level last", () => {
  const groups = groupWanted(readCoverage(FIXTURE).wanted);
  assert.deepEqual(groups.map(g => [g.zone, g.min, g.max]), [["Teldrassil", 6, 6], ["Westfall", 11, 14], ["The Barrens", 17, 17]]);
  assert.deepEqual(groups[1].items.map(w => w.name), ["Ashes on the Wind", "Keeper Ondrel", "The Hollow Lantern"]);
  assert.deepEqual(groups[2].items.map(w => w.name), ["Thirst of the Crossroads", "A Kodo's Last Road"]);
});

test("the page leads with Forever's own content, in counts, never percentages", () => {
  const html = progressPage(readCoverage(FIXTURE), { hidden: true });
  const text = visible(html);
  assert.match(html, /<p class="pg-kicker">Forever's new content<\/p>/);
  assert.match(html, /<strong>43<\/strong> quests captured/);
  assert.match(html, /<strong>27<\/strong> narrated/);
  assert.match(text, /of the 845 quests new in Forever that we know of/);
  assert.ok(!text.includes("%"), "no percentages in what players read");
  // A bar per zone: captured, with narrated drawn over it.
  assert.match(html, /<span class="pg-zone-name">Westfall<\/span>\s*<span class="pg-zone-n">11 of 20 quests &middot; 4 narrated<\/span>/);
  assert.match(html, /<span class="pg-text" style="width:55%"><\/span><span class="pg-voice" style="width:20%"><\/span>/);
  assert.match(html, /<span class="pg-zone-n">0 of 31 quests<\/span>/);
  // Wanted: grouped by zone with the levels, pick it up and press Contribute.
  assert.match(html, /<span class="pg-wname">Westfall<\/span> <span class="pg-wmeta">levels 11&ndash;14 &middot; 3 wanted<\/span>/);
  assert.match(html, /<span class="pg-wmeta">level 6 &middot; 1 wanted<\/span>/);
  assert.match(html, /Keeper Ondrel<\/span> <span class="tag tag-draft">NPC<\/span>/);
  assert.match(html, /Songs of the &lt;i&gt;Old&lt;\/i&gt; Grove/, "names are escaped");
  assert.match(text, /Pick one up in game \(or\s+talk to them\), then press Contribute/);
  assert.match(html, /<a class="btn-small" href="\/contribute">Send your text<\/a>/);
  // The live counters wait, hidden, for /api/contribute/stats.
  assert.match(html, /<section class="vp-section pg-live" id="pg-live" aria-labelledby="live-title" hidden>/);
  for (const k of ["lines", "accepted", "contributors", "last_upload"]) assert.match(html, new RegExp(`data-stat="${k}"`));
  assert.match(html, /<script src="\/js\/contribute-progress\.js" defer><\/script>/);
  assert.match(text, /last on Oct 4, 2026/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/loreforeverwow.com\/contribute\/progress">/);
});

test("a long zone lists 40 and says how many more", () => {
  const wanted = Array.from({ length: 45 }, (_, i) => ({ kind: "quest", id: i, name: `Quest ${i}`, zone: "Durotar", level: 5 }));
  const html = progressPage(readCoverage({ forever_only: { quests_known: 50 }, wanted }));
  assert.equal((html.match(/<span class="pg-wtitle">/g) || []).length, 40);
  assert.match(html, /<p class="pf-more">and 5 more<\/p>/);
});

test("the Function: noindex until the feature is on, and whole without coverage.json", async () => {
  const env = { ASSETS: assets({ "/data/coverage.json": FIXTURE }) };
  const res = await progressGet({ request, env });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex");
  assert.match(await res.text(), /<strong>43<\/strong> quests captured/);

  const on = await progressGet({ request, env: { ...env, SITE_FEATURES: "contribute" } });
  assert.equal(on.headers.get("X-Robots-Tag"), null);
  assert.ok(!(await on.text()).includes('name="robots"'));

  const empty = await progressGet({ request, env: { ASSETS: assets({}) } });
  assert.equal(empty.status, 200);
  const html = await empty.text();
  assert.match(html, /The first count comes with the next nightly update/);
  assert.ok(!html.includes('id="wanted"') && !html.includes("Zone by zone"));
  assert.match(html, /href="\/contribute"/);
});
