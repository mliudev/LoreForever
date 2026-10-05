// "Claim a zone" (LOR-231) end to end through the real Functions: the public zone list, claiming, one active claim per
// narrator, one claim per zone, done once every line is recorded, expiry after 14 days without an upload, letting go,
// languages kept apart, and Delete my account. D1 is node:sqlite, R2 in memory (helpers.mjs).
// Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest as zonesApi } from "../functions/api/studio/zones/[action].js";
import { onRequest as studioApi } from "../functions/api/studio/[action].js";
import { findOrCreateUser, startSession, setup, deleteUser } from "../lib/accounts.js";
import { zoneList, zoneProgress, expiresAt, EXPIRE_DAYS } from "../public/voices/zone-list.js";
import { d1, r2, assets } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const line = (id, hash, de = false) => ({
  id, file: id.replace(/[:#]/g, "_"), text: { enUS: `Text of ${id}.`, ...(de ? { deDE: `Text von ${id}.` } : {}) },
  hash: { enUS: hash, ...(de ? { deDE: `de${hash}` } : {}) }, hints: { enUS: [] },
});
const story = (key, zone, lines) => ({ key, name: { enUS: key }, voice: "human", zone, lines });
const LINES = {
  languages: [{ locale: "enUS", name: "English", draft: false, lines: 6 }, { locale: "deDE", name: "Deutsch", draft: true, lines: 2 }],
  groups: [
    { name: "Starting zones", stories: [
      story("zone:elwynn", "elwynn", [line("zone:elwynn", "e1", true), line("zone:elwynn#faq1", "e2")]),
      story("subzone:goldshire", "elwynn", [line("subzone:goldshire", "e3")]),
      story("zone:durotar", "durotar", [line("zone:durotar", "d1", true)]),
    ] },
    { name: "Capitals", stories: [story("zone:stormwind", "stormwind", [line("zone:stormwind", "s1")])] },
    { name: "The road ahead", stories: [story("zone:duskwood", "duskwood", [line("zone:duskwood", "k1")])] },
  ],
  zones: [
    { key: "elwynn", name: { enUS: "Elwynn Forest", deDE: "Wald von Elwynn" }, starter: true },
    { key: "durotar", name: { enUS: "Durotar" }, starter: true },
    { key: "stormwind", name: { enUS: "Stormwind City" }, starter: true },
    { key: "duskwood", name: { enUS: "Duskwood" }, starter: false },
  ],
};
const VOICES = { voices: [] };
const env = { DB: d1(), STUDIO: r2(), ASSETS: assets({ "/voices/lines.json": LINES, "/voices/voices.json": VOICES }) };

async function call(api, method, path, { cookie, query = "", body, origin = true } = {}) {
  const h = new Headers();
  if (cookie) h.set("Cookie", cookie);
  if (method !== "GET" && origin) h.set("Origin", ORIGIN);
  let payload = body;
  if (body && !(body instanceof Uint8Array)) { h.set("Content-Type", "application/json"); payload = JSON.stringify(body); }
  const action = path.split("/").pop();
  const request = new Request(`${ORIGIN}/api/studio/${path}${query}`, { method, headers: h, body: payload });
  const res = await api({ request, env, params: { action }, waitUntil: () => {} });
  return { status: res.status, body: await res.json() };
}
const zones = (method, action, opts) => call(zonesApi, method, `zones/${action}`, opts);
const studio = (method, action, opts) => call(studioApi, method, action, opts);

async function signIn(sub, name = sub) {
  await setup(env);
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name });
  const set = await startSession(env, new Request(ORIGIN), user.id);
  return { user, cookie: set.split(";")[0] };
}
async function voiceOf(me, name, locale = "enUS") {
  const made = await studio("POST", "voice", { cookie: me.cookie, body: { name, locale } });
  assert.ok(made.body.ok, made.body.error);
  return made.body.id;
}
const mp3 = n => Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, ...Array.from({ length: n }, (_, i) => i & 0xff)]);
const upload = (me, voice, lineId) => studio("PUT", "take", { cookie: me.cookie, body: mp3(400),
  query: `?voice=${voice}&line=${encodeURIComponent(lineId)}` });
const board = async (query = "", cookie) => (await zones("GET", "list", { query, cookie })).body;
const zoneOf = (b, key) => b.zones.find(z => z.key === key);
const daysAgo = d => new Date(Date.now() - d * 86400e3).toISOString();
let aelric = null;   // the voice that narrates Elwynn Forest below

test("zoneList and zoneProgress group lines by zone, per language", () => {
  const en = zoneList(LINES, "enUS");
  assert.deepEqual(en.map(z => [z.key, z.lines.length, z.starter]), [["elwynn", 3, true], ["durotar", 1, true], ["stormwind", 1, true], ["duskwood", 1, false]]);
  const de = zoneList(LINES, "deDE");
  assert.deepEqual(de.map(z => [z.key, z.name, z.lines.length]), [["elwynn", "Wald von Elwynn", 1], ["durotar", "Durotar", 1]]);
  const takes = { "zone:elwynn": { hash: "e1", created: "2026-10-01T00:00:00Z" }, "subzone:goldshire": { hash: "old", created: "2026-10-02T00:00:00Z" } };
  assert.deepEqual(zoneProgress(en[0], takes), { done: 1, total: 3, last: "2026-10-02T00:00:00Z" }, "a stale take counts as work, not as done");
  assert.equal(expiresAt("2026-10-01T00:00:00.000Z", null), new Date(Date.parse("2026-10-01T00:00:00Z") + EXPIRE_DAYS * 86400e3).toISOString());
  assert.equal(expiresAt("2026-10-01T00:00:00.000Z", "2026-10-05T00:00:00.000Z"), "2026-10-19T00:00:00.000Z");
});

test("anyone sees the zone list; claiming needs an account and our own page", async () => {
  const open = await board();
  assert.equal(open.ok, true);
  assert.equal(open.locale, "enUS");
  assert.equal(open.mine, undefined);
  assert.deepEqual(open.zones.map(z => [z.key, z.lines, z.claim]), [["elwynn", 3, null], ["durotar", 1, null], ["stormwind", 1, null], ["duskwood", 1, null]]);
  // The "zones" feature (lib/features.js) is off by default; SITE_FEATURES turns it on. The list says which, so the
  // upload page knows whether to show the zone box.
  assert.equal(open.on, false);
  env.SITE_FEATURES = "contribute, zones";
  assert.equal((await board()).on, true);
  delete env.SITE_FEATURES;
  assert.equal((await zones("POST", "claim", { body: { voice: "x", zone: "elwynn" } })).status, 401);
  const me = await signIn("origin-check");
  assert.equal((await zones("POST", "claim", { cookie: me.cookie, origin: false, body: { voice: "x", zone: "elwynn" } })).status, 403);
  assert.equal((await zones("POST", "claim", { cookie: me.cookie, body: { voice: "not-mine", zone: "elwynn" } })).status, 404);
});

test("a narrator claims a zone, records it, and it's theirs on the list; then the next one", async () => {
  const a = await signIn("aelric", "Aelric Real-Name"), b = await signIn("brenna");
  const va = await voiceOf(a, "Aelric Tales"), vb = await voiceOf(b, "Brenna's voice");
  VOICES.voices.push({ id: va, name: "Aelric Tales", credit: "Aelric", language: "English", owner: a.user.id });   // published: the list links to it
  aelric = va;

  const mine = (await board(`?voice=${va}`, a.cookie)).mine;
  assert.deepEqual(mine, { active: null, done: [], suggest: "elwynn" }, "a starting zone is suggested first");
  assert.equal((await zones("POST", "claim", { cookie: a.cookie, body: { voice: va, zone: "nowhere" } })).status, 400);

  const claimed = await zones("POST", "claim", { cookie: a.cookie, body: { voice: va, zone: "elwynn", credit: "Aelric" } });
  assert.equal(claimed.status, 200, claimed.body.error);
  assert.equal(claimed.body.claim.zone, "elwynn");
  assert.equal(claimed.body.claim.total, 3);
  // One active claim per narrator, one claim per zone.
  const second = await zones("POST", "claim", { cookie: a.cookie, body: { voice: va, zone: "durotar" } });
  assert.equal(second.status, 409);
  assert.match(second.body.error, /You're narrating Elwynn Forest/);
  const taken = await zones("POST", "claim", { cookie: b.cookie, body: { voice: vb, zone: "elwynn" } });
  assert.equal(taken.status, 409);
  assert.match(taken.body.error, /Aelric is narrating Elwynn Forest/);
  assert.equal((await board(`?voice=${vb}`, b.cookie)).mine.suggest, "durotar", "the next open starting zone");

  // Progress, publicly: the credit typed when claiming, never the account's own name unless they chose it.
  await upload(a, va, "zone:elwynn");
  let z = zoneOf(await board(), "elwynn");
  assert.deepEqual({ ...z.claim, since: undefined }, { credit: "Aelric", status: "active", done: 1, total: 3, since: undefined, finished: null, voice: va });
  assert.doesNotMatch(JSON.stringify(await board()), /Real-Name/);

  // Every line recorded: done, still credited, and the narrator can claim another.
  await upload(a, va, "zone:elwynn#faq1");
  await upload(a, va, "subzone:goldshire");
  z = zoneOf(await board(), "elwynn");
  assert.equal(z.claim.status, "done");
  assert.ok(z.claim.finished);
  const after = (await board(`?voice=${va}`, a.cookie)).mine;
  assert.equal(after.active, null);
  assert.deepEqual(after.done.map(d => d.zone), ["elwynn"]);
  assert.equal((await zones("POST", "claim", { cookie: b.cookie, body: { voice: vb, zone: "elwynn" } })).status, 409, "a narrated zone stays credited");
  const next = await zones("POST", "claim", { cookie: a.cookie, body: { voice: va, zone: "durotar" } });
  assert.equal(next.status, 200, next.body.error);
  assert.match((await zones("POST", "claim", { cookie: a.cookie, body: { voice: va, zone: "stormwind" } })).body.error, /narrating Durotar/);

  // Letting go opens the zone for anyone.
  assert.equal((await zones("POST", "release", { cookie: a.cookie, body: { id: next.body.claim.id } })).status, 200);
  assert.equal(zoneOf(await board(), "durotar").claim, null);
  assert.equal((await zones("POST", "release", { cookie: a.cookie, body: { id: next.body.claim.id } })).status, 404);
  assert.equal((await zones("POST", "claim", { cookie: b.cookie, body: { voice: vb, zone: "durotar" } })).status, 200);
});

test("a claim expires after 14 days without an upload in its zone; an upload keeps it", async () => {
  const c = await signIn("cyra"), d = await signIn("dorn");
  const vc = await voiceOf(c, "Cyra"), vd = await voiceOf(d, "Dorn");
  const res = await zones("POST", "claim", { cookie: c.cookie, body: { voice: vc, zone: "stormwind" } });
  assert.equal(res.status, 200, res.body.error);
  const id = res.body.claim.id;
  // 20 days old, but a take in the zone 3 days ago: still active, and it runs 14 days from that upload.
  await env.DB.prepare("UPDATE studio_claims SET created = ? WHERE id = ?").bind(daysAgo(20), id).run();
  await env.DB.sqlite.prepare("INSERT INTO studio_takes (voice_id, line_id, owner, r2_key, ext, bytes, hash, created) VALUES (?, ?, ?, ?, 'mp3', 1, 'old-text', ?)")
    .run(vc, "zone:stormwind", c.user.id, "k", daysAgo(3));
  const kept = (await board(`?voice=${vc}`, c.cookie)).mine.active;
  assert.equal(kept?.zone, "stormwind", "an upload (even of older text) keeps the claim");
  assert.ok(Math.abs(Date.parse(kept.expires) - (Date.now() + 11 * 86400e3)) < 60e3, kept.expires);
  // The upload is 15 days old now: the zone opens up, and Cyra can claim something else.
  await env.DB.prepare("UPDATE studio_takes SET created = ? WHERE voice_id = ?").bind(daysAgo(15), vc).run();
  assert.equal(zoneOf(await board(), "stormwind").claim, null);
  const row = await env.DB.prepare("SELECT status FROM studio_claims WHERE id = ?").bind(id).first();
  assert.equal(row.status, "expired");
  assert.equal((await zones("POST", "claim", { cookie: d.cookie, body: { voice: vd, zone: "stormwind" } })).status, 200);
  assert.equal((await board(`?voice=${vc}`, c.cookie)).mine.active, null);
});

test("each language has its own claims; Delete my account removes a narrator's claims", async () => {
  const e = await signIn("eldra");
  const vde = await voiceOf(e, "Eldra (Deutsch)", "deDE");
  const de = await board(`?voice=${vde}`, e.cookie);
  assert.equal(de.locale, "deDE");
  assert.deepEqual(de.zones.map(z => [z.key, z.name, z.lines, z.claim]), [["elwynn", "Wald von Elwynn", 1, null], ["durotar", "Durotar", 1, null]],
    "Elwynn is narrated in English, still open in German");
  assert.equal(de.mine.suggest, "elwynn");
  assert.equal((await zones("POST", "claim", { cookie: e.cookie, body: { voice: vde, zone: "duskwood" } })).status, 400, "no German text there yet");
  assert.equal((await zones("POST", "claim", { cookie: e.cookie, body: { voice: vde, zone: "elwynn" } })).status, 200);
  assert.equal(zoneOf(await board("?locale=deDE"), "elwynn").claim.credit, "eldra");
  await deleteUser(env, e.user);
  assert.equal(zoneOf(await board("?locale=deDE"), "elwynn").claim, null);
  assert.equal(await env.DB.prepare("SELECT COUNT(*) AS n FROM studio_claims WHERE owner = ?").bind(e.user.id).first("n"), 0);
});

test("/voices/zones and the voice's profile show who narrated which zone", async () => {
  const { onRequestGet: zonesPage } = await import("../functions/voices/zones.js");
  const { onRequestGet: profile } = await import("../functions/voices/[id].js");
  const html = await (await zonesPage({ request: new Request(`${ORIGIN}/voices/zones`), env })).text();
  assert.match(html, new RegExp(`Elwynn Forest</span><span class="zp-lines">3 lines</span><span class="zp-done">Narrated by <a href="/voices/${aelric}">Aelric</a>`));
  assert.match(html, /Durotar<\/span><span class="zp-lines">1 line<\/span><span class="zp-going">Being narrated by brenna · 0%/);
  assert.match(html, /<b>1<\/b> of 4 zones narrated, <b>2<\/b> being narrated/);
  assert.doesNotMatch(html, /Deutsch/, "no German claims left, so no German list");
  const profilePage = async () => (await profile({ request: new Request(`${ORIGIN}/voices/${aelric}`), env, params: { id: aelric },
                                                  next: () => new Response("static") })).text();
  // The "zones" feature is off: the page opens (for previews) but is noindex and sends people to the upload page with
  // ?zones=1, and profiles don't list zones.
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /href="\/voices\/studio\?zones=1"/);
  assert.doesNotMatch(await profilePage(), /Zones narrated/);
  // On (SITE_FEATURES on Preview, or FEATURES.zones in lib/features.js): indexed, plain links, zones on the profile.
  env.SITE_FEATURES = "zones";
  const live = await (await zonesPage({ request: new Request(`${ORIGIN}/voices/zones`), env })).text();
  assert.doesNotMatch(live, /noindex/);
  assert.doesNotMatch(live, /zones=1/);
  assert.match(await profilePage(), /Zones narrated: Elwynn Forest\./);
  delete env.SITE_FEATURES;
  // Without the database the page still lists every zone, open.
  const bare = await (await zonesPage({ request: new Request(`${ORIGIN}/voices/zones`), env: { ASSETS: env.ASSETS } })).text();
  assert.match(bare, /<b>0<\/b> of 4 zones narrated/);
});
