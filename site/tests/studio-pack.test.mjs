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
const ogg = n => Uint8Array.from([0x4f, 0x67, 0x67, 0x53, ...Array.from({ length: n }, (_, i) => i & 0xff)]);
const wav = Uint8Array.from([..."RIFF"].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WAVE"].map(c => c.charCodeAt(0)), [0, 0, 0, 0]));

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
  const refused = await put("zone:durotar", wav);
  assert.equal(refused.status, 415);
  assert.match((await refused.json()).error, /turns \.wav and \.flac into \.mp3/);
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
