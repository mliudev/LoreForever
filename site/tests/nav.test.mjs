// The site header and the pages it leads to (LOR-222): every page carries the same nav as lib/voices.js SITE_NAV,
// /downloads is the Downloads page and /voices sends old links there, and the What's new pieces agree on the newest
// version. pipeline/tests/test_changelog_site.py checks that changelog.py writes those copies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SITE_NAV, page, siteNav } from "../lib/voices.js";
import { onRequestGet as voicesRedirect } from "../functions/voices/index.js";
import { onRequestGet as downloadsPage } from "../functions/downloads/index.js";
import { profilePage, missingPage, visitorBar } from "../lib/profiles.js";
import { FEATURES } from "../lib/features.js";

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
  for (const label of ["Download", "Lore", "What's new", "Make your profile", "Community"]) assert.ok(SITE_NAV.includes(label), label);
  assert.match(SITE_NAV, /href="\/downloads"/);
  assert.match(SITE_NAV, /href="\/whats-new"/);
  assert.match(SITE_NAV, /href="\/account#profile"/);
});

// header.js says whether you're signed in and which site features are on (site/tests/header.test.mjs). The nav's
// inline script comes first, before anything is drawn: until header.js knows, the profile link's spot stays blank but
// keeps its place (hd-wait), and a Lore link remembered off never shows (hd-nolore). Only JavaScript sets either, so
// without it the header shows as it is in the markup.
test("the inline script runs before the header is drawn: the profile spot waits, a remembered Lore off hides", () => {
  assert.match(SITE_NAV, /^ {2}<nav class="wrap nav" aria-label="Lore Forever">\n {4}<script>\(c => \{ c\.add\("hd-wait"\); try \{ if \(JSON\.parse\(localStorage\.getItem\("lf-features"\)\)\.lore === false\) c\.add\("hd-nolore"\); \} catch \(e\) \{\} \}\)\(document\.documentElement\.classList\)<\/script>\n {4}<a class="brand"/);
  const css = read("style.css");
  assert.match(css, /\n\.hd-wait \.head-actions \{ visibility: hidden; animation: hd-late 0s 3s forwards; \}/);
  assert.match(css, /\n@keyframes hd-late \{ to \{ visibility: visible; \} \}/, "shown anyway if header.js never runs");
  assert.match(css, /\n\.hd-nolore #nav-lore \{ display: none; \}/);
  assert.match(read("header.js"), /classList\.remove\("hd-wait"\)/);
  assert.match(read("header.js"), /classList\.toggle\("hd-nolore", !f\.lore\)/);
});

// The Lore link (LOR-233) is in the markup, so it's there from the first paint and without JavaScript, while the
// "lore" feature is on. Turning the feature off in lib/features.js means taking it out of SITE_NAV and the static
// pages too (header.js hides it meanwhile, as it does when SITE_FEATURES turns it off on a preview).
test("the Lore link is in the nav, after Download, exactly while the lore feature is on", () => {
  assert.equal(SITE_NAV.includes('<a class="nl" id="nav-lore" href="/lore">Lore</a>'), FEATURES.lore === true);
  assert.ok(SITE_NAV.indexOf('id="nav-download"') < SITE_NAV.indexOf('id="nav-lore"'));
  assert.ok(SITE_NAV.indexOf('id="nav-lore"') < SITE_NAV.indexOf('id="nav-new"'));
});

test("a page made for someone signed in says so in its header, with the chip's name and never the email", () => {
  assert.equal(siteNav(null), SITE_NAV);
  const named = siteNav({ display_name: "Aelric", email: "aelric.plays@example.com" });
  assert.equal(named, SITE_NAV.replace('<div class="head-actions">', '<div class="head-actions" data-auth="in" data-name="Aelric">'));
  assert.ok(siteNav({ display_name: null, email: "aelric.plays@example.com" }).includes('data-name="aelric.plays"'));
  assert.ok(siteNav({ display_name: '"><b>x' }).includes('data-name="&quot;&gt;&lt;b&gt;x"'));
  assert.ok(!named.includes("@example.com"));
  assert.ok(siteNav({ display_name: "Aelric", session_expires: "2026-11-04T00:00:00.000Z" })
    .includes('<div class="head-actions" data-auth="in" data-name="Aelric" data-until="2026-11-04T00:00:00.000Z">'));
  const built = page({ title: "X", description: "d", path: "/u/x", crumbs: "", body: "", viewer: { display_name: "Aelric" } });
  assert.ok(built.includes(`<header class="top">\n${named}`));
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
  // View as a visitor (LOR-302): the same header, its bar inside the page.
  const asVisitor = profilePage(p, { asVisitor: true });
  assert.ok(asVisitor.includes(SITE_NAV) && !asVisitor.includes("subcrumb"));
  assert.ok(asVisitor.indexOf("Back to my view") > asVisitor.indexOf("<main"));
  const hidden = missingPage("aelric", { bar: visitorBar({ ...p, public: 0 }) });
  assert.ok(hidden.includes(SITE_NAV) && !hidden.includes("subcrumb") && hidden.includes("Back to my view"));
});

test("Harold signs the story once the companion feature is on (LOR-266)", () => {
  const p = {
    handle: "aelric", public: 1, story: "A tale.", story_source: "template", updated: "2026-10-03T00:00:00Z",
    data: { name: "Aelric", level: 24, race: "Night Elf", className: "Druid", places: [], people: [], bosses: [],
      kills: [], fought: [], deaths: [], loot: [], mounts: [], profs: [], rep: [], books: [], quests: [],
      totals: { quests: 0, places: 0, people: 0, foes: 0, bosses: 0 } },
  };
  assert.ok(!profilePage(p).includes("pf-signed"));
  const signed = profilePage(p, { herald: true });
  assert.match(signed, /<p class="pf-signed"><img src="\/img\/harold-head\.svg" alt="" width="48" height="48"><span>Written by Harold, the Lore Forever herald<\/span><\/p>/);
  assert.ok(signed.indexOf("pf-signed") > signed.indexOf("Aelric's story"), "under the story");
});
