// "What Willo keeps" (LOR-666, lib/willo-keeps.js): the page /willo/keeps, and Willo's app catching up with it.
//   GET  /api/keeps/all                      -> {sections, journey, characters, apps, chats_erased, friends, style,
//                                               keep_answers}: everything kept
//   GET  /api/keeps/export                   -> all of it as one markdown file ("Download everything")
//   POST /api/keeps/edit   {section, id, text}   -> {item}: one item changed
//   POST /api/keeps/erase  {section, id}         -> {gone}: one item erased
//   POST /api/keeps/erase-section {section, character?} -> {}: every item of one kind (or one character's)
//   POST /api/keeps/erase-all {confirm: "erase", keep_chats?}  -> {}: everything, and her chats in the app unless
//                                                   keep_chats
//   POST /api/keeps/keep-answers {on}            -> {on}: "Help improve Willo's answers" from the page
//   GET  /api/keeps/changes[?keep_answers=1|0&applied=<at>] -> {changes: {what: at}, settings, learned}: the app's own
//                                                   check (device token only), saying how its switch is. learned:
//                                                   [{id, line}], answers the player reported and asked to hear about,
//                                                   fixed now (lib/answer-feedback.js learnedFor): she says each line
//                                                   once, after her next answer
//   POST /api/keeps/told {ids: [3]}             -> {told: n}: she said those (device token only)
//   POST /api/keeps/cleared {cleared: {what: at}} -> {cleared: [what]}: the app dropped those copies (device token only)
// The page: the session cookie, and our Origin on a POST. Willo's app: X-LF-Client: companion/<version>, no Origin,
// Authorization: Bearer <device token>; it may read and erase too, as the notebook's tab does.

import { setDiagnosticConsent } from "../../../lib/diagnostic-screenshots.js";
import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { perMinute, slowDown } from "../../../lib/ratelimit.js";
import { learnedFor, markTold } from "../../../lib/answer-feedback.js";
import {
  keepsView, keepsExport, editItem, eraseItem, eraseSection, eraseEverything, setKeepAnswers, changesFor, markCleared,
  KeepsError, TEXT_MAX,
} from "../../../lib/willo-keeps.js";
import { isCompanion } from "../../../lib/client-version.js";

const COMPANION = /^companion\/[\w.+-]{1,32}$/;
const MAX_BODY_BYTES = 4 * TEXT_MAX + 1024;
const CHANGES_PER_MINUTE = 60;
const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });

const GETS = {
  all: async ({ env }, { user }) => ok(await keepsView(env, user.id)),
  export: async ({ env }, { user }) => {
    const now = new Date();
    return new Response(await keepsExport(env, user.id, now), { headers: { ...noStore,
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="what-willo-keeps-${now.toISOString().slice(0, 10)}.md"` } });
  },
  changes: async ({ request, env }, { user, app }) => {
    if (!app) return fail(403, "Only Willo's app asks this.");
    const q = new URL(request.url).searchParams;
    const said = q.get("keep_answers");
    // What she's learned is a small read beside the stamps; a failure there never fails the check.
    const [changes, learned] = await Promise.all([changesFor(env, user.id, { keepAnswers: said === "1" ? true
      : said === "0" ? false : null, applied: q.get("applied") || "" }), learnedFor(env, user.id).catch(() => [])]);
    return ok({ ...changes, learned: learned.map(({ id, line }) => ({ id, line })) });
  },
};

const POSTS = {
  "keep-screenshots": async ({ env }, input, { user, app }) => {
    if (typeof input.on !== "boolean") throw new KeepsError("Choose on or off.");
    // Turning it on is the player's own choice on the page; the app may only turn it off (the privacy review, 10/21).
    if (input.on && app) throw new KeepsError("Turn this on from What Willo keeps on the site.");
    try { return ok({ on: await setDiagnosticConsent(env, user.id, input.on) }); }
    catch (e) { throw new KeepsError(e.message); }
  },
  edit: async ({ env }, input, { user }) => ok({ item: await editItem(env, user.id, input) }),
  erase: async ({ env }, input, { user }) => ok({ gone: await eraseItem(env, user.id, input) }),
  "erase-section": async ({ env }, input, { user }) => { await eraseSection(env, user.id, input); return ok(); },
  "keep-answers": async ({ env }, input, { user }) => ok({ on: await setKeepAnswers(env, user.id, input.on) }),
  "erase-all": async ({ env }, input, { user }) => {
    if (input.confirm !== "erase") return fail(400, "Confirm first.");
    await eraseEverything(env, user.id, { keepChats: input.keep_chats === true });
    return ok();
  },
  told: async ({ env }, input, { user, app }) => app
    ? ok({ told: await markTold(env, user.id, input.ids) })
    : fail(403, "Only Willo's app says this."),
  cleared: async ({ env }, input, { user, app }) => app
    ? ok({ cleared: await markCleared(env, app.device, user.id, input.cleared) })
    : fail(403, "Only Willo's app says this."),
};

async function readJson(request) {
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { error: fail(413, "That's too long.") };
    const input = JSON.parse(text || "{}");
    return input && typeof input === "object" && !Array.isArray(input) ? { input } : { error: fail(400, "Couldn't read that.") };
  } catch (e) { return { error: fail(400, "Couldn't read that.") }; }
}

// The account behind the request: Willo's app by its token, or our page by its session.
async function who(env, request) {
  if (isCompanion(request.headers.get("X-LF-Client"), { loose: true }) && !request.headers.get("Origin")) {
    const app = await currentDevice(env, request);
    return app ? { user: app.user, app } : null;
  }
  if (request.method === "POST" && !sameOrigin(request)) return null;
  const user = await currentUser(env, request);
  return user ? { user, app: null } : null;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const action = String(params.action);
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  const table = request.method === "GET" ? GETS : request.method === "POST" ? POSTS : null;
  if (!table) return fail(405, "Use GET or POST.");
  if (!Object.hasOwn(table, action)) return fail(404, "Not found.");
  await setup(env);
  const caller = await who(env, request);
  if (!caller) return fail(401, "You're signed out. Please sign in again.");
  try {
    if (request.method === "GET") return await table[action](context, caller);
    if (!(await perMinute(env, caller.user.id, "keeps-change", CHANGES_PER_MINUTE))) return slowDown();
    const { input, error } = await readJson(request);
    return error || await table[action](context, input, caller);
  } catch (e) {
    if (e instanceof KeepsError) return fail(e.status, e.message);
    throw e;
  }
}
