// The upload page's checks (public/voices/quality.js): on our own narration packs, which must pass with no warning,
// on phone, voice-note, 16 kHz and clipped files, which must be refused (fixtures/audio, decoded with ffmpeg), and on
// made-up takes for each threshold. Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { measure, verdict, BAR } from "../public/voices/quality.js";

const FS = 48000;
const FIXTURES = fileURLToPath(new URL("./fixtures/audio/", import.meta.url));

// ---- Real files ----

let ffmpeg = true;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch (e) { ffmpeg = false; }

// Decoded as the browser does it (48 kHz), with what the header says, as studio.js's headerInfo() reads it.
function decode(file) {
  const path = FIXTURES + file;
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", path, "-ar", String(FS), "-f", "f32le", "-ac", "1", "-"], { maxBuffer: 1 << 28 });
  const [codec, rate, channels] = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels", "-of", "csv=p=0", path])
    .toString().trim().split(",");
  const known = ["pcm_s16le", "pcm_s24le", "mp3", "vorbis", "flac"].includes(codec);   // m4a, webm, Opus don't say
  return { x: new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)),
           sourceRate: known ? Number(rate) : null, channels: Number(channels) };
}

const files = readdirSync(FIXTURES).sort();

test("every narration pack excerpt passes with no warning at all", { skip: !ffmpeg && "ffmpeg isn't installed" }, () => {
  const pass = files.filter(f => f.startsWith("pass-"));
  assert.ok(pass.length >= 7);
  for (const f of pass) {
    const { x, sourceRate, channels } = decode(f), m = measure([x], FS);
    assert.deepEqual(verdict(m, { sourceRate, channels }), { refuse: [], warn: [] },
      `${f}: bandwidth ${m.bandwidth}, snr ${m.snr.toFixed(1)}, lufs ${m.lufs.toFixed(1)}, peak ${m.peak.toFixed(1)}, lead ${m.lead}`);
  }
});

test("phone, voice-note, 16 kHz and clipped files are refused", { skip: !ffmpeg && "ffmpeg isn't installed" }, () => {
  const expect = { "refuse-recorded-16k.wav": "lowrate", "refuse-phone-band.m4a": "narrow", "refuse-voice-note.ogg": "narrow",
                   "refuse-clipped.mp3": "clipping" };
  assert.deepEqual(files.filter(f => f.startsWith("refuse-")), Object.keys(expect).sort());
  for (const [f, key] of Object.entries(expect)) {
    const { x, sourceRate, channels } = decode(f), m = measure([x], FS);
    assert.ok(verdict(m, { sourceRate, channels }).refuse.includes(key), `${f}: ${JSON.stringify(verdict(m, { sourceRate, channels }))}, bandwidth ${m.bandwidth}`);
  }
});

// ---- Made-up takes ----

let seed = 1;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;

// 4 s of "speech": 0.4 s bursts with 20 ms fades and 0.15 s gaps (a hard edge would splash sound up to the top).
// Without top: white noise, all the way up; with top: a sum of tones up to `top` Hz. floor: the noise between and
// under the words, as an amplitude.
function take({ top = null, level = 0.25, floor = 0.0003, seconds = 4 } = {}) {
  seed = 7;
  const n = FS * seconds, x = new Float32Array(n);
  const tones = top ? Array.from({ length: Math.floor(top / 50) }, (_, k) => ({ f: 100 + 50 * k, p: rand() * Math.PI })) : null;
  for (let i = 0; i < n; i++) {
    const t = (i / FS) % 0.55, env = t >= 0.4 ? 0 : Math.min(1, t / 0.02, (0.4 - t) / 0.02) ** 2;
    let v = 0;
    if (env) {
      if (tones) { for (const s of tones) v += Math.sin(2 * Math.PI * s.f * i / FS + s.p); v *= level / Math.sqrt(tones.length); }
      else v = rand() * level;
    }
    x[i] = v * env + rand() * floor;
  }
  return x;
}
const refused = (x, opts = {}) => verdict(measure([x], FS), opts).refuse;

test("a clean full-band take passes", () => {
  const m = measure([take()], FS);
  assert.ok(m.bandwidth >= 20000, `bandwidth ${m.bandwidth}`);
  assert.ok(m.snr > 45, `snr ${m.snr}`);
  assert.equal(m.clipped, 0);
  assert.deepEqual(verdict(m, { sourceRate: 48000 }).refuse, []);
});

test("phone-call bandwidth is refused; a 12 kHz voice (like our own packs) isn't", () => {
  const phone = measure([take({ top: 4000, floor: 0.00001 })], FS);   // its noise is band-limited too: nothing up top
  assert.ok(phone.bandwidth <= 5000, `bandwidth ${phone.bandwidth}`);
  assert.deepEqual(verdict(phone).refuse, ["narrow"]);
  const twelve = measure([take({ top: 12000, floor: 0.00001 })], FS);
  assert.ok(twelve.bandwidth >= BAR.minBandwidth, `bandwidth ${twelve.bandwidth}`);
  assert.deepEqual(verdict(twelve).refuse, []);
});

test("a source under 44.1 kHz is refused by its header, whatever it sounds like", () => {
  assert.deepEqual(refused(take(), { sourceRate: 22050 }), ["lowrate"]);
  assert.deepEqual(refused(take(), { sourceRate: 44100 }), []);
});

test("heavy clipping is refused; a take normalised to 0 dB isn't", () => {
  // Gaussian noise has speech-like peaks: rare ones well above the rest (uniform noise, or a repeating tone mix, is all peak).
  seed = 11;
  const x = Float32Array.from({ length: FS * 4 }, () => { let s = 0; for (let k = 0; k < 12; k++) s += rand(); return s / 12; });
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const normalised = measure([x.map(v => v / peak)], FS);   // (no gaps between words, so it's "noisy"; not clipped)
  assert.ok(normalised.clipped < BAR.maxClipped, `clipped ${normalised.clipped}`);
  assert.ok(!verdict(normalised).refuse.includes("clipping"));
  const m = measure([x.map(v => Math.max(-1, Math.min(1, v * 3)))], FS);
  assert.ok(m.clipped > BAR.maxClipped, `clipped ${m.clipped}`);
  assert.ok(verdict(m).refuse.includes("clipping"));
});

test("background noise: refused when close to the voice, warned when it's only somewhat close", () => {
  const noisy = measure([take({ floor: 0.02 })], FS);
  assert.ok(noisy.snr < BAR.minSnr, `snr ${noisy.snr}`);
  assert.deepEqual(verdict(noisy).refuse, ["noisy"]);
  const hissy = measure([take({ floor: 0.0075 })], FS);
  assert.ok(hissy.snr >= BAR.minSnr && hissy.snr < BAR.okSnr, `snr ${hissy.snr}`);
  assert.deepEqual(verdict(hissy).refuse, []);
  assert.ok(verdict(hissy).warn.includes("hiss"));
});

test("a very quiet take is refused (and not called noisy too)", () => {
  const m = measure([take({ level: 0.008, floor: 0.000006 })], FS);
  assert.ok(m.lufs < BAR.minLufs, `lufs ${m.lufs}`);
  assert.deepEqual(verdict(m).refuse, ["tooquiet"]);
});

test("the guide's settings are warnings: stereo, rates over 48 kHz, long edge silence, length against the text", () => {
  const m = measure([take()], FS);
  assert.deepEqual(verdict(m, { channels: 2, sourceRate: 96000 }).warn.filter(k => ["stereo", "rate"].includes(k)), ["stereo", "rate"]);
  assert.ok(verdict(m, { target: 20 }).warn.includes("short"));
  assert.ok(verdict(m, { target: 1 }).warn.includes("long"));
  assert.ok(!verdict(m, { target: 4 }).warn.some(k => k === "short" || k === "long"));
  const padded = new Float32Array(FS * 7);
  padded.set(take(), FS * 2.5);
  const p = measure([padded], FS);
  assert.ok(p.lead > BAR.edgeSilence && verdict(p).warn.includes("lead"), `lead ${p.lead}`);
});
