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
  sight: { side: "willo", what: "a picture of the game with a question asked out loud (talk/sight.py); logged, not asked for" },
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
// input, no automation). confirm: "tap" opens or shows something and changes nothing; "send" fills in a note the
// player sends themselves; "yes" is a reversible change, run on a tap or a spoken "yes", always with Undo. Money is a
// tap in her window only: open_plans and open_billing open the page and never buy, and are never offered out loud or
// shown over the game (the wisp never sells). "consent" (slice 3: Live game info, seeing the game): a tap shows the
// same explanation her Settings card gives, and only a click on its Turn on turns it on, never a spoken yes; Undo turns
// it off. topics: the help topics (lib/willo-help.js) a question has to touch for it.
export const ACTIONS = {
  open_settings: { side: "willo", confirm: "tap", topics: ["problems", "talk", "voice", "wisp", "sight", "live", "color",
    "settings"],
    what: "opens a card in her Settings (SECTIONS)" },
  open_plans: { side: "willo", confirm: "tap", money: true, topics: ["plans", "voice"],
    what: "opens the Plans page in the browser, signed in (/api/account/open); never buys" },
  open_billing: { side: "willo", confirm: "tap", money: true, topics: ["plans"],
    what: "opens Billing in the browser, signed in (/api/account/open)" },
  // What Willo keeps (LOR-666, lib/willo-keeps.js): only from the app that has it (KEEPS_FROM), in her window.
  open_keeps: { side: "willo", confirm: "tap", topics: ["privacy"],
    what: "opens What Willo keeps in the browser, signed in (/api/account/open): everything she keeps, to change or erase" },
  // Offered only by the fixed screenshot answer (lib/friend-send.js), never to the model. This prepares a preview;
  // the desktop asks for Send only after capture succeeds and the actual image is visible.
  capture_game_to_friend: { side: "willo", confirm: "preview", undo: false, topics: [],
    what: "prepares a local game screenshot for a named friend; the player reviews it and chooses Send before upload" },
  send_feedback: { side: "willo", confirm: "send", topics: ["problems"],
    what: `fills in "Something's wrong" with a note; the player presses Send` },
  set_voice: { side: "willo", confirm: "yes", undo: true, topics: ["voice"],
    what: "switches her voice to one the player's plan has (/api/talk/settings hosted_voice)" },
  new_chat: { side: "willo", confirm: "yes", undo: true, topics: ["chat"],
    what: "starts a new chat; the old one stays in the list, and Undo reopens it" },
  set_talk_key: { side: "willo", confirm: "yes", undo: true, topics: ["talk"],
    what: "sets her talk key to one she can hear (talk/ptt.py KEYS); then /reload in the game" },
  live_game_info: { side: "willo", confirm: "consent", undo: true, topics: ["live"],
    what: "Live game info, turned on by the player's click under its explanation (Settings › Live game info's words)" },
  see_the_game: { side: "willo", confirm: "consent", undo: true, topics: ["sight"],
    what: "seeing the game when asked out loud (Hero and up), turned on by the player's click under its explanation" },
};
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
const voiceSaid = id => voicePhrase(id) || titled(id);

// What the answer is told when it's offered actions: a few lines, so the answer costs about the same.
export const ACTION_RULES = "WILLO ACTIONS: besides answering, you can do the things in the functions you're given, " +
  "in your app. When the player asks for one of them, or one fixes their problem, you must call it (one at most) as " +
  "well as writing your answer. Calling it only offers it: they see a button, and nothing happens until they tap it " +
  "or say yes. So never say you've done it; end your answer by offering it in a few words (\"Want me to switch to " +
  "Moonwell?\"). Never offer anything in the game itself.";
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
// another voice (WANTS_VOICE; null: any).
export function actionsFor(topics, { voices = [], current = "", key = "", liveOff = false, fixable = false,
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
    description: "Seeing the game is off in your window: with it on you'd see their screen when they ask out loud. " +
      "This shows them how it works, and they turn it on themselves." });
  if (has("set_voice") && picks.length && wantsVoice(asked, picks)) out.push({ name: "set_voice",
    description: "Switch your voice to another of the voices their plan has" + (picks.some(v => voiceLabel(v))
      ? ": your own, or one you borrow from Azeroth's peoples, by people and gender (dwarf-male)." : "."),
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
    description: "Open the Plans page (what each plan adds, with prices) in their browser. It never buys anything." });
  if (has("open_billing")) out.push({ name: "open_billing",
    description: "Open their billing (payments, receipts, cancelling) in their browser." });
  if (has("open_keeps") && keepsAsked(asked) && !spoken && (client === null || clientFrom(client, KEEPS_FROM))) out.push({ name: "open_keeps",
    description: "Open What Willo keeps in their browser: everything you keep about them, where they can change or " +
      "erase any of it." });
  return out;
}

// A question about what she keeps always ends with the page's button (LOR-666's blind check: Flash-Lite answered "what
// do you know about me?" from the player's context and never offered it, and offered a new chat for "forget
// everything"): open_keeps, whenever it was offered, whatever the model called.
export function keepsOffer(offered) {
  return (offered || []).some(d => d.name === "open_keeps") ? { id: "open_keeps", args: {}, label: "Open What Willo keeps" } : null;
}

// The one action an answer offers, from the model's function call: {id, args, label}, or null for anything not offered,
// with arguments outside the offer, or a second call. offered: actionsFor's declarations.
export function actionOf(call, offered) {
  const declared = (offered || []).find(d => d.name === call?.name);
  if (!declared) return null;
  const given = call.args && typeof call.args === "object" ? call.args : {};
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
    see_the_game: "If you let me see the game, I can look when you ask out loud. Want to see how it works?",
  }[action.id] || "";
}
