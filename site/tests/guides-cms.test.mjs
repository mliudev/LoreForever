// The guides editor (lib/guides-cms.js, /guides/edit; site/GUIDES.md): only editors write, a save is live at once,
// the editor's copy wins over a file article, and pictures go up and come back. Run: node --test site/tests/guides-cms.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { d1, r2 } from "./helpers.mjs";
import { setup, findOrCreateUser, startSession } from "../lib/accounts.js";
import { onRequestGet as apiGet, onRequestPost as apiPost } from "../functions/api/guides/index.js";
import { onRequestPost as imagePost } from "../functions/api/guides/image.js";
import { onRequestGet as imgGet } from "../functions/guides/img/[name].js";
import { onRequestGet as articleGet } from "../functions/guides/[slug].js";
import { onRequestGet as indexGet } from "../functions/guides/index.js";
import { onRequestGet as sitemapGet } from "../functions/guides/sitemap.xml.js";
import { renderMarkdown } from "../lib/guides.js";

const ORIGIN = "https://loreforeverwow.com";
const FILE = `---
title: Old file guide
description: Written in git before the editor.
date: 2026-10-17
kind: tutorial
draft: true
---
The file's words.
`;

// ASSETS with one file article and its index.
const assets = { async fetch(url) {
  const p = new URL(url).pathname;
  if (p === "/guides/articles/index.json") {
    return Response.json([{ slug: "old-file-guide", title: "Old file guide", description: "x", date: "2026-10-17", kind: "tutorial", draft: true }]);
  }
  return p === "/guides/articles/old-file-guide.md" ? new Response(FILE) : new Response("<!doctype html>", { status: 200 });
} };

async function site() {
  const env = { DB: d1(), STUDIO: r2(), ASSETS: assets, GUIDE_EDITORS: "Patrick@Example.com, mike@example.com" };
  await setup(env);
  const cookie = async email => {
    const user = await findOrCreateUser(env, { email, googleSub: email, name: email });
    return (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  };
  return { env, patrick: await cookie("patrick@example.com"), stranger: await cookie("someone@example.com") };
}

const post = (env, cookie, body) => apiPost({ env, request: new Request(`${ORIGIN}/api/guides`, {
  method: "POST", headers: { Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
const page = (env, slug) => articleGet({ env, request: new Request(`${ORIGIN}/guides/${slug}`), params: { slug } });
const list = async env => (await indexGet({ env, request: new Request(`${ORIGIN}/guides`) })).text();
const meta = (over = {}) => ({ title: "Best class for beginners", description: "Which class to play first.", date: "2026-10-19",
  kind: "tutorial", draft: true, ...over });

test("only editors write; a save is live at once, as a draft and then published; a stale save is refused", async () => {
  const { env, patrick, stranger } = await site();
  const article = { action: "save", slug: "best-class", meta: meta(), body: "Pick a **warrior**.", isNew: true };
  assert.equal((await post(env, "", article)).status, 401);
  assert.equal((await post(env, stranger, article)).status, 403);
  assert.equal((await apiGet({ env, request: new Request(`${ORIGIN}/api/guides`, { headers: { Cookie: stranger } }) })).status, 403);

  const saved = await (await post(env, patrick, article)).json();
  assert.equal(saved.ok, true);
  const draft = await page(env, "best-class");
  assert.equal(draft.status, 200);
  assert.equal(draft.headers.get("X-Robots-Tag"), "noindex");
  assert.match(await draft.text(), /Pick a <strong>warrior<\/strong>/);
  assert.doesNotMatch(await list(env), /best-class/);
  assert.equal((await post(env, patrick, article)).status, 409, "a second new article can't take the same address");

  const live = await post(env, patrick, { ...article, isNew: false, meta: meta({ draft: false }), base: saved.article.saved_at });
  assert.equal(live.status, 200);
  assert.equal((await page(env, "best-class")).headers.get("X-Robots-Tag"), null);
  assert.match(await list(env), /href="\/guides\/best-class"/);
  assert.match(await (await sitemapGet({ env, request: new Request(`${ORIGIN}/guides/sitemap.xml`) })).text(), /guides\/best-class</);

  const stale = await post(env, patrick, { ...article, isNew: false, base: saved.article.saved_at });
  assert.equal(stale.status, 409, "saving over a newer save is refused");
  const bad = await post(env, patrick, { ...article, slug: "Bad Address!", isNew: true });
  assert.equal(bad.status, 400);
});

test("a file article opens in the editor, the editor's copy then wins, and deleting hides it", async () => {
  const { env, patrick } = await site();
  const get = path => apiGet({ env, request: new Request(`${ORIGIN}${path}`, { headers: { Cookie: patrick } }) });
  const { articles } = await (await get("/api/guides")).json();
  assert.deepEqual(articles.map(a => [a.slug, a.source]), [["old-file-guide", "file"]]);
  const { article } = await (await get("/api/guides?slug=old-file-guide")).json();
  assert.equal(article.body.trim(), "The file's words.");

  await post(env, patrick, { action: "save", slug: "old-file-guide", meta: { ...article, draft: false }, body: "The editor's words.", base: null });
  const html = await (await page(env, "old-file-guide")).text();
  assert.match(html, /The editor&#39;s words\./);
  assert.match(await list(env), /old-file-guide/);
  const { revisions } = await (await get("/api/guides?slug=old-file-guide")).json();
  assert.equal(revisions.length, 1);

  assert.equal((await post(env, patrick, { action: "delete", slug: "old-file-guide" })).status, 200);
  assert.equal((await page(env, "old-file-guide")).status, 404);
  assert.doesNotMatch(await list(env), /old-file-guide/);
});

test("pictures: an editor uploads one, it's served back, and Markdown pictures can't carry a script address", async () => {
  const { env, patrick, stranger } = await site();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const up = (cookie, type = "image/png") => imagePost({ env, request: new Request(`${ORIGIN}/api/guides/image`, {
    method: "POST", headers: { Origin: ORIGIN, Cookie: cookie, "Content-Type": type }, body: png }) });
  assert.equal((await up(stranger)).status, 403);
  assert.equal((await up(patrick, "text/html")).status, 415);
  const { url } = await (await up(patrick)).json();
  assert.match(url, /^\/guides\/img\/[0-9a-f]{20}\.png$/);
  const res = await imgGet({ env, params: { name: url.split("/").pop() } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "image/png");
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), png);

  const { html } = renderMarkdown(`![A wisp](${url} "Willo at dusk")\n\nText ![x](javascript:alert(1)) and ![y](//evil.example/a.png).`);
  assert.match(html, new RegExp(`<figure class="gd-fig"><img src="${url}" alt="A wisp" loading="lazy" title="Willo at dusk"><figcaption>Willo at dusk</figcaption></figure>`));
  assert.doesNotMatch(html, /javascript:|evil\.example/);
});
