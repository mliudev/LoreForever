#!/usr/bin/env python3
"""CHANGELOG.md is the one place release notes are written; this spreads them to the website, GitHub and CurseForge.

  changelog.py notes VERSION        print VERSION's notes (Markdown); falls back to "## Unreleased" if VERSION has
                                    no section yet. Exit 1 if there's nothing to say.
  changelog.py stamp VERSION        rename "## Unreleased" to "## VERSION (today)" and start a fresh, empty Unreleased
  changelog.py site INDEX_HTML      write the version and the changelog tab of the landing page from CHANGELOG.md

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
    index_html.write_text(page[:line_start] + "\n".join(indent + l for l in out) + page[end + len(END):])


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[0] not in ("notes", "stamp", "site"):
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
    else:
        site(Path(arg))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
