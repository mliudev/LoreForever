// The journey on a profile (/u/<handle>, lib/profiles.js): one long page of sheets (the Chronicle, the Road, the story,
// the numbers) under bookmarks, and the road chart beside the chapters (lib/chapters.js). Without this script the
// bookmarks are plain links to their sheets, and the chart's lands are plain links to their chapters.
//
// The bookmark of the sheet being read is marked (aria-current). A link to a sheet (#chronicle, #journey, #story,
// #numbers) scrolls to it, and so does the address of anything inside one (#ch-<n>, a moment's #m-<n>, the old #map
// and #timeline). On a wide screen the chart stays beside the reading (.pf-atlas-stick is sticky, level with the middle
// of the window) and follows it: the chapter being read is the one in the middle of the window (the last one whose top
// has passed it), and its number, lands and fit go to public/js/roadchart.js as "pf-chapter" (n 0: none, the whole road).
// Links within the page (a land, a chapter's number, a moment) scroll there instead of jumping.
(() => {
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const marks = [...document.querySelectorAll(".pf-marks a[href^='#']")];

  // Something on the page by its address: the chapter or fold it's in opened, then scrolled to. A moment of an older
  // chapter, which lists no moments, opens that chapter instead.
  function reveal(id, { smooth = true, focus = true } = {}) {
    let el = /^[a-z][\w-]*$/i.test(id) ? document.getElementById(id) : null;
    const n = /^m-(\d+)$/.exec(id);
    if (!el && n) el = [...document.querySelectorAll(".pf-chx[data-from]")].find(c => +n[1] >= +c.dataset.from && +n[1] <= +c.dataset.to);
    if (id === "timeline") el = document.getElementById("chapters");
    if (!el) return false;
    for (let d = el.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true;
    if (el.matches("details")) el.open = true;
    for (const x of document.querySelectorAll(".pf-hit")) x.classList.remove("pf-hit");
    if (n || el.matches(".pf-ch, .pf-chx")) el.classList.add("pf-hit");
    el.scrollIntoView({ block: n ? "center" : "start", behavior: smooth && !still.matches ? "smooth" : "auto" });
    if (focus && el.matches("[tabindex], details, a")) el.focus({ preventScroll: true });
    return true;
  }
  document.addEventListener("click", e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.defaultPrevented) return;   // a drag on the chart (roadchart.js)
    const id = a.getAttribute("href").slice(1);
    if (!id || !reveal(id, { focus: !a.closest(".pf-marks") })) return;
    e.preventDefault();
    history.pushState(null, "", "#" + id);
  });
  const fromHash = first => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) reveal(id, { smooth: !first });
  };
  addEventListener("hashchange", () => fromHash(false));

  // In the visitor view the bar stays at the top while they scroll (lib/profiles.js visitorBar): the bookmarks and the
  // chart sit under it, so the CSS gets its height.
  const bar = document.querySelector(".pf-visitor");
  if (bar) {
    const barHeight = () => document.documentElement.style.setProperty("--pf-bar", Math.ceil(bar.getBoundingClientRect().height) + "px");
    barHeight();
    addEventListener("resize", barHeight);
    if (window.ResizeObserver) new ResizeObserver(barHeight).observe(bar);
  }

  // The bookmark of the sheet in the upper part of the window.
  const sheets = marks.map(a => document.getElementById(a.getAttribute("href").slice(1)));
  function bookmark() {
    if (!marks.length) return;
    const line = innerHeight * 0.4;
    let at = 0;
    sheets.forEach((s, i) => { if (s && s.getBoundingClientRect().top <= line) at = i; });
    marks.forEach((a, i) => { if (i === at) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
  }

  // The chart follows the chapter being read, on a wide screen where it stays beside the reading.
  const stick = document.querySelector(".pf-atlas-stick");
  const chapters = [...document.querySelectorAll(".pf-ch[data-n]")];
  let shown = -1;
  function follow() {
    if (!stick || !chapters.length) return;
    const beside = getComputedStyle(stick).position === "sticky";
    const line = innerHeight * 0.5;
    let n = 0;
    if (beside) {
      for (const c of chapters) if (c.getBoundingClientRect().top <= line) n = Number(c.dataset.n);
      const after = chapters.at(-1).getBoundingClientRect().bottom < line * 0.5;
      if (after) n = 0;
    }
    if (n === shown) return;
    shown = n;
    const c = chapters.find(x => Number(x.dataset.n) === n);
    document.dispatchEvent(new CustomEvent("pf-chapter", { detail: {
      n, title: c?.querySelector("h3")?.textContent || "", when: c?.querySelector(".pf-eyebrow")?.textContent.replace(/^Chapter \d+\s*·\s*/, "") || "" } }));
  }
  let ticking = false;
  addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; follow(); bookmark(); });
  }, { passive: true });
  addEventListener("resize", () => { follow(); bookmark(); });
  // Half the chart's height, for the CSS that keeps it level with the middle of the window.
  const half = () => stick?.style.setProperty("--pf-half", Math.round(stick.offsetHeight / 2) + "px");
  if (stick && window.ResizeObserver) new ResizeObserver(half).observe(stick);
  half();

  fromHash(true);
  follow();
  bookmark();
})();
