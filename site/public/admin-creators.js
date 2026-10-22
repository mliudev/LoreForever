// /admin's Creators tab (functions/api/admin/creators.js, lib/referrals.js): applications to approve or decline, the
// month's payout list with Mark paid (paid by hand) or Pay with Stripe (once Stripe payouts are on and the creator has
// set up theirs), each creator's link, terms and numbers, the form that adds a creator or changes one's terms, the
// last commissions and payouts, and how players' own invites are doing. Loaded by admin-page.js when the tab opens,
// with the admin key. Its ids start ct- (the clip reports above have the cr- ones).

const usd = cents => `$${((cents || 0) / 100).toFixed(2)}`;
const n0 = n => (n || 0).toLocaleString("en-US");
const count = (n, one, many = one + "s") => `${n0(n)} ${n === 1 ? one : many}`;
const day = iso => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

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

// One line of terms, plain: "60% of 1 month; fans: 15% off the first month".
export const termsLine = c => {
  const fans = [c.discount ? `${c.discount}% off the first month` : null, c.gift ? `${n0(c.gift)} answers on connecting` : null]
    .filter(Boolean);
  return `${c.share_pct}% of ${c.months} month${c.months === 1 ? "" : "s"}; fans: ${fans.length ? fans.join(", ") : "nothing extra"}`;
};
const empty = (cols, text) => el("tr", {}, el("td", { colspan: String(cols), class: "ad-empty", text }));

export function loadCreators(key, $ = id => document.getElementById(id)) {
  const say = (msg, good) => { $("ct-status").hidden = !msg; $("ct-status").textContent = msg || "";
    $("ct-status").classList.toggle("fb-good", Boolean(good)); };
  async function render() {
    let res;
    try { res = await call(key, "GET"); } catch (e) { say(e.message); return; }
    const list = res.payoutList || { due: [], held: [] };
    // The Stripe payouts switch, and the rules in force.
    const r = res.rules || {}, pr = res.payoutRules || {};
    $("ct-switch").replaceChildren(`Players: a friend counts after Willo's first answer; every ${r.monthAt} give a free month, ${r.monthsPerMonth} a month at most ` +
      `(counts ${r.monthCounts} friends), the ${r.bonusAt}th of each ${r.bonusEvery} bonus answers (${r.bonusPercent}% of their plan's month), at most ` +
      `${r.perMonth} a month. Creators are paid ${pr.holdDays} days after a payment, from ${usd(pr.minimumCents)}. ` +
      `Stripe payouts: ${list.stripe ? "on" : "off (pay by hand)"}. `,
      el("button", { type: "button", text: list.stripe ? "Turn Stripe payouts off" : "Turn Stripe payouts on",
        onclick: () => act({ action: "stripe-payouts", on: !list.stripe },
          list.stripe ? "Stripe payouts off: creators are paid by hand." : "Stripe payouts on: creators can set theirs up.") }));
    // Applications.
    $("ct-apps").replaceChildren(...(res.applications || []).map(a => {
      const code = el("input", { "aria-label": "Code", placeholder: "from their name", style: "width:9em" });
      return el("tr", {},
        el("td", {}, el("strong", { text: a.name }), el("div", { class: "ad-count", text: [...new Set([a.account, a.contact].filter(Boolean))].join(" · ") }),
          el("div", { class: "ad-count", text: day(a.created) })),
        el("td", {}, el("a", { href: a.channel, rel: "noopener noreferrer", target: "_blank", text: a.channel })),
        el("td", { text: a.audience || "—" }), el("td", { text: a.note || "" }), el("td", {}, code),
        el("td", {},
          el("button", { type: "button", text: "Approve", onclick: () => act({ action: "approve", id: a.id, code: code.value.trim() },
            `Approved ${a.name}.`) }), " ",
          el("button", { type: "button", text: "Decline", onclick: () => confirm(`Decline ${a.name}?`) &&
            act({ action: "decline", id: a.id }, `Declined ${a.name}.`) })));
    }));
    if (!(res.applications || []).length) $("ct-apps").replaceChildren(empty(6, "No applications waiting."));
    // The month's payout list.
    $("ct-month").textContent = `(${list.month}; at least ${usd(list.minimum)})`;
    $("ct-due").replaceChildren(...list.due.map(d => el("tr", {},
      el("td", {}, el("strong", { text: d.name }), d.contact ? el("div", { class: "ad-count", text: d.contact }) : null),
      el("td", {}, el("strong", { text: usd(d.due) })), el("td", { text: usd(d.payable) }), el("td", { text: usd(d.clawback) }),
      el("td", { text: usd(d.held) }), el("td", { text: d.method === "stripe" ? "Stripe" : d.connect ? "Stripe ready, payouts off" : "By hand" }),
      el("td", {},
        d.method === "stripe" ? el("button", { type: "button", text: `Pay ${usd(d.due)} with Stripe`, onclick: () =>
          confirm(`Send ${usd(d.due)} to ${d.name} through Stripe?`) && act({ action: "pay", code: d.code, method: "stripe" },
            `Sent ${usd(d.due)} to ${d.name}.`) }) : null, " ",
        el("button", { type: "button", text: "Mark paid", onclick: () => {
          const note = prompt(`Paid ${usd(d.due)} to ${d.name} outside the site? A note (how, a reference):`, "");
          if (note !== null) act({ action: "pay", code: d.code, method: "manual", note }, `Marked ${usd(d.due)} paid to ${d.name}.`);
        } })))));
    if (!list.due.length) $("ct-due").replaceChildren(empty(7, "Nobody is due a payout now."));
    $("ct-held").textContent = list.held.length ? "Not due yet: " + list.held.map(h => `${h.name} ${usd(h.held + h.carried)}` +
      (h.next ? ` (next ready ${day(h.next)})` : "")).join(", ") + "." : "";
    // Creators.
    $("ct-list").replaceChildren(...(res.creators || []).map(c => el("tr", c.retired ? { style: "opacity:.55" } : {},
      el("td", {}, el("strong", { text: c.name }), el("br"), el("code", { text: c.url }),
        el("div", { class: "ad-count", text: [c.account ? `account ${c.account}` : "no account linked",
          c.contact !== c.account ? c.contact : null, c.channel].filter(Boolean).join(" · ") })),
      el("td", {}, termsLine(c), c.promo_code ? el("div", { class: "ad-count", text: `Stripe code ${c.promo_code}` })
        : c.stripe_error ? el("div", { class: "ad-count", text: `Stripe code not made: ${c.stripe_error}` }) : null),
      el("td", { text: n0(c.clicks) }), el("td", { text: n0(c.joined) }), el("td", { text: n0(c.activated) }),
      el("td", { text: n0(c.paying) }), el("td", { text: `${usd(c.earned)} of ${usd(c.brought)}` }), el("td", { text: usd(c.owed) }),
      el("td", { text: c.connect_id ? (c.connect_ready ? "Stripe ready" : "Stripe: details due") : "By hand" }),
      el("td", {},
        el("button", { type: "button", text: "Edit", onclick: () => fill(c) }), " ",
        el("button", { type: "button", text: c.retired ? "Restore" : "Retire", onclick: () =>
          act({ action: c.retired ? "restore" : "retire", code: c.code }, c.retired ? "Link back on." : "Link off.") })))));
    if (!(res.creators || []).length) $("ct-list").replaceChildren(empty(10, "No creators yet. Approve one above, or add one below."));
    // The ledger and the payouts.
    $("ct-ledger").replaceChildren(...(res.ledger || []).map(e => el("tr", {},
      el("td", { text: day(e.paid_at) }), el("td", { text: e.creator }), el("td", {}, el("code", { text: e.invoice_id })),
      el("td", { text: usd(e.paid_cents) }), el("td", { text: `${usd(e.share_cents)} (${e.pct}%)` }),
      el("td", { text: e.state === "in hold" ? `in hold until ${day(e.payable_at)}` : e.reversed_why ? `${e.state} (${e.reversed_why})` : e.state }))));
    if (!(res.ledger || []).length) $("ct-ledger").replaceChildren(empty(6, "No commissions yet."));
    $("ct-payouts").replaceChildren(...(res.payouts || []).map(p => el("tr", {},
      el("td", { text: day(p.paid_at) }), el("td", { text: p.creator }), el("td", { text: usd(p.cents) }),
      el("td", { text: p.method === "stripe" ? "Stripe" : "By hand" }), el("td", {}, p.transfer_id ? el("code", { text: p.transfer_id }) : "—"),
      el("td", { text: p.note || "" }))));
    if (!(res.payouts || []).length) $("ct-payouts").replaceChildren(empty(6, "No payouts yet."));
    // Players' invites.
    const p = res.players || {};
    $("ct-players").textContent = `${count(p.joined, "friend")} joined with players' links from ${count(p.sharers, "player")}: ` +
      `${n0(p.activated)} asked Willo, ${n0(p.friends)} counted (${n0(p.month)} this month), ${n0(p.paying)} went on to pay` +
      (p.answers ? `; ${n0(p.answers)} answers given the old way, before 10/18.` : ".");
    const voids = res.voids || [];
    $("ct-voids").textContent = voids.length ? "Didn't count: " + voids.map(v => `${n0(v.n)} ${v.why}`).join(", ") + "." : "";
    const rw = res.rewards || [];
    const kind = k => rw.filter(x => x.kind === k && x.status === "applied");
    const failed = rw.filter(x => x.status === "failed").reduce((a, x) => a + x.n, 0);
    $("ct-rewards").textContent = rw.length ? `Rewards: ${count(kind("bonus").reduce((a, x) => a + x.n, 0), "bonus", "bonuses")} ` +
      `(${n0(kind("bonus").reduce((a, x) => a + x.answers, 0))} answers), ` +
      `${count(kind("month").reduce((a, x) => a + x.n, 0), "free month")} ` +
      `(${n0(kind("month").filter(x => x.method === "credit").reduce((a, x) => a + x.n, 0))} as Stripe credits worth ` +
      `${usd(kind("month").reduce((a, x) => a + x.cents, 0))})` + (failed ? `; ${failed} failed, tried again on the player's next look.` : ".") : "";
  }
  async function act(body, done) {
    let ok = false;
    try { await call(key, "POST", body); say(done, true); ok = true; } catch (e) { say(e.message); }
    await render();
    return ok;
  }
  function fill(c) {
    for (const f of ["code", "name", "contact", "discount", "share_pct", "months", "gift"]) $("ct-" + f).value = c[f] ?? "";
    $("ct-account").value = c.account || "";
    $("ct-code").focus();
  }
  if (!$("ct-form").dataset.wired) {
    $("ct-form").dataset.wired = "1";
    $("ct-form").addEventListener("submit", e => {
      e.preventDefault();
      const body = { action: "save" };
      for (const f of ["code", "name", "contact", "account", "discount", "share_pct", "months", "gift", "promo_id"]) {
        const v = $("ct-" + f).value.trim();
        if (v !== "" || f === "contact") body[f] = v;
      }
      act(body, `Saved ${body.code}.`).then(ok => { if (ok) $("ct-form").reset(); });
    });
  }
  return render();
}
