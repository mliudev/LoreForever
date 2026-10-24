// Willo's download count under her Download button (Mike, 10/23: "number of downloads under the button"), on her
// home and /willo: fills each [data-willo-downloads] from /api/downloads once the count is above 0, and leaves it
// hidden otherwise. index.html's #willo-downloads does the same with a GitHub fallback of its own.
(async () => {
  const spots = document.querySelectorAll("[data-willo-downloads]");
  if (!spots.length) return;
  const counts = await fetch("/api/downloads").then(r => r.ok ? r.json() : null).catch(() => null);
  const n = Math.round(counts?.willo || 0);
  if (n < 1) return;
  for (const el of spots) {
    const b = document.createElement("strong");
    b.textContent = n.toLocaleString("en-US");
    el.replaceChildren(b, n === 1 ? " download" : " downloads");
    el.hidden = false;
  }
})();
