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

test("each narrator has a pack per language pack, listed but not released yet", () => {
  for (const loc of ["deDE", "esES", "frFR", "ptBR"]) {
    for (const folder of ["Default", "Female"]) {
      const addon = `LoreForever_Voice_${folder}_${loc}`;
      assert.ok(soon.some(([, p]) => p.addon === addon && p.language && p.download.endsWith(`/download/${addon}.zip`)),
        addon);
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
