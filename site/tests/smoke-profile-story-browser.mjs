// Local synthetic QA of a profile told in chapters (Mike, 10/11) through the real profile handler: the two tabs, the
// road chart beside the chapters following the one being read, a land leading to its chapter on the same page, old
// links (#m-<n>, #timeline, #map) still landing, a phone's one column, and the page without JavaScript. No network
// writes. Saves screenshots.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs [CHROMIUM_PATH=...] [JOURNEY_JSON=journey.json] node site/tests/smoke-profile-story-browser.mjs
// JOURNEY_JSON: a companion journey ({v, tz, moments}) to tell instead of the synthetic one, for looking at real data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { d1, SITE } from './helpers.mjs';
import { setup, findOrCreateUser, startSession } from '../lib/accounts.js';
import { onRequest as profileApi } from '../functions/api/profile/[action].js';
import { onRequestGet as profileGet } from '../functions/u/[handle].js';
import { readJourney } from '../lib/journey.js';
import { RECORD } from './fixtures/journey/record.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const env = { DB: d1(), SITE_FEATURES: '-storyvoice,-lore' };
await setup(env);
let origin = 'http://127.0.0.1';
const user = await findOrCreateUser(env, { email: 'story-qa@example.invalid', googleSub: 'story-qa', name: 'Synthetic' });
const cookie = (await startSession(env, new Request(origin), user.id)).split(';')[0];
await profileApi({ env, params: { action: 'import' }, request: new Request(origin + '/api/profile/import', { method: 'POST',
  headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ record: RECORD }) }) });

// Twelve days on the road through the Eastern Kingdoms and Kalimdor: a few lands a day, people, quests, a dungeon
// with its bosses every few days, a level now and then, and a bad day of deaths.
function synthetic() {
  const days = [
    ['Elwynn Forest', 'Westfall'], ['Westfall', 'The Deadmines'], ['Redridge Mountains'], ['Duskwood'],
    ['Wetlands', 'Loch Modan'], ['Ironforge', 'Dun Morogh', 'Gnomeregan'], ['Darkshore'], ['Ashenvale', 'Blackfathom Deeps'],
    ['Stonetalon Mountains'], ['The Barrens', 'Wailing Caverns'], ['Thousand Needles'], ['Stranglethorn Vale'],
  ];
  const start = Date.UTC(2026, 8, 20, 18) / 1000, moments = [];
  let quest = 100, level = 10;
  days.forEach((lands, d) => {
    let t = start + d * 86400;
    for (const z of lands) {
      const dungeon = /Deadmines|Gnomeregan|Blackfathom|Wailing/.test(z);
      moments.push({ k: 'zone', t: t += 60, z, new: 1, ...(dungeon ? { inst: 1 } : {}) });
      for (let i = 0; i < (dungeon ? 3 : 6); i++) {
        if (dungeon) moments.push({ k: 'boss', t: t += 300, n: `${z.split(' ').pop()} Lord ${i + 1}`, z });
        else {
          moments.push({ k: 'npc', t: t += 120, n: `Scout ${String.fromCharCode(65 + i)} of ${z}`, z });
          moments.push({ k: 'qt', t: t += 300, id: quest, n: `Trouble in ${z} ${quest++}`, z });
        }
      }
    }
    if (d % 2 === 1) moments.push({ k: 'lvl', t: t += 60, lv: ++level, z: lands.at(-1) });
    if (d === 10) for (let i = 0; i < 5; i++) moments.push({ k: 'death', t: t += 60, z: lands[0] });
  });
  return { v: 1, tz: 0, moments };
}
const journey = readJourney(process.env.JOURNEY_JSON ? JSON.parse(await readFile(process.env.JOURNEY_JSON, 'utf8')) : synthetic());
await env.DB.prepare('UPDATE profiles SET public = 1, journey = ? WHERE user_id = ?').bind(JSON.stringify(journey), user.id).run();
const handle = (await env.DB.prepare('SELECT handle FROM profiles WHERE user_id = ?').bind(user.id).first()).handle;

const root = resolve(SITE, 'public'), types = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    let response;
    if (url.pathname.startsWith('/u/')) {
      response = await profileGet({ env, params: { handle: url.pathname.slice(3) }, request: new Request(url, { method: req.method, headers: req.headers }), waitUntil() {} });
    } else if (url.pathname === '/api/auth/me') {
      response = new Response(JSON.stringify({ user: null, features: {} }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (response) { res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return; }
    const file = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + sep)) throw Error('outside public');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
origin = 'http://127.0.0.1:' + server.address().port;
const page$ = `${origin}/u/${handle}`;
const out = resolve(process.env.STORY_QA_OUT || resolve(tmpdir(), 'lore-site-profile-story-qa'));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const errors = [];
const noSideways = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const settle = page => page.waitForTimeout(700);   // the chart glides for about half a second

async function desktop(page) {
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(page$);
  await page.locator('.pf-ch').first().waitFor();
  await page.screenshot({ path: `${out}/desktop-top.png` });
  assert.equal(await noSideways(page), true, 'no sideways scroll');
  // Two tabs, switched in place.
  assert.equal(await page.locator('.pf-tabs').isVisible(), true);
  assert.equal(await page.locator('#numbers').isVisible(), false);
  await page.locator('.pf-tabs a[data-tab=numbers]').click();
  assert.equal(await page.locator('#numbers').isVisible(), true);
  assert.equal(await page.locator('#journey').isVisible(), false);
  assert.equal(await page.evaluate(() => location.hash), '#numbers');
  await page.screenshot({ path: `${out}/desktop-numbers.png` });
  await page.locator('.pf-tabs a[data-tab=journey]').click();
  assert.equal(await page.locator('#journey').isVisible(), true);

  // The chart stays beside the reading, level with the middle of the window, and follows the chapter there.
  const chart = page.locator('#road-chart');
  assert.equal(await chart.evaluate(f => f.classList.contains('pf-following')), false, 'the whole road at the top');
  const n = await page.locator('.pf-ch').count();
  const pick = await page.locator('.pf-ch').nth(Math.min(2, n - 1)).getAttribute('data-n');
  await page.locator(`#ch-${pick}`).evaluate(c => window.scrollTo(0, c.getBoundingClientRect().top + scrollY - innerHeight * 0.45));
  await settle(page);
  assert.equal(await chart.evaluate(f => f.classList.contains('pf-following')), true, 'following a chapter');
  assert.match(await page.locator('.pf-atlas-title').textContent(), new RegExp(`^Chapter ${pick}: `));
  const lit = await page.locator('#road-chart [data-ch].pf-ch-on').evaluateAll(els => els.map(e => e.dataset.ch));
  assert.ok(lit.length > 0 && lit.every(c => c.includes(` ${pick} `)), 'only its roads and lands light up');
  const box = await chart.boundingBox();
  const middle = await page.locator('.pf-atlas-stick').evaluate(e => { const r = e.getBoundingClientRect(); return (r.top + r.bottom) / 2 - innerHeight / 2; });
  assert.ok(Math.abs(middle) < 40, 'the chart is level with the middle of the window: ' + middle);
  await page.screenshot({ path: `${out}/desktop-chapter-${pick}.png` });
  // The wheel over the chart scrolls the page (Ctrl and the wheel zoom).
  const before = await page.evaluate(() => scrollY);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => scrollY) > before, 'the page scrolled');

  // A land leads to the chapter it was first reached in, on this page.
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  const stop = page.locator('a.pf-ch-stop').last();
  const target = (await stop.getAttribute('href')).slice(1);
  await stop.click();
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => location.pathname + location.hash), `/u/${handle}#${target}`);
  const top = await page.locator('#' + target).evaluate(c => c.getBoundingClientRect().top);
  assert.ok(Math.abs(top) < 120, `the chapter is at the top: ${top}`);

  // Old links still land: a moment opens its chapter's fold; #timeline is the chapters; #map the chart.
  const m = await page.locator('.pf-ch .pf-visit li[id^="m-"]').last().getAttribute('id');
  await page.goto(`${page$}#${m}`);
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#' + m).isVisible(), true, 'the moment is shown, its fold open');
  await page.goto(`${page$}#timeline`);
  assert.equal(await page.locator('#chapters').isVisible(), true);
  await page.goto(`${page$}#numbers`);
  assert.equal(await page.locator('#numbers').isVisible(), true);
  assert.equal(await page.locator('#journey').isVisible(), false);
}

async function phone(page) {
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(page$);
  await page.locator('.pf-ch').first().waitFor();
  assert.equal(await noSideways(page), true, 'no sideways scroll on a phone');
  // One column: the story, the chart (not sticky), then the chapters, each with its own small chart.
  const y = sel => page.locator(sel).first().evaluate(e => e.getBoundingClientRect().top + scrollY);
  assert.ok(await y('.pf-story') < await y('#road-chart') && await y('#road-chart') < await y('.pf-ch'), 'story, chart, chapters');
  assert.notEqual(await page.locator('.pf-atlas-stick').evaluate(e => getComputedStyle(e).position), 'sticky');
  assert.equal(await page.locator('.pf-ch .pf-mini').first().isVisible(), true);
  await page.screenshot({ path: `${out}/phone-top.png`, fullPage: false });
  await page.locator('.pf-ch').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/phone-chapter.png` });
  await page.locator('.pf-tabs a[data-tab=numbers]').click();
  assert.equal(await noSideways(page), true);
  await page.screenshot({ path: `${out}/phone-numbers.png` });
}

try {
  await desktop(await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage());
  await phone(await (await browser.newContext({ viewport: { width: 360, height: 760 }, hasTouch: true, isMobile: true })).newPage());
  // Without JavaScript both tabs are there, one after the other, and a land is a plain link to its chapter.
  const plain = await (await browser.newContext({ javaScriptEnabled: false })).newPage();
  await plain.goto(page$);
  assert.equal(await plain.locator('#journey').isVisible(), true);
  assert.equal(await plain.locator('#numbers').isVisible(), true);
  assert.equal(await plain.locator('.pf-tabs').isVisible(), false);
  assert.match(await plain.locator('a.pf-ch-stop').first().getAttribute('href'), /^#ch-\d+$/);
  assert.deepEqual(errors, []);
  console.log('PASS tabs, the chart following the chapter in view and staying beside it, wheel scrolls the page, a land to its chapter, '
    + 'old #m-/#timeline/#numbers links, phone one column with small charts, no JavaScript; screenshots: ' + out);
} finally {
  await browser.close();
  await new Promise(ok => server.close(ok));
  env.DB.sqlite.close();
}
