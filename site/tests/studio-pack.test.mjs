// GET /api/studio/pack end to end through the real Function: sign in, agree, upload, download, unzip.
// D1 is node:sqlite and R2 is in memory (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/studio/[action].js";
import { findOrCreateUser, startSession, setup } from "../lib/accounts.js";
import { RELEASE_VERSION } from "../lib/submissions.js";
import { renderClips } from "../lib/voicepack.js";
import { crc32, crcHex } from "../public/voices/crc32.js";
import { d1, r2, assets, unzip } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const line = (id, file, hash) => ({ id, file, text: { enUS: `Text of ${id}.` }, hash: { enUS: hash }, hints: { enUS: [] } });
const LINES = {
  languages: [{ locale: "enUS", name: "English", draft: false, lines: 4 }],
  groups: [{ name: "Capitals", stories: [
    { key: "zone:stormwind", name: { enUS: "Stormwind" }, voice: "human",
      lines: [line("zone:stormwind", "zone_stormwind", "aaaa00000001"), line("zone:stormwind#faq1", "zone_stormwind__faq1", "aaaa00000002")] },
    { key: "zone:elwynn", name: { enUS: "Elwynn" }, voice: "human", lines: [line("zone:elwynn", "zone_elwynn", "aaaa00000003")] },
    { key: "zone:durotar", name: { enUS: "Durotar" }, voice: "orc", lines: [line("zone:durotar", "zone_durotar", "aaaa00000004")] },
  ] }],
};

const env = { DB: d1(), STUDIO: r2(), ASSETS: assets({ "/voices/lines.json": LINES }), ADMIN_KEY: "admin-test-key" };

async function call(method, action, { cookie, query = "", body, headers = {} } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set("Cookie", cookie);
  if (method !== "GET") h.set("Origin", ORIGIN);
  let payload = body;
  if (body && !(body instanceof Uint8Array)) { h.set("Content-Type", "application/json"); payload = JSON.stringify(body); }
  const request = new Request(`${ORIGIN}/api/studio/${action}${query}`, { method, headers: h, body: payload });
  return onRequest({ request, env, params: { action }, waitUntil: () => {} });
}

async function signIn(sub) {
  await setup(env);
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const set = await startSession(env, new Request(ORIGIN), user.id);
  return { user, cookie: set.split(";")[0] };
}

const mp3 = (n, seed) => Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, ...Array.from({ length: n }, (_, i) => (i * seed) & 0xff)]);
const ascii = s => [...s].map(c => c.charCodeAt(0));
// An Ogg page header (26 bytes), one segment, then the codec's first packet: Vorbis plays in game, Opus doesn't.
const oggOf = (codec, n) => Uint8Array.from([...ascii("OggS"), 0, 2, ...Array(20).fill(0), 1, 30, ...codec,
  ...Array.from({ length: n }, (_, i) => i & 0xff)]);
const ogg = n => oggOf([1, ...ascii("vorbis")], n);
const opus = oggOf(ascii("OpusHead"), 200);
const wav = Uint8Array.from([..."RIFF"].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WAVE"].map(c => c.charCodeAt(0)), [0, 0, 0, 0]));
const m4a = Uint8Array.from([0, 0, 0, 0x20, ...ascii("ftypM4A "), ...Array(200).fill(0)]);
const adts = Uint8Array.from([0xff, 0xf1, 0x50, 0x80, ...Array(200).fill(0)]);   // bare AAC: looks like an MPEG frame

test("a narrator downloads their test pack", async () => {
  const me = await signIn("narrator"), other = await signIn("someone-else");
  assert.equal((await call("POST", "release", { cookie: me.cookie,
    body: { agree: true, adult: true, signature: "Test Narrator", release: RELEASE_VERSION } })).status, 200);
  const made = await (await call("POST", "voice", { cookie: me.cookie, body: { name: "Ashen Tales", locale: "enUS" } })).json();
  assert.ok(made.ok, made.error);
  const voice = made.id;

  // Nothing uploaded yet: no pack.
  assert.equal((await call("GET", "pack", { cookie: me.cookie, query: `?voice=${voice}` })).status, 404);

  const put = (lineId, bytes, headers = {}) => call("PUT", "take", { cookie: me.cookie, body: bytes, headers,
    query: `?voice=${voice}&line=${encodeURIComponent(lineId)}` });
  const storm = mp3(3000, 7), elwynn = mp3(2500, 13);
  assert.equal((await put("zone:stormwind", storm, { "X-CRC32": crcHex(crc32(storm)), "X-File-Name": "storm.wav" })).status, 200);
  assert.equal((await put("zone:elwynn", elwynn)).status, 200);                       // no CRC: an upload from before
  assert.equal((await put("zone:stormwind#faq1", ogg(900))).status, 200);              // the minority format
  assert.equal((await put("zone:durotar", mp3(100, 3))).status, 200);                  // reworded below
  // The page converts everything the game can't play; the server refuses it unconverted.
  for (const bytes of [wav, m4a, opus, adts]) {
    const refused = await put("zone:durotar", bytes);
    assert.equal(refused.status, 415);
    assert.match((await refused.json()).error, /turns this kind of file into \.mp3/);
  }
  LINES.groups[0].stories[2].lines[0].hash.enUS = "bbbb00000004";

  // Only the owner (or the admin key) gets it.
  assert.equal((await call("GET", "pack", { query: `?voice=${voice}` })).status, 401);
  assert.equal((await call("GET", "pack", { cookie: other.cookie, query: `?voice=${voice}` })).status, 404);

  const res = await call("GET", "pack", { cookie: me.cookie, query: `?voice=${voice}` });
  assert.equal(res.status, 200);
  const folder = "LoreForever_Voice_TestAshenTales";
  assert.equal(res.headers.get("Content-Type"), "application/zip");
  assert.equal(res.headers.get("Content-Disposition"), `attachment; filename="${folder}.zip"`);
  assert.equal(res.headers.get("X-Pack-Lines"), "2");
  const zip = new Uint8Array(await res.arrayBuffer());
  assert.equal(String(zip.length), res.headers.get("Content-Length"));
  const files = unzip(zip);
  assert.deepEqual(files.map(f => f.name), [`${folder}/${folder}.toc`, `${folder}/Clips.lua`,
    `${folder}/Audio/zone_elwynn.mp3`, `${folder}/Audio/zone_stormwind.mp3`]);
  const text = f => new TextDecoder().decode(f.data);
  const toc = text(files[0]);
  assert.match(toc, /^## Title: Ashen Tales \(test pack\)$/m);
  assert.match(toc, /^## X-LoreForever-Pack: voice$/m);
  assert.match(toc, /^## X-LoreForever-Locale: enUS$/m);
  assert.match(toc, /^## X-LoreForever-Sample: zone:stormwind$/m);
  assert.match(toc, /^## Version: test-\d{8}\.\d{4}$/m);
  assert.equal(text(files[1]), renderClips({ "zone:stormwind": "aaaa00000001", "zone:elwynn": "aaaa00000003" }, "mp3"));
  assert.deepEqual(files[2].data, elwynn);
  assert.deepEqual(files[3].data, storm);
  assert.deepEqual(files.map(f => f.descriptor), [false, false, true, false]);   // only the upload without a CRC

  // The CRC worked out on the way is kept, so the next download streams every file straight through.
  const kept = await env.DB.prepare("SELECT crc32 FROM studio_takes WHERE voice_id = ? AND line_id = ?").bind(voice, "zone:elwynn").first("crc32");
  assert.equal(kept, crcHex(crc32(elwynn)));
  const again = unzip(new Uint8Array(await (await call("GET", "pack", { cookie: me.cookie, query: `?voice=${voice}` })).arrayBuffer()));
  assert.deepEqual(again.map(f => f.descriptor), [false, false, false, false]);

  // The admin key can build any voice's pack.
  const admin = await call("GET", "pack", { query: `?voice=${voice}`, headers: { Authorization: "Bearer admin-test-key" } });
  assert.equal(admin.status, 200);
  await admin.arrayBuffer();

  // Mostly .ogg now: the pack switches format and says so in Clips.lua.
  await put("zone:stormwind", ogg(400));
  await put("zone:elwynn", ogg(500));
  const oggPack = unzip(new Uint8Array(await (await call("GET", "pack", { cookie: me.cookie, query: `?voice=${voice}` })).arrayBuffer()));
  assert.deepEqual(oggPack.slice(2).map(f => f.name.split("/").pop()), ["zone_elwynn.ogg", "zone_stormwind.ogg", "zone_stormwind__faq1.ogg"]);
  assert.match(text(oggPack[1]), /^P\.ext = "ogg"$/m);
  assert.equal(env.STUDIO.objects.size, 4, "replacing a take with another format deletes the old file");
});

test("a narrator says which races their voice suits; it goes in the test pack and the export (LOR-170)", async () => {
  const me = await signIn("orc-voice"), other = await signIn("not-the-owner");
  const made = await (await call("POST", "voice", { cookie: me.cookie, body: { name: "Grukk", locale: "enUS" } })).json();
  assert.ok(made.ok, made.error);
  const set = races => call("POST", "voice", { cookie: me.cookie, body: { id: made.id, races } });
  // Known races only, in a fixed order, whatever the page sends.
  const res = await set(["Troll", "orc", "murloc"]);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).races, "orc,troll");
  assert.equal((await call("POST", "voice", { cookie: other.cookie, body: { id: made.id, races: ["human"] } })).status, 404,
    "only the owner can change it");
  const state = await (await call("GET", "state", { cookie: me.cookie, query: `?voice=${made.id}` })).json();
  assert.equal(state.voices.find(v => v.id === made.id).races, "orc,troll");

  await call("PUT", "take", { cookie: me.cookie, body: mp3(600, 9), query: `?voice=${made.id}&line=zone%3Adurotar` });
  const files = unzip(new Uint8Array(await (await call("GET", "pack", { cookie: me.cookie, query: `?voice=${made.id}` })).arrayBuffer()));
  assert.match(new TextDecoder().decode(files[0].data), /^## X-LoreForever-Races: Orc, Troll$/m);
  const exported = await (await call("GET", "export", { query: `?voice=${made.id}`, headers: { Authorization: "Bearer admin-test-key" } })).json();
  assert.equal(exported.voice.races_label, "Orc, Troll");

  // Untick them all: no Races line.
  assert.equal((await (await set([])).json()).races, "");
  const plain = unzip(new Uint8Array(await (await call("GET", "pack", { cookie: me.cookie, query: `?voice=${made.id}` })).arrayBuffer()));
  assert.doesNotMatch(new TextDecoder().decode(plain[0].data), /X-LoreForever-Races/);
});

test("the release needs its own 18-or-older box, and an older version is asked for again", async () => {
  const me = await signIn("age-check");
  const agree = body => call("POST", "release", { cookie: me.cookie,
    body: { agree: true, signature: "Age Check", release: RELEASE_VERSION, ...body } });
  const young = await agree({ adult: false });
  assert.equal(young.status, 400);
  assert.match((await young.json()).error, /18 or older/);
  assert.equal(await env.DB.prepare("SELECT COUNT(*) AS n FROM studio_release WHERE user_id = ?").bind(me.user.id).first("n"), 0);
  assert.equal((await agree({ agree: false, adult: true })).status, 400, "the age box doesn't stand in for the agreement");
  assert.equal((await agree({ adult: true })).status, 200);
  assert.equal((await (await call("GET", "state", { cookie: me.cookie })).json()).release.agreed, true);

  // Agreed to the release before 2026-10-03 (when a guardian could sign): the send form asks again.
  await env.DB.prepare("UPDATE studio_release SET version = '2026-09-29' WHERE user_id = ?").bind(me.user.id).run();
  assert.equal((await (await call("GET", "state", { cookie: me.cookie })).json()).release.agreed, false);
});

test("a narrator uploads before agreeing to the release, which is asked for when sending", async () => {
  const me = await signIn("late-signer");
  const made = await (await call("POST", "voice", { cookie: me.cookie, body: { name: "Late Signer's voice", locale: "enUS" } })).json();
  assert.ok(made.ok, made.error);
  const take = await call("PUT", "take", { cookie: me.cookie, body: mp3(800, 5), query: `?voice=${made.id}&line=zone%3Aelwynn` });
  assert.equal(take.status, 200, "uploading needs no release");
  assert.equal((await call("GET", "pack", { cookie: me.cookie, query: `?voice=${made.id}` })).status, 200, "nor does the test pack");

  const send = () => call("POST", "send", { cookie: me.cookie, body: { voice: made.id, credit: "Late Signer" } });
  const refused = await send();
  assert.equal(refused.status, 403);
  assert.match((await refused.json()).error, /narrator release/);

  assert.equal((await call("POST", "release", { cookie: me.cookie,
    body: { agree: true, adult: true, signature: "Late Signer", release: RELEASE_VERSION } })).status, 200);
  const ok = await send();
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).lines, 1);
  // The review queue names the stories sent, not a count out of every line: voices are partial by design.
  const row = await env.DB.prepare("SELECT clips FROM voice_submissions WHERE voice_id = ?").bind(made.id).first();
  assert.equal(row.clips, "1 line (enUS): Elwynn, uploaded on the site");

  // Signed out: nothing to upload with, but the page can still load its state.
  assert.equal((await call("PUT", "take", { body: mp3(10, 1), query: `?voice=${made.id}&line=zone%3Aelwynn` })).status, 401);
  assert.deepEqual(await (await call("GET", "state")).json(), { ok: true, signedIn: false });
});
