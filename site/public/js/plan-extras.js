// /plans' offer on each card and its "What you get" table (Mike's approved mockup, 2026-10-14), from the
// GET /api/billing/plans fields lib/billing.js adds: plans[].promo {price (US cents), label, note}, a creator's
// first-month discount, only while it applies to the account, and compare [{label, values: {<plan id>: text}}]. Never
// priced in the page itself. Styles: style.css .pl-tag, .pl-promo, .wl-compare. /plans' own script calls these after
// it draws its cards:
//   PlanExtras.promo(cardElement, plan)        the offer's tag ("Ziqo: 15% off") and the struck-through price, when
//                                              plan.promo is set
//   PlanExtras.compare(boxElement, plans, rows) the table into box (a <div>), shown only when rows has any
window.PlanExtras = (() => {
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const dollars = cents => cents === 0 ? "Free" : `$${(cents / 100).toFixed(2)}`;

  function promo(card, p) {
    if (!card || !p?.promo || !Number.isInteger(p.promo.price)) return;
    const line = el("p", "pl-promo");
    line.append(el("s", null, dollars(p.monthly)), el("strong", null, dollars(p.promo.price)));
    if (p.promo.note) line.append(el("span", "muted", p.promo.note));
    const price = card.querySelector(".pl-price");
    if (price) price.replaceWith(line); else card.prepend(line);
    if (p.promo.label) card.prepend(el("span", "pl-tag", p.promo.label));
  }

  function compare(box, plans, rows) {
    if (!box) return;
    box.hidden = !(Array.isArray(rows) && rows.length && Array.isArray(plans) && plans.length);
    if (box.hidden) return;
    const table = el("table", "wl-compare");
    const head = el("tr");
    head.append(el("th", null, ""));
    for (const p of plans) head.append(el("th", null, p.name));
    const thead = el("thead"), tbody = el("tbody");
    thead.append(head);
    for (const r of rows) {
      const tr = el("tr");
      tr.append(el("th", null, r.label));
      for (const p of plans) tr.append(el("td", null, r.values?.[p.id] ?? ""));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    box.className = "wl-compare-box";
    box.replaceChildren(el("h3", null, "What you get"), table);
  }

  return { promo, compare };
})();
