-- The newest version's notes, for the What's new card (WhatsNew.lua). Written by scripts/changelog.py addon
-- from CHANGELOG.md at each release: edit that, not this.

local _, ns = ...
ns.Notes = {
  version = "1.8.0",
  released = "2026-11-12",
  items = {
    { "See who you can ask out loud", "target a friendly character who can answer you and a small mark by your target shows which key to hold to ask them with Willo. Their tooltip says it too. You can turn it off in Options.", "See who you can ask out loud:" },
    { "Willo cheers three new moments", "finishing a dungeon, the last quest of a storyline, and (with Small ones too) your first time in a new zone, once you've settled in. Needs this add-on and the newest Willo.", "Willo cheers three new moments:" },
    { "", "In Willo's Notes, the right-click menu closes when you scroll, Escape puts you back on the row, and Escape in the panel over the game closes only the menu.", "" },
    { "Pins in long sessions", "talking to Willo with the map open uses fewer of the game's chances to show her new pins, so they reach your map without a /reload about twice as far into a session.", "Pins in long sessions:" },
    { "Willo knows why your game slows while you type to her", "ask her, and she tells you it's the game's own limit for windows in the background, and where in the game's options to raise it.", "Willo knows why your game slows while you type to her:" },
    { "", "Hovering an item a quest of yours needs or handed you no longer throws an error; its Lore Forever lines show again.", "" },
    { "Repeating reminders", "ask Willo to remind you every 15 minutes, every level, or every time you reach a town or any major city. Each one has a Stop repeating button, and Notes lists them in their own group.", "Repeating reminders:" },
    { "A quest done the moment you take it still speaks", "a quest whose item comes with it, one whose item you already carry, or a talk-to no longer has its quest giver's words skipped as \"already done\" when its turn comes.", "A quest done the moment you take it still speaks:" },
    { "The playlist button always tells the truth", "a quest or book that starts by itself now shows as playing or in your playlist on every add-to-playlist button, and one press takes it out instead of adding it twice.", "The playlist button always tells the truth:" },
    { "Every new page's story joins your playlist", "when a new-page note shows (someone you meet, an item you get or hover, a topic), its recorded story joins the playlist and plays in its turn, behind quest givers, never in a fight, under \"Play narrations as you arrive\". A page you've already heard brings no note.", "Every new page's story joins your playlist:" },
    { "A zone's first place follows it", "reaching a new zone at a new place with its own story now plays the place's story after the zone's, instead of waiting for your next step.", "A zone's first place follows it:" },
    { "Quest givers speak even when you click Accept right away", "a quest you accepted before the character finished greeting you used to stay silent; it now speaks once the greeting is over, and the little player shows it. A quest you abandon and take again speaks again too.", "Quest givers speak even when you click Accept right away:" },
    { "", "Ask Willo to pin a person or creature by name (\"pin Hogger\", \"pin where Lord Kazzak is\") and the dot lands where they're usually found, not on you.", "" },
    { "The little player shows a quest giver's line playing", "its bar moves through each line from the list and starts again with the next; \"2 of 3\" shows where you are in the list.", "The little player shows a quest giver's line playing:" },
    { "Characters by both names", "your profile and Willo show each character by first and last name, so two characters with the same first name no longer read as one, and each keeps its own page.", "Characters by both names:" },
    { "Plain ruleset names", "a Forever server shows as its ruleset (\"PvP ruleset\"), never the server code.", "Plain ruleset names:" },
    { "Willo hears what your quests need", "ask out loud about an item or creature a quest of yours names and she hears it right more often.", "Willo hears what your quests need:" },
    { "Turn off Willo's sky from Options", "a Turn off the sky button sits beside Move things on screen, so the sky goes with one click, even after uninstalling Willo.", "Turn off Willo's sky from Options:" },
    { "", "Willo and the narrators now say Magistrate Henry Maleb the same way every time: \"MAL-eb\".", "" },
    { "", "The narrators now say \"King Llane Wrynn the First\", and \"Stonemasons\" right in the Stormwind City story.", "" },
    { "Ask characters yourself", "when you ask Willo about someone you've targeted, a line under her answer shows the key to ask them directly, a few times until you've tried it.", "Ask characters yourself:" },
    { "Willo hears your recipe's reagents", "with the latest add-on, ask out loud about something the recipe you last opened in a profession window needs, and she hears its name right.", "Willo hears your recipe's reagents:" },
    { "", "Willo no longer changes her own settings, or opens them, when your question was about the game. Ask how to keep the game's sound playing while you type to her, and she tells you where that is in the game.", "" },
    { "", "Restart to update under Willo's answer works again when you tap it.", "" },
    { "", "Tell Willo to restart for her update, out loud or typed, and she does, checking once first if she hadn't just offered; when she can't right then, she says so.", "" },
    { "", "Willo no longer pins a place you didn't ask her to: she offers, and a yes pins it.", "" },
    { "Willo stays ready while you play", "she gets her voice ready once when you start the game, not again every time you alt-tab back in.", "Willo stays ready while you play:" },
  },
}
