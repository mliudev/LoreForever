// POST /api/clip-report: one report on a recording (LOR-232), from /clip-report (the add-on's link) or any page's
// report button. Public, no sign-in (a signed-in report counts for more), honeypot `website`, PER_DAY new reports per
// sender (daily IP hash). JSON body: {code} (the add-on's LCR1 code) or {clip, voice, reason, name?, say_as?, note?,
// locale?, source?}; see site/CLIP_REPORT_API.md. Answers {ok: true, id, open, signedIn} (open: that clip's open
// reports in that voice) or {ok: false, error}. A plain form post works too and gets the same JSON.
// The rest (public counts, the admin export, resolve, reject) is in clip-report/[action].js. Logic: lib/clipreports.js.

import { saveReport, fail } from "../../lib/clipreports.js";
import { noStore } from "../../lib/accounts.js";

export async function onRequestPost({ request, env }) {
  const json = (request.headers.get("Content-Type") || "").includes("application/json");
  let input;
  try {
    input = json ? await request.json() : Object.fromEntries(await request.formData());
  } catch (e) {
    return fail(400, "Couldn't read the report.");
  }
  const { status, body } = await saveReport(env, request, input);
  return Response.json(body, { status, headers: noStore });
}
