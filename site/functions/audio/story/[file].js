// /audio/story/<story>-<voice>-<part>-<sha>.mp3: one recorded part of a profile's story (lib/storyvoice.js, LOR-316),
// from R2 (the STUDIO bucket, story-voice/<user id>/<story>/<voice>-<part>.mp3). Like the picture book's files: a
// public profile's for anyone, a private one's for its owner only, and a recording of a story that's been replaced is
// a 404. The address names the recording's content, so browsers may keep it for a year. Range requests get a 206
// (Safari won't play audio without them).

import { setup, currentUser } from "../../../lib/accounts.js";
import { setupStoryVoice, takeKey, TAKE_FILE } from "../../../lib/storyvoice.js";
import { parseRange } from "../clip/[voice]/[file].js";

const text = (status, body, headers = {}) => new Response(body, {
  status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers },
});

export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") return text(405, "Use GET.\n", { Allow: "GET, HEAD" });
  const m = TAKE_FILE.exec(String(params.file || ""));
  if (!m || !env.DB || !env.STUDIO) return text(404, "Not found.\n");
  const [, story, voice, part, sha] = m;
  await setup(env);
  await setupStoryVoice(env);
  const row = await env.DB.prepare(
    "SELECT a.user_id, a.sha, a.status, p.public FROM story_audio a JOIN profiles p ON p.user_id = a.user_id " +
    "WHERE a.story = ? AND a.voice = ? AND a.part = ?"
  ).bind(story, voice, Number(part)).first();
  if (!row || row.status !== "done" || row.sha !== sha) return text(404, "Not found.\n");
  const open = row.public === 1;
  if (!open && (await currentUser(env, request))?.id !== row.user_id) return text(404, "Not found.\n");
  const headers = {
    "Content-Type": "audio/mpeg",
    "Cache-Control": `${open ? "public" : "private"}, max-age=31536000, immutable`,
    "Accept-Ranges": "bytes",
    "X-Robots-Tag": "noindex",
    ETag: `"${sha}"`,
    ...(open ? {} : { Vary: "Cookie" }),
  };
  if ((request.headers.get("If-None-Match") || "").includes(`"${sha}"`)) return new Response(null, { status: 304, headers });
  const key = takeKey(row.user_id, story, voice, Number(part));
  const range = request.method === "GET" ? parseRange(request.headers.get("Range")) : null;
  let obj = null;
  try {
    obj = request.method === "HEAD" ? await env.STUDIO.head(key) : await env.STUDIO.get(key, range ? { range } : undefined);
  } catch (e) {
    if (!range) throw e;
    const whole = await env.STUDIO.head(key);   // R2 refuses a range past the end of the file
    if (whole) return text(416, "Range not satisfiable.\n", { "Content-Range": `bytes */${whole.size}` });
  }
  if (!obj) return text(404, "Not found.\n");
  const size = obj.size;
  if (request.method === "HEAD") return new Response(null, { headers: { ...headers, "Content-Length": String(size) } });
  if (!range) return new Response(obj.body, { headers: { ...headers, "Content-Length": String(size) } });
  const start = range.suffix != null ? Math.max(0, size - range.suffix) : range.offset;
  const end = range.length != null ? Math.min(size, start + range.length) - 1 : size - 1;
  if (start >= size) return text(416, "Range not satisfiable.\n", { "Content-Range": `bytes */${size}` });
  return new Response(obj.body, {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
  });
}
