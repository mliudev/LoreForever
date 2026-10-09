-- Builds a snapshot of what the UI can see about the player: place, character, quests, items, professions.
-- Every API call is guarded: Forever runs the modern client API, but some functions may be missing in the beta.

local _, ns = ...
local Context = {}
ns.Context = Context

local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b, c, d, e, f = pcall(fn, ...)
  if ok then return a, b, c, d, e, f end
  return nil
end

local RACE_NAMES = { NightElf = "Night Elf", Scourge = "Undead", BloodElf = "Blood Elf", HighmountainTauren =
  "Highmountain Tauren", LightforgedDraenei = "Lightforged Draenei" }

local function titleCase(s)
  return s and (s:sub(1, 1):upper() .. s:sub(2):lower()) or nil
end

function Context.Place()
  local place = {
    zone = try(GetRealZoneText) or try(GetZoneText),
    subzone = try(GetSubZoneText),
    minimap = try(GetMinimapZoneText),
  }
  if place.subzone == "" then place.subzone = nil end
  local C_Map = _G.C_Map
  if C_Map then
    place.mapID = try(C_Map.GetBestMapForUnit, "player")
    if place.mapID then
      local info = try(C_Map.GetMapInfo, place.mapID)
      place.mapName = info and info.name
    end
  end
  local inInstance, instanceType = try(IsInInstance)
  place.instance = inInstance and instanceType or nil
  return place
end

function Context.Character()
  local raceName, raceFile = try(UnitRace, "player")
  local className, classFile = try(UnitClass, "player")
  return {
    race = raceFile == "Scourge" and "Undead" or raceFile,      -- e.g. "NightElf": matches lore angle keys
    raceName = RACE_NAMES[raceFile or ""] or raceName,           -- e.g. "Night Elf": for display and live prompts
    class = titleCase(classFile),                                -- e.g. "Warrior"
    className = className,
    level = try(UnitLevel, "player"),
    faction = try(UnitFactionGroup, "player"),
    name = try(UnitName, "player"),
    sex = try(UnitSex, "player"),
  }
end

-- Active quests with objectives, each with its quest log heading (usually its zone). Uses C_QuestLog (modern) and
-- falls back to the classic globals.
function Context.Quests()
  local quests = {}
  local QL = _G.C_QuestLog
  if QL and QL.GetNumQuestLogEntries and QL.GetInfo then
    local n, header = try(QL.GetNumQuestLogEntries) or 0, nil
    for i = 1, n do
      local info = try(QL.GetInfo, i)
      if info and info.isHeader then header = info.title end
      if info and not info.isHeader and not info.isHidden and info.questID and info.questID > 0 then
        local q = { id = info.questID, title = info.title, level = info.level, complete = nil, objectives = {},
          header = header }
        local objs = try(QL.GetQuestObjectives, info.questID)
        for _, o in ipairs(objs or {}) do
          if o.text and o.text ~= "" then q.objectives[#q.objectives + 1] = o.text end
        end
        q.complete = try(QL.IsComplete, info.questID)
        quests[#quests + 1] = q
      end
    end
  elseif GetNumQuestLogEntries then
    local n, header = try(GetNumQuestLogEntries) or 0, nil
    for i = 1, n do
      local title, level, _, isHeader, _, isComplete, _, questID = try(GetQuestLogTitle, i)
      if title and isHeader then header = title end
      if title and not isHeader then
        quests[#quests + 1] = { id = questID, title = title, level = level, complete = isComplete == 1, objectives = {},
          header = header }
      end
    end
  end
  return quests
end

-- Quest items and notable items in the bags.
function Context.Items()
  local questItems, CC = {}, _G.C_Container
  local seen = {}
  for bag = 0, (NUM_BAG_SLOTS or 4) do
    local slots = CC and try(CC.GetContainerNumSlots, bag) or try(GetContainerNumSlots, bag) or 0
    for slot = 1, slots do
      local info = CC and try(CC.GetContainerItemInfo, bag, slot)
      local itemID = info and info.itemID
      local qinfo = CC and try(CC.GetContainerItemQuestInfo, bag, slot)
      local isQuest = qinfo and (qinfo.isQuestItem or qinfo.questID)
      if itemID and isQuest and not seen[itemID] then
        seen[itemID] = true
        local name = info.itemName
          or (_G.C_Item and try(C_Item.GetItemNameByID, itemID))
          or (info.hyperlink and info.hyperlink:match("%[(.-)%]"))
        questItems[#questItems + 1] = name or ("item " .. itemID)
      end
    end
  end
  return questItems
end

-- Profession names with skill. Modern GetProfessions first, then the classic skill-line list.
function Context.Professions()
  local out = {}
  if GetProfessions then
    local list = { try(GetProfessions) }
    for _, idx in pairs(list) do
      if idx then
        local name, _, rank = try(GetProfessionInfo, idx)
        if name then out[#out + 1] = { name = name, rank = rank } end
      end
    end
  end
  if #out == 0 and GetNumSkillLines then
    local inProf = false
    for i = 1, (try(GetNumSkillLines) or 0) do
      local name, isHeader, _, rank = try(GetSkillLineInfo, i)
      if isHeader then
        inProf = name == (TRADE_SKILLS or "Professions") or name == (SECONDARY_SKILLS or "Secondary Skills")
      elseif inProf and name then
        out[#out + 1] = { name = name, rank = rank }
      end
    end
  end
  return out
end

-- Midnight-era clients can hand add-ons "secret" values (e.g. unit names in combat) that error when used.
function Context.Usable(v)
  if v == nil then return false end
  local isSecret = _G.issecretvalue
  if isSecret then
    local ok, secret = pcall(isSecret, v)
    if not ok or secret then return false end
  end
  return true
end

-- Name of a non-player unit (the target by default), or nil.
function Context.NPCName(unit)
  unit = unit or "target"
  if not try(UnitExists, unit) or try(UnitIsPlayer, unit) then return nil end
  local name = try(UnitName, unit)
  if not Context.Usable(name) or type(name) ~= "string" or name == "" then return nil end
  return name
end

-- Your journey --------------------------------------------------------------------------------------------------
-- What Journey.lua records for this character in LoreForeverDB.journey (the journey context model, LOR-108): the
-- server's list of completed quests, the people and places seen and an event log. Answers use it for the "you" line,
-- ranking and the own-quest spoiler unlock. Records come from SavedVariables, so every field is checked.

-- This character's journey record, or nil when there's none yet or "Remember my journey" is off.
function Context.Journey()
  local db = LoreForeverDB
  if type(db) ~= "table" or (type(db.settings) == "table" and db.settings.journey == false) then return nil end
  local J, c = ns.Journey, nil
  if J and J.On and not try(J.On) then return nil end
  if J and J.Char then
    c = try(J.Char)
  else
    local chars = type(db.journey) == "table" and db.journey.chars
    local name = try(UnitName, "player")
    local realm = try(GetNormalizedRealmName) or try(GetRealmName) or "?"
    c = type(chars) == "table" and type(name) == "string" and chars[name .. "-" .. realm]
  end
  return type(c) == "table" and c or nil
end

local doneCache = {}
-- The character's completed quest IDs as a set ({[questID] = true}), or nil. Rebuilt only when the list changes.
function Context.Done()
  local c = Context.Journey()
  local list = c and c.completed
  if type(list) ~= "table" then return nil end
  if doneCache.list ~= list or doneCache.n ~= #list then
    local set = {}
    for _, id in ipairs(list) do set[id] = true end
    doneCache.list, doneCache.n, doneCache.set = list, #list, set
  end
  return doneCache.set
end

-- Names of the people met for the first time this session (since the last login), oldest first, or nil. With no
-- login in the log there's no telling where the session began, so nobody counts.
function Context.Met()
  local c = Context.Journey()
  local events = c and c.events
  if type(events) ~= "table" then return nil end
  local out = {}
  for i = #events, 1, -1 do
    local e = events[i]
    if type(e) == "table" then
      if e.k == "login" then return out end
      if e.k == "npc" and type(e.n) == "string" then table.insert(out, 1, e.n) end
    end
  end
  return {}
end

-- Full snapshot in the shape the engine, the log and the live prompt all use.
function Context.Snapshot()
  local place, char = Context.Place(), Context.Character()
  local profs = Context.Professions()
  local profNames = {}
  for _, p in ipairs(profs) do profNames[#profNames + 1] = p.name end
  return {
    zone = place.zone, subzone = place.subzone, mapID = place.mapID, mapName = place.mapName,
    instance = place.instance,
    race = char.race, raceName = char.raceName, class = char.class, className = char.className,
    level = char.level, faction = char.faction,
    quests = Context.Quests(), questItems = Context.Items(),
    professions = profNames, professionRanks = profs,
    targetName = Context.NPCName("target"),
    met = Context.Met(), done = Context.Done(),
  }
end

-- One-line description for the panel header.
function Context.Describe(ctx)
  local where = ctx.zone or "?"
  if ctx.subzone and ctx.subzone ~= ctx.zone then where = where .. " - " .. ctx.subzone end
  -- The same translated string the other level lines use, so every language pack already has it.
  local level = tonumber(ctx.level)
  local who = level and string.format(ns.L["Level %d %s %s"], level, ctx.raceName or "", ctx.className or "")
    or ((ctx.raceName or "") .. " " .. (ctx.className or ""))
  return string.format("%s   |cffaaaaaa%s|r", where, who)
end
