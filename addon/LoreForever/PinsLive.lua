-- Willo's pins during play, without a /reload (LOR-1292, Mike, 11/7: "so it requires a reload to pin. I wonder what we
-- can do to not require reload"). An add-on can't read a file, the clipboard or the network while the game runs; the
-- one thing the game reads from disk mid-session is an add-on's own files, the first time that add-on is loaded. So
-- Willo keeps a few small load-on-demand add-ons beside hers (LoreForever_Willo_Live1..N, LoreForeverJourneyData.liveSlots
-- of them, companion/lore_companion/addon_writer.py), each holding her newest pins, rewritten whenever they change.
-- Each can be loaded once a session, so this loads the next unused one only when the world map is up to show what it
-- brings, and as few times as it can: most talks make no pin, and every look spends one of the slots.
--
--   After a talk (the talk key coming up, or a question sent from the Ask box), a look with the map up: WAIT seconds
--   after the talk when the map was up at the talk; from SOON seconds when it was opened after it, at once, and once
--   more at WAIT only if that brought nothing. A look at WAIT settles the talk: her pin came, or there was none. A new
--   talk never moves a look that is already due. With no talk waiting, a look on the map's first opening of the
--   session and then once an hour (QUIET: pins made in her window or on the phone). Never in combat, never two within
--   GAP.
--
-- Willo says /reload after a pin she wrote too late for the look at WAIT (core.py, _pin_waits_for_reload), and her
-- journey data says so (pinLook). An older Willo doesn't: for hers the add-on keeps 1.7.0's way for the newest talk, a
-- look at LAND with the map up (not at WAIT once one has run) and then at the next opening until EXPECT.
--
-- LOR-1553 (Mike's stream, 11/16: a pin he asked for by voice needed a /reload, another came "a little bit" late). The
-- look at WAIT was a guess at when her write lands: a pin written at 4 s waited for 12 s, and one written after 12 s
-- (an 8 s answer for a trainer by name) missed it, so she said /reload. A Willo that writes pinLook 3 stamps every talk
-- from the game she has finished into her slots, a pin or not (`answered`: the key times of her last few; addon_writer
-- stamp_answered). With hers a talk's first look comes at her ladder's first step (pinLadder, beside pinLook; LADDER
-- without one), with the map up or as it opens; a look that finds the talk answered settles it, and else the next comes
-- at the ladder's next step (with the map up, or at the next opening), the last at its end. She says /reload only for a
-- write after that (core.PIN_LOOK_LAST_S, from the same ladder she writes).
--
-- 11/10: a look after each talk (two with the map up) used every slot, so Mike's pin 6 h into a session waited for a
-- /reload. 1.7.0 looked at 6 s and 25 s and again at the next opening: two or three looks a talk, the slots gone at
-- talk 4 with the map up. Now one a talk, two for a map opened after it and still up 12 s after it. Her pin reaches
-- the minimap with the next opening of the map. QUIET is an hour: a look on every opening after 10 quiet minutes still used the slots
-- up within 2 h of an ordinary evening (the Architect, 11/10). For a pin made in her window with no talk in game
-- waiting, her reply says how to see it now: a /reload.
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

-- WAIT: a talk's look, once her pin is surely on disk. Each of the 15 pins in Mike's log to 11/11 was answered in 2.4
-- to 4.0 s, written a moment later (4 s after the key for both of his on 11/11), so 12 s leaves room for a slow answer.
-- SOON: the first look on a map opened after the talk. Mike, 11/11, opened it 17 s after his talk and closed it 4 s
-- later; a look only at 25 s never ran and he /reloaded. LAND and EXPECT: 1.7.0's second look and how long it kept a
-- talk open, for a Willo without pinLook.
local SOON, WAIT, LAND, EXPECT, GAP, QUIET = 6, 12, 25, 40, 3, 3600
-- LADDER: a talk's looks, in seconds from its key, with a Willo that stamps the talks she has answered (pinLook 3) and
-- doesn't write her own (pinLadder, addon_writer.PIN_LADDER: hers wins). A talk waits until a look settles it, however
-- long the map stays shut (the Architect's hold on #4543: one forgotten after 5 minutes lost a pin she'd made).
local LADDER = { 9, 16, 30 }
local MAX_TALKS = 8

local used = {}             -- slots loaded this session
local lastLook, inCombatWait, toldSpent = nil, false, false
-- Talks a look hasn't settled yet, oldest first: {at = GetTime(), wall = time() (this PC's clock, the one her files are
-- stamped with), next = when its next look may run, or onOpen = true: at the next opening of the map}.
local talks = {}
local timer, pending = 0, nil   -- the newest scheduled look and when it runs; older ones do nothing

local function now() return (GetTime and GetTime()) or 0 end
local function api(name)
  local C = _G.C_AddOns
  return C and C[name] or _G[name]
end
local function mapOpen()
  local map = _G.WorldMapFrame
  return map and map.IsShown and map:IsShown() and true or false
end
-- This Willo says /reload after a pin too late for the look at WAIT (addon_writer PIN_LOOK).
local function marked()
  local d = _G.LoreForeverJourneyData
  return type(d) == "table" and (tonumber(d.pinLook) or 0) >= 2
end
-- This Willo stamps every talk she has finished into her slots (addon_writer PIN_LOOK_ANSWERED, LOR-1553): her journey
-- data says so from the game's load, a slot she wrote says so from the look that loaded it (a Willo updated mid-session).
local slotLook, slotLadder = 0, nil
local function stamped()
  local d = _G.LoreForeverJourneyData
  return slotLook >= 3 or type(d) == "table" and (tonumber(d.pinLook) or 0) >= 3
end
-- Her ladder, if it's a sane one (1 to 4 rising steps, each 1 to 120 s), else LADDER.
local function sane(l)
  if type(l) ~= "table" or #l < 1 or #l > 4 then return nil end
  local last = 0
  for i = 1, #l do
    local s = tonumber(l[i])
    if not s or s <= last or s > 120 then return nil end
    last = s
  end
  return l
end
local function ladder()
  local d = _G.LoreForeverJourneyData
  return slotLadder or sane(type(d) == "table" and d.pinLadder) or LADDER
end
local function first() return tonumber(ladder()[1]) end
-- With a stamp: the waiting talks her stamps (the key times of her last few finished talks) settle. A stamp settles the
-- talk nearest it within 1 s (her whole second can fall a second either side of the game's), so a later talk's stamp
-- never settles an earlier one (a tap or a second question while she's still answering the first). Each stamp settles
-- one talk: of two talks in one second (a tap 0.3 s after a pin question) it settles the older, and the other waits
-- for its next step (her stamps hold a second once). spent counts the stamps that have settled a talk, by value, while
-- they're among hers.
local spent = {}
local function settle(waiting, stamps)
  local have, done = {}, {}
  for _, s in ipairs(stamps) do
    s = tonumber(s)
    if s then have[s] = (have[s] or 0) + 1 end
  end
  for s, n in pairs(spent) do
    if have[s] then have[s] = have[s] - n else spent[s] = nil end
  end
  local order = {}
  for s in pairs(have) do order[#order + 1] = s end
  table.sort(order)
  for _, s in ipairs(order) do
    for _ = 1, have[s] do
      local best, gap = nil, nil
      for _, t in ipairs(waiting) do
        local d = math.abs(s - t.wall)
        if d <= 1 and (gap == nil or d < gap) then best, gap = t, d end
      end
      if best and done[best] then     -- its nearest talk is settled: a later talk's stamp never settles an earlier one
        best = nil
        for _, t in ipairs(waiting) do
          if not done[t] and math.abs(s - t.wall) == gap then best = t; break end
        end
      end
      if not best then break end
      done[best], spent[s] = true, (spent[s] or 0) + 1
    end
  end
  return done
end
-- With a stamp: the next look a talk unanswered at t0 gets, or nil when its last has run.
local function nextStep(t, t0)
  for _, s in ipairs(ladder()) do
    if t.at + tonumber(s) > t0 + 0.5 then return t.at + tonumber(s) end
  end
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
    if load and #talks > 0 and not toldSpent and _G.DEFAULT_CHAT_FRAME then
      toldSpent = true
      DEFAULT_CHAT_FRAME:AddMessage(ns.Theme.CHAT_PREFIX .. L["To see Willo's newest pins on your map, type /reload."])
    end
    talks = {}
    return false
  end
  used[name] = true
  local t0 = now()
  lastLook = t0
  _G.LoreForeverWilloLive = nil
  pcall(load, name)
  local live = _G.LoreForeverWilloLive
  _G.LoreForeverWilloLive = nil
  local at = type(live) == "table" and tonumber(live.generated) or 0
  if type(live) == "table" and (tonumber(live.pinLook) or 0) > slotLook then slotLook = tonumber(live.pinLook) end
  if type(live) == "table" and sane(live.pinLadder) then slotLadder = live.pinLadder end
  local took = PinsLive.Take(live)
  -- A talk is answered by what she wrote after it (the Architect's review of #3732); an older write (her files written
  -- again since the game read them, a pin from her window) still goes on the maps. Unanswered, a look at WAIT settles
  -- it (with an older Willo, at EXPECT); before then its next look is at WAIT, or LAND for an older Willo, or the next
  -- opening.
  -- With an older Willo only the newest talk keeps 1.7.0's later looks (at LAND, then the next opening until EXPECT),
  -- as 1.7.0 did, and a look from its own SOON goes straight to LAND: no more looks a talk than 1.7.0 took. A look
  -- that ran for an earlier talk before this one's SOON leaves it its look at WAIT (the Architect, 11/12).
  local keep, mark = {}, marked()
  -- With a stamp (LOR-1553): a talk she has answered (its own key time among her stamps) is settled, a pin or not; one
  -- she hasn't gets its next step, or none after the ladder's last. A newer write alone settles nothing: her pin's write
  -- carries its own talk's stamp. (Her clock and the game's are this PC's.)
  if stamped() then
    local stamps = type(live) == "table" and type(live.answered) == "table" and live.answered or {}
    local done = settle(talks, stamps)
    for _, t in ipairs(talks) do
      if not done[t] then
        t.onOpen, t.next = nil, nextStep(t, t0)
        if t.next then keep[#keep + 1] = t end
      end
    end
    talks = keep
    return took
  end
  for i, t in ipairs(talks) do
    local old = not mark and i == #talks
    if not (took and at >= t.wall) and t0 < t.at + (old and EXPECT or WAIT) - 0.5 then
      t.onOpen = nil
      if old and t0 >= t.at + SOON - 0.5 then
        if t0 < t.at + LAND - 0.5 then t.next = t.at + LAND else t.next, t.onOpen = nil, true end
      else t.next = t.at + WAIT end
      keep[#keep + 1] = t
    end
  end
  talks = keep
  return took
end

local plan
-- A later look, only if the map is still up then: closed, the next opening looks for itself.
local function scheduleAt(at)
  if pending and pending <= at then return end
  timer, pending = timer + 1, at
  local mine = timer
  if C_Timer and C_Timer.After then
    C_Timer.After(math.max(0, at - now()), function()
      if mine ~= timer then return end
      pending = nil
      if mapOpen() then plan(false) end
    end)
  end
end

-- The next look the waiting talks ask for: now, or later with the map still up. opening: the map has just opened.
plan = function(opening)
  local due
  for _, t in ipairs(talks) do
    local d = t.onOpen and (opening and now() or nil) or t.next
    if d and (not due or d < due) then due = d end
  end
  if not due then return end
  -- One look serves every waiting talk, so a map just opened doesn't look before the newest talk's SOON (an earlier
  -- talk's look long due would otherwise run before her write; the Architect, 11/12).
  if opening then due = math.max(due, talks[#talks].at + (stamped() and first() or SOON)) end
  if lastLook then due = math.max(due, lastLook + GAP) end
  if due > now() + 0.01 then return scheduleAt(due) end
  PinsLive.Look()
  if not inCombatWait and mapOpen() then plan(false) end   -- (in a fight: when it ends)
end

-- The talk key came up (Strip.Ask), or a question went out from the Ask box: with the map up a look at WAIT, else from
-- SOON on the next opening. A look already due for an earlier talk keeps its time.
function PinsLive.Talked()
  if #PinsLive.Slots() == 0 then return end
  local t = now()
  talks[#talks + 1] = { at = t, wall = (time and time()) or 0,
    next = t + (stamped() and first() or (mapOpen() and WAIT or SOON)) }
  if #talks > MAX_TALKS then table.remove(talks, 1) end
  if mapOpen() then plan(false) end
end

-- The world map opened: a look for the talks waiting, or when none has been for QUIET.
function PinsLive.MapShown()
  if #PinsLive.Slots() == 0 then return end
  if #talks > 0 then return plan(true) end
  if not lastLook or now() - lastLook >= QUIET then PinsLive.Look() end
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
    if inCombatWait then
      inCombatWait = false
      if mapOpen() then if #talks > 0 then plan(true) else PinsLive.Look() end end
    end
    return
  end
  local map = _G.WorldMapFrame
  if map and map.HookScript and not self.hooked then
    self.hooked = true
    map:HookScript("OnShow", function() PinsLive.MapShown() end)
  end
end)
