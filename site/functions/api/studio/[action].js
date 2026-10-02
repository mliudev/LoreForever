// The upload page, /voices/studio (lib/studio.js). Signed-in contributors only (lib/accounts.js).
//   GET  /api/studio/state?voice=ID     {signedIn, release, voices, voice, takes, limits}; takes are for voice ID (or the first voice)
//   POST /api/studio/release            {agree, adult, signature, release}: the narrator release, agreed once per account
//   POST /api/studio/voice              {name, locale}: a new draft voice; {id, name}: rename one
//   PUT  /api/studio/take?voice=&line=  the file itself as the body (.mp3 or .ogg: the page converts .wav and .flac
//                                       first); headers X-File-Name and X-Checks (both URI-encoded), X-CRC32 (hex),
//                                       X-Text-Hash (optional: the text it was recorded against, from a returned
//                                       test pack; 409 unless it is the line's current text)
//   POST /api/studio/remove             {voice, line}
//   GET  /api/studio/audio?voice=&line= plays back your own file (or any file, with the admin key)
//   GET  /api/studio/pack?voice=ID      your voice as a test pack to unzip into AddOns (or any voice, with the admin
//                                       key): a zip streamed from R2 (lib/voicepack.js, public/voices/testpack.js)
//   POST /api/studio/send               {voice, credit, discord, note}: sends the voice for review (a voice_submissions row)
//   GET  /api/studio/export?voice=ID    admin key: the voice's files and current hashes, for `lore.voicepack studio`
// Every POST and PUT must come from our own pages (Origin check).
//
// Pages settings: the R2 binding STUDIO (bucket lore-forever-voices), D1 as DB, and GOOGLE_CLIENT_ID for sign-in.

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { authorized } from "../../../lib/auth.js";
import { clean, ticked, senderHash } from "../../../lib/form.js";
import { loadVoices } from "../../../lib/voices.js";
import {
  LIMITS, sniff, setupStudio, loadLines, lineIndex, r2Key, ownVoice, createVoice, countUpload, storedBytes, cleanChecks,
} from "../../../lib/studio.js";
import { RELEASE_VERSION, PER_DAY, setupSubmissions, sentToday, insertSubmission, notify } from "../../../lib/submissions.js";
import { testPack } from "../../../lib/voicepack.js";
import { PLAYABLE } from "../../../public/voices/testpack.js";
import { crcHex } from "../../../public/voices/crc32.js";
import { perMinute, slowDown } from "../../../lib/ratelimit.js";

const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });

async function release(env, user) {
  const row = await env.DB.prepare("SELECT version, signature, adult_or_guardian, created FROM studio_release WHERE user_id = ?")
    .bind(user.id).first();
  return { version: RELEASE_VERSION, agreed: Boolean(row && row.version === RELEASE_VERSION), row };
}

async function takesOf(env, voiceId) {
  const { results } = await env.DB.prepare(
    "SELECT line_id, file_name, ext, bytes, duration_ms, hash, checks, crc32, created FROM studio_takes WHERE voice_id = ?"
  ).bind(voiceId).all();
  return Object.fromEntries(results.map(t => [t.line_id, {
    file_name: t.file_name, ext: t.ext, bytes: t.bytes, duration_ms: t.duration_ms, hash: t.hash,
    checks: JSON.parse(t.checks || "{}"), crc32: t.crc32 || null, created: t.created,
  }]));
}

// ---- GET ----

async function state({ request, env }, user) {
  if (!user) return ok({ signedIn: false });
  const { results: voices } = await env.DB.prepare(
    "SELECT v.id, v.name, v.locale, v.status, v.updated, (SELECT COUNT(*) FROM studio_takes t WHERE t.voice_id = v.id) AS files " +
    "FROM voices v WHERE v.owner = ? AND v.locale IS NOT NULL ORDER BY v.created"
  ).bind(user.id).all();
  const want = new URL(request.url).searchParams.get("voice");
  const voice = voices.find(v => v.id === want) || voices[0] || null;
  const { version, agreed } = await release(env, user);
  return ok({
    signedIn: true,
    user: { email: user.email, display_name: user.display_name },
    release: { version, agreed },
    voices,
    voice: voice ? voice.id : null,
    takes: voice ? await takesOf(env, voice.id) : {},
    limits: { bytes: LIMITS.bytes, voices: LIMITS.voices },
  });
}

async function audio({ request, env }, user) {
  const q = new URL(request.url).searchParams;
  const admin = await authorized(request, env);
  if (!user && !admin) return fail(401, "You're signed out. Please sign in again.");
  const take = await env.DB.prepare("SELECT owner, r2_key, ext FROM studio_takes WHERE voice_id = ? AND line_id = ?")
    .bind(q.get("voice") || "", q.get("line") || "").first();
  if (!take || (!admin && take.owner !== user.id)) return fail(404, "No file for that line.");
  const obj = await env.STUDIO.get(take.r2_key);
  if (!obj) return fail(404, "No file for that line.");
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  obj.writeHttpMetadata(headers);
  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { headers });
}

async function pack({ request, env }, user) {
  const admin = await authorized(request, env);
  if (!user && !admin) return fail(401, "You're signed out. Please sign in again.");
  const id = new URL(request.url).searchParams.get("voice") || "";
  const voice = await env.DB.prepare("SELECT id, owner, name, locale FROM voices WHERE id = ?").bind(id).first();
  if (!voice || !voice.locale || (!admin && voice.owner !== user.id)) return fail(404, "That isn't one of your voices.");
  const { results: takes } = await env.DB.prepare(
    "SELECT line_id, r2_key, ext, hash, crc32, created FROM studio_takes WHERE voice_id = ?"
  ).bind(voice.id).all();
  const saveCrc = (t, crc) => env.DB.prepare("UPDATE studio_takes SET crc32 = ? WHERE voice_id = ? AND line_id = ? AND r2_key = ?")
    .bind(crcHex(crc), voice.id, t.line_id, t.r2_key).run();
  const built = await testPack({ voice, takes, index: lineIndex(await loadLines(env, request)), bucket: env.STUDIO, saveCrc });
  if (!built) return fail(404, "None of your recordings can go in a test pack yet. Upload a line first.");
  let body = built.stream;
  if (typeof FixedLengthStream === "function") {   // Workers: send Content-Length, so the download shows its progress
    const fixed = new FixedLengthStream(built.length);
    built.stream.pipeTo(fixed.writable).catch(() => {});
    body = fixed.readable;
  }
  return new Response(body, { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${built.folder}.zip"`,
    "Content-Length": String(built.length),
    "Cache-Control": "private, no-store",
    "X-Pack-Lines": String(built.lines),
  } });
}

async function exportVoice({ request, env }) {
  if (!(await authorized(request, env))) return fail(401, "Needs the admin key.");
  const id = new URL(request.url).searchParams.get("voice") || "";
  const voice = await env.DB.prepare("SELECT id, owner, name, locale, status FROM voices WHERE id = ?").bind(id).first();
  if (!voice || !voice.locale) return fail(404, "No such voice on the upload page.");
  const lines = lineIndex(await loadLines(env, request));
  const takes = await takesOf(env, id);
  return ok({
    voice,
    takes: Object.entries(takes).map(([line, t]) => ({
      line, file: lines[line]?.file || null, ext: t.ext, hash: t.hash, current: lines[line]?.hash[voice.locale] || null,
      bytes: t.bytes, checks: t.checks, file_name: t.file_name,
    })),
  });
}

// ---- POST / PUT ----

async function agree({ env }, user, input) {
  if (!ticked(input.agree)) return fail(400, "Please read the narrator release and tick the box to agree to it.");
  if (clean(input.release, 20) !== RELEASE_VERSION) {
    return fail(409, "The narrator release was updated since this page loaded. Reload the page, read the new version, and agree again.");
  }
  if (!ticked(input.adult)) return fail(400, "Please confirm you're 18 or older, or that a parent or guardian agrees.");
  const signature = clean(input.signature, 100);
  if (signature.length < 2) return fail(400, "Type your full name as your signature.");
  await env.DB.prepare(
    "INSERT INTO studio_release (user_id, version, signature, adult_or_guardian, created) VALUES (?, ?, ?, 1, ?) " +
    "ON CONFLICT (user_id) DO UPDATE SET version = excluded.version, signature = excluded.signature, created = excluded.created"
  ).bind(user.id, RELEASE_VERSION, signature, new Date().toISOString()).run();
  return ok();
}

async function voice({ request, env }, user, input) {
  const name = clean(input.name, 60);
  if (name.length < 2) return fail(400, "Give your voice a name. You can change it later.");
  if (input.id) {
    const res = await env.DB.prepare("UPDATE voices SET name = ?, updated = ? WHERE id = ? AND owner = ?")
      .bind(name, new Date().toISOString(), clean(input.id, 60), user.id).run();
    return res.meta.changes ? ok() : fail(404, "That isn't one of your voices.");
  }
  const locale = clean(input.locale, 8);
  const lines = await loadLines(env, request);
  if (!lines.languages.some(l => l.locale === locale && l.lines > 0)) return fail(400, "Pick a language for this voice.");
  const taken = new Set((await loadVoices(env, request)).map(v => v.id));
  const made = await createVoice(env, user, name, locale, taken);
  return made.error ? fail(400, made.error) : ok({ id: made.id });
}

async function take(context, user) {
  const { request, env } = context;
  if (!(await release(env, user)).agreed) return fail(403, "Please agree to the narrator release first.");
  const q = new URL(request.url).searchParams;
  const v = await ownVoice(env, user, q.get("voice"));
  if (!v || !v.locale) return fail(404, "That isn't one of your voices.");
  const lineId = q.get("line") || "";
  const line = lineIndex(await loadLines(env, request))[lineId];
  const hash = line?.hash[v.locale];
  if (!hash) return fail(400, "That line has no text in this voice's language yet.");
  const recorded = (request.headers.get("X-Text-Hash") || "").toLowerCase();
  if (recorded && recorded !== hash) return fail(409, "This recording is of older text: we reworded the line since. Record the new text.");
  if (!(await perMinute(env, user.id, "studio-take", LIMITS.uploadsPerMinute))) return slowDown();
  const size = Number(request.headers.get("Content-Length") || 0);
  if (size > LIMITS.bytes) return fail(413, `That file is over ${LIMITS.bytes / 1024 / 1024} MB. Export it as .mp3 or .ogg to make it smaller.`);
  const body = await request.arrayBuffer();
  if (!body.byteLength) return fail(400, "That file is empty.");
  if (body.byteLength > LIMITS.bytes) return fail(413, `That file is over ${LIMITS.bytes / 1024 / 1024} MB. Export it as .mp3 or .ogg to make it smaller.`);
  const kind = sniff(body);
  if (!kind) return fail(415, "We take .mp3, .ogg, .wav or .flac files. Export the recording in one of those.");
  if (!PLAYABLE.includes(kind.ext)) {   // the game plays .mp3 and .ogg only; the page converts the rest before upload
    return fail(415, "Reload this page and upload the file again: the page now turns .wav and .flac into .mp3 first.");
  }
  const crc = (request.headers.get("X-CRC32") || "").toLowerCase();
  if ((await storedBytes(env, user, v.id, lineId)) + body.byteLength > LIMITS.accountBytes) {
    return fail(413, "Your account is out of space for recordings. Remove some files, or ask us on Discord.");
  }
  if (!(await countUpload(env, user))) return fail(429, "That's a lot of uploads for one day. Please carry on tomorrow.");

  const key = r2Key(user.id, v.id, line.file, kind.ext);
  const old = await env.DB.prepare("SELECT r2_key FROM studio_takes WHERE voice_id = ? AND line_id = ?").bind(v.id, lineId).first();
  await env.STUDIO.put(key, body, { httpMetadata: { contentType: kind.type } });
  if (old && old.r2_key !== key) await env.STUDIO.delete(old.r2_key);
  let fileName = "";
  try { fileName = decodeURIComponent(request.headers.get("X-File-Name") || ""); } catch (e) {}
  let checks = "{}";
  try { checks = cleanChecks(decodeURIComponent(request.headers.get("X-Checks") || "")); } catch (e) {}
  const duration = Math.round((JSON.parse(checks).duration || 0) * 1000) || null;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO studio_takes (voice_id, line_id, owner, r2_key, file_name, ext, bytes, duration_ms, hash, checks, crc32, created) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (voice_id, line_id) DO UPDATE SET r2_key = excluded.r2_key, " +
      "file_name = excluded.file_name, ext = excluded.ext, bytes = excluded.bytes, duration_ms = excluded.duration_ms, " +
      "hash = excluded.hash, checks = excluded.checks, crc32 = excluded.crc32, created = excluded.created"
    ).bind(v.id, lineId, user.id, key, clean(fileName, 120) || null, kind.ext, body.byteLength, duration, hash, checks,
           /^[0-9a-f]{8}$/.test(crc) ? crc : null, now),
    env.DB.prepare("UPDATE voices SET updated = ? WHERE id = ?").bind(now, v.id),
  ]);
  return ok({ take: { file_name: clean(fileName, 120) || null, ext: kind.ext, bytes: body.byteLength, duration_ms: duration,
                      hash, checks: JSON.parse(checks), crc32: /^[0-9a-f]{8}$/.test(crc) ? crc : null, created: now } });
}

async function remove({ env }, user, input) {
  const t = await env.DB.prepare("SELECT r2_key FROM studio_takes WHERE voice_id = ? AND line_id = ? AND owner = ?")
    .bind(clean(input.voice, 60), clean(input.line, 80), user.id).first();
  if (!t) return ok();
  await env.STUDIO.delete(t.r2_key);
  await env.DB.prepare("DELETE FROM studio_takes WHERE voice_id = ? AND line_id = ? AND owner = ?")
    .bind(clean(input.voice, 60), clean(input.line, 80), user.id).run();
  return ok();
}

async function send({ request, env, waitUntil }, user, input) {
  const v = await ownVoice(env, user, input.voice);
  if (!v || !v.locale) return fail(404, "That isn't one of your voices.");
  const { agreed, row } = await release(env, user);
  if (!agreed) return fail(403, "Please agree to the narrator release first.");
  const lines = await loadLines(env, request);
  const index = lineIndex(lines);
  const takes = await takesOf(env, v.id);
  const current = Object.entries(takes).filter(([id, t]) => index[id]?.hash[v.locale] === t.hash).length;
  if (!current) return fail(400, "Upload at least one line before you send your voice.");
  const credit = clean(input.credit, 100);
  if (!credit) return fail(400, "Tell us how to credit you (a name, a handle, or Anonymous).");

  const now = new Date().toISOString();
  const sender = await senderHash(request.headers.get("CF-Connecting-IP") || "", now.slice(0, 10));
  await setupSubmissions(env);
  if ((await sentToday(env, sender, now.slice(0, 10))) >= PER_DAY) {
    return fail(429, "That's a lot of submissions for one day. Please try again tomorrow, or ask on Discord.");
  }
  const total = lines.languages.find(l => l.locale === v.locale)?.lines || 0;
  const s = {
    created: now, credit, email: user.email || null, discord: clean(input.discord, 40).replace(/^@/, "") || null,
    pack: v.name, link: `studio:${v.id}`, clips: `${current} of ${total} lines (${v.locale}), uploaded on the site`,
    note: clean(input.note, 2000) || null, release_version: row.version, adult_or_guardian: row.adult_or_guardian,
    signature: row.signature, country: request.cf?.country || null, sender, user_id: user.id, voice_id: v.id,
  };
  s.id = await insertSubmission(env, s);
  await env.DB.prepare("UPDATE voices SET status = 'pending', updated = ? WHERE id = ?").bind(now, v.id).run();
  if (env.VOICES_WEBHOOK) waitUntil(notify(env.VOICES_WEBHOOK, s));
  return ok({ lines: current });
}

const USER_POSTS = { release: agree, voice, remove, send };

export async function onRequest(context) {
  const { request, env, params } = context;
  const action = String(params.action);
  if (!env.DB || !env.STUDIO) return fail(503, "Uploads aren't switched on yet. Please ask on Discord.");
  await setup(env);
  await setupStudio(env);
  const user = await currentUser(env, request);
  if (request.method === "GET") {
    if (action === "state") return state(context, user);
    if (action === "audio") return audio(context, user);
    if (action === "export") return exportVoice(context);
    if (action === "pack") return pack(context, user);
    return fail(404, "Not found.");
  }
  if (!sameOrigin(request)) return fail(403, "Please use the upload page on loreforeverwow.com.");
  if (!user) return fail(401, "You're signed out. Please sign in again.");
  if (request.method === "PUT" && action === "take") return take(context, user);
  if (request.method !== "POST" || !USER_POSTS[action]) return fail(404, "Not found.");
  let input;
  try {
    input = await request.json();
  } catch (e) {
    return fail(400, "Couldn't read that.");
  }
  return USER_POSTS[action](context, user, input);
}
