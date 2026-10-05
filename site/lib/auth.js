// The admin key check shared by /api/admin and /api/stats. Kept outside functions/ so Pages doesn't route it.
// The key is ADMIN_KEY, or FEEDBACK_KEY when ADMIN_KEY isn't set. With neither set, nothing is authorized.

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
  const key = env.ADMIN_KEY || env.FEEDBACK_KEY;
  if (!key) return false;
  const auth = request.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ")) return sameKey(auth.slice(7), key);
  const header = request.headers.get("X-Admin-Key");
  return Boolean(header) && sameKey(header, key);
}
