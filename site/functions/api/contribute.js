// POST /api/contribute: Forever text players share (LOR-235), from /contribute (a dropped LoreForever.lua, read in the
// browser by public/contribute/svparse.js, or one line from the add-on's Contribute code) or from the companion app.
// No sign-in needed; a signed-in session adds credit. The rules, statuses and tables are in lib/contribute.js and
// site/CONTRIBUTE_API.md.
//
// Body (JSON): {lines: [{kind, ref_id, part, locale, build, text, speaker?, player?, mode?}], nick?, install?,
//   source: "file" | "code" | "companion", website: "", preview?: true, locale?, build?, version?}
//   locale, build and version at the top fill in lines that don't say; install is the SHA-256 (hex) of the add-on
//   install's random id, so one player's uploads count as one sender; website is the honeypot; preview counts
//   without saving anything (the page's "N new, M already known").
// Reply: {ok, upload_id, receipt, new, known, confirmed, total, invalid}. 429 with retryAfter past the hourly limit.
// The companion sends X-LF-Client: companion/<version> and no Origin; browsers must come from our own pages.

import { clean } from "../../lib/form.js";
import { currentUser, sameOrigin, noStore, fail, setup as setupAccounts } from "../../lib/accounts.js";
import { perHour } from "../../lib/ratelimit.js";
import { LIMITS, RATE, setup, cleanLine, cleanNick, loadKnown, ingest, uploaderOf, ipHashOf, expireHashes, nowSec }
  from "../../lib/contribute.js";

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.DB) return fail(503, "Sharing text isn't switched on yet.");
  const client = request.headers.get("X-LF-Client") || "";
  const companion = /^companion\/[\w.-]{1,24}$/.test(client) && !request.headers.get("Origin");
  if (!companion && !sameOrigin(request)) return fail(403, "Please use the page on loreforeverwow.com.");
  if (Number(request.headers.get("Content-Length") || 0) > LIMITS.body) {
    return fail(413, "That's too much at once. Share it in smaller parts.");
  }
  let body;
  try {
    const raw = await request.text();
    if (raw.length > LIMITS.body) return fail(413, "That's too much at once. Share it in smaller parts.");
    body = JSON.parse(raw);
  } catch (e) {
    return fail(400, "Couldn't read that.");
  }
  if (!body || typeof body !== "object" || !Array.isArray(body.lines) || !body.lines.length) {
    return fail(400, "There's nothing to share in that.");
  }
  const total = body.lines.length;
  // Bots fill every field; people never see this one. Pretend it worked.
  if (clean(body.website, 10)) {
    return Response.json({ ok: true, upload_id: null, receipt: null, new: 0, known: total, confirmed: 0, total,
                           invalid: 0 }, { headers: noStore });
  }
  if (total > LIMITS.lines) return fail(413, `At most ${LIMITS.lines.toLocaleString("en")} lines at a time.`);
  const source = companion ? "companion" : body.source === "code" ? "code" : "file";
  if (source === "code" && total !== 1) return fail(400, "A code carries one line.");
  const preview = body.preview === true;

  const ipHash = await ipHashOf(env, request);
  await setupAccounts(env);
  await setup(env);
  const now = new Date();
  if (!(await perHour(env, "ip:" + ipHash, preview ? "contrib-preview" : "contrib-" + source,
                      preview ? RATE.preview : RATE[source], now))) {
    const retryAfter = 3600 - (now.getUTCMinutes() * 60 + now.getUTCSeconds());
    return Response.json({ ok: false, error: "That's a lot of sharing for one hour. Thanks! Try again a bit later.",
                           retryAfter }, { status: 429, headers: { ...noStore, "Retry-After": String(retryAfter) } });
  }

  const fallback = { locale: body.locale, build: body.build };
  const lines = [];
  let invalid = 0;
  for (const raw of body.lines) {
    const line = await cleanLine(raw, fallback);
    if (line) lines.push(line); else invalid++;
  }
  if (!lines.length) return fail(400, "None of those lines could be read.");

  const user = await currentUser(env, request);
  const install = typeof body.install === "string" && /^[0-9a-f]{64}$/.test(body.install) ? body.install : null;
  const who = { user, nick: cleanNick(body.nick), ipHash, install };
  who.uploader = uploaderOf(who);
  const known = await loadKnown(env, request);
  const meta = { invalid, version: typeof body.version === "string" ? body.version.slice(0, 24) : null,
                 build: lines[0].build, locale: lines[0].locale };
  const result = await ingest(env, { lines, known, who, source, dry: preview, meta, now: nowSec() });
  if (!preview) waitUntil(expireHashes(env).catch(() => {}));
  return Response.json({
    ok: true, preview: preview || undefined, upload_id: result.upload_id || null,
    receipt: result.upload_id ? `/contribute/r/${result.upload_id}` : null,
    new: result.new, known: result.known, confirmed: result.confirmed, total: result.total + invalid, invalid,
  }, { headers: noStore });
}
