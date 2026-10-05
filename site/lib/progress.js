// The public progress page, /contribute/progress (LOR-238): how much of what's new in WoW Forever we have the text of
// and have narrated, zone by zone, and a "Wanted" list of Forever quests and NPCs we know exist but haven't seen the
// words of, so a player can go and capture one. Kept outside functions/ so Pages doesn't route it.
//
// Built from public/data/coverage.json, which the nightly ingest (`python -m lore.contrib pull`, LOR-237) writes:
//   {generated, forever_only: {quests_known, quests_with_text, narrated},
//    zones: [{zone, quests, with_text, narrated}], wanted: [{kind, id, name, zone, level}]}
// The live counters (lines sent, accepted, contributors, last upload) come from GET /api/contribute/stats in the
// browser (public/js/contribute-progress.js), so the page works, minus those, before that API exists.
//
// It leads with Forever's own content, where we're strongest, and shows counts, never global percentages that would
// look thin next to other add-ons' line totals (LOR-238). Until the add-on release with the Contribute button, the
// page is noindex and linked from nowhere (lib/features.js "contribute").

import { escape, page } from "./voices.js";

const count = n => String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const plural = (n, one, many = one + "s") => `${count(n)} ${n === 1 ? one : many}`;
const num = x => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.floor(Number(x)) : 0);
const text = (x, max = 80) => String(x ?? "").replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// What a wanted entry is, as a player would put it; quests (most of the list) get no tag.
export const KINDS = { quest: "", npc: "NPC", book: "Book", gossip: "Dialogue", say: "Overheard" };
const PER_ZONE = 40;   // wanted entries listed per zone before "and N more"
const OTHER = "Other places";

// "generated" as a Date: an ISO date, or unix seconds or milliseconds. null when missing or unreadable.
function when(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  const t = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(x));
  return isNaN(t) ? null : t;
}
const shortDate = t => `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}`;

// coverage.json made safe to render: numbers are whole and never negative, counts never exceed their totals, names
// are short plain text, and unknown kinds read as quests. null when it isn't a coverage file at all.
export function readCoverage(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const f = raw.forever_only && typeof raw.forever_only === "object" ? raw.forever_only : {};
  const known = num(f.quests_known);
  const cap = (n, total) => (total ? Math.min(n, total) : n);
  const zones = (Array.isArray(raw.zones) ? raw.zones : []).map(z => {
    const quests = num(z?.quests);
    return { zone: text(z?.zone) || OTHER, quests, withText: cap(num(z?.with_text), quests), narrated: cap(num(z?.narrated), quests) };
  }).filter(z => z.quests > 0);
  const wanted = (Array.isArray(raw.wanted) ? raw.wanted : []).map(w => ({
    kind: Object.hasOwn(KINDS, w?.kind) ? w.kind : "quest",
    id: text(w?.id, 24),
    name: text(w?.name, 100),
    zone: text(w?.zone) || OTHER,
    level: num(w?.level) || null,
  })).filter(w => w.name);
  return {
    generated: when(raw.generated),
    forever: { known, withText: cap(num(f.quests_with_text), known), narrated: cap(num(f.narrated), known) },
    zones,
    wanted,
  };
}

export async function loadCoverage(env, request) {
  try {
    const res = await env.ASSETS.fetch(new URL("/data/coverage.json", request.url));
    if (!res.ok) return null;
    return readCoverage(await res.json());
  } catch (e) {
    return null;   // not written yet (the first nightly ingest makes it), or not JSON
  }
}

// The wanted list by zone, lowest level first, each zone's entries by level then name; entries without a level go
// last. [{zone, items, min, max}]
export function groupWanted(wanted) {
  const zones = new Map();
  for (const w of wanted) {
    if (!zones.has(w.zone)) zones.set(w.zone, []);
    zones.get(w.zone).push(w);
  }
  const lv = x => x ?? Infinity;
  return [...zones].map(([zone, items]) => {
    items.sort((a, b) => lv(a.level) - lv(b.level) || a.name.localeCompare(b.name));
    const levels = items.map(w => w.level).filter(Boolean);
    return { zone, items, min: levels.length ? Math.min(...levels) : null, max: levels.length ? Math.max(...levels) : null };
  }).sort((a, b) => (lv(a.min) - lv(b.min)) || (a.zone === OTHER) - (b.zone === OTHER) || a.zone.localeCompare(b.zone));
}

const levels = g => g.min === null ? "" : g.min === g.max ? `level ${g.min}` : `levels ${g.min}&ndash;${g.max}`;
const width = (n, total) => (total ? Math.round((1000 * n) / total) / 10 : 0);

function hero(f) {
  if (!f.known && !f.withText) {
    return `<section class="pg-hero">
    <p class="pg-kicker">Forever's new content</p>
    <p class="pg-of">The first count comes with the next nightly update. Every quest you send in shows up here.</p>
  </section>`;
  }
  return `<section class="pg-hero" aria-label="Forever's new content">
    <p class="pg-kicker">Forever's new content</p>
    <p class="pg-big"><span><strong>${count(f.withText)}</strong> ${f.withText === 1 ? "quest" : "quests"} captured</span>
      <span><strong>${count(f.narrated)}</strong> narrated</span></p>
    ${f.known ? `<p class="pg-of">of the ${plural(f.known, "quest")} new in Forever that we know of</p>` : ""}
  </section>`;
}

function zoneRows(zones) {
  return zones.map(z => `<li class="pg-zone">
        <div class="pg-zone-head"><span class="pg-zone-name">${escape(z.zone)}</span>
          <span class="pg-zone-n">${count(z.withText)} of ${plural(z.quests, "quest")}${z.narrated ? ` &middot; ${count(z.narrated)} narrated` : ""}</span></div>
        <div class="pg-bar" aria-hidden="true"><span class="pg-text" style="width:${width(z.withText, z.quests)}%"></span><span class="pg-voice" style="width:${width(z.narrated, z.quests)}%"></span></div>
      </li>`).join("\n      ");
}

function wantedZones(groups) {
  return groups.map(g => {
    const shown = g.items.slice(0, PER_ZONE);
    const more = g.items.length - shown.length;
    const meta = [levels(g), `${count(g.items.length)} wanted`].filter(Boolean).join(" &middot; ");
    return `<details class="pg-wzone">
        <summary><span class="pg-wname">${escape(g.zone)}</span> <span class="pg-wmeta">${meta}</span></summary>
        <ul>
          ${shown.map(w => `<li><span class="pg-lvl" title="Level">${w.level ?? "&ndash;"}</span> <span class="pg-wtitle">${escape(w.name)}</span>${KINDS[w.kind] ? ` <span class="tag tag-draft">${KINDS[w.kind]}</span>` : ""}</li>`).join("\n          ")}
        </ul>${more > 0 ? `\n        <p class="pf-more">and ${count(more)} more</p>` : ""}
      </details>`;
  }).join("\n      ");
}

// /contribute/progress. cov: readCoverage's result or null. hidden: the "contribute" feature is off (noindex).
export function progressPage(cov, { hidden = true } = {}) {
  const groups = cov ? groupWanted(cov.wanted) : [];
  const body = `  <h1>Forever's story, line by line</h1>
  <p class="pitch">WoW Forever brought quests, people and places the old world never had. Players capture their words in
    game and send them in, and Lore Forever reads them to everyone. Here's how far we've come.</p>
  <p class="vp-actions"><a class="btn-small" href="/contribute">Send your text</a>
    ${groups.length ? '<a class="btn-small btn-small-alt" href="#wanted">See what\'s wanted</a>' : ""}</p>
  ${hero(cov?.forever || { known: 0, withText: 0, narrated: 0 })}
  <section class="vp-section pg-live" id="pg-live" aria-labelledby="live-title" hidden>
    <h2 id="live-title">Sent in by players</h2>
    <ul class="pf-stats pg-stats" aria-live="polite">
      <li><strong data-stat="lines">&ndash;</strong><span>Lines sent in</span></li>
      <li><strong data-stat="accepted">&ndash;</strong><span>Accepted</span></li>
      <li><strong data-stat="contributors">&ndash;</strong><span>Contributors</span></li>
      <li><strong data-stat="last_upload">&ndash;</strong><span>Last upload</span></li>
    </ul>
  </section>
  ${cov?.zones.length ? `<section class="vp-section" aria-labelledby="zones-title">
    <h2 id="zones-title">Zone by zone</h2>
    <p class="pg-legend"><span class="pg-key pg-key-text"></span> text captured <span class="pg-key pg-key-voice"></span> narrated</p>
    <ul class="pg-zones">
      ${zoneRows(cov.zones)}
    </ul>
  </section>` : ""}
  ${groups.length ? `<section class="vp-section" id="wanted" aria-labelledby="wanted-title">
    <h2 id="wanted-title">Wanted</h2>
    <p>Forever quests and people we know are out there but haven't heard the words of yet. Pick one up in game (or
      talk to them), then press Contribute: <a href="/contribute">here's how</a>.</p>
    <div class="pg-wanted">
      ${wantedZones(groups)}
    </div>
  </section>` : ""}
  <p class="vp-note">${cov?.generated ? `Updated nightly; last on ${shortDate(cov.generated)}. ` : "Updated nightly. "}Everyone who
    finds text is thanked on <a href="/contributors">Contributors</a>.</p>`;
  return page({
    title: "Forever text: progress",
    description: "How much of WoW Forever's new quests Lore Forever has captured and narrated so far, and what's still wanted.",
    path: "/contribute/progress",
    crumbs: '<a href="/contribute">Contribute</a> &rsaquo; Progress',
    body,
    robots: hidden ? "noindex" : undefined,
    foot: `<p>Found a Forever quest that isn't here? <a href="/contribute">Send it in</a>.</p>`,
    scripts: '<script src="/js/contribute-progress.js" defer></script>',
  });
}
