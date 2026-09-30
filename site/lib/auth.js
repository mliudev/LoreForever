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

export async function authorized(request, env) {
  const key = env.ADMIN_KEY || env.FEEDBACK_KEY;
  const auth = request.headers.get("Authorization") || "";
  return Boolean(key) && auth.startsWith("Bearer ") && await sameKey(auth.slice(7), key);
}
