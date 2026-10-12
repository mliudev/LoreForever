// /downloads, the extra packs (LOR-437, lib/packs.js). Each ▶ chip is a link to its recording, so it works without
// JavaScript; here it plays in the page instead and shows its line while it plays. Nothing loads until a click. One
// plays at a time, and the voice samples in the table stop it (and it stops them). "Your language" becomes a picker:
// your browser's language opens by itself, otherwise you pick. A link to a pack (#pack-voice-female-alliance, from
// the lore pages) or a fold (#all-files) opens whatever it's folded in.
(() => {
  let audio = null, current = null;
  const show = (button, playing) => {
    const icon = button.querySelector(".pk-pl");
    if (icon) icon.innerHTML = playing ? "&#10074;&#10074;" : "&#9654;";
    button.setAttribute("aria-pressed", String(playing));
    button.classList.toggle("pk-on", playing);
    const cap = button.dataset.cap && document.getElementById(button.dataset.cap);
    if (cap) cap.hidden = !playing;
  };
  const stop = () => { if (audio && !audio.paused) audio.pause(); };
  document.querySelectorAll("a.pk-play").forEach(button => {
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", e => {
      e.preventDefault();
      if (current === button && audio && !audio.paused) { audio.pause(); return; }
      if (current && current !== button) show(current, false);
      if (!audio) {
        audio = new Audio();
        audio.preload = "none";
        audio.addEventListener("play", () => {
          document.querySelectorAll("audio").forEach(a => { if (!a.paused) a.pause(); });
          if (current) show(current, true);
        });
        audio.addEventListener("pause", () => { if (current) show(current, false); });
        audio.addEventListener("ended", () => { if (current) show(current, false); });
        audio.addEventListener("error", () => { if (current) { show(current, false); current.title = "Couldn't play this one"; } });
      }
      if (current !== button) { audio.src = button.getAttribute("href"); current = button; }
      audio.play().catch(() => { show(button, false); });
    });
  });
  // The page's other players (the voice samples) are <audio> elements: one starting stops ours.
  document.addEventListener("play", e => { if (e.target !== audio) stop(); }, true);

  // "Your language": a button per language shows its panel; pressing it again closes it.
  const picker = document.querySelector(".pk-langs");
  const panels = [...document.querySelectorAll(".pk-lang")];
  let pick = () => {};
  if (picker && panels.length) {
    const buttons = [...picker.querySelectorAll("button[data-lang]")];
    const hint = document.querySelector(".pk-lang-hint");
    pick = loc => {
      buttons.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === loc)));
      panels.forEach(p => {
        const open = p.dataset.lang === loc;
        if (!open && current && p.contains(current)) stop();
        p.hidden = !open;
      });
      if (hint) hint.hidden = Boolean(loc);
    };
    buttons.forEach(b => b.addEventListener("click", () => pick(b.getAttribute("aria-pressed") === "true" ? "" : b.dataset.lang)));
    picker.closest(".pk-tile")?.classList.add("pk-picking");
    picker.hidden = false;
    const mine = (navigator.languages || [navigator.language || ""]).map(l => String(l).slice(0, 2).toLowerCase());
    const auto = mine[0] && mine[0] !== "en" ? buttons.find(b => b.dataset.lang.slice(0, 2).toLowerCase() === mine[0]) : null;
    pick(auto ? auto.dataset.lang : "");
  }

  const reveal = () => {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const target = id && document.getElementById(id);
    if (!target || target.closest(".dl-voice")) return;   // voices-page.js opens the table's rows
    const panel = target.closest(".pk-lang");
    if (panel && panel.hidden) pick(panel.dataset.lang);
    let opened = false;
    if (target.tagName === "DETAILS" && !target.open) { target.open = true; opened = true; }
    for (let el = target.parentElement; el; el = el.parentElement) if (el.tagName === "DETAILS" && !el.open) { el.open = true; opened = true; }
    if (opened || panel || /^packs?-/.test(id)) target.scrollIntoView({ block: "start" });
  };
  reveal();
  window.addEventListener("hashchange", reveal);
})();
