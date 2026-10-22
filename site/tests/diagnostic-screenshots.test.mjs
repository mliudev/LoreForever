import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { d1, r2 } from "./helpers.mjs";
import { setup, findOrCreateUser, startSession, deleteUser } from "../lib/accounts.js";
import { setupKeeps, setKeepAnswers, keepsView } from "../lib/willo-keeps.js";
import { logAnswer, eraseAnswer, tagAnswer, setupAnswerLog, sweepAnswerLog } from "../lib/answer-log.js";
import { setupDiagnostics, diagnosticConsent, setDiagnosticConsent, registerScreenshot, retainScreenshot,
  readScreenshot, sweepDiagnostics, PREFIX, screenshotBytes } from "../lib/diagnostic-screenshots.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { onRequest as answerApi } from "../functions/api/companion/answer.js";
import { onRequestPost as feedbackApi } from "../functions/api/companion/feedback.js";
import { onRequestPost as uploadApi } from "../functions/api/companion/diagnostic.js";
import { onRequestGet as imageApi } from "../functions/api/keeps/screenshot.js";
import { onRequest as qaApi } from "../functions/api/admin/diagnostic-screenshots.js";
import { onRequest as keepsApi } from "../functions/api/keeps/[action].js";

// Existing real game capture, unmodified: no new capture, no live collection, no encoding stand-in.
const bytes = readFileSync(new URL("../public/screenshots/03-npc-tooltip.jpg", import.meta.url));
const image = bytes.toString("base64");
const origin = "https://example.test";
let env, user, token, cookie, n;
const fetchBefore = globalThis.fetch;
const randomBefore = Math.random;
beforeEach(async () => {
  env = { DB: d1(), STUDIO: r2(), GEMINI_API_KEY: "test-key",
    ADMIN_KEY: "owner-key", FEEDBACK_KEY: "qa-key", DASHBOARD_READ_KEY: "viewer-key" };
  await setup(env); await setupKeeps(env); await setupAnswerLog(env); await setupDiagnostics(env);
  user = await findOrCreateUser(env, { email: "player@example.test", googleSub: "player", name: "Player" });
  cookie = (await startSession(env, new Request(origin), user.id)).split(";")[0];
  const link = await startLink(env); await decideLink(env, link.user_code, user, true);
  token = (await claimToken(env, link.device_code)).token;
  n = 0;
});
afterEach(() => { globalThis.fetch = fetchBefore; Math.random = randomBefore; });
const headers = () => ({ "X-LF-Client": "companion/0.21.0", Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
async function optIn(id = user.id) { await setKeepAnswers(env, id, true); await setDiagnosticConsent(env, id, true); }
async function receipt({ id = user.id, sample = false, now = new Date(), ref = (++n).toString(16).padStart(16, "0") } = {}) {
  await logAnswer(env, id, { ref, question: `Where ${ref}?`, answer: `There ${ref}.`, model: "test-model",
    outcome: "answered", ctx: { zone: "Westfall", class: "Warrior" } }, { now });
  await registerScreenshot(env, id, ref, image, { now, random: () => sample ? 0 : 1 });
  return ref;
}
const rows = () => env.DB.sqlite.prepare("SELECT * FROM diagnostic_screenshots").all();
async function requestImage(ref, auth = { Cookie: cookie }, query = "") {
  return imageApi({ env, request: new Request(`${origin}/api/keeps/screenshot?ref=${ref}${query}`, { headers: auth }) });
}

test("consent is separately off for existing users, requires logging, and logging off erases what was kept", async () => {
  assert.equal(await diagnosticConsent(env, user.id), null);
  await assert.rejects(setDiagnosticConsent(env, user.id, true), /logging first/);
  await setKeepAnswers(env, user.id, true);
  await receipt({ sample: true });
  assert.equal(rows().length, 0);
  await optIn();
  await receipt({ sample: true });
  assert.equal(env.STUDIO.objects.size, 1);
  await setKeepAnswers(env, user.id, false);
  assert.equal(env.STUDIO.objects.size, 0); assert.equal(rows().length, 0);
  await setKeepAnswers(env, user.id, true);
  assert.equal(await diagnosticConsent(env, user.id), null, "logging back on must not restore image consent");
  await receipt({ sample: true });
  assert.equal(env.STUDIO.objects.size, 0);
});

test("turning the choice off erases every kept copy", async () => {
  await optIn(); await receipt({ sample: true }); await receipt({ sample: true });
  assert.equal(env.STUDIO.objects.size, 2);
  await setDiagnosticConsent(env, user.id, false);
  assert.equal(env.STUDIO.objects.size, 0); assert.equal(rows().length, 0);
});

test("without the private bucket nothing is kept and opt-in refuses", async () => {
  await optIn(); delete env.STUDIO;
  await receipt({ sample: true });
  assert.equal(rows().length, 0);
  await setDiagnosticConsent(env, user.id, false);
  await assert.rejects(setDiagnosticConsent(env, user.id, true), /not available/);
});

test("only the signed-in page can turn the choice on; the app's device token can only turn it off", async () => {
  await setKeepAnswers(env, user.id, true);
  const set = (on, auth) => keepsApi({ env, params: { action: "keep-screenshots" }, request: new Request(`${origin}/api/keeps/keep-screenshots`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json", ...(auth.Cookie ? { Origin: origin } : {}) },
    body: JSON.stringify({ on }) }) });
  assert.notEqual((await set(true, { Authorization: `Bearer ${token}`, "X-LF-Client": "companion/0.21.0" })).status, 200);
  assert.equal(await diagnosticConsent(env, user.id), null);
  assert.equal((await set(true, { Cookie: cookie })).status, 200);
  assert.ok(await diagnosticConsent(env, user.id));
  assert.equal((await set(false, { Authorization: `Bearer ${token}`, "X-LF-Client": "companion/0.21.0" })).status, 200);
  assert.equal(await diagnosticConsent(env, user.id), null);
});

test("private QA on a fresh database returns an empty list before any answer has been logged", async () => {
  const fresh = { ...env, DB: d1(), STUDIO: r2() };
  await setup(fresh);
  const response = await qaApi({ env: fresh, request: new Request(`${origin}/api/admin/diagnostic-screenshots`, {
    headers: { Authorization: "Bearer owner-key" } }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).rows, []);
});

test("sampling selects below 1%, not the boundary, and deletion does not refill the daily cap", async () => {
  await optIn();
  for (const [value, expected] of [[0.01, 0], [0.00999, 1]]) {
    const ref = (++n).toString(16).padStart(16, "0");
    await logAnswer(env, user.id, { ref, question: "What?", answer: "That.", outcome: "answered" });
    await registerScreenshot(env, user.id, ref, image, { random: () => value });
    assert.equal(env.STUDIO.objects.size, expected);
  }
  for (let i = 0; i < 5; i++) {
    const ref = await receipt({ sample: true });
    const row = rows().find(r => r.ref === ref);
    if (row) await eraseAnswer(env, user.id, row.answer_id);
  }
  assert.equal(env.DB.sqlite.prepare("SELECT n FROM rate_limits WHERE user_id=? AND bucket LIKE 'diagnostic-image:%'")
    .get(user.id).n, 6, "attempts kept counting after removal");
  assert.equal(env.STUDIO.objects.size, 1);
});

test("a stalled or failing storage write cannot hold the answer response", async () => {
  await optIn(); Math.random = () => 0;
  let release, started;
  const uploading = new Promise(resolve => { started = resolve; });
  env.STUDIO.put = async () => { started(); await new Promise(resolve => { release = resolve; }); throw new Error("R2 unavailable"); };
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: "A game scene." }] } }],
    usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 } });
  const pending = [];
  const response = await answerApi({ env, waitUntil: p => pending.push(p), request: new Request(`${origin}/api/companion/answer`, {
    method: "POST", headers: headers(), body: JSON.stringify({ keep: true, persona: "willo", style: "spoken",
      prompt: "QUESTION\nWhat do you see?", image }) }) });
  assert.equal(response.status, 200, "response completed before storage can finish");
  await uploading; release(); await Promise.all(pending);
  assert.equal(env.STUDIO.objects.size, 0);
});

test("text-only and failed answers do not create a screenshot receipt", async () => {
  await optIn(); Math.random = () => 0;
  for (const failure of [false, true]) {
    globalThis.fetch = async () => failure ? new Response("unavailable", { status: 503 })
      : Response.json({ candidates: [{ content: { parts: [{ text: "A game scene." }] } }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 } });
    const pending = [];
    await answerApi({ env, waitUntil: p => pending.push(p), request: new Request(`${origin}/api/companion/answer`, {
      method: "POST", headers: headers(), body: JSON.stringify({ keep: true, persona: "willo", style: "spoken",
        prompt: "QUESTION\nWhat do you see?", ...(failure ? { image } : {}) }) }) });
    await Promise.all(pending);
  }
  assert.equal(rows().length, 0);
});

test("real game JPEG travels through the actual answer route and private read byte-for-byte", async () => {
  await optIn(); Math.random = () => 0;
  let supplied;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    supplied = body.contents[0].parts.find(p => p.inlineData)?.inlineData.data;
    return Response.json({ candidates: [{ content: { parts: [{ text: "That is the NPC beside you." }] } }],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 20 } });
  };
  const pending = [];
  const answer = await answerApi({ env, waitUntil: p => pending.push(p), request: new Request(`${origin}/api/companion/answer`, {
    method: "POST", headers: headers(), body: JSON.stringify({ keep: true, persona: "willo", style: "spoken",
      prompt: "PLAYER CONTEXT\nzone: Westfall\n\nQUESTION\nWhat do you see?", image }) }) });
  assert.equal(answer.status, 200);
  const result = await answer.json(); await Promise.all(pending);
  assert.equal(supplied, image);
  assert.equal(rows()[0].ref, result.answer_id);
  const kept = await readScreenshot(env, result.answer_id, { userId: user.id });
  assert.equal(kept.row.answer, result.answer);
  assert.equal(kept.row.question, "What do you see?");
  assert.equal(kept.row.model, result.model);
  const response = await requestImage(result.answer_id);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /private, no-store/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal((await keepsView(env, user.id)).sections.find(s => s.id === "screenshots").items.length, 1);
});

test("report requests the exact previously supplied image; a different image/ref/account cannot attach", async () => {
  await optIn(); const ref = await receipt();
  assert.equal(env.STUDIO.objects.size, 0, "outside sample: receipt only");
  assert.equal(await retainScreenshot(env, user.id, ref, image), false, "unreported upload refused");
  const report = await feedbackApi({ env, waitUntil: () => {}, request: new Request(`${origin}/api/companion/feedback`, {
    method: "POST", headers: headers(), body: JSON.stringify({ answer_id: ref, question: "Where?", answer: "There." }) }) });
  assert.equal((await report.json()).diagnostic_upload, true);
  const wrongImage = Buffer.from(bytes); wrongImage[wrongImage.length - 3] ^= 1;
  assert.equal(await retainScreenshot(env, user.id, ref, wrongImage.toString("base64")), false);
  assert.equal(await retainScreenshot(env, "other-user", ref, image), false);
  assert.equal(await retainScreenshot(env, user.id, "f".repeat(16), image), false);
  const pending = [];
  const upload = await uploadApi({ env, waitUntil: p => pending.push(p), request: new Request(`${origin}/api/companion/diagnostic`, {
    method: "POST", headers: headers(), body: JSON.stringify({ answer_id: ref, image }) }) });
  assert.equal(upload.status, 202); await Promise.all(pending);
  assert.equal(env.STUDIO.objects.size, 1);
  assert.equal(await retainScreenshot(env, user.id, ref, image), true, "idempotent");
  assert.equal(await retainScreenshot(env, user.id, ref, wrongImage.toString("base64")), false);
});

test("reports never override consent and old consent receipts cannot revive after re-enabling", async () => {
  await optIn(); const ref = await receipt();
  await tagAnswer(env, user.id, { ref, tags: ["reported"] });
  await setDiagnosticConsent(env, user.id, false);
  assert.equal(await retainScreenshot(env, user.id, ref, image), false);
  await setDiagnosticConsent(env, user.id, true);
  assert.equal(await retainScreenshot(env, user.id, ref, image), false);
});

test("private owner and QA reads work; general dashboard viewers, strangers and signed-out reads do not", async () => {
  await optIn(); const ref = await receipt({ sample: true });
  for (const key of ["owner-key", "qa-key"]) {
    assert.equal((await requestImage(ref, { Authorization: `Bearer ${key}` })).status, 200);
    assert.equal((await qaApi({ env, request: new Request(`${origin}/api/admin/diagnostic-screenshots`, {
      headers: { Authorization: `Bearer ${key}` } }) })).status, 200);
  }
  for (const auth of [{}, { Authorization: "Bearer viewer-key" }]) {
    assert.equal((await requestImage(ref, auth)).status, 404);
    assert.equal((await qaApi({ env, request: new Request(`${origin}/api/admin/diagnostic-screenshots`, { headers: auth }) })).status, 401);
  }
  assert.equal(await readScreenshot(env, ref, { userId: "stranger" }), null);
});

test("3/day/player, 20 samples/day and 50/day overall; turned-away samples leave the reports their room", async () => {
  await optIn();
  const report = async id => { const ref = await receipt({ id }); await tagAnswer(env, id, { ref, tags: ["reported"] });
    return retainScreenshot(env, id, ref, image); };
  const ref = await receipt();
  await tagAnswer(env, user.id, { ref, tags: ["reported"] });
  await Promise.all(Array.from({ length: 8 }, () => retainScreenshot(env, user.id, ref, image)));
  assert.equal(env.STUDIO.objects.size, 1, "duplicate/concurrent upload claimed once");
  for (let i = 0; i < 5; i++) await receipt({ sample: true });
  assert.equal(env.STUDIO.objects.size, 3, "per player, reports and samples together");
  for (let i = 0; i < 9; i++) {
    const id = `sample-user-${i}`; await optIn(id);
    for (let j = 0; j < 3; j++) await receipt({ id, sample: true });
  }
  assert.equal(env.STUDIO.objects.size, 21, "the user's 2 samples and 18 more reach the 20 samples a day");
  for (let i = 0; i < 10; i++) {
    const id = `report-user-${i}`; await optIn(id);
    for (let j = 0; j < 3; j++) await report(id);
  }
  assert.equal(env.STUDIO.objects.size, 50);
});

test("a kept copy outlives the answer log with its own question; unclaimed receipts and orphans are swept", async () => {
  await optIn(); const now = new Date();
  const kept = await receipt({ sample: true, now }); await receipt({ now });
  await env.STUDIO.put(PREFIX + "orphan.jpg", bytes);
  assert.equal(await sweepAnswerLog(env, new Date(now.getTime() + 30 * 864e5)), true);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_log").get().n, 0);
  assert.deepEqual(rows().map(r => r.ref), [kept], "the unclaimed receipt went after a day");
  assert.equal(env.STUDIO.objects.size, 1, "the orphan went; the kept copy stayed");
  const copy = await readScreenshot(env, kept, { userId: user.id });
  assert.equal(copy.row.question, `Where ${kept}?`); assert.equal(copy.row.answer, `There ${kept}.`);
  assert.equal((await requestImage(kept, { Cookie: cookie }, "&context=1")).status, 200);
  assert.equal((await keepsView(env, user.id)).sections.find(s => s.id === "screenshots").items.length, 1);
});

test("cleanup runs at most hourly unless forced, and broken storage cannot block the answer log's sweep", async () => {
  await optIn(); const now = new Date();
  await sweepDiagnostics(env, now);
  await env.STUDIO.put(PREFIX + "orphan.jpg", bytes);
  await sweepDiagnostics(env, new Date(now.getTime() + 1800_000));
  assert.equal(env.STUDIO.objects.size, 1, "throttled within the hour");
  await sweepDiagnostics(env, new Date(now.getTime() + 1800_000), { force: true });
  assert.equal(env.STUDIO.objects.size, 0, "forced");
  await receipt({ now });
  env.STUDIO.delete = async () => { throw new Error("unavailable"); };
  env.STUDIO.list = async () => { throw new Error("unavailable"); };
  assert.equal(await sweepAnswerLog(env, new Date(now.getTime() + 15 * 864e5)), true);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_log").get().n, 0);
});

test("answer and account deletion remove images and metadata, without deleting another player's copy", async () => {
  await optIn(); await optIn("other-user");
  const ref = await receipt({ sample: true }); const other = await receipt({ id: "other-user", sample: true });
  await eraseAnswer(env, user.id, rows().find(r => r.ref === ref).answer_id);
  assert.equal(await readScreenshot(env, ref, { qa: true }), null);
  assert.ok(await readScreenshot(env, other, { qa: true }));
  await receipt({ sample: true }); await deleteUser(env, user);
  assert.deepEqual(rows().map(r => r.ref), [other]); assert.equal(env.STUDIO.objects.size, 1);
  assert.equal(await diagnosticConsent(env, user.id), null);
});

test("upload failures do not throw; cleanup recovers the orphan after a partial write", async () => {
  await optIn(); const put = env.STUDIO.put.bind(env.STUDIO);
  env.STUDIO.put = async (...args) => { await put(...args); throw new Error("connection lost"); };
  await receipt({ sample: true });
  assert.equal(rows()[0].state, "uploading");
  await sweepDiagnostics(env, new Date(Date.now() + 3600_001));
  assert.equal(rows().length, 0); assert.equal(env.STUDIO.objects.size, 0);
});

test("disabling consent or deleting an answer during a slow upload cannot resurrect its image", async () => {
  for (const mode of ["disable", "delete"]) {
    await optIn(); const ref = await receipt(); await tagAnswer(env, user.id, { ref, tags: ["reported"] });
    const original = env.STUDIO.put.bind(env.STUDIO);
    let go, started; const start = new Promise(resolve => { started = resolve; });
    env.STUDIO.put = async (...args) => { started(); await new Promise(resolve => { go = resolve; }); await original(...args); };
    const pending = retainScreenshot(env, user.id, ref, image); await start;
    if (mode === "disable") await setDiagnosticConsent(env, user.id, false);
    else await eraseAnswer(env, user.id, rows().find(r => r.ref === ref).answer_id);
    go(); assert.equal(await pending, false); assert.equal(env.STUDIO.objects.size, 0);
    env.STUDIO.put = original;
  }
});

test("invalid, oversized and truncated images fail byte validation", async () => {
  for (const bad of ["", "x".repeat(200004), "data:image/jpeg;base64," + image,
    bytes.subarray(0, bytes.length - 2).toString("base64"), Buffer.from("not an image").toString("base64")])
    assert.equal(await screenshotBytes(bad), null);
  assert.equal((await screenshotBytes(image)).bytes.length, bytes.length);
});
