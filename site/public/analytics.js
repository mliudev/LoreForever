// Basic consent: the Google runtime is not requested until an affirmative choice.
// This file is injected by the server only for verified public production pages.
(() => {
  "use strict";
  const config = document.getElementById("lf-analytics");
  // Lore Forever's domain and Willo's (lib/doors.js WILLO_DOMAIN; lib/analytics.js picks the pages on each).
  const willo = location.origin === "https://willocompanion.com";
  if (!config || window.lfAnalyticsStarted || (location.origin !== "https://loreforeverwow.com" && !willo)) return;
  const { id, path, title, kind } = config.dataset;
  if (!/^G-[A-Z0-9]{4,20}$/.test(id || "") || path !== location.pathname) return;
  window.lfAnalyticsStarted = true;
  const KEY = "lf-analytics-consent-v1", AGE = 180 * 86400 * 1000;
  const BLOCK = "lf_analytics_declined";
  const disabled = "ga-disable-" + id;
  window[disabled] = true;
  let active = false, loaded = false, counted = false, navigated = false;
  // The Google runtime can inspect the real URL independently of event fields.
  // Keep query/fragment addresses entirely outside collection (including ?src=).
  const collectable = !location.search && !location.hash;
  let tag = null;
  const remember = choice => {
    try { localStorage.setItem(KEY, JSON.stringify({ choice, at: Date.now() })); } catch { /* current page still works */ }
    // A denial cookie also protects the next page when localStorage cannot be written.
    try { document.cookie = `${BLOCK}=${choice === "denied" ? "1" : ""}; Max-Age=${choice === "denied" ? AGE / 1000 : 0}; Path=/; SameSite=Lax; Secure`; } catch { /* storage may be unavailable */ }
  };
  function remembered() {
    try { if (document.cookie.split(";").some(x => x.trim() === BLOCK + "=1")) return "denied"; } catch { /* try localStorage */ }
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      if (v && ["granted", "denied"].includes(v.choice) && Number.isFinite(v.at) &&
          v.at <= Date.now() && Date.now() - v.at < AGE) return v.choice;
    } catch { /* default off */ }
    return null;
  }
  function clearCookies() {
    try {
      for (const part of document.cookie.split(";")) {
        const name = part.trim().split("=")[0];
        if (!/^_ga(?:_[A-Za-z0-9]+)?$/.test(name)) continue;
        // Our config uses root-path, host-only cookies. Also remove old domain cookies,
        // including path variants left by a previous configuration; never touch login/Sources.
        const paths = new Set(["/", path]);
        const pieces = path.split("/").filter(Boolean);
        for (let i = 1; i <= pieces.length; i++) {
          const prefix = "/" + pieces.slice(0, i).join("/");
          paths.add(prefix); paths.add(prefix + "/");
        }
        for (const p of paths) for (const domain of ["", "; Domain=" + location.hostname, "; Domain=." + location.hostname]) {
          document.cookie = `${name}=; Max-Age=0; Path=${p}${domain}; SameSite=Lax; Secure`;
        }
      }
    } catch { /* no readable cookie storage */ }
  }
  let referrer = "", referrerHost = "";
  try {
    const ref = new URL(document.referrer);
    if (["http:", "https:"].includes(ref.protocol)) {
      referrer = ref.origin + "/";
      if (ref.origin !== location.origin) referrerHost = ref.hostname;
    }
  } catch { /* no referrer */ }
  const searchEngine = [
    ["google", /(^|\.)google\.(com|co\.uk|ca|com\.au|de|fr|co\.jp)$/],
    ["bing", /(^|\.)bing\.com$/],
    ["duckduckgo", /(^|\.)duckduckgo\.com$/],
  ].find(([, host]) => host.test(referrerHost));
  const campaignSource = searchEngine ? searchEngine[0] : referrerHost || "(direct)";
  const campaignMedium = searchEngine ? "organic" : referrerHost ? "referral" : "(none)";
  const page = { page_location: location.origin + path, page_referrer: referrer, page_title: title };
  function gtag() { window.lfAnalyticsData.push(arguments); }
  const send = (name, params = {}) => {
    if (active && !navigated && location.pathname === path) gtag("event", name, { ...page, ...params, send_to: id });
  };
  function countPage() {
    if (!active || !loaded || counted || navigated) return;
    counted = true;
    send("page_view", { content_group: kind });
    if (kind === "article") send("article_view", { article_id: path.slice("/guides/".length) });
  }
  function grant() {
    if (active || navigated || !collectable) return;
    active = true;
    window[disabled] = false;
    window.lfAnalyticsData = window.lfAnalyticsData || [];
    gtag("consent", "default", { analytics_storage: "denied", ad_storage: "denied",
      ad_user_data: "denied", ad_personalization: "denied" });
    gtag("consent", "update", { analytics_storage: "granted", ad_storage: "denied",
      ad_user_data: "denied", ad_personalization: "denied" });
    if (!tag) gtag("js", new Date());
    // Global fields cover automatic session/engagement events too. Never read the DOM
    // title or forward query/hash, campaign values, link text, forms or account data.
    gtag("set", page);
    gtag("config", id, { ...page, send_page_view: false, ignore_referrer: true,
      allow_google_signals: false, allow_ad_personalization_signals: false,
      campaign_source: campaignSource, campaign_medium: campaignMedium, campaign_name: "(not set)",
      campaign_id: "(not set)", campaign_term: "(not set)", campaign_content: "(not set)",
      cookie_domain: "none", cookie_path: "/", cookie_expires: AGE / 1000,
      cookie_flags: "SameSite=Lax;Secure" });
    if (tag) { countPage(); return; }
    tag = document.createElement("script");
    tag.async = true;
    tag.referrerPolicy = "no-referrer";
    tag.src = "https://www.googletagmanager.com/gtag/js?id=" + id + "&l=lfAnalyticsData";
    tag.addEventListener("load", () => { loaded = true; countPage(); });
    document.head.append(tag);
  }
  function stop(erase = false) {
    // ga-disable is checked by Google's runtime, including automatic events. Do not
    // send a consent update here: even a cookieless denial ping would be collection.
    active = false;
    window[disabled] = true;
    if (window.lfAnalyticsData) window.lfAnalyticsData.length = 0;
    if (erase) clearCookies();
  }

  const panel = document.createElement("section");
  panel.className = "lf-analytics-panel";
  panel.setAttribute("aria-label", "Optional analytics");
  panel.innerHTML = (willo ? '<h2>Help improve Willo?</h2><p>Allow Google Analytics to count public page visits and download clicks? Google' :
    '<h2>Help improve Lore Forever?</h2><p>Allow Google Analytics to count public page visits, article reads and download or Discord clicks? Google') + ' receives your connection information and uses analytics cookies. Nothing loads until you allow it. No account details, searches or messages are sent.</p><p><a href="/privacy#optional-analytics">Read about analytics</a></p><div class="lf-analytics-actions"><button type="button" data-choice="granted">Allow analytics</button><button type="button" data-choice="denied">Decline analytics</button></div><p class="lf-analytics-status" role="status"></p>';
  const manage = document.createElement("button");
  manage.type = "button";
  manage.className = "lf-analytics-manage";
  manage.textContent = "Analytics settings";
  manage.setAttribute("aria-expanded", "false");
  const status = panel.querySelector(".lf-analytics-status");
  const deny = panel.querySelector('[data-choice="denied"]');
  const choose = choice => {
    remember(choice);
    if (choice === "granted") grant(); else stop(true);
    panel.hidden = true;
    manage.setAttribute("aria-expanded", "false");
    manage.focus({ preventScroll: true });
  };
  for (const button of panel.querySelectorAll("[data-choice]")) button.addEventListener("click", () => choose(button.dataset.choice));
  manage.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    manage.setAttribute("aria-expanded", String(!panel.hidden));
    status.textContent = active ? "Analytics is on. Withdraw to stop collection and remove analytics cookies." :
      (!collectable || navigated ? "Analytics is off for this address. Your choice applies on public pages without a query or fragment." : "Analytics is off.");
    deny.textContent = active ? "Withdraw analytics" : "Decline analytics";
    if (!panel.hidden) deny.focus();
  });
  document.body.append(panel);
  // Keep consent reachable without leaving a floating prompt after a choice.
  // All public templates have a footer; the fallback keeps controls accessible
  // if a future template omits it.
  (document.querySelector("footer") || document.body).append(manage);
  const choice = remembered();
  panel.hidden = !!choice;
  manage.setAttribute("aria-expanded", String(!panel.hidden));
  if (choice === "granted") grant(); else clearCookies();
  window.addEventListener("storage", e => {
    if (e.key !== KEY && e.key !== null) return;
    // Another tab withdrawing (or clearing consent) stops this tab synchronously.
    if (remembered() !== "granted") { stop(true); panel.hidden = true; manage.setAttribute("aria-expanded", "false"); }
  });
  // This site uses document navigation. If a feature changes the route in-place,
  // freeze collection before it can expose a private route to automatic events.
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function(state, unused, url) {
      if (url != null) {
        try {
          const next = new URL(url, location.href);
          if (next.pathname !== path || next.search || next.hash) { navigated = true; stop(); }
        } catch { /* let history validate */ }
      }
      return original.apply(this, arguments);
    };
  }
  const checkAddress = () => { if (location.pathname !== path || location.search || location.hash) { navigated = true; stop(); } };
  window.addEventListener("popstate", checkAddress);
  window.addEventListener("hashchange", checkAddress);
  window.addEventListener("pagehide", () => stop());
  window.addEventListener("pageshow", e => {
    if (!e.persisted) return;
    // A restored document keeps its one pageview, but must recheck consent changed
    // while cached. Never revive a document already frozen by unsafe navigation.
    checkAddress();
    const saved = remembered();
    if (saved === "granted") grant(); else stop(true);
    panel.hidden = !!saved;
    manage.setAttribute("aria-expanded", String(!panel.hidden));
    status.textContent = active ? "Analytics is on. Withdraw to stop collection and remove analytics cookies." :
      (!collectable || navigated ? "Analytics is off for this address. Your choice applies on public pages without a query or fragment." : "Analytics is off.");
    deny.textContent = active ? "Withdraw analytics" : "Decline analytics";
  });
  document.addEventListener("click", e => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    let url;
    try { url = new URL(a.href, location.href); } catch { return; }
    if (url.origin !== location.origin) return;
    // Stop before the browser applies a same-document hash/query navigation.
    if (url.pathname === path && (url.search || url.hash)) { navigated = true; stop(); return; }
    if (!active || !loaded) return;
    const download = /^\/download\/(installer|zip|complete|willo)$/.exec(url.pathname);
    if (download) send("download_click", { download_type: download[1] });
    else if (url.pathname === "/discord") send("discord_join_click");
  });
})();
