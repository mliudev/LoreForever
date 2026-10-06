// Player profiles end to end through the real Functions (LOR-181): /api/profile/* and /u/<handle>.
// D1 is node:sqlite (helpers.mjs); Gemini is a stub on globalThis.fetch. Run: node --test site/tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { onRequest as profileApi } from "../functions/api/profile/[action].js";
import { onRequestGet as profileGet } from "../functions/u/[handle].js";
import { onRequestGet as adminGet } from "../functions/api/admin.js";
import { onRequest as authApi } from "../functions/api/auth/[action].js";
import { findOrCreateUser, startSession, setup, deleteUser } from "../lib/accounts.js";
import { templateStory, offCanon, storyCost, splitParagraphs, STORY_MODEL } from "../lib/profiles.js";
import { parseRecord } from "../lib/journey.js";
import { profilePage as voicePage } from "../lib/voices.js";
import { d1, assets } from "./helpers.mjs";
import { RECORD } from "./fixtures/journey/record.mjs";

const ORIGIN = "https://preview.example";
// One database for the file (lib/accounts.js creates its tables once per process), emptied before each test.
const env = { DB: d1() };
beforeEach(async () => {
  await setup(env);
  for (const table of ["profiles", "sessions", "users", "rate_limits", "story_spend"]) env.DB.sqlite.exec(`DELETE FROM ${table}`);
  delete env.GEMINI_API_KEY;
});

async function signIn(sub) {
  await setup(env);
  const user = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name: `Real Name ${sub}` });
  const set = await startSession(env, new Request(ORIGIN), user.id);
  return { user, cookie: set.split(";")[0] };
}

async function api(action, { cookie, body, method = "POST", origin = ORIGIN } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (cookie) headers.set("Cookie", cookie);
  if (method !== "GET") headers.set("Origin", origin);
  const request = new Request(`${ORIGIN}/api/profile/${action}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
  const res = await profileApi({ request, env, params: { action } });
  return { status: res.status, body: await res.json() };
}

async function view(handle, cookie, query = "") {
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  const res = await profileGet({ request: new Request(`${ORIGIN}/u/${handle}${query}`, { headers }), env, params: { handle } });
  return { status: res.status, html: await res.text(), headers: res.headers };
}

const row = async userId => env.DB.prepare("SELECT * FROM profiles WHERE user_id = ?").bind(userId).first();

// A Gemini stub: answers with `story` (or the status) and USAGE, and keeps what it was asked.
const USAGE = { promptTokenCount: 2000, candidatesTokenCount: 300, thoughtsTokenCount: 100 };   // $0.0011 at 0.25/1.50
function gemini(story, status = 200) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    if (status !== 200) return new Response("nope", { status });
    return Response.json({ candidates: [{ content: { parts: [
      { text: "thinking...", thought: true }, { text: JSON.stringify({ story }) },
    ] } }], usageMetadata: USAGE });
  };
  return calls;
}
const spend = () => env.DB.prepare("SELECT * FROM story_spend").first();
const realFetch = globalThis.fetch;
const STORY = "Aelric stepped out of the moonlit glades of Shadowglen with nothing but a staff and a stubborn streak. " +
  "The road ran north to Darkshore's broken shore and on through the whispering boughs of Ashenvale.\n\n" +
  "In the dark of the Deadmines, Aelric stood against Edwin VanCleef and walked out into the daylight again, " +
  "a little bruised and a great deal wiser. Few in Darnassus now doubt the young druid's resolve.";

test("pasting a record makes a private profile with the record's summary as its story", async () => {
  const me = await signIn("aelric");
  const res = await api("import", { cookie: me.cookie, body: { record: RECORD } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.created, true);
  assert.deepEqual(res.body.story, { source: "template", why: "off" });
  const p = res.body.profile;
  assert.deepEqual([p.handle, p.url, p.public, p.name, p.sheet, p.faction], ["aelric", "/u/aelric", false, "Aelric", "Level 24 Night Elf Druid", "Alliance"]);
  assert.deepEqual(p.specs, ["Balance", "Feral Combat", "Restoration"]);

  const r = await row(me.user.id);
  assert.equal(r.story_source, "template");
  assert.equal(r.story_count, 0);
  assert.match(r.story, /^Aelric is a level 24 Night Elf Druid of the Alliance\. The journey began in Teldrassil on Oct 01, 2026/);
  assert.match(r.story, /Edwin VanCleef/);
  // Only the facts: not the text, no group members, no unknown killers.
  for (const gone of ["Journey record:", "Dwarf Priest", "Human Warrior", "Gravenx"]) assert.ok(!r.data.includes(gone), gone);

  // Private: only its owner can open it.
  const anon = await view("aelric");
  assert.equal(anon.status, 404);
  assert.match(anon.html, /No profile here/);
  assert.ok(!anon.html.includes("Night Elf"));
  const other = await signIn("someone");
  assert.equal((await view("aelric", other.cookie)).status, 404);
  const mine = await view("aelric", me.cookie);
  assert.equal(mine.status, 200);
  assert.match(mine.html, /Only you can see this page/);
  assert.match(mine.html, /Make it public/);
  assert.ok(!mine.html.includes("This could be your page"), "no 'make your own' on your own page");
  assert.match(mine.headers.get("Cache-Control"), /no-store/);
});

test("a public profile: everything on the page, the account's links but never its name or email", async () => {
  const me = await signIn("aelric");
  await env.DB.prepare("UPDATE users SET links = ? WHERE id = ?").bind("https://twitch.tv/aelric\njavascript:alert(1)", me.user.id).run();
  await api("import", { cookie: me.cookie, body: { record: RECORD } });
  const set = await api("settings", { cookie: me.cookie, body: { public: true } });
  assert.equal(set.body.profile.public, true);

  const { status, html, headers } = await view("aelric");
  assert.equal(status, 200);
  assert.equal(headers.get("Cache-Control"), "no-cache");
  assert.match(html, /<title>Aelric, level 24 Night Elf Druid - Lore Forever<\/title>/);
  assert.match(html, /<meta property="og:title" content="Aelric, level 24 Night Elf Druid">/);
  assert.match(html, /<meta property="og:description" content="Aelric is a level 24 Night Elf Druid of the Alliance\.">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/loreforeverwow\.com\/u\/aelric">/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<h1>Aelric<\/h1>/);
  assert.match(html, /Level 24 Night Elf Druid &middot; Alliance &middot; Forever/);
  assert.match(html, /<a href="https:\/\/twitch\.tv\/aelric" rel="nofollow ugc noopener">twitch\.tv<\/a>/);
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("Real Name") && !html.includes("@example.com"), "no account name or email");
  for (const bit of ["Aelric's story", "The road so far", "<li>Teldrassil</li><li>Darnassus</li><li>Darkshore</li>",
    "Bosses defeated", "Edwin VanCleef", "Dungeons", "The Deadmines", "Notable kills", "Mother Fang", "Most fought",
    "Murloc Forager", "Best finds", '<span class="q3">Cruel Barb</span>', "Honored with Darnassus", "Herbalism",
    "<cite>The Seven Dragons</cite>", "This could be your page", 'href="/download/installer"', 'href="/account#profile"']) {
    assert.ok(html.includes(bit), bit);
  }
  assert.ok(!html.includes("Only you can see this page"), "no owner bar for visitors");
  assert.ok(!html.includes("Dwarf Priest") && !html.includes("Gravenx"));
  assert.ok(!/\b(AI|generated|Gemini|model)\b/.test(html.replace(/<[^>]+>/g, " ")), "no wording about how the story is made");

  // Private again: gone for visitors.
  await api("settings", { cookie: me.cookie, body: { public: false } });
  assert.equal((await view("aelric")).status, 404);
});

test("signed in, a profile page's header shows you so from the start, and the page is private to you", async () => {
  const me = await signIn("aelric");
  await api("import", { cookie: me.cookie, body: { record: RECORD } });
  await api("settings", { cookie: me.cookie, body: { public: true } });
  const other = await signIn("brakka");
  for (const [who, handle, status] of [[me, "aelric", 200], [other, "aelric", 200], [other, "nobody", 404]]) {
    const { html, headers, ...res } = await view(handle, who.cookie);
    assert.equal(res.status, status, handle);
    // When the sign-in ends: header.js stops trusting what it remembers then. GET /api/auth/me says it too.
    const until = (await env.DB.prepare("SELECT expires FROM sessions WHERE user_id = ?").bind(who.user.id).first()).expires;
    assert.ok(html.includes(`<div class="head-actions" data-auth="in" data-name="Real Name ${who.user.google_sub}" ` +
      `data-until="${until}">`), handle);
    assert.ok(!html.includes(who.user.email), "never the email");
    assert.match(headers.get("Cache-Control"), /no-store/);
    const request = new Request(`${ORIGIN}/api/auth/me`, { headers: { Cookie: who.cookie } });
    const withVoices = { ...env, ASSETS: assets({ "/voices/voices.json": { voices: [] } }) };
    assert.equal((await (await authApi({ request, env: withVoices, params: { action: "me" } })).json()).user.session_expires, until);
  }
  const anon = await view("aelric");
  assert.ok(!anon.html.includes("data-auth"), "signed out: the page's own header; header.js remembers or asks");
  assert.equal(anon.headers.get("Cache-Control"), "no-cache");
});

const SHARE ='<button class="btn-small" type="button" data-share data-share-text="Aelric&#39;s journey in WoW Forever">Share</button>';
const SCRIPTS = /<script src="\/js\/share\.js" defer><\/script>\s*<script src="\/js\/profile\.js" defer><\/script>/;

test("Share at the top: visitors in the head, the owner in their bar with View as a visitor and the switch (LOR-150, LOR-302)", async () => {
  const me = await signIn("aelric");
  await api("import", { cookie: me.cookie, body: { record: RECORD } });
  // Private: the three together in the owner's bar (Share there says to make it public first, public/js/profile.js).
  let mine = (await view("aelric", me.cookie)).html;
  let bar = mine.split('id="pf-owner"')[1].split("</div>")[0];
  assert.match(bar, /^ data-bar data-public="0">/);
  assert.ok(bar.includes(`${SHARE}
      <a class="btn-small" href="/u/aelric?as=visitor" data-keep-view>View as a visitor</a>
      <button class="btn-small" type="button" data-set-public="1">Make it public</button>`), bar);
  assert.ok(!mine.includes(">Copy link<"), "Share, not Copy link");
  assert.ok(!mine.includes("pf-head-share"), "the owner shares from their bar");
  assert.match(mine, SCRIPTS);

  // Public: the same three with Make it private.
  await api("settings", { cookie: me.cookie, body: { public: true } });
  mine = (await view("aelric", me.cookie)).html;
  bar = mine.split('id="pf-owner"')[1].split("</div>")[0];
  assert.ok(bar.includes(`${SHARE}
      <a class="btn-small" href="/u/aelric?as=visitor" data-keep-view>View as a visitor</a>
      <button class="btn-small" type="button" data-set-public="0">Make it private</button>`), bar);
  assert.ok(!mine.includes(">Copy link<"));

  // Visitors: Share in the head, above everything else, and nothing of the owner's bar.
  const { html } = await view("aelric");
  const head = html.split('class="vpr-head pf-head"')[1].split('class="pf-stats"')[0];
  assert.ok(head.includes(`<div class="pf-head-share" data-bar>\n      ${SHARE}\n      <p class="fb-status" role="status" hidden></p>`), head);
  assert.ok(html.indexOf("data-share") < html.indexOf('id="story-title"'));
  for (const owners of ['id="pf-owner"', "View as a visitor", "data-set-public", "Copy link"]) assert.ok(!html.includes(owners), owners);
  assert.match(html, SCRIPTS);
});

// A page's <main>, and the same without the visitor-view bar, whitespace evened out.
const main = html => html.split("<main")[1].split("</main>")[0];
const withoutBar = html => main(html).replace(/<div class="pf-owner pf-visitor"[\s\S]*?hidden><\/p>\s*<\/div>/, "").replace(/\s+/g, " ");
// A page as a signed-out visitor gets it: for someone signed in, only the header differs (it shows them signed in,
// lib/voices.js siteNav).
const signedOut = html => html.replace(/ data-auth="in" data-name="[^"]*"(?: data-until="[^"]*")?/, "");

test("View as a visitor: the owner gets exactly the visitor's page, plus a bar back; a private one is No profile here (LOR-302)", async () => {
  const me = await signIn("aelric"), other = await signIn("someone");
  await api("import", { cookie: me.cookie, body: { record: RECORD } });
  await api("settings", { cookie: me.cookie, body: { public: true } });
  const visitor = await view("aelric");
  const preview = await view("aelric", me.cookie, "?as=visitor");
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("Cache-Control"), "private, no-store");
  const bar = preview.html.split('id="pf-visitor"')[1].split("</div>")[0];
  assert.match(bar, /You're viewing your profile as a visitor\. This is what anyone with the link sees\./);
  assert.match(bar, /<a class="btn-small" href="\/u\/aelric" data-keep-view>Back to my view<\/a>/);
  assert.ok(!bar.includes("data-set-public"), "nothing to switch on a public one");
  // The page is the visitor's: the same <main> once the bar is gone, and the same everything else.
  assert.equal(withoutBar(preview.html), main(visitor.html).replace(/\s+/g, " "));
  assert.equal(signedOut(preview.html).replace(main(preview.html), ""), visitor.html.replace(main(visitor.html), ""));
  assert.ok(preview.html.includes("This could be your page") && preview.html.includes("pf-head-share"));
  assert.ok(!preview.html.includes('id="pf-owner"'));

  // ?pictures=1 stays on both ways.
  assert.match((await view("aelric", me.cookie, "?pictures=1")).html,
    /<a class="btn-small" href="\/u\/aelric\?pictures=1&amp;as=visitor" data-keep-view>View as a visitor<\/a>/);
  assert.match((await view("aelric", me.cookie, "?pictures=1&as=visitor")).html,
    /<a class="btn-small" href="\/u\/aelric\?pictures=1" data-keep-view>Back to my view<\/a>/);

  // Anyone else is a visitor already: ?as=visitor changes nothing for them.
  assert.equal(signedOut((await view("aelric", other.cookie, "?as=visitor")).html), visitor.html);
  assert.equal((await view("aelric", undefined, "?as=visitor")).html, visitor.html);

  // Private: visitors get "No profile here", and so does the owner's visitor view, with Make it public and the way back.
  await api("settings", { cookie: me.cookie, body: { public: false } });
  const gone = await view("aelric");
  assert.equal(gone.status, 404);
  const hidden = await view("aelric", me.cookie, "?as=visitor");
  assert.equal(hidden.status, 200);
  assert.equal(hidden.headers.get("Cache-Control"), "private, no-store");
  const pbar = hidden.html.split('id="pf-visitor"')[1].split("</div>")[0];
  assert.match(pbar, /^ data-bar data-public="0">/);
  assert.match(pbar, /Your profile is private, so visitors see what's below: No profile here\./);
  assert.match(pbar, /href="\/u\/aelric" data-keep-view>Back to my view<\/a>\s*<button class="btn-small btn-small-alt" type="button" data-set-public="1">Make it public<\/button>/);
  assert.equal(withoutBar(hidden.html), main(gone.html).replace(/\s+/g, " "));
  assert.match(hidden.html, /<title>No profile here - Lore Forever<\/title>/);
  assert.ok(!hidden.html.includes("Night Elf"), "nothing of the profile");
  assert.match(hidden.html, /<script src="\/js\/profile\.js" defer><\/script>/);
  assert.equal((await view("aelric", other.cookie, "?as=visitor")).status, 404);
  assert.ok(!(await view("aelric", other.cookie, "?as=visitor")).html.includes("pf-visitor"));
});

test("/account shares the profile's link with Share, not Copy link (LOR-150)", async () => {
  const { readFileSync } = await import("node:fs");
  const account = readFileSync(new URL("../public/account.html", import.meta.url), "utf8");
  assert.match(account, /Your link: <a id="pf-url" href="\/u\/me"><\/a>\s*<button class="btn-small" type="button" id="pf-share-btn">Share<\/button>/);
  assert.ok(!account.includes("Copy link"));
  assert.match(account, /<script src="\/js\/share\.js" defer><\/script>/);
  assert.match(account, /window\.lfShare\(\{ url, text: /);
});

test("share.js: the share sheet where there is one, else the link copied; a closed sheet is left alone (LOR-150)", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../public/js/share.js", import.meta.url), "utf8");
  // Runs share.js against a stand-in navigator; returns what it said and what it did.
  const run = async nav => {
    const window = {}, did = [];
    new Function("window", "navigator", source)(window, {
      share: nav.share && (async data => { did.push(["share", data]); if (nav.share !== true) throw nav.share; }),
      clipboard: { writeText: async url => { did.push(["copy", url]); if (nav.copy === false) throw new Error("denied"); } },
    });
    return [await window.lfShare({ url: "https://loreforeverwow.com/u/aelric", text: "Aelric's journey in WoW Forever" }), did];
  };
  const data = { title: "Aelric's journey in WoW Forever", text: "Aelric's journey in WoW Forever", url: "https://loreforeverwow.com/u/aelric" };
  assert.deepEqual(await run({ share: true }), ["shared", [["share", data]]]);
  assert.deepEqual(await run({ share: Object.assign(new Error("closed"), { name: "AbortError" }) }), ["cancelled", [["share", data]]]);
  assert.deepEqual(await run({ share: Object.assign(new Error("no target"), { name: "NotAllowedError" }) }),
    ["copied", [["share", data], ["copy", data.url]]]);
  assert.deepEqual(await run({}), ["copied", [["copy", data.url]]]);
  assert.deepEqual(await run({ copy: false }), ["failed", [["copy", data.url]]]);
});

test("favorite spec: only the character's class's specs", async () => {
  const me = await signIn("aelric");
  await api("import", { cookie: me.cookie, body: { record: RECORD } });
  const bad = await api("settings", { cookie: me.cookie, body: { spec: "Fury" } });
  assert.equal(bad.status, 400);
  const good = await api("settings", { cookie: me.cookie, body: { spec: "Feral Combat", public: true } });
  assert.equal(good.body.profile.spec, "Feral Combat");
  assert.match((await view("aelric")).html, /Favorite spec: <strong>Feral Combat<\/strong>/);
  assert.equal((await api("settings", { cookie: me.cookie, body: { spec: "" } })).body.profile.spec, "");
  // A record of another class drops a spec that no longer fits.
  await api("settings", { cookie: me.cookie, body: { spec: "Balance" } });
  await api("import", { cookie: me.cookie, body: { record: RECORD.replace("Night Elf Druid", "Human Warrior") } });
  assert.equal((await row(me.user.id)).spec, null);
});

test("a player can pick their own address; taken, reserved and odd ones are refused", async () => {
  const me = await signIn("aelric"), other = await signIn("brakka");
  await api("import", { cookie: me.cookie, body: { record: RECORD } });
  await api("import", { cookie: other.cookie, body: { record: RECORD.replace("Aelric - Forever", "Brakka - Forever") } });
  for (const [handle, status] of [["brakka", 409], ["me", 400], ["ab", 400], ["-aelric", 400], ["a b c", 400], ["Ünïcode", 400], ["x".repeat(25), 400]]) {
    assert.equal((await api("settings", { cookie: me.cookie, body: { handle } })).status, status, handle);
  }
  const res = await api("settings", { cookie: me.cookie, body: { handle: " AelricPlays ", public: true } });
  assert.deepEqual([res.status, res.body.profile.handle, res.body.profile.url], [200, "aelricplays", "/u/aelricplays"]);
  assert.equal((await view("aelricplays")).status, 200);
  assert.equal((await view("aelric")).status, 404);   // the old address is free again
  assert.equal((await api("settings", { cookie: me.cookie, body: { handle: "aelricplays" } })).status, 200);   // unchanged
});

test("updating keeps the address; a second Aelric gets their own", async () => {
  const me = await signIn("aelric"), twin = await signIn("twin");
  await api("import", { cookie: me.cookie, body: { record: RECORD } });
  const again = await api("import", { cookie: me.cookie, body: { record: RECORD.replace("Level 24", "Level 25") } });
  assert.deepEqual([again.body.created, again.body.profile.handle, again.body.profile.sheet], [false, "aelric", "Level 25 Night Elf Druid"]);
  const theirs = await api("import", { cookie: twin.cookie, body: { record: RECORD.replace("Aelric - Forever", "Aelric - Otherrealm") } });
  assert.equal(theirs.body.profile.handle, "aelric-2");
  const odd = await signIn("odd");
  assert.equal((await api("import", { cookie: odd.cookie, body: { record: RECORD.replace("Aelric - Forever", "Me - Forever") } })).body.profile.handle, "me-2");
});

test("with GEMINI_API_KEY the story is written; every try counts against 3 a day, even across Delete my profile", async () => {
  env.GEMINI_API_KEY = "test-key";
  const me = await signIn("aelric");
  try {
    const calls = gemini(STORY);
    const res = await api("import", { cookie: me.cookie, body: { record: RECORD } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.story, { source: "written", why: "written" });
    let r = await row(me.user.id);
    assert.deepEqual([r.story_source, r.story_count, r.story], ["written", 1, STORY]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://generativelanguage.googleapis.com/v1beta/models/${STORY_MODEL}:generateContent`);
    assert.equal(calls[0].init.headers["x-goog-api-key"], "test-key");
    const prompt = calls[0].body.contents[0].parts[0].text;
    assert.match(prompt, /Character: Aelric, Night Elf Druid of the Alliance, level 24\./);
    assert.match(prompt, /Write Aelric's story in English\./);
    // Every death with its place (a story once moved one to the wrong zone), and "time" for one.
    assert.match(prompt, /Died 3 times: Auberdine, Darkshore, slain by Murloc Forager; Auberdine, Darkshore; The Deadmines\./);
    assert.match(prompt, /Foes fought most: Murloc Forager \(30 times\), Defias Pillager \(12 times\)\./);
    assert.ok(!prompt.includes("Dwarf Priest") && !prompt.includes("Gravenx"));
    assert.match(calls[0].body.systemInstruction.parts[0].text, /Never mention, hint at or foreshadow anything later/);
    assert.deepEqual(await spend(), { month: new Date().toISOString().slice(0, 7), micro_usd: 1100, calls: 1, stories: 1 });

    // An error (not billed), then a story that strays past the era (billed, thrown away): the first story stays.
    gemini(null, 500);
    assert.deepEqual((await api("import", { cookie: me.cookie, body: { record: RECORD } })).body.story, { source: "written", why: "http-500" });
    r = await row(me.user.id);
    assert.deepEqual([r.story_source, r.story, r.story_count], ["written", STORY, 1]);
    gemini(STORY + " One day Aelric would sail for Outland.");
    assert.equal((await api("import", { cookie: me.cookie, body: { record: RECORD } })).body.story.why, "era");
    assert.equal((await row(me.user.id)).story, STORY);
    assert.deepEqual(await spend(), { month: new Date().toISOString().slice(0, 7), micro_usd: 2200, calls: 3, stories: 1 });

    // Three tries today: no more calls, and deleting the profile doesn't reset that.
    const later = gemini(STORY.replace("stubborn", "quiet"));
    assert.equal((await api("import", { cookie: me.cookie, body: { record: RECORD } })).body.story.why, "daily");
    assert.equal(later.length, 0);
    await api("delete", { cookie: me.cookie });
    await api("import", { cookie: me.cookie, body: { record: RECORD } });
    assert.equal(later.length, 0);
    r = await row(me.user.id);
    assert.equal(r.story_source, "template");
    assert.match(r.story, /^Aelric is a level 24/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the monthly budget: at STORY_BUDGET_USD (default $100) no story is written, for anyone", async () => {
  env.GEMINI_API_KEY = "test-key";
  const a = await signIn("aelric"), b = await signIn("brakka");
  try {
    // $99.9989 spent: one more call fits, and takes the month to the budget.
    const month = new Date().toISOString().slice(0, 7);
    env.DB.sqlite.prepare("INSERT INTO story_spend (month, micro_usd, calls, stories) VALUES (?, ?, 5, 5)").run(month, 100e6 - 1100);
    const calls = gemini(STORY);
    await api("import", { cookie: a.cookie, body: { record: RECORD } });
    assert.equal(calls.length, 1);
    assert.equal((await spend()).micro_usd, 100e6);
    // At the budget: no call, the summary instead; the other account's allowance isn't touched.
    const capped = await api("import", { cookie: b.cookie, body: { record: RECORD.replace("Aelric - Forever", "Brakka - Forever") } });
    assert.deepEqual(capped.body.story, { source: "template", why: "budget" });
    assert.equal(calls.length, 1);
    assert.equal((await row(b.user.id)).story_source, "template");
    assert.equal(await env.DB.prepare("SELECT n FROM rate_limits WHERE user_id = ? AND bucket LIKE 'story:%'").bind(b.user.id).first("n"), null);
    // A lower budget from the variable; and last month's spend doesn't count.
    env.DB.sqlite.exec("DELETE FROM story_spend");
    env.STORY_BUDGET_USD = "0.001";
    env.DB.sqlite.prepare("INSERT INTO story_spend (month, micro_usd) VALUES ('2020-01', 999999999)").run();
    await api("import", { cookie: b.cookie, body: { record: RECORD.replace("Aelric - Forever", "Brakka - Forever") } });
    assert.equal(calls.length, 2);   // $0 this month < $0.001
    await api("import", { cookie: b.cookie, body: { record: RECORD.replace("Aelric - Forever", "Brakka - Forever") } });
    assert.equal(calls.length, 2);   // $0.0011 >= $0.001
    // A model without a known price is never called.
    env.STORY_BUDGET_USD = "100";
    env.STORY_MODEL = "gemini-unknown";
    await api("import", { cookie: a.cookie, body: { record: RECORD } });
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = realFetch;
    delete env.STORY_BUDGET_USD;
    delete env.STORY_MODEL;
  }
});

test("a story that comes back as one block is split into paragraphs between sentences", async () => {
  const sentence = i => `Sentence ${i} tells how Aelric walked the long road through the forest and met another friend there.`;
  const block = Array.from({ length: 8 }, (_, i) => sentence(i)).join(" ");   // 8 sentences, 136 words
  const parts = splitParagraphs(block);
  assert.equal(parts.length, 2);
  assert.equal(parts.join(" "), block);
  assert.ok(parts.every(p => /\.$/.test(p)));
  assert.equal(splitParagraphs(Array.from({ length: 12 }, (_, i) => sentence(i)).join(" ")).length, 3);   // 204 words
  assert.deepEqual(splitParagraphs("Too short. To split. At all. Really."), ["Too short. To split. At all. Really."]);
  assert.equal(splitParagraphs(block + " and it never ends").length, 1);   // no sentence end at the close: left alone
  // Through the import: stored with a blank line between the parts.
  env.GEMINI_API_KEY = "test-key";
  const me = await signIn("aelric");
  try {
    gemini(block);
    await api("import", { cookie: me.cookie, body: { record: RECORD } });
    assert.equal((await row(me.user.id)).story.split("\n\n").length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("storyCost counts input, output and thinking at the published rates", () => {
  assert.equal(storyCost({ promptTokenCount: 1e6 }, STORY_MODEL), 250000);                          // $0.25
  assert.equal(storyCost({ candidatesTokenCount: 5e5, thoughtsTokenCount: 5e5 }, STORY_MODEL), 1500000);   // $1.50
  assert.equal(storyCost({ promptTokenCount: 3 }, STORY_MODEL), 1);                                  // rounded up
  assert.equal(storyCost(undefined, STORY_MODEL), 0);
});

test("another character's record: the profile switches, goes private and moves to its own address", async () => {
  const me = await signIn("aelric");
  await api("import", { cookie: me.cookie, body: { record: RECORD } });
  await api("settings", { cookie: me.cookie, body: { public: true, spec: "Balance" } });
  const res = await api("import", { cookie: me.cookie, body: { record: RECORD.replace("Aelric - Forever", "Brakka - Forever") } });
  assert.deepEqual(res.body.switched, { from: "Aelric", to: "Brakka" });
  assert.deepEqual([res.body.profile.handle, res.body.profile.public, res.body.profile.spec], ["brakka", false, ""]);
  assert.equal((await view("aelric")).status, 404);
  assert.equal((await view("brakka")).status, 404);   // private until ticked again
  assert.equal((await api("import", { cookie: me.cookie, body: { record: RECORD.replace("Aelric - Forever", "Brakka - Forever") } })).body.switched, null);
});

test("two first imports at once both succeed with one profile", async () => {
  const me = await signIn("aelric");
  const [x, y] = await Promise.all([1, 2].map(() => api("import", { cookie: me.cookie, body: { record: RECORD } })));
  assert.deepEqual([x.status, y.status], [200, 200]);
  assert.equal(await env.DB.prepare("SELECT COUNT(*) AS n FROM profiles").first("n"), 1);
});

test("offCanon: later eras and how-it-was-made wording are caught, unless the record itself has them", () => {
  assert.equal(offCanon("Aelric fought beside King Varian's men."), false);
  assert.equal(offCanon("The road ran north to Darkshore's broken shore."), false);
  assert.equal(offCanon("Aelric sailed to the Broken Shore."), true);
  assert.equal(offCanon("Years later, Aelric would see the Burning Crusade."), true);
  assert.equal(offCanon("Brakka marched on to the Scherbenwelt."), true);
  assert.equal(offCanon("This story was written by an AI."), true);
  assert.equal(offCanon("Diese Geschichte schrieb eine KI."), true);
  assert.equal(offCanon("« J'ai vu pire », grogna Aelric."), false);
  assert.equal(offCanon("Ai, que frio, disse Tiago."), false);
  assert.equal(offCanon("It hasn't happened yet."), true);
  assert.equal(offCanon("Aelric met a draenei.", "People met: Draenei Wanderer"), false);
});

test("the summary story reads well with little or a lot in the record", () => {
  const empty = parseRecord("Journey record: Newbie - Forever\nLevel 1 Gnome Mage, Alliance\n\nNothing recorded yet.\n");
  assert.equal(templateStory(empty), "Newbie is a level 1 Gnome Mage of the Alliance.");
  const full = templateStory(parseRecord(RECORD));
  assert.match(full, /the road has led on through Darnassus, Darkshore, Ashenvale and Wetlands\./);
  assert.match(full, /Along the way Aelric has finished 12 quests and met 7 people, among them Conservator Ilthalaine and Gryan Stoutmantle\./);
  assert.match(full, /Aelric has braved The Deadmines\./);
  assert.match(full, /Mor'Ladim and Edwin VanCleef have fallen to Aelric\./);
  assert.match(full, /Aelric has died 3 times, most often in Darkshore, and got back up every time\./);
  assert.match(full, /Aelric is Honored with Darnassus\./);
  assert.match(full, /Aelric rides a Striped Nightsaber\./);
  assert.equal(full.split("\n\n").length, 3);
  // A record the add-on cut short: no claim about where it began, "at least" for what the lists count.
  const cut = parseRecord(RECORD.replace("Most fought", "Older entries were left out to keep this record short.\n\nMost fought"));
  const story = templateStory(cut);
  assert.match(story, /The latest stretch of the road has led through Teldrassil, Darnassus, Darkshore, Ashenvale and Wetlands\./);
  assert.ok(!story.includes("began"), story);
  assert.match(story, /has died at least 3 times/);
});

test("bad pastes and bad requests get plain answers", async () => {
  const me = await signIn("aelric");
  const cases = [
    [{ record: "" }, 400, /Paste your journey record first/],
    [{ record: "hello" }, 400, /doesn't look like a journey record/],
    [{ record: RECORD + "x".repeat(70000) }, 400, /longer than a journey record/],
    [{}, 400, /Paste your journey record first/],
  ];
  for (const [body, status, error] of cases) {
    const res = await api("import", { cookie: me.cookie, body });
    assert.equal(res.status, status, JSON.stringify(res.body));
    assert.match(res.body.error, error);
  }
  assert.equal((await api("import", { cookie: me.cookie, body: { record: "x".repeat(300000) } })).status, 413);
  // The same without a Content-Length (a streamed body): reading stops at the cap.
  const big = new TextEncoder().encode(JSON.stringify({ record: "x".repeat(300000) }));
  const stream = new ReadableStream({ start(c) { for (let i = 0; i < big.length; i += 16384) c.enqueue(big.slice(i, i + 16384)); c.close(); } });
  const streamed = await profileApi({ env, params: { action: "import" }, request: new Request(`${ORIGIN}/api/profile/import`,
    { method: "POST", body: stream, duplex: "half", headers: { Cookie: me.cookie, Origin: ORIGIN, "Content-Type": "application/json" } }) });
  assert.equal(streamed.status, 413);
  assert.equal((await api("import", { body: { record: RECORD } })).status, 401);
  assert.equal((await api("import", { cookie: me.cookie, body: { record: RECORD }, origin: "https://evil.example" })).status, 403);
  assert.equal((await api("settings", { cookie: me.cookie, body: { public: true } })).status, 404);   // no profile yet
  assert.equal((await api("nope", { cookie: me.cookie })).status, 404);
  assert.equal((await api("me", { method: "GET" })).status, 401);
  assert.equal((await api("me", { cookie: me.cookie, method: "GET" })).body.profile, null);
  assert.equal((await view("<script>")).status, 404);
});

test("names from the record are escaped on the page", async () => {
  const me = await signIn("aelric");
  const tricky = RECORD.replace("Journey record: Aelric", 'Journey record: Ael<script>alert(1)</script>')
    .replace("Gryan Stoutmantle", 'Gor\'kan <the "Tamer">').replace("Cruel Barb", "Blade & <img src=x onerror=alert(1)>");
  const res = await api("import", { cookie: me.cookie, body: { record: tricky } });
  await api("settings", { cookie: me.cookie, body: { public: true } });
  const { html } = await view(res.body.profile.handle);
  assert.equal(res.body.profile.handle, "ael-script-alert-1-scrip");   // 24 characters at most
  assert.ok(!html.includes("<script>alert") && !html.includes("<img src=x"), "nothing from the record runs");
  assert.ok(html.includes("Ael&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("Gor&#39;kan &lt;the &quot;Tamer&quot;&gt;"));
  assert.ok(html.includes("Blade &amp; &lt;img src=x onerror=alert(1)&gt;"));
});

test("Delete my profile, and Delete my account, remove it; /u/me finds yours", async () => {
  const me = await signIn("aelric");
  let res = await profileGet({ request: new Request(`${ORIGIN}/u/me`), env, params: { handle: "me" } });
  assert.equal(res.headers.get("Location"), `${ORIGIN}/account#profile`);
  await api("import", { cookie: me.cookie, body: { record: RECORD } });
  res = await profileGet({ request: new Request(`${ORIGIN}/u/me`, { headers: { Cookie: me.cookie } }), env, params: { handle: "me" } });
  assert.equal(res.headers.get("Location"), `${ORIGIN}/u/aelric`);

  assert.equal((await api("delete", { cookie: me.cookie })).body.profile, null);
  assert.equal(await row(me.user.id), null);
  assert.equal((await view("aelric", me.cookie)).status, 404);

  await api("import", { cookie: me.cookie, body: { record: RECORD } });
  await deleteUser(env, me.user);
  assert.equal(await row(me.user.id), null);
});

test("the admin dashboard lists players with their profile and links", async () => {
  const me = await signIn("aelric");
  await signIn("lurker");
  await env.DB.prepare("UPDATE users SET links = ? WHERE id = ?").bind("https://twitch.tv/aelric", me.user.id).run();
  await api("import", { cookie: me.cookie, body: { record: RECORD } });
  env.DB.sqlite.exec("CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY, user_id TEXT)");   // functions/api/feedback.js makes it
  env.ADMIN_KEY = "admin-test-key";
  try {
    const res = await adminGet({ request: new Request(`${ORIGIN}/api/admin`, { headers: { Authorization: "Bearer admin-test-key" } }), env });
    const { users, stories } = await res.json();
    assert.deepEqual(stories, { month: new Date().toISOString().slice(0, 7), usd: 0, calls: 0, written: 0, budget: 100, on: false,
                                voiceUsd: 0, voiceOn: false });
    const u = users.find(x => x.email === "aelric@example.com");
    assert.deepEqual([u.handle, u.profile_public, u.character, u.char_level, u.char_class, u.links],
      ["aelric", 0, "Aelric", 24, "Druid", "https://twitch.tv/aelric"]);
    assert.equal(users.find(x => x.email === "lurker@example.com").handle, null);
  } finally {
    delete env.ADMIN_KEY;
  }
});

test("the admin dashboard counts sign-ups: accounts, profiles, public ones and new accounts by UTC day", async () => {
  const ago = days => new Date(Date.now() - days * 864e5).toISOString();
  const aelric = await signIn("aelric");
  await api("import", { cookie: aelric.cookie, body: { record: RECORD } });
  await api("settings", { cookie: aelric.cookie, body: { public: true } });
  const other = await signIn("other");
  await api("import", { cookie: other.cookie, body: { record: RECORD } });   // a second profile, still private
  await signIn("lurker");                                                     // an account without one
  // Older accounts: 3 days ago (in the last 7 days), 10 (in the last 30) and 40 (in neither).
  const older = { week: ago(3), month: ago(10), old: ago(40) };
  for (const [sub, created] of Object.entries(older)) {
    const { user } = await signIn(sub);
    await env.DB.prepare("UPDATE users SET created = ? WHERE id = ?").bind(created, user.id).run();
  }
  // More accounts than the users list holds (5000): the counts still see every one.
  env.DB.sqlite.exec("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000) " +
                     "INSERT INTO users (id, created) SELECT 'bulk-' || i, '2020-01-01T00:00:00.000Z' FROM n");
  env.DB.sqlite.exec("CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY, user_id TEXT)");   // functions/api/feedback.js makes it
  env.ADMIN_KEY = "admin-test-key";
  try {
    const res = await adminGet({ request: new Request(`${ORIGIN}/api/admin`, { headers: { Authorization: "Bearer admin-test-key" } }), env });
    const { users, signups: { days, ...counts } } = await res.json();
    assert.equal(users.length, 5000);
    assert.deepEqual(counts, { accounts: 5006, profiles: 2, public: 1, today: 3, week: 4, month: 5 });
    const day = iso => iso.slice(0, 10);
    assert.deepEqual(days, [{ day: day(older.month), n: 1 }, { day: day(older.week), n: 1 },
                            { day: day(new Date().toISOString()), n: 3 }]);
  } finally {
    delete env.ADMIN_KEY;
  }
});

test("voice pages keep their own breadcrumb, footer and player", () => {
  const html = voicePage({ id: "x", name: "X Voice", credit: "Someone", tagline: "Hi." }, 0);
  assert.match(html, /<a href="\/downloads">Downloads<\/a> &rsaquo; X Voice/);
  assert.match(html, /Open the narrator dashboard/);
  assert.match(html, /<script src="\/voices\/player\.js" defer><\/script>/);
  assert.ok(!html.includes('name="robots"'));
});

test("the journey in numbers: miles walked, foes slain, time played and a few lines told for fun (LOR-246)", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const { SITE } = await import("./helpers.mjs");
  const file = `${SITE}tests/fixtures/journey/en.txt`;
  const record = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (!record.includes("Journey stats")) return;   // fixtures not made yet
  const me = await signIn("aelric");
  assert.equal((await api("import", { cookie: me.cookie, body: { record } })).status, 200);
  await api("settings", { cookie: me.cookie, body: { public: true } });
  const { html } = await view("aelric");
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/\s+/g, " ");
  for (const bit of ["The journey in numbers", "71,184 Steps walked 33.7 mi", "192 Foes slain", "7 Elites slain", "3 Rares slain",
    "26 hours Time played", "That's the road from Goldshire to Booty Bay 9.5 times over.", "More than a marathon on foot.",
    "Walked the most in Teldrassil: 25,680 steps.", "192 foes slain, 21 different ones.",
    "The most common kind of foe: Beast (98).", "3 deaths along the way, each one a lesson for Aelric.",
    "1.1 days in Azeroth, all told.", "Where the steps went", "Teldrassil 25,680 steps 12.2 mi", "Distances in miles kilometres", "Foes by kind", "Beast 98"]) {
    assert.ok(text.includes(bit), bit);
  }
  assert.match(html, /<li><strong>3<\/strong><span>Deaths<\/span><\/li>/, "the Deaths tile counts every death");
  assert.match(html, /data-mi="33\.7 mi" data-km="54\.2 km">33\.7 mi</, "miles, and kilometres for the switch");
  assert.match(html, /<p class="pf-units" hidden>[\s\S]*<script src="\/js\/units\.js" defer><\/script>/,
    "the switch shows only with its script");
  assert.ok(!/better than|rank(ed|ing)|top \d|leaderboard/i.test(text), "no comparing with other players");
});

test("the journey in numbers: none for a record from an older add-on, and the page is as before", async () => {
  const me = await signIn("aelric");
  await api("import", { cookie: me.cookie, body: { record: RECORD } });
  const { html } = await view("aelric", me.cookie);
  assert.ok(!html.includes("The journey in numbers") && !html.includes("Steps walked") && !html.includes("units.js"));
  assert.match(html, /<li><strong>3<\/strong><span>Deaths<\/span><\/li>/);
});

test("the journey in numbers: small and edge cases read well", async () => {
  const { funLines, numbersSection, duration } = await import("../lib/profile-stats.js");
  const base = { name: "Brakka", factionKey: "horde", totals: { foes: 3 }, cut: false,
    deaths: [{ zone: "The Barrens" }, { zone: "The Barrens" }, { zone: "The Barrens" }, { zone: "Durotar" }],
    stats: { yards: 4000, slain: 40, elites: 0, rares: 0, deaths: 4, recorded: 0.5, played: null,
      walk: [{ zone: "Durotar", yards: 3000 }, { zone: "The Barrens", yards: 1000 }], kinds: [{ kind: "Beast", n: 30 }] } };
  assert.deepEqual(funLines(base), [
    "That's the whole of the road from Orgrimmar to the Crossroads, and then some.",
    "Walked the most in Durotar: 3,600 steps.",
    "40 foes slain, 3 different ones.",
    "The most common kind of foe: Beast (30).",
    "4 deaths along the way, each one a lesson for Brakka.",
    "The Barrens claimed Brakka 3 times.",
  ]);
  const html = numbersSection(base);
  assert.match(html, /<strong>30 minutes<\/strong><span>Time recorded<\/span>/);
  assert.ok(!html.includes("Elites slain") && !html.includes("Rares slain"), "no empty tiles");
  assert.deepEqual(funLines({ ...base, deaths: [], stats: { ...base.stats, yards: 50, deaths: 0, walk: [] } }),
    ["40 foes slain, 3 different ones.", "The most common kind of foe: Beast (30).", "Not a single death yet."]);
  assert.equal(numbersSection({ ...base, stats: null }), "");
  assert.equal(numbersSection({ ...base, stats: { ...base.stats, yards: 0, slain: 0, recorded: 0 } }), "");
  assert.deepEqual([duration(0.2), duration(1), duration(30), duration(50), duration(72)],
    ["12 minutes", "1 hour", "30 hours", "2 days 2 hours", "3 days"]);
});

test("the journey in numbers, LOR-262: how they traveled, patrons, homes, fish, days, the story's length, on this day", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const { SITE } = await import("./helpers.mjs");
  const { numbersSection, onThisDay, funLines } = await import("../lib/profile-stats.js");
  const file = `${SITE}tests/fixtures/journey/en.txt`;
  if (!existsSync(file) || !readFileSync(file, "utf8").includes("Most loyal patrons")) return;   // fixtures not made yet
  const d = parseRecord(readFileSync(file, "utf8"), new Date("2026-10-04T12:00:00Z"));
  const html = numbersSection(d, new Date("2026-09-29T12:00:00Z"));
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
  for (const bit of ["A week ago today, Aelric defeated Edwin VanCleef.", "The sea took Aelric once.",
    "Most loyal patron: Gershala Nightwhisper, with 4 quests done for them.", "Home is Teldrassil: 14 hours spent there.",
    "Has called Auberdine, Astranaar and Dolanaar home.", "Caught 17 fish.", "Played on 9 days, 6 of them in a row at best.",
    "Aelric's story so far would take about 2 hours to read aloud.", "64 narrations heard along the way.",
    "9 Days played", "17 Fish caught", "How they traveled", "On foot 51,888 steps", "Riding 8.1 mi", "Swimming 1.1 mi",
    "Flying 23.5 mi 7 flights", "By boat 2 crossings", "Where the time went Teldrassil 14 hours",
    "Most loyal patrons Gershala Nightwhisper 4 quests"]) {
    assert.ok(text.includes(bit), bit);
  }
  assert.ok(!text.includes("Nemesis"), "one death to a foe is no nemesis");
  // A month ago and a year ago; nothing on a day without a moment; not from the 31st to a month without one.
  assert.equal(onThisDay(d, new Date("2026-10-22T08:00:00Z")), "A month ago today, Aelric defeated Edwin VanCleef.");
  assert.equal(onThisDay(d, new Date("2027-09-14T20:00:00Z")), "A year ago today, Aelric reached level 6.");
  assert.equal(onThisDay(d, new Date("2026-12-25T12:00:00Z")), null);
  // Famous company and a nemesis.
  const lines = funLines({ name: "Brakka", factionKey: "horde", totals: {}, deaths: [],
    people: [{ name: "Thrall" }, { name: "Lady Jaina Proudmoore" }, { name: "Thrallmar Scout" }, { name: "Gamon" }],
    stats: { yards: 0, slain: 9, kinds: [], walk: [], deaths: 2, killers: [{ name: "Hogger", n: 2 }] } });
  assert.ok(lines.includes("Has met Thrall and Lady Jaina Proudmoore."), lines.join(" | "));
  assert.ok(lines.includes("Nemesis: Hogger, who slew Brakka twice."), lines.join(" | "));
});
