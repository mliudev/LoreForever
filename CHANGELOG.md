# Changelog

Player-facing notes, newest first. Each change's notes go in a fragment of their own, `changelog.d/<branch>.md`, not
here; only the highlights go under **Unreleased**. `scripts/release.sh` turns both into the new version's section and
publishes it to the website's Changelog tab, the GitHub release and the CurseForge file. One `- ` bullet per change;
wrap long bullets with an indented continuation line.

## Unreleased

## 0.24.0 (2026-10-20)

- **Easier updates:** the new Windows Willo app downloads updates in the background and installs them when she next
  starts. She also updates Lore Forever and your installed packs while the game is closed. The add-on tells you
  when you're falling behind.

- **Willo's notebook and chat:** ask her to clear finished items, combine notes, move a note to all your
  characters, or undo a recent note edit. Her chat over the game now scrolls with the wheel, dragging, or Page Up
  and Page Down.

- **More voices and quest dialogue:** optional downloads bring more Castilian Spanish places, a new native
  Brazilian Portuguese male narrator, and more English quest lines. French quest voices, subtitles and titles now
  work with an English game.

- **Closing the player now sticks:** X forgets the current story and keeps the player closed after /reload, while
  keeping your playlist. A paused story outside the playlist appears at its top, where Clear all removes it too.

- **Try more of Willo:** during their first seven days, new players get limited tries of her extra voices,
  characters speaking in their own voices, looking things up and seeing the game. Her window shows how many tries
  remain.

- **Everyday requests work more naturally:** "remember to check the auction house in five minutes" sets a reminder,
  "mark this as a lookout spot" makes a pin, and you can share a place with a friend by name. Timed reminders still
  reach you when the game is out of view.

- **More lore and fixes:** more community quest text and lore, corrected stories, and updated German, Spanish,
  French and Brazilian Portuguese translations. Outdated language packs no longer stop the add-on loading, and the
  small wisp is easier to click.

## 0.23.0 (2026-10-19)

- **Willo's journey and notebook grow up:** pins show on your journey map with their name and note, and keep the exact
  spot where you stood. She remembers rares you only saw and mounts you bought, keeps goals on a page of their own,
  and is straight about her notebook, including what she can and can't clear. Empty headings tidy themselves away.

- **Willo knows more about where you are:** ask how much gold you have and she tells you, to the copper. Asked out
  loud without Live game info, she gives the way from where the game last saved you. Battlegrounds no longer count as
  where you last were.

- **More native voices:** German people stories (777 characters, bosses and lore topics) arrive in the male narrator's
  new voice as an optional download. Spanish zone stories get new native Castilian narrators, male and female. Quest
  givers now read their quests aloud in French, in two new optional downloads. Goldshire's stories are re-recorded.

- **Move the story subtitles:** Options has a new Move the subtitles... button (or type /lore subtitles). Drag them
  anywhere, for example off your action bars, and Put them back returns them to the bottom.

- **The people you target answer under their own names:** a guard captain is "Melris Malagan", not "Human", and each
  person you talk to gets a chat of their own.

- **Friends and Willo's window:** the Friends tab shows who has Willo connected, and "Willo, send this to Aelric"
  sends your place, quest or target with Undo. Willo's window reads clearer, with older chats marked "Saved chat".

- **Opt-in error reports:** when the add-on hits a problem, Willo asks once whether to send what it noted. No names or
  account, and it stays off until you say yes.

- **Fixes:** moving Willo's sky works again, and a story with no recording yet now says so beside its title.

- Corrected lore in 40 entries.

## 0.22.0 (2026-10-18)

- **Willo keeps a second brain:** ask her to remember something, add it to your list, remind you at a town, level or
  time, pin a spot or keep a goal like "my mount at 40", and she writes it down in the new Notebook tab and speaks up
  right when it matters. See everything she keeps about you in one place, change it or erase any of it.

- **Subtitles:** while a story or a quest giver's words play with the panel closed, the words show at the bottom of
  the screen in step with the voice, in your language.

- **More voices to choose from:** the first male narrator is back as an optional download, German stories get new native
  narrators, and Italian narration arrives with two narrators.

- **Talking to Willo is easier:** your talk key always reaches her, a second key asks whoever you're targeting, she
  finishes long answers in her own voice, keeps the same conversation for follow-ups, and tells you kindly when an
  answer can't come. Friends you invite can earn you bonus answers and free months.

- **Willo knows more:** she answers from your own journey, and knows the towns and zones, your riding trainer, items,
  and who gives the quest where you stand.

- **Stories play the way you'd hope:** they pick up after a quest giver interrupts, quest givers finish their lines,
  a + queues all of a place's stories into your Playlist, and the Narrate key plays your target's story. They also step
  aside for other voice add-ons.

- **Fixes:** controller play no longer throws a blocked-action popup, stories wait out dungeon pulls, a broken install
  tells you to reinstall, lore links point to the right places, and a few lore corrections.

- **Tell Willo when she's wrong, in one tap:** a thumbs up or "Not right" under her answers, in her window and her
  chat over the game, with quick reasons if you like. Tick "Tell me when it's fixed" and she'll let you know once
  she's learned it.

- **Willo says the short version and writes the rest:** asked out loud, she answers in a few sentences, as quickly as
  before, and writes the full answer, with the steps, places and names, in her window and the chat over the game.
- On the iPhone, a long spoken answer no longer stops partway: she says the start and tells you the rest is written.
- Telling Willo out loud to stop or start checking in on your goals now sticks.

- When your last save is a few days old, Willo tells you your goal progress as of that save instead of as if it were now.

## 0.21.0 (2026-10-17)

- **A new male narrator:** the Chronicler tells the first 587 stories, deeper and steadier, and stories no longer
  read their own titles.

- **Pick Willo's voice:** on Champion and Legend, a man's voice to pair with each of hers, plus Voices of Azeroth: a
  man and a woman for 11 peoples, from dwarf to troll.

- **Pick Willo's color:** your class color, a lore light like fel green, or any color you like, over the game, in her
  window and on stream.

- **Your friends' week:** see your friends' guild and what they did this week, and add friends from your link in one
  click.

- **Willo knows more:** what's in front of you, what Forever changed for classes, and herself; she asks again instead
  of guessing and keeps to this age in follow-up questions.

- **My contributions:** see everything you sent and what became of it, credited under the name you choose.

- **Fixes:** Willo hears the first question after a quiet spell, her voice stays clean through loading screens, and
  fresher narration for about 180 stories per narrator plus 5 lore fixes.

## 0.20.0 (2026-10-16)

- **Quest givers have their own voices:** over 3,000 quest lines read in 22 voices of Azeroth's peoples, in the
  Quest givers download.

- **Friends in Willo:** add friends by their profile name, write to each other in Willo's window and, if you both
  choose to share it, see where each other's adventures have led. Your own Share Willo link earns her extra answers
  for each friend who joins.

- **Willo knows WoW Forever better:** where every new Forever quest is and who gives it, the new dungeons from the
  inside, where to buy things, and each town's services and the roads between them. She finds the right lore faster
  too.

- **New players hear Willo at her best:** your first 20 answers come in her finest voice, with three little wisps
  under her light while the Moonwell chorus sings with her.

- **Willo on your stream:** add her to OBS as a Browser source (the link is in her Settings) and she shows over your
  game, see-through, voice included.

- **More stories read aloud:** about 35 lore topics, such as the Alliance, the Defias Brotherhood and Elune, as whole
  stories in both narrators' voices, and Browniee's voice, our first community narrator, reading Teldrassil.

- **A steadier Willo:** she keeps one voice through an answer, quietly asks again when an answer stumbles, waits while
  you're talking, and answers the book's questions in her bubble. She now keeps your questions and her answers for 14
  days, anonymized, to fix her mistakes; untick it in her Settings anytime.

- **Fixes and polish:** a small X closes the floating player, +10s always skips ahead and right-click can clear the
  story that's playing, no more Lua error on some quest turn-ins, Willo's add-on shows as "Lore Forever: Willo", and
  corrected lore in over 20 entries, including how the narrators say Incendicite.

## 0.19.0 (2026-10-15)

- **Willo's sky is a star map:** a see-through chart of orbits and constellations over your minimap, and `/lore sky`
  lets you drag it anywhere when another add-on covers your minimap.

- **Willo lends a hand:** ask her anything, from your PC to a question the book can't answer (one click sends it). She
  checks her own setup, names the real fix, and offers to do it with one tap, with Undo.

- **Willo reads the short answers aloud** in her own voice, so the separate answer packs are retired and downloads are
  smaller. The narrators keep the big stories.

- **Willo and the game, in step:** one switch for Live game info, a talk key that tells you when it clashes with
  your own keys (F6 by default now), and a new "Willo and the game" card in her Settings that fixes whatever isn't set.

- **More places and people read aloud:** the whole stories of about 400 places, and a new More people download with
  over 500 characters, in both narrators' voices.

- **The right story in the right place:** Stormwind's canals story no longer plays in Undercity, and places like The
  Crossroads and The Great Forge now play their story when you arrive.

- **Fixes and polish:** quieter answer ratings (a faint wax seal and quill), Willo starts after a PC restart and takes
  "no thanks" kindly, narration waits while she answers, names match your language, and 9 lore entries are corrected.

- **Brazilian Portuguese narration is paused:** it's being re-recorded in Brazilian voices. Until then Portuguese
  shows as text, even if you installed the old narration.

## 0.18.0 (2026-10-14)

- **Meet Willo:** Willo, Lore Forever's free companion app, now installs on her own. Ask her anything out loud or in
  her chat while you play. She knows your race and class, and her tips come in the same voice as her answers.

- **Talk to anyone:** target a character, from King Magni to a guard or an innkeeper, and they answer you themselves.
  Willo glows in their colors while they speak, and each remembers only what you said to them.

- **Chat with Willo in game:** click Willo to chat right there, scroll back through it, and start a new chat from her
  bubble.

- **Willo's sky:** live game info now shows as rings of stars over your minimap instead of colored squares.

- **Willo's settings in one place:** they sit together in Options, greyed out until Willo is installed.

- **Fewer wrong answers:** when Lore Forever only half-understands a question, it offers its closest matches, and
  "thanks" or "that's not right" get a friendly reply instead of a random story.

- **Tidier chat and lore fixes:** suggested questions sit right under the latest answer, and 17 lore entries are
  corrected.

## 0.17.1 (2026-10-14)

- **Fixed:** Lore Forever could leave a character without movement or camera keys; affected characters get their own keys back at next login.

## 0.17.0 (2026-10-13)

- **More places read aloud:** 237 more places have their whole story narrated by both narrators, in an optional
  More places download.

- **More native voices:** Spanish stories are now narrated, Portuguese gets its male narrator, and French and German
  get more stories, all in native accents.

- **Lore and translation fixes:** corrected lore and quest givers, native names like the Scythe of Elune, and no
  more doubled articles in French, German, Spanish and Portuguese.

- **Your own key bindings are back on new characters:** an earlier version could leave a new character with only
  Lore Forever's keys. It's put right at your next login.

## 0.16.0 (2026-10-12)

- **Lore that matches WoW Forever:** boat routes, flight paths and what Forever changed, like every priest learning
  Fear Ward and the Horde starting out Hated with Dalaran. Over 1,100 lore entries corrected.

- **Community voices always play:** Densuad's Spanish edition and the Ukrainian narrator play all their recordings
  again, and community translations keep their own words.

- **More of the story read aloud:** the lore topics behind the world play as full stories, more answers are
  narrated, and two-word names are said clearly.

- **Native accents only:** German and French narration uses native voices. Spanish and Portuguese are text until
  their native recordings arrive.

- **Willo:** a cleaner chat layout, typing in its window works again, and it knows WoW Forever's boats, flights and
  changes.

- **Live game info stays out of your way:** it shows only while the Lore Forever window is open.

- **Fixed:** the quest window's Lore button no longer covers Chronicle's or Spoken's.

## 0.15.0 (2026-10-11)

- **Meet Willo:** the companion's Sam the Squire is now Willo, a little wisp of light. When today's live answers run
  out, Willo answers from the lore library instead of leaving you at a dead end.

- **Your profile tells your journey:** your story first, then a chapter for each day you played, with the map beside
  you following the chapter you're reading.

- **More of the story read aloud:** thousands more answers and about 200 more complete stories, with two-word names
  like Goretusk and Runetotem said clearly.

- **Your language:** zone and quest names show in your language even on an English game client, German and French
  narration is back in native voices, and French and Spanish narration is on CurseForge too.

- **Battles told as battles:** Warsong Gulch, Arathi Basin, Alterac Valley and the Darkspear Islands have their story,
  and your journey records each battle you fight: your side, who won and how you did.

- **Lore that fits WoW Forever:** class and race lore says who can walk which path in Forever, from Forsaken paladins
  to gnome priests, and new entries cover Mount Hyjal and Forever's world.

- **Hear a download before you get it:** the Downloads page plays sample lines from each extra download, and Setup no
  longer looks stuck at the end of one.

- **Smaller fixes:** "why are they attacking me?" answers about the creature you've targeted, and `/lore errors` shows
  a Lua error ready to copy into Discord.

- **Anonymous usage counts:** Willo's daily check-in tells us how often each feature gets used, never what you ask,
  hear or write. Willo's settings turn it off.

## 0.14.0 (2026-10-10)

- **Talk to your target:** with the companion app, target a character Lore Forever knows, like Bolvar or Thrall, and
  ask your question: they answer you in person.

- **Free daily answers from Sam:** connect your profile for 20 live answers a day, no key needed. Turn on Live game
  info and Sam knows where you are, what you're fighting and your tracked quest right away.

- **Your picture book:** the companion takes a picture when you level up, beat a boss or first reach a zone or
  dungeon, and your Journey shows them.

- **Pick up where you left off:** pause a story or answer and play it again to carry on from the passage you were in.

- **More to hear:** 365 more complete stories, stories fixed this week play in full again, and quest givers sound
  more like their people with new dwarf, goblin, human, Skyborne and troll voices.

- **Your language:** German, French, Spanish and Portuguese use the game's own names for places and people, suggested
  questions come translated, and Italian is its own language download.

- **Lore fixes:** about 290 entries corrected, Hilary's Necklace uses the girl's name from Forever, and a quest
  giver's "why does he want me to do this?" answers about the quest they gave you.

- **Help make it better:** share Forever's new quest text with a click, report a narration that sounds wrong right
  from the player, and lend your voice or claim a zone to narrate on the voice studio.

## 0.13.1 (2026-10-09)

- **Your profile stays up to date again:** Sam syncs your profile automatically with the 0.13.0 add-on.

- **The game's own names in your language:** German, French, Spanish and Portuguese show the game's names for places
  and people, like Sturmwind and Hurlevent, instead of English ones.

## 0.13.0 (2026-10-09)

- **Meet Sam the Squire:** Harold, the companion, has a new name and title.

- **Sam helps with the adventure:** ask about profession quests, rewards, recipes, vendors and directions as well as
  lore. Chats remember what you said earlier, and you can reopen, rename or delete them.

- **Ukrainian, fully translated and narrated:** Pekelnyj / UALL's translation covers every lore entry, and a Ukrainian
  narration download reads hundreds of stories and answers.

- **More complete stories:** 68 more lore entries play their whole story in the male narrator's voice.

- **Shift-click to pause and resume:** Shift-click the minimap button to pause what's playing and again to pick it up
  where you left off. Right-click opens Options.

- **Lore fixes:** about 200 entries corrected, and Dalaran's lore tells of the city's rebuilding.

- **Smaller fixes:** your level shows in your language, narrated stories keep their headings and spoiler buttons, and
  journey pictures sit beside the right moment.

## 0.12.0 (2026-10-08)

- **Complete stories:** 250 lore entries now play their whole story, not just an overview, with the text to read
  along. Stormwind and Westfall play in both narrators' voices.

- **Densuad's Spanish edition:** choose the community's own Spanish text and narration together, as one optional
  download.

- **Ukrainian and fresher translations:** UALL / Pekelnyj's Ukrainian brings the whole interface and over 880 lore
  entries, and German, Portuguese, French and Spanish text is refreshed with community corrections.

- **More quest answers:** the male narrator reads more answers about early quests, as an optional download.

- **Herald:** its Player opens faster and remembers your volume, live answers show as text in Chat, and Chat explains
  how to connect your profile.

- **Pictures beside your journey:** pictures on your profile's timeline enlarge when you hover them and open when you
  click.

- **Lore fixes:** 167 entries corrected, with later-era identities removed.

## 0.11.0 (2026-10-07)

- **Herald beside your game:** the Windows companion opens as its own app, with a chat, a settings page and a timeline
  whose pictures enlarge on hover.

- **The Lore Player in Herald:** browse the recorded lore, read along and listen with pause, seeking and speeds up to
  2x, no voice downloads needed.

- **More quest answers:** more answers in the female narrator's voice and over 500 quest answers in the male
  narrator's, as optional downloads.

- **Read along as you listen:** a narration that starts opens its text without taking over the page you're browsing,
  and narration plays straight through with Stop and Restart.

- **Your profile story stays current:** syncing refreshes your profile story from your latest journey.

- **Lore fixes:** about 200 entries corrected, and Bluegill and Mosshide warriors no longer open the Warrior class
  story.

- **Smaller fixes:** the minimap button stays on the edge of square minimaps, hidden spoiler answers stay silent until
  you reveal them, and Options lists every voice and language you've installed.

## 0.10.0 (2026-10-06)

- **A companion for your adventure:** the Windows installer can add the optional companion app. It keeps your profile
  up to date and answers your questions over the game, up to 20 a day free with your account connected.

- **Pictures on your profile:** the companion puts your pictures on your profile and shows where each one is, from
  waiting to uploaded.

- **More answers to listen to:** the female narrator's optional downloads read over 8,000 answers about people,
  places, lore and early quests, each question before its answer.

- **Quest dialogue when you want it:** narrated quest dialogue starts off and is its own download; turn it on in
  Options.

- **Clearer downloads:** the Downloads page helps you find a voice in your language, with sizes and counts.

- **Lore fixes:** 150 entries corrected, community Spanish wording back in 27 entries, and wild nightsabers no longer
  show Sentinel lore.

## 0.9.0 (2026-10-05)

- **Quest givers in their own voices:** the first quest-giver voices, for male human, dwarf, Forsaken and orc quest
  givers, come as an optional download, and every recorded quest giver now finishes their last sentence.

- **Only recorded voices, at your volume:** Lore Forever now speaks only with its recorded narrators, and anything not
  yet recorded stays as text. Options sets how loud they are and which sound channel they play on.

- **Quests in your playlist:** Shift-click a quest to queue what its quest giver said, and the map's quest log has a
  Play button.

- **Arrival stories in step with you:** a zone's story waits for the one that's playing, plays as you land from a
  flight, and plays by itself only once.

- **More answers to hear:** the female narrator reads hundreds more answers about zones and places, the Spanish and
  French narrators read each question before its answer, and voice downloads are on CurseForge too.

- **Your road on a map:** your profile opens on a map and timeline of your travels, and every narration has its own
  page to hear and read at loreforeverwow.com/lore.

- **More of your story in numbers:** how you traveled, the inns you've called home, the fish you've caught, what
  killed you and more, on the Journey page and your profile.

- **Lore fixes:** 134 entries corrected, 12 later-era places removed, Redridge and Stonetalon said the same way
  everywhere, and Cutting Teeth tells its own story.

- **Smaller fixes:** a quest's storyline line no longer covers its text, and items from your mailbox, a vendor or the
  bank no longer count as finds.

## 0.8.0 (2026-10-04)

- **Your journey in numbers:** the steps you walk, the foes you slay, your deaths and your time played, on the Journey
  page and your profile, with lines like "the road from Goldshire to Booty Bay 3 times over".

- **Your profile, moment by moment:** your page on loreforeverwow.com tells your journey as it happened. Follow a
  trail from any moment, like a finished quest back to whoever gave it.

- **A better Journey page:** the map follows where you actually walked, with zoom and a bigger view, and every
  moment, or any quest you've ever completed, opens its story.

- **Quest givers, every time:** their words play each time you open a quest, a play button hears them again, Stop
  cuts them off, and arrival stories no longer drown them out.

- **Narration only when you press Play:** a new choice turns off everything that plays by itself, and Lore Forever no
  longer talks over the game's cinematics.

- **What's new in game:** after an update, one chat line and a card in the panel show what the new version brings.

- **Share what you find:** upload the Forever quest, gossip and book text you've seen at
  loreforeverwow.com/contribute, and report a narration that sounds wrong from the player's right-click menu.

- **Thank you, translators!** German and Spanish players reworked about 250 lines, and everyone who helps is on the
  new Contributors page. On a non-English game client, Lore Forever now says how to hear the English narrators.

- **Smaller fixes:** narration plays even with the game's Dialog sound off, Reset windows brings back a lost player or
  panel, quests filed under the wrong story find their own, and `/loreforever` works when Chronicle also uses /lore.

## 0.7.0 (2026-10-03)

- **Quest givers speak:** open a quest and the quest giver's words play aloud, with women in the female narrator's
  voice where she's recorded them.

- **See which quests belong together:** a quest that's part of a storyline says so, like "Storyline · Westfall: The
  Defias Brotherhood", and chat tells you who to see next.

- **Your profile on loreforeverwow.com:** sign in and paste your journey record for a page about your character,
  private until you share it. Downloading Lore Forever never needs an account.

- **Plays nicely with other voice add-ons:** with VoiceOver, Chronicle and similar add-ons running, quest dialogue
  starts off so nothing is voiced twice.

- **The journey map shows what you've explored:** zones look the way they do on your World Map.

- **Lore fixes:** 205 entries corrected and 97 removed that don't belong in this era.

- **Smaller changes:** the menu bar book button is gone (use your key, the minimap button or /lore), and translated
  labels fit their buttons.

## 0.6.0 (2026-10-02)

- **Narrations play as you arrive:** reach a zone or place and its story plays by itself, after any fight and never
  twice, and quest givers' dialogue is narrated too.

- **A narration player:** play, pause, skip and your queue sit at the bottom of the panel, and a small copy floats on
  screen when you close it.

- **Your journey, on the map:** Journey opens a timeline of each play session beside a world map of where it
  happened, and the first chat after you log in sums up your last session.

- **A new look:** the panel wears the game's gold dialog frame over dark stone, with fewer tabs, search boxes on the
  long lists and a size you can change.

- **Four languages come with the add-on:** French, Spanish, German and Brazilian Portuguese switch on by themselves
  on those game clients.

- **Every narration in one download:** every zone's places and people come with the add-on, and you can install
  several voices and put them in the order you like.

- **Clickable names in answers:** the places, people and events an answer mentions link to their stories, and
  questions in your own words find the right answer more often.

- **Boss stories after the fight:** beat a dungeon boss and chat links their story.

- **Smaller changes:** the minimap button sits on the minimap's edge, a short tip shows at your first few logins, a
  missing voice says where to get it, and lore is corrected in 99 entries.

## 0.5.0 (2026-10-01)

- **Your journey:** a new Journey tab keeps what your character has done: places discovered, people met, quests
  finished, foes and bosses defeated, books read and rare finds. It stays on your PC.

- **Answers know your journey:** the story of a quest you've finished or someone you've met opens with a line like
  "You finished this at level 12, 3 days ago, in a group."

- **Hundreds more narrations, in both voices:** 25 new zone stories, plus the places and people of the capitals,
  starting zones and early zones as optional downloads, with names like Feralas and Quel'Thalas said properly.

- **Tell us when an answer is wrong:** every answer has a check and a cross, and the cross gives you a short report to
  send, never with your character's name.

- **For translators and narrators:** a test pack shows your work in game before it ships, and you can upload a whole
  folder at once.

- **Lore fixes:** 126 entries corrected, 11 from later expansions removed, and places that share a name, like the
  Canals, answer for the zone you're in.

## 0.4.0 (2026-09-30)

- **A female narrator:** a second narrator reads every zone story, answer and dungeon boss, as an optional download.

- **Every dungeon boss, narrated:** 52 bosses from the Deadmines to the Scarlet Monastery, spoiler-free. Target a boss
  and open Lore Forever for their story, and inside a dungeon the Here tab lists its bosses in order.

- **Ask about what's in front of you:** "what am I doing here?", "who leads them?" or "why can I use the Light?"
  answer from where you are, who you've targeted and your quest log.

- **A narration playlist:** queue narrations to play one after another, and flying over several zones plays each
  zone's story instead of cutting one off.

- **More lore:** about 760 quest items, every class, the first quests of the starting areas, and stories of their own
  for Baron Aquanis and Bazil Thredd.

- **Lore fixes:** 275 entries corrected, with twists kept behind the spoiler button, and Lordaeron and Gnomeregan said
  the way players say them.

- **Smaller changes:** the minimap button is on by default and Shift-click plays your playlist, your Lore key always
  opens the story of who you're hovering, and the window can be made narrower.

## 0.3.0 (2026-09-29)

- **New narrators:** every zone story and answer has a new narrator, with clearer Warcraft names like Teldrassil and
  Gnomeregan.

- **Choose your narrator:** pick from the narration voices you've installed in Options.

- **Community voices:** players can record the stories and share their voice for others to install; anything they
  haven't recorded plays with the default narrator.

- **Installing by hand?** Copy both folders from the zip into AddOns and restart the game the first time.

- **Fixes:** a few narrated stories corrected, the Options page lays out properly, and the druid quest Moonglade links
  to Mathrengyl Bearwalker.

## 0.2.2 (2026-09-29)

- **Lore accuracy pass:** about 560 entries corrected, from names and races to places and quest givers.

- **Sticks to Forever's timeline:** about 260 places, people and quests that don't exist yet are gone, and more twists
  stay behind the spoiler prompt.

## 0.2.1 (2026-09-28)

- **Installer fix:** the Windows installer now shows its publisher correctly. The add-on itself is unchanged.

## 0.2.0 (2026-09-28)

- **The world up to level 30:** every zone, city and dungeon up to level 30, including Zephras Isle, the Hall of
  Thanes and the Ruins of Lordaeron, plus place lore for the rest of the world, all true to Forever's timeline.

- **Lore wherever you look:** lore on NPC, mob and item tooltips and a Lore button on quests. Pick a key at first
  login and press it over an NPC to read about them.

- **Dungeon primers:** a dungeon's story before you go in.

- **Ask anything:** type-ahead questions, "Ask next" follow-ups and names that forgive typos ("Did you mean...").

- **Listen:** a Listen button, and narration as you fly.

## 0.1.0

- **First release:** lore for Elwynn Forest, Westfall and the Deadmines.
