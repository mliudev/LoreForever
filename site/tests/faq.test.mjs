// The FAQ page (/faq, LOR-42): every question in its list has an answer, and the answers about the add-on stay true
// to it (LOR-290). The journey's caps and timer are Journey.lua's, the add-on has no way to send anything, the saved
// file is the account-wide LoreForever.lua, the labels it quotes are the add-on's own, and every .toc is for
// Forever's client. The sizes it gives were measured (see the comment at the top of faq.html); pipeline/tests/wow_sim.py
// checks that a level 1-60 record stays under 1 MB, and profiles.test.mjs that a pasted profile starts private.
// Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(new URL("../public/faq.html", import.meta.url), "utf8");
const ADDON = new URL("../../addon/", import.meta.url).pathname;
const CODE = join(ADDON, "LoreForever");   // the add-on's code; the other folders are its voice and language packs
const lua = f => readFileSync(join(CODE, f), "utf8");

const ENTITIES = { "&rsaquo;": "›", "&ndash;": "–", "&lt;": "<", "&gt;": ">", "&amp;": "&" };
const plain = s => s.replace(/<[^>]+>/g, "").replace(/&\w+;/g, e => ENTITIES[e] ?? e).replace(/\s+/g, " ").trim();

// One answer's HTML under its question, by its anchor.
function section(id) {
  const m = new RegExp(`<section class="faq-q" id="${id}">\\s*<h2>[^<]+</h2>([\\s\\S]*?)</section>`).exec(html);
  assert.ok(m, `no answer with id="${id}"`);
  return m[1];
}

// Lua's numeric constants: `local MAX_EVENTS = 3600` and `local A, B = 15, 5` alike.
function constants(src) {
  const out = {};
  for (const [, names, values] of src.matchAll(/^local ([A-Z][A-Z0-9_]*(?:, *[A-Z][A-Z0-9_]*)*) *= *([\d.]+(?:, *[\d.]+)*)/gm)) {
    const vs = values.split(/, */).map(Number);
    names.split(/, */).forEach((n, i) => { out[n] = vs[i]; });
  }
  return out;
}

test("every question in the list has its answer, in the same order, each anchor once", () => {
  const list = html.split('<nav class="faq-toc"')[1].split("</nav>")[0];
  const listed = [...list.matchAll(/<a href="#([\w-]+)">/g)].map(m => m[1]);
  const answers = [...html.matchAll(/<section class="faq-q" id="([\w-]+)">\s*<h2>[^<]+<\/h2>/g)].map(m => m[1]);
  assert.ok(answers.length >= 16, `only ${answers.length} answers`);
  assert.deepEqual(listed, answers);
  assert.equal(new Set(answers).size, answers.length);
  // The new answers (LOR-290, LOR-42); #retail keeps its anchor for links already shared.
  for (const id of ["privacy", "journey-cost", "retail"]) assert.ok(answers.includes(id), id);
});

test("the journey stays on the player's PC: the account-wide LoreForever.lua, and no way to send anything", () => {
  const a = section("privacy"), text = plain(a);
  assert.match(text, /^Your journey stays on your own PC/);
  // ## SavedVariables (not ...PerCharacter) is the account's SavedVariables\<add-on folder>.lua.
  const toc = readFileSync(join(CODE, "LoreForever.toc"), "utf8");
  assert.match(toc, /^## SavedVariables: LoreForeverDB\s*$/m);
  assert.doesNotMatch(toc, /SavedVariablesPerCharacter/);
  assert.ok(text.includes("\\WTF\\Account\\<account>\\SavedVariables\\LoreForever.lua"), text);
  // "Lore Forever can't send it anywhere": no add-on or chat messages, whispers or mail, in any of its code.
  const code = readdirSync(CODE).filter(f => f.endsWith(".lua"));
  assert.ok(code.length >= 20, `only ${code.length} code files`);
  for (const f of code) {
    const sends = lua(f).match(/\b(SendAddonMessage\w*|SendChatMessage|BNSend\w+|C_Club\.Send\w+|SendMail)\b/);
    assert.equal(sends, null, `${f} calls ${sends?.[1]}: the privacy answer says the add-on sends nothing`);
  }
  // The way out is the player's own copy and paste, and they're the add-on's own words.
  assert.ok(text.includes("/lore journey") && text.includes("click Copy my journey record"), text);
  assert.match(lua("Core.lua"), /cmd == "journey"/);
  assert.match(lua("JourneyRecord.lua"), /L\["Copy my journey record"\]/);
  assert.match(lua("Options.lua"), /L\["Remember my journey"\]/);
  assert.ok(text.includes("Untick Options › Remember my journey"), text);
  assert.match(text, /stays private until you make it public, and you can delete it any time/);
  assert.match(a, /href="\/account"/);
  assert.match(a, /href="\/privacy"/);
  // The companion is the one thing that can send it, and only once the player connects it or sets up live answers.
  assert.match(text, /companion app sends your journey only if you connect it to your profile or set up its live answers/);
});

test("the journey's cost: Journey.lua's caps, no per-frame work, and a timer every few seconds", () => {
  const text = plain(section("journey-cost"));
  const J = constants(lua("Journey.lua"));
  assert.equal(typeof J.MAX_EVENTS, "number");
  assert.ok(text.includes(`newest ${J.MAX_EVENTS.toLocaleString("en-US")} moments`), `MAX_EVENTS ${J.MAX_EVENTS}: ${text}`);
  assert.ok(text.includes(`last ${J.TRAIL_SESSIONS} sessions`), `TRAIL_SESSIONS ${J.TRAIL_SESSIONS}: ${text}`);
  // "Nothing runs every frame" and "a light timer ... every few seconds".
  assert.doesNotMatch(lua("Journey.lua"), /OnUpdate/);
  assert.ok(J.WALK_EVERY <= 5 && J.TRAIL_EVERY <= 30, `WALK_EVERY ${J.WALK_EVERY}, TRAIL_EVERY ${J.TRAIL_EVERY}`);
  assert.match(text, /Nothing runs every frame/);
  assert.match(text, /every few seconds for your map trail and step count/);
  // "Everything else Lore Forever saves ... is capped too": the question log, the chats, the kept game text.
  assert.equal(typeof constants(lua("Log.lua")).MAX_QUESTIONS, "number");
  assert.equal(typeof constants(lua("UI.lua")).MAX_HISTORY, "number");
  const C = constants(lua("Capture.lua"));
  assert.ok(C.MAX_QUESTS > 0 && C.MAX_TEXTS > 0 && C.SAY_TOTAL > 0, JSON.stringify(C));
  assert.match(text, /under 1 MB per character/);
  assert.match(text, /only when you log out or \/reload/);
});

test("Classic or Retail: every folder of the add-on is for Forever's client alone", () => {
  const text = plain(section("retail"));
  assert.match(text, /^It's made for WoW Forever only\./);
  assert.match(text, /Classic Era and Retail aren't supported/);
  const forever = /^## Interface: (\d+)\s*$/m.exec(readFileSync(join(CODE, "LoreForever.toc"), "utf8"))[1];
  const tocs = readdirSync(ADDON, { withFileTypes: true }).filter(d => d.isDirectory())
    .flatMap(d => readdirSync(join(ADDON, d.name)).filter(f => f.endsWith(".toc")).map(f => join(d.name, f)));
  assert.ok(tocs.length >= 10, `only ${tocs.length} .toc files`);
  for (const t of tocs) {
    const lines = readFileSync(join(ADDON, t), "utf8").match(/^## Interface.*$/gm) || [];
    // One client: a second ## Interface-<flavor> line or a comma-separated list would mean it supports another.
    assert.deepEqual(lines.map(l => l.trim()), [`## Interface: ${forever}`], `${t}: ${lines.join(" | ")}`);
  }
});

test("the FAQ keeps to Forever's point in the story: no later expansion named", () => {
  const later = /Burning Crusade|Outland|Lich King|Cataclysm|Pandaria|Draenor|Battle for Azeroth|Shadowlands|Dragonflight|War Within|draenei/i;
  assert.doesNotMatch(plain(html.split("<main")[1].split("</main>")[0]), later);
});
