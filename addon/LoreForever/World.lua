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
--   merchants = { [npcId] = "r;item*qty*f,..." },
--                                           vendor inventories (MERCHANT_SHOW, anywhere in Forever, known or unknown
--                                           spots): repair flag (0|1) and item*qty*flags sorted by itemId (f: "" normal,
--                                           "l" limited stock numAvailable >= 0, "e" extended cost, "le" both),
--                                           union-merged across visits so sold-out limited stock stays; never copper
--                                           prices. At most MAX_MERCHANTS / MERCHANT_BYTES (independent of dungeon
--                                           corpses so vendor visits never evict boss kills)
--   morder = { npcId, ... }                 merchant keys, oldest first
--   trainers = { [npcId] = "kind;svc1|..." },
--                                           trainer curricula (TRAINER_SHOW, anywhere in Forever, skipping pet
--                                           trainers): kind "c" (class) or "p" (profession/tradeskill), static service
--                                           entries union-merged across visits without touching player UI filters;
--                                           never serviceType, hasSkillReq, hasAbilReq, or character state. At most
--                                           MAX_TRAINERS / TRAINER_BYTES (independent of dungeon corpses)
--   torder = { npcId, ... }                 trainer keys, oldest first
--   oloot = { ["k:src>item"] = "n;q" },     bounded outdoor drops (LOOT_OPENED outside party/raid instances, skipping
--                                           fishing, gathering, living targets): quest items, rare/rareelite/worldboss
--                                           uncommon+, blue+, and recipes (classID == 9) only, deduped per corpse GUID
--                                           in session. At most MAX_OLOOT / OLOOT_BYTES (independent of dungeon corpses)
--   oorder = { key, ... }                   outdoor loot keys, oldest first
-- }
-- Size: at most about 290 KB for dungeon data, 75 KB for merchants, 55 KB for trainers, and 20 KB for outdoor loot
-- (~440 KB total, under the 450 KB ceiling): what each row takes as WoW writes it is counted, and each sub-table uses
-- its own independent eviction order and byte budget so busy vendor, trainer, or outdoor activity never evicts dungeon
-- corpses. Kills, rolls and instances have their counts too, a name at most MAX_NAME bytes, a corpse at most MAX_ITEMS
-- items, a merchant at most MAX_MERCHANT_ITEMS items, a trainer at most MAX_TRAINER_SERVICES services.
-- inst is GetInstanceInfo's 8th value, the instance's map id (36: the Deadmines).
--
-- Nothing about another player, ever: a GUID counts only when it is a Creature, Vehicle or GameObject (players, pets and
-- items are left out), and nothing here reads chat, the group or who rolled (World.Listen hands CHAT_MSG_LOOT to the
-- Dungeon Guide's kill pages, which read only the player's own loot line; World keeps nothing from it). No time and no character on
-- any fact. Names only from an English client (as the spots), ids from every client.
-- Cost: no work on nameplates or mouseover; a loot window is a few calls per slot and a lookup in one session cache of
-- corpse hashes; a merchant or trainer window is one pass over its items/services with a session string cache; nothing
-- scans the table per event.
-- To verify on the Forever client (the sims mock them): GetLootSourceInfo (without it, the dead NPC under the mouse or
-- soft-interact is the source and a chest isn't kept), GetLootSlotInfo's 7th value (the quest mark),
-- GetLootRollItemLink, the boss1-5 units, PLAYER_LEAVING_WORLD, the gathering casts' spell ids (GATHER; their names
-- in the client's language are matched too), the merchant APIs (C_MerchantFrame.GetItemInfo / GetMerchantItemInfo,
-- GetMerchantItemLink, GetMerchantNumItems, CanMerchantRepair, GetMerchantItemCostInfo), the trainer APIs
-- (C_Trainer.GetTrainerType, IsTradeskillTrainer, GetTrainerServiceStepIndex, GetNumTrainerServices,
-- GetTrainerServiceInfo, GetTrainerServiceSkillReq, GetTrainerServiceNumAbilityReq, GetTrainerServiceAbilityReq,
-- GetTrainerServiceCost, C_TooltipInfo.GetTrainerService, GetTrainerServiceSpellLink, GetTrainerServiceItemLink), and
-- C_Item.GetItemInfoInstant / GetItemInfoInstant. World.Stats() times loot windows on the real client for /lore qa.

local _, ns = ...
local World = {}
ns.World = World

local V = 1
local MAX_CORPSES, MAX_KILLS, MAX_ROLLS, MAX_INSTS = 3000, 400, 1000, 200
local BYTES = 290 * 1024     -- the Phase 1 table in the saved file: past it, the oldest corpses make room
local MAX_MERCHANTS, MAX_MERCHANT_ITEMS = 300, 120
local MERCHANT_BYTES = 75 * 1024   -- independent cap so busy vendor visits never evict dungeon corpses
local MAX_TRAINERS, MAX_TRAINER_SERVICES = 150, 150
local TRAINER_BYTES = 55 * 1024    -- independent cap so trainer visits never evict dungeon corpses
local MAX_OLOOT, OLOOT_BYTES = 500, 20 * 1024   -- independent cap for bounded outdoor loot
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
local RARE_CLASS = { rare = true, rareelite = true, worldboss = true }
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

local function trainerText(s, maxLen)
  if not (text(s) and ENGLISH[call(_G.GetLocale) or ""]) then return "" end
  s = s:gsub("[|~^;\r\n]", " "):gsub("^%s+", ""):gsub("%s+$", "")
  if #s > maxLen then s = s:sub(1, maxLen):gsub("[\192-\255][\128-\191]*$", "") end
  return s
end

-- What a row takes in the saved file as WoW writes it (three tabs: the rows sit in LoreForeverDB.world's lists; the key
-- in brackets and quotes, " = ", the value, ","), with its line in its order list for the ordered ones ("key", -- [n]).
local LINES = { corpse = 32, kill = 30, roll = 30, inst = 12, merchant = 28, trainer = 28, oloot = 30 }
local TWICE = { corpse = true, kill = true, roll = true, merchant = true, trainer = true, oloot = true }   -- the key is written again in the order list
local function size(kind, k, v)
  k, v = tostring(k), tostring(v)
  return LINES[kind] + #k * (TWICE[kind] and 2 or 1) + #v
end

-- An order list holding each key of t once, oldest first: kept when it does, else rebuilt from t in no particular order
-- (a file edited by hand or cut short, or one from before the list).
local function ordered(list, t)
  if type(list) == "table" and #list == count(t) then
    local once, ok = {}, true
    for i = 1, #list do   -- (not ipairs: a hole written by hand would hide what's past it)
      local k = list[i]
      if k == nil or t[k] == nil or once[k] then ok = false break end
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
local seenMerchant = {}   -- npcId -> serialized string last kept this session
local seenTrainer = {}    -- npcId -> serialized string last kept this session
local function shape(d)
  for _, k in ipairs({ "corpses", "ring", "kills", "rolls", "insts", "merchants", "morder",
                       "trainers", "torder", "oloot", "oorder" }) do
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
  d.morder = ordered(d.morder, d.merchants)
  d.torder = ordered(d.torder, d.trainers)
  d.oorder = ordered(d.oorder, d.oloot)
  local bytes, mbytes, tbytes, obytes = 0, 0, 0, 0
  for _, part in ipairs({ { d.corpses, "corpse" }, { d.kills, "kill" }, { d.rolls, "roll" }, { d.insts, "inst" } }) do
    for k, v in pairs(part[1]) do bytes = bytes + size(part[2], k, v) end
  end
  for k, v in pairs(d.merchants) do mbytes = mbytes + size("merchant", k, v) end
  for k, v in pairs(d.trainers) do tbytes = tbytes + size("trainer", k, v) end
  for k, v in pairs(d.oloot) do obytes = obytes + size("oloot", k, v) end
  counts = { bytes = bytes, insts = count(d.insts), mbytes = mbytes, tbytes = tbytes, obytes = obytes }
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
  while #d.morder > MAX_MERCHANTS do
    local npc = table.remove(d.morder, 1)
    counts.mbytes = counts.mbytes - size("merchant", npc, d.merchants[npc])
    d.merchants[npc] = nil
    seenMerchant[npc] = nil
  end
  while #d.torder > MAX_TRAINERS do
    local npc = table.remove(d.torder, 1)
    counts.tbytes = counts.tbytes - size("trainer", npc, d.trainers[npc])
    d.trainers[npc] = nil
    seenTrainer[npc] = nil
  end
  while #d.oorder > MAX_OLOOT do
    local key = table.remove(d.oorder, 1)
    counts.obytes = counts.obytes - size("oloot", key, d.oloot[key])
    d.oloot[key] = nil
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

-- The oldest merchants go while merchants are past MERCHANT_BYTES (independent of dungeon corpses).
local function fitMerchants(d)
  while counts.mbytes > MERCHANT_BYTES and #d.morder > 1 do
    local npc = table.remove(d.morder, 1)
    counts.mbytes = counts.mbytes - size("merchant", npc, d.merchants[npc])
    d.merchants[npc] = nil
    seenMerchant[npc] = nil
  end
end

-- The oldest trainers go while trainers are past TRAINER_BYTES (independent of dungeon corpses).
local function fitTrainers(d)
  while counts.tbytes > TRAINER_BYTES and #d.torder > 1 do
    local npc = table.remove(d.torder, 1)
    counts.tbytes = counts.tbytes - size("trainer", npc, d.trainers[npc])
    d.trainers[npc] = nil
    seenTrainer[npc] = nil
  end
end

-- The oldest outdoor loot counters go while oloot is past OLOOT_BYTES (independent of dungeon corpses).
local function fitOloot(d)
  while counts.obytes > OLOOT_BYTES and #d.oorder > 1 do
    local key = table.remove(d.oorder, 1)
    counts.obytes = counts.obytes - size("oloot", key, d.oloot[key])
    d.oloot[key] = nil
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
  fitMerchants(d)
  fitTrainers(d)
  fitOloot(d)
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
  fitMerchants(d)
  fitTrainers(d)
  fitOloot(d)
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
  if not text(guid) then return nil end
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

local itemClassCache = {}
local function itemClass(itemId)
  if itemClassCache[itemId] == nil then
    local I = _G.C_Item
    local fn = (I and I.GetItemInfoInstant) or _G.GetItemInfoInstant
    local _, _, _, _, _, classID = call(fn, itemId)
    itemClassCache[itemId] = usable(classID) and tonumber(classID) or false
  end
  return itemClassCache[itemId]
end

local function isRareTarget(srcGuid)
  if not text(srcGuid) then return false end
  local tg = call(_G.UnitGUID, "target")
  if not (text(tg) and tg == srcGuid) then return false end
  local cls = call(_G.UnitClassification, "target")
  return text(cls) and RARE_CLASS[cls] == true or false
end

-- Easy-to-widen outdoor drop filter: quest items, rare/rareelite/worldboss uncommon+, blue+, or recipes (classID == 9).
local function keepOutdoorSlot(srcGuid, itemId, quality, isQuestItem)
  if not itemId or itemId <= 0 or itemId >= 10000000 then return false end
  if isQuestItem == true then return true end
  if quality >= 3 then return true end
  if quality >= 2 and isRareTarget(srcGuid) then return true end
  if itemClass(itemId) == 9 then return true end
  return false
end

-- GetLootSourceInfo's (guid, quantity) pairs for a slot, filtered per source for outdoor loot.
local function sourcesFilter(acc, id, qty, quality, quest, ...)
  local any = false
  for i = 1, select("#", ...), 2 do
    local guid, q = select(i, ...)
    if text(guid) then
      local keptId = (id and keepOutdoorSlot(guid, id, quality, quest)) and id or nil
      add(acc, guid, keptId, usable(q) and tonumber(q) or qty, quest)
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

-- Bounded outdoor drops: "k:src>item" = "n;q", independent MAX_OLOOT / OLOOT_BYTES ring.
local function recordOloot(d, kind, srcId, c)
  for _, itemId in ipairs(c.order) do
    local key = kind .. ":" .. srcId .. ">" .. itemId
    local oldVal = d.oloot[key]
    local prevN, prevQ = 0, 0
    if type(oldVal) == "string" then
      local nStr, qStr = oldVal:match("^(%d+);([01])$")
      prevN, prevQ = tonumber(nStr) or 0, tonumber(qStr) or 0
    end
    local nextN = prevN + 1
    local nextQ = (prevQ == 1 or c.quest[itemId]) and 1 or 0
    local newVal = nextN .. ";" .. nextQ
    if oldVal == nil then
      while #d.oorder >= MAX_OLOOT do
        local oldKey = table.remove(d.oorder, 1)
        local removed = d.oloot[oldKey]
        if removed ~= nil then counts.obytes = counts.obytes - size("oloot", oldKey, removed) end
        d.oloot[oldKey] = nil
      end
      d.oorder[#d.oorder + 1] = key
    else
      counts.obytes = counts.obytes - size("oloot", key, oldVal)
    end
    d.oloot[key] = newVal
    counts.obytes = counts.obytes + size("oloot", key, newVal)
  end
  fitOloot(d)
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
  if not (ns.Capture.On() and inForever()) or gathered or call(_G.IsFishingLoot) then return end
  local inst, itype, iname = where()
  local outdoor = not inst and not call(_G.IsInInstance)
  if not inst and not outdoor then return end
  local n = call(_G.GetNumLootItems)
  n = usable(n) and tonumber(n) or 0
  local acc, sourced, rawSlots = {}, false, nil
  for slot = 1, n do
    local _, _, qty, _, quality, _, isQuest = call(_G.GetLootSlotInfo, slot)
    local id = itemOf(call(_G.GetLootSlotLink, slot))
    quality = usable(quality) and tonumber(quality) or 0
    local quest = usable(isQuest) and isQuest and true or false
    qty = usable(qty) and tonumber(qty) or 1
    local slotSourced
    if inst then
      local keptId = (id and (quest or quality >= 2)) and id or nil   -- grey and white loot: the corpse counts, not the item
      slotSourced = sources(acc, keptId, qty, quest, call(_G.GetLootSourceInfo, slot))
    else
      slotSourced = sourcesFilter(acc, id, qty, quality, quest, call(_G.GetLootSourceInfo, slot))
    end
    if slotSourced then
      sourced = true
    elseif id then
      rawSlots = rawSlots or {}
      rawSlots[#rawSlots + 1] = { id, qty, quality, quest }
    end
  end
  -- No source from the client: the dead NPC being looted (a chest can't be told).
  if not sourced then
    local guid = lootedUnit()
    if not guid then return end
    add(acc, guid)
    for _, it in ipairs(rawSlots or {}) do
      local id, qty, quality, quest = it[1], it[2], it[3], it[4]
      if inst then
        if quest or quality >= 2 then add(acc, guid, id, qty, quest) end
      elseif keepOutdoorSlot(guid, id, quality, quest) then
        add(acc, guid, id, qty, quest)
      end
    end
  end
  local d
  for guid, c in pairs(acc) do
    local kind, id = source(guid)
    if kind and not (kind == "n" and alive(guid)) then   -- a chest under soft-interact is never "dead"
      local h = ns.Capture.Hash(guid)
      local old = db()
      local already = seen[h] or (inst and old and old.corpses and old.corpses[h])
      if not already then
        if seenCount >= MAX_SEEN then seen, seenCount = {}, 0 end
        seen[h], seenCount = true, seenCount + 1
        if inst then
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
        elseif c.order[1] then
          d = d or make()
          recordOloot(d, kind, id, c)
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

-- Vendors -----------------------------------------------------------------------------------------------------------------

local pendingMerchant   -- npcId awaiting a single MERCHANT_UPDATE retry when GetMerchantItemLink was nil on cold cache

local function parseMerchant(s)
  local out = {}
  if type(s) ~= "string" then return out end
  local body = s:match("^[01];(.*)$")
  if not body then return out end
  for entry in body:gmatch("[^,]+") do
    local id, qty, flags = entry:match("^(%d+)%*(%d+)%*([le]*)$")
    id, qty = tonumber(id), tonumber(qty)
    if id and id > 0 and id < 10000000 and qty and qty >= 1 then
      local prev = out[id]
      local lim = flags:find("l", 1, true) and 1 or 0
      local alt = flags:find("e", 1, true) and 1 or 0
      if prev then
        if qty > prev.qty then prev.qty = qty end
        if lim == 1 then prev.lim = 1 end
        if alt == 1 then prev.alt = 1 end
      else
        out[id] = { qty = qty, lim = lim, alt = alt }
      end
    end
  end
  return out
end

local function formatMerchant(repair, items)
  local ids = {}
  for id in pairs(items) do ids[#ids + 1] = id end
  table.sort(ids)
  local parts = {}
  for i = 1, #ids do
    local id = ids[i]
    local it = items[id]
    local f = (it.lim == 1 and "l" or "") .. (it.alt == 1 and "e" or "")
    parts[i] = id .. "*" .. it.qty .. "*" .. f
  end
  return repair .. ";" .. table.concat(parts, ",")
end

local function merchantItem(i)
  local qty, numAvailable, extendedCost
  local M = _G.C_MerchantFrame
  local info = M and call(M.GetItemInfo, i)
  if type(info) == "table" then
    qty = info.stackCount
    numAvailable = info.numAvailable
    extendedCost = info.hasExtendedCost
    if extendedCost == nil then extendedCost = info.extendedCost end
  elseif _G.GetMerchantItemInfo then
    local _, _, _, d, e, _, g, h = call(_G.GetMerchantItemInfo, i)
    -- 8+ values: extendedCost is slot 8 (h); 7-value Classic: extendedCost is slot 7 (g) and h is nil.
    qty, numAvailable = d, e
    if h ~= nil then extendedCost = h else extendedCost = g end
  end
  if not (usable(extendedCost) and extendedCost and extendedCost ~= 0) then
    local costItems = call(_G.GetMerchantItemCostInfo, i)
    if usable(costItems) and type(costItems) == "number" and costItems > 0 then
      extendedCost = true
    end
  end
  qty = math.max(1, math.floor(usable(qty) and tonumber(qty) or 1))
  local lim = (usable(numAvailable) and type(numAvailable) == "number" and numAvailable >= 0) and 1 or 0
  local alt = (usable(extendedCost) and extendedCost and extendedCost ~= 0) and 1 or 0
  return qty, lim, alt
end

local function captureMerchant(isUpdate)
  if not (ns.Capture.On() and inForever()) or call(_G.UnitIsPlayer, "npc") then
    pendingMerchant = nil
    return
  end
  local kind, npcId = source(call(_G.UnitGUID, "npc"))
  if kind ~= "n" then
    if not isUpdate then pendingMerchant = nil end
    return
  end
  if isUpdate then
    if pendingMerchant ~= npcId then return end
    pendingMerchant = nil
  else
    pendingMerchant = nil
  end
  local n = call(_G.GetMerchantNumItems)
  n = usable(n) and tonumber(n) or 0
  if n < 0 then n = 0 end
  local observed, missingLink = {}, false
  local limit = math.min(n, MAX_MERCHANT_ITEMS)
  for i = 1, limit do
    local itemId = itemOf(call(_G.GetMerchantItemLink, i))
    if not itemId or itemId <= 0 or itemId >= 10000000 then
      missingLink = true
    else
      local qty, lim, alt = merchantItem(i)
      local prev = observed[itemId]
      if prev then
        if qty > prev.qty then prev.qty = qty end
        if lim == 1 then prev.lim = 1 end
        if alt == 1 then prev.alt = 1 end
      else
        observed[itemId] = { qty = qty, lim = lim, alt = alt }
      end
    end
  end
  if not isUpdate and (missingLink or n == 0) then pendingMerchant = npcId end
  if next(observed) == nil then return end
  local merged, mergedCount = {}, 0
  local obsIds = {}
  for id in pairs(observed) do obsIds[#obsIds + 1] = id end
  table.sort(obsIds)
  for _, id in ipairs(obsIds) do
    merged[id] = observed[id]
    mergedCount = mergedCount + 1
  end
  local existingDb = db()
  local existingStr = existingDb and existingDb.merchants and existingDb.merchants[npcId]
  if type(existingStr) == "string" then
    local oldItems = parseMerchant(existingStr)
    local oldIds = {}
    for id in pairs(oldItems) do oldIds[#oldIds + 1] = id end
    table.sort(oldIds)
    for _, id in ipairs(oldIds) do
      local oldIt = oldItems[id]
      local cur = merged[id]
      if cur then
        if oldIt.qty > cur.qty then cur.qty = oldIt.qty end
        if oldIt.lim == 1 then cur.lim = 1 end
        if oldIt.alt == 1 then cur.alt = 1 end
      elseif mergedCount < MAX_MERCHANT_ITEMS then
        merged[id] = oldIt
        mergedCount = mergedCount + 1
      end
    end
  end
  if mergedCount == 0 then return end
  local canRepair = call(_G.CanMerchantRepair)
  local repair = (usable(canRepair) and canRepair and canRepair ~= 0) and 1 or 0
  local serialized = formatMerchant(repair, merged)
  if seenMerchant[npcId] == serialized then return end
  local d = make()
  if d.merchants[npcId] == serialized then
    seenMerchant[npcId] = serialized
    return
  end
  local old = d.merchants[npcId]
  if old == nil then
    while #d.morder >= MAX_MERCHANTS do
      local oldNpc = table.remove(d.morder, 1)
      local oldVal = d.merchants[oldNpc]
      if oldVal ~= nil then counts.mbytes = counts.mbytes - size("merchant", oldNpc, oldVal) end
      d.merchants[oldNpc] = nil
      seenMerchant[oldNpc] = nil
    end
    d.morder[#d.morder + 1] = npcId
  else
    counts.mbytes = counts.mbytes - size("merchant", npcId, old)
  end
  d.merchants[npcId] = serialized
  counts.mbytes = counts.mbytes + size("merchant", npcId, serialized)
  fitMerchants(d)
  if d.merchants[npcId] == serialized then seenMerchant[npcId] = serialized end
end

-- Trainers -----------------------------------------------------------------------------------------------------------------

local function parseTrainer(s)
  if type(s) ~= "string" then return "c", {} end
  local kind, body = s:match("^([cp]);(.*)$")
  if not kind then return "c", {} end
  local out = {}
  for entry in body:gmatch("[^|]+") do
    local sid, name, rank, cat, lvl, skill, sreq, reqsStr, cost =
      entry:match("^(%d+)~([^~]*)~([^~]*)~([^~]*)~(%d+)~([^~]*)~(%d+)~([^~]*)~(%d+)$")
    if sid then
      local reqs, seenReq = {}, {}
      for r in reqsStr:gmatch("[^^]+") do
        if #reqs >= 5 then break end
        if r ~= "" and not seenReq[r] then
          seenReq[r] = true
          reqs[#reqs + 1] = r
        end
      end
      local svc = {
        id = tonumber(sid) or 0,
        name = name,
        rank = rank,
        cat = cat,
        lvl = tonumber(lvl) or 0,
        skill = skill,
        sreq = tonumber(sreq) or 0,
        reqs = reqs,
        cost = tonumber(cost) or 0,
      }
      local key = (svc.id > 0 and tostring(svc.id) or svc.name:lower()) .. "\0" .. svc.rank:lower()
      out[key] = svc
    end
  end
  return kind, out
end

local function mergeTrainerService(dst, src)
  if dst.name == "" and src.name ~= "" then dst.name = src.name end
  if dst.rank == "" and src.rank ~= "" then dst.rank = src.rank end
  if dst.cat == "" and src.cat ~= "" then dst.cat = src.cat end
  if src.lvl > dst.lvl then dst.lvl = src.lvl end
  if dst.skill == "" and src.skill ~= "" then dst.skill = src.skill end
  if src.sreq > dst.sreq then dst.sreq = src.sreq end
  local have = {}
  for _, r in ipairs(dst.reqs) do have[r] = true end
  for _, r in ipairs(src.reqs) do
    if #dst.reqs >= 5 then break end
    if not have[r] then
      have[r] = true
      dst.reqs[#dst.reqs + 1] = r
    end
  end
  if src.cost > dst.cost then dst.cost = src.cost end
end

local function formatTrainer(kind, map)
  local list = {}
  for _, svc in pairs(map) do list[#list + 1] = svc end
  table.sort(list, function(a, b)
    if a.id ~= b.id then return a.id < b.id end
    local an, bn = a.name:lower(), b.name:lower()
    if an ~= bn then return an < bn end
    return a.rank:lower() < b.rank:lower()
  end)
  local parts = {}
  for i = 1, math.min(#list, MAX_TRAINER_SERVICES) do
    local s = list[i]
    parts[i] = table.concat({
      s.id, s.name, s.rank, s.cat, s.lvl, s.skill, s.sreq, table.concat(s.reqs, "^"), s.cost,
    }, "~")
  end
  return kind .. ";" .. table.concat(parts, "|")
end

local function trainerIdProbe(i)
  local T = _G.C_TooltipInfo
  local tip = T and call(T.GetTrainerService, i)
  local id = type(tip) == "table" and usable(tip.id) and tonumber(tip.id) or nil
  if not (id and id > 0 and id < 10000000) then
    local sl = call(_G.GetTrainerServiceSpellLink, i)
    id = text(sl) and tonumber(sl:match("|Hspell:(%d+)") or sl:match("^spell:(%d+)")) or nil
  end
  if not (id and id > 0 and id < 10000000) then
    local il = call(_G.GetTrainerServiceItemLink, i)
    id = text(il) and tonumber(il:match("|Hitem:(%d+)") or il:match("^item:(%d+)")) or nil
  end
  return (id and id > 0 and id < 10000000) and math.floor(id) or 0
end

local function trainerKind()
  local CT = _G.C_Trainer
  local ttype = CT and call(CT.GetTrainerType)
  local E = _G.Enum and _G.Enum.TrainerType
  if usable(ttype) then
    if (E and E.Pet ~= nil and ttype == E.Pet) or (type(ttype) == "string" and ttype:lower() == "pet") then
      return nil
    end
    local ts = (E and ((E.Tradeskills ~= nil and ttype == E.Tradeskills)
      or (E.Tradeskill ~= nil and ttype == E.Tradeskill)))
      or (type(ttype) == "string" and (ttype:lower() == "tradeskills" or ttype:lower() == "tradeskill"))
    if ts then return "p" end
  end
  local isTS = call(_G.IsTradeskillTrainer)
  if usable(isTS) and isTS and isTS ~= 0 then return "p" end
  return "c"
end

local function captureTrainer()
  if not (ns.Capture.On() and inForever()) or call(_G.UnitIsPlayer, "npc") then return end
  local guidKind, npcId = source(call(_G.UnitGUID, "npc"))
  if guidKind ~= "n" then return end
  local kind = trainerKind()
  if not kind then return end
  local n = call(_G.GetNumTrainerServices)
  n = usable(n) and tonumber(n) or 0
  if n <= 0 then return end
  local existingDb = db()
  local probedApi = existingDb and type(existingDb.trainerApi) == "table" and true or false
  local stepIdx = call(_G.GetTrainerServiceStepIndex)
  stepIdx = usable(stepIdx) and tonumber(stepIdx) or nil
  local isEn = ENGLISH[call(_G.GetLocale) or ""]
  local observed, obsCount = {}, 0
  for i = 1, n do
    if i ~= stepIdx then
      if obsCount >= MAX_TRAINER_SERVICES then break end
      local serviceName, serviceType, _, reqLevel, serviceSubText, category = call(_G.GetTrainerServiceInfo, i)
      -- Drop serviceType completely (never store character availability state).
      if not (usable(serviceType) and serviceType == "header") then
        if not probedApi then
          -- One-time per-install SV diagnostic (never uploaded) on the first real non-step, non-header service.
          probedApi = true
          local sl = call(_G.GetTrainerServiceSpellLink, i)
          local il = call(_G.GetTrainerServiceItemLink, i)
          local T = _G.C_TooltipInfo
          local tt = T and call(T.GetTrainerService, i)
          local ttid = type(tt) == "table" and tt.id or nil
          local d = make()
          d.trainerApi = { spellLink = type(sl), itemLink = type(il), tipId = type(ttid) }
          existingDb = d
        end
        local sid = trainerIdProbe(i)
        local name = isEn and trainerText(serviceName, 60) or ""
        if sid > 0 or (text(serviceName) and name ~= "") then
          local rank = isEn and trainerText(serviceSubText, 40) or ""
          local cat = isEn and trainerText(category, 40) or ""
          local lvl = math.max(0, math.min(100, math.floor(usable(reqLevel) and tonumber(reqLevel) or 0)))
          local skillRaw, sreqRaw = call(_G.GetTrainerServiceSkillReq, i)
          local skill = isEn and trainerText(skillRaw, 40) or ""
          local sreq = math.max(0, math.min(500, math.floor(usable(sreqRaw) and tonumber(sreqRaw) or 0)))
          local numAbil = call(_G.GetTrainerServiceNumAbilityReq, i)
          numAbil = math.min(5, math.max(0, math.floor(usable(numAbil) and tonumber(numAbil) or 0)))
          local reqs, seenReq = {}, {}
          for k = 1, numAbil do
            local abil = call(_G.GetTrainerServiceAbilityReq, i, k)
            local clean = isEn and trainerText(abil, 60) or ""
            if clean ~= "" and not seenReq[clean] then
              seenReq[clean] = true
              reqs[#reqs + 1] = clean
            end
          end
          local costRaw, isProf = call(_G.GetTrainerServiceCost, i)
          local cost = math.max(0, math.min(100000000, math.floor(usable(costRaw) and tonumber(costRaw) or 0)))
          if usable(isProf) and isProf and isProf ~= 0 then kind = "p" end
          local svc = {
            id = sid, name = name, rank = rank, cat = cat, lvl = lvl,
            skill = skill, sreq = sreq, reqs = reqs, cost = cost,
          }
          local key = (sid > 0 and tostring(sid) or name:lower()) .. "\0" .. rank:lower()
          if observed[key] then
            mergeTrainerService(observed[key], svc)
          else
            observed[key] = svc
            obsCount = obsCount + 1
          end
        end
      end
    end
  end
  if obsCount == 0 then return end
  local merged, mergedCount = {}, 0
  for key, svc in pairs(observed) do
    merged[key] = svc
    mergedCount = mergedCount + 1
  end
  local existingStr = existingDb and existingDb.trainers and existingDb.trainers[npcId]
  if type(existingStr) == "string" then
    local oldKind, oldMap = parseTrainer(existingStr)
    if oldKind == "p" then kind = "p" end
    local oldKeys = {}
    for k in pairs(oldMap) do oldKeys[#oldKeys + 1] = k end
    table.sort(oldKeys)
    for _, k in ipairs(oldKeys) do
      local oldSvc = oldMap[k]
      if merged[k] then
        mergeTrainerService(merged[k], oldSvc)
      elseif mergedCount < MAX_TRAINER_SERVICES then
        merged[k] = oldSvc
        mergedCount = mergedCount + 1
      end
    end
  end
  local serialized = formatTrainer(kind, merged)
  if seenTrainer[npcId] == serialized then return end
  local d = make()
  if d.trainers[npcId] == serialized then
    seenTrainer[npcId] = serialized
    return
  end
  local old = d.trainers[npcId]
  if old == nil then
    while #d.torder >= MAX_TRAINERS do
      local oldNpc = table.remove(d.torder, 1)
      local oldVal = d.trainers[oldNpc]
      if oldVal ~= nil then counts.tbytes = counts.tbytes - size("trainer", oldNpc, oldVal) end
      d.trainers[oldNpc] = nil
      seenTrainer[oldNpc] = nil
    end
    d.torder[#d.torder + 1] = npcId
  else
    counts.tbytes = counts.tbytes - size("trainer", npcId, old)
  end
  d.trainers[npcId] = serialized
  counts.tbytes = counts.tbytes + size("trainer", npcId, serialized)
  fitTrainers(d)
  if d.trainers[npcId] == serialized then seenTrainer[npcId] = serialized end
end

-- What the table holds and what loot windows cost this session on this client, for /lore qa (SelfTest.lua): nil when
-- nothing is kept yet.
local spent = { n = 0, ms = 0, max = 0 }
function World.Stats()
  local d = db()
  if not d then return nil end
  return { corpses = count(type(d.corpses) == "table" and d.corpses or {}),
    kills = count(type(d.kills) == "table" and d.kills or {}), rolls = count(type(d.rolls) == "table" and d.rolls or {}),
    merchants = count(type(d.merchants) == "table" and d.merchants or {}),
    trainers = count(type(d.trainers) == "table" and d.trainers or {}),
    oloot = count(type(d.oloot) == "table" and d.oloot or {}),
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
  MERCHANT_SHOW = function() captureMerchant(false) end,
  MERCHANT_UPDATE = function() captureMerchant(true) end,
  MERCHANT_CLOSED = function() pendingMerchant = nil end,
  TRAINER_SHOW = captureTrainer,
}
local frame = CreateFrame("Frame")
World.frame = frame
for event in pairs(handlers) do
  -- Your own casts only (the client filters them), where it can; else every unit's, and onCast keeps yours. A client
  -- whose RegisterUnitEvent is missing, throws or doesn't say it registered gets the plain one.
  local unitOnly = false
  if event == "UNIT_SPELLCAST_SUCCEEDED" and frame.RegisterUnitEvent then
    local ok, registered = pcall(frame.RegisterUnitEvent, frame, event, "player")
    unitOnly = ok and registered == true
  end
  if not unitOnly then pcall(frame.RegisterEvent, frame, event) end
end
-- One listener for the game's kill and loot events (the Architect, 11/19): other parts of the add-on that act on them
-- (the Dungeon Guide's kill pages, Strip.lua) add theirs here rather than a frame of their own. Each is called after
-- login, after this file's own handler, whatever this file keeps (Capture.On), and decides for itself whether to act.
local listeners = {}
function World.Listen(event, fn)
  if type(event) ~= "string" or type(fn) ~= "function" then return end
  if not listeners[event] then
    listeners[event] = {}
    if not handlers[event] then pcall(frame.RegisterEvent, frame, event) end
  end
  local l = listeners[event]
  l[#l + 1] = fn
end
frame:SetScript("OnEvent", function(_, event, ...)
  if not (type(LoreForeverDB) == "table" and LoreForeverDB.capture) then return end   -- before login (Capture.Init)
  if handlers[event] then ns.Guard(handlers[event], ...) end
  local l = listeners[event]
  if l then
    for i = 1, #l do ns.Guard(l[i], ...) end
  end
end)
