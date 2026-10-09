import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeContacts } from "../public/admin-contacts.js";

test("a subscriber and account sharing an email count once, from their first signup", () => {
  const contacts = mergeContacts([
    { email: " Alice@Example.com ", source: "home", created_at: "2026-09-01T12:00:00Z" },
    { email: "subscriber@example.com", source: "download", created_at: "2026-10-01T12:00:00Z" },
    { email: "bob@example.com", source: "home", created_at: "2026-10-08T12:00:00Z" },
  ], [
    { id: "alice", email: "alice@example.com", display_name: "Alice", created: "2026-10-08T12:00:00Z" },
    { id: "bob", email: "bob@example.com", created: "2026-09-02T12:00:00Z" },
    { id: "account", email: "account@example.com", created: "2026-10-07T12:00:00Z" },
  ]);
  assert.equal(contacts.length, 4);
  const alice = contacts.find(c => c.email === "alice@example.com");
  assert.equal(alice.user.display_name, "Alice");
  assert.equal(alice.subscriber.source, "home");
  assert.equal(alice.created, "2026-09-01T12:00:00Z");
  assert.equal(contacts.find(c => c.email === "bob@example.com").created, "2026-09-02T12:00:00Z");
  assert.equal(contacts.filter(c => c.created >= "2026-10-01").length, 2);
  assert.equal(contacts.find(c => c.email === "account@example.com").subscriber, null);
  assert.equal(contacts.find(c => c.email === "subscriber@example.com").user, null);
});

test("removing a subscription keeps the account contact without release-news consent", () => {
  const users = [{ id: "alice", email: "alice@example.com", created: "2026-09-01T12:00:00Z" }];
  const subscribers = [{ email: "alice@example.com", source: "home", created_at: "2026-10-08T12:00:00Z" }];
  assert.equal(mergeContacts(subscribers, users).length, 1);
  const [remaining] = mergeContacts([], users);
  assert.equal(remaining.email, "alice@example.com");
  assert.equal(remaining.user.id, "alice");
  assert.equal(remaining.subscriber, null);
});

test("test signups stay inspectable but do not inflate real contacts or move an account's signup date", () => {
  const contacts = mergeContacts([
    { email: "test@example.com", source: "selftest", created_at: "2026-09-01T12:00:00Z" },
    { email: "alice@example.com", source: "selftest", created_at: "2026-09-01T12:00:00Z" },
  ], [{ id: "alice", email: "alice@example.com", created: "2026-10-08T12:00:00Z" }]);
  const real = contacts.filter(c => !c.test);
  assert.equal(contacts.length, 2);
  assert.equal(real.length, 1);
  assert.equal(real[0].email, "alice@example.com");
  assert.equal(real[0].created, "2026-10-08T12:00:00Z");
  assert.equal(contacts.find(c => c.email === "test@example.com").test, true);
});
