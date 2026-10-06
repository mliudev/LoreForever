// The road chart on a profile (/u/<handle>, lib/roadchart.js, LOR-248): zoom (wheel, pinch, + and -, or the keys + -
// and 0 while it has focus), drag or the arrow keys to look around, the circular arrows to show the whole road again.
// Stops and names keep their size at every zoom (--z). A stop shows that land's moments in the journey below
// (public/js/journey.js listens for "pf-land" and opens the Timeline view); without this script it's a plain link to the
// first moment there.
(() => {
  const fig = document.getElementById("road-chart");
  if (!fig) return;
  const svg = fig.querySelector("svg");
  const W = 1000, H = 640, MIN = 110;   // the chart's units, and the narrowest view (about 9 times in)
  const fit = svg.dataset.fit.split(" ").map(Number);
  let [x, y, w] = fit;
  const still = matchMedia("(prefers-reduced-motion: reduce)");

  function show(nx, ny, nw) {
    w = Math.min(W, Math.max(MIN, nw));
    const h = w * H / W;
    x = Math.min(Math.max(nx, 0), W - w);
    y = Math.min(Math.max(ny, 0), H - h);
    svg.setAttribute("viewBox", `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
    const px = svg.getBoundingClientRect().width;   // (an <svg>'s clientWidth can be 0)
    if (px > 0) {
      svg.style.setProperty("--z", String(w / px));
      labels(w / px);
    }
  }
  // Names keep one size on screen, so on a narrow chart one can run off its side: each goes on the side it was drawn
  // on (right for a zone, left for a capital or dungeon) when it fits there, else the other.
  const stops = [...svg.querySelectorAll("a.pf-ch-stop")].map(a => {
    const text = a.querySelector("text");
    return { text, sx: Number(a.dataset.x), left: text?.getAttribute("text-anchor") === "end" };
  });
  function labels(z) {
    for (const s of stops) {
      if (!s.text || !Number.isFinite(s.sx)) continue;
      const len = (10 + s.text.getComputedTextLength()) * z;
      const fitsLeft = s.sx - len >= x, fitsRight = s.sx + len <= x + w;
      const left = s.left ? fitsLeft || !fitsRight : !fitsRight && fitsLeft;
      s.text.setAttribute("x", left ? "-10" : "10");
      if (left) s.text.setAttribute("text-anchor", "end"); else s.text.removeAttribute("text-anchor");
    }
  }
  // A point on screen in chart units.
  const at = (cx, cy) => {
    const r = svg.getBoundingClientRect();
    return [x + (cx - r.left) / r.width * w, y + (cy - r.top) / r.height * (w * H / W)];
  };
  const zoom = (factor, px, py) => {
    const [ux, uy] = px === undefined ? [x + w / 2, y + w * H / W / 2] : at(px, py);
    const nw = Math.min(W, Math.max(MIN, w / factor)), k = nw / w;
    show(ux - (ux - x) * k, uy - (uy - y) * k, nw);
  };
  const reset = () => show(fit[0], fit[1], fit[2]);

  fig.querySelector(".pf-chart-tools").hidden = false;
  fig.querySelector(".pf-chart-how").hidden = false;
  fig.querySelector(".pf-chart-tools").addEventListener("click", e => {
    const b = e.target.closest("button[data-zoom]");
    if (!b) return;
    if (b.dataset.zoom === "fit") reset(); else zoom(b.dataset.zoom === "in" ? 1.5 : 1 / 1.5);
  });
  svg.addEventListener("wheel", e => {
    e.preventDefault();
    zoom(Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) / 200), e.clientX, e.clientY);
  }, { passive: false });
  svg.addEventListener("keydown", e => {
    const step = w * 0.12;
    const keys = { ArrowLeft: () => show(x - step, y, w), ArrowRight: () => show(x + step, y, w),
      ArrowUp: () => show(x, y - step * H / W, w), ArrowDown: () => show(x, y + step * H / W, w),
      "+": () => zoom(1.5), "=": () => zoom(1.5), "-": () => zoom(1 / 1.5), "0": reset };
    if (e.target !== svg || !keys[e.key] || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    keys[e.key]();
  });

  // Drag to look around; two fingers pinch. A drag doesn't count as a click on a stop.
  const pointers = new Map();
  let moved = false, pinch = null;
  svg.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    moved = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), w };
    }
  });
  svg.addEventListener("pointermove", e => {
    const was = pointers.get(e.pointerId);
    if (!was) return;
    const now = [e.clientX, e.clientY];
    pointers.set(e.pointerId, now);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (d > 0) zoom(w / (pinch.w * pinch.d / d), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      moved = true;
      return;
    }
    const dx = now[0] - was[0], dy = now[1] - was[1];
    if (!moved && Math.hypot(dx, dy) < 4) { pointers.set(e.pointerId, was); return; }
    if (!moved) svg.setPointerCapture?.(e.pointerId);
    moved = true;
    const r = svg.getBoundingClientRect();
    show(x - dx / r.width * w, y - dy / r.height * (w * H / W), w);
  });
  const up = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointercancel", up);

  // A stop: that land's moments, in the journey below.
  svg.addEventListener("click", e => {
    const stop = e.target.closest("a.pf-ch-stop");
    if (!stop) return;
    if (moved) { e.preventDefault(); moved = false; return; }
    const journey = document.getElementById("timeline");
    if (!journey) return;
    e.preventDefault();
    document.dispatchEvent(new CustomEvent("pf-land", { detail: { land: stop.dataset.land, name: stop.dataset.name } }));
    journey.scrollIntoView({ block: "start", behavior: still.matches ? "auto" : "smooth" });
  });

  // Markers follow the chart's real width: as the page lays out (the first look can come before the styles), and on
  // every resize.
  if (window.ResizeObserver) new ResizeObserver(() => show(x, y, w)).observe(svg);
  else addEventListener("resize", () => show(x, y, w));
  show(x, y, w);
})();
