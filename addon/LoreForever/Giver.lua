-- Who you're talking to at a quest window (LOR-224): the NPC's or object's id from its GUID, its name, UnitSex, its
-- model file, and the race and gender that model shows (ns.MODEL_RACES, generated from the Forever client's own tables
-- by pipeline/lore/quest_givers.py). Log.QuestText saves it with the quest (the starter at QUEST_DETAIL, the ender at
-- QUEST_PROGRESS and QUEST_COMPLETE); lore.harvest folds it into data/harvest. Quest-giver voices ask ns.NpcRace("npc")
-- (or Giver.Identify("npc"), or read Giver.last).
--
-- Every client call is guarded: a client without one of these functions just records less.

local _, ns = ...
local Giver = {}
ns.Giver = Giver

local KINDS = { Creature = "npc", Vehicle = "npc", GameObject = "object" }
local GENDER = { [2] = "male", [3] = "female" }   -- UnitSex: 1 is neither or unknown

local function call(f, ...)
  if type(f) ~= "function" then return nil end
  local ok, a, b = pcall(f, ...)
  if ok then return a, b end
end

-- "Creature-0-4372-0-12-197-0000123456" -> "npc", 197; a game object -> "object", id. Players, pets and items -> nil.
function Giver.ParseGUID(guid)
  if type(guid) ~= "string" then return nil end
  local parts = {}
  for p in guid:gmatch("[^-]+") do parts[#parts + 1] = p end
  local kind, id = KINDS[parts[1]], tonumber(parts[6])
  if kind and id and id > 0 then return kind, id end
end

-- The race and gender a model file shows, for a player race's character model: the client's race file name, as
-- UnitRace's second value has it ("Human", "Scourge", "BloodElf", "NightElf"), and "male" or "female". nil for any
-- other model (a kobold, a wolf), or for none.
function Giver.RaceOf(fileID)
  local v = type(fileID) == "number" and ns.MODEL_RACES and ns.MODEL_RACES[fileID]
  if type(v) ~= "string" then return nil end
  return v:match("^(%S+) (%S+)$")
end

-- A hidden one-pixel model to put the unit on and read its model file id. false: this client can't.
local model, pending
local function modelFrame()
  if model == nil then
    model = false
    local f = call(CreateFrame, "PlayerModel", nil, UIParent)
    if f and f.SetUnit and f.GetModelFileID then
      call(f.SetSize, f, 1, 1)
      call(f.SetPoint, f, "TOPLEFT", UIParent, "BOTTOMRIGHT", 8, -8)   -- off screen
      call(f.SetAlpha, f, 0)
      call(f.Hide, f)
      model = f
    end
  end
  return model or nil
end

local function readModel()
  local id = call(model.GetModelFileID, model)
  return type(id) == "number" and id > 0 and id or nil
end

local function finish()
  local p = pending
  if not (p and model) then return end
  local id = readModel()
  if id then
    pending = nil
    call(model.Hide, model)
    call(p, id)
  end
end

-- Calls fn(model file id) for the unit: at once when the client knows it, else when the model has loaded (or at a
-- last look half a second later). A newer call replaces a waiting one.
function Giver.ModelOf(unit, fn)
  local f = modelFrame()
  if not f then return end
  call(f.Show, f)
  call(f.SetUnit, f, unit)
  pending = fn
  local id = readModel()
  if id then return finish() end
  if not f.__giverHooked then
    f.__giverHooked = true
    call(f.SetScript, f, "OnModelLoaded", finish)
  end
  if C_Timer and C_Timer.After then
    call(C_Timer.After, 0.5, function()
      finish()
      if pending == fn then pending = nil; call(model.Hide, model) end   -- never came: give up on this one
    end)
  end
end

-- { kind = "npc" | "object", id, name, sex (UnitSex), ctype (UnitCreatureType), model (file id), race, gender } for
-- the unit ("npc": the quest or gossip window's), or nil for a player, a pet or no one. race (Giver.RaceOf's race
-- file name) and gender come from the model when it's a player race's (gender from UnitSex first); model, race and
-- gender may fill in a moment later.
function Giver.Identify(unit)
  unit = unit or "npc"
  local kind, id = Giver.ParseGUID(call(_G.UnitGUID, unit))
  if not kind then return nil end
  local who = { kind = kind, id = id, name = call(_G.UnitName, unit) }
  if kind == "npc" then
    who.sex = call(_G.UnitSex, unit)
    who.ctype = call(_G.UnitCreatureType, unit)
    who.gender = GENDER[who.sex]
    Giver.ModelOf(unit, function(fileID)
      who.model = fileID
      local race, gender = Giver.RaceOf(fileID)
      who.race = race
      who.gender = who.gender or gender
    end)
  end
  Giver.last = who
  return who
end

-- The NPC's race from its model, for quest-giver voices (LOR-225): ns.NpcRace("npc") -> the client's race file name
-- ("Human", "Dwarf", "Scourge", "BloodElf", ...), or nil when its model isn't a player race's or isn't known (yet).
-- The quest window's NPC was identified as the window opened (Log.QuestText; a model still loading gives nil now and
-- the race a moment later); anyone else is looked at now.
function ns.NpcRace(unit)
  unit = unit or "npc"
  local kind, id = Giver.ParseGUID(call(_G.UnitGUID, unit))
  if not kind then return nil end
  local who = Giver.last
  if not (who and who.kind == kind and who.id == id) then who = Giver.Identify(unit) end
  return (Giver.RaceOf(who and who.model))
end
