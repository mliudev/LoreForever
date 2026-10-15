// Willo's one-click sign-in to the site (lib/weblogin.js): the app's one-time link (POST /api/companion/web-login)
// opens the browser signed in to the app's own account (GET /link/web), once, for two minutes, and only ever on our
// own pages. D1 is node:sqlite (helpers.mjs). Run: node --test site/tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onRequest as deviceApi } from "../functions/api/device/[action].js";
import { onRequest as webLoginApi } from "../functions/api/companion/web-login.js";
import { onRequestGet as linkWeb } from "../functions/link/web.js";
import { findOrCreateUser, startSession, currentUser, setup, sha256 } from "../lib/accounts.js";

import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const CLIENT = "companion/0.17.0";
const env = { DB: d1() };
beforeEach(async () => {
  await setup(env);
  for (const t of ["sessions", "users", "rate_limits", "devices", "device_links", "web_logins"]) env.DB.sqlite.exec(`DELETE FROM ${t}`);
});

async function signIn(sub) {
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  return { user, cookie: (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0] };
}

async function device(action, body, cookie) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (cookie) { headers.set("Cookie", cookie); headers.set("Origin", ORIGIN); } else headers.set("X-LF-Client", CLIENT);
  const request = new Request(`${ORIGIN}/api/device/${action}`, { method: "POST", headers, body: JSON.stringify(body) });
  return (await deviceApi({ request, env, params: { action } })).json();
}

// The companion connected to `who`'s account, as a player connects it; its token.
async function connect(who) {
  const start = await device("start", {});
  await device("approve", { code: start.user_code }, who.cookie);
  return (await device("token", { device_code: start.device_code })).token;
}

async function ask(token, body = { next: "/plans" }) {
  const request = new Request(`${ORIGIN}/api/companion/web-login`, { method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-LF-Client": CLIENT, Authorization: `Bearer ${token}` } });
  const res = await webLoginApi({ request, env });
  return { status: res.status, body: await res.json() };
}

// The browser opens the link: where it goes, and the session cookie it gets, if any.
async function open(url, cookie) {
  const res = await linkWeb({ request: new Request(url, { headers: cookie ? { Cookie: cookie } : {} }), env });
  const set = res.headers.get("Set-Cookie");
  return { status: res.status, location: res.headers.get("Location"), cookie: set ? set.split(";")[0] : null };
}

const whoIs = async cookie => (await currentUser(env, new Request(ORIGIN, { headers: { Cookie: cookie } })))?.id ?? null;

test("the app's link signs the browser in to the app's own account at next, once", async () => {
  const me = await signIn("aelric");
  const token = await connect(me);
  const got = await ask(token, { next: "/plans#hero" });
  assert.equal(got.status, 200, JSON.stringify(got.body));
  const link = new URL(got.body.url);
  assert.equal(link.origin + link.pathname, `${ORIGIN}/link/web`);
  assert.equal(link.searchParams.get("next"), "/plans#hero");
  assert.equal(got.body.expires_in, 120);
  // D1 keeps only the link's hash.
  const row = env.DB.sqlite.prepare("SELECT * FROM web_logins").get();
  assert.equal(row.token_hash, await sha256(link.searchParams.get("t")));
  assert.equal(row.user_id, me.user.id);

  const first = await open(got.body.url);
  assert.deepEqual([first.status, first.location], [303, `${ORIGIN}/plans#hero`]);
  assert.equal(await whoIs(first.cookie), me.user.id);
  // Used: no second sign-in. Signed out, the sign-in page says so and carries on to the plans after.
  const again = await open(got.body.url);
  assert.deepEqual([again.location, again.cookie], [`${ORIGIN}/account?next=%2Fplans&link=expired`, null]);
  // Signed in already, it just goes on.
  assert.deepEqual(await open(got.body.url, first.cookie), { status: 303, location: `${ORIGIN}/plans#hero`, cookie: null });
});

test("an expired link signs nobody in", async () => {
  const token = await connect(await signIn("aelric"));
  const { url } = (await ask(token, { next: "/account#billing" })).body;
  env.DB.sqlite.exec(`UPDATE web_logins SET expires = '${new Date(Date.now() - 1000).toISOString()}'`);
  assert.deepEqual(await open(url), { status: 303, location: `${ORIGIN}/account?link=expired`, cookie: null });
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 1, "only the player's own sign-in");
});

test("next is only ever one of our pages", async () => {
  const token = await connect(await signIn("aelric"));
  for (const next of ["https://evil.example/", "//evil.example/plans", "/plans/../admin", "/admin", "/plans?next=//evil",
                      "/account\\@evil.example", "javascript:alert(1)", 7]) {
    const got = await ask(token, { next });
    assert.equal(got.status, 400, `${next}: ${JSON.stringify(got.body)}`);
  }
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM web_logins").get().n, 0);
  // A link whose next was changed on the way signs nobody in and goes to our own sign-in page.
  const { url } = (await ask(token)).body;
  const changed = new URL(url);
  changed.searchParams.set("next", "https://evil.example/");
  assert.deepEqual(await open(changed.toString()), { status: 303, location: `${ORIGIN}/account`, cookie: null });
});

test("a link signs in only its app's account, and stops working once the app is disconnected", async () => {
  const me = await signIn("aelric"), other = await signIn("thrall");
  const token = await connect(me);
  // The browser was signed in to another account: it ends up in the app's, and the other session is gone.
  const opened = await open((await ask(token)).body.url, other.cookie);
  assert.equal(await whoIs(opened.cookie), me.user.id);
  assert.equal(await whoIs(other.cookie), null);
  // Disconnected (Sign out in the app): a link it got before signs nobody in.
  const { url } = (await ask(token)).body;
  const request = new Request(`${ORIGIN}/api/device/disconnect`, { method: "POST", body: "{}",
    headers: { "Content-Type": "application/json", "X-LF-Client": CLIENT, Authorization: `Bearer ${token}` } });
  await deviceApi({ request, env, params: { action: "disconnect" } });
  assert.equal((await open(url)).cookie, null);
  assert.equal((await ask(token)).status, 401);
  // The website itself can't ask for one (no device token, or a page's Origin).
  const page = new Request(`${ORIGIN}/api/companion/web-login`, { method: "POST", body: "{}",
    headers: { "Content-Type": "application/json", Cookie: me.cookie, Origin: ORIGIN } });
  assert.equal((await webLoginApi({ request: page, env })).status, 403);
});
