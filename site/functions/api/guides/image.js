// A picture for a guide (lib/guides-cms.js): POST the image itself (PNG, JPEG, WebP or GIF, up to 8 MB; the editor
// shrinks big ones first) with its Content-Type. Editors only. -> {ok, url: "/guides/img/<name>"}, served by
// functions/guides/img/[name].js.

import { fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { editorFor, IMAGE_MAX, IMAGE_TYPES, imageKey } from "../../../lib/guides-cms.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return fail(403, "Not from this site.");
  const who = await editorFor(env, request);
  if (who.error) return fail(who.status, who.error);
  if (!env.STUDIO) return fail(503, "Picture storage isn't set up here.");
  const type = String(request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) return fail(415, "Pictures can be PNG, JPEG, WebP or GIF.");
  const body = await request.arrayBuffer();
  if (!body.byteLength) return fail(400, "That picture is empty.");
  if (body.byteLength > IMAGE_MAX) return fail(413, "Pictures can be up to 8 MB.");
  const name = `${[...crypto.getRandomValues(new Uint8Array(10))].map(b => b.toString(16).padStart(2, "0")).join("")}.${ext}`;
  await env.STUDIO.put(imageKey(name), body, { httpMetadata: { contentType: type }, customMetadata: { by: who.user.email || "" } });
  return Response.json({ ok: true, url: `/guides/img/${name}` }, { headers: noStore });
}
