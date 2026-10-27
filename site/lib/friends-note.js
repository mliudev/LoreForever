// What Willo is told about the player's friends (the FRIENDS section Willo's app writes into the prompt:
// companion/lore_companion/answer.py FRIENDS_NOTE and friends.py friend_line). The vision session's blind check (10/18)
// found her guessing a friend's gender ("he was last seen") in about a third of answers, and telling a sighting from days
// ago as where they are now. Willo 0.22.0 and earlier write the note below; the site puts the app's newer note in its
// place (withFriendsNote), so those players get the fix today, without an app update. Keep FRIENDS_NOTE as the app's.
export const OLD_FRIENDS_NOTE = "Other adventurers who are the player's friends, and where each was last seen when they " +
  "share it. Speak of them by name as fellow adventurers out in the world (they/them unless the player says otherwise); " +
  "never mention apps, sites, settings or sharing. If one doesn't share where they are, say you can't tell where their " +
  "road has taken them.";
// Willo 0.23.0 to 0.30.0's: "out in the world right now" for a friend whose Willo is on, which isn't the game (the QA
// Lead, 0.30.0: "Ularli is in the world right now" while Friends showed "Willo connected"). The site puts the newer
// note and words in its place too.
const WORLD_NOTE = "Other adventurers who are the player's friends, whether each is out in the world right now " +
  "or not (when it's known), and where each was last seen when they share it. Speak of them by name as fellow " +
  "adventurers; always they/them, never he or she, unless the player named theirs. Never mention apps, sites, settings " +
  "or sharing. If one doesn't share where they are, say you can't tell where their road has taken them. A sighting " +
  "older than an hour is where they were last seen, never where they are now. Never speak for them or say what they " +
  "think, feel or plan: only what's written here.";
export const FRIENDS_NOTE = "Other adventurers who are the player's friends, whether each has their own Willo with them " +
  "right now or not (when it's known; that isn't whether they're in the game), and where each was last seen when they " +
  "share it. Speak of them by name as fellow adventurers; always they/them, never he or she, unless the player named theirs. Never mention apps, sites, settings " +
  "or sharing. If one doesn't share where they are, say you can't tell where their road has taken them. A sighting " +
  "older than an hour is where they were last seen, never where they are now. Never speak for them or say what they " +
  "think, feel or plan: only what's written here.";

// The prompt with an older app's FRIENDS note replaced by FRIENDS_NOTE (and its friends' "in the world" words by
// their Willo's, companion/lore_companion/friends.py friend_line); any other prompt as it is.
export const withFriendsNote = prompt => {
  if (typeof prompt !== "string") return prompt;
  if (prompt.includes(`FRIENDS\n${OLD_FRIENDS_NOTE}\n`))
    return prompt.replace(`FRIENDS\n${OLD_FRIENDS_NOTE}\n`, `FRIENDS\n${FRIENDS_NOTE}\n`);
  const at = prompt.indexOf(`FRIENDS\n${WORLD_NOTE}\n`);
  if (at < 0) return prompt;
  const end = prompt.indexOf("\n\n", at), block = prompt.slice(at, end < 0 ? undefined : end);
  return prompt.slice(0, at) + block.replace(WORLD_NOTE, FRIENDS_NOTE)
    .replace(/^([^\n:]+): out in the world right now/gm, "$1: their Willo is with them right now")
    .replace(/^([^\n:]+): not in the world right now/gm, "$1: their Willo isn't with them right now")
    + (end < 0 ? "" : prompt.slice(end));
};
