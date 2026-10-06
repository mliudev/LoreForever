// The picture book on a profile (/u/<handle>, lib/pictures.js picturesSection): a picture opens large in a dialog with
// its place, day, level and caption; the arrows (buttons or keys) go through the book and Esc closes it. The owner can
// remove a picture there (DELETE /api/profile/pictures?id=), anyone else can report one (POST
// /api/profile/pictures/report). Without this script each picture is a link to its image.
(() => {
  const root = document.getElementById("pictures");
  const dlg = document.getElementById("pb-view");
  if (!root || !dlg || !dlg.showModal) return;
  const big = dlg.querySelector(".pb-big");
  const status = dlg.querySelector(".pb-status");
  const say = (msg, good) => {
    status.hidden = !msg;
    status.textContent = msg || "";
    status.classList.toggle("fb-good", Boolean(good));
  };
  const shots = () => [...root.querySelectorAll("a.pb-shot")];
  let at = -1;

  function show(i) {
    const list = shots();
    if (!list.length) { dlg.close(); return; }
    at = (i + list.length) % list.length;
    const a = list[at], item = a.closest(".pb-item"), img = a.querySelector("img");
    big.src = a.href;
    big.alt = img.alt;
    for (const k of ["width", "height"]) {
      if (img.getAttribute(k)) big.setAttribute(k, img.getAttribute(k)); else big.removeAttribute(k);
    }
    for (const k of ["where", "when", "cap"]) dlg.querySelector(".pb-" + k).textContent = item.querySelector(".pb-" + k)?.textContent || "";
    for (const b of dlg.querySelectorAll('[data-pb="prev"], [data-pb="next"]')) b.hidden = list.length < 2;
    const act = dlg.querySelector('[data-pb="remove"], [data-pb="report"]');
    if (act) act.disabled = false;
    say("");
  }

  root.addEventListener("click", e => {
    const a = e.target.closest("a.pb-shot");
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    show(shots().indexOf(a));
    if (!dlg.open) dlg.showModal();
  });
  dlg.addEventListener("keydown", e => {
    if (e.key === "ArrowRight") show(at + 1);
    else if (e.key === "ArrowLeft") show(at - 1);
  });
  // Focus goes back to the picture that was open.
  dlg.addEventListener("close", () => shots()[at]?.focus({ preventScroll: true }));

  dlg.addEventListener("click", async e => {
    if (e.target === dlg) { dlg.close(); return; }   // the backdrop
    const b = e.target.closest("[data-pb]");
    if (!b) return;
    const act = b.dataset.pb;
    if (act === "close") dlg.close();
    else if (act === "prev") show(at - 1);
    else if (act === "next") show(at + 1);
    if (act !== "remove" && act !== "report") return;
    const item = shots()[at]?.closest(".pb-item");
    if (!item) return;
    const id = item.id.replace(/^p-/, "");
    if (act === "report" && !confirm("Report this picture? Pictures reported by several people are taken down.")) return;
    b.disabled = true;
    let res;
    try {
      res = await (await fetch(act === "remove" ? "/api/profile/pictures?id=" + encodeURIComponent(id) : "/api/profile/pictures/report", act === "remove"
        ? { method: "DELETE" }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })).json();
    } catch (err) {
      res = { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
    }
    if (!res.ok) { b.disabled = false; say(res.error || "Something went wrong. Please try again."); return; }
    if (act === "report") { say("Thanks for telling us.", true); return; }
    // Removed: the next picture takes its place, or the book closes when it was the last one.
    const fold = item.closest(".pb-older");
    item.remove();
    if (fold && !fold.querySelector(".pb-item")) fold.remove();
    if (shots().length) show(at); else dlg.close();
  });
})();
