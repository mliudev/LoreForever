// Site header, on every public page: a Voices link, the "Send feedback" menu and, once signed in, the account chip
// (Your profile, Your account, Sign out); signed out, a Sign in link.
// Each page's header ends with
//   <div class="head-actions"><a class="btn-head" href="/feedback">...</a></div>
// and loads this with <script src="/header.js" defer>. Without JavaScript that stays a plain link to /feedback.
// Here it becomes a button opening a small menu of the three kinds of feedback (the kinds feedback.html accepts in
// ?kind=). Signing in happens on /feedback itself. GET /api/auth/me (functions/api/auth/[action].js) says whether
// someone is signed in; if so, a chip next to the button links to /account and signs out.
(() => {
  const box = document.querySelector(".top .head-actions");
  const link = box && box.querySelector("a.btn-head");
  if (!box || !link) return;

  const FEEDBACK = [
    ["/feedback", "Send feedback", "What you like and what's off"],
    ["/feedback?kind=idea", "Request a feature", "A zone or something new for the panel"],
    ["/feedback?kind=bug", "Report a bug", "Something broke or won't load"],
  ];

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
  box.addEventListener("focusout", e => {
    const to = e.relatedTarget;
    if (current && to && !current.menu.contains(to) && to !== current.button) close(false);
  });

  // Voices: a link to /voices (the narrator voices and every download) before the feedback button, on every page
  // but that one.
  if (location.pathname.replace(/\/$/, "") !== "/voices") {
    const dl = document.createElement("a");
    dl.className = "btn-head btn-head-dl";
    dl.href = "/voices";
    dl.textContent = "Voices";
    box.prepend(dl);
  }

  // Send feedback: the link becomes the menu's button.
  const fbButton = document.createElement("button");
  fbButton.className = "btn-head";
  fbButton.innerHTML = link.innerHTML + '<span class="caret" aria-hidden="true">&#9662;</span>';
  const fbMenu = document.createElement("div");
  fbMenu.className = "head-menu";
  fbMenu.innerHTML = FEEDBACK.map(([href, title, hint]) => `<a href="${href}">${title}<small>${hint}</small></a>`).join("") +
    '<div class="menu-foot" hidden><hr><p class="menu-note">You\'ll sign in with Google first.</p></div>';
  link.replaceWith(fbButton);
  fbButton.after(fbMenu);
  dropdown(fbButton, fbMenu, "hd-feedback-menu");

  function accountChip(user) {
    const name = user.display_name || (user.email || "").split("@")[0] || "Your account";
    const chip = document.createElement("button");
    chip.className = "head-chip";
    chip.setAttribute("aria-label", "Account: " + name);
    chip.innerHTML = '<span class="mini-avatar" aria-hidden="true"></span><span class="chip-name"></span>' +
      '<span class="caret" aria-hidden="true">&#9662;</span>';
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

  // Signed out: a "Sign in" link to /account, where signing in leads to making your profile (LOR-181).
  function signInLink() {
    if (location.pathname.replace(/\/$/, "") === "/account") return;
    const a = document.createElement("a");
    a.className = "btn-head btn-head-in";
    a.href = "/account#profile";
    a.textContent = "Sign in";
    box.append(a);
  }

  fetch("/api/auth/me", { cache: "no-store" })
    .then(r => r.json())
    .then(me => {
      if (!me || !me.ok) return;
      if (me.user) accountChip(me.user);
      else if (me.signIn && me.signIn.google) {
        fbMenu.querySelector(".menu-foot").hidden = false;
        signInLink();
      }
    })
    .catch(() => { /* no account info: the menu works the same */ });
})();
