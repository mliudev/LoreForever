// The upload page's checks (public/voices/quality.js): on our own narration packs, which must pass with no warning,
// on phone, voice-note, 16 kHz and clipped files, which must be refused (fixtures/audio, decoded with ffmpeg), and on
// made-up takes for each threshold. Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { measure, verdict } from "../public/voices/quality.js";

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

// "Lend your voice" (LOR-230) checks one 2-3 minute reading with the same bar: our own narration, end to end with
// pauses between the excerpts, must still pass, and the check must stay quick enough for a phone.
test("a single 2.5-minute reading is measured like a short take, and quickly", { skip: !ffmpeg && "ffmpeg isn't installed" }, () => {
  const parts = files.filter(f => f.startsWith("pass-")).map(f => decode(f).x);
  const gap = new Float32Array(FS * 0.6);
  const out = [];
  let n = 0;
  for (let i = 0; n < FS * 150; i++) { const p = parts[i % parts.length]; out.push(p, gap); n += p.length + gap.length; }
  const long = new Float32Array(n);
  let o = 0;
  for (const p of out) { long.set(p, o); o += p.length; }
  const started = performance.now(), m = measure([long], FS), took = performance.now() - started;
  assert.ok(m.duration >= 150, `duration ${m.duration}`);
  assert.deepEqual(verdict(m, { sourceRate: 48000, channels: 1 }).refuse, [],
    `bandwidth ${m.bandwidth}, snr ${m.snr.toFixed(1)}, lufs ${m.lufs.toFixed(1)}, clipped ${m.clipped}`);
  assert.ok(took < 4000, `measure took ${Math.round(took)} ms`);
  // Noise, quiet and clipping are still caught over the whole reading.
  const noisy = long.map((v, i) => v + Math.sin(i * 12.9898) * 0.05);
  assert.ok(verdict(measure([noisy], FS)).refuse.includes("noisy"));
  assert.ok(verdict(measure([long.map(v => v * 0.02)], FS)).refuse.includes("tooquiet"));
  assert.ok(verdict(measure([long.map(v => Math.max(-1, Math.min(1, v * 8)))], FS)).refuse.includes("clipping"));
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
