// LOR-723. A private copy of the JPEG actually supplied to an answer; never a new capture, and no image transformation
// here: the companion paints over only its own info strip and the sky, so names, nameplates and chat stay in it.
// Kept until the player erases it, turns this choice or answer logging off, or deletes the account (Mike, 10/21: "too
// much overhead for the size and usage of this addon, we'll address it when users complain"): no expiry, lifecycle
// rule or scheduled job. Each copy carries its own question and answer, so it outlives the answer log's 14 days.
import { playerKey, setupAnswerLog } from "./answer-log.js";
import { jpegSize } from "./pictures.js";
import { imageOf } from "./answer-image.js";
import { perDay } from "./ratelimit.js";

// On wherever the private STUDIO bucket is bound (no public URL or custom domain on it, checked 10/21).
export const storageReady = env => Boolean(env.STUDIO);
export const PREFIX = "diagnostic-screenshots/";
export const PRIVATE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex", Vary: "Cookie, Authorization" };
// A report's image comes within the companion's ten-minute handoff, so a receipt nobody claimed in a day goes.
const RECEIPT_MS = 864e5;
// Of the 50 a day overall, samples take at most 20, so reports always have room (the privacy review, 10/21).
const SAMPLES_PER_DAY = 20;
const ready = new WeakSet();
export async function setupDiagnostics(env) {
  if (ready.has(env.DB)) return;
  await setupAnswerLog(env);
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS diagnostic_consent (user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, version TEXT NOT NULL)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS diagnostic_screenshots (
      ref TEXT PRIMARY KEY, answer_id INTEGER NOT NULL, player TEXT NOT NULL, consent TEXT NOT NULL, obj TEXT NOT NULL,
      sha TEXT NOT NULL, bytes INTEGER NOT NULL, created TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'candidate', reason TEXT,
      question TEXT, answer TEXT, model TEXT, ctx TEXT, zone TEXT, sub TEXT, spoken INTEGER, say TEXT, operation TEXT)`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS diagnostic_player ON diagnostic_screenshots(player)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_obj ON diagnostic_screenshots(obj)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS diagnostic_sweep (id INTEGER PRIMARY KEY CHECK (id = 1), at TEXT NOT NULL)"),
  ]);
  ready.add(env.DB);
}

export async function diagnosticConsent(env, userId) {
  await setupDiagnostics(env);
  const row = await env.DB.prepare("SELECT d.enabled, d.version, k.keep_answers, k.reported FROM diagnostic_consent d " +
    "LEFT JOIN keeps_settings k ON k.user_id = d.user_id WHERE d.user_id = ?").bind(userId).first();
  return row?.enabled === 1 && row.keep_answers !== 0 && row.reported !== 0 ? row.version : null;
}

// Off takes what was kept too, not only what would come next (the privacy review, 10/21). Off when it wasn't on writes
// nothing, so the check-ins that pass on answer logging's off (lib/willo-keeps.js changesFor) cost a read.
export async function setDiagnosticConsent(env, userId, on) {
  if (typeof on !== "boolean") throw new Error("Expected an explicit screenshot choice.");
  await setupDiagnostics(env);
  if (!on) {
    const off = await env.DB.prepare("UPDATE diagnostic_consent SET enabled=0, version=? WHERE user_id=? AND enabled=1")
      .bind(crypto.randomUUID(), userId).run();
    if (off.meta?.changes) await eraseDiagnostics(env, await playerKey(env, userId));
    return false;
  }
  if (!storageReady(env)) throw new Error("Screenshot improvement is not available yet.");
  const row = await env.DB.prepare("SELECT keep_answers, reported FROM keeps_settings WHERE user_id = ?").bind(userId).first();
  if (row?.keep_answers !== 1 && !(row?.keep_answers == null && row?.reported === 1))
    throw new Error("Turn on answer logging first.");
  await env.DB.prepare("INSERT INTO diagnostic_consent(user_id, enabled, version) VALUES (?, 1, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET enabled=1, version=excluded.version").bind(userId, crypto.randomUUID()).run();
  return true;
}

export async function screenshotBytes(image) {
  if (!imageOf(image)) return null;
  const bytes = Uint8Array.from(atob(image), c => c.charCodeAt(0));
  const size = jpegSize(bytes);
  if (!size || size.w > 4096 || size.h > 4096 || size.w * size.h > 8_000_000 ||
      bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return null;
  // Check the complete header/scan boundary too, not just the caller's MIME or SOI magic.
  let offset = 2, frame = false, scan = false;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 255) return null;
    const marker = bytes[offset + 1];
    if (marker === 255) { offset++; continue; }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length - 2) return null;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) return null;
      frame = true;
    }
    if (marker === 0xda) { scan = frame && length >= 6; break; }
    offset += 2 + length;
  }
  if (!scan) return null;
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(n => n.toString(16).padStart(2, "0")).join("");
  return { bytes, sha };
}

// The object's own random 128-bit name, never the answer's reference, which the app and links know (the privacy review).
const newObj = () => [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, "0")).join("");
const keyOf = obj => `${PREFIX}${obj}.jpg`;
// Only scheduled through waitUntil. Missing storage, revoked consent, or any failure drops the copy.
export async function registerScreenshot(env, userId, ref, image, { now = new Date(), random = Math.random, consent: expectedConsent } = {}) {
  try {
    if (!storageReady(env)) return false;
    const consent = await diagnosticConsent(env, userId);
    if (!consent || (expectedConsent !== undefined && consent !== expectedConsent)) return false;
    const file = await screenshotBytes(image);
    if (!file) return false;
    const player = await playerKey(env, userId);
    const answer = await env.DB.prepare("SELECT id, created, question, answer, model, ctx, zone, sub, spoken, say, operation " +
      "FROM answer_log WHERE ref=? AND player=? AND outcome='answered'").bind(ref, player).first();
    if (!answer) return false;
    // The receipt keeps the answer's own record (its text already name-scrubbed by the answer log), so a kept copy
    // still says what was asked after the log's row is gone. Bounded per player and overall.
    const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO diagnostic_screenshots
      (ref, answer_id, player, consent, obj, sha, bytes, created, question, answer, model, ctx, zone, sub, spoken, say, operation)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE
      (SELECT COUNT(*) FROM diagnostic_screenshots WHERE player=?) < 100 AND
      (SELECT COUNT(*) FROM diagnostic_screenshots) < 5000`)
      .bind(ref, answer.id, player, consent, newObj(), file.sha, file.bytes.length, answer.created, answer.question,
        answer.answer, answer.model, answer.ctx, answer.zone, answer.sub, answer.spoken, answer.say, answer.operation, player).run();
    if (!inserted.meta?.changes) return false;
    if (random() < 0.01) return await retainScreenshot(env, userId, ref, image, "sample", { now });
    return true;
  } catch { return false; }
}

export async function retainScreenshot(env, userId, ref, image, reason = "report", { now = new Date() } = {}) {
  try {
    if (!storageReady(env) || !["report", "sample"].includes(reason)) return false;
    const consent = await diagnosticConsent(env, userId);
    if (!consent) return false;
    const player = await playerKey(env, userId);
    const row = await env.DB.prepare("SELECT d.* FROM diagnostic_screenshots d JOIN answer_log a ON a.id=d.answer_id " +
      "WHERE d.ref=? AND d.player=? AND a.player=d.player AND d.consent=? AND (?='sample' OR instr(',' || COALESCE(a.signals,'') || ',', ',reported,')>0)")
      .bind(ref, player, consent, reason).first();
    if (!row) return false;
    const file = await screenshotBytes(image);
    if (!file || file.sha !== row.sha || file.bytes.length !== row.bytes) return false;
    if (row.state === "ready") return true;
    const claim = await env.DB.prepare("UPDATE diagnostic_screenshots SET state='uploading', reason=? WHERE ref=? AND state='candidate'")
      .bind(reason, ref).run();
    if (!claim.meta?.changes) return false;
    // Count attempts, including failures/deletions: deleting a copy must not refill today's allowance. The sample cap
    // goes before the overall one, so samples turned away don't use up the reports' room.
    if (!(await perDay(env, userId, "diagnostic-image", 3, now)) ||
        (reason === "sample" && !(await perDay(env, "diagnostic-global", "diagnostic-sample", SAMPLES_PER_DAY, now))) ||
        !(await perDay(env, "diagnostic-global", "diagnostic-image", 50, now))) {
      await env.DB.prepare("DELETE FROM diagnostic_screenshots WHERE ref=?").bind(ref).run();
      return false;
    }
    await env.STUDIO.put(keyOf(row.obj), file.bytes, { sha256: file.sha, httpMetadata: { contentType: "image/jpeg" } });
    // Recheck after upload: disabling, answer/account deletion and erase can race a slow R2 write.
    const version = await diagnosticConsent(env, userId);
    const saved = version === consent ? await env.DB.prepare("UPDATE diagnostic_screenshots SET state='ready' " +
      "WHERE ref=? AND state='uploading' AND EXISTS(SELECT 1 FROM answer_log WHERE id=diagnostic_screenshots.answer_id)")
      .bind(ref).run() : null;
    if (!saved?.meta?.changes) {
      await env.STUDIO.delete(keyOf(row.obj));
      await env.DB.prepare("DELETE FROM diagnostic_screenshots WHERE ref=?").bind(ref).run();
      return false;
    }
    return true;
  } catch { return false; } // Sweep retries abandoned uploads and any orphan objects.
}

// Invalidate the row BEFORE deleting R2, so in-flight upload cannot resurrect a deleted answer.
export async function eraseDiagnostics(env, player, answerId = null) {
  await setupDiagnostics(env);
  const where = "player=?" + (answerId == null ? "" : " AND answer_id=?");
  const args = [player, ...(answerId == null ? [] : [answerId])];
  const rows = (await env.DB.prepare(`SELECT obj FROM diagnostic_screenshots WHERE ${where}`).bind(...args).all()).results;
  await env.DB.prepare(`UPDATE diagnostic_screenshots SET state='deleted' WHERE ${where}`).bind(...args).run();
  if (rows.length) {
    if (env.STUDIO) await env.STUDIO.delete(rows.map(row => keyOf(row.obj)));
    await env.DB.prepare(`DELETE FROM diagnostic_screenshots WHERE ${where} AND state='deleted'`).bind(...args).run();
  }
}

// Housekeeping, at most hourly (it runs from companion check-ins, lib/answer-log.js sweepAnswerLog, and the private
// POST): unclaimed receipts, erased or stalled copies, and objects no kept copy names. force: the POST's, every time.
export async function sweepDiagnostics(env, now = new Date(), { force = false } = {}) {
  if (!env.STUDIO) return;
  await setupDiagnostics(env);
  if (!force) {
    const due = await env.DB.prepare("INSERT INTO diagnostic_sweep (id, at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE " +
      "SET at=excluded.at WHERE diagnostic_sweep.at < ? RETURNING at")
      .bind(now.toISOString(), new Date(now.getTime() - 3600_000).toISOString()).first();
    if (!due) return;
  }
  await env.DB.prepare("DELETE FROM diagnostic_screenshots WHERE state='candidate' AND created<?")
    .bind(new Date(now.getTime() - RECEIPT_MS).toISOString()).run();
  const stale = new Date(now.getTime() - 3600_000).toISOString();
  const rows = (await env.DB.prepare("SELECT ref, obj FROM diagnostic_screenshots WHERE state='deleted' " +
    "OR (state='uploading' AND created<?) LIMIT 500").bind(stale).all()).results;
  if (rows.length) {
    const refs = rows.map(row => row.ref), placeholders = refs.map(() => "?").join(",");
    await env.DB.prepare(`UPDATE diagnostic_screenshots SET state='deleted' WHERE ref IN (${placeholders})`).bind(...refs).run();
    await env.STUDIO.delete(rows.map(row => keyOf(row.obj)));
    await env.DB.prepare(`DELETE FROM diagnostic_screenshots WHERE ref IN (${placeholders}) AND state='deleted'`).bind(...refs).run();
  }
  // Objects with no ready or uploading copy (a write that failed half way), checked a batch at a time.
  let cursor;
  do {
    const page = await env.STUDIO.list({ prefix: PREFIX, limit: 1000, ...(cursor ? { cursor } : {}) });
    const objs = page.objects.map(o => o.key.slice(PREFIX.length, -4));
    for (let i = 0; i < objs.length; i += 90) {
      const batch = objs.slice(i, i + 90);
      const kept = new Set((await env.DB.prepare(`SELECT obj FROM diagnostic_screenshots WHERE state IN ('ready','uploading') ` +
        `AND obj IN (${batch.map(() => "?").join(",")})`).bind(...batch).all()).results.map(r => r.obj));
      const gone = batch.filter(obj => !kept.has(obj));
      if (gone.length) await env.STUDIO.delete(gone.map(keyOf));
    }
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
}

export async function playerScreenshots(env, userId) {
  await setupDiagnostics(env);
  return (await env.DB.prepare("SELECT ref, answer_id, created, reason, question, answer, model FROM diagnostic_screenshots " +
    "WHERE player=? AND state='ready' ORDER BY created DESC LIMIT 21").bind(await playerKey(env, userId)).all()).results;
}

export async function readScreenshot(env, ref, { userId = null, qa = false } = {}) {
  if (!env.STUDIO || (!qa && !userId)) return null;
  await setupDiagnostics(env);
  const row = await env.DB.prepare("SELECT * FROM diagnostic_screenshots WHERE ref=? AND state='ready'").bind(ref).first();
  if (!row || (!qa && row.player !== await playerKey(env, userId))) return null;
  const object = await env.STUDIO.get(keyOf(row.obj));
  return object ? { row, object } : null;
}
