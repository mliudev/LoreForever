// "Willo, send this to Mike" (LOR-674, Patrick's Coaching 74): a question that asks Willo to send something to a
// friend is answered here, from the question and what came with it, never by the answer model and without using one of
// the player's answers (functions/api/companion/answer.js). What "this" is comes from the prompt Willo's app built
// (lib/forever-knowledge.js promptParts, lib/willo-pins.js spotOf): where they stand, the quest in their log (one: the
// tracked quest, from Live game info), their target, an item they name in [brackets] or "quotes", or what Willo just
// told them. The friend is one of theirs, by the name the Friends tab shows (their character's) or their profile name.
// Her answer says what she'd send, in fixed words, and offers it as an action (send_to_friend, run by Willo's app on a
// tap or a spoken yes, with Undo while the friend hasn't read it: lib/friends.js unsendMessage). A friend who's away
// gets Patrick's line, "Mike is offline. Would you like me to save this for them?" (them: Willo never guesses who
// anyone is). Willo never speaks as the friend: nothing here says what they think or will do.
//
// Only for a Willo that runs the action (SEND_FROM, by its X-LF-Client); any other gets the question answered as before.

import { CARD_KINDS, readCard, ONLINE_MINUTES } from "./friends.js";
import { spotOf } from "./willo-pins.js";
import { clientFrom } from "./willo-help.js";

// The first Willo whose app runs send_to_friend: on the PC and the Mac (companion/lore_companion/actions.py), and the
// iPhone's ("companion/ios-<version>", mobile/, PR #1232).
export const SEND_FROM = [0, 22, 1];
export const IOS_SEND_FROM = [0, 2, 0];
const iosVersion = client => (/^companion\/ios-(\d+)\.(\d+)\.(\d+)/.exec(String(client || "")) || []).slice(1).map(Number);
const atLeast = (v, min) => v.length === 3 && (v[0] - min[0] || v[1] - min[1] || v[2] - min[2]) >= 0;
export const sendsFrom = client => clientFrom(client, SEND_FROM) || atLeast(iosVersion(client), IOS_SEND_FROM);

const NAME = String.raw`(?<name>[\p{L}][\p{L}\p{N}'-]{1,31})`;
// The request starts the question, after a polite lead-in at most: "Why did Thrall share the location with Jaina?" or
// "How do I share this quest with Aelric?" is a question, not a send (the vision session's blind check, 10/18: 16 of 38
// such near-misses were taken as sends before this).
const LEAD = String.raw`^(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|please\s+|go\s+ahead\s+and\s+|(?:i\s+want|i'd\s+like)\s+you\s+to\s+)?`;
// "send this to Mike", "share my location with Mike", "send the quest to Mike", "pass [Lucky Fishing Hat] to Mike".
const TO = new RegExp(LEAD + String.raw`(?:send|share|forward|pass)\s+(?<what>.{1,80}?)\s+(?:to|with)\s+${NAME}(?:,?\s+please)?\s*[.!?]*$`, "iu");
// "send Mike this", "send Mike my location", "show Mike the quest", "send Mike what you just told me".
const NAMED_FIRST = new RegExp(LEAD + String.raw`(?:send|show)\s+${NAME}\s+(?<what>(?:this|that|it|my|the|where|what|your|"|\[).{0,80}?)(?:,?\s+please)?\s*[.!?]*$`, "iu");
// Words that aren't a friend's name.
const NOT_A_NAME = new Set(["me", "myself", "you", "yourself", "him", "her", "them", "us", "everyone", "everybody",
  "someone", "anyone", "all", "friends", "my", "the", "a", "an", "it", "this", "that", "willo", "willow", "chat",
  "here", "there", "back", "over", "out", "up", "home"]);
// What can be sent: "this", "my location", "the quest", "my target", "what you just told me", a [bracketed] or
// "quoted" name.
const THING = /^(?:this|that|it|these|those|here|where i am|where i'm standing|what you (?:just )?(?:said|told me|wrote)|your (?:answer|story)|(?:this|that|the|my|our)\s+[\p{L}' -]{2,40}|(?:(?:this|that|the|my)\s+)?(?:quest|item)\s+(?:\[[^\]]{2,80}\]|"[^"]{2,80}")|\[[^\]]{2,80}\]|"[^"]{2,80}")$/iu;

const KINDS = [
  ["lore", /\b(?:what you (?:just )?(?:said|told me|wrote)|your (?:answer|story)|story|lore|entry|tale|history)\b/i],
  ["place", /\b(?:where i am|where i'm standing|here|location|spot|position|place|area|zone|map)\b/i],
  ["quest", /\bquests?\b/i],
  ["character", /\b(?:target|npc|character|creature|mob|guy|boss)\b/i],
  ["item", /\b(?:item|gear|weapon|armou?r|loot|drop)\b|^\[/i],
];

// The question as a send: {name, what, kind ("place" | "quest" | "character" | "item" | "lore" | "this")}, or null.
export function sendIntent(question) {
  const q = String(question || "").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/^\s*(?:hey\s+)?willow?[,!]?\s*/i, "")
    .trim();
  if (!q || q.length > 200) return null;
  const m = TO.exec(q) || NAMED_FIRST.exec(q);
  if (!m) return null;
  const name = m.groups.name, what = m.groups.what.trim().replace(/^(?:please\s+)/i, "");
  if (NOT_A_NAME.has(name.toLowerCase()) || !THING.test(what)) return null;
  // Something it knows how to send, or a bare "this": "send my regards to Thrall" is no send.
  const kind = KINDS.find(([, re]) => re.test(what))?.[0] || (/^(?:this|that|it|these|those|\[.+\]|".+")$/i.test(what)
    || CAPITALIZED.test(what) ? "this" : null);
  return kind ? { name, what, kind } : null;
}

// A thing named in [brackets] or "quotes", or out loud by its name ("send the Lucky Fishing Hat to Mike": capitalized,
// since brackets can't be said): an item, or a quest of theirs by its title.
const CAPITALIZED = /^(?:the|my)\s+(\p{Lu}[\p{L}'-]*(?:\s+(?:of|the|\p{Lu}[\p{L}'-]*))*)$/u;
const named = what => /\[([^\]]{2,80})\]|"([^"]{2,80})"/.exec(what)?.slice(1).find(Boolean)?.trim() || CAPITALIZED.exec(what)?.[1] || "";
const sentence = (text, max) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max), end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (end > max / 2 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…").trim();
};

// What the send is, from the prompt: {card (lib/friends.js readCard's), phrase (how Willo says it: "the quest
// "The Defias Brotherhood"")}, or {missing: what she'd need} when there's nothing to send.
export function thingToSend(intent, parts, prompt) {
  const kind = intent.kind;
  const place = () => {
    const spot = spotOf(prompt);
    if (spot) return { card: { kind: "place", title: spot.place,
      ...(spot.x != null && spot.y != null ? { detail: `On the map at ${spot.x}, ${spot.y}`, ref: `${spot.x},${spot.y}` } : {}) },
      phrase: `where you are, ${spot.place}` };
    const title = [parts.sub, parts.zone].filter((v, i, a) => v && a.indexOf(v) === i).join(", ");
    return title ? { card: { kind: "place", title }, phrase: `where you are, ${title}` } : { missing: "place" };
  };
  const quest = () => {
    const quests = parts.quests || [], asked = named(intent.what).toLowerCase(), q = String(parts.question || "").toLowerCase();
    const pick = quests.find(x => asked && x.title.toLowerCase().replace(/^the\s+/, "") === asked.replace(/^the\s+/, ""))
      || quests.find(x => x.title.length > 3 && q.includes(x.title.toLowerCase())) || (quests.length === 1 ? quests[0] : null);
    if (!pick) return { missing: quests.length ? "which quest" : "quest" };
    return { card: { kind: "quest", title: pick.title, ...(pick.id ? { ref: String(pick.id) } : {}) },
             phrase: `the quest "${pick.title}"` };
  };
  const target = () => {
    const t = String(parts.target || "").trim();
    // "a friendly character", "a hostile creature": someone the lore doesn't know, with no name to send.
    if (!t || /^an? (?:friendly|hostile|neutral)\b/i.test(t)) return { missing: "target" };
    return { card: { kind: "character", title: t, ...(parts.zone ? { detail: `Seen in ${[parts.sub, parts.zone].filter(Boolean).join(", ")}` } : {}) },
             phrase: `your target, ${t}` };
  };
  const item = () => {
    const title = named(intent.what);
    return title ? { card: { kind: "item", title }, phrase: title } : { missing: "item" };
  };
  const lore = () => {
    const said = sentence(parts.previous, 600);
    if (!said) return { missing: "lore" };
    const asked = sentence(String(parts.previousQuestion || "").replace(/^\s*(?:hey\s+)?willow?[,!]?\s*/i, ""), 120);
    return { card: { kind: "lore", title: asked || "What Willo told me", detail: said }, phrase: "what I just told you" };
  };
  const by = { place, quest, character: target, item, lore };
  if (kind !== "this") return by[kind]();
  // "Send this to Mike": a [bracketed] or "quoted" name is an item, or their quest by that title; else what she just
  // told them, their target, where they are, in that order.
  if (named(intent.what)) {
    const q = quest(), bare = t => String(t || "").toLowerCase().replace(/^the\s+/, "");
    return q.card && bare(named(intent.what)) === bare(q.card.title) ? q : item();
  }
  for (const f of [lore, target, place]) {
    const out = f();
    if (out.card) return out;
  }
  return { missing: "anything" };
}

// The player's friends whose name (their character's, as the Friends tab shows it) or profile name is `name`, with
// whether each is online (lib/friends.js: their Willo was in touch lately; null when they don't show it). One query.
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
  return found.map(r => ({ id: r.pid, name: r.name || r.handle || name, online: r.hide_online ? null : Boolean(r.online) }));
}

// What Willo says when there's nothing to send, by what's missing.
const MISSING = {
  place: () => "I can't tell where you are right now, so there's no place to send yet.",
  quest: () => "I don't see a quest in your log to send.",
  "which quest": () => "Which quest should I send? Say its name.",
  target: () => "You don't have anyone targeted that I know by name.",
  item: name => `Which item? Say its name, like "send the Lucky Fishing Hat to ${name}".`,
  lore: name => `Ask me about something first, and then I can send it to ${name}.`,
  anything: name => `What should I send ${name}? Where you are, your quest, your target, or what I just told you.`,
};

// The whole answer to a send: {answer, action ({id: "send_to_friend", args, label}) when there's one to offer}.
export async function sendOffer(env, userId, intent, parts, prompt, now = Date.now()) {
  const friends = await friendsNamed(env, userId, intent.name, now);
  if (!friends.length) return { answer: `I don't see ${intent.name} among your friends yet. Once you're friends, I can send it.` };
  if (friends.length > 1) {
    const list = friends.slice(0, 4).map(f => f.name);
    return { answer: `You have more than one friend called ${intent.name}: ${list.slice(0, -1).join(", ")} and ` +
      `${list.at(-1)}. Which one?` };
  }
  const friend = friends[0];
  const thing = thingToSend(intent, parts, prompt);
  if (!thing.card) return { answer: MISSING[thing.missing](friend.name) };
  const card = readCard(thing.card);
  if (!card || !Object.hasOwn(CARD_KINDS, card.kind)) return { answer: MISSING.anything(friend.name) };
  const away = friend.online === false;
  const answer = away ? `${friend.name} is offline. Would you like me to save this for them? It's ${thing.phrase}.`
    : friend.online ? `${friend.name}'s Willo is awake. Want me to send them ${thing.phrase}?`
    : `Want me to send ${friend.name} ${thing.phrase}?`;
  return { answer, action: { id: "send_to_friend", args: { to: friend.id, name: String(friend.name).slice(0, 40), ...card },
           label: (away ? `Save it for ${friend.name}` : `Send to ${friend.name}`).slice(0, 60) } };
}
