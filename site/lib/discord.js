// Discord invites and the click table, shared by /discord, /api/discord and /api/stats. Kept outside functions/
// so Pages doesn't route it.

// One never-expiring invite per placement, so Discord's Server Settings > Invites also shows joins per source.
// Discord hands back an existing link when the settings match, so each new one lands in a different channel.
export const INVITES = {
  site: "PJm2w3kvEe",     // sidebar and footer, lands in #welcome
  request: "NqkXPP96JD",  // "Vote on Discord" button (home page, Levels 30 to 60), lands in #requests
  feedback: "TMsxNwXTA5", // after sending feedback, lands in #help-and-bugs
  video: "epUXUBmdtd",    // video descriptions, lands in #lore-questions
  bio: "dqch9tfKGv",      // social bios and link-in-bio, lands in #announcements
  addon: "PJm2w3kvEe",    // the add-on's /lore help (no invite of its own; told apart by src here)
  voices: "PJm2w3kvEe",   // the Voices page and the voice-pack guide (same: counted here, shares the site invite)
  translate: "PJm2w3kvEe", // the Translate page, the translator kit and its forms (same: shares the site invite)
};

export const SETUP =
  "CREATE TABLE IF NOT EXISTS discord_clicks (day TEXT NOT NULL, src TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, src))";
