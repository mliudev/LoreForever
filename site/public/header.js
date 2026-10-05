// Site header, on every public page (LOR-222): the brand, then Download, What's new and Community, and on the right
// Make your profile next to Sign in or the account chip. Each page's <header class="top"> carries the links itself
// (SITE_NAV in lib/voices.js; site/tests/nav.test.mjs keeps the copies equal), so they work without JavaScript. This
// script:
//   - marks the link for the part of the site you're on;
//   - turns Community into a menu: the Discord, the three kinds of feedback (the kinds feedback.html accepts in
//     ?kind=), the FAQ, then Record your voice, Translate and Contributors;
//   - asks GET /api/auth/me (functions/api/auth/[action].js) whether you're signed in. Signed in, Make your profile
//     becomes Your profile (/u/me, your page or else making one) and the account chip appears (Your profile, Your
//     account, Sign out); signed out, a Sign in link to /account. The same answer says which site features are on
//     (lib/features.js): their links join the header;
//   - puts a dot on What's new while there's a version you haven't looked at, and runs the home page's "New in"
//     strip (#newbar, written by scripts/changelog.py; an inline script there shows it before this one runs).
// "Looked at" is lf-seen in localStorage: the newest version you've seen the news of, set when you open What's new,
// follow the strip or close it. A first visit gets no dot (everything is new); the strip shows until it's closed.
(() => {
  const LATEST = "0.8.0";   // changelog: the newest version in CHANGELOG.md (scripts/changelog.py site keeps it)
  const header = document.querySelector("header.top");
  const box = header && header.querySelector(".head-actions");
  if (!box) return;
  const path = location.pathname.replace(/\/+$/, "") || "/";

  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode: nothing remembered */ } },
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
  // GET /api/auth/me says), i.e. once the add-on release with its Contribute button is out.
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

  // ---- Signed in or not ----
  const profile = document.getElementById("nav-profile");

  function accountChip(user) {
    const name = user.display_name || (user.email || "").split("@")[0] || "Your account";
    const chip = document.createElement("button");
    chip.className = "head-chip";
    chip.setAttribute("aria-label", "Account: " + name);
    chip.innerHTML = '<span class="mini-avatar" aria-hidden="true"></span><span class="chip-name"></span>' + caret;
    chip.querySelector(".mini-avatar").textContent = name.charAt(0).toUpperCase();
    chip.querySelector(".chip-name").textContent = name;
    const menu = document.createElement("div");
    menu.className = "head-menu head-menu-account";
    menu.innerHTML = '<p class="menu-who">Signed in as <strong></strong></p><a href="/u/me">Your profile</a>' +
      '<a href="/account">Your account</a><hr><button type="button">Sign out</button>';
    menu.querySelector("strong").textContent = user.email || name;
    const signOut = menu.querySelector("button");
    signOut.addEventListener("click", async () => {
      signOut.disabled = true;
      try {
        await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      } catch (e) { /* reloading shows whether it worked */ }
      location.reload();
    });
    box.append(chip, menu);
    dropdown(chip, menu, "hd-account-menu");
  }

  // Signed out: a Sign in link to /account, where signing in leads to making your profile (LOR-181). Not on /account
  // itself, which is the sign-in page.
  function signInLink() {
    if (path === "/account") return;
    const a = document.createElement("a");
    a.className = "btn-in";
    a.href = "/account";
    a.textContent = "Sign in";
    box.append(a);
  }

  fetch("/api/auth/me", { cache: "no-store" })
    .then(r => r.json())
    .then(me => {
      if (!me || !me.ok) return;
      if (me.features && me.features.contribute && communityMenu) {
        communityMenu.insertAdjacentHTML("beforeend", item(CONTRIBUTE));
      }
      // Lore (/lore, LOR-233) joins the links after Download once the "lore" feature is on (lib/features.js), i.e.
      // once the narration recordings are on the site.
      const download = document.getElementById("nav-download");
      if (me.features && me.features.lore && download && !document.getElementById("nav-lore")) {
        const lore = document.createElement("a");
        lore.className = "nl";
        lore.id = "nav-lore";
        lore.href = "/lore";
        lore.textContent = "Lore";
        if (/^\/lore(\/|$)/.test(path)) lore.setAttribute("aria-current", "page");
        download.after(lore);
      }
      if (me.user) {
        if (profile) {
          profile.href = "/u/me";
          const wide = profile.querySelector(".hd-wide");
          if (wide) wide.textContent = "Your profile";
        }
        accountChip(me.user);
      } else if (me.signIn && me.signIn.google) {
        if (feedbackNote) feedbackNote.hidden = false;
        signInLink();
      }
    })
    .catch(() => { /* no account info: the links work the same */ });
})();
