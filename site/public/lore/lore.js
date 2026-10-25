// The lore book (site/lib/lore.js renders it; site/LORE_PAGES.md): /lore and every /lore/<type>/<id> are one open book.
// The left page is the server's (the entry, or on /lore what the book is); this script makes both pages work:
//  - the right page: the playlist, built from /lore/data/index.json, more.json and /api/narration/live (search, zone, kind,
//    sort, language and download filters, "Play all", rows grouped by zone, a tick on what a signed-in player has found);
//  - a click on a row or a link to another lore page fetches that address's page and puts its left page in (history.pushState),
//    so a click and a full load show the same thing; without this script every link is just a link;
//  - one player for both pages: each recording's play button (speed 1x, 1.25x, 1.5x, remembered; read-along: the sentence being
//    read lights up, click one to jump there), the pinned foot (play and pause, previous, next, progress, narrator, speed),
//    "Up next", "Next plays on", keyboard keys, and "Report a problem with this line" (POST /api/clip-report, shown only
//    when that endpoint exists).
// Without JavaScript the play buttons are plain links to the recordings and /lore lists the zones.
(() => {
  const book = document.querySelector("[data-book]");
  if (!book) return;
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
  const $ = (s, root = book) => root.querySelector(s);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const KIND_ICON = { zone: "zone", dungeon: "zone", subzone: "place", npc: "person", boss: "boss", quest: "quest", item: "item", topic: "book" };
  const svgIcon = name => {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "li");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const use = document.createElementNS(NS, "use");
    use.setAttribute("href", `#li-${name}`);
    svg.append(use);
    return svg;
  };
  // How the lore pages are used, as plain daily numbers (functions/api/count/[what].js, LOR-809): nothing about who.
  const tally = what => { try { navigator.sendBeacon(`/api/count/${what}`); } catch (e) {} };

  const pageBox = $("#lore-page"), shelf = $("#lore-shelf");
  const ft = { pp: $(".bk-pp"), prev: $(".bk-prev"), next: $(".bk-next"), nt: $(".bk-nt"), ns: $(".bk-ns"), seek: $(".bk-seek"),
    time: $(".bk-time"), voice: $(".bk-voice"), rate: $(".bk-rate"), report: $(".bk-report"), open: $(".bk-open") };
  const nb = { pp: $(".nowbox .pp"), title: $(".nb-title"), sub: $(".nb-sub"), auto: $(".lx-auto input") };
  const upnext = $(".upnext", shelf), langNote = $(".lx-langnote", shelf);

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
  ft.rate.textContent = rateLabel(rate);
  listeners.rate.push(r => { ft.rate.textContent = rateLabel(r); });
  ft.rate.addEventListener("click", nextRate);

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
  const sectionOf = cid => (cid ? [...pageBox.querySelectorAll(".lp-clip")].find(s => s.dataset.clip === cid) : null);

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
  const paintReports = () => {
    pageBox.querySelectorAll(".lp-clip").forEach(section => {
      const b = section.querySelector(".lp-rep");
      if (b) b.hidden = !reportable;
      showCount(section.querySelector(".lp-open"), section.dataset.clip);
    });
    onReportable.forEach(f => f());
  };
  // clips: the clip ids to ask about (at most 90), or none for every clip with an open report.
  async function probe(clips) {
    if (!dlg) return;
    try {
      const q = clips && clips.length ? `?clips=${encodeURIComponent(clips.slice(0, 90).join(","))}` : "";
      const res = await fetch(`/api/clip-report/counts${q}`);
      const data = (res.headers.get("Content-Type") || "").includes("application/json") ? await res.json() : null;
      reportable = Boolean(res.ok && data && data.ok);
      if (reportable) Object.assign(counts, data.counts || {});
    } catch (e) { reportable = false; }
    paintReports();
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
          paintReports();
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

  // ---- What's playing ----
  // A track is what plays: a row of the playlist (the page's first recording) or a recording on the page being read:
  // {cid (the clip id), hash, key (the page's entry key), title, sub, href, v: {voice id: {src, sec}}, page: true for the
  // page's own}. now: {t, voice, source: "row" | "page" | "sample", whole (the page's recordings in a row), all (Play all)}.
  let now = null, voices = [], voicePref = new URLSearchParams(location.search).get("v") || store.get("lf-lore-voice") || "";
  const voiceUsed = new Map();   // clip id -> the voice played last (what a report is about)
  const voiceName = (t, id) => (voices.find(v => v.id === id) || {}).name || (t.v[id] && t.v[id].name) || id;

  // The recordings on the page being read, in order.
  function pageTracks() {
    const art = pageBox.querySelector(".lp");
    if (!art) return [];
    const name = art.querySelector("h1")?.textContent || "";
    const where = art.querySelector(".lp-where a")?.textContent || "";
    return [...art.querySelectorAll(".lp-clip")].filter(s => s.querySelector(".lp-btn")).map(s => {
      const v = {};
      s.querySelectorAll(".lp-btn").forEach(b => {
        v[b.dataset.voice] = { src: b.getAttribute("href"), sec: Number(b.dataset.sec) || 0, name: b.querySelector(".lp-vn")?.textContent || b.dataset.voice };
      });
      const part = s.querySelector("h2, h3")?.textContent || "";
      return { cid: s.dataset.clip, hash: s.dataset.hash, key: art.dataset.key, page: true, v,
        title: s.classList.contains("lp-narration") || !part ? name : `${name}: ${part}`, sub: where, href: `${art.dataset.path}#${s.id}` };
    });
  }

  function start(t, vid, o = {}) {
    vid = vid && t.v[vid] ? vid : voiceOf(t);
    if (!vid || !t.v[vid]) return;
    // A new track: no sentence stays lit from the one before, wherever on the page it was (a swapped page, another voice).
    pageBox.querySelectorAll(".rl-on").forEach(s => s.classList.remove("rl-on"));
    now = { t, voice: vid, source: o.source || (t.sample ? "sample" : t.page ? "page" : "row"), whole: Boolean(o.whole), all: Boolean(o.all) };
    voiceUsed.set(t.cid, vid);
    const fold = sectionOf(t.cid)?.querySelector("details");
    if (fold) fold.open = true;
    tally("lore-play");
    load(t.v[vid].src);
    if ("mediaSession" in navigator && window.MediaMetadata) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: "Lore Forever", album: t.sub || "" });
    }
    paint();
  }
  function toggle(t, vid) {
    if (now && now.t.cid === t.cid && (!vid || vid === now.voice)) { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
    else start(t, vid, t.page ? { source: "page" } : {});
  }

  // What comes after (dir 1) or before (dir -1) what's playing: the next recording on the page being read, then the next row of
  // the list; a row's own successor is the next row. {t, source}, {nav: a page to open (the server's idea of next)}, or null.
  function succ(dir) {
    if (!now || now.t.sample) return null;
    const art = pageBox.querySelector(".lp");
    if (now.source === "page" && art && art.dataset.key === now.t.key) {
      const ts = pageTracks(), i = ts.findIndex(t => t.cid === now.t.cid);
      if (i >= 0 && ts[i + dir]) return { t: ts[i + dir], source: "page" };
    }
    const list = playableRows();
    const at = list.findIndex(r => (now.source === "page" ? r.key === now.t.key : r.cid === now.t.cid));
    const r = at < 0 ? (dir > 0 ? list[0] : null) : list[at + dir];
    if (r) return { t: r, source: "row" };
    if (dir > 0 && now.source === "page" && art && art.dataset.next) return { nav: art.dataset.next };
    return null;
  }
  function go(n) {
    if (!n) return;
    if (n.nav) { openPage(n.nav, { play: true }); return; }
    start(n.t, null, { source: n.source, whole: n.source === "page" && Boolean(now && now.whole), all: Boolean(now && now.all) });
    if (n.source === "row") reveal(n.t);
  }
  // Brings a row into view and selects it (the list grows until it's there).
  function reveal(r) {
    const i = shown.indexOf(r);
    if (i < 0) return;
    sel = i;
    while (i >= limit) { limit += PAGE; render(); }
    mark();
    list.querySelector(`.lx-row[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }
  function step(d) {
    if (!now) {   // nothing playing yet: the selected row, else the page being read, else the list's first
      if (d < 0) return;
      const ts = pageTracks(), r = shown[sel] && voiceOf(shown[sel]) ? shown[sel] : null;
      if (r) start(r, null, { source: "row" });
      else if (ts[0]) start(ts[0], null, { source: "page", whole: true });
      else if (playableRows()[0]) start(playableRows()[0], null, { source: "row" });
      return;
    }
    if (d < 0 && audio.currentTime > 3) { audio.currentTime = 0; return; }
    go(succ(d));
  }

  audio.addEventListener("ended", () => {
    if (!now || now.t.sample) return;
    const n = succ(1);
    if (!n) return;
    const samePage = Boolean(n.t && n.source === "page");
    if (now.all || (nb.auto && nb.auto.checked) || (samePage && now.whole)) go(n);
  });

  // ---- Painting: rows, the page's buttons, the pinned foot and the now-playing box ----
  function mark() {
    list.querySelectorAll(".lx-row").forEach(row => {
      const r = shown[Number(row.dataset.i)];
      if (!r) return;
      row.classList.toggle("lx-sel", Number(row.dataset.i) === sel);
      const on = Boolean(now && !now.t.sample && r.cid === now.t.cid);
      row.classList.toggle("lx-on", on);
      row.classList.toggle("lx-cur", Boolean(currentKey) && r.key === currentKey);
      const b = row.querySelector(".lx-play");
      if (b) b.innerHTML = on && !audio.paused ? "&#10074;&#10074;" : "&#9654;";
    });
  }
  function paint() {
    const playing = Boolean(now) && !audio.paused;
    pageBox.querySelectorAll(".lp-btn").forEach(b => {
      const section = b.closest(".lp-clip");
      const on = Boolean(now && section && section.dataset.clip === now.t.cid && b.dataset.voice === now.voice);
      const i = b.querySelector(".lp-ic");
      if (i) i.innerHTML = on && playing ? "&#10074;&#10074;" : "&#9654;";
      b.setAttribute("aria-pressed", String(on && playing));
      b.classList.toggle("lp-on", on && playing);
    });
    const all = $(".lp-all", pageBox);
    if (all) {
      const art = pageBox.querySelector(".lp");
      const on = Boolean(now && now.source === "page" && now.whole && art && art.dataset.key === now.t.key);
      const i = all.querySelector(".lp-ic");
      if (i) i.innerHTML = on && playing ? "&#10074;&#10074;" : "&#9654;";
      all.classList.toggle("lp-on", on && playing);
    }
    const glyph = playing ? "&#10074;&#10074;" : "&#9654;";
    ft.pp.innerHTML = glyph;
    ft.pp.setAttribute("aria-label", playing ? "Pause" : "Play");
    nb.pp.innerHTML = glyph;
    nb.pp.setAttribute("aria-label", playing ? "Pause" : "Play");
    ft.pp.disabled = nb.pp.disabled = false;
    if (now) {
      const t = now.t;
      ft.nt.textContent = t.title;
      ft.nt.href = t.href || "/lore";
      ft.nt.lang = t.lang || "";
      ft.ns.textContent = [t.sub, voiceName(t, now.voice)].filter(Boolean).join(" · ");
      nb.title.textContent = t.title;
      nb.title.lang = t.lang || "";
      nb.sub.textContent = [t.sub, voiceName(t, now.voice), audio.paused ? "paused" : ""].filter(Boolean).join(" · ");
      ft.voice.hidden = Object.keys(t.v).length < 2 || Boolean(pickOf());
      ft.voice.textContent = voiceName(t, now.voice);
      ft.report.hidden = !reportable || Boolean(t.sample);
      showCount(ft.open, t.sample ? "" : t.cid);
    } else {
      ft.nt.textContent = nb.title.textContent = "Nothing playing";
      ft.nt.removeAttribute("href");
      ft.ns.textContent = "";
      ft.voice.hidden = true;
      ft.report.hidden = true;
      ft.open.hidden = true;
    }
    mark();
    markSample();
    const n = succ(1);
    const name = n ? (n.t ? n.t.title : pageBox.querySelector(".lp")?.dataset.nextName || "") : "";
    upnext.hidden = !name;
    upnext.querySelector("b").textContent = name;
  }
  listeners.state.push(type => {
    if (type === "error" && now) {
      const b = pageBox.querySelector(`.lp-clip[data-clip="${CSS.escape(now.t.cid)}"] .lp-btn[data-voice="${now.voice}"]`);
      if (b) { b.classList.add("lp-bad"); b.title = "Couldn't play this one. Try again later."; }
    }
    if (type === "ended") { const s = now && sectionOf(now.t.cid); if (s) highlight(s, 0); }
    paint();
  });
  audio.addEventListener("timeupdate", () => {
    if (!now) return;
    ft.time.textContent = fmt(audio.currentTime);
    if (audio.duration) {
      ft.seek.value = String(Math.round(1000 * audio.currentTime / audio.duration));
      ft.seek.style.setProperty("--p", `${(100 * audio.currentTime / audio.duration).toFixed(1)}%`);
      const s = sectionOf(now.t.cid);
      if (s) highlight(s, audio.currentTime / audio.duration);
    }
  });
  ft.seek.addEventListener("input", () => { if (now && audio.duration) audio.currentTime = audio.duration * ft.seek.value / 1000; });
  const press = () => { if (now) toggle(now.t, now.voice); else step(1); };
  ft.pp.addEventListener("click", press);
  nb.pp.addEventListener("click", press);
  ft.prev.addEventListener("click", () => step(-1));
  ft.next.addEventListener("click", () => step(1));
  ft.voice.addEventListener("click", () => {
    if (!now) return;
    const ids = Object.keys(now.t.v);
    cycleVoice(ids[(ids.indexOf(now.voice) + 1) % ids.length]);
  });
  function cycleVoice(id) {
    voicePref = id;
    store.set("lf-lore-voice", id);
    if (now && !now.t.sample && now.t.v[id] && id !== now.voice) start(now.t, id, { source: now.source, whole: now.whole, all: now.all });
    else { render(); listenLabel(); paint(); }
  }
  ft.report.addEventListener("click", () => {
    if (!now) return;
    openReport({ clip: now.t.cid, hash: now.t.hash, voice: now.voice, title: now.t.title, voiceName: voiceName(now.t, now.voice) });
  });
  onReportable.push(() => {
    if (!now) return;
    ft.report.hidden = !reportable || Boolean(now.t.sample);
    showCount(ft.open, now.t.sample ? "" : now.t.cid);
  });
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
      navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
    } catch (e) { /* not every browser has these */ }
  }
  nb.auto.checked = store.get("lf-lore-auto") === "1";
  nb.auto.addEventListener("change", () => { store.set("lf-lore-auto", nb.auto.checked ? "1" : "0"); paint(); });

  // ---- The left page: what a page of the book does once it's in (and each time another one is put in) ----
  let currentKey = "", currentPath = location.pathname, countText = $("[data-count]")?.textContent || "";
  const speedMark = () => pageBox.querySelectorAll(".lp-speed button").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.rate) === rate)));
  listeners.rate.push(speedMark);

  function listenLabel() {
    const nv = $(".lp-nv", pageBox);
    const first = pageTracks()[0];
    if (nv && first) { const v = voiceOf(first); nv.textContent = v ? ` · ${voiceName(first, v)}` : ""; }
  }

  // Your page (LOR-809): signed in, when your journey first names this page ("Reached Westfall on Oct 2, 2026, at level 12",
  // GET /api/profile/page); signed out, an invitation to sign in. The page itself is the same for everyone (cached at the
  // edge), so this line is filled in here. Whether you're signed in: the header's last answer (lf-auth, public/header.js);
  // only then is the account asked.
  const signedIn = () => {
    let auth = null;
    try { auth = JSON.parse(store.get("lf-auth") || "null"); } catch (e) { auth = null; }
    return Boolean(auth && auth.in);
  };
  function yourLine() {
    const mine = $(".lp-mine", pageBox);
    if (!mine) return;
    const say = (lead, rest, link) => {
      mine.textContent = "";
      const b = document.createElement("b");
      b.textContent = lead;
      mine.append(b, ` ${rest}`);
      if (link) {
        const a = document.createElement("a");
        a.href = link[1];
        a.textContent = link[0];
        mine.append(" ", a);
      }
      mine.hidden = false;
    };
    const visitor = () => say("Is this page in your book?", "Sign in to see when you found it.", ["Sign in", "/account"]);
    if (!signedIn()) { visitor(); return; }
    const path = currentPath.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/lore\/)/, "");
    fetch(`/api/profile/page?p=${encodeURIComponent(path)}`, { cache: "no-store" })
      .then(r => (r.status === 401 ? null : r.json()))
      .then(d => {
        if (!mine.isConnected) return;
        if (!d) { visitor(); return; }
        if (!d.ok) return;
        if (d.profile === false) { say("Is this page in your book?", "Make your profile to see when you found it.", ["Make your profile", "/account"]); return; }
        const p = d.page;
        if (!p) return;   // not in your journey yet: the line stays hidden
        const when = [p.day ? `on ${p.day}` : "", p.level ? `at level ${p.level}` : ""].filter(Boolean).join(", ");
        const verb = p.verb === "Slain by" ? "was slain by" : p.verb.toLowerCase();
        say("Your page:", `${d.name} ${verb} ${p.thing}${when ? ` ${when}` : ""}.`);
      })
      .catch(() => {});
  }

  function bindPage() {
    const art = pageBox.querySelector(".lp");
    currentKey = art ? art.dataset.key : "";
    const whole = $(".lp-whole", pageBox);
    if (whole) whole.hidden = false;
    const speed = $(".lp-speed", pageBox);
    if (speed) { speed.hidden = false; speedMark(); }
    listenLabel();
    yourLine();
    probe(pageTracks().map(t => t.cid));
    paintReports();
    paint();
  }

  // The page's own buttons (delegated: the page is replaced as the reader moves).
  pageBox.addEventListener("click", e => {
    const b = e.target.closest(".lp-btn");
    if (b) {
      e.preventDefault();
      const t = pageTracks().find(x => x.cid === b.closest(".lp-clip")?.dataset.clip);
      if (!t) return;
      voicePref = b.dataset.voice;
      store.set("lf-lore-voice", voicePref);
      toggle(t, b.dataset.voice);
      return;
    }
    if (e.target.closest(".lp-all")) {
      const art = pageBox.querySelector(".lp");
      if (now && now.source === "page" && now.whole && art && art.dataset.key === now.t.key) { toggle(now.t, now.voice); return; }
      const first = pageTracks()[0];
      if (first) { tally("lore-whole"); start(first, null, { source: "page", whole: true }); }
      return;
    }
    const sp = e.target.closest(".lp-speed button");
    if (sp) { setRate(Number(sp.dataset.rate)); return; }
    const s = e.target.closest(".rl-s");
    if (s && now) { const box = sectionOf(now.t.cid); if (box && box.contains(s)) seekTo(box, s); }
    const rep = e.target.closest(".lp-rep");
    if (rep) {
      const section = rep.closest(".lp-clip");
      const t = pageTracks().find(x => x.cid === section?.dataset.clip);
      if (!t) return;
      const vid = voiceUsed.get(t.cid) || Object.keys(t.v)[0];
      openReport({ clip: t.cid, hash: t.hash, voice: vid, voiceName: voiceName(t, vid), title: section.querySelector("h2, h3")?.textContent || "" });
    }
  });

  // ---- Moving through the book: a click on a lore link or a row puts that address's page on the left (history.pushState) ----
  const LORE_LINK = /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/lore(?:\/(?!data\/)[a-z]+\/[a-z0-9-]+)?\/?$/;
  const langOfPath = p => (/^\/([a-z]{2}(?:-[a-z]{2})?)\/lore(?:\/|$)/.exec(p) || [])[1] || "en";
  const langBox = shelf.querySelector("select[name=l]");
  const langLabel = seg => [...(langBox ? langBox.options : [])].find(o => o.value === seg)?.textContent || seg;
  let navToken = 0;
  const NOTE = "lp-langnote";

  function setHead(doc) {
    document.title = doc.title;
    document.documentElement.lang = doc.documentElement.lang || "en";
    for (const [sel, attr] of [['meta[name="description"]', "content"], ['link[rel="canonical"]', "href"], ['meta[name="robots"]', "content"],
      ['meta[property="og:title"]', "content"], ['meta[property="og:description"]', "content"], ['meta[property="og:url"]', "content"]]) {
      const from = doc.querySelector(sel), to = document.querySelector(sel);
      if (from && to) to.setAttribute(attr, from.getAttribute(attr));
      else if (from) document.head.append(from.cloneNode());
      else if (to) to.remove();
    }
    // The trail under the header: Lore › zone › entry (the front page has none).
    const header = document.querySelector("header.top"), have = header && header.querySelector(".subcrumb"), want = doc.querySelector("header.top .subcrumb");
    if (header) {
      if (want && have) have.innerHTML = want.innerHTML;
      else if (want) header.append(want.cloneNode(true));
      else if (have) have.remove();
    }
  }

  // Fetches the page at href and puts its left page in. Anything unexpected (offline, an error page, a page that isn't a book)
  // is a plain page load instead.
  async function openPage(href, o = {}) {
    const u = new URL(href, location.href);
    const token = ++navToken;
    book.classList.add("bk-busy");
    let doc, final;
    try {
      const res = await fetch(u.pathname + u.search, { credentials: "same-origin" });
      if (token !== navToken) return;
      if (!res.ok || !(res.headers.get("Content-Type") || "").includes("text/html")) throw new Error("not a page");
      final = new URL(res.url);
      doc = new DOMParser().parseFromString(await res.text(), "text/html");
      if (token !== navToken) return;
      if (!doc.querySelector("[data-book] #lore-page")) throw new Error("not a book");
    } catch (e) {
      if (token === navToken) location.href = u.href;
      return;
    }
    book.classList.remove("bk-busy");
    pageBox.innerHTML = doc.querySelector("#lore-page").innerHTML;
    book.querySelector(".bk-title").innerHTML = doc.querySelector(".bk-title").innerHTML;
    const c = $("[data-count]");
    if (c && countText) c.textContent = countText;
    setHead(doc);
    const pathname = final.pathname;
    book.dataset.lang = langOfPath(pathname);
    if (o.push !== false && (pathname !== location.pathname || final.search !== location.search)) {
      history.pushState({ lore: 1 }, "", pathname + final.search + u.hash);
    }
    currentPath = pathname;
    // A page in another language puts the select there; a page that asked for one and fell back to English (it has no
    // translation yet) says so.
    const seg = langOfPath(pathname), asked = langOfPath(u.pathname), before = state.lang;
    if (/\/lore\/[a-z]+\//.test(pathname)) {
      if (asked !== "en" && seg === "en") {
        state.lang = asked;
        const art = pageBox.querySelector(".lp");
        if (art) art.querySelector(".lp-where")?.before(el("p", NOTE, `Not in ${langLabel(asked)} yet; showing English.`));
      } else state.lang = seg;
    }
    syncLang();
    if (o.push === false && !/\/lore\/[a-z]+\//.test(pathname)) syncFromUrl();
    bindPage();
    if (state.lang !== before && rows.length) apply(); else mark();
    if (u.hash && document.getElementById(u.hash.slice(1))) document.getElementById(u.hash.slice(1)).scrollIntoView({ block: "start" });
    else {
      const top = pageBox.getBoundingClientRect().top;
      if (top < 8) window.scrollTo({ top: window.scrollY + top - 12 });
    }
    const h = pageBox.querySelector("h1");
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    if (o.play) {
      const first = pageTracks()[0];
      if (first) start(first, null, { source: "page", whole: true });
    }
  }
  book.addEventListener("click", e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a[href]");
    if (!a || !book.contains(a) || a.target || a.hasAttribute("download") || a.classList.contains("lp-btn")) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || !LORE_LINK.test(u.pathname)) return;
    if (u.pathname === location.pathname && u.hash) return;   // an anchor on this page
    e.preventDefault();
    openPage(u.pathname + u.search + u.hash);
  });
  window.addEventListener("popstate", () => {
    if (location.pathname === currentPath) return;
    if (!LORE_LINK.test(location.pathname)) { location.reload(); return; }
    openPage(location.pathname + location.search + location.hash, { push: false });
  });

  // Arrived from the page before with "Next plays on" (an older link): go on with this page.
  if (new URLSearchParams(location.search).get("play") === "1" && pageTracks().length) {
    history.replaceState(null, "", location.pathname + location.hash);
    start(pageTracks()[0], null, { source: "page", whole: true });
  }

  // ---- The right page: the playlist ----
  const ZONE_TYPES = [["city", "Capitals"], ["zone", "Zones"], ["dungeon", "Dungeons"]];
  const KIND_LABEL = { zone: "Zone", dungeon: "Dungeon", subzone: "Place", npc: "Character", boss: "Boss", quest: "Quest", item: "Item", topic: "Topic" };
  const PAGE = 100;
  const keyOf = path => {
    const [, kind, id] = path.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/lore\/)/, "").split("/").slice(1);
    return kind === "quest" ? `quest:${id.split("-")[0]}` : `${kind}:${id}`;
  };
  const stem = cid => {
    const d = /^quest:(\d+)#(detail|progress|complete)$/.exec(cid);
    if (d) return `quest_${d[1]}__${d[2]}`;
    const [base, faq] = cid.split("#faq");
    return base.replace(/[^\w-]/g, "_") + (faq ? `__faq${faq}` : "");
  };
  const fold = s => String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

  const bar = $(".lx-bar", shelf), list = $(".lx-list", shelf), more = $(".lx-more", shelf);
  const count = $(".lx-count", shelf);
  let rows = [], shown = [], limit = PAGE, sel = -1, zoneName = {};
  let liveKeys = new Set(), pathOf = {}, sampleRow = null, anyPlayable = false, found = null;
  const note = $(".lx-packnote", shelf);
  const state = { q: "", z: "", k: "", s: "zone", p: "", playable: false, mine: false, lang: langOfPath(location.pathname) };
  const readParams = () => {
    const q = new URLSearchParams(location.search);
    Object.assign(state, { q: q.get("q") || "", z: q.get("z") || "", k: q.get("k") || "", s: ["zone", "az", "rec"].includes(q.get("s")) ? q.get("s") : "zone",
      p: q.get("p") || "", playable: q.get("playable") === "1", mine: q.get("mine") === "1" });
  };
  readParams();
  if (state.lang === "en" && !/\/lore\/[a-z]+\//.test(location.pathname)) {
    const kept = store.get("lf-lore-lang");
    if (kept && langBox && [...langBox.options].some(o => o.value === kept)) state.lang = kept;
  }
  // The download filter (LOR-437): the pages a pack has a recording of, from /data/pack-entries.json, read the first
  // time a pack is picked. null until then (or if it doesn't load: the filter then shows everything).
  let packData = null, packKeys = null;
  function loadPack() {
    if (!state.p) { packKeys = null; return Promise.resolve(); }
    packData = packData || fetch("/data/pack-entries.json").then(r => r.json()).catch(() => ({}));
    return packData.then(data => {
      const i = (data.packs || []).indexOf(state.p);
      packKeys = i < 0 ? null : new Set(Object.keys(data.entries || {}).filter(k => data.entries[k].includes(i)));
    });
  }

  // index.json: the pages with a recording; more.json: the pages that are only text (site_lore.py). One row a page, merged
  // back into browsing order: zone, kind, name. A row plays the page's first recording; its text also holds the questions the
  // page answers, so searching one finds the page.
  Promise.all([
    fetch("/lore/data/index.json").then(r => r.json()),
    fetch("/lore/data/more.json").then(r => r.json()).catch(() => ({ pages: [] })),
    fetch("/api/narration/live").then(r => (r.ok ? r.json() : { keys: [] })).catch(() => ({ keys: [] })),
  ]).then(([index, moreData, liveData]) => {
    const live = liveKeys = new Set(liveData.keys || []);
    voices = index.voices || [];
    const kinds = index.kinds || [];
    (index.zones || []).forEach(z => { zoneName[z.key] = z.name; });
    const zoneRank = new Map((index.zones || []).map((z, i) => [z.key, i]));
    const kindRank = new Map(kinds.map((k, i) => [k.id, i]));
    const rank = (m, k) => (m.has(k) ? m.get(k) : 1e6);
    const pages = [...(index.pages || []), ...(moreData.pages || [])].sort((a, b) =>
      rank(zoneRank, a.z) - rank(zoneRank, b.z) || (a.z < b.z ? -1 : a.z > b.z ? 1 : 0)
      || rank(kindRank, a.k) - rank(kindRank, b.k) || (a.n.toLowerCase() < b.n.toLowerCase() ? -1 : a.n.toLowerCase() > b.n.toLowerCase() ? 1 : 0)
      || (a.p < b.p ? -1 : 1));
    for (const p of pages) {
      const key = keyOf(p.p);
      pathOf[key] = p.p;
      const row = { key, path: p.p, cid: key, hash: "", kind: p.k, z: p.z, title: p.n, sub: "", href: p.p, v: {}, text: true,
        find: fold(`${p.n} ${zoneName[p.z] || ""}`) };
      for (const [part, hash, refs, q] of p.c || []) {
        const cid = part ? `${key}#${part}` : key;
        if (q) row.find += " " + fold(q);
        if (!row.text) continue;
        const v = {};
        voices.forEach((voice, j) => {
          const r = refs[j];
          if (!r) return;
          const k = `${voice.id}/${stem(cid)}-${r[0]}.${r[2] || "mp3"}`;
          if (live.has(k)) v[voice.id] = { src: `/audio/clip/${k}`, sec: r[1] };
        });
        if (Object.keys(v).length) Object.assign(row, { cid, hash, v, text: false });   // the page's first recording that plays here
      }
      row.sub = [KIND_LABEL[p.k] || "", zoneName[p.z] || ""].filter(s => s && s !== p.n).join(" · ");
      rows.push(row);
    }
    anyPlayable = rows.some(r => Object.keys(r.v).length);
    if (!anyPlayable) { $(".lx-soon", shelf).hidden = false; state.playable = false; }
    // Opened at an entry (and no zone in the address): the list starts on that entry's zone, so the page being read is in it.
    const here = currentKey && rows.find(r => r.key === currentKey);
    if (here && !state.z && (index.zones || []).some(z => z.key === here.z)) state.z = here.z;
    buildBar(index, kinds);
    $(".lx-keys", shelf).hidden = false;
    const langs = langBox ? langBox.options.length : 1;
    countText = `${pages.length.toLocaleString("en-US")} pages${langs > 1 ? ` · ${langs} languages` : ""}`;
    const c = $("[data-count]");
    if (c) c.textContent = countText;
    (state.p ? loadPack() : Promise.resolve()).then(() => { apply(); bar.hidden = false; showCurrent(); });
    listenLabel();
    probe();
    loadFound();
  }).catch(() => { count.textContent = "The list didn't load. Use the zones on the first page instead."; bar.hidden = false; });

  // The pages your journey names (GET /api/profile/found): signed in with a profile, a row you found gets a tick and the
  // rest dim. Signed out, or without a profile, nothing changes.
  function loadFound() {
    if (!signedIn()) return;
    fetch("/api/profile/found", { cache: "no-store" }).then(r => (r.status === 401 ? null : r.json())).then(d => {
      if (!d || !d.ok || d.profile === false) return;
      found = new Set(d.pages || []);
      bar.elements.namedItem("mine").closest("label").hidden = false;
      apply();
    }).catch(() => {});
  }

  const ctl = name => bar.elements.namedItem(name);

  function buildBar(index, kinds) {
    bar.addEventListener("submit", e => e.preventDefault());   // the list filters as you type; Enter doesn't reload
    ctl("q").value = state.q;
    const zoneSel = ctl("z");
    for (const [type, label] of [...ZONE_TYPES, ["", "Elsewhere"]]) {
      const zs = (index.zones || []).filter(z => (type ? z.type === type : !ZONE_TYPES.some(([t]) => t === z.type)));
      if (!zs.length) continue;
      const g = el("optgroup");
      g.label = label;
      zs.forEach(z => { const o = el("option", "", z.name); o.value = z.key; g.append(o); });
      zoneSel.append(g);
    }
    kinds.forEach(k => { const o = el("option", "", k.label); o.value = k.id; ctl("k").append(o); });
    syncControls();
    let timer;
    ctl("q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { state.q = ctl("q").value; apply(); }, 150); });
    for (const [name, field] of [["z", "z"], ["k", "k"], ["s", "s"]]) ctl(name).addEventListener("change", () => { state[field] = ctl(name).value; apply(); });
    if (ctl("p")) ctl("p").addEventListener("change", () => { state.p = ctl("p").value; sampleRow = null; loadPack().then(apply); });
    ctl("playable").closest("label").hidden = !anyPlayable;
    ctl("playable").addEventListener("change", () => { state.playable = ctl("playable").checked; apply(); });
    ctl("mine").addEventListener("change", () => { state.mine = ctl("mine").checked; apply(); });
    if (langBox) langBox.addEventListener("change", () => {
      state.lang = langBox.value;
      store.set("lf-lore-lang", state.lang);
      apply();
      const art = pageBox.querySelector(".lp");
      // The page being read follows the language when it has one (a page without one reads in English, with a note).
      if (art && art.dataset.key) openPage(state.lang === "en" ? art.dataset.en : `/${state.lang}${art.dataset.en}`);
    });
    $(".lx-all", shelf).addEventListener("click", playAll);
  }
  function syncControls() {
    ctl("q").value = state.q;
    ctl("z").value = state.z;
    ctl("k").value = state.k;
    ctl("s").value = state.s;
    if (ctl("p")) { if (![...ctl("p").options].some(o => o.value === state.p)) state.p = ""; ctl("p").value = state.p; }
    ctl("playable").checked = state.playable;
    ctl("mine").checked = state.mine;
    syncLang();
  }
  function syncLang() { if (langBox) langBox.value = state.lang; }
  // Back to /lore?q=... from an entry: the filters in the address come back.
  function syncFromUrl() { readParams(); if (bar.elements.length && rows.length) { syncControls(); (state.p ? loadPack() : Promise.resolve()).then(apply); } }

  const rowHref = r => (state.lang === "en" ? r.path : `/${state.lang}${r.path}`);
  const isIndex = () => !/\/lore\/[a-z]+\//.test(location.pathname);

  function apply() {
    const words = fold(state.q).split(/\s+/).filter(Boolean);
    shown = rows.filter(r => (!state.z || r.z === state.z) && (!state.k || r.kind === state.k)
      && (!state.playable || (pickOf() && !packVoice()) || voiceOf(r))
      && (!state.mine || !found || found.has(r.path))
      && (!packKeys || packKeys.has(r.key))
      && words.every(w => r.find.includes(w)));
    if (state.s === "az") shown = [...shown].sort((a, b) => a.title.localeCompare(b.title));
    if (state.s === "rec") shown = shown.map((r, i) => [r, i, voiceOf(r) ? 0 : 1]).sort((a, b) => a[2] - b[2] || a[1] - b[1]).map(x => x[0]);
    limit = PAGE;
    sel = -1;
    showNote();
    render();
    paint();
    if (isIndex()) {   // /lore keeps its filters in the address; an entry's address stays its own
      const q = new URLSearchParams();
      for (const k of ["q", "z", "k", "p"]) if (state[k]) q.set(k, state[k]);
      if (state.s !== "zone") q.set("s", state.s);
      if (state.playable) q.set("playable", "1");
      if (state.mine) q.set("mine", "1");
      history.replaceState(history.state, "", location.pathname + (q.toString() ? `?${q}` : "") + location.hash);
    }
  }

  // The picked download (the pack filter's option, lib/packs.js packPlays): an English narrator's pack plays its
  // narrator in the list (data-voice), on the rows that have it; any other plays nothing there, since its recordings
  // aren't in the list (never the English one in its place). .lx-packnote says what plays, and when the list plays
  // none of the pack, what language it plays in, in the add-on, with its sample.
  const pickOf = () => {
    const o = state.p && ctl("p") ? ctl("p").selectedOptions[0] : null;
    return o && o.value === state.p ? o : null;
  };
  const packVoice = () => {
    const v = pickOf()?.dataset.voice;
    return v && voices.some(x => x.id === v) ? v : "";
  };
  // The voice a track plays in, or "" when it plays none here. Only the English narrators are in the list: in another
  // language nothing plays (never English audio under another language's text), except a pack's own sample.
  function voiceOf(t) {
    if (!t) return "";
    if (t.sample) return "sample";
    if (t.page) return t.v[voicePref] ? voicePref : Object.keys(t.v)[0] || "";
    if (state.lang !== "en") return "";
    if (pickOf()) { const v = packVoice(); return v && t.v[v] ? v : ""; }
    return t.v[voicePref] ? voicePref : Object.keys(t.v)[0] || "";
  }
  const playableRows = () => shown.filter(r => voiceOf(r));

  function sampleOf(o) {
    const d = o.dataset;
    if (!d.sample || !liveKeys.has(d.sample)) return null;
    if (!sampleRow || sampleRow.pack !== o.value) {
      sampleRow = { sample: true, pack: o.value, cid: d.sampleKey || "", key: "", hash: "", title: d.sampleTitle || o.textContent,
        lang: d.sampleLang || "", sub: `${o.textContent} · sample`, href: pathOf[d.sampleKey] || d.href || "#",
        v: { sample: { src: `/audio/clip/${d.sample}`, sec: 0 } } };
    }
    return sampleRow;
  }

  function showNote() {
    const o = pickOf();
    note.hidden = !o;
    // A pick plays one voice (or none here): "Playable here", for a pack the list can't play, goes.
    const d = o?.dataset, v = packVoice();
    const inList = v && shown.some(r => r.v[v]);
    ctl("playable").closest("label").hidden = !anyPlayable || Boolean(o && !inList);
    const other = state.lang !== "en";
    langNote.hidden = !other;
    langNote.textContent = other ? `No ${langLabel(state.lang)} recording yet. Only native recordings play for other languages; the English narrators are on the English pages.` : "";
    $(".lx-all", shelf).disabled = other && !(o && sampleOf(o));
    if (!o) { note.replaceChildren(); return; }
    const what = inList ? " plays below in this pack's voice, as in the add-on."
      : d.lang ? ` plays in ${d.lang} in the add-on.` : v ? " plays in the add-on." : " plays in the add-on, in its own voices.";
    const parts = [el("strong", "", o.textContent), what];
    if (!inList) {
      const r = sampleOf(o);
      if (r) {
        const b = el("button", "btn-small lx-sample", "▶ Hear a sample");
        b.type = "button";
        if (r.lang) b.lang = r.lang;
        b.title = r.title;
        b.addEventListener("click", () => toggle(r));
        parts.push(" ", b);
      } else {
        parts.push(" ", el("span", "lx-nosample", "No sample yet."));
      }
    }
    if (d.href) {
      const a = el("a", "lx-get", "Get this pack");
      a.href = d.href;
      parts.push(" ", a);
    }
    note.replaceChildren(...parts);
    markSample();
  }
  function markSample() {
    const b = note.querySelector(".lx-sample");
    if (b) b.textContent = sampleRow && now && now.t === sampleRow && !audio.paused ? "❚❚ Pause sample" : "▶ Hear a sample";
  }

  function render() {
    const mine = found ? shown.filter(r => found.has(r.path)).length : 0;
    count.textContent = `${shown.length.toLocaleString("en-US")} ${shown.length === 1 ? "page" : "pages"}${found ? ` · ${mine.toLocaleString("en-US")} in your book` : ""}`;
    const byZone = state.s === "zone";
    const head = {};
    if (byZone) for (const r of shown) { const h = head[r.z] || (head[r.z] = { n: 0, f: 0 }); h.n++; if (found && found.has(r.path)) h.f++; }
    const out = [];
    let box = null, last = null;
    shown.slice(0, limit).forEach((r, i) => {
      if (!box || (byZone && r.z !== last)) {
        const grp = el("section", "lx-grp");
        if (byZone) {
          const h = el("h3", "lx-zh", zoneName[r.z] || "Elsewhere");
          const h0 = head[r.z];
          h.append(el("small", "", `${h0.n.toLocaleString("en-US")} ${h0.n === 1 ? "page" : "pages"}${found ? ` · ${h0.f} found` : ""}`));
          grp.append(h);
        }
        box = el("div", "lx-rows");
        box.setAttribute("role", "list");
        grp.append(box);
        out.push(grp);
        last = r.z;
      }
      box.append(rowEl(r, i));
    });
    list.replaceChildren(...out);
    more.hidden = shown.length <= limit;
    mark();
  }
  // Scrolls the playlist (not the page) to the row of the page being read.
  function showCurrent() {
    const r = rows.find(x => x.key === currentKey), i = r ? shown.indexOf(r) : -1;
    if (i < 0) return;
    while (i >= limit) { limit += PAGE; render(); }
    const box = shelf.querySelector(".pg-in"), row = list.querySelector(`.lx-row[data-i="${i}"]`);
    if (box && row && box.scrollHeight > box.clientHeight) box.scrollTop = Math.max(0, row.offsetTop - 150);
  }
  function rowEl(r, i) {
    const row = el("div", "lx-row");
    row.setAttribute("role", "listitem");
    row.dataset.i = i;
    const vid = voiceOf(r);
    if (vid) {
      const b = el("button", "lx-play");
      b.type = "button";
      b.innerHTML = "&#9654;";
      b.setAttribute("aria-label", `Play ${r.title}`);
      b.addEventListener("click", e => { e.stopPropagation(); sel = i; if (now && now.t.cid === r.cid) toggle(r); else start(r, null, { source: "row" }); });
      row.append(b);
    } else {
      const d = el("span", "lx-none", "–");
      d.setAttribute("aria-hidden", "true");
      d.title = state.lang !== "en" ? `No ${langLabel(state.lang)} recording yet` : r.text ? "Text only" : "No recording here yet";
      row.append(d);
    }
    row.append(svgIcon(KIND_ICON[r.kind] || "book"));
    const main = el("div", "lx-main");
    const a = el("a", "lx-name", r.title);
    a.href = rowHref(r);
    main.append(a);
    if (found && found.has(r.path)) { const t = el("span", "lx-tick", "✓"); t.title = "In your book"; main.append(t); }
    row.append(main);
    const bits = [KIND_LABEL[r.kind] || "", vid ? fmt(r.v[vid].sec) : "", state.s !== "zone" ? zoneName[r.z] || "" : ""].filter(Boolean);
    row.append(el("small", "lx-meta", bits.join(" · ")));
    if (found) row.classList.add(found.has(r.path) ? "lx-found" : "lx-dim");
    return row;
  }
  more.addEventListener("click", () => { limit += PAGE; render(); });
  // A click anywhere on a row that isn't its button or link opens it.
  list.addEventListener("click", e => {
    const row = e.target.closest(".lx-row");
    if (!row || e.target.closest("button, a")) return;
    const r = shown[Number(row.dataset.i)];
    if (r) { sel = Number(row.dataset.i); mark(); openPage(rowHref(r)); }
  });

  function playAll() {
    const o = pickOf();
    const rowsToPlay = playableRows();
    if (rowsToPlay.length) { tally("lore-whole"); start(rowsToPlay[0], null, { source: "row", all: true }); reveal(rowsToPlay[0]); return; }
    const s = o && sampleOf(o);
    if (s) toggle(s);
  }

  // ---- Keys ----
  document.addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey || (dlg && dlg.open)) return;
    if (e.key === "Escape" && e.target === ctl("q")) { ctl("q").blur(); return; }
    if (typing(e) || pressing(e)) return;
    if (e.key === "/") { e.preventDefault(); ctl("q").focus(); return; }
    if (e.key === "j" || e.key === "k") {
      const max = Math.min(shown.length, limit) - 1;
      if (max < 0) return;
      sel = Math.min(max, Math.max(0, sel + (e.key === "j" ? 1 : -1)));
      if (e.key === "j" && sel === max && shown.length > limit) { limit += PAGE; render(); }
      mark();
      list.querySelector(`.lx-row[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === " ") {
      e.preventDefault();
      if (now && !(sel >= 0 && shown[sel] && shown[sel].cid !== now.t.cid)) { toggle(now.t, now.voice); return; }
      const r = shown[sel];
      if (r && voiceOf(r)) { start(r, null, { source: "row" }); return; }
      const first = pageTracks()[0];
      if (first) start(first, null, { source: "page", whole: true });
    } else if (e.key === "Enter" && shown[sel]) {
      openPage(rowHref(shown[sel]));
    } else if (e.key === "s") {
      nextRate();
    } else if (e.key === "v" && voices.length > 1 && !pickOf()) {
      const ids = voices.map(v => v.id);
      cycleVoice(ids[(ids.indexOf(voicePref) + 1) % ids.length]);
    }
  });

  bindPage();
})();
