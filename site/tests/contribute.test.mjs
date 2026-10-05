// Shared Forever text end to end (LOR-235, LOR-236): the browser's SavedVariables reader (public/contribute/svparse.js),
// the Contribute code (public/contribute-code.js), POST /api/contribute and its statuses, the receipt, stats,
// contributors, export, shipped, /admin's reject and restore, and the hash the pipeline shares (lore.known_text).
// D1 is node:sqlite (helpers.mjs). Run: node --test site/tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parseSavedVariables, extractLines, SVError, LIMITS } from "../public/contribute/svparse.js";
import { encode, decode, findCode, checksum, escapeField, unescapeField } from "../public/contribute-code.js";
import { onRequestPost as contributePost } from "../functions/api/contribute.js";
import { onRequestGet as contributeGet, onRequestPost as contributeAdminPost } from "../functions/api/contribute/[action].js";
import { onRequestGet as receiptGet } from "../functions/contribute/r/[id].js";
import { onRequestGet as contributePage } from "../functions/contribute/index.js";
import { onRequestGet as adminGet, onRequestPost as adminPost } from "../functions/api/admin.js";
import { onRequest as authApi } from "../functions/api/auth/[action].js";
import { textHash, normalizeText, forgetKnown, decide, independentSenders, RATE } from "../lib/contribute.js";
import { setup, findOrCreateUser, startSession, deleteUser } from "../lib/accounts.js";
import { d1 } from "./helpers.mjs";

const ORIGIN = "https://loreforeverwow.com";
const FIX = new URL("./fixtures/contribute/", import.meta.url);
const SV = readFileSync(new URL("LoreForever.lua", FIX));
const KEY = "admin-test-key";

// One database for the file (lib/accounts.js and lib/contribute.js create their tables once per process), emptied
// before each test.
let known = { v: 1, lines: {} };
let contributeHtml = "";
const env = {
  DB: d1(), ADMIN_KEY: KEY,
  ASSETS: { async fetch(url) {
    const p = new URL(url).pathname;
    if (p === "/contribute/known.json") return Response.json(known);
    if (p === "/contribute") return new Response(contributeHtml, { headers: { "Content-Type": "text/html" } });
    return new Response("not found", { status: 404 });
  } },
};
beforeEach(async () => {
  await setup(env);
  for (const t of ["contrib_lines", "contrib_uploads", "contrib_batches", "rate_limits", "sessions", "users"]) {
    try { env.DB.sqlite.exec(`DELETE FROM ${t}`); } catch (e) { /* made by the first upload */ }
  }
  known = { v: 1, lines: {} };
  forgetKnown();
  delete env.SITE_FEATURES;
});

async function post(body, { origin = ORIGIN, ip = "203.0.113.7", headers = {}, cookie } = {}) {
  const h = new Headers({ "Content-Type": "application/json", "CF-Connecting-IP": ip, ...headers });
  if (origin) h.set("Origin", origin);
  if (cookie) h.set("Cookie", cookie);
  const request = new Request(ORIGIN + "/api/contribute", { method: "POST", headers: h, body: JSON.stringify(body) });
  const waits = [];
  const res = await contributePost({ request, env, waitUntil: p => waits.push(p) });
  await Promise.all(waits);
  return { status: res.status, body: await res.json() };
}

async function get(action, query = "", headers = {}) {
  const request = new Request(`${ORIGIN}/api/contribute/${action}${query}`, { headers });
  const res = await contributeGet({ request, env, params: { action } });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const quest = (id, part, text, extra = {}) => ({ kind: "quest", ref_id: String(id), part, locale: "enUS",
  build: "1.60.1.70205", text, ...extra });
const lines = () => env.DB.sqlite.prepare("SELECT * FROM contrib_lines ORDER BY id").all();
const statusOf = text => env.DB.sqlite.prepare("SELECT status FROM contrib_lines WHERE text = ?").get(text)?.status;
const age = (seconds, where = "1 = 1") => env.DB.sqlite.exec(`UPDATE contrib_lines SET first_seen = first_seen - ${seconds} WHERE ${where}`);

// ---- The SavedVariables reader ----

test("svparse: a real LoreForever.lua, every kind of text, the account's names taken out", () => {
  const g = parseSavedVariables(SV);
  const db = g.get("LoreForeverDB");
  assert.equal(db.get("sessions"), 42);
  assert.equal(db.get("settings").get("panelScale"), 1.15);
  assert.equal(db.get("neg"), -1.25);
  assert.equal(db.get("hex"), 31);
  assert.equal(db.get("settings").get("voiceOrder").get(2), "LoreForever_Voice_Female");
  assert.equal(db.get("questions").get(1).get("q"), 'who is "Hogger"?');
  assert.ok(!db.has("heard"), "nil values aren't kept");

  const x = extractLines(g);
  assert.deepEqual(x.meta, { build: "1.60.1.70205", locale: "enUS", version: "0.8.0", install: "a1b2c3d4e5f60718" });
  assert.deepEqual(x.counts, { quest: 7, gossip: 3, book: 2, say: 2 });
  assert.equal(x.sent, 3, "lines already shared are left out");
  assert.equal(x.lines.length, 14);
  const find = (kind, ref, part) => x.lines.find(l => l.kind === kind && l.ref_id === ref && (part === undefined || l.part === part));
  const detail = find("quest", "99001", "detail");
  assert.match(detail.text, /^You've come a long way, \$N\./);
  assert.deepEqual(detail.speaker, { id: "197001", name: "Warden Halvar", sex: 2, type: "Humanoid" });
  assert.equal(detail.player, "Human.WARRIOR.3");
  assert.equal(find("quest", "99001", "complete").text, "Fine work. Even a $R like you can earn the isle's respect.");
  const poster = find("quest", "99002", "detail");
  assert.equal(poster.text, "$N, read the poster: <name> should not hunt Grimtusk alone.", "a character's name -> $N");
  assert.deepEqual(poster.speaker, { object: "300077" });
  assert.ok(!find("quest", "176"), "quest 176 was all sent");
  const gossip = x.lines.filter(l => l.kind === "gossip" && l.ref_id === "197");
  assert.equal(gossip.length, 2, "gossip of an NPC whose id is known goes by the id");
  assert.equal(gossip.find(l => l.part === "1a2b3c4d").player, "NightElf.DRUID.2");
  assert.ok(find("gossip", "n:Old Sailor"), "and by name when it isn't");
  assert.equal(find("book", "The Battle of Grim Batol", "1").text, "For $N: page one\\two.");
  assert.equal(find("book", "The Battle of Grim Batol", "2").text, "Page two \u2014 with a dash.", "\\ddd escapes are UTF-8 bytes");
  assert.ok(!find("book", "Plaque (Elwynn Forest)"), "a sent page is left out");
  const yell = x.lines.find(l => l.kind === "say" && l.mode === "yell");
  assert.deepEqual(yell.speaker, { id: "197001", name: "Warden Halvar", sex: 2, type: "Humanoid" });
  assert.ok(!JSON.stringify(x.lines).includes("Aelric"), "no character name anywhere");
});

test("svparse: Lua 5.1 strings, numbers, keys and comments as the game writes them", () => {
  const g = parseSavedVariables(String.raw`-- a comment
X = { "a\"b\\c\nd\065\9\r", 'single \'q\'', [ "k" ] = 1; [2.5] = -0.5, [true] = 1e3, name = .5, [-3] = 0X10, nested = { { } }, }
Y = nil Z = "line\
break"`);
  const x = g.get("X");
  assert.equal(x.get(1), 'a"b\\c\ndA\t\r');
  assert.equal(x.get(2), "single 'q'");
  assert.equal(x.get("k"), 1);
  assert.equal(x.get(2.5), -0.5);
  assert.equal(x.get(true), 1000);
  assert.equal(x.get("name"), 0.5);
  assert.equal(x.get(-3), 16);
  assert.equal(x.get("nested").get(1).size, 0);
  assert.equal(g.get("Y"), null);
  assert.equal(g.get("Z"), "line\nbreak");
  // A byte order mark and Windows line ends.
  assert.equal(parseSavedVariables("\uFEFFA = {\r\n\t[\"x\"] = \"y\",\r\n}\r\n").get("A").get("x"), "y");
});

test("svparse: anything that isn't plain data is refused", () => {
  const bad = [
    ["LoreForeverDB = os.execute('rm -rf /')", /literal/],
    ["LoreForeverDB = { a = 1 + 2 }", /, or }/],
    ["LoreForeverDB = function() end", /literal/],
    ["LoreForeverDB = { [{}] = 1 }", /key/],
    ["LoreForeverDB = [[long]]", /Long strings/],
    ["--[[ block ]] LoreForeverDB = {}", /Block comments/],
    ["LoreForeverDB = \"never ends", /never ends|ends/],
    ["LoreForeverDB = \"two\nlines\"", /line/],
    ["LoreForeverDB = \"bad \\q escape\"", /escape/],
    ["LoreForeverDB = \"\\300\"", /escape/],
    ["LoreForeverDB = { x = y }", /literal/],
    ["LoreForeverDB = {", /never ends|ends in the middle/],
    ["LoreForeverDB", /Expected =/],
    ["LoreForeverDB == {}", /Expected =/],
    ["return {}", /Expected =/],
    ["LoreForeverDB = 12abc", /malformed|runs into/],
    ["LoreForeverDB = - 5", /literal/],
    ["\x00\x01\x02garbage\xff\xfe", /Expected a name/],
    ["LoreForeverDB = setmetatable({}, {__index = os})", /literal/],
    ["LoreForeverDB = { ['__proto__'] = { polluted = true } }", null],   // fine: just a key, never an object's prototype
  ];
  for (const [src, msg] of bad) {
    if (msg === null) {
      const t = parseSavedVariables(src).get("LoreForeverDB");
      assert.equal(t.get("__proto__").get("polluted"), true);
      assert.equal({}.polluted, undefined);
      continue;
    }
    assert.throws(() => parseSavedVariables(src), e => e instanceof SVError && msg.test(e.message), src);
  }
  assert.throws(() => extractLines(parseSavedVariables("SomethingElse = {}")), /no LoreForeverDB/);
});

test("svparse: limits keep a huge or hostile file from hanging the page", () => {
  const deep = "X = " + "{".repeat(200) + "}".repeat(200);
  assert.throws(() => parseSavedVariables(deep), /nested too deeply/);
  const small = { ...LIMITS, bytes: 1000 };
  assert.throws(() => parseSavedVariables("X = '" + "a".repeat(2000) + "'", small), /too big/);
  assert.throws(() => parseSavedVariables("X = '" + "a".repeat(200) + "'", { ...LIMITS, string: 100 }), /too long/);
  assert.throws(() => parseSavedVariables("X = '" + "a\\n".repeat(200) + "'", { ...LIMITS, string: 100 }), /too long/);
  assert.throws(() => parseSavedVariables("X = {" + "1,".repeat(500) + "}", { ...LIMITS, values: 100 }), /too many values/);
  assert.throws(() => parseSavedVariables("X" + "x".repeat(300) + " = 1"), /name is too long/);
  // A big but ordinary file reads quickly.
  const rows = Array.from({ length: 20000 }, (_, i) => `\t\t[${i + 1}] = { ["title"] = "Quest ${i}", ["text"] = "Text \\"${i}\\"\\n" },`);
  const t0 = Date.now();
  const g = parseSavedVariables(`LoreForeverDB = {\n\t["quests"] = {\n${rows.join("\n")}\n\t},\n}\n`);
  assert.equal(extractLines(g).counts.quest, 40000);
  assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
});

// ---- Contribute codes ----

const LINE = { kind: "quest", ref_id: "99001", part: "progress", locale: "enUS", version: "0.8.0",
  text: "The crows~still circle, 100% $C.\nDo you have them?", speaker: { id: "197001", sex: 2, type: "Humanoid", name: "Warden H. Halvar" },
  player: "Human.WARRIOR.3" };

test("codes: round trip, escapes, the link form and a cut-short copy", () => {
  const code = encode(LINE);
  assert.ok(code.startsWith("LFC1~0.8.0.enUS~quest~99001~progress~197001.2.Humanoid.Warden H. Halvar~Human.WARRIOR.3~"));
  assert.ok(!code.includes("\n") && code.split("~").length === 9, "one line, nine fields");
  const r = decode(code);
  assert.ok(r.ok, r.error);
  assert.equal(r.line.text, LINE.text);
  assert.deepEqual(r.line.speaker, LINE.speaker);
  assert.deepEqual(r.line.playerInfo, { race: "Human", class: "WARRIOR", sex: 3, tag: "Human.WARRIOR.3" });
  const link = `https://loreforeverwow.com/contribute#c=${encodeURIComponent(code)}`;
  assert.equal(decode(link).line.text, LINE.text, "from the whole link");
  assert.equal(decode(`look at this ${link} thanks`).line.part, "progress", "from a message around the link");
  assert.equal(findCode("  " + code + "  "), code);
  assert.match(decode(code.slice(0, -20)).error, /cut short/);
  assert.match(decode(code.replace("crows", "crown")).error, /cut short or changed/);
  assert.match(decode(link.slice(0, -1) + "%").error, /cut short/);
  assert.match(decode("hello").error, /no Lore Forever code/);
  assert.equal(unescapeField(escapeField("a%b~c\r\nd")), "a%b~c\r\nd");
  assert.equal(unescapeField("bad %41"), null, "an escape we never write means the code was mangled");
  assert.equal(checksum(""), "00001505", "djb2 starts at 5381");
  // A book page and an object speaker.
  const book = decode(encode({ kind: "book", ref_id: "The Battle of Grim Batol", part: "2", locale: "deDE", text: "Seite zwei" }));
  assert.equal(book.line.locale, "deDE");
  assert.equal(book.line.speaker, null);
  assert.deepEqual(decode(encode({ ...LINE, speaker: { object: "300077" } })).line.speaker, { object: "300077" });
});

test("codes: the add-on's own codes decode here (tests/contribute_sim.py writes them)", { skip: !existsSync(new URL("codes.json", FIX)) }, () => {
  const codes = JSON.parse(readFileSync(new URL("codes.json", FIX), "utf8"));
  assert.ok(codes.length >= 3);
  for (const c of codes) {
    const r = decode(c.link);
    assert.ok(r.ok, `${c.link.slice(0, 80)}: ${r.error}`);
    for (const k of ["kind", "ref_id", "part", "locale", "text", "player"]) assert.equal(r.line[k], c.expect[k], k);
    if (c.expect.speaker) assert.deepEqual(r.line.speaker, c.expect.speaker);
  }
});

// ---- The text hash the pipeline shares ----

test("hash: the same as pipeline/lore/known_text.py", async () => {
  for (const r of JSON.parse(readFileSync(new URL("hashes.json", FIX), "utf8"))) {
    assert.equal(normalizeText(r.input), r.normalized, r.input);
    assert.equal(await textHash(r.input), r.hash, r.input);
  }
});

// ---- POST /api/contribute ----

test("upload: new lines, then a second player verifies them; the same player again changes nothing", async () => {
  const x = extractLines(parseSavedVariables(SV));
  const body = { lines: x.lines, source: "file", locale: "enUS", build: x.meta.build, version: "0.8.0", website: "",
                 nick: "Thaelric", install: "a".repeat(64) };
  const preview = await post({ ...body, preview: true });
  assert.equal(preview.status, 200);
  assert.deepEqual([preview.body.new, preview.body.known, preview.body.upload_id], [14, 0, null]);
  assert.equal(lines().length, 0, "a preview saves nothing");

  const first = await post(body);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.new, 14);
  assert.match(first.body.receipt, /^\/contribute\/r\/[0-9a-f]{16}$/);
  const rows = lines();
  assert.equal(rows.length, 14);
  assert.ok(rows.every(r => r.status === "single" && r.uploaders === 1 && r.found_by_nick === "Thaelric"));
  assert.ok(rows.every(r => r.found_by_user === null && typeof r.first_seen === "number"));
  const gossip = rows.find(r => r.kind === "gossip" && r.ref_id === "197");
  assert.equal(gossip.part, gossip.text_hash.slice(0, 8), "gossip's part is the server's own text hash");
  assert.equal(JSON.parse(rows.find(r => r.part === "detail" && r.ref_id === "99001").speaker).name, "Warden Halvar");

  const again = await post(body);
  assert.deepEqual([again.body.new, again.body.known, again.body.confirmed], [0, 14, 0], "re-sent: already known");
  assert.ok(lines().every(r => r.uploaders === 1));

  const other = await post({ ...body, nick: "", install: "b".repeat(64) }, { ip: "198.51.100.9" });
  assert.deepEqual([other.body.new, other.body.confirmed], [0, 14]);
  assert.ok(lines().every(r => r.status === "verified" && r.uploaders === 2 && r.uploads === 2));
  assert.ok(lines().every(r => r.found_by_nick === "Thaelric"), "the finder is whoever sent it first");
});

test("independence: one person's file and code from one IP stay single; a different IP alone isn't enough", async () => {
  const text = "A prankster's own line, sent twice.";
  // A file upload (with the add-on's install id) and a code upload (no install) from the same IP, same day.
  await post({ source: "file", install: "d".repeat(64), lines: [quest(71, "detail", text)] }, { ip: "192.0.2.80" });
  const code = await post({ source: "code", lines: [quest(71, "detail", text)] }, { ip: "192.0.2.80" });
  assert.deepEqual([code.body.confirmed, code.body.known], [0, 1], "the same IP today: already known, not a confirmation");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM contrib_uploads").get().n, 1, "nothing recorded twice");
  assert.equal(statusOf(text), "single");
  // Signed in on the same PC: still the same IP hash, still one sender.
  const user = await findOrCreateUser(env, { email: "prank@example.com", googleSub: "g-prank", name: "Prank" });
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  await post({ source: "file", lines: [quest(71, "detail", text)] }, { ip: "192.0.2.80", cookie });
  assert.equal(statusOf(text), "single");
  // The same install from another IP (home, then a café): one sender.
  await post({ source: "file", install: "d".repeat(64), lines: [quest(71, "detail", text)] }, { ip: "198.51.100.90" });
  assert.equal(statusOf(text), "single");
  assert.equal(lines().find(r => r.text === text).uploaders, 1);
  // Someone else entirely: another IP and another install. Now it's verified.
  await post({ source: "file", install: "e".repeat(64), lines: [quest(71, "detail", text)] }, { ip: "198.51.100.91" });
  assert.equal(statusOf(text), "verified");
  assert.equal(lines().find(r => r.text === text).uploaders, 2);
});

test("independentSenders: chained by IP hash or account/install", () => {
  const u = (uploader, ip_hash) => ({ uploader, ip_hash });
  assert.equal(independentSenders([]), 0);
  assert.equal(independentSenders([u("i:a", "ip1"), u("h:ip1", "ip1")]), 1, "file + code, one IP");
  assert.equal(independentSenders([u("i:a", "ip1"), u("i:a", "ip2")]), 1, "one install, two IPs");
  assert.equal(independentSenders([u("i:a", "ip1"), u("u:x", "ip1"), u("u:x", "ip2"), u("h:ip3", "ip3")]), 2, "chained");
  assert.equal(independentSenders([u("h:ip1", "ip1"), u("h:ip2", "ip2")]), 2, "anonymous, two IPs");
  assert.equal(independentSenders([u("x:b1", null), u("x:b2", null), u("x:b1", null)]), 2, "expired: by upload");
});

test("upload: what the add-on ships is dropped, the client's own text verifies, a different text is a conflict", async () => {
  const shipped = "A huge gnoll grows more bold by the day.";
  const client = "Bring 6 Stormcrow Feathers to Warden Halvar.";
  const wiki = "The wiki's older wording of the quest.";
  known = { v: 1, lines: {
    "quest:176#detail": [await textHash(shipped), ""],
    "quest:99001#objectives": ["", await textHash(client)],
    "quest:99001#detail": [await textHash(wiki), ""],
    "quest:99001#progress": ["", await textHash("The crows still circle. Do you have them?")],
  } };
  forgetKnown();
  const r = await post({ source: "file", lines: [
    quest(176, "detail", shipped),
    quest(99001, "objectives", client),
    quest(99001, "detail", "Forever's own new wording, longer and different."),
    quest(99001, "progress", "The crows still circle, friend. Do you have them?"),
  ] });
  assert.deepEqual([r.body.new, r.body.known], [3, 1]);
  assert.equal(statusOf(shipped), undefined, "shipped text isn't stored");
  assert.equal(statusOf(client), "verified");
  assert.equal(statusOf("Forever's own new wording, longer and different."), "single", "differs only from the wiki's text");
  const progress = lines().find(r => r.part === "progress");
  assert.equal(progress.status, "conflict", "differs from the Forever client's own text: needs a second player");
  assert.equal(progress.corrects, known.lines["quest:99001#progress"][1]);
});

test("upload: two texts for one part conflict, unless they're from players of different genders", async () => {
  await post({ source: "file", lines: [quest(5, "complete", "Thank you, lad.", { player: "Dwarf.WARRIOR.2" })] });
  await post({ source: "file", lines: [quest(5, "complete", "Thank you, lass.", { player: "Dwarf.WARRIOR.3" })] }, { ip: "198.51.100.2" });
  assert.equal(statusOf("Thank you, lad."), "single");
  assert.equal(statusOf("Thank you, lass."), "single", "a $g gender branch, not a conflict");
  await post({ source: "file", lines: [quest(5, "complete", "Thanks, lad.", { player: "Human.MAGE.2" })] }, { ip: "198.51.100.3" });
  assert.equal(statusOf("Thank you, lad."), "conflict");
  assert.equal(statusOf("Thanks, lad."), "conflict");
  assert.equal(statusOf("Thank you, lass."), "single");
  // A second player confirms one: it's verified, the other stays a conflict.
  await post({ source: "file", lines: [quest(5, "complete", "Thank you, lad.", { player: "Gnome.ROGUE.2" })] }, { ip: "198.51.100.4" });
  assert.equal(statusOf("Thank you, lad."), "verified");
  assert.equal(statusOf("Thanks, lad."), "conflict");
});

test("upload: spam is held, garbage lines are skipped, never the whole upload", async () => {
  const r = await post({ source: "file", lines: [
    quest(7, "detail", "Visit www.cheap-gold.example for gold"),
    quest(7, "progress", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    quest(7, "complete", "A fine ending."),
    { kind: "quest", ref_id: "abc", part: "detail", locale: "enUS", text: "bad id" },
    { kind: "quest", ref_id: "7", part: "nonsense", locale: "enUS", text: "bad part" },
    { kind: "spell", ref_id: "7", part: "detail", locale: "enUS", text: "bad kind" },
    { kind: "quest", ref_id: "7", part: "detail", locale: "xxXX", text: "bad locale" },
    quest(8, "detail", "x".repeat(4001)),
    quest(8, "progress", "control \u0007 char"),
    quest(8, "complete", "12345 !!!"),
    "not even an object",
  ] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.new, r.body.invalid], [3, 8]);
  assert.equal(statusOf("Visit www.cheap-gold.example for gold"), "flagged");
  assert.equal(statusOf("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "flagged");
  assert.equal(statusOf("A fine ending."), "single");
  const none = await post({ source: "file", lines: [{ kind: "quest", ref_id: "x", text: "y" }] });
  assert.equal(none.status, 400);
  assert.equal((await post({ source: "file", lines: [] })).status, 400);
  assert.equal((await post({ source: "file", lines: Array.from({ length: 5001 }, (_, i) => quest(i + 1, "detail", "t")) })).status, 413);
});

test("upload: the honeypot, other sites, the companion, codes and the hourly limit", async () => {
  const trap = await post({ source: "file", website: "http://spam", lines: [quest(9, "detail", "Bot text here.")] });
  assert.equal(trap.status, 200);
  assert.equal(trap.body.receipt, null);
  assert.equal(lines().length, 0, "a bot's upload pretends to work and saves nothing");
  assert.equal((await post({ lines: [quest(9, "detail", "Text.")] }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await post({ lines: [quest(9, "detail", "Text.")] }, { origin: null })).status, 403);

  // The companion app (LOR-240): no Origin, its header, the add-on's own speaker record, gossip by NPC name, no player.
  const comp = await post({ source: "companion", install: "c".repeat(64), lines: [
    { kind: "gossip", ref_id: "Marshal McBride", part: "1a2b3c4d", text: "Hey $N.", speaker: { kind: "npc", id: 197, name: "Marshal McBride", sex: 2, ctype: "Humanoid", model: 123 } },
    { kind: "quest", ref_id: "99001", part: "title", text: "The Stormcrow's Debt", speaker: { kind: "object", id: 300077 } },
  ] }, { origin: null, headers: { "X-LF-Client": "companion/0.1.0" } });
  assert.equal(comp.status, 200, JSON.stringify(comp.body));
  assert.equal(comp.body.new, 2);
  assert.match(comp.body.receipt, /^\/contribute\/r\//);
  const g = lines().find(r => r.kind === "gossip");
  assert.equal(g.ref_id, "n:Marshal McBride");
  assert.equal(g.locale, "enUS", "a line that doesn't say its language is English");
  assert.deepEqual(JSON.parse(g.speaker), { id: "197", name: "Marshal McBride", sex: 2, type: "Humanoid" });
  assert.deepEqual(JSON.parse(lines().find(r => r.part === "title").speaker), { object: "300077" });
  assert.equal(env.DB.sqlite.prepare("SELECT source, uploader FROM contrib_batches").get().source, "companion");

  // A code carries one line.
  const decoded = decode(encode(LINE)).line;
  const { version, playerInfo, ...line } = decoded;
  const code = await post({ source: "code", version, lines: [line] });
  assert.equal(code.body.new, 1);
  assert.equal((await post({ source: "code", lines: [line, line] })).status, 400);

  // Ten file uploads an hour per sender; the eleventh waits.
  for (let i = 0; i < RATE.file; i++) {
    assert.equal((await post({ source: "file", lines: [quest(100 + i, "detail", `Line ${i}`)] }, { ip: "192.0.2.50" })).status, 200);
  }
  const over = await post({ source: "file", lines: [quest(200, "detail", "One too many")] }, { ip: "192.0.2.50" });
  assert.equal(over.status, 429);
  assert.ok(over.body.retryAfter > 0 && over.body.retryAfter <= 3600);
  assert.equal((await post({ source: "file", lines: [quest(200, "detail", "Someone else")] }, { ip: "192.0.2.51" })).status, 200);
});

test("upload: a signed-in player gets the credit under their shown name; deleting the account unlinks it", async () => {
  const user = await findOrCreateUser(env, { email: "p@example.com", googleSub: "g1", name: "Real Name" });
  env.DB.sqlite.prepare("UPDATE users SET display_name = 'Brightwing', show_public = 1 WHERE id = ?").run(user.id);
  const cookie = (await startSession(env, new Request(ORIGIN), user.id)).split(";")[0];
  await post({ source: "file", lines: [quest(11, "detail", "Signed in text.")] }, { cookie });
  await post({ source: "file", nick: "Zed", lines: [quest(12, "detail", "Nick text.")] }, { ip: "198.51.100.77" });
  await post({ source: "file", lines: [quest(13, "detail", "Anonymous text.")] }, { ip: "198.51.100.78" });
  assert.equal(lines().find(r => r.ref_id === "11").found_by_user, user.id);
  assert.deepEqual((await get("contributors")).body, [], "nothing is accepted yet");
  age(49 * 3600);
  const list = (await get("contributors")).body;
  assert.deepEqual(list.map(p => [p.name, p.lines_accepted]), [["Brightwing", 1], ["Zed", 1]], "alphabetical; anonymous isn't listed");
  env.DB.sqlite.prepare("UPDATE users SET show_public = 0 WHERE id = ?").run(user.id);
  assert.deepEqual((await get("contributors")).body.map(p => p.name), ["Zed"], "a hidden account isn't listed");
  await deleteUser(env, user);
  const row = lines().find(r => r.ref_id === "11");
  assert.equal(row.found_by_user, null, "the line stays, unlinked");
  assert.ok(env.DB.sqlite.prepare("SELECT uploader FROM contrib_uploads WHERE user_id IS NULL AND uploader LIKE 'u:%'").all().length === 0);
});

test("accepted after 48 hours, export, shipped, stats and the receipt", async () => {
  const r1 = await post({ source: "file", nick: "Zed", lines: [quest(21, "detail", "Old enough."), quest(22, "detail", "Too new.")] });
  age(49 * 3600, "ref_id = '21'");
  const auth = { "X-Admin-Key": KEY };
  assert.equal((await get("export", "", {})).status, 401);
  let ex = await get("export", "?status=accepted", auth);
  assert.equal(ex.status, 200);
  assert.deepEqual(ex.body.lines.map(l => [l.ref_id, l.status, l.accepted, l.found_by]), [["21", "single", true, "Zed"]]);
  const since = ex.body.now;
  assert.deepEqual((await get("export", `?since=${since}`, auth)).body.lines, [], "nothing new since the last pull");
  assert.equal((await get("export", "?status=all", { Authorization: "Bearer " + KEY })).body.lines.length, 2);
  assert.equal((await get("export", "?status=bogus", auth)).status, 400);

  const ship = async body => contributeAdminPost({ request: new Request(ORIGIN + "/api/contribute/shipped",
    { method: "POST", headers: { "X-Admin-Key": KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    env, params: { action: "shipped" } });
  assert.equal((await ship({ ids: [ex.body.lines[0].id], release: "nope" })).status, 400);
  const shipped = await ship({ ids: [ex.body.lines[0].id], release: "0.8.0" });
  assert.equal((await shipped.json()).shipped, 1);
  assert.equal(statusOf("Old enough."), "shipped");
  assert.deepEqual((await get("export", "?status=accepted", auth)).body.lines, [], "shipped lines aren't exported again");
  // Sending a shipped line again counts as known.
  const again = await post({ source: "file", lines: [quest(21, "detail", "Old enough.")] }, { ip: "198.51.100.5" });
  assert.equal(again.body.known, 1);

  const stats = await get("stats");
  assert.equal(stats.headers.get("Cache-Control"), "public, max-age=300");
  assert.equal(stats.body.lines, 2);
  assert.equal(stats.body.shipped, 1);
  assert.equal(stats.body.contributors, 1, "re-sending a shipped line adds no sender");
  assert.deepEqual(stats.body.by_kind, { quest: 2, gossip: 0, book: 0, say: 0 });

  const id = r1.body.upload_id;
  const res = await receiptGet({ env, params: { id } });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex");
  assert.match(html, /In Lore Forever 0\.8\.0/);
  assert.match(html, /New: accepted after 48 hours/);
  assert.ok(!html.includes("Zed") && !html.includes("203.0.113"), "no names or addresses on a receipt");
  assert.equal((await receiptGet({ env, params: { id: "0123456789abcdef" } })).status, 404);
  assert.equal((await get("receipt", `?id=${id}`)).body.lines.length, 2);
});

test("export: what lore.contrib (LOR-237) reads: title on quest lines, say_kind, speaker, player, found_by", async () => {
  await post({ source: "file", nick: "Zed", lines: [
    quest(61, "title", "The Lost Keeper"),
    quest(61, "detail", "Find the keeper, $N.", { player: "Dwarf.WARRIOR.3", speaker: { id: "7", name: "Bram", sex: 2 } }),
    { kind: "say", ref_id: "197001", part: "x", locale: "enUS", text: "The storm comes!", mode: "yell", speaker: { id: "197001", name: "Warden Halvar" } },
  ] });
  // Other spellings clients may send: kind "yell", say_kind, a player object.
  await post({ source: "file", lines: [
    { kind: "yell", ref_id: "555", text: "Charge!", player: { race: "Human", class: "warrior", sex: 2 } },
    { kind: "say", ref_id: "556", text: "Hello there.", say_kind: "say" },
  ] }, { ip: "198.51.100.61" });
  const both = { Authorization: "Bearer " + KEY, "X-Admin-Key": KEY };
  const ex = (await get("export", "?status=all", both)).body.lines;
  const charge = ex.find(l => l.text === "Charge!");
  assert.deepEqual([charge.kind, charge.say_kind, charge.player], ["say", "yell", "Human.WARRIOR.2"]);
  assert.equal(ex.find(l => l.text === "Hello there.").say_kind, "say");
  const detail = ex.find(l => l.part === "detail");
  assert.equal(detail.title, "The Lost Keeper");
  assert.equal(detail.player, "Dwarf.WARRIOR.3");
  assert.deepEqual(detail.speaker, { id: "7", name: "Bram", sex: 2 });
  assert.equal(detail.found_by, "Zed");
  assert.equal(typeof detail.found_by, "string");
  const yell = ex.find(l => l.text === "The storm comes!");
  assert.deepEqual([yell.say_kind, yell.mode, yell.title], ["yell", "yell", null]);
  assert.equal((await get("export", "", { Authorization: "Bearer nope", "X-Admin-Key": KEY })).status, 401);
});

test("/admin: reject everything from one sender, then restore it", async () => {
  await post({ source: "file", lines: [quest(31, "detail", "Vandal text."), quest(32, "detail", "Shared by both.")] }, { ip: "192.0.2.66" });
  await post({ source: "file", lines: [quest(32, "detail", "Shared by both.")] }, { ip: "192.0.2.67" });
  assert.equal(statusOf("Shared by both."), "verified");
  const adminReq = (method, body) => new Request(ORIGIN + "/api/admin", { method, headers: { Authorization: "Bearer " + KEY,
    "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const view = await (await adminGet({ request: adminReq("GET"), env })).json();
  assert.equal(view.contributions.counts.single, 1);
  assert.equal(view.contributions.counts.verified, 1);
  const vandal = view.contributions.batches.find(b => b.n_new === 2).uploader;
  const rej = await adminPost({ request: adminReq("POST", { action: "contrib-reject", uploader: vandal }), env });
  assert.equal(rej.status, 200);
  assert.equal(statusOf("Vandal text."), "rejected");
  assert.equal(statusOf("Shared by both."), "single", "the other sender's copy stays, on one sender now");
  assert.equal(lines().find(r => r.text === "Shared by both.").uploaders, 1);
  await adminPost({ request: adminReq("POST", { action: "contrib-restore", uploader: vandal }), env });
  assert.equal(statusOf("Vandal text."), "single");
  assert.equal(statusOf("Shared by both."), "verified");
  assert.equal((await adminPost({ request: adminReq("POST", { action: "contrib-reject", uploader: "drop table" }), env })).status, 400);
});

test("IP hashes leave upload rows after 30 days", async () => {
  await post({ source: "file", lines: [quest(41, "detail", "Old upload.")] });
  env.DB.sqlite.exec("UPDATE contrib_uploads SET created_at = created_at - 31 * 86400; UPDATE contrib_batches SET created_at = created_at - 31 * 86400");
  await post({ source: "file", lines: [quest(42, "detail", "New upload.")] }, { ip: "198.51.100.200" });
  const rows = env.DB.sqlite.prepare("SELECT ip_hash, uploader FROM contrib_uploads ORDER BY id").all();
  assert.equal(rows[0].ip_hash, null);
  assert.match(rows[0].uploader, /^x:[0-9a-f]{16}$/);
  assert.match(rows[1].ip_hash, /^[0-9a-f]{24}$/);
  assert.equal(env.DB.sqlite.prepare("SELECT ip_hash FROM contrib_batches ORDER BY created_at").get().ip_hash, null);
});

test("decide: the status rules", () => {
  const row = (o = {}) => ({ status: "single", live: 1, flagged: 0, text_hash: "a", player: null, ...o });
  assert.equal(decide(row({ status: "shipped", live: 0 }), [], null), "shipped");
  assert.equal(decide(row({ live: 0 }), [], null), "rejected");
  assert.equal(decide(row({ flagged: 1, live: 3 }), [], null), "flagged");
  assert.equal(decide(row(), [], ["", "a"]), "verified");
  assert.equal(decide(row({ live: 2 }), [], null), "verified");
  assert.equal(decide(row(), [], ["", "b"]), "conflict");
  assert.equal(decide(row(), [], ["b", ""]), "single", "differs only from the shipped (wiki) text");
  const a = row(), b = row({ text_hash: "b" });
  assert.equal(decide(a, [a, b], null), "conflict");
  assert.equal(decide(a, [a, row({ text_hash: "b", live: 0 })], null), "single", "a rejected rival doesn't count");
  assert.equal(decide(a, [a, row({ text_hash: "b", flagged: 1 })], null), "single", "nor does spam");
});

// ---- The page and its flag ----

test("/contribute: noindex until the contribute feature is on; the menu link follows /api/auth/me", async () => {
  contributeHtml = readFileSync(new URL("../public/contribute.html", import.meta.url), "utf8");
  const page = async () => contributePage({ request: new Request(ORIGIN + "/contribute"), env });
  let res = await page();
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex");
  assert.match(await res.text(), /<meta name="robots" content="noindex">/);
  const me = async () => (await authApi({ request: new Request(ORIGIN + "/api/auth/me"), env, params: { action: "me" } })).json();
  assert.equal((await me()).features.contribute, false);
  env.SITE_FEATURES = "contribute";
  res = await page();
  assert.equal(res.headers.get("X-Robots-Tag"), null);
  const html = await res.text();
  assert.ok(!html.includes('name="robots"') && html.includes("Share the Forever text you've seen"));
  assert.equal((await me()).features.contribute, true);
  const header = readFileSync(new URL("../public/header.js", import.meta.url), "utf8");
  assert.match(header, /me\.features && me\.features\.contribute/);
});
