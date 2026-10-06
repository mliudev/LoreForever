// POST /api/profile/voice/hook?s=<story>&v=<voice>&i=<part>&t=<token>: fal.ai's webhook with one recorded part of a
// profile's story (lib/storyvoice.js saveTake, LOR-316). The token is an HMAC of the part made with FAL_KEY, so only
// the request we sent can post it. fal retries anything but a 2xx for about an hour, so a take that couldn't be
// fetched or stored answers 502, and everything else (saved, a replaced story, a failed take) 200.

import { setup } from "../../../../lib/accounts.js";
import { saveTake } from "../../../../lib/storyvoice.js";

const MAX_BODY = 64 * 1024;   // fal's webhook names the take's address; the take itself isn't in it

export async function onRequestPost({ request, env }) {
  const reply = status => Response.json({ ok: status === 200 }, { status, headers: { "Cache-Control": "no-store" } });
  if (!env.DB || !env.STUDIO) return reply(503);
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) return reply(413);
  let body = null;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return reply(413);
    body = JSON.parse(text);
  } catch (e) {
    return reply(400);
  }
  await setup(env);
  const url = new URL(request.url);
  return reply(await saveTake(env, url.searchParams, body, url.origin));
}
