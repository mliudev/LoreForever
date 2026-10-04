// Player profiles (lib/profiles.js, LOR-181), used by /account and the owner's bar on /u/<handle>:
//   GET  /api/profile/me        {profile}: yours (null when you have none yet), or 401 when signed out
//   POST /api/profile/import    {record}: a pasted journey record -> creates or updates your profile, writes its story.
//                               Another character's record replaces the profile, private again at a new address
//                               ({switched: {from, to}} says so).
//   POST /api/profile/settings  {public?, spec?, handle?}: whether anyone with the link can see it, your favorite
//                               spec, its address (/u/<handle>)
//   POST /api/profile/delete    removes your profile (your account stays)
// Every POST must come from our own pages (Origin check), sends JSON and needs a session.

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { parseRecord, RecordError } from "../../../lib/journey.js";
import {
  profileOf, profileByHandle, newHandle, validHandle, specsFor, templateStory, writeStory, storyBudgetLeft, sheetLine,
  STORIES_PER_DAY,
} from "../../../lib/profiles.js";
import { perMinute, perDay, slowDown } from "../../../lib/ratelimit.js";

const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });

const IMPORTS_PER_MINUTE = 10;
const MAX_BODY = 160 * 1024;   // a record is at most 64 KB (lib/journey.js); its JSON can't be much more than twice that
const RECORD_ERRORS = {
  "empty": "Paste your journey record first: in game, open Journey, click Copy my journey record and press Ctrl+C.",
  "too-big": "That's longer than a journey record. Copy it again in game and paste just that.",
  "not-a-record": "That doesn't look like a journey record. In game, open Journey, click Copy my journey record, " +
                  "press Ctrl+C, then paste it here.",
};

// What /account shows about your profile.
function summary(p) {
  if (!p) return null;
  const d = p.data;
  return {
    handle: p.handle, url: "/u/" + p.handle, public: Boolean(p.public), spec: p.spec || "", specs: specsFor(d),
    name: d.name, realm: d.realm, sheet: sheetLine(d), faction: d.faction, totals: d.totals, created: p.created,
    updated: p.updated,
  };
}

async function me({ env }, user) {
  return ok({ profile: summary(await profileOf(env, user.id)) });
}

async function importRecord({ env }, input, user) {
  if (!(await perMinute(env, user.id, "profile", IMPORTS_PER_MINUTE))) return slowDown();
  let data;
  try {
    data = parseRecord(input.record);
  } catch (e) {
    if (e instanceof RecordError) return fail(400, RECORD_ERRORS[e.message] || RECORD_ERRORS["not-a-record"]);
    throw e;
  }
  const old = await profileOf(env, user.id);
  const now = new Date().toISOString();
  // Another character: the profile becomes theirs, private again and at their own address, so a page the player
  // shared never turns into a different character's.
  const switched = Boolean(old) && !(old.data.name === data.name && old.data.realm === data.realm);
  // A favorite spec stays while it's the same character and still fits the class.
  const spec = old && !switched && old.spec && specsFor(data).includes(old.spec) ? old.spec : null;

  // The story: written while this month's budget lasts (lib/profiles.js), and each try counts against the account's
  // allowance for today (it costs whether or not it works). Otherwise the last written one stays if it's about the
  // same character, or the record's summary takes its place.
  let written = null, why = "off";
  if (env.GEMINI_API_KEY) {
    if (!(await storyBudgetLeft(env))) why = "budget";
    else if (!(await perDay(env, user.id, "story", STORIES_PER_DAY))) why = "daily";
    else ({ text: written, why } = await writeStory(env, data, spec));
    if (why === "budget" || why === "daily") console.warn(`profile story: ${why}`);
  }
  let story, source;
  if (written) [story, source] = [written, "written"];
  else if (old && !switched && old.story_source === "written") [story, source] = [old.story, "written"];
  else [story, source] = [templateStory(data), "template"];
  const storyCount = (old?.story_count || 0) + (written ? 1 : 0);

  const update = (handle, isPublic) => env.DB.prepare(
    "UPDATE profiles SET handle = ?, public = ?, data = ?, spec = ?, story = ?, story_source = ?, story_count = ?, " +
    "updated = ? WHERE user_id = ?"
  ).bind(handle, isPublic, JSON.stringify(data), spec, story, source, storyCount, now, user.id).run();

  if (old) {
    await update(switched ? await newHandle(env, data.name) : old.handle, switched ? 0 : old.public);
  } else {
    // Two first imports at once: the same address (try the next one), or the same account (the other one won).
    for (let attempt = 0; ; attempt++) {
      try {
        await env.DB.prepare(
          "INSERT INTO profiles (user_id, handle, public, spec, data, story, story_source, story_count, created, updated) " +
          "VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(user.id, await newHandle(env, data.name), spec, JSON.stringify(data), story, source, storyCount, now, now).run();
        break;
      } catch (e) {
        const theirs = await profileOf(env, user.id);
        if (theirs) { await update(theirs.handle, theirs.public); break; }
        if (attempt >= 2) throw e;
      }
    }
  }
  // story: which story the profile has now, and why (lib/profiles.js writeStory; budget, daily or off when none was
  // tried). For checking, not shown to the player.
  return ok({ profile: summary(await profileOf(env, user.id)), created: !old,
              switched: switched ? { from: old.data.name, to: data.name } : null, story: { source, why } });
}

async function settings({ env }, input, user) {
  const p = await profileOf(env, user.id);
  if (!p) return fail(404, "You don't have a profile yet. Paste your journey record first.");
  const isPublic = input.public === undefined ? p.public : (input.public === true ? 1 : 0);
  let spec = p.spec;
  if (input.spec !== undefined) {
    spec = String(input.spec || "").trim() || null;
    if (spec && !specsFor(p.data).includes(spec)) return fail(400, "Pick one of your class's specs.");
  }
  // A new address: links to the old one stop working, which is the owner's call.
  let handle = p.handle;
  if (input.handle !== undefined && String(input.handle).trim().toLowerCase() !== p.handle) {
    handle = String(input.handle).trim().toLowerCase();
    if (!validHandle(handle)) return fail(400, "Use 3 to 24 letters, numbers or dashes (no dash at either end).");
    if (await profileByHandle(env, handle)) return fail(409, "That address is taken. Try another.");
  }
  try {
    await env.DB.prepare("UPDATE profiles SET public = ?, spec = ?, handle = ? WHERE user_id = ?")
      .bind(isPublic, spec, handle, user.id).run();
  } catch (e) {
    return fail(409, "That address is taken. Try another.");   // taken a moment ago (handle is UNIQUE)
  }
  return ok({ profile: summary(await profileOf(env, user.id)) });
}

async function remove({ env }, input, user) {
  await env.DB.prepare("DELETE FROM profiles WHERE user_id = ?").bind(user.id).run();
  return ok({ profile: null });
}

const POSTS = { import: importRecord, settings, delete: remove };

// The request body as text, or null once it's longer than `max` bytes (stops reading there, Content-Length or not).
async function readCapped(request, max) {
  if (Number(request.headers.get("Content-Length") || 0) > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const action = String(params.action);
  if (!env.DB) return fail(503, "Profiles aren't set up yet.");
  await setup(env);
  if (request.method === "GET") {
    if (action !== "me") return fail(404, "Not found.");
    const user = await currentUser(env, request);
    return user ? me(context, user) : fail(401, "You're signed out. Please sign in again.");
  }
  if (request.method !== "POST") return fail(405, "Use POST.");
  if (!POSTS[action]) return fail(404, "Not found.");
  if (!sameOrigin(request)) return fail(403, "Please use the form on loreforeverwow.com.");
  const user = await currentUser(env, request);
  if (!user) return fail(401, "You're signed out. Please sign in again.");
  let input;
  try {
    const text = await readCapped(request, MAX_BODY);
    if (text === null) return fail(413, RECORD_ERRORS["too-big"]);
    input = JSON.parse(text);
  } catch (e) {
    return fail(400, "Couldn't read that.");
  }
  if (!input || typeof input !== "object") return fail(400, "Couldn't read that.");
  return POSTS[action](context, input, user);
}
