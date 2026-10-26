// One inbox, one key: Gmail ignores dots and anything after a "+" in the name, and googlemail.com is gmail.com, so
// "John.Smith+wow@googlemail.com" and "johnsmith@gmail.com" are the same inbox and the same account. Other addresses are
// kept as they are (lowercased): only Gmail is known to work this way for every address. Its own module, with no
// imports, so lib/accounts.js (account lookup) and lib/billing.js (gifts once per inbox) can both use it without an
// import cycle.
const GMAIL = new Set(["gmail.com", "googlemail.com"]);
export function inboxOf(email) {
  const address = String(email || "").trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at < 1) return address;
  const name = address.slice(0, at), domain = address.slice(at + 1);
  return GMAIL.has(domain) ? `${name.split("+")[0].replace(/\./g, "")}@gmail.com` : address;
}

// inboxOf in SQL, for users.email_key (lib/accounts.js), which accountByEmail looks Gmail variants up by. For an address
// with one "@", as every account's is.
const E = "lower(trim(email))", AT = `instr(${E}, '@')`;
const NAME = `substr(${E}, 1, ${AT} - 1)`, DOMAIN = `substr(${E}, ${AT} + 1)`;
export const INBOX_SQL = `CASE WHEN ${AT} > 1 AND ${DOMAIN} IN ('gmail.com', 'googlemail.com') THEN ` +
  `replace(CASE WHEN instr(${NAME}, '+') > 0 THEN substr(${NAME}, 1, instr(${NAME}, '+') - 1) ELSE ${NAME} END, '.', '') ` +
  `|| '@gmail.com' ELSE ${E} END`;

// The inbox for free gifts (lib/billing.js): inboxOf, and a "+tag" dropped on every domain, since Outlook, iCloud and
// Fastmail deliver a+1@ and a+2@ to one inbox too, so each tag isn't another free month (the Software Architect's
// review, 10/25). Signing in still takes other domains' addresses as they are: only Gmail is sure to fold.
export function giftInboxOf(email) {
  const inbox = inboxOf(email);
  const at = inbox.lastIndexOf("@");
  const name = inbox.slice(0, at).split("+")[0];
  return at < 1 || !name ? inbox : name + inbox.slice(at);
}
