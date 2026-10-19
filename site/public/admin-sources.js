// /admin's Growth > Sources (functions/api/admin/sources.js, lib/sources.js): for each source a visit started from (a
// tracked link, another site, a search engine), its path through the site between two days: visits, first visits,
// downloads, sign-ups, first Willo connects, paid plans and revenue; by landing page too; as a CSV; and the form that
// makes a tracked link for an article (loreforeverwow.com/a/<name>). Loaded by admin-page.js when Growth opens.

const n0 = n => (n || 0).toLocaleString("en-US");
const usd = cents => `$${((cents || 0) / 100).toFixed(2)}`;
const day = d => d.toISOString().slice(0, 10);

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

async function call(key, method, query = "", body) {
  const r = await fetch(`/api/admin/sources${query}`, { method, cache: "no-store",
    headers: { Authorization: "Bearer " + key(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const res = await r.json().catch(() => ({}));
  if (!r.ok || !res.ok) throw new Error(res.error || `Request failed (${r.status})`);
  return res;
}

// A source as people read it: "PC Gamer guide (pcgamer-forever)", "Site: pcgamer.com", "Search: Google", "?src=lore".
export function sourceName(row) {
  const src = String(row.src || "");
  if (src.startsWith("site:")) return `Site: ${src.slice(5)}`;
  if (src.startsWith("search:")) return `Search: ${src.slice(7, 8).toUpperCase()}${src.slice(8)}`;
  return row.label ? `${row.label} (${src})` : `?src=${src}`;
}

// The CSV of a report: one line per row, its columns named, and a totals line.
export const COLUMNS = [["visits", "Visits"], ["new", "First visits"], ["downloads", "Downloads"],
  ["willoDownloads", "Willo downloads"], ["signups", "Sign-ups"], ["willo", "Willo connected"], ["paid", "Paid plans"],
  ["revenue", "Revenue (USD)"]];
const cell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
export function reportCsv(res) {
  const head = ["Source", "Source key", ...(res.byLanding ? ["Landing page"] : []), ...COLUMNS.map(c => c[1])];
  const line = r => [sourceName(r), r.src, ...(res.byLanding ? [r.landing] : []),
    ...COLUMNS.map(([k]) => k === "revenue" ? ((r[k] || 0) / 100).toFixed(2) : r[k] || 0)];
  const total = ["Total", "", ...(res.byLanding ? [""] : []),
    ...COLUMNS.map(([k]) => k === "revenue" ? ((res.totals[k] || 0) / 100).toFixed(2) : res.totals[k] || 0)];
  return [head, ...res.rows.map(line), total].map(r => r.map(cell).join(",")).join("\n") + "\n";
}

// The search table's CSV: per page, Google's numbers and what visits from Google did there, then its top searches.
export function searchCsv(search) {
  const head = ["Page", "Search clicks", "Impressions", "Click rate (%)", "Position", "Visits from Google", "Sign-ups",
    "Paid plans", "Top searches"];
  const line = p => [p.landing, p.clicks, p.impressions, p.ctr, p.position, p.ours?.visits || 0, p.ours?.signups || 0,
    p.ours?.paid || 0, p.queries.map(q => `${q.query} (${q.impressions})`).join("; ")];
  return [head, ...(search.pages || []).map(line)].map(r => r.map(cell).join(",")).join("\n") + "\n";
}

export function loadSources(key, $ = id => document.getElementById(id)) {
  let last = null, lastSearch = null;
  const say = (msg, good) => { $("src-status").hidden = !msg; $("src-status").textContent = msg || "";
    $("src-status").classList.toggle("fb-good", Boolean(good)); };
  if (!$("src-from").value) {
    const now = new Date();
    $("src-to").value = day(now);
    $("src-from").value = day(new Date(now.getTime() - 29 * 86400e3));
  }
  async function render() {
    const by = $("src-by").checked;
    let res;
    try { res = await call(key, "GET", `?from=${$("src-from").value}&to=${$("src-to").value}${by ? "&by=landing" : ""}`); }
    catch (e) { say(e.message); return; }
    last = res;
    $("src-landing-h").hidden = !res.byLanding;
    const nums = r => COLUMNS.map(([k]) => el("td", { text: k === "revenue" ? usd(r[k]) : n0(r[k]) }));
    $("src-rows").replaceChildren(...res.rows.map(r => el("tr", {},
      el("td", { text: sourceName(r) }), res.byLanding ? el("td", {}, el("code", { text: r.landing })) : null, ...nums(r))));
    if (!res.rows.length) $("src-rows").replaceChildren(el("tr", {}, el("td", { colspan: String(COLUMNS.length + 2), class: "ad-empty",
      text: "No visits from other sites or tracked links in these days yet." })));
    $("src-total").replaceChildren(el("tr", {}, el("th", { text: "Total" }), res.byLanding ? el("th") : null,
      ...COLUMNS.map(([k]) => el("th", { text: k === "revenue" ? usd(res.totals[k]) : n0(res.totals[k]) }))));
    $("src-note").textContent = `${res.from} to ${res.to}, UTC. Each step counts on the day it happened, under where that ` +
      "browser's (or account's) first visit came from.";
    $("src-links").replaceChildren(...res.links.map(l => el("tr", l.retired ? { style: "opacity:.55" } : {},
      el("td", {}, el("strong", { text: l.label }), el("br"), el("code", { text: `${location.origin}/a/${l.slug}` })),
      el("td", { text: n0(l.opens) }), el("td", {}, el("code", { text: l.target })), el("td", { text: l.created.slice(0, 10) }),
      el("td", {}, el("button", { type: "button", text: "Copy", onclick: () => copy(`${location.origin}/a/${l.slug}`) }), " ",
        el("button", { type: "button", text: l.retired ? "Turn on" : "Turn off", onclick: () =>
          act({ action: l.retired ? "restore" : "retire", slug: l.slug }, l.retired ? "Link on." : "Link off: it opens the home page.") })))));
    if (!res.links.length) $("src-links").replaceChildren(el("tr", {}, el("td", { colspan: "5", class: "ad-empty",
      text: "No tracked links yet. Make one above for each article." })));
    renderSearch(res.from, res.to);
  }
  // Google Search per page (lib/search-console.js), asked after the table so it never waits for Google.
  async function renderSearch(from, to) {
    $("sc-note").textContent = "Asking Google Search…";
    let search;
    try { search = (await call(key, "GET", `?search=1&from=${from}&to=${to}`)).search; }
    catch (e) { $("sc-note").textContent = e.message; return; }
    lastSearch = search;
    $("sc-wrap").hidden = $("sc-csv").hidden = !search.pages;
    $("sc-site").textContent = search.site ? `(${search.site})` : "";
    if (!search.on) {
      $("sc-note").textContent = "Not connected yet: it needs a Search Console service account (the Pages secret " +
        "GSC_SERVICE_ACCOUNT). Then each page shows the searches that brought people to it, here.";
      return;
    }
    if (search.error) { $("sc-note").textContent = `Google Search didn't answer: ${search.error}`; return; }
    $("sc-note").textContent = "Google's numbers run 2-3 days behind, and are asked at most every 6 hours. Visits, " +
      "sign-ups and plans are the site's own, from visits that came from Google and landed on that page.";
    $("sc-rows").replaceChildren(...search.pages.slice(0, 100).map(p => el("tr", {},
      el("td", {}, el("code", { text: p.landing })), el("td", { text: n0(p.clicks) }), el("td", { text: n0(p.impressions) }),
      el("td", { text: `${p.ctr}%` }), el("td", { text: String(p.position) }), el("td", { text: n0(p.ours?.visits) }),
      el("td", { text: n0(p.ours?.signups) }), el("td", { text: n0(p.ours?.paid) }),
      el("td", {}, p.queries.length ? el("details", {}, el("summary", { text: p.queries[0].query }),
        el("ul", {}, ...p.queries.map(q => el("li", { text: `${q.query}: ${n0(q.impressions)} impressions, ${n0(q.clicks)} clicks, position ${q.position}` }))))
        : "—"))));
    if (!search.pages.length) $("sc-rows").replaceChildren(el("tr", {}, el("td", { colspan: "9", class: "ad-empty",
      text: "Google has nothing for these days yet." })));
  }
  async function copy(url) {
    try { await navigator.clipboard.writeText(url); say(`Copied ${url}`, true); } catch (e) { say(`The link: ${url}`, true); }
  }
  async function act(body, done) {
    try { await call(key, "POST", "", body); say(done, true); } catch (e) { say(e.message); }
    await render();
  }
  if (!$("src-range").dataset.wired) {
    $("src-range").dataset.wired = "1";
    $("src-range").addEventListener("submit", e => { e.preventDefault(); render(); });
    $("src-by").addEventListener("change", render);
    $("src-csv").addEventListener("click", () => {
      if (!last) return;
      const url = URL.createObjectURL(new Blob([reportCsv(last)], { type: "text/csv" }));
      const a = el("a", { href: url, download: `sources-${last.from}-to-${last.to}${last.byLanding ? "-by-page" : ""}.csv` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    $("sc-csv").addEventListener("click", () => {
      if (!lastSearch?.pages) return;
      const url = URL.createObjectURL(new Blob([searchCsv(lastSearch)], { type: "text/csv" }));
      const a = el("a", { href: url, download: `google-search-${lastSearch.from}-to-${lastSearch.to}.csv` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    $("src-link").addEventListener("submit", async e => {
      e.preventDefault();
      try {
        const res = await call(key, "POST", "", { action: "link", slug: $("src-slug").value.trim(),
          label: $("src-label").value.trim(), target: $("src-target").value.trim() || "/" });
        $("src-made").hidden = false;
        $("src-made").replaceChildren("Your link: ", el("code", { text: res.url }), " ",
          el("button", { type: "button", text: "Copy", onclick: () => copy(res.url) }));
        $("src-link").reset();
        say("");
        await render();
        copy(res.url);
      } catch (error) { say(error.message); }
    });
  }
  return render();
}
