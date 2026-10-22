import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { deleteUser } from "../lib/accounts.js";
import { cleanScreenshot, IMAGE_MAX_BYTES, readImageUpload, IMAGE_BODY_MAX } from "../lib/friend-images.js";
import { sendMessage, MESSAGE_KEEP_DAYS, friendImageKey } from "../lib/friends.js";
import { crc32 } from "../public/voices/crc32.js";
import { createFriendImageFixture, fixturePlayer } from "./friend-image-fixture.mjs";

const chunk = (name, bytes) => {
  const kind = Buffer.from(name), out = Buffer.alloc(bytes.length + 12);
  out.writeUInt32BE(bytes.length); kind.copy(out, 4); Buffer.from(bytes).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
  return out;
};
function png({ width = 2, height = 3, metadata = true, red = 255 } = {}) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) pixels[row * (width * 3 + 1) + 1 + col * 3] = red;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    ...(metadata ? [chunk("tEXt", Buffer.from("Author\0private real name")), chunk("eXIf", Buffer.from("GPS private location"))] : []),
    chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z", "base64");
const form = (to, nonce = "confirmation_0001", bytes = png()) => {
  const body = new FormData(); body.set("to", to); body.set("nonce", nonce);
  body.set("image", new Blob([bytes], { type: "image/png" }), "ignored-local-path.png"); return body;
};
const result = async response => ({ status: response.status, body: await response.json() });

test("PNG and JPEG metadata is removed; malformed, forged, oversized and decompression-bomb images are rejected", async () => {
  const image = await cleanScreenshot(png());
  assert.deepEqual([image.width, image.height, image.type], [2, 3, "image/png"]);
  assert.deepEqual(image.bytes, new Uint8Array(png({ metadata: false })));
  const exif = Buffer.from("GPS real name private location"), segment = Buffer.alloc(exif.length + 4);
  segment[0] = 255; segment[1] = 225; segment.writeUInt16BE(exif.length + 2, 2); exif.copy(segment, 4);
  const cleanedJpeg = await cleanScreenshot(Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]));
  assert.deepEqual([cleanedJpeg.width, cleanedJpeg.height, cleanedJpeg.type], [2, 3, "image/jpeg"]);
  assert.ok(!Buffer.from(cleanedJpeg.bytes).includes(exif));
  assert.ok(!Buffer.from(cleanedJpeg.bytes).includes(Buffer.from("JFIF")));
  const brokenCrc = png(); brokenCrc[brokenCrc.length - 1] ^= 1;
  const badDimensions = Buffer.from(png()); badDimensions.writeUInt32BE(4097, 16);
  badDimensions.writeUInt32BE(crc32(badDimensions.subarray(12, 29)), 29);
  const bomb = Buffer.concat([png({ metadata: false }).subarray(0, 33), chunk("IDAT", deflateSync(Buffer.alloc(100000))), chunk("IEND", Buffer.alloc(0))]);
  for (const bytes of [Buffer.from("<svg onload='bad'>"), brokenCrc, jpeg.subarray(0, -1),
    Buffer.concat([jpeg, Buffer.from("trailing")]), png().subarray(0, -4), badDimensions, bomb]) {
    await assert.rejects(cleanScreenshot(bytes), error => error.status === 400);
  }
  await assert.rejects(cleanScreenshot(new Uint8Array(IMAGE_MAX_BYTES + 1)), error => error.status === 413);
});

test("one confirmation sends private sanitized bytes, visible only to its two mutual friends, with history and text intact", async () => {
  const { env, sender, recipient, call } = await createFriendImageFixture();
  const stranger = await fixturePlayer(env, "eve");
  assert.equal((await call(sender, "image", form(recipient.pid), { headers: { Authorization: "" } })).status, 401);
  const sent = await result(await call(sender, "image", form(recipient.pid)));
  assert.equal(sent.status, 200);
  const message = sent.body.message;
  assert.equal(message.text, "Shared a screenshot");
  assert.deepEqual(message.image, { url: `/api/friends/image?id=${message.id}`, width: 2, height: 3, type: "image/png", bytes: png({ metadata: false }).length });
  assert.ok(!JSON.stringify(message).includes("friend-images/"));
  for (const player of [sender, recipient]) {
    const response = await call(player, "image", undefined, { query: `?id=${message.id}` });
    assert.equal(response.status, 200); assert.equal(response.headers.get("Content-Type"), "image/png");
    assert.match(response.headers.get("Cache-Control"), /private.*no-store/);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png({ metadata: false }));
  }
  assert.equal((await call(stranger, "image", undefined, { query: `?id=${message.id}` })).status, 404);
  assert.equal((await call(sender, "image", form(stranger.pid, "confirmation_0002"))).status, 403);
  const list = (await result(await call(recipient, "list"))).body;
  assert.equal(list.friends[0].last.kind, "image"); assert.equal(list.unread, 1);
  const history = (await result(await call(recipient, "messages", undefined, { query: `?with=${sender.pid}` }))).body;
  assert.deepEqual(history.messages[0].image, message.image);
  assert.equal((await result(await call(sender, "send", { to: recipient.pid, text: "Still ordinary text", card: null }))).status, 200);
  assert.equal(env.STUDIO.objects.size, 1);
  assert.match([...env.STUDIO.objects.keys()][0], /^friend-images\/[0-9a-f]{64}\/[0-9a-f]{64}$/);
});

test("retries and concurrent retries deliver once, bind to recipient and image, and do not spend another message quota", async () => {
  const { env, sender, recipient, call } = await createFriendImageFixture();
  const first = await result(await call(sender, "image", form(recipient.pid)));
  for (let i = 0; i < 3; i++) {
    const again = await result(await call(sender, "image", form(recipient.pid)));
    assert.equal(again.body.message.id, first.body.message.id);
  }
  assert.equal(env.DB.sqlite.prepare("SELECT n FROM rate_limits WHERE user_id = ? AND bucket LIKE 'friends-send-day:%'").get(sender.user.id).n, 1);
  assert.equal((await call(sender, "image", form(recipient.pid, "confirmation_0001", png({ red: 0 })))).status, 409);
  const other = await fixturePlayer(env, "third");
  const now = new Date().toISOString();
  for (const [a, b] of [[sender, other], [other, sender]]) await env.DB.prepare("INSERT INTO friend_edges VALUES (?, ?, 'friends', ?, ?)").bind(a.user.id, b.user.id, now, now).run();
  assert.equal((await call(sender, "image", form(other.pid))).status, 409);
  const simultaneous = await Promise.all([1, 2, 3].map(() => call(sender, "image", form(recipient.pid, "confirmation_race"))));
  const messages = await Promise.all(simultaneous.map(result));
  assert.equal(new Set(messages.map(r => r.body.message.id)).size, 1);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM friend_messages").get().n, 2);
});

test("removed, blocked, unsent, expired and deleted-account screenshots cannot be fetched or redelivered", async () => {
  for (const action of ["remove", "block", "unsend", "expired", "delete"]) {
    const { env, sender, recipient, call } = await createFriendImageFixture();
    const message = (await result(await call(sender, "image", form(recipient.pid)))).body.message;
    if (action === "expired") env.DB.sqlite.prepare("UPDATE friend_messages SET created = ?").run(new Date(Date.now() - (MESSAGE_KEEP_DAYS + 1) * 864e5).toISOString());
    else if (action === "delete") await deleteUser(env, recipient.user);
    else assert.equal((await call(sender, action, { id: action === "unsend" ? message.id : recipient.pid })).status, 200);
    assert.equal((await call(sender, "image", undefined, { query: `?id=${message.id}` })).status, 404, action);
    assert.equal((await call(recipient, "image", undefined, { query: `?id=${message.id}` })).status, action === "delete" ? 401 : 404, action);
    if (action !== "delete") {
      // Re-friending doesn't restore a removed confirmation or its old screenshot.
      const now = new Date().toISOString();
      env.DB.sqlite.prepare("DELETE FROM friend_edges").run();
      for (const [a, b] of [[sender, recipient], [recipient, sender]]) await env.DB.prepare("INSERT INTO friend_edges VALUES (?, ?, 'friends', ?, ?)").bind(a.user.id, b.user.id, now, now).run();
      assert.equal((await call(sender, "image", form(recipient.pid))).status, 410, action);
    }
  }
});

test("deleting either account removes screenshot bytes, including a previously unsent screenshot", async () => {
  for (const side of ["sender", "recipient"]) {
    const fixture = await createFriendImageFixture(), { env, sender, recipient, call } = fixture;
    const removed = (await result(await call(sender, "image", form(recipient.pid)))).body.message;
    assert.equal((await call(sender, "unsend", { id: removed.id })).status, 200);
    assert.equal((await call(sender, "image", form(recipient.pid, "confirmation_active"))).status, 200);
    assert.equal(env.STUDIO.objects.size, 2);
    await deleteUser(env, fixture[side].user);
    assert.equal(env.STUDIO.objects.size, 0, side);
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM friend_image_sends").get().n, 0);
  }
});

test("account deletion keeps screenshot receipts when storage fails, so retry can finish deleting their files", async () => {
  const { env, sender, recipient, call } = await createFriendImageFixture();
  await call(sender, "image", form(recipient.pid));
  const remove = env.STUDIO.delete.bind(env.STUDIO);
  env.STUDIO.delete = async () => { throw new Error("R2 deletion temporarily unavailable"); };
  await assert.rejects(deleteUser(env, sender.user), /temporarily unavailable/);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM friend_image_sends").get().n, 1);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(sender.user.id).n, 1);
  env.STUDIO.delete = remove;
  await deleteUser(env, sender.user);
  assert.equal(env.STUDIO.objects.size, 0);
});

test("account screenshot cleanup spans bounded batches and preserves unrelated files", async () => {
  const { env, sender, recipient } = await createFriendImageFixture();
  for (let i = 0; i < 103; i++) {
    const nonce = `removed_screenshot_${i}`, digest = "0".repeat(64);
    await env.DB.prepare("INSERT INTO friend_image_sends (sender, nonce, recipient, digest, created) VALUES (?, ?, ?, ?, ?)")
      .bind(sender.user.id, nonce, recipient.user.id, digest, new Date().toISOString()).run();
    await env.STUDIO.put(await friendImageKey(sender.user.id, nonce, recipient.user.id, digest), new Uint8Array([1]));
  }
  await env.STUDIO.put("friend-images/unrelated", new Uint8Array([2]));
  const batches = [], remove = env.STUDIO.delete.bind(env.STUDIO);
  env.STUDIO.delete = async keys => { batches.push(keys.length); await remove(keys); };
  await deleteUser(env, sender.user);
  assert.deepEqual(batches, [100, 3]);
  assert.deepEqual([...env.STUDIO.objects.keys()], ["friend-images/unrelated"]);
});

test("removal while the file uploads cannot recreate a conversation; failed storage can safely retry", async () => {
  const { env, sender, recipient, call } = await createFriendImageFixture();
  const put = env.STUDIO.put.bind(env.STUDIO);
  env.STUDIO.put = async (...args) => { await put(...args); await call(sender, "remove", { id: recipient.pid }); };
  assert.equal((await call(sender, "image", form(recipient.pid))).status, 410);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM friend_messages").get().n, 0);
  const fixture = await createFriendImageFixture();
  const realPut = fixture.env.STUDIO.put;
  fixture.env.STUDIO.put = async () => { throw new Error("R2 temporarily unavailable"); };
  await assert.rejects(fixture.call(fixture.sender, "image", form(fixture.recipient.pid)), /temporarily unavailable/);
  fixture.env.STUDIO.put = realPut;
  assert.equal((await fixture.call(fixture.sender, "image", form(fixture.recipient.pid))).status, 200);
});

test("a removal during R2 retrieval is checked before returning private bytes", async () => {
  const { env, sender, recipient, call } = await createFriendImageFixture();
  const message = (await result(await call(sender, "image", form(recipient.pid)))).body.message;
  const get = env.STUDIO.get.bind(env.STUDIO);
  env.STUDIO.get = async (...args) => { const object = await get(...args); await call(sender, "remove", { id: recipient.pid }); return object; };
  assert.equal((await call(recipient, "image", undefined, { query: `?id=${message.id}` })).status, 404);
});

test("screenshots obey the same free message quota as text and reject card-shaped or arbitrary URL uploads", async () => {
  const { env, sender, recipient, call } = await createFriendImageFixture();
  env.SITE_FEATURES = "plans";
  const first = (await result(await call(sender, "image", form(recipient.pid)))).body.message;
  for (let i = 0; i < 9; i++) assert.equal((await call(sender, "send", { to: recipient.pid, text: "hi" })).status, 200);
  assert.equal((await call(sender, "image", form(recipient.pid, "confirmation_over"))).status, 429);
  assert.equal((await result(await call(sender, "image", form(recipient.pid)))).body.message.id, first.id);
  assert.equal((await call(sender, "send", { to: recipient.pid, text: "hi", card: { kind: "quest", title: "old" } })).status, 400);
  await assert.rejects(sendMessage(env, sender.user.id, recipient.pid, "hi", Date.now(), { kind: "quest", title: "old" }), /Cards can no longer/);
  assert.equal((await call(sender, "image", { to: recipient.pid, nonce: "confirmation_fake", image: "https://example.com/private.png" })).status, 400);
  const wrong = form(recipient.pid); wrong.set("image", "/etc/passwd");
  assert.equal((await call(sender, "image", wrong)).status, 400);
  const duplicate = form(recipient.pid); duplicate.append("nonce", "confirmation_duplicate");
  assert.equal((await call(sender, "image", duplicate)).status, 400);
});

test("multipart size is enforced while streaming, including requests with no or deceptive Content-Length", async () => {
  let pulls = 0, canceled = false;
  const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { canceled = true; } });
  const request = new Request("https://preview.example/api/friends/image", { method: "POST", body: stream, duplex: "half",
    headers: { "Content-Type": "multipart/form-data; boundary=test", "Content-Length": "1" } });
  await assert.rejects(readImageUpload(request), error => error.status === 413);
  assert.equal(canceled, true); assert.ok(pulls <= Math.ceil(IMAGE_BODY_MAX / (1024 * 1024)) + 1);
});


test("account deletion purges an uploaded orphan when the message transaction failed", async () => {
  const { env, sender, recipient, call } = await createFriendImageFixture();
  const batch = env.DB.batch;
  env.DB.batch = async () => { throw new Error("transaction failed after upload"); };
  await assert.rejects(call(sender, "image", form(recipient.pid)), /transaction failed/);
  assert.equal(env.STUDIO.objects.size, 1);
  env.DB.batch = batch;
  await deleteUser(env, sender.user);
  assert.equal(env.STUDIO.objects.size, 0);
});
