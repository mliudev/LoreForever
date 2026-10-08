import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as workflow from '../public/translate/workflow.js';
import { problem, isList } from '../public/translate/check.js';
const html = readFileSync(new URL('../public/translate/dashboard.html', import.meta.url), 'utf8');
const script = html.split('<script type="module">')[1].split('</script>')[0].replace(/^import .*;$/gm, '');
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.events = {}; this.style = {}; this.value = ''; this.hidden = false; this.textContent = ''; this.classList = { toggle() {} }; }
  setAttribute(k, v) { this.attributes[k] = v; if (k === 'id') this.id = v; if (k.startsWith('data-')) this.dataset[k.slice(5)] = v; }
  append(...children) { for (const child of children) { if (child instanceof Element) child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  after(child) { child.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, child); }
  addEventListener(k, fn) { (this.events[k] ||= []).push(fn); }
  async fire(k) { for (const fn of this.events[k] || []) await fn({ preventDefault() {} }); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { return this.children.filter(c => c instanceof Element).flatMap(c => [...(selector === c.tagName || selector.startsWith('.') && c.className?.split(' ').includes(selector.slice(1)) ? [c] : []), ...c.querySelectorAll(selector)]); }
}
async function setup({ search = '?lang=frFR&entry=zone:elwynn&line=zone:elwynn%23faq1&voice=my-voice', signedIn = true, edits = [], otherEntry = false, saveReply = { ok: true, status: 'new', updated: 'now' } } = {}) {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element()]));
  elements.get('td-meter').append(new Element('span'));
  const groups = Object.fromEntries(['mode', 'show', 'cat'].map(k => [k, [...html.matchAll(new RegExp('data-' + k + '="([^"]+)"', 'g'))].map(m => { const e = new Element('button'); e.dataset[k] = m[1]; e.append(new Element('span')); return e; })]));
  const document = { createElement: t => new Element(t), getElementById: id => elements.get(id) || [...elements.values()].flatMap(e => e.querySelectorAll('a')).find(e => e.id === id), querySelectorAll: selector => groups[selector.slice(6, -1)] || [] };
  const calls = [], timers = new Map(); let n = 0;
  const english = [['zone:elwynn/n', 'Elwynn Forest'], ['zone:elwynn/s', 'A green forest near the city.'], ['zone:elwynn/faq/1/q', 'Where is it?'], ['zone:elwynn/faq/1/a', 'It is near Stormwind.']];
  if (otherEntry) english.push(['npc:other/n', 'Other']);
  const assets = {
    '/api/translations/me': { ok: true, user: signedIn ? { display_name: 'French narrator' } : null, languages: ['frFR'] },
    '/translate/languages.json': { languages: [{ locale: 'frFR', name: 'Francais', hasText: true, coverage: { percent: 100 } }, { locale: 'deDE', name: 'Deutsch', hasText: false }] },
    '/translate/data/en/index.json': { sections: [{ id: 'zones_01', label: 'Zones', count: 4 }] },
    '/translate/data/en/entries.json': [['zone:elwynn', 'zones_01'], ...(otherEntry ? [['npc:other', 'zones_01']] : [])],
    '/translate/data/en/ui.json': { names: {}, strings: [] }, '/translate/data/frFR/ui.json': {},
    '/translate/data/en/zones_01.json': { names: { 'zone:elwynn': 'Elwynn Forest' }, strings: english },
    '/translate/data/frFR/zones_01.json': Object.fromEntries(english.map(([id, en]) => [id, 'French ' + en])),
    '/translate/data/frFR/status.json': { missing: [], stale: [], draft: ['zone:elwynn', ...(otherEntry ? ['npc:other'] : [])], ui_missing: [], ui_draft: [] },
    '/api/translations/edits?locale=frFR': { edits }, '/api/translations/reports?locale=frFR': { reports: [] },
    '/voices/lines.json': { groups: [{ stories: [{ lines: [{ id: 'zone:elwynn#faq1', fields: ['zone:elwynn/faq/1/q', 'zone:elwynn/faq/1/a'], text: { enUS: 'Where is it? It is near Stormwind.', frFR: 'French script.' } }] }] }] },
  };
  const context = { ...workflow, problem, isList, URLSearchParams, location: { search, pathname: '/translate/dashboard' }, document, window: { addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, kitUpload: () => ({ mount() {}, reset() {} }), setTimeout: fn => { timers.set(++n, fn); return n; }, clearTimeout: id => timers.delete(id), fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => url === '/api/translations/save' ? (typeof saveReply === 'function' ? saveReply(JSON.parse(opts.body)) : saveReply) : assets[url] || {} }; } };
  runInNewContext(script.replace('start();', 'globalThis.ready = start();\nglobalThis.inspect = { state, current, workList, pendingRows, flushRows, stringRow };'), context);
  await context.ready;
  const rows = () => elements.get('td-list').querySelectorAll('.td-row');
  return { ...context.inspect, elements, groups, calls, context, rows, row: id => rows().find(e => e.dataset.string === id), english };
}

test('an exact recording link shows every entry field despite 100% coverage and highlights both FAQ fields', async () => {
  const h = await setup();
  assert.equal(h.state.mode, 'browse'); assert.equal(h.state.show, 'all'); assert.equal(h.rows().length, 4);
  assert.deepEqual(h.rows().filter(e => e.className.includes('td-narrated')).map(e => e.dataset.string), ['zone:elwynn/faq/1/q', 'zone:elwynn/faq/1/a']);
  assert.deepEqual(h.rows().slice(0, 2).map(e => e.dataset.string), ['zone:elwynn/faq/1/q', 'zone:elwynn/faq/1/a'], 'recording fields appear before the remaining entry text');
  assert.equal(h.elements.get('td-recording').hidden, false);
  assert.equal(h.elements.get('td-upload').hidden, true, 'offline upload does not interrupt a recording correction');
  const back = h.context.document.getElementById('td-back-recording');
  const url = new URL(back.attributes.href, 'https://example.com');
  assert.equal(url.searchParams.get('line'), 'zone:elwynn#faq1'); assert.equal(url.searchParams.get('voice'), 'my-voice');
});
test('signed-out contributor returns to the same entry and recording after sign-in', async () => {
  const h = await setup({ signedIn: false });
  const next = new URL(h.elements.get('td-signin').href, 'https://example.com').searchParams.get('next');
  assert.equal(next, h.context.location.pathname + h.context.location.search);
});
test('checking one row saves a line check and leaves the entry in drafts', async () => {
  const h = await setup();
  await h.row('zone:elwynn/n').querySelector('.td-lgtm').fire('click');
  await h.flushRows();
  assert.deepEqual(Array.from(h.workList('draft')), ['zone:elwynn']);
  assert.equal(h.state.mine['zone:elwynn/n'].en, 'Elwynn Forest');
  assert.match(h.row('zone:elwynn/n').querySelector('.td-note').textContent, /Checked by you: saved, awaiting import/);
});
test('stale pending edit is retained but never replaces the current translation or English', async () => {
  const h = await setup({ edits: [{ string_id: 'zone:elwynn/n', en: 'Older English', text: 'Older proposal', status: 'new' }] });
  assert.equal(h.row('zone:elwynn/n').querySelector('textarea').value, 'French Elwynn Forest');
  assert.equal(h.row('zone:elwynn/n').querySelector('details').children[2].textContent, 'Older proposal');
  assert.match(h.row('zone:elwynn/n').querySelector('.td-note').textContent, /Your saved edit is kept/);
  assert.equal(h.calls.filter(c => c.url === '/api/translations/save').length, 0);
});
test('failed check stays unsaved and prevents returning to recording', async () => {
  const h = await setup({ saveReply: { ok: false, error: 'Offline' } });
  await h.row('zone:elwynn/n').querySelector('.td-lgtm').fire('click');
  assert.equal(await h.flushRows(), false);
  assert.equal(h.pendingRows.size, 1);
  await h.context.document.getElementById('td-back-recording').fire('click');
  assert.equal(h.context.location.href, undefined);
  assert.match(h.row('zone:elwynn/n').querySelector('.td-note').textContent, /Not saved: Offline/);
});
test('changing language flushes edits in the language they were written in', async () => {
  const h = await setup(); const box = h.row('zone:elwynn/n').querySelector('textarea');
  box.value = 'Foret francaise'; await box.fire('input');
  h.elements.get('td-locale').value = 'deDE'; await h.elements.get('td-locale').fire('change');
  const saved = h.calls.filter(c => c.url === '/api/translations/save').map(c => JSON.parse(c.opts.body));
  assert.equal(saved.length, 1); assert.equal(saved[0].locale, 'frFR'); assert.equal(saved[0].text, 'Foret francaise');
});
test('malformed entry/line/voice input never creates arbitrary return paths', () => {
  assert.equal(workflow.recordingContext(new URLSearchParams('entry=https://evil.test')), null);
  const context = workflow.recordingContext(new URLSearchParams('entry=zone:elwynn&line=zone:other%23faq1&voice=../evil'));
  assert.deepEqual(context, { entry: 'zone:elwynn', line: 'zone:elwynn', voice: '' });
  assert.equal(workflow.usableEdit({ status: 'new', text: 'French' }, 'English'), false);
  assert.match(workflow.editNote({ status: 'pulled' }, 'English', 'French', false)[0], /does not confirm a merge or release/);
});
test('main narration highlights the generator-selected safe section, never assumes section one', () => {
  const context = { entry: 'zone:elwynn', line: 'zone:elwynn', voice: '' };
  assert.deepEqual([...workflow.narrationFields(context, { fields: ['zone:elwynn/n', 'zone:elwynn/s', 'zone:elwynn/sec/2/b', 'zone:other/s'] })], ['zone:elwynn/n', 'zone:elwynn/s', 'zone:elwynn/sec/2/b']);
  assert.deepEqual([...workflow.narrationFields(context, null)], ['zone:elwynn/n', 'zone:elwynn/s']);
});
test('failed autosave preserves the text and language when the contributor tries to switch', async () => {
  const h = await setup({ saveReply: { ok: false, error: 'Offline' } }); const box = h.row('zone:elwynn/n').querySelector('textarea');
  box.value = 'Foret francaise'; await box.fire('input');
  h.elements.get('td-locale').value = 'deDE'; await h.elements.get('td-locale').fire('change');
  assert.equal(h.state.locale, 'frFR'); assert.equal(h.elements.get('td-locale').value, 'frFR');
  assert.equal(box.value, 'Foret francaise'); assert.equal(h.pendingRows.size, 1);
});
test('processed pulled edits never claim they were imported or used', async () => {
  const h = await setup({ edits: [{ string_id: 'zone:elwynn/n', en: 'Old English', text: 'Superseded proposal', status: 'pulled' }] });
  assert.equal(h.row('zone:elwynn/n').querySelector('textarea').value, 'French Elwynn Forest');
  assert.match(h.row('zone:elwynn/n').querySelector('.td-note').textContent, /Processed: no longer pending/);
  assert.doesNotMatch(h.row('zone:elwynn/n').querySelector('.td-note').textContent, /Imported/);
  assert.match(h.elements.get('td-progress-text').textContent, /1 processed, no longer pending/);
});
test('whole-entry check keeps every save in its original language while a language switch waits', async () => {
  let releaseFirst;
  const first = new Promise(resolve => { releaseFirst = resolve; });
  let requests = 0;
  const h = await setup({ search: '?lang=frFR&cat=draft', saveReply: () => ++requests === 1 ? first : { ok: true, status: 'new', updated: 'now' } });
  const all = h.elements.get('td-list').querySelector('.td-lgtm-all');
  const checking = all.fire('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.equal(h.row('zone:elwynn/n').querySelector('textarea').disabled, true);
  h.elements.get('td-locale').value = 'deDE';
  const switching = h.elements.get('td-locale').fire('change');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.locale, 'frFR');
  releaseFirst({ ok: true, status: 'new', updated: 'now' });
  await Promise.all([checking, switching]);
  const saves = h.calls.filter(c => c.url === '/api/translations/save').map(c => JSON.parse(c.opts.body));
  assert.equal(saves.length, 4);
  assert.ok(saves.every(s => s.locale === 'frFR' && s.text.startsWith('French ')));
  assert.equal(h.state.locale, 'deDE');
});
test('whole-entry check preserves another entry with invalid or failed edits so they can be repaired', async () => {
  for (const invalid of [true, false]) {
    let releaseFirst, failOther = true, requests = 0;
    const first = new Promise(resolve => { releaseFirst = resolve; });
    const h = await setup({ search: '?lang=frFR&cat=draft', otherEntry: true, saveReply: body => {
      if (body.id === 'npc:other/n' && failOther) return { ok: false, error: 'Offline' };
      return ++requests === 1 ? first : { ok: true, status: 'new', updated: 'now' };
    } });
    const checking = h.elements.get('td-list').querySelector('.td-lgtm-all').fire('click');
    await new Promise(resolve => setImmediate(resolve));
    const box = h.row('npc:other/n').querySelector('textarea');
    const entered = invalid ? 'Bad |r' : 'French correction';
    box.value = entered; await box.fire('input');
    if (!invalid) await box.fire('blur');
    releaseFirst({ ok: true, status: 'new', updated: 'now' });
    await checking;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.row('npc:other/n').querySelector('textarea'), box, 'the editable box stays attached');
    assert.equal(box.value, entered);
    assert.equal(await h.flushRows(), false, 'the failed edit still prevents navigation');
    assert.match(h.row('npc:other/n').querySelector('.td-note').textContent, invalid ? /code the English/ : /Not saved: Offline/);
    assert.match(h.row('zone:elwynn/n').querySelector('.td-note').textContent, /saved, awaiting import/);
    assert.equal(h.row('zone:elwynn/n').querySelector('.td-lgtm').hidden, true);
    failOther = false;
    box.value = 'French repaired'; await box.fire('input');
    assert.equal(await h.flushRows(), true, 'the same box can fix the edit and unblock navigation');
    assert.equal(h.pendingRows.size, 0);
    assert.equal(h.state.mine['npc:other/n'].text, 'French repaired');
  }
});
