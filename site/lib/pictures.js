// The picture book (Mike, 2026-10-05; the "pictures" feature, lib/features.js): pictures a player takes in game with
// the picture key, which the companion app puts on their profile (/u/<handle>), newest first, each with where and when
// it was taken and the caption the companion wrote for it. API in functions/api/profile/pictures/ (index.js: upload,
// list, remove; report.js), the images in functions/pictures/[file].js, the section on the page here (picturesSection,
// shown by lib/profiles.js; public/js/pictures.js opens a picture large). Kept outside functions/ so Pages doesn't
// route it.
//
// The companion sends each picture once (multipart: `meta` JSON and `image`, its web copy), keyed on its own id (cid):
// sending the same cid again updates the picture, and without `image` only what's said about it (a caption written
// after the upload). Only JPEGs (told by their bytes, not the type sent), at most MAX_BYTES, PER_USER per account.
// The files are in R2 (binding STUDIO) at pictures/<user id>/<id>.jpg and served at /pictures/<id>-<sha>.jpg: the
// address names the content, so browsers keep it for a year. Where and when each was taken (realm, map position,
// time) is kept for a later realm chronicle, pictures of one live event (a march on the Undercity) by many players.
//
// Nobody reviews pictures by hand: reports from REPORTS_TO_HIDE independent senders (another account, or signed out
// another IP, on any day: reportPicture) hide one for good. Reporting needs no account. Its owner can remove any of
// theirs. Tables in lib/accounts.js SETUP and USER_DATA, so "Delete my account" removes them (and the files);
// "Delete my profile" does too (forgetPictures).

import { escape } from "./voices.js";
import { independentSenders } from "./contribute.js";
import { sha256 } from "./accounts.js";

export const MAX_BYTES = 1024 * 1024;   // the companion's web copy (long edge 1920, JPEG q85) is well under this
export const PER_USER = 500;
export const CAPTION_MAX = 600;
export const PER_MINUTE = 30;           // a companion catching up on a backlog waits on 429 and carries on
export const PER_HOUR = 600;
export const REPORTS_TO_HIDE = 3;
export const REPORTS_PER_DAY = 30;      // per sender (the day's IP hash)
export const SHOWN = 48;                // the page shows the newest this many; the rest are folded
const R2_PREFIX = "pictures/";
const OLDEST = Date.parse("2004-11-23T00:00:00Z") / 1000;   // nothing was taken in WoW before it came out

export const fileKey = (userId, id) => `${R2_PREFIX}${userId}/${id}.jpg`;
export const pictureUrl = row => `/pictures/${row.id}-${row.sha}.jpg`;

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
const newId = () => hex(crypto.getRandomValues(new Uint8Array(8)));

// ---- What the companion sends ----

const CONTROL = /[\u0000-\u001f\u007f]/g;
// A text field as stored: one line, trimmed, at most `max` characters; null when it's empty or not text.
const text = (v, max) => {
  if (typeof v !== "string") return null;
  return Array.from(v.replace(CONTROL, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("") || null;
};
// A whole number from lo to hi, or null.
const int = (v, lo, hi) => {
  if (typeof v !== "number" && !(typeof v === "string" && v.trim())) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
// "mapID:x:y" (x and y in thousandths of that map, as the add-on's journal keeps them) -> {map, x, y}.
function spot(v) {
  const m = /^(\d{1,7}):(\d{1,4}(?:\.\d+)?):(\d{1,4}(?:\.\d+)?)$/.exec(typeof v === "string" ? v.trim() : "");
  const [map, x, y] = m ? [int(m[1], 0, 9999999), int(m[2], 0, 1000), int(m[3], 0, 1000)] : [];
  return map !== null && x !== null && y !== null && m ? { map, x, y } : { map: null, x: null, y: null };
}

// The meta of an upload, as {cid, fields} (fields: the columns it sets, only for the keys it has, so a later update
// that leaves one out keeps it) or {error}. w and h come from the image itself, never from here.
export function readMeta(raw) {
  let m;
  try { m = JSON.parse(raw); } catch (e) { return { error: "Couldn't read the picture's details." }; }
  if (!m || typeof m !== "object" || Array.isArray(m)) return { error: "Couldn't read the picture's details." };
  const cid = typeof m.cid === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(m.cid) ? m.cid : null;
  if (!cid) return { error: "The picture needs its id (cid)." };
  const has = k => Object.hasOwn(m, k);
  const fields = {};
  // Optional exact shot identity from Herald. Never infer it from a screenshot's clock or place.
  if (has("character") || has("event_t")) {
    if (!(typeof m.character === "string" && /^[a-f0-9]{64}$/.test(m.character)) ||
        !Number.isInteger(m.event_t) || m.event_t < OLDEST || m.event_t > Math.floor(Date.now() / 1000) + 2 * 86400) {
      return { error: "The picture's journey match needs its character and event time." };
    }
    fields.character = m.character;
    fields.event_t = m.event_t;
  }
  if (has("t")) {
    const t = int(m.t, OLDEST, Math.floor(Date.now() / 1000) + 2 * 86400);
    if (t !== null) fields.t = t;
  }
  for (const [k, col, max] of [["realm", "realm", 60], ["faction", "faction", 20], ["race", "race", 30],
    ["class", "class", 30], ["z", "zone", 80], ["s", "subzone", 80]]) {
    if (has(k)) fields[col] = text(m[k], max);
  }
  if (has("lv")) fields.lv = int(m.lv, 1, 100);
  if (has("at")) Object.assign(fields, spot(m.at));
  if (has("clean") || has("pic")) fields.clean = (m.clean ?? m.pic) ? 1 : 0;
  // restore: the player turned "On my profile" on again for a picture they'd removed on the page (savePicture).
  const restore = m.restore === true;
  if (has("caption")) {
    fields.caption = typeof m.caption === "string"
      ? Array.from(m.caption.replace(CONTROL, " ").replace(/\s+/g, " ").trim()).slice(0, CAPTION_MAX).join("") || null
      : null;
  }
  return { cid, fields, restore };
}

// A JPEG starts FF D8 FF, whatever it's called or sent as.
export const isJpeg = b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

// A JPEG's width and height from its frame header (SOF0-SOF15, but not DHT, JPG or DAC), or null when it has none
// before its image data.
export function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }                                        // fill
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; }         // markers without a length
    if (m === 0xda || m === 0xd9) return null;                                // image data, or the end
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const h = (b[i + 5] << 8) | b[i + 6], w = (b[i + 7] << 8) | b[i + 8];
      return w && h ? { w, h } : null;
    }
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return null;
}

// ---- Storing ----

const COLUMNS = ["realm", "faction", "race", "class", "lv", "zone", "subzone", "map", "x", "y", "t", "w", "h", "bytes",
                 "sha", "clean", "caption", "character", "event_t"];
const EMPTY = { ...Object.fromEntries(COLUMNS.map(c => [c, null])), clean: 0 };

const reply = (status, body) => ({ status, body: { ok: status === 200, ...body } });

// A picture as the API gives it. The owner also gets its cid and whether it was hidden (then without an address).
export function shown(row, owner = false) {
  const out = { id: row.id, url: row.hidden ? null : pictureUrl(row), t: row.t, w: row.w, h: row.h, lv: row.lv,
                zone: row.zone, subzone: row.subzone, caption: row.caption };
  if (row.character && row.event_t) Object.assign(out, { character: row.character, event_t: row.event_t });
  return owner ? { ...out, cid: row.cid, clean: Boolean(row.clean), hidden: Boolean(row.hidden) } : out;
}

// Saves a picture for the account: meta from readMeta, image the bytes sent (null: update only the meta of a picture
// sent before). Returns {status, body} for the response. A picture its owner removed on the page stays removed (410
// {removed}): the companion may still send it, a caption written later or the whole picture again, and it mustn't
// come back. Only the whole picture with `restore: true` in its meta (the player turned "On my profile" on again in
// the companion) brings it back.
export async function savePicture(env, userId, { cid, fields, restore }, image) {
  const removed = await env.DB.prepare("SELECT 1 FROM picture_tombstones WHERE user_id = ? AND cid = ?").bind(userId, cid).first();
  if (removed && !(restore && image)) return reply(410, { removed: true, error: "You removed that picture from your profile." });
  let file = null;
  if (image) {
    if (image.length > MAX_BYTES) return reply(413, { error: "That picture is over 1 MB." });
    const size = isJpeg(image) ? jpegSize(image) : null;
    if (!size) return reply(415, { error: "Only JPEG pictures, please." });
    file = { ...size, bytes: image.length, sha: hex(await crypto.subtle.digest("SHA-256", image)).slice(0, 10) };
  }
  if (removed) await env.DB.prepare("DELETE FROM picture_tombstones WHERE user_id = ? AND cid = ?").bind(userId, cid).run();
  const find = () => env.DB.prepare("SELECT * FROM profile_pictures WHERE user_id = ? AND cid = ?").bind(userId, cid).first();
  let old = await find();
  if (!old) {
    if (!file) return reply(404, { missing: true, error: "There's no picture with that id yet: send it with its image." });
    if (fields.t === undefined) return reply(400, { error: "Say when the picture was taken (t)." });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM profile_pictures WHERE user_id = ?").bind(userId).first("n");
    if (n >= PER_USER) {
      return reply(409, { full: true, error: `Your picture book is full (${PER_USER} pictures). Remove some to add more.` });
    }
    const id = newId();
    const row = { ...EMPTY, ...fields, ...file };
    await env.STUDIO.put(fileKey(userId, id), image, { httpMetadata: { contentType: "image/jpeg" } });
    const res = await env.DB.prepare(
      `INSERT INTO profile_pictures (id, user_id, cid, ${COLUMNS.join(", ")}, created) ` +
      `VALUES (?, ?, ?, ${COLUMNS.map(() => "?").join(", ")}, ?) ON CONFLICT (user_id, cid) DO NOTHING`
    ).bind(id, userId, cid, ...COLUMNS.map(c => row[c]), new Date().toISOString()).run();
    if (res.meta.changes) return reply(200, { created: true, picture: shown(await find(), true) });
    // The same picture sent twice at once: the other one made the row, so this one updates it.
    await env.STUDIO.delete(fileKey(userId, id));
    old = await find();
  }
  // Sent again: what it says now, over what it said before. A hidden picture stays hidden.
  if (file) await env.STUDIO.put(fileKey(userId, old.id), image, { httpMetadata: { contentType: "image/jpeg" } });
  const row = { ...old, ...fields, ...(file || {}) };
  await env.DB.prepare(`UPDATE profile_pictures SET ${COLUMNS.map(c => `${c} = ?`).join(", ")} WHERE id = ?`)
    .bind(...COLUMNS.map(c => row[c]), old.id).run();
  return reply(200, { created: false, picture: shown(row, true) });
}

// Removes one of the account's pictures (by id, or by the companion's cid), its file and its reports. Removed on the
// page (onPage), its cid is remembered (picture_tombstones) so the companion, which doesn't know, can't send it back
// (savePicture); the companion's own removal needs none, since it won't send that picture again by itself. False when
// the account had no such picture.
export async function removePicture(env, userId, { id, cid }, { onPage = false } = {}) {
  const row = id ? await env.DB.prepare("SELECT id, cid FROM profile_pictures WHERE user_id = ? AND id = ?").bind(userId, id).first()
    : cid ? await env.DB.prepare("SELECT id, cid FROM profile_pictures WHERE user_id = ? AND cid = ?").bind(userId, cid).first()
    : null;
  if (!row) return false;
  await env.STUDIO?.delete(fileKey(userId, row.id));
  await env.DB.batch([
    onPage && env.DB.prepare("INSERT OR IGNORE INTO picture_tombstones (user_id, cid, created) VALUES (?, ?, ?)")
      .bind(userId, row.cid, new Date().toISOString()),
    env.DB.prepare("DELETE FROM picture_reports WHERE picture_id = ?").bind(row.id),
    env.DB.prepare("DELETE FROM profile_pictures WHERE id = ?").bind(row.id),
  ].filter(Boolean));
  return true;
}

// Every picture of the account, files, reports and removed cids too ("Delete my profile"; "Delete my account" does the
// same through lib/accounts.js USER_DATA). A new profile starts with an empty picture book.
export async function forgetPictures(env, userId) {
  if (env.STUDIO) {
    let cursor;
    do {
      const page = await env.STUDIO.list({ prefix: `${R2_PREFIX}${userId}/`, cursor });
      if (page.objects.length) await env.STUDIO.delete(page.objects.map(o => o.key));
      cursor = page.truncated ? page.cursor : null;
    } while (cursor);
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM picture_reports WHERE picture_id IN (SELECT id FROM profile_pictures WHERE user_id = ?)").bind(userId),
    env.DB.prepare("DELETE FROM profile_pictures WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM picture_tombstones WHERE user_id = ?").bind(userId),
  ]);
}

// The account's pictures, newest first (by when they were taken). Hidden ones only with `all` (for their owner).
export async function listPictures(env, userId, { all = false } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM profile_pictures WHERE user_id = ?${all ? "" : " AND hidden = 0"} ORDER BY t DESC, created DESC`
  ).bind(userId).all();
  return results;
}

// ---- Reports ----

// A report on picture `id` from this request (user: the signed-in account, or null). Senders are told apart by account
// when signed in, else by IP, on any day: the IP's hash is salted per picture (report_salt), never per day, so one
// person can't hide a picture alone by coming back tomorrow. An account and the IP it reported from are one sender
// (independentSenders chains them), so neither more accounts nor more days add up. Returns {status, body}; body.hidden
// once it's hidden.
export async function reportPicture(env, request, id, user) {
  const pic = typeof id === "string" && /^[0-9a-f]{16}$/.test(id)
    ? await env.DB.prepare("SELECT id, user_id, hidden FROM profile_pictures WHERE id = ?").bind(id).first() : null;
  if (!pic) return reply(404, { error: "That picture isn't here any more." });
  if (user && user.id === pic.user_id) return reply(400, { error: "That's your own picture: remove it instead." });
  if (pic.hidden) return reply(200, { hidden: true });
  const now = new Date().toISOString();
  const salt = await env.DB.prepare(
    "UPDATE profile_pictures SET report_salt = COALESCE(report_salt, ?) WHERE id = ? RETURNING report_salt"
  ).bind(newId() + newId(), pic.id).first("report_salt");
  const ipHash = (await sha256(`${salt}:${request.headers.get("CF-Connecting-IP") || ""}`)).slice(0, 24);
  const again = await env.DB.prepare(
    "SELECT 1 FROM picture_reports WHERE picture_id = ? AND (user_id = ? OR ip_hash = ?)"
  ).bind(pic.id, user ? user.id : null, ipHash).first();
  if (!again) {
    await env.DB.prepare("INSERT INTO picture_reports (picture_id, user_id, ip_hash, created) VALUES (?, ?, ?, ?)")
      .bind(pic.id, user ? user.id : null, ipHash, now).run();
  }
  const { results } = await env.DB.prepare("SELECT user_id, ip_hash FROM picture_reports WHERE picture_id = ?")
    .bind(pic.id).all();
  const n = independentSenders(results.map(r => ({ uploader: r.user_id ? "u:" + r.user_id : null, ip_hash: r.ip_hash })));
  const hidden = n >= REPORTS_TO_HIDE;
  await env.DB.prepare("UPDATE profile_pictures SET reports = ?, hidden = MAX(hidden, ?) WHERE id = ?")
    .bind(n, hidden ? 1 : 0, pic.id).run();
  return reply(200, { hidden });
}

// ---- The section on the profile ----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// The day it was taken, on the player's own clock when the companion's journey data says it (tz: minutes from UTC).
const dayOf = (t, tz) => {
  const d = new Date((t + tz * 60) * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};
export const placeOf = r => [...new Set([r.subzone, r.zone].filter(Boolean))].join(", ");

function tile(r, tz) {
  const place = placeOf(r);
  const when = [dayOf(r.t, tz), r.lv ? `Level ${r.lv}` : ""].filter(Boolean).map(escape).join(" &middot; ");
  const w = r.w ? ` width="${r.w}"` : "", h = r.h ? ` height="${r.h}"` : "";
  return `<li class="pb-item" id="p-${escape(r.id)}">
        <a class="pb-shot" href="${escape(pictureUrl(r))}"><img src="${escape(pictureUrl(r))}"${w}${h} alt="${escape(r.caption || place || "A picture from the journey")}" loading="lazy" decoding="async"></a>
        ${place ? `<p class="pb-where">${escape(place)}</p>` : ""}
        <p class="pb-when">${when}</p>
        ${r.caption ? `<p class="pb-cap">${escape(r.caption)}</p>` : ""}
      </li>`;
}

// The "Picture book" section of /u/<handle>: the pictures (not hidden; listPictures), newest first, the newest SHOWN
// open and the rest folded, and the dialog public/js/pictures.js shows one in. owner: the viewer owns the profile
// (they can remove pictures; everyone else can report one). tz: the player's offset from UTC in minutes. Nothing for
// a visitor when there are no pictures; a line for the owner.
export function picturesSection(list, { owner = false, tz = 0 } = {}) {
  if (!list?.length && !owner) return "";
  const head = `<section class="vp-section pb" id="pictures" aria-labelledby="pictures-title">
    <h2 id="pictures-title">Picture book</h2>`;
  if (!list?.length) {
    return `${head}
    <p class="vp-note">No pictures yet. In game, take one with the Take a journey picture key (or <code>/lore picture</code>),
    and the companion app puts it here when its Picture book is on.</p>
  </section>`;
  }
  const off = Number.isInteger(tz) && Math.abs(tz) <= 840 ? tz : 0;
  const open = list.slice(0, SHOWN), folded = list.slice(SHOWN);
  const act = owner ? '<button class="pf-del" type="button" data-pb="remove">Remove from my profile</button>'
    : '<button class="pf-del" type="button" data-pb="report">Report this picture</button>';
  return `${head}
    <ul class="pb-grid">
      ${open.map(r => tile(r, off)).join("\n      ")}
    </ul>${folded.length ? `
    <details class="pf-older pb-older"><summary>Older pictures (${folded.length})</summary>
    <ul class="pb-grid">
      ${folded.map(r => tile(r, off)).join("\n      ")}
    </ul>
    </details>` : ""}
    <dialog class="pb-dlg" id="pb-view" aria-label="Picture">
      <figure>
        <img class="pb-big" alt="">
        <figcaption><p class="pb-where"></p><p class="pb-when"></p><p class="pb-cap"></p></figcaption>
      </figure>
      <div class="pb-bar">
        <button class="btn-small btn-small-alt" type="button" data-pb="prev" aria-label="Previous picture">&larr;</button>
        <button class="btn-small btn-small-alt" type="button" data-pb="next" aria-label="Next picture">&rarr;</button>
        ${act}
        <button class="pb-x" type="button" data-pb="close" aria-label="Close">&times;</button>
      </div>
      <p class="fb-status pb-status" role="status" hidden></p>
    </dialog>
  </section>`;
}
