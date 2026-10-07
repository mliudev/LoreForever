import { test } from 'node:test';
import assert from 'node:assert/strict';
import { d1 } from './helpers.mjs';
import { setup, sha256 } from '../lib/accounts.js';
import { setupProfiles } from '../lib/profiles.js';
import { parseRecord } from '../lib/journey.js';
import { onRequest } from '../functions/api/profile/[action].js';
import { RECORD } from './fixtures/journey/record.mjs';

for (const changed of [false, true]) test(`cold history-OFF profile sync stays under D1 Free quota (${changed ? 'changed' : 'unchanged'})`, async t => {
  const storage = d1();
  await setup({ DB: storage });
  const now = new Date().toISOString(), token = 'a'.repeat(64), data = parseRecord(RECORD);
  await storage.prepare('INSERT INTO users (id, created) VALUES (?, ?)').bind('owner', now).run();
  await storage.prepare('INSERT INTO devices (id, token_hash, user_id, created, last_used) VALUES (?, ?, ?, ?, ?)')
    .bind('device', await sha256(token), 'owner', now, now).run();
  await storage.prepare('INSERT INTO profiles (user_id, handle, data, created, updated, story_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('owner', 'aelric', JSON.stringify(data), now, now, now).run();
  let queries = 0;
  const charge = operation => (...args) => {
    assert.ok(++queries <= 50, `D1 Free query quota exceeded by statement ${queries}`);
    return operation(...args);
  };
  const wrap = stmt => ({ bind: (...args) => wrap(stmt.bind(...args)),
    first: charge((...args) => stmt.first(...args)), all: charge((...args) => stmt.all(...args)),
    run: charge((...args) => stmt.run(...args)) });
  // A new wrapper models a fresh Worker isolate, with uncached account/profile setup.
  const db = { prepare: sql => wrap(storage.prepare(sql)), batch: list => Promise.all(list.map(stmt => stmt.run())) };
  const response = await onRequest({ env: { DB: db, GEMINI_API_KEY: 'synthetic-unused-key' }, params: { action: 'sync' },
    request: new Request('https://preview.example/api/profile/sync', { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-LF-Client': 'companion/test' },
      body: JSON.stringify({ record: changed ? RECORD.replace('Level 24', 'Level 25') : RECORD }) }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.unchanged, changed ? undefined : true);
  assert.ok(storage.sqlite.prepare('SELECT last_sync FROM devices').get().last_sync);
  assert.equal(JSON.parse(storage.sqlite.prepare('SELECT data FROM profiles').get().data).level, changed ? 25 : 24);
  t.diagnostic(`cold OFF ${changed ? 'changed' : 'unchanged'} sync used ${queries}/50 D1 statements`);
});

test('profile column preparation preserves legacy tables, tolerates simultaneous setup, and caches per DB', async () => {
  const db = d1(), env = { DB: db };
  db.sqlite.exec('CREATE TABLE profiles (user_id TEXT PRIMARY KEY); INSERT INTO profiles VALUES (\'legacy-owner\')');
  await Promise.all([setupProfiles(env), setupProfiles(env)]);
  const columns = db.sqlite.prepare('PRAGMA table_info(profiles)').all().map(row => row.name);
  for (const name of ['story_at', 'story_basis', 'journey', 'card_sha', 'card_key']) assert.ok(columns.includes(name));
  assert.equal(db.sqlite.prepare('SELECT user_id FROM profiles').get().user_id, 'legacy-owner');
  let queries = 0;
  const original = db.prepare;
  db.prepare = sql => { queries++; return original(sql); };
  await setupProfiles(env);
  assert.equal(queries, 0);
});
