// Site header, on every public page (LOR-222): the brand, then Download, Lore, What's new and Community, and on the
// right Make your profile next to Sign in or the account chip. Each page's <header class="top"> carries the links
// itself (SITE_NAV in lib/voices.js; site/tests/nav.test.mjs keeps the copies equal), so they work without
// JavaScript. This script:
//   - marks the link for the part of the site you're on;
//   - turns Community into a menu: the Discord, the three kinds of feedback (the kinds feedback.html accepts in
//     ?kind=), the FAQ, then Record your voice, Translate and Contributors;
//   - asks GET /api/auth/me (functions/api/auth/[action].js) whether you're signed in. Signed in, Make your profile
//     becomes Your profile (/u/me, your page or else making one) and the account chip appears (Your profile, Your
//     account, Sign out); signed out, a Sign in link to /account. The same answer says which site features are on
//     (lib/features.js), which the header follows: the Lore link, and Share Forever text in Community. The answer
//     takes a moment, so the header shows the last one it got (lf-auth and lf-features in localStorage) right away,
//     and the answer corrects it (see "Site features" and "Signed in or not");
//   - puts a dot on What's new while there's a version you haven't looked at, and runs the home page's "New in"
//     strip (#newbar, written by scripts/changelog.py; an inline script there shows it before this one runs).
// "Looked at" is lf-seen in localStorage: the newest version you've seen the news of, set when you open What's new,
// follow the strip or close it. A first visit gets no dot (everything is new); the strip shows until it's closed.
(() => {
  const LATEST = "0.11.0";   // changelog: the newest version in CHANGELOG.md (scripts/changelog.py site keeps it)
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
    ["nav-download", new RegExp(`^/(downloads|voices)(/(?!(${VOICE_TOOLS})$)[^/]+)?$`)],
    ["nav-lore", /^\/lore(\/.*)?$/],
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
  function dropdown(button, menu, id) {
    menu.id = id;
    menu.hidden = true;
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", id);
    button.addEventListener("click", e => {
      if (current && current.menu === menu) close(false);
      else open(button, menu, e.detail === 0);   // detail 0: pressed with Enter or Space, so move focus into the menu
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
    ["/discord?src=nav", "Join the Discord", "Chat with other players; news lands there first"],
    ["/feedback", "Send feedback", "What you like and what's off"],
    ["/feedback?kind=idea", "Request a feature", "A zone or something new for the panel"],
    ["/feedback?kind=bug", "Report a bug", "Something broke or won't load"],
    ["/faq", "FAQ", "What players ask most, answered"],
  ];
  const HELP = [
    ["/voices/studio", "Record your voice", "Narrate a few lines, hear yourself in game"],
    ["/translate", "Translate", "Lore Forever in your language"],
    ["/contributors", "Contributors", "Everyone who narrates, translates and sends in text"],
  ];
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
    menu.innerHTML = COMMUNITY.map(item).join("") +
      '<p class="menu-note" hidden>Feedback asks you to sign in with Google first.</p><hr>' +
      '<p class="menu-head">Help out</p>' + HELP.map(item).join("");
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
      communityMenu.insertAdjacentHTML("beforeend", item(CONTRIBUTE));
      contributeItem = communityMenu.lastElementChild;
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
  // The right of the header: signed in, Your profile and the account chip ({in: true, name, until: when that sign-in
  // ends}); signed out, Make your profile and, where sign-in is on, Sign in ({in: false, signIn}). GET /api/auth/me
  // says which, but only after a moment, so the last answer is kept in localStorage (lf-auth: only that, never the
  // email) and shown at once on the next page, and the answer corrects it if it changed. A page a Function made for
  // someone it knows is signed in (/u/<handle>) says so itself: data-auth, data-name and data-until on .head-actions
  // (lib/voices.js siteNav). Until one of them is there the spot stays blank but keeps its place: the nav's inline
  // script set hd-wait on <html> (style.css), and show(), or an answer that never comes, takes it off.
  const AUTH = "lf-auth";
  const profile = document.getElementById("nav-profile");
  const profileText = profile && profile.querySelector(".hd-wide");
  let chip = null, chipMenu = null, signIn = null;   // what show() put in the header

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

  // Signed in: the account chip and its menu, made once.
  function accountChip() {
    chip = document.createElement("button");
    chip.className = "head-chip";
    chip.innerHTML = '<span class="mini-avatar" aria-hidden="true"></span><span class="chip-name"></span>' + caret;
    chipMenu = document.createElement("div");
    chipMenu.className = "head-menu head-menu-account";
    chipMenu.innerHTML = '<p class="menu-who">Signed in as <strong></strong></p><a href="/u/me">Your profile</a>' +
      '<a href="/account">Your account</a><hr><button type="button">Sign out</button>';
    const signOut = chipMenu.querySelector("button");
    signOut.addEventListener("click", async () => {
      signOut.disabled = true;
      try {
        const r = await fetch("/api/auth/logout",
          { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        remember(r.ok ? { in: false, signIn: true } : null);
      } catch (e) { remember(null); /* reloading shows whether it worked */ }
      location.reload();
    });
    box.append(chip, chipMenu);
    dropdown(chip, chipMenu, "hd-account-menu");
  }

  // Puts state s in the header and shows it. email: the account's, for "Signed in as" (until GET /api/auth/me brings
  // it, the chip's name).
  function show(s, email) {
    if (profile) {
      profile.href = s.in ? "/u/me" : "/account#profile";
      if (profileText) profileText.textContent = s.in ? "Your profile" : "Make your profile";
    }
    if (feedbackNote) feedbackNote.hidden = s.in || !s.signIn;
    if (s.in) {
      if (signIn) { signIn.remove(); signIn = null; }
      if (!chip) accountChip();
      chip.setAttribute("aria-label", "Account: " + s.name);
      chip.querySelector(".mini-avatar").textContent = s.name.charAt(0).toUpperCase();
      chip.querySelector(".chip-name").textContent = s.name;
      chipMenu.querySelector("strong").textContent = email || s.name;
    } else {
      if (chip) {
        if (current && current.menu === chipMenu) close(false);
        chip.remove();
        chipMenu.remove();
        chip = chipMenu = null;
      }
      // Signed out: a Sign in link to /account, where signing in leads to making your profile (LOR-181). Not on
      // /account itself, which is the sign-in page.
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

  fetch("/api/auth/me", { cache: "no-store" })
    .then(r => r.json())
    .then(me => {
      if (me && me.ok) answered(me);
      else known();
    })
    .catch(known);   // no account info: the links work the same (what was remembered stays)
})();
