import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestHead as core } from "../functions/download/[file].js";
import { onRequestHead as voice } from "../functions/download/voice/[id].js";
import { onRequestHead as language } from "../functions/download/lang/[locale].js";
import { onRequestGet as setup } from "../functions/download/setup/[narrator]/[lang]/[bundle].js";

test("HEAD download checks redirect to the same assets without counting a download", async () => {
  let writes = 0;
  const fixtures = { "/voices/voices.json": "voices.json", "/translate/packs.json": "packs.json" };
  const env = {
    DB: { batch() { writes++; }, prepare() { writes++; throw new Error("HEAD must not count"); } },
    ASSETS: { fetch: async url => {
      assert.ok(fixtures[url.pathname], `unexpected catalog ${url.pathname}`);
      return new Response(readFileSync(new URL("./fixtures/download-catalog/" + fixtures[url.pathname], import.meta.url)));
    } },
  };
  for (const [handler, params, path, filename] of [
    [core, { file: "installer" }, "/download/installer", "LoreForever-Setup.exe"],
    [core, { file: "zip" }, "/download/zip", "LoreForever.zip"],
    [voice, { id: "female-complete" }, "/download/voice/female-complete", "LoreForever_Voice_Female-complete.zip"],
    [language, { locale: "deDE" }, "/download/lang/deDE", "LoreForever_Lang_deDE-0.11.0.zip"],
  ]) {
    const res = await handler({ env, params, request: new Request("https://loreforeverwow.com" + path, { method: "HEAD" }) });
    assert.equal(res.status, 302);
    assert.ok(res.headers.get("Location").endsWith(filename));
  }
  assert.equal(writes, 0);
});

test("the picked Setup (LOR-848) is the release's own file, under a name that says the pick", async t => {
  const bytes = new Uint8Array([77, 90, 1, 2, 3]);   // stands in for the signed exe
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    asked.push([String(url), init?.method]);
    return new Response(init?.method === "HEAD" ? null : bytes, { headers: { "Content-Length": String(bytes.length) } });
  });
  // The site's download feed names the release the page was drawn for: its Setup, not whatever GitHub calls latest.
  const env = { ASSETS: { fetch: async url => new URL(url).pathname === "/data/download-files.json"
    ? Response.json({ publishedTag: "v9.8.7" }) : new Response("not found", { status: 404 }) } };
  const get = (path, method = "GET") => setup({ env, params: Object.fromEntries(["narrator", "lang", "bundle"].map((k, i) => [k, path.split("/")[i]])),
    request: new Request("https://loreforeverwow.com/download/setup/" + path, { method }) });
  const res = await get("female/de/storyteller");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Disposition"), /filename="Lore Forever Setup \(female, de, storyteller\)\.exe"/);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
  assert.ok(asked[0][0].endsWith("/releases/download/v9.8.7/LoreForever-Setup.exe"), asked[0][0]);
  assert.equal(res.headers.get("X-Release-Tag"), "v9.8.7");
  // Only the words Setup knows make a name: anything else is not found, so no header carries it.
  for (const bad of ["female/de/everything\"", "female/xx/addon", "original/en/addon"]) assert.equal((await get(bad)).status, 404, bad);
});
