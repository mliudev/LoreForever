// A profile's story read aloud (lib/storyvoice.js, LOR-316): parts and respellings, recording through fal's queue on
// a page view, the webhook that saves each take, the Listen box, /audio/story/ for public and private profiles, a new
// story replacing the old recordings, the budget, and removal with the profile. fal.ai is a stub on globalThis.fetch;
// D1 is node:sqlite and R2 a Map (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet as profileGet } from "../functions/u/[handle].js";
import { onRequest as voiceApi } from "../functions/api/profile/voice/index.js";
import { onRequestPost as hookPost } from "../functions/api/profile/voice/hook.js";
import { onRequest as takeGet } from "../functions/audio/story/[file].js";
import { onRequest as profileApi } from "../functions/api/profile/[action].js";
import { findOrCreateUser, startSession, setup, deleteUser, sha256 } from "../lib/accounts.js";
import { parseRecord } from "../lib/journey.js";
import { storyParts, storyKey, hookToken, embeddingKey, referenceKey, transcriptKey, takeKey, NARRATORS, DEFAULT_NARRATOR, setupStoryVoice, CHUNK, MAX_TRIES, MICRO_USD_PER_CHAR, MICRO_USD_PER_BYTE, FISH_MODEL, mp3Seconds } from "../lib/storyvoice.js";
import { d1, r2, assets } from "./helpers.mjs";
import { RECORD } from "./fixtures/journey/record.mjs";

const ORIGIN = "https://preview.example";
const VOICES = [DEFAULT_NARRATOR];
const RESPELL = { Teldrassil: "Tel-drassil", Deadmines: "Dead-mines", Astranaar: "Astranar" };
const env = { DB: d1(), STUDIO: r2(), ASSETS: assets({ "/lore/data/respell.json": RESPELL }) };
const STORY = "Aelric stepped out of the moonlit glades of Teldrassil with nothing but a staff and a stubborn streak. " +
  "The road ran north to Darkshore and on through Ashenvale to Astranaar.\n\n" +
  "In the dark of the Deadmines, Aelric stood against the Brotherhood and walked out into the daylight again, " +
  "a little bruised and a great deal wiser.";
const EMBEDDING = (() => {   // a tiny safetensors file: header length, JSON header, data
  const head = new TextEncoder().encode('{"x":{"dtype":"F32","shape":[1],"data_offsets":[0,4]}}');
  const out = new Uint8Array(8 + head.length + 4);
  new DataView(out.buffer).setBigUint64(0, BigInt(head.length), true);
  out.set(head, 8);
  return out;
})();
const MP3 = n => new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, ...Array.from({ length: 40 }, (_, i) => (i * 13 + n) % 251)]);

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

// fal: the queue takes each request (kept in `sent`), and fal.media serves the takes. `queueStatus` makes it refuse.
let sent = [], queueStatus = 200;
function fal() {
  sent = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === "queue.fal.run") {
      sent.push({ url: u, hook: new URL(u.searchParams.get("fal_webhook")), body: JSON.parse(init.body), auth: init.headers.Authorization });
      if (queueStatus !== 200) return new Response("nope", { status: queueStatus });
      return Response.json({ request_id: `req-${sent.length}` });
    }
    if (u.hostname.endsWith("fal.media")) return new Response(MP3(Number(u.pathname.match(/\d+/)?.[0] || 0)));
    throw new Error(`unexpected fetch ${url}`);
  };
}

beforeEach(async () => {
  await setup(env);
  for (const t of ["profiles", "sessions", "users", "rate_limits", "story_spend"]) env.DB.sqlite.exec(`DELETE FROM ${t}`);
  try { env.DB.sqlite.exec("DELETE FROM story_audio"); } catch (e) { /* made on first use */ }
  env.STUDIO.objects.clear();
  // Both embeddings exist: their presence must not cause the second voice to be recorded.
  for (const v of Object.keys(NARRATORS)) await env.STUDIO.put(embeddingKey(v), EMBEDDING);
  env.SITE_FEATURES = "storyvoice";
  env.FAL_KEY = "fal-test-key";
  queueStatus = 200;
  fal();
});

async function makeProfile(sub, { story = STORY, isPublic = 1, source = "written" } = {}) {
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: `Real ${sub}` });
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO profiles (user_id, handle, public, data, story, story_source, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(user.id, sub, isPublic, JSON.stringify(parseRecord(RECORD)), story, source, now, now).run();
  return { user, cookie, handle: sub };
}

async function view(handle, cookie = "") {
  const jobs = [];
  const headers = new Headers(cookie ? { Cookie: cookie } : {});
  const res = await profileGet({ request: new Request(`${ORIGIN}/u/${handle}`, { headers }), env, params: { handle },
    waitUntil: p => jobs.push(p) });
  await Promise.all(jobs);
  return { status: res.status, html: await res.text() };
}

// What fal's webhook posts for request `i` of `sent` (OK, or an error).
async function hook(i, { ok = true, token } = {}) {
  const u = new URL(sent[i].hook);
  if (token !== undefined) u.searchParams.set("t", token);
  const body = ok ? { request_id: `req-${i + 1}`, status: "OK", payload: { audio: { url: `https://v3b.fal.media/files/${i}.mp3`, duration: 12.5 } } }
    : { request_id: `req-${i + 1}`, status: "ERROR", error: "Invalid status code: 500", payload: null };
  const res = await hookPost({ request: new Request(u, { method: "POST", body: JSON.stringify(body) }), env });
  return res.status;
}

const rows = () => env.DB.prepare("SELECT * FROM story_audio ORDER BY voice, part").all().then(r => r.results);
const listenData = html => {
  const m = /data-story-voice="([^"]*)"/.exec(html);
  return m && JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
};

test("a story's parts: its paragraphs, split between sentences at CHUNK characters, numbered like the page's", () => {
  const long = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} is here, and it goes on for a little while longer.`).join(" ");
  const parts = storyParts(`${STORY}\n\n${long}`);
  assert.deepEqual([...new Set(parts.map(p => p.para))], [0, 1, 2]);
  assert.ok(parts.every(p => p.text.length <= CHUNK));
  assert.ok(parts.filter(p => p.para === 2).length >= 2);
  assert.equal(parts.filter(p => p.para === 2).map(p => p.text).join(" "), long);
  assert.deepEqual(storyParts(" \n\n "), []);
});

test("opening the page records the story once in the male narrator; the owner sees it's on the way, visitors see nothing yet", async () => {
  const me = await makeProfile("aelric");
  const visitor = await view("aelric");
  assert.equal(visitor.status, 200);
  assert.equal(listenData(visitor.html), null, "no Listen box until it's recorded");
  const parts = storyParts(STORY);
  assert.equal(sent.length, parts.length, "one recording per part even with both embeddings installed");
  assert.ok(sent.every(s => s.hook.searchParams.get("v") === "male-narrator"));
  assert.equal(sent[0].auth, "Key fal-test-key");
  assert.match(sent[0].body.text, /Tel-drassil/, "English stories are respelled for the voice");
  assert.equal(sent[0].body.language, "English");
  assert.match(sent[0].body.speaker_voice_embedding_file_url, /^data:application\/octet-stream;base64,/);
  assert.equal(sent[0].hook.pathname, "/api/profile/voice/hook");
  assert.equal((await rows()).length, sent.length);
  const chars = sent.reduce((a, s) => a + s.body.text.length, 0);
  assert.equal((await env.DB.prepare("SELECT voice_micro_usd FROM story_spend").first()).voice_micro_usd, chars * MICRO_USD_PER_CHAR);

  const owner = await view("aelric", me.cookie);
  assert.equal(sent.length, parts.length * VOICES.length, "a second view sends nothing");
  assert.match(owner.html, /data-story-voice="[^"]*" data-wait hidden/);
  assert.match(owner.html, /<script src="\/js\/storyvoice\.js" defer><\/script>/);
  assert.match(owner.html, /<p data-para="1">/);
});

test("the webhook saves each take; once a voice has every part, the page offers it and /audio/story/ serves it", async () => {
  await makeProfile("aelric");
  await view("aelric");
  assert.equal(await hook(0, { token: "0".repeat(32) }), 401, "a forged webhook");
  const male = sent.map((s, i) => [s, i]).filter(([s]) => s.hook.searchParams.get("v") === "male-narrator").map(([, i]) => i);
  for (const i of male) assert.equal(await hook(i), 200);
  assert.equal(await hook(male[0]), 200, "the same webhook twice is fine");
  const data = listenData((await view("aelric")).html);
  assert.deepEqual(Object.keys(data.voices), ["male-narrator"], "only voices with every part");
  assert.equal(data.narrator, "male-narrator");
  assert.equal(data.labels, undefined, "the page has no narrator picker");
  assert.equal(data.name, "Aelric");
  const takes = data.voices["male-narrator"];
  assert.deepEqual(takes.map(t => t.para), storyParts(STORY).map(p => p.para));
  assert.equal(takes[0].sec, 12.5);

  const file = takes[0].url.split("/").pop();
  const res = await takeGet({ request: new Request(ORIGIN + takes[0].url), env, params: { file } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "audio/mpeg");
  assert.match(res.headers.get("Cache-Control"), /^public/);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()).slice(0, 3), new Uint8Array([0x49, 0x44, 0x33]));
  const part = await takeGet({ request: new Request(ORIGIN + takes[0].url, { headers: { Range: "bytes=0-9" } }), env, params: { file } });
  assert.equal(part.status, 206);
  assert.equal((await part.arrayBuffer()).byteLength, 10);
  const wrong = file.replace(/-[0-9a-f]{10}\.mp3$/, "-0000000000.mp3");
  assert.equal((await takeGet({ request: new Request(`${ORIGIN}/audio/story/${wrong}`), env, params: { file: wrong } })).status, 404);
});

test("a private profile's recordings are its owner's alone", async () => {
  const me = await makeProfile("hidden", { isPublic: 0 });
  await view("hidden", me.cookie);
  for (let i = 0; i < sent.length; i++) await hook(i);
  const data = listenData((await view("hidden", me.cookie)).html);
  assert.deepEqual(Object.keys(data.voices), VOICES);
  const url = data.voices["male-narrator"][0].url, file = url.split("/").pop();
  assert.equal((await takeGet({ request: new Request(ORIGIN + url), env, params: { file } })).status, 404);
  const mine = await takeGet({ request: new Request(ORIGIN + url, { headers: { Cookie: me.cookie } }), env, params: { file } });
  assert.equal(mine.status, 200);
  assert.match(mine.headers.get("Cache-Control"), /^private/);
  const api = q => voiceApi({ request: new Request(`${ORIGIN}/api/profile/voice?handle=hidden`, { headers: q }), env });
  assert.equal((await api({})).status, 404);
  const status = await (await api({ Cookie: me.cookie })).json();
  assert.equal(status.voice.narrator, "male-narrator");
  assert.deepEqual(Object.keys(status.voice.voices), VOICES);
  assert.equal(status.voice.pending, false);
});

test("older female recordings do not block the male narrator, appear in Listen, or get retried", async () => {
  const me = await makeProfile("aelric");
  await setupStoryVoice(env);
  const story = await storyKey(me.user.id, STORY), now = new Date().toISOString();
  const parts = storyParts(STORY);
  for (const [part, { para, text }] of parts.entries()) {
    await env.DB.prepare("INSERT INTO story_audio (user_id, story, voice, part, para, chars, status, sha, created, updated) " +
      "VALUES (?, ?, 'female-narrator', ?, ?, ?, 'done', '0123456789', ?, ?)")
      .bind(me.user.id, story, part, para, text.length, now, now).run();
  }
  await view("aelric", me.cookie);
  assert.equal(sent.length, parts.length, "the missing male recording is generated despite existing female rows");
  for (let i = 0; i < sent.length; i++) await hook(i);
  const data = listenData((await view("aelric", me.cookie)).html);
  assert.deepEqual(Object.keys(data.voices), ["male-narrator"], "the completed female recording is not offered");

  await env.DB.prepare("UPDATE story_audio SET status = 'failed' WHERE user_id = ? AND voice = 'female-narrator'")
    .bind(me.user.id).run();
  await view("aelric", me.cookie);
  assert.equal(sent.length, parts.length, "a page visit does not retry the unused voice");
  const status = await (await voiceApi({ request: new Request(`${ORIGIN}/api/profile/voice?handle=aelric`), env })).json();
  assert.equal(status.voice.pending, false, "unused failed clips do not keep polling alive");
  const q = new URLSearchParams({ s: story, v: "female-narrator", i: "0",
    t: await hookToken(env, story, "female-narrator", 0) });
  const late = await hookPost({ request: new Request(`${ORIGIN}/api/profile/voice/hook?${q}`, {
    method: "POST", body: JSON.stringify({ status: "ERROR", error: "old request failed" }),
  }), env });
  assert.equal(late.status, 200);
  assert.equal(sent.length, parts.length, "a late webhook does not retry the unused voice");
});

test("without the male embedding the written story stays readable and the female voice is not rendered", async () => {
  const me = await makeProfile("aelric");
  await env.STUDIO.delete(embeddingKey("male-narrator"));
  const page = await view("aelric");
  assert.equal(page.status, 200);
  assert.match(page.html, /Aelric stepped out/);
  assert.equal(sent.length, 0);
  assert.equal((await rows()).length, 0);
  assert.equal(listenData(page.html), null);
  const owner = await view("aelric", me.cookie);
  assert.equal(listenData(owner.html), null, "no waiting message when nothing can be recorded");
  const status = await (await voiceApi({ request: new Request(`${ORIGIN}/api/profile/voice?handle=aelric`, {
    headers: { Cookie: me.cookie },
  }), env })).json();
  assert.equal(status.voice.pending, false, "polling stops when the narrator is not available");
  assert.equal(sent.length, 0);
});

test("a part fal fails is sent again, MAX_TRIES times in all", async () => {
  await makeProfile("aelric");
  await view("aelric");
  const first = sent.length;
  assert.equal(await hook(0, { ok: false }), 200);
  assert.equal(sent.length, first + 1, "sent again");
  assert.equal(sent.at(-1).hook.searchParams.get("i"), sent[0].hook.searchParams.get("i"));
  assert.equal(await hook(sent.length - 1, { ok: false }), 200);
  assert.equal(sent.length, first + 1, "no third try");
  const r = (await rows()).find(x => x.voice === sent[0].hook.searchParams.get("v") && x.part === 0);
  assert.deepEqual([r.status, r.tries], ["failed", MAX_TRIES]);
});

test("a new story replaces the old one's recordings", async () => {
  const me = await makeProfile("aelric");
  await view("aelric");
  for (let i = 0; i < sent.length; i++) await hook(i);
  const old = await storyKey(me.user.id, STORY);
  assert.ok([...env.STUDIO.objects.keys()].some(k => k.includes(`/${old}/`)));
  const next = STORY.replace("a great deal wiser", "rather pleased with it all");
  await env.DB.prepare("UPDATE profiles SET story = ? WHERE user_id = ?").bind(next, me.user.id).run();
  await view("aelric");
  const fresh = await storyKey(me.user.id, next);
  assert.ok(![...env.STUDIO.objects.keys()].some(k => k.includes(`/${old}/`)), "old files gone");
  assert.ok((await rows()).every(r => r.story === fresh));
  // A late webhook for the old story stores nothing.
  const late = new URL(`${ORIGIN}/api/profile/voice/hook`);
  for (const [k, v] of Object.entries({ s: old, v: "male-narrator", i: "0", t: await hookToken(env, old, "male-narrator", 0) })) late.searchParams.set(k, v);
  const res = await hookPost({ request: new Request(late, { method: "POST", body: JSON.stringify({ status: "OK", payload: { audio: { url: "https://v3b.fal.media/files/9.mp3" } } }) }), env });
  assert.equal(res.status, 200);
  assert.ok(![...env.STUDIO.objects.keys()].some(k => k.includes(`/${old}/`)));
});

test("nothing is recorded with the feature off, without the key, for a template story, or past the budget", async () => {
  await makeProfile("aelric");
  env.SITE_FEATURES = "-storyvoice";
  let page = await view("aelric");
  assert.equal(sent.length, 0);
  assert.equal(listenData(page.html), null);
  assert.doesNotMatch(page.html, /storyvoice\.js/);
  assert.match(page.html, /<div class="pf-story-text" lang="en">/);

  env.SITE_FEATURES = "storyvoice";
  delete env.FAL_KEY;
  await view("aelric");
  assert.equal(sent.length, 0);

  env.FAL_KEY = "fal-test-key";
  await makeProfile("plain", { source: "template" });
  await view("plain");
  assert.equal(sent.length, 0);

  const month = new Date().toISOString().slice(0, 7);
  await env.DB.prepare("INSERT INTO story_spend (month, micro_usd) VALUES (?, ?)").bind(month, 100e6).run();
  await view("aelric");
  assert.equal(sent.length, 0, "the monthly budget is spent");
});

test("fal refusing a part marks it failed; a later view sends it again", async () => {
  await makeProfile("aelric");
  queueStatus = 503;
  await view("aelric");
  assert.ok((await rows()).every(r => r.status === "failed" && r.tries === 1));
  assert.equal((await env.DB.prepare("SELECT voice_micro_usd FROM story_spend").first())?.voice_micro_usd || 0, 0,
    "requests rejected by the queue do not spend the narration budget");
  queueStatus = 200;
  const before = sent.length;
  await view("aelric");
  assert.equal(sent.length, before * 2);
  assert.ok((await rows()).every(r => r.status === "queued" && r.tries === 2));
  const chars = sent.slice(before).reduce((n, s) => n + s.body.text.length, 0);
  assert.equal((await env.DB.prepare("SELECT voice_micro_usd FROM story_spend").first()).voice_micro_usd,
    chars * MICRO_USD_PER_CHAR, "only the accepted retry counts as spend");
});

test("the narrators' embeddings go in with the admin key only", async () => {
  env.ADMIN_KEY = "admin";
  const put = (auth, body = EMBEDDING, narrator = "male-narrator") => voiceApi({ request: new Request(
    `${ORIGIN}/api/profile/voice?narrator=${narrator}`, { method: "PUT", body, headers: auth ? { Authorization: `Bearer ${auth}` } : {} }), env });
  assert.equal((await put(null)).status, 401);
  assert.equal((await put("admin", EMBEDDING, "someone")).status, 400);
  assert.equal((await put("admin", new Uint8Array([1, 2, 3, 4]))).status, 415);
  env.STUDIO.objects.clear();
  const res = await put("admin");
  assert.equal(res.status, 200);
  assert.ok(env.STUDIO.objects.has(embeddingKey("male-narrator")));
  delete env.ADMIN_KEY;
});

test("deleting the profile or the account removes its recordings", async () => {
  const me = await makeProfile("aelric");
  await view("aelric");
  for (let i = 0; i < sent.length; i++) await hook(i);
  const key = takeKey(me.user.id, await storyKey(me.user.id, STORY), "male-narrator", 0);
  assert.ok(env.STUDIO.objects.has(key));
  const res = await profileApi({ request: new Request(`${ORIGIN}/api/profile/delete`, { method: "POST", body: "{}",
    headers: { Cookie: me.cookie, Origin: ORIGIN, "Content-Type": "application/json" } }), env, params: { action: "delete" } });
  assert.equal(res.status, 200);
  assert.ok(![...env.STUDIO.objects.keys()].some(k => k.startsWith(`story-voice/${me.user.id}/`)));
  assert.equal((await rows()).length, 0);

  const two = await makeProfile("bryn");
  await view("bryn");
  for (let i = 0; i < sent.length; i++) await hook(i);
  await deleteUser(env, two.user);
  assert.ok(![...env.STUDIO.objects.keys()].some(k => k.startsWith(`story-voice/${two.user.id}/`)));
  assert.equal((await rows()).length, 0);
  assert.ok(env.STUDIO.objects.has(embeddingKey("male-narrator")), "the narrators' voices stay");
});

test("an explicit profile sync selects only the new story's pending, failed and ready narration", async () => {
  const me = await makeProfile("aelric");
  await view("aelric");
  for (let i = 0; i < sent.length; i++) await hook(i);
  const old = await storyKey(me.user.id, STORY);
  const next = STORY.replace("a great deal wiser", "now level 25 and ready for another adventure");
  const falFetch = globalThis.fetch;
  env.GEMINI_API_KEY = "mock-profile-key";
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://generativelanguage.googleapis.com/")) {
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ story: next }) }] } }],
        usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 300 } });
    }
    return falFetch(url, init);
  };
  try {
    const token = "b".repeat(64), now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO devices (id, token_hash, user_id, created, last_used) VALUES (?, ?, ?, ?, ?)")
      .bind("story-sync-device", await sha256(token), me.user.id, now, now).run();
    const request = new Request(ORIGIN + "/api/profile/sync", { method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "X-LF-Client": "companion/test" },
      body: JSON.stringify({ record: RECORD.replace("Level 24", "Level 25"), refreshStory: true }) });
    const refreshed = await (await profileApi({ request, env, params: { action: "sync" } })).json();
    assert.equal(refreshed.story.why, "written");
    const fresh = await storyKey(me.user.id, next);
    const beforeNew = sent.length;
    const pending = await view("aelric", me.cookie);
    assert.ok(pending.html.includes("now level 25"));
    assert.ok(!pending.html.includes("/" + old + "/"), "pending story never selects old clips");
    assert.ok((await rows()).every(r => r.story === fresh));
    assert.ok(sent.slice(beforeNew).every(s => s.hook.searchParams.get("s") === fresh));
    await hook(beforeNew, { ok: false });
    const failed = await view("aelric", me.cookie);
    assert.ok(!failed.html.includes("/" + old + "/"), "failed narration keeps new text without old audio");
    for (let i = beforeNew; i < sent.length; i++) await hook(i);
    const ready = await view("aelric", me.cookie);
    assert.ok(!ready.html.includes("/" + old + "/"));
    assert.ok((await rows()).every(r => r.story === fresh));
  } finally { delete env.GEMINI_API_KEY; globalThis.fetch = falFetch; }
});


// ---- Fish Audio through OpenRouter ----

const WAV = tag => new Uint8Array([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WAVE"), tag]);
// A constant-bitrate MP3 that lasts one second: an empty ID3 tag, then a 128 kbps MPEG-1 Layer III frame header.
const FISH_MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x00, ...new Uint8Array(15996)]);
let speech = [];
function openrouter({ status = 200 } = {}) {
  speech = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname !== "openrouter.ai" || u.pathname !== "/api/v1/audio/speech") throw new Error(`unexpected fetch ${url}`);
    speech.push({ body: JSON.parse(init.body), auth: init.headers.Authorization });
    return status === 200 ? new Response(FISH_MP3) : new Response("busy", { status });
  };
}
async function putRef(lang, text) {
  await env.STUDIO.put(referenceKey(DEFAULT_NARRATOR, lang), WAV(lang.charCodeAt(0)));
  await env.STUDIO.put(transcriptKey(DEFAULT_NARRATOR, lang), text);
}
async function setLocale(handle, locale) {
  const row = await env.DB.prepare("SELECT data FROM profiles WHERE handle = ?").bind(handle).first();
  await env.DB.prepare("UPDATE profiles SET data = ? WHERE handle = ?").bind(JSON.stringify({ ...JSON.parse(row.data), locale }), handle).run();
}
// One page view, its background work finished: the page's HTML.
async function viewOnce(handle, cookie = "") {
  const jobs = [];
  const headers = new Headers(cookie ? { Cookie: cookie } : {});
  const res = await profileGet({ request: new Request(`${ORIGIN}/u/${handle}`, { headers }), env, params: { handle }, waitUntil: j => jobs.push(j) });
  await Promise.all(jobs);
  return res.text();
}
// A view that records, then the page as the next visitor sees it.
async function viewAndWait(handle, cookie = "") {
  await viewOnce(handle, cookie);
  return viewOnce(handle, cookie);
}

test("with the OpenRouter key, Fish records every part from the narrator's reference and the page offers it", async () => {
  env.OPENROUTER_API_KEY = "or-test-key";
  openrouter();
  await putRef("en", "Gather round the fire.");
  await makeProfile("fishy");
  const html = await viewAndWait("fishy");
  const parts = storyParts(STORY);
  assert.equal(speech.length, parts.length);
  assert.equal(speech[0].auth, "Bearer or-test-key");
  assert.equal(speech[0].body.model, FISH_MODEL);
  assert.deepEqual(speech[0].body.provider, { data_collection: "deny" });
  assert.match(speech[0].body.input_references[0].input_audio.data, /^data:audio\/wav;base64,/);
  assert.equal(speech[0].body.input_references[1].text, "Gather round the fire.");
  assert.match(speech[0].body.input, /Tel-drassil/, "English stories are still respelled");
  assert.ok((await rows()).every(r => r.status === "done" && r.sec === 1));
  const data = listenData(html);
  assert.equal(data.voices["male-narrator"].length, parts.length);
  const bytes = speech.reduce((a, x) => a + new TextEncoder().encode(x.body.input).length, 0);
  assert.equal((await env.DB.prepare("SELECT voice_micro_usd, reserved_micro FROM story_spend").first()).voice_micro_usd, bytes * MICRO_USD_PER_BYTE);
  assert.equal(mp3Seconds(FISH_MP3), 1);
  delete env.OPENROUTER_API_KEY;
});

test("another language is read from a native speaker's reference, never the English narrator's", async () => {
  env.OPENROUTER_API_KEY = "or-test-key";
  openrouter();
  await putRef("en", "Gather round the fire.");
  await makeProfile("shoc");
  await setLocale("shoc", "es");
  await viewAndWait("shoc");
  assert.equal(speech.length, 0, "no Spanish reference: the story stays text");
  assert.equal((await rows()).length, 0);
  await putRef("es", "Hace mucho tiempo, junto al río.");
  await viewAndWait("shoc");
  assert.ok(speech.length > 0);
  assert.ok(speech.every(x => x.body.input_references[1].text === "Hace mucho tiempo, junto al río."));
  assert.ok(!/Tel-drassil/.test(speech[0].body.input), "respellings are English only");
  delete env.OPENROUTER_API_KEY;
});

test("fal reads English stories only", async () => {
  await makeProfile("sombra");
  await setLocale("sombra", "es");
  await viewAndWait("sombra");
  assert.equal(sent.length, 0);
});

test("a part Fish fails is marked failed, its reservation released, and recorded again on a later view", async () => {
  env.OPENROUTER_API_KEY = "or-test-key";
  openrouter({ status: 503 });
  await putRef("en", "Gather round the fire.");
  await makeProfile("flaky");
  await viewOnce("flaky");
  assert.ok((await rows()).every(r => r.status === "failed" && /openrouter 503/.test(r.error)));
  assert.equal((await env.DB.prepare("SELECT reserved_micro FROM story_spend").first()).reserved_micro, 0);
  openrouter();
  await viewOnce("flaky");
  assert.ok((await rows()).every(r => r.status === "done"));
  delete env.OPENROUTER_API_KEY;
});

test("narrator references go in with the admin key, as a WAV with its transcript", async () => {
  env.ADMIN_KEY = "admin";
  const put = (auth, { lang = "es", body = WAV(1), transcript = "Hola." } = {}) => voiceApi({ request: new Request(
    `${ORIGIN}/api/profile/voice?narrator=male-narrator&lang=${lang}`, { method: "PUT", body,
      headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(transcript ? { "X-Transcript": encodeURIComponent(transcript) } : {}) } }), env });
  assert.equal((await put(null)).status, 401);
  assert.equal((await put("admin", { lang: "xx" })).status, 400);
  assert.equal((await put("admin", { transcript: "" })).status, 400);
  assert.equal((await put("admin", { body: new Uint8Array([1, 2, 3, 4]) })).status, 415);
  assert.equal((await put("admin", { transcript: "¿Dónde está el río?" })).status, 200);
  assert.equal(await new Response((await env.STUDIO.get(transcriptKey("male-narrator", "es"))).body).text(), "¿Dónde está el río?");
  assert.ok(await env.STUDIO.head(referenceKey("male-narrator", "es")));
  delete env.ADMIN_KEY;
});
