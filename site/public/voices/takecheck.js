// What a recording file is, from its first bytes: shared by the upload page (studio.js) and "Lend your voice"
// (lend.js), before the checks in quality.js and the conversion in mp3.js.
//
//   headerInfo(bytes)  {kind, rate?, channels?} from the file header (before any browser resampling), or null
//   CONVERT            kinds the game can't play, turned into .mp3 in the browser before they go up

// m4a is what phone and Windows voice recorders save (and Safari's MediaRecorder); webm and Opus are what other
// browsers and chat apps record; aac is a bare AAC stream.
export const CONVERT = new Set(["wav", "flac", "m4a", "webm", "aac", "opus"]);

// Kind, sample rate and channels from the file header. null: not audio we know.
export function headerInfo(b) {
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
  if (ascii(0, 4) === "OggS") {   // the game plays Ogg Vorbis only; Opus (or anything else) in Ogg is converted
    const p = 27 + b[26];
    return ascii(p + 1, 6) === "vorbis" ? { kind: "ogg", channels: b[p + 11], rate: u32(p + 12) } : { kind: "opus" };
  }
  if (ascii(4, 4) === "ftyp") return { kind: "m4a" };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: "webm" };
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { kind: "aac" };   // ADTS: an MPEG sync word with layer 0
  const frame = o => b[o] === 0xff && (b[o + 1] & 0xe0) === 0xe0 && (b[o + 1] & 0x06) !== 0;   // layer 0 is AAC
  let o = 0;
  if (ascii(0, 3) === "ID3") o = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
  for (; o + 4 < b.length; o++) {
    if (frame(o)) {
      const ver = (b[o + 1] >> 3) & 3, idx = (b[o + 2] >> 2) & 3;
      const table = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }[ver];
      if (!table || idx === 3) continue;
      return { kind: "mp3", rate: table[idx], channels: (b[o + 3] >> 6) === 3 ? 1 : 2 };
    }
    if (o > 8192 && ascii(0, 3) !== "ID3") break;
  }
  return ascii(0, 3) === "ID3" || frame(0) ? { kind: "mp3" } : null;
}
