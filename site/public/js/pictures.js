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
  let at = -1, opener = null;
  const timeline = document.getElementById("timeline");
  const preview = document.createElement("img");
  preview.className = "pf-picture-preview";
  preview.alt = "";
  preview.hidden = true;
  preview.setAttribute("aria-hidden", "true");
  document.body.append(preview);
  let previewLink = null, dismissed = null;
  function hidePreview() { preview.hidden = true; previewLink = null; }
  function closeView() { dismissed = opener; hidePreview(); dlg.close(); }
  dlg.addEventListener("cancel", () => { dismissed = opener; hidePreview(); });
  function peek(a) {
    if (!a || a === dismissed || a.hidden || dlg.open || a.querySelector("img")?.dataset.failed) return;
    previewLink = a;
    preview.src = a.href;
    preview.hidden = false;
    const box = a.getBoundingClientRect(), width = Math.min(480, innerWidth - 32);
    const height = Math.min(width * Number(a.querySelector("img").getAttribute("height")) / Number(a.querySelector("img").getAttribute("width")), innerHeight - 32);
    preview.style.width = width + "px";
    preview.style.maxHeight = (innerHeight - 32) + "px";
    preview.style.left = Math.max(16, Math.min(innerWidth - width - 16, box.right + 12)) + "px";
    preview.style.top = Math.max(16, Math.min(innerHeight - height - 16, box.top)) + "px";
  }
  timeline?.addEventListener("pointerover", e => {
    if (e.pointerType === "mouse") peek(e.target.closest(".pf-picture"));
  });
  timeline?.addEventListener("pointerout", e => {
    const a = e.target.closest(".pf-picture");
    if (a && !a.contains(e.relatedTarget)) { dismissed = null; hidePreview(); }
  });
  timeline?.addEventListener("focusin", e => peek(e.target.closest(".pf-picture")));
  timeline?.addEventListener("focusout", () => { dismissed = null; hidePreview(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && previewLink) { dismissed = previewLink; hidePreview(); }
  });
  window.addEventListener("scroll", hidePreview, true);
  window.addEventListener("resize", hidePreview);
  preview.addEventListener("error", hidePreview);
  // A failed image never removes its event or leaves a broken thumbnail in the row.
  for (const img of timeline?.querySelectorAll(".pf-picture img") || []) {
    const failed = () => { img.dataset.failed = "1"; img.closest(".pf-picture").hidden = true; hidePreview(); };
    img.addEventListener("error", failed);
    if (img.complete && !img.naturalWidth) failed();
  }

  function show(i) {
    const list = shots();
    if (!list.length) { closeView(); return; }
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

  document.addEventListener("click", e => {
    const link = e.target.closest("a.pb-shot, a.pf-picture");
    const a = link?.matches(".pf-picture") ? shots().find(s => s.closest(".pb-item").id === "p-" + link.dataset.pbTarget) : link;
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    opener = link;
    hidePreview();
    show(shots().indexOf(a));
    if (!dlg.open) dlg.showModal();
  });
  dlg.addEventListener("keydown", e => {
    if (e.key === "ArrowRight") show(at + 1);
    else if (e.key === "ArrowLeft") show(at - 1);
  });
  // Focus goes back to the picture that was open.
  dlg.addEventListener("close", () => {
    dismissed = opener;
    hidePreview();
    (opener?.isConnected ? opener : shots()[at])?.focus({ preventScroll: true });
  });

  dlg.addEventListener("click", async e => {
    if (e.target === dlg) { closeView(); return; }   // the backdrop
    const b = e.target.closest("[data-pb]");
    if (!b) return;
    const act = b.dataset.pb;
    if (act === "close") closeView();
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
    for (const link of timeline?.querySelectorAll(".pf-picture") || []) {
      if (link.dataset.pbTarget === id) link.remove();
    }
    item.remove();
    if (fold && !fold.querySelector(".pb-item")) fold.remove();
    if (shots().length) show(at); else closeView();
  });
})();
