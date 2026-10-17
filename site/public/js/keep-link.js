// Willo runs on a Windows PC, so phones and tablets get a way to keep her link for the PC: on the home page's Willo
// door (home.css .h-phone) and on /willo (lib/willo.js, willo.css .wl-phone), both shown only on touch screens. Each
// button[data-keep] opens the share sheet where there is one (send it to yourself), else copies the link, else shows
// the address to copy by hand.
(() => {
  for (const button of document.querySelectorAll("button[data-keep]")) {
    const url = button.dataset.keep;
    if (navigator.share) button.textContent = "Send the link to your PC";
    button.addEventListener("click", async () => {
      if (navigator.share) {
        try {
          await navigator.share({ title: "Willo", url });
          return;
        } catch (e) {
          if (e.name === "AbortError") return;   // closed the sheet; anything else (no share target): copy it instead
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        button.textContent = "Link copied";
      } catch (e) {
        const code = document.createElement("code");
        code.textContent = url;
        button.replaceWith(code);
      }
    });
  }
})();
