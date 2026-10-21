import { isReportRead } from "../../lib/report-read.js";
// Data for Mike's private dashboard (/admin): sign-up emails, feedback reports, voice submissions, contributor
// accounts and download counts.
// Every request needs "Authorization: Bearer <key>", where the key is ADMIN_KEY, or FEEDBACK_KEY when ADMIN_KEY
// isn't set. With neither set, the endpoint is off. This check is what keeps the data private: the /admin page
// itself holds no data, and lore-forever.pages.dev serves the same functions as the custom domain.
//   GET  /api/admin  -> {"subscribers": [...], "feedback": [...], "downloads": [...], "clicks": N, "voices": [...],
//                        "translations": [...], "translationReports": [...], "users": [...],
//                        "stories": {month, usd, calls, written, budget, on, voiceUsd, voiceOn}}   profile stories
//                                   this month (LOR-181) and what reading them aloud cost (LOR-316)
//   POST /api/admin  {"action": "status", "id": 3, "status": "done" | "new", "resolution"?: "fixed" | "kept",
//                     "reason"?: "why it's kept"}   mark a report handled (fixed, or kept as it is and why) or not
//                    {"action": "reports-shipped", "release": "0.21.0", "before": ISO}   after a release: the reports
//                                                                               fixed before its commit say "Fixed in"
//                                                                               (lib/reports.js; lore.kit shipped)
//                    {"action": "delete-feedback", "id": 3}                     remove a report (spam, tests)
//                    {"action": "voice-status", "id": 3, "status": "done" | "new" | "rejected", "reason"?}   a voice
//                                                                               submission handled, reopened, or not used
//                                                                               (why, for the narrator; LOR-621)
//                    {"action": "delete-voice", "id": 3}                        remove a voice submission (spam, tests)
//                    {"action": "status-translation", "id": 3, "status": "done" | "new"}  and "delete-translation"
//                    {"action": "status-translation-report", "id": 3, ...}      and "delete-translation-report"
//                    {"action": "delete-subscriber", "email": "a@b.co"}        remove an address (unsubscribe)
//                    {"action": "email-test", "plan"?: "hero", "trial"?: true}  the thank-you email (lib/thanks.js),
//                                                                               sent now to the site's own inbox only
//                                                                               (hello@, Mike's): {ok, service} or {ok: false, error}
//                    {"action": "email-status"}                                 sends nothing: {service, thanks (the
//                                                                               feature), from, replyTo}
//                    {"action": "pay-day", "at"?: ISO, "credit"?: true, "dry"?: false}   every live plan's next charge
//                                                                               on one day, the launch unless at says
//                                                                               (lib/billing.js payDay): a dry run unless
//                                                                               dry is false; with credit, paid days after
//                                                                               it go back as a Stripe balance credit;
//                                                                               safe to repeat (scripts/pay-day.mjs)
//                    {"action": "beta-coupon"}                                  the beta's half-price coupon in this
//                                                                               deployment's Stripe, made if it's missing
//                                                                               (lib/billing.js betaCoupon): {ok, coupon}
//                    {"action": "contrib-reject", "uploader": "h:..."}          shared Forever text (LOR-236): every
//                    {"action": "contrib-restore", "uploader": "h:..."}         line one sender sent stops counting, or
//                                                                               counts again (lib/contribute.js)
//                    {"action": "contrib-settle"}                               decide every part in conflict again by
//                                                                               the rules (lib/contribute.js decide)
//                    {"action": "contrib-pick", "id": 3, "pick": "use" | "skip" | "reset", "reason"?: "why"}   a part in
//                                                                               conflict (reason: skip only, shown as
//                                                                               "Not used: <reason>") use
//                                                                               this text, don't, or undo (LOR-621)
// GET also returns "contributions": {counts: {status: n}, accepted, batches: [...]} for the Contributions panel, and
// "signups": {accounts, profiles, public, today, week, month, days: [{day, n}]} for the Profiles one,
// "downloadTotals": [{file, n}] since the start (downloads holds the last 30 days),
// "usage": lib/usage.js usageReport, the last 14 days of what syncing players used (LOR-413), and "downloadSources":
// [{file, src, n}], site downloads in the last 30 days by the ?src= of their link, and "site": lib/usage.js siteReport,
// the last 14 days of profile views, opens from outside links and shares (LOR-151). "plans": lib/billing.js
// billingReport (LOR-252), {on, paying, onPlan (everyone above Adventurer, each once: {total, paid, trial, freeMonth,
// comped, byPlan}), counts: [{plan, status, n}], monthlyUsd, spend: {usd, players, calls},
// voicePacks: {sold, unused, usd}} (finest-voice packs).
// "activity": lib/activity.js activityReport, sign-ins per day, returning accounts and owners, profile updates by way
// in and veterans or new players (LOR-304); "funnel": lib/activity.js funnelReport, each stage from site download to
// returning player, signed-in downloads (LOR-8), week by week and cohorts by first week (LOR-10), plus "stores"
// (lib/stores.js storesReport: CurseForge's and GitHub's counts per release and day, LOR-421) and "companions" /
// "companionWeeks" (lib/checkins.js: companion installs in use and returning, LOR-422); each null until it has a table.
// "features": lib/featureuse.js featureReport, which features every companion install's add-on and companion used, by
// level range and new or returning install, and the 30-day trend (LOR-435).
// "willo": lib/willo-stats.js willoReport, Willo's downloads, daily and weekly players and installs running, with
// "subscriptions" (plans.subscriptions, lib/billing.js subscriptionReport) (LOR-524) and "taste" (lib/best-first.js
// tasteReport: new players' first answers at Willo's best, what they cost, and conversion and retention against the
// players before it, LOR-602). The "Daily Analytics" routine's Slack post reads its summary.
// "planUsage": lib/plan-usage.js planUsageReport, the last 14 days by plan: which limits turned live answers away,
// which voices said the replies (or why the PC did) and the Willo voices players picked, for pricing decisions.
// Every account count leaves out the admin's and excluded accounts (lib/activity.js syncExclusions, brought up to date
// on each load, the counts taken again when that changed anything: the account signed in on this browser,
// ANALYTICS_EXCLUDE, and those left out by hand); users[].excluded says why.
//   POST {"action": "exclude-account" | "count-account", "id": "<account id>"}   leave one out of the counts, or count
//                                                                               it again (even the admin's)
// The CurseForge author dashboard's numbers come in through functions/api/admin/curseforge.js.
// GET answers with a Server-Timing header: how long each part took, in milliseconds, and "total" (DevTools > Network >
// Timing shows it). Names and times only.

import { authorized } from "../../lib/auth.js";
import { setup as setupAccounts, currentUser } from "../../lib/accounts.js";
import { storySpend, STORY_BUDGET_USD } from "../../lib/profiles.js";
import { decodeReport, describeReport } from "../../public/report-code.js";
import { setup as setupContrib, adminView, setUploaderRejected, pickLine, settleConflicts, loadKnown }
  from "../../lib/contribute.js";
import { setupSubmissions } from "../../lib/submissions.js";
import { setupReports, resolveReport, shipReports } from "../../lib/reports.js";
import { usageReport, siteReport } from "../../lib/usage.js";
import { activityReport, funnelReport, funnelFrom, syncExclusions, setExclusion, counted, utcDay }
  from "../../lib/activity.js";
import { storesReport } from "../../lib/stores.js";
import { checkinReport, checkinWeeks } from "../../lib/checkins.js";
import { featureReport } from "../../lib/featureuse.js";
import { billingReport, payDay, betaCoupon, PAID, PLANS, voicePicks } from "../../lib/billing.js";
import { sendEmail, senderOf, emailService, REPLY_TO } from "../../lib/email.js";
import { featureOn } from "../../lib/features.js";
import { thankYouEmail } from "../../lib/thanks.js";
import { willoReport } from "../../lib/willo-stats.js";
import { tasteReport } from "../../lib/best-first.js";
import { planUsageReport } from "../../lib/plan-usage.js";
import { flushDigest, slackState } from "../../lib/slack-feedback.js";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { ...NO_STORE, ...headers } });

async function safe(query) { try { return await query; } catch (e) { return null; } }   // table may not exist yet

// Times each part of a request for the Server-Timing header: time(name, fn) runs fn and notes how long it took.
function timings() {
  const start = Date.now(), parts = [];
  return {
    async time(name, fn) {
      const t = Date.now();
      try { return await fn(); } finally { parts.push(`${name};dur=${Date.now() - t}`); }
    },
    header: () => [...parts, `total;dur=${Date.now() - start}`].join(", "),
  };
}

// Reports saved before the dashboard existed have no status column yet, and those from before sign-in (LOR-106) no
// user_id. The users table is joined for the reply email of signed-in reports. Once all three columns are there, a
// Worker doesn't try again for that database (a table that doesn't exist yet is tried again on the next load).
const FEEDBACK_COLUMNS = ["status TEXT NOT NULL DEFAULT 'new'", "user_id TEXT", "report TEXT", "resolution TEXT",
  "reason TEXT", "resolved TEXT", "fixed_in TEXT"];
const feedbackReady = new WeakSet();
async function addStatusColumn(db) {
  if (feedbackReady.has(db)) return;
  const there = await Promise.all(FEEDBACK_COLUMNS.map(column => db.prepare(`ALTER TABLE feedback ADD COLUMN ${column}`)
    .run().then(() => true, e => /duplicate column/i.test(String(e?.message)))));
  if (there.every(Boolean)) feedbackReady.add(db);
}

// Every part of the dashboard runs at once, each waiting only for what it reads. A round trip to D1 can take a fifth of
// a second from an edge far from the database, and the parts used to wait for each other in turn (4 to 7 s in all).
export async function onRequestGet({ request, env, waitUntil }) {
  if (!(await authorized(request, env))) return json({ error: "Needs the admin key." }, 401);
  if (!env.DB) return json({ error: "No D1 database bound as DB" }, 503);
  // Legacy callers allow missing optional panels; dashboard reads must disclose failures.
  const safe = query => isReportRead(env) ? query : query.catch(() => null);
  // A feedback burst that ended with nothing after it posts its digest to Slack now (lib/slack-feedback.js).
  if (!isReportRead(env)) waitUntil?.(flushDigest(env, new URL(request.url).origin));
  const { time, header } = timings();
  const now = Date.now();
  const schema = isReportRead(env) ? Promise.resolve() : time("schema", () => Promise.all([addStatusColumn(env.DB), safe(setupAccounts(env)), safe(setupSubmissions(env)),
    safe(setupReports(env))]));
  // Parts that read lib/accounts.js's tables (or feedback's columns) wait for the schema; the others, timed straight
  // away, read only tables of their own.
  const part = (name, fn) => schema.then(() => time(name, fn));
  const all = async q => (await safe(env.DB.prepare(q).all()))?.results || [];
  const month = new Date(now).toISOString().slice(0, 7);

  // The lists and every account count, which leave out the accounts in excluded_accounts.
  const counts = () => Promise.all([
    time("lists", () => Promise.all([
      all("SELECT email, source, created_at FROM subscribers ORDER BY created_at DESC LIMIT 5000"),
      all("SELECT f.id, f.created, f.kind, f.rating, f.message, f.code, COALESCE(f.email, u.email) AS email, f.name, " +
          "f.quote_ok, f.country, f.user_id, f.report, COALESCE(f.status, 'new') AS status, f.resolution, f.reason, " +
          "f.fixed_in " +
          "FROM feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT 2000"),
      // The last 30 days for the chart (voice and language packs add rows each day, so no row cap), totals for the tile.
      all("SELECT day, file, n FROM downloads WHERE day >= date('now', '-29 days') ORDER BY day DESC"),
      safe(env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM clicks").first("n")),
      all("SELECT id, created, credit, email, discord, pack, link, clips, note, release_version, adult_or_guardian, " +
          "signature, country, status, reason FROM voice_submissions ORDER BY id DESC LIMIT 1000"),
      all("SELECT id, created, locale, language, credit, email, discord, link, fix, note, terms_version, country, status " +
          "FROM translation_submissions ORDER BY id DESC LIMIT 1000"),
      all("SELECT id, created, locale, code, place, wrong, better, email, name, country, status, resolution, reason, " +
          "fixed_in FROM translation_reports ORDER BY id DESC LIMIT 2000"),
      // Google sign-in accounts (lib/accounts.js) with what each one has done, their links and their player profile
      // (lib/profiles.js): its address, whether it's public, and the character.
      all("SELECT u.id, u.email, u.display_name, u.links, u.created, " +
          "(SELECT group_concat(name, ', ') FROM voices WHERE owner = u.id) AS voices, " +
          "(SELECT group_concat(locale, ', ') FROM translator_languages WHERE user_id = u.id) AS languages, " +
          "(SELECT COUNT(*) FROM translation_edits WHERE user_id = u.id) AS edits, " +
          "(SELECT COUNT(*) FROM studio_takes WHERE owner = u.id) AS takes, " +
          "(SELECT COUNT(*) FROM feedback WHERE user_id = u.id) AS feedback, " +
          "p.handle, p.public AS profile_public, json_extract(p.data, '$.name') AS character, " +
          "json_extract(p.data, '$.level') AS char_level, json_extract(p.data, '$.className') AS char_class, " +
          "(SELECT reason FROM excluded_accounts WHERE user_id = u.id) AS excluded " +
          "FROM users u LEFT JOIN profiles p ON p.user_id = u.id ORDER BY u.created DESC LIMIT 5000"),
      // Sign-ups, counted here since the list above stops at 5000: every account, those with a player profile and a
      // public one, and the accounts made today and in the last 7 and 30 days, leaving out the admin's and test
      // accounts (excluded: how many). `created` is an ISO time; days are UTC, like the dashboard's charts, so the last
      // 30 days are today and the 29 before it.
      safe(env.DB.prepare(
        "SELECT COUNT(*) AS accounts, COUNT(p.user_id) AS profiles, COALESCE(SUM(p.public = 1), 0) AS public, " +
        "COALESCE(SUM(u.created >= date('now')), 0) AS today, " +
        "COALESCE(SUM(u.created >= date('now', '-6 days')), 0) AS week, " +
        "COALESCE(SUM(u.created >= date('now', '-29 days')), 0) AS month " +
        `FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE ${counted("u.id")}`
      ).first()),
      all("SELECT substr(created, 1, 10) AS day, COUNT(*) AS n FROM users WHERE created >= date('now', '-29 days') " +
          `AND ${counted("id")} GROUP BY day ORDER BY day`),
    ])),
    time("usage", () => safe(usageReport(env, 14))),
    time("activity", () => safe(activityReport(env))),
    time("funnel", () => safe(funnelReport(env, now))),
  ]);
  // The accounts the counts leave out (lib/activity.js): test addresses, ANALYTICS_EXCLUDE, and the account signed in
  // on this browser, the admin's own (the /admin page is on the same site, so its session cookie comes along). Nearly
  // always already up to date, so the counts run meanwhile, and run again on the load that changed something: an
  // account newly left out, or the admin's first visit of the day (currentUser notes the sign-in day).
  const accountCounts = schema.then(async () => {
    if (isReportRead(env)) return counts();
    const [stale, first] = await Promise.all([time("exclusions", async () => {
      const admin = await safe(currentUser(env, request));
      const changed = await safe(syncExclusions(env, admin));
      return changed !== 0 || Boolean(admin && admin.last_seen !== utcDay());
    }), counts()]);
    return stale ? time("recount", counts) : first;
  });

  const [[[subscribers, feedback, downloads, clicks, voices, translations, translationReports, users, signupCounts,
           signupDays], usage, activity, funnel], [spend, answerSpend], plans, contributions, site,
         [downloadTotals, downloadSources], features, stores, companions, companionWeeks, willo, taste, planUsage] =
    await Promise.all([
    accountCounts,
    // Profile stories (lib/profiles.js): what this month's cost so far against the monthly budget.
    part("spend", () => Promise.all([
      safe(storySpend(env)).then(s => s || { micro_usd: 0, calls: 0, stories: 0 }),
      safe(env.DB.prepare("SELECT * FROM answer_spend WHERE month = ?").bind(month).first())
        .then(s => s || { actual_micro: 0, reserved_micro: 0, calls: 0 }),
    ])),
    // Plans (lib/billing.js): accounts by plan and status, the monthly revenue estimate, paying players' answer costs
    // and top-ups. Comped and owner plans stay out of the revenue, so it waits for excluded_accounts.
    part("plans", () => safe(billingReport(env))),
    // Shared Forever text (LOR-236): counts by status and the latest uploads, to spot and reject spam.
    part("contributions", async () => {
      await safe(setupContrib(env));
      const known = await safe(loadKnown(env, request));
      return (await safe(adminView(env, undefined, known))) || { counts: {}, accepted: 0, batches: [], conflicts: [] };
    }),
    time("site", async () => (await safe(siteReport(env, 14))) || []),
    time("downloads", () => Promise.all([
      all("SELECT file, SUM(n) AS n FROM downloads GROUP BY file"),
      all("SELECT file, src, SUM(n) AS n FROM download_sources " +
          "WHERE day >= date('now', '-29 days') GROUP BY file, src ORDER BY n DESC LIMIT 100"),
    ])),
    time("features", () => safe(featureReport(env))),
    // The funnel's CurseForge and GitHub counts and companion check-ins, from the funnel's first week.
    time("stores", () => safe(storesReport(env))),
    time("companions", () => safe(checkinReport(env))),
    time("companionWeeks", () => safe(checkinWeeks(env, funnelFrom(now)))),
    part("willo", () => safe(willoReport(env, now))),
    // Willo's best first (lib/best-first.js, LOR-602): what new players' first answers at her best cost, and whether
    // the players who had them pay and come back more than those before.
    part("taste", () => safe(tasteReport(env, isReportRead(env) ? new Date(now) : now))),
    // What each plan's players use (lib/plan-usage.js): limits hit, voices that said their replies, picks.
    part("planUsage", () => safe(planUsageReport(env, { now }))),
  ]);
  const signups = { ...(signupCounts || { accounts: 0, profiles: 0, public: 0, today: 0, week: 0, month: 0 }),
                    days: signupDays };
  // voiceUsd: recording them (lib/storyvoice.js, LOR-316), in the same budget.
  const stories = { month, usd: spend.micro_usd / 1e6, calls: spend.calls,
                    written: spend.stories, budget: Number(env.STORY_BUDGET_USD ?? STORY_BUDGET_USD),
                    on: Boolean(env.GEMINI_API_KEY), voiceUsd: (spend.voice_micro_usd || 0) / 1e6,
                    reservedUsd: (spend.reserved_micro || 0) / 1e6, voiceOn: Boolean(env.FAL_KEY) };
  const answers = { month: stories.month, usd: answerSpend.actual_micro / 1e6,
                    budgetUsedUsd: answerSpend.reserved_micro / 1e6, calls: answerSpend.calls };
  // Add-on report codes (LOR-120) spelled out, for the report card.
  for (const f of feedback) {
    let r = null;
    try { r = f.report ? JSON.parse(f.report) : decodeReport(f.code); } catch (e) {}
    f.report = describeReport(r);
  }
  if (funnel) Object.assign(funnel, { stores, companions, companionWeeks });
  return json({ subscribers, feedback, downloads, clicks: clicks || 0, voices, translations, translationReports, users,
                stories, answers, plans, contributions, signups, usage, site, downloadTotals, downloadSources, activity, funnel,
                features, willo: willo && { ...willo, subscriptions: plans?.subscriptions || null, taste: taste || null },
                planUsage: planUsage || null,
                // Slack #player-feedback forwarding (lib/slack-feedback.js): "webhook", "bot token", "log", "off" or
                // why what's set is unused. scripts/feedback-setup.mjs checks it.
                slackFeedback: slackState(env).state },
              200, { "Server-Timing": header() });
}

export async function onRequestPost({ request, env }) {
  if (!(await authorized(request, env))) return json({ error: "Needs the admin key." }, 401);
  if (!env.DB) return json({ error: "No D1 database bound as DB" }, 503);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Expected JSON." }, 400); }
  const id = Number.parseInt(body.id, 10);

  if (body.action === "status" && id > 0 && ["new", "done"].includes(body.status)) {
    await addStatusColumn(env.DB);
    await resolveReport(env, "feedback", id, body.status, body.resolution, body.reason);
    return json({ ok: true });
  }
  if (body.action === "reports-shipped" && /^\d{1,3}\.\d{1,3}\.\d{1,4}$/.test(String(body.release || ""))
      && !Number.isNaN(Date.parse(String(body.before || "")))) {
    return json({ ok: true, shipped: await shipReports(env, String(body.release), String(body.before)) });
  }
  if (body.action === "delete-feedback" && id > 0) {
    await env.DB.prepare("DELETE FROM feedback WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  if (body.action === "voice-status" && id > 0 && ["new", "done", "rejected"].includes(body.status)) {
    await setupSubmissions(env);
    const reason = body.status === "rejected" ? String(body.reason || "").replace(/\s+/g, " ").trim().slice(0, 300) || null : null;
    const row = await env.DB.prepare("UPDATE voice_submissions SET status = ?, reason = ? WHERE id = ? RETURNING voice_id")
      .bind(body.status, reason, id).first();
    // Not used: the voice is a draft again on the upload page, so the narrator can fix it and send it again.
    if (row?.voice_id && body.status === "rejected") {
      await env.DB.prepare("UPDATE voices SET status = 'draft' WHERE id = ? AND status = 'pending'").bind(row.voice_id).run();
    }
    return json({ ok: true });
  }
  if (body.action === "delete-voice" && id > 0) {
    await env.DB.prepare("DELETE FROM voice_submissions WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  // Translation submissions and bad-translation reports (functions/api/translations.js and translations/report.js).
  const TRANSLATION_TABLES = { translation: "translation_submissions", "translation-report": "translation_reports" };
  const [verb, ...rest] = String(body.action || "").split("-");
  const table = TRANSLATION_TABLES[rest.join("-")];
  if (table === "translation_reports" && verb === "status" && id > 0 && ["new", "done"].includes(body.status)) {
    await resolveReport(env, table, id, body.status, body.resolution, body.reason);
    return json({ ok: true });
  }
  if (table && verb === "status" && id > 0 && ["new", "done"].includes(body.status)) {
    await env.DB.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).bind(body.status, id).run();
    return json({ ok: true });
  }
  if (table && verb === "delete" && id > 0) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  }
  if ((body.action === "contrib-reject" || body.action === "contrib-restore") && typeof body.uploader === "string"
      && /^[uihx]:[\w-]{1,64}$/.test(body.uploader)) {
    await setupContrib(env);
    const lines = await setUploaderRejected(env, body.uploader, body.action === "contrib-reject",
                                            await loadKnown(env, request));
    return json({ ok: true, lines });
  }
  if (body.action === "contrib-settle") {
    await setupContrib(env);
    return json({ ok: true, ...(await settleConflicts(env, await loadKnown(env, request))) });
  }
  if (body.action === "contrib-pick" && id > 0 && ["use", "skip", "reset"].includes(body.pick)) {
    await setupContrib(env);
    const status = await pickLine(env, id, body.pick, await loadKnown(env, request), undefined, body.reason);
    return status ? json({ ok: true, status }) : json({ error: "No such line." }, 404);
  }
  // Contacts: leave an account out of the counts, or count it again (lib/activity.js setExclusion).
  if ((body.action === "exclude-account" || body.action === "count-account") && typeof body.id === "string"
      && /^[\w-]{1,64}$/.test(body.id)) {
    await setupAccounts(env);
    await setExclusion(env, body.id, body.action === "exclude-account");
    return json({ ok: true });
  }
  // The thank-you email (lib/thanks.js) for a plan, sent now to the site's own inbox only (REPLY_TO, which reaches
  // Mike), to try the email service, the text and its Reply-To.
  // Whether a new subscriber gets the thank-you here, without sending anything: the email service, the "thanks" feature,
  // and who it's from.
  if (body.action === "email-status") {
    const { from, replyTo } = senderOf(env);
    return json({ ok: true, service: emailService(env), thanks: featureOn(env, "thanks"), from, replyTo });
  }
  if (body.action === "email-test") {
    const planId = PAID.includes(body.plan) ? body.plan : "hero";
    const email = thankYouEmail({ planId, planName: PLANS[planId].name, firstName: "Mike", trial: body.trial === true,
                                  picks: voicePicks(env), postal: senderOf(env).postal });
    try {
      return json({ ok: true, to: REPLY_TO, ...(await sendEmail(env, { ...email, to: REPLY_TO,
        subject: `[Test] ${email.subject}` })) });
    } catch (e) { return json({ ok: false, error: String(e?.message || e) }); }   // 200: the edge hides a 502's body
  }
  // The launch as every plan's pay day (lib/billing.js payDay): what moving them there does, with or without a credit,
  // or doing it; and the beta's half-price coupon (betaCoupon).
  if (body.action === "beta-coupon") {
    if (!env.STRIPE_SECRET_KEY) return json({ error: "Stripe isn't set up here (no STRIPE_SECRET_KEY)." }, 503);
    const coupon = await betaCoupon(env);
    return json({ ok: Boolean(coupon), coupon, ...(coupon ? {} : { error: "Couldn't make it with this key: see the log." }) });
  }
  if (body.action === "pay-day") {
    if (!env.STRIPE_SECRET_KEY) return json({ error: "Stripe isn't set up here (no STRIPE_SECRET_KEY)." }, 503);
    try {
      const out = await payDay(env, { at: body.at, credit: body.credit === true, dry: body.dry !== false });
      return out.error ? json(out, 400) : json({ ok: true, ...out });
    } catch (e) { return json({ ok: false, error: String(e?.message || e) }); }   // 200: the edge hides a 502's body
  }
  if (body.action === "delete-subscriber"&& typeof body.email === "string" && body.email) {
    await env.DB.prepare("DELETE FROM subscribers WHERE email = ?").bind(body.email.trim().toLowerCase()).run();
    return json({ ok: true });
  }
  return json({ error: "Unknown action." }, 400);
}
