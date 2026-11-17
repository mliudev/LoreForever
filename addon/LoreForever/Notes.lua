-- The newest version's notes, for the What's new card (WhatsNew.lua). Written by scripts/changelog.py addon
-- from CHANGELOG.md at each release: edit that, not this.

local _, ns = ...
ns.Notes = {
  version = "1.13.0",
  released = "2026-11-17",
  items = {
    { "", "Found counts only the quests your character can take: each zone now holds its own new quests, and quests for the other side or another class or race stay out. Your zone totals will look different.", "" },
    { "", "Found no longer lights up zones you've never been to: a quest counts where you pick it up and a person where you meet them, and other races' versions of your class quests no longer show as found.", "" },
    { "Willo knows where dungeon quest chains begin", "asked for a dungeon's quests, she now says where the first step starts, like the journal at the Great Lift that opens a Razorfen Kraul quest.", "Willo knows where dungeon quest chains begin:" },
    { "", "Corrected lore in 37 quest entries.", "" },
    { "\"Sent to\" by name", "when Willo sends a friend a message for you, she says and shows just their name (\"Sent to Tessa.\"), adding their handle only when two of your friends share that name.", "\"Sent to\" by name:" },
    { "Messages Willo sends for you, in her chat", "when she sends a friend a message for you, it shows under her answer with who it went to and the exact words, and Open in Friends takes you to that conversation. Take it back by asking her and it says so.", "Messages Willo sends for you, in her chat:" },
    { "Goals in Willo's chat", "when she sets, changes, drops or finishes a goal, or you ask for your goals, the goal shows under her answer with how far along you are, and Undo or Remove right there. A reminder that comes due with her pop-up open now shows with its own buttons too, every time it comes due.", "Goals in Willo's chat:" },
    { "Willo's screenshots stay in her chat", "ask her for one and the picture sits under her answer, with Open in Pictures, even after a restart. Click any picture in her chat to see it large.", "Willo's screenshots stay in her chat:" },
    { "", "Willo: her chat no longer says a screenshot is gone right after she takes it, and Send is back when she names a friend.", "" },
    { "Pins in Willo's chat", "a place she pins shows under her answer with its map spot, Undo and Open in Notes, and \"what pins do I have?\" lists them there with Remove.", "Pins in Willo's chat:" },
    { "See a list right in Willo's chat", "ask \"what's on my shopping list?\" and the list shows under her answer, ready to tick off.", "See a list right in Willo's chat:" },
    { "", "Willo: \"clear my chat history\" now offers to erase your chats, and only your chats, instead of forgetting just the last thing you said.", "" },
    { "", "Willo: ask her for two or three pins in one line and she pins each one, then says which went in and which didn't.", "" },
    { "", "Willo: \"forget that\" now says what she forgot (\"I forgot the last thing you said and my answer.\"), and says there's nothing to forget when nothing came before.", "" },
    { "", "Willo: after she reads your friends' messages out, her halo and the unread count catch up right away.", "" },
    { "", "Willo for Windows: opening a page she looked up no longer plays the Windows \"ding\".", "" },
    { "", "Keep a note or list in view while you play: press Pop out on it (under Willo's answer, or beside Edit in Notes) and it opens in its own small window over the game. Pop out as many as you like, tick rows as you go, drag them where you want and size them from the corner. Put back (or the ✕) closes one; the note stays in Notes. They come back where you left them the next time you start Willo. Windows only for now.", "" },
    { "", "Willo: \"take that back\" just after she sends a message to a friend now takes it back, out loud too.", "" },
    { "", "Willo: on an older Willo, asking for a talk key like Ctrl+Alt+T no longer sets some other key; she says an update brings key combinations and asks which single key you'd like.", "" },
    { "", "When you correct Willo about the game, it can now help other players too: once several players have taught her the same thing, she can pass it on to others. Only the fact goes, never your name. It's on when you first see it; untick \"What I teach her can help other travellers\" in Settings > What she remembers to keep yours to yourself.", "" },
    { "", "An answer that uses what other travellers told her says \"From other travellers\" under it, and an answer that uses what you taught her says \"You taught her this\" again.", "" },
  },
}
