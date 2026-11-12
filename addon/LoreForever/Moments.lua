-- Willo's big moments (LOR-967; Mike, 10/31: "go A"): at a new level, a quest carried a long time, an epic and a few
-- more, the add-on twinkles Willo's sky for a moment (Strip.Moment) with a page saying what happened, and Willo,
-- reading it, says one of her saved lines (companion/lore_companion/moments.py). Only for a Willo that asks for them
-- (Strip.ChimeFromWillo: her Chime in setting, Big moments or Small ones too), with Live game info on, whatever language
-- the add-on reads in: the page carries no words, and Willo cheers in English as she answers (Mike, 10/13: for a player
-- who reads the add-on in another language, Willo answers as usual). A German voice pack had silenced them all.
-- The page, the outer ring's 5 bytes: 0xC5 (kind 3, low bits 5), then 32 bits big-endian: what (4 bits, KIND), whose
-- (12: the low bits of the CRC-32 of Journey.CharKey, as Strip.Identity's), and which (16: the level, the quest's or
-- the item's id, a hash for a faction or a craft, the day for a rough patch). Willo keeps what she has said, so a page
-- read twice is said once.
-- Two pages (kind 15; the Architect's layout ruling 11/11, LOR-1412), only to a Willo that reads them
-- (Strip.PairsFromWillo) and only where one page can't carry it: the Design Lead's three new moments (Mike, 11/11: "Yes,
-- A for both": a dungeon finished, the end of a quest line, the first time in a zone) and a number past 16 bits. Page
-- A: 0xC5, then 15 (4 bits), the subkind (4: SUB), whose (12) and a check (12: the CRC-32 of page B's last 4 bytes, mod
-- 4096). Page B: 0xC6 (kind 3, low bits 6), then the whole number, 32 bits big-endian. The sky shows them in turn
-- (Strip.Moment); Willo says it only when both came and the check fits, and drops half a pair. Worked example (Lua and
-- Python both reproduce it): the end of a quest line (SUB 11) for quest 79192, whose 0x6C1: B = C6 00 01 35 58, the
-- check CRC-32(00 01 35 58) % 4096 = 0xE5B, A = C5 FB 6C 1E 5B. To a Willo without pairs a new kind isn't sent, and
-- everything else goes as one page, exactly as before.
-- A level and a rough patch come from the game's own events; the rest from the journey as it records them (with
-- "Remember my journey" off, only those two). Never mid-fight: a moment waits while the player fights, is dead,
-- watches a cutscene, hears a Lore Forever narration, asks Willo or hears her answer, takes a journey picture, moves
-- the sky, sits at a loading screen or has the interface hidden. One at a
-- time, the biggest; one per GAP and HOUR_MAX an hour (Willo counts the same: about one an hour in real play); one
-- that waited too long is let go. Small ones (a turn-in, a blue) keep their own count and never spend a big one's
-- slot: a big one waits only on the last big one, while a small one waits GAP after any (LOR-1412: with Small ones
-- too, turn-ins and blues took the hour and about half the level-ups were never said).

local _, ns = ...
local Moments = {}
ns.Moments = Moments

-- The kinds one page carries. Kinds 10 to 14 are Moments.CUT (below); kind 15 is two pages (Moments.Pair).
Moments.KIND = { level = 1, quest = 2, epic = 3, mount = 4, rep = 5, craft = 6, rough = 7, turnin = 8, blue = 9 }
local KIND = Moments.KIND
-- Page A's subkinds: the kinds whose number can pass 16 bits, and the three new ones. 15 stays free.
Moments.SUB = { quest = 2, epic = 3, mount = 4, turnin = 8, blue = 9, dungeon = 10, line_end = 11, zone = 12 }
local NEW = { dungeon = true, line_end = true, zone = true }
-- Biggest first: when two come together, the bigger one goes (Willo's moments.py ORDER).
Moments.RANK = { level = 1, dungeon = 2, line_end = 3, quest = 4, epic = 5, mount = 6, rep = 7, craft = 8, rough = 9,
                 turnin = 10, blue = 11, zone = 12 }
local RANK = Moments.RANK
local SMALL = { turnin = true, blue = true, zone = true }     -- with Chime in "Small ones too" only
local SETTLE = 180                               -- a first zone: said once they've been there this long, or took a quest
-- Each dungeon's last boss, by the name its kill is recorded under (the design: "a dungeon finished"). The lore lists a
-- dungeon's bosses in no set order (Cookie comes after VanCleef), so the last one is named.
local FINAL = {}
for _, n in ipairs({ "Edwin VanCleef", "Mutanus the Devourer", "Archmage Arugal", "Aku'mai", "Bazil Thredd",
  "Mekgineer Thermaplugg", "Charlga Razorflank", "Taragaman the Hungerer", "Durgen Dirgehammer", "Rath'mael",
  "Amnennar the Coldbringer", "Archaedas", "Chief Ukorz Sandscalp", "Princess Theradras", "Shade of Eranikus",
  "Emperor Dagran Thaurissan", "Overlord Wyrmthalak", "General Drakkisath", "Darkmaster Gandling", "Baron Rivendare",
  "High Inquisitor Whitemane", "Herod", "Arcanist Doan", "Bloodmage Thalnos" }) do FINAL[n:lower()] = true end
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

-- When the last ones went (time(); at: big ones, small: small ones), and the day of the last rough patch: kept across
-- logins.
local function kept()
  local db = _G.LoreForeverDB
  if type(db) ~= "table" then return { at = {}, small = {} } end
  if type(db.moments) ~= "table" then db.moments = {} end
  if type(db.moments.at) ~= "table" then db.moments.at = {} end
  if type(db.moments.small) ~= "table" then db.moments.small = {} end
  return db.moments
end

-- The times of the last hour in list (oldest first), kept in place.
local function hour(k, field, wall)
  local recent = {}
  for _, at in ipairs(k[field]) do if type(at) == "number" and wall - at < 3600 then recent[#recent + 1] = at end end
  k[field] = recent
  return recent
end

-- Whose: the character's tag (nil when the game doesn't say who: no page).
local function whose()
  local J = ns.Journey
  if not (J and J.CharKey) then return nil end
  local key, name, realm = J.CharKey()
  if type(key) ~= "string" or not name or not realm or name == "?" or realm == "?" then return nil end
  return ns.Strip.CRC32(key) % 4096
end

-- A number past 16 bits (Forever's own items and quests are numbered past 65,535) goes as its low 16 bits under the
-- kind's CUT number, so Willo never takes it for the thing that really has those 16 bits (Mike's Grip of Fear, 271208,
-- would have been said as Tablet of Flametongue Weapon II, 9064; LOR-1412). A Willo that doesn't know CUT ignores it.
Moments.CUT = { quest = 10, epic = 11, mount = 12, turnin = 13, blue = 14 }
function Moments.Page(kind, tag, id)
  local k = (id >= 65536 and Moments.CUT[kind]) or KIND[kind]
  local v = k * 268435456 + tag * 65536 + id % 65536
  return { 0xC5, math.floor(v / 16777216) % 256, math.floor(v / 65536) % 256, math.floor(v / 256) % 256, v % 256 }
end

-- Two pages (the layout above): { page A, page B }.
function Moments.Pair(kind, tag, id)
  local n = math.floor(id) % 4294967296
  local b = { 0xC6, math.floor(n / 16777216) % 256, math.floor(n / 65536) % 256, math.floor(n / 256) % 256, n % 256 }
  local check = ns.Strip.CRC32(string.char(b[2], b[3], b[4], b[5])) % 4096
  local v = 15 * 268435456 + Moments.SUB[kind] * 16777216 + tag * 4096 + check
  return { { 0xC5, math.floor(v / 16777216) % 256, math.floor(v / 65536) % 256, math.floor(v / 256) % 256, v % 256 }, b }
end

local function pairsOk() return ns.Strip.PairsFromWillo() end

-- What a moment goes as (a list of pages): two for a new kind (wants: only to a Willo that reads them), else the one
-- page as before. (Not for a quest or item past 16 bits: the site takes a whole number only for the new kinds, and
-- names those through CUT and the journal's full id, the Architect's #3769 hold.)
function Moments.Pages(kind, tag, id)
  if NEW[kind] then return Moments.Pair(kind, tag, id) end
  return { Moments.Page(kind, tag, id) }
end

local function wants(kind)
  local chime = ns.Strip.ChimeFromWillo()
  return chime ~= nil and ns.Strip.On() and (not SMALL[kind] or chime == "small") and (not NEW[kind] or pairsOk())
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
  if Voice and Voice.BetweenNarrations and Voice.BetweenNarrations() then return "narration" end
  if J and J.TakingPicture and J.TakingPicture() then return "picture" end
  if ns.Sky and ns.Sky.Moving and ns.Sky.Moving() then return "moving the sky" end
  if (Strip.Asking and Strip.Asking()) or (C and C.Sending and C.Sending()) then return "asking Willo" end
end
Moments.Held = held

local pending   -- { kind, id, tag, at, after }: the one waiting to go
local frame

-- Something happened: it waits to go (the biggest of those waiting).
function Moments.Queue(kind, id)
  if not (RANK[kind] and type(id) == "number" and wants(kind)) then return end
  local tag = whose()
  if not tag then return end
  local t = now()
  if pending and RANK[pending.kind] <= RANK[kind] then return end
  pending = { kind = kind, id = math.floor(id) % 4294967296, tag = tag, at = t, after = pending and pending.after or t + GATHER }
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
  local field = SMALL[p.kind] and "small" or "at"
  local big, small = hour(k, "at", wall), hour(k, "small", wall)
  local recent = field == "small" and small or big
  if #recent >= HOUR_MAX then pending = nil; return end
  -- Inside GAP it waits, as for a fight, until its hold runs out (the Architect, 10/31). A big one waits only on the
  -- last big one; a small one on the last of either.
  local last = big[#big]
  if field == "small" and (small[#small] or 0) > (last or 0) then last = small[#small] end
  if (last and wall - last < GAP) or held() then return end
  pending = nil
  recent[#recent + 1] = wall
  -- Stopped part way (a fight came): not counted, and it goes again when it can.
  local function again()
    local list = k[field]
    for i = #list, 1, -1 do if list[i] == wall then table.remove(list, i); break end end
    if not pending or RANK[pending.kind] > RANK[p.kind] then
      p.after = now() + GATHER
      pending = p
      frame:Show()
    end
  end
  if not ns.Strip.Moment(Moments.Pages(p.kind, p.tag, p.id), held, again) then
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

-- The first time in a zone (Journey.lua's fz: no place in it seen before), said once they've settled there: SETTLE
-- seconds later still in it, on the ground and alive, or a quest taken in it. Never at login, in a dungeon or a city
-- (a rest area: every capital is one), on a flight, or for a character whose record began after its first steps
-- (Journey.Whole: its "first" visits aren't firsts). Its number is the zone name's hash: Willo reads the name live.
local arrived    -- { z }: a first zone, waiting
local function settled()
  local a = arrived
  arrived = nil
  if not a or ns.Context.Place().zone ~= a.z or try(IsResting) or try(UnitOnTaxi, "player")
    or try(UnitIsDeadOrGhost, "player") then return end
  Moments.Queue("zone", ns.Strip.CRC32(a.z) % 16777216)
end
local function firstZone(e)
  if not (e.fz and e.how and not e.inst and type(e.z) == "string") or try(IsResting) then return end
  if not (wants("zone") and ns.Journey.Whole()) then return end
  local a = { z = e.z }
  arrived = a
  if C_Timer and C_Timer.After then C_Timer.After(SETTLE, function() if arrived == a then settled() end end) end
end

-- A quest that ends its line (Storyline: a path of two or more quests, and this its last).
local function endsLine(id)
  local S = ns.Storyline
  if not (S and S.For) then return false end
  local ok, sl, _, at = pcall(S.For, tonumber(id))
  return ok and type(sl) == "table" and type(sl.c) == "table" and #sl.c >= 2 and at == #sl.c
end

-- What the journey records (Journey.lua's add; not what you made).
local function onAdded(k, e)
  local Strip = ns.Strip
  if k == "qt" then
    if wants("line_end") and endsLine(e.id) then Moments.Queue("line_end", e.id)
    else Moments.Queue(ns.Journey.CarriedLong(e.id) and "quest" or "turnin", e.id) end
  elseif k == "qa" then
    if arrived and e.z == arrived.z then settled() end
  elseif k == "zone" then
    firstZone(e)
  elseif k == "boss" and type(e.n) == "string" and FINAL[e.n:lower()] then
    -- A dungeon finished, once a day each (Willo keeps what she said by its number): the day, then the instance's id.
    local inst = tonumber((select(9, pcall(GetInstanceInfo)))) or Strip.CRC32(tostring(e.z))
    Moments.Queue("dungeon", (math.floor(time() / 86400) % 65536) * 65536 + inst % 65536)
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
