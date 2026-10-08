// The upload page (/voices/studio.html). Contributors upload one recording per line, made in a recording app, and send
// their voice for review. Server: functions/api/studio/[action].js. Lines: /voices/lines.json (voicepack clips).
// Line takes come from a proper setup (Mike, 2026-10-02), so this page takes files. Recording in the browser came back
// on 2026-10-03 for "Lend your voice" (/voices/lend, lend.js): one 3-minute reading we make a narrator voice from.
// "Claim a zone" (LOR-231, zone-claims.js) sits above the next-line box, and the next line comes from your zone first;
// it's behind the "zones" feature (site/lib/features.js; ?zones=1 shows it while that's off).
//
// Signed out, the lines can be browsed in any language and Upload and Send lead to sign-in. Signed in with no voice
// yet, the first upload starts one (named after the account, in the language picked; rename it any time). The narrator
// release is asked for on the send form, not before uploading.
//
// Before a file goes up, the browser checks it against the narrator guide (mono, 44.1/48 kHz, about -16 LUFS,
// peaks at -1 dB or lower, little silence at each end, a length that fits the text) and the quality bar in
// quality.js (sample rate, bandwidth, noise, clipping, level). Warnings never stop an upload; a file below the bar, or
// one we can't use at all (silent, not audio, too long), is refused here with how to fix it.
// The game plays .mp3 and Ogg Vorbis only, so anything else (.wav, .flac, .m4a, .webm, Opus) is turned into a mono
// .mp3 here before it goes up (mp3.js).
// Each upload carries its CRC-32 for the test pack's zip.

import { studioContext, editorLink, studioSignIn, refreshCatalog, scriptReviewNote } from "/voices/studio-workflow.js";

import { planPack, packFolder } from "/voices/testpack.js";
import { crc32, crcHex } from "/voices/crc32.js";
import { toMp3 } from "/voices/mp3.js";
import { measure, verdict, BAR } from "/voices/quality.js";
import { headerInfo, CONVERT } from "/voices/takecheck.js";
import { voiceUpload } from "/js/bulk-upload.js";
import { zonesHtml, bindZones, loadZones, activeClaim, zonesVisible } from "/voices/zone-claims.js";

const app = document.getElementById("st-app");
const player = document.getElementById("st-audio");

const WORDS_PER_SECOND = 2.5;   // a comfortable narration pace, for the target length of a line
const MAX_SECONDS = 240;
const GROUP_SHORT = { "Starting zones": "Starting", "Capitals": "Capitals", "The road ahead": "Road", "Dungeons": "Dungeons", "More stories": "More" };
const VOICES = { human: "Human", dwarf: "Dwarf", gnome: "Gnome", nightelf: "Night elf", orc: "Orc", troll: "Troll", tauren: "Tauren",
                 forsaken: "Forsaken", skyborne: "Skyborne" };

let lines = null;       // lines.json
let st = null;          // /api/studio/state
let items = [];         // every line, flattened, for the current voice's language
let view = { q: "", group: "", voice: "", show: "", mine: false, zone: "" };
let nextPos = 0;
let mine = new Set();   // story keys this person picked, per voice (kept in this browser)
const open = new Set(), busy = new Set(), errors = {};
let creating = false, renaming = false, sent = null;
const returnQuery = new URLSearchParams(location.search);
let applyReturnContext = true, focusLine = returnQuery.get("line"), catalogNote = "", refreshing = false;
let reviewStatus = null, reviewLocale = null;
const mineKey = () => `lf-studio-mine-${st?.voice || "new"}`;

const lines_ = n => `${n} line${n === 1 ? "" : "s"}`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtTime = s => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
// The language shown before there's a voice: the last one picked here, else the browser's, else English.
let browseLocale = store.get("lf-studio-locale") || { de: "deDE", pt: "ptBR" }[(navigator.language || "").slice(0, 2)] || "enUS";

async function api(action, { method = "GET", body, query = "", headers = {} } = {}) {
  const init = { method, headers: { ...headers }, cache: "no-store" };
  if (body !== undefined && !(body instanceof Blob)) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  } else if (body) {
    init.body = body;
  }
  try {
    const r = await fetch(`/api/studio/${action}${query}`, init);
    return await r.json().catch(() => ({ ok: false, error: `The server answered ${r.status}. Please try again.` }));
  } catch (e) {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

// ---- Loading ----

async function load(voiceId) {
  const [state, data] = await Promise.all([
    api("state", { query: voiceId ? `?voice=${encodeURIComponent(voiceId)}` : "" }),
    lines ? Promise.resolve(lines) : refreshCatalog(fetch).then(r => r.data),
  ]);
  lines = data;
  st = state;
  if (st.ok && applyReturnContext) {
    applyReturnContext = false;
    const requestedLang = lines?.languages.some(l => l.locale === returnQuery.get("lang") && l.lines > 0) ? returnQuery.get("lang") : null;
    const context = studioContext(st, { lang: requestedLang, voice: returnQuery.get("voice") });
    if (context.locale) browseLocale = context.locale;
    if (context.voice && context.voice !== st.voice) {
      return load(context.voice); // retrieve this voice's own takes; never relabel another voice's recordings
    }
    if (!context.voice) { st.voice = null; st.takes = {}; }
  }
  if (st.ok) {
    st.takes ||= {};
    st.voices ||= [];
    mine = new Set(store.get(mineKey()) || []);
  }
  if (lines && !lines.languages.some(l => l.locale === browseLocale && l.lines > 0)) browseLocale = "enUS";
  buildItems();
  render();
  if (focusLine) {
    const it = byId(focusLine);
    if (it) {
      open.add(it.id);
      const position = queue().list.findIndex(i => i.id === it.id);
      if (position >= 0) nextPos = position;
      render();
      [...app.querySelectorAll("[data-row]")].find(el => el.dataset.row === it.id)?.scrollIntoView({ block: "center" });
    } else { catalogNote = "That recording line isn't in the current catalog. Find another line below."; render(); }
    focusLine = null;
  }
  await loadReviewStatus();
  // Claim a zone (zone-claims.js): drawn once the list comes back, so the lines never wait for it.
  if (st.ok && lines) { await loadZones(st.voice, locale()); render(); }
}

async function loadReviewStatus() {
  const loc = locale();
  reviewStatus = null; reviewLocale = loc;
  if (loc === "enUS") return;
  try {
    const res = await fetch(`/translate/data/${encodeURIComponent(loc)}/status.json`, { cache: "no-store" });
    const data = res.ok ? await res.json() : null;
    if (reviewLocale !== loc || locale() !== loc) return;
    reviewStatus = data;
  } catch { /* Existing scripts remain usable when review status is unavailable. */ }
  if (locale() === loc) render();
}

async function refreshScript() {
  if (refreshing || busy.size) return;
  const activeLine = queue().list[nextPos]?.id;
  refreshing = true; render();
  const result = await refreshCatalog(fetch, lines);
  lines = result.data;
  catalogNote = result.fresh ? "Script refreshed from the current catalog. Your uploaded takes are kept; changed text is marked below."
    : "Couldn't refresh the catalog. The script already shown and your uploaded takes are kept. Try again later.";
  refreshing = false; buildItems();
  const position = queue().list.findIndex(i => i.id === activeLine);
  if (position >= 0) nextPos = position;
  render();
  await loadReviewStatus();
}

function signInHref() {
  const q = new URLSearchParams(location.search);
  const linkedLang = q.get("lang");
  q.set("lang", locale());
  if (currentVoice()) q.set("voice", st.voice);
  else if (linkedLang !== locale()) q.delete("voice");
  const line = queue().list[nextPos]?.id;
  if (line) q.set("line", line);
  return studioSignIn(`?${q}`);
}

function currentVoice() { return st.voices?.find(v => v.id === st.voice) || null; }
const locale = () => currentVoice()?.locale || browseLocale;

function buildItems() {
  items = [];
  if (!lines || !st?.ok) return;
  const loc = locale();
  for (const g of lines.groups) {
    for (const s of g.stories) {
      s.lines.forEach((l, i) => {
        const text = l.text[loc];
        items.push({
          id: l.id, group: g.name, story: s, child: i > 0 || l.id.includes("#"),
          name: s.name[loc] || s.name.enUS, q: l.q ? (l.q[loc] || l.q.enUS) : null,
          text, english: l.text.enUS, englishQuestion: l.q?.enUS, hash: l.hash[loc], hints: l.hints[loc] || [], file: l.file,
          target: text ? text.split(/\s+/).length / WORDS_PER_SECOND : 0,
        });
      });
    }
  }
}

function stateOf(it) {
  if (!it.text) return "none";
  const t = st.takes[it.id];
  if (!t) return "missing";
  if (t.hash !== it.hash) return "stale";
  return t.checks?.warnings?.length ? "warn" : "ok";
}
const isDone = it => ["ok", "warn"].includes(stateOf(it));

// ---- Checks (the narrator guide) ----

// The file's kind, rate and channels from its header (headerInfo), and the kinds the game can't play, which become
// .mp3 here before they go up (CONVERT): takecheck.js, shared with "Lend your voice".

async function analyze(file, it) {
  const buf = await file.arrayBuffer();
  const head = headerInfo(new Uint8Array(buf.slice(0, 65536)));
  if (!head) return { error: "We take .mp3, .m4a, .ogg, .wav, .flac and .webm files. Export the recording in one of those." };
  let decoded;
  try {
    decoded = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(buf.slice(0));
  } catch (e) {
    if (CONVERT.has(head.kind)) {
      return { error: "This browser couldn't read the file, so it can't turn it into an .mp3. Export it as .mp3 or .ogg and try again." };
    }
    return { buf, checks: { warnings: ["unchecked"] } };   // e.g. a browser without Ogg Vorbis: we check it at review
  }
  const fs = decoded.sampleRate, n = decoded.length, duration = n / fs;
  const chans = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  if (duration > MAX_SECONDS) return { error: "This file is longer than 4 minutes, which is far longer than any line." };
  // Every check is in quality.js: below the bar the take is refused, with what to change; near it, a warning.
  const m = measure(chans, fs);
  if (duration < 0.3 || m.peak < -50) return { error: "This file is silent or almost empty. Check the export and try again." };
  const rate = head.rate || null, channels = head.channels || decoded.numberOfChannels;
  const bar = verdict(m, { sourceRate: rate, channels, target: it.target || null });
  if (bar.refuse.length) return { error: bar.refuse.map(k => refusalText(k, { ...m, rate })).join(" ") };
  const w = bar.warn;
  const checks = { channels, rate: rate || 0, lufs: m.lufs, peak: m.peak, lead: m.lead, tail: m.tail, duration, bandwidth: m.bandwidth,
                   snr: m.snr, warnings: w };
  if (!CONVERT.has(head.kind)) return { buf, checks };
  // Converted: the file that goes up is mono at 44.1 or 48 kHz, so those two warnings no longer apply.
  const mp3 = await toMp3(buf, rate).catch(() => null);
  if (!mp3) return { error: "Couldn't turn this file into an .mp3 in this browser. Export it as .mp3 or .ogg and try again." };
  return { buf: mp3.buf, checks: { ...checks, channels: 1, rate: mp3.rate, warnings: w.filter(k => k !== "stereo" && k !== "rate") } };
}

// Why a take is below the bar, and what to do about it (quality.js verdict keys). m: measure() plus rate and lufs.
function refusalText(key, m) {
  const n = (v, d = 0) => Number(v).toFixed(d).replace("-", "−");
  return {
    lowrate: `This was recorded at ${n(m.rate / 1000, 1)} kHz; narration needs 44.1 or 48 kHz. Set your recording app to 44.1 kHz (in Audacity: Project Rate, bottom left), record the line again and export it.`,
    narrow: `This sounds like a phone call, a voice message or a low-quality export: there's no sound above ${n(m.bandwidth / 1000, 1)} kHz. Record in a recording app at 44.1 or 48 kHz and export a WAV, or an MP3 at 128 kbps or more.`,
    clipping: `This take is clipping: ${n(m.clipped * 100, 1)}% of it hits the top and distorts. Turn the microphone gain down so your loudest words peak around −6 dB, and record it again (turning it down afterwards doesn't undo the distortion).`,
    tooquiet: `This is very quiet (${n(m.lufs, 1)} LUFS). Turn the microphone gain up or get closer, and record again aiming for about −16 LUFS.`,
    noisy: `There's a lot of background noise: the quiet between words is only ${n(m.snr)} dB below your voice (aim for 45 or more). Record somewhere quieter (soft furnishings help; switch off fans), get closer to the microphone, and record it again.`,
  }[key] || key;
}

function warningText(key, c, it) {
  const n = (v, d = 1) => Number(v).toFixed(d).replace("-", "−");
  return {
    stereo: "Stereo. The guide asks for mono.",
    rate: `${c.rate} Hz. The guide asks for 44.1 or 48 kHz.`,
    quiet: `Quiet (${n(c.lufs)} LUFS). Aim for about −16.`,
    loud: `Loud (${n(c.lufs)} LUFS). Aim for about −16.`,
    clip: "Peaks reach 0 dB, so it may be clipping.",
    peak: `Peaks at ${n(c.peak)} dB. Keep them at −1 or lower.`,
    lead: `${n(c.lead)} s of silence at the start. Trim it to under a second.`,
    tail: `${n(c.tail)} s of silence at the end. Trim it to under a second.`,
    short: `Much shorter than the text (${fmtTime(c.duration)} for about ${fmtTime(it.target)}). The end may be cut off, or this is the recording for another line.`,
    long: `Much longer than the text (${fmtTime(c.duration)} for about ${fmtTime(it.target)}). Check it's the right line, or trim long pauses.`,
    unchecked: "This browser couldn't check the file. We'll check it when we review.",
    hiss: `Some background noise: the quiet between words is ${n(c.snr, 0)} dB below your voice. A quieter room, or getting closer to the mic, would help.`,
  }[key] || key;
}

// ---- Uploading ----

// Signed in with no voice yet: the first upload starts one, in the language on show. Returns false (with
// the error on the line) if it couldn't.
async function ensureVoice(it) {
  if (currentVoice()) return true;
  if (st.voices.length >= st.limits.voices) {
    errors[it.id] = "You already have two voices. Choose a voice to record in its language, or ask us on Discord about adding another.";
    render(); return false;
  }
  const who = (st.user?.display_name || "").trim().slice(0, 50);
  const base = who ? `${who}'s voice` : "My voice";
  const name = st.voices.some(v => v.name.toLowerCase() === base.toLowerCase()) ? `${base} (${browseLocale})` : base;
  const res = await api("voice", { method: "POST", body: { name, locale: browseLocale } });
  if (!res.ok) { errors[it.id] = res.error; render(); return false; }
  store.set(`lf-studio-mine-${res.id}`, [...mine]);   // stories ticked before the voice existed
  await load(res.id);
  return true;
}

async function upload(it, file) {
  delete errors[it.id];
  if (!(await ensureVoice(it))) return "bad";
  it = byId(it.id) || it;
  const tooBig = `That file is over ${st.limits.bytes / 1048576} MB. Export it as .mp3 or .ogg to make it smaller.`;
  if (file.size > st.limits.bytes * 8) {   // a .wav shrinks a lot once it's an .mp3; the limit applies to what goes up
    errors[it.id] = tooBig;
    render();
    return "bad";
  }
  busy.add(it.id);
  render();
  const a = await analyze(file, it);
  if (!a.error && a.buf.byteLength > st.limits.bytes) a.error = tooBig;
  if (a.error) {
    busy.delete(it.id);
    errors[it.id] = a.error;
    render();
    return "bad";
  }
  const voice = st.voice;
  let res;
  for (;;) {   // over the per-minute limit (a zip upload running alongside): wait it out, as the zip upload does
    res = await api("take", {
      method: "PUT", query: `?voice=${encodeURIComponent(voice)}&line=${encodeURIComponent(it.id)}`, body: new Blob([a.buf]),
      headers: { "X-File-Name": encodeURIComponent(file.name.slice(0, 120)), "X-Checks": encodeURIComponent(JSON.stringify(a.checks)),
                 "X-Text-Hash": it.hash, "X-CRC32": crcHex(crc32(new Uint8Array(a.buf))) },
    });
    if (res.ok || !res.retryAfter) break;
    await new Promise(r => setTimeout(r, Math.min(60, res.retryAfter) * 1000));
  }
  busy.delete(it.id);
  if (!res.ok) { errors[it.id] = res.error; render(); return "bad"; }
  if (voice !== st.voice) return "ok";   // the page moved to another voice while this one went up
  st.takes[it.id] = res.take;
  const v = currentVoice();
  if (v) v.files = Object.keys(st.takes).length;
  render();
  return a.checks.warnings.length ? "warn" : "ok";
}

async function remove(it) {
  const res = await api("remove", { method: "POST", body: { voice: st.voice, line: it.id } });
  if (!res.ok) { errors[it.id] = res.error; render(); return; }
  delete st.takes[it.id];
  render();
}

// "Upload many recordings at once": a zip, a folder or a returned test pack, checked here first (/js/bulk-upload.js).
const bulkBox = voiceUpload({
  voice: () => currentVoice(),
  languageName: () => lines.languages.find(l => l.locale === currentVoice().locale)?.name || currentVoice().locale,
  items: () => items.map(it => ({ ...it, hash: it.hash || null })),
  takes: () => st.takes,
  get maxBytes() { return st.limits.bytes; },
  analyze, warningText,
  onTake(voiceId, id, take) {
    if (voiceId !== st.voice) return;   // saved to the voice the upload started on; the page shows another now
    st.takes[id] = take;
    delete errors[id];
    const v = currentVoice();
    if (v) v.files = Object.keys(st.takes).length;
    render();
  },
});

// ---- Drawing ----

function render() {
  if (!st || !st.ok) {
    app.innerHTML = `<h1>Upload your recordings</h1><div class="fb-done st-box"><p>${esc(st?.error || "Couldn't load the page.")}</p>
      <p>You can also send a folder link with the <a href="/voices/submit">submission form</a>.</p></div>`;
    return;
  }
  if (!lines) { app.innerHTML = `<h1>Upload your narration</h1><p class="pitch">Couldn't load the list of lines. Please reload the page.</p>`; return; }
  if (st.signedIn && creating) return renderNewVoice();
  renderWorkspace();
}

function intro() {
  return `<h1>Upload your narration</h1>
    <p class="st-intro">Every line is below with the words to read. Record it in your own setup, then drop the file on its
      line; any name works. We check each one against the <a href="/voices/guide">narrator guide</a>. You don't need every
      line: anything you leave out plays in the default voice. Come back any time, then send your voice to us for review.</p>`;
}

// "Lend your voice" (LOR-230, /voices/lend): read a short script for about 3 minutes and we make a narrator voice from
// it. Hidden until the first lent voice has been made end to end on the GPU (the page itself works at its address):
// set LEND_VOICE to true to show this card to everyone; /voices/studio?lend=1 shows it now.
const LEND_VOICE = false;
function lendHtml() {
  if (!LEND_VOICE && !new URLSearchParams(location.search).has("lend")) return "";
  return `<aside class="st-lend"><p><strong>No time to record every line?</strong> Lend us your voice instead: read a short
    script for about 3 minutes, on your phone if you like, and we'll make a narrator voice from it, credited to you.</p>
    <a class="btn-small" href="/voices/lend">Lend your voice</a></aside>`;
}

// How to make a take we can use, where the file goes in.
function howToRecordHtml() {
  return `<p class="st-howto">Record in a proper app (<a href="https://www.audacityteam.org/" target="_blank" rel="noopener">Audacity</a>
    is free) with a decent microphone in a quiet room, at 44.1 or 48 kHz, then export an MP3 or WAV.
    <a href="/voices/guide#specs">How to record</a>.</p>`;
}

function languageOptions(selected) {
  return lines.languages.filter(l => l.lines > 0).map(l =>
    `<option value="${esc(l.locale)}"${l.locale === selected ? " selected" : ""}>${esc(l.name)}${l.draft ? " · draft text" : ""} · ${l.lines} lines</option>`).join("");
}

function renderNewVoice() {
  const has = st.voices.length;
  app.innerHTML = `${intro()}<form class="fb-form st-box" id="st-new">
    <h2>${has ? "A new voice" : "Name your voice"}</h2>
    <label class="fb-field"><span>Voice name</span>
      <input type="text" name="name" maxlength="60" required placeholder="e.g. Tales of the Eastern Kingdoms">
      <small>The title players pick in the voice list. You can change it later.</small></label>
    <label class="fb-field"><span>Language</span><select name="locale">${languageOptions(browseLocale)}</select>
      <small>One voice, one language. The lines show their text in the language you pick; a language with draft text only
        has the lines translated so far. To narrate in two languages, make a voice for each.</small></label>
    <div class="fb-actions"><button type="submit" class="btn-download">Start</button>
      ${has ? `<button type="button" class="st-b ghost" id="st-cancel">Cancel</button>` : ""}
      <p class="fb-status" id="st-new-status" role="status" hidden></p></div></form>`;
  const form = document.getElementById("st-new");
  document.getElementById("st-cancel")?.addEventListener("click", () => { creating = false; render(); });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const res = await api("voice", { method: "POST", body: d });
    if (res.ok) { creating = false; await load(res.id); return; }
    const s = document.getElementById("st-new-status"); s.textContent = res.error; s.hidden = false;
  });
}

function filtered() {
  const q = view.q.trim().toLowerCase();
  return items.filter(it => {
    if (view.group && it.group !== view.group) return false;
    if (view.zone && it.story.zone !== view.zone) return false;
    if (view.voice && it.story.voice !== view.voice) return false;
    if (view.mine && !mine.has(it.story.key)) return false;
    const s = stateOf(it);
    if (view.show === "missing" && s !== "missing") return false;
    if (view.show && view.show !== "missing" && s !== view.show) return false;
    if (q && ![it.name, it.q, it.text, it.story.name.enUS].some(t => t && t.toLowerCase().includes(q))) return false;
    return true;
  });
}

// A first evening's work for a new narrator, instead of every line at once: the main story of each starting zone and
// capital (21 stories, about 20 minutes of reading). Voices can be partial, so even a few of these are worth sending.
const STARTER_GROUPS = ["Starting zones", "Capitals"];
const isStarter = it => STARTER_GROUPS.includes(it.group) && !it.child && it.text;

// The next-line box goes through your claimed zone first (zone-claims.js), then your picked stories, then the starter
// set, then everything else.
function queue() {
  const todo = items.filter(it => ["missing", "stale"].includes(stateOf(it)));
  const claim = activeClaim();
  const zoned = claim && claim.voice === st.voice ? todo.filter(it => it.story.zone === claim.zone) : [];
  if (zoned.length) return { list: zoned, zone: claim.name };
  const picked = todo.filter(it => mine.has(it.story.key));
  if (picked.length) return { list: picked, mine: true };
  const starter = todo.filter(isStarter);
  if (starter.length) return { list: starter, starter: items.filter(isStarter).length };
  return { list: todo, mine: false };
}

function hintsHtml(it) {
  return it.hints.length ? `<div class="st-hints">${it.hints.map(([n, say]) => `<span><b>${esc(n)}</b> <em>${esc(say)}</em></span>`).join("")}</div>` : "";
}

function sourceToolsHtml(it) {
  const note = scriptReviewNote(reviewLocale === locale() ? reviewStatus : null, it.story.key, locale());
  return `<div class="st-source-tools">
    <div class="st-source-links"><span>Entry <code>${esc(it.story.key)}</code> · Line <code>${esc(it.id)}</code></span>
      ${locale() !== "enUS" ? `<a href="${esc(editorLink(it, locale(), st.voice))}">Check or correct this translation</a>` : ""}</div>
    <details class="st-original"><summary>English original</summary>
      ${it.englishQuestion ? `<p><strong>${esc(it.englishQuestion)}</strong></p>` : ""}
      <div class="st-script">${it.english ? esc(it.english) : "English original unavailable. Try refreshing the script."}</div></details>
    <p class="st-note">${esc(note)}</p></div>`;
}

function recordingTextHtml() {
  return `<aside class="st-text-help"><p><strong>Read the script shown here.</strong> It comes from the current recording catalog.
    If a line needs a correction, open its translation editor before recording it.
    <a href="/translate#recording">How corrections reach recording</a>.</p>
    <details><summary>After correcting or checking a translation</summary><p>“Looks right” saves your check; it doesn't publish it or change this recording script.
      Saved edits are reviewed, then merged and released. They appear here when the recording catalog is updated.
      After a correction, use <b>Refresh script</b> and check that your wording is shown before recording that line.
      You can record other checked lines while you wait; your existing takes are kept.
      For place and character names, use the names in the game for this language, such as <b>Hurlevent</b> in French.
      <a href="/translate#names">Naming guidance</a>.</p></details>
    <button class="st-b" type="button" id="st-refresh"${refreshing || busy.size ? " disabled" : ""}>${refreshing ? "Refreshing…" : "Refresh script"}</button>
    ${catalogNote ? `<p class="st-note" role="status">${esc(catalogNote)}</p>` : ""}</aside>`;
}

function nextHtml() {
  const { list, mine: fromMine, starter, zone } = queue();
  if (!list.length) return `<section class="st-next"><p class="st-done-all">Every line with text in this language has a recording.
    Send your voice below whenever you're ready.</p></section>`;
  nextPos = Math.max(0, Math.min(nextPos, list.length - 1));
  const it = list[nextPos];
  const label = it.q ? esc(it.q) : "The story";
  return `<section class="st-next" data-line="${esc(it.id)}">
    <div class="st-next-h"><span class="st-eyebrow">${starter
      ? `Starter set · ${starter - list.length} of ${starter} recorded`
      : zone ? `Your zone, ${esc(zone)} · ${lines_(list.length)} still to record`
      : `Next ${fromMine ? "of your lines" : "line to record"} · ${lines_(list.length)} still to record`}</span>
      <span><button class="st-b ghost" type="button" data-next="-1"${nextPos ? "" : " disabled"}>‹ Previous</button>
      <button class="st-b ghost" type="button" data-next="1"${nextPos < list.length - 1 ? "" : " disabled"}>Skip ›</button></span></div>
    ${starter ? `<p class="st-starter">Start with the starting zones and capitals: ${starter} short stories, about
      ${Math.round(items.filter(isStarter).reduce((t, i) => t + i.target, 0) / 60)} minutes of reading. Record as few as
      you like; every line you send plays in game, and the rest stay in the default voice. Tick <b>Mine</b> on any story
      below to record that instead.</p>` : ""}
    <h2>${esc(it.name)} <span>· ${label}</span></h2>
    <div class="st-meta2">${it.text.split(/\s+/).length} words · about ${fmtTime(it.target)}${it.story.voice ? ` · suggested voice: ${esc(VOICES[it.story.voice] || it.story.voice)}` : ""}</div>
    ${stateOf(it) === "stale" ? `<p class="st-note stale">We reworded this line after you uploaded it. Please record the new text.</p>` : ""}
    <div class="st-script">${esc(it.text)}</div>
    ${hintsHtml(it)}
    ${sourceToolsHtml(it)}
    ${!st.signedIn ? `<div class="st-drop"><strong>Recorded it? Upload it here</strong>
      <p><a class="btn-small" href="${esc(signInHref())}">Sign in to upload</a></p>
      <p>A Lore Forever account keeps your recordings yours, so you can come back to them. It takes a minute with Google.</p>
      ${howToRecordHtml()}</div>`
    : `<div class="st-drop" data-drop="${esc(it.id)}">
      ${busy.has(it.id) ? `<strong>Checking and uploading...</strong>`
      : `<strong>Drop your recording of this line here</strong>
        <p>or <button class="st-b" type="button" data-choose="${esc(it.id)}">choose a file</button>. The next line comes up once it's in.</p>
        ${howToRecordHtml()}`}
      ${errors[it.id] ? `<p class="st-note bad">${esc(errors[it.id])}</p>` : ""}
    </div>`}</section>`;
}

function rowHtml(it) {
  const s = stateOf(it), t = st.takes[it.id], label = it.q ? `<span class="st-label q">${esc(it.q)}</span>` : `<span class="st-label">The story</span>`;
  const meta = [], notes = [];
  if (t && s !== "none") {
    meta.push(`<span class="st-fname">${esc(t.file_name || it.file + "." + t.ext)}</span>`);
    if (t.checks?.duration) meta.push(`<span>${fmtTime(t.checks.duration)} · text about ${fmtTime(it.target)}</span>`);
    if (Number.isFinite(t.checks?.lufs)) meta.push(`<span>${t.checks.lufs.toFixed(1).replace("-", "−")} LUFS · ${t.checks.channels === 1 ? "mono" : "stereo"}${t.checks.rate ? ` ${t.checks.rate / 1000} kHz` : ""}</span>`);
  } else if (it.text) {
    meta.push(`<span>${it.text.split(/\s+/).length} words · about ${fmtTime(it.target)}</span>`);
  }
  meta.push(`<button class="st-b ghost" type="button" data-text="${esc(it.id)}" style="padding:0">${open.has(it.id) ? "Hide text" : "Show text"}</button>`);
  if (s === "warn") for (const w of t.checks.warnings) notes.push(`<p class="st-note warn">${esc(warningText(w, t.checks, it))}</p>`);
  if (s === "stale") notes.push(`<p class="st-note stale">We reworded this line after you uploaded it. Please record the new text. Until then this line plays in the default voice.</p>`);
  if (s === "none") notes.push(`<p class="st-note">Not translated yet. <a href="${esc(editorLink(it, locale(), st.voice))}">Help translate it</a>, then it can be recorded.</p>`);
  if (errors[it.id]) notes.push(`<p class="st-note bad">${esc(errors[it.id])}</p>`);
  let acts = "";
  if (!st.signedIn) acts = "";   // the sign-in prompt is in the next-line box and the send section
  else if (busy.has(it.id)) acts = `<span class="st-slot">Checking and uploading...</span>`;
  else if (s === "ok" || s === "warn") acts = `<button class="st-play" type="button" data-play="${esc(it.id)}" aria-label="Play">▶</button>
    <button class="st-b ghost" type="button" data-choose="${esc(it.id)}">Replace</button>
    <button class="st-b ghost" type="button" data-remove="${esc(it.id)}">Remove</button>`;
  else if (s !== "none") acts = `<span class="st-slot">Drop a file here or <button class="st-b" type="button" data-choose="${esc(it.id)}">Upload</button></span>`;
  return `<div data-row="${esc(it.id)}" class="st-row${it.child ? " child" : ""}"${s !== "none" && st.signedIn ? ` data-drop="${esc(it.id)}"` : ""}>
    <span class="st-dot ${s === "missing" ? "" : s}" title="${{ ok: "Uploaded", warn: "Needs a look", stale: "Text changed", missing: "Missing", none: "Not translated yet" }[s]}"></span>
    <div class="st-what">${label}<span class="st-meta">${meta.join("")}</span>${notes.join("")}</div>
    <div class="st-acts">${acts}</div>
    ${open.has(it.id) ? `${it.text ? `<div class="st-script">${esc(it.text)}</div>${hintsHtml(it)}` : ""}${sourceToolsHtml(it)}` : ""}</div>`;
}

// The voice bar: the voice and its language, or (no voice yet) the language picker and how a voice starts.
function voiceBarHtml(v, lang) {
  if (!v) {
    return `<div class="st-voicebar">
      <span class="st-lang"><label for="st-locale">Language:</label> <select id="st-locale">${languageOptions(browseLocale)}</select></span>
      <span>${st.signedIn ? (st.voices.length ? "No voice selected in this language. Your first upload starts a new voice if there is room." : "Your first upload starts your voice. You can name it any time.")
        : `Have a look around. <a href="${esc(signInHref())}">Sign in with Google</a> to upload.`}</span>
      ${st.signedIn && st.voices.length < st.limits.voices ? `<button class="st-b ghost" type="button" id="st-new-voice">+ New voice</button>` : ""}
      ${st.voices.length ? `<label>Your voices: <select id="st-voice"><option value="">Choose a voice</option>${st.voices.map(x => `<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.locale)}</option>`).join("")}</select></label>` : ""}</div>`;
  }
  const voiceSelect = st.voices.length > 1
    ? `<select id="st-voice" aria-label="Voice">${st.voices.map(x => `<option value="${esc(x.id)}"${x.id === v.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`
    : `<strong>${esc(v.name)}</strong>`;
  const status = v.status === "pending" ? " · sent for review" : "";
  return `<div class="st-voicebar">
      <span>Voice: ${renaming ? `<input id="st-rename" maxlength="60" value="${esc(v.name)}" aria-label="Voice name"> <button class="st-b" type="button" id="st-rename-save">Save</button>` : voiceSelect}</span>
      ${renaming ? "" : `<button class="st-b ghost" type="button" id="st-rename-open">Rename</button>`}
      <span class="st-lang">Language: <b>${esc(lang?.name || v.locale)}</b>${lang?.draft ? " (draft text)" : ""}${status}</span>
      ${st.voices.length < st.limits.voices ? `<button class="st-b ghost" type="button" id="st-new-voice">+ New voice</button>` : ""}
    </div>${racesHtml(v)}`;
}

// Optional: the races whose stories this voice suits. Players who tick "Prefer voices that suit the race" in the
// add-on hear it first for those stories (it goes in the pack's .toc as X-LoreForever-Races).
function racesHtml(v) {
  const has = new Set(String(v.races || "").split(","));
  return `<div class="st-races"><span>Your voice suits:</span>
    ${Object.entries(VOICES).map(([k, name]) => `<label class="st-race"><input type="checkbox" data-race="${esc(k)}"${has.has(k) ? " checked" : ""}> ${esc(name)}</label>`).join("")}
    <small>Optional. Players can ask for voices that suit a story's race, so an orc voice reads orc lore first.</small></div>`;
}

function renderWorkspace() {
  const v = currentVoice(), lang = lines.languages.find(l => l.locale === locale());
  const withText = items.filter(i => i.text), done = withText.filter(isDone).length;
  const perGroup = lines.groups.map(g => {
    const gi = withText.filter(i => i.group === g.name);
    return gi.length ? `${GROUP_SHORT[g.name] || g.name} ${gi.filter(isDone).length}/${gi.length}` : "";
  }).filter(Boolean).join(" · ");
  const counts = { missing: 0, warn: 0, ok: 0, stale: 0 };
  for (const it of withText) counts[stateOf(it)]++;
  const shown = filtered();
  const mineLines = items.filter(i => mine.has(i.story.key)).length;
  // Until the starter set is recorded, the bar measures that, not every line (LOR-170: 840 lines put people off).
  const starterAll = items.filter(isStarter), starterDone = starterAll.filter(isDone).length;
  const starterLeft = Boolean(queue().starter);

  // Groups and stories of the filtered lines, in lines.json order.
  let list = "";
  for (const g of lines.groups) {
    const gi = shown.filter(i => i.group === g.name);
    if (!gi.length) continue;
    const all = withText.filter(i => i.group === g.name);
    list += `<section class="st-group"><div class="st-group-h"><h2>${esc(g.name)}</h2><span>${all.filter(isDone).length} of ${all.length} ·
      <button class="st-b ghost" type="button" data-pickall="${esc(g.name)}" style="padding:0 4px;color:var(--link)">Mark all as mine</button></span></div>`;
    for (const s of g.stories) {
      const si = gi.filter(i => i.story === s);
      if (!si.length) continue;
      const sAll = withText.filter(i => i.story === s);
      list += `<article class="st-story${mine.has(s.key) ? " mine" : ""}"><h3><label class="st-pick"><input type="checkbox" data-pick="${esc(s.key)}"${mine.has(s.key) ? " checked" : ""}> Mine</label>
        ${esc(s.name[locale()] || s.name.enUS)}<span class="n">${sAll.filter(isDone).length} of ${sAll.length}</span></h3>${si.map(rowHtml).join("")}</article>`;
    }
    list += `</section>`;
  }

  app.innerHTML = `${intro()}
    ${lendHtml()}
    ${voiceBarHtml(v, lang)}
    ${recordingTextHtml()}
    <ul class="st-spec"><li><b>.mp3</b>, <b>.m4a</b>, <b>.ogg</b>, <b>.wav</b>, <b>.flac</b> or <b>.webm</b></li><li><b>Mono</b>, 44.1 or 48 kHz</li>
      <li>About <b>−16 LUFS</b>, peaks ≤ −1 dB</li><li>Short silence at each end</li></ul>
    ${zonesHtml({ lines, takes: st.takes, signedIn: st.signedIn, signIn: signInHref(), displayName: st.user?.display_name })}
    ${nextHtml()}
    <section id="st-bulkup"></section>
    <div class="st-bar">
      <div class="st-progress">
        <div class="st-progress-top"><span>${starterLeft
          ? `<strong>${starterDone}</strong> of ${starterAll.length} starter stories · ${lines_(done)} in all`
          : `<strong>${done}</strong> of ${withText.length} lines`}</span><span>${esc(perGroup)}</span></div>
        <div class="st-track"><i style="width:${(starterLeft ? starterDone / starterAll.length
          : withText.length ? done / withText.length : 0) * 100}%"></i></div>
      </div>
      <a class="btn-download" href="#st-send">Send for review</a>
    </div>
    <div class="st-picker" role="search">
      <div class="st-field grow"><label for="st-q">Find a zone or line</label><input id="st-q" type="search" value="${esc(view.q)}" placeholder="Stormwind, Deadmines, Brotherhood..."></div>
      <div class="st-field"><label for="st-group">Group</label><select id="st-group"><option value="">All groups</option>
        ${lines.groups.map(g => `<option${view.group === g.name ? " selected" : ""}>${esc(g.name)}</option>`).join("")}</select></div>
      ${lines.zones?.length && zonesVisible() ? `<div class="st-field"><label for="st-zone">Zone</label><select id="st-zone"><option value="">All zones</option>
        ${lines.zones.map(z => `<option value="${esc(z.key)}"${view.zone === z.key ? " selected" : ""}>${esc(z.name[locale()] || z.name.enUS)}</option>`).join("")}</select></div>` : ""}
      <div class="st-field"><label for="st-svoice">Suggested voice</label><select id="st-svoice"><option value="">Any</option>
        ${[...new Set(items.map(i => i.story.voice).filter(Boolean))].map(k => `<option value="${esc(k)}"${view.voice === k ? " selected" : ""}>${esc(VOICES[k] || k)}</option>`).join("")}</select></div>
      <div class="st-field"><label for="st-show">Show</label><select id="st-show">
        ${[["", "All lines"], ["missing", `Missing · ${counts.missing}`], ["warn", `Need a look · ${counts.warn}`], ["ok", `Uploaded · ${counts.ok}`], ["stale", `Text changed · ${counts.stale}`]]
          .map(([k, t]) => `<option value="${k}"${view.show === k ? " selected" : ""}>${t}</option>`).join("")}</select></div>
      <label class="st-mine"><input id="st-mine" type="checkbox"${view.mine ? " checked" : ""}> Only my lines <span>(${mine.size} stories, ${mineLines} lines)</span></label>
      <p class="st-picker-note">Tick <b>Mine</b> on the stories you want to voice. The next-line box goes through those first.</p>
    </div>
    ${list || `<p class="st-empty">No lines match. Clear a filter to see more.</p>`}
    ${v ? testPackHtml(v) : ""}
    ${sendHtml(done, withText.length, counts)}`;
  bindWorkspace();
  bindZones({
    voiceId: () => st.voice, locale,
    startVoice: async () => ((await ensureVoice({ id: "zone" })) ? st.voice : null),
    voiceError: () => errors.zone,
    onZoneOnly: key => {
      view.zone = key;
      render();
      document.querySelector(".st-picker")?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    rerender: render,
  });
  const bulk = document.getElementById("st-bulkup");
  if (v) bulkBox.mount(bulk);
  else if (st.signedIn) {   // the zip box needs a voice to match files against: start one on request
    bulk.innerHTML = `<p class="st-note">Have a zip or folder of recordings already?
      <button class="st-b" type="button" id="st-start">Start my voice</button> and the box to drop it in appears here.</p>`;
  }
}

// "Download my test pack": the same choice of lines as the server's zip (testpack.js).
function testPackHtml(v) {
  const current = Object.fromEntries(items.filter(i => i.hash).map(i => [i.id, i.hash]));
  const plan = planPack(st.takes, current), n = plan.lines.length;
  const head = `<section class="st-testpack" id="st-testpack"><h2>Hear it in game</h2>`;
  const label = id => { const it = byId(id); return it ? esc(it.name) + (it.q ? `: ${esc(it.q)}` : "") : null; };
  const list = ids => { const l = ids.map(label).filter(Boolean); return l.slice(0, 8).join("; ") + (l.length > 8 ? `; and ${l.length - 8} more` : ""); };
  const them = k => (k === 1 ? "it" : "them");
  // Uploads from before the page converted .wav and .flac to .mp3 can't go in a pack until they're uploaded again.
  const older = plan.otherFormat.filter(id => !["mp3", "ogg"].includes(st.takes[id].ext));
  const names = plan.otherFormat.filter(id => !older.includes(id));
  const olderNote = older.length ? `<p class="st-note warn">${lines_(older.length)} left out: ${older.length === 1 ? "it's a" : "they're"}
    .wav or .flac from before this page turned those into .mp3. Upload ${them(older.length)} again to include ${them(older.length)}: ${list(older)}.</p>` : "";
  if (!n) return `${head}<p>Once you've uploaded a line, you can download a test pack of your recordings here and hear them
    in Lore Forever before you send anything.</p>${olderNote}</section>`;
  return `${head}
    <p>Play your own recordings in the game before you send them. The test pack has your ${lines_(n)}; every other line plays
      in the default voice. Only you can download it.</p>
    <p class="st-dl"><a class="btn-download" href="/api/studio/pack?voice=${encodeURIComponent(v.id)}">Download my test pack</a>
      <span>${lines_(n)} · .${plan.ext}</span></p>
    <ol>
      <li>Unzip it into <code>World of Warcraft\\_classic_beta_\\Interface\\AddOns</code>, so you have
        <code>AddOns\\${esc(packFolder(v.id))}</code>.</li>
      <li>Type <code>/reload</code> in game. After more uploads, download again, unzip over the old folder and <code>/reload</code>.</li>
      <li>Choose <b>${esc(v.name)} (test pack)</b> under Options › AddOns › Lore Forever › Narration voice.</li>
    </ol>
    ${names.length ? `<p class="st-note warn">${lines_(names.length)} left out: a pack holds one format and most of yours are
      .${plan.ext}. Upload ${them(names.length)} as .${plan.ext} to include ${them(names.length)}: ${list(names)}.</p>` : ""}
    ${olderNote}
    ${plan.stale.length ? `<p class="st-note stale">${lines_(plan.stale.length)} left out because we reworded ${plan.stale.length === 1 ? "it" : "them"}
      after you uploaded. Record the new text to put ${plan.stale.length === 1 ? "it" : "them"} back.</p>` : ""}
    <p class="st-note">The pack is just for you to test; everyone else hears your voice once you send it and it's published.
      Voice not in the list, or a line in the default voice? See <a href="/voices/guide#test">Hear your voice in game</a>.</p>
  </section>`;
}

// The narrator release, on the send form the first time (and again after it changes). The age box is its own
// required box, checked again by /api/studio/release: sending a voice is 18+ only.
function releaseHtml() {
  if (st.release.agreed) return "";
  return `<fieldset class="st-release"><legend>The narrator release</legend>
    <p class="vp-note">Sending lets us share these recordings in Lore Forever voice packs under CC BY-SA 4.0. It's one page
      in plain language: <a href="/voices/release" target="_blank">read the narrator release</a>. You agree once.</p>
    <label class="fb-check"><input type="checkbox" name="agree" required>
      <span>I've read and agree to the <a href="/voices/release" target="_blank">narrator release</a> (version ${esc(st.release.version)}).</span></label>
    <label class="fb-check"><input type="checkbox" name="adult" required>
      <span>I'm 18 or older.</span></label>
    <label class="fb-field"><span>Signature</span>
      <input type="text" name="signature" maxlength="100" required autocomplete="name" placeholder="Your full name">
      <small>Typing your full name here signs the release. We keep it with your agreement as proof of it and never
        publish it (<a href="/privacy" target="_blank">privacy</a>).</small></label></fieldset>`;
}

function sendHtml(done, total, counts) {
  if (!st.signedIn) return `<section class="st-send" id="st-send"><h2>Send for review</h2>
    <p>Upload as many lines as you like, hear them in game with your own test pack, then send them here. We listen
      to every line, build your pack, and list it on the Voices page with your name on it.</p>
    <p><a class="btn-small" href="${esc(signInHref())}">Sign in to start</a></p></section>`;
  if (sent) return `<section class="st-send" id="st-send"><h2>Sent for review</h2>
    <p>Thanks! We'll listen to your ${lines_(sent)}, build your pack and get back to you by email. You can keep uploading;
      send again when you've added more.</p><button class="st-b" type="button" id="st-send-again">Send again</button></section>`;
  return `<section class="st-send" id="st-send"><h2>Send for review</h2>
    <ul><li><strong>${lines_(done)}</strong> uploaded. The other ${total - done} play in the default voice.</li>
      ${counts.warn ? `<li>${lines_(counts.warn)} need${counts.warn === 1 ? "s" : ""} a look. You can send them anyway; we'll tell you if one won't work.</li>` : ""}
      ${counts.stale ? `<li>${lines_(counts.stale)} changed after you uploaded them, so they won't be in the pack until you record the new text.</li>` : ""}
      <li>We listen to every line, build your pack, and put it on your voice page.</li></ul>
    <form id="st-send-form">
      <label class="fb-field"><span>Credit line</span><input type="text" name="credit" maxlength="100" required
        value="${esc(st.user.display_name || "")}" placeholder="e.g. Narrated by Jane Doe, @janedoe, or Anonymous">
        <small>How players see your name in the voice picker and on this site. Type Anonymous to stay uncredited.</small></label>
      <label class="fb-field"><span class="fb-sub">Discord handle (optional)</span><input type="text" name="discord" maxlength="40" autocomplete="off" spellcheck="false"></label>
      <label class="fb-field"><span class="fb-sub">Anything else? (optional)</span><textarea name="note" rows="3" maxlength="2000"></textarea></label>
      ${releaseHtml()}
      <div class="fb-actions"><button type="submit" class="btn-download"${done ? "" : " disabled"}>Send ${lines_(done)} for review</button>
        <p class="fb-status" id="st-send-status" role="status" hidden></p></div>
    </form></section>`;
}

// ---- Events ----

function pickFile(it) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".mp3,.m4a,.ogg,.opus,.wav,.flac,.aac,.webm,audio/*";
  input.addEventListener("change", () => {
    if (input.files.length) upload(it, input.files[0]);
  });
  input.click();
}

const byId = id => items.find(i => i.id === id);

function setMine(keys, on) {
  for (const k of keys) on ? mine.add(k) : mine.delete(k);
  store.set(mineKey(), [...mine]);
  nextPos = 0;
  render();
}

function bindWorkspace() {
  const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);
  on("st-refresh", "click", refreshScript);
  on("st-voice", "change", e => { if (e.target.value) { sent = null; load(e.target.value); } });
  on("st-new-voice", "click", () => { creating = true; render(); });
  on("st-rename-open", "click", () => { renaming = true; render(); document.getElementById("st-rename")?.focus(); });
  on("st-rename-save", "click", async () => {
    const name = document.getElementById("st-rename").value;
    const res = await api("voice", { method: "POST", body: { id: st.voice, name } });
    if (res.ok) { currentVoice().name = name.trim(); renaming = false; render(); } else alert(res.error);
  });
  on("st-q", "input", e => { view.q = e.target.value; renderKeepFocus("st-q"); });
  on("st-group", "change", e => { view.group = e.target.value; render(); });
  on("st-zone", "change", e => { view.zone = e.target.value; render(); });
  on("st-svoice", "change", e => { view.voice = e.target.value; render(); });
  on("st-show", "change", e => { view.show = e.target.value; render(); });
  on("st-mine", "change", e => { view.mine = e.target.checked; render(); });
  on("st-send-again", "click", () => { sent = null; render(); });
  on("st-send-form", "submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    const d = Object.fromEntries(new FormData(e.target));
    const say = msg => { btn.disabled = false; const s = document.getElementById("st-send-status"); s.textContent = msg; s.hidden = false; };
    if (!st.release.agreed) {   // the release first, then the voice
      const r = await api("release", { method: "POST", body: { agree: !!d.agree, adult: !!d.adult, signature: d.signature, release: st.release.version } });
      if (!r.ok) return say(r.error);
      st.release.agreed = true;
    }
    const res = await api("send", { method: "POST", body: { voice: st.voice, credit: d.credit, discord: d.discord, note: d.note } });
    if (res.ok) { sent = res.lines; currentVoice().status = "pending"; render(); document.getElementById("st-send")?.scrollIntoView(); return; }
    say(res.error);
  });
  on("st-locale", "change", async e => {
    browseLocale = e.target.value; store.set("lf-studio-locale", browseLocale); nextPos = 0; buildItems(); render();
    await loadReviewStatus();
    await loadZones(null, browseLocale);   // the zone list in that language
    render();
  });
  for (const box of document.querySelectorAll("[data-race]")) {
    box.addEventListener("change", async () => {
      const races = [...document.querySelectorAll("[data-race]:checked")].map(b => b.dataset.race);
      const res = await api("voice", { method: "POST", body: { id: st.voice, races } });
      if (res.ok) currentVoice().races = res.races; else { box.checked = !box.checked; alert(res.error); }
    });
  }
  on("st-start", "click", async e => {
    e.target.disabled = true;
    if (!(await ensureVoice({ id: "start" }))) { e.target.disabled = false; alert(errors.start); }
  });
}

// Typing in the search box redraws the list; keep the caret where it was.
function renderKeepFocus(id) {
  const el = document.getElementById(id), pos = el?.selectionStart;
  render();
  const again = document.getElementById(id);
  if (again) { again.focus(); if (pos != null) again.setSelectionRange(pos, pos); }
}

app.addEventListener("click", e => {
  const b = e.target.closest("button, input[data-pick]");
  if (!b) return;
  const d = b.dataset;
  if (d.choose) pickFile(byId(d.choose));
  else if (d.remove) remove(byId(d.remove));
  else if (d.text) { open.has(d.text) ? open.delete(d.text) : open.add(d.text); render(); }
  else if (d.next) { nextPos += Number(d.next); render(); }
  else if (d.pick) setMine([d.pick], b.checked);
  else if (d.pickall) setMine(items.filter(i => i.group === d.pickall).map(i => i.story.key), true);
  else if (d.play) {
    const src = `/api/studio/audio?voice=${encodeURIComponent(st.voice)}&line=${encodeURIComponent(d.play)}&t=${encodeURIComponent(st.takes[d.play]?.created || "")}`;
    if (player.dataset.line === d.play && !player.paused) { player.pause(); return; }
    player.dataset.line = d.play;
    player.src = src;
    player.play().catch(() => {});
  }
});

// Drag and drop onto the next-line box or any line.
app.addEventListener("dragover", e => {
  const t = e.target.closest("[data-drop]");
  if (!t) return;
  e.preventDefault();
  t.classList.add("hot");
});
app.addEventListener("dragleave", e => { e.target.closest?.("[data-drop]")?.classList.remove("hot"); });
app.addEventListener("drop", e => {
  const t = e.target.closest("[data-drop]");
  if (!t) return;
  e.preventDefault();
  t.classList.remove("hot");
  const f = e.dataTransfer.files[0];
  if (f) upload(byId(t.dataset.drop), f);
});
// A file dropped anywhere else would open in the tab; stop that.
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => e.preventDefault());

load(new URLSearchParams(location.search).get("voice"));
