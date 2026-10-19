// /admin's Growth > Retention (functions/api/admin/retention.js, lib/retention.js): Willo plans by the week they
// started, how many are still on after 1, 2, 3... weeks, how many were cancelled and when, Patrick's one-line summary,
// the cancellation log with the reasons players gave, a note to one player who cancelled (lib/winback.js), and two
// CSVs. Loaded by admin-page.js when Growth opens.

import { cohortCsv, subscriberCsv } from "/retention-csv.js?v=20261019r";

const usd = cents => cents === null || cents === undefined ? "—" : `$${(cents / 100).toFixed(2)}`;
const KIND = { scheduled: "Cancelled", now: "Cancelled now", ended: "Ended", undone: "Taken back" };
// Why a cancellation can't get a note (lib/winback.js noteStates), as the table says it.
const NOTE = { "taken back": "taken back", "no account": "account deleted", "opted out": "unsubscribed",
  "not counted": "", "not this one": "" };
const SENT = { sent: "sent", off: "not sent (no email service here)", opted_out: "not sent (unsubscribed)",
  no_address: "not sent (no address)" };
const PLAN = { hero: "Hero", champion: "Champion", legend: "Legend" };

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...kids.filter(k => k !== null && k !== undefined && k !== false));
  return node;
}

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A cohort's cell: "3 of 4" and its share, or "—" for weeks that haven't come yet.
const keptCell = k => k ? el("td", { title: `${k.kept} of the ${k.of} old enough were still on`,
  text: `${k.kept}/${k.of} (${Math.round(100 * k.kept / k.of)}%)` }) : el("td", { class: "ad-empty", text: "—" });
const cancelledCell = c => {
  const by = Object.entries(c.cancelledBy).sort((a, b) => a[0] - b[0])
    .map(([w, n]) => `${n} ${Number(w) === 0 ? "in week 1" : `in week ${Number(w) + 1}`}`);
  return el("td", { text: c.cancelled ? `${c.cancelled}${by.length ? ` (${by.join(", ")})` : ""}` : "0" });
};

export function loadRetention(key, $ = id => document.getElementById(id)) {
  let last = null, writing = null;
  const say = msg => { $("ret-status").hidden = !msg; $("ret-status").textContent = msg || ""; };
  async function render() {
    say("");
    let res;
    try {
      const r = await fetch(`/api/admin/retention${$("ret-paid").checked ? "?paid=1" : ""}`, { cache: "no-store",
        headers: { Authorization: "Bearer " + key() } });
      res = await r.json().catch(() => ({}));
      if (!r.ok || !res.ok) throw new Error(res.error || `Request failed (${r.status})`);
    } catch (e) { say(e.message); return; }
    last = res;
    $("ret-summary").textContent = res.summary;
    const left = [res.leftOut.comped ? `${res.leftOut.comped} comped` : "", res.leftOut.team ? `${res.leftOut.team} team or test` : "",
      res.leftOut.notCharged ? `${res.leftOut.notCharged} not charged yet` : ""].filter(Boolean);
    $("ret-note").textContent = [
      res.totals.notCharged && !res.paidOnly ? `${res.totals.notCharged} of them haven't been charged yet (the beta's plans ` +
        "that first pay on November 4, and trials)." : "",
      `Paid so far: ${usd(res.totals.paidCents)}.`,
      left.length ? `Left out: ${left.join(", ")}.` : "",
      res.totals.unread ? `${res.totals.unread} plans' payments are still being read from Stripe; reload for them.` : "",
    ].filter(Boolean).join(" ");
    $("ret-head").replaceChildren(el("tr", {}, el("th", { text: "Started (week of)" }), el("th", { text: "Plans" }),
      el("th", { title: "Nothing charged yet: first charge on November 4, or a trial", text: "Not charged yet" }),
      el("th", { text: "Cancelled" }),
      ...Array.from({ length: res.weeks }, (_, i) => el("th", { text: `After ${i + 1} wk` }))));
    $("ret-rows").replaceChildren(...res.cohorts.map(c => el("tr", {}, el("td", { text: c.week }), el("td", { text: String(c.n) }),
      el("td", { text: String(c.notCharged) }), cancelledCell(c), ...c.kept.map(keptCell))));
    if (!res.cohorts.length) $("ret-rows").replaceChildren(el("tr", {}, el("td", { colspan: String(4 + res.weeks),
      class: "ad-empty", text: "No plans yet." })));
    $("ret-log").replaceChildren(...res.cancellations.map(c => el("tr", {},
      el("td", { text: c.at.slice(0, 10) }), el("td", { text: KIND[c.kind] || c.kind }), el("td", { text: PLAN[c.plan] || "—" }),
      el("td", { text: c.kept || "—" }), el("td", { text: c.paid === 0 ? "never charged" : usd(c.paid) }),
      el("td", { text: c.kind === "scheduled" && c.ends ? c.ends.slice(0, 10) : "" }),
      el("td", { text: c.reason || (c.kind === "undone" ? "" : "none given") }), el("td", { text: c.comment }),
      el("td", {}, c.written ? `${SENT[c.written.status] || c.written.status} ${c.written.at.slice(0, 10)}`
        : c.note === "yes" ? el("button", { type: "button", text: "Write…", onclick: () => openNote(c) })
        : NOTE[c.note] ?? ""))));
    if (!res.cancellations.length) $("ret-log").replaceChildren(el("tr", {}, el("td", { colspan: "9", class: "ad-empty",
      text: "No cancellations logged yet. The log starts with this page; earlier ones still count in the table above." })));
  }
  // The note box for one cancellation: the template, then Send asks once more before it goes.
  const sayNote = (msg, good) => { $("ret-note-status").hidden = !msg; $("ret-note-status").textContent = msg || "";
    $("ret-note-status").classList.toggle("fb-good", Boolean(good)); };
  function openNote(c) {
    writing = c;
    $("ret-note-title").textContent = `Write to the player who cancelled ${PLAN[c.plan] || "a plan"} on ${c.at.slice(0, 10)}`;
    $("ret-note-subject").value = last.template.subject;
    $("ret-note-text").value = last.template.text;
    sayNote("");
    $("ret-note-form").hidden = false;
    $("ret-note-form").scrollIntoView({ block: "nearest" });
  }
  async function sendNote(e) {
    e.preventDefault();
    if (!writing || !confirm("Send this note now? It goes once, from patrick@loreforeverwow.com.")) return;
    try {
      const r = await fetch("/api/admin/retention", { method: "POST", cache: "no-store",
        headers: { Authorization: "Bearer " + key(), "Content-Type": "application/json" },
        body: JSON.stringify({ action: "write", id: writing.id, subject: $("ret-note-subject").value, text: $("ret-note-text").value }) });
      const res = await r.json().catch(() => ({}));
      if (!r.ok || !res.ok) throw new Error(res.error || `Request failed (${r.status})`);
      const said = SENT[res.status] || res.status;
      sayNote(res.status === "sent" ? "Sent. Replies go to patrick@loreforeverwow.com." : `${said[0].toUpperCase()}${said.slice(1)}.`,
        res.status === "sent");
      writing = null;
      await render();
    } catch (err) { sayNote(err.message); }
  }
  if (!$("ret-paid").dataset.wired) {
    $("ret-note-form").addEventListener("submit", sendNote);
    $("ret-note-cancel").addEventListener("click", () => { writing = null; $("ret-note-form").hidden = true; });
    $("ret-paid").dataset.wired = "1";
    $("ret-paid").addEventListener("change", render);
    $("ret-csv").addEventListener("click", () => last && download(cohortCsv(last), `retention-by-week-${last.now.slice(0, 10)}.csv`));
    $("ret-csv-subs").addEventListener("click", () => last && download(subscriberCsv(last), `subscribers-${last.now.slice(0, 10)}.csv`));
  }
  return render();
}
