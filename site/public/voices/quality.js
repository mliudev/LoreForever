// Every check the upload page makes on a recording (studio.js analyze(), and so the zip upload too): the narrator
// guide's settings and the quality bar. Pure functions on decoded samples, so site/tests can run them under Node.
//
//   const m = measure(channels, sampleRate);               // Float32Arrays, as decodeAudioData gives them
//   const { refuse, warn } = verdict(m, { sourceRate, channels, target });
//
// measure() finds:
//   bandwidth  the highest frequency with real sound in it (Hz). A file recorded or saved at a low sample rate, or
//              squeezed through a low-bitrate encoder, has nothing above its cut-off however it's resampled later.
//   floor      the noise floor: the quiet between words (5th percentile of 30 ms frames, dBFS)
//   speech     how loud the speech is (95th percentile of 30 ms frames, dBFS); snr = speech - floor
//   clipped    the share of samples at 95% of full scale or more: a clipped take has a lot (an MP3 export ripples its
//              flat tops, so exact full-scale runs miss it), speech normalised to 0 dB has almost none
//   lufs, peak (dBFS), lead and tail (seconds of silence at each end), duration
// verdict() turns those into keys studio.js words for people: refuse (the take can't be used) or warn (it can, but).
//
// Calibrated on 2026-10-02/03. Through each encoder, full-band audio keeps sound up to: an 8 kHz phone 5 kHz, a 16 kHz
// voice note 10 kHz, MP3 32 kbps 8.5 kHz and 48 kbps 11.5 kHz, AAC 32 kbps 13.5 kHz, MP3 64 kbps 17 kHz, AAC 64 kbps
// 18.5 kHz, Opus 64 kbps 20.5 kHz, WAV the full band. Our own narration packs (made at 24 kHz, shipped as 64 kbps MP3)
// reach 11.5-12.5 kHz and must pass without a warning (site/tests/fixtures/audio, quality.test.mjs), so the bar is the
// voice-note line, not the hi-fi one. A clean take has its noise floor 45-55 dB under the speech; a limited or
// normalised-to-0 dB take has 0.006% of samples near full scale, a 6 dB overload 0.6% (0.3% once it's an MP3).

const FRAME = 0.03, FFT = 2048, BAND = 500;

export const BAR = {
  minRate: 44100,          // a source sample rate below this is refused (when the file says what it is)
  minBandwidth: 10500,     // Hz: less than this is a phone-call, voice-message or low-bitrate source; refused
  minSnr: 30,              // dB between speech and the noise floor; below it the noise is refused
  okSnr: 36,               // below it, a warning (our quietest-floored pack clips sit at 42-44)
  maxClipped: 0.001,       // share of samples near full scale: above it, refused (clipping)
  minLufs: -32,            // integrated loudness below this is refused (too quiet to bring up cleanly)
  // The guide's settings: warnings only.
  quietLufs: -21, loudLufs: -12,   // the guide asks for about -16 LUFS; our own packs sit around -19
  clipPeak: -0.1, hotPeak: -1,     // dBFS
  edgeSilence: 2,                  // seconds at either end (the guide: about a second at most; our packs have up to 1.7)
  shortRatio: 0.6, longRatio: 1.7, // length against the text's reading time
};

// In-place radix-2 FFT (re, im of length 2^k).
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2;
        const tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
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
export function loudness(channels, fs) {
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

const db = p => 10 * Math.log10(p || 1e-20);
const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];

export function measure(channels, fs) {
  const n = channels[0].length, mono = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / channels.length;

  // Peak, and clipping: samples at 95% of full scale or more, on any channel.
  let peak = 0, clippedSamples = 0;
  for (const c of channels) {
    for (let i = 0; i < n; i++) {
      const v = Math.abs(c[i]);
      if (v > peak) peak = v;
      if (v >= 0.95) clippedSamples++;
    }
  }

  // Silence at each end: 10 ms frames quieter than -50 dBFS.
  const edge = Math.round(fs / 100), edges = Math.floor(n / edge);
  const loud = f => {
    let e = 0;
    for (const c of channels) for (let i = f * edge; i < Math.min(n, (f + 1) * edge); i++) e += c[i] * c[i];
    return db(e / (edge * channels.length)) > -50;
  };
  let first = 0, last = edges - 1;
  while (first < edges && !loud(first)) first++;
  while (last > first && !loud(last)) last--;

  // Frame levels, for the noise floor and the speech level.
  const len = Math.max(1, Math.round(FRAME * fs)), levels = [];
  for (let s = 0; s + len <= n; s += len) {
    let e = 0;
    for (let i = s; i < s + len; i++) e += mono[i] * mono[i];
    levels.push(db(e / len));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const floor = sorted.length ? pct(sorted, 0.05) : -120, speech = sorted.length ? pct(sorted, 0.95) : -120;

  // Bandwidth: the average spectrum of the louder frames, in 500 Hz bands; the top band still within 65 dB of the
  // strongest voice band. Above a cut-off there's nothing (an encoder's or resampler's stop band is 90+ dB down).
  const loudStarts = [];
  for (let k = 0; k < levels.length; k++) if (levels[k] > speech - 20) loudStarts.push(k * len);
  const step = Math.max(1, Math.floor(loudStarts.length / 200));   // at most ~200 FFTs
  const power = new Float64Array(FFT / 2), win = Float64Array.from({ length: FFT }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT - 1)));
  let used = 0;
  for (let k = 0; k < loudStarts.length; k += step) {
    const s = Math.min(loudStarts[k], Math.max(0, n - FFT));
    if (s + FFT > n) break;
    const re = new Float64Array(FFT), im = new Float64Array(FFT);
    for (let i = 0; i < FFT; i++) re[i] = mono[s + i] * win[i];
    fft(re, im);
    for (let i = 0; i < FFT / 2; i++) power[i] += re[i] * re[i] + im[i] * im[i];
    used++;
  }
  let bandwidth = fs / 2;
  if (used) {
    const hz = fs / FFT, bands = [];
    for (let f = 0; f < fs / 2; f += BAND) {
      let p = 0;
      for (let i = Math.floor(f / hz); i < Math.min(FFT / 2, Math.floor((f + BAND) / hz)); i++) p += power[i];
      bands.push(db(p / used));
    }
    const ref = Math.max(...bands.slice(Math.floor(100 / BAND), Math.ceil(4000 / BAND)));
    let top = bands.length - 1;
    while (top > 0 && bands[top] < ref - 65) top--;
    bandwidth = (top + 1) * BAND;
  }
  return {
    bandwidth, floor, speech, snr: speech - floor, clipped: clippedSamples / (n * channels.length),
    peak: 20 * Math.log10(peak || 1e-9), lead: first / 100, tail: Math.max(0, (edges - 1 - last) / 100),
    lufs: loudness(channels, fs), duration: n / fs,
  };
}

// {refuse: [keys], warn: [keys]}. sourceRate and channels: what the file's header says (null if it doesn't); target:
// the text's reading time in seconds (null to skip the length check).
// Refused: lowrate, narrow, clipping, tooquiet, noisy. Warned: hiss, stereo, rate, quiet, loud, clip, peak, lead, tail,
// short, long.
export function verdict(m, { sourceRate = null, channels = 1, target = null } = {}) {
  const refuse = [], warn = [];
  if (sourceRate && sourceRate < BAR.minRate) refuse.push("lowrate");
  else if (m.bandwidth < BAR.minBandwidth) refuse.push("narrow");
  if (m.clipped > BAR.maxClipped) refuse.push("clipping");
  if (m.lufs < BAR.minLufs) refuse.push("tooquiet");
  else if (m.snr < BAR.minSnr) refuse.push("noisy");
  else if (m.snr < BAR.okSnr) warn.push("hiss");
  if (channels > 1) warn.push("stereo");
  if (sourceRate && sourceRate > 48000) warn.push("rate");
  if (m.lufs >= BAR.minLufs && m.lufs < BAR.quietLufs) warn.push("quiet"); else if (m.lufs > BAR.loudLufs) warn.push("loud");
  if (!refuse.includes("clipping")) { if (m.peak > BAR.clipPeak) warn.push("clip"); else if (m.peak > BAR.hotPeak) warn.push("peak"); }
  if (m.lead > BAR.edgeSilence) warn.push("lead");
  if (m.tail > BAR.edgeSilence) warn.push("tail");
  if (target) {
    const r = m.duration / target;
    if (r < BAR.shortRatio) warn.push("short"); else if (r > BAR.longRatio) warn.push("long");
  }
  return { refuse, warn };
}
