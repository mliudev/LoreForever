// The guides editor (/guides/edit; site/GUIDES.md): Patrick writes, edits and publishes guides in the browser, with a
// live preview and pictures, and a save is live at once (no deploy). Articles are rows in D1 (`guides`); every save is
// also kept in `guide_revisions`, so an earlier version can be brought back. Pictures go to R2 (STUDIO, under
// guides/img/) and are served at /guides/img/<name> (functions/guides/img/[name].js). An editor row replaces the file
// article with the same address (lib/guides.js loadIndex/loadArticle), so the files in public/guides/articles open in
// the editor too and move to it on their first save; deleting one there hides it.
// Who may edit: the site accounts whose emails are in the Pages variable GUIDE_EDITORS (comma-separated). Unset, nobody.

import { currentUser } from "./accounts.js";
import { editorRows, fileIndex, loadFileArticle, problems, rowArticle } from "./guides.js";

const SETUP = [
  `CREATE TABLE IF NOT EXISTS guides (
    slug TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, date TEXT NOT NULL, updated TEXT,
    kind TEXT NOT NULL, author TEXT, draft INTEGER NOT NULL DEFAULT 1, body TEXT NOT NULL DEFAULT '',
    deleted INTEGER NOT NULL DEFAULT 0, saved_at TEXT NOT NULL, saved_by TEXT)`,
  `CREATE TABLE IF NOT EXISTS guide_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, title TEXT, description TEXT, date TEXT, updated TEXT,
    kind TEXT, author TEXT, draft INTEGER, body TEXT, saved_at TEXT NOT NULL, saved_by TEXT)`,
  "CREATE INDEX IF NOT EXISTS guide_revisions_slug ON guide_revisions (slug, id)",
];
const ready = new WeakMap();
function setupGuides(env) {
  if (!ready.has(env.DB)) ready.set(env.DB, env.DB.batch(SETUP.map(s => env.DB.prepare(s)))
    .catch(e => { ready.delete(env.DB); throw e; }));
  return ready.get(env.DB);
}

export const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
export const IMAGE_NAME = /^[0-9a-f]{20}\.(png|jpg|webp|gif)$/;
export const IMAGE_MAX = 8 * 1024 * 1024;
export const imageKey = name => `guides/img/${name}`;
const BODY_MAX = 200_000;

export const editors = env => String(env.GUIDE_EDITORS || "").toLowerCase().split(/[\s,;]+/).filter(Boolean);

// {user} for an editor, else {status, error}: 401 when signed out, 403 for an account that isn't an editor.
export async function editorFor(env, request) {
  const user = await currentUser(env, request);
  if (!user) return { status: 401, error: "Sign in to edit guides." };
  const email = String(user.email || "").toLowerCase();
  if (!email || !editors(env).includes(email)) {
    return { status: 403, error: `This account (${user.email || "no email"}) can't edit guides yet. Ask Mike to add it.` };
  }
  return { user };
}

const today = () => new Date().toISOString().slice(0, 10);
const flat = ({ slug, meta, body }, extra) => ({ slug, title: meta.title || "", description: meta.description || "",
  date: meta.date || "", updated: meta.updated || "", kind: meta.kind || "tutorial", author: meta.author || "",
  draft: !!meta.draft, body, ...extra });

// Every article for the editor's list, drafts too: [{slug, title, date, kind, draft, source, saved_at, saved_by}].
export async function listAll(env, request) {
  const [files, rows] = await Promise.all([fileIndex(env, request),
    editorRows(env, "SELECT slug, title, date, kind, draft, deleted, saved_at, saved_by FROM guides")]);
  const by = new Map(files.map(a => [a.slug, { slug: a.slug, title: a.title, date: a.date, kind: a.kind,
    draft: !!a.draft, source: "file", saved_at: null, saved_by: null }]));
  for (const r of rows) {
    if (r.deleted) by.delete(r.slug);
    else by.set(r.slug, { slug: r.slug, title: r.title, date: r.date, kind: r.kind, draft: !!r.draft,
      source: "editor", saved_at: r.saved_at, saved_by: r.saved_by });
  }
  return [...by.values()].sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.slug.localeCompare(b.slug));
}

// One article to edit: the editor's row, else the file; null when there's neither (or it was deleted).
export async function getOne(env, request, slug) {
  const [row] = await editorRows(env, "SELECT * FROM guides WHERE slug = ?", slug);
  if (row) return row.deleted ? null : flat(rowArticle(row), { source: "editor", saved_at: row.saved_at });
  const file = await loadFileArticle(env, request, slug);
  return file ? flat(file, { source: "file", saved_at: null }) : null;
}

export const revisions = (env, slug) => editorRows(env,
  "SELECT id, saved_at, saved_by, draft, title FROM guide_revisions WHERE slug = ? ORDER BY id DESC LIMIT 30", slug)
  .then(rows => rows.map(r => ({ ...r, draft: !!r.draft })));

export async function getRevision(env, slug, id) {
  const [r] = await editorRows(env, "SELECT * FROM guide_revisions WHERE slug = ? AND id = ?", slug, Number(id) || 0);
  return r ? flat(rowArticle(r), { source: "revision", revision: r.id, revision_saved_at: r.saved_at }) : null;
}

// The article as sent by the editor: {slug, meta, body}, trimmed.
export function fromInput(input) {
  const m = input?.meta || {};
  const text = v => String(v ?? "").replace(/\s+/g, " ").trim();
  return { slug: text(input?.slug).toLowerCase(), body: String(input?.body ?? "").replace(/\r\n?/g, "\n"), meta: {
    title: text(m.title), description: text(m.description), date: text(m.date), kind: text(m.kind),
    author: text(m.author), updated: text(m.updated), draft: !!m.draft } };
}

// Save an article: {article} or {status, error}. `base` is the saved_at the editor opened (null for a file or a new
// article), so a save over someone else's newer one is refused (409) instead of losing it. A published article saved
// published again gets today as its "updated" date.
export async function save(env, request, user, input) {
  const { slug, meta, body } = fromInput(input);
  const bad = problems(slug, meta);
  if (bad.length) return { status: 400, error: bad.join("; ") };
  if (body.length > BODY_MAX) return { status: 413, error: "That article is too long to save." };
  await setupGuides(env);
  const current = await getOne(env, request, slug);
  if (input.isNew && current) return { status: 409, error: "Another article already has that address; pick another." };
  if (!input.isNew && (current?.saved_at || null) !== (input.base || null)) {
    return { status: 409, error: "Someone saved this article after you opened it. Copy your changes, then reload." };
  }
  const wasPublished = current && !current.draft;
  const updated = wasPublished && !meta.draft && meta.date < today() ? today() : meta.updated || null;
  // Always later than the save before, even within the same millisecond, so `base` tells every save apart.
  const now = new Date(Math.max(Date.now(), (Date.parse(current?.saved_at || "") || 0) + 1)).toISOString();
  const row = [slug, meta.title, meta.description, meta.date, updated, meta.kind, meta.author || null,
    meta.draft ? 1 : 0, body, now, user.email];
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO guides (slug, title, description, date, updated, kind, author, draft, body, deleted,
      saved_at, saved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET title = excluded.title, description = excluded.description, date = excluded.date,
      updated = excluded.updated, kind = excluded.kind, author = excluded.author, draft = excluded.draft,
      body = excluded.body, deleted = 0, saved_at = excluded.saved_at, saved_by = excluded.saved_by`).bind(...row),
    env.DB.prepare(`INSERT INTO guide_revisions (slug, title, description, date, updated, kind, author, draft, body,
      saved_at, saved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...row),
  ]);
  return { article: await getOne(env, request, slug) };
}

// Delete an article: hidden everywhere, its text and versions kept (a file article stays in git, hidden by the row).
export async function remove(env, request, user, slug) {
  const current = await getOne(env, request, slug);
  if (!current) return { status: 404, error: "No such article." };
  await setupGuides(env);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO guides (slug, title, description, date, updated, kind, author, draft, body, deleted,
      saved_at, saved_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET deleted = 1, saved_at = excluded.saved_at, saved_by = excluded.saved_by`)
    .bind(slug, current.title, current.description, current.date, current.updated || null, current.kind,
      current.author || null, current.body, now, user.email).run();
  return { ok: true };
}
