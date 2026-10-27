// Counting a download from the site's own links (functions/download/[file].js, and the picked Setup,
// functions/download/setup/...): per day in D1's downloads table, per day and ?src= in download_sources, for the
// signed-in account (LOR-8) and under where the browser's visits started (lib/sources.js). A HEAD request, a bot or a
// failure counts nothing, and nothing here ever holds up or stops the download.

import { BOT } from "./usage.js";   // link previews and crawlers fetch links too: not downloads
import { currentUser } from "./accounts.js";
import { countAccountDownload } from "./activity.js";
import { noteDownload } from "./sources.js";

const SETUP = `CREATE TABLE IF NOT EXISTS downloads (
  day TEXT NOT NULL, file TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, file))`;
const SOURCES = `CREATE TABLE IF NOT EXISTS download_sources (
  day TEXT NOT NULL, file TEXT NOT NULL, src TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, file, src))`;
const SRC = /^[a-z0-9][a-z0-9_-]{0,31}$/;

async function countForAccount(env, request, file, day) {
  try {
    const user = await currentUser(env, request);   // null at once without a session cookie
    if (user) await countAccountDownload(env, user.id, file, day);
  } catch (e) { /* never block a download on the counter */ }
}

export async function countDownload({ env, request, waitUntil }, file) {
  if (request.method !== "GET" || !env.DB || BOT.test(request.headers.get("user-agent") || "")) return;
  const day = new Date().toISOString().slice(0, 10);
  const asked = (new URL(request.url).searchParams.get("src") || "").toLowerCase();
  const src = asked && (SRC.test(asked) ? asked : "other");
  try {
    await env.DB.batch([
      env.DB.prepare(SETUP),
      env.DB.prepare("INSERT INTO downloads (day, file, n) VALUES (?, ?, 1) ON CONFLICT(day, file) DO UPDATE SET n = n + 1")
        .bind(day, file),
      ...(src ? [
        env.DB.prepare(SOURCES),
        env.DB.prepare("INSERT INTO download_sources (day, file, src, n) VALUES (?, ?, ?, 1) " +
          "ON CONFLICT(day, file, src) DO UPDATE SET n = n + 1").bind(day, file, src),
      ] : []),
    ]);
  } catch (e) {}   // never block a download on the counter
  // Also under where the browser's visits started (lib/sources.js: its first source, the lf_src cookie).
  const counting = Promise.all([countForAccount(env, request, file, day), noteDownload(env, request, file)]);
  if (waitUntil) waitUntil(counting); else await counting;
}
