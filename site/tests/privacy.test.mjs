// The privacy page and the email list: every footer links /privacy, and /api/subscribe and /api/unsubscribe take posts
// only from our own pages, cap each sender per day, and unsubscribing never says whether an address was on the list.
// D1 is node:sqlite (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { onRequestPost as subscribe } from "../functions/api/subscribe.js";
import { onRequestPost as unsubscribe } from "../functions/api/unsubscribe.js";
import { setup } from "../lib/accounts.js";
import { perDayFromIp } from "../lib/ratelimit.js";
import { PER_DAY } from "../lib/subscribers.js";
import { page } from "../lib/voices.js";
import { d1 } from "./helpers.mjs";

const PUBLIC = new URL("../public/", import.meta.url).pathname;
const ORIGIN = "https://preview.example";
const PRIVACY = '<a href="/privacy">Privacy</a>';

// One database for the file (lib/accounts.js creates its tables once per process), emptied before each test.
const env = { DB: d1() };
beforeEach(async () => {
  await setup(env);
  env.DB.sqlite.exec("DELETE FROM rate_limits");
  env.DB.sqlite.exec("CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, source TEXT, created_at TEXT NOT NULL)");
  env.DB.sqlite.exec("DELETE FROM subscribers");
});

function pages(dir = PUBLIC) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return pages(p);
    return name.endsWith(".html") ? [p] : [];
  });
}

function post(fn, path, body, { origin = ORIGIN, ip = "203.0.113.7", form = false } = {}) {
  const headers = new Headers({ "CF-Connecting-IP": ip });
  if (origin) headers.set("Origin", origin);
  let payload;
  if (form) payload = new URLSearchParams(body);
  else { headers.set("Content-Type", "application/json"); payload = JSON.stringify(body); }
  return fn({ request: new Request(ORIGIN + path, { method: "POST", headers, body: payload }), env });
}
const sub = (email, opts) => post(subscribe, "/api/subscribe", { email, source: "landing-page" }, opts);
const unsub = (email, opts) => post(unsubscribe, "/api/unsubscribe", { email }, opts);
const listed = async () => (await env.DB.prepare("SELECT email FROM subscribers ORDER BY email").all()).results.map(r => r.email);

test("every page footer links the privacy page", () => {
  const footed = pages().filter(p => readFileSync(p, "utf8").includes('<footer class="wrap foot">'));
  assert.ok(footed.length >= 17, `only ${footed.length} pages with a footer`);
  for (const p of footed) {
    const foot = readFileSync(p, "utf8").split('<footer class="wrap foot">')[1].split("</footer>")[0];
    assert.ok(foot.includes(PRIVACY), `${relative(PUBLIC, p)}: footer has no privacy link`);
  }
  const built = page({ title: "X", description: "d", path: "/voices/x", crumb: "X", body: "" });
  assert.ok(built.split('<footer class="wrap foot">')[1].includes(PRIVACY), "lib/voices.js page()");
});

test("the sign-up, the account page, the studio and the release link the privacy page", () => {
  const read = f => readFileSync(join(PUBLIC, f), "utf8");
  assert.match(read("index.html").split('class="signup"')[1].split("</section>")[0], /href="\/privacy"/);
  assert.match(read("index.html"), /<a href="\/unsubscribe">Unsubscribe anytime<\/a>/);
  assert.match(read("account.html").split('class="ac-privacy"')[1].split("</details>")[0], /href="\/privacy"/);
  assert.match(read("voices/studio.js"), /href="\/privacy"/);
  assert.match(read("voices/release.html").split("<main")[1].split("</main>")[0], /href="\/privacy"/);
});

test("subscribing: our own pages only, a real address, and the honeypot", async () => {
  assert.equal((await sub("someone@example.com", { origin: "https://elsewhere.example" })).status, 403);
  assert.equal((await sub("someone@example.com", { origin: null })).status, 403);
  assert.equal((await sub("not an address")).status, 400);
  assert.deepEqual(await listed(), []);
  assert.equal((await post(subscribe, "/api/subscribe", { email: "bot@example.com", website: "x" })).status, 204);
  assert.deepEqual(await listed(), []);
  assert.equal((await sub("  Someone@Example.com ")).status, 204);
  assert.equal((await sub("someone@example.com")).status, 204, "signing up twice is fine");
  assert.deepEqual(await listed(), ["someone@example.com"]);
});

test("subscribing is capped per sender per day", async () => {
  for (let i = 0; i < PER_DAY.subscribe; i++) assert.equal((await sub(`p${i}@example.com`)).status, 204, `sign-up ${i + 1}`);
  const over = await sub("one-more@example.com");
  assert.equal(over.status, 429);
  assert.match((await over.json()).error, /tomorrow/);
  assert.equal((await sub("neighbour@example.com", { ip: "198.51.100.2" })).status, 204, "another sender isn't held up");
  assert.equal((await listed()).length, PER_DAY.subscribe + 1);
});

test("unsubscribing removes the address and says Done either way", async () => {
  await sub("leaving@example.com");
  await sub("staying@example.com");
  const gone = await unsub("Leaving@example.com");
  const never = await unsub("never-signed-up@example.com");
  assert.equal(gone.status, 200);
  assert.equal(never.status, 200);
  assert.deepEqual(await gone.json(), await never.json(), "same answer whether or not the address was on the list");
  assert.deepEqual(await listed(), ["staying@example.com"]);
});

test("unsubscribing: our own pages only, a real address, the honeypot, and a page without JavaScript", async () => {
  await sub("someone@example.com");
  assert.equal((await unsub("someone@example.com", { origin: "https://elsewhere.example" })).status, 403);
  assert.equal((await unsub("nope")).status, 400);
  assert.equal((await post(unsubscribe, "/api/unsubscribe", { email: "someone@example.com", website: "x" })).status, 200);
  assert.deepEqual(await listed(), ["someone@example.com"], "the honeypot changes nothing");

  const res = await unsub("someone@example.com", { form: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type"), /text\/html/);
  assert.match(await res.text(), /Done\. That address won't get any more emails from us\./);
  assert.deepEqual(await listed(), []);
});

test("unsubscribing is capped per sender per day", async () => {
  for (let i = 0; i < PER_DAY.unsubscribe; i++) assert.equal((await unsub(`p${i}@example.com`)).status, 200);
  const over = await unsub("one-more@example.com");
  assert.equal(over.status, 429);
  assert.match((await over.json()).error, /tomorrow/);
});

test("per-sender counts keep only today's rows", async () => {
  const request = ip => new Request(ORIGIN, { headers: { "CF-Connecting-IP": ip } });
  const yesterday = new Date("2026-10-02T12:00:00Z"), today = new Date("2026-10-03T08:00:00Z");
  assert.ok(await perDayFromIp(env, request("203.0.113.1"), "subscribe", 1, yesterday));
  assert.ok(await perDayFromIp(env, request("203.0.113.2"), "unsubscribe", 1, yesterday));
  assert.ok(!(await perDayFromIp(env, request("203.0.113.1"), "subscribe", 1, yesterday)), "over the limit");
  assert.ok(await perDayFromIp(env, request("203.0.113.3"), "subscribe", 1, today), "a new day starts at 0");
  const rows = (await env.DB.prepare("SELECT user_id, bucket FROM rate_limits ORDER BY bucket").all()).results;
  // The first count of a new day drops that scope's older rows, whoever sent them; other scopes go on their own day.
  assert.deepEqual(rows.map(r => r.bucket), ["subscribe:2026-10-03", "unsubscribe:2026-10-02"]);
  assert.ok(rows.every(r => /^ip:[0-9a-f]{24}$/.test(r.user_id)), "senders are daily hashes, never the address");
});
