// Test players on develop (lib/test-players.js, functions/api/test/[action].js): a small panel on /link and /account
// to sign in as Mira, Doran or Brann, make Mira and Doran your friends in one tap, and have Brann accept the friend
// request you sent him by his name. It shows only where the site says test players are on (GET /api/test/status
// answers 404 everywhere else); on the live site it doesn't even ask.
(() => {
  if (/(^|\.)loreforeverwow\.com$/.test(location.hostname)) return;
  // The tester's own day on Mira's pins: minutes from UTC.
  const post = async (path, body) => {
    try {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, offset: -new Date().getTimezoneOffset() }) });
      return await r.json();
    } catch (e) { return { ok: false, error: "Couldn't reach the site." }; }
  };
  const button = (text, onclick) => Object.assign(document.createElement("button"),
    { type: "button", className: "btn-small btn-small-alt", textContent: text, onclick });
  async function start() {
    let status;
    try { status = await (await fetch("/api/test/status", { cache: "no-store" })).json(); } catch (e) { return; }
    if (!status?.on) return;
    const box = document.createElement("section");
    box.className = "tp-panel";
    box.setAttribute("aria-label", "Test players");
    box.style.cssText = "border:1px dashed #c9a24a;border-radius:10px;padding:12px 14px;margin:16px 0;";
    const note = Object.assign(document.createElement("p"), { className: "fb-status", role: "status" });
    note.hidden = true;
    const say = (text, good) => { note.textContent = text; note.hidden = !text; note.classList.toggle("fb-good", Boolean(good)); };
    const row = (...kids) => { const p = document.createElement("p"); p.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0;"; p.append(...kids); return p; };
    box.append(Object.assign(document.createElement("p"), { innerHTML: "<strong>Test players</strong> (develop only: made-up players, never real accounts)" }),
      row(...status.players.map(p => button(`Sign in as ${p.name}`, async () => {
        const res = await post("/api/test/sign-in", { who: p.key });
        if (res.ok) location.reload(); else say(res.error);
      }))),
      row(button("Add the test friends", async () => {
        const res = await post("/api/test/friends");
        say(res.ok ? `${res.added.map(a => a.name).join(" and ")} are your friends now. Doran wrote to you.` : res.error, res.ok);
      }), button("Brann accepts my request", async () => {
        const res = await post("/api/test/accept", { who: "brann" });
        say(!res.ok ? res.error : res.accepted ? "Brann accepted. He's on your friends list now."
          : "Nothing is waiting for Brann. Add him by his name, brann, first.", res.ok && res.accepted > 0);
      })),
      note);
    const main = document.querySelector("main");
    const head = main && main.querySelector("h1");
    if (head) head.after(box); else if (main) main.prepend(box); else document.body.prepend(box);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
