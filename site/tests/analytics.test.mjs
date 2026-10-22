// Privacy boundaries matter more than event volume: an absent ID, preview/private/draft
// page or missing consent must never load Google. Run with node --test site/tests/analytics.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { analyticsPage, analyticsMarkup, withAnalytics } from "../lib/analytics.js";
import { onRequestGet as articleGet } from "../functions/guides/[slug].js";

const HOME = "https://loreforeverwow.com";
const ENV = { CANONICAL_HOST: "loreforeverwow.com", GA4_MEASUREMENT_ID: "G-TEST1234" };
const html = (headers = {}, status = 200) => new Response("<html><head></head><body></body></html>", {
  status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
});
const page = (path, env = ENV, response = html()) => analyticsPage(new Request(HOME + path), env, response);

test("only explicit successful public production pages get configuration", () => {
  assert.deepEqual(page("/downloads?email=private#secret"), {
    id: ENV.GA4_MEASUREMENT_ID, path: "/downloads", title: "Downloads", kind: "page",
  });
  for (const url of ["https://preview.example/", "http://loreforeverwow.com/", "https://www.loreforeverwow.com/", "https://loreforeverwow.com:8443/"]) {
    assert.equal(analyticsPage(new Request(url), ENV, html()), null, url);
  }
  for (const env of [{}, { ...ENV, GA4_MEASUREMENT_ID: "" }, { ...ENV, GA4_MEASUREMENT_ID: 'G-X\" onload=x' },
    { ...ENV, CANONICAL_HOST: "preview.example" }]) assert.equal(page("/", env), null);
  for (const path of ["/account", "/u/player", "/admin", "/api/auth/me", "/feedback", "/contribute",
    "/guides/edit", "/guides/articles/private.md", "/lore/data/index.json", "/voices/studio", "/translate/dashboard",
    "/download/installer", "/downloads.html", "/something-unknown"]) assert.equal(page(path), null, path);
  for (const response of [html({}, 404), html({}, 302), html({ "X-Robots-Tag": "noindex, follow" }),
    new Response("{}", { headers: { "Content-Type": "application/json" } })]) assert.equal(page("/guides/secret", ENV, response), null);
  assert.equal(page("/lore/quest/176-wanted-hogger").kind, "lore");
  assert.equal(analyticsPage(new Request(HOME, { method: "HEAD" }), ENV, html()), null);
});

test("real guide responses deny drafts and missing slugs while published metadata stays bounded", async () => {
  for (const draft of [false, true]) {
    const env = { ...ENV, GUIDE_FILES: { "known-article":
      `---\ntitle: Private title user@example.com\ndescription: Example\ndate: 2026-10-20\nkind: lore\ndraft: ${draft}\n---\nBody` } };
    const request = new Request(HOME + "/guides/known-article");
    const response = await articleGet({ request, env, params: { slug: "known-article" } });
    const config = analyticsPage(request, env, response);
    if (draft) assert.equal(config, null);
    else {
      assert.equal(config.title, "Guide");
      assert.doesNotMatch(analyticsMarkup(config), /user@example|Private title/);
    }
  }
  const request = new Request(HOME + "/guides/unknown");
  const env = { ...ENV, GUIDE_FILES: {} };
  assert.equal(analyticsPage(request, env, await articleGet({ request, env, params: { slug: "unknown" } })), null);
});

test("injection uses no-store and origin-only referrers without broadening the site-wide policy", async () => {
  const markup = analyticsMarkup(page("/"));
  assert.match(markup, /href="\/analytics\.css\?v=20261021-footer"/);
  assert.match(markup, /src="\/analytics\.js\?v=20261021-footer"/);
  const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
  for (const asset of ["analytics.js", "analytics.css"]) {
    assert.ok(headers.includes(`/${asset}\n  Cache-Control: no-cache`), `${asset} must revalidate`);
  }
  const old = globalThis.HTMLRewriter;
  // Only the platform HTML rewrite boundary is stubbed; config/headers run for real.
  globalThis.HTMLRewriter = class {
    on(selector, handler) { assert.equal(selector, "head"); this.handler = handler; return this; }
    transform(response) { this.handler.element({ append: markup => { this.markup = markup; } }); return response; }
  };
  try {
    const out = withAnalytics(html({ "Content-Security-Policy": "script-src 'self'; object-src 'none'", ETag: "old" }), page("/"));
    assert.equal(out.headers.get("Cache-Control"), "private, no-store");
    assert.equal(out.headers.get("Referrer-Policy"), "origin");
    assert.equal(out.headers.get("ETag"), null);
    assert.equal(out.headers.get("Content-Security-Policy"), "script-src 'self' https://www.googletagmanager.com; object-src 'none'");
  } finally { globalThis.HTMLRewriter = old; }
});

// A small DOM boundary keeps these tests independent of network/browser installations.
// A real browser/network acceptance pass complements this state-machine regression check.
const source = readFileSync(new URL("../public/analytics.js", import.meta.url), "utf8");
function browser({ suffix = "", choice, blocked = false, savedStore, referrer = "https://news.example/article?email=private#secret" } = {}) {
  const nodes = [], scripts = [], cookieWrites = [], cookies = new Map([["lf_session", "keep"], ["lf_src", "keep"]]);
  const store = savedStore || new Map();
  if (choice) store.set("lf-analytics-consent-v1", JSON.stringify({ choice, at: Date.now() }));
  class Element {
    constructor(tag) { this.tagName = tag; this.dataset = {}; this.listeners = {}; this.children = []; this.hidden = false; }
    setAttribute(k, v) { this[k] = v; }
    append(...children) { this.children.push(...children); for (const node of children) if (node.tagName === "script") scripts.push(node); }
    addEventListener(event, fn) { (this.listeners[event] ||= []).push(fn); }
    fire(event, input = {}) { for (const fn of this.listeners[event] || []) fn(input); }
    focus() {}
    set innerHTML(value) {
      this.markup = value;
      this.buttons = ["granted", "denied"].map(choice => Object.assign(new Element("button"), { dataset: { choice } }));
      this.status = new Element("p");
    }
    querySelector(selector) { return selector.includes("status") ? this.status : this.buttons[1]; }
    querySelectorAll() { return this.buttons; }
  }
  const config = { dataset: { id: ENV.GA4_MEASUREMENT_ID, path: "/guides/known-article", title: "Guide", kind: "article" } };
  const footer = new Element("footer");
  const document = Object.assign(new Element("document"), { referrer,
    querySelector: selector => selector === "footer" ? footer : null,
    getElementById: () => config, createElement: tag => { const el = new Element(tag); nodes.push(el); return el; },
    head: new Element("head"), body: new Element("body") });
  Object.defineProperty(document, "cookie", { get: () => [...cookies].map(([k,v]) => `${k}=${v}`).join("; "), set: v => {
    cookieWrites.push(v); const [k, val] = v.split(";")[0].split("=");
    if (v.includes("Max-Age=0;")) cookies.delete(k); else cookies.set(k, val);
  } });
  const window = new Element("window");
  const location = new URL(HOME + "/guides/known-article" + suffix);
  const history = Object.fromEntries(["pushState", "replaceState"].map(name => [name, (state, unused, url) => {
    location.href = new URL(url, location).href;
  }]));
  const context = { window, document, location, history, URL, Date,
    localStorage: { getItem: k => { if (blocked) throw Error("blocked"); return store.get(k) || null; },
      setItem: (k, v) => { if (blocked) throw Error("blocked"); store.set(k, v); } } };
  vm.runInNewContext(source, context);
  const panel = nodes.find(x => x.tagName === "section"), manage = nodes.find(x => x.className === "lf-analytics-manage");
  const events = () => (window.lfAnalyticsData || []).filter(x => x[0] === "event");
  return { ...context, nodes, scripts, store, cookies, cookieWrites, events, panel, manage, footer,
    runAgain: () => vm.runInNewContext(source, context), choose: value => panel.buttons.find(b => b.dataset.choice === value).fire("click") };
}

test("a saved choice dismisses the prompt across visits and leaves settings in the footer", () => {
  for (const choice of ["granted", "denied"]) {
    const first = browser();
    assert.equal(first.panel.hidden, false);
    first.choose(choice);
    assert.equal(first.panel.hidden, true);
    assert.equal(first.manage["aria-expanded"], "false");
    const returning = browser({ savedStore: first.store });
    assert.equal(returning.panel.hidden, true, choice);
    assert.equal(returning.footer.children.includes(returning.manage), true);
    returning.manage.fire("click");
    assert.equal(returning.panel.hidden, false, "a visitor can still change their choice");
    assert.equal(returning.scripts.length, choice === "granted" ? 1 : 0);
  }
});

test("nothing loads before consent; one load yields one page/article view with bounded values", () => {
  const b = browser();
  assert.equal(b.scripts.length, 0);
  b.choose("denied");
  assert.equal(b.scripts.length, 0);
  b.choose("granted");
  assert.equal(b.scripts.length, 1);
  assert.equal(b.scripts[0].referrerPolicy, "no-referrer");
  b.scripts[0].fire("load"); b.scripts[0].fire("load"); b.runAgain();
  assert.deepEqual(Array.from(b.events(), e => e[1]), ["page_view", "article_view"]);
  const json = JSON.stringify(b.window.lfAnalyticsData);
  assert.doesNotMatch(json, /private|email=|#secret|\/article\?/);
  assert.match(json, /https:\/\/news.example\//);
  assert.equal(b.events()[1][2].article_id, "known-article");
});

test("URL parameters and fragments never load Google, even with prior consent", () => {
  for (const suffix of ["?src=guides", "?utm_source=private&gclid=private", "#secret"]) {
    const b = browser({ choice: "granted", suffix });
    assert.equal(b.scripts.length, 0, suffix);
    b.choose("granted");
    assert.equal(b.scripts.length, 0);
  }
});

test("campaign attribution classifies direct, referral and known search without forwarding query values", () => {
  for (const [referrer, expectedSource, expectedMedium] of [
    ["", "(direct)", "(none)"], [HOME + "/downloads", "(direct)", "(none)"],
    ["https://news.example/article?utm_source=secret", "news.example", "referral"],
    ["https://www.google.com/search?q=secret", "google", "organic"],
    ["https://www.bing.com/search?q=secret", "bing", "organic"],
    ["https://duckduckgo.com/?q=secret", "duckduckgo", "organic"],
  ]) {
    const b = browser({ choice: "granted", referrer });
    const config = b.window.lfAnalyticsData.find(entry => entry[0] === "config")[2];
    assert.equal(config.campaign_source, expectedSource);
    assert.equal(config.campaign_medium, expectedMedium);
    assert.doesNotMatch(JSON.stringify(config), /secret|utm_source|q=/);
  }
});

test("only named download and Discord intents send events, never link queries or form values", () => {
  const b = browser({ choice: "granted" }); b.scripts[0].fire("load");
  const click = href => b.document.fire("click", { target: { closest: () => ({ href: HOME + href }) } });
  for (const href of ["/download/installer?src=secret", "/download/willo?email=private", "/discord?src=private",
    "/account", "/api/subscribe?email=private", "/download/unknown"]) click(href);
  assert.deepEqual(Array.from(b.events(), e => e[1]), ["page_view", "article_view", "download_click", "download_click", "discord_join_click"]);
  assert.doesNotMatch(JSON.stringify(b.events()), /secret|private|email=/);
  b.choose("denied"); click("/download/installer"); assert.equal(b.events().length, 0);
});

test("withdrawal stops events, clears only GA cookies, and works with blocked storage", () => {
  for (const blocked of [false, true]) {
    const b = browser({ blocked });
    b.choose("granted"); b.scripts[0].fire("load");
    b.cookies.set("_ga", "identifier"); b.cookies.set("_ga_TEST1234", "session");
    b.choose("denied");
    assert.equal(b.window["ga-disable-G-TEST1234"], true);
    assert.equal(b.events().length, 0, "pending queue emptied without a denial ping");
    assert.equal(b.cookies.has("_ga"), false);
    assert.equal(b.cookies.get("lf_session"), "keep"); assert.equal(b.cookies.get("lf_src"), "keep");
    b.scripts[0].fire("load"); assert.equal(b.events().length, 0);
    b.choose("granted"); assert.equal(b.scripts.length, 1, "reuse runtime");
    assert.equal(b.events().length, 0, "same document never counts twice");
  }
});

test("consent withdrawal before script load, another tab, and in-place navigation stay off", () => {
  const pending = browser(); pending.choose("granted"); pending.choose("denied"); pending.scripts[0].fire("load");
  assert.equal(pending.events().length, 0);
  pending.choose("granted"); assert.equal(pending.events().length, 2, "new grant restores config after pending queue was cleared");
  const other = browser({ choice: "granted" }); other.scripts[0].fire("load");
  other.store.clear(); other.window.fire("storage", { key: "lf-analytics-consent-v1" });
  assert.equal(other.window["ga-disable-G-TEST1234"], true);
  for (const path of ["/account", "/guides/known-article?email=private", "/guides/known-article#private"]) {
    const b = browser({ choice: "granted" }); b.scripts[0].fire("load"); b.history.pushState({}, "", path);
    assert.equal(b.window["ga-disable-G-TEST1234"], true, path);
    assert.equal(b.events().length, 0); b.choose("granted"); assert.equal(b.events().length, 0);
  }
});

test("leaving a document freezes collection but preserves the consenting browser's analytics identity", () => {
  for (const leave of [b => b.window.fire("pagehide"), b => b.history.pushState({}, "", "/account"),
    b => b.history.replaceState({}, "", "/guides/known-article?src=guides")]) {
    const b = browser({ choice: "granted" }); b.scripts[0].fire("load");
    b.cookies.set("_ga", "same-visitor"); b.cookies.set("_ga_TEST1234", "same-session");
    leave(b);
    assert.equal(b.window["ga-disable-G-TEST1234"], true);
    assert.equal(b.events().length, 0);
    assert.equal(b.cookies.get("_ga"), "same-visitor");
    assert.equal(b.cookies.get("_ga_TEST1234"), "same-session");
    assert.equal(JSON.parse(b.store.get("lf-analytics-consent-v1")).choice, "granted");
  }
});

test("BFCache restores consenting clicks without a duplicate pageview and respects changed consent", () => {
  const b = browser({ choice: "granted" }); b.scripts[0].fire("load");
  assert.equal(b.events().filter(e => e[1] === "page_view").length, 1);
  b.cookies.set("_ga", "same-visitor");
  b.window.fire("pagehide");
  b.window.fire("pageshow", { persisted: true });
  assert.equal(b.window["ga-disable-G-TEST1234"], false);
  assert.equal(b.cookies.get("_ga"), "same-visitor");
  assert.equal(b.scripts.length, 1);
  assert.equal(b.events().length, 0, "page/article views were already counted before caching");
  assert.equal(b.panel.hidden, true); assert.equal(b.manage["aria-expanded"], "false");
  b.document.fire("click", { target: { closest: () => ({ href: HOME + "/download/installer" }) } });
  assert.deepEqual(Array.from(b.events(), e => e[1]), ["download_click"]);

  b.window.fire("pagehide");
  b.store.set("lf-analytics-consent-v1", JSON.stringify({ choice: "denied", at: Date.now() }));
  b.window.fire("pageshow", { persisted: true });
  assert.equal(b.window["ga-disable-G-TEST1234"], true);
  assert.equal(b.cookies.has("_ga"), false);
  assert.equal(b.events().length, 0);
  assert.equal(b.panel.buttons[1].textContent, "Decline analytics");

  const unsafe = browser({ choice: "granted" }); unsafe.scripts[0].fire("load");
  unsafe.history.pushState({}, "", "/account"); unsafe.window.fire("pagehide");
  unsafe.location.href = HOME + "/guides/known-article";
  unsafe.window.fire("pageshow", { persisted: true });
  assert.equal(unsafe.window["ga-disable-G-TEST1234"], true, "a previously unsafe document stays frozen");
  assert.equal(unsafe.events().length, 0);
});
