// Local-only UI fixture: the real Friends API, sqlite D1 and in-memory R2, with invented players.
// Run: node site/tests/friend-image-fixture.mjs. One JSON line announces its loopback URL and device credentials.
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { onRequest } from "../functions/api/friends/[action].js";
import { onRequest as answerRequest } from "../functions/api/companion/answer.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { person } from "../lib/friends.js";
import { d1, r2 } from "./helpers.mjs";

export async function fixturePlayer(env, handle) {
  const user = await findOrCreateUser(env, { email: `${handle}@example.com`, googleSub: handle, name: handle });
  const now = new Date().toISOString(), name = handle[0].toUpperCase() + handle.slice(1);
  await env.DB.prepare("INSERT INTO profiles (user_id, handle, public, data, created, updated) VALUES (?, ?, 0, ?, ?, ?)")
    .bind(user.id, handle, JSON.stringify({ v: 1, name, level: 24 }), now, now).run();
  const link = await startLink(env);
  await decideLink(env, link.user_code, user, true);
  const { token } = await claimToken(env, link.device_code);
  return { user, token, pid: (await person(env, user.id)).pid };
}

export async function createFriendImageFixture() {
  const env = { DB: d1(), STUDIO: r2(), GEMINI_API_KEY: "local-fixture-only" };
  await setup(env);
  const sender = await fixturePlayer(env, "sam"), recipient = await fixturePlayer(env, "ana");
  const now = new Date().toISOString();
  for (const [a, b] of [[sender, recipient], [recipient, sender]]) {
    await env.DB.prepare("INSERT INTO friend_edges (user_id, other_id, state, created, updated) VALUES (?, ?, 'friends', ?, ?)")
      .bind(a.user.id, b.user.id, now, now).run();
  }
  const call = async (player, action, body, { query = "", headers = {}, method = body === undefined ? "GET" : "POST" } = {}) => {
    const requestHeaders = new Headers({ "X-LF-Client": "companion/0.1.0", Authorization: `Bearer ${player.token}`, ...headers });
    let data = body;
    if (body !== undefined && !(body instanceof FormData) && !(body instanceof Uint8Array)) {
      requestHeaders.set("Content-Type", "application/json"); data = JSON.stringify(body);
    }
    return onRequest({ env, params: { action }, request: new Request(`https://preview.example/api/friends/${action}${query}`,
      { method, headers: requestHeaders, body: data }) });
  };
  return { env, sender, recipient, call };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  globalThis.fetch = async () => { throw new Error("External requests are disabled in the local screenshot fixture"); };
  const fixture = await createFriendImageFixture();
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, "http://localhost").pathname;
      const action = path.match(/^\/api\/friends\/([a-z]+)$/)?.[1];
      if (!action && path !== "/api/companion/answer") { response.writeHead(404); response.end(); return; }
      const webRequest = new Request(`http://127.0.0.1${request.url}`, { method: request.method, headers: request.headers,
        ...(request.method !== "GET" && request.method !== "HEAD" ? { body: Readable.toWeb(request), duplex: "half" } : {}) });
      const context = { env: fixture.env, params: { action }, request: webRequest, waitUntil() {} };
      const result = action ? await onRequest(context) : await answerRequest(context);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) { console.error(error); response.writeHead(500); response.end("Fixture error"); }
  });
  server.listen(0, "127.0.0.1", () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`,
    senderToken: fixture.sender.token, recipientToken: fixture.recipient.token,
    senderPid: fixture.sender.pid, recipientPid: fixture.recipient.pid })));
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
}
