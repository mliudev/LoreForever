// Downloads work without JavaScript. Enhance samples, exact file sizes and catalog-based filters.
(() => {
  const stopSamples = new Map();
  document.querySelectorAll(".dl-voice").forEach(card => {
    const button = card.querySelector(".dl-play");
    const audio = card.querySelector(".dl-audio");
    if (!button || !audio) return;
    const label = button.getAttribute("aria-label");
    const show = playing => {
      button.innerHTML = playing ? "&#10074;&#10074;" : "&#9654;";
      button.setAttribute("aria-pressed", String(playing));
      button.setAttribute("aria-label", playing ? "Pause sample" : label);
      card.classList.toggle("dl-on", playing);
    };
    stopSamples.set(card, () => { if (!audio.paused) audio.pause(); show(false); });
    button.addEventListener("click", () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
    audio.addEventListener("play", () => show(true));
    audio.addEventListener("pause", () => show(false));
    audio.addEventListener("ended", () => show(false));
  });
  document.addEventListener("play", e => {
    document.querySelectorAll("audio").forEach(a => { if (a !== e.target) a.pause(); });
  }, true);

  const sizes = [...document.querySelectorAll(".dl-size[data-asset]"), ...document.querySelectorAll(".dl-size[data-assets]")];
  const preferred = [...document.querySelectorAll("[data-preferred]")];
  const versions = [...document.querySelectorAll("[data-latest-version]")];
  const fmt = bytes => {
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "";
    return bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + " GB" : bytes >= 1e6 ? Math.round(bytes / 1e6) + " MB"
      : Math.max(1, Math.round(bytes / 1e3)) + " KB";
  };
  if (sizes.length || versions.length || preferred.length) {
    sizes.forEach(el => { el.textContent = "Loading size…"; });
    versions.forEach(el => { el.textContent = "Loading version…"; });
    fetch("/api/download-files").then(r => r.ok ? r.json() : null).catch(() => null).then(data => {
      sizes.forEach(el => {
        let refs;
        try { refs = el.dataset.assets ? JSON.parse(el.dataset.assets) : [el.dataset.asset]; } catch { refs = []; }
        const values = Array.isArray(refs) ? refs.map(ref => {
          if (typeof ref !== "string") return null;
          const separator = ref.indexOf(":"), tag = ref.slice(0, separator), name = ref.slice(separator + 1);
          const assets = data?.byTag?.[tag];
          return separator > 0 && assets && Object.hasOwn(assets, name) && fmt(assets[name]) ? assets[name] : null;
        }) : [];
        const bytes = values.length && values.every(value => value !== null) ? values.reduce((n, value) => n + value, 0) : null;
        el.textContent = fmt(bytes) || "Size unavailable";
      });
      preferred.forEach(details => {
        const match = /^(v\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?):(LoreForever_Voice_(?:Default|Female)_[a-z]{2}[A-Z]{2}-complete\.zip)$/.exec(details.dataset.preferred);
        if (!match) return;
        const [, tag, name] = match, assets = data?.byTag?.[tag];
        const bytes = assets && Object.hasOwn(assets, name) ? assets[name] : null;
        if (!fmt(bytes)) return;
        const row = details.closest(".dl-voice"), block = details.querySelector(".dl-preferred"), link = details.querySelector("[data-preferred-link]");
        if (!row || !block || !link) return;
        link.setAttribute("href", `https://github.com/mliudev/LoreForever/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`);
        link.addEventListener("click", () => { try { navigator.sendBeacon("/api/click"); } catch {} });
        block.hidden = false;
        const size = row.querySelector(".dl-total-size"), kind = row.querySelector(".dl-size-kind");
        if (size) size.textContent = fmt(bytes);
        if (kind) kind.textContent = "One ZIP";
        const heading = details.querySelector(".dl-fallback-title"), note = details.querySelector(".dl-fallback-note");
        if (heading) heading.textContent = "Component alternatives";
        if (note) note.textContent = "Use the one ZIP above, or install all of these component ZIPs instead.";
      });
      versions.forEach(el => {
        el.textContent = typeof data?.latestTag === "string" && /^v?\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(data.latestTag)
          ? data.latestTag : "Version unavailable";
      });
    });
  }

  const controls = document.getElementById("recording-filters");
  const voice = document.getElementById("recording-voice");
  const language = document.getElementById("recording-language");
  const result = document.getElementById("recording-results");
  const empty = document.getElementById("recording-empty");
  const rows = [...document.querySelectorAll("[data-recording]")];
  const cards = [...document.querySelectorAll(".dl-voice")];
  let applyFilters = () => {};
  if (controls && voice && language && result && empty && rows.length) {
    const voices = new Map(), languages = new Set();
    rows.forEach(row => { voices.set(row.dataset.voice, row.dataset.voiceName); languages.add(row.dataset.language); });
    const addOption = (select, value, name) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = name;
      select.appendChild(option);
    };
    [...voices].sort((a, b) => a[1].localeCompare(b[1])).forEach(([id, name]) => addOption(voice, id, name));
    [...languages].sort((a, b) => a.localeCompare(b)).forEach(name => addOption(language, name, name));
    applyFilters = () => {
      let shown = 0;
      rows.forEach(row => {
        row.hidden = Boolean((voice.value && voice.value !== row.dataset.voice) || (language.value && language.value !== row.dataset.language));
        if (!row.hidden) shown++;
      });
      cards.forEach(card => {
        card.hidden = !(card.matches("[data-recording]") ? !card.hidden : [...card.querySelectorAll("[data-recording]")].some(row => !row.hidden));
        if (card.hidden) stopSamples.get(card)?.();
        if (!card.matches("[data-recording]")) card.querySelectorAll(".dl-files").forEach(list => {
          list.hidden = ![...list.querySelectorAll("[data-recording]")].some(row => !row.hidden);
          const heading = list.previousElementSibling;
          if (heading?.classList.contains("dl-group-title")) heading.hidden = list.hidden;
        });
      });
      result.textContent = `${shown} recording ${shown === 1 ? "choice" : "choices"}`;
      empty.hidden = shown > 0;
    };
    voice.value = language.value = "";
    voice.addEventListener("change", applyFilters);
    language.addEventListener("change", applyFilters);
    applyFilters();
    controls.hidden = false;
  }

  const howto = document.getElementById("install");
  const revealHash = () => {
    if (howto && location.hash === "#install") howto.open = true;
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const target = id && document.getElementById(id);
    if (target && (target.matches(".dl-voice") || target.closest(".dl-voice"))) {
      const wasHidden = target.hidden || target.closest(".dl-voice").hidden;
      if (voice && language) { voice.value = language.value = ""; applyFilters(); }
      let ancestor = target.parentElement;
      while (ancestor && ancestor !== document) {
        if (ancestor.tagName === "DETAILS") ancestor.open = true;
        ancestor = ancestor.parentElement;
      }
      if (wasHidden || target.closest(".dl-install-choice")) target.scrollIntoView({ block: "start" });
    }
  };
  revealHash();
  window.addEventListener("hashchange", revealHash);

  document.querySelectorAll(".dl-link").forEach(link => link.addEventListener("click", () => {
    try { navigator.sendBeacon("/api/click"); } catch {}
  }));
})();
