-- The newest version's notes, for the What's new card (WhatsNew.lua). Written by scripts/changelog.py addon
-- from CHANGELOG.md at each release: edit that, not this.

local _, ns = ...
ns.Notes = {
  version = "0.10.0",
  items = {
    { "A companion for your adventure", "Setup.exe can now install the optional Windows companion. It keeps your profile up to date after /reload or logout and gives short live answers over the game when you ask with /lore ask and Ctrl+C. Connect your account for up to 20 free answers a day while the shared monthly budget lasts, or add your own key for more.", "A companion for your adventure:" },
    { "More answers to listen to", "the optional English female packs now include 8,376 recordings about people, places, lore and early quests, with each question before its answer.", "More answers to listen to:" },
    { "Quest dialogue when you want it", "Speak quest dialogue is off by default in /lore options. Its voice packs are separate downloads; stories and lore answers keep playing as before.", "Quest dialogue when you want it:" },
    { "NPC tooltips", "wild nightsabers no longer show unrelated Sentinel lore.", "NPC tooltips:" },
    { "Clearer downloads", "a simple table helps you find a voice in your language, with recording counts and download sizes clearly labelled. The main add-on includes English male narration; other language and voice downloads include their translated text, with any separate files listed together in the download details.", "Clearer downloads:" },
    { "", "Corrected lore in 150 entries", "" },
    { "Spanish lore", "restores community wording in 27 entries that had fallen back to English after lore corrections.", "Spanish lore:" },
    { "A clearer companion", "game detection, profile updates and your picture book are together on the main page. Profiles and pictures work without a live answers key. Interrupted profile updates retry by themselves, and Sync now checks your saved journey whenever you need it.", "A clearer companion:" },
    { "Pictures you can follow", "the companion shows when a picture is waiting for a game save, uploading, retrying or on your profile. Matching waits when a picture's journey moment is uncertain, and pausing or disconnecting stops further uploads. Taking a picture off your profile still works when its picture book is full.", "Pictures you can follow:" },
    { "Clearer Journey status", "a new picture that needs another reload shows guidance instead of a blank image. Chapter dates now belong to the character you are viewing.", "Clearer Journey status:" },
  },
}
