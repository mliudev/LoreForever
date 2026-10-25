// The home page's book (GET /api/home-book, lib/home-book.js): the add-on's Chronicle with its four bookmarks, filled
// from one real public profile, and the frame that shows that profile's page under it (/u/<handle>?preview=1). What a
// visitor to the home page gets is that profile's own record, so these go through the real Functions with a profile
// made the way a player makes one (paste a journey record, make it public), and the site's own lore files behind
// ASSETS. D1 is node:sqlite (helpers.mjs). Run: node --test 'site/tests/*.test.mjs'
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestGet as bookGet } from "../functions/api/home-book.js";
import { onRequest as profileApi } from "../functions/api/profile/[action].js";
import { onRequestGet as profileGet } from "../functions/u/[handle].js";
import { onRequest as middleware } from "../functions/_middleware.js";
import { findOrCreateUser, startSession, setup } from "../lib/accounts.js";
import { setupStoryVoice } from "../lib/storyvoice.js";
import { countSite } from "../lib/usage.js";
import { HERE, CHAPTERS } from "../lib/home-book-data.js";
import { d1, SITE } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
// The site's own static files, as Pages serves them.
const ASSETS = { async fetch(url) {
  try { return new Response(readFileSync(`${SITE}public${new URL(url).pathname}`)); } catch (e) { return new Response("", { status: 404 }); }
} };
const env = { DB: d1(), HOME_BOOK_HANDLE: "aelric", ASSETS };
const STORY = "Aelric has walked a long way.\n\nIn the Deadmines he stood against VanCleef and walked out again.\n\nFew now doubt his resolve.";

beforeEach(async () => {
  await setup(env);
  await setupStoryVoice(env);
  await countSite(env, []);   // its table
  for (const table of ["profiles", "sessions", "users", "story_audio", "site_counts"]) env.DB.sqlite.exec(`DELETE FROM ${table}`);
});

// A player with a profile made from the journey fixture, and a written story; public or not.
async function player({ isPublic = true } = {}) {
  const user = await findOrCreateUser(env, { email: "aelric@example.com", googleSub: "aelric", name: "Real Name" });
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  const call = async (action, body) => (await profileApi({
    request: new Request(`${ORIGIN}/api/profile/${action}`, { method: "POST", body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGIN } }), env, params: { action } })).json();
  const made = await call("import", { record: readFileSync(new URL("./fixtures/journey/en.txt", import.meta.url), "utf8") });
  assert.ok(made.ok, JSON.stringify(made));
  if (isPublic) await call("settings", { public: true });
  await env.DB.prepare("UPDATE profiles SET story = ?, story_source = 'written' WHERE user_id = ?").bind(STORY, user.id).run();
  return user;
}

const book = async (e = env) => {
  const res = await bookGet({ request: new Request(`${ORIGIN}/api/home-book`), env: e, waitUntil() {} });
  return { status: res.status, body: await res.json() };
};
const record = () => JSON.parse(env.DB.sqlite.prepare("SELECT data FROM profiles").get().data);
// The page as a browser gets it: through the middleware, which adds the site's headers.
const page = query => {
  const request = new Request(`${ORIGIN}/u/aelric${query}`);
  return middleware({ request, env, next: () => profileGet({ request, env, params: { handle: "aelric" }, waitUntil() {} }) });
};

test("the book is the profile's own record: its road newest first, its finds zone by zone, its storylines", async () => {
  await player();
  const { status, body } = await book();
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.name, "Aelric");

  assert.ok(body.chapters.length > 1, "the road has chapters");
  const numbers = body.chapters.map(c => c.n);
  assert.deepEqual(numbers, [...numbers].sort((a, b) => b - a), "the newest chapter first, as the profile reads");
  for (const c of body.chapters) {
    assert.ok(c.title && c.when && c.summary, `chapter ${c.n} says where, when and what happened`);
    assert.ok(Array.isArray(c.found) && Array.isArray(c.pictures));
  }

  // Found: a chapter for each zone the record went through, its pages by kind.
  const d = record();
  assert.ok(body.found.zones.length > 1, "more than one zone has pages found");
  for (const z of body.found.zones) {
    assert.equal(z.n, z.places.n + z.people.n + z.quests.n + z.items.n, `${z.name}: its pages are its kinds' pages`);
    for (const k of ["places", "people", "items", "quests"]) assert.ok(z[k].of >= z[k].n, `${z.name}: never fewer ${k} than found`);
  }
  // Out of the add-on's own pages there ("Places 2 of 22"), as its Found tab counts them.
  const westfall = body.found.zones.find(z => z.name === "Westfall");
  assert.equal(westfall.places.of, CHAPTERS.Westfall.places);
  assert.equal(westfall.people.of, CHAPTERS.Westfall.people);
  const met = new Set(d.people.map(p => p.name));
  assert.ok(body.found.zones.flatMap(z => z.people.list).some(p => met.has(p.name)), "the people it met are in it");

  // Storylines: only quests the record finished, each under the storyline the lore says it's part of.
  const done = new Set(d.quests.map(q => q.title));
  const links = JSON.parse(readFileSync(`${SITE}public/lore/data/links.json`, "utf8"));
  assert.ok(body.storylines.length > 0, "the record's quests are on storylines");
  for (const s of body.storylines) {
    assert.equal(s.n, s.quests.length);
    assert.ok(s.of >= s.n, `${s.name}: never fewer pages than found`);
    for (const q of s.quests) {
      assert.ok(done.has(q.name), `${q.name} was finished`);
      const sl = links.quests.filter(([title]) => title === q.name).map(x => x[4]).filter(Boolean);
      assert.ok(sl.some(n => links.storylines[n - 1]?.[0] === s.name), `${q.name} is part of ${s.name}`);
    }
  }
});

test("Here is the add-on's Here for a place: its story with the site's own recording, and the add-on's answers", async () => {
  await player();
  const { body } = await book();
  assert.equal(body.here.name, HERE.name);
  assert.ok(body.here.story.length > 0, "the place's story is there to read");
  assert.match(body.here.voice.url, /^\/audio\/clip\//, "Listen plays one of the site's own clips");
  assert.ok(body.here.asks.length > 0);
  for (const a of body.here.asks) {
    assert.ok(a.q && a.a, "a question and its answer");
    for (const l of a.links) assert.ok(a.a.includes(l.name) && l.href.startsWith("/lore/"), `${l.name} is named and has a page`);
  }

  // Without the lore files (a broken deploy), the questions stay and Listen goes.
  const bare = await book({ ...env, ASSETS: undefined });
  assert.equal(bare.body.here.voice, null);
  assert.deepEqual(bare.body.here.asks, body.here.asks);
});

test("the home page's frame of the page: only this site may frame it, and it isn't counted as a view", async () => {
  await player();
  const views = () => env.DB.sqlite.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM site_counts WHERE metric = 'profile.view'").get().n;

  const framed = await page("?preview=1");
  assert.equal(framed.status, 200);
  assert.equal(framed.headers.get("X-Frame-Options"), "SAMEORIGIN");
  assert.match(framed.headers.get("Content-Security-Policy"), /frame-ancestors 'self'/);
  assert.doesNotMatch(framed.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  assert.equal(views(), 0, "the home page showing it is no visit");

  const own = await page("");
  assert.equal(own.headers.get("X-Frame-Options"), "DENY", "the page itself is never framed");
  assert.match(own.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  assert.equal(views(), 1);
});

test("a profile that isn't public, or isn't there, gives no book and no frame", async () => {
  assert.equal((await book()).status, 404, "no such profile");
  await player({ isPublic: false });
  const hidden = await book();
  assert.equal(hidden.status, 404, "private stays private");
  assert.deepEqual(hidden.body, { ok: false });
  assert.equal((await page("?preview=1")).status, 404);
});
