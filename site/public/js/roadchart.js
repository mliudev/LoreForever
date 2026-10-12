// The road chart on a profile (/u/<handle>, lib/roadchart.js, LOR-248): zoom (wheel, pinch, + and -, or the keys + -
// and 0 while it has focus), drag or the arrow keys to look around, the circular arrows to show the whole road again.
// Stops and names keep their size at every zoom (--z). Beside the chapters (Mike 10/11) it follows the reading:
// public/js/journey.js sends "pf-chapter" with the chapter being read, and its roads and lands light up and the chart
// moves to them. A land or a chapter's number is a link to its chapter on the page (journey.js scrolls there).
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
    cancelAnimationFrame(frame);
    const [ux, uy] = px === undefined ? [x + w / 2, y + w * H / W / 2] : at(px, py);
    const nw = Math.min(W, Math.max(MIN, w / factor)), k = nw / w;
    show(ux - (ux - x) * k, uy - (uy - y) * k, nw);
  };
  let frame = 0;
  const reset = () => { cancelAnimationFrame(frame); show(fit[0], fit[1], fit[2]); };
  // Move the view to another, easing there unless motion is reduced; any touch of the chart takes over.
  function glide(nx, ny, nw) {
    cancelAnimationFrame(frame);
    if (still.matches) return show(nx, ny, nw);
    const from = [x, y, w], t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / 450), e = 1 - (1 - k) ** 3;
      show(from[0] + (nx - from[0]) * e, from[1] + (ny - from[1]) * e, from[2] + (nw - from[2]) * e);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  fig.querySelector(".pf-chart-tools").hidden = false;
  fig.querySelector(".pf-chart-tools").addEventListener("click", e => {
    const b = e.target.closest("button[data-zoom]");
    if (!b) return;
    if (b.dataset.zoom === "fit") reset(); else zoom(b.dataset.zoom === "in" ? 1.5 : 1 / 1.5);
  });
  // The chart sits beside the reading, so the wheel keeps scrolling the page; Ctrl and the wheel zoom (and so does a
  // trackpad pinch, which the browser sends as that).
  svg.addEventListener("wheel", e => {
    if (!e.ctrlKey && !e.metaKey) return;
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
    cancelAnimationFrame(frame);
    keys[e.key]();
  });

  // Drag to look around; two fingers pinch. A drag doesn't count as a click on a stop.
  const pointers = new Map();
  let moved = false, pinch = null;
  svg.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    cancelAnimationFrame(frame);
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

  // The chapter being read (journey.js sends "pf-chapter"): its roads and lands lit, the rest stepping back, and the
  // chart moving to them; n 0 is none, the whole road again. The caption over the chart says which chapter it shows.
  const cap = document.querySelector(".pf-atlas-cap"), title = cap?.querySelector(".pf-atlas-title"), sub = cap?.querySelector(".pf-atlas-sub");
  const overview = [title?.textContent, sub?.textContent];
  document.addEventListener("pf-chapter", e => {
    const { n = 0, title: name = "", when = "" } = e.detail || {};
    const mine = el => n > 0 && (el.dataset.ch || "").includes(` ${n} `);
    const lit = [...svg.querySelectorAll("[data-ch]")].filter(mine);
    for (const el of svg.querySelectorAll("[data-ch]")) el.classList.toggle("pf-ch-on", lit.includes(el));
    fig.classList.toggle("pf-following", lit.length > 0);
    if (title && sub) [title.textContent, sub.textContent] = lit.length ? [`Chapter ${n}: ${name}`, when] : overview;
    // Its lands, and the ends of its roads (so a chapter in one land still shows where its road came from).
    const points = lit.flatMap(el => el.matches("a.pf-ch-stop") ? [[Number(el.dataset.x), Number(el.dataset.y)]]
      : [...(el.getAttribute("d") || "").matchAll(/[MQ ]?([\d.]+) ([\d.]+)/g)].filter((_, i) => i !== 1).map(m => [Number(m[1]), Number(m[2])]));
    if (!points.length) { glide(fit[0], fit[1], fit[2]); return; }
    // Around its lands, with room for their names, and never closer in than a land and its neighbours.
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const nw = Math.min(W, Math.max(320, Math.max(...xs) - Math.min(...xs) + 260, (Math.max(...ys) - Math.min(...ys) + 120) * W / H));
    glide(cx - nw / 2, cy - nw * H / W / 2, nw);
  });

  // A land or a chapter's number: a link to its chapter on this page (journey.js scrolls there). A drag isn't a click.
  svg.addEventListener("click", e => {
    if (e.target.closest("a") && moved) { e.preventDefault(); moved = false; }
  });

  // A chapter's own small chart (lib/roadchart.js chapterMap): its markers keep their size too.
  const minis = [...document.querySelectorAll("svg.pf-mini")];
  const sizeMinis = () => {
    for (const m of minis) {
      const px = m.getBoundingClientRect().width;
      if (px > 0) m.style.setProperty("--z", String(m.viewBox.baseVal.width / px));
    }
  };
  if (window.ResizeObserver) { const ro = new ResizeObserver(sizeMinis); minis.forEach(m => ro.observe(m)); }
  else addEventListener("resize", sizeMinis);

  // Markers follow the chart's real width: as the page lays out (the first look can come before the styles), and on
  // every resize.
  if (window.ResizeObserver) new ResizeObserver(() => show(x, y, w)).observe(svg);
  else addEventListener("resize", () => show(x, y, w));
  show(x, y, w);
})();
