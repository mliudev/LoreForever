// What Willo keeps for her notebook (lib/keeps-notebook.js, LOR-666 with LOR-661/663/664/665): notes, goals, pins and
// reminders each have their section; a line changed or erased on the page is changed or gone on the site, an erase
// leaves no Undo behind and no old copy of the page can be saved over it, and Willo's app is told to read it again.
// D1 is node:sqlite (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onRequest as keepsApi } from "../functions/api/keeps/[action].js";
import { findOrCreateUser, setup, startSession } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { savePage, readNotebook, NotebookError, NOTEBOOK_SETUP } from "../lib/willo-notebook.js";
import { setupKeeps } from "../lib/willo-keeps.js";
import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const env = { DB: d1() };
const HURIN = "char:Húrin-ClassicBetaPvE";
const PIN = "Kobold den: the elite inside hits hard · Fargodeep Mine, Elwynn Forest (south, 41, 65) · October 18";
const PAGE = `## To do
- [ ] 10 Linen Cloth for bags
- [x] Train at level 20

## Goals
- [ ] Riding at level 40: 100 gold
- [x] Tailoring 225

## Pins
- ${PIN}
`;

beforeEach(async () => {
  await setup(env);
  await env.DB.batch(NOTEBOOK_SETUP.map(sql => env.DB.prepare(sql)));
  await setupKeeps(env);
  for (const t of ["users", "sessions", "devices", "device_links", "rate_limits", "notebook_pages", "notebook_reminders",
                   "keeps_changes", "keeps_cleared"]) env.DB.sqlite.exec(`DELETE FROM ${t}`);
});

async function player(handle) {
  const user = await findOrCreateUser(env, { email: `${handle}@example.com`, googleSub: handle, name: handle });
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  const { token } = await claimToken(env, link.device_code);
  const send = async (action, body, headers) => {
    const method = body === undefined ? "GET" : "POST";
    const request = new Request(`${ORIGIN}/api/keeps/${action}`, { method, headers: new Headers({
      ...(method === "POST" ? { "Content-Type": "application/json", Origin: ORIGIN } : {}), ...headers }),
      body: method === "POST" ? JSON.stringify(body) : undefined });
    const res = await keepsApi({ request, env, params: { action: action.split("?")[0] } });
    return { status: res.status, body: res.headers.get("Content-Type")?.includes("json") ? await res.json() : await res.text() };
  };
  const page = (action, body) => send(action, body, { Cookie: cookie });
  const app = action => send(action, undefined, { "X-LF-Client": "companion/0.22.0", Authorization: `Bearer ${token}` });
  return { user, page, app };
}

async function withNotebook(user) {
  await savePage(env, user.id, HURIN, PAGE, 0);
  await savePage(env, user.id, "account", "## Notes\n- Raid night is Thursday\n", 0);
  await savePage(env, user.id, "char:Lena-ClassicBetaPvE", "- Buy vials from the trade supplier\n", 0);
  const now = new Date().toISOString();
  env.DB.sqlite.prepare("INSERT INTO notebook_reminders (id, user_id, page, text, kind, place, level, at, created, fired) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    `${user.id}-r1`, user.id, HURIN, "Train your new spells", "place", "Ironforge", null, null, now, null,
    `${user.id}-r2`, user.id, "account", "Head to bed", "time", null, null, "2026-10-19T04:30:00.000Z", now, null);
}
const body = (user, page = HURIN) => env.DB.sqlite.prepare("SELECT body, version, prev_body FROM notebook_pages " +
  "WHERE user_id = ? AND page = ?").get(user.id, page);
const section = (view, id) => view.sections.find(s => s.id === id);
const texts = (view, id) => section(view, id).items.map(i => i.text);

test("notes, goals, pins and reminders each have their own section, per character", async () => {
  const hurin = await player("hurin");
  await withNotebook(hurin.user);
  const view = (await hurin.page("all")).body;
  assert.deepEqual(view.sections.map(s => s.id).slice(0, 4), ["notebook", "goals", "pins", "reminders"]);
  assert.deepEqual(texts(view, "notebook").sort(), ["10 Linen Cloth for bags", "Buy vials from the trade supplier",
    "Raid night is Thursday", "Train at level 20"].sort());
  assert.deepEqual(texts(view, "goals"), ["Riding at level 40: 100 gold", "Tailoring 225"]);
  assert.deepEqual(section(view, "goals").items.map(i => [i.detail, Boolean(i.done)]), [["Working on it", false], ["Reached", true]]);
  assert.deepEqual(texts(view, "pins"), [PIN], "a pin as the journey-recall session writes it");
  const [ironforge, bed] = ["Train your new spells", "Head to bed"].map(t => section(view, "reminders").items.find(i => i.text === t));
  assert.equal(ironforge.detail, "When you reach Ironforge");
  assert.equal(ironforge.character, "Húrin-ClassicBetaPvE");
  assert.equal(bed.due, "2026-10-19T04:30:00.000Z", "a time shows on the viewer's clock");
  assert.equal(bed.character, null);
  assert.deepEqual(view.characters.map(c => c.name).sort(), ["Húrin", "Lena"]);
  for (const s of view.sections.slice(0, 4)) assert.equal(s.edit, true, `${s.id} lines can be changed`);
});

test("Change edits the line on the site; Erase takes it out with its Undo, and an old tab can't bring it back", async () => {
  const hurin = await player("hurin");
  await withNotebook(hurin.user);
  let view = (await hurin.page("all")).body;
  const goal = section(view, "goals").items[0];
  const changed = await hurin.page("edit", { section: "goals", id: goal.id, text: "Riding at level 40: 90 gold" });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.item.text, "Riding at level 40: 90 gold");
  assert.match(body(hurin.user).body, /^- \[ \] Riding at level 40: 90 gold$/m, "kept as a goal to-do");
  const before = body(hurin.user);
  view = (await hurin.page("all")).body;
  const pin = section(view, "pins").items[0];
  assert.deepEqual((await hurin.page("erase", { section: "pins", id: pin.id })).body, { ok: true, gone: true });
  const after = body(hurin.user);
  assert.doesNotMatch(after.body, /Kobold den|## Pins/, "the pin and its empty heading are gone");
  assert.equal(after.prev_body, null, "no Undo holds the erased pin");
  assert.equal(after.version, before.version + 1);
  // The Notebook tab's copy from before the erase can't be saved over it, at its version or as a new page.
  for (const version of [before.version, 0]) {
    await assert.rejects(savePage(env, hurin.user.id, HURIN, before.body, version), e => e instanceof NotebookError && e.status === 409);
  }
  assert.doesNotMatch(body(hurin.user).body, /Kobold den/);
  // A line already gone, or changed in between, is nothing to erase.
  assert.equal((await hurin.page("erase", { section: "pins", id: pin.id })).body.gone, false);
  // Willo's app is told to read the notebook again.
  assert.ok((await hurin.app("changes")).body.changes.pins);
});

test("Erase all of these takes one kind, for everyone or one character, and leaves the rest", async () => {
  const hurin = await player("hurin");
  await withNotebook(hurin.user);
  assert.equal((await hurin.page("erase-section", { section: "goals" })).status, 200);
  let view = (await hurin.page("all")).body;
  assert.deepEqual(texts(view, "goals"), []);
  assert.equal(texts(view, "pins").length, 1, "pins stay");
  assert.equal(texts(view, "notebook").length, 4, "notes stay");
  assert.doesNotMatch(body(hurin.user).body, /## Goals/);
  await hurin.page("erase-section", { section: "notebook", character: "Húrin-ClassicBetaPvE" });
  view = (await hurin.page("all")).body;
  assert.deepEqual(texts(view, "notebook").sort(), ["Buy vials from the trade supplier", "Raid night is Thursday"],
    "only Húrin's notes went");
  await hurin.page("erase-section", { section: "reminders", character: "Húrin-ClassicBetaPvE" });
  assert.deepEqual(texts((await hurin.page("all")).body, "reminders"), ["Head to bed"]);
});

test("Erase everything empties the notebook and its reminders, and her next answer reads nothing of it", async () => {
  const hurin = await player("hurin"), lena = await player("lena");
  await withNotebook(hurin.user);
  await withNotebook(lena.user);
  assert.equal((await hurin.page("erase-all", { confirm: "erase" })).status, 200);
  const view = (await hurin.page("all")).body;
  for (const id of ["notebook", "goals", "pins", "reminders"]) assert.deepEqual(texts(view, id), [], id);
  for (const page of [HURIN, "account", "char:Lena-ClassicBetaPvE"]) {
    const row = body(hurin.user, page);
    assert.equal(row.body.trim(), "", `${page} is empty`);
    assert.equal(row.prev_body, null, `${page} has no Undo`);
  }
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM notebook_reminders WHERE user_id = ?").get(hurin.user.id).n, 0);
  const read = await readNotebook(env, hurin.user.id, HURIN);
  assert.ok(read.pages.every(p => !p.body.trim()) && !read.reminders.length, "nothing for her answers");
  assert.deepEqual(Object.keys((await hurin.app("changes")).body.changes).sort(),
    ["chats", "goals", "notebook", "pins", "reminders"]);
  const theirs = (await lena.page("all")).body;
  assert.equal(texts(theirs, "pins").length, 1, "another player's notebook is untouched");
  const file = (await hurin.page("export")).body;
  assert.match(file, /## Notebook[\s\S]*Nothing kept\./);
});

test("asked what she knows about you, she's handed the notebook's counts, never left to count", async () => {
  const { keptSummary } = await import("../lib/keeps-notebook.js");
  const { asksWhatKept } = await import("../lib/willo-help.js");
  assert.equal(keptSummary([{ body: PAGE }, { body: "## Notes\n- Raid night is Thursday\n" }],
    [{ fired: null }, { fired: "2026-10-18T10:00:00Z" }]), "1 to-do, 1 note, 1 goal, 1 pin and 1 reminder",
    "done to-dos and reached goals aren't counted, nor a reminder already said");
  assert.equal(keptSummary([], []), "");
  for (const q of ["What do you know about me?", "what do you remember of me", "What does Willo keep about me?"]) {
    assert.ok(asksWhatKept(q), q);
  }
  for (const q of ["Do you remember Arthas?", "What do you know about Westfall?", "Forget everything you know about me."]) {
    assert.ok(!asksWhatKept(q), q);
  }
});
