// /voices: the Downloads page's old address (it was the voices page until LOR-222, 2026-10-03). Old links, videos and
// earlier versions of the add-on still say /voices, so it sends them to /downloads for good, keeping any query; the
// browser keeps the #anchor (#install, a voice's #<id>). The voice pages under /voices/ stay where they are.

export function onRequestGet({ request }) {
  const url = new URL(request.url);
  return Response.redirect(new URL("/downloads" + url.search, url).toString(), 301);
}
