# Changelog

Player-facing notes, newest first. Add to **Unreleased** as you go; `scripts/release.sh` turns it into the new
version's section and publishes it to the website's Changelog tab, the GitHub release and the CurseForge file.
One `- ` bullet per change; wrap long bullets with an indented continuation line.

## Unreleased

## 0.4.0 (2026-09-30)

- Corrected 275 lore entries: wrong names, races and places, zone details from the wrong era, and story twists
  that now stay behind the spoiler button.

- **Dungeon bosses, one click away:** target a boss and click the book or minimap button (or press your Lore key)
  and Lore Forever opens on that boss's story. Inside a dungeon, the Here tab lists its bosses in the order you
  meet them, with play, + and "Queue all", and the dungeon primer's "Who you'll face" names are now clickable.
  A boss's ending stays behind the spoiler button.
- **Every dungeon boss is narrated (52 in all):** hear who they are and why they're there, from the Deadmines to the
  Scarlet Monastery, spoiler-free. Find them in the Here tab inside a dungeon, or under each dungeon in the
  Narrations tab. The female narrator (version 1.1.1 on the Voices page) reads them too.
- Baron Aquanis and Bazil Thredd now have stories of their own, so asking about them no longer answers with
  the quest about them.
- The narrator now says Lordaeron and Gnomeregan the way players do.
- **Narration playlist:** press the green + on any narration in the Narrations tab (or "Add to playlist" on a
  narrated answer) to queue it. The new Playlist tab shows what's playing and what's next, and lets you reorder,
  remove or clear it all. Narrations play one after another with Prev, Pause and Next in the Now playing bar. Playing
  something else pauses the playlist. New key bindings: "Play/pause narration playlist" and "Next narration".
- **Flight narration no longer cuts itself off:** each zone's story joins your playlist, so flying over several
  zones quickly plays them one after another instead of dropping the one that was playing.
- **Book and minimap buttons:** click opens Lore Forever and right-click opens (or closes) its options, as
  before. New: Shift-click plays or pauses your playlist, and Shift-right-click skips to the next narration.
  With an empty playlist, Shift-click (or the play/pause key) plays everything narrated where you are.
  The book glows and the minimap button's ring turns green while something plays, and the tooltip says what's
  playing.
- The minimap button is now on by default (it's turned on once after this update; switch it off in Options).
- Pressing your Lore key while hovering someone with lore now always opens their story. Before, it only worked
  for a couple of seconds after the tooltip appeared, and not at all with tooltip lore turned off.
- The Lore Forever window can be resized narrower (down to 600 pixels wide).
- `/lore help` now ends with where to ask questions, request lore and report bugs: loreforeverwow.com/discord
- Item tooltips no longer add "Useful for your Tailoring" and similar notes to crafting materials. Notes for
  quest items stay.
- **Ask the obvious:** "how did I get here?", "what am I doing here?", "why does he want me to do this?" and
  "what is this for?" now answer from where you are, who you've targeted and what's in your quest log and bags.
  Everywhere up to level 30: every starting area, zone, city and dungeon.
- **Ask about what's in front of you:** target a gnoll and ask "who leads them?" or "why are they attacking me?";
  target a person and ask "whose side is he on?"; stand in Moonbrook and ask "what happened here?"; or ask about
  yourself: "why can I use the Light?", "tell me about my people", "why do we fight the Alliance?".
- Lore for about 760 quest items (Gold Dust, Tough Wolf Meat, Minshina's Skull and more) and for every class.
- Suggested questions lead with those, and no longer offer gameplay filler like "where are the wolves located?".
- New lore for the first quests of the Valley of Trials (Cutting Teeth, Sarkoth, Lazy Peons and more), Shadowglen,
  Deathknell, Coldridge Valley and Northshire.
- **Female narrator:** a second narrator reads all 204 narrations: every zone story and answer, and the dungeon
  bosses. She's an optional download: https://loreforeverwow.com/voices. Unzip her into AddOns, restart the game,
  then pick her in Options > AddOns > Lore Forever > Narration voice.

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
