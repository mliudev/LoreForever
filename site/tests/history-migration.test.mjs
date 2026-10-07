import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_SETUP } from '../lib/history-schema.js';
import { commitHistory, historyPage, historyEnabled } from '../lib/history.js';
import { sha256, setup, setupHistory } from '../lib/accounts.js';
import { onRequest as profileApi } from '../functions/api/profile/[action].js';
import { readFile } from 'node:fs/promises';
import { d1 } from './helpers.mjs';

test('history stays hidden before the explicit migration, and cold uploads fit D1 Free query quota', async t => {
  const storage = d1(), env = { DB: storage, HISTORY_ARCHIVE_ENABLED: '1' };
  await setup(env);
  assert.equal(historyEnabled(env), false);
  const hidden = await profileApi({ env, params: { action: 'history' }, request: new Request('https://preview.example/api/profile/history') });
  assert.equal(hidden.status, 404);
  await setupHistory(env);
  assert.equal(historyEnabled(env), true);
  const token = 'd'.repeat(64), data = { name: 'Aelric', realm: 'Forever', level: 60 };
  const now = new Date().toISOString();
  await storage.prepare('INSERT INTO users (id, created) VALUES (?, ?)').bind('owner', now).run();
  await storage.prepare('INSERT INTO devices (id, token_hash, user_id, created, last_used) VALUES (?, ?, ?, ?, ?)')
    .bind('device', await sha256(token), 'owner', now, now).run();
  await storage.prepare('INSERT INTO profiles (user_id, handle, data, created, updated) VALUES (?, ?, ?, ?, ?)')
    .bind('owner', 'aelric', JSON.stringify(data), now, now).run();
  // A fresh DB wrapper has no cached setup state, just like a cold Worker isolate over an already-migrated DB.
  let queries = 0;
  const wrap = stmt => ({
    bind: (...args) => wrap(stmt.bind(...args)),
    first: (...args) => { queries++; return stmt.first(...args); },
    all: (...args) => { queries++; return stmt.all(...args); },
    run: (...args) => { queries++; return stmt.run(...args); },
  });
  const db = { prepare: sql => wrap(storage.prepare(sql)), batch: async list => {
    storage.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const stmt of list) results.push(await stmt.run());
      storage.sqlite.exec('COMMIT'); return results;
    } catch (e) { storage.sqlite.exec('ROLLBACK'); throw e; }
  } };
  const cold = { DB: db, HISTORY_ARCHIVE_ENABLED: '1' };
  const body = { v: 2, name: data.name, realm: data.realm, history: { v: 2, stream: 'cold-stream', first: 1, tz: 0,
    records: [{ seq: 1, id: 'source:1', moment: { t: 1759400000, k: 'lvl', lv: 2 } }] } };
  const response = await profileApi({ env: cold, params: { action: 'history' }, request: new Request('https://preview.example/api/profile/history', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).through, 1);
  assert.ok(queries <= 50, `cold upload used ${queries} queries`);
  t.diagnostic(`cold upload executed ${queries} D1 statements; Free quota is 50`);
  queries = 0;
  await setup(cold);
  assert.equal(queries, 0);
});

test('checked-in SQL migration matches the transactional schema definition', async () => {
  assert.equal(await readFile(new URL('../migrations/history-v3.sql', import.meta.url), 'utf8'), HISTORY_SETUP.join(';\n\n') + ';\n');
});

test('v2 migration retains old rows/receipts, deduplicates logical history and blocks preexisting conflicts', async () => {
  const env = { DB: d1() }, data = { name: 'Aelric', realm: 'Forever' }, character = JSON.stringify(['Aelric', 'Forever']);
  env.DB.batch = async list => {
    env.DB.sqlite.exec('BEGIN');
    try {
      const result = [];
      for (const statement of list) result.push(await statement.run());
      env.DB.sqlite.exec('COMMIT');
      return result;
    } catch (e) { env.DB.sqlite.exec('ROLLBACK'); throw e; }
  };
  // A deployed v2 archive: schema and triggers precede the new owner/character source identity.
  for (const sql of HISTORY_SETUP.slice(0, 5)) env.DB.sqlite.exec(sql);
  env.DB.sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE devices (id TEXT PRIMARY KEY, user_id TEXT);
    CREATE TABLE profiles (user_id TEXT PRIMARY KEY, data TEXT, journey TEXT);
    INSERT INTO users VALUES ('owner'); INSERT INTO devices VALUES ('device', 'owner');
    CREATE TRIGGER history_validate BEFORE INSERT ON history_records BEGIN SELECT 1; END;
    CREATE TRIGGER history_advance AFTER INSERT ON history_records BEGIN SELECT 1; END;`);
  await env.DB.prepare('INSERT INTO profiles (user_id, data) VALUES (?, ?)').bind('owner', JSON.stringify(data)).run();
  const text = JSON.stringify({ t: 1759400000, k: 'lvl', lv: 2 }), hash = await sha256(text);
  const alternate = JSON.stringify({ t: 1759400000, k: 'lvl', lv: 3 }), otherHash = await sha256(alternate);
  for (const stream of ['legacy-a', 'legacy-b']) {
    await env.DB.prepare('INSERT INTO history_receipts (user_id, character, stream, through) VALUES (?, ?, ?, 2)')
      .bind('owner', character, stream).run();
    for (const [seq, id] of [[1, 'same-source'], [2, 'conflicted-source']]) {
      const changed = stream === 'legacy-b' && seq === 2;
      await env.DB.prepare(`INSERT INTO history_records
        (user_id, character, stream, seq, source_id, moment, hash, device_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'device')`)
        .bind('owner', character, stream, seq, id, changed ? alternate : text, changed ? otherHash : hash).run();
    }
  }
  const before = env.DB.sqlite.prepare('SELECT * FROM history_records ORDER BY row_id').all();
  const receipts = env.DB.sqlite.prepare('SELECT * FROM history_receipts ORDER BY stream').all();
  for (let i = 0; i < 2; i++) await env.DB.batch(HISTORY_SETUP.map(sql => env.DB.prepare(sql)));
  assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM history_records ORDER BY row_id').all(), before);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM history_receipts ORDER BY stream').all(), receipts);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM history_sources').get().n, 2);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM history_positions').get().n, 4);
  assert.equal(env.DB.sqlite.prepare('SELECT conflicted FROM history_sources WHERE source_id = ?').get('conflicted-source').conflicted, 1);
  assert.equal((await historyPage(env, { user_id: 'owner', data })).records.length, 2);
  const app = { user: { id: 'owner' }, device: { id: 'device' } };
  const upload = (stream, id, seq = 1) => ({ stream, first: seq, tz: 0, records: [{ seq, id, text, hash }] });
  assert.equal(await commitHistory(env, app, data, upload('relinked', 'same-source')), 1);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM history_records').get().n, 4);
  assert.equal(JSON.parse(env.DB.sqlite.prepare('SELECT journey FROM profiles').get().journey).moments.length, 2);
  await assert.rejects(commitHistory(env, app, data, upload('relinked', 'conflicted-source', 2)), /history-conflict/);
  assert.equal(env.DB.sqlite.prepare('SELECT through FROM history_receipts WHERE stream = ?').get('relinked').through, 1);
  await assert.rejects(commitHistory(env, app, data, upload('another-link', 'conflicted-source')), /history-conflict/);
  assert.equal(env.DB.sqlite.prepare('SELECT through FROM history_receipts WHERE stream = ?').get('another-link'), undefined);
  // Every existing profile/account deletion path removes the new tables through the record deletion trigger.
  await env.DB.prepare('DELETE FROM history_records WHERE user_id = ?').bind('owner').run();
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM history_sources').get().n, 0);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM history_positions').get().n, 0);
});
