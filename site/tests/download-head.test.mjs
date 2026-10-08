import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestHead as core } from "../functions/download/[file].js";
import { onRequestHead as voice } from "../functions/download/voice/[id].js";
import { onRequestHead as language } from "../functions/download/lang/[locale].js";

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
