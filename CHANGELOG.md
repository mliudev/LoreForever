# Changelog

Player-facing notes, newest first. Add to **Unreleased** as you go; `scripts/release.sh` turns it into the new
version's section and publishes it to the website's Changelog tab, the GitHub release and the CurseForge file.
One `- ` bullet per change; wrap long bullets with an indented continuation line.

## Unreleased

## 0.3.0 (2026-09-29)

- **New narrators:** every zone story and answer (152 in all) has a new narrator, with clearer pronunciation of
  Warcraft names like Teldrassil, Lordaeron and Gnomeregan.
- **Choose your narrator:** Options > AddOns > Lore Forever > Narration voice lists the narration voices you
  have installed.
- **Community voice packs:** players can record the stories and share them as a voice pack. Anything a pack
  doesn't cover plays with the default narrator. Installing a voice and lending yours:
  https://loreforeverwow.com/voices
- **Installing by hand?** Narration now lives in its own folder, LoreForever_Voice_Default, included in the zip.
  Copy both folders into AddOns, then restart the game (not just /reload) the first time. An old
  LoreForever\Audio folder can be deleted.
- Corrected the text of a few narrated stories, and the narration now matches it.
- Options page fixes: drop-down lists have a proper background, and longer text no longer overlaps the next row.
- Fixed a few garbled search phrases for Sister Aquinne in Darnassus.
- The druid quest "Moonglade" now links to Mathrengyl Bearwalker correctly.

## 0.2.2 (2026-09-29)

- Lore accuracy pass: about 560 entries corrected, including wrong names, races, places and quest givers,
  and details that belong to later expansions.
- Removed about 260 entries for places, people and quests that don't exist yet in WoW Forever's timeline.
- More story twists now stay behind the spoiler prompt.

## 0.2.1 (2026-09-28)

- The Windows installer now lists its publisher as Mei Liu, matching its code signature. The add-on itself is
  unchanged.

## 0.2.0 (2026-09-28)

- Every zone, city and dungeon up to level 30, including Zephras Isle, the Hall of Thanes and the
  Ruins of Lordaeron. About 3,460 entries. Place lore for the rest of the world.
- Lore on NPC, mob and item tooltips. Lore button on quests. Pick-a-key prompt on first login;
  press it over an NPC to read about them.
- Dungeon primers.
- Type-ahead questions, "Ask next" follow-ups, typo-friendly names and "Did you mean...".
- Listen button and flight narration.
- Sticks to Forever's timeline.

## 0.1.0

- First release: Elwynn Forest, Westfall and the Deadmines, 337 lore entries.
