// /voices/zones: who narrates which zone (LOR-231, lib/claims.js), "Elwynn Forest: narrated by X". English first, then
// any other language with a claim. Built on the server so it works without JavaScript; the claims themselves are made
// on the upload page (/voices/studio). Without the database it still lists the zones, all open.
// Behind the "zones" feature (lib/features.js): while it's off the page still opens by address (for previews), but
// it's noindex, nothing links to it, and its link to the upload page carries ?zones=1 to show the zone box there.

import { page, escape, loadVoices } from "../../lib/voices.js";
import { setup } from "../../lib/accounts.js";
import { loadLines } from "../../lib/studio.js";
import { refreshClaims, zoneBoard } from "../../lib/claims.js";
import { featureOn } from "../../lib/features.js";
import { zoneList } from "../../public/voices/zone-list.js";

const lines_ = n => `${n} line${n === 1 ? "" : "s"}`;

function section(lang, zones, first) {
  const done = zones.filter(z => z.claim?.status === "done").length, going = zones.filter(z => z.claim?.status === "active").length;
  const rows = zones.map(z => {
    const c = z.claim;
    const who = c?.voice ? `<a href="/voices/${escape(c.voice)}">${escape(c.credit)}</a>` : escape(c?.credit);
    const status = !c ? `<span class="zp-open">Open</span>`
      : c.status === "done" ? `<span class="zp-done">Narrated by ${who}</span>`
      : `<span class="zp-going">Being narrated by ${who} · ${c.total ? Math.round(c.done / c.total * 100) : 0}%</span>`;
    return `<li><span class="zp-name">${escape(z.name)}</span><span class="zp-lines">${lines_(z.lines)}</span>${status}</li>`;
  }).join("\n      ");
  return `<section class="vp-section" aria-labelledby="zp-${escape(lang.locale)}">
    <h2 id="zp-${escape(lang.locale)}">${escape(lang.name)}${first ? "" : ` <small>(${lang.locale})</small>`}</h2>
    <p class="zp-sum"><b>${done}</b> of ${zones.length} zones narrated, <b>${going}</b> being narrated.</p>
    <ul class="zp-list">
      ${rows}
    </ul>
  </section>`;
}

export async function onRequestGet({ request, env }) {
  const lines = await loadLines(env, request);
  const languages = lines.languages.filter(l => l.lines > 0);
  let boards = [];
  try {
    if (!env.DB) throw new Error("no database");
    await setup(env);
    await refreshClaims(env, lines);
    const voices = await loadVoices(env, request);
    const { results } = await env.DB.prepare("SELECT DISTINCT locale FROM studio_claims WHERE status IN ('active', 'done')").all();
    const claimed = new Set(results.map(r => r.locale));
    for (const lang of languages) {
      if (lang.locale === "enUS" || claimed.has(lang.locale)) boards.push([lang, await zoneBoard(env, lines, lang.locale, voices)]);
    }
  } catch (e) {
    const en = languages.find(l => l.locale === "enUS");
    boards = [[en, zoneList(lines, "enUS").map(z => ({ key: z.key, name: z.name, lines: z.lines.length, claim: null }))]];
  }
  const on = featureOn(env, "zones"), studio = on ? "/voices/studio" : "/voices/studio?zones=1";
  const body = `  <h1>Zones and their narrators</h1>
  <p class="pitch">Narrators claim a zone on the <a href="${studio}">upload page</a> and record its story and the
    places and people in it. A voice plays in game wherever it has a line; the rest stays in the default voice.</p>
  ${boards.map(([lang, zones], i) => section(lang, zones, i === 0)).join("\n  ")}
  <p class="vp-note">Want a zone with your name on it? <a href="${studio}">Claim one on the upload page</a>.
    <a href="/voices/contributors">Voice contributors</a> &middot; <a href="/downloads#voices">All voices</a></p>
  <style>
    .zp-list { list-style: none; margin: 0; padding: 0; }
    .zp-list li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; padding: 8px 0; border-top: 1px solid var(--line); }
    .zp-name { font-weight: 600; }
    .zp-lines { color: var(--muted); font-size: 0.85rem; text-align: right; }
    .zp-list li > span:last-child { grid-column: 1 / -1; font-size: 0.9rem; }
    .zp-open { color: var(--muted); }
    .zp-done { color: #6fcf6f; }
    .zp-going { color: #f0a33a; }
    .zp-sum { color: var(--muted); }
  </style>`;
  return new Response(page({
    title: "Zones and their narrators",
    description: "Which Lore Forever zones are narrated, and by whom.",
    path: "/voices/zones",
    crumbs: `<a href="/voices/studio">Record your voice</a> &rsaquo; Zones`,
    body,
    scripts: "",
    robots: on ? undefined : "noindex",
  }), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
}
