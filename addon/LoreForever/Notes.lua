-- The newest version's notes, for the What's new card (WhatsNew.lua). Written by scripts/changelog.py addon
-- from CHANGELOG.md at each release: edit that, not this.

local _, ns = ...
ns.Notes = {
  version = "1.11.0",
  released = "2026-11-15",
  items = {
    { "", "Corrected lore in 16 entries.", "" },
    { "Willo knows what's changed in your bags", "with Live game info on and Willo up to date, each time you talk to her she hears what you've looted, used or swapped since logging in, and how long until your Hearthstone is ready. After a big haul she catches up over a few questions.", "Willo knows what's changed in your bags:" },
    { "", "A page Willo looked up on a site that won't show inside her window (wowpedia, behind its own check) now opens straight in your browser from her \"Looked up\" card, with no wait.", "" },
    { "", "Willo's character list shows each character's ruleset (\"Normal ruleset\") instead of a server code, and so do your downloaded notes.", "" },
    { "", "Willo knows your brand-new character's race and class when you ask with the mic in her window, before the game has saved it.", "" },
    { "", "With both narrators' quest dialogue installed, a quest no longer switches narrator partway through when one of them is missing a page: the narrator who has the whole quest reads all of it, at the quest window and from the quest log.", "" },
    { "Talking to characters is steadier", "the one you target when you press the key is the one who answers, a dead character no longer answers you, and characters remember you even after Willo learns their name.", "Talking to characters is steadier:" },
    { "", "Pages Willo looked up: Back to chat returns to where you were reading, and a page that can't load says so instead of staying on \"Opening…\".", "" },
  },
}
