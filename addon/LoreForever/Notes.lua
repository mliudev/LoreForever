-- The newest version's notes, for the What's new card (WhatsNew.lua). Written by scripts/changelog.py addon
-- from CHANGELOG.md at each release: edit that, not this.

local _, ns = ...
ns.Notes = {
  version = "1.12.0",
  released = "2026-11-16",
  items = {
    { "", "In a busy run of quests, the story of every new place you pass now plays in its turn, not just the last one.", "" },
    { "", "Stratholme, Scholomance, Ragefire Chasm, the Stockade, Feathermoon Stronghold, Razorfen Downs and the Alterac Mountains each have one story in the Book now, instead of two that read the same.", "" },
    { "", "Willo no longer misses the end of a quest line, a cleared dungeon or a turn-in when narration is playing: she speaks up once it ends.", "" },
    { "", "Shift-clicking a new-page note no longer takes its story back out of your playlist, or stops it, once the story has joined by itself.", "" },
    { "", "Ask Willo for a talk key like Ctrl+Alt+T and she sets it, and the game's own key prompt now points you to her Settings for a combination instead of saying she can't hear it.", "" },
    { "", "A town's story now carries on after every quest giver you talk to, instead of giving up after the fourth.", "" },
    { "Remind me next visit", "a reminder for a place now has a Remind me next visit button instead of Snooze 1 hour, and a repeating reminder has just Stop repeating, over the game and in Willo's chat.", "Remind me next visit:" },
    { "", "With Live game info off, Willo tells which of your characters you're on from her look at your game, and says so when she can't tell, instead of repeating an older save's class and level.", "" },
    { "Willo learns from players", "once several players' correction is checked against our records, she answers with it plainly; until then she passes it on only as something she's heard.", "Willo learns from players:" },
    { "", "Willo no longer says her window \"couldn't open again\" when Windows shuts down or restarts, and when her window does stop, she keeps trying to bring it back, and tries again each time you open her.", "" },
  },
}
