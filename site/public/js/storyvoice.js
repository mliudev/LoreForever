// Listen on a profile's story (/u/<handle>, lib/storyvoice.js listenBox, LOR-316): plays the story's recorded parts
// one after the other in the profile's narrator, lights up the paragraph being read, and never starts by
// itself. For the owner while the story is still being recorded (data-wait), it says so and asks
// GET /api/profile/voice until the recordings are there.
(() => {
  const box = document.querySelector("[data-story-voice]");
  if (!box) return;
  let data;
  try { data = JSON.parse(box.dataset.storyVoice); } catch (e) { return; }
  const paras = [...document.querySelectorAll(".pf-story-text [data-para]")];
  const fmt = s => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const audio = new Audio();
  audio.preload = "none";
  let part = 0, playing = false;

  // The paragraph being read (-1: none), the others dimmed while it plays.
  const light = i => {
    document.querySelector(".pf-story-text")?.classList.toggle("pf-playing", i >= 0);
    paras.forEach((p, j) => p.classList.toggle("pf-reading", j === i));
  };

  function build() {
    const voice = data.narrator;
    if (!data.voices[voice]?.length) return false;
    const icon = el("span", { className: "pf-listen-ic", ariaHidden: "true", textContent: "▶" });
    const len = el("span", { className: "pf-listen-len" });
    const play = el("button", { type: "button", className: "pf-listen-play" }, icon, el("span", { textContent: "Listen" }), len);
    play.setAttribute("aria-label", `Listen to ${data.name}'s story`);
    const show = () => {
      len.textContent = fmt(data.voices[voice].reduce((a, p) => a + p.sec, 0));
      icon.textContent = playing ? "❚❚" : "▶";
      play.classList.toggle("pf-on", playing);
    };
    const start = i => {
      part = i;
      const take = data.voices[voice][i];
      if (!take) { stop(); return; }
      audio.src = take.url;
      audio.play().catch(() => stop());
      light(take.para);
    };
    const stop = () => { playing = false; audio.pause(); audio.removeAttribute("src"); part = 0; light(-1); show(); };
    play.addEventListener("click", () => {
      if (playing) { playing = false; audio.pause(); show(); return; }
      playing = true;
      show();
      if (audio.src && !audio.ended && audio.currentTime > 0) audio.play().catch(() => stop());
      else start(part);
    });
    audio.addEventListener("ended", () => { if (playing) start(part + 1); });
    audio.addEventListener("error", () => { if (playing) stop(); });
    box.replaceChildren(play);
    box.removeAttribute("data-wait");
    box.hidden = false;
    show();
    return true;
  }

  // The owner, while the narrator is still recording it.
  function wait() {
    box.replaceChildren(el("span", { className: "pf-listen-wait", role: "status",
      textContent: "Your story is being read aloud for this page. It'll be ready to hear in a minute or two." }));
    box.hidden = false;
    let tries = 0;
    const ask = async () => {
      if (++tries > 40) { box.hidden = true; return; }   // ten minutes: try again on a later visit
      try {
        const res = await (await fetch(`/api/profile/voice?handle=${encodeURIComponent(data.handle)}`, { cache: "no-store" })).json();
        if (res.ok && res.voice) {
          data.narrator = res.voice.narrator;
          data.voices = res.voice.voices;
          if (build()) return;
          if (!res.voice.pending) { box.hidden = true; return; }
        }
      } catch (e) { /* offline for a moment: ask again */ }
      setTimeout(ask, 15000);
    };
    setTimeout(ask, 15000);
  }

  if (!build() && box.hasAttribute("data-wait")) wait();
})();
