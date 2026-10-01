// "Report a bad translation" from /translate#report, stored in the same D1 database (bound as DB).
//   POST /api/translations/report  saves one report: the language, the entry (its code, or where it was seen), what's
//                                  wrong, and optionally better wording. A JSON post gets {"ok": true} or
//                                  {"ok": false, "error": ...}; a plain form post is sent on to /translate/reported.
//   GET  /api/translations/report  returns the reports, newest first. Needs the admin key (lib/auth.js).
// Reports go to TRANSLATIONS_WEBHOOK too, when it's set (see functions/api/translations.js).

import { authorized } from "../../../lib/auth.js";
import { clean, EMAIL, senderHash, postWebhook } from "../../../lib/form.js";
import { errorPage, LOCALE } from "../../../lib/translations.js";

const SETUP = `CREATE TABLE IF NOT EXISTS translation_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL,
  locale TEXT NOT NULL,
  code TEXT,
  place TEXT,
  wrong TEXT NOT NULL,
  better TEXT,
  email TEXT,
  name TEXT,
  country TEXT,
  sender TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
)`;

const PER_DAY = 20;   // reports one sender can make per day

const fail = (status, error) => Response.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });

function notify(webhook, r) {
  const lines = [
    `**Bad translation #${r.id} (${r.locale})**${r.code ? "  `" + r.code.replace(/`/g, "'") + "`" : ""}`,
    r.place ? `Where: ${r.place.slice(0, 300)}` : "",
    `Wrong: ${r.wrong.slice(0, 1000)}`,
    r.better ? `Better: ${r.better.slice(0, 1000)}` : "",
    r.name ? `— ${r.name}` : "",
  ].filter(Boolean);
  return postWebhook(webhook, lines.join("\n"));
}

export async function onRequestPost(context) {
  const { request } = context;
  const json = (request.headers.get("Content-Type") || "").includes("application/json");
  const { status, error } = await save(context, json);
  if (json) return error ? fail(status, error) : Response.json({ ok: true });
  if (error) return errorPage(status, error, "/translate#report", "Report a bad translation");
  return Response.redirect(new URL("/translate/reported", request.url).href, 303);
}

async function save({ request, env, waitUntil }, json) {
  if (!env.DB) return { status: 503, error: "Reports aren't set up yet. Please tell us on Discord." };
  let input;
  try {
    input = json ? await request.json() : Object.fromEntries(await request.formData());
  } catch (e) {
    return { status: 400, error: "Couldn't read the form." };
  }
  if (clean(input.website, 10)) return {};   // honeypot

  const r = {
    locale: clean(input.locale, 8),
    code: clean(input.code, 120) || null,
    place: clean(input.place, 300) || null,
    wrong: clean(input.wrong, 4000),
    better: clean(input.better, 4000) || null,
    email: clean(input.email, 200).toLowerCase() || null,
    name: clean(input.name, 100) || null,
  };
  if (!LOCALE.test(r.locale)) return { status: 400, error: "Pick the language the text is in." };
  if (!r.code && !r.place) return { status: 400, error: "Tell us where you saw it: the entry code, or the zone, NPC or quest and the question." };
  if (!r.wrong) return { status: 400, error: "Tell us what's wrong with the translation." };
  if (r.email && !EMAIL.test(r.email)) return { status: 400, error: "That email address doesn't look right." };

  const now = new Date().toISOString();
  const sender = await senderHash(request.headers.get("CF-Connecting-IP") || "", now.slice(0, 10));
  await env.DB.prepare(SETUP).run();
  const sent = await env.DB.prepare("SELECT COUNT(*) AS n FROM translation_reports WHERE sender = ? AND created >= ?")
    .bind(sender, now.slice(0, 10)).first("n");
  if (sent >= PER_DAY) return { status: 429, error: "That's a lot of reports for one day. Thank you! Please send the rest tomorrow, or on Discord." };

  const row = await env.DB.prepare(
    "INSERT INTO translation_reports (created, locale, code, place, wrong, better, email, name, country, sender) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id"
  ).bind(now, r.locale, r.code, r.place, r.wrong, r.better, r.email, r.name, request.cf?.country || null, sender).first();

  if (env.TRANSLATIONS_WEBHOOK) waitUntil(notify(env.TRANSLATIONS_WEBHOOK, { ...r, id: row?.id }));
  return {};
}

export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env))) return fail(401, "Needs the admin key.");
  if (!env.DB) return Response.json({ reports: [] });
  await env.DB.prepare(SETUP).run();
  const { results } = await env.DB.prepare(
    "SELECT id, created, locale, code, place, wrong, better, email, name, country, status " +
    "FROM translation_reports ORDER BY id DESC LIMIT 2000"
  ).all();
  return Response.json({ reports: results }, { headers: { "Cache-Control": "no-store" } });
}
