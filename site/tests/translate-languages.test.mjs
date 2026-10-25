// /translate's languages (Mike, 10/19: "Let's add more language support for translate"): every language has a card a
// signed-in player can start from, a language nobody has started says so with its progress, and a right-to-left
// language is written that way on its card. Behaviour, not the cards' wording. Run: node --test 'site/tests/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { languageCard } from "../lib/translations.js";

const languages = JSON.parse(readFileSync(new URL("../public/translate/languages.json", import.meta.url), "utf8")).languages;
const byLocale = Object.fromEntries(languages.map(l => [l.locale, l]));

test("every language on /translate has a kit to start from, and none is listed twice", () => {
  for (const lang of languages) {
    assert.match(lang.kit, /^\/translate\/kits\/[A-Za-z]+\.zip$/, lang.locale);
    assert.match(lang.kitSha256, /^[0-9a-f]{64}$/, `${lang.locale} names the exact kit it links to`);
    assert.ok(lang.name && lang.englishName, lang.locale);
  }
  assert.equal(new Set(languages.map(l => l.locale)).size, languages.length, "no language twice");
});

test("a language nobody has started says so, with its progress, and links to the dashboard", () => {
  // Dutch is no longer unstarted once translators land edits, so build the unstarted state from its real totals.
  const [, strings] = byLocale.nlNL.coverage.strings, [, ui] = byLocale.nlNL.coverage.ui, [, total] = byLocale.nlNL.coverage.entries;
  const unstarted = { ...byLocale.nlNL, coverage: { percent: 0, strings: [0, strings], ui: [0, ui], entries: [0, total] } };
  const html = languageCard(unstarted, 3, [], null);
  assert.match(html, /new language/i);
  // The total follows the English catalog, so read it from the data rather than pinning a count that grows.
  assert.ok(html.includes(total.toLocaleString("en-US")), html);
  assert.match(html, /aria-valuenow="0"/);
  assert.match(html, /href="\/translate\/dashboard\?lang=nlNL"/);
  assert.ok(html.includes(byLocale.nlNL.name), "the language's own name");
  // A started language doesn't, even one whose few translated interface strings round to 0% overall.
  assert.doesNotMatch(languageCard(byLocale.deDE, 0), /new language/i);
  const someUi = { ...byLocale.nlNL, coverage: { percent: 0, strings: [24, 121610], ui: [24, 804], entries: [0, 4169] } };
  assert.doesNotMatch(languageCard(someUi, 0), /new language/i);
});

test("a right-to-left language is written right to left on its card; the game's font gaps get a note", () => {
  const rtl = languages.filter(l => l.dir === "rtl");
  assert.ok(rtl.length, "Arabic at least");
  for (const lang of rtl) assert.match(languageCard(lang, 0), /dir="rtl"/, lang.locale);
  for (const lang of languages.filter(l => l.dir !== "rtl")) assert.doesNotMatch(languageCard(lang, 0), /dir="rtl"/, lang.locale);
  // Arabic, Polish and Turkish can't show fully in the game (in-game check, 10/19): their cards carry a note.
  for (const locale of ["arSA", "plPL", "trTR"]) assert.match(languageCard(byLocale[locale], 0), /class="tl-note"/, locale);
  assert.doesNotMatch(languageCard(byLocale.nlNL, 0), /tl-note/);
});

test("the report form and the kit form offer every language on /translate", () => {
  for (const page of ["../public/translate.html", "../public/translate/submit.html"]) {
    const html = readFileSync(new URL(page, import.meta.url), "utf8");
    const offered = [...html.matchAll(/<option value="([a-z]{2}[A-Z]{2})"/g)].map(m => m[1]);
    assert.deepEqual(offered, languages.map(l => l.locale), page);
  }
});
