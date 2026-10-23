// Story as you play on the phone (slice 5, docs/story-beats.md): the hidden lore passages a character has reached, for
// Willo for iPhone's SOURCES, as Willo on the PC already reads them (companion Lore.opener). A passage is a spoiler
// section tagged with story beats (data/beats.json); it opens once every beat it waits for is open. Which beats a
// character has opened comes with their last save (lib/willo-stock.js, stockOf's `beats`, sent by the PC's app); the
// passages themselves are lib/story-passages.js, generated server-side and never under public/.

import { PASSAGES, RELATED } from "./story-passages.js";

export const OWN_MAX = 4;           // passages of the entries the question names
export const RELATED_MAX = 2;       // then of the entries those relate to
export const TEXT_MAX_CHARS = 3600; // all of them together

const KEY = /^[a-z]{2,12}:[a-z0-9-]{1,120}$/;

// The opened passages for `keys` (entry keys the question names), own entries first, then their related ones:
// [{id, key, title, text}]. opened: the character's opened beat ids. data: {PASSAGES, RELATED}, for tests.
export function passagesFor(opened, keys, { data = { PASSAGES, RELATED } } = {}) {
  const open = new Set(Array.isArray(opened) ? opened : []);
  if (!open.size || !Array.isArray(keys)) return [];
  const named = [...new Set(keys.filter(k => typeof k === "string" && KEY.test(k)))].slice(0, 8);
  const reached = key => (data.PASSAGES[key] || []).filter(([, , , bt]) => bt.length && bt.every(b => open.has(b)))
    .map(([id, title, text]) => ({ id, key, title, text }));
  const own = named.flatMap(reached).slice(0, OWN_MAX);
  // Westfall's "Masons in Red Masks" when the question names the Defias: the phone has no search to find it.
  const seen = new Set([...named, ...own.map(p => p.key)]);
  const near = [];
  for (const key of named) {
    for (const r of data.RELATED[key] || []) {
      if (seen.has(r)) continue;
      seen.add(r);
      near.push(...reached(r));
    }
  }
  const out = [];
  let chars = 0;
  for (const p of [...own, ...near.slice(0, RELATED_MAX)]) {
    if (chars + p.text.length > TEXT_MAX_CHARS) break;
    chars += p.text.length;
    out.push(p);
  }
  return out;
}
