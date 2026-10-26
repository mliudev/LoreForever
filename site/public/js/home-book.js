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
    // thread: the Here page's conversation in order, a question asked by its number (the add-on's first one is asked
    // already, as an example) and a story card told by its lore page's path. back: Found was opened from the
    // conversation (its "Its page in Found ›"), so Found shows the way back to it; hit is the page it opened on.
    const st = { view: "here", thread: H.asks.length ? [0] : [], zone: 0, pic: -1, ch: chapters[0]?.n, line: 0, q: "", kind: "all",
      back: false, hit: "", hereTop: 0, hereY: 0 };
    // The story cards a lore link in an answer tells, as the add-on's: the page's story from its lore data, read once.
    const cards = new Map();
    const chap = n => chapters.find(c => c.n === n);
    const listen = () => (P.parts.length ? `<button type="button" class="hb-listen" data-play aria-pressed="false" aria-label="Listen to the story of ${esc(H.name)}"><span class="ic" aria-hidden="true">▶</span><span data-lbl>Listen</span> <small>· ${esc(P.who)} ${mmss(total())}</small></button>` : "");
    const link = (x, inner, cls) => (own(x.href, "/") ? `<a class="${cls}" href="${esc(x.href)}" title="${esc(x.name)}">${inner}</a>` : `<span class="${cls}" title="${esc(x.name)}">${inner}</span>`);
    const card = x => link(x, `${IC[x.k] || IC.place}<span>${esc(x.name)}</span>`, "hb-card");
    const tile = (x, kind) => link(x, `<i class="hb-tok ${kind}">${IC[x.k] || IC.place}</i><span>${esc(x.name)}</span>`, `hb-tile${st.hit && x.href === st.hit ? " hit" : ""}`);
    // A storyline's quest, as the add-on's: its name the main line, where it was and that it's done small under it.
    const questRow = q => link(q, `<i class="hb-tok quests">${IC.quest}</i><span><b>${esc(q.name)}</b><small>${[q.zone, "Done"].filter(Boolean).map(esc).join(" · ")}</small></span>`, "hb-tile");
    const blank = kind => `<span class="hb-tile dim" aria-hidden="true"><i class="hb-tok ${kind}">${IC[kind === "places" ? "place" : kind === "people" ? "person" : kind === "quests" ? "quest" : "item"]}</i><span>Not yet</span></span>`;
    // An answer in ink: its text, with the lore pages it names linked where they first come up (seen: the pages linked
    // already, so a story card's paragraphs link each one once).
    const inked = (text, links = [], seen = new Set()) => {
      const spots = links.map(l => ({ ...l, at: text.indexOf(l.name) })).filter(l => l.at >= 0 && own(l.href, "/lore/"))
        .sort((a, b) => a.at - b.at);
      let out = "", from = 0;
      for (const l of spots) {
        if (l.at < from || seen.has(l.href)) continue;
        seen.add(l.href);
        out += esc(text.slice(from, l.at)) + `<a href="${esc(l.href)}" data-card>${esc(l.name)}</a>`;
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

    // Where a page is in Found: its chapter, and its kind there (a chapter's own page is the whole chapter).
    const foundAt = (href, name) => {
      for (const [i, z] of zones.entries()) {
        if (z.name === name) return { zone: i, kind: "all" };
        for (const [k] of KINDS) if ((z[k]?.list || []).some(x => x.href === href)) return { zone: i, kind: k };
      }
      return null;
    };
    const toFound = (href, name) => {
      const at = foundAt(href, name);
      return at ? `<button type="button" class="hb-chip" data-found="${at.zone}" data-fkind="${at.kind}" data-fhref="${esc(href)}">${IC.book}Its page in Found ›</button>` : "";
    };
    // "Tell me about X", as the add-on asks it: "the Defias Brotherhood" when its story names it that way.
    const tellMe = c => `Tell me about ${c.paras[0]?.startsWith(`The ${c.name}`) ? "the " : ""}${c.name}`;
    const said = (j, q) => `<div class="hb-asked" data-asked="${j}"><span>You asked</span>${esc(q)}</div>`;
    const told = (t, j) => {
      if (typeof t === "number") return H.asks[t] ? `${said(j, H.asks[t].q)}<p class="hb-answer">${inked(H.asks[t].a, H.asks[t].links)}</p>` : "";
      const c = cards.get(t);
      return c ? `${said(j, tellMe(c))}<div class="hb-told"><h5>${esc(c.name)}</h5>${c.label ? `<div class="hb-crumb">${esc(c.label)}</div>` : ""}
        ${((seen) => c.paras.map(p => `<p>${inked(p, c.links, seen)}</p>`).join(""))(new Set([t]))}${toFound(t, c.name)}</div>` : "";
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
          ${H.asks.map((a, i) => `<button type="button" class="hb-row${st.thread.includes(i) ? " on" : ""}" data-here="${i}">${IC.ask}<span>${esc(a.q)}</span></button>`).join("")}
        </div>
        <p class="hb-note">In the game, Here is wherever you stand: its story, and the questions people ask there.</p>`;
      // The right page, as the add-on's: the place's lore with Listen, then the conversation in ink, then what to ask next.
      const next = H.asks.map((a, i) => [a, i]).filter(([, i]) => !st.thread.includes(i));
      const right = `<div class="hb-crumb">${esc([H.label, "Here"].filter(Boolean).join(" · "))}</div><h4>${esc(H.name)}</h4>${listen()}
        <div class="hb-story">${(H.story || []).map(t => `<p>${esc(t)}</p>`).join("")}</div>
        ${toFound(H.page, H.name)}
        ${st.thread.map(told).join("")}
        ${next.length ? `<div class="hb-kind">Suggested:</div><div class="hb-list">${next.map(([a, i]) => `<button type="button" class="hb-row" data-here="${i}">${IC.ask}<span>${esc(a.q)}</span></button>`).join("")}</div>` : ""}`;
      return [left, right];
    };

    // Found: a chapter for each zone, and its pages by kind, with the pictures he took there.
    const KINDS = [["places", "Places"], ["people", "People"], ["quests", "Quests"], ["items", "Items"]];
    const chips = () => `<div class="hb-chips" role="group" aria-label="Kind">${[["all", "Everything"], ...KINDS].map(([k, label]) =>
      `<button type="button" class="hb-chip${st.kind === k ? " on" : ""}" data-kind="${k}" aria-pressed="${st.kind === k}">${esc(label)}</button>`).join("")}</div>`;
    // A search reads only the pages he found, in every chapter (a name never confirms a page he hasn't).
    const searched = () => {
      const words = st.q.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = {};
      for (const z of zones) for (const [k] of KINDS) for (const x of z[k]?.list || []) {
        const name = String(x.name || "").toLowerCase();
        if (words.every(w => name.includes(w))) (hits[k] = hits[k] || []).push(x);
      }
      const shown = KINDS.filter(([k]) => hits[k] && (st.kind === "all" || st.kind === k));
      const n = shown.reduce((a, [k]) => a + hits[k].length, 0);
      return `<h4>Search</h4><div class="hb-crumb">${plural(n, "page", "pages")}</div>${chips()}
        ${shown.map(([k, label]) => `<div class="hb-kind">${label} · ${num(hits[k].length)}</div><div class="hb-tiles">${hits[k].map(x => tile(x, k)).join("")}</div>`).join("")
          || `<p class="hb-sub">No pages like that found yet. Search reads only the pages you've found.</p>`}`;
    };
    const found = () => {
      const share = (n, of) => (of > n ? ` of ${num(of)}` : "");
      const left = `<h3 tabindex="-1" data-focus>Found</h3>
        <input type="search" class="hb-search" placeholder="Search..." aria-label="Search the pages ${esc(who)} found" value="${esc(st.q)}" data-search>
        <div class="hb-list">${zones.map((z, i) => `<button type="button" class="hb-row hb-ch${st.zone === i ? " on" : ""}" data-zone="${i}"><span>${esc(z.name)}</span><span class="hb-d">${num(z.n)}${z.of > z.n ? `/${num(z.of)}` : ""}</span><i class="hb-prog" aria-hidden="true"><b style="width:${Math.round(100 * z.n / Math.max(z.n, z.of || 0, 1))}%"></b></i></button>`).join("")}</div>
        <p class="hb-note">Click a chapter to see its pages. Every place, person, item and quest has a page in the book; the ones you haven't found stay blank, so nothing is spoiled.</p>`;
      if (st.q.trim()) return [left, searched()];
      const z = zones[st.zone];
      if (!z) return [left, `<p class="hb-sub">Your chronicle is still blank. Pages fill in as you travel, meet people, take quests and find things.</p>`];
      const pics = (z.pictures || []).filter(p => own(p.url, "/pictures/"));
      const shown = pics[st.pic];
      const right = `${st.back ? `<button type="button" class="hb-back" data-back>‹ Back to the conversation</button>` : ""}<h4>${esc(z.name)}</h4><div class="hb-crumb">${num(z.n)}${share(z.n, z.of)} pages found</div>
        ${chips()}
        ${shown ? pic(shown, true) : ""}
        ${KINDS.filter(([k]) => z[k]?.n && (st.kind === "all" || st.kind === k)).map(([k, label]) => `<div class="hb-kind">${label} · ${num(z[k].n)}${share(z[k].n, z[k].of)}</div><div class="hb-tiles">${z[k].list.map(x => tile(x, k)).join("")}${z[k].of > z[k].n ? blank(k) : ""}</div>`).join("")}
        ${pics.length ? `<div class="hb-kind">Pictures · ${num(pics.length)}</div><div class="hb-gallery">${pics.map((p, i) => `<button type="button" data-pic="${i}"${i === st.pic ? ' aria-current="true"' : ""}><img src="${esc(p.url)}" alt="${esc(p.caption || p.where || "A picture from the journey")}" loading="lazy" decoding="async">${esc(p.when || "")}</button>`).join("")}</div>` : ""}`;
      return [left, right];
    };

    // Road: his chapters, newest first; a chapter's pages on the right.
    const road = () => `<h3 tabindex="-1" data-focus>Your road · ${plural(chapters.length, "chapter", "chapters")}</h3>${chapters.map(c => {
      const th = own(c.pictures?.[0]?.url, "/pictures/");
      return `<button type="button" class="hb-row${st.view === "chapter" && st.ch === c.n ? " on" : ""}" data-ch="${c.n}"><span class="hb-num">${c.n}</span><span>${esc(c.title)}</span>${th ? `<img class="hb-th" src="${esc(th)}" alt="" loading="lazy" decoding="async">` : ""}<span class="hb-d">${esc(c.when)}</span></button>`;
    }).join("")}`;
    const chapterPages = c => [`<button type="button" class="hb-back" data-v="road">Back</button><div class="hb-crumb">Chapter ${c.n} · ${esc(c.long)}</div><h4 tabindex="-1" data-focus>${esc(c.title)}</h4>
        ${c.route?.length > 1 ? `<div class="hb-route">${c.route.map(esc).join(" → ")}</div>` : ""}
        ${c.summary ? `<p class="hb-sum">${esc(c.summary)}</p>` : ""}
        ${c.facts?.length ? `<ul class="hb-facts">${c.facts.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
        ${(c.pictures || []).map(p => pic(p, true)).join("")}`,
      `<h3>Pages you found this chapter</h3>
        ${c.found?.length ? `<div class="hb-cards">${c.found.map(card).join("")}</div><p class="hb-sub" style="margin-top:8px">Each one has its page in the lore.</p>` : `<p class="hb-sub">Nothing new to find this chapter.</p>`}`];

    // Storylines: the ones he's on, the one he was on last first; a storyline's quests he has done on the right, in
    // the order he did them, never how many it has. The words speak to the reader as "you", as the add-on's do.
    const stories = () => {
      const left = `<h3 tabindex="-1" data-focus>Storylines</h3><p class="hb-sub">The storylines you're on. Click one to see its quests you've taken.</p>
        <div class="hb-list">${lines.map((s, i) => `<button type="button" class="hb-row${st.line === i ? " on" : ""}" data-line="${i}"><span>${esc(s.name)}</span><span class="hb-d">${num(s.n)}</span></button>`).join("")}</div>`;
      const s = lines[st.line];
      if (!s) return [left, `<p class="hb-sub">No storylines yet. Take quests, and the storylines you're on are listed here.</p>`];
      return [left, `<h4>${esc(s.name)}</h4><div class="hb-crumb">Storyline${s.zone ? ` · ${esc(s.zone)}` : ""}</div>
        <p class="hb-sub">Quests you take from this story are written here, in order.</p>
        <ol class="hb-steps">${s.quests.map(q => `<li>${questRow(q)}</li>`).join("")}</ol>`];
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
      els.l.classList.toggle("hb-searching", st.view === "found" && !!st.q.trim());
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
    // The conversation at its entry j: on a phone the page scrolls to it, on a wide screen the right page does.
    const toEntry = j => {
      const at = els.r.querySelector(`[data-asked="${j}"]`);
      if (!at) return;
      if (matchMedia("(max-width: 760px)").matches) at.scrollIntoView({ block: "start" });
      else els.r.scrollTop = at.offsetTop - 12;   // (the page is the entry's offsetParent)
    };
    // A lore link in an answer: its story card joins the thread (once; a second click goes to it). A page with no story
    // to tell, or one that can't be read, opens its lore page as the link would.
    async function tell(href) {
      if (!cards.has(href)) {
        const m = href.match(/^\/lore\/([\w-]+)\/([\w-]+)$/);
        const d = m ? await fetch(`/lore/data/e/${m[1]}_${m[2]}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null) : null;
        const story = (d?.clips || []).find(c => c.part === "narration");
        const paras = (story?.paras || (d?.description ? [d.description] : [])).map(String).filter(Boolean);
        if (!d?.name || !paras.length) { location.href = href; return; }
        // The pages its story names, linked as an answer's are, so the story can be followed on from the card.
        const links = (d.related || []).map(l => ({ name: String(l?.n || ""), href: String(l?.p || "") })).filter(l => l.name && l.href !== href);
        cards.set(href, { name: String(d.name), label: String(d.label || ""), paras, links });
      }
      if (!st.thread.includes(href)) st.thread.push(href);
      if (st.view !== "here") return;
      paint("right");
      toEntry(st.thread.indexOf(href));
    }
    root.addEventListener("click", e => {
      const a = e.target.closest("a[data-card]");
      if (a && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        tell(a.getAttribute("href"));
        return;
      }
      const t = e.target.closest("button");
      if (!t) return;
      const d = t.dataset;
      if (d.play !== undefined || d.main !== undefined) return toggle();
      if (d.v) {
        st.view = d.v; st.pic = -1;
        if (t.classList.contains("hb-rib")) { st.back = false; st.hit = ""; }   // a ribbon is a fresh visit
        return paint(t.classList.contains("hb-rib") ? "ribbon" : "page");
      }
      if (d.found) {
        st.hereTop = els.r.scrollTop; st.hereY = scrollY;
        st.view = "found"; st.zone = Number(d.found); st.kind = d.fkind || "all"; st.q = ""; st.pic = -1;
        st.back = true; st.hit = d.fhref || "";
        return paint("right");
      }
      if (d.back !== undefined) {
        st.view = "here"; st.back = false; st.hit = "";
        paint(false);
        els.r.scrollTop = st.hereTop;
        if (matchMedia("(max-width: 760px)").matches) scrollTo(0, st.hereY);
        return;
      }
      if (d.here === "story") { paint("right"); els.r.scrollTop = 0; return; }
      if (d.here) {
        const i = Number(d.here);
        if (!st.thread.includes(i)) st.thread.push(i);
        paint("right");
        toEntry(st.thread.indexOf(i));   // the answer, where the conversation reaches it
        return;
      }
      if (d.zone) { st.zone = Number(d.zone); st.pic = -1; return paint("right"); }
      if (d.pic) { st.pic = Number(d.pic) === st.pic ? -1 : Number(d.pic); return paint("right"); }
      if (d.line) { st.line = Number(d.line); return paint("right"); }
      if (d.kind) { st.kind = d.kind; return paint("right"); }
      if (d.ch) { st.view = "chapter"; st.ch = Number(d.ch); return paint("page"); }
    });
    // Typing a search repaints only the right page, so the box keeps its focus and caret.
    root.addEventListener("input", e => {
      if (!e.target.matches("[data-search]")) return;
      st.q = e.target.value;
      els.r.innerHTML = pages()[1];
      els.l.classList.toggle("hb-searching", !!st.q.trim());
    });
    paint(false);
  }
})();
