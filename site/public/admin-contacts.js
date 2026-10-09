// One contact per email, whether they subscribed, created an account, or did both.
// Keep the subscription separate: having an account does not opt someone into release news.
export function mergeContacts(subscribers = [], users = []) {
  const contacts = new Map();
  const contactFor = email => {
    email = (email || "").trim().toLowerCase();
    if (!email) return null;
    if (!contacts.has(email)) contacts.set(email, { email, user: null, subscriber: null });
    return contacts.get(email);
  };
  for (const user of users) {
    const contact = contactFor(user.email);
    if (contact) contact.user = user;
  }
  for (const subscriber of subscribers) {
    const contact = contactFor(subscriber.email);
    if (contact) contact.subscriber = subscriber;
  }
  return [...contacts.values()].map(contact => {
    const testSignup = contact.subscriber?.source === "selftest";
    const dates = [contact.user?.created, !testSignup && contact.subscriber?.created_at].filter(Boolean).sort();
    return { ...contact, created: dates[0] || contact.subscriber?.created_at || "", test: testSignup && !contact.user };
  }).sort((a, b) => b.created.localeCompare(a.created) || a.email.localeCompare(b.email));
}
