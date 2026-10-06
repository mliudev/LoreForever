// The picture book (lib/pictures.js): the companion's uploads to POST /api/profile/pictures (JPEGs only, by their
// bytes; at most 1 MB; 500 per account; the same cid again updates, without an image only the meta), Remove, reports
// that hide a picture, the images at /pictures/<id>-<sha>.jpg, the "pictures" feature and ?pictures=1, and the section
// on /u/<handle>. D1 is node:sqlite and R2 a Map (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as picturesApi } from "../functions/api/profile/pictures/index.js";
import { onRequest as reportApi } from "../functions/api/profile/pictures/report.js";
import { onRequest as imageGet } from "../functions/pictures/[file].js";
import { onRequest as profileApi } from "../functions/api/profile/[action].js";
import { onRequestGet as profileGet } from "../functions/u/[handle].js";
import { findOrCreateUser, startSession, setup, deleteUser, sha256 } from "../lib/accounts.js";
import { picturesSection, readMeta, jpegSize, isJpeg, PER_USER, PER_MINUTE, SHOWN, CAPTION_MAX } from "../lib/pictures.js";
import { d1, r2 } from "./helpers.mjs";
import { RECORD } from "./fixtures/journey/record.mjs";

const ORIGIN = "https://preview.example";
const env = { DB: d1(), STUDIO: r2() };
beforeEach(async () => {
  await setup(env);
  for (const t of ["profiles", "sessions", "users", "rate_limits", "devices", "profile_pictures", "picture_reports",
    "picture_tombstones"]) {
    env.DB.sqlite.exec(`DELETE FROM ${t}`);
  }
  env.STUDIO.objects.clear();
  delete env.SITE_FEATURES;
});

// A small but well-formed JPEG: SOI, APP0, a baseline frame header with its size, a scan, EOI. `fill` pads the scan.
function jpeg(w = 1920, h = 1080, fill = 16, seed = 0) {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00];
  const out = new Uint8Array(head.length + fill + 2);
  out.set(head);
  for (let i = 0; i < fill; i++) out[head.length + i] = (i * 7 + seed) % 200;
  out.set([0xff, 0xd9], head.length + fill);
  return out;
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0]);

async function signIn(sub) {
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: `Real Name ${sub}` });
  const set = await startSession(env, new Request(ORIGIN), user.id);
  return { user, cookie: set.split(";")[0] };
}

// A connected companion for the account (lib/devices.js keeps the token's hash); returns its token.
async function connect(who) {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await env.DB.prepare("INSERT INTO devices (id, token_hash, user_id, label, created, last_used) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), await sha256(token), who.user.id, "Lore Forever companion", new Date().toISOString(),
          new Date().toISOString()).run();
  return token;
}

// A profile for the account, made public unless asked not to.
async function profile(who, { open = true } = {}) {
  const call = async (action, body) => profileApi({ request: new Request(`${ORIGIN}/api/profile/${action}`, { method: "POST",
    headers: { "Content-Type": "application/json", Cookie: who.cookie, Origin: ORIGIN }, body: JSON.stringify(body) }),
    env, params: { action } });
  assert.equal((await call("import", { record: RECORD })).status, 200);
  if (open) assert.equal((await call("settings", { public: true })).status, 200);
}

const META = { cid: "1759373420_a1b2c3", t: 1759373420, realm: "Forever", faction: "Alliance", race: "Night Elf",
  class: "Druid", lv: 24, z: "Elwynn Forest", s: "Goldshire", at: "1429:412:655", w: 4000, h: 3000, clean: true,
  caption: "You stand in Goldshire's lamplight, a little lost and very sure of yourself." };

// POST from the companion (its token, no Origin) or a page (cookie and our Origin). image: bytes, or null for none.
async function upload(meta, image = jpeg(), { token, cookie, origin, headers = {}, raw } = {}) {
  const h = new Headers({ "X-LF-Client": "companion/0.4.0", ...headers });
  if (token) h.set("Authorization", "Bearer " + token);
  if (cookie) h.set("Cookie", cookie);
  if (origin) h.set("Origin", origin);
  let body = raw;
  if (!body) {
    body = new FormData();
    body.append("meta", typeof meta === "string" ? meta : JSON.stringify(meta));
    if (image) body.append("image", new Blob([image], { type: "image/jpeg" }), "WoWScrnShot_100126_195020.jpg");
  }
  const res = await picturesApi({ request: new Request(`${ORIGIN}/api/profile/pictures`, { method: "POST", headers: h, body }), env });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

async function remove(query, { token, cookie, origin } = {}) {
  const h = new Headers();
  if (token) h.set("Authorization", "Bearer " + token);
  if (cookie) h.set("Cookie", cookie);
  if (origin) h.set("Origin", origin);
  const res = await picturesApi({ request: new Request(`${ORIGIN}/api/profile/pictures${query}`, { method: "DELETE", headers: h }), env });
  return { status: res.status, body: await res.json() };
}

async function list(query, cookie) {
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  const res = await picturesApi({ request: new Request(`${ORIGIN}/api/profile/pictures${query}`, { headers }), env });
  return { status: res.status, body: await res.json() };
}

async function report(id, { cookie, ip = "203.0.113.7", origin = ORIGIN } = {}) {
  const headers = new Headers({ "Content-Type": "application/json", "CF-Connecting-IP": ip });
  if (cookie) headers.set("Cookie", cookie);
  if (origin) headers.set("Origin", origin);
  const res = await reportApi({ request: new Request(`${ORIGIN}/api/profile/pictures/report`, { method: "POST", headers,
    body: JSON.stringify({ id }) }), env });
  return { status: res.status, body: await res.json() };
}

async function image(url, { cookie, method = "GET", headers = {} } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set("Cookie", cookie);
  const res = await imageGet({ request: new Request(ORIGIN + url, { method, headers: h }), env,
    params: { file: url.split("/").pop() } });
  return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
}

async function view(handle, { cookie, query = "" } = {}) {
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  const res = await profileGet({ request: new Request(`${ORIGIN}/u/${handle}${query}`, { headers }), env, params: { handle } });
  return { status: res.status, html: await res.text() };
}

const rows = () => env.DB.prepare("SELECT * FROM profile_pictures ORDER BY t").all().then(r => r.results);

test("JPEGs are told by their bytes, and their size read from the frame header", () => {
  assert.deepEqual(jpegSize(jpeg(1920, 1080)), { w: 1920, h: 1080 });
  assert.deepEqual(jpegSize(jpeg(480, 270)), { w: 480, h: 270 });
  assert.ok(isJpeg(jpeg()));
  assert.ok(!isJpeg(PNG));
  assert.equal(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0, 0, 0, 0, 0])), null, "image data before any frame");
  assert.equal(jpegSize(jpeg(0, 1080)), null, "no width");
});

test("the meta: only what's sent, tidied; at is mapID:x:y in thousandths; captions capped", () => {
  const { cid, fields } = readMeta(JSON.stringify({ ...META, z: " Elwynn\nForest ", caption: "x".repeat(700) }));
  assert.equal(cid, META.cid);
  assert.deepEqual({ ...fields, caption: fields.caption.length }, { t: META.t, realm: "Forever", faction: "Alliance",
    race: "Night Elf", class: "Druid", zone: "Elwynn Forest", subzone: "Goldshire", lv: 24, map: 1429, x: 412, y: 655,
    clean: 1, caption: CAPTION_MAX });
  assert.deepEqual(readMeta(JSON.stringify({ cid: "a", caption: "Later." })).fields, { caption: "Later." }, "an update sends only what changed");
  assert.deepEqual(readMeta(JSON.stringify({ cid: "a", at: null, pic: 0 })).fields, { map: null, x: null, y: null, clean: 0 });
  assert.deepEqual(readMeta(JSON.stringify({ cid: "a", at: "1429:1200:5", lv: 300, t: 12 })).fields,
    { map: null, x: null, y: null, lv: null }, "out of range: dropped");
  for (const bad of ["nope", "[]", JSON.stringify({ t: 1 }), JSON.stringify({ cid: "a/../b" }), JSON.stringify({ cid: "x".repeat(65) })]) {
    assert.ok(readMeta(bad).error, bad);
  }
});

test("the companion uploads a picture with its token; sending it again updates it, never a second copy", async () => {
  const me = await signIn("aelric");
  const token = await connect(me);
  const first = await upload(META, jpeg(1920, 1080), { token });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.created, true);
  const pic = first.body.picture;
  assert.match(pic.id, /^[0-9a-f]{16}$/);
  assert.match(pic.url, new RegExp(`^/pictures/${pic.id}-[0-9a-f]{10}\\.jpg$`));
  assert.deepEqual([pic.cid, pic.w, pic.h, pic.hidden], [META.cid, 1920, 1080, false], "the size is the image's, not the meta's");

  const [r] = await rows();
  assert.deepEqual([r.user_id, r.cid, r.realm, r.faction, r.race, r.class, r.lv, r.zone, r.subzone, r.map, r.x, r.y, r.t, r.clean],
    [me.user.id, META.cid, "Forever", "Alliance", "Night Elf", "Druid", 24, "Elwynn Forest", "Goldshire", 1429, 412, 655, META.t, 1]);
  assert.equal(r.caption, META.caption);
  assert.equal(r.bytes, jpeg(1920, 1080).length);
  assert.deepEqual([...env.STUDIO.objects.keys()], [`pictures/${me.user.id}/${pic.id}.jpg`]);
  assert.equal(env.STUDIO.objects.get(`pictures/${me.user.id}/${pic.id}.jpg`).opts.httpMetadata.contentType, "image/jpeg");

  // The same picture again (the companion retrying): the same row and file.
  const again = await upload(META, jpeg(1920, 1080), { token });
  assert.deepEqual([again.status, again.body.created, again.body.picture.id, again.body.picture.url], [200, false, pic.id, pic.url]);
  assert.equal((await rows()).length, 1);
  assert.equal(env.STUDIO.objects.size, 1);
});

test("a caption that comes later: meta only, the rest and the file stay; a new image gets a new address", async () => {
  const me = await signIn("aelric");
  const token = await connect(me);
  const { body } = await upload({ ...META, caption: null }, jpeg(), { token });
  const before = (await rows())[0];
  assert.equal(before.caption, null);

  const later = await upload({ cid: META.cid, caption: "  You came  by boat,\nand the boat was late. " }, null, { token });
  assert.equal(later.status, 200, JSON.stringify(later.body));
  assert.equal(later.body.created, false);
  const after = (await rows())[0];
  assert.equal(after.caption, "You came by boat, and the boat was late.");
  for (const k of ["id", "t", "realm", "zone", "subzone", "map", "x", "y", "sha", "bytes", "w", "h", "clean"]) assert.equal(after[k], before[k], k);

  // Meta only for a picture the site never got: the companion sends it with its image.
  const unknown = await upload({ cid: "1759373999_ffffff", caption: "Hm." }, null, { token });
  assert.deepEqual([unknown.status, unknown.body.missing], [404, true]);

  // A new image for the same cid: same picture, new file, new address; the old one is gone.
  const swapped = await upload(META, jpeg(1280, 720, 40, 9), { token });
  assert.equal(swapped.body.picture.id, body.picture.id);
  assert.notEqual(swapped.body.picture.url, body.picture.url);
  assert.deepEqual([swapped.body.picture.w, swapped.body.picture.h], [1280, 720]);
  assert.equal(env.STUDIO.objects.size, 1);
  await profile(me);
  assert.equal((await image(body.picture.url)).status, 404, "the old address");
  assert.equal((await image(swapped.body.picture.url)).status, 200);
});

test("uploads: JPEG only (by its bytes), 1 MB at most, a cid and a time, and only from the companion or our pages", async () => {
  const me = await signIn("aelric");
  const token = await connect(me);
  assert.equal((await upload(META)).status, 401, "no token, no session");
  assert.equal((await upload(META, jpeg(), { token: "0".repeat(64) })).status, 401, "an unknown token");
  assert.equal((await upload(META, jpeg(), { token, origin: "https://elsewhere.example" })).status, 403);
  assert.equal((await upload(META, jpeg(), { cookie: me.cookie })).status, 401, "without our Origin it's the companion: no token");
  assert.equal((await upload(META, jpeg(), { cookie: me.cookie, origin: "https://elsewhere.example" })).status, 403);

  const png = await upload(META, PNG, { token });
  assert.deepEqual([png.status, png.body.error], [415, "Only JPEG pictures, please."], "a PNG sent as image/jpeg");
  assert.equal((await upload(META, new TextEncoder().encode("\xff\xd8 not really"), { token })).status, 415);
  assert.equal((await upload(META, new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 1, 2, 3, 4, 5, 6, 7]), { token })).status, 415,
    "starts like a JPEG, but has no frame");
  const big = await upload(META, jpeg(1920, 1080, 1024 * 1024), { token });
  assert.deepEqual([big.status, big.body.error], [413, "That picture is over 1 MB."]);
  const huge = await upload(META, jpeg(1920, 1080, 2 * 1024 * 1024), { token });
  assert.equal(huge.status, 413, "a body far past the cap stops being read");
  assert.equal((await upload("{nope", jpeg(), { token })).status, 400);
  assert.equal((await upload({ ...META, cid: undefined }, jpeg(), { token })).status, 400);
  assert.equal((await upload({ ...META, t: undefined }, jpeg(), { token })).status, 400, "a new picture says when it was taken");
  const json = await picturesApi({ request: new Request(`${ORIGIN}/api/profile/pictures`, { method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(META) }), env });
  assert.equal(json.status, 400, "not multipart");
  assert.equal((await rows()).length, 0);
  assert.equal(env.STUDIO.objects.size, 0);

  // From our own page, signed in: fine too.
  const page = await upload(META, jpeg(), { cookie: me.cookie, origin: ORIGIN });
  assert.equal(page.status, 200, JSON.stringify(page.body));
  // A JPEG at exactly 1 MB is fine.
  const exact = jpeg(1920, 1080, 0);
  const full = jpeg(1920, 1080, 1024 * 1024 - exact.length);
  assert.equal(full.length, 1024 * 1024);
  assert.equal((await upload({ ...META, cid: "exactly-1mb" }, full, { token })).status, 200);
});

test("500 pictures per account: the next is refused, sending one already there still works", async () => {
  const me = await signIn("aelric");
  const token = await connect(me);
  const fill = env.DB.sqlite.prepare("INSERT INTO profile_pictures (id, user_id, cid, t, bytes, sha, created) VALUES (?, ?, ?, ?, 1, 'aaaaaaaaaa', 'x')");
  env.DB.sqlite.exec("BEGIN");
  for (let i = 0; i < PER_USER - 1; i++) fill.run(i.toString(16).padStart(16, "0"), me.user.id, `old-${i}`, META.t - i);
  env.DB.sqlite.exec("COMMIT");
  assert.equal((await upload(META, jpeg(), { token })).status, 200, "the 500th");
  const over = await upload({ ...META, cid: "one-too-many" }, jpeg(), { token });
  assert.deepEqual([over.status, over.body.full], [409, true]);
  assert.match(over.body.error, /full \(500 pictures\)/);
  assert.equal((await upload({ cid: META.cid, caption: "Still mine." }, null, { token })).status, 200, "an update isn't a new one");
  assert.equal((await upload(META, jpeg(), { token })).status, 200, "nor is the same picture again");
  // Someone else's book isn't full.
  const other = await signIn("someone");
  assert.equal((await upload({ ...META, cid: "one-too-many" }, jpeg(), { token: await connect(other) })).status, 200);
});

test("uploads are rate limited per account, with Retry-After", async () => {
  const me = await signIn("aelric");
  const token = await connect(me);
  for (let i = 0; i < PER_MINUTE; i++) await upload({ cid: `x-${i}`, caption: "a" }, null, { token });
  const slow = await upload(META, jpeg(), { token });
  assert.equal(slow.status, 429);
  assert.ok(Number(slow.headers.get("Retry-After")) > 0);
  assert.equal((await rows()).length, 0);
});

test("remove: the owner, by cid from the companion or by id from the page; twice is fine; never someone else's", async () => {
  const me = await signIn("aelric");
  const token = await connect(me);
  const a = (await upload(META, jpeg(), { token })).body.picture;
  const b = (await upload({ ...META, cid: "second", t: META.t + 60 }, jpeg(), { token })).body.picture;

  const other = await signIn("someone");
  const theirs = await connect(other);
  assert.deepEqual((await remove(`?cid=${META.cid}`, { token: theirs })).body, { ok: true, removed: false });
  assert.deepEqual((await remove(`?id=${a.id}`, { cookie: other.cookie, origin: ORIGIN })).body, { ok: true, removed: false });
  assert.equal((await rows()).length, 2);

  assert.equal((await remove(`?cid=${META.cid}`)).status, 401);
  assert.equal((await remove(`?id=${b.id}`, { cookie: me.cookie })).status, 401, "a session counts only with our Origin");
  assert.equal((await remove(`?id=${b.id}`, { cookie: me.cookie, origin: "https://elsewhere.example" })).status, 403);
  assert.equal((await remove("", { token })).status, 400);
  assert.deepEqual((await remove(`?cid=${META.cid}`, { token })).body, { ok: true, removed: true });
  assert.deepEqual((await remove(`?cid=${META.cid}`, { token })).body, { ok: true, removed: false }, "already gone");
  assert.deepEqual((await remove(`?id=${b.id}`, { cookie: me.cookie, origin: ORIGIN })).body, { ok: true, removed: true });
  assert.equal((await rows()).length, 0);
  assert.equal(env.STUDIO.objects.size, 0, "the files go too");
});

test("removed on the page, a picture stays removed (410) until the companion restores it; the companion's own DELETE doesn't", async () => {
  const me = await signIn("aelric");
  await profile(me);
  const token = await connect(me);
  const tombstones = () => env.DB.sqlite.prepare("SELECT cid FROM picture_tombstones WHERE user_id = ? ORDER BY cid")
    .all(me.user.id).map(r => r.cid);
  const pic = (await upload(META, jpeg(), { token })).body.picture;
  await upload({ ...META, cid: "second", t: META.t + 60 }, jpeg(), { token });

  // Removed on the page (by id); then the companion's caption arrives, and then it sends the whole picture again.
  assert.equal((await remove(`?id=${pic.id}`, { cookie: me.cookie, origin: ORIGIN })).body.removed, true);
  assert.deepEqual(tombstones(), [META.cid]);
  const late = await upload({ cid: META.cid, caption: "Written after the upload." }, null, { token });
  assert.deepEqual([late.status, late.body.removed, late.body.ok], [410, true, false]);
  const resent = await upload(META, jpeg(), { token });
  assert.deepEqual([resent.status, resent.body.removed], [410, true]);
  assert.equal((await upload(META, jpeg(), { cookie: me.cookie, origin: ORIGIN })).status, 410, "from the page too");
  // restore: only with the whole picture, and only a good one.
  assert.equal((await upload({ cid: META.cid, caption: "Back?", restore: true }, null, { token })).status, 410, "meta only never restores");
  assert.equal((await upload({ ...META, restore: "yes" }, jpeg(), { token })).status, 410, "restore is true or nothing");
  assert.equal((await upload({ ...META, restore: true }, PNG, { token })).status, 415);
  assert.deepEqual(tombstones(), [META.cid], "a refused image doesn't lift it");
  assert.equal((await rows()).length, 1);
  const back = await upload({ ...META, restore: true }, jpeg(), { token });
  assert.deepEqual([back.status, back.body.created], [200, true]);
  assert.deepEqual(tombstones(), []);
  assert.equal((await upload({ cid: META.cid, caption: "Back again." }, null, { token })).status, 200, "and updates work again");

  // Removed by the companion itself (by cid): nothing remembered; it sends that picture again only when told to.
  assert.equal((await remove("?cid=second", { token })).body.removed, true);
  assert.deepEqual(tombstones(), []);
  assert.equal((await upload({ ...META, cid: "second", t: META.t + 60 }, jpeg(), { token })).status, 200);
  // Someone else's picture with the same cid isn't affected by a removal of mine.
  await remove(`?id=${back.body.picture.id}`, { cookie: me.cookie, origin: ORIGIN });
  assert.equal((await upload(META, jpeg(), { token: await connect(await signIn("someone")) })).status, 200);

  // Delete my profile forgets the removed ones with everything else: a new profile starts with an empty book.
  assert.deepEqual(tombstones(), [META.cid]);
  await profileApi({ request: new Request(`${ORIGIN}/api/profile/delete`, { method: "POST",
    headers: { "Content-Type": "application/json", Cookie: me.cookie, Origin: ORIGIN }, body: "{}" }), env, params: { action: "delete" } });
  assert.deepEqual(tombstones(), []);
  const again = await upload(META, jpeg(), { token: await connect(me) });
  assert.equal(again.status, 200);
  await remove(`?id=${again.body.picture.id}`, { cookie: me.cookie, origin: ORIGIN });
  assert.deepEqual(tombstones(), [META.cid]);
  await deleteUser(env, me.user);
  assert.deepEqual(tombstones(), [], "Delete my account too");
});

test("three reports from independent senders hide a picture for good; one person can't do it alone", async () => {
  const me = await signIn("aelric");
  await profile(me);
  const pic = (await upload(META, jpeg(), { token: await connect(me) })).body.picture;
  const [ann, bob, cat] = [await signIn("ann"), await signIn("bob"), await signIn("cat")];

  assert.equal((await report(pic.id, { cookie: ann.cookie, origin: "https://elsewhere.example" })).status, 403);
  assert.equal((await report(pic.id, { origin: null })).status, 403);
  assert.equal((await report("0123456789abcdef")).status, 404);
  assert.equal((await report(pic.id, { cookie: me.cookie })).status, 400, "the owner removes instead");

  // One account from three places, and three accounts from one place: one sender each time.
  for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) {
    assert.deepEqual((await report(pic.id, { cookie: ann.cookie, ip })).body, { ok: true, hidden: false });
  }
  for (const who of [bob, cat]) assert.equal((await report(pic.id, { cookie: who.cookie, ip: "198.51.100.1" })).body.hidden, false);
  assert.equal((await rows())[0].reports, 1);
  // A second sender (signed out, elsewhere), then a third (another account, elsewhere again).
  assert.equal((await report(pic.id, { ip: "192.0.2.50" })).body.hidden, false);
  assert.equal((await rows())[0].reports, 2);
  assert.deepEqual((await report(pic.id, { cookie: bob.cookie, ip: "192.0.2.77" })).body, { ok: true, hidden: true });
  const r = (await rows())[0];
  assert.deepEqual([r.reports, r.hidden], [3, 1]);

  // Hidden: no image, not on the page or in the list; the owner's list says so; sending it again doesn't bring it back.
  assert.equal((await image(pic.url)).status, 404);
  assert.equal((await image(pic.url, { cookie: me.cookie })).status, 404);
  assert.deepEqual((await list("?handle=aelric&pictures=1")).body.pictures, []);
  assert.ok(!(await view("aelric", { query: "?pictures=1" })).html.includes(pic.id));
  const mine = (await list("?handle=aelric", me.cookie)).body.pictures;
  assert.deepEqual([mine.length, mine[0].hidden, mine[0].url], [1, true, null]);
  await upload(META, jpeg(), { token: await connect(me) });
  assert.equal((await rows())[0].hidden, 1);
  assert.deepEqual((await report(pic.id, { ip: "192.0.2.99" })).body, { ok: true, hidden: true });
});

test("signed out, one IP is one sender on any day; signing in from it changes nothing; it takes three people", async t => {
  const me = await signIn("aelric");
  const pic = (await upload(META, jpeg(), { token: await connect(me) })).body.picture;
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-05T12:00:00Z") });
  for (const day of ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]) {
    t.mock.timers.setTime(Date.parse(`${day}T12:00:00Z`));
    assert.deepEqual((await report(pic.id, { ip: "198.51.100.40" })).body, { ok: true, hidden: false }, day);
  }
  const ann = await signIn("ann");
  assert.equal((await report(pic.id, { cookie: ann.cookie, ip: "198.51.100.40" })).body.hidden, false);
  assert.equal((await rows())[0].reports, 1);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM picture_reports").get().n, 1);
  const stored = env.DB.sqlite.prepare("SELECT ip_hash FROM picture_reports").get().ip_hash;
  assert.match(stored, /^[0-9a-f]{24}$/, "a hash, never the address");
  assert.ok(!stored.includes("198.51.100.40"));
  // Two more people, each from their own IP, make three.
  assert.equal((await report(pic.id, { ip: "198.51.100.41" })).body.hidden, false);
  assert.equal((await report(pic.id, { ip: "198.51.100.42" })).body.hidden, true);
  assert.equal((await rows())[0].hidden, 1);
});

test("reports are capped per sender per day", async () => {
  const me = await signIn("aelric");
  const pic = (await upload(META, jpeg(), { token: await connect(me) })).body.picture;
  for (let i = 0; i < 30; i++) assert.equal((await report(pic.id, { ip: "203.0.113.9" })).status, 200);
  assert.equal((await report(pic.id, { ip: "203.0.113.9" })).status, 429);
});

test("the pictures feature: off, only ?pictures=1 or the owner see the book; on, every visitor of a public profile", async () => {
  const me = await signIn("aelric");
  await profile(me);
  const token = await connect(me);
  await upload({ ...META, caption: 'A <script>alert("x")</script> & a "quote"' }, jpeg(1920, 1080), { token });
  await upload({ ...META, cid: "second", t: META.t + 3600, caption: null, s: null, z: "Westfall", lv: 25 }, jpeg(1600, 900), { token });

  // Off: the API and the page show nothing to visitors...
  assert.equal((await list("?handle=aelric")).status, 404);
  const off = await view("aelric");
  assert.equal(off.status, 200);
  assert.ok(!off.html.includes("Picture book") && !off.html.includes("/pictures/") && !off.html.includes("pictures.js"));
  // ...but ?pictures=1 does, and the owner's list always does.
  const shown = (await list("?handle=aelric&pictures=1")).body.pictures;
  assert.deepEqual(shown.map(p => [p.zone, p.subzone, p.lv]), [["Westfall", null, 25], ["Elwynn Forest", "Goldshire", 24]], "newest first");
  assert.deepEqual(Object.keys(shown[0]).sort(), ["caption", "h", "id", "lv", "subzone", "t", "url", "w", "zone"],
    "no realm, position, cid or account for visitors");
  assert.equal((await list("?handle=aelric", me.cookie)).body.pictures.length, 2);
  assert.equal((await list("?handle=nobody&pictures=1")).status, 404);

  const page = (await view("aelric", { query: "?pictures=1" })).html;
  assert.match(page, /<h2 id="pictures-title">Picture book<\/h2>/);
  assert.match(page, /<script src="\/js\/pictures\.js" defer><\/script>/);
  // Alt text: the caption, else the place. Captions are the player's text: escaped.
  assert.match(page, /alt="A &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; a &quot;quote&quot;"/);
  assert.match(page, /<p class="pb-cap">A &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; a &quot;quote&quot;<\/p>/);
  assert.ok(!page.includes("<script>alert"));
  assert.match(page, /width="1600" height="900" alt="Westfall"/);
  assert.match(page, /<p class="pb-where">Goldshire, Elwynn Forest<\/p>/);
  assert.match(page, /<p class="pb-when">Oct 2, 2025 &middot; Level 24<\/p>/);
  assert.match(page, /data-pb="report">Report this picture/, "visitors can report");
  assert.ok(!page.includes('data-pb="remove"'));
  assert.match(page, /<meta property="og:image" content="https:\/\/loreforeverwow\.com\/pictures\/[0-9a-f]{16}-[0-9a-f]{10}\.jpg">/);
  const owned = (await view("aelric", { cookie: me.cookie, query: "?pictures=1" })).html;
  assert.match(owned, /data-pb="remove">Remove from my profile/, "the owner can remove");
  assert.ok(!owned.includes('data-pb="report"'));

  // On: everyone.
  env.SITE_FEATURES = "pictures";
  assert.equal((await list("?handle=aelric")).body.pictures.length, 2);
  assert.match((await view("aelric")).html, /Picture book/);
  // A private profile: its pictures are no one's but its owner's, feature or not.
  await profileApi({ request: new Request(`${ORIGIN}/api/profile/settings`, { method: "POST",
    headers: { "Content-Type": "application/json", Cookie: me.cookie, Origin: ORIGIN }, body: JSON.stringify({ public: false }) }),
    env, params: { action: "settings" } });
  assert.equal((await list("?handle=aelric&pictures=1")).status, 404);
  assert.equal((await list("?handle=aelric", me.cookie)).body.pictures.length, 2);
});

test("the images: from R2 with a year's cache, by their content's address; private profiles only for their owner", async () => {
  const me = await signIn("aelric");
  await profile(me);
  const bytes = jpeg(1920, 1080, 100, 3);
  const pic = (await upload(META, bytes, { token: await connect(me) })).body.picture;
  const got = await image(pic.url);
  assert.equal(got.status, 200);
  assert.deepEqual(got.bytes, bytes);
  assert.equal(got.headers.get("Content-Type"), "image/jpeg");
  assert.equal(got.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(got.headers.get("Content-Length"), String(bytes.length));
  const etag = got.headers.get("ETag");
  assert.equal((await image(pic.url, { headers: { "If-None-Match": etag } })).status, 304);
  const head = await image(pic.url, { method: "HEAD" });
  assert.deepEqual([head.status, head.bytes.length, head.headers.get("Content-Length")], [200, 0, String(bytes.length)]);
  assert.equal((await image(pic.url.replace(/-[0-9a-f]{10}\./, "-0000000000."))).status, 404, "another version");
  assert.equal((await image("/pictures/../../etc.jpg")).status, 404);

  // Private: a 404 for everyone else; the owner's browser keeps it to itself.
  await env.DB.prepare("UPDATE profiles SET public = 0").run();
  assert.equal((await image(pic.url)).status, 404);
  assert.equal((await image(pic.url, { cookie: (await signIn("someone")).cookie })).status, 404);
  const own = await image(pic.url, { cookie: me.cookie });
  assert.equal(own.status, 200);
  assert.equal(own.headers.get("Cache-Control"), "private, max-age=31536000, immutable");
  // Its file gone from R2: a 404 too.
  env.STUDIO.objects.clear();
  assert.equal((await image(pic.url, { cookie: me.cookie })).status, 404);
});

test("Delete my profile and Delete my account take the pictures and their files with them", async () => {
  const me = await signIn("aelric");
  await profile(me);
  const token = await connect(me);
  await upload(META, jpeg(), { token });
  const other = await signIn("someone");
  await profile(other);
  const kept = (await upload(META, jpeg(), { token: await connect(other) })).body.picture;
  await report(kept.id, { cookie: me.cookie });

  const del = await profileApi({ request: new Request(`${ORIGIN}/api/profile/delete`, { method: "POST",
    headers: { "Content-Type": "application/json", Cookie: me.cookie, Origin: ORIGIN }, body: "{}" }), env, params: { action: "delete" } });
  assert.equal(del.status, 200);
  assert.deepEqual((await rows()).map(r => r.user_id), [other.user.id]);
  assert.deepEqual([...env.STUDIO.objects.keys()].map(k => k.split("/")[1]), [other.user.id]);

  await upload(META, jpeg(), { cookie: me.cookie, origin: ORIGIN });
  await deleteUser(env, me.user);
  assert.deepEqual((await rows()).map(r => r.user_id), [other.user.id]);
  assert.deepEqual([...env.STUDIO.objects.keys()].map(k => k.split("/")[1]), [other.user.id]);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM picture_reports").get().n, 0, "the reports they sent");
});

test("the section: newest SHOWN open and the rest folded, the player's own day, a line for an owner with none", () => {
  const pics = Array.from({ length: SHOWN + 3 }, (_, i) => ({ id: i.toString(16).padStart(16, "0"), sha: "abcdef0123",
    t: Date.parse("2026-10-05T03:30:00Z") / 1000 - i * 60, w: 1920, h: 1080, lv: 30, zone: "Duskwood", subzone: null, caption: null }));
  const html = picturesSection(pics, { tz: -420 });
  assert.equal(html.split('class="pb-item"').length - 1, SHOWN + 3);
  assert.match(html, /<details class="pf-older pb-older"><summary>Older pictures \(3\)<\/summary>/);
  assert.match(html, /<p class="pb-when">Oct 4, 2026 &middot; Level 30<\/p>/, "8:30 pm the day before, in the player's time");
  assert.match(picturesSection(pics, { tz: 0 }), /Oct 5, 2026/);
  assert.match(html, /loading="lazy"/);
  assert.equal(picturesSection([], {}), "", "nothing for a visitor");
  assert.match(picturesSection([], { owner: true }), /No pictures yet/);
});
