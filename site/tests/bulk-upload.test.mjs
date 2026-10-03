// Uploading a zip, folder or kit (LOR-121): the zip reader and its limits, matching files to lines, the preview's
// sorting, and both uploads end to end through the real Functions, round-tripping through the LOR-119 test packs.
// D1 is node:sqlite and R2 is in memory (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { openZip, ZipError } from "../public/js/unzip.js";
import { gather, parseClips, matchVoice, voiceStatus, readKit, kitSections, planKit, normalize } from "../public/js/bulk-core.js";
import { onRequest as studio } from "../functions/api/studio/[action].js";
import { onRequest as translations } from "../functions/api/translations/[action].js";
import { findOrCreateUser, startSession, setup } from "../lib/accounts.js";
import { RELEASE_VERSION } from "../lib/submissions.js";
import { perMinute } from "../lib/ratelimit.js";
import { crc32, crcHex } from "../public/voices/crc32.js";
import { d1, r2, assets } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const enc = new TextEncoder();
const DB = d1();   // one database for the file: lib/accounts.js creates its tables once per process

// A zip with deflated (or stored) entries. lie: {name: size} declares a wrong uncompressed size; badCrc: [names].
function makeZip(files, { store = false, lie = {}, badCrc = [] } = {}) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const raw = typeof data === "string" ? enc.encode(data) : data;
    const packed = store ? raw : new Uint8Array(deflateRawSync(raw));
    const n = enc.encode(name), crc = badCrc.includes(name) ? 1 : crc32(raw), size = lie[name] ?? raw.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x800, true);
    local.setUint16(8, store ? 0 : 8, true); local.setUint32(14, crc, true); local.setUint32(18, packed.length, true);
    local.setUint32(22, size, true); local.setUint16(26, n.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint16(10, store ? 0 : 8, true); c.setUint32(16, crc, true); c.setUint32(20, packed.length, true);
    c.setUint32(24, size, true); c.setUint16(28, n.length, true); c.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), n, packed);
    central.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + packed.length;
  }
  const dirSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, Object.keys(files).length, true); end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, dirSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)]);
}
const source = (name, blob) => ({ name, size: blob.size, blob });

// ---- The zip reader ----

test("openZip reads stored and deflated entries and checks them", async () => {
  for (const store of [false, true]) {
    const zip = await openZip(makeZip({ "Voice/zone_a.mp3": "ID3 one", "Voice/sub/": "", "Voice/Clips.lua": "c[\"x\"] = \"ab\"" }, { store }));
    assert.deepEqual(zip.entries.map(e => e.name), ["Voice/zone_a.mp3", "Voice/Clips.lua"]);   // folders skipped
    assert.equal(new TextDecoder().decode(await zip.read(zip.entries[0])), "ID3 one");
  }
  const bad = await openZip(makeZip({ "a.json": "[1,2,3]" }, { badCrc: ["a.json"] }));
  await assert.rejects(bad.read(bad.entries[0]), ZipError);
});

test("openZip refuses zip bombs, too many files and damaged zips", async () => {
  const big = new Uint8Array(4 * 1024 * 1024);   // 4 MB of zeros deflates about 1000:1
  await assert.rejects(openZip(makeZip({ "bomb.wav": big })), /expands far more/);
  await assert.rejects(openZip(makeZip({ "a.mp3": "x", "b.mp3": "y", "c.mp3": "z" }), { maxFiles: 2 }), /at most 2/);
  await assert.rejects(openZip(makeZip({ "a.mp3": big }, { store: true }), { maxBytes: 1024 * 1024 }), /more than 1 MB/);
  await assert.rejects(openZip(new Blob([enc.encode("not a zip at all")])), /isn't a zip/);
  // A directory that understates the size: inflating stops at the declared size.
  const liar = await openZip(makeZip({ "small.json": "x".repeat(5000) }, { lie: { "small.json": 100 } }));
  await assert.rejects(liar.read(liar.entries[0]), /bigger than the zip says/);
});

test("gather opens zips, skips system junk and keeps to the limits", async () => {
  const zip = makeZip({ "__MACOSX/._a.mp3": "x", "Voice/.DS_Store": "x", "Voice/zone_a.mp3": "ID3", "inner.zip": "PK" });
  const { files, ignored } = await gather([source("voice.zip", zip), source("loose/zone_b.wav", new Blob(["RIFF"]))], "voice");
  assert.deepEqual(files.map(f => f.path), ["Voice/zone_a.mp3", "loose/zone_b.wav"]);
  assert.deepEqual(ignored.map(i => i.why), ["a zip inside a zip"]);
  const many = Array.from({ length: 501 }, (_, i) => source(`k/${i}.json`, new Blob(["[]"])));
  await assert.rejects(gather(many, "kit"), /more than 500 files/);
});

// ---- Voices: matching files to lines ----

const line = (id, file, hash) => ({ id, file, text: { enUS: `Text of ${id}.` }, hash: { enUS: hash }, hints: { enUS: [] } });

test("parseClips reads only c[\"id\"] = \"hash\" lines", () => {
  const lua = [
    "-- Generated by pipeline/lore/voicepack.py - do not edit by hand.", "local P = LoreForeverPacks.Begin(...)",
    'c["zone:stormwind"] = "A1B2C3"', 'c["odd\\"id\\\\x"] = "0f0f0f"', 'c["zone:x"] = os.execute("rm")', 'c[ "y" ]="abc";',
    'P.ext = "ogg"', 'c["no-hash"] = "not hex"',
  ].join("\r\n");
  assert.deepEqual(parseClips(lua), { "zone:stormwind": "a1b2c3", 'odd"id\\x': "0f0f0f", y: "abc" });
});

test("matchVoice sorts files into lines, unknown names and older text", async () => {
  const items = [
    { id: "zone:stormwind", file: "zone_stormwind", hash: "aaa001" },
    { id: "zone:stormwind#faq3", file: "zone_stormwind__faq3", hash: "aaa002" },
    { id: "zone:elwynn", file: "zone_elwynn", hash: "aaa003" },
    { id: "zone:durotar", file: "zone_durotar", hash: null },   // no text in this language
  ];
  const f = (path, size = 10) => ({ path, size, read: async () => enc.encode(path.endsWith(".lua") ? 'c["zone:elwynn"] = "0dd999"\nc["zone:stormwind"] = "aaa001"' : "ID3") });
  const m = await matchVoice([
    f("Pack/Audio/Zone_Stormwind.mp3"), f("Pack/Audio/zone_stormwind__faq3.WAV"), f("Pack/Audio/zone_elwynn.mp3"),
    f("Pack/Audio/zone_durotar.mp3"), f("zone_stormwnd__faq3.ogg"), f("zone_stormwind.ogg"), f("Pack/Clips.lua"), f("Pack/Pack.toc"),
  ], items);
  assert.deepEqual(m.rows.map(r => [r.it.id, r.hash]), [["zone:stormwind", "aaa001"], ["zone:stormwind#faq3", "aaa002"]]);
  assert.deepEqual(m.stale.map(r => r.it.id), ["zone:elwynn"]);
  assert.deepEqual(m.unknown.map(u => [u.path, u.why, u.suggest || null]), [
    ["Pack/Audio/zone_durotar.mp3", "notext", null],
    ["zone_stormwnd__faq3.ogg", "name", "zone_stormwind__faq3"],
    ["zone_stormwind.ogg", "twice", null],
  ]);
  assert.equal(m.other, 2);
  assert.ok(m.pack);

  // Phone and browser recordings (.m4a, .webm, .opus) count as recordings too; the page converts them.
  const phone = await matchVoice([f("Voice Memos/zone_elwynn.m4a"), f("zone_stormwind.webm"), f("zone_stormwind__faq3.opus")],
    items.map(it => ({ ...it, hash: it.hash && "aaa" })));
  assert.deepEqual(phone.rows.map(r => r.it.id), ["zone:elwynn", "zone:stormwind", "zone:stormwind#faq3"]);
  assert.equal(phone.other, 0);
});

test("voiceStatus: new, replaced, unchanged", () => {
  const buf = enc.encode("ID3 same bytes").buffer;
  assert.equal(voiceStatus(null, buf, "h1"), "new");
  assert.equal(voiceStatus({ hash: "h1", crc32: crcHex(crc32(new Uint8Array(buf))) }, buf, "h1"), "unchanged");
  assert.equal(voiceStatus({ hash: "h0", crc32: crcHex(crc32(new Uint8Array(buf))) }, buf, "h1"), "replaced");
  assert.equal(voiceStatus({ hash: "h1", crc32: null }, buf, "h1"), "replaced");
});

// ---- Kits ----

const entrySection = { "npc:hogger": "npcs_01", "zone:elwynn": "zones_01", ui: "ui" };
const english = {
  "ui/0123456789": "Zone hints", "ui/abcdef0123": "%d lines", "npc:hogger/n": "Hogger", "npc:hogger/s": "Hogger is a gnoll.",
  "npc:hogger/kw": "hogger | gnoll", "zone:elwynn/n": "Elwynn Forest", "zone:elwynn/s": "A forest.",
};

test("readKit and planKit follow kit.py apply_strings", async () => {
  const rows = [
    { id: "ui/0123456789", en: "Zone hints", text: "Zonenhinweise" },                 // new
    { id: "ui/abcdef0123", en: "%d lines", text: "%s Zeilen" },                       // failed: % codes
    { id: "npc:hogger/n", en: "Hogger", text: "Hogger" },                             // unchanged (same as now)
    { id: "npc:hogger/s", en: "Hogger is a gnoll.", text: "Hogger ist ein Gnoll." },   // replaced (published text)
    { id: "npc:hogger/kw", en: "hogger | gnoll", text: " gnoll|hogger | gnoll " },     // replaced, list normalized
    { id: "zone:elwynn/n", en: "Elwynn (old English)", text: "Wald von Elwynn" },      // stale
    { id: "zone:elwynn/s", en: "A forest.", text: "Mein Wald." },                      // unchanged: your saved edit
    { id: "npc:gone/n", en: "Gone", text: "Weg" },                                     // stale: no such entry
    { id: "BAD ID", en: "x", text: "y" },                                              // unknown
    { id: "zone:elwynn/sec/1/t", en: "Title", text: "" },                              // empty
  ];
  const files = [
    { path: "LoreForever-translation-deDE/kit.json", size: 1, read: async () => enc.encode('{"format":1,"locale":"deDE","english":"v1"}') },
    { path: "LoreForever-translation-deDE/lore/npcs_01.json", size: 1, read: async () => enc.encode("﻿" + JSON.stringify(rows)) },
    { path: "LoreForever-translation-deDE/reference/glossary.json", size: 1, read: async () => enc.encode("{}") },
    { path: "LoreForever-translation-deDE/lore/broken.json", size: 1, read: async () => enc.encode("[{") },
    // Saved as Windows-1252 ("Grüße"): refused whole, like kit.py, instead of saving "Gr??e".
    { path: "LoreForever-translation-deDE/lore/latin1.json", size: 1,
      read: async () => Uint8Array.from([...enc.encode('[{"id":"npc:hogger/n","en":"Hogger","text":"Gr'), 0xfc, 0xdf, ...enc.encode('e"}]')]) },
    { path: "LoreForever-translation-deDE/README.txt", size: 1, read: async () => enc.encode("hi") },
    { path: "LoreForever_LangTest_deDE/UI.lua", size: 1, read: async () => { throw new Error("must not be read"); } },
  ];
  const kit = await readKit(files);
  assert.equal(kit.meta.locale, "deDE");
  assert.equal(kit.rows.size, rows.length);
  assert.ok(kit.langtest);
  assert.equal(kit.other, 1);
  assert.deepEqual(kit.problems.map(p => p.path), ["LoreForever-translation-deDE/lore/broken.json", "LoreForever-translation-deDE/lore/latin1.json"]);
  assert.match(kit.problems[1].why, /UTF-8/);
  assert.deepEqual(kitSections(kit.rows, entrySection).sort(), ["npcs_01", "ui", "zones_01"]);

  const p = planKit(kit.rows, {
    english, entrySection,
    published: { "npc:hogger/n": "Hogger", "npc:hogger/s": "Hogger ist ein Gnoll", "npc:hogger/kw": "hogger" },
    mine: { "zone:elwynn/s": "Mein Wald." },
  });
  const ids = k => p[k].map(r => r.id);
  assert.deepEqual(ids("new"), ["ui/0123456789"]);
  assert.deepEqual(ids("replaced"), ["npc:hogger/s", "npc:hogger/kw"]);
  assert.deepEqual(ids("unchanged"), ["npc:hogger/n", "zone:elwynn/s"]);
  assert.deepEqual(ids("stale"), ["zone:elwynn/n", "npc:gone/n"]);
  assert.deepEqual(ids("unknown"), ["BAD ID"]);
  assert.deepEqual(ids("failed"), ["ui/abcdef0123"]);
  assert.equal(p.empty, 1);
  assert.equal(p.replaced[1].text, "gnoll | hogger");
  assert.equal(normalize("npc:hogger/faq/2/al", "a|b| a "), "a | b");
});

// ---- End to end through the Functions ----

async function signIn(env, sub) {
  await setup(env);
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: sub });
  const set = await startSession(env, new Request(ORIGIN), user.id);
  return { user, cookie: set.split(";")[0] };
}

function caller(onRequest, base, env) {
  return async (method, action, { cookie, query = "", body, headers = {} } = {}) => {
    const h = new Headers(headers);
    if (cookie) h.set("Cookie", cookie);
    if (method !== "GET") h.set("Origin", ORIGIN);
    let payload = body;
    if (body && !(body instanceof Uint8Array)) { h.set("Content-Type", "application/json"); payload = JSON.stringify(body); }
    const request = new Request(`${ORIGIN}${base}${action}${query}`, { method, headers: h, body: payload });
    return onRequest({ request, env, params: { action }, waitUntil: () => {} });
  };
}

test("a 55-file voice zip lands per line and round-trips through the test pack", async () => {
  const N = 55;
  const ids = Array.from({ length: N }, (_, i) => (i === 0 ? "zone:stormwind" : `zone:stormwind#faq${i}`));
  const LINES = { languages: [{ locale: "enUS", name: "English", draft: false, lines: N }], groups: [{ name: "Capitals", stories: [
    { key: "zone:stormwind", name: { enUS: "Stormwind" }, voice: "human",
      lines: ids.map((id, i) => line(id, i ? `zone_stormwind__faq${i}` : "zone_stormwind", `a${String(i).padStart(5, "0")}`)) },
  ] }] };
  const env = { DB, STUDIO: r2(), ASSETS: assets({ "/voices/lines.json": LINES }) };
  const call = caller(studio, "/api/studio/", env);
  const me = await signIn(env, "zip-narrator");
  await call("POST", "release", { cookie: me.cookie, body: { agree: true, adult: true, signature: "Zip Narrator", release: RELEASE_VERSION } });
  const voice = (await (await call("POST", "voice", { cookie: me.cookie, body: { name: "Zip Voice", locale: "enUS" } })).json()).id;
  const items = LINES.groups[0].stories[0].lines.map(l => ({ id: l.id, file: l.file, hash: l.hash.enUS }));
  const audio = i => Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, ...Array.from({ length: 200 + i }, (_, j) => (i * 31 + j) & 0xff)]);
  const zipFiles = Object.fromEntries(items.map((it, i) => [`My takes/${it.file}.mp3`, audio(i)]));
  zipFiles["My takes/notes.txt"] = "my notes";

  // What the page does: gather, match, compare with the takes, then PUT each new line.
  const upload = async (blob, name) => {
    const { files } = await gather([source(name, blob)], "voice");
    const m = await matchVoice(files, items);
    const takes = (await (await call("GET", "state", { cookie: me.cookie, query: `?voice=${voice}` })).json()).takes;
    const plan = { new: [], replaced: [], unchanged: [] };
    for (const row of m.rows) {
      const buf = (await row.read()).slice().buffer;
      plan[voiceStatus(takes[row.it.id], buf, row.hash)].push({ row, buf });
    }
    for (const { row, buf } of [...plan.new, ...plan.replaced]) {
      for (;;) {
        const res = await call("PUT", "take", { cookie: me.cookie, body: new Uint8Array(buf), query: `?voice=${voice}&line=${encodeURIComponent(row.it.id)}`,
          headers: { "X-CRC32": crcHex(crc32(new Uint8Array(buf))), "X-Text-Hash": row.hash, "X-File-Name": row.path.split("/").pop() } });
        if (res.status === 429) {   // the per-minute limit: the page waits; here, move the clock on
          const body = await res.json();
          assert.ok(body.retryAfter > 0);
          env.DB.sqlite.exec("DELETE FROM rate_limits");
          continue;
        }
        assert.equal(res.status, 200, await res.text());
        break;
      }
    }
    return { m, plan };
  };

  const first = await upload(makeZip(zipFiles), "my takes.zip");
  assert.equal(first.plan.new.length, N);
  assert.equal(first.m.other, 1);
  const state = await (await call("GET", "state", { cookie: me.cookie, query: `?voice=${voice}` })).json();
  assert.equal(Object.keys(state.takes).length, N);
  assert.equal(state.takes["zone:stormwind#faq7"].crc32, crcHex(crc32(audio(7))));

  // The test pack comes back as a zip: every line is there and unchanged.
  const pack = await call("GET", "pack", { cookie: me.cookie, query: `?voice=${voice}` });
  assert.equal(pack.headers.get("X-Pack-Lines"), String(N));
  const packBlob = new Blob([await pack.arrayBuffer()]);
  const zip = await openZip(packBlob);
  assert.equal(zip.entries.filter(e => e.name.includes("/Audio/")).length, N);
  const again = await upload(packBlob, "LoreForever_Voice_TestZipVoice.zip");
  assert.ok(again.m.pack);
  assert.equal(again.plan.unchanged.length, N);
  assert.equal(again.plan.new.length + again.plan.replaced.length, 0);

  // Reword a line: the returned pack's Clips.lua still has the old hash, so that file is "older text", and the server
  // refuses it too.
  LINES.groups[0].stories[0].lines[3].hash.enUS = "b00003";
  items[3].hash = "b00003";
  const third = await upload(packBlob, "pack.zip");
  assert.deepEqual(third.m.stale.map(s => s.it.id), [ids[3]]);
  const refused = await call("PUT", "take", { cookie: me.cookie, body: audio(3), query: `?voice=${voice}&line=${encodeURIComponent(ids[3])}`,
    headers: { "X-Text-Hash": "a00003" } });
  assert.equal(refused.status, 409);
});

test("perMinute counts per user and scope and forgets old minutes", async () => {
  const env = { DB };
  await setup(env);
  const t = new Date("2026-10-01T12:00:10Z");
  for (let i = 0; i < 3; i++) assert.ok(await perMinute(env, "u1", "s", 3, t));
  assert.equal(await perMinute(env, "u1", "s", 3, t), false);
  assert.ok(await perMinute(env, "u2", "s", 3, t));
  assert.ok(await perMinute(env, "u1", "other", 3, t));
  assert.ok(await perMinute(env, "u1", "s", 3, new Date("2026-10-01T12:01:00Z")));
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE user_id = 'u1' AND bucket LIKE 's:%'").get().n, 1);
});

test("an edited deDE kit lands as per-string edits and round-trips through the test pack", async () => {
  const fp = { english: "v1", interface: "16001", version: "0.5.0", languages: { deDE: { name: "Deutsch", ttsVoices: "" } },
    entries: { "npc:hogger": ["10,20", "npcs_01"], "zone:elwynn": ["5,6", "zones_01"] } };
  const data = {
    "/translate/fp.json": fp,
    "/translate/data/en/ui.json": { names: {}, strings: [["ui/0123456789", "Zone hints"], ["ui/abcdef0123", "%d lines"]] },
    "/translate/data/en/npcs_01.json": { names: { "npc:hogger": "Hogger" }, strings: [["npc:hogger/n", "Hogger"], ["npc:hogger/s", "Hogger is a gnoll."]] },
    "/translate/data/en/zones_01.json": { names: {}, strings: [["zone:elwynn/n", "Elwynn Forest"]] },
  };
  const env = { DB, ASSETS: assets(data) };
  const call = caller(translations, "/api/translations/", env);
  const me = await signIn(env, "kit-translator");

  // The kit as downloaded, then edited: two filled in, one changed, one against older English.
  const kitZip = makeZip({
    "LoreForever-translation-deDE/kit.json": JSON.stringify({ format: 1, locale: "deDE", english: "v0" }),
    "LoreForever-translation-deDE/ui.json": JSON.stringify([
      { id: "ui/0123456789", en: "Zone hints", text: "Zonenhinweise" }, { id: "ui/abcdef0123", en: "%d lines", text: "" }]),
    "LoreForever-translation-deDE/lore/npcs_01.json": JSON.stringify([
      { id: "npc:hogger/n", en: "Hogger", text: "Hogger" }, { id: "npc:hogger/s", en: "Hogger is a gnoll.", text: "Hogger ist ein Gnoll." }]),
    "LoreForever-translation-deDE/lore/zones_01.json": JSON.stringify([{ id: "zone:elwynn/n", en: "Elwynn", text: "Wald von Elwynn" }]),
  });
  const { files } = await gather([source("deDE-edited.zip", kitZip)], "kit");
  const kit = await readKit(files);
  const english = {}, published = { "npc:hogger/n": "Hogger" };
  for (const sid of kitSections(kit.rows, { "npc:hogger": "npcs_01", "zone:elwynn": "zones_01", ui: "ui" })) {
    for (const [id, en] of data[`/translate/data/en/${sid}.json`].strings) english[id] = en;
  }
  const plan = planKit(kit.rows, { english, published, mine: {}, entrySection: { "npc:hogger": "npcs_01", "zone:elwynn": "zones_01" } });
  assert.deepEqual(plan.new.map(r => r.id), ["ui/0123456789", "npc:hogger/s"]);
  assert.deepEqual(plan.stale.map(r => r.id), ["zone:elwynn/n"]);

  const res = await call("POST", "import", { cookie: me.cookie, body: { locale: "deDE",
    edits: [...plan.new.map(({ id, en, text }) => ({ id, en, text })), { id: "ui/abcdef0123", en: "%d lines", text: "%s Zeilen" }] } });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.saved, 2);
  assert.match(body.results.find(r => r.id === "ui/abcdef0123").error, /% codes/);
  const rows = env.DB.sqlite.prepare("SELECT string_id, text, status FROM translation_edits ORDER BY id").all().map(r => ({ ...r }));
  assert.deepEqual(rows, [
    { string_id: "ui/0123456789", text: "Zonenhinweise", status: "new" },
    { string_id: "npc:hogger/s", text: "Hogger ist ein Gnoll.", status: "new" },
  ]);

  // Importing again replaces your waiting edit instead of adding a second one.
  await call("POST", "import", { cookie: me.cookie, body: { locale: "deDE", edits: [{ id: "npc:hogger/s", en: "Hogger is a gnoll.", text: "Hogger ist ein Gnoll!" }] } });
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM translation_edits").get().n, 2);

  // They're in the test pack.
  const pack = await call("GET", "pack", { cookie: me.cookie, query: "?locale=deDE" });
  assert.equal(pack.status, 200);
  assert.equal(pack.headers.get("X-Strings-Included"), "2");
  const zip = await openZip(new Blob([await pack.arrayBuffer()]));
  const read = async name => new TextDecoder().decode(await zip.read(zip.entries.find(e => e.name.endsWith(name))));
  assert.match(await read("/UI.lua"), /Zonenhinweise/);
  assert.match(await read("/Strings_1.lua"), /Hogger ist ein Gnoll!/);

  // The returned test pack is recognized and not read.
  const back = await readKit((await gather([source("LoreForever_LangTest_deDE.zip", new Blob([await (await call("GET", "pack", { cookie: me.cookie, query: "?locale=deDE" })).arrayBuffer()]))], "kit")).files);
  assert.ok(back.langtest);
  assert.equal(back.rows.size, 0);

  // Limits: batch size, signed out, other origins, and the per-minute limit.
  assert.equal((await call("POST", "import", { cookie: me.cookie, body: { locale: "deDE", edits: [] } })).status, 400);
  assert.equal((await call("POST", "import", { body: { locale: "deDE", edits: [{ id: "ui/0123456789", en: "Zone hints", text: "x" }] } })).status, 401);
  let limited = null;
  for (let i = 0; i < 25 && !limited; i++) {
    const r = await call("POST", "import", { cookie: me.cookie, body: { locale: "deDE", edits: [{ id: "ui/0123456789", en: "Zone hints", text: `Z${i}` }] } });
    if (r.status === 429) limited = await r.json();
  }
  assert.ok(limited && limited.retryAfter > 0, "the per-minute limit kicks in");
});
