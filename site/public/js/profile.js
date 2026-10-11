// The buttons on a profile (/u/<handle>, lib/profiles.js). Share (LOR-150), for everyone: the share sheet, or the link
// copied (public/js/share.js), then where else to post it. The owner's bar (ownerBar): Make it public / private, View
// as a visitor (LOR-302) and Copy map link / Copy timeline link (LOR-248); in visitor view (visitorBar) Back to my view
// and, while it's private, Make it public. Talks to functions/api/profile/[action].js.
(() => {
  // Each bar ([data-bar]) has its own status line.
  const say = (el, msg, good) => {
    const status = el.closest("[data-bar]")?.querySelector(".fb-status");
    if (!status) return;
    status.hidden = !msg;
    status.replaceChildren(...[].concat(msg || []));
    status.classList.toggle("fb-good", Boolean(good));
  };
  const link = (label, href) => Object.assign(document.createElement("a"), { href, textContent: label, target: "_blank", rel: "noopener" });
  // After copying: Discord takes the pasted link as it is; X, Bluesky and Reddit have a page to post it from.
  const postIt = (url, text) => {
    const u = encodeURIComponent(url), t = encodeURIComponent(text);
    return ["Link copied. Paste it in Discord, or post it on ", link("X", `https://x.com/intent/post?text=${t}&url=${u}`), ", ",
      link("Bluesky", `https://bsky.app/intent/compose?text=${t}%20${u}`), " or ",
      link("Reddit", `https://www.reddit.com/submit?url=${u}&title=${t}`), "."];
  };
  // A shared or copied link adds one to the day's count (functions/api/count/[what].js, LOR-151): only the number.
  const counted = () => { try { navigator.sendBeacon("/api/count/share"); } catch (e) {} };

  document.addEventListener("click", async e => {
    const share = e.target.closest("[data-share]");
    const copy = e.target.closest("[data-copy]");
    const set = e.target.closest("[data-set-public]");
    const keep = e.target.closest("a[data-keep-view]");
    if (keep && /^#(map|timeline)$/.test(location.hash)) keep.hash = location.hash;   // the same view on the other side
    if (share) {
      if (share.closest("[data-public='0']")) {
        say(share, "Only you can see this page, so a link would show others \"No profile here\". Make it public first, then share it.");
        return;
      }
      const url = location.origin + location.pathname, text = share.dataset.shareText;
      const done = await window.lfShare({ url, text });
      if (done === "shared" || done === "copied") counted();
      say(share, done === "copied" ? postIt(url, text) : done === "failed" ? "Your link: " + url : "", true);
    }
    if (copy) {
      // The page, or the link that opens it on the map or the timeline (LOR-248).
      const view = copy.dataset.copy;
      const url = location.origin + location.pathname + (view === "map" || view === "timeline" ? "#" + view : "");
      try {
        await navigator.clipboard.writeText(url);
        counted();
        say(copy, "Link copied: " + url, true);
      } catch (err) {
        say(copy, "Your link: " + url, true);
      }
    }
    if (!set) return;
    set.disabled = true;
    let res;
    try {
      res = await (await fetch("/api/profile/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public: set.dataset.setPublic === "1" }),
      })).json();
    } catch (err) {
      res = { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
    }
    if (res.ok) location.reload();
    else { set.disabled = false; say(set, res.error || "Something went wrong. Please try again."); }
  });
})();
