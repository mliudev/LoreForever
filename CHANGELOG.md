# Changelog

Player-facing notes, newest first. Add to **Unreleased** as you go; `scripts/release.sh` turns it into the new
version's section and publishes it to the website's Changelog tab, the GitHub release and the CurseForge file.
One `- ` bullet per change; wrap long bullets with an indented continuation line.

## Unreleased

## 0.13.0 (2026-10-09)

- **More complete stories:** 68 more lore entries play their whole story in the male narrator's voice (161 in all).

- Corrected lore in 207 entries

- **Release downloads:** large optional packs stage while the Windows installer builds; publication verifies every file before making the complete release available. Unchanged CurseForge narration keeps its existing download.

- Added shared dialogue from Lahu, including the Bellygrub quest progress text.

- **Conversations that remember:** live replies use earlier messages in the same chat. Start a new chat, reopen, rename or delete saved chats, and pick up drafts where you left them. Long chats keep their full transcript while older messages are summarized for replies.

- **Ukrainian, fully translated and narrated:** Pekelnyj / UALL's full Ukrainian translation now covers every lore
  entry (a few lines whose English changed this week stay English for now). Their Ukrainian narration download adds
  793 recordings, 684 stories and 109 answers, and includes the text pack. A recording whose text has changed since
  stays off, and that entry stays readable.
- **No more boxes in Cyrillic:** the dot between parts of a line shows properly when reading Ukrainian or Russian.
- **Your level in your language:** the panel header's "Level 60 Human Warrior" line now uses your language pack.
- **Meet Sam the Squire:** Harold has a new name and title throughout the companion, chat, and profile signatures.

- **Sam helps with the adventure:** ask about profession quests, rewards, recipes, vendors and directions as well as lore. Web research checks WoW Forever details, links its sources, and makes missing or Classic-only information clear.

- **Journeys and pictures that stay together:** automatic profile sync works across installed languages, and pictures sit beside the nearest dated moment for their character. Options explains Print Screen, journey pictures, and the separate text contribution control.

- Reloading or logging out stops narration and keeps playback paused at your saved place.
- **Shift-click plays and pauses:** Shift-click on the minimap button pauses what's playing, and the next Shift-click picks it up where you left off, even a story you started from the Library. Only with nothing paused and an empty playlist does it play the stories around you, and a story you've heard most of isn't picked up again.
- Right-click opens Options directly, with the narration preference kept there.
- Ctrl+C in the question field prepares live answers for the companion while keeping your draft; clicking its copy box keeps the payload selected.
- **Contributor answers:** answer-only recordings stay in the Library with their numbered labels, without appearing as questions or typing examples.

- **Readable narrated stories:** playing an entry keeps its section headings, lore links, and spoiler controls, including Stormwind City.
- **Dalaran lore:** describes the city's reconstruction in the present without out-of-world references to Forever.

## 0.12.0 (2026-10-08)

- **Herald Player controls:** the recording library opens and switches entries faster. Volume and mute controls remember your choice when Herald reopens, and live answers use the lowest-cost default.
- **Densuad's Spanish edition:** choose contributed Spanish text and narration together in Language options. One optional download contains both matching components; missing contributed stories stay hidden, and valid text without narration stays readable.
- **Ukrainian community pack:** UALL / Pekelnyj's translations add the full interface and 882 current lore entries, with a Ukrainian translation dashboard and separate language download. Entries whose English changed keep their English text while awaiting an update. Ukrainian headings and searches support і, ї, є and ґ.

- Russian translations from Ilia Reutov are available in the translation dashboard.

- **Your complete story:** 250 completed English recordings read all their safe story sections, with matching read-along text and continuous playback. Stormwind and Westfall are available in both narrators; other recordings continue to arrive as they are ready.
- **More male quest answers:** expanded optional English male quest-answer packs cover more early quests.
- **Live answers in text:** Herald's live answers appear in Chat without generated speech. Recorded lore keeps its Player controls.

- **Pictures beside your journey:** website timeline pictures enlarge on hover or keyboard focus and open on click or tap. Pictures stay attached to their exact character and saved moment.
- **Smoother Herald controls:** keyboard seeking keeps focus, and Chat explains how to connect your profile or add a key when setup is incomplete.
- **Quiet stories:** stories without narration remain readable without repeated recording notices.
- **Lore corrections:** corrected lore in 167 entries and removed unsupported later-era identities.
- **More translated lore:** refreshed German, Portuguese, French and Spanish text, and incorporated community corrections and Italian translations. Entries still awaiting a current translation retain English text.

## 0.11.0 (2026-10-07)

- **All your installed packs:** Options now lists every voice, language and playback support pack, with separate
  counts for lore, quest dialogue and answers. Narrator totals count each recording once, even when two packs share it.
  Playback support no longer causes a false failed add-on check.
- **More quest answers:** expanded English female answer packs and the first 522 English male quest answers are
  available as optional downloads. Both English narrators also gain the missing dialogue for Prehistoric Prism
  and Understanding Our Present. Unrecorded answers remain readable text.
- **From translation to recording:** each studio script links to its English original and matching translation
  editor, with clearer saved, checked and recording states and guidance on game names.
- **Lore Player in Herald:** browse published English recordings, read their matching text, and listen with pause,
  seeking, saved position and speeds from 1x to 2x. It streams the website's original files without game voice packs.
  Recorded overviews, answers and quest dialogue are labelled clearly; quest outcomes stay hidden until completed or revealed.
- **Herald beside your game:** the Windows companion opens as its own app, with a visible chat and a separate
  Settings page for your game, profile and sync. Questions copied from the add-on appear in chat; saved add-on
  conversations arrive after `/reload` or logout. Failed live questions stay available to retry.
- **Pictures with their moments:** the companion timeline shows matching screenshot thumbnails that enlarge on
  hover or keyboard focus.
- Hidden spoiler answers stay silent, including queued narration and resumed playback, until their text is revealed or unlocked.
- The minimap button stays on the edge of square and reshaped minimaps, including at the corners.
- Update notes remain visible when automatic narration starts before you first open the lore panel.
- Corrected lore in 201 entries
- **Your journey and story together:** Sync now refreshes your profile story from the latest saved journey when an
  update is available within your story allowance. Overlapping syncs retry without losing newer journey data.
- **The right creature lore:** Bluegill and Mosshide warriors no longer open the Warrior class story, and crocolisks
  no longer open Dragonmaw lore just because those words appear in a search match.
- **Read along as you listen:** a narration that starts opens its matching text without replacing a history or
  Journey page you are browsing. Landing stories respect what your character has already heard.
- **Quest controls stay useful:** Reclaiming Goods keeps its Lore button even without a dedicated lore entry,
  showing the quest's text and nearby story. Quest Play continues to read the quest's own words.
- Narration plays continuously with Stop and Restart controls. Recorded story text keeps its paragraph breaks.

## 0.10.0 (2026-10-06)

- **A companion for your adventure:** Setup.exe can now install the optional Windows companion. It keeps your
  profile up to date after `/reload` or logout and gives short live answers over the game when you ask with
  `/lore ask` and Ctrl+C. Connect your account for up to 20 free answers a day while the shared monthly budget
  lasts, or add your own key for more.
- **More answers to listen to:** the optional English female packs now include 8,376 recordings about people, places,
  lore and early quests, with each question before its answer.
- **Quest dialogue when you want it:** Speak quest dialogue is off by default in `/lore options`. Its voice packs
  are separate downloads; stories and lore answers keep playing as before.
- **NPC tooltips:** wild nightsabers no longer show unrelated Sentinel lore.
- **Clearer downloads:** a simple table helps you find a voice in your language, with recording counts and download
  sizes clearly labelled. The main add-on includes English male narration; other language and voice downloads include
  their translated text, with any separate files listed together in the download details.
- Corrected lore in 150 entries

- **Spanish lore:** restores community wording in 27 entries that had fallen back to English after lore corrections.
- **A clearer companion:** game detection, profile updates and your picture book are together on the main page.
  Profiles and pictures work without a live answers key. Interrupted profile updates retry by themselves, and
  Sync now checks your saved journey whenever you need it.
- **Pictures you can follow:** the companion shows when a picture is waiting for a game save, uploading, retrying
  or on your profile. Matching waits when a picture's journey moment is uncertain, and pausing or disconnecting
  stops further uploads. Taking a picture off your profile still works when its picture book is full.
- **Clearer Journey status:** a new picture that needs another reload shows guidance instead of a blank image.
  Chapter dates now belong to the character you are viewing.

## 0.9.0 (2026-10-05)

- **Quest givers in their own voices:** the first optional pack adds 1,526 recorded lines for male human,
  dwarf, Forsaken and orc quest givers. It covers part of their dialogue; other lines use your narrator's recording
  where available, or stay as text.
- **Spanish questions and answers:** both Spanish narrator packs now read 109 questions before their answers,
  with a short pause between them. They also include selected stories; entries without a recording stay as text.
- **Play the quest's words:** the map's quest log now has a Play button beside Lore for recorded quest text.
  Listen on a lore answer plays that answer's recording; answers without one stay as text. Quest windows also play
  only recordings of the page they show, and quest dialogue still goes in your playlist.
- **French questions and answers:** both narrators now read the question before the answer in their French FAQ
  recordings.
- **More answers to listen to:** a new optional female voice pack reads 641 answers about zones and places,
  with each question followed by its answer. Answers without a recording still appear as text.
- **Lore corrections:** 134 entries now use the right Classic and Forever people, places and quest history, with
  quest twists kept behind spoilers. Removed 12 later-era locations from the lore library.
- **Clearer place names:** both narrators now pronounce Redridge and Stonetalon consistently in zone stories,
  places, people and quest dialogue.
- **Voice volume:** set how loud the narrators and quest dialogue are with Options > Narration voices > Voice volume.
  It's the game's own Dialog volume, so NPC voices follow it too.
- **Play voices on any sound channel:** Options > Narration voices > Play voices on lets the narrators and quest
  dialogue play on the game's Effects, Music, Ambience or Master Volume instead of Dialog. Voice volume then sets that
  channel's volume, so you can balance the voices against NPC chatter, the music or the world around you.
- **Quest text stays clear:** a quest's storyline is now part of its text, in full right under its title, like
  "Storyline · Tirisfal Glades: At War With The Scarlet Crusade", in the quest window and the map's quest log alike.
  It scrolls with the text, so nothing covers or cuts it. The quest window's Lore and play buttons sit in the dark band
  under its title, off the first line of the quest's text, and in the map's quest log the Lore button (hidden behind
  the map's title bar until now) sits on the bar with Back.
- **Fix:** the story of a zone or place you arrive in no longer starts over when you come back, even if a quest giver
  or a cutscene cut it off: it plays by itself once per character. Listen, the Narrate key and your playlist still
  play it whenever you like.
- **Only our recorded voices:** Lore Forever now reads aloud only with its own recorded voices, and your game's robot
  voice is gone. Anything nobody has recorded yet (most chat answers, books, a few quest pages) stays as text, with no
  button to read it out. If you played with Game voice only, tick a voice in Options to hear the narrators. The
  welcome back at login is never read out, and starting a new chat no longer stops the story that's playing.
- **More of your story in numbers:** Lore Forever now also keeps how you traveled (on foot, riding, swimming,
  flying and by boat), the quest givers you've done the most for, the inns you've called home, where you've spent your
  time, the fish you've caught, the days you've played and your longest run of days in a row, what killed you
  (including the sea), and how long your story's lore would take to read aloud. Hover the Journey page's stats line
  for them, with a moment from a week, a month or a year ago today. Your page on loreforeverwow.com shows them too,
  with your nemesis, the famous figures you've met and "on this day".
- **Your road on a chart:** your profile now opens on your trek, as a Map and a Timeline right under your name. The
  map draws the lands you've reached on our own chart of Kalimdor and the Eastern Kingdoms, with the road between
  them in the order you travelled; zoom, drag, and pick a land to see your moments there. Share a link that opens
  straight on either one (Copy map link, Copy timeline link).
  With the companion app connected, flights, boats and hearthstones show dashed, every quest you took links to where
  you turned it in, and each moment shows on your own day.
- **Look it up on Wowhead:** every moment on your profile now links what it names on Wowhead's WoW Forever
  database (the quest, the person or boss, the zone), or the Warcraft Wiki when Wowhead has no page for it.
- **Hear the lore on the website:** every narration Lore Forever ships has its own page at loreforeverwow.com/lore,
  with a player for each voice, the text to read along and where the story comes from. Moments on your profile page
  link to them.
- **Hear your story:** a story written for your character's profile can now be read aloud by our campfire narrator.
  Choose Listen and follow the highlighted paragraphs as it plays.
- **Arrival stories in step with you:** the story of a zone or place you arrive in now waits for the story that's
  playing to finish, as it already did for a fight or a quest giver, instead of being skipped. If you've moved on by
  then, or more than a minute and a half has passed since you arrived, it's left for another time, so it never plays
  minutes late. Landing from a flight now counts as arriving, so the zone's story plays as you land instead of at the
  next zone line, and a story a quest giver interrupts starts over only once. Shift-clicking the minimap book with an
  empty playlist no longer stops the story you're listening to: everything else narrated where you are queues after
  it.
- **Quests in your playlist:** Shift-click a quest to queue it, as you would a place's story: its Lore button in the
  quest log or the quest window, a quest on the Journey page (Completed too) or under Your quests, or the player while
  a quest giver talks. A quest's story in the chat now has Add to playlist too. You hear what the quest giver said when
  they gave you the quest and, once you've handed it in, what they said then; a quest with no recording yet says so.
- **Fix:** an item you take from your mailbox, buy from a vendor, get in a trade or take out of the bank no longer
  shows up on your Journey page as a find where you picked it up. Drops and quest rewards still count.
- **Quest givers finish their sentences:** every recorded quest giver's line used to stop a little early, cutting off
  its last few words. They now play to the end, in both narrators' voices.
- **Cutting Teeth tells its own story:** its page at loreforeverwow.com/lore showed Hemet Nesingwary's, which was
  filed under the wrong quest. That story now belongs to Kravel Koalbeard's delivery to Hemet, in the add-on too, and
  the other first quests in the Valley of Trials now show their stories on their pages.
- **Voice packs on CurseForge:** add the female narrator, male or female quest dialogue, and male or female
  narration in German and Portuguese (Brasil) as separate CurseForge packs. The Downloads page links to them.

## 0.8.0 (2026-10-04)

- **Your journey in numbers:** Lore Forever now counts the steps you walk in each land, the foes you've slain (by
  kind, and the elites and rares among them), your deaths and your time played. The Journey page's stats line shows
  your steps; hover it for the rest, and click it to switch distances between miles and kilometres. Your journey
  record carries them too, and your page on loreforeverwow.com shows them as "The journey in numbers", with lines like
  "That's the road from Goldshire to Booty Bay 3 times over" and a miles/kilometres switch. Type `/played` once to add
  your time played. Steps count from this update on.
- **Your profile, moment by moment:** your page on loreforeverwow.com now tells your journey as it happened, newest
  first: places reached, quests finished, people met, bosses beaten, finds, deaths and more, with filters. Follow a
  trail from any moment: a finished quest leads back to meeting whoever gave it and on through your other chapters
  of its storyline, "Last time here" takes you to your previous visit, a quest reward to its quest, and a death to
  the foe you beat later. Update your profile (paste your record again, or let the companion app do it) to see it.
- **A better journey map:** your road now follows where you actually walked, as a smooth line that fades with age,
  dashed where you flew, hearthed or were away. Moments are round beads in their filter's colour, the one you're
  looking at glows and pulses softly instead of blinking, and moments too close together share one bead with a count.
  Zoom in with the mouse wheel or + and - (drag to look around), step through your moments with the arrows under the
  map, and Bigger map opens it large over the panel, with the filters (Esc closes it). Hover a bead to see what
  happened and when; a quest you finished shows where you took it.
- **Every moment opens its story:** clicking a moment on the Journey page or the map opens its lore: the quest, the
  person, the foe (or the story of its kind), the book or item, the faction, where you set your hearthstone or flew
  to, and otherwise the place it happened. Shift-click adds its narration to your playlist. The moment the map shows
  is marked in the list.
- **Narration: only when I press Play:** a new switch in Options and in the minimap book's right-click menu (or
  `/lore ondemand`) turns off everything that plays by itself, from arriving somewhere and flights to quest givers
  and books, for players who want narration only when they ask. Play, Listen, the Narrate key and your playlist still
  work, and your other narration options stay as you set them. Lore Forever also no longer talks over the game's own
  cinematics: nothing starts by itself during one, and what started by itself stops when one begins.
- **Reset windows:** lost the floating player, the panel or the minimap button? Options › Reset windows (or
  `/lore reset`) puts them all back where they started and shows them again; your journey and settings stay.
  Reinstalling never did this, since the game keeps your settings. Windows saved off the screen now come back onto it
  at login, and turning the floating player off from its right-click menu says how to get it back.
- **Fix:** on a German, French, Spanish or Portuguese game client, Lore Forever shows your language, and the English
  narrators then stayed silent without saying why. Lore Forever now tells you in chat and in Options that your
  voices are recorded in English, and that choosing English in Options › Language brings them back. The default
  voice no longer shows as "Not installed" there, and Sample says why it can't play instead of "Nothing to preview".
- **Every quest you've completed, and its text again:** the Journey page has a Completed list (or type
  `/lore quests`): every quest your character has finished, newest first and grouped by zone, even the ones done
  before you installed Lore Forever. Click one to read its quest text again, just as the quest giver told it, then
  its story. Quests from before Lore Forever was installed show their story alone.
- **Fix:** a place that shares its name with one in another zone now shows your zone's story: the Undercity's Canals
  no longer pop up Stormwind's.
- **Share the Forever quests you find:** Lore Forever keeps the quest, gossip and book text Forever shows you, and
  what NPCs call out, so you can drop your LoreForever.lua at loreforeverwow.com/contribute and those stories go into
  a coming update for every player. Your character's name never leaves your PC. Tick Options › Contribute buttons
  (off for now) for a small note button on quest, gossip and book windows Lore Forever doesn't know yet, which gives
  you a link to share just that page. Options › Keep the quest text you see turns keeping it off, and Mark all as sent
  starts your next upload fresh.
- **Narration plays with the game's Dialog sound off:** recorded narrations used to stay silent (or fall back to the
  game's text-to-speech) when System › Sound › Dialog was unticked; they now play anyway. With all game sound off,
  Lore Forever says so in chat and in Options instead of staying silent, and a recording that can't be found is named
  in chat.
- **Read aloud fits its label:** the book window's Read aloud button grows to fit its text, which ran past the button
  in French.
- **Tell us when a narration sounds wrong:** right-click the narration player and pick Report a problem with this
  narration: a name said wrong (type how it should sound), the wrong voice, cut off or garbled, a stage direction read
  out loud. Copy the link, open it in your browser and press Send report, no sign-in needed. Once two players report a
  narration it's recorded again, and the right sound for a name fixes every narration that says it. Options › Show
  the report button on the narration player adds a small cross to the player for it. The player's right-click menu
  also opens on the first click now.

- **Quest givers speak every time you ask:** a quest giver's words play each time you open their quest, not only the
  first time, even with Options › Skip what you've heard on (it now covers narrations and books). With it off, books
  read aloud again each time you open them.
- **Stop a quest giver mid-sentence:** their words show in the player like any narration, with Stop, and clicking
  the title opens the quest's story. The floating player no longer hides under the quest window: while the window
  would cover it, it waits beside it and goes back when the quest closes.
- **Hear a quest giver again:** a round play button beside the quest window's Lore button plays what they say on
  that page again, or stops it. It works with Options › Narrate quest dialogue off too.
- **Quest givers aren't drowned out by arrivals:** if a place's story started by itself as you walked up, the quest
  giver's words now take over, and the story plays again once you close their window. Before, a quest you opened
  again could stay silent while the story played.
- **A quest's story plays the quest giver's voice:** Listen on a quest's story (its Lore button) now plays the
  recorded quest giver instead of reading the quest with the game's voice. Quests nobody has recorded yet, or whose
  words Forever changed, still use Read aloud, and hovering Read aloud now says it's your game's text-to-speech
  voice. With Options › Match the quest giver's voice, a woman's words play in the female narrator's voice (where
  she's recorded them) even when you open the story from your quest log, away from the quest window.
- **What's new, right in game:** after an update, the first login says in one chat line what the new version brings,
  with a link, and the panel opens once on a card with the headline changes. Everything new in it is one click away,
  and the card closes with its ×. Options and pages that changed wear a green "New" until you've looked at them.
  Nothing comes back once seen, and Options › Tips at login turns the line off too.
- **Your journey on loreforeverwow.com:** the Journey page now leads to your page on the website, just above its
  buttons. Copy your journey record and paste it at loreforeverwow.com/account; chat tells you what the page will
  show, like "12 quests done, 2 bosses and the road you took".
- **loreforeverwow.com is easier to get around:** Download, What's new and Community sit at the top of every page,
  with Make your profile on the right, and the changelog has its own page, What's new.
- **Everyone who helps, on one page:** loreforeverwow.com/contributors (Community › Contributors) now thanks the
  translators next to the narrators, with what each of them added, in alphabetical order. Your profile page shows a
  small Narrator or Translator badge once your work is in.
- **Princess Must Die! and Protect Kanati Greycloud find their stories:** both were filed under the wrong quest, so
  their Lore button and recorded quest giver turned up on Patrol Schedules and Assassination Plot instead.
  Assassination Plot, the note that warns Kanati of the centaur ambush, now has a story of its own.
- **Running Chronicle too?** It also answers to /lore, so /lore opens only one of the two. Lore Forever now answers
  to /loreforever as well as /lf, and the first login with Chronicle says in chat which command opens which.
- **Your language, said up front:** on a German, Spanish, French or Brazilian Portuguese game client, the first login
  now says in chat that Lore Forever follows your client's language, and how to pick another (`/lore lang`, or
  Options › Language). `/lore help` names all five languages.
- **Thank you, translators!** German and Spanish players reworked about 250 lines of Lore Forever's stories and menus
  at loreforeverwow.com/translate, and their versions are in this update, on top of the French fixes already in.
  Everyone who helps is on loreforeverwow.com/contributors. Want Lore Forever better in your language? Join them.

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
- **Corrected lore in 205 entries,** and removed 97 entries about places, people and rewards that don't belong
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
