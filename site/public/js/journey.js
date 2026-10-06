// The journey on a profile (/u/<handle>, lib/trails.js journeySection, LOR-248): the filter chips, a land picked on the
// road chart (public/js/roadchart.js sends "pf-land"), and the trail links (#m-<n>). Following one shows the moment
// wherever it is (unfolds the earlier moments, clears a filter that hides it), marks it and moves focus there; Back
// returns along the trail. Without this script the moments are all there, the chips stay hidden and the links are
// plain in-page links.
//
// The two views (lib/profiles.js): Map (#map, the road chart) and Timeline (#timeline, the moments), one at a time,
// Map first when there is one. A link to either opens it (#journey, the old address, is the timeline), and so does a
// link to a moment (#m-<n>).
(() => {
  const root = document.getElementById("timeline");
  if (!root) return;
  const rows = [...root.querySelectorAll(".pf-m")];
  const older = root.querySelector(".pf-older");
  const chips = root.querySelector(".pf-filter");
  const shown = root.querySelector(".pf-shown");
  const still = matchMedia("(prefers-reduced-motion: reduce)");

  const map = document.getElementById("map");
  const nav = document.querySelector(".pf-views");
  function view(name) {
    if (!map || !nav) return;
    map.hidden = name !== "map";
    root.hidden = name !== "timeline";
    for (const a of nav.querySelectorAll("a[data-view]")) {
      if (a.dataset.view === name) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    }
  }
  if (map && nav) {
    nav.hidden = false;
    nav.addEventListener("click", e => {
      const a = e.target.closest("a[data-view]");
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      view(a.dataset.view);
      history.replaceState(null, "", "#" + a.dataset.view);
    });
  }

  // Only one kind of moment (group, a chip), or only one land (land, from the chart; name says which), or everything.
  function filter(group, land = "", name = "") {
    let n = 0;
    for (const r of rows) {
      r.hidden = (Boolean(group) && r.dataset.g !== group) || (Boolean(land) && r.dataset.land !== land);
      if (!r.hidden) n++;
    }
    for (const day of root.querySelectorAll(".pf-day")) day.hidden = !day.querySelector(".pf-m:not([hidden])");
    const any = Boolean(group || land);
    if (older) {
      older.hidden = any && !older.querySelector(".pf-m:not([hidden])");
      if (any) older.open = true;
    }
    for (const b of chips?.querySelectorAll("button[data-f]") || []) {
      b.setAttribute("aria-pressed", String(!land && b.dataset.f === group));
    }
    if (shown) {
      shown.textContent = land ? `Showing ${n} moment${n === 1 ? "" : "s"} in ${name}. Pick All to see every moment.`
        : group ? `Showing ${n} of ${rows.length} moments.` : "";
    }
  }

  if (chips) {
    chips.hidden = false;
    chips.addEventListener("click", e => {
      const b = e.target.closest("button[data-f]");
      if (b) filter(b.dataset.f);
    });
  }
  document.addEventListener("pf-land", e => {
    view("timeline");
    history.replaceState(null, "", "#timeline");
    filter("", String(e.detail?.land || ""), String(e.detail?.name || ""));
    (chips?.querySelector('button[data-f=""]') || root).focus?.({ preventScroll: true });
  });

  function reveal(id, focus) {
    const m = /^m-\d+$/.test(id) ? document.getElementById(id) : null;
    if (!m || !root.contains(m)) return false;
    view("timeline");
    if (m.hidden) filter("");
    const fold = m.closest("details");
    if (fold) fold.open = true;
    for (const x of root.querySelectorAll(".pf-hit")) x.classList.remove("pf-hit");
    m.classList.add("pf-hit");
    m.scrollIntoView({ block: "center", behavior: still.matches ? "auto" : "smooth" });
    if (focus) m.focus({ preventScroll: true });
    return true;
  }

  root.addEventListener("click", e => {
    const a = e.target.closest("a.pf-go");
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const id = a.hash.slice(1);
    if (reveal(id, true)) {
      e.preventDefault();
      history.pushState(null, "", "#" + id);
    }
  });
  // Back and Forward along the trail, a link to a moment from elsewhere, and a link to a view.
  const fromHash = first => {
    const id = location.hash.slice(1);
    if (id === "map" || id === "timeline" || id === "journey") {
      view(id === "map" ? "map" : "timeline");
      (id === "map" ? map : root)?.scrollIntoView({ block: "start" });
    } else if (!reveal(id, true) && first) view(map ? "map" : "timeline");
  };
  addEventListener("hashchange", () => fromHash(false));
  fromHash(true);
})();
