-- The newest version's notes, for the What's new card (WhatsNew.lua). Written by scripts/changelog.py addon
-- from CHANGELOG.md at each release: edit that, not this.

local _, ns = ...
ns.Notes = {
  version = "1.9.0",
  released = "2026-11-13",
  items = {
    { "", "Willo no longer leaves \"Done\" standing when a change you asked for out loud takes a while and then doesn't go through: she says it didn't, and Try again shows under her line.", "" },
    { "", "Found now collects the places, people and items you meet in every game language, with or without a language pack, not only your quests.", "" },
    { "", "If a game patch breaks one part of Lore Forever, the rest keeps working, and chat tells you once how to send us what happened. No more Lua error from the talk mark or kept quest text in dungeons and combat.", "" },
    { "Dutch stories in MasterZBlaze's own words and voice", "a new community edition tells 98 zones and places, from Ashenvale and Darkshore to Stonetalon and Arathi, in Dutch, narrated. Pick it under Language in Options.", "Dutch stories in MasterZBlaze's own words and voice:" },
    { "Pick your main", "on your profile, open any of your characters and choose \"Make this my main\". Your shared link then opens on that character for everyone, and you can change it back any time.", "Pick your main:" },
    { "", "Willo no longer goes quiet partway through a spoken answer when her voice is slow for a moment: she pauses briefly and says the rest.", "" },
    { "Willo says plainly when she's down on our side", "if she can't answer at all for a while (a problem with the service behind her), she tells you it's on her side and nothing you did, and to try again in a little while, instead of asking you to repeat the question.", "Willo says plainly when she's down on our side:" },
    { "", "Willo's long spoken answers get to the point sooner: the answer first, then only what you need, so you're back to the game faster. Ask her to tell you more any time.", "" },
    { "", "A reminder for the next city now comes as you land there by flight, and Willo no longer says one was already said before she's said it.", "" },
    { "", "With your playlist paused, a story that comes by itself (a new place, a new page) now joins the end of your list and waits for Play, instead of starting on its own.", "" },
    { "", "Your playlist, stories that came by themselves included, now comes back after a /reload, logging out or a disconnect, paused or playing as you left it. After a game crash it comes back as it was the last time you reloaded or logged out.", "" },
    { "", "Willo for Mac: Settings' Hold to try now says macOS is about to ask for your microphone before it does, and shows whether the microphone is on once you answer.", "" },
    { "Repeating reminders, fewer surprises", "a second town keeps the first, \"for all my characters\" moves a repeat to every character, and \"undo\" right after Willo stops one brings it back.", "Repeating reminders, fewer surprises:" },
    { "Hide the talk mark from the mark itself", "point at the mark by your target to see what it means, and right-click it to stop showing it on every character. You can bring it back in Options.", "Hide the talk mark from the mark itself:" },
    { "", "Clicking Continue on a quest giver's page no longer cuts them off: the next page waits its turn, and a page you clicked through quickly still gets read.", "" },
    { "", "Corrected lore in 28 entries", "" },
    { "See what Willo is doing while she looks something up", "\"Looking up Hogger\" shows beside her dots, and asked out loud she says a short line with the name in it before her answer. You can turn her lines off in her Settings, or just ask her.", "See what Willo is doing while she looks something up:" },
    { "", "When Willo hears you talking but can't make out the words, she now says \"I didn't catch that. Try again?\" out loud, so you know she's there.", "" },
    { "", "A quest with its own recorded story but a silent quest giver now plays that story when you take it. A story from a new page waits until you land, and until a fight that starts right away is over.", "" },
    { "Willo is all about World of Warcraft again", "her Azeroth Survivors card picks were a fun experiment and are now retired. Everything else she does works as before.", "Willo is all about World of Warcraft again:" },
    { "", "Elling Trias, Stormwind's cheesemonger, is re-recorded in one take per page, to fix parts that sounded muffled or too close to the mic.", "" },
    { "More stories in your narrator's voice", "20 Spanish and Portuguese stories, and two quest lines, now play in the narrator you picked instead of the other one or none.", "More stories in your narrator's voice:" },
    { "Willo knows the game's own interface better", "she can tell you about the built-in cooldown icons, cast bars and spell effects.", "Willo knows the game's own interface better:" },
    { "Willo says your name your way", "tell her how your name is said and she keeps it, in every voice, from then on. It's a line in her book that you can change or forget.", "Willo says your name your way:" },
    { "", "One click on Willo's wisp opens her chat, even right after clicking in the game; a small wobble of the mouse no longer drags her instead.", "" },
    { "Resize Willo's pop-up", "drag its top edge, its sides or the small mark in its corner to make it the size you want; it opens at that size from then on, on every tab. Wide enough, your chats show as a list beside the chat, as in her window. Double-click the mark or an edge to go back to the usual size.", "Resize Willo's pop-up:" },
    { "Willo's pop-up takes over from her line", "when you click her line or her wisp, the line beside her goes as her pop-up opens, and while it's open what she'd have written lands in it, with its buttons and her replies to them. \"Ask about this\" works there too.", "Willo's pop-up takes over from her line:" },
  },
}
