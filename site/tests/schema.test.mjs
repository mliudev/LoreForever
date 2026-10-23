// lib/schema.js: a module's setup sends only what's missing, and never skips a column or table that isn't there (a
// skipped one would break every write that needs it).
import test from "node:test";
import assert from "node:assert/strict";
import { columnsOf, createMissing, addMissing } from "../lib/schema.js";
import { d1 } from "./helpers.mjs";

test("columnsOf reads column names, not constraints", () => {
  assert.deepEqual([...columnsOf(`CREATE TABLE t (user_id TEXT NOT NULL, "day" TEXT, n INTEGER DEFAULT (1),
    PRIMARY KEY (user_id, day), UNIQUE (n, kind), CHECK (n > 0))`)], ["user_id", "day", "n"]);
});

test("setup sends only what's missing, and adds a missing column and index", async () => {
  const sqlite = d1();
  let sent = [];
  const DB = { prepare: sql => { sent.push(sql); return sqlite.prepare(sql); }, batch: list => sqlite.batch(list) };
  const make = ["CREATE TABLE IF NOT EXISTS spend (user_id TEXT PRIMARY KEY, micro INTEGER NOT NULL DEFAULT 0)"];
  const alters = ["ALTER TABLE spend ADD COLUMN voice_micro INTEGER NOT NULL DEFAULT 0",
    "CREATE INDEX IF NOT EXISTS spend_voice ON spend (voice_micro)"];

  const cold = { DB };
  await createMissing(cold, make);
  await addMissing(cold, alters);
  assert.deepEqual(sqlite.sqlite.prepare("PRAGMA table_info(spend)").all().map(c => c.name), ["user_id", "micro", "voice_micro"]);
  assert.ok(sqlite.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'spend_voice'").get());

  // A new isolate on the same database: one look, nothing else sent.
  sent = [];
  const next = { DB: { ...DB } };
  await createMissing(next, make);
  await addMissing(next, alters);
  assert.equal(sent.length, 1, sent.join("\n"));
  assert.match(sent[0], /sqlite_master/);

  // A newer column the database doesn't have yet still goes out.
  await addMissing(next, ["ALTER TABLE spend ADD COLUMN launch_micro INTEGER NOT NULL DEFAULT 0"]);
  assert.ok(sqlite.sqlite.prepare("PRAGMA table_info(spend)").all().some(c => c.name === "launch_micro"));
});
