import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest as serve } from "../functions/willo-assets/[sha]/[file].js";
import { onRequest as admin } from "../functions/api/admin/willo-assets.js";

const SHA = "a".repeat(64);
const bytes = new TextEncoder().encode("0123456789");
const bucket = {
  objects: { [`willo-assets/${SHA}/model.onnx`]: bytes },
  async head(k) { const o = this.objects[k]; return o ? { size: o.length } : null; },
  async get(k, opts) {
    const o = this.objects[k];
    if (!o) return null;
    const r = opts?.range;
    const start = r?.offset ?? 0, end = r?.length != null ? start + r.length : o.length;
    return { size: o.length, body: o.slice(start, end) };
  },
};
const get = (sha, file, headers = {}, method = "GET") => serve({
  request: new Request(`https://loreforeverwow.com/willo-assets/${sha}/${file}`, { method, headers }),
  env: { STUDIO: bucket }, params: { sha, file },
});

test("Willo's mirrored downloads are served whole or by range, and only at a full sha256 address", async () => {
  const whole = await get(SHA, "model.onnx");
  assert.equal(whole.status, 200);
  assert.equal(await whole.text(), "0123456789");
  assert.match(whole.headers.get("Cache-Control"), /immutable/);
  const part = await get(SHA, "model.onnx", { Range: "bytes=2-4" });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("Content-Range"), "bytes 2-4/10");
  assert.equal(await part.text(), "234");
  assert.equal((await get(SHA, "model.onnx", {}, "HEAD")).headers.get("Content-Length"), "10");
  assert.equal((await get(SHA, "other.onnx")).status, 404);
  assert.equal((await get("abc", "model.onnx")).status, 404);          // not a sha256
  assert.equal((await get(SHA, "..%2Fx")).status, 404);                 // not a plain file name
});

test("only the admin key may put a file in the mirror", async () => {
  const res = await admin({
    request: new Request(`https://loreforeverwow.com/api/admin/willo-assets?sha256=${SHA}&file=x.bin&action=start`,
      { method: "POST", headers: { "X-Admin-Key": "wrong" } }),
    env: { STUDIO: bucket, ADMIN_KEY: "right" },
  });
  assert.equal(res.status, 401);
});
