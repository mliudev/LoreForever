-- Your chronicle's pages: which lore entries this character has found by playing (v2 "Your Chronicle", slice 1:
-- Finding; the design is the Lore Forever v2 page Mike approved on 10/23). Nothing here shows anything yet: the book,
-- the Found bookmark and the new-page moment read it in later slices, and Willo and the profile can read it now.
--
-- LoreForeverDB.collection = { v = 1, chars = { ["Name-Realm"] = {
--   filled = FILL,                                     the fill-in from what was already saved has run (Fill, below)
--   found = { [entry key] = "t;how;lv;place;quest" },   one short string per page, the first time it was found:
--     t      time() it was found (0: before the add-on knew, e.g. a quest done before install)
--     how    enter (a place), meet (targeted or talked to), quest (taken), done (finished before), loot (in your
--            bags), hover (an item's tooltip), past (from the journey or heard stories, at the fill-in)
--     lv     your level then ("" when unknown)
--     place  the subzone (else the zone) you stood in ("" when unknown)
--     quest  the quest you were on there, as its title (optional: left off, with its ";", when there was none, and
--            on everything found before it was recorded, so a record without it reads the same as ever)
--   new = { [entry key] = 1 },                     found as you play and not opened or heard since (the green "New"
--                                                    in Found); what the fill-in finds is your past, not new
--   q = { [item key] = quality } } } }              an item page's rarity (0 poor .. 5 legendary), as the game showed
--                                                    it when you found it (slice 6: Found colours its name)
--
-- What counts as finding, by kind (the design's table): entering a zone, city, dungeon or place; targeting or talking
-- to a person (a boss too: you target it to fight it); taking a quest; an item in your bags (looted, a reward, bought)
-- or under the mouse anywhere. Flying over a place isn't a visit. Pages are found whatever "Remember my journey" says,
-- as heard stories are kept (Voice.lua): they stay in this add-on's own saved data.
-- Nothing is loaded at login: the fill-in runs a few seconds later, a slice at a time.

local _, ns = ...
local Collection = {}
ns.Collection = Collection

local V = 1           -- the saved data's version
local FILL = 1        -- the fill-in's version: raise it to run it again for every character (it only ever adds)
local SLICE = 150     -- fill-in items per frame
local PLACE_KINDS = { zone = true, city = true, dungeon = true, subzone = true }

local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b, c = pcall(fn, ...)
  if ok then return a, b, c end
end
local function usable(v) return ns.Context.Usable(v) and type(v) == "string" and v ~= "" end
local function later(delay, fn) C_Timer.After(delay, function() pcall(fn) end) end
local function entries() return ns.DB and ns.DB.entries or {} end
local function lower(s) return ns.Engine.lower(s) end

local listeners = {}
-- fn(key, record) for every new page (the new-page moment, slice 4).
function Collection.OnFound(fn) listeners[#listeners + 1] = fn end

local store   -- this character's record, once logged in
function Collection.Store()
  if store then return store end
  if type(LoreForeverDB) ~= "table" or not (ns.Journey and ns.Journey.CharKey) then return nil end
  local c = LoreForeverDB.collection
  if type(c) ~= "table" or type(c.chars) ~= "table" then
    c = { v = V, chars = {} }
    LoreForeverDB.collection = c
  end
  c.v = V
  local who = ns.Journey.CharKey()
  if not usable(who) then return nil end
  local r = c.chars[who]
  if type(r) ~= "table" then r = {}; c.chars[who] = r end
  if type(r.found) ~= "table" then r.found = {} end
  if type(r.new) ~= "table" then r.new = {} end
  store = r
  return r
end

local function pack(t, how, lv, place, quest)
  local s = table.concat({ tostring(math.floor(tonumber(t) or 0)), how or "", lv and tostring(lv) or "",
    ((place or ""):gsub(";", ",")) }, ";")
  if type(quest) == "string" and quest ~= "" then s = s .. ";" .. (quest:gsub(";", ",")) end
  return s
end

-- The page's record, or nil: { t, how, lv, place, quest }. quest is nil for a page found before it was recorded.
function Collection.Found(key)
  local r = Collection.Store()
  local s = r and key and r.found[key]
  if type(s) ~= "string" then return nil end
  local t, how, lv, place, quest = s:match("^(%d*);([^;]*);([^;]*);([^;]*);?(.*)$")
  return { t = tonumber(t) or 0, how = how, lv = tonumber(lv), place = place ~= "" and place or nil,
    quest = quest ~= "" and quest or nil }
end

function Collection.IsFound(key)
  local r = Collection.Store()
  return (r and key and r.found[key] ~= nil) or false
end

local function here()
  local p = ns.Context.Place()
  return p.subzone or p.zone, p
end

-- The quest you're on where you stand, for the moment a page is found ("while on ..."): one in your log under this
-- zone's or subzone's heading, as its title; one you haven't finished before one you have, then the lowest id so it's
-- always the same. nil when there's none, and when the page is a quest you're taking right now (that is its moment).
local function questHere(how)
  local active = ns.Hooks and ns.Hooks.activeQuests
  if how == "quest" or type(active) ~= "table" then return nil end
  local p = ns.Context.Place()
  local best
  for id, q in pairs(active) do
    if type(q) == "table" and usable(q.title) and q.header and (q.header == p.zone or q.header == p.subzone) then
      if not best or (best.q.complete and not q.complete) or (not best.q.complete == not q.complete and id < best.id) then
        best = { id = id, q = q }
      end
    end
  end
  if not best then return nil end
  local k = ns.DB.index.quest and ns.DB.index.quest[best.id]
  local e = k and entries()[k]
  return (e and e.n) or best.q.title
end

-- Records `key` as found, the first time only. t, lv and place default to now, your level and where you stand, and
-- quest to the quest you're on there (the fill-in passes what it knows, and no quest: it can't know). Returns true
-- when the page is new.
function Collection.Find(key, how, t, lv, place, quest)
  local r = Collection.Store()
  if not (r and type(key) == "string" and entries()[key]) then return false end
  local live = t == nil
  if r.found[key] then
    -- Already found. The fill-in may know an earlier time (a page found live in the seconds before it ran).
    local had = Collection.Found(key)
    t = tonumber(t)
    if not live and had and t and t > 0 and (had.t == 0 or t < had.t) then r.found[key] = pack(t, how, lv, place) end
    return false
  end
  if live then
    t, lv, place = time(), try(UnitLevel, "player"), (here())
    quest = questHere(how)
  end
  r.found[key] = pack(t, how, lv, place, quest)
  -- New (and the new-page moment) only once the fill-in has run: before it, a page found at login may be one from
  -- before this version that the fill-in hasn't reached yet.
  if live and r.filled == FILL then
    r.new[key] = 1
    local rec = Collection.Found(key)
    for _, fn in ipairs(listeners) do pcall(fn, key, rec) end
  end
  return true
end

-- New pages: found as you play, until you open or hear them.
function Collection.IsNew(key)
  local r = Collection.Store()
  if not (r and key and r.new[key]) then return false end
  if ns.Voice.Heard(key) then r.new[key] = nil; return false end
  return true
end

-- The page was opened: it isn't new any more. Returns true when it was.
function Collection.Read(key)
  local r = Collection.Store()
  if not (r and key and r.new[key]) then return false end
  r.new[key] = nil
  return true
end

function Collection.NewKeys()
  local out, r = {}, Collection.Store()
  for key in pairs(r and r.new or {}) do
    if entries()[key] and Collection.IsNew(key) then out[#out + 1] = key end
  end
  return out
end

function Collection.NewCount() return #Collection.NewKeys() end

-- Entry keys ------------------------------------------------------------------------------------------------------

-- A person's or place's entry for a name, only when it's that kind (names are shared: "Moonbrook" is a place, never
-- a person).
local function keyOfKind(name, kinds)
  local idx = usable(name) and ns.DB.index and ns.DB.index.name
  local key = idx and idx[lower(name)]
  local e = key and entries()[key]
  return e and kinds[e.t] and key or nil
end
local PERSON = { npc = true }
local ITEM = { item = true }

-- The pages of the place you stand in: the zone (or city, dungeon) and the subzone.
local function placeKeys(zone, subzone)
  local out, engine = {}, ns.engine
  if not (engine and usable(zone)) then return out end
  local zk = engine:ZoneKey(zone)
  if zk and entries()["zone:" .. zk] then out[#out + 1] = "zone:" .. zk end
  out[#out + 1] = keyOfKind(zone, PLACE_KINDS)
  if usable(subzone) then
    out[#out + 1] = engine:SubzoneKey(subzone, zone)
    local area = ns.DB.index.area and ns.DB.index.area[lower(subzone)]   -- Northshire Abbey -> Northshire Valley
    if area and entries()[area] then out[#out + 1] = area end
  end
  return out
end

local function questKey(id) return type(id) == "number" and ns.DB.index.quest and ns.DB.index.quest[id] or nil end

-- Someone you're facing: your target or the quest/gossip window's NPC. Players and pets aren't lore.
local function personKey(unit)
  local name = try(UnitName, unit)
  if not usable(name) or try(UnitIsPlayer, unit) then return nil end
  if unit == "target" and try(UnitPlayerControlled, unit) then return nil end
  if not ns.engine then return nil end
  local key, how = ns.engine:KeyForName(name)
  local e = key and entries()[key]
  -- A person by name; a mob named after a lore topic ("Defias Trapper") finds the topic.
  if e and ((how == "exact" and e.t == "npc") or (how == "mob" and e.t == "topic")) then return key end
  return nil
end

function Collection.ItemKey(name) return keyOfKind(name, ITEM) end

-- Every item in the bags with a story of its own.
local function bagItemKeys()
  local out, CC = {}, _G.C_Container
  for bag = 0, (NUM_BAG_SLOTS or 4) do
    local slots = (CC and try(CC.GetContainerNumSlots, bag)) or try(GetContainerNumSlots, bag) or 0
    for slot = 1, slots do
      local link
      local info = CC and try(CC.GetContainerItemInfo, bag, slot)
      if type(info) == "table" then link = info.itemName or info.hyperlink
      else link = try(GetContainerItemLink, bag, slot) end
      local name = type(link) == "string" and (link:match("%[(.-)%]") or link) or nil
      local key = Collection.ItemKey(name)
      if key then
        out[#out + 1] = key
        local q = type(info) == "table" and info.quality or nil
        if q == nil and type(GetContainerItemInfo) == "function" then
          local ok, _, _, _, quality = pcall(GetContainerItemInfo, bag, slot)
          q = ok and quality or nil
        end
        Collection.NoteQuality(key, q)
      end
    end
  end
  return out
end

-- Finding as you play -----------------------------------------------------------------------------------------------

local function onPlace()
  if try(UnitOnTaxi, "player") then return end   -- flying over isn't a visit
  local p = ns.Context.Place()
  for _, key in ipairs(placeKeys(p.zone, p.subzone)) do Collection.Find(key, "enter") end
end

local function onPerson(unit) Collection.Find(personKey(unit), "meet") end

local bagQueued
local function onBags()
  if bagQueued then return end
  bagQueued = true
  later(1, function()
    bagQueued = nil
    for _, key in ipairs(bagItemKeys()) do Collection.Find(key, "loot") end
  end)
end

-- An item under the mouse (Hooks.lua's tooltip calls it, whatever "Notes on item tooltips" says), with its item ID
-- when the tooltip gives one (for its rarity).
function Collection.OnItemTooltip(name, id)
  local key = Collection.ItemKey(name)
  Collection.Find(key, "hover")
  if key and id then Collection.NoteQuality(key, select(3, try(GetItemInfo, id))) end
end

-- An item page's rarity, as the game shows it: kept the first time it's known, never fetched from anywhere else.
function Collection.NoteQuality(key, q)
  q = tonumber(q)
  local r = key and q and q >= 0 and q <= 7 and Collection.Store()
  if not r then return end
  if type(r.q) ~= "table" then r.q = {} end
  if r.q[key] == nil then r.q[key] = q end
end

function Collection.Quality(key)
  local r = Collection.Store()
  return r and type(r.q) == "table" and r.q[key] or nil
end

local MAX_ZONES = 40   -- zones the journey record lists

-- The chronicle in a few lines for the journey record (JourneyRecord.lua, then the profile site): each zone you've
-- found pages in as "name;found;total;heard", the most found first. Kept in the journey's record at logout (and
-- /reload), so the record the companion makes outside the game has it too.
function Collection.Summary()
  local Book = ns.Book
  if not (Book and Book.Index and Collection.Store()) then return nil end
  local rows = {}
  for ck in pairs(Book.Index().chapters) do
    if ck:sub(1, 1) ~= "*" then
      local n = Book.Count(ck)
      if n.found > 0 then rows[#rows + 1] = { name = Book.ChapterName(ck), n = n } end
    end
  end
  table.sort(rows, function(a, b)
    if a.n.found ~= b.n.found then return a.n.found > b.n.found end
    return a.name < b.name
  end)
  local zones = {}
  for i = 1, math.min(MAX_ZONES, #rows) do
    local r = rows[i]
    zones[i] = string.format("%s;%d;%d;%d", (r.name:gsub(";", ",")), r.n.found, r.n.total, r.n.heard)
  end
  return { v = 1, zones = zones }
end

local handlers = {
  PLAYER_LOGOUT = function()
    local c = ns.Journey and ns.Journey.Char()
    if c then c.chronicle = Collection.Summary() end
  end,
  ZONE_CHANGED = onPlace, ZONE_CHANGED_INDOORS = onPlace, ZONE_CHANGED_NEW_AREA = onPlace,
  PLAYER_ENTERING_WORLD = function() later(1, onPlace) end,
  PLAYER_CONTROL_GAINED = onPlace,   -- landing from a flight
  PLAYER_TARGET_CHANGED = function() onPerson("target") end,
  GOSSIP_SHOW = function() onPerson("npc") end, QUEST_DETAIL = function() onPerson("npc") end,
  QUEST_GREETING = function() onPerson("npc") end, MERCHANT_SHOW = function() onPerson("npc") end,
  TRAINER_SHOW = function() onPerson("npc") end,
  QUEST_ACCEPTED = function(a, b)
    local id = b or a   -- classic passes (logIndex, questID), newer clients (questID)
    Collection.Find(questKey(id), "quest")
  end,
  BAG_UPDATE_DELAYED = onBags,
}

-- The fill-in -------------------------------------------------------------------------------------------------------
-- What the add-on already knew becomes found, once per character (FILL): the journey's moments (oldest first, so
-- each page keeps its first time and place), the places, people, bosses and books it saw, every quest the server
-- says is done (with the people who give and take it), quests in the log, stories already heard, and the bags.

local function fillList()
  local items = {}   -- { key, how, t, lv, place }
  local function add(key, how, t, lv, place)
    if key then items[#items + 1] = { key, how, t or 0, lv, place } end
  end
  local j = ns.Context.Journey and ns.Context.Journey()
  if type(j) == "table" then
    for _, e in ipairs(type(j.events) == "table" and j.events or {}) do
      if type(e) == "table" then
        local place = usable(e.s) and e.s or (usable(e.z) and e.z or nil)
        if e.k == "zone" or e.k == "login" then
          for _, k in ipairs(placeKeys(e.z, e.s)) do add(k, "past", e.t, e.lv, place) end
        elseif e.k == "npc" or e.k == "boss" or (e.k == "kill" and e.cls) or e.k == "seen" then
          add(keyOfKind(e.n, PERSON), "past", e.t, e.lv, place)
        elseif e.k == "qa" or e.k == "qt" then
          add(questKey(e.id), "past", e.t, e.lv, place)
        elseif e.k == "loot" or e.k == "book" then
          add(Collection.ItemKey(e.n), "past", e.t, e.lv, place)
          if e.ql then Collection.NoteQuality(Collection.ItemKey(e.n), e.ql) end
        end
      end
    end
    local seen = type(j.seen) == "table" and j.seen or {}
    for p, t in pairs(type(seen.place) == "table" and seen.place or {}) do
      local z, s = tostring(p):match("^(.-)|(.*)$")
      for _, k in ipairs(placeKeys(z, s)) do add(k, "past", t, nil, usable(s) and s or z) end
    end
    for _, kind in ipairs({ "npc", "boss", "rare", "mob" }) do
      for name, t in pairs(type(seen[kind]) == "table" and seen[kind] or {}) do add(keyOfKind(name, PERSON), "past", t) end
    end
    for name, t in pairs(type(seen.book) == "table" and seen.book or {}) do add(Collection.ItemKey(name), "past", t) end
  end
  -- Quests done, from the journey's copy of the server's list, else the server itself.
  local done = type(j) == "table" and type(j.completed) == "table" and j.completed or nil
  if not done then
    done = {}
    local list = _G.C_QuestLog and try(C_QuestLog.GetAllCompletedQuestIDs)
    if type(list) == "table" and #list > 0 then done = list
    else
      local map = try(GetQuestsCompleted)
      for id, yes in pairs(type(map) == "table" and map or {}) do
        if yes then done[#done + 1] = id end
      end
    end
  end
  for _, id in ipairs(done) do
    local key = questKey(id)
    local m = key and entries()[key].m
    add(key, "done")
    if type(m) == "table" then
      add(keyOfKind(m.start, PERSON), "done")
      add(keyOfKind(m["end"], PERSON), "done")
    end
  end
  for _, q in ipairs(try(ns.Context.Quests) or {}) do add(questKey(q.id), "quest") end
  -- Stories heard (a clip id is its entry's key, with #faqN or #sectionN for a part of it).
  local heard = type(LoreForeverDB.heard) == "table" and LoreForeverDB.heard[ns.Journey.CharKey()]
  for id, t in pairs(type(heard) == "table" and heard or {}) do
    if type(id) == "string" then add(id:match("^(.-)#") or id, "past", type(t) == "number" and t or 0) end
  end
  for _, k in ipairs(bagItemKeys()) do add(k, "loot") end
  return items
end

function Collection.Fill(done)
  local r = Collection.Store()
  if not r or r.filled == FILL then if done then done() end return end
  local ok, items = pcall(fillList)
  if not ok then items = {} end
  local i = 1
  local function step()
    local last = math.min(i + SLICE - 1, #items)
    for n = i, last do
      local it = items[n]
      Collection.Find(it[1], it[2], it[3], it[4], it[5])
    end
    i = last + 1
    if i <= #items then
      C_Timer.After(0, function() pcall(step) end)
    else
      r.filled = FILL
      if done then pcall(done) end
    end
  end
  step()
end

-- Counts, for /lore found (and the Found bookmark later): pages found per kind.
local KINDS = { zone = "places", city = "places", dungeon = "places", subzone = "places", npc = "people",
  item = "items", quest = "quests", topic = "topics" }
function Collection.Counts()
  local found, total = { places = 0, people = 0, items = 0, quests = 0, topics = 0 }, 0
  local r = Collection.Store()
  for key in pairs(r and r.found or {}) do
    local e = entries()[key]
    local k = e and KINDS[e.t]
    if k then found[k] = found[k] + 1; total = total + 1 end
  end
  return total, found
end

local frame
function Collection.Init()
  store = nil
  if not Collection.Store() then return end
  if not frame then
    frame = CreateFrame("Frame")
    for event in pairs(handlers) do pcall(frame.RegisterEvent, frame, event) end
    frame:SetScript("OnEvent", function(_, event, ...)
      if not store then return end
      local h = handlers[event]
      if h then pcall(h, ...) end
    end)
  end
  later(3, function() Collection.Fill() end)
end
