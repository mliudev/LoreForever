import { isReportRead } from "./report-read.js";
// Voice work status for /admin/voices.html (Mike 10/16: "an up to date matrix of voice work at all times").
// The PC posts one JSON snapshot every 10 minutes (POST /api/admin/voice-status, from the Voice Coordinator's
// status/post.sh); the page shows the latest. Format 1 is described by status/collect.py in lore-voice-renders:
// machines[], jobs[], matrix {columns, rows, cells, questgivers}, prs[], events[], decisions[].
//
// voice_status          one row (id 1): the latest snapshot as posted (body), when it was made (generated_at) and
//                       when we got it (received_at)
// voice_status_history  a small summary of each snapshot, newest HISTORY_KEEP kept, for the progress sparkline:
//                       how many of the live recordings are up to date, and the running jobs' progress

export const MAX_BYTES = 1024 * 1024;
export const HISTORY_KEEP = 144;   // a day of snapshots at one every 10 minutes

const SETUP = [
  `CREATE TABLE IF NOT EXISTS voice_status (id INTEGER PRIMARY KEY CHECK (id = 1), generated_at TEXT NOT NULL,
    received_at TEXT NOT NULL, body TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS voice_status_history (generated_at TEXT PRIMARY KEY, received_at TEXT NOT NULL,
    current_n INTEGER NOT NULL, count_n INTEGER NOT NULL, done_n INTEGER NOT NULL, total_n INTEGER NOT NULL)`,
];

const ready = new WeakMap();
async function setup(env) {
  if (isReportRead(env)) return;
  if (ready.get(env.DB)) return;
  await env.DB.batch(SETUP.map(s => env.DB.prepare(s)));
  ready.set(env.DB, true);
}

const num = v => (Number.isFinite(v) ? v : 0);
const list = v => (Array.isArray(v) ? v : []);

// Throws RangeError (the caller answers 400) unless it is a format 1 snapshot with a time it was made.
export function checkSnapshot(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RangeError("Expected a JSON object.");
  if (body.format !== 1) throw new RangeError("Only format 1 is understood.");
  if (typeof body.generated_at !== "string" || Number.isNaN(Date.parse(body.generated_at))) {
    throw new RangeError("generated_at is missing or not a time.");
  }
  for (const k of ["machines", "jobs", "prs", "events", "decisions"]) {
    if (body[k] != null && !Array.isArray(body[k])) throw new RangeError(`${k} must be a list.`);
  }
  if (body.matrix != null && (typeof body.matrix !== "object" || Array.isArray(body.matrix))) throw new RangeError("matrix must be an object.");
}

// The numbers the sparkline plots: recordings up to date out of recordings shipped (live cells and the quest givers),
// and the running jobs' done out of total.
export function summarize(body) {
  let current = 0, count = 0, done = 0, total = 0;
  const m = body.matrix || {};
  for (const c of Object.values(m.cells || {})) {
    if (c && c.status === "live") { current += num(c.current); count += num(c.count); }
  }
  const q = m.questgivers;
  if (q) { current += num(q.current); count += num(q.count); }
  for (const j of list(body.jobs)) {
    if (j && j.state === "running") { done += num(j.done); total += num(j.total); }
  }
  return { current, count, done, total };
}

export async function saveSnapshot(env, body, now = Date.now()) {
  checkSnapshot(body);
  await setup(env);
  const received = new Date(now).toISOString();
  const s = summarize(body);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO voice_status (id, generated_at, received_at, body) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET generated_at = excluded.generated_at, received_at = excluded.received_at, body = excluded.body`)
      .bind(body.generated_at, received, JSON.stringify(body)),
    env.DB.prepare(`INSERT INTO voice_status_history (generated_at, received_at, current_n, count_n, done_n, total_n)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(generated_at) DO UPDATE SET received_at = excluded.received_at,
      current_n = excluded.current_n, count_n = excluded.count_n, done_n = excluded.done_n, total_n = excluded.total_n`)
      .bind(body.generated_at, received, s.current, s.count, s.done, s.total),
    env.DB.prepare(`DELETE FROM voice_status_history WHERE generated_at NOT IN
      (SELECT generated_at FROM voice_status_history ORDER BY generated_at DESC LIMIT ${HISTORY_KEEP})`),
  ]);
  return { generated_at: body.generated_at, received_at: received };
}

// {status: <the latest snapshot or null>, received_at, history: oldest first}
export async function latestSnapshot(env) {
  await setup(env);
  const row = await env.DB.prepare("SELECT generated_at, received_at, body FROM voice_status WHERE id = 1").first();
  const { results } = await env.DB.prepare(
    "SELECT generated_at AS at, current_n AS current, count_n AS count, done_n AS done, total_n AS total FROM voice_status_history ORDER BY generated_at DESC LIMIT ?")
    .bind(HISTORY_KEEP).all();
  return {
    status: row ? JSON.parse(row.body) : null,
    received_at: row ? row.received_at : null,
    history: results.reverse(),
  };
}
