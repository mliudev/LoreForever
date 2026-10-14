// The admin key check shared by /api/admin and /api/stats. Kept outside functions/ so Pages doesn't route it.
// Two keys, each enough on its own: ADMIN_KEY, the one Mike signs in to /admin with (kept only in his browser and
// 1Password), and FEEDBACK_KEY, the routines' and scripts' (in the repo's .env). Either can be changed without
// breaking the other. Until ADMIN_KEY is set, /admin takes FEEDBACK_KEY. With neither set, nothing is authorized.

// Compares the two keys through a hash so the time taken doesn't reveal how much of a guess was right.
async function sameKey(a, b) {
  const hash = async s => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// True when the request carries "Authorization: Bearer <key>"; never for an empty key. For a check against one
// particular key (GET /api/feedback takes FEEDBACK_KEY itself).
export async function hasBearer(request, key) {
  const auth = request.headers.get("Authorization") || "";
  return Boolean(key) && auth.startsWith("Bearer ") && await sameKey(auth.slice(7), key);
}

// The key comes as "Authorization: Bearer <key>", or as "X-Admin-Key: <key>" (the pipeline's community text pull,
// /api/contribute/export and /shipped, LOR-236).
export async function authorized(request, env) {
  const keys = [env.ADMIN_KEY, env.FEEDBACK_KEY].filter(Boolean);
  const auth = request.headers.get("Authorization") || "";
  const sent = auth.startsWith("Bearer ") ? auth.slice(7) : request.headers.get("X-Admin-Key");
  if (!sent) return false;
  const matches = await Promise.all(keys.map(key => sameKey(sent, key)));   // both, so the time says nothing either
  return matches.includes(true);
}
