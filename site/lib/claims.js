// "Claim a zone" (LOR-231): a narrator claims one zone on the upload page, records its lines, and the zone list
// (/voices/zones, and the upload page) shows who narrates what. Used by functions/api/studio/zones/[action].js and
// functions/voices/zones.js. Kept outside functions/ so Pages doesn't route it.
//
// Why zones: asking for one line at a time got nothing (a competitor's per-line redub program: no line in two months),
// asking for a whole pack got no takes either. A zone is 1 to ~50 lines, an evening or two of reading, and a voice
// with one zone already plays in game wherever it has a line (the add-on's voiceOrder falls back per clip).
//
// Rules: one active claim per narrator (another once it's done or let go); one active or done claim per zone and
// language (D1 unique indexes, so two people can't take the same zone at once). A claim is done once the voice has a
// take of every line of the zone in its language; it expires after EXPIRE_DAYS with no upload in the zone. Both are
// worked out from studio_takes whenever claims are read (refreshClaims), so uploading needs no change.
// Table studio_claims is in lib/accounts.js SETUP (deleted with the account).

import { zoneList, zoneProgress, expiresAt } from "../public/voices/zone-list.js";
import { clean } from "./form.js";

// {line id: {hash, created}} for each voice asked for.
async function takesByVoice(env, voiceIds) {
  const out = {};
  for (const id of new Set(voiceIds)) {
    const { results } = await env.DB.prepare("SELECT line_id, hash, created FROM studio_takes WHERE voice_id = ?").bind(id).all();
    out[id] = Object.fromEntries(results.map(t => [t.line_id, { hash: t.hash, created: t.created }]));
  }
  return out;
}

const zonesOf = (lines, locale, cache) => (cache[locale] ||= Object.fromEntries(zoneList(lines, locale).map(z => [z.key, z])));

// Brings every active claim up to date: done once its zone is fully recorded, expired after EXPIRE_DAYS without an
// upload in the zone. A zone that's no longer in lines.json (or has no text in the language any more) expires too.
export async function refreshClaims(env, lines, now = new Date()) {
  const { results: active } = await env.DB.prepare("SELECT * FROM studio_claims WHERE status = 'active'").all();
  if (!active.length) return;
  const takes = await takesByVoice(env, active.map(c => c.voice_id)), cache = {};
  const stamp = now.toISOString();
  for (const c of active) {
    const zone = zonesOf(lines, c.locale, cache)[c.zone];
    const p = zone ? zoneProgress(zone, takes[c.voice_id] || {}) : null;
    let status = null;
    if (p && p.total && p.done >= p.total) status = "done";
    else if (!zone || expiresAt(c.created, p.last) <= stamp) status = "expired";
    if (!status) continue;
    await env.DB.prepare("UPDATE studio_claims SET status = ?, updated = ?, finished = ? WHERE id = ? AND status = 'active'")
      .bind(status, stamp, status === "done" ? stamp : null, c.id).run();
  }
}

// The public zone list for one language: [{key, name, starter, lines, claim}], claim being null or
// {credit, status: active|done, done, total, since, finished, voice}; voice is the id of the narrator's voice when
// it's on the site (public/voices/voices.json with that owner), for a link. Call refreshClaims first.
export async function zoneBoard(env, lines, locale, publicVoices = []) {
  const zones = zoneList(lines, locale);
  const { results: claims } = await env.DB.prepare(
    "SELECT * FROM studio_claims WHERE locale = ? AND status IN ('active', 'done')"
  ).bind(locale).all();
  const byZone = Object.fromEntries(claims.map(c => [c.zone, c]));
  const takes = await takesByVoice(env, claims.map(c => c.voice_id));
  const listed = new Set(publicVoices.filter(v => v.owner).map(v => `${v.id} ${v.owner}`));
  return zones.map(z => {
    const c = byZone[z.key];
    const p = c ? zoneProgress(z, takes[c.voice_id] || {}) : null;
    return {
      key: z.key, name: z.name, starter: z.starter, lines: z.lines.length,
      claim: c ? {
        credit: c.credit || "A narrator", status: c.status, done: p.done, total: p.total, since: c.created,
        finished: c.finished || null,
        voice: listed.has(`${c.voice_id} ${c.owner}`) ? c.voice_id : null,
      } : null,
    };
  });
}

// The narrator's own claims: {active: {id, zone, name, voice, locale, done, total, since, expires} | null,
// done: [{zone, name, locale, voice, finished}], suggest: zone key | null}. suggest: for a voice (its language), the
// first open zone it hasn't recorded, starting zones and capitals first.
export async function myClaims(env, lines, user, voice = null) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM studio_claims WHERE owner = ? AND status IN ('active', 'done') ORDER BY created"
  ).bind(user.id).all();
  const takes = await takesByVoice(env, [...results.map(c => c.voice_id), ...(voice ? [voice.id] : [])]), cache = {};
  let active = null;
  const done = [];
  for (const c of results) {
    const zone = zonesOf(lines, c.locale, cache)[c.zone];
    const p = zone ? zoneProgress(zone, takes[c.voice_id] || {}) : { done: 0, total: 0, last: null };
    const base = { id: c.id, zone: c.zone, name: zone?.name || c.zone, voice: c.voice_id, locale: c.locale, credit: c.credit };
    if (c.status === "active") active = { ...base, done: p.done, total: p.total, since: c.created, expires: expiresAt(c.created, p.last) };
    else done.push({ ...base, finished: c.finished });
  }
  let suggest = null;
  if (voice?.locale) {
    const { results: taken } = await env.DB.prepare(
      "SELECT zone FROM studio_claims WHERE locale = ? AND status IN ('active', 'done')"
    ).bind(voice.locale).all();
    const closed = new Set(taken.map(t => t.zone));
    const open = zoneList(lines, voice.locale).filter(z => !closed.has(z.key)
      && zoneProgress(z, takes[voice.id] || {}).done < z.lines.length);
    suggest = (open.find(z => z.starter) || open[0])?.key || null;
  }
  return { active, done, suggest };
}

// Claims a zone for one of the user's voices. Returns {claim} or {status, error}.
export async function claimZone(env, lines, user, voice, input, now = new Date()) {
  if (!voice || !voice.locale) return { status: 404, error: "That isn't one of your voices." };
  const zone = zoneList(lines, voice.locale).find(z => z.key === clean(input.zone, 60));
  if (!zone) return { status: 400, error: "That zone has no lines in your voice's language yet." };
  await refreshClaims(env, lines, now);
  const mine = await env.DB.prepare("SELECT zone, locale FROM studio_claims WHERE owner = ? AND status = 'active'").bind(user.id).first();
  if (mine) {
    const name = zonesOf(lines, mine.locale, {})[mine.zone]?.name || mine.zone;
    return { status: 409, error: `You're narrating ${name}. Finish it, or let it go, to claim another zone.` };
  }
  const taken = await env.DB.prepare(
    "SELECT owner, credit, status FROM studio_claims WHERE zone = ? AND locale = ? AND status IN ('active', 'done')"
  ).bind(zone.key, voice.locale).first();
  if (taken) {
    if (taken.owner === user.id) return { status: 409, error: `You've narrated ${zone.name} already. Pick another zone.` };
    return { status: 409, error: `${taken.credit || "Another narrator"} ${taken.status === "done" ? "narrated" : "is narrating"} ${zone.name}. Pick another zone.` };
  }
  const credit = clean(input.credit, 60) || clean(user.display_name, 60) || "A narrator";
  const stamp = now.toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO studio_claims (zone, locale, voice_id, owner, credit, status, created, updated) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)"
    ).bind(zone.key, voice.locale, voice.id, user.id, credit, stamp, stamp).run();
  } catch (e) {   // the unique indexes: someone took it a moment ago, or a second tab claimed something
    return { status: 409, error: `Someone just claimed ${zone.name}, or you have a zone already. Reload the page.` };
  }
  await refreshClaims(env, lines, now);   // a voice that already has every line of it is done at once (claim: null)
  return { claim: (await myClaims(env, lines, user)).active, zone: zone.key };
}

// Lets go of the user's active claim. Returns whether there was one.
export async function releaseClaim(env, user, id, now = new Date()) {
  const res = await env.DB.prepare(
    "UPDATE studio_claims SET status = 'released', updated = ? WHERE id = ? AND owner = ? AND status = 'active'"
  ).bind(now.toISOString(), Number(id) || 0, user.id).run();
  return res.meta.changes > 0;
}
