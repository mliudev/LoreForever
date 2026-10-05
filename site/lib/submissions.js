// Voice submissions (D1 table voice_submissions), shared by the folder-link form (functions/api/voices.js) and the
// upload page (functions/api/studio/[action].js, whose submissions have the link "studio:<voice id>"). Kept outside
// functions/ so Pages doesn't route it.
//
// RELEASE_VERSION is the narrator release contributors agree to (public/voices/release.html). When the release
// changes, give it a new version there, here and in public/voices/submit.html; a form loaded before the change is
// then turned away with a request to read the new one, and the upload page asks everyone to agree again.

import { postWebhook } from "./form.js";

// 2026-10-03: 18 or older only (no more guardian signing), no synthetic copies or voice models from the recordings,
// and the release record is kept even after the account is deleted.
export const RELEASE_VERSION = "2026-10-03";

// adult_or_guardian is the age box: "18 or older" since release 2026-10-03, "18 or older, or a guardian signs" before.
const SETUP = `CREATE TABLE IF NOT EXISTS voice_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL,
  credit TEXT NOT NULL,
  email TEXT,
  discord TEXT,
  pack TEXT NOT NULL,
  link TEXT NOT NULL,
  clips TEXT NOT NULL,
  note TEXT,
  release_version TEXT NOT NULL,
  adult_or_guardian INTEGER NOT NULL,
  signature TEXT NOT NULL,
  country TEXT,
  sender TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  user_id TEXT,
  voice_id TEXT
)`;
// Columns added after the table was first made (LOR-85). ALTER fails once a column exists; that's fine.
const MIGRATE = ["ALTER TABLE voice_submissions ADD COLUMN user_id TEXT", "ALTER TABLE voice_submissions ADD COLUMN voice_id TEXT"];

export async function setupSubmissions(env) {
  await env.DB.prepare(SETUP).run();
  for (const sql of MIGRATE) {
    try { await env.DB.prepare(sql).run(); } catch (e) {}
  }
}

export const PER_DAY = 5;   // submissions one sender can make per day

// How many submissions this sender (a daily IP hash) made today.
export function sentToday(env, sender, day) {
  return env.DB.prepare("SELECT COUNT(*) AS n FROM voice_submissions WHERE sender = ? AND created >= ?").bind(sender, day).first("n");
}

// Saves one submission; returns its id.
export async function insertSubmission(env, s) {
  const row = await env.DB.prepare(
    "INSERT INTO voice_submissions (created, credit, email, discord, pack, link, clips, note, release_version, " +
    "adult_or_guardian, signature, country, sender, user_id, voice_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id"
  ).bind(s.created, s.credit, s.email, s.discord, s.pack, s.link, s.clips, s.note, s.release_version,
         s.adult_or_guardian, s.signature, s.country, s.sender, s.user_id, s.voice_id).first();
  return row?.id;
}

// Posts a submission to the VOICES_WEBHOOK Discord channel: never the email address or the signature.
export function notify(webhook, s) {
  const studio = s.link.startsWith("studio:");
  const lines = [
    `**Voice submission #${s.id}: ${s.pack}**`,
    `Credit: ${s.credit}`,
    s.voice_id ? `Voice id: ${s.voice_id} (publish with "owner": "${s.user_id}")` : "",
    `Clips: ${s.clips.slice(0, 500)}`,
    studio ? `Recordings: uploaded on the site (\`uv run python -m lore.voicepack studio ${s.voice_id}\`)` : `Recordings: <${s.link}>`,
    s.note ? `Note: ${s.note.slice(0, 800)}` : "",
    s.discord ? `Discord: ${s.discord}` : "",
    s.email ? "(left an email; see /admin)" : "",
    `Agreed to the narrator release ${s.release_version}`,
  ].filter(Boolean);
  return postWebhook(webhook, lines.join("\n"));
}
