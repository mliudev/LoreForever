// Guides and lore articles (LOR-414, site/GUIDES.md): /guides, /guides/<slug> and /guides/sitemap.xml from Markdown in
// public/guides/articles. Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SITE } from "./helpers.mjs";

import { onRequestGet as articleGet } from "../functions/guides/[slug].js";
import { onRequestGet as indexGet } from "../functions/guides/index.js";
import { onRequestGet as sitemapGet } from "../functions/guides/sitemap.xml.js";
import { buildIndex } from "../../scripts/guides-index.mjs";

const HOME = "https://loreforeverwow.com";
const ARTICLES = join(SITE, "public", "guides", "articles");

// ASSETS serving a folder of articles (with its index.json) at /guides/articles/. Like Pages, a file it doesn't have
// gets the home page with a 200.
function assets(dir) {
  return { async fetch(url) {
    const path = decodeURIComponent(new URL(url).pathname);
    const p = join(dir, path.replace(/^\/guides\/articles\//, ""));
    return path.startsWith("/guides/articles/") && existsSync(p) ? new Response(readFileSync(p))
      : new Response("<!doctype html><title>Lore Forever</title>", { status: 200 });
  } };
}

const SAMPLE = `---
title: Who was Edwin VanCleef?
description: The stonemason Stormwind refused to pay, and how he built the Defias Brotherhood.
date: 2026-10-12
kind: lore
---
Edwin VanCleef led the **Stonemasons' Guild** that rebuilt [Stormwind](/lore/zone/stormwind). <script>alert(1)</script>

- one
- [bad link](javascript:alert(1))

## FAQ
### Is VanCleef in WoW Forever?
Yes: he waits at the end of the Deadmines.
`;

function folder(articles) {
  const dir = mkdtempSync(join(tmpdir(), "guides-"));
  for (const [slug, text] of Object.entries(articles)) writeFileSync(join(dir, slug + ".md"), text);
  writeFileSync(join(dir, "index.json"), JSON.stringify(buildIndex(dir).index));
  return dir;
}

const get = (fn, path, dir, params = {}) => fn({ request: new Request(HOME + path), env: { ASSETS: assets(dir) }, params });

test("the shipped index.json is current and every article's header is complete", () => {
  const { index, bad } = buildIndex(ARTICLES);
  assert.deepEqual(bad, [], "fix these headers (site/GUIDES.md)");
  assert.deepEqual(JSON.parse(readFileSync(join(ARTICLES, "index.json"), "utf8")), index,
    "public/guides/articles/index.json is stale: run node scripts/guides-index.mjs");
});

test("a published article: its page, FAQ structured data, call to action, the list and the sitemap", async () => {
  const dir = folder({ "who-was-edwin-vancleef": SAMPLE });
  const res = await get(articleGet, "/guides/who-was-edwin-vancleef", dir, { slug: "who-was-edwin-vancleef" });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Robots-Tag"), null);
  assert.match(html, /<h1>Who was Edwin VanCleef\?<\/h1>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/loreforeverwow.com\/guides\/who-was-edwin-vancleef">/);
  assert.match(html, /<a href="\/lore\/zone\/stormwind">Stormwind<\/a>/);
  assert.match(html, /href="\/downloads\?src=guides">Get Lore Forever/);
  // Markdown can't inject HTML or script links.
  assert.doesNotMatch(html, /<script>alert|javascript:/);
  const faq = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(m => JSON.parse(m[1]))
    .find(d => d["@type"] === "FAQPage");
  assert.deepEqual(faq.mainEntity, [{ "@type": "Question", name: "Is VanCleef in WoW Forever?",
    acceptedAnswer: { "@type": "Answer", text: "Yes: he waits at the end of the Deadmines." } }]);
  const list = await (await get(indexGet, "/guides", dir)).text();
  assert.match(list, /href="\/guides\/who-was-edwin-vancleef"/);
  assert.match(await (await get(sitemapGet, "/guides/sitemap.xml", dir)).text(),
    /<loc>https:\/\/loreforeverwow.com\/guides\/who-was-edwin-vancleef<\/loc><lastmod>2026-10-12<\/lastmod>/);
});

test("a draft is readable at its address but kept out of search, the list and the sitemap", async () => {
  const dir = folder({ "who-was-edwin-vancleef": SAMPLE.replace("kind: lore\n", "kind: lore\ndraft: true\n") });
  const res = await get(articleGet, "/guides/who-was-edwin-vancleef", dir, { slug: "who-was-edwin-vancleef" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex");
  assert.match(await res.text(), /<meta name="robots" content="noindex">/);
  const list = await get(indexGet, "/guides", dir);
  assert.equal(list.headers.get("X-Robots-Tag"), "noindex", "no published guides yet: /guides is noindex");
  assert.doesNotMatch(await list.text(), /who-was-edwin-vancleef/);
  assert.doesNotMatch(await (await get(sitemapGet, "/guides/sitemap.xml", dir)).text(), /<url>/);
  const missing = await get(articleGet, "/guides/nope", dir, { slug: "nope" });
  assert.equal(missing.status, 404);
});
