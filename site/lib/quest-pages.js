// The quest pages Willo reads aloud when the add-on has no recording of one (Mike, 2026-10-21: "for Willo read quest
// audio … when no recording exists. It shouldn't be her own voice. It should be the race and gender of the quest giver,
// or if it's not a quest giver and it's a book, then it should be a narrator."). The add-on names the page in the sky
// ("quest:176#detail"); the companion sends only that key, never the words (lib/companion-voice.js speakQuestPage).
//
// The words and the speaker come from the files pipeline/lore/site_lore.py writes (quest_pages): quest-pages/<n>.json
// in site/public/lore/data, n the quest id // 100, {"<quest id>": {"d": [script, voice], "p": ..., "c": ...}} for the
// quest text (detail), progress and completion. script is what the narrator reads; voice the giver's people and gender
// ("dwarf-male": lib/character-voices.js) or null when the narrator reads it (an object, an item, a beast, a giver
// nothing says the gender of). English only.

export const QUEST_PAGES_PATH = "/lore/data/quest-pages/";
// "quest:176#detail", "quest:176#progress" or "quest:176#complete": a quest id is at most 22 bits in the ring.
export const QUEST_KEY = /^quest:([1-9]\d{0,6})#(detail|progress|complete)$/;
const PART = { detail: "d", progress: "p", complete: "c" };
const SHARD = 100;

// A shard of quests, read from the deploy's static files once per isolate. A missing file is the site's home page with
// a 200 (not a 404), so what isn't a shard of quests is nothing; the next call tries again.
const shards = new WeakMap();
async function shard(env, origin, n) {
  const assets = env?.ASSETS;
  if (!assets) return null;
  let byNumber = shards.get(assets);
  if (!byNumber) shards.set(assets, byNumber = new Map());
  if (byNumber.has(n)) return byNumber.get(n);
  try {
    const res = await assets.fetch(new URL(`${QUEST_PAGES_PATH}${n}.json`, origin));
    const data = res.ok ? await res.json() : null;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      byNumber.set(n, data);
      return data;
    }
  } catch (e) {}
  return null;
}

// {script, voice} for a key, or null: not a key, or a page the files don't have.
export async function questPage(env, origin, key) {
  const m = QUEST_KEY.exec(String(key || ""));
  if (!m) return null;
  const data = await shard(env, origin, Math.floor(Number(m[1]) / SHARD));
  const page = Object.hasOwn(data || {}, m[1]) ? data[m[1]][PART[m[2]]] : null;
  const [script, voice] = Array.isArray(page) ? page : [];
  return typeof script === "string" && script.trim() ? { script: script.trim(), voice: typeof voice === "string" ? voice : null } : null;
}

// The script cut to at most `max` letters at the end of a sentence (else a word, else the letters), for a page the
// provider is sent in one go. A page that fits is as it is. (The scripts are at most 526 letters today; this is for
// the day one isn't.)
export function cutAtSentence(text, max) {
  if (text.length <= max) return text;
  let end = -1;
  for (const m of text.slice(0, max + 1).matchAll(/[.!?]["')\]]*(?=\s)/g)) end = m.index + m[0].length;
  if (end > 0) return text.slice(0, end).trim();
  const head = text.slice(0, max), word = /\s/.test(text[max]) ? -1 : head.search(/\s\S*$/);
  return (word > 0 ? head.slice(0, word) : head).trim();
}
