#!/usr/bin/env python3
"""CHANGELOG.md is the one place release notes are written; this spreads them to the website, GitHub and CurseForge.

  changelog.py notes VERSION        print VERSION's notes (Markdown); falls back to "## Unreleased" if VERSION has
                                    no section yet. Exit 1 if there's nothing to say.
  changelog.py stamp VERSION        rename "## Unreleased" to "## VERSION (today)" and start a fresh, empty Unreleased
  changelog.py site INDEX_HTML      write the website's copies from CHANGELOG.md: the landing page's version, its
                                    Changelog tab and its "New in" strip, the What's new page (whats-new.html next to
                                    it) and the newest version in header.js (the What's new dot)
  changelog.py addon NOTES_LUA      write the newest version's notes for the add-on's What's new card (Notes.lua)

Standard library only: the public repo's release workflow runs it too.
"""

import datetime
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHANGELOG = ROOT / "CHANGELOG.md"
HEADING = re.compile(r"^## (Unreleased|\d+\.\d+\.\d+)\b.*$", re.M)
BEGIN, END = "<!-- changelog:begin", "<!-- changelog:end -->"
WN_BEGIN, WN_END = "<!-- whatsnew:begin", "<!-- whatsnew:end -->"   # whats-new.html
NB_BEGIN, NB_END = "<!-- newbar:begin", "<!-- newbar:end -->"       # index.html, under the header
LATEST = re.compile(r'(const LATEST = ")[^"]*(";\s*// changelog)')   # header.js
DATED = re.compile(r"^## (\d+\.\d+\.\d+) \((\d{4})-(\d{2})-(\d{2})\)", re.M)
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]
HIGHLIGHTS = 3   # how many changes the strip and the What's new page lead with


def sections(text: str) -> list[tuple[str, str]]:
    """[(version or 'Unreleased', body)], newest first, in file order."""
    marks = list(HEADING.finditer(text))
    return [(m.group(1), text[m.end():marks[i + 1].start() if i + 1 < len(marks) else len(text)].strip())
            for i, m in enumerate(marks)]


def notes(version: str) -> str:
    found = dict(sections(CHANGELOG.read_text()))
    return found.get(version) or found.get("Unreleased", "")


def stamp(version: str) -> None:
    text = CHANGELOG.read_text()
    if any(v == version for v, _ in sections(text)):
        return   # already stamped (rerun after a failure)
    today = datetime.date.today().isoformat()
    new, n = re.subn(r"^## Unreleased\b.*$", f"## Unreleased\n\n## {version} ({today})", text, count=1, flags=re.M)
    if not n:
        sys.exit(f"changelog: no '## Unreleased' section in {CHANGELOG.name}")
    CHANGELOG.write_text(new)


def _bullets(body: str) -> list[str]:
    """Markdown '- item' lines (with indented continuation lines) -> item texts."""
    items: list[str] = []
    for line in body.splitlines():
        if re.match(r"^\s*[-*] ", line):
            items.append(re.sub(r"^\s*[-*] ", "", line).strip())
        elif line.strip() and items:
            items[-1] += " " + line.strip()
    return items


def _inline(text: str) -> str:
    text = html.escape(text, quote=False)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    return re.sub(r"`(.+?)`", r"<code>\1</code>", text)


def site(index_html: Path) -> None:
    released = [(v, b) for v, b in sections(CHANGELOG.read_text()) if v != "Unreleased"]
    if not released:
        sys.exit("changelog: no released versions in CHANGELOG.md")
    page = index_html.read_text()
    page, n = re.subn(r"(<li>Version <strong>)[^<]*(</strong></li>)", rf"\g<1>{released[0][0]}\g<2>", page)
    if n != 1:
        sys.exit(f"changelog: expected one '<li>Version <strong>...' in {index_html}")
    start, end = page.find(BEGIN), page.find(END)
    if start < 0 or end < start:
        sys.exit(f"changelog: {index_html} has no '{BEGIN} ... {END}' block")
    line_start = page.rfind("\n", 0, start) + 1
    indent = page[line_start:start]
    out = [f"{BEGIN} (written by scripts/changelog.py from CHANGELOG.md; edit that instead) -->"]
    for version, body in released:
        out.append(f"<h3>{version}</h3>")
        out.append("<ul>")
        out += [f"  <li>{_inline(item)}</li>" for item in _bullets(body)]
        out.append("</ul>")
    out.append(END)
    page = page[:line_start] + "\n".join(indent + l for l in out) + page[end + len(END):]
    page = _fill(page, NB_BEGIN, NB_END, newbar(*released[0]), index_html)
    index_html.write_text(page)
    whats_new = index_html.with_name("whats-new.html")
    whats_new.write_text(_fill(whats_new.read_text(), WN_BEGIN, WN_END, whats_new_block(released), whats_new))
    header = index_html.with_name("header.js")
    script, n = LATEST.subn(rf"\g<1>{released[0][0]}\g<2>", header.read_text())
    if n != 1:
        sys.exit(f"changelog: expected one 'const LATEST = \"...\";   // changelog' in {header}")
    header.write_text(script)


def _fill(page: str, begin: str, end: str, lines: list[str], where: Path) -> str:
    """page with the block from `begin ... -->` to `end` replaced by lines, at the begin marker's indent."""
    start, stop = page.find(begin), page.find(end)
    if start < 0 or stop < start:
        sys.exit(f"changelog: {where} has no '{begin} ... {end}' block")
    line_start = page.rfind("\n", 0, start) + 1
    indent = page[line_start:start]
    block = [f"{begin} (written by scripts/changelog.py from CHANGELOG.md; edit that instead) -->", *lines, end]
    return page[:line_start] + "\n".join(indent + l for l in block) + page[stop + len(end):]


def _dates() -> dict[str, str]:
    """{version: "October 3, 2026"} for every dated version heading."""
    return {m.group(1): f"{MONTHS[int(m.group(3)) - 1]} {int(m.group(4))}, {m.group(2)}"
            for m in DATED.finditer(CHANGELOG.read_text())}


def _lead(item: str) -> tuple[str, str]:
    """A change's bold lead-in without its trailing punctuation, and the rest; ("", item) when it has none."""
    m = re.match(r"\*\*(.+?)\*\*\s*(.*)$", item)
    if not m:
        return "", item
    return m.group(1).rstrip(":,;. "), m.group(2)


def _first_sentence(text: str) -> str:
    text = re.split(r"(?<=[.!?])\s+(?=[A-Z])", text.strip(), maxsplit=1)[0]
    return text[:1].upper() + text[1:]


def _anchor(version: str) -> str:
    return "v" + version.replace(".", "-")


def highlights(body: str) -> list[tuple[str, str]]:
    """The first HIGHLIGHTS changes that have a bold lead-in: (lead, rest)."""
    return [x for x in map(_lead, _bullets(body)) if x[0]][:HIGHLIGHTS]


def newbar(version: str, body: str) -> list[str]:
    """The home page's "New in" strip: the newest version's headline changes, each a link to its notes. The inline
    script shows it before the page paints unless you've already caught up (lf-seen, see header.js)."""
    links, sep = [], '<span class="newbar-sep" aria-hidden="true">&middot;</span>'
    for i, (lead, _) in enumerate(highlights(body)):
        cls = ' class="newbar-more"' if i else ""
        links.append(f'<a{cls} href="/whats-new#{_anchor(version)}">{_inline(lead)}</a>')
    return [
        f'<aside class="newbar" id="newbar" data-version="{version}" aria-label="New in {version}" hidden>',
        '  <div class="wrap newbar-in">',
        f'    <span class="tag tag-new">New in {version}</span>',
        f'    {sep.join(links)}',
        '    <a class="newbar-all" href="/whats-new">See what\'s new</a>',
        '  </div>',
        '  <button class="newbar-x" type="button" aria-label="Hide until the next version">&times;</button>',
        '</aside>',
        '<script>(() => { const bar = document.getElementById("newbar"); let seen = null;',
        '  try { seen = localStorage.getItem("lf-seen"); } catch (e) { /* no storage: always show it */ }',
        '  if (seen !== bar.dataset.version) bar.hidden = false; })();</script>',
    ]


def whats_new_block(released: list[tuple[str, str]]) -> list[str]:
    """The What's new page: the newest version open, its headline changes as cards, then every older one folded."""
    dates, out = _dates(), []
    for i, (version, body) in enumerate(released):
        items = _bullets(body)
        count = f"{len(items)} change{'s' if len(items) != 1 else ''}"
        when = f'<span class="wn-date">{dates[version]}</span>' if version in dates else ""
        out.append(f'<article class="wn-ver" id="{_anchor(version)}" data-version="{version}">')
        if i == 0:
            out.append(f'  <div class="wn-head"><h2>{version}</h2>{when}</div>')
            out.append('  <div class="wn-hl">')
            for lead, rest in highlights(body):
                out.append(f'    <section class="wn-card"><h3>{_inline(lead)}</h3><p>{_inline(_first_sentence(rest))}</p></section>')
            out.append("  </div>")
            out.append(f'  <details class="wn-all" open><summary>All {count} in {version}</summary>')
        else:
            out.append(f'  <details class="wn-all"><summary><h2>{version}</h2>{when}'
                       f'<span class="wn-n">{count}</span></summary>')
        out.append("    <ul>")
        out += [f"      <li>{_inline(item)}</li>" for item in items]
        out.append("    </ul>")
        out.append("  </details>")
        out.append("</article>")
    return out


def _lua(text: str) -> str:
    """A Lua string literal (double-quoted, escaped)."""
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def _plain(text: str) -> str:
    """Markdown to the game's text: no ** or backticks, and > for the arrow the game's fonts may not have."""
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"`(.+?)`", r"\1", text)
    return text.replace("\u203a", ">").strip()


def addon(notes_lua: Path) -> None:
    """The newest released version's notes as Lua, for the add-on's What's new card (WhatsNew.lua): each change as
    {lead-in without its trailing punctuation, the rest, the lead-in as written}; a change with no bold lead-in has
    an empty first and third field."""
    released = [(v, b) for v, b in sections(CHANGELOG.read_text()) if v != "Unreleased"]
    if not released:
        sys.exit("changelog: no released versions in CHANGELOG.md")
    version, body = released[0]
    out = ["-- The newest version's notes, for the What's new card (WhatsNew.lua). Written by scripts/changelog.py addon",
           "-- from CHANGELOG.md at each release: edit that, not this.", "", "local _, ns = ...", "ns.Notes = {",
           f"  version = {_lua(version)},", "  items = {"]
    for item in _bullets(body):
        m = re.match(r"\*\*(.+?)\*\*\s*(.*)$", item)
        raw, rest = (m.group(1), m.group(2)) if m else ("", item)
        lead = raw.rstrip(":,;. ")
        out.append(f"    {{ {_lua(_plain(lead))}, {_lua(_plain(rest))}, {_lua(_plain(raw))} }},")
    out += ["  },", "}", ""]
    notes_lua.write_text("\n".join(out))


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[0] not in ("notes", "stamp", "site", "addon"):
        print(__doc__, file=sys.stderr)
        return 2
    cmd, arg = argv
    if cmd == "notes":
        body = notes(arg)
        if not body:
            print(f"changelog: nothing under '## {arg}' or '## Unreleased' in CHANGELOG.md", file=sys.stderr)
            return 1
        print(body)
    elif cmd == "stamp":
        stamp(arg)
    elif cmd == "addon":
        addon(Path(arg))
    else:
        site(Path(arg))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
