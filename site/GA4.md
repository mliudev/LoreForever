# Public-site Google Analytics (CC-99)

GA4 supplements Cloudflare Web Analytics and the first-party **Sources** report. It measures consenting visits to public pages and a small set of public conversion intentions. Sources remains the place for completed sign-ups, Willo connections and paid plans. A download click is an intention, not proof of an installation.

For this first version, a page containing **any query string or fragment** does not load Google or collect GA events, even after consent. The visitor can still save a consent preference there; collection begins on a subsequent eligible clean public URL. This deliberately excludes UTM/`src` landings from GA rather than trusting Google's runtime not to inspect the real browser address. Sources continues to attribute those tracked arrivals. In-place changes to a path, query or fragment stop GA for that document.

## Owner setup

Use Mike's Lore Forever Google account at <https://analytics.google.com/>. Check the account/property selector for an existing Lore Forever property before creating anything. Do not use a Rosebud account. On October 20, the signed-in `mike.liu.dev@gmail.com` browser opened the initial Analytics setup screen. The account/property wizard was prepared through the Terms of Service dialog, but the terms were not accepted and no property or measurement ID has been created/configured by this change.

If needed, create a property named **Lore Forever — public website**, reporting timezone **America/Los_Angeles**, currency **USD**, and a Web stream named **loreforeverwow.com** for **https://loreforeverwow.com**. Reuse an existing matching property/stream instead. Mike must handle any account terms or Data Processing Amendment presented by Google; the code does not accept them.

Before enabling collection:

1. Turn **Enhanced measurement off**, including page changes based on browser history. Also disable automatic event detection in the Google tag settings. The site sends its own approved events; automatic page views, outbound links, downloads, search and form detection can duplicate events or collect unapproved content.
2. Leave Google signals, user-provided data collection, advertising personalization and cross-domain measurement off. Do not link Google Ads. Turn off granular location/device collection if it is not needed. Keep event/user data retention at **2 months**, with reset on new activity off.
3. Enable email-address redaction. Add defensive query redaction for `email`, `email_address`, `name`, `q`, `query`, `search`, `token`, `code`, `state`, `key`, `redirect`, `return`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `src` and `_gl`. This is defense in depth; the site removes all query strings from page locations before events are sent. Redaction does not protect HTTP Referer headers.
4. Copy the Web stream's **Measurement ID** (`G-…`, not a numeric property ID). In Cloudflare Pages → **lore-forever** → Settings → Variables and Secrets, set `GA4_MEASUREMENT_ID` for **Production only** after the settings above are complete. Leave Preview unset. The ID is public configuration, not a secret or a Measurement Protocol API secret.
5. In the **property's** Access management, add `moumiet.patrick@gmail.com` as **Viewer** only. Do not grant account-level access, Editor, Marketer, Administrator, Google Cloud access or Cloudflare access. Leave notification email unchecked; sending an email requires Mike's separate approval. If the interface cannot grant access without sending a message, leave that step for Mike.

Use the existing reviewed site publication flow. A PR/merge does not publish production: `site-live` controls the public domain. Preview branches must stay unable to collect into production GA. Do not take over the shared `develop` preview without coordinating its use. Removing `GA4_MEASUREMENT_ID` and redeploying disables the integration.

## Patrick's workflow

Open the Lore Forever property in Google Analytics. Use **Reports → Realtime** for a just-consented visit, and **Engagement → Pages and screens** to compare public pages/articles after processing. Use **Acquisition → Traffic acquisition** for referring traffic. Reports only include visitors who allowed GA; they will differ from Cloudflare and Sources.

Use the **Events** report for the site's explicit article and conversion-intention events. In Admin → Key events, create `download_click` and `discord_join_click` as key events, counted once per event. These are intention metrics; never label them as completed installations, joins or purchases.

| Event | Meaning | Extra field |
| --- | --- | --- |
| `page_view` | One eligible public page view after consent | `content_group`: page, article or lore |
| `article_view` | Published guide opened on a clean URL | `article_id`: published guide slug |
| `download_click` | Click toward a recognized download route | `download_type`: installer, zip, complete or willo |
| `discord_join_click` | Click toward the site's Discord redirect | None |

Create event-scoped custom dimensions for `article_id` and `download_type` in Admin → Custom definitions if Patrick needs those fields in reports. Page path/title and content group use GA's standard dimensions. The titles sent to GA are fixed categories, not scraped page text. No purchase, sign-up, form, search, chat or account event is sent.

For exact external article attribution, keep using the existing tracked links and **Sources** report: a link such as `/a/<approved-slug>` associates the visit with the article. A normal referrer generally reveals the referring site, not its article path. Do not put a person's identity or email in tracking links. Private Sources dashboard access remains viewer-only.

## Activation acceptance check

Use a clean browser profile on the deployed production page, without a private/account query or any real form content:

- Before consent and after declining, no request to Google tag/analytics domains and no `_ga` cookie.
- Allow analytics: one page view for the public page and the appropriate article event. Inspect network payloads: canonical public path only, no query/hash, no raw referrer path, no account ID, no email, no input text.
- Use the settings control to withdraw: no further GA collection, and GA cookies cleared. Repeat with two open tabs to check withdrawal propagates.
- Visit a URL with any query/fragment, account, admin, guide editor/draft and other excluded pages: no GA loader or event. Check the same on Preview, even if someone accidentally set a Measurement ID there.
- Confirm the event arrives in GA Realtime; verify persisted reports after Google's processing delay. Record the actual property/stream IDs and the deployment commit only after that evidence exists.

The local automated/runtime checks exercise the integration without sending test traffic to Google. They do not establish that a property exists, that Patrick has access, or that Google received a production hit.

## Official implementation references

Checked October 20, 2026:

- [Create/reuse an account, property and Web stream](https://support.google.com/analytics/answer/9304153?hl=en)
- [Manual page views and duplicate prevention](https://developers.google.com/analytics/devguides/collection/ga4/views)
- [Basic consent mode](https://developers.google.com/tag-platform/security/guides/consent)
- [Enhanced measurement and the data each automatic event collects](https://support.google.com/analytics/answer/9216061?hl=en)
- [Privacy controls and disabling collection](https://developers.google.com/tag-platform/security/guides/privacy)
- [Email/query redaction and its limits](https://support.google.com/analytics/answer/13544947?hl=en)
- [Property Viewer permissions](https://support.google.com/analytics/answer/9305587?hl=en)
