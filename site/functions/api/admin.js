// Data for Mike's private dashboard (/admin): sign-up emails, feedback reports, voice submissions, contributor
// accounts and download counts.
// Every request needs "Authorization: Bearer <key>", where the key is ADMIN_KEY, or FEEDBACK_KEY when ADMIN_KEY
// isn't set. With neither set, the endpoint is off. This check is what keeps the data private: the /admin page
// itself holds no data, and lore-forever.pages.dev serves the same functions as the custom domain.
//   GET  /api/admin  -> {"subscribers": [...], "feedback": [...], "downloads": [...], "clicks": N, "voices": [...],
//                        "translations": [...], "translationReports": [...], "users": [...],
//                        "stories": {month, usd, calls, written, budget, on}}   profile stories this month (LOR-181)
//   POST /api/admin  {"action": "status", "id": 3, "status": "done" | "new"}   mark a report handled or not
//                    {"action": "delete-feedback", "id": 3}                     remove a report (spam, tests)
//                    {"action": "voice-status", "id": 3, "status": "done" | "new"}   mark a voice submission handled
//                    {"action": "delete-voice", "id": 3}                        remove a voice submission (spam, tests)
//                    {"action": "status-translation", "id": 3, "status": "done" | "new"}  and "delete-translation"
//                    {"action": "status-translation-report", "id": 3, ...}      and "delete-translation-report"
//                    {"action": "delete-subscriber", "email": "a@b.co"}        remove an address (unsubscribe)

import { authorized } from "../../lib/auth.js";
import { setup as setupAccounts } from "../../lib/accounts.js";
import { storySpend, STORY_BUDGET_USD } from "../../lib/profiles.js";
import { decodeReport, describeReport } from "../../public/report-code.js";

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
  const [subscribers, feedback, downloads, clicks, voices, translations, translationReports, users] = await Promise.all([
    all("SELECT email, source, created_at FROM subscribers ORDER BY created_at DESC LIMIT 5000"),
    all("SELECT f.id, f.created, f.kind, f.rating, f.message, f.code, COALESCE(f.email, u.email) AS email, f.name, " +
        "f.quote_ok, f.country, f.user_id, f.report, COALESCE(f.status, 'new') AS status " +
        "FROM feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT 2000"),
    all("SELECT day, file, n FROM downloads ORDER BY day DESC LIMIT 400"),
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
  ]);
  // Profile stories (lib/profiles.js): what this month's cost so far against the monthly budget.
  const spend = (await safe(storySpend(env))) || { micro_usd: 0, calls: 0, stories: 0 };
  const stories = { month: new Date().toISOString().slice(0, 7), usd: spend.micro_usd / 1e6, calls: spend.calls,
                    written: spend.stories, budget: Number(env.STORY_BUDGET_USD ?? STORY_BUDGET_USD),
                    on: Boolean(env.GEMINI_API_KEY) };
  // Add-on report codes (LOR-120) spelled out, for the report card.
  for (const f of feedback) {
    let r = null;
    try { r = f.report ? JSON.parse(f.report) : decodeReport(f.code); } catch (e) {}
    f.report = describeReport(r);
  }
  return json({ subscribers, feedback, downloads, clicks: clicks || 0, voices, translations, translationReports, users, stories });
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
  if (body.action === "delete-subscriber"&& typeof body.email === "string" && body.email) {
    await env.DB.prepare("DELETE FROM subscribers WHERE email = ?").bind(body.email.trim().toLowerCase()).run();
    return json({ ok: true });
  }
  return json({ error: "Unknown action." }, 400);
}
