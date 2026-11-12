-- The newest version's notes, for the What's new card (WhatsNew.lua). Written by scripts/changelog.py addon
-- from CHANGELOG.md at each release: edit that, not this.

local _, ns = ...
ns.Notes = {
  version = "1.7.0",
  released = "2026-11-11",
  items = {
    { "Quest givers speak by default", "in the starting zones they voice their lines out of the box, and their voices now come in the main download.", "Quest givers speak by default:" },
    { "One voice at a time", "quest givers take turns in the order you click them, and arrival stories, book pages and recaps wait their turn instead of talking over each other.", "One voice at a time:" },
    { "Pins that stay out of the way", "Willo's pins take a map slot only while your map is open.", "Pins that stay out of the way:" },
    { "", "Up to date with Forever's latest patch.", "" },
    { "", "Corrected lore in 14 entries.", "" },
    { "", "Right-click a note, reminder or pin in Willo's Notes to get a small Remove menu where you clicked; the note no longer opens.", "" },
    { "Pins show up where you look", "Willo's pins now show on a zone's own map, reach your map without a /reload when you open it soon after asking, and a pin by map numbers (\"pin 84.5, 65.2\") lands on the map.", "Pins show up where you look:" },
    { "Clearing a pin can be undone", "right-click one on a map and it now says so, with Put it back.", "Clearing a pin can be undone:" },
  },
}
