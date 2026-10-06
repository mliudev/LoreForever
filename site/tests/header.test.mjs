// public/header.js, signed in or not: the header shows the last state it knew (lf-auth in localStorage, or what a
// page made for a signed-in viewer says) before GET /api/auth/me answers, nothing at all while it knows nothing, and
// the answer corrects it. A signed-in player never sees Sign in first; a signed-out one never sees the account chip.
// The site features it follows (the Lore link, Share Forever text) work the same way (lf-features).
// header.js runs for real, in node:vm, on a small DOM double (below) of a page carrying SITE_NAV, after the nav's
// inline script, as a browser runs them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { SITE_NAV, siteNav } from "../lib/voices.js";

const HEADER_JS = readFileSync(new URL("../public/header.js", import.meta.url), "utf8");
const INLINE = /<script>([\s\S]*?)<\/script>/.exec(SITE_NAV)[1];

// ---- A DOM double: just what header.js uses ----
const VOID = new Set(["br", "circle", "hr", "img", "input", "path"]);
const decode = s => s.replace(/&(#\d+|amp|lt|gt|quot);/g, (_, e) =>
  e[0] === "#" ? String.fromCodePoint(Number(e.slice(1))) : { amp: "&", lt: "<", gt: ">", quot: '"' }[e]);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

class Node {
  parentNode = null;
  remove() {
    if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }
}

class Text extends Node {
  constructor(data) { super(); this.nodeType = 3; this.data = data; }
}

class El extends Node {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.localName = tag.toLowerCase();
    this.attrs = new Map();
    this.childNodes = [];
    this.listeners = {};
    const classes = () => this.className.split(/\s+/).filter(Boolean);
    this.classList = {
      contains: c => classes().includes(c),
      add: (...c) => { this.className = [...new Set([...classes(), ...c])].join(" "); },
      remove: (...c) => { this.className = classes().filter(x => !c.includes(x)).join(" "); },
      toggle: (c, on = !this.classList.contains(c)) => { if (on) this.classList.add(c); else this.classList.remove(c); return on; },
    };
    this.dataset = new Proxy({}, { get: (_, k) => this.getAttribute("data-" + String(k)) ?? undefined });
  }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  removeAttribute(n) { this.attrs.delete(n); }
  hasAttribute(n) { return this.attrs.has(n); }
  get id() { return this.getAttribute("id") || ""; }
  set id(v) { this.setAttribute("id", v); }
  get className() { return this.getAttribute("class") || ""; }
  set className(v) { this.setAttribute("class", v); }
  get href() { return this.getAttribute("href") || ""; }
  set href(v) { this.setAttribute("href", v); }
  set type(v) { this.setAttribute("type", v); }
  get hidden() { return this.hasAttribute("hidden"); }
  set hidden(v) { if (v) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); }
  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(v) { if (v) this.setAttribute("disabled", ""); else this.removeAttribute("disabled"); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get lastElementChild() { return this.children.at(-1) || null; }
  get textContent() { return this.childNodes.map(n => (n.nodeType === 3 ? n.data : n.textContent)).join(""); }
  set textContent(v) { this.replaceChildren(new Text(String(v))); }
  get innerHTML() { return this.childNodes.map(serialize).join(""); }
  set innerHTML(html) { this.replaceChildren(...parse(html)); }
  insertAdjacentHTML(where, html) { assert.equal(where, "beforeend"); this.append(...parse(html)); }
  replaceChildren(...nodes) { [...this.childNodes].forEach(n => n.remove()); this.append(...nodes); }
  append(...nodes) {
    for (const n of nodes.map(n => (typeof n === "string" ? new Text(n) : n))) {
      n.remove();
      n.parentNode = this;
      this.childNodes.push(n);
    }
  }
  after(node) {
    node.remove();
    this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this) + 1, 0, node);
    node.parentNode = this.parentNode;
  }
  replaceWith(node) { this.after(node); this.remove(); }
  contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
  descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); }
  querySelectorAll(selector) { return this.descendants().filter(matcher(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(e) { for (const fn of this.listeners[e.type] || []) fn(e); return true; }
  focus() {}
}

function serialize(n) {
  if (n.nodeType === 3) return esc(n.data);
  const attrs = [...n.attrs].map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${esc(v)}"`)).join("");
  return `<${n.localName}${attrs}>` + (VOID.has(n.localName) ? "" : `${n.innerHTML}</${n.localName}>`);
}

function parse(html) {
  const root = new El("root");
  let at = root;
  for (const m of html.matchAll(/<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[^\s=>/]+(?:\s*=\s*"[^"]*")?)*)\s*(\/?)>|[^<]+/g)) {
    if (m[1]) {
      for (let n = at; n !== root; n = n.parentNode) if (n.localName === m[1].toLowerCase()) { at = n.parentNode; break; }
    } else if (m[2]) {
      const el = new El(m[2]);
      for (const a of m[3].matchAll(/([^\s=>/]+)(?:\s*=\s*"([^"]*)")?/g)) el.setAttribute(a[1], decode(a[2] ?? ""));
      at.append(el);
      if (!m[4] && !VOID.has(el.localName)) at = el;
    } else at.append(new Text(decode(m[0])));
  }
  const nodes = [...root.childNodes];
  root.replaceChildren();
  return nodes;
}

// tag, #id, .class and [attr], combined, in comma lists; no combinators (header.js uses none).
function matcher(selector) {
  const tests = selector.split(",").map(s => s.trim()).map(s => {
    assert.ok(!/\s/.test(s), `no descendant selectors in this DOM double: ${s}`);
    const tag = /^[a-z][\w-]*/i.exec(s)?.[0]?.toLowerCase();
    const ids = [...s.matchAll(/#([\w-]+)/g)].map(x => x[1]);
    const classes = [...s.matchAll(/\.([\w-]+)/g)].map(x => x[1]);
    const attrs = [...s.matchAll(/\[([\w-]+)\]/g)].map(x => x[1]);
    return el => (!tag || el.localName === tag) && ids.every(i => el.id === i) &&
      classes.every(c => el.classList.contains(c)) && attrs.every(a => el.hasAttribute(a));
  });
  return el => tests.some(t => t(el));
}

// ---- A page with the header, header.js running on it ----
const UNTIL = "2099-01-01T00:00:00.000Z";   // when the sign-in ends
const ME_IN = {
  ok: true, voices: [], signIn: { google: "client-id" },
  user: { email: "aelric.plays@example.com", display_name: "Aelric", links: "", show_public: true, google: true, session_expires: UNTIL },
  features: { contribute: false, zones: false, lore: true, companion: false },
};
const AELRIC = { in: true, name: "Aelric", until: UNTIL };   // what's remembered of ME_IN
const ME_OUT = { ...ME_IN, user: null };
const NO_SIGN_IN = { ...ME_OUT, signIn: { google: null } };

function storage(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: k => void m.delete(k) };
}

// Opens a page at path. remembered: what lf-auth holds (an object, a raw string, or "blocked": localStorage throws);
// features: what lf-features holds; viewer: the signed-in user a Function made the page for (lib/voices.js siteNav).
function visit(path, { remembered, features, viewer } = {}) {
  const html = new El("html");
  const body = new El("body");
  html.append(body);
  body.innerHTML = `<header class="top">\n${siteNav(viewer)}\n</header>\n<main></main>`;
  const listeners = {};
  const document = {
    documentElement: html,
    createElement: tag => new El(tag),
    getElementById: id => html.descendants().find(e => e.id === id) || null,
    querySelector: s => html.querySelector(s),
    querySelectorAll: s => html.querySelectorAll(s),
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    dispatchEvent: e => { for (const fn of listeners[e.type] || []) fn(e); return true; },
  };
  const store = remembered === "blocked" ? null : storage({
    ...(remembered === undefined ? {} : { "lf-auth": remembered }),
    ...(features === undefined ? {} : { "lf-features": features }),
  });
  let answer;
  const me = new Promise((resolve, reject) => { answer = { resolve, reject }; });
  const calls = [];
  const sandbox = {
    document,
    location: { pathname: path, reloads: 0, reload() { this.reloads++; } },
    fetch: async (url, init) => {
      calls.push(url);
      if (url === "/api/auth/me") return me;
      if (url === "/api/auth/logout") return { ok: true, json: async () => ({ ok: true }) };
      throw new Error("unexpected fetch: " + url);
    },
  };
  Object.defineProperty(sandbox, "localStorage", store
    ? { value: store }
    : { get() { throw new Error("SecurityError: the page may not use storage"); } });
  vm.createContext(sandbox);
  vm.runInContext(INLINE, sandbox);   // the nav's inline script, as the page is drawn
  vm.runInContext(HEADER_JS, sandbox);   // then header.js (defer)

  const box = () => html.querySelector(".head-actions");
  return {
    document, sandbox, calls,
    waiting: () => html.classList.contains("hd-wait"),
    // What the right of the header shows.
    slot() {
      const profile = document.getElementById("nav-profile");
      const chip = box().querySelector(".head-chip");
      const menu = box().querySelector(".head-menu-account");
      return {
        profile: `${profile.querySelector(".hd-wide").textContent} -> ${profile.getAttribute("href")}`,
        chip: chip && chip.querySelector(".chip-name").textContent,
        who: menu && menu.querySelector("strong").textContent,
        signIn: Boolean(box().querySelector(".btn-in")),
        note: !document.querySelector(".menu-note").hidden,   // the Community menu's "Feedback asks you to sign in"
      };
    },
    // The links in the nav as they show (the Lore link hides by hd-nolore on <html>, style.css), and the Community
    // menu's entries.
    links: () => document.querySelector(".nav-links").descendants().filter(e => e.classList.contains("nl"))
      .filter(e => !(e.id === "nav-lore" && html.classList.contains("hd-nolore"))).map(e => e.id),
    menu: () => document.getElementById("hd-community-menu").children.filter(e => e.localName === "a").map(e => e.getAttribute("href")),
    remembered: () => (store ? JSON.parse(store.getItem("lf-auth")) : undefined),
    features: () => (store ? JSON.parse(store.getItem("lf-features")) : undefined),
    raw: () => store && store.getItem("lf-auth"),
    answer: async body => { answer.resolve({ ok: true, json: async () => body }); await settle(); },
    fail: async () => { answer.reject(new TypeError("Failed to fetch")); await settle(); },
    signOut: async () => {
      box().querySelector(".head-chip").dispatchEvent({ type: "click", detail: 1 });
      box().querySelector(".head-menu-account").querySelector("button").dispatchEvent({ type: "click" });
      await settle();
    },
    tell: async detail => { document.dispatchEvent({ type: "lf-auth", detail }); await settle(); },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

const IN = { profile: "Your profile -> /u/me", chip: "Aelric", who: "aelric.plays@example.com", signIn: false, note: false };
const OUT = { profile: "Make your profile -> /account#profile", chip: null, who: null, signIn: true, note: true };
const UNKNOWN = { profile: "Make your profile -> /account#profile", chip: null, who: null, signIn: false, note: false };

test("signed in last time: Your profile and the chip before the answer, never Sign in", async () => {
  const page = visit("/downloads", { remembered: AELRIC });
  assert.equal(page.waiting(), false, "shown at once");
  assert.deepEqual(page.slot(), { ...IN, who: "Aelric" });   // the email only comes with the answer
  await page.answer(ME_IN);
  assert.deepEqual(page.slot(), IN);
  assert.deepEqual(page.remembered(), AELRIC);
  assert.ok(!page.raw().includes("@"), "never the email");
});

test("a remembered sign-in that has ended by now isn't shown: the spot waits for the answer", async () => {
  const page = visit("/downloads", { remembered: { ...AELRIC, until: "2026-01-01T00:00:00.000Z" } });
  assert.equal(page.waiting(), true);
  await page.answer(ME_OUT);
  assert.deepEqual(page.slot(), OUT);
  assert.deepEqual(page.remembered(), { in: false, signIn: true });
  const odd = visit("/downloads", { remembered: { ...AELRIC, until: "whenever" } });
  assert.equal(odd.waiting(), true);
});

test("signed out last time: Sign in before the answer, never the chip", async () => {
  const page = visit("/faq", { remembered: { in: false, signIn: true } });
  assert.equal(page.waiting(), false);
  assert.deepEqual(page.slot(), OUT);
  await page.answer(ME_OUT);
  assert.deepEqual(page.slot(), OUT);
  assert.deepEqual(page.remembered(), { in: false, signIn: true });
});

test("nothing remembered: the spot stays blank until the answer, which is then remembered", async () => {
  for (const remembered of [undefined, "not json", "blocked"]) {
    const page = visit("/downloads", { remembered });
    assert.equal(page.waiting(), true, String(remembered));
    assert.deepEqual(page.slot(), UNKNOWN, "the page's own markup, hidden");
    await page.answer(ME_IN);
    assert.equal(page.waiting(), false);
    assert.deepEqual(page.slot(), IN);
    if (remembered !== "blocked") assert.deepEqual(page.remembered(), AELRIC);
  }
  const out = visit("/downloads");
  await out.answer(ME_OUT);
  assert.deepEqual(out.slot(), OUT);
  assert.deepEqual(out.remembered(), { in: false, signIn: true });
});

test("the answer corrects what was remembered", async () => {
  const ended = visit("/downloads", { remembered: AELRIC });   // signed out elsewhere (Delete my account, say)
  await ended.answer(ME_OUT);
  assert.deepEqual(ended.slot(), OUT);
  assert.deepEqual(ended.remembered(), { in: false, signIn: true });

  const signedIn = visit("/downloads", { remembered: { in: false, signIn: true } });   // signed in somewhere else
  await signedIn.answer(ME_IN);
  assert.deepEqual(signedIn.slot(), IN);
  assert.equal(signedIn.document.querySelectorAll(".head-chip").length, 1);

  const off = visit("/downloads", { remembered: { in: false, signIn: true } });   // sign-in switched off
  await off.answer(NO_SIGN_IN);
  assert.deepEqual(off.slot(), { ...OUT, signIn: false, note: false });
  assert.deepEqual(off.remembered(), { in: false, signIn: false });
});

test("no answer: the spot shows anyway, and what was remembered stays", async () => {
  const lost = visit("/downloads", { remembered: { in: true, name: "Aelric" } });
  await lost.fail();
  assert.deepEqual(lost.slot(), { ...IN, who: "Aelric" });
  assert.deepEqual(lost.remembered(), { in: true, name: "Aelric" });

  const first = visit("/downloads");
  await first.fail();
  assert.equal(first.waiting(), false);
  assert.deepEqual(first.slot(), UNKNOWN);

  const down = visit("/downloads");
  await down.answer({ ok: false, error: "Accounts aren't set up yet." });
  assert.equal(down.waiting(), false);
  assert.deepEqual(down.slot(), UNKNOWN);
});

test("a page made for a signed-in viewer shows them signed in at once, whatever was remembered", async () => {
  const viewer = { email: "aelric.plays@example.com", display_name: null, session_expires: UNTIL };   // currentUser's row
  for (const remembered of [undefined, { in: false, signIn: true }, "blocked"]) {
    const page = visit("/u/aelric", { remembered, viewer });
    assert.equal(page.waiting(), false);
    assert.deepEqual(page.slot(), { ...IN, chip: "aelric.plays", who: "aelric.plays" });
    if (remembered !== "blocked") assert.deepEqual(page.remembered(), { in: true, name: "aelric.plays", until: UNTIL });
  }
});

test("signing out from the chip remembers it before the page reloads", async () => {
  const page = visit("/downloads", { remembered: AELRIC });
  await page.answer(ME_IN);
  await page.signOut();
  assert.ok(page.calls.includes("/api/auth/logout"));
  assert.equal(page.sandbox.location.reloads, 1);
  assert.deepEqual(page.remembered(), { in: false, signIn: true });
});

test("/account and /link pass on sign-ins and sign-outs; /account never shows Sign in", async () => {
  const page = visit("/account", { remembered: { in: false, signIn: true } });
  assert.deepEqual(page.slot(), { ...OUT, signIn: false }, "no Sign in on the sign-in page");
  await page.answer(ME_OUT);
  await page.tell(ME_IN);   // signed in with Google on the page
  assert.deepEqual(page.slot(), IN);
  assert.deepEqual(page.remembered(), AELRIC);
  await page.tell(ME_OUT);   // Sign out, or Delete my account
  assert.deepEqual(page.slot(), { ...OUT, signIn: false });
  assert.deepEqual(page.remembered(), { in: false, signIn: true });
  await page.tell(null);   // signed in, off to ?next= before asking again: the next page waits for the answer
  assert.equal(page.raw(), null);
});

// ---- Site features: the Lore link and Share Forever text ----
const LINKS = ["nav-download", "nav-lore", "nav-new", "nav-community"];
const NO_LORE = LINKS.filter(id => id !== "nav-lore");
const MENU = ["/discord?src=nav", "/feedback", "/feedback?kind=idea", "/feedback?kind=bug", "/faq", "/voices/studio",
  "/translate", "/contributors"];
const withFeatures = (me, f) => ({ ...me, features: { ...me.features, ...f } });

test("the Lore link is there from the start, with nothing remembered, and stays when the answer agrees", async () => {
  for (const remembered of [undefined, "blocked"]) {
    const page = visit("/downloads", { remembered });
    assert.deepEqual(page.links(), LINKS, "before the answer");
    assert.equal(page.document.getElementById("nav-community").localName, "button", "Community is a menu");
    await page.answer(ME_OUT);
    assert.deepEqual(page.links(), LINKS);
    assert.deepEqual(page.menu(), MENU);
    if (remembered !== "blocked") assert.deepEqual(page.features(), { lore: true, contribute: false });
  }
  const lore = visit("/lore/zone/stormwind");
  assert.equal(lore.document.getElementById("nav-lore").getAttribute("aria-current"), "page");
  assert.equal(lore.document.getElementById("nav-download").getAttribute("aria-current"), null);
});

test("remembered features show at once, before the answer, which corrects them and is remembered", async () => {
  // Lore off and Share Forever text on last time (a preview, say): no Lore link from the first paint (the inline
  // script), and the menu entry at once.
  const off = visit("/downloads", { features: { lore: false, contribute: true } });
  assert.deepEqual(off.links(), NO_LORE);
  assert.deepEqual(off.menu(), [...MENU, "/contribute"]);
  await off.answer(withFeatures(ME_OUT, { lore: true, contribute: false }));   // the answer differs: as it is now
  assert.deepEqual(off.links(), LINKS);
  assert.deepEqual(off.menu(), MENU);
  assert.deepEqual(off.features(), { lore: true, contribute: false });

  const on = visit("/downloads", { features: { lore: true, contribute: false } });
  await on.answer(withFeatures(ME_OUT, { lore: false, contribute: true }));   // switched off and on since
  assert.deepEqual(on.links(), NO_LORE);
  assert.deepEqual(on.menu(), [...MENU, "/contribute"]);
  assert.deepEqual(on.features(), { lore: false, contribute: true });
  await on.tell(withFeatures(ME_IN, { lore: false, contribute: true }));   // /account's answer: nothing doubled
  assert.deepEqual(on.menu(), [...MENU, "/contribute"]);

  // Unreadable, or an answer without features: the page as it is.
  const odd = visit("/downloads", { features: "lore" });
  assert.deepEqual(odd.links(), LINKS);
  const { features: _, ...bare } = ME_OUT;
  await odd.answer(bare);
  assert.deepEqual(odd.links(), LINKS);
  assert.equal(odd.sandbox.localStorage.getItem("lf-features"), "lore", "left as it was");
});
