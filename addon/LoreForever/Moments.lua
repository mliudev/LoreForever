-- Willo's big moments (LOR-967; Mike, 10/31: "go A"): at a new level, a quest carried a long time, an epic and a few
-- more, the add-on twinkles Willo's sky for a moment (Strip.Moment) with a page saying what happened, and Willo,
-- reading it, says one of her saved lines (companion/lore_companion/moments.py). Only for a Willo that asks for them
-- (Strip.ChimeFromWillo: her Chime in setting, Big moments or Small ones too), with Live game info on, in English.
-- The page, the outer ring's 5 bytes: 0xC5 (kind 3, low bits 5), then 32 bits big-endian: what (4 bits, KIND), whose
-- (12: the low bits of the CRC-32 of Journey.CharKey, as Strip.Identity's), and which (16: the level, the quest's or
-- the item's id, a hash for a faction or a craft, the day for a rough patch). Willo keeps what she has said, so a page
-- read twice is said once.
-- A level and a rough patch come from the game's own events; the rest from the journey as it records them (with
-- "Remember my journey" off, only those two). Never mid-fight: a moment waits while the player fights, is dead,
-- watches a cutscene, hears a Lore Forever narration, asks Willo or hears her answer, takes a journey picture, moves
-- the sky, sits at a loading screen or has the interface hidden, and for a quest page going round for Willo. One at a
-- time, the biggest; one per GAP and HOUR_MAX an hour (Willo counts the same: about one an hour in real play); one
-- that waited too long is let go.

local _, ns = ...
local Moments = {}
ns.Moments = Moments

-- The kinds, biggest first: when two come together, the bigger one goes.
Moments.KIND = { level = 1, quest = 2, epic = 3, mount = 4, rep = 5, craft = 6, rough = 7, turnin = 8, blue = 9 }
local KIND = Moments.KIND
local SMALL = { turnin = true, blue = true }     -- with Chime in "Small ones too" only
local GAP, HOUR_MAX = 180, 6                     -- seconds between two; how many an hour
local HOLD, LONG_HOLD = 120, 600                 -- seconds one may wait (a level, a rough patch: LONG_HOLD)
local GATHER, LOOK = 2, 0.5                      -- a turn-in that levels you sends the level; how often a wait looks
local ROUGH_DEATHS, ROUGH_WITHIN = 3, 15 * 60    -- a rough patch: this many deaths this close, solo, in the open world
local EPIC, RARE = 4, 3
local STEPS = { [75] = 1, [150] = 2, [225] = 3, [300] = 4 }

local function now() return (GetTime and GetTime()) or 0 end
local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, v = pcall(fn, ...)
  if ok and ns.Context.Usable(v) then return v end
end

-- When the last ones went (time()), and the day of the last rough patch: kept across logins.
local function kept()
  local db = _G.LoreForeverDB
  if type(db) ~= "table" then return { at = {} } end
  if type(db.moments) ~= "table" then db.moments = {} end
  if type(db.moments.at) ~= "table" then db.moments.at = {} end
  return db.moments
end

-- Whose: the character's tag (nil when the game doesn't say who: no page).
local function whose()
  local J = ns.Journey
  if not (J and J.CharKey) then return nil end
  local key, name, realm = J.CharKey()
  if type(key) ~= "string" or not name or not realm or name == "?" or realm == "?" then return nil end
  return ns.Strip.CRC32(key) % 4096
end

function Moments.Page(kind, tag, id)
  local v = KIND[kind] * 268435456 + tag * 65536 + id % 65536
  return { 0xC5, math.floor(v / 16777216) % 256, math.floor(v / 65536) % 256, math.floor(v / 256) % 256, v % 256 }
end

local function wants(kind)
  local chime, C = ns.Strip.ChimeFromWillo(), ns.Companion
  return chime ~= nil and ns.Strip.On() and (not C or C.English()) and (not SMALL[kind] or chime == "small")
end

local loading
-- Why a moment can't twinkle now (nil: it can). Checked every frame of a twinkle too (Strip.Moment).
local function held()
  local Strip, Voice, UI, J, C = ns.Strip, ns.Voice, ns.UI, ns.Journey, ns.Companion
  if (InCombatLockdown and InCombatLockdown()) or try(UnitAffectingCombat, "player") then return "fight" end
  if try(UnitIsDeadOrGhost, "player") then return "dead" end
  if loading then return "loading" end
  if UIParent and UIParent.IsShown and not UIParent:IsShown() then return "interface hidden" end
  if Voice and Voice.GameTalking and Voice.GameTalking() then return "cutscene" end
  if Voice and Voice.WilloAnswering and Voice.WilloAnswering() then return "Willo answering" end
  if UI and UI.IsBusy and UI.IsBusy() then return "narration" end
  if J and J.TakingPicture and J.TakingPicture() then return "picture" end
  if ns.Sky and ns.Sky.Moving and ns.Sky.Moving() then return "moving the sky" end
  if (Strip.Asking and Strip.Asking()) or (C and C.Sending and C.Sending()) then return "asking Willo" end
  if Strip.QuestPageUp and Strip.QuestPageUp() then return "quest page" end
end
Moments.Held = held

local pending   -- { kind, id, tag, at, after }: the one waiting to go
local frame

-- Something happened: it waits to go (the biggest of those waiting).
function Moments.Queue(kind, id)
  if not (KIND[kind] and type(id) == "number" and wants(kind)) then return end
  local tag = whose()
  if not tag then return end
  local t = now()
  if pending and KIND[pending.kind] <= KIND[kind] then return end
  pending = { kind = kind, id = math.floor(id) % 65536, tag = tag, at = t, after = pending and pending.after or t + GATHER }
  if frame then frame:Show() end
end

local function look()
  local p = pending
  if not p then frame:Hide(); return end
  local t = now()
  if t < p.after then return end
  local hold = (p.kind == "level" or p.kind == "rough") and LONG_HOLD or HOLD
  if t - p.at > hold or not wants(p.kind) then pending = nil; return end
  local k, wall = kept(), time()
  local recent = {}
  for _, at in ipairs(k.at) do if type(at) == "number" and wall - at < 3600 then recent[#recent + 1] = at end end
  k.at = recent
  if #recent >= HOUR_MAX then pending = nil; return end
  -- Inside GAP it waits, as for a fight, until its hold runs out (the Architect, 10/31).
  if (recent[#recent] and wall - recent[#recent] < GAP) or held() then return end
  pending = nil
  recent[#recent + 1] = wall
  -- Stopped part way (a fight came): not counted, and it goes again when it can.
  local function again()
    for i = #k.at, 1, -1 do if k.at[i] == wall then table.remove(k.at, i); break end end
    if not pending or KIND[pending.kind] > KIND[p.kind] then
      p.after = now() + GATHER
      pending = p
      frame:Show()
    end
  end
  if not ns.Strip.Moment(Moments.Page(p.kind, p.tag, p.id), held, again) then
    table.remove(recent)
    pending = p
  end
end

local deaths = {}
local function onDead()
  local t = now()
  local close = {}
  for _, d in ipairs(deaths) do if t - d < ROUGH_WITHIN then close[#close + 1] = d end end
  close[#close + 1] = t
  deaths = close
  if #deaths < ROUGH_DEATHS or (try(GetNumGroupMembers) or 0) > 0 or try(IsInInstance) then return end
  local day, k = math.floor(time() / 86400), kept()
  if k.rough == day then return end
  k.rough, deaths = day, {}
  Moments.Queue("rough", day)   -- (it waits while you're dead: said once you're back on your feet)
end

-- What the journey records (Journey.lua's add; not what you made).
local function onAdded(k, e)
  local Strip = ns.Strip
  if k == "qt" then
    Moments.Queue(ns.Journey.CarriedLong(e.id) and "quest" or "turnin", e.id)
  elseif k == "loot" then
    local ql = tonumber(e.ql) or 0
    if ql >= EPIC then Moments.Queue("epic", e.id) elseif ql == RARE then Moments.Queue("blue", e.id) end
  elseif k == "mount" then
    Moments.Queue("mount", tonumber(e.item) or tonumber(e.id) or Strip.CRC32(tostring(e.n)))
  elseif k == "rep" then
    local st, was = tonumber(e.st), tonumber(e.was)
    if st and was and st > was and st >= 5 then Moments.Queue("rep", (Strip.CRC32(tostring(e.n)) % 8192) * 8 + st - 1) end
  elseif k == "prof" and STEPS[tonumber(e.r)] then
    Moments.Queue("craft", (Strip.CRC32(tostring(e.n)) % 8192) * 8 + STEPS[tonumber(e.r)])
  end
end
if ns.Journey then ns.Journey.OnAdded = onAdded end

-- The sky's art, made ahead of the first twinkle, out of combat (Sky.Prepare).
local function prepare()
  if ns.Strip.ChimeFromWillo() and ns.Strip.On() and ns.Sky.Prepare then ns.Sky.Prepare() end
end

frame = CreateFrame("Frame", "LoreForeverMoments", UIParent)
frame:Hide()
local acc = 0
frame:SetScript("OnUpdate", function(_, elapsed)
  acc = acc + (elapsed or LOOK)
  if acc < LOOK then return end
  acc = 0
  look()
end)
frame:SetScript("OnEvent", function(_, event, a)
  if event == "PLAYER_LEVEL_UP" then Moments.Queue("level", tonumber(a) or try(UnitLevel, "player"))
  elseif event == "PLAYER_DEAD" then onDead()
  elseif event == "LOADING_SCREEN_ENABLED" then loading = true
  elseif event == "LOADING_SCREEN_DISABLED" then loading = nil
  elseif event == "PLAYER_ENTERING_WORLD" then
    loading = nil
    if C_Timer and C_Timer.After then C_Timer.After(5, prepare) end
  elseif event == "PLAYER_REGEN_ENABLED" then prepare()
  end
end)
for _, e in ipairs({ "PLAYER_LEVEL_UP", "PLAYER_DEAD", "LOADING_SCREEN_ENABLED", "LOADING_SCREEN_DISABLED",
                     "PLAYER_ENTERING_WORLD", "PLAYER_REGEN_ENABLED" }) do
  pcall(frame.RegisterEvent, frame, e)
end
