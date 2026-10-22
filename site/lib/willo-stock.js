// What the add-on last saved of each character, kept on the site so Willo's goals work off the PC (LOR-665 follow-up,
// 10/21): their gold, level, skills, reputation, riding and the evenings played (lib/willo-goals.js stockOf). Willo on the
// PC sends them with each question (`stock`); the iPhone has no game beside it, so the PC's app also sends the newest
// save with its profile update (POST /api/profile/sync, companion/lore_companion/profile.py `stock`), and an answer that
// comes without one reads the character's last save here, in the same batch as the notebook (lib/willo-notebook.js
// readNotebook's `stock`, which holds the one SELECT), so it costs no round trip. Its numbers are always said as of that save (willo-goals.js `fromSave`).
//
//   willo_stock (user_id, character, t, stock, updated)   one row per account and character: the add-on's "Name-Realm",
//     t: when the add-on took it (Unix seconds), stock: stockOf's JSON, updated: when the site kept it (ISO)
//
// Only the newest save of a character is kept (a late or replayed update never replaces a newer one), at most
// STOCK_MAX characters an account. Game numbers the player already syncs, private to them: "What Willo keeps" shows it
// (STOCK keeper) and erases it, and "Delete my account" removes it (STOCK_USER_DATA).

import { stockOf } from "./willo-goals.js";
import { pageOf } from "./willo-notebook.js";
import { COMPANION_NAME as NAME } from "./brand.js";

export const STOCK_SETUP = [
  `CREATE TABLE IF NOT EXISTS willo_stock (
    user_id TEXT NOT NULL, character TEXT NOT NULL, t INTEGER NOT NULL, stock TEXT NOT NULL, updated TEXT NOT NULL,
    PRIMARY KEY (user_id, character))`,
];
export const STOCK_USER_DATA = [["DELETE FROM willo_stock WHERE user_id = ?", u => u.id]];

export const STOCK_MAX = 40;            // characters an account keeps a save for
const INPUT_MAX_CHARS = 32 * 1024;      // what a sync's `stock` may weigh as sent
const KEPT_MAX_CHARS = 24 * 1024;       // and as kept, after the checks
const AHEAD_SECONDS = 24 * 3600;        // a save from the future isn't one

const same = (a, b) => String(a).normalize("NFC").toLowerCase() === String(b).normalize("NFC").toLowerCase();

// A sync's `stock` ({character: "Name-Realm", ...stockOf's fields}) as {character, t, json} to keep, or null for
// anything that doesn't read: never an error, a sync that can't keep it still syncs. data: the profile record the same
// sync carries, whose character it must be (their name leads the key).
export function readStock(input, data = null, now = Date.now()) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    if (JSON.stringify(input).length > INPUT_MAX_CHARS) return null;
    const page = pageOf(input.character);
    if (!page || page === "account") return null;
    const character = page.slice(5);
    if (data?.name && !same(character.split("-")[0], data.name)) return null;
    const stock = stockOf(input);
    if (!stock || stock.t === null || stock.t > now / 1000 + AHEAD_SECONDS) return null;
    const json = JSON.stringify(stock);
    return json.length > KEPT_MAX_CHARS ? null : { character, t: stock.t, json };
  } catch { return null; }
}

// Keep it unless the character has a newer save, or the account is at STOCK_MAX characters and this is a new one.
export async function saveStock(env, userId, kept, now = new Date()) {
  if (!kept) return false;
  const res = await env.DB.prepare(
    "INSERT INTO willo_stock (user_id, character, t, stock, updated) " +
    "SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM willo_stock WHERE user_id = ?1 AND character = ?2) " +
    "OR (SELECT COUNT(*) FROM willo_stock WHERE user_id = ?1) < ?6 " +
    "ON CONFLICT (user_id, character) DO UPDATE SET t = excluded.t, stock = excluded.stock, updated = excluded.updated " +
    "WHERE excluded.t >= willo_stock.t")
    .bind(userId, kept.character, kept.t, kept.json, now.toISOString(), STOCK_MAX).run();
  return res.meta.changes > 0;
}

// A kept row's JSON as stockOf reads it, marked as the last save's (never live): willo-goals.js says its numbers as of
// then. null when it doesn't read.
export function savedStock(json) {
  try {
    const stock = stockOf(JSON.parse(json));
    return stock ? { ...stock, fromSave: true } : null;
  } catch { return null; }
}

// ---- What Willo keeps ----

const gold = copper => Math.floor(copper / 10000);
const lineOf = s => [s.level != null ? `Level ${Math.floor(s.level)}` : "", s.money != null ? `${gold(s.money)} gold` : "",
  s.skills && Object.keys(s.skills).length ? `${Object.keys(s.skills).length} skills` : "",
  s.rep && Object.keys(s.rep).length ? `${Object.keys(s.rep).length} reputations` : ""].filter(Boolean).join(", ");

export const STOCK_KEEPER = {
  id: "saves",
  title: "Your last save",
  about: `What your game last saved of each character: their level, gold, skills and reputations. ${NAME} works out ` +
    `your goals from it when you ask her from your phone.`,
  empty: `Nothing kept. When you play with ${NAME} on your computer, the numbers your game saves are kept here for your goals.`,
  async list(env, userId) {
    const { results } = await env.DB.prepare(
      "SELECT character, t, stock, updated FROM willo_stock WHERE user_id = ? ORDER BY t DESC").bind(userId).all();
    return { items: results.map(r => {
      const s = savedStock(r.stock) || {};
      return { id: r.character, character: r.character, text: lineOf(s) || "A save", detail: "Saved by your game",
        when: new Date(r.t * 1000).toISOString() };
    }) };
  },
  async erase(env, userId, id) {
    const res = await env.DB.prepare("DELETE FROM willo_stock WHERE user_id = ? AND character = ?").bind(userId, String(id)).run();
    return res.meta.changes > 0;
  },
  async eraseAll(env, userId) {
    await env.DB.prepare("DELETE FROM willo_stock WHERE user_id = ?").bind(userId).run();
  },
  async eraseCharacter(env, userId, character) {
    await env.DB.prepare("DELETE FROM willo_stock WHERE user_id = ? AND character = ?").bind(userId, String(character)).run();
  },
};
