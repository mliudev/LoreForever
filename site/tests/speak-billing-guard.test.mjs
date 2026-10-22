// What Willo's hosted voice counts and charges, step by step, held to a recording (LOR-673): the speak path's database
// round trips were batched, and the PM's bar was that billing stays identical: the same counts, caps and plan checks.
// One scripted run across the plans and paths (Hero's finest voice, a finest-voice pack after it, Legend's richer voice and
// after, Champion, the free plan's studio voice and the old spoken starter's end, a new player's best first and the day's
// cap on it, a provider down, the month's cap, a reply past 600 letters, a piece asked again, Willo's own lines, a reply
// the app gave up on), each step's answer and the billing tables after it, compared with
// site/tests/fixtures/speak-billing-guard.json.
//
// A change that should change billing records it again: RECORD=1 node --test site/tests/speak-billing-guard.test.mjs,
// then read the diff of the fixture before committing it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

import { onRequest as speakApi } from "../functions/api/companion/speak.js";
import { findOrCreateUser, setup } from "../lib/accounts.js";
import { startLink, decideLink, claimToken } from "../lib/devices.js";
import { setupBilling, planFor, poolWindow, LEGEND_BEST_PER_MONTH, STARTER_ANSWERS, STARTER, PLANS, PLAN_VOICE }
  from "../lib/billing.js";
import { d1, assets } from "./helpers.mjs";

const FIXTURE = new URL("./fixtures/speak-billing-guard.json", import.meta.url);
const NOW = Date.parse("2026-10-11T12:00:00Z");
const HOSTED = JSON.parse(readFileSync(new URL("../public/lore/data/respell-hosted.json", import.meta.url), "utf8"));
const MP3 = Buffer.from("ID3\x04\x00\x00fake-mp3-frames", "latin1");

test("the hosted voice counts and charges exactly as recorded, step by step", async (t) => {
  // Recorded with a free starter credited (no new ones since 10/21; one already credited is still used).
  STARTER.credited = true;
  t.after(() => { STARTER.credited = false; });
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const env = { DB: d1(), GEMINI_API_KEY: "test-key", SITE_FEATURES: "plans", DEEPINFRA_API_KEY: "di-test",
                INWORLD_API_KEY: "iw-test", ASSETS: assets({ "/lore/data/respell-hosted.json": HOSTED }),
                HOSTED_VOICES: JSON.stringify({ willo: { deepinfra: "willo-studio", inworld: "willo-finest" } }),
                UNHEARD_SETTLE_MS: "0" };
  await setup(env);
  await setupBilling(env);
  const failing = new Set();
  let said = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const host = new URL(url).hostname;
    const provider = host === "api.inworld.ai" ? "inworld" : host === "api.deepinfra.com" ? "deepinfra" : null;
    if (!provider) throw new Error(`unexpected fetch ${url}`);
    said.push(provider);
    if (failing.has(provider)) return new Response("overloaded", { status: 503 });
    if (provider === "deepinfra") return Response.json({ audio: "data:audio/mpeg;base64," + MP3.toString("base64") });
    return new Response(JSON.stringify({ result: { audioContent: MP3.toString("base64") } }) + "\n");
  };
  try {
    const sql = env.DB.sqlite;
    const players = {};
    async function player(name, plan) {
      const user = await findOrCreateUser(env, { email: `${name}@example.com`, googleSub: name, name });
      const link = await startLink(env);
      assert.equal(await decideLink(env, link.user_code, user, true), true);
      const { token } = await claimToken(env, link.device_code);
      if (plan) sql.prepare("INSERT INTO entitlements (user_id, subscription_id, plan, status, current_period_end, updated) " +
        "VALUES (?, ?, ?, 'active', ?, ?)").run(user.id, `sub-${name}`, plan, new Date(NOW + 20 * 864e5).toISOString(),
        new Date(NOW).toISOString());
      players[user.id] = name;
      return { user, name };
    }
    const steps = [];
    async function step(label, who, body) {
      said = [];
      const headers = { "X-LF-Client": "companion/0.1.0", "Content-Type": "application/json",
        Authorization: `Bearer ${who.token}` };
      const res = await speakApi({ env, request: new Request("https://example.test/api/companion/speak",
        { method: "POST", headers, body: JSON.stringify({ voice: "willo", ...body }) }) });
      const type = res.headers.get("Content-Type") || "";
      const out = type.startsWith("audio/") ? "audio" : res.status === 204 ? null : (await res.json()).reason ?? null;
      steps.push({ label, status: res.status, voice: res.headers.get("X-LF-Voice"), out, providers: said, tables: tables() });
    }
    // The billing tables, by player name (ids are random), without times or random ids.
    const who = id => players[id] ?? id;
    const rows = (q, ...a) => sql.prepare(q).all(...a).map(r => ({ ...r }));
    function tables() {
      return {
        // The replies the steps made, and every player's count of them by period (the pre-filled ones in it).
        voice_replies: rows("SELECT user_id, reply, period, chars, pieces, heard, best, npc, pack, provider, bits " +
          "FROM voice_replies WHERE reply NOT LIKE 'earlier-%' AND reply NOT LIKE 'starter-%'")
          .map(r => ({ ...r, user_id: who(r.user_id) }))
          .sort((a, b) => `${a.user_id}|${a.reply}`.localeCompare(`${b.user_id}|${b.reply}`)),
        voice_reply_counts: rows("SELECT user_id, period, COUNT(*) AS n, SUM(best) AS best, SUM(npc) AS npc FROM " +
          "voice_replies GROUP BY user_id, period").map(r => ({ ...r, user_id: who(r.user_id) }))
          .sort((a, b) => `${a.user_id}|${a.period}`.localeCompare(`${b.user_id}|${b.period}`)),
        answer_packs: rows("SELECT id, user_id, kind, answers, remaining, spent_micro, status FROM answer_packs")
          .map(r => ({ ...r, id: r.id.replace(r.user_id, who(r.user_id)), user_id: who(r.user_id) }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        answer_user_spend: rows("SELECT user_id, month, micro, calls, voice_micro, launch_micro, topup_micro " +
          "FROM answer_user_spend").map(r => ({ ...r, user_id: who(r.user_id) })).sort((a, b) => a.user_id.localeCompare(b.user_id)),
        answer_holds: rows("SELECT user_id, COUNT(*) AS n, SUM(micro) AS micro FROM answer_holds GROUP BY user_id")
          .map(r => ({ ...r, user_id: who(r.user_id) })).sort((a, b) => a.user_id.localeCompare(b.user_id)),
        answer_spend: rows("SELECT month, reserved_micro, actual_micro, calls FROM answer_spend ORDER BY month"),
        best_first: rows("SELECT user_id, used, voices FROM best_first").map(r => ({ ...r, user_id: who(r.user_id) }))
          .sort((a, b) => String(a.user_id).localeCompare(String(b.user_id))),
        best_first_days: rows("SELECT day, reserved_micro, spent_micro, replies, lines, capped, unreachable FROM best_first_days"),
      };
    }
    const token = async (p) => {
      const link = await startLink(env);
      await decideLink(env, link.user_code, p.user, true);
      return (await claimToken(env, link.device_code)).token;
    };
    const hero = await player("hero", "hero"), packed = await player("packed", "hero"),
      legend = await player("legend", "legend"), champion = await player("champion", "champion"),
      free = await player("free"), spentFree = await player("spentfree"), taste = await player("taste"),
      capped = await player("capped", "legend");
    for (const p of [hero, packed, legend, champion, free, spentFree, taste, capped]) p.token = await token(p);

    // Hero: a reply in two numbered pieces, its second asked again; an older companion's reply, unnumbered.
    await step("hero first piece", hero, { text: "Thrall leads the Horde.", reply: "hero-reply-1", piece: 0 });
    await step("hero next piece", hero, { text: "From Orgrimmar, in Durotar.", reply: "hero-reply-1", piece: 1 });
    await step("hero next piece again", hero, { text: "From Orgrimmar, in Durotar.", reply: "hero-reply-1", piece: 1 });
    await step("hero old app piece", hero, { text: "Lok'tar ogar.", reply: "hero-reply-2" });
    await step("hero old app piece 2", hero, { text: "Victory or death.", reply: "hero-reply-2" });
    await step("hero past 600", hero, { text: "a".repeat(590), reply: "hero-reply-3", piece: 0 });
    await step("hero past 600 more", hero, { text: "And a little more.", reply: "hero-reply-3", piece: 1 });
    // A finest-voice pack on a Hero whose month's 1,500 finest replies are said: its replies in the finest voice, one of
    // the pack's each (packs bought before they were retired).
    const packedPeriod = poolWindow(await planFor(env, packed.user.id)).key;
    const packedAdd = sql.prepare("INSERT INTO voice_replies (user_id, reply, period, pieces, heard, best, created) " +
      "VALUES (?, ?, ?, 1, 1, 1, ?)");
    for (let i = 0; i < 1500; i++) packedAdd.run(packed.user.id, `earlier-${i}`, packedPeriod, new Date(NOW).toISOString());
    sql.prepare("INSERT INTO answer_packs (id, user_id, kind, answers, remaining, spent_micro, status, created) VALUES " +
      "(?, ?, 'voice', 400, 400, 0, 'active', ?)").run("pack-1", packed.user.id, new Date(NOW - 864e5).toISOString());
    await step("pack reply", packed, { text: "Strength and honor.", reply: "pack-reply-1", piece: 0 });
    await step("pack reply piece 2", packed, { text: "For the Horde.", reply: "pack-reply-1", piece: 1 });
    // Legend: its last finest reply of the plan month, then the studio voice; a reply the app gave up on goes back.
    const period = poolWindow(await planFor(env, legend.user.id)).key;
    const add = sql.prepare("INSERT INTO voice_replies (user_id, reply, period, pieces, heard, best, created) " +
      "VALUES (?, ?, ?, 1, 1, 1, ?)");
    for (let i = 0; i < LEGEND_BEST_PER_MONTH - 1; i++) add.run(legend.user.id, `earlier-${i}`, period, new Date(NOW).toISOString());
    await step("legend last finest", legend, { text: "Strength and honor.", reply: "legend-reply-1", piece: 0 });
    await step("legend then studio", legend, { text: "The studio voice.", reply: "legend-reply-2", piece: 0 });
    await step("legend unheard", legend, { reply: "legend-reply-1", unheard: true });
    await step("legend finest again", legend, { text: "Finest once more.", reply: "legend-reply-3", piece: 0 });
    // Champion: the finest voice; both providers down, the PC says it and nothing is kept.
    await step("champion reply", champion, { text: "Hail, champion.", reply: "champ-reply-1", piece: 0 });
    failing.add("inworld");
    failing.add("deepinfra");
    await step("champion provider down", champion, { text: "Nobody hears this.", reply: "champ-reply-2", piece: 0 });
    failing.clear();
    // The free plan: the studio voice on every spoken answer, counted by the calendar month.
    await step("free reply", free, { text: "Welcome, traveler.", reply: "free-reply-1", piece: 0 });
    await step("free reply piece 2", free, { text: "The road is long.", reply: "free-reply-1", piece: 1 });
    // The free plan's old spoken starter (no plan has it now): a free player whose starter is spoken for gets text.
    const starter = sql.prepare("INSERT INTO voice_replies (user_id, reply, period, pieces, heard, created) VALUES (?, ?, 'starter', 1, 1, ?)");
    for (let i = 0; i < STARTER_ANSWERS; i++) starter.run(spentFree.user.id, `starter-${i}`, new Date(NOW).toISOString());
    const alwaysSpoken = PLAN_VOICE.free;
    PLAN_VOICE.free = { voice: "chatterbox", choice: false, starter: true };
    try {
      await step("free starter spent", spentFree, { text: "Text from here.", reply: "spent-reply-1", piece: 0 });
    } finally { PLAN_VOICE.free = alwaysSpoken; }
    // A new player's best first: two finest replies earned, the second asked out on the day's cap.
    sql.prepare("INSERT INTO best_first (claim, user_id, used, voices) VALUES (?, ?, 2, 2)").run(`taste:${taste.user.id}`, taste.user.id);
    await step("taste finest", taste, { text: "Welcome, traveler.", reply: "taste-reply-1", piece: 0 });
    await step("taste finest piece 2", taste, { text: "Ask me anything.", reply: "taste-reply-1", piece: 1 });
    await step("taste line", taste, { text: "Westfall was farmland once.", line: true });
    failing.add("inworld");
    await step("taste inworld down", taste, { text: "Through the mist.", reply: "taste-reply-2", piece: 0 });
    failing.clear();
    env.TASTE_DAY_USD = "0";
    sql.prepare("UPDATE best_first SET voices = 1 WHERE user_id = ?").run(taste.user.id);
    await step("taste day cap", taste, { text: "Later, then.", reply: "taste-reply-3", piece: 0 });
    delete env.TASTE_DAY_USD;
    // Legend at its month's net: studio while a whole studio reply fits, then the PC.
    const net = PLANS.legend.totalCapMicro;
    const spend = (voice) => sql.prepare("INSERT OR REPLACE INTO answer_user_spend (user_id, month, micro, calls, voice_micro) " +
      "VALUES (?, '2026-10', ?, 1, ?)").run(capped.user.id, 9_000_000 + voice, voice);
    spend(net - 9_000_000 - 5_000);
    await step("capped studio", capped, { text: "Hail, champion.", reply: "capped-reply-1", piece: 0 });
    spend(net - 9_000_000 - 500);
    await step("capped spent", capped, { text: "Hail.", reply: "capped-reply-2", piece: 0 });
    await step("hero line", hero, { text: "Elwynn is quiet tonight.", line: true });

    if (process.env.RECORD === "1") {
      writeFileSync(FIXTURE, JSON.stringify(steps, null, 1) + "\n");
      return;
    }
    const recorded = JSON.parse(readFileSync(FIXTURE, "utf8"));
    assert.equal(steps.length, recorded.length);
    for (let i = 0; i < steps.length; i++) assert.deepEqual(steps[i], recorded[i], `step ${i}: ${steps[i].label}`);
  } finally {
    globalThis.fetch = original;
    t.mock.timers.reset();
  }
});
