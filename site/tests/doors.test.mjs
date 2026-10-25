// Two front doors (lib/doors.js, the Willo site split): Willo's own domain and loreforeverwow.com on one site. Through
// the real middleware and the real pages in public/: nothing changes for players until WILLO_SPLIT=on, the switch
// moves Willo's pages and prices off Lore Forever without breaking an old link or the API, deleting it undoes it, and
// a sign-in carries across. Run: node --test site/tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { onRequest as middleware } from "../functions/_middleware.js";
import { onRequestGet as go } from "../functions/go/[door].js";
import { findOrCreateUser, startSession, currentUser, setup } from "../lib/accounts.js";
import { d1, SITE } from "./helpers.mjs";

const LORE = "loreforeverwow.com", WILLO = "playwillo.example";
const TYPES = { html: "text/html; charset=utf-8", xml: "application/xml", txt: "text/plain", json: "application/json",
                css: "text/css" };

// The site's static files as Pages serves them: /plans is plans.html, /willo-site/home is willo-site/home.html.
const ASSETS = { async fetch(url) {
  const path = new URL(url).pathname;
  const tries = path === "/" ? ["index.html"] : [path.slice(1), path.slice(1) + ".html"];
  for (const t of tries) {
    const file = join(SITE, "public", t);
    if (t && existsSync(file) && !file.endsWith("/")) {
      try { return new Response(readFileSync(file), { headers: { "Content-Type": TYPES[t.split(".").pop()] || "text/plain" } }); }
      catch { /* a directory */ }
    }
  }
  return new Response("not found", { status: 404 });
} };

let env;
beforeEach(() => { env = { DB: d1(), ASSETS, CANONICAL_HOST: LORE, WILLO_DOMAIN: WILLO }; });

async function get(url, { cookie, method = "GET" } = {}) {
  const request = new Request(url, { method, headers: cookie ? { Cookie: cookie } : {} });
  let reached = false;
  const res = await middleware({ request, env, waitUntil() {}, next: async () => { reached = true; return ASSETS.fetch(request.url); } });
  return { res, reached, text: () => res.text() };
}

test("before the switch, Lore Forever is exactly as today; Willo's domain is her door", async () => {
  const plans = await get(`https://${LORE}/plans`);
  assert.equal(plans.res.status, 200);
  const home = await (await get(`https://${LORE}/`)).text();
  assert.match(home, /\$4\.99/);
  assert.doesNotMatch(home, /data-door/);

  const away = await get(`https://${WILLO}/downloads?src=x`);
  assert.equal(away.res.status, 302);
  assert.equal(away.res.headers.get("Location"), `https://${LORE}/downloads?src=x`);

  const willoHome = await (await get(`https://${WILLO}/`)).text();
  assert.match(willoHome, /data-door="willo"/);
  assert.match(willoHome, /\/download\/willo/);
  assert.match(willoHome, new RegExp(`<link rel="canonical" href="https://${WILLO.replace(".", "\\.")}/">`));

  const willoPlans = await (await get(`https://${WILLO}/plans`)).text();
  assert.match(willoPlans, /<span>Willo<\/span>/i);
  assert.match(willoPlans, new RegExp(`href="https://${LORE.replace(".", "\\.")}/"`), "a way back to the add-on");
});

test("the switch sends Willo's pages to her domain and takes the prices off Lore Forever", async () => {
  env.WILLO_SPLIT = "on";
  for (const path of ["/plans?from=x", "/willo", "/willo/style", "/w/abc123", "/creators", "/refunds", "/link?code=AB",
                      "/link/web?code=AB"]) {
    const { res } = await get(`https://${LORE}${path}`);
    assert.equal(res.status, 301, `${path}: the switch is final, so the move is permanent`);
    assert.equal(res.headers.get("Location"), `https://${WILLO}${path}`, path);
  }
  const back = await get(`https://${WILLO}/downloads?src=x`);
  assert.equal(back.res.status, 301);
  assert.equal(back.res.headers.get("Location"), `https://${LORE}/downloads?src=x`);
  const home = await (await get(`https://${LORE}/`)).text();
  assert.doesNotMatch(home, /\$\d+\.\d\d/, "no prices on Lore Forever");
  assert.doesNotMatch(home, /href="\/(plans|willo)"/);
  assert.match(home, /href="\/go\/willo\?next=%2F%3Fsrc%3D[a-z-]+"/, "a Meet Willo link, tagged so her site counts it");
  assert.match(home, /href="\/download\/willo\?src=[a-z-]+"/, "Willo's download one click away, tagged");
  assert.match(home, new RegExp(`id="nav-willo" href="https://${WILLO}/\\?src=`), "the header's Willo link goes to her home");
  assert.match(home, /Download for Windows/i, "the add-on's own download stays");
  for (const ld of home.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(ld[1]);
  assert.doesNotMatch(home, /door-split:|<!-- door:/);
});

test("the API, downloads and Stripe's webhook answer on both domains, never redirected", async () => {
  env.WILLO_SPLIT = "on";
  for (const host of [LORE, WILLO]) {
    for (const [method, path] of [["GET", "/api/companion/version"], ["POST", "/api/billing/webhook"],
                                  ["GET", "/download/willo"], ["GET", "/download/installer"], ["GET", "/img/wispr.svg"]]) {
      const { res, reached } = await get(`https://${host}${path}`, { method });
      assert.ok(reached && !(res.status >= 300 && res.status < 400), `${method} ${host}${path}`);
    }
  }
});

test("deleting WILLO_SPLIT turns the split off on the site", async () => {
  env.WILLO_SPLIT = "on";
  assert.equal((await get(`https://${LORE}/plans`)).res.status, 301);
  delete env.WILLO_SPLIT;
  assert.equal((await get(`https://${LORE}/plans`)).res.status, 200);
  assert.match(await (await get(`https://${LORE}/`)).text(), /\$4\.99/);
});

test("a sign-in carries from Lore Forever to Willo's domain, once", async () => {
  env.WILLO_SPLIT = "on";
  await setup(env);
  const user = await findOrCreateUser(env, { email: "mira@example.com", googleSub: "mira", name: "Mira" });
  const cookie = (await startSession(env, new Request(`https://${LORE}/`), user.id)).split(";")[0];

  const out = await go({ request: new Request(`https://${LORE}/go/willo?next=/account%23apps`, { headers: { Cookie: cookie } }),
                         env, params: { door: "willo" } });
  const land = new URL(out.headers.get("Location"));
  assert.equal(land.host, WILLO);
  assert.equal(land.pathname, "/go/in");

  const params = { door: "in" };
  const first = await go({ request: new Request(land), env, params });
  assert.equal(first.headers.get("Location"), `https://${WILLO}/account#apps`);
  const there = first.headers.get("Set-Cookie").split(";")[0];
  assert.equal((await currentUser(env, new Request(`https://${WILLO}/`, { headers: { Cookie: there } }))).id, user.id);

  const again = await go({ request: new Request(land), env, params });
  assert.equal(again.headers.get("Set-Cookie"), null, "a code works once");

  const signedOut = await go({ request: new Request(`https://${LORE}/go/willo?next=//evil.example`), env, params: { door: "willo" } });
  assert.equal(signedOut.headers.get("Location"), `https://${WILLO}/`, "never another site");
});

test("the develop site rehearses either door with ?door= and ?split=", async () => {
  const pick = await get("https://develop.lore-forever.pages.dev/plans?door=willo&split=on");
  assert.equal(pick.res.status, 302);
  assert.equal(pick.res.headers.get("Location"), "https://develop.lore-forever.pages.dev/plans");
  const cookies = pick.res.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const page = await (await get("https://develop.lore-forever.pages.dev/plans", { cookie: cookies })).text();
  assert.match(page, /data-door="willo"/);
  const lore = await get("https://develop.lore-forever.pages.dev/downloads", { cookie: cookies });
  assert.equal(lore.res.headers.get("Location"), "https://develop.lore-forever.pages.dev/downloads?door=lore");
});

test("the develop site shows the split by default, like production; ?split=off is the page before it", async () => {
  const dev = "https://develop.lore-forever.pages.dev/";
  const split = await (await get(dev)).text();
  assert.match(split, /href="\/go\/willo\?next=/, "the Meet Willo link, as on production");
  assert.doesNotMatch(split, /\$\d+\.\d\d/, "no prices");
  assert.match(await (await get(dev, { cookie: "lf_split=off" })).text(), /\$4\.99/);
});

test("each door lists only its own pages for search engines", async () => {
  env.WILLO_SPLIT = "on";
  const lore = await (await get(`https://${LORE}/sitemap.xml`)).text();
  assert.match(lore, /<loc>https:\/\/loreforeverwow\.com\/downloads<\/loc>/);
  assert.doesNotMatch(lore, /\/(plans|willo|creators)<\/loc>/);
  const willo = await (await get(`https://${WILLO}/sitemap.xml`)).text();
  assert.match(willo, new RegExp(`<loc>https://${WILLO.replace(".", "\\.")}/plans</loc>`));
});

test("a link to Willo's pages unfolds as hers: her card on her domain, her name, never Lore Forever's", async () => {
  for (const path of ["/", "/willo", "/plans", "/faq"]) {
    const html = await (await get(`https://${WILLO}${path}`)).text();
    const tag = key => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html)?.[1] ?? "";
    assert.match(tag("og:image"), new RegExp(`^https://${WILLO}/img/cards/willo`), path);
    assert.equal(tag("twitter:image"), tag("og:image"), path);
    assert.equal(tag("og:site_name"), "Willo", path);
    for (const key of ["og:title", "twitter:title", "og:description", "twitter:card"]) {
      assert.ok(tag(key), `${path} ${key}`);
      assert.doesNotMatch(tag(key), /lore forever is free|- lore forever$/i, `${path} ${key}`);
    }
    assert.doesNotMatch(html, /rel="(?:icon|apple-touch-icon)" href="\/img\/logo\./, path);
  }
});
