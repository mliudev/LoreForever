import { isReportRead } from "./report-read.js";
// What Lore Forever costs, for the Costs tab on /admin. Mike's Operations session checks each vendor's dashboard and
// posts one snapshot (POST /api/admin/costs); the page reads the latest (GET). Snapshots are admin-only: they live in
// D1 (cost_snapshots), never in a public file. The last KEEP are kept so a later change can show a trend.
// The JSON shape is documented in site/README.md ("Costs"); validateSnapshot below is the authority.

export const KEEP = 30;
export const KINDS = ["fixed", "usage", "prepaid"];   // fixed subscription, pay for what's used, prepaid balance

const DAY = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
const MAX_SERVICES = 60;

const money = (v, what, { optional = false } = {}) => {
  if (v == null && optional) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e6) throw new RangeError(`${what} must be a number of dollars`);
  return Math.round(v * 100) / 100;
};
const text = (v, what, max, { optional = false } = {}) => {
  if (v == null && optional) return undefined;
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new RangeError(`${what} must be text of up to ${max} characters`);
  return v.trim();
};

// Checks a posted snapshot and returns it cleaned (unknown fields dropped). Throws RangeError saying what's wrong.
export function validateSnapshot(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RangeError("Expected a JSON object");
  const taken_at = text(body.taken_at, "taken_at", 40);
  if (!DAY.test(taken_at) || Number.isNaN(Date.parse(taken_at))) throw new RangeError("taken_at must be a date like 2026-10-16");
  const out = { taken_at, budget_monthly: money(body.budget_monthly, "budget_monthly") };

  if (body.revenue != null) {
    const r = body.revenue;
    if (typeof r !== "object" || Array.isArray(r)) throw new RangeError("revenue must be an object");
    out.revenue = { gross: money(r.gross, "revenue.gross"), fees: money(r.fees, "revenue.fees"), net: money(r.net, "revenue.net") };
    const note = text(r.note, "revenue.note", 400, { optional: true });
    if (note) out.revenue.note = note;
  }

  if (!Array.isArray(body.services) || !body.services.length || body.services.length > MAX_SERVICES) {
    throw new RangeError(`services must be a list of 1 to ${MAX_SERVICES}`);
  }
  out.services = body.services.map((s, i) => {
    const at = `services[${i}]`;
    if (!s || typeof s !== "object" || Array.isArray(s)) throw new RangeError(`${at} must be an object`);
    if (!KINDS.includes(s.kind)) throw new RangeError(`${at}.kind must be one of ${KINDS.join(", ")}`);
    const row = {
      name: text(s.name, `${at}.name`, 80), use: text(s.use, `${at}.use`, 160, { optional: true }), kind: s.kind,
      month_to_date: money(s.month_to_date, `${at}.month_to_date`), monthly_estimate: money(s.monthly_estimate, `${at}.monthly_estimate`),
      balance: money(s.balance, `${at}.balance`, { optional: true }), cap: money(s.cap, `${at}.cap`, { optional: true }),
      note: text(s.note, `${at}.note`, 500, { optional: true }), renews: text(s.renews, `${at}.renews`, 80, { optional: true }),
    };
    for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
    return row;
  });

  const nc = body.not_checked ?? [];
  if (!Array.isArray(nc) || nc.length > 40) throw new RangeError("not_checked must be a list of up to 40 lines");
  out.not_checked = nc.map((t, i) => text(t, `not_checked[${i}]`, 200));
  return out;
}

const ready = new WeakSet();
async function ensure(db) {
  if (ready.has(db)) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS cost_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, taken_at TEXT NOT NULL, json TEXT NOT NULL)").run();
  ready.add(db);
}

// Saves a snapshot: the same taken_at again replaces that one, else it's added; only the newest KEEP stay.
export async function saveSnapshot(env, body) {
  const snap = validateSnapshot(body);
  await ensure(env.DB);
  const json = JSON.stringify(snap);
  const same = await env.DB.prepare("SELECT id FROM cost_snapshots WHERE taken_at = ? ORDER BY id DESC LIMIT 1").bind(snap.taken_at).first();
  if (same) await env.DB.prepare("UPDATE cost_snapshots SET json = ? WHERE id = ?").bind(json, same.id).run();
  else await env.DB.prepare("INSERT INTO cost_snapshots (taken_at, json) VALUES (?, ?)").bind(snap.taken_at, json).run();
  await env.DB.prepare("DELETE FROM cost_snapshots WHERE id NOT IN (SELECT id FROM cost_snapshots ORDER BY id DESC LIMIT ?)").bind(KEEP).run();
  return { taken_at: snap.taken_at, services: snap.services.length };
}

// The newest snapshot (the one posted last, whatever its date) and how many are kept; snapshot is null before the first.
export async function latestSnapshot(env) {
  if (!isReportRead(env)) await ensure(env.DB);
  const row = await env.DB.prepare("SELECT json FROM cost_snapshots ORDER BY id DESC LIMIT 1").first();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM cost_snapshots").first("n");
  return { snapshot: row ? JSON.parse(row.json) : null, kept: n };
}
