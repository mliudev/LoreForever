// Player feedback forwarded to Slack #player-feedback (LOR-641, lib/slack-feedback.js): off until the webhook is set,
// never holds up or breaks a save, keeps private details out, and turns a flood into one digest.
// D1 is node:sqlite (helpers.mjs); Slack is a stubbed fetch. Run: node --test site/tests/
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as postFeedback } from "../functions/api/feedback.js";
import { setup, findOrCreateUser, startSession } from "../lib/accounts.js";
import { logFeedback } from "../lib/answer-feedback.js";
import { forwardFeedback, BURST, slackState } from "../lib/slack-feedback.js";
import { d1 } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const HOOK = "https://hooks.slack.com/services/T000/B000/XXXX";
let posts, realFetch, slackDown;
beforeEach(() => {
  posts = [];
  slackDown = false;
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (slackDown) throw new Error("connection refused");
    const body = JSON.parse(init.body);
    posts.push({ url: String(url), text: body.text, channel: body.channel, auth: new Headers(init.headers).get("Authorization") });
    return String(url).startsWith("https://slack.com/api/") ? Response.json({ ok: true }) : new Response("ok");
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

// A Pages context whose waitUntil work can be awaited.
function context(env, path = "/api/feedback") {
  const pending = [];
  return { env, request: new Request(ORIGIN + path), waitUntil: p => pending.push(p), done: () => Promise.all(pending) };
}

test("nothing is posted or stored until SLACK_FEEDBACK_WEBHOOK is a Slack webhook", async () => {
  for (const hook of [undefined, "", "https://discord.com/api/webhooks/1/abc"]) {
    const env = { DB: d1(), SLACK_FEEDBACK_WEBHOOK: hook };
    const ctx = context(env);
    forwardFeedback(ctx, "feedback", { id: 1, kind: "bug", label: "Bug", message: "Broken" });
    await ctx.done();
    assert.equal(posts.length, 0);
    assert.equal(env.DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'slack_forwards'").get(), undefined);
  }
  // What /api/admin reports for a pasted value, never the value itself.
  assert.deepEqual(slackState({ SLACK_FEEDBACK_WEBHOOK: ` "${HOOK}"\n` }), { state: "webhook", via: "webhook", hook: HOOK });
  assert.equal(slackState({ SLACK_FEEDBACK_WEBHOOK: "abc123" }).state, "not a URL or a bot token");
  assert.equal(slackState({ SLACK_FEEDBACK_WEBHOOK: "xoxp-1-2" }).state, "a Slack token that isn't a bot token (xoxb-)");
  assert.equal(slackState({}).state, "off");
});

test("a /feedback report is posted once, without the player's email, account or unchosen name; Slack down never fails the save", async () => {
  const env = { DB: d1(), SLACK_FEEDBACK_WEBHOOK: HOOK };
  await setup(env);
  const user = await findOrCreateUser(env, { email: "player@example.com", googleSub: "g1", name: "Real Name" });
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  const send = async body => {
    const ctx = context(env);
    const headers = { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie, "CF-Connecting-IP": "203.0.113.9" };
    ctx.request = new Request(ORIGIN + "/api/feedback", { method: "POST", headers, body: JSON.stringify(body) });
    const res = await postFeedback(ctx);
    await ctx.done();
    return res.json();
  };

  assert.deepEqual(await send({ kind: "bug", rating: 2, name: "Thrallson",
    message: "The map breaks <!channel> in Goldshire. Write me at me@mail.example or 198.51.100.7" }), { ok: true });
  assert.equal(posts.length, 1);
  const [{ url, text }] = posts;
  assert.equal(url, HOOK);
  assert.match(text, /Site feedback · Bug ★★☆☆☆/);
  assert.match(text, /The map breaks &lt;!channel&gt; in Goldshire\. Write me at \[email\] or \[ip\]/);
  assert.match(text, /<https:\/\/preview\.example\/admin#feedback\|open in \/admin>/);
  for (const secret of ["player@example.com", "me@mail.example", "198.51.100.7", "203.0.113.9", user.id, "Real Name", "Thrallson"]) {
    assert.ok(!text.includes(secret), `no ${secret} in ${text}`);
  }

  // A name the player chose to show (OK to quote) does show.
  await send({ kind: "review", rating: 5, name: "Thrallson", quote_ok: true, message: "Love the narration" });
  assert.match(posts[1].text, /— Thrallson \(OK to quote\)/);

  slackDown = true;
  assert.deepEqual(await send({ kind: "idea", message: "More zones please" }), { ok: true });
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM feedback").get().n, 3);
});

test("a Slack bot token posts with chat.postMessage to #player-feedback when no webhook works", async () => {
  const env = { DB: d1(), SLACK_FEEDBACK_WEBHOOK: "not-a-url", SLACK_BOT_TOKEN: "xoxb-1-2-abc" };
  const ctx = context(env);
  forwardFeedback(ctx, "feedback", { id: 1, kind: "bug", label: "Bug", message: "Broken map" });
  await ctx.done();
  assert.equal(posts.length, 1);
  assert.deepEqual([posts[0].url, posts[0].channel, posts[0].auth],
    ["https://slack.com/api/chat.postMessage", "C0C9XBY9WQM", "Bearer xoxb-1-2-abc"]);
  assert.match(posts[0].text, /Site feedback · Bug\*\n> Broken map/);
  assert.equal(slackState(env).state, "bot token");
});

test(`past ${BURST} items a minute the rest wait for one digest, and an item is never posted twice`, async () => {
  const env = { DB: d1(), SLACK_FEEDBACK_WEBHOOK: HOOK };
  const ctx = context(env, "/api/clip-report");
  const at = new Date("2026-10-17T20:05:10Z"), next = new Date("2026-10-17T20:06:01Z");
  const report = id => ({ id, clip: "zone:stormwind#faq3", voice: "LoreForever_Voice_Default", reason: "cut", source: "addon" });
  for (let id = 1; id <= BURST + 5; id++) forwardFeedback(ctx, "clip-report", report(id), { now: at });
  forwardFeedback(ctx, "clip-report", report(1), { now: at });   // the same report again (edited)
  await ctx.done();
  assert.equal(posts.filter(p => /Clip report · Cut off/.test(p.text)).length, BURST);
  assert.equal(posts.filter(p => /More than 20 feedback items this minute/.test(p.text)).length, 1);
  assert.equal(posts.length, BURST + 1);

  forwardFeedback(ctx, "feedback", { id: 9, kind: "bug", label: "Bug", message: "After the burst" }, { now: next });
  await ctx.done();
  const [digest, item] = posts.slice(BURST + 1).map(p => p.text);
  assert.match(digest, /Digest: 5 more items from the burst at 20:05 UTC\*\n5 clip reports/);
  assert.match(item, /After the burst/);
});

test("a Willo flag is posted with the account's character names taken out", async () => {
  const env = { DB: d1(), SLACK_FEEDBACK_WEBHOOK: HOOK };
  await setup(env);
  const user = await findOrCreateUser(env, { email: "w@example.com", googleSub: "g2", name: "Mira Stone" });
  const ctx = context(env, "/api/companion/feedback");
  assert.ok(await logFeedback(env, user.id, { kind: "flag", said: "Brannoc is a dwarf, not a gnome",
    question: "What race is Brannoc?", answer: "Brannoc the gnome...", zone: "Dun Morogh", sub: "Kharanos" },
    { context: ctx, names: ["Brannoc"], client: "companion/0.18.0" }));
  await ctx.done();
  assert.equal(posts.length, 1);
  const { text } = posts[0];
  assert.match(text, /Willo · Wrong answer flagged/);
  assert.match(text, /Dun Morogh \/ Kharanos · Willo 0\.18\.0/);
  assert.ok(!/Brannoc|Mira|w@example\.com/.test(text), text);
});
