#!/usr/bin/env node
// Smoke test for uploading a zip or kit (LOR-121) on a deployed site (a PR preview, or `wrangler pages dev`). It runs
// the page's own code (public/js/bulk-core.js) under Node, against the real API:
//   1. A zip of 60 named recordings (the default voice's files) lands per line on the upload page, the test pack
//      download has them all byte for byte, and dropping that test pack back shows every line as unchanged.
//   2. The deDE kit, downloaded from the site, with a few strings edited and one against older English, lands as
//      per-string edits (status new) and shows in the deDE test pack; the stale one is skipped.
//
//   LF_SESSION=<lf_session cookie value> node site/tests/smoke-bulk-upload.mjs https://<branch>.lore-forever.pages.dev
//
// Uses the signed-in account of LF_SESSION. Only point it at a preview or a local server: Preview has its own D1 and
// R2, and what this uploads there is disposable. Node 22+. The browser's audio checks don't run here (they need Web
// Audio); the server's checks do.

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { gather, matchVoice, voiceStatus, readKit, kitSections, planKit } from "../public/js/bulk-core.js";
import { openZip } from "../public/js/unzip.js";
import { crc32, crcHex } from "../public/voices/crc32.js";
import { zip } from "../lib/langtest.js";

const BASE = (process.argv[2] || "").replace(/\/$/, "");
const SESSION = process.env.LF_SESSION;
if (!BASE || !SESSION) {
  console.error("usage: LF_SESSION=... node site/tests/smoke-bulk-upload.mjs BASE_URL");
  process.exit(2);
}
const AUDIO = fileURLToPath(new URL("../../addon/LoreForever_Voice_Default/Audio/", import.meta.url));
const FILES = 60;
const headers = (more = {}) => ({ Cookie: `lf_session=${SESSION}`, Origin: BASE, ...more });
const sleep = s => new Promise(r => setTimeout(r, s * 1000));

async function api(path, { method = "GET", body, extra = {} } = {}) {
  for (;;) {
    const json = body !== undefined && !(body instanceof Uint8Array);
    const r = await fetch(BASE + path, { method, headers: headers({ ...(json ? { "Content-Type": "application/json" } : {}), ...extra }),
      body: json ? JSON.stringify(body) : body });
    if (r.status === 429) {
      const b = await r.clone().json().catch(() => ({}));
      if (b.retryAfter) { process.stdout.write(`  (rate limit: waiting ${b.retryAfter} s)\n`); await sleep(b.retryAfter); continue; }
    }
    return r;
  }
}
const getJson = async path => {
  const r = await api(path);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
};
const source = (name, bytes) => { const blob = new Blob([bytes]); return { name, size: blob.size, blob }; };

// ---- 1. Voice zip ----

const state0 = await getJson("/api/studio/state");
assert.ok(state0.signedIn, "LF_SESSION isn't signed in on this site");
if (!state0.release.agreed) {
  await api("/api/studio/release", { method: "POST", body: { agree: true, adult: true, signature: "Smoke Test", release: state0.release.version } });
}
let voice = state0.voices.find(v => v.locale === "enUS")?.id;
if (!voice) voice = (await (await api("/api/studio/voice", { method: "POST", body: { name: "Smoke Test Voice", locale: "enUS" } })).json()).id;
assert.ok(voice, "couldn't make a voice");
console.log(`voice: ${voice}`);

const lines = await (await fetch(`${BASE}/voices/lines.json`)).json();
const items = lines.groups.flatMap(g => g.stories.flatMap(s => s.lines)).map(l => ({ id: l.id, file: l.file, hash: l.hash.enUS || null }));
const names = (await readdir(AUDIO)).filter(n => n.endsWith(".mp3")).sort();
const picked = names.filter(n => items.some(it => it.hash && `${it.file}.mp3` === n)).slice(0, FILES);
assert.ok(picked.length >= 50, `only ${picked.length} recordings match current lines`);
const zipFiles = {};
for (const n of picked) zipFiles[`My recordings/${n}`] = new Uint8Array(await readFile(AUDIO + n));
zipFiles["My recordings/notes.txt"] = "not a recording";

async function dropVoice(name, bytes) {
  const { files } = await gather([source(name, bytes)], "voice");
  const m = await matchVoice(files, items);
  const { takes } = await getJson(`/api/studio/state?voice=${encodeURIComponent(voice)}`);
  const plan = { new: [], replaced: [], unchanged: [] };
  for (const row of m.rows) {
    const buf = (await row.read()).slice().buffer;
    plan[voiceStatus(takes[row.it.id], buf, row.hash)].push({ row, buf });
  }
  return { m, plan };
}

const first = await dropVoice("My recordings.zip", zip(zipFiles));
console.log(`zip: ${first.m.rows.length} recordings, ${first.plan.new.length} new, ${first.plan.replaced.length} replaced, ` +
            `${first.plan.unchanged.length} unchanged, ${first.m.unknown.length} unknown, ${first.m.other} other files`);
assert.equal(first.m.rows.length, picked.length);
let n = 0;
for (const { row, buf } of [...first.plan.new, ...first.plan.replaced]) {
  const bytes = new Uint8Array(buf);
  const r = await api(`/api/studio/take?voice=${encodeURIComponent(voice)}&line=${encodeURIComponent(row.it.id)}`, { method: "PUT", body: bytes,
    extra: { "X-CRC32": crcHex(crc32(bytes)), "X-Text-Hash": row.hash, "X-File-Name": encodeURIComponent(row.path.split("/").pop()), "X-Checks": "%7B%7D" } });
  assert.equal(r.status, 200, `${row.it.id}: ${await r.text()}`);
  if (++n % 10 === 0) console.log(`  saved ${n}`);
}
const { takes } = await getJson(`/api/studio/state?voice=${encodeURIComponent(voice)}`);
for (const n of picked) {
  const it = items.find(i => `${i.file}.mp3` === n);
  assert.equal(takes[it.id]?.crc32, crcHex(crc32(zipFiles[`My recordings/${n}`])), `${it.id} landed`);
}
console.log(`voice: all ${picked.length} lines landed per line`);

const packRes = await api(`/api/studio/pack?voice=${encodeURIComponent(voice)}`);
assert.equal(packRes.status, 200, await packRes.clone().text());
const packBytes = new Uint8Array(await packRes.arrayBuffer());
const pack = await openZip(new Blob([packBytes]));
for (const n of picked) {
  const e = pack.entries.find(x => x.name.endsWith(`/Audio/${n}`));
  assert.ok(e, `${n} is in the test pack`);
  assert.deepEqual(await pack.read(e), zipFiles[`My recordings/${n}`]);
}
console.log(`test pack: ${packRes.headers.get("X-Pack-Lines")} lines, all ${picked.length} uploads byte for byte`);
const back = await dropVoice("LoreForever_Voice_Test.zip", packBytes);
assert.ok(back.m.pack);
assert.equal(back.plan.new.length + back.plan.replaced.length, 0, "the returned pack is all unchanged");
console.log(`returned test pack: ${back.plan.unchanged.length} unchanged, nothing to save`);

// ---- 2. deDE kit ----

const kitZip = new Uint8Array(await (await fetch(`${BASE}/translate/kits/deDE.zip`)).arrayBuffer());
const kitOpen = await openZip(new Blob([kitZip]));
const edited = {};
const changed = [];
let staleId = null;
for (const e of kitOpen.entries) {
  let bytes = await kitOpen.read(e);
  if (/\/(ui|lore\/zones_01)\.json$/.test(e.name)) {
    const rows = JSON.parse(new TextDecoder().decode(bytes));
    let k = 0;
    for (const r of rows) {
      if (!r.en || /[%|"\\\n]/.test(r.en + (r.text || ""))) continue;   // plain text only, so it reads back the same from Lua
      if (k < 3) { r.text = `${r.text || r.en} [Smoke ${Date.now() % 100000}]`; changed.push(r.id); k++; }
      else if (!staleId && e.name.endsWith("zones_01.json")) { r.en = r.en + " (older English)"; r.text = "Veraltet"; staleId = r.id; }
    }
    bytes = new TextEncoder().encode(JSON.stringify(rows, null, 2));
  }
  edited[e.name] = bytes;
}
const { files } = await gather([source("deDE-edited.zip", zip(edited))], "kit");
const kit = await readKit(files);
const entries = await (await fetch(`${BASE}/translate/data/en/entries.json`)).json();
const entrySection = Object.fromEntries(entries);
const english = {}, published = {};
for (const sid of kitSections(kit.rows, entrySection)) {
  for (const [id, en] of (await (await fetch(`${BASE}/translate/data/en/${sid}.json`)).json()).strings) english[id] = en;
  Object.assign(published, await (await fetch(`${BASE}/translate/data/deDE/${sid}.json`)).json().catch(() => ({})));
}
const mine = {};
for (const e of (await getJson("/api/translations/edits?locale=deDE")).edits) if (e.status === "new" || e.status === "accepted") mine[e.string_id] = e.text;
const plan = planKit(kit.rows, { english, published, mine, entrySection });
console.log(`kit: ${plan.new.length} new, ${plan.replaced.length} replaced, ${plan.unchanged.length} unchanged, ` +
            `${plan.stale.length} stale, ${plan.unknown.length} unknown, ${plan.failed.length} failed`);
assert.deepEqual([...plan.new, ...plan.replaced].map(r => r.id).sort(), [...changed].sort());
assert.ok(plan.stale.some(r => r.id === staleId), "the string with older English is skipped");
const rows = [...plan.new, ...plan.replaced];
const res = await api("/api/translations/import", { method: "POST", body: { locale: "deDE", edits: rows.map(({ id, en, text }) => ({ id, en, text })) } });
const body = await res.json();
assert.equal(res.status, 200, JSON.stringify(body));
assert.equal(body.saved, rows.length, JSON.stringify(body.results));
const after = (await getJson("/api/translations/edits?locale=deDE")).edits;
for (const r of rows) assert.ok(after.some(e => e.string_id === r.id && e.text === r.text && e.status === "new"), `${r.id} saved as an edit`);
console.log(`kit: ${rows.length} strings landed as edits (status new)`);

const tp = await api("/api/translations/pack?locale=deDE");
assert.equal(tp.status, 200, await tp.clone().text());
const tz = await openZip(new Blob([await tp.arrayBuffer()]));
let lua = "";
for (const e of tz.entries.filter(e => e.name.endsWith(".lua"))) lua += new TextDecoder().decode(await tz.read(e));
for (const r of rows) assert.ok(lua.includes(r.text), `${r.id} is in the test pack`);
console.log(`deDE test pack: ${tp.headers.get("X-Strings-Included")} strings, including all ${rows.length} uploaded`);
console.log("ok");
