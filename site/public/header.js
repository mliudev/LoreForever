// Site header, on every public page (LOR-222; the Chronicle bar, 2026-10-25): the brand, then Lore, Guides, What's new
// and Community; on the right a small Willo link (her own site), the Download button and Sign in (or, signed in, your
// page). Each page's <header class="top"> carries the links itself (SITE_NAV in lib/voices.js; keep the copies in
// step), so they work without JavaScript. This script:
//   - marks the link for the part of the site you're on;
//   - turns Community into a menu: the Discord, Translate, Lend your voice, Contributors, the FAQ and Feedback (and, with
//     "contribute" on, Share Forever text);
//   - on a phone (720px and under) swaps the links for a menu button that opens one sheet with all of them;
//   - asks GET /api/auth/me (functions/api/auth/[action].js) whether you're signed in. Signed in, the Sign in link
//     gives way to your avatar and Your page (/u/me), with a small menu beside it (Your page, Account, Sign out);
//     signed out, Sign in goes to /account. The same answer says which site features are on
//     (lib/features.js), which the header follows: the Lore link, and Share Forever text in Community. The answer
//     takes a moment, so the header shows the last one it got (lf-auth and lf-features in localStorage) right away,
//     and the answer corrects it (see "Site features" and "Signed in or not");
//   - puts a dot on What's new while there's a version you haven't looked at, and runs the home page's "New in"
//     strip (#newbar, written by scripts/changelog.py; an inline script there shows it before this one runs).
// "Looked at" is lf-seen in localStorage: the newest version you've seen the news of, set when you open What's new,
// follow the strip or close it. A first visit gets no dot (everything is new); the strip shows until it's closed.
(() => {
  const LATEST = "0.29.0";   // changelog: the newest version in CHANGELOG.md (scripts/changelog.py site keeps it)
  const header = document.querySelector("header.top");
  const box = header && header.querySelector(".head-actions");
  if (!box) return;
  const path = location.pathname.replace(/\/+$/, "") || "/";

  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode: nothing remembered */ } },
    drop: k => { try { localStorage.removeItem(k); } catch (e) { /* nothing to forget */ } },
  };
  // Whether version a is newer than b ("0.10.0" > "0.9.2"); a missing b counts as older than everything.
  const newer = (a, b) => {
    const x = String(a).split(".").map(Number), y = String(b || "0").split(".").map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  };

  // ---- Where you are ----
  const VOICE_TOOLS = "studio|guide|release|submit|thanks|lend|lend-terms|zones";
  const SECTIONS = [
    ["nav-willo", /^\/willo(\/.*)?$/],
    ["nav-download", new RegExp(`^/(downloads|voices)(/(?!(${VOICE_TOOLS})$)[^/]+)?$`)],
    ["nav-lore", /^\/lore(\/.*)?$/],
    ["nav-guides", /^\/guides(\/.*)?$/],
    ["nav-new", /^\/whats-new$/],
    ["nav-profile", /^\/(account|u\/[^/]+)$/],
    ["nav-community", new RegExp(`^/(feedback|faq|translate(/.*)?|voices/(${VOICE_TOOLS})|contributors|contribute(/.*)?)$`)],
  ];
  const here = (SECTIONS.find(([, re]) => re.test(path)) || [])[0];

  // ---- Menus ----
  let current = null;   // the open menu: { button, menu }
  const entries = menu => [...menu.querySelectorAll("a, button")].filter(x => !x.disabled);

  function close(refocus) {
    if (!current) return;
    const { button, menu } = current;
    current = null;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (refocus) button.focus();
  }

  function open(button, menu, focusFirst) {
    close(false);
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    current = { button, menu };
    if (focusFirst) entries(menu)[0].focus();
  }

  // Wires `button` to show and hide `menu` (a disclosure: a button with aria-expanded and a list of links).
  function dropdown(button, menu, id, alwaysFocus) {
    menu.id = id;
    menu.hidden = true;
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", id);
    button.addEventListener("click", e => {
      if (current && current.menu === menu) close(false);
      else open(button, menu, alwaysFocus || e.detail === 0);   // detail 0: pressed with Enter or Space, so move focus into the menu
    });
    button.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { e.preventDefault(); open(button, menu, true); }
    });
    menu.addEventListener("keydown", e => {
      const list = entries(menu);
      const i = list.indexOf(document.activeElement);
      const to = { ArrowDown: list[(i + 1) % list.length], ArrowUp: list[(i - 1 + list.length) % list.length],
        Home: list[0], End: list[list.length - 1] }[e.key];
      if (to) { e.preventDefault(); to.focus(); }
    });
  }

  // Esc closes and hands focus back; a click elsewhere or tabbing out of the menu closes it.
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && current) { e.preventDefault(); close(true); }
  });
  document.addEventListener("click", e => {
    if (current && !current.menu.contains(e.target) && !current.button.contains(e.target)) close(false);
  });
  header.addEventListener("focusout", e => {
    const to = e.relatedTarget;
    if (current && to && !current.menu.contains(to) && to !== current.button) close(false);
  });

  const caret = '<span class="caret" aria-hidden="true">&#9662;</span>';
  const item = ([href, title, hint]) => `<a href="${href}">${title}<small>${hint}</small></a>`;

  // Community: the link (to /feedback) becomes the menu's button.
  const COMMUNITY = [
    ["/discord?src=nav", "Discord", "Chat with other players; news lands there first"],
    ["/translate", "Translate", "Lore Forever in your language"],
    ["/voices/lend", "Lend your voice", "Give the game's people a voice"],
    ["/contributors", "Contributors", "Everyone who narrates, translates and sends in text"],
    ["/faq", "FAQ", "Answers to what players ask most"],
  ];
  const FEEDBACK = ["/feedback", "Feedback", "What you like and what's off"];
  // Share Forever text (/contribute, LOR-235) joins the menu once the "contribute" feature is on (lib/features.js;
  // see "Site features"), i.e. once the add-on release with its Contribute button is out.
  const CONTRIBUTE = ["/contribute", "Share Forever text", "The quests and gossip you've seen in game"];
  let communityMenu = null;
  let feedbackNote = null;
  const community = document.getElementById("nav-community");
  if (community) {
    const button = document.createElement("button");
    button.className = community.className;
    button.id = community.id;
    button.innerHTML = community.innerHTML + caret;
    if (here === "nav-community") button.classList.add("nl-on");
    const menu = document.createElement("div");
    menu.className = "head-menu";
    menu.innerHTML = COMMUNITY.map(item).join("") + "<hr>" + item(FEEDBACK) +
      '<p class="menu-note" hidden>Feedback asks you to sign in with Google first.</p>';
    feedbackNote = menu.querySelector(".menu-note");
    communityMenu = menu;
    const wrap = document.createElement("div");
    wrap.className = "nav-dd";
    community.replaceWith(wrap);
    wrap.append(button, menu);
    dropdown(button, menu, "hd-community-menu");
  }
  if (here && here !== "nav-community") {
    const link = document.getElementById(here);
    if (link) link.setAttribute("aria-current", "page");
  }

  // ---- What's new ----
  const seen = store.get("lf-seen");
  const newLink = document.getElementById("nav-new");
  const bar = document.getElementById("newbar");
  let dot = null;
  function caughtUp() {
    store.set("lf-seen", LATEST);
    if (dot) { dot.remove(); dot = null; }
    if (bar) bar.hidden = true;
  }
  if (path === "/whats-new") {
    // Tag what's come out since your last look, then count it as seen.
    if (seen) {
      document.querySelectorAll("[data-version]").forEach(v => {
        if (!newer(v.dataset.version, seen)) return;
        const tag = document.createElement("span");
        tag.className = "tag tag-new";
        tag.textContent = "New since your last visit";
        const head = v.querySelector(".wn-head, summary") || v;
        head.insertBefore(tag, head.querySelector(".wn-n"));   // before an older version's count; else at the end
      });
    }
    caughtUp();
  } else if (newLink && seen && newer(LATEST, seen)) {
    dot = document.createElement("span");
    dot.className = "new-dot";
    dot.title = "New since your last visit";
    newLink.append(dot);
    newLink.setAttribute("aria-label", "What's new (something new since your last visit)");
  }
  if (newLink) newLink.addEventListener("click", caughtUp);
  if (bar) {
    bar.querySelectorAll("a").forEach(a => a.addEventListener("click", caughtUp));
    const x = bar.querySelector(".newbar-x");
    if (x) x.addEventListener("click", caughtUp);
  }

  // ---- Site features ----
  // GET /api/auth/me also says which site features are on (lib/features.js), and the header follows two of them. The
  // Lore link (/lore, LOR-233) is in every page's markup while "lore" is on, and hidden while it's off (hd-nolore on
  // <html>, style.css); Share Forever text joins the Community menu while "contribute" is on. The last answer is kept
  // in localStorage (lf-features: {lore, contribute}) and shown at once on the next page, the Lore link by the nav's
  // inline script before the links are drawn; the answer corrects it if it changed.
  const FEATURES = "lf-features";
  let contributeItem = null;
  function features(f) {
    document.documentElement.classList.toggle("hd-nolore", !f.lore);
    if (f.contribute && !contributeItem && communityMenu) {
      communityMenu.querySelector("hr").insertAdjacentHTML("beforebegin", item(CONTRIBUTE));
      contributeItem = communityMenu.querySelector("hr").previousElementSibling;
    } else if (!f.contribute && contributeItem) {
      contributeItem.remove();
      contributeItem = null;
    }
  }
  try {
    const f = JSON.parse(store.get(FEATURES));
    if (f && typeof f === "object") features({ lore: f.lore !== false, contribute: f.contribute === true });
  } catch (e) { /* nothing remembered: the markup as it is (Lore shown, nothing added) */ }

  // ---- Signed in or not ----
  // The right of the header: signed in, your avatar with Your page and a small menu ({in: true, name, until: when
  // that sign-in ends}); signed out, the Sign in link ({in: false, signIn}). GET /api/auth/me
  // says which, but only after a moment, so the last answer is kept in localStorage (lf-auth: only that, never the
  // email) and shown at once on the next page, and the answer corrects it if it changed. A page a Function made for
  // someone it knows is signed in (/u/<handle>) says so itself: data-auth, data-name and data-until on .head-actions
  // (lib/voices.js siteNav). Until one of them is there the Sign in spot stays blank but keeps its place: the nav's
  // inline script set hd-wait on <html> (style.css), and show(), or an answer that never comes, takes it off.
  // The Sign in link (#nav-profile) is in the page's markup; where it isn't (Willo's door has her own header), one is
  // made.
  const AUTH = "lf-auth";
  const profile = document.getElementById("nav-profile");
  let chip = null, chipMore = null, chipMenu = null, signIn = null;   // what show() put in the header

  const known = () => document.documentElement.classList.remove("hd-wait");
  const chipName = user => user.display_name || (user.email || "").split("@")[0] || "Your account";
  // What's remembered; null when there's nothing (a first visit, private mode), it can't be read, or the sign-in it
  // remembers has ended by now (then the answer decides).
  function remembered() {
    let s = null;
    try { s = JSON.parse(store.get(AUTH)); } catch (e) { /* not ours: as if there were nothing */ }
    if (!s || typeof s !== "object") return null;
    if (!s.in) return { in: false, signIn: Boolean(s.signIn) };
    if (s.until && !(Date.parse(s.until) > Date.now())) return null;
    return { in: true, name: String(s.name || "Your account"), until: s.until };
  }
  const remember = s => (s ? store.set(AUTH, JSON.stringify(s)) : store.drop(AUTH));

  // Signed in: your page (the avatar and Your page, a link) with a small menu beside it, made once.
  async function signOutNow(button) {
    button.disabled = true;
    try {
      const r = await fetch("/api/auth/logout",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      remember(r.ok ? { in: false, signIn: true } : null);
    } catch (e) { remember(null); /* reloading shows whether it worked */ }
    location.reload();
  }

  // Willo's door (willocompanion.com) keeps its own header: there the chip stays one button with the name.
  const willoDoor = document.documentElement.dataset.door === "willo";
  function accountChip() {
    chipMenu = document.createElement("div");
    chipMenu.className = "head-menu head-menu-account";
    chip = document.createElement("button");
    chip.className = "head-chip";
    chip.innerHTML = '<span class="mini-avatar" aria-hidden="true"></span><span class="chip-name">' +
      (willoDoor ? "" : "Your page") + "</span>" + caret;
    chipMore = chip;
    chipMenu.innerHTML = willoDoor
      ? '<p class="menu-who">Signed in as <strong></strong></p><a href="/u/me">Your profile</a><a href="/account">Your account</a><hr><button type="button">Sign out</button>'
      : '<a href="/u/me">Your page</a><a href="/account">Account</a><hr><button type="button">Sign out</button>';
    const signOut = chipMenu.querySelector("button");
    signOut.addEventListener("click", () => signOutNow(signOut));
    box.append(chip, chipMenu);
    dropdown(chipMore, chipMenu, "hd-account-menu");
  }

  // Puts state s in the header and shows it. email: the account's, for "Signed in as" (until GET /api/auth/me brings
  // it, the chip's name).
  function show(s, email) {
    if (feedbackNote) feedbackNote.hidden = s.in || !s.signIn;
    if (profile) profile.hidden = s.in;   // the page's own Sign in link is the signed-out spot
    if (s.in) {
      if (signIn) { signIn.remove(); signIn = null; }
      if (!chip) accountChip();
      if (willoDoor) {
        chip.setAttribute("aria-label", "Account: " + s.name);
        chip.querySelector(".chip-name").textContent = s.name;
      }
      chip.querySelector(".mini-avatar").textContent = s.name.charAt(0).toUpperCase();
      if (chipMenu.querySelector("strong")) chipMenu.querySelector("strong").textContent = email || s.name;
      if (!willoDoor) chip.setAttribute("aria-label", "Your page, account menu");
    } else {
      if (chip) {
        if (current && current.menu === chipMenu) close(false);
        chip.remove();
        chipMenu.remove();
        chip = chipMore = chipMenu = null;
      }
      // Signed out, with no Sign in link in the markup (Willo's door): one to /account, where signing in leads to
      // making your profile (LOR-181). Not on /account itself, which is the sign-in page.
      if (!profile) {
        if (s.signIn && path !== "/account") {
          if (!signIn) {
            signIn = document.createElement("a");
            signIn.className = "btn-in";
            signIn.href = "/account";
            signIn.textContent = "Sign in";
            box.append(signIn);
          }
        } else if (signIn) { signIn.remove(); signIn = null; }
      }
    }
    known();
  }

  // GET /api/auth/me's answer: show it, and remember it for the next page.
  function answered(me) {
    if (me.features) {
      const f = { lore: Boolean(me.features.lore), contribute: Boolean(me.features.contribute) };
      store.set(FEATURES, JSON.stringify(f));
      features(f);
    }
    const s = me.user ? { in: true, name: chipName(me.user), until: me.user.session_expires }
      : { in: false, signIn: Boolean(me.signIn && me.signIn.google) };
    remember(s);
    show(s, me.user && me.user.email);
  }

  const served = box.dataset.auth === "in"
    ? { in: true, name: box.dataset.name || "Your account", until: box.dataset.until } : null;
  if (served) remember(served);
  const first = served || remembered();
  if (first) show(first);

  // /account and /link sign you in and out without leaving the page. They pass on GET /api/auth/me's new answer in an
  // "lf-auth" event (detail: the answer), or send one without it when they leave the page before asking again: the
  // header then forgets what it remembered, and the next page waits for the answer.
  document.addEventListener("lf-auth", e => {
    if (e.detail && e.detail.ok) answered(e.detail);
    else remember(null);
  });

  // ---- A phone: a menu button and one sheet with every link ----
  // At 720px and under (style.css) the links give way to this button; its sheet is made from the header's own links
  // and what's true now (signed in or not, which features are on) each time it opens. Esc, a click elsewhere or
  // tabbing out closes it, as with the other menus; opening it moves focus to its first link.
  if (!willoDoor && document.getElementById("nav-guides")) {
    const nav = header.querySelector(".nav");
    const burger = document.createElement("button");
    burger.className = "nav-burger";
    burger.setAttribute("aria-label", "Menu");
    burger.innerHTML = '&#9776;';
    const sheet = document.createElement("div");
    sheet.className = "head-menu nav-sheet";
    const link = a => `<a href="${a.getAttribute("href")}">${a.textContent.trim().replace(/\s+/g, " ")}</a>`;
    function fill() {
      const main = [...header.querySelectorAll(".nav-links > a.nl")].filter(a =>
        !(a.id === "nav-lore" && document.documentElement.classList.contains("hd-nolore")));
      const willo = document.getElementById("nav-willo");
      const sub = ([href, title]) => `<a class="sub" href="${href}">${title}</a>`;
      sheet.innerHTML = main.map(link).join("") + '<a href="/feedback">Community</a>' +
        COMMUNITY.concat(contributeItem ? [CONTRIBUTE] : [], [FEEDBACK]).map(sub).join("") +
        (chip ? '<a class="sis2" href="/u/me">Your page</a><a class="sub" href="/account">Account</a><button type="button" class="sub">Sign out</button>'
          : `<a class="sis2" href="${profile ? profile.getAttribute("href") : "/account"}">Sign in</a>`) +
        (willo ? `<a class="last" href="${willo.getAttribute("href")}">Willo &#8599; <span class="note">sister site</span></a>` : "");
      const out = sheet.querySelector("button");
      if (out) out.addEventListener("click", () => signOutNow(out));
    }
    fill();
    const prep = () => { if (sheet.hidden) fill(); };
    burger.addEventListener("click", prep);
    burger.addEventListener("keydown", e => { if (e.key === "ArrowDown") prep(); });
    nav.append(sheet);
    box.append(burger);
    dropdown(burger, sheet, "hd-nav-sheet", true);
    header.classList.add("nav-js");
    window.matchMedia("(min-width: 721px)").addEventListener("change", e => {
      if (e.matches && current && current.menu === sheet) close(false);
    });
  }

  fetch("/api/auth/me", { cache: "no-store" })
    .then(r => r.json())
    .then(me => {
      if (me && me.ok) answered(me);
      else known();
    })
    .catch(known);   // no account info: the links work the same (what was remembered stays)
})();

// Where a visit started (lib/sources.js, functions/api/visit.js): a page opened from another site, a tracked link
// (/a/<slug>) or an address with ?src= is told to the site once per tab, so it counts the visit under that source and
// the page it landed on. Never for a click inside the site or an address typed in (no referrer and no ?src=).
(() => {
  const asked = (new URLSearchParams(location.search).get("src") || "").toLowerCase();
  let ref = "";
  try { ref = document.referrer ? new URL(document.referrer).href : ""; } catch (e) { ref = ""; }
  if (ref && new URL(ref).origin === location.origin) return;
  if (!asked && !ref) return;
  try {
    if (sessionStorage.getItem("lf-visit")) return;
    sessionStorage.setItem("lf-visit", "1");
  } catch (e) { /* storage blocked: told on each such page */ }
  fetch("/api/visit", { method: "POST", keepalive: true, credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ src: asked, landing: location.pathname, ref }) }).catch(() => {});
})();

// Where a visit came from (LOR-413): a link like /downloads?src=lore marks the visit, and the site's own download links
// (/download/installer, /download/zip) carry it, so functions/download/[file].js counts downloads by source. The first
// source of a visit wins and stays in this tab only (sessionStorage); nothing else is sent anywhere.
(() => {
  const SRC = /^[a-z0-9][a-z0-9_-]{0,31}$/;
  const asked = (new URLSearchParams(location.search).get("src") || "").toLowerCase();
  let src = SRC.test(asked) ? asked : "";
  try {
    if (src && !sessionStorage.getItem("lf-src")) sessionStorage.setItem("lf-src", src);
    src = sessionStorage.getItem("lf-src") || src;
  } catch (e) { /* storage blocked: this page's own ?src= still counts */ }
  if (!src) return;
  for (const a of document.querySelectorAll("a[href]")) {
    const url = new URL(a.href, location.href);
    if (url.origin === location.origin && /^\/download\/(installer|zip|complete)$/.test(url.pathname)) {
      url.searchParams.set("src", src);
      a.href = url.pathname + url.search;
    }
  }
})();
