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
//                               should send instead). Identical facts skip delivery but may catch up a due story.
//                               refreshStory:true requests current text inside the automatic cooldown, within the
//                               existing budgets. Current writer input and overlapping requests share one story.
//                               usage? (lib/usage.js readUsage, LOR-413): the add-on's per-day usage counts, kept
//                               per day for /admin; a sync that can't keep them still syncs.
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
  setupProfiles, storyBasis, storyDue, storyKey, sameCharacter, STORIES_PER_DAY, STORY_SYNC_HOURS,
} from "../../../lib/profiles.js";
import { currentDevice, markSynced } from "../../../lib/devices.js";
import { perMinute, perHour, perDay, slowDown } from "../../../lib/ratelimit.js";
import { forgetPictures } from "../../../lib/pictures.js";
import { forgetStoryVoice } from "../../../lib/storyvoice.js";
import { historyRequest, forgetHistoryStatements } from "../../../lib/history.js";
import { readUsage, saveUsage } from "../../../lib/usage.js";

const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });

const IMPORTS_PER_MINUTE = 10;
const SYNCS_PER_MINUTE = 6;    // saves, explicit syncs and due story catch-up all share request limits
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
// companion (sync), returns {other} for another character's record and unchanged:true for delivered identical facts.
// journey: the companion's journey data (readJourney), or undefined to keep what the profile has (a paste, or a
// companion too old to send it); another character's record drops it.
async function saveRecord(env, user, data, { sync = false, refreshStory = false, journey, deviceId } = {}) {
  const old = await profileOf(env, user.id);
  const now = new Date(), stamp = now.toISOString(), dataText = JSON.stringify(data);
  const switched = Boolean(old) && !sameCharacter(old.data, data);
  if (sync && switched) return { other: old };
  const kept = old && !switched ? old : null;
  const keptJourney = journey !== undefined ? journey : kept?.journey ?? null;
  const journeyText = keptJourney ? JSON.stringify(keptJourney) : null;
  const spec = kept?.spec && specsFor(data).includes(kept.spec) ? kept.spec : null;
  const unchanged = Boolean(kept) && JSON.stringify(kept.data) === dataText &&
    (journey === undefined || JSON.stringify(kept.journey) === JSON.stringify(journey));
  const fallback = kept?.story_source === "written" ? kept.story : templateStory(data);
  const source = kept?.story_source === "written" ? "written" : "template";

  // Deliver the facts first. A failed or slow writer must never hold the timeline back.
  if (!unchanged) {
    if (old) {
      if (switched) {
        await env.DB.prepare(
          "UPDATE profiles SET handle = ?, public = 0, data = ?, spec = ?, journey = ?, updated = ?, " +
          "story = ?, story_source = 'template', story_key = NULL, story_basis = NULL, story_at = NULL, " +
          "story_job = NULL, story_job_at = NULL WHERE user_id = ?"
        ).bind(await newHandle(env, data.name), dataText, spec, journeyText, stamp, fallback, user.id).run();
      } else {
        // Keep the live claim and any story completed by another request since our initial read.
        await env.DB.prepare(
          "UPDATE profiles SET data = ?, spec = ?, journey = ?, updated = ?, " +
          "story = CASE WHEN story_source = 'written' THEN story ELSE ? END WHERE user_id = ?" +
          (sync ? " AND data = ?" : "")
        ).bind(dataText, spec, journeyText, stamp, fallback, user.id,
          ...(sync ? [JSON.stringify(old.data)] : [])).run();
      }
    } else {
      for (let attempt = 0; ; attempt++) {
        try {
          await env.DB.prepare(
            "INSERT INTO profiles (user_id, handle, public, spec, data, story, story_source, story_count, " +
            "journey, created, updated) VALUES (?, ?, 0, ?, ?, ?, ?, 0, ?, ?, ?)"
          ).bind(user.id, await newHandle(env, data.name), spec, dataText, fallback, source,
            journeyText, stamp, stamp).run();
          break;
        } catch (e) {
          if (await profileOf(env, user.id)) break;   // another first import won
          if (attempt >= 2) throw e;
        }
      }
    }
  }

  const key = await storyKey(data, spec);
  let current = await profileOf(env, user.id), why = "off", retryAt = 0;
  if (sync && current && !sameCharacter(current.data, data)) return { other: current };
  // A concurrent delivery can win the compare-and-save or first insert. Acknowledge only the
  // facts actually present; otherwise the companion would cache an undelivered payload forever.
  if (sync && (!current || JSON.stringify(current.data) !== dataText ||
      (journey !== undefined && JSON.stringify(current.journey) !== JSON.stringify(journey)))) return { retry: true };
  const result = async () => {
    const profile = await profileOf(env, user.id);
    return { profile, created: !old, switched: switched ? old : null, unchanged,
      story: { source: profile?.story_source || source, why }, storyRetryAt: retryAt };
  };
  const later = () => {
    // No milestone: wait for new facts or an explicit sync. Otherwise revisit unchanged facts when due.
    const eligible = storyDue(current, data, new Date(now.getTime() + STORY_SYNC_HOURS * 3600e3));
    return eligible ? Math.max(now.getTime() + 60000,
      (Date.parse(current?.story_at || "") || now.getTime()) + STORY_SYNC_HOURS * 3600e3) : 0;
  };
  if (current?.story_source === "written" && current.story_key === key) {
    why = "current";
    return result();
  }
  if (!env.GEMINI_API_KEY) return result();
  if (sync && !refreshStory && !storyDue(current, data, now)) {
    why = "later"; retryAt = later(); return result();
  }

  // A database claim works across Worker isolates. Clicks/replays share one writer, and its result
  // is accepted only while the same character facts, spec and claim are still current.
  const job = crypto.randomUUID();
  const claimed = await env.DB.prepare(
    "UPDATE profiles SET story_job = ?, story_job_at = ? WHERE user_id = ? AND data = ? AND " +
    "COALESCE(spec, '') = ? AND (story_key IS NULL OR story_key != ?) AND " +
    "(story_job IS NULL OR story_job_at < ?)"
  ).bind(job, stamp, user.id, dataText, spec || "", key,
    new Date(now.getTime() - 60000).toISOString()).run();
  if (!claimed.meta.changes) {
    current = await profileOf(env, user.id);
    why = current?.story_key === key ? "current" : "pending";
    retryAt = why === "pending" ? now.getTime() + 60000 : 0;
    return result();
  }
  try {
    if (!(await storyBudgetLeft(env))) {
      why = "budget";
      retryAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    } else if (!(await perDay(env, user.id, "story", STORIES_PER_DAY))) {
      why = "daily";
      retryAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    } else {
      await env.DB.prepare("UPDATE profiles SET story_at = ? WHERE user_id = ? AND story_job = ?")
        .bind(stamp, user.id, job).run();
      const written = await writeStory(env, data, spec);
      why = written.why;
      if (written.text) {
        const saved = await env.DB.prepare(
          "UPDATE profiles SET story = ?, story_source = 'written', story_count = story_count + 1, " +
          "story_key = ?, story_basis = ?, updated = ? WHERE user_id = ? AND story_job = ? AND data = ? " +
          "AND COALESCE(spec, '') = ?" +
          (deviceId ? " AND EXISTS (SELECT 1 FROM devices WHERE id = ? AND user_id = ?)" : "")
        ).bind(written.text, key, JSON.stringify(storyBasis(data)), stamp, user.id, job, dataText, spec || "",
          ...(deviceId ? [deviceId, user.id] : [])).run();
        if (!saved.meta.changes) why = "pending"; // newer facts or a disconnected account owns the page now
      }
      if (why !== "written") retryAt = now.getTime() + STORY_SYNC_HOURS * 3600e3;
    }
  } finally {
    await env.DB.prepare("UPDATE profiles SET story_job = NULL, story_job_at = NULL WHERE user_id = ? AND story_job = ?")
      .bind(user.id, job).run();
  }
  return result();
}

async function importRecord({ env }, input, user) {
  if (!(await perMinute(env, user.id, "profile", IMPORTS_PER_MINUTE))) return slowDown();
  const { data, error } = readRecord(input);
  if (error) return error;
  const out = await saveRecord(env, user, data);
  // The page reports separately whether the delivered facts also refreshed the story.
  return ok({ profile: summary(out.profile), created: out.created,
              switched: out.switched ? { from: out.switched.data.name, to: data.name } : null, story: out.story,
              storyRetryAt: out.storyRetryAt });
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
  // Canonical transport labels are independent of the player's chosen story language. Older clients still derive
  // it from their localized record; never accept arbitrary language/prompt text from this field.
  const locales = { enUS: "en", enGB: "en", deDE: "de", frFR: "fr", esES: "es", esMX: "es", ptBR: "pt", ruRU: "ru", ukUA: "uk" };
  if (typeof input.record_locale === "string" && Object.hasOwn(locales, input.record_locale)) data.locale = locales[input.record_locale];
  // The journey data (LOR-248): kept as sent when it reads; an older companion (none) or one that doesn't read keeps
  // what the profile has.
  const journey = readJourney(input.journey, data) ?? undefined;
  const out = await saveRecord(env, user, data, { sync: true, refreshStory: input.refreshStory === true, journey, deviceId: device.id });
  if (out.other) {
    const d = out.other.data;
    return Response.json({ ok: false, error: `Your profile shows ${d.name}${d.realm ? ` (${d.realm})` : ""}, not ` +
      `${data.name}. To show ${data.name} instead, paste their journey record on loreforeverwow.com/account.`,
      profile: { name: d.name, realm: d.realm } }, { status: 409, headers: noStore });
  }
  if (out.retry) {
    return Response.json({ ok: false, retry: true, retryAfter: 1,
      error: "Another journey update arrived at the same time. Your saved journey will retry." },
      { status: 409, headers: { ...noStore, "Retry-After": "1" } });
  }
  await markSynced(env, device.id);
  try { await saveUsage(env, user.id, readUsage(input.usage)); } catch (e) { /* counts never hold up the profile */ }
  return ok({ profile: summary(out.profile), created: out.created, ...(out.unchanged ? { unchanged: true } : {}),
              story: out.story, storyRetryAt: out.storyRetryAt });
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
