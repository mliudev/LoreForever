// Sign in by email (lib/email-signin.js, functions/api/auth/[action].js and functions/api/device/[action].js
// email-start/email-verify). Email goes out through a stubbed Cloudflare API: each test reads the code from the email
// it sent, as a player would.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as auth } from "../functions/api/auth/[action].js";
import { onRequest as device } from "../functions/api/device/[action].js";
import { findOrCreateUser, currentUser, setup, deleteUser } from "../lib/accounts.js";
import { allowance } from "../lib/companion-answers.js";
import { TASTE_ANSWERS, planFor } from "../lib/billing.js";
import { takeFirst } from "../lib/best-first.js";
import { currentDevice } from "../lib/devices.js";
import { d1, stopClock } from "./helpers.mjs";

let env, sent;
const originalFetch = globalThis.fetch;
const SITE = "https://willocompanion.com";

beforeEach(async () => {
  env = { DB: d1(), CLOUDFLARE_EMAIL_TOKEN: "test-token", CLOUDFLARE_ACCOUNT_ID: "acct", WILLO_DOMAIN: "willocompanion.com" };
  await setup(env);
  sent = [];
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /\/email\/sending\/send$/);
    sent.push(JSON.parse(init.body));
    return Response.json({ success: true, result: {} });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

async function call(path, body, { site = SITE, app = false, cookie } = {}) {
  const headers = { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" };
  if (app) headers["X-LF-Client"] = "companion/0.30.0"; else headers.Origin = site;
  if (cookie) headers.Cookie = cookie;
  const request = new Request(`${site}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const [, , api, action] = path.split("/");
  const res = await (api === "device" ? device : auth)({ request, env, params: { action } });
  return { status: res.status, body: await res.json(), cookie: res.headers.get("Set-Cookie") };
}
const lastCode = () => /^(\d{6}) /.exec(sent.at(-1).subject)[1];

test("a code for a Google player's address signs in to that same account, on the site and in the app", async () => {
  const google = await findOrCreateUser(env, { email: "john.smith@gmail.com", googleSub: "g-john", name: "John" });

  const start = await call("/api/auth/email-start", { email: "JohnSmith+wow@googlemail.com" });
  assert.equal(start.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from.address, "hello@loreforeverwow.com");
  assert.ok(!sent[0].headers?.["List-Unsubscribe"], "a sign-in code isn't news: no unsubscribe line");
  assert.ok(!JSON.stringify(start.body).includes(lastCode()), "the answer never carries the code");

  const verify = await call("/api/auth/email-verify", { email: "JohnSmith+wow@googlemail.com", code: lastCode() });
  assert.equal(verify.status, 200);
  const session = verify.cookie.split(";")[0];
  const user = await currentUser(env, new Request(`${SITE}/`, { headers: { Cookie: session } }));
  assert.equal(user.id, google.id);

  await call("/api/device/email-start", { email: "john.smith@gmail.com" }, { app: true });
  const app = await call("/api/device/email-verify", { email: "john.smith@gmail.com", code: lastCode() }, { app: true });
  assert.equal(app.status, 200);
  const owner = await currentDevice(env, new Request(`${SITE}/`, { headers: { Authorization: `Bearer ${app.body.token}` } }));
  assert.equal(owner.user.id, google.id);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1, "no second account");
});

test("a code works once, for ten minutes, for five tries, and an inbox gets three codes a quarter hour", async t => {
  const now = stopClock(t);
  const email = "mira@example.com";
  await call("/api/auth/email-start", { email });
  const wrong = lastCode() === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) assert.equal((await call("/api/auth/email-verify", { email, code: wrong })).status, 400);
  assert.equal((await call("/api/auth/email-verify", { email, code: lastCode() })).status, 400, "five wrong tries end the code");

  await call("/api/auth/email-start", { email });
  t.mock.timers.setTime(now + 11 * 60e3);
  assert.equal((await call("/api/auth/email-verify", { email, code: lastCode() })).status, 400, "ten minutes and it's gone");

  await call("/api/auth/email-start", { email });
  const ok = await call("/api/auth/email-verify", { email, code: lastCode() });
  assert.equal(ok.status, 200);
  assert.equal((await call("/api/auth/email-verify", { email, code: lastCode() })).status, 400, "one use");

  assert.equal((await call("/api/auth/email-start", { email })).status, 429, "a fourth code in the same quarter hour");
  t.mock.timers.setTime(now + 16 * 60e3);
  assert.equal((await call("/api/auth/email-start", { email })).status, 200, "the next quarter hour");
  assert.equal(sent.length, 4);
});

test("develop hands back a test address's code instead of emailing it; the live site never does", async () => {
  env = { ...env, TEST_PLAYERS: "1" };
  const develop = await call("/api/auth/email-start", { email: "mira@example.test" }, { site: "https://develop.lore-forever.pages.dev" });
  assert.equal(develop.status, 200);
  assert.match(develop.body.testCode, /^\d{6}$/);
  assert.equal(sent.length, 0);

  const live = await call("/api/auth/email-start", { email: "mira@example.test" });
  assert.equal(live.status, 400);
  assert.equal(live.body.testCode, undefined);
  const real = await call("/api/auth/email-start", { email: "mira@example.com" }, { site: "https://develop.lore-forever.pages.dev" });
  assert.equal(real.body.testCode, undefined, "a real address is emailed, even on develop");
  assert.equal(sent.length, 1);
});

test("an inbox has fifteen wrong codes a day, from any code; then even the right one waits for tomorrow", async t => {
  const now = stopClock(t);
  env = { ...env, EMAIL_CODE_KEY: "test-only-key" };   // the codes kept keyed, as on the live site
  const email = "kaelen@example.com";
  for (let codes = 0; codes < 3; codes++) {
    await call("/api/auth/email-start", { email });
    const wrong = lastCode() === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) assert.equal((await call("/api/auth/email-verify", { email, code: wrong })).status, 400);
  }
  t.mock.timers.setTime(now + 16 * 60e3);
  await call("/api/auth/email-start", { email });
  const capped = await call("/api/auth/email-verify", { email, code: lastCode() });
  assert.equal(capped.status, 400);
  assert.equal(capped.body.reason, "code", "the same answer as a wrong code");

  t.mock.timers.setTime(now + 24 * 3600e3);
  await call("/api/auth/email-start", { email });
  assert.equal((await call("/api/auth/email-verify", { email, code: lastCode() })).status, 200, "a new day");
});

test("a Google player's free gifts stay used after Delete my account, back by email with a +tag", async () => {
  // Willo's first finest answers (lib/best-first.js) stand for every gift coded by lib/billing.js starterClaim.
  env = { ...env, TEST_PLAYERS: "1", SITE_FEATURES: "plans" };
  const develop = "https://develop.lore-forever.pages.dev";
  const take = async id => takeFirst(env, id, await planFor(env, id));
  const signIn = async email => {
    const start = await call("/api/device/email-start", { email }, { site: develop, app: true });
    const app = await call("/api/device/email-verify", { email, code: start.body.testCode }, { site: develop, app: true });
    return (await currentDevice(env, new Request(`${develop}/`, { headers: { Authorization: `Bearer ${app.body.token}` } }))).user;
  };
  const first = await findOrCreateUser(env, { email: "returner@example.test", googleSub: "g-returner", name: "Returner" });
  assert.equal((await allowance(env, first.id)).taste.left, TASTE_ANSWERS);
  for (let i = 0; i < 3; i++) await take(first.id);
  assert.equal((await allowance(env, first.id)).taste.left, TASTE_ANSWERS - 3);
  await deleteUser(env, first);
  const again = await signIn("returner+again@example.test");
  assert.notEqual(again.id, first.id, "a new account");
  assert.equal((await allowance(env, again.id)).taste.left, TASTE_ANSWERS - 3, "the inbox keeps its count");
});