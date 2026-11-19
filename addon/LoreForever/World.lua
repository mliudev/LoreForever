-- What drops in Forever's dungeons, kept so Willo can learn new dungeons' loot from what players' add-ons see (LOR-1586,
-- phase 1). Like the vendor spots (Capture.OnSpot): kept in SavedVariables on the player's PC, sent by Willo under
-- "Send what's new in Forever" (companion/lore_companion/world.py), folded into the dungeon guide two installs at a
-- time (pipeline/lore/world.py). The contract between the four: ~/handoffs/lor-1586-phase1-contract.md.
--
-- Kept only in WoW Forever (Capture.InForever), only with Options › Keep the quest text you see on (Capture.On: off keeps
-- nothing new; what's there stays), and only inside party and raid instances (GetInstanceInfo's type). Each fact is
-- written as its event happens: the game lets go of what it showed before PLAYER_LOGOUT (willo-answers L73).
--
-- LoreForeverDB.world = {
--   v = 1, build = "1.60.1.70959",         GetBuildInfo, refreshed at login
--   corpses = { [h] = "inst;kind;id;enc;items" },
--       one looted corpse or chest. h: 8 hex digits, the djb2 of the source GUID (Capture.Hash), so every client
--       looting one corpse makes the same h and no realm or server number leaves the PC. kind "n" (a Creature or
--       Vehicle GUID) or "o" (a GameObject GUID), id the GUID's NPC or object id. enc: the encounter id when this corpse
--       is the boss of a successful ENCOUNTER_END in this instance: its GUID was a boss unit of that encounter (any time
--       this session), or, within RECENT seconds, its name (as the target, mouseover or soft-interact unit has it) is
--       the encounter's or both name the same lore entry; else 0. items: "item*qty" joined by commas (at most
--       MAX_ITEMS), a trailing "q" on a quest-only slot (GetLootSlotInfo's isQuestItem); only uncommon or better
--       (quality >= 2) and quest-only slots, no coin. A corpse with no such items is kept only when enc ~= 0 (a boss
--       kill with no gear is still a kill). Looting a corpse again changes nothing.
--       Not drops, so never kept: a window that follows your own Pick Pocket, Skinning, Mining or Herb Gathering
--       (GATHER), and a source that is still alive (a pickpocketed NPC). Neither marks the corpse as looked at, so its
--       real loot is still kept when it dies.
--   ring = { h, ... }, head = 1,            the corpses, oldest first: the oldest goes when MAX_CORPSES are kept or
--                                           the table would pass BYTES in the saved file (head stays 1; older
--                                           add-ons rotated the ring from head, and Willo reads it from head)
--   kills = { ["inst:enc"] = "n;diff;name" },
--                                           successful ENCOUNTER_ENDs: how many (only grows), the difficulty id, the
--                                           encounter's name ("" from a client not in English)
--   rolls = { ["inst:enc>item"] = n },      START_LOOT_ROLL items seen while no loot window is open, credited to the
--                                           newest successful encounter in this instance within RECENT seconds (else
--                                           not kept). Never who rolled or won.
--   korder, rorder = { key, ... }          the kills' and rolls' keys, oldest first: when MAX_KILLS or MAX_ROLLS are
--                                           kept, the oldest key goes to make room for a new one (a new dungeon is
--                                           the point); Willo doesn't read them
--   insts = { [inst] = "name;type;emap;ex;ey" },
--                                           the instance's name ("" not in English), "party" or "raid", and the last
--                                           outdoor spot before its loading screen (Journey.Here: map, x, y in
--                                           thousandths), empty when unknown; at most MAX_INSTS
-- }
-- Size: at most about 300 KB in the saved file, whatever is looted: what each row takes as WoW writes it is counted,
-- and past BYTES the oldest corpses make room. Kills, rolls and instances have their counts too, a name at most
-- MAX_NAME bytes, a corpse at most MAX_ITEMS items.
-- inst is GetInstanceInfo's 8th value, the instance's map id (36: the Deadmines).
--
-- Nothing about another player, ever: a GUID counts only when it is a Creature, Vehicle or GameObject (players, pets and
-- items are left out), and nothing reads chat, the group or who rolled. No time and no character on
-- any fact. Names only from an English client (as the spots), ids from every client.
-- Cost: no work on nameplates, mouseover or vendor windows; a loot window is a few calls per slot and a lookup in one
-- session cache of corpse hashes; nothing scans the table per event.
-- To verify on the Forever client (the sims mock them): GetLootSourceInfo (without it, the dead NPC under the mouse or
-- soft-interact is the source and a chest isn't kept), GetLootSlotInfo's 7th value (the quest mark),
-- GetLootRollItemLink, the boss1-5 units, PLAYER_LEAVING_WORLD and the gathering casts' spell ids (GATHER; their names
-- in the client's language are matched too). World.Stats() times loot windows on the real client for /lore qa.

local _, ns = ...
local World = {}
ns.World = World

local V = 1
local MAX_CORPSES, MAX_KILLS, MAX_ROLLS, MAX_INSTS = 3000, 400, 1000, 200
local BYTES = 290 * 1024     -- the whole table in the saved file: past it, the oldest corpses make room
local MAX_ITEMS, MAX_NAME = 40, 64
local RECENT = 120           -- seconds after an encounter's end that a corpse (by its name) or a roll is still its boss's
local GATHERED = 3           -- seconds after your own gathering cast that a loot window is its yield
-- Pick Pocket, Skinning, Mining and Herb Gathering, every rank (Classic's ids); a cast with the same name counts too.
local GATHER = {}
for _, id in ipairs({ 921, 8613, 8617, 8618, 10768, 2575, 2576, 3564, 10248, 2366, 2368, 3570, 11993 }) do
  GATHER[id] = true
end
local MAX_SEEN = 6000        -- the session's corpse hashes, started again past this
local KIND = { Creature = "n", Vehicle = "n", GameObject = "o" }   -- the GUIDs kept; never Player, Pet or Item
local INSTANCE = { party = true, raid = true }
local ENGLISH = { enUS = true, enGB = true }
local UNITS = { "target", "mouseover", "softinteract" }   -- where a looted corpse's name can be read

local function pass(ok, ...) if ok then return ... end end
local function call(f, ...)
  if type(f) ~= "function" then return nil end
  return pass(pcall(f, ...))
end
local function usable(v) return ns.Context.Usable(v) end
local function text(v) return usable(v) and type(v) == "string" and v ~= "" end
local function count(t) local n = 0 for _ in pairs(t) do n = n + 1 end return n end
local function db()
  local d = type(LoreForeverDB) == "table" and LoreForeverDB.world
  return type(d) == "table" and d or nil
end

local function build()
  local version, b = call(_G.GetBuildInfo)
  return (type(version) == "string" and version or "") .. (b and ("." .. tostring(b)) or "")
end

-- A name as the table keeps it: from an English client only, never with the field separator in it, at most MAX_NAME
-- bytes (cut at a whole character).
local function keptName(name)
  if not (text(name) and ENGLISH[call(_G.GetLocale) or ""]) then return "" end
  name = name:gsub("[;\r\n]", " ")
  if #name > MAX_NAME then name = name:sub(1, MAX_NAME):gsub("[\192-\255][\128-\191]*$", "") end
  return name
end

-- What a row takes in the saved file as WoW writes it (two tabs, the key in brackets and quotes, " = ", the value, ","),
-- with its line in its order list for the ordered ones ("key", -- [n]).
local LINES = { corpse = 30, kill = 28, roll = 28, inst = 11 }
local TWICE = { corpse = true, kill = true, roll = true }   -- the key is written again in the order list
local function size(kind, k, v)
  k, v = tostring(k), tostring(v)
  return LINES[kind] + #k * (TWICE[kind] and 2 or 1) + #v
end

-- An order list holding each key of t once, oldest first: kept when it does, else rebuilt from t in no particular order
-- (a file edited by hand or cut short, or one from before the list).
local function ordered(list, t)
  if type(list) == "table" and #list == count(t) then
    local once, ok = {}, true
    for _, k in ipairs(list) do
      if t[k] == nil or once[k] then ok = false break end
      once[k] = true
    end
    if ok then return list end
  end
  local out = {}
  for k in pairs(t) do out[#out + 1] = k end
  return out
end

-- The table's lists, made when missing and put right, within the caps; and the session's counts, for the caps.
local counts
local function shape(d)
  for _, k in ipairs({ "corpses", "ring", "kills", "rolls", "insts" }) do
    d[k] = type(d[k]) == "table" and d[k] or {}
  end
  -- An older add-on's full ring ran from head: it starts at 1 now.
  local head, ring = tonumber(d.head) or 1, d.ring
  if head > 1 and head <= #ring then
    local from = {}
    for i = head, #ring do from[#from + 1] = ring[i] end
    for i = 1, head - 1 do from[#from + 1] = ring[i] end
    ring = from
  end
  d.ring, d.head = ordered(ring, d.corpses), 1
  d.korder, d.rorder = ordered(d.korder, d.kills), ordered(d.rorder, d.rolls)
  local bytes = 0
  for _, part in ipairs({ { d.corpses, "corpse" }, { d.kills, "kill" }, { d.rolls, "roll" }, { d.insts, "inst" } }) do
    for k, v in pairs(part[1]) do bytes = bytes + size(part[2], k, v) end
  end
  counts = { bytes = bytes, insts = count(d.insts) }
  while #d.ring > MAX_CORPSES do
    local h = table.remove(d.ring, 1)
    counts.bytes = counts.bytes - size("corpse", h, d.corpses[h])
    d.corpses[h] = nil
  end
  for _, list in ipairs({ { d.kills, d.korder, MAX_KILLS, "kill" }, { d.rolls, d.rorder, MAX_ROLLS, "roll" } }) do
    while #list[2] > list[3] do
      local k = table.remove(list[2], 1)
      counts.bytes = counts.bytes - size(list[4], k, list[1][k])
      list[1][k] = nil
    end
  end
end

-- The oldest corpses go while the table is past BYTES (everything new is kept: a new dungeon is the point).
local function fit(d)
  while counts.bytes > BYTES and #d.ring > 1 do
    local h = table.remove(d.ring, 1)
    counts.bytes = counts.bytes - size("corpse", h, d.corpses[h])
    d.corpses[h] = nil
  end
end

-- A row set in one of the table's lists, with the bytes it takes (kind: corpse, kill, roll, inst).
local function set(d, t, kind, k, v)
  local old = t[k]
  if old ~= nil then counts.bytes = counts.bytes - size(kind, k, old) end
  t[k] = v
  if v ~= nil then counts.bytes = counts.bytes + size(kind, k, v) end
end

-- A new key into a counted list (kills, rolls): when it's full, its oldest key goes.
local function room(d, t, order, max, kind, key)
  while #order >= max do set(d, t, kind, table.remove(order, 1), nil) end
  order[#order + 1] = key
end

-- The table, made with the first fact kept (with keeping off nothing is ever written).
local function make()
  local d = db()
  if d and counts then return d end
  if not d then
    d = { v = V, build = build() }
    LoreForeverDB.world = d
  end
  shape(d)
  fit(d)
  return d
end

-- At login, from Capture.Init: this client's build on a table kept in Forever. A table carried into another client's
-- folder stays as it is.
function World.Init()
  local d = db()
  if not d or not ns.Capture.InForever() then return end
  d.v, d.build = V, build()
  shape(d)
  fit(d)
end

-- Whether this client is Forever's: it can't change in a session, so it's asked once.
local forever
local function inForever()
  if forever == nil then forever = ns.Capture.InForever() and true or false end
  return forever
end

-- The instance being kept: (inst, type, name), or nil outside a party or raid instance, outside Forever, or with keeping
-- off.
local function where()
  if not (ns.Capture.On() and inForever()) then return nil end
  local name, itype, _, _, _, _, _, inst = call(_G.GetInstanceInfo)
  if not (usable(itype) and INSTANCE[itype] and usable(inst)) then return nil end
  inst = tonumber(inst)
  if not inst or inst <= 0 then return nil end
  return inst, itype, name
end

-- Instances and their entrances ---------------------------------------------------------------------------------------

local entrance     -- "map:x:y": the last outdoor spot before a loading screen, used by the next instance entered
local noted = {}   -- inst -> true once this session's entry is written

local function noteInst(d, inst, itype, name)
  if noted[inst] and not entrance then return end
  if d.insts[inst] == nil then
    if counts.insts >= MAX_INSTS then return end
    counts.insts = counts.insts + 1
  end
  local old = type(d.insts[inst]) == "string" and d.insts[inst] or ""
  local oldName, _, emap, ex, ey = old:match("^(.-);(.-);(.-);(.-);(.-)$")
  local map, x, y = tostring(entrance or ""):match("^(%d+):(%d+):(%d+)$")
  if map then emap, ex, ey = map, x, y end
  entrance = nil
  name = keptName(name)
  if name == "" then name = oldName or "" end
  set(d, d.insts, "inst", inst, table.concat({ name, itype, emap or "", ex or "", ey or "" }, ";"))
  noted[inst] = true
  fit(d)
end

local function outdoors()
  if not (ns.Capture.On() and inForever()) or call(_G.IsInInstance) then return end
  local spot = ns.Journey and ns.Journey.Here and ns.Journey.Here()
  if spot then entrance = spot end
end

local function arrived()
  local inst, itype, name = where()
  if inst then noteInst(make(), inst, itype, name) end
end

-- Boss kills --------------------------------------------------------------------------------------------------------------

local recent = {}      -- this session's successful encounters, newest last: { inst, enc, name, at } (at: GetTime)
local bossGUIDs = {}   -- boss unit GUID -> encounter id, read as an encounter starts and ends
local killed = {}      -- "inst:enc" -> true for every encounter won this session

local function noteBosses(enc)
  if count(bossGUIDs) > 200 then bossGUIDs = {} end
  for i = 1, 5 do
    local g = call(_G.UnitGUID, "boss" .. i)
    if text(g) then bossGUIDs[g] = enc end
  end
end

local function onStart(enc)
  enc = usable(enc) and tonumber(enc)
  if enc and where() then noteBosses(enc) end
end

local function onEnd(enc, name, diff, _, success)
  if not (success == 1 or success == true) then return end
  local inst, itype, iname = where()
  enc = usable(enc) and tonumber(enc)
  if not (inst and enc and enc > 0) then return end
  local d = make()
  noteInst(d, inst, itype, iname)
  noteBosses(enc)
  recent[#recent + 1] = { inst = inst, enc = enc, name = text(name) and name or nil, at = call(_G.GetTime) or 0 }
  if #recent > 8 then table.remove(recent, 1) end
  local key = inst .. ":" .. enc
  killed[key] = true
  local old = d.kills[key]
  if old == nil then room(d, d.kills, d.korder, MAX_KILLS, "kill", key) end
  local n, oldName = 0, ""
  if type(old) == "string" then n, oldName = tonumber(old:match("^(%d+)")) or 0, old:match("^[^;]*;[^;]*;(.*)$") or "" end
  local kept = keptName(name)
  set(d, d.kills, "kill", key,
    (n + 1) .. ";" .. (usable(diff) and tonumber(diff) or 0) .. ";" .. (kept ~= "" and kept or oldName))
  fit(d)
end

-- The newest successful encounter in this instance within RECENT seconds.
local function encounter(inst)
  local now = call(_G.GetTime) or 0
  for i = #recent, 1, -1 do
    local e = recent[i]
    if now - e.at > RECENT then return nil end
    if e.inst == inst then return e end
  end
end

local function sameName(a, b)
  if not (a and b) then return false end
  local lower = ns.Engine.lower
  local la, lb = lower(a), lower(b)
  if la == lb then return true end
  local idx = ns.DB and ns.DB.index and ns.DB.index.name
  return idx ~= nil and idx[la] ~= nil and idx[la] == idx[lb]
end

-- The unit (target, mouseover or soft-interact) whose GUID this is, or nil.
local function unitOf(guid)
  for _, unit in ipairs(UNITS) do
    local g = call(_G.UnitGUID, unit)
    if text(g) and g == guid then return unit end
  end
end

local function nameOf(guid)
  local unit = unitOf(guid)
  local name = unit and call(_G.UnitName, unit)
  return text(name) and name or nil
end

-- Whether this source is a unit still alive: what a pickpocket names. Its window holds no drop.
local function alive(guid)
  local unit = unitOf(guid)
  return unit ~= nil and not call(_G.UnitIsDead, unit)
end

-- The encounter whose boss this corpse is, or 0: one won this session whose boss unit had this GUID (exact, so at any
-- time), else, newest first within RECENT seconds in this instance, one whose name is the corpse's.
local function encOf(guid, inst)
  local enc = bossGUIDs[guid]
  if enc and killed[inst .. ":" .. enc] then return enc end
  if not recent[1] then return 0 end
  local now, name = call(_G.GetTime) or 0, nil
  for i = #recent, 1, -1 do
    local e = recent[i]
    if now - e.at > RECENT then return 0 end
    if e.inst == inst then
      if name == nil then name = nameOf(guid) or false end
      if name and sameName(name, e.name) then return e.enc end
    end
  end
  return 0
end

-- Loot windows ------------------------------------------------------------------------------------------------------------

local lootOpen = false
local seen, seenCount = {}, 0   -- corpse hashes looked at this session
local gatheredAt                -- GetTime of your own last gathering cast (GATHER), until a loot window takes it
local castIsGather = {}         -- spell id -> whether it's a gathering cast by name, asked once a session

-- Whether a spell you cast is Pick Pocket, Skinning, Mining or Herb Gathering: by id, or by the name those ids have in
-- this client (another rank, or Forever's own id for the same spell).
local gatherNames
local function spellName(id)
  local S = _G.C_Spell
  local name = (S and call(S.GetSpellName, id)) or call(_G.GetSpellInfo, id)
  return text(name) and name or nil
end
local function isGather(id)
  if GATHER[id] then return true end
  if castIsGather[id] == nil then
    if not gatherNames then
      gatherNames = {}
      for g in pairs(GATHER) do
        local name = spellName(g)
        if name then gatherNames[name] = true end
      end
    end
    local name = spellName(id)
    castIsGather[id] = name ~= nil and gatherNames[name] == true
  end
  return castIsGather[id]
end

local function onCast(unit, _, id)
  if unit ~= "player" or not usable(id) then return end
  id = tonumber(id)
  if id and isGather(id) then gatheredAt = call(_G.GetTime) or 0 end
end

-- "Creature-0-4372-36-12-639-0000AB12CD" -> "n", 639; a GameObject's -> "o", its id; a player, pet or item -> nil.
-- Giver.ParseGUID's reading in one match, without its table and pieces (a loot window can name a dozen sources).
local function source(guid)
  local kind, id = guid:match("^(%a+)%-[^%-]*%-[^%-]*%-[^%-]*%-[^%-]*%-(%d+)%-")
  id = tonumber(id)
  if KIND[kind] and id and id > 0 then return KIND[kind], id end
end

local function itemOf(link)
  return text(link) and tonumber(link:match("|Hitem:(%d+)") or link:match("^item:(%d+)")) or nil
end

-- One slot's item into the corpses it came from: acc[guid] = { order = { id, ... }, qty = { [id] = n }, quest = {} }.
local function add(acc, guid, id, qty, quest)
  if not text(guid) then return end
  local c = acc[guid]
  if not c then
    c = { order = {}, qty = {}, quest = {} }
    acc[guid] = c
  end
  if not id then return end
  if not c.qty[id] then c.order[#c.order + 1] = id end
  c.qty[id] = (c.qty[id] or 0) + (tonumber(qty) or 1)
  if quest then c.quest[id] = true end
end

-- GetLootSourceInfo's (guid, quantity) pairs for a slot; returns whether there was one.
local function sources(acc, id, qty, quest, ...)
  local any = false
  for i = 1, select("#", ...), 2 do
    local guid, q = select(i, ...)
    if text(guid) then
      add(acc, guid, id, usable(q) and tonumber(q) or qty, quest)
      any = true
    end
  end
  return any
end

-- A corpse into the table, the oldest going first while it's full by count or by bytes.
local function keep(d, h, rec)
  local ring = d.ring
  while #ring >= MAX_CORPSES do set(d, d.corpses, "corpse", table.remove(ring, 1), nil) end
  ring[#ring + 1] = h
  set(d, d.corpses, "corpse", h, rec)
  fit(d)
end

-- The NPC being looted when the client names no source: dead, and under the mouse or soft-interact (not the target
-- alone: a lockbox opened beside a dead boss isn't its loot).
local function lootedUnit()
  for _, unit in ipairs({ "mouseover", "softinteract" }) do
    local g = call(_G.UnitGUID, unit)
    if text(g) and call(_G.UnitIsDead, unit) then return g end
  end
end

function World.OnLoot()
  lootOpen = true
  local now = call(_G.GetTime) or 0
  local gathered = gatheredAt and now - gatheredAt <= GATHERED
  gatheredAt = nil
  local inst, itype, iname = where()
  if not inst or gathered or call(_G.IsFishingLoot) then return end
  local n = call(_G.GetNumLootItems)
  n = usable(n) and tonumber(n) or 0
  local acc, sourced, items = {}, false, nil
  for slot = 1, n do
    local _, _, qty, _, quality, _, isQuest = call(_G.GetLootSlotInfo, slot)
    local id = itemOf(call(_G.GetLootSlotLink, slot))
    quality = usable(quality) and tonumber(quality) or 0
    local quest = usable(isQuest) and isQuest and true or false
    qty = usable(qty) and tonumber(qty) or 1
    if id and not (quest or quality >= 2) then id = nil end   -- grey and white loot: the corpse counts, not the item
    if sources(acc, id, qty, quest, call(_G.GetLootSourceInfo, slot)) then
      sourced = true
    elseif id then
      items = items or {}
      items[#items + 1] = { id, qty, quest }
    end
  end
  -- No source from the client: the dead NPC being looted (a chest can't be told).
  if not sourced then
    local guid = lootedUnit()
    if not guid then return end
    add(acc, guid)
    for _, it in ipairs(items or {}) do add(acc, guid, it[1], it[2], it[3]) end
  end
  local d
  for guid, c in pairs(acc) do
    local kind, id = source(guid)
    if kind and not alive(guid) then
      local h = ns.Capture.Hash(guid)
      local old = db()
      if not seen[h] and not (old and old.corpses and old.corpses[h]) then
        if seenCount >= MAX_SEEN then seen, seenCount = {}, 0 end
        seen[h], seenCount = true, seenCount + 1
        local enc = encOf(guid, inst)
        local parts = {}
        for i, item in ipairs(c.order) do
          if i > MAX_ITEMS then break end
          parts[i] = item .. "*" .. c.qty[item] .. (c.quest[item] and "q" or "")
        end
        if #parts > 0 or enc ~= 0 then
          d = d or make()
          noteInst(d, inst, itype, iname)
          keep(d, h, inst .. ";" .. kind .. ";" .. id .. ";" .. enc .. ";" .. table.concat(parts, ","))
        end
      end
    end
  end
end

-- Rolls: an item from a boss's corpse that someone else opened (its loot window's own items are in that corpse).
local function onRoll(rollID)
  if lootOpen then return end
  local inst, itype, iname = where()
  if not inst then return end
  local item = itemOf(call(_G.GetLootRollItemLink, rollID))
  local e = item and encounter(inst)
  if not e then return end
  local d = make()
  noteInst(d, inst, itype, iname)
  local key = inst .. ":" .. e.enc .. ">" .. item
  local n = tonumber(d.rolls[key])
  if not n then room(d, d.rolls, d.rorder, MAX_ROLLS, "roll", key) end
  set(d, d.rolls, "roll", key, (n or 0) + 1)
  fit(d)
end

-- What the table holds and what loot windows cost this session on this client, for /lore qa (SelfTest.lua): nil when
-- nothing is kept yet.
local spent = { n = 0, ms = 0, max = 0 }
function World.Stats()
  local d = db()
  if not d then return nil end
  return { corpses = count(type(d.corpses) == "table" and d.corpses or {}),
    kills = count(type(d.kills) == "table" and d.kills or {}), rolls = count(type(d.rolls) == "table" and d.rolls or {}),
    windows = spent.n, avg = spent.n > 0 and spent.ms / spent.n or 0, max = spent.max }
end

-- Events ------------------------------------------------------------------------------------------------------------------

local function timedLoot()
  local clock = _G.debugprofilestop
  if type(clock) ~= "function" then return World.OnLoot() end
  local t0 = clock()
  World.OnLoot()
  local ms = clock() - t0
  spent.n, spent.ms = spent.n + 1, spent.ms + ms
  if ms > spent.max then spent.max = ms end
end

local handlers = {
  LOOT_OPENED = timedLoot,
  UNIT_SPELLCAST_SUCCEEDED = onCast,
  LOOT_CLOSED = function() lootOpen = false end,
  START_LOOT_ROLL = onRoll,
  ENCOUNTER_START = onStart,
  ENCOUNTER_END = onEnd,
  PLAYER_ENTERING_WORLD = arrived,
  PLAYER_LEAVING_WORLD = outdoors,
  ZONE_CHANGED_NEW_AREA = outdoors,
  ZONE_CHANGED = outdoors,
}
local frame = CreateFrame("Frame")
World.frame = frame
for event in pairs(handlers) do
  -- Your own casts only (the client filters them), where it can.
  if event == "UNIT_SPELLCAST_SUCCEEDED" and frame.RegisterUnitEvent then
    pcall(frame.RegisterUnitEvent, frame, event, "player")
  else
    pcall(frame.RegisterEvent, frame, event)
  end
end
frame:SetScript("OnEvent", function(_, event, ...)
  if not (type(LoreForeverDB) == "table" and LoreForeverDB.capture) then return end   -- before login (Capture.Init)
  ns.Guard(handlers[event], ...)
end)
