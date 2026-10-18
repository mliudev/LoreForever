// What became of a report a player sent from the site (LOR-621): feedback (functions/api/feedback.js) and bad
// translations (functions/api/translations/report.js). /admin closes one as fixed, or as kept as it is with why; after
// a release, the fixed ones closed before its release commit say "Fixed in X.Y.Z" (shipReports: POST /api/admin
// reports-shipped, which lore.kit shipped sends from scripts/post-release.sh). The sender reads it on My contributions
// (lib/contributions.js) when they were signed in. Kept outside functions/ so Pages doesn't route it.

const COLUMNS = {
  feedback: ["status TEXT NOT NULL DEFAULT 'new'", "user_id TEXT", "resolution TEXT", "reason TEXT", "resolved TEXT",
    "fixed_in TEXT"],
  translation_reports: ["user_id TEXT", "resolution TEXT", "reason TEXT", "resolved TEXT", "fixed_in TEXT"],
};
export const TABLES = Object.keys(COLUMNS);

// The columns above on tables made before them (a table not made yet gets them from its own CREATE). Once per database
// and Worker; another cold Worker may add one at the same moment.
const ready = new WeakMap();
export async function setupReports(env) {
  if (ready.get(env.DB)) return;
  let all = true;
  for (const [table, columns] of Object.entries(COLUMNS)) {
    const have = new Set((await env.DB.prepare(`PRAGMA table_info(${table})`).all()).results.map(c => c.name));
    if (!have.size) { all = false; continue; }   // made later, with these columns or by a later call
    for (const column of columns) {
      if (have.has(column.split(" ")[0])) continue;
      try { await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column}`).run(); }
      catch (e) { if (!/duplicate column/i.test(String(e?.message))) throw e; }
    }
  }
  if (all) ready.set(env.DB, true);
}

// /admin: open again (status new), or done as fixed or kept (reason: why, for the sender). Returns whether it changed.
export async function resolveReport(env, table, id, status, resolution = null, reason = null) {
  if (!TABLES.includes(table) || !["new", "done"].includes(status)) return false;
  await setupReports(env);
  const done = status === "done";
  const how = done && ["fixed", "kept"].includes(resolution) ? resolution : null;
  const why = how === "kept" ? String(reason || "").replace(/\s+/g, " ").trim().slice(0, 300) || null : null;
  const res = await env.DB.prepare(
    `UPDATE ${table} SET status = ?, resolution = ?, reason = ?, resolved = ?, fixed_in = NULL WHERE id = ?`
  ).bind(status, how, why, done ? new Date().toISOString() : null, id).run();
  return (res.meta?.changes || 0) > 0;
}

// After release X.Y.Z: the reports fixed before its release commit (`before`) were fixed in it.
export async function shipReports(env, release, before) {
  await setupReports(env);
  let n = 0;
  for (const table of TABLES) {
    const res = await env.DB.prepare(
      `UPDATE ${table} SET fixed_in = ? WHERE resolution = 'fixed' AND fixed_in IS NULL AND resolved IS NOT NULL
         AND resolved <= ?`).bind(release, new Date(before).toISOString()).run();
    n += res.meta?.changes || 0;
  }
  return n;
}

// What the sender reads about one report.
export function reportOutcome(r) {
  if (r.status !== "done") return { key: "waiting", label: "Waiting: we read every report" };
  if (r.resolution === "fixed") {
    return r.fixed_in ? { key: "shipped", label: `Fixed in ${r.fixed_in}` }
      : { key: "shipped", label: "Fixed: goes out with the next update" };
  }
  if (r.resolution === "kept") return { key: "done", label: `Kept as it is${r.reason ? `: ${r.reason}` : ""}` };
  return { key: "done", label: "Done: we've looked at it" };
}
