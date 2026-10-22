// Source files and their index are bundled outside public/, never public endpoints. Serve articles through
// /guides/<slug> so the current CMS draft/deleted state always wins over a bundled file (including on HEAD).
import { privateHeaders } from "../../../lib/guides.js";

export function onRequest() {
  return new Response(null, { status: 404, headers: privateHeaders });
}
