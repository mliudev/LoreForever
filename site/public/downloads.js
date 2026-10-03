// /downloads: the ▶ sample buttons, file sizes, and the CurseForge click count. Without JavaScript the page still
// lists every file with a working Download button; it just shows no sizes and no samples.
(() => {
  // ▶ plays a voice's sample in place (❚❚ while it plays); one sample at a time.
  document.querySelectorAll(".dl-voice").forEach(card => {
    const button = card.querySelector(".dl-play");
    const audio = card.querySelector(".dl-audio");
    if (!button || !audio) return;
    const label = button.getAttribute("aria-label");
    const show = playing => {
      button.innerHTML = playing ? "&#10074;&#10074;" : "&#9654;";
      button.setAttribute("aria-pressed", String(playing));
      button.setAttribute("aria-label", playing ? "Pause" : label);
      card.classList.toggle("dl-on", playing);
    };
    button.addEventListener("click", () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
    audio.addEventListener("play", () => show(true));
    audio.addEventListener("pause", () => show(false));
    audio.addEventListener("ended", () => show(false));
  });
  document.addEventListener("play", e => {
    document.querySelectorAll("audio").forEach(a => { if (a !== e.target) a.pause(); });
  }, true);

  // Sizes: each .dl-size[data-asset] is "<tag>:<file>" ("latest" for the latest release) of the public repo's
  // releases. Two calls to GitHub's API (no key), and anything it can't find simply shows no size.
  const sizes = [...document.querySelectorAll(".dl-size[data-asset]")];
  const fmt = b => b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? Math.round(b / 1e6) + " MB"
    : Math.max(1, Math.round(b / 1e3)) + " KB";
  const API = "https://api.github.com/repos/mliudev/LoreForever/releases";
  const get = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
  if (sizes.length) {
    Promise.all([get(API + "/latest"), get(API + "?per_page=30")]).then(([latest, all]) => {
      const byTag = {};
      const add = (tag, rel) => {
        if (!rel || byTag[tag]) return;
        byTag[tag] = Object.fromEntries((rel.assets || []).map(a => [a.name, a.size]));
      };
      add("latest", latest);
      (all || []).forEach(rel => add(rel.tag_name, rel));
      sizes.forEach(el => {
        const [tag, ...rest] = el.dataset.asset.split(":");
        const size = byTag[tag]?.[rest.join(":")];
        if (size > 0) el.textContent = fmt(size);   // style.css hides the "·" before a size that stays empty
      });
    });
  }

  // #install folds away; a link to it opens it.
  const howto = document.getElementById("install");
  const openHowto = () => { if (howto && location.hash === "#install") howto.open = true; };
  openHowto();
  window.addEventListener("hashchange", openHowto);

  // Count clicks on the add-on's download links, CurseForge included (functions/api/click.js), as on the home page.
  document.querySelectorAll(".dl-link").forEach(link => link.addEventListener("click", () => {
    try { navigator.sendBeacon("/api/click"); } catch (e) {}
  }));
})();
