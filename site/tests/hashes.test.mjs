// The daily IP hash (lib/form.js senderHash): salted with a random salt per day kept in D1, old salts deleted, and
// earlier days' stored hashes replaced without changing any count. Plus the admin key checks and the site-wide headers.
// D1 is node:sqlite (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { senderHash } from "../lib/form.js";
import { hasBearer, authorized } from "../lib/auth.js";
import { addLike, likeCounts } from "../lib/voices.js";
import { onRequestGet as feedbackGet } from "../functions/api/feedback.js";
import { onRequest as middleware } from "../functions/_middleware.js";
import { d1, SITE } from "./helpers.mjs";

const fresh = () => ({ DB: d1() });
const salts = env => env.DB.sqlite.prepare("SELECT day FROM daily_salts ORDER BY day").all().map(r => r.day);
const like = ip => new Request("https://preview.example/api/voices/like", { headers: { "CF-Connecting-IP": ip } });

test("the hash: 24 hex characters, one per sender per day, and not the old unsalted one", async () => {
  const env = fresh();
  const a = await senderHash(env, "203.0.113.7", "2026-10-03");
  assert.match(a, /^[0-9a-f]{24}$/);
  assert.equal(await senderHash(env, "203.0.113.7", "2026-10-03"), a, "same sender, same day");
  assert.notEqual(await senderHash(env, "203.0.113.8", "2026-10-03"), a, "another sender");
  assert.notEqual(await senderHash(env, "203.0.113.7", "2026-10-04"), a, "another day");
  // Before daily_salts anyone could rebuild this from the day and an IP; now it needs the salt.
  const unsalted = createHash("sha256").update("loreforever:2026-10-03:203.0.113.7").digest("hex").slice(0, 24);
  assert.notEqual(a, unsalted);
  assert.notEqual(await senderHash(fresh(), "203.0.113.7", "2026-10-03"), a, "another database has its own salt");
});

test("requests at the same moment agree on the day's salt", async () => {
  const env = fresh();
  const hashes = await Promise.all(Array.from({ length: 8 }, () => senderHash(env, "198.51.100.1", "2026-10-03")));
  assert.equal(new Set(hashes).size, 1);
  assert.deepEqual(salts(env), ["2026-10-03"]);
  const salt = env.DB.sqlite.prepare("SELECT salt FROM daily_salts").get().salt;
  assert.match(salt, /^[0-9a-f]{64}$/, "32 random bytes");
});

test("a new day's salt deletes the ones from before yesterday", async () => {
  const env = fresh();
  for (const day of ["2026-09-30", "2026-10-01", "2026-10-02"]) await senderHash(env, "192.0.2.1", day);
  assert.deepEqual(salts(env), ["2026-10-01", "2026-10-02"]);
  await senderHash(env, "192.0.2.1", "2026-10-05");
  assert.deepEqual(salts(env), ["2026-10-05"]);
});

test("earlier days' hashes are replaced once, and every count stays the same", async () => {
  const env = fresh();
  const db = env.DB.sqlite;
  const old = n => createHash("sha256").update(String(n)).digest("hex").slice(0, 24);   // like the unsalted hashes
  db.exec(`CREATE TABLE voice_likes (voice_id TEXT NOT NULL, day TEXT NOT NULL, ip_hash TEXT NOT NULL, PRIMARY KEY (voice_id, day, ip_hash));
           CREATE TABLE translation_likes (locale TEXT NOT NULL, day TEXT NOT NULL, ip_hash TEXT NOT NULL, PRIMARY KEY (locale, day, ip_hash));`);
  for (const t of ["feedback", "voice_submissions", "translation_submissions", "translation_reports"]) {
    db.exec(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL, sender TEXT NOT NULL)`);
  }
  const days = ["2026-10-01", "2026-10-02", "2026-10-03"];
  let n = 0;
  for (const day of days) {
    for (let i = 0; i < 5; i++) {
      db.prepare("INSERT INTO voice_likes VALUES (?, ?, ?)").run(i % 2 ? "female" : "male", day, old(n++));
      db.prepare("INSERT INTO translation_likes VALUES (?, ?, ?)").run("deDE", day, old(n++));
      for (const t of ["feedback", "voice_submissions", "translation_submissions", "translation_reports"]) {
        db.prepare(`INSERT INTO ${t} (created, sender) VALUES (?, ?)`).run(`${day}T12:00:00.000Z`, old(n++));
      }
    }
  }
  const counts = () => [
    db.prepare("SELECT voice_id, COUNT(*) AS n FROM voice_likes GROUP BY voice_id ORDER BY voice_id").all().map(r => ({ ...r })),
    db.prepare("SELECT COUNT(*) AS n FROM translation_likes").get().n,
  ];
  const before = counts();

  await senderHash(env, "192.0.2.1", "2026-10-03");   // today is 10-03: the 10-01 and 10-02 rows are over
  assert.deepEqual(counts(), before, "like counts unchanged");
  const lengths = (table, column, date) => db.prepare(
    `SELECT substr(${date}, 1, 10) AS day, length(${column}) AS len, COUNT(*) AS n FROM ${table} GROUP BY 1, 2 ORDER BY 1`
  ).all().map(r => `${r.day}:${r.len}x${r.n}`);
  for (const [table, column, date] of [["voice_likes", "ip_hash", "day"], ["translation_likes", "ip_hash", "day"],
    ["feedback", "sender", "created"], ["voice_submissions", "sender", "created"],
    ["translation_submissions", "sender", "created"], ["translation_reports", "sender", "created"]]) {
    assert.deepEqual(lengths(table, column, date), ["2026-10-01:12x5", "2026-10-02:12x5", "2026-10-03:24x5"], table);
  }

  // The next day replaces 10-03's, and leaves the rows already replaced as they are.
  const kept = db.prepare("SELECT ip_hash FROM voice_likes WHERE day < '2026-10-03' ORDER BY rowid").all().map(r => r.ip_hash);
  await senderHash(env, "192.0.2.1", "2026-10-04");
  assert.deepEqual(db.prepare("SELECT ip_hash FROM voice_likes WHERE day < '2026-10-03' ORDER BY rowid").all().map(r => r.ip_hash), kept);
  assert.deepEqual(lengths("feedback", "sender", "created"), ["2026-10-01:12x5", "2026-10-02:12x5", "2026-10-03:12x5"]);
  assert.deepEqual(counts(), before, "still unchanged");
});

test("clip reports: earlier days' hashes are replaced in sender and uploader, one sender's reports stay together", async () => {
  const env = fresh();
  const db = env.DB.sqlite;
  db.exec("CREATE TABLE clip_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL, sender TEXT NOT NULL, uploader TEXT NOT NULL)");
  const [a, b, c] = ["a", "b", "c"].map(x => x.repeat(24));
  const add = (day, sender, uploader) => db.prepare("INSERT INTO clip_reports (created, sender, uploader) VALUES (?, ?, ?)")
    .run(`${day}T12:00:00.000Z`, sender, uploader);
  add("2026-10-02", a, "ip:" + a);
  add("2026-10-02", a, "ip:" + a);
  add("2026-10-02", b, "ip:" + b);
  add("2026-10-03", c, "ip:" + c);
  add("2026-10-02", a, "u:42");

  await senderHash(env, "192.0.2.1", "2026-10-03");   // today is 10-03
  const rows = db.prepare("SELECT sender, uploader FROM clip_reports ORDER BY id").all();
  for (const r of rows.slice(0, 3)) {
    assert.match(r.sender, /^[0-9a-f]{12}$/);
    assert.match(r.uploader, /^ip:[0-9a-f]{12}$/);
  }
  assert.equal(rows[0].uploader, rows[1].uploader, "one sender's reports still go together");
  assert.notEqual(rows[0].uploader, rows[2].uploader);
  assert.deepEqual({ ...rows[3] }, { sender: c, uploader: "ip:" + c }, "today's stay");
  assert.equal(rows[4].uploader, "u:42", "signed-in senders are left alone");
  assert.match(rows[4].sender, /^[0-9a-f]{12}$/);
});

test("likes still count once per sender per day", async () => {
  const env = fresh();
  assert.equal(await addLike(env, like("203.0.113.1"), "male"), 1);
  assert.equal(await addLike(env, like("203.0.113.1"), "male"), 1, "the same sender again today");
  assert.equal(await addLike(env, like("203.0.113.2"), "male"), 2);
  assert.deepEqual(await likeCounts(env), { male: 2 });
  assert.ok(env.DB.sqlite.prepare("SELECT ip_hash FROM voice_likes").all().every(r => /^[0-9a-f]{24}$/.test(r.ip_hash)));
});

test("admin keys are compared in constant time, and GET /api/feedback uses FEEDBACK_KEY", async () => {
  const req = auth => new Request("https://preview.example/api/feedback", { headers: auth ? { Authorization: auth } : {} });
  assert.equal(await hasBearer(req("Bearer secret"), "secret"), true);
  assert.equal(await hasBearer(req("Bearer secreT"), "secret"), false);
  assert.equal(await hasBearer(req("Bearer "), ""), false, "an unset key lets nobody in");
  assert.equal(await hasBearer(req(null), "secret"), false);
  assert.equal(await hasBearer(req("secret"), "secret"), false, "Bearer is required");
  assert.equal(await authorized(req("Bearer admin"), { ADMIN_KEY: "admin", FEEDBACK_KEY: "fb" }), true);
  assert.equal(await authorized(req("Bearer fb"), { FEEDBACK_KEY: "fb" }), true);

  const env = { DB: d1(), FEEDBACK_KEY: "fb-key", ADMIN_KEY: "admin-key" };
  assert.equal((await feedbackGet({ request: req("Bearer fb-key"), env })).status, 200);
  assert.equal((await feedbackGet({ request: req("Bearer fb-kez"), env })).status, 401);
  assert.equal((await feedbackGet({ request: req(null), env })).status, 401);
  assert.equal((await feedbackGet({ request: req("Bearer "), env: { DB: d1() } })).status, 401, "off without FEEDBACK_KEY");
});

test("every page gets X-Frame-Options and Referrer-Policy, from _headers and from the middleware", async () => {
  const headers = readFileSync(join(SITE, "public/_headers"), "utf8");
  const all = headers.split(/\n(?=\S)/).find(block => block.startsWith("/*\n"));
  assert.ok(all, "_headers has a /* rule");
  assert.match(all, /^ {2}X-Frame-Options: DENY$/m);
  assert.match(all, /^ {2}Referrer-Policy: strict-origin-when-cross-origin$/m);

  const request = new Request("https://preview.example/u/aelric");
  for (const res of [new Response("<p>page</p>"), Response.redirect("https://preview.example/downloads", 302)]) {
    const out = await middleware({ request, env: {}, next: async () => res });
    assert.equal(out.headers.get("X-Frame-Options"), "DENY");
    assert.equal(out.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
    assert.equal(out.status, res.status);
  }
  const page = await middleware({ request, env: {}, next: async () => new Response("<p>page</p>", { headers: { "Content-Type": "text/html" } }) });
  assert.equal(await page.text(), "<p>page</p>");
  assert.equal(page.headers.get("Content-Type"), "text/html");
  // The old-address redirect is untouched (it never reaches next()).
  const moved = await middleware({ request: new Request("https://lore-forever.pages.dev/feedback"), env: { CANONICAL_HOST: "loreforeverwow.com" },
    next: async () => { throw new Error("not reached"); } });
  assert.equal(moved.status, 301);
});
