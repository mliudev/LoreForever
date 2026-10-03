"""The files an add-on loads, in the order the WoW client loads them. Shared by scripts/build-release.sh and
scripts/publish-language-packs.sh, the pipeline (lore.compile_lua, lore.i18n, lore.offline) and its tests.

The client reads each .toc once, when it starts: its ## metadata and its file list. /reload doesn't read it again, so
a file newly listed there needs a client restart. An .xml in that list is read on every load (login or /reload), and
its <Script file="..."/> and <Include file="..."/> tags load more files, in order, depth first. So the .toc files list
only an XML load file (LoreForever.xml; Lang.xml in a language pack), and adding, removing or reordering Lua files
changes only the XML (a brand-new file loading on /reload is confirmed in game, 2026-10-02). Paths in an XML file are
relative to its own folder; the client takes \\ or /.

Plain Python 3, no dependencies. Run: python3 scripts/load_order.py addon/LoreForever   (prints the load order)
"""

from __future__ import annotations

import posixpath
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

UI_NS = "http://www.blizzard.com/wow/ui/"
_META = re.compile(r"^##\s*([\w-]+):\s*(.*?)\s*$")
_LOAD_TAGS = {"Script": ".lua", "Include": ".xml"}


class LoadError(ValueError):
    """A load file the client would trip over: malformed XML, a tag other than <Script file> or <Include file>, a path
    outside the add-on's folder, a file that includes itself."""


def parse_toc(text: str) -> tuple[dict[str, str], list[str]]:
    """(## metadata, file lines) of a .toc's text, file lines with / separators. Other # lines are comments."""
    meta, files = {}, []
    for line in text.splitlines():
        m = _META.match(line)
        if m:
            meta[m.group(1)] = m.group(2)
        elif line.strip() and not line.lstrip().startswith("#"):
            files.append(line.strip().replace("\\", "/"))
    return meta, files


def read_toc(path) -> tuple[dict[str, str], list[str]]:
    try:
        return parse_toc(Path(path).read_text(encoding="utf-8-sig"))
    except UnicodeDecodeError as e:
        raise LoadError(f"{Path(path).name}: not UTF-8 ({e.reason} at byte {e.start})") from None


def _local(tag) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else repr(tag)


def xml_refs(text: str, name: str = "load file") -> list[tuple[str, str]]:
    """[(tag, file)] for each <Script file="..."/> and <Include file="..."/> under the file's <Ui>, in order, with /
    separators. Raises LoadError for anything else: the add-on's load files hold nothing but those two tags."""
    try:
        root = ET.fromstring(text.encode("utf-8") if isinstance(text, str) else text)
    except ET.ParseError as e:
        raise LoadError(f"{name}: not well-formed XML ({e})") from None
    if _local(root.tag) != "Ui":
        raise LoadError(f"{name}: the root element is <{_local(root.tag)}>, not <Ui>")
    refs = []
    for el in root:
        tag, file = _local(el.tag), el.get("file")
        ext = _LOAD_TAGS.get(tag)
        if ext is None:
            raise LoadError(f"{name}: <{tag}> isn't a load tag; only <Script file> and <Include file> belong here")
        if not file or (el.text or "").strip() or len(el):
            raise LoadError(f"{name}: <{tag}> needs a file attribute and nothing inside it")
        if not file.lower().endswith(ext):
            raise LoadError(f'{name}: <{tag} file="{file}"> should name a {ext} file')
        refs.append((tag, file.replace("\\", "/")))
    return refs


def load_order(files: list[str], read) -> tuple[list[str], list[str]]:
    """(Lua files in load order, XML load files) for a .toc's file lines, each .xml followed depth first.
    read(path) returns the text of a file in the add-on's folder; paths are relative to that folder, / separators."""
    lua, xml = [], []

    def visit(path: str, chain: list[str]):
        path = posixpath.normpath(path)
        if path.startswith(("../", "/")) or path == ".." or re.match(r"[A-Za-z]:", path):
            raise LoadError(f"{' -> '.join(chain) or '.toc'}: {path} is outside the add-on's folder")
        if not path.lower().endswith(".xml"):
            lua.append(path)
            return
        if path.lower() in (c.lower() for c in chain):
            raise LoadError(f"{path} includes itself: {' -> '.join(chain + [path])}")
        xml.append(path)
        try:
            text = read(path)
        except UnicodeDecodeError as e:
            raise LoadError(f"{path}: not UTF-8 ({e.reason} at byte {e.start})") from None
        for _, ref in xml_refs(text, path):
            visit(posixpath.join(posixpath.dirname(path), ref), chain + [path])

    for f in files:
        visit(f, [])
    return lua, xml


def addon_files(folder, name: str | None = None) -> tuple[dict[str, str], list[str], list[str]]:
    """(.toc metadata, Lua files in load order, XML load files) of the add-on in `folder`, read from disk. Its .toc is
    <name>.toc, the folder's own name unless given."""
    folder = Path(folder)
    meta, files = read_toc(folder / f"{name or folder.name}.toc")
    lua, xml = load_order(files, lambda rel: (folder / rel).read_text(encoding="utf-8"))
    return meta, lua, xml


def render_xml(files: list[str], note: str) -> str:
    """A load file that runs these Lua files in order (paths relative to the XML's folder), with a comment on top."""
    if "--" in note or any(set('"&<>') & set(f) for f in files):
        raise ValueError("render_xml: no '--' in the note and no XML special characters in file names")
    lines = [f'<Ui xmlns="{UI_NS}">', f"  <!-- {note} -->"]
    lines += ['  <Script file="' + f.replace("/", "\\") + '"/>' for f in files]
    return "\n".join(lines + ["</Ui>", ""])


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python3 scripts/load_order.py <add-on folder>")
    try:
        _, lua_files, xml_files = addon_files(sys.argv[1])
    except (LoadError, OSError) as e:
        sys.exit(f"load_order: {e}")
    print("\n".join(lua_files))
    print(f"({len(lua_files)} Lua files through {', '.join(xml_files) or 'the .toc alone'})", file=sys.stderr)
