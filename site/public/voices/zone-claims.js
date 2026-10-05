// "Claim a zone" on the upload page (LOR-231): the claim box at the top of /voices/studio and the list of zones with
// who narrates what. studio.js draws it with zonesHtml() and wires it with bindZones(); the API is
// /api/studio/zones/* (functions/api/studio/zones/[action].js, lib/claims.js). Signed out, the list still shows and
// Claim leads to sign-in. Your own claim's progress is worked out here from your takes, so it moves as you upload.

import { zoneList, zoneProgress, readingMinutes } from "/voices/zone-list.js";

let data = null;        // GET /api/studio/zones/list
let showAll = false, busy = "", error = "";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const lines_ = n => `${n} line${n === 1 ? "" : "s"}`;
const day = iso => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Loads the zone list: your voice's language when there's a voice, else the language on show.
export async function loadZones(voiceId, locale) {
  const q = voiceId ? `?voice=${encodeURIComponent(voiceId)}` : `?locale=${encodeURIComponent(locale)}`;
  try {
    const r = await fetch(`/api/studio/zones/list${q}`, { cache: "no-store" });
    data = await r.json();
  } catch (e) {
    data = { ok: false };
  }
  return data;
}

// Whether the page shows zones at all: the "zones" feature (site/lib/features.js, `on` in the list), or ?zones=1 in
// the address while it's off, for previews and the develop site.
export const zonesVisible = () => Boolean(data?.ok && (data.on || new URLSearchParams(location.search).has("zones")));

// Your active claim ({id, zone, name, ...}) or null (always null while zones are hidden).
export const activeClaim = () => (zonesVisible() && data.mine?.active) || null;

async function post(action, body) {
  try {
    const r = await fetch(`/api/studio/zones/${action}`, { method: "POST", headers: { "Content-Type": "application/json" },
                                                           body: JSON.stringify(body), cache: "no-store" });
    return await r.json().catch(() => ({ ok: false, error: `The server answered ${r.status}. Please try again.` }));
  } catch (e) {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

function bar(done, total) {
  return `<div class="st-track"><i style="width:${total ? Math.round(done / total * 100) : 0}%"></i></div>`;
}

// ctx (from studio.js): {lines, locale, takes, signedIn, signIn, displayName}
function claimButton(ctx, z, label = "Claim") {
  if (!ctx.signedIn) return `<a class="st-b" href="${esc(ctx.signIn)}">Sign in to claim</a>`;
  return `<button class="st-b" type="button" data-zone-claim="${esc(z.key)}"${busy ? " disabled" : ""}>${esc(label)}</button>`;
}

function rowHtml(ctx, z, mins) {
  const c = z.claim;
  let status;
  // Signed out, one sign-in button (in the suggestion above) is enough; signed in, each open zone has Claim.
  if (!c) status = `<span class="st-zstatus open">Open</span>${activeClaim() || !ctx.signedIn ? "" : claimButton(ctx, z)}`;
  else if (c.status === "done") status = `<span class="st-zstatus done">Narrated by ${c.voice ? `<a href="/voices/${esc(c.voice)}">${esc(c.credit)}</a>` : esc(c.credit)} ✓</span>`;
  else status = `<span class="st-zstatus taken">${esc(c.credit)} · ${c.total ? Math.round(c.done / c.total * 100) : 0}%</span>`;
  return `<li class="st-zrow"><span class="st-zname">${esc(z.name)}${z.starter ? ` <em>starter</em>` : ""}</span>
    <span class="st-zmeta">${lines_(z.lines)} · ~${mins[z.key] || 1} min</span><span class="st-zact">${status}</span></li>`;
}

export function zonesHtml(ctx) {
  if (!zonesVisible() || !data.zones?.length) return "";
  const local = Object.fromEntries(zoneList(ctx.lines, data.locale).map(z => [z.key, z]));
  const mins = Object.fromEntries(Object.values(local).map(z => [z.key, readingMinutes(z, ctx.lines, data.locale)]));
  const mine = data.mine || { active: null, done: [] };
  const a = mine.active;
  const err = error ? `<p class="st-note bad">${esc(error)}</p>` : "";
  let head;
  if (a) {
    const z = local[a.zone];
    const p = z ? zoneProgress(z, ctx.takes) : { done: a.done, total: a.total };
    const left = z ? Math.max(0, Math.round(mins[a.zone] * (1 - p.done / Math.max(1, p.total)))) : 0;
    head = `<div class="st-claim"><span class="st-eyebrow">Your zone</span>
      <h2>${esc(a.name)}</h2>
      ${bar(p.done, p.total)}
      <p><strong>${p.done}</strong> of ${lines_(p.total)} recorded${left ? ` · about ${left} min of reading left` : ""}. The next-line box
        below goes through this zone first. Upload a line by <b>${esc(day(a.expires))}</b> to keep it: a claim holds for 14 days
        after each upload.</p>
      <p class="st-claim-acts"><button class="st-b" type="button" data-zone-only="${esc(a.zone)}">Show only this zone</button>
        <button class="st-b ghost" type="button" data-zone-release="${esc(a.id)}"${busy ? " disabled" : ""}>Let it go</button></p>
      ${err}</div>`;
  } else {
    const s = data.zones.find(z => z.key === mine.suggest) || data.zones.find(z => !z.claim && z.starter) || data.zones.find(z => !z.claim);
    head = `<div class="st-claim"><span class="st-eyebrow">Claim a zone</span>
      <h2>Narrate one zone, start to finish</h2>
      <p>A zone is its story and the places and people in it: an evening or two of reading. Your voice plays in game
        wherever you've recorded a line, and the rest stays in the default voice. The zone stays yours while you upload
        at least once every 14 days.</p>
      ${s ? `<div class="st-suggest"><span>Suggested: <b>${esc(s.name)}</b> · ${lines_(s.lines)} · about ${mins[s.key] || 1} min</span>
        ${claimButton(ctx, s, `Claim ${s.name}`)}</div>` : `<p>Every zone in this language is claimed. Record any line below.</p>`}
      ${ctx.signedIn ? `<label class="st-credit">Shown on the zone list as
        <input id="st-zone-credit" maxlength="60" value="${esc(ctx.displayName || "")}" placeholder="A name, a handle, or Anonymous"></label>` : ""}
      ${err}</div>`;
  }
  const done = mine.done?.length ? `<p class="st-zdone">You've narrated: ${mine.done.map(d => `<b>${esc(d.name)}</b> ✓`).join(", ")}.
    They're in your test pack below.</p>` : "";
  const claimed = data.zones.filter(z => z.claim).length;
  return `<section class="st-zones" id="st-zones">${head}${done}
    <details class="st-zlist"${showAll ? " open" : ""}><summary>All ${data.zones.length} zones · ${claimed} claimed</summary>
      <ul>${data.zones.map(z => rowHtml(ctx, z, mins)).join("")}</ul>
      <p class="st-note"><a href="/voices/zones">Who narrates which zone</a>, for everyone to see.</p></details></section>`;
}

// ctx (from studio.js): {voiceId(), startVoice(), voiceError(), onZoneOnly(key), rerender(), locale()}
export function bindZones(ctx) {
  const box = document.getElementById("st-zones");
  if (!box) return;
  box.querySelector("details")?.addEventListener("toggle", e => { showAll = e.target.open; });
  box.addEventListener("click", async e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.zoneOnly) return ctx.onZoneOnly(b.dataset.zoneOnly);
    if (b.dataset.zoneClaim) {
      busy = b.dataset.zoneClaim; error = "";
      const credit = document.getElementById("st-zone-credit")?.value || "";
      ctx.rerender();
      const voice = ctx.voiceId() || await ctx.startVoice();
      if (!voice) { busy = ""; error = ctx.voiceError?.() || "Couldn't start your voice. Please try again."; return ctx.rerender(); }
      const res = await post("claim", { voice, zone: busy, credit });
      busy = "";
      if (!res.ok) error = res.error;
      await loadZones(ctx.voiceId(), ctx.locale());
      ctx.rerender();
      if (res.ok) document.getElementById("st-zones")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (b.dataset.zoneRelease) {
      if (!confirm("Let this zone go? Your recordings stay; the zone opens up for other narrators.")) return;
      busy = "release"; error = "";
      const res = await post("release", { id: Number(b.dataset.zoneRelease) });
      busy = "";
      if (!res.ok) error = res.error;
      await loadZones(ctx.voiceId(), ctx.locale());
      ctx.rerender();
    }
  });
}
