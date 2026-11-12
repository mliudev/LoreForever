-- Willo's pins during play, without a /reload (LOR-1292, Mike, 11/7: "so it requires a reload to pin. I wonder what we
-- can do to not require reload"). An add-on can't read a file, the clipboard or the network while the game runs; the
-- one thing the game reads from disk mid-session is an add-on's own files, the first time that add-on is loaded. So
-- Willo keeps a few small load-on-demand add-ons beside hers (LoreForever_Willo_Live1..N, LoreForeverJourneyData.liveSlots
-- of them, companion/lore_companion/addon_writer.py), each holding her newest pins, rewritten whenever they change.
-- Each can be loaded once a session, so this loads the next unused one only when the world map is up to show what it
-- brings:
--
--   when the world map opens after a talk that no look has settled yet, or with no look for QUIET seconds (pins made
--   in her window or on the phone); for a talk, never before SOON seconds after the talk key came up (her answer, her
--   notebook and her write are usually in by then), so a talk with the map up, or the map opened right after one, waits
--   until then if the map is still up (another talk before that moves it on), and a look then that found nothing she
--   wrote after the talk looks once more at LAND, when her write surely is in, if the map is still up; never twice
--   within GAP, never in combat.
--
-- Never after a talk with the map down, and one look per talk: most talks make no pin, and a look after each one (two
-- with the map up) used every slot, so Mike's pin 6 h into a session waited for a /reload (11/10). Talks before a map
-- opening share its look. Her pin reaches the minimap with the next opening of the map. QUIET is an hour: a look on
-- every opening after 10 quiet minutes still used the slots up within 2 h of an ordinary evening (the Architect,
-- 11/10). For a pin made in her window with no talk in game waiting, her reply says how to see it now: a /reload
-- (companion core.py, _pin_waits_for_reload).
--
-- What it loads sets LoreForeverWilloLive = {generated, chars = {[key] = {pins}}, historyChars = {[install] = {...}}},
-- Data.lua's pins only. Newer than what the game has, its pins replace those in LoreForeverJourneyData and the maps
-- redraw (WorldPins.Update, the journey map). Older or the same: nothing changes. With every slot used, or a Willo
-- that writes none, pins wait for the next /reload, as before; the first time a talk's look finds none left, one chat
-- line says so.

local _, ns = ...
local L = ns.L

local PinsLive = {}
ns.PinsLive = PinsLive

-- SOON: the first look after a talk (her pin is usually written 4 to 12 s after the key: 4 s for both of Mike's on
-- 11/11). LAND: by when it surely is; a look before then that found nothing new looks once more at LAND while the map
-- is still up. Mike, 11/11: the map opened 17 s after his talk and closed 4 s later; waiting for LAND (25 s then) it never
-- looked, his pin had been on disk 13 s, and he /reloaded. EXPECT: how long it may still be on its way; a look only
-- settles a talk once it has brought pins or EXPECT has passed, so a later opening of the map looks again.
local SOON, LAND, GAP, QUIET, EXPECT = 6, 25, 15, 3600, 40

local used = {}             -- slots loaded this session
local lastLook, talkedAt, inCombatWait, toldSpent = nil, nil, false, false
local retried = false       -- this talk's second look (at LAND) is spent
local talkedWall = 0        -- the talk's time on this PC's clock, the one her files are stamped with (generated)
local timer = 0             -- the newest scheduled look; older ones do nothing

local function now() return (GetTime and GetTime()) or 0 end
local function api(name)
  local C = _G.C_AddOns
  return C and C[name] or _G[name]
end
local function mapOpen()
  local map = _G.WorldMapFrame
  return map and map.IsShown and map:IsShown() and true or false
end
local function expecting() return talkedAt ~= nil and now() - talkedAt < EXPECT end

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
  local open = {}
  for _, name in ipairs(PinsLive.Slots()) do
    if not used[name] then
      local ok, present, _, _, loadable, reason = pcall(info, name)
      local isLoaded = loaded and select(2, pcall(loaded, name))
      if ok and present and not isLoaded and reason ~= "DISABLED" and reason ~= "MISSING"
          and (loadable or reason == "DEMAND_LOADED") then
        open[#open + 1] = name
      else
        used[name] = true   -- gone, turned off or loaded already: never asked again
      end
    end
  end
  return open[1]
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
  if not (name and load) then
    -- Every slot used, with a talk's pin maybe waiting: say once where it will show.
    if load and talkedAt and not toldSpent and _G.DEFAULT_CHAT_FRAME then
      toldSpent = true
      DEFAULT_CHAT_FRAME:AddMessage(ns.Theme.CHAT_PREFIX .. L["To see Willo's newest pins on your map, type /reload."])
    end
    return false
  end
  used[name] = true
  lastLook = now()
  local settled = not expecting()
  _G.LoreForeverWilloLive = nil
  pcall(load, name)
  local live = _G.LoreForeverWilloLive
  _G.LoreForeverWilloLive = nil
  local at = type(live) == "table" and tonumber(live.generated) or 0
  local took = PinsLive.Take(live)
  -- Only what she wrote after the talk answers it. An older write (her files written again since the game read them,
  -- a pin from her window) still goes on the maps, but the talk stays open, as when nothing came, so the look at LAND
  -- or the next map opening still brings the talk's pin (the Architect's review of #3732: closed on any newer write,
  -- the pin asked never came without a /reload).
  local fresh = took and (not talkedAt or at >= talkedWall)
  if fresh or settled then talkedAt = nil end
  return fresh
end

local schedule
local function tryLook()
  local wait = math.max(lastLook and GAP - (now() - lastLook) or 0, talkedAt and SOON - (now() - talkedAt) or 0)
  if wait > 0 then return schedule(wait) end
  local took = PinsLive.Look()
  -- Nothing yet, and her pin may still be on its way: once more at LAND, if the map is still up then.
  if not took and talkedAt and not retried and now() - talkedAt < LAND and mapOpen() then
    retried = true
    schedule(LAND - (now() - talkedAt))
  end
end

-- A later look, only if the map is still up then: closed, the next opening looks for itself.
schedule = function(delay)
  timer = timer + 1
  local mine = timer
  if C_Timer and C_Timer.After then
    C_Timer.After(delay, function() if mine == timer and mapOpen() then tryLook() end end)
  end
end

-- The talk key came up (Strip.Ask), or a question went out from the Ask box: the next map opening looks, or, with the
-- map up now, a look once her pin is in.
function PinsLive.Talked()
  if #PinsLive.Slots() == 0 then return end
  talkedAt, retried = now(), false
  talkedWall = (time and time()) or 0
  if mapOpen() then schedule(SOON) end
end

-- The world map opened: a look when a talk hasn't been settled by one, or none has been for QUIET.
function PinsLive.MapShown()
  if #PinsLive.Slots() == 0 then return end
  if talkedAt or not lastLook or now() - lastLook >= QUIET then tryLook() end
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
    if inCombatWait then inCombatWait = false; if mapOpen() then tryLook() end end
    return
  end
  local map = _G.WorldMapFrame
  if map and map.HookScript and not self.hooked then
    self.hooked = true
    map:HookScript("OnShow", function() PinsLive.MapShown() end)
  end
end)
