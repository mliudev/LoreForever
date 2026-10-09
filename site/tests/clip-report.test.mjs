// Clip reports (LOR-232): the add-on's code (public/clip-report-code.js), POST /api/clip-report, the public counts and
// the admin export, resolve and reject. D1 is node:sqlite (helpers.mjs). Run: node --test site/tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestPost as post } from "../functions/api/clip-report.js";
import { onRequest as action } from "../functions/api/clip-report/[action].js";
import { setup, findOrCreateUser, startSession, deleteUser } from "../lib/accounts.js";
import { PER_DAY } from "../lib/clipreports.js";
import { decodeClipReport, encodeClipReport, findClipCode, checksum, normalizeVoice, REASONS } from "../public/clip-report-code.js";
import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const KEY = "admin-secret";
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/clip-report-codes.json", import.meta.url), "utf8"));
const env = { DB: d1(), ADMIN_KEY: KEY };
beforeEach(async () => {
  await setup(env);
  for (const table of ["clip_reports", "sessions", "users"]) env.DB.sqlite.exec(`DELETE FROM ${table}`);
});

const rows = () => env.DB.sqlite.prepare("SELECT * FROM clip_reports ORDER BY id").all();

async function send(body, { ip = "1.2.3.4", cookie, origin = ORIGIN } = {}) {
  const headers = new Headers({ "Content-Type": "application/json", "CF-Connecting-IP": ip });
  if (cookie) headers.set("Cookie", cookie);
  if (origin) headers.set("Origin", origin);
  const res = await post({ request: new Request(`${ORIGIN}/api/clip-report`, { method: "POST", headers, body: JSON.stringify(body) }), env });
  return { status: res.status, body: await res.json() };
}

async function call(name, { method = "GET", query = "", body, key = KEY } = {}) {
  const headers = new Headers();
  if (key) headers.set("Authorization", "Bearer " + key);
  if (body) headers.set("Content-Type", "application/json");
  const request = new Request(`${ORIGIN}/api/clip-report/${name}${query}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const res = await action({ request, env, params: { action: name } });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const code = (over = {}) => encodeClipReport({ version: "0.8.0", locale: "enUS", voice: "LoreForever_Voice_Default",
  clip: "zone:stormwind#faq3", hash: "1a2b3c", reason: "cut", ...over });

// ---- the code ----

test("the add-on's codes and links (fixture shared with wow_sim) decode to what was reported", () => {
  for (const { input, code: c, link } of FIXTURE.cases) {
    assert.equal(encodeClipReport(input), c, "encoder matches the add-on");
    for (const text of [c, link, `see ${link} thanks`, link.split("#c=")[1]]) {
      const r = decodeClipReport(text);
      assert.ok(r && r.ok, `${text}: ${JSON.stringify(r)}`);
      assert.equal(r.code, c);
      assert.deepEqual([r.version, r.locale, r.voice, r.clip, r.hash, r.reason],
        [input.version, input.locale, normalizeVoice(input.voice), input.clip, input.hash || null, input.reason]);
      assert.equal(r.name, input.reason === "name" ? input.name : null);
      assert.equal(r.say_as, input.reason === "name" ? input.say_as : null);
      assert.equal(r.note, input.note.replace(/\s+/g, " ") || null);
    }
  }
});

test("a code cut short or changed is caught; other text isn't a code", () => {
  const c = code({ note: "stops halfway" });
  assert.equal(decodeClipReport(c.slice(0, -3)).error, "cut");
  assert.equal(decodeClipReport(c.split("~").slice(0, 6).join("~")).error, "cut");
  assert.equal(decodeClipReport(c.replace("halfway", "halfwax")).error, "checksum");
  const bad = "LCR1~0.8.0.enUS~Default~zone:stormwind@1a2b3c~shout~~~~";
  assert.equal(decodeClipReport(bad + checksum(bad.slice(0, -1))).error, "fields");
  assert.equal(decodeClipReport("LF1~0.4.0~w~ta~topic:kobold~45~westfall~~65~why"), null);
  assert.equal(findClipCode("nothing here"), null);
  assert.equal(Object.keys(REASONS).length, 7);
});

test("voices fold into their narrator, so the add-on's packs and the site's voice ids group together", () => {
  for (const v of ["male-narrator", "Default", "Default_Horde", "LoreForever_Voice_Default_Alliance", "Default_Quests"]) {
    assert.equal(normalizeVoice(v), "LoreForever_Voice_Default", v);
  }
  assert.equal(normalizeVoice("female-narrator"), "LoreForever_Voice_Female");
  assert.equal(normalizeVoice("LoreForever_Voice_Female_Quests_deDE"), "LoreForever_Voice_Female_deDE");
  assert.equal(normalizeVoice("LoreForever_Voice_Female_Answers_Quests2_deDE"), "LoreForever_Voice_Female_deDE");
  assert.equal(normalizeVoice("LoreForever_Voice_Default_Answers_Places"), "LoreForever_Voice_Default");
  assert.equal(normalizeVoice("QuestGivers"), "LoreForever_Voice_QuestGivers");
  assert.equal(normalizeVoice("Ashen_Horde"), "LoreForever_Voice_Ashen_Horde", "a community voice keeps its name");
  assert.equal(normalizeVoice("../etc"), null);
});

// ---- POST /api/clip-report ----

test("bad reports are turned away; the honeypot pretends", async () => {
  for (const [body, word] of [
    [{ clip: "zone:../x", voice: "Default", reason: "cut" }, "narration"],
    [{ clip: "zone:stormwind", voice: "", reason: "cut" }, "voice"],
    [{ clip: "zone:stormwind", voice: "Default", reason: "loud" }, "wrong"],
    [{ code: code().slice(0, -2) }, "cut short"],
  ]) {
    const res = await send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error, new RegExp(word));
  }
  const res = await send({ code: code(), website: "http://spam" });
  assert.equal(res.status, 200);
  assert.equal(rows().length, 0, "the honeypot saves nothing");
});

test("one open report per person, clip and voice; two people make two", async () => {
  await send({ code: code({ reason: "cut" }) });
  const again = await send({ code: code({ reason: "quality", note: "hiss" }) });
  assert.equal(again.body.open, 1);
  assert.equal(rows().length, 1);
  assert.deepEqual([rows()[0].reason, rows()[0].note], ["quality", "hiss"]);
  const other = await send({ code: code() }, { ip: "9.9.9.9" });
  assert.equal(other.body.open, 2);
  const otherVoice = await send({ code: code({ voice: "LoreForever_Voice_Female" }) });
  assert.equal(otherVoice.body.open, 1, "counted per voice");
});

test("the narration browser's post and the add-on's link name the same recording the same way", async () => {
  // In game: the male narrator's Alliance lands pack played it. On the site: voices.json's male-narrator.
  await send({ code: code({ clip: "npc:marshal-dughan", hash: "a1b2c3", voice: "LoreForever_Voice_Default_Alliance" }) });
  const site = await send({ clip: "npc:marshal-dughan@a1b2c3", voice: "male-narrator", reason: "cut", source: "site" },
                          { ip: "4.4.4.4" });
  assert.equal(site.body.open, 2, "one clip, one voice: two reports");
  assert.deepEqual(rows().map(r => r.voice), ["LoreForever_Voice_Default", "LoreForever_Voice_Default"]);
  const counts = await call("counts", { key: null, query: "?clips=npc:marshal-dughan@a1b2c3,npc:nobody&by=voice" });
  assert.deepEqual(counts.body.counts, { "npc:marshal-dughan": { LoreForever_Voice_Default: 2 } });
});

test("a daily cap per sender", async () => {
  for (let i = 0; i < PER_DAY; i++) {
    const res = await send({ clip: `npc:n${i}`, voice: "Default", reason: "cut" });
    assert.equal(res.status, 200);
  }
  const res = await send({ clip: "npc:one-more", voice: "Default", reason: "cut" });
  assert.equal(res.status, 429);
  assert.equal((await send({ clip: "npc:one-more", voice: "Default", reason: "cut" }, { ip: "8.8.8.8" })).status, 200);
});

test("signed in on our own page: the report carries the account; from elsewhere it doesn't", async () => {
  const user = await findOrCreateUser(env, { email: "a@example.com", googleSub: "a", name: "A" });
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  const res = await send({ code: code() }, { cookie });
  assert.equal(res.body.signedIn, true);
  assert.deepEqual([rows()[0].user_id, rows()[0].uploader], [user.id, "u:" + user.id]);
  const away = await send({ code: code({ clip: "npc:cookie" }) }, { cookie, origin: "https://evil.example" });
  assert.equal(away.body.signedIn, false);
  assert.equal(rows()[1].user_id, null);
  const exp = await call("export");
  assert.deepEqual(exp.body.reports.map(r => r.signed_in), [false, true]);
  await deleteUser(env, user);
  assert.deepEqual(rows().map(r => r.clip), ["npc:cookie"], "Delete my account removes their reports");
});

// ---- counts, export, resolve, reject ----

test("public counts: open reports per clip, never the text", async () => {
  await send({ code: code({ note: "secret note" }) });
  await send({ code: code() }, { ip: "2.2.2.2" });
  await send({ code: code({ voice: "LoreForever_Voice_Female" }) }, { ip: "3.3.3.3" });
  await send({ code: code({ clip: "npc:cookie" }) });
  const all = await call("counts", { key: null });
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.counts, { "zone:stormwind#faq3": 3, "npc:cookie": 1 });
  assert.ok(!JSON.stringify(all.body).includes("secret"));
  assert.match(all.headers.get("Cache-Control"), /max-age=300/);
  const one = await call("counts", { key: null, query: "?clip=zone:stormwind%23faq3&voice=Female&by=voice" });
  assert.deepEqual(one.body.counts, { "zone:stormwind#faq3": { LoreForever_Voice_Female: 1 } });
});

test("export, resolve and reject need the admin key", async () => {
  for (const [name, method] of [["export", "GET"], ["resolve", "POST"], ["reject", "POST"]]) {
    const res = await call(name, { method, key: "wrong", body: method === "POST" ? {} : undefined });
    assert.equal(res.status, 401, name);
  }
  assert.equal((await call("nope")).status, 404);
});

test("the pipeline's loop: export open reports, resolve them, they leave the open count", async () => {
  await send({ code: code({ reason: "name", name: "Teldrassil", say_as: "tel-DRASS-il" }) });
  await send({ code: code() }, { ip: "2.2.2.2" });
  const exp = await call("export");
  assert.equal(exp.body.reports.length, 2);
  const r = exp.body.reports.find(x => x.reason === "name");
  for (const k of ["id", "created", "clip", "hash", "voice", "reason", "name", "say_as", "note", "uploader", "signed_in", "status"]) {
    assert.ok(k in r, k);
  }
  const res = await call("resolve", { method: "POST", body: { ids: exp.body.reports.map(x => x.id), status: "done" } });
  assert.equal(res.body.changed, 2);
  assert.deepEqual((await call("counts", { key: null })).body.counts, {});
  assert.equal((await call("export")).body.reports.length, 0);
  assert.equal((await call("export", { query: "?status=done" })).body.reports.length, 2);
  assert.equal((await call("resolve", { method: "POST", body: { ids: [1], status: "gone" } })).status, 400);
  // A new report after the re-recording is a new one.
  await send({ code: code() });
  assert.equal(rows().length, 3);
});

test("/admin rejects everything one uploader sent, and can restore it", async () => {
  await send({ code: code() }, { ip: "6.6.6.6" });
  await send({ code: code({ clip: "npc:cookie" }) }, { ip: "6.6.6.6" });
  await send({ code: code() }, { ip: "7.7.7.7" });
  const spammer = rows()[0].uploader;
  const res = await call("reject", { method: "POST", body: { uploader: spammer } });
  assert.equal(res.body.changed, 2);
  assert.deepEqual((await call("counts", { key: null })).body.counts, { "zone:stormwind#faq3": 1 });
  // Sending again doesn't bring a rejected report back.
  await send({ code: code({ reason: "quality" }) }, { ip: "6.6.6.6" });
  assert.equal(rows().filter(r => r.status === "rejected").length, 2);
  assert.equal((await call("resolve", { method: "POST", body: { ids: rows().map(r => r.id), status: "done" } })).body.changed, 1,
    "resolve leaves rejected reports alone");
  const back = await call("reject", { method: "POST", body: { uploader: spammer, restore: true } });
  assert.equal(back.body.changed, 2);
  assert.equal((await call("reject", { method: "POST", body: { uploader: "nobody; DROP" } })).body.changed, 0);
});
