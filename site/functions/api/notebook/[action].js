// Willo's notebook (lib/willo-notebook.js): the companion's Notebook tab, on the PC, the Mac and the iPhone.
//   GET  /api/notebook/pages                   -> {pages: [{page, title, body, version, updated, undo?}]}: the account's
//                                                 page first, then the newest
//   GET  /api/notebook/export                  -> every page as one markdown file (their copy of it)
//   POST /api/notebook/save   {page, body, version}  a page as the player wrote it, if it's still the version they
//                                                 edited (0 for a new one) -> {page}; 409 {error, page: the newer one}
//   POST /api/notebook/undo   {page, version}  the page before its last change (Willo's or theirs) -> {page}
//   POST /api/notebook/delete {page}           a page gone, for a character they no longer play -> {pages}
//   GET  /api/notebook/reminders               -> {reminders}: those not said yet, and those said in the last week
//                                                 ({id, page, text, kind: place|level|time, place?, level?, at?, created,
//                                                 fired?}; LOR-663)
//   POST /api/notebook/fire   {id}             Willo said it: -> {fired}, true only for the first device to say so
//   POST /api/notebook/cancel {id}             a reminder gone -> {reminders}
//   POST /api/notebook/erase                   every page and every reminder ("What Willo keeps", LOR-666) -> {}
//   POST /api/notebook/goals  {character, stock}  after a save in the game: how their goals stand (lib/willo-goals.js
//                                                 goalChecks, LOR-665) -> {checks: [{goal, page, reached, mark, line}],
//                                                 pages: the pages a reached goal was ticked on}. Hero and up while
//                                                 plans are sold (none on the free plan: {checks: []}); costs no answer
// page: "account", or "char:<Name-Realm>" (the add-on's key for the character). Willo writes in it herself from her
// answers (functions/api/companion/answer.js); this is for reading it and editing it by hand.
// From the companion: X-LF-Client: companion/<version>, no Origin, Authorization: Bearer <device token>. From our
// pages: the session cookie, and our Origin on a POST.

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { perMinute, slowDown } from "../../../lib/ratelimit.js";
import { pageOf, allPages, savePage, undoPage, deletePage, allReminders, fireReminder, cancelReminder, eraseNotebook,
  readNotebook, notebookView, plannedChange, NotebookError, PAGE_BYTES } from "../../../lib/willo-notebook.js";
import { stockOf, goalsOf, goalChecks } from "../../../lib/willo-goals.js";
import { planFor, plansOn } from "../../../lib/billing.js";
import { trialFor } from "../../../lib/best-first.js";

const COMPANION = /^companion\/[\w.-]{1,24}$/;
// A whole page, JSON-escaped: escaping can grow it, so twice the page and room for the rest.
const MAX_BODY_BYTES = 2 * PAGE_BYTES + 1024;
const SAVES_PER_MINUTE = 30;
const GOAL_CHECKS_PER_MINUTE = 12;   // one a save in the game; a burst of /reloads stays well under it
const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });

// Every page as one markdown file: a heading per page, its own words under it.
function exported(pages, now) {
  const parts = [`# Willo's notebook\n\nYour notebook as of ${now.toISOString().slice(0, 10)}.`];
  for (const p of pages) {
    const realm = p.page.startsWith("char:") ? p.page.slice(5).split("-").slice(1).join("-") : "";
    parts.push(`---\n\n# ${p.title}${realm ? ` (${realm})` : ""}\n\n${p.body.trim() || "_Empty._"}`);
  }
  return parts.join("\n\n") + "\n";
}

const GETS = {
  pages: async ({ env }, user) => ok({ pages: await allPages(env, user.id) }),
  reminders: async ({ env }, user) => ok({ reminders: await allReminders(env, user.id) }),
  export: async ({ env }, user) => {
    const now = new Date();
    return new Response(exported(await allPages(env, user.id), now), { headers: { ...noStore,
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="willo-notebook-${now.toISOString().slice(0, 10)}.md"` } });
  },
};

const page = input => pageOf(input.page);
const REMINDER_ID = /^[0-9a-f]{16}$/;
const POSTS = {
  save: async ({ env }, input, user) => {
    if (!(await perMinute(env, user.id, "notebook-save", SAVES_PER_MINUTE))) return slowDown();
    if (!page(input)) return fail(400, "Couldn't tell which page that is.");
    return ok({ page: await savePage(env, user.id, page(input), input.body, input.version) });
  },
  undo: async ({ env }, input, user) => {
    if (!(await perMinute(env, user.id, "notebook-save", SAVES_PER_MINUTE))) return slowDown();
    if (!page(input) || !Number.isInteger(input.version)) return fail(400, "Couldn't tell which page that is.");
    return ok({ page: await undoPage(env, user.id, page(input), input.version) });
  },
  // How their goals stand after a save (Willo's app, companion/lore_companion/goals.py): a goal reached is ticked
  // here, and her app says the line (a cheer, or a check-in when its mark moved since she last said one).
  goals: async ({ env }, input, user) => {
    if (!(await perMinute(env, user.id, "notebook-goals", GOAL_CHECKS_PER_MINUTE))) return slowDown();
    const now = new Date();
    // Goals are Hero's and up, and the free plan's in its first-run trial's days (lib/best-first.js).
    if (plansOn(env)) {
      const plan = await planFor(env, user.id, now);
      if (plan.id === "free" && !(await trialFor(env, user.id, plan, now))?.on) return ok({ checks: [], pages: [] });
    }
    const stock = stockOf(input.stock);
    if (!stock) return fail(400, "Couldn't read that.");
    const current = pageOf(input.character);
    const view = notebookView((await readNotebook(env, user.id, current)).pages, { current });
    const checks = goalChecks(goalsOf(view), stock);
    const pages = [];
    for (const page of new Set(checks.filter(c => c.reached).map(c => c.page))) {
      const planned = plannedChange(view, user.id, { page, op: { op: "check", done: true,
        targets: checks.filter(c => c.reached && c.page === page).map(c => ({ raw: c.raw, text: c.goal })) } }, now);
      const saved = planned.page ? await planned.write(env) : null;
      if (saved) pages.push(saved);
    }
    return ok({ checks: checks.map(({ raw, ...c }) => c), pages });
  },
  delete: async ({ env }, input, user) => {
    if (!page(input)) return fail(400, "Couldn't tell which page that is.");
    await deletePage(env, user.id, page(input));
    return ok({ pages: await allPages(env, user.id) });
  },
  fire: async ({ env }, input, user) => {
    if (!REMINDER_ID.test(input.id || "")) return fail(400, "Couldn't tell which reminder that is.");
    return ok({ fired: await fireReminder(env, user.id, input.id) });
  },
  cancel: async ({ env }, input, user) => {
    if (!REMINDER_ID.test(input.id || "")) return fail(400, "Couldn't tell which reminder that is.");
    await cancelReminder(env, user.id, input.id);
    return ok({ reminders: await allReminders(env, user.id) });
  },
  erase: async ({ env }, input, user) => {
    if (input.confirm !== "erase") return fail(400, "Say erase to confirm.");
    await eraseNotebook(env, user.id);
    return ok();
  },
};

async function readJson(request) {
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { error: fail(413, "That page is too long.") };
    const input = JSON.parse(text || "{}");
    return input && typeof input === "object" && !Array.isArray(input) ? { input } : { error: fail(400, "Couldn't read that.") };
  } catch (e) { return { error: fail(400, "Couldn't read that.") }; }
}

// The account behind the request: the companion's token, or a page's session.
async function who(env, request) {
  if (COMPANION.test(request.headers.get("X-LF-Client") || "") && !request.headers.get("Origin")) {
    return (await currentDevice(env, request))?.user || null;
  }
  if (request.method === "POST" && !sameOrigin(request)) return null;
  return currentUser(env, request);
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const action = String(params.action);
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  const table = request.method === "GET" ? GETS : request.method === "POST" ? POSTS : null;
  if (!table) return fail(405, "Use GET or POST.");
  if (!Object.hasOwn(table, action)) return fail(404, "Not found.");
  await setup(env);
  const user = await who(env, request);
  if (!user) return fail(401, "Connect Willo to your Lore Forever account to use the notebook.");
  try {
    if (request.method === "GET") return await table[action](context, user);
    const { input, error } = await readJson(request);
    return error || await table[action](context, input, user);
  } catch (e) {
    if (e instanceof NotebookError) {
      return Response.json({ ok: false, error: e.message, ...(e.page ? { page: e.page } : {}) },
        { status: e.status, headers: noStore });
    }
    throw e;
  }
}
