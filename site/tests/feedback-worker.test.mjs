// The feedback forwarder Worker (workers/feedback/worker.js, LOR-641) with the site's POST /api/feedback/forward: mail
// to hello@ always reaches the inbox first, and Slack gets the display name, subject and start of the text, never the
// address; the Discord and YouTube polls post players' new messages and comments and leave out our own; CurseForge's
// digest mail becomes one post per comment. D1 is node:sqlite (helpers.mjs); the site, Slack, Discord and YouTube are a
// stubbed fetch. Run: node --test site/tests/
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker, { poll } from "../../workers/feedback/worker.js";
import { onRequestPost as forward } from "../functions/api/feedback/forward.js";
import { d1 } from "./helpers.mjs";

const SITE = "https://loreforeverwow.com";
const HOOK = "https://hooks.slack.com/services/T000/B000/XXXX";
const KEY = "forward-key";
let posts, siteEnv, realFetch;
beforeEach(() => {
  posts = [];
  siteEnv = { DB: d1(), SLACK_FEEDBACK_WEBHOOK: HOOK, FEEDBACK_FORWARD_KEY: KEY };
  realFetch = globalThis.fetch;
  // The Worker's fetch goes to the site's handler; the site's goes to "Slack".
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === HOOK) { posts.push(JSON.parse(init.body).text); return new Response("ok"); }
    if (String(url).startsWith("https://discord.com/api/")) return discordFetch(url);
    if (String(url).startsWith("https://www.googleapis.com/youtube/")) return youtubeFetch(url);
    const pending = [];
    const res = await forward({ request: new Request(url, init), env: siteEnv, waitUntil: p => pending.push(p) });
    await Promise.all(pending);
    return res;
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

// A ForwardableEmailMessage as Email Routing hands it to the Worker.
function mail(raw, { forwardFails = false, to = "hello@loreforeverwow.com" } = {}) {
  const bytes = new TextEncoder().encode(raw.replace(/\n/g, "\r\n"));
  const head = raw.slice(0, raw.indexOf("\n\n")).replace(/\n[ \t]+/g, " ");
  const headers = new Headers();
  for (const line of head.split("\n")) headers.append(line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim());
  const m = {
    headers, to, rawSize: bytes.length, raw: new Response(bytes).body, events: [],
    async forward(to) { m.events.push("forward " + to); if (forwardFails) throw new Error("destination not verified"); },
    setReject(reason) { m.events.push("reject " + reason); },
  };
  return m;
}
async function deliver(m, env) {
  const pending = [];
  let thrown = null;
  try { await worker.email(m, env, { waitUntil: p => pending.push(p) }); } catch (e) { thrown = e; }
  await Promise.all(pending);
  return thrown;
}
const ENV = { FORWARD_TO: "inbox@example.com", FEEDBACK_FORWARD_KEY: KEY, SITE };

const REPLY = `From: =?utf-8?Q?Jos=C3=A9_Garc=C3=ADa?= <jose.garcia@example.com>
To: hello@loreforeverwow.com
Subject: =?utf-8?B?UmU6IFdpbGxvIGlzIGdyZWF0IOKAlCBvbmUgYnVn?=
Message-ID: <abc123@mail.example.com>
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="b1"

--b1
Content-Type: text/plain; charset="utf-8"
Content-Transfer-Encoding: quoted-printable

Love the narrator in Elwynn! But Willo froze after /reload. Reach me at jose=
.garcia@example.com.

On Fri, Oct 17, 2026 at 9:00 AM Lore Forever <hello@loreforeverwow.com> wrote:
> Thanks for subscribing!
--b1
Content-Type: text/html; charset="utf-8"

<p>Love the narrator</p>
--b1--
`;

test("a reply to hello@ reaches the inbox first, then Slack gets the name, subject and text without any address", async () => {
  const m = mail(REPLY);
  assert.equal(await deliver(m, ENV), null);
  assert.deepEqual(m.events, ["forward inbox@example.com"]);
  assert.equal(posts.length, 1);
  const [text] = posts;
  assert.match(text, /^:envelope: \*Email to hello@ · Re: Willo is great — one bug\*/);
  assert.match(text, /> Love the narrator in Elwynn! But Willo froze after \/reload\. Reach me at \[email\]\./);
  assert.match(text, /from José García · in the inbox$/);
  assert.ok(!/jose\.garcia|Thanks for subscribing|wrote:|admin/.test(text), text);

  // Email Routing retrying the same message doesn't post it again.
  await deliver(mail(REPLY), ENV);
  assert.equal(posts.length, 1);
});

test("auto-replies reach the inbox only; without FORWARD_TO mail is turned away, not lost; a wrong key posts nothing", async () => {
  const ooo = mail("From: Sam <sam@example.com>\nSubject: Out of office\nAuto-Submitted: auto-replied\n\nAway until Monday\n");
  await deliver(ooo, ENV);
  assert.deepEqual(ooo.events, ["forward inbox@example.com"]);

  const early = mail(REPLY);
  await deliver(early, { FEEDBACK_FORWARD_KEY: KEY });
  assert.match(early.events.join(), /^reject /);

  const wrongKey = mail(REPLY);
  await deliver(wrongKey, { ...ENV, FEEDBACK_FORWARD_KEY: "nope" });
  assert.deepEqual(wrongKey.events, ["forward inbox@example.com"]);
  assert.equal(posts.length, 0);
});

test("when forwarding to the inbox fails, Slack says so and Email Routing still sees the failure", async () => {
  const m = mail("From: someone@example.com\nSubject: Bug\nMessage-ID: <x@y>\n\nThe map is blank\n", { forwardFails: true });
  const thrown = await deliver(m, ENV);
  assert.match(String(thrown), /destination not verified/);
  assert.equal(posts.length, 1);
  assert.match(posts[0], /from someone \(no name given\) · :warning: not forwarded to the inbox/);
  assert.ok(!posts[0].includes("someone@example.com"));
});

// ---- Discord ----

// The server as Discord's REST API shows it to the bot.
const OWNER = "100", MOD = "101", PLAYER = "102", OTHER = "103", BOT = "104";
const DISCORD_API = {
  "/guilds/1537987051520004207/channels": [
    { id: "200", type: 0, name: "help-and-bugs" }, { id: "201", type: 0, name: "general" },
    { id: "202", type: 15, name: "narration-feedback" }, { id: "203", type: 0, name: "staff-chat" }],
  "/guilds/1537987051520004207": { id: "1537987051520004207", owner_id: OWNER },
  "/guilds/1537987051520004207/roles": [{ id: "300", permissions: "8192" }, { id: "301", permissions: "1024" }],
  "/guilds/1537987051520004207/threads/active": { threads: [
    { id: "210", type: 11, parent_id: "202", name: "Thrall sounds off" }, { id: "211", type: 11, parent_id: "203", name: "plans" }] },
  "/channels/200/messages": [
    { id: "1003", type: 0, content: "Thanks <@103>, that fixed it", author: { id: PLAYER, username: "p", global_name: "Pyra" },
      mentions: [{ id: OTHER, username: "o", global_name: "Oak" }] },
    { id: "1001", type: 0, content: "Willo crashes on login <:sad:55>", author: { id: OTHER, username: "o", global_name: "Oak" },
      attachments: [{ id: "a" }] },
    { id: "1002", type: 0, content: "We're on it", author: { id: MOD, username: "m" } },
    { id: "1004", type: 0, content: "Release 0.18.3 is out", author: { id: BOT, username: "Lore bot", bot: true } },
    { id: "1005", type: 7, content: "", author: { id: OTHER, username: "o" } }],
  "/channels/201/messages": [{ id: "1006", type: 0, content: "gm all", author: { id: OWNER, username: "mike" } }],
  "/channels/210/messages": [{ id: "1007", type: 19, content: "Same here", author: { id: OTHER, username: "o", global_name: "Oak" } }],
  "/channels/211/messages": [{ id: "1008", type: 0, content: "secret plans", author: { id: OTHER, username: "o" } }],
  [`/guilds/1537987051520004207/members/${MOD}`]: { roles: ["300"] },
  [`/guilds/1537987051520004207/members/${PLAYER}`]: { roles: ["301"], nick: "Pyra the Bold" },
  [`/guilds/1537987051520004207/members/${OTHER}`]: { roles: [] },
};
async function discordFetch(url) {
  const path = new URL(url).pathname.replace(/^\/api\/v10/, "");
  if (path === "/channels/202/messages") throw new Error("a forum has no messages of its own");
  return path in DISCORD_API ? Response.json(DISCORD_API[path]) : new Response("{}", { status: 404 });
}

test("the Discord poll posts players' new messages oldest first, without bots, staff, ids or other channels, once each", async () => {
  const env = { FEEDBACK_FORWARD_KEY: KEY, SITE, DISCORD_BOT_TOKEN: "bot-token" };
  const pending = [];
  await worker.scheduled({ scheduledTime: Date.now() }, env, { waitUntil: p => pending.push(p) });
  await Promise.all(pending);
  assert.equal(posts.length, 3, posts.join("\n---\n"));
  assert.match(posts[0], /^:left_speech_bubble: \*Discord #help-and-bugs\*\n> Willo crashes on login :sad:\nOak · 1 attachment · <https:\/\/discord\.com\/channels\/1537987051520004207\/200\/1001\|open in Discord>$/);
  assert.match(posts[1], /Discord #help-and-bugs\*\n> Thanks @Oak, that fixed it\nPyra the Bold ·/);
  assert.match(posts[2], /Discord #narration-feedback › Thrall sounds off\*\n> Same here\nOak · a reply ·/);
  assert.ok(!posts.some(p => /We're on it|0\.18\.3|gm all|secret plans|\b10[0-4]\b/.test(p)), posts.join("\n"));

  await poll(env);   // the next poll sees the same window again
  assert.equal(posts.length, 3);
});

// ---- YouTube ----

const CHANNEL = "UCabcdefghijklmnopqrstuv";
const ago = min => new Date(Date.now() - min * 60_000).toISOString();
const comment = (id, author, text, min, own = false) => ({ id, snippet: { authorDisplayName: author, textOriginal: text,
  publishedAt: ago(min), authorChannelId: { value: own ? CHANNEL : "UCviewer" + id } } });
const YOUTUBE_API = {
  "/youtube/v3/channels": { items: [{ id: CHANNEL }] },
  "/youtube/v3/commentThreads": { items: [
    { snippet: { videoId: "vidLore0001", topLevelComment: comment("Ugw1", "@ana", "Does it work on WoW Forever?", 20) },
      replies: { comments: [comment("Ugw1.r1", "@mikeliudev", "Yes!", 15, true), comment("Ugw1.r2", "@ben", "It does for me", 10)] } },
    { snippet: { videoId: "vidLore0001", topLevelComment: comment("Ugw2", "@old", "Old one", 300) } },
    { snippet: { videoId: "vidDesk0001", topLevelComment: comment("Ugw3", "@cara", "Nice desk", 5) } }] },
  "/youtube/v3/videos": { items: [{ id: "vidLore0001", snippet: { title: "Lore Forever: Willo answers in WoW" } },
    { id: "vidDesk0001", snippet: { title: "My desk setup" } }] },
};
const youtubeFetch = url => Response.json(YOUTUBE_API[new URL(url).pathname] || {});

test("the YouTube poll posts new viewer comments on Lore Forever videos only, oldest first, never the channel's own", async () => {
  const env = { FEEDBACK_FORWARD_KEY: KEY, SITE, YOUTUBE_API_KEY: "yt-key" };
  await poll(env);
  assert.equal(posts.length, 2, posts.join("\n---\n"));
  assert.match(posts[0], /^:tv: \*YouTube comment · Lore Forever: Willo answers in WoW\*\n> Does it work on WoW Forever\?\n@ana · <https:\/\/www\.youtube\.com\/watch\?v=vidLore0001&lc=Ugw1\|open on YouTube>$/);
  assert.match(posts[1], /> It does for me\n@ben · a reply · <https:\/\/www\.youtube\.com\/watch\?v=vidLore0001&lc=Ugw1\.r2\|/);
  await poll(env);
  assert.equal(posts.length, 2);
});

// ---- CurseForge ----

// CurseForge's "What's been happening" mail as its text and HTML parts lay it out (names and comments made up).
const DIGEST = `From: noreply@curseforge.com
To: mike@example.com
Subject: What's been happening at CurseForge
Message-ID: <digest-1@email.amazonses.com>
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="cf"

--cf
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 7bit

    someone, Here's what's been going on lately with CurseForge:
    October 14New Comments Posted to Followed ProjectsThere are new comments for the project Lore Forever.

                questgiver added a comment to the project Lore Forever

                    Any plans for a Polish translation?
                    It would be huge

                1:41 PM

                mikeliudev added a comment to the project Lore Forever

                    Thanks all!

                4:51 PM

                stranger added a comment to the project Other Addon

                    Not ours

                5:00 PM
Project UpdateYour project, Lore Forever - More Places (Female Narrator), has updates.
The status of the project Lore Forever - More Places (Female Narrator) has been changed to Approved
                1:05 AM
October 13Comment RepliesThere are new replies to your comment in Re: Lore Forever.

            healer42 replied to your comment on Re: Lore Forever

                    @mikeliudev It works now :)

                12:02 AM

To unsubscribe from these email notifications, go to your notifications page at https://legacy.curseforge.com/account/notifications.
--cf
Content-Type: text/html; charset=UTF-8

<p>There are new comments for the project <a href="https://www.curseforge.com/wow/addons/lore-forever">Lore Forever</a>.</p>
--cf--
`;

test("CurseForge's digest, forwarded to curseforge@, posts each new comment on our projects and never goes back to the inbox", async () => {
  const to = "curseforge@loreforeverwow.com";
  const digest = mail(DIGEST, { to });
  assert.equal(await deliver(digest, ENV), null);
  assert.deepEqual(digest.events, [], "not forwarded to the inbox, so Gmail's filter can't loop it");
  assert.equal(posts.length, 2, posts.join("\n---\n"));
  assert.match(posts[0], /^:jigsaw: \*CurseForge comment · Lore Forever\*\n> Any plans for a Polish translation\?\n> It would be huge\nquestgiver · October 14 1:41 PM · <https:\/\/www\.curseforge\.com\/wow\/addons\/lore-forever\|open on CurseForge>$/);
  assert.match(posts[1], /> @mikeliudev It works now :\)\nhealer42 · a reply · October 13 12:02 AM ·/);

  await deliver(mail(DIGEST, { to }), ENV);   // the same digest again
  assert.equal(posts.length, 2);

  // Anything else sent to that address (Gmail's forwarding confirmation) reaches the inbox like hello@ mail.
  const confirm = mail("From: Gmail Team <forwarding-noreply@google.com>\nSubject: Gmail Forwarding Confirmation\n\nCode 123\n", { to });
  await deliver(confirm, ENV);
  assert.deepEqual(confirm.events, ["forward inbox@example.com"]);
});
