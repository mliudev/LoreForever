import { test } from "node:test";
import assert from "node:assert/strict";
import { d1 } from "./helpers.mjs";
import { setup } from "../lib/accounts.js";
import { allowance } from "../lib/companion-answers.js";

test("an existing story-spend table gets voice and reservation columns before answers use it", async () => {
  const env = { DB: d1(), GEMINI_API_KEY: "test" };
  env.DB.sqlite.exec("CREATE TABLE story_spend (month TEXT PRIMARY KEY, micro_usd INTEGER NOT NULL DEFAULT 0, " +
    "calls INTEGER NOT NULL DEFAULT 0, stories INTEGER NOT NULL DEFAULT 0)");
  env.DB.sqlite.exec("INSERT INTO story_spend (month, micro_usd) VALUES (strftime('%Y-%m','now'), 1000)");
  await setup(env);
  const columns = env.DB.sqlite.prepare("PRAGMA table_info(story_spend)").all().map(c => c.name);
  assert.ok(columns.includes("voice_micro_usd") && columns.includes("reserved_micro"));
  assert.equal((await allowance(env, "account")).available, true);
});


const legacySpend = (db, cost = 1000) => db.sqlite.exec(
  "CREATE TABLE story_spend (month TEXT PRIMARY KEY, micro_usd INTEGER NOT NULL DEFAULT 0, " +
  "calls INTEGER NOT NULL DEFAULT 0, stories INTEGER NOT NULL DEFAULT 0); " +
  `INSERT INTO story_spend (month, micro_usd) VALUES (strftime('%Y-%m','now'), ${cost})`);

test("account setup prepares independent databases without losing existing spending", async () => {
  const environments = [1000, 2000].map(cost => {
    const env = { DB: d1(), GEMINI_API_KEY: "test" };
    legacySpend(env.DB, cost);
    return env;
  });
  await Promise.all(environments.map(setup));
  for (const [index, env] of environments.entries()) {
    const row = env.DB.sqlite.prepare("SELECT * FROM story_spend").get();
    assert.equal(row.micro_usd, (index + 1) * 1000);
    assert.equal(row.voice_micro_usd, 0);
    assert.equal(row.reserved_micro, 0);
    assert.equal((await allowance(env, "account")).available, true);
  }
});

test("simultaneous account setup shares preparation and successful setup is cached per DB", async () => {
  const env = { DB: d1() };
  legacySpend(env.DB);
  const original = env.DB.prepare;
  let catalogs = 0, alters = 0, statements = 0;
  env.DB.prepare = sql => {
    statements++;
    if (sql.includes("SELECT name FROM sqlite_master")) catalogs++;
    if (sql.startsWith("ALTER TABLE story_spend")) alters++;
    return original(sql);
  };
  await Promise.all([setup(env), setup(env), setup(env)]);
  assert.equal(catalogs, 1);
  assert.equal(alters, 2);
  statements = 0;
  await setup(env);
  assert.equal(statements, 0);
});

test("a failed spending migration keeps account setup retryable", async () => {
  const env = { DB: d1(), GEMINI_API_KEY: "test" };
  legacySpend(env.DB, 12345);
  const original = env.DB.prepare;
  let block = true;
  env.DB.prepare = sql => {
    const statement = original(sql);
    if (block && sql.includes("ALTER TABLE story_spend ADD COLUMN reserved_micro")) {
      return { ...statement, run: async () => { throw new Error("Migration temporarily unavailable"); } };
    }
    return statement;
  };
  await assert.rejects(setup(env), /Migration temporarily unavailable/);
  assert.equal(env.DB.sqlite.prepare("PRAGMA table_info(story_spend)").all().some(c => c.name === "reserved_micro"), false);
  block = false;
  await setup(env);
  const row = env.DB.sqlite.prepare("SELECT * FROM story_spend").get();
  assert.equal(row.micro_usd, 12345);
  assert.equal(row.reserved_micro, 0);
  assert.equal((await allowance(env, "account")).available, true);
});

test("a concurrent Worker adding a spending column is accepted only after rechecking it", async () => {
  const env = { DB: d1() };
  legacySpend(env.DB);
  const original = env.DB.prepare;
  let raced = false;
  env.DB.prepare = sql => {
    const statement = original(sql);
    if (!raced && sql.includes("ALTER TABLE story_spend ADD COLUMN reserved_micro")) {
      return { ...statement, run: async () => {
        raced = true;
        env.DB.sqlite.exec(sql);
        throw new Error("duplicate column name: reserved_micro");
      } };
    }
    return statement;
  };
  await setup(env);
  assert.equal(env.DB.sqlite.prepare("SELECT reserved_micro FROM story_spend").get().reserved_micro, 0);
});
