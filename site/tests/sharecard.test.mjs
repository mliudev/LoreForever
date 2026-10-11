// The share card (lib/sharecard.js, LOR-150): the owner's public profile asks for one (#pf-sharecard and
// /js/card.js) while its card is out of date, POST /api/profile/card keeps it (a 1200x630 JPEG for the profile as it is now), og:image
// names /share/<handle>-<sha>.jpg, and Delete my profile takes it along. D1 is node:sqlite and R2 a Map (helpers.mjs).
// Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as cardApi } from "../functions/api/profile/card.js";
import { onRequest as shareGet } from "../functions/share/[file].js";
import { onRequest as profileApi } from "../functions/api/profile/[action].js";
import { onRequestGet as profileGet } from "../functions/u/[handle].js";
import { findOrCreateUser, startSession, setup } from "../lib/accounts.js";
import { profileOf } from "../lib/profiles.js";
import { cardKey, cardFile, CARD_MAX } from "../lib/sharecard.js";
import { d1, r2 } from "./helpers.mjs";
import { RECORD } from "./fixtures/journey/record.mjs";

const ORIGIN = "https://preview.example";
const env = { DB: d1(), STUDIO: r2() };
beforeEach(async () => {
  await setup(env);
  for (const t of ["profiles", "sessions", "users", "rate_limits", "devices", "profile_pictures"]) env.DB.sqlite.exec(`DELETE FROM ${t}`);
  env.STUDIO.objects.clear();
  delete env.SITE_FEATURES;
});

// A small well-formed JPEG of w x h (SOI, APP0, a frame header, a scan, EOI).
function jpeg(w = 1200, h = 630, seed = 0) {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00];
  const out = new Uint8Array(head.length + 34);
  out.set(head);
  for (let i = 0; i < 32; i++) out[head.length + i] = (i * 7 + seed) % 200;
  out.set([0xff, 0xd9], head.length + 32);
  return out;
}

async function signIn(sub) {
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: `Real Name ${sub}` });
  const set = await startSession(env, new Request(ORIGIN), user.id);
  return { user, cookie: set.split(";")[0] };
}

const call = (who, action, body) => profileApi({ request: new Request(`${ORIGIN}/api/profile/${action}`, { method: "POST",
  headers: { "Content-Type": "application/json", Cookie: who.cookie, Origin: ORIGIN }, body: JSON.stringify(body) }),
  env, params: { action } });

async function profile(who, { open = true } = {}) {
  assert.equal((await call(who, "import", { record: RECORD })).status, 200);
  if (open) assert.equal((await call(who, "settings", { public: true })).status, 200);
  return profileOf(env, who.user.id);
}

const page = async (handle, cookie) => (await profileGet({ request: new Request(`${ORIGIN}/u/${handle}`,
  { headers: cookie ? { Cookie: cookie } : {} }), env, params: { handle } })).text();

const send = (who, bytes, key, { origin = ORIGIN, type = "image/jpeg" } = {}) => cardApi({ env,
  request: new Request(`${ORIGIN}/api/profile/card`, { method: "POST", body: bytes,
    headers: { "Content-Type": type, "X-Card-Key": key, ...(who ? { Cookie: who.cookie } : {}), ...(origin ? { Origin: origin } : {}) } }) });

const facts = html => JSON.parse(/<script type="application\/json" id="pf-sharecard">(.*?)<\/script>/s.exec(html)[1]);

test("POST /api/profile/card keeps the card, and the profile's links show it", async () => {
  const me = await signIn("g-1");
  const p = await profile(me);
  const key = cardKey(p, true);
  assert.equal((await send(me, jpeg(), key, { origin: "https://evil.example" })).status, 403);
  assert.equal((await send(null, jpeg(), key)).status, 401);
  assert.equal((await send(me, jpeg(), key, { type: "image/png" })).status, 415);
  assert.equal((await send(me, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), key)).status, 415);
  assert.equal((await send(me, jpeg(1920, 1080), key)).status, 400);
  assert.equal((await send(me, new Uint8Array(CARD_MAX + 1), key)).status, 413);
  assert.equal((await send(me, jpeg(), "1|old|x|0")).status, 409, "drawn from an older profile");
  const res = await send(me, jpeg(), key);
  assert.equal(res.status, 200);
  const { url } = await res.json();
  assert.match(url, new RegExp(`^/share/${p.handle}-[0-9a-f]{10}\\.jpg$`));
  assert.ok(env.STUDIO.objects.has(cardFile(me.user.id)));
  // Visitors' links show it; the owner's page has nothing to draw until the profile changes.
  assert.ok((await page(p.handle)).includes(`<meta property="og:image" content="https://loreforeverwow.com${url}">`));
  assert.ok(!(await page(p.handle, me.cookie)).includes(`id="pf-sharecard"`));
  // Without Sam (the "companion" feature off): a card without him is due.
  env.SITE_FEATURES = "-companion";
  const due = facts(await page(p.handle, me.cookie));
  assert.equal(due.herald, false);
  assert.equal(due.key, cardKey(p, false));
});

test("/share/<handle>-<sha>.jpg serves the card of a public profile, and nothing else", async () => {
  const me = await signIn("g-1");
  const p = await profile(me);
  const { url } = await (await send(me, jpeg(), cardKey(p, true))).json();
  const get = (path, headers = {}) => shareGet({ env, request: new Request(ORIGIN + path, { headers }),
    params: { file: path.split("/").pop() } });
  const res = await get(url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "image/jpeg");
  assert.match(res.headers.get("Cache-Control"), /immutable/);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), jpeg());
  const sha = url.slice(-14, -4);
  assert.equal((await get(url, { "If-None-Match": `"${sha}"` })).status, 304);
  assert.equal((await get(`/share/${p.handle}-0000000000.jpg`)).status, 404, "an old card's address");
  assert.equal((await get(`/share/nobody-${sha}.jpg`)).status, 404);
  assert.equal((await call(me, "settings", { public: false })).status, 200);
  assert.equal((await get(url)).status, 404, "private now");
  assert.equal((await send(me, jpeg(), cardKey(await profileOf(env, me.user.id), true))).status, 409, "no card for a private profile");
});

test("Delete my profile takes the card with it", async () => {
  const me = await signIn("g-1");
  const p = await profile(me);
  assert.equal((await send(me, jpeg(), cardKey(p, true))).status, 200);
  assert.equal((await call(me, "delete", {})).status, 200);
  assert.ok(!env.STUDIO.objects.has(cardFile(me.user.id)));
});
