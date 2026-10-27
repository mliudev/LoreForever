// The lab spend guard (LOR-826): lab runs share the live site's Together and fal accounts, so a lab run must stop at its
// dollar ceilings before the account runs dry (10/26: lab runs used up Together's credit and live Willo got a 402).
// Each case runs a real lab-style process (fetch is a stand-in; the network is the only thing mocked) against a temp log
// directory, so what's checked is what a run does: how far it gets and its exit code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { REQUEST_USD, LIMITS_USD } from "../../eval/willo/lab/spend-guard.mjs";

const GUARD = fileURLToPath(new URL("../../eval/willo/lab/spend-guard.mjs", import.meta.url));
const SCRIPTS = fileURLToPath(new URL("../../scripts", import.meta.url));
const ACTIONS = fileURLToPath(new URL("../../eval/willo", import.meta.url));

// Sends `n` requests to `url` through the guard in a child process; says how many got through and how it ended.
function run(url, n, env = {}, dir = mkdtempSync(join(tmpdir(), "lab-spend-"))) {
  const code = `globalThis.fetch = async () => new Response("ok");
    await import(${JSON.stringify(GUARD)}); let sent = 0;
    process.on("exit", () => console.log(sent));
    for (let i = 0; i < ${n}; i++) { await fetch(${JSON.stringify(url)}); sent++; }`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code],
    { env: { PATH: process.env.PATH, LAB_SPEND_DIR: dir, ...env }, encoding: "utf8" });
  return { sent: Number(r.stdout.trim() || 0), status: r.status, stderr: r.stderr, dir };
}
const TOGETHER = "https://api.together.xyz/v1/chat/completions";
const logged = dir => readdirSync(dir).flatMap(f => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean));

test("a run stops at its dollar ceiling before the account runs dry", () => {
  const cap = Math.floor(LIMITS_USD.together.run / REQUEST_USD.together);
  const r = run(TOGETHER, cap + 50);
  assert.equal(r.status, 3);
  assert.ok(r.sent > 0 && r.sent <= cap, `${r.sent} of ${cap} allowed`);
  assert.match(r.stderr, /ceiling/);
});

test("the day's ceiling counts every run, so many small runs can't add up past it", () => {
  const dir = mkdtempSync(join(tmpdir(), "lab-spend-"));
  const perDay = Math.floor(LIMITS_USD.together.day / REQUEST_USD.together);
  let total = 0, last;
  for (let i = 0; i < 20 && !(last?.status === 3); i++) { last = run(TOGETHER, Math.floor(perDay / 3), {}, dir); total += last.sent; }
  assert.equal(last.status, 3);
  assert.ok(total <= perDay, `${total} requests in a day, ceiling ${perDay}`);
});

test("a ceiling set in dollars in the environment is the one used", () => {
  const r = run(TOGETHER, 100, { LAB_TOGETHER_MAX_RUN_USD: String(REQUEST_USD.together * 3.5) });
  assert.equal(r.sent, 3);
  assert.equal(r.status, 3);
});

test("a request count cap, when set, still stops a run", () => {
  const r = run(TOGETHER, 100, { LAB_TOGETHER_MAX_RUN: "4" });
  assert.equal(r.sent, 4);
  assert.equal(r.status, 3);
});

test("OpenRouter is refused unless allowed; other hosts are never counted or stopped", () => {
  assert.equal(run("https://openrouter.ai/api/v1/chat/completions", 1).status, 3);
  assert.equal(run("https://openrouter.ai/api/v1/chat/completions", 1, { LAB_ALLOW_OPENROUTER: "1" }).status, 0);
  const other = run("https://generativelanguage.googleapis.com/v1beta/models", 3000);
  assert.equal(other.sent, 3000);
  assert.equal(readdirSync(other.dir).length, 0);
});

test("Python lab runs and Node lab runs add into one daily total", () => {
  const dir = mkdtempSync(join(tmpdir(), "lab-spend-"));
  // Python spends nearly the whole day's fal allowance (charge exits the process when a ceiling would be passed).
  const spend = Math.floor(LIMITS_USD.fal.day / REQUEST_USD.fal) - 1;
  const py = spawnSync("python3", ["-I", "-c",
    `import sys; sys.path.insert(0, ${JSON.stringify(SCRIPTS)}); import lab_spend_guard as g\n` +
    `for _ in range(${spend}): g.charge('fal')`],
    { env: { PATH: process.env.PATH, HOME: process.env.HOME, LAB_SPEND_DIR: dir, LAB_FAL_MAX_RUN_USD: "1000" }, encoding: "utf8" });
  assert.equal(py.status, 0, py.stderr);
  assert.equal(logged(dir).length, spend);
  // Node then gets only what is left of today's allowance.
  const r = run("https://fal.run/fal-ai/qwen-3-tts/clone-voice/1.7b", 10, { LAB_FAL_MAX_RUN_USD: "1000" }, dir);
  assert.equal(r.status, 3);
  assert.ok(r.sent <= 2, `${r.sent} more requests after Python spent the day's allowance`);
});

// The live key's credit is what live Willo answers depend on (10/26): a lab script with only that key set must stop
// before any request, never run on it. The fetch preload records any request to a file so "no network call" is checked.
test("a lab run with only the live Together key set stops without a request", () => {
  const dir = mkdtempSync(join(tmpdir(), "lab-spend-"));
  const preload = join(dir, "no-fetch.mjs");
  writeFileSync(preload, `import { appendFileSync } from "node:fs";
    globalThis.fetch = async url => { appendFileSync(${JSON.stringify(join(dir, "calls.txt"))}, String(url)); return new Response("{}"); };`);
  const r = spawnSync(process.execPath, ["--import", preload, join(ACTIONS, "actions.mjs"), "--group", "reminder"],
    { env: { PATH: process.env.PATH, HOME: process.env.HOME, LAB_SPEND_DIR: dir, TOGETHER_AI_API_KEY: "live-key" }, encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /LAB_TOGETHER_AI_API_KEY/);
  assert.equal(existsSync(join(dir, "calls.txt")), false);
});
