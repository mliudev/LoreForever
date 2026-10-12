// The journey on a profile (/u/<handle>, lib/profiles.js, Mike 10/11): the two tabs, The journey and By the numbers,
// and the road chart beside the chapters (lib/chapters.js). Without this script both tabs are there, one after the
// other, and the chart's lands are plain links to their chapters.
//
// Tabs switch in place; a link to either (#journey, #numbers) opens it, and so does the address of anything inside
// one (#ch-<n>, a moment's #m-<n>, the old #map and #timeline). On a wide screen the chart stays beside the reading
// (.pf-atlas-stick is sticky, level with the middle of the window) and follows it: the chapter being read is the one
// in the middle of the window (the last one whose top has passed it), and its number, lands and fit go to public/js/roadchart.js as "pf-chapter" (n 0: none, the whole road).
// Links within the page (a land, a chapter's number, a moment) scroll there instead of jumping.
(() => {
  const nav = document.querySelector(".pf-tabs");
  const panels = { journey: document.getElementById("journey"), numbers: document.getElementById("numbers") };
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let current = "journey";

  function tab(name, focus = false) {
    if (!nav || !panels[name]) return;
    current = name;
    for (const [k, panel] of Object.entries(panels)) if (panel) panel.hidden = k !== name;
    for (const a of nav.querySelectorAll("a[data-tab]")) {
      const on = a.dataset.tab === name;
      a.setAttribute("aria-selected", String(on));
      a.tabIndex = on ? 0 : -1;
      if (on && focus) a.focus();
    }
    follow();
  }
  if (nav && panels.journey && panels.numbers) {
    nav.setAttribute("role", "tablist");
    for (const a of nav.querySelectorAll("a[data-tab]")) {
      a.setAttribute("role", "tab");
      a.setAttribute("aria-controls", a.dataset.tab);
      panels[a.dataset.tab].setAttribute("role", "tabpanel");
      panels[a.dataset.tab].setAttribute("aria-labelledby", a.id);
    }
    nav.hidden = false;
    nav.addEventListener("click", e => {
      const a = e.target.closest("a[data-tab]");
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      tab(a.dataset.tab);
      history.replaceState(null, "", "#" + a.dataset.tab);
    });
    nav.addEventListener("keydown", e => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      tab(current === "journey" ? "numbers" : "journey", true);
      history.replaceState(null, "", "#" + current);
    });
  }

  // Something on the page by its address: the tab it's in shown, the chapter or fold it's in opened, then scrolled to.
  // A moment of an older chapter, which lists no moments, opens that chapter instead.
  function reveal(id, { smooth = true, focus = true } = {}) {
    let el = /^[a-z][\w-]*$/i.test(id) ? document.getElementById(id) : null;
    const n = /^m-(\d+)$/.exec(id);
    if (!el && n) el = [...document.querySelectorAll(".pf-chx[data-from]")].find(c => +n[1] >= +c.dataset.from && +n[1] <= +c.dataset.to);
    if (id === "timeline") el = document.getElementById("chapters");
    if (!el) return false;
    const inPanel = Object.keys(panels).find(k => panels[k]?.contains(el));
    if (inPanel && inPanel !== current) tab(inPanel);
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
    if (!a || a.closest(".pf-tabs") || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.defaultPrevented) return;   // a drag on the chart (roadchart.js)
    const id = a.getAttribute("href").slice(1);
    if (!id || !reveal(id)) return;
    e.preventDefault();
    history.pushState(null, "", "#" + id);
  });
  const fromHash = first => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id === "numbers" || id === "journey") { tab(id); if (!first) panels[id]?.scrollIntoView({ block: "start" }); return; }
    if (id === "map") { tab("journey"); document.getElementById("map")?.scrollIntoView({ block: "start" }); return; }
    if (id) reveal(id, { smooth: !first });
  };
  addEventListener("hashchange", () => fromHash(false));

  // The chart follows the chapter being read, on a wide screen where it stays beside the reading.
  const stick = document.querySelector(".pf-atlas-stick");
  const chapters = [...document.querySelectorAll(".pf-ch[data-n]")];
  const story = document.querySelector(".pf-story");
  let shown = -1;
  function follow() {
    if (!stick || !chapters.length) return;
    const beside = current === "journey" && getComputedStyle(stick).position === "sticky";
    const line = innerHeight * 0.5;
    let n = 0;
    if (beside) {
      for (const c of chapters) if (c.getBoundingClientRect().top <= line) n = Number(c.dataset.n);
      const after = chapters.at(-1).getBoundingClientRect().bottom < line * 0.5;
      if (after || (story && story.getBoundingClientRect().bottom > line)) n = 0;
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
    requestAnimationFrame(() => { ticking = false; follow(); });
  }, { passive: true });
  addEventListener("resize", follow);
  // Half the chart's height, for the CSS that keeps it level with the middle of the window.
  const half = () => stick?.style.setProperty("--pf-half", Math.round(stick.offsetHeight / 2) + "px");
  if (stick && window.ResizeObserver) new ResizeObserver(half).observe(stick);
  half();

  tab("journey");
  fromHash(true);
  follow();
})();
