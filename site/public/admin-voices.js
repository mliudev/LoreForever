// The /admin/voices.html page's script: draws the latest voice work snapshot the PC posted (GET /api/admin/voice-status).
// A file rather than inline because /admin's Content-Security-Policy (public/_headers) runs no inline script. Every
// piece of the snapshot goes in as text (never as HTML), and PR links must be GitHub's.

const $ = id => document.getElementById(id);
const REFRESH_MS = 60e3;     // asks the site for the latest this often
const AMBER_MIN = 30, RED_MIN = 120;   // minutes before the picture counts as late, then as stale

// ---- the admin key, kept as /admin keeps it: sessionStorage, or localStorage when "Remember" is ticked ----
function getKey() {
  try { return sessionStorage.getItem("lf-admin") || localStorage.getItem("lf-admin"); } catch (e) { return null; }
}
let memoryKey = null;   // used when storage is blocked
function setKey(k, remember) {
  memoryKey = k;
  try { sessionStorage.removeItem("lf-admin"); localStorage.removeItem("lf-admin"); } catch (e) {}
  if (k) try { (remember ? localStorage : sessionStorage).setItem("lf-admin", k); } catch (e) {}
}
const key = () => memoryKey || getKey();

function signOut(message) {
  setKey(null);
  $("dash").hidden = true;
  $("login").hidden = false;
  $("login-error").textContent = message || "";
  $("login-error").hidden = !message;
}

async function fetchStatus() {
  const r = await fetch("/api/admin/voice-status", { cache: "no-store", headers: { Authorization: "Bearer " + key() } });
  if (r.status === 401) { signOut("That key didn't work."); throw new Error("unauthorized"); }
  const res = await r.json().catch(() => ({}));
  if (!r.ok || !res.ok) throw new Error(res.error || "Request failed (" + r.status + ")");
  return res;
}

// ---- helpers ----
const SVG = "http://www.w3.org/2000/svg";
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v === true ? "" : v);
  }
  n.append(...kids.filter(k => k != null && k !== false));
  return n;
};
const num = v => (Number.isFinite(v) ? v : 0).toLocaleString();
const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, Math.round((100 * a) / b))) : 0);
const list = v => (Array.isArray(v) ? v : []);
const time = v => { const t = Date.parse(v); return Number.isNaN(t) ? null : t; };

// "just now", "4 min ago", "2 h 5 min ago", "3 days ago"
function ago(ms) {
  const m = Math.floor(Math.max(0, ms) / 60e3);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  const h = Math.floor(m / 60);
  if (h < 6) return h + " h" + (m % 60 ? " " + (m % 60) + " min" : "") + " ago";
  if (h < 48) return h + " h ago";
  const d = Math.floor(h / 24);
  return d + " days ago";
}
const agoOf = iso => { const t = time(iso); return t == null ? "" : ago(Date.now() - t); };
const safeLink = url => (/^https:\/\/github\.com\//.test(url || "") ? url : null);

const pill = (cls, text, title) => el("span", { class: "vw-pill " + cls, text, title });
const bar = (value, cls = "", thin = false) =>
  el("div", { class: "vw-bar " + cls + (thin ? " thin" : ""), role: "presentation" }, el("span", { style: "width:" + Math.max(0, Math.min(100, value)) + "%" }));
const meter = (label, valueText, value, cls) =>
  el("div", { class: "vw-meter" }, el("div", {}, label + " ", el("b", { text: valueText })), bar(value, cls));

// ---- the freshness line ----
let snapshot = null;      // {status, received_at, history}
function renderFresh() {
  const box = $("fresh");
  const made = snapshot && snapshot.status ? time(snapshot.status.generated_at) : null;
  box.className = "vw-fresh";
  if (made == null) {
    $("fresh-age").textContent = snapshot ? "No picture yet" : "Loading";
    $("fresh-note").textContent = "The PC posts a new picture every 10 minutes.";
    return;
  }
  const mins = (Date.now() - made) / 60e3;
  const level = mins > RED_MIN ? "bad" : mins > AMBER_MIN ? "warn" : "ok";
  box.classList.add(level);
  $("fresh-age").textContent = "Updated " + ago(Date.now() - made);
  $("fresh-note").textContent = level === "ok"
    ? "The PC posts a new picture every 10 minutes."
    : "The PC posts every 10 minutes, so it may have stopped: this is " + (level === "bad" ? "stale" : "late") + ".";
}

// ---- summary tiles and the machines ----
const MACHINE_STATE = {
  recording: ["ok live", "Recording"], waiting: ["warn", "Waiting"], held: ["warn", "On hold"],
  idle: ["idle", "Idle"], offline: ["bad", "Offline"],
};

function sparkline(points) {
  if (points.length < 2) return null;
  const w = 160, h = 28, lo = Math.min(...points), hi = Math.max(...points), span = Math.max(hi - lo, 1);
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, h - 3 - ((p - lo) / span) * (h - 6)]);
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("class", "vw-spark");
  svg.setAttribute("role", "img");
  svg.setAttribute("preserveAspectRatio", "none");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", xy.map(([x, y], i) => (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1)).join(" "));
  path.setAttribute("vector-effect", "non-scaling-stroke");
  const dot = document.createElementNS(SVG, "circle");
  dot.setAttribute("cx", xy.at(-1)[0].toFixed(1));
  dot.setAttribute("cy", xy.at(-1)[1].toFixed(1));
  dot.setAttribute("r", "3");
  svg.append(path, dot);
  return svg;
}

function totals(status) {
  let current = 0, count = 0;
  for (const c of Object.values((status.matrix || {}).cells || {})) {
    if (c && c.status === "live") { current += c.current || 0; count += c.count || 0; }
  }
  const q = (status.matrix || {}).questgivers;
  if (q) { current += q.current || 0; count += q.count || 0; }
  return { current, count };
}

function renderSummary(status, history) {
  const t = totals(status);
  const jobs = list(status.jobs);
  const running = jobs.filter(j => j.state === "running");
  const ahead = jobs.filter(j => j.state === "queued" || j.state === "planned");
  const names = machineNames(status);
  const series = history.filter(h => h.count > 0).map(h => (100 * h.current) / h.count);
  const spark = sparkline(series);
  const tile = (label, value, sub, extra) => el("div", { class: "ad-panel vw-tile" },
    el("div", { class: "ad-label", text: label }), el("div", { class: "ad-num", text: value }),
    el("div", { class: "ad-sub vw-sub", text: sub }), extra);
  $("summary").replaceChildren(
    tile("Recordings up to date", pct(t.current, t.count) + "%", `${num(t.current)} of ${num(t.count)} shipped recordings`,
      spark ? el("div", { title: "Over the last " + series.length + " pictures" }, spark) : bar(pct(t.current, t.count), "ok", true)),
    tile("Running now", String(running.length),
      running.length ? [...new Set(running.map(j => names[j.machine] || j.machine))].join(" and ") : "Nothing is recording"),
    tile("Coming up", String(ahead.length), ahead.length ? "queued or planned" : "Nothing lined up"));
}

function machineNames(status) {
  const out = {};
  for (const m of list(status.machines)) out[m.id] = m.name || m.id;
  return out;
}

function renderMachines(status) {
  const jobs = list(status.jobs);
  const cards = list(status.machines).map(m => {
    const [cls, label] = MACHINE_STATE[m.state] || ["idle", m.state || "Unknown"];
    const running = jobs.filter(j => j.machine === m.id && j.state === "running");
    const doing = running.length ? running.map(j => j.title).join(" / ") : m.detail || "";
    const flags = [];
    if (m.game) flags.push(pill("warn hollow", "Game running: " + m.game, "Recording pauses while a game is open"));
    if (m.hold) flags.push(pill("bad", "GPU on hold", "Only Mike lifts this"));
    if (m.gentle) flags.push(pill("idle hollow", `Gentle mode: ${Math.round((m.gentle.mem_fraction || 0) * 100)}% of GPU memory, ${Math.round((m.gentle.duty || 0) * 100)}% of the time`,
      "Recording shares the GPU so Windows stays smooth"));
    if (m.native_paused) flags.push(pill("idle hollow", "Native-accent recording paused"));
    const g = m.gpu;
    const disk = typeof m.disk === "string" ? Number.parseInt(m.disk, 10) : null;
    return el("article", { class: "ad-panel vw-machine" },
      el("header", {}, el("h3", { text: m.name || m.id }), pill(cls, label)),
      m.hardware ? el("div", { class: "vw-hw", text: m.hardware }) : null,
      doing ? el("p", { class: "vw-doing", text: doing }) : null,
      running.length && m.detail ? el("p", { class: "vw-last", text: "Latest: " + m.detail }) : null,
      g && g.mem_total_mb ? meter("GPU load", (g.util ?? 0) + "%", g.util ?? 0, g.util > 90 ? "warn" : "") : null,
      g && g.mem_total_mb ? meter("GPU memory", `${(g.mem_used_mb / 1024).toFixed(1)} of ${(g.mem_total_mb / 1024).toFixed(1)} GB`, pct(g.mem_used_mb, g.mem_total_mb), pct(g.mem_used_mb, g.mem_total_mb) > 90 ? "warn" : "") : null,
      Number.isFinite(disk) ? meter("Disk", disk + "% used", disk, disk > 92 ? "bad" : disk > 80 ? "warn" : "ok") : null,
      flags.length ? el("div", { class: "vw-flags" }, ...flags) : null);
  });
  const asks = list(status.decisions).map(d => (typeof d === "string" ? d : d && d.text)).filter(Boolean);
  if (asks.length) {
    cards.push(el("article", { class: "ad-panel vw-machine vw-tile ask" },
      el("header", {}, el("h3", { text: "Waiting on Mike" }), pill("warn", asks.length === 1 ? "1 decision" : asks.length + " decisions")),
      el("ul", { class: "vw-ask" }, ...asks.map(text => el("li", { text })))));
  }
  $("machines").replaceChildren(...cards);
}

// ---- the matrix ----
const CELL_STATUS = { live: "Shipped", soon: "Coming", paused: "Paused", retired: "Retired", none: "None" };
const ACTIVITY = { recording: "Recording now", planned: "Planned", "next-release": "Next release" };
let picked = null;   // "row|col" of the box whose note is open

function activityTag(a) {
  return a ? el("span", { class: "vw-act " + a, text: ACTIVITY[a] || a }) : null;
}
function cellInfo(cell) {
  return cell ? CELL_STATUS[cell.status] || cell.status : "";
}

function renderLegend() {
  $("legend").replaceChildren(
    ...["live", "soon", "paused", "retired"].map(s => el("span", {}, el("span", { class: "vw-chip " + s, text: CELL_STATUS[s] }),
      { live: "in the download", soon: "not out yet", paused: "held back", retired: "no longer made" }[s])),
    el("span", {}, activityTag("recording"), "being recorded"), el("span", {}, activityTag("planned"), "lined up"),
    el("span", {}, activityTag("next-release"), "ships in the next release"),
    el("span", {}, el("span", { class: "vw-note-dot" }), "has a note"));
}

function renderMatrix(status) {
  const m = status.matrix || {};
  const cols = list(m.columns), rows = list(m.rows), cells = m.cells || {};
  if (!cols.length || !rows.length) {
    $("matrix").replaceChildren(el("tbody", {}, el("tr", {}, el("td", { class: "ad-empty", text: "No matrix in this picture." }))));
    return;
  }
  // Languages in order, each with its voices.
  const groups = [];
  for (const c of cols) {
    const last = groups.at(-1);
    if (last && last.language === c.language) last.cols.push(c); else groups.push({ language: c.language, cols: [c] });
  }
  const starts = new Set(groups.map(g => g.cols[0].id));
  const head1 = el("tr", {}, el("th", { class: "corner", rowspan: "2", scope: "col", text: "Content" }),
    ...groups.map(g => el("th", { colspan: String(g.cols.length), scope: "colgroup", class: "lang-start", text: g.language })));
  const head2 = el("tr", {}, ...cols.map(c => el("th", { scope: "col", class: starts.has(c.id) ? "lang-start" : "", text: c.voice })));
  const body = rows.map(r => el("tr", {},
    el("th", { scope: "row", title: r.note || "" }, r.label, r.note ? el("small", { text: r.note }) : null),
    ...cols.map(c => {
      const id = r.id + "|" + c.id, cell = cells[id];
      const label = `${r.label}, ${c.language} ${c.voice}`;
      const btn = el("button", { type: "button", class: "vw-cellbtn", "aria-pressed": String(picked === id),
        title: [label, cellInfo(cell) || "Nothing", cell && cell.count ? num(cell.count) + " recordings" : "", cell && cell.note || ""].filter(Boolean).join(". ") },
        ...cellFace(cell));
      btn.addEventListener("click", () => { picked = picked === id ? null : id; renderMatrix(status); renderDetail(status); });
      return el("td", { class: starts.has(c.id) ? "lang-start" : "" }, btn);
    })));
  $("matrix").replaceChildren(el("thead", {}, head1, head2), el("tbody", {}, ...body));
}

function cellFace(cell) {
  if (!cell || cell.status === "none" || !cell.status) {
    return [el("span", { class: "vw-chip none", text: cell ? "None" : "–" })];
  }
  const live = cell.status === "live" && cell.count > 0;
  return [
    el("span", { class: "vw-chip " + cell.status, text: cellInfo(cell) }, cell.note ? el("span", { class: "vw-note-dot", title: "Has a note" }) : null),
    el("span", { class: "vw-n" + (cell.count ? "" : " none"), text: cell.count ? num(cell.count) : "–" }),
    live ? bar(pct(cell.current, cell.count), cell.current >= cell.count ? "ok" : "", true) : null,
    activityTag(cell.activity),
  ];
}

function renderDetail(status) {
  const box = $("cell-detail");
  box.hidden = !picked;
  if (!picked) return;
  const [rowId, colId] = picked.split("|");
  const m = status.matrix || {};
  const row = list(m.rows).find(r => r.id === rowId), col = list(m.columns).find(c => c.id === colId);
  const cell = (m.cells || {})[picked];
  if (!row || !col) { box.hidden = true; return; }
  box.replaceChildren(
    el("h3", { text: `${row.label}: ${col.language}, ${col.voice}` }),
    el("p", {}, cell ? pill(cell.status === "live" ? "ok" : cell.status === "paused" ? "warn" : cell.status === "soon" ? "info" : "idle", cellInfo(cell)) : pill("idle", "None"),
      cell && cell.activity ? " " : "", cell && cell.activity ? activityTag(cell.activity) : null),
    cell && cell.count ? el("p", { text: `${num(cell.count)} recordings, ${num(cell.current)} up to date (${pct(cell.current, cell.count)}%).` }) : null,
    el("p", { text: cell && cell.note ? cell.note : "No note." }));
}

// ---- quest givers: one strip, all their voices ----
function renderQuestgivers(status) {
  const q = (status.matrix || {}).questgivers;
  const box = $("questgivers");
  if (!q) { box.replaceChildren(el("p", { class: "ad-empty", text: "Not in this picture." })); return; }
  box.replaceChildren(
    el("div", { class: "vw-qhead" },
      el("div", { class: "vw-qnum", text: num(q.count) }),
      el("div", { class: "vw-sub", text: "recordings across all the people-and-gender voices" }),
      el("div", {}, el("span", { class: "vw-chip " + (q.count ? "live" : "soon"), text: q.count ? "Shipped" : "Coming" }), " ", activityTag(q.activity)),
      q.count ? bar(pct(q.current, q.count), q.current >= q.count ? "ok" : "", true) : null,
      q.count ? el("div", { class: "vw-sub", text: `${num(q.current)} of ${num(q.count)} up to date` }) : null),
    el("p", { text: q.note || "No note." }));
}

// ---- jobs, by machine ----
const JOB_STATE = {
  running: ["ok live", "Running"], queued: ["info", "Queued"], paused: ["warn", "Paused"], planned: ["idle hollow", "Planned"],
  failed: ["bad", "Failed"], done: ["ok hollow", "Done"],
};
const JOB_ORDER = ["running", "queued", "paused", "planned", "failed", "done"];
const KIND = { story: "stories", native: "native accents", retake: "re-takes", quest: "quest dialogue", other: "" };

function renderJobs(status) {
  const jobs = list(status.jobs);
  const names = machineNames(status);
  const ids = [...list(status.machines).map(m => m.id), ...jobs.map(j => j.machine)].filter((v, i, a) => v && a.indexOf(v) === i);
  const groups = ids.map(id => {
    const mine = jobs.map((j, i) => [j, i]).filter(([j]) => j.machine === id)
      .sort((a, b) => JOB_ORDER.indexOf(a[0].state) - JOB_ORDER.indexOf(b[0].state) || a[1] - b[1]).map(([j]) => j);
    const running = mine.filter(j => j.state === "running").length;
    return el("div", { class: "ad-panel vw-group" },
      el("h3", {}, names[id] || id, el("span", { class: "vw-sub", text: mine.length ? `${running} running, ${mine.length} in all` : "" })),
      mine.length ? el("div", {}, ...mine.map(jobRow)) : el("p", { class: "ad-empty", text: "No jobs." }));
  });
  $("jobs").replaceChildren(...(groups.length ? groups : [el("p", { class: "ad-empty", text: "No jobs in this picture." })]));
}
function jobRow(j) {
  const [cls, label] = JOB_STATE[j.state] || ["idle", j.state || "?"];
  const has = Number.isFinite(j.total) && j.total > 0;
  const done = Number.isFinite(j.done) ? j.done : 0;
  return el("div", { class: "vw-job" + (j.state === "done" ? " finished" : "") },
    pill(cls, label),
    el("p", { class: "vw-job-title" }, j.title || j.id, KIND[j.kind] ? el("span", { class: "vw-kind", text: KIND[j.kind] }) : null),
    has && j.state !== "done"
      ? meter(`${num(done)} of ${num(j.total)}`, `${j.unit || "done"} (${pct(done, j.total)}%)`, pct(done, j.total), j.state === "failed" ? "bad" : j.state === "paused" ? "warn" : "")
      : null);
}

// ---- PRs and events ----
function renderPrs(status) {
  const prs = list(status.prs);
  const state = p => String(p.state || "").toLowerCase();
  const row = (p, verb) => {
    const href = safeLink(p.url);
    return el("li", {}, href ? el("a", { href, text: "#" + p.number, target: "_blank", rel: "noopener" }) : el("span", { text: "#" + p.number }),
      el("span", { class: "vw-text", text: p.title || "" }),
      el("span", { class: "vw-when", text: p.updated ? verb + " " + agoOf(p.updated) : "" }));
  };
  const open = prs.filter(p => state(p) === "open"), merged = prs.filter(p => state(p) === "merged")
    .sort((a, b) => (time(b.updated) || 0) - (time(a.updated) || 0));
  $("prs-open").replaceChildren(...(open.length ? open.map(p => row(p, "updated")) : [el("li", { class: "ad-empty", text: "No open voice PRs." })]));
  $("prs-merged").replaceChildren(...(merged.length ? merged.map(p => row(p, "merged")) : [el("li", { class: "ad-empty", text: "None in the last few days." })]));
}
function renderEvents(status, names) {
  const ev = list(status.events).slice().sort((a, b) => (time(b.at) || 0) - (time(a.at) || 0));
  $("events").replaceChildren(...(ev.length ? ev.map(e => el("li", {},
    e.machine ? el("span", { class: "vw-tag", text: names[e.machine] || e.machine }) : null,
    el("span", { class: "vw-text", text: e.text || "" }),
    el("span", { class: "vw-when", text: agoOf(e.at), title: e.at || "" }))) : [el("li", { class: "ad-empty", text: "No events yet." })]));
}

// ---- loading ----
function render() {
  const status = snapshot && snapshot.status;
  $("nothing").hidden = Boolean(status);
  $("board").hidden = !status;
  renderFresh();
  if (!status) return;
  renderSummary(status, list(snapshot.history));
  renderMachines(status);
  renderLegend();
  renderMatrix(status);
  renderDetail(status);
  renderQuestgivers(status);
  renderJobs(status);
  renderPrs(status);
  renderEvents(status, machineNames(status));
}

let loading = false;
async function load() {
  if (loading) return;
  loading = true;
  $("refresh").disabled = true;
  try {
    const next = await fetchStatus();
    const same = snapshot && snapshot.received_at === next.received_at && snapshot.status && next.status;
    snapshot = next;
    $("login").hidden = true;
    $("dash").hidden = false;
    $("load-error").hidden = true;
    if (same) tick(); else render();   // nothing new from the PC: leave the page alone (scroll, focus, an open note)
  } catch (e) {
    if (e.message !== "unauthorized") {
      $("login").hidden = true;
      $("dash").hidden = false;
      $("load-error").textContent = "Couldn't reach the site (" + e.message + "). Showing the last picture we have.";
      $("load-error").hidden = false;
    }
  }
  $("refresh").disabled = false;
  loading = false;
}

// ---- wiring ----
$("login-form").addEventListener("submit", e => {
  e.preventDefault();
  setKey($("key").value.trim(), $("remember").checked);
  $("key").value = "";
  load();
});
$("signout").addEventListener("click", () => signOut());
$("refresh").addEventListener("click", load);
setInterval(() => { if (!document.hidden && key()) load(); }, REFRESH_MS);
// The ages ("4 min ago") keep moving between loads.
function tick() {
  if (!snapshot || !snapshot.status) return;
  renderFresh();
  renderPrs(snapshot.status);
  renderEvents(snapshot.status, machineNames(snapshot.status));
}
setInterval(tick, 30e3);
document.addEventListener("visibilitychange", () => { if (!document.hidden && key()) load(); });

if (key()) load(); else signOut();
