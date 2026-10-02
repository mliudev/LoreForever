// Translator kits in R2: uploaded through PUT /api/translations/kits (functions/api/translations/kits.js) and served at
// /translate/kits/<name>.zip (functions/translate/kits/[name].js), through the real Functions. R2 is in memory and
// languages.json comes from ASSETS (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { onRequest as serve } from "../functions/translate/kits/[name].js";
import { onRequest as api } from "../functions/api/translations/kits.js";
import { KEEP, kitKey } from "../lib/kits.js";
import { r2, assets } from "./helpers.mjs";

const KEY = "admin-test-key";
const HOME = "loreforeverwow.com";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const zip = s => new Uint8Array([0x50, 0x4b, 3, 4, ...new TextEncoder().encode(s)]);   // enough of a zip for the API

// A deployment on `host` whose languages.json links each kit name to a sha256 (frFR stands in for "new").
function site({ host = HOME, linked = {}, bucket = r2() } = {}) {
  const languages = Object.entries(linked).map(([name, kitSha256]) => (
    { locale: name === "new" ? "frFR" : name, kit: `/translate/kits/${name}.zip`, kitSha256 }));
  const env = { STUDIO: bucket, ADMIN_KEY: KEY, ASSETS: assets({ "/translate/languages.json": { languages } }) };
  const call = (fn, path, init, params = {}) =>
    fn({ request: new Request(`https://${host}${path}`, init), env, params, waitUntil: () => {} });
  const auth = (key = KEY) => ({ Authorization: `Bearer ${key}` });
  return {
    env, bucket,
    get: (file, { query = "", method = "GET", headers = {} } = {}) =>
      call(serve, `/translate/kits/${file}${query}`, { method, headers }, { name: file }),
    upload: (name, bytes, { hash = sha(bytes), key } = {}) =>
      call(api, `/api/translations/kits?name=${name}&sha256=${hash}`, { method: "PUT", body: bytes, headers: auth(key) }),
    list: key => call(api, "/api/translations/kits", { headers: auth(key) }),
  };
}

const bytesOf = async res => new Uint8Array(await res.arrayBuffer());

test("an uploaded kit is served at its old address, with its SHA-256 as the ETag", async () => {
  const kit = zip("deDE kit v1");
  const s = site({ linked: { deDE: sha(kit) } });
  let res = await s.upload("deDE", kit);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, key: kitKey("deDE", sha(kit)), stored: true, removed: [] });
  assert.ok(s.bucket.objects.has(`translate-kits/deDE/${sha(kit)}.zip`));
  assert.equal((await (await s.upload("deDE", kit)).json()).stored, false, "the same kit again isn't stored twice");

  res = await s.get("deDE.zip");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/zip");
  assert.equal(res.headers.get("ETag"), `"${sha(kit)}"`);
  assert.equal(res.headers.get("Cache-Control"), "no-cache");
  assert.deepEqual(await bytesOf(res), kit);

  res = await s.get("deDE.zip", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Length"), String(kit.length));
  assert.equal(res.body, null);

  res = await s.get("deDE.zip", { headers: { "If-None-Match": `"${sha(kit)}"` } });
  assert.equal(res.status, 304);

  const listed = await (await s.list()).json();
  assert.deepEqual(listed.linked, { deDE: sha(kit) });
  assert.deepEqual(listed.kits.map(k => [k.name, k.sha256, k.size]), [["deDE", sha(kit), kit.length]]);
});

test("the admin API needs the key and checks what it stores", async () => {
  const kit = zip("ptBR kit");
  const s = site();
  assert.equal((await s.upload("ptBR", kit, { key: "wrong" })).status, 401);
  assert.equal((await s.list("wrong")).status, 401);
  assert.equal((await s.upload("pt-BR", kit)).status, 400, "not a kit name");
  assert.equal((await s.upload("ptBR", kit, { hash: "abc" })).status, 400, "not a sha256");
  assert.equal((await s.upload("ptBR", kit, { hash: sha(zip("something else")) })).status, 400, "R2 refuses a mismatch");
  assert.equal((await s.upload("ptBR", new TextEncoder().encode("<html>"))).status, 415, "not a zip");
  assert.equal(s.bucket.objects.size, 0);
  const post = new Request(`https://${HOME}/api/translations/kits`, { method: "POST", headers: { Authorization: `Bearer ${KEY}` } });
  assert.equal((await api({ request: post, env: s.env, params: {} })).status, 405);
});

test("?v= picks an exact kit; each deployment serves the one its languages.json links to", async () => {
  const [a, b] = [zip("kit A"), zip("kit B")];
  const bucket = r2();
  const live = site({ bucket, linked: { deDE: sha(a) } });
  await live.upload("deDE", a);
  await live.upload("deDE", b);   // a newer kit (say, tonight's PR): uploaded, but not linked here yet
  assert.deepEqual(await bytesOf(await live.get("deDE.zip")), a);
  assert.deepEqual(await bytesOf(await live.get("deDE.zip", { query: `?v=${sha(b)}` })), b);
  const next = site({ bucket, linked: { deDE: sha(b) } });
  assert.deepEqual(await bytesOf(await next.get("deDE.zip")), b);
});

test("a preview without the kit in its own bucket sends the download to the same kit on loreforeverwow.com", async () => {
  const kit = zip("deDE kit");
  const preview = site({ host: "abc123.lore-forever.pages.dev", linked: { deDE: sha(kit), new: sha(zip("new")) } });
  let res = await preview.get("deDE.zip");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), `https://${HOME}/translate/kits/deDE.zip?v=${sha(kit)}`);
  res = await preview.get("new.zip", { query: "?v=" + "0".repeat(64) });
  assert.equal(res.headers.get("Location"), `https://${HOME}/translate/kits/new.zip?v=${"0".repeat(64)}`);
  await preview.bucket.put(kitKey("deDE", sha(kit)), kit);   // uploaded to the Preview bucket: served there
  assert.deepEqual(await bytesOf(await preview.get("deDE.zip")), kit);
});

test("loreforeverwow.com never redirects: linked kit, then the newest upload, then 503", async () => {
  const [linked, other, newest] = [zip("linked"), zip("other"), zip("newest")];
  const bucket = r2();
  const s = site({ bucket, linked: { deDE: sha(linked) } });
  let res = await s.get("deDE.zip");
  assert.equal(res.status, 503, "nothing uploaded yet");
  assert.ok(res.headers.get("Retry-After"));

  await s.upload("deDE", other);
  await s.upload("deDE", newest);
  res = await s.get("deDE.zip");   // the linked kit was never uploaded: the newest one rather than a broken link
  assert.equal(res.headers.get("ETag"), `"${sha(newest)}"`);
  assert.deepEqual(await bytesOf(res), newest);

  await s.upload("deDE", linked);
  res = await s.get("deDE.zip", { query: `?v=${sha(zip("never uploaded"))}` });   // unknown ?v=: the linked kit
  assert.equal(res.headers.get("ETag"), `"${sha(linked)}"`);
  assert.equal((await s.get("deDE.zip", { query: `?v=${sha(other)}` })).headers.get("ETag"), `"${sha(other)}"`);
});

test("only kit names this site links to, as .zip, by GET or HEAD", async () => {
  const s = site({ linked: { deDE: sha(zip("x")) } });
  for (const file of ["frFR.zip", "deDE.txt", "deDE", "de.zip", "..%2Fsecret.zip", "new.zip"]) {
    assert.equal((await s.get(file)).status, 404, file);
  }
  assert.equal((await s.get("deDE.zip", { method: "POST" })).status, 405);
});

test("old uploads of a kit are removed, keeping the newest KEEP and the linked one", async () => {
  const kits = Array.from({ length: KEEP + 3 }, (_, i) => zip(`deDE v${i}`));
  const s = site({ linked: { deDE: sha(kits[0]), new: sha(zip("new")) } });
  await s.upload("new", zip("new"));
  let removed = [];
  for (const k of kits) removed = removed.concat((await (await s.upload("deDE", k)).json()).removed);
  assert.deepEqual(removed.sort(), [kitKey("deDE", sha(kits[1])), kitKey("deDE", sha(kits[2]))].sort());
  const left = [...s.bucket.objects.keys()].filter(k => k.startsWith("translate-kits/deDE/"));
  assert.equal(left.length, KEEP + 1);
  assert.ok(left.includes(kitKey("deDE", sha(kits[0]))), "the linked kit stays");
  assert.ok(s.bucket.objects.has(kitKey("new", sha(zip("new")))), "other kits are left alone");
});
