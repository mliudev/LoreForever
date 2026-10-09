import test from "node:test";
import assert from "node:assert/strict";
import { voiceChoices, voiceBlock, voicesSection } from "../lib/downloads.js";
import { publicVoices } from "../lib/voices.js";

const spanish = { locale: "esES", name: "Español", included: false, status: "live", download: "https://example.com/shared.zip" };
const edition = { id: "densuad-eses", name: "Densuad", language: "Español", status: "live", clips: 10,
  download: "https://github.com/mliudev/LoreForever/releases/download/v0.12.0/LoreForever_Edition_Densuad_esES.zip",
  size: 10000000, credit: "Densuad", edition: { id: "densuad-esES", locale: "esES", entries: 12, coreVersion: "0.12.0", installedSize: 11000000 } };

test("paired edition never adds shared Spanish or other edition downloads", () => {
  const other = { ...spanish, edition: "other", download: "https://example.com/other.zip" };
  const [choice] = voiceChoices(edition, [spanish, other]);
  assert.equal(choice.downloads.length, 1);
  assert.equal(choice.downloads[0].item, edition);
  assert.equal(choice.translation.edition, true);
  assert.equal(choice.preferred, "");
  const html = voiceBlock(edition, {}, [spanish, other]);
  assert.match(html, /12 contributed entries/);
  assert.match(html, /10 recordings/);
  assert.match(html, /11 MB/);
  assert.match(html, /matching Lore Forever core \(0\.12\.0\)/);
  assert.match(html, /Switching editions changes text and narration together/);
  assert.doesNotMatch(html, /Other entries remain readable|\/download\/lang|Install all 2|\/lore voice|CurseForge/);
});

test("unreleased editions and missing paired download stay unavailable", () => {
  assert.equal(voicesSection([{ ...edition, status: "draft" }]), "");
  assert.deepEqual(voiceChoices({ ...edition, download: null }), []);
  assert.deepEqual(voiceChoices({ ...edition, edition: { ...edition.edition, locale: "broken" } }), []);
});

test("contributor metadata is escaped in the rendered download", () => {
  const html = voiceBlock({ ...edition, name: '<img src=x onerror="bad">', credit: "<script>bad</script>" });
  assert.doesNotMatch(html, /<img|<script|onerror="bad"/);
  assert.match(html, /&lt;script&gt;/);
});

test("unpublished edition stays out of profiles and public voice listings", async () => {
  const env = { ASSETS: { fetch: async () => Response.json({ voices: [edition, { ...edition, id: "unfinished", status: "draft" }] }) } };
  assert.deepEqual((await publicVoices(env, new Request("https://example.com/voices"))).map(v => v.id), [edition.id]);
});
