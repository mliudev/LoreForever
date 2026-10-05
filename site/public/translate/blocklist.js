// Slurs and hate terms a community translation can't contain. check.js turns an edit with one away (in the dashboard
// as you type, and in functions/api/translations on save and kit upload), and pipeline/lore/kit.py leaves one out on
// import and when a language pack is built. An edit is checked against its own language's list and the English one,
// so the English list holds only words that mean nothing else in German, French, Spanish or Portuguese: not "negro",
// which is just "black" in Spanish and Portuguese, nor "retard", French for "late".
//
// Source: compiled for Lore Forever in 2026-10 from Wikipedia's lists of ethnic slurs and of LGBTQ slurs (English,
// German, French, Spanish and Portuguese editions), keeping only words whose everyday use is the slur. No general
// profanity, and none of the game's own insults ("greenskin" belongs to the lore). Checked against every translation
// in data/i18n and the English: no matches. Matching ignores case and accents and takes whole words only.
//
// The object is plain JSON so the pipeline can read this same file: keep it that way (no comments inside it).
export const BLOCKLIST = {
  "en": ["nigger", "niggers", "nigga", "niggas", "faggot", "faggots", "fag", "fags", "kike", "kikes", "spic", "spics",
         "gook", "gooks", "wetback", "wetbacks", "tranny", "trannies", "raghead", "ragheads", "towelhead", "towelheads",
         "paki", "pakis"],
  "de": ["neger", "negern", "negerin", "negerinnen", "kanake", "kanaken", "kanacke", "kanacken", "schwuchtel",
         "schwuchteln", "judensau", "polacke", "polacken", "kümmeltürke", "kümmeltürken"],
  "fr": ["nègre", "nègres", "négresse", "négresses", "négro", "négros", "bougnoule", "bougnoules", "youpin",
         "youpins", "youpine", "youpines", "pédé", "pédés", "chinetoque", "chinetoques", "gouine", "gouines", "tafiole",
         "tafioles", "tarlouze", "tarlouzes"],
  "es": ["maricón", "maricones", "marica", "maricas", "sudaca", "sudacas", "negrata", "negratas", "moraco", "moracos"],
  "pt": ["viado", "viados", "sapatão", "sapatões", "sapatona", "sapatonas", "traveco", "travecos", "baitola",
         "baitolas", "boiola", "boiolas"]
};
