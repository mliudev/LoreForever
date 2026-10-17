// Every script the site's pages load parses (LOR-602: #957 shipped a second `const pct` in admin-page.js, a
// SyntaxError that blanked the whole /admin dashboard, and no test loaded that file). A script with import or export
// is checked as a module (node --check on a .mjs copy), any other as a classic script (vm.Script). Vendored, minified
// libraries are left out. Run: node --test 'site/tests/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

import { SITE } from "./helpers.mjs";

const scripts = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? (e.name === "vendor" ? [] : scripts(join(dir, e.name)))
  : e.name.endsWith(".js") && !e.name.endsWith(".min.js") ? [join(dir, e.name)] : []);

test("every page script parses", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lf-page-scripts-"));
  const broken = [];
  try {
    for (const file of scripts(join(SITE, "public"))) {
      const source = readFileSync(file, "utf8");
      if (/^\s*(?:import|export)\b/m.test(source)) {
        const copy = join(tmp, "check.mjs");
        writeFileSync(copy, source);
        const run = spawnSync(process.execPath, ["--check", copy], { encoding: "utf8" });
        if (run.status !== 0) broken.push(`${relative(SITE, file)}: ${(run.stderr.match(/SyntaxError.*$/m) || [run.stderr])[0]}`);
      } else {
        try { new vm.Script(source, { filename: file }); }
        catch (e) { broken.push(`${relative(SITE, file)}: ${e.message}`); }
      }
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  assert.deepEqual(broken, []);
});
