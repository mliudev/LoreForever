// Narration packs not released yet (voices.json "status": "soon": LOR-177's narrators in the language packs'
// languages, until they're recorded) stay off /voices and the voice pages, and /download/voice/<id> doesn't serve
// them. Run: node --test site/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { profilePage, findDownload } from "../lib/voices.js";
import { voiceBlock } from "../lib/downloads.js";

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

test("the included narrator keeps optional quest-giver dialogue visible without duplicating bundled files", () => {
  const male = structuredClone(voices.find(v => v.id === "male-narrator"));
  const questGivers = male.packs.find(p => p.id === "quest-givers");
  assert.ok(questGivers && questGivers.status === "live" && questGivers.clips > 0);
  // A bundled English file keeps the existing default: the main download already carries it.
  male.packs.push({ id: "bundled-quest-dialogue", name: "Bundled quest dialogue", download: "/download/zip" });
  const html = voiceBlock(male);
  assert.equal((html.match(/href="\/download\/voice\/quest-givers"/g) || []).length, 1);
  assert.match(html, /Optional packs:/);
  assert.ok(html.includes(questGivers.clips.toLocaleString("en-US")));
  assert.match(html, /male human, dwarf, Forsaken and orc quest givers/);
  assert.match(html, /where available, or stay as text/);
  assert.doesNotMatch(html, /href="\/download\/zip"|bundled-quest-dialogue/);
  assert.doesNotMatch(html, /href="\/download\/voice\/male-narrator"/);
  for (const p of male.packs.filter(p => p.status === "soon")) {
    assert.ok(!html.includes(`/download/voice/${p.id}`), p.id);
  }
});
