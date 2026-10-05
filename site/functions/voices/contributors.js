// /voices/contributors: the contributors page's old address (narrators only, until LOR-239 made it /contributors on
// 2026-10-04). Account pages, voice profiles and old links say it, so it sends them on for good, keeping any query;
// the browser keeps the #anchor (a narrator's #c-<name>).

export function onRequestGet({ request }) {
  const url = new URL(request.url);
  return Response.redirect(new URL("/contributors" + url.search, url).toString(), 301);
}
