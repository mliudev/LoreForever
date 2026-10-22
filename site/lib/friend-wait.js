// Friend messages the moment they come (Mike, 10/21: "an immediate messaging system"). GET /api/friends/wait holds
// Willo's request until a message to the player lands, looking every CHECK_EVERY (the newest message to them: one
// row, by the friend_messages_to_id index), for at most WAIT_MAX seconds, then answers as /api/friends/counts does.
// Willo keeps one open while it runs (companion friends.py watch), so a message shows in about a second, in an open
// chat and on the Friends badge, instead of at the window's next 5-second or Willo's next minute's check. Requests,
// friends coming online and the rest of the counts' stamp show at the end of each wait.
// Cost: two rows read a second per connected player and a request every WAIT_MAX seconds, inside Workers Paid's
// included reads and requests at our size.
import { friendCounts } from "./friends.js";

export const WAIT_MAX = 25;          // seconds
export const CHECK_EVERY = 500;      // milliseconds

let indexed = null;   // once per isolate: MAX(id) for one recipient is then a single index row, not all their messages
const newest = (env, userId) =>
  env.DB.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM friend_messages WHERE recipient = ?").bind(userId).first("id");

// The counts ({unread, incoming, stamp}) once a message to `userId` came after `stamp`'s (or at once, when the stamp
// is already old), else after `seconds` (at most WAIT_MAX), as they are then.
export async function waitForFriends(env, userId, stamp, seconds,
  { sleep = ms => new Promise(done => setTimeout(done, ms)), clock = Date.now } = {}) {
  indexed ??= env.DB.prepare("CREATE INDEX IF NOT EXISTS friend_messages_to_id ON friend_messages (recipient, id)")
    .run().catch(e => { indexed = null; throw e; });
  await indexed;
  const now = await friendCounts(env, userId);
  const wait = Math.min(Number(seconds) || 0, WAIT_MAX);
  if (now.stamp !== stamp || !(wait > 0)) return now;
  const last = Number(now.stamp.split(".")[0]) || 0, end = clock() + wait * 1000;
  while (clock() + CHECK_EVERY <= end) {
    await sleep(CHECK_EVERY);
    if (Number(await newest(env, userId)) !== last) break;
  }
  return friendCounts(env, userId);
}
