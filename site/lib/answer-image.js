// image: base64 of a JPEG of the player's game window (no data: prefix). Anything else, or a longer one, is ignored and
// the question is answered as text. "/9j/" is the base64 of FF D8 FF, the start of every JPEG. Its own module so
// lib/diagnostic-screenshots.js can check an image without importing lib/companion-answers.js (an import cycle).
export const ANSWER_IMAGE_CHARS = 200_000;
export const imageOf = value => typeof value === "string" && value.length <= ANSWER_IMAGE_CHARS && value.length % 4 === 0 &&
  value.startsWith("/9j/") && /^[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : null;
