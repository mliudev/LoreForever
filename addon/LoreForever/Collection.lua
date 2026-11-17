-- Your chronicle's pages: which lore entries this character has found by playing (v2 "Your Chronicle", slice 1:
-- Finding; the design is the Lore Forever v2 page Mike approved on 10/23). Nothing here shows anything yet: the book,
-- the Found bookmark and the new-page moment read it in later slices, and Willo and the profile can read it now.
--
-- LoreForeverDB.collection = { v = 1, chars = { ["Name-Realm"] = {
--   filled = FILL,                                     the fill-in from what was already saved has run (Fill, below)
--   found = { [entry key] = "t;how;lv;place;quest" },   one short string per page, the first time it was found:
--     t      time() it was found (0: before the add-on knew, e.g. a quest done before install)
--     how    enter (a place), meet (targeted or talked to), quest (taken), done (finished before), loot (in your
--            bags), hover (an item's tooltip), past (from the journey, at the fill-in; before version 3, also from
--            stories heard)
--     lv     your level then ("" when unknown)
--     place  the subzone (else the zone) you stood in ("" when unknown)
--     quest  the quest you were on there, as its title (optional: left off, with its ";", when there was none, and
--            on everything found before it was recorded, so a record without it reads the same as ever)
--   new = { [entry key] = 1 },                     found as you play and not opened or heard since (the green "New"
--                                                    in Found); what the fill-in finds is your past, not new
--   q = { [item key] = quality },                  an item page's rarity (0 poor .. 5 legendary), as the game showed
--                                                    it when you found it (slice 6: Found colours its name)
--   unheard = { [entry key] = found string },        pages fill-in version 3 took back (found only from a story heard,
--                                                    LOR-1501), kept as they were; nothing reads them
--   undone = { [entry key] = found string } } } }    pages fill-ins 4 and 5 took back (another zone's copy of a quest
--                                                    you did, or another choice of a quest you may do only one of, and
--                                                    its people, LOR-1501), kept as they were; unread too
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
local FILL = 5        -- the fill-in's version: raise it to run it again for every character (it adds, and takes back
                      -- only what unheard and undone say)
                      -- 2: places, people and items by the game's ids and own names, for non-English games (11/13)
                      -- 3: stories heard aren't finds (LOR-1501): 2 had made Elwynn Forest found for a Tirisfal
                      --    character who had only heard of it
                      -- 4: a quest's copies in other zones the server lists as done aren't finds, nor their people
                      --    (LOR-1501): Tirisfal's "The Adventurer" had made Elwynn's and Marshal McBride found
                      -- 5: nor the other choices of a quest you may do only one of (m.xg), and a group done before the
                      --    add-on counts the ones in zones you've been to (LOR-1501, 11/16): a Forsaken warrior had the
                      --    orcs' "Path of Defense" and Uzzek found in The Barrens
local SLICE = 150     -- fill-in items per frame
local PLACE_KINDS = { zone = true, city = true, dungeon = true, subzone = true }

local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b, c = pcall(fn, ...)
  if ok then return a, b, c end
end
local function usable(v) return ns.Context.Usable(v) and type(v) == "string" and v ~= "" end
local function later(delay, fn) C_Timer.After(delay, function() ns.Guard(fn) end) end
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
  if not (r and type(key) == "string" and entries()[key] and not entries()[key].hide) then return false end
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
  -- A page the counts leave out until found (e.nf; a quest for only some classes or races, m.cl and m.ra) joins its
  -- chapter now, before the new-page slip reads the counts.
  local e = entries()[key]
  if (e.nf or (e.m and (e.m.cl or e.m.ra))) and ns.Book and ns.Book.Forget then ns.Book.Forget() end
  -- New (and the new-page moment) only once the fill-in has run: before it, a page found at login may be one from
  -- before this version that the fill-in hasn't reached yet.
  if live and r.filled == FILL then
    r.new[key] = 1
    local rec = Collection.Found(key)
    for _, fn in ipairs(listeners) do ns.Guard(fn, key, rec) end
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
    if entries()[key] and not entries()[key].hide and Collection.IsNew(key) then out[#out + 1] = key end   -- (hide: Lang.lua)
  end
  return out
end

function Collection.NewCount() return #Collection.NewKeys() end

-- How well finding works, by kind (Mike, 11/13, after LOR-1484: a whole game language found only quests for weeks and
-- nobody noticed). Each place, person, item and quest the game shows you is counted once a session as "seen", and as
-- "matched" when it has a page, into the day's anonymous usage counts (Log.Use: seen.<kind>, match.<kind>, and byid.<kind>
-- for a match by the game's id rather than a name, so the id tables' reach shows per language), which Willo's
-- check-in sends with the rest (site/lib/found-match.js reads the rates by game language). A table bump on events this
-- file already handles; nothing per frame, no names saved: the things seen are kept in memory for the session only.
local tallied, talliedN = {}, {}
local TALLY_MAX = 2000   -- things per kind a session remembers; past that it stops counting new ones
local function hasPage(key)
  local e = key and entries()[key]
  return (e and not e.hide) and true or false
end
-- what: the thing as the game gave it (its id, else its name); key: the page found for it, or nil; byId: found by id.
local function tally(kind, what, key, byId)
  if what == nil or (type(what) == "string" and not usable(what)) or not ns.Log then return end
  local seen = tallied[kind]
  if not seen then seen = {}; tallied[kind] = seen; talliedN[kind] = 0 end
  if seen[what] or talliedN[kind] >= TALLY_MAX then return end
  seen[what] = true
  talliedN[kind] = talliedN[kind] + 1
  ns.Log.Use("seen", kind)
  if hasPage(key) then
    ns.Log.Use("match", kind)
    if byId then ns.Log.Use("byid", kind) end
  end
end

-- Entry keys ------------------------------------------------------------------------------------------------------
-- By the game's own ids first (ns.DB.index.npcId, itemId, mapId: pipeline/lore/game_ids.py), which are the same in
-- every client language, then by name: the English names, plus the client's own names where Lang.lua has them (a
-- language pack's, and every area's from the client itself). A German client without the German pack used to find
-- quests (by id) and nothing else (11/13).

-- The entry the game's id leads to, only when it's one of kinds (Engine:KeyForId).
local function keyOfId(index, id, kinds)
  return ns.engine and ns.engine:KeyForId(index, tonumber(id), kinds) or nil
end

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
  -- (with or without a leading "The": the game's "The Temple of Atal'Hakkar" is the page Temple of Atal'Hakkar)
  out[#out + 1] = keyOfKind(zone, PLACE_KINDS) or keyOfKind((zone:gsub("^[Tt]he ", "")), PLACE_KINDS)
  if usable(subzone) then
    out[#out + 1] = engine:SubzoneKey(subzone, zone)
    out[#out + 1] = engine:AreaKey(subzone, zone)   -- Northshire Abbey -> Northshire Valley
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
  -- By the GUID's creature id; a GUID the game keeps secret (in combat, in an instance) can't be read: the name then.
  -- The second value is who it is, for the tally: the creature id, else the name.
  local guid = try(UnitGUID, unit)
  local id = ns.Context.Usable(guid) and ns.Engine.CreatureID(guid) or nil
  local byId = id and ns.engine:KeyForGUID(guid)
  if byId then return byId, id, true end
  local key, how = ns.engine:KeyForName(name)
  local e = key and entries()[key]
  -- A person by name; a mob named after a lore topic ("Defias Trapper") finds the topic.
  if e and ((how == "exact" and e.t == "npc") or (how == "mob" and e.t == "topic")) then return key, id or name end
  return nil, id or name
end

-- An item's entry by its item id when there is one, else by its name.
function Collection.ItemKey(name, id) return keyOfId("itemId", id, ITEM) or keyOfKind(name, ITEM) end

local function linkId(link) return type(link) == "string" and tonumber(link:match("item:(%d+)")) or nil end

-- Every item in the bags with a story of its own.
local function bagItemKeys()
  local out, CC = {}, _G.C_Container
  for bag = 0, (NUM_BAG_SLOTS or 4) do
    local slots = (CC and try(CC.GetContainerNumSlots, bag)) or try(GetContainerNumSlots, bag) or 0
    for slot = 1, slots do
      local link, id
      local info = CC and try(CC.GetContainerItemInfo, bag, slot)
      if type(info) == "table" then
        link, id = info.itemName or info.hyperlink, tonumber(info.itemID) or linkId(info.hyperlink)
      else
        link = try(GetContainerItemLink, bag, slot)
        id = linkId(link) or (CC and try(CC.GetContainerItemID, bag, slot)) or try(GetContainerItemID, bag, slot)
      end
      local name = type(link) == "string" and (link:match("%[(.-)%]") or link) or nil
      local key = Collection.ItemKey(name, id)
      pcall(tally, "item", id or name, key, key ~= nil and key == keyOfId("itemId", id, ITEM))
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
  -- The zone, city or dungeon by the map the game puts you on; then by the names (subzones have only names: Lang.lua
  -- gives every area the client's own name too).
  local byMap = keyOfId("mapId", _G.C_Map and try(C_Map.GetBestMapForUnit, "player"), PLACE_KINDS)
  Collection.Find(byMap, "enter")
  local keys = placeKeys(p.zone, p.subzone)
  for _, key in ipairs(keys) do Collection.Find(key, "enter") end
  -- The tally last, so finding never waits on it (or stops for it).
  local matched = hasPage(byMap) and byMap or nil
  for _, key in ipairs(keys) do if not matched and hasPage(key) then matched = key end end
  if usable(p.zone) then
    pcall(tally, "place", p.zone .. "|" .. (usable(p.subzone) and p.subzone or ""), matched, matched == byMap)
  end
end

local function onPerson(unit)
  local key, who, byId = personKey(unit)
  Collection.Find(key, "meet")
  pcall(tally, "person", who, key, byId)
end

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
  local key = Collection.ItemKey(name, id)
  Collection.Find(key, "hover")
  pcall(tally, "item", id or name, key, key ~= nil and key == keyOfId("itemId", id, ITEM))
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
    pcall(tally, "quest", tonumber(id), questKey(id), true)
  end,
  BAG_UPDATE_DELAYED = onBags,
}

-- The fill-in -------------------------------------------------------------------------------------------------------
-- What the add-on already knew becomes found, once per character (FILL): the journey's moments (oldest first, so
-- each page keeps its first time and place), the places, people, bosses and books it saw, every quest the server
-- says is done (with the people who give and take it), quests in the log, and the bags. Not stories heard: a story
-- plays from the book, an answer or a friend's link as well as where you stand, and hearing of Elwynn Forest isn't
-- going there (LOR-1501). Where you stood, the journey has it.

-- The journey's moments and what it saw, each as add(key, "past", t, lv, place).
local function journeyItems(j, add)
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
end

local function fillList()
  local items = {}   -- { key, how, t, lv, place }
  local function add(key, how, t, lv, place)
    if key then items[#items + 1] = { key, how, t or 0, lv, place } end
  end
  local j = ns.Context.Journey and ns.Context.Journey()
  journeyItems(j, add)
  -- Quests done, from the journey's saved copy of the server's list (whatever "Remember my journey" says: the server's
  -- can still be empty a few seconds after login), else the server itself.
  local jc = ns.Journey.Char and ns.Journey.Char()
  local done = type(jc) == "table" and type(jc.completed) == "table" and #jc.completed > 0 and jc.completed or nil
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
  local log = {}
  for _, q in ipairs(try(ns.Context.Quests) or {}) do log[#log + 1] = questKey(q.id) end
  -- The server lists every quest of a group as done once you've done one of them (LOR-1501):
  --   * Forever's copies: "The Adventurer" is a quest in seven starting zones, each its own id, and a character who did
  --     Tirisfal's has all seven, Elwynn Forest's too. Copies are Forever's own quests (fv) of one English name (en: a
  --     language pack writes its own over n, and names only some copies); an older chain of one name ("The Defias
  --     Brotherhood") isn't a group and always counts whole.
  --   * The original game's choices (m.xg, lore.quest_groups): quests of which you may do only one, such as each race's
  --     version of the warrior's level-10 quest. A Forsaken warrior who did "Ulag the Cleaver" has the orcs' "Path of
  --     Defense" too, given by Uzzek in The Barrens.
  -- So in a group, when what you really did backs one of them (the saved journey took or turned it in, it's in your log,
  -- or it was found as you played), only those backed count, with their people. When nothing backs any (done before
  -- the add-on, or the journey off), the ones your class and race may take count, and of those the ones in a zone
  -- you've been to; when nothing tells them apart, they all count. left: the pages, and their people, the server
  -- listed but you didn't do.
  local r, sure, named, left = Collection.Store(), {}, {}, {}
  for _, e in ipairs(type(jc) == "table" and type(jc.events) == "table" and jc.events or {}) do
    if type(e) == "table" and (e.k == "qa" or e.k == "qt") then
      local key = questKey(tonumber(e.id))
      if key then sure[key] = true end
    end
  end
  for _, key in ipairs(log) do sure[key] = true end
  for key in pairs(r and r.found or {}) do   -- (a fill-in's "done" or "past" isn't proof: the journey's events are above)
    local rec = Collection.Found(key)
    if rec and rec.how ~= "done" and rec.how ~= "past" then sure[key] = true end
  end
  -- The zones you've been to: the places the journey has (in items so far) and the ones found as you played (an older
  -- fill-in's "past" may be a story heard before version 3: the journey's own are above).
  local been = {}
  local function visit(key)
    local e = key and entries()[key]
    if e and PLACE_KINDS[e.t] and e.z then been[e.z] = true end
  end
  for _, it in ipairs(items) do visit(it[1]) end
  for key in pairs(r and r.found or {}) do
    local rec = Collection.Found(key)
    if rec and rec.how ~= "past" then visit(key) end
  end
  local function groupOf(key)
    local e = entries()[key]
    if type(e.m) == "table" and tonumber(e.m.xg) then return "xg" .. e.m.xg end
    if e.fv then return "n" .. lower(e.en or e.n or "") end
  end
  -- Whether your class and race may take a quest (m.cl, m.ra: the game's class and race files, lore.quest_who; as
  -- Book.lua's totals). Unknown: yes.
  local _, class = try(UnitClass, "player")
  local _, race = try(UnitRace, "player")
  local function listed(list, v)
    if type(list) ~= "table" or not v then return true end
    for _, x in ipairs(list) do if x == v then return true end end
    return false
  end
  local function mine(key)
    local m = entries()[key].m
    return type(m) ~= "table" or (listed(m.cl, class) and listed(m.ra, race))
  end
  for _, id in ipairs(done) do
    local key = questKey(id)
    local n = key and groupOf(key)
    if n then
      local g = named[n]
      if not g then g = { zones = {}, nz = 0 }; named[n] = g end
      g[#g + 1] = key
      local z = entries()[key].z or ""
      if not g.zones[z] then g.zones[z] = true; g.nz = g.nz + 1 end
      g.backed = g.backed or sure[key] == true
      g.yours = g.yours or mine(key)
      g.notYours = g.notYours or not mine(key)
    end
  end
  -- Which of a group's members count when nothing you did backs one: the ones your class and race may take (when the
  -- group has others too), and of those the ones in a zone you've been to (when there are any).
  for _, g in pairs(named) do
    if not g.backed then
      local mineOnly = g.yours and g.notYours
      for _, key in ipairs(g) do
        if (not mineOnly or mine(key)) and been[entries()[key].z] then g.near = true end
      end
      g.pick = function(key)
        return (not mineOnly or mine(key)) and (not g.near or been[entries()[key].z] == true)
      end
    end
  end
  for _, id in ipairs(done) do
    local key = questKey(id)
    local m = key and entries()[key].m
    local g = key and named[groupOf(key)]
    -- A group whose members are all in one zone isn't sorted (Darkshore's "Escape Through Force" or "... Stealth"):
    -- it lights no other zone, and that zone's total counts them all.
    local copy = g and g.nz > 1 and ((g.backed and not sure[key]) or (not g.backed and not g.pick(key)))
    local function person(name)
      local k = keyOfKind(name, PERSON)
      if copy then left[#left + 1] = k else add(k, "done") end
    end
    if copy then left[#left + 1] = key else add(key, "done") end
    if type(m) == "table" then
      person(m.start)
      person(m["end"])
    end
  end
  for _, key in ipairs(log) do add(key, "quest") end
  for _, k in ipairs(bagItemKeys()) do add(k, "loot") end
  return items, left
end

-- Takes back the pages an older fill-in found only from a story heard (LOR-1501): a record shaped as that fill-in wrote
-- it ("t;past;;": no level, no place) whose time is when one of the page's stories was heard, unless this fill-in or
-- the saved journey finds the page too (whatever "Remember my journey" says now: a visit it kept is a visit). Everything
-- found as you play, and everything the journey backs, stays. A taken-back record is set aside in r.unheard, not erased.
local function unheard(r, items)
  local heard = type(LoreForeverDB.heard) == "table" and LoreForeverDB.heard[ns.Journey.CharKey()]
  if type(heard) ~= "table" then return end
  local at = {}   -- { [entry key] = { [time heard] = true } } (a clip id is its entry's key, with #faqN or #sectionN)
  for id, t in pairs(heard) do
    if type(id) == "string" and type(t) == "number" then
      local key = id:match("^(.-)#") or id
      at[key] = at[key] or {}
      at[key][math.floor(t)] = true
    end
  end
  local backed, taken = {}, false
  for _, it in ipairs(items) do backed[it[1]] = true end
  journeyItems(ns.Journey.Char and ns.Journey.Char(), function(key) if key then backed[key] = true end end)
  for key in pairs(at) do
    local rec = not backed[key] and Collection.Found(key)
    if rec and rec.how == "past" and rec.lv == nil and rec.place == nil and at[key][rec.t] then
      if type(r.unheard) ~= "table" then r.unheard = {} end
      r.unheard[key] = r.unheard[key] or r.found[key]   -- the first one set aside, if it's ever set aside again
      r.found[key] = nil
      r.new[key] = nil
      taken = true
    end
  end
  -- Found's index leaves pages out of its totals by what's found (#3985): build it again.
  if taken and ns.Book and ns.Book.Forget then ns.Book.Forget() end
end

-- Takes back the quests of a group an older fill-in found from the server's done list though you did another of them
-- (fillList's left: the quest pages and their people), when the record is exactly what that fill-in wrote ("0;done;;")
-- and nothing else finds the page: not this fill-in, not the saved journey. Set aside in r.undone, not erased.
local function undone(r, items, left)
  local backed, taken = {}, false
  for _, it in ipairs(items) do backed[it[1]] = true end
  journeyItems(ns.Journey.Char and ns.Journey.Char(), function(key) if key then backed[key] = true end end)
  for _, key in ipairs(left) do
    local rec = not backed[key] and Collection.Found(key)
    if rec and rec.how == "done" and rec.t == 0 and rec.lv == nil and rec.place == nil then
      if type(r.undone) ~= "table" then r.undone = {} end
      r.undone[key] = r.undone[key] or r.found[key]
      r.found[key] = nil
      r.new[key] = nil
      taken = true
    end
  end
  if taken and ns.Book and ns.Book.Forget then ns.Book.Forget() end
end

function Collection.Fill(done)
  local r = Collection.Store()
  if not r or r.filled == FILL then if done then done() end return end
  local ok, items, left = pcall(fillList)
  if not ok then items, left = {}, {} end
  -- A character an older fill-in already ran for only gains what it missed: a page it has found keeps its record,
  -- but what only a heard story found goes (before version 3), and so do the quests of a group it didn't do (before
  -- 4: Forever's copies; before 5: the original game's choices too).
  local refill = r.filled ~= nil
  if refill and ok and (tonumber(r.filled) or 0) < 3 then pcall(unheard, r, items) end
  if refill and ok and (tonumber(r.filled) or 0) < 5 then pcall(undone, r, items, left) end
  local i = 1
  local function step()
    local last = math.min(i + SLICE - 1, #items)
    for n = i, last do
      local it = items[n]
      if not (refill and r.found[it[1]]) then Collection.Find(it[1], it[2], it[3], it[4], it[5]) end
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
      if h then ns.Guard(h, ...) end   -- a broken handler is kept for /lore errors (Errors.lua)
    end)
  end
  later(3, function() Collection.Fill() end)
end
