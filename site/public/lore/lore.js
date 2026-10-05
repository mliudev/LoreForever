// Lore pages (site/lib/lore.js renders them; site/LORE_PAGES.md): one player per page with speed (1x, 1.25x, 1.5x,
// remembered), read-along (the sentence being read lights up; click one to jump there), keyboard keys and "Report a
// problem with this line" (POST /api/clip-report, shown only when that endpoint exists). On /lore it also builds the
// list from /lore/data/index.json and /api/narration/live: filters by zone, kind and voice, search, j/k to move,
// space to play, enter to open, and a player bar. Without JavaScript the play buttons are plain links to the
// recordings and /lore lists the zones.
(() => {
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode: not remembered */ } },
  };
  const RATES = [1, 1.25, 1.5];
  let rate = RATES.includes(Number(store.get("lf-lore-rate"))) ? Number(store.get("lf-lore-rate")) : 1;
  const audio = new Audio();
  audio.preload = "none";
  const fmt = s => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  // Space and Enter on a focused button or link do what they always do.
  const pressing = e => (e.key === " " || e.key === "Enter") && e.target.closest && e.target.closest("button, a, summary");
  const rateLabel = r => `${r}×`;
  const listeners = { rate: [], state: [] };
  const emit = (name, ...a) => listeners[name].forEach(f => f(...a));

  function setRate(r) {
    rate = r;
    audio.defaultPlaybackRate = r;
    audio.playbackRate = r;
    store.set("lf-lore-rate", String(r));
    emit("rate", r);
  }
  const nextRate = () => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length]);

  function load(src) {
    audio.src = src;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    audio.play().catch(() => {});
  }
  ["play", "pause", "ended", "error", "loadstart"].forEach(t => audio.addEventListener(t, () => emit("state", t)));
  audio.addEventListener("play", () => { audio.playbackRate = rate; });

  // ---- Read-along: the sentence spans (.rl-s) of the clip playing, by share of the text read ----
  const lengths = new WeakMap();
  function spansOf(box) {
    const spans = box ? [...box.querySelectorAll(".rl-s")] : [];
    if (box && !lengths.has(box)) lengths.set(box, spans.map(s => s.textContent.length));
    return { spans, lens: box ? lengths.get(box) : [] };
  }
  function highlight(box, frac) {
    const { spans, lens } = spansOf(box);
    const total = lens.reduce((a, b) => a + b, 0);
    let pos = frac * total, i = 0;
    while (i < spans.length - 1 && pos > lens[i]) { pos -= lens[i]; i++; }
    spans.forEach((s, j) => s.classList.toggle("rl-on", j === i && frac > 0 && frac < 1));
  }
  function seekTo(box, span) {
    const { spans, lens } = spansOf(box);
    const total = lens.reduce((a, b) => a + b, 0);
    const i = spans.indexOf(span);
    if (i < 0 || !total || !audio.duration) return;
    audio.currentTime = audio.duration * lens.slice(0, i).reduce((a, b) => a + b, 0) / total;
  }

  // ---- Reports (LOR-232, site/CLIP_REPORT_API.md). The endpoint may not be on this deployment yet, and then Pages
  // answers with a 404 or with the home page (it has no 404.html): the buttons show only when
  // GET /api/clip-report/counts answers with its JSON, which also gives each clip's open reports (public; the
  // reports' text stays private) ----
  const dlg = document.getElementById("lp-report");
  let reportable = false, target = null, counts = {};
  const onReportable = [];
  const openText = n => (n > 0 ? `${n} open ${n === 1 ? "report" : "reports"}` : "");
  function showCount(box, cid) {
    if (!box) return;
    box.textContent = openText(counts[cid] || 0);
    box.hidden = !reportable || !counts[cid];
  }
  // clips: the clip ids to ask about (at most 90), or none for every clip with an open report.
  async function probe(clips) {
    if (!dlg) return;
    try {
      const q = clips && clips.length ? `?clips=${encodeURIComponent(clips.slice(0, 90).join(","))}` : "";
      const res = await fetch(`/api/clip-report/counts${q}`);
      const data = (res.headers.get("Content-Type") || "").includes("application/json") ? await res.json() : null;
      reportable = Boolean(res.ok && data && data.ok);
      counts = (reportable && data.counts) || {};
    } catch (e) { reportable = false; }
    document.querySelectorAll(".lp-clip").forEach(section => {
      const b = section.querySelector(".lp-rep");
      if (b) b.hidden = !reportable;
      showCount(section.querySelector(".lp-open"), section.dataset.clip);
    });
    onReportable.forEach(f => f());
  }
  function openReport(t) {
    if (!dlg || !reportable || !t) return;
    target = t;
    const form = dlg.querySelector("form");
    form.reset();
    dlg.querySelector(".lp-what").textContent = `${t.title}${t.voiceName ? " (" + t.voiceName + ")" : ""}`;
    dlg.querySelector(".lp-name").hidden = true;
    dlg.querySelector(".lp-msg").textContent = "";
    form.querySelector("[type=submit]").disabled = false;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }
  if (dlg) {
    const form = dlg.querySelector("form");
    const close = () => { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); };
    form.addEventListener("change", () => { dlg.querySelector(".lp-name").hidden = form.reason.value !== "name"; });
    dlg.querySelector(".lp-cancel").addEventListener("click", close);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const msg = dlg.querySelector(".lp-msg");
      const send = form.querySelector("[type=submit]");
      if (!form.reason.value) { msg.textContent = "Pick what's wrong first."; return; }
      const body = { clip: `${target.clip}@${target.hash}`, voice: target.voice, reason: form.reason.value,
        source: "site", website: form.website.value };
      if (form.reason.value === "name") {   // form.name is the form's own name: ask for the field
        const name = form.elements.namedItem("name").value.trim();
        if (name) body.name = name.slice(0, 60);
        if (form.say_as.value.trim()) body.say_as = form.say_as.value.trim().slice(0, 80);
      }
      if (form.note.value.trim()) body.note = form.note.value.trim().slice(0, 300);
      send.disabled = true;
      msg.textContent = "Sending...";
      try {
        const res = await fetch("/api/clip-report", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok !== false) {
          msg.textContent = "Thanks, that helps. Reported lines get fixed and recorded again.";
          if (data.open > (counts[target.clip] || 0)) counts[target.clip] = data.open;
          document.querySelectorAll(".lp-clip").forEach(s => {
            if (s.dataset.clip === target.clip) showCount(s.querySelector(".lp-open"), target.clip);
          });
          onReportable.forEach(f => f());
          setTimeout(close, 1800);
          return;
        }
        msg.textContent = data.error || "That didn't go through. Try again in a minute.";
      } catch (err) {
        msg.textContent = "That didn't go through. Check your connection and try again.";
      }
      send.disabled = false;
    });
  }

  // ---- An entry page: a play button per voice on each clip ----
  const article = document.querySelector(".lp");
  if (article) {
    const sections = [...article.querySelectorAll(".lp-clip")];
    const voiceUsed = new Map();   // section -> the voice played last there (what a report is about)
    let current = null;            // { section, button }
    const icon = (b, playing) => {
      const i = b.querySelector(".lp-ic");
      if (i) i.innerHTML = playing ? "&#10074;&#10074;" : "&#9654;";
      b.setAttribute("aria-pressed", String(playing));
      b.classList.toggle("lp-on", playing);
    };
    listeners.state.push(type => {
      article.querySelectorAll(".lp-btn").forEach(b => icon(b, Boolean(current && b === current.button && !audio.paused)));
      if (type === "ended" && current) highlight(current.section, 0);
      if (type === "error" && current) {
        current.button.classList.add("lp-bad");
        current.button.title = "Couldn't play this one. Try again later.";
      }
    });
    audio.addEventListener("timeupdate", () => {
      if (current && audio.duration) highlight(current.section, audio.currentTime / audio.duration);
    });
    const play = button => {
      const section = button.closest(".lp-clip");
      if (current && current.button === button) {
        if (audio.paused) audio.play().catch(() => {}); else audio.pause();
        return;
      }
      if (current) highlight(current.section, 0);
      current = { section, button };
      voiceUsed.set(section, button);
      const fold = section.querySelector("details");
      if (fold) fold.open = true;
      load(button.href);
    };
    article.addEventListener("click", e => {
      const b = e.target.closest(".lp-btn");
      if (b) { e.preventDefault(); play(b); return; }
      const s = e.target.closest(".rl-s");
      if (s && current && current.section.contains(s)) seekTo(current.section, s);
      const rep = e.target.closest(".lp-rep");
      if (rep) {
        const section = rep.closest(".lp-clip");
        const button = voiceUsed.get(section) || section.querySelector(".lp-btn");
        if (!button) return;
        openReport({ clip: section.dataset.clip, hash: section.dataset.hash, voice: button.dataset.voice,
          voiceName: button.querySelector(".lp-vn")?.textContent || "", title: section.querySelector("h2, h3")?.textContent || "" });
      }
    });
    const speed = article.querySelector(".lp-speed");
    if (speed) {
      const mark = () => speed.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.rate) === rate)));
      speed.addEventListener("click", e => { const b = e.target.closest("button"); if (b) setRate(Number(b.dataset.rate)); });
      listeners.rate.push(mark);
      mark();
      speed.hidden = false;
    }
    const playable = sections.filter(s => s.querySelector(".lp-btn"));
    document.addEventListener("keydown", e => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey || !playable.length) return;
      if (dlg && dlg.open) return;
      const at = current ? playable.indexOf(current.section) : -1;
      if (e.key === " " && e.target.closest && e.target.closest(".lp-btn")) {
        e.preventDefault();
        play(e.target.closest(".lp-btn"));
      } else if (pressing(e)) {
        return;
      } else if (e.key === " ") {
        e.preventDefault();
        play(current ? current.button : playable[0].querySelector(".lp-btn"));
      } else if (e.key === "j" || e.key === "k") {
        const next = playable[Math.min(playable.length - 1, Math.max(0, at + (e.key === "j" ? 1 : -1)))];
        const voice = current?.button.dataset.voice;
        const b = (voice && next.querySelector(`.lp-btn[data-voice="${voice}"]`)) || next.querySelector(".lp-btn");
        if (b && (!current || b !== current.button)) { play(b); next.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
      } else if (e.key === "s") {
        nextRate();
      }
    });
    probe(sections.filter(s => s.querySelector(".lp-rep")).map(s => s.dataset.clip));
  }

  // ---- /lore: the list ----
  const lx = document.querySelector(".lx");
  if (!lx) return;
  const PARTS = { detail: "Quest text", progress: "Progress", complete: "Completion" };
  const ZONE_TYPES = [["city", "Capitals"], ["zone", "Zones"], ["dungeon", "Dungeons"]];
  const PAGE = 100;
  const keyOf = path => {
    const [, , kind, id] = path.split("/");
    return kind === "quest" ? `quest:${id.split("-")[0]}` : `${kind}:${id}`;
  };
  const stem = cid => {
    const d = /^quest:(\d+)#(detail|progress|complete)$/.exec(cid);
    if (d) return `quest_${d[1]}__${d[2]}`;
    const [base, faq] = cid.split("#faq");
    return base.replace(/[^\w-]/g, "_") + (faq ? `__faq${faq}` : "");
  };
  const fold = s => String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  const bar = lx.querySelector(".lx-bar"), list = lx.querySelector(".lx-list"), more = lx.querySelector(".lx-more");
  const count = lx.querySelector(".lx-count"), player = document.querySelector(".lx-player");
  let rows = [], shown = [], limit = PAGE, sel = -1, playing = null, voices = [], kinds = [], zoneName = {};
  const params = new URLSearchParams(location.search);
  const state = { q: params.get("q") || "", z: params.get("z") || "", k: params.get("k") || "", v: params.get("v") || "",
    playable: params.get("playable") === "1" };
  let voicePref = state.v || store.get("lf-lore-voice") || "";

  Promise.all([
    fetch("/lore/data/index.json").then(r => r.json()),
    fetch("/api/narration/live").then(r => (r.ok ? r.json() : { keys: [] })).catch(() => ({ keys: [] })),
  ]).then(([index, liveData]) => {
    const live = new Set(liveData.keys || []);
    voices = index.voices || [];
    kinds = index.kinds || [];
    (index.zones || []).forEach(z => { zoneName[z.key] = z.name; });
    const kindLabel = { zone: "Zone", dungeon: "Dungeon", subzone: "Place", npc: "Character", boss: "Boss",
      quest: "Quest", faq: "Answer", topic: "Lore" };
    for (const p of index.pages || []) {
      const key = keyOf(p.p);
      for (const [part, hash, refs, q] of p.c) {
        const cid = part ? `${key}#${part}` : key;
        const v = {};
        voices.forEach((voice, j) => {
          const r = refs[j];
          if (!r) return;
          const k = `${voice.id}/${stem(cid)}-${r[0]}.${r[2] || "mp3"}`;
          if (live.has(k)) v[voice.id] = { src: `/audio/clip/${k}`, sec: r[1] };
        });
        const kind = part.startsWith("faq") ? "faq" : p.k;
        const title = q || p.n;
        const sub = [...new Set([part.startsWith("faq") ? p.n : PARTS[part], kindLabel[kind] || "", zoneName[p.z] || ""])]
          .filter(s => s && s !== title);
        rows.push({ cid, hash, kind, z: p.z, title, sub: sub.join(" · "), href: p.p + (part ? `#${part}` : ""), v,
          find: fold(`${title} ${p.n} ${zoneName[p.z] || ""}`) });
      }
    }
    const anyLive = rows.some(r => Object.keys(r.v).length);
    if (!anyLive) { lx.querySelector(".lx-soon").hidden = false; state.playable = false; }
    buildBar(index, anyLive);
    apply();
    bar.hidden = false;
    lx.querySelector(".lx-keys").hidden = false;
    probe();
  }).catch(() => { count.textContent = "The list didn't load. Pick a zone below instead."; });

  function buildBar(index, anyLive) {
    bar.q.value = state.q;
    const select = bar.z;
    for (const [type, label] of [...ZONE_TYPES, ["", "Elsewhere"]]) {
      const zs = (index.zones || []).filter(z => (type ? z.type === type : !ZONE_TYPES.some(([t]) => t === z.type)));
      if (!zs.length) continue;
      const g = el("optgroup");
      g.label = label;
      zs.forEach(z => { const o = el("option", "", z.name); o.value = z.key; g.append(o); });
      select.append(g);
    }
    select.value = state.z;
    const chips = (box, items, field) => {
      box.replaceChildren(...items.map(([value, label]) => {
        const b = el("button", "", label);
        b.type = "button";
        b.dataset.value = value;
        b.setAttribute("aria-pressed", String(state[field] === value));
        b.addEventListener("click", () => {
          state[field] = value;
          if (field === "v" && value) { voicePref = value; store.set("lf-lore-voice", value); }
          box.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.value === value)));
          apply();
        });
        return b;
      }));
    };
    chips(bar.querySelector(".lx-chips:not(.lx-voices)"), [["", "All"], ...kinds.map(k => [k.id, k.label])], "k");
    const vbox = bar.querySelector(".lx-voices");
    if (anyLive && voices.length > 1) chips(vbox, [["", "Any voice"], ...voices.map(v => [v.id, v.name])], "v");
    else vbox.hidden = true;
    const check = bar.playable;
    check.checked = state.playable;
    check.closest("label").hidden = !anyLive;
    let timer;
    bar.q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { state.q = bar.q.value; apply(); }, 150); });
    select.addEventListener("change", () => { state.z = select.value; apply(); });
    check.addEventListener("change", () => { state.playable = check.checked; apply(); });
  }

  function apply() {
    const words = fold(state.q).split(/\s+/).filter(Boolean);
    shown = rows.filter(r => (!state.z || r.z === state.z) && (!state.k || r.kind === state.k)
      && (!state.v || r.v[state.v]) && (!state.playable || Object.keys(r.v).length)
      && words.every(w => r.find.includes(w)));
    limit = PAGE;
    sel = -1;
    render();
    const q = new URLSearchParams();
    for (const k of ["q", "z", "k", "v"]) if (state[k]) q.set(k, state[k]);
    if (state.playable) q.set("playable", "1");
    history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : "") + location.hash);
  }

  const voiceOf = r => (r.v[voicePref] ? voicePref : Object.keys(r.v)[0]);

  function render() {
    count.textContent = `${shown.length.toLocaleString("en-US")} ${shown.length === 1 ? "narration" : "narrations"}`;
    list.replaceChildren(...shown.slice(0, limit).map((r, i) => {
      const row = el("div", "lx-row");
      row.setAttribute("role", "listitem");
      row.dataset.i = i;
      const vid = voiceOf(r);
      if (vid) {
        const b = el("button", "lx-play");
        b.type = "button";
        b.innerHTML = "&#9654;";
        b.setAttribute("aria-label", `Play ${r.title}`);
        b.addEventListener("click", () => { sel = i; mark(); toggle(r); });
        row.append(b);
      } else {
        row.append(el("span", "lx-ingame", "In game"));
      }
      const main = el("div", "lx-main");
      const a = el("a", "", r.title);
      a.href = r.href;
      main.append(a, el("span", "lx-sub", r.sub));
      row.append(main, el("span", "lx-len", vid ? fmt(r.v[vid].sec) : ""));
      if (playing === r) row.classList.add("lx-on");
      return row;
    }));
    more.hidden = shown.length <= limit;
    mark();
  }
  more.addEventListener("click", () => { limit += PAGE; render(); });

  function mark() {
    list.querySelectorAll(".lx-row").forEach(row => {
      const i = Number(row.dataset.i);
      row.classList.toggle("lx-sel", i === sel);
      const r = shown[i];
      row.classList.toggle("lx-on", r === playing);
      const b = row.querySelector(".lx-play");
      if (b) b.innerHTML = r === playing && !audio.paused ? "&#10074;&#10074;" : "&#9654;";
    });
  }

  // ---- The player bar ----
  const pp = player.querySelector(".lx-pp"), titleLink = player.querySelector(".lx-title"), subLine = player.querySelector(".lx-sub");
  const seek = player.querySelector(".lx-seek"), time = player.querySelector(".lx-time"), voiceBtn = player.querySelector(".lx-voice");
  const rateBtn = player.querySelector(".lx-rate"), auto = player.querySelector(".lx-auto input"), reportBtn = player.querySelector(".lx-report");
  const openBox = player.querySelector(".lx-open");
  let playingVoice = "";
  auto.checked = store.get("lf-lore-auto") === "1";
  auto.addEventListener("change", () => store.set("lf-lore-auto", auto.checked ? "1" : "0"));
  rateBtn.textContent = rateLabel(rate);
  listeners.rate.push(r => { rateBtn.textContent = rateLabel(r); });
  rateBtn.addEventListener("click", nextRate);

  function start(r, vid) {
    playing = r;
    playingVoice = vid || voiceOf(r);
    player.hidden = false;
    document.body.classList.add("lx-has-player");
    titleLink.textContent = r.title;
    titleLink.href = r.href;
    subLine.textContent = r.sub;
    const names = Object.keys(r.v);
    voiceBtn.hidden = names.length < 2;
    voiceBtn.textContent = (voices.find(v => v.id === playingVoice) || {}).name || playingVoice;
    reportBtn.hidden = !reportable;
    showCount(openBox, r.cid);
    load(r.v[playingVoice].src);
    if ("mediaSession" in navigator && window.MediaMetadata) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: r.title, artist: "Lore Forever", album: r.sub });
    }
    mark();
  }
  function toggle(r) {
    if (playing === r) { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
    else start(r);
  }
  function step(d) {
    const playableRows = shown.filter(r => Object.keys(r.v).length);
    if (!playableRows.length) return;
    const at = playableRows.indexOf(playing);
    const next = playableRows[at < 0 ? 0 : at + d];
    if (!next) return;
    sel = shown.indexOf(next);
    while (sel >= limit) { limit += PAGE; render(); }
    start(next);
    list.querySelector(`.lx-row[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }
  onReportable.push(() => {
    if (!playing) return;
    reportBtn.hidden = !reportable;
    showCount(openBox, playing.cid);
  });
  pp.addEventListener("click", () => { if (playing) toggle(playing); });
  player.querySelector(".lx-prev").addEventListener("click", () => step(-1));
  player.querySelector(".lx-next").addEventListener("click", () => step(1));
  voiceBtn.addEventListener("click", () => {
    if (!playing) return;
    const names = Object.keys(playing.v);
    const vid = names[(names.indexOf(playingVoice) + 1) % names.length];
    voicePref = vid;
    store.set("lf-lore-voice", vid);
    start(playing, vid);
  });
  reportBtn.addEventListener("click", () => {
    if (!playing) return;
    openReport({ clip: playing.cid, hash: playing.hash, voice: playingVoice, title: playing.title,
      voiceName: (voices.find(v => v.id === playingVoice) || {}).name || "" });
  });
  seek.addEventListener("input", () => { if (audio.duration) audio.currentTime = audio.duration * seek.value / 1000; });
  audio.addEventListener("timeupdate", () => {
    if (!playing) return;
    time.textContent = fmt(audio.currentTime);
    if (audio.duration) seek.value = String(Math.round(1000 * audio.currentTime / audio.duration));
  });
  listeners.state.push(type => {
    if (!playing) return;
    pp.innerHTML = audio.paused ? "&#9654;" : "&#10074;&#10074;";
    pp.setAttribute("aria-label", audio.paused ? "Play" : "Pause");
    mark();
    if (type === "ended" && auto.checked) step(1);
  });
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
      navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
    } catch (e) { /* not supported here */ }
  }

  document.addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey || (dlg && dlg.open)) return;
    if (e.key === "Escape" && e.target === bar.q) { bar.q.blur(); return; }
    if (typing(e) || pressing(e)) return;
    if (e.key === "/") { e.preventDefault(); bar.q.focus(); return; }
    if (e.key === "j" || e.key === "k") {
      const max = Math.min(shown.length, limit) - 1;
      if (max < 0) return;
      sel = Math.min(max, Math.max(0, sel + (e.key === "j" ? 1 : -1)));
      if (e.key === "j" && sel === max && shown.length > limit) { limit += PAGE; render(); }
      mark();
      list.querySelector(`.lx-row[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === " ") {
      const r = shown[sel] || playing;
      if (!r || !Object.keys(r.v).length) return;
      e.preventDefault();
      toggle(r);
    } else if (e.key === "Enter" && shown[sel]) {
      location.href = shown[sel].href;
    } else if (e.key === "s") {
      nextRate();
    } else if (e.key === "v" && voices.length > 1) {
      const ids = voices.map(v => v.id);
      voicePref = ids[(ids.indexOf(voicePref) + 1) % ids.length];
      store.set("lf-lore-voice", voicePref);
      if (playing && playing.v[voicePref]) start(playing, voicePref); else render();
    }
  });
})();
