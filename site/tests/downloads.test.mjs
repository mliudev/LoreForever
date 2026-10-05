// The home page's download count (functions/api/downloads.js), with GitHub, CurseForge, cfwidget and shields.io
// faked. Run: node --test 'site/tests/*.test.mjs'

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, shieldsNumber } from "../functions/api/downloads.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const release = (...assets) => ({ assets: assets.map(([name, download_count]) => ({ name, download_count })) });
const PAGE1 = [release(["LoreForever.zip", 100], ["LoreForever-Setup.exe", 20], ["checksums.txt", 999])];
const PAGE2 = [release(["LoreForever.zip", 5], ["LoreForever_Voice_Female.zip", 3])];

// routes: {url substring: body | status number | (headers) => body}
function fake(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), headers: opts.headers || {} });
    for (const [part, body] of Object.entries(routes)) {
      if (!String(url).includes(part)) continue;
      if (typeof body === "number") return new Response("no", { status: body });
      const headers = {};
      if (part === "releases?per_page=100") headers.link = '<https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="next"';
      return Response.json(typeof body === "function" ? body(opts.headers) : body, { headers });
    }
    throw new Error("unexpected fetch " + url);
  };
  return calls;
}
const get = async env => (await onRequestGet({ request: new Request("https://loreforeverwow.com/api/downloads"), env })).json();

test("shields.io messages", () => {
  assert.equal(shieldsNumber("950"), 950);
  assert.equal(shieldsNumber("5.2k"), 5200);
  assert.equal(shieldsNumber("3M"), 3e6);
  assert.equal(shieldsNumber("invalid"), null);
});

test("sums zip and exe assets on every page of releases, plus CurseForge's official count", async () => {
  const calls = fake({
    "page=2": PAGE2, "releases?per_page=100": PAGE1,
    "api.curseforge.com/v1/mods/1715510": h => ({ data: { downloadCount: h["x-api-key"] === "k" ? 5153 : 0 } }),
  });
  const d = await get({ CURSEFORGE_API_KEY: "k", GITHUB_TOKEN: "t" });
  assert.deepEqual(d, { total: 128 + 5153, github: 128, curseforge: 5153, curseforgeSource: "api" });
  assert.equal(calls.find(c => c.url.includes("github")).headers.Authorization, "Bearer t");
});

test("without a CurseForge key, cfwidget's exact total; then shields.io's rounded one", async () => {
  fake({ "releases?per_page=100": [], "api.cfwidget.com/1715510": { downloads: { total: 5153 } } });
  assert.deepEqual(await get({}), { total: 5153, github: 0, curseforge: 5153, curseforgeSource: "cfwidget" });

  fake({ "releases?per_page=100": [], "api.curseforge.com": 403, "api.cfwidget.com": 500,
    "img.shields.io/curseforge/dt/1715510.json": { message: "5.2k" } });
  assert.deepEqual(await get({ CURSEFORGE_API_KEY: "k" }), { total: 5200, github: 0, curseforge: 5200, curseforgeSource: "shields" });
});

test("a failed source comes back null, so the page asks it itself", async () => {
  fake({ "releases?per_page=100": 403, "api.cfwidget.com": 500, "img.shields.io": 500 });
  assert.deepEqual(await get({}), { total: 0, github: null, curseforge: null, curseforgeSource: null });
});

test("the audio release (the recordings each release build fetches, LOR-133) isn't counted", async () => {
  const audio = { tag_name: "audio", assets: [{ name: "LoreForever_Voice_Default-0123456789abcdef.zip", download_count: 50 }] };
  fake({ "page=2": [], "releases?per_page=100": [audio, release(["LoreForever.zip", 7])],
    "api.cfwidget.com/1715510": { downloads: { total: 0 } } });
  assert.equal((await get({})).github, 7);
});
