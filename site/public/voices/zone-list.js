// "Claim a zone" (LOR-231): a narrator claims one zone and records its lines, the zone's own story and the places and
// people in it. Shared by the upload page (zone-claims.js) and the claims API (lib/claims.js), like
// testpack.js. lines.json gives each story its zone and each zone's name (pipeline: voicepack clips); a zone is what
// the add-on's "zone" voice grouping keeps together too, so a partial pack of one zone plays as a whole.
//
//   zoneList(lines, locale)    the zones with at least one line that has text in that language
//   zoneProgress(zone, takes)  {done, total, last}: lines with a take of the current text, and the newest upload

export const EXPIRE_DAYS = 14;   // an active claim with no upload in its zone for this long opens up again

// [{key, name, starter, lines: [{id, hash, story}]}], in lines.json's zone order (starting zones and capitals first).
export function zoneList(lines, locale) {
  const byZone = new Map();
  for (const g of lines.groups || []) {
    for (const s of g.stories) {
      if (!s.zone) continue;
      for (const l of s.lines) {
        if (!l.hash[locale]) continue;
        if (!byZone.has(s.zone)) byZone.set(s.zone, []);
        byZone.get(s.zone).push({ id: l.id, hash: l.hash[locale], story: s.key });
      }
    }
  }
  return (lines.zones || []).filter(z => byZone.has(z.key)).map(z => ({
    key: z.key, name: z.name[locale] || z.name.enUS, starter: Boolean(z.starter), lines: byZone.get(z.key),
  }));
}

// takes: {line id: {hash, created}} for one voice. done counts takes of the line's current text; last is the newest
// upload in the zone (current or not: re-recording counts as working on it), or null.
export function zoneProgress(zone, takes) {
  let done = 0, last = null;
  for (const l of zone.lines) {
    const t = takes[l.id];
    if (!t) continue;
    if (t.hash === l.hash) done++;
    if (t.created && (!last || t.created > last)) last = t.created;
  }
  return { done, total: zone.lines.length, last };
}

// When an active claim opens up again: EXPIRE_DAYS after it was made or after the newest upload in its zone.
export function expiresAt(created, last) {
  const from = last && last > created ? last : created;
  return new Date(Date.parse(from) + EXPIRE_DAYS * 86400e3).toISOString();
}

// About how long a zone takes to read, in minutes, from its lines' words (studio.js reads at 2.5 words a second).
export function readingMinutes(zone, lines, locale) {
  const text = {};
  for (const g of lines.groups || []) for (const s of g.stories) for (const l of s.lines) text[l.id] = l.text[locale];
  const words = zone.lines.reduce((n, l) => n + String(text[l.id] || "").split(/\s+/).filter(Boolean).length, 0);
  return Math.max(1, Math.round(words / 2.5 / 60));
}
