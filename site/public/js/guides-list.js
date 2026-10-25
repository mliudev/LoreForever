// /guides: the search box and the kind chips (lib/guides.js indexPage). Without this script the list shows whole, and the
// box and chips stay hidden.
(() => {
  const q = document.getElementById("gd-q");
  const items = [...document.querySelectorAll(".gd-list > li[data-find]")];
  if (!q || !items.length) return;
  const none = document.getElementById("gd-none");
  const chips = [...document.querySelectorAll(".gd-chips [data-kind]")];
  for (const el of document.querySelectorAll("[data-gd-js]")) el.hidden = false;
  let kind = "";
  const apply = () => {
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const li of items) {
      const ok = (!kind || li.dataset.kind === kind) && words.every(w => li.dataset.find.includes(w));
      li.hidden = !ok;
      if (ok) shown++;
    }
    if (none) none.hidden = shown > 0;
  };
  q.addEventListener("input", apply);
  for (const c of chips) {
    c.addEventListener("click", () => {
      kind = c.dataset.kind;
      for (const x of chips) x.setAttribute("aria-pressed", String(x === c));
      apply();
    });
  }
})();
