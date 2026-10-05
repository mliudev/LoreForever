// The email list (D1 table subscribers), shared by the home page's sign-up (functions/api/subscribe.js) and
// /unsubscribe (functions/api/unsubscribe.js). Kept outside functions/ so Pages doesn't route it.

export const SETUP = `CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY, source TEXT, created_at TEXT NOT NULL)`;

const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

// The address as the list keeps it (trimmed, lower case), or "" when it doesn't look like one.
export function listEmail(raw) {
  const email = String(raw ?? "").trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : "";
}

// Sends one sender (the daily IP hash, lib/ratelimit.js perDayFromIp) can make per day. Generous for sign-ups, since
// a school or a phone network can put many people behind one address; tighter for unsubscribing, which needs no
// proof that the address is yours.
export const PER_DAY = { subscribe: 20, unsubscribe: 10 };
