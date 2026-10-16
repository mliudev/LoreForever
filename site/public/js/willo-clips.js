// /willo's clip player: the three cards swap what the big player shows (a clip, or the window screenshot).
(() => {
  const root = document.getElementById("wl-player");
  if (!root) return;
  const video = root.querySelector(".wl-stage video");
  const shot = root.querySelector(".wl-stage img");
  const cap = document.getElementById("wl-cap");
  const picks = [...root.querySelectorAll(".wl-pick")];
  for (const pick of picks) {
    pick.addEventListener("click", () => {
      for (const p of picks) p.setAttribute("aria-pressed", String(p === pick));
      cap.textContent = pick.dataset.caption;
      video.pause();
      if (pick.dataset.video) {
        shot.hidden = true;
        video.hidden = false;
        if (video.getAttribute("src") !== pick.dataset.video) {
          video.poster = pick.dataset.poster;
          video.src = pick.dataset.video;
        }
        video.setAttribute("aria-label", pick.dataset.label);
      } else {
        video.hidden = true;
        shot.src = pick.dataset.image;
        shot.alt = pick.dataset.label;
        shot.hidden = false;
      }
    });
  }
})();
