-- Live game info for the companion app (LOR-416): Willo's sky, rings of stars in a blue mist over the minimap
-- (Sky.lua), that the Lore Forever companion on this PC reads several times a second, so Willo knows where you are and
-- what you're fighting right away instead of after a /reload. Off until the player ticks Options > Live game info, and
-- then shown only while the Lore Forever panel is open or while they hold Willo's talk key to ask (Strip.Ask), unless
-- they also tick "show it all the time", or said yes in Willo to letting her see the game all the time (Strip.Always).
-- (LOR-57: SavedVariables reach the disk only on /reload or logout, the chat log only at logout, and add-ons can't
-- follow the combat log, so nothing else gets game state out while you play.)
--
-- This file makes the 45 bytes below (Strip.Payload) and decides when they show; Sky.lua paints them: each of 488
-- stars on 10 rings shines or not, the bytes then 16 Reed-Solomon bytes, with three sparkle guide stars on the rim
-- (Sky.lua's header has the layout; companion/lore_companion/sky.py reads it). Until 0.18.0 the same bytes went into
-- a 20 x 7 block of coloured cells in the top-left corner (3 bits a cell, under a white-and-black finder row); the
-- companion still reads that block from older add-ons (strip.py) for one more release.
-- The payload, format 2 (numbers big-endian; format 1 was bytes 0-19 and its CRC, in 4 rows):
--   0      0xA2: 0xA marks live game info, 2 is the format
--   1      frame counter: +1 at every repaint (at least once a second, HEARTBEAT), back to 0 after 255
--   2-3    map: C_Map.GetBestMapForUnit("player"), 0 unknown
--   4-5    instance: GetInstanceInfo()'s map ID (0 Eastern Kingdoms, 1 Kalimdor, a dungeon's own), 65535 unknown
--   6-7    subzone: CRC-16 of GetSubZoneText()'s UTF-8 bytes, 0 none
--   8      your level
--   9      your health in percent, 255 unknown (the game may not say in combat)
--   10-12  target NPC ID, from its GUID: 0 no target, or not a creature
--   13     target level: 0 no target, 255 "??" (too high to show)
--   14     target: its reaction to you (UnitReaction, 1 hated to 8 exalted; 0 unknown) in bits 0-3, its
--          classification in bits 4-6 (CLASSES; 7 any other), bit 7 another player
--   15     flags (FLAG): in combat, dead or a ghost, resting, on a flight, in a raid, target dead, has a target,
--          busy (a Lore Forever narration playing, or its playlist between two)
--   16-18  tracked quest ID: the first one watched, 0 none
--   19     group size (GetNumGroupMembers): 0 solo
--   20     near: the highest level among hostile nameplates in the last NEAR seconds, 0 none, 255 "??"
--   21-24  target lore: CRC-32 (zlib's) of the lore entry key the target has (an npc or topic entry: "Riverpaw
--          Gnoll" is topic:gnoll), 0 none
--   25-28  place lore: CRC-32 of the entry key for where you are (subzone, else zone; zone, city, dungeon or subzone
--          entries), 0 none
--   29-30  CRC-16/CCITT-FALSE (polynomial 0x1021, start 0xFFFF) of bytes 0-28
-- After it, in cells format 2 leaves black, the target trailer, so a character Willo lends a voice to sounds like their
-- race and gender. Older companions never read these cells; a newer one believes them only when their own check
-- matches, and all zeros means nothing known:
--   31-33  the target's model file id (PlayerModel:GetModelFileID, Giver.ModelOf), 0 unknown, not loaded yet, a player
--   34     UnitSex("target") in bits 0-1 (0 unknown, 1 neither, 2 male, 3 female), its creature type in bits 2-6
--          (CreatureType ids: 1 beast, 2 dragonkin, 3 demon, 4 elemental, 5 giant, 6 undead, 7 humanoid, 8 critter,
--          9 mechanical, 10 not specified; 0 unknown)
--   35     CRC-8 (polynomial 0x07, start 0xFF) of bytes 10-12 and 31-34: the trailer is about this target
-- Then what a Lore Forever narration is doing, so Willo doesn't talk over it even after the sky goes
-- away (LOR-471, Strip.Narration), all zeros meaning none plays:
--   36     bit 7 a narration plays, bit 6 it started by itself (an arrival, a flight, a quest giver: Voice.OnGameTalk's
--          kind), bit 5 the time is what's left of it (a complete story, whose length the add-on knows), else how
--          long it has played; bits 0-3 the time's high bits
--   37     the time's low byte: seconds, 0 to 4095
--   38-40  the recording playing: the low 24 bits of the CRC-32 of its path (Voice.lastClip.path), 0 none; the
--          companion finds it among the installed packs' files and reads its length
--   41-42  CRC-16 of bytes 36-40 (its own: the old block's add-ons from before it painted no row 7)
-- Then the target's line of work, so a guard or a flight master Willo hands the word to knows what they do (Strip.Role):
--   43     ROLES' number for it, from the line under its name or the name itself; 0 none known, no target, a player
--   44     CRC-8 of bytes 10-12 and 43: the role is this target's (0 with no role)
-- Beside the 45 bytes, since 0.19, the sky's outer ring carries 5 bytes of its own (Strip.SetRing, LOR-557) with
-- their own repair bytes, which older companions never look at: LOR-547's answer on screen or question asked, and
-- where you stand on the map when it carries neither (LOR-672, spotPage below), or now and then the purse instead
-- (Strip.Purse), so "how much gold do I have?" has the number as it is now (the answer log, 10/18).
-- companion/lore_companion/sky.py reads it; companion/README.md explains it for players. A new field goes in a new
-- format number, so an older companion says "update the companion" instead of misreading it (the trailer and the
-- role are the exceptions: they only add what an older companion does without). Names never go out: the companion
-- matches the lore hashes against the same add-on's entry keys, the model id against the add-on's own
-- ModelRaces.lua, and a role is one of a few kinds of work, never the words it was read from.
-- Painting is event-driven: an event marks the sky stale, and it repaints at most every MIN_GAP seconds.

local _, ns = ...
local Strip = {}
ns.Strip = Strip

Strip.MARK = 0xA2
local MIN_GAP, HEARTBEAT = 0.1, 1   -- seconds: at most ten repaints a second, at least one
local NEAR = 5                       -- seconds a hostile nameplate's level counts after it was seen
local CLASSES = { normal = 0, elite = 1, rare = 2, rareelite = 3, worldboss = 4, trivial = 5, minus = 6 }
local FLAG = { combat = 1, dead = 2, resting = 4, taxi = 8, raid = 16, targetDead = 32, target = 64, busy = 128 }
local TARGET_LORE = { npc = true, topic = true }
local PLACE_LORE = { zone = true, city = true, dungeon = true, subzone = true }
-- What can change a field. Unknown events throw on the Forever beta, so each is registered on its own (pcall).
local EVENTS = { "PLAYER_ENTERING_WORLD", "ZONE_CHANGED", "ZONE_CHANGED_INDOORS", "ZONE_CHANGED_NEW_AREA",
  "PLAYER_LEVEL_UP", "UNIT_HEALTH", "UNIT_MAXHEALTH", "PLAYER_TARGET_CHANGED", "UNIT_LEVEL", "UNIT_FACTION",
  "UNIT_CLASSIFICATION_CHANGED", "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED", "PLAYER_DEAD", "PLAYER_ALIVE",
  "PLAYER_UNGHOST", "PLAYER_UPDATE_RESTING", "PLAYER_CONTROL_LOST", "PLAYER_CONTROL_GAINED", "GROUP_ROSTER_UPDATE",
  "QUEST_WATCH_LIST_CHANGED", "QUEST_WATCH_UPDATE", "QUEST_LOG_UPDATE", "DISPLAY_SIZE_CHANGED", "UI_SCALE_CHANGED",
  "NAME_PLATE_UNIT_ADDED", "SCREENSHOT_STARTED", "SCREENSHOT_SUCCEEDED", "SCREENSHOT_FAILED", "PLAYER_MONEY" }

local function S() return (LoreForeverDB and LoreForeverDB.settings) or {} end
local function now() return (GetTime and GetTime()) or 0 end

local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b, c, d, e, f, g, h = pcall(fn, ...)
  if ok then return a, b, c, d, e, f, g, h end
end

-- A whole number from the game, in 0..max, or nil (missing, secret or not a number).
local function int(v, max)
  if not ns.Context.Usable(v) or type(v) ~= "number" or v ~= v then return nil end
  v = math.floor(v + 0.5)
  if v < 0 or v > max then return nil end
  return v
end

local function yes(v) return ns.Context.Usable(v) and v and v ~= 0 or false end

-- CRC-16/CCITT-FALSE with plain arithmetic: Lua 5.1 has no bit operators, and the game's bit library isn't promised.
local function xor(a, b)
  local r, place = 0, 1
  while a > 0 or b > 0 do
    local x, y = a % 2, b % 2
    if x ~= y then r = r + place end
    a, b, place = (a - x) / 2, (b - y) / 2, place * 2
  end
  return r
end
Strip.xor = xor
local CRC = {}
for i = 0, 255 do
  local c = i * 256
  for _ = 1, 8 do
    c = c >= 0x8000 and xor((c * 2) % 0x10000, 0x1021) or (c * 2) % 0x10000
  end
  CRC[i] = c
end
-- Of a list of bytes (or a string's bytes).
function Strip.CRC(bytes)
  local crc = 0xFFFF
  local n = type(bytes) == "string" and #bytes or #bytes
  for i = 1, n do
    local b = type(bytes) == "string" and bytes:byte(i) or bytes[i]
    crc = xor(CRC[xor(math.floor(crc / 256), b)], (crc % 256) * 256)
  end
  return crc
end

-- CRC-32 as zlib computes it (reflected polynomial 0xEDB88320), of a string: the lore entry keys' hashes.
local CRC32 = {}
for i = 0, 255 do
  local c = i
  for _ = 1, 8 do
    c = c % 2 == 1 and xor(math.floor(c / 2), 0xEDB88320) or math.floor(c / 2)
  end
  CRC32[i] = c
end
function Strip.CRC32(s)
  local crc = 0xFFFFFFFF
  for i = 1, #s do
    crc = xor(CRC32[xor(crc % 256, s:byte(i))], math.floor(crc / 256))
  end
  return xor(crc, 0xFFFFFFFF)
end

-- CRC-8 (polynomial 0x07, start 0xFF) of a list of bytes: the target trailer's own check.
local CRC8 = {}
for i = 0, 255 do
  local c = i
  for _ = 1, 8 do
    c = c >= 0x80 and xor((c * 2) % 256, 0x07) or (c * 2) % 256
  end
  CRC8[i] = c
end
function Strip.CRC8(bytes)
  local crc = 0xFF
  for _, b in ipairs(bytes) do crc = CRC8[xor(crc, b)] end
  return crc
end

-- The hash of an entry key when the entry exists and is one of `types`, else 0.
local loreHashes = {}
local function loreHash(key, types)
  local e = type(key) == "string" and ns.DB and ns.DB.entries and ns.DB.entries[key]
  if not (e and types[e.t]) then return 0 end
  loreHashes[key] = loreHashes[key] or Strip.CRC32(key)
  return loreHashes[key]
end

-- The target's lore entry (a person, or the topic a mob is named after), by name, as the panel finds it.
local targetLore = {}
local function targetLoreHash(has, isPlayer)
  local eng = ns.engine
  if not has or isPlayer or not eng then return 0 end
  local name = try(UnitName, "target")
  if not ns.Context.Usable(name) or type(name) ~= "string" or name == "" then return 0 end
  if targetLore[name] == nil then
    local ok, key = pcall(eng.KeyForName, eng, name)
    targetLore[name] = loreHash(ok and key or nil, TARGET_LORE)
  end
  return targetLore[name]
end

-- Where you are: the subzone's entry, else the area it belongs to, else the zone's.
local place = {}
local function placeLoreHash()
  local eng = ns.engine
  if not eng then return 0 end
  local sub, zone = try(GetSubZoneText), try(GetRealZoneText)
  sub = ns.Context.Usable(sub) and type(sub) == "string" and sub ~= "" and sub or nil
  zone = ns.Context.Usable(zone) and type(zone) == "string" and zone ~= "" and zone or nil
  local id = tostring(sub) .. "\n" .. tostring(zone)
  if place.id == id then return place.hash end
  local hash = 0
  if sub then
    local ok, key = pcall(eng.SubzoneKey, eng, sub, zone)
    hash = loreHash(ok and key or nil, PLACE_LORE)
    local area = hash == 0 and ns.DB.index and ns.DB.index.area
    if area then hash = loreHash(area[ns.Engine.lower(sub)], PLACE_LORE) end
  end
  if hash == 0 and zone then
    local ok, zk = pcall(eng.ZoneKey, eng, zone)
    hash = loreHash(ok and zk and ("zone:" .. zk) or nil, PLACE_LORE)
  end
  place.id, place.hash = id, hash
  return hash
end

-- The highest level among hostile, living, non-player nameplates in the last NEAR seconds: 0 none, 255 "??".
local nearSeen = {}
local function nearLevel()
  local t, NP, best = now(), _G.C_NamePlate, 0
  local plates = NP and try(NP.GetNamePlates)
  for _, p in ipairs(type(plates) == "table" and plates or {}) do
    local unit = type(p) == "table" and (p.namePlateUnitToken or (type(p.UnitFrame) == "table" and p.UnitFrame.unit))
    if type(unit) == "string" and not yes(try(UnitIsPlayer, unit)) and not yes(try(UnitIsDead, unit)) then
      local reaction, lv = try(UnitReaction, unit, "player"), try(UnitLevel, unit)
      if ns.Context.Usable(reaction) and type(reaction) == "number" and reaction <= 3
          and ns.Context.Usable(lv) and type(lv) == "number" and (lv > 0 or lv == -1) then
        best = math.max(best, lv == -1 and 255 or math.min(254, lv))
      end
    end
  end
  if best > 0 then nearSeen[#nearSeen + 1] = { best, t } end
  local keep, out = {}, 0
  for _, s in ipairs(nearSeen) do
    if t - s[2] <= NEAR then
      keep[#keep + 1] = s
      out = math.max(out, s[1])
    end
  end
  nearSeen = keep
  return out
end

-- A Lore Forever narration playing, or its playlist between two. Not the panel being open: reading it isn't a turn
-- Willo has to wait for (LOR-788).
local function busy()
  local UI = ns.UI
  if not UI then return false end
  local ok, playing = pcall(UI.IsBusy)
  return ok and playing and true or false
end

-- What a narration is doing (bytes 36-40): the flags byte with the time's high bits, the time's low byte and the
-- recording's 24-bit hash; 0, 0, 0 when none plays.
local clipHashes = {}
function Strip.Narration()
  local UI, V = ns.UI, ns.Voice
  if not (UI and V and (UI.speaking or (UI.pl and UI.pl.state == "playing"))) then return 0, 0, 0 end
  local flags = 128
  local okAuto, auto = pcall(V.AutoPlayingNow or function() end)
  if okAuto and auto then flags = flags + 64 end
  local secs, last = 0, V.lastClip
  local okPos, pos, dur = pcall(V.Position or function() end)
  if okPos and type(pos) == "number" and type(dur) == "number" and dur >= pos then
    flags, secs = flags + 32, dur - pos
  elseif type(last) == "table" and type(last.started) == "number" then
    secs = now() - last.started
  end
  secs = math.max(0, math.min(4095, math.floor(secs + 0.5)))
  local path, clip = type(last) == "table" and last.path, 0
  if type(path) == "string" then
    clipHashes[path] = clipHashes[path] or Strip.CRC32(path) % 0x1000000
    clip = clipHashes[path]
  end
  return flags + math.floor(secs / 256), secs % 256, clip
end

local subzone = { text = nil, hash = 0 }
local function subzoneHash()
  local text = try(GetSubZoneText)
  if not ns.Context.Usable(text) or type(text) ~= "string" or text == "" then return 0 end
  if text ~= subzone.text then subzone.text, subzone.hash = text, Strip.CRC(text) end
  return subzone.hash
end

-- The first quest you watch, or 0.
local function trackedQuest()
  local QL = _G.C_QuestLog
  if QL and QL.GetQuestIDForQuestWatchIndex then
    return int(try(QL.GetQuestIDForQuestWatchIndex, 1), 0xFFFFFF) or 0
  end
  if (tonumber(try(GetNumQuestWatches)) or 0) < 1 then return 0 end
  local line = try(GetQuestIndexForWatch, 1)
  local info = line and QL and QL.GetInfo and try(QL.GetInfo, line)
  if type(info) == "table" then return int(info.questID, 0xFFFFFF) or 0 end
  local r = line and { pcall(GetQuestLogTitle, line) }
  return int(r and r[1] and r[9], 0xFFFFFF) or 0   -- GetQuestLogTitle's 8th value
end

local function npcID(guid)
  if not ns.Context.Usable(guid) or type(guid) ~= "string" then return 0 end
  local kind, id = guid:match("^(%a+)%-%d+%-%d+%-%d+%-%d+%-(%d+)%-")
  if kind ~= "Creature" and kind ~= "Vehicle" then return 0 end
  return int(tonumber(id), 0xFFFFFF) or 0
end

-- The target's model file id, looked at once per target (Giver.ModelOf's "strip" slot; it can load a moment after you
-- target someone, and the sky repaints then). 0 for no one, another player, or a model this client can't read.
local targetModel = { guid = nil, id = 0 }
local function targetModelID(has, isPlayer)
  local guid = has and not isPlayer and try(UnitGUID, "target")
  if not (ns.Context.Usable(guid) and type(guid) == "string") then
    targetModel.guid, targetModel.id = nil, 0
    return 0
  end
  if targetModel.guid ~= guid then
    targetModel.guid, targetModel.id = guid, 0
    local G = ns.Giver
    if G and G.ModelOf then
      pcall(G.ModelOf, "target", function(fileID)
        if targetModel.guid ~= guid then return end
        targetModel.id = int(fileID, 0xFFFFFF) or 0
        if Strip.Touch then Strip.Touch() end
      end, "strip")
    end
  end
  return targetModel.id
end

-- UnitCreatureType's id (its second value where the client gives one, else the English name's), 0 unknown.
local CREATURE_TYPES = { Beast = 1, Dragonkin = 2, Demon = 3, Elemental = 4, Giant = 5, Undead = 6, Humanoid = 7,
  Critter = 8, Mechanical = 9, ["Not specified"] = 10, Totem = 11, ["Non-combat Pet"] = 12, ["Gas Cloud"] = 13 }
local function creatureType(has, isPlayer)
  if not has or isPlayer then return 0 end
  local name, id = try(UnitCreatureType, "target")
  if ns.Context.Usable(id) and type(id) == "number" then return int(id, 31) or 0 end
  return ns.Context.Usable(name) and CREATURE_TYPES[name] or 0
end

-- The target's line of work (bytes 43-44): ROLES' number, from the line under its name ("Gryphon Master", "Trade
-- Supplies") or the name itself ("Ironforge Guard", "Innkeeper Firebrew"); untitled: the line under the name is only their
-- level, so Willo never lends them a neighbour's work (LOR-629: Finaida Earthbore, beside the Hall of Arms' warrior
-- trainer, was called one). English words only: on a client in another language most say nothing (0).
-- companion/lore_companion/strip.py ROLES has the same numbers.
Strip.ROLES = { guard = 1, gryphon = 2, windrider = 3, hippogryph = 4, bat = 5, flight = 6, innkeeper = 7, banker = 8,
  auctioneer = 9, stable = 10, vendor = 11, trainer = 12, quartermaster = 13, battlemaster = 14, guildmaster = 15,
  untitled = 16 }
-- The line under the name, in this order: a trainer's names a craft ("Blacksmithing Trainer") and a weapon master
-- trains, so they come before what a merchant's line says they sell.
local TITLE_ROLES = {
  { "gryphon master", "gryphon" }, { "wind rider master", "windrider" }, { "hippogryph master", "hippogryph" },
  { "bat handler", "bat" }, { "flight master", "flight" }, { "innkeeper", "innkeeper" }, { "banker", "banker" },
  { "auctioneer", "auctioneer" }, { "stable master", "stable" }, { "battlemaster", "battlemaster" },
  { "guild master", "guildmaster" }, { "tabard", "guildmaster" }, { "quartermaster", "quartermaster" },
  { "trainer", "trainer" }, { "weapon master", "trainer" },
  { "vendor", "vendor" }, { "merchant", "vendor" }, { "goods", "vendor" }, { "suppl", "vendor" }, { "smith", "vendor" },
  { "armorer", "vendor" }, { "bowyer", "vendor" }, { "fletcher", "vendor" }, { "reagent", "vendor" },
  { "poison", "vendor" }, { "food", "vendor" }, { "drink", "vendor" }, { "baker", "vendor" }, { "butcher", "vendor" },
  { "grocer", "vendor" }, { "trade", "vendor" }, { "weapon", "vendor" }, { "monger", "vendor" },
}
-- A name's own words for the work: a guard's, and the titles some names start with ("Gryphon Master Talonaxe").
local NAME_WORDS = { guard = "guard", guards = "guard", guardsman = "guard", guardian = "guard", grunt = "guard",
  sentinel = "guard", watcher = "guard", bluffwatcher = "guard", deathguard = "guard", patroller = "guard",
  mountaineer = "guard", peacekeeper = "guard", watchman = "guard", sentry = "guard", innkeeper = "innkeeper",
  banker = "banker", auctioneer = "auctioneer", battlemaster = "battlemaster", quartermaster = "quartermaster" }
local NAME_TITLES = { { "gryphon master", "gryphon" }, { "wind rider master", "windrider" },
  { "hippogryph master", "hippogryph" }, { "bat handler", "bat" }, { "flight master", "flight" },
  { "stable master", "stable" } }

function Strip.Role(name, title)
  local t = type(title) == "string" and title:lower() or ""
  local n = type(name) == "string" and name:lower() or ""
  if t ~= "" and not t:find("^level ") then
    for _, r in ipairs(TITLE_ROLES) do
      if t:find(r[1], 1, true) then return Strip.ROLES[r[2]] end
    end
  end
  for _, r in ipairs(NAME_TITLES) do
    if n:find(r[1], 1, true) then return Strip.ROLES[r[2]] end
  end
  for word in n:gmatch("%a+") do
    if NAME_WORDS[word] then return Strip.ROLES[NAME_WORDS[word]] end
  end
  return t:find("^level ") and Strip.ROLES.untitled or 0
end

-- The line under the target's name on its tooltip, read off a hidden tooltip of our own: "Gryphon Master", or "Level
-- 55 Humanoid" for someone with none. nil when the client won't say.
local scanTip
local function titleOfTarget()
  if scanTip == nil then
    scanTip = try(CreateFrame, "GameTooltip", "LoreForeverRoleTip", nil, "GameTooltipTemplate") or false
  end
  if not scanTip then return nil end
  local ok = pcall(function()
    scanTip:SetOwner(_G.WorldFrame or UIParent, "ANCHOR_NONE")
    scanTip:ClearLines()
    scanTip:SetUnit("target")
  end)
  local line = ok and _G.LoreForeverRoleTipTextLeft2
  local text = type(line) == "table" and try(line.GetText, line) or nil
  pcall(scanTip.Hide, scanTip)
  if ns.Context.Usable(text) and type(text) == "string" and text ~= "" then return text end
end

-- The target's role, looked at once per target. 0 for no one, another player, or work nothing names.
local targetWork = { guid = nil, role = 0 }
local function targetRole(has, isPlayer)
  local guid = has and not isPlayer and try(UnitGUID, "target")
  if not (ns.Context.Usable(guid) and type(guid) == "string") then
    targetWork.guid, targetWork.role = nil, 0
    return 0
  end
  if targetWork.guid ~= guid then
    local name = try(UnitName, "target")
    name = ns.Context.Usable(name) and type(name) == "string" and name or nil
    local ok, role = pcall(Strip.Role, name, titleOfTarget())
    targetWork.guid, targetWork.role = guid, ok and int(role, 255) or 0
  end
  return targetWork.role
end

local function health()
  local hp, max = try(UnitHealth, "player"), try(UnitHealthMax, "player")
  if not (ns.Context.Usable(hp) and ns.Context.Usable(max)) or type(hp) ~= "number" or type(max) ~= "number"
      or max <= 0 then
    return 255
  end
  return math.max(0, math.min(100, math.floor(hp * 100 / max + 0.5)))
end

local function put(out, v, n)   -- v as n big-endian bytes
  for i = n - 1, 0, -1 do out[#out + 1] = math.floor(v / 256 ^ i) % 256 end
end

local seq = 0
-- The 31 payload bytes for what the game shows now (a new frame counter each call), then the target trailer's 5, the
-- narration's 7 and the target's line of work, 2.
function Strip.Payload()
  seq = (seq + 1) % 256
  local out = { Strip.MARK, seq }
  local C_Map = _G.C_Map
  put(out, int(C_Map and try(C_Map.GetBestMapForUnit, "player"), 0xFFFF) or 0, 2)
  local okInst, inst = pcall(function() return (select(8, GetInstanceInfo())) end)
  put(out, okInst and int(inst, 0xFFFE) or 0xFFFF, 2)
  put(out, subzoneHash(), 2)
  put(out, int(try(UnitLevel, "player"), 255) or 0, 1)
  put(out, health(), 1)
  local has = yes(try(UnitExists, "target"))
  local isPlayer = has and yes(try(UnitIsPlayer, "target"))
  put(out, has and not isPlayer and npcID(try(UnitGUID, "target")) or 0, 3)
  local level = has and try(UnitLevel, "target")
  put(out, not has and 0 or (ns.Context.Usable(level) and level == -1) and 255 or int(level, 254) or 0, 1)
  local reaction = has and int(try(UnitReaction, "target", "player"), 8) or 0
  local cls = has and try(UnitClassification, "target")
  cls = ns.Context.Usable(cls) and CLASSES[cls] or (has and 7 or 0)
  put(out, reaction + cls * 16 + (isPlayer and 128 or 0), 1)
  local flags = 0
  if yes(try(UnitAffectingCombat, "player")) then flags = flags + FLAG.combat end
  if yes(try(UnitIsDeadOrGhost, "player")) then flags = flags + FLAG.dead end
  if yes(try(IsResting)) then flags = flags + FLAG.resting end
  if yes(try(UnitOnTaxi, "player")) then flags = flags + FLAG.taxi end
  if yes(try(IsInRaid)) then flags = flags + FLAG.raid end
  if has and yes(try(UnitIsDead, "target")) then flags = flags + FLAG.targetDead end
  if has then flags = flags + FLAG.target end
  if busy() then flags = flags + FLAG.busy end
  put(out, flags, 1)
  put(out, trackedQuest(), 3)
  put(out, int(try(GetNumGroupMembers), 255) or 0, 1)
  put(out, nearLevel(), 1)
  put(out, targetLoreHash(has, isPlayer), 4)
  put(out, placeLoreHash(), 4)
  put(out, Strip.CRC(out), 2)
  local trailer = {}
  put(trailer, targetModelID(has, isPlayer), 3)
  local sex = has and not isPlayer and int(try(UnitSex, "target"), 3) or 0
  put(trailer, sex + creatureType(has, isPlayer) * 4, 1)
  put(trailer, Strip.CRC8({ out[11], out[12], out[13], trailer[1], trailer[2], trailer[3], trailer[4] }), 1)
  for _, b in ipairs(trailer) do out[#out + 1] = b end
  local high, low, clip = Strip.Narration()
  local narration = {}
  put(narration, high, 1)
  put(narration, low, 1)
  put(narration, clip, 3)
  for _, b in ipairs(narration) do out[#out + 1] = b end
  put(out, Strip.CRC(narration), 2)
  local role = targetRole(has, isPlayer)
  put(out, role, 1)
  put(out, role > 0 and Strip.CRC8({ out[11], out[12], out[13], role }) or 0, 1)
  return out
end

local frame = nil
local showing = false
local stale, lastPaint, hiddenForShot = true, -math.huge, false

local ring = nil   -- the outer ring's 5 bytes (Strip.SetRing), nil for nothing

-- Where you stand, on the outer ring (LOR-672), so "pin this spot" said out loud or typed in Willo's window keeps the
-- spot on the map, as a question copied from the Ask box does: a page of kind 3 (bits 7-6 of byte 0; its low 6 bits
-- 0, or 1 when an answer is still on screen between its pages), then 32 bits, x (10 bits) and y (10 bits) in
-- thousandths of the map in bytes 2-3 (Journey.Here), and the low 12 bits of the CRC-16 (Strip.CRC) of that map, x and
-- y, 2 bytes each: the page is about this map. It goes when the ring carries nothing else (never in a dungeon or on a
-- flight, Journey.Here's nil); while an answer is on screen (kind 1), every SPOT_EVERY-th repaint, only for a Willo
-- that says she knows the page (Strip.SpotFromWillo): an older one takes any other page as the answer gone, and would
-- stop reading it; never over a question going round (kind 2).
local SPOT_EVERY = 4
local spotTurn = 0

local function spotPage(payload, between)
  local here = ns.Journey and ns.Journey.Here and ns.Journey.Here()
  local m, x, y
  if type(here) == "string" then m, x, y = here:match("^(%d+):(%d+):(%d+)$") end
  m, x, y = tonumber(m), tonumber(x), tonumber(y)
  if not (m and x and y) or x > 1000 or y > 1000 or m ~= payload[3] * 256 + payload[4] then return nil end
  local check = Strip.CRC({ math.floor(m / 256) % 256, m % 256, math.floor(x / 256), x % 256,
    math.floor(y / 256), y % 256 }) % 4096
  local v = x * 4194304 + y * 4096 + check            -- x * 2^22 + y * 2^12 + check: 32 bits
  return { 0xC0 + (between and 1 or 0), math.floor(v / 16777216) % 256, math.floor(v / 65536) % 256,
    math.floor(v / 256) % 256, v % 256 }
end
Strip.SpotPage = spotPage

-- Whether the Willo on this PC reads where you stand from the ring (LoreForeverJourneyData.skySpot, LOR-672).
function Strip.SpotFromWillo()
  local data = _G.LoreForeverJourneyData
  return type(data) == "table" and data.skySpot == true
end

-- The purse (the answer log, 10/18: "how much gold do I have in my bag?" three times, and Willo never knew): a page
-- of kind 3 with its low 6 bits 2 (LOR-672's spot reader takes only 0 and 1), then GetMoney()'s copper, big-endian;
-- nil when the game doesn't say. It shares the idle ring with where you stand: every PURSE_EVERY-th repaint, the
-- first after the money changes, and every one where there's no spot (a dungeon, a flight).
local PURSE_EVERY = 4
local purseTurn, purseDue = 0, true

-- The character in the world now (LOR-711), independent of the last disk save: kind 3, low bits 3, then the
-- CRC-32 of Journey.CharKey's UTF-8 bytes. Willo resolves it only against a unique saved gameKey; equal names
-- across accounts or hash collisions stay unknown. Never send Journey.CharKey's fallback "?" as an identity.
function Strip.Identity()
  if not (ns.Journey and ns.Journey.CharKey) then return nil end
  local key, name, realm = ns.Journey.CharKey()
  if type(key) ~= "string" or not name or not realm or name == "?" or realm == "?" then return nil end
  local out = { 0xC3 }
  put(out, Strip.CRC32(key), 4)
  return out
end

local identityTurn = 7
local lastIdentity
local function identityFromWillo()
  local data = _G.LoreForeverJourneyData
  return type(data) == "table" and data.skyIdentity == true
end

-- Whether the Willo on this PC cheers big moments (LoreForeverJourneyData.chimeIns, "big" or "small", LOR-967): its
-- value, or nil. Only a Willo that reads moment pages writes it (an older one takes an unknown page as the answer
-- gone). Ignored once Data.lua is CHIME_FRESH old: it outlives an uninstalled Willo, whose sky would twinkle for no one.
local CHIME_FRESH = 14 * 86400
function Strip.ChimeFromWillo()
  local data = _G.LoreForeverJourneyData
  if type(data) ~= "table" or (data.chimeIns ~= "big" and data.chimeIns ~= "small") then return nil end
  local made = tonumber(data.generated)
  if not made or time() - made > CHIME_FRESH then return nil end
  return data.chimeIns
end

-- A big moment for Willo (Moments.lua, LOR-967): its page (kind 3, low bits 5) rides the outer ring for FLASH seconds,
-- over anything but a question going round. Willo finds the sky at 2 a second when it wasn't up (the Architect: 3 s,
-- one length), so it shows for it, faded in and out (a half-faded read fails its checks, never reads wrong).
local FLASH, FADE = 3, 0.2
local moment

function Strip.Purse()
  local c = tonumber((try(GetMoney)))
  if not c or c < 0 then return nil end
  c = math.min(math.floor(c), 0xFFFFFFFF)
  return { 0xC2, math.floor(c / 0x1000000) % 256, math.floor(c / 0x10000) % 256, math.floor(c / 0x100) % 256, c % 256 }
end

local function idlePage(payload)
  purseTurn = (purseTurn + 1) % PURSE_EVERY
  local purse = (purseDue or purseTurn == 0) and Strip.Purse()
  if purse then
    purseDue = false
    return purse
  end
  return spotPage(payload) or Strip.Purse()
end

local function ringFor(payload)
  -- Idle: first repaint and at least every eight seconds, also where Journey.Here has no map spot. Over an answer,
  -- require its own capability: older spot readers treat any unknown page as the answer gone. Questions stay intact.
  local kind = ring and math.floor(ring[1] / 64)
  if moment and kind ~= 2 then return moment.page end
  if identityFromWillo() and (ring == nil or kind == 1) then
    identityTurn = (identityTurn + 1) % 8
    local identity = Strip.Identity()
    local key = identity and table.concat(identity, ":")
    if identityTurn == 0 or key ~= lastIdentity then
      lastIdentity = key
      if identity then identityTurn = 0; return identity end
    end
  end
  if ring == nil then return idlePage(payload) end
  if math.floor(ring[1] / 64) == 1 and Strip.SpotFromWillo() then
    spotTurn = (spotTurn + 1) % SPOT_EVERY
    if spotTurn == 0 then return spotPage(payload, true) or ring end
  end
  return ring
end

local function paint()
  -- Being moved with Live game info off (/lore sky): just stars to drag, no game info in them.
  if Strip.On() then
    local payload = Strip.Payload()
    ns.Sky.Paint(payload, ringFor(payload))
  else
    ns.Sky.Paint({})
  end
  lastPaint, stale = now(), false
end

-- Something the sky shows changed outside its events (the target's model, once it has loaded): repaint soon.
function Strip.Touch() stale = true end

-- The 5 bytes the sky's outer ring carries from the next repaint on (LOR-557; Sky.RING), or nil for none (5 zeros).
-- What they say is LOR-547's (the answer on screen, a question asked: its byte layout is in that issue); the ring only
-- carries them, with repair bytes of its own, beside the 45 that Willo reads every time.
function Strip.SetRing(bytes)
  ring = type(bytes) == "table" and bytes or nil
  stale = true
end

-- A quest page is going round for Willo to read (Companion.ReadQuestPage): a big moment waits for it.
function Strip.QuestPageUp() return ring ~= nil and ring[1] == 0xC4 end

local function endMoment(m, cut)
  if moment ~= m then return end
  moment, identityTurn = nil, 7
  ns.Sky.SetFade(1)
  if cut and m.aborted then pcall(m.aborted) end
  Strip.Update()
end

-- Send Willo a big moment's page (Moments.lua). held() says why it must stop now (a fight, a cutscene: nil while it
-- may go on), checked every frame; stopped, aborted() is called so it can go again later. False when it can't go now.
function Strip.Moment(page, held, aborted)
  if moment or not Strip.On() then return false end
  local t, own = now(), not Strip.Showing()
  local m = { page = page, from = t, till = t + FLASH, own = own, held = held, aborted = aborted }
  moment = m
  if own then ns.Sky.SetFade(0) end
  Strip.Update()
  if C_Timer and C_Timer.After then C_Timer.After(FLASH + 0.05, function() endMoment(m) end) end
  return true
end

-- Every frame of a twinkle: stop it if something came up, else fade it (only one the sky showed for). True when it
-- ended (the sky may be gone: nothing more to paint this frame).
local function momentFrame(t)
  local m = moment
  if not m then return false end
  local ok, why = pcall(m.held or function() end)
  if not ok or why then endMoment(m, true); return true end
  if t >= m.till then endMoment(m); return true end
  if m.own then ns.Sky.SetFade(math.min(1, (t - m.from) / FADE, (m.till - t) / FADE)) end
  return false
end

local function onEvent(_, event, unit)
  if event == "PLAYER_MONEY" then purseDue = true end
  if (event == "UNIT_HEALTH" or event == "UNIT_MAXHEALTH") and unit ~= "player" and unit ~= "target" then return end
  if (event == "UNIT_LEVEL" or event == "UNIT_FACTION" or event == "UNIT_CLASSIFICATION_CHANGED")
      and unit ~= "player" and unit ~= "target" then
    return
  end
  if event == "DISPLAY_SIZE_CHANGED" or event == "UI_SCALE_CHANGED" then ns.Sky.Relayout() end
  -- Keep it out of the player's own screenshots, as far as the game lets it go before the shot.
  if event == "SCREENSHOT_STARTED" then hiddenForShot = true; ns.Sky.SetHidden(true) end
  if event == "SCREENSHOT_SUCCEEDED" or event == "SCREENSHOT_FAILED" then hiddenForShot = false; ns.Sky.SetHidden(false) end
  stale = true
end

-- The frame that keeps time and hears the game's events for the sky (which is its own frame, Sky.lua): nothing to see.
local function create()
  frame = CreateFrame("Frame", "LoreForeverLiveStrip", UIParent)
  frame:SetSize(1, 1)
  frame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 0, 0)
  frame:EnableMouse(false)
  frame:SetScript("OnEvent", onEvent)
  frame:SetScript("OnUpdate", function()
    local t = now()
    if momentFrame(t) or hiddenForShot or t - lastPaint < MIN_GAP then return end
    if stale or t - lastPaint >= HEARTBEAT then
      if t - lastPaint >= HEARTBEAT then ns.Sky.Relayout() end   -- a resized window or a moved minimap, no event
      paint()
    end
  end)
end

-- Whether Willo says the player turned Live game info on there, after its explanation (LoreForeverJourneyData.liveGame,
-- written by Willo, LOR-544).
function Strip.OnFromWillo()
  local data = _G.LoreForeverJourneyData
  return type(data) == "table" and data.liveGame == true
end

-- Whether Live game info is on: one switch for both apps (LOR-544). The player's own tick or untick in the add-on
-- (Options or /lore live: liveStripChosen) wins, until Willo answers again (Strip.SyncWillo); until they make one,
-- Willo's explained yes counts too (Strip.OnFromWillo). A player who ticked it before the choice was recorded keeps
-- it on. Defaults write liveStrip = false, so that alone isn't a choice.
function Strip.On()
  local s = S()
  if s.liveStripChosen then return s.liveStrip == true end
  return s.liveStrip == true or Strip.OnFromWillo()
end

-- The player turns Live game info on or off in the add-on (/lore live): theirs from now on, over Willo's.
function Strip.Choose(on)
  S().liveStrip, S().liveStripChosen = on and true or false, true
  Strip.Update()
end

-- Asking Willo out loud: the companion listens while its talk key is held (talk/ptt.py reads the key's state; nothing
-- is sent to the game), and the same key bound here to "Ask Willo" (Bindings.xml, runOnUp) shows the sky while it's
-- held and ASK_AFTER seconds after, so the companion reads where you are and who you target for that question. A key
-- whose release the game never saw (let go in another window) stops counting after ASK_MAX.
local ASK_AFTER, ASK_MAX = 2.5, 30
local askDown, askUntil = nil, 0

function Strip.Ask(down)
  local t = now()
  if down then
    askDown = t
  elseif askDown then
    askDown, askUntil = nil, t + ASK_AFTER
  end
  -- Willo is about to answer out loud: narration that started by itself makes way (Voice.OnWilloAsked, LOR-471).
  -- With Live game info off too: nothing leaves the game for this.
  if ns.Voice and ns.Voice.OnWilloAsked then pcall(ns.Voice.OnWilloAsked, down) end
  if C_Timer and C_Timer.After then C_Timer.After((down and ASK_MAX or ASK_AFTER) + 0.05, Strip.Update) end
  Strip.Update()
end
_G.LoreForever_AskWillo = function(keystate) Strip.Ask(keystate ~= "up") end
-- The key for asking the one you're targeting (LOR-658: the talk key always reaches Willo, and the character you target
-- answers on this one): the sky shows the same way, so Willo reads who that is.
_G.LoreForever_AskTarget = function(keystate) Strip.Ask(keystate ~= "up") end

local function asking()
  local t = now()
  return (askDown ~= nil and t - askDown < ASK_MAX) or t < askUntil
end
Strip.Asking = asking   -- (a big moment waits while the player asks Willo, Moments.lua)

-- Whether Willo asked for the sky all the time: the player said yes to "Let Willo see the game all the time" in her
-- hints over the game (LoreForeverJourneyData.skyAlways, written by Willo, LOR-536).
function Strip.AlwaysFromWillo()
  local data = _G.LoreForeverJourneyData
  return type(data) == "table" and data.skyAlways == true
end

-- "Live game info: show it all the time": the player's tick in Options, or Willo's yes (Strip.AlwaysFromWillo) until
-- they tick or untick it here themselves (liveStripAlwaysOwn): their choice in the add-on wins, until Willo answers
-- again (Strip.SyncWillo). It only matters with Live game info on (Strip.On), which nothing turns on but the player
-- (10/12).
function Strip.Always()
  local s = S()
  if s.liveStripAlwaysOwn then return s.liveStripAlways == true end
  return s.liveStripAlways == true or Strip.AlwaysFromWillo()
end

-- The newer choice wins, Willo's or the player's here. A tick or untick in the add-on (liveStripChosen,
-- liveStripAlwaysOwn) only beats Willo's answer as she gave it then: at login this remembers what she said
-- (liveStripSeen, liveStripAlwaysSeen), and when she has said something else since, hers counts again. Without it
-- an old untick here beat her newer yes for good, and the sky showed only while talking to her (LOR-676). For "all
-- the time", nothing remembered counts as "no", so a player stuck that way gets it back on the first login with this.
-- Live game info itself is the player's consent (10/12, 10/15: an untick here wins): nothing remembered starts from
-- her answer as it is now, so only a yes she gives after this login can turn it back on.
function Strip.SyncWillo()
  local s = S()
  if s.liveStripSeen == nil then s.liveStripSeen = Strip.OnFromWillo() end
  for _, k in ipairs({ { "liveStripSeen", "liveStripChosen", Strip.OnFromWillo() },
                       { "liveStripAlwaysSeen", "liveStripAlwaysOwn", Strip.AlwaysFromWillo() } }) do
    local seen, own, willo = k[1], k[2], k[3]
    if (s[seen] == true) ~= willo then s[own], s[seen] = nil, willo end
  end
end

-- Whether the sky is on screen now: with Live game info on, only while the Lore Forever panel is open or while the
-- player asks Willo, unless they chose to show it all the time (Strip.Always). Some players took a block of squares
-- that's always there for something hacking the game; this way it shows only while they're using Lore Forever.
function Strip.Showing()
  if ns.Sky.Moving() then return true end   -- the player is dragging it somewhere (Sky.Move), until they click Done
  if not Strip.On() then return false end
  if Strip.Always() or asking() or moment then return true end
  local UI = ns.UI
  return UI and UI.frame and yes(try(UI.frame.IsShown, UI.frame)) or false
end

-- Bind Willo's talk key (LoreForeverJourneyData.talkKey, written by the companion while talking is on) to Ask Willo,
-- only where the game has nothing on that key: a player's own binding always stays. An Ask Willo key left from an
-- older talk key (one offered here, S().askWilloKey) moves to the new one; one the player picked (/lore key willo, or
-- Key Bindings) stays, and the talk key is bound beside it. WoW loads its saved bindings after login (Mike's had "bind
-- F8 NONE"), which undid a single try at PLAYER_LOGIN, so it's tried again whenever bindings change, on entering the
-- world, after combat (bindings can't change in combat) and a few seconds after login, until the key really is Ask
-- Willo. Once the first minute after login has passed, a key the player clears themselves stays cleared. Whether or
-- not Live game info is on: the key also tells the add-on Willo is answering, so it doesn't start a narration over
-- Willo (Voice.OnWilloAsked, LOR-471); the sky shows only with Live game info on.
-- The key for asking the one you're targeting (LoreForeverJourneyData.targetKey, LOR-658, when the player picked one in
-- Willo) becomes Ask who you're targeting the same way, after the talk key; one offered for it before that isn't
-- it any more is let go, so it's free for the talk key.
-- A talk key that does something else in the game never reaches Ask Willo, so the add-on says so in the chat, once
-- a login, once the bindings have settled (TAKEN_AFTER: the 12 s try, after Core.lua's 10 s repair), with the way out
-- (LOR-528); not when the player has given Ask Willo a key of their own, which Willo follows. Saying so never changes
-- a binding: only a key the player presses does (Hooks.KeyPrompt).
local ASK, ASK_TARGET, SETTLE, TAKEN_AFTER = "LOREFOREVER_ASKWILLO", "LOREFOREVER_ASKTARGET", 60, 11
local loginAt, toldTaken

-- What a key does in the game, in the game's words ("Toggle Bag 4", a macro's or spell's name), or nil.
local function actionName(action)
  local name = _G["BINDING_NAME_" .. action]
  if type(name) ~= "string" and type(GetBindingName) == "function" then
    name = try(GetBindingName, action)
    if name == action then name = nil end
  end
  if type(name) ~= "string" then name = action:match("^MACRO (.+)$") or action:match("^SPELL (.+)$")
    or action:match("^ITEM (.+)$") end
  return type(name) == "string" and name ~= "" and name or nil
end

local function tellTaken(key, action)
  if toldTaken or not loginAt or now() - loginAt < TAKEN_AFTER then return end
  if not (ns.BindingsLoaded and ns.BindingsLoaded()) then return end   -- not the player's real bindings yet
  local own = type(GetBindingKey) == "function" and try(GetBindingKey, ASK) or nil
  if own and own ~= S().askWilloKey then return end
  toldTaken = true
  local L, gold = ns.L, ns.Theme.code.gold
  local shown = try(GetBindingText, key)
  shown = gold .. ((type(shown) == "string" and shown ~= "") and shown or key):gsub("|", "||") .. "|r"
  local link = ns.Hooks and ns.Hooks.Link("/lore key willo", "key", "willo") or "/lore key willo"
  local what = actionName(action)
  local line = what
    and L["%s listens on %s, but here %s is set to %s. Pick another key in %s, or type %s and press the key you want."]
      :format(ns.COMPANION_NAME, shown, shown, what:gsub("|", "||"), ns.COMPANION_NAME, link)
    or L["%s listens on %s, but here %s already does something else. Pick another key in %s, or type %s and press the key you want."]
      :format(ns.COMPANION_NAME, shown, shown, ns.COMPANION_NAME, link)
  DEFAULT_CHAT_FRAME:AddMessage(ns.Theme.CHAT_PREFIX .. line)
end

-- `key` bound to `action` where the game has nothing on it (S()[mine]: the key offered for it before). An older key
-- offered for it moves to this one, unless the player picked that one (S()[own]). Returns the key once it's `action`,
-- or nil and what the game does with the key instead.
local function offer(key, action, mine, own)
  local current = try(GetBindingAction, key)
  if current == action then return key end
  if current ~= "" and current ~= nil then return nil, current end
  if S()[mine] == key and loginAt and now() - loginAt > SETTLE then return end   -- they cleared it: theirs
  local old = type(GetBindingKey) == "function" and try(GetBindingKey, action) or nil
  if old and old ~= key and old == S()[mine] and old ~= (own and S()[own]) then pcall(SetBinding, old) end
  local ok, bound = pcall(SetBinding, key, action)
  if ok and bound ~= false then
    S()[mine] = key     -- never saved: offered again at the next login (Core.lua)
    return key
  end
end

function Strip.OfferAskKey()
  if not ns.BindingsReady then return end -- not before WoW has loaded the saved bindings (Core.lua)
  if not loginAt then                     -- the first try once they're in: try again shortly too
    loginAt = now()
    if C_Timer and C_Timer.After then
      C_Timer.After(5, Strip.OfferAskKey)
      C_Timer.After(12, Strip.OfferAskKey)    -- under 15 s: a short retry, not a long-lived timer
    end
  end
  if try(InCombatLockdown) or type(GetBindingAction) ~= "function"
      or type(SetBinding) ~= "function" then return end
  local data = _G.LoreForeverJourneyData
  local function named(v) return type(v) == "string" and v ~= "" and v or nil end
  local key = type(data) == "table" and named(data.talkKey) or nil
  local target = type(data) == "table" and named(data.targetKey) or nil
  local was = S().askTargetKey
  if was and was ~= target and try(GetBindingAction, was) == ASK_TARGET then
    pcall(SetBinding, was)
    S().askTargetKey = nil
  end
  local bound
  if key then
    local action
    bound, action = offer(key, ASK, "askWilloKey", "askWilloOwn")
    if action then tellTaken(key, action) end
  end
  if target and target ~= key then offer(target, ASK_TARGET, "askTargetKey") end
  return bound
end

local binder = CreateFrame("Frame")
for _, e in ipairs({ "PLAYER_ENTERING_WORLD", "UPDATE_BINDINGS", "PLAYER_REGEN_ENABLED" }) do
  pcall(binder.RegisterEvent, binder, e)
end
binder:SetScript("OnEvent", function() Strip.OfferAskKey() end)

-- Show or hide the sky to match the settings, the panel and asking (Core.lua at login, Options, /lore live, the
-- panel's OnShow and OnHide in UI.lua, the Ask Willo key); while it's hidden, nothing is registered and nothing runs.
function Strip.Update()
  Strip.OfferAskKey()
  if not Strip.Showing() then
    showing = false
    if frame then
      frame:UnregisterAllEvents()
      frame:Hide()
    end
    ns.Sky.Hide()
    return
  end
  if not showing then identityTurn = 7 end  -- the first visible page must reach a short talk-key capture
  showing = true
  if not frame then create() end
  for _, e in ipairs(EVENTS) do pcall(frame.RegisterEvent, frame, e) end
  stale, hiddenForShot = true, false
  ns.Sky.Relayout()
  ns.Sky.SetHidden(false)
  frame:Show()
  paint()
end
