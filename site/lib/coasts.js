// The coasts behind the road chart (LOR-303): our own simplified outlines of Kalimdor and the Eastern Kingdoms, so the
// stops sit on land instead of an empty dark box. Placed point by point in the chart's own units (lib/roadchart.js
// W x H, the same space as its LANDS), around where the chart puts each land, not traced from any map: no Blizzard art
// (the map art research on LOR-24). The world before the Dark Portal reopens: Thousand Needles a dry canyon, Darkshore
// and Azshara whole, Gilneas behind its wall, and no Quel'Thalas, Outland or anything later.
//
// Each landmass is a ring of points. Drawing it puts a little wiggle between each two (one round of midpoint
// displacement from a fixed seed, so it's the same every time and reads as a coast, not a blob), then a smooth curve
// through them all. Zephras Isle floats in Skywall, not on the sea: no wiggle, and a dashed coast.

const r1 = n => Math.round(n * 10) / 10;

// [id, name, points]: clockwise, from the north. A lake is a ring too, cut out of the land around it.
export const LANDMASSES = [
  ["kalimdor", "Kalimdor", [
    [172, 102], [186, 90], [202, 82], [218, 72], [232, 56], [248, 48], [266, 46], [282, 52], [294, 62], [308, 56],
    [322, 46], [342, 40], [364, 44], [380, 56], [390, 74], [388, 94], [384, 108], [396, 116], [414, 116], [430, 122],
    [446, 130], [452, 142], [440, 150], [434, 160], [446, 170], [454, 182], [440, 192], [422, 194], [406, 200],
    [400, 214], [404, 232], [410, 250], [406, 268], [412, 284], [402, 298], [390, 310], [374, 314], [360, 318],
    [352, 330], [358, 344], [374, 350], [390, 352], [404, 360], [414, 374], [408, 388], [416, 400], [406, 414],
    [392, 422], [382, 438], [374, 456], [380, 474], [394, 486], [406, 504], [412, 526], [406, 548], [396, 566],
    [380, 582], [358, 594], [334, 600], [312, 594], [292, 588], [270, 590], [248, 594], [226, 592], [206, 598],
    [186, 606], [164, 608], [142, 610], [118, 604], [96, 592], [82, 576], [76, 556], [80, 536], [72, 516], [66, 496],
    [72, 478], [64, 460], [60, 440], [66, 422], [58, 404], [50, 384], [46, 362], [52, 340], [46, 320], [52, 300],
    [64, 286], [80, 280], [96, 272], [110, 262], [118, 246], [126, 230], [138, 214], [136, 194], [144, 178],
    [148, 160], [152, 142], [156, 126], [162, 112],
  ]],
  ["teldrassil", "Teldrassil", [
    [112, 22], [130, 24], [146, 30], [158, 42], [166, 58], [162, 74], [150, 86], [132, 94], [112, 96], [94, 90],
    [80, 80], [72, 64], [74, 46], [84, 34], [98, 26],
  ]],
  ["echo", "Echo Isles", [[418, 300], [428, 303], [429, 312], [421, 317], [413, 311]]],
  ["theramore", "Theramore Isle", [[426, 380], [434, 383], [433, 391], [425, 393], [421, 386]]],
  ["sardor", "Sardor Isle", [[40, 444], [50, 442], [54, 452], [46, 461], [37, 456]]],
  ["eastern", "Eastern Kingdoms", [
    [560, 88], [570, 74], [586, 66], [604, 68], [620, 62], [638, 58], [656, 62], [672, 56], [690, 52], [708, 56],
    [724, 64], [742, 58], [762, 52], [786, 54], [808, 50], [830, 52], [848, 60], [862, 74], [868, 92], [864, 108],
    [872, 124], [866, 140], [858, 152], [860, 168], [856, 186], [860, 202], [848, 214], [838, 226], [832, 242],
    [822, 256], [814, 268], [812, 282], [818, 296], [830, 308], [840, 322], [846, 340], [852, 358], [862, 374],
    [872, 390], [886, 402], [896, 420], [900, 442], [892, 464], [880, 478], [870, 494], [872, 514], [866, 534],
    [870, 554], [866, 574], [858, 594], [844, 608], [824, 616], [802, 614], [782, 606], [768, 594], [762, 580],
    [748, 582], [736, 594], [726, 610], [714, 626], [700, 636], [684, 638], [670, 630], [660, 616], [648, 604],
    [632, 598], [614, 592], [596, 586], [582, 572], [576, 554], [580, 536], [576, 516], [584, 500], [590, 482],
    [598, 466], [598, 448], [606, 432], [612, 414], [616, 396], [620, 378], [626, 360], [626, 342], [638, 328],
    [654, 316], [672, 306], [690, 296], [708, 290], [726, 284], [742, 278], [756, 272], [740, 264], [722, 262],
    [706, 256], [688, 258], [670, 252], [652, 256], [634, 252], [616, 258], [598, 264], [580, 270], [560, 278],
    [540, 276], [524, 266], [512, 250], [508, 232], [514, 214], [526, 204], [534, 190], [540, 174], [538, 156],
    [544, 138], [546, 120], [552, 102],
  ]],
  ["lordamere", "Lordamere Lake", [
    [604, 150], [620, 144], [634, 150], [642, 164], [636, 180], [620, 186], [606, 180], [598, 166],
  ]],
  ["zephras", "Zephras Isle", [
    [494, 50], [506, 52], [516, 60], [520, 72], [512, 84], [498, 90], [484, 86], [474, 76], [476, 62], [484, 54],
  ]],
];
const SKY = new Set(["zephras"]);

// A point between each two, pushed off the line by up to WIGGLE of their distance, either way.
const WIGGLE = 0.22;
export function wiggle(points, seed) {
  let s = seed;
  const rand = () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x80000000;
  return points.flatMap((p, i) => {
    const q = points[(i + 1) % points.length];
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1, k = (rand() - 0.5) * 2 * WIGGLE * len;
    return [p, [Math.round((p[0] + q[0]) / 2 - dy / len * k), Math.round((p[1] + q[1]) / 2 + dx / len * k)]];
  });
}

// A closed ring as one smooth path: a Catmull-Rom curve through every point. Its cubic Béziers mirror their control
// points at each point, so after the first one each is an "s" (relative, the first control point implied).
export function coastPath(points) {
  const n = points.length, at = i => points[(i + n) % n];
  const [a, b, c, e] = [at(-1), at(0), at(1), at(2)];
  let d = `M${b[0]} ${b[1]}c${r1((c[0] - a[0]) / 6)} ${r1((c[1] - a[1]) / 6)} ${r1(c[0] - b[0] - (e[0] - b[0]) / 6)} ` +
    `${r1(c[1] - b[1] - (e[1] - b[1]) / 6)} ${c[0] - b[0]} ${c[1] - b[1]}`;
  for (let i = 1; i < n; i++) {
    const [p, q, s] = [at(i), at(i + 1), at(i + 2)];
    d += `s${r1(q[0] - p[0] - (s[0] - p[0]) / 6)} ${r1(q[1] - p[1] - (s[1] - p[1]) / 6)} ${q[0] - p[0]} ${q[1] - p[1]}`;
  }
  return (d + "z").replace(/ -/g, "-");
}

// Each landmass's coast as drawn: {id, name, sky, d} (sky: floats in Skywall, dashed and without the wiggle).
export const COASTLINES = LANDMASSES.map(([id, name, points], i) => {
  const sky = SKY.has(id);
  return { id, name, sky, d: coastPath(sky ? points : wiggle(points, 7 + i * 31)) };
});

// The land for the back of the chart, so the roads and stops go over it: the shallows, then the land with its
// coastline (one path, used twice), then the isle in the sky.
export const COASTS = `<g class="pf-ch-land"><defs><path id="pf-ch-coastline" vector-effect="non-scaling-stroke" ` +
  `d="${COASTLINES.filter(c => !c.sky).map(c => c.d).join("")}"/></defs><use href="#pf-ch-coastline" class="pf-ch-shallows"/>` +
  `<use href="#pf-ch-coastline" class="pf-ch-coast"/><path class="pf-ch-coast pf-ch-sky" vector-effect="non-scaling-stroke" ` +
  `d="${COASTLINES.filter(c => c.sky).map(c => c.d).join("")}"/></g>`;
