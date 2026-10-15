// How a profile's journey is cut into chapters (lib/chapters.js, Mike 10/11): one a play day, a short day going in with
// the next, the newest shown in full and the older folded to a line. Run: node --test site/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { moments } from "../lib/trails.js";
import { readJourney } from "../lib/journey.js";
import { chapters, chaptersSection, OPEN } from "../lib/chapters.js";

const DAY = 86400, T0 = Date.UTC(2026, 9, 1, 18) / 1000;
// n moments in zone z on day d (from 0), with a level at the end when lv is given.
const day = (d, z, n, lv) => [{ k: "zone", t: T0 + d * DAY, z, new: 1 },
  ...Array.from({ length: n - 1 - (lv ? 1 : 0) }, (_, i) => ({ k: "npc", t: T0 + d * DAY + 60 * (i + 1), n: `Guard ${i}`, z })),
  ...(lv ? [{ k: "lvl", t: T0 + d * DAY + 3000, lv, z }] : [])];
const told = days => moments({}, undefined, readJourney({ v: 1, tz: 0, moments: days.flat() }));

test("a chapter a day; a short day goes in with the next, and the newest stays its own", () => {
  const list = told([day(0, "Elwynn Forest", 12), day(1, "Westfall", 3), day(2, "Westfall", 12, 11), day(3, "Duskwood", 2)]);
  const chs = chapters(list, "Aelric");
  assert.deepEqual(chs.map(c => c.days), [["2026-10-01"], ["2026-10-02", "2026-10-03"], ["2026-10-04"]]);
  assert.deepEqual(chs.map(c => [c.first, c.last]), [[0, 11], [12, 26], [27, 28]], "every moment in exactly one chapter, in order");
  assert.deepEqual(chs.map(c => c.title), ["Elwynn Forest", "Westfall", "Duskwood"]);
  assert.equal(chs[1].summary, "Aelric reached level 11 and first saw Westfall.", "told from its facts");
  assert.deepEqual(chs[2].fresh, ["duskwood"], "a land counts as new once");
});

test("the newest chapters are shown in full; older ones fold to a line each", () => {
  const list = told(Array.from({ length: OPEN + 3 }, (_, d) => day(d, d % 2 ? "Westfall" : "Elwynn Forest", 10)));
  const html = chaptersSection(chapters(list, "Aelric"));
  assert.equal((html.match(/<article class="pf-ch"/g) || []).length, OPEN);
  assert.equal((html.match(/<details class="pf-chx"/g) || []).length, 3);
  const at = n => html.indexOf(`id="ch-${n}"`);
  assert.ok(at(OPEN + 3) < at(OPEN + 2) && at(5) < at(4), "newest first, back in time (Mike, 10/14)");
  assert.ok(at(4) < at(3) && at(3) < at(2) && at(2) < at(1), "the older ones folded below, still going back");
  assert.ok(!html.slice(html.indexOf('class="pf-earlier"')).includes('id="m-'), "folded chapters list no moments");
});

test("a battleground is told as a battle, from older journeys and with the add-on's record of it (LOR-430)", () => {
  const bg = "Darkspear Islands", t = T0 + DAY + 3600;
  const battle = [{ k: "zone", t, z: bg, inst: 1, how: "instance", new: 1 },
    { k: "zone", t: t + 300, z: bg, s: "Shipwreck Cove", inst: 1, how: "walk", new: 1 },
    ...[1, 2, 3].map(i => ({ k: "death", t: t + 300 + 60 * i, z: bg, s: "Shipwreck Cove" }))];
  const before = [...day(0, "Elwynn Forest", 12), ...day(1, "Ironforge", 10)];
  // A journey from before the battle capture: the entry and the falls, nothing about how it ended.
  let c = chapters(told([before, battle]), "Húrin", "Alliance")[1];
  assert.equal(c.title, bg);
  assert.equal(c.summary, "Húrin fought for the Alliance at Darkspear Islands and first saw Ironforge.");
  assert.deepEqual(c.hi.find(h => h.icon === "battle"), { icon: "battle", label: "Battle at Darkspear Islands",
    text: "for the Alliance against the Horde over the Darkspear trolls' sacred isles; fell 3 times and fought on" });
  assert.ok(!c.hi.some(h => h.icon === "death" || (h.icon === "land" && h.text.includes(bg))), c.hi);
  // With the add-on's battle: how it ended.
  c = chapters(told([before, battle, [{ k: "bg", t: t + 1500, n: bg, out: "loss" }]]), "Húrin", "Alliance")[1];
  assert.match(c.summary, /fought for the Alliance at Darkspear Islands \(lost\)/);
  assert.match(c.hi.find(h => h.icon === "battle").text, /; lost; fell 3 times/);
  assert.match(chaptersSection([c]), /Fought at <span class="pf-thing">Darkspear Islands<\/span> <span class="pf-sub">lost<\/span>/);
});
