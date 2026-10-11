// The site's own download links: /download/installer and /download/zip. /download/complete is an old link to the
// complete zip, which the main zip replaced (it carries every narration now), so it serves that. Each one counts the download per
// day in the D1 database (bound as DB), then redirects to the file on the latest GitHub release. This is
// the "downloads from the site" number; GitHub's own count also includes people who download from GitHub.
//   GET /download/installer -> 302 to .../releases/latest/download/LoreForever-Setup.exe
//   GET /download/zip       -> 302 to .../releases/latest/download/LoreForever.zip
//   GET /download/complete  -> 302 to .../releases/latest/download/LoreForever.zip (counted as "complete")
// ?src=<where the link was> (LOR-413; the lore pages send ?src=lore, and header.js carries a visit's ?src= onto these
// links) also counts it per day and source in download_sources. Only a short slug: anything else counts as "other".

import { BOT } from "../../lib/usage.js";   // link previews and crawlers fetch links too: not downloads

const RELEASE = "https://github.com/mliudev/LoreForever/releases/latest/download/";
const FILES = { installer: "LoreForever-Setup.exe", zip: "LoreForever.zip", complete: "LoreForever.zip" };
const SETUP = `CREATE TABLE IF NOT EXISTS downloads (
  day TEXT NOT NULL, file TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, file))`;
const SOURCES = `CREATE TABLE IF NOT EXISTS download_sources (
  day TEXT NOT NULL, file TEXT NOT NULL, src TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, file, src))`;
const SRC = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export async function onRequestGet({ params, env, request }) {
  const file = FILES[params.file];
  if (!file) return new Response("Not found", { status: 404 });
  if (request.method === "GET" && env.DB && !BOT.test(request.headers.get("user-agent") || "")) {
    const day = new Date().toISOString().slice(0, 10);
    const asked = (new URL(request.url).searchParams.get("src") || "").toLowerCase();
    const src = asked && (SRC.test(asked) ? asked : "other");
    try {
      await env.DB.batch([
        env.DB.prepare(SETUP),
        env.DB.prepare("INSERT INTO downloads (day, file, n) VALUES (?, ?, 1) ON CONFLICT(day, file) DO UPDATE SET n = n + 1")
          .bind(day, params.file),
        ...(src ? [
          env.DB.prepare(SOURCES),
          env.DB.prepare("INSERT INTO download_sources (day, file, src, n) VALUES (?, ?, ?, 1) " +
            "ON CONFLICT(day, file, src) DO UPDATE SET n = n + 1").bind(day, params.file, src),
        ] : []),
      ]);
    } catch (e) {}   // never block a download on the counter
  }
  return Response.redirect(RELEASE + file, 302);
}

export const onRequestHead = onRequestGet;
