# Changelog

Player-facing notes, newest first. Add to **Unreleased** as you go; `scripts/release.sh` turns it into the new
version's section and publishes it to the website's Changelog tab, the GitHub release and the CurseForge file.
One `- ` bullet per change; wrap long bullets with an indented continuation line.

## Unreleased

## 0.7.0 (2026-10-03)

- **See which quests belong together:** a quest that's part of a storyline now says so under its Lore button, in
  the quest log and at the top of its story, like "Storyline · Westfall: The Defias Brotherhood". It covers quests
  up to level 40. When you turn one in, chat reminds you who to see next. Turn either off in Options › Show
  storylines on quests and Storyline hints in chat.
- **Your profile on loreforeverwow.com:** sign in with Google, then paste your journey record (Journey › Copy my
  journey record) to get a page about your character: your stats, the road you took, the bosses you beat, your
  favorite spec and your story. It stays private until you make it public; then share the link with friends.
  Downloading Lore Forever never needs an account.
- **Quest givers speak:** open a quest and the quest giver's words play aloud: what they ask of you, what they say
  while you're still at it and their thanks at the end. With the female narrator installed, women speak in her voice
  and men in his (Options › Match the quest giver's voice). Her pack covers about 450 quest lines so far, more with
  each update; the rest play in his voice. A page whose words have changed is read with the game's voice instead, as
  before.
- **No quest page voiced twice:** if you also run Forever Voiceover, VoiceOver (Forever or Continued), Chronicle,
  SpeakStone Forever or Chatty Little NPC, quest dialogue starts off, and so do books with Chronicle, SpeakStone and
  Chatty Little NPC, since they read those too. Narrations as you arrive stay on. A line in chat says so the first
  time. `/lore autoplay` or Options › Narrate quest dialogue turns quest dialogue back on, Options › Read books
  aloud does books, and your choice sticks.
- **The menu bar book button is gone:** open Lore Forever with your key, the minimap button or /lore. The floating
  player stops narration while the panel is closed.
- **The journey map shows what you've explored:** zones on the Journey page's map now look the way they do on your
  World Map, with every part you've discovered drawn in. Stormwind's harbor and streets, for one, were blank
  parchment before.
- **Translated labels fit:** in Deutsch, Português, Français and Español, the Library's and the queue's hints,
  the French Library tab, "Nothing playing" in the player and the Journey page's two buttons were cut off or ran
  past their edges. They now fit, and "Update my journey" no longer sits under the resize corner.
- **Corrected lore in 85 entries,** and removed 73 entries about places, people and rewards that don't belong
  in this era.

## 0.6.0 (2026-10-02)

- **Français and Español (España) come with the add-on:** they switch on by themselves on a French or
  Spanish game client, or pick one in Options › Language. English clients stay in English.
- **A new look:** the panel now wears the game's gold dialog frame over dark stone, with its name on a banner
  across the top and headings in the game's quest-title lettering. The buttons are dark with a gold rim, play
  buttons are round and gold, the tabs and your target's row are picked out in gold, and answers sit on their
  own gold-edged cards. Journey and History light up while they're open. The player, the queue, History, your
  journey and the report box all match.
- **The minimap button sits on the ring:** it was placed inside the map and could cover other add-ons' buttons.
  It now sits on the edge of the minimap like other add-ons' buttons, follows a bigger or square minimap, and you
  can drag it around the ring to any spot (it remembers where, per character).
- **Clickable names in answers:** the places, people, factions and events an answer mentions are links, and a line
  under the answer lists them again. Click one to read its story in the chat, Shift-click to add its narration to
  your playlist, or hover for a one-line summary. Back and Forward above the chat take you through what you
  followed. Quests you haven't picked up stay plain text, so nothing is spoiled. Works in Deutsch and Português
  too; turn it off in Options › Clickable names in answers.
- A hidden spoiler section in a story now has a **Show spoiler** link right there, and "Show spoilers without asking"
  shows those sections too.
- **Ask in your own words:** general lore questions worded differently from how the lore puts it now find the right
  answer about a third more often. Questions about where you are and what you're doing answer as before.
- **Put your voices in order:** Options › Narration voices lists every voice you have, with how many narrations
  each one plays. Use the arrows to choose which comes first, untick a voice to stop using it, and choose whether
  a story or a whole zone keeps one voice. `/lore voice` lists them in order.
- Options › Narration voices › **Prefer voices that suit the race** (off by default): when a voice says which races
  it suits, it reads their stories first, so orc lore can come in an orc voice.
- **A narration player:** the bottom left of the panel now has its own player, with what's playing, Back,
  Play/Pause, Next and your queue. Press Play with nothing queued to hear everything narrated where you are. Queue
  opens your playlist right above it, to reorder, remove or clear. Click the title to open the story in the chat;
  right-click the player for its options.
- **The player stays with you:** close the panel while something plays or is queued and a small copy of the player
  floats on screen. Drag it anywhere, or turn it off in Options › Floating player.
- **Fewer tabs:** the sidebar is down to Here and Library (the old Narrations tab, every recorded story by zone).
  The playlist moved into the player, and Journey is a button at the top of the panel next to History.
  `/lore library` opens the Library.
- The Journey, History and New chat buttons fit their German and Portuguese labels.
- **Search the long lists:** the Library, Your quests (when your log is longer than the list), the queue (once it
  holds more than a few), History and your journey each have a search box. Type part of a name, a zone or a quest
  and the list narrows as you type; capitals and accents don't matter, and with a language pack the English names
  work too. Escape or the × clears it.
- **The Here tab, tidied:** every row is one line, with a play button on the left of anything narrated (stories,
  answers, bosses, quests) and a + on the right to queue it. Stories show just their name, and Your quests shows how
  many are in your log.
- Playlist buttons always say what they'll do: once something is queued, Add to playlist becomes **Remove from
  playlist** (the + becomes a −), and while it plays, **Stop**.
- **Books read aloud:** open a book, letter or plaque and its page is read aloud with the game's voice when Read
  aloud is on. Turning the page reads the next one, closing it stops, and the Read aloud button on the book reads a
  page again. Options › Read books aloud turns it off; if you use Spoken, it starts off.
- **Tips at login:** for your first few logins, one short tip in chat about something Lore Forever can do, like
  reading an NPC's story with your key or turning off tooltip lore. Options › Tips at login turns them off.
- After you pick the panel key, Lore Forever suggests a second key for narration, handy on a controller.
- Options › Read aloud now says where to set its speed as well as its voice.
- **Several voices at once:** narrators can record just the zones or people they like, and you can install as
  many of their voices as you want. Each narration plays from the first voice that has it, and a story keeps one
  voice for its questions. A voice you install plays first; `/lore voice <name>` puts any voice first.
- **Your journey, on the map:** Journey now opens its own page over the chat: a timeline of what you did each play
  session, with filters for Quests, Fights and Milestones, and a map of the world beside it. Hover a moment and the
  map moves to where it happened, marks the spot and draws your road there as a dotted line; Whole journey zooms
  out to the continent. Quests lists every quest you've finished, including the ones from before you installed
  Lore Forever, and Chapters appears once your journey has some. Click anything with a story and the page closes
  and tells it in the chat. Update my journey and Copy my journey record are at the bottom; `/lore journey` opens
  it too. Places are marked from today on; earlier moments show their zone.
- **Welcome back:** the first chat after you log in sums up your last play session: where you went, the quests you
  finished and the people you met, plus a new chapter of your journey if one is waiting (Listen plays it).
- Corrected lore in 99 entries and removed 2 that belonged to later expansions.
- **Every narration comes with the add-on:** the places and people of every zone, Alliance and Horde alike, are now
  in the main download (CurseForge, the installer and the zip), so there are no lands packs to fetch. If you
  installed one by hand, the update simply replaces it. The female narrator is still an optional download at
  loreforeverwow.com/downloads.
- **Deutsch and Português (Brasil) come with the add-on:** they switch on by themselves on a German or Brazilian
  Portuguese game client, or pick one in Options › Language. English clients stay in English.
- **Bigger text:** Options › Panel size makes the whole Lore Forever panel bigger or smaller (90% to 130%), text and
  buttons alike.
- The panel now opens where you left it, at the size you left it.
- Easier to read: notes, hints and option descriptions are a lighter grey, and the Here tab says what to do when
  your quest log is empty.
- The answer check and cross are easier to click, the resize corner says what it does, and the Listen and Queue all
  buttons fit their German and Portuguese labels.
- **Narrations play as you arrive:** reach a zone or place with a narration and it plays by itself, the zone's
  story first and then the place's. It waits until a fight is over, stays quiet on flights and never cuts off
  something you're already listening to. Options › Play narrations as you arrive turns it off, and `/lore autoplay`
  turns this and quest dialogue off or on together. If you use the Spoken add-ons, both start off so you don't hear
  two voices.
- **Quest dialogue, narrated:** when a quest giver's window opens, its narration plays, or the quest text is read
  aloud if Read aloud is on. It stops when you close the window. Options › Narrate quest dialogue turns it off.
- **Lore Forever remembers what you've heard:** each character keeps track of the narrations and quest text it has
  heard, so nothing plays by itself twice. The Library ticks the ones you've heard, and you can still play
  any of them again. Options › Reset heard narrations starts over.
- **Missing voice packs are no longer silent:** if the voice you picked isn't installed any more (the female
  narrator is a separate download, and a CurseForge update only brings the main one), the add-on says so at login
  and where to get it again: loreforeverwow.com/downloads. Options › Narration voice now lists every voice pack the
  game found and how many narrations each plays, or why it can't.
- The note under an answer about your race or faction now reads "For Undead players" or "For Night Elf players"
  instead of "For you as a Undead".
- **Read aloud on Mac and Linux:** when your system has no text-to-speech voices, Read aloud now says so once
  instead of staying silent. Recorded narrations play either way.
- Narrations that play as you arrive wait while you talk to a quest giver, and play once you're done.
- The welcome card and the example in the question box follow you as you travel, instead of staying on the
  place where you first opened the panel.
- The Here tab lists your quests in the zone you're in first, so a full quest log no longer pushes them off
  the list.
- **Boss stories after the fight:** beat a dungeon boss and chat links their story (and Listen, when it's
  narrated). Options › Dungeon primer prompt turns it off along with the primer link.

## 0.5.0 (2026-10-01)

- **Your journey:** the new Journey tab keeps track of what your character has done: the places you discover and how
  you got there, the people you meet, the quests you finish, the foes and dungeon bosses you defeat and the books you
  read. It shows your recent moments, the bosses you've beaten and the foes you've fought most. It stays on your PC;
  Options › Remember my journey turns it off. `/lore journey` opens it. You can copy and paste your journey record:
  "Copy my journey record" on the Journey tab gives you all of it as plain text.
- **Your journey remembers more:** reputation changes, new mounts and spells, rare finds and quest rewards,
  profession milestones (75, 150, 225 and 300), rare foes and your screenshots now show among your recent moments.
  It also notes where you've walked on the map in your last five sessions. Like the rest of your journey, it stays
  on your PC.
- **Hundreds more narrations, in both voices:** 25 new zone stories come with the add-on. The places and people of
  the capitals, the starting zones, the level 10-19 zones and some of the level 20s are narrated in two optional
  packs, Alliance lands and Horde lands, at loreforeverwow.com/voices or in the complete download. When you enter a
  zone whose narrations you don't have, the add-on says once which pack has them (Options › Narration pack hints
  turns that off).
- **The female narrator comes with every release** now: her core and lands packs are at loreforeverwow.com/voices
  and on the GitHub release.
- Narrations now say Deadmines, Feralas, Astranaar, Razorfen Kraul, Faol, Quel'Thalas and Iceshard properly.
- The Narrations tab groups narrations by zone, with where you are and your starting zone first.
- **Translators can see their work in game right away:** on loreforeverwow.com/translate/dashboard, press
  "Download my test pack", unzip it into Interface\AddOns and pick your language in Options. Your saved lines show
  in game on top of the language pack (or on their own) before the next language update.
- **Tell us when an answer is wrong:** every answer now has a check and a cross under it. The cross asks what was
  wrong (wrong, didn't answer your question, a spoiler, later-expansion lore, or something else) with an optional
  note, and "Copy report" gives you a link to paste into your browser or our Discord. It sends your question, where
  you were and the answer you got, never your character's name. `/lore report` does the same for the last answer.
- Options › Language now says where to get language packs: loreforeverwow.com/translate, the same way the
  narration voices point to loreforeverwow.com/voices.
- Corrected lore in 126 entries and removed 11 that belonged to later expansions.
- Places that share a name, like the Canals of Stormwind and of the Undercity: asking about one now answers about
  the one in the zone you name, or else the one in the zone you're in.
- Narrators: the upload page (loreforeverwow.com/voices/studio) now has "Download my test pack", so you can hear
  your own recordings in game before you send them.
- **Upload a whole zip or folder:** narrators can drop all their recordings at once on the upload page, and
  translators who work offline can drop their edited kit on the translation dashboard. You see what's new, what
  changes and what can't be used before anything is saved, and it's in your test pack right away. No more sharing
  a Drive link (that still works if you prefer it).
- **Answers know your journey:** the story of a quest you've finished, someone you've met or a place you've been
  now opens with a line like "You finished this at level 12, 3 days ago, in a group." A quest's own twists show
  without the spoiler warning once you've finished it, and the people you met this session and the quests you've
  done in the zone come up first. Turning off Remember my journey in Options turns this off too.

## 0.4.0 (2026-09-30)

- Corrected 275 lore entries: wrong names, races and places, zone details from the wrong era, and story twists
  that now stay behind the spoiler button.

- **Dungeon bosses, one click away:** target a boss and click the book or minimap button (or press your Lore key)
  and Lore Forever opens on that boss's story. Inside a dungeon, the Here tab lists its bosses in the order you
  meet them, with play, + and "Queue all", and the dungeon primer's "Who you'll face" names are now clickable.
  A boss's ending stays behind the spoiler button.
- **Every dungeon boss is narrated (52 in all):** hear who they are and why they're there, from the Deadmines to the
  Scarlet Monastery, spoiler-free. Find them in the Here tab inside a dungeon, or under each dungeon in the
  Narrations tab. The female narrator (version 1.1.1 on the Voices page) reads them too.
- Baron Aquanis and Bazil Thredd now have stories of their own, so asking about them no longer answers with
  the quest about them.
- The narrator now says Lordaeron and Gnomeregan the way players do.
- **Narration playlist:** press the green + on any narration in the Narrations tab (or "Add to playlist" on a
  narrated answer) to queue it. The new Playlist tab shows what's playing and what's next, and lets you reorder,
  remove or clear it all. Narrations play one after another with Prev, Pause and Next in the Now playing bar. Playing
  something else pauses the playlist. New key bindings: "Play/pause narration playlist" and "Next narration".
- **Flight narration no longer cuts itself off:** each zone's story joins your playlist, so flying over several
  zones quickly plays them one after another instead of dropping the one that was playing.
- **Book and minimap buttons:** click opens Lore Forever and right-click opens (or closes) its options, as
  before. New: Shift-click plays or pauses your playlist, and Shift-right-click skips to the next narration.
  With an empty playlist, Shift-click (or the play/pause key) plays everything narrated where you are.
  The book glows and the minimap button's ring turns green while something plays, and the tooltip says what's
  playing.
- The minimap button is now on by default (it's turned on once after this update; switch it off in Options).
- Pressing your Lore key while hovering someone with lore now always opens their story. Before, it only worked
  for a couple of seconds after the tooltip appeared, and not at all with tooltip lore turned off.
- The Lore Forever window can be resized narrower (down to 600 pixels wide).
- `/lore help` now ends with where to ask questions, request lore and report bugs: loreforeverwow.com/discord
- Item tooltips no longer add "Useful for your Tailoring" and similar notes to crafting materials. Notes for
  quest items stay.
- **Ask the obvious:** "how did I get here?", "what am I doing here?", "why does he want me to do this?" and
  "what is this for?" now answer from where you are, who you've targeted and what's in your quest log and bags.
  Everywhere up to level 30: every starting area, zone, city and dungeon.
- **Ask about what's in front of you:** target a gnoll and ask "who leads them?" or "why are they attacking me?";
  target a person and ask "whose side is he on?"; stand in Moonbrook and ask "what happened here?"; or ask about
  yourself: "why can I use the Light?", "tell me about my people", "why do we fight the Alliance?".
- Lore for about 760 quest items (Gold Dust, Tough Wolf Meat, Minshina's Skull and more) and for every class.
- Suggested questions lead with those, and no longer offer gameplay filler like "where are the wolves located?".
- New lore for the first quests of the Valley of Trials (Cutting Teeth, Sarkoth, Lazy Peons and more), Shadowglen,
  Deathknell, Coldridge Valley and Northshire.
- **Female narrator:** a second narrator reads all 204 narrations: every zone story and answer, and the dungeon
  bosses. She's an optional download: https://loreforeverwow.com/voices. Unzip her into AddOns, restart the game,
  then pick her in Options > AddOns > Lore Forever > Narration voice.

## 0.3.0 (2026-09-29)

- **New narrators:** every zone story and answer (152 in all) has a new narrator, with clearer pronunciation of
  Warcraft names like Teldrassil, Lordaeron and Gnomeregan.
- **Choose your narrator:** Options > AddOns > Lore Forever > Narration voice lists the narration voices you
  have installed.
- **Community voice packs:** players can record the stories and share them as a voice pack. Anything a pack
  doesn't cover plays with the default narrator. Installing a voice and lending yours:
  https://loreforeverwow.com/voices
- **Installing by hand?** Narration now lives in its own folder, LoreForever_Voice_Default, included in the zip.
  Copy both folders into AddOns, then restart the game (not just /reload) the first time. An old
  LoreForever\Audio folder can be deleted.
- Corrected the text of a few narrated stories, and the narration now matches it.
- Options page fixes: drop-down lists have a proper background, and longer text no longer overlaps the next row.
- Fixed a few garbled search phrases for Sister Aquinne in Darnassus.
- The druid quest "Moonglade" now links to Mathrengyl Bearwalker correctly.

## 0.2.2 (2026-09-29)

- Lore accuracy pass: about 560 entries corrected, including wrong names, races, places and quest givers,
  and details that belong to later expansions.
- Removed about 260 entries for places, people and quests that don't exist yet in WoW Forever's timeline.
- More story twists now stay behind the spoiler prompt.

## 0.2.1 (2026-09-28)

- The Windows installer now lists its publisher as Mei Liu, matching its code signature. The add-on itself is
  unchanged.

## 0.2.0 (2026-09-28)

- Every zone, city and dungeon up to level 30, including Zephras Isle, the Hall of Thanes and the
  Ruins of Lordaeron. About 3,460 entries. Place lore for the rest of the world.
- Lore on NPC, mob and item tooltips. Lore button on quests. Pick-a-key prompt on first login;
  press it over an NPC to read about them.
- Dungeon primers.
- Type-ahead questions, "Ask next" follow-ups, typo-friendly names and "Did you mean...".
- Listen button and flight narration.
- Sticks to Forever's timeline.

## 0.1.0

- First release: Elwynn Forest, Westfall and the Deadmines, 337 lore entries.
