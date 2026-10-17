// Friends in Willo (lib/friends.js): the companion's Friends tab, and our pages for a signed-in player.
//   GET  /api/friends/counts                  -> {unread, incoming, stamp}: the companion's minute poll (reads only)
//   GET  /api/friends/list                    -> {me, friends, incoming, outgoing, blocked, unread}
//   GET  /api/friends/messages?with=<id>[&after=<message id>|&before=<message id>] -> {messages, more}; marks them read
//   POST /api/friends/add      {who}          a profile name, @name, /u/<name> or a share link -> {state, id, ...list}
//   POST /api/friends/accept   {id}           POST /api/friends/decline {id} (also cancels one you sent)
//   POST /api/friends/remove   {id}           POST /api/friends/block {id}   POST /api/friends/unblock {id}
//   POST /api/friends/report   {id, note?}    keeps their latest messages to you for review, then blocks them
//   POST /api/friends/share    {on}           share where you are with friends; off deletes what was shared
//   POST /api/friends/send     {to, text}     -> {message}
//   POST /api/friends/presence {character?, level?, zone?, sub?, quest?} -> {stored}: only kept while sharing is on
// The list-changing POSTs answer with the new list too, so the companion redraws from one round trip.
// From the companion: X-LF-Client: companion/<version>, no Origin, Authorization: Bearer <device token>. From our
// pages: the session cookie, and our Origin on a POST.

import { setup, currentUser, fail, noStore, sameOrigin } from "../../../lib/accounts.js";
import { currentDevice } from "../../../lib/devices.js";
import { perMinute, perHour, perDay, slowDown } from "../../../lib/ratelimit.js";
import {
  FriendError, friendsList, friendCounts, addFriend, answerRequest, removeFriend, blockPlayer, unblockPlayer, reportPlayer,
  setSharing, sendMessage, conversation, readPresence, savePresence,
  ASKS_PER_DAY, MESSAGES_PER_MINUTE, MESSAGES_PER_DAY, REPORTS_PER_DAY, PRESENCE_PER_HOUR,
} from "../../../lib/friends.js";

const COMPANION = /^companion\/[\w.-]{1,24}$/;
const MAX_BODY_BYTES = 8 * 1024;
const ok = (body = {}) => Response.json({ ok: true, ...body }, { headers: noStore });
const tooMany = error => Response.json({ ok: false, error }, { status: 429, headers: noStore });
const id = v => (typeof v === "string" ? v : "");
const num = v => (/^\d{1,15}$/.test(v || "") ? Number(v) : 0);

const GETS = {
  counts: async ({ env }, user) => ok(await friendCounts(env, user.id)),
  list: async ({ env }, user) => ok(await friendsList(env, user.id)),
  messages: async ({ request, env }, user) => {
    const q = new URL(request.url).searchParams;
    return ok(await conversation(env, user.id, q.get("with"), { after: num(q.get("after")), before: num(q.get("before")) }));
  },
};

// Each list-changing action, then the list.
const change = run => async (context, input, user) => {
  const { env } = context;
  if (!(await perMinute(env, user.id, "friends-change", 20))) return slowDown();
  const extra = (await run(context, input, user)) || {};
  return ok({ ...extra, ...(await friendsList(env, user.id)) });
};

const POSTS = {
  add: change(({ env }, input, user) =>
    addFriend(env, user.id, id(input.who), { allowAsk: () => perDay(env, user.id, "friends-ask", ASKS_PER_DAY) })),
  accept: change(({ env }, input, user) => answerRequest(env, user.id, id(input.id), true)),
  decline: change(({ env }, input, user) => answerRequest(env, user.id, id(input.id), false)),
  remove: change(({ env }, input, user) => removeFriend(env, user.id, id(input.id))),
  block: change(({ env }, input, user) => blockPlayer(env, user.id, id(input.id))),
  unblock: change(({ env }, input, user) => unblockPlayer(env, user.id, id(input.id))),
  report: async (context, input, user) => {
    if (!(await perDay(context.env, user.id, "friends-report", REPORTS_PER_DAY))) {
      return tooMany("That's a lot of reports for one day. Write to us on the feedback page if something's wrong.");
    }
    return change(({ env }) => reportPlayer(env, user.id, id(input.id), id(input.note)))(context, input, user);
  },
  share: change(({ env }, input, user) => setSharing(env, user.id, input.on === true)),
  send: async ({ env }, input, user) => {
    if (!(await perMinute(env, user.id, "friends-send", MESSAGES_PER_MINUTE))) return slowDown();
    if (!(await perDay(env, user.id, "friends-send-day", MESSAGES_PER_DAY))) {
      return tooMany("That's a lot of messages for one day. Try again tomorrow.");
    }
    return ok({ message: await sendMessage(env, user.id, id(input.to), input.text) });
  },
  presence: async ({ env }, input, user) => {
    if (!(await perHour(env, user.id, "friends-presence", PRESENCE_PER_HOUR))) return slowDown();
    return ok({ stored: await savePresence(env, user.id, readPresence(input)) });
  },
};

async function readJson(request) {
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { error: fail(413, "That's too long to send.") };
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
  if (!user) return fail(401, "Connect Willo to your Lore Forever account to use friends.");
  try {
    if (request.method === "GET") return await table[action](context, user);
    const { input, error } = await readJson(request);
    return error || await table[action](context, input, user);
  } catch (e) {
    if (e instanceof FriendError) return fail(e.status, e.message);
    throw e;
  }
}
