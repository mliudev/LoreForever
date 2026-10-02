// Per-account limits per minute (LOR-121), so uploading a whole zip or kit at once can't flood the site: the upload
// page (/api/studio/take) and kit imports on the translation dashboard (/api/translations/import). The page waits
// and carries on when it gets a 429 with retryAfter. Counts live in the D1 table rate_limits (lib/accounts.js SETUP,
// deleted with the account); a user's older minutes are dropped on their next first request of a minute.
// Kept outside functions/ so Pages doesn't route it.

import { noStore } from "./accounts.js";

// Counts one request; false once the account is over `limit` this minute.
export async function perMinute(env, userId, scope, limit, now = new Date()) {
  const bucket = `${scope}:${now.toISOString().slice(0, 16)}`;
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits (user_id, bucket, n) VALUES (?, ?, 1) ON CONFLICT (user_id, bucket) DO UPDATE SET n = n + 1 RETURNING n"
  ).bind(userId, bucket).first();
  if (row?.n === 1) {
    await env.DB.prepare("DELETE FROM rate_limits WHERE user_id = ? AND bucket LIKE ? AND bucket < ?")
      .bind(userId, `${scope}:%`, bucket).run();
  }
  return (row?.n || 0) <= limit;
}

// The 429 for perMinute: the page waits retryAfter seconds (the rest of this minute) and goes on by itself.
export function slowDown(now = new Date()) {
  const retryAfter = 60 - now.getUTCSeconds();
  return Response.json({ ok: false, error: "Going a little fast. Carrying on in a moment...", retryAfter },
    { status: 429, headers: { ...noStore, "Retry-After": String(retryAfter) } });
}
