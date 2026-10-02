-- Your journey: what this character has done, for the Journey tab, answers and narrated chapters.
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
--   events = { { k = kind, t = time, lv = level, ... }, ... },   at most MAX_EVENTS
--   trail = { [sessionStart] = { { m = mapID, x = 0.123, y = 0.456, t = t }, ... } } } } }   the last TRAIL_SESSIONS
-- LoreForeverDB.texts = { gossip = { [npcName] = { [hash] = text } }, books = { [title] = { [page] = text } } }
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
-- The player's name never goes into stored text ("<name>" instead), and other players' names are never stored.
-- The combat log is off limits: registering COMBAT_LOG_EVENT_UNFILTERED shows the player a "blocked" popup.

local _, ns = ...
local Journey = {}
ns.Journey = Journey
local L = ns.L

local MAX_EVENTS = 4000          -- per character; the companion keeps the full history
local TRIM = 500                 -- dropped from the oldest end when the list is full
local QUICK, SLOW = 10, 120      -- seconds a hearth or portal still explains the next move (SLOW: after a loading screen)
local AUDIO_DIR = "Interface\\AddOns\\LoreForever_Journey\\Audio\\"
local GOLD, GREY, WHITE = "|cffffd100", "|cff9d9d9d", "|cffffffff"
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
local MILESTONES = { 75, 150, 225, 300 }
local RARE, UNCOMMON = 3, 2      -- item quality: loot from rare up, quest rewards from uncommon up

local function say(msg) DEFAULT_CHAT_FRAME:AddMessage("|cffffd100Lore Forever:|r " .. msg) end
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
local needCompleted  -- the server's completed-quest list was empty at login: tries left to fetch it again
local resetRoute     -- forget where the player was (Recording, below)
local startTrail     -- start the map trail's timer (The map trail, below)
local takeStock      -- note standings and profession ranks, to see them change (Recording, below)
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
local function add(kind, fields)
  if not (char and Journey.On()) then return nil end
  local e = fields or {}
  e.k, e.t = kind, time()
  e.lv = e.lv or try(UnitLevel, "player")
  char.events[#char.events + 1] = e
  trim(char)
  -- Keep an open Journey tab current, at most once a second.
  if Journey.content and ns.UI.tab == "journey" and not refreshQueued then
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
  for _, z in pairs(ns.DB and ns.DB.zones or {}) do
    for _, k in ipairs(z.b or {}) do bossKeys[k] = true end
  end
  if Journey.On() then
    open()
    rememberTitles()
    local z, s = here()
    add("login", { z = z, s = s })
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

-- Counts for the Journey tab.
function Journey.Stats()
  if not char then return {} end
  local function count(t) local n = 0 for _ in pairs(t or {}) do n = n + 1 end return n end
  local s = char.seen
  return { quests = #(char.completed or {}), places = count(s.place), people = count(s.npc), foes = count(s.mob),
    bosses = count(s.boss), level = char.level }
end

-- The Journey tab ----------------------------------------------------------------------------------------------------

local ROW_H, HEAD_H, MOMENTS, FOES = 34, 22, 20, 5
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

-- The lore entry a moment is about, if the add-on has one.
local function loreKey(e)
  local db, eng = ns.DB, ns.engine
  if not (db and eng) then return nil end
  if (e.k == "qt" or e.k == "qx") and e.id then return db.index.quest[e.id] end
  if e.k == "boss" and e.key then return e.key end
  if (e.k == "npc" or e.k == "kill" or e.k == "boss") and e.n then
    local key, how = eng:KeyForName(e.n)
    return how == "exact" and key or nil
  end
  if e.k == "zone" then
    local sub = e.s and db.index.name[ns.Engine.lower(e.s)]
    if sub then return sub end
    local zk = eng:ZoneKey(e.z)
    return zk and ("zone:" .. zk) or nil
  end
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

-- What the tab lists, top to bottom: { head = "..." } or { title, sub, chapter = id, key = lore key }.
function Journey.Items()
  local items = {}
  local mine = Journey.Data()
  local chs = Journey.Chapters()
  local story = mine and type(mine.story) == "table" and mine.story
  if story or #chs > 0 then
    items[#items + 1] = { head = L["Chapters"] }
    if story then items[#items + 1] = { chapter = "story", title = story.title or L["Your story so far"],
      sub = L["Your story so far"] } end
    for i = #chs, 1, -1 do
      local ch = chs[i]
      items[#items + 1] = { chapter = ch.id, title = ch.title or L["Your journey"], sub = dateRange(ch) }
    end
  end
  if not char then return items end
  local moments = {}
  for i = #char.events, 1, -1 do
    local e = char.events[i]
    local title, sub = describe(e)
    if title then moments[#moments + 1] = { title = title, sub = sub, key = loreKey(e) } end
    if #moments >= MOMENTS then break end
  end
  if #moments > 0 then
    items[#items + 1] = { head = L["Recent moments"] }
    for _, m in ipairs(moments) do items[#items + 1] = m end
  end
  local bosses = {}
  for name, t in pairs(char.seen.boss or {}) do bosses[#bosses + 1] = { name = name, t = t } end
  table.sort(bosses, function(a, b) return a.t > b.t end)
  if #bosses > 0 then
    items[#items + 1] = { head = L["Bosses defeated"] }
    for _, b in ipairs(bosses) do
      items[#items + 1] = { title = b.name, sub = date("%b %d", b.t), key = loreKey({ k = "boss", n = b.name }) }
    end
  end
  local foes = {}
  for name, n in pairs(char.kills or {}) do foes[#foes + 1] = { name = name, n = n } end
  table.sort(foes, function(a, b) if a.n ~= b.n then return a.n > b.n end return a.name < b.name end)
  if #foes > 0 then
    items[#items + 1] = { head = L["Most fought"] }
    for i = 1, math.min(FOES, #foes) do
      local f = foes[i]
      items[#items + 1] = { title = f.name, sub = string.format(L["%d defeated"], f.n),
        key = loreKey({ k = "kill", n = f.name }) }
    end
  end
  return items
end

function Journey.CreateView(view)
  local UI = ns.UI
  local W = UI.SIDE_W
  local head = UI.Header(view, L["Your journey"])
  head:SetPoint("TOPLEFT", 16, -96)
  local stats = view:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  stats:SetPoint("TOPLEFT", head, "BOTTOMLEFT", 0, -9)
  stats:SetWidth(W - 28)
  stats:SetJustifyH("LEFT")
  Journey.statsLine = stats

  local note = view:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  note:SetPoint("BOTTOMLEFT", 16, 16)
  note:SetWidth(W - 32)
  note:SetJustifyH("LEFT")
  Journey.note = note

  local sync = CreateFrame("Button", "LoreForeverJourneySync", view, "UIPanelButtonTemplate")
  sync:SetSize(W - 32, 24)
  sync:SetPoint("BOTTOMLEFT", 16, 36)
  sync:SetText(L["Update my journey"])
  sync:SetScript("OnClick", function() Journey.AskSync() end)
  sync:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Update my journey"])
    GameTooltip:AddLine(L["Saves your journey now. The game only saves add-on data when you log out or reload."], 1, 1, 1, true)
    GameTooltip:Show()
  end)
  sync:SetScript("OnLeave", function() GameTooltip:Hide() end)
  Journey.syncButton = sync

  local sf = CreateFrame("ScrollFrame", "LoreForeverJourneyScroll", view, "UIPanelScrollFrameTemplate")
  sf:SetPoint("TOPLEFT", 10, -146)
  sf:SetPoint("BOTTOMRIGHT", view, "BOTTOMLEFT", W - 26, 66)
  local content = CreateFrame("Frame", nil, sf)
  content:SetSize(W - 40, 100)
  sf:SetScrollChild(content)
  Journey.scroll, Journey.content, Journey.rows = sf, content, {}

  local empty = view:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  empty:SetPoint("TOPLEFT", 16, -152)
  empty:SetWidth(W - 32)
  empty:SetJustifyH("LEFT")
  Journey.empty = empty

  -- "Copy my journey record" (JourneyRecord.lua) sits just above Update my journey; the list ends above both.
  if ns.JourneyRecord then
    ns.JourneyRecord.Attach(view, sync, W - 32)
    sf:SetPoint("BOTTOMRIGHT", view, "BOTTOMLEFT", W - 26, 94)
  end
end

local function row(i)
  local r = Journey.rows[i]
  if r then return r end
  local UI = ns.UI
  r = UI.TextButton(Journey.content, UI.SIDE_W - 44, ROW_H - 2, "GameFontHighlight", { 0.2, 0.16, 0.08, 0.45 })
  r.text:ClearAllPoints()
  r.text:SetPoint("TOPLEFT", 6, -3)
  r.text:SetPoint("RIGHT", -6, 0)
  r.text:SetJustifyH("LEFT")
  if r.text.SetWordWrap then r.text:SetWordWrap(false) end
  r.sub = r:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  r.sub:SetPoint("BOTTOMLEFT", 6, 3)
  r.sub:SetPoint("RIGHT", -6, 0)
  r.sub:SetJustifyH("LEFT")
  if r.sub.SetWordWrap then r.sub:SetWordWrap(false) end
  r:SetScript("OnClick", function(self)
    if self.chapter then Journey.Open(self.chapter)
    elseif self.key then ns.UI.Open(self.key, nil, "journey") end
  end)
  Journey.rows[i] = r
  return r
end

function Journey.Refresh()
  if not Journey.content then return end
  local s = Journey.Stats()
  local function n(count, one, many) return string.format(count == 1 and one or many, count or 0) end
  local parts = { n(s.quests, L["%d quest done"], L["%d quests done"]), n(s.places, L["%d place"], L["%d places"]),
    n(s.people, L["%d person met"], L["%d people met"]), n(s.foes, L["%d foe"], L["%d foes"]) }
  if (s.bosses or 0) > 0 then parts[#parts + 1] = n(s.bosses, L["%d boss"], L["%d bosses"]) end
  Journey.statsLine:SetText(char and table.concat(parts, "  ·  ") or "")
  local items = Journey.Items()
  local y = 0
  for i, it in ipairs(items) do
    local r = row(i)
    r.chapter, r.key = it.chapter, it.key
    r:ClearAllPoints()
    r:SetPoint("TOPLEFT", 0, -y)
    if it.head then
      r:SetHeight(HEAD_H - 2)
      r.text:SetText(GOLD .. esc(it.head) .. "|r")
      r.sub:SetText("")
      if r.bg then r.bg:Hide() end
      r:EnableMouse(false)
      y = y + HEAD_H
    else
      r:SetHeight(ROW_H - 2)
      r.text:SetText(esc(it.title))
      local sub = {}
      if it.sub and it.sub ~= "" then sub[#sub + 1] = it.sub end
      if it.chapter and ns.Voice.HasAudio("journey:" .. it.chapter) then sub[#sub + 1] = L["narrated"] end
      r.sub:SetText(esc(table.concat(sub, "  ·  ")))
      if r.bg then r.bg:Show() end
      r:EnableMouse((it.chapter or it.key) and true or false)
      y = y + ROW_H
    end
    r:Show()
  end
  for i = #items + 1, #Journey.rows do Journey.rows[i]:Hide() end
  Journey.content:SetHeight(math.max(y, 10))
  local on = Journey.On()
  Journey.empty:SetText(on and L["Your journey starts here. Lore Forever keeps track of the places you discover, the people you meet, the foes you defeat and the quests you finish, and lists them here."]
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

-- Gossip text is game text (lore sources): kept for every NPC, once per distinct text, the player's name taken out.
local function onGossip()
  local name = try(UnitName, "npc")
  if not usable(name) or try(UnitIsPlayer, "npc") then return end
  local G = _G.C_GossipInfo
  local text = (G and try(G.GetText)) or try(GetGossipText)
  if not usable(text) then return end
  text = scrub(text)
  local texts = LoreForeverDB.texts.gossip
  texts[name] = texts[name] or {}
  texts[name][hash(text)] = text
end

local book   -- { title, key } for the text open now
local function onBookBegin()
  local title = try(ItemTextGetItem)
  book = usable(title) and { title = scrub(title) } or nil
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
    if page == 1 and have and have[1] and have[1] ~= text then key = book.title .. " (" .. (here() or "?") .. ")" end
    book.key = key
    if char and Journey.On() and not char.seen.book[key] then
      char.seen.book[key] = time()
      local z, s = here()
      add("book", { n = book.title, z = z, s = s })
    end
  end
  books[book.key] = books[book.key] or {}
  books[book.key][page] = text
end

-- Bosses: a kill named in a dungeon's boss list (zones[*].b), or ENCOUNTER_END. The same boss reported both ways
-- within a couple of minutes is one kill.
local recentBoss = {}
local function bossKill(name, key)
  local lower, now = ns.Engine.lower(name), time()
  local function recent(id) return id and recentBoss[id] and now - recentBoss[id] < 120 end
  if recent(lower) or recent(key) then return end
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

local function onXP(msg)
  local name = Journey.KillName(msg)
  if not name then return end
  char.kills[name] = (char.kills[name] or 0) + 1
  local key = bossKey(name)
  local first = not char.seen.mob[name]
  if first then char.seen.mob[name] = time() end
  if key then return bossKill(name, key) end
  if not first then return end
  local z, s = here()
  local cls = try(UnitName, "target") == name and try(UnitClassification, "target") or nil
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

local function sample()
  ticks = ticks + 1
  if ticks % stride ~= 0 or not (char and Journey.On()) then return end
  if try(UnitAffectingCombat, "player") or try(InCombatLockdown) or try(UnitOnTaxi, "player") or try(IsInInstance) then
    return
  end
  local M = _G.C_Map
  local m = M and try(M.GetBestMapForUnit, "player")
  local pos = m and try(M.GetPlayerMapPosition, m, "player")
  local x, y
  if type(pos) == "table" then x, y = try(pos.GetXY, pos) end
  if type(x) ~= "number" or type(y) ~= "number" or (x == 0 and y == 0) then return end
  x, y = round(x), round(y)
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
  end,
  ITEM_TEXT_BEGIN = onBookBegin,
  ITEM_TEXT_READY = onBookPage,
  PLAYER_LOGOUT = function() add("logout") end,
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
local ALWAYS = { GOSSIP_SHOW = onGossip, ITEM_TEXT_BEGIN = true, ITEM_TEXT_READY = true }

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
