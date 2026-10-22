// The word from the realm on Willo's Tonight card (LOR-733): one line we write, from this small dated list, never scraped
// and never made up by a model. An entry shows from its `from` day up to, not including, its `to` day (UTC days,
// "2026-10-23"; no `from` means from the start, no `to` means until it is taken out). `{days}` becomes "12 days" or
// "1 day": the days left until `until`. The first entry that holds today is the line; after the last one there is
// nothing, until a new one is added here.
//
// Say nothing here about what happens to a beta character (kept or wiped): that isn't decided, and the card never claims it.
// And never the word "beta": it is out of the world.

export const NEWS = [
  { id: "gates-close", to: "2026-10-23", text: "Word from the realm: the gates close on Friday the 23rd." },
  { id: "gates-open", from: "2026-10-23", to: "2026-11-04", until: "2026-11-04",
    text: "Word from the realm: the gates open for good on November 4, in {days}." },
];

// The gap between the beta closing and the launch: the card is "Before the gates open" and its picks are plans for
// launch night.
export const GAP = { from: "2026-10-23", to: "2026-11-04" };

const DAY = 86400e3;
export const dayOf = now => new Date(now).toISOString().slice(0, 10);
const inside = (day, from, to) => (!from || day >= from) && (!to || day < to);
const daysBetween = (from, to) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY));

export const inGap = (now, gap = GAP) => inside(dayOf(now), gap.from, gap.to);

// {id, text} for today, or null. list: the entries (the tests give their own).
export function newsFor(now, list = NEWS) {
  const day = dayOf(now);
  const entry = list.find(n => inside(day, n.from, n.to));
  if (!entry) return null;
  const left = entry.until ? daysBetween(day, entry.until) : 0;
  return { id: entry.id, text: entry.text.replace("{days}", `${left} ${left === 1 ? "day" : "days"}`) };
}
