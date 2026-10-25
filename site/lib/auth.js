import { createRemoteJWKSet, jwtVerify } from "./vendor/jose.js";   // vendored: Pages runs no npm install

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

// ---- Cloudflare Access service tokens (LOR-493) ----------------------------------------------------------------
// Scripts (the Voice Coordinator's upload, routines) have no browser session, so they present an Access service token
// (CF-Access-Client-Id / -Secret). Access checks it at the edge and forwards a signed JWT in Cf-Access-Jwt-Assertion;
// this verifies that signature itself instead of trusting that the header exists, so a request that reaches the site
// by any route Access doesn't cover (another hostname) is refused. Ported from dashboard/src/auth.mjs.
//   ACCESS_ISSUER        https://<team>.cloudflareaccess.com           (plain Pages variables, not secrets)
//   ACCESS_AUD           the Access application's audience tag
//   ACCESS_SCRIPT_TOKENS comma list of service-token client IDs allowed to act as scripts
// With any of the three missing the token path is off (503), never open.
const keySets = new Map();

// What jose throws when the TOKEN is the problem (forged, expired, wrong audience or issuer, malformed, a key that isn't
// Access's): the caller is refused (401). Anything else (the keys couldn't be fetched, a crypto or import error, a bug) is
// our side breaking: 503, logged, never a quiet "no".
const TOKEN_FAULT = new Set(["ERR_JWT_EXPIRED", "ERR_JWT_CLAIM_VALIDATION_FAILED", "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JWS_INVALID", "ERR_JWT_INVALID", "ERR_JOSE_ALG_NOT_ALLOWED", "ERR_JOSE_NOT_SUPPORTED", "ERR_JWKS_NO_MATCHING_KEY",
  "ERR_JWKS_MULTIPLE_MATCHING_KEYS"]);

export async function accessService(request, env) {
  const issuer = typeof env.ACCESS_ISSUER === "string" ? env.ACCESS_ISSUER.trim() : "";
  const audience = typeof env.ACCESS_AUD === "string" ? env.ACCESS_AUD.trim() : "";
  const allowed = String(env.ACCESS_SCRIPT_TOKENS || "").split(",").map(s => s.trim()).filter(Boolean);
  let jwksUrl;
  try {
    const url = new URL(issuer);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    jwksUrl = new URL("/cdn-cgi/access/certs", url).href;
  } catch {
    jwksUrl = "";
  }
  if (!jwksUrl || !audience || !allowed.length) return { ok: false, status: 503, error: "Access service tokens aren't set up here." };
  const refused = { ok: false, status: 401, error: "Needs the admin key or an Access service token." };
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 16384) return refused;
  try {
    let keys = keySets.get(jwksUrl);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(jwksUrl), { timeoutDuration: 5000 });
      if (keySets.size >= 8) keySets.clear();
      keySets.set(jwksUrl, keys);
    }
    const { payload } = await jwtVerify(token, keys, {
      issuer, audience, algorithms: ["RS256"], requiredClaims: ["exp", "iat", "iss", "aud"], clockTolerance: 5 });
    if (payload.iat > Date.now() / 1000 + 5 || payload.type !== "app") return refused;
    // A service token's JWT has no email, an empty sub and common_name = the token's client ID; a person's has an email.
    if (payload.email || payload.sub !== "" || typeof payload.common_name !== "string") return refused;
    if (!allowed.includes(payload.common_name)) return refused;
    return { ok: true, clientId: payload.common_name };
  } catch (e) {
    if (TOKEN_FAULT.has(e?.code)) return refused;
    console.error("accessService: can't check Access tokens:", e?.code || e?.name || "error", String(e?.message || "").slice(0, 200));
    return { ok: false, status: 503, error: "Couldn't check the Access token just now. Try again." };
  }
}

// The gate for routes under /api/admin/ that scripts write to: ADMIN_KEY alone (Mike's browser, `wrangler pages dev`),
// or a verified Access service token. Never FEEDBACK_KEY. {ok: true}, or {ok: false, status, error} for fail().
export async function adminOrService(request, env) {
  if (await hasBearer(request, env.ADMIN_KEY)) return { ok: true, via: "admin-key" };
  return accessService(request, env);
}
