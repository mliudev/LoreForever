// /contribute/r/<upload id>: what became of one upload of Forever text (LOR-235). Public by its link, and holds no
// names, hashes or addresses: the lines, their quest, NPC or book, and their status now (new, accepted, confirmed,
// in Lore Forever X.Y.Z). Spoken's contributors couldn't see what happened to their lines; this is the page for that.

import { page, escape } from "../../../lib/voices.js";
import { setup as setupAccounts } from "../../../lib/accounts.js";
import { setup, receipt } from "../../../lib/contribute.js";

const html = (body, status) => new Response(body, {
  status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Robots-Tag": "noindex" },
});

const KIND_LABEL = { quest: "Quest", gossip: "Gossip", book: "Book", say: "Said aloud" };
const PART_LABEL = { detail: "quest text", objectives: "objectives", progress: "progress", complete: "completion",
                     title: "title" };

function where(l) {
  if (l.kind === "quest") return `Quest ${escape(l.ref_id)} &middot; ${escape(PART_LABEL[l.part] || l.part)}`;
  if (l.kind === "book") return `${escape(l.ref_id)} &middot; page ${escape(l.part)}`;
  const npc = l.ref_id.startsWith("n:") ? escape(l.ref_id.slice(2)) : l.speaker ? escape(l.speaker) : `NPC ${escape(l.ref_id)}`;
  return `${KIND_LABEL[l.kind]} &middot; ${npc}`;
}

const when = t => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const plural = (n, one, many) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

export function receiptPage(r) {
  const b = r.batch;
  const counts = {};
  for (const l of r.lines) counts[l.shown.key] = (counts[l.shown.key] || 0) + 1;
  const summary = [
    plural(b.n_new, "new line", "new lines"),
    b.n_confirmed ? `${plural(b.n_confirmed, "line", "lines")} someone else had shared, now confirmed by you` : "",
    b.n_known ? `${plural(b.n_known, "line", "lines")} Lore Forever already had` : "",
  ].filter(Boolean).join(" &middot; ");
  const rows = r.lines.map(l => `      <li class="cr-line cr-${escape(l.shown.key)}">
        <p class="cr-where">${where(l)} <span class="cr-status">${escape(l.shown.label)}</span></p>
        <p class="cr-text">${escape(l.text.length > 600 ? l.text.slice(0, 600) + "..." : l.text)}</p>
      </li>`).join("\n");
  const body = `  <h1>Your shared text</h1>
  <p class="pitch">Shared ${escape(when(b.created_at))}: ${summary}.</p>
  ${b.rejected ? '<p class="vp-note">This upload was set aside as spam, so its lines aren\'t used.</p>' : ""}
  <p class="vp-note">New lines are accepted after 48 hours, or as soon as a second player shares the same words.
    Accepted lines go into the next update; this page shows where each one is. Keep the link to come back.</p>
  ${r.lines.length ? `<ul class="cr-lines">\n${rows}\n  </ul>` : `<p>Nothing new in this upload: everything in it was already in Lore Forever. Thanks all the same!</p>`}
  <p><a class="btn-small" href="/contribute">Share more</a></p>`;
  return page({
    title: "Your shared text", description: "What became of the Forever text you shared with Lore Forever.",
    path: `/contribute/r/${b.upload_id}`, crumbs: '<a href="/contribute">Share Forever text</a> &rsaquo; Receipt',
    body, robots: "noindex", scripts: "",
    foot: "<p>Shared text helps every Lore Forever player. Thank you.</p>",
  });
}

export async function onRequestGet({ env, params }) {
  const id = String(params.id || "").toLowerCase();
  const missing = () => html(page({
    title: "No upload here", description: "No shared text with that link.", path: `/contribute/r/${escape(id)}`,
    crumbs: '<a href="/contribute">Share Forever text</a>', robots: "noindex", scripts: "",
    body: `  <h1>No upload here</h1>\n  <p>There's no shared text with that link. Check that it was copied whole.</p>`,
  }), 404);
  if (!env.DB) return missing();
  await setupAccounts(env);
  await setup(env);
  const r = await receipt(env, id);
  return r ? html(receiptPage(r), 200) : missing();
}
