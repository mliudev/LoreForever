// Translator kits in R2 (the STUDIO binding, beside the narrators' uploads): translate-kits/<name>/<sha256>.zip, where
// <name> is a locale (deDE) or "new" (the English-only kit for languages without text). They aren't in git: each
// rebuild would add ~25 MB to its history. `python -m lore.kit site` builds them, writes each one's SHA-256 into
// public/translate/languages.json (kitSha256) and uploads them through /api/translations/kits;
// functions/translate/kits/[name].js serves them. A kit's key is its content, so an upload never changes what an
// existing deployment serves: production, previews and rollbacks each serve the kit their own languages.json names.

import { loadLanguages } from "./translations.js";

export const PREFIX = "translate-kits/";
export const NAME = /^(?:[a-z]{2}[A-Z]{2}|new)$/;
export const SHA256 = /^[0-9a-f]{64}$/;
export const KEEP = 10;                       // uploads kept per kit name, besides the one languages.json links to
export const MAX_BYTES = 64 * 1024 * 1024;    // a full kit is about 10 MB

export const kitKey = (name, sha) => `${PREFIX}${name}/${sha}.zip`;

// {name: sha256} for every kit this deployment's languages.json links to.
export async function linkedKits(env, request) {
  const out = {};
  for (const lang of await loadLanguages(env, request)) {
    const name = /^\/translate\/kits\/([^/]+)\.zip$/.exec(lang.kit || "")?.[1];
    if (name && NAME.test(name) && SHA256.test(lang.kitSha256 || "")) out[name] = lang.kitSha256;
  }
  return out;
}

// The kits in a bucket (of one name, or all), newest upload first: [{name, sha256, key, size, uploaded}].
export async function listKits(bucket, name) {
  const out = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: PREFIX + (name ? name + "/" : ""), cursor, limit: 1000 });
    for (const o of page.objects) {
      const m = /^([^/]+)\/([0-9a-f]{64})\.zip$/.exec(o.key.slice(PREFIX.length));
      if (m) out.push({ name: m[1], sha256: m[2], key: o.key, size: o.size, uploaded: new Date(o.uploaded).toISOString() });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => b.uploaded.localeCompare(a.uploaded));
}
