// The frame every private dashboard page shares (/admin, /admin/voices, /admin/edits): the header with its breadcrumb
// and Sign out, the row of tabs, the sign-in form and the title bar with Updated and Refresh. Each page loads this
// first thing in <body>, before its own markup, so the frame is drawn before anything else and looks the same on every
// page; the page's own script then finds #nav, #login, #refresh, #updated and #signout already there. A file rather
// than inline because /admin's Content-Security-Policy (public/_headers) runs no inline script.
//
// A page names itself on <body>: data-page="dashboard" | "voices" | "edits", and data-title (its heading). Its script
// talks to the frame through window.lfAdmin:
//   key()                 the admin key, from sessionStorage, or localStorage when "Remember" was ticked
//   signOut(message)      forgets the key and shows the sign-in form (with the message, if any)
//   start(load)           wires sign-in, Sign out and Refresh to the page's load(), then loads or asks for the key
//   updated()             "Updated 3:41 PM" in the title bar, after a load
//   current(tab, trail)   marks the tab and sets the breadcrumb, heading and window title: trail is
//                         [[label, href?], ...] after "Dashboard"; the last one is the page's heading

(() => {
  const TABS = [["overview", "Overview"], ["growth", "Growth"], ["players", "Players"], ["costs", "Costs"],
                ["community", "Community"], ["voices", "Voice work"]];
  const body = document.body;
  const page = body.dataset.page || "dashboard";
  // On /admin the dashboard's tabs are the address's # (admin-page.js); from the other pages they go back to /admin.
  const tabHref = id => id === "voices" ? "/admin/voices" : (page === "dashboard" ? "" : "/admin") + "#" + id;
  const $ = id => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
    }
    n.append(...kids.filter(k => k != null));
    return n;
  };

  // ---- the admin key: sessionStorage, or localStorage when "Remember" is ticked (best effort: storage can be blocked) ----
  let memoryKey = null;   // used when storage is blocked
  function storedKey() {
    try { return sessionStorage.getItem("lf-admin") || localStorage.getItem("lf-admin"); } catch (e) { return null; }
  }
  function setKey(k, remember) {
    memoryKey = k;
    try { sessionStorage.removeItem("lf-admin"); localStorage.removeItem("lf-admin"); } catch (e) {}
    if (k) try { (remember ? localStorage : sessionStorage).setItem("lf-admin", k); } catch (e) {}
  }
  const key = () => memoryKey || storedKey();

  // ---- the frame ----
  const crumbs = el("ol");
  const header = el("header", { class: "ad-top" }, el("div", { class: "wrap ad-top-row" },
    el("a", { class: "ad-brand", href: "/" }, el("img", { src: "/img/logo.svg", alt: "", width: "26", height: "26" }),
      el("span", { text: "Lore Forever" })),
    el("nav", { class: "ad-crumbs", "aria-label": "Breadcrumb" }, crumbs),
    el("button", { type: "button", class: "ad-link ad-signout", id: "signout", text: "Sign out" })));

  // The Community tab's gold badge counts what waits on you there; admin-page.js fills it in.
  const nav = el("nav", { class: "ad-nav", id: "nav", "aria-label": "Dashboard" }, el("div", { class: "wrap ad-nav-row" },
    ...TABS.map(([id, label]) => el("a", { href: tabHref(id), "data-tab": id }, el("span", { text: label }),
      id === "community" ? el("span", { class: "ad-badge", id: "n-community" }) : null))));

  const title = body.dataset.title || "Dashboard";
  const login = el("main", { class: "wrap ad-login", id: "login", hidden: "" }, el("div", { class: "ad-panel" },
    el("h1", { text: title }),
    el("p", { class: "ad-count", text: "The dashboard's admin key. Signing in here signs in every dashboard page." }),
    el("form", { id: "login-form" },
      el("label", { for: "key", text: "Admin key" }),
      el("input", { type: "password", id: "key", autocomplete: "current-password", required: "" }),
      el("label", { class: "ad-check" }, el("input", { type: "checkbox", id: "remember" }), " Remember on this device"),
      el("button", { type: "submit", class: "ad-btn ad-btn-main", text: "Sign in" }),
      el("p", { class: "ad-error", id: "login-error", role: "alert", hidden: "" }))));

  const bar = el("div", { class: "wrap ad-bar" },
    el("h1", { id: "ad-title", text: title }),
    el("span", { class: "ad-meta" }, el("span", { id: "updated" }),
      el("button", { type: "button", class: "ad-btn", id: "refresh", text: "Refresh" })));
  const loading = el("p", { class: "wrap ad-loading", role: "status", text: "Loading…" });

  body.prepend(header, nav, login, bar, loading);

  // ---- where you are: the tab, the breadcrumb, the heading and the window title ----
  function current(tab, trail) {
    nav.querySelectorAll("a[data-tab]").forEach(a => {
      if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    const steps = [["Dashboard", page === "dashboard" ? "#overview" : "/admin"], ...(trail || [])];
    crumbs.replaceChildren(...steps.map(([label, href], i) => i === steps.length - 1
      ? el("li", { "aria-current": "page", text: label })
      : el("li", {}, el("a", { href, text: label }))));
    const heading = steps.at(-1)[0];
    $("ad-title").textContent = heading;
    document.title = (heading === "Dashboard" ? "" : heading + " - ") + "Dashboard - Lore Forever";
  }
  const PAGE_TRAIL = {
    voices: ["voices", [["Voice work"]]],
    edits: ["community", [["Community", "/admin#community"], ["Translation edits"]]],
  };
  if (PAGE_TRAIL[page]) current(...PAGE_TRAIL[page]); else current(null, []);

  function signOut(message) {
    setKey(null);
    $("dash").hidden = true;
    login.hidden = false;
    $("login-error").textContent = message || "";
    $("login-error").hidden = !message;
  }

  function start(load) {
    $("login-form").addEventListener("submit", e => {
      e.preventDefault();
      setKey($("key").value.trim(), $("remember").checked);
      $("key").value = "";
      load();
    });
    $("signout").addEventListener("click", () => signOut());
    $("refresh").addEventListener("click", load);
    if (key()) load(); else signOut();
  }

  const updated = () => {
    $("updated").textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  window.lfAdmin = { key, signOut, start, updated, current };
})();
