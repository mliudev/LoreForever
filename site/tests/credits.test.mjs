// Crediting contributors (LOR-239): /contributors, /api/credits, the old /voices/contributors address, the badges on
// /u/<handle> and the site flag for unreleased features. D1 is node:sqlite (helpers.mjs). contrib_lines is the text
// intake's (lib/contribute.js, LOR-235): rows here are made in its own tables, set to each status, and one test sends
// lines through the real POST /api/contribute and checks /contributors against /api/contribute/contributors.
// Run: node --test site/tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setup, findOrCreateUser, startSession } from "../lib/accounts.js";
import { setup as setupContrib } from "../lib/contribute.js";
import { textFinders, releaseCredits, translatorList, contributionBadges } from "../lib/credits.js";
import { translatorCredits } from "../lib/translations.js";

import { onRequestGet as contributorsGet } from "../functions/contributors.js";

import { onRequestPost as contributePost } from "../functions/api/contribute.js";
import { onRequestGet as contributeGet } from "../functions/api/contribute/[action].js";
import { d1, assets } from "./helpers.mjs";

const ORIGIN = "https://preview.example";
const NOW = Date.now();   // the pages use the clock, so line ages are from now
const S = Math.floor(NOW / 1000);
const HOUR = 3600;

const env = { DB: d1() };
let users = {};
let lineNo = 0;

async function user(sub, name, show = 1) {
  const u = await findOrCreateUser(env, { email: `${sub}@example.com`, googleSub: sub, name });
  await env.DB.prepare("UPDATE users SET show_public = ?, links = ? WHERE id = ?").bind(show, `https://twitch.tv/${sub}`, u.id).run();
  return u;
}

// A line in lib/contribute.js's contrib_lines, found first by an account or a nickname.
async function line(status, { user: u = null, nick = null, age = 100 * HOUR, shipped = null, flagged = 0 } = {}) {
  lineNo += 1;
  const ref = String(90000 + lineNo);
  await env.DB.prepare(
    "INSERT INTO contrib_lines (kind, ref_id, part, locale, build, text, text_hash, status, uploads, uploaders, " +
    "found_by_user, found_by_nick, first_seen, updated_at, shipped_in, lkey, flagged) " +
    "VALUES ('quest', ?, 'detail', 'enUS', '1.60.1', ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(ref, `Text ${lineNo}`, `h${lineNo}`, status, u ? u.id : null, nick, S - age, S - age, shipped,
         `quest|${ref}|detail|enUS`, flagged).run();
}

async function edit(u, locale, stringId, status) {
  await env.DB.prepare(
    "INSERT INTO translation_edits (user_id, locale, string_id, en, text, created, updated, status) VALUES (?, ?, ?, 'en', 'tx', ?, ?, ?)"
  ).bind(u.id, locale, stringId, `2026-10-0${1 + (lineNo++ % 3)}T00:00:00Z`, "2026-10-03T00:00:00Z", status).run();
}

beforeEach(async () => {
  await setup(env);
  await setupContrib(env);
  for (const t of ["users", "sessions", "translation_edits", "profiles", "voices", "rate_limits", "contrib_lines",
                   "contrib_uploads", "contrib_batches"]) env.DB.sqlite.exec(`DELETE FROM ${t}`);
  delete env.SITE_FEATURES;
  lineNo = 0;
  users = {
    alice: await user("alice", "Alice"),
    bob: await user("bob", "Bob", 0),          // ticked off "Show my name": never listed
    zara: await user("zara", "zara"),
  };
  env.ASSETS = assets({
    "/voices/voices.json": { voices: [
      { id: "male-narrator", name: "Lore Forever male narrator", credit: "Lore Forever", clips: 817, language: "English", included: true },
      { id: "alices-voice", name: "Alice's voice", credit: "Alice", owner: users.alice.id, clips: 120, language: "English", download: "x" },
    ] },
    "/translate/languages.json": { languages: [{ locale: "deDE", name: "Deutsch", englishName: "German" }] },
    "/contribute/known.json": { v: 1, lines: {} },
  });
  // Alice owns the voice in D1 too (lib/voices.js publicVoices checks the owner).
  await env.DB.prepare("INSERT INTO voices (id, owner, name, status, created, updated) VALUES ('alices-voice', ?, 'Alice''s voice', 'pending', 'x', 'x')")
    .bind(users.alice.id).run();
});

async function withLines() {
  const { alice, bob, zara } = users;
  await line("verified", { user: alice });
  await line("verified", { user: alice });
  await line("shipped", { user: alice, shipped: "0.8.0" });
  await line("single", { user: alice, age: 50 * HOUR });      // one player, past 48 hours, no flag: accepted
  await line("single", { user: alice, age: 2 * HOUR });       // too new
  await line("single", { user: alice, age: 50 * HOUR, flagged: 1 });   // old enough, but flagged
  await line("flagged", { user: alice });
  await line("rejected", { user: alice });
  await line("conflict", { user: alice });
  await line("verified", { nick: "Mossy" });                  // no account: the nickname typed on the upload
  await line("shipped", { nick: " mossy ", shipped: "0.8.0", age: 60 * HOUR });   // the same nickname, any case
  for (let i = 0; i < 10; i++) await line("verified", { user: zara });   // most lines, still listed last (alphabetical)
  for (let i = 0; i < 5; i++) await line("verified", { user: bob, nick: "Bobby" });   // hidden account: not even the nick
  await line("shipped", { shipped: "0.8.0" });                // anonymous: counted, never named
  await line("shipped", { shipped: "0.8.0" });
  await line("verified", { user: { id: "deleted-account" }, nick: "Ghost" });   // the account is gone
  await line("shipped", { nick: "@everyone <b>", shipped: "0.7.0" });
}

test("/contributors's text finders are /api/contribute/contributors, through the real upload", async () => {
  const { alice, bob } = users;
  const send = async (body, { ip, cookie } = {}) => {
    const h = new Headers({ "Content-Type": "application/json", "CF-Connecting-IP": ip, Origin: ORIGIN });
    if (cookie) h.set("Cookie", cookie);
    const waits = [];
    const res = await contributePost({ request: new Request(`${ORIGIN}/api/contribute`, { method: "POST", headers: h, body: JSON.stringify(body) }),
      env, waitUntil: p => waits.push(p) });
    await Promise.all(waits);
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  };
  const quest = (id, text) => ({ kind: "quest", ref_id: String(id), part: "detail", locale: "enUS", build: "1.60.1.70205", text });
  const cookieOf = async u => (await startSession(env, new Request(ORIGIN), u.id)).split(";")[0];
  await send({ source: "file", lines: [quest(501, "Alice found this."), quest(502, "And this.")] }, { ip: "203.0.113.1", cookie: await cookieOf(alice) });
  await send({ source: "file", lines: [quest(503, "Hidden Bob found this.")] }, { ip: "203.0.113.2", cookie: await cookieOf(bob) });
  await send({ source: "file", nick: "Wanderer", lines: [quest(504, "A nickname found this.")] }, { ip: "203.0.113.3" });
  await send({ source: "file", lines: [quest(505, "Nobody's name on this.")] }, { ip: "203.0.113.4" });
  await send({ source: "code", nick: "Late", lines: [quest(506, "Too new to count.")] }, { ip: "203.0.113.5" });
  env.DB.sqlite.exec(`UPDATE contrib_lines SET first_seen = first_seen - ${49 * HOUR} WHERE ref_id <> '506'`);

  const api = await contributeGet({ request: new Request(`${ORIGIN}/api/contribute/contributors`), env, params: { action: "contributors" } });
  const theirs = (await api.json()).map(p => [p.name, p.lines_accepted]);
  const ours = (await textFinders(env)).map(p => [p.name, p.lines]);
  assert.deepEqual(theirs, [["Alice", 2], ["Wanderer", 1]]);
  assert.deepEqual(ours, theirs, "the same people and counts as the intake's own list");
  assert.deepEqual((await contributionBadges(env, new Request(ORIGIN), alice.id)).map(b => b.label).slice(-1), ["Contributed 2 lines"]);

  // Shipped in a release: the credit line counts every line, anonymous ones too, and names the shown finders.
  env.DB.sqlite.exec("UPDATE contrib_lines SET status = 'shipped', shipped_in = '0.9.0' WHERE ref_id IN ('501', '503', '504', '505')");
  assert.deepEqual(await releaseCredits(env, "0.9.0"), { ok: true, release: "0.9.0", lines: 4, names: ["Alice", "Wanderer"] });
  assert.deepEqual((await textFinders(env)).map(p => [p.name, p.lines]), [["Alice", 2], ["Wanderer", 1]], "shipped lines still count");
});

test("translators: every saved edit but rejected ones, public names only, each string once, alphabetical", async () => {
  const { alice, bob, zara } = users;
  await edit(alice, "deDE", "ui:1", "pulled");
  await edit(alice, "deDE", "ui:1", "accepted");   // the same string again
  await edit(alice, "deDE", "ui:2", "accepted");
  await edit(alice, "frFR", "ui:9", "pulled");
  await edit(alice, "deDE", "ui:3", "rejected");   // spam: never counts
  await edit(alice, "deDE", "ui:4", "new");        // saved, waiting for the next pull: counts (no approval step)
  await edit(bob, "deDE", "ui:1", "pulled");        // hidden
  for (let i = 0; i < 9; i++) await edit(zara, "esES", `z:${i}`, "new");   // nothing pulled yet: still credited
  const list = await translatorList(env);
  assert.deepEqual(list.map(p => [p.name, p.strings, p.languages.map(l => `${l.locale}:${l.strings}`)]),
    [["Alice", 4, ["deDE:3", "frFR:1"]], ["zara", 9, ["esES:9"]]]);
  // /translate's cards: the same people, in the order they started, not by count.
  const credits = await translatorCredits(env);
  assert.deepEqual(credits.deDE, ["Alice"]);
  assert.deepEqual(credits.esES, ["zara"]);
  assert.ok(!credits.deDE.includes("Bob"));
  // Their profile badge counts the same strings.
  const request = new Request(`${ORIGIN}/u/zara`);
  assert.deepEqual((await contributionBadges(env, request, zara.id, NOW)).filter(b => b.kind === "translator").map(b => b.title),
    ["Translated 9 strings of Lore Forever"]);
});

test("/contributors: narrators, translators and text finders; hidden people never show", async () => {
  await withLines();
  await edit(users.alice, "deDE", "ui:1", "pulled");
  await edit(users.bob, "deDE", "ui:2", "pulled");
  const res = await contributorsGet({ request: new Request(`${ORIGIN}/contributors`), env });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<title>Contributors - Lore Forever<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/loreforeverwow.com\/contributors">/);
  for (const id of ["narrators", "translators", "finders"]) assert.match(html, new RegExp(`<section class="vp-section" id="${id}"`), id);
  assert.match(html, /id="c-alice"/, "a narrator keeps the anchor voice pages link to");
  assert.match(html, /<a href="\/voices\/alices-voice">Alice&#39;s voice<\/a>\s*<span class="ct-n">120 narrations<\/span>/);
  assert.match(html, /<strong class="ct-name">Alice<\/strong> <span class="ct-what">German, 1 string<\/span>/);
  assert.match(html, /<strong class="ct-name">zara<\/strong> <span class="ct-what">10 lines<\/span>/);
  assert.match(html, /@everyone &lt;b&gt;/, "names are escaped");
  assert.ok(html.indexOf(">Alice</strong> <span class=\"ct-what\">4 lines") < html.indexOf(">zara</strong>"), "alphabetical");
  for (const hidden of ["Bob", "Ghost", "Real Name"]) assert.ok(!html.includes(hidden), hidden);
  assert.ok(!/\brank|#1\b|top contributor/i.test(html), "never a rank");
  assert.ok(!html.includes('href="/contribute"'), "no link to the text intake while it's unreleased");
});
