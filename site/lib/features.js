// Site features that wait for an add-on release (the site's flag for unreleased features). While a feature is off,
// its pages still open by address, so previews and the develop site can test them, but they're noindex and nothing
// players see links to them. Turn a feature on by setting it to true here, in the release that ships what it needs
// (it's one line, so it rides along with that day's release); its pages then drop noindex and get their links.
//
//   contribute  /contribute/progress (LOR-238) and the "send Forever text" links on /contributors (LOR-239). On since
//               2026-10-10 (Mike: features ship on), with the add-on's Contribute button on by default.
//   zones       "Claim a zone" (LOR-231): the zone box and Zone filter on /voices/studio, /voices/zones (noindex and
//               unlinked while off) and "Zones narrated" on voice profiles. The claims API works either way, and
//               /voices/studio?zones=1 shows the box while it's off. On since 2026-10-10.
//   lore        /lore and the lore entry pages (LOR-233, site/LORE_PAGES.md): indexable, in /lore/sitemap.xml, a
//               Lore link in the header (in SITE_NAV while it's on), and
//               player profiles' moments linking their lore pages (LOR-248). On since 2026-10-04 (Mike), with the
//               narration recordings in R2 (scripts/upload-narration-r2.sh).
//   companion   /account's profile section says the companion app can keep the profile up to date by itself
//               (LOR-148), and Willo, the companion, signs the story on player profiles (LOR-266). Linking
//               (/link, /api/device/*, where Willo greets you either way), syncing and "Connected apps" work either
//               way; only the invitation and the signature wait. On since 2026-10-10: Setup.exe has offered the
//               companion since 0.10.0 (LOR-132).
//   pictures    The "Picture book" on player profiles (lib/pictures.js): the pictures the companion puts on the profile
//               and GET /api/profile/pictures?handle= for visitors. Uploads, Remove and the image addresses work either
//               way, and /u/<handle>?pictures=1 (or ?pictures=1 on the API) shows them while it's off. On since
//               2026-10-10, with the companion's Picture book setting on by default.
//   storyvoice  Listen on a player profile's story (lib/storyvoice.js, LOR-316): the written story read aloud by the
//               male campfire narrator. While it's off, nothing is recorded and the page has no Listen box. Recording
//               also needs the Pages secret FAL_KEY and his embedding in R2 (experiments/voices/local/story_voice_embed.py).
//               On since 2026-10-05 (Mike), with the male narrator's embedding and FAL_KEY set up.
//   plans       Paid plans (lib/billing.js, LOR-431): /plans, /willo/style and /account's plan card, checkout, the billing
//               portal and the webhook, and what each plan's companion answers get (20 free a day and a 30-answer
//               starter, lore-focused, without web research or the game picture; more and more kinds on Hero and
//               Champion; the brake), and which voice says them out loud (lib/companion-voice.js,
//               POST /api/companion/speak). While it's off, nothing is for sale and every account gets today's 20
//               free answers a day, with research and pictures, and Willo talks on the PC. Also needs the STRIPE_*
//               secrets. Off until Mike sets SITE_FEATURES=plans in Production for the launch (launch plans decided
//               2026-10-12).
//   azeroth     The Voices of Azeroth (LOR-609) and Willo's five male partners (LOR-610) in what /plans, its compare
//               table and the Stripe blurbs say of her voice picker (lib/billing.js planFeatures): "her own 10,
//               women's and men's, or one of 22 voices of Azeroth's peoples".
//               The voices themselves work either way (lib/companion-voice.js: a companion that has them in its
//               picker says them, and Willo's help and offers wait for that companion, character-voices.js
//               hasAzeroth). Off until the release whose companion has them in its picker (the first after 0.20.0):
//               turn it on in that release.
//   thanks      The thank-you email from Mike to a new subscriber (lib/thanks.js, LOR-640). While it's off, a start is
//               only logged ("would send") and never sent later. It also needs the email service (lib/email.js:
//               CLOUDFLARE_EMAIL_TOKEN). /api/admin "email-test" works either way, and "email-status" says whether it's
//               on. On since 2026-10-17 (Mike: "the email text is approved, turn it on").
//
// The Pages variable SITE_FEATURES overrides this file without a code change, e.g. on Preview to test the "on" state:
// a comma-separated list, where "contribute" turns a feature on and "-contribute" turns it off.
export const FEATURES = { contribute: true, zones: true, lore: true, companion: true, pictures: true, storyvoice: true,
                          plans: false, azeroth: true, thanks: true };

export function featureOn(env, name) {
  const over = String(env?.SITE_FEATURES || "").split(",").map(s => s.trim()).filter(Boolean);
  if (over.includes("-" + name)) return false;
  if (over.includes(name)) return true;
  return FEATURES[name] === true;
}
