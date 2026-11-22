-- The newest version's notes, for the What's new card (WhatsNew.lua). Written by scripts/changelog.py addon
-- from CHANGELOG.md at each release: edit that, not this.

local _, ns = ...
ns.Notes = {
  version = "1.16.0",
  released = "2026-11-22",
  items = {
    { "", "The add-on now says Português (Brasil), not just Português, where it names its Brazilian Portuguese recordings.", "" },
    { "", "A quest that opens in silence because its voices are a separate download now says which download, once.", "" },
    { "Quest givers know their quests", "talk to someone whose quest you carry and they know it's theirs, thank you for ones you've finished, and let on when they have more work.", "Quest givers know their quests:" },
    { "Your pet and your demon", "ask your own pet and Willo answers for it. Your imp or succubus answers you itself, as your demon.", "Your pet and your demon:" },
    { "Quest givers' voices are now split by level at 25 and 50", "if you added packs one at a time on CurseForge and have only the first quest givers' pack, add the other two to keep hearing quest givers past level 25. Willo can find a quest item from a corrected short name and the dungeon you were discussing, without asking you to name it again when the record is clear. Willo can set her voice to the exact whole-number percentage you ask for, from 5% to 100%. Older versions keep their supported presets and point to the volume slider for other amounts. Willo distinguishes a known dungeon drop from an unknown drop rate, including items missing from her general item catalog.", "Quest givers' voices are now split by level at 25 and 50:" },
    { "Clearer Live game info controls", "Willo explains that its stars carry the game data, so hiding every light and keeping that live data are linked. Turning off the between-question sky now says what still appears; moving it remains an option.", "Clearer Live game info controls:" },
    { "Pop out a goal", "a goal now pops out over the game like a note, with its bar moving as you level and Done to tick when you get there (Windows).", "Pop out a goal:" },
    { "After a misunderstood request", "a rejected suggestion no longer grants permission for a different app change on the next try. Willo checks the replacement against what you actually asked and can still answer the question when no change is authorized. Willo retains short lookup receipts with the conversation so a follow-up can name the sources she actually used, and can distinguish a recorded lookup with no saved links from one she did not need.", "After a misunderstood request:" },
    { "Typed replies out loud", "choosing “You type, she answers out loud” now reads new replies in your chosen voice. Existing settings keep typed replies quiet until you choose it; Play still works.", "Typed replies out loud:" },
  },
}
