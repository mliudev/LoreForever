// A profile's story read aloud (lib/storyvoice.js, LOR-316; the "storyvoice" feature, lib/features.js):
//   GET /api/profile/voice?handle=<h>        {voice: {narrator, pending, voices: {<voice>: [{url, sec, para}]}}}, or {voice: null}
//                                            while the feature is off or the story isn't a written one. Like the page,
//                                            a public profile's for anyone and a private one's for its owner (404 for
//                                            anyone else); it also starts recording a story that has none yet. The
//                                            owner's Listen box asks it while the story is being recorded.
//   PUT /api/profile/voice?narrator=<voice>  admin key: a narrator's speaker embedding (the safetensors file fal's
//                                            clone-voice endpoint made from their reference recording, at most 256 KB)
//                                            as the body -> {ok, key}. experiments/voices/local/story_voice_embed.py
//                                            sends them.

import { setup, currentUser, fail, noStore } from "../../../../lib/accounts.js";
import { authorized } from "../../../../lib/auth.js";
import { profileByHandle } from "../../../../lib/profiles.js";
import { storyVoice, embeddingKey, NARRATORS, MAX_EMBEDDING } from "../../../../lib/storyvoice.js";

const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });

async function status({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const handle = String(url.searchParams.get("handle") || "").toLowerCase();
  const p = /^[a-z0-9-]{1,40}$/.test(handle) ? await profileByHandle(env, handle) : null;
  const viewer = p && !p.public ? await currentUser(env, request) : null;
  if (!p || (!p.public && viewer?.id !== p.user_id)) return fail(404, "No profile here.");
  const voice = await storyVoice(env, p, { kick: true, origin: url.origin, waitUntil });
  return ok({ voice: voice && { narrator: voice.narrator, pending: voice.pending, voices: voice.voices } });
}

// A safetensors file: an 8-byte little-endian header length, then that much JSON.
function looksLikeSafetensors(bytes) {
  if (bytes.byteLength < 10) return false;
  const n = Number(new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(0, true));
  return n > 1 && 8 + n <= bytes.byteLength && bytes[8] === 0x7b;   // "{"
}

async function putEmbedding({ request, env }) {
  if (!(await authorized(request, env))) return fail(401, "Needs the admin key.");
  if (!env.STUDIO) return fail(503, "The STUDIO R2 binding isn't set up here.");
  const voice = new URL(request.url).searchParams.get("narrator") || "";
  if (!NARRATORS[voice]) return fail(400, `Needs ?narrator=${Object.keys(NARRATORS).join("|")}.`);
  if (Number(request.headers.get("Content-Length") || 0) > MAX_EMBEDDING) return fail(413, "That's bigger than an embedding.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_EMBEDDING) return fail(413, "That's bigger than an embedding.");
  if (!looksLikeSafetensors(bytes)) return fail(415, "That isn't a safetensors file.");
  await env.STUDIO.put(embeddingKey(voice), bytes, { httpMetadata: { contentType: "application/octet-stream" } });
  return ok({ key: embeddingKey(voice) });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return fail(503, "Profiles aren't set up yet.");
  await setup(env);
  if (request.method === "GET") return status(context);
  if (request.method === "PUT") return putEmbedding(context);
  return fail(405, "Use GET or PUT.");
}
