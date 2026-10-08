import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assetRef, formatSize, voiceChoices, voiceBlock, voicesSection, includedLine, languagesSection } from "../lib/downloads.js";
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const voices = JSON.parse(read("./fixtures/download-catalog/voices.json")).voices;
const packs = JSON.parse(read("./fixtures/download-catalog/packs.json")).packs;
const femaleEnglishDownloads = ["female-complete", "female-answers-places", "female-answers-lore", "female-answers-people", "female-answers-quests-1", "female-answers-quests-2"];
const femaleEnglishCount = femaleEnglishDownloads.reduce((total, id) => total + voices.find(v => v.id === "female-narrator").packs.find(p => p.id === id).clips, 0);
const femaleEnglishFormatted = femaleEnglishCount.toLocaleString("en-US");
const maleEnglishCount = voices.find(v => v.id === "male-narrator").clips;
const maleEnglishFormatted = maleEnglishCount.toLocaleString("en-US");
const femaleEnglishStoriesCount = ["female-alliance-lands", "female-horde-lands"].reduce((total, id) => total + voices.find(v => v.id === "female-narrator").packs.find(p => p.id === id).clips, voices.find(v => v.id === "female-narrator").clips);
const femaleEnglishStoriesFormatted = femaleEnglishStoriesCount.toLocaleString("en-US");

test("decimal download size boundaries and invalid values", () => {
  for (const [bytes, expected] of [[1, "1 KB"], [999999, "1000 KB"], [1e6, "1 MB"], [715e6, "715 MB"], [999999999, "1000 MB"], [1e9, "1.0 GB"], [1.45e9, "1.4 GB"]]) assert.equal(formatSize(bytes), expected);
  for (const bad of [0, -1, Infinity, NaN, "715000000", {}, null]) assert.equal(formatSize(bad), "");
});
test("asset lookup uses exact official release filenames", () => {
  assert.equal(assetRef("/download/complete"), "latest:LoreForever.zip");
  assert.equal(assetRef("https://github.com/mliudev/LoreForever/releases/download/v0.8.0/Voice%20Pack.zip"), "v0.8.0:Voice Pack.zip");
  for (const bad of ["https://evil.test/releases/latest/download/file.zip", "https://github.com/other/repo/releases/latest/download/file.zip", "https://github.com/mliudev/LoreForever/releases/latest/download/%ZZ", "/download/voice/a", "javascript:alert(1)"]) assert.equal(assetRef(bad), "");
});
test("one row per language and narrator aggregates distinct released components", () => {
  const female = voices.find(v => v.id === "female-narrator");
  const choices = voiceChoices(female, packs);
  assert.equal(choices.length, 7);
  const english = choices.find(g => g.language === "English" && !g.extra);
  assert.equal(english.clips, femaleEnglishCount);
  assert.deepEqual(english.downloads.map(f => f.pack), femaleEnglishDownloads);
  assert.deepEqual(english.leaves.map(f => f.pack), ["female-narrator", "female-alliance-lands", "female-horde-lands", "female-answers-places", "female-answers-lore", "female-answers-people", "female-answers-quests-1", "female-answers-quests-2"]);
  assert.equal(choices.find(g => g.language === "Deutsch" && !g.extra).clips, 222);
  assert.equal(voiceChoices(voices[0], packs).find(g => g.language === "Deutsch" && !g.extra).clips, 223);
  const html = voiceBlock(female, {}, packs);
  assert.equal((html.match(/<tr /g) || []).length, 7);
  assert.match(html, new RegExp(`data-label="Recordings">\\s*<span class="dl-recording-count">${femaleEnglishFormatted}`));
  assert.match(html, /data-label="Download size">\s*<span class="dl-size dl-total-size" data-assets=/);
  assert.match(html, /Total download/);
  assert.match(html, /Install all 6 ZIPs/);
  assert.match(html, /Matching translated text/);
  assert.match(html, /Deutsch text comes with this voice choice/);
  for (const id of ["female-narrator", "female-narrator-core", "female-complete", "female-answers-places", "female-alliance-lands", "female-horde-lands", "female-quests", "female-german", "female-german-quests"]) assert.ok(html.includes(`id="${id}"`), id);
});
test("English male stays included and quest givers remain a distinct partial choice", () => {
  const male = voices[0], choices = voiceChoices(male, packs);
  const english = choices.filter(g => g.language === "English");
  assert.equal(english.length, 3);
  assert.equal(english.find(g => g.included).clips, maleEnglishCount);
  assert.equal(english.find(g => g.id === "quest-givers").clips, 1526);
  assert.equal(english.find(g => g.id === "male-quests").clips, 3751);
  const html = voiceBlock(male, {}, packs);
  assert.match(html, /Included with add-on/);
  assert.match(html, /Quest dialogue — character voices/);
  assert.doesNotMatch(html, /href="\/download\/voice\/male-narrator"/);
  for (const p of male.packs.filter(p => p.status === "soon")) assert.ok(!html.includes(`id="${p.id}"`));
  assert.equal(voicesSection([{ ...male, status: "soon" }]), "");
  assert.match(includedLine(voices), new RegExp(`English text and male narrator \\(${maleEnglishFormatted} recordings\\)`));
});

test("quest dialogue rows identify the narrator and group voice filters across languages", () => {
  const html = voicesSection(voices, {}, packs);
  for (const gender of ["male", "female"]) {
    const label = `Quest dialogue (${gender} narrator)`;
    assert.equal((html.match(new RegExp(`data-voice="${gender}-narrator-quest-dialogue"`, "g")) || []).length, 2);
    assert.ok(html.includes(`data-voice-name="${label}"`));
    assert.ok(html.includes(`>${label}</a>`));
  }
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
test("CurseForge choices state actual coverage and identify manual extras", () => {
  const html = voiceBlock(voices[1], {}, packs);
  const cf = html.slice(html.indexOf('id="female-narrator-curseforge"'));
  assert.match(cf, new RegExp(`Includes Core stories, Alliance lands and Horde lands \\(${femaleEnglishStoriesFormatted} recordings\\)`));
  assert.match(cf, /Recorded answer packs and quest dialogue are separate/);
  assert.match(cf, /Quest dialogue \(optional\) on CurseForge/);
  assert.match(cf, new RegExp(`Also install the manual ZIPs for Answers about zones and places, Answers about lore and items, Answers about people, Answers about quests, levels 1-13 and Answers about quests, levels 14-22 to get all ${femaleEnglishFormatted} recordings`));
  assert.doesNotMatch(cf.slice(0, cf.indexOf("</li>")), /data-asset=/);
  for (const slug of ["german-narration-male-narrator", "german-narration-female-narrator", "portuguese-narration-male-narrator", "portuguese-narration-female-narrator"]) assert.ok(voicesSection(voices, {}, packs).includes(`lore-forever-${slug}`));
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
test("compact table preserves native install details, main choices, samples, likes, footer and old anchors", () => {
  const page = read("../public/downloads.html");
  const installer = page.match(/<li class="dl-file dl-recommended" id="installer">[\s\S]*?<\/li>/)?.[0];
  assert.ok(installer, "Windows installer is the recommended choice");
  assert.match(installer, /Windows installer <span class="tag">Recommended<\/span>/);
  assert.match(installer, /class="btn-download dl-get dl-link" href="\/download\/installer"/);
  assert.match(installer, />Download for Windows<\/a>/);
  assert.ok(page.indexOf('id="installer"') < page.indexOf('id="zip"'));
  assert.ok(page.indexOf('id="zip"') < page.indexOf('id="curseforge"'));
  const curseforge = page.match(/<li class="dl-file" id="curseforge">[\s\S]*?<\/li>/)?.[0];
  assert.ok(curseforge, "CurseForge remains an alternative");
  assert.doesNotMatch(curseforge, /Recommended|btn-download/);
  assert.match(page, /Install the add-on/); assert.match(page, /Recommended/); assert.match(page, /Choose a voice/);
  assert.match(page, /<table class="dl-table">/);
  for (const label of ["Language", "Voice", "Recordings", "Download size"]) assert.ok(page.includes(`>${label}</th>`));
  for (const id of ["addon", "voices", "install", "languages", "record"]) assert.ok(page.includes(`id="${id}"`));
  assert.match(page, /id="recording-filters" hidden/);
  for (const id of ["recording-voice", "recording-language"]) assert.match(page, new RegExp(`for="${id}"`));
  for (const route of ["/download/zip", "/download/installer", "/privacy", "/voices/studio"]) assert.ok(page.includes(`href="${route}"`));
  const html = voicesSection(voices, {}, packs);
  for (const pattern of [/class="dl-play"/, /class="dl-audio"/, /vc-like/, /<details class="dl-install-choice"/, /<summary class="btn-small"[^>]*>Get voice pack/, /Partial coverage/]) assert.match(html, pattern);
  assert.doesNotMatch(page + html, /Text.only download|Get text/);
  assert.match(read("../public/style.css"), /\.dl-page \[hidden\] \{ display: none !important; \}/);
});
