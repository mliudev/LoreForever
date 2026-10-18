// My contributions (LOR-621): GET /api/contributions lists only the signed-in player's own items, with what became of
// each, and never another contributor's name. D1 is node:sqlite (helpers.mjs). Run: node --test site/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as contributePost } from "../functions/api/contribute.js";
import { onRequestGet as contributionsGet } from "../functions/api/contributions.js";
import { setup, findOrCreateUser, startSession } from "../lib/accounts.js";
import { d1 } from "./helpers.mjs";

const ORIGIN = "https://loreforeverwow.com";
const env = { DB: d1(), ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } };

async function upload(cookie, ip, text) {
  const request = new Request(ORIGIN + "/api/contribute", { method: "POST", body: JSON.stringify({ source: "file",
    lines: [{ kind: "quest", ref_id: "77", part: "detail", locale: "enUS", text }] }),
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": ip, Cookie: cookie } });
  const waits = [];
  assert.equal((await contributePost({ request, env, waitUntil: p => waits.push(p) })).status, 200);
  await Promise.all(waits);
}

const mine = async cookie => {
  const res = await contributionsGet({ request: new Request(ORIGIN + "/api/contributions", { headers: cookie ? { Cookie: cookie } : {} }), env });
  return { status: res.status, body: await res.json() };
};

test("only your own items, each with its state; no one else's name", async () => {
  await setup(env);
  const alice = await findOrCreateUser(env, { email: "alice@example.com", googleSub: "a1", name: "Alice Real" });
  const bob = await findOrCreateUser(env, { email: "bob@example.com", googleSub: "b1", name: "Bob Real" });
  env.DB.sqlite.prepare("UPDATE users SET display_name = 'Bobbington', show_public = 1 WHERE id = ?").run(bob.id);
  const cookieOf = async u => (await startSession(env, new Request(ORIGIN), u.id)).split(";")[0];
  const [a, b] = [await cookieOf(alice), await cookieOf(bob)];

  await upload(a, "192.0.2.1", "The same words from both.");
  await upload(b, "192.0.2.2", "The same words from both.");
  await upload(b, "192.0.2.2", "Only Bob sent this, on another part?");
  const edit = env.DB.sqlite.prepare("INSERT INTO translation_edits (user_id, locale, string_id, en, text, created, updated, status, outcome, reason) " +
    "VALUES (?, 'deDE', 'zone:elwynn/n', 'Elwynn', ?, 'now', ?, ?, ?, ?)");
  edit.run(alice.id, "Wald von Elwynn", "2026-10-01", "pulled", "unusable", "the English changed since");
  edit.run(bob.id, "Bobs Wald", "2026-10-02", "new", null, null);
  const report = env.DB.sqlite.prepare("INSERT INTO clip_reports (created, updated, clip, voice, reason, user_id, sender, uploader, status) " +
    "VALUES ('2026-10-03', '2026-10-03', ?, 'LoreForever_Voice_Narrator', 'name', ?, 's', ?, ?)");
  report.run("quest:77:detail", alice.id, "u:" + alice.id, "done");
  report.run("quest:78:detail", bob.id, "u:" + bob.id, "open");

  assert.equal((await mine(null)).status, 401);
  const { body } = await mine(a);
  assert.equal(body.ok, true);
  assert.deepEqual(body.translations.items.map(e => [e.text, e.state.label]), [["Wald von Elwynn", "Not used: the English changed since"]]);
  assert.deepEqual(body.lines.items.map(l => [l.text, l.state.key]), [["The same words from both.", "accepted"]]);
  assert.equal(body.lines.total, 1);
  assert.deepEqual(body.reports.map(r => [r.clip, r.state.key]), [["quest:77:detail", "shipped"]]);
  const raw = JSON.stringify(body);
  for (const other of ["Bob", "bob@example.com", "Only Bob", "quest:78", bob.id]) assert.ok(!raw.includes(other), other);
});

test("reports on a player's voice go to its narrator; a new take closes them; our voices get fixed_in (LOR-621)", async () => {
  const { closeRetaken, shipReports } = await import("../lib/clipreports.js");
  await setup(env);
  const nara = await findOrCreateUser(env, { email: "nara@example.com", googleSub: "n1", name: "Nara Real" });
  const rep = await findOrCreateUser(env, { email: "rep@example.com", googleSub: "r1", name: "Reporter Real" });
  env.ASSETS = { fetch: async url => new URL(url).pathname === "/voices/voices.json"
    ? Response.json({ voices: [{ id: "nara-voice", name: "Nara's voice", owner: nara.id, addon: "LoreForever_Voice_NaraVoice" }] })
    : new Response("not found", { status: 404 }) };
  const report = env.DB.sqlite.prepare("INSERT INTO clip_reports (created, updated, clip, voice, reason, name, say_as, note, " +
    "user_id, sender, uploader, country, status, resolved) VALUES ('2026-10-10', '2026-10-10', ?, ?, 'name', 'Teldrassil', " +
    "'tel-DRASS-il', 'stress the middle', ?, 's', ?, 'DE', ?, ?)");
  report.run("zone:teldrassil", "LoreForever_Voice_NaraVoice", rep.id, "u:" + rep.id, "open", null);
  report.run("zone:elwynn", "LoreForever_Voice_Default", rep.id, "u:" + rep.id, "done", "2026-10-11T00:00:00.000Z");
  const cookieOf = async u => (await startSession(env, new Request(ORIGIN), u.id)).split(";")[0];

  const narrator = (await mine(await cookieOf(nara))).body;
  assert.deepEqual(narrator.voice_reports.map(r => [r.voice, r.clip, r.say_as, r.note]),
    [["Nara's voice", "zone:teldrassil", "tel-DRASS-il", "stress the middle"]]);
  for (const other of ["rep@example.com", "Reporter", rep.id, "DE"]) assert.ok(!JSON.stringify(narrator.voice_reports).includes(other), other);
  const reporter = (await mine(await cookieOf(rep))).body;
  assert.deepEqual(reporter.reports.map(r => r.state.label).sort(),
    ["Fixed: goes out with the next update", "Waiting: sent to the narrator of that voice"]);

  assert.equal(await closeRetaken(env, "LoreForever_Voice_NaraVoice", "zone:teldrassil"), 1);
  assert.equal(await shipReports(env, "0.21.0", "2026-10-12T00:00:00Z", ["LoreForever_Voice_NaraVoice"]), 1, "only our voice's report");
  const after = (await mine(await cookieOf(rep))).body.reports.map(r => r.state.label).sort();
  assert.deepEqual(after, ["Fixed in 0.21.0", "Fixed: its narrator recorded it again"]);
});

test("a connected Willo's uploads are the player's, privately: on My contributions, never credited to the account (LOR-621)", async () => {
  const { startLink, decideLink, claimToken } = await import("../lib/devices.js");
  const { onRequestGet: contributeGet } = await import("../functions/api/contribute/[action].js");
  await setup(env);
  const owner = await findOrCreateUser(env, { email: "willo@example.com", googleSub: "w1", name: "Real Person" });
  env.DB.sqlite.prepare("UPDATE users SET display_name = 'Shown Name', show_public = 1 WHERE id = ?").run(owner.id);
  const link = await startLink(env);
  await decideLink(env, link.user_code, owner, true);
  const { token } = await claimToken(env, link.device_code);
  const send = async (text, headers = {}, ref = "88") => {
    const request = new Request(ORIGIN + "/api/contribute", { method: "POST", body: JSON.stringify({ lines: [{ kind: "quest",
      ref_id: ref, part: "detail", locale: "enUS", text }], install: "a".repeat(64), nick: "Wisp" }),
      headers: { "Content-Type": "application/json", "X-LF-Client": "companion/0.30.0", "CF-Connecting-IP": "192.0.2.50", ...headers } });
    assert.equal((await contributePost({ request, env, waitUntil: () => {} })).status, 200);
  };
  await send("Linked by Willo.", { Authorization: `Bearer ${token}` });
  await send("Not linked.", { Authorization: "Bearer " + "0".repeat(64) }, "89");   // a token that isn't one: anonymous
  const row = text => env.DB.sqlite.prepare("SELECT l.found_by_user, l.found_by_nick, u.user_id, u.uploader FROM contrib_lines l " +
    "JOIN contrib_uploads u ON u.line_id = l.id WHERE l.text = ?").get(text);
  assert.deepEqual({ ...row("Linked by Willo.") }, { found_by_user: null, found_by_nick: "Wisp", user_id: owner.id, uploader: "u:" + owner.id });
  assert.equal(row("Not linked.").user_id, null);
  const cookie = (await startSession(env, new Request(ORIGIN), owner.id)).split(";")[0];
  assert.deepEqual((await mine(cookie)).body.lines.items.map(l => l.text), ["Linked by Willo."]);
  env.DB.sqlite.exec("UPDATE contrib_lines SET first_seen = first_seen - 200000 WHERE ref_id IN ('88', '89')");
  const names = await (await contributeGet({ request: new Request(ORIGIN + "/api/contribute/contributors"), env,
    params: { action: "contributors" } })).json();
  assert.ok(names.some(p => p.name === "Wisp") && !names.some(p => p.name === "Shown Name"), "credited only by the typed name");
});

test("feedback, bad-translation reports and Willo's flags show what became of them; a skip's reason reaches the receipt (LOR-621)", async () => {
  const { onRequestPost: adminPost } = await import("../functions/api/admin.js");
  const { setupReports } = await import("../lib/reports.js");
  const { setup: setupContrib } = await import("../lib/contribute.js");
  await setup(env);
  env.ADMIN_KEY = "k";
  const me = await findOrCreateUser(env, { email: "rep@example.org", googleSub: "rp1", name: "Reporter" });
  env.DB.sqlite.exec(`CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL,
    kind TEXT NOT NULL, rating INTEGER, message TEXT NOT NULL, code TEXT, email TEXT, name TEXT, quote_ok INTEGER NOT NULL DEFAULT 0,
    country TEXT, sender TEXT NOT NULL, user_id TEXT, report TEXT)`);
  env.DB.sqlite.exec(`CREATE TABLE IF NOT EXISTS translation_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL,
    locale TEXT NOT NULL, code TEXT, place TEXT, wrong TEXT NOT NULL, better TEXT, email TEXT, name TEXT, country TEXT,
    sender TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new')`);
  await setupReports(env);
  const fb = env.DB.sqlite.prepare("INSERT INTO feedback (created, kind, message, sender, user_id) VALUES ('2026-10-15', ?, ?, 's', ?) RETURNING id");
  const kept = fb.get("idea", "Add a dark theme", me.id).id, fixed = fb.get("lore", "Thrall's age is wrong", me.id).id;
  const tr = env.DB.sqlite.prepare("INSERT INTO translation_reports (created, locale, wrong, sender, user_id) VALUES ('2026-10-15', 'deDE', ?, 's', ?) RETURNING id")
    .get("Falsches Wort", me.id).id;
  const admin = body => adminPost({ request: new Request(ORIGIN + "/api/admin", { method: "POST",
    headers: { Authorization: "Bearer k", "Content-Type": "application/json" }, body: JSON.stringify(body) }), env });
  await admin({ action: "status", id: kept, status: "done", resolution: "kept", reason: "it's on the list for later" });
  await admin({ action: "status", id: fixed, status: "done", resolution: "fixed" });
  await admin({ action: "status-translation-report", id: tr, status: "done", resolution: "fixed" });
  const shipped = await (await admin({ action: "reports-shipped", release: "0.21.0", before: new Date(Date.now() + 1000).toISOString() })).json();
  assert.equal(shipped.shipped, 2);
  const { logFeedback, setFeedbackStatus } = await import("../lib/answer-feedback.js");
  await logFeedback(env, me.id, { kind: "flag", said: "Thrall isn't from Durotar", question: "Where is Thrall from?" });
  const flag = env.DB.sqlite.prepare("SELECT id FROM answer_feedback ORDER BY id DESC LIMIT 1").get().id;
  await setFeedbackStatus(env, flag, "fact");
  const cookie = (await startSession(env, new Request(ORIGIN), me.id)).split(";")[0];
  const body = (await mine(cookie)).body;
  assert.deepEqual(body.feedback.map(f => f.state.label).sort(), ["Fixed in 0.21.0", "Kept as it is: it's on the list for later"]);
  assert.deepEqual(body.translation_reports.map(r => r.state.label), ["Fixed in 0.21.0"]);
  assert.deepEqual(body.willo.map(f => [f.question, f.state.label]), [["Where is Thrall from?", "Fixed: Willo knows it now"]]);

  // /admin skips a line with a reason: the sender reads it.
  await setupContrib(env);
  await upload(cookie, "192.0.2.120", "A lonely version nobody confirmed.");
  const id = env.DB.sqlite.prepare("SELECT id FROM contrib_lines WHERE text = ?").get("A lonely version nobody confirmed.").id;
  await admin({ action: "contrib-pick", id, pick: "skip", reason: "not confirmed by a second player." });
  const after = (await mine(cookie)).body.lines.items.find(l => l.text === "A lonely version nobody confirmed.");
  assert.equal(after.state.label, "Not used: not confirmed by a second player");
});
