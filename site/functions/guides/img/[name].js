// /guides/img/<name>: a picture put in a guide with the editor (lib/guides-cms.js), from R2. Names are random and never
// reused, so it's cached for good.

import { IMAGE_NAME, imageKey } from "../../../lib/guides-cms.js";

export async function onRequestGet({ env, params }) {
  const name = String(params.name || "");
  const obj = IMAGE_NAME.test(name) && env.STUDIO ? await env.STUDIO.get(imageKey(name)) : null;
  if (!obj) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-cache" } });
  const headers = new Headers({ "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
  obj.writeHttpMetadata(headers);
  return new Response(obj.body, { headers });
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
