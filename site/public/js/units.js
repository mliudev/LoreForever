// The journey in numbers on a profile (/u/<handle>, lib/profile-stats.js, LOR-246): miles or kilometres. The page
// says miles; the buttons switch every distance on it ([data-mi], [data-km]) and the pick is remembered in this browser.
// Without this script the buttons stay hidden and the page says miles.
(() => {
  const root = document.querySelector(".pf-nums");
  const bar = root && root.querySelector(".pf-units");
  if (!bar) return;
  const KEY = "lf-distance";
  const buttons = [...bar.querySelectorAll("button[data-units]")];

  function show(units) {
    for (const el of root.querySelectorAll(".pf-dist")) el.textContent = el.dataset[units] || el.textContent;
    for (const b of buttons) {
      const on = b.dataset.units === units;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.classList.toggle("btn-small-alt", !on);
    }
  }

  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  show(saved === "km" ? "km" : "mi");
  for (const b of buttons) {
    b.addEventListener("click", () => {
      show(b.dataset.units);
      try { localStorage.setItem(KEY, b.dataset.units); } catch (e) {}
    });
  }
  bar.hidden = false;
})();
