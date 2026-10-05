// The journey on a profile (/u/<handle>, lib/trails.js journeySection, LOR-248): the filter chips, and the trail
// links (#m-<n>). Following one shows the moment wherever it is (unfolds the earlier moments, clears a filter that
// hides it), marks it and moves focus there; Back returns along the trail. Without this script the moments are all
// there, the chips stay hidden and the links are plain in-page links.
(() => {
  const root = document.getElementById("journey");
  if (!root) return;
  const rows = [...root.querySelectorAll(".pf-m")];
  const older = root.querySelector(".pf-older");
  const chips = root.querySelector(".pf-filter");
  const shown = root.querySelector(".pf-shown");
  const still = matchMedia("(prefers-reduced-motion: reduce)");

  function filter(group) {
    let n = 0;
    for (const r of rows) {
      r.hidden = Boolean(group) && r.dataset.g !== group;
      if (!r.hidden) n++;
    }
    for (const day of root.querySelectorAll(".pf-day")) day.hidden = !day.querySelector(".pf-m:not([hidden])");
    if (older) {
      older.hidden = Boolean(group) && !older.querySelector(".pf-m:not([hidden])");
      if (group) older.open = true;
    }
    for (const b of chips.querySelectorAll("button[data-f]")) b.setAttribute("aria-pressed", String(b.dataset.f === group));
    if (shown) shown.textContent = group ? `Showing ${n} of ${rows.length} moments.` : "";
  }

  if (chips) {
    chips.hidden = false;
    chips.addEventListener("click", e => {
      const b = e.target.closest("button[data-f]");
      if (b) filter(b.dataset.f);
    });
  }

  function reveal(id, focus) {
    const m = /^m-\d+$/.test(id) ? document.getElementById(id) : null;
    if (!m || !root.contains(m)) return false;
    if (m.hidden && chips) filter("");
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
  // Back and Forward along the trail, and a link to a moment from elsewhere.
  const fromHash = () => reveal(location.hash.slice(1), true);
  addEventListener("hashchange", fromHash);
  if (location.hash) fromHash();
})();
