// A note from Patrick to a player who cancelled (lib/winback.js, POST /api/admin/retention "write"): sent by the site
// from patrick@loreforeverwow.com with replies to him, once per cancelled plan, never to an address that unsubscribed, a
// comped or team account, or a player who took the cancellation back, and the address never comes back to /admin.
// Cloudflare's email API is mocked through fetch; D1 is node:sqlite (helpers.mjs).
// Run: node --test 'site/tests/*.test.mjs'

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { onRequestGet as getRetention, onRequestPost as postRetention } from "../functions/api/admin/retention.js";
import { setup, findOrCreateUser, deleteUser } from "../lib/accounts.js";
import { setupBilling } from "../lib/billing.js";
import { optOut, sendEmail } from "../lib/email.js";
import { setupWinback, noteEmail, TEMPLATE } from "../lib/winback.js";

import { d1 } from "./helpers.mjs";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const env = { DB: d1(), ADMIN_KEY: "admin-key", CLOUDFLARE_EMAIL_TOKEN: "cf-token", CLOUDFLARE_ACCOUNT_ID: "acct1" };
const originalFetch = globalThis.fetch;
let sent, down;

beforeEach(async () => {
  await setup(env);
  await setupBilling(env);
  await setupWinback(env);
  for (const table of ["users", "plan_log", "plan_cancellations", "winback_notes", "email_sends", "email_optouts", "excluded_accounts"])
    env.DB.sqlite.exec(`DELETE FROM ${table}`);
  sent = [];
  down = false;
  globalThis.fetch = async (url, o = {}) => {
    const u = new URL(url);
    if (u.hostname === "api.cloudflare.com") {
      if (down) return Response.json({ success: false, errors: [{ code: 1, message: "busy" }] }, { status: 500 });
      sent.push(JSON.parse(o.body));
      return Response.json({ success: true, result: { queued: ["x"] } });
    }
    if (u.pathname === "/v1/subscriptions") return Response.json({ data: [] });   // Delete my account's check
    return Response.json({ data: [] });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

const iso = ms => new Date(ms).toISOString();
async function cancelled(name, { kind = "scheduled", counted = 1, sub = `sub_${name}` } = {}) {
  const user = await findOrCreateUser(env, { email: `${name}@example.com`, googleSub: name,
    name: `${name[0].toUpperCase()}${name.slice(1)} Stormwind` });
  env.DB.sqlite.prepare("INSERT INTO plan_log (subscription_id, user_id, plan, status, started, canceled, discounts, comp, updated) " +
    "VALUES (?, ?, 'hero', 'active', ?, ?, '[]', '', ?)").run(sub, user.id, iso(NOW - 10 * 864e5), iso(NOW - 864e5), iso(NOW));
  env.DB.sqlite.prepare("INSERT INTO plan_cancellations (id, subscription_id, user_id, plan, kind, at, days, paid_cents, " +
    "reason, feedback, counted, created) VALUES (?, ?, ?, 'hero', ?, ?, 9, 250, 'cancellation_requested', 'too_expensive', ?, ?)")
    .run(`evt_${name}_${kind}`, sub, user.id, kind, iso(NOW - 864e5), counted, iso(NOW));
  return user;
}
const key = { Authorization: "Bearer admin-key" };
const write = (id, body = {}, headers = key) => postRetention({ env, request: new Request("https://x.example/api/admin/retention",
  { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "write", id, subject: TEMPLATE.subject, text: TEMPLATE.text, ...body }) }) });
const report = async () => (await (await getRetention({ env, request: new Request("https://x.example/api/admin/retention",
  { headers: key }) })).json());

test("a note goes once, from Patrick with replies to him, and /admin never sees the address", async () => {
  await cancelled("varian");
  let r = await report();
  assert.deepEqual(r.cancellations.map(c => [c.id, c.note, c.written]), [["evt_varian_scheduled", "yes", null]]);
  assert.equal(JSON.stringify(r).includes("example.com"), false, "no address in the report");
  assert.equal((await write("evt_varian_scheduled", {}, {})).status, 401, "needs the admin key");
  const res = await write("evt_varian_scheduled");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true, status: "sent" }, "nothing about who comes back");
  assert.equal(sent.length, 1);
  const [mail] = sent;
  assert.deepEqual([mail.from, mail.reply_to, mail.to, mail.subject],
    [{ address: "patrick@loreforeverwow.com", name: "Patrick from Lore Forever" }, "patrick@loreforeverwow.com",
     ["varian@example.com"], "Quick question about your Willo plan"]);
  assert.match(mail.text, /^Hey Varian,\n\nI'm Patrick/);
  assert.match(mail.text, /--\nYou're getting this because you cancelled a Willo plan on loreforeverwow\.com\. Reply to reach Patrick\. Don't want email from us\? https:\/\/loreforeverwow\.com\/unsubscribe\n$/);
  assert.equal(mail.headers["List-Unsubscribe"], "<https://loreforeverwow.com/unsubscribe>");
  // Logged with what it said, never the address.
  const note = env.DB.sqlite.prepare("SELECT * FROM winback_notes").get();
  assert.deepEqual([note.subscription_id, note.cancellation_id, note.status, note.subject], ["sub_varian", "evt_varian_scheduled", "sent", TEMPLATE.subject]);
  assert.equal(JSON.stringify(note).includes("@example"), false);
  r = await report();
  assert.deepEqual([r.cancellations[0].note, r.cancellations[0].written.status], ["written", "sent"]);
  // A second note about the same cancellation, or its end, is refused.
  const again = await write("evt_varian_scheduled");
  assert.deepEqual([again.status, (await again.json()).error], [400, "That player already got a note about this cancellation."]);
  assert.equal(sent.length, 1);
});

test("never to an unsubscribed address, a comped or team account, a cancellation taken back, or a deleted account", async () => {
  await cancelled("jaina");
  await optOut(env, "Jaina@example.com");
  await cancelled("mike", { counted: 0 });
  await cancelled("anduin");
  env.DB.sqlite.prepare("INSERT INTO plan_cancellations (id, subscription_id, plan, kind, at, counted, created) " +
    "VALUES ('evt_anduin_undone', 'sub_anduin', 'hero', 'undone', ?, 1, ?)").run(iso(NOW), iso(NOW));
  const gone = await cancelled("garrosh");
  await deleteUser(env, gone);
  const states = Object.fromEntries((await report()).cancellations.map(c => [c.id, c.note]));
  // Comped and team accounts aren't in /admin's list at all (lib/retention.js), and are refused below too.
  assert.deepEqual(states, { evt_jaina_scheduled: "opted out", evt_anduin_scheduled: "taken back",
    evt_anduin_undone: "not this one", evt_garrosh_scheduled: "no account" });
  for (const [id, error] of [["evt_jaina_scheduled", "They unsubscribed from our email."],
                             ["evt_mike_scheduled", "That's a comped or team account."],
                             ["evt_anduin_scheduled", "They took the cancellation back, so there's nothing to ask."],
                             ["evt_garrosh_scheduled", "Their account is gone, so there's no one to write to."],
                             ["evt_nobody", "No such cancellation."]]) {
    const res = await write(id);
    assert.deepEqual([res.status, (await res.json()).error], [400, error], id);
  }
  assert.equal(sent.length, 0);
});

test("a failed send can be tried again; an empty note is refused; the text is plain", async () => {
  await cancelled("thrall");
  down = true;
  const failed = await write("evt_thrall_scheduled");
  assert.deepEqual([failed.status, (await failed.json()).error], [400, "The email service didn't take it. Try again in a minute."]);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM winback_notes").get().n, 0);
  down = false;
  assert.equal((await write("evt_thrall_scheduled", { subject: " ", text: "" })).status, 400);
  const ok = await write("evt_thrall_scheduled", { subject: "Hi\nthere", text: "Hey {name}\u0007, why?" });
  assert.equal((await ok.json()).status, "sent");
  assert.equal(sent[0].subject, "Hi there");
  assert.match(sent[0].text, /^Hey Thrall, why\?/);
  // No first name: "Hey," with no gap.
  assert.match(noteEmail({ subject: "s", text: TEMPLATE.text, name: "" }).text, /^Hey,\n/);
});

test("a message's own sender is used only when it's one of our addresses (the domain's DMARC rejects any other)", async () => {
  await sendEmail(env, { to: "a@example.com", subject: "s", text: "t", from: "Someone <someone@gmail.com>", replyTo: "x@gmail.com" });
  await sendEmail(env, { to: "a@example.com", subject: "s", text: "t", from: "Patrick <patrick@loreforeverwow.com>",
    replyTo: "Patrick@LoreForeverWow.com" });
  assert.deepEqual(sent.map(m => [m.from, m.reply_to]), [
    [{ address: "hello@loreforeverwow.com", name: "Mike from Lore Forever" }, "hello@loreforeverwow.com"],
    [{ address: "patrick@loreforeverwow.com", name: "Patrick" }, "patrick@loreforeverwow.com"]]);
});

