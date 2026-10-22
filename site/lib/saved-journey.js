// The journey Willo's app on the PC synced (POST /api/profile/sync, lib/journey.js readJourney: at most MAX_MOMENTS
// of the character the profile shows), for a question asked where that journey isn't: Willo for iPhone (LOR-672).
// Read only when a question needs it (a pin by where their last save left them, a question about their own past):
// one indexed read of the profile's row.
import { profileOf } from "./profiles.js";
import { pageOf } from "./willo-notebook.js";

// {journey, name, theirs, level}: journey null when none was synced (or no profile); theirs false when the profile is another
// character than the one asking (current: the notebook's page, "char:Húrin-ClassicBetaPvE"), whose journey isn't
// theirs to tell. Never throws: a failed read is no journey.
export async function savedJourney(env, userId, current = null) {
  try {
    return journeyFrom(await profileOf(env, userId), current);
  } catch (e) {
    console.warn(`saved journey: ${e?.message || e}`);
    return { journey: null, name: "", theirs: true };
  }
}

// The same from a profile already read (lib/profiles.js profileOf), for a caller that reads it in a batch with others.
export function journeyFrom(p, current = null) {
  try {
    if (!p) return { journey: null, name: "", theirs: true };
    const name = String(p.data?.name || ""), realm = String(p.data?.realm || "");
    const page = name && realm ? pageOf(`${name}-${realm}`) : null;
    // The add-on keys a character by its realm's normalized name (Journey.CharKey), as the record names it; spaces and
    // case aside in case a realm is ever written both ways.
    const same = (a, b) => a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();
    const theirs = !current || current === "account" || !page || same(page, current);
    // level: the character's level as the profile last had it (for a level after the journey's last level-up).
    const level = Number.isInteger(p.data?.level) ? p.data.level : null;
    return { journey: p.journey?.moments?.length ? p.journey : null, name, theirs, level };
  } catch (e) {
    console.warn(`saved journey: ${e?.message || e}`);
    return { journey: null, name: "", theirs: true };
  }
}
