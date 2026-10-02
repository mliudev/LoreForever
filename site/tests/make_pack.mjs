// Runs lib/langtest.js the way /api/translations/pack does, for pipeline/tests/lang_sim.py and test_langtest.py.
// stdin: {edits, english, fp, info}; stdout: {included, stale, files: {name: text}, zip: base64}.
import { packZip, renderPack, selectEdits } from "../lib/langtest.js";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { edits, english, fp, info } = JSON.parse(input);
const selected = selectEdits(edits, english, fp);
const date = new Date(Date.UTC(2026, 0, 1));
process.stdout.write(JSON.stringify({
  included: selected.included,
  stale: selected.stale,
  files: renderPack(selected, info),
  zip: Buffer.from(packZip(selected, info, date)).toString("base64"),
}));
