// GET /api/downloads (functions/api/downloads.js): the add-on's count leaves Willo-Setup.exe out, and Willo's own count
// comes from GitHub, or from the site's /download/willo count when GitHub fails. GitHub and cfwidget are stood in for:
// nothing here touches the network.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/downloads.js";
import { resetSnapshotClock } from "../lib/stores.js";
import { d1 } from "./helpers.mjs";

const RELEASES = [
  { tag_name: "v0.18.0", published_at: "2026-10-14T18:00:00Z", assets: [{ name: "LoreForever.zip", download_count: 100 },
    { name: "LoreForever-Setup.exe", download_count: 20 }, { name: "Willo-Setup.exe", download_count: 25 }] },
  { tag_name: "v0.17.0", published_at: "2026-10-13T18:00:00Z", assets: [{ name: "LoreForever.zip", download_count: 300 }] },
];
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const sources = githubUp => {
  globalThis.fetch = async url => {
    if (url.startsWith("https://api.github.com/")) return githubUp ? Response.json(RELEASES) : new Response("", { status: 403 });
    if (url.startsWith("https://api.cfwidget.com/")) return Response.json({ downloads: { total: 5000 } });
    throw new Error("no network in tests: " + url);
  };
};
const ask = async env => (await onRequestGet({ request: new Request("https://loreforeverwow.com/api/downloads"), env })).json();

test("Willo-Setup.exe counts for Willo, never for the add-on, here or in the snapshots", async () => {
  sources(true);
  resetSnapshotClock();
  const env = { DB: d1() };
  const got = await ask(env);
  assert.deepEqual({ total: got.total, github: got.github, willo: got.willo, willoSource: got.willoSource },
    { total: 5420, github: 420, willo: 25, willoSource: "github" });
  assert.equal(env.DB.sqlite.prepare("SELECT downloads FROM store_files WHERE source = 'github' AND file = 'v0.18.0'").get().downloads, 120);
});

test("GitHub down: Willo's count is the site's own, or null with nothing to read", async () => {
  sources(false);
  const DB = d1();
  DB.sqlite.exec(`CREATE TABLE downloads (day TEXT NOT NULL, file TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, file));
    INSERT INTO downloads VALUES ('2026-10-14', 'willo', 10), ('2026-10-15', 'willo', 6), ('2026-10-15', 'zip', 50);`);
  const got = await ask({ DB });
  assert.deepEqual({ total: got.total, github: got.github, willo: got.willo, willoSource: got.willoSource },
    { total: 5000, github: null, willo: 16, willoSource: "site" });
  for (const env of [{}, { DB: d1() }]) {   // no database; no downloads table yet
    const none = await ask(env);
    assert.deepEqual([none.willo, none.willoSource], [null, null]);
  }
});
