// Lore Forever accounts (lib/accounts.js), used by /account, /voices/submit and /feedback. Contributors and anyone
// sending feedback need one; playing, listening and liking don't.
//   GET  /api/auth/me       {user, voices, signIn: {google: client id or null}, features: {contribute, zones, lore,
//                           companion}};
//                           user is null when signed out; user.session_expires: when this sign-in ends
//   POST /api/auth/google   {credential}: a Google ID token from the Sign in with Google button -> session cookie
//   POST /api/auth/email-start   {email} -> {to, expires_in, resend_after}: emails a 6-digit sign-in code
//                           (lib/email-signin.js; signIn.email says whether it's open here); on develop, for an
//                           @example.test address, testCode instead of an email
//   POST /api/auth/email-verify  {email, code} -> session cookie, for the account with that address (or a new one)
//   POST /api/auth/shown    {} counts a sign-in screen shown (lib/email-signin.js signin_steps); 60 an hour per sender
//   POST /api/auth/logout   ends this session
//   POST /api/auth/profile  {display_name, links, show_public}: what /contributors shows
//   POST /api/auth/voice    {id, bio}: the bio on one of your voices' profile pages
//   POST /api/auth/delete   {confirm: "delete"}: deletes the account and everything tied to it
// Every POST must come from our own pages (Origin check) and sends JSON.

import {
  setup, currentUser, startSession, endSession, findOrCreateUser, recordTerms, deleteUser, verifyGoogle, fail, noStore, sameOrigin,
} from "../../../lib/accounts.js";
import { loadVoices, linkList } from "../../../lib/voices.js";
import { clean } from "../../../lib/form.js";
import { setupStudio } from "../../../lib/studio.js";
import { featureOn } from "../../../lib/features.js";
import { forgetTranslatorCredits } from "../../../lib/translations.js";
import { noteJoin, noteBrowser } from "../../../lib/referrals.js";
import { noteSignup } from "../../../lib/sources.js";
import { startCode, verifyCode, refusal, noteStep, emailSignInOn } from "../../../lib/email-signin.js";
import { perHour } from "../../../lib/ratelimit.js";
import { senderHash } from "../../../lib/form.js";

const ok = (body = {}, ...cookies) => {
  const headers = new Headers(noStore);
  for (const cookie of cookies) if (cookie) headers.append("Set-Cookie", cookie);
  return Response.json({ ok: true, ...body }, { headers });
};

const signInOptions = (env, request) => ({ google: env.GOOGLE_CLIENT_ID || null, email: emailSignInOn(env, request) });
// Site features waiting for an add-on release (lib/features.js), for links header.js adds on every page.
const features = env => ({
  contribute: featureOn(env, "contribute"), zones: featureOn(env, "zones"), lore: featureOn(env, "lore"),
  companion: featureOn(env, "companion"),
});

async function me({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return ok({ user: null, voices: [], signIn: signInOptions(env, request), features: features(env) });
  await setupStudio(env);   // the voices.locale column
  const { results } = await env.DB.prepare(
    "SELECT v.id, v.name, v.status, v.bio, v.locale, v.created, (SELECT COUNT(*) FROM studio_takes t WHERE t.voice_id = v.id) AS files " +
    "FROM voices v WHERE v.owner = ? ORDER BY v.created"
  ).bind(user.id).all();
  const listed = new Set((await loadVoices(env, request)).filter(v => v.owner === user.id).map(v => v.id));
  return ok({
    user: {
      email: user.email, display_name: user.display_name, links: user.links || "", show_public: Boolean(user.show_public),
      google: Boolean(user.google_sub), created: user.created, session_expires: user.session_expires,
    },
    voices: results.map(v => ({ ...v, status: listed.has(v.id) ? "published" : v.status })),
    signIn: signInOptions(env, request),
    features: features(env),
  });
}

async function google(context, input) {
  const { env } = context;
  const claims = await verifyGoogle(env, input.credential);
  if (!claims) return fail(401, "Google sign-in didn't go through. Please try again.");
  const user = await findOrCreateUser(env, { email: claims.email.toLowerCase(), googleSub: claims.sub, name: claims.name });
  await recordTerms(env, user.id);   // the sign-in pages say signing in agrees to the Terms and Privacy
  await noteStep(env, context.request, "google_ok");
  return signedIn(context, user);
}

// Sign-in by email (lib/email-signin.js): the code, then the session, as Google's.
async function emailStart({ request, env }, input) {
  const out = await startCode(env, request, input.email);
  if (!out.ok) return refusal(out);
  const { ok: _, ...body } = out;
  return ok(body);
}

async function emailVerify(context, input) {
  const out = await verifyCode(context.env, context.request, input.email, input.code);
  return out.ok ? signedIn(context, out.user) : refusal(out);
}

async function shown({ request, env }) {
  const sender = "ip:" + await senderHash(env, request.headers.get("CF-Connecting-IP") || "", new Date().toISOString().slice(0, 10));
  if (await perHour(env, sender, "signin-shown", 60)) await noteStep(env, request, "shown");
  return ok();
}

// A browser signed in to `user` (just verified, by Google or a code): the session, and what a new account notes.
async function signedIn({ request, env }, user) {
  // Inviting friends (lib/referrals.js): the browser is noted with the account (its own random code, one-way), and an
  // account made just now in a browser that opened a share link joins as its friend. Signing in never fails on them.
  const browser = await noteBrowser(env, request, user.id);
  // And where the browser's visits started, for an account made just now (lib/sources.js: never throws).
  if (Date.now() - Date.parse(user.created) < 60e3) {
    await noteJoin(env, request, user).catch(e => console.warn(`sign-in: share: ${e?.message || e}`));
    await noteSignup(env, request, user);
  }
  return ok({}, await startSession(env, request, user.id), browser);
}

async function logout({ request, env }) {
  return ok({}, await endSession(env, request));
}

async function profile({ env }, input, user) {
  const links = linkList(clean(input.links, 600)).join("\n");
  await env.DB.prepare("UPDATE users SET display_name = ?, links = ?, show_public = ? WHERE id = ?")
    .bind(clean(input.display_name, 60) || null, links || null, input.show_public ? 1 : 0, user.id).run();
  await forgetTranslatorCredits(env);   // the credits show the new name, or none, right away
  return ok({ links });
}

async function voice({ env }, input, user) {
  const res = await env.DB.prepare("UPDATE voices SET bio = ?, updated = ? WHERE id = ? AND owner = ?")
    .bind(clean(input.bio, 1200) || null, new Date().toISOString(), clean(input.id, 60), user.id).run();
  return res.meta.changes ? ok() : fail(404, "That isn't one of your voices.");
}

async function remove({ request, env }, input, user) {
  if (input.confirm !== "delete") return fail(400, "Type delete to confirm.");
  try { await deleteUser(env, user); }
  catch (e) {
    if (!e?.billing) throw e;
    console.warn(`account delete: ${e.message}`);
    return fail(502, "Couldn't cancel your plan with Stripe just now, so nothing was deleted. Please try again in a moment.");
  }
  return ok({}, await endSession(env, request));
}

const PUBLIC_POSTS = { google, logout, "email-start": emailStart, "email-verify": emailVerify, shown };
const USER_POSTS = { profile, voice, delete: remove };

export async function onRequest(context) {
  const { request, env, params } = context;
  const action = String(params.action);
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  await setup(env);
  if (request.method === "GET") return action === "me" ? me(context) : fail(404, "Not found.");
  if (request.method !== "POST") return fail(405, "Use POST.");
  if (!sameOrigin(request)) return fail(403, "Please use the form on this site.");
  let input;
  try {
    input = await request.json();
  } catch (e) {
    return fail(400, "Couldn't read that.");
  }
  if (PUBLIC_POSTS[action]) return PUBLIC_POSTS[action](context, input);
  if (!USER_POSTS[action]) return fail(404, "Not found.");
  const user = await currentUser(env, request);
  if (!user) return fail(401, "You're signed out. Please sign in again.");
  return USER_POSTS[action](context, input, user);
}
