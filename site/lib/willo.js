// Willo's own download (Willo-Setup.exe, companion/packaging/Willo.iss): which release has it, and the page pieces
// that offer it. The release workflow's willo job adds it to a release; it never holds a release up, so a release can
// come out without it. scripts/download_snapshot.py records the newest release that has it in
// public/data/download-files.json ("/download/willo": "vX.Y.Z:Willo-Setup.exe", carried over from the previous
// snapshot when the new release has none), so /download/willo always points at a Willo that exists. Before the first
// release with it there's no entry: /willo says Willo is coming, and /download/willo goes to /willo.
//
// The switch is that release: the site offers Willo once a release carries Willo-Setup.exe, nothing else to turn on.
//
// Previews (develop and PR previews, never loreforeverwow.com) can also offer a test build before any release has
// one: its Preview R2 bucket (STUDIO) holds willo/preview.json, {"key": "willo/<sha256>/Willo-Setup.exe", "sha256",
// "bytes", "version"}, beside the file (scripts/upload-willo-preview.sh), and /download/willo serves that file itself.
export const WILLO_FILE = "Willo-Setup.exe";
export const PREVIEW_KEY = "willo/preview.json";
const HOME = "loreforeverwow.com";
const RELEASES = "https://github.com/mliudev/LoreForever/releases/download/";

// The tag of the release that has Willo-Setup.exe, from the download snapshot; null when none has it yet.
export function willoTag(sizes) {
  const m = /^(v\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?):Willo-Setup\.exe$/.exec(sizes?.downloads?.["/download/willo"] || "");
  return m ? m[1] : null;
}

export const willoUrl = tag => RELEASES + tag + "/" + WILLO_FILE;

// A preview's test build (see above), or null: always null on loreforeverwow.com, and without a valid marker.
export async function willoPreview(env, request) {
  try {
    if (new URL(request.url).hostname === HOME || !env?.STUDIO) return null;
    const obj = await env.STUDIO.get(PREVIEW_KEY);
    const p = obj ? await obj.json() : null;
    const ok = p && /^willo\/[0-9a-f]{64}\/Willo-Setup\.exe$/.test(p.key || "") && p.key.includes(p.sha256)
      && Number.isSafeInteger(p.bytes) && p.bytes > 0;
    return ok ? { key: p.key, sha256: p.sha256, bytes: p.bytes, version: String(p.version || "preview").slice(0, 40) } : null;
  } catch {
    return null;
  }
}

const mb = bytes => Number.isSafeInteger(bytes) && bytes > 0 ? ` · ${Math.round(bytes / 1e6)} MB` : "";

// What's on offer: a release's Willo-Setup.exe, else a preview's test build, else nothing yet.
function offer(sizes, preview) {
  const tag = willoTag(sizes);
  if (tag) return { bytes: sizes?.byTag?.[tag]?.[WILLO_FILE], version: tag.slice(1) };
  return preview ? { bytes: preview.bytes, version: `${preview.version} (test build)` } : null;
}

// /willo's call to action: the download once there is one, else word that Willo is on its way. In-world and
// price-free: the add-on sends players here (Blizzard's add-on rules, LOR-491).
export function willoGet(sizes, preview = null) {
  const o = offer(sizes, preview);
  if (!o) {
    return `<p class="wl-soon">Willo is almost here. Get the free Lore Forever add-on now, and Willo joins you soon.</p>
      <p><a class="btn-download btn-download-alt" href="/downloads#addon">Get the Lore Forever add-on</a></p>`;
  }
  return `<p><a class="btn-download dl-link" id="willo-download" href="/download/willo?src=willo"
      aria-label="Download Willo for Windows">Download Willo for Windows</a></p>
      <p class="dl-cta-note">Willo-Setup.exe${mb(o.bytes)} · Windows 10 or 11 · ${o.version}</p>
      <p>Willo walks beside the free <a href="/downloads#addon">Lore Forever add-on</a>: get that first.</p>`;
}

// Step 2 on /downloads (beside step 1, the add-on): Willo's own download once there's one to get, else word that
// she's coming. Never one installer for both.
export function willoSection(sizes, preview = null) {
  const o = offer(sizes, preview);
  const get = o
    ? `<a class="btn-download dl-link" href="/download/willo?src=downloads" aria-label="Download Willo for Windows">Download Willo for Windows</a>
      <p class="dl-cta-note">Willo-Setup.exe${mb(o.bytes)} · Windows 10 or 11 · ${o.version}</p>`
    : `<p>Willo is almost here. Get the add-on now, and Willo joins you soon.</p>`;
  return `<section class="dl-step dl-step-willo" id="willo" aria-labelledby="willo-title">
      <p class="dl-step-kicker">Step 2 &middot; free to start</p>
      <h2 id="willo-title">Willo, the companion app</h2>
      <p>Ask anything out loud and hear the answer. Needs the add-on in your game. Sign in with your Lore Forever account
        when Willo asks.</p>
      ${get}
      <p><a href="/willo">What Willo does</a></p>
    </section>`;
}
