-- What a goal counts (LOR-665, Willo's goals): the character's gold, experience, profession ranks, riding and
-- reputation as they stand, and a line for each day played, kept in the journey's record for Willo's app to read
-- (companion/lore_companion/journal.py), so "how close am I to my mount?" has the real numbers and a pace. Nothing of
-- it shows in the game, and it only reads what the game tells the add-on. It's taken at login and when the game saves
-- (logout and /reload: Journey.lua's PLAYER_LOGOUT), so it costs nothing while you play, and only with "Remember my
-- journey" on.
--
-- char.stock = { t, level, xp, xpMax, money (copper), riding (0, 75 or 150), skills = { [name] = { rank, max } },
--   rep = { [faction] = { standing 1-8, value, min, max } } }   reputations moved from a plain Neutral, by the game's
--   own bar (value from min to max of the standing)
-- char.days = { { d = "2026-10-18", m0, m, l0, l, on }, ... }   the last DAYS days played, oldest first: money and level
--   (with the bar's fraction, 36.6) at the day's first look and its last, and seconds online that day (a session that
--   runs past midnight stays on the day it started)

local _, ns = ...
local Stock = {}
ns.Stock = Stock

local DAYS = 14
-- Forever's riding (its client: SkillLineAbility, riding's skill line 762): Journeyman Riding, then Apprentice.
local RIDING = { { 33391, 150 }, { 33388, 75 } }
local session        -- { day, from }: this session's line in char.days, and when it started counting online

local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b = pcall(fn, ...)
  if ok then return a, b end
end
local function number(v)
  v = tonumber(v)
  return v and ns.Context.Usable(v) and v or nil
end

local function riding()
  for _, r in ipairs(RIDING) do
    if try(IsSpellKnown, r[1]) or try(IsPlayerSpell, r[1]) then return r[2] end
  end
  return 0
end

local function skills()
  local out = {}
  for _, p in ipairs(ns.Context.Professions()) do
    local rank = number(p.rank)
    if ns.Context.Usable(p.name) and type(p.name) == "string" and rank then out[p.name] = { rank, number(p.max) or rank } end
  end
  return out
end

local function reputations()
  local out = {}
  for _, f in ipairs(ns.Journey.Factions and ns.Journey.Factions() or {}) do
    local v, lo, hi = number(f.v), number(f.lo), number(f.hi)
    if v and lo and hi and not (f.st == 4 and v <= 0) then out[f.name] = { f.st, v, lo, hi } end
  end
  return out
end

-- The level with the bar's fraction: 36.6 at 60% of the way to 37 (the cap's bar means nothing).
local function levelNow(level, xp, xpMax)
  if level and xp and xpMax and xpMax > 0 and level < 60 then return level + math.min(0.99, xp / xpMax) end
  return level
end

local function dayLine(days, d)
  for i = #days, 1, -1 do
    if type(days[i]) == "table" and days[i].d == d then return days[i] end
  end
end

-- Take stock of the character (char: Journey's record for it). leaving: the game is about to save (logout or
-- /reload), so this session's time goes on its day.
function Stock.Take(char, leaving)
  if type(char) ~= "table" then return end
  local level = number(try(UnitLevel, "player")) or number(char.level)
  local xp, xpMax, money = number(try(UnitXP, "player")), number(try(UnitXPMax, "player")), number(try(GetMoney))
  local now = time()
  char.stock = { t = now, level = level, xp = xp, xpMax = xpMax, money = money, riding = riding(), skills = skills(),
    rep = reputations() }
  local lv = levelNow(level, xp, xpMax)
  char.days = type(char.days) == "table" and char.days or {}
  local days = char.days
  local line = leaving and session and dayLine(days, session.day)
  if not line then
    local d = date("%Y-%m-%d", now)
    line = dayLine(days, d)
    if not line then
      line = { d = d, m0 = money, l0 = lv, on = 0 }
      days[#days + 1] = line
    end
  end
  line.m, line.l = money, lv
  if leaving then
    if session then line.on = math.floor((tonumber(line.on) or 0) + math.max(0, now - session.from)) end
    session = nil
  else
    session = { day = line.d, from = now }
  end
  while #days > DAYS do table.remove(days, 1) end
end
