#!/usr/bin/env bash
# Build the public download: dist/LoreForever-<version>.zip with a single LoreForever/ folder inside.
# Ships the files the .toc loads, Bindings.xml, the narration audio under Audio/ (WoW plays those by path, so
# they're never in the .toc) and the credits file. Nothing else, so pipeline code, eval data and key helpers
# can never slip into the zip. Usage: scripts/build-release.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 - "$ROOT" <<'PY'
import hashlib, re, sys, zipfile
from collections import defaultdict
from pathlib import Path

root = Path(sys.argv[1])
src = root / "addon" / "LoreForever"
toc = src / "LoreForever.toc"
dist = root / "dist"
AUDIO = {".mp3", ".ogg"}
MAX_ZIP = 2 * 1024**3   # CurseForge's per-file limit

def fail(msg):
    sys.exit(f"build-release: {msg}")

text = toc.read_text(encoding="utf-8")
meta = dict(re.findall(r"^##\s*([\w-]+):\s*(.*?)\s*$", text, re.M))
version = meta.get("Version") or fail("no ## Version in LoreForever.toc")
if meta.get("Interface") != "16001":
    fail(f"## Interface is {meta.get('Interface')!r}, expected 16001 (WoW Forever)")

# Files the client loads, in TOC order, plus the extras WoW picks up by name or path.
listed = [l.strip().replace("\\", "/") for l in text.splitlines() if l.strip() and not l.lstrip().startswith("#")]
files = [(src / "LoreForever.toc", "LoreForever.toc")]
files += [(src / p, p) for p in listed]
files += [(src / "Bindings.xml", "Bindings.xml"), (root / "release" / "CREDITS.txt", "CREDITS.txt")]
files += [(p, p.relative_to(src).as_posix()) for p in sorted((src / "Audio").rglob("*")) if p.suffix.lower() in AUDIO]
for path, _ in files:
    if not path.is_file():
        fail(f"missing {path.relative_to(root)}")
text_files = [(p, a) for p, a in files if p.suffix.lower() not in AUDIO]

# Anything in the add-on folder that isn't shipped is probably a mistake worth seeing.
shipped = {p.resolve() for p, _ in files}
for p in src.rglob("*"):
    if p.is_file() and p.resolve() not in shipped:
        print(f"note: not shipped: {p.relative_to(root)}")

# Audio files the code names literally must be in the zip (names built at runtime can't be checked here).
audio_names = {a.lower() for _, a in files if Path(a).suffix.lower() in AUDIO}
for path, arc in text_files:
    for ref in re.findall(r"Audio[\\/]+([\w\-. ]+\.(?:mp3|ogg))", path.read_text(encoding="utf-8", errors="replace"), re.I):
        if "audio/" + ref.lower() not in audio_names:
            fail(f"{arc} plays Audio/{ref}, which isn't in addon/LoreForever/Audio")

# Refuse to ship anything that looks like a credential or a pointer to one.
# Key shapes are matched exactly and case-sensitively, as whole tokens: the generated search index is a long
# base64-like blob, and a loose "AIza..." pattern finds false hits in it.
KEY = re.compile(r"(?<![\w-])(?:AIza[\w-]{35}|sk-(?:ant|proj)-[\w-]{20,}|sk_[0-9a-f]{40,}|sk-[A-Za-z0-9]{40,})(?![\w-])")
NAME = re.compile(r"op://|GEMINI_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|ELEVENLABS_API_KEY|xi-api-key"
                  r"|-----BEGIN [A-Z ]*PRIVATE KEY", re.I)
for path, arc in text_files:
    body = path.read_text(encoding="utf-8", errors="replace")
    m = KEY.search(body) or NAME.search(body)
    if m:
        fail(f"{arc} contains something that looks like a secret: {m.group(0)[:12]}...")

dist.mkdir(exist_ok=True)
out = dist / f"LoreForever-{version}.zip"
with zipfile.ZipFile(out, "w") as z:
    for path, arc in files:
        info = zipfile.ZipInfo(f"LoreForever/{arc}", date_time=(2026, 1, 1, 0, 0, 0))  # stable bytes per version
        # Audio is already compressed; deflating it again only costs time.
        info.compress_type = zipfile.ZIP_STORED if path.suffix.lower() in AUDIO else zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        z.writestr(info, path.read_bytes(), compresslevel=9)

groups = defaultdict(lambda: [0, 0, 0])
with zipfile.ZipFile(out) as z:
    for i in z.infolist():
        parts = i.filename.split("/")
        g = groups[parts[1] + "/" if len(parts) > 2 else "(top level)"]
        g[0] += 1; g[1] += i.file_size; g[2] += i.compress_size
for name, (n, raw, packed) in sorted(groups.items()):
    print(f"  {name:<14} {n:>4} files  {raw / 1024**2:7.1f} MB -> {packed / 1024**2:6.1f} MB in zip")
size = out.stat().st_size
if size > MAX_ZIP:
    fail(f"{out.name} is {size / 1024**3:.2f} GB; CurseForge takes at most 2 GB per file")
digest = hashlib.sha256(out.read_bytes()).hexdigest()
print(f"built {out.relative_to(root)} ({size / 1024**2:.1f} MB) sha256 {digest}")
PY
