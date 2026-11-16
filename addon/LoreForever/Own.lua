-- What they carry, wear and have on cooldown, live, for Willo (LOR-1516). The add-on's save (Stock.lua) reaches the disk
-- only at login, /reload or logout, so "how many do I have?" after looting, "what am I holding?" after a swap and "how
-- long until my Hearthstone is ready?" had nothing current to go on: one player had about nine of her answers about
-- their own things wrong in one evening (11/13). While the sky is up for an ask (Strip.Asking), its outer ring carries
-- these pages, taking turns with the purse and the spot (Strip.lua ringFor), only to a Willo that says she reads them
-- (LoreForeverJourneyData.skyOwn): an older one takes an unknown page as an answer gone. Kind 3, low bits after NPC
-- talk's 8-23:
--   27 the header, first at each ask: byte 1 how many item cooldowns are running (at most 255), byte 2 how many slots
--      changed since the save, bytes 3-4 how many kinds of item in the bags changed since the save. Willo knows what she
--      read at that ask is whole when she has read that many of each.
--   26 "ready": 32 bits, the item id (20 bits) and its time left in 10 s steps, rounded up (12 bits; 4095 that or more):
--      every item in the bags or worn whose own cooldown is running.
--   25 "worn": 32 bits, the slot (5 bits, 1-19), the item id (20 bits; 0 the slot is empty), 7 bits 0: every slot that
--      changed since the save.
--   24 "bag": 32 bits, the item id (20 bits) and how many they carry now (12 bits; 4095 that or more, 0 none left): every
--      kind whose count changed since the save, those not carried since their last change first, then the newest.
-- "The save" is what Stock.Take read at login or the /reload (Own.Baseline), which is what Willo's copy of the save
-- holds. Ids that don't fit 20 bits (none today: Forever's highest is 289560) aren't sent. Only numbers leave the game.

local _, ns = ...
local Own = {}
ns.Own = Own

local ID_MAX, COUNT_MAX, STEPS_MAX = 0xFFFFF, 0xFFF, 0xFFF
local GCD = 1.5   -- seconds: a cooldown this short is the global one, not the item's own

local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local r = { pcall(fn, ...) }
  if r[1] then return unpack(r, 2) end
end
local function now() return (GetTime and GetTime()) or 0 end

local base = nil          -- the save: { bags = { [id] = count }, gear = { [slot] = id } }, nil until Stock.Take
local bagsSeen = {}       -- the last count of the bags, { [id] = count }
local changedAt = {}      -- { [id] = GetTime() } of each kind's last change since the save
local carried = {}        -- { [id] = changedAt[id] } as last carried round the ring
local queue, pos = nil, 0 -- this ask's pages and the place of the one up now

-- Whether the Willo on this PC reads these pages (LoreForeverJourneyData.skyOwn, written by Willo).
function Own.FromWillo()
  local data = ns.Strip and ns.Strip.FromWilloLately and ns.Strip.FromWilloLately()
  return type(data) == "table" and data.skyOwn == true
end

-- Every item in the bags, { [id] = count }, as Stock.lua counts them: all bags, stacks added up.
local function bagCounts()
  local out, CC = {}, _G.C_Container
  for bag = 0, (NUM_BAG_SLOTS or 4) do
    for slot = 1, (CC and try(CC.GetContainerNumSlots, bag)) or try(GetContainerNumSlots, bag) or 0 do
      local info = CC and try(CC.GetContainerItemInfo, bag, slot)
      local id = type(info) == "table" and tonumber(info.itemID)
      if id and id > 0 then out[id] = (out[id] or 0) + (tonumber(info.stackCount) or 1) end
    end
  end
  return out
end
local function worn()
  local out = {}
  for slot = 1, 19 do out[slot] = tonumber((try(GetInventoryItemID, "player", slot))) or 0 end
  return out
end

-- The save Willo holds, as Stock.Take has just read it at login or a /reload (stock: char.stock): changes count from
-- here.
function Own.Baseline(stock)
  local bags, gear = {}, {}
  if type(stock) == "table" then
    for id, v in pairs(type(stock.bags) == "table" and stock.bags or {}) do
      if tonumber(id) and type(v) == "table" then bags[tonumber(id)] = tonumber(v[1]) or 0 end
    end
    for slot = 1, 19 do
      local v = type(stock.gear) == "table" and stock.gear[slot]
      gear[slot] = type(v) == "table" and tonumber(v[1]) or 0
    end
  end
  base, changedAt, carried, queue, pos = { bags = bags, gear = gear }, {}, {}, nil, 0
  bagsSeen = bagCounts()
  local t = now()
  for id, n in pairs(bagsSeen) do if n ~= (bags[id] or 0) then changedAt[id] = t end end
  for id in pairs(bags) do if not bagsSeen[id] then changedAt[id] = t end end
end

-- Which kinds changed since the last look, and when: at each press of the talk key (Own.Start), no event.
function Own.BagsChanged()
  if not base then return end
  local seen, t = bagCounts(), now()
  for id, n in pairs(seen) do if n ~= bagsSeen[id] then changedAt[id] = t end end
  for id in pairs(bagsSeen) do if not seen[id] then changedAt[id] = t end end
  bagsSeen = seen
end

local function page(low, v)
  return { 0xC0 + low, math.floor(v / 16777216) % 256, math.floor(v / 65536) % 256, math.floor(v / 256) % 256, v % 256 }
end

-- An item's own cooldown left in seconds, or nil when none runs. C_Container.GetItemCooldown: the plain
-- GetItemCooldown is missing in Forever (the QA Lead's 11/9 probe), kept only as the fallback.
local function itemLeft(id, slot)
  local start, duration
  if slot then start, duration = try(GetInventoryItemCooldown, "player", slot) end
  if not (tonumber(start) and tonumber(duration)) then
    local CC = _G.C_Container
    start, duration = try(CC and CC.GetItemCooldown, id)
    if not (tonumber(start) and tonumber(duration)) then start, duration = try(_G.GetItemCooldown, id) end
  end
  start, duration = tonumber(start), tonumber(duration)
  if not (start and duration) or start <= 0 or duration <= GCD then return nil end
  local left = start + duration - now()
  return left > 0 and left or nil
end
local function readyPage(id, left) return page(26, id * 4096 + math.min(STEPS_MAX, math.ceil(left / 10))) end

-- Every item they carry or wear whose own cooldown runs now, { [id] = seconds left }: the save keeps when each is ready
-- (Stock.lua), so a question typed after they quit still has the Hearthstone (the whole-path run, 11/15).
function Own.Running()
  local out, gear = {}, worn()
  for slot = 1, 19 do
    local id = gear[slot]
    if id > 0 and not out[id] then out[id] = itemLeft(id, slot) end
  end
  for id in pairs(bagCounts()) do
    if not out[id] then out[id] = itemLeft(id) end
  end
  return out
end

-- A new ask: its pages in order, the header, then cooldowns, slots and bags. None before there's a save to compare to.
function Own.Start()
  queue, pos = nil, 0
  if not base then return end
  Own.BagsChanged()
  local ready, slots, kinds, seen = {}, {}, {}, {}
  local gear = worn()
  for slot = 1, 19 do
    local id = gear[slot]
    if id > 0 and id <= ID_MAX and not seen[id] then
      seen[id] = true
      local left = itemLeft(id, slot)
      if left then ready[#ready + 1] = readyPage(id, left) end
    end
    if id ~= (base.gear[slot] or 0) and id <= ID_MAX then slots[#slots + 1] = page(25, slot * 134217728 + id * 128) end
  end
  for id in pairs(bagsSeen) do
    if not seen[id] and id <= ID_MAX then
      seen[id] = true
      local left = itemLeft(id)
      if left then ready[#ready + 1] = readyPage(id, left) end
    end
  end
  for id, at in pairs(changedAt) do if id <= ID_MAX then kinds[#kinds + 1] = { id, at } end end
  table.sort(kinds, function(a, b)
    local fresh_a, fresh_b = carried[a[1]] ~= a[2], carried[b[1]] ~= b[2]
    if fresh_a ~= fresh_b then return fresh_a end
    if a[2] ~= b[2] then return a[2] > b[2] end
    return a[1] < b[1]
  end)
  while #ready > 255 do table.remove(ready) end
  queue = { { page = page(27, #ready * 16777216 + math.min(255, #slots) * 65536 + math.min(65535, #kinds)) } }
  for _, p in ipairs(ready) do queue[#queue + 1] = { page = p } end
  for _, p in ipairs(slots) do queue[#queue + 1] = { page = p } end
  for _, k in ipairs(kinds) do
    queue[#queue + 1] = { page = page(24, k[1] * 4096 + math.min(COUNT_MAX, bagsSeen[k[1]] or 0)), kind = k }
  end
end

-- The next page of this ask, or nil when it has none left. The one before has been up its time: a bag page counts as
-- carried then, so the next ask starts with what hasn't been.
function Own.Next()
  if not queue then return nil end
  local done = queue[pos]
  if done and done.kind then carried[done.kind[1]] = done.kind[2] end
  pos = pos + 1
  local item = queue[pos]
  if not item then queue = nil; return nil end
  local p = item.page
  return { p[1], p[2], p[3], p[4], p[5] }
end

-- Whether this ask still has pages to carry.
function Own.Pending() return queue ~= nil end
