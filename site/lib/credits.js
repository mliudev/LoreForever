// Credit for everyone who helps (LOR-239): narrators (public/voices/voices.json, a contributor's voice by its
// "owner"), translators (their saved translation_edits that weren't rejected) and text finders (accepted community lines in
// contrib_lines, written by /api/contribute, LOR-234; site/CONTRIBUTE_API.md). Used by /contributors, /api/credits,
// the badges on /u/<handle> and the release credit line scripts/post-release.sh puts in the Discord draft. Kept outside
// functions/ so Pages doesn't route it.
//
// The rules:
//   - Only accepted work counts. For community lines that's lib/contribute.js's own rule and query (ACCEPTED,
//     contributors()), the same one GET /api/contribute/contributors answers with, so both always agree: verified,
//     shipped, or one sender's unflagged line older than 48 hours (site/CONTRIBUTE_API.md, "Statuses"). Translations
//     have no approval step, so every saved edit counts unless it was rejected as spam (lib/translations.js
//     CREDITED_EDIT), the same rule as /translate's cards.
//   - Never a rank: people are listed alphabetically, never by how much they sent. Counts are shown, not compared.
//   - Only names people chose to show. An account's name and links show when it ticked "Show my name and links" on
//     /account (users.show_public); otherwise that person isn't listed, even if they typed a nickname on an upload.
//     A nickname typed on an upload without an account is listed as typed. Anonymous uploads aren't listed; their
//     lines still count in totals. (lib/contribute.js FOUND_BY; "Delete my account" unlinks the lines, forgetUser.)
//   - Every query here survives missing tables (contrib_lines only exists after the first upload): no rows, no section.

import { setup } from "./accounts.js";
import { ACCEPTED, ACCEPT_AFTER, contributors } from "./contribute.js";
import { escape, page, linkList, contributorAnchor, publicVoices, loadVoices } from "./voices.js";
import { CREDITED_EDIT, creditedTranslators } from "./translations.js";

const seconds = ms => Math.floor(ms / 1000);

// "1,234". Not toLocaleString: its first call costs more CPU than a whole page on a fresh Worker.
const count = n => String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const plural = (n, one, many = one + "s") => `${count(n)} ${n === 1 ? one : many}`;
const cleanName = (s, max = 60) => String(s ?? "").replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);

// ---- Text finders ----

// Everyone credited for finding accepted (or shipped) lines: [{name, lines, first (unix seconds), links}],
// alphabetical. lib/contribute.js contributors() with the shown accounts' links.
export async function textFinders(env, now = Date.now()) {
  if (!env.DB) return [];
  try {
    await setup(env);   // users, so the join works before anyone has signed in
    return (await contributors(env, seconds(now), { links: true }))
      .map(p => ({ name: p.name, lines: p.lines_accepted, first: p.first_found, links: linkList(p.links) }));
  } catch (e) {
    return [];   // nobody has sent text yet (contrib_lines comes with the first upload), or D1 is down
  }
}

// The lines that shipped in one release (status shipped, shipped_in = release; `lore.contrib mark-shipped` sets them)
// and who to thank: {ok, release, lines, names}. lines counts every shipped line, anonymous ones included; names only
// the people shown (above). ok is false when the database couldn't be read.
export async function releaseCredits(env, release) {
  if (!env.DB) return { ok: false, release, lines: 0, names: [] };
  try {
    await setup(env);
    const lines = await env.DB.prepare("SELECT COUNT(*) AS n FROM contrib_lines WHERE status = 'shipped' AND shipped_in = ?")
      .bind(release).first("n");
    const names = lines ? (await contributors(env, undefined, { release })).map(p => p.name) : [];
    return { ok: true, release, lines: lines || 0, names };
  } catch (e) {
    // No contrib_lines yet is a real answer (nothing shipped); anything else means we don't know.
    return { ok: /no such table/i.test(String(e?.message)), release, lines: 0, names: [] };
  }
}

// ---- Translators ----

// Translators shown on /contributors: [{name, links, languages: [{locale, strings}], strings, first}], alphabetical.
// Credited edits (CREDITED_EDIT, the rule /translate's cards use too), each string counted once per language however
// many times it was edited.
export async function translatorList(env) {
  if (!env.DB) return [];
  try {
    const people = new Map();
    for (const r of await creditedTranslators(env)) {
      const name = cleanName(r.name);
      if (!name) continue;
      const p = people.get(r.id) || { name, links: linkList(r.links), languages: [], strings: 0, first: r.first };
      p.languages.push({ locale: r.locale, strings: Number(r.n) || 0 });
      p.strings += Number(r.n) || 0;
      if (r.first < p.first) p.first = r.first;
      people.set(r.id, p);
    }
    for (const p of people.values()) p.languages.sort((a, b) => a.locale.localeCompare(b.locale));
    return [...people.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || String(a.first).localeCompare(String(b.first)));
  } catch (e) {
    return [];
  }
}

// ---- Narrators ----

const creditName = v => v.contributor?.name || v.credit;

// The voices on the site grouped by who made them, in voices.json order (the house voices first): [{name, links,
// voices}]. A voice's narrations are its own count of accepted work (voices.json "clips").
export function narratorGroups(voices) {
  const groups = new Map();
  for (const v of voices) {
    const name = creditName(v);
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, { name, links: v.contributor?.links || [], voices: [] });
    groups.get(name).voices.push(v);
  }
  return [...groups.values()];
}

// The voices players made, for the home page's "Made with the community" strip: [{name, voices: [{id, name,
// language}]}], alphabetical. Not the house voices (credit "Lore Forever"), and not a voice whose owner chose not to
// show their name on /account. Drafts are already gone (publicVoices).
export const HOUSE_CREDIT = "Lore Forever";
export function communityNarrators(groups) {
  return groups
    .filter(g => g.name !== HOUSE_CREDIT)
    .map(g => ({ name: g.name, voices: g.voices.filter(v => !v.owner || v.contributor).map(v => ({ id: v.id, name: v.name, language: v.language })) }))
    .filter(g => g.voices.length)
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

// ---- Everything at once (/contributors and /api/credits) ----

export async function allCredits(env, request, now = Date.now()) {
  const [voices, translators, textFound] = await Promise.all([
    publicVoices(env, request).catch(() => []), translatorList(env), textFinders(env, now),
  ]);
  return { narrators: narratorGroups(voices), translators, finders: textFound };
}

// ---- Badges on /u/<handle> ----

// [{kind, label, title, href}] for the account's accepted work: "Narrator" (a released voice in voices.json is
// theirs), "Translator" (credited edits) and "Contributed N lines" (accepted lines they found first). Shown
// on their profile, which they made public themselves; the badges never carry the account's name.
export async function contributionBadges(env, request, userId, now = Date.now()) {
  const out = [];
  if (!userId) return out;
  let voices = [];
  try { voices = env.ASSETS ? await loadVoices(env, request) : []; } catch (e) { voices = []; }
  if (voices.some(v => v.owner === userId && v.status !== "soon")) {
    out.push({ kind: "narrator", label: "Narrator", title: "Lent Lore Forever a narration voice", href: "/contributors#narrators" });
  }
  if (env.DB) {
    try {
      await setup(env);
      const n = await env.DB.prepare(
        `SELECT COUNT(DISTINCT e.locale || ':' || e.string_id) AS n FROM translation_edits e WHERE e.user_id = ? AND ${CREDITED_EDIT}`
      ).bind(userId).first("n");
      if (n > 0) out.push({ kind: "translator", label: "Translator", title: `Translated ${plural(n, "string")} of Lore Forever`, href: "/contributors#translators" });
    } catch (e) { /* no translator tables: no badge */ }
    try {
      // The same lines /contributors counts for them: accepted or shipped, found first by this account.
      const n = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM contrib_lines l WHERE l.found_by_user = ? AND (l.status = 'shipped' OR ${ACCEPTED})`
      ).bind(userId, seconds(now) - ACCEPT_AFTER).first("n");
      if (n > 0) out.push({ kind: "lines", label: `Contributed ${plural(n, "line")}`, title: "Lines of Forever's text found in game and sent in", href: "/contributors#finders" });
    } catch (e) { /* nobody has sent text yet */ }
  }
  return out;
}

// ---- The page ----

const host = u => new URL(u).hostname.replace(/^www\./, "");
const linkLine = links => links.length
  ? `<span class="ct-links">${links.map(u => `<a href="${escape(u)}" rel="nofollow ugc noopener">${escape(host(u))}</a>`).join(" &middot; ")}</span>`
  : "";
const voiceTag = v => v.included ? '<span class="tag">Default</span>' : v.status === "soon" ? '<span class="tag tag-soon">Coming soon</span>' : "";

function narratorCards(groups) {
  return groups.map(g => `<article class="zone vc" id="${contributorAnchor(g.name)}">
      <div class="zone-body">
        <h3>${escape(g.name)}</h3>
        ${g.links.length ? `<p class="vpr-links">${linkLine(g.links)}</p>` : ""}
        <ul class="vcon-voices">
          ${g.voices.map(v => `<li><a href="/voices/${escape(v.id)}">${escape(v.name)}</a> ${voiceTag(v)}${v.clips && v.status !== "soon" ? ` <span class="ct-n">${plural(v.clips, "narration")}</span>` : ""}</li>`).join("\n          ")}
        </ul>
      </div>
    </article>`).join("\n      ");
}

function personRow(p, what) {
  return `<li><strong class="ct-name">${escape(p.name)}</strong> <span class="ct-what">${what}</span>${p.links.length ? " " + linkLine(p.links) : ""}</li>`;
}

// /contributors. languages: {locale: English name} for the translators' languages. contribute: the text intake is
// open to players (lib/features.js), so the text finders section shows even while it's empty and invites them in.
export function contributorsPage({ narrators, translators, finders: found }, { languages = {}, contribute = false } = {}) {
  const sections = [];
  const jump = [];
  if (narrators.length) {
    jump.push('<a href="#narrators">Narrators</a>');
    sections.push(`<section class="vp-section" id="narrators" aria-labelledby="narrators-title">
    <h2 id="narrators-title">Narrators</h2>
    <p class="vp-note">The voices that read Lore Forever's stories aloud. Each links to its profile, samples and download.</p>
    <div class="zone-grid vc-grid">
      ${narratorCards(narrators)}
    </div>
  </section>`);
  }
  jump.push('<a href="#translators">Translators</a>');
  sections.push(`<section class="vp-section" id="translators" aria-labelledby="translators-title">
    <h2 id="translators-title">Translators</h2>
    <p class="vp-note">Lore Forever in their language. Strings they translated that are in the language packs or waiting for the next one.</p>
    ${translators.length
      ? `<ul class="ct-list">
      ${translators.map(p => personRow(p, p.languages.map(l => `${escape(languages[l.locale] || l.locale)}, ${plural(l.strings, "string")}`).join(" &middot; "))).join("\n      ")}
    </ul>`
      : `<p>Nobody's name here yet. <a href="/translate">Translate Lore Forever</a> and yours can be the first.</p>`}
  </section>`);
  if (found.length || contribute) {
    jump.push('<a href="#finders">Text finders</a>');
    sections.push(`<section class="vp-section" id="finders" aria-labelledby="finders-title">
    <h2 id="finders-title">Text finders</h2>
    <p class="vp-note">Players who captured Forever's own quests and dialogue in game and sent them in. Counted once a line is accepted.</p>
    ${found.length
      ? `<ul class="ct-list">
      ${found.map(p => personRow(p, plural(p.lines, "line"))).join("\n      ")}
    </ul>`
      : `<p>Nobody's name here yet. <a href="/contribute">Send the text of a Forever quest</a> and yours can be the first.</p>`}
  </section>`);
  }
  const join = [
    '<a href="/voices/studio">record your voice</a>',
    '<a href="/translate">translate</a>',
    ...(contribute ? ['<a href="/contribute">send Forever text from the game</a>'] : []),
  ];
  const body = `  <h1>Contributors</h1>
  <p class="pitch">Lore Forever is better for everyone who pitches in. Thank you to the narrators, translators and players
    who send in Forever's text.</p>
  ${jump.length > 1 ? `<p class="ct-jump">${jump.join(" &middot; ")}</p>` : ""}
  ${sections.join("\n  ")}
  <p class="vp-note">Names are in alphabetical order, counting accepted work only. Want to be on this page? You can
    ${join.length > 2 ? `${join.slice(0, -1).join(", ")} or ${join[join.length - 1]}` : join.join(" or ")}. Everyone chooses from
    their <a href="/account">account</a> whether their name and links show here.</p>`;
  return page({
    title: "Contributors",
    description: "The narrators, translators and players who help make Lore Forever.",
    path: "/contributors",
    crumbs: "",
    body,
    foot: `<p>Want to help? <a href="/voices/studio">Record your voice</a> &middot; <a href="/translate">Translate</a></p>`,
    scripts: "",
  });
}
