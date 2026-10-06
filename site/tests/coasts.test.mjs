// The coasts behind the road chart (LOR-303, lib/coasts.js): our own drawing, behind the roads and stops, every land of
// the chart on its own continent and well inside its coast, and nothing from the game's files. Run: node --test site/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COASTS, COASTLINES, LANDMASSES, coastPath, wiggle } from "../lib/coasts.js";
import { LANDS, W, H, roadChart, fitView } from "../lib/roadchart.js";
import { moments } from "../lib/trails.js";
import { parseRecord, readJourney } from "../lib/journey.js";
import { profilePage, templateStory } from "../lib/profiles.js";
import { SITE } from "./helpers.mjs";
import { RECORD } from "./fixtures/journey/record.mjs";

const NOW = new Date("2026-10-04T12:00:00Z");
const at = iso => Date.parse(iso) / 1000;

// A path as lib/coasts.js writes it (M, then relative c and s, then z) as points along it: each curve's ends and seven
// points between them.
function trace(d) {
  const out = [];
  let cur = null, ctrl = null;
  for (const [, cmd, args] of d.matchAll(/([Mcsz])([^Mcsz]*)/g)) {
    const n = (args.match(/-?\d*\.?\d+/g) || []).map(Number);
    if (cmd === "M") { cur = [n[0], n[1]]; out.push(cur); continue; }
    if (cmd === "z") continue;
    const rel = (i) => [cur[0] + n[i], cur[1] + n[i + 1]];
    const [c1, c2, end] = cmd === "c" ? [rel(0), rel(2), rel(4)] : [[2 * cur[0] - ctrl[0], 2 * cur[1] - ctrl[1]], rel(0), rel(2)];
    for (let k = 1; k <= 8; k++) {
      const t = k / 8, u = 1 - t;
      out.push([0, 1].map(j => u * u * u * cur[j] + 3 * u * u * t * c1[j] + 3 * u * t * t * c2[j] + t * t * t * end[j]));
    }
    [cur, ctrl] = [end, c2];
  }
  return out;
}
// The rings of a path, one per M.
const rings = d => d.split("M").filter(Boolean).map(s => trace("M" + s));
const inside = (ring, [x, y]) => {
  let n = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) n = !n;
  }
  return n;
};
const near = (ring, [x, y]) => Math.min(...ring.map((p, i) => {
  const [ax, ay] = p, [bx, by] = ring[(i + 1) % ring.length];
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
}));

const coast = Object.fromEntries(COASTLINES.map(c => [c.id, rings(c.d)[0]]));
// Where each land of the chart belongs: the two isles have their own, the rest by continent.
const home = ([key, , x]) => ({ darnassus: "teldrassil", teldrassil: "teldrassil", zephras: "zephras" })[key] ||
  (x < 480 ? "kalimdor" : "eastern");

test("a coast is a smooth closed curve through every one of its points, in the chart's units", () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const d = coastPath(square);
  assert.match(d, /^M0 0c[^Mcsz]+(s[^Mcsz]+){3}z$/);
  const pts = trace(d);
  for (const p of square) assert.ok(pts.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9), String(p));
  // The wiggle adds a point between each two, the same every time, and keeps the ones drawn by hand.
  const k = LANDMASSES[0][2];
  assert.deepEqual(wiggle(k, 7), wiggle(k, 7));
  assert.equal(wiggle(k, 7).length, k.length * 2);
  assert.deepEqual(wiggle(k, 7).filter((_, i) => i % 2 === 0), k);
  for (const c of COASTLINES) {
    for (const [x, y] of trace(c.d)) assert.ok(x >= 0 && x <= W && y >= 0 && y <= H, `${c.id}: ${x},${y} is off the chart`);
  }
});

test("every land of the chart sits on its own continent, well inside the coast and out of the lakes", () => {
  for (const land of LANDS) {
    const [, name, x, y] = land;
    const on = Object.keys(coast).filter(id => inside(coast[id], [x, y]));
    assert.deepEqual(on, [home(land)], `${name} is on ${on.join(", ") || "the sea"}`);
    const gap = Math.min(...Object.values(coast).map(r => near(r, [x, y])));
    assert.ok(gap >= 15, `${name} is ${gap.toFixed(1)} from a coast`);
  }
  // Teldrassil is an island, across a strait from Darkshore; Kalimdor and the Eastern Kingdoms are apart.
  const apart = (a, b) => Math.min(...coast[a].map(p => near(coast[b], p)));
  assert.ok(apart("teldrassil", "kalimdor") >= 5, "the strait");
  assert.ok(apart("kalimdor", "eastern") >= 40, "the Great Sea");
  for (const isle of ["echo", "theramore", "sardor"]) assert.ok(apart(isle, "kalimdor") >= 4, isle);
});

test("the coasts are our own drawing: inline paths, no pictures, no files from the game", () => {
  assert.ok(!/<image|<img|<text|<title|url\(|https?:|\.(png|jpe?g|webp|gif|blp|tga|svg)\b/i.test(COASTS), "only paths");
  assert.ok(!/interface|worldmap|adventuremap|blizzard|wowhead|zamimg/i.test(COASTS));
  assert.deepEqual([...COASTS.matchAll(/href="([^"]*)"/g)].map(m => m[1]), ["#pf-ch-coastline", "#pf-ch-coastline"]);
  assert.equal([...COASTS.matchAll(/ id="/g)].length, 1, "one id, used twice");
  // No names in the drawing: a land not reached stays unnamed (lib/roadchart.js).
  for (const [, name] of LANDMASSES) assert.ok(!COASTS.includes(name), name);
  // And the chart's styles draw nothing from a file either.
  const css = readFileSync(`${SITE}public/style.css`, "utf8");
  const chart = [...css.matchAll(/^\.pf-(ch|chart)[^{]*\{[^}]*\}/gm)].map(m => m[0]);
  assert.ok(chart.some(r => r.startsWith(".pf-ch-coast {")), "the coast's style is there");
  assert.ok(chart.length >= 10, `${chart.length} chart rules`);
  for (const rule of chart) assert.ok(!/url\(/.test(rule), rule);
});

// A journey through the given lands, one new place an hour.
const through = names => readJourney({ v: 1, tz: 0, moments: names.flatMap((z, i) => [
  { t: at("2026-09-20T12:00:00Z") + i * 3600, k: "zone", z, new: 1 },
  { t: at("2026-09-20T12:00:00Z") + i * 3600 + 60, k: "npc", n: `Someone in ${z}`, z },
]) }, null, NOW);
const chartOf = journey => roadChart(moments(parseRecord(RECORD, NOW), undefined, journey), { name: "Aelric" });

test("the coasts are drawn behind the roads and stops, once, in the chart's hidden backdrop", () => {
  const html = chartOf(through(["Teldrassil", "Darkshore", "Westfall", "Wetlands"]));
  const [world, land, roads, stops] = ['class="pf-ch-world" aria-hidden="true"', 'class="pf-ch-land"', 'class="pf-ch-roads"',
    'class="pf-ch-stops"'].map(s => html.indexOf(s));
  assert.ok(world > 0 && world < land && land < roads && roads < stops, [world, land, roads, stops].join());
  assert.ok(html.indexOf("</g>", land) < roads, "the land is in the backdrop, before the roads");
  assert.equal(html.split(COASTS).length, 2, "drawn once");
  assert.ok(!/<image|<img|\.png|\.jpe?g|\.blp/i.test(html));
  for (const [, href] of html.matchAll(/href="([^"]*)"/g)) assert.match(href, /^#(m-\d+|pf-ch-coastline)$/);
});

test("the coasts with no lands reached, and with every land reached", () => {
  // No land the chart knows (or just one): no chart at all, so no Map view and no empty box.
  assert.equal(roadChart([]), "");
  assert.equal(chartOf(through(["Somewhere Else", "Another Place"])), "");
  assert.equal(chartOf(through(["Westfall"])), "");
  const data = parseRecord(RECORD, NOW);
  const page = j => profilePage({ handle: "aelric", public: 1, data, journey: j, story: templateStory(data),
    story_source: "template", updated: NOW.toISOString() });
  const none = page(through(["Somewhere Else", "Another Place"]));
  assert.ok(!none.includes('id="map"') && !none.includes("pf-ch-land") && !none.includes('data-view="map"'));
  assert.ok(none.includes('id="timeline"'), "the timeline is still there");

  // Every land: each one a stop, no faint dots left, the whole chart in view, and the coasts still behind it all.
  const html = chartOf(through(LANDS.map(l => l[1])));
  assert.equal([...html.matchAll(/class="pf-ch-stop /g)].length, LANDS.length);
  assert.ok(!html.includes("pf-ch-dot"));
  assert.deepEqual(fitView(LANDS.map(l => [l[2], l[3]])), [0, 0, W, H]);
  assert.match(html, /viewBox="0 0 1000 640"/);
  assert.ok(html.indexOf('class="pf-ch-land"') < html.indexOf('class="pf-ch-roads"'));
  const full = page(through(LANDS.map(l => l[1])));
  assert.ok(full.includes('data-view="map"') && full.includes(COASTS));
});
