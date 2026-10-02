// Which uploads go into a narrator's test pack ("Download my test pack" on /voices/studio). Shared by the page
// (studio.js, to show the count before downloading) and the server (functions/api/studio/[action].js, which builds
// the zip with lib/voicepack.js), so both always agree.
//
// A take goes in while it was recorded against the line's current text in the voice's language, and is a format the
// game plays. A pack holds one format (Clips.lua has a single P.ext): the page converts .wav and .flac to .mp3 before
// upload, so a voice only mixes formats if its narrator uploaded both .mp3 and .ogg files. Then the format most of
// its lines use wins (.mp3 on a tie, like `lore.voicepack studio`) and the others are listed on the page as left out.

export const PLAYABLE = ["mp3", "ogg"];

// takes: {line id: {ext, hash}}; current: {line id: hash of its text in the voice's language}.
// Returns {ext, lines: [line ids in the pack, sorted], stale: [line ids], otherFormat: [line ids]}.
export function planPack(takes, current) {
  const fresh = [], stale = [];
  for (const [id, t] of Object.entries(takes)) {
    if (!current[id]) continue;   // no longer in the list for this language: nothing to play it against
    if (t.hash !== current[id]) stale.push(id);
    else fresh.push(id);
  }
  const count = ext => fresh.filter(id => takes[id].ext === ext).length;
  const ext = count("ogg") > count("mp3") ? "ogg" : "mp3";
  const sort = a => a.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  return {
    ext,
    lines: sort(fresh.filter(id => takes[id].ext === ext)),
    stale: sort(stale),
    otherFormat: sort(fresh.filter(id => takes[id].ext !== ext)),
  };
}

// The add-on folder: the same on every download, so a new one unzips over the old. "Test" keeps it apart from the
// packs we ship (Default, Female) or shipped to testers (Cast, which players may still have installed) and from the pack this voice becomes once it's published
// (LoreForever_Voice_<Name>, the name `lore.voicepack studio` suggests: _pack_name).
export function packName(voiceId) {
  const words = String(voiceId).split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("") || "Studio";
}

export const packFolder = voiceId => `LoreForever_Voice_Test${packName(voiceId)}`;
