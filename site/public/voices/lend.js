// "Lend your voice" (/voices/lend, LOR-230): read our short script (lend-script.json) for about 2.5 minutes, recorded
// right here in the browser (MediaRecorder; Mike re-allowed browser recording on 2026-10-03) or uploaded from a
// recording app, checked against the same quality bar as every studio take (quality.js), turned into an MP3 (mp3.js),
// then the terms (lend-terms.html) and send. Server: functions/api/studio/donate/[action].js (lib/donate.js).
// Afterwards this page is the donor's donation page: its status, the test pack once it's ready, the credit, and
// Withdraw my voice.
//
// Phones first (most studio visits are phones): one column, big buttons, the screen kept awake while recording, and a
// 6-second room check before the long take, so a noisy room is caught before three minutes of reading.

import { measure, verdict } from "/voices/quality.js";
import { headerInfo, CONVERT } from "/voices/takecheck.js";
import { toMp3 } from "/voices/mp3.js";
import { crc32, crcHex } from "/voices/crc32.js";

const app = document.getElementById("ln-app");
const SIGN_IN = "/account?next=/voices/lend";
const MIN_SECONDS = 60, MAX_SECONDS = 300, ROOM_SECONDS = 6;
const API = "/api/studio/donate/";

let st = null;          // GET state
let script = null;      // {version, title, paragraphs}
let take = null;        // {url, name, busy, result: {error, refuse, warn, m, duration}, upload: {buf, ext}}
let room = null;        // {busy, result}
let rec = null;         // the recording in progress
let sending = null;     // {pct} while the sample goes up
let flash = "", again = false, editingCredit = false;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtTime = s => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const num = (v, d = 0) => Number(v).toFixed(d).replace("-", "−");

async function api(action, { method = "GET", body, query = "" } = {}) {
  try {
    const r = await fetch(API + action + query, { method, cache: "no-store",
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    return await r.json().catch(() => ({ ok: false, error: `The server answered ${r.status}. Please try again.` }));
  } catch (e) {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

async function load() {
  const [state, s] = await Promise.all([
    api("state"),
    fetch("/voices/lend-script.json", { cache: "no-cache" }).then(r => r.json()).catch(() => null),
  ]);
  st = state;
  script = s ? { version: s.current, ...s.scripts[s.current] } : null;
  render();
}

// ---- Checking a take: the studio's quality bar, worded for a phone ----

function refusalText(key, m) {
  return {
    tooquiet: `Too quiet (${num(m.lufs, 1)} LUFS). Hold the phone or mic about a hand's width from your mouth and speak up a little.`,
    noisy: `Noisy room: the background is only ${num(m.snr)} dB below your voice. Find a quieter room (curtains and soft furniture help; switch off fans and the TV) and get closer to the mic.`,
    clipping: `Clipping: ${num(m.clipped * 100, 1)}% of it hits the top and distorts. Hold the mic a little further away, or speak a little softer.`,
    narrow: `This sounds like a phone call or a heavily squeezed file: there's no sound above ${num(m.bandwidth / 1000, 1)} kHz. Record here on the page, or upload the original file from your recording app.`,
    lowrate: `This was recorded at ${num(m.rate / 1000, 1)} kHz; we need 44.1 or 48 kHz. Record here on the page, or set your app to 44.1 kHz.`,
  }[key] || key;
}
const WARN = {
  hiss: "A little background noise. It'll work; a quieter spot would sound better.",
  quiet: "On the quiet side. It'll work.",
  loud: "On the loud side. It'll work if it sounds clean.",
  clip: "The loudest words touch the top. Fine if it sounds clean when you play it back.",
  peak: "The loudest words come close to the top. Fine if it sounds clean.",
};

// What the recording is and whether it's good enough. long: the full reading (length checked), else the room check.
async function analyze(blob, long) {
  const buf = await blob.arrayBuffer();
  const head = headerInfo(new Uint8Array(buf.slice(0, 65536)));
  if (!head) return { error: "That isn't a recording we can read. Use .mp3, .m4a, .ogg, .wav, .flac or .webm." };
  let decoded;
  try {
    decoded = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(buf.slice(0));
  } catch (e) {
    return { error: "This browser couldn't read the recording. Try another browser, or upload an .mp3 or .wav." };
  }
  const fs = decoded.sampleRate, duration = decoded.length / fs;
  if (long && duration > MAX_SECONDS) return { error: `That's ${fmtTime(duration)} long. Read the script once, at an easy pace (about 2 to 3 minutes).` };
  if (long && duration < MIN_SECONDS) return { error: `That's only ${fmtTime(duration)}. Read the whole script: about 2 to 3 minutes.` };
  const chans = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  const m = { ...measure(chans, fs), rate: head.rate || null };
  if (m.peak < -50) return { error: "We couldn't hear anything. Check the browser is using the right microphone, and try again." };
  const bar = verdict(m, { sourceRate: head.rate || null, channels: 1 });   // mono after converting; the length is ours
  return { m, duration, head, buf, refuse: bar.refuse, warn: bar.warn.filter(k => WARN[k]) };
}

// The file that goes up: as it is when the game plays it (.mp3, Ogg Vorbis), else a mono .mp3 made here.
async function uploadable(r) {
  if (!CONVERT.has(r.head.kind)) return { buf: r.buf, ext: r.head.kind };
  const mp3 = await toMp3(r.buf, r.head.rate).catch(() => null);
  return mp3 ? { buf: mp3.buf, ext: "mp3" } : null;
}

async function checkTake(blob, name) {
  if (take?.url) URL.revokeObjectURL(take.url);
  take = { url: URL.createObjectURL(blob), name, busy: "Checking your recording..." };
  render();
  const r = await analyze(blob, true);
  take.result = r;
  if (!r.error && !r.refuse.length) {
    take.busy = "Getting it ready to send...";
    render();
    take.upload = await uploadable(r);
    if (!take.upload) r.error = "This browser couldn't turn the recording into an .mp3. Try another browser, or upload an .mp3.";
  }
  take.busy = "";
  render();
  document.getElementById("ln-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---- Recording ----

const MIME = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];
const canRecord = () => Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

function micError(e) {
  if (e?.name === "NotAllowedError" || e?.name === "SecurityError") {
    return "The browser blocked the microphone. Allow it for this site (tap the lock or settings icon by the address), then try again.";
  }
  if (e?.name === "NotFoundError") return "No microphone found. Plug one in, or use your phone.";
  return "Couldn't start the microphone. Try again, or upload a recording instead.";
}

// Records until stop() (or `seconds`), then hands the blob to done(blob). Shows time and level while it runs.
async function startRecording(kind, seconds, done) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: { ideal: 48000 },
    } });
  } catch (e) {
    flash = micError(e);
    return render();
  }
  const type = MIME.find(t => MediaRecorder.isTypeSupported?.(t)) || "";
  const recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 128000 });
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  ctx.resume?.().catch(() => {});   // some browsers start it suspended after the await above; the meter needs it running
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(analyser);
  rec = { kind, recorder, stream, ctx, analyser, started: Date.now(), peakHold: 0 };
  try { rec.lock = await navigator.wakeLock?.request("screen"); } catch (e) {}
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || type || "audio/webm" });
    for (const t of stream.getTracks()) t.stop();
    ctx.close().catch(() => {});
    rec.lock?.release?.().catch(() => {});
    cancelAnimationFrame(rec.raf);
    clearInterval(rec.tick);
    rec = null;
    done(blob);
  };
  recorder.start(1000);
  flash = "";
  render();
  const data = new Float32Array(analyser.fftSize);
  const draw = () => {
    if (!rec) return;
    analyser.getFloatTimeDomainData(data);
    let sum = 0, peak = 0;
    for (const v of data) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
    const db = 10 * Math.log10(sum / data.length || 1e-12);
    rec.peakHold = Math.max(peak, rec.peakHold * 0.97);
    const meter = document.getElementById("ln-meter");
    if (meter) {
      meter.style.width = `${Math.max(0, Math.min(100, (db + 60) / 60 * 100))}%`;
      meter.classList.toggle("hot", rec.peakHold > 0.95);
    }
    rec.raf = requestAnimationFrame(draw);
  };
  draw();
  rec.tick = setInterval(() => {
    if (!rec) return;
    const t = (Date.now() - rec.started) / 1000;
    const clock = document.getElementById("ln-clock");
    if (clock) clock.textContent = seconds ? `${Math.max(0, Math.ceil(seconds - t))} s` : fmtTime(t);
    if (t >= (seconds || MAX_SECONDS)) stopRecording();
  }, 250);
}

function stopRecording() {
  if (rec && rec.recorder.state !== "inactive") rec.recorder.stop();
}

async function roomCheck() {
  room = { busy: "Listening..." };
  await startRecording("room", ROOM_SECONDS, async blob => {
    room = { busy: "Checking..." };
    render();
    const r = await analyze(blob, false);
    room = { result: r };
    render();
  });
}

// ---- Sending ----

function sendSample(form) {
  const d = Object.fromEntries(new FormData(form));
  const u = take.upload;
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", API + "sample");
    const m = take.result.m;
    const checks = { duration: take.result.duration, lufs: m.lufs, peak: m.peak, snr: m.snr, bandwidth: m.bandwidth,
                     rate: take.result.head.rate || 0, channels: 1, warnings: take.result.warn };
    xhr.setRequestHeader("X-Checks", encodeURIComponent(JSON.stringify(checks)));
    xhr.setRequestHeader("X-Credit", encodeURIComponent(String(d.credit || "").slice(0, 60)));
    xhr.setRequestHeader("X-Script", script?.version || "");
    xhr.setRequestHeader("X-CRC32", crcHex(crc32(new Uint8Array(u.buf))));
    xhr.upload.onprogress = e => {
      if (!e.lengthComputable) return;
      sending = { pct: Math.round(e.loaded / e.total * 100) };
      const bar = document.getElementById("ln-sendbar");
      if (bar) bar.style.width = `${sending.pct}%`;
    };
    xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch (e) { resolve({ ok: false, error: `The server answered ${xhr.status}. Please try again.` }); } };
    xhr.onerror = () => resolve({ ok: false, error: "The upload stopped. Check your connection and try again." });
    xhr.send(new Blob([u.buf], { type: u.ext === "ogg" ? "audio/ogg" : "audio/mpeg" }));
  });
}

async function submit(form) {
  const d = Object.fromEntries(new FormData(form));
  const say = text => { sending = null; flash = text; render(); document.getElementById("ln-flash")?.scrollIntoView({ block: "center" }); };
  sending = { pct: 0 };
  render();
  if (!st.consent.agreed) {
    const r = await api("consent", { method: "POST", body: { agree: Boolean(d.agree), own: Boolean(d.own), adult: Boolean(d.adult),
                                                               signature: d.signature, version: st.consent.version } });
    if (!r.ok) return say(r.error);
    st.consent.agreed = true;
  }
  const res = await sendSample(form);
  if (!res.ok) return say(res.error);
  sending = null;
  st.donation = res.donation;
  take = null; again = false; flash = "";
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---- Drawing ----

function render() {
  if (!st?.ok || !script) {
    app.innerHTML = `<h1>Lend your voice</h1><div class="fb-done st-box"><p>${esc(st?.error || "Couldn't load the page. Please reload it.")}</p></div>`;
    return;
  }
  app.innerHTML = st.donation && !again ? donationHtml(st.donation) : flowHtml();
  bind();
}

const STEPS = [["donated", "Sent"], ["rendering", "Making your voice"], ["ready", "Test pack ready"], ["published", "In the voice list"]];

function donationHtml(d) {
  const at = STEPS.findIndex(([k]) => k === d.status);
  const steps = STEPS.map(([, label], i) => `<li class="${i < at ? "past" : i === at ? "now" : ""}">${esc(label)}</li>`).join("");
  const now = {
    donated: `<p>Thanks! We make voices on our own computer when it's free, so this can take a few days. Come back to this
      page: your test pack appears here when it's ready.</p>`,
    rendering: `<p>We're making your voice now. Your test pack appears here when it's ready.</p>`,
    ready: `<p>Your voice is ready to hear in game. The test pack starts with the starting zones and capitals in your
        voice; anything it doesn't have plays in the default voice.</p>
      <p class="st-dl"><a class="btn-download" href="${API}pack?id=${encodeURIComponent(d.id)}">Download my test pack</a>
        <span>${d.pack?.lines ? `${d.pack.lines} narrations · ` : ""}${d.pack?.bytes ? `${Math.max(1, Math.round(d.pack.bytes / 1048576))} MB` : ""}</span></p>
      <ol><li>Unzip it into <code>World of Warcraft\\_classic_beta_\\Interface\\AddOns</code>.</li>
        <li>Type <code>/reload</code> in game.</li>
        <li>Choose <b>${esc(d.pack?.title || "your voice")}</b> under Options › AddOns › Lore Forever › Narration voice.</li></ol>
      <p>Tell us what you think on <a href="/discord?src=voices">Discord</a>. Don't like it? Withdraw it below.</p>`,
    published: `<p>Your voice is in the voice list${d.voice ? `: <a href="/voices/${esc(d.voice)}">see its page</a>` : ""}. Players
      hear it as "voice by ${esc(d.credit)}". You can write its description on <a href="/account">your account page</a>.</p>`,
  }[d.status] || "";
  return `<h1>Your voice</h1>
    <ol class="ln-steps">${steps}</ol>
    <section class="ln-card">${now}</section>
    <section class="ln-card"><h2>Your recording</h2>
      <audio controls preload="none" src="${API}audio?id=${encodeURIComponent(d.id)}"></audio>
      <p class="ln-meta">${d.duration ? fmtTime(d.duration) : ""} · sent ${esc(new Date(d.created).toLocaleDateString())} · terms version ${esc(d.consent)}</p>
      ${editingCredit
        ? `<form id="ln-credit" class="ln-inline"><label class="fb-field"><span>Credit</span><input name="credit" maxlength="60" value="${esc(d.credit)}"></label>
            <button class="st-b" type="submit">Save</button></form>`
        : `<p>Players see: <b>voice by ${esc(d.credit)}</b> <button class="st-b ghost" type="button" id="ln-credit-edit">Change</button></p>`}
      ${d.status === "donated" ? `<p><button class="st-b" type="button" id="ln-again">Send a new recording instead</button></p>` : ""}
    </section>
    <section class="ln-card ln-withdraw" id="withdraw"><h2>Withdraw my voice</h2>
      <p>Changed your mind? Withdraw any time. We delete your recording and test pack at once, the copy on our computer the
        next time our tooling runs, stop making narration with your voice, leave it out of every pack from now on and take
        it off our download pages.</p>
      <p>We can't recall copies players already downloaded: narration released before you withdraw stays on their
        computers. <a href="/voices/lend-terms#withdrawing">The terms</a> explain.</p>
      <details><summary>Withdraw</summary>
        <p><button class="st-b danger" type="button" id="ln-withdraw" data-id="${esc(d.id)}">Yes, withdraw my voice</button></p></details>
      ${flash ? `<p class="st-note bad" id="ln-flash">${esc(flash)}</p>` : ""}
    </section>`;
}

function introHtml() {
  return `<h1>Lend your voice</h1>
    <p class="pitch">Read a short story for about three minutes and we'll make a Lore Forever narrator from your voice,
      credited to you. Free for every player.</p>
    <ol class="ln-how"><li><b>Read</b> the script below aloud, here on your phone or computer.</li>
      <li><b>We check it</b> right away and tell you if the room is too noisy or the sound too quiet.</li>
      <li><b>Agree and send.</b> We make your voice on our own computer and put a test pack on this page for you to
        hear in game. Withdraw any time.</li></ol>
    ${st.donation ? `<p class="st-note warn">This replaces the recording you sent before. <button class="st-b ghost" type="button" id="ln-back">Keep the old one</button></p>` : ""}`;
}

function roomHtml() {
  let out = "";
  if (room?.busy) out = `<p class="ln-roomres"><b>${esc(room.busy)}</b> ${rec?.kind === "room" ? `<span id="ln-clock">${ROOM_SECONDS} s</span>` : ""}</p>`;
  else if (room?.result) {
    const r = room.result;
    out = r.error ? `<p class="st-note bad">${esc(r.error)}</p>`
      : r.refuse.length ? r.refuse.map(k => `<p class="st-note bad">${esc(refusalText(k, r.m))}</p>`).join("")
      : `<p class="st-note ok">Sounds good. Go ahead and record the script.</p>${r.warn.map(k => `<p class="st-note warn">${esc(WARN[k])}</p>`).join("")}`;
  }
  return `<section class="ln-card"><h2>Before you start</h2>
    <ul class="ln-tips"><li>A quiet room: curtains, a sofa or a bed soak up echo. Fans, TV and open windows off.</li>
      <li>Phone or mic about a hand's width from your mouth. Headphones are fine.</li>
      <li>Read at an easy pace, like telling a story to a friend. Mistakes are fine: pause, and carry on from the start
        of the sentence.</li></ul>
    ${canRecord() && st.signedIn ? `<p><button class="st-b" type="button" id="ln-room"${rec ? " disabled" : ""}>Check my room (6 seconds)</button>
      <small class="ln-small">Stay quiet for a second, then read the first lines.</small></p>${out}` : ""}
  </section>`;
}

function scriptHtml() {
  const recording = rec?.kind === "take";
  const controls = !st.signedIn
    ? `<a class="btn-download" href="${SIGN_IN}">Sign in to record</a><p class="ln-small">A Lore Forever account keeps your
        voice yours: you can hear the result and withdraw it any time. It takes a minute with Google.</p>`
    : recording
      ? `<div class="ln-recbar"><span class="ln-dot" aria-hidden="true"></span><span id="ln-clock">0:00</span>
          <div class="ln-level"><i id="ln-meter"></i></div>
          <button class="btn-download" type="button" id="ln-stop">Stop</button></div>`
      : `<div class="ln-start">${canRecord() ? `<button class="btn-download" type="button" id="ln-record"${rec ? " disabled" : ""}>● Start recording</button>` : ""}
          <label class="st-b ln-file">Upload a recording instead<input type="file" id="ln-upload" accept="audio/*,.mp3,.m4a,.ogg,.wav,.flac,.webm" hidden></label></div>
          ${canRecord() ? "" : `<p class="ln-small">This browser can't record here. Record in an app (your phone's voice recorder
            works if it saves at 44.1 or 48 kHz), then upload the file.</p>`}`;
  return `<section class="ln-card ln-scriptcard"><h2>The script: ${esc(script.title)}</h2>
    <p class="ln-small">About 2½ minutes aloud. Read it all in one go.</p>
    <div class="ln-script">${script.paragraphs.map(p => `<p>${esc(p)}</p>`).join("")}</div>
    ${controls}
    ${flash && !take ? `<p class="st-note bad" id="ln-flash">${esc(flash)}</p>` : ""}
  </section>`;
}

function resultHtml() {
  if (!take) return "";
  const r = take.result;
  let body;
  if (take.busy) body = `<p><b>${esc(take.busy)}</b></p>`;
  else if (r.error) body = `<p class="st-note bad">${esc(r.error)}</p>`;
  else if (r.refuse.length) body = `<p>This recording can't make a good voice yet:</p>${r.refuse.map(k => `<p class="st-note bad">${esc(refusalText(k, r.m))}</p>`).join("")}`;
  else body = `<p class="st-note ok">It passes: ${fmtTime(r.duration)}, clear enough to make a voice from.</p>
    ${r.warn.map(k => `<p class="st-note warn">${esc(WARN[k])}</p>`).join("")}`;
  const good = !take.busy && !r?.error && !r?.refuse?.length && take.upload;
  return `<section class="ln-card" id="ln-result"><h2>Your recording</h2>
    <audio controls src="${esc(take.url)}"></audio>
    ${body}
    ${take.busy ? "" : `<p><button class="st-b" type="button" id="ln-redo">Record again</button></p>`}
    </section>${good ? consentHtml() : ""}`;
}

function consentHtml() {
  const agreed = st.consent.agreed;
  return `<section class="ln-card ln-consent"><h2>Agree and send</h2>
    <form id="ln-send">
      ${agreed ? `<p class="ln-small">You agreed to <a href="/voices/lend-terms" target="_blank">the terms</a> (version ${esc(st.consent.version)}).</p>` : `
      <p>Before you send, the short version of <a href="/voices/lend-terms" target="_blank">the terms</a> (version ${esc(st.consent.version)}):</p>
      <ul class="ln-terms">
        <li>We use your recording as a <b>reference voice for AI speech synthesis</b>: a speech model on our own computer
          copies the sound of your voice from it and reads Lore Forever's text in that voice, including lines you never
          recorded.</li>
        <li>Only in Lore Forever, a <b>free, non-commercial fan add-on</b>. The narration is given to players for free, on
          our site, GitHub and CurseForge. Never sold, never in ads, never for anything else.</li>
        <li>You can <b>withdraw any time</b> from this page: we delete your recording and stop using your voice. Copies
          players already downloaded can't be recalled.</li>
      </ul>
      <label class="fb-check"><input type="checkbox" name="own" required><span>It's my own voice, and I recorded it myself for this.</span></label>
      <label class="fb-check"><input type="checkbox" name="adult" required><span>I'm 18 or older.</span></label>
      <label class="fb-check"><input type="checkbox" name="agree" required><span>I've read and agree to <a href="/voices/lend-terms" target="_blank">the terms</a>.</span></label>
      <label class="fb-field"><span>Signature</span><input type="text" name="signature" maxlength="100" required autocomplete="name" placeholder="Your full name">
        <small>Typing your full name signs the terms. We keep it with your agreement and never publish it.</small></label>`}
      <label class="fb-field"><span>Credit</span><input type="text" name="credit" maxlength="60" value="${esc(st.donation?.credit || st.user?.display_name || "")}" placeholder="A name, a handle, or Anonymous">
        <small>Players see "voice by" this name.</small></label>
      ${sending ? `<div class="st-track"><i id="ln-sendbar" style="width:${sending.pct}%"></i></div><p><b>Sending...</b></p>`
        : `<div class="fb-actions"><button type="submit" class="btn-download">Lend my voice</button></div>`}
      ${flash ? `<p class="st-note bad" id="ln-flash">${esc(flash)}</p>` : ""}
    </form></section>`;
}

function flowHtml() {
  return `${introHtml()}${roomHtml()}${scriptHtml()}${resultHtml()}
    <p class="ln-small ln-alt">Rather record lines in your own voice, one by one? <a href="/voices/studio">The upload page</a> is for that.</p>`;
}

// ---- Events ----

function bind() {
  const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);
  on("ln-room", "click", roomCheck);
  on("ln-record", "click", () => { take = null; startRecording("take", null, blob => checkTake(blob, "recording")); });
  on("ln-stop", "click", stopRecording);
  on("ln-upload", "change", e => { const f = e.target.files[0]; if (f) { flash = ""; checkTake(f, f.name); } });
  on("ln-redo", "click", () => { if (take?.url) URL.revokeObjectURL(take.url); take = null; flash = ""; render();
    document.querySelector(".ln-scriptcard")?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  on("ln-send", "submit", e => { e.preventDefault(); flash = ""; submit(e.target); });
  on("ln-again", "click", () => { again = true; flash = ""; render(); window.scrollTo({ top: 0 }); });
  on("ln-back", "click", () => { again = false; take = null; render(); });
  on("ln-credit-edit", "click", () => { editingCredit = true; render(); });
  on("ln-credit", "submit", async e => {
    e.preventDefault();
    const credit = new FormData(e.target).get("credit");
    const r = await api("credit", { method: "POST", body: { credit } });
    if (r.ok) { st.donation.credit = r.credit; editingCredit = false; flash = ""; } else flash = r.error;
    render();
  });
  on("ln-withdraw", "click", async e => {
    e.target.disabled = true;
    const r = await api("withdraw", { method: "POST", body: { id: e.target.dataset.id } });
    if (!r.ok) { flash = r.error; return render(); }
    st.donation = null;
    flash = "";
    app.innerHTML = `<h1>Withdrawn</h1><section class="ln-card"><p>Your recording and test pack are deleted, and we've stopped using
      your voice. Thanks for trying it. You can lend it again any time from this page.</p>
      <p><a class="btn-small" href="/voices/lend">Back to Lend your voice</a></p></section>`;
  });
}

window.addEventListener("beforeunload", e => { if (rec || sending) e.preventDefault(); });
load();
