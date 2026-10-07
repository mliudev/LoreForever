// Player profiles (lib/profiles.js, LOR-181), used by /account and the owner's bar on /u/<handle>:
//   GET  /api/profile/me        {profile}: yours (null when you have none yet), or 401 when signed out
//   POST /api/profile/import    {record}: a pasted journey record -> creates or updates your profile, writes its story.
//                               Another character's record replaces the profile, private again at a new address
//                               ({switched: {from, to}} says so).
//   POST /api/profile/sync      {record, journey?}: the same record, sent by the companion app after a /reload or logout
//                               (LOR-148), and its journey data (lib/journey.js readJourney, LOR-248: when each moment
//                               happened, with game IDs; kept in its own column, and a paste of the same character
//                               keeps it), with its token as "Authorization: Bearer <token>" (lib/devices.js) instead
//                               of a session. Creates or updates the profile like an import, except: it never switches
//                               to another character (409 with {profile: {name, realm}}, the character the companion
//                               should send instead), a record that hasn't changed changes nothing ({unchanged: true}),
//                               and the story is written only now and then (lib/profiles.js storyDue; story.why
//                               "later" when it wasn't due).
//   POST /api/profile/settings  {public?, spec?, handle?}: whether anyone with the link can see it, your favorite
//                               spec, its address (/u/<handle>)
//   POST /api/profile/delete    removes your profile and its pictures, and disconnects your connected apps (your account
//                               stays)
// The picture book has its own API: functions/api/profile/pictures/ (lib/pictures.js).
// Every POST from a page must come from our own pages (Origin check), sends JSON and needs a session; sync comes from
// the companion (X-LF-Client: companion/<version>, no Origin) with its token.

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { parseRecord, readJourney, RecordError } from "../../../lib/journey.js";
import {
  profileOf, profileByHandle, newHandle, validHandle, specsFor, templateStory, writeStory, storyBudgetLeft, sheetLine,
  setupProfiles, storyBasis, storyDue, sameCharacter, STORIES_PER_DAY,
} from "../../../lib/profiles.js";
import { currentDevice, markSynced } from "../../../lib/devices.js";
import { perMinute, perHour, perDay, slowDown } from "../../../lib/ratelimit.js";
import { forgetPictures } from "../../../lib/pictures.js";
import { forgetStoryVoice } from "../../../lib/storyvoice.js";
import { historyRequest, forgetHistoryStatements } from "../../../lib/history.js";

const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });

const IMPORTS_PER_MINUTE = 10;
const SYNCS_PER_MINUTE = 6;    // the companion sends only after a save, and only when the record changed
const SYNCS_PER_HOUR = 60;
// A record is at most 64 KB (lib/journey.js), its JSON not much more than twice that; the companion keeps its journey
// data under 96 KB (companion/lore_companion/profile.py JOURNEY_BYTES).
const MAX_BODY = 256 * 1024;
const RECORD_ERRORS = {
  "empty": "Paste your journey record first: in game, open Journey, click Copy my journey record and press Ctrl+C.",
  "too-big": "That's longer than a journey record. Copy it again in game and paste just that.",
  "not-a-record": "That doesn't look like a journey record. In game, open Journey, click Copy my journey record, " +
                  "press Ctrl+C, then paste it here.",
};

// What /account (and the companion) shows about your profile.
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

function readRecord(input) {
  try {
    return { data: parseRecord(input.record) };
  } catch (e) {
    if (e instanceof RecordError) return { error: fail(400, RECORD_ERRORS[e.message] || RECORD_ERRORS["not-a-record"]) };
    throw e;
  }
}

// Creates or updates the account's profile from a record's facts, and writes its story when it should. From the
// companion (sync), returns {other} for another character's record and {unchanged} for the same facts, saving nothing.
// journey: the companion's journey data (readJourney), or undefined to keep what the profile has (a paste, or a
// companion too old to send it); another character's record drops it.
async function saveRecord(env, user, data, { sync = false, journey } = {}) {
  const old = await profileOf(env, user.id);
  const now = new Date();
  // Another character: the profile becomes theirs, private again and at their own address, so a page the player
  // shared never turns into a different character's. Only a paste does that.
  const switched = Boolean(old) && !sameCharacter(old.data, data);
  if (sync && switched) return { other: old };
  if (sync && old && JSON.stringify(old.data) === JSON.stringify(data) &&
      (journey === undefined || JSON.stringify(old.journey) === JSON.stringify(journey))) return { unchanged: old };
  const keptJourney = journey !== undefined ? journey : (old && !switched ? old.journey : null);
  const journeyText = keptJourney ? JSON.stringify(keptJourney) : null;
  // A favorite spec stays while it's the same character and still fits the class.
  const spec = old && !switched && old.spec && specsFor(data).includes(old.spec) ? old.spec : null;
  const kept = old && !switched ? old : null;   // what carries over: the same character's profile

  // The story: written while this month's budget lasts (lib/profiles.js), and each try counts against the account's
  // allowance for today (it costs whether or not it works). An update from the companion tries only when one is due.
  // Otherwise the last written one stays if it's about the same character, or the record's summary takes its place.
  let written = null, why = "off", tried = false;
  if (env.GEMINI_API_KEY) {
    if (sync && !storyDue(kept, data, now)) why = "later";
    else if (!(await storyBudgetLeft(env))) why = "budget";
    else if (!(await perDay(env, user.id, "story", STORIES_PER_DAY))) why = "daily";
    else { ({ text: written, why } = await writeStory(env, data, spec)); tried = true; }
    if (why === "budget" || why === "daily") console.warn(`profile story: ${why}`);
  }
  let story, source, basis = null;
  if (written) [story, source, basis] = [written, "written", JSON.stringify(storyBasis(data))];
  else if (kept?.story_source === "written") [story, source, basis] = [kept.story, "written", kept.story_basis ?? null];
  else [story, source] = [templateStory(data), "template"];
  const storyCount = (old?.story_count || 0) + (written ? 1 : 0);
  const storyAt = tried ? now.toISOString() : kept?.story_at ?? null;
  const stamp = now.toISOString();

  const update = (handle, isPublic) => env.DB.prepare(
    "UPDATE profiles SET handle = ?, public = ?, data = ?, spec = ?, story = ?, story_source = ?, story_count = ?, " +
    "story_at = ?, story_basis = ?, journey = ?, updated = ? WHERE user_id = ?"
  ).bind(handle, isPublic, JSON.stringify(data), spec, story, source, storyCount, storyAt, basis, journeyText, stamp,
         user.id).run();

  if (old) {
    await update(switched ? await newHandle(env, data.name) : old.handle, switched ? 0 : old.public);
  } else {
    // Two first imports at once: the same address (try the next one), or the same account (the other one won).
    for (let attempt = 0; ; attempt++) {
      try {
        await env.DB.prepare(
          "INSERT INTO profiles (user_id, handle, public, spec, data, story, story_source, story_count, story_at, " +
          "story_basis, journey, created, updated) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(user.id, await newHandle(env, data.name), spec, JSON.stringify(data), story, source, storyCount, storyAt,
               basis, journeyText, stamp, stamp).run();
        break;
      } catch (e) {
        const theirs = await profileOf(env, user.id);
        if (theirs) { await update(theirs.handle, theirs.public); break; }
        if (attempt >= 2) throw e;
      }
    }
  }
  return { profile: await profileOf(env, user.id), created: !old, switched: switched ? old : null, story: { source, why } };
}

async function importRecord({ env }, input, user) {
  if (!(await perMinute(env, user.id, "profile", IMPORTS_PER_MINUTE))) return slowDown();
  const { data, error } = readRecord(input);
  if (error) return error;
  const out = await saveRecord(env, user, data);
  // story: which story the profile has now, and why (lib/profiles.js writeStory; budget, daily or off when none was
  // tried). For checking, not shown to the player.
  return ok({ profile: summary(out.profile), created: out.created,
              switched: out.switched ? { from: out.switched.data.name, to: data.name } : null, story: out.story });
}

// From the companion app (LOR-148): its token, not a session.
async function sync({ env }, input, { user, device }) {
  if (!(await perMinute(env, user.id, "profile-sync", SYNCS_PER_MINUTE))) return slowDown();
  if (!(await perHour(env, user.id, "profile-sync-hour", SYNCS_PER_HOUR))) {
    const retryAfter = 3600 - (Math.floor(Date.now() / 1000) % 3600);
    return Response.json({ ok: false, error: "Too many updates this hour.", retryAfter },
      { status: 429, headers: { ...noStore, "Retry-After": String(retryAfter) } });
  }
  const { data, error } = readRecord(input);
  if (error) return error;
  // The journey data (LOR-248): kept as sent when it reads; an older companion (none) or one that doesn't read keeps
  // what the profile has.
  const journey = readJourney(input.journey, data) ?? undefined;
  const out = await saveRecord(env, user, data, { sync: true, journey });
  if (out.other) {
    const d = out.other.data;
    return Response.json({ ok: false, error: `Your profile shows ${d.name}${d.realm ? ` (${d.realm})` : ""}, not ` +
      `${data.name}. To show ${data.name} instead, paste their journey record on loreforeverwow.com/account.`,
      profile: { name: d.name, realm: d.realm } }, { status: 409, headers: noStore });
  }
  await markSynced(env, device.id);
  if (out.unchanged) return ok({ profile: summary(out.unchanged), unchanged: true });
  return ok({ profile: summary(out.profile), created: out.created, story: out.story });
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

// Connected apps go too: a companion still connected would make the profile again after the next /reload. So do the
// pictures of its picture book (lib/pictures.js) and its story's recordings (lib/storyvoice.js), files and all.
async function remove({ env }, input, user) {
  await forgetPictures(env, user.id);
  await forgetStoryVoice(env, user.id);
  await env.DB.batch([
    ...forgetHistoryStatements(env, user.id),
    env.DB.prepare("DELETE FROM profiles WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM devices WHERE user_id = ?").bind(user.id),
  ]);
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

async function readJson(request) {
  try {
    const text = await readCapped(request, MAX_BODY);
    if (text === null) return { error: fail(413, RECORD_ERRORS["too-big"]) };
    const input = JSON.parse(text);
    return input && typeof input === "object" ? { input } : { error: fail(400, "Couldn't read that.") };
  } catch (e) {
    return { error: fail(400, "Couldn't read that.") };
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const action = String(params.action);
  if (!env.DB) return fail(503, "Profiles aren't set up yet.");
  await setup(env);
  if (action === "history") return historyRequest(context);
  await setupProfiles(env);
  if (request.method === "GET") {
    if (action !== "me") return fail(404, "Not found.");
    const user = await currentUser(env, request);
    return user ? me(context, user) : fail(401, "You're signed out. Please sign in again.");
  }
  if (request.method !== "POST") return fail(405, "Use POST.");
  if (action === "sync") {
    // The companion, not a browser: it sends no Origin. (A page elsewhere would need the app's token, and couldn't
    // send it without a preflight we never answer.)
    if (request.headers.get("Origin") && !sameOrigin(request)) return fail(403, "Please use the companion app.");
    const app = await currentDevice(env, request);
    if (!app) return fail(401, "This app isn't connected to an account. Connect it again from the companion.");
    const { input, error } = await readJson(request);
    return error || sync(context, input, app);
  }
  if (!POSTS[action]) return fail(404, "Not found.");
  if (!sameOrigin(request)) return fail(403, "Please use the form on loreforeverwow.com.");
  const user = await currentUser(env, request);
  if (!user) return fail(401, "You're signed out. Please sign in again.");
  const { input, error } = await readJson(request);
  return error || POSTS[action](context, input, user);
}
