// Friend sharing is a preview of the actual game window, prepared on the desktop. The site resolves the recipient;
// it never captures, uploads or sends anything here. Historical cards remain readable, but no new cards are offered.
import { ONLINE_MINUTES } from "./friends.js";

export const capturesFrom = capabilities => String(capabilities || "").split(/[,\s]+/).includes("game-screenshot-sharing");
// A desktop that can take one before anyone is named (screenshot_share.py prepare with no "to"), from 0.29.0.
const holdsFrom = capabilities => String(capabilities || "").split(/[,\s]+/).includes("game-screenshot-take");
export const HELD = "Here's your screenshot. Want me to send it to a friend? Say their name.";
// "a current screenshot", "a quick picture": one word may come before it.
const SHOT = String.raw`(?:(?:a|the)\s+)?(?:[\p{L}-]+\s+)?(?:screenshot|screen\s*shot|photo|picture)`;
const NAME = String.raw`(?<name>[\p{L}][\p{L}\p{N}'-]{1,31}(?:\s+[\p{L}][\p{L}\p{N}'-]{1,31}){0,3})`;
const LEAD = String.raw`^(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|please\s+|go\s+ahead\s+and\s+|(?:i\s+want|i'd\s+like)\s+you\s+to\s+)?`;
const TO = new RegExp(LEAD + String.raw`(?:send|share|forward|pass|show)\s+(?<what>.{1,120}?)\s+(?:to|with)\s+${NAME}\s*[.!?]*$`, "iu");
const FIRST = new RegExp(LEAD + String.raw`(?:send|show)\s+${NAME}\s+(?<what>(?:this|that|it|my|the|a|an|where|what|your|"|\[).{0,100}?)\s*[.!?]*$`, "iu");
const TAKE = new RegExp(LEAD + String.raw`(?:take|capture|grab)\s+(?<what>${SHOT}.{0,70}?)\s+(?:and|then)\s+(?:send|share|show)\s+(?:(?:it|this|that)\s+)?(?:to|with)\s+${NAME}\s*[.!?]*$`, "iu");
const ONLY = new RegExp(LEAD + String.raw`(?:take|capture|grab|snap)\s+(?:me\s+)?${SHOT}(?:\s+(?:of|from)\s+(?:my|the|this)\s+(?:game|screen))?(?:\s+(?:for\s+me|now|right\s+now))?\s*[.!?]*$`, "iu");
// "my friend", "my only friend", "one of my friends": whoever's there, not a name (sendOffer picks the only one or asks).
const ANY_FRIEND = /^(?:(?:a|my|one of my|that|this|the)\s+)?(?:(?:only|one|best|new)\s+)?(?:friends?|buddy|pal|mate)$/i;
const NOT_NAME = /^(?:me|myself|you|yourself|him|her|them|us|everyone|everybody|someone|anyone|all|my|the|a|an|it|this|that|willo|willow|here|there|back|over|out|up|home)$/i;
const clean = q => String(q || "").replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
  .replace(/^\s*(?:hey\s+)?willow?[,!]?\s*/i, "").replace(/,?\s+please\s*[.!?]*$/i, "").trim();

// Commands only; questions about in-game mail, lore characters or how to share never become actions.
export function sendIntent(question) {
  const q = clean(question);
  if (!q || q.length > 260) return null;
  const m = TAKE.exec(q) || TO.exec(q) || FIRST.exec(q);
  if (!m) {
    // A screenshot asked for with no one named is taken first (sendOffer), never a guessed person or a model answer.
    if (ONLY.test(q)) return { name: "", what: "screenshot", kind: "screenshot", take: true };
    const missing = /^(?:(?:can|could|would|will) you (?:please )?|please )?(?:(?:take|capture|grab) (?:a |the )?(?:[\p{L}-]+ )?(?:screenshot|screen shot|picture|photo)(?: of (?:my|the) game)? (?:and|then) )?(?:send|share)(?: (?:it|this|that|a screenshot|the screenshot|a picture|a photo))?(?: (?:to|with)(?: a friend| my friend)?)?\s*[.!?]*$/iu;
    if (missing.test(q)) return { name: "", what: "screenshot", kind: "screenshot", take: /\b(?:screenshot|screen shot|picture|photo)\b/i.test(q), anyone: true };
    return null;
  }
  const name = m.groups.name.trim(), what = m.groups.what.trim();
  const screenshot = /\b(?:screenshot|screen\s*shot|photo|picture)\b/i.test(what) || /^(?:this|that|it)$/i.test(what);
  if (ANY_FRIEND.test(name) || (screenshot && /^(?:him|her|them)$/i.test(name))) return { name: "", what, kind: "screenshot", take: true, anyone: true };
  if (NOT_NAME.test(name) || /^(?:me|myself|you|yourself)\b/i.test(what)) return null;
  // Bare names and unsupported messages are considered only when the named player is an accepted friend.
  const oldCard = /\b(?:location|quest|target|item|story|lore|where i am|what you|your answer)\b/i.test(what);
  return { name, what, kind: screenshot ? "screenshot" : "retired", ...(!screenshot && !oldCard ? { loose: true } : {}) };
}

// A name alone answers only our immediately preceding screenshot-recipient clarification.
export function screenshotRecipientReply(parts) {
  const said = String(parts.previous || "").replace(/’/g, "'");
  const held = said.startsWith(HELD.split("?")[0]) || said.startsWith("For your screenshot, ");
  if (!(held || (sendIntent(parts.previousQuestion)?.kind === "screenshot"
    && /^(?:Which friend should I send it to\?|You have more than one friend called )/.test(said)))) return null;
  const name = String(parts.question || "").trim().replace(/^(?:(?:send|share)\s+(?:it\s+)?)?(?:to|with)\s+/i, "")
    .replace(/^@/, "").replace(/[.!?]+$/, "");
  if (ANY_FRIEND.test(name) || /^(?:him|her|them)$/i.test(name)) return { name: "", what: "screenshot", kind: "screenshot", who: true };
  // A yes or no to the picture she's holding: who to, or nothing sent.
  if (held && /^(?:y(?:es|eah|ep|up)|sure|ok(?:ay)?|please(?: do)?)(?:,? please)?$/i.test(name)) return { name: "", what: "screenshot", kind: "screenshot", who: true };
  if (held && /^(?:no|nope|nah|no thanks?|no thank you|not now|thanks|thank you|cool|nice|great|perfect)$/i.test(name)) return { name: "", what: "screenshot", kind: "screenshot", keep: true };
  if (!/^[\p{L}][\p{L}\p{N}'-]{1,31}(?:\s+[\p{L}][\p{L}\p{N}'-]{1,31}){0,3}$/u.test(name) || NOT_NAME.test(name)) return null;
  return { name, what: "screenshot", kind: "screenshot" };
}

// A friend's character, while they share where they are (lib/friends.js progressOf): a name to call someone by when their
// profile has none.
const characterOf = r => {
  if (!r.share || !r.progress) return null;
  try { return String(JSON.parse(r.progress).character || "").slice(0, 40) || null; } catch (e) { return null; }
};
// How Willo says who a friend is: their name (and handle), never a stand-in when either exists.
const said = f => f.name ? `${f.name}${f.handle && f.handle.toLowerCase() !== f.name.toLowerCase() ? ` (@${f.handle})` : ""}`
  : "a friend with no name yet";
const listed = fs => {
  const names = fs.slice(0, 5).map(said);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0];
};

// Every accepted friend, in one read: [{id, name, handle, character, online}]; name: the profile's, else handle, else
// character, else null.
async function friendsOf(env, userId, now) {
  const { results } = await env.DB.prepare(
    "SELECT p.pid, p.hide_online, p.share, p.progress, pr.handle, json_extract(pr.data, '$.name') AS name, " +
    "EXISTS (SELECT 1 FROM devices d WHERE d.user_id = e.other_id AND d.last_used > ?) AS online " +
    "FROM friend_edges e JOIN friend_edges b ON b.user_id = e.other_id AND b.other_id = e.user_id AND b.state = 'friends' " +
    "JOIN friend_people p ON p.user_id = e.other_id LEFT JOIN profiles pr ON pr.user_id = e.other_id " +
    "WHERE e.user_id = ? AND e.state = 'friends'").bind(new Date(now - ONLINE_MINUTES * 60e3).toISOString(), userId).all();
  return results.map(r => ({ id: r.pid, name: r.name || r.handle || characterOf(r), handle: r.handle, character: characterOf(r),
                             online: r.hide_online ? null : Boolean(r.online) }));
}
const named = (friends, name) => {
  const want = String(name || "").toLowerCase();
  const names = f => [f.name, f.handle, String(f.handle || "").replace(/-/g, " "), f.character].filter(Boolean).map(n => String(n).toLowerCase());
  const exact = friends.filter(f => names(f).includes(want));
  return exact.length ? exact : friends.filter(f => names(f).some(n => n.split(/[\s-]/)[0] === want));
};

// Who is meant, from what the player called them ("" or "my only friend" when no one is named) and their accepted
// friends (friendsOf): {friend}, {ask: friends} to choose from (same: they share the name said), or {none: true} with
// no friends at all. Never a dead end while someone's there: the only friend is who's meant, several are listed. One
// place, so a later answer that picks a friend itself is checked against the same list.
export function resolveFriend(phrase, friends) {
  if (!friends.length) return { none: true };
  const said = String(phrase || "").trim();
  const found = said && !ANY_FRIEND.test(said) && !/^(?:him|her|them)$/i.test(said) ? named(friends, said) : [];
  if (found.length === 1) return { friend: found[0] };
  if (found.length > 1) return { ask: found, same: true };
  return friends.length === 1 ? { friend: friends[0] } : { ask: friends };
}

export async function sendOffer(env, userId, intent, capabilities, now = Date.now()) {
  const canCapture = capturesFrom(capabilities);
  if (intent.keep) return { answer: "Okay, I won't send it." };
  const anyone = !intent.name && Boolean(intent.anyone || intent.who);
  if (!intent.name && !anyone && intent.take && canCapture && holdsFrom(capabilities))
    return { answer: HELD, action: { id: "capture_game_to_friend", args: {}, label: "Preview screenshot" } };
  if (!intent.name && intent.take && !canCapture)
    return { answer: "Use Willo on your PC or Mac to take a screenshot of the game. I can't capture your game from here. If you're already there, update Willo first." };
  if (!intent.name && !anyone) return { answer: "Which friend should I send it to? Say their name or profile handle." };
  const all = await friendsOf(env, userId, now);
  // A bare name or an unsupported message naming no friend is a question for her answer, not a send.
  if (intent.loose && !named(all, intent.name).length) return null;
  const who = resolveFriend(intent.name, all);
  if (who.none) return { answer: intent.name ? `I don't see ${intent.name} among your friends yet. Add them in Friends first.`
    : "You don't have any friends here yet. Add them in Friends first." };
  if (who.same) {
    const names = who.ask.slice(0, 4).map(f => `${f.name}${f.handle ? ` (@${f.handle})` : ""}`);
    return { answer: `${intent.kind === "screenshot" ? "For your screenshot, you have" : "You have"} more than one friend called ${intent.name}: ${names.slice(0, -1).join(", ")} and ${names.at(-1)}. Say their full name or handle.` };
  }
  if (intent.kind !== "screenshot") return { answer: "I don't send game cards anymore. I can share a screenshot of the game instead. Ask Willo on your PC or Mac to take a screenshot and send it to your friend." };
  if (!canCapture) return { answer: "Use Willo on your PC or Mac to share a screenshot of the game. I can't capture your game from here. If you're already there, update Willo first." };
  // Several and none meant: who's there to choose from, the picture taken now (and held) on a desktop that can hold one.
  if (who.ask) return { answer: `For your screenshot, which friend should I send it to: ${listed(who.ask)}?`,
    ...(intent.take && holdsFrom(capabilities) ? { action: { id: "capture_game_to_friend", args: {}, label: "Preview screenshot" } } : {}) };
  const friend = { ...who.friend, name: who.friend.name || "your friend" };
  return {
    answer: `I'll prepare a screenshot of the game for ${friend.name}. You'll see the picture and choose Send before anything is shared.`,
    action: { id: "capture_game_to_friend", args: { to: friend.id, name: String(friend.name).slice(0, 40) }, label: "Preview screenshot" },
  };
}
