#!/usr/bin/env python3
"""Drives a QA build of the Mac installer (build.sh --qa) through real installs on this Mac, against a local server
with small ZIPs. Everything lands in a scratch folder. Run: qa.py "<path to Install Lore Forever.app>".
  fresh install, an update with nothing new, an update with one new part, a pack whose download 404s (the rest still
  installs), a connection that drops mid-file (it resumes from where it stopped), not enough room (stops before any
  download) and a damaged ZIP (never reaches AddOns, the part counts as failed)."""
import http.server
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading
import zipfile

VERSION = "9.9.9"
CORE = ["LoreForever", "LoreForever_Voice_Default"]
RECEIPTS = pathlib.Path.home() / "Library/Application Support/LoreForever/Install/receipts.json"


def make_zip(path, folders, version=VERSION, damaged=False):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as z:
        for folder in folders:
            if not damaged:
                z.writestr(f"{folder}/{folder}.toc", f"## Title: {folder}\n## Version: {version}\n")
            z.writestr(f"{folder}/Audio/clip.mp3", os.urandom(2_000_000))


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "qa"

    def log_message(self, *a):
        pass

    def do_GET(self):
        s = self.server
        name = self.path.rsplit("/", 1)[-1]
        s.hits.append(self.path)
        if self.path.endswith("catalog.json"):
            body = json.dumps(s.catalog).encode()
            self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
            return
        file = s.root / name
        if name in s.missing or not file.exists():
            self.send_error(404)
            return
        data = file.read_bytes()
        rng = self.headers.get("Range")
        start = int(rng.split("=")[1].split("-")[0]) if rng else 0
        if rng:
            s.ranges.append(name)
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{len(data)-1}/{len(data)}")
        else:
            self.send_response(200)
        self.send_header("Content-Length", str(len(data) - start))
        self.end_headers()
        chunk = data[start:]
        if name in s.drop and not rng:
            # Half the file, then the connection goes away.
            s.drop.discard(name)
            self.wfile.write(chunk[: len(chunk) // 2])
            self.wfile.flush()
            self.connection.close()
            return
        self.wfile.write(chunk)


def card(zips):
    return {"ok": True, "lines": ["x"], "zips": zips}


class Bench:
    def __init__(self, app):
        self.binary = pathlib.Path(app) / "Contents/MacOS/Install Lore Forever"
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="lf-qa-"))
        self.root = self.tmp / "www"
        self.root.mkdir()
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.root = self.root
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.server.hits, self.server.ranges, self.server.missing, self.server.drop = [], [], set(), set()
        self.make_packs()
        self.results = []

    def zip_row(self, name, folders):
        size = (self.root / f"{name}.zip").stat().st_size
        return {"url": f"http://127.0.0.1:{self.port}/download/v{VERSION}/{name}.zip", "name": name, "bytes": size, "folders": folders}

    def make_packs(self, extra=False):
        make_zip(self.root / "core.zip", CORE)
        make_zip(self.root / "more.zip", ["LoreForever_Voice_Default_MorePlaces"])
        make_zip(self.root / "quests.zip", ["LoreForever_Voice_Default_Quests"])
        rows = {"core": self.zip_row("core", CORE), "more": self.zip_row("more", ["LoreForever_Voice_Default_MorePlaces"]),
                "quests": self.zip_row("quests", ["LoreForever_Voice_Default_Quests"])}
        self.server.catalog = {"schema": 1, "tag": f"v{VERSION}", "version": VERSION, "langs": [
            {"code": "en", "name": "English", "narrators": [{"id": "male", "name": "Male narrator", "cards": {
                "addon": card([rows["core"]]), "storyteller": card([rows["core"], rows["more"]]),
                "everything": card([rows["core"], rows["more"], rows["quests"]])}}]}]}

    def wow(self, fresh=True):
        game = self.tmp / "World of Warcraft"
        if fresh and game.exists():
            shutil.rmtree(game)
        (game / "_forever_/Interface/AddOns").mkdir(parents=True, exist_ok=True)
        return game

    def run(self, game, pick="male, en, everything", free=None, keep=False):
        if not keep:
            RECEIPTS.unlink(missing_ok=True)
        env = {**os.environ, "LF_AUTORUN": "1", "LF_ROOT": str(game), "LF_DMG_NAME": f"Install Lore Forever ({pick}).dmg",
               "LF_CATALOG_URL": f"http://127.0.0.1:{self.port}/catalog.json"}
        if free is not None:
            env["LF_FREE_BYTES"] = str(free)
        self.server.hits.clear(); self.server.ranges.clear()
        return subprocess.run([str(self.binary)], env=env, timeout=180).returncode

    def installed(self, game):
        addons = game / "_forever_/Interface/AddOns"
        return sorted(p.name for p in addons.iterdir() if (p / f"{p.name}.toc").exists())

    def check(self, name, ok, detail=""):
        self.results.append((name, ok))
        print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail else ""))


def main():
    b = Bench(sys.argv[1])
    everything = CORE + ["LoreForever_Voice_Default_MorePlaces", "LoreForever_Voice_Default_Quests"]

    game = b.wow()
    code = b.run(game)
    b.check("fresh install puts every part in AddOns", code == 0 and b.installed(game) == sorted(everything), f"exit {code}, {b.installed(game)}")
    b.check("the stage folder is gone afterwards", not (game / ".lf-download-stage").exists())

    code = b.run(game, keep=True)  # nothing new, so nothing is fetched
    zips_hit = [h for h in b.server.hits if h.endswith(".zip")]
    b.check("update with nothing new downloads nothing", code == 0 and not zips_hit, f"exit {code}, {zips_hit}")

    b.make_packs()
    (game / "_forever_/Interface/AddOns/LoreForever_Voice_Default_Quests/LoreForever_Voice_Default_Quests.toc").unlink()
    code = b.run(game, keep=True)
    zips_hit = [h.rsplit("/", 1)[-1] for h in b.server.hits if h.endswith(".zip")]
    b.check("update fetches only the missing part", code == 0 and zips_hit == ["quests.zip"], f"exit {code}, {zips_hit}")

    game = b.wow()
    b.server.missing.add("quests.zip")
    code = b.run(game)
    b.server.missing.clear()
    b.check("one part 404s: exit 3, the rest installed", code == 3 and b.installed(game) == sorted(CORE + ["LoreForever_Voice_Default_MorePlaces"]), f"exit {code}, {b.installed(game)}")

    game = b.wow()
    b.server.drop.add("more.zip")
    code = b.run(game)
    b.check("a dropped connection resumes with Range and finishes", code == 0 and "more.zip" in b.server.ranges and b.installed(game) == sorted(everything), f"exit {code}, ranges {b.server.ranges}")

    game = b.wow()
    code = b.run(game, free=1000)
    zips_hit = [h for h in b.server.hits if h.endswith(".zip")]
    b.check("not enough room stops before any download", code == 4 and not zips_hit and not b.installed(game), f"exit {code}, {zips_hit}")

    game = b.wow()
    make_zip(b.root / "more.zip", ["LoreForever_Voice_Default_MorePlaces"], damaged=True)
    b.make_packs_keep = None
    data = b.server.catalog
    for card_ in data["langs"][0]["narrators"][0]["cards"].values():
        for row in card_["zips"]:
            if row["name"] == "more":
                row["bytes"] = (b.root / "more.zip").stat().st_size
    code = b.run(game)
    b.check("a damaged ZIP never reaches AddOns and counts as failed", code == 3 and "LoreForever_Voice_Default_MorePlaces" not in b.installed(game), f"exit {code}, {b.installed(game)}")

    shutil.rmtree(b.tmp, ignore_errors=True)
    failed = [n for n, ok in b.results if not ok]
    print(f"\n{len(b.results) - len(failed)}/{len(b.results)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
