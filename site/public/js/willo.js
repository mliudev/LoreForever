// Willo, your way (/willo, LOR-447): Willo's style (a preset, and from Champion your own words) and, from Champion,
// your own tales of the characters you meet, found by name. It all goes through /api/willo (functions/api/willo.js); the
// character search is /api/willo/npcs. The server checks each plan's limits again, so this page only hides what a plan
// doesn't have. Signed out it offers sign-in; on the free plan, the way to /plans; while plans are off, says so.
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const chars = s => [...String(s)].length;   // characters as the server counts them
  const TRY_AGAIN = "Something went wrong. Please try again.";
  let data = null;      // the last answer from /api/willo
  let editing = null;   // the tale being written: {npc, name}

  const say = (id, msg, good) => {
    $(id).hidden = !msg;
    $(id).textContent = msg || "";
    $(id).classList.toggle("fb-good", Boolean(good));
  };
  const plansLink = () => el("a", { href: "/plans", textContent: "See plans" });

  // One call to /api/willo: its JSON with the HTTP status, or {ok: false, error} when the server can't be reached.
  async function call(method, body, query = "") {
    try {
      const r = await fetch("/api/willo" + query, { method, cache: "no-store",
        headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, ...(await r.json().catch(() => ({ ok: false }))) };
    } catch (e) { return { ok: false, error: "Couldn't reach the server. Check your connection and try again." }; }
  }

  // "120 of 300 characters" under a text box, red past the limit.
  const count = (area, out, max) => {
    const n = chars(area.value);
    out.textContent = `${n} of ${max} characters`;
    out.classList.toggle("wl-over", n > max);
  };

  // ---- Willo's style ----

  function showStyle() {
    const s = data.style, words = data.allowed.includes("words");
    $("wl-presets").replaceChildren(...data.presets.map(p => el("label", { className: "wl-preset" },
      el("input", { type: "radio", name: "wl-preset", value: p.id, checked: p.id === s.preset }),
      el("strong", { textContent: p.name }), el("span", { textContent: p.blurb }))));
    $("wl-words-box").hidden = !words;
    $("wl-words").value = s.text;
    count($("wl-words"), $("wl-words-count"), data.limits.style);
    // Words the check turned away stay saved, with why, until they're changed.
    const turned = words && s.status === "rejected" && s.text;
    $("wl-words-why").hidden = !turned;
    $("wl-words-why").textContent = turned ? `Willo isn't using these words: ${s.reason}` : "";
    $("wl-words-up").hidden = words;
    $("wl-words-up").replaceChildren("Describing Willo's style in your own words comes with Champion." +
      (s.text ? " Yours are saved for when you have it. " : " "), plansLink());
  }

  $("wl-words").addEventListener("input", () => count($("wl-words"), $("wl-words-count"), data.limits.style));

  $("wl-style-save").addEventListener("click", async () => {
    const body = { kind: "style", preset: document.querySelector("input[name=wl-preset]:checked")?.value || "classic" };
    // Without own words on this plan the text isn't sent, so words saved on a bigger plan stay.
    if (data.allowed.includes("words")) {
      body.text = $("wl-words").value;
      if (chars(body.text.trim()) > data.limits.style) return say("wl-style-status", `Keep your own words to ${data.limits.style} characters.`);
    }
    $("wl-style-save").disabled = true;
    const res = await call("PUT", body);
    $("wl-style-save").disabled = false;
    if (res.ok || res.rejected) { data = res; showStyle(); }
    say("wl-style-status", res.ok ? "Saved. Willo talks this way from your next question."
      : res.rejected ? "Saved, but your own words need a change before Willo uses them." : res.error || TRY_AGAIN, res.ok);
  });

  // ---- Your tales ----

  const nameOf = t => t.name || t.npc.replace(/^npc:/, "").replace(/[-_]+/g, " ");

  function showTales() {
    const can = data.allowed.includes("tales"), n = data.tales.length;
    $("wl-tales").hidden = !can;
    $("wl-tales-max").textContent = data.limits.tales;
    $("wl-tales-up").hidden = can;
    if (!can) {
      $("wl-tales-up").replaceChildren(n ? `Your ${n} saved ${n === 1 ? "tale comes" : "tales come"} back with Champion. `
        : "Writing your own tales of the characters you meet comes with Champion. ", plansLink());
    }
    $("wl-list").replaceChildren(...data.tales.map(taleItem));
  }

  function taleItem(t) {
    const name = nameOf(t);
    const li = el("li", { className: "wl-tale" },
      el("p", { className: "wl-tale-head" }, el("strong", { textContent: name }), t.zone ? el("span", { textContent: t.zone }) : ""),
      el("p", { className: "wl-tale-text", textContent: t.text }));
    if (t.status === "rejected") li.append(el("p", { className: "wl-why", textContent: `Not in use: ${t.reason}` }));
    const edit = el("button", { type: "button", className: "btn-small btn-small-alt", textContent: "Edit" });
    edit.addEventListener("click", () => open({ npc: t.npc, name }));
    const del = el("button", { type: "button", className: "btn-small btn-small-alt", textContent: "Delete" });
    del.addEventListener("click", async () => {
      if (!confirm(`Delete your tale of ${name}?`)) return;
      del.disabled = true;
      const res = await call("DELETE", null, "?kind=tale&npc=" + encodeURIComponent(t.npc));
      if (!res.ok) { del.disabled = false; return say("wl-tale-status", res.error || TRY_AGAIN); }
      data = res;
      if (editing?.npc === t.npc) close();
      showTales();
      say("wl-tale-status", `Deleted your tale of ${name}.`, true);
    });
    li.append(el("p", { className: "wl-tale-tools" }, edit, del));
    return li;
  }

  // Writing a tale: a saved one to change, or a new one while there's room.
  function open(who) {
    const saved = data.tales.find(t => t.npc === who.npc);
    if (!saved && data.tales.length >= data.limits.tales)
      return say("wl-tale-status", `You have ${data.limits.tales} tales. Delete one to write another.`);
    editing = who;
    say("wl-tale-status", "");
    $("wl-who").textContent = who.name;
    $("wl-tale").value = saved?.text || "";
    count($("wl-tale"), $("wl-tale-count"), data.limits.tale);
    $("wl-find").value = "";
    $("wl-found").replaceChildren();
    $("wl-edit").hidden = false;
    $("wl-tale").focus();
  }
  function close() { editing = null; $("wl-edit").hidden = true; }

  $("wl-tale").addEventListener("input", () => count($("wl-tale"), $("wl-tale-count"), data.limits.tale));
  $("wl-tale-cancel").addEventListener("click", () => { close(); say("wl-tale-status", ""); });

  $("wl-tale-save").addEventListener("click", async () => {
    if (!editing) return;
    const who = editing, text = $("wl-tale").value;
    if (!text.trim()) return say("wl-tale-status", "Write your tale first.");
    if (chars(text.trim()) > data.limits.tale) return say("wl-tale-status", `Keep it to ${data.limits.tale} characters.`);
    $("wl-tale-save").disabled = true;
    const res = await call("PUT", { kind: "tale", npc: who.npc, text });
    $("wl-tale-save").disabled = false;
    if (res.ok || res.rejected) { data = res; showTales(); }
    if (res.ok) close();
    say("wl-tale-status", res.ok ? `Saved. Talk to ${who.name} in game to meet your version.`
      : res.rejected ? `Saved, but Willo can't use it yet: ${res.error}` : res.error || TRY_AGAIN, res.ok);
  });

  // The character search: the lore pages' characters, as you type.
  let timer = 0, asked = 0;
  $("wl-find").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(find, 200); });
  async function find() {
    const q = $("wl-find").value.trim(), mine = ++asked;
    if (q.length < 2) return $("wl-found").replaceChildren();
    let res;
    try { res = await (await fetch("/api/willo/npcs?q=" + encodeURIComponent(q), { cache: "no-store" })).json(); } catch (e) { res = null; }
    if (mine !== asked) return;   // a newer search is on its way
    const hits = res?.npcs || [];
    $("wl-found").replaceChildren(...(hits.length ? hits.map(h => {
      const pick = el("button", { type: "button", className: "wl-pick" }, el("strong", { textContent: h.name }),
        h.zone ? el("span", { textContent: h.zone }) : "");
      pick.addEventListener("click", () => open({ npc: h.npc, name: h.name }));
      return el("li", {}, pick);
    }) : [el("li", { className: "vp-note", textContent: res?.ok ? "No character by that name has a story with us yet." : "Couldn't search just now." })]));
  }

  // ---- The page ----

  async function load() {
    const res = await call("GET");
    if (res.status === 401) { $("wl-signin").hidden = false; return; }
    if (!res.ok) return say("wl-status", res.error || "Couldn't load this page. Please reload.");
    data = res;
    // The free plan: what a plan adds, and nothing to change.
    $("wl-free").hidden = data.allowed.length > 0;
    $("wl-on").hidden = !data.allowed.length;
    if (!data.allowed.length) return;
    showStyle();
    showTales();
  }

  load();
})();
