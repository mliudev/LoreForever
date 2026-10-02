// The upload page (/voices/studio.html). Contributors upload one recording per line and send their voice for review.
// Server: functions/api/studio/[action].js. Lines: /voices/lines.json (pipeline: voicepack clips).
//
// Before a file goes up, the browser checks it against the narrator guide (mono, 44.1/48 kHz, about -16 LUFS,
// peaks at -1 dB or lower, at most 0.3 s of silence at each end, a length that fits the text). Warnings never stop
// an upload; a file we can't use at all (silent, not audio, too long) is refused here and on the server.
// The game plays .mp3 and .ogg only, so a .wav or .flac is turned into a mono .mp3 here before it goes up (mp3.js).
// Each upload carries its CRC-32 for the test pack's zip.

import { planPack, packFolder } from "/voices/testpack.js";
import { crc32, crcHex } from "/voices/crc32.js";
import { toMp3 } from "/voices/mp3.js";
import { voiceUpload } from "/js/bulk-upload.js";

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
let view = { q: "", group: "", voice: "", show: "", mine: false };
let nextPos = 0;
let mine = new Set();   // story keys this person picked, per voice (kept in this browser)
const open = new Set(), busy = new Set(), errors = {};
let creating = false, renaming = false, sent = null;

const lines_ = n => `${n} line${n === 1 ? "" : "s"}`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtTime = s => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

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
    lines ? Promise.resolve(lines) : fetch("/voices/lines.json", { cache: "no-cache" }).then(r => r.json()).catch(() => null),
  ]);
  lines = data;
  st = state;
  if (st.ok && st.voice) mine = new Set(store.get(`lf-studio-mine-${st.voice}`) || []);
  buildItems();
  render();
}

function currentVoice() { return st.voices?.find(v => v.id === st.voice) || null; }

function buildItems() {
  items = [];
  const v = st?.voice && currentVoice();
  if (!lines || !v) return;
  const loc = v.locale;
  for (const g of lines.groups) {
    for (const s of g.stories) {
      s.lines.forEach((l, i) => {
        const text = l.text[loc];
        items.push({
          id: l.id, group: g.name, story: s, child: i > 0 || l.id.includes("#"),
          name: s.name[loc] || s.name.enUS, q: l.q ? (l.q[loc] || l.q.enUS) : null,
          text, hash: l.hash[loc], hints: l.hints[loc] || [], file: l.file,
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

// Sample rate and channels from the file header, before any browser resampling.
function headerInfo(b) {
  const ascii = (i, n) => String.fromCharCode(...b.slice(i, i + n));
  const u16 = i => b[i] | (b[i + 1] << 8), u32 = i => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") {
    for (let o = 12; o + 8 < b.length;) {
      const size = u32(o + 4);
      if (ascii(o, 4) === "fmt ") return { kind: "wav", channels: u16(o + 10), rate: u32(o + 12) };
      o += 8 + size + (size & 1);
    }
    return { kind: "wav" };
  }
  if (ascii(0, 4) === "fLaC") return { kind: "flac", rate: (b[18] << 12) | (b[19] << 4) | (b[20] >> 4), channels: ((b[20] >> 1) & 7) + 1 };
  if (ascii(0, 4) === "OggS") {
    const p = 27 + b[26];
    return ascii(p + 1, 6) === "vorbis" ? { kind: "ogg", channels: b[p + 11], rate: u32(p + 12) } : { kind: "ogg" };
  }
  let o = 0;
  if (ascii(0, 3) === "ID3") o = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
  for (; o + 4 < b.length; o++) {
    if (b[o] === 0xff && (b[o + 1] & 0xe0) === 0xe0) {
      const ver = (b[o + 1] >> 3) & 3, idx = (b[o + 2] >> 2) & 3;
      const table = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }[ver];
      if (!table || idx === 3) continue;
      return { kind: "mp3", rate: table[idx], channels: (b[o + 3] >> 6) === 3 ? 1 : 2 };
    }
    if (o > 8192 && ascii(0, 3) !== "ID3") break;
  }
  return ascii(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) ? { kind: "mp3" } : null;
}

// BS.1770 K-weighting as two biquads for sample rate fs (the same constants as libebur128).
function kFilters(fs) {
  let K = Math.tan(Math.PI * 1681.974450955533 / fs), Q = 0.7071752369554196;
  const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0],
                  a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  K = Math.tan(Math.PI * 38.13547087602444 / fs); Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  const hp = { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, hp];
}

function biquad(x, { b, a }) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// Integrated loudness in LUFS (400 ms blocks, 75% overlap, absolute and relative gates).
function loudness(channels, fs) {
  const [shelf, hp] = kFilters(fs);
  const weighted = channels.map(c => biquad(biquad(c, shelf), hp));
  const block = Math.round(0.4 * fs), hop = Math.round(0.1 * fs), z = [];
  for (let s = 0; s + block <= weighted[0].length; s += hop) {
    let sum = 0;
    for (const w of weighted) { let e = 0; for (let i = s; i < s + block; i++) e += w[i] * w[i]; sum += e / block; }
    z.push(sum);
  }
  const L = e => -0.691 + 10 * Math.log10(e);
  const gated = z.filter(e => L(e) > -70);
  if (!gated.length) return -Infinity;
  const rel = L(gated.reduce((a, b) => a + b, 0) / gated.length) - 10;
  const kept = gated.filter(e => L(e) > rel);
  return L(kept.reduce((a, b) => a + b, 0) / kept.length);
}

async function analyze(file, it) {
  const buf = await file.arrayBuffer();
  const head = headerInfo(new Uint8Array(buf.slice(0, 65536)));
  if (!head) return { error: "We take .mp3, .ogg, .wav or .flac files. Export the recording in one of those." };
  let decoded;
  try {
    decoded = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(buf.slice(0));
  } catch (e) {
    if (head.kind === "wav" || head.kind === "flac") {
      return { error: "This browser couldn't read the file, so it can't turn it into an .mp3. Export it as .mp3 or .ogg and try again." };
    }
    return { buf, checks: { warnings: ["unchecked"] } };   // e.g. a browser without Ogg Vorbis: we check it at review
  }
  const fs = decoded.sampleRate, n = decoded.length, duration = n / fs;
  const chans = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  let peak = 0;
  for (const c of chans) for (let i = 0; i < n; i++) { const v = Math.abs(c[i]); if (v > peak) peak = v; }
  const peakDb = 20 * Math.log10(peak || 1e-9);
  if (duration < 0.3 || peakDb < -50) return { error: "This file is silent or almost empty. Check the export and try again." };
  if (duration > MAX_SECONDS) return { error: "This file is longer than 4 minutes, which is far longer than any line." };
  // Silence at each end: 10 ms frames quieter than -50 dBFS.
  const frame = Math.round(fs / 100), loud = f => {
    let e = 0;
    for (const c of chans) for (let i = f * frame; i < Math.min(n, (f + 1) * frame); i++) e += c[i] * c[i];
    return 10 * Math.log10(e / (frame * chans.length) || 1e-12) > -50;
  };
  const frames = Math.floor(n / frame);
  let first = 0, last = frames - 1;
  while (first < frames && !loud(first)) first++;
  while (last > first && !loud(last)) last--;
  const lead = first / 100, tail = Math.max(0, (frames - 1 - last) / 100);
  const lufs = loudness(chans, fs);
  const rate = head.rate || null, channels = head.channels || decoded.numberOfChannels;
  const w = [];
  if (channels > 1) w.push("stereo");
  if (rate && rate !== 44100 && rate !== 48000) w.push("rate");
  if (lufs < -19) w.push("quiet"); else if (lufs > -13) w.push("loud");
  if (peakDb > -0.1) w.push("clip"); else if (peakDb > -1) w.push("peak");
  if (lead > 0.5) w.push("lead");
  if (tail > 0.5) w.push("tail");
  if (it.target) {
    const r = duration / it.target;
    if (r < 0.6) w.push("short"); else if (r > 1.7) w.push("long");
  }
  const checks = { channels, rate: rate || 0, lufs, peak: peakDb, lead, tail, duration, warnings: w };
  if (head.kind !== "wav" && head.kind !== "flac") return { buf, checks };
  // Converted: the file that goes up is mono at 44.1 or 48 kHz, so those two warnings no longer apply.
  const mp3 = await toMp3(buf, rate).catch(() => null);
  if (!mp3) return { error: "Couldn't turn this file into an .mp3 in this browser. Export it as .mp3 or .ogg and try again." };
  return { buf: mp3.buf, checks: { ...checks, channels: 1, rate: mp3.rate, warnings: w.filter(k => k !== "stereo" && k !== "rate") } };
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
    lead: `${n(c.lead)} s of silence at the start. Trim it to 0.3 s or less.`,
    tail: `${n(c.tail)} s of silence at the end. Trim it to 0.3 s or less.`,
    short: `Much shorter than the text (${fmtTime(c.duration)} for about ${fmtTime(it.target)}). The end may be cut off, or this is the recording for another line.`,
    long: `Much longer than the text (${fmtTime(c.duration)} for about ${fmtTime(it.target)}). Check it's the right line, or trim long pauses.`,
    unchecked: "This browser couldn't check the file. We'll check it when we review.",
  }[key] || key;
}

// ---- Uploading ----

async function upload(it, file) {
  delete errors[it.id];
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
                 "X-CRC32": crcHex(crc32(new Uint8Array(a.buf))) },
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
  if (!st.signedIn) return renderSignIn();
  if (!lines) { app.innerHTML = `<h1>Upload your recordings</h1><p class="pitch">Couldn't load the list of lines. Please reload the page.</p>`; return; }
  if (!st.release.agreed) return renderRelease();
  if (!st.voices.length || creating) return renderNewVoice();
  renderWorkspace();
}

function intro() {
  return `<h1>Upload your recordings</h1>
    <p class="st-intro">Every line is below with the words to read. Record a line in your own setup, then drop the file on
      that line. Name the file whatever you like. We check each one against the <a href="/voices/guide">narrator guide</a>.
      You don't need every line: anything you leave out plays in the default voice. Come back any time, then send your
      voice to us for review.</p>`;
}

function renderSignIn() {
  app.innerHTML = `${intro()}<section class="fb-done st-box"><h2>Sign in first</h2>
    <p>Uploading needs a Lore Forever account, so your recordings are tied to you and you can come back to them. It takes a
      minute with your Google account. Players never need one.</p>
    <p><a class="btn-small" href="/account?next=/voices/studio">Sign in or create an account</a></p></section>`;
}

function renderRelease() {
  app.innerHTML = `${intro()}<form class="fb-form st-box" id="st-release">
    <h2>The narrator release</h2>
    <p class="vp-note">So we can ship your recordings, you give us permission to share them in Lore Forever voice packs under
      CC BY-SA 4.0. It's one page in plain language: <a href="/voices/release" target="_blank">read the narrator release</a>.
      You agree once, before your first upload.</p>
    <label class="fb-check"><input type="checkbox" name="agree" required>
      <span>I've read and agree to the <a href="/voices/release" target="_blank">narrator release</a> (version ${esc(st.release.version)}).</span></label>
    <label class="fb-check"><input type="checkbox" name="adult" required>
      <span>I'm 18 or older. Or I'm under 18, and my parent or guardian has read the release, agrees to it, and signs below.</span></label>
    <label class="fb-field"><span>Signature</span>
      <input type="text" name="signature" maxlength="100" required autocomplete="name" placeholder="Your full name">
      <small>Typing your full name here signs the release. If you're under 18, your parent or guardian types theirs. We keep
        it with your agreement and never publish it.</small></label>
    <div class="fb-actions"><button type="submit" class="btn-download">Agree and continue</button>
      <p class="fb-status" id="st-release-status" role="status" hidden></p></div></form>`;
  const form = document.getElementById("st-release");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const res = await api("release", { method: "POST", body: { agree: !!d.agree, adult: !!d.adult, signature: d.signature, release: st.release.version } });
    if (res.ok) { st.release.agreed = true; render(); return; }
    const s = document.getElementById("st-release-status"); s.textContent = res.error; s.hidden = false;
  });
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
    <label class="fb-field"><span>Language</span><select name="locale">${languageOptions("enUS")}</select>
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
    if (view.voice && it.story.voice !== view.voice) return false;
    if (view.mine && !mine.has(it.story.key)) return false;
    const s = stateOf(it);
    if (view.show === "missing" && s !== "missing") return false;
    if (view.show && view.show !== "missing" && s !== view.show) return false;
    if (q && ![it.name, it.q, it.text, it.story.name.enUS].some(t => t && t.toLowerCase().includes(q))) return false;
    return true;
  });
}

function queue() {
  const todo = items.filter(it => ["missing", "stale"].includes(stateOf(it)));
  const picked = todo.filter(it => mine.has(it.story.key));
  return picked.length ? { list: picked, mine: true } : { list: todo, mine: false };
}

function hintsHtml(it) {
  return it.hints.length ? `<div class="st-hints">${it.hints.map(([n, say]) => `<span><b>${esc(n)}</b> <em>${esc(say)}</em></span>`).join("")}</div>` : "";
}

function nextHtml() {
  const { list, mine: fromMine } = queue();
  if (!list.length) return `<section class="st-next"><p class="st-done-all">Every line with text in this language has a recording.
    Send your voice below whenever you're ready.</p></section>`;
  nextPos = Math.max(0, Math.min(nextPos, list.length - 1));
  const it = list[nextPos];
  const label = it.q ? esc(it.q) : "The story";
  return `<section class="st-next" data-line="${esc(it.id)}">
    <div class="st-next-h"><span class="st-eyebrow">Next ${fromMine ? "of your lines" : "line to record"} · ${lines_(list.length)} still to record</span>
      <span><button class="st-b ghost" type="button" data-next="-1"${nextPos ? "" : " disabled"}>‹ Previous</button>
      <button class="st-b ghost" type="button" data-next="1"${nextPos < list.length - 1 ? "" : " disabled"}>Skip ›</button></span></div>
    <h2>${esc(it.name)} <span>· ${label}</span></h2>
    <div class="st-meta2">${it.text.split(/\s+/).length} words · about ${fmtTime(it.target)}${it.story.voice ? ` · suggested voice: ${esc(VOICES[it.story.voice] || it.story.voice)}` : ""}</div>
    ${stateOf(it) === "stale" ? `<p class="st-note stale">We reworded this line after you uploaded it. Please record the new text.</p>` : ""}
    <div class="st-script">${esc(it.text)}</div>
    ${hintsHtml(it)}
    <div class="st-drop" data-drop="${esc(it.id)}">
      ${busy.has(it.id) ? `<strong>Checking and uploading...</strong>` : `<strong>Drop your recording of this line here</strong>
      <p>or <button class="st-b" type="button" data-choose="${esc(it.id)}">Choose a file</button>. The next line comes up once it's in.</p>`}
      ${errors[it.id] ? `<p class="st-note bad">${esc(errors[it.id])}</p>` : ""}
    </div></section>`;
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
  if (it.text) meta.push(`<button class="st-b ghost" type="button" data-text="${esc(it.id)}" style="padding:0">${open.has(it.id) ? "Hide text" : "Show text"}</button>`);
  if (s === "warn") for (const w of t.checks.warnings) notes.push(`<p class="st-note warn">${esc(warningText(w, t.checks, it))}</p>`);
  if (s === "stale") notes.push(`<p class="st-note stale">We reworded this line after you uploaded it. Please record the new text. Until then this line plays in the default voice.</p>`);
  if (s === "none") notes.push(`<p class="st-note">Not translated yet. <a href="/translate">Help translate it</a>, then it can be recorded.</p>`);
  if (errors[it.id]) notes.push(`<p class="st-note bad">${esc(errors[it.id])}</p>`);
  let acts = "";
  if (busy.has(it.id)) acts = `<span class="st-slot">Checking and uploading...</span>`;
  else if (s === "ok" || s === "warn") acts = `<button class="st-play" type="button" data-play="${esc(it.id)}" aria-label="Play">▶</button>
    <button class="st-b ghost" type="button" data-choose="${esc(it.id)}">Replace</button>
    <button class="st-b ghost" type="button" data-remove="${esc(it.id)}">Remove</button>`;
  else if (s !== "none") acts = `<span class="st-slot">Drop a file here or <button class="st-b" type="button" data-choose="${esc(it.id)}">Upload</button></span>`;
  return `<div class="st-row${it.child ? " child" : ""}"${s !== "none" ? ` data-drop="${esc(it.id)}"` : ""}>
    <span class="st-dot ${s === "missing" ? "" : s}" title="${{ ok: "Uploaded", warn: "Needs a look", stale: "Text changed", missing: "Missing", none: "Not translated yet" }[s]}"></span>
    <div class="st-what">${label}<span class="st-meta">${meta.join("")}</span>${notes.join("")}</div>
    <div class="st-acts">${acts}</div>
    ${open.has(it.id) && it.text ? `<div class="st-script">${esc(it.text)}</div>${hintsHtml(it)}` : ""}</div>`;
}

function renderWorkspace() {
  const v = currentVoice(), lang = lines.languages.find(l => l.locale === v.locale);
  const withText = items.filter(i => i.text), done = withText.filter(isDone).length;
  const perGroup = lines.groups.map(g => {
    const gi = withText.filter(i => i.group === g.name);
    return gi.length ? `${GROUP_SHORT[g.name] || g.name} ${gi.filter(isDone).length}/${gi.length}` : "";
  }).filter(Boolean).join(" · ");
  const counts = { missing: 0, warn: 0, ok: 0, stale: 0 };
  for (const it of withText) counts[stateOf(it)]++;
  const shown = filtered();
  const mineLines = items.filter(i => mine.has(i.story.key)).length;

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
        ${esc(s.name[v.locale] || s.name.enUS)}<span class="n">${sAll.filter(isDone).length} of ${sAll.length}</span></h3>${si.map(rowHtml).join("")}</article>`;
    }
    list += `</section>`;
  }

  const voiceSelect = st.voices.length > 1
    ? `<select id="st-voice" aria-label="Voice">${st.voices.map(x => `<option value="${esc(x.id)}"${x.id === v.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`
    : `<strong>${esc(v.name)}</strong>`;
  const status = v.status === "pending" ? " · sent for review" : "";

  app.innerHTML = `${intro()}
    <div class="st-voicebar">
      <span>Voice: ${renaming ? `<input id="st-rename" maxlength="60" value="${esc(v.name)}" aria-label="Voice name"> <button class="st-b" type="button" id="st-rename-save">Save</button>` : voiceSelect}</span>
      ${renaming ? "" : `<button class="st-b ghost" type="button" id="st-rename-open">Rename</button>`}
      <span class="st-lang">Language: <b>${esc(lang?.name || v.locale)}</b>${lang?.draft ? " (draft text)" : ""}${status}</span>
      ${st.voices.length < st.limits.voices ? `<button class="st-b ghost" type="button" id="st-new-voice">+ New voice</button>` : ""}
    </div>
    <ul class="st-spec"><li><b>.mp3</b>, <b>.ogg</b>, <b>.wav</b> or <b>.flac</b></li><li><b>Mono</b>, 44.1 or 48 kHz</li>
      <li>About <b>−16 LUFS</b>, peaks ≤ −1 dB</li><li>≤ 0.3 s silence at each end</li></ul>
    ${nextHtml()}
    <section id="st-bulkup"></section>
    <div class="st-bar">
      <div class="st-progress">
        <div class="st-progress-top"><span><strong>${done}</strong> of ${withText.length} lines</span><span>${esc(perGroup)}</span></div>
        <div class="st-track"><i style="width:${withText.length ? (done / withText.length * 100).toFixed(1) : 0}%"></i></div>
      </div>
      <a class="btn-download" href="#st-send">Send for review</a>
    </div>
    <div class="st-picker" role="search">
      <div class="st-field grow"><label for="st-q">Find a zone or line</label><input id="st-q" type="search" value="${esc(view.q)}" placeholder="Stormwind, Deadmines, Brotherhood..."></div>
      <div class="st-field"><label for="st-group">Group</label><select id="st-group"><option value="">All groups</option>
        ${lines.groups.map(g => `<option${view.group === g.name ? " selected" : ""}>${esc(g.name)}</option>`).join("")}</select></div>
      <div class="st-field"><label for="st-svoice">Suggested voice</label><select id="st-svoice"><option value="">Any</option>
        ${[...new Set(items.map(i => i.story.voice).filter(Boolean))].map(k => `<option value="${esc(k)}"${view.voice === k ? " selected" : ""}>${esc(VOICES[k] || k)}</option>`).join("")}</select></div>
      <div class="st-field"><label for="st-show">Show</label><select id="st-show">
        ${[["", "All lines"], ["missing", `Missing · ${counts.missing}`], ["warn", `Need a look · ${counts.warn}`], ["ok", `Uploaded · ${counts.ok}`], ["stale", `Text changed · ${counts.stale}`]]
          .map(([k, t]) => `<option value="${k}"${view.show === k ? " selected" : ""}>${t}</option>`).join("")}</select></div>
      <label class="st-mine"><input id="st-mine" type="checkbox"${view.mine ? " checked" : ""}> Only my lines <span>(${mine.size} stories, ${mineLines} lines)</span></label>
      <p class="st-picker-note">Tick <b>Mine</b> on the stories you want to voice. The next-line box goes through those first.</p>
    </div>
    ${list || `<p class="st-empty">No lines match. Clear a filter to see more.</p>`}
    ${testPackHtml(v)}
    ${sendHtml(done, withText.length, counts)}`;
  bindWorkspace();
  bulkBox.mount(document.getElementById("st-bulkup"));
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
      <li>Restart WoW the first time. After that, download again, unzip over the old folder and type <code>/reload</code>.</li>
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

function sendHtml(done, total, counts) {
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
      <div class="fb-actions"><button type="submit" class="btn-download"${done ? "" : " disabled"}>Send ${lines_(done)} for review</button>
        <p class="fb-status" id="st-send-status" role="status" hidden></p></div>
    </form></section>`;
}

// ---- Events ----

function pickFile(it) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".mp3,.ogg,.wav,.flac,audio/*";
  input.addEventListener("change", () => {
    if (input.files.length) upload(it, input.files[0]);
  });
  input.click();
}

const byId = id => items.find(i => i.id === id);

function setMine(keys, on) {
  for (const k of keys) on ? mine.add(k) : mine.delete(k);
  store.set(`lf-studio-mine-${st.voice}`, [...mine]);
  nextPos = 0;
  render();
}

function bindWorkspace() {
  const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);
  on("st-voice", "change", e => { sent = null; load(e.target.value); });
  on("st-new-voice", "click", () => { creating = true; render(); });
  on("st-rename-open", "click", () => { renaming = true; render(); document.getElementById("st-rename")?.focus(); });
  on("st-rename-save", "click", async () => {
    const name = document.getElementById("st-rename").value;
    const res = await api("voice", { method: "POST", body: { id: st.voice, name } });
    if (res.ok) { currentVoice().name = name.trim(); renaming = false; render(); } else alert(res.error);
  });
  on("st-q", "input", e => { view.q = e.target.value; renderKeepFocus("st-q"); });
  on("st-group", "change", e => { view.group = e.target.value; render(); });
  on("st-svoice", "change", e => { view.voice = e.target.value; render(); });
  on("st-show", "change", e => { view.show = e.target.value; render(); });
  on("st-mine", "change", e => { view.mine = e.target.checked; render(); });
  on("st-send-again", "click", () => { sent = null; render(); });
  on("st-send-form", "submit", async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    const d = Object.fromEntries(new FormData(e.target));
    const res = await api("send", { method: "POST", body: { voice: st.voice, ...d } });
    if (res.ok) { sent = res.lines; currentVoice().status = "pending"; render(); document.getElementById("st-send")?.scrollIntoView(); return; }
    btn.disabled = false;
    const s = document.getElementById("st-send-status"); s.textContent = res.error; s.hidden = false;
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
