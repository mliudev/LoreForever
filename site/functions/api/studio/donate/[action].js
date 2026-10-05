// "Lend your voice" (LOR-230, lib/donate.js): a donated 2-3 minute sample we make a narrator voice from.
// Signed in (the donor):
//   GET  /api/studio/donate/state        {signedIn, user, consent: {version, agreed}, donation (or null)}
//   POST /api/studio/donate/consent      {agree, own, adult, signature, version}: the donation terms
//   PUT  /api/studio/donate/sample       the recording as the body (.mp3 or Ogg Vorbis: the page converts the rest);
//                                        headers X-Checks and X-Credit (URI-encoded), X-Script (the script version
//                                        read), X-CRC32. Needs the current terms. Replaces the sample while it's
//                                        still waiting (status donated); after that, withdraw first.
//   POST /api/studio/donate/credit       {credit}: the name players see ("voice by ...")
//   POST /api/studio/donate/withdraw     {id}: deletes the sample and test pack, status withdrawn; the row keeps only
//                                        the record of the agreement (lib/donate.js RECORD_ONLY)
//   GET  /api/studio/donate/audio?id=    your sample (or any, with the admin key)
//   GET  /api/studio/donate/pack?id=     your test pack, once it's ready (or any, with the admin key)
// Admin key (pipeline/lore/donation.py):
//   GET  /api/studio/donate/export       {donations: [...]}: every donation with its status, withdrawn ones included
//                                        (so the tooling deletes its local copies)
//   POST /api/studio/donate/status       {id, status, voice_id?, title?}: rendering, ready, published (voice_id: the
//                                        voices.json id; makes the `voices` row with the donor as owner) or donated
//   PUT  /api/studio/donate/pack?id=     the test pack zip as the body; header X-Pack-Lines, X-Pack-Title (URI-encoded)
// Every POST and PUT from a donor must come from our own pages (Origin check).

import { setup, currentUser, fail, noStore, sameOrigin, RESERVED } from "../../../../lib/accounts.js";
import { authorized } from "../../../../lib/auth.js";
import { clean, ticked } from "../../../../lib/form.js";
import { sniff, cleanChecks, setupStudio } from "../../../../lib/studio.js";
import { perDay } from "../../../../lib/ratelimit.js";
import { PLAYABLE } from "../../../../public/voices/testpack.js";
import {
  CONSENT_VERSION, DONATE, STATUSES, RECORD_ONLY, donationKey, newId, consentOf, activeDonation, view, notifyDonation,
  setupDonations,
} from "../../../../lib/donate.js";

const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });
const now = () => new Date().toISOString();
const header = (request, name, max) => {
  try { return clean(decodeURIComponent(request.headers.get(name) || ""), max); } catch (e) { return ""; }
};

// ---- The donor ----

async function state({ env }, user) {
  if (!user) return ok({ signedIn: false, consent: { version: CONSENT_VERSION, agreed: false } });
  const { version, agreed } = await consentOf(env, user);
  return ok({
    signedIn: true, user: { display_name: user.display_name }, consent: { version, agreed },
    donation: view(await activeDonation(env, user.id)),
  });
}

async function consent({ env }, user, input) {
  if (clean(input.version, 20) !== CONSENT_VERSION) {
    return fail(409, "The terms were updated since this page loaded. Reload the page, read the new version, and agree again.");
  }
  if (!ticked(input.agree)) return fail(400, "Please read the terms and tick the box to agree to them.");
  if (!ticked(input.own)) return fail(400, "Please confirm the voice in the recording is your own, recorded by you.");
  if (!ticked(input.adult)) return fail(400, "Please confirm you're 18 or older. Lending a voice is for adults only.");
  const signature = clean(input.signature, 100);
  if (signature.length < 2) return fail(400, "Type your full name as your signature.");
  await env.DB.prepare(
    "INSERT INTO donation_release (user_id, version, signature, adult, created) VALUES (?, ?, ?, 1, ?) " +
    "ON CONFLICT (user_id) DO UPDATE SET version = excluded.version, signature = excluded.signature, created = excluded.created"
  ).bind(user.id, CONSENT_VERSION, signature, now()).run();
  return ok();
}

async function sample({ request, env, waitUntil }, user) {
  const { agreed, row: terms } = await consentOf(env, user);
  if (!agreed) return fail(403, "Please agree to the terms first.");
  const old = await activeDonation(env, user.id);
  if (old && old.status !== "donated") {
    return fail(409, "We've started making your voice from your recording. To send a new one, withdraw this one first.");
  }
  if (Number(request.headers.get("Content-Length") || 0) > DONATE.maxBytes) return fail(413, "That file is over 25 MB.");
  if (!(await perDay(env, user.id, "donate", DONATE.perDay))) return fail(429, "That's a lot of recordings for one day. Please try again tomorrow.");
  const body = await request.arrayBuffer();
  if (body.byteLength > DONATE.maxBytes) return fail(413, "That file is over 25 MB.");
  if (body.byteLength < DONATE.minBytes) return fail(400, "That recording is very short. Read the whole script: about 2 to 3 minutes.");
  const kind = sniff(body);
  if (!kind) return fail(415, "We take .mp3, .m4a, .ogg, .wav, .flac and .webm files. Record again, or export it in one of those.");
  if (!PLAYABLE.includes(kind.ext)) return fail(415, "Reload this page and send it again: the page turns this kind of file into .mp3 first.");
  const checks = cleanChecks(header(request, "X-Checks", 2000));
  const seconds = JSON.parse(checks).duration || 0;
  if (seconds && seconds < DONATE.minSeconds) return fail(400, "That recording is under a minute. Read the whole script: about 2 to 3 minutes.");
  if (seconds > DONATE.maxSeconds) return fail(400, "That recording is over 5 minutes. Read the script once, at an easy pace.");
  const crc = (request.headers.get("X-CRC32") || "").toLowerCase();
  const credit = header(request, "X-Credit", 60) || clean(user.display_name, 60) || "Anonymous";
  const script = header(request, "X-Script", 20) || null;

  const id = old?.id || newId(), key = donationKey(user.id, id, `sample.${kind.ext}`), stamp = now();
  await env.STUDIO.put(key, body, { httpMetadata: { contentType: kind.type } });
  if (old?.r2_key && old.r2_key !== key) await env.STUDIO.delete(old.r2_key);
  // The donation keeps its own copy of the terms as signed (version, signature, age box, when), the record that stays.
  const fields = [credit, key, kind.ext, body.byteLength, Math.round(seconds * 1000) || null, checks,
                  /^[0-9a-f]{8}$/.test(crc) ? crc : null, script, terms.version, terms.signature, terms.created,
                  terms.adult ? 1 : 0, stamp];
  if (old) {
    await env.DB.prepare(
      "UPDATE voice_donations SET credit = ?, r2_key = ?, ext = ?, bytes = ?, duration_ms = ?, checks = ?, crc32 = ?, script = ?, " +
      "consent_version = ?, signature = ?, consented = ?, adult = ?, updated = ? WHERE id = ? AND status = 'donated'"
    ).bind(...fields, id).run();
  } else {
    try {
      await env.DB.prepare(
        "INSERT INTO voice_donations (credit, r2_key, ext, bytes, duration_ms, checks, crc32, script, consent_version, signature, " +
        "consented, adult, updated, id, owner, status, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'donated', ?)"
      ).bind(...fields, id, user.id, stamp).run();
    } catch (e) {   // a second tab sent one a moment ago (one donation per account)
      await env.STUDIO.delete(key);
      return fail(409, "You've sent a recording already. Reload the page to see it.");
    }
  }
  const d = await activeDonation(env, user.id);
  if (env.VOICES_WEBHOOK) waitUntil(notifyDonation(env.VOICES_WEBHOOK, d, old ? "replaced" : "new"));
  return ok({ donation: view(d) });
}

async function credit({ env }, user, input) {
  const name = clean(input.credit, 60);
  if (name.length < 2) return fail(400, "Type the name players should see, or Anonymous.");
  const res = await env.DB.prepare("UPDATE voice_donations SET credit = ?, updated = ? WHERE owner = ? AND status != 'withdrawn'")
    .bind(name, now(), user.id).run();
  return res.meta.changes ? ok({ credit: name }) : fail(404, "You haven't lent your voice yet.");
}

// Deletes everything stored for a donation (the sample, the test pack, anything else in its folder).
async function deleteFiles(env, d) {
  const prefix = donationKey(d.owner, d.id, "");
  let cursor;
  do {
    const page = await env.STUDIO.list({ prefix, cursor });
    if (page.objects.length) await env.STUDIO.delete(page.objects.map(o => o.key));
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
}

async function withdraw({ env, waitUntil }, user, input) {
  const d = await activeDonation(env, user.id);
  if (!d || (input.id && clean(input.id, 20) !== d.id)) return fail(404, "There's nothing to withdraw: you have no voice lent to us.");
  await deleteFiles(env, d);
  const stamp = now();
  // Only the record of the agreement stays (lib/donate.js RECORD_ONLY): no files, no file details, no credit.
  await env.DB.prepare(
    `UPDATE voice_donations SET status = 'withdrawn', withdrawn = ?, updated = ?, ${RECORD_ONLY} WHERE id = ?`
  ).bind(stamp, stamp, d.id).run();
  // A published voice drops off the site at once: its voices.json entry needs a `voices` row with this owner.
  if (d.voice_id) await env.DB.prepare("DELETE FROM voices WHERE id = ? AND owner = ? AND locale IS NULL").bind(d.voice_id, user.id).run();
  if (env.VOICES_WEBHOOK) waitUntil(notifyDonation(env.VOICES_WEBHOOK, d, "withdrawn"));
  return ok({ withdrawn: stamp });
}

// ---- Files (the donor, or the admin key) ----

async function fileOf({ request, env }, user, which) {
  const admin = await authorized(request, env);
  if (!user && !admin) return fail(401, "You're signed out. Please sign in again.");
  const id = clean(new URL(request.url).searchParams.get("id"), 20);
  const d = await env.DB.prepare("SELECT * FROM voice_donations WHERE id = ?").bind(id).first();
  if (!d || (!admin && d.owner !== user.id)) return fail(404, "No such recording.");
  const key = which === "pack" ? d.pack_key : d.r2_key;
  const obj = key && await env.STUDIO.get(key);
  if (!obj) return fail(404, which === "pack" ? "Your test pack isn't ready yet." : "No such recording.");
  const headers = new Headers({ "Cache-Control": "private, no-store", "Content-Length": String(obj.size) });
  obj.writeHttpMetadata(headers);
  if (which === "pack") {
    headers.set("Content-Type", "application/zip");
    headers.set("Content-Disposition", `attachment; filename="lore-forever-voice-${d.id}.zip"`);
  }
  return new Response(obj.body, { headers });
}

// ---- Admin key ----

async function exportAll({ env }) {
  const { results } = await env.DB.prepare(
    "SELECT d.*, u.display_name FROM voice_donations d LEFT JOIN users u ON u.id = d.owner ORDER BY d.created"
  ).all();
  return ok({ donations: results.map(d => ({
    ...view(d), owner: d.owner, ext: d.ext, crc32: d.crc32, voice_id: d.voice_id, has_sample: Boolean(d.r2_key),
  })) });
}

async function setStatus({ env }, input) {
  const status = clean(input.status, 20);
  if (!STATUSES.includes(status) || status === "withdrawn") return fail(400, "status: donated, rendering, ready or published.");
  const d = await env.DB.prepare("SELECT * FROM voice_donations WHERE id = ?").bind(clean(input.id, 20)).first();
  if (!d) return fail(404, "No such donation.");
  if (d.status === "withdrawn") return fail(410, "Withdrawn by the donor: leave it out.");
  let voiceId = d.voice_id;
  if (status === "published") {
    voiceId = clean(input.voice_id, 40);
    if (!/^[a-z0-9-]{2,40}$/.test(voiceId) || RESERVED.has(voiceId)) return fail(400, "voice_id: the voices.json id (letters, digits, dashes).");
    await env.DB.prepare("INSERT INTO voices (id, owner, name, status, created, updated) VALUES (?, ?, ?, 'published', ?, ?) ON CONFLICT (id) DO NOTHING")
      .bind(voiceId, d.owner, clean(input.title, 60) || `${d.credit}'s voice`, now(), now()).run();
    const v = await env.DB.prepare("SELECT owner FROM voices WHERE id = ?").bind(voiceId).first();
    if (v.owner !== d.owner) return fail(409, `The voice id ${voiceId} belongs to someone else. Pick another.`);
  }
  await env.DB.prepare("UPDATE voice_donations SET status = ?, voice_id = ?, updated = ? WHERE id = ?").bind(status, voiceId, now(), d.id).run();
  return ok({ status, voice_id: voiceId, owner: d.owner });
}

async function putPack({ request, env }) {
  const d = await env.DB.prepare("SELECT * FROM voice_donations WHERE id = ?").bind(clean(new URL(request.url).searchParams.get("id"), 20)).first();
  if (!d) return fail(404, "No such donation.");
  if (d.status === "withdrawn") return fail(410, "Withdrawn by the donor: don't upload it.");
  const body = await request.arrayBuffer();
  if (body.byteLength > DONATE.packBytes) return fail(413, `Over ${DONATE.packBytes / 1048576} MB: upload a smaller test pack (the starter set).`);
  const b = new Uint8Array(body.slice(0, 4));
  if (!(b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4)) return fail(415, "That isn't a zip.");
  const key = donationKey(d.owner, d.id, "pack.zip");
  await env.STUDIO.put(key, body, { httpMetadata: { contentType: "application/zip" } });
  const title = header(request, "X-Pack-Title", 80) || null, lines = Number(request.headers.get("X-Pack-Lines")) || null;
  await env.DB.prepare(
    "UPDATE voice_donations SET pack_key = ?, pack_bytes = ?, pack_lines = ?, pack_title = ?, updated = ?, " +
    "status = CASE WHEN status = 'published' THEN status ELSE 'ready' END WHERE id = ? AND status != 'withdrawn'"
  ).bind(key, body.byteLength, lines, title, now(), d.id).run();
  return ok({ bytes: body.byteLength });
}

const DONOR_POSTS = { consent, credit, withdraw };

export async function onRequest(context) {
  const { request, env, params } = context;
  const action = String(params.action);
  if (!env.DB || !env.STUDIO) return fail(503, "Lending a voice isn't switched on yet. Please ask on Discord.");
  await setup(env);
  await setupStudio(env);   // voices.locale, which a withdrawal checks
  await setupDonations(env);
  const user = await currentUser(env, request);
  const method = request.method;
  if (method === "GET") {
    if (action === "state") return state(context, user);
    if (action === "audio") return fileOf(context, user, "sample");
    if (action === "pack") return fileOf(context, user, "pack");
    if (action === "export") return (await authorized(request, env)) ? exportAll(context) : fail(401, "Needs the admin key.");
    return fail(404, "Not found.");
  }
  if ((method === "POST" && action === "status") || (method === "PUT" && action === "pack")) {
    if (!(await authorized(request, env))) return fail(401, "Needs the admin key.");
    if (method === "PUT") return putPack(context);
    let input;
    try { input = await request.json(); } catch (e) { return fail(400, "Expected JSON."); }
    return setStatus(context, input);
  }
  if (!sameOrigin(request)) return fail(403, "Please use the page on loreforeverwow.com.");
  if (!user) return fail(401, "You're signed out. Please sign in again.");
  if (method === "PUT" && action === "sample") return sample(context, user);
  if (method !== "POST" || !DONOR_POSTS[action]) return fail(404, "Not found.");
  let input;
  try {
    input = await request.json();
  } catch (e) {
    return fail(400, "Couldn't read that.");
  }
  return DONOR_POSTS[action](context, user, input);
}
