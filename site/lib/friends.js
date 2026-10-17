// Friends in Willo (LOR-564, LOR-511): Lore Forever players add each other, write to each other in Willo's window
// and, only when each says yes, see where the other's character is. "Lore Forever gives you information, Willo gives
// you interaction" (Mike, 2026-10-16). The API is functions/api/friends/[action].js; the companion's side is
// companion/lore_companion/friends.py. Kept outside functions/ so Pages doesn't route it.
//
// Adding: by profile handle (a request the other player accepts) or by their share link, /w/<code> (lib/referrals.js,
// one link for friends and referrals): a player's link counts as its owner's yes, so it makes friends at once; a
// creator's link belongs to no player account, so it adds no one. Either side can remove the other, block (which also
// removes) and report (which also blocks). A blocked player can't add or write to whoever blocked them, and isn't told.
//
// Messages: text only, between friends only, kept MESSAGE_KEEP_DAYS and then deleted. Removing or blocking a friend
// deletes the conversation for both. Nothing is ever sent to the game (no whispers) and Willo never acts in it.
//
// Progress: off until the player turns on "Share where I am with friends". While it's on, the companion sends a small
// note (character, level, zone, subzone, tracked quest) when they change (presence, at most PRESENCE_PER_HOUR); only
// friends see it. Turning it off deletes the note. Nothing else about the player is shown to friends: their
// character's name and profile handle (and the profile's link when it's public), never the account's name or email.
//
// Tables (in lib/accounts.js SETUP and USER_DATA, so "Delete my account" removes them):
//   friend_people (user_id, pid, share, progress, progress_at, created)   pid: the random id friends see
//   friend_edges (user_id, other_id, state, created, updated)   one row per side: state is "friends", "asked" (user
//     asked other), "asking" (other asked user) or "blocked" (user blocked other; the other side has no row)
//   friend_messages (id, sender, recipient, body, created, seen)
//   friend_reports (id, reporter, reported, messages, note, created, status)   kept REPORT_KEEP_DAYS

import { validHandle } from "./profiles.js";

export const MESSAGE_KEEP_DAYS = 90;
export const REPORT_KEEP_DAYS = 90;
export const MESSAGE_MAX = 1000;          // characters
export const FRIENDS_MAX = 200;
export const PENDING_MAX = 50;            // requests sent and not answered yet
export const ASKS_PER_DAY = 20;
export const MESSAGES_PER_MINUTE = 20;
export const MESSAGES_PER_DAY = 500;
export const REPORTS_PER_DAY = 10;
export const PRESENCE_PER_HOUR = 60;
const PAGE = 50;                          // messages per read
const REPORTED_MESSAGES = 30;             // the latest messages a report keeps for review

export const FRIENDS_SETUP = [
  `CREATE TABLE IF NOT EXISTS friend_people (
    user_id TEXT PRIMARY KEY, pid TEXT NOT NULL UNIQUE, share INTEGER NOT NULL DEFAULT 0, progress TEXT,
    progress_at TEXT, created TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS friend_edges (
    user_id TEXT NOT NULL, other_id TEXT NOT NULL, state TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL,
    PRIMARY KEY (user_id, other_id))`,
  "CREATE INDEX IF NOT EXISTS friend_edges_other ON friend_edges (other_id)",
  `CREATE TABLE IF NOT EXISTS friend_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL,
    created TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0)`,
  "CREATE INDEX IF NOT EXISTS friend_messages_to ON friend_messages (recipient, seen, sender)",
  "CREATE INDEX IF NOT EXISTS friend_messages_from ON friend_messages (sender, recipient)",
  "CREATE INDEX IF NOT EXISTS friend_messages_created ON friend_messages (created)",
  `CREATE TABLE IF NOT EXISTS friend_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reporter TEXT NOT NULL, reported TEXT NOT NULL, messages TEXT NOT NULL,
    note TEXT, created TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open')`,
];

// What "Delete my account" runs (lib/accounts.js USER_DATA): every row that names the account, either side.
export const FRIENDS_USER_DATA = [
  ["DELETE FROM friend_messages WHERE sender = ?", u => u.id],
  ["DELETE FROM friend_messages WHERE recipient = ?", u => u.id],
  ["DELETE FROM friend_edges WHERE user_id = ?", u => u.id],
  ["DELETE FROM friend_edges WHERE other_id = ?", u => u.id],
  ["DELETE FROM friend_reports WHERE reporter = ?", u => u.id],
  ["DELETE FROM friend_reports WHERE reported = ?", u => u.id],
  ["DELETE FROM friend_people WHERE user_id = ?", u => u.id],
];

// A friend-facing error: `status` for the API, `error` in plain words the companion shows as is.
export class FriendError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const iso = (now = Date.now()) => new Date(now).toISOString();
const daysAgo = (days, now = Date.now()) => iso(now - days * 864e5);
const newPid = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, "0")).join("");
const PID = /^[0-9a-f]{16}$/;

// ---- Who's who ----

// The account's own row (made the first time): {pid, share, progress, progress_at}.
export async function person(env, userId, now = Date.now()) {
  const row = await env.DB.prepare("SELECT pid, share, progress, progress_at FROM friend_people WHERE user_id = ?")
    .bind(userId).first();
  if (row) return row;
  await env.DB.prepare("INSERT INTO friend_people (user_id, pid, share, created) VALUES (?, ?, 0, ?) " +
    "ON CONFLICT (user_id) DO NOTHING").bind(userId, newPid(), iso(now)).run();
  return env.DB.prepare("SELECT pid, share, progress, progress_at FROM friend_people WHERE user_id = ?").bind(userId).first();
}

// The account behind a friend id, or null.
async function byPid(env, pid) {
  if (!PID.test(String(pid || ""))) return null;
  return (await env.DB.prepare("SELECT user_id FROM friend_people WHERE pid = ?").bind(pid).first())?.user_id || null;
}

async function needPid(env, pid) {
  const id = await byPid(env, pid);
  if (!id) throw new FriendError(404, "That player isn't on your friends list.");
  return id;
}

const edge = async (env, a, b) =>
  (await env.DB.prepare("SELECT state FROM friend_edges WHERE user_id = ? AND other_id = ?").bind(a, b).first())?.state || null;

// What a player typed to add someone: a share link (/w/<code>), a profile link (/u/<handle>), "@handle" or a handle.
// {code} or {handle}, or null when it's neither. A bare word may be either: {handle, code} (the handle is tried first).
export function parseWho(text) {
  const s = String(text || "").trim().slice(0, 200);
  let m = s.match(/\/w\/([A-Za-z0-9-]{3,32})(?:[/?#]|$)/);
  if (m) return { code: m[1] };
  m = s.match(/\/u\/([A-Za-z0-9-]{3,24})(?:[/?#]|$)/);
  if (m) return validHandle(m[1].toLowerCase()) ? { handle: m[1].toLowerCase() } : null;
  const word = s.replace(/^@/, "");
  if (!/^[A-Za-z0-9-]{3,32}$/.test(word)) return null;
  return validHandle(word.toLowerCase()) ? { handle: word.toLowerCase(), code: word } : { code: word };
}

// The owner of a share link's code: {userId, creator} or null (unknown or retired). The codes are lib/referrals.js's
// (lowercase; a creator's code has no player account, userId null); until that table exists, no link resolves.
// TODO after the referrals PR merges: referrals.js codeOwner instead (it also checks a creator's own retirement).
export async function linkOwner(env, code) {
  try {
    const row = await env.DB.prepare("SELECT user_id, kind FROM share_codes WHERE code = ? AND retired IS NULL")
      .bind(String(code).toLowerCase()).first();
    return row ? { userId: row.kind === "creator" ? null : row.user_id || null, creator: row.kind === "creator" } : null;
  } catch (e) { return null; }
}

// ---- The list ----

const progressOf = (row, now) => {
  if (!row.share || !row.progress) return null;
  try {
    const p = JSON.parse(row.progress);
    return { ...p, at: row.progress_at, ago: Math.max(0, Math.round((now - Date.parse(row.progress_at)) / 60000)) };
  } catch (e) { return null; }
};

// Everything Willo's Friends tab shows, in one go: {me, friends, incoming, outgoing, blocked, unread}. Friends come
// newest conversation first; a friend's progress only while they share it.
export async function friendsList(env, userId, now = Date.now()) {
  const [me, mine, edges, unread, last] = await Promise.all([
    person(env, userId, now),
    env.DB.prepare("SELECT handle, json_extract(data, '$.name') AS name FROM profiles WHERE user_id = ?").bind(userId).first(),
    env.DB.prepare(
      "SELECT e.state, e.updated, p.pid, p.share, p.progress, p.progress_at, pr.handle, pr.public, " +
      "json_extract(pr.data, '$.name') AS name FROM friend_edges e JOIN friend_people p ON p.user_id = e.other_id " +
      "LEFT JOIN profiles pr ON pr.user_id = e.other_id WHERE e.user_id = ? ORDER BY e.updated DESC LIMIT 500"
    ).bind(userId).all(),
    env.DB.prepare("SELECT p.pid, COUNT(*) AS n FROM friend_messages m JOIN friend_people p ON p.user_id = m.sender " +
      "WHERE m.recipient = ? AND m.seen = 0 GROUP BY m.sender").bind(userId).all(),
    // The latest message with each friend, either way.
    env.DB.prepare(
      "SELECT m.id, m.sender, m.body, m.created, p.pid FROM friend_messages m JOIN friend_people p " +
      "ON p.user_id = CASE WHEN m.sender = ? THEN m.recipient ELSE m.sender END WHERE m.id IN (" +
      "SELECT MAX(id) FROM friend_messages WHERE sender = ? OR recipient = ? " +
      "GROUP BY CASE WHEN sender = ? THEN recipient ELSE sender END)"
    ).bind(userId, userId, userId, userId).all(),
  ]);
  const unreadBy = new Map(unread.results.map(r => [r.pid, r.n]));
  const lastBy = new Map(last.results.map(r => [r.pid, r]));
  const who = r => ({ id: r.pid, handle: r.handle || null, name: r.name || r.handle || "A Lore Forever player" });
  const out = { me: { id: me.pid, handle: mine?.handle || null, name: mine?.name || null, share: Boolean(me.share) },
                friends: [], incoming: [], outgoing: [], blocked: [], unread: 0 };
  for (const r of edges.results) {
    if (r.state === "friends") {
      const m = lastBy.get(r.pid), n = unreadBy.get(r.pid) || 0;
      out.unread += n;
      out.friends.push({
        ...who(r), unread: n, url: r.public && r.handle ? `/u/${r.handle}` : null, since: r.updated,
        last: m ? { id: m.id, text: m.body.slice(0, 140), at: m.created, mine: m.sender === userId } : null,
        progress: progressOf(r, now),
      });
    } else if (r.state === "asking") out.incoming.push({ ...who(r), at: r.updated });
    else if (r.state === "asked") out.outgoing.push({ ...who(r), at: r.updated });
    else if (r.state === "blocked") out.blocked.push(who(r));
  }
  out.friends.sort((a, b) => (b.last?.id || 0) - (a.last?.id || 0) || a.name.localeCompare(b.name));
  return out;
}

// Just the counts, for the companion's minute poll (reads only, one query): {unread, incoming, stamp}. stamp changes
// whenever a message comes in or the list changes, so the companion fetches the whole list only then.
export async function friendCounts(env, userId) {
  const row = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM friend_messages WHERE recipient = ? AND seen = 0) AS unread, " +
    "(SELECT COALESCE(MAX(id), 0) FROM friend_messages WHERE recipient = ?) AS last_in, " +
    "(SELECT COUNT(*) FROM friend_edges WHERE user_id = ? AND state = 'asking') AS incoming, " +
    "(SELECT COUNT(*) || '.' || COALESCE(MAX(updated), '') FROM friend_edges WHERE user_id = ?) AS edges"
  ).bind(userId, userId, userId, userId).first();
  return { unread: row?.unread || 0, incoming: row?.incoming || 0, stamp: `${row?.last_in || 0}.${row?.edges || ""}` };
}

// ---- Adding, answering, removing, blocking ----

const setPair = (env, a, b, stateA, stateB, now) => [
  env.DB.prepare("INSERT INTO friend_edges (user_id, other_id, state, created, updated) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT (user_id, other_id) DO UPDATE SET state = excluded.state, updated = excluded.updated")
    .bind(a, b, stateA, iso(now), iso(now)),
  env.DB.prepare("INSERT INTO friend_edges (user_id, other_id, state, created, updated) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT (user_id, other_id) DO UPDATE SET state = excluded.state, updated = excluded.updated")
    .bind(b, a, stateB, iso(now), iso(now)),
];
const dropPair = (env, a, b) => [
  env.DB.prepare("DELETE FROM friend_edges WHERE (user_id = ? AND other_id = ?) OR (user_id = ? AND other_id = ?)")
    .bind(a, b, b, a),
];
const dropConversation = (env, a, b) => [
  env.DB.prepare("DELETE FROM friend_messages WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)")
    .bind(a, b, b, a),
];

async function counts(env, userId) {
  const row = await env.DB.prepare("SELECT SUM(state = 'friends') AS friends, SUM(state = 'asked') AS asked " +
    "FROM friend_edges WHERE user_id = ?").bind(userId).first();
  return { friends: row?.friends || 0, asked: row?.asked || 0 };
}

// Adds the player named by `who` (parseWho's text). {state: "friends" | "asked", id}. `allowAsk` is the caller's
// rate limit, checked only when a new request would be sent.
export async function addFriend(env, userId, who, { allowAsk = async () => true, now = Date.now() } = {}) {
  const parsed = parseWho(who);
  if (!parsed) throw new FriendError(400, "Type their profile name, or paste their link.");
  let other = null, viaLink = false;
  if (parsed.handle) {
    other = (await env.DB.prepare("SELECT user_id FROM profiles WHERE handle = ?").bind(parsed.handle).first())?.user_id || null;
  }
  if (!other && parsed.code) {
    const owner = await linkOwner(env, parsed.code);
    if (owner?.creator) throw new FriendError(400, "That's a creator's link. Ask your friend for their own link, or their profile name.");
    if (owner) { other = owner.userId; viaLink = true; }
  }
  if (!other) {
    throw new FriendError(404, parsed.handle ? "There's no player by that name. Check the spelling, or ask for their link."
      : "That link isn't working any more. Ask them for a new one.");
  }
  if (other === userId) throw new FriendError(400, "That's you!");
  await Promise.all([person(env, userId, now), person(env, other, now)]);
  const [mine, theirs] = await Promise.all([edge(env, userId, other), edge(env, other, userId)]);
  const pid = (await env.DB.prepare("SELECT pid FROM friend_people WHERE user_id = ?").bind(other).first("pid"));
  if (theirs === "blocked") throw new FriendError(403, "You can't add that player.");
  if (mine === "friends") return { state: "friends", id: pid };
  const have = await counts(env, userId);
  if (have.friends >= FRIENDS_MAX) throw new FriendError(409, `You have ${FRIENDS_MAX} friends, the most there can be.`);
  // They asked first, or their own link says yes: friends now.
  if (mine === "asking" || viaLink) {
    if ((await counts(env, other)).friends >= FRIENDS_MAX) throw new FriendError(409, "Their friends list is full.");
    await env.DB.batch(setPair(env, userId, other, "friends", "friends", now));
    return { state: "friends", id: pid };
  }
  if (mine === "asked") return { state: "asked", id: pid };
  if (have.asked >= PENDING_MAX) throw new FriendError(409, "You have a lot of requests waiting. Give them time to answer.");
  if (!(await allowAsk())) throw new FriendError(429, "That's a lot of friend requests for one day. Try again tomorrow.");
  // Adding someone you'd blocked unblocks them.
  await env.DB.batch(setPair(env, userId, other, "asked", "asking", now));
  return { state: "asked", id: pid };
}

// Accept (or decline) the request from `pid`. Declining also cancels a request the player sent.
export async function answerRequest(env, userId, pid, accept, now = Date.now()) {
  const other = await needPid(env, pid);
  const mine = await edge(env, userId, other);
  if (accept) {
    if (mine === "friends") return;
    if (mine !== "asking") throw new FriendError(404, "That request isn't there any more.");
    if ((await counts(env, userId)).friends >= FRIENDS_MAX) throw new FriendError(409, `You have ${FRIENDS_MAX} friends, the most there can be.`);
    await env.DB.batch(setPair(env, userId, other, "friends", "friends", now));
    return;
  }
  if (mine === "asking" || mine === "asked") await env.DB.batch(dropPair(env, userId, other));
}

// Removes a friend (or a request): both sides' rows and the conversation go.
export async function removeFriend(env, userId, pid) {
  const other = await needPid(env, pid);
  const mine = await edge(env, userId, other);
  if (mine === "blocked") return;
  await env.DB.batch([...dropPair(env, userId, other), ...dropConversation(env, userId, other)]);
}

export async function blockPlayer(env, userId, pid, now = Date.now()) {
  const other = await needPid(env, pid);
  await env.DB.batch([
    ...dropPair(env, userId, other), ...dropConversation(env, userId, other),
    env.DB.prepare("INSERT INTO friend_edges (user_id, other_id, state, created, updated) VALUES (?, ?, 'blocked', ?, ?)")
      .bind(userId, other, iso(now), iso(now)),
  ]);
}

export async function unblockPlayer(env, userId, pid) {
  const other = await needPid(env, pid);
  await env.DB.prepare("DELETE FROM friend_edges WHERE user_id = ? AND other_id = ? AND state = 'blocked'")
    .bind(userId, other).run();
}

// A report keeps the latest messages `pid` sent the player, for review, then blocks them.
export async function reportPlayer(env, userId, pid, note, now = Date.now()) {
  const other = await needPid(env, pid);
  const { results } = await env.DB.prepare("SELECT id, body, created FROM friend_messages WHERE sender = ? AND recipient = ? " +
    "ORDER BY id DESC LIMIT ?").bind(other, userId, REPORTED_MESSAGES).all();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO friend_reports (reporter, reported, messages, note, created) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, other, JSON.stringify(results.reverse()), String(note || "").trim().slice(0, 500) || null, iso(now)),
    env.DB.prepare("DELETE FROM friend_reports WHERE created < ?").bind(daysAgo(REPORT_KEEP_DAYS, now)),
  ]);
  await blockPlayer(env, userId, pid, now);
}

// ---- Messages ----

// The text as it's kept: trimmed, without control characters (newlines stay, three at most in a row), at most
// MESSAGE_MAX characters. "" when there's nothing to send.
export function cleanMessage(text) {
  return [...String(text ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\n{4,}/g, "\n\n\n").trim()].slice(0, MESSAGE_MAX).join("").trim();
}

// The friend behind `pid`, both sides still friends (one query), or a 403.
async function needFriend(env, userId, pid) {
  const row = PID.test(String(pid || "")) ? await env.DB.prepare(
    "SELECT p.user_id FROM friend_people p JOIN friend_edges a ON a.user_id = ? AND a.other_id = p.user_id " +
    "AND a.state = 'friends' JOIN friend_edges b ON b.user_id = p.user_id AND b.other_id = ? AND b.state = 'friends' " +
    "WHERE p.pid = ?").bind(userId, userId, pid).first() : null;
  if (!row) throw new FriendError(403, "You can only write to your friends.");
  return row.user_id;
}

const asMessage = (userId, r) => ({ id: r.id, mine: r.sender === userId, text: r.body, at: r.created });

// Sends `text` to friend `pid`. The caller checks the rate limits first.
export async function sendMessage(env, userId, pid, text, now = Date.now()) {
  const body = cleanMessage(text);
  if (!body) throw new FriendError(400, "Write something first.");
  const other = await needFriend(env, userId, pid);
  const row = await env.DB.prepare("INSERT INTO friend_messages (sender, recipient, body, created) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(userId, other, body, iso(now)).first();
  // Old messages go, a few at a time, as new ones come.
  await env.DB.prepare("DELETE FROM friend_messages WHERE id IN (SELECT id FROM friend_messages WHERE created < ? LIMIT 200)")
    .bind(daysAgo(MESSAGE_KEEP_DAYS, now)).run();
  return { id: row.id, mine: true, text: body, at: iso(now) };
}

// The conversation with friend `pid`: the newest PAGE messages (oldest first), or those after message id `after`, or
// the PAGE before `before`. Reading marks their messages to the player seen. {messages, more}: more when older ones
// are left.
export async function conversation(env, userId, pid, { after = 0, before = 0 } = {}) {
  const other = await needFriend(env, userId, pid);
  const pair = "((sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?))";
  const args = [userId, other, other, userId];
  let rows;
  if (after > 0) {
    rows = (await env.DB.prepare(`SELECT * FROM friend_messages WHERE ${pair} AND id > ? ORDER BY id LIMIT ?`)
      .bind(...args, after, PAGE + 1).all()).results;
  } else {
    rows = (await env.DB.prepare(`SELECT * FROM friend_messages WHERE ${pair}${before > 0 ? " AND id < ?" : ""} ` +
      "ORDER BY id DESC LIMIT ?").bind(...args, ...(before > 0 ? [before] : []), PAGE + 1).all()).results.reverse();
  }
  const more = rows.length > PAGE;
  if (more) rows = after > 0 ? rows.slice(0, PAGE) : rows.slice(1);
  if (rows.some(r => r.recipient === userId && !r.seen)) {
    await env.DB.prepare("UPDATE friend_messages SET seen = 1 WHERE recipient = ? AND sender = ? AND seen = 0 AND id <= ?")
      .bind(userId, other, rows[rows.length - 1].id).run();
  }
  return { messages: rows.map(r => asMessage(userId, r)), more };
}

// ---- Sharing where you are ----

const short = (v, n = 64) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, n) : "") || null;

// The presence note from the companion, cleaned: {character, level, zone, sub, quest}, or null when there's nothing.
export function readPresence(input) {
  if (!input || typeof input !== "object") return null;
  const level = Number.isInteger(input.level) && input.level >= 1 && input.level <= 100 ? input.level : null;
  const out = { character: short(input.character, 32), level, zone: short(input.zone), sub: short(input.sub),
                quest: short(input.quest, 120) };
  return Object.values(out).some(v => v !== null) ? out : null;
}

// Stores the note, only while the player shares it. True when stored.
export async function savePresence(env, userId, presence, now = Date.now()) {
  if (!presence) return false;
  const res = await env.DB.prepare("UPDATE friend_people SET progress = ?, progress_at = ? WHERE user_id = ? AND share = 1")
    .bind(JSON.stringify(presence), iso(now), userId).run();
  return res.meta.changes > 0;
}

// Turns sharing on or off. Off deletes the note at once.
export async function setSharing(env, userId, on, now = Date.now()) {
  await person(env, userId, now);
  await env.DB.prepare(on ? "UPDATE friend_people SET share = 1 WHERE user_id = ?"
    : "UPDATE friend_people SET share = 0, progress = NULL, progress_at = NULL WHERE user_id = ?").bind(userId).run();
}

// ---- For /admin (functions/api/admin/willo.js) ----

// Reports not looked at yet, newest first: who reported whom (profile names, never account names), their note and
// the messages kept. [] before the first friend was ever added (no tables yet).
export async function openReports(env, limit = 50) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT r.id, r.created, r.note, r.messages, a.handle AS reporter, b.handle AS reported, " +
      "(SELECT COUNT(*) FROM friend_reports x WHERE x.reported = r.reported) AS times FROM friend_reports r " +
      "LEFT JOIN profiles a ON a.user_id = r.reporter LEFT JOIN profiles b ON b.user_id = r.reported " +
      "WHERE r.status = 'open' ORDER BY r.id DESC LIMIT ?").bind(limit).all();
    return results.map(r => ({ ...r, messages: JSON.parse(r.messages || "[]") }));
  } catch (e) {
    if (/no such table/i.test(String(e?.message))) return [];
    throw e;
  }
}

export async function closeReport(env, id) {
  const res = await env.DB.prepare("UPDATE friend_reports SET status = 'closed' WHERE id = ?").bind(Number(id) || 0).run();
  return res.meta.changes > 0;
}
