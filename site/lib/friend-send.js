// Willo's sends to friends (LOR-844 step 1). Screenshots: a preview of the actual game window, prepared on the desktop;
// the site resolves the recipient and never captures, uploads or sends one here. Historical cards remain readable, but
// no new cards are offered. Messages (below): her answer's message_friend, read back and sent on a yes, here.
import { ONLINE_MINUTES, cleanMessage, sendMessage, MESSAGES_PER_MINUTE, MESSAGES_PER_DAY, FREE_MESSAGES_PER_DAY, FriendError,
  addFriend, answerRequest, removeFriend, blockPlayer, unblockPlayer, unsendMessage, setSharing, conversation, UNSEND_MINUTES,
  ASKS_PER_DAY, parseWho, linkOwner } from "./friends.js";
import { perMinute, perDay, unDay } from "./ratelimit.js";
import { plansOn, planIdNow } from "./billing.js";
import { KEEPS_DOES, keepsChange } from "./willo-keeps.js";

export const capturesFrom = capabilities => String(capabilities || "").split(/[,\s]+/).includes("game-screenshot-sharing");
// A desktop that can take one before anyone is named (screenshot_share.py prepare with no "to"), from 0.29.0.
const holdsFrom = capabilities => String(capabilities || "").split(/[,\s]+/).includes("game-screenshot-take");
export const HELD = "Here's your screenshot. Want me to send it to a friend? Say their name.";
// "a current screenshot", "a quick picture": one word may come before it.
const SHOT = String.raw`(?:(?:a|the)\s+)?(?:[\p{L}-]+\s+)?(?:screenshot|screen\s*shot|photo|picture)`;
const NAME = String.raw`(?<name>[\p{L}][\p{L}\p{N}'-]{1,31}(?:\s+[\p{L}][\p{L}\p{N}'-]{1,31}){0,3})`;
export const LEAD = String.raw`^(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|please\s+|go\s+ahead\s+and\s+|(?:i\s+want|i'd\s+like)\s+you\s+to\s+)?`;
const TO = new RegExp(LEAD + String.raw`(?:send|share|forward|pass|show)\s+(?<what>.{1,120}?)\s+(?:to|with)\s+${NAME}\s*[.!?]*$`, "iu");
const FIRST = new RegExp(LEAD + String.raw`(?:send|show)\s+${NAME}\s+(?<what>(?:this|that|it|my|the|a|an|where|what|your|"|\[).{0,100}?)\s*[.!?]*$`, "iu");
const TAKE = new RegExp(LEAD + String.raw`(?:take|capture|grab)\s+(?<what>${SHOT}.{0,70}?)\s+(?:and|then)\s+(?:send|share|show)\s+(?:(?:it|this|that)\s+)?(?:to|with)\s+${NAME}\s*[.!?]*$`, "iu");
const ONLY = new RegExp(LEAD + String.raw`(?:take|capture|grab|snap)\s+(?:me\s+)?${SHOT}(?:\s+(?:of|from)\s+(?:my|the|this)\s+(?:game|screen))?(?:\s+(?:for\s+me|now|right\s+now))?\s*[.!?]*$`, "iu");
// "my friend", "my only friend", "one of my friends": whoever's there, not a name (sendOffer picks the only one or asks).
export const ANY_FRIEND = /^(?:(?:a|my|one of my|that|this|the)\s+)?(?:(?:only|one|best|new)\s+)?(?:friends?|buddy|pal|mate)$/i;
export const NOT_NAME = /^(?:me|myself|you|yourself|him|her|them|us|everyone|everybody|someone|anyone|all|my|the|a|an|it|this|that|willo|willow|here|there|back|over|out|up|home)$/i;
export const clean = q => String(q || "").replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
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
  // "send Mira a message saying…": words, her answer's message_friend (below), never a card.
  if (!screenshot && /\b(?:message|note|text|msg|line)\b|^(?:the\s+same|that\s+too|the\s+same\s+thing)$/i.test(what)) return null;
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
export const said = f => f.name ? `${f.name}${f.handle && f.handle.toLowerCase() !== f.name.toLowerCase() ? ` (@${f.handle})` : ""}`
  : "a friend with no name yet";
export const listed = fs => {
  const names = fs.slice(0, 5).map(said);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0];
};

// Every accepted friend, in one read: [{id, name, handle, character, online}]; name: the profile's, else handle, else
// character, else null.
export async function friendsOf(env, userId, now) {
  const { results } = await env.DB.prepare(
    "SELECT p.pid, p.hide_online, p.share, p.progress, pr.handle, json_extract(pr.data, '$.name') AS name, " +
    "EXISTS (SELECT 1 FROM devices d WHERE d.user_id = e.other_id AND d.last_used > ?) AS online " +
    "FROM friend_edges e JOIN friend_edges b ON b.user_id = e.other_id AND b.other_id = e.user_id AND b.state = 'friends' " +
    "JOIN friend_people p ON p.user_id = e.other_id LEFT JOIN profiles pr ON pr.user_id = e.other_id " +
    "WHERE e.user_id = ? AND e.state = 'friends'").bind(new Date(now - ONLINE_MINUTES * 60e3).toISOString(), userId).all();
  return results.map(r => ({ id: r.pid, name: r.name || r.handle || characterOf(r), handle: r.handle, character: characterOf(r),
                             online: r.hide_online ? null : Boolean(r.online) }));
}
export const named = (friends, name) => {
  const want = String(name || "").toLowerCase();
  const names = f => [f.name, f.handle, String(f.handle || "").replace(/-/g, " "), f.character].filter(Boolean).map(n => String(n).toLowerCase());
  const exact = friends.filter(f => names(f).includes(want));
  return exact.length ? exact : friends.filter(f => names(f).some(n => n.split(/[\s-]/)[0] === want));
};

// "Mira, I'll be late": a friend spoken to by name first is a message with no verb (the Architect, 10/26). The cue is
// the shape alone, so most questions never read their friends; spokenTo says whether the name is a friend's.
const ADDRESSED = /^(?:(?:hey|hi|yo|oi)\s+)?([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)?)\s*[,:]\s*\S/u;
export const addressCue = question => ADDRESSED.test(clean(question));
export const spokenTo = (friends, question) => {
  const who = ADDRESSED.exec(clean(question))?.[1];
  return who ? named(friends, who) : [];
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

// ---- Messages ----
// Willo sends a friend a message (Mike, 10/25: "she can't send simple messages to friends which is silly if she can
// support sending a picture"). Her answer is offered message_friend when a question might ask for one (lib/willo-
// tools.js messageFriendTool); its pick is checked here against their friends and their words (messageCall), read back
// with the exact words (messageConfirm) and held here a moment (holdMessage); only a plain yes to that read-back, as the
// very next thing they say, sends it (messageReply, sendHeld), through the Friends tab's own send and limits. Nothing
// new reaches Willo's app, so every Willo has it: her PC, her Mac and the iPhone.
export const MESSAGE_TOOL = "message_friend";
// As long as Willo's PC keeps an offer for a spoken yes (companion talk/talker.py OFFER_WAIT).
export const HOLD_SECONDS = 120;
const READ_BACK = /^Send this to (?<who>.+?): "(?<text>[\s\S]+)" Say yes and I'll send it\.$/;
const WHO_FOR = /^Who should I send "(?<text>[\s\S]+)" to: /;
const WHAT_TO_SAY = /^What should I say to (?<who>.+?)\?$/;
// As long as she waits for the words after asking what to say (typing one takes longer than a yes).
export const ASK_SECONDS = 600;
const QUOTES = /^["“'](.*)["”']$/s;
const firstUp = t => t.charAt(0).toUpperCase() + t.slice(1);

// The read-back: who it goes to and the exact words that will go. A friend with no name or handle is "your friend"
// (the only way to have picked them).
export const messageConfirm = (friend, text) =>
  `Send this to ${friend.name ? said(friend) : "your friend"}: "${text}" Say yes and I'll send it.`;
const whoFor = (friends, text) => `Who should I send "${text}" to: ${listed(friends)}?`;
const whatToSay = friend => `What should I say to ${friend.name ? said(friend) : "your friend"}?`;
// Her answer written to look like either of those ("send the same to Doran too", with a read-back in her history):
// only messageCall's lines are hers to say (the Architect's review, 10/25).
export const messageLine = text => {
  const t = String(text || "").replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  return /\bSay yes and I'll send it\b/i.test(t) || WHO_FOR.test(t.trim()) || WHAT_TO_SAY.test(t.trim()) ||
    CHANGE_BACK.test(t.trim());
};

// The words a message may have that the player didn't say: the friend's "you" for "she", a question's first words
// ("ask Mira if she wants to…" is "Do you want to…?"), and the little words.
const OWN = new Set(("you your yours you're youre you'll you'd yourself are is am was were be i i'm im me my we our us a an " +
  "the and or to of in on at for it that this do does did can could will would should shall have has").split(" "));
const wordsOf = t => (String(t).toLowerCase().replace(/[’‘]/g, "'").match(/[\p{L}\p{N}']+/gu) || []).map(w => w.replace(/'s$/, ""));
const FRIEND_WORDS = /\bmy\s+(?:\w+\s+)?(?:friends?|buddy|pal|mate)\b/i;

// Her answer's call, checked: {friend, text} to read back, {ask, text} when they meant one of several, or null (she
// answers as she wrote). Only a friend they named (a name, its first word, a handle, a character) or "my friend":
// never one the model reached for when they named someone else ("tell Thrall I'm coming", the lab, 10/25), and never
// "tell her hi" with no one named. The words: tidied at most, never added to. No words yet ("send a message to my
// friend"): {friend, text: ""}, for one friend only, and she asks what to say.
export function messageCall(call, friends, question) {
  if (call?.name !== MESSAGE_TOOL || !friends.length) return null;
  // A question about them is never a send ("did Mira message me?", "what did Brann say?").
  if (/^(?:what|who|where|when|why|how|which|did|does|do|is|are|was|were|has|have|had)\b/i.test(clean(question))) return null;
  const text = cleanMessage(typeof call.args?.text === "string" ? call.args.text.trim().replace(QUOTES, "$1") : "");
  const asked = new Set(wordsOf(question)), stem = w => w.replace(/(?:ing|ed|s)$/, "");
  const stems = new Set([...asked].map(stem));
  if (text && !wordsOf(text).every(w => OWN.has(w) || asked.has(w) || stems.has(stem(w)))) return null;
  const spoken = ` ${wordsOf(question).join(" ")} `;
  const names = f => [f.name, f.handle, String(f.handle || "").replace(/-/g, " "), f.character, String(f.name || "").split(/\s+/)[0]]
    .filter(n => n && n.length > 1).map(n => wordsOf(n).join(" "));
  const meant = friends.filter(f => names(f).some(n => spoken.includes(` ${n} `)));
  const picked = friends.find(f => f.id === call.args?.friend_id);
  if (meant.length === 1 || (picked && meant.includes(picked))) return { friend: picked && meant.includes(picked) ? picked : meant[0], text: firstUp(text) };
  if (meant.length > 1) return text ? { ask: meant, text: firstUp(text) } : null;
  if (FRIEND_WORDS.test(question)) return friends.length === 1 ? { friend: friends[0], text: firstUp(text) }
    : text ? { ask: friends, text: firstUp(text) } : null;
  return null;
}

// Her line for a checked call, holding the message when it's a read-back: {answer}.
export async function messageOffer(env, userId, read, now = Date.now()) {
  if (!read.friend) return { answer: whoFor(read.ask, read.text) };
  if (!read.text) {
    await hold(env, userId, "ask_message", read.friend.id, read.friend.name ? said(read.friend) : "your friend", now);
    return { answer: whatToSay(read.friend) };
  }
  await holdMessage(env, userId, read.friend, read.text, now);
  return { answer: messageConfirm(read.friend, read.text) };
}

// The one thing waiting on their yes (a message, or a change to their friends: kind), in place of any before it.
const hold = (env, userId, kind, recipient, body, now) => env.DB.prepare(
  "INSERT OR REPLACE INTO friend_pending (user_id, recipient, body, created, kind) VALUES (?, ?, ?, ?, ?)")
  .bind(userId, String(recipient), body, new Date(now).toISOString(), kind).run();
export async function holdMessage(env, userId, friend, text, now = Date.now()) {
  await hold(env, userId, "message", friend.id, text, now);
}

const YES = /^(?:y(?:es|eah|ep|up)|sure|ok(?:ay)?|send(?:\s+it)?|do\s+it|go\s+ahead|please(?:\s+do)?)(?:[\s,]+(?:please|thanks?|thank\s+you|willow?))*[\s.!]*$/i;
const NO = /^(?:no|nope|nah|don't|do\s+not|cancel|stop|never\s*mind|not\s+now|no\s+thanks?|no\s+thank\s+you)\b/i;

// What their words do right after her read-back or her question who to: {send: {id, name, text}} for a plain yes to a
// message still held, {answer} for a no, a late yes or a friend picked (their read-back, held), or null: anything else
// is a question of its own and drops the message. Only after one of her lines, so no other turn reads anything.
export async function messageReply(env, userId, parts, now = Date.now()) {
  const previous = String(parts.previous || "").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').trim();
  const back = READ_BACK.exec(previous), asked = back ? null : WHO_FOR.exec(previous);
  const reply = clean(parts.question).replace(/^@/, "").replace(/[.!?]+$/, "").trim();
  const wait = !back && !asked ? WHAT_TO_SAY.exec(previous) : null;
  if (wait) return wordsReply(env, userId, wait.groups.who, parts.question, reply, now);
  if (!back && !asked) return changeReply(env, userId, previous, reply, now);
  if (back) {
    const held = await taken(env, userId);
    if (NO.test(reply)) return { answer: "Okay, I won't send it." };
    if (!YES.test(reply)) return null;
    // Compared with straight quotes, so the curly ones an iPhone types match her read-back; sent as they wrote it.
    if (!held || held.kind !== "message" || clean(held.body) !== clean(back.groups.text)) return { answer: "I didn't send that one. Ask me again and I'll read it back." };
    if (now - Date.parse(held.created) > HOLD_SECONDS * 1000)
      return { answer: "That was a little while ago, so I didn't send it. Ask me again and I'll read it back." };
    return { send: { id: held.recipient, name: back.groups.who, text: held.body } };
  }
  if (!reply || reply.split(/\s+/).length > 4 || NO.test(reply)) return null;
  const friends = await friendsOf(env, userId, now);
  const exact = named(friends, reply);
  if (exact.length !== 1) return exact.length > 1 ? { answer: whoFor(exact, asked.groups.text) } : null;
  return messageOffer(env, userId, { friend: exact[0], text: asked.groups.text }, now);
}

// Their words after her "What should I say to Ularli?": the message, read back ("Ularli, it's time to do some BGs" is
// "It's time to do some BGs"; QA 10/26 took it for a question), or a no; null once she's stopped waiting (a new question).
async function wordsReply(env, userId, who, question, reply, now) {
  const held = await taken(env, userId);
  if (!held || held.kind !== "ask_message" || now - Date.parse(held.created) > ASK_SECONDS * 1000) return null;
  if (NO.test(reply) && reply.split(/\s+/).length <= 4) return { answer: "Okay, I won't send anything." };
  const name = held.body.replace(/\s*\(@[^)]*\)$/, ""), esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const them = `(?:${[name, name.split(/\s+/)[0]].map(esc).join("|")})`;
  const text = cleanMessage(clean(question).trim()
    .replace(new RegExp(String.raw`^(?:please\s+)?(?:tell|ask|message|text)\s+${them}\s+(?:that\s+)?`, "i"), "")
    .replace(new RegExp(String.raw`^${them}\s*[,:\u2014-]\s*`, "i"), "")
    .replace(/^(?:just\s+)?(?:say|tell\s+(?:him|her|them))\s+(?:that\s+)?/i, "").replace(QUOTES, "$1"));
  if (!text) return null;
  return messageOffer(env, userId, { friend: { id: held.recipient, name: held.body }, text: firstUp(text) }, now);
}

// "Did you send it?" after a send of theirs (QA 10/26: "I haven't changed anything in your Friends", for one that went
// at 04:31): what went last, if in the last SENT_MINUTES, as {answer}, else null.
export const SENT_MINUTES = 15;
export async function lastSent(env, userId, now = Date.now()) {
  const row = await env.DB.prepare("SELECT p.pid, m.created, m.seen FROM friend_messages m JOIN friend_people p " +
    "ON p.user_id = m.recipient WHERE m.sender = ? AND m.created > ? ORDER BY m.created DESC LIMIT 1")
    .bind(userId, new Date(now - SENT_MINUTES * 60e3).toISOString()).first();
  if (!row) return null;
  const friend = (await friendsOf(env, userId, now)).find(f => f.id === row.pid);
  if (!friend) return null;
  const name = nameOf(friend);
  return { answer: `Yes, it went to ${name} ${ago(row.created)}.${row.seen ? ` ${name} has read it.` : ""}` };
}

// Text and screenshots share the same limits and plan entitlements as the Friends tab (functions/api/friends/[action].js
// counts its sends here too): null, or {status, error}. All at once, the free plan's day given back (after the reply:
// later) when it doesn't apply.
export async function messageLimit(env, userId, later = work => work) {
  const plans = plansOn(env);
  const [minute, day, plan, freeDay] = await Promise.all([
    perMinute(env, userId, "friends-send", MESSAGES_PER_MINUTE),
    perDay(env, userId, "friends-send-day", MESSAGES_PER_DAY),
    plans ? planIdNow(env, userId) : null,
    plans ? perDay(env, userId, "friends-send-free", FREE_MESSAGES_PER_DAY) : true,
  ]);
  const giveBack = () => (plans ? later(unDay(env, userId, "friends-send-free")) : null);
  if (!minute) return (await giveBack(), { status: 429, slow: true, error: "Going a little fast. Carrying on in a moment..." });
  if (!day) return (await giveBack(), { status: 429, error: "That's a lot of messages for one day. Try again tomorrow." });
  if (plan !== "free") return (await giveBack(), null);
  if (!freeDay) return { status: 429, free: true, error: `That's today's ${FREE_MESSAGES_PER_DAY} messages on the free plan. ` +
    "More tomorrow, or as many as you like from Hero up." };
  return null;
}

// The held message, on its yes: {answer}. Out loud, never a plan's name. later: the bookkeeping after the reply.
export async function sendHeld(env, userId, held, { spoken = false, later = work => work, now = Date.now() } = {}) {
  const limited = await messageLimit(env, userId, later);
  if (limited) return { answer: limited.slow ? "Give me a moment, then ask me again."
    : limited.free && spoken ? "That's all your messages for today. More tomorrow." : limited.error };
  try {
    await sendMessage(env, userId, held.id, held.text, now, null, { later });
  } catch (e) {
    if (e?.status === 403) return { answer: "You two aren't friends any more, so I didn't send it." };
    throw e;
  }
  return { answer: `Sent to ${held.name}.` };
}

// ---- Friends by voice ----
// The rest of Friends, asked of her (LOR-844 step 6, Mike: "We want a fully activated voice interface for her
// features"): who's there and who's on, their messages, requests, her friend code (friends_look, read here and said in
// her words), and every change (friends_change): a request, accepting or turning one down, removing, blocking or
// unblocking someone, taking back a message, sharing where they are. Each change is read back and held like a message
// (holdChange); only a plain yes to it, next, does it (changeReply, doChange), with the Friends tab's own functions and
// limits. On the site only, so every Willo has it.
export const LOOK_TOOL = "friends_look", CHANGE_TOOL = "friends_change";
export const LOOKS = ["friends", "online", "messages", "requests", "code"];
export const CHANGES = ["add", "accept", "decline", "remove", "block", "unblock", "unsend", "share_on", "share_off"];
// The end of each change's read-back, which a yes answers.
const DOES = { add: "send the request", accept: "accept it", decline: "decline it", remove: "remove them", block: "block them",
  unblock: "unblock them", unsend: "take it back", share_on: "start sharing", share_off: "stop sharing",
  // What Willo keeps, erased on the same yes (lib/willo-keeps.js keepsCall).
  ...KEEPS_DOES };
const CHANGE_BACK = new RegExp(String.raw`Say yes and I'll (${Object.values(DOES).join("|")})\.$`);
const KIND_OF = Object.fromEntries(Object.entries(DOES).map(([k, v]) => [v, k]));
const CHANGES_PER_MINUTE = 20;            // as the Friends tab's (functions/api/friends/[action].js change)

const taken = (env, userId) => env.DB.prepare(
  "DELETE FROM friend_pending WHERE user_id = ? RETURNING recipient, body, created, kind").bind(userId).first();
const nameOf = f => (f?.name && f.name !== "A Lore Forever player" ? f.name : f?.handle ? `@${f.handle}` : "your friend");
const ago = at => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60e3));
  return m < 1 ? "just now" : m < 60 ? `${m} minute${m === 1 ? "" : "s"} ago` : m < 1440 ? `${Math.round(m / 60)} hour${m < 90 ? "" : "s"} ago` : "a while ago";
};
const and = names => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] || "";

// Whom a change names among everyone in their Friends (friendsList: friends, requests, blocked), by the words they said.
function namedIn(people, question) {
  const spoken = ` ${wordsOf(question).join(" ")} `;
  const names = f => [f.name !== "A Lore Forever player" && f.name, f.handle, String(f.handle || "").replace(/-/g, " "),
    String(f.name || "").split(/\s+/)[0]].filter(n => n && n.length > 1).map(n => wordsOf(n).join(" "));
  return people.filter(f => names(f).some(n => spoken.includes(` ${n} `)));
}

// Her answer's friends_look or friends_change, checked, with their Friends (friendsList) in hand: {answer} to say (a
// look, said from what's there, never the model's words), {hold: {kind, recipient, body}, answer} (a change read back),
// or null (she answers as she wrote). A change only for someone they named, never for a how-to question ("how do I
// block someone?") and never a "share" they didn't ask for.
export async function friendsCall(env, userId, call, list, question, now = Date.now(), { spoken = false } = {}) {
  const q = clean(question);
  if (call?.name === LOOK_TOOL && LOOKS.includes(call.args?.what)) return { answer: await look(env, userId, call.args.what, list, question, spoken) };
  if (call?.name !== CHANGE_TOOL || !CHANGES.includes(call.args?.change)) return null;
  if (/^(?:how|what|why|where|when|which|who|can\s+i|could\s+i|should\s+i|do\s+i|is\s+it|will\s+they|does)\b/i.test(q)) return null;
  const change = call.args.change;
  if (change === "add") {
    const who = String(call.args.who || "").trim().replace(/^@/, "");
    if (!who || !wordsOf(question).includes(who.toLowerCase()) && !q.toLowerCase().includes(who.toLowerCase())) return null;
    // Exactly one player, read back as their profile name (unique) or their code's owner, never a display name.
    const parsed = parseWho(who);
    const byName = parsed?.handle && await env.DB.prepare("SELECT handle, json_extract(data, '$.name') AS name FROM profiles WHERE handle = ?")
      .bind(parsed.handle).first();
    const byCode = !byName && parsed?.code ? await linkOwner(env, parsed.code) : null;
    if (!byName && (!byCode || byCode.creator)) return { answer: `I can't find a player called ${who}. Ask them for their profile name or friend code.` };
    const target = byName ? `@${byName.handle}` : parsed.code, called = byName ? byName.name : byCode.name;
    const shown = called && called.toLowerCase() !== String(byName?.handle) ? `${target} (${called})` : target;
    return { hold: { kind: "add", recipient: target, body: shown }, answer: `Send a friend request to ${shown}? Say yes and I'll ${DOES.add}.` };
  }
  if (change === "share_on" || change === "share_off") {
    if (!/\bshar(?:e|ing)\b|\bwhere\s+i\s+am\b|\blocation\b/i.test(q)) return null;
    return change === "share_on"
      ? { hold: { kind: change, recipient: "me", body: "" }, answer: `Share where you are with your friends? Say yes and I'll ${DOES.share_on}.` }
      : { hold: { kind: change, recipient: "me", body: "" }, answer: `Stop sharing where you are with your friends? Say yes and I'll ${DOES.share_off}.` };
  }
  const pool = change === "accept" || change === "decline" ? list.incoming : change === "unblock" ? list.blocked : list.friends;
  const meant = namedIn(pool, question);
  // "Take that back": their last message, when it can still be taken back, to whoever they named or to anyone.
  if (change === "unsend") {
    if (!/\b(?:take|took|pull|unsend|delete|cancel|undo)\b/i.test(q)) return null;
    const to = meant.length === 1 ? meant[0] : null;
    const row = await env.DB.prepare("SELECT m.id, m.body, m.seen, m.created, p.pid FROM friend_messages m JOIN friend_people p " +
      `ON p.user_id = m.recipient WHERE m.sender = ?${to ? " AND p.pid = ?" : ""} ORDER BY m.id DESC LIMIT 1`)
      .bind(userId, ...(to ? [to.id] : [])).first();
    const friend = row && list.friends.find(f => f.id === row.pid);
    if (!row || !friend) return { answer: "There's no message of yours to take back." };
    if (row.seen) return { answer: `${nameOf(friend)} has read it already, so it can't be taken back.` };
    if (Date.parse(row.created) < now - UNSEND_MINUTES * 60e3) return { answer: "That one's too old to take back now." };
    const text = row.body.length > 80 ? `${row.body.slice(0, 77)}...` : row.body;
    return { hold: { kind: "unsend", recipient: String(row.id), body: nameOf(friend) },
      answer: `Take back your message to ${nameOf(friend)}, "${text}"? Say yes and I'll ${DOES.unsend}.` };
  }
  if (meant.length !== 1) return meant.length > 1 ? { answer: `Which one: ${and(meant.map(nameOf))}? Say their full name.` } : null;
  const who = meant[0], name = nameOf(who);
  const line = { accept: `Accept ${name}'s friend request?`, decline: `Turn down ${name}'s friend request?`,
    remove: `Remove ${name} from your friends?`, block: `Block ${name}? They won't be able to message you or add you.`,
    unblock: `Unblock ${name}?` }[change];
  return { hold: { kind: change, recipient: who.id, body: name }, answer: `${line} Say yes and I'll ${DOES[change]}.` };
}

export const holdChange = (env, userId, held, now = Date.now()) => hold(env, userId, held.kind, held.recipient, held.body, now);

// What's there, in her words.
async function look(env, userId, what, list, question, spoken) {
  const friends = list.friends;
  if (what === "code") {
    // Loaded here: lib/referrals.js loads accounts.js, which loads friends.js.
    const { shareCode } = await import("./referrals.js");
    const code = await shareCode(env, userId);
    return `Your friend code is ${code}.${list.me.handle ? ` Friends can also add you by your name, @${list.me.handle}.` : ""}`;
  }
  if (what === "requests") return list.incoming.length
    ? `${and(list.incoming.map(nameOf))} ${list.incoming.length === 1 ? "wants" : "want"} to be your friend${list.incoming.length === 1 ? "" : "s"}.`
    : "No friend requests right now.";
  if (!friends.length) return "You don't have any friends here yet. Tell me their name or code and I'll send a request.";
  if (what === "online") {
    const on = friends.filter(f => f.online === true);
    // Online is their Willo on lately (lib/friends.js), not the game: what Friends shows ("Willo connected").
    return on.length ? `${and(on.map(nameOf))} ${on.length === 1 ? "has" : "have"} their Willo with them right now.`
      : "None of your friends have their Willo with them right now.";
  }
  if (what === "messages") {
    const one = namedIn(friends, question);
    if (one.length === 1) {
      // Out loud, the newest; the rest are in Friends.
      const theirs = (await conversation(env, userId, one[0].id)).messages.filter(m => !m.mine && m.text).slice(spoken ? -1 : -3);
      return theirs.length ? `${nameOf(one[0])} wrote: ${theirs.map(m => `"${m.text}" (${ago(m.at)})`).join(", then ")}.`
        : `Nothing from ${nameOf(one[0])} yet.`;
    }
    const waiting = friends.filter(f => f.unread && f.last && !f.last.mine)
      .sort((a, b) => Date.parse(b.last.at) - Date.parse(a.last.at));
    const most = spoken ? 2 : 4, more = waiting.length - most;
    return waiting.length ? waiting.slice(0, most).map(f => `${nameOf(f)} wrote: "${f.last.text}" (${ago(f.last.at)})`).join(". ") + "." +
      (more > 0 ? ` And ${more} more in your Friends.` : "") : "No new messages from your friends.";
  }
  const shown = friends.slice(0, 12).map(f => `${nameOf(f)}${f.online === true ? " (their Willo with them now)" : ""}`);
  return `You have ${friends.length} friend${friends.length === 1 ? "" : "s"}: ${and(shown)}${friends.length > 12 ? " and more" : ""}.`;
}

// Their words after one of her change read-backs: {change: held} for a plain yes in time, {answer} for a no or a yes
// with nothing held, or null.
async function changeReply(env, userId, previous, reply, now) {
  const back = CHANGE_BACK.exec(previous);
  if (!back) return null;
  const held = await taken(env, userId);
  if (NO.test(reply)) return { answer: "Okay, I'll leave it." };
  if (!YES.test(reply)) return null;
  if (!held || held.kind !== KIND_OF[back[1]]) return { answer: "I didn't do that one. Ask me again and I'll check with you first." };
  if (now - Date.parse(held.created) > HOLD_SECONDS * 1000)
    return { answer: "That was a little while ago, so I left it. Ask me again and I'll check with you first." };
  return { change: held };
}

// A change held and said yes to: {answer}.
export async function doChange(env, userId, held, now = Date.now()) {
  if (String(held.kind).startsWith("keeps:")) return keepsChange(env, userId, held, new Date(now));
  if (!(await perMinute(env, userId, "friends-change", CHANGES_PER_MINUTE))) return { answer: "Give me a moment, then ask me again." };
  try {
    switch (held.kind) {
      case "add": {
        const out = await addFriend(env, userId, held.recipient, { allowAsk: () => perDay(env, userId, "friends-ask", ASKS_PER_DAY), now });
        return { answer: out.state === "friends" ? `You and ${held.body} are friends now.` : `Friend request sent to ${held.body}.` };
      }
      case "accept": await answerRequest(env, userId, held.recipient, true, now); return { answer: `You and ${held.body} are friends now.` };
      case "decline": await answerRequest(env, userId, held.recipient, false, now); return { answer: `Turned down ${held.body}'s request.` };
      case "remove": await removeFriend(env, userId, held.recipient); return { answer: `Removed ${held.body} from your friends.` };
      case "block": await blockPlayer(env, userId, held.recipient, now); return { answer: `Blocked ${held.body}.` };
      case "unblock": await unblockPlayer(env, userId, held.recipient); return { answer: `Unblocked ${held.body}.` };
      case "unsend": await unsendMessage(env, userId, held.recipient, now); return { answer: `Took it back. ${held.body} won't see it.` };
      case "share_on": await setSharing(env, userId, true, now); return { answer: "Your friends can see where you are now." };
      case "share_off": await setSharing(env, userId, false, now); return { answer: "Stopped sharing where you are." };
    }
  } catch (e) {
    if (e instanceof FriendError) return { answer: e.message };
    throw e;
  }
  return { answer: "I didn't do that one." };
}
