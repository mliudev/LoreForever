// "Lend your voice" (LOR-230): a player reads our short script (public/voices/lend-script.json) for 2-3 minutes on
// /voices/lend, and we make a narrator voice from it with our own tooling (pipeline/lore/donation.py and
// experiments/voices/local/donation_*.py on Mike's machine; never from game audio or anyone else's recordings). Used
// by functions/api/studio/donate/[action].js. Kept outside functions/ so Pages doesn't route it.
//
// Storage: the sample in R2 (binding STUDIO) at studio/<user id>/_donation/<donation id>/sample.<ext>, the test pack
// we upload back at .../pack.zip; D1 voice_donations and donation_release (lib/accounts.js SETUP and USER_DATA; "Delete
// my account" sweeps studio/<user id>/ in R2, so the files go). A voice id never starts with "_", so the folder can't
// meet a studio voice's.
//
// Lifecycle (status): donated (sample in, waiting for the GPU) -> rendering -> ready (test pack up, the donor can
// download it) -> published (Mike's manual voicepack/voices.json flow; a `voices` row with the donor as owner), or
// withdrawn at any point by the donor: the sample and test pack are deleted, a published voice's `voices` row goes
// (so its voices.json entry stops showing at once), and the render tooling deletes its local copy and leaves it out
// of the next build. Copies players already downloaded can't be recalled; the terms say so.
//
// The record of the agreement stays, as proof of the license (like a sent voice's narrator release, which stays in
// voice_submissions): each donation row keeps its id, the terms version, the typed signature, the age box and when
// they agreed (consented), plus when it was sent and withdrawn, the script read and the voice id it was published as.
// Withdrawing clears the rest (RECORD_ONLY: the recording's and test pack's details and the credit); "Delete my
// account" does the same and also drops the link to the account (owner "" = the account is gone) and the per-account
// donation_release row, since each donation carries its own copy of what was signed.
//
// CONSENT_VERSION is the donation terms (public/voices/lend-terms.html). Changing them: a new version there and here.

import { postWebhook } from "./form.js";

export const CONSENT_VERSION = "2026-10-04";

// What a withdrawn donation clears, keeping only the record of the agreement (see above). An SQL SET list, shared by
// the withdrawal (functions/api/studio/donate/[action].js) and "Delete my account" (lib/accounts.js USER_DATA).
export const RECORD_ONLY = "credit = NULL, r2_key = NULL, ext = NULL, bytes = NULL, duration_ms = NULL, checks = NULL, " +
  "crc32 = NULL, pack_key = NULL, pack_bytes = NULL, pack_lines = NULL, pack_title = NULL";

// Columns added after the table was first made (ALTER fails once a column exists; that's fine).
const MIGRATE = [
  "ALTER TABLE voice_donations ADD COLUMN consented TEXT",   // when the donor agreed to the terms (donation_release.created)
  "ALTER TABLE voice_donations ADD COLUMN adult INTEGER",    // the "18 or older" box, as signed
];
let migrated = false;
export async function setupDonations(env) {
  if (migrated) return;
  for (const sql of MIGRATE) {
    try { await env.DB.prepare(sql).run(); } catch (e) {}
  }
  migrated = true;
}

export const DONATE = {
  minBytes: 100 * 1024,          // a 60-second MP3 at 192 kbps is ~1.4 MB; anything this small isn't a whole reading
  maxBytes: 25 * 1024 * 1024,    // like a studio take
  minSeconds: 60,                // the script takes about 2.5 minutes to read
  maxSeconds: 300,
  packBytes: 95 * 1024 * 1024,   // the test pack we upload back (a Worker takes up to 100 MB in one request)
  perDay: 10,                    // sample uploads per account per day
};

export const STATUSES = ["donated", "rendering", "ready", "published", "withdrawn"];

export const donationKey = (owner, id, name) => `studio/${owner}/_donation/${id}/${name}`;

export function newId() {
  return [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, "0")).join("");
}

// The donation terms this account agreed to: {version, agreed, row}.
export async function consentOf(env, user) {
  const row = await env.DB.prepare("SELECT version, signature, adult, created FROM donation_release WHERE user_id = ?").bind(user.id).first();
  return { version: CONSENT_VERSION, agreed: Boolean(row && row.version === CONSENT_VERSION), row };
}

// The account's donation that isn't withdrawn, or null.
export function activeDonation(env, userId) {
  return env.DB.prepare("SELECT * FROM voice_donations WHERE owner = ? AND status != 'withdrawn'").bind(userId).first();
}

// What the donor's page shows of a donation (no storage keys, no signature).
export function view(d) {
  if (!d) return null;
  let checks = {};
  try { checks = JSON.parse(d.checks || "{}"); } catch (e) {}
  return {
    id: d.id, status: d.status, credit: d.credit, bytes: d.bytes, duration: d.duration_ms ? d.duration_ms / 1000 : null,
    checks, script: d.script, consent: d.consent_version, created: d.created, updated: d.updated,
    pack: d.pack_key ? { lines: d.pack_lines, bytes: d.pack_bytes, title: d.pack_title } : null,
    voice: d.status === "published" ? d.voice_id : null, withdrawn: d.withdrawn || null,
  };
}

const minutes = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// VOICES_WEBHOOK (the private voice submissions channel): never the email address or the signature.
export function notifyDonation(webhook, d, kind) {
  const lines = kind === "withdrawn" ? [
    `**Voice donation ${d.id} withdrawn: ${d.credit}**`,
    "The sample and test pack are deleted on the site. The next `uv run python -m lore.donation sync` deletes the local copy;",
    "leave it out of every pack build from now on.",
    d.voice_id ? `It was published as voice \`${d.voice_id}\`: remove its voices.json entry (it already stopped showing).` : "",
  ] : [
    `**Voice donation ${d.id}${kind === "replaced" ? " (new recording)" : ""}: ${d.credit}**`,
    `Length ${d.duration_ms ? minutes(d.duration_ms / 1000) : "?"}, terms ${d.consent_version}, script ${d.script || "?"}.`,
    `Make the voice (GPU, see ~/lore-voice-renders/gpu-queue.md): \`bash experiments/voices/local/donation.sh ${d.id}\``,
  ];
  return postWebhook(webhook, lines.filter(Boolean).join("\n"));
}
