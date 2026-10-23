import { test } from "node:test";
import assert from "node:assert/strict";
import { assetRef, voiceBlock } from "../lib/downloads.js";

test("asset lookup uses exact official release filenames", () => {
  assert.equal(assetRef("/download/complete"), "latest:LoreForever.zip");
  assert.equal(assetRef("https://github.com/mliudev/LoreForever/releases/download/v0.8.0/Voice%20Pack.zip"), "v0.8.0:Voice Pack.zip");
  for (const bad of ["https://evil.test/releases/latest/download/file.zip", "https://github.com/other/repo/releases/latest/download/file.zip", "https://github.com/mliudev/LoreForever/releases/latest/download/%ZZ", "/download/voice/a", "javascript:alert(1)"]) assert.equal(assetRef(bad), "");
});

test("generic community voices stay catalog driven and reject unsafe content", () => {
  const v = { id: "donated-voice", name: '<img src=x onerror="bad">', language: "New language", status: "live", credit: "A & B", clips: 4, download: "https://example.com/a.zip", sample: { src: "javascript:bad" }, packs: [
    { id: "new-pack", name: "New <pack>", language: "New language", clips: 2, download: "https://example.com/pack.zip", coverage: "<script>bad</script>", curseforge: "javascript:bad" },
    { id: 'bad" onclick="bad', name: "unsafe", download: "/download/zip" },
    { id: "unreleased-pack", name: "secret", status: "draft", download: "/download/zip" },
    { id: "bad-download", name: "unsafe", download: "javascript:bad" }
  ] };
  const html = voiceBlock(v);
  assert.equal((html.match(/<tr /g) || []).length, 1);
  assert.match(html, /data-voice="donated-voice"/); assert.match(html, /data-language="New language"/);
  assert.match(html, /&lt;img src=x onerror=&quot;bad&quot;&gt;/); assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /aria-label="Download/);
  assert.doesNotMatch(html, /<img|<script|javascript:|unreleased-pack|bad-download|onclick=/);
  assert.equal(voiceBlock({ ...v, id: 'invalid"' }), "");
});
