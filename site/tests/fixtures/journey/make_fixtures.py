"""Journey record fixtures for the site's tests: the "Copy my journey record" text of one made-up character, made by
the add-on's own code (JourneyRecord.lua, JR.Text) under the Lua 5.1 WoW mock (pipeline/tests/wow_sim.py, lang_sim.py).

  en.txt           Aelric - Forever, a level 24 Night Elf Druid recorded from level 1 (his whole life), with his journey
                   in numbers (LOR-246)
  en-tricky.txt    the same, plus an NPC and an item whose names have ', ", <, > and &
  en-cut.txt       the same, cut to 3,000 bytes: the oldest entries go and a note says so
  en-midlife.txt   a record that began at level 12 ("from level 12", "Places recorded, in order"), kept before the
                   add-on had a tally: its numbers are only its kills and deaths
  en-0.8.txt       en.txt as the add-on made it before the journey in numbers (not made here: kept, so older add-ons'
                   records are still tested)
  de, fr, es, pt   en.txt read in German, French, Spanish and Brazilian Portuguese: an English client with Options ›
                   Language set to the bundled pack. The add-on's words are translated; the game's own (names of places,
                   quests and items, item quality, standing, month names) stay as the English client gives them.

Brannoc and Lyssa (his group) and Gravenx (who killed him) are other players' names, there for the site to strip.
Journey.lua itself stores a group as race and class ("Dwarf Priest") and no killer at all; JR.Text prints what's there.
Times are UTC. "|" is shown as "/", as JR.Copy does.

Run from pipeline/: uv run python ../site/tests/fixtures/journey/make_fixtures.py
"""

import calendar
import os
import sys
import time
from pathlib import Path

os.environ["TZ"] = "UTC"   # the record's times are local time (date()): fixed, so every machine makes the same files
time.tzset()

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[3] / "pipeline" / "tests"))
import lang_sim  # noqa: E402  (wow_sim's mock, plus a language pack registered the way the client finds it)

LANGS = {"de": "deDE", "fr": "frFR", "es": "esES", "pt": "ptBR"}
DAY0 = calendar.timegm((2026, 9, 14, 0, 0, 0))   # Sep 14, 2026, the day he was made
PT = ["Brannoc", "Lyssa"]


def ev(day, hhmm, lv, k, **fields):
    """An event as Journey.lua keeps it: kind k at level lv, `day` days after DAY0 at hh:mm."""
    h, m = map(int, hhmm.split(":"))
    if "pt" in fields:
        fields["pt"] = list(fields["pt"])   # its own list: lupa's table_from(recursive=True) empties one it has seen
    return {"k": k, "t": DAY0 + day * 86400 + h * 3600 + m * 60, "lv": lv, **fields}


# Where things happened, as the game names them (zone, subzone; out in the wild there's no subzone).
SHADOWGLEN = {"z": "Teldrassil", "s": "Shadowglen"}
SHADOWTHREAD = {"z": "Teldrassil", "s": "Shadowthread Cave"}
DOLANAAR = {"z": "Teldrassil", "s": "Dolanaar"}
TELDRASSIL = {"z": "Teldrassil"}
RUTTHERAN = {"z": "Teldrassil", "s": "Rut'theran Village"}
ENCLAVE = {"z": "Darnassus", "s": "Cenarion Enclave"}
NIGHTHAVEN = {"z": "Moonglade", "s": "Nighthaven"}
AUBERDINE = {"z": "Darkshore", "s": "Auberdine"}
DARKSHORE = {"z": "Darkshore"}
ASTRANAAR = {"z": "Ashenvale", "s": "Astranaar"}
ASHENVALE = {"z": "Ashenvale"}
ZORAM = {"z": "Ashenvale", "s": "The Zoram Strand"}
MAESTRA = {"z": "Ashenvale", "s": "Maestra's Post"}
BFD = {"z": "Blackfathom Deeps"}
MENETHIL = {"z": "Wetlands", "s": "Menethil Harbor"}
COMMONS = {"z": "Ironforge", "s": "The Commons"}
TRADE = {"z": "Stormwind City", "s": "Trade District"}
SENTINEL = {"z": "Westfall", "s": "Sentinel Hill"}
LONGSHORE = {"z": "Westfall", "s": "Longshore"}
VC = {"z": "The Deadmines"}

# Levels 1 to 24, oldest first. A zone event is a new place (how he got there) or a dungeon entry.
EVENTS = [
    ev(0, "18:00", 1, "zone", **SHADOWGLEN, new=True),   # where he was made: no way of getting there
    ev(0, "18:01", 1, "npc", n="Conservator Ilthalaine", **SHADOWGLEN),
    ev(0, "18:19", 2, "lvl", **SHADOWGLEN),
    ev(0, "18:22", 2, "qt", id=456, q="The Balance of Nature", **SHADOWGLEN),
    ev(0, "18:40", 3, "lvl", **SHADOWGLEN),
    ev(0, "18:44", 3, "qt", id=3120, q="Verdant Sigil", **SHADOWGLEN),
    ev(0, "18:57", 3, "zone", **SHADOWTHREAD, new=True, how="walk"),
    ev(0, "19:06", 4, "lvl", **SHADOWTHREAD),
    ev(0, "19:24", 4, "qt", id=916, q="Webwood Venom", **SHADOWGLEN),
    ev(0, "19:26", 4, "spell", n="Rejuvenation", **SHADOWGLEN),
    ev(0, "19:52", 5, "lvl", **SHADOWGLEN),
    ev(0, "20:10", 5, "zone", **DOLANAAR, new=True, how="walk"),
    ev(0, "20:48", 6, "lvl", **DOLANAAR),
    ev(1, "18:47", 7, "lvl", **TELDRASSIL),
    ev(1, "19:03", 7, "qt", id=488, q="Zenn's Bidding", **DOLANAAR),
    ev(1, "19:20", 7, "kill", n="Duskstalker", cls="rare", **TELDRASSIL),
    ev(1, "19:41", 8, "lvl", **TELDRASSIL),
    ev(1, "19:58", 8, "prof", n="Herbalism", r=75, **TELDRASSIL),
    ev(1, "20:25", 9, "lvl", **DOLANAAR),
    ev(1, "20:46", 9, "qt", id=932, q="Twisted Hatred", **DOLANAAR, pt=PT),
    ev(1, "21:20", 10, "lvl", **DOLANAAR),
    ev(1, "21:41", 10, "zone", **ENCLAVE, new=True, how="walk"),
    ev(1, "21:42", 10, "npc", n="Mathrengyl Bearwalker", **ENCLAVE),
    ev(1, "21:44", 10, "spell", n="Teleport: Moonglade", **ENCLAVE),
    ev(1, "21:52", 10, "book", n="The War of the Ancients", **ENCLAVE),
    ev(1, "22:01", 10, "zone", **NIGHTHAVEN, new=True, how="portal"),
    ev(1, "22:04", 10, "shot", **NIGHTHAVEN),
    ev(2, "18:12", 10, "zone", **RUTTHERAN, new=True, how="walk"),
    ev(2, "18:21", 10, "zone", **AUBERDINE, new=True, how="flight"),
    ev(2, "18:23", 10, "npc", n="Gershala Nightwhisper", **AUBERDINE),
    ev(2, "19:10", 11, "lvl", **DARKSHORE),
    ev(2, "19:52", 11, "qt", id=6001, q="Body and Heart", **ENCLAVE),
    ev(2, "19:53", 11, "spell", n="Bear Form", **ENCLAVE),
    ev(2, "20:35", 12, "lvl", **AUBERDINE),
    ev(2, "21:02", 12, "qt", id=4681, q="Washed Ashore", **AUBERDINE),
    ev(3, "18:30", 13, "lvl", **DARKSHORE),
    ev(3, "18:55", 13, "prof", n="Alchemy", r=75, **AUBERDINE),
    ev(3, "19:30", 14, "lvl", **DARKSHORE),
    ev(3, "19:48", 14, "kill", n="Lady Moongazer", cls="rare", **DARKSHORE),
    ev(3, "20:40", 15, "lvl", **AUBERDINE),
    ev(3, "20:44", 15, "rep", n="Darnassus", st=6, was=5, **AUBERDINE),
    ev(3, "21:35", 16, "lvl", **DARKSHORE),
    ev(4, "18:20", 16, "spell", n="Aquatic Form", **NIGHTHAVEN),
    ev(4, "19:05", 17, "lvl", **DARKSHORE),
    ev(4, "20:02", 17, "zone", **ASTRANAAR, new=True, how="flight"),
    ev(4, "20:04", 17, "npc", n="Raene Wolfrunner", **ASTRANAAR),
    ev(4, "21:10", 18, "lvl", **ASHENVALE),
    ev(5, "16:40", 18, "qt", id=1033, q="Elune's Tear", **ASTRANAAR),
    ev(5, "17:15", 19, "lvl", **ASTRANAAR),
    ev(5, "17:48", 19, "zone", **ZORAM, new=True, how="walk"),
    ev(5, "18:05", 19, "death", **ZORAM, by="Gravenx"),   # another player
    ev(5, "18:09", 19, "zone", **MAESTRA, new=True, how="corpse"),
    ev(5, "19:30", 20, "lvl", **ZORAM),
    ev(5, "20:02", 20, "spell", n="Cat Form", **NIGHTHAVEN),
    ev(5, "20:15", 20, "mount", n="Striped Nightsaber", **ENCLAVE),
    ev(6, "17:02", 20, "zone", **BFD, new=True, inst="party", how="instance"),
    ev(6, "17:20", 20, "kill", n="Blackfathom Myrmidon", cls="elite", **BFD, pt=PT),
    ev(6, "17:41", 21, "lvl", **BFD),
    ev(6, "17:55", 21, "boss", n="Ghamoo-ra", **BFD, pt=PT),
    ev(6, "17:56", 21, "loot", n="Tortoise Armor", ql=3, **BFD),
    ev(6, "18:30", 21, "death", **BFD, pt=PT, how="drown"),   # his breath ran out (LOR-262)
    ev(6, "18:36", 21, "zone", **BFD, inst="party", how="instance"),   # back in after the corpse run
    ev(6, "18:58", 21, "qt", id=1198, q="In Search of Thaelrid", **BFD, pt=PT),
    ev(6, "19:40", 22, "lvl", **BFD),
    ev(6, "19:52", 22, "boss", n="Aku'mai", **BFD, pt=PT),
    ev(7, "18:40", 22, "zone", **MENETHIL, new=True, how="boat"),
    ev(7, "19:25", 22, "zone", **COMMONS, new=True, how="walk"),
    ev(7, "19:38", 22, "zone", **TRADE, new=True, how="instance"),   # the Deeprun Tram
    ev(7, "20:10", 22, "zone", **SENTINEL, new=True, how="walk"),
    ev(7, "20:12", 22, "npc", n="Gryan Stoutmantle", **SENTINEL),
    ev(7, "20:14", 22, "qt", id=65, q="The Defias Brotherhood", **SENTINEL),
    ev(7, "20:50", 22, "zone", **LONGSHORE, new=True, how="walk"),
    ev(7, "21:05", 22, "kill", n="Old Murk-Eye", cls="rareelite", **LONGSHORE),
    ev(7, "21:06", 22, "loot", n="Tidecaller's Pendant", ql=4, **LONGSHORE),
    ev(7, "21:31", 22, "death", **LONGSHORE, by="Murloc Forager"),
    ev(7, "22:15", 23, "lvl", **SENTINEL),
    ev(7, "22:18", 23, "rep", n="Stormwind", st=5, was=4, **SENTINEL),
    ev(8, "18:30", 23, "zone", **VC, new=True, inst="party", how="instance"),
    ev(8, "19:40", 24, "lvl", **VC),
    ev(8, "20:05", 24, "boss", n="Edwin VanCleef", **VC, pt=PT),
    ev(8, "20:06", 24, "loot", n="Cape of the Brotherhood", ql=3, **VC),
    ev(8, "20:41", 24, "qt", id=166, q="The Defias Brotherhood", **SENTINEL, pt=PT),
    ev(8, "20:41", 24, "loot", n="Chausses of Westfall", ql=2, qid=166, **SENTINEL),   # its reward
]

# en-tricky only: names to escape.
TRICKY = [
    ev(7, "18:45", 22, "npc", n='Gor\'kan <the "Tamer">', **MENETHIL),
    ev(8, "20:07", 24, "loot", n="Blade & <Script>", ql=3, **VC),
]

# Every foe he has killed: (name, kills, his level at the first). Bosses count too. The Murloc Forager that killed him
# is among the ten most fought, so the record names it as a foe as well (Gravenx, a player, is in no list).
KILLS = [
    ("Grell", 14, 1), ("Young Nightsaber", 9, 1), ("Webwood Spider", 18, 3), ("Gnarlpine Ursa", 12, 6),
    ("Timberling", 21, 7), ("Duskstalker", 1, 7), ("Greymist Coastrunner", 11, 11), ("Rabid Thistle Bear", 16, 12),
    ("Blackwood Pathfinder", 13, 14), ("Lady Moongazer", 1, 14), ("Thistlefur Avenger", 10, 18),
    ("Wrathtail Myrmidon", 8, 19), ("Blackfathom Myrmidon", 6, 20), ("Aku'mai Fisher", 9, 20), ("Ghamoo-ra", 1, 21),
    ("Aku'mai", 1, 22), ("Defias Pillager", 15, 22), ("Old Murk-Eye", 1, 22), ("Murloc Forager", 12, 22),
    ("Defias Miner", 12, 23), ("Edwin VanCleef", 1, 24),
]

# en-midlife: the add-on was installed at level 12, logged in at Auberdine.
MIDLIFE = ev(2, "21:00", 12, "zone", **AUBERDINE, new=True)

# The journey in numbers (Journey.lua's tally, LOR-246): yards walked per land, kills by creature type and rank,
# deaths, time online with the journey on, and a /played he typed (90,000 seconds, at 81,000 of online). en-midlife
# has none: a record from before the tally, whose numbers come from its kills and deaths.
TALLY = {
    "walk": {"Teldrassil": 21400, "Darkshore": 18250, "Ashenvale": 9100, "Westfall": 6420, "Darnassus": 2210,
             "Wetlands": 1300, "Moonglade": 640},
    "kinds": {"Beast": 98, "Humanoid": 61, "Elemental": 21, "Undead": 4},
    "ranks": {"elite": 6, "rare": 2, "rareelite": 1},
    "deaths": 3, "online": 84600, "played": 90000, "playedAt": 81000,
    # LOR-262: how he traveled, his patrons, homes and flights, time per zone, fish, days, his story's length.
    "v": 2, "ride": 14200, "swim": 1880, "flown": 41300, "boats": 2, "fish": 17,
    "days": 9, "best": 6, "streak": 2, "lastDay": "2026-09-22", "words": 21400, "heard": 64,
    "flights": {"Auberdine": 3, "Astranaar": 2, "Rut'theran Village": 2},
    "inns": {"Dolanaar": 1, "Auberdine": 2, "Astranaar": 1},
    "patrons": {"Conservator Ilthalaine": 3, "Gershala Nightwhisper": 4, "Raene Wolfrunner": 2, "Gryan Stoutmantle": 2},
    "time": {"Teldrassil": 50400, "Darkshore": 39600, "Ashenvale": 25200, "Westfall": 12600, "Darnassus": 7200},
}


def record(events, kills, start=1, tally=None):
    """His record as Journey.lua keeps it (LoreForeverDB.journey.chars["Aelric-Forever"]), from these events on.
    start: his level when it began; from level 1 with no quest done before, it's his whole life (Journey.Whole).
    tally: the journey in numbers, if it has them."""
    first = events[0]["t"]
    quests = [e["id"] for e in EVENTS if e["k"] == "qt"]   # the server's list has every quest he ever did
    seen = {"place": {}, "npc": {}, "book": {}, "boss": {}, "mob": {name: first for name, _, _ in kills}}
    for e in events:   # first visits, meetings, books and bosses are each an event, so the counts match the lines
        if e["k"] == "zone" and e.get("new"):
            seen["place"][e["z"] + "|" + e.get("s", "")] = e["t"]
        elif e["k"] in ("npc", "book", "boss"):
            seen[e["k"]][e["n"]] = e["t"]
    out = {"name": "Aelric", "realm": "Forever", "race": "NightElf", "raceName": "Night Elf", "class": "Druid",
           "className": "Druid", "faction": "Alliance", "sex": 2, "level": 24, "first": first, "startLevel": start,
           "startCompleted": sum(1 for e in EVENTS if e["k"] == "qt" and e["t"] < first),
           "completed": sorted(quests), "events": events, "seen": seen, "kills": {name: n for name, n, _ in kills}}
    if tally:
        out["tally"] = {k: dict(v) if isinstance(v, dict) else v for k, v in tally.items()}   # its own tables
    return out


def texts(locale, records):
    """{name: record text} for {name: (record, byte limit or None)}, on a client reading `locale` (None: English)."""
    if locale:
        lang_sim.PACK = f"LoreForever_Lang_{locale}"
    L, g, ns, _ = lang_sim.boot("enUS", language=locale, pack=locale is not None)
    assert ns.lang.locale == (locale or "enUS"), f"{locale}: the pack didn't load {list(ns.lang.notes.values())}"
    out = {}
    for name, (char, limit) in records.items():
        text, cut = ns.JourneyRecord.Text(L.table_from(char, recursive=True), limit)
        assert cut == (limit is not None), f"{name}: cut {cut}"
        out[name] = text.replace("|", "/")
    return out


def main():
    whole = record(EVENTS, KILLS, tally=TALLY)
    files = texts(None, {
        "en": (whole, None),
        "en-tricky": (record(sorted(EVENTS + TRICKY, key=lambda e: e["t"]), KILLS, tally=TALLY), None),
        "en-cut": (whole, 3000),
        "en-midlife": (record([MIDLIFE] + [e for e in EVENTS if e["t"] > MIDLIFE["t"]],
                              [k for k in KILLS if k[2] >= 12], start=12), None),
    })
    for short, locale in LANGS.items():
        files.update(texts(locale, {short: (whole, None)}))
    groups = sum("pt" in e for e in EVENTS)
    for name in ("en", *LANGS):
        assert files[name].count("Brannoc, Lyssa") == groups, f"{name}: a group's names are missing"
    for name, text in files.items():
        (HERE / f"{name}.txt").write_text(text, encoding="utf-8")
        print(f"{name}.txt: {len(text.splitlines())} lines, {len(text.encode())} bytes")


if __name__ == "__main__":
    main()
