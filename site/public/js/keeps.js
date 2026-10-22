// What Willo keeps (/willo/keeps, LOR-666): everything Willo keeps about the signed-in player, from GET /api/keeps/all
// (functions/api/keeps/[action].js, lib/willo-keeps.js). Each section is one kind of kept thing; each item can be
// changed (where the section allows it) or erased, a section can be erased whole, and Erase everything erases it all.
// Erase asks once more on the same button ("Tap again to erase"), so a stray tap on a phone erases nothing.
// A character picker shows one character's things, or everything.
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const TRY_AGAIN = "Something went wrong. Please try again.";
  const SHOWN = 20;          // items a section shows before "Show more"
  let data = null;           // the last GET /api/keeps/all
  let only = "";             // the character shown ("" for everything)
  const open = new Set();    // sections showing every item

  const say = (id, msg, good) => {
    $(id).hidden = !msg;
    $(id).textContent = msg || "";
    $(id).classList.toggle("fb-good", Boolean(good));
  };

  async function call(action, body) {
    try {
      const r = await fetch("/api/keeps/" + action, { method: body ? "POST" : "GET", cache: "no-store",
        headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, ...(await r.json().catch(() => ({ ok: false }))) };
    } catch (e) { return { ok: false, error: "Couldn't reach the server. Check your connection and try again." }; }
  }

  const when = iso => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const day = d.toLocaleDateString(undefined, { month: "short", day: "numeric",
      ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
    return `${day}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  };
  const charName = key => data.characters.find(c => c.key === key)?.name || key;

  // A button that asks once more before it acts: the first tap turns it into "Tap again to erase" for a few seconds.
  function twoTap(label, run) {
    const b = el("button", { type: "button", className: "wk-erase", textContent: label });
    let armed = 0;
    b.addEventListener("click", async () => {
      if (!armed) {
        b.textContent = "Tap again to erase";
        b.classList.add("wk-armed");
        armed = setTimeout(() => { armed = 0; b.textContent = label; b.classList.remove("wk-armed"); }, 4000);
        return;
      }
      clearTimeout(armed);
      armed = 0;
      b.disabled = true;
      await run();
      b.disabled = false;
    });
    return b;
  }

  function itemRow(section, item) {
    const li = el("li", { className: "wk-item" + (item.done ? " wk-done" : "") });
    const text = el("p", { className: "wk-text", textContent: item.text });
    // A reminder at a time shows that time (on this device's clock), not when it was set.
    const meta = el("p", { className: "wk-meta" }, [item.due ? `At ${when(item.due)}` : "", item.detail,
      item.due ? "" : when(item.when)].filter(Boolean).join(" · "));
    li.append(text, meta);
    if (item.image) li.append(el("a", { href: item.image, target: "_blank", rel: "noopener", textContent: "View saved screenshot" }));
    if (item.reply) {
      li.append(el("details", { className: "wk-reply" }, el("summary", { textContent: "What she said" }),
        el("p", { textContent: item.reply })));
    }
    const status = el("p", { className: "fb-status", role: "status", hidden: true });
    const tools = el("p", { className: "wk-tools" });
    if (section.edit) {
      const change = el("button", { type: "button", className: "wk-change", textContent: "Change" });
      change.addEventListener("click", () => editRow(section, item, li, text, tools, status));
      tools.append(change);
    }
    tools.append(twoTap("Erase", async () => {
      const res = await call("erase", { section: section.id, id: item.id });
      if (!res.ok) { status.hidden = false; status.textContent = res.error || TRY_AGAIN; return; }
      section.items = section.items.filter(i => i !== item);
      show();
      say("wk-status", "Erased.", true);
    }));
    li.append(tools, status);
    return li;
  }

  function editRow(section, item, li, text, tools, status) {
    const box = el("textarea", { className: "wk-edit", rows: 3, value: item.text, maxLength: 2000 });
    box.setAttribute("aria-label", "Change it");
    const save = el("button", { type: "button", className: "btn-small", textContent: "Save" });
    const cancel = el("button", { type: "button", className: "btn-small btn-small-alt", textContent: "Cancel" });
    const row = el("div", { className: "fb-actions" }, save, cancel);
    text.replaceWith(box);
    tools.replaceWith(row);
    box.focus();
    cancel.addEventListener("click", () => { box.replaceWith(text); row.replaceWith(tools); status.hidden = true; });
    save.addEventListener("click", async () => {
      save.disabled = true;
      const res = await call("edit", { section: section.id, id: item.id, text: box.value });
      save.disabled = false;
      if (!res.ok) { status.hidden = false; status.textContent = res.error || TRY_AGAIN; return; }
      Object.assign(item, res.item);
      show();
      say("wk-status", "Saved.", true);
    });
  }

  const shownFor = item => !only || item.character === only;

  function sectionCard(section) {
    const items = section.items.filter(shownFor);
    const card = el("section", { className: "fb-form wk-card" });
    card.setAttribute("aria-label", section.title);
    card.append(el("h2", { textContent: section.title }), el("p", { className: "vp-note", textContent: section.about }));
    if (section.kept) card.append(el("p", { className: "wk-kept", textContent: section.kept }));
    if (section.id === "answers") card.append(keepSwitch());
    if (section.id === "screenshots") card.append(screenshotSwitch());
    if (!items.length) {
      card.append(el("p", { className: "wk-none", textContent: section.empty || "Nothing kept." }));
      return card;
    }
    // Under each character's name, or "All characters" for what's for all of them, those first.
    const groups = new Map();
    for (const item of items) {
      const k = item.character || "";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(item);
    }
    let left = open.has(section.id) ? Infinity : SHOWN;
    for (const [k, list] of [...groups].sort(([a], [b]) => (a ? 1 : 0) - (b ? 1 : 0))) {
      if (left <= 0) break;
      card.append(el("h3", { className: "wk-who", textContent: k ? charName(k) : "All characters" }));
      card.append(el("ul", { className: "wk-list" }, ...list.slice(0, left).map(item => itemRow(section, item))));
      left -= list.length;
    }
    const hidden = items.length - (open.has(section.id) ? items.length : SHOWN);
    const foot = el("p", { className: "wk-foot" });
    if (hidden > 0) {
      const more = el("button", { type: "button", className: "btn-small btn-small-alt", textContent: `Show ${hidden} more` });
      more.addEventListener("click", () => { open.add(section.id); show(); });
      foot.append(more);
    }
    if (section.more) foot.append(el("span", { className: "vp-note", textContent: "Only the newest are shown." }));
    // With one character picked, only theirs.
    foot.append(twoTap("Erase all of these", async () => {
      const res = await call("erase-section", { section: section.id, ...(only ? { character: only } : {}) });
      if (!res.ok) return say("wk-status", res.error || TRY_AGAIN);
      section.items = section.items.filter(i => !shownFor(i));
      show();
      say("wk-status", `Erased: ${section.title.toLowerCase()}.`, true);
    }));
    card.append(foot);
    return card;
  }

  // "Help improve Willo's answers", from the page: off stops keeping at once; her app's own switch follows.
  function keepSwitch() {
    const on = data.keep_answers !== false;
    const box = el("input", { type: "checkbox", checked: on });
    const label = el("label", { className: "fb-check wk-switch" }, box,
      el("span", { textContent: "Keep my questions for 14 days (Help improve Willo's answers). " +
        (on ? "On." : "Off: nothing new is kept.") }));
    box.addEventListener("change", async () => {
      box.disabled = true;
      const res = await call("keep-answers", { on: box.checked });
      box.disabled = false;
      if (!res.ok) { box.checked = !box.checked; return say("wk-status", res.error || TRY_AGAIN); }
      data.keep_answers = res.on;
      if (!res.on) data.keep_screenshots = false;
      show();
      say("wk-status", res.on ? "On. Willo keeps your questions for 14 days again."
        : "Off. Nothing new is kept, and Willo's own switch turns off the next time she's open.", true);
    });
    return label;
  }

  function screenshotSwitch() {
    const box = el("input", { type: "checkbox", checked: data.keep_screenshots === true, disabled: data.keep_screenshots !== true && (!data.screenshots_available || data.keep_answers !== true) });
    const label = el("label", { className: "fb-check wk-switch" }, box,
      el("span", { textContent: "Help improve answers with screenshots (off by default). Needs \"Help improve Willo's answers\" on. Screenshots can include names and chat; they're kept until you erase them or turn this off." + (data.screenshots_available ? "" : " Screenshot improvement is not available yet; no new images are kept.") }));
    box.addEventListener("change", async () => {
      box.disabled = true;
      const res = await call("keep-screenshots", { on: box.checked });
      box.disabled = false;
      if (!res.ok) { box.checked = !box.checked; return say("wk-status", res.error || TRY_AGAIN); }
      data.keep_screenshots = res.on;
      show();
      say("wk-status", res.on ? "Screenshot improvement is on for future answers." : "Off. The screenshots kept are erased, and no new ones will be kept.", true);
    });
    return label;
  }

  function showFriends() {
    const f = data.friends;
    $("wk-friends-count").textContent = f.friends ? `You have ${f.friends} friend${f.friends === 1 ? "" : "s"} in Willo. ` +
      "They see your character's name and your profile when it's public." : "You haven't added friends in Willo.";
    const s = f.shared || {};
    const note = [s.character, s.level ? `level ${s.level}` : "", [s.sub, s.zone].filter(Boolean).join(", "),
      s.quest ? `on ${s.quest}` : "", s.guild ? `in ${s.guild}` : ""].filter(Boolean).join(" · ");
    $("wk-friends-share").textContent = f.share
      ? `You share where you are with them${note ? `: ${note}` : ""}${s.week ? ", and your week" : ""}.`
      : "You don't share where you are. You can turn it on in Willo's Friends tab.";
    $("wk-friends-stop-row").hidden = !f.share;
  }

  $("wk-friends-stop").addEventListener("click", async () => {
    $("wk-friends-stop").disabled = true;
    let res;
    try {
      const r = await fetch("/api/friends/share", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: false }) });
      res = await r.json().catch(() => ({ ok: false }));
    } catch (e) { res = { ok: false }; }
    $("wk-friends-stop").disabled = false;
    if (!res.ok) return say("wk-friends-status", res.error || TRY_AGAIN);
    data.friends = { ...data.friends, share: false, shared: null };
    showFriends();
    say("wk-friends-status", "You've stopped sharing, and what they saw is erased.", true);
  });

  function showStyle() {
    const st = data.style;
    $("wk-style").textContent = [st.preset ? `She talks to you in her ${st.preset} style.` : "She talks to you in her own Classic way.",
      st.words ? `Your own words for her: "${st.words}"` : "",
      st.tales.length ? `Your tales of ${st.tales.join(", ")}.` : ""].filter(Boolean).join(" ");
  }

  function showChars() {
    const chars = data.characters;
    $("wk-chars").hidden = !chars.length;
    const pick = (value, label) => {
      const b = el("button", { type: "button", textContent: label });
      b.setAttribute("aria-pressed", String(only === value));
      b.addEventListener("click", () => { only = value; show(); });
      return b;
    };
    $("wk-chars").replaceChildren(pick("", "Everything"), ...chars.map(c => pick(c.key, c.name)));
  }

  function showJourney() {
    const j = data.journey;
    $("wk-journey-see").hidden = !j;
    if (!j) { $("wk-journey").textContent = "We don't keep a copy: you haven't made a profile."; return; }
    $("wk-journey-see").href = "/u/" + encodeURIComponent(j.handle);
    $("wk-journey").replaceChildren(el("strong", { textContent: j.name }), ` ${j.sheet ? "· " + j.sheet + " " : ""}· ` +
      `${j.moments.toLocaleString()} moment${j.moments === 1 ? "" : "s"}, last copied ${when(j.updated)}. ` +
      (j.public ? "Your profile is public." : "Only you can see your profile."));
  }

  function showApps() {
    const apps = data.apps;
    if (!apps.length) { $("wk-apps").textContent = "Willo isn't connected to your account anywhere yet."; return; }
    // Each connected app says when it has cleared its copy (POST /api/keeps/cleared).
    const behind = apps.filter(a => !a.caught_up);
    $("wk-apps").textContent = !data.chats_erased && !behind.length ? "" : behind.length
      ? `Willo clears what you erased the next time she's open on ${apps.length === 1 ? "your computer"
        : behind.length === apps.length ? "each of your devices" : `${behind.length} of your devices`}.`
      : apps.length === 1 ? "Willo has cleared what you erased on your computer." : "Willo has cleared what you erased everywhere she's open.";
  }

  function show() {
    showChars();
    $("wk-sections").replaceChildren(...data.sections.map(sectionCard));
    showJourney();
    showApps();
    showFriends();
    showStyle();
    $("wk-all-list").replaceChildren(...data.sections.map(s => el("li", { textContent: s.title })),
      el("li", { textContent: "Your chats with Willo, if you leave the box below ticked" }));
  }

  $("wk-all-start").addEventListener("click", () => {
    $("wk-all-confirm").hidden = false;
    $("wk-all-start").hidden = true;
    $("wk-all-go").focus();
  });
  $("wk-all-cancel").addEventListener("click", () => { $("wk-all-confirm").hidden = true; $("wk-all-start").hidden = false; });
  $("wk-all-go").addEventListener("click", async () => {
    $("wk-all-go").disabled = true;
    const res = await call("erase-all", { confirm: "erase", keep_chats: !$("wk-all-chats").checked });
    $("wk-all-go").disabled = false;
    if (!res.ok) return say("wk-all-status", res.error || TRY_AGAIN);
    $("wk-all-confirm").hidden = true;
    $("wk-all-start").hidden = false;
    await load();
    say("wk-all-status", "Everything is erased." + ($("wk-all-chats").checked ? " Willo clears her chats the next time she's open." : ""), true);
  });

  async function load() {
    const res = await call("all");
    if (res.status === 401) { $("wk-signin").hidden = false; return; }
    if (!res.ok) return say("wk-status", res.error || TRY_AGAIN);
    data = res;
    if (only && !data.characters.some(c => c.key === only)) only = "";
    $("wk-on").hidden = false;
    show();
  }
  load();
})();
