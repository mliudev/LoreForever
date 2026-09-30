// Saves an email from the landing page's optional sign-up form in the D1 database bound as DB.
// No confirmation step: Mike wants the simplest flow ("get an email and move on").
//   POST /api/subscribe  {"email": "...", "source": "landing-page"}  -> 204, or 400 for a bad address
// There's deliberately no GET: read the list in the Cloudflare dashboard (D1 > loreforever > Console).

const SETUP = `CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY, source TEXT, created_at TEXT NOT NULL)`;
const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch (e) {}
  if (body.website) return new Response(null, { status: 204 });   // hidden field only bots fill in
  const email = String(body.email || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) {
    return Response.json({ error: "invalid email" }, { status: 400 });
  }
  const source = String(body.source || "").slice(0, 40);
  if (env.DB) {
    await env.DB.batch([
      env.DB.prepare(SETUP),
      env.DB.prepare("INSERT INTO subscribers (email, source, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING")
        .bind(email, source, new Date().toISOString()),
    ]);
  }
  return new Response(null, { status: 204 });
}
