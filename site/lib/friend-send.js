// Friend sharing is a preview of the actual game window, prepared on the desktop. The site resolves the recipient;
// it never captures, uploads or sends anything here. Historical cards remain readable, but no new cards are offered.
import { ONLINE_MINUTES } from "./friends.js";

export const capturesFrom = capabilities => String(capabilities || "").split(/[,\s]+/).includes("game-screenshot-sharing");
const NAME = String.raw`(?<name>[\p{L}][\p{L}\p{N}'-]{1,31}(?:\s+[\p{L}][\p{L}\p{N}'-]{1,31}){0,3})`;
const LEAD = String.raw`^(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|please\s+|go\s+ahead\s+and\s+|(?:i\s+want|i'd\s+like)\s+you\s+to\s+)?`;
const TO = new RegExp(LEAD + String.raw`(?:send|share|forward|pass|show)\s+(?<what>.{1,120}?)\s+(?:to|with)\s+${NAME}\s*[.!?]*$`, "iu");
const FIRST = new RegExp(LEAD + String.raw`(?:send|show)\s+${NAME}\s+(?<what>(?:this|that|it|my|the|a|an|where|what|your|"|\[).{0,100}?)\s*[.!?]*$`, "iu");
const TAKE = new RegExp(LEAD + String.raw`(?:take|capture|grab)\s+(?<what>(?:a\s+)?(?:screenshot|screen\s*shot|photo|picture).{0,70}?)\s+(?:and|then)\s+(?:send|share|show)\s+(?:(?:it|this|that)\s+)?(?:to|with)\s+${NAME}\s*[.!?]*$`, "iu");
const NOT_NAME = /^(?:me|myself|you|yourself|him|her|them|us|everyone|everybody|someone|anyone|all|my|the|a|an|it|this|that|willo|willow|here|there|back|over|out|up|home)$/i;
const clean = q => String(q || "").replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
  .replace(/^\s*(?:hey\s+)?willow?[,!]?\s*/i, "").replace(/,?\s+please\s*[.!?]*$/i, "").trim();

// Commands only; questions about in-game mail, lore characters or how to share never become actions.
export function sendIntent(question) {
  const q = clean(question);
  if (!q || q.length > 260) return null;
  const m = TAKE.exec(q) || TO.exec(q) || FIRST.exec(q);
  if (!m) {
    // A send without a recipient is a clarification, never a guessed person or a model answer.
    const missing = /^(?:(?:can|could|would|will) you (?:please )?|please )?(?:(?:take|capture|grab) (?:a |the )?(?:screenshot|screen shot|picture|photo)(?: of (?:my|the) game)? (?:and|then) )?(?:send|share)(?: (?:it|this|that|a screenshot|the screenshot|a picture|a photo))?(?: (?:to|with)(?: a friend| my friend)?)?\s*[.!?]*$/i;
    if (missing.test(q)) return { name: "", what: "screenshot", kind: "screenshot" };
    return null;
  }
  const name = m.groups.name.trim(), what = m.groups.what.trim();
  if (/^(?:a|my|one of my) friends?$/i.test(name)) return { name: "", what, kind: "screenshot" };
  if (NOT_NAME.test(name) || /^(?:me|myself|you|yourself)\b/i.test(what)) return null;
  const screenshot = /\b(?:screenshot|screen\s*shot|photo|picture)\b/i.test(what) || /^(?:this|that|it)$/i.test(what);
  // Bare names and unsupported messages are considered only when the named player is an accepted friend.
  const oldCard = /\b(?:location|quest|target|item|story|lore|where i am|what you|your answer)\b/i.test(what);
  return { name, what, kind: screenshot ? "screenshot" : "retired", ...(!screenshot && !oldCard ? { loose: true } : {}) };
}

// A name alone answers only our immediately preceding screenshot-recipient clarification.
export function screenshotRecipientReply(parts) {
  const previous = sendIntent(parts.previousQuestion);
  if (!(previous?.kind === "screenshot" || /^For your screenshot, you have more than one friend called /.test(parts.previous || "")) || !/^(?:Which friend should I send it to\?|You have more than one friend called |For your screenshot, you have more than one friend called )/.test(parts.previous || "")) return null;
  const name = String(parts.question || "").trim().replace(/^@/, "").replace(/[.!?]+$/, "");
  if (!/^[\p{L}][\p{L}\p{N}'-]{1,31}(?:\s+[\p{L}][\p{L}\p{N}'-]{1,31}){0,3}$/u.test(name) || NOT_NAME.test(name)) return null;
  return { name, what: "screenshot", kind: "screenshot" };
}

export async function friendsNamed(env, userId, name, now = Date.now()) {
  const { results } = await env.DB.prepare(
    "SELECT p.pid, p.hide_online, pr.handle, json_extract(pr.data, '$.name') AS name, " +
    "EXISTS (SELECT 1 FROM devices d WHERE d.user_id = e.other_id AND d.last_used > ?) AS online " +
    "FROM friend_edges e JOIN friend_edges b ON b.user_id = e.other_id AND b.other_id = e.user_id AND b.state = 'friends' " +
    "JOIN friend_people p ON p.user_id = e.other_id LEFT JOIN profiles pr ON pr.user_id = e.other_id " +
    "WHERE e.user_id = ? AND e.state = 'friends'").bind(new Date(now - ONLINE_MINUTES * 60e3).toISOString(), userId).all();
  const want = String(name || "").toLowerCase();
  const names = r => [r.name, r.handle, String(r.handle || "").replace(/-/g, " ")].filter(Boolean).map(n => String(n).toLowerCase());
  const exact = results.filter(r => names(r).includes(want));
  const found = exact.length ? exact : results.filter(r => names(r).some(n => n.split(/[\s-]/)[0] === want));
  return found.map(r => ({ id: r.pid, name: r.name || r.handle || name, handle: r.handle, online: r.hide_online ? null : Boolean(r.online) }));
}

export async function sendOffer(env, userId, intent, canCapture, now = Date.now()) {
  if (!intent.name) return { answer: "Which friend should I send it to? Say their name or profile handle." };
  const friends = await friendsNamed(env, userId, intent.name, now);
  if (!friends.length && intent.loose) return null;
  if (!friends.length) return { answer: `I don't see ${intent.name} among your friends yet. Add them in Friends first.` };
  if (friends.length > 1) {
    const names = friends.slice(0, 4).map(f => `${f.name}${f.handle ? ` (@${f.handle})` : ""}`);
    return { answer: `${intent.kind === "screenshot" ? "For your screenshot, you have" : "You have"} more than one friend called ${intent.name}: ${names.slice(0, -1).join(", ")} and ${names.at(-1)}. Say their full name or handle.` };
  }
  if (intent.kind !== "screenshot") return { answer: "I don't send game cards anymore. I can share a screenshot of the game instead. Ask Willo on your PC or Mac to take a screenshot and send it to your friend." };
  if (!canCapture) return { answer: "Use Willo on your PC or Mac to share a screenshot of the game. I can't capture your game from here. If you're already there, update Willo first." };
  const friend = friends[0];
  return {
    answer: `I'll prepare a screenshot of the game for ${friend.name}. You'll see the picture and choose Send before anything is shared.`,
    action: { id: "capture_game_to_friend", args: { to: friend.id, name: String(friend.name).slice(0, 40) }, label: "Preview screenshot" },
  };
}
