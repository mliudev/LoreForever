// The plans lifecycle against real Stripe, in TEST mode only (lib/billing.js, Mike's policy of 2026-10-13/14): each
// scenario's customer sits on its own Stripe test clock, the clock is advanced for renewals and failed payments, and
// refunds and disputes are real test-mode ones (the dispute test card). Stripe's own events are fetched from its API
// and posted, signed with a local secret, to a LOCAL copy of the site (`wrangler pages dev` with a throwaway local
// D1); develop's and Production's D1 are never touched. Three copies run side by side: one without the beta promo, one
// inside it (LAUNCH_WEEK_START three days ago, BETA_END in a week) and one after it (it ended yesterday). What the
// site decides at a test clock's time (it runs on the real clock) is read with lib/billing.js itself over the same
// local D1.
//
//   node site/tests/stripe-lifecycle.mjs            (from the repo, in WSL; Node 24, npx for wrangler)
//   node site/tests/stripe-lifecycle.mjs --launch   the beta promo's cases only (L*, C7)
//
// Not a *.test.mjs: it needs the network, a test key (STRIPE_SECRET_KEY, else the repo's .env; a live key is refused)
// and a few minutes. Prints a PASS/FAIL table and writes it as JSON beside the temp dir it names; deletes its test
// clocks (and so their customers) when it's done.
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, createWriteStream } from "node:fs";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const VERSION = "2026-08-26.dahlia";
const KEY = (() => {
  let k = process.env.STRIPE_SECRET_KEY;
  const env = path.join(os.homedir(), "git/lore-forever/.env");
  if (!k && existsSync(env)) for (const line of readFileSync(env, "utf8").split(/\r?\n/)) {
    const m = /^\s*STRIPE_SECRET_KEY\s*=\s*(.*?)\s*$/.exec(line);
    if (m) { k = m[1].replace(/^(['"])(.*)\1$/, "$2"); break; }
  }
  if (!/^[sr]k_test_/.test(k || "")) { console.error("Needs a TEST Stripe key (sk_test_ or rk_test_)."); process.exit(2); }
  return k;
})();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = Math.floor(Date.now() / 1000);
const RUN = randomBytes(3).toString("hex");
const iso = ms => new Date(ms).toISOString();

// ---- Stripe ----
function form(params, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    const kk = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, kk, out); else out.append(kk, String(v));
  }
  return out;
}
async function S(method, p, params, { idem, quiet } = {}) {
  const body = form(params).toString();
  for (let attempt = 0; ; attempt++) {
    const headers = { Authorization: `Bearer ${KEY}`, "Stripe-Version": VERSION };
    if (method !== "GET") headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (idem) headers["Idempotency-Key"] = idem;
    const res = await fetch(`https://api.stripe.com/v1/${p}${method === "GET" && body ? "?" + body : ""}`,
      { method, headers, body: method === "GET" ? undefined : body });
    if (res.status === 429 && attempt < 8) { await sleep(500 * (attempt + 1)); continue; }
    const data = await res.json();
    if (res.ok) return data;
    const e = new Error(`${method} ${p}: ${res.status} ${data?.error?.message}`.replace(/\b(?:[sr]k|whsec)_[\w*]+/g, "[key]"));
    if (quiet) return { error: e };
    throw e;
  }
}
const clocks = [];
async function newClock(name) {
  const c = await S("POST", "test_helpers/test_clocks", { frozen_time: Math.floor(Date.now() / 1000), name: `lf-${RUN}-${name}` });
  clocks.push(c.id);
  return c;
}
async function advance(clock, to) {
  await S("POST", `test_helpers/test_clocks/${clock}/advance`, { frozen_time: Math.floor(to) });
  for (let i = 0; i < 300; i++) {
    const c = await S("GET", `test_helpers/test_clocks/${clock}`);
    if (c.status === "ready") return c;
    if (c.status === "internal_failure") throw new Error("test clock failed");
    await sleep(2000);
  }
  throw new Error("test clock didn't finish advancing");
}
let P = {};   // price ids by lookup key

// ---- Stripe's events, gathered once for everyone ----
const events = new Map();   // id -> event (as Stripe lists it)
let polling = null, high = T0 - 5;
async function poll() {
  if (polling) return polling;
  polling = (async () => {
    let after, top = high;
    do {
      const page = await S("GET", "events", { limit: 100, created: { gte: high - 3 }, ...(after ? { starting_after: after } : {}) });
      for (const e of page.data) { if (!events.has(e.id)) events.set(e.id, e); top = Math.max(top, e.created); }
      after = page.has_more ? page.data.at(-1).id : null;
    } while (after);
    high = top;
  })().finally(() => { polling = null; });
  return polling;
}
const matches = (e, ids) => { const s = JSON.stringify(e.data?.object || {}); return ids.some(id => id && s.includes(id)); };

// ---- The local sites ----
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(() => resolve(port)); });
});
const TMP = mkdtempSync(path.join(os.tmpdir(), "lf-lifecycle-"));
const children = [];
async function startSite(name, vars) {
  const dir = path.join(TMP, name), persist = path.join(TMP, `${name}-d1`);
  cpSync(path.join(REPO, "site"), dir, { recursive: true, filter: s => !s.includes(`${path.sep}node_modules`) });
  const secret = `whsec_local_${randomBytes(16).toString("hex")}`;
  // GEMINI_API_KEY: the companion's allowance answers only with one set; nothing here asks the model anything.
  writeFileSync(path.join(dir, ".dev.vars"), Object.entries({ SITE_FEATURES: "plans", STRIPE_SECRET_KEY: KEY,
    STRIPE_WEBHOOK_SECRET: secret, GEMINI_API_KEY: "lifecycle-never-called", ...vars }).map(([k, v]) => `${k}='${v}'`).join("\n") + "\n", { mode: 0o600 });
  const port = await freePort(), inspector = await freePort();
  const log = createWriteStream(path.join(TMP, `${name}.log`));
  const child = spawn("npx", ["-y", "wrangler@4", "pages", "dev", "public", "--d1", "DB=local-db", "--r2", "STUDIO",
    "--persist-to", persist, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(inspector)],
    { cwd: dir, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" } });
  const redact = s => s.split(KEY).join("[key]").split(secret).join("[whsec]");
  child.stdout.on("data", d => log.write(redact(d.toString())));
  child.stderr.on("data", d => log.write(redact(d.toString())));
  children.push(child);
  const base = `http://127.0.0.1:${port}`;
  for (let t = Date.now(); Date.now() - t < 240_000;) {
    try {
      const r = await fetch(`${base}/api/billing/plans`, { signal: AbortSignal.timeout(15000) });
      if (r.ok && (await r.json()).on) break;
    } catch {}
    await sleep(1000);
  }
  const dbDir = path.join(persist, "v3", "d1", "miniflare-D1DatabaseObject");
  const file = path.join(dbDir, readdirSync(dbDir).find(n => n.endsWith(".sqlite") && n !== "metadata.sqlite"));
  const billing = await import(pathToFileURL(path.join(dir, "lib", "billing.js")).href + `?${name}`);
  return { name, base, secret, file, vars, billing, posted: new Set() };
}
process.on("exit", () => { for (const c of children) try { process.kill(-c.pid, "SIGKILL"); } catch {} });

// The local D1, read and written straight from its file.
function sql(site, q, ...args) {
  const d = new DatabaseSync(site.file);
  try { d.exec("PRAGMA busy_timeout = 10000"); const st = d.prepare(q); return /^\s*select/i.test(q) ? st.all(...args).map(r => ({ ...r })) : st.run(...args); }
  finally { d.close(); }
}
const row = (site, userId) => sql(site, "SELECT * FROM entitlements WHERE user_id = ?", userId)[0] || null;
// lib/billing.js over the same D1 file, for what the site decides at a test clock's moment.
function fileD1(file) {
  const run = (q, args, how) => {
    const d = new DatabaseSync(file);
    try { d.exec("PRAGMA busy_timeout = 10000"); const st = d.prepare(q); return how(st); } finally { d.close(); }
  };
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    async first(col) { const r = run(q, args, st => st.get(...args)); const p = r ? { ...r } : null; return p && col ? p[col] : p; },
    async all() { return { results: run(q, args, st => st.all(...args)).map(r => ({ ...r })) }; },
    async run() { return { meta: { changes: Number(run(q, args, st => st.run(...args)).changes) } }; },
  });
  return { prepare: q => stmt(q), async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}
const planAt = (site, userId, ms) => site.billing.planFor({ DB: fileD1(site.file), SITE_FEATURES: "plans", ...site.vars },
  userId, new Date(ms));

// A test player: account, a signed-in session (cookie) and a connected companion (device token).
const sha = s => createHash("sha256").update(s).digest("hex");
function player(site, label) {
  const id = `lc-${label}-${RUN}`, session = randomBytes(32).toString("hex"), device = randomBytes(32).toString("hex"), now = iso(Date.now());
  sql(site, "INSERT INTO users (id, email, google_sub, display_name, created, last_seen) VALUES (?, ?, ?, ?, ?, ?)",
    id, `${id}@lifecycle.test`, `sub-${id}`, label, now, now.slice(0, 10));
  sql(site, "INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)", sha(session), id, now, iso(Date.now() + 86400e3));
  sql(site, "INSERT INTO devices (id, token_hash, user_id, label, created, last_used) VALUES (?, ?, ?, ?, ?, ?)",
    randomUUID(), sha(device), id, "Lore Forever companion", now, now);
  return { id, session, device, label };
}
// The local D1 is one SQLite file that this script reads and writes too, so the site sometimes finds it locked and
// answers 500 or 502: tried again, as Stripe retries a webhook and a player clicks again (a confirm's quote makes that
// safe: Stripe's idempotency key, and a change that's already made is "already your plan").
async function api(site, method, p, user, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(site.base + p, { method, body: body ? JSON.stringify(body) : undefined,
      headers: { Origin: site.base, ...(user ? { Cookie: `lf_session=${user.session}` } : {}),
                 ...(body ? { "Content-Type": "application/json" } : {}) } });
    const json = await res.json().catch(() => null);
    if (res.status >= 500 && attempt < 6) { await sleep(800 * (attempt + 1)); continue; }
    return { status: res.status, json };
  }
}
async function allowance(site, user) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(site.base + "/api/companion/answer",
      { headers: { "X-LF-Client": "companion/lifecycle", Authorization: `Bearer ${user.device}` } });
    if (res.ok || attempt >= 6) return (await res.json().catch(() => ({}))).allowance;
    await sleep(800 * (attempt + 1));
  }
}
const change = (site, user, body) => api(site, "POST", "/api/billing/change", user, body);
const current = async (site, user) => (await api(site, "GET", "/api/billing/plans", user)).json;

// A Stripe customer on a test clock for the player, as checkout would make it (entitlements.customer_id). pm: the
// test card it pays with.
async function customerFor(site, user, clock, pm = "pm_card_visa") {
  const c = await S("POST", "customers", { test_clock: clock.id, email: `${user.id}@lifecycle.test`, metadata: { user_id: user.id },
    payment_method: pm, invoice_settings: { default_payment_method: pm } });
  sql(site, "INSERT INTO entitlements (user_id, customer_id, updated) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET customer_id = excluded.customer_id",
    user.id, c.id, iso(Date.now()));
  return c;
}
const subscribe = (customer, user, plan, extra = {}) => S("POST", "subscriptions", { customer: customer.id,
  items: [{ price: P[`${plan}_monthly`] }], metadata: { user_id: user.id, ...(extra.metadata || {}) },
  ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "metadata")) });
const invoices = async sub => (await S("GET", "invoices", { subscription: sub, limit: 20 })).data;
const piOf = async invoiceId => (await S("GET", "invoice_payments", { invoice: invoiceId, limit: 1 })).data[0]?.payment?.payment_intent;

// Posts the events about these ids (customers, payment intents) that this site hasn't had, signed, oldest first (or
// newest first with reverse; with dup, every one twice). wait: an event type to wait for (up to 60 s).
async function sync(site, ids, { reverse = false, dup = false, wait = null } = {}) {
  const t = Date.now();
  let quiet = 0, last = -1;
  while (true) {
    await poll();
    const mine = [...events.values()].filter(e => matches(e, ids));
    const waited = !wait || mine.some(e => e.type === wait);
    if (mine.length === last && waited) { if (++quiet >= 2) break; } else quiet = 0;
    last = mine.length;
    if (Date.now() - t > 60_000) break;
    await sleep(1500);
  }
  let todo = [...events.values()].filter(e => matches(e, ids) && !site.posted.has(e.id)).sort((a, b) => a.created - b.created);
  if (reverse) todo.reverse();
  if (dup) todo = [...todo, ...todo];
  const bad = [];
  for (const e of todo) {
    const body = JSON.stringify(e);
    let status = 0;
    // Stripe sends an event again until it gets a 2xx; so does this, a few times (see api above).
    for (let attempt = 0; attempt < 8 && status !== 200; attempt++) {
      if (attempt) await sleep(800 * attempt);
      const ts = Math.floor(Date.now() / 1000);
      const sig = createHmac("sha256", site.secret).update(`${ts}.${body}`).digest("hex");
      status = (await fetch(site.base + "/api/billing/webhook", { method: "POST", body,
        headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${ts},v1=${sig}` } })).status;
    }
    if (status !== 200) bad.push(`${e.type} ${status}`);
    site.posted.add(e.id);
  }
  return { posted: todo.length, bad };
}

// ---- The matrix ----
const results = [];
const check = (id, item, ok, evidence) => { results.push({ id, item, result: ok ? "PASS" : "FAIL", evidence }); return ok; };
const na = (id, item, evidence) => results.push({ id, item, result: "N/A", evidence });
const money = c => `$${(c / 100).toFixed(2)}`;
const safe = (id, fn) => fn().catch(e => results.push({ id, item: "(scenario error)", result: "FAIL", evidence: String(e?.message || e).slice(0, 300) }));

async function s1(site) {   // upgrade, its charge, the pool, double click, two tabs, cancel after it, mid-answer, packs
  const u = player(site, "upgrade"), clock = await newClock("s1"), cus = await customerFor(site, u, clock);
  sql(site, "INSERT INTO answer_packs (id, user_id, kind, answers, remaining, payment_intent, status, created) VALUES (?, ?, 'voice', 400, 400, ?, 'active', ?)",
    `cs_lc_${u.id}`, u.id, `pi_lc_${u.id}`, iso(Date.now()));
  const sub = await subscribe(cus, u, "hero");
  await sync(site, [cus.id]);
  const r0 = row(site, u.id);
  const key = site.billing.poolWindow({ renews: r0.current_period_end }, new Date()).key;
  sql(site, "INSERT INTO rate_limits (user_id, bucket, n) VALUES (?, ?, 3990)", u.id, `companion-month:${key}`);
  const before = await allowance(site, u);
  const pre = await change(site, u, { plan: "legend", from: "hero" });
  const q = pre.json?.preview;
  const t = Date.now();
  // A double click: the same confirm twice at once.
  const [a, b] = await Promise.all([1, 2].map(() => change(site, u, { plan: "legend", from: "hero", confirm: true, quote: q?.quote })));
  const after = row(site, u.id);
  const ups = (await invoices(sub.id)).filter(i => i.billing_reason === "subscription_update");
  const took = Math.round((Date.now() - t) / 1000);   // wall clock: an invoice's own times are its test clock's
  const done = [a, b].filter(x => x.json?.done);
  check("S1", "Upgrade: immediate, Stripe's proration charged now", after?.plan === "legend" && ups.length === 1 && ups[0].status === "paid",
    `Hero->Legend: D1 plan ${after?.plan} at once; ${ups.length} update invoice, ${ups[0]?.status}, ${money(ups[0]?.amount_paid ?? 0)}`);
  check("S6a", "Upgrade amount shown = amount charged", q && ups[0]?.amount_paid === q.amount,
    `confirm said "${q?.text}"; invoice ${ups[0]?.id} paid ${money(ups[0]?.amount_paid ?? 0)}`);
  check("S6b", "Upgrade produces a paid invoice within a minute", ups[0]?.status === "paid" && took < 60,
    `invoice ${ups[0]?.status} ${took} s after the click (wall clock)`);
  check("S6c", "Double click: one change, one charge", done.length >= 1 && ups.length === 1,
    `two confirms at once: ${[a, b].map(x => x.json?.done ? "done" : x.json?.error).join(" / ")}; ${ups.length} charge`);
  const left = await allowance(site, u);
  check("S1p", "New plan's month pool applies now; answers used count", before?.remaining === 0 && left?.plan?.id === "legend" &&
    left.remaining === 10 && left.period === "month", `3,990 used: Hero ${before?.remaining} left -> Legend ${left?.remaining} left (4,000 - 3,990), period ${left?.period}`);
  check("C8", "Plan change mid-answer: the next answer uses the new plan", before?.plan?.id === "hero" && left?.plan?.id === "legend",
    `allowance (read per request, as each answer is) says ${before?.plan?.id} then ${left?.plan?.id} with no wait for the webhook`);
  const stale = await change(site, u, { plan: "legend", from: "hero", confirm: true, quote: q?.quote });
  const ups2 = (await invoices(sub.id)).filter(i => i.billing_reason === "subscription_update");
  check("C1b", "Two tabs: a stale tab's confirm changes nothing", stale.status === 400 && ups2.length === 1,
    `old tab's confirm: "${stale.json?.error}"; still ${ups2.length} charge`);
  await sync(site, [cus.id]);
  // Cancel at the period's end (as the billing portal does), after the upgrade.
  await S("POST", `subscriptions/${sub.id}`, { cancel_at_period_end: true });
  await sync(site, [cus.id]);
  const pending = (await S("GET", "invoiceitems", { customer: cus.id, pending: true, limit: 10 })).data;
  check("S6d", "Cancel after an upgrade leaves no uncollected pending items", pending.length === 0 && row(site, u.id).cancel_at_period_end === 1,
    `${pending.length} pending invoice items after upgrade + cancel; D1 cancel_at_period_end ${row(site, u.id).cancel_at_period_end}`);
  const end = Date.parse(row(site, u.id).current_period_end);
  const keep = await planAt(site, u.id, end - 3600e3);
  await advance(clock.id, end / 1000 + 7200);
  await sync(site, [cus.id]);
  const gone = row(site, u.id), atEnd = await planAt(site, u.id, end + 7200e3);
  check("P3", "Cancel: plan kept to the period's end, then Free", keep.id === "legend" && gone.plan === "free" && atEnd.id === "free",
    `an hour before the end: ${keep.id}; after: D1 ${gone.plan}/${gone.status}, planFor ${atEnd.id}`);
  const pack = sql(site, "SELECT remaining, status FROM answer_packs WHERE user_id = ?", u.id)[0];
  // Coming back after the end: a new subscription and a new pool.
  const sub2 = await subscribe(cus, u, "hero");
  await sync(site, [cus.id]);
  const back = row(site, u.id);
  const k2 = site.billing.poolWindow({ renews: back.current_period_end }, new Date(end + 7300e3)).key;
  check("P3b", "Coming back after the end: fresh subscription, fresh pool", back.subscription_id === sub2.id && back.plan === "hero" && k2 !== key,
    `new ${sub2.id} (old ${sub.id}); pool key ${key} -> ${k2}`);
  const pack2 = sql(site, "SELECT remaining, status FROM answer_packs WHERE user_id = ?", u.id)[0];
  const free = await allowance(site, u);
  check("P8", "Voice pack survives every plan change; unusable on Free", pack.remaining === 400 && pack.status === "active" &&
    pack2.remaining === 400 && pack2.status === "active", `pack 400/active through upgrade, cancel, Free and back to Hero ` +
    `(on Free the voice step uses no pack: lib/companion-voice.js paying(); now ${free?.plan?.id})`);
}

async function s2(site) {   // downgrade, Keep, renewal across the pool window
  const u = player(site, "downgrade"), clock = await newClock("s2"), cus = await customerFor(site, u, clock);
  const sub = await subscribe(cus, u, "legend");
  await sync(site, [cus.id]);
  const n0 = (await invoices(sub.id)).length;
  const pre = await change(site, u, { plan: "hero", from: "legend" });
  const ok = await change(site, u, { plan: "hero", from: "legend", confirm: true, quote: pre.json?.preview?.quote });
  const c1 = (await current(site, u)).current;
  const n1 = (await invoices(sub.id)).length, bal = (await S("GET", `customers/${cus.id}`)).balance;
  check("P2", "Downgrade: at period end, no refund; /account says when", c1.id === "legend" && c1.changesTo?.id === "hero" && n1 === n0 && bal === 0,
    `"${pre.json?.preview?.text}" -> plan ${c1.id}, changesTo ${c1.changesTo?.name} on ${c1.changesTo?.at?.slice(0, 10)}; invoices ${n0}->${n1}, balance ${bal}`);
  const kept = await change(site, u, { plan: "legend", from: "legend", confirm: true });
  const c2 = (await current(site, u)).current, s2b = await S("GET", `subscriptions/${sub.id}`);
  check("S6e", "Pending downgrade undone with Keep", kept.json?.done && !c2.changesTo && !s2b.schedule,
    `Keep Legend: "${kept.json?.text}"; schedule ${s2b.schedule || "none"}`);
  const again = await change(site, u, { plan: "hero", from: "legend" });
  await change(site, u, { plan: "hero", from: "legend", confirm: true, quote: again.json?.preview?.quote });
  await sync(site, [cus.id]);
  const r = row(site, u.id), end = Date.parse(r.current_period_end);
  const w1 = site.billing.poolWindow({ renews: r.current_period_end }, new Date(end - 3600e3));
  await advance(clock.id, end / 1000 + 7200);
  await sync(site, [cus.id]);
  const r2 = row(site, u.id);
  const w2 = site.billing.poolWindow({ renews: r2.current_period_end }, new Date(end + 3600e3));
  const renewal = (await invoices(sub.id)).find(i => i.billing_reason === "subscription_cycle");
  check("S6f", "Scheduled downgrade happens at the renewal", r2.plan === "hero" && renewal?.amount_paid === 499 && !r2.next_plan,
    `after the renewal: D1 ${r2.plan}, renewal invoice ${money(renewal?.amount_paid ?? 0)}, next_plan ${r2.next_plan}`);
  check("C6", "Renewal crossing the pool window", w1.resetsAt === iso(end) && w1.key !== w2.key && w2.key === iso(end).slice(0, 10),
    `an hour before: pool ${w1.key}, resets ${w1.resetsAt} (= Stripe's period end); an hour after: pool ${w2.key}`);
}

async function s3(site) {   // upgrade then downgrade in the same period
  const u = player(site, "updown"), clock = await newClock("s3"), cus = await customerFor(site, u, clock);
  const sub = await subscribe(cus, u, "hero");
  await sync(site, [cus.id]);
  const up = await change(site, u, { plan: "champion", from: "hero" });
  await change(site, u, { plan: "champion", from: "hero", confirm: true, quote: up.json?.preview?.quote });
  const down = await change(site, u, { plan: "hero", from: "champion" });
  await change(site, u, { plan: "hero", from: "champion", confirm: true, quote: down.json?.preview?.quote });
  const c = (await current(site, u)).current;
  await sync(site, [cus.id]);
  const end = Date.parse(row(site, u.id).current_period_end);
  await advance(clock.id, end / 1000 + 7200);
  await sync(site, [cus.id]);
  const renewal = (await invoices(sub.id)).find(i => i.billing_reason === "subscription_cycle");
  check("C2", "Upgrade then downgrade in the same period", c.id === "champion" && c.changesTo?.id === "hero" &&
    row(site, u.id).plan === "hero" && renewal?.amount_paid === 499,
    `Hero->Champion (charged ${money(up.json?.preview?.amount ?? 0)}) then ->Hero: Champion to ${c.changesTo?.at?.slice(0, 10)}, renewal ${money(renewal?.amount_paid ?? 0)} as Hero`);
}

async function s4(site) {   // cancel, then Keep before the end
  const u = player(site, "keep"), clock = await newClock("s4"), cus = await customerFor(site, u, clock);
  const sub = await subscribe(cus, u, "hero");
  await S("POST", `subscriptions/${sub.id}`, { cancel_at_period_end: true });
  await sync(site, [cus.id]);
  const before = (await current(site, u)).current, n0 = (await invoices(sub.id)).length;
  const kept = await change(site, u, { plan: "hero", from: "hero", confirm: true });
  const s = await S("GET", `subscriptions/${sub.id}`), n1 = (await invoices(sub.id)).length;
  check("P3a", "Resubscribing before the end undoes the cancel, no new charge", before.cancelAtPeriodEnd && kept.json?.done &&
    !s.cancel_at_period_end && n1 === n0 && !(await current(site, u)).current.cancelAtPeriodEnd,
    `cancelled -> Keep Hero: "${kept.json?.text}"; Stripe cancel_at_period_end ${s.cancel_at_period_end}, invoices ${n0}->${n1}`);
}

async function s5(site) {   // failed renewal, a change during past_due, Stripe giving up; events out of order and twice
  const u = player(site, "dunning"), clock = await newClock("s5"), cus = await customerFor(site, u, clock);
  const sub = await subscribe(cus, u, "champion");
  await sync(site, [cus.id]);
  const fail = await S("POST", "payment_methods/pm_card_chargeCustomerFail/attach", { customer: cus.id });
  await S("POST", `customers/${cus.id}`, { invoice_settings: { default_payment_method: fail.id } });
  const end = Date.parse(row(site, u.id).current_period_end);
  await advance(clock.id, end / 1000 + 7200);
  await sync(site, [cus.id]);
  const due = row(site, u.id), cur = (await current(site, u)).current;
  check("P4", "Failed renewal: past_due keeps the plan, 'update your card'", due.status === "past_due" && cur.id === "champion" && cur.status === "past_due",
    `renewal declined: D1 ${due.plan}/${due.status}; /plans and /account say "update your card" for status past_due`);
  const up = await change(site, u, { plan: "legend", from: "champion" });
  const down = await change(site, u, { plan: "hero", from: "champion" });
  const downOk = await change(site, u, { plan: "hero", from: "champion", confirm: true, quote: down.json?.preview?.quote });
  check("C3", "A change during past_due", up.status === 400 && downOk.json?.done,
    `upgrade: "${up.json?.error}"; downgrade at renewal: ${downOk.json?.done ? "scheduled" : downOk.json?.error}`);
  // Stripe's retries run out (Smart Retries, up to about 3 weeks in this account).
  for (const days of [12, 24, 36]) await advance(clock.id, end / 1000 + days * 86400);
  const s = await S("GET", `subscriptions/${sub.id}`);
  const r = await sync(site, [cus.id], { reverse: true, dup: true });
  const last = row(site, u.id);
  check("P4b", "When Stripe gives up: Free", ["canceled", "unpaid"].includes(s.status) ? last.plan === "free" : false,
    `after 36 days Stripe says ${s.status}; D1 ${last.plan}/${last.status}`);
  check("C5", "Webhook events out of order or duplicated", r.bad.length === 0 && last.status === s.status,
    `${r.posted} deliveries (newest first, each twice): ${r.bad.length} errors; D1 status ${last.status} = Stripe's ${s.status}`);
}

async function s6(site) {   // refunds: part of a payment keeps the plan, the whole of it ends it
  const u = player(site, "refund"), clock = await newClock("s6"), cus = await customerFor(site, u, clock);
  const sub = await subscribe(cus, u, "champion");
  await sync(site, [cus.id]);
  const pi = await piOf((await invoices(sub.id))[0].id);
  await S("POST", "refunds", { payment_intent: pi, amount: 100 });
  await sync(site, [cus.id, pi]);
  const part = row(site, u.id);
  await S("POST", "refunds", { payment_intent: pi });
  await sync(site, [cus.id, pi]);
  const s = await S("GET", `subscriptions/${sub.id}`), whole = row(site, u.id);
  check("P5", "Refund (whole payment): plan ends now, Free", part.plan === "champion" && s.status === "canceled" && whole.plan === "free",
    `$1.00 refunded: still ${part.plan}; the rest refunded: Stripe ${s.status}, D1 ${whole.plan}`);
}

async function s7(site) {   // disputes: a plan's payment ends the plan; a pack's takes back that pack only
  const u = player(site, "dispute"), clock = await newClock("s7"), cus = await customerFor(site, u, clock, "pm_card_createDispute");
  sql(site, "INSERT INTO answer_packs (id, user_id, kind, answers, remaining, payment_intent, status, created) VALUES (?, ?, 'voice', 400, 400, ?, 'active', ?)",
    `cs_lc_${u.id}`, u.id, `pi_lc_${u.id}`, iso(Date.now()));
  const sub = await subscribe(cus, u, "hero");
  const pi = await piOf((await invoices(sub.id))[0].id);
  await sync(site, [cus.id, pi], { wait: "charge.dispute.created" });
  const s = await S("GET", `subscriptions/${sub.id}`), r = row(site, u.id);
  const pack = sql(site, "SELECT remaining, status FROM answer_packs WHERE user_id = ?", u.id)[0];
  check("P6", "Dispute of a plan's payment: plan ends now; packs stay", s.status === "canceled" && r.plan === "free" && pack.status === "active",
    `dispute on ${pi}: Stripe ${s.status}, D1 ${r.plan}; the account's pack ${pack.remaining}/${pack.status}`);
  // A pack's payment disputed: that pack only (made here as a plain payment, since Checkout can't be completed by API).
  const v = player(site, "packdispute"), cus2 = await customerFor(site, v, clock);
  const sub2 = await subscribe(cus2, v, "hero");
  await sync(site, [cus2.id]);
  const pm = await S("POST", "payment_methods/pm_card_createDispute/attach", { customer: cus2.id });
  const pay = await S("POST", "payment_intents", { amount: 299, currency: "usd", customer: cus2.id, payment_method: pm.id,
    confirm: true, off_session: true });
  sql(site, "INSERT INTO answer_packs (id, user_id, kind, answers, remaining, payment_intent, status, created) VALUES (?, ?, 'voice', 400, 400, ?, 'active', ?)",
    `cs_lc_${v.id}`, v.id, pay.id, iso(Date.now()));
  await sync(site, [cus2.id, pay.id], { wait: "charge.dispute.created" });
  const pk = sql(site, "SELECT remaining, status FROM answer_packs WHERE user_id = ?", v.id)[0], r2 = row(site, v.id);
  check("P6b", "Dispute of a pack's payment: that pack only", pk.status === "disputed" && pk.remaining === 0 && r2.plan === "hero" &&
    (await S("GET", `subscriptions/${sub2.id}`)).status === "active", `pack ${pk.remaining}/${pk.status}; plan still ${r2.plan}`);
}

async function s8(site) {   // two tabs: one subscription
  const u = player(site, "tabs"), clock = await newClock("s8"), cus = await customerFor(site, u, clock);
  const one = await api(site, "POST", "/api/billing/checkout", u, { plan: "hero" });
  const two = await api(site, "POST", "/api/billing/checkout", u, { plan: "champion" });
  const id1 = one.json?.url?.match(/cs_test_\w+/)?.[0];
  const s1 = id1 ? await S("GET", `checkout/sessions/${id1}`) : null;
  // Paid in one tab; the webhook hasn't come yet when the other tab clicks.
  const sub = await subscribe(cus, u, "hero");
  const three = await api(site, "POST", "/api/billing/checkout", u, { plan: "champion" });
  const r = row(site, u.id);
  // Two subscriptions made anyway (both pages paid at once): the newer one goes, refunded.
  const dup = await subscribe(cus, u, "champion");
  const pi = await piOf((await invoices(dup.id))[0].id);
  await sync(site, [cus.id, pi]);
  await sync(site, [cus.id, pi]);
  const d = await S("GET", `subscriptions/${dup.id}`), ch = (await S("GET", "charges", { payment_intent: pi })).data[0];
  const kept = row(site, u.id), live = await S("GET", `subscriptions/${sub.id}`);
  check("C1", "Two tabs: one subscription", s1?.status === "expired" && three.json?.url?.endsWith("/plans") && r.plan === "hero" &&
    d.status === "canceled" && ch?.refunded && kept.subscription_id === sub.id && live.status === "active",
    `1st tab's page ${s1?.status} by the 2nd; checkout after paying elsewhere -> ${three.json?.url?.replace(site.base, "")} (D1 ${r.plan} from Stripe); ` +
    `a 2nd subscription made anyway: ${d.status}, refunded ${ch?.refunded}; kept ${kept.subscription_id === sub.id ? "the first" : "?"}`);
}

async function s9(site) {   // delete my account with an active plan
  const u = player(site, "delete"), clock = await newClock("s9"), cus = await customerFor(site, u, clock);
  const sub = await subscribe(cus, u, "legend");
  await sync(site, [cus.id]);
  const del = await api(site, "POST", "/api/auth/delete", u, { confirm: "delete" });
  const s = await S("GET", `subscriptions/${sub.id}`);
  const users = sql(site, "SELECT id FROM users WHERE id = ?", u.id).length;
  await sync(site, [cus.id]);
  check("C4", "Deleting the account with an active plan cancels it first", del.status === 200 && s.status === "canceled" && users === 0,
    `delete ${del.status}: Stripe ${s.status} before the rows went; account rows ${users}`);
}

// ---- The beta promo (the second and third sites) ----
async function p1(site) {   // checkout's offers, once per account
  const u = player(site, "offers"), clock = await newClock("p1");
  await customerFor(site, u, clock);
  const page = async plan => {
    const r = await api(site, "POST", "/api/billing/checkout", u, { plan });
    const id = r.json?.url?.match(/cs_test_\w+/)?.[0];
    return id ? S("GET", `checkout/sessions/${id}`) : { error: r.json?.error };
  };
  const [h, c, l] = [await page("hero"), await page("champion"), await page("legend")];
  check("L1", "Beta: Keep Hero is free today (its 30-day trial)", h.amount_total === 0 && h.mode === "subscription",
    `Hero's checkout: ${money(h.amount_total ?? -1)} today`);
  check("L2", "Beta: Champion and Legend 50% off the first month at Checkout", c.amount_total === 499 && l.amount_total === 999,
    `Champion ${money(c.amount_total ?? 0)} (−${money(c.total_details?.amount_discount ?? 0)}), Legend ${money(l.amount_total ?? 0)} (−${money(l.total_details?.amount_discount ?? 0)})`);
  // Had them before (a cancelled subscription with each): none again.
  const cus = row(site, u.id).customer_id;
  for (const launch of ["hero", "half"]) {
    const s = await S("POST", "subscriptions", { customer: cus, items: [{ price: P.hero_monthly }], metadata: { user_id: u.id, launch } });
    await S("DELETE", `subscriptions/${s.id}`);
  }
  await sync(site, [cus]);
  const [h2, c2] = [await page("hero"), await page("champion")];
  const cards = (await current(site, u)).plans.filter(p => p.promo).length;
  check("L4", "Beta offers once per account, ever", h2.amount_total === 499 && c2.amount_total === 999 && cards === 0,
    `after having both: Hero's checkout ${money(h2.amount_total ?? 0)}, Champion's ${money(c2.amount_total ?? 0)}; cards with an offer: ${cards}`);
}

async function p2(site, plan) {   // a Hero trial upgraded during the beta: 50% off, shown = charged
  const u = player(site, `trial-${plan}`), clock = await newClock(`p2-${plan}`), cus = await customerFor(site, u, clock);
  const sub = await subscribe(cus, u, "hero", { trial_period_days: site.billing.BETA_HERO_DAYS, metadata: { launch: "hero" } });
  await sync(site, [cus.id]);
  const was = (await current(site, u)).current;
  const pre = await change(site, u, { plan, from: "hero" });
  const ok = await change(site, u, { plan, from: "hero", confirm: true, quote: pre.json?.preview?.quote });
  const inv = (await invoices(sub.id)).find(i => i.billing_reason !== "subscription_create");
  const after = (await current(site, u));
  const want = plan === "champion" ? 499 : 999;
  check(plan === "champion" ? "L3" : "L3b", `Beta: Hero trial -> ${plan} is 50% off, shown = charged`,
    was.status === "trialing" && pre.json?.preview?.amount === want && inv?.amount_paid === want && ok.json?.done,
    `"${pre.json?.preview?.text}" -> invoice ${money(inv?.amount_paid ?? 0)}; now ${after.current?.id}/${after.current?.status}`);
  if (plan === "champion") {
    const next = await change(site, u, { plan: "legend", from: "champion" });
    check("L4b", "Beta: a second 50% month isn't offered on a later upgrade", next.json?.preview && !/50% off/.test(next.json.preview.text),
      `Champion->Legend after: "${next.json?.preview?.text}"`);
  }
}

async function p3(site) {   // one month: Keep Hero during the free month ends with it; the free month past the beta's end
  const u = player(site, "month"), clock = await newClock("p3"), cus = await customerFor(site, u, clock);
  const week = site.billing.launchWindow(site.vars), DAYS = site.billing.BETA_HERO_DAYS;
  // Its first look starts its free month; then Keep Hero on /plans, a few minutes in.
  const month = (await current(site, u)).current;
  const r0 = await api(site, "POST", "/api/billing/checkout", u, { plan: "hero" });
  const cs = r0.json?.url?.match(/cs_test_\w+/)?.[0], page = cs ? await S("GET", `checkout/sessions/${cs}`) : {};
  const note = (await current(site, u)).plans.find(p => p.id === "hero")?.promo?.note;
  const day = new Date(month.until).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/Los_Angeles" });
  // The subscription as that checkout makes it (lib/billing.js createCheckout: trial_end, the free month's end).
  const sub = await subscribe(cus, u, "hero", { trial_end: Math.floor(Date.parse(month.until) / 1000), metadata: { launch: "hero" } });
  await sync(site, [cus.id]);
  const days = (sub.trial_end * 1000 - Date.parse(month.since)) / 86400e3, shown = (await current(site, u)).current;
  await advance(clock.id, sub.trial_end - 86400);
  await sync(site, [cus.id]);
  const before = (await invoices(sub.id)).filter(i => i.amount_paid > 0).length, mid = row(site, u.id);
  await advance(clock.id, sub.trial_end + 7200);
  await sync(site, [cus.id]);
  const inv = (await invoices(sub.id)).find(i => i.amount_paid > 0), r = row(site, u.id);
  check("C7", "Beta: Keep Hero during the free month is free to that month's end (one month), past the beta, then $4.99",
    month?.launch && page.amount_total === 0 && note === `until ${day}, then $4.99 a month` &&
    Math.abs(days - DAYS) < 0.01 && sub.trial_end * 1000 > week.end && shown?.status === "trialing" && before === 0 &&
    mid.status === "trialing" && r.plan === "hero" && r.status === "active" && inv?.amount_paid === 499,
    `free month ${month?.since} to ${month?.until}; Checkout ${money(page.amount_total ?? -1)} today; card "${note}"; ` +
    `Hero free ${days.toFixed(2)} days in all (the beta ends ${iso(week.end)}); a day before the end ` +
    `${mid.plan}/${mid.status}, ${before} paid; after it ${money(inv?.amount_paid ?? 0)} charged, D1 ${r.plan}/${r.status}`);
  // A free account's month: from its first look, 30 days, past the beta's end.
  const f = player(site, "monthfree"), first = Date.now();
  const look = async ms => { const p = await planAt(site, f.id, ms); return `${p.id}${p.launch ? " (free month)" : ""}`; };
  const seen = [await look(first), await look(week.end + 86400e3), await look(first + DAYS * 86400e3 - 60e3),
                await look(first + DAYS * 86400e3 + 60e3)];
  check("C7b", "Beta: the free Hero month runs 30 days from its first look, past the beta's end",
    seen.join() === ["hero (free month)", "hero (free month)", "hero (free month)", "free"].join(),
    `first look, a day after the beta, a minute before 30 days, a minute after: ${seen.join(", ")}`);
}

async function p4(site) {   // after the beta: no trial, no coupons, no new free month
  const u = player(site, "late"), clock = await newClock("p4");
  await customerFor(site, u, clock);
  const page = async plan => {
    const r = await api(site, "POST", "/api/billing/checkout", u, { plan });
    const id = r.json?.url?.match(/cs_test_\w+/)?.[0];
    return id ? S("GET", `checkout/sessions/${id}`) : { error: r.json?.error };
  };
  const [h, c, l] = [await page("hero"), await page("champion"), await page("legend")];
  const plans = await current(site, u);
  check("L5", "Beta over: full prices, no trial, no free month for a new account",
    h.amount_total === 499 && c.amount_total === 999 && l.amount_total === 1999 && !plans.launch &&
    !plans.plans.some(p => p.promo) && plans.current?.id === "free",
    `Hero ${money(h.amount_total ?? 0)}, Champion ${money(c.amount_total ?? 0)}, Legend ${money(l.amount_total ?? 0)}; ` +
    `banner ${plans.launch ? "shown" : "gone"}; offers on ${plans.plans.filter(p => p.promo).length} cards; plan ${plans.current?.id}`);
}

try {
  const products = await S("GET", "prices", { lookup_keys: ["hero_monthly", "champion_monthly", "legend_monthly"], active: true });
  P = Object.fromEntries(products.data.map(p => [p.lookup_key, p.id]));
  const onlyLaunch = process.argv.includes("--launch"), DAY = 86400e3;
  const [base, launch, after] = await Promise.all([onlyLaunch ? null : startSite("base", {}),
    startSite("launch", { LAUNCH_WEEK_START: iso(Date.now() - 3 * DAY), BETA_END: iso(Date.now() + 7 * DAY) }),
    startSite("after", { LAUNCH_WEEK_START: iso(Date.now() - 10 * DAY), BETA_END: iso(Date.now() - DAY) })]);
  console.log(`sites up: ${base ? `${base.base}, ` : ""}${launch.base} (the beta) and ${after.base} (after it); logs in ${TMP}`);
  await Promise.all([
    ...(base ? [safe("S1", () => s1(base)), safe("S2", () => s2(base)), safe("S3", () => s3(base)),
      safe("S4", () => s4(base)), safe("S5", () => s5(base)), safe("S6", () => s6(base)), safe("S7", () => s7(base)),
      safe("S8", () => s8(base)), safe("S9", () => s9(base))] : []),
    safe("L1", () => p1(launch)), safe("L3", () => p2(launch, "champion")),
    safe("L3b", () => p2(launch, "legend")), safe("C7", () => p3(launch)), safe("L5", () => p4(after)),
  ]);
  if (base) na("P7", "Saved styles and tales kept on Free", "no billing path touches custom_prompts (lib/willo-custom.js keeps them; " +
     "promptBlocks reads the plan on each answer); not driven here");
} catch (e) {
  results.push({ id: "-", item: "harness", result: "FAIL", evidence: String(e?.message || e) });
} finally {
  for (const c of clocks) await S("DELETE", `test_helpers/test_clocks/${c}`, {}, { quiet: true });
  for (const c of children) try { process.kill(-c.pid, "SIGTERM"); } catch {}
  results.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  writeFileSync(path.join(TMP, "results.json"), JSON.stringify(results, null, 2));
  console.log(`\n| | Item | Result | Evidence |\n|---|---|---|---|`);
  for (const r of results) console.log(`| ${r.id} | ${r.item} | ${r.result} | ${r.evidence.replace(/\|/g, "/")} |`);
  console.log(`\n${results.filter(r => r.result === "PASS").length} pass, ${results.filter(r => r.result === "FAIL").length} fail; ` +
              `${clocks.length} test clocks deleted; results in ${path.join(TMP, "results.json")}`);
  process.exitCode = results.some(r => r.result === "FAIL") ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 3000).unref();
}
