// Site features that wait for an add-on release (the site's flag for unreleased features). While a feature is off,
// its pages still open by address, so previews and the develop site can test them, but they're noindex and nothing
// players see links to them. Turn a feature on by setting it to true here, in the release that ships what it needs
// (it's one line, so it rides along with that day's release); its pages then drop noindex and get their links.
//
//   contribute  /contribute/progress (LOR-238) and the "send Forever text" links on /contributors (LOR-239). On once
//               the add-on release with the Contribute button (LOR-234) is out.
//   zones       "Claim a zone" (LOR-231): the zone box and Zone filter on /voices/studio, /voices/zones (noindex and
//               unlinked while off) and "Zones narrated" on voice profiles. The claims API works either way, and
//               /voices/studio?zones=1 shows the box while it's off. On once Mike has seen it.
//   lore        /lore and the lore entry pages (LOR-233, site/LORE_PAGES.md): indexable, in /lore/sitemap.xml, a
//               Lore link in the header (in SITE_NAV while it's on; site/tests/nav.test.mjs keeps them in step), and
//               player profiles' moments linking their lore pages (LOR-248). On since 2026-10-04 (Mike), with the
//               narration recordings in R2 (scripts/upload-narration-r2.sh).
//   companion   /account's profile section says the companion app can keep the profile up to date by itself
//               (LOR-148), and Harold, the companion's herald, signs the story on player profiles (LOR-266). Linking
//               (/link, /api/device/*, where Harold greets you either way), syncing and "Connected apps" work either
//               way; only the invitation and the signature wait. On once Setup.exe ships the companion (LOR-132).
//   pictures    The "Picture book" on player profiles (lib/pictures.js): the pictures the companion puts on the profile
//               and GET /api/profile/pictures?handle= for visitors. Uploads, Remove and the image addresses work either
//               way, and /u/<handle>?pictures=1 (or ?pictures=1 on the API) shows them while it's off. On once Mike has
//               seen it, with the companion's Picture book setting.
//   storyvoice  Listen on a player profile's story (lib/storyvoice.js, LOR-316): the written story read aloud by the
//               male campfire narrator. While it's off, nothing is recorded and the page has no Listen box. Recording
//               also needs the Pages secret FAL_KEY and his embedding in R2 (experiments/voices/local/story_voice_embed.py).
//               On since 2026-10-05 (Mike), with the male narrator's embedding and FAL_KEY set up.
//
// The Pages variable SITE_FEATURES overrides this file without a code change, e.g. on Preview to test the "on" state:
// a comma-separated list, where "contribute" turns a feature on and "-contribute" turns it off.
export const FEATURES = { contribute: false, zones: false, lore: true, companion: false, pictures: false, storyvoice: true };

export function featureOn(env, name) {
  const over = String(env?.SITE_FEATURES || "").split(",").map(s => s.trim()).filter(Boolean);
  if (over.includes("-" + name)) return false;
  if (over.includes(name)) return true;
  return FEATURES[name] === true;
}
