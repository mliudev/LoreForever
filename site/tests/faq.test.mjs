// /faq (public/faq.html, the book): what search engines and old links read. Without JavaScript every question and answer
// is in the page; the FAQPage structured data says what the page says; and the addresses other sites already link to
// (/faq#mac...) still land on their question. The look and the page turning are checked in a browser, not here.
// Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SITE } from "./helpers.mjs";

const html = readFileSync(join(SITE, "public", "faq.html"), "utf8");

const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&rsaquo;": "›", "&ndash;": "–", "&mdash;": "—" };
const text = s => s.replace(/<[^>]+>/g, "").replace(/&[#\w]+;/g, e => ENT[e] ?? e).replace(/\s+/g, " ").trim();

// Every question as the page shows it, without a script: the fold's title and its answer's paragraphs.
const folds = [...html.matchAll(/<details\b([^>]*)>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)].map(([, attrs, summary, body]) => ({
  id: /\bid="([^"]+)"/.exec(attrs)?.[1], open: /\bopen\b/.test(attrs), name: text(summary),
  answer: [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(m => text(m[1])).join(" ") }));

// The addresses that were live before the book (the old page's ids): links in replies and videos point at them.
const OLD_ANCHORS = ["what", "beta", "addons-allowed", "mac", "retail", "timeline", "retail-lore", "lore-source", "narrators", "hours",
  "pick-voice", "privacy", "journey-cost", "companion", "live-game", "characters", "feedback", "donate"];

test("every old /faq address still lands on its question, inside a chapter the book can turn to", () => {
  for (const id of OLD_ANCHORS) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > 0, `${id} is still an address on the page`);
    assert.ok(html.lastIndexOf('<section class="fq-chapter"', at) > html.lastIndexOf("</section>", at), `${id} is inside a chapter`);
  }
});

test("without JavaScript every question and its whole answer is in the page, open", () => {
  const ids = folds.map(f => f.id);
  assert.deepEqual(OLD_ANCHORS.filter(id => id !== "live-game" && !ids.includes(id)), [], "every old question is a fold");
  for (const f of folds) {
    assert.ok(f.name.length > 3 && f.answer.length > 40, `${f.id} has a question and an answer`);
    assert.ok(f.open, `${f.id} is open until the script folds it`);
  }
});

test("the FAQPage data is the questions the page shows, word for word", () => {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  const faq = blocks.find(b => b["@type"] === "FAQPage");
  assert.ok(faq, "the page carries FAQPage data");
  assert.deepEqual(faq.mainEntity.map(q => [q.name, q.acceptedAnswer.text]), folds.map(f => [f.name, f.answer]));
});
