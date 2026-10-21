// Only the private dashboard bridge creates these DB wrappers. This is not a request flag:
// callers cannot turn off maintenance by passing a query parameter or an environment string.
const reports = new WeakMap();
export const isReportRead = env => reports.has(env?.DB);
export function refuseReportEffect(env, effect) {
  const fail = reports.get(env?.DB);
  if (fail) fail(`A report attempted ${effect}.`);
}

export class ReportReadError extends Error {
  constructor(message) { super(message); this.name = "ReportReadError"; }
}

// Defense in depth for shared legacy report code. A suppressed/caught SQL error still makes
// the whole response unavailable: never disguise an absent table or blocked write as zero.
export function reportDatabase(source) {
  const db = source.withSession ? source.withSession("first-primary") : source;
  const failures = [];
  const statements = new WeakMap();
  const fail = message => { const error = new ReportReadError(message); failures.push(error); throw error; };
  function readSql(sql) {
    const words = String(sql).replace(/'(?:''|[^'])*'/g, "''")
      .replace(/"(?:""|[^"])*"/g, '""').replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
    if (!/^(SELECT|WITH)\b/i.test(words) || /;\s*\S|\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|ANALYZE|load_extension)\b/i.test(words)) {
      fail("A report attempted a non-read database operation.");
    }
  }
  async function run(fn) {
    try { return await fn(); }
    catch (error) { failures.push(error); throw error; }
  }
  function wrap(statement) {
    const wrapped = {
      bind: (...args) => { try { return wrap(statement.bind(...args)); } catch (error) { failures.push(error); throw error; } },
      all: (...args) => run(() => statement.all(...args)),
      first: (...args) => run(() => statement.first(...args)),
      raw: (...args) => run(() => statement.raw(...args)),
      run: () => fail("A report attempted to run a database command."),
    };
    statements.set(wrapped, statement);
    return wrapped;
  }
  const wrapped = {
    prepare(sql) {
      readSql(sql);
      try { return wrap(db.prepare(sql)); } catch (error) { failures.push(error); throw error; }
    },
    batch(list) {
      if (list.some(s => !statements.has(s))) fail("Unknown report statement.");
      return run(() => db.batch(list.map(s => statements.get(s))));
    },
    exec: () => fail("A report attempted to execute database commands."),
    dump: () => fail("Database export is not a report."),
  };
  reports.set(wrapped, fail);
  return { DB: wrapped, assertHealthy() {
    if (failures.length) {
      const error = new ReportReadError("Report data is unavailable; no partial or zero-filled report was returned.");
      error.cause = new AggregateError(failures);
      throw error;
    }
  } };
}
