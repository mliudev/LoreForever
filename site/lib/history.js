import { fail, noStore, sha256, currentUser, sameOrigin, historyReady } from './accounts.js';
import { currentDevice } from './devices.js';
import { profileOf, profileByHandle, sameCharacter } from './profiles.js';
import { readJourney, MAX_MOMENTS } from './journey.js';
import { perMinute, slowDown } from './ratelimit.js';

export const HISTORY_BYTES = 64 * 1024;
export const HISTORY_RECORDS = 250;
export const historyEnabled = env => historyReady(env) && (env.HISTORY_ARCHIVE_ENABLED === true ||
  env.HISTORY_ARCHIVE_ENABLED === '1' || env.HISTORY_ARCHIVE_ENABLED === 'true');
export const historyCharacter = data => JSON.stringify([data.name, data.realm ?? null]);
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => object(v) && Object.keys(v).every(k => allowed.includes(k));
const identity = v => typeof v === 'string' && /^[A-Za-z0-9_.:/-]{1,160}$/.test(v);
// Source identities are opaque add-on IDs and may contain localized names or spaces in realm names.
const sourceIdentity = v => typeof v === 'string' && v.length > 0 && v.length <= 1024 &&
  !/[\u0000-\u001f\u007f]/.test(v) && new TextEncoder().encode(v).byteLength <= 4096;
const ok = body => Response.json({ ok: true, ...body }, { headers: noStore });

// Strict envelope validation prevents private/unknown schema records from being acknowledged. The established
// public moment reader allowlists every stored field. Killer names are removed unconditionally in this channel.
export async function readHistory(input, data) {
  const h = input?.history;
  if (!keys(input, ['v', 'name', 'realm', 'history']) || input.v !== 2 || typeof input.name !== 'string' ||
      !(typeof input.realm === 'string' || input.realm === null) ||
      !keys(h, ['v', 'stream', 'first', 'records', 'tz']) || h.v !== 2 || !identity(h.stream) ||
      !Number.isSafeInteger(h.first) || h.first < 1 || !Number.isInteger(h.tz) || Math.abs(h.tz) > 840 ||
      !Array.isArray(h.records) || !h.records.length || h.records.length > HISTORY_RECORDS) return null;
  const records = [];
  for (let i = 0; i < h.records.length; i++) {
    const r = h.records[i];
    if (!keys(r, ['seq', 'id', 'moment']) || r.seq !== h.first + i || !Number.isSafeInteger(r.seq) ||
        !sourceIdentity(r.id) || !object(r.moment)) return null;
    const moment = readJourney({ v: 1, tz: h.tz, moments: [r.moment] }, data)?.moments[0];
    if (!moment) return null;
    delete moment.by;
    // The batch offset is authoritative here; per-moment offsets belong to the bounded display projection.
    delete moment.tz;
    const text = JSON.stringify(moment);
    records.push({ seq: r.seq, id: r.id, text, hash: await sha256(text) });
  }
  return { stream: h.stream, first: h.first, records, tz: h.tz };
}

async function cappedJson(request) {
  if (Number(request.headers.get('Content-Length')) > HISTORY_BYTES) return { error: fail(413, 'History batch is too large.') };
  let size = 0;
  const chunks = [], reader = request.body?.getReader();
  if (reader) for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > HISTORY_BYTES) { await reader.cancel(); return { error: fail(413, 'History batch is too large.') }; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) { bytes.set(chunk, pos); pos += chunk.byteLength; }
  try { return { input: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }; }
  catch { return { error: fail(400, 'Could not read this history batch.') }; }
}

export async function commitHistory(env, app, data, batch) {
  const owner = app.user.id, character = historyCharacter(data), stream = batch.stream;
  const statements = [env.DB.prepare(`INSERT OR IGNORE INTO history_receipts (user_id, character, stream, tz)
    SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM devices WHERE id = ? AND user_id = ?)`)
    .bind(owner, character, stream, batch.tz, app.device.id, owner)];
  // json_each keeps a 250-record request to one insert, below D1's per-invocation query and bound-parameter caps.
  // Explicit ordering lets the existing row triggers validate/advance each contiguous sequence inside the batch.
  statements.push(env.DB.prepare(`INSERT INTO history_uploads
    (user_id, character, stream, seq, source_id, moment, hash, device_id, tz)
    SELECT ?, ?, ?, json_extract(value, '$.seq'), json_extract(value, '$.id'), json_extract(value, '$.text'),
      json_extract(value, '$.hash'), ?, ? FROM json_each(?) ORDER BY CAST(key AS INTEGER)`)
    .bind(owner, character, stream, app.device.id, batch.tz, JSON.stringify(batch.records)));
  // Projection and archive commit together. Pasting/snapshot sync may still replace this bounded projection;
  // the archive stays intact. Stories and aggregates retain their existing budgets and behavior.
  statements.push(env.DB.prepare(`UPDATE profiles SET journey = json_object('v', 1, 'tz', ?, 'moments',
    json((SELECT json_group_array(json(moment)) FROM (SELECT moment FROM (SELECT json_set(r.moment, '$.tz', r.tz) AS moment, r.row_id FROM history_records r
      JOIN history_sources s ON s.row_id = r.row_id WHERE r.user_id = ? AND r.character = ?
      ORDER BY r.row_id DESC LIMIT ?) ORDER BY json_extract(moment, '$.t'), row_id))))
    WHERE user_id = ? AND json_array(json_extract(data, '$.name'), json_extract(data, '$.realm')) = ?`)
    .bind(batch.tz, owner, character, MAX_MOMENTS, owner, character));
  await env.DB.batch(statements);
  const receipt = await env.DB.prepare(`SELECT through FROM history_receipts WHERE user_id = ? AND character = ? AND stream = ?`)
    .bind(owner, character, stream).first();
  return receipt?.through ?? null;
}

export function forgetHistoryStatements(env, owner) {
  return [
    env.DB.prepare(`INSERT OR IGNORE INTO history_tombstones (user_id, character, stream)
      SELECT user_id, character, stream FROM history_receipts WHERE user_id = ?`).bind(owner),
    env.DB.prepare('DELETE FROM history_records WHERE user_id = ?').bind(owner),
    env.DB.prepare('DELETE FROM history_receipts WHERE user_id = ?').bind(owner),
  ];
}

// Cursor is a monotonic archive row boundary: new arrivals never duplicate an already-paged record. It is bound
// to the displayed character; another owner's rows can never be selected with it. No OFFSET over a growing log.
export async function historyPage(env, p, { before = '', limit = 250 } = {}) {
  const character = historyCharacter(p.data);
  let bound = Number.MAX_SAFE_INTEGER;
  if (before) {
    try {
      const cursor = JSON.parse(atob(before));
      if (cursor.v !== 2 || cursor.c !== encodeURIComponent(character) || !Number.isSafeInteger(cursor.b) || cursor.b < 1) throw Error();
      bound = cursor.b;
    } catch { return null; }
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_RECORDS) return null;
  const { results } = await env.DB.prepare(`SELECT r.row_id, r.stream, r.seq, r.source_id, r.moment, r.tz
    FROM history_records r JOIN history_sources s ON s.row_id = r.row_id
    WHERE r.user_id = ? AND r.character = ? AND r.row_id < ? ORDER BY r.row_id DESC LIMIT ?`)
    .bind(p.user_id, character, bound, limit + 1).all();
  const rows = results.slice(0, limit);
  const next = results.length > limit ? btoa(JSON.stringify({ v: 2, c: encodeURIComponent(character), b: rows.at(-1).row_id })) : null;
  return { records: rows.map(r => ({ stream: r.stream, seq: r.seq, id: r.source_id,
    moment: JSON.parse(r.moment), tz: r.tz })), next };
}

export async function historyRequest({ request, env }) {
  if (!historyEnabled(env)) return fail(404, 'Not found.');
  if (request.method === 'POST') {
    if (request.headers.get('Origin') && !sameOrigin(request)) return fail(403, 'Please use the companion app.');
    const app = await currentDevice(env, request);
    if (!app) return fail(401, 'This app is disconnected. Connect it again.');
    if (!(await perMinute(env, app.user.id, 'profile-history', 120))) return slowDown();
    const { input, error } = await cappedJson(request);
    if (error) return error;
    const p = await profileOf(env, app.user.id);
    if (!p || !sameCharacter(p.data, input)) return fail(409, 'Send history for the character on your profile.');
    const batch = await readHistory(input, p.data);
    if (!batch) return fail(400, 'Unsupported or invalid history batch.');
    try {
      const through = await commitHistory(env, app, p.data, batch);
      return through === null ? fail(401, 'This app is disconnected. Connect it again.') : ok({ stream: batch.stream, through });
    } catch (e) {
      if (/history-authorization/.test(e.message)) return fail(401, 'This app or character is no longer connected.');
      if (/history-(gap|conflict|deleted)/.test(e.message)) return fail(409, 'History changed or a batch is missing. Retry from your last receipt.');
      throw e;
    }
  }
  if (request.method !== 'GET') return fail(405, 'Use GET or POST.');
  const query = new URL(request.url).searchParams;
  const user = await currentUser(env, request);
  const handle = query.get('handle');
  const p = handle ? await profileByHandle(env, handle) : user && await profileOf(env, user.id);
  const owner = p && user?.id === p.user_id;
  if (!p || (!p.public && !owner)) return fail(handle ? 404 : 401, 'History is unavailable.');
  if (!handle && !owner) return fail(401, 'Please sign in.');
  if (request.headers.get('Origin') && !sameOrigin(request)) return fail(403, 'Please use loreforeverwow.com.');
  if (query.has('export') && !owner) return fail(403, 'Only the owner can export history.');
  const page = await historyPage(env, p, { before: query.get('before') || '', limit: query.has('limit') ? Number(query.get('limit')) : 250 });
  if (!page) return fail(400, 'Invalid history page.');
  const records = owner ? page.records : page.records.map(({ moment, tz }) => {
    const { t, ...publicMoment } = moment;
    return { moment: { ...publicMoment, day: new Date((t + tz * 60) * 1000).toISOString().slice(0, 10) } };
  });
  const body = { ok: true, v: 2, name: p.data.name, realm: p.data.realm, records, next: page.next };
  // Direct downloads are explicitly a page. The owner's browser follows these same bounded cursors to assemble
  // a full download, avoiding per-invocation D1 query quotas even with a mature 100k+ archive.
  return query.has('export') ? Response.json(body, { headers: { ...noStore,
    'Content-Disposition': 'attachment; filename="lore-forever-history-page.json"' } }) : ok(body);
}
