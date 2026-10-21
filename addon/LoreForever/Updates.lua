-- Is this Lore Forever the newest? (Mike, 2026-10-19: players report bugs that a release already fixed, like a
-- controller player's blocked-action popup still on 0.21.0 after 0.22.0 fixed it, LOR-481.) An add-on can't go online
-- and sends nothing to anyone (site/tests/privacy.test.mjs), so it goes by two things it can read:
--   - Willo, the companion app, writes the newest version into her add-on's data (LoreForeverJourneyData.latest, with
--     her own version as .willo, and .keepsAddon when she installs updates herself while the game is closed);
--   - this build's release day (Notes.lua's `released`, written at each release): releases come out most days, so a
--     build OLD_DAYS old has almost always been followed by a newer one.
-- When it's behind (2+ releases, or 1 with this build SLOW_DAYS old; one behind is mostly "since yesterday"), or this
-- build is OLD_DAYS old with nothing newer known, the chat says so once, with how to update, and then nothing for
-- QUIET_DAYS. The minimap button's tooltip says it while a newer version is known, and /lore version tells it any time.
-- Options > "Tell me when a new version is out" turns the chat line and the tooltip line off.
-- State: LoreForeverDB.update = { told = time() of the last chat line }.
-- pipeline/tests/updates_sim.py checks all of this.

local _, ns = ...
local U = {}
ns.Updates = U
local L = ns.L

local BEHIND = 2           -- releases behind for the chat line
local SLOW_DAYS = 3        -- or one behind with this build this many days old
local OLD_DAYS = 4         -- with nothing newer known: this build's age for the chat line
local QUIET_DAYS = 14      -- after the chat line, none for this long
local DAY = 86400

local function S() return LoreForeverDB.settings end
local function state()
  if type(LoreForeverDB.update) ~= "table" then LoreForeverDB.update = {} end
  return LoreForeverDB.update
end

-- "0.22.0" -> { 0, 22, 0 }; nil for anything else (a test build's "0.22.0-qa3" included: those never compare).
local function parse(v)
  local a, b, c = tostring(v or ""):match("^(%d+)%.(%d+)%.(%d+)$")
  if not a then return nil end
  return { tonumber(a), tonumber(b), tonumber(c) }
end

-- How many releases `theirs` is ahead of `ours` (both parsed): 0 when it isn't; a patch release counts as one.
local function ahead(theirs, ours)
  if theirs[1] ~= ours[1] then return theirs[1] > ours[1] and 99 or 0 end
  if theirs[2] ~= ours[2] then return math.max(0, theirs[2] - ours[2]) end
  return theirs[3] > ours[3] and 1 or 0
end

local function mine() return parse(ns.Log.Version()) end

-- This build's release day as time() (noon UTC near enough), from Notes.lua's `released` ("2026-10-18"), or nil.
local function releasedAt()
  local notes = ns.Notes
  if not (notes and notes.version == ns.Log.Version()) then return nil end
  local y, m, d = tostring(notes.released or ""):match("^(%d%d%d%d)%-(%d%d)%-(%d%d)$")
  if not y then return nil end
  local ok, t = pcall(time, { year = tonumber(y), month = tonumber(m), day = tonumber(d), hour = 12 })
  return ok and t or nil
end

-- Whole days since this build came out, or nil.
local function ageDays()
  local t = releasedAt()
  return t and math.max(0, math.floor((time() - t) / DAY)) or nil
end

-- Willo's data: her version, the newest add-on she knows of, and whether she installs it herself.
local function willo()
  local d = _G.LoreForeverJourneyData
  if type(d) ~= "table" then return nil end
  return { version = type(d.willo) == "string" and d.willo or nil, latest = type(d.latest) == "string" and d.latest or nil,
           keeps = d.keepsAddon == true }
end
function U.WilloVersion()
  local w = willo()
  return w and w.version
end

-- The newest version Willo knows of, when it's newer than this one: the version, and how many releases ahead.
function U.Newer()
  local ours = mine()
  if not ours then return nil end
  local w = willo()
  local best = w and parse(w.latest)
  if not best then return nil end
  local n = ahead(best, ours)
  if n == 0 then return nil end
  return w.latest, n
end

-- Whether it's time for the chat line, and which: "newer" (a version is known) or "old" (this build is OLD_DAYS old).
local function due()
  if not (S().updateNotice and mine()) then return nil end
  local told = tonumber(state().told)
  if told and time() - told < QUIET_DAYS * DAY then return nil end
  local _, n = U.Newer()
  local age, w = ageDays(), willo()
  if n and (n >= BEHIND or (age and age >= SLOW_DAYS)) then return "newer" end
  -- (Willo knowing the newest and saying it's this one beats the build's age.)
  if not n and age and age >= OLD_DAYS and not (w and parse(w.latest)) then return "old" end
  return nil
end

local function say(msg)
  if _G.DEFAULT_CHAT_FRAME then DEFAULT_CHAT_FRAME:AddMessage(ns.Theme.code.gold .. "Lore Forever:|r " .. msg) end
end

-- How to update, in a line: Willo does it when she can.
-- maybe: no newer version is known for sure, so it says how to look.
local function how(maybe)
  local w = willo()
  if w and w.keeps and not maybe then
    return string.format(L["%s installs it for you the next time you close the game."], ns.COMPANION_NAME)
  end
  if maybe then
    return L["If the CurseForge app shows an update for Lore Forever, take it. If you installed it yourself, get the newest from loreforeverwow.com (Setup.exe updates it in place)."]
  end
  return L["In the CurseForge app, click Update on Lore Forever. If you installed it yourself, download it again from loreforeverwow.com (Setup.exe updates it in place)."]
end

-- The chat line, once, then QUIET_DAYS of nothing. Never in combat: it waits for the fight to end.
local waiting = false
function U.MaybeTell()
  local kind = due()
  if not kind then return false end
  if InCombatLockdown and InCombatLockdown() then
    waiting = true
    return false
  end
  waiting = false
  state().told = time()
  local newest = U.Newer()
  if kind == "newer" then
    say(string.format(L["a new version is out: %s (you have %s). %s"], newest, ns.Log.Version(), how()))
  else
    say(string.format(L["your version (%s) came out %d days ago, and new versions come out most days, with fixes. %s"],
      ns.Log.Version(), ageDays(), how(true)))
  end
  return true
end

-- The minimap button's tooltip line while a newer version is known, or nil.
function U.TooltipLine()
  if not S().updateNotice then return nil end
  local newest = U.Newer()
  return newest and string.format(L["A new version is out: %s (you have %s)."], newest, ns.Log.Version()) or nil
end

-- For /lore errors (Errors.Report): Willo's version and the newest known, so a report from an old version shows it.
function U.ReportParts()
  local out = {}
  local w = U.WilloVersion()
  if w then out[#out + 1] = "Willo " .. w end
  local newest = U.Newer()
  if newest then out[#out + 1] = "newest seen " .. newest end
  return out
end

-- /lore version
function U.Describe(sayFn)
  local v, day = ns.Log.Version(), releasedAt() and ns.Notes.released
  sayFn(day and string.format(L["this is version %s, released %s."], v, day) or string.format(L["this is version %s."], v))
  local w = U.WilloVersion()
  if w then sayFn(string.format(L["%s, the companion app: version %s."], ns.COMPANION_NAME, w)) end
  local newest = U.Newer()
  if newest then
    sayFn(string.format(L["A new version is out: %s. %s"], newest, how()))
  elseif U.WilloVersion() then
    sayFn(string.format(L["It's the newest version %s knows of."], ns.COMPANION_NAME))
  else
    sayFn(how(true))
  end
end

-- At login (Core.lua): say so if it's time, after the login chat and its tip. A fight puts it off until it ends.
local frame = CreateFrame("Frame")
frame:SetScript("OnEvent", function()
  if waiting then C_Timer.After(3, U.MaybeTell) end
end)

function U.Init()
  pcall(frame.RegisterEvent, frame, "PLAYER_REGEN_ENABLED")
  C_Timer.After(14, U.MaybeTell)   -- after the login tip (12 s), once the login chat has settled
end
