// Lore Forever accounts (lib/accounts.js), used by /account, /voices/submit and /feedback. Contributors and anyone
// sending feedback need one; playing, listening and liking don't.
//   GET  /api/auth/me       {user, voices, signIn: {google: client id or null}, features: {contribute, zones, lore,
//                           companion}};
//                           user is null when signed out; user.session_expires: when this sign-in ends
//   POST /api/auth/google   {credential}: a Google ID token from the Sign in with Google button -> session cookie
//   POST /api/auth/logout   ends this session
//   POST /api/auth/profile  {display_name, links, show_public}: what /contributors shows
//   POST /api/auth/voice    {id, bio}: the bio on one of your voices' profile pages
//   POST /api/auth/delete   {confirm: "delete"}: deletes the account and everything tied to it
// Every POST must come from our own pages (Origin check) and sends JSON.

import {
  setup, currentUser, startSession, endSession, findOrCreateUser, deleteUser, verifyGoogle, fail, noStore, sameOrigin,
} from "../../../lib/accounts.js";
import { loadVoices, linkList } from "../../../lib/voices.js";
import { clean } from "../../../lib/form.js";
import { setupStudio } from "../../../lib/studio.js";
import { featureOn } from "../../../lib/features.js";
import { forgetTranslatorCredits } from "../../../lib/translations.js";

const ok = (body = {}, cookie) => {
  const headers = new Headers(noStore);
  if (cookie) headers.set("Set-Cookie", cookie);
  return Response.json({ ok: true, ...body }, { headers });
};

const signInOptions = env => ({ google: env.GOOGLE_CLIENT_ID || null });
// Site features waiting for an add-on release (lib/features.js), for links header.js adds on every page.
const features = env => ({
  contribute: featureOn(env, "contribute"), zones: featureOn(env, "zones"), lore: featureOn(env, "lore"),
  companion: featureOn(env, "companion"),
});

async function me({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return ok({ user: null, voices: [], signIn: signInOptions(env), features: features(env) });
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
    signIn: signInOptions(env),
    features: features(env),
  });
}

async function google({ request, env }, input) {
  const claims = await verifyGoogle(env, input.credential);
  if (!claims) return fail(401, "Google sign-in didn't go through. Please try again.");
  const user = await findOrCreateUser(env, { email: claims.email.toLowerCase(), googleSub: claims.sub, name: claims.name });
  return ok({}, await startSession(env, request, user.id));
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
  await deleteUser(env, user);
  return ok({}, await endSession(env, request));
}

const PUBLIC_POSTS = { google, logout };
const USER_POSTS = { profile, voice, delete: remove };

export async function onRequest(context) {
  const { request, env, params } = context;
  const action = String(params.action);
  if (!env.DB) return fail(503, "Accounts aren't set up yet.");
  await setup(env);
  if (request.method === "GET") return action === "me" ? me(context) : fail(404, "Not found.");
  if (request.method !== "POST") return fail(405, "Use POST.");
  if (!sameOrigin(request)) return fail(403, "Please use the form on loreforeverwow.com.");
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
