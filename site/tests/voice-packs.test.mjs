// Narration packs not released yet (voices.json "status": "soon": LOR-177's narrators in the language packs'
// languages, until they're recorded) stay off /voices and the voice pages, and /download/voice/<id> doesn't serve
// them. Run: node --test site/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { profilePage, findDownload } from "../lib/voices.js";
import { voiceBlock, voiceChoices, includedLine } from "../lib/downloads.js";
import { onRequestGet as downloadsPage } from "../functions/downloads/index.js";
import { onRequestGet as downloadPack } from "../functions/download/voice/[id].js";

const voices = JSON.parse(readFileSync(new URL("../public/voices/voices.json", import.meta.url), "utf8")).voices;
const soon = voices.flatMap(v => (v.packs || []).filter(p => p.status === "soon").map(p => [v, p]));
const languagePacks = voices.flatMap(v => (v.packs || []).filter(p => p.language).map(p => [v, p]));

test("each narrator has a pack per language pack, listed as soon until it's released, then live", () => {
  for (const loc of ["deDE", "esES", "frFR", "ptBR"]) {
    for (const folder of ["Default", "Female"]) {
      const addon = `LoreForever_Voice_${folder}_${loc}`;
      const pack = languagePacks.map(([, p]) => p).find(p => p.addon === addon);
      assert.ok(pack && pack.download.endsWith(`/download/${addon}.zip`), addon);
      assert.ok(["soon", "live"].includes(pack.status), `${addon}: ${pack.status}`);
      if (pack.status === "live") assert.ok(pack.clips > 0, `${addon} is live with recordings`);
    }
  }
});

test("a pack that's soon stays off the pages, and its download isn't served", () => {
  assert.ok(soon.length > 0);
  for (const [v, p] of soon) {
    for (const html of [profilePage(v, 0), voiceBlock(v)]) {
      assert.ok(!html.includes(`/download/voice/${p.id}`) && !html.includes(p.addon), `${v.id}: ${p.id}`);
    }
    assert.equal(findDownload(voices, p.id).status, "soon");   // functions/download/voice/[id].js: 404 unless live
  }
  // Released, it shows like her other packs.
  const her = structuredClone(voices.find(x => x.id === "female-narrator"));
  for (const p of her.packs) if (p.status === "soon") p.status = "live";
  assert.match(profilePage(her, 0), /\/download\/voice\/female-german"/);
  assert.match(voiceBlock(her), /\/download\/voice\/female-german"/);
});

test("the simple downloads table keeps quest packs separate from stories and answers", async () => {
  const male = voices.find(v => v.id === "male-narrator");
  const female = voices.find(v => v.id === "female-narrator");
  const maleQuest = findDownload(voices, "male-quests");
  assert.equal(maleQuest.addon, "LoreForever_Voice_Default_Quests");
  assert.equal(maleQuest.status, "live");
  assert.ok(maleQuest.download.endsWith("/LoreForever_Voice_Default_Quests.zip"));
  assert.ok(male.clips < maleQuest.clips);
  assert.deepEqual(findDownload(voices, "female-complete").contains,
    ["female-narrator", "female-alliance-lands", "female-horde-lands"]);
  assert.ok(voiceChoices(male).find(group => group.id === "male-quests" && group.extra));
  assert.ok(voiceChoices(female).find(group => group.id === "female-quests" && group.extra));
  for (const id of ["male-german-quests", "female-german-quests"]) {
    const owner = id.startsWith("male") ? male : female;
    assert.ok(voiceChoices(owner).find(group => group.id === id && group.extra), id);
  }
  assert.match(voiceBlock(male), /href="\/download\/voice\/male-quests"/);
  assert.match(voiceBlock(male), /href="\/download\/voice\/quest-givers"/);
  assert.doesNotMatch(includedLine(voices), /quest dialogue/i);
  for (const v of [male, female]) {
    const profile = profilePage(v, 0);
    assert.match(profile, /Speak quest dialogue/);
    assert.match(profile, /Chatty Little NPC/);
  }
  const env = { ASSETS: { fetch: async url => {
    const path = new URL(url).pathname;
    return new Response(readFileSync(new URL(path === "/downloads" ? "../public/downloads.html" :
      `../public${path}`, import.meta.url)), { headers: { "Content-Type": "text/html" } });
  } } };
  const request = new Request("https://loreforeverwow.com/downloads");
  const html = await (await downloadsPage({ env, request })).text();
  assert.match(html, /href="\/download\/voice\/male-quests"/);
  assert.match(html, /Quest dialogue is off by default/);
  assert.match(html, /Skip these packs if Spoken,\s+Chatty Little NPC/);
  const redirect = await downloadPack({ env, request, params: { id: "male-quests" } });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("Location"), maleQuest.download);
});

test("story totals leave optional quest dialogue out", () => {
  const script = fileURLToPath(new URL("../../scripts/voice_counts.py", import.meta.url));
  const result = spawnSync("python3", ["-c", `
import runpy, json, sys
ns = runpy.run_path(sys.argv[1])
files = {"Narrator": {"story", "answer"}, "Narrator_Alliance": {"place", "shared"},
         "Narrator_Horde": {"person", "shared"}, "Narrator_Quests": {"dialogue"},
         "Narrator_Answers_Places": {"extra-answer"}}
ns["counts"].__globals__["clip_names"] = lambda name: files.get(name)
voices = [{"id": "included", "addon": "Narrator", "included": True, "packs": [
    {"id": "dialogue", "addon": "Narrator_Quests"}, {"id": "answers", "addon": "Narrator_Answers_Places"},
    {"id": "stories-complete"}]}]
print(json.dumps(ns["counts"](voices)))
`, script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),
    { dialogue: 1, answers: 1, included: 6, "stories-complete": 6 });
});
