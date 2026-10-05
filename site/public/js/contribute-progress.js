// /contribute/progress (LOR-238, page in lib/progress.js): fills the "Sent in by players" counters from
// GET /api/contribute/stats ({lines, verified, accepted, shipped, contributors, last_upload, by_kind}; lib/contribute.js
// stats) and refreshes them every five minutes while the tab is visible (the API is cached that long). "Accepted" is
// the one that grows with solo finders (one sender, 48 hours); "verified" (two senders) would look thin. If the API
// isn't there or answers something else (a deployment without it serves the home page), the counters stay hidden;
// the rest of the page doesn't need them.
(() => {
  const box = document.getElementById("pg-live");
  if (!box) return;
  const fmt = n => String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // last_upload as a time: unix seconds or milliseconds, or an ISO date. null if there's none.
  function time(x) {
    if (x === null || x === undefined || x === "" || x === 0) return null;
    const n = Number(x);
    const t = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(x));
    return isNaN(t) ? null : t;
  }
  function ago(t) {
    const s = Math.max(0, (Date.now() - t.getTime()) / 1000);
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 36 * 3600) return Math.round(s / 3600) + " h ago";
    const d = Math.round(s / 86400);
    return d + (d === 1 ? " day ago" : " days ago");
  }

  async function load() {
    let s;
    try {
      const res = await fetch("/api/contribute/stats", { headers: { Accept: "application/json" } });
      if (!res.ok) return;
      s = await res.json();
    } catch (e) {
      return;
    }
    if (!s || typeof s !== "object" || !Number.isFinite(Number(s.lines))) return;
    for (const el of box.querySelectorAll("[data-stat]")) {
      const key = el.dataset.stat;
      if (key === "last_upload") {
        const t = time(s.last_upload);
        el.textContent = t ? ago(t) : "none yet";
        if (t) el.title = t.toLocaleString();
      } else {
        el.textContent = fmt(key === "accepted" ? s.accepted ?? s.verified : s[key]);
      }
    }
    box.hidden = false;
  }

  load();
  setInterval(() => { if (!document.hidden) load(); }, 5 * 60e3);
})();
