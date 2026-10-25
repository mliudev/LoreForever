// The script gate on the narration upload API: a valid Cloudflare Access service token, or ADMIN_KEY, never anything
// else (lib/auth.js accessService). Only the network is faked: Access's public keys (the JWKS fetch).
import test from "node:test";
import assert from "node:assert/strict";
import { onRequest as narration } from "../functions/api/admin/narration/[action].js";

const ISSUER = "https://lore-test.cloudflareaccess.com";
const AUD = "app-audience-tag";
const TOKEN_ID = "script-client-id.access";
const CONFIG = { ACCESS_ISSUER: ISSUER, ACCESS_AUD: AUD, ACCESS_SCRIPT_TOKENS: `other.access, ${TOKEN_ID}` };

// Tokens are signed with WebCrypto here, so the test needs no package: the code under test checks them with the vendored jose.
const newKey = () => crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const good = await newKey();
const stranger = await newKey();
const jwks = { keys: [{ ...(await crypto.subtle.exportKey("jwk", good.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] };
const b64 = x => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");

const realFetch = globalThis.fetch;
let jwksCalls = [];
const DOWN = "https://down.cloudflareaccess.com";   // an issuer whose keys can't be fetched
test.before(() => {
  globalThis.fetch = async url => {
    jwksCalls.push(String(url));
    if (String(url) === `${DOWN}/cdn-cgi/access/certs`) throw new TypeError("fetch failed");
    if (String(url) !== `${ISSUER}/cdn-cgi/access/certs`) throw new Error(`unexpected fetch ${url}`);
    return Response.json(jwks);
  };
});
test.after(() => { globalThis.fetch = realFetch; });

const payloadOf = (claims, aud, iss) => {
  const now = Math.floor(Date.now() / 1000);
  return { type: "app", sub: "", common_name: TOKEN_ID, ...claims, aud: [aud], iss, iat: now, exp: now + 300 };
};
const sign = async (claims = {}, { key = good.privateKey, aud = AUD, iss = ISSUER } = {}) => {
  const body = `${b64({ alg: "RS256", kid: "k1", typ: "JWT" })}.${b64(payloadOf(claims, aud, iss))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body));
  return `${body}.${Buffer.from(sig).toString("base64url")}`;
};

const bucket = { list: async () => ({ objects: [{ key: "narration/male-narrator/zone_elwynn-0123456789.mp3" }], truncated: false }) };
const call = (headers = {}, env = {}) => narration({
  request: new Request("https://loreforeverwow.com/api/admin/narration/audio", { headers }),
  env: { STUDIO: bucket, ...env }, params: { action: "audio" } });

test("narration upload API: only a genuine script token (or ADMIN_KEY) gets in; a missing Access setup is 503, never open", async () => {
  const withToken = async (token, env = CONFIG) => call({ "Cf-Access-Jwt-Assertion": token }, env);

  assert.equal((await call({}, CONFIG)).status, 401, "no token, no key");
  assert.equal((await withToken("not.a.jwt")).status, 401);
  assert.equal((await withToken(await sign({}, { key: stranger.privateKey }))).status, 401, "signed by a key Access doesn't publish");
  const unsigned = `${b64({ alg: "none" })}.${b64(payloadOf({}, AUD, ISSUER))}.`;
  assert.equal((await withToken(unsigned)).status, 401, "unsigned");
  assert.equal((await withToken(await sign({}, { aud: "some-other-app" }))).status, 401, "another Access application's token");
  assert.equal((await withToken(await sign({}, { iss: "https://evil.cloudflareaccess.com" }))).status, 401, "another team's token");
  assert.equal((await withToken(await sign({ common_name: "unlisted.access" }))).status, 401, "a service token that isn't a script's");
  assert.equal((await withToken(await sign({ email: "someone@example.com", sub: "user-1" }))).status, 401, "a person, not a script");
  assert.equal((await call({ "Cf-Access-Jwt-Assertion": await sign() }, { ...CONFIG, FEEDBACK_KEY: "f" })).status, 200, "valid token");

  for (const missing of ["ACCESS_ISSUER", "ACCESS_AUD", "ACCESS_SCRIPT_TOKENS"]) {
    const env = { ...CONFIG, [missing]: "" };
    assert.equal((await withToken(await sign(), env)).status, 503, `${missing} missing`);
  }
  // Until Operations sets those, ADMIN_KEY keeps uploads running; FEEDBACK_KEY never does.
  assert.equal((await call({ Authorization: "Bearer k" }, { ADMIN_KEY: "k" })).status, 200);
  assert.equal((await call({ Authorization: "Bearer f" }, { ADMIN_KEY: "k", FEEDBACK_KEY: "f", ...CONFIG })).status, 401);
  assert.ok(jwksCalls.every(u => u === `${ISSUER}/cdn-cgi/access/certs`), "keys come only from the issuer's certs URL");
});

test("narration upload API: our side failing to check a token is a 503 (logged), not a quiet 401", async () => {
  const env = { ...CONFIG, ACCESS_ISSUER: DOWN };
  const logged = [];
  const realError = console.error;
  console.error = (...a) => logged.push(a.join(" "));
  try {
    const token = await sign({}, { iss: DOWN });
    const res = await call({ "Cf-Access-Jwt-Assertion": token }, env);
    assert.equal(res.status, 503, "Access's keys couldn't be fetched");
    assert.ok(logged.length && !logged.join(" ").includes(token), "the reason is logged, never the token");
  } finally {
    console.error = realError;
  }
  // A token that is simply bad stays a 401 even then.
  assert.equal((await call({ "Cf-Access-Jwt-Assertion": "not.a.jwt" }, env)).status, 401);
});
