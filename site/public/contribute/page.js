// /contribute (LOR-235): a line from the add-on's Contribute link (#c=...), or a whole LoreForever.lua read here in the
// browser, previewed (what's new, what Lore Forever already has) and sent to POST /api/contribute.

import { parseSavedVariables, extractLines, SVError } from "./svparse.js";
import { decode } from "../contribute-code.js";

const $ = id => document.getElementById(id);
const BATCH = 5000;   // lines per request (the API's limit)

const RACES = { NightElf: "Night Elf", Scourge: "Undead", BloodElf: "Blood Elf", HighElf: "High Elf" };
const SEX = { 2: "male", 3: "female" };
const LANG = { enUS: "English", enGB: "English", deDE: "German", frFR: "French", esES: "Spanish", esMX: "Spanish",
  ptBR: "Portuguese", ruRU: "Russian", itIT: "Italian", koKR: "Korean", zhCN: "Chinese", zhTW: "Chinese" };
const PARTS = { detail: "quest text", objectives: "objectives", progress: "progress text", complete: "completion text",
  title: "title" };
const KIND_NAMES = { quest: ["quest line", "quest lines"], gossip: ["gossip line", "gossip lines"],
  book: ["book page", "book pages"], say: ["thing NPCs said aloud", "things NPCs said aloud"] };

const n = (k, one, many) => `${k.toLocaleString("en")} ${k === 1 ? one : many}`;
const titleCase = s => s.charAt(0) + s.slice(1).toLowerCase();

function show(el, text, ok) {
  el.textContent = text || "";
  el.hidden = !text;
  el.style.color = ok ? "var(--gold-soft)" : "";
}

function playerText(tag) {
  const m = /^([A-Za-z]+)\.([A-Z]+)\.([0-3])$/.exec(tag || "");
  if (!m) return null;
  const race = RACES[m[1]] || m[1];
  return `a ${SEX[m[3]] ? SEX[m[3]] + " " : ""}${race} ${titleCase(m[2])}`;
}

function whereText(l) {
  if (l.kind === "quest") return `Quest ${l.ref_id}, ${PARTS[l.part] || l.part}`;
  if (l.kind === "book") return `“${l.ref_id}”, page ${l.part}`;
  const npc = l.ref_id.startsWith("n:") ? l.ref_id.slice(2) : (l.speaker?.name || "NPC " + l.ref_id);
  return l.kind === "say" ? `Said aloud by ${npc}` : `Gossip from ${npc}`;
}

async function sha256(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function post(body) {
  const res = await fetch("/api/contribute", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok || !data.ok) {
    const err = new Error(data.error || `The site said ${res.status}. Try again in a moment.`);
    err.retryAfter = data.retryAfter;
    throw err;
  }
  return data;
}

function done(result, receipts, marked) {
  $("cb-code").hidden = $("cb-file").hidden = $("cb-paste").hidden = true;
  show($("cb-code-status"), "");
  show($("cb-send-status"), "");
  const parts = [n(result.new, "new line", "new lines") + " Lore Forever didn't have"];
  if (result.confirmed) parts.push(`${n(result.confirmed, "line", "lines")} someone else had shared, now confirmed`);
  if (result.known) parts.push(`${n(result.known, "line", "lines")} it already had`);
  $("cb-done-text").textContent = parts.join(", ") + ". New lines are accepted after 48 hours, or as soon as a "
    + "second player shares the same words, and then go into the next update.";
  const links = receipts.filter(Boolean).map((r, i) => {
    const a = document.createElement("a");
    a.href = r;
    a.textContent = receipts.length > 1 ? `receipt ${i + 1}` : "your receipt";
    return a;
  });
  const box = $("cb-receipts");
  box.textContent = "";
  if (links.length) {
    box.append("See what happens to them on ");
    links.forEach((a, i) => { if (i) box.append(", "); box.append(a); });
    box.append(" (keep the link).");
  }
  $("cb-mark").hidden = !marked;
  $("cb-done").hidden = false;
  $("cb-done").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---- A line from the game (#c=...) ----

let codeLine = null;

function showCode(input) {
  const r = decode(input);
  if (!r.ok) return r.error;
  codeLine = r.line;
  const l = r.line;
  const rows = [
    ["What", whereText(l)],
    l.speaker && (l.speaker.name || l.speaker.id) && l.kind !== "say" && l.kind !== "gossip"
      ? ["Said by", [l.speaker.name, l.speaker.id ? `NPC ${l.speaker.id}` : ""].filter(Boolean).join(", ")] : null,
    l.speaker?.object ? ["From", `object ${l.speaker.object}`] : null,
    playerText(l.player) ? ["Seen by", playerText(l.player)] : null,
    ["Game", `${LANG[l.locale] || l.locale}${l.version ? `, Lore Forever ${l.version}` : ""}`],
  ].filter(Boolean);
  const dl = $("cb-fields");
  dl.textContent = "";
  for (const [k, v] of rows) {
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = k;
    dd.textContent = v;
    dl.append(dt, dd);
  }
  $("cb-code-text").textContent = l.text;
  $("cb-code").hidden = false;
  show($("cb-code-status"), "");
  $("cb-code").scrollIntoView({ block: "start" });
  return null;
}

$("cb-code-send").addEventListener("click", async () => {
  if (!codeLine) return;
  const btn = $("cb-code-send");
  btn.disabled = true;
  show($("cb-code-status"), "Sending...", true);
  try {
    const { version, playerInfo, ...line } = codeLine;
    const r = await post({ lines: [line], source: "code", nick: $("cb-code-nick").value, version,
                           website: $("cb-code-website").value });
    done(r, [r.receipt], false);
  } catch (e) {
    show($("cb-code-status"), e.message);
  } finally {
    btn.disabled = false;
  }
});
$("cb-code-cancel").addEventListener("click", () => { codeLine = null; $("cb-code").hidden = true; });

$("cb-paste-input").addEventListener("input", e => {
  const v = e.target.value.trim();
  if (!v) return show($("cb-paste-status"), "");
  const err = showCode(v);
  show($("cb-paste-status"), err || "Read it: check it above, then press Send.", !err);
});

// The link's #c=... is read once, then taken out of the address so it isn't kept in history or shared by accident.
if (location.hash.startsWith("#c=")) {
  const err = showCode(location.hash);
  history.replaceState(null, "", location.pathname + location.search);
  if (err) show($("cb-paste-status"), err);
}

// ---- A whole file ----

let file = null;   // {lines, meta, install}

async function readFile(f) {
  file = null;
  $("cb-preview").hidden = true;
  if (!f) return;
  if (!/\.lua$/i.test(f.name)) {
    return show($("cb-file-status"), `That's ${f.name}. Pick LoreForever.lua from the SavedVariables folder.`);
  }
  show($("cb-file-status"), "Reading...", true);
  let x;
  try {
    x = extractLines(parseSavedVariables(new Uint8Array(await f.arrayBuffer())));
  } catch (e) {
    return show($("cb-file-status"), e instanceof SVError ? `That file can't be read: ${e.message}.`
      : "That file can't be read. Is it LoreForever.lua from the SavedVariables folder?");
  }
  if (!x.lines.length) {
    return show($("cb-file-status"), x.sent
      ? "Everything in this file was already shared. Play a while, /reload, and come back!"
      : "There's no game text in this file yet. Play a while (open quests, talk to NPCs, read books), type /reload, and try again.");
  }
  file = { ...x, install: x.meta.install ? await sha256(x.meta.install) : undefined };
  $("cb-locale-row").hidden = Boolean(x.meta.locale);
  const kinds = $("cb-kinds");
  kinds.textContent = "";
  for (const [k, [one, many]] of Object.entries(KIND_NAMES)) {
    if (!x.counts[k]) continue;
    const li = document.createElement("li");
    li.textContent = n(x.counts[k], one, many);
    kinds.append(li);
  }
  const peek = $("cb-peek");
  peek.textContent = "";
  for (const l of x.lines.slice(0, 200)) {
    const li = document.createElement("li");
    const b = document.createElement("strong");
    b.textContent = whereText(l) + ": ";
    li.append(b, l.text.length > 240 ? l.text.slice(0, 240) + "..." : l.text);
    peek.append(li);
  }
  if (x.lines.length > 200) peek.insertAdjacentHTML("beforeend", `<li>... and ${x.lines.length - 200} more</li>`);
  show($("cb-file-status"), "");
  $("cb-summary").textContent = `${n(x.lines.length, "line", "lines")} of Forever text in this file`
    + (x.sent ? ` (${n(x.sent, "line", "lines")} you shared before left out)` : "") + ". Checking what's new...";
  $("cb-preview").hidden = false;
  try {
    const p = await send(true);
    const k = v => v.toLocaleString("en");
    $("cb-summary").textContent = `${n(x.lines.length, "line", "lines")} in this file: ${k(p.new)} new to Lore Forever`
      + (p.confirmed ? `, ${k(p.confirmed)} confirming what someone else shared` : "")
      + `, ${k(p.known)} already known.`;
  } catch (e) {
    $("cb-summary").textContent = `${n(x.lines.length, "line", "lines")} of Forever text in this file.`;
  }
}

// Sends the file's lines (in parts of BATCH); preview counts without saving. Returns the summed counts.
async function send(preview) {
  const sum = { new: 0, known: 0, confirmed: 0, receipts: [] };
  const locale = file.meta.locale || $("cb-locale").value;
  for (let i = 0; i < file.lines.length; i += BATCH) {
    const lines = file.lines.slice(i, i + BATCH).map(l => ({ ...l, locale, build: file.meta.build || undefined }));
    const r = await post({ lines, source: "file", preview, nick: $("cb-nick").value, install: file.install,
                           version: file.meta.version || undefined, locale, website: $("cb-website").value });
    sum.new += r.new; sum.known += r.known; sum.confirmed += r.confirmed || 0;
    sum.receipts.push(r.receipt);
  }
  return sum;
}

$("cb-input").addEventListener("change", e => readFile(e.target.files[0]));
const drop = $("cb-drop");
drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("cb-over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("cb-over"));
drop.addEventListener("drop", e => {
  e.preventDefault();
  drop.classList.remove("cb-over");
  readFile(e.dataTransfer.files[0]);
});

$("cb-send").addEventListener("click", async () => {
  if (!file) return;
  const btn = $("cb-send");
  btn.disabled = true;
  show($("cb-send-status"), "Sending...", true);
  try {
    const r = await send(false);
    done(r, r.receipts, file.hasCapture);
  } catch (e) {
    show($("cb-send-status"), e.message);
  } finally {
    btn.disabled = false;
  }
});

// ---- How far along everyone is ----
fetch("/api/contribute/stats").then(r => r.json()).then(s => {
  if (!s || !s.lines) return;
  const el = $("cb-stats");
  el.textContent = `${n(s.lines, "line", "lines")} of Forever text shared by ${n(s.contributors, "player", "players")} so far`
    + (s.shipped ? `, ${s.shipped.toLocaleString("en")} already in Lore Forever.` : ".");
  el.hidden = false;
}).catch(() => {});
