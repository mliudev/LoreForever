// The owner's bar on their own profile (/u/<handle>, lib/profiles.js ownerBar): Make it public / private, and Copy
// link. Talks to functions/api/profile/[action].js.
(() => {
  const bar = document.getElementById("pf-owner");
  if (!bar) return;
  const status = bar.querySelector(".fb-status");
  const say = (msg, good) => {
    status.hidden = !msg;
    status.textContent = msg || "";
    status.classList.toggle("fb-good", Boolean(good));
  };

  bar.addEventListener("click", async e => {
    const set = e.target.closest("[data-set-public]");
    const copy = e.target.closest("[data-copy]");
    if (copy) {
      const url = location.origin + location.pathname;
      try {
        await navigator.clipboard.writeText(url);
        say("Link copied: " + url, true);
      } catch (err) {
        say("Your link: " + url, true);
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
    else { set.disabled = false; say(res.error || "Something went wrong. Please try again."); }
  });
})();
