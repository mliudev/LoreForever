-- The newest version's notes, for the What's new card (WhatsNew.lua). Written by scripts/changelog.py addon
-- from CHANGELOG.md at each release: edit that, not this.

local _, ns = ...
ns.Notes = {
  version = "1.2.0",
  released = "2026-11-06",
  items = {
    { "Willo learns where vendors and trainers stand", "when you speak to one Lore Forever has no place for, it notes where you stood, so she can send others there. Nothing about you goes with it; it turns off in her Settings.", "Willo learns where vendors and trainers stand:" },
    { "German names leave English stories", "a few Mulgore and starter quests now use the game's names, like the Clearcutter Key and Palemane Rock.", "German names leave English stories:" },
    { "More stories narrated", "English stories and quest lines that were missing a recording now have one, and the male narrator says SI:7 right.", "More stories narrated:" },
    { "", "Sharing quest text no longer mangles ordinary words when your character's name is one of them or sits inside one.", "" },
    { "", "Fixed a Lua error from Reset windows, and a stray stack of letters no longer shows on the subtitle bar.", "" },
  },
}
