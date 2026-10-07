// Exact sizes of the official public release assets. Only metadata is fetched; never the files themselves.
const RELEASES = "https://api.github.com/repos/mliudev/LoreForever/releases";

function unavailable(retryAfter = 60) {
  const error = new Error("Release metadata unavailable");
  error.retryAfter = retryAfter;
  return error;
}

// GitHub's retry hints control only the internal edge cooldown, bounded to one minute through one hour.
function cooldown(res) {
  const now = Date.now(), waits = [res.status === 403 || res.status === 429 ? 300 : 60];
  const retry = res.headers.get("Retry-After") || "";
  const seconds = /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) : (Date.parse(retry) - now) / 1000;
  if (Number.isFinite(seconds) && seconds > 0) waits.push(seconds);
  if (res.status === 403 || res.status === 429 || res.headers.get("X-RateLimit-Remaining") === "0") {
    const reset = res.headers.get("X-RateLimit-Reset") || "";
    const until = /^\d+$/.test(reset) ? Number(reset) * 1000 : NaN;
    if (Number.isFinite(until) && until > now) waits.push((until - now) / 1000);
  }
  return Math.min(3600, Math.ceil(Math.max(...waits)));
}

async function getReleaseJson(url, env) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "loreforeverwow.com download files" };
  if (env.GITHUB_TOKEN) headers.Authorization = "Bearer " + env.GITHUB_TOKEN;
  // Workers supports manual redirects. Reject a redirect via !ok instead of forwarding an optional token.
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000), redirect: "manual" });
  if (!res.ok) throw unavailable(cooldown(res));
  return res.json();
}

function releaseFiles(release) {
  if (!release || release.draft === true || typeof release.tag_name !== "string" || !release.tag_name.trim() ||
      !Array.isArray(release.assets)) throw new Error("Invalid release metadata");
  const files = new Map();
  for (const asset of release.assets) {
    if (!asset || typeof asset.name !== "string" || !asset.name.trim() ||
        !Number.isSafeInteger(asset.size) || asset.size <= 0 || files.has(asset.name)) {
      throw new Error("Invalid release asset metadata");
    }
    files.set(asset.name, asset.size);
  }
  return Object.fromEntries(files);
}

// Latest must succeed: the recent list must never stand in for GitHub's authoritative latest release.
// A failed or malformed recent list still leaves the latest release usable, with a short internal retry cooldown.
export async function downloadFiles(env = {}) {
  const [latest, recent] = await Promise.allSettled([
    getReleaseJson(RELEASES + "/latest", env),
    getReleaseJson(RELEASES + "?per_page=30", env),
  ]);
  const retryAfter = Math.max(latest.reason?.retryAfter || 60, recent.reason?.retryAfter || 60);
  let files;
  try {
    if (latest.status !== "fulfilled") throw unavailable();
    files = releaseFiles(latest.value);
    if (!Object.keys(files).length) throw unavailable();
  } catch (e) { throw unavailable(retryAfter); }
  const latestTag = latest.value.tag_name;
  const byTag = new Map([["latest", files], [latestTag, files]]);
  let complete = false;
  if (recent.status === "fulfilled" && Array.isArray(recent.value)) {
    try {
      const releases = recent.value.filter(release => release?.draft !== true)
        .map(release => [release.tag_name, releaseFiles(release)]);
      for (const [tag, assets] of releases) if (!byTag.has(tag)) byTag.set(tag, assets);
      complete = true;
    } catch (e) {}
  }
  return { data: { latestTag, byTag: Object.fromEntries(byTag) }, complete, retryAfter };
}
