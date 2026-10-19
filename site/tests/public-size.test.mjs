import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Cloudflare Pages refuses any single file over 25 MiB, and a refused deploy leaves the live site on the old version
// (lines.json passed it at 0.22.0). scripts/release.sh stops at 24 MiB; this keeps site PRs under the real limit.
const LIMIT = 25 * 1024 * 1024;

async function* files(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.isFile()) yield p;
  }
}

test("no file under site/public is over the 25 MiB Pages limit", async () => {
  const root = fileURLToPath(new URL("../public", import.meta.url));
  const big = [];
  for await (const p of files(root)) {
    const { size } = await stat(p);
    if (size >= LIMIT) big.push(`${p} is ${(size / 1048576).toFixed(1)} MiB`);
  }
  assert.deepEqual(big, [], "Pages refuses files over 25 MiB; split the file");
});
