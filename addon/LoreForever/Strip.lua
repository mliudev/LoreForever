-- Live game info for the companion app (LOR-416): a tiny block of solid-colour cells in the top-left corner of the
-- screen that the Lore Forever companion on this PC reads several times a second, so Willo knows where you are and what
-- you're fighting right away instead of after a /reload. Off until the player ticks Options > Live game info, and then
-- shown only while the Lore Forever panel is open or while they hold Willo's talk key to ask (Strip.Ask), unless they
-- also tick "show it all the time" (Strip.Showing).
-- (LOR-57: SavedVariables reach the disk only on /reload or logout, the chat log only at logout, and add-ons can't
-- follow the combat log, so nothing else gets game state out while you play.)
--
-- The block: 20 x 7 square cells of 4 screen pixels each, 80 x 28 pixels at any resolution or UI scale, at the very
-- top-left of the game's picture, above every other frame.
--   Row 1      white and black cells in turn, starting with white: the companion finds the block and the cell size by
--              it, and learns what white and black look like on this screen.
--   Rows 2-7   the payload, 3 bits a cell (red, green, blue: each fully on or off; red is the high bit), left to right
--              and then down, each byte's high bit first. 31 bytes are 248 bits, then the target trailer's 5 bytes
--              and the narration's 7 (43 bytes, 344 bits); the cells left over are black. Row 7 came with the
--              narration bytes (LOR-471): companions that read format 2 in rows 2-6 never look at it.
-- The payload, format 2 (numbers big-endian; format 1 was bytes 0-19 and its CRC, in 4 rows):
--   0      0xA2: 0xA marks the block, 2 is the format
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
--          busy (a Lore Forever narration playing or its panel open)
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
-- Then, into row 7, what a Lore Forever narration is doing, so Willo doesn't talk over it even after the block goes
-- away (LOR-471, Strip.Narration), all zeros meaning none plays:
--   36     bit 7 a narration plays, bit 6 it started by itself (an arrival, a flight, a quest giver: Voice.OnGameTalk's
--          kind), bit 5 the time is what's left of it (a complete story, whose length the add-on knows), else how
--          long it has played; bits 0-3 the time's high bits
--   37     the time's low byte: seconds, 0 to 4095
--   38-40  the recording playing: the low 24 bits of the CRC-32 of its path (Voice.lastClip.path), 0 none; the
--          companion finds it among the installed packs' files and reads its length
--   41-42  CRC-16 of bytes 36-40 (a whole one: under a block without row 7 the companion reads the game's picture)
-- companion/lore_companion/strip.py reads it; companion/README.md explains it for players. A new field goes in a new
-- format number, so an older companion says "update the companion" instead of misreading it (the trailer is the one
-- exception: it only adds what an older companion does without). Names never go out: the companion matches the lore
-- hashes against the same add-on's entry keys, and the model id against the add-on's own ModelRaces.lua.
-- Painting is event-driven: an event marks the block stale, and it repaints at most every MIN_GAP seconds.

local _, ns = ...
local Strip = {}
ns.Strip = Strip

Strip.COLS, Strip.ROWS, Strip.PIXELS = 20, 7, 4
Strip.MARK = 0xA2
local COLS, ROWS, PIXELS = Strip.COLS, Strip.ROWS, Strip.PIXELS
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
  "NAME_PLATE_UNIT_ADDED", "SCREENSHOT_STARTED", "SCREENSHOT_SUCCEEDED", "SCREENSHOT_FAILED" }

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

-- A Lore Forever narration playing, or its panel open.
local function busy()
  local UI = ns.UI
  if not UI then return false end
  local ok, playing = pcall(UI.IsBusy)
  if ok and playing then return true end
  return UI.frame and yes(try(UI.frame.IsShown, UI.frame)) or false
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
-- target someone, and the block repaints then). 0 for no one, another player, or a model this client can't read.
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
-- The 31 payload bytes for what the game shows now (a new frame counter each call), then the target trailer's 5 and
-- the narration's 7.
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
  return out
end

-- The colour (0 or 1 for red, green and blue) of each data cell, row by row, for these bytes.
function Strip.Cells(bytes)
  local bits = {}
  for _, b in ipairs(bytes) do
    for i = 7, 0, -1 do bits[#bits + 1] = math.floor(b / 2 ^ i) % 2 end
  end
  local cells = {}
  for c = 1, COLS * (ROWS - 1) do
    cells[c] = { bits[c * 3 - 2] or 0, bits[c * 3 - 1] or 0, bits[c * 3] or 0 }
  end
  return cells
end

local frame, tex, shown, layoutKey = nil, {}, {}, nil
local stale, lastPaint, hiddenForShot = true, -math.huge, false

-- Size the cells to PIXELS screen pixels each: UIParent's height spans the screen's height in pixels, whatever the
-- UI scale. Returns whether it could.
local function layout()
  local _, h = try(GetPhysicalScreenSize)
  if type(h) ~= "number" or h <= 0 then h = 1080 end   -- unknown: cells of about 4 pixels; the companion measures them
  local uh = try(UIParent.GetHeight, UIParent)
  if type(uh) ~= "number" or uh <= 0 then return false end
  local key = h .. ":" .. uh
  if key == layoutKey then return true end
  layoutKey = key
  local cell = PIXELS * uh / h
  frame:SetSize(COLS * cell, ROWS * cell)
  for r = 0, ROWS - 1 do
    for c = 0, COLS - 1 do
      local t = tex[r * COLS + c + 1]
      t:SetSize(cell, cell)
      t:ClearAllPoints()
      t:SetPoint("TOPLEFT", frame, "TOPLEFT", c * cell, -r * cell)
    end
  end
  return true
end

local function paint()
  if not layout() then return end
  local cells = Strip.Cells(Strip.Payload())
  for i, c in ipairs(cells) do
    local t, key = tex[COLS + i], c[1] * 4 + c[2] * 2 + c[3]
    if shown[i] ~= key then
      shown[i] = key
      t:SetColorTexture(c[1], c[2], c[3], 1)
    end
  end
  lastPaint, stale = now(), false
end

-- Something the block shows changed outside its events (the target's model, once it has loaded): repaint soon.
function Strip.Touch() stale = true end

local function onEvent(_, event, unit)
  if (event == "UNIT_HEALTH" or event == "UNIT_MAXHEALTH") and unit ~= "player" and unit ~= "target" then return end
  if (event == "UNIT_LEVEL" or event == "UNIT_FACTION" or event == "UNIT_CLASSIFICATION_CHANGED")
      and unit ~= "player" and unit ~= "target" then
    return
  end
  if event == "DISPLAY_SIZE_CHANGED" or event == "UI_SCALE_CHANGED" then layoutKey = nil end
  -- Keep it out of the player's own screenshots, as far as the game lets it go before the shot.
  if event == "SCREENSHOT_STARTED" then hiddenForShot = true; frame:SetAlpha(0) end
  if event == "SCREENSHOT_SUCCEEDED" or event == "SCREENSHOT_FAILED" then hiddenForShot = false; frame:SetAlpha(1) end
  stale = true
end

local function create()
  frame = CreateFrame("Frame", "LoreForeverLiveStrip", UIParent)
  frame:SetFrameStrata("TOOLTIP")
  pcall(frame.SetFrameLevel, frame, 10000)
  frame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 0, 0)
  frame:EnableMouse(false)
  -- A faded interface (some add-ons fade UIParent) would blend the colours into the game behind them.
  if frame.SetIgnoreParentAlpha then frame:SetIgnoreParentAlpha(true) end
  for i = 1, COLS * ROWS do
    local t = frame:CreateTexture(nil, "OVERLAY")
    local row, col = math.floor((i - 1) / COLS), (i - 1) % COLS
    if row == 0 then
      local v = col % 2 == 0 and 1 or 0   -- the finder row: white, black, white, ...
      t:SetColorTexture(v, v, v, 1)
    else
      t:SetColorTexture(0, 0, 0, 1)
    end
    tex[i] = t
  end
  frame:SetScript("OnEvent", onEvent)
  frame:SetScript("OnUpdate", function()
    local t = now()
    if hiddenForShot or t - lastPaint < MIN_GAP then return end
    if stale or t - lastPaint >= HEARTBEAT then
      if t - lastPaint >= HEARTBEAT then layoutKey = nil end   -- a resized window without an event
      paint()
    end
  end)
end

-- Whether the player turned Live game info on.
function Strip.On() return S().liveStrip == true end

-- Asking Willo out loud: the companion listens while its talk key is held (talk/ptt.py reads the key's state; nothing
-- is sent to the game), and the same key bound here to "Ask Willo" (Bindings.xml, runOnUp) shows the block while it's
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

local function asking()
  local t = now()
  return (askDown ~= nil and t - askDown < ASK_MAX) or t < askUntil
end

-- Whether the block is on screen now: with Live game info on, only while the Lore Forever panel is open or while the
-- player asks Willo, unless they chose to show it all the time (liveStripAlways). Some players took a block of squares
-- that's always there for something hacking the game; this way it shows only while they're using Lore Forever.
function Strip.Showing()
  if not Strip.On() then return false end
  if S().liveStripAlways == true or asking() then return true end
  local UI = ns.UI
  return UI and UI.frame and yes(try(UI.frame.IsShown, UI.frame)) or false
end

-- Bind Willo's talk key (LoreForeverJourneyData.talkKey, written by the companion while talking is on) to Ask Willo,
-- only where the game has nothing on that key: a player's own binding always stays. An Ask Willo key left from an
-- older talk key moves to the new one. WoW loads its saved bindings after login (Mike's had "bind F8 NONE"), which
-- undid a single try at PLAYER_LOGIN, so it's tried again whenever bindings change, on entering the world, after
-- combat (bindings can't change in combat) and a few seconds after login, until the key really is Ask Willo. Once
-- the first minute after login has passed, a key the player clears themselves stays cleared. Whether or not Live game
-- info is on: the key also tells the add-on Willo is answering, so it doesn't start a narration over Willo
-- (Voice.OnWilloAsked, LOR-471); the block shows only with Live game info on.
local ASK, SETTLE = "LOREFOREVER_ASKWILLO", 60
local loginAt
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
  local key = type(data) == "table" and type(data.talkKey) == "string" and data.talkKey ~= "" and data.talkKey or nil
  if not key then return end
  local action = try(GetBindingAction, key)
  if action == ASK then return key end
  if action ~= "" and action ~= nil then return end
  if S().askWilloKey == key and loginAt and now() - loginAt > SETTLE then return end   -- they cleared it: theirs
  local old = type(GetBindingKey) == "function" and try(GetBindingKey, ASK) or nil
  if old and old ~= key then pcall(SetBinding, old) end
  local ok, bound = pcall(SetBinding, key, ASK)
  if ok and bound ~= false then
    S().askWilloKey = key     -- never saved: offered again at the next login (Core.lua)
    return key
  end
end

local binder = CreateFrame("Frame")
for _, e in ipairs({ "PLAYER_ENTERING_WORLD", "UPDATE_BINDINGS", "PLAYER_REGEN_ENABLED" }) do
  pcall(binder.RegisterEvent, binder, e)
end
binder:SetScript("OnEvent", function() Strip.OfferAskKey() end)

-- Show or hide the block to match the settings, the panel and asking (Core.lua at login, Options, /lore live, the
-- panel's OnShow and OnHide in UI.lua, the Ask Willo key); while it's hidden, nothing is registered and nothing runs.
function Strip.Update()
  Strip.OfferAskKey()
  if not Strip.Showing() then
    if frame then
      frame:UnregisterAllEvents()
      frame:Hide()
    end
    return
  end
  if not frame then create() end
  for _, e in ipairs(EVENTS) do pcall(frame.RegisterEvent, frame, e) end
  layoutKey, stale, hiddenForShot = nil, true, false
  frame:SetAlpha(1)
  frame:Show()
  paint()
end
