// "Lend your voice" (LOR-230) end to end through the real Function: the terms, the sample, the render tooling's
// admin calls (export, status, test pack), the donor's test pack, withdrawal (files deleted, a published voice off the
// site at once) and Delete my account. D1 is node:sqlite, R2 in memory (helpers.mjs).
// Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/studio/donate/[action].js";
import { findOrCreateUser, startSession, setup, deleteUser } from "../lib/accounts.js";
import { publicVoices } from "../lib/voices.js";
import { CONSENT_VERSION, DONATE } from "../lib/donate.js";
import { d1, r2, assets } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const ADMIN = { Authorization: "Bearer admin-test-key" };
const VOICES = { voices: [] };
const hooks = [];
const env = {
  DB: d1(), STUDIO: r2(), ADMIN_KEY: "admin-test-key", VOICES_WEBHOOK: "https://hooks.example/voices",
  ASSETS: assets({ "/voices/voices.json": VOICES }),
};
globalThis.fetch = async (url, init) => { hooks.push({ url, body: JSON.parse(init.body).content }); return new Response("{}"); };

async function call(method, action, { cookie, query = "", body, headers = {}, origin = true } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set("Cookie", cookie);
  if (method !== "GET" && origin) h.set("Origin", ORIGIN);
  let payload = body;
  if (body && !(body instanceof Uint8Array)) { h.set("Content-Type", "application/json"); payload = JSON.stringify(body); }
  const request = new Request(`${ORIGIN}/api/studio/donate/${action}${query}`, { method, headers: h, body: payload });
  const waits = [];
  const res = await onRequest({ request, env, params: { action }, waitUntil: p => waits.push(p) });
  await Promise.all(waits);
  return res;
}
const json = async res => ({ ...(await res.json()), status: res.status });   // status: the HTTP status

async function signIn(sub, name = sub) {
  await setup(env);
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name });
  const set = await startSession(env, new Request(ORIGIN), user.id);
  return { user, cookie: set.split(";")[0] };
}

// An "MP3" of n bytes (an ID3 header, then filler): the server goes by the first bytes, as for studio takes.
const mp3 = n => Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, ...Array.from({ length: n }, (_, i) => (i * 7) & 0xff)]);
const SAMPLE = mp3(DONATE.minBytes + 5000);
const checks = (duration, extra = {}) => encodeURIComponent(JSON.stringify({ duration, lufs: -17.2, snr: 48, bandwidth: 20000, warnings: [], ...extra }));
const send = (me, bytes = SAMPLE, headers = {}) => call("PUT", "sample", { cookie: me.cookie, body: bytes,
  headers: { "X-Checks": checks(152.4), "X-Credit": encodeURIComponent("Wren of Goldshire"), "X-Script": "2026-10-04", ...headers } });
const agree = (me, body = {}) => call("POST", "consent", { cookie: me.cookie,
  body: { agree: true, own: true, adult: true, signature: "Wren Example", version: CONSENT_VERSION, ...body } });

// The record a donation keeps after a withdrawal or Delete my account (lib/donate.js), and what it must not keep.
const recordOf = id => env.DB.prepare("SELECT * FROM voice_donations WHERE id = ?").bind(id).first();
const pick = (row, keys) => Object.fromEntries(keys.map(k => [k, row[k]]));
const PROOF = ["id", "consent_version", "signature", "adult", "status", "script", "voice_id"];
const GONE = ["credit", "r2_key", "ext", "bytes", "duration_ms", "checks", "crc32", "pack_key", "pack_bytes", "pack_lines", "pack_title"];

test("signed out, the page can load; sending needs an account, our own page and the terms", async () => {
  assert.deepEqual(await json(await call("GET", "state")), { status: 200, ok: true, signedIn: false,
    consent: { version: CONSENT_VERSION, agreed: false } });
  assert.equal((await call("PUT", "sample", { body: SAMPLE })).status, 401);
  const me = await signIn("terms");
  assert.equal((await call("PUT", "sample", { cookie: me.cookie, body: SAMPLE, origin: false })).status, 403);
  const refused = await json(await send(me));
  assert.equal(refused.status, 403);
  assert.match(refused.error, /agree to the terms/);
  // Each box, the signature and the version are checked.
  for (const [body, want] of [[{ adult: false }, /18 or older/], [{ own: false }, /your own/], [{ agree: false }, /tick the box/],
                              [{ signature: " " }, /full name/], [{ version: "2026-01-01" }, /updated since this page loaded/]]) {
    const r = await json(await agree(me, body));
    assert.ok(r.status >= 400, JSON.stringify(body));
    assert.match(r.error, want);
  }
  assert.equal((await agree(me)).status, 200);
  assert.deepEqual((await json(await call("GET", "state", { cookie: me.cookie }))).consent, { version: CONSENT_VERSION, agreed: true });
});

test("a donor lends their voice, we make it, they hear the test pack, then withdraw it", async () => {
  const me = await signIn("wren", "Wren Real-Name"), other = await signIn("someone-else");
  await agree(me);
  // What the server refuses: not audio, a format the game can't play, too short a file or reading, too long.
  assert.equal((await send(me, Uint8Array.from([1, 2, 3, ...Array(DONATE.minBytes).fill(0)]))).status, 415);
  const wav = Uint8Array.from([..."RIFF"].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WAVE"].map(c => c.charCodeAt(0)), Array(DONATE.minBytes).fill(0)));
  assert.equal((await send(me, wav)).status, 415);
  assert.match((await json(await send(me, mp3(5000)))).error, /very short/);
  assert.match((await json(await send(me, SAMPLE, { "X-Checks": checks(40) }))).error, /under a minute/);
  assert.match((await json(await send(me, SAMPLE, { "X-Checks": checks(400) }))).error, /over 5 minutes/);
  assert.equal(hooks.length, 0);

  const sent = await json(await send(me));
  assert.equal(sent.status, 200, sent.error);
  const d = sent.donation;
  assert.equal(d.status, "donated");
  assert.equal(d.credit, "Wren of Goldshire");
  assert.equal(d.duration, 152.4);
  assert.equal(d.consent, CONSENT_VERSION);
  assert.ok(env.STUDIO.objects.has(`studio/${me.user.id}/_donation/${d.id}/sample.mp3`));
  assert.equal(hooks.length, 1);
  assert.match(hooks[0].body, new RegExp(`Voice donation ${d.id}: Wren of Goldshire`));
  assert.match(hooks[0].body, /donation\.sh/);
  assert.doesNotMatch(hooks[0].body, /Wren Example|@example\.com/, "never the signature or the email");

  // While it waits, a new recording replaces it (same donation); the donor can play theirs back, nobody else can.
  const again = await json(await send(me, mp3(DONATE.minBytes + 9000), { "X-Credit": "" }));
  assert.equal(again.donation.id, d.id);
  assert.equal(again.donation.credit, "Wren Real-Name", "an empty credit falls back to the account's name");
  assert.match(hooks[1].body, /new recording/);
  assert.equal((await call("POST", "credit", { cookie: me.cookie, body: { credit: "Wren" } })).status, 200);
  assert.equal((await call("GET", "audio", { cookie: me.cookie, query: `?id=${d.id}` })).status, 200);
  assert.equal((await call("GET", "audio", { cookie: other.cookie, query: `?id=${d.id}` })).status, 404);
  assert.equal((await call("GET", "audio", { query: `?id=${d.id}`, headers: ADMIN })).status, 200);

  // The render tooling (admin key): export, rendering, a test pack, then publishing.
  assert.equal((await call("GET", "export")).status, 401);
  const exp = await json(await call("GET", "export", { headers: ADMIN }));
  const row = exp.donations.find(x => x.id === d.id);
  assert.equal(row.status, "donated");
  assert.equal(row.owner, me.user.id);
  assert.equal(row.has_sample, true);
  assert.equal((await call("POST", "status", { body: { id: d.id, status: "rendering" } })).status, 401);
  assert.equal((await call("POST", "status", { headers: ADMIN, body: { id: d.id, status: "rendering" } })).status, 200);
  assert.match((await json(await send(me))).error, /withdraw this one first/, "no swapping the sample mid-render");
  assert.equal((await call("GET", "pack", { cookie: me.cookie, query: `?id=${d.id}` })).status, 404);
  assert.equal((await call("PUT", "pack", { query: `?id=${d.id}`, headers: ADMIN, body: mp3(100) })).status, 415, "only a zip");
  const zip = Uint8Array.from([0x50, 0x4b, 3, 4, ...Array(300).fill(1)]);
  const put = await call("PUT", "pack", { query: `?id=${d.id}`, body: zip,
    headers: { ...ADMIN, "X-Pack-Lines": "21", "X-Pack-Title": encodeURIComponent("Wren (test pack)") } });
  assert.equal(put.status, 200);
  const ready = (await json(await call("GET", "state", { cookie: me.cookie }))).donation;
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.pack, { lines: 21, bytes: zip.length, title: "Wren (test pack)" });
  const pack = await call("GET", "pack", { cookie: me.cookie, query: `?id=${d.id}` });
  assert.equal(pack.status, 200);
  assert.equal(pack.headers.get("Content-Type"), "application/zip");
  assert.deepEqual(new Uint8Array(await pack.arrayBuffer()), zip);
  assert.equal((await call("GET", "pack", { cookie: other.cookie, query: `?id=${d.id}` })).status, 404);

  // Published: a voices row with the donor as owner, so its voices.json entry shows (credit "voice by ...").
  assert.equal((await call("POST", "status", { headers: ADMIN, body: { id: d.id, status: "published", voice_id: "studio" } })).status, 400);
  const pub = await json(await call("POST", "status", { headers: ADMIN, body: { id: d.id, status: "published", voice_id: "wren", title: "Wren" } }));
  assert.equal(pub.status, 200, pub.error);
  VOICES.voices.push({ id: "wren", name: "Wren", credit: "Wren", donated: true, owner: me.user.id });
  const request = new Request(`${ORIGIN}/voices/wren`);
  assert.deepEqual((await publicVoices(env, request)).map(v => v.id), ["wren"]);
  assert.equal((await json(await call("GET", "state", { cookie: me.cookie }))).donation.voice, "wren");

  // Withdrawn: the files go, the published voice drops off the site at once, the tooling is told.
  assert.equal((await call("POST", "withdraw", { cookie: other.cookie, body: {} })).status, 404);
  const gone = await json(await call("POST", "withdraw", { cookie: me.cookie, body: { id: d.id } }));
  assert.equal(gone.status, 200);
  assert.equal([...env.STUDIO.objects.keys()].filter(k => k.includes("/_donation/")).length, 0);
  assert.deepEqual((await publicVoices(env, request)).map(v => v.id), []);
  assert.match(hooks.at(-1).body, /withdrawn/);
  assert.match(hooks.at(-1).body, /voices\.json/);
  const after = await json(await call("GET", "state", { cookie: me.cookie }));
  assert.equal(after.donation, null);
  const exp2 = (await json(await call("GET", "export", { headers: ADMIN }))).donations.find(x => x.id === d.id);
  assert.equal(exp2.status, "withdrawn", "the tooling sees it's withdrawn, to delete its own copy");
  assert.equal(exp2.has_sample, false);
  assert.equal((await call("PUT", "pack", { query: `?id=${d.id}`, headers: ADMIN, body: zip })).status, 410);
  assert.equal((await call("POST", "status", { headers: ADMIN, body: { id: d.id, status: "ready" } })).status, 410);
  assert.equal((await call("GET", "audio", { cookie: me.cookie, query: `?id=${d.id}` })).status, 404);
  assert.equal((await call("POST", "withdraw", { cookie: me.cookie, body: {} })).status, 404);
  // The row is now only the record of the agreement: what was signed and when, never the files or the credit.
  const record = await recordOf(d.id);
  assert.deepEqual(pick(record, PROOF), { id: d.id, consent_version: CONSENT_VERSION, signature: "Wren Example", adult: 1,
                                          status: "withdrawn", script: "2026-10-04", voice_id: "wren" });
  assert.ok(record.consented && record.created && record.withdrawn, record);
  assert.deepEqual(pick(record, GONE), Object.fromEntries(GONE.map(k => [k, null])));
  assert.equal(record.owner, me.user.id, "still linked while the account exists");

  // They can lend it again later: a new donation.
  const fresh = await json(await send(me));
  assert.equal(fresh.status, 200);
  assert.notEqual(fresh.donation.id, d.id);
});

test("Delete my account deletes the files and the credit, and keeps the signed record without the account", async () => {
  const me = await signIn("leaving");
  await agree(me, { signature: "Leaving Example" });
  // One donation withdrawn earlier, one live with a test pack: both keep only the record, neither keeps the account.
  const first = (await json(await send(me))).donation;
  await call("POST", "withdraw", { cookie: me.cookie, body: { id: first.id } });
  const d = (await json(await send(me, SAMPLE, { "X-Credit": encodeURIComponent("Leaving Voice") }))).donation;
  await call("PUT", "pack", { query: `?id=${d.id}`, body: Uint8Array.from([0x50, 0x4b, 3, 4, 1, 2, 3]),
                              headers: { ...ADMIN, "X-Pack-Lines": "3", "X-Pack-Title": "Leaving%20(test%20pack)" } });
  assert.ok([...env.STUDIO.objects.keys()].some(k => k.includes(d.id)));
  await deleteUser(env, me.user);

  assert.ok(![...env.STUDIO.objects.keys()].some(k => k.includes(d.id) || k.includes(me.user.id)), "sample and pack gone");
  for (const id of [first.id, d.id]) {
    const record = await recordOf(id);
    assert.ok(record, "the signed record stays as proof of the license");
    assert.deepEqual(pick(record, ["id", "consent_version", "signature", "adult", "status"]),
      { id, consent_version: CONSENT_VERSION, signature: "Leaving Example", adult: 1, status: "withdrawn" });
    assert.ok(record.consented && record.created && record.withdrawn, record);
    assert.equal(record.owner, "", "no link to the deleted account");
    assert.deepEqual(pick(record, GONE), Object.fromEntries(GONE.map(k => [k, null])), "no recording, test pack or credit");
  }
  const left = JSON.stringify(await env.DB.prepare("SELECT * FROM voice_donations WHERE id IN (?, ?)").bind(first.id, d.id).all());
  assert.doesNotMatch(left, new RegExp(`${me.user.id}|leaving@example|Leaving Voice`), left);
  assert.equal(await env.DB.prepare("SELECT COUNT(*) AS n FROM donation_release WHERE user_id = ?").bind(me.user.id).first("n"), 0,
    "the per-account agreement goes; each donation keeps its own copy");
  // The render tooling sees them as withdrawn (so it deletes its local copies), and the donor's routes don't reach them.
  const rows = (await json(await call("GET", "export", { headers: ADMIN }))).donations.filter(x => [first.id, d.id].includes(x.id));
  assert.deepEqual(rows.map(x => [x.status, x.has_sample, x.owner]), [["withdrawn", false, ""], ["withdrawn", false, ""]]);
  assert.equal((await call("GET", "audio", { query: `?id=${d.id}`, headers: ADMIN })).status, 404);
});

test("a day's sample uploads are capped", async () => {
  const me = await signIn("busy");
  await agree(me);
  for (let i = 0; i < DONATE.perDay; i++) assert.equal((await send(me)).status, 200);
  assert.equal((await send(me)).status, 429);
});
