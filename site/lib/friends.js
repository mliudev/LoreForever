// Friends in Willo (LOR-564, LOR-511): Lore Forever players add each other, write to each other in Willo's window
// and, only when each says yes, see where the other's character is. "Lore Forever gives you information, Willo gives
// you interaction" (Mike, 2026-10-16). The API is functions/api/friends/[action].js; the companion's side is
// companion/lore_companion/friends.py. Kept outside functions/ so Pages doesn't route it.
//
// Adding: by profile handle (a request the other player accepts) or by their share link, /w/<code> (lib/referrals.js,
// one link for friends and referrals): a player's link counts as its owner's yes, so it makes friends at once; a
// creator's link belongs to no player account, so it adds no one. The link adds: pasted in Willo's Add a friend, the
// "Add <name> as a friend" button on /willo?shared=<code> for a signed-in visitor (friendOffer), and, for someone the
// link brought to Willo, the Friends tab's offer to add whoever shared it (sharedBy, LOR-611). Either side can remove
// the other, block (which also removes) and report (which also blocks). A blocked player can't add or write to whoever
// blocked them, and isn't told.
//
// Messages: text, between friends only, kept MESSAGE_KEEP_DAYS and then deleted. Removing or blocking a friend deletes
// the conversation for both. Nothing is ever sent to the game (no whispers) and Willo never acts in it. A message may
// carry a card (LOR-674, "Willo, send this to Mike": readCard): a place, an item, a quest, a character or a story, as a
// kind, a title and a few words; its text says the same in plain words. New card sending is retired; private
// screenshot messages use friend-images.js and authenticated reads, after local preview and confirmation.
// The sender can take a message back while it's unread (unsendMessage: the Undo under Willo's "Sent").
//
// Online (LOR-674, Patrick's "Mike — Willo connected"): a friend shows as online while their Willo has been in touch
// with the site in the last ONLINE_MINUTES (devices.last_used, which the minute poll keeps within 10 minutes), else
// away. Never when or where they were: only online or away, and nothing at all for a player who turned "Show when my
// Willo is on" off (friend_people.hide_online).
//
// Progress: off until the player turns on "Share where I am with friends". While it's on, the companion sends a small
// note (character, level, zone, subzone, tracked quest, guild, and their week: levels, new places, quests and bosses of
// the last 7 days, LOR-511) when they change (presence, at most PRESENCE_PER_HOUR); only
// friends see it. Turning it off deletes the note. Nothing else about the player is shown to friends: their
// character's name and profile handle (and the profile's link when it's public), never the account's name or email.
//
// Tables (in lib/accounts.js SETUP and USER_DATA, so "Delete my account" removes them):
//   friend_people (user_id, pid, share, progress, progress_at, created)   pid: the random id friends see
//   friend_edges (user_id, other_id, state, created, updated)   one row per side: state is "friends", "asked" (user
//     asked other), "asking" (other asked user), "blocked" (user blocked other; the other side has no row) or "passed"
//     (user said "Not now" to adding whoever shared Willo with them; the other side has no row)
//   friend_messages (id, sender, recipient, body, created, seen)
//   friend_reports (id, reporter, reported, messages, note, created, status)   kept REPORT_KEEP_DAYS

import { validHandle } from "./profiles.js";
import { codeOwner } from "./referrals.js";

export const MESSAGE_KEEP_DAYS = 90;
export const REPORT_KEEP_DAYS = 90;
export const MESSAGE_MAX = 1000;          // characters
export const FRIENDS_MAX = 200;
export const PENDING_MAX = 50;            // requests sent and not answered yet
export const ASKS_PER_DAY = 20;
export const MESSAGES_PER_MINUTE = 20;
export const MESSAGES_PER_DAY = 500;
// The free plan's messages a day while plans are on (option D, Mike, 2026-10-19; Patrick's "10 messages to your
// friend"): Hero and up, and the beta's free Hero month, send as many as MESSAGES_PER_DAY allows.
export const FREE_MESSAGES_PER_DAY = 10;
export const REPORTS_PER_DAY = 10;
export const PRESENCE_PER_HOUR = 60;
export const ONLINE_MINUTES = 12;         // devices.last_used is kept within 10 minutes of the app's last call
export const UNSEND_MINUTES = 10;         // a message can be taken back this long, while it's unread
// What a card may be (readCard), and how its text reads for a Willo that doesn't draw cards.
export const CARD_KINDS = { place: "a place", item: "an item", quest: "a quest", character: "someone", lore: "a story" };
const CARD_TITLE_MAX = 120, CARD_DETAIL_MAX = 600, CARD_REF_MAX = 64;
const PAGE = 50;                          // messages per read
const REPORTED_MESSAGES = 30;             // the latest messages a report keeps for review

export const FRIENDS_SETUP = [
  `CREATE TABLE IF NOT EXISTS friend_people (
    user_id TEXT PRIMARY KEY, pid TEXT NOT NULL UNIQUE, share INTEGER NOT NULL DEFAULT 0, progress TEXT,
    progress_at TEXT, created TEXT NOT NULL, hide_online INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS friend_edges (
    user_id TEXT NOT NULL, other_id TEXT NOT NULL, state TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL,
    PRIMARY KEY (user_id, other_id))`,
  "CREATE INDEX IF NOT EXISTS friend_edges_other ON friend_edges (other_id)",
  `CREATE TABLE IF NOT EXISTS friend_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL,
    created TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0, card TEXT, image TEXT)`,
  "CREATE INDEX IF NOT EXISTS friend_messages_to ON friend_messages (recipient, seen, sender)",
  "CREATE INDEX IF NOT EXISTS friend_messages_from ON friend_messages (sender, recipient)",
  "CREATE INDEX IF NOT EXISTS friend_messages_created ON friend_messages (created)",
  // Keep a receipt when its message goes: retrying an old confirmation must never send it again.
  `CREATE TABLE IF NOT EXISTS friend_image_sends (
    sender TEXT NOT NULL, nonce TEXT NOT NULL, recipient TEXT NOT NULL, digest TEXT NOT NULL,
    created TEXT NOT NULL, message_id INTEGER, PRIMARY KEY (sender, nonce))`,
  `CREATE TABLE IF NOT EXISTS friend_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reporter TEXT NOT NULL, reported TEXT NOT NULL, messages TEXT NOT NULL,
    note TEXT, created TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open')`,
  // What Willo read back and waits on a yes for (lib/friend-send.js holdMessage, holdChange): a message, or a change to
  // their friends (kind); one a player, for a moment.
  `CREATE TABLE IF NOT EXISTS friend_pending (
    user_id TEXT PRIMARY KEY, recipient TEXT NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'message')`,
];

// Columns added after their tables were first made (lib/accounts.js setup adds the missing ones): table -> [column, type].
export const FRIENDS_COLUMNS = { friend_people: [["hide_online", "INTEGER NOT NULL DEFAULT 0"]],
  friend_messages: [["card", "TEXT"], ["image", "TEXT"]], friend_pending: [["kind", "TEXT NOT NULL DEFAULT 'message'"]] };

// What "Delete my account" runs (lib/accounts.js USER_DATA): every row that names the account, either side.
export const FRIENDS_USER_DATA = [
  ["DELETE FROM friend_image_sends WHERE sender = ?", u => u.id],
  ["DELETE FROM friend_image_sends WHERE recipient = ?", u => u.id],
  ["DELETE FROM friend_messages WHERE sender = ?", u => u.id],
  ["DELETE FROM friend_messages WHERE recipient = ?", u => u.id],
  ["DELETE FROM friend_edges WHERE user_id = ?", u => u.id],
  ["DELETE FROM friend_edges WHERE other_id = ?", u => u.id],
  ["DELETE FROM friend_reports WHERE reporter = ?", u => u.id],
  ["DELETE FROM friend_reports WHERE reported = ?", u => u.id],
  ["DELETE FROM friend_pending WHERE user_id = ?", u => u.id],
  ["DELETE FROM friend_people WHERE user_id = ?", u => u.id],
];

// A friend-facing error: `status` for the API, `error` in plain words the companion shows as is.
export class FriendError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Receipts retain enough information to find private files after an unsend/removal has deleted the message.
// Keep this derivation shared by uploads and account deletion; no account ids or object keys go to the client.
export async function friendImageKey(sender, nonce, recipient, digest) {
  const bytes = new TextEncoder().encode(`${sender}\0${nonce}\0${recipient}\0${digest}`);
  const owner = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sender)))].map(b => b.toString(16).padStart(2, "0")).join("");
  return `friend-images/${owner}/` + [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

// Account deletion removes files before dropping their receipts, as it does for other private uploads. Page only
// this account's receipts, including expired/removed messages; never scan the bucket or lose retry information on
// a storage failure. R2 deletion is idempotent when a file was already removed.
export async function forgetFriendImages(env, userId) {
  if (!env.STUDIO) return;
  let after = 0;
  for (;;) {
    const { results } = await env.DB.prepare("SELECT rowid AS receipt_id, sender, nonce, recipient, digest FROM friend_image_sends " +
      "WHERE (sender = ? OR recipient = ?) AND rowid > ? ORDER BY rowid LIMIT 100").bind(userId, userId, after).all();
    if (!results.length) break;
    await env.STUDIO.delete(await Promise.all(results.map(row => friendImageKey(row.sender, row.nonce, row.recipient, row.digest))));
    after = results[results.length - 1].receipt_id;
  }
  // A storage success followed by a DB failure or a conflicting simultaneous nonce may leave no receipt.
  // The uploader's private prefix lets account deletion remove those files too, without scanning other accounts.
  const prefix = (await friendImageKey(userId, "", "", "")).replace(/[^/]+$/, "");
  for (;;) {
    const page = await env.STUDIO.list({ prefix, limit: 100 });
    if (!page.objects.length) break;
    await env.STUDIO.delete(page.objects.map(object => object.key));
  }
}

const iso = (now = Date.now()) => new Date(now).toISOString();
const daysAgo = (days, now = Date.now()) => iso(now - days * 864e5);
const newPid = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, "0")).join("");
const PID = /^[0-9a-f]{16}$/;

// ---- Who's who ----

// The account's own row (made the first time): {pid, share, progress, progress_at}.
export async function person(env, userId, now = Date.now()) {
  const read = () => env.DB.prepare("SELECT pid, share, progress, progress_at, hide_online FROM friend_people WHERE user_id = ?")
    .bind(userId).first();
  const row = await read();
  if (row) return row;
  await env.DB.prepare("INSERT INTO friend_people (user_id, pid, share, created) VALUES (?, ?, 0, ?) " +
    "ON CONFLICT (user_id) DO NOTHING").bind(userId, newPid(), iso(now)).run();
  return read();
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

// The player a share link belongs to and whether it's a creator's (lib/referrals.js codeOwner, live codes only):
// {userId, creator, name} or null.
export async function linkOwner(env, code) {
  const owner = await codeOwner(env, code).catch(() => null);
  return owner ? { userId: owner.userId, creator: owner.kind === "creator", name: owner.name } : null;
}

// ---- The list ----

// What a friend shares, as the list shows it: their note, when it was sent and how many minutes ago. Their week covers
// the 7 days before the note, so it goes once the note is older than that.
const WEEK_MINUTES = 7 * 24 * 60;
const progressOf = (row, now) => {
  if (!row.share || !row.progress) return null;
  try {
    const p = JSON.parse(row.progress);
    const ago = Math.max(0, Math.round((now - Date.parse(row.progress_at)) / 60000));
    return { ...p, ...(ago > WEEK_MINUTES ? { week: null } : {}), at: row.progress_at, ago };
  } catch (e) { return null; }
};

// The player whose share link brought this account to Willo (lib/referrals.js referrals), while that link still works
// and the two have nothing between them yet (no friendship, request, block, or "Not now": a "passed" row): Willo's
// Friends tab offers to add them. {id, name, who: the link's code} or null; null too before referrals' tables exist.
// name: as Share Willo shows a sharer (lib/referrals.js codeOwner), their character only when their profile is public,
// else null ("A friend"); never the account's name or email.
async function sharedBy(env, userId, now) {
  let row;
  try {
    row = await env.DB.prepare(
      "SELECT r.code, r.sharer_id, CASE WHEN pr.public = 1 THEN json_extract(pr.data, '$.name') END AS name FROM referrals r " +
      "JOIN share_codes s ON s.code = r.code AND s.retired IS NULL LEFT JOIN profiles pr ON pr.user_id = r.sharer_id " +
      "WHERE r.user_id = ? AND r.sharer_id IS NOT NULL AND r.sharer_id <> r.user_id AND NOT EXISTS (SELECT 1 FROM friend_edges e " +
      "WHERE (e.user_id = r.user_id AND e.other_id = r.sharer_id) OR (e.user_id = r.sharer_id AND e.other_id = r.user_id))"
    ).bind(userId).first();
  } catch (e) { return null; }
  if (!row) return null;
  const them = await person(env, row.sharer_id, now);
  return { id: them.pid, name: row.name ? String(row.name).slice(0, 40) : null, who: row.code };
}

// Everything Willo's Friends tab shows, in one go: {me, friends, incoming, outgoing, blocked, unread, suggested}.
// Friends come newest conversation first; a friend's progress only while they share it. suggested: sharedBy's.
export async function friendsList(env, userId, now = Date.now()) {
  const [me, mine, edges, unread, last, suggested] = await Promise.all([
    person(env, userId, now),
    env.DB.prepare("SELECT handle, json_extract(data, '$.name') AS name FROM profiles WHERE user_id = ?").bind(userId).first(),
    env.DB.prepare(
      "SELECT e.state, e.updated, p.pid, p.share, p.progress, p.progress_at, p.hide_online, pr.handle, pr.public, " +
      "json_extract(pr.data, '$.name') AS name, CASE WHEN e.state = 'friends' AND p.hide_online = 0 THEN " +
      "EXISTS (SELECT 1 FROM devices d WHERE d.user_id = e.other_id AND d.last_used > ?) END AS online " +
      "FROM friend_edges e JOIN friend_people p ON p.user_id = e.other_id " +
      "LEFT JOIN profiles pr ON pr.user_id = e.other_id WHERE e.user_id = ? ORDER BY e.updated DESC LIMIT 500"
    ).bind(onlineSince(now), userId).all(),
    env.DB.prepare("SELECT p.pid, COUNT(*) AS n FROM friend_messages m JOIN friend_people p ON p.user_id = m.sender " +
      "WHERE m.recipient = ? AND m.seen = 0 GROUP BY m.sender").bind(userId).all(),
    // The latest message with each friend, either way.
    env.DB.prepare(
      "SELECT m.id, m.sender, m.body, m.created, m.card, m.image, p.pid FROM friend_messages m JOIN friend_people p " +
      "ON p.user_id = CASE WHEN m.sender = ? THEN m.recipient ELSE m.sender END WHERE m.id IN (" +
      "SELECT MAX(id) FROM friend_messages WHERE sender = ? OR recipient = ? " +
      "GROUP BY CASE WHEN sender = ? THEN recipient ELSE sender END)"
    ).bind(userId, userId, userId, userId).all(),
    sharedBy(env, userId, now),
  ]);
  const unreadBy = new Map(unread.results.map(r => [r.pid, r.n]));
  const lastBy = new Map(last.results.map(r => [r.pid, r]));
  // A friend with no profile name or handle goes by the character they share with friends, before any stand-in.
  const who = (r, friend) => ({ id: r.pid, handle: r.handle || null,
    name: r.name || r.handle || (friend && progressOf(r, now)?.character) || "A Lore Forever player" });
  // me.guild: the player's own guild, from what they share (so the tab can mark friends in it); null when not sharing.
  // me.online: whether their friends see when their Willo is on ("Show when my Willo is on").
  const out = { me: { id: me.pid, handle: mine?.handle || null, name: mine?.name || null, share: Boolean(me.share),
                      guild: progressOf(me, now)?.guild || null, online: !me.hide_online },
                friends: [], incoming: [], outgoing: [], blocked: [], unread: 0, suggested };
  for (const r of edges.results) {
    if (r.state === "friends") {
      const m = lastBy.get(r.pid), n = unreadBy.get(r.pid) || 0;
      out.unread += n;
      // online: true (Willo connected), false (away), or null when they don't show it.
      out.friends.push({
        ...who(r, true), unread: n, url: r.public && r.handle ? `/u/${r.handle}` : null, since: r.updated,
        online: r.hide_online ? null : Boolean(r.online),
        last: m ? { id: m.id, text: m.body.slice(0, 140), at: m.created, mine: m.sender === userId,
                    ...(m.image ? { kind: "image" } : m.card ? { kind: cardOf(m.card)?.kind || null } : {}) } : null,
        progress: progressOf(r, now),
      });
    } else if (r.state === "asking") out.incoming.push({ ...who(r), at: r.updated });
    else if (r.state === "asked") out.outgoing.push({ ...who(r), at: r.updated });
    else if (r.state === "blocked") out.blocked.push(who(r));
  }
  out.friends.sort((a, b) => (b.last?.id || 0) - (a.last?.id || 0) || a.name.localeCompare(b.name));
  return out;
}

// The friends who show when their Willo is on, with the note they share, as one statement for a caller that batches it
// with other reads (lib/willo-tonight.js): [{pid, name, online, share, progress, progress_at}], newest note first; online: a device used lately.
// A friend who hides when their Willo is on isn't in it; read progress only when share is 1.
export function friendsTonightStatement(env, userId, now = Date.now()) {
  return env.DB.prepare(
    "SELECT p.pid, p.share, p.progress, p.progress_at, COALESCE(json_extract(pr.data, '$.name'), pr.handle) AS name, " +
    "EXISTS (SELECT 1 FROM devices d WHERE d.user_id = e.other_id AND d.last_used > ?) AS online " +
    "FROM friend_edges e JOIN friend_people p ON p.user_id = e.other_id LEFT JOIN profiles pr ON pr.user_id = e.other_id " +
    "WHERE e.user_id = ? AND e.state = 'friends' AND p.hide_online = 0 ORDER BY p.progress_at DESC LIMIT 200"
  ).bind(onlineSince(now), userId);
}

// Just the counts, for the companion's minute poll (reads only, one query): {unread, incoming, stamp}. stamp changes
// whenever a message comes in, the list changes or a friend comes online or goes away, so the companion fetches the
// whole list only then.
const onlineSince = now => iso(now - ONLINE_MINUTES * 60e3);
const fnv = text => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
};
export async function friendCounts(env, userId, now = Date.now()) {
  const row = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM friend_messages WHERE recipient = ? AND seen = 0) AS unread, " +
    "(SELECT COALESCE(MAX(id), 0) FROM friend_messages WHERE recipient = ?) AS last_in, " +
    "(SELECT COUNT(*) FROM friend_edges WHERE user_id = ? AND state = 'asking') AS incoming, " +
    "(SELECT COUNT(*) || '.' || COALESCE(MAX(updated), '') FROM friend_edges WHERE user_id = ?) AS edges, " +
    "(SELECT GROUP_CONCAT(p.pid) FROM friend_edges e JOIN friend_people p ON p.user_id = e.other_id WHERE e.user_id = ? " +
    "AND e.state = 'friends' AND p.hide_online = 0 AND EXISTS (SELECT 1 FROM devices d WHERE d.user_id = e.other_id " +
    "AND d.last_used > ?)) AS online"
  ).bind(userId, userId, userId, userId, userId, onlineSince(now)).first();
  const online = String(row?.online || "").split(",").filter(Boolean).sort().join(",");
  return { unread: row?.unread || 0, incoming: row?.incoming || 0,
           stamp: `${row?.last_in || 0}.${row?.edges || ""}.${online ? fnv(online) : "0"}` };
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

// "Not now" on the Friends tab's offer to add whoever shared Willo with the player (sharedBy): a row on the player's
// side only, so the offer doesn't come back; adding them later replaces it.
export async function passPlayer(env, userId, pid, now = Date.now()) {
  const other = await needPid(env, pid);
  await env.DB.prepare("INSERT INTO friend_edges (user_id, other_id, state, created, updated) VALUES (?, ?, 'passed', ?, ?) " +
    "ON CONFLICT (user_id, other_id) DO NOTHING").bind(userId, other, iso(now), iso(now)).run();
}

// The "Add <name> as a friend" offer on /willo?shared=<code> (functions/willo.js, public/js/friend-add.js) for a
// signed-in visitor: a player's live link, not their own, nothing blocked either way. HTML, or "".
export async function friendOffer(env, owner, viewer, escape) {
  if (!owner || owner.kind !== "player" || !viewer || viewer.id === owner.userId) return "";
  const [mine, theirs] = await Promise.all([edge(env, viewer.id, owner.userId), edge(env, owner.userId, viewer.id)]);
  if (mine === "blocked" || theirs === "blocked") return "";
  const name = escape(owner.name || "them");
  if (mine === "friends") return `<p class="w-friend">You and ${name} are friends in Willo.</p>`;
  return `<p class="w-friend"><button class="btn-small" type="button" data-add-friend="${escape(owner.code)}">` +
    `Add ${name} as a friend</button> <span class="w-friend-status" role="status" data-add-friend-status></span></p>`;
}

// A report keeps the latest messages `pid` sent the player, for review, then blocks them. Returns what Slack may be
// told (lib/slack-feedback.js): {id, times (that player's reports kept), messages (how many kept), note (one given)}.
export async function reportPlayer(env, userId, pid, note, now = Date.now()) {
  const other = await needPid(env, pid);
  const { results } = await env.DB.prepare("SELECT id, body, created FROM friend_messages WHERE sender = ? AND recipient = ? " +
    "ORDER BY id DESC LIMIT ?").bind(other, userId, REPORTED_MESSAGES).all();
  const kept = String(note || "").trim().slice(0, 500) || null;
  const [added, , count] = await env.DB.batch([
    env.DB.prepare("INSERT INTO friend_reports (reporter, reported, messages, note, created) VALUES (?, ?, ?, ?, ?) RETURNING id")
      .bind(userId, other, JSON.stringify(results.reverse()), kept, iso(now)),
    env.DB.prepare("DELETE FROM friend_reports WHERE created < ?").bind(daysAgo(REPORT_KEEP_DAYS, now)),
    env.DB.prepare("SELECT COUNT(*) AS n FROM friend_reports WHERE reported = ?").bind(other),
  ]);
  await blockPlayer(env, userId, pid, now);
  return { id: added.results[0]?.id, times: count.results[0]?.n || 1, messages: results.length, note: Boolean(kept) };
}

// ---- Messages ----

// The text as it's kept: trimmed, without control characters (newlines stay, three at most in a row), at most
// MESSAGE_MAX characters. "" when there's nothing to send.
export function cleanMessage(text) {
  return [...String(text ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\n{4,}/g, "\n\n\n").trim()].slice(0, MESSAGE_MAX).join("").trim();
}

// The friend behind `pid`, both sides still friends (one query), or a 403.
export async function needFriend(env, userId, pid) {
  const row = PID.test(String(pid || "")) ? await env.DB.prepare(
    "SELECT p.user_id FROM friend_people p JOIN friend_edges a ON a.user_id = ? AND a.other_id = p.user_id " +
    "AND a.state = 'friends' JOIN friend_edges b ON b.user_id = p.user_id AND b.other_id = ? AND b.state = 'friends' " +
    "WHERE p.pid = ?").bind(userId, userId, pid).first() : null;
  if (!row) throw new FriendError(403, "You can only write to your friends.");
  return row.user_id;
}

// A card as it's kept: {kind (CARD_KINDS), title, detail?, ref?}, each cleaned and cut to its length, or null when it
// isn't one (an unknown kind, no title).
const cardText = (v, max) => (typeof v === "string" ? cleanMessage(v).replace(/\s*\n\s*/g, "\n").slice(0, max).trim() : "");
export function readCard(input) {
  if (!input || typeof input !== "object" || !Object.hasOwn(CARD_KINDS, input.kind)) return null;
  const title = cardText(input.title, CARD_TITLE_MAX).replace(/\s+/g, " ");
  if (!title) return null;
  const detail = cardText(input.detail, CARD_DETAIL_MAX), ref = short(input.ref, CARD_REF_MAX);
  return { kind: input.kind, title, ...(detail ? { detail } : {}), ...(ref ? { ref } : {}) };
}
const cardOf = json => { try { return readCard(JSON.parse(json)); } catch (e) { return null; } };
// A card in plain words, for a message without text of its own, and for a Willo that shows only text: "Shared a quest:
// The Defias Brotherhood", then its words.
export const cardWords = card => cleanMessage(`Shared ${CARD_KINDS[card.kind]}: ${card.title}` +
  (card.detail ? `\n${card.detail}` : ""));

// Only the authenticated API's URL is public to the client; never send the R2 key.
export const messageImage = (id, image) => ({ url: `/api/friends/image?id=${id}`, width: image.width,
  height: image.height, type: image.type, bytes: image.bytes });
export const asMessage = (userId, r) => {
  const card = r.card ? cardOf(r.card) : null;
  const image = r.image ? JSON.parse(r.image) : null;
  return { id: r.id, mine: r.sender === userId, text: r.body, at: r.created, ...(card ? { card } : {}),
           ...(image ? { image: messageImage(r.id, image) } : {}),
           ...(r.sender === userId ? { seen: Boolean(r.seen) } : {}) };
};

// Sends text to a friend; legacy structured-card sends are rejected. readCard remains for historical messages.
// The caller checks the rate limits first.
// other: the friend's account, when the caller looked it up already (needFriend's). later: runs the clean-up after the
// reply (a Pages waitUntil); without it, before.
export async function sendMessage(env, userId, pid, text, now = Date.now(), card = null, { other = null, later = null } = {}) {
  if (card !== null && card !== undefined) throw new FriendError(400, "Cards can no longer be sent. Share a game screenshot instead.");
  const body = cleanMessage(text);
  if (!body) throw new FriendError(400, "Write something first.");
  const to = other || await needFriend(env, userId, pid);
  const row = await env.DB.prepare("INSERT INTO friend_messages (sender, recipient, body, created, card) VALUES (?, ?, ?, ?, ?) " +
    "RETURNING id").bind(userId, to, body, iso(now), null).first();
  // Old messages go, a few at a time, as new ones come.
  const old = env.DB.prepare("DELETE FROM friend_messages WHERE id IN (SELECT id FROM friend_messages WHERE created < ? LIMIT 200)")
    .bind(daysAgo(MESSAGE_KEEP_DAYS, now)).run();
  await (later ? later(old) : old);
  return { id: row.id, mine: true, text: body, at: iso(now), seen: false };
}

// Takes back the player's own message `id` while the friend hasn't read it and it's at most UNSEND_MINUTES old (the
// Undo under what Willo sent). {removed: true}, or a FriendError saying why not.
export async function unsendMessage(env, userId, id, now = Date.now()) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new FriendError(400, "Choose a message first.");
  const row = await env.DB.prepare("SELECT seen, created FROM friend_messages WHERE id = ? AND sender = ?").bind(n, userId).first();
  if (!row) throw new FriendError(404, "That message isn't there any more.");
  if (row.seen) throw new FriendError(409, "They've read it already.");
  if (Date.parse(row.created) < now - UNSEND_MINUTES * 60e3) throw new FriendError(409, "It's too late to take that back.");
  const res = await env.DB.prepare("DELETE FROM friend_messages WHERE id = ? AND sender = ? AND seen = 0").bind(n, userId).run();
  if (!res.meta.changes) throw new FriendError(409, "They've read it already.");
  return { removed: true };
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
                quest: short(input.quest, 120), guild: short(input.guild, 48), week: readWeek(input.week) };
  return Object.values(out).some(v => v !== null) ? out : null;
}

// Their week (LOR-511, companion friends.py week_of): {levels, zones, quests, bosses} of the last 7 days, or null.
function readWeek(w) {
  if (!w || typeof w !== "object") return null;
  const n = v => (Number.isInteger(v) && v >= 0 && v <= 1000 ? v : 0);
  const names = (v, most) => (Array.isArray(v) ? v.map(x => short(x)).filter(Boolean).slice(0, most) : []);
  const out = { levels: n(w.levels), zones: names(w.zones, 4), quests: n(w.quests), bosses: names(w.bosses, 3) };
  return out.levels || out.quests || out.zones.length || out.bosses.length ? out : null;
}

// Stores the note, only while the player shares it. True when stored.
export async function savePresence(env, userId, presence, now = Date.now()) {
  if (!presence) return false;
  const res = await env.DB.prepare("UPDATE friend_people SET progress = ?, progress_at = ? WHERE user_id = ? AND share = 1")
    .bind(JSON.stringify(presence), iso(now), userId).run();
  return res.meta.changes > 0;
}

// "Show when my Willo is on": whether friends see this player as online or away (on unless they turn it off).
export async function setOnlineShown(env, userId, show, now = Date.now()) {
  await person(env, userId, now);
  await env.DB.prepare("UPDATE friend_people SET hide_online = ? WHERE user_id = ?").bind(show ? 0 : 1, userId).run();
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
