// What a shared link unfolds into (Discord, X, Slack, iMessage) and what search engines read about a page (Mike, 10/23:
// "Let's check our unfurl metadata when people link to willo and lore forever. Can we optimize for SEO here and better
// visuals?"). Every public page carries og:title, og:description, og:image with its size and words, og:site_name, and the
// twitter: copies X reads (summary_large_image: the wide picture).
//
// The cards are 1200x630 pictures drawn by scripts/social-cards.py: Lore Forever's own (img/social-card.png), one per
// guide and one per land on our own map (img/cards/guide-<slug>.jpg, zone-<id>.jpg, listed in lib/cards.js), and
// Willo's set in her look (img/cards/willo*.jpg), which lib/doors.js puts on every page her door shows.

import { GUIDE_CARDS, ZONE_CARDS } from "./cards.js";

export const CARD = { width: 1200, height: 630 };
export const LORE_CARD = { src: "/img/social-card.png", alt: "Lore Forever, the WoW Forever lore add-on" };
export const LORE_INDEX_CARD = { src: "/img/cards/lore.jpg", alt: "Every zone, place and quest of WoW Forever, from Lore Forever" };

const attr = s => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A guide's own card ({src, alt}), or null when scripts/social-cards.py hasn't drawn one (a guide from the editor).
export const guideCard = (slug, title) => GUIDE_CARDS.has(slug)
  ? { src: `/img/cards/guide-${slug}.jpg`, alt: `${title}: a WoW Forever guide from Lore Forever` } : null;

// The card of the first of these names that's a land on the road chart (a zone, city or dungeon; lib/cards.js keeps
// their names, since lib/roadchart.js can't be imported from the lore pages without a loop), or null.
const key = s => String(s ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[‘’`´]/g, "'").trim();
export function zoneCard(...names) {
  for (const name of names) {
    const land = ZONE_CARDS.get(key(name));
    if (land) return { src: `/img/cards/zone-${land[0]}.jpg`, alt: `${land[1]} on the map, from Lore Forever's WoW Forever lore` };
  }
  return null;
}

// The picture tags: og:image with its size (when it's one of our cards, whose size is known) and words, and X's copies.
// image: a path on `home` or a whole address; alt: what it shows.
export function imageTags({ image, alt, home }) {
  const src = /^https?:/.test(image) ? image : home + image;
  const ours = /^\/img\/(social-card\.png|cards\/)/.test(image);
  return [
    `<meta property="og:image" content="${attr(src)}">`,
    ...(ours ? [`<meta property="og:image:width" content="${CARD.width}">`, `<meta property="og:image:height" content="${CARD.height}">`] : []),
    ...(alt ? [`<meta property="og:image:alt" content="${attr(alt)}">`] : []),
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:image" content="${attr(src)}">`,
    ...(alt ? [`<meta name="twitter:image:alt" content="${attr(alt)}">`] : []),
  ].join("\n");
}

// X's title and description, the same as the page's og: ones.
export const twitterText = ({ title, description }) =>
  `<meta name="twitter:title" content="${attr(title)}">\n<meta name="twitter:description" content="${attr(description)}">`;

// The page with these head tags set: each key's old tags (meta property= or name=) go and the new one is put before
// </head>. Keys starting "og:" are properties; the rest are names. A value of null removes the tag.
export function setMeta(html, tags) {
  let out = html;
  const add = [];
  for (const [key, value] of Object.entries(tags)) {
    out = out.replace(new RegExp(`<meta (?:property|name)="${escapeRe(key)}" content="[^"]*">\\n?`, "g"), "");
    if (value != null) add.push(`<meta ${key.startsWith("og:") ? "property" : "name"}="${key}" content="${attr(value)}">`);
  }
  return add.length ? out.replace(/<\/head>/i, add.join("\n") + "\n</head>") : out;
}

// A tag's content, or "".
export function metaContent(html, key) {
  const m = new RegExp(`<meta (?:property|name)="${escapeRe(key)}" content="([^"]*)">`).exec(html);
  return m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : "";
}

// ---- Willo's door ----

export const WILLO_ICONS = `<link rel="icon" href="/img/wispr.svg" type="image/svg+xml">
<link rel="icon" href="/img/willo-icon-512.png" type="image/png" sizes="512x512">
<link rel="apple-touch-icon" href="/img/willo-icon-180.png">`;

const WILLO_CARD = { src: "/img/cards/willo.jpg", alt: "Willo, a little wisp: ask out loud, the world answers" };
const MEET_CARD = { src: "/img/cards/willo-meet.jpg", alt: "Willo, a little wisp who rides along and answers out loud" };
const PLANS_CARD = { src: "/img/cards/willo-plans.jpg", alt: "Willo's plans: free to start, and Hero, Champion and Legend" };

// Her pages' titles and descriptions where Lore Forever's own don't fit her door: [path pattern, {title, description,
// card}]. No title: the page's own with "Lore Forever" swapped for Willo. No description: the page's own.
const WILLO_META = [
  [/^\/$/, { card: WILLO_CARD }],
  [/^\/willo\/?$/, { title: "Meet Willo - a wisp you talk to in WoW Forever", card: MEET_CARD }],
  [/^\/willo\//, { card: MEET_CARD }],
  [/^\/plans\/?$/, { title: "Willo's plans: free to start", card: PLANS_CARD,
    description: "Willo is free to start. A plan gives her more answers, a richer voice and more she can do. Change or cancel any time." }],
  [/^\/account\/?$/, { title: "Your account - Willo", description: "Sign in to wake Willo, see your plan and change it any time." }],
  [/^\/link(\/web)?\/?$/, { title: "Wake Willo", description: "Sign in to wake Willo on your PC." }],
  [/^\/faq\/?$/, { title: "Willo help and FAQ", description: "Answers to what players ask most about Willo and the free Lore Forever add-on she walks beside." }],
  [/^\/creators\/?$/, { title: "Willo's creator program" }],
  [/^\/refunds\/?$/, { title: "Willo refunds and cancellations", description: "How to cancel a Willo plan, and when you get money back, in plain language." }],
  [/^\/privacy\/?$/, { title: "Willo privacy", description: "What Willo and her site keep about you, why, who else handles it, and how to delete it, in plain language." }],
  [/^\/terms\/?$/, { title: "Willo terms", description: "The rules for using Willo and her optional paid plans, in plain language." }],
  [/^\/feedback\/?$/, { title: "Willo feedback", description: "Tell us what Willo got right, what she got wrong, and what you'd like her to do next." }],
];

const asWillo = title => title.replace(/\s*[-|–]\s*Lore Forever$/, " - Willo").replace(/^Lore Forever\b/, "Willo");

// A page as her door shares it: her card, title, description and icons. path: the page's; home: her site's address
// ("https://willocompanion.com", or the develop site's own).
export function willoSocial(html, path, home) {
  const [, meta = {}] = WILLO_META.find(([re]) => re.test(path)) || [];
  const card = meta.card || WILLO_CARD;
  const title = meta.title || asWillo(metaContent(html, "og:title") || (/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "Willo"));
  const description = meta.description || metaContent(html, "og:description") || metaContent(html, "description");
  let out = html.replace(/<link rel="(?:icon|apple-touch-icon)"[^>]*>\n?/g, "");
  out = out.replace(/<\/head>/i, WILLO_ICONS + "\n</head>");
  return setMeta(out, {
    ...(meta.description ? { description } : {}),
    "og:title": title, "og:description": description, "og:site_name": "Willo",
    "og:image": home + card.src, "og:image:width": String(CARD.width), "og:image:height": String(CARD.height),
    "og:image:alt": card.alt, "og:image:type": null,
    "twitter:card": "summary_large_image", "twitter:title": title, "twitter:description": description,
    "twitter:image": home + card.src, "twitter:image:alt": card.alt,
  });
}
