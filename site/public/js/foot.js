// The footer's optional email sign-up (style.css .h-foot, on the home page, /willo, /plans and /downloads): the address
// goes to /api/subscribe (functions/api/subscribe.js), saved with the form's data-source, the page it came from.
// Downloads never wait on it.
(() => {
  const form = document.getElementById("signup");
  if (!form) return;
  form.addEventListener("submit", e => {
    e.preventDefault();
    const data = JSON.stringify({ email: form.email.value, source: form.dataset.source, website: form.website.value });
    const blob = new Blob([data], { type: "application/json" });
    if (!(navigator.sendBeacon && navigator.sendBeacon("/api/subscribe", blob))) {
      fetch("/api/subscribe", { method: "POST", body: blob, keepalive: true }).catch(() => {});
    }
    document.getElementById("signup-note").hidden = false;
    form.reset();
  });
})();
