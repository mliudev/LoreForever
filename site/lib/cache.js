// Results too costly to work out on every page view, kept in D1 (cached_results, lib/accounts.js). D1's free plan
// allows 5M rows read a day; on 2026-10-10 the translator credits on /translate and /contributors read every saved
// edit (~57k rows a view) and used 90% of it. Kept outside functions/ so Pages doesn't route it.

import { setup } from "./accounts.js";

// The value under `key`, or build(env)'s, saved for next time. It's built again once stamp(env) (a one-row read that
// changes with the data, like the newest row's id) differs and the saved value is at least minAge seconds old, and
// whatever the stamp once it's maxAge old. dropCached makes the next read build it again: for the changes the stamp
// can't see, like a name hidden on /account.
export async function cached(env, key, { stamp, minAge = 600, maxAge = 6 * 3600 }, build) {
  await setup(env);
  const now = Math.floor(Date.now() / 1000);
  const [row, current] = await Promise.all([
    env.DB.prepare("SELECT stamp, built, json FROM cached_results WHERE key = ?").bind(key).first(),
    stamp(env).then(String),
  ]);
  if (row) {
    const age = now - row.built;
    if (age >= 0 && age < maxAge && (row.stamp === current || age < minAge)) return JSON.parse(row.json);
  }
  const value = await build(env);
  try {
    await env.DB.prepare(
      "INSERT INTO cached_results (key, stamp, built, json) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT (key) DO UPDATE SET stamp = excluded.stamp, built = excluded.built, json = excluded.json"
    ).bind(key, current, now, JSON.stringify(value)).run();
  } catch (e) { /* not saved: the next view builds it again */ }
  return value;
}

export async function dropCached(env, key) {
  try { await env.DB.prepare("DELETE FROM cached_results WHERE key = ?").bind(key).run(); }
  catch (e) { /* no table yet: nothing cached */ }
}
