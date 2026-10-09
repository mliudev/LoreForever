import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assetRef, voiceChoices, voiceBlock, voicesSection, languagesSection } from "../lib/downloads.js";
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const voices = JSON.parse(read("./fixtures/download-catalog/voices.json")).voices;
const packs = JSON.parse(read("./fixtures/download-catalog/packs.json")).packs;

test("asset lookup uses exact official release filenames", () => {
  assert.equal(assetRef("/download/complete"), "latest:LoreForever.zip");
  assert.equal(assetRef("https://github.com/mliudev/LoreForever/releases/download/v0.8.0/Voice%20Pack.zip"), "v0.8.0:Voice Pack.zip");
  for (const bad of ["https://evil.test/releases/latest/download/file.zip", "https://github.com/other/repo/releases/latest/download/file.zip", "https://github.com/mliudev/LoreForever/releases/latest/download/%ZZ", "/download/voice/a", "javascript:alert(1)"]) assert.equal(assetRef(bad), "");
});

test("new manual bundle is a versioned metadata candidate without a live URL", () => {
  const html = voicesSection(voices, {}, packs);
  for (const locale of ["deDE", "esES", "frFR", "ptBR"]) assert.equal((html.match(new RegExp(`id="lang-${locale}"`, "g")) || []).length, 1);
  const version = packs[0].version.replaceAll(".", "\\.");
  assert.match(html, new RegExp(`data-preferred="v${version}:LoreForever_Voice_Female_enUS-complete\\.zip"`));
  assert.match(html, new RegExp(`data-preferred="v${version}:LoreForever_Voice_Default_deDE-complete\\.zip"`));
  assert.doesNotMatch(html, /href="[^"]*_enUS-complete\.zip/);
  assert.doesNotMatch(html, /href="[^"]*_(?:deDE|frFR|esES|ptBR)-complete\.zip/);
  const outdated = structuredClone(packs); outdated[0].version = "unknown";
  assert.doesNotMatch(voiceBlock(voices[0], {}, outdated), /data-preferred="[^"]*Default_deDE-complete/);
});
test("foreign fallback includes matching text if a later catalog moves it out of the main add-on", () => {
  const separate = structuredClone(packs); separate[0].included = false;
  const german = voiceChoices(voices[1], separate).find(g => g.language === "Deutsch");
  assert.equal(german.clips, 222);
  assert.equal(german.downloads.length, 2);
  assert.equal(german.downloads.at(-1).href, "/download/lang/deDE");
  const html = voiceBlock(voices[1], {}, separate);
  assert.match(html, /Deutsch text comes with this voice choice/);
  assert.match(html, /Install all 2 ZIPs/);
  assert.doesNotMatch(languagesSection(separate), /href="\/download\/lang/);
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
