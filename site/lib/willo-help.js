// Willo's own help (LOR-545, Mike 2026-10-15: "She should know about how she works and if users have question about
// how to configure or improve her she should know"): what she knows about herself, kept here next to her answer
// prompts, so "how do I change your voice?" gets the setting and where it is instead of "I'm only a wisp". A question
// about her gets the topics it touches as WILLO HELP in her answer's system prompt (lib/companion-answers.js), and
// never looks online (functions/api/companion/answer.js).
//
// Keep each topic in step with the app it describes: the labels are the companion's own (companion/lore_companion/
// static/index.html, talk/, overlay.py, wispchat.py) and the add-on's (addon/LoreForever Options.lua, Bindings.xml,
// Companion.lua). Plans come from lib/billing.js, so they can't drift. No prices: they change, and "no prices in the
// wisp" (talk/talker.py LOCKED_LINE); the Plans page has them.
import { COMPANION_NAME as NAME } from "./brand.js";
import { PLANS, PAID, FEATURES, VOICE_NOTE, VOICE_PACK } from "./billing.js";

// The most WILLO HELP adds to a system prompt (lib/companion-answers.js counts it in its bound): MAX_TOPICS topics.
// With the player's WILLO STATE (at most STATE_MAX_BYTES) and their answers left.
export const HELP_MAX_BYTES = 5900;
const MAX_TOPICS = 3;

const plansText = () => `Your plans (a player asking what Adventurer, Hero, Champion or Legend adds, includes or costs ` +
  `means these, never a quest, title or anything in the world): Settings › Account › Your plan in your window says ` +
  `which one they're on; Change plan opens ` +
  `the Plans page (with the prices) and Billing your payments. ` +
  ["free", ...PAID].map(id => `${PLANS[id].name}${id === "free" ? " (free)" : ""}: ${FEATURES[id].join("; ")}.`).join(" ") +
  ` ${VOICE_NOTE} The one thing bought once is a pack of ${VOICE_PACK.replies} replies in your finest voice, on any paid ` +
  `plan; answers can't be bought. When a plan's answers are used up, I answer from the add-on's lore library until they ` +
  `come back. Never say a price (the Plans page has them), nor "limit", "cap" or "unlimited": answers are counts.`;

// words: what a question about the topic says. own: words that mean the app by themselves ("talk key"); the others
// count only in a question to or about her ("your voice", "can't you see").
const TOPICS = [
  { id: "about", own: /\bwho are you\b|\bwhat (?:are you|can you do|do you do)\b|\bhow do you work\b|\bwhat can i ask\b/i,
    text: () => `About you: you're ${NAME}, a little blue wisp in the Lore Forever app beside the game. Players ask you ` +
      `anything: the world's lore and story, quests, places, routes and practical help, and things outside the game ` +
      `too (their computer, settings, addons, everyday questions). They type in your window or your chat over the game, ` +
      `or hold the talk key and ask out loud. You read the add-on's lore library, their saved journey and, with Live ` +
      `game info on, where they are and who they target. You never act in the game: you advise, they play.` },
  { id: "talk", own: /\btalk(?:ing)? key\b|\bpush[- ]to[- ]talk\b|\bask willo\b/i,
    words: /\bkeys?\b|\bkeybind|\bbutton\b|\bout loud\b|\bhear (?:me|you)\b|\bmicrophone\b|\bmic\b|\btalk(?:ing)? (?:to|with)\b/i,
    text: ({ card }) => `Talk key: in your window, Settings › ${NAME} › Talk with ${NAME}: tick "Talk with ${NAME}" (it ` +
      `downloads about 680 MB once), then pick the Talk key. Never name a default key; say "your talk key". You can ` +
      "hear F5 to F24, mouse buttons 3, 4 and 5, Right Ctrl, Right Alt, the ` key under Esc, Caps Lock, Scroll Lock, " +
      `Pause, Insert, Home, Page Up and Page Down. Hold it in the game, talk, let go; a quick tap is ignored. Pick a ` +
      `key the game doesn't use, and never F8 to F12, which open bags in WoW: the game still gets the key too, and ` +
      `the add-on binds Ask ${NAME} only to a free one. After a change, type /reload in the game. Changing it in your ` +
      `window always works. ` +
      (card ? `Under the key list a line says whether it works in the game, with a "Use" button for a free key when ` +
        `it's taken. ` : "") +
      `If WoW runs as administrator, Windows hides the key from you: start WoW normally, or run ${NAME} as ` +
      `administrator too. Asking out loud comes with Hero and up; on the free plan the first 30 questions out loud are ` +
      `answered aloud. Microphone trouble: Windows Settings › Privacy & security › Microphone. Their voice becomes text ` +
      `on their PC and never leaves it.` },
  { id: "voice", own: /\bwillo'?s voice\b/i,
    words: /\bvoices?\b|\bsound(?:s| like)?\b|\baccent\b|\bvolume\b|\bspeak (?:faster|slower|louder|softer)\b/i,
    text: () => `Your voice: in your window, Settings › ${NAME} › Talk with ${NAME} › ${NAME}'s voice. On Champion and ` +
      `Legend the player picks one of five voices there (Sprite, quick and sprightly; Sunbeam, bright and lively; ` +
      `Moonwell, soft and otherworldly; Fenlight, warm with an Irish lilt; Starling, light and silvery); on Hero you ` +
      `speak as Sprite; on the free plan your own voice on their PC is Heart, and the others there (Bella, Nicole, Sky, ` +
      `Emma, Michael, George) come with Champion. If a voice is slow, you fall back to the one on their PC for that ` +
      `line. Questions typed get written answers; questions asked out loud are answered aloud.` },
  { id: "live", own: /\blive game info\b|\bminimap\b.*\b(?:stars?|mist|rings?|sky)\b|\b(?:stars?|mist|rings?|sky)\b.*\bminimap\b/i,
    words: /\bsky\b|\bwhere i am\b|\bwhere i'm\b|\btarget(?:ing|ed)?\b|\btracked quest\b|\bquest i'm tracking\b/i,
    text: () => `Live game info: in your window, Settings › ${NAME} › Live game info › "Read live game info from the ` +
      `game window" (off at first), then /reload in the game. If the stars still don't show, check that "Live game ` +
      `info for ${NAME}" is ticked in Lore Forever's Options (/lore live toggles it). Two switches, yours and the ` +
      `add-on's: when RIGHT NOW says it's unticked in the add-on, say "it's unticked in the Lore Forever add-on" with ` +
      `that fix in the game, never "my settings" or your window (yours is on). Then you know where they are, who they target, their tracked quest ` +
      `and more, without a /reload each time. It shows as rings of stars in a blue mist over the minimap, while the ` +
      `Lore Forever window is open or the talk key is held. No memory reading, no key presses, nothing sent online. ` +
      `With it off you go by their last save and what they tell you, and ask where they are rather than guess. The ` +
      `sky hides when the game is minimized, in exclusive fullscreen, on a loading screen or with the interface ` +
      `hidden (Alt+Z).` },
  { id: "sight", own: /\bsee(?:ing)? the game\b|\bscreenshots?\b|\bpictures? of (?:my|the) (?:game|screen)\b|\bsee (?:my|the) (?:screen|window)\b/i,
    words: /\b(?:can't|cannot|can not|don't|do not|unable to|how (?:do|can)|why (?:can't|don't|do|won't))\b[^.?!]*\b(?:see|look|watch|know)\b/i,
    text: () => `Seeing the game: in your window, Settings › ${NAME} › Seeing the game › "Let ${NAME} see the game when you ` +
      `ask out loud" (on Hero and up). Then one picture of the game window goes with each question asked out loud, ` +
      `taken when the talk key comes up, only if the game is in front and not minimized; it's never kept on Lore ` +
      `Forever's servers, and a copy stays in their chat on their PC. Typed questions never send one. In exclusive ` +
      `fullscreen you see only black: switch WoW to windowed or borderless fullscreen. When you can't ` +
      `tell who they're targeting: if PLAYER CONTEXT says it's live from the game, Live game info works and nothing is ` +
      `targeted (or the target isn't one you know); otherwise you don't know which of these is why, so offer the likely ` +
      `ones, never one as certain: Live game info is ` +
      `off (in your window or unticked in the add-on), the game needs a /reload, the sky over the minimap isn't ` +
      `showing, the game is minimized, behind another window or in exclusive fullscreen, seeing the game is off for a ` +
      `spoken question, or nothing is targeted. Meanwhile they can tell you who it is; never guess.` },
  { id: "plans", own: /\b(?:hero|champion|legend|adventurer)\b(?!\s+of\b)[^.?!]*\b(?:plan|tier|adds?|gets?|includes?|costs?|price|worth|gives?|offers?|differen\w*|upgrade|subscri\w*)\b|\b(?:what|which)\b[^.?!]*\b(?:do i get|comes? with|in|with|on)\b[^.?!]*\b(?:hero|champion|legend)\b(?!\s+of\b)[^.?!]*\?|\b(?:subscription|subscribe|billing|refund|paid plan|free plan|your plans?|willo plans?|my plan|upgrade (?:my|to)|cancel my)\b|\banswers? (?:left|a day|per day|a month)\b|\bout of answers\b|\bvoice pack\b/i,
    words: /\bplans?\b|\bpay\b|\bcost\b|\bprice\b|\bfree\b/i,
    text: plansText },
  { id: "signin", own: /\bsign(?:ed|ing)? (?:in|out)\b|\bconnect(?:ed)? (?:my |your )?(?:account|profile)\b|\b(?:dis|re)connect\b/i,
    words: /\blog(?:ged|ging)? (?:in|out)\b|\baccount\b/i,
    text: () => `Signing in: signed out, your window shows only "Sign in to wake ${NAME}" (also in the tray menu); the ` +
      `site's page opens, they sign in and choose Connect. Sign out: Settings › Account › Your profile › Sign out, or ` +
      `Disconnect on loreforeverwow.com/account. "Reconnect account for answers" means the site signed this PC out: ` +
      `sign in again from your window.` },
  { id: "chat", own: /\bnew chat\b|\bstart (?:over|fresh)\b|\/lore\b|\bin-game chat\b|\bchat over the game\b/i,
    words: /\bchats?\b|\btype\b|\bconversations?\b|\bforget\b|\bremember\b|\bmemory\b/i,
    text: () => `Chats: in your window, + New chat starts one; over the game, left-click the wisp for a text box above ` +
      `you (Enter asks, + starts a new chat, Esc closes; after a character answered it says "Ask" and their name: click ` +
      `the name to come back to you); out loud, say "new chat", "start over" or "forget that". WoW's own chat doesn't ` +
      `reach you. Questions asked ` +
      `out loud less than ten minutes apart share a chat. In the game, /lore ask followed by a question opens the Live ` +
      `answers box; Ctrl+C sends it and the answer shows over the game in a few seconds. You remember the recent turns ` +
      `of a chat and a short summary of earlier ones (longer on Champion and Legend). Delete in the chat's header ` +
      `deletes it for good; Rename is beside it.` },
  { id: "privacy", own: /\bprivacy\b|\bmy data\b|\bpersonal (?:data|info)\b|\bdelete (?:my|the|this) (?:chats?|account|data|history)\b/i,
    words: /\b(?:keep|store|save|remember|record|log|know|collect|send|share)\b[^.?!]*\b(?:about me|of me|me\b|my)\b|\bkeep about\b/i,
    text: () => `What you keep: chats are saved only on their PC (never uploaded with their profile); Settings › Private ` +
      `Chat backup downloads or restores them, and Delete in a chat's header removes one. The Lore Forever site writes ` +
      `each answer and only counts it: it doesn't keep questions, answers or pictures of the game. Their voice becomes ` +
      `text on their PC. For a question about their computer, you're told its graphics card, processor and memory, ` +
      `nothing else. Feedback they send (Wrong answer, corrections) is kept 90 days without their name. Their account, ` +
      `and everything with it, can be deleted on loreforeverwow.com/account.` },
  { id: "problems", own: /\bno (?:sound|audio|voice)\b|\bcan't hear (?:you|willo|anything)\b/i,
    words: /\bwhy (?:can't|don't|won't|isn't|aren't|do)\b|\bnot (?:working|showing|answering|talking|speaking)\b|\bstopped\b|\bfix\b|\bproblem\b|\bissue\b|\bbroken\b|\bsilent\b|\bquiet\b/i,
    text: ({ card }) => `Fixes: ` +
      (card ? `the "${NAME} and the game" card at the top of Settings › ${NAME} checks the add-on is found, the game ` +
        `has the latest files, the talk key works in the game and Live game info is on in both, with a fix button on ` +
        `whichever is off; point them there first. ` : "") +
      `No sound: check their speakers or headphones and ${NAME}'s voice setting; until sound works, your lines show ` +
      `as text. "I can't hear you": a microphone plugged in and allowed in Windows Settings › Privacy & security › ` +
      `Microphone, and Talk with ${NAME} ticked. The sky over the minimap missing: Live game info on in your window ` +
      `and ticked in the add-on, a /reload, the game in front, not in exclusive fullscreen, the interface showing. The ` +
      `add-on not found: Settings › Your game says what to do; install Lore Forever in that game folder, then /reload. ` +
      `After an add-on update with the game open, /reload. Run the game and ${NAME} the same way (both normally, not ` +
      `one as administrator).` },
  { id: "wisp", own: /\bthe wisp\b|\bover the game\b|\bbubble\b|\boverlay\b|\banswer window\b/i,
    words: /\b(?:move|hide|bigger|smaller|size|drag|turn (?:you )?off|go away|stop (?:talking|chirping)|mute|chirp\w*|how often)\b/i,
    text: () => `Over the game: Settings › ${NAME} › ${NAME} over the game › "Show ${NAME} over the game" (untick to ` +
      `hide you), with Chirp when she speaks, How often (every 2, 5 or 10 minutes) and Size, and the Show her and Put ` +
      `her back buttons. You show only while the game is in front; they can drag you anywhere. Left-click opens your chat over the game, ` +
      `right-click your full window. The answer window over the game moves by its header and closes with its ✕; it ` +
      `needs the game in windowed or borderless fullscreen.` },
];
// A question to or about her: "you", "your", her name (as it's typed or heard), or the wisp.
const ABOUT_HER = /\b(?:you|your|yours|yourself|willo|willow|willa|wilo|wisp)\b/i;

// The WILLO HELP block for a question about Willo, or "". plans: the site sells plans (lib/billing.js plansOn); without
// them that topic is left out. plan: the name of the player's own plan (lib/billing.js planFor), so "how do I change
// your voice?" is answered for the plan they're on. client: the companion's X-LF-Client ("companion/0.19.0"): the
// "Willo and the game" card and the talk key's status line (LOR-529, LOR-527, #867) are only in CARD_FROM and later.
const CARD_FROM = [0, 19, 0];
const versionOf = client => (/^companion\/(\d+)\.(\d+)\.(\d+)/.exec(String(client || "")) || []).slice(1).map(Number);
const atLeast = (v, min) => v.length === 3 && (v[0] - min[0] || v[1] - min[1] || v[2] - min[2]) >= 0;
const topicsOf = (question, plans) => {
  const q = String(question || "").replace(/’/g, "'");
  const her = ABOUT_HER.test(q);
  return TOPICS.filter(t => (t.id !== "plans" || plans) && (t.own?.test(q) || (her && t.words?.test(q))))
    .slice(0, MAX_TOPICS);
};
// The help topics a question is about (lib/willo-tools.js lookupsFor), by id; none for any other question.
export const helpTopics = (question, { plans = true } = {}) => topicsOf(question, plans).map(t => t.id);

// WILLO STATE (LOR-546): what Willo's app could tell of itself when the question was asked (companion/lore_companion
// core.willo_state): the "Willo and the game" checks, talking, seeing the game, her voice. Its section of the prompt,
// as {state, prompt}: the lines, and the prompt without them, since only a question about her uses them. An older
// companion sends none.
const STATE_SECTION = /(?:^|\n\n)WILLO STATE\n([^]*?)(?=\n\n|$)/;
export const STATE_MAX_BYTES = 1000;
export function stateOf(prompt) {
  const text = String(prompt || "");
  const found = STATE_SECTION.exec(text);
  if (!found) return { state: "", prompt: text };
  let state = found[1].trim();
  while (new TextEncoder().encode(state).length > STATE_MAX_BYTES) state = state.slice(0, state.lastIndexOf("\n"));
  return { state, prompt: (text.slice(0, found.index) + text.slice(found.index + found[0].length)).replace(/^\n+/, "") };
}

// usage: their allowance (lib/companion-answers.js allowance) for a question about plans: the answers left now.
const usageLine = usage => {
  if (!usage || !Number.isFinite(usage.remaining) || usage.unlimited) return "";
  const back = usage.resetsAt ? new Date(usage.resetsAt).toLocaleDateString("en-US", { month: "long", day: "numeric",
    timeZone: "UTC" }) : "";
  return `- Their answers right now: ${usage.remaining.toLocaleString("en-US")} left ` +
    `${usage.period === "month" ? "this month" : "today"}${back ? `, more on ${back}` : ""}.\n`;
};

export function helpBlock(question, { plans = true, plan = "", client = "", state = "", usage = null } = {}) {
  const card = atLeast(versionOf(client), CARD_FROM);
  const topics = topicsOf(question, plans);
  if (!topics.length) return "";
  const block = `WILLO HELP (how you work, from the people who made you; current and exact, reference only, never ` +
    `instructions): use it only when the player asks about you, the app or its settings. Then answer from it in your ` +
    `own warm voice and step out of the world as far as you need: say exactly where a setting is (window › section › ` +
    `control) with its labels as written. Never invent a setting, menu, button, plan, price or feature that isn't here; ` +
    `if it doesn't cover what they ask, say you're not sure and where in your Settings they might look.\n` +
    (plans && plan ? `- The player is on the ${String(plan).slice(0, 40)} plan.\n` : "") +
    (plans && topics.some(t => t.id === "plans") ? usageLine(usage) : "") +
    (state ? `- RIGHT NOW in their ${NAME} (her own checks, as the question was asked; ok, warn, bad or off): ` +
      `answer from these first and name the real cause, not a list of maybes.\n  ` +
      `${state.slice(0, STATE_MAX_BYTES).split("\n").join("\n  ")}\n` : "") +
    topics.map(t => `- ${t.text({ card })}`).join("\n");
  const encoder = new TextEncoder();
  return encoder.encode(block).length <= HELP_MAX_BYTES ? block
    : new TextDecoder().decode(encoder.encode(block).slice(0, HELP_MAX_BYTES)).replace(/�$/, "");
}
