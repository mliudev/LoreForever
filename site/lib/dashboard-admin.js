import { hasBearer } from "./auth.js";
import { reportDatabase } from "./report-read.js";
import { dashboardActionDatabase } from "./dashboard-action.js";
import { previewNote, writeNote } from "./winback.js";
import { payCreator } from "./referrals.js";
import { ContractError, READ_QUERIES, WRITE_NAMES, validateAction, validateQuery } from "./dashboard-admin-contract.js";
import * as main from "../functions/api/admin.js";
import * as costs from "../functions/api/admin/costs.js";
import * as creators from "../functions/api/admin/creators.js";
import * as curseforge from "../functions/api/admin/curseforge.js";
import * as plans from "../functions/api/admin/plans-usage.js";
import * as retention from "../functions/api/admin/retention.js";
import * as sources from "../functions/api/admin/sources.js";
import * as voices from "../functions/api/admin/voice-status.js";
import * as willo from "../functions/api/admin/willo.js";
import * as translations from "../functions/api/translations/[action].js";
import * as clips from "../functions/api/clip-report/[action].js";
import * as downloads from "../functions/api/downloads.js";
import { northStarReport } from "./north-star.js";
import { poolReport } from "./free-pool.js";

const HANDLERS = { main, costs, creators, curseforge, "plans-usage": plans, retention, sources,
  "voice-status": voices, willo, downloads,
  // A report of its own, with no old /admin route behind it.
  "north-star": { onRequestGet: async ({ env }) => Response.json(await northStarReport(env)) },
  // The free pool alone (the same pool block /api/admin carries), small enough for the dashboard to read every few minutes.
  pool: { onRequestGet: async ({ env }) => Response.json({ ok: true, pool: await poolReport(env) }) } };
const SUBROUTES = { "translation-summary": [translations, "summary"], "translation-review": [translations, "review"],
  "translation-decide": [translations, "decide"], "clip-export": [clips, "export"],
  "clip-resolve": [clips, "resolve"], "clip-reject": [clips, "reject"] };
const NAMES = new Set([...Object.keys(READ_QUERIES), ...WRITE_NAMES]);
const PRIVATE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "Vary": "Authorization" };
const fail = (status, error, code) => Response.json({ ok: false, error, ...(code ? { code } : {}) }, { status, headers: PRIVATE });
const digest = async text => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, "0")).join("");
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;

async function privateResponse(response, { replayed = false, head = false } = {}) {
  const headers = new Headers(PRIVATE);
  for (const key of ["Content-Type", "Server-Timing", "X-Source-Updated-At", "X-Source-Fetched-At"]) {
    if (response.headers.has(key)) headers.set(key, response.headers.get(key));
  }
  if (replayed) headers.set("Idempotency-Replayed", "true");
  return new Response(head ? null : response.body, { status: response.status, headers });
}

// The old handlers stay available to their old callers. Internally the new bridge supplies
// a per-call key, avoiding dependency on the presence/value of a legacy admin secret.
async function invoke(name, request, env, body) {
  const internalKey = crypto.randomUUID();
  const url = new URL(request.url);
  const sub = SUBROUTES[name];
  url.pathname = sub ? `/api/${name.startsWith("translation-") ? "translations" : "clip-report"}/${sub[1]}`
    : name === "main" ? "/api/admin" : name === "downloads" ? "/api/downloads" : `/api/admin/${name}`;
  const method = body === undefined ? "GET" : "POST";
  const internal = new Request(url, { method, headers: { Authorization: `Bearer ${internalKey}`,
    ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body }) });
  const context = { request: internal, env: { ...env, ADMIN_KEY: internalKey, FEEDBACK_KEY: "" },
    params: sub ? { action: sub[1] } : {} };
  if (name === "creators" && body !== undefined) {
    const input = JSON.parse(body);
    if (input.action === "pay") {
      const out = await payCreator(env, input.code.trim().toLowerCase(), {
        note: input.note, expectedCents: Number(input.expected_cents) });
      return out.error ? Response.json({ ok: false, error: out.error }, { status: out.status || 400 })
        : Response.json({ ok: true, ...out });
    }
  }
  if (name === "retention" && body !== undefined) {
    const input = JSON.parse(body);
    const out = input.action === "preview" ? await previewNote(env, input)
      : await writeNote(env, input, { reviewed: input.reviewed });
    return out.error ? Response.json({ ok: false, error: out.error }, { status: out.status || 400 })
      : Response.json({ ok: true, ...out });
  }
  return sub ? sub[0].onRequest(context) : HANDLERS[name][method === "GET" ? "onRequestGet" : "onRequestPost"](context);
}

async function boundedBody(request) {
  const limit = 64 * 1024;
  if (Number(request.headers.get("Content-Length")) > limit) throw new ContractError("Too big.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ContractError("Expected JSON.");
  const parts = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new ContractError("Too big.", 413); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

// Claim before dispatch. A crash/timeout leaves pending, which is deliberately NOT leased or
// retried: a payment/email could already have happened. Reconcile it, don't execute it again.
async function mutate(name, request, env, raw, body, action, actor, key) {
  const DB = env.DB.withSession ? env.DB.withSession("first-primary") : env.DB;
  const hash = await digest(JSON.stringify({ name, actor, body: canonical(body) }));
  const claim = await DB.prepare("INSERT OR IGNORE INTO dashboard_admin_actions " +
    "(request_key, actor, endpoint, action, request_hash, request_json, state, started) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)")
    .bind(key, actor, name, action, hash, raw, new Date().toISOString()).run();
  if (!claim.meta?.changes) {
    const existing = await DB.prepare("SELECT * FROM dashboard_admin_actions WHERE request_key = ?").bind(key).first();
    if (!existing || existing.request_hash !== hash) return fail(409, "This request key was already used for a different action.", "idempotency_conflict");
    if (existing.state !== "completed") return fail(409, "This action may already have run. Check its outcome before trying another request.", "action_outcome_unknown");
    return privateResponse(new Response(existing.response_body, { status: existing.response_status,
      headers: { "Content-Type": existing.response_type || "application/json" } }), { replayed: true });
  }
  try {
    const actionDB = dashboardActionDatabase(DB);
    const response = await invoke(name, request, { ...env, DB: actionDB.DB }, raw);
    actionDB.assertKnown();
    const output = await response.text();
    if (output.length > 1024 * 1024) throw new Error("Action response too large to record.");
    const saved = await DB.prepare("UPDATE dashboard_admin_actions SET state = 'completed', finished = ?, " +
      "response_status = ?, response_type = ?, response_body = ? WHERE request_key = ? AND state = 'pending'")
      .bind(new Date().toISOString(), response.status, response.headers.get("Content-Type") || "application/json", output, key).run();
    if (saved.meta?.changes !== 1) throw new Error("Action outcome could not be recorded.");
    return privateResponse(new Response(output, { status: response.status, headers: response.headers }));
  } catch (error) {
    try { await DB.prepare("UPDATE dashboard_admin_actions SET state = 'unknown', finished = ? WHERE request_key = ? AND state = 'pending'")
      .bind(new Date().toISOString(), key).run(); } catch { /* pending is equally non-retryable */ }
    console.error("dashboard admin action outcome unknown", { endpoint: name, requestKey: key });
    return fail(502, "The action's outcome could not be confirmed. Check it before trying another request.", "action_outcome_unknown");
  }
}

export async function dashboardAdmin({ request, env, params }) {
  const name = String(params.endpoint || "");
  if (!NAMES.has(name)) return fail(404, "No such admin view.");
  if (!["GET", "HEAD", "POST"].includes(request.method)) return fail(405, "Use GET, HEAD or POST.");
  // This credential is for server-to-server calls, never an alternate browser login.
  if (request.headers.has("Origin")) return fail(403, "Use the private team dashboard.");
  const reading = request.method !== "POST";
  const key = reading ? env.DASHBOARD_READ_KEY : env.DASHBOARD_WRITE_KEY;
  if (!key || env.DASHBOARD_READ_KEY === env.DASHBOARD_WRITE_KEY) return fail(503, "Dashboard access is not configured.");
  if (!(await hasBearer(request, key))) return fail(401, "Needs the dashboard credential.");
  if (!env.DB) return fail(503, "Product database is unavailable.");
  try {
    const url = new URL(request.url);
    if (reading) {
      validateQuery(name, url.searchParams);
      const report = reportDatabase(env.DB);
      const response = await invoke(name, request, { ...env, DB: report.DB });
      report.assertHealthy();
      const result = await privateResponse(response, { head: request.method === "HEAD" });
      result.headers.set("X-Source-Fetched-At", new Date().toISOString());
      return result;
    }
    if (url.search) throw new ContractError("Action queries are not supported.");
    const actor = request.headers.get("X-Dashboard-Actor") || "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor) || actor.length > 254) return fail(403, "Needs the authorized owner's email.");
    const allowedOwners = String(env.DASHBOARD_OWNER_EMAILS || "mike.liu.dev@gmail.com").toLowerCase().split(",").map(s => s.trim());
    if (!allowedOwners.includes(actor.toLowerCase())) return fail(403, "This identity cannot change product data.");
    const idempotencyKey = request.headers.get("Idempotency-Key") || "";
    if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(idempotencyKey)) throw new ContractError("Needs a valid Idempotency-Key.");
    if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") || "")) throw new ContractError("Expected application/json.", 415);
    let raw, body;
    try { raw = await boundedBody(request); body = JSON.parse(raw); }
    catch (error) { if (error instanceof ContractError) throw error; throw new ContractError("Expected valid JSON."); }
    const action = validateAction(name, body);
    if (name === "retention" && action === "preview") {
      const report = reportDatabase(env.DB);
      const response = await invoke(name, request, { ...env, DB: report.DB }, raw);
      report.assertHealthy();
      return privateResponse(response);
    }
    return await mutate(name, request, env, raw, body, action, actor.toLowerCase(), idempotencyKey);
  } catch (error) {
    if (error instanceof ContractError) return fail(error.status, error.message);
    // No queries, parameters, secrets or player records in errors/logs.
    console.error("dashboard admin unavailable", { endpoint: name, type: error?.name || "Error" });
    return fail(503, "This report or action is unavailable. Check the product database and its deployment migrations.", "product_admin_unavailable");
  }
}
