// /admin's Growth > Plans & usage (functions/api/admin/plans-usage.js, lib/plan-usage.js): what each plan's players
// really use, for pricing decisions: answers asked out loud or typed, look-ups, sight and characters, limits that
// turned answers away, which voice said the replies (or why the PC did), the Willo voices picked, and plans by where
// their checkout started. By plan, never who; one CSV of all of it. Loaded by admin-page.js when Growth opens.

const PLAN = { free: "Free", "free-brake": "Free (brake on)", "beta-hero": "Beta's free Hero month", hero: "Hero",
  champion: "Champion", legend: "Legend", "": "Before plans were recorded (Oct 19)" };
// A paid plan Stripe calls a trial: a Keep Hero trial, or a paid plan whose next charge moved to November 4.
const planName = p => PLAN[p] ?? (p.startsWith("reward-") ? `${PLAN[p.slice(7)] || p.slice(7)} (free month for friends)`
  : p.endsWith("-trialing") ? `${PLAN[p.slice(0, -9)] || p.slice(0, -9)} (Stripe trial)` : p);
const KIND = { willo: "Willo's answers", character: "Characters", line: "Willo's own lines" };
const PC = { room: "the month's room for her hosted voice was used", long: "the reply was too long",
  busy: "too many at once", unavailable: "no hosted voice answered", off: "plans are off", reading: "an add-on answer read aloud" };
const voiceName = s => {
  const [kind, rest] = s.split(":");
  if (kind === "pc") return `Her PC voice: ${PC[rest] || rest}`;
  const name = rest ? rest[0].toUpperCase() + rest.slice(1) : "";
  return kind === "finest" ? `Finest · ${name}` : kind === "studio" ? `Studio · ${name}` : s;
};
const LIMIT = { day: "Daily answers", month: "Month's answers", cost_cap: "Month's cost cap", brake: "Free brake" };
const SOURCE = { welcome: "Welcome page", plans: "Plans page", "willo-empty": "Willo: her answers ran out",
  "willo-chorus": "Willo: her best-first answers ended", "willo-locked": "Willo: a locked feature",
  "willo-ask": "Willo offered Plans", "": "Before tracking (Oct 19)" };
const PAID = ["hero", "champion", "legend"];
const pct = (n, of) => of ? `${Math.round(100 * n / of)}%` : "—";
const fmtDay = d => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...kids.filter(k => k !== null && k !== undefined && k !== false));
  return node;
}
const row = (...cells) => el("tr", {}, ...cells.map(c => el("td", { text: String(c ?? "—") })));
const empty = (cols, text) => el("tr", {}, el("td", { colspan: String(cols), class: "ad-empty", text }));

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Every table in one CSV: section, plan, what, players, count, share.
export function plansCsv(res) {
  const q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const lines = [["section", "plan", "what", "players", "count", "share"]];
  for (const a of res.answers) {
    lines.push(["answers", a.plan, "answers", a.players, a.answers, ""]);
    for (const k of ["spoken", "typed", "quick", "required", "sight", "characters"])
      lines.push(["answers", a.plan, k, "", a[k], pct(a[k], a.answers)]);
  }
  for (const l of res.limits) lines.push(["limits", l.plan, l.kind, l.players, l.n, ""]);
  for (const v of res.voices) lines.push(["voices", v.plan, `${v.kind} ${v.said}`, v.players, v.replies, ""]);
  for (const p of res.picks) lines.push(["picks", p.plan, p.pick, p.players, p.replies, ""]);
  for (const s of res.sources) lines.push(["checkout source", s.plan, s.source || "before tracking", "", s.n, ""]);
  return lines.map(l => l.map(q).join(",")).join("\n") + "\n";
}

export function loadPlansUsage(key, $ = id => document.getElementById(id)) {
  let last = null;
  const say = msg => { $("pu-status").hidden = !msg; $("pu-status").textContent = msg || ""; };
  async function render() {
    say("");
    let res;
    try {
      const r = await fetch(`/api/admin/plans-usage?days=${$("pu-days").value}`, { cache: "no-store",
        headers: { Authorization: "Bearer " + key() } });
      res = await r.json().catch(() => ({}));
      if (!r.ok || !res.ok) throw new Error(res.error || `Request failed (${r.status})`);
    } catch (e) { say(e.message); return; }
    last = res;
    const days = Math.max(1, Math.ceil((Date.now() - Date.parse(`${res.collectingSince}T00:00:00Z`)) / 864e5));
    const shared = res.answers.reduce((n, a) => n + a.answers, 0);
    $("pu-note").textContent = [
      `Collecting since ${fmtDay(res.collectingSince)} (${days} day${days === 1 ? "" : "s"} so far)` +
        (res.since < res.collectingSince ? `, so the last ${res.days} days only have what came since.` : "."),
      `${res.allAnswers.answers.toLocaleString()} live answers from ${res.allAnswers.players} players in these days; ` +
        `${shared.toLocaleString()} of them from players who share their answers, the last ${res.answersDays} days, below.`,
      days < 14 || shared < 200 ? "This is still thin: read it as a hint." : "",
    ].filter(Boolean).join(" ");
    $("pu-answers").replaceChildren(...res.answers.map(a => row(planName(a.plan), a.players, a.answers.toLocaleString(),
      `${a.spoken} (${pct(a.spoken, a.answers)})`, `${a.typed} (${pct(a.typed, a.answers)})`,
      `${a.quick + a.required} (${pct(a.quick + a.required, a.answers)})`, `${a.sight} (${pct(a.sight, a.answers)})`,
      `${a.characters} (${pct(a.characters, a.answers)})`)));
    if (!res.answers.length) $("pu-answers").replaceChildren(empty(8, "No shared answers in these days yet."));
    // Limits: one row a plan, a column a limit, "players / times".
    const plans = [...new Set(res.limits.map(l => l.plan))];
    $("pu-limits").replaceChildren(...plans.map(p => row(planName(p), ...Object.keys(LIMIT).map(k => {
      const l = res.limits.find(x => x.plan === p && x.kind === k);
      return l ? `${l.players} / ${l.n}` : "";
    }))));
    if (!plans.length) $("pu-limits").replaceChildren(empty(5, "No answer turned away by a limit in these days."));
    $("pu-voices").replaceChildren(...res.voices.map(v => row(planName(v.plan), KIND[v.kind] || v.kind, voiceName(v.said),
      v.players, v.replies.toLocaleString())));
    if (!res.voices.length) $("pu-voices").replaceChildren(empty(5, "No spoken replies recorded in these days yet."));
    $("pu-picks").replaceChildren(...res.picks.map(p => row(planName(p.plan), p.pick[0].toUpperCase() + p.pick.slice(1),
      p.players, p.replies.toLocaleString())));
    if (!res.picks.length) $("pu-picks").replaceChildren(empty(4, "No Willo voice picked in these days yet."));
    // Plans by checkout source: a row a source, a column a paid plan.
    const sources = [...new Set(res.sources.map(s => s.source))];
    $("pu-sources").replaceChildren(...sources.map(s => {
      const n = p => res.sources.filter(x => x.source === s && x.plan === p).reduce((t, x) => t + x.n, 0);
      return row(SOURCE[s] || s, ...PAID.map(n), PAID.reduce((t, p) => t + n(p), 0));
    }));
    if (!sources.length) $("pu-sources").replaceChildren(empty(5, "No plans yet."));
  }
  if (!$("pu-days").dataset.wired) {
    $("pu-days").dataset.wired = "1";
    $("pu-days").addEventListener("change", render);
    $("pu-csv").addEventListener("click", () => last && download(plansCsv(last),
      `plans-usage-${last.days}d-${new Date().toISOString().slice(0, 10)}.csv`));
  }
  return render();
}
