-- Willo's pins during play, without a /reload (LOR-1292, Mike, 11/7: "so it requires a reload to pin. I wonder what we
-- can do to not require reload"). An add-on can't read a file, the clipboard or the network while the game runs; the
-- one thing the game reads from disk mid-session is an add-on's own files, the first time that add-on is loaded. So
-- Willo keeps a few small load-on-demand add-ons beside hers (LoreForever_Willo_Live1..N, LoreForeverJourneyData.liveSlots
-- of them, companion/lore_companion/addon_writer.py), each holding her newest pins, rewritten whenever they change.
-- Each can be loaded once a session, so this loads the next unused one only when new pins are likely:
--
--   AFTER_TALK seconds after the talk key comes up (her answer, her notebook and her write are in by then; another
--   talk before that moves it on), and when the world map opens after a talk since the last look, or with no look for
--   QUIET seconds (pins made in her window or on the phone), never twice within GAP, never in combat.
--
-- What it loads sets LoreForeverWilloLive = {generated, chars = {[key] = {pins}}, historyChars = {[install] = {...}}},
-- Data.lua's pins only. Newer than what the game has, its pins replace those in LoreForeverJourneyData and the maps
-- redraw (WorldPins.Update, the journey map). Older or the same: nothing changes. With every slot used, or a Willo
-- that writes none, pins wait for the next /reload, as before.

local _, ns = ...

local PinsLive = {}
ns.PinsLive = PinsLive

local AFTER_TALK, GAP, QUIET = 10, 15, 600

local used = {}             -- slots loaded this session
local lastLook, talked, inCombatWait = nil, false, false
local timer = 0             -- the newest scheduled look; older ones do nothing

local function now() return (GetTime and GetTime()) or 0 end
local function api(name)
  local C = _G.C_AddOns
  return C and C[name] or _G[name]
end

-- The slots Willo said she writes, by name.
function PinsLive.Slots()
  local d = _G.LoreForeverJourneyData
  local n = type(d) == "table" and tonumber(d.liveSlots) or 0
  local folder = type(d) == "table" and type(d.folder) == "string" and d.folder:match("^LoreForever_[%w_]+$")
  local out = {}
  if folder then
    for i = 1, math.min(n, 50) do out[#out + 1] = folder .. "_Live" .. i end
  end
  return out
end

-- The next slot the game can still load this session, or nil.
local function nextSlot()
  local info, loaded = api("GetAddOnInfo"), api("IsAddOnLoaded")
  if not info then return nil end
  for _, name in ipairs(PinsLive.Slots()) do
    if not used[name] then
      local ok, present, _, _, loadable, reason = pcall(info, name)
      local isLoaded = loaded and select(2, pcall(loaded, name))
      if ok and present and not isLoaded and reason ~= "DISABLED" and reason ~= "MISSING"
          and (loadable or reason == "DEMAND_LOADED") then
        return name
      end
      used[name] = true   -- gone, turned off or loaded already: never asked again
    end
  end
end

local function replace(into, from)
  for _, e in pairs(into) do if type(e) == "table" then e.pins = nil end end
  for key, e in pairs(type(from) == "table" and from or {}) do
    if type(key) == "string" and type(e) == "table" and type(e.pins) == "table" then
      into[key] = type(into[key]) == "table" and into[key] or {}
      into[key].pins = e.pins
    end
  end
end

-- Pins Willo handed over: taken when newer than the game's. True when they were.
function PinsLive.Take(live)
  local d = _G.LoreForeverJourneyData
  local at = type(live) == "table" and tonumber(live.generated)
  if type(d) ~= "table" or not at or at <= (tonumber(d.pinsAt) or tonumber(d.generated) or 0) then return false end
  d.chars = type(d.chars) == "table" and d.chars or {}
  replace(d.chars, live.chars)
  if type(d.historyChars) == "table" or type(live.historyChars) == "table" then
    d.historyChars = type(d.historyChars) == "table" and d.historyChars or {}
    for install, chars in pairs(d.historyChars) do
      if type(chars) == "table" then replace(chars, type(live.historyChars) == "table" and live.historyChars[install]) end
    end
    for install, chars in pairs(type(live.historyChars) == "table" and live.historyChars or {}) do
      if type(install) == "string" and d.historyChars[install] == nil and type(chars) == "table" then
        d.historyChars[install] = {}
        replace(d.historyChars[install], chars)
      end
    end
  end
  d.pinsAt = at
  local J = ns.Journey
  if J and J.PrunePinsCleared then pcall(J.PrunePinsCleared, at) end
  if ns.WorldPins and ns.WorldPins.Update then pcall(ns.WorldPins.Update) end
  if J and J.FocusMap and J.focus then pcall(J.FocusMap, J.focus) end
  return true
end

-- Load the next slot now. True when it brought newer pins.
function PinsLive.Look()
  if InCombatLockdown and InCombatLockdown() then inCombatWait = true; return false end
  local name = nextSlot()
  local load = api("LoadAddOn")
  if not (name and load) then return false end
  used[name] = true
  lastLook, talked = now(), false
  _G.LoreForeverWilloLive = nil
  pcall(load, name)
  local live = _G.LoreForeverWilloLive
  _G.LoreForeverWilloLive = nil
  return PinsLive.Take(live)
end

local schedule
local function tryLook()
  local since = lastLook and now() - lastLook
  if since and since < GAP then return schedule(GAP - since) end
  PinsLive.Look()
end

schedule = function(delay)
  timer = timer + 1
  local mine = timer
  if C_Timer and C_Timer.After then
    C_Timer.After(delay, function() if mine == timer then tryLook() end end)
  end
end

-- The talk key came up (Strip.Ask), or a question went out from the Ask box: a look once her answer is in.
function PinsLive.Talked()
  if #PinsLive.Slots() == 0 then return end
  talked = true
  schedule(AFTER_TALK)
end

-- The world map opened: a look when a talk came since the last one, or none has been for QUIET.
function PinsLive.MapShown()
  if #PinsLive.Slots() == 0 then return end
  if talked or not lastLook or now() - lastLook >= QUIET then tryLook() end
end

-- What the self-test and the sims read: {slots, used = how many loaded this session}.
function PinsLive.State()
  local n = 0
  for _ in pairs(used) do n = n + 1 end
  return { slots = #PinsLive.Slots(), used = n }
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:RegisterEvent("PLAYER_REGEN_ENABLED")
events:SetScript("OnEvent", function(self, event)
  if event == "PLAYER_REGEN_ENABLED" then
    if inCombatWait then inCombatWait = false; tryLook() end
    return
  end
  local map = _G.WorldMapFrame
  if map and map.HookScript and not self.hooked then
    self.hooked = true
    map:HookScript("OnShow", function() PinsLive.MapShown() end)
  end
end)
