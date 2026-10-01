// Voice pages (/voices, /voices/<id>): likes without reloading the page, and one sample playing at a time. Without
// JavaScript the like button is a plain form post (functions/api/voices/like.js) and the samples are ordinary
// audio players.
(() => {
  const today = new Date().toISOString().slice(0, 10);
  const key = id => "lf-like:" + id;
  const liked = id => { try { return localStorage.getItem(key(id)) === today; } catch (e) { return false; } };
  document.querySelectorAll(".vc-like").forEach(form => {
    const button = form.querySelector("button");
    const id = button.dataset.id;
    const mark = () => { button.setAttribute("aria-pressed", "true"); button.title = "You liked this today"; };
    if (liked(id)) mark();
    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (button.getAttribute("aria-pressed") === "true" || button.disabled) return;
      button.disabled = true;
      try {
        const res = await fetch("/api/voices/like", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
        });
        const data = await res.json();
        if (data.ok) {
          form.querySelector(".vc-count").textContent = data.count;
          try { localStorage.setItem(key(id), today); } catch (e) {}
          mark();
        }
      } catch (e) {}
      button.disabled = false;
    });
  });
  document.addEventListener("play", e => {
    document.querySelectorAll("audio").forEach(a => { if (a !== e.target) a.pause(); });
  }, true);

  // The /voices list: each row's ▶ plays its sample in place (and becomes ❚❚ while it plays).
  document.querySelectorAll(".vr").forEach(row => {
    const button = row.querySelector(".vr-play");
    const audio = row.querySelector(".vr-audio");
    if (!button || !audio) return;
    const label = button.getAttribute("aria-label");
    const show = playing => {
      button.innerHTML = playing ? "&#10074;&#10074;" : "&#9654;";
      button.setAttribute("aria-pressed", String(playing));
      button.setAttribute("aria-label", playing ? "Pause" : label);
      row.classList.toggle("vr-on", playing);
    };
    button.addEventListener("click", () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
    audio.addEventListener("play", () => show(true));
    audio.addEventListener("pause", () => show(false));
    audio.addEventListener("ended", () => show(false));
  });

  // Filters and sorting above the list. Without JavaScript they stay hidden and every voice shows in page order.
  const filters = document.querySelector(".vl-filters");
  const list = document.querySelector(".vl-list");
  if (filters && list) {
    let lang = "", sort = "order";
    const apply = () => {
      const rows = [...list.querySelectorAll(".vr")];
      rows.sort((a, b) => sort === "likes"
        ? (+b.dataset.likes - +a.dataset.likes) || (+a.dataset.order - +b.dataset.order)
        : +a.dataset.order - +b.dataset.order);
      rows.forEach(r => { r.hidden = Boolean(lang) && r.dataset.lang !== lang; list.append(r); });
      filters.querySelectorAll("[data-lang]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
      filters.querySelectorAll("[data-sort]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sort === sort)));
    };
    filters.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.lang != null) lang = b.dataset.lang;
      if (b.dataset.sort) sort = b.dataset.sort;
      apply();
    });
    // A like changes the count: keep "Most liked" in step.
    list.addEventListener("submit", () => setTimeout(() => list.querySelectorAll(".vr").forEach(r => {
      r.dataset.likes = r.querySelector(".vc-count")?.textContent || r.dataset.likes;
    }), 1500));
    filters.hidden = false;
  }
})();
