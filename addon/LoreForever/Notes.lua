-- The newest version's notes, for the What's new card (WhatsNew.lua). Written by scripts/changelog.py addon
-- from CHANGELOG.md at each release: edit that, not this.

local _, ns = ...
ns.Notes = {
  version = "0.13.0",
  items = {
    { "More complete stories", "68 more lore entries play their whole story in the male narrator's voice (161 in all).", "More complete stories:" },
    { "", "Corrected lore in 207 entries", "" },
    { "Release downloads", "large optional packs stage while the Windows installer builds; publication verifies every file before making the complete release available. Unchanged CurseForge narration keeps its existing download.", "Release downloads:" },
    { "", "Added shared dialogue from Lahu, including the Bellygrub quest progress text.", "" },
    { "Conversations that remember", "live replies use earlier messages in the same chat. Start a new chat, reopen, rename or delete saved chats, and pick up drafts where you left them. Long chats keep their full transcript while older messages are summarized for replies.", "Conversations that remember:" },
    { "Ukrainian, fully translated and narrated", "Pekelnyj / UALL's full Ukrainian translation now covers every lore entry (a few lines whose English changed this week stay English for now). Their Ukrainian narration download adds 793 recordings, 684 stories and 109 answers, and includes the text pack. A recording whose text has changed since stays off, and that entry stays readable.", "Ukrainian, fully translated and narrated:" },
    { "No more boxes in Cyrillic", "the dot between parts of a line shows properly when reading Ukrainian or Russian.", "No more boxes in Cyrillic:" },
    { "Your level in your language", "the panel header's \"Level 60 Human Warrior\" line now uses your language pack.", "Your level in your language:" },
    { "Meet Sam the Squire", "Harold has a new name and title throughout the companion, chat, and profile signatures.", "Meet Sam the Squire:" },
    { "Sam helps with the adventure", "ask about profession quests, rewards, recipes, vendors and directions as well as lore. Web research checks WoW Forever details, links its sources, and makes missing or Classic-only information clear.", "Sam helps with the adventure:" },
    { "Journeys and pictures that stay together", "automatic profile sync works across installed languages, and pictures sit beside the nearest dated moment for their character. Options explains Print Screen, journey pictures, and the separate text contribution control.", "Journeys and pictures that stay together:" },
    { "", "Reloading or logging out stops narration and keeps playback paused at your saved place.", "" },
    { "Shift-click plays and pauses", "Shift-click on the minimap button pauses what's playing, and the next Shift-click picks it up where you left off, even a story you started from the Library. Only with nothing paused and an empty playlist does it play the stories around you, and a story you've heard most of isn't picked up again.", "Shift-click plays and pauses:" },
    { "", "Right-click opens Options directly, with the narration preference kept there.", "" },
    { "", "Ctrl+C in the question field prepares live answers for the companion while keeping your draft; clicking its copy box keeps the payload selected.", "" },
    { "Contributor answers", "answer-only recordings stay in the Library with their numbered labels, without appearing as questions or typing examples.", "Contributor answers:" },
    { "Readable narrated stories", "playing an entry keeps its section headings, lore links, and spoiler controls, including Stormwind City.", "Readable narrated stories:" },
    { "Dalaran lore", "describes the city's reconstruction in the present without out-of-world references to Forever.", "Dalaran lore:" },
  },
}
