-- The bosses down this run, at each ask (LOR-1468 P4c; ~/handoffs/dungeon-guide-p4-build-plan-2026-11-19.md P4c r2; the
-- Architect's conditions, ~/handoffs/plan-review-dungeon-p4c-r2-2026-11-19.md), so "what's the next boss?" is answered
-- from what the game reported, never guessed. While the sky is up for an ask inside a dungeon or raid (Strip.Asking), its
-- ring carries these pages before the ask's own (Own.lua), only to a Willo that says she reads them
-- (LoreForeverJourneyData.skyDown): an older one takes an unknown page as an answer gone. No sky show of their own.
-- Kind 3, low bits 29, 32 bits:
--   the header, first: bit 31 set, bit 24 whether what's down is known, the low byte how many encounter pages follow.
--   then one page per encounter down (bit 31 clear): its encounter id (ENCOUNTER_END's, 24 bits), the newest last, at
--   most MAX of them.
-- Known when the add-on can vouch for what's next: it saw the run from its start (they came in alone, from outside,
-- with no login or /reload since they were last in an instance, and, in a raid, no lockout with a boss down), or it
-- saw a kill since (the next boss is then the first after the last one down; ones before it are said as passed).
-- Unsure, until the next kill they see: entering with a group (it may have started without them), coming back in from
-- outside (a corpse run, a reset they didn't see), after a login or /reload, a kill in an instance it didn't see them
-- enter, or an encounter already down ending again (a new run). The Architect's hold on #4824, item 1.
-- A run ends when they enter another instance or when the game says an instance was reset.
-- Kept in memory only. Nothing about another player: only encounter ids leave the game.

local _, ns = ...
local Down = {}
ns.Down = Down

local MAX = 8
local run = { inst = nil, known = false, kills = {} }   -- this run: the instance's map id, known, encounter ids in order
local blind = true                                       -- logged in or reloaded since they were last in an instance
local queue, pos = nil, 0                                 -- this ask's pages and the place of the one up now

local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local r = { pcall(fn, ...) }
  if r[1] then return unpack(r, 2) end
end

local function page(v)
  return { 0xC0 + 29, math.floor(v / 16777216) % 256, math.floor(v / 65536) % 256, math.floor(v / 256) % 256, v % 256 }
end

-- The dungeon or raid they're in: its map id and kind ("party" or "raid"), else nil.
local function here()
  local inInst, kind = try(IsInInstance)
  if not (inInst and (kind == "party" or kind == "raid")) then return nil end
  local info = { try(GetInstanceInfo) }
  local inst = tonumber(info[8])
  return inst, kind, info[1]
end

-- A raid lockout for this instance with a boss already down (a run that began before this one was seen).
local function lockedWithKills(name)
  local n = tonumber(try(GetNumSavedInstances)) or 0
  for i = 1, n do
    local saved = { try(GetSavedInstanceInfo, i) }
    -- name, id, reset, difficulty, locked, extended, idMostSig, isRaid, maxPlayers, difficultyName, numEncounters,
    -- encounterProgress
    if saved[1] == name and saved[5] and (tonumber(saved[12]) or 0) > 0 then return true end
  end
  return false
end

function Down.FromWillo()
  local data = ns.Strip and ns.Strip.FromWilloLately and ns.Strip.FromWilloLately()
  return type(data) == "table" and data.skyDown == true
end

local function fresh(inst, known)
  run = { inst = inst, known = known, kills = {} }
end

local function grouped()
  local inGroup = try(IsInGroup)
  if inGroup ~= nil then return inGroup and true or false end
  return (tonumber(try(GetNumGroupMembers)) or 0) > 0
end

local handlers = {
  PLAYER_ENTERING_WORLD = function(isLogin, isReload)
    local inst, kind, name = here()
    if not inst then                                      -- outside (a corpse run keeps the run's kills)
      if isLogin or isReload then blind = true end
      return
    end
    if isLogin or isReload then blind = false; return fresh(inst, false) end
    if inst ~= run.inst then
      fresh(inst, not blind and not grouped() and not (kind == "raid" and lockedWithKills(name)))
    else
      run.known = false                                   -- back in from outside: kills may have happened meanwhile
    end
    blind = false
  end,
  ENCOUNTER_END = function(encounter, _, _, _, success)
    local id = ns.Context.Usable(encounter) and tonumber(encounter)
    if not ((success == 1 or success == true) and id and id > 0 and id <= 0xFFFFFF) then return end
    local inst = here()
    if not inst then return end
    if inst ~= run.inst then fresh(inst, false) end       -- a kill in an instance it never saw them enter
    local again = false
    for _, k in ipairs(run.kills) do
      if k == id then again = true; break end
    end
    if again then fresh(inst, false) end                  -- down already: a new run, unsure until the next kill
    run.kills[#run.kills + 1] = id
    if not again then run.known = true end                -- seen: the next is the first after this one
  end,
  CHAT_MSG_SYSTEM = function(msg)
    local fmt = _G.INSTANCE_RESET_SUCCESS
    if type(msg) ~= "string" or not ns.Context.Usable(msg) or type(fmt) ~= "string" then return end
    local pattern = "^" .. fmt:gsub("%%%d%$", "%%"):gsub("%p", "%%%0"):gsub("%%%%s", ".+") .. "$"
    if msg:match(pattern) then fresh(nil, false) end      -- the next time in is a new run, seen from its start
  end,
}
if ns.World and ns.World.Listen then
  for e, fn in pairs(handlers) do ns.World.Listen(e, fn) end
end

-- A new ask: inside a dungeon or raid, for a Willo that reads them, the header and the bosses down.
function Down.Start()
  queue, pos = nil, 0
  if not Down.FromWillo() then return end
  local inst = here()
  if not inst then return end
  local known = run.inst == inst and run.known
  local kills = run.inst == inst and run.kills or {}
  local first = math.max(1, #kills - MAX + 1)
  queue = { page(2147483648 + (known and 16777216 or 0) + (#kills - first + 1)) }
  for i = first, #kills do queue[#queue + 1] = page(kills[i]) end
end

-- The next page of this ask, or nil when it has none left.
function Down.Next()
  if not queue then return nil end
  pos = pos + 1
  local p = queue[pos]
  if not p then queue = nil; return nil end
  return { p[1], p[2], p[3], p[4], p[5] }
end

function Down.Pending() return queue ~= nil end

-- For the sims: this run as kept.
function Down.Run() return run end
