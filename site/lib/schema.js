// One look at the database's tables per isolate, shared by every module's setup (the Software Architect's 10/21
// review, item 2). Each module made its tables with a CREATE ... IF NOT EXISTS batch, and added its newer columns with
// ALTER TABLE ... ADD COLUMN statements that fail once the column is there, the first time an isolate used it: a cold
// isolate's first answer sent about 50 of them, a round trip or more each, before Willo could start, and a launch
// spike is mostly cold isolates. Now the first setup reads sqlite_master once (each table's CREATE statement, which
// SQLite rewrites as columns are added) and every module sends only what's missing: nothing, once it's all there.
// Statements that make or add nothing named (a seed row, a backfill) always run, as before. Kept outside functions/ so
// Pages doesn't route it.

const NAMED = /^\s*CREATE\s+(?:UNIQUE\s+|VIRTUAL\s+)?(?:TABLE|INDEX|TRIGGER)\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/i;
const ADD = /^\s*ALTER\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+ADD\s+COLUMN\s+([A-Za-z_][A-Za-z0-9_]*)/i;
const CONSTRAINT = /^(?:PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i;
const seen = new WeakMap();

// The columns a CREATE TABLE statement makes (its column definitions' names, not its constraints).
export function columnsOf(sql) {
  const body = String(sql || "").slice(String(sql).indexOf("(") + 1, String(sql).lastIndexOf(")"));
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "(") depth++;
    else if (body[i] === ")") depth--;
    else if (body[i] === "," && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  return new Set(parts.map(p => p.trim()).filter(p => p && !CONSTRAINT.test(p))
    .map(p => /^["`[]?([A-Za-z_][A-Za-z0-9_]*)/.exec(p)?.[1]?.toLowerCase()).filter(Boolean));
}

// {names: the tables, indexes and triggers there, sql: each one's CREATE statement}, as this isolate first saw them
// (and added to since).
export function existing(env) {
  let schema = seen.get(env.DB);
  if (!schema) {
    schema = env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger')").all()
      .then(r => ({ names: new Set(r.results.map(row => row.name)), sql: new Map(r.results.map(row => [row.name, row.sql])) }));
    schema.catch(() => seen.delete(env.DB));   // a failed look is tried again next time
    seen.set(env.DB, schema);
  }
  return schema;
}

// Runs the CREATE statements whose table, index or trigger isn't there yet, in one batch.
export async function createMissing(env, statements) {
  const { names } = await existing(env);
  const missing = statements.filter(sql => !names.has(NAMED.exec(sql)?.[1]));
  if (!missing.length) return;
  await env.DB.batch(missing.map(sql => env.DB.prepare(sql)));
  for (const sql of missing) { const name = NAMED.exec(sql)?.[1]; if (name) names.add(name); }
}

// Runs the ALTER TABLE ... ADD COLUMN statements whose column isn't there yet, and any CREATE ... IF NOT EXISTS whose
// object isn't, all at once. Each may fail on its own (another isolate added it first) without failing the rest.
export async function addMissing(env, statements) {
  const { names, sql } = await existing(env);
  const missing = statements.filter(s => {
    const add = ADD.exec(s);
    if (add) return !(sql.has(add[1]) && columnsOf(sql.get(add[1])).has(add[2].toLowerCase()));
    const made = NAMED.exec(s);
    return !(made && names.has(made[1]));
  });
  await Promise.all(missing.map(s => env.DB.prepare(s).run().catch(() => {})));
}
