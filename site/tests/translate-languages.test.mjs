// /translate's languages (Mike, 10/19: "Let's add more language support for translate"): every language players asked
// for has a card a signed-in player can start from, a language nobody has started says so with its progress, and
// Arabic is written right to left on the card and in the dashboard. Run: node --test 'site/tests/*.test.mjs'
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { languageCard } from "../lib/translations.js";

const languages = JSON.parse(readFileSync(new URL("../public/translate/languages.json", import.meta.url), "utf8")).languages;
const byLocale = Object.fromEntries(languages.map(l => [l.locale, l]));

test("every asked-for language is on /translate with a kit to start from", () => {
  for (const locale of ["nlNL", "trTR", "zhCN", "zhTW", "jaJP", "koKR", "plPL", "svSE", "daDK", "arSA", "esMX"]) {
    const lang = byLocale[locale];
    assert.ok(lang, `${locale} is listed`);
    assert.match(lang.kit, /^\/translate\/kits\/[A-Za-z]+\.zip$/, locale);
    assert.match(lang.kitSha256, /^[0-9a-f]{64}$/, `${locale} names the exact kit it links to`);
    assert.ok(lang.name && lang.englishName, locale);
  }
  assert.equal(new Set(languages.map(l => l.locale)).size, languages.length, "no language twice");
});

test("a language nobody has started says so, with its progress, and links to the dashboard", () => {
  const html = languageCard(byLocale.nlNL, 3, [], null);
  assert.match(html, /<strong>New language:<\/strong> help start it/);
  // The total follows the English catalog, so read it from the data rather than pinning a count that grows.
  assert.ok(html.includes(`0 of ${byLocale.nlNL.coverage.entries[1].toLocaleString("en-US")} entries`), html);
  assert.match(html, /aria-valuenow="0"/);
  assert.match(html, /href="\/translate\/dashboard\?lang=nlNL"/);
  assert.match(html, /<h3>Nederlands<\/h3>/);
  // A started language doesn't, even one whose few translated interface strings round to 0% overall (esMX's 3%).
  assert.doesNotMatch(languageCard(byLocale.deDE, 0), /New language:/);
  const someUi = { ...byLocale.nlNL, coverage: { percent: 0, strings: [24, 121610], ui: [24, 804], entries: [0, 4169] } };
  assert.doesNotMatch(languageCard(someUi, 0), /New language:/);
  assert.match(languageCard(someUi, 0), /interface 2%/);
});

test("Arabic is right to left on its card, which says it can't show in the game yet", () => {
  assert.equal(byLocale.arSA.dir, "rtl");
  const html = languageCard(byLocale.arSA, 0);
  assert.match(html, /<h3 dir="rtl">العربية<\/h3>/);
  assert.match(html, /class="tl-note" lang="en">Arabic can(&#39;|')t show in the game yet: the game(&#39;|')s fonts have no Arabic letters/);
  // Polish and Turkish lack a few letters in the game's font (in-game check, 10/19): their cards say so.
  assert.match(languageCard(byLocale.plPL, 0), /tl-note[^>]*>The game(&#39;|')s font lacks a few Polish letters \(ą ć ę ń ś ź ż\)/);
  assert.match(languageCard(byLocale.trTR, 0), /tl-note[^>]*>The game(&#39;|')s font lacks a few Turkish letters \(İ Ğ Ş ğ ş\)/);
  for (const locale of ["nlNL", "svSE", "daDK", "jaJP", "koKR", "zhCN"]) assert.doesNotMatch(languageCard(byLocale[locale], 0), /tl-note/, locale);
  for (const locale of ["nlNL", "jaJP", "deDE"]) assert.doesNotMatch(languageCard(byLocale[locale], 0), /dir="rtl"/, locale);
});

test("the dashboard writes a right-to-left language's translations right to left", () => {
  const page = readFileSync(new URL("../public/translate/dashboard.html", import.meta.url), "utf8");
  assert.match(page, /const textDir = \(\) => \(state\.lang && state\.lang\.dir === "rtl" \? \{ dir: "rtl" \} : \{\}\)/);
  assert.match(page, /el\("textarea", \{[^}]*\.\.\.textDir\(\)/, "the translation box");
  assert.equal((page.match(/el\("p", \{ \.\.\.textDir\(\), text: old\.text \}\)/g) || []).length, 2, "saved edits shown back");
});

test("the report form and the kit form offer every language on /translate", () => {
  for (const page of ["../public/translate.html", "../public/translate/submit.html"]) {
    const html = readFileSync(new URL(page, import.meta.url), "utf8");
    const offered = [...html.matchAll(/<option value="([a-z]{2}[A-Z]{2})"/g)].map(m => m[1]);
    assert.deepEqual(offered, languages.map(l => l.locale), page);
  }
});

