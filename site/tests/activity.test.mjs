// Sign-in days (LOR-304) and downloads by signed-in players (LOR-8), lib/activity.js. Both ride on paths players must
// never feel: a download and a sign-in. The handlers run in-process on node:sqlite (helpers.mjs); nothing here
// requests the live site, and no download link is ever fetched. Run: node --test site/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestGet as download } from "../functions/download/[file].js";
import { setup, findOrCreateUser, startSession, currentUser, deleteUser, sha256 } from "../lib/accounts.js";
import { activityReport, utcDay } from "../lib/activity.js";
import { onRequestGet as adminGet, onRequestPost as adminPost } from "../functions/api/admin.js";
import { d1 } from "./helpers.mjs";

const ORIGIN = "https://loreforeverwow.com";
const rows = (db, sql, ...args) => db.sqlite.prepare(sql).all(...args).map(r => ({ ...r }));

test("a signed-in download also counts for the account, and that count never holds up or stops a download", async () => {
  const env = { DB: d1() };
  await setup(env);
  const user = await findOrCreateUser(env, { email: "aelric@example.com", googleSub: "aelric", name: "Aelric" });
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  const get = (file, headers = {}, context = {}) => download({ env, params: { file }, ...context,
    request: new Request(`${ORIGIN}/download/${file}`, { headers }) });

  for (const [file, headers] of [["installer", { Cookie: cookie }], ["installer", { Cookie: cookie }], ["zip", {}],
                                 ["zip", { Cookie: "lf_session=" + "0".repeat(64) }]]) {
    const res = await get(file, headers);
    assert.equal(res.status, 302);
    assert.match(res.headers.get("Location"), /^https:\/\/github\.com\/mliudev\/LoreForever\/releases\/latest\/download\//);
  }
  assert.deepEqual(rows(env.DB, "SELECT file, user_id, n FROM download_accounts"), [{ file: "installer", user_id: user.id, n: 2 }]);
  assert.equal(env.DB.sqlite.prepare("SELECT SUM(n) AS n FROM downloads").get().n, 4, "every download still counts anonymously");

  // The account's count failing, or hanging, changes nothing for the player: the redirect and the anonymous count.
  env.DB.sqlite.exec("DROP TABLE download_accounts");
  assert.equal((await get("zip", { Cookie: cookie })).status, 302);
  const hanging = { ...env.DB, prepare: sql => /FROM sessions/.test(sql) ? { bind: () => ({ first: () => new Promise(() => {}) }) }
                                                                       : env.DB.prepare(sql) };
  const later = [];
  const res = await download({ env: { DB: hanging }, params: { file: "installer" }, waitUntil: p => later.push(p),
    request: new Request(`${ORIGIN}/download/installer`, { headers: { Cookie: cookie } }) });
  assert.equal(res.status, 302);
  assert.equal(later.length, 1, "the account's count runs after the response");
  assert.equal(env.DB.sqlite.prepare("SELECT SUM(n) AS n FROM downloads").get().n, 6);
});

test("sign-in days: noted once a day, filled in for an older database, gone with the account, never in sign-in's way", async () => {
  // A database from before LOR-304: users without last_seen, an account made 3 days ago and signed in again yesterday.
  const env = { DB: d1() };
  env.DB.sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, google_sub TEXT UNIQUE, display_name TEXT,
    links TEXT, show_public INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL)`);
  env.DB.sqlite.exec("CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL)");
  const at = days => new Date(Date.now() + days * 864e5).toISOString();
  const token = "a".repeat(64);
  env.DB.sqlite.prepare("INSERT INTO users (id, email, created) VALUES ('u1', 'morwen@example.com', ?)").run(at(-3));
  env.DB.sqlite.prepare("INSERT INTO sessions VALUES (?, 'u1', ?, ?)").run(await sha256(token), at(-1), at(29));
  await setup(env);
  assert.equal(env.DB.sqlite.prepare("SELECT last_seen FROM users").get().last_seen, utcDay(Date.now(), -1));
  assert.deepEqual(rows(env.DB, "SELECT day FROM signin_days ORDER BY day").map(r => r.day),
    [utcDay(Date.now(), -3), utcDay(Date.now(), -1)]);

  const request = new Request(ORIGIN + "/api/auth/me", { headers: { Cookie: "lf_session=" + token } });
  assert.equal((await currentUser(env, request)).id, "u1");
  assert.equal((await currentUser(env, request)).last_seen, utcDay());
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM signin_days").get().n, 3);
  assert.equal((await activityReport(env)).returning.returned, 1, "signed in on 2+ different days");

  await deleteUser(env, { id: "u1" });
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM signin_days").get().n, 0);

  // Noting the day failing never signs anyone out.
  const user = await findOrCreateUser(env, { email: "brann@example.com", googleSub: "brann", name: "Brann" });
  env.DB.sqlite.exec("DROP TABLE signin_days");
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  env.DB.sqlite.exec("UPDATE users SET last_seen = NULL");
  assert.equal((await currentUser(env, new Request(ORIGIN, { headers: { Cookie: cookie } }))).id, user.id);
});

test("/admin's counts leave out the admin's own account and ANALYTICS_EXCLUDE's; Count again brings one back", async () => {
  const env = { DB: d1(), ADMIN_KEY: "k", ANALYTICS_EXCLUDE: "tester@example.com, someone-else@example.com" };
  await setup(env);
  const mike = await findOrCreateUser(env, { email: "mike@example.com", googleSub: "mike", name: "Mike" });
  await findOrCreateUser(env, { email: "Tester@example.com", googleSub: "tester", name: "Tester" });
  await findOrCreateUser(env, { email: "player@example.com", googleSub: "player", name: "Player" });
  const cookie = (await startSession(env, new Request(ORIGIN), mike.id)).split(";")[0];
  const headers = { Authorization: "Bearer k", Cookie: cookie };   // the admin's browser, signed in on the site
  const get = async () => (await adminGet({ env, request: new Request(ORIGIN + "/api/admin", { headers }) })).json();
  let d = await get();
  assert.deepEqual([d.signups.accounts, d.funnel.stages.accounts, d.activity.returning.accounts], [1, 1, 1]);
  assert.deepEqual(d.activity.excluded, { accounts: 2, admin: 1, config: 1 });
  const post = body => adminPost({ env, request: new Request(ORIGIN + "/api/admin", { method: "POST",
    headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  assert.equal((await post({ action: "count-account", id: mike.id })).status, 200);
  d = await get();   // still signed in on that browser: counted again sticks
  assert.equal(d.signups.accounts, 2);
});
