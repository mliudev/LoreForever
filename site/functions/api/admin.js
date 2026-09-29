// Data for Mike's private dashboard (/admin): sign-up emails, feedback reports and download counts.
// Every request needs "Authorization: Bearer <key>", where the key is ADMIN_KEY, or FEEDBACK_KEY when ADMIN_KEY
// isn't set. With neither set, the endpoint is off. This check is what keeps the data private: the /admin page
// itself holds no data, and lore-forever.pages.dev serves the same functions as the custom domain.
//   GET  /api/admin  -> {"subscribers": [...], "feedback": [...], "downloads": [...], "clicks": N}
//   POST /api/admin  {"action": "status", "id": 3, "status": "done" | "new"}   mark a report handled or not
//                    {"action": "delete-feedback", "id": 3}                     remove a report (spam, tests)
//                    {"action": "delete-subscriber", "email": "a@b.co"}        remove an address (unsubscribe)

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const json = (body, status = 200) => Response.json(body, { status, headers: NO_STORE });

async function safe(query) { try { return await query; } catch (e) { return null; } }   // table may not exist yet

// Compares the two keys through a hash so the time taken doesn't reveal how much of a guess was right.
async function sameKey(a, b) {
  const hash = async s => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function authorized(request, env) {
  const key = env.ADMIN_KEY || env.FEEDBACK_KEY;
  const auth = request.headers.get("Authorization") || "";
  return Boolean(key) && auth.startsWith("Bearer ") && await sameKey(auth.slice(7), key);
}

// Reports saved before the dashboard existed have no status column yet.
async function addStatusColumn(db) {
  await safe(db.prepare("ALTER TABLE feedback ADD COLUMN status TEXT NOT NULL DEFAULT 'new'").run());
}

export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env))) return json({ error: "Needs the admin key." }, 401);
  if (!env.DB) return json({ error: "No D1 database bound as DB" }, 503);
  await addStatusColumn(env.DB);
  const all = async q => (await safe(env.DB.prepare(q).all()))?.results || [];
  const [subscribers, feedback, downloads, clicks] = await Promise.all([
    all("SELECT email, source, created_at FROM subscribers ORDER BY created_at DESC LIMIT 5000"),
    all("SELECT id, created, kind, rating, message, code, email, name, quote_ok, country, " +
        "COALESCE(status, 'new') AS status FROM feedback ORDER BY id DESC LIMIT 2000"),
    all("SELECT day, file, n FROM downloads ORDER BY day DESC LIMIT 400"),
    safe(env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM clicks").first("n")),
  ]);
  return json({ subscribers, feedback, downloads, clicks: clicks || 0 });
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
  if (body.action === "delete-subscriber" && typeof body.email === "string" && body.email) {
    await env.DB.prepare("DELETE FROM subscribers WHERE email = ?").bind(body.email.trim().toLowerCase()).run();
    return json({ ok: true });
  }
  return json({ error: "Unknown action." }, 400);
}
