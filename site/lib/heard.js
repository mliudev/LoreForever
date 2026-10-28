// Words as speech heard them (LOR-856 B1): a name may come split in two ("shadow glen", "hog her", "moon well") or a
// letter off ("fell" for fel). One matcher for the site's checks that hold her call to the player's words: the
// notebook's lines (lib/willo-notebook.js notebookCall) and her own lists (lib/willo-tools.js choicesFor).
export const wordsOf = text => String(text || "").toLowerCase().replace(/[’']s\b/g, "").match(/\p{L}+/gu) || [];

// One letter apart at most (one added, dropped or changed), for words of three letters or more.
export function near(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 3 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// What they said, as heard: each word, and each two side by side as one ("shadow glen" is shadowglen too).
export function heardWords(text) {
  const words = wordsOf(text);
  return [...words, ...words.slice(1).map((w, i) => words[i] + w)];
}

// Whether a word of a name is among what they said as heard: the same, or a letter off when both have at least `least`
// letters.
export const heardIn = (word, heard, least = 3) =>
  heard.some(h => h === word || (Math.min(word.length, h.length) >= least && near(word, h)));
