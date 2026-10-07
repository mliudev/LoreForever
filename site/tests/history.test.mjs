import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as profileApi } from '../functions/api/profile/[action].js';
import { onRequest as deviceApi } from '../functions/api/device/[action].js';
import { onRequestGet as profilePage } from '../functions/u/[handle].js';
import { setupHistory, findOrCreateUser, startSession, sha256, deleteUser } from '../lib/accounts.js';
import { commitHistory, readHistory, historyPage } from '../lib/history.js';
import { profileOf } from '../lib/profiles.js';
import { RECORD } from './fixtures/journey/record.mjs';
import { d1 } from './helpers.mjs';
import { exportHistory } from '../public/js/history-export.js';
import { moments } from '../lib/trails.js';
import { readJourney } from '../lib/journey.js';
import { picturesSection } from '../lib/pictures.js';

const origin = 'https://preview.example';
const env = { DB: d1(), HISTORY_ARCHIVE_ENABLED: '1' };
// Real SQLite, with D1's serial, transactional batch semantics (the older shared helper only runs statements).
let pending = Promise.resolve();
env.DB.batch = list => {
  const result = pending.then(async () => {
    env.DB.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of list) results.push(await statement.run());
      env.DB.sqlite.exec('COMMIT');
      return results;
    } catch (e) { env.DB.sqlite.exec('ROLLBACK'); throw e; }
  });
  pending = result.catch(() => {});
  return result;
};

let user, cookie, token, deviceId;
beforeEach(async () => {
  await setupHistory(env);
  for (const table of ['history_records', 'history_receipts', 'history_tombstones', 'profiles', 'users', 'devices', 'sessions', 'rate_limits']) {
    env.DB.sqlite.exec(`DELETE FROM ${table}`);
  }
  env.HISTORY_ARCHIVE_ENABLED = '1';
  user = await findOrCreateUser(env, { email: 'history@example.com', googleSub: 'history', name: 'History' });
  cookie = (await startSession(env, new Request(origin), user.id)).split(';')[0];
  token = 'a'.repeat(64); deviceId = 'history-device';
  await env.DB.prepare('INSERT INTO devices (id, token_hash, user_id, label, created, last_used) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(deviceId, await sha256(token), user.id, 'Test', new Date().toISOString(), new Date().toISOString()).run();
  assert.equal((await api('import', { body: { record: RECORD }, owner: true })).status, 200);
});

async function api(action, { body, owner = false, method = 'POST', query = '', raw, auth = token, headers = {} } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (owner) { h.Cookie = cookie; if (method !== 'GET') h.Origin = origin; }
  else if (auth) { h.Authorization = `Bearer ${auth}`; h['X-LF-Client'] = 'companion/test'; }
  return profileApi({ env, params: { action }, request: new Request(`${origin}/api/profile/${action}${query}`, {
    method, headers: h, body: method === 'GET' ? undefined : raw ?? JSON.stringify(body ?? {}),
  }) });
}
function batch(first = 1, count = 3, stream = 'test-stream') {
  return { v: 2, name: 'Aelric', realm: 'Forever', history: { v: 2, stream, first, tz: 0,
    records: Array.from({ length: count }, (_, i) => ({ seq: first + i, id: `source:${first + i}`,
      moment: { t: 1759400000 + first + i, k: 'qt', id: 123, n: 'Quest', z: 'Westfall' } })) } };
}
const count = table => Number(env.DB.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);

test('localized and long add-on source identities stay opaque and replay safely', async () => {
  const input = batch(1, 1);
  input.history.records[0].id = 'epoch/Húrin-' + 'A Realm With Spaces '.repeat(20) + '/epoch:1';
  assert.equal((await api('history', { body: input })).status, 200);
  assert.equal((await api('history', { body: input })).status, 200);
  assert.equal(count('history_records'), 1);
  input.history.records[0].id += '\u0000';
  assert.equal((await api('history', { body: input })).status, 400);
});

test('capability, endpoints and history UI are hidden by default', async () => {
  delete env.HISTORY_ARCHIVE_ENABLED;
  const response = await deviceApi({ env, params: { action: 'status' }, request: new Request(`${origin}/api/device/status`, {
    headers: { Authorization: `Bearer ${token}`, 'X-LF-Client': 'companion/test' },
  }) });
  assert.equal((await response.json()).historyVersion, undefined);
  assert.equal((await api('history', { body: batch() })).status, 404);
  assert.equal((await api('history', { method: 'GET', owner: true })).status, 404);
  env.HISTORY_ARCHIVE_ENABLED = 'true';
  const enabled = await deviceApi({ env, params: { action: 'status' }, request: new Request(`${origin}/api/device/status`, {
    headers: { Authorization: `Bearer ${token}`, 'X-LF-Client': 'companion/test' },
  }) });
  assert.equal((await enabled.json()).historyVersion, 2);
});

test('ten identical replays, lost replies and concurrent submissions commit each record once', async () => {
  for (let i = 0; i < 10; i++) {
    const response = await api('history', { body: batch() });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, stream: 'test-stream', through: 3 });
  }
  const replies = await Promise.all(Array.from({ length: 5 }, () => api('history', { body: batch(4) })));
  for (const reply of replies) { assert.equal(reply.status, 200); assert.equal((await reply.json()).through, 6); }
  assert.equal(count('history_records'), 6);
  const p = await profileOf(env, user.id);
  assert.equal(p.journey.moments.length, 6);
  assert.deepEqual(p.journey.moments.map(m => m.t), [...p.journey.moments].map(m => m.t).sort((a, b) => a - b));
});

test('simultaneous conflicting requests choose one immutable payload without advancing the loser', async () => {
  const alternate = batch(); alternate.history.records[2].moment.n = 'Alternate';
  const replies = await Promise.all([api('history', { body: batch() }), api('history', { body: alternate })]);
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 409]);
  assert.equal(count('history_records'), 3);
  assert.equal(env.DB.sqlite.prepare('SELECT through FROM history_receipts').get().through, 3);
});

test('relink replays original source IDs in a fresh stream without another logical copy', async () => {
  assert.equal((await api('history', { body: batch() })).status, 200);
  await env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(deviceId).run();
  token = 'c'.repeat(64); deviceId = 'relinked-device';
  await env.DB.prepare('INSERT INTO devices (id, token_hash, user_id, label, created, last_used) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(deviceId, await sha256(token), user.id, 'Relinked', new Date().toISOString(), new Date().toISOString()).run();
  const linked = batch(1, 3, 'new-connection');
  // Source IDs need not occupy the same public-outbox positions in the new connection.
  linked.history.records.reverse().forEach((r, i) => r.seq = i + 1);
  for (let i = 0; i < 10; i++) {
    const reply = await api('history', { body: linked });
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), { ok: true, stream: 'new-connection', through: 3 });
  }
  assert.equal(count('history_records'), 3);
  assert.equal(count('history_sources'), 3);
  assert.equal(count('history_positions'), 6);
  assert.equal((await profileOf(env, user.id)).journey.moments.length, 3);
  assert.equal((await exportHistory(url => api('history', { owner: true, method: 'GET', query: url.slice(url.indexOf('?')) }))).records.length, 3);
  assert.equal((await api('history', { body: batch(4, 2, 'new-connection') })).status, 200);
  assert.equal(count('history_records'), 5);
  const changed = batch(1, 3, 'third-connection'); changed.history.records[2].moment.n = 'Changed source';
  assert.equal((await api('history', { body: changed })).status, 409);
  assert.equal(count('history_positions'), 8);
  assert.equal(env.DB.sqlite.prepare('SELECT through FROM history_receipts WHERE stream = ?').get('third-connection'), undefined);
  // A known logical source never fills a missing delivery position.
  assert.equal((await api('history', { body: batch(2, 1, 'gap-connection') })).status, 409);
  assert.equal(count('history_receipts'), 2);
});

test('simultaneous streams share one immutable source identity and conflicting streams roll back', async () => {
  const replies = await Promise.all(['connection-a', 'connection-b'].map(stream => api('history', { body: batch(1, 3, stream) })));
  assert.deepEqual(replies.map(r => r.status), [200, 200]);
  assert.equal(count('history_records'), 3);
  assert.equal(count('history_positions'), 6);
  const left = batch(1, 4, 'connection-c'), right = batch(1, 4, 'connection-d');
  right.history.records[3].moment.n = 'Conflicting fourth source';
  const race = await Promise.all([api('history', { body: left }), api('history', { body: right })]);
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
  assert.equal(count('history_records'), 4);
  assert.equal(count('history_receipts'), 3);
  assert.equal(count('history_positions'), 10);
});

test('offset changes preserve every archived and normal-profile day without changing UTC timestamps', async () => {
  const firstTime = Date.parse('2025-11-02T07:30:00Z') / 1000;
  const secondTime = Date.parse('2025-11-03T12:00:00Z') / 1000;
  const first = batch(1, 1); first.history.tz = -420; first.history.records[0].moment.t = firstTime;
  first.history.records[0].moment.tz = 840; // The public-history batch offset remains authoritative.
  assert.equal((await api('history', { body: first })).status, 200);
  const next = batch(2, 1); next.history.tz = -480; next.history.records[0].moment.t = secondTime;
  assert.equal((await api('history', { body: next })).status, 200);
  // A fresh connection may observe another offset while replaying an already-archived source.
  const replay = structuredClone(first); replay.history.stream = 'relinked-offset'; replay.history.tz = -480;
  assert.equal((await api('history', { body: replay })).status, 200);
  const p = await profileOf(env, user.id);
  assert.equal(p.journey.tz, -480, 'picture dates retain the established envelope-offset behavior');
  assert.deepEqual(p.journey.moments.map(m => m.t), [firstTime, secondTime]);
  assert.deepEqual(p.journey.moments.map(m => m.tz), [-420, -480]);
  assert.deepEqual(moments(p.data, undefined, p.journey).map(m => m.day), ['2025-11-02', '2025-11-03']);
  const sanitized = readJourney(p.journey, p.data);
  assert.deepEqual(sanitized.moments, p.journey.moments);
  assert.deepEqual(moments(p.data, undefined, sanitized).map(m => m.t), [firstTime, secondTime]);
  const archived = await (await api('history', { owner: true, method: 'GET' })).json();
  assert.deepEqual(archived.records.map(r => r.moment.t), [secondTime, firstTime]);
  assert.deepEqual(archived.records.map(r => r.tz), [-480, -420]);
  assert.equal(archived.records[1].moment.tz, undefined, 'batch offset remains separate from immutable source payload');
  for (const suffix of ['', '?history=1']) {
    const rendered = await profilePage({ env, params: { handle: p.handle },
      request: new Request(`${origin}/u/${p.handle}${suffix}`, { headers: { Cookie: cookie } }), waitUntil() {} });
    assert.equal(rendered.status, 200);
    assert.match(await rendered.text(), /class="pf-date">Nov 2, 2025<\/h3>/);
  }
  assert.match(picturesSection([{ id: 'synthetic-picture', t: firstTime, shown: 1 }], { tz: p.journey.tz }), /Nov 1, 2025/);
  const legacy = { v: 1, tz: -480, moments: [{ t: firstTime, k: 'lvl', lv: 2 }] };
  assert.equal(moments(p.data, undefined, legacy)[0].day, '2025-11-01');
  legacy.moments[0].tz = 99999;
  assert.equal(readJourney(legacy).moments[0].tz, undefined);
  assert.equal(moments(p.data, undefined, legacy)[0].day, '2025-11-01');
});

test('gaps, conflicting sequence/source IDs and a conflict late in a batch roll back records and receipts', async () => {
  assert.equal((await api('history', { body: batch(2) })).status, 409);
  assert.equal(count('history_receipts'), 0);
  assert.equal((await api('history', { body: batch() })).status, 200);
  const changed = batch(); changed.history.records[2].moment.n = 'Conflict';
  assert.equal((await api('history', { body: changed })).status, 409);
  const duplicate = batch(4); duplicate.history.records[2].id = 'source:1';
  assert.equal((await api('history', { body: duplicate })).status, 409);
  assert.equal(count('history_records'), 3);
  assert.equal(env.DB.sqlite.prepare('SELECT through FROM history_receipts').get().through, 3);
  const overlapping = batch(2, 4);
  assert.equal((await api('history', { body: overlapping })).status, 200);
  assert.equal(count('history_records'), 5);
});

test('more than 10,000 moments survive bounded projection, paste and paged/full export', async () => {
  for (let first = 1; first <= 10250; first += 250) {
    assert.equal((await api('history', { body: batch(first, 250) })).status, 200);
  }
  assert.equal(count('history_records'), 10250);
  assert.equal((await profileOf(env, user.id)).journey.moments.length, 2000);
  assert.equal((await api('import', { owner: true, body: { record: RECORD } })).status, 200);
  const ids = new Set(); let next = '';
  do {
    const response = await api('history', { method: 'GET', owner: true, query: `?limit=137${next ? '&before=' + encodeURIComponent(next) : ''}` });
    assert.equal(response.status, 200);
    const page = await response.json();
    for (const r of page.records) { assert.ok(!ids.has(r.id)); ids.add(r.id); }
    next = page.next;
  } while (next);
  assert.equal(ids.size, 10250);
  const exported = await api('history', { owner: true, method: 'GET', query: '?export=1' });
  assert.match(exported.headers.get('Content-Disposition'), /attachment/);
  const firstPage = await exported.json();
  assert.equal(firstPage.records.length, 250);
  assert.ok(firstPage.next);
  const archive = await exportHistory(url => api('history', { owner: true, method: 'GET', query: url.slice(url.indexOf('?')) }));
  assert.equal(archive.records.length, 10250);
  assert.equal(new Set(archive.records.map(r => r.id)).size, 10250);
});

test('privacy allowlist, wrong character/account, malformed schema and full request byte limits', async () => {
  const privateData = batch();
  Object.assign(privateData.history.records[0].moment, { chat: 'PRIVATE_SENTINEL', x: 0.12345, y: 0.98765,
    party: ['THIRD_PARTY'], screenshot: 'SCREENSHOT_SENTINEL', by: 'KILLER_SENTINEL' });
  assert.equal((await api('history', { body: privateData })).status, 200);
  const saved = JSON.stringify((await profileOf(env, user.id)).journey);
  assert.doesNotMatch(saved, /SENTINEL|THIRD_PARTY|0\.12345/);
  for (const change of [b => b.v = 9, b => b.history.v = 9, b => b.history.records[0].seq = 2,
    b => b.history.records[0].moment.k = 'chat', b => b.history.extra = 'unknown', b => b.history.records = []]) {
    const invalid = batch(); change(invalid);
    assert.equal((await api('history', { body: invalid })).status, 400);
  }
  const wrong = batch(); wrong.name = 'Other';
  assert.equal((await api('history', { body: wrong })).status, 409);
  assert.equal((await api('history', { body: batch(), auth: 'b'.repeat(64) })).status, 401);
  assert.equal((await api('history', { body: batch(), headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await api('history', { body: batch(1, 251) })).status, 400);
  assert.equal((await api('history', { raw: '{"padding":"' + 'é'.repeat(40000) + '"}' })).status, 413);
  assert.equal((await api('history', { raw: '{invalid' })).status, 400);
  assert.equal((await api('history', { method: 'GET', owner: true, query: '?before=invalid' })).status, 400);
});

test('public pages protect private profiles and expose day only; browser older links respect the gate', async () => {
  await api('history', { body: batch(1, 250) });
  await api('history', { body: batch(251, 3) });
  const p = await profileOf(env, user.id);
  assert.equal((await api('history', { method: 'GET', auth: null, query: '?handle=' + p.handle })).status, 404);
  await api('settings', { owner: true, body: { public: true } });
  const publicResponse = await api('history', { method: 'GET', auth: null, query: '?handle=' + p.handle + '&limit=2' });
  const page = await publicResponse.json();
  assert.equal(page.records.length, 2);
  assert.ok(page.records[0].moment.day);
  assert.equal(page.records[0].moment.t, undefined);
  assert.deepEqual(Object.keys(page.records[0]), ['moment']);
  assert.equal((await api('history', { method: 'GET', auth: null, query: '?handle=' + p.handle + '&export=1' })).status, 403);
  const rendered = await profilePage({ env, params: { handle: p.handle }, request: new Request(`${origin}/u/${p.handle}?history=1`), waitUntil() {} });
  const html = await rendered.text();
  assert.match(html, /Older saved moments/);
  assert.doesNotMatch(html, /data-history-export/);
  assert.match(html, /aria-label="Saved history"/);
  const ownerRendered = await profilePage({ env, params: { handle: p.handle }, request: new Request(`${origin}/u/${p.handle}?history=1`, { headers: { Cookie: cookie } }), waitUntil() {} });
  const ownerHtml = await ownerRendered.text();
  assert.match(ownerHtml, /data-history-export/);
  assert.match(ownerHtml, /type="module" src="\/js\/history-export.js"/);
  await api('settings', { owner: true, body: { public: false } });
  assert.equal((await api('history', { method: 'GET', auth: null, query: '?handle=' + p.handle + '&before=' + encodeURIComponent(page.next) })).status, 404);
  delete env.HISTORY_ARCHIVE_ENABLED;
  const hidden = await profilePage({ env, params: { handle: p.handle }, request: new Request(`${origin}/u/${p.handle}`, { headers: { Cookie: cookie } }), waitUntil() {} });
  assert.doesNotMatch(await hidden.text(), /Browse saved history|data-history-export/);
});

test('profile delete tombstones old streams, revokes devices and blocks in-flight/stale retries after relink', async () => {
  await api('history', { body: batch() });
  await api('history', { body: batch(1, 3, 'relinked-before-delete') });
  const p = await profileOf(env, user.id), parsed = await readHistory(batch(4), p.data);
  assert.equal((await api('delete', { owner: true })).status, 200);
  assert.equal(count('history_records'), 0);
  assert.equal(count('history_receipts'), 0);
  assert.equal(count('history_sources'), 0);
  assert.equal(count('history_positions'), 0);
  assert.equal(count('history_tombstones'), 2);
  assert.equal((await api('history', { body: batch(4) })).status, 401);
  await assert.rejects(commitHistory(env, { user, device: { id: deviceId } }, p.data, parsed), /history-(deleted|authorization)/);
  await api('import', { owner: true, body: { record: RECORD } });
  await env.DB.prepare('INSERT INTO devices (id, token_hash, user_id, label, created, last_used) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(deviceId, await sha256(token), user.id, 'Test', new Date().toISOString(), new Date().toISOString()).run();
  assert.equal((await api('history', { body: batch() })).status, 409);
  assert.equal((await api('history', { body: batch(1, 3, 'fresh-stream') })).status, 200);
  await deleteUser(env, user);
  assert.equal(count('history_records'), 0);
  assert.equal(count('history_receipts'), 0);
  assert.equal(count('history_tombstones'), 0);
  assert.equal(count('history_sources'), 0);
  assert.equal(count('history_positions'), 0);
  assert.equal((await api('history', { body: batch() })).status, 401);
});

test('character switch preserves separate namespaces and rejects old pagination cursor and racing upload', async () => {
  await api('history', { body: batch() });
  const p = await profileOf(env, user.id);
  const page = await historyPage(env, p, { limit: 1 });
  const parsed = await readHistory(batch(4), p.data);
  await api('import', { owner: true, body: { record: RECORD.replace('Aelric - Forever', 'Other - Forever') } });
  assert.equal((await api('history', { body: batch(4) })).status, 409);
  await assert.rejects(commitHistory(env, { user, device: { id: deviceId } }, p.data, parsed), /history-authorization/);
  assert.equal((await api('history', { owner: true, method: 'GET', query: '?before=' + encodeURIComponent(page.next) })).status, 400);
  assert.equal(count('history_records'), 3);
  const other = batch(); other.name = 'Other'; other.history.records[0].moment.n = 'Other character payload';
  assert.equal((await api('history', { body: other })).status, 200);
  assert.equal(count('history_records'), 6);
  await api('import', { owner: true, body: { record: RECORD } });
  assert.equal((await (await api('history', { owner: true, method: 'GET' })).json()).records.length, 3);
});

test('valid second owner cannot see or append the first owner archive; device revocation racing a batch rejects it', async () => {
  await api('history', { body: batch() });
  const original = { user, cookie, token, deviceId }, p = await profileOf(env, user.id);
  const parsed = await readHistory(batch(4), p.data);
  user = await findOrCreateUser(env, { email: 'second@example.com', googleSub: 'second', name: 'Second' });
  cookie = (await startSession(env, new Request(origin), user.id)).split(';')[0];
  token = 'b'.repeat(64); deviceId = 'second-device';
  await env.DB.prepare('INSERT INTO devices (id, token_hash, user_id, label, created, last_used) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(deviceId, await sha256(token), user.id, 'Test', new Date().toISOString(), new Date().toISOString()).run();
  await api('import', { owner: true, body: { record: RECORD } });
  const empty = await (await api('history', { owner: true, method: 'GET' })).json();
  assert.deepEqual(empty.records, []);
  assert.equal((await api('history', { body: batch(4) })).status, 409);
  assert.equal((await api('history', { owner: true, method: 'GET', query: '?handle=' + p.handle })).status, 404);
  assert.equal(count('history_records'), 3);
  const second = batch(); second.history.records[0].moment.n = 'Other owner payload';
  assert.equal((await api('history', { body: second })).status, 200);
  assert.equal(count('history_records'), 6);
  await env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(original.deviceId).run();
  await assert.rejects(commitHistory(env, { user: original.user, device: { id: original.deviceId } }, p.data, parsed), /history-authorization/);
  assert.equal(count('history_records'), 6);
});

test('rate limits return a retry delay and no acknowledgement', async () => {
  const bucket = 'profile-history:' + new Date().toISOString().slice(0, 16);
  await env.DB.prepare('INSERT INTO rate_limits (user_id, bucket, n) VALUES (?, ?, 120)').bind(user.id, bucket).run();
  const response = await api('history', { body: batch() });
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('Retry-After')) > 0);
  assert.equal((await response.json()).through, undefined);
  assert.equal(count('history_records'), 0);
});

test('browser full export follows 401 bounded pages for 100,001 records, and aborts on auth/character/cursor changes', async () => {
  const total = 100001; let requests = 0;
  const archive = await exportHistory(async url => {
    const before = new URL(url, origin).searchParams.get('before');
    const offset = before ? Number(before) : 0;
    requests++;
    const n = Math.min(250, total - offset);
    return Response.json({ ok: true, v: 2, name: 'Aelric', realm: 'Forever',
      records: Array.from({ length: n }, (_, i) => ({ id: 'record:' + (offset + i), moment: { t: 1759400000, k: 'lvl', lv: 2 } })),
      next: offset + n < total ? String(offset + n) : null });
  });
  assert.equal(requests, 401);
  assert.equal(archive.records.length, total);
  assert.equal(new Set(archive.records.map(r => r.id)).size, total);
  await assert.rejects(exportHistory(async () => new Response('', { status: 401 })), /sign in/);
  let calls = 0;
  await assert.rejects(exportHistory(async () => Response.json({ v: 2, name: ++calls === 1 ? 'Aelric' : 'Other',
    realm: 'Forever', records: [], next: 'next' })), /character changed/);
  await assert.rejects(exportHistory(async () => Response.json({ v: 2, name: 'Aelric', realm: 'Forever',
    records: [], next: 'repeat' })), /history page/);
});
