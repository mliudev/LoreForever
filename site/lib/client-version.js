// Which app is asking, and whether it's too old to serve (the Software Architect's review, 10/21, item 1). Every app
// sends X-LF-Client: "companion/0.25.0" from Willo on a PC or Mac (companion/lore_companion/*.py CLIENT),
// "companion/ios-0.2.0" from Willo for iPhone (mobile/src/lib/site.ts CLIENT). A test build's "companion/0.25.0-qa3"
// counts as 0.25.0.
//
// The header is also how the companion routes tell an app from a page (with no Origin), so readClient is exactly as
// strict as the regexes it replaced: 24 characters of [\w.-] after "companion/", or with { loose: true } 32 of [\w.+-]
// (the check-in, the add-on's errors and What Willo keeps took those). A string it can't read is "unknown": never too
// old, so a parser bug can't lock players out.
//
// GET /api/companion/version (functions/api/companion/version.js) hands each app its minimum and the newest, and an app
// below its minimum gets the update line in place of an answer (functions/api/companion/answer.js).

const STRICT = /^companion\/([\w.-]{1,24})$/;
const LOOSE = /^companion\/([\w.+-]{1,32})$/;
const VERSION = /^(\d{1,4})\.(\d{1,6})\.(\d{1,6})/;
const RELEASE = /^v?(\d{1,4})\.(\d{1,6})\.(\d{1,6})$/;

// "0.25.0" -> [0, 25, 0]; null for anything else.
export const parseVersion = v => {
  const m = RELEASE.exec(String(v ?? "").trim());
  return m ? m.slice(1).map(Number) : null;
};
export const atLeast = (v, min) => !!(v && min) && (v[0] - min[0] || v[1] - min[1] || v[2] - min[2]) >= 0;
const shown = v => v.join(".");

// X-LF-Client -> {platform: "willo" (PC or Mac) | "ios" | null, version: [0, 25, 0] | null, valid}. valid: it's one of
// our apps' headers (the routes' old check); version is null for a build without a release number ("companion/dev").
export function readClient(header, { loose = false } = {}) {
  const m = (loose ? LOOSE : STRICT).exec(String(header ?? ""));
  if (!m) return { platform: null, version: null, valid: false };
  const ios = m[1].startsWith("ios-");
  const v = VERSION.exec(ios ? m[1].slice(4) : m[1]);
  return { platform: ios ? "ios" : "willo", version: v ? v.slice(1).map(Number) : null, valid: true };
}
export const isCompanion = (header, opts) => readClient(header, opts).valid;
export const isPhone = header => readClient(header, { loose: true }).platform === "ios";

// The oldest of each app the site still answers, and where to get a new one. Raise a minimum only when an older app
// truly can't work with the site any more: every app below it stops answering and shows "Update Willo". A Pages
// variable (WILLO_MIN, IOS_MIN, ADDON_MIN) overrides it. Keep the iPhone's at or below the build in App Store review,
// so the reviewer never sees the update line. The newest Willo and add-on come from the release's
// /data/download-files.json; the iPhone's from IOS_LATEST, else its minimum.
export const CLIENTS = {
  willo: { min: "0.1.0", download: "/download/willo" },
  ios: { min: "0.1.0", download: "/willo" },
  addon: { min: "0.1.0", download: "/download" },
};
const ENV_MIN = { willo: "WILLO_MIN", ios: "IOS_MIN", addon: "ADDON_MIN" };

export function minimumOf(app, env = {}) {
  return parseVersion(env[ENV_MIN[app]]) || parseVersion(CLIENTS[app].min);
}

// What GET /api/companion/version answers. published: the release's tag ("v0.25.0"), or null. Apps ignore fields they
// don't know, so more can come later under the same schema.
export function clientVersions(env = {}, published = null, origin = "") {
  const tag = parseVersion(published);
  const latest = (app, min) => app === "ios" ? parseVersion(env.IOS_LATEST) || min : tag && atLeast(tag, min) ? tag : min;
  const out = { schema: 1 };
  for (const app of Object.keys(CLIENTS)) {
    const min = minimumOf(app, env);
    const download = app === "ios" && /^https:\/\//.test(env.IOS_DOWNLOAD || "") ? env.IOS_DOWNLOAD
      : origin + CLIENTS[app].download;
    out[app] = { min: shown(min), latest: shown(latest(app, min)), download };
  }
  return out;
}

// The app asking, when it's below its minimum: {platform, min: "0.26.0"}; null otherwise, and for anything unknown.
export function tooOld(header, env = {}) {
  const c = readClient(header, { loose: true });
  if (!c.valid || !c.version) return null;
  const min = minimumOf(c.platform, env);
  return atLeast(c.version, min) ? null : { platform: c.platform, min: shown(min) };
}

// Her words for an app below its minimum, in place of an answer: in her own voice, so no links or tech words; the app's
// own "Update Willo" line has the download.
export const UPDATE_LINE = {
  willo: "I've grown since this version of me. Please update Willo, then ask me again.",
  ios: "I've grown since this version of me. Please update Willo from the App Store, then ask me again.",
};
