// The home page's book (index.html, home.css .hb-*): the add-on's Chronicle on the web, read from a real player's public
// profile, Húrin's (GET /api/home-book, lib/home-book.js), so the book stays as true as his own page. Its four bookmarks
// are the add-on's, in its order: Here (a place's story with Listen, and the add-on's own questions and answers there),
// Found (the pages he found, zone by zone, with his pictures), Road (his chapters) and Storylines (the storylines his
// quests are part of). If the book can't be read, the page keeps the short note it was written with.
// Text only (textContent or esc), never HTML from the data; links and images only to this site's own paths.
(() => {
  const root = document.getElementById("hb-book");
  if (!root) return;

  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = n => Number(n || 0).toLocaleString("en-US");
  const own = (u, prefix) => (typeof u === "string" && u.startsWith(prefix) && !u.startsWith("//") ? u : "");
  const mmss = s => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
  const svg = d => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${d}</svg>`;
  // The Chronicle's tiles, as the add-on draws them: a pin for a place, a figure for someone, a coin for a quest.
  const IC = {
    place: svg('<path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z" fill-rule="evenodd"/>'),
    person: svg('<circle cx="12" cy="7" r="4"/><path d="M4.5 22c.4-5.6 3.4-8.6 7.5-8.6s7.1 3 7.5 8.6z"/>'),
    boss: svg('<path d="M12 2c4.4 0 8 3.3 8 7.6 0 2.6-1.3 4.6-3 5.8V19h-3v-2h-1v2h-2v-2h-1v2H7v-3.6c-1.7-1.2-3-3.2-3-5.8C4 5.3 7.6 2 12 2zm-3.5 7a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6zm7 0a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6z"/>'),
    quest: svg('<circle cx="12" cy="12" r="9.5"/><path d="M11 6.5h2.2l-.4 7.5h-1.4zM12 15.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z" fill="#fff6d8"/>'),
    item: svg('<path d="M9 3h6l-1 3h-4z"/><path d="M8 7h8c3 3 4 6 4 9 0 3-3 5-8 5s-8-2-8-5c0-3 1-6 4-9z"/>'),
    book: svg('<path d="M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zm16 0h-5a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h5z"/>'),
    ask: svg('<path d="M4 4h16v12H9l-5 4z"/>'),
    play: svg('<path d="M8 5v14l11-7z"/>'),
  };
  IC.zone = IC.place;

  // ---------- the player: the Here page's story, the site's own recording ----------
  const aud = new Audio();
  aud.preload = "none";
  const P = { parts: [], secs: [], at: 0, started: false, who: "", name: "" };
  const total = () => P.secs.reduce((a, b) => a + b, 0);
  const playing = () => P.started && !aud.paused && !aud.ended;
  function load(i) {
    P.at = Math.max(0, Math.min(P.parts.length - 1, i));
    P.started = true;
    aud.src = P.parts[P.at];
    aud.play().catch(() => paintPlayer());
  }
  function toggle() {
    if (!P.parts.length) return;
    if (!P.started) load(0);
    else if (aud.paused) aud.play().catch(() => paintPlayer());
    else aud.pause();
  }
  function step(by) {
    if (!P.started) return load(0);
    if (by < 0 && aud.currentTime > 3) { aud.currentTime = 0; return; }
    const to = P.at + by;
    if (to < 0) { aud.currentTime = 0; return; }
    if (to >= P.parts.length) { stop(); return; }
    load(to);
  }
  function stop() {
    aud.pause();
    aud.removeAttribute("src");
    P.started = false;
    P.at = 0;
    paintPlayer();
  }
  aud.addEventListener("ended", () => { if (P.at + 1 < P.parts.length) load(P.at + 1); else stop(); });
  for (const e of ["play", "pause", "timeupdate", "loadedmetadata", "error"]) aud.addEventListener(e, () => paintPlayer());
  function progress() {
    const t = total();
    if (!P.started || !t) return 0;
    const done = P.secs.slice(0, P.at).reduce((a, b) => a + b, 0) + (Number.isFinite(aud.currentTime) ? aud.currentTime : 0);
    return Math.min(100, (done / t) * 100);
  }
  function paintPlayer() {
    const on = playing();
    for (const b of root.querySelectorAll(".hb-listen")) {
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
      b.querySelector(".ic").textContent = on ? "❚❚" : "▶";
      b.querySelector("[data-lbl]").textContent = on ? "Playing" : "Listen";
    }
    const main = root.querySelector("[data-main]");
    if (main) { main.textContent = on ? "❚❚" : "▶"; main.setAttribute("aria-label", on ? "Pause" : "Play"); }
    const now = root.querySelector("[data-now]");
    if (now) now.textContent = P.started ? `${P.name}${aud.paused ? " · paused" : ""}` : "Nothing playing";
    const bar = root.querySelector("[data-bar]");
    if (bar) bar.style.width = progress() + "%";
  }

  // ---------- the book ----------
  fetch("/api/home-book", { headers: { Accept: "application/json" } })
    .then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(data => { if (data?.ok && Array.isArray(data.chapters)) open(data); });

  function open(D) {
    const who = D.name || "Húrin";
    const H = D.here || { asks: [], story: [] };
    const zones = D.found?.zones || [];
    const lines = D.storylines || [];
    const chapters = D.chapters;
    const voice = own(H.voice?.url, "/audio/clip/");
    if (voice) {
      P.parts = [voice];
      P.secs = [Number(H.voice.sec) || 0];
      P.who = H.voice.who || "narrator";
      P.name = `The story of ${H.name}`;
    }
    // asked: the questions asked on the Here page, in order (the add-on's first one is asked already, as an example).
    const st = { view: "here", asked: H.asks.length ? [0] : [], zone: 0, pic: -1, ch: chapters[0]?.n, line: 0 };
    const chap = n => chapters.find(c => c.n === n);
    const listen = () => (P.parts.length ? `<button type="button" class="hb-listen" data-play aria-pressed="false" aria-label="Listen to the story of ${esc(H.name)}"><span class="ic" aria-hidden="true">▶</span><span data-lbl>Listen</span> <small>· ${esc(P.who)} ${mmss(total())}</small></button>` : "");
    const link = (x, inner, cls) => (own(x.href, "/") ? `<a class="${cls}" href="${esc(x.href)}" title="${esc(x.name)}">${inner}</a>` : `<span class="${cls}" title="${esc(x.name)}">${inner}</span>`);
    const card = x => link(x, `${IC[x.k] || IC.place}<span>${esc(x.name)}</span>`, "hb-card");
    const tile = (x, kind) => link(x, `<i class="hb-tok ${kind}">${IC[x.k] || IC.place}</i><span>${esc(x.name)}</span>`, "hb-tile");
    const blank = kind => `<span class="hb-tile dim" aria-hidden="true"><i class="hb-tok ${kind}">${IC[kind === "places" ? "place" : kind === "people" ? "person" : kind === "quests" ? "quest" : "item"]}</i><span>Not yet</span></span>`;
    // An answer in ink: its text, with the lore pages it names linked where they first come up.
    const inked = (text, links = []) => {
      const spots = links.map(l => ({ ...l, at: text.indexOf(l.name) })).filter(l => l.at >= 0 && own(l.href, "/lore/"))
        .sort((a, b) => a.at - b.at);
      let out = "", from = 0;
      for (const l of spots) {
        if (l.at < from) continue;
        out += esc(text.slice(from, l.at)) + `<a href="${esc(l.href)}">${esc(l.name)}</a>`;
        from = l.at + l.name.length;
      }
      return out + esc(text.slice(from));
    };
    const pic = (p, big) => {
      const url = own(p.url, "/pictures/");
      if (!url) return "";
      const alt = esc(p.caption || p.where || "A picture from the journey");
      return big ? `<figure class="hb-pic"><img src="${esc(url)}" width="${Number(p.w) || 1920}" height="${Number(p.h) || 1080}" alt="${alt}" loading="lazy" decoding="async"><figcaption>${esc([p.where, p.when].filter(Boolean).join(" · ") || "Taken on the way")}</figcaption></figure>` : "";
    };

    // Here: the add-on's list for where you stand (its story, then its questions), and the one picked on the right.
    const here = () => {
      const sc = D.stats || [];
      const left = `<div class="hb-plate-head"><span class="hb-crest" aria-hidden="true">${esc(D.initial || who[0])}</span><div><h4>${esc(who)}</h4>
          <div class="hb-sub" style="margin:0">${esc([D.sheet, D.side].filter(Boolean).join(" · "))}</div></div></div>
        ${sc.length ? `<div class="hb-stats sm">${sc.slice(0, 4).map(([n, l]) => `<span><b>${num(n)}</b>${esc(l)}</span>`).join("")}</div>` : ""}
        <h3 class="hb-here-h" tabindex="-1" data-focus>Here: ${esc(H.name)}</h3>
        <div class="hb-list">
          <button type="button" class="hb-row gold" data-here="story">${IC.play}<span>${esc(H.name)}</span></button>
          ${H.asks.map((a, i) => `<button type="button" class="hb-row${st.asked.includes(i) ? " on" : ""}" data-here="${i}">${IC.ask}<span>${esc(a.q)}</span></button>`).join("")}
        </div>
        <p class="hb-note">In the game, Here is wherever you stand: its story, and the questions people ask there.</p>`;
      // The right page, as the add-on's: the place's lore with Listen, then the conversation in ink, then what to ask next.
      const next = H.asks.map((a, i) => [a, i]).filter(([, i]) => !st.asked.includes(i));
      const right = `<div class="hb-crumb">${esc([H.label, "Here"].filter(Boolean).join(" · "))}</div><h4>${esc(H.name)}</h4>${listen()}
        <div class="hb-story">${(H.story || []).map(t => `<p>${esc(t)}</p>`).join("")}</div>
        <a class="hb-chip" href="${esc(own(H.page, "/lore/") || "/lore")}">${IC.book}Read ${esc(H.name)}'s page</a>
        ${st.asked.map(i => H.asks[i]).filter(Boolean).map((a, j) => `<div class="hb-asked" data-asked="${j}"><span>You asked</span>${esc(a.q)}</div>
          <p class="hb-answer">${inked(a.a, a.links)}</p>`).join("")}
        ${next.length ? `<div class="hb-kind">Suggested:</div><div class="hb-list">${next.map(([a, i]) => `<button type="button" class="hb-row" data-here="${i}">${IC.ask}<span>${esc(a.q)}</span></button>`).join("")}</div>` : ""}`;
      return [left, right];
    };

    // Found: a chapter for each zone, and its pages by kind, with the pictures he took there.
    const KINDS = [["places", "Places"], ["people", "People"], ["quests", "Quests"], ["items", "Items"]];
    const found = () => {
      const share = (n, of) => (of > n ? ` of ${num(of)}` : "");
      const left = `<h3 tabindex="-1" data-focus>Found</h3>
        <div class="hb-list">${zones.map((z, i) => `<button type="button" class="hb-row hb-ch${st.zone === i ? " on" : ""}" data-zone="${i}"><span>${esc(z.name)}</span><span class="hb-d">${num(z.n)}${z.of > z.n ? `/${num(z.of)}` : ""}</span><i class="hb-prog" aria-hidden="true"><b style="width:${Math.round(100 * z.n / Math.max(z.n, z.of || 0, 1))}%"></b></i></button>`).join("")}</div>
        <p class="hb-note">Click a chapter to see its pages. Every place, person, item and quest has a page in the book; the ones ${esc(who)} hasn't found stay blank, so nothing is spoiled.</p>`;
      const z = zones[st.zone];
      if (!z) return [left, `<p class="hb-sub">Your chronicle is still blank. Pages fill in as you travel, meet people, take quests and find things.</p>`];
      const pics = (z.pictures || []).filter(p => own(p.url, "/pictures/"));
      const shown = pics[st.pic];
      const right = `<h4>${esc(z.name)}</h4><div class="hb-crumb">${num(z.n)}${share(z.n, z.of)} pages found</div>
        ${shown ? pic(shown, true) : ""}
        ${KINDS.filter(([k]) => z[k]?.n).map(([k, label]) => `<div class="hb-kind">${label} · ${num(z[k].n)}${share(z[k].n, z[k].of)}</div><div class="hb-tiles">${z[k].list.map(x => tile(x, k)).join("")}${z[k].of > z[k].n ? blank(k) : ""}</div>`).join("")}
        ${pics.length ? `<div class="hb-kind">Pictures · ${num(pics.length)}</div><div class="hb-gallery">${pics.map((p, i) => `<button type="button" data-pic="${i}"${i === st.pic ? ' aria-current="true"' : ""}><img src="${esc(p.url)}" alt="${esc(p.caption || p.where || "A picture from the journey")}" loading="lazy" decoding="async">${esc(p.when || "")}</button>`).join("")}</div>` : ""}`;
      return [left, right];
    };

    // Road: his chapters, newest first; a chapter's pages on the right.
    const road = () => `<h3 tabindex="-1" data-focus>His road · ${plural(chapters.length, "chapter", "chapters")}</h3>${chapters.map(c => {
      const th = own(c.pictures?.[0]?.url, "/pictures/");
      return `<button type="button" class="hb-row${st.view === "chapter" && st.ch === c.n ? " on" : ""}" data-ch="${c.n}"><span class="hb-num">${c.n}</span><span>${esc(c.title)}</span>${th ? `<img class="hb-th" src="${esc(th)}" alt="" loading="lazy" decoding="async">` : ""}<span class="hb-d">${esc(c.when)}</span></button>`;
    }).join("")}`;
    const chapterPages = c => [`<button type="button" class="hb-back" data-v="road">Back</button><div class="hb-crumb">Chapter ${c.n} · ${esc(c.long)}</div><h4 tabindex="-1" data-focus>${esc(c.title)}</h4>
        ${c.route?.length > 1 ? `<div class="hb-route">${c.route.map(esc).join(" → ")}</div>` : ""}
        ${c.summary ? `<p class="hb-sum">${esc(c.summary)}</p>` : ""}
        ${c.facts?.length ? `<ul class="hb-facts">${c.facts.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
        ${(c.pictures || []).map(p => pic(p, true)).join("")}`,
      `<h3>Pages he found this chapter</h3>
        ${c.found?.length ? `<div class="hb-cards">${c.found.map(card).join("")}</div><p class="hb-sub" style="margin-top:8px">Each one has its page in the lore.</p>` : `<p class="hb-sub">Nothing new to find this chapter.</p>`}`];

    // Storylines: the ones he's on, the one he was on last first; a storyline's quests he has done on the right.
    const stories = () => {
      const left = `<h3 tabindex="-1" data-focus>Storylines</h3><p class="hb-sub">The storylines he's on. Click one to see its quests he's found.</p>
        <div class="hb-list">${lines.map((s, i) => `<button type="button" class="hb-row${st.line === i ? " on" : ""}" data-line="${i}"><span>${esc(s.name)}</span><span class="hb-d">${num(s.n)}</span></button>`).join("")}</div>`;
      const s = lines[st.line];
      if (!s) return [left, `<p class="hb-sub">No storylines yet. Take quests, and the storylines you're on are listed here.</p>`];
      return [left, `<h4>${esc(s.name)}</h4><div class="hb-crumb">Storyline${s.zone ? ` · ${esc(s.zone)}` : ""}</div>
        <div class="hb-kind">Quests · ${num(s.n)}${s.of > s.n ? ` of ${num(s.of)}` : ""}</div>
        <div class="hb-tiles">${s.quests.map(q => tile(q, "quests")).join("")}${s.of > s.n ? blank("quests") : ""}</div>
        <p class="hb-note">${s.of > s.n ? "A blank page is still out there: the storyline goes on past the quests he's done." : "Every page of it is found."}</p>`];
    };

    const pages = () => {
      if (st.view === "found") return found();
      if (st.view === "road") { const c = chap(st.ch) || chapters[0]; return [road(), c ? chapterPages(c)[1] : ""]; }
      if (st.view === "chapter") return chapterPages(chap(st.ch) || chapters[0]);
      if (st.view === "story") return stories();
      return here();
    };

    // The shell, once; the pages and bookmarks are painted again as it turns. The player strip stays as it is.
    root.innerHTML = `<div class="hb-bk">
      <div class="hb-plate">${esc(who)}'s Chronicle</div>
      <div class="hb-title"><span class="hb-icon">${IC.book}</span><span class="hb-where" data-where></span><span class="hb-who">${esc(D.sheet || "")}</span><span class="hb-sample">a real player's book</span></div>
      <div class="hb-body"><div class="hb-pg l" tabindex="0" role="region" aria-label="Left page" data-l></div><div class="hb-pg r" tabindex="0" role="region" aria-label="Right page" data-r></div>
        <nav class="hb-ribbons" aria-label="${esc(who)}'s Chronicle" data-ribbons></nav></div>
      ${P.parts.length ? `<div class="hb-foot"><button type="button" class="hb-fbtn hb-play-main" data-main aria-label="Play">▶</button>
        <div class="hb-now"><span data-now>Nothing playing</span><div class="hb-bar"><i data-bar></i></div></div></div>` : ""}
    </div>`;
    root.classList.add("ready");
    const els = { l: root.querySelector("[data-l]"), r: root.querySelector("[data-r]"), rib: root.querySelector("[data-ribbons]"), where: root.querySelector("[data-where]") };
    // The add-on's bookmarks, in its order and words (addon/LoreForever/UI.lua).
    const RIBS = [["here", "Here", true], ["found", "Found", zones.length > 0], ["road", "Road", chapters.length > 0], ["story", "Storylines", true]];
    const tabOf = v => (v === "chapter" ? "road" : v);

    function paint(focus) {
      const [L, R] = pages();
      els.l.innerHTML = L;
      els.r.innerHTML = R;
      els.l.scrollTop = 0;
      els.r.scrollTop = 0;
      els.where.textContent = {
        here: `Here: ${H.name}`, found: `Found · ${zones[st.zone]?.name || ""}`, road: `${who}'s road`,
        chapter: `Chapter ${st.ch} · ${chap(st.ch)?.title || ""}`, story: `Storylines · ${lines[st.line]?.name || ""}`,
      }[st.view];
      els.rib.innerHTML = RIBS.filter(r => r[2]).map(([key, label]) => {
        const on = tabOf(st.view) === key;
        return `<button type="button" class="hb-rib${on ? " on" : ""}" data-v="${key}"${on ? ' aria-current="page"' : ""}>${esc(label)}</button>`;
      }).join("");
      paintPlayer();
      // A phone reads the pages one over the other: a turn from far down the book starts at the top of it, and a pick
      // on the left page goes down to the right one, where it opened.
      if (focus === "right") {
        els.r.focus({ preventScroll: true });
        if (matchMedia("(max-width: 760px)").matches) els.r.scrollIntoView({ block: "start" });
        return;
      }
      if (focus && root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: "start" });
      if (focus === "ribbon") root.querySelector(`.hb-rib[data-v="${tabOf(st.view)}"]`)?.focus({ preventScroll: true });
      else if (focus === "page") els.l.querySelector("[data-focus]")?.focus({ preventScroll: true });
    }
    root.addEventListener("click", e => {
      const t = e.target.closest("button");
      if (!t) return;
      const d = t.dataset;
      if (d.play !== undefined || d.main !== undefined) return toggle();
      if (d.v) { st.view = d.v; st.pic = -1; return paint(t.classList.contains("hb-rib") ? "ribbon" : "page"); }
      if (d.here === "story") { paint("right"); els.r.scrollTop = 0; return; }
      if (d.here) {
        const i = Number(d.here);
        if (!st.asked.includes(i)) st.asked.push(i);
        paint("right");
        // The answer, where the conversation reaches it.
        const at = els.r.querySelector(`[data-asked="${st.asked.indexOf(i)}"]`);
        if (at) {
          if (matchMedia("(max-width: 760px)").matches) at.scrollIntoView({ block: "start" });
          else els.r.scrollTop = at.offsetTop - 12;   // (the page is the answer's offsetParent)
        }
        return;
      }
      if (d.zone) { st.zone = Number(d.zone); st.pic = -1; return paint("right"); }
      if (d.pic) { st.pic = Number(d.pic) === st.pic ? -1 : Number(d.pic); return paint("right"); }
      if (d.line) { st.line = Number(d.line); return paint("right"); }
      if (d.ch) { st.view = "chapter"; st.ch = Number(d.ch); return paint("page"); }
    });
    paint(false);
  }
})();
