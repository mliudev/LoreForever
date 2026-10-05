-- Your journey: what this character has done, for the journey page, answers, the welcome back and narrated chapters.
-- The add-on records events into SavedVariables (LoreForeverDB.journey, v2; the contract is the "Journey context model
-- spec (LOR-108)"). The game writes them to disk on /reload and logout. The companion app, when it's installed, reads
-- them there and writes chapters back as the LoreForever_Journey add-on (LoreForeverJourneyData), loaded on the next
-- /reload or login (chapters pasted into the companion come back the same way).
--
-- LoreForeverDB.journey = { v = 2, chars = { ["Name-Realm"] = {
--   name, realm, race, raceName, class, className, faction, sex, level, first, lastSync, announced, lastRead,
--   completed = { questID, ... },        the server's list, refreshed at every login
--   seen = { place = { ["Zone|Subzone"] = t }, npc = { [name] = t }, mob = {...}, book = {...}, boss = {...} },
--   kills = { [name] = n },
--   tally = { walk = { [land] = yards }, kinds = { [creature type] = kills }, ranks = { [classification] = kills },
--             deaths, online, played, playedAt },   the journey in numbers (The tally, below; LOR-246)
--   events = { { k = kind, t = time, lv = level, ... }, ... },   at most MAX_EVENTS
--   trail = { [sessionStart] = { { m = mapID, x = 0.123, y = 0.456, t = t }, ... } } } } }   the last TRAIL_SESSIONS
-- LoreForeverDB.texts = { gossip = { [npcName] = { [hash] = text } }, books = { [title] = { [page] = text } } } (and
-- texts.say, texts.npcs: Capture.lua)
--
-- Event kinds and their fields (lv is on every event; pt = { "Dwarf Priest", ... } when you're in a group):
--   login, logout, sync                       z, s on login
--   zone  z, s, from, how, new, inst          only a new place or a dungeon entry. how: walk, flight, hearth, boat,
--                                             corpse, portal or instance (none for the place you log in at)
--   qa / qt / qx  id, q, z, s (qt: pt)        quest accepted, turned in, abandoned
--   lvl z, s   death z, s, pt   npc n, z, s (first meeting)   kill n, z, s (first kill; cls for elites and rares,
--   pt for elites)   boss n, key, z, s, pt   book n, z, s (first read)   bind n, z, s   taxi from, to, z, s
--   rep n, st, was, z, s                      a standing change (st, was: 1 Hated .. 8 Exalted)
--   mount id, n, z, s   spell id, n, z, s (a new spell, not a higher rank)   shot z, s (a screenshot)
--   loot n, id, ql, qid, z, s                 your loot of rare quality or better, or a quest's reward item (qid)
--                                             of uncommon or better; ql is the item quality
--   prof n, r, z, s                           a profession reaching 75, 150, 225 or 300 (r)
-- at = "mapID:x:y" (x, y in thousandths of that map) is where it happened, on every event but logout and sync, when
-- the game says (not in a dungeon or on a flight). Journey.Spot reads it, or the map trail for events from before it.
-- The player's name never goes into stored text ($N instead: Capture.Placeholders), and other players' names are never
-- stored.
-- The combat log is off limits: registering COMBAT_LOG_EVENT_UNFILTERED shows the player a "blocked" popup.

local _, ns = ...
local Journey = {}
ns.Journey = Journey
local L = ns.L

local MAX_EVENTS = 3600          -- per character (with spots, a level 1-60 record stays under 1 MB); the companion keeps all
local SPOT_GAP = 120             -- seconds a map trail point can be from an event and still say where it happened
local TRIM = 500                 -- dropped from the oldest end when the list is full
local QUICK, SLOW = 10, 120      -- seconds a hearth or portal still explains the next move (SLOW: after a loading screen)
local AUDIO_DIR = "Interface\\AddOns\\LoreForever_Journey\\Audio\\"
local T = ns.Theme
local GOLD, GREY, WHITE = T.code.gold, T.code.grey, T.code.white
local HEARTH, ASTRAL_RECALL = 8690, 556
local TRAM = 369                 -- the Deeprun Tram's map: a ride between two cities, not a boat
-- Mage teleports and the druids' Teleport: Moonglade move the caster; a mage's Portal spells open one for others.
local TELEPORTS = { [3561] = true, [3562] = true, [3563] = true, [3565] = true, [3566] = true, [3567] = true,
  [18960] = true }
local PORTALS = { [10059] = true, [11416] = true, [11417] = true, [11418] = true, [11419] = true, [11420] = true }
local ELITE = { elite = true, rareelite = true, worldboss = true }
local NOTABLE = { elite = true, rareelite = true, worldboss = true, rare = true }   -- kept as kill.cls
-- The map trail: a look every TRAIL_EVERY seconds, kept when you've moved TRAIL_MOVE of the map. SavedVariables keep
-- the last TRAIL_SESSIONS sessions; a session past TRAIL_MAX points keeps every other one and looks half as often.
local TRAIL_EVERY, TRAIL_MOVE, TRAIL_SESSIONS, TRAIL_MAX = 15, 0.005, 5, 120
local WALK_SPEED = 16            -- yards a second, past any mount: a jump beyond it (hearth, portal, boat) isn't walked
local WALK_EVERY = 2.5           -- seconds between the walk's looks (The tally: six to each of the trail's)
local MILESTONES = { 75, 150, 225, 300 }
local RARE, UNCOMMON = 3, 2      -- item quality: loot from rare up, quest rewards from uncommon up

local function say(msg) DEFAULT_CHAT_FRAME:AddMessage(T.CHAT_PREFIX .. msg) end
local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b, c = pcall(fn, ...)
  if ok then return a, b, c end
end
local function esc(s) return (tostring(s or ""):gsub("|", "||")) end
local function usable(v) return ns.Context.Usable(v) and type(v) == "string" and v ~= "" end
local function scrub(s) return ns.Log.Scrub(s) end
local function settings() return (LoreForeverDB and LoreForeverDB.settings) or {} end
-- Timers run outside the event handler's pcall: an error in one must not reach the player.
local function later(delay, fn) C_Timer.After(delay, function() pcall(fn) end) end

local char           -- this character's record in LoreForeverDB.journey.chars
local loginAt        -- time() of this load's login event (none while Remember my journey is off)
local needCompleted  -- the server's completed-quest list was empty at login: tries left to fetch it again
local resetRoute     -- forget where the player was (Recording, below)
local startTrail     -- start the map trail's timer (The map trail, below)
local takeStock      -- note standings and profession ranks, to see them change (Recording, below)
local onlineFrom     -- time() the online count was last brought up to date (The tally, below)
local titles = {}    -- questID -> title, for quests that have left the log
local turnedIn = {}  -- questID -> GetTime() it was turned in, this session: QUEST_REMOVED without one is abandoned

function Journey.CharKey()
  local name = try(UnitName, "player") or "?"
  local realm = try(GetNormalizedRealmName) or try(GetRealmName) or "?"
  return name .. "-" .. realm, name, realm
end

-- This character's record, or nil (before login, or when it was never recorded).
function Journey.Char() return char end

-- "Remember my journey" (Options): off records nothing new; what's there stays.
function Journey.On() return settings().journey ~= false end

-- Drop the oldest events once the list is full, so SavedVariables stay small.
local function trim(c)
  if #c.events <= MAX_EVENTS then return end
  local keep = {}
  for i = #c.events - (MAX_EVENTS - TRIM) + 1, #c.events do keep[#keep + 1] = c.events[i] end
  c.events = keep
end

local refreshQueued
-- Where the player is on the map now, as "mapID:x:y" (x, y in thousandths), or nil: in a dungeon, on a flight, or
-- when the game doesn't say (or says in a secret value).
local function spot()
  if try(UnitOnTaxi, "player") or try(IsInInstance) then return nil end
  local M = _G.C_Map
  local m = M and try(M.GetBestMapForUnit, "player")
  if not ns.Context.Usable(m) or type(m) ~= "number" then return nil end
  local pos = try(M.GetPlayerMapPosition, m, "player")
  local x, y
  if type(pos) == "table" then x, y = try(pos.GetXY, pos) end
  if not (ns.Context.Usable(x) and ns.Context.Usable(y)) or type(x) ~= "number" or type(y) ~= "number"
      or (x == 0 and y == 0) then
    return nil
  end
  return try(string.format, "%d:%d:%d", m, math.floor(x * 1000 + 0.5), math.floor(y * 1000 + 0.5))
end

local function add(kind, fields)
  if not (char and Journey.On()) then return nil end
  local e = fields or {}
  e.k, e.t = kind, time()
  e.lv = e.lv or try(UnitLevel, "player")
  if kind ~= "logout" and kind ~= "sync" then e.at = e.at or spot() end
  char.events[#char.events + 1] = e
  trim(char)
  -- Keep an open journey page current, at most once a second.
  if Journey.content and Journey.IsShown() and not refreshQueued then
    refreshQueued = true
    later(1, function() refreshQueued = nil; Journey.Refresh() end)
  end
  return e
end
Journey.Add = add

local function here()
  local p = ns.Context.Place()
  return p.zone, p.subzone, p
end

-- Race and class of the others in your group, never their names: { "Dwarf Priest", "Human Warrior" }, or nil.
local partyCache
local function party()
  if partyCache then return partyCache end
  local n = try(GetNumSubgroupMembers) or try(GetNumPartyMembers) or 0
  if n == 0 then return nil end
  local out, complete = {}, true
  for i = 1, math.min(n, 4) do
    local race, class = try(UnitRace, "party" .. i), try(UnitClass, "party" .. i)
    if usable(race) and usable(class) then out[#out + 1] = race .. " " .. class else complete = false end
  end
  if #out == 0 then return nil end
  if complete then partyCache = out end
  return out
end

-- Every quest this character has ever completed (the server's list), as a sorted array of IDs.
local function completedQuests()
  local ids = {}
  local QL = _G.C_QuestLog
  local list = QL and try(QL.GetAllCompletedQuestIDs)
  if type(list) == "table" and #list > 0 then
    for _, id in ipairs(list) do ids[#ids + 1] = id end
  else
    local map = try(GetQuestsCompleted)
    for id, done in pairs(type(map) == "table" and map or {}) do
      if done then ids[#ids + 1] = id end
    end
  end
  table.sort(ids)
  return ids
end

-- Titles of the quests in the log. QUEST_LOG_UPDATE fires often, so this reads titles only (no objectives).
local function rememberTitles()
  local QL = _G.C_QuestLog
  if QL and QL.GetNumQuestLogEntries and QL.GetInfo then
    for i = 1, (try(QL.GetNumQuestLogEntries) or 0) do
      local info = try(QL.GetInfo, i)
      if info and not info.isHeader and info.questID and info.title then titles[info.questID] = info.title end
    end
    return
  end
  for _, q in ipairs(ns.Context.Quests()) do
    if q.id and q.title then titles[q.id] = q.title end
  end
end

local function questTitle(id)
  local QL = _G.C_QuestLog
  return titles[id] or (QL and try(QL.GetTitleForQuestID, id)) or (QL and try(QL.GetQuestInfo, id))
end

-- v1 (the companion prototype) recorded a zone event for every subzone change. Keep new places and dungeon entries.
local function migrate(j)
  if (tonumber(j.v) or 1) >= 2 then return end
  for _, c in pairs(j.chars) do
    if type(c) == "table" and type(c.events) == "table" then
      local keep, prev = {}, nil
      for _, e in ipairs(c.events) do
        if e.k ~= "zone" then
          keep[#keep + 1] = e
        else
          local entry = e.inst and not (prev and prev.inst and prev.z == e.z)
          if e.new or entry then keep[#keep + 1] = e end
          prev = e
        end
      end
      c.events = keep
    end
  end
  j.v = 2
end

-- Where a record starts (startLevel, startCompleted): "first" (the first visit, the first meeting) is only true for a
-- record made at level 1 with no quests done. A character that played before the update starts mid-life, and its
-- record's first visit to Stormwind isn't its first.
-- The quests in `ids` that this record didn't see turned in were done before it began.
local function settle(c, ids)
  local mine = {}
  for _, e in ipairs(type(c.events) == "table" and c.events or {}) do
    if type(e) == "table" and e.k == "qt" and e.id then mine[e.id] = true end
  end
  local before = 0
  for _, id in ipairs(ids) do if not mine[id] then before = before + 1 end end
  c.startCompleted, c.startUnsure = before, nil
end

-- A record made before startLevel was kept: its oldest event is the login it was made at, with the level then.
-- When that login is gone (trimmed) it's unknown, and an unknown start counts as mid-life (startLevel 0).
local function inferStart(c)
  local e = type(c.events) == "table" and c.events[1]
  local lv = type(e) == "table" and e.k == "login" and tonumber(e.lv)
  if not lv or (tonumber(c.first) and tonumber(e.t) and math.abs(e.t - c.first) > 5) then
    c.startLevel = 0
    return
  end
  c.startLevel = lv
  settle(c, type(c.completed) == "table" and c.completed or {})
end

-- Whether a record covers this character's whole life (made at level 1 with no quests done, and never switched off
-- since), so "first" is true; otherwise it's only the first one recorded.
function Journey.Whole(c)
  c = c or char
  if type(c) ~= "table" or c.gap then return false end
  if c.startLevel == nil then inferStart(c) end
  return tonumber(c.startLevel) == 1 and tonumber(c.startCompleted) == 0
end

-- The tally ----------------------------------------------------------------------------------------------------------
-- The journey in numbers (LOR-246), for the record's "Journey stats" (JourneyRecord.lua) and the page's stats line:
-- how far you walked in each land, the foes you slew by kind and rank, deaths, and time played. A number per land and
-- per kind, never one per kill or step, so SavedVariables stay small (LOR-134). It's your story, not combat detail.
--   walk     yards walked per land (the zone's name), from the update on: a look at where you are every WALK_EVERY
--            seconds (fight or not), the straight line from the one before on the same map, not on a flight, in a
--            dungeon or in a jump faster than WALK_SPEED (a hearth, a portal, a boat). The map trail can't say it: it
--            keeps a point only every 0.5% of a map, thinned, and only its last sessions. Shown as steps (STEPS in
--            JourneyRecord.lua) with miles or kilometres.
--   kinds    kills by creature type ("Beast"), ranks kills by classification (elite, rare, rareelite, worldboss): known
--            for a kill when it was your target, or one of the same name was this session
--   deaths   every death; online seconds played with the journey on; played the game's /played total when it last
--            said it, at playedAt seconds of online
-- A record from before the tally starts it from what it already has: deaths and notable first kills from its events,
-- online from its logins and logouts. The walk starts at zero.

local yardsOf = {}   -- map ID -> { width, height } in yards (false: unknown)

-- A map's size in yards, or nil when the game doesn't say.
local function mapYards(m)
  local v = yardsOf[m]
  if v == nil then
    v = false
    local M = _G.C_Map
    local w, h
    if M and M.GetMapWorldSize then w, h = try(M.GetMapWorldSize, m) end
    if not (type(w) == "number" and type(h) == "number" and w > 0 and h > 0) and M and M.GetWorldPosFromMapPos then
      -- The map's corners in the world: its x runs along the world's y, and its y along the world's x.
      local vec = _G.CreateVector2D or function(x, y) return { x = x, y = y } end
      local _, a = try(M.GetWorldPosFromMapPos, m, vec(0, 0))
      local _, b = try(M.GetWorldPosFromMapPos, m, vec(1, 1))
      local ax, ay = type(a) == "table" and tonumber(a.x), type(a) == "table" and tonumber(a.y)
      local bx, by = type(b) == "table" and tonumber(b.x), type(b) == "table" and tonumber(b.y)
      if ax and ay and bx and by then w, h = math.abs(ay - by), math.abs(ax - bx) end
    end
    if ns.Context.Usable(w) and ns.Context.Usable(h) and type(w) == "number" and type(h) == "number"
        and w > 0 and h > 0 then
      v = { w, h }
    end
    yardsOf[m] = v
  end
  if v then return v[1], v[2] end
end

-- Yards walked from one look to the next, or nil when it wasn't a walk: another map, no size, a jump.
local function walkYards(a, b)
  if not (a and b and a.m == b.m) then return nil end
  local w, h = mapYards(a.m)
  local secs = (tonumber(b.t) or 0) - (tonumber(a.t) or 0)
  if not w or secs <= 0 then return nil end
  local yards = math.sqrt(((b.x - a.x) * w) ^ 2 + ((b.y - a.y) * h) ^ 2)
  if yards > secs * WALK_SPEED + 10 then return nil end
  return yards
end

local function walked(walk, land, yards)
  if yards and yards >= 1 and usable(land) then walk[land] = math.floor((tonumber(walk[land]) or 0) + yards + 0.5) end
end

-- A new tally, from what the record already has.
local function newTally(c)
  local t = { walk = {}, kinds = {}, ranks = {}, deaths = 0, online = 0 }
  local login
  for _, e in ipairs(c.events) do
    if type(e) == "table" then
      if e.k == "death" then t.deaths = t.deaths + 1
      elseif e.k == "kill" and NOTABLE[e.cls or ""] then t.ranks[e.cls] = (t.ranks[e.cls] or 0) + 1
      elseif e.k == "login" then login = tonumber(e.t)
      elseif e.k == "logout" and login and tonumber(e.t) then
        t.online = t.online + math.max(0, e.t - login)
        login = nil
      end
    end
  end
  return t
end

-- This character's tally (made when it's first needed).
local function tally()
  if type(char.tally) ~= "table" then char.tally = newTally(char) end
  local t = char.tally
  for _, k in ipairs({ "walk", "kinds", "ranks" }) do t[k] = type(t[k]) == "table" and t[k] or {} end
  return t
end

-- Seconds played with the journey on, this session's included.
function Journey.Online()
  if not char then return 0 end
  local t = type(char.tally) == "table" and char.tally or {}
  return (tonumber(t.online) or 0) + (onlineFrom and math.max(0, time() - onlineFrom) or 0)
end

-- This session's time so far goes into the tally (at logout and /reload, and when the journey is switched off).
local function countOnline()
  if char and onlineFrom then
    local t = tally()
    t.online = math.floor((tonumber(t.online) or 0) + math.max(0, time() - onlineFrom))
  end
  onlineFrom = nil
end

-- The game's /played: the total then, and how much online had been counted at that moment.
local function onPlayed(total)
  if type(total) ~= "number" or not ns.Context.Usable(total) or total <= 0 then return end
  local t = tally()
  t.played, t.playedAt = math.floor(total), math.floor(Journey.Online())
end

-- Create or update this character's record (the sheet and the server's completed list).
local function open()
  local j = LoreForeverDB.journey
  local key, name, realm = Journey.CharKey()
  local new = not j.chars[key]
  local c = j.chars[key] or { first = time(), events = {} }
  j.chars[key] = c
  c.name, c.realm = name, realm
  c.events = type(c.events) == "table" and c.events or {}
  c.seen = type(c.seen) == "table" and c.seen or {}
  for _, k in ipairs({ "place", "npc", "mob", "book", "boss" }) do c.seen[k] = c.seen[k] or {} end
  c.kills = c.kills or {}
  if type(c.trail) ~= "table" then c.trail = nil end   -- made with the first point kept
  local info = ns.Context.Character()
  c.race, c.raceName, c.class, c.className = info.race, info.raceName, info.class, info.className
  c.faction, c.sex, c.level = info.faction, info.sex, info.level
  -- The server's list can come back empty this early: keep the saved one and ask again at the next quest log update.
  local ids = completedQuests()
  if new then
    c.startLevel, c.startCompleted = tonumber(info.level) or 0, #ids
    c.startUnsure = #ids == 0 or nil     -- maybe not loaded yet: settled when the list comes
  elseif c.startLevel == nil then
    inferStart(c)
  elseif c.startUnsure and #ids > 0 then
    settle(c, ids)
  end
  if #ids > 0 or type(c.completed) ~= "table" then c.completed = ids end
  needCompleted = #ids == 0 and 20 or nil
  trim(c)
  char = c
  pcall(tally)   -- a record from before the tally gets one now, from its events and trail
  return c
end

local bossKeys = {}   -- entry key -> true for every dungeon boss the add-on has lore on (zones[*].b)

-- At login, before the voice and the panel are set up (chapter audio joins the voice's clip list).
function Journey.Init()
  local db = LoreForeverDB
  db.journey = type(db.journey) == "table" and db.journey or {}
  db.journey.chars = type(db.journey.chars) == "table" and db.journey.chars or {}
  migrate(db.journey)
  db.journey.v = 2
  db.texts = type(db.texts) == "table" and db.texts or {}
  db.texts.gossip = db.texts.gossip or {}
  db.texts.books = db.texts.books or {}
  -- The captured text's bookkeeping (Capture.lua: what NPCs say, who saw each line, what we lack); its errors are
  -- reported and never stop the journey.
  if ns.Capture then
    local ok, err = pcall(ns.Capture.Init)
    if not ok and geterrorhandler then geterrorhandler()(err) end
  end
  for _, z in pairs(ns.DB and ns.DB.zones or {}) do
    for _, k in ipairs(z.b or {}) do bossKeys[k] = true end
  end
  if Journey.On() then
    open()
    rememberTitles()
    local z, s = here()
    add("login", { z = z, s = s })
    loginAt = time()
    onlineFrom = loginAt
    takeStock()
  else
    char = db.journey.chars[(Journey.CharKey())]
  end
  startTrail()
  if _G.TakeTaxiNode and hooksecurefunc then pcall(hooksecurefunc, "TakeTaxiNode", Journey.OnTakeTaxi) end
  Journey.LoadChapters()
end

-- "Remember my journey" was switched on in Options: start recording from here.
function Journey.OnToggle()
  resetRoute()
  if Journey.On() and LoreForeverDB.journey then
    -- It was off for a while: what happened then isn't in the record, so nothing in it is certainly a first.
    local was = type(LoreForeverDB.journey.chars) == "table" and LoreForeverDB.journey.chars[(Journey.CharKey())]
    if type(was) == "table" then was.gap = true end
    open()
    takeStock(true)   -- what changed while it was off isn't a moment
    onlineFrom = onlineFrom or time()
  else
    pcall(countOnline)   -- switched off: the time so far counts, the rest doesn't
  end
  Journey.Refresh()
end

-- Chapters --------------------------------------------------------------------------------------------------------

-- What the companion wrote for this character: { story = {title, text, audio}, chapters = { {id, title, text,
-- audio, from, to, lv1, lv2}, ... } } (oldest first), or nil.
function Journey.Data()
  local data = _G.LoreForeverJourneyData
  local mine = type(data) == "table" and type(data.chars) == "table" and data.chars[(Journey.CharKey())]
  return type(mine) == "table" and mine or nil
end

-- The companion's chapters for this character, oldest first (as it writes them), or an empty list.
function Journey.Chapters()
  local out = {}
  local mine = Journey.Data()
  for _, ch in ipairs(mine and type(mine.chapters) == "table" and mine.chapters or {}) do
    if type(ch) == "table" and ch.id then out[#out + 1] = ch end
  end
  return out
end

-- Register chapter audio as clips, so Listen plays the recording instead of the game voice.
function Journey.LoadChapters()
  ns.Voice.extra = ns.Voice.extra or {}
  local mine = Journey.Data()
  if not mine then return end
  for _, ch in ipairs(type(mine.chapters) == "table" and mine.chapters or {}) do
    if type(ch) == "table" and ch.id and ch.audio then ns.Voice.extra["journey:" .. ch.id] = { AUDIO_DIR .. ch.audio } end
  end
  if type(mine.story) == "table" and mine.story.audio then
    ns.Voice.extra["journey:story"] = { AUDIO_DIR .. mine.story.audio }
  end
end

local function find(id)
  if id == "story" then
    local mine = Journey.Data()
    return mine and type(mine.story) == "table" and mine.story or nil
  end
  for _, ch in ipairs(Journey.Chapters()) do
    if ch.id == id then return ch end
  end
end

local function dateRange(ch)
  local from, to = tonumber(ch.from), tonumber(ch.to or ch.t)
  if not to then return "" end
  local a, b = date("%b %d", from or to), date("%b %d", to)
  return a == b and a or (a .. " - " .. b)
end

function Journey.Target(id)
  local ch = find(id)
  if not ch then return nil end
  return { id = "journey:" .. id, key = "journey:" .. id, label = ch.title, text = ch.text }
end

-- Show a chapter in the conversation, where Listen reads it: its recording if it has one, else the game's voice.
function Journey.Open(id, listen)
  local ch = find(id)
  local UI = ns.UI
  if not (ch and UI.frame) then return end
  if not UI.frame:IsShown() then UI.frame:Show() end
  local sub = id == "story" and L["Your story so far"] or dateRange(ch)
  local levels = ch.lv1 and ch.lv2 and (ch.lv1 == ch.lv2 and string.format(L["level %d"], ch.lv1)
    or string.format(L["levels %d-%d"], ch.lv1, ch.lv2)) or nil
  local metaParts = {}
  if sub ~= "" then metaParts[#metaParts + 1] = sub end
  if levels then metaParts[#metaParts + 1] = levels end
  local meta = table.concat(metaParts, "  ·  ")
  local narrated = ns.Voice.HasAudio("journey:" .. id) and ("  " .. GREY .. L["(narrated)"] .. "|r") or ""
  local text = GOLD .. esc(ch.title or L["Your journey"]) .. "|r" .. narrated .. "\n"
    .. (meta ~= "" and (GREY .. meta .. "|r\n") or "") .. WHITE .. esc(ch.text) .. "|r"
  UI.AddMessage("lore", text, Journey.Target(id))
  if char and id ~= "story" then char.lastRead = id end
  if listen then UI.ListenTo(Journey.Target(id)) end
end

-- Login: say when the companion has written a chapter this character hasn't seen.
function Journey.Announce()
  local mine = Journey.Data()
  local chs = mine and type(mine.chapters) == "table" and mine.chapters
  local newest = chs and chs[#chs]
  if not (type(newest) == "table" and newest.id and char) or char.announced == newest.id then return end
  char.announced = newest.id
  local listen = ns.Voice.HasAudio("journey:" .. newest.id)
    and (" " .. ns.Hooks.Link(L["Listen"], "journeylisten", newest.id)) or ""
  say(string.format(L["a new chapter of your journey is ready: %s."], GOLD .. esc(newest.title) .. "|r") .. " "
    .. ns.Hooks.Link(L["Read it"], "journey", newest.id) .. listen)
end

-- Saving -------------------------------------------------------------------------------------------------------------

-- The game only writes SavedVariables on /reload or logout, so "Update my journey" reloads the interface. Called
-- from a button click (ReloadUI needs one).
function Journey.Sync()
  if char and Journey.On() then
    add("sync")
    char.lastSync = time()
  end
  ReloadUI()
  -- Still here a moment later: the reload didn't happen (the game refused it).
  later(2, function() say(L["type /reload to save your journey now."]) end)
end

StaticPopupDialogs["LOREFOREVER_JOURNEY_SYNC"] = {
  OnAccept = function() Journey.Sync() end,
  timeout = 0,
  whileDead = true,
  hideOnEscape = true,
  preferredIndex = STATICPOPUP_NUMDIALOGS,   -- the last popup slot, so other add-ons' popups don't taint ours
}

-- Ask before saving: Update my journey and /lore sync.
function Journey.AskSync()
  local d = StaticPopupDialogs["LOREFOREVER_JOURNEY_SYNC"]
  d.text = L["Save your journey now? This reloads the interface for a few seconds."]
  d.button1, d.button2 = L["Save and reload"], CANCEL or L["Cancel"]
  StaticPopup_Show("LOREFOREVER_JOURNEY_SYNC")
end

-- Counts for the journey page.
function Journey.Stats()
  if not char then return {} end
  local function count(t) local n = 0 for _ in pairs(t or {}) do n = n + 1 end return n end
  local s = char.seen
  return { quests = #(char.completed or {}), places = count(s.place), people = count(s.npc), foes = count(s.mob),
    bosses = count(s.boss), level = char.level }
end

-- Distances in kilometres? The player's pick (a click on the page's stats line), else kilometres in every language
-- but English.
function Journey.Km()
  local pick = settings().distance
  if pick == "km" or pick == "mi" then return pick == "km" end
  local locale = ns.lang and ns.lang.locale or "enUS"
  return locale ~= "enUS" and locale ~= "enGB"
end

-- A distance in yards in miles or kilometres (Journey.Km).
function Journey.Distance(yards)
  if Journey.Km() then return string.format(L["%s km"], string.format("%.1f", yards * 0.9144 / 1000)) end
  return string.format(L["%s miles"], string.format("%.1f", yards / 1760))
end

-- "12,345" (the game's own grouping when it has one).
local function big(n)
  n = math.floor(n + 0.5)
  local s = _G.BreakUpLargeNumbers and try(_G.BreakUpLargeNumbers, n)
  return type(s) == "string" and s or tostring(n)
end

-- "74,150 steps" for a walk in yards (JourneyRecord.Steps).
function Journey.StepsText(yards) return string.format(L["%s steps"], big(ns.JourneyRecord.Steps(yards))) end

-- Click on the stats line: miles or kilometres.
function Journey.ToggleDistance(owner)
  LoreForeverDB.settings = LoreForeverDB.settings or {}
  LoreForeverDB.settings.distance = Journey.Km() and "mi" or "km"
  Journey.Refresh()
  if owner and GameTooltip.IsOwned and GameTooltip:IsOwned(owner) then Journey.NumbersTip(owner) end
end

-- The tooltip over the page's stats line: the journey in numbers (JourneyRecord.Numbers, from the tally; LOR-246).
function Journey.NumbersTip(owner)
  if not (char and ns.JourneyRecord) then return end
  local s = ns.JourneyRecord.Numbers(char)
  GameTooltip:SetOwner(owner, "ANCHOR_BOTTOMLEFT")
  GameTooltip:AddLine(L["Your journey in numbers"])
  local function line(text) T.Tip(text, "tipText", true) end
  if s.yards >= 1 then
    line(string.format(L["Walked: %s"], Journey.StepsText(s.yards) .. " (" .. Journey.Distance(s.yards) .. ")"))
  end
  line(string.format(L["Foes slain: %d"], s.slain))
  if s.elites > 0 then line(string.format(L["Elites slain: %d"], s.elites)) end
  if s.rares > 0 then line(string.format(L["Rares slain: %d"], s.rares)) end
  line(string.format(L["Deaths: %d"], s.deaths))
  local function hours(sec) return string.format("%.1f", sec / 3600) end
  if s.played then line(string.format(L["Hours played: %s"], hours(s.played)))
  elseif s.online >= 360 then line(string.format(L["Hours recorded: %s"], hours(s.online))) end
  local most = {}
  for i = 1, math.min(3, #s.lands) do most[i] = s.lands[i].name end
  if #most > 0 then line(string.format(L["Walked most in %s"], table.concat(most, ", "))) end
  if not s.played then T.Tip(L["Type /played to add your time played."], "muted", true) end
  if s.yards >= 1 then
    T.Tip(Journey.Km() and L["Click to show miles."] or L["Click to show kilometres."], "muted", true)
  end
  GameTooltip:Show()
end

-- Moments --------------------------------------------------------------------------------------------------------------

local ROW_H, HEAD_H, MOMENTS, FOES = 34, 22, 60, 5   -- MOMENTS: on the page's timeline
local function howText(how)
  if how == "flight" then return L["by flight"]
  elseif how == "hearth" then return L["by hearthstone"]
  elseif how == "boat" then return L["by boat"]
  elseif how == "corpse" then return L["as a spirit"]
  elseif how == "portal" then return L["by portal"] end
end

-- The game's own word for a standing (1 Hated .. 8 Exalted), in your language.
local function standingText(st)
  if type(st) ~= "number" then return "?" end
  local label = try(GetText, "FACTION_STANDING_LABEL" .. st, try(UnitSex, "player")) or _G["FACTION_STANDING_LABEL" .. st]
  return usable(label) and label or tostring(st)
end
Journey.StandingText = standingText   -- for the copied record (JourneyRecord.lua)

-- An entry by its exact name (a book, an item, a faction), or nil.
local function named(name)
  local idx = ns.DB and ns.DB.index
  return type(name) == "string" and name ~= "" and idx and idx.name[ns.Engine.lower(name)] or nil
end

-- A place's entry by its name: the subzone (in this zone, when the name is shared), an area of one, or the zone.
local function placeNamed(name, zone)
  local eng, db = ns.engine, ns.DB
  if type(name) ~= "string" or name == "" or not (eng and db) then return nil end
  local key = try(eng.SubzoneKey, eng, name, zone) or (db.index.area and db.index.area[ns.Engine.lower(name)])
  if key and db.entries[key] then return key end
  local zk = eng:ZoneKey(name)
  return zk and db.entries["zone:" .. zk] and ("zone:" .. zk) or nil
end

-- The lore entry a moment is about, if the add-on has one: the quest, the person, the foe (or the story of its kind:
-- "Razormane Hunter" is a quilboar), the boss, the place, the book or item, the faction, where the hearthstone was set
-- or where a flight went.
local function loreKey(e)
  local db, eng = ns.DB, ns.engine
  if not (db and eng) then return nil end
  if (e.k == "qt" or e.k == "qx" or e.k == "qa") and e.id then return db.index.quest[e.id] end
  if e.k == "boss" and e.key then return e.key end
  if (e.k == "npc" or e.k == "kill" or e.k == "boss") and e.n then
    local key, how = eng:KeyForName(e.n)
    return (how == "exact" or (how == "mob" and e.k == "kill")) and key or nil
  end
  if e.k == "zone" then
    local sub = e.s and db.index.name[ns.Engine.lower(e.s)]
    if sub then return sub end
    local zk = eng:ZoneKey(e.z)
    return zk and ("zone:" .. zk) or nil
  end
  if e.k == "book" or e.k == "loot" or e.k == "rep" then return named(e.n) end
  if e.k == "bind" then return placeNamed(e.n, e.z) end
  if e.k == "taxi" and type(e.to) == "string" then
    return placeNamed(e.to:match("^([^,]+)"), e.z) or placeNamed(e.to:match(",%s*(.+)$"), e.z)
  end
end

-- Where a moment happened, as a lore entry (the subzone, else the zone): what a moment with no entry of its own opens.
local function placeKey(e)
  if type(e) ~= "table" then return nil end
  return (e.s and e.s ~= e.z and placeNamed(e.s, e.z)) or placeNamed(e.z, e.z)
end

-- Where a moment happened: map ID, x and y (0 to 1), and how it's known: "at" (saved with it) or "trail" (the map
-- trail's nearest point within SPOT_GAP, for moments from before spots were saved). nil when neither says, and for
-- dungeon moments, whose trail points are outside.
function Journey.Spot(e, c)
  c = c or char
  if type(e) ~= "table" then return nil end
  if type(e.at) == "string" then
    local m, x, y = e.at:match("^(%d+):(%d+):(%d+)$")
    if m then return tonumber(m), tonumber(x) / 1000, tonumber(y) / 1000, "at" end
  end
  local t = tonumber(e.t)
  if not t or e.inst or e.k == "boss" or type(c) ~= "table" or type(c.trail) ~= "table" then return nil end
  local best, gap
  for _, pts in pairs(c.trail) do
    if type(pts) == "table" then
      for _, p in ipairs(pts) do
        local d = type(p) == "table" and math.abs((tonumber(p.t) or 0) - t)
        if d and d <= SPOT_GAP and (not gap or d < gap) and tonumber(p.m) then best, gap = p, d end
      end
    end
  end
  if best then return tonumber(best.m), tonumber(best.x), tonumber(best.y), "trail" end
end

-- One line about a moment: title and the grey line under it, or nil for events that aren't moments.
local function describe(e)
  local where = e.s or e.z
  local function sub(...)
    local parts = {}
    for i = 1, select("#", ...) do
      local v = select(i, ...)
      if v and v ~= "" then parts[#parts + 1] = v end
    end
    return table.concat(parts, "  ·  ")
  end
  local with = type(e.pt) == "table" and #e.pt > 0 and string.format(L["with %s"], table.concat(e.pt, ", ")) or nil
  if e.k == "qt" then return e.q or string.format(L["Quest %d"], e.id or 0), sub(L["Quest done"], with or where)
  elseif e.k == "qa" then return e.q or string.format(L["Quest %d"], e.id or 0), sub(L["Quest accepted"], where)
  elseif e.k == "qx" then return e.q or string.format(L["Quest %d"], e.id or 0), sub(L["Quest abandoned"], where)
  elseif e.k == "zone" then
    -- In a dungeon, an event that isn't a new place is an entry; a new room inside isn't.
    local entry = e.inst and (e.how == "instance" or not e.new)
    -- "New" and "first" only when the record covers the whole life (Journey.Whole).
    local label = entry and (e.new and L["Dungeon entered"] or L["Dungeon entered again"])
      or (Journey.Whole() and L["New place"] or L["Place visited"])
    return e.s or e.z, sub(label, e.s and e.s ~= e.z and e.z, howText(e.how))
  elseif e.k == "lvl" then return string.format(L["Reached level %d"], e.lv or 0), where or ""
  elseif e.k == "boss" then return e.n, sub(L["Boss defeated"], with or e.z)
  elseif e.k == "death" then return where and string.format(L["Died in %s"], where) or L["Died"], with or e.z or ""
  elseif e.k == "kill" then return e.n, sub(Journey.Whole() and L["First kill"] or L["Defeated"], where)
  elseif e.k == "npc" then return e.n, sub(L["Met"], where)
  elseif e.k == "book" then return e.n, sub(L["Read"], where)
  elseif e.k == "bind" then return string.format(L["Hearthstone set to %s"], e.n or where or "?"), e.z or ""
  elseif e.k == "taxi" then
    return string.format(L["Flew to %s"], e.to or where or "?"), e.from and string.format(L["from %s"], e.from) or ""
  elseif e.k == "rep" then return string.format(L["%s with %s"], standingText(e.st), e.n or "?"), sub(L["Reputation"], where)
  elseif e.k == "mount" then return e.n or L["A new mount"], sub(L["New mount"], where)
  elseif e.k == "spell" then return e.n, sub(L["Learned"], where)
  elseif e.k == "loot" then return e.n, sub(e.qid and L["Quest reward"] or L["Found"], where)
  elseif e.k == "prof" then return (e.n or "?") .. " " .. (e.r or 0), sub(L["Profession milestone"], where)
  elseif e.k == "shot" then
    return where and string.format(L["Screenshot in %s"], where) or L["Screenshot"], e.s and e.z or ""
  end
end

-- The journey page ---------------------------------------------------------------------------------------------------
-- A page over the chat, where History opens, from the Journey button and /lore journey: a timeline of your moments by
-- play session (newest first) with filters for quests, fights and milestones, and beside it the journey map
-- (JourneyMap.lua): where the moment under the mouse happened, and your road there. The row the map shows wears a gold
-- mark. A moment opens its lore in the chat and closes the page (Shift-click: its narration joins the playlist): its
-- own entry, else the place it happened (rows that open something end in a small gold arrow; the tooltip names it).
-- When the page is narrow, the map steps aside and the list takes the width. Bigger map opens the map in a window of
-- its own over the panel, with the filters; Esc closes it.

local SESSION_GAP = 1800            -- seconds without an event before a login starts a new play session (not a /reload)
local SESSIONS = 10                 -- play sessions on the All timeline
local FILTER_MOMENTS = 200          -- moments on a filtered timeline (All shows MOMENTS)
local EARLIER = 200                 -- earlier quests listed by name
local MAP_FROM = 470                -- the narrowest page that has the map beside the list
local LIST_TOP, LIST_BOTTOM = 94, 70   -- the footer: the web line, the note, then the buttons

-- Each event kind's filter, and each filter's colour (its chip's dot, the row's dot and the map's).
local FILTER_OF = { qa = "quest", qt = "quest", qx = "quest", boss = "fight", kill = "fight", death = "fight",
  lvl = "mile", zone = "mile", mount = "mile", rep = "mile", prof = "mile", loot = "mile" }
local COLOR = { quest = { 1, 0.82, 0 }, fight = { 0.92, 0.42, 0.32 }, mile = { 0.62, 0.83, 1 },
  other = { 0.8, 0.8, 0.8 } }
COLOR.done = COLOR.quest
-- done: the quest history (LOR-40), every quest this character completed, by zone (no map).
local FILTERS = { "all", "quest", "done", "fight", "mile", "chapters" }
local MAP_FILTERS = { "all", "quest", "fight", "mile" }   -- the large map's (chapters have no map)
local ASPECT = 668 / 1002                                -- the map art's height / width
local function filterLabel(f)
  return (f == "quest" and L["Quests"]) or (f == "done" and L["Completed"]) or (f == "fight" and L["Fights"])
    or (f == "mile" and L["Milestones"]) or (f == "chapters" and L["Chapters"]) or L["All"]
end

-- Play sessions, oldest first: { from = t, to = t, first = i, last = i } over c.events.
local function sessions(c)
  local out, prev = {}, nil
  for i, e in ipairs(c and c.events or {}) do
    local t = tonumber(e.t) or 0
    local cur = out[#out]
    if not cur or (e.k == "login" and t - prev > SESSION_GAP) then
      cur = { from = t, first = i }
      out[#out + 1] = cur
    end
    cur.to, cur.last, prev = t, i, t
  end
  return out
end
function Journey.Sessions() return sessions(char) end

local function dayText(t)
  local d = date("%Y-%m-%d", t)
  if d == date("%Y-%m-%d", time()) then return L["Today"] end
  if d == date("%Y-%m-%d", time() - 86400) then return L["Yesterday"] end
  return date("%b %d", t)
end

local function levelsText(lv1, lv2)
  if not lv1 then return nil end
  return lv1 == lv2 and string.format(L["level %d"], lv1) or string.format(L["levels %d-%d"], lv1, lv2)
end

-- Where a session went (its zones in order: the first two and the last) and its level range.
local function sessionFacts(c, s)
  local zones, seen, lv1, lv2 = {}, {}, nil, nil
  for i = s.first, s.last do
    local e = c.events[i]
    local lv = tonumber(e.lv)
    if lv then lv1, lv2 = math.min(lv1 or lv, lv), math.max(lv2 or lv, lv) end
    if (e.k == "login" or e.k == "zone") and type(e.z) == "string" and e.z ~= "" and not seen[e.z] then
      seen[e.z] = true
      zones[#zones + 1] = e.z
    end
  end
  if #zones > 3 then zones = { zones[1], zones[2], zones[#zones] } end
  return table.concat(zones, ", "), levelsText(lv1, lv2)
end

local function joined(...)
  local parts = {}
  for i = 1, select("#", ...) do
    local v = select(i, ...)
    if v and v ~= "" then parts[#parts + 1] = v end
  end
  return table.concat(parts, "  ·  ")
end

-- The filter the page shows (remembered in settings): all, quest, fight, mile or chapters.
function Journey.Filter()
  local f = settings().journeyFilter
  for _, k in ipairs(FILTERS) do if k == f then return f end end
  return "all"
end

-- What the page lists for a filter, top to bottom: { head = "..." } or { title, sub, chapter = id, key = lore key,
-- ev = the event, kind = its filter }. Moments come by play session, newest first. Fights starts with the bosses
-- you've defeated and the foes you fought most; Quests ends with the quests finished before the record (by name where
-- the add-on has the quest); Chapters lists the story so far and the chapters, newest first.
-- With `match` (the page's search: match(title, sub, zone) -> true to keep), only matching rows are listed, headings
-- only over rows that are, and All looks back through every session (up to FILTER_MOMENTS matches), not just the last
-- few.
function Journey.List(filter, match)
  filter = filter or "all"
  local items = {}
  local function keep(title, sub, zone) return not match or match(title, sub, zone) end
  if filter == "chapters" then
    local mine = Journey.Data()
    local story = mine and type(mine.story) == "table" and mine.story
    if story and keep(story.title or L["Your story so far"], L["Your story so far"]) then
      items[#items + 1] = { chapter = "story", title = story.title or L["Your story so far"],
        sub = L["Your story so far"] }
    end
    local chs = Journey.Chapters()
    for i = #chs, 1, -1 do
      local ch = chs[i]
      if keep(ch.title or L["Your journey"], dateRange(ch)) then
        items[#items + 1] = { chapter = ch.id, title = ch.title or L["Your journey"], sub = dateRange(ch) }
      end
    end
    return items
  end
  if not char then return items end
  if filter == "done" then return Journey.History(match) end
  if filter == "fight" then
    local bosses = {}
    for name, t in pairs(char.seen.boss or {}) do
      if keep(name) then bosses[#bosses + 1] = { name = name, t = t } end
    end
    table.sort(bosses, function(a, b) return a.t > b.t end)
    if #bosses > 0 then
      items[#items + 1] = { head = L["Bosses defeated"] }
      for _, b in ipairs(bosses) do
        items[#items + 1] = { title = b.name, sub = date("%b %d", b.t), key = loreKey({ k = "boss", n = b.name }) }
      end
    end
    local foes = {}
    for name, n in pairs(char.kills or {}) do
      if keep(name) then foes[#foes + 1] = { name = name, n = n } end
    end
    table.sort(foes, function(a, b) if a.n ~= b.n then return a.n > b.n end return a.name < b.name end)
    if #foes > 0 then
      items[#items + 1] = { head = L["Most fought"] }
      for i = 1, math.min(FOES, #foes) do
        local f = foes[i]
        items[#items + 1] = { title = f.name, sub = string.format(L["%d defeated"], f.n),
          key = loreKey({ k = "kill", n = f.name }) }
      end
    end
  end
  local cap = (filter == "all" and not match) and MOMENTS or FILTER_MOMENTS
  local list, n, shown = sessions(char), 0, 0
  for si = #list, 1, -1 do
    if (filter == "all" and not match and shown >= SESSIONS) or n >= cap then break end
    local s = list[si]
    local moments = {}
    for i = s.last, s.first, -1 do
      local e = char.events[i]
      local kind = FILTER_OF[e.k] or "other"
      -- All leaves out quests accepted (the Quests filter has them): there'd be two rows for every quest.
      if (filter == "all" and e.k ~= "qa") or kind == filter then
        local title, sub = describe(e)
        if title and keep(title, sub, e.z) then
          local key = loreKey(e)
          moments[#moments + 1] = { title = title, sub = sub, key = key, place = not key and placeKey(e) or nil, ev = e,
            kind = kind }
        end
      end
      if n + #moments >= cap then break end
    end
    if #moments > 0 then
      local route, levels = sessionFacts(char, s)
      items[#items + 1] = { head = joined(dayText(s.from), route, levels) }
      for _, m in ipairs(moments) do items[#items + 1] = m end
      n, shown = n + #moments, shown + 1
    end
  end
  if filter == "quest" then
    local inRecord = {}
    for _, e in ipairs(char.events) do
      if e.k == "qt" and e.id then inRecord[e.id] = true end
    end
    local named, more = {}, 0
    local done = type(char.completed) == "table" and char.completed or {}
    for i = #done, 1, -1 do
      local id = done[i]
      if not inRecord[id] then
        local key = ns.DB and ns.DB.index and ns.DB.index.quest[id]
        local entry = key and ns.DB.entries[key]
        if match and not (entry and entry.n and (keep(entry.n) or (entry.en and keep(entry.en)))) then
          -- searching: unnamed and non-matching quests are left out, not counted
        elseif entry and entry.n and #named < EARLIER then
          named[#named + 1] = { title = entry.n, sub = L["Quest done"], key = key }
        else
          more = more + 1
        end
      end
    end
    if #named + more > 0 then
      items[#items + 1] = { head = string.format(L["Earlier quests (%d)"], #named + more) }
      for _, q in ipairs(named) do items[#items + 1] = q end
      if more > 0 then items[#items + 1] = { head = string.format(L["and %d more"], more), quiet = true } end
    end
  end
  return items
end

-- Everything on the All timeline.
function Journey.Items() return Journey.List("all") end

-- The quest history (LOR-40) ---------------------------------------------------------------------------------------
-- Every quest this character completed, newest first, by zone, from what's already kept: the record's turn-ins (when,
-- where, at what level), the server's completed list (quests done before the record, or whose turn-in was trimmed),
-- the quest text Capture.lua keeps (LoreForeverDB.quests, shared by the account's characters) and the lore entry.
-- Nothing new is saved for it. Clicking a quest shows its text again in the chat, then its lore entry (UI.ShowEntry:
-- the usual spoiler rules).

local HISTORY = 300                 -- quests listed on Completed; the rest are counted (searching finds them all)
local QUEST_PARTS = { "text", "objectives", "progress", "completion" }   -- LoreForeverDB.quests[id] fields, in order
local function partLabel(p)
  return (p == "text" and L["Description"]) or (p == "objectives" and L["Objectives"])
    or (p == "progress" and L["Progress"]) or L["Completion"]
end

-- The kept quest text record for a quest, when it has any text to read.
local function keptText(id)
  local quests = type(LoreForeverDB) == "table" and type(LoreForeverDB.quests) == "table" and LoreForeverDB.quests
  local rec = quests and quests[id]
  if type(rec) ~= "table" then return nil end
  for _, p in ipairs(QUEST_PARTS) do
    if usable(rec[p]) then return rec end
  end
end

-- Title, zone, lore key and kept text for q ({ id, and from a turn-in: t, z, s, lv, pt, title }).
local function questInfo(q)
  local db = ns.DB
  local key = db and db.index and db.index.quest[q.id]
  local entry = key and db.entries[key]
  local quests = type(LoreForeverDB) == "table" and type(LoreForeverDB.quests) == "table" and LoreForeverDB.quests or {}
  local rec = type(quests[q.id]) == "table" and quests[q.id] or nil
  local zone = entry and entry.z and db.entries["zone:" .. entry.z]
  q.key, q.text = key, keptText(q.id)
  q.title = q.title or (rec and usable(rec.title) and rec.title) or (entry and entry.n) or questTitle(q.id)
  q.z = (usable(q.z) and q.z) or (zone and zone.n) or (rec and usable(rec.zone) and rec.zone) or nil
  return q
end

-- Every quest this character completed, newest first: those turned in while recording (by their latest turn-in),
-- then the rest of the server's list, newest ID first. Each is { id, title, z, key, text, t, s, lv, pt, earlier }.
function Journey.Completed()
  local out, seen = {}, {}
  if not char then return out end
  for i = #char.events, 1, -1 do
    local e = char.events[i]
    if e.k == "qt" and e.id and not seen[e.id] then
      seen[e.id] = true
      out[#out + 1] = questInfo({ id = e.id, title = e.q, t = e.t, z = e.z, s = e.s, lv = e.lv, pt = e.pt })
    end
  end
  local done = type(char.completed) == "table" and char.completed or {}
  local rest = {}
  for _, id in ipairs(done) do
    if not seen[id] then seen[id] = true; rest[#rest + 1] = id end
  end
  table.sort(rest, function(a, b) return a > b end)
  for _, id in ipairs(rest) do out[#out + 1] = questInfo({ id = id, earlier = true }) end
  return out
end

-- The Completed list: a heading per zone (zones in the order of their newest quest), its quests under it. Quests with
-- no name anywhere (not in the lore, never read with the add-on, unknown to the client) are only counted.
function Journey.History(match)
  local groups, order, listed, more = {}, {}, 0, 0
  for _, q in ipairs(Journey.Completed()) do
    local zone = q.z or L["Other quests"]
    local sub = joined(q.t and date("%b %d", q.t) or L["Done earlier"], q.t and levelsText(tonumber(q.lv), tonumber(q.lv)),
      q.s ~= q.z and q.s or nil, q.text and L["quest text"] or nil)
    if not q.title then
      if not match then more = more + 1 end
    elseif match and not match(q.title, sub, zone) then
      -- searching: left out, not counted
    elseif not match and listed >= HISTORY then
      more = more + 1
    else
      local g = groups[zone]
      if not g then
        g = { zone = zone, quests = {} }
        groups[zone] = g
        order[#order + 1] = g
      end
      g.quests[#g.quests + 1] = { title = q.title, sub = sub, quest = q.id, kind = "done" }
      listed = listed + 1
    end
  end
  local items = {}
  for _, g in ipairs(order) do
    items[#items + 1] = { head = string.format("%s (%d)", g.zone, #g.quests) }
    for _, it in ipairs(g.quests) do items[#items + 1] = it end
  end
  if more > 0 then items[#items + 1] = { head = string.format(L["and %d more"], more), quiet = true } end
  return items
end

-- The game's quest templates name you $N, your class $C and your race $R (Capture.Placeholders; 0.7.0 wrote <name>):
-- shown here as this character's. Only ever on screen.
local function personal(text)
  local me = ns.Context.Character()
  local fill = { N = me.name, C = me.className, R = me.raceName }
  return (text:gsub("<name>", "$N"):gsub("%$([NnCcRr])", function(c)
    local v = fill[c:upper()]
    return usable(v) and v or nil
  end))
end

-- Show a completed quest in the chat: when you did it, its quest text as you read it (when it was kept), then its lore
-- entry. Quests done before the add-on (or with Keep the quest text you see off) say so, and show the lore alone.
function Journey.OpenQuest(id)
  local UI = ns.UI
  if not (UI and UI.frame and type(id) == "number") then return end
  local q
  for _, x in ipairs(Journey.Completed()) do
    if x.id == id then q = x break end
  end
  q = q or questInfo({ id = id, earlier = true })
  if not UI.frame:IsShown() then UI.frame:Show() end
  local when
  if q.t then
    local with = type(q.pt) == "table" and #q.pt > 0 and string.format(L["with %s"], table.concat(q.pt, ", ")) or nil
    when = joined(string.format(L["Completed %s"], date("%b %d, %Y", q.t)), levelsText(tonumber(q.lv), tonumber(q.lv)),
      q.s and q.s ~= q.z and (q.s .. ", " .. (q.z or "")) or q.z, with)
  else
    when = L["Completed before Lore Forever began your journey record."]
  end
  local parts = { GOLD .. esc(q.title or string.format(L["Quest %d"], id)) .. "|r", GREY .. esc(when) .. "|r" }
  local any = false
  for _, p in ipairs(QUEST_PARTS) do
    local text = q.text and q.text[p]
    if usable(text) then
      any = true
      parts[#parts + 1] = "\n" .. GOLD .. partLabel(p) .. "|r\n" .. WHITE .. esc(personal(text)) .. "|r"
    end
  end
  if not any then
    parts[#parts + 1] = "\n" .. GREY .. L["Its quest text wasn't kept. Lore Forever keeps the text of the quests you read while it's installed (Options: Keep the quest text you see)."] .. "|r"
    if not q.key then parts[#parts + 1] = GREY .. L["Lore Forever has no story for this quest yet."] .. "|r" end
  end
  UI.AddMessage("lore", table.concat(parts, "\n"), nil, nil, nil, nil, q.key)
  if q.key and UI.ShowEntry then UI.ShowEntry(q.key, "journey") end
  return q
end

-- The page's width and height: its own once it's laid out, else the panel's less the sidebar.
local function pageSize()
  local p = Journey.page
  local w, h = p and tonumber(p:GetWidth()), p and tonumber(p:GetHeight())
  local fw = ns.UI.frame and tonumber(ns.UI.frame:GetWidth())
  local fh = ns.UI.frame and tonumber(ns.UI.frame:GetHeight())
  w = (w and w > 0) and w or (((fw and fw > 0) and fw or 820) - ns.UI.CHAT_X - 8)
  h = (h and h > 0) and h or (((fh and fh > 0) and fh or 560) - 108)
  return w, h
end

-- The page, over the chat where History opens (UI.Create makes it with the panel).
function Journey.CreatePage(f)
  local p = CreateFrame("Frame", "LoreForeverJourneyPage", f)
  p:SetPoint("TOPLEFT", ns.UI.CHAT_X - 4, -60)
  p:SetPoint("BOTTOMRIGHT", -12, 8)   -- down over the suggestions and message box, so none of the chat shows
  p:SetFrameLevel((f:GetFrameLevel() or 1) + 20)
  p:EnableMouse(true)
  local bg = p:CreateTexture(nil, "BACKGROUND")
  bg:SetAllPoints()
  ns.Theme.Fill(bg, "overlay")
  ns.Theme.CoverChat(p)
  p:HookScript("OnHide", function() Journey.HideBigMap() end)   -- the large map goes with the page (and the panel)
  p:Hide()
  Journey.page = p
  Journey.CreateView(p)
  p:SetScript("OnSizeChanged", function(self) if self:IsShown() then Journey.Refresh() end end)
  return p
end

-- The filter chips from x, y, each as wide as its label, with its colour's dot (All and Chapters have none).
local function chipRow(parent, x, y, filters)
  local chips = {}
  for _, key in ipairs(filters) do
    local b = ns.UI.TextButton(parent, 40, 22, T.font.label, T.color.tab)
    b.text:SetJustifyH("CENTER")
    b.text:SetText(filterLabel(key))
    local w = math.max(40, math.floor((T.TextWidth(b.text) or 40) + 18))
    if COLOR[key] then
      local dot = b:CreateTexture(nil, "OVERLAY")
      dot:SetTexture(T.HasTexture(T.DISC) and T.DISC or "Interface\\Buttons\\WHITE8X8")
      dot:SetVertexColor(COLOR[key][1], COLOR[key][2], COLOR[key][3], 1)
      dot:SetSize(7, 7)
      dot:SetPoint("LEFT", 8, 0)
      b.text:ClearAllPoints()
      b.text:SetPoint("TOPLEFT", 16, -2)
      b.text:SetPoint("BOTTOMRIGHT", -6, 2)
      w = w + 10
    end
    b:SetWidth(w)
    b:SetPoint("TOPLEFT", x, y)
    x = x + w + 4
    b.filter = key
    b:SetScript("OnClick", function(self) Journey.SetFilter(self.filter) end)
    chips[#chips + 1] = b
  end
  return chips
end

-- What both maps call back.
local function mapOptions(large)
  return {
    large = large,
    onWhole = function()
      Journey.mapWhole = not Journey.mapWhole
      Journey.FocusMap(Journey.focus, true)
    end,
    onFocus = function(m) if m ~= Journey.focus then Journey.FocusMap(m, true) end end,
    onOpen = function(m, shift) Journey.OpenMoment(m, shift) end,
    onStep = function(dir) Journey.StepMap(dir) end,
    onExpand = function() Journey.ShowBigMap() end,
    trail = function() return Journey.TrailPoints() end,
    related = function(m) return Journey.Related(m) end,
    tooltip = function(list, owner, canZoom) Journey.MomentTip(list, owner, canZoom) end,
  }
end

function Journey.CreateView(view)
  local UI = ns.UI
  local head = UI.Header(view, L["Your journey"])
  head:SetPoint("TOPLEFT", 10, -8)
  local close = ns.Theme.Button(view)
  close:SetHeight(22)
  close:SetPoint("TOPRIGHT", -8, -6)
  close:SetText(L["Back"])
  close:SetWidth(math.max(70, math.floor((T.TextWidth(close:GetFontString()) or 50) + 24)))
  close:SetScript("OnClick", function() Journey.Hide() end)
  Journey.closeButton = close
  -- Search what the chosen filter lists (places, people, quests, foes and their zones), in the header row.
  local search = UI.SearchBox(view, 170, function()
    if Journey.scroll and Journey.scroll.SetVerticalScroll then Journey.scroll:SetVerticalScroll(0) end
    Journey.Refresh()
  end)
  search:SetHeight(20)
  search:SetPoint("RIGHT", close, "LEFT", -8, 0)
  Journey.search = search

  local who = ns.Theme.Muted(view:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall"))
  who:SetPoint("TOPLEFT", head, "BOTTOMLEFT", 0, -4)
  who:SetPoint("RIGHT", view, "RIGHT", -10, 0)
  who:SetJustifyH("LEFT")
  Journey.whoLine = who
  -- The stats line, on a frame of its own: hovering it shows the journey in numbers (LOR-246: how far you walked, foes
  -- slain, deaths, time played), and a click switches distances between miles and kilometres.
  local numbers = CreateFrame("Frame", nil, view)
  numbers:SetPoint("TOPLEFT", who, "BOTTOMLEFT", 0, -2)
  numbers:SetPoint("RIGHT", view, "RIGHT", -10, 0)
  numbers:SetHeight(20)
  local stats = numbers:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  stats:SetPoint("TOPLEFT", 0, -4)
  stats:SetPoint("RIGHT")
  stats:SetJustifyH("LEFT")
  Journey.statsLine = stats
  numbers:EnableMouse(true)
  numbers:SetScript("OnMouseUp", function(self, button)
    if button == nil or button == "LeftButton" then Journey.ToggleDistance(self) end
  end)
  numbers:SetScript("OnEnter", function(self) Journey.NumbersTip(self) end)
  numbers:SetScript("OnLeave", function() GameTooltip:Hide() end)
  Journey.numbersHit = numbers

  -- The filters: chips, each with its colour's dot (All and Chapters have none).
  Journey.chips = chipRow(view, 10, -66, FILTERS)

  -- The footer: when it was saved, then Copy my journey record (JourneyRecord.lua) and Update my journey, each as
  -- wide as its label, clear of the panel's resize grip (it sits over this corner and takes clicks 28 in from it).
  local sync = ns.Theme.SkinButton(CreateFrame("Button", "LoreForeverJourneySync", view, "UIPanelButtonTemplate"))
  sync:SetSize(150, 22)
  sync:SetPoint("BOTTOMRIGHT", -18, 8)
  sync:SetText(L["Update my journey"])
  local sw = ns.Theme.TextWidth(sync:GetFontString())
  if sw then sync:SetWidth(math.max(150, sw + 24)) end
  sync:SetScript("OnClick", function() Journey.AskSync() end)
  sync:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Update my journey"])
    T.Tip(L["Saves your journey now. The game only saves add-on data when you log out or reload."], "tipText", true)
    GameTooltip:Show()
  end)
  sync:SetScript("OnLeave", function() GameTooltip:Hide() end)
  Journey.syncButton = sync
  if ns.JourneyRecord then
    local copy = ns.JourneyRecord.Attach(view, sync, 170)
    copy:SetHeight(22)
    copy:ClearAllPoints()
    copy:SetPoint("RIGHT", sync, "LEFT", -6, 0)
  end
  local note = ns.Theme.Muted(view:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall"))
  note:SetPoint("BOTTOMLEFT", 10, 36)
  note:SetPoint("RIGHT", view, "RIGHT", -10, 0)
  note:SetJustifyH("LEFT")
  Journey.note = note
  -- Above the note, the way to this journey's page on the website (JourneyRecord.lua, LOR-222).
  if ns.JourneyRecord then
    local web = ns.JourneyRecord.WebLine(view)
    web:SetPoint("BOTTOMLEFT", 6, 50)
    web:SetPoint("RIGHT", view, "RIGHT", -10, 0)
    Journey.webLine = web
  end

  local sf = CreateFrame("ScrollFrame", "LoreForeverJourneyScroll", view, "UIPanelScrollFrameTemplate")
  sf:SetPoint("TOPLEFT", 6, -LIST_TOP)
  sf:SetPoint("BOTTOMRIGHT", -28, LIST_BOTTOM)
  local content = CreateFrame("Frame", nil, sf)
  content:SetSize(pageSize() - 36, 100)
  sf:SetScrollChild(content)
  Journey.scroll, Journey.content, Journey.rows = sf, content, {}

  -- The journey map, right of the list (JourneyMap.lua). Whole journey switches it between zone and continent.
  if ns.JourneyMap then
    Journey.map = ns.JourneyMap.Create(view, mapOptions(false))
    Journey.map:SetPoint("TOPRIGHT", -10, -LIST_TOP)
    Journey.card = Journey.CreateCard(view, Journey.map)
  end

  local empty = ns.Theme.Muted(view:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall"))
  empty:SetPoint("TOPLEFT", 10, -(LIST_TOP + 6))
  empty:SetPoint("RIGHT", view, "RIGHT", -10, 0)
  empty:SetJustifyH("LEFT")
  Journey.empty = empty
end

function Journey.Show()
  local UI = ns.UI
  if not (Journey.page and UI.frame) then return end
  if not UI.frame:IsShown() then UI.frame:Show() end
  if UI.historyFrame then UI.historyFrame:Hide() end
  Journey.page:Show()
  Journey.Refresh()
  UI.SeenPage("journey")   -- its "New" after an update (WhatsNew.lua) has done its job
end

function Journey.Hide()
  if Journey.page then Journey.page:Hide() end
end

function Journey.IsShown()
  return Journey.page and Journey.page:IsShown() and true or false
end

function Journey.Toggle()
  if Journey.IsShown() then return Journey.Hide() end
  Journey.Show()
end

function Journey.SetFilter(f)
  if LoreForeverDB and LoreForeverDB.settings then LoreForeverDB.settings.journeyFilter = f end
  if Journey.scroll and Journey.scroll.SetVerticalScroll then Journey.scroll:SetVerticalScroll(0) end
  Journey.Refresh()
end

-- The row the maps show wears the gold mark.
local function markRows()
  for _, r in ipairs(Journey.rows or {}) do
    if r.mark then T.ShowMark(r.mark, r:IsShown() and r.moment ~= nil and r.moment == Journey.focus) end
  end
end

-- Show moment m (one of Journey.mapMoments) on the maps (beside the list, and the large one when it's open): its
-- zone, or its continent with Whole journey.
function Journey.FocusMap(m, animate)
  if not m then return end
  local small = Journey.map and Journey.map:IsShown()
  local big = Journey.bigWin and Journey.bigWin:IsShown()
  if not (small or big) then return end
  Journey.focus = m
  local list, at = Journey.mapMoments or {}, nil
  for i, x in ipairs(list) do if x == m then at = i end end
  for _, f in ipairs({ small and Journey.map or false, big and Journey.bigWin.map or false }) do
    if f then
      ns.JourneyMap.Focus(f, list, m, Journey.mapWhole, animate)
      ns.JourneyMap.SetSteps(f, at and at > 1, at and at < #list)
    end
  end
  markRows()
  Journey.UpdateCard()
end

-- Scroll the list so moment m's row is in view.
function Journey.ShowRow(m)
  local sf = Journey.scroll
  if not (m and sf and sf.SetVerticalScroll) then return end
  for _, r in ipairs(Journey.rows) do
    if r:IsShown() and r.moment == m and r.top then
      local cur, h = tonumber(sf:GetVerticalScroll()) or 0, tonumber(sf:GetHeight()) or 0
      local range = tonumber(sf:GetVerticalScrollRange()) or 0
      if r.top < cur then
        sf:SetVerticalScroll(math.max(0, r.top - 4))
      elseif h > 0 and r.top + ROW_H > cur + h then
        sf:SetVerticalScroll(math.min(range, r.top + ROW_H - h + 4))
      end
      return
    end
  end
end

-- The arrows under the map: the moment before or after the one shown, in time order; the list follows.
function Journey.StepMap(dir)
  local list, at = Journey.mapMoments or {}, nil
  for i, x in ipairs(list) do if x == Journey.focus then at = i end end
  local m = at and list[at + dir]
  if not m then return end
  Journey.FocusMap(m, true)
  Journey.ShowRow(m)
end

-- What a moment or row opens: its own entry, else the place it happened. Shift-click queues its narration instead.
function Journey.OpenMoment(m, shift)
  local key = m and (m.key or m.place)
  if not key then return end
  local UI = ns.UI
  if shift and UI.CanQueue(key) then
    UI.PlaylistAdd(key)
    return
  end
  Journey.HideBigMap()
  Journey.Hide()
  UI.Open(key, nil, "journey")
end

-- The map trail's points, every session's, oldest first: { m, x, y, t }.
function Journey.TrailPoints(c)
  c = c or char
  local out = {}
  for _, pts in pairs(type(c) == "table" and type(c.trail) == "table" and c.trail or {}) do
    for _, p in ipairs(type(pts) == "table" and pts or {}) do
      if type(p) == "table" and tonumber(p.m) and tonumber(p.x) and tonumber(p.y) and tonumber(p.t) then
        out[#out + 1] = p
      end
    end
  end
  table.sort(out, function(a, b) return a.t < b.t end)
  return out
end

-- The other end of a quest moment: where you took a quest you finished or gave up (or finished one you took), as
-- { ev, label, where, t, spot = Map.Place(...) or nil, color }, or nil. Kept on the moment once looked up.
function Journey.Related(m)
  local e = type(m) == "table" and m.ev
  if not (char and type(e) == "table" and e.id and (e.k == "qa" or e.k == "qt" or e.k == "qx")) then return nil end
  if m.related ~= nil then return m.related or nil end
  local t, found = tonumber(e.t) or 0, nil
  for _, x in ipairs(char.events) do
    if type(x) == "table" and x ~= e and x.id == e.id then
      local xt = tonumber(x.t) or 0
      if e.k == "qa" then
        if (x.k == "qt" or x.k == "qx") and xt >= t and not found then found = x end
      elseif x.k == "qa" and xt <= t then
        found = x
      end
    end
  end
  if not found then
    m.related = false
    return nil
  end
  local mid, x, y = Journey.Spot(found)
  m.related = { ev = found, where = found.s or found.z, t = tonumber(found.t), color = COLOR.quest,
    label = (found.k == "qa" and L["Quest accepted"]) or (found.k == "qt" and L["Quest done"]) or L["Quest abandoned"],
    spot = mid and ns.JourneyMap and ns.JourneyMap.Place(mid, x, y) or nil }
  return m.related
end

-- Tooltips ------------------------------------------------------------------------------------------------------------

-- A moment's lines: (its title and what happened), when, the other end of a quest, how many of a foe you've defeated.
local function momentLines(m, title)
  local e = type(m.ev) == "table" and m.ev or {}
  if title then
    local c = m.color or COLOR.other
    GameTooltip:AddLine(esc(m.title), c[1], c[2], c[3])
    if m.sub and m.sub ~= "" then T.Tip(esc(m.sub), "tipText") end
  end
  local t, lv = tonumber(e.t), tonumber(e.lv)
  if t then T.Tip(joined(date("%b %d %H:%M", t), lv and string.format(L["level %d"], lv)), "tipDim") end
  local rel = Journey.Related(m)
  if rel then T.Tip(esc(joined(rel.label, rel.where, rel.t and date("%b %d %H:%M", rel.t))), "tipDim") end
  local n = (e.k == "kill" or e.k == "boss") and e.n and char and type(char.kills) == "table" and tonumber(char.kills[e.n])
  if n and n > 1 then T.Tip(string.format(L["%d defeated"], n), "tipDim") end
end

-- What a click opens, by name, and how.
local function linkLines(key)
  local entry = key and ns.DB and ns.DB.entries[key]
  if not entry then return end
  GameTooltip:AddLine(T.code.link .. esc(entry.n) .. "|r")
  local how = ns.UI.CanQueue(key) and L["Click to open. Shift-click adds it to your playlist."]
    or (key:find("^npc:") and L["Click to open their story"]) or L["Click to open its story"]
  T.Tip(how, "tipDim", true)
end

-- A map marker's tooltip: one moment, or the moments it stands for (newest first).
function Journey.MomentTip(list, owner, canZoom)
  if not (list and list[1]) then return end
  GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
  if #list == 1 then
    momentLines(list[1], true)
    linkLines(list[1].key or list[1].place)
  else
    T.Tip(string.format(L["%d moments here"], #list), "gold")
    for i = 1, math.min(6, #list) do
      local m, c = list[i], list[i].color or COLOR.other
      local sub = m.sub and m.sub ~= "" and ("  " .. GREY .. esc(m.sub) .. "|r") or ""
      GameTooltip:AddLine(esc(m.title) .. sub, c[1], c[2], c[3])
    end
    if #list > 6 then T.Tip(string.format(L["%d more"], #list - 6), "tipDim") end
    if canZoom then T.Tip(L["Click to zoom in"], "tipDim") else linkLines(list[1].key or list[1].place) end
  end
  GameTooltip:Show()
end

local function rowTip(r)
  local key = r.key or r.place
  if not (r.moment or (key and ns.DB.entries[key])) then return end
  GameTooltip:SetOwner(r, "ANCHOR_LEFT")
  if r.moment then momentLines(r.moment, true) else GameTooltip:AddLine(esc(r.title or "")) end
  linkLines(key)
  GameTooltip:Show()
end

-- The card under the map ----------------------------------------------------------------------------------------------
-- The moment the map shows, in words: what happened, where and when, the other end of a quest, and a button with the
-- name of what it opens. Shown when there's room under the map.

local CARD_H = 96

function Journey.CreateCard(view, map)
  local c = CreateFrame("Frame", nil, view)
  c:SetPoint("TOPLEFT", map, "BOTTOMLEFT", 0, -10)
  c:SetPoint("TOPRIGHT", map, "BOTTOMRIGHT", 0, -10)
  c:SetHeight(CARD_H)
  local function text(font, y, muted)
    local fs = c:CreateFontString(nil, "OVERLAY", font)
    fs:SetPoint("TOPLEFT", 2, y)
    fs:SetPoint("RIGHT", -2, 0)
    fs:SetJustifyH("LEFT")
    if fs.SetWordWrap then fs:SetWordWrap(false) end
    return muted and T.Muted(fs) or fs
  end
  c.title = text("GameFontHighlight", 0)
  c.sub = text("GameFontHighlightSmall", -17, true)
  c.when = text("GameFontHighlightSmall", -31, true)
  c.rel = text("GameFontHighlightSmall", -45, true)
  local link = ns.UI.TextButton(c, 100, 22, T.font.body, T.color.chip)
  link.text:ClearAllPoints()
  link.text:SetPoint("LEFT", 8, 0)
  link.text:SetPoint("RIGHT", -20, 0)
  if link.text.SetWordWrap then link.text:SetWordWrap(false) end
  local arrow = link:CreateTexture(nil, "OVERLAY")
  arrow:SetTexture(T.ARROW)
  arrow:SetSize(10, 10)
  arrow:SetPoint("RIGHT", -7, 0)
  arrow:SetVertexColor(T.rgba(T.color.gold))
  link:SetScript("OnClick", function(self) Journey.OpenMoment(self.moment, IsShiftKeyDown and IsShiftKeyDown()) end)
  link:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    linkLines(self.key)
    GameTooltip:Show()
  end)
  link:SetScript("OnLeave", function() GameTooltip:Hide() end)
  c.link = link
  c:Hide()
  return c
end

function Journey.UpdateCard()
  local c = Journey.card
  if not (c and c:IsShown()) then return end
  local m = Journey.focus
  local e = m and type(m.ev) == "table" and m.ev or {}
  local col = m and m.color or COLOR.other
  c.title:SetText(m and esc(m.title) or "")
  c.title:SetTextColor(col[1], col[2], col[3], 1)
  c.sub:SetText(m and esc(m.sub or "") or "")
  local t, lv = tonumber(e.t), tonumber(e.lv)
  c.when:SetText(t and esc(joined(date("%b %d %H:%M", t), lv and string.format(L["level %d"], lv))) or "")
  local rel = m and Journey.Related(m)
  c.rel:SetText(rel and esc(joined(rel.label, rel.where, rel.t and date("%b %d %H:%M", rel.t))) or "")
  local key = m and (m.key or m.place)
  local entry = key and ns.DB and ns.DB.entries[key]
  c.link:ClearAllPoints()
  c.link:SetPoint("TOPLEFT", rel and c.rel or c.when, "BOTTOMLEFT", -2, -6)
  c.link:SetShown(entry ~= nil)
  if entry then
    c.link.text:SetText(T.code.link .. esc(entry.n) .. "|r")
    local w = math.floor((T.TextWidth(c.link.text) or 80) + 30)
    local room = tonumber(c:GetWidth())
    c.link:SetWidth(math.max(60, (room and room > 0) and math.min(w, room) or w))
    c.link.moment, c.link.key = m, key
  end
end

-- The large map ----------------------------------------------------------------------------------------------------------
-- A window over the panel (most of the screen) with the same map, its filters and Whole journey. Esc closes it and
-- only it: while it's open the panel leaves UISpecialFrames.

local function panelEscapes(on)
  local list = _G.UISpecialFrames
  if type(list) ~= "table" then return end
  for i = #list, 1, -1 do
    if list[i] == "LoreForeverFrame" then table.remove(list, i) end
  end
  if on then table.insert(list, "LoreForeverFrame") end
end

function Journey.CreateBigMap()
  if Journey.bigWin then return Journey.bigWin end
  local win = T.Window("LoreForeverJourneyMapWindow", UIParent, L["Your journey"])
  win:SetFrameStrata("DIALOG")
  if win.SetToplevel then win:SetToplevel(true) end
  win:EnableMouse(true)
  win:Hide()
  win.chips = chipRow(win, 16, -34, MAP_FILTERS)
  win.map = ns.JourneyMap.Create(win, mapOptions(true))
  win.map:SetPoint("TOPLEFT", 14, -62)
  win.map:Show()
  win.closeButton:SetScript("OnClick", function() win:Hide() end)
  win:SetScript("OnShow", function() panelEscapes(false) end)
  -- The panel goes back a frame later: Escape's CloseSpecialWindows is still walking UISpecialFrames when this
  -- runs, and would reach the panel added to its end and close it too.
  win:SetScript("OnHide", function()
    GameTooltip:Hide()
    C_Timer.After(0, function() if not win:IsShown() then panelEscapes(true) end end)
  end)
  if type(_G.UISpecialFrames) == "table" then table.insert(UISpecialFrames, "LoreForeverJourneyMapWindow") end
  Journey.bigWin = win
  return win
end

-- Open the large map on the moment the page's map shows.
function Journey.ShowBigMap()
  if not (Journey.focus and Journey.mapMoments and #Journey.mapMoments > 0) then return end
  local win = Journey.CreateBigMap()
  local sw, sh = tonumber(UIParent:GetWidth()) or 1024, tonumber(UIParent:GetHeight()) or 768
  local w = math.floor(math.max(400, math.min(sw - 80, (sh - 60 - 76) / ASPECT)))
  ns.JourneyMap.SetWidth(win.map, w)
  win:SetSize(w + 28, math.floor(w * ASPECT) + 76)
  win:ClearAllPoints()
  win:SetPoint("CENTER")
  local filter = Journey.Filter()
  for _, b in ipairs(win.chips) do T.SetTabSelected(b, b.filter == filter) end
  win:Show()
  ns.JourneyMap.Forget(win.map)
  Journey.FocusMap(Journey.focus, false)
end

function Journey.HideBigMap()
  if Journey.bigWin and Journey.bigWin:IsShown() then Journey.bigWin:Hide() end
end

function Journey.BigMapShown() return Journey.bigWin ~= nil and Journey.bigWin:IsShown() and true or false end

local function row(i)
  local r = Journey.rows[i]
  if r then return r end
  local UI = ns.UI
  r = UI.TextButton(Journey.content, 200, ROW_H - 2, "GameFontHighlight", ns.Theme.color.row)
  r.text:SetJustifyH("LEFT")
  if r.text.SetWordWrap then r.text:SetWordWrap(false) end
  r.sub = ns.Theme.Muted(r:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall"))
  r.sub:SetJustifyH("LEFT")
  if r.sub.SetWordWrap then r.sub:SetWordWrap(false) end
  r.dot = r:CreateTexture(nil, "OVERLAY")
  r.dot:SetTexture(T.HasTexture(T.DISC) and T.DISC or "Interface\\Buttons\\WHITE8X8")
  r.dot:SetSize(7, 7)
  r.dot:SetPoint("TOPLEFT", 5, -7)
  -- The row the map shows: a gold wash and bar. A row that opens something ends in a small gold arrow.
  r.mark = T.TargetMark(r)
  r.link = r:CreateTexture(nil, "OVERLAY")
  r.link:SetTexture(T.ARROW)
  r.link:SetSize(10, 10)
  r.link:SetPoint("RIGHT", -6, 0)
  r.link:SetVertexColor(T.rgba(T.color.gold))
  r:SetScript("OnClick", function(self)
    if self.quest then   -- Completed: the quest's text again, then its lore (LOR-40)
      Journey.HideBigMap()
      Journey.Hide()
      return Journey.OpenQuest(self.quest)
    end
    if self.chapter then
      Journey.Hide()
      return Journey.Open(self.chapter)
    end
    Journey.OpenMoment(self, IsShiftKeyDown and IsShiftKeyDown())
  end)
  -- Hovering a moment shows it on the map, and what it is and opens in a tooltip.
  r:SetScript("OnEnter", function(self)
    if self.moment and self.moment ~= Journey.focus then Journey.FocusMap(self.moment, true) end
    rowTip(self)
  end)
  r:SetScript("OnLeave", function() GameTooltip:Hide() end)
  Journey.rows[i] = r
  return r
end

-- Lay a row out as a heading (gold, or grey when quiet) or a moment (a dot in its filter's colour when it has one).
local function fill(r, it, width)
  local indent = it.kind and 16 or 6
  local opens = not it.head and (it.chapter or it.key or it.place or it.quest) and true or false
  local right = opens and -20 or -6
  r:SetWidth(width)
  r.text:ClearAllPoints()
  r.sub:ClearAllPoints()
  r.text:SetPoint("TOPLEFT", indent, it.head and -2 or -3)
  r.text:SetPoint("RIGHT", right, 0)
  r.sub:SetPoint("BOTTOMLEFT", indent, 3)
  r.sub:SetPoint("RIGHT", right, 0)
  r.link:SetShown(opens)
  T.ShowMark(r.mark, false)
  if it.head then
    r:SetHeight(HEAD_H - 2)
    r.text:SetText((it.quiet and ns.Theme.code.grey or GOLD) .. esc(it.head) .. "|r")
    r.sub:SetText("")
    if r.bg then r.bg:Hide() end
    r.dot:Hide()
    r:EnableMouse(false)
    return HEAD_H
  end
  r:SetHeight(ROW_H - 2)
  r.text:SetText(esc(it.title))
  local sub = {}
  if it.sub and it.sub ~= "" then sub[#sub + 1] = it.sub end
  if it.chapter and ns.Voice.HasAudio("journey:" .. it.chapter) then sub[#sub + 1] = L["narrated"] end
  r.sub:SetText(esc(table.concat(sub, "  ·  ")))
  if r.bg then r.bg:Show() end
  local c = it.kind and COLOR[it.kind]
  if c then r.dot:SetVertexColor(c[1], c[2], c[3], 1) end
  r.dot:SetShown(c and true or false)
  r:EnableMouse((opens or it.moment) and true or false)
  return ROW_H
end

function Journey.Refresh()
  if not Journey.content then return end
  local s = Journey.Stats()
  local function n(count, one, many) return string.format(count == 1 and one or many, count or 0) end
  local parts = { n(s.quests, L["%d quest done"], L["%d quests done"]), n(s.places, L["%d place"], L["%d places"]),
    n(s.people, L["%d person met"], L["%d people met"]), n(s.foes, L["%d foe"], L["%d foes"]) }
  if (s.bosses or 0) > 0 then parts[#parts + 1] = n(s.bosses, L["%d boss"], L["%d bosses"]) end
  Journey.statsLine:SetText(char and table.concat(parts, "  ·  ") or "")
  -- How far you walked too, in steps, when it fits on the line (the rest is in its tooltip).
  local nums = char and ns.JourneyRecord and ns.JourneyRecord.Numbers(char)
  if nums and nums.yards >= 1 then
    parts[#parts + 1] = Journey.StepsText(nums.yards)
    local line = Journey.statsLine
    line:SetText(table.concat(parts, "  ·  "))
    local width, room = T.TextWidth(line), line:GetWidth()
    if width and room and room > 0 and width > room then
      parts[#parts] = nil
      line:SetText(table.concat(parts, "  ·  "))
    end
  end
  local who = char and string.format(L["Level %d %s %s"], tonumber(char.level) or 0, char.raceName or "",
    char.className or "")
  Journey.whoLine:SetText(who and esc(joined(who, char.first and string.format(L["since %s"], date("%b %d", char.first))))
    or "")

  -- The filter chips; Chapters only when there are chapters.
  local hasChapters = #Journey.Chapters() > 0 or (Journey.Data() and type(Journey.Data().story) == "table")
  local filter = Journey.Filter()
  if filter == "chapters" and not hasChapters then filter = "all" end
  for _, b in ipairs(Journey.chips) do
    b:SetShown(b.filter ~= "chapters" or hasChapters)
    ns.Theme.SetTabSelected(b, b.filter == filter)
  end
  for _, b in ipairs(Journey.bigWin and Journey.bigWin.chips or {}) do T.SetTabSelected(b, b.filter == filter) end

  -- The map takes the right side when the page is wide enough (its height follows the art's shape).
  local pw, ph = pageSize()
  local mapW = 0
  if Journey.map and char and filter ~= "chapters" and filter ~= "done" and pw >= MAP_FROM then
    mapW = math.min(420, math.max(200, math.floor(pw * 0.5)))
    local room = ph - LIST_TOP - LIST_BOTTOM
    if mapW * 668 / 1002 > room then mapW = math.floor(room * 1002 / 668) end
  end
  local w = pw - 36 - (mapW > 0 and mapW + 10 or 0)
  Journey.scroll:SetPoint("BOTTOMRIGHT", -28 - (mapW > 0 and mapW + 10 or 0), LIST_BOTTOM)
  Journey.content:SetWidth(w)

  local search = Journey.search
  local searching = search and search:Active()
  local items = Journey.List(filter, searching and function(title, sub, zone)
    return ns.UI.SearchMatch(search.words, title, sub, zone)
  end or nil)
  local moments, y = {}, 0
  for i, it in ipairs(items) do
    local r = row(i)
    if it.ev then
      it.moment = { kind = it.kind, color = COLOR[it.kind] or COLOR.other, title = it.title, sub = it.sub,
        zoneName = it.ev.z, ev = it.ev, key = it.key, place = it.place }
      local m, sx, sy = Journey.Spot(it.ev)
      it.moment.spot = m and ns.JourneyMap and ns.JourneyMap.Place(m, sx, sy) or nil
      table.insert(moments, 1, it.moment)   -- the list is newest first; the map wants time order
    end
    r.chapter, r.key, r.place, r.moment, r.title, r.top = it.chapter, it.key, it.place, it.moment, it.title, y
    r.quest = it.quest
    r:ClearAllPoints()
    r:SetPoint("TOPLEFT", 0, -y)
    y = y + fill(r, it, w)
    r:Show()
  end
  for j = #items + 1, #Journey.rows do Journey.rows[j]:Hide() end
  Journey.content:SetHeight(math.max(y, 10))

  -- The map stays on the moment it showed (the page refreshes as you play), else starts on the newest moment that has
  -- a spot (else the newest), without drawing the road.
  local was = Journey.focus and Journey.focus.ev
  Journey.mapMoments, Journey.focus = moments, nil
  local small = Journey.map and mapW > 0 and #moments > 0
  if Journey.map then
    Journey.map:SetShown(small and true or false)
    if small then
      ns.JourneyMap.SetWidth(Journey.map, mapW)
      ns.JourneyMap.Forget(Journey.map)   -- draw the art again: you may have explored more
    end
  end
  if Journey.card then
    local below = ph - LIST_TOP - LIST_BOTTOM - math.floor(mapW * ASPECT) - 10
    Journey.card:SetShown((small and below >= CARD_H) and true or false)
  end
  -- The large map stays open with the new list (it closes when there's nothing to show: Chapters, or no moments).
  local big = Journey.bigWin and Journey.bigWin:IsShown()
  if big and (#moments == 0 or filter == "chapters") then
    Journey.HideBigMap()
    big = false
  elseif big then
    ns.JourneyMap.Forget(Journey.bigWin.map)
  end
  if small or big then
    local start
    for i = #moments, 1, -1 do
      if was and moments[i].ev == was then start = moments[i] break end
    end
    for i = #moments, 1, -1 do
      if start then break end
      if moments[i].spot then start = moments[i] end
    end
    start = start or moments[#moments]
    Journey.FocusMap(start, false)
  end
  markRows()
  Journey.UpdateCard()

  local on = Journey.On()
  Journey.empty:SetText(searching and ns.UI.NoMatchText(search) or on and L["Your journey starts here. Lore Forever keeps track of the places you discover, the people you meet, the foes you defeat and the quests you finish, and lists them here."]
    or L["Remember my journey is off. Turn it on in /lore options to keep track of the places you discover, the people you meet and the quests you finish."])
  Journey.empty:SetShown(#items == 0)
  Journey.scroll:SetShown(#items > 0)
  local data = _G.LoreForeverJourneyData
  local written = type(data) == "table" and (data.written or data.generated)   -- when the newest chapter was written
  local last = char and char.lastSync
  Journey.note:SetText((not on and #items > 0 and L["Remember my journey is off (/lore options)."])
    or (written and string.format(L["Last chapter written %s."], date("%b %d %H:%M", written)))
    or (last and string.format(L["Saved %s."], date("%b %d %H:%M", last)))
    or L["Saved when you log out, or now with Update my journey."])
  if Journey.webLine then Journey.webLine:Update(char ~= nil) end
end

-- Welcome back ------------------------------------------------------------------------------------------------------

-- Up to two names, then how many more: "Gryan Stoutmantle, Salma Saldean, 3 more".
local function names(list)
  local out = {}
  for i = 1, math.min(2, #list) do out[i] = esc(list[i]) end
  if #list > 2 then out[#out + 1] = string.format(L["%d more"], #list - 2) end
  return table.concat(out, ", ")
end

-- Your last play session in a few words, for the first chat after you log in: UI.ShowWelcome shows it in place of the
-- welcome card, once per session. { text, target } (target: a chapter you haven't read, which Listen plays), or nil:
-- Remember my journey off, nothing before this session, nothing happened in it, or already shown this session.
function Journey.Recap()
  if not (char and Journey.On() and loginAt) then return nil end
  local list = sessions(char)
  local now = list[#list]
  if not now or now.from < loginAt - 60 or char.recapped == now.from then return nil end
  -- Last time: the latest session before this one that has a moment in it (a quick login to check mail has none).
  local last
  for si = #list - 1, math.max(1, #list - SESSIONS), -1 do
    for i = list[si].first, list[si].last do
      if describe(char.events[i]) then last = list[si] break end
    end
    if last then break end
  end
  if not last then return nil end
  local quests, people, foes, seen = 0, {}, {}, {}
  for i = last.first, last.last do
    local e = char.events[i]
    if e.k == "qt" then
      quests = quests + 1
    elseif e.k == "npc" and e.n then
      people[#people + 1] = e.n
    elseif (e.k == "boss" or (e.k == "kill" and e.cls)) and e.n and not seen[e.n] then
      seen[e.n] = true
      foes[#foes + 1] = e.n
    end
  end
  char.recapped = now.from
  local route, levels = sessionFacts(char, last)
  local summary = joined(esc(route), quests > 0 and string.format(quests == 1 and L["%d quest done"]
    or L["%d quests done"], quests), #people > 0 and string.format(L["met %s"], names(people)),
    #foes > 0 and string.format(L["defeated %s"], names(foes)))
  local text = GOLD .. L["Welcome back"] .. "|r\n" .. GREY .. joined(string.format(L["Last time: %s"],
    dayText(last.from)), levels) .. "|r\n" .. WHITE .. summary .. "|r"
  local chs = Journey.Chapters()
  local newest = chs[#chs]
  local target
  if newest and char.lastRead ~= newest.id then
    text = text .. "\n\n" .. string.format(L["New chapter: %s"], GOLD .. esc(newest.title or L["Your journey"]) .. "|r")
    target = Journey.Target(newest.id)
  end
  return { text = text .. "\n" .. GREY .. L["Your whole journey: /lore journey"] .. "|r", target = target }
end

-- Recording -----------------------------------------------------------------------------------------------------------

-- The world map the player is on: 0 Eastern Kingdoms, 1 Kalimdor, or a dungeon's own. A change outside dungeons, with
-- no flight, hearth or portal before it, was a boat or zeppelin.
local function worldMap()
  if type(GetInstanceInfo) ~= "function" then return nil end
  local ok, _, _, _, _, _, _, _, id = pcall(GetInstanceInfo)
  return ok and id or nil
end

local route = {}   -- where the player was: place ("Zone|Subzone"), zone, map, inst
local pending      -- { how, t }: a hearth, teleport, portal or landing that explains the next move
local loaded       -- a loading screen since the last move that wasn't a login or reload
local flying       -- { from, to, t } on a flight path; places flown over aren't visits

function resetRoute()
  route, pending, loaded, flying, partyCache = {}, nil, nil, nil, nil
end

-- A hearth explains a move right after it, or after the loading screen it causes. A portal only explains a move
-- through a loading screen: the mage who opens one, or a party member who doesn't step in, goes nowhere.
local function pendingHow()
  if not pending then return nil end
  local age = time() - pending.t
  if pending.how == "portal" then return (loaded and age <= SLOW) and "portal" or nil end
  if age <= QUICK or (loaded and age <= SLOW) then return pending.how end
end

local function howHere(p, map)
  local how = pendingHow()
  if how then return how end
  if (p.instance and (not route.inst or route.zone ~= p.zone)) or (route.inst and not p.instance) then
    return "instance"
  end
  if try(UnitIsDeadOrGhost, "player") then return "corpse" end
  if map ~= nil and route.map ~= nil and map ~= route.map then
    if map == TRAM or route.map == TRAM then return "instance" end
    return "boat"   -- another continent with no flight, hearth or portal before it: a boat or zeppelin
  end
  if loaded then return "portal" end
  return "walk"
end

local takeOff, land
local function onPlace()
  if try(UnitOnTaxi, "player") then
    if not flying then takeOff() end
    return
  end
  if flying then return land() end   -- landed without PLAYER_CONTROL_GAINED
  local z, s, p = here()
  if not usable(z) then return end
  local key = z .. "|" .. (s or "")
  if key == route.place then return end
  local map = worldMap()
  local fresh = route.place == nil      -- just logged in or reloaded: no route to here
  local how = not fresh and howHere(p, map) or nil
  local entered = not fresh and p.instance and (not route.inst or route.zone ~= z)
  local first = not char.seen.place[key]
  if first then char.seen.place[key] = time() end
  if first or entered then
    add("zone", { z = z, s = s, from = route.zone, how = how, new = first or nil, inst = p.instance })
  end
  route.place, route.zone, route.map, route.inst = key, z, map, p.instance
  pending, loaded = nil, nil
end

local function onNPC()
  local name = try(UnitName, "npc")
  if not usable(name) or try(UnitIsPlayer, "npc") then return end
  if char.seen.npc[name] then return end
  char.seen.npc[name] = time()
  local z, s = here()
  add("npc", { n = name, z = z, s = s })
end

-- A short, stable hash of a text, as 8 hex digits (Lua 5.1 has no bit operations; this stays exact in doubles).
local function hash(text)
  local h = 5381
  for i = 1, #text do h = (h * 33 + text:byte(i)) % 4294967296 end
  return string.format("%04x%04x", math.floor(h / 65536), h % 65536)
end

-- Options › Keep the quest text you see (Capture.lua): off keeps no new game text.
local function keeping() return not ns.Capture or ns.Capture.On() end
local function room() return not ns.Capture or ns.Capture.Room("text") end

-- Gossip text is game text (lore sources): kept for every NPC, once per distinct text, the player's name taken out.
-- Capture.NoteGossip notes who the NPC is (its id) and who saw it, for sharing at /contribute.
local function onGossip()
  if not keeping() then return end
  local name = try(UnitName, "npc")
  if not usable(name) or try(UnitIsPlayer, "npc") then return end
  local G = _G.C_GossipInfo
  local text = (G and try(G.GetText)) or try(GetGossipText)
  if not usable(text) then return end
  text = scrub(text)
  local texts = LoreForeverDB.texts.gossip
  local h = hash(text)
  if texts[name] and texts[name][h] then return end
  if not room() then return end
  texts[name] = texts[name] or {}
  texts[name][h] = text
  if ns.Capture then pcall(ns.Capture.NoteGossip, name, h) end
end

local book   -- { title, key } for the text open now
local function onBookBegin()
  local title = try(ItemTextGetItem)
  book = usable(title) and { title = ns.Log.ScrubName(title) } or nil   -- a key: the name only, as <name>
end

local function onBookPage()
  if not book then return end
  -- Letters players wrote have a creator (known by now); they're private, not lore.
  if try(ItemTextGetCreator) then book = nil return end
  local text, page = try(ItemTextGetText), tonumber(try(ItemTextGetPage)) or 1
  if not usable(text) then return end
  text = scrub(text)
  local books = LoreForeverDB.texts.books
  if not book.key then
    -- Plaques and signs share titles ("Plaque"): a different text under a title already kept adds the zone.
    local key, have = book.title, books[book.title]
    -- The same words seen by another character read differently ($R for a Human, "Humans" for an Orc): Capture.SameText.
    local same = have and have[1] and (have[1] == text or (ns.Capture and ns.Capture.SameText(have[1], text)))
    if page == 1 and have and have[1] and not same then key = book.title .. " (" .. (here() or "?") .. ")" end
    book.key = key
    if char and Journey.On() and not char.seen.book[key] then
      char.seen.book[key] = time()
      local z, s = here()
      add("book", { n = book.title, z = z, s = s })
    end
  end
  if not keeping() or (not (books[book.key] and books[book.key][page]) and not room()) then return end
  books[book.key] = books[book.key] or {}
  books[book.key][page] = text
  if ns.Capture then pcall(ns.Capture.NoteBook, book.key, page) end
end

-- A boss you just beat: a chat link to its story, once a session (Options > Dungeon primer prompt). Groups ask "what's
-- his connection to VanCleef?" right after the kill, not before the pull.
local toldBoss = {}
local function sayBoss(name, key)
  if not key or toldBoss[key] or settings().dungeonPrimer == false then return end
  toldBoss[key] = true
  local e = ns.DB.entries[key]
  local listen = ns.Voice.HasAudio(key) and (" " .. ns.Hooks.Link(L["Listen"], "listen", key)) or ""
  say(string.format(L["%s defeated. %s"], (e and e.n) or name, ns.Hooks.Link(L["Their story"], "entry", key)) .. listen)
end

-- Bosses: a kill named in a dungeon's boss list (zones[*].b), or ENCOUNTER_END. The same boss reported both ways
-- within a couple of minutes is one kill.
local recentBoss = {}
local function bossKill(name, key)
  local lower, now = ns.Engine.lower(name), time()
  local function recent(id) return id and recentBoss[id] and now - recentBoss[id] < 120 end
  if recent(lower) or recent(key) then return end
  sayBoss(name, key)
  recentBoss[lower] = now
  if key then recentBoss[key] = now end
  if not char.seen.boss[name] then char.seen.boss[name] = now end
  local z, s = here()
  add("boss", { n = name, key = key, z = z, s = s, pt = party() })
end

local function bossKey(name)
  local idx = ns.DB and ns.DB.index and ns.DB.index.name
  local key = idx and idx[ns.Engine.lower(name)]
  return key and bossKeys[key] and key or nil
end

-- Kills come from the experience message ("Defias Trapper dies, you gain 120 experience."): the combat log is off
-- limits to add-ons on these clients. Mobs that give no experience aren't counted.
local xpPattern
local function killPattern()
  local fmt = _G.COMBATLOG_XPGAIN_FIRSTPERSON
  if type(fmt) ~= "string" then return false end
  fmt = fmt:gsub("%%%d%$", "%%")   -- "%1$s" in some languages
  local after = fmt:match("^%%s(.-)%%d")
  return after and ("^(.-)" .. after:gsub("%p", "%%%0")) or false
end
function Journey.KillName(msg)
  if xpPattern == nil then xpPattern = killPattern() end
  local name = xpPattern and type(msg) == "string" and msg:match(xpPattern)
  return usable(name) and name or nil
end

-- A foe's classification and creature type: from the target when it's the one that died, else from one of the same name
-- this session (an area spell's kills aren't targeted). This session only, so nothing grows per foe.
local foeKinds = {}
local function foe(name)
  local target = try(UnitName, "target")
  if ns.Context.Usable(target) and target == name then
    local cls, kind = try(UnitClassification, "target"), try(UnitCreatureType, "target")
    foeKinds[name] = { cls = usable(cls) and cls or nil, kind = usable(kind) and kind or nil }
  end
  local f = foeKinds[name]
  if f then return f.cls, f.kind end
end

local function onXP(msg)
  local name = Journey.KillName(msg)
  if not name then return end
  char.kills[name] = (char.kills[name] or 0) + 1
  local cls, kind = foe(name)
  local t = tally()
  if kind then t.kinds[kind] = (t.kinds[kind] or 0) + 1 end
  if NOTABLE[cls or ""] then t.ranks[cls] = (t.ranks[cls] or 0) + 1 end
  local key = bossKey(name)
  local first = not char.seen.mob[name]
  if first then char.seen.mob[name] = time() end
  if key then return bossKill(name, key) end
  if not first then return end
  local z, s = here()
  add("kill", { n = name, z = z, s = s, cls = NOTABLE[cls or ""] and cls or nil, pt = ELITE[cls or ""] and party() or nil })
end

-- Flights: PLAYER_CONTROL_LOST on a taxi starts one (TakeTaxiNode says where to), PLAYER_CONTROL_GAINED off it lands.
local taxiFrom, taxiTo
function Journey.OnTakeTaxi(index)
  taxiTo = try(TaxiNodeName, index)
  taxiFrom = nil
  for i = 1, (try(NumTaxiNodes) or 0) do
    if try(TaxiNodeGetType, i) == "CURRENT" then taxiFrom = try(TaxiNodeName, i) end
  end
end

function takeOff()
  if flying or not try(UnitOnTaxi, "player") then return end
  local z, s = here()
  flying = { from = taxiFrom or s or z, to = taxiTo, t = time() }
  taxiFrom, taxiTo = nil, nil
end

function land()
  if not flying or try(UnitOnTaxi, "player") then return end
  local z, s = here()
  add("taxi", { from = flying.from, to = flying.to or s or z, z = z, s = s })
  flying = nil
  pending = { how = "flight", t = time() }
  onPlace()
  pending = nil   -- landing where you've been before: the walk from there isn't a flight
end

local hearthName
local function spellName(id)
  local S = _G.C_Spell
  return (S and try(S.GetSpellName, id)) or try(GetSpellInfo, id)
end

local function onSpell(unit, _, spellID)
  local how
  if unit == "player" then
    if spellID == HEARTH or spellID == ASTRAL_RECALL then how = "hearth"
    elseif TELEPORTS[spellID] or PORTALS[spellID] then how = "portal"
    elseif type(spellID) == "number" then
      -- Forever may give the hearthstone its own spell: match it by name.
      if hearthName == nil then hearthName = spellName(HEARTH) or false end
      if hearthName and spellName(spellID) == hearthName then how = "hearth" end
    end
  elseif PORTALS[spellID] and type(unit) == "string" and unit:match("^party%d$") then
    how = "portal"   -- a party member's portal you may step into
  end
  if how then pending = { how = how, t = time() } end
end

-- Spells learned. A higher rank of one you know ("Rank 2") isn't a new spell, and neither is one your journey already
-- has (switching talent specs teaches talent spells again; older clients send LEARNED_SPELL_IN_TAB as well).
local learned   -- spell ID -> true: in this character's events, or learned this session
local function onLearned(id)
  if type(id) ~= "number" then return end
  if not learned then
    learned = {}
    for _, e in ipairs(char.events) do
      if e.k == "spell" and e.id then learned[e.id] = true end
    end
  end
  if learned[id] then return end
  local name = spellName(id)
  if not usable(name) then return end   -- not loaded yet: the next time it's sent
  learned[id] = true
  local S = _G.C_Spell
  local rank = (S and try(S.GetSpellSubtext, id)) or try(GetSpellSubtext, id)
  rank = type(rank) == "string" and tonumber(rank:match("%d+"))
  if rank and rank > 1 then return end
  local z, s = here()
  add("spell", { id = id, n = name, z = z, s = s })
end

local function onMount(id)
  id = type(id) == "number" and id or nil
  local MJ = _G.C_MountJournal
  local name = id and MJ and try(MJ.GetMountInfoByID, id)
  local z, s = here()
  add("mount", { id = id, n = usable(name) and name or nil, z = z, s = s })
end

-- Reputation and professions: what they were when last looked at this session (faction -> standing 1-8, profession
-- -> rank). The first look only takes note; a change after it is a moment.
local standing, factionIDs, skill = {}, {}, {}
local repQueued, skillQueued

local function factions()
  local out, R = {}, _G.C_Reputation
  local byIndex = R and R.GetFactionDataByIndex
  local n = (byIndex and try(R.GetNumFactions)) or try(GetNumFactions) or 0
  for i = 1, n do
    local name, st, header, withRep, id
    if byIndex then
      local d = try(byIndex, i)
      if type(d) == "table" then name, st, header, withRep, id = d.name, d.reaction, d.isHeader, d.isHeaderWithRep, d.factionID end
    elseif GetFactionInfo then
      local ok, a, _, c, _, _, _, _, _, h, _, r, _, _, f = pcall(GetFactionInfo, i)
      if ok then name, st, header, withRep, id = a, c, h, r, f end
    end
    if usable(name) and type(st) == "number" and (not header or withRep) then
      out[#out + 1] = { name = name, st = st, id = id }
    end
  end
  return out
end

local function onStanding(name, st)
  local was = standing[name]
  standing[name] = st
  if not was or was == st then return end
  local z, s = here()
  add("rep", { n = name, st = st, was = was, z = z, s = s })
end

local function scanRep()
  repQueued = nil
  local listed = {}
  for _, f in ipairs(factions()) do
    listed[f.name] = true
    if f.id then factionIDs[f.name] = f.id end
    onStanding(f.name, f.st)
  end
  -- Factions under a collapsed header aren't listed: ask for the ones seen before by ID.
  local R = _G.C_Reputation
  if not (R and R.GetFactionDataByID) then return end
  for name, id in pairs(factionIDs) do
    local d = not listed[name] and try(R.GetFactionDataByID, id)
    if type(d) == "table" and type(d.reaction) == "number" then onStanding(name, d.reaction) end
  end
end

local function scanSkills()
  skillQueued = nil
  for _, p in ipairs(ns.Context.Professions()) do
    local r = tonumber(p.rank)
    if usable(p.name) and r then
      local was, reached = skill[p.name], nil
      skill[p.name] = r
      for _, m in ipairs(was and MILESTONES or {}) do
        if was < m and r >= m then reached = m end   -- the highest one passed since the last look
      end
      if reached then
        local z, s = here()
        add("prof", { n = p.name, r = reached, z = z, s = s })
      end
    end
  end
end

function takeStock(fresh)
  if fresh then standing, skill = {}, {} end
  scanRep()
  scanSkills()
end

-- Loot: your own loot messages, matched with the game's strings so every language works. Others' loot never is.
local QUALITY = { ["9d9d9d"] = 0, ffffff = 1, ["1eff00"] = 2, ["0070dd"] = 3, a335ee = 4, ff8000 = 5, e6cc80 = 6 }
-- Items pushed into your bags first: in some languages a quest's reward may read the same as loot.
local SELF_LOOT = { { "LOOT_ITEM_PUSHED_SELF_MULTIPLE", "pushed" }, { "LOOT_ITEM_PUSHED_SELF", "pushed" },
  { "LOOT_ITEM_CREATED_SELF_MULTIPLE", "created" }, { "LOOT_ITEM_CREATED_SELF", "created" },
  { "LOOT_ITEM_SELF_MULTIPLE", "loot" }, { "LOOT_ITEM_SELF", "loot" } }
local lootPatterns
local rewards = {}   -- item ID -> quest ID: the rewards on the quest frames you've opened (QUEST_COMPLETE)
local turnIn         -- { id, at }: the quest turned in last, for a reward its frame didn't list

local function onQuestComplete()
  local qid = try(GetQuestID)
  if type(qid) ~= "number" or qid == 0 then return end
  for kind, count in pairs({ reward = try(GetNumQuestRewards) or 0, choice = try(GetNumQuestChoices) or 0 }) do
    for i = 1, tonumber(count) or 0 do
      local link = try(GetQuestItemLink, kind, i)
      local item = type(link) == "string" and tonumber(link:match("|Hitem:(%d+)"))
      if item then rewards[item] = qid end
    end
  end
end

-- The quest an item pushed into your bags at `at` (GetTime) is the reward of: one that offered it and was turned in
-- within 3 seconds of it (two handed in at once each keep their own), else the last one turned in that close.
local function rewardOf(item, at)
  local qid = rewards[item]
  local t = qid and turnedIn[qid]
  if type(t) == "number" and math.abs(t - at) <= 3 then return qid end
  if turnIn and math.abs(turnIn.at - at) <= 3 then return turnIn.id end
end

local function lootKind(msg)
  if not lootPatterns then
    lootPatterns = {}
    for _, p in ipairs(SELF_LOOT) do
      local fmt, kind = _G[p[1]], p[2]
      if type(fmt) == "string" then
        fmt = fmt:gsub("%%%d%$", "%%"):gsub("%%s", "\1"):gsub("%%d", "\2"):gsub("%p", "%%%0")
        lootPatterns[#lootPatterns + 1] = { "^" .. fmt:gsub("\1", ".+"):gsub("\2", "%%d+"), kind }
      end
    end
  end
  for _, p in ipairs(lootPatterns) do
    if msg:match(p[1]) then return p[2] end
  end
end

local function quality(msg, id)
  local q = tonumber(msg:match("|cnIQ(%d):"))   -- newer clients colour links by quality
  if q then return q end
  local I = _G.C_Item
  q = I and try(I.GetItemQualityByID, id)
  if type(q) == "number" then return q end
  local _, _, iq = try(GetItemInfo, id)
  if type(iq) == "number" then return iq end
  local colour = msg:match("|c%x%x(%x%x%x%x%x%x)|H")
  return colour and QUALITY[colour:lower()]
end

local function onLoot(msg)
  if not usable(msg) then return end
  local kind = lootKind(msg)
  local id = kind and tonumber(msg:match("|Hitem:(%d+)"))
  local name = id and msg:match("|h%[(.-)%]|h")
  if not usable(name) then return end
  local ql, at = quality(msg, id) or 0, try(GetTime) or 0
  local z, s = here()
  local function keep()
    local quest = kind == "pushed" and rewardOf(id, at) or nil
    if ql >= RARE or (quest and ql >= UNCOMMON) then
      add("loot", { n = name, id = id, ql = ql, qid = quest, z = z, s = s })
    end
  end
  -- A quest's rewards can arrive just before QUEST_TURNED_IN does.
  if kind == "pushed" then later(1, keep) else keep() end
end

-- The map trail ---------------------------------------------------------------------------------------------------
-- One timer for the whole session: every TRAIL_EVERY seconds, out of combat, outside dungeons and off flights, it
-- keeps where you are when you've moved TRAIL_MOVE of the map since the point before. Points are rounded to 0.001.

local sessionStart   -- this session's key in char.trail
local reloaded       -- this session began with a /reload (Update my journey): it carries on the trail it interrupted
local session        -- this session's points, once one is kept
local stride, ticks = 1, 0

local function round(v) return math.floor(v * 1000 + 0.5) / 1000 end

-- This session's points: a new list (dropping the oldest sessions past TRAIL_SESSIONS), or after a /reload the newest
-- one, if it moved in the last half hour.
local function trailSession(now)
  if session then return session end
  local T = type(char.trail) == "table" and char.trail or {}
  char.trail = T
  if reloaded then
    local newest
    for k in pairs(T) do
      if type(k) == "number" and (not newest or k > newest) then newest = k end
    end
    local pts = newest and T[newest]
    local last = type(pts) == "table" and pts[#pts]
    if type(last) == "table" and now - (tonumber(last.t) or 0) <= 1800 then session = pts end
  end
  if not session then
    session = type(T[sessionStart]) == "table" and T[sessionStart] or {}
    T[sessionStart] = session
    local keys = {}
    for k in pairs(T) do
      if k ~= sessionStart then keys[#keys + 1] = k end
    end
    table.sort(keys, function(a, b) return (tonumber(a) or 0) < (tonumber(b) or 0) end)
    for i = 1, #keys - (TRAIL_SESSIONS - 1) do T[keys[i]] = nil end
  end
  return session
end

-- Where you are on the map now, as { m, x, y }, or nil (no position, or a secret one).
local function look()
  local M = _G.C_Map
  local m = M and try(M.GetBestMapForUnit, "player")
  local pos = m and try(M.GetPlayerMapPosition, m, "player")
  local x, y
  if type(pos) == "table" then x, y = try(pos.GetXY, pos) end
  if not (ns.Context.Usable(x) and ns.Context.Usable(y)) or type(x) ~= "number" or type(y) ~= "number"
      or (x == 0 and y == 0) then
    return nil
  end
  return { m = m, x = x, y = y }
end

-- The walk (The tally): a look every WALK_EVERY seconds, fight or not, whatever the trail's stride; a flight, a
-- dungeon or no position starts it again from the next look.
local walkFrom
local function walkLook()
  local here_ = char and Journey.On() and not try(UnitOnTaxi, "player") and not try(IsInInstance) and look()
  if not here_ then walkFrom = nil return end
  here_.t = time()
  local yards = walkYards(walkFrom, here_)
  walkFrom = here_
  if yards then walked(tally().walk, try(GetRealZoneText), yards) end   -- in the zone you're in, by its name
end
local function walkTick() pcall(walkLook) end

local function sample()
  ticks = ticks + 1
  if ticks % stride ~= 0 or not (char and Journey.On()) then return end
  if try(UnitAffectingCombat, "player") or try(InCombatLockdown) or try(UnitOnTaxi, "player") or try(IsInInstance) then
    return
  end
  local p = look()
  if not p then return end
  local m, x, y = p.m, round(p.x), round(p.y)
  local now = time()
  local pts = session or (reloaded and trailSession(now))
  local last = pts and pts[#pts]
  if type(last) == "table" and last.m == m and math.sqrt((x - (last.x or 0)) ^ 2 + (y - (last.y or 0)) ^ 2) < TRAIL_MOVE then
    return
  end
  pts = trailSession(now)
  if #pts >= TRAIL_MAX then
    local n, half = #pts, math.ceil(#pts / 2)
    for i = 1, half do pts[i] = pts[2 * i - 1] end
    for i = half + 1, n do pts[i] = nil end
    stride = stride * 2
  end
  pts[#pts + 1] = { m = m, x = x, y = y, t = now }
end

local function trailTick()
  C_Timer.After(TRAIL_EVERY, trailTick)   -- first, so nothing in sample() can stop the trail
  pcall(sample)
  -- The walk's looks in between: one-off timers, so the trail's stays the only one that goes on.
  walkTick()
  for i = 1, math.floor(TRAIL_EVERY / WALK_EVERY + 0.5) - 1 do C_Timer.After(i * WALK_EVERY, walkTick) end
end

function startTrail()
  if sessionStart then return end
  sessionStart = time()
  C_Timer.After(TRAIL_EVERY, trailTick)
end

local handlers = {
  ZONE_CHANGED = onPlace, ZONE_CHANGED_INDOORS = onPlace, ZONE_CHANGED_NEW_AREA = onPlace,
  PLAYER_ENTERING_WORLD = function(isLogin, isReload)
    if isLogin or isReload then route, reloaded = {}, isReload and true or false else loaded = true end
    if try(UnitOnTaxi, "player") and not flying then takeOff() end
    later(1, function() onPlace(); loaded, pending = nil, nil end)
  end,
  PLAYER_CONTROL_LOST = function() later(1, takeOff) end,
  PLAYER_CONTROL_GAINED = function() later(0.5, land) end,
  UNIT_SPELLCAST_SUCCEEDED = onSpell,
  HEARTHSTONE_BOUND = function()
    local z, s = here()
    add("bind", { n = try(GetBindLocation) or s or z, z = z, s = s })
  end,
  QUEST_ACCEPTED = function(a, b)
    local id = b or a   -- classic passes (logIndex, questID), newer clients (questID)
    if type(id) ~= "number" then return end
    turnedIn[id] = nil   -- a repeatable quest taken again can be abandoned again
    later(0.5, function()
      rememberTitles()
      local z, s = here()
      add("qa", { id = id, q = questTitle(id), z = z, s = s })
    end)
  end,
  QUEST_TURNED_IN = function(id)
    if type(id) ~= "number" then return end
    turnIn = { id = id, at = try(GetTime) or 0 }
    turnedIn[id] = turnIn.at
    local z, s = here()
    add("qt", { id = id, q = questTitle(id), z = z, s = s, pt = party() })
    local done = false
    for _, q in ipairs(char.completed) do if q == id then done = true break end end
    if not done then char.completed[#char.completed + 1] = id end
  end,
  -- Removed from the log without being turned in (the turn-in comes in the same frame): abandoned.
  QUEST_REMOVED = function(id)
    if type(id) ~= "number" then return end
    local title = questTitle(id)
    local z, s = here()
    later(1, function()
      if not turnedIn[id] then add("qx", { id = id, q = title, z = z, s = s }) end
    end)
  end,
  QUEST_LOG_UPDATE = function()
    rememberTitles()
    if needCompleted then
      local ids = completedQuests()
      if #ids > 0 then
        if char.startUnsure then settle(char, ids) end
        char.completed, needCompleted = ids, nil
      else needCompleted = needCompleted > 1 and needCompleted - 1 or nil end
    end
  end,
  PLAYER_LEVEL_UP = function(lv)
    char.level = lv
    local z, s = here()
    add("lvl", { lv = lv, z = z, s = s })
  end,
  GOSSIP_SHOW = function() onNPC(); onGossip() end,
  QUEST_DETAIL = onNPC, QUEST_GREETING = onNPC, MERCHANT_SHOW = onNPC, TRAINER_SHOW = onNPC,
  CHAT_MSG_COMBAT_XP_GAIN = onXP,
  ENCOUNTER_END = function(_, name, _, _, success)
    if success == 1 or success == true then
      if usable(name) then bossKill(name, bossKey(name)) end
    end
  end,
  GROUP_ROSTER_UPDATE = function() partyCache = nil end,
  PLAYER_DEAD = function()
    local z, s = here()
    add("death", { z = z, s = s, pt = party() })
    local t = tally()
    t.deaths = (tonumber(t.deaths) or 0) + 1
  end,
  TIME_PLAYED_MSG = onPlayed,   -- when the player types /played (the add-on never asks: it would print in chat)
  ITEM_TEXT_BEGIN = onBookBegin,
  ITEM_TEXT_READY = onBookPage,
  PLAYER_LOGOUT = function()
    add("logout")
    countOnline()
  end,
  -- Reputation and skills change in bursts: look once, a second later.
  UPDATE_FACTION = function()
    if not repQueued then repQueued = true; later(1, scanRep) end
  end,
  SKILL_LINES_CHANGED = function()
    if not skillQueued then skillQueued = true; later(1, scanSkills) end
  end,
  NEW_MOUNT_ADDED = onMount,
  LEARNED_SPELL_IN_SKILL_LINE = onLearned,
  LEARNED_SPELL_IN_TAB = onLearned,   -- older clients' name for it (Forever has the one above)
  CHAT_MSG_LOOT = onLoot,
  QUEST_COMPLETE = onQuestComplete,   -- the rewards on offer, to tell whose reward an item is
  SCREENSHOT_SUCCEEDED = function()
    local z, s = here()
    add("shot", { z = z, s = s })
  end,
}
-- Game text for lore sources is kept whether or not the journey is (like quest text in Log.lua).
local ALWAYS = { GOSSIP_SHOW = onGossip, ITEM_TEXT_BEGIN = true, ITEM_TEXT_READY = true,
  -- With the journey off, a boss kill still links its story (nothing is recorded).
  ENCOUNTER_END = function(_, name, _, _, success)
    if (success == 1 or success == true) and usable(name) then sayBoss(name, bossKey(name)) end
  end }

local frame = CreateFrame("Frame")
for event in pairs(handlers) do
  pcall(frame.RegisterEvent, frame, event)
end
frame:SetScript("OnEvent", function(_, event, ...)
  if not (LoreForeverDB and LoreForeverDB.texts) then return end   -- before login
  if not (char and Journey.On()) then
    local h = ALWAYS[event]
    if h then pcall(h == true and handlers[event] or h, ...) end
    return
  end
  local h = handlers[event]
  if h then pcall(h, ...) end
end)
