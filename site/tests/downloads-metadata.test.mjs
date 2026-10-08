import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { publishedFiles } from "../lib/download-files.js";

const snapshot = JSON.parse(readFileSync(new URL("./fixtures/download-catalog/download-files.json", import.meta.url)));
const script = readFileSync(new URL("../public/voices-page.js", import.meta.url), "utf8");

async function render(data) {
  const size = { dataset: { asset: "latest:LoreForever.zip" }, textContent: "" };
  const total = { dataset: { assets: JSON.stringify(["latest:LoreForever_Voice_Female.zip", "latest:LoreForever_Voice_Female_Alliance.zip"]) }, textContent: "" };
  let beacons = 0;
  const link = (href, core = false) => ({ href, handlers: [], classList: { contains: name => core && name === "dl-link" },
    getAttribute() { return this.href; }, setAttribute(name, value) { this[name] = value; },
    addEventListener(event, handler) { if (event === "click") this.handlers.push(handler); } });
  const version = { textContent: "" }, links = [link("/download/zip", true), link("/download/voice/female-complete")];
  const doc = {
    querySelectorAll: selector => selector === ".dl-size[data-asset]" ? [size]
      : selector === ".dl-size[data-assets]" ? [total]
      : selector === "[data-latest-version]" ? [version]
      : selector === 'a[href^="/download/"]' ? links : selector === ".dl-link" ? [links[0]] : [],
    getElementById: () => null, addEventListener() {},
  };
  runInNewContext(script, { document: doc, fetch: async () => ({ ok: true, json: async () => data }),
    window: { addEventListener() {} }, location: { hash: "" }, navigator: { sendBeacon() { beacons++; } } });
  await new Promise(resolve => setImmediate(resolve));
  return { size, total, version, links, clicks() { links.forEach(l => l.handlers.forEach(h => h())); return beacons; } };
}

test("published fallback displays exact sizes and pins downloads to the displayed release", async () => {
  const result = await render(publishedFiles(snapshot));
  assert.equal(result.size.textContent, "356 MB");
  assert.equal(result.total.textContent, "233 MB");
  assert.equal(result.version.textContent, "v0.11.0");
  assert.equal(result.links[0].href, "https://github.com/mliudev/LoreForever/releases/download/v0.11.0/LoreForever.zip");
  assert.equal(result.clicks(), 2, "core and voice download each send exactly one click beacon");
});

test("healthy latest metadata uses current files and keeps tracked download routes", async () => {
  const result = await render({ latestTag: "v0.11.0", byTag: { latest: { "LoreForever.zip": 900000000 } } });
  assert.equal(result.size.textContent, "900 MB");
  assert.equal(result.total.textContent, "Size unavailable");
  assert.equal(result.version.textContent, "v0.11.0");
  assert.equal(result.links[0].href, "/download/zip");
  assert.equal(result.clicks(), 1, "the regular core handler remains single-counted");
});
