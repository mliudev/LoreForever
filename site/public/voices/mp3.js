// .wav / .flac -> mono .mp3 in the browser, so the upload page only ever stores files the game plays (LOR-119).
// The encoder is lamejs 1.2.1 (vendor/lame.min.js, LGPL), loaded on first use. WebCodecs can't encode MP3.
//
//   const { buf, rate } = await toMp3(arrayBuffer, sourceRate);
//
// Any format the browser can decode works as input. The result is mono at 192 kbps, at 48 kHz when the source is
// 48 kHz and 44.1 kHz otherwise. Throws when the browser can't decode the file.

let lame = null;
function loadLame() {
  lame ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/voices/vendor/lame.min.js";
    s.onload = () => (window.lamejs ? resolve(window.lamejs) : reject(new Error("lamejs")));
    s.onerror = () => { lame = null; reject(new Error("lamejs")); };
    document.head.append(s);
  });
  return lame;
}

export async function toMp3(buf, sourceRate) {
  const rate = sourceRate === 48000 ? 48000 : 44100;
  const [{ Mp3Encoder }, decoded] = await Promise.all([loadLame(), new OfflineAudioContext(1, 1, rate).decodeAudioData(buf.slice(0))]);
  const n = decoded.length, chans = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const c of chans) v += c[i];
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round((v / chans.length) * 32767)));
  }
  const enc = new Mp3Encoder(1, rate, 192), out = [], step = 1152 * 32;
  for (let i = 0; i < n; i += step) {
    out.push(enc.encodeBuffer(pcm.subarray(i, i + step)));
    if (i % (step * 16) === 0) await new Promise(r => setTimeout(r));   // keep the page responsive on long files
  }
  out.push(enc.flush());
  return { buf: await new Blob(out).arrayBuffer(), rate };
}
