// Local-only synthetic browser fixture: node site/tests/smoke-history-browser.mjs. No network/account writes.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { d1, SITE } from './helpers.mjs';
import { setupHistory, findOrCreateUser, startSession, sha256 } from '../lib/accounts.js';
import { onRequest as api } from '../functions/api/profile/[action].js';
import { onRequestGet as page } from '../functions/u/[handle].js';
import { profileOf } from '../lib/profiles.js';
import { RECORD } from './fixtures/journey/record.mjs';

const origin = 'http://localhost:8765';
const env = { DB: d1(), HISTORY_ARCHIVE_ENABLED: '1', SITE_FEATURES: '-storyvoice,-lore' };
await setupHistory(env);
const user = await findOrCreateUser(env, { email: 'synthetic@example.invalid', googleSub: 'synthetic-history', name: 'Synthetic' });
const cookie = (await startSession(env, new Request(origin), user.id)).split(';')[0];
const token = 'c'.repeat(64);
await env.DB.prepare('INSERT INTO devices (id, token_hash, user_id, label, created, last_used) VALUES (?, ?, ?, ?, ?, ?)')
  .bind('synthetic', await sha256(token), user.id, 'Synthetic', new Date().toISOString(), new Date().toISOString()).run();
async function post(action, body, headers) {
  const response = await api({ env, params: { action }, request: new Request(`${origin}/api/profile/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  }) });
  if (!response.ok) throw new Error(await response.text());
}
await post('import', { record: RECORD }, { Cookie: cookie, Origin: origin });
for (const [first, length] of [[1, 250], [251, 50]]) await post('history', {
  v: 2, name: 'Aelric', realm: 'Forever', history: { v: 2, stream: 'synthetic', first, tz: 0,
    records: Array.from({ length }, (_, i) => ({ seq: first + i, id: `synthetic:${first + i}`,
      moment: { t: 1759400000 + (first + i) * 3600, k: 'qt', id: 123,
        n: `Recorded quest ${first + i}`, z: 'Westfall' } })) },
}, { Authorization: `Bearer ${token}` });
await post('settings', { public: true }, { Cookie: cookie, Origin: origin });
const profile = await profileOf(env, user.id);
const publicRoot = resolve(SITE, 'public');
const types = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/') { res.writeHead(302, { Location: `/u/${profile.handle}?history=1#timeline` }); res.end(); return; }
    if (url.pathname === '/owner') {
      res.writeHead(302, { 'Set-Cookie': cookie + '; Path=/; HttpOnly; SameSite=Lax', Location: `/u/${profile.handle}?history=1#timeline` });
      res.end(); return;
    }
    if (url.pathname === '/api/profile/history') {
      const response = await api({ env, params: { action: 'history' }, request: new Request(url, { headers: req.headers }) });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    if (url.pathname.startsWith('/u/')) {
      const response = await page({ env, params: { handle: url.pathname.slice(3) }, request: new Request(url, { headers: req.headers }), waitUntil() {} });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    const path = resolve(publicRoot, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(publicRoot + '/')) { res.writeHead(404); res.end(); return; }
    const bytes = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }); res.end(bytes);
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
}).listen(8765, '0.0.0.0', () => console.log(`Synthetic public history: ${origin}/u/${profile.handle}?history=1#timeline`));
