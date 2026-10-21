// /voices: the Downloads page's old address (it was the voices page until LOR-222, 2026-10-03). Old links, videos and
// earlier versions of the add-on still say /voices, so it sends them to /downloads for good, keeping any query; the
// browser keeps the #anchor (#install, a voice's #<id>). The voice pages under /voices/ stay where they are.
// It's also the link Mike sent voice actors on 9/30 for recording: from=voices puts "Recording for Lore Forever? Start
// here" (the recorder, /voices/lend) first on the page (functions/downloads/index.js).

export function onRequestGet({ request }) {
  const url = new URL(request.url);
  const to = new URL("/downloads" + url.search, url);
  to.searchParams.set("from", "voices");
  return Response.redirect(to.toString(), 301);
}
