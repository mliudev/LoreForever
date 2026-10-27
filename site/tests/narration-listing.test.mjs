// The admin recordings listing (GET /api/admin/narration/audio, what scripts/upload-narration-r2.sh reads before every
// batch). Production had ~80,000 recordings, ~85 R2 list calls per request, and one flaky R2 call turned the whole request
// into an HTTP 500 about 1 time in 3 (10/26). Only R2 is faked, as a bucket that lists the way R2 does and can be told to fail.
import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/admin/narration/[action].js";

// Names a recording by voice and number: "<voice>/<stem>-<10 hex>.mp3".
const name = (voice, i) => `${voice}/zone_${i}-${i.toString(16).padStart(10, "0")}.mp3`;
function fakeBucket(keys, { failEvery = 0, failAlways = false } = {}) {
  const sorted = ["narration/manifest.json", ...keys.map(k => `narration/${k}`), "narration/notes.txt"].sort();
  const stats = { lists: 0, failed: 0 };
  return {
    stats,
    async list({ prefix = "", delimiter, cursor, limit = 1000 } = {}) {
      stats.lists++;
      if (failAlways || (failEvery && stats.lists % failEvery === 0)) { stats.failed++; throw new Error("internal error; reference = 10001"); }
      const names = sorted.filter(k => k.startsWith(prefix));
      const folders = new Set(), rows = [];
      for (const k of names) {
        const slash = delimiter ? k.indexOf(delimiter, prefix.length) : -1;
        if (slash < 0) rows.push({ key: k }); else folders.add(k.slice(0, slash + 1));
      }
      const all = [...rows, ...[...folders].map(f => ({ folder: f }))].sort((a, b) => (a.key ?? a.folder).localeCompare(b.key ?? b.folder));
      const from = Number(cursor || 0), page = all.slice(from, from + limit);
      return { objects: page.filter(r => r.key), delimitedPrefixes: page.filter(r => r.folder).map(r => r.folder),
        truncated: from + limit < all.length, cursor: String(from + limit) };
    },
  };
}

const recordings = [
  ...Array.from({ length: 2300 }, (_, i) => name("male-narrator", i)),   // more than one 1000-key page
  ...Array.from({ length: 1000 }, (_, i) => name("female-narrator", i)),   // exactly one full page
  ...Array.from({ length: 40 }, (_, i) => name("male-narrator-de", i)),
  ...Array.from({ length: 3 }, (_, i) => name("voice-questgivers", i)),
];
const list = (bucket, method = "GET", action = "audio") => onRequest({
  request: new Request(`https://loreforeverwow.com/api/admin/narration/${action}`, { method, headers: { Authorization: "Bearer k" } }),
  env: { STUDIO: bucket, ADMIN_KEY: "k" }, params: { action }, wait: async () => {} });

test("the listing returns every recording across voices and pages, and nothing else in the bucket", async () => {
  const res = await list(fakeBucket(recordings));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).keys, [...recordings].sort());
});

test("a flaky R2 call is retried: the listing still answers 200 with every recording", async () => {
  const bucket = fakeBucket(recordings, { failEvery: 3 });   // one list call in three fails, as a long walk would meet
  const res = await list(bucket);
  assert.ok(bucket.stats.failed > 0, "the stand-in did fail");
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).keys, [...recordings].sort());
});

test("the manifest lists the same recordings through the same retries", async () => {
  const bucket = fakeBucket(recordings, { failEvery: 4 });
  const puts = [];
  bucket.put = async (key, body) => { puts.push([key, JSON.parse(body)]); };
  const res = await list(bucket, "POST", "manifest");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).files, recordings.length);
  assert.deepEqual(puts[0][1].keys, [...recordings].sort());
});

test("R2 down for good is a 503 with Retry-After (the uploader waits and retries), never a 500", async () => {
  const res = await list(fakeBucket(recordings, { failAlways: true }));
  assert.equal(res.status, 503);
  assert.ok(Number(res.headers.get("Retry-After")) > 0);
  assert.equal((await res.json()).ok, false);
});
