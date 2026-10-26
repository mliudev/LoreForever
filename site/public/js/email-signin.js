// Sign in by email on the site's sign-in cards (/account and Wake Willo, /link; LOR-816, lib/email-signin.js): under
// Google's button, "or use your email", the address and "Email me a code" (quiet until there's an address), then the
// code. The code sends itself at the sixth digit; a wrong or old one clears and says so in one line. "Wrong address?"
// goes back to the first step, and "Send a new code" waits RESEND seconds (what the site's answer says).
// Design: claude.ai/artifact/YYonkjfA1xb9on9iEvnsnZ (signed off by the Design Lead, 10/25).
//
//   LFEmailSignIn.mount(box, {onSignedIn})   fills `box` (a <div hidden>), shows it, and counts the screen once
//                                            (POST /api/auth/shown); onSignedIn runs once the session cookie is set.
// On develop, a test address's code (lib/email-signin.js testCode) shows under the code box instead of being emailed.
(() => {
  const post = async (action, body) => {
    try {
      const r = await fetch("/api/auth/" + action, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}) });
      return await r.json().catch(() => ({ ok: false, error: "Something went wrong. Please try again." }));
    } catch (e) {
      return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
    }
  };

  const HTML = `
    <p class="es-or"><span>or use your email</span></p>
    <form class="es-ask" novalidate>
      <label class="fb-field"><span class="fb-sub">Email</span>
        <input class="es-email" type="email" name="email" autocomplete="email" inputmode="email" maxlength="254"
          placeholder="you@example.com" required></label>
      <button class="btn-small es-send" type="submit" disabled>Email me a code</button>
      <p class="es-line" role="status" hidden></p>
    </form>
    <form class="es-code" novalidate hidden>
      <h3 class="es-title">Check your email</h3>
      <p class="es-sent">We sent a 6-digit code to <b class="es-to"></b>.
        <button class="es-link es-back" type="button">Wrong address?</button></p>
      <label class="es-digits-label"><span class="fb-sub">6-digit code</span>
        <input class="es-digits" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
          pattern="[0-9]*" spellcheck="false"></label>
      <p class="es-line" role="status" hidden></p>
      <p class="es-test vp-note" hidden>Develop test code: <code></code></p>
      <button class="es-link es-again" type="button" disabled>Send a new code</button>
      <p class="vp-note">Not there? Check spam or Promotions. The code works for 10 minutes.</p>
    </form>`;

  function mount(box, { onSignedIn }) {
    if (!box || box.dataset.ready) return;
    box.dataset.ready = "1";
    box.innerHTML = HTML;
    box.hidden = false;
    const q = s => box.querySelector(s);
    const ask = q(".es-ask"), codeForm = q(".es-code"), email = q(".es-email"), send = q(".es-send"), digits = q(".es-digits");
    const again = q(".es-again");
    let address = "", timer = null, busy = false;
    const line = (form, msg) => { const p = form.querySelector(".es-line"); p.hidden = !msg; p.textContent = msg || ""; };

    post("shown");
    email.addEventListener("input", () => { send.disabled = !email.value.trim(); });

    function countdown(seconds) {
      clearInterval(timer);
      let left = seconds;
      const tick = () => {
        again.disabled = left > 0;
        again.textContent = left > 0 ? `Send a new code in 0:${String(left).padStart(2, "0")}` : "Send a new code";
        if (left-- <= 0) clearInterval(timer);
      };
      tick();
      timer = setInterval(tick, 1000);
    }

    async function start(form) {
      const res = await post("email-start", { email: address });
      if (!res.ok) { line(form, res.error); return false; }
      address = res.to || address;
      q(".es-to").textContent = address;
      q(".es-test").hidden = !res.testCode;
      q(".es-test code").textContent = res.testCode || "";
      ask.hidden = true;
      codeForm.hidden = false;
      line(codeForm, "");
      digits.value = "";
      digits.focus();
      countdown(res.resend_after || 30);
      return true;
    }

    ask.addEventListener("submit", async e => {
      e.preventDefault();
      address = email.value.trim();
      if (!address || busy) return;
      busy = true; send.disabled = true;
      line(ask, "");
      await start(ask);
      busy = false; send.disabled = !email.value.trim();
    });

    async function verify() {
      if (busy) return;
      busy = true;
      const res = await post("email-verify", { email: address, code: digits.value });
      busy = false;
      if (res.ok) { clearInterval(timer); onSignedIn(); return; }
      digits.value = "";
      digits.focus();
      line(codeForm, res.error);
    }
    digits.addEventListener("input", () => {
      const only = digits.value.replace(/\D/g, "").slice(0, 6);
      if (only !== digits.value) digits.value = only;
      if (only.length === 6) verify();
    });
    codeForm.addEventListener("submit", e => { e.preventDefault(); if (digits.value.length === 6) verify(); });

    q(".es-back").addEventListener("click", () => {
      clearInterval(timer);
      codeForm.hidden = true;
      ask.hidden = false;
      line(ask, "");
      email.focus();
      email.select();
    });
    again.addEventListener("click", async () => {
      if (busy) return;
      busy = true; again.disabled = true;
      if (!(await start(codeForm))) again.disabled = false;
      busy = false;
    });
  }

  window.LFEmailSignIn = { mount };
})();
