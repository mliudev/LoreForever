// The site header and the pages it leads to (LOR-222): every page carries the same nav as lib/voices.js SITE_NAV,
// /downloads is the Downloads page and /voices sends old links there, and the What's new pieces agree on the newest
// version. pipeline/tests/test_changelog_site.py checks that changelog.py writes those copies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SITE_NAV, page } from "../lib/voices.js";
import { onRequestGet as voicesRedirect } from "../functions/voices/index.js";
import { onRequestGet as downloadsPage } from "../functions/downloads/index.js";
import { profilePage, missingPage } from "../lib/profiles.js";

const PUBLIC = new URL("../public/", import.meta.url).pathname;
const read = f => readFileSync(join(PUBLIC, f), "utf8");

function pages(dir = PUBLIC) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return pages(p);
    return name.endsWith(".html") ? [p] : [];
  });
}

test("every page with the header script carries the same nav", () => {
  const withHeader = pages().filter(p => readFileSync(p, "utf8").includes('<script src="/header.js"'));
  assert.ok(withHeader.length >= 15, `only ${withHeader.length} pages`);
  for (const p of withHeader) {
    const html = readFileSync(p, "utf8");
    assert.ok(html.includes(`<header class="top">\n${SITE_NAV}`), `${relative(PUBLIC, p)}: header differs from SITE_NAV`);
  }
  for (const label of ["Download", "What's new", "Make your profile", "Community"]) assert.ok(SITE_NAV.includes(label), label);
  assert.match(SITE_NAV, /href="\/downloads"/);
  assert.match(SITE_NAV, /href="\/whats-new"/);
  assert.match(SITE_NAV, /href="\/account#profile"/);
});

test("generated pages: the nav, and a breadcrumb only where one helps", () => {
  const voice = page({ title: "X", description: "d", path: "/voices/x", crumb: "X Voice", body: "" });
  assert.ok(voice.includes(SITE_NAV));
  assert.match(voice, /<div class="wrap subcrumb"><span class="crumb"><a href="\/downloads">Downloads<\/a> &rsaquo; X Voice<\/span><\/div>/);
  const none = page({ title: "X", description: "d", path: "/u/x", crumbs: "", body: "" });
  assert.ok(!none.includes("subcrumb"));
  assert.ok(!missingPage("nobody").includes("subcrumb"));
});

test("/voices sends old links to /downloads for good, query and all", async () => {
  const res = await voicesRedirect({ request: new Request("https://loreforeverwow.com/voices?src=cf") });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("Location"), "https://loreforeverwow.com/downloads?src=cf");
});

test("/downloads fills the Downloads page", async () => {
  const html = read("downloads.html");
  assert.match(html, /<h1>Downloads<\/h1>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/loreforeverwow.com\/downloads">/);
  for (const id of ["addon", "voices", "install", "languages", "record"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.ok(html.indexOf('id="addon"') < html.indexOf('id="voices"'), "the add-on comes first");
  // No D1 and no voices or packs: the parts come out empty, which is enough to see the page gets filled in.
  const assets = { "/downloads": html, "/voices/voices.json": '{"voices":[]}', "/translate/packs.json": '{"packs":[]}' };
  const env = {
    ASSETS: { fetch: async url => {
      const body = assets[new URL(url).pathname];
      return body ? new Response(body) : new Response("not found", { status: 404 });
    } },
  };
  const res = await downloadsPage({ request: new Request("https://loreforeverwow.com/downloads"), env });
  const out = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!out.includes("<!-- dl-voices -->") && !out.includes("<!-- dl-included -->"));
  assert.match(out, /Comes with the whole lore library in English/);
});

test("What's new: the dot, the strip and the page agree on the newest version", () => {
  const changelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
  const newest = /^## (\d+\.\d+\.\d+) \(/m.exec(changelog)[1];
  assert.match(read("header.js"), new RegExp(`const LATEST = "${newest.replace(/\./g, "\\.")}";`));
  assert.match(read("index.html"), new RegExp(`<aside class="newbar" id="newbar" data-version="${newest}"`));
  assert.match(read("whats-new.html"), new RegExp(`<article class="wn-ver" id="v${newest.replace(/\./g, "-")}" data-version="${newest}">`));
});

test("profile pages have no breadcrumb under the nav", () => {
  const p = {
    handle: "aelric", public: 1, story: "A tale.", story_source: "template", updated: "2026-10-03T00:00:00Z",
    data: { name: "Aelric", level: 24, race: "Night Elf", className: "Druid", places: [], people: [], bosses: [],
      kills: [], fought: [], deaths: [], loot: [], mounts: [], profs: [], rep: [], books: [], quests: [],
      totals: { quests: 0, places: 0, people: 0, foes: 0, bosses: 0 } },
  };
  const html = profilePage(p);
  assert.ok(html.includes(SITE_NAV) && !html.includes("subcrumb"));
});
