-- The newest version's notes, for the What's new card (WhatsNew.lua). Written by scripts/changelog.py addon
-- from CHANGELOG.md at each release: edit that, not this.

local _, ns = ...
ns.Notes = {
  version = "0.11.0",
  items = {
    { "All your installed packs", "Options now lists every voice, language and playback support pack, with separate counts for lore, quest dialogue and answers. Narrator totals count each recording once, even when two packs share it. Playback support no longer causes a false failed add-on check.", "All your installed packs:" },
    { "More quest answers", "expanded English female answer packs and the first 522 English male quest answers are available as optional downloads. Both English narrators also gain the missing dialogue for Prehistoric Prism and Understanding Our Present. Unrecorded answers remain readable text.", "More quest answers:" },
    { "From translation to recording", "each studio script links to its English original and matching translation editor, with clearer saved, checked and recording states and guidance on game names.", "From translation to recording:" },
    { "Lore Player in Herald", "browse published English recordings, read their matching text, and listen with pause, seeking, saved position and speeds from 1x to 2x. It streams the website's original files without game voice packs. Recorded overviews, answers and quest dialogue are labelled clearly; quest outcomes stay hidden until completed or revealed.", "Lore Player in Herald:" },
    { "Herald beside your game", "the Windows companion opens as its own app, with a visible chat and a separate Settings page for your game, profile and sync. Questions copied from the add-on appear in chat; saved add-on conversations arrive after /reload or logout. Failed live questions stay available to retry.", "Herald beside your game:" },
    { "Pictures with their moments", "the companion timeline shows matching screenshot thumbnails that enlarge on hover or keyboard focus.", "Pictures with their moments:" },
    { "", "Hidden spoiler answers stay silent, including queued narration and resumed playback, until their text is revealed or unlocked.", "" },
    { "", "The minimap button stays on the edge of square and reshaped minimaps, including at the corners.", "" },
    { "", "Update notes remain visible when automatic narration starts before you first open the lore panel.", "" },
    { "", "Corrected lore in 201 entries", "" },
    { "Your journey and story together", "Sync now refreshes your profile story from the latest saved journey when an update is available within your story allowance. Overlapping syncs retry without losing newer journey data.", "Your journey and story together:" },
    { "The right creature lore", "Bluegill and Mosshide warriors no longer open the Warrior class story, and crocolisks no longer open Dragonmaw lore just because those words appear in a search match.", "The right creature lore:" },
    { "Read along as you listen", "a narration that starts opens its matching text without replacing a history or Journey page you are browsing. Landing stories respect what your character has already heard.", "Read along as you listen:" },
    { "Quest controls stay useful", "Reclaiming Goods keeps its Lore button even without a dedicated lore entry, showing the quest's text and nearby story. Quest Play continues to read the quest's own words.", "Quest controls stay useful:" },
    { "", "Narration plays continuously with Stop and Restart controls. Recorded story text keeps its paragraph breaks.", "" },
  },
}
