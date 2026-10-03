// The upload page's quality bar (public/voices/quality.js) on made-up takes: speech-like bursts with gaps, the way a
// line is read. Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { measure, verdict, BAR } from "../public/voices/quality.js";

const FS = 48000;
let seed = 1;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;

// 4 s of "speech": 0.4 s bursts and 0.15 s gaps. full: white noise (all the way up); else a sum of tones up to `top` Hz.
// floor: the noise between and under the words, as an amplitude.
function take({ top = null, level = 0.25, floor = 0.0003, seconds = 4 } = {}) {
  seed = 7;
  const n = FS * seconds, x = new Float32Array(n);
  const tones = top ? Array.from({ length: Math.floor(top / 50) }, (_, k) => ({ f: 100 + 50 * k, p: rand() * Math.PI })) : null;
  for (let i = 0; i < n; i++) {
    const t = (i / FS) % 0.55;   // 20 ms fades, as speech has: a hard edge would splash sound up to the top
    const env = t >= 0.4 ? 0 : Math.min(1, t / 0.02, (0.4 - t) / 0.02) ** 2;
    let v = 0;
    if (env) {
      if (tones) { for (const s of tones) v += Math.sin(2 * Math.PI * s.f * i / FS + s.p); v *= level / Math.sqrt(tones.length); }
      else v = rand() * level;
    }
    x[i] = v * env + rand() * floor;
  }
  return x;
}

test("a clean full-band take passes with no warnings", () => {
  const m = measure([take()], FS);
  assert.ok(m.bandwidth >= 20000, `bandwidth ${m.bandwidth}`);
  assert.ok(m.snr > 45, `snr ${m.snr}`);
  assert.equal(m.clipped, 0);
  assert.deepEqual(verdict(m, { sourceRate: 48000, lufs: -16 }), { refuse: [], warn: [] });
});

test("phone-call and voice-message bandwidth is refused, a low-bitrate export only warned", () => {
  const phone = measure([take({ top: 4000, floor: 0.00001 })], FS);   // its noise is band-limited too: nothing up top
  assert.ok(phone.bandwidth <= 5000, `bandwidth ${phone.bandwidth}`);
  assert.deepEqual(verdict(phone, { lufs: -16 }).refuse, ["narrow"]);
  const lowBitrate = measure([take({ top: 12500, floor: 0.00001 })], FS);
  assert.ok(lowBitrate.bandwidth > BAR.minBandwidth && lowBitrate.bandwidth < BAR.okBandwidth, `bandwidth ${lowBitrate.bandwidth}`);
  assert.deepEqual(verdict(lowBitrate, { lufs: -16 }), { refuse: [], warn: ["muffled"] });
});

test("a source under 44.1 kHz is refused by its header, whatever it sounds like", () => {
  const m = measure([take()], FS);
  assert.deepEqual(verdict(m, { sourceRate: 22050, lufs: -16 }).refuse, ["lowrate"]);
  assert.deepEqual(verdict(m, { sourceRate: 44100, lufs: -16 }).refuse, []);
});

test("heavy clipping is refused; a take normalised to 0 dB isn't", () => {
  const x = take({ level: 1 });
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const normalised = x.map(v => v / peak);
  assert.equal(verdict(measure([normalised], FS), { lufs: -14 }).refuse.length, 0);
  const clipped = x.map(v => Math.max(-1, Math.min(1, v * 3)));
  const m = measure([clipped], FS);
  assert.ok(m.clipped > BAR.maxClipped, `clipped ${m.clipped}`);
  assert.ok(verdict(m, { lufs: -8 }).refuse.includes("clipping"));
});

test("background noise: refused when close to the voice, warned when it's only somewhat close", () => {
  const noisy = measure([take({ floor: 0.02 })], FS);
  assert.ok(noisy.snr < BAR.minSnr, `snr ${noisy.snr}`);
  assert.deepEqual(verdict(noisy, { lufs: -16 }).refuse, ["noisy"]);
  const hissy = measure([take({ floor: 0.005 })], FS);
  assert.ok(hissy.snr >= BAR.minSnr && hissy.snr < BAR.okSnr, `snr ${hissy.snr}`);
  assert.deepEqual(verdict(hissy, { lufs: -16 }), { refuse: [], warn: ["hiss"] });
});

test("a very quiet take is refused (and not called noisy too)", () => {
  const m = measure([take({ level: 0.005, floor: 0.000006 })], FS);
  assert.deepEqual(verdict(m, { lufs: -45 }).refuse, ["tooquiet"]);
});
