// The /admin dashboard's script (public/admin.html). It's a file rather than inline because /admin's
// Content-Security-Policy (public/_headers) runs no inline script, so nothing in a report can run on this page.

import { mergeContacts } from "/admin-contacts.js";
import { funnelStages } from "/admin-funnel.js";

const KINDS = { lore: "Wrong or missing lore", bug: "Bug", idea: "Idea or zone request", review: "Review" };
const $ = id => document.getElementById(id);
let data = null;
let fbStatus = "new";
let voStatus = "new";
let trStatus = "new";

// The key lives in sessionStorage, or localStorage when "Remember" is ticked. Best effort: storage can be blocked.
function store(remember) { try { return remember ? localStorage : sessionStorage; } catch (e) { return null; } }
function getKey() {
  try { return sessionStorage.getItem("lf-admin") || localStorage.getItem("lf-admin"); } catch (e) { return null; }
}
let memoryKey = null;   // used when storage is blocked
function setKey(key, remember) {
  memoryKey = key;
  try { sessionStorage.removeItem("lf-admin"); localStorage.removeItem("lf-admin"); } catch (e) {}
  if (key) try { store(remember).setItem("lf-admin", key); } catch (e) {}
}
const key = () => memoryKey || getKey();

async function api(method, body) {
  const r = await fetch("/api/admin", {
    method, cache: "no-store",
    headers: { Authorization: "Bearer " + key(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { signOut("That key didn't work."); throw new Error("unauthorized"); }
  const res = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(res.error || "Request failed (" + r.status + ")");
  return res;
}

function signOut(message) {
  setKey(null);
  $("dash").hidden = true;
  $("login").hidden = false;
  $("login-error").textContent = message || "";
  $("login-error").hidden = !message;
}

async function load() {
  $("refresh").disabled = true;
  try {
    data = await api("GET");
    $("login").hidden = true;
    $("dash").hidden = false;
    render();
    loadEdits();                 // its gold badge counts toward Community's
    clipsLoaded = false;         // the clip reports load when Community opens
    route();
    $("updated").textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch (e) {
    if (e.message !== "unauthorized") alert("Couldn't load the dashboard: " + e.message);
  }
  $("refresh").disabled = false;
}

// ---- helpers ----
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
  }
  n.append(...kids.filter(k => k != null));
  return n;
};
const fmtDate = iso => iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const fmtDay = day => new Date(day + "T00:00:00Z").toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
const isTest = s => s.source === "selftest";

// The last n UTC days, oldest first, as "YYYY-MM-DD".
function lastDays(n) {
  const out = [], now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(new Date(now - i * 864e5).toISOString().slice(0, 10));
  return out;
}

// ---- render ----
// "Site downloads", everywhere on this page: add-on downloads through this site's installer and zip links
// (/download/complete is an old link that serves the zip). Narration and language packs are counted apart.
const ADDON_FILES = new Set(["installer", "zip", "complete"]);
const short = name => String(name || "").replace(/^Lore ?Forever /, "");

function render() {
  const contacts = mergeContacts(data.subscribers, data.users).filter(c => !c.test);
  const week = lastDays(7)[0];
  $("t-contacts").textContent = contacts.length.toLocaleString();
  $("t-contacts-sub").textContent = "+" + contacts.filter(c => c.created.slice(0, 10) >= week).length + " in the last 7 days · emails and accounts";

  const totals = data.downloadTotals || [];
  const dlBy = f => totals.filter(d => d.file === f).reduce((a, d) => a + d.n, 0);
  const installer = dlBy("installer"), zip = dlBy("zip") + dlBy("complete");
  $("t-dl").textContent = n0(installer + zip);
  $("t-dl-sub").textContent = n0(installer) + " installer · " + n0(zip) + " zip · since counting began";
  const packsAll = totals.filter(d => !ADDON_FILES.has(d.file)).reduce((a, d) => a + d.n, 0);
  const packs30 = data.downloads.filter(d => !ADDON_FILES.has(d.file)).reduce((a, d) => a + d.n, 0);
  $("t-packs").textContent = n0(packsAll);
  $("t-packs-sub").textContent = "narration and language packs · " + n0(packs30) + " in the last 30 days";
  $("t-clicks").textContent = n0(data.clicks);
  const gh = data.funnel?.stores?.github;
  $("t-github").textContent = gh ? n0(gh.downloads) : "-";
  $("t-github-sub").textContent = gh ? "every release's zip and installer, this site's included · " + fmtDate(gh.taken)
    : "not read yet: GitHub answers the site only now and then";

  const rated = data.feedback.filter(f => f.rating);
  $("t-rating").textContent = rated.length ? "Average rating " + (rated.reduce((a, f) => a + f.rating, 0) / rated.length).toFixed(1) +
    " ★ from " + rated.length + " rating" + (rated.length === 1 ? "" : "s") : "";

  const st = data.stories || { usd: 0, calls: 0, written: 0, budget: 100, on: false };
  const an = data.answers || { usd: 0, budgetUsedUsd: 0, calls: 0 };
  const total = st.usd + (st.voiceUsd || 0) + an.usd;
  const held = st.usd + (st.voiceUsd || 0) + (st.reservedUsd || 0) + an.budgetUsedUsd;
  $("t-stories").textContent = "$" + total.toFixed(total < 10 ? 4 : 2);
  $("t-stories-sub").textContent = `$${held.toFixed(2)} of $${st.budget} budget held · ` +
    `${an.calls} live answer calls ($${an.usd.toFixed(2)}) · ${st.written} stories · voice $${(st.voiceUsd || 0).toFixed(2)}`;

  const pl = data.plans || { on: false, paying: 0, counts: [], monthlyUsd: 0, spend: { usd: 0, players: 0, calls: 0 } };
  $("t-plans").textContent = pl.paying.toLocaleString();
  $("t-plans-sub").textContent = (pl.on ? "" : "Off (plans switched off, or no Stripe key) · ") +
    `$${pl.monthlyUsd.toFixed(2)} a month · ` +
    (pl.counts.map(c => `${c.n} ${c.plan} ${String(c.status).replace("_", " ")}`).join(", ") || "no subscriptions yet") +
    ` · their answers $${pl.spend.usd.toFixed(2)} (${pl.spend.players} players)` +
    (pl.topups ? ` · ${pl.topups.sold} top-ups this month, ${pl.topups.unused.toLocaleString()} answers unused, ` +
                 `top-up answers $${pl.topups.usd.toFixed(2)}` : "");

  const days = lastDays(30);
  barChart($("c-signups"), days, days.map(d => contacts.filter(c => c.created.slice(0, 10) === d).length),
    n => n + (n === 1 ? " new contact" : " new contacts"));
  barChart($("c-downloads"), days, days.map(d => data.downloads.filter(x => x.day === d && ADDON_FILES.has(x.file))
    .reduce((a, x) => a + x.n, 0)), n => n + (n === 1 ? " add-on download" : " add-on downloads") + " from this site");

  // Accounts and player profiles, counted by the API (data.users stops at 5000), admin and test accounts left out.
  const su = data.signups || { accounts: 0, profiles: 0, public: 0, today: 0, week: 0, month: 0, days: [] };
  for (const k of ["accounts", "profiles", "public", "today", "week", "month"]) $("p-" + k).textContent = su[k].toLocaleString();
  $("p-profiles-sub").textContent = su.accounts ? Math.round(100 * su.profiles / su.accounts) + "% of accounts" : "";
  $("p-public-sub").textContent = (su.profiles - su.public).toLocaleString() + " private";
  barChart($("c-accounts"), days, days.map(d => su.days.find(x => x.day === d)?.n || 0),
    n => n + (n === 1 ? " new account" : " new accounts"));
  const ex = data.activity?.excluded;
  const why = ex ? [["admin", "admin"], ["config", "from ANALYTICS_EXCLUDE"], ["manual", "by hand"]].filter(([k]) => ex[k]).map(([k, w]) => ex[k] + " " + w).join(", ") : "";
  $("p-excluded").textContent = ex?.accounts ? `Left out of every count on this page: ${ex.accounts} account${ex.accounts === 1 ? "" : "s"} ` +
    `(${why}). Change it in Community › Contacts.` : "No accounts are left out of the counts.";

  renderOverview();
  renderActivity();
  renderFunnel();
  renderUsage();
  renderFeatures();
  renderFeedback();
  renderVoices();
  renderTranslations();
  renderContributions();
  renderContacts();

  const openCount = list => (list || []).filter(x => x.status !== "done").length;
  badge("n-feedback", data.feedback.filter(f => f.status !== "done").length);
  badge("n-voices", openCount(data.voices));
  badge("n-translations", openCount(data.translations) + openCount(data.translationReports));
  badge("n-contacts", contacts.length);
  communityBadge();
}

const badge = (id, n) => $(id).textContent = n ? n.toLocaleString() : "";
// Community's badge: what waits on you there (the gold badges: open feedback, voice and translation items, edits to pull).
function communityBadge() {
  badge("n-community", ["n-feedback", "n-voices", "n-translations", "n-edits"]
    .reduce((a, id) => a + (Number(($(id).textContent || "0").replace(/\D/g, "")) || 0), 0));
}

// ---- overview: the headline numbers ----
function renderOverview() {
  const f = data.funnel || {}, st = f.stores || {}, a = st.author, c = f.companions, r = data.activity?.returning;
  if (a?.thisWeek) {
    $("o-unique").textContent = n0(a.thisWeek.unique);
    const wk = a.thisWeek.current ? "this week" : "the week of " + fmtDay(a.thisWeek.week);
    $("o-unique-sub").textContent = `${a.thisWeek.current ? "this week so far" : wk} · ${n0(a.today.unique)} on ` +
      `${fmtDay(a.today.day)} · ${n0(a.thisWeek.downloads)} downloads ${wk}`;
  } else {
    $("o-unique").textContent = "-";
    $("o-unique-sub").textContent = "waiting for the CurseForge author dashboard's numbers";
  }
  const nw = st.newest;
  $("o-release").textContent = nw ? n0(nw.day1 ?? nw.downloads) : "-";
  $("o-release-sub").textContent = nw ? short(nw.name) + (nw.day1 != null ? " in its first 24 hours" : `, out ${nw.hours} h so far`) +
    (st.inUse && st.inUse.name !== nw.name ? ` · ${short(st.inUse.name)}: ${n0(st.inUse.n)} in its day` : "") +
    " · CurseForge" : "no CurseForge numbers yet";
  const su = data.signups || { accounts: 0, week: 0 };
  $("o-accounts").textContent = n0(su.accounts);
  $("o-accounts-sub").textContent = `${n0(su.week)} new in the last 7 days · admin and test accounts left out`;
  $("o-returning").textContent = r ? n0(r.returned) : "-";
  $("o-returning-sub").textContent = r ? `${pct(r.returned, r.accounts)} of accounts · signed in or synced on 2+ days` : "";
  $("o-companions").textContent = c ? n0(c.week) : "-";
  $("o-companions-sub").textContent = c ? "different installs in the last 7 days" +
    (c.internal?.installs ? ` · ${c.internal.installs} internal build${c.internal.installs === 1 ? "" : "s"} left out` : "")
    : "none yet: the companion checks in from its next release";
  const open = list => (list || []).filter(x => x.status !== "done").length;
  const fb = open(data.feedback), tr = open(data.translations) + open(data.translationReports), vo = open(data.voices);
  $("o-open").textContent = n0(fb + tr + vo);
  $("o-open-sub").textContent = `${fb} feedback · ${tr} translation · ${vo} voice`;
  const days = (st.days || []).slice(0, 14).reverse();
  pairChart($("c-overview-cf"), days.map(d => d.day), days.map(d => d.curseforge?.n ?? 0), days.map(d => d.unique),
    "downloads", "unique downloaders");
}

// Single-series bar chart: thin bars with a rounded top, recessive grid, hover tooltip, and a table fallback.
function barChart(fig, days, values, label) {
  fig.querySelectorAll("svg, .ad-tip, details").forEach(n => n.remove());
  const W = 520, H = 170, L = 28, R = 4, T = 8, B = 22;
  const max = Math.max(1, ...values);
  const step = max <= 4 ? 1 : Math.ceil(max / 4 / 5) * 5 || 1;     // gridline every `step`
  const top = Math.ceil(max / step) * step;
  const y = v => T + (H - T - B) * (1 - v / top);
  const slot = (W - L - R) / values.length, bw = Math.max(2, slot - 2);   // 2px gap between bars
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", fig.querySelector("h3").textContent + ". Total " + values.reduce((a, b) => a + b, 0));
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    svg.appendChild(n);
    return n;
  };
  for (let v = 0; v <= top; v += step) {
    add("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" });
    add("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end", class: "axis" }, v);
  }
  [0, Math.floor(values.length / 2), values.length - 1].forEach(i =>
    add("text", { x: L + slot * i + slot / 2, y: H - 6, "text-anchor": "middle", class: "axis" }, fmtDay(days[i])));

  const tip = el("div", { class: "ad-tip", hidden: "" });
  values.forEach((v, i) => {
    const x = L + slot * i + 1, h = y(0) - y(v), r = Math.min(4, bw / 2, h);
    // Hit target is the whole column, bigger than the bar.
    const hit = add("rect", { x: L + slot * i, y: T, width: slot, height: H - T - B, class: "hit" });
    const bar = add("path", {
      class: "bar",
      d: v ? `M${x},${y(0)} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + bw - r} Q${x + bw},${y(v)} ${x + bw},${y(v) + r} V${y(0)} Z` : "",
    });
    hit.addEventListener("mouseenter", () => {
      bar.classList.add("on");
      tip.replaceChildren(el("strong", { text: fmtDay(days[i]) }), ": " + label(v));
      const fr = fig.getBoundingClientRect(), sr = svg.getBoundingClientRect();
      tip.style.left = (sr.left - fr.left + sr.width * (L + slot * i + slot / 2) / W) + "px";
      tip.style.top = (sr.top - fr.top + sr.height * y(v) / H - 6) + "px";
      tip.hidden = false;
    });
    hit.addEventListener("mouseleave", () => { bar.classList.remove("on"); tip.hidden = true; });
  });
  fig.append(svg, tip);

  const rows = days.map((d, i) => [d, values[i]]).filter(([, v]) => v).reverse();
  fig.append(el("details", {}, el("summary", { text: "Show as table" }),
    rows.length
      ? el("table", {}, ...rows.map(([d, v]) => el("tr", {}, el("td", { text: fmtDay(d) }), el("td", { text: String(v) }))))
      : el("p", { class: "ad-empty", text: "Nothing in the last " + days.length + " days." })));
}

// Two series per day: a total bar with its unique part inside it (author numbers; missing days draw no inner bar).
function pairChart(fig, days, totals, uniques, totalName, uniqueName) {
  fig.querySelectorAll("svg, .ad-tip, details, .ad-legend").forEach(n => n.remove());
  const W = 520, H = 170, L = 34, R = 4, T = 8, B = 22, NS = "http://www.w3.org/2000/svg";
  const max = Math.max(1, ...totals, ...uniques.filter(v => v != null));
  const nice = x => { const p = Math.pow(10, Math.floor(Math.log10(x))); return [1, 2, 5, 10].map(m => m * p).find(v => v >= x); };
  const step = max <= 4 ? 1 : nice(max / 4);
  const top = Math.ceil(max / step) * step, y = v => T + (H - T - B) * (1 - v / top);
  const slot = (W - L - R) / Math.max(1, days.length), bw = Math.max(2, slot - 2);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", fig.querySelector("h3").textContent);
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    svg.appendChild(n);
    return n;
  };
  for (let v = 0; v <= top; v += step) {
    add("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" });
    add("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end", class: "axis" }, v >= 1000 ? (v / 1000) + "k" : v);
  }
  if (days.length) [0, Math.floor(days.length / 2), days.length - 1].forEach(i =>
    add("text", { x: L + slot * i + slot / 2, y: H - 6, "text-anchor": "middle", class: "axis" }, fmtDay(days[i])));
  const tip = el("div", { class: "ad-tip", hidden: "" });
  days.forEach((d, i) => {
    const x = L + slot * i + 1, t = totals[i] || 0, u = uniques[i];
    const hit = add("rect", { x: L + slot * i, y: T, width: slot, height: H - T - B, class: "hit" });
    if (t) add("rect", { x, y: y(t), width: bw, height: y(0) - y(t), rx: Math.min(3, bw / 2), class: "bar total" });
    if (u) add("rect", { x: x + bw * 0.2, y: y(u), width: bw * 0.6, height: y(0) - y(u), rx: Math.min(2, bw / 4), class: "bar uniq" });
    hit.addEventListener("mouseenter", () => {
      tip.replaceChildren(el("strong", { text: fmtDay(d) }), `: ${n0(t)} ${totalName}` + (u != null ? ` · ${n0(u)} ${uniqueName}` : ""));
      const fr = fig.getBoundingClientRect(), sr = svg.getBoundingClientRect();
      tip.style.left = (sr.left - fr.left + sr.width * (L + slot * i + slot / 2) / W) + "px";
      tip.style.top = (sr.top - fr.top + sr.height * y(t) / H - 6) + "px";
      tip.hidden = false;
    });
    hit.addEventListener("mouseleave", () => { tip.hidden = true; });
  });
  const legend = el("p", { class: "ad-legend" }, el("span", { class: "sw total" }), " " + totalName,
    uniques.some(v => v != null) ? el("span", { class: "sw uniq" }) : null, uniques.some(v => v != null) ? " " + uniqueName : null);
  fig.append(svg, tip, legend);
  const rows = days.map((d, i) => [d, totals[i], uniques[i]]).filter(([, t]) => t).reverse();
  fig.append(el("details", {}, el("summary", { text: "Show as table" }),
    rows.length ? el("table", {}, ...rows.map(([d, t, u]) => el("tr", {}, el("td", { text: fmtDay(d) }), el("td", { text: n0(t) }),
      el("td", { text: u == null ? "" : n0(u) + " unique" }))))
      : el("p", { class: "ad-empty", text: "Nothing yet." })));
}

// ---- sign-ins (LOR-304) ----
// In order: as object keys, "60" would come first (integer-like keys always do).
const LEVEL_NAMES = [["1-19", "1–19"], ["20-39", "20–39"], ["40-59", "40–59"], ["60", "60"], ["unknown", "Unknown"]];
const PLAYED_KEYS = ["<1d", "1-3d", "3d+", "unknown"];
const n0 = n => (n || 0).toLocaleString();
const share = (n, of) => n0(n) + (of ? " (" + pct(n, of) + ")" : "");

function renderActivity() {
  const a = data.activity || { signedIn: { today: 0, week: 0, month: 0 }, days: [], profiles: [], updates: [],
    returning: { accounts: 0, returned: 0, returnedSignin: 0, owners: 0, ownersReturned: 0, ownersReturnedSignin: 0 },
    players: { grid: [], veteran: 0, between: 0, new: 0 } };
  for (const k of ["today", "week", "month"]) $("s-" + k).textContent = n0(a.signedIn[k]);
  // Returning, here and in the funnel's "Came back": seen on 2+ different days, signed in or synced.
  const r = a.returning;
  $("s-returning").textContent = n0(r.returned);
  $("s-returning-sub").textContent = `${pct(r.returned, r.accounts)} of ${n0(r.accounts)} · signed in or synced on 2+ days · ` +
    `${n0(r.returnedSignin)} by signing in alone`;
  $("s-owners").textContent = n0(r.ownersReturned);
  $("s-owners-sub").textContent = `${pct(r.ownersReturned, r.owners)} of ${n0(r.owners)} profile owners · ` +
    `${n0(r.ownersReturnedSignin)} by signing in alone`;
  $("s-note").textContent = a.since
    ? "Sign-in days kept since " + fmtDay(a.since) + ". The first ones come from sign-ins still open when counting began."
    : "No sign-ins noted yet.";
  const days30 = lastDays(30), signedOn = d => a.days.find(x => x.day === d)?.n || 0;
  barChart($("c-signins"), days30, days30.map(signedOn), n => n + (n === 1 ? " account signed in" : " accounts signed in"));

  const newAccounts = d => (data.signups?.days || []).find(x => x.day === d)?.n || 0;
  const updates = (d, m) => a.updates.filter(x => x.day === d && x.metric === m).reduce((t, x) => t + x.n, 0);
  $("s-days").replaceChildren(...lastDays(14).reverse().map(d => {
    const p = a.profiles.find(x => x.day === d);
    return el("tr", {}, el("td", { text: fmtDay(d) }),
      ...[newAccounts(d), signedOn(d), p?.n, p?.public, updates(d, "profile.paste"), updates(d, "profile.sync")]
        .map(n => el("td", { text: n0(n) })));
  }));
  $("s-updates-note").textContent = (a.updatesSince ? "Profile updates counted since " + fmtDay(a.updatesSince) + "."
    : "Profile updates are counted from now on.") + " They're plain numbers, so they include any left-out account's.";

  const v = a.players, profiles = v.veteran + v.between + v.new;
  for (const k of ["veteran", "between", "new"]) {
    $("v-" + k).textContent = n0(v[k]);
    $("v-" + k + "-sub").textContent = pct(v[k], profiles) + " of profiles";
  }
  const cell = (l, p) => v.grid.find(g => g.level === l && g.played === p);
  $("v-grid").replaceChildren(...(profiles ? LEVEL_NAMES.filter(([l]) => l !== "unknown" || PLAYED_KEYS.some(p => cell(l, p)))
    .map(([l, name]) => el("tr", {}, el("td", { text: name }), ...PLAYED_KEYS.map(p => {
      const g = cell(l, p);
      return el("td", { class: g ? "ad-kind-" + g.kind : "", text: g ? n0(g.n) : "" });
    })))
    : [el("tr", {}, el("td", { colspan: "5", class: "ad-empty", text: "No profiles yet." }))]));
}

// ---- funnel (LOR-10) ----
function renderFunnel() {
  const f = data.funnel;
  if (!f) { $("f-stages").replaceChildren(el("li", { class: "ad-empty", text: "Couldn't count the funnel." })); return; }
  const stages = funnelStages(f);
  const top = Math.max(1, ...stages.map(x => x.n || 0));
  $("f-stages").replaceChildren(...stages.map(x => el("li", { class: x.n == null ? "ad-off" : "" },
    el("span", { class: "ad-funnel-name", text: x.name }),
    el("span", { class: "ad-funnel-num", text: x.n == null ? "not counted" : n0(x.n) }),
    el("span", { class: "ad-rate-bar" }, el("span", { style: `width:${x.n == null ? 0 : (100 * x.n / top).toFixed(1)}%` })),
    el("span", { class: "ad-sub", text: [x.share && `${x.share.pct} of ${x.share.of}`, x.note].filter(Boolean).join(" · ") }))));
  const s = f.stages, sd = f.signedInDownloads;
  $("f-signed").textContent = sd.downloads
    ? `Downloaded while signed in: ${n0(sd.downloads)} site download${sd.downloads === 1 ? "" : "s"} by ${n0(sd.accounts)} ` +
      `account${sd.accounts === 1 ? "" : "s"} since ${fmtDay(sd.since)}.`
    : "Downloaded while signed in: none yet. Most people download before they have an account; signing in is never needed.";

  const thisWeek = f.weeks.at(-1)?.week, cfWeeks = Object.fromEntries((f.stores?.author?.weeks || []).map(w => [w.week, w]));
  $("f-weeks").replaceChildren(...f.weeks.slice().reverse().map(w => el("tr", {},
    el("td", { text: fmtDay(w.week) + (w.week === thisWeek ? " (so far)" : "") }),
    el("td", { text: cfWeeks[w.week] ? n0(cfWeeks[w.week].unique) : "" }),
    ...[w.downloads, f.companionWeeks?.[w.week], w.accounts, w.profiles, w.signedIn, w.synced, w.back]
      .map(n => el("td", { text: n0(n) })))));

  const started = (week, k) => new Date(Date.parse(week + "T00:00:00Z") + 7 * k * 864e5).toISOString().slice(0, 10) <= thisWeek;
  $("f-cohorts").replaceChildren(...(f.cohorts.length ? f.cohorts.slice().reverse().map(c => el("tr", {},
    el("td", { text: fmtDay(c.week) }), el("td", { text: n0(c.accounts) }), el("td", { text: share(c.returned, c.accounts) }),
    ...[1, 2, 3, 4].map(k => el("td", { text: started(c.week, k) ? share(c["w" + k], c.accounts) : "" }))))
    : [el("tr", {}, el("td", { colspan: "7", class: "ad-empty", text: "No accounts made in the last 8 weeks." }))]));
  $("f-cohort-note").textContent = "Accounts by the week they were made (their first sign-in). Active: signed in on " +
    "the site or synced from the companion. Week 1 is the week after their first; this week is still filling in.";
  renderStores(f.stores);
  renderCompanions(f.companions);
}

// ---- CurseForge and GitHub (LOR-421) ----
const empty = (cols, text) => [el("tr", {}, el("td", { colspan: String(cols), class: "ad-empty", text }))];
const hhmm = iso => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
// A day's count by where it came from: the author dashboard's or measured between snapshots as it is, "since 8:24"
// for today's from its first snapshot, "≈" for one worked out from each release's downloads and the hours it was newest.
const countText = c => !c ? "" : c.kind === "partial" ? `${n0(c.n)} since ${hhmm(c.since)}` : c.kind === "estimate" ? "≈ " + n0(c.n) : n0(c.n);

function renderStores(st) {
  const s = st || { days: [], releases: [], packs: [], author: null };
  const rows = s.days.slice(0, 14);
  // A column with nothing at all says once where it starts instead of a column of dashes.
  const blank = key => rows.every(d => !d[key]);
  const from = s.firstFull ? "from " + fmtDay(s.firstFull) : "not yet";
  $("f-store-days").replaceChildren(...(rows.length ? rows.map((d, i) => el("tr", {}, el("td", { text: fmtDay(d.day) }),
    el("td", { text: n0(d.site) }),
    el("td", { text: blank("curseforge") ? (i ? "" : from) : countText(d.curseforge) }),
    el("td", { class: "ad-small", text: d.releases.slice(0, 3).map(r => short(r.name) + " " + n0(r.n)).join(" · ") }),
    el("td", { text: blank("packs") ? (i ? "" : from) : countText(d.packs) }),
    el("td", { text: blank("github") ? (i ? "" : from) : countText(d.github) })))
    : empty(6, "No numbers yet.")));
  const a = s.author;
  $("f-store-note").textContent = [
    a ? `CurseForge's author dashboard through ${fmtDay(a.last)}.` : null,
    s.since ? `Snapshots since ${fmtDay(s.since)}: a day is counted from one day's last snapshot to the next's; today's ` +
      "from its first, \"since\" that time." : null,
    "≈: worked out from each release's downloads, spread over the hours it was the newest.",
    "Site: add-on downloads through this site's links. Most CurseForge downloads are the app updating the add-on, so read them as installs in use, not new players.",
  ].filter(Boolean).join(" ");

  const days = s.days.slice().reverse();
  pairChart($("c-cf-days"), days.map(d => d.day), days.map(d => d.curseforge?.n ?? 0), days.map(d => d.unique),
    "downloads", "unique downloaders");
  pairChart($("c-cf-packs"), days.map(d => d.day), days.map(d => d.packs?.n ?? 0), days.map(d => d.packsUnique),
    "downloads", "downloaders (each pack's added up)");
  $("f-cf-weeks").replaceChildren(...(a?.weeks.length ? a.weeks.map(w => el("tr", {}, el("td", { text: fmtDay(w.week) }),
    el("td", { text: n0(w.downloads) }), el("td", { text: n0(w.unique) }), el("td", { text: n0(w.packsDownloads) }),
    el("td", { text: n0(w.packsUnique) }))) : empty(5, "Waiting for the author dashboard's numbers.")));
  $("f-cf-note").textContent = a
    ? `Unique downloaders are distinct people in that week (CurseForge's own count), never daily numbers added up. ` +
      `Add-on downloads since ${fmtDay(a.cumulative.since)}: ${n0(a.cumulative.downloads)}.` +
      (a.windowUserDays != null ? ` User-days over the dashboard's last 90 days (each day's downloaders added up): ${n0(a.windowUserDays)}.` : "") +
      ` Updated ${fmtDate(a.updated)}.`
    : "Unique downloaders come only from CurseForge's author dashboard: a routine in Mike's browser posts them to " +
      "/api/admin/curseforge. Until then, everything here comes from cfwidget's public counts.";

  $("f-releases").replaceChildren(...(s.releases.length ? s.releases.map(r => el("tr", {},
    el("td", { text: short(r.name) }), el("td", { text: r.uploaded ? fmtDate(r.uploaded) : "" }),
    el("td", { text: r.day1 == null ? "–" : n0(r.day1) }), el("td", { text: r.unique1 == null ? "–" : n0(r.unique1) }),
    el("td", { text: n0(r.downloads) }),
    el("td", { text: r.current == null ? "newest" : r.current < 48 ? r.current + " h" : Math.round(r.current / 24) + " days" })))
    : empty(6, "No numbers yet.")));
  // The packs' growth: over 7 days of snapshots, or since the first one until there are 7 days of them.
  const since = s.packs.find(p => p.recent && p.recent.days == null)?.recent.since;
  $("f-packs-recent").textContent = since ? "Since " + fmtDay(since) : "Last 7 days";
  const rest = s.packs.slice(10), restRecent = rest.some(p => p.recent) ? rest.reduce((t, p) => t + (p.recent?.n || 0), 0) : null;
  const recentText = n => n == null ? "" : n0(n);
  $("f-packs").replaceChildren(...(s.packs.length ? [...s.packs.slice(0, 10).map(p => el("tr", {},
    el("td", { text: p.name.replace(/^Lore Forever:? /, "") }), el("td", { text: n0(p.downloads) }), el("td", { text: recentText(p.recent?.n) }))),
    ...(rest.length ? [el("tr", {}, el("td", { text: rest.length + " more projects" }),
      el("td", { text: n0(rest.reduce((t, p) => t + p.downloads, 0)) }), el("td", { text: recentText(restRecent) }))] : [])]
    : empty(3, "No numbers yet.")));
}

// ---- companion check-ins (LOR-422) ----
function renderCompanions(c) {
  const k = c || { since: null, today: 0, week: 0, month: 0, installs: 0, returning: 0, days: [], versions: [], internal: null };
  for (const key of ["today", "week", "month", "returning"]) $("k-" + key).textContent = n0(k[key]);
  $("k-returning-sub").textContent = "seen on 2+ days · " + pct(k.returning, k.installs) + " of " + n0(k.installs) + " installs";
  $("k-versions").replaceChildren(...(k.versions.length ? k.versions.map(v => el("tr", {},
    el("td", { text: v.companion || "?" }), el("td", { text: v.addon || "?" }), el("td", { text: n0(v.n) })))
    : empty(3, "None in the last 7 days.")));
  const internal = k.internal?.installs ? ` Internal builds left out: ${k.internal.installs} install${k.internal.installs === 1 ? "" : "s"} (` +
    k.internal.versions.map(v => `companion ${v.companion || "?"}, add-on ${v.addon || "?"}`).join("; ") + ").": "";
  $("k-note").textContent = (k.since && k.installs
    ? "Check-ins since " + fmtDay(k.since) + ", kept 90 days. Players can turn them off in the companion's settings."
    : "No check-ins from players yet: the companion sends them once a day from its next release, unless the player turns it off.") +
    " A companion without a release version (0.1.0) or marked -dev or -preview is an internal build." + internal;
  const days30 = lastDays(30);
  barChart($("c-companions"), days30, days30.map(d => k.days.find(x => x.day === d)?.n || 0),
    n => n + (n === 1 ? " install" : " installs"));
}

// ---- usage (LOR-413) ----
const FEATURES = [
  ["play", "Narrations started"], ["done", "Narrations heard to the end"],
  ["autoplay", "… started by themselves"], ["userplay", "… started with Play"], ["ask", "Questions typed"],
  ["faq", "Suggested questions picked"], ["live", "Questions sent to live answers"], ["panel", "Lore panel opens"],
  ["journey", "Journey opens"], ["pic", "Pictures taken"], ["chat", "Messages to Willo"], ["newchat", "New Willo chats"],
];
const NARRATION_KINDS = [
  ["zone", "Zones"], ["place", "Places"], ["person", "People"], ["quest", "Quest stories"],
  ["dialogue", "Quest dialogue"], ["answer", "Answers"], ["topic", "Topics"], ["book", "Books"], ["other", "Other"],
];
const pct = (a, b) => b ? Math.round(100 * a / b) + "%" : "-";
const per = (a, b) => b ? (a / b).toFixed(a / b < 10 ? 1 : 0) : "-";

function renderUsage() {
  const u = data.usage || { days: [], metrics: [], window: { players: 0, counted: 0, metrics: {} }, week: 0 };
  const days = lastDays(14);
  const today = days[days.length - 1];
  const dayRow = d => u.days.find(x => x.day === d) || { players: 0, counted: 0 };
  // A feature's metrics: "play" and "done" add up their kinds.
  const matches = (metric, f) => metric === f || metric.startsWith(f + ".");
  const onDay = (d, f) => u.metrics.filter(m => m.day === d && matches(m.metric, f));
  const windowOf = f => Object.entries(u.window.metrics).filter(([m]) => matches(m, f)).map(([, v]) => v);
  const sum = (list, k) => list.reduce((a, x) => a + (x[k] || 0), 0);

  $("u-today").textContent = dayRow(today).players.toLocaleString();
  $("u-today-sub").textContent = dayRow(today).counted + " with counts";
  $("u-week").textContent = u.week.toLocaleString();
  $("u-window").textContent = u.window.players.toLocaleString();
  $("u-window-sub").textContent = u.window.counted + " with counts";
  const started = sum(windowOf("play"), "n"), heard = sum(windowOf("done"), "n");
  // LOR-420: the same rate for the narrations that started by themselves and the ones players started (newer add-ons).
  const total = by => sum(windowOf(by), "n");
  const auto = [total("autodone"), total("autoplay")], user = [total("userdone"), total("userplay")];
  $("u-done").textContent = pct(heard, started);
  $("u-done-sub").textContent = heard.toLocaleString() + " of " + started.toLocaleString() + " narrations started" +
    (auto[1] || user[1] ? " · by itself " + pct(...auto) + ", with Play " + pct(...user) : "");
  barChart($("c-usage"), days, days.map(d => dayRow(d).players), n => n + (n === 1 ? " syncing player" : " syncing players"));

  // Players: who used it at least once in the window (for play and done, the most of any one kind: a lower bound).
  const playerDays = sum(days.map(dayRow), "counted");
  $("u-features").replaceChildren(...FEATURES.map(([f, name]) => {
    const w = windowOf(f), total = sum(w, "n"), players = Math.max(0, ...w.map(x => x.players));
    const trend = days.map(d => { const c = dayRow(d).counted; return c ? sum(onDay(d, f), "n") / c : null; });
    return el("tr", {}, el("td", { text: name }),
      el("td", { text: players + (u.window.counted ? " (" + pct(players, u.window.counted) + ")" : "") }),
      el("td", { text: per(total, playerDays) }), el("td", { text: total.toLocaleString() }),
      el("td", {}, sparkline(days, trend, name)));
  }));

  // Each kind's started, heard and rate, then the same rate for those that started by themselves and with Play
  // (LOR-420; "-" where no add-on sent the split), under a first row for every kind together.
  const metric = m => u.window.metrics[m]?.n || 0;
  const counts = get => ["play", "done", "autoplay", "autodone", "userplay", "userdone"].map(get);
  const kinds = NARRATION_KINDS.map(([k, name]) => [name, ...counts(by => metric(by + "." + k))])
    .filter(([, s, d]) => s || d);
  const split = (d, s) => s ? el("td", { title: d.toLocaleString() + " of " + s.toLocaleString() + " heard to the end",
    text: pct(d, s) }) : el("td", { class: "ad-small", text: "-" });
  const kindRow = ([name, s, d, as, ad, us, ud]) => el("tr", {},
    el("td", { text: name }), el("td", { text: s.toLocaleString() }), el("td", { text: d.toLocaleString() }),
    el("td", {}, rateBar(d, s)), split(ad, as), split(ud, us));
  $("u-kinds").replaceChildren(...(kinds.length ? [kindRow(["All kinds", ...counts(total)]), ...kinds.map(kindRow)]
    : [el("tr", {}, el("td", { colspan: "6", class: "ad-empty", text: "No narrations counted yet." }))]));

  // Profile pages (LOR-151): the site's own daily counts.
  const siteOn = (d, m) => (data.site || []).filter(r => r.day === d && r.metric === m).reduce((a, r) => a + r.n, 0);
  const siteSum = m => days.reduce((a, d) => a + siteOn(d, m), 0);
  const views = siteSum("profile.view"), outside = siteSum("profile.outside");
  $("u-views").textContent = views.toLocaleString();
  $("u-views-sub").textContent = siteOn(today, "profile.view") + " today";
  $("u-outside").textContent = outside.toLocaleString();
  $("u-outside-sub").textContent = pct(outside, views) + " of views";
  $("u-shares").textContent = siteSum("profile.share").toLocaleString();
  barChart($("c-views"), days, days.map(d => siteOn(d, "profile.view")), n => n + (n === 1 ? " profile view" : " profile views"));

  const bySrc = {};
  for (const r of data.downloadSources || []) {
    const row = bySrc[r.src] ||= { installer: 0, zip: 0, total: 0 };
    if (r.file === "installer") row.installer += r.n; else row.zip += r.n;
    row.total += r.n;
  }
  const sources = Object.entries(bySrc).sort((a, b) => b[1].total - a[1].total);
  $("u-sources").replaceChildren(...(sources.length ? sources.map(([src, r]) => el("tr", {},
    el("td", {}, el("code", { text: src })), el("td", { text: String(r.installer) }), el("td", { text: String(r.zip) }),
    el("td", { text: String(r.total) }))) : [el("tr", {}, el("td", { colspan: "4", class: "ad-empty", text: "None yet." }))]));
}

// ---- feature use from every companion install (LOR-435, lib/featureuse.js featureReport) ----
const PICKS = [
  ["voice", "Voice", { default: "Default narrator", female: "Female narrator", edition: "An edition's own voice",
                       other: "Another voice", none: "No narration" }],
  ["lang", "Language shown", null], ["client", "Game client's language", null],
];
const SETTING_NAMES = {
  autoZone: "Narrate on arrival", onDemand: "Narration only when I press Play", narrateFlights: "Narrate flights",
  questDialogue: "Quest dialogue", readBooks: "Read books", skipHeard: "Skip what this character heard",
  journey: "Remember my journey", automaticPictures: "Milestone pictures", capture: "Keep the quest text you see",
  liveStrip: "Live game info (add-on)", minimap: "Minimap button", floatPlayer: "Floating player",
  zoneNudge: "Zone hint in chat", unitTooltips: "Lore on tooltips", showSpoilers: "Show spoilers",
  voiceMatchRace: "Voices suit the race", tips: "Login tips",
  send_text: "Companion: send new Forever text", profile_sync: "Companion: keep my profile up to date",
  pictures: "Companion: picture book", pictures_auto: "Companion: pictures to the profile by themselves",
  live_game: "Companion: live game info", daily_checkin: "Companion: share anonymous usage counts",
  game_dir: "Companion: game folder", connected: "Companion: profile connected",
};
const levelName = lv => lv < 0 ? "Unknown" : lv >= 60 ? "60" : lv === 0 ? "1–9" : `${lv}–${lv + 9}`;
// sparkline, its hover text as each day's share of installs.
function shareSpark(days, shares, name) {
  const svg = sparkline(days, shares, name);
  const text = name + ", share of that day's installs: " +
    days.map((d, i) => fmtDay(d) + " " + (shares[i] == null ? "none" : Math.round(100 * shares[i]) + "%")).join(", ");
  svg.querySelector("title").textContent = text;
  svg.setAttribute("aria-label", text);
  return svg;
}

function renderFeatures() {
  const f = data.features;
  const days30 = lastDays(30);
  const none = (id, cols, text) => $(id).replaceChildren(...empty(cols, text));
  if (!f || !f.active.d30) {
    for (const id of ["fu-active", "fu-top", "fu-days", "fu-minutes"]) $(id).textContent = "-";
    for (const id of ["fu-active-sub", "fu-top-sub", "fu-minutes-sub"]) $(id).textContent = "";
    $("fu-note").textContent = "No counts yet: companions send them with their daily check-in from their next release, " +
      "unless the player turns off Share anonymous usage counts.";
    none("fu-list", 6, "No counts yet."); none("fu-levels", 1, "No counts yet."); none("fu-picks", 3, "No counts yet.");
    $("fu-levels-head").replaceChildren(el("th", { text: "Feature" }));
    barChart($("c-features"), days30, days30.map(() => 0), n => n + (n === 1 ? " install" : " installs"));
    return;
  }
  const a = f.active, nu = f.returning.new, back = f.returning.returning;
  const ranked = f.features.map(x => ({ ...x, d14: f.use[x.id]?.d14 || 0, d30: f.use[x.id]?.d30 || 0 }))
    .sort((p, q) => q.d30 - p.d30 || q.d14 - p.d14);
  $("fu-active").textContent = n0(a.d14);
  $("fu-active-sub").textContent = `last 14 days · ${n0(a.d30)} in 30 days`;
  $("fu-top").textContent = pct(ranked[0].d30, a.d30);
  $("fu-top-sub").textContent = ranked[0].d30 ? ranked[0].name + " · of installs, last 30 days" : "";
  const p = f.play;
  $("fu-days").textContent = per(p.played || p.days, a.d30);
  $("fu-minutes").textContent = p.played ? n0(Math.round(p.minutes / p.played)) : "-";
  $("fu-minutes-sub").textContent = `in game with the add-on, per day played · ${n0(p.logins)} game sessions`;
  $("fu-note").textContent = "From the companion's daily check-in on every install, with or without an account, " +
    "unless the player turned off Share anonymous usage counts. Players with the add-on alone can't send counts " +
    "(CurseForge's numbers count them). Internal builds are left out. New: checked in on one day only; returning: on 2+ days" +
    ` (${n0(nu.installs)} new, ${n0(back.installs)} returning in 30 days).`;
  const byDay = Object.fromEntries((f.trend || []).map(d => [d.day, d]));
  barChart($("c-features"), days30, days30.map(d => byDay[d]?.installs || 0), n => n + (n === 1 ? " install" : " installs"));

  $("fu-list").replaceChildren(...ranked.map(x => el("tr", {}, el("td", { text: x.name }),
    el("td", { title: `${n0(x.d14)} of ${n0(a.d14)} installs`, text: pct(x.d14, a.d14) }),
    el("td", { title: `${n0(x.d30)} of ${n0(a.d30)} installs` }, rateBar(x.d30, a.d30)),
    el("td", { text: pct(nu.use[x.id] || 0, nu.installs) }), el("td", { text: pct(back.use[x.id] || 0, back.installs) }),
    el("td", {}, shareSpark(days30, days30.map(d => byDay[d]?.installs ? (byDay[d].use[x.id] || 0) / byDay[d].installs : null),
      x.name)))));

  const levels = f.levels.filter(l => l.installs);
  $("fu-levels-head").replaceChildren(el("th", { text: "Feature" }), ...levels.map(l =>
    el("th", { title: `${n0(l.installs)} install${l.installs === 1 ? "" : "s"}`, text: levelName(l.lv) })));
  $("fu-levels").replaceChildren(...ranked.slice(0, 12).map(x => el("tr", {}, el("td", { text: x.name }),
    ...levels.map(l => el("td", { text: pct(l.use[x.id] || 0, l.installs) })))));

  // Picks: who had each voice, language and setting on at some point in the 30 days (several, if they changed it).
  const of = prefix => Object.entries(f.metrics).filter(([m]) => m.startsWith(prefix + "."))
    .map(([m, n]) => [m.slice(prefix.length + 1), n]).sort((p, q) => q[1] - p[1]);
  const group = (title, rows, name) => rows.length ? [el("tr", {}, el("th", { colspan: "3", text: title })),
    ...rows.map(([k, n]) => el("tr", {}, el("td", { text: name(k) }), el("td", { text: n0(n) }), el("td", { text: pct(n, a.d30) })))] : [];
  const picks = [...PICKS.flatMap(([prefix, title, names]) => group(title, of(prefix), k => names?.[k] || k)),
                 ...group("Settings on", of("on"), k => SETTING_NAMES[k] || k)];
  $("fu-picks").replaceChildren(...(picks.length ? picks : empty(3, "None sent yet.")));
}

// A row's trend: a 2px line over the days and a dot on the last one; a day nobody sent counts leaves a gap. Hovering
// shows every day's value (its title), and the table beside it has the numbers.
function sparkline(days, values, name) {
  const W = 120, H = 26, P = 3, NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "ad-spark");
  svg.setAttribute("role", "img");
  const max = Math.max(0, ...values.filter(v => v != null));
  const x = i => P + (W - 2 * P) * i / (values.length - 1), y = v => H - P - (H - 2 * P) * (max ? v / max : 0);
  const title = document.createElementNS(NS, "title");
  title.textContent = name + " per player-day: " +
    days.map((d, i) => fmtDay(d) + " " + (values[i] == null ? "none" : values[i].toFixed(1))).join(", ");
  svg.appendChild(title);
  svg.setAttribute("aria-label", title.textContent);
  let d = "";
  values.forEach((v, i) => {
    if (v != null) d += (i && values[i - 1] != null ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1);
  });
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  const last = values.length - 1;
  if (values[last] != null) {
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", x(last)); dot.setAttribute("cy", y(values[last])); dot.setAttribute("r", 3);
    svg.appendChild(dot);
  }
  return svg;
}

// Share heard to the end: the number, then a thin bar on a track.
function rateBar(done, started) {
  const share = started ? Math.min(1, done / started) : 0;
  const bar = el("span", { class: "ad-rate-bar" }, el("span", { style: `width:${(100 * share).toFixed(1)}%` }));
  return el("span", { class: "ad-rate" }, el("span", { text: pct(done, started) }), bar);
}

function renderFeedback() {
  const kind = $("kind").value;
  const list = data.feedback.filter(f =>
    (fbStatus === "all" || (fbStatus === "done" ? f.status === "done" : f.status !== "done")) && (!kind || f.kind === kind));
  $("fb-count").textContent = list.length + (list.length === 1 ? " report" : " reports");
  const box = $("fb-list");
  if (!list.length) { box.replaceChildren(el("p", { class: "ad-empty", text: "Nothing here." })); return; }
  box.replaceChildren(...list.map(f => {
    const done = f.status === "done";
    const toggle = el("button", { type: "button", class: "ad-link", text: done ? "Reopen" : "Mark done" });
    toggle.addEventListener("click", () => act({ action: "status", id: f.id, status: done ? "new" : "done" }, () => f.status = done ? "new" : "done"));
    const del = el("button", { type: "button", class: "ad-link ad-danger", text: "Delete" });
    del.addEventListener("click", () => {
      if (confirm("Delete report #" + f.id + " for good?")) act({ action: "delete-feedback", id: f.id }, () => data.feedback = data.feedback.filter(x => x !== f));
    });
    return el("article", { class: "ad-report" + (done ? " done" : "") },
      el("div", { class: "ad-report-head" },
        el("span", { class: "ad-kind", text: KINDS[f.kind] || f.kind }),
        f.rating ? el("span", { class: "ad-stars", title: f.rating + " of 5", text: "★".repeat(f.rating) + "☆".repeat(5 - f.rating) }) : null,
        el("span", { text: "#" + f.id + " · " + fmtDate(f.created) + (f.country ? " · " + f.country : "") })),
      el("p", { class: "ad-msg", text: f.message }),
      f.report && f.report.length ? el("p", { class: "ad-msg ad-ctx", text: f.report.join("\n") }) : null,
      el("div", { class: "ad-report-foot" },
        f.code ? el("span", {}, "Code ", el("code", { text: f.code })) : null,
        f.name ? el("span", { text: f.name + (f.quote_ok ? " (OK to quote)" : "") }) : f.quote_ok ? el("span", { text: "OK to quote" }) : null,
        f.email ? el("a", { href: "mailto:" + encodeURIComponent(f.email).replace("%40", "@"), text: f.email }) : null,
        el("span", { class: "ad-actions" }, toggle, del)));
  }));
}

// Only https links are shown as links (the API accepts only Drive, Dropbox and OneDrive ones).
const safeLink = url => /^https:\/\//i.test(url || "") ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: url }) : el("span", { text: url || "" });

function renderVoices() {
  const list = (data.voices || []).filter(v => voStatus === "all" || (voStatus === "done" ? v.status === "done" : v.status !== "done"));
  $("vo-count").textContent = list.length + (list.length === 1 ? " submission" : " submissions");
  const box = $("vo-list");
  if (!list.length) { box.replaceChildren(el("p", { class: "ad-empty", text: "Nothing here." })); return; }
  box.replaceChildren(...list.map(v => {
    const done = v.status === "done";
    const toggle = el("button", { type: "button", class: "ad-link", text: done ? "Reopen" : "Mark done" });
    toggle.addEventListener("click", () => act({ action: "voice-status", id: v.id, status: done ? "new" : "done" }, () => v.status = done ? "new" : "done"));
    const del = el("button", { type: "button", class: "ad-link ad-danger", text: "Delete" });
    del.addEventListener("click", () => {
      if (confirm("Delete voice submission #" + v.id + " for good? This also removes the record of their agreement.")) {
        act({ action: "delete-voice", id: v.id }, () => data.voices = data.voices.filter(x => x !== v));
      }
    });
    return el("article", { class: "ad-report" + (done ? " done" : "") },
      el("div", { class: "ad-report-head" },
        el("span", { class: "ad-kind", text: v.pack }),
        el("span", { text: "Credit: " + v.credit }),
        el("span", { text: "#" + v.id + " · " + fmtDate(v.created) + (v.country ? " · " + v.country : "") })),
      el("p", { class: "ad-msg" }, el("strong", { text: "Recordings: " }), safeLink(v.link)),
      el("p", { class: "ad-msg" }, el("strong", { text: "Clips: " }), v.clips),
      v.note ? el("p", { class: "ad-msg" }, el("strong", { text: "Note: " }), v.note) : null,
      el("div", { class: "ad-report-foot" },
        v.email ? el("a", { href: "mailto:" + encodeURIComponent(v.email).replace("%40", "@"), text: v.email }) : null,
        v.discord ? el("span", { text: "Discord: " + v.discord }) : null,
        el("span", { text: "Signed " + v.signature + " · release " + v.release_version + (v.adult_or_guardian ? (v.release_version < "2026-10-03" ? " · 18+ or guardian OK" : " · 18+") : "") }),
        el("span", { class: "ad-actions" }, toggle, del)));
  }));
}

// Translation submissions and bad-translation reports in one list, newest first. `kind` is the admin action suffix.
function renderTranslations() {
  const kind = $("tkind").value;
  const rows = [
    ...(data.translations || []).map(t => ({ ...t, kind: "translation" })),
    ...(data.translationReports || []).map(t => ({ ...t, kind: "translation-report" })),
  ].filter(t => (!kind || t.kind === kind) &&
    (trStatus === "all" || (trStatus === "done" ? t.status === "done" : t.status !== "done")))
   .sort((a, b) => (b.created || "").localeCompare(a.created || ""));
  $("tr-count").textContent = rows.length + (rows.length === 1 ? " item" : " items");
  const box = $("tr-list");
  if (!rows.length) { box.replaceChildren(el("p", { class: "ad-empty", text: "Nothing here." })); return; }
  box.replaceChildren(...rows.map(t => {
    const done = t.status === "done";
    const report = t.kind === "translation-report";
    const source = report ? "translationReports" : "translations";
    const toggle = el("button", { type: "button", class: "ad-link", text: done ? "Reopen" : "Mark done" });
    toggle.addEventListener("click", () => act({ action: "status-" + t.kind, id: t.id, status: done ? "new" : "done" },
      () => data[source].find(x => x.id === t.id).status = done ? "new" : "done"));
    const del = el("button", { type: "button", class: "ad-link ad-danger", text: "Delete" });
    del.addEventListener("click", () => {
      if (confirm("Delete " + (report ? "report" : "translation submission") + " #" + t.id + " for good?")) {
        act({ action: "delete-" + t.kind, id: t.id }, () => data[source] = data[source].filter(x => x.id !== t.id));
      }
    });
    const head = el("div", { class: "ad-report-head" },
      el("span", { class: "ad-kind", text: (report ? "Bad translation · " : "Translation · ") + (t.language || t.locale) }),
      report ? null : el("span", { text: "Credit: " + t.credit }),
      el("span", { text: "#" + t.id + " · " + fmtDate(t.created) + (t.country ? " · " + t.country : "") }));
    const body = report ? [
      t.code || t.place ? el("p", { class: "ad-msg" }, el("strong", { text: "Where: " }), t.code ? el("code", { text: t.code }) : null, t.code && t.place ? " · " : "", t.place || "") : null,
      el("p", { class: "ad-msg" }, el("strong", { text: "Wrong: " }), t.wrong),
      t.better ? el("p", { class: "ad-msg" }, el("strong", { text: "Better: " }), t.better) : null,
    ] : [
      t.link ? el("p", { class: "ad-msg" }, el("strong", { text: "Files: " }), safeLink(t.link)) : null,
      t.fix ? el("p", { class: "ad-msg" }, el("strong", { text: "Fix: " }), t.fix) : null,
      t.note ? el("p", { class: "ad-msg" }, el("strong", { text: "Note: " }), t.note) : null,
    ];
    return el("article", { class: "ad-report" + (done ? " done" : "") }, head, ...body,
      el("div", { class: "ad-report-foot" },
        t.email ? el("a", { href: "mailto:" + encodeURIComponent(t.email).replace("%40", "@"), text: t.email }) : null,
        t.discord ? el("span", { text: "Discord: " + t.discord }) : null,
        t.name ? el("span", { text: t.name }) : null,
        report ? null : el("span", { text: "Agreed to CC BY-SA terms " + t.terms_version }),
        el("span", { class: "ad-actions" }, toggle, del)));
  }));
}

// ---- shared Forever text (LOR-236): counts by status and the latest uploads ----
const CB_STATUS = ["single", "verified", "conflict", "flagged", "rejected", "shipped"];
function renderContributions() {
  const c = data.contributions || { counts: {}, accepted: 0, batches: [] };
  const total = CB_STATUS.reduce((a, s) => a + (c.counts[s] || 0), 0);
  $("cb-counts").textContent = total
    ? `${total.toLocaleString()} lines: ` + CB_STATUS.filter(s => c.counts[s]).map(s => `${c.counts[s].toLocaleString()} ${s}`).join(" · ")
      + ` · ${c.accepted.toLocaleString()} accepted (verified, or single for 48 hours)`
    : "Nothing shared yet.";
  badge("n-contrib", total);
  const box = $("cb-list");
  if (!c.batches.length) { box.replaceChildren(el("tr", {}, el("td", { colspan: "8", class: "ad-empty", text: "No uploads yet." }))); return; }
  box.replaceChildren(...c.batches.map(b => {
    const who = b.display_name ? b.display_name + (b.email ? " (" + b.email + ")" : "")
      : b.nick ? b.nick + " (nickname)" : "anonymous " + (b.uploader || "").slice(0, 10);
    const btn = el("button", { type: "button", class: "ad-link" + (b.rejected ? "" : " ad-danger"),
      text: b.rejected ? "Restore" : "Reject all from this sender" });
    btn.addEventListener("click", () => {
      if (!b.rejected && !confirm(`Reject every line ${who} sent (${b.batches_from} upload${b.batches_from === 1 ? "" : "s"})? Lines someone else also sent stay.`)) return;
      // The counts by status change on the server: load the dashboard again.
      act({ action: b.rejected ? "contrib-restore" : "contrib-reject", uploader: b.uploader }, () => load());
    });
    return el("tr", { class: b.rejected ? "done" : "" },
      el("td", {}, el("a", { href: "/contribute/r/" + b.upload_id, target: "_blank", rel: "noopener", text: fmtDate(b.created_at * 1000) })),
      el("td", { text: who }), el("td", { text: b.source }), el("td", { text: String(b.n_new) }),
      el("td", { text: String(b.n_confirmed) }), el("td", { text: String(b.n_known) + (b.n_invalid ? ` (+${b.n_invalid} unreadable)` : "") }),
      el("td", { text: [b.version, b.locale].filter(Boolean).join(" ") }), el("td", {}, btn));
  }));
}

// ---- translation edits: counts per language here; the edits themselves are on /admin/edits ----
async function loadEdits() {
  const box = $("ed-list");
  let res;
  try {
    const r = await fetch("/api/translations/summary", { cache: "no-store", headers: { Authorization: "Bearer " + key() } });
    res = await r.json().catch(() => ({}));
    if (!r.ok || !res.ok) throw new Error(res.error || "Request failed (" + r.status + ")");
  } catch (e) {
    box.replaceChildren(el("tr", {}, el("td", { colspan: "5", class: "ad-empty", text: "Couldn't load edits: " + e.message })));
    return;
  }
  const sum = k => res.locales.reduce((a, l) => a + l[k], 0);
  badge("n-edits", sum("saved"));   // gold: saved edits waiting for a pull
  const people = res.translators.length;
  $("ed-count").textContent = res.locales.length
    ? `${sum("saved").toLocaleString()} saved · ${sum("pulled").toLocaleString()} pulled · ${sum("rejected").toLocaleString()} rejected` +
      ` · ${people} translator${people === 1 ? "" : "s"}`
    : "";
  if (!res.locales.length) { box.replaceChildren(el("tr", {}, el("td", { colspan: "5", class: "ad-empty", text: "No edits yet." }))); return; }
  const n = v => (v || 0).toLocaleString();
  box.replaceChildren(...res.locales.map(l => el("tr", {},
    el("td", {}, el("a", { href: "/admin/edits?locale=" + l.locale, text: l.locale })),
    el("td", { text: n(l.saved) }), el("td", { text: n(l.pulled) }), el("td", { text: n(l.rejected) }),
    el("td", { text: fmtDate(l.last) }))));
}

// ---- clip reports (their own endpoint, like the edits) ----
let crStatus = "open";
let clipReports = [];
async function crApi(method, action, body) {
  const r = await fetch("/api/clip-report/" + action, {
    method, cache: "no-store",
    headers: { Authorization: "Bearer " + key(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await r.json().catch(() => ({}));
  if (!r.ok || !res.ok) throw new Error(res.error || "Request failed (" + r.status + ")");
  return res;
}
async function loadClipReports() {
  try {
    clipReports = (await crApi("GET", "export?status=" + crStatus)).reports;
  } catch (e) {
    clipReports = [];
    $("cr-list").replaceChildren(el("p", { class: "ad-empty", text: "Couldn't load clip reports: " + e.message }));
    return;
  }
  renderClipReports();
}
async function rejectUploader(uploader, restore) {
  try { await crApi("POST", "reject", { uploader, restore }); } catch (e) { alert("That didn't work: " + e.message); return; }
  loadClipReports();
}
const clipWords = id => {
  const m = String(id).match(/^([a-z]+):([a-z0-9-]+)(?:#faq(\d+)|#(\w+))?$/);
  return m ? m[2].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) + (m[3] ? " · answer " + m[3] : m[4] ? " · " + m[4] : "") : id;
};
const voiceWords = v => String(v || "").replace("LoreForever_Voice_", "").replace(/_/g, " ");
function renderClipReports() {
  const open = clipReports.filter(r => r.status === "open");
  if (crStatus === "open") badge("n-clip-reports", open.length);
  $("cr-count").textContent = clipReports.length + (clipReports.length === 1 ? " report" : " reports");
  // Per clip and voice: how many, why, which names (with how they should sound).
  const groups = new Map();
  for (const r of clipReports) {
    const k = r.clip + "|" + r.voice;
    const g = groups.get(k) || { clip: r.clip, voice: r.voice, n: 0, people: new Set(), reasons: {}, names: new Set() };
    g.n++;
    g.people.add(r.uploader);
    g.reasons[r.reason] = (g.reasons[r.reason] || 0) + 1;
    if (r.name) g.names.add(r.name + (r.say_as ? " → " + r.say_as : ""));
    groups.set(k, g);
  }
  const rows = [...groups.values()].sort((a, b) => b.people.size - a.people.size || b.n - a.n);
  $("cr-clips").replaceChildren(...(rows.length ? rows.map(g => el("tr", {},
    el("td", {}, clipWords(g.clip), " ", el("code", { text: g.clip })),
    el("td", { text: voiceWords(g.voice) }),
    el("td", { text: g.people.size + (g.people.size === 1 ? " person" : " people") }),
    el("td", { text: Object.entries(g.reasons).map(([k, n]) => k + (n > 1 ? " ×" + n : "")).join(", ") }),
    el("td", { text: [...g.names].join("; ") })))
    : [el("tr", {}, el("td", { colspan: "5", class: "ad-empty", text: "No reports here." }))]));
  const box = $("cr-list");
  if (!clipReports.length) { box.replaceChildren(el("p", { class: "ad-empty", text: "Nothing here." })); return; }
  box.replaceChildren(...clipReports.slice(0, 200).map(r => {
    const rejected = r.status === "rejected";
    const act = el("button", { type: "button", class: "ad-link" + (rejected ? "" : " ad-danger"),
      text: rejected ? "Restore this uploader" : "Reject all from this uploader" });
    act.addEventListener("click", () => {
      const n = clipReports.filter(x => x.uploader === r.uploader && x.status === (rejected ? "rejected" : "open")).length;
      if (rejected || confirm("Reject every open report from this uploader (" + n + " in this list)?")) rejectUploader(r.uploader, rejected);
    });
    return el("article", { class: "ad-report" + (r.status === "open" ? "" : " done") },
      el("div", { class: "ad-report-head" },
        el("span", { class: "ad-kind", text: r.reason }),
        el("span", { text: clipWords(r.clip) + " · " + voiceWords(r.voice) }),
        el("span", { text: "#" + r.id + " · " + fmtDate(r.created) + (r.country ? " · " + r.country : "") + " · " + r.status })),
      r.name || r.say_as ? el("p", { class: "ad-msg" }, el("strong", { text: "Name: " }), (r.name || "?") + (r.say_as ? " → " + r.say_as : "")) : null,
      r.note ? el("p", { class: "ad-msg", text: r.note }) : null,
      el("div", { class: "ad-report-foot" },
        el("code", { text: r.clip + (r.hash ? "@" + r.hash : "") }),
        el("span", { text: (r.signed_in ? "signed in · " : "") + r.uploader.slice(0, 14) + (r.version ? " · " + r.version : "") + (r.locale ? " " + r.locale : "") }),
        el("span", { class: "ad-actions" }, act)));
  }));
}
document.querySelectorAll("[data-crstatus]").forEach(b => b.addEventListener("click", () => {
  crStatus = b.dataset.crstatus;
  document.querySelectorAll("[data-crstatus]").forEach(x => x.setAttribute("aria-pressed", x === b));
  loadClipReports();
}));

// ---- Willo's answers (their own endpoint): flagged answers and the Forever facts ----
let wStatus = "new";
let willo = { feedback: { counts: [], rows: [], zones: [] }, facts: [] };
async function wApi(method, body) {
  const r = await fetch("/api/admin/willo", {
    method, cache: "no-store",
    headers: { Authorization: "Bearer " + key(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await r.json().catch(() => ({}));
  if (!r.ok || !res.ok) throw new Error(res.error || "Request failed (" + r.status + ")");
  return res;
}
async function loadWillo() {
  try { willo = await wApi("GET"); }
  catch (e) {
    $("w-list").replaceChildren(el("p", { class: "ad-empty", text: "Couldn't load Willo's feedback: " + e.message }));
    return;
  }
  renderWillo();
}
async function willoAct(body) {
  try { await wApi("POST", body); } catch (e) { alert("That didn't work: " + e.message); return; }
  loadWillo();
}
const W_KINDS = { correction: "Said it's wrong", frustration: "Frustrated", flag: "Flagged" };
function renderWillo() {
  const rows = willo.feedback.rows.filter(r => wStatus === "all" || r.status === "new");
  badge("n-willo", willo.feedback.rows.filter(r => r.status === "new").length);
  $("w-count").textContent = rows.length + (rows.length === 1 ? " signal" : " signals");
  $("w-zones").textContent = willo.feedback.zones.length ? "New by zone: " + willo.feedback.zones.map(z =>
    (z.zone || "unknown") + " " + z.n + (z.players > 1 ? " (" + z.players + " players)" : "")).join(" · ") : "";
  const box = $("w-list");
  if (!rows.length) box.replaceChildren(el("p", { class: "ad-empty", text: "Nothing here." }));
  else box.replaceChildren(...rows.map(r => {
    const button = (text, onClick, cls = "") => {
      const b = el("button", { type: "button", class: "ad-link" + cls, text });
      b.addEventListener("click", onClick);
      return b;
    };
    const fact = button("Make it a fact", () => {
      const text = prompt("The Forever fact, as Willo should know it (one or two sentences):", r.said);
      if (!text) return;
      const title = prompt("A short title (what it's about):", r.sub || r.zone || "");
      if (!title) return;
      const source_url = prompt("A source link (https://…), or leave empty for your own word:", "") || "";
      willoAct({ action: "fact-add", title, text, zone: r.zone || "", source_url,
        source_title: source_url ? "" : "Checked by Mike", feedback_id: r.id });
    });
    return el("article", { class: "ad-report" + (r.status === "new" ? "" : " done") },
      el("div", { class: "ad-report-head" },
        el("span", { class: "ad-kind", text: W_KINDS[r.kind] || r.kind }),
        el("span", { text: [r.sub, r.zone].filter(Boolean).join(", ") + (r.spoken ? " · out loud" : "") }),
        el("span", { text: "#" + r.id + " · " + fmtDate(r.created) + " · " + r.status + (r.fact_id ? " → " + r.fact_id : "") })),
      el("p", { class: "ad-msg" }, el("strong", { text: "Player: " }), r.said),
      r.question ? el("p", { class: "ad-msg" }, el("strong", { text: "They had asked: " }), r.question) : null,
      r.answer ? el("p", { class: "ad-msg" }, el("strong", { text: "Willo said: " }), r.answer) : null,
      r.note ? el("p", { class: "ad-msg" }, el("strong", { text: "Checked: " }), r.note) : null,
      el("div", { class: "ad-report-foot" }, el("span", { class: "ad-actions" },
        r.status === "new" ? fact : null,
        r.status === "new" ? button("Checked", () => willoAct({ action: "feedback-status", id: r.id, status: "checked" })) : null,
        r.status === "new" ? button("Dismiss", () => willoAct({ action: "feedback-status", id: r.id, status: "dismissed" }), " ad-danger")
          : button("Reopen", () => willoAct({ action: "feedback-status", id: r.id, status: "new" })))));
  }));
  const facts = willo.facts;
  $("wf-count").textContent = facts.length + " in answers";
  $("wf-list").replaceChildren(...facts.map(f => {
    const remove = el("button", { type: "button", class: "ad-link ad-danger", text: "Take out" });
    remove.addEventListener("click", () => { if (confirm("Take \"" + f.title + "\" out of Willo's answers?")) willoAct({ action: "fact-remove", id: f.id }); });
    return el("article", { class: "ad-report" },
      el("div", { class: "ad-report-head" }, el("span", { class: "ad-kind", text: f.origin }),
        el("span", { text: f.title + (f.zone ? " · " + f.zone : "") })),
      el("p", { class: "ad-msg", text: f.text }),
      el("div", { class: "ad-report-foot" },
        f.source_url ? el("a", { href: f.source_url, target: "_blank", rel: "noopener noreferrer", text: f.source_title || f.source_url })
          : el("span", { text: f.source_title || "" }),
        f.origin === "seed" ? null : el("span", { class: "ad-actions" }, remove)));
  }));
}
document.querySelectorAll("[data-wstatus]").forEach(b => b.addEventListener("click", () => {
  wStatus = b.dataset.wstatus;
  document.querySelectorAll("[data-wstatus]").forEach(x => x.setAttribute("aria-pressed", x === b));
  renderWillo();
}));

const ROLES = { subscriber: c => c.subscriber && !isTest(c.subscriber), account: c => c.user,
                player: c => c.user?.handle, voice: c => c.user?.voices, translator: c => c.user?.languages,
                feedback: c => c.user && !c.user.voices && !c.user.languages && !c.user.handle };
function visibleContacts() {
  const q = $("cq").value.trim().toLowerCase(), role = ROLES[$("crole").value];
  return mergeContacts(data.subscribers, data.users).filter(c => (!role || role(c)) &&
    (!q || [c.email, c.user?.display_name, c.user?.character, c.user?.links, c.subscriber?.source]
      .some(value => (value || "").toLowerCase().includes(q))));
}

// A player profile (lib/profiles.js): "Aelric, 24 Druid", linking to /u/<handle>, and whether only they can see it.
const profileText = u => u.handle ? `${u.character || u.handle}${u.char_level ? ", " + u.char_level : ""}${u.char_class ? " " + u.char_class : ""}` : "";
const linkHosts = u => (u.links || "").split(/\s+/).filter(x => /^https:\/\//.test(x));

// Leave an account out of every count on this page, or count it again (lib/activity.js setExclusion); the account stays.
const LEFT_OUT = { admin: "Left out of counts: your admin account",
                   config: "Left out of counts: ANALYTICS_EXCLUDE", manual: "Left out of counts" };
function countedToggle(u) {
  const out = Boolean(u.excluded) && u.excluded !== "counted";
  const b = el("button", { type: "button", class: "ad-link", text: out ? "Count again" : "Leave out of counts" });
  b.addEventListener("click", () => act({ action: out ? "count-account" : "exclude-account", id: u.id }, () => load()));
  return el("span", { class: "ae-sub" }, out ? LEFT_OUT[u.excluded] + " · " : "", b);
}

function renderContacts() {
  const list = visibleContacts(), count = list.filter(c => !c.test).length, tests = list.length - count;
  $("co-count").textContent = count + (count === 1 ? " contact" : " contacts") + (tests ? " · " + tests + " test" : "");
  const body = $("co-list");
  if (!list.length) { body.replaceChildren(el("tr", {}, el("td", { colspan: "9", class: "ad-empty", text: "No contacts here." }))); return; }
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
  body.replaceChildren(...list.map(c => {
    const u = c.user || {}, s = c.subscriber;
    const subscription = el("td", { text: s && !isTest(s) ? "Subscribed" : "Not subscribed" });
    if (s) {
      subscription.append(el("span", { class: "ae-sub", text: (s.source || "Email signup") + " · " + fmtDate(s.created_at) }));
      const remove = el("button", { type: "button", class: "ad-link ad-danger", text: "Remove subscription" });
      remove.addEventListener("click", () => {
        if (confirm("Remove " + c.email + " from release news? Their account will stay.")) {
          act({ action: "delete-subscriber", email: s.email }, () => data.subscribers = data.subscribers.filter(x => x !== s));
        }
      });
      subscription.append(remove);
    }
    return el("tr", {},
    el("td", {}, el("a", { href: "mailto:" + encodeURIComponent(c.email).replace("%40", "@"), text: c.email }),
      c.user ? el("span", { class: "ae-sub", text: "Contributor account" }) : null,
      c.user ? countedToggle(c.user) : null,
      c.test ? el("span", { class: "ad-test", text: "test" }) : null),
    subscription,
    el("td", { text: u.display_name || "" }),
    el("td", {}, ...(u.handle ? [el("a", { href: "/u/" + encodeURIComponent(u.handle), target: "_blank", rel: "noopener", text: profileText(u) }),
                                 u.profile_public ? "" : " (private)"] : [])),
    el("td", {}, ...linkHosts(u).flatMap((x, i) => [i ? " · " : "", el("a", { href: x, target: "_blank", rel: "noopener nofollow", text: new URL(x).hostname.replace(/^www\./, "") })])),
    el("td", { text: u.voices || "" }),
    el("td", { text: u.languages || "" }),
    el("td", {}, ...[u.takes && plural(u.takes, "take"),
                     u.edits && el("a", { href: "/admin/edits?status=all&user=" + encodeURIComponent(u.id), text: plural(u.edits, "edit") }),
                     u.feedback && plural(u.feedback, "report")].filter(Boolean).flatMap((x, i) => i ? [" · ", x] : [x])),
    el("td", { text: fmtDate(c.created) }));
  }));
}

async function act(body, onDone) {
  try { await api("POST", body); onDone(); render(); }
  catch (e) { if (e.message !== "unauthorized") alert("That didn't work: " + e.message); }
}

// ---- tabs: one shown at a time, chosen by the address's # (so /admin#growth or /admin#contacts links straight there) ----
const TABS = ["overview", "growth", "players", "community"];
const SECTION_TAB = { funnel: "growth", curseforge: "growth", downloads: "growth", companions: "growth",
                      profiles: "players", signins: "players", features: "players", usage: "players" };
const SUBS = ["feedback", "voices", "willo", "clip-reports", "translations", "edits", "contributions", "contacts"];
let sub = "feedback", clipsLoaded = false;
function route() {
  const id = decodeURIComponent(location.hash.slice(1));
  const tab = TABS.includes(id) ? id : SECTION_TAB[id] || (SUBS.includes(id) ? "community" : "overview");
  if (SUBS.includes(id)) sub = id;
  document.querySelectorAll(".ad-tab").forEach(t => { t.hidden = t.dataset.tab !== tab; });
  document.querySelectorAll("#nav a").forEach(a => a.setAttribute("aria-current", a.dataset.tab === tab));
  document.querySelectorAll(".ad-sub-tab").forEach(s => { s.hidden = s.dataset.sub !== sub; });
  document.querySelectorAll("#subnav a").forEach(a => a.setAttribute("aria-current", a.dataset.sub === sub));
  // The clip reports come from their own endpoint: only once Community is opened.
  if (tab === "community" && data && !clipsLoaded) { clipsLoaded = true; loadClipReports(); loadWillo(); }
  if (SECTION_TAB[id]) $(id).scrollIntoView(); else scrollTo(0, 0);
  // On a narrow screen the bar scrolls sideways: keep the chosen tab in view (sideways only).
  const nav = $("nav"), current = nav.querySelector(`a[data-tab="${tab}"]`);
  const left = current.offsetLeft - nav.offsetLeft, right = left + current.offsetWidth;
  if (left < nav.scrollLeft || right > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = left - 16;
}
addEventListener("hashchange", route);

// ---- wiring ----
$("login-form").addEventListener("submit", e => {
  e.preventDefault();
  setKey($("key").value.trim(), $("remember").checked);
  $("key").value = "";
  load();
});
$("signout").addEventListener("click", () => signOut());
$("refresh").addEventListener("click", load);
$("kind").addEventListener("change", renderFeedback);
document.querySelectorAll("[data-status]").forEach(b => b.addEventListener("click", () => {
  fbStatus = b.dataset.status;
  document.querySelectorAll("[data-status]").forEach(x => x.setAttribute("aria-pressed", x === b));
  renderFeedback();
}));
document.querySelectorAll("[data-vstatus]").forEach(b => b.addEventListener("click", () => {
  voStatus = b.dataset.vstatus;
  document.querySelectorAll("[data-vstatus]").forEach(x => x.setAttribute("aria-pressed", x === b));
  renderVoices();
}));
document.querySelectorAll("[data-tstatus]").forEach(b => b.addEventListener("click", () => {
  trStatus = b.dataset.tstatus;
  document.querySelectorAll("[data-tstatus]").forEach(x => x.setAttribute("aria-pressed", x === b));
  renderTranslations();
}));
$("tkind").addEventListener("change", renderTranslations);
$("cq").addEventListener("input", renderContacts);
$("crole").addEventListener("change", renderContacts);

async function copyAddresses(button, addresses) {
  const text = addresses.join("\n");
  try { await navigator.clipboard.writeText(text); button.textContent = "Copied"; }
  catch (e) { prompt("Copy these addresses:", text.replace(/\n/g, ", ")); }
  setTimeout(() => button.textContent = "Copy addresses", 1500);
}
function downloadCsv(name, rows) {
  // A leading = + - @ (or tab) would make a spreadsheet run the cell as a formula; names come from players.
  const cell = v => '"' + String(v ?? "").replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""') + '"';
  const blob = new Blob([rows.map(r => r.map(cell).join(",")).join("\n")], { type: "text/csv" });
  const a = el("a", { href: URL.createObjectURL(blob), download: "loreforever-" + name + "-" + new Date().toISOString().slice(0, 10) + ".csv" });
  document.body.append(a); a.click(); a.remove();
}
$("ccopy").addEventListener("click", () => copyAddresses($("ccopy"), visibleContacts().filter(c => !c.test).map(c => c.email)));
$("ccsv").addEventListener("click", () => downloadCsv("contacts",
  [["email", "release_news", "source", "subscribed_at", "name", "character", "level", "class", "profile", "public", "links", "voices", "languages", "takes", "edits", "feedback", "account_created", "first_seen"],
   ...visibleContacts().filter(c => !c.test).map(c => {
     const u = c.user || {}, s = c.subscriber;
     return [c.email, s && !isTest(s) ? "yes" : "no", s?.source, s?.created_at, u.display_name, u.character, u.char_level, u.char_class,
     u.handle ? "https://loreforeverwow.com/u/" + u.handle : "", u.handle ? (u.profile_public ? "yes" : "no") : "",
     linkHosts(u).join(" "), u.voices, u.languages, u.takes, u.edits, u.feedback, u.created, c.created];
   })]));

if (key()) load(); else signOut();
