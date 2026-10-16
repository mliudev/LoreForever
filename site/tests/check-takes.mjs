// The upload page's quality bar (public/voices/quality.js) on takes fetched for publishing, decoded as the browser
// decodes them (48 kHz, as quality.test.mjs does). The page already refuses a take below the bar; this checks the copy
// the store holds before it goes into a pack (site/README.md, "Publishing a studio voice"). Needs ffmpeg.
//   node site/tests/check-takes.mjs dist/studio/<voice id>.raw/*     exit 1 if any take is refused

import { execFileSync } from "node:child_process";
import { measure, verdict } from "../public/voices/quality.js";

const FS = 48000;
const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node site/tests/check-takes.mjs <audio file> ...");
  process.exit(2);
}
let refused = 0;
for (const path of files) {
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", path, "-ar", String(FS), "-f", "f32le", "-ac", "1", "-"], { maxBuffer: 1 << 28 });
  const [rate, channels] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels", "-of", "csv=p=0", path])
    .toString().trim().split(",").map(Number);
  const m = measure([new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))], FS);
  const v = verdict(m, { sourceRate: rate, channels });
  if (v.refuse.length) refused++;
  console.log(`${path.split("/").pop()}: ${v.refuse.length ? "REFUSED " + v.refuse.join(", ") : "passes"}` +
    `${v.warn.length ? " (warnings: " + v.warn.join(", ") + ")" : ""}; ${m.duration.toFixed(1)} s, ${rate} Hz, ` +
    `${m.lufs.toFixed(1)} LUFS, peak ${m.peak.toFixed(1)} dB, noise ${m.snr.toFixed(1)} dB under the speech, ` +
    `sound up to ${m.bandwidth} Hz, ${(m.clipped * 100).toFixed(3)}% clipped`);
}
console.log(refused ? `${refused} of ${files.length} takes refused` : `all ${files.length} takes pass the bar`);
process.exitCode = refused ? 1 : 0;
