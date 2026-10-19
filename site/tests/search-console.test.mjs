// Google Search for /admin's Sources (lib/search-console.js through GET /api/admin/sources?search=1): nothing is asked of
// Google until the service account's key is set; with it, a signed token is traded, each page's searches come back with
// what visits from Google did on that page, and Google is asked at most every 6 hours. Google is mocked through fetch;
// D1 is node:sqlite (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet as adminGet } from "../functions/api/admin/sources.js";
import { setup } from "../lib/accounts.js";
import { setupSources, countEvent } from "../lib/sources.js";
import { searchCsv } from "../public/admin-sources.js";
import { d1 } from "./helpers.mjs";

const ORIGIN = "https://loreforeverwow.com";
const originalFetch = globalThis.fetch;
let calls, refuse;
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const pem = "-----BEGIN PRIVATE KEY-----\n" + Buffer.from(await crypto.subtle.exportKey("pkcs8", privateKey)).toString("base64")
  .replace(/.{64}/g, "$&\n") + "\n-----END PRIVATE KEY-----\n";
const ACCOUNT = JSON.stringify({ type: "service_account", client_email: "lore-search@lore.iam.gserviceaccount.com", private_key: pem });

let env;
beforeEach(async () => {
  env = { DB: d1(), ADMIN_KEY: "k" };
  await setup(env);
  await setupSources(env);
  calls = [];
  refuse = false;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body });
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "ya29.test", expires_in: 3600 });
    }
    if (refuse) return Response.json({ error: { message: "User does not have sufficient permission for site" } }, { status: 403 });
    const body = JSON.parse(options.body);
    if (body.dimensions.length === 1) return Response.json({ rows: [
      { keys: [`${ORIGIN}/guides/leveling`], clicks: 40, impressions: 900, ctr: 0.0444, position: 6.42 },
      { keys: [`${ORIGIN}/`], clicks: 120, impressions: 2000, ctr: 0.06, position: 2.1 }] });
    return Response.json({ rows: [
      { keys: [`${ORIGIN}/guides/leveling`, "wow forever leveling guide"], clicks: 30, impressions: 600, ctr: 0.05, position: 5.04 },
      { keys: [`${ORIGIN}/guides/leveling`, "forever leveling"], clicks: 10, impressions: 300, ctr: 0.03, position: 8.8 },
      { keys: [`${ORIGIN}/`, "lore forever"], clicks: 120, impressions: 2000, ctr: 0.06, position: 2.1 }] });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

const ask = async () => (await (await adminGet({ env, request: new Request(
  `${ORIGIN}/api/admin/sources?search=1&from=2026-10-01&to=2026-10-19`, { headers: { Authorization: "Bearer k" } }) })).json()).search;

test("Google Search per page, beside what visits from Google did there; nothing asked without the key", async () => {
  assert.deepEqual(await ask(), { on: false });
  assert.equal(calls.length, 0);

  env.GSC_SERVICE_ACCOUNT = ACCOUNT;
  for (const kind of ["visit", "visit", "signup", "paid"])
    await countEvent(env, "search:google", "/guides/leveling", kind, { now: Date.parse("2026-10-12T12:00:00Z") });
  const search = await ask();
  assert.equal(search.site, "https://loreforeverwow.com/");
  assert.deepEqual(search.pages.map(p => [p.landing, p.clicks, p.impressions, p.ctr, p.position]),
    [["/", 120, 2000, 6, 2.1], ["/guides/leveling", 40, 900, 4.4, 6.4]]);
  const leveling = search.pages[1];
  assert.deepEqual(leveling.queries.map(q => q.query), ["wow forever leveling guide", "forever leveling"]);
  assert.deepEqual(leveling.ours, { visits: 2, signups: 1, willo: 0, paid: 1, revenue: 0 });
  assert.equal(search.pages[0].ours, null);

  // The token: a JWT signed with the service account's key, for read-only Search Console.
  const assertion = new URLSearchParams(calls[0].body).get("assertion");
  const [head, claims, signature] = assertion.split(".");
  const claim = JSON.parse(Buffer.from(claims, "base64url"));
  assert.deepEqual([claim.iss, claim.scope, claim.aud], ["lore-search@lore.iam.gserviceaccount.com",
    "https://www.googleapis.com/auth/webmasters.readonly", "https://oauth2.googleapis.com/token"]);
  assert.ok(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, Buffer.from(signature, "base64url"),
    new TextEncoder().encode(`${head}.${claims}`)));
  assert.match(calls[1].url, /sites\/https%3A%2F%2Floreforeverwow\.com%2F\/searchAnalytics\/query$/);

  // Kept 6 hours: asked again, Google isn't.
  const before = calls.length;
  await ask();
  assert.equal(calls.length, before);
  assert.match(searchCsv(search).split("\n")[2], /^\/guides\/leveling,40,900,4\.4,6\.4,2,1,1,wow forever leveling guide \(600\); forever leveling \(300\)$/);
});

test("Google saying no shows as an error, not a failure", async () => {
  env.GSC_SERVICE_ACCOUNT = ACCOUNT;
  env.GSC_SITE = "sc-domain:loreforeverwow.com";
  refuse = true;
  const search = await ask();
  assert.equal(search.on, true);
  assert.match(search.error, /sufficient permission/);
  env.GSC_SERVICE_ACCOUNT = "{not json";
  assert.match((await ask()).error, /isn't a service account's JSON key/);
});
