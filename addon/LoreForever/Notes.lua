-- The newest version's notes, for the What's new card (WhatsNew.lua). Written by scripts/changelog.py addon
-- from CHANGELOG.md at each release: edit that, not this.

local _, ns = ...
ns.Notes = {
  version = "1.5.0",
  released = "2026-11-09",
  items = {
    { "Every pop-up can be moved", "drag any Lore Forever pop-up and it opens in that spot from then on. Options has a button to place the new-page note and the pin card, and Reset windows puts everything back.", "Every pop-up can be moved:" },
    { "Willo's pins reach every map", "they now show on the whole-world map too, right-click one on any map to remove it, and a new pin no longer stays hidden until a /reload.", "Willo's pins reach every map:" },
    { "Your map stays clear", "if you keep Willo's sky up all the time, it now sits under your buffs instead of over your minimap, and she still sees your game. Drag it anywhere with Move the sky in Options.", "Your map stays clear:" },
    { "Willo knows the talents you've taken", "she can now see the points you've spent and work from your actual build.", "Willo knows the talents you've taken:" },
    { "", "A place that shares its name with a room in a starting area, like Ironforge's Hall of Arms, no longer pops up a new page for that far-off area.", "" },
    { "", "Willo waits when one quest narration is about to follow another, so her big-moment lines no longer talk over the story.", "" },
    { "", "More stories have fresh recordings, and Forever quest characters with no voice on file now get a narrator of their own gender in Match Character Gender.", "" },
    { "", "Corrected lore in 4 entries.", "" },
  },
}
