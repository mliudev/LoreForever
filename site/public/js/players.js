// The themed audio players (style.css .h-play, .h-track) on the home page and /willo: a button with data-src plays its
// clip, one at a time across the page. Playing one pauses any video that has its sound on, and a video played with
// its sound on stops the voice, so they never talk over each other. A track's line (.h-bar i) fills as it plays; the
// home page's "Now reading" plate (.h-reading) moves its waveform.
(() => {
  let current = null;
  const stop = () => { if (current) { current.audio.pause(); current.set(false); current = null; } };
  for (const btn of document.querySelectorAll(".h-play[data-src]")) {
    const audio = new Audio();
    audio.preload = "none";
    const bar = btn.closest(".h-track")?.querySelector(".h-bar i");
    const wave = btn.closest(".h-reading")?.querySelector(".h-wave");
    const set = on => { btn.setAttribute("aria-pressed", String(on)); wave?.classList.toggle("on", on); };
    btn.addEventListener("click", () => {
      if (!audio.src) audio.src = btn.dataset.src;
      if (!audio.paused) { audio.pause(); return set(false); }
      if (current && current.audio !== audio) stop();
      for (const video of document.querySelectorAll("video")) if (!video.muted) video.pause();
      audio.play().catch(() => set(false));
      set(true);
      current = { audio, set };
    });
    audio.addEventListener("timeupdate", () => { if (bar && audio.duration) bar.style.width = (100 * audio.currentTime / audio.duration) + "%"; });
    audio.addEventListener("ended", () => set(false));
  }
  document.addEventListener("play", e => { if (e.target instanceof HTMLVideoElement && !e.target.muted) stop(); }, true);
})();
