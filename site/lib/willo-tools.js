// Willo's tools (LOR-546, Mike's pick A, 2026-10-15): what she can look up for an answer and, from the next slices on,
// what she can do for the player. The site picks the look-ups for each question (lookupsFor), never the answer model:
// left to choose, Flash-Lite looked online 1 time in 24 (10/12), so our code chooses and one quick answer is written
// from what they found. Actions (ACTIONS, slice 2) are offered by that answer and run by Willo's app on a tap, changes
// always with Undo, and nothing ever acts inside WoW. One neutral list, so any answer model can be given these (the
// provider swap).
//
// side: where a look-up runs. "willo": Willo's app on the player's PC, which sends what it found with the question (in
// the prompt's sections, companion/lore_companion/answer.py); "site": here, while the answer is written.
import { realWorld } from "./research-cache.js";
import { helpTopics, helpQuestion, clientFrom, keepsAsked } from "./willo-help.js";
import { voiceLabel, voicePhrase } from "./character-voices.js";
import { PROFESSIONS, STANDINGS } from "./willo-goals.js";
import CONTRACT from "./willo-actions.js";
import { wordsOf, near, heardWords, heardIn } from "./heard.js";

export { CONTRACT };

export const LOOKUPS = {
  lore: { side: "willo", what: "the add-on's lore library for the question, the place and the target (SOURCES)" },
  journey: { side: "willo", what: "their saved journey: quests done, places seen, battles (THEIR JOURNEY)" },
  quest_log: { side: "willo", what: "the quests in their log, and the tracked quest with Live game info (PLAYER CONTEXT)" },
  character: { side: "willo", what: "race, class, level, faction, professions and quest items (PLAYER CONTEXT)" },
  pc: { side: "willo", what: "graphics card, processor and memory, for a question about their computer (pc.py)" },
  state: { side: "willo", what: "Willo's own state: the Willo and the game checks, talking, seeing the game, her voice" },
  friends: { side: "willo", what: "where the friends a question names were last seen, if they share it (FRIENDS, lib/friends.js)" },
  notebook: { side: "site", what: "their notebook: all of it asked about or written in, else lines sharing a word (lib/willo-notebook.js)" },
  forever_facts: { side: "site", what: "checked WoW Forever facts and quests (lib/forever-knowledge.js)" },
  web: { side: "site", what: "a quick look online for the player's own world (lib/companion-answers.js lookUp)" },
  help: { side: "site", what: "Willo's own help (lib/willo-help.js)" },
  answers_left: { side: "site", what: "their plan and the answers it has left (lib/companion-answers.js allowance)" },
  sight: { side: "willo", what: "a picture of the game with a question asked out loud, or a typed one that needs it (talk/sight.py); logged, not asked for" },
};

// The site's look-ups for one of Willo's own answers. A question about her gets her help, her state and, about
// plans, the answers left, and never a look online; one about the player's own world (lib/research-cache.js realWorld)
// gets the web, where their plan looks online (functions/api/companion/answer.js). previous: the question before, for
// a short follow-up. A character's reply and chat memory get none.
export function lookupsFor(question, { previous = "", answered = "", persona = "willo", operation = "answer", plans = false } = {}) {
  if (operation !== "answer") return [];
  const topics = persona === "willo" ? helpTopics(helpQuestion(question, previous, answered), { plans }) : [];
  // A short follow-up that names nothing of hers ("Is there any way to change that?") is about what came before: the
  // game's own interface there looks online rather than taking her help from her last answer (LOR-652: it got a
  // made-up Combat setting, then a second one).
  const own = topics.length && helpTopics(question, { plans }).length;
  if (topics.length && (own || !realWorld(question, previous, answered)))
    return ["help", "state", ...(topics.includes("plans") ? ["answers_left"] : [])];
  return realWorld(question, previous, answered) ? ["web"] : [];
}

// Actions (LOR-546 slice 2): what one of Willo's answers may offer to do, at most one, from this fixed list. The site
// offers the answer model the ones a question about her touches (actionsFor, by her help topics) and never runs any:
// the one it picks comes back beside the answer as {id, args, label} (actionOf), and Willo's app shows it as a button
// and runs it (companion/lore_companion/actions.py). All inside Willo, never in WoW (Blizzard's add-on rules: no
// input, no automation). confirm: the action's tier in willo-actions.json ("show" opens or shows something and changes
// nothing; "send" fills in a note the player sends themselves; "undo" is a reversible change, run on a tap or a spoken
// "yes", always with Undo). Money is a tap in her window only: open_plans and open_billing open the page and never buy,
// and are never offered out loud or shown over the game (the wisp never sells). "consent" (slice 3: Live game info,
// seeing the game): a tap shows the same explanation her Settings card gives, and only a click on its Turn on turns it
// on, never a spoken yes; Undo turns it off. topics: the help topics (lib/willo-help.js) a question has to touch for it.
export const ACTIONS = {
  open_settings: { side: "willo", topics: ["problems", "talk", "voice", "wisp", "sight", "live", "color", "settings"],
    what: "opens a card in her Settings (SECTIONS)" },
  open_plans: { side: "willo", topics: ["plans", "voice"],
    what: "opens the Plans page in the browser, signed in (/api/account/open); never buys" },
  open_billing: { side: "willo", topics: ["plans"],
    what: "opens Billing in the browser, signed in (/api/account/open)" },
  // What Willo keeps (LOR-666, lib/willo-keeps.js): only from the app that has it (KEEPS_FROM), in her window.
  open_keeps: { side: "willo", topics: ["privacy"],
    what: "opens What Willo keeps in the browser, signed in (/api/account/open): everything she keeps, to change or erase" },
  // Offered only by the fixed screenshot answer (lib/friend-send.js), never to the model. This prepares a preview;
  // the desktop asks for Send only after capture succeeds and the actual image is visible.
  capture_game_to_friend: { side: "willo", topics: [],
    what: "prepares a local game screenshot for a named friend (or, with no one named, takes and holds it until a name); the player reviews it and chooses Send before upload" },
  // Offered by messageFriendTool, never by actionsFor, and done on the site (lib/friend-send.js messageCall): her
  // read-back, then their yes. Nothing goes to Willo's app.
  message_friend: { side: "site", topics: [],
    what: "sends one of their friends a message in their words, read back first; only their yes sends it" },
  send_feedback: { side: "willo", topics: ["problems"],
    what: `fills in "Something's wrong" with a note; the player presses Send` },
  set_voice: { side: "willo", topics: ["voice"],
    what: "switches her voice to one the player's plan has (/api/talk/settings hosted_voice)" },
  new_chat: { side: "willo", topics: ["chat"],
    what: "starts a new chat; the old one stays in the list, and Undo reopens it" },
  set_talk_key: { side: "willo", topics: ["talk"],
    what: "sets her talk key to one she can hear (talk/ptt.py KEYS); then /reload in the game" },
  live_game_info: { side: "willo", topics: ["live"],
    what: "Live game info, turned on by the player's click under its explanation (Settings › Live game info's words)" },
  see_the_game: { side: "willo", topics: ["sight"],
    what: "seeing the game when they ask (Hero and up), turned on by the player's click under its explanation" },
};
// How each is confirmed is its tier in the one list of her actions (willo-actions.json, LOR-844 step 6), which the PC
// reads too, so the two never disagree.
for (const [id, a] of Object.entries(ACTIONS)) {
  const { tier, undo = CONTRACT.tiers[tier].undo } = CONTRACT.tools[id];
  Object.assign(a, { confirm: tier, undo, ...(tier === "money" ? { money: true } : {}) });
}
// The Settings cards open_settings opens, by the help topic that asks for it, with its button's words. from: only for a
// companion that has it (companion/lore_companion/actions.py SECTIONS), by its X-LF-Client: 0.21.0 has her color's card
// but drops a button to it, so color and settings from the release after it.
const SECTIONS_FROM = [0, 21, 1];
// open_keeps: the release after 0.21.0 has it (companion/lore_companion/actions.py PAGES).
const KEEPS_FROM = [0, 21, 1];
export const SECTIONS = {
  health: { topic: "problems", label: "Show what's working" },
  talk: { topic: "talk", label: "Show the talk key" },
  voice: { topic: "voice", label: "Show my voices" },
  wisp: { topic: "wisp", label: "Show my settings over the game" },
  sight: { topic: "sight", label: "Show Seeing the game" },
  // Offered when her own switch is on already (off: the consent offer; unticked in the add-on: "health"), so what helps
  // is the card's step in the game (the add-on's own switch, Mike's QA 10/15).
  live: { topic: "live", label: "How to turn it on in the game" },
  // Her color's card, and her Settings for a question about them (Mike, 10/17: "I was expecting one of those chips to
  // open settings").
  color: { topic: "color", label: "Show my colors", from: SECTIONS_FROM },
  settings: { topic: "settings", label: "Open my Settings", from: SECTIONS_FROM },
};
// The keys Willo hears (companion/lore_companion/talk/ptt.py KEYS), with their names as gamelink.short says them.
export const TALK_KEYS = Object.fromEntries([
  ...Array.from({ length: 20 }, (_, i) => [`f${i + 5}`, `F${i + 5}`]),
  ["mouse5", "Mouse button 5"], ["mouse4", "Mouse button 4"], ["mouse3", "Middle mouse button"],
  ["right_ctrl", "Right Ctrl"], ["right_alt", "Right Alt"], ["grave", "`"], ["caps_lock", "Caps Lock"],
  ["scroll_lock", "Scroll Lock"], ["pause", "Pause"], ["insert", "Insert"], ["home", "Home"], ["page_up", "Page Up"],
  ["page_down", "Page Down"]]);
const titled = id => id.charAt(0).toUpperCase() + id.slice(1);
// A voice as players read it: "Moonwell", or a voice of Azeroth's ("Dwarf, man"; in a sentence "a dwarf man's voice").
const voiceName = id => voiceLabel(id) || titled(id);
// Which voice "switch back" means, named in set_voice's words: the model, told only the state's "voice before" line,
// picked another voice 6 times in 9 (the lab, 10/27).
const backTo = (before, picks) => before && picks.includes(before)
  ? ` "Switch back", "the other one", "your old voice" or "how it was" is ${before} (${voiceName(before)}), the voice before this one.` : "";
const voiceSaid = id => voicePhrase(id) || titled(id);

// What the answer is told when it's offered actions: a few lines, so the answer costs about the same.
export const ACTION_RULES = "WILLO ACTIONS: besides answering, you can do the things in the functions you're given, " +
  "in your app. When the player asks for one of them, or one fixes their problem, you must call it (one at most) as " +
  "well as writing your answer. Calling it only offers it: they see a button, and nothing happens until they tap it " +
  "or say yes. So never say you've done it; end your answer by offering it in a few words (\"Want me to switch to " +
  "Moonwell?\"). Never offer anything in the game itself.";
// With the PC's own tools (toolDeclaration, LOR-844 step 6): the lab's gate (eval/willo/actions.mjs) found her
// changing her own talk key for "change my frostbolt keybind to F9", and opening her Settings for the game's sounds.
export const OWN_TOOLS_RULE = "Your app's tools change only your own things: how you talk and listen, your voice, " +
  "your keys, your remarks, your look, your Settings. The game's own keybinds, sounds, music, options, windows and " +
  "actions are never yours to change or open: answer those in words, with no call.";
// What she can change for them right now, from the tools this answer offers (LOR-856 A2): "I can't change my own
// color, I'm a blue wisp" and "I can't erase your notes from there" both came with the tool offered (Mike's QA, 10/27).
// A grouped tool by the operations it offers; with WILLO STATE's color and voice, so she knows how she is now.
const CAN_DO = {
  "look:color": "change your color (any swatch, or a color of their own)", "look:wisp_show": "show or hide your wisp",
  "look:size": "make your wisp bigger or smaller", "talk:voice": "switch your voice", set_voice: "switch your voice",
  "talk:off": "turn talking with you on or off", "talk:key": "move your talk key", set_talk_key: "move your talk key",
  "talk:engine": "speak in your full voice, the computer's voice or in words only", "remarks:level": "chime in more or less often",
  "remarks:chirps_off": "turn your chirps on or off", "chats:list": "find, open, rename and delete their past chats",
  new_chat: "start a new chat", "settings:open": "show any card of your Settings", open_settings: "show any card of your Settings",
  "player:play": "play, pause and skip the Lore Player", "memory:remember": "remember things about them, and forget any or all of it",
  notebook: "write, tick off, change, move and remove lines in their notebook, and set reminders",
  notebook_add: "write lines in their notebook", notebook_check: "tick lines off in their notebook",
  notebook_remove: "take lines out of their notebook", notebook_remind: "set reminders", goal: "set, change and drop their goals",
  goal_set: "set and change their goals", pin: "pin where they stand on their map", notebook_pin: "pin where they stand on their map",
  keeps: "erase what you keep of them (one kind, or everything, read back first) and stop keeping their questions",
  set_style: "change how you talk", message_friend: "send one of their friends a message", friends_change: "add, remove and block friends",
};
export function canDoLine(offered, state = "") {
  const keys = (offered || []).flatMap(d => [d.name, ...(d.parameters?.properties?.op?.enum || []).map(op => `${d.name}:${op}`)]);
  const can = [...new Set(keys.map(k => CAN_DO[k]).filter(Boolean))];
  const color = /\bcolor: ([#\w]+)/.exec(String(state || ""))?.[1];
  const voice = /^voice now: ([^(\n]+)/m.exec(String(state || ""))?.[1]?.trim();
  const now = [color && `your color is ${color.startsWith("#") ? `a color of their own (${color})` : CONTRACT.lists.colors[color] || color}`,
    voice && `you speak as ${voice}`].filter(Boolean);
  return [can.length && `WHAT YOU CAN DO FOR THEM NOW, with your tools: ${can.join("; ")}. Asked whether you can, say yes.`,
    now.length && `HOW YOU ARE NOW: ${now.join(", and ")}.`].filter(Boolean).join("\n");
}
// Asked out loud: the wisp never sells.
export const SPOKEN_ACTION_RULE = "Out loud, never name a plan or a price.";

// A question that asks for another voice of hers: switching it, a voice of their choosing, someone she could sound like.
// A voice only talked about ("just testing your various voices") offers her voices' card instead, never a switch: Mike,
// 10/17, out loud, got "Switch to Starling" for that, beside her words offering a dwarf or a night elf.
export const WANTS_VOICE = /\b(?:switch|change|swap|use|pick|choose|set)\b[^.?!]*\bvoices?\b|\bvoices?\b[^.?!]*\b(?:switch|change|swap|instead)\b|\b(?:different|another|other|new|deeper|lower|higher|softer|calmer|male|female|man's|woman's)\b[^.?!]*\bvoices?\b|\b(?:sound|speak|talk) (?:like|as) (?:an? )?\w+|\bswitch to\b/i;
// That, or one of her voices by name ("use Moonwell"). asked null: any question (a caller without one).
const wantsVoice = (asked, picks) => {
  if (asked === null) return true;
  const q = String(asked).replace(/’/g, "'");
  return WANTS_VOICE.test(q) || picks.some(v => !voiceLabel(v) && new RegExp(`\\b${v}\\b`, "i").test(q));
};

// The free key Willo's own check found for her talk key (WILLO STATE's talk line: "fix: the Use F9 button in Settings ›
// Willo and the game", companion/lore_companion/gamelink.py), as its TALK_KEYS id, or "".
export function freeKey(state) {
  const label = /^talk: \w+, .*?\bthe Use (.+?) button\b/m.exec(String(state || ""))?.[1];
  return Object.keys(TALK_KEYS).find(id => TALK_KEYS[id] === label) || "";
}

// The actions offered for one of Willo's answers, as provider-neutral declarations ({name, description, parameters}:
// JSON Schema), for the answer model's adapter (lib/companion-answers.js maps them to Gemini's functionDeclarations).
// topics: helpTopics of the question; voices: the voices the player's plan picks from (lib/companion-voice.js
// picksFor when the plan has choice), never the one she speaks in now (current); key: a talk key the game doesn't use
// (freeKey), the only one set_talk_key offers, so she never moves it onto a key the game has; liveOff: her own check
// says Live game info doesn't work (WILLO STATE's live line, bad or warn), so its card gives way to "Willo and the
// game", which says which side is off and how to fix the game's (with "Live game info", Flash-Lite blamed her own
// switch about half the time, 10/15); fixable: her checks name a fix for something off (then no "Something's wrong":
// Flash-Lite offered it instead of the fix); off: what she says is off in her own window (WILLO STATE: {live, sight}),
// the only time she offers to turn it on; sight: the plan lets her see the game (Hero and up while plans are sold);
// spoken: asked out loud, so nothing about money; plans: the site sells plans; client: the companion's X-LF-Client, for
// the sections only some have (SECTIONS from; null: all); asked: the question, for set_voice only when it asks for
// another voice (WANTS_VOICE; null: any); before: the voice she spoke in before this one (WILLO STATE's "voice before").
export function actionsFor(topics, { voices = [], current = "", before = "", key = "", liveOff = false, fixable = false,
  off = {}, sight = true, spoken = false, plans = false, client = null, asked = null } = {}) {
  const on = new Set(topics || []);
  const has = id => ACTIONS[id].topics.some(t => on.has(t)) && !(ACTIONS[id].money && (spoken || !plans));
  const picks = voices.filter(v => v !== String(current).toLowerCase());
  const keyed = has("set_talk_key") && Object.hasOwn(TALK_KEYS, key);
  // Consent, only for what's off in her window: Live game info for where they are or who they target, seeing the game
  // for a picture of their screen; each instead of its Settings card (the same card is where its explanation shows).
  const live = has("live_game_info") && off.live === true && on.has("live");
  const see = has("see_the_game") && off.sight === true && sight && on.has("sight") && !live;
  // The talk key's card only when she can't set a free key herself; with Live game info off, only "Willo and the game"
  // for the live topic (and not Seeing the game, which a question about her target touches too).
  const offLive = liveOff && on.has("live");
  const sections = Object.keys(SECTIONS).filter(s => !(SECTIONS[s].from && client !== null && !clientFrom(client, SECTIONS[s].from))
    && !(s === "talk" && keyed) && !(s === "live" && live)
    && !(s === "sight" && (see || live)) && (offLive && (s === "live" || s === "sight")
    ? false : on.has(SECTIONS[s].topic) || (s === "health" && offLive)));
  const out = [];
  if (live) out.push({ name: "live_game_info",
    description: "Live game info is off in your window: with it on you'd know where they are and who they target. " +
      "This shows them how it works, and they turn it on themselves." });
  if (see) out.push({ name: "see_the_game",
    description: "Seeing the game is off in your window: with it on you'd see their game when they ask. " +
      "This shows them how it works, and they turn it on themselves." });
  if (has("set_voice") && picks.length && wantsVoice(asked, picks)) out.push({ name: "set_voice",
    description: "Switch your voice to another of the voices their plan has" + (picks.some(v => voiceLabel(v))
      ? ": your own, or one you borrow from Azeroth's peoples, by people and gender (dwarf-male)." : ".") + backTo(before, picks),
    parameters: { type: "object", properties: { voice: { type: "string", enum: picks } }, required: ["voice"] } });
  if (keyed) out.push({ name: "set_talk_key",
    description: `Move your talk key to ${TALK_KEYS[key]}, which the game doesn't use.`,
    parameters: { type: "object", properties: { key: { type: "string", enum: [key] } }, required: ["key"] } });
  // Not for a question about what she keeps: a new chat erases nothing (open_keeps is its offer, keepsOffer).
  if (has("new_chat") && !on.has("privacy")) out.push({ name: "new_chat",
    description: "Start a new chat once they tap it; this one stays in their list, and nothing is deleted." });
  // "Something's wrong" only when her own checks know no fix: with one, that fix is the answer.
  if (has("send_feedback") && !fixable) out.push({ name: "send_feedback",
    description: "Only for something about you that's broken when nothing in your help fixes it: fill in a note to the " +
      "people who make you, which they read and send.",
    parameters: { type: "object", properties: { note: { type: "string", description: "What's wrong, in one short " +
      "sentence in the player's words." } }, required: ["note"] } });
  if (sections.length) out.push({ name: "open_settings",
    description: "Show the card in your own window's Settings: what's working, your own switches, your color. It can't change " +
      "anything in the game or its add-on, so a fix there is still theirs to do in the game.",
    parameters: { type: "object", properties: { section: { type: "string", enum: sections } }, required: ["section"] } });
  // Plans for a voice only when the plan has no other voice to switch to.
  if (has("open_plans") && (on.has("plans") || !voices.length)) out.push({ name: "open_plans",
    description: "Open the Plans page (what each plan adds, with prices) in their browser, from your window. " +
      "It never buys anything." });
  if (has("open_billing")) out.push({ name: "open_billing",
    description: "Open their billing (payments, receipts, cancelling) in their browser." });
  if (has("open_keeps") && keepsAsked(asked) && !spoken && (client === null || clientFrom(client, KEEPS_FROM))) out.push({ name: "open_keeps",
    description: "Open What Willo keeps in their browser: everything you keep about them, where they can change or " +
      "erase any of it." });
  return out;
}

// A question that might ask her to message a friend (LOR-844 step 1): a loose cue, so message_friend is offered only
// on those turns until tools ride on every answer (offering one turns her streamed voice off for that turn), and never
// on "tell me about…", the commonest thing she's asked.
const NOT_SOMEONE = String.raw`(?!(?:me|us|you|yourself|about|the|a|an|how|what|why|who|where|when|if|whether)\b)`;
const MESSAGE_CUE = new RegExp(String.raw`\b(?:tell|message|text|msg|dm|ping|ask)\s+${NOT_SOMEONE}\S|` +
  String.raw`\b(?:send|write|shoot)\b[^.?!]{0,40}\b(?:message|note|text|msg|line)\b|\bsend\s+the\s+same\b|` +
  String.raw`\blet\s+${NOT_SOMEONE}\S+(?:\s+\S+){0,2}\s+know\b|\bdrop\b[^.?!]{1,30}\bline\b`, "i");
export const messageCue = question => MESSAGE_CUE.test(String(question || "").replace(/[’‘]/g, "'"));

// The tool, with their friends as its data (id = what she calls them), at most `most` of them (within
// ACTIONS_MAX_BYTES beside the friends tools).
export function messageFriendTool(friends, most = 25) {
  const some = friends.slice(0, most);
  return {
    name: "message_friend",
    description: "Only when they ask you to send one of their friends a message: offer it (they hear it read back and " +
      "say yes before it goes). text: their own words as the friend should read them, tidied at most (\"tell Mira " +
      "she's great\" is \"You're great\"), never added to; no words yet (\"send a message to my friend\"): friend_id " +
      "alone, and they're asked what to say. Never for a question about a friend, someone in the game " +
      "or a story. Their friends: " + some.map(f => `${f.id} = ${f.name || "a friend with no name yet"}`).join("; ") + ".",
    parameters: { type: "object", properties: {
      friend_id: { type: "string", enum: some.map(f => f.id) },
      text: { type: "string", description: "The message, in their words." } }, required: ["friend_id"] },
  };
}

// A question about their Friends (LOR-844 step 6): who's there or on, messages, requests, their code, or a change to
// any of it. A loose cue, as messageCue's.
const FRIENDS_CUE = new RegExp([String.raw`\bfriends?\b`, String.raw`\bunfriend\b`, String.raw`\b(?:un)?block\b`,
  String.raw`\bunsend\b`, String.raw`\btake\s+(?:(?:that|it|my)\s+)?(?:last\s+)?(?:message\s+)?back\b`, String.raw`\bmy\s+code\b`,
  String.raw`\bshar(?:e|ing)\s+where\b`, String.raw`\bstop\s+sharing\b`, String.raw`\b(?:who(?:'s|\s+is)|any(?:one|body))\s+online\b`,
  String.raw`\b(?:new|any|my|read\s+(?:me\s+)?(?:my\s+)?)\s*messages?\b`, String.raw`\b(?:accept|decline)\b[^.?!]{0,30}\brequests?\b`,
  String.raw`\badd\s+@`].join("|"), "i");
export const friendsCue = question => FRIENDS_CUE.test(String(question || "").replace(/[’‘]/g, "'"));

// The two Friends tools (lib/friend-send.js friendsCall checks and does them): what's there, said from what's there,
// and a change, read back and done on a yes. Neither carries their friends: whom a change means is found from their words.
export const friendsLookTool = () => ({
  name: "friends_look",
  description: "Look in their Friends when they ask: who their friends are (friends), who's in the world now (online), " +
    "new messages or a friend's messages (messages), friend requests (requests), their own friend code (code).",
  parameters: { type: "object", properties: { what: { type: "string", enum: ["friends", "online", "messages", "requests", "code"] } },
    required: ["what"] },
});
export const friendsChangeTool = () => ({
  name: "friends_change",
  description: "Only when they ask you to change their Friends: send a friend request (add, who: the name or code they " +
    "said), accept or decline a request, remove, block or unblock someone, take back their last message (unsend), " +
    "share where they are or stop (share_on, share_off). It only offers it: they hear it back and say yes first. " +
    "Never for a question about how to do it, or about anyone in the game.",
  parameters: { type: "object", properties: {
    change: { type: "string", enum: ["add", "accept", "decline", "remove", "block", "unblock", "unsend", "share_on", "share_off"] },
    who: { type: "string", description: "For add: the name or code they said." } }, required: ["change"] },
});

// A question about what she keeps always ends with the page's button (LOR-666's blind check: Flash-Lite answered "what
// do you know about me?" from the player's context and never offered it, and offered a new chat for "forget
// everything"): open_keeps, whenever it was offered, whatever the model called.
export function keepsOffer(offered) {
  return (offered || []).some(d => d.name === "open_keeps") ? { id: "open_keeps", args: {}, label: "Open What Willo keeps" } : null;
}

// What an app can run (LOR-844 step 6, willo-actions.json "about"): its X-LF-Capabilities, space- or comma-separated.
// Without actions/1 (a PC from before the list): only the legacy tools, as before, and nothing grouped.
const tokensOf = capabilities => new Set(String(capabilities || "").split(/[,\s]+/).filter(Boolean));
export const listsActions = capabilities => tokensOf(capabilities).has("actions/1");

// Whether the asking app can run tool `id` (with `op` for a grouped one: "talk", "off").
export function canRun(capabilities, id, op = null) {
  const tool = Object.hasOwn(CONTRACT.tools, id) ? CONTRACT.tools[id] : null;
  if (!tool || Boolean(tool.ops) !== Boolean(op) || (op && !Object.hasOwn(tool.ops, op))) return false;
  const tokens = tokensOf(capabilities);
  if (!tokens.has("actions/1")) return Boolean(tool.legacy);
  return tokens.has(op ? `${id}.${op}` : id);
}

// The operations of grouped tool `id` the asking app runs, in the list's order.
export const opsFor = (capabilities, id) => Object.keys(CONTRACT.tools[id]?.ops || {}).filter(op => canRun(capabilities, id, op));

// A list an argument picks from: the contract's own, the talk keys, or one the asking app's state gives (lists: voices,
// chats), as [value, words for it] pairs.
function choices(arg, lists = {}) {
  if (arg.list === "talk_keys") return Object.entries(TALK_KEYS).filter(([k]) => !lists.keys || lists.keys.includes(k));
  if (arg.list === "voices") return (lists.voices || []).map(v => [v, voiceName(v)]);
  if (arg.list === "chats") return (lists.chats || []).map(t => [t, t]);
  if (arg.list === "sections") return Object.entries(CONTRACT.lists.sections).map(([s, c]) => [s, c.label]);
  if (arg.list === "colors") return Object.entries(CONTRACT.lists.colors);
  const list = CONTRACT.lists[arg.list] || [];
  return (Array.isArray(list) ? list : Object.keys(list)).map(v => [v, v.replace(/_/g, " ")]);
}

// The moments an operation may need (willo-actions.json "needs"), from the asking app's WILLO STATE lines
// (companion/lore_companion/core.py willo_state).
export function momentsOf(state) {
  const s = String(state || "");
  return { reminder_showing: /^reminder showing now: /m.test(s), update_ready: /^version: [^,\n]+, \S+ ready to restart into/m.test(s),
    player: /^lore player: (?:playing|paused)\b/m.test(s) };
}

// The offer her last spoken answer made, still waiting for their yes, from the asking app's WILLO STATE ("your offer
// just now: Switch to Moonwell (set_voice)", companion/lore_companion/core.py): {label, id}, or null. LOR-844 step 5:
// a reply that isn't a plain yes or no (the PC's own match) is hers to read.
export function offerOf(state) {
  const line = /^your offer just now: (.+?)(?: \(([\w.]+)\))?$/m.exec(String(state || ""));
  return line ? { label: line[1].trim().slice(0, 80), id: line[2] || "" } : null;
}
export const OFFER_REPLY = "offer_reply";
export const OFFER_YES = "On it.", OFFER_NO = "All right, it stays as it is.";
// Whether a yes she read is a yes to the offer: past its yes-words, nothing but the offer's own words (its label, her
// line that made it) and the few a yes is said with. "Yes, I killed Hogger" and "yes, I finished the Defias quest"
// came back as yes 3 of 4 however her tool was worded (the step 5 lab, 10/26); "yeah F7 works for me" stays one.
const YES_WORDS = /^(?:[\s,.!]*(?:oh|well|um+|hey|ok(?:ay)?|willow?|yes|yeah|yep|yup|ya|sure|please|absolutely|definitely|of course|why not|go on|go ahead|do it|let'?s|then|that'?d|that would|would|sounds?|great|lovely|perfect|fine|alright|all right|cool|nice|good)\b)*/i;
const WITH_YES = new Set(("works work for me be it that this one them her him hear try sounds sound great good fine lovely " +
  "nice perfect cool please thanks thank you then now go ahead sure yes yeah absolutely definitely course all right " +
  "alright okay love like would that'd").split(" "));
export function fitsOffer(question, offer, said = "") {
  const rest = String(question || "").replace(/’/g, "'").replace(YES_WORDS, "");
  const own = new Set(`${offer?.label || ""} ${said}`.toLowerCase().match(/[\p{L}\d']+/gu) || []);
  return (rest.toLowerCase().match(/[\p{L}\d']+/gu) || []).every(w => WITH_YES.has(w) || own.has(w) || w.length < 3);
}
// Whether a no she read is a no: their words have one of the ways a no is said. "will I lose this one?" after her new
// chat offer, and "yes, I finished the Defias quest" after a voice one, came back as no (the lab, 10/27: 2 of 58).
const NO_WORDS = /\b(?:no|nah|nope|naw|not|don'?t|never|stop|cancel|leave|keep|skip|pass|rather|later|wait|hold|mind|neither|nothing|stay|as is|fine|all (?:set|good)|(?:it|that|i)'?(?:s|m)? (?:fine|ok(?:ay)?|good)|i'?m (?:good|fine|ok(?:ay)?))\b/i;
export const fitsNo = question => NO_WORDS.test(String(question || "").replace(/’/g, "'"));
// The one a spoken yes sends out (a screenshot to a friend): only a short plain yes, never one with a question in it
// (the Architect, 10/26); otherwise she asks "Send it?" once.
// Her try that took their words as a yes (or a no) to the offer, though they're about something else, goes back once
// with this.
export const offerNote = (offer, reply = "yes") => `YOUR LAST TRY: you took their words as a ${reply} to your offer (${offer.label}), but they're about something else, so nothing is done and the offer still stands. Answer again: answer what they said in one or two short sentences, then ask once more if they'd like it, and call ${OFFER_REPLY} with reply "about" and that answer.`;
export const SENDS = new Set(["capture_game_to_friend"]);
export const plainYes = question => !/\?/.test(question) && String(question || "").trim().split(/\s+/).length <= 6;
// Her one tool for that reply. yes and no are said in the site's words (the app does it, or lets it go); about keeps
// the offer for another yes (the Architect, 10/26: after "what does that do?", "ok do it" found nothing waiting).
export function offerReplyTool(offer) {
  return { name: OFFER_REPLY,
    description: `Only when their words answer the offer you just made ("${offer.label}"): yes, they want it done; no, ` +
      `they don't; about, they ask about it (what it does, which one, how much) or say yes with a question or a ` +
      `condition ("sure, but the dwarf one", "yes, and which is louder?"): then answer that in answer and end by ` +
      `asking again whether to do it. Never for anything else they say or ask, even with a yes in it: "yes, I ` +
      `killed Hogger" or "yes, I finished the quest" is about their adventure, not your offer, so answer it as usual.`,
    parameters: { type: "object", properties: {
      reply: { type: "string", enum: ["yes", "no", "about"] },
      answer: { type: "string", description: "about: your answer, ending by asking again." } }, required: ["reply"] } };
}

// The titles of the asking app's past chats, newest first, from its WILLO STATE ("past chats, newest first: A | B"):
// lists.chats when the offering code gives none.
// A spoken question cut off mid-sentence ("Where can I", the talk key let go too soon; LOR-625, LOR-844 step 5): it
// stops on a word that can't end one ("the", "and", "can I", "get to"), on what they'd do without what for ("can I
// buy", "do I find"; never "can I train?", a whole question), or on a bare question word ("Where is"). This
// check is the authority: the PC's copy (companion talk/talker.py CUT_OFF) only cues it (the answer's `cut`), and with
// no match here the question is answered and counted as usual. Never loosen this to follow the PC, or the PC's to
// follow it.
const CUT_OFF = /(?:^(?:who|what|where|when|why|how|which)(?:\s+(?:is|are|was|were|do|does|did|can|could|should|would|will))?|\b(?:a|an|the|my|your|our|their|of|and|or|but)|\b(?:can|could|do|does|did|should|would|will|may|might|must|shall)\s+i|\b(?:can|could|do|does|should|would|will)\s+i\s+(?:buy|find|get|make|learn)|\b(?:get|go|going|head|travel|fly|talk|speak|turn|take|bring|way)\s+to)$/i;
export const cutOff = question => CUT_OFF.test(String(question || "").replace(/[\s.,!?…"'’]+$/u, "").trim());
// Today's line for it, where the model isn't asked (the Gemini fallback's rules), as the PC said it before.
export const CUT_OFF_LINE = "I only caught the start of that. Say it again?";
export const ASK_REST = "ask_rest";
export const askRestTool = question => ({
  name: ASK_REST,
  description: `Their words may have stopped mid-sentence: heard as "${String(question).slice(0, 120)}". If you can't ` +
    "tell what they mean, call this to ask for the rest in a few words (\"Buy what, friend?\"), and never guess a vendor, " +
    "place, person or thing their words don't name; say it to them, as you always speak. If you can tell what they " +
    "mean, answer it as usual instead.",
  parameters: { type: "object", properties: { say: { type: "string",
    description: "Your question back: a few words, ending with a question mark." } }, required: ["say"] },
});
// Her ask for the rest, as code takes it: short (12 words at most), a question, and naming nobody and nowhere their
// words didn't (a capitalized word: "Buy what from Brog?", "Brog? Or someone else?"; the first only when it isn't a
// plain word of a question back). A role in lowercase ("From the blacksmith?") is the lab judge's to catch.
const PLAIN_FIRST = new Set(("what which who whom whose where when why how buy find get make learn sorry and or do did " +
  "is are was can could would should will say tell sure oh hmm um you your the a an to for from").split(" "));
export function asksRest(say, question) {
  const words = String(say || "").trim().split(/\s+/);
  if (!words.join(" ").endsWith("?") || words.length > 12) return false;
  const own = new Set((String(question || "").toLowerCase().match(/[\p{L}']+/gu) || []));
  return !words.map(w => w.replace(/[^\p{L}']/gu, ""))
    .some((w, i) => /^\p{Lu}/u.test(w) && w !== "I" && !own.has(w.toLowerCase())
      && !(i === 0 && PLAIN_FIRST.has(w.toLowerCase())));
}

export function chatsOf(state) {
  const line = /^past chats, newest first: (.+)$/m.exec(String(state || ""));
  return line ? line[1].split(" | ").map(t => t.trim()).filter(Boolean) : [];
}

// The keys the asking app hears, when it hears fewer than TALK_KEYS (a Mac: "keys she hears: f5 f6 …"); null: all.
export function keysOf(state) {
  const line = /^keys she hears: (.+)$/m.exec(String(state || ""));
  return line ? line[1].split(/\s+/).filter(Boolean) : null;
}

// A grouped tool as a provider-neutral declaration ({name, description, parameters}), with only the operations the
// asking app runs whose lists have something to pick (lists: the app's voices and chat titles) and whose moment holds
// (lists.state: its WILLO STATE, momentsOf); null when none is left. Which tools are offered for an answer, and when,
// is the offering code's (lib/companion-answers.js, answer.js).
export function toolDeclaration(id, capabilities, lists = {}) {
  const tool = CONTRACT.tools[id];
  if (!tool?.ops) return null;
  const moments = momentsOf(lists.state);
  lists = { ...lists, chats: lists.chats || chatsOf(lists.state), keys: lists.keys || keysOf(lists.state) };
  const ops = opsFor(capabilities, id).filter(op => (!tool.ops[op].needs || moments[tool.ops[op].needs])
    && Object.values(tool.ops[op].args || {}).every(a => !a.list || a.or || choices(a, lists).length));
  if (!ops.length) return null;
  const properties = { op: { type: "string", enum: ops } };
  // The model's arguments: never the ones the site fills in after her call ({site}: a memory's ids).
  const given = op => Object.entries(tool.ops[op].args || {}).filter(([, arg]) => !arg.site);
  for (const op of ops) for (const [name, arg] of given(op)) {
    if (properties[name]) continue;
    const picks = arg.list ? choices(arg, lists).map(([v]) => v) : null;
    // All her talk keys said as one line, not a 33-name enum in each tool that takes one (LOR-856: tokens per answer);
    // the few a Mac hears stay an enum, which groupedOf holds her call to.
    properties[name] = arg.text ? { type: "string", description: `At most ${arg.text} letters, in the player's words.` }
      : arg.list === "talk_keys" && !lists.keys
        ? { type: "string", description: `One of ${keysSaid(picks)}.${arg.pick ? ` ${PICK_SAID}` : ""}` }
      // Each swatch with its name ("fel (Fel green)"): told only "fel", she took "switch to fel green" for none of hers.
      : arg.or === "hex" ? { type: "string", description: `One of ${choices(arg, lists).map(([v, w]) => w === v ? v : `${v} (${w})`)
        .join(", ")}, or any other color as #rrggbb.${arg.pick ? ` ${PICK_SAID}` : ""}` }
      : { type: "string", enum: picks, ...(arg.pick ? { description: PICK_SAID } : {}) };
  }
  return { name: id, description: `${titled(tool.what)}. op: ` + ops.map(op => `${op}, ${tool.ops[op].what}`).join("; ") + "." +
      (ops.includes("voice") ? backTo(lists.before, lists.voices || []) : ""),
    parameters: { type: "object", properties, required: ["op"] } };
}

// A value that's theirs to pick (LOR-856 A4): she leaves it out unless they named one.
const PICK_SAID = "Only one they named (or, to switch back, the one before); leave it out when they named none, and " +
  "they're shown the choices.";

// The talk keys as a line: the F keys as a run ("f5 to f24"), then the rest.
function keysSaid(keys) {
  const f = keys.filter(k => /^f\d+$/.test(k)).map(k => Number(k.slice(1)));
  const run = f.length > 2 && f.every((n, i) => !i || n === f[i - 1] + 1) ? [`f${f[0]} to f${f.at(-1)}`] : f.map(n => `f${n}`);
  return [...run, ...keys.filter(k => !/^f\d+$/.test(k))].join(", ");
}

// The words on a grouped tool's button: its label, with each {argument} as the player reads it.
// Each {argument} as the player reads or hears it.
const SAID_ARG = {
  key: k => TALK_KEYS[k] || k, voice: voiceName, chord: c => c.split("+").map(titled).join("+"),
  section: s => CONTRACT.lists.sections[s]?.label || s, color: c => c.startsWith("#") ? "that color" : CONTRACT.lists.colors[c] || titled(c),
};
const filled = (template, args) => template.replace(/\{(\w+)\}/g, (_, name) => (SAID_ARG[name] || String)(args[name] ?? ""));
function opLabel(id, op, args) {
  return filled(CONTRACT.tools[id].ops[op].label, args).slice(0, 60);
}

// What she says once a change done at once has run (LOR-856 A3): the contract's done line for it, from what it set,
// never her own words about it ("Yes, I'm speaking as Sprite now" for a switch to Moonwell, Mike's QA 10/27). A line
// per value ({hosted: …}) goes by its one argument. null for one with none (it opens a card, or says it again).
export function doneLine(action) {
  const tool = CONTRACT.tools[action?.id];
  const spec = tool?.ops ? tool.ops[action.args?.op] : tool;
  const done = spec?.done;
  if (!done) return null;
  if (typeof done === "string") return capitalized(filled(done, action.args || {}));
  const value = Object.entries(action.args || {}).find(([k]) => k !== "op")?.[1];
  return done[value] || null;
}
const capitalized = s => s.charAt(0).toUpperCase() + s.slice(1);

// Loose matching of a value heard or written against a list (LOR-856 A4, lib/heard.js): "fell green" is fel, "moon
// well" Moonwell.
// The one of pairs ([value, words]) that value names, or null: the same, or every word of it close to one of a choice's,
// or all of it as one word ("moon well").
function matchChoice(value, pairs) {
  const said = wordsOf(value).join(" ");
  const same = pairs.find(([v, w]) => wordsOf(v).join(" ") === said || wordsOf(w).join(" ") === said);
  if (same) return same[0];
  const words = wordsOf(value), joined = words.join("");
  const fits = words.length ? pairs.filter(([v, w]) => words.every(x => wordsOf(`${v} ${w}`).some(y => near(x, y)))
    || wordsOf(`${v} ${w}`).some(y => near(joined, y))) : [];
  return fits.length === 1 ? fits[0][0] : null;
}
// Words of a choice's name that say nothing of which one it is (her own name, "voice", "color").
const PLAIN_CHOICE = new Set(["willo", "willow", "voice", "color", "colour", "own", "the", "and", "her", "his"]);
// Words that only ask for a change, naming none: "can you change your color to something else?"
const ONLY_ASKS = new Set(("can could would will you your yours yourself please change switch swap try make be turn set use " +
  "pick choose a an the to into another different new other some something else one color colour voice look sound " +
  "willo willow hey so um ok okay now me i want like would how about maybe just").split(" "));
const BACK = /\b(?:back|before|previous|last one|old one|other one|again|returned?|undo)\b/i;
// A change whose value is theirs to pick (willo-actions.json "pick": her voice, her color; LOR-856 A4), when it lacks one
// they named: {ask, card}, the choices to pick from (her Settings card for them, where the app opens it) and her
// question which; null when the value is theirs (named, matched loosely, or the voice before on "switch back") or the
// action picks nothing. "Can you change your voice?" switched her to Moonwell (Mike's QA, 10/27).
export function choicesFor(action, { question = "", before = null, capabilities = "", voices = [] } = {}) {
  const tool = CONTRACT.tools[action?.id];
  const spec = tool?.ops ? tool.ops[action.args?.op] : null;
  const [name, arg] = Object.entries(spec?.args || {}).find(([, a]) => a.pick) || [];
  if (!arg) return null;
  const value = action.args[name];
  if (typeof value === "string" && value) {
    const own = wordsOf(`${value} ${(SAID_ARG[name] || String)(value)}`).filter(w => !PLAIN_CHOICE.has(w));
    const heard = heardWords(question);
    if (own.some(w => heardIn(w, heard))) return null;
    if (name === "voice" && value === before && BACK.test(question)) return null;
    // A color of their own (#rrggbb) from words of theirs that aren't only the ask ("deep purple").
    if (value.startsWith("#") && heard.some(h => !ONLY_ASKS.has(h))) return null;
  }
  const card = canRun(capabilities, "settings", "open") && CONTRACT.lists.sections[arg.pick.section]
    ? { id: "settings", args: { op: "open", section: arg.pick.section }, label: CONTRACT.lists.sections[arg.pick.section].label }
    : null;
  // Her voices said by name (out loud there's no card to read): "Which voice would you like: Sprite, Moonwell or Sunbeam?"
  const named = arg.list === "voices" && voices.length > 1 && voices.length <= 6 ? voices.map(voiceName) : null;
  const ask = named ? `Which voice would you like: ${named.slice(0, -1).join(", ")} or ${named.at(-1)}?` : arg.pick.ask;
  return { ask, card };
}

// A grouped tool's call as its action ({id, args: {op, ...}, label}), or null: an operation or argument outside what
// was declared, or one its operation needs missing.
function groupedOf(declared, given) {
  const tool = CONTRACT.tools[declared.name], props = declared.parameters.properties;
  const op = given.op;
  if (typeof op !== "string" || !props.op.enum.includes(op)) return null;
  const args = { op };
  for (const [name, arg] of Object.entries(tool.ops[op].args || {})) {
    if (arg.site) continue;                             // filled in after her call (lib/willo-memory-tool.js)
    let value = typeof given[name] === "string" && given[name].trim() ? given[name] : arg.default;
    if ((typeof value !== "string" || !value.trim()) && arg.optional) continue;   // the site fills it in (a forget's words)
    // None named of a value that's theirs to pick: the choices, below (choicesFor), never one of hers.
    if ((typeof value !== "string" || !value.trim()) && arg.pick) return { id: declared.name, args, label: "" };
    if (typeof value !== "string" || !value.trim()) return null;
    // A value that's theirs, matched loosely against its list ("fell green" is fel).
    if (arg.pick && !(props[name].enum || choices(arg).map(([v]) => v)).includes(value) && !/^#[0-9a-f]{6}$/i.test(value.trim()))
      value = matchChoice(value, props[name].enum ? props[name].enum.map(v => [v, (SAID_ARG[name] || String)(v)]) : choices(arg)) ?? value;
    const key = arg.list === "talk_keys" ? value.trim().toLowerCase() : null;
    if (props[name].enum ? !props[name].enum.includes(value) : key !== null ? !Object.hasOwn(TALK_KEYS, key)
      : arg.or === "hex" && !choices(arg).some(([v]) => v === value) && !/^#[0-9a-f]{6}$/i.test(value.trim())) return null;
    args[name] = props[name].enum ? value : key ?? value.trim().replace(/\s+/g, " ").slice(0, arg.text || 300);
  }
  return { id: declared.name, args, label: opLabel(declared.name, op, args) };
}

// The action with now (the player plainly asked for it, so it runs at once, with Undo where it changes something) when
// its tier allows that: never a yes-tier one, money, consent, a page in her window or a note to send. The app checks
// it again (companion/lore_companion/actions.py).
export function withNow(action) {
  const tool = CONTRACT.tools[action?.id];
  const tier = tool?.ops ? tool.ops[action.args?.op]?.tier : tool?.tier;
  return tier && CONTRACT.tiers[tier].now && !tool.window_only ? { ...action, now: true } : action;
}

// The one action an answer offers, from the model's function call: {id, args, label}, or null for anything not offered,
// with arguments outside the offer, or a second call. offered: actionsFor's declarations (and toolDeclaration's).
export function actionOf(call, offered) {
  const declared = (offered || []).find(d => d.name === call?.name);
  if (!declared) return null;
  const given = call.args && typeof call.args === "object" ? call.args : {};
  if (CONTRACT.tools[declared.name]?.ops) return groupedOf(declared, given);
  const args = {};
  for (const [name, schema] of Object.entries(declared.parameters?.properties || {})) {
    const value = given[name];
    if (typeof value !== "string" || !value.trim()) return null;
    if (schema.enum && !schema.enum.includes(value)) return null;
    args[name] = schema.enum ? value : value.trim().replace(/\s+/g, " ").slice(0, 300);
  }
  const label = {
    open_settings: () => SECTIONS[args.section].label,
    open_plans: () => "Open Plans",
    open_billing: () => "Open Billing",
    open_keeps: () => "Open What Willo keeps",
    send_feedback: () => "Tell us what's wrong",
    set_voice: () => `Switch to ${voiceName(args.voice)}`,
    new_chat: () => "Start a new chat",
    set_talk_key: () => `Use ${TALK_KEYS[args.key]}`,
    // (The … : a tap shows how it works first, and the player turns it on there.)
    live_game_info: () => "Turn on Live game info…",
    see_the_game: () => "Let me see the game…",
  }[declared.name]();
  return { id: declared.name, args, label };
}

// An answer that says the offer is already done ("Of course! I've cleared our recent history": Flash-Lite, 2 times in 3
// for "can we start over?", 10/15), when only a tap or a yes does it.
export const SAYS_DONE = /\bI(?:'ve|’ve| have) (?:already )?(?:cleared|wiped|erased|started|switched|changed|set|moved|opened|turned|sent|enabled)\b/i;

// The answer without the sentences that say it's done already, then her offer (offerLine); only the offer when
// nothing's left. (Whole answers became "F9 is free. Want me to use it?" for one "I've set" in them.)
export function offerInstead(answer, action) {
  const kept = (String(answer || "").match(/[^.!?]+[.!?]*\s*/g) || []).filter(s => !SAYS_DONE.test(s)).join("").trim();
  return kept ? `${kept} ${offerLine(action)}` : offerLine(action);
}

// What Willo adds, once, to an answer about a quest for a player whose plan reads quest pages with no recording aloud, with
// Live game info's button under it (functions/api/companion/answer.js questOffer): the add-on only names those pages while
// Live game info is on.
export const QUEST_READING_OFFER = "Want quests without a recording read aloud? Turn on Live game info.";

// What Willo says when the answer came back as only the offer, without words of its own, or said it was done.
export function offerLine(action) {
  return {
    open_settings: "I can show you where that is in my Settings.",
    open_plans: "The Plans page has what each plan adds.",
    open_billing: "Your billing has your payments.",
    open_keeps: "Everything I keep for you is on one page, where you can change or erase any of it.",
    send_feedback: "I can't fix that one myself. Want to tell the people who made me?",
    set_voice: `How about ${voiceSaid(action.args.voice || "")}? Want me to switch?`,
    new_chat: "Want a fresh chat? This one stays in your list.",
    set_talk_key: `${TALK_KEYS[action.args.key] || "Another key"} is free. Want me to use it?`,
    live_game_info: "With Live game info on, I'd know where you are and who you target. Want to see how it works?",
    see_the_game: "If you let me see the game, I can look when you ask. Want to see how it works?",
  }[action.id] || (CONTRACT.tools[action.id]?.ops
    ? (CONTRACT.tools[action.id].ops[action.args?.op]?.tier === "show" ? "I can show you that." : "I can do that for you.")
    : "");
}

// Her own tools on every answer (LOR-844 step 2): on DeepSeek the model decides when the player asks for something
// of her notebook, goals or pins, instead of the words the site matches (lib/willo-notebook.js notebookIntent,
// willo-pins.js pinIntent, willo-goals.js goalIntent), which the Flash-Lite fallback keeps. A few tools with an op each
// (step 6: grouped, so the prompt stays small), ungrouped back into the notebook's, goals' and pin's own calls, which
// their code checks as before (notebookCall, goalCall, pinCall). Always the same tools in the same order (the Software
// Architect, 10/26: a list that changes per answer breaks the prompt's reuse and moves her choices with it); their code
// refuses what doesn't apply: a reminder on a plan without them, a goal on a plan that doesn't keep them, a pin with no
// spot from the game, a line number NOTEBOOK doesn't have.
export const BOOK_TOOLS = ["notebook", "goal", "pin"];
export function bookTools() {
  return [{ name: "notebook",
    description: "Their notebook (NOTEBOOK), only when they ask you to: add lines (to-dos to do or get, or notes to " +
      "keep in mind), remind them at a moment they name (a place they reach, a level or a time), tick off what " +
      "they've done, change a line's words, take lines off, move one to the top or bottom or to their other page, or " +
      "make lines one, or show their reminders, pins or goals. It's done at once.",
    parameters: { type: "object", properties: {
      op: { type: "string", enum: ["add", "remind", "check", "update", "remove", "move", "merge", "show"] },
      items: { type: "array", items: { type: "string" }, description: "add: one short, tidy line each, in their words." },
      kind: { type: "string", enum: ["todo", "note"], description: "add: todo, or note for something to keep in mind." },
      heading: { type: "string", description: "add: only a list or topic they name to file it under." },
      lines: { type: "array", items: { type: "integer" }, description: "The lines' numbers in NOTEBOOK." },
      done: { type: "boolean", description: "check: false to untick." },
      text: { type: "string", description: "update: its new words; merge: the one line they become; remind: what to say, short." },
      to: { type: "string", enum: ["top", "bottom"], description: "add or move: where in the list, when they say." },
      page: { type: "string", enum: ["character", "account"], description: "account: their page for all characters, " +
        "when they say so; move: the page to move to." },
      when: { type: "string", enum: ["place", "level", "time"] },
      place: { type: "string", description: "remind: the zone, city, town or district, as the game names it." },
      level: { type: "integer" }, in_minutes: { type: "integer", description: "remind: minutes from now." },
      clock: { type: "string", description: "remind: on their clock, 24-hour HH:MM." },
      day: { type: "string", enum: ["today", "tomorrow"] },
      show: { type: "string", enum: ["reminders", "pins", "goals"], description: "show: what they asked to hear." },
    }, required: ["op"] } },
  { name: "goal",
    description: "Only when they say a goal they want (set: keep it under Goals, or change one, with replaces), or ask " +
      "for your goal check-ins off or on (checkins). Never for a goal they only ask about.",
    parameters: { type: "object", properties: {
      op: { type: "string", enum: ["set", "checkins"] },
      what: { type: "string", enum: ["riding", "journeyman_riding", "level", "gold", "profession", "reputation", "other"],
        description: "riding: first mount (level 40); journeyman_riding: the faster one (60)." },
      level: { type: "integer" }, gold: { type: "integer", description: "gold to save; for riding only a price they said." },
      profession: { type: "string", enum: PROFESSIONS }, skill: { type: "integer" }, faction: { type: "string" },
      standing: { type: "string", enum: STANDINGS.slice(4) }, text: { type: "string", description: "other: a few of their words." },
      replaces: { type: "integer", description: "NOTEBOOK number of the goal it changes." },
      on: { type: "boolean", description: "checkins: on or off." },
    }, required: ["op"] } },
  { name: "pin",
    description: "Only when they ask to pin or mark where they stand: on this character's page, with the place and " +
      "the day filled in.",
    parameters: { type: "object", properties: {
      name: { type: "string", description: "A short name: theirs if they gave one, else the place's own." },
      note: { type: "string", description: "What they want to remember about it, in their words; else leave it out." } },
    required: ["name"] } }];
}
// What she's told with them: when to use them, and that they're done at once.
export const BOOK_TOOLS_RULE = "YOUR NOTEBOOK, GOALS AND PINS: call notebook, goal or pin only when the player asks " +
  "you to write, tick off, change, move, merge or take off something in their notebook, to remind them, to keep a goal, " +
  "to pin a spot, or to hear their reminders, pins or goals. It's done at once, so then say in one short line in your " +
  "own voice what you did, naming it (\"Noted: a stack of silk for the bank.\"). Ticking off is for something done; " +
  "taking off a line is remove; making lines one (combining them) is merge. A reminder needs a moment (a place, a level or a time); without one it's a to-do. " +
  // LOR-856 A6: "forget the notes that I have" got "both lines, or just one?" with one note on the page.
  "When their words and NOTEBOOK leave no doubt which lines (\"tick them all\": every open to-do; \"forget my notes\": " +
  "every note; the only one there), call it for those lines; ask which only when two or more fit and their words pick none. " +
  "Questions about what's in it and things they only mention (\"I need 10 linen cloth\") call none. Only what they " +
  "ask for: never one they didn't, even one you think would help, and never one in place of something you can't do " +
  "(buying, selling, playing for them): say so, and offer it in words if it helps.";

// An own tool's call as the call of the tool it groups ({name, args}, unchecked: notebookCall, goalCall and pinCall
// check it), the notebook's show as notebook_show, or the call as it came for anything else.
export function ungrouped(call) {
  const args = call?.args && typeof call.args === "object" ? call.args : {};
  const lines = Array.isArray(args.lines) ? args.lines : args.lines == null ? [] : [args.lines];
  const pick = (...keys) => Object.fromEntries(keys.filter(k => args[k] !== undefined).map(k => [k, args[k]]));
  if (call?.name === "pin") return { name: "notebook_pin", args: pick("name", "note") };
  if (call?.name === "goal") return args.op === "checkins" ? { name: "goal_checkins", args: pick("on") }
    : { name: "goal_set", args: pick("what", "level", "gold", "profession", "skill", "faction", "standing", "text", "replaces") };
  if (call?.name !== "notebook") return call;
  switch (args.op) {
    case "add": return { name: "notebook_add", args: { kind: args.kind === "note" ? "note" : "todo", items: args.items,
      ...pick("heading", "page"), ...(args.to === "top" ? { top: true } : {}) } };
    case "remind": return { name: "notebook_remind", args: { ...pick("text", "when", "place", "level", "in_minutes",
      "clock", "day", "page"), ...(lines.length ? { replaces: lines[0] } : {}) } };
    case "check": return { name: "notebook_check", args: { items: lines, ...pick("done") } };
    case "update": return { name: "notebook_update", args: { item: lines[0], ...pick("text") } };
    case "remove": return { name: "notebook_remove", args: { items: lines } };
    case "move": return { name: "notebook_move", args: { items: lines, item: lines[0], ...pick("to", "page") } };
    case "merge": return { name: "notebook_merge", args: { items: lines, ...pick("text") } };
    case "show": return { name: "notebook_show", args: pick("show") };
    default: return null;
  }
}
// The ungrouped tools a call of the own tools may become, for the checks that ask what was offered.
export const UNGROUPED = ["notebook_add", "notebook_remind", "notebook_check", "notebook_update", "notebook_remove",
  "notebook_move", "notebook_merge", "notebook_pin", "goal_set", "goal_checkins"].map(name => ({ name }));

// Her app's actions on every answer (LOR-844 step 3): on DeepSeek any question is offered what her app can do, whatever
// its words, beside the offer its help topics chose (actionsFor by helpTopics), which the Flash-Lite fallback keeps.
// EVERY_TOPICS: actionsFor's topics for that: all but money (plans: false, never offered unasked), what she keeps (its
// page stays the privacy topic's, keepsOffer) and a new chat (its own words only: offered on every answer, it came
// for 3 of 351 everyday questions she couldn't place, "How do I get there from Ironforge?"); called with asked null,
// so any of their voices may be offered. What they give changes only with her state (what's off, a free key, their
// plan's voices), never with the question's words, so the list stays put from answer to answer.
export const EVERY_TOPICS = ["problems", "talk", "voice", "wisp", "sight", "live", "color", "settings"];
// What the asking app runs, as canRun reads it: its X-LF-Capabilities, or none for an iPhone that doesn't list them.
export const appCapabilities = (header, phone = false) => phone && !listsActions(header) ? "actions/1" : String(header || "");
// The flat tools a grouped operation does too: with that operation offered, only the grouped one is.
const GROUPED_AS = { set_voice: ["talk", "voice"], set_talk_key: ["talk", "key"], open_settings: ["settings", "open"] };
// Only the actions the asking app runs, of an offer (canRun); anything that isn't one of the app's (the notebook's
// tools) stays.
export const runnable = (offered, capabilities) => (offered || [])
  .filter(d => !Object.hasOwn(ACTIONS, d.name) || canRun(capabilities, d.name));
// Whether the question asks for what a grouped operation changes: how she talks and listens are only for a question
// about talking with her, her talk key only for her own key (never a spell's, an item's or the game's: "set my healing
// potion to F7" got her talk key, 1 of 81 in the PC's set), how she speaks only for her captions, her full voice or
// the one on their computer ("switch to Moonwell", on a plan with no voice to switch to, got "local", 4 of 4). Asked
// on every answer (appOffer), the model picks; this checks its pick against the words, as notebookCall checks lines.
const TALKS = /\b(?:talk\w*|speak\w*|voice|mic(?:rophone)?|listen\w*|hear\w*|out loud|aloud|ptt|push[- ]to[- ]talk)\b/i;
// Her memory (LOR-844 step 6, phase 1: only what the player plainly asks): "remember that…", "call me Tess", "forget
// about my brother", "what do you remember about me?". "Remember when we killed Hogger?", "do you remember…",
// "remember to…" (a to-do), "forget that" and "never mind" never touch it (the Architect, 10/26).
const LEAD = String.raw`(?:^|[.!?,;:]\s*)(?:(?:hey|hi|ok|okay|so|and|also|oh|um+|uh+|hmm+|well)[,!.]?\s+)*(?:willow?[,!.]?\s+)?` +
  String.raw`(?:please\s+)?(?:(?:can|could|will|would)\s+you\s+(?:please\s+)?|i (?:want|need) you to\s+|i'?d like you to\s+)?`;
const FORGET_ASK = /(?<!\b(?:don'?t|do not|never)\s+)\b(?:forget|let go of|stop remembering|unremember)\b|\b(?:(?:don'?t|do not|no longer) need to|no need to) remember\b/i;
// A forget that points at what she keeps of them ("forget that I…", "forget about my mount", "what I said", "you don't
// need to remember that I…"), or one that's all they said ("let go of the spoiler thing"). One said in passing on the
// way to something else is a change of plans, theirs to talk about: "Forget about Westfall, let's head to Duskwood"
// got her forget on "I play in the evenings, mostly Westfall", 1 time of 2 (the lab, 10/27).
export const FORGET_MINE = /\b(?:forget|let go of|stop remembering|(?:don'?t|do not|no longer) need to remember|no need to remember)\s+(?:(?:all(?:\s+the\s+stuff)?|everything|the\s+stuff|the\s+things?)\s+)?(?:about\s+)?(?:that\s+)?(?:i\b|i'[a-z]+\b|my\b|me\b|what i (?:said|told you)\b)/i;
const MOVES_ON = /[.!?;]\s*\S|\?|\binstead\b|,\s*(?:let'?s|lets|and|but|so|then|now|time to|we|we'?re|i'?ll|where|what|how|which|who|can|could|should)\b/i;
const FORGET_BARE = /^\W*(?:(?:oh|ok|okay|nah|no|um+|uh+|hmm+|well|actually|just|willow?)\W+)*(?:(?:forget (?:it|that|this|that one|about (?:it|that)|i (?:said|asked)(?: that)?|what i (?:said|asked))|never ?mind)\W*)+$/i;
// Everything she keeps of the player, never everything about someone or something else ("forget everything about my
// brother" is a forget of those, the Architect, 10/26): after "everything" only "you know", "I told you", "about me".
const FORGET_ALL_ASK = new RegExp(String.raw`\b(?:forget|erase|delete|wipe|clear)(?:\s+(?:it|them|that|this|just|absolutely|` +
  String.raw`literally|really|completely|totally|please|about))*\s+(?:everything|every(?:\s+single)?\s+thing|all(?:\s+of\s+(?:it|that|them))?)` +
  String.raw`(?:\s+(?:that\s+)?(?:you(?:'ve|\s+have)?\s+(?:know|remember|kept|keep|got|learned|heard)|i(?:'ve|\s+have)?\s+(?:told|said to|shared with)\s+you))?` +
  String.raw`(?:\s+(?:about|of|on)\s+(?:me|myself))?(?:\s+(?:please|now|then|ok(?:ay)?|willow?))*\s*(?:[.!?,;]|$)` +
  String.raw`|\bforget (?:about )?me\s*(?:[.!?,;]|$)`, "i");
const LIST_ASK = /\b(?:remember|know|recall)\b[^.?!]{0,30}\b(?:about me|of me|me)\b|\bwhat have i (?:told|said to) you\b|\bwhat do you (?:remember|know)\b/i;
// What the notebook, goals, reminders, pins and chats keep, theirs to forget ("forget the Ironforge reminder").
const KEPT_ELSEWHERE = /\b(?:reminders?|goals?|notes?|notebook|to-?dos?|list|pins?|spots?|chats?|conversation|quests?)\b/i;
const mine = test => ({ test: q => test(q) && !KEPT_ELSEWHERE.test(q) });
const MEMORY_ASKED = {
  // Something about the player themselves (KEEPS_MINE), never a rule for her ("remember that you can tell me
  // spoilers", kept by DeepSeek in the phase 1 lab, 10/27).
  "memory.remember": mine(q => KEEPS_MINE.test(q)),
  "memory.forget": mine(q => FORGET_ASK.test(q) && !FORGET_BARE.test(q) && (FORGET_MINE.test(q) || !MOVES_ON.test(q))),
  "memory.forget_all": mine(q => FORGET_ALL_ASK.test(q)),
  "memory.list": mine(q => LIST_ASK.test(q)),
};
// A plain ask to keep something about the player themselves ("remember that I main a hunter", "call me Tess", "don't
// forget I'm new"), never a to-do ("remember that I need to buy arrows"), which stays their notebook's.
const KEEPS_MINE = new RegExp(String.raw`${LEAD}(?:(?:remember|keep in mind|bear in mind|don'?t forget|do not forget)\s+` +
  String.raw`(?:that\s+)?(?:(?:on|for) (?:this|my) (?:character|char|toon|alt|one),?\s+)?(?![^.?!]*\b(?:need to|have to|got to|gotta|should|must|want to|going to|gonna|to-?do)\b)` +
  String.raw`(?:i'?m|i am|i'?ve|i\s+\w+|my\s+\w+|we\s+\w+)\b|call me\b|i go by\b)`, "i");
// A plain ask about what she keeps of the player, hers to do with her memory tool and never the notebook's or goals'
// ("forget that I'm saving for a mount" set a mount goal): to keep a fact about them, forget one or all, or say them.
export const asksMemory = question => {
  const q = String(question || "").replace(/’/g, "'");
  return Object.values(MEMORY_ASKED).some(asked => asked.test(q));
};
// A question that may ask for her memory: the Gemini fallback, which has no tools on every answer, gets the memory
// tool for these alone.
export const memoryCue = question => {
  const q = String(question || "").replace(/’/g, "'");
  return Object.values(MEMORY_ASKED).some(r => r.test(q));
};
const ASKED = {
  "talk.on": TALKS, "talk.off": TALKS,
  "talk.key": /\b(?:talk\w*|speak\w*|hold(?:ing)?|ptt|push[- ]to[- ]talk|your (?:own )?key)\b/i,
  "target.key": /\b(?:talk\w*|speak\w*|target\w*|npcs?)\b/i,
  // Her chirp is a sound ("Can you stop popping up on my screen?" turned it off at once, 10/26).
  "remarks.chirps_on": /\b(?:chirp\w*|sounds?|noises?|beeps?|dings?|chimes?)\b/i,
  "remarks.chirps_off": /\b(?:chirp\w*|sounds?|noises?|beeps?|dings?|chimes?)\b/i,
  "talk.engine": /\b(?:captions?|subtitles?|text|write|writing|written|words only|read\w*|quiet\w*|silent\w*|mute\w*|local\w*|offline|computer|pc|hosted|full voice|real voice|online)\b/i,
  ...MEMORY_ASKED,
};
// The game's own, never hers to change: "stop the trade chat from chirping" turned her chirps off, and "set my healing
// potion to F7" set her talk key (the step 5 lab, 10/26).
// Any change of hers, not only those ASKED gates: her retry for the trade chat set her remarks off instead. A tap that
// only opens a page of hers still stands.
const THE_GAMES = /\b(?:trade (?:chat|channel)|guild chat|general chat|whispers?|chat channels?|action ?bars?|macros?|potions?|spells?|abilit(?:y|ies))\b/i;
const OPENS = new Set(["open_settings", "open_keeps", "open_plans", "open_billing", "settings.open"]);
// Her Settings never stands in for the Plans page or Billing ("take me to the plans page" opened Settings 3 of 3,
// 10/26): open_plans or open_billing is that offer where it can run, and over the game or with no plans, her words.
const MONEY_ASKED = /\b(?:plans? page|pric\w*|billing|subscri\w*|refunds?|receipts?|payments?|pay|buy|purchase)\b/i;
const SETTINGS = new Set(["open_settings", "settings.open"]);
export function fitsAsked(action, question) {
  const key = `${action?.id}.${action?.args?.op}`;
  const q = String(question || "").replace(/’/g, "'");
  if (THE_GAMES.test(q) && !OPENS.has(action?.id) && !OPENS.has(key)) return false;
  if (MONEY_ASKED.test(q) && (SETTINGS.has(action?.id) || SETTINGS.has(key))) return false;
  return !ASKED[key] || ASKED[key].test(q);
}
// Her words for a change of hers the site didn't make (fitsAsked, twice), without the sentences that say it's made:
// "Switched to Moonwell — I'll speak in it from now on" with no voice set (the step 5 lab, 10/26).
const SAYS_CHANGED = /\b(?:it is|switched|done|is (?:now )?(?:on|off|set|yours)|turned (?:on|off)|set (?:to|it)|from now on|I'll (?:speak|sound|use|stay|keep))\b|^\s*[\w']+(?:\s[\w']+)? (?:off|on)\b/i;
export function unchanged(answer) {
  const kept = (String(answer || "").match(/[^.!?]+[.!?]*\s*/g) || []).filter(s => !SAYS_DONE.test(s) && !SAYS_CHANGED.test(s))
    .join("").trim();
  return kept || "I haven't changed anything for that one.";
}

// The app's actions for one answer, as declarations: helped (the help topics' offer) first, then every (actionsFor on
// EVERY_TOPICS), then the grouped tools the app lists (toolDeclaration; lists: its voices), each only where it runs.
export function appOffer({ helped = [], every = [], capabilities = "", lists = {} } = {}) {
  const grouped = listsActions(capabilities) ? Object.keys(CONTRACT.tools).filter(id => CONTRACT.tools[id].ops)
    .map(id => toolDeclaration(id, capabilities, lists)).filter(Boolean) : [];
  const covered = name => Object.hasOwn(GROUPED_AS, name) && grouped.some(d => d.name === GROUPED_AS[name][0]
    && d.parameters.properties.op.enum.includes(GROUPED_AS[name][1]));
  return [...runnable([...helped, ...every.filter(e => !helped.some(h => h.name === e.name))], capabilities)
    .filter(d => !covered(d.name)), ...grouped];
}

// A plain ask of hers runs at once (LOR-844 step 5, the PC's now: withNow), when it changes only something of hers that
// Undo puts back: "turn your chirps off", "can you glow green?", never a question about it ("how often do you
// comment?", "what's your talk key?"), which stays an offer at most.
// Out loud there's rarely a "?" ("is there a way to hide you", "can I turn your chirps off": the Architect, 10/26).
const ASKS_ABOUT = /^(?:how|what|why|where|when|which|who|whose|is|are|was|were|does|did|do (?:you|i)|have you|has|am i|should i|(?:can|could|may) i|if i|tell me (?:how|what|if|whether))\b/i;
const ASKS_FOR = /^(?:(?:can|could|would|will) you|please)\b/i;
export function plainAsk(question) {
  const q = String(question || "").replace(/’/g, "'").trim().replace(/^(?:hey |ok |okay |so |um+ |uh+ )?(?:willo|willow)[,!.]?\s*/i, "");
  if (!q || ASKS_ABOUT.test(q)) return false;
  return !q.endsWith("?") || ASKS_FOR.test(q);
}
// What she's told when the asking app runs those at once: it's done the moment she calls it, so she says so.
export const NOW_RULE = "DONE AT ONCE: when they plainly ask you to change something of yours that Undo puts back " +
  "(how you talk or speak, your voice, your remarks and chirps, your look, a card of your Settings to show), it's done " +
  "the moment you call it: say in a few words that it's done (\"Chirps off.\"), and never ask first. Anything else " +
  "you call is still only an offer.";
// Her words for one done at once: without the sentences that offer it ("Want me to…?"), or the done line alone.
const OFFERS_IT = /\b(?:want me to|shall i|should i|would you like me to|do you want me to|like me to|say the word)\b/i;
export function doneInstead(answer, action) {
  const kept = (String(answer || "").match(/[^.!?]+[.!?]*\s*/g) || []).filter(s => !OFFERS_IT.test(s)).join("").trim();
  return kept || `Done: ${action.label.charAt(0).toLowerCase()}${action.label.slice(1)}.`;
}
