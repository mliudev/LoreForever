// Sign in with Apple from the iPhone app (functions/api/device/[action].js apple, lib/accounts.js verifyApple and
// findOrCreateAppleUser): Apple's keys are a key pair made here, served from a stubbed fetch.
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/device/[action].js";
import { findOrCreateUser, setup, deleteUser } from "../lib/accounts.js";
import { currentDevice } from "../lib/devices.js";
import { d1 } from "./helpers.mjs";

const env = { DB: d1() };
const originalFetch = globalThis.fetch;
let keys, jwk;
const b64u = buf => Buffer.from(buf).toString("base64url");

before(async () => {
  keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256" }, true, ["sign", "verify"]);
  jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "test-kid", alg: "RS256", use: "sig" };
});

beforeEach(async () => {
  await setup(env);
  for (const table of ["devices", "rate_limits", "apple_logins", "terms_acceptances", "users"]) env.DB.sqlite.exec(`DELETE FROM ${table}`);
  globalThis.fetch = async url => {
    assert.equal(String(url), "https://appleid.apple.com/auth/keys");
    return Response.json({ keys: [jwk] });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

async function appleToken(claims = {}, { kid = "test-kid" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "RS256", kid }));
  const body = b64u(JSON.stringify({ iss: "https://appleid.apple.com", aud: "com.loreforeverwow.willo", sub: "001234.apple",
    iat: now, exp: now + 600, email: "mira@example.com", email_verified: "true", is_private_email: "false", ...claims }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64u(sig)}`;
}

async function signIn(token, { name, headers = {} } = {}) {
  const request = new Request("https://example.test/api/device/apple", { method: "POST",
    headers: { "X-LF-Client": "companion/ios-0.1.0", "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ identity_token: token, name }) });
  const res = await onRequest({ request, env, params: { action: "apple" } });
  return { status: res.status, body: await res.json() };
}

const accountOf = async token => (await currentDevice(env, new Request("https://example.test/",
  { headers: { Authorization: `Bearer ${token}` } })))?.user;

test("a new Apple ID gets a new account and an app token that works", async () => {
  const r = await signIn(await appleToken({ email: "new@privaterelay.appleid.com", is_private_email: "true" }), { name: "Mira" });
  assert.equal(r.status, 200);
  assert.match(r.body.token, /^[0-9a-f]{64}$/);
  const user = await accountOf(r.body.token);
  assert.equal(user.email, "new@privaterelay.appleid.com");
  assert.equal(user.display_name, "Mira");
  assert.ok(env.DB.sqlite.prepare("SELECT 1 FROM terms_acceptances WHERE user_id = ?").get(user.id), "signing in agrees to the Terms");
});

test("the same Apple ID comes back to the same account", async () => {
  const first = await accountOf((await signIn(await appleToken({ is_private_email: "true", email: "x@privaterelay.appleid.com" }))).body.token);
  const again = await accountOf((await signIn(await appleToken({ email: undefined }))).body.token);
  assert.equal(again.id, first.id);
});

test("a verified, real email joins the Google account that has it", async () => {
  const google = await findOrCreateUser(env, { email: "mira@example.com", googleSub: "g-mira", name: "Mira" });
  const user = await accountOf((await signIn(await appleToken({ email: "Mira@Example.com" }))).body.token);
  assert.equal(user.id, google.id);
});

test("a private-relay or unverified email never joins someone else's account", async () => {
  const google = await findOrCreateUser(env, { email: "mira@example.com", googleSub: "g-mira", name: "Mira" });
  const unverified = await accountOf((await signIn(await appleToken({ sub: "a1", email_verified: "false" }))).body.token);
  assert.notEqual(unverified.id, google.id);
  assert.equal(unverified.email, null, "the address stays with the account that has it");
  const relay = await accountOf((await signIn(await appleToken({ sub: "a2", email: "mira@example.com", is_private_email: true }))).body.token);
  assert.notEqual(relay.id, google.id);
});

test("tokens for another app, from another issuer, expired or forged are refused", async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const bad of [
    await appleToken({ aud: "com.example.other" }),
    await appleToken({ iss: "https://evil.example" }),
    await appleToken({ exp: now - 10 }),
    await appleToken({}, { kid: "unknown" }),
    (await appleToken()).replace(/\.[^.]+$/, ".AAAA"),
    "not-a-token",
  ]) assert.equal((await signIn(bad)).status, 401);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get().n, 0);
});

test("the Willo Dev test build's bundle ID counts too", async () => {
  assert.equal((await signIn(await appleToken({ aud: "com.loreforeverwow.willo.dev" }))).status, 200);
});

test("only the app may call it: a page's Origin is refused", async () => {
  assert.equal((await signIn(await appleToken(), { headers: { Origin: "https://evil.example" } })).status, 403);
});

test("deleting the account forgets its Apple ID", async () => {
  const user = await accountOf((await signIn(await appleToken())).body.token);
  await deleteUser(env, user);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM apple_logins").get().n, 0);
});
