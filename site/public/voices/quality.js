// The upload page's quality bar for a recording (studio.js analyze(), and so the zip upload too). Pure functions on
// decoded samples, so site/tests can run them under Node.
//
//   const m = measure(channels, sampleRate);              // Float32Arrays, as decodeAudioData gives them
//   const { refuse, warn } = verdict(m, { sourceRate, lufs });
//
// measure() finds:
//   bandwidth  the highest frequency with real sound in it (Hz). A file recorded or saved at a low sample rate, or
//              squeezed through a low-bitrate encoder, has nothing above its cut-off however it's resampled later:
//              8 kHz phone audio stops at 4 kHz, 22 kHz audio at 11 kHz, a 32 kbps MP3 at about 8-11 kHz.
//   floor      the noise floor: the quiet between words (5th percentile of 30 ms frames, dBFS)
//   speech     how loud the speech is (95th percentile of 30 ms frames, dBFS); snr = speech - floor
//   clipped    the share of samples stuck at full scale in runs of 3 or more (clipping, not a normalised peak)
// verdict() turns those into keys studio.js words for people: refuse (the take can't be used) or warn (it can, but).

const FRAME = 0.03, FFT = 2048, BAND = 500;

// Calibrated on 2026-10-02 against full-band audio through each encoder: phone audio at 8 kHz stops at 5 kHz, a
// 16 kHz voice note at 10 kHz, MP3 32 kbps at 8.5 kHz and 48 kbps at 11.5 kHz, AAC 32 kbps at 13.5 kHz; MP3 64 kbps
// reaches 17 kHz, an iPhone memo (AAC 64 kbps) 18.5 kHz, Vorbis 18.5 kHz, Opus 64 kbps 20.5 kHz, WAV and MP3 96+
// the full 24 kHz. A clean home take has its noise floor 45-55 dB under the speech; a limited or normalised-to-0 dB
// take has no clipped runs, a 6 dB overload has about 0.5%.
export const BAR = {
  minRate: 44100,          // a source sample rate below this is refused (when the file says what it is)
  minBandwidth: 11000,     // Hz: less than this is a phone-call, voice-message or low-bitrate source; refused
  okBandwidth: 15000,      // Hz: below this, a warning (a 48 kbps MP3, 32 kbps AAC)
  minSnr: 30,              // dB between speech and the noise floor; below it the noise is refused
  okSnr: 40,               // below it, a warning
  maxClipped: 0.001,       // share of samples in clipped runs: above it, refused (heavy clipping)
  minLufs: -32,            // integrated loudness below this is refused (too quiet to bring up cleanly)
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

const db = p => 10 * Math.log10(p || 1e-20);
const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];

export function measure(channels, fs) {
  const n = channels[0].length, mono = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / channels.length;

  // Clipping: full-scale samples in runs of 3+ on any channel.
  let clippedSamples = 0;
  for (const c of channels) {
    let run = 0;
    for (let i = 0; i <= n; i++) {
      if (i < n && Math.abs(c[i]) >= 0.999) { run++; continue; }
      if (run >= 3) clippedSamples += run;
      run = 0;
    }
  }

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
  // strongest voice band. Below a cut-off there's nothing (an encoder's or resampler's stop band is 90+ dB down).
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
  return { bandwidth, floor, speech, snr: speech - floor, clipped: clippedSamples / (n * channels.length) };
}

// {refuse: [keys], warn: [keys]} for the measurements, the source sample rate (when the header says it) and the
// integrated loudness. Keys: lowrate, narrow, noisy, clipping, tooquiet (refused); muffled, hiss (warnings).
export function verdict(m, { sourceRate = null, lufs = null } = {}) {
  const refuse = [], warn = [];
  if (sourceRate && sourceRate < BAR.minRate) refuse.push("lowrate");
  else if (m.bandwidth < BAR.minBandwidth) refuse.push("narrow");
  else if (m.bandwidth < BAR.okBandwidth) warn.push("muffled");
  if (m.clipped > BAR.maxClipped) refuse.push("clipping");
  if (lufs != null && lufs < BAR.minLufs) refuse.push("tooquiet");
  else if (m.snr < BAR.minSnr) refuse.push("noisy");
  else if (m.snr < BAR.okSnr) warn.push("hiss");
  return { refuse, warn };
}
