// Per-account limits (LOR-121), so uploading a whole zip or kit at once can't flood the site: the upload page
// (/api/studio/take), kit imports on the translation dashboard (/api/translations/import) and profile imports
// (/api/profile/import) count per minute; the page waits and carries on when it gets a 429 with retryAfter. Profile
// stories (lib/profiles.js) count per day, before each try, since every try costs. Counts live in the D1 table
// rate_limits (lib/accounts.js SETUP, deleted with the account, not with a profile); an account's older buckets of a
// scope are dropped on its first request of a new one. The email list's forms (/api/subscribe, /api/unsubscribe) need
// no account, so they count per sender instead (perDayFromIp). Kept outside functions/ so Pages doesn't route it.

import { noStore, setup } from "./accounts.js";
import { senderHash } from "./form.js";

// Counts one request in `bucket` ("<scope>:<minute or day>"); returns the count so far.
async function bump(env, userId, scope, bucket) {
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits (user_id, bucket, n) VALUES (?, ?, 1) ON CONFLICT (user_id, bucket) DO UPDATE SET n = n + 1 RETURNING n"
  ).bind(userId, bucket).first();
  if (row?.n === 1) {
    await env.DB.prepare("DELETE FROM rate_limits WHERE user_id = ? AND bucket LIKE ? AND bucket < ?")
      .bind(userId, `${scope}:%`, bucket).run();
  }
  return row?.n || 0;
}

// Counts one request; false once the account is over `limit` this minute.
export async function perMinute(env, userId, scope, limit, now = new Date()) {
  return (await bump(env, userId, scope, `${scope}:${now.toISOString().slice(0, 16)}`)) <= limit;
}

// Counts one request this hour (UTC); false once over `limit` this hour. Shared text (/api/contribute, LOR-235) counts
// per sender without an account: the key is "ip:<daily IP hash>" there (lib/form.js senderHash), never an account id.
export async function perHour(env, key, scope, limit, now = new Date()) {
  return (await bump(env, key, scope, `${scope}:${now.toISOString().slice(0, 13)}`)) <= limit;
}

// Counts one use today (UTC); false once the account is over `limit` today.
export async function perDay(env, userId, scope, limit, now = new Date()) {
  return (await bump(env, userId, scope, `${scope}:${now.toISOString().slice(0, 10)}`)) <= limit;
}

// Counts one request from this sender today (UTC); false once they're over `limit` today. The sender is the daily IP
// hash (lib/form.js), kept as user_id "ip:<hash>". That hash is new every day, so the first request of a day drops
// the scope's older rows for every sender, not just this one.
export async function perDayFromIp(env, request, scope, limit, now = new Date()) {
  await setup(env);
  const day = now.toISOString().slice(0, 10);
  const who = "ip:" + await senderHash(env, request.headers.get("CF-Connecting-IP") || "", day);
  const bucket = `${scope}:${day}`;
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits (user_id, bucket, n) VALUES (?, ?, 1) ON CONFLICT (user_id, bucket) DO UPDATE SET n = n + 1 RETURNING n"
  ).bind(who, bucket).first();
  if (row?.n === 1) {
    await env.DB.prepare("DELETE FROM rate_limits WHERE user_id LIKE 'ip:%' AND bucket LIKE ? AND bucket < ?")
      .bind(`${scope}:%`, bucket).run();
  }
  return (row?.n || 0) <= limit;
}

// The 429 for perMinute: the page waits retryAfter seconds (the rest of this minute) and goes on by itself.
export function slowDown(now = new Date()) {
  const retryAfter = 60 - now.getUTCSeconds();
  return Response.json({ ok: false, error: "Going a little fast. Carrying on in a moment...", retryAfter },
    { status: 429, headers: { ...noStore, "Retry-After": String(retryAfter) } });
}
