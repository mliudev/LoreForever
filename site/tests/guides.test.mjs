// Guides and lore articles (LOR-414, site/GUIDES.md): /guides, /guides/<slug> and /guides/sitemap.xml from Markdown in
// the private Worker bundle. Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SITE } from "./helpers.mjs";

import { onRequestGet as articleGet } from "../functions/guides/[slug].js";
import { onRequestGet as indexGet } from "../functions/guides/index.js";
import { onRequestGet as sitemapGet } from "../functions/guides/sitemap.xml.js";
import { buildIndex, bundleText } from "../../scripts/guides-index.mjs";
import bundledFiles from "../lib/guide-files.js";

const HOME = "https://loreforeverwow.com";
const ARTICLES = join(SITE, "content", "guides", "articles");

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

const get = (fn, path, files, params = {}) => fn({ request: new Request(HOME + path), env: { GUIDE_FILES: files }, params });

test("the private index and source bundle are current; article sources are absent from public assets", () => {
  const { index, bad, files } = buildIndex(ARTICLES);
  assert.deepEqual(bad, [], "fix these headers (site/GUIDES.md)");
  assert.deepEqual(JSON.parse(readFileSync(join(ARTICLES, "index.json"), "utf8")), index,
    "content/guides/articles/index.json is stale: run node scripts/guides-index.mjs");
  assert.deepEqual(bundledFiles, files, "Worker source bundle is stale: run node scripts/guides-index.mjs");
  assert.equal(readFileSync(join(SITE, "lib", "guide-files.js"), "utf8"), bundleText(files));
  assert.equal(existsSync(join(SITE, "public", "guides", "articles")), false,
    "Article sources must stay outside public/ so encoded URLs cannot bypass the Worker");
});

test("a published article: its page, FAQ structured data, call to action, the list and the sitemap", async () => {
  const dir = { "who-was-edwin-vancleef": SAMPLE };
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

test("a file draft is private and kept out of search, the list and the sitemap", async () => {
  const dir = { "who-was-edwin-vancleef": SAMPLE.replace("kind: lore\n", "kind: lore\ndraft: true\n") };
  const res = await get(articleGet, "/guides/who-was-edwin-vancleef", dir, { slug: "who-was-edwin-vancleef" });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex");
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  assert.match(await res.text(), /<meta name="robots" content="noindex">/);
  const list = await get(indexGet, "/guides", dir);
  assert.equal(list.headers.get("X-Robots-Tag"), "noindex", "no published guides yet: /guides is noindex");
  assert.doesNotMatch(await list.text(), /who-was-edwin-vancleef/);
  assert.doesNotMatch(await (await get(sitemapGet, "/guides/sitemap.xml", dir)).text(), /<url>/);
  const missing = await get(articleGet, "/guides/nope", dir, { slug: "nope" });
  assert.equal(missing.status, 404);
});
