// Local-only synthetic dashboard: node site/tests/smoke-admin-usage.mjs, then open http://localhost:8766/admin and use
// the key "local". Made-up usage counts (LOR-413) for 40 players over 14 days, downloads by source and profile views
// and shares (LOR-151), through the real lib/usage.js and functions/api/admin.js on an in-memory D1. No network, no
// real data.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { d1, SITE } from './helpers.mjs';
import { setup, findOrCreateUser } from '../lib/accounts.js';
import { saveUsage, countSite } from '../lib/usage.js';
import { onRequestGet as admin } from '../functions/api/admin.js';

const origin = 'http://localhost:8766';
const env = { DB: d1(), ADMIN_KEY: 'local' };
await setup(env);

let seed = 413;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const KINDS = { zone: [2, 7, 0.72], place: [1, 5, 0.61], person: [0, 3, 0.78], quest: [0, 2, 0.52],
                dialogue: [0, 9, 0.86], answer: [0, 2, 0.91] };
const now = Date.now();
for (let p = 0; p < 40; p++) {
  const user = await findOrCreateUser(env, { email: `player${p}@example.invalid`, googleSub: `synthetic-${p}`, name: `Player ${p}` });
  const counts = p < 34;                        // the last six still run an add-on without counts
  const joined = pick(0, 13);                   // more players each day: they connect over the two weeks
  for (let ago = 13 - joined; ago >= 0; ago--) {
    if (rnd() < 0.35) continue;                 // not every player plays every day
    const at = now - ago * 864e5;
    const day = new Date(at).toISOString().slice(0, 10);
    // saveUsage takes what readUsage makes: {day: {metric: n}}, play.<kind> and done.<kind> for narrations.
    const flat = { ask: pick(0, 3), faq: pick(0, 4), live: rnd() < 0.2 ? 1 : 0, panel: pick(1, 7), journey: pick(0, 2),
                   pic: rnd() < 0.3 ? pick(1, 2) : 0 };
    for (const [kind, [lo, hi, rate]] of Object.entries(KINDS)) {
      flat[`play.${kind}`] = pick(lo, hi);
      flat[`done.${kind}`] = Math.round(flat[`play.${kind}`] * Math.min(1, rate + (rnd() - 0.5) * 0.2));
    }
    for (const k of Object.keys(flat)) if (!flat[k]) delete flat[k];
    await saveUsage(env, user.id, counts ? { [day]: flat } : null, at);
  }
}
env.DB.sqlite.exec('CREATE TABLE IF NOT EXISTS downloads (day TEXT NOT NULL, file TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, file))');
for (let ago = 0; ago < 30; ago++) {
  const day = new Date(now - ago * 864e5).toISOString().slice(0, 10);
  for (const [file, n] of [['installer', pick(4, 19)], ['zip', pick(1, 6)]]) {
    env.DB.sqlite.prepare('INSERT INTO downloads (day, file, n) VALUES (?, ?, ?)').run(day, file, n);
  }
}
env.DB.sqlite.exec(`CREATE TABLE IF NOT EXISTS download_sources (
  day TEXT NOT NULL, file TEXT NOT NULL, src TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, file, src))`);
for (const [src, installer, zip] of [['lore', 34, 7], ['yt', 21, 2], ['discord', 9, 3], ['reddit', 5, 1], ['other', 2, 0]]) {
  const day = new Date(now).toISOString().slice(0, 10);
  env.DB.sqlite.prepare('INSERT INTO download_sources (day, file, src, n) VALUES (?, ?, ?, ?), (?, ?, ?, ?)')
    .run(day, 'installer', src, installer, day, 'zip', src, zip);
}

// Profile views, opens from outside links and shares (LOR-151).
for (let ago = 0; ago < 14; ago++) {
  const at = now - ago * 864e5, views = pick(3, 25);
  for (const [metric, n] of [['profile.view', views], ['profile.outside', Math.round(views * 0.6)], ['profile.share', pick(0, 3)]]) {
    for (let i = 0; i < n; i++) await countSite(env, [metric], at);
  }
}

const publicRoot = resolve(SITE, 'public');
const types = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
                '.html': 'text/html' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/api/admin') {
      const response = await admin({ env, request: new Request(url, { headers: req.headers }) });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    if (url.pathname === '/api/translations/summary' || url.pathname === '/api/clip-report/export') {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return;
    }
    const path = resolve(publicRoot, '.' + decodeURIComponent(url.pathname === '/admin' ? '/admin.html' : url.pathname));
    if (!path.startsWith(publicRoot + '/')) { res.writeHead(404); res.end(); return; }
    const bytes = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }); res.end(bytes);
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
}).listen(8766, '0.0.0.0', () => console.log(`Synthetic dashboard: ${origin}/admin (key: local)`));
