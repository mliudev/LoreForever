-- The newest version's notes, for the What's new card (WhatsNew.lua). Written by scripts/changelog.py addon
-- from CHANGELOG.md at each release: edit that, not this.

local _, ns = ...
ns.Notes = {
  version = "1.14.0",
  released = "2026-11-18",
  items = {
    { "Dungeon prep lists tick as you play", "with Live game info on, a quest on your list ticks the moment you take it up or turn it in, and unticks if you abandon it.", "Dungeon prep lists tick as you play:" },
    { "Tick off your prep list when the run's done", "after a dungeon's last boss, Willo offers to tick off the prep list you made for it, in one press, with Undo.", "Tick off your prep list when the run's done:" },
    { "", "Willo: asked to turn \"What I teach her can help other travellers\" or \"Let her remember on her own\" on or off, she says where you'll find the switch in Settings, instead of saying it's done.", "" },
    { "", "Willo knows more about herself: why her sky sits beside your map when kept up, keeping Discord from hearing you while you talk to her, a remade character's own journey, what PvP the add-on records, and sorting your bags.", "" },
    { "", "Willo: asked to turn \"What I teach her can help other travellers\" or \"Share where I am with friends\" on or off, she opens the right card or asks to change your sharing, instead of flipping a different switch.", "" },
    { "", "When Willo says to type /reload to see a new pin, the card under her answer says Pinned instead of On your map.", "" },
    { "", "Willo: asked for a reminder without saying what it's for, she now asks \"What should I remind you about?\" instead of saving one with made-up words, and your answer sets it for the moment you asked.", "" },
    { "", "Typed questions now know where you were and your level the last time Willo saw your game, instead of going by your last save, which could be hours and levels old.", "" },
  },
}
