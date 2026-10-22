// The guides editor (lib/guides-cms.js, /guides/edit; site/GUIDES.md): only editors write, a save is live at once,
// the editor's copy wins over a file article, and pictures go up and come back. Run: node --test site/tests/guides-cms.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { d1, r2 } from "./helpers.mjs";
import { setup, findOrCreateUser, startSession } from "../lib/accounts.js";
import { onRequestGet as apiGet, onRequestPost as apiPost } from "../functions/api/guides/index.js";
import { onRequestPost as imagePost } from "../functions/api/guides/image.js";
import { onRequestGet as imgGet } from "../functions/guides/img/[name].js";
import { onRequestGet as articleGet, onRequestHead as articleHead } from "../functions/guides/[slug].js";
import { onRequestGet as indexGet } from "../functions/guides/index.js";
import { onRequestGet as sitemapGet } from "../functions/guides/sitemap.xml.js";
import { renderMarkdown } from "../lib/guides.js";
import { onRequestGet as adminGet, onRequestPost as adminPost } from "../functions/api/admin.js";
import { onRequest as sourceRequest } from "../functions/guides/articles/[[path]].js";

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

async function site() {
  const env = { DB: d1(), STUDIO: r2(), GUIDE_FILES: { "old-file-guide": FILE }, GUIDE_EDITORS: "Patrick@Example.com, mike@example.com" };
  await setup(env);
  const cookie = async email => {
    const user = await findOrCreateUser(env, { email, googleSub: email, name: email });
    return (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  };
  return { env, patrick: await cookie("patrick@example.com"), stranger: await cookie("someone@example.com") };
}

const post = (env, cookie, body) => apiPost({ env, request: new Request(`${ORIGIN}/api/guides`, {
  method: "POST", headers: { Origin: ORIGIN, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
const page = (env, slug, cookie = "", method = "GET") => (method === "HEAD" ? articleHead : articleGet)({ env,
  request: new Request(`${ORIGIN}/guides/${slug}`, { method, headers: { Cookie: cookie } }), params: { slug } });
const list = async env => (await indexGet({ env, request: new Request(`${ORIGIN}/guides`) })).text();
const meta = (over = {}) => ({ title: "Best class for beginners", description: "Which class to play first.", date: "2026-10-19",
  kind: "tutorial", draft: true, ...over });

test("an editor's site cookie grants no product admin read or write access", async () => {
  const { env, patrick } = await site();
  env.ADMIN_KEY = "synthetic-owner-only-key";
  const before = env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  assert.equal((await adminGet({ env, request: new Request(`${ORIGIN}/api/admin`, {
    headers: { Cookie: patrick },
  }) })).status, 401);
  assert.equal((await adminPost({ env, request: new Request(`${ORIGIN}/api/admin`, {
    method: "POST", headers: { Origin: ORIGIN, Cookie: patrick, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete-subscriber", email: "someone@example.com" }),
  }) })).status, 401);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get().n, before);
});

test("only editors write; a save is live at once, as a draft and then published; a stale save is refused", async () => {
  const { env, patrick, stranger } = await site();
  const article = { action: "save", slug: "best-class", meta: meta(), body: "Pick a **warrior**.", isNew: true };
  assert.equal((await post(env, "", article)).status, 401);
  assert.equal((await post(env, stranger, article)).status, 403);
  assert.equal((await apiGet({ env, request: new Request(`${ORIGIN}/api/guides`, { headers: { Cookie: stranger } }) })).status, 403);

  const saved = await (await post(env, patrick, article)).json();
  assert.equal(saved.ok, true);
  const draft = await page(env, "best-class", patrick);
  assert.equal(draft.status, 200);
  assert.equal(draft.headers.get("X-Robots-Tag"), "noindex");
  assert.match(await draft.text(), /Pick a <strong>warrior<\/strong>/);
  assert.doesNotMatch(await list(env), /best-class/);
  assert.equal((await post(env, patrick, article)).status, 409, "a second new article can't take the same address");

  const live = await post(env, patrick, { ...article, isNew: false, meta: meta({ draft: false }), base: saved.article.saved_at });
  assert.equal(live.status, 200);
  assert.equal((await page(env, "best-class")).headers.get("X-Robots-Tag"), null);
  for (const cookie of ["", stranger, patrick]) {
    assert.equal((await page(env, "best-class", cookie)).status, 200);
    assert.equal((await page(env, "best-class", cookie, "HEAD")).status, 200);
  }
  assert.match(await list(env), /href="\/guides\/best-class"/);
  assert.match(await (await sitemapGet({ env, request: new Request(`${ORIGIN}/guides/sitemap.xml`) })).text(), /guides\/best-class</);

  const stale = await post(env, patrick, { ...article, isNew: false, base: saved.article.saved_at });
  assert.equal(stale.status, 409, "saving over a newer save is refused");
  const bad = await post(env, patrick, { ...article, slug: "Bad Address!", isNew: true });
  assert.equal(bad.status, 400);
});

test("saved and file drafts are private to signed-in guide editors, including HEAD", async () => {
  const { env, patrick, stranger } = await site();
  await post(env, patrick, { action: "save", slug: "private-draft", meta: meta(), body: "Secret draft words.", isNew: true });
  for (const slug of ["private-draft", "old-file-guide"]) {
    for (const cookie of ["", stranger, patrick]) {
      for (const method of ["GET", "HEAD"]) {
        const res = await page(env, slug, cookie, method);
        assert.equal(res.status, cookie === patrick ? 200 : 404, `${slug}: ${method} must enforce editor access`);
        assert.equal(res.headers.get("Cache-Control"), "private, no-store");
        assert.equal(res.headers.get("X-Robots-Tag"), "noindex");
        const text = await res.text();
        if (method === "HEAD") assert.equal(text, "");
        else if (cookie !== patrick) assert.doesNotMatch(text, /Secret draft words|The file&#39;s words/);
      }
    }
  }
});

test("source Markdown and indexes cannot bypass draft or deletion checks", async () => {
  const { env, patrick, stranger } = await site();
  const routes = JSON.parse(readFileSync(new URL("../public/_routes.json", import.meta.url), "utf8"));
  const matches = (pattern, path) => new RegExp(`^${pattern.replaceAll("*", ".*")}$`).test(path);
  for (const path of ["/guides/articles/index.json", "/guides/articles/old-file-guide.md", "/guides/articles/nested/draft.md"]) {
    assert.ok(routes.include.some(pattern => matches(pattern, path)));
    assert.ok(!routes.exclude.some(pattern => matches(pattern, path)), `${path} must run through Functions`);
    for (const cookie of ["", stranger, patrick]) {
      for (const method of ["GET", "HEAD"]) {
        const res = await sourceRequest({ env, request: new Request(ORIGIN + path, { method, headers: { Cookie: cookie } }) });
        assert.equal(res.status, 404);
        assert.equal(res.headers.get("Cache-Control"), "private, no-store");
        assert.equal(res.headers.get("X-Robots-Tag"), "noindex");
        assert.equal(await res.text(), "");
      }
    }
  }
});

test("a CMS read failure cannot restore file copies of drafts or deleted articles", async () => {
  const { env, patrick } = await site();
  // The bundled version was public before its CMS override made it private.
  env.GUIDE_FILES = { "old-file-guide": FILE.replace("draft: true", "draft: false") };
  assert.equal((await page(env, "old-file-guide")).status, 200);
  const draft = await post(env, patrick, { action: "save", slug: "old-file-guide", meta: meta(), body: "Private edit.", base: null });
  assert.equal(draft.status, 200);
  const original = env.DB.prepare;
  const breakReads = () => { env.DB.prepare = sql => {
    if (/^SELECT .* FROM guides\b/.test(sql)) throw new Error("D1_ERROR: database read unavailable");
    return original(sql);
  }; };
  const check = async () => {
    for (const cookie of ["", patrick]) {
      for (const method of ["GET", "HEAD"]) assert.equal((await page(env, "old-file-guide", cookie, method)).status, 503);
    }
    for (const handler of [indexGet, sitemapGet]) {
      const res = await handler({ env, request: new Request(`${ORIGIN}/guides`) });
      assert.equal(res.status, 503);
      assert.equal(res.headers.get("Cache-Control"), "private, no-store");
      assert.doesNotMatch(await res.text(), /Old file guide|old-file-guide/);
    }
    const res = await apiGet({ env, request: new Request(`${ORIGIN}/api/guides?slug=old-file-guide`, { headers: { Cookie: patrick } }) });
    assert.equal(res.status, 503);
  };
  breakReads();
  await check();
  env.DB.prepare = original;
  assert.equal((await post(env, patrick, { action: "delete", slug: "old-file-guide" })).status, 200);
  breakReads();
  await check();
});

test("private live preview and revisions still work for editors", async () => {
  const { env, patrick, stranger } = await site();
  const input = { action: "preview", slug: "private-draft", meta: meta(), body: "Private **preview**." };
  for (const cookie of ["", stranger]) assert.notEqual((await post(env, cookie, input)).status, 200);
  const preview = await post(env, patrick, input);
  assert.equal(preview.headers.get("Cache-Control"), "private, no-store");
  assert.equal(preview.headers.get("X-Robots-Tag"), "noindex");
  assert.match((await preview.json()).html, /Private <strong>preview<\/strong>/);
  await post(env, patrick, { ...input, action: "save", isNew: true });
  const read = async suffix => apiGet({ env, request: new Request(`${ORIGIN}/api/guides?slug=private-draft${suffix}`, { headers: { Cookie: patrick } }) });
  const current = await (await read("")).json();
  const rev = await read(`&revision=${current.revisions[0].id}`);
  assert.equal(rev.status, 200);
  assert.equal(rev.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await rev.json()).article.body, input.body);
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
