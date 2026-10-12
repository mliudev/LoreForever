-- Battlegrounds in the journey (LOR-430): which battle, for which side, who won and how you did, so answers and the
-- journey tell it as a battle, not as a dungeon where you died a lot.
--
-- One "bg" event per battle (Journey.lua's list of kinds): n the battleground, side "Alliance" or "Horde", start
-- (time() you entered), inst "pvp", and what the game says of the end: out "win", "loss" or "draw", dur (the match's
-- seconds), and your own line of the scoreboard: hk (honorable kills), kb (killing blows), deaths, honor (honor
-- gained), obj = { { n = "Flags Captured", v = 1 }, ... } (the battleground's own columns, as the game names them).
-- left = 1 when you left before it was decided. Only your own line is read: never another player's name or numbers.
-- It's written shortly after the match ends, while you're still inside (so it has no map spot), or when you leave
-- before the end; a logout or disconnect inside writes it at the next login outside. The zone event for entering
-- (inst "pvp") and your deaths there are recorded as before.
-- The scoreboard is secret while a match runs (SecretInActivePvPMatch in the client's API documentation), so it's
-- read once the match is over: at PVP_MATCH_COMPLETE and on the UPDATE_BATTLEFIELD_SCORE that follows. The battle in
-- progress is kept in the character's record (bgNow) so a /reload inside doesn't lose it.

local _, ns = ...
local Battle = {}
ns.Battle = Battle

local TEAMS = { [0] = "Horde", [1] = "Alliance" }   -- the game's team index (GetBattlefieldArenaFaction, the winner)
local MAX_OBJ = 6          -- of the battleground's own scoreboard columns
local SETTLE = 3           -- seconds after the end for the final scoreboard to arrive

local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b, c, d, e = pcall(fn, ...)
  if ok then return a, b, c, d, e end
end
local function later(delay, fn) C_Timer.After(delay, function() pcall(fn) end) end

-- A whole number the game told us plainly, or nil (a secret value, or not a number).
local function count(v)
  if not ns.Context.Usable(v) or type(v) ~= "number" then return nil end
  local ok, n = pcall(function() return math.floor(v + 0.5) end)
  if ok and n >= 0 then return n end
end
local function text(v)
  if ns.Context.Usable(v) and type(v) == "string" and v ~= "" then return v end
end

local function char()
  local J = ns.Journey
  return J and J.On() and J.Char() or nil
end

-- The battle in progress, or nil.
local function current()
  local c = char()
  return c and type(c.bgNow) == "table" and c.bgNow or nil
end

-- The battleground you're in, by name, or nil.
local function battleground()
  local inside, kind = try(IsInInstance)
  if not inside or kind ~= "pvp" then return nil end
  return text((try(GetInstanceInfo))) or text((try(GetRealZoneText)))
end

local function team() return count(try(GetBattlefieldArenaFaction)) end

-- Your own line of the scoreboard (C_PvP.GetScoreInfoByPlayerGuid, as the client's own results window reads it) into
-- b. Unreadable parts (secret, or missing) stay as they were.
local function readScore(b)
  local P = _G.C_PvP
  local guid = try(UnitGUID, "player")
  local info = P and guid and try(P.GetScoreInfoByPlayerGuid, guid)
  if type(info) ~= "table" then return end
  b.hk = count(info.honorableKills) or b.hk
  b.kb = count(info.killingBlows) or b.kb
  b.deaths = count(info.deaths) or b.deaths
  b.honor = count(info.honorGained) or b.honor
  local obj = {}
  for _, s in ipairs(type(info.stats) == "table" and info.stats or {}) do
    local n, v = type(s) == "table" and text(s.name), type(s) == "table" and count(s.pvpStatValue)
    if n and v and #obj < MAX_OBJ then obj[#obj + 1] = { n = n, v = v } end
  end
  if #obj > 0 then b.obj = obj end
end

-- "win", "loss" or "draw" for winner (the winning team's index), or nil when it can't be told.
local function outcome(winner, b)
  local w = count(winner)
  local mine = team()
  if mine == nil then mine = b.side == "Horde" and 0 or b.side == "Alliance" and 1 or nil end
  if w == nil or mine == nil then return nil end
  if w == mine then return "win" end
  if w == 1 - mine then return "loss" end
  return "draw"
end

-- Writes the battle as a "bg" event, once. It stays the battle in progress until you leave, so a /reload in the
-- minutes after the end doesn't start another.
local function write(b)
  if b.written or not text(b.n) then return end
  b.written = true
  -- No map spot (at = false): once you've left, where you are isn't where the battle was.
  ns.Journey.Add("bg", { n = b.n, side = b.side, start = tonumber(b.start), inst = "pvp", at = false,
    out = b.out, dur = b.dur, hk = b.hk, kb = b.kb, deaths = b.deaths, honor = b.honor, obj = b.obj,
    left = not b.done and 1 or nil })
end

-- Where you are now: a battleground entered starts a battle; leaving one writes it if the end didn't.
local function look()
  if not char() then return end
  local name, b = battleground(), current()
  if b and b.n ~= name then
    char().bgNow = nil
    write(b)
    b = nil
  end
  if name and not b then
    local c = char()
    c.bgNow = { n = name, start = time(), side = TEAMS[team() or -1] or text((try(UnitFactionGroup, "player"))) }
  end
end

-- The match is over: who won, and your line of the scoreboard once it has settled.
local function complete(winner, duration)
  local b = current()
  if not b then look(); b = current() end   -- a /reload just before the end
  if not b or b.done then return end
  b.done = true
  local P = _G.C_PvP
  b.out = outcome(winner, b) or outcome(P and try(P.GetActiveMatchWinner), b) or outcome(try(GetBattlefieldWinner), b)
  b.dur = count(duration) or count(P and try(P.GetActiveMatchDuration)) or b.dur
  pcall(readScore, b)
  try(RequestBattlefieldScoreData)
  later(SETTLE, function()
    if current() == b then pcall(readScore, b); write(b) end
  end)
end

local handlers = {
  PLAYER_ENTERING_WORLD = function() later(1, look) end,
  ZONE_CHANGED_NEW_AREA = function() later(1, look) end,
  PVP_MATCH_COMPLETE = complete,
  -- The final scoreboard can arrive just after the end.
  UPDATE_BATTLEFIELD_SCORE = function()
    local b = current()
    if b and b.done and not b.written then pcall(readScore, b) end
  end,
}

local frame = CreateFrame("Frame")
for event in pairs(handlers) do
  pcall(frame.RegisterEvent, frame, event)
end
frame:SetScript("OnEvent", function(_, event, ...)
  if not (LoreForeverDB and LoreForeverDB.texts) then return end   -- before login
  local h = handlers[event]
  if h then pcall(h, ...) end
end)

-- For tests: what's being tracked now.
function Battle.Current() return current() end
