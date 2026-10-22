-- Willo's goals off the PC: what the add-on last saved of each character (level, gold, skills, reputation), sent by the
-- PC's app with its profile update, so an answer from the phone can work out a goal's numbers (lib/willo-stock.js).
-- One row per account and character, the newest save only. Idempotent. lib/accounts.js setup() creates the same table on
-- the first request after a deploy, so running this by hand is only for a database that should have it before then:
--   npx wrangler d1 execute <DB name> --remote --file site/migrations/willo-stock.sql
CREATE TABLE IF NOT EXISTS willo_stock (
  user_id TEXT NOT NULL, character TEXT NOT NULL, t INTEGER NOT NULL, stock TEXT NOT NULL, updated TEXT NOT NULL,
  PRIMARY KEY (user_id, character));
