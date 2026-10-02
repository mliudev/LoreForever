// The test pack's pieces: the TOC and Clips.lua against voicepack.py's fixtures, the choice of lines, the folder name,
// CRC-32 and the zip writer. Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { renderToc, renderClips, INTERFACE } from "../lib/voicepack.js";
import { planPack, packFolder, packName } from "../public/voices/testpack.js";
import { crc32, crcHex } from "../public/voices/crc32.js";
import { zipStream, zipLength } from "../lib/zip.js";
import { SITE, ROOT, unzip } from "./helpers.mjs";

const FIX = join(SITE, "tests", "fixtures");

test("TOC and Clips.lua are byte for byte what voicepack.py writes", async () => {
  const cases = JSON.parse(await readFile(join(FIX, "voicepack.json"), "utf8"));
  for (const c of cases.toc) assert.equal(renderToc(c.args), await readFile(join(FIX, c.name), "utf8"), c.name);
  for (const c of cases.clips) assert.equal(renderClips(c.hashes, c.ext), await readFile(join(FIX, c.name), "utf8"), c.name);
});

test("the pack's Interface matches the core add-on", async () => {
  const toc = await readFile(join(ROOT, "addon", "LoreForever", "LoreForever.toc"), "utf8");
  assert.equal(INTERFACE, toc.match(/^## Interface:\s*(\S+)/m)[1]);
});

test("planPack: current takes only, one format, majority wins, mp3 on a tie", () => {
  const current = { a: "h1", b: "h2", c: "h3", d: "h4", e: "h5" };
  let p = planPack({ a: { ext: "mp3", hash: "h1" }, b: { ext: "ogg", hash: "h2" }, c: { ext: "mp3", hash: "old" },
                     z: { ext: "mp3", hash: "gone" } }, current);
  assert.deepEqual(p, { ext: "mp3", lines: ["a"], stale: ["c"], otherFormat: ["b"] });
  p = planPack({ a: { ext: "ogg", hash: "h1" }, b: { ext: "ogg", hash: "h2" }, d: { ext: "mp3", hash: "h4" },
                 e: { ext: "wav", hash: "h5" } }, current);
  assert.deepEqual(p, { ext: "ogg", lines: ["a", "b"], stale: [], otherFormat: ["d", "e"] });
  assert.deepEqual(planPack({}, current), { ext: "mp3", lines: [], stale: [], otherFormat: [] });
});

test("the folder is stable and never one of our own packs", () => {
  assert.equal(packName("tales-of-the-east-2"), "TalesOfTheEast2");   // same as voicepack._pack_name
  assert.equal(packFolder("tales-of-the-east-2"), "LoreForever_Voice_TestTalesOfTheEast2");
  for (const id of ["default", "female", "cast", "Default"]) {
    assert.ok(!["LoreForever_Voice_Default", "LoreForever_Voice_Female", "LoreForever_Voice_Cast"].includes(packFolder(id)));
    assert.ok(!packFolder(id).startsWith("LoreForever_Voice_Default"));   // Voice.lua treats that prefix as ours
  }
  assert.equal(packFolder("---"), "LoreForever_Voice_TestStudio");
});

test("crc32", () => {
  const bytes = new TextEncoder().encode("123456789");
  assert.equal(crc32(bytes), 0xcbf43926);
  assert.equal(crc32(bytes.subarray(4), crc32(bytes.subarray(0, 4))), 0xcbf43926);
  assert.equal(crcHex(0x0000beef), "0000beef");
});

async function collect(stream) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function streamOf(bytes, chunk = 5) {
  let i = 0;
  return new ReadableStream({ pull(c) { if (i >= bytes.length) c.close(); else { c.enqueue(bytes.slice(i, i + chunk)); i += chunk; } } });
}

test("zip: known and deferred CRCs, exact length, readable by Python's zipfile", async () => {
  const a = new TextEncoder().encode("hello audio ".repeat(50)), b = new Uint8Array(1000).map((_, i) => i % 251);
  const saved = [];
  const entries = [
    { name: "P/P.toc", data: new TextEncoder().encode("## Title: x\n") },
    { name: "P/Audio/a.mp3", size: a.length, crc: crc32(a), open: async () => streamOf(a) },
    { name: "P/Audio/b.mp3", size: b.length, crc: null, open: async () => streamOf(b, 64), onCrc: c => saved.push(c) },
  ];
  const zip = await collect(zipStream(entries, new Date("2026-10-01T18:30:42Z")));
  assert.equal(zip.length, zipLength(entries));
  assert.deepEqual(saved, [crc32(b)]);
  const files = unzip(zip);
  assert.deepEqual(files.map(f => [f.name, f.descriptor]), [["P/P.toc", false], ["P/Audio/a.mp3", false], ["P/Audio/b.mp3", true]]);
  assert.deepEqual(files[2].data, b);

  const dir = mkdtempSync(join(tmpdir(), "lf-zip-"));
  try {
    writeFileSync(join(dir, "p.zip"), zip);
    const py = execFileSync("python3", ["-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;" +
      "z.extractall(sys.argv[2]);print(z.getinfo('P/Audio/b.mp3').date_time)", join(dir, "p.zip"), join(dir, "out")],
      { encoding: "utf8" });
    assert.equal(py.trim(), "(2026, 10, 1, 18, 30, 42)");
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, "out", "P", "Audio", "a.mp3"))), a);
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, "out", "P", "Audio", "b.mp3"))), b);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("zip: a file whose size changed fails the stream instead of writing a broken zip", async () => {
  const entries = [{ name: "x", size: 10, crc: 0, open: async () => streamOf(new Uint8Array(9)) }];
  await assert.rejects(collect(zipStream(entries)), /expected 10 bytes/);
});
