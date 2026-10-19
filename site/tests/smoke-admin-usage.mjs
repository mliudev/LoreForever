// Local-only synthetic dashboard: node site/tests/smoke-admin-usage.mjs, then open http://localhost:8766/admin and use
// the key "local". Made-up usage counts (LOR-413) for 40 players over 14 days, downloads by source and profile views
// and shares (LOR-151), sign-in days, profiles with levels and time played and profile updates (LOR-304), downloads
// while signed in (LOR-8) and so the funnel (LOR-10), 100 accounts over 7 weeks, CurseForge and GitHub counts per
// release (LOR-421) and companion check-ins (LOR-422) with their usage counts (LOR-435), through the real lib/usage.js,
// lib/activity.js, lib/stores.js, lib/checkins.js, lib/featureuse.js and functions/api/admin.js on an in-memory D1.
// /admin/voices shows tests/fixtures/voice-status.json through the real functions/api/admin/voice-status.js;
// Community > Willo is the real functions/api/admin/willo.js over made-up kept answers, reports and signals (Willo
// quality and the review queue, seedWillo below) and a made-up friend report; /admin/edits shows a few made-up rows
// (SAMPLE_EDITS below). No network, no real data.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { d1, SITE } from './helpers.mjs';
import { setup, findOrCreateUser } from '../lib/accounts.js';
import { saveUsage, countSite } from '../lib/usage.js';
import { snapshotStores, importAuthorStats, CF_CORE, CF_PACKS } from '../lib/stores.js';
import { setExclusion, markAsked } from '../lib/activity.js';
import { setupBilling, claimOf } from '../lib/billing.js';
import { saveCheckin } from '../lib/checkins.js';
import { readFeatureUsage, saveFeatureUsage, rollupUsage } from '../lib/featureuse.js';
import { createHash } from 'node:crypto';
import { onRequestGet as admin } from '../functions/api/admin.js';
import { onRequestGet as willoGet, onRequestPost as willoPost } from '../functions/api/admin/willo.js';
import { logAnswer, tagAnswer } from '../lib/answer-log.js';
import { logFeedback, markFixed, triageFeedback, setupFeedback, REASONS } from '../lib/answer-feedback.js';
import { signalsFor, queueWorthy, signalWords, newAnswerId } from '../lib/answer-signals.js';
import { onRequestGet as costs } from '../functions/api/admin/costs.js';
import { onRequestGet as voiceStatus, onRequestPost as postVoiceStatus } from '../functions/api/admin/voice-status.js';

const origin = 'http://localhost:8766';
const env = { DB: d1(), ADMIN_KEY: 'local' };
await setup(env);
env.DB.sqlite.exec(await readFile(new URL('../migrations/cost-snapshots.sql', import.meta.url), 'utf8'));   // the Costs tab's first snapshot

let seed = 413;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const KINDS = { zone: [2, 7, 0.72], place: [1, 5, 0.61], person: [0, 3, 0.78], quest: [0, 2, 0.52],
                dialogue: [0, 9, 0.86], answer: [0, 2, 0.91], book: [0, 1, 0.66] };
const AUTO_SHARE = { zone: 0.7, place: 0.8, dialogue: 0.95, book: 0.9 };
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
      // LOR-420: players on an add-on after 0.14 split them: started by itself (arrivals, flights, quest givers'
      // pages), heard to the end less often than what they started with Play.
      if (p < 26) {
        const auto = Math.round(flat[`play.${kind}`] * (AUTO_SHARE[kind] || 0));
        const autoDone = Math.min(auto, Math.round(auto * rate * 0.8));
        Object.assign(flat, { [`autoplay.${kind}`]: auto, [`autodone.${kind}`]: autoDone,
          [`userplay.${kind}`]: flat[`play.${kind}`] - auto,
          [`userdone.${kind}`]: Math.max(0, Math.min(flat[`play.${kind}`] - auto, flat[`done.${kind}`] - autoDone)) });
      }
    }
    for (const k of Object.keys(flat)) if (!flat[k]) delete flat[k];
    await saveUsage(env, user.id, counts ? { [day]: flat } : null, at);
  }
}
// Sign-ins and profiles (LOR-304): the 40 syncing players made their accounts when they joined, 60 more players use
// only the site, over the last 7 weeks, with more of them lately. Each signs in on the day they joined and now and then
// after; most make a profile, some make it public.
const sql = env.DB.sqlite;
const users = sql.prepare('SELECT id FROM users ORDER BY created').all().map(r => r.id);
for (let p = 40; p < 100; p++) {
  users.push((await findOrCreateUser(env, { email: `site${p}@example.invalid`, googleSub: `synthetic-${p}`, name: `Player ${p}` })).id);
}
const iso = ago => new Date(now - ago * 864e5).toISOString();
const firstUsage = id => sql.prepare('SELECT MIN(day) AS d FROM usage_days WHERE user_id = ?').get(id).d;
users.forEach((id, i) => {
  const synced = firstUsage(id);
  const ago = synced ? Math.round((now - Date.parse(synced + 'T12:00:00Z')) / 864e5) + pick(0, 3)
                     : Math.floor(48 * Math.sqrt(rnd()));       // more players joined lately
  sql.prepare('UPDATE users SET created = ? WHERE id = ?').run(iso(ago + rnd() * 0.5), id);
  const back = rnd() < (synced ? 0.75 : 0.45) ? 0.18 : 0.02;   // some come back now and then, others hardly ever
  let last = ago;
  for (let d = ago; d >= 0; d--) {
    if (d !== ago && rnd() > back) continue;
    sql.prepare('INSERT OR IGNORE INTO signin_days (user_id, day) VALUES (?, ?)').run(id, iso(d).slice(0, 10));
    last = d;
  }
  sql.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(iso(last).slice(0, 10), id);
  if (rnd() < (synced ? 1 : 0.55)) {
    const level = Math.max(1, Math.min(60, Math.round(8 + 52 * rnd() ** 1.4)));
    const played = rnd() < 0.7 ? Math.round(level * level / 40 * (0.6 + rnd())) : null;
    const data = { name: `Player ${i}`, level, stats: { played, recorded: Math.round((played ?? level) * 0.4) } };
    sql.prepare('INSERT INTO profiles (user_id, handle, public, data, created, updated) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, `player-${i}`, rnd() < 0.45 ? 1 : 0, JSON.stringify(data), iso(Math.max(0, ago - pick(0, 2))), iso(0));
  }
});
// Profile updates: pasted records, and the companion's syncs that changed a profile.
for (let ago = 0; ago < 14; ago++) {
  for (const [metric, n] of [['profile.paste', pick(1, 6)], ['profile.sync', pick(8, 30)]]) {
    for (let i = 0; i < n; i++) await countSite(env, [metric], now - ago * 864e5);
  }
}
// Site downloads while signed in (LOR-8): a few players fetch the add-on again from the site.
for (const id of users.filter(() => rnd() < 0.12)) {
  sql.prepare('INSERT INTO download_accounts (day, file, user_id, n) VALUES (?, ?, ?, ?)')
    .run(iso(pick(0, 20)).slice(0, 10), rnd() < 0.8 ? 'installer' : 'zip', id, pick(1, 2));
}

// CurseForge and GitHub (LOR-421): a release a day for 12 days, which about 3,000 CurseForge installs pick up within a
// day, snapshotted every 3 hours through the real lib/stores.js with a made-up cfwidget.
{
  const H = 3600e3, start = now - 14 * 864e5;
  const releases = Array.from({ length: 12 }, (_, i) => ({ id: 9100000 + i, name: `Lore Forever 0.${3 + i}.0`,
    up: start + (i * 1.1 + 0.3) * 864e5 + pick(0, 8) * H, cap: 2600 + pick(0, 900) }));
  const downloadsAt = (r, t) => {
    if (t < r.up) return null;
    const next = releases.find(x => x.up > r.up), newest = !next || t < next.up;
    const ran = Math.min(t, next?.up ?? t) - r.up;
    return Math.round(r.cap * (1 - Math.exp(-ran / (9 * H)))) + (newest ? 0 : Math.round((t - next.up) / H * 2));
  };
  const get = async id => {
    const t = getNow;
    if (id !== CF_CORE) return { id, title: `Lore Forever narration ${id % 100}`, downloads: { total: 200 + (id % 37) * 9 +
      Math.round((t - start) / 864e5 * (5 + id % 11)) }, files: [] };
    const files = releases.map(r => ({ id: r.id, display: r.name, uploaded_at: new Date(r.up).toISOString(),
      downloads: downloadsAt(r, t) })).filter(f => f.downloads != null).reverse();
    return { id, title: 'Lore Forever', downloads: { total: 9000 + files.reduce((n, f) => n + f.downloads, 0) }, files };
  };
  // CurseForge's author dashboard (POST /api/admin/curseforge's shape): every day until two days ago, per release
  // (q6, q7), per project (q2, q3) and per week, its unique downloaders being CurseForge's own distinct count (q10, q11).
  {
    const D = 864e5, dayStart = d => Date.parse(new Date(d).toISOString().slice(0, 10) + 'T00:00:00Z');
    const q = data => ({ id: 1, queryResult: { data, legend: [] } });
    const q2 = [], q3 = [], q6 = [], q7 = [], weeks = {};
    for (let t = dayStart(start); t <= dayStart(now - 2 * D); t += D) {
      const perFile = releases.map(r => [r.name, Math.max(0, (downloadsAt(r, t + D) ?? 0) - (downloadsAt(r, t) ?? 0))]);
      const total = perFile.reduce((n, [, v]) => n + v, 0), unique = Math.round(total * 0.86);
      const packs = Object.fromEntries(CF_PACKS.slice(0, 8).map(id => [id, 4 + (id % 9) + pick(0, 6)]));
      const packsUnique = Object.fromEntries(Object.entries(packs).map(([id, v]) => [id, Math.round(v * 0.8)]));
      q2.push({ day: t, [CF_CORE]: total, ...packs, total });
      q3.push({ day: t, [CF_CORE]: unique, ...packsUnique, unique });
      q6.push({ day: t, total, ...Object.fromEntries(perFile.filter(([, v]) => v)) });
      q7.push({ day: t, unique, ...Object.fromEntries(perFile.filter(([, v]) => v).map(([k, v]) => [k, Math.round(v * 0.86)])) });
      const wk = t - ((new Date(t).getUTCDay() + 6) % 7) * D, w = weeks[wk] ||= { day: wk, total: 0, unique: 0 };
      w.total += total; w.unique += unique;
    }
    const w = Object.values(weeks);
    await importAuthorStats(env, { fetched_at: new Date(now).toISOString(), days_back: 90, queries: {
      2: q(q2), 3: q(q3), 6: q(q6), 7: q(q7),
      10: q(w.map(x => ({ day: x.day, [CF_CORE]: x.total, total: x.total }))),
      11: q(w.map(x => ({ day: x.day, [CF_CORE]: Math.round(x.unique * 0.55), total: Math.round(x.unique * 0.55) }))),
      4: q([{ projectId: CF_CORE, total: w.reduce((n, x) => n + x.total, 0), unique: w.reduce((n, x) => n + x.unique, 0) }]),
    } }, now);
  }
  // cfwidget snapshots for the last three days only, so the days before show the author dashboard's numbers.
  let getNow = start;
  for (let t = now - 3 * 864e5; t <= now; t += 3 * H) {
    getNow = t;
    await snapshotStores(env, { now: t, get, github: releases.filter(r => r.up <= t)
      .map(r => ({ tag: 'v' + r.name.split(' ').pop(), published: new Date(r.up).toISOString(), downloads: Math.round(downloadsAt(r, t) / 40) })) });
  }
}
// Companion check-ins (LOR-422): 140 installs over 30 days, some every day, some once. Since LOR-435 most carry the
// add-on's and the companion's usage counts, read through the real lib/featureuse.js allowlist.
const SETTINGS = ['autoZone', 'onDemand', 'narrateFlights', 'questDialogue', 'journey', 'minimap'];
for (let i = 0; i < 140; i++) {
  const install = createHash('sha256').update('synthetic-install-' + i).digest('hex');
  const first = Math.floor(30 * Math.sqrt(rnd())), regular = rnd() < 0.55 ? 0.7 : 0.08;
  const lv = String(10 * pick(0, 6)), voice = rnd() < 0.7 ? 'default' : rnd() < 0.8 ? 'female' : 'none';
  const lang = rnd() < 0.75 ? 'enUS' : ['deDE', 'frFR', 'esES', 'ptBR'][pick(0, 3)], talker = rnd() < 0.4;
  for (let ago = first; ago >= 0; ago--) {
    if (ago !== first && rnd() > regular) continue;
    const addon = ago < 1 ? '0.14.0' : ago < 2 ? '0.13.1' : ago < 3 ? '0.12.0' : '0.11.0';
    const at = now - ago * 864e5;
    await saveCheckin(env, { install, companion: ago < 1 ? '0.15.0' : '0.14.0', addon: rnd() < 0.85 ? addon : '0.10.0' }, at);
    if (i % 10 === 9) continue;                 // a tenth turned the counts off
    const d = { panel: pick(0, 6), ask: pick(0, 2), faq: rnd() < 0.4 ? pick(1, 3) : 0, journey: rnd() < 0.3 ? 1 : 0,
                map: rnd() < 0.1 ? 1 : 0, min: pick(20, 240), login: pick(1, 3), chat: talker ? pick(0, 6) : 0,
                answer: talker ? pick(0, 4) : 0, freecap: talker && rnd() < 0.1 ? 1 : 0, psync: rnd() < 0.2 ? pick(1, 4) : 0,
                play: { zone: pick(0, 6), place: pick(0, 4), dialogue: pick(0, 8), person: pick(0, 2) },
                done: { zone: pick(0, 4), dialogue: pick(0, 6) }, autoplay: { zone: pick(0, 5) }, userplay: { person: pick(0, 2) },
                tab: { here: pick(0, 4), narrations: pick(0, 2), history: rnd() < 0.15 ? 1 : 0 },
                pl: rnd() < 0.12 ? { add: pick(1, 5), play: 1 } : {}, lv: { [lv]: 1 }, voice: { [voice]: 1 },
                lang: { [lang]: 1 }, client: { [lang]: 1 },
                on: Object.fromEntries(SETTINGS.filter(() => rnd() < 0.6).map(s => [s, 1])) };
    const usage = readFeatureUsage({ v: 2, days: { [new Date(at).toISOString().slice(0, 10)]: d } }, now);
    if (usage) await saveFeatureUsage(env, install, usage, false, at);
  }
}
await rollupUsage(env, new Date(now - 30 * 864e5).toISOString().slice(0, 10), new Date(now).toISOString().slice(0, 10));
// Internal builds (Mike's own dev companion, a preview add-on): left out of the counts, named on their own.
for (let i = 0; i < 2; i++) {
  await saveCheckin(env, { install: createHash('sha256').update('dev-' + i).digest('hex'), companion: '0.1.0',
    addon: '0.14.0-preview.1' }, now - i * 864e5);
}
// One account left out of the counts by hand, as from Contacts.
await setExclusion(env, users[1], true);

env.DB.sqlite.exec('CREATE TABLE IF NOT EXISTS downloads (day TEXT NOT NULL, file TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, file))');
for (let ago = 0; ago < 56; ago++) {
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

// Willo (LOR-524): her downloads for 10 days, players asking her, and plans: two paying (one a 50% first month), a
// comped one, a trial, two free Hero months and the beta's offers.
for (let ago = 0; ago < 10; ago++) {
  const day = new Date(now - ago * 864e5).toISOString().slice(0, 10);
  env.DB.sqlite.prepare('INSERT INTO downloads (day, file, n) VALUES (?, ?, ?)').run(day, 'willo', pick(5, 40));
  for (const id of users.slice(0, pick(4, 14))) for (let q = pick(1, 6); q > 0; q--) await markAsked(env, id, now - ago * 864e5);
}
await setupBilling(env);
for (const [i, plan, status, comp, ago] of [[2, 'legend', 'active', '', 0], [3, 'hero', 'active', '', 4],
                                             [4, 'legend', 'active', 'owner-legend-free', 1], [5, 'hero', 'trialing', '', 2]]) {
  env.DB.sqlite.prepare('INSERT INTO entitlements (user_id, subscription_id, plan, status, current_period_end, updated) ' +
    'VALUES (?, ?, ?, ?, ?, ?)').run(users[i], 'sub_' + i, plan, status, iso(-20), iso(0));
  env.DB.sqlite.prepare('INSERT INTO plan_log (subscription_id, user_id, plan, status, started, discounts, comp, updated) ' +
    "VALUES (?, ?, ?, ?, ?, '[]', ?, ?)").run('sub_' + i, users[i], plan, status, iso(ago), comp, iso(0));
}
// The beta promo is on (its start), so On a plan counts the free Hero months of accounts 6 and 7; account 5 took Keep Hero
// in its own (the trial above), so it is counted once.
env.LAUNCH_WEEK_START = iso(9);
for (const [claim, ago] of [[await claimOf(env, users[5], 'free'), 0], [await claimOf(env, users[6], 'free'), 0],
                            [await claimOf(env, users[7], 'free'), 1], ['hero:d', 2], ['half:e', 0]])
  env.DB.sqlite.prepare("INSERT INTO promo_claims (claim, subscription_id, created) VALUES (?, '', ?)").run(claim, iso(ago));

// Profile views, opens from outside links and shares (LOR-151).
for (let ago = 0; ago < 14; ago++) {
  const at = now - ago * 864e5, views = pick(3, 25);
  for (const [metric, n] of [['profile.view', views], ['profile.outside', Math.round(views * 0.6)], ['profile.share', pick(0, 3)]]) {
    for (let i = 0; i < n; i++) await countSite(env, [metric], at);
  }
}

// Voice work: the fixture, posted as a few pictures over the last hour so the sparkline has a line.
const voiceSample = JSON.parse(await readFile(new URL('./fixtures/voice-status.json', import.meta.url), 'utf8'));
for (let i = 5; i >= 0; i--) {
  await postVoiceStatus({ env, request: new Request(origin + '/api/admin/voice-status', { method: 'POST',
    headers: { Authorization: 'Bearer local', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...voiceSample, generated_at: new Date(now - (i * 10 + 4) * 60e3).toISOString() }) }) });
}

// Community > Willo (functions/api/admin/willo.js, for real): 30 players' kept answers over 12 days through the real
// lib/answer-log.js, with what came after each (lib/answer-signals.js: asked again, cut off, a 👎 with reasons...), and
// the review queue that makes, a few rows triaged and fixed. A made-up friend report on top (long words on purpose).
const QUESTIONS = [
  ['Westfall', 'Where is Sentinel Hill?'], ['Westfall', 'Who leads the Defias Brotherhood?'],
  ['Elwynn Forest', 'Where is Hogger?'], ['Elwynn Forest', 'Where do I turn in the wolf quest?'],
  ['Hillsbrad Foothills', 'Where does the boat from Southshore go?'], ['Alterac Mountains', 'Is Dalaran open in Forever?'],
  ['Ironforge', 'Where do I train mining?'], ['Ironforge', 'Where is the flight master?'],
  ['Stranglethorn Vale', 'Is this sword an upgrade for a rogue?'], ['Duskwood', 'Who was Stalvan Mistmantle?'],
  ['Mount Hyjal', 'How do I get to Mount Hyjal?'], ['Riverglades', 'What level is the Riverglades for?'],
];
async function seedWillo() {
  const reasons = [['wrong_fact'], ['wrong_fact', 'too_long'], ['not_my_question'], ['too_long'], ['couldnt_hear']];
  for (let p = 0; p < 30; p++) {
    const user = `willo-player-${p}`;
    let last = null;
    for (let i = 0; i < pick(4, 14); i++) {
      const at = new Date(now - pick(0, 11) * 864e5 - pick(0, 80000) * 1000);
      const [zone, q] = QUESTIONS[pick(0, QUESTIONS.length - 1)];
      const ref = newAnswerId(), spoken = rnd() < 0.5, failed = rnd() < 0.04;
      await logAnswer(env, user, { operation: 'answer', spoken, zone, question: q, answer: `A made-up answer about ${q.toLowerCase()}`,
        model: 'flash-lite', model_ms: pick(500, 1500), total_ms: pick(700, 2600), looked_up: rnd() < 0.2 ? 'quick' : 'no',
        lookups: ['forever_facts'], outcome: failed ? 'failed' : 'answered', ref }, { now: at });
      // What came next: the same question again soon after, cut off, voice dropped, or a 👎 with reasons.
      const hard = /Southshore|Dalaran|Hyjal|Riverglades/.test(q);
      const tags = signalsFor({ question: rnd() < (hard ? 0.3 : 0.08) ? q : 'And then?', previousQuestion: q, spoken: rnd() < 0.5,
        last: { answer_id: ref, ms: pick(5, 90) * 1000, spoken, failed, heard: spoken ? (rnd() < 0.08 ? 'interrupted'
          : rnd() < 0.05 ? 'dropped' : 'full') : null } });
      if (tags.length) await tagAnswer(env, user, { ref, tags }, { now: at });
      if (queueWorthy(tags, null)) await logFeedback(env, user, { kind: 'signal', said: signalWords(tags), question: q,
        answer: `A made-up answer about ${q.toLowerCase()}`, zone, spoken, answerRef: ref, signals: tags }, { now: at });
      if (rnd() < (hard ? 0.18 : 0.03)) {
        const why = reasons[pick(0, 4)];
        await logFeedback(env, user, { kind: 'report', said: why.map(r => REASONS[r]).join(', '), question: q, zone, spoken,
          answer: `A made-up answer about ${q.toLowerCase()}`, answerRef: ref, reasons: why,
          source: ['window', 'overgame', 'iphone'][pick(0, 2)], followup: rnd() < 0.4 }, { now: at });
        await tagAnswer(env, user, { ref, tags: ['reported'] }, { now: at });
      } else if (rnd() < 0.05) await tagAnswer(env, user, { ref, tags: ['liked'] }, { now: at });
      last = ref;
    }
  }
  await logFeedback(env, 'willo-player-3', { kind: 'correction', said: 'Hogger is in the Forest\'s Edge camp, not Jasperlode Mine. https://example.invalid/a-very-long-link-without-any-spaces-to-break-on/quest/176',
    question: 'Where is Hogger?', answer: 'Hogger prowls the hills near Jasperlode Mine, east of Goldshire.', zone: 'Elwynn Forest',
    sub: 'Hogger', spoken: true, source: 'voice' });
  const ids = env.DB.sqlite.prepare("SELECT id FROM answer_feedback WHERE kind = 'report' ORDER BY id").all().map(r => r.id);
  await triageFeedback(env, ids.slice(0, 6), { cls: 'missing_fact', note: 'No Forever fact for the Southshore boat yet', goldId: 'player-0001' });
  await triageFeedback(env, ids.slice(6, 8), { cls: 'retrieval', note: 'The Hyjal entry exists; the search missed it' });
  await markFixed(env, ids.slice(0, 3), { how: 'fact', ref: 'fact-southshore-boat' });
}
// WILLO_EXPORT=<folder>: Willo quality from a real export instead (answers.json: GET /api/admin/willo?answers=1&limit=1000,
// willo.json: GET /api/admin/willo), its signals worked out from each player's next question by the same rules
// (lib/answer-signals.js), for a screenshot of real numbers. The export stays out of the repo.
async function seedExport(folder) {
  const { readFileSync } = await import('node:fs');
  const { feedbackKind } = await import('../lib/answer-feedback.js');
  const { topicOf, sameQuestion } = await import('../lib/answer-signals.js');
  const rows = JSON.parse(readFileSync(`${folder}/answers.json`, 'utf8')).answers.rows;
  const fb = JSON.parse(readFileSync(`${folder}/willo.json`, 'utf8')).feedback.rows;
  await setupFeedback(env);                     // the queue's table and the answer log's
  env.DB.sqlite.exec('DELETE FROM answer_log');
  const byPlayer = new Map();
  for (const r of rows) (byPlayer.get(r.player) || byPlayer.set(r.player, []).get(r.player)).push(r);
  const tagsOf = new Map();
  for (const list of byPlayer.values()) {
    list.sort((a, b) => a.created.localeCompare(b.created));
    list.forEach((row, i) => {
      const next = list[i + 1];
      if (!next) return;
      const sounds = /\b(?:pronounced?|pronunciation|you called it)\b/i.test(next.question);
      const dispute = next.operation === 'answer' && !sounds ? feedbackKind(next.question, row.answer || '') : null;
      const t = signalsFor({ question: next.question, previousQuestion: row.question, spoken: Boolean(next.spoken), dispute,
        sounds, answered: Boolean(row.answer), last: { ms: Date.parse(next.created) - Date.parse(row.created),
          failed: row.outcome === 'failed', spoken: Boolean(row.spoken) } });
      if (t.length) tagsOf.set(row.id, t);
    });
  }
  const reported = new Set(fb.filter(f => ['flag', 'report'].includes(f.kind)).map(f => String(f.question || '').toLowerCase().trim()));
  const put = env.DB.sqlite.prepare('INSERT INTO answer_log (created, player, operation, npc, spoken, zone, sub, question, ' +
    'answer, action, model, model_ms, total_ms, looked_up, lookups, outcome, error, ref, signals, topic) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const r of rows) {
    const t = [...(tagsOf.get(r.id) || []), ...(reported.has(String(r.question).toLowerCase().trim()) ? ['reported'] : [])];
    put.run(new Date(now - (Date.parse(rows.at(-1).created) - Date.parse(r.created))).toISOString(), r.player, r.operation,
      r.npc, r.spoken, r.zone, r.sub, r.question, r.answer, r.action, r.model, r.model_ms, r.total_ms, r.looked_up, r.lookups,
      r.outcome, r.error, newAnswerId(), t.join(',') || null,
      topicOf(r.question, { operation: r.operation, lookups: String(r.lookups || '').split(','), action: r.action }));
  }
  const putFb = env.DB.sqlite.prepare('INSERT INTO answer_feedback (kind, said, question, answer, zone, sub, persona, spoken, ' +
    'user_hash, status, fact_id, note, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const f of fb) putFb.run(f.kind, f.said, f.question, f.answer, f.zone, f.sub, f.persona, f.spoken, f.player,
    f.status, f.fact_id, f.note, f.created);
  void sameQuestion;
}
if (process.env.WILLO_EXPORT) await seedExport(process.env.WILLO_EXPORT); else await seedWillo();
const SAMPLE_FRIEND_REPORTS = [{ id: 3, reporter: 'Aelric', reported: 'Grimbold', times: 2, created: iso(0), note: 'Spamming gold-selling links.',
  messages: [{ created: iso(0), body: 'cheap gold at example.invalid' }] }];
// /admin/edits (functions/api/translations/[action].js summary and review) and Community > Edits.
const SAMPLE_EDITS = { ok: true,
  locales: [{ locale: 'deDE', saved: 42, pulled: 1310, rejected: 3, last: iso(0) }, { locale: 'frFR', saved: 7, pulled: 880, rejected: 0, last: iso(1) }],
  translators: [{ user_id: 'u1', display_name: 'Lena', email: 'lena@example.invalid', locales: 'deDE', saved: 40, pulled: 1200, rejected: 3, week: 61, last: iso(0) },
                { user_id: 'u2', display_name: 'Camille', email: 'camille@example.invalid', locales: 'frFR,deDE', saved: 9, pulled: 990, rejected: 0, week: 12, last: iso(1) }] };
const SAMPLE_REVIEW = { ok: true, total: 2, edits: [
  { id: 901, locale: 'deDE', string_id: 'zone.elwynn.intro', en: 'Elwynn Forest, the heart of the Kingdom of Stormwind.',
    text: 'Der Wald von Elwynn, das Herz des Königreichs Sturmwind.', user_id: 'u1', display_name: 'Lena', email: 'lena@example.invalid', status: 'new', updated: iso(0) },
  { id: 902, locale: 'frFR', string_id: 'npc.marshal_dughan.greeting', en: 'Ach, it\'s another adventurer.',
    text: 'Ah, encore un aventurier.', user_id: 'u2', display_name: 'Camille', email: 'camille@example.invalid', status: 'new', updated: iso(1) }] };

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
    if (url.pathname === '/api/admin/costs') {
      const response = await costs({ env, request: new Request(url, { headers: req.headers }) });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    if (url.pathname === '/api/admin/voice-status') {
      const response = await voiceStatus({ env, request: new Request(url, { headers: req.headers }) });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    if (url.pathname === '/api/admin/willo') {
      const body = req.method === 'POST' ? await new Promise(ok => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => ok(b)); }) : undefined;
      const request = new Request(url, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers)
        .filter(([k]) => k !== 'origin' && k !== 'host')), body });
      const response = await (req.method === 'POST' ? willoPost : willoGet)({ env, request });
      let text = await response.text();
      if (req.method === 'GET' && !url.search) text = JSON.stringify({ ...JSON.parse(text), friendReports: SAMPLE_FRIEND_REPORTS });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(text); return;
    }
    const sample = { '/api/translations/summary': SAMPLE_EDITS,
                     '/api/translations/review': SAMPLE_REVIEW }[url.pathname];
    if (sample || url.pathname === '/api/clip-report/export') {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(sample || {})); return;
    }
    // Pages serves /admin/voices from admin/voices.html (and /admin from admin.html).
    const page = url.pathname === '/admin' ? '/admin.html' : /^\/admin\/[a-z]+$/.test(url.pathname) ? url.pathname + '.html' : url.pathname;
    const path = resolve(publicRoot, '.' + decodeURIComponent(page));
    if (!path.startsWith(publicRoot + '/')) { res.writeHead(404); res.end(); return; }
    let bytes = await readFile(path);
    // /admin?key=local (or /admin/voices?key=local) opens signed in with the local key, and &at=<section id> scrolls
    // there once it has loaded, for a headless screenshot (no typing): msedge --headless --virtual-time-budget=5000 --screenshot=...
    if (page.endsWith('.html') && url.searchParams.get('key') === 'local') {
      const at = JSON.stringify((url.searchParams.get('at') || '').replace(/[^a-z-]/g, ''));
      bytes = String(bytes).replace('</head>',
        '<script>try { sessionStorage.setItem("lf-admin", "local"); } catch (e) {}\n' +
        `setTimeout(() => { const s = document.getElementById(${at}); if (s) scrollTo(0, s.offsetTop - 60); }, 1500);</script>\n</head>`);
    }
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }); res.end(bytes);
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
}).listen(8766, '0.0.0.0', () => console.log(`Synthetic dashboard: ${origin}/admin (key: local)`));
