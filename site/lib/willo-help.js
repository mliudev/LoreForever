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
import { PLANS, PAID, planFeatures, VOICE_NOTE, VOICE_PACK } from "./billing.js";
import { hasAzeroth } from "./character-voices.js";
import { CLEAR_ALL } from "./willo-notebook.js";

// The most WILLO HELP adds to a system prompt (lib/companion-answers.js counts it in its bound): MAX_TOPICS topics.
// With the player's WILLO STATE (at most STATE_MAX_BYTES) and their answers left.
export const HELP_MAX_BYTES = 5900;
const MAX_TOPICS = 3;

const plansText = ({ azeroth }) => `Your plans (a player asking what Adventurer, Hero, Champion or Legend adds, includes or costs ` +
  `means these, never a quest, title or anything in the world): Settings › Account › Your plan in your window says ` +
  `which one they're on; Change plan opens ` +
  `the Plans page (with the prices) and Billing your payments. ` +
  ["free", ...PAID].map(id => `${PLANS[id].name}${id === "free" ? " (free)" : ""}: ${planFeatures({ azeroth })[id].join("; ")}.`).join(" ") +
  ` ${VOICE_NOTE} The one thing bought once is a pack of ${VOICE_PACK.replies} replies in your finest voice, on any paid ` +
  `plan; answers can't be bought. When a plan's answers are used up, I answer from the add-on's lore library until they ` +
  `come back. Never say a price (the Plans page has them), nor "limit", "cap" or "unlimited": answers are counts.`;

// A topic's own words with more alternatives joined on (other patterns').
const orElse = (...patterns) => new RegExp(patterns.map(r => r.source).join("|"), "i");
// Where their notes are: "where are my notes?", "how do I see my list?", "where did you write it down?", "how do I see
// where you've written it down?" (the stream, 10/18: it got the Settings, and the app opened them). The notebook's, whatever
// else the words say: the sight topic's "how do I … see" yields to it.
const FIND_NOTES = /\b(?:where|how)\b[^.?!]{0,40}\b(?:(?:my|your|our)\s+(?:shopping\s+)?(?:notes?|notebook|to-?dos?|lists?(?!\s+of\b)|checklist)|(?:written|wrote|write|noted|jotted|saved|put)\s+(?:(?:it|that|this|them|things|stuff|all\s+that)\s+)?down|what\s+you(?:'ve|\s+have)?\s+(?:written|wrote|noted|jotted|saved|kept)|the\s+notes?\s+you)\b/i;
// Asked where their notes are, or where she wrote something: her answer says where it was written, which is no claim of
// a change now (functions/api/companion/answer.js keeps it; QA 10/19, after a reminder she'd just set, "Where did you
// write that down?" got "I haven't changed your notebook yet").
export const asksWhereNotes = question => FIND_NOTES.test(String(question || "").replace(/’/g, "'"));

// words: what a question about the topic says. own: words that mean the app by themselves ("talk key"); the others
// count only in a question to or about her ("your voice", "can't you see"); unless: words that take a topic's looser ones
// back, for a question that's about another's.
const TOPICS = [
  { id: "about", own: /\bwho are you\b|\bwhat (?:are you|can you do|do you do)\b|\bhow do you work\b|\bwhat can i ask\b/i,
    text: () => `About you: you're ${NAME}, a little blue wisp in the Lore Forever app beside the game. Players ask you ` +
      `anything: the world's lore and story, quests, places, routes and practical help, and things outside the game ` +
      `too (their computer, settings, addons, everyday questions), and you keep their notebook of to-dos and notes when ` +
      `they ask. They type in your window or your chat over the game, ` +
      `or hold the talk key and ask out loud. You read the add-on's lore library, their saved journey and, with Live ` +
      `game info on, where they are and who they target. You never act in the game: you advise, they play.` },
  { id: "talk", own: /\btalk(?:ing)? key\b|\bpush[- ]to[- ]talk\b|\bask willo\b|\b(?:talk|speak)(?:ing)? to (?:my |the |an? |your )?(?:target|npcs?)\b/i,
    // "can you speak to me", "how can i speak aloud?" ... "i mean with you" (LOR-623: answered "I do not have a voice").
    words: /\bkeys?\b|\bkeybind|\bbutton\b|\bout loud\b|\baloud\b|\bhear (?:me|you)\b|\bmicrophone\b|\bmic\b|\btalk(?:ing)? (?:to|with)\b|\bspeak(?:ing)? (?:to|with) (?:me|you)\b/i,
    text: ({ card, target }) => `Talk key: in your window, Settings › ${NAME} › Talk with ${NAME}: tick "Talk with ${NAME}" (it ` +
      `downloads about 680 MB once), then pick the Talk key. Never name a default key; say "your talk key". You can ` +
      "hear F5 to F24, mouse buttons 3, 4 and 5, Right Ctrl, Right Alt, the ` key under Esc, Caps Lock, Scroll Lock, " +
      `Pause, Insert, Home, Page Up and Page Down. Hold it in the game, talk, let go; a quick tap is ignored. Pick a ` +
      `key the game doesn't use, and never F8 to F12, which open bags in WoW: the game still gets the key too, and ` +
      `the add-on binds Ask ${NAME} only to a free one. After a change, type /reload in the game. Changing it in your ` +
      `window always works. ` +
      (card ? `Under the key list a line says whether it works in the game, with a "Use" button for a free key when ` +
        `it's taken. ` : "") +
      // LOR-658: an app that has it says so in WILLO STATE ("key for the one you're targeting").
      (target ? `Their talk key always reaches you, even with someone targeted. To talk to the one they're targeting ` +
        `instead, they pick a key under "Ask who you're targeting" in the same place and hold that: the character ` +
        `answers in person, and with no one targeted you answer. ` : "") +
      `If WoW runs as administrator, Windows hides the key from you: start WoW normally, or run ${NAME} as ` +
      `administrator too. Asking out loud comes with Hero and up; on the free plan the first 30 questions out loud are ` +
      `answered aloud. Microphone trouble: Windows Settings › Privacy & security › Microphone. Their voice becomes text ` +
      `on their PC and never leaves it.` },
  { id: "voice", own: /\bwillo'?s voice\b/i,
    words: /\bvoices?\b|\bsound(?:s| like)?\b|\baccent\b|\bvolume\b|\bspeak (?:faster|slower|louder|softer)\b/i,
    text: ({ azeroth }) => `Your voice: in your window, Settings › ${NAME} › Talk with ${NAME} › ${NAME}'s voice. ` +
      `On Champion and Legend the player picks one ` + (azeroth
        ? `there: one of your own ten, a woman's and a man's voice of each kind (Sprite, quick and sprightly, and ` +
          `Puck, quick and impish; Sunbeam, bright and lively, and Daybreak, warm and sunny; Moonwell, soft and ` +
          `otherworldly, and Moonshade, quiet and otherworldly; Fenlight and Fenfire, warm with an Irish lilt; ` +
          `Starling, light and silvery, and Kestrel, calm and silvery)`
        : `of five voices there (Sprite, quick and sprightly; Sunbeam, bright and lively; Moonwell, soft and ` +
          `otherworldly; Fenlight, warm with an Irish lilt; Starling, light and silvery)`) +
      // Voices of Azeroth (LOR-609): only for a companion whose picker has them (lib/character-voices.js hasAzeroth).
      (azeroth ? `, or under "Voices of Azeroth" a voice you borrow from Azeroth's peoples, a man's or a woman's of ` +
        `each: dwarf, Forsaken, gnome, goblin, high elf, human, night elf, orc, Skyborne, tauren and troll ("Dwarf, ` +
        `man", "Night elf, woman"). You're still yourself in a borrowed voice, and characters who answer in person ` +
        `keep their own` : ``) +
      `; on Hero you speak as Sprite; on the free plan your own voice on their PC is Heart, and the others there ` +
      `(Bella, Nicole, Sky, Emma, Michael, George) come with Champion. If a voice is slow, you fall back to the one ` +
      `on their PC for that line` + (azeroth ? ` (Michael for a man's voice of Azeroth)` : ``) + `. Questions typed ` +
      `get written answers; questions asked out loud are answered aloud.` },
  { id: "live", own: /\blive game info\b|\bminimap\b.*\b(?:stars?|mist|rings?|sky)\b|\b(?:stars?|mist|rings?|sky)\b.*\bminimap\b/i,
    words: /\bsky\b|\bwhere i am\b|\bwhere i'm\b|\btarget(?:ing|ed)?\b|\btracked quest\b|\bquest i'm tracking\b/i,
    text: () => `Live game info: in your window, Settings › ${NAME} › Live game info › "Read live game info from the ` +
      `game window" (off at first), then /reload in the game. If the stars still don't show, check that "Live game ` +
      `info for ${NAME}" is ticked in Lore Forever's Options (/lore live toggles it). Two switches, yours and the ` +
      `add-on's: when RIGHT NOW says it's unticked in the add-on, say "it's unticked in the Lore Forever add-on" with ` +
      `that fix in the game, never "my settings" or your window (yours is on). When RIGHT NOW says it's on in both but ` +
      `you still can't tell where they are, give the two steps in the game: type /reload, and if the stars still ` +
      `don't show, tick "Live game info for ${NAME}" in Lore Forever's Options (/lore live). Then you know where they are, who they target, their tracked quest ` +
      `and more, without a /reload each time. It shows as rings of stars in a blue mist over the minimap, while the ` +
      `Lore Forever window is open or the talk key is held. No memory reading, no key presses, nothing sent online. ` +
      `With it off you go by their last save and what they tell you, and ask where they are rather than guess. The ` +
      `sky hides when the game is minimized, in exclusive fullscreen, on a loading screen or with the interface ` +
      `hidden (Alt+Z).` },
  { id: "sight", own: /\bsee(?:ing)? the game\b|\bscreenshots?\b|\bpictures? of (?:my|the) (?:game|screen)\b|\bsee (?:my|the) (?:screen|window)\b/i,
    // "Can you see the quiz I'm doing?", "are you able to see my bags?" (LOR-623: both got a guess). "What do you see?"
    // asks about the world in front of them.
    words: /\b(?:can't|cannot|can not|don't|do not|unable to|how (?:do|can)|why (?:can't|don't|do|won't))\b[^.?!]*\b(?:see|look|watch|know)\b|\b(?:can|could) you (?:see|watch|look at) (?:my|the|what)\b|\bare you able to see\b/i,
    unless: FIND_NOTES,
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
  // What she keeps (LOR-666): the What Willo keeps page (lib/willo-keeps.js) shows it all, to change or erase. Its own
  // words win over "chat" and "quit" for a question that's about her keeping things (KEEPS_FIRST): "forget everything
  // you know about me" isn't a new chat, and "delete the questions I asked you" isn't quitting her. Her answer always
  // offers the page (lib/willo-tools.js keepsOffer).
  { id: "privacy", own: orElse(/\bprivacy\b|\bmy data\b|\bpersonal (?:data|info)\b|\bdelete (?:my|the|this) (?:chats?|account|data|history)\b|\bwhat (?:\w+ )?keeps\b|\berase (?:everything|it all|all of it)\b|\b(?:delete|erase|remove|clear|wipe|forget)\b[^.?!]*\b(?:questions?|what i (?:asked|said|told you)|(?:my|our) (?:history|chats?|notes?|data)|everything|all of (?:it|that)|about me)\b|\bforget me\b|\bwhat (?:do|did|can) you (?:know|remember|keep|save|store)\b[^.?!]*\b(?:about|of) me\b|\b(?:keep|keeps|kept|store[sd]?|stored|sav(?:e|es|ed)|record(?:s|ed)?|log(?:s|ged)?|collect(?:s|ed)?|upload(?:s|ed)?|sen[dt]|track(?:s|ed)?)\b[^.?!]*\b(?:what i (?:ask|asked|say|said|type|typed|tell|told)|(?:my|our) (?:questions?|chats?|conversations?|history|answers?|data|messages?)|questions? i (?:ask|asked))\b|\b(?:what i (?:ask|asked|say|said|type)|(?:my|our) (?:questions?|chats?|conversations?))\b[^.?!]*\b(?:kept|stored|saved|recorded|logged|collected|uploaded|sent|tracked|private)\b/i,
      // "Clear your notes", "wipe my notebook": she has no clear-all, and the page that has it is hers to offer.
      CLEAR_ALL),
    words: /\b(?:keep|store|save|remember|record|log|know|collect|send|share)\b[^.?!]*\b(?:about me|of me|me\b|my)\b|\bkeep about\b|\b(?:forget|erase)\b/i,
    text: ({ keeping = null } = {}) => `What you keep: asked whether you keep their chats, questions or answers, say ` +
      `both: their chats are saved on their computer, and the site keeps their questions and your answers 14 days ` +
      `while "Help improve ${NAME}'s answers" is on (${keeping === true ? "it is on for them right now, so this " +
      "question is kept too" : keeping === false ? "it is off for them right now, so nothing they ask is kept" :
      "on unless they untick it"}; Settings › App & answers, or the What ${NAME} keeps page). Never say their chats or ` +
      `questions aren't uploaded, never say nothing leaves their computer, and never say you have no access to their ` +
      `history. When asked what you know or remember about them, one line in your own voice on what you ` +
      `know of their road (from what's in front of you) and what you keep in their notebook, as counted for you ` +
      `below (never read out, never counted yourself), then that everything you keep about them is on one page, ` +
      `What ${NAME} keeps, and offer to open it. When asked to forget or delete something, you can't erase it from here ` +
      `yourself, and a new chat erases nothing; What ${NAME} keeps does (one thing at a time, or Erase everything, which ` +
      `also clears their chats on their computer), so offer to open it. On that page they see, change or erase ` +
      `everything you keep, and download it all. It opens from Settings › App & answers › What ${NAME} keeps in your ` +
      `window (in an app from before that button, from the ${NAME} tab of their account on the site). What's kept where: their ` +
      `chats are saved on their computer (and their questions on the site as above); Settings › Private Chat backup downloads ` +
      `or restores them, and Delete in a chat's header removes one. With "Help improve ${NAME}'s answers" on (Settings › ` +
      `App & answers, on unless they untick it, or on the What ${NAME} keeps page), the site keeps their questions and ` +
      `your answers 14 days, without their name, so mistakes get fixed; unticked, nothing new is kept. When they let ` +
      `you see the game, the picture for a spoken question stays on their computer with that chat; the site doesn't ` +
      `keep it. Their voice becomes text on their computer. For a question about their computer, you're told its ` +
      `graphics card, processor and memory, nothing else. Feedback they send (Wrong answer, corrections) is kept 90 ` +
      `days without their name. Their account, and everything with it, can be deleted on their account page on the site.` },
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
  // LOR-623: "turn her off" got the add-on's folder to delete, twice, and she was still on screen.
  { id: "quit", own: /\b(?:turn|switch|shut) (?:willo|willow|her|the wisp|the companion) (?:off|down)\b|\b(?:get rid of|remove|uninstall|close|quit|disable) (?:willo|willow|the wisp|the companion|the app)\b|\buninstall\b|\bstill on (?:the |my )?screen\b/i,
    words: /\b(?:turn (?:you )?off|shut (?:you )?(?:off|down)|close|quit|exit|uninstall|remove|delete|disable|get rid of|go away|stop showing|still (?:on (?:the )?screen|there|here|showing))\b/i,
    text: () => `Hiding or closing you: you're your own app on their PC (${NAME}, with an icon in the tray by the ` +
      `clock), not part of the WoW add-on, so turning off or deleting the Lore Forever add-on never hides or removes ` +
      `you. To hide you over the game: in your window, Settings › ${NAME} › ${NAME} over the game › untick "Show ` +
      `${NAME} over the game". To close you for now: right-click your tray icon › Quit. To keep you from starting with ` +
      `Windows: untick "Start with Windows" in that tray menu. To remove you for good: Windows Settings › Apps › ` +
      `Installed apps › "${NAME} (Lore Forever companion)" › Uninstall. Give the one way they asked for; never game ` +
      `folders, files or the add-on list.` },
  // LOR-623: her window's own "Choose a character with a saved game account first." got "you don't need to pick one".
  { id: "character", own: /\b(?:choose|pick|select|switch)\b[^.?!]*\bcharacters?\b|\bsaved game account\b|\bno characters?\b/i,
    text: () => `Choosing a character: the row of characters at the top of your window is everyone the Lore Forever ` +
      `add-on has saved on this PC, and the chat answers for the one picked there. "Choose a character with a saved ` +
      `game account first" means the picked one has no save from the game yet: log in with that character in WoW with ` +
      `the Lore Forever add-on on, type /reload (or log out) once so the add-on saves, then pick them at the top of ` +
      `your window. No characters at all: Settings › Your game says whether the add-on is found.` },
  // Her color (LOR-552), a card only from COLOR_FROM on: "I want to change your color" got "I cannot change my color"
  // (Mike, 10/17). Only her own: "you" with a color word is often the world's ("can you tell me the color of ...?").
  // "Can I adjust your brightness?" (LOR-623) too: there's no brightness of its own, her color is it.
  { id: "color", from: "color", own: /\b(?:your|willo'?s?|the wisp'?s?) (?:own )?(?:colou?rs?|brightness|glow)\b|\b(?:make|turn) (?:you|willo|the wisp) (?:an? )?(?:\w+ )?(?:purple|pink|green|red|orange|yellow|gold|white|violet|blue|black|colou?r|brighter|dimmer|darker|lighter)\b/i,
    text: () => `Your color: in your window, Settings › ${NAME} › ${NAME}'s color: tap a swatch (your own blue, a ` +
      `class's color such as Warlock purple or Druid orange, Fel green, Holy gold, Shadow violet, Frost) or "A color of ` +
      `your own" for any color. It saves at once, on every plan, and you wear it over the game, in your window and on ` +
      `stream. There's no brightness setting: a lighter or darker color is how bright you glow (a very dark one is ` +
      `lifted a little so you still glow). When a character speaks through you, you take their colors for that line, ` +
      `then come back to yours.` },
  // "You respond very slowly. Is that something we can improve?" got "close other programs or lower your graphics"
  // (LOR-623, LOR-654): her answers come from the site, so the player's PC isn't why.
  // Only her: "do you know why I lag?" is about their PC, which looks online.
  { id: "speed", own: /\b(?:you|willo|your (?:answers?|replies|responses?|voice))\s+(?:\w+\s+){0,3}?(?:slow(?:ly|er)?|so long|takes? (?:a )?(?:long|while)|delay(?:ed)?)\b|\b(?:respond|reply|answer|talk|speak)(?:s|ing)? (?:a bit |a lot |much )?(?:more )?(?:quickly|faster|quicker|sooner)\b/i,
    text: () => `How fast you answer: most answers take two or three seconds; one you need to look something up for ` +
      `takes a few more, and so can the first one after a long quiet. It doesn't depend on their computer, its memory ` +
      `or the game's graphics settings, and no setting makes you faster. If answers often take much longer than that, ` +
      `"Something's wrong" in your window tells the people who made you.` },
  // Her notebook (lib/willo-notebook.js, LOR-661): what she writes in it and when, and its tab (the release after 0.21.0).
  // Pinned spots live in it too (lib/willo-pins.js, LOR-664).
  { id: "notebook", own: orElse(/\bnotebook\b|\bto-?do(?:s| list)?\b|\b(?:take|keep|make|write)(?: down)? (?:a )?notes?\b|\bchecklist\b|\bpin (?:a |this )?(?:spot|place)s?\b/i,
      FIND_NOTES, CLEAR_ALL),
    words: /\bremember (?:things|stuff|for me|places|spots)\b|\blists?\b|\bpins?\b/i,
    text: () => `Your notebook: you keep one for them, markdown pages of to-dos and notes, one for each ` +
      `character and one for all their characters. When they ask you to remember something, add it to their list, ` +
      `tick it off, change it or take it off, you write it there at once and say so in a line; you never write in it ` +
      `unasked, and "what's on my list?" you answer from it. ` +
      `Where it is: the Notebook tab in the bar at the top of your window, right next to Chat. It is never in Settings, ` +
      `and Settings has no Notes, so never send them there for it (if the tab isn't there yet, it comes with the next ` +
      `update). On it they read each page, tick the box beside a to-do, press Edit to change a page by hand (then Save ` +
      `or Cancel), press Undo for the last change, and Download notebook; their reminders show under Reminders, each ` +
      `with an × to cancel it. To remove lines, they ask you ("take the linen off my list") or press Edit on the page, ` +
      `delete the lines and press Save. There are no trash icons or delete buttons on single lines, and you can't clear ` +
      `the whole notebook yourself: never say you cleared, emptied or wiped it, or point at buttons that don't exist. ` +
      `Everything you keep, the notebook too, can be erased on the What ${NAME} keeps page (offer to open it). ` +
      `Asked whether you can keep notes or a list, say yes, how ` +
      `to ask ("remember…", "add … to my list") and where the Notebook tab is; you've written nothing until they ask. ` +
      `Pins live there too: "pin this spot" puts where they stand, with the day, under Pins on this character's page, ` +
      `when you know where they stand right now (a question from the add-on's Ask box, which also gives the spot on the ` +
      `map, or with Live game info on); they can ask "what pins do I have?", "where was that cave?", and rename or ` +
      `remove one. ` +
      `It's private to them, kept with their account so it's the same on every device, on every plan.` },
  // Her goals (lib/willo-goals.js, LOR-665): what she keeps and how, on Hero and up while plans are sold.
  // Only a question about what she does with goals: "set a goal: Tailoring 150" or "can you tell me my goals?" is one
  // for her goals themselves (THEIR GOALS), which her help would take the place of.
  { id: "goals", own: /\b(?:can|could|do|will|would)\s+you\b[^.?!]{0,20}\b(?:track|keep|follow|remember|plan|help\s+with)\b[^.?!]{0,20}\b(?:goals?|progress)\b|\bhow\s+do(?:es)?\s+(?:the\s+|my\s+)?goals?\s+work\b|\bgoal\s+check[- ]?ins?\b/i,
    text: ({ plans }) => `Your goals: tell you one ("I want my mount at 40", "Tailoring to 225", "Exalted with ` +
      `Ironforge", "save 200 gold") and you say what it takes with Forever's numbers and keep it under Goals in their ` +
      `notebook. As they play you know how it's going from what the add-on saves each /reload or log out, and their pace ` +
      `over their last evenings; after a save you cheer once when one's reached, and now and then say a short line ` +
      `when one moves (a level, a quarter of the gold, a new standing). "Stop telling me about my goals" turns those ` +
      `lines off. They change or drop a goal by telling you, or by hand in the Notebook tab. You only advise: you never ` +
      `do anything in the game.` + (plans ? ` Goals come with Hero and up.` : "") },
  // Her friends (LOR-674): "are any of my friends online?" with none added got "I cannot see your friends list… check
  // your social panel in the game" (QA 10/19), as if the Friends tab didn't exist. Their friends themselves are in the
  // FRIENDS section Willo's app writes (lib/friends-note.js); this says where they come from.
  { id: "friends", own: /\b(?:my|any|of my)\s+friends?\b[^.?!]{0,30}\b(?:online|on\s+now|playing|around|on\s+willo|up\s+to|doing)\b|\bwhere\s+(?:are|is)\s+my\s+friends?\b|\bfriends?\s+(?:list|tab)\b|\badd(?:ing)?\s+(?:a\s+|my\s+|some\s+)?friends?\b|\bhow\s+do\s+(?:i|we)\s+(?:make|get|find)\s+friends\b/i,
    text: () => `Your friends: other players they add in the Friends tab at the top of your window (next to Notebook), ` +
      `by their friend's profile name or the link their friend sent; the friend says yes first. For friends who share ` +
      `it, you know whether they're out in the world and where they were last seen (the FRIENDS section, when there is ` +
      `one). No FRIENDS section means they haven't ` +
      `added any friends to you yet: say so and how to add one. You can't see the game's own friends list.` },
  // "Can you open your settings?" got "I don't have settings or a menu to open" (Mike, 10/17).
  // Only hers ("Willo settings", "your settings"): the game's own settings are the player's world, looked up online.
  { id: "settings", own: /\b(?:your|willo'?s?|the app'?s?) (?:own )?(?:settings|options|preferences)\b/i,
    text: ({ card, color }) => `Your Settings: in your window, Settings in the bar at the top (over the game, ` +
      `right-click the wisp to open your window). Account comes first (your plan and profile), then Your game and Your ` +
      `pictures, then ${NAME}: ${card ? `${NAME} and the game, ` : ""}${NAME} over the game, ` +
      `${color ? `${NAME}'s color, ` : ""}Talk with ${NAME} (with your voice), Seeing the game and Live game info; ` +
      `then App & answers, Your saved history and Private Chat backup.` },
];
// A question to or about her: "you", "your", her name (as it's typed or heard), or the wisp.
const ABOUT_HER = /\b(?:you|your|yours|yourself|willo|willow|willa|wilo|wisp)\b/i;

// The WILLO HELP block for a question about Willo, or "". keeping: whether this question is kept for the nightly check
// ("Help improve Willo's answers", the companion's keep), so what she says she keeps is true right now (LOR-666).
// plans: the site sells plans (lib/billing.js plansOn); without
// them that topic is left out. plan: the name of the player's own plan (lib/billing.js planFor), so "how do I change
// your voice?" is answered for the plan they're on. client: the companion's X-LF-Client ("companion/0.19.0"): the
// "Willo and the game" card and the talk key's status line (LOR-529, LOR-527, #867) are only in CARD_FROM and later,
// and the Voices of Azeroth in her voice list only from lib/character-voices.js AZEROTH_FROM, and her color's card
// (Settings › Willo › Willo's color, LOR-552) only from COLOR_FROM.
const CARD_FROM = [0, 19, 0];
export const COLOR_FROM = [0, 21, 0];
const versionOf = client => (/^companion\/(\d+)\.(\d+)\.(\d+)/.exec(String(client || "")) || []).slice(1).map(Number);
const atLeast = (v, min) => v.length === 3 && (v[0] - min[0] || v[1] - min[1] || v[2] - min[2]) >= 0;
// Whether the companion asking (its X-LF-Client, "companion/0.21.0") is `min` ([0, 21, 0]) or later.
export const clientFrom = (client, min) => atLeast(versionOf(client), min);
// Whether it has her color's card.
export const hasColor = client => clientFrom(client, COLOR_FROM);
// client: the color topic only for a companion with its card (null: any, for telling what a question is about).
// A question about what she keeps, in the privacy topic's own words (not only its looser ones: "can you keep a list of
// my quests?" is the notebook's): her answer always offers What Willo keeps (lib/willo-tools.js keepsOffer).
// "What do you know about me?", "what do you remember of me?": she reads all of their notebook for it, to say what she
// keeps (functions/api/companion/answer.js), never only the lines that share a word with it.
export const asksWhatKept = question => /\bwhat (?:else )?(?:do|did|can|does) (?:you|willo) (?:know|remember|keep|have)\b[^.?!]*\b(?:about|of|on|for) me\b/i
  .test(String(question || "").replace(/’/g, "'"));
export const keepsAsked = question => TOPICS.find(t => t.id === "privacy").own.test(String(question || "").replace(/’/g, "'"));
// A question about what she keeps, in the privacy topic's own words, drops these when only their looser words matched
// (LOR-666): "forget everything you know about me" isn't a new chat, "delete the questions I asked" isn't quitting her.
const KEEPS_FIRST = ["chat", "quit"];
const topicsOf = (question, plans, client = null) => {
  const q = String(question || "").replace(/’/g, "'");
  const her = ABOUT_HER.test(q);
  const picked = TOPICS.filter(t => (t.id !== "plans" || plans) && (t.from !== "color" || client === null || hasColor(client))
    && (t.own?.test(q) || (her && t.words?.test(q) && !t.unless?.test(q))));
  const keeps = picked.some(t => t.id === "privacy" && t.own.test(q));
  return picked.filter(t => !(keeps && KEEPS_FIRST.includes(t.id) && !t.own?.test(q))).slice(0, MAX_TOPICS);
};
// The help topics a question is about (lib/willo-tools.js lookupsFor), by id; none for any other question.
export const helpTopics = (question, { plans = true, client = null } = {}) => topicsOf(question, plans, client).map(t => t.id);
// What a question about her asks, with a short follow-up to one ("it isn't there", "still on screen") read with the
// question before it, so it gets the same help (LOR-623: both got the add-on's folder to delete instead).
// A follow-up to a follow-up ("still on screen") goes by her last answer, which named her settings.
export function helpQuestion(question, previous = "", answered = "") {
  const q = String(question || "");
  if (topicsOf(q, true).length || q.split(/\s+/).filter(Boolean).length > 8) return q;
  const before = [String(previous || ""), String(answered || "").slice(0, 400)].find(t => t && topicsOf(t, true).length);
  return before ? `${before} ${q}` : q;
}

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
  const taste = usage.taste;
  return `- Their answers right now: ${usage.remaining.toLocaleString("en-US")} left ` +
    `${usage.period === "month" ? "this month" : "today"}${back ? `, more on ${back}` : ""}.\n` +
    // Their best first (lib/best-first.js): the Moonwell chorus sings with you, your finest voice, for their first ones.
    (taste?.left > 0 ? `- Of their first ${taste.of} answers at your best (the Moonwell chorus sings with you: your ` +
      `finest voice when they ask out loud${taste.why === "resting" ? "; the chorus is resting until tomorrow" : ""}), ` +
      `${taste.left} are left.\n` : "");
};

export function helpBlock(question, { plans = true, plan = "", client = "", state = "", usage = null, keeping = null } = {}) {
  const card = atLeast(versionOf(client), CARD_FROM), azeroth = hasAzeroth(client), color = hasColor(client);
  const target = /^key for the one you're targeting:/m.test(state);     // an app with that key (LOR-658)
  const topics = topicsOf(question, plans, client);
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
    topics.map(t => `- ${t.text({ card, azeroth, color, target, plans, keeping })}`).join("\n");
  const encoder = new TextEncoder();
  return encoder.encode(block).length <= HELP_MAX_BYTES ? block
    : new TextDecoder().decode(encoder.encode(block).slice(0, HELP_MAX_BYTES)).replace(/�$/, "");
}
