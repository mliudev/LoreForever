// /downloads, "Pick a bundle" (LOR-848): draws the visitor's own pick over the page's English, Windows default. The
// language comes from the browser (English when we don't offer it), the computer from the OS, the narrator is the
// language's first until the visitor picks another; a pick they make is remembered on this browser. Change opens
// the chooser (language chips, narrator cards with ▶, the computer). "Every file" shows the picked language first. A
// link to a pack's row (#pack-voice-female-alliance, from the lore pages) opens it. The page works without this.
import { barHtml, chooserHtml, cardsHtml, current } from "./bundles.js?v=20261026a";

const KEY = "lf-download-pick";
const page = document.querySelector(".bx-page");
const data = document.getElementById("bx-catalog");
const bar = document.querySelector(".bx-bar"), choose = document.getElementById("bx-choose"), cards = document.querySelector(".bx-cards");
let cat = null;
try { cat = JSON.parse(data?.textContent || "null"); } catch {}

if (cat?.langs?.length && page && bar && choose && cards) {
  const ua = navigator.userAgent || "", platform = navigator.userAgentData?.platform || navigator.platform || "";
  // CurseForge's app runs on Windows and Mac; Setup only on Windows. Phones get the Windows page (they install on a PC).
  const os = /Windows|Win32|Win64/i.test(platform + ua) ? "win" : /Mac|iPhone|iPad|iPod|Linux|X11|CrOS/i.test(platform) && !/Android/i.test(ua) ? "mac" : "win";
  const browser = (navigator.languages?.length ? navigator.languages : [navigator.language || "en"]).map(l => String(l).slice(0, 2).toLowerCase());
  const offered = browser.find(code => cat.langs.some(l => l.code === code));
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
  const asked = new URLSearchParams(location.search);
  let pick = { lang: offered || "en", narrator: "", os, auto: true, fallback: !offered };
  if (saved && cat.langs.some(l => l.code === saved.lang)) pick = { lang: saved.lang, narrator: saved.narrator || "", os: saved.os || os, auto: false };
  if (cat.langs.some(l => l.code === asked.get("lang"))) pick = { ...pick, lang: asked.get("lang"), narrator: asked.get("narrator") || "", auto: false };
  let open = false, playing = "", audio = null;

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ lang: pick.lang, narrator: pick.narrator, os: pick.os })); } catch {} };
  const stop = () => { if (audio && !audio.paused) audio.pause(); playing = ""; };
  // "Every file": the picked language's files, the rest behind one button.
  const sections = [...document.querySelectorAll(".ef-lang")];
  let allFiles = false;
  const more = document.createElement("p");
  more.innerHTML = '<button type="button" class="ch-btn ch-ghost ch-small bx-allfiles">Show every language</button>';
  sections.at(-1)?.after(more);
  more.querySelector("button").addEventListener("click", () => { allFiles = true; draw(); });

  function draw(focus = "") {
    const { lang, narrator } = current(cat, pick);
    pick.lang = lang.code; pick.narrator = narrator.id;
    bar.innerHTML = barHtml(cat, pick, open);
    choose.hidden = !open;
    choose.innerHTML = open ? chooserHtml(cat, pick, playing) : "";
    cards.innerHTML = cardsHtml(cat, pick);
    sections.forEach(s => { s.hidden = !allFiles && s.dataset.lang !== lang.code; });
    more.hidden = allFiles || sections.length < 2;
    if (focus) (document.querySelector(focus) || bar.querySelector(".bx-change"))?.focus({ preventScroll: true });
  }
  bar.addEventListener("click", e => {
    if (!e.target.closest(".bx-change")) return;
    open = !open;
    if (!open) stop();
    draw(".bx-change");
  });
  choose.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.lang) { pick = { ...pick, lang: b.dataset.lang, narrator: "", auto: false }; stop(); save(); draw(`[data-lang="${b.dataset.lang}"]`); }
    else if (b.dataset.narrator) { pick = { ...pick, narrator: b.dataset.narrator, auto: false }; save(); draw(`[data-narrator="${b.dataset.narrator}"]`); }
    else if (b.dataset.os) { pick = { ...pick, os: b.dataset.os, auto: false }; save(); draw(`[data-os="${b.dataset.os}"]`); }
    else if (b.dataset.play) {
      const n = current(cat, pick).lang.narrators.find(x => x.id === b.dataset.play);
      if (playing === n?.id) { stop(); draw(`[data-play="${b.dataset.play}"]`); return; }
      if (!n?.sample) return;
      audio = audio || Object.assign(new Audio(), { preload: "none" });
      audio.onended = audio.onerror = () => { playing = ""; draw(); };
      audio.src = n.sample.src;
      playing = n.id;
      audio.play().catch(() => { playing = ""; draw(); });
      draw(`[data-play="${b.dataset.play}"]`);
    } else if (b.classList.contains("bx-done")) { open = false; stop(); draw(".bx-change"); }
  });

  // A link to a pack's row (or a fold) opens it, showing its language's files.
  const reveal = () => {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const target = id && document.getElementById(id);
    if (!target) return;
    const section = target.closest(".ef-lang");
    if (section && section.hidden) { allFiles = true; draw(); }
    let opened = false;
    for (let el = target; el; el = el.parentElement) if (el.tagName === "DETAILS" && !el.open) { el.open = true; opened = true; }
    if (opened || section) target.scrollIntoView({ block: "start" });
  };
  page.classList.add("bx-ready");
  draw();
  reveal();
  window.addEventListener("hashchange", reveal);
}

document.addEventListener("click", e => {
  if (e.target.closest?.(".bx-page a[href^='/download/']")) try { navigator.sendBeacon("/api/click"); } catch {}
});
