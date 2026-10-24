import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequest } from "../functions/api/dashboard-admin/[endpoint].js";
import { onRequestGet as legacyWilloGet } from "../functions/api/admin/willo.js";
import { onRequestPost as legacyCreatorsPost } from "../functions/api/admin/creators.js";
import { reportDatabase } from "../lib/report-read.js";
import { validateAction, validateQuery, READ_QUERIES } from "../lib/dashboard-admin-contract.js";
import { setup } from "../lib/accounts.js";
import { setupBilling } from "../lib/billing.js";
import { setupReferrals } from "../lib/referrals.js";
import { setupStores } from "../lib/stores.js";
import { setupSources } from "../lib/sources.js";
import { setupFeedback } from "../lib/answer-feedback.js";
import { setupKnowledge } from "../lib/forever-knowledge.js";
import { setup as setupContrib } from "../lib/contribute.js";
import { setupSubmissions } from "../lib/submissions.js";
import { setupReports } from "../lib/reports.js";
import { setupPlanUsage } from "../lib/plan-usage.js";
import { setupFeatureUsage, featureReport } from "../lib/featureuse.js";
import { saveCheckin } from "../lib/checkins.js";
import { setupWinback, SENDERS, SENDER } from "../lib/winback.js";
import { retentionReport } from "../lib/retention.js";
import { EMAIL_SETUP } from "../lib/email.js";
import { sendEmail, sendOnce } from "../lib/email.js";
import { stripe } from "../lib/billing.js";
import { saveSnapshot as saveVoice } from "../lib/voice-status.js";
import { saveSnapshot as saveCost } from "../lib/costs.js";
import { d1, assets } from "./helpers.mjs";

const base = "https://loreforeverwow.com/api/dashboard-admin/";
const sql = readFileSync(new URL("../migrations/dashboard-admin.sql", import.meta.url), "utf8");
let contribSchema;
const read = (env, endpoint, headers = {}, method = "GET") => onRequest({ env,
  params: { endpoint: endpoint.split("?")[0] }, request: new Request(base + endpoint,
    { method, headers: { Authorization: "Bearer read-secret", ...headers } }) });
const post = (env, endpoint, body, key = "request-0001", headers = {}) => onRequest({ env, params: { endpoint },
  request: new Request(base + endpoint, { method: "POST", headers: { Authorization: "Bearer write-secret",
    "Content-Type": "application/json", "Idempotency-Key": key, "X-Dashboard-Actor": "mike.liu.dev@gmail.com", ...headers }, body: JSON.stringify(body) }) });
async function reviewedNote(env) {
  const input = { action: "preview", id: "evt_test", subject: "Subject", text: "Hey {name},\nExact note" };
  const preview = await post(env, "retention", input);
  assert.equal(preview.status, 200, await preview.clone().text());
  return { ...input, action: "write", reviewed: (await preview.json()).draft };
}
async function fixture() {
  const env = { DB: d1(), DASHBOARD_READ_KEY: "read-secret", DASHBOARD_WRITE_KEY: "write-secret",
    ASSETS: assets({ "/data/contribute-known.json": {} }) };
  await setup(env); await setupBilling(env); await setupReferrals(env); await setupStores(env); await setupSources(env);
  await setupFeedback(env); await setupKnowledge(env); await setupContrib(env); await setupSubmissions(env);
  // The legacy contribution setup runs once per worker. Each isolated test database
  // receives the same schema, without changing that production setup behavior.
  if (contribSchema) env.DB.sqlite.exec(contribSchema);
  else contribSchema = env.DB.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name LIKE 'contrib_%' AND sql IS NOT NULL")
    .all().map(row => row.sql).join(";");
  await setupPlanUsage(env); await setupFeatureUsage(env); await setupWinback(env);
  env.DB.sqlite.exec(EMAIL_SETUP.join(";"));
  await saveCheckin(env, { install: "test", companion: "0.24.0", addon: "0.24.0" });
  await saveVoice(env, { format: 1, generated_at: "2026-10-19T00:00:00Z" });
  await saveCost(env, JSON.parse(/'(\{"taken_at".*\})'/.exec(readFileSync(new URL("../migrations/cost-snapshots.sql", import.meta.url), "utf8"))[1]));
  env.DB.sqlite.exec(sql);
  // Public forms' baseline tables are normally created by their deployment/form setup.
  for (const [file, name] of [["feedback", "SETUP"], ["click", "SETUP"]]) {
    const source = readFileSync(new URL(`../functions/api/${file}.js`, import.meta.url), "utf8");
    const statement = source.match(new RegExp(`const ${name} = ([\x60\x22])([\\s\\S]*?)\\1;`));
    env.DB.sqlite.exec(statement[2]);
  }
  env.DB.sqlite.exec(`CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, source TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS downloads (day TEXT, file TEXT, n INTEGER, PRIMARY KEY(day,file));
    CREATE TABLE IF NOT EXISTS download_sources (day TEXT, file TEXT, src TEXT, n INTEGER);
    CREATE TABLE IF NOT EXISTS site_counts (day TEXT, metric TEXT, n INTEGER);`);
  // Translation forms own these two tables (not the account schema).
  for (const file of ["translations.js", "translations/report.js"]) {
    const source = readFileSync(new URL(`../functions/api/${file}`, import.meta.url), "utf8");
    const statement = source.match(/const SETUP = `([\s\S]*?)`;/);
    env.DB.sqlite.exec(statement[1]);
  }
  await setupReports(env);
  const now = new Date().toISOString(), day = now.slice(0, 10);
  env.DB.sqlite.exec(`INSERT INTO users (id, email, display_name, created) VALUES ('u_test', 'test@example.com', 'Test Player', '${now}');
    INSERT INTO plan_log (subscription_id, user_id, plan, status, started, canceled, discounts, comp, updated)
      VALUES ('sub_test', 'u_test', 'hero', 'active', '${now}', '${now}', '[]', '', '${now}');
    INSERT INTO plan_cancellations (id, subscription_id, user_id, plan, kind, at, counted, created)
      VALUES ('evt_test', 'sub_test', 'u_test', 'hero', 'scheduled', '${now}', 1, '${now}');
    INSERT INTO best_first (claim, user_id, used, started) VALUES ('claim_test', 'u_test', 1, '${now}');
    INSERT INTO promo_claims (claim, subscription_id, created) VALUES ('free:user:u_test', 'free-test', '${now}');
    INSERT INTO install_usage (install, day, counts, internal) VALUES ('test', '${day}', '{"play.zone":3,"min":4}', 0);
    INSERT INTO creators (code, name, discount, share_pct, months, gift, created, connect_id, connect_ready)
      VALUES ('test', 'Test', 15, 60, 3, 0, '${now}', 'acct_test', 1);
    INSERT INTO referral_settings (key, value, updated) VALUES ('stripe_payouts', 'on', '${now}');
    INSERT INTO creator_earnings (invoice_id, creator, paid_cents, share_cents, pct, paid_at, recorded, payable_at)
      VALUES ('in_test', 'test', 5000, 3000, 60, '${now}', '${now}', '${now}');
    INSERT INTO answer_feedback (kind, said, user_hash, created, status)
      VALUES ('report', 'Expired report', 'expired', '2000-01-01T00:00:00.000Z', 'new'),
             ('report', 'Current report', 'current', '${now}', 'new');`);
  return env;
}

test("bridge denies wrong role credentials, browser calls, unknown actions and bounded queries before DB work", async () => {
  const env = { DASHBOARD_READ_KEY: "read-secret", DASHBOARD_WRITE_KEY: "write-secret", DB: { prepare() { throw Error("must not touch DB"); } } };
  assert.equal((await read(env, "main", { Authorization: "Bearer write-secret" })).status, 401);
  assert.equal((await read(env, "main", { Origin: "https://loreforeverwow.com" })).status, 403);
  assert.equal((await post(env, "main", { action: "pay-day" })).status, 400);
  assert.equal((await post(env, "main", { action: "delete-feedback", id: 1 }, "request-0001", { Authorization: "Bearer read-secret" })).status, 401);
  assert.equal((await post(env, "main", { action: "delete-feedback", id: 1 }, "request-0001", { "X-Dashboard-Actor": "patrick@example.com" })).status, 403);
  assert.equal((await post(env, "costs", {})).status, 405);
  assert.equal((await read(env, "willo-build")).status, 404);
  assert.equal((await read(env, "main?ignored=true")).status, 400);
  assert.equal((await read(env, "translation-review?limit=2001")).status, 400);
  assert.equal((await read(env, "willo?queue=1&answers=1")).status, 400);
  assert.throws(() => validateAction("translation-decide", { status: "accepted", ids: [1] }));
  assert.throws(() => validateAction("creators", { action: "approve", id: "a", code: "x", share_pct: 90 }));
  assert.throws(() => validateAction("creators", { action: "pay", code: "x", method: "stripe" }));
  assert.throws(() => validateAction("main", { action: "delete-feedback", id: [1] }));
  assert.equal(validateAction("clip-reject", { uploader: "ip:anonymous-player-hash" }), "clip-reject");
  assert.equal(validateAction("main", { action: "contrib-reject", uploader: "i:install-id" }), "contrib-reject");
  assert.throws(() => validateQuery("sources", new URLSearchParams("from=2026-02-30")));
});

test("SQL guard rejects writes and remembers swallowed read errors", async () => {
  const db = d1(); db.sqlite.exec("CREATE TABLE t(id INTEGER)");
  const guard = reportDatabase(db);
  assert.throws(() => guard.DB.prepare("WITH x AS (SELECT 1) DELETE FROM t"));
  assert.throws(() => guard.DB.prepare("SELECT 1; DELETE FROM t"));
  assert.throws(() => guard.DB.prepare("PRAGMA user_version = 2"));
  assert.throws(() => guard.DB.prepare("SELECT 1").run());
  await guard.DB.prepare("SELECT missing FROM t").all().catch(() => null);
  assert.throws(() => guard.assertHealthy());
  const clean = reportDatabase(db);
  assert.equal(await clean.DB.prepare("WITH x AS (SELECT 'UPDATE') SELECT 1 AS n").first("n"), 1);
  clean.assertHealthy();
});

test("a caught provider mutation is still a failed report, and reads use the primary session", async () => {
  const db = d1(); let sessions = 0;
  db.withSession = constraint => { assert.equal(constraint, "first-primary"); sessions++; return db; };
  const report = reportDatabase(db), env = { DB: report.DB };
  assert.equal(sessions, 1);
  await sendEmail(env, {}).catch(() => {});
  await stripe(env, "POST", "transfers", {}).catch(() => {});
  assert.throws(() => report.assertHealthy());
});

test("Search Console cache misses and unavailable downloads remain read-only and explicit", async () => {
  const env = await fixture(), original = globalThis.fetch, cache = globalThis.caches;
  const { privateKey } = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  env.GSC_SERVICE_ACCOUNT = JSON.stringify({ client_email: "dashboard-test@example.com",
    private_key: "-----BEGIN PRIVATE KEY-----\n" + Buffer.from(await crypto.subtle.exportKey("pkcs8", privateKey)).toString("base64") + "\n-----END PRIVATE KEY-----" });
  globalThis.caches = { default: { match() { throw Error("must not use public cache"); }, put() { throw Error("must not write cache"); } } };
  globalThis.fetch = async (url, options) => {
    if (String(url) === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "fake", expires_in: 3600 });
    if (String(url).startsWith("https://searchconsole.googleapis.com/")) {
      assert.equal(options.method, "POST");
      return Response.json({ rows: [{ keys: ["https://loreforeverwow.com/test", "query"], clicks: 2, impressions: 10, ctr: .2, position: 1 }] });
    }
    throw Error("provider unavailable");
  };
  const before = env.DB.sqlite.prepare("SELECT total_changes() AS n").get().n;
  try {
    const search = await read(env, "sources?search=1");
    assert.equal(search.status, 200);
    assert.equal((await search.json()).search.pages[0].clicks, 2);
    const downloads = await (await read(env, "downloads")).json();
    assert.equal(downloads.total, null);
    assert.equal(downloads.github, null);
    assert.equal(downloads.curseforge, null);
    assert.equal(env.DB.sqlite.prepare("SELECT total_changes() AS n").get().n, before);
  } finally { globalThis.fetch = original; if (cache === undefined) delete globalThis.caches; else globalThis.caches = cache; }
});

test("all report routes read existing data without DDL, cleanup, backfills, cached writes, or external sends", async () => {
  const env = await fixture();
  const original = globalThis.fetch;
  env.STRIPE_SECRET_KEY = "sk_test_fake";
  env.EMAIL = { send() { throw Error("A report must not send mail"); } };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push([String(url), options.method || "GET"]);
    if (String(url).includes("api.github.com")) return Response.json([]);
    if (String(url).includes("cfwidget")) return Response.json({ downloads: { total: 12 } });
    throw Error("Unexpected provider request");
  };
  const state = () => env.DB.sqlite.prepare("SELECT total_changes() AS n").get().n;
  try {
    const before = state();
    const preflight = readFileSync(new URL("../migrations/dashboard-admin-preflight.sql", import.meta.url), "utf8");
    for (const statement of preflight.replace(/^--.*$/gm, "").split(";").filter(s => s.trim()))
      assert.doesNotThrow(() => assert.deepEqual(env.DB.sqlite.prepare(statement).all(), []), statement);
    for (const endpoint of [...Object.keys(READ_QUERIES), "willo?answers=1", "willo?queue=1", "willo?quality=1", "sources?search=1", "retention?paid=1"]) {
      const response = await read(env, endpoint);
      const body = await response.json();
      assert.equal(response.status, 200, endpoint + ": " + JSON.stringify(body));
      assert.equal(state(), before, endpoint + " changed product DB");
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      if (endpoint === "main") assert.equal(body.willo.taste.tasters, 1, "real trial data, not a swallowed date error");
      if (endpoint === "retention") { assert.equal(body.subscribers[0].paid, null); assert.equal(body.totals.unread, 1); }
      if (endpoint === "willo") assert.deepEqual(body.feedback.rows.map(r => r.said), ["Current report"]);
      if (endpoint === "willo?queue=1") assert.deepEqual(body.queue.rows.map(r => r.said), ["Current report"]);
      if (endpoint === "willo?quality=1") assert.equal(body.quality.reports.open.new, 1);
    }
    assert.ok(calls.every(([, method]) => method === "GET"));
    assert.equal((await read(env, "costs", {}, "HEAD")).status, 200);
    assert.equal(await (await read(env, "costs", {}, "HEAD")).text(), "");
  } finally { globalThis.fetch = original; }
});

test("read-only feature trend matches the legacy fresh rollup without persisting it", async () => {
  const env = await fixture(), now = Date.now();
  const guard = reportDatabase(env.DB), before = env.DB.sqlite.prepare("SELECT total_changes() AS n").get().n;
  const pure = await featureReport({ ...env, DB: guard.DB }, now);
  guard.assertHealthy();
  assert.equal(env.DB.sqlite.prepare("SELECT total_changes() AS n").get().n, before);
  assert.equal(pure.trend.at(-1).use.narration, 1);
  assert.deepEqual(pure, await featureReport(env, now));
});

test("legacy report callers still perform their existing cleanup after bridge reads", async () => {
  const env = await fixture();
  env.ADMIN_KEY = "legacy-test-key";
  const before = await (await read(env, "willo")).json();
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_feedback").get().n, 2);
  const legacy = await legacyWilloGet({ env, request: new Request("https://loreforeverwow.com/api/admin/willo",
    { headers: { Authorization: "Bearer legacy-test-key" } }) });
  assert.equal(legacy.status, 200);
  assert.deepEqual(await legacy.json(), before);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_feedback").get().n, 1);
});

test("email duplicate during dispatch and completed replay send only once", async () => {
  const env = await fixture(); let sends = 0, entered, finish;
  const started = new Promise(resolve => { entered = resolve; });
  const release = new Promise(resolve => { finish = resolve; });
  env.EMAIL = { async send() { sends++; entered(); await release; return { messageId: "test-message" }; } };
  const body = await reviewedNote(env);
  const first = post(env, "retention", body);
  await started;
  assert.equal((await post(env, "retention", body)).status, 409);
  finish();
  assert.equal((await first).status, 200);
  assert.equal((await post(env, "retention", body)).headers.get("Idempotency-Replayed"), "true");
  assert.equal(sends, 1);
});

test("lost audit completion after an accepted email cannot cause a second send", async () => {
  const env = await fixture(); let sends = 0;
  env.EMAIL = { async send() { sends++; return { messageId: "accepted-email" }; } };
  const body = await reviewedNote(env), prepare = env.DB.prepare;
  env.DB.prepare = sql => {
    if (sql.startsWith("UPDATE dashboard_admin_actions")) throw Error("audit storage unavailable");
    return prepare(sql);
  };
  assert.equal((await post(env, "retention", body)).status, 502);
  assert.equal((await post(env, "retention", body)).status, 409);
  assert.equal(env.DB.sqlite.prepare("SELECT state FROM dashboard_admin_actions").get().state, "pending");
  env.DB.prepare = prepare;
  await post(env, "retention", body, "another-send-key");
  assert.equal(sends, 1);
  assert.equal(env.DB.sqlite.prepare("SELECT status FROM email_sends").get().status, "sent");
});

test("provider timeouts preserve email and payout claims, even with a fresh request key", async () => {
  const env = await fixture(); let emails = 0, transfers = 0;
  env.EMAIL = { async send() { emails++; throw Error("timeout after accepting mail"); } };
  env.STRIPE_SECRET_KEY = "sk_test_fake";
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.stripe.com/v1/transfers");
    assert.equal(options.method, "POST");
    transfers++; throw Error("timeout after accepting transfer");
  };
  try {
    for (const [endpoint, body] of [["retention", await reviewedNote(env)],
      ["creators", { action: "pay", code: "test", method: "stripe", expected_cents: 3000 }]]) {
      assert.equal((await post(env, endpoint, body, `${endpoint}-first`)).status, 502);
      assert.equal((await post(env, endpoint, body, `${endpoint}-first`)).status, 409);
      const fresh = await post(env, endpoint, body, `${endpoint}-fresh`);
      if (endpoint === "retention") {
        assert.equal(fresh.status, 502);
        assert.equal((await fresh.json()).code, "action_outcome_unknown");
        assert.equal(env.DB.sqlite.prepare("SELECT state FROM dashboard_admin_actions WHERE request_key = 'retention-fresh'").get().state, "unknown");
      }
    }
    // An old caller still receives its documented "already claimed" result.
    assert.equal(await sendOnce(env, { id: "winback:sub_test", kind: "winback",
      message: { to: "test@example.com", subject: "Ignored", text: "Ignored" } }), "seen");
    assert.equal(emails, 1); assert.equal(transfers, 1);
    assert.equal(env.DB.sqlite.prepare("SELECT status FROM email_sends").get().status, "sending");
    assert.ok(env.DB.sqlite.prepare("SELECT payout_id FROM creator_earnings").get().payout_id);
  } finally { globalThis.fetch = original; }
});

test("payout transfers only the reviewed claimed amount, while legacy payout callers keep their contract", async () => {
  const env = await fixture(), original = globalThis.fetch;
  env.STRIPE_SECRET_KEY = "sk_test_fake";
  let transfers = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.stripe.com/v1/transfers");
    assert.equal(new URLSearchParams(options.body).get("amount"), "4000");
    transfers++;
    return Response.json({ id: "tr_reviewed" });
  };
  try {
    const body = { action: "pay", code: "test", method: "stripe", expected_cents: 3000 };
    // More becomes payable after the owner has reviewed 3000 cents.
    env.DB.sqlite.exec("UPDATE creator_earnings SET share_cents = 4000");
    const stale = await post(env, "creators", body);
    assert.equal(stale.status, 409, await stale.clone().text());
    assert.equal(transfers, 0);
    assert.equal(env.DB.sqlite.prepare("SELECT payout_id FROM creator_earnings").get().payout_id, null);
    const reviewed = { ...body, expected_cents: 4000 };
    const paid = await post(env, "creators", reviewed, "reviewed-payout");
    assert.equal(paid.status, 200, await paid.clone().text());
    assert.equal((await paid.json()).payout.cents, 4000);
    assert.equal((await post(env, "creators", reviewed, "reviewed-payout")).headers.get("Idempotency-Replayed"), "true");
    assert.equal(transfers, 1);
    const legacyEnv = await fixture();
    legacyEnv.ADMIN_KEY = "legacy-key";
    const legacy = await legacyCreatorsPost({ env: legacyEnv, request: new Request("https://loreforeverwow.com/api/admin/creators", {
      method: "POST", headers: { Authorization: "Bearer legacy-key", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pay", code: "test", method: "manual" }),
    }) });
    assert.equal(legacy.status, 200, await legacy.clone().text());
    assert.equal((await legacy.json()).payout.cents, 3000);
  } finally { globalThis.fetch = original; }
});

test("a plan cancelled before the cancellation log began can be previewed from the dashboard", async () => {
  const env = await fixture();
  env.DB.sqlite.exec("DELETE FROM plan_cancellations");   // cancelled before the log (lib/cancellations.js ALL_CANCELLATIONS)
  const [row] = (await retentionReport(env)).cancellations;
  assert.equal(row.note, "yes");
  const preview = await post(env, "retention", { action: "preview", id: row.id, subject: "S", text: "Hi {name}" }, "preview-before-log");
  assert.equal(preview.status, 200, await preview.clone().text());
  assert.equal((await preview.json()).draft.to, "test@example.com");
});

test("retention preview writes nothing, and send refuses an unreviewed or changed recipient/message", async () => {
  const env = await fixture(); let sent = 0;
  env.EMAIL = { async send() { sent++; return { messageId: "test" }; } };
  const before = env.DB.sqlite.prepare("SELECT total_changes() AS n").get().n;
  const body = await reviewedNote(env);
  assert.equal(env.DB.sqlite.prepare("SELECT total_changes() AS n").get().n, before);
  assert.equal(body.reviewed.to, "test@example.com");
  assert.equal(body.reviewed.from, SENDERS[SENDER].from);
  assert.match(body.reviewed.text, /^Hey Test,\nExact note/);
  // Patrick's, when the box picks him.
  const patrick = await post(env, "retention", { action: "preview", id: "evt_test", as: "patrick", subject: "S", text: "T" },
    "preview-patrick");
  assert.equal((await patrick.json()).draft.from, SENDERS.patrick.from);
  assert.match(body.reviewed.text, /https:\/\/loreforeverwow.com\/unsubscribe/);
  const { reviewed, ...without } = body;
  assert.equal((await post(env, "retention", without)).status, 400);
  assert.equal((await post(env, "retention", { ...body, reviewed: { ...reviewed, text: "Different" } }, "different-body")).status, 409);
  env.DB.sqlite.exec("UPDATE users SET email = 'new@example.com' WHERE id = 'u_test'");
  assert.equal((await post(env, "retention", body)).status, 409);
  assert.equal(sent, 0);
});

test("same idempotency key runs a mutation once, rejects changed content, and preserves exact audit input", async () => {
  const env = await fixture();
  const body = { action: "status", id: 7, status: "done", resolution: "kept", reason: "  Line one\nLine two  " };
  env.DB.sqlite.exec("INSERT INTO feedback (id, created, kind, message, sender) VALUES (7, '2026-10-19', 'bug', 'a', 'test')");
  const first = await post(env, "main", body);
  assert.equal(first.status, 200, await first.clone().text());
  const before = env.DB.sqlite.prepare("SELECT total_changes() AS n").get().n;
  const second = await post(env, "main", body);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("Idempotency-Replayed"), "true");
  assert.equal(env.DB.sqlite.prepare("SELECT total_changes() AS n").get().n, before);
  assert.equal((await post(env, "main", { ...body, reason: "Different" })).status, 409);
  const audit = env.DB.sqlite.prepare("SELECT * FROM dashboard_admin_actions").get();
  assert.equal(JSON.parse(audit.request_json).reason, body.reason);
  assert.equal(audit.actor, "mike.liu.dev@gmail.com");
  assert.equal(audit.state, "completed");
});

test("unknown outcome never re-executes, and missing schema never looks like zero data", async () => {
  const env = await fixture();
  const body = { action: "delete-feedback", id: 1 };
  const original = env.DB.prepare;
  let executions = 0;
  env.DB.prepare = sql => {
    if (sql === "DELETE FROM feedback WHERE id = ?") { executions++; throw Error("connection lost after dispatch"); }
    return original(sql);
  };
  assert.equal((await post(env, "main", body)).status, 502);
  const retry = await post(env, "main", body);
  assert.equal(retry.status, 409);
  assert.equal((await retry.json()).code, "action_outcome_unknown");
  assert.equal(executions, 1);
  assert.equal((await read({ ...env, DB: d1() }, "main")).status, 503);
});
