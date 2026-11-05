-- The newest version's notes, for the What's new card (WhatsNew.lua). Written by scripts/changelog.py addon
-- from CHANGELOG.md at each release: edit that, not this.

local _, ns = ...
ns.Notes = {
  version = "1.1.0",
  released = "2026-11-05",
  items = {
    { "Stories where you are", "riding the Deeprun Tram plays the tram's story, Ironforge's waits until you walk in, and places like Blackrock Mountain, Dun Algaz and Scholomance play their own story.", "Stories where you are:" },
    { "Your narration key never cuts in", "while something plays, what you hover, target or stand in goes next in your playlist. With nothing playing it plays right away.", "Your narration key never cuts in:" },
    { "Your playlist carries on", "after you press Listen on something else, unless you stopped it yourself.", "Your playlist carries on" },
    { "Every Lore Forever key in one place", "Options has a Keys section with a Set... button for each, so you no longer need the game's Key Bindings menu.", "Every Lore Forever key in one place:" },
    { "Quest windows say what's there", "no play button on a quest with no recording, the Lore button's tooltip names the pack to download, and the quest window and log have the play-and-add pill.", "Quest windows say what's there:" },
    { "A tidier book", "smaller Play and playlist buttons, tabs that match their page, and journey rings that say what they mean. New journey pictures are sharper.", "A tidier book:" },
    { "Willo's sky stays hidden", "until she needs it, so it no longer covers your minimap. To keep it up, Ctrl-right-click the Lore Forever button by your minimap.", "Willo's sky stays hidden" },
    { "", "Subtitles show your name, class and race instead of a code like $N, changing your narrators no longer freezes the game, and Lua errors at some quest windows and on Storylines are fixed.", "" },
  },
}
