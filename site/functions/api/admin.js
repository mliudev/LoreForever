// Data for Mike's private dashboard (/admin): sign-up emails, feedback reports, voice submissions, contributor
// accounts and download counts.
// Every request needs "Authorization: Bearer <key>", where the key is ADMIN_KEY, or FEEDBACK_KEY when ADMIN_KEY
// isn't set. With neither set, the endpoint is off. This check is what keeps the data private: the /admin page
// itself holds no data, and lore-forever.pages.dev serves the same functions as the custom domain.
//   GET  /api/admin  -> {"subscribers": [...], "feedback": [...], "downloads": [...], "clicks": N, "voices": [...],
//                        "translations": [...], "translationReports": [...], "users": [...],
//                        "stories": {month, usd, calls, written, budget, on, voiceUsd, voiceOn}}   profile stories
//                                   this month (LOR-181) and what reading them aloud cost (LOR-316)
//   POST /api/admin  {"action": "status", "id": 3, "status": "done" | "new"}   mark a report handled or not
//                    {"action": "delete-feedback", "id": 3}                     remove a report (spam, tests)
//                    {"action": "voice-status", "id": 3, "status": "done" | "new"}   mark a voice submission handled
//                    {"action": "delete-voice", "id": 3}                        remove a voice submission (spam, tests)
//                    {"action": "status-translation", "id": 3, "status": "done" | "new"}  and "delete-translation"
//                    {"action": "status-translation-report", "id": 3, ...}      and "delete-translation-report"
//                    {"action": "delete-subscriber", "email": "a@b.co"}        remove an address (unsubscribe)
//                    {"action": "contrib-reject", "uploader": "h:..."}          shared Forever text (LOR-236): every
//                    {"action": "contrib-restore", "uploader": "h:..."}         line one sender sent stops counting, or
//                                                                               counts again (lib/contribute.js)
// GET also returns "contributions": {counts: {status: n}, accepted, batches: [...]} for the Contributions panel, and
// "signups": {accounts, profiles, public, today, week, month, days: [{day, n}]} for the Profiles one,
// "downloadTotals": [{file, n}] since the start (downloads holds the last 30 days),
// "usage": lib/usage.js usageReport, the last 14 days of what syncing players used (LOR-413), and "downloadSources":
// [{file, src, n}], site downloads in the last 30 days by the ?src= of their link, and "site": lib/usage.js siteReport,
// the last 14 days of profile views, opens from outside links and shares (LOR-151).

import { authorized } from "../../lib/auth.js";
import { setup as setupAccounts } from "../../lib/accounts.js";
import { storySpend, STORY_BUDGET_USD } from "../../lib/profiles.js";
import { decodeReport, describeReport } from "../../public/report-code.js";
import { setup as setupContrib, adminView, setUploaderRejected, loadKnown } from "../../lib/contribute.js";
import { usageReport, siteReport } from "../../lib/usage.js";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const json = (body, status = 200) => Response.json(body, { status, headers: NO_STORE });

async function safe(query) { try { return await query; } catch (e) { return null; } }   // table may not exist yet

// Reports saved before the dashboard existed have no status column yet, and those from before sign-in (LOR-106) no
// user_id. The users table is joined for the reply email of signed-in reports.
async function addStatusColumn(db) {
  await safe(db.prepare("ALTER TABLE feedback ADD COLUMN status TEXT NOT NULL DEFAULT 'new'").run());
  await safe(db.prepare("ALTER TABLE feedback ADD COLUMN user_id TEXT").run());
  await safe(db.prepare("ALTER TABLE feedback ADD COLUMN report TEXT").run());
}

export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env))) return json({ error: "Needs the admin key." }, 401);
  if (!env.DB) return json({ error: "No D1 database bound as DB" }, 503);
  await addStatusColumn(env.DB);
  await safe(setupAccounts(env));
  const all = async q => (await safe(env.DB.prepare(q).all()))?.results || [];
  const [subscribers, feedback, downloads, clicks, voices, translations, translationReports, users, signupCounts,
         signupDays] = await Promise.all([
    all("SELECT email, source, created_at FROM subscribers ORDER BY created_at DESC LIMIT 5000"),
    all("SELECT f.id, f.created, f.kind, f.rating, f.message, f.code, COALESCE(f.email, u.email) AS email, f.name, " +
        "f.quote_ok, f.country, f.user_id, f.report, COALESCE(f.status, 'new') AS status " +
        "FROM feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT 2000"),
    // The last 30 days for the chart (voice and language packs add rows each day, so no row cap), totals for the tile.
    all("SELECT day, file, n FROM downloads WHERE day >= date('now', '-29 days') ORDER BY day DESC"),
    safe(env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM clicks").first("n")),
    all("SELECT id, created, credit, email, discord, pack, link, clips, note, release_version, adult_or_guardian, " +
        "signature, country, status FROM voice_submissions ORDER BY id DESC LIMIT 1000"),
    all("SELECT id, created, locale, language, credit, email, discord, link, fix, note, terms_version, country, status " +
        "FROM translation_submissions ORDER BY id DESC LIMIT 1000"),
    all("SELECT id, created, locale, code, place, wrong, better, email, name, country, status " +
        "FROM translation_reports ORDER BY id DESC LIMIT 2000"),
    // Google sign-in accounts (lib/accounts.js) with what each one has done, their links and their player profile
    // (lib/profiles.js): its address, whether it's public, and the character.
    all("SELECT u.id, u.email, u.display_name, u.links, u.created, " +
        "(SELECT group_concat(name, ', ') FROM voices WHERE owner = u.id) AS voices, " +
        "(SELECT group_concat(locale, ', ') FROM translator_languages WHERE user_id = u.id) AS languages, " +
        "(SELECT COUNT(*) FROM translation_edits WHERE user_id = u.id) AS edits, " +
        "(SELECT COUNT(*) FROM studio_takes WHERE owner = u.id) AS takes, " +
        "(SELECT COUNT(*) FROM feedback WHERE user_id = u.id) AS feedback, " +
        "p.handle, p.public AS profile_public, json_extract(p.data, '$.name') AS character, " +
        "json_extract(p.data, '$.level') AS char_level, json_extract(p.data, '$.className') AS char_class " +
        "FROM users u LEFT JOIN profiles p ON p.user_id = u.id ORDER BY u.created DESC LIMIT 5000"),
    // Sign-ups, counted here since the list above stops at 5000: every account, those with a player profile and a
    // public one, and the accounts made today and in the last 7 and 30 days. `created` is an ISO time; days are UTC,
    // like the dashboard's charts, so the last 30 days are today and the 29 before it.
    safe(env.DB.prepare(
      "SELECT COUNT(*) AS accounts, COUNT(p.user_id) AS profiles, COALESCE(SUM(p.public = 1), 0) AS public, " +
      "COALESCE(SUM(u.created >= date('now')), 0) AS today, " +
      "COALESCE(SUM(u.created >= date('now', '-6 days')), 0) AS week, " +
      "COALESCE(SUM(u.created >= date('now', '-29 days')), 0) AS month " +
      "FROM users u LEFT JOIN profiles p ON p.user_id = u.id"
    ).first()),
    all("SELECT substr(created, 1, 10) AS day, COUNT(*) AS n FROM users WHERE created >= date('now', '-29 days') " +
        "GROUP BY day ORDER BY day"),
  ]);
  const signups = { ...(signupCounts || { accounts: 0, profiles: 0, public: 0, today: 0, week: 0, month: 0 }),
                    days: signupDays };
  // Profile stories (lib/profiles.js): what this month's cost so far against the monthly budget.
  const spend = (await safe(storySpend(env))) || { micro_usd: 0, calls: 0, stories: 0 };
  const answerSpend = (await safe(env.DB.prepare("SELECT * FROM answer_spend WHERE month = ?")
    .bind(new Date().toISOString().slice(0, 7)).first())) || { actual_micro: 0, reserved_micro: 0, calls: 0 };
  // voiceUsd: recording them (lib/storyvoice.js, LOR-316), in the same budget.
  const stories = { month: new Date().toISOString().slice(0, 7), usd: spend.micro_usd / 1e6, calls: spend.calls,
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
  // Shared Forever text (LOR-236): counts by status and the latest uploads, to spot and reject spam.
  await safe(setupContrib(env));
  const contributions = (await safe(adminView(env))) || { counts: {}, accepted: 0, batches: [] };
  const usage = await safe(usageReport(env, 14));
  const site = (await safe(siteReport(env, 14))) || [];
  const downloadTotals = await all("SELECT file, SUM(n) AS n FROM downloads GROUP BY file");
  const downloadSources = await all("SELECT file, src, SUM(n) AS n FROM download_sources " +
    "WHERE day >= date('now', '-29 days') GROUP BY file, src ORDER BY n DESC LIMIT 100");
  return json({ subscribers, feedback, downloads, clicks: clicks || 0, voices, translations, translationReports, users,
                stories, answers, contributions, signups, usage, site, downloadTotals, downloadSources });
}

export async function onRequestPost({ request, env }) {
  if (!(await authorized(request, env))) return json({ error: "Needs the admin key." }, 401);
  if (!env.DB) return json({ error: "No D1 database bound as DB" }, 503);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Expected JSON." }, 400); }
  const id = Number.parseInt(body.id, 10);

  if (body.action === "status" && id > 0 && ["new", "done"].includes(body.status)) {
    await addStatusColumn(env.DB);
    await env.DB.prepare("UPDATE feedback SET status = ? WHERE id = ?").bind(body.status, id).run();
    return json({ ok: true });
  }
  if (body.action === "delete-feedback" && id > 0) {
    await env.DB.prepare("DELETE FROM feedback WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  if (body.action === "voice-status" && id > 0 && ["new", "done"].includes(body.status)) {
    await env.DB.prepare("UPDATE voice_submissions SET status = ? WHERE id = ?").bind(body.status, id).run();
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
  if (body.action === "delete-subscriber"&& typeof body.email === "string" && body.email) {
    await env.DB.prepare("DELETE FROM subscribers WHERE email = ?").bind(body.email.trim().toLowerCase()).run();
    return json({ ok: true });
  }
  return json({ error: "Unknown action." }, 400);
}
