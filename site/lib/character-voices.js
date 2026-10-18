// Characters who answer in person in a voice of their own (LOR-490 follow-up, Mike, 2026-10-13), by people and gender
// ("dwarf-male"): Inworld TTS 2 Flash in the slot's own Inworld voice, a clone of its reference recording (Mike,
// 2026-10-13 late: "Inworld is overall better"); when Inworld is slow or down, Fish S2.1 Pro on OpenRouter, cloned for
// each reply from the same reference. Willo's hosted voice says the rest (lib/companion-voice.js); on Free and Hero,
// characters speak in Willo's voice, as since #780, unless a finest-voice pack pays.
//
// CHARACTER_VOICES: one entry per slot, people and gender as the companion names them
// (companion/lore_companion/talk/voices.py character_key): r2 (the reference WAV's key in the STUDIO bucket,
// character-voices/<slot>.wav), text (its transcript), cue (delivery cues for Fish, "[gruff, slow]", which go at the
// start of what it says: anything else outside the reply's words is read aloud; Inworld's clone has them in its voice
// already), inworld (optional: the slot's Inworld voice id, a clone of our reference in Willo's Inworld workspace,
// never a published design; without one the slot is Fish's), provenance (where the voice comes from: our own design, a
// consented actor or an open license). An entry whose provenance doesn't name one of those is refused (rightsCleared),
// here and by scripts/character-voices-import.mjs, which writes this object from the voice session's approved
// references (~/lore-voice-renders/experiments/npc-refs/approved/refs.json) and their Inworld clones
// (experiments/compare/inworld_clones.json) and prints the wrangler commands that put each WAV in R2. The Pages
// variable CHARACTER_VOICES (JSON in the same shape) adds or replaces entries without a code change. The reference
// audio is read from R2 by the site alone and never sent to a player.
export const CHARACTER_VOICES = {
  "dwarf-female": {
    "r2": "character-voices/dwarf-female.wav",
    "text": "Och, look at ye, frozen half tae death! Sit yerself down by the fire, an' I'll fetch ye a pint o' Thunderbrew an' a bowl o' stew. No arguin'. Ye can tell me all about the troggs in Coldridge once there's some warmth back in yer bones.",
    "cue": "[strong Scottish Highland brogue] [full-bodied husky female voice, throaty gravelly texture]",
    "inworld": "humble-aspen-1573__lf-char-clone-dwarf-female",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "dwarf-male": {
    "r2": "character-voices/dwarf-male.wav",
    "text": "I've buried more friends than ye've met, youngster. The Dark Irons took my brother at the Gates o' Ironforge, an' I've not forgotten. If ye're goin' intae those mines, go ready tae bleed... an' bring back every last one o' them.",
    "cue": "[strong Scottish Highland brogue, deep guttural gravelly voice]",
    "inworld": "humble-aspen-1573__lf-char-clone-dwarf-male",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "forsaken-female": {
    "r2": "character-voices/forsaken-female.wav",
    "text": "Another one, fresh from the grave. Don't look so lost. You're free now, free of the Lich King's chains. The Scourge still crawl through Tirisfal, and the Scarlet zealots burn whatever they find. Make yourself useful to the Dark Lady... and perhaps you'll earn your place in the Undercity.",
    "cue": "[low smoky female voice, dry papery rasp, cool measured sardonic delivery]",
    "inworld": "humble-aspen-1573__lf-char-clone-forsaken-female",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "forsaken-male": {
    "r2": "character-voices/forsaken-male.wav",
    "text": "Ah... a living visitor. How quaint. Don't flinch, I won't bite. Not today. The Apothecarium needs fresh ingredients, and you look sturdy enough to fetch them. Bring me the venom sacs from Brill's spiders... and try not to die. We have enough of the dead already.",
    "cue": "[dry hollow male baritone, papery rasp, clipped weary sardonic delivery]",
    "inworld": "humble-aspen-1573__lf-char-clone-forsaken-male",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "gnome-female": {
    "r2": "character-voices/gnome-female.wav",
    "text": "Right, so you're the one who volunteered? Good. My shredder's lost a gasket somewhere in Dun Morogh, and frankly, I've no time to go digging through snowdrifts. Find the parts, bring them back, and don't let the leper gnomes chew on them. They do that.",
    "cue": "[bright agile adult female voice] [crisp precise diction, lively curious delivery]",
    "inworld": "humble-aspen-1573__lf-char-clone-gnome-female",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "gnome-male": {
    "r2": "character-voices/gnome-male.wav",
    "text": "Oh! Oh, a visitor! Splendid, splendid. Mind the cogs, they bite. Now, I've nearly finished my mechanical squirrel, I just need a few more gears from the troggs who've overrun Gnomeregan. Simple job, really. Mostly. Probably. Just don't touch the red lever.",
    "cue": "[bright nimble male tenor, crisp precise diction, curious energetic delivery]",
    "inworld": "humble-aspen-1573__lf-char-clone-gnome-male",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "goblin-female": {
    "r2": "character-voices/goblin-female.wav",
    "text": "Listen, sweetheart, in Booty Bay nobody does nothin' for free. The Bloodsail pirates have been raiding my shipments, and that's bad for business. My business. You sink a few of their boats, and I'll make it worth your while. Deal? Deal.",
    "cue": "[bright nasal adult female voice] [strong New York accent, quick witty merchant delivery]",
    "inworld": "humble-aspen-1573__lf-char-clone-goblin-female",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "goblin-male": {
    "r2": "character-voices/goblin-male.wav",
    "text": "Hey, hey, hey! Step right up, pal! Time is money, and lucky for you I got plenty of both. You want explosives? I got explosives. You want a shredder that only catches fire on Tuesdays? I got that too. Today only, friend's price. Don't tell the Cartel.",
    "cue": "[gruff nasal male voice, strong New York accent, quick punchy merchant delivery]",
    "inworld": "humble-aspen-1573__lf-char-clone-goblin-male",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "highelf-female": {
    "r2": "character-voices/highelf-female.wav",
    "text": "Keep low, and keep quiet. The Amani are moving through the Ghostlands, and our rangers are few. I have watched these woods since before your grandfather was born. Follow my lead, and we may both see the dawn over Silvermoon.",
    "cue": "[cultivated precise female voice] [smooth clear tone, restrained aristocratic confidence]",
    "inworld": "humble-aspen-1573__lf-char-clone-highelf-female",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "highelf-male": {
    "r2": "character-voices/highelf-male.wav",
    "text": "Quel'Thalas has endured worse than this, I assure you. The trolls of Zul'Aman test our borders again, and the runestones must be kept strong. If you are capable, the magisters will reward you. If you are not... please, do try to stay out of the way.",
    "cue": "[cultivated precise male voice] [smooth resonant tone, restrained aristocratic confidence]",
    "inworld": "humble-aspen-1573__lf-char-clone-highelf-male",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "human-female": {
    "r2": "character-voices/human-female.wav",
    "text": "You're the one the Marshal sent? Good. We've had bandits on the Westfall road for a week now, and my guards are stretched thin. Take this map, mark every camp you find, and be back before nightfall. Stormwind is counting on you.",
    "cue": "[warm clear adult female voice] [natural conversational phrasing, calm confident delivery]",
    "inworld": "humble-aspen-1573__lf-char-clone-human-female",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "human-male": {
    "r2": "character-voices/human-male.wav",
    "text": "Don't mind the mud, friend, it's been raining in Elwynn for three days straight. The gnolls have been after my fields again, and the guards are spread too thin to help. If you've got a sword and a free afternoon, I'd pay you in silver and the best apple pie in Goldshire.",
    "cue": "[warm grounded male baritone] [natural conversational phrasing, calm confident delivery]",
    "inworld": "humble-aspen-1573__lf-char-clone-human-male",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "nightelf-female": {
    "r2": "character-voices/nightelf-female.wav",
    "text": "Stay close, and keep your voice low. The satyrs have crept back into the eastern glades, and my sisters cannot hold the border alone. You have a steady hand, I can see it. Take this bow. Tonight, we hunt together under Elune's light.",
    "cue": "[rich resonant female voice, measured melodic cadence, calm watchful authority]",
    "inworld": "humble-aspen-1573__lf-char-clone-nightelf-female",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "nightelf-male": {
    "r2": "character-voices/nightelf-male.wav",
    "text": "Ishnu-alah, stranger. You walk beneath the boughs of Teldrassil, where our people have kept watch for longer than your kingdoms have stood. The forest is uneasy. Something stirs in the glades below. Lend us your strength, and Elune will remember it.",
    "cue": "[deep resonant male voice, measured melodic cadence, calm ancient authority]",
    "inworld": "humble-aspen-1573__lf-char-clone-nightelf-male",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "orc-female": {
    "r2": "character-voices/orc-female.wav",
    "text": "Lok'tar ogar. You have come to the Valley of Trials, where every young orc proves their worth. The scorpids in the canyon grow bold, and the Burning Blade hide in the caves. Show me you are not afraid, and the Horde will remember your name.",
    "cue": "[low full-bodied female voice] [rough throaty contralto, firm controlled warrior authority]",
    "inworld": "humble-aspen-1573__lf-char-clone-orc-female",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "orc-male": {
    "r2": "character-voices/orc-male.wav",
    "text": "Lok'tar, stranger. You walk into Orgrimmar like you belong here. Maybe you do. The Horde does not care where you were born... only how you fight. Bring me the heads of the raiders in the canyon, and we will talk.",
    "cue": "[deep heavy male voice] [guttural gravelly texture, firm controlled warrior authority]",
    "inworld": "humble-aspen-1573__lf-char-clone-orc-male",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "skyborne-female": {
    "r2": "character-voices/skyborne-female.wav",
    "text": "Careful near the edge! The ground broke away here only last night. Refugees from Siroccas keep arriving, and they all say the same thing: the other isles are falling. If the winds turn against us too... well. We won't let that happen, will we?",
    "cue": "[clear resonant female voice, flowing melodic cadence, calm thoughtful warmth]",
    "inworld": "humble-aspen-1573__lf-char-clone-skyborne-female",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "skyborne-male": {
    "r2": "character-voices/skyborne-male.wav",
    "text": "Welcome, fledgling. Every Skyborne child stands where you stand now, at the edge of the wind. The spirits that once held Zephras aloft are gone, and the isle grows weaker each season. That is why we need you. Go to the trainers of Thendal Village... and learn what you were born to be.",
    "cue": "[light resonant male voice, flowing melodic cadence, calm thoughtful clarity]",
    "inworld": "humble-aspen-1573__lf-char-clone-skyborne-male",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "tauren-female": {
    "r2": "character-voices/tauren-female.wav",
    "text": "Be at peace, child. The winds of Mulgore carry the voices of our ancestors, and they speak kindly of you. Rest here by the fire. When you are ready, walk to the edge of Red Cloud Mesa and listen. The Earth Mother will tell you what she needs.",
    "cue": "[deep rounded female contralto] [warm earthy resonance, calm deliberate reassuring delivery]",
    "inworld": "humble-aspen-1573__lf-char-clone-tauren-female",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "tauren-male": {
    "r2": "character-voices/tauren-male.wav",
    "text": "The Earth Mother watches over Mulgore, young one. But the centaur do not respect her lands, and the Venture Company tears at her with their machines. Take up your spear. When you have proven yourself at Camp Narache, you will be welcome in Thunder Bluff.",
    "cue": "[very deep rounded male bass] [warm chest resonance, slow deliberate reassuring delivery]",
    "inworld": "humble-aspen-1573__lf-char-clone-tauren-male",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "troll-female": {
    "r2": "character-voices/troll-female.wav",
    "text": "Ahh, ya feel dat too, don't ya? Da spirits be whisperin' tonight. Dey tell me ya got a long road ahead, mon. Sit wit me a while. Breathe slow. Den ya go to da Echo Isles, and ya bring back what da witch doctor took from us.",
    "cue": "[strong natural Jamaican accent] [relaxed lilting rhythm, warm husky female voice]",
    "inworld": "humble-aspen-1573__lf-char-clone-troll-female",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  },
  "troll-male": {
    "r2": "character-voices/troll-male.wav",
    "text": "Hey mon, welcome to Sen'jin Village. Da Darkspear be needin' strong hands, ya know? Dem Kul Tiras soldiers be pokin' around da coast, and da spirits be restless. Go talk to da trainers, get yaself ready. Stay sharp, an' ya might just live long enough to see da Echo Isles.",
    "cue": "[strong natural Jamaican accent] [relaxed lilting rhythm, low textured male voice]",
    "inworld": "humble-aspen-1573__lf-char-clone-troll-male",
    "provenance": "Our own design, generated on Inworld from a written casting brief on 2026-10-13. Not cut from the game client, another add-on, or any recording of a real actor."
  }
};

// Voices of Azeroth (LOR-609, Mike, 2026-10-16): on a plan that picks Willo's voice (Champion and up) she may borrow
// any of these as her everyday voice (lib/companion-voice.js AZEROTH_STUDIO), named as players say them, "Dwarf, man"
// or "Night elf, woman" (companion/lore_companion/talk/tts.py AZEROTH_VOICES says the same). The people, as a name
// starts; how a sentence says one: PEOPLE_WORDS.
export const PEOPLE = { dwarf: "Dwarf", forsaken: "Forsaken", gnome: "Gnome", goblin: "Goblin", highelf: "High elf",
  human: "Human", nightelf: "Night elf", orc: "Orc", skyborne: "Skyborne", tauren: "Tauren", troll: "Troll" };
const PEOPLE_WORDS = { forsaken: "Forsaken", skyborne: "Skyborne" };
const slotParts = slot => {
  const [, people, gender] = /^([a-z]+)-(male|female)$/.exec(String(slot || "")) || [];
  return Object.hasOwn(PEOPLE, people || "") ? { people, man: gender === "male" } : null;
};
// "dwarf-male" -> "Dwarf, man"; "" for a slot that isn't one of our peoples.
export function voiceLabel(slot) {
  const p = slotParts(slot);
  return p ? `${PEOPLE[p.people]}, ${p.man ? "man" : "woman"}` : "";
}
// "dwarf-male" -> "a dwarf man's voice", "nightelf-female" -> "a night elf woman's voice"; "" as voiceLabel.
export function voicePhrase(slot) {
  const p = slotParts(slot);
  if (!p) return "";
  const words = `${PEOPLE_WORDS[p.people] || PEOPLE[p.people].toLowerCase()} ${p.man ? "man" : "woman"}`;
  return `${/^[aeiou]/i.test(words) ? "an" : "a"} ${words}'s voice`;
}

// The first companion with the Voices of Azeroth in its picker, and Willo's male partners (LOR-610) with them, by its
// X-LF-Client ("companion/0.21.0"): any release after 0.20.0. What the site offers or says of them (Willo's help, her
// set_voice offer) waits for one; an older companion only knows her first five.
export const AZEROTH_FROM = [0, 20, 1];
export function hasAzeroth(client) {
  const v = (/^companion\/(\d+)\.(\d+)\.(\d+)/.exec(String(client || "")) || []).slice(1).map(Number);
  return v.length === 3 && (v[0] - AZEROTH_FROM[0] || v[1] - AZEROTH_FROM[1] || v[2] - AZEROTH_FROM[2]) >= 0;
}

// A provenance that names a source we have the rights to: our own design, a consented actor, or an open license.
const RIGHTS = /\b(?:own design|our design|designed by us|consent(?:ed|ing)?|licen[cs]ed?|cc0|cc[- ]by|public domain)\b/i;
export const rightsCleared = provenance => typeof provenance === "string" && RIGHTS.test(provenance);
export const CHARACTER_KEY = /^[a-z]{2,20}-(?:male|female)$/;
const R2_KEY = /^character-voices\/[a-z]{2,20}-(?:male|female)\.wav$/;
const INWORLD_ID = /^[\w.:@-]{1,200}$/;

// Why an entry can't be used, or null when it can.
export function refusal(slot, entry) {
  if (!CHARACTER_KEY.test(slot)) return "not a people and gender";
  if (!entry || typeof entry !== "object") return "not an entry";
  if (!rightsCleared(entry.provenance)) return "no provenance naming our own design, a consented actor or an open license";
  if (typeof entry.r2 !== "string" || !R2_KEY.test(entry.r2)) return "no reference in R2 (character-voices/<slot>.wav)";
  if (typeof entry.text !== "string" || !entry.text.trim()) return "no transcript";
  if (entry.cue !== undefined && (typeof entry.cue !== "string" || !/^(?:\[[^\]\n]{1,80}\]\s*){0,4}$/.test(entry.cue.trim())))
    return "a cue is [bracketed] delivery notes";
  if (entry.inworld !== undefined && (typeof entry.inworld !== "string" || !INWORLD_ID.test(entry.inworld)))
    return "not an Inworld voice id";
  return null;
}

const warned = new Set();
// The usable entries: CHARACTER_VOICES with the Pages variable's over them, each refused one left out (and logged once).
export function characterVoices(env, base = CHARACTER_VOICES) {
  let extra = {};
  try { extra = env?.CHARACTER_VOICES ? JSON.parse(env.CHARACTER_VOICES) : {}; }
  catch (e) { console.warn("character voices: CHARACTER_VOICES isn't JSON; using the ones in the code"); }
  const out = {};
  for (const [slot, entry] of Object.entries({ ...base, ...(extra && typeof extra === "object" ? extra : {}) })) {
    const why = refusal(slot, entry);
    if (!why) {
      out[slot] = { r2: entry.r2, text: entry.text.trim(), cue: (entry.cue || "").trim(),
                    ...(entry.inworld ? { inworld: entry.inworld } : {}) };
      continue;
    }
    if (!warned.has(`${slot}:${why}`)) {
      warned.add(`${slot}:${why}`);
      console.warn(`character voices: ${slot} refused: ${why}`);
    }
  }
  return out;
}
