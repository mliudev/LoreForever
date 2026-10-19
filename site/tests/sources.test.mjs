// Where visitors come from (lib/sources.js, functions/api/visit.js, functions/a/[slug].js): a visit counts under the
// tracked link, ?src= or other site that started it, never for a click inside the site or an address typed in; a
// browser's first source is kept in a cookie with only the source and its landing page; a tracked link opens its page
// with ?src= and counts the opening; and a link can only point at this site.
// D1 is node:sqlite (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as visit } from "../functions/api/visit.js";
import { onRequestGet as link } from "../functions/a/[slug].js";
import { onRequestGet as download } from "../functions/download/[file].js";
import { onRequest as device } from "../functions/api/device/[action].js";
import { setup, findOrCreateUser, startSession, deleteUser } from "../lib/accounts.js";
import { startLink } from "../lib/devices.js";
import { setupBilling } from "../lib/billing.js";
import { setupSources, saveLink, retireLink, sourceOfReferrer, firstTouch, landingOf, noteSignup, notePaidSource,
  countEvent, sourcesReport } from "../lib/sources.js";
import { onRequestGet as adminGet, onRequestPost as adminPost } from "../functions/api/admin/sources.js";
import { reportCsv, sourceName } from "../public/admin-sources.js";
import { d1 } from "./helpers.mjs";

const ORIGIN = "https://loreforeverwow.com";
const env = { DB: d1(), ADMIN_KEY: "admin-key" };
beforeEach(async () => {
  await setup(env);
  await setupSources(env);
  await setupBilling(env);
  for (const t of ["source_links", "source_events", "rate_limits", "account_sources", "source_invoices", "users", "sessions",
                   "devices", "device_links", "entitlements"]) env.DB.sqlite.exec(`DELETE FROM ${t}`);
});

const tell = async (body, cookie = "") => {
  const res = await visit({ env, waitUntil: null, request: new Request(`${ORIGIN}/api/visit`, { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}),
               "CF-Connecting-IP": "203.0.113.9" }, body: JSON.stringify(body) }) });
  return { status: res.status, cookie: (res.headers.get("Set-Cookie") || "").split(";")[0] };
};
const events = () => env.DB.sqlite.prepare("SELECT src, landing, kind, n FROM source_events ORDER BY src, kind").all()
  .map(r => ({ ...r }));

test("a visit counts under what started it; the first one stays in a cookie with only the source and the page", async () => {
  const first = await tell({ src: "", landing: "/willo/", ref: "https://www.pcgamer.com/games/wow-forever-guide/" });
  assert.equal(first.status, 204);
  assert.equal(first.cookie, "lf_src=site%3Apcgamer.com|%2Fwillo", "the other site's address, never its page");
  assert.deepEqual(firstTouch(new Request(ORIGIN, { headers: { Cookie: first.cookie } })), { src: "site:pcgamer.com", landing: "/willo" });
  // Later visits count, and the first source stays.
  const again = await tell({ src: "pcgamer-forever", landing: "/downloads", ref: "" }, first.cookie);
  assert.equal(again.cookie, "");
  await tell({ src: "", landing: "/guides/leveling", ref: "https://www.google.com/" });
  assert.deepEqual(events(), [
    { src: "pcgamer-forever", landing: "/downloads", kind: "visit", n: 1 },
    { src: "search:google", landing: "/guides/leveling", kind: "new", n: 1 },
    { src: "search:google", landing: "/guides/leveling", kind: "visit", n: 1 },
    { src: "site:pcgamer.com", landing: "/willo", kind: "new", n: 1 },
    { src: "site:pcgamer.com", landing: "/willo", kind: "visit", n: 1 },
  ]);
  // A click inside the site, an address typed in, or another site's page: nothing.
  for (const body of [{ src: "lore", landing: "/downloads", ref: `${ORIGIN}/lore/elwynn-forest` }, { landing: "/" },
                      { src: "<script>", landing: "/" }]) {
    const res = await tell(body);
    assert.equal(res.cookie, "", JSON.stringify(body));
  }
  assert.equal(events().length, 5);
  const foreign = await visit({ env, request: new Request(`${ORIGIN}/api/visit`, { method: "POST",
    headers: { Origin: "https://evil.example" }, body: JSON.stringify({ src: "x", landing: "/" }) }) });
  assert.equal(foreign.status, 204);
  assert.equal(events().length, 5, "only from our own pages");
});

test("a tracked link opens its page with ?src=, counts the opening, and keeps the first source; only to this site", async () => {
  assert.match((await saveLink(env, { slug: "PCGamer-Forever", label: "PC Gamer guide", target: "https://evil.example/x" })).error,
    /page of loreforeverwow\.com/);
  const { link: saved } = await saveLink(env, { slug: "PCGamer-Forever", label: "PC Gamer guide", target: "/willo?from=pc" });
  assert.equal(saved.slug, "pcgamer-forever");
  const open = async (slug, cookie = "") => link({ env, params: { slug }, request: new Request(`${ORIGIN}/a/${slug}`,
    { headers: cookie ? { Cookie: cookie } : {} }) });
  const res = await open("pcgamer-forever");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), "/willo?from=pc&src=pcgamer-forever");
  assert.match(res.headers.get("Set-Cookie"), /^lf_src=pcgamer-forever\|%2Fwillo;/);
  assert.equal((await open("pcgamer-forever", "lf_src=search%3Agoogle|%2F")).headers.get("Set-Cookie"), null, "the first stays");
  assert.equal(env.DB.sqlite.prepare("SELECT opens FROM source_links WHERE slug = 'pcgamer-forever'").get().opens, 2);
  // QA 10/19: the page's own visit report then finds the cookie the link just set, so the browser's first visit is
  // counted here, once (it showed 1 visit and 0 first visits).
  await tell({ src: "pcgamer-forever", landing: "/willo", ref: "" }, res.headers.get("Set-Cookie").split(";")[0]);
  assert.deepEqual(events().filter(e => e.src === "pcgamer-forever"), [
    { src: "pcgamer-forever", landing: "/willo", kind: "new", n: 1 },
    { src: "pcgamer-forever", landing: "/willo", kind: "visit", n: 1 }]);
  await retireLink(env, "pcgamer-forever");
  assert.equal((await open("pcgamer-forever")).headers.get("Location"), "/");
  assert.equal((await open("nope")).headers.get("Location"), "/");
});

test("sources and landing pages as they're kept", () => {
  assert.equal(sourceOfReferrer("https://www.google.co.uk/"), "search:google");
  assert.equal(sourceOfReferrer("https://duckduckgo.com/"), "search:duckduckgo");
  assert.equal(sourceOfReferrer("https://m.youtube.com/watch?v=1"), "site:youtube.com");
  assert.equal(sourceOfReferrer("https://loreforeverwow.com/willo"), "");
  assert.equal(sourceOfReferrer("not a url"), "");
  assert.equal(landingOf("/guides/leveling/?utm=x#top"), "/guides/leveling");
  assert.equal(landingOf("javascript:alert(1)"), "/");
});

test("a browser's first source carries through its download, sign-up, first Willo connect and plans", async () => {
  const cookie = "lf_src=pcgamer-forever|%2Fwillo";
  const res = await download({ env, waitUntil: null, params: { file: "zip" },
    request: new Request(`${ORIGIN}/download/zip`, { headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" } }) });
  assert.equal(res.status, 302);
  // Signed up in that browser: the account keeps where it came from.
  const user = await findOrCreateUser(env, { email: "fan@example.com", googleSub: "fan", name: "Fan" });
  await noteSignup(env, new Request(ORIGIN, { headers: { Cookie: cookie } }), user);
  await noteSignup(env, new Request(ORIGIN, { headers: { Cookie: "lf_src=search%3Agoogle|%2F" } }), user);
  // Its first Willo connect, then a second one: counted once.
  const approve = async () => {
    const pending = await startLink(env);
    const session = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
    const r = await device({ env, params: { action: "approve" }, request: new Request(`${ORIGIN}/api/device/approve`, {
      method: "POST", body: JSON.stringify({ code: pending.user_code }),
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: `${session}; ${cookie}` } }) });
    assert.equal(r.status, 200);
  };
  await approve();
  await approve();
  // Paid: the first invoice is the plan, every one is revenue (without tax), each counted once.
  await env.DB.prepare("INSERT INTO entitlements (user_id, customer_id, updated) VALUES (?, 'cus_fan', ?)")
    .bind(user.id, new Date().toISOString()).run();
  const invoice = (id, paid, tax = 0) => ({ id, customer: "cus_fan", amount_paid: paid, total_taxes: tax ? [{ amount: tax }] : [],
    status_transitions: { paid_at: Date.now() / 1000 } });
  await notePaidSource(env, invoice("in_1", 549, 50));
  await notePaidSource(env, invoice("in_1", 549, 50));
  await notePaidSource(env, invoice("in_2", 499));
  const got = env.DB.sqlite.prepare("SELECT kind, SUM(n) AS n, SUM(cents) AS cents FROM source_events WHERE src = 'pcgamer-forever' " +
    "AND landing = '/willo' GROUP BY kind ORDER BY kind").all().map(r => ({ ...r }));
  assert.deepEqual(got, [{ kind: "download:zip", n: 1, cents: 0 }, { kind: "paid", n: 1, cents: 0 },
    { kind: "revenue", n: 2, cents: 998 }, { kind: "signup", n: 1, cents: 0 }, { kind: "willo", n: 1, cents: 0 }]);
  const row = env.DB.sqlite.prepare("SELECT src, landing, cents, signup IS NOT NULL AS s, willo IS NOT NULL AS w, paid IS NOT NULL AS p " +
    "FROM account_sources WHERE user_id = ?").get(user.id);
  assert.deepEqual({ ...row }, { src: "pcgamer-forever", landing: "/willo", cents: 998, s: 1, w: 1, p: 1 });
  // Delete my account: where it came from goes; the day's counts stay.
  await deleteUser(env, user);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM account_sources").get().n, 0);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM source_events WHERE kind = 'signup'").get().n, 1);
});

test("/admin's Sources: each source's path between two days, by landing page too, as a CSV; links made with the key only", async () => {
  const day = (d, ms = Date.parse(`2026-10-${d}T12:00:00Z`)) => ({ now: ms });
  await saveLink(env, { slug: "pcgamer-forever", label: "PC Gamer, WoW Forever guide", target: "/willo" });
  for (const [kind, n] of [["visit", 3], ["new", 2], ["download:installer", 1], ["download:willo", 1], ["signup", 1], ["willo", 1], ["paid", 1]])
    for (let i = 0; i < n; i++) await countEvent(env, "pcgamer-forever", "/willo", kind, day(18));
  await countEvent(env, "pcgamer-forever", "/willo", "revenue", { cents: 499, ...day(18) });
  await countEvent(env, "pcgamer-forever", "/downloads", "visit", day(19));
  await countEvent(env, "search:google", "/guides/leveling", "visit", day(19));
  await countEvent(env, "site:reddit.com", "/", "visit", day(1));                       // outside the range
  const res = await sourcesReport(env, { from: "2026-10-10", to: "2026-10-19" });
  assert.deepEqual(res.rows.map(r => [r.src, r.visits, r.new, r.downloads, r.willoDownloads, r.signups, r.willo, r.paid, r.revenue]), [
    ["pcgamer-forever", 4, 2, 2, 1, 1, 1, 1, 499], ["search:google", 1, 0, 0, 0, 0, 0, 0, 0]]);
  assert.equal(res.rows[0].label, "PC Gamer, WoW Forever guide");
  assert.equal(res.totals.visits, 5);
  const byPage = await sourcesReport(env, { from: "2026-10-10", to: "2026-10-19", byLanding: true });
  assert.deepEqual(byPage.rows.map(r => [r.src, r.landing, r.visits]).sort(), [["pcgamer-forever", "/downloads", 1],
    ["pcgamer-forever", "/willo", 3], ["search:google", "/guides/leveling", 1]]);
  const csv = reportCsv(res).split("\n");
  assert.equal(csv[0], "Source,Source key,Visits,First visits,Downloads,Willo downloads,Sign-ups,Willo connected,Paid plans,Revenue (USD)");
  assert.equal(csv[1], '"PC Gamer, WoW Forever guide (pcgamer-forever)",pcgamer-forever,4,2,2,1,1,1,1,4.99');
  assert.equal(csv[3], "Total,,5,2,2,1,1,1,1,4.99");
  assert.equal(sourceName({ src: "search:google" }), "Search: Google");
  assert.equal(sourceName({ src: "site:pcgamer.com" }), "Site: pcgamer.com");

  // The API: the admin key, from our own pages.
  const ask = (method, body, headers = { Authorization: "Bearer admin-key" }) => (method === "GET" ? adminGet : adminPost)({ env,
    request: new Request(`${ORIGIN}/api/admin/sources?from=2026-10-10&to=2026-10-19`, { method, headers: { ...headers,
      ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }) });
  assert.equal((await ask("GET", null, {})).status, 401);
  assert.equal((await (await ask("GET")).json()).rows.length, 2);
  const made = await (await ask("POST", { action: "link", slug: "wowhead-news", label: "Wowhead news", target: "/downloads" })).json();
  assert.equal(made.url, `${ORIGIN}/a/wowhead-news`);
  assert.equal((await ask("POST", { action: "link", slug: "x", target: "https://evil.example" })).status, 400);
  assert.equal((await ask("POST", { action: "retire", slug: "wowhead-news" })).status, 200);
  assert.equal((await ask("POST", { action: "link", slug: "y" }, { Authorization: "Bearer admin-key", Origin: "https://evil.example" })).status, 403);
});
