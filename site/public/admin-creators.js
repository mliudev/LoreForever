// /admin's Creators tab (functions/api/admin/creators.js, lib/referrals.js): each creator's link and terms, what it
// brought (clicks, players who connected Willo, players who paid) and what they've earned and are still owed, with
// "Mark paid" for a payout made by hand; the form adds a creator or changes one's terms; and how players' own share
// links are doing. Loaded by admin-page.js when the tab opens, with the admin key.

const usd = cents => `$${((cents || 0) / 100).toFixed(2)}`;
const n0 = n => (n || 0).toLocaleString("en-US");

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...kids.filter(k => k !== null && k !== undefined && k !== false));
  return node;
}

async function call(key, method, body) {
  const r = await fetch("/api/admin/creators", {
    method, cache: "no-store",
    headers: { Authorization: "Bearer " + key(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await r.json().catch(() => ({}));
  if (!r.ok || !res.ok) throw new Error(res.error || `Request failed (${r.status})`);
  return res;
}

// One line of terms, plain: "50% off the first month, 100 answers, 20% of 3 months".
export const termsLine = c => [c.discount ? `${c.discount}% off the first month` : "no discount",
  c.gift ? `${n0(c.gift)} answers on connecting` : "no answers", `${c.share_pct}% of ${c.months} month${c.months === 1 ? "" : "s"}`]
  .join(", ");

export function loadCreators(key, $ = id => document.getElementById(id)) {
  const say = (msg, good) => { $("cr-status").hidden = !msg; $("cr-status").textContent = msg || "";
    $("cr-status").classList.toggle("fb-good", Boolean(good)); };
  async function render() {
    let res;
    try { res = await call(key, "GET"); } catch (e) { say(e.message); return; }
    const p = res.players || {};
    $("cr-players").textContent = `Players' share links: ${n0(p.friends)} friends counted (${n0(p.month)} this month) ` +
      `from ${n0(p.sharers)} players, ${n0(p.answers)} answers given, ${n0(p.paying)} of those friends went on to pay.`;
    $("cr-list").replaceChildren(...(res.creators || []).map(c => el("tr", c.retired ? { style: "opacity:.55" } : {},
      el("td", {}, el("strong", { text: c.name }), el("br"), el("code", { text: c.url }),
        c.contact ? el("div", { class: "ad-count", text: c.contact }) : null),
      el("td", { text: termsLine(c) }),
      el("td", { text: c.promo_code || (c.stripe_error ? `Not made: ${c.stripe_error}` : "—") }),
      el("td", { text: n0(c.clicks) }), el("td", { text: n0(c.joined) }), el("td", { text: n0(c.paying) }),
      el("td", { text: `${usd(c.earned)} of ${usd(c.brought)}` }), el("td", { text: usd(c.owed) }),
      el("td", {},
        c.owed ? el("button", { type: "button", text: "Mark paid", onclick: () => act({ action: "paid", code: c.code },
          `Marked ${usd(c.owed)} paid to ${c.name}.`) }) : null, " ",
        el("button", { type: "button", text: "Edit", onclick: () => fill(c) }), " ",
        el("button", { type: "button", text: c.retired ? "Restore" : "Retire", onclick: () =>
          act({ action: c.retired ? "restore" : "retire", code: c.code }, c.retired ? "Link back on." : "Link off.") })))));
    if (!(res.creators || []).length) $("cr-list").replaceChildren(el("tr", {}, el("td", { colspan: "9", class: "ad-empty",
      text: "No creators yet. Add one below." })));
  }
  async function act(body, done) {
    let ok = false;
    try { await call(key, "POST", body); say(done, true); ok = true; } catch (e) { say(e.message); }
    await render();
    return ok;
  }
  function fill(c) {
    for (const f of ["code", "name", "contact", "discount", "share_pct", "months", "gift"]) $("cr-" + f).value = c[f] ?? "";
    $("cr-code").focus();
  }
  if (!$("cr-form").dataset.wired) {
    $("cr-form").dataset.wired = "1";
    $("cr-form").addEventListener("submit", e => {
      e.preventDefault();
      const body = { action: "save" };
      for (const f of ["code", "name", "contact", "discount", "share_pct", "months", "gift", "promo_id"]) {
        const v = $("cr-" + f).value.trim();
        if (v !== "" || f === "contact") body[f] = v;
      }
      act(body, `Saved ${body.code}.`).then(ok => { if (ok) $("cr-form").reset(); });
    });
  }
  return render();
}
