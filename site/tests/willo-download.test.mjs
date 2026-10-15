// Willo's own download (lib/willo.js): /download/willo and /willo follow the newest release that has Willo-Setup.exe,
// and say Willo is coming before the first one. /willo is where the add-on sends players: never a price or a plan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestGet as download } from "../functions/download/[file].js";
import { onRequestGet as willoPage } from "../functions/willo.js";

const PAGE = readFileSync(new URL("../public/willo.html", import.meta.url), "utf8");
const snapshot = willo => ({ publishedTag: "v0.18.1", byTag: { "v0.18.0": { "Willo-Setup.exe": 240000000 } },
  downloads: willo ? { "/download/willo": "v0.18.0:Willo-Setup.exe" } : {} });
const envWith = (sizes, counted = []) => ({
  DB: { prepare: sql => ({ bind: () => sql }), batch: async q => { counted.push(q); } },
  ASSETS: { fetch: async url => new Response(url.pathname === "/data/download-files.json" ? JSON.stringify(sizes) : PAGE) },
});
const get = (path, ua = "Mozilla/5.0") => new Request("https://loreforeverwow.com" + path, { headers: { "user-agent": ua } });

test("/download/willo points at the release that has Willo, else at /willo", async () => {
  let res = await download({ env: envWith(snapshot(true)), params: { file: "willo" }, request: get("/download/willo"), waitUntil() {} });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), "https://github.com/mliudev/LoreForever/releases/download/v0.18.0/Willo-Setup.exe");
  res = await download({ env: envWith(snapshot(false)), params: { file: "willo" }, request: get("/download/willo"), waitUntil() {} });
  assert.equal(res.headers.get("Location"), "https://loreforeverwow.com/willo");
});

test("a preview serves its test build from its own bucket; loreforeverwow.com never does", async () => {
  const sha = "a".repeat(64), key = `willo/${sha}/Willo-Setup.exe`;
  const objects = { "willo/preview.json": JSON.stringify({ key, sha256: sha, bytes: 51000000, version: "0.18.0-qa" }),
                    [key]: "MZ test build" };
  const STUDIO = { get: async k => k in objects ? { body: objects[k], size: objects[k].length, json: async () => JSON.parse(objects[k]) } : null,
                   head: async k => k in objects ? { size: objects[k].length } : null };
  const env = { ...envWith(snapshot(false)), STUDIO };
  const at = host => new Request(`https://${host}/download/willo`, { headers: { "user-agent": "Mozilla/5.0" } });
  let res = await download({ env, params: { file: "willo" }, request: at("develop.lore-forever.pages.dev"), waitUntil() {} });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Disposition"), /filename="Willo-Setup.exe"/);
  assert.equal(await res.text(), "MZ test build");
  res = await download({ env, params: { file: "willo" }, request: at("loreforeverwow.com"), waitUntil() {} });
  assert.equal(res.headers.get("Location"), "https://loreforeverwow.com/willo");
  const page = await willoPage({ env, request: at("develop.lore-forever.pages.dev"), waitUntil() {},
    next: async () => new Response(PAGE) });
  assert.match(await page.text(), /Download Willo for Windows[\s\S]*0\.18\.0-qa \(test build\)/);
});

test("/willo counts the visit and offers the download once there is one, with no price written into the page", async () => {
  const counted = [], waits = [];
  const page = async (willo, ua) => {
    const res = await willoPage({ env: envWith(snapshot(willo), counted), request: get("/willo", ua),
      waitUntil: p => waits.push(p), next: async () => new Response(PAGE, { headers: { "Content-Type": "text/html" } }) });
    return res.text();
  };
  const soon = await page(false);
  assert.match(soon, /almost here/);
  assert.doesNotMatch(soon, /\/download\/willo/);
  const ready = await page(true);
  assert.match(ready, /href="\/download\/willo\?src=willo"/);
  assert.match(ready, /240 MB/);
  const shown = html => /<main[\s\S]*<\/main>/.exec(html)[0].replace(/<!--[\s\S]*?-->/g, "");
  for (const html of [soon, ready]) assert.doesNotMatch(shown(html), /\$\d/);   // prices come only from /api/billing/plans
  await page(true, "Slackbot-LinkExpanding 1.0");
  await Promise.all(waits);
  assert.equal(counted.length, 2, "two visits counted, the link preview not");
});

test("a test build goes up only to a preview, with the admin key", async () => {
  const { onRequestPut } = await import("../functions/api/admin/willo-build.js");
  const { createHash } = await import("node:crypto");
  const stored = {};
  const STUDIO = { put: async (k, v) => { stored[k] = typeof v === "string" ? v : Buffer.from(v).toString("latin1"); } };
  const exe = Buffer.from("MZ willo test build"), sha = createHash("sha256").update(exe).digest("hex");
  const put = (host, key) => onRequestPut({ env: { STUDIO, ADMIN_KEY: "k" }, request: new Request(
    `https://${host}/api/admin/willo-build?sha256=${sha}&version=0.18.0-qa`, { method: "PUT", body: exe,
      headers: key ? { "X-Admin-Key": key } : {} }) });
  assert.equal((await put("loreforeverwow.com", "k")).status, 403);
  assert.equal((await put("develop.lore-forever.pages.dev", "wrong")).status, 401);
  const res = await put("develop.lore-forever.pages.dev", "k");
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(stored["willo/preview.json"]).key, `willo/${sha}/Willo-Setup.exe`);
  assert.equal(stored[`willo/${sha}/Willo-Setup.exe`], "MZ willo test build");
});
