-- Storylines (LOR-198, LOR-199): whether a quest is part of a storyline, from the pipeline's quest chains
-- (lore.storylines; ns.DB.storylines and ns.DB.index.story, see compile_lua). The quest window and the quest log say
-- so under the quest's title, in its text (Hooks.QuestInfoStory), and so does the top of the quest's Lore entry (UI):
--   "Storyline · Westfall: The Defias Brotherhood"
-- Turning in one of its quests names who gives the next, when the game has already sent you to them.
-- It never says which step a quest is, how many there are, or where the storyline starts or ends. Wording:
-- "Storyline", never main story, side quest or filler. A storyline is named after its first quest, and that name
-- shows only once that quest is started (or "Show spoilers without asking" is on). Quests up to level 40 count, with
-- lore entries or without; a quest in no storyline shows nothing.

local _, ns = ...
local Storyline = {}
ns.Storyline = Storyline
local L = ns.L
local T = ns.Theme

local function S() return (LoreForeverDB and LoreForeverDB.settings) or {} end
local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b, c = pcall(fn, ...)
  if ok then return a, b, c end
end

-- Options › Show storylines on quests, Options › Storyline hints in chat.
function Storyline.Shown() return S().storylines ~= false end
function Storyline.ChatOn() return S().storylineChat ~= false end

local function faction()
  local f = try(UnitFactionGroup, "player")
  return (f == "Alliance" and "A") or (f == "Horde" and "H") or nil
end

-- The storyline quest `id` is part of for this character, its id, and where the quest sits in it (0: a side quest
-- off its main path; the order is only used to find who gives the next quest). nil when it's in none, or only in the
-- other faction's.
function Storyline.For(id)
  local db = ns.DB
  local at = type(id) == "number" and db and db.index and db.index.story and db.index.story[id]
  if not at then return nil end
  local mine = faction()
  for i = 1, #at, 2 do
    local sl = db.storylines and db.storylines[at[i]]
    if sl and (not sl.f or not mine or sl.f == mine) then return sl, at[i], at[i + 1] end
  end
end

-- Whether this character has turned in quest `id` (the journey's list, else the server's flag).
function Storyline.Done(id)
  local set = ns.Context.Done()
  if set and set[id] then return true end
  local QL = _G.C_QuestLog
  return (QL and try(QL.IsQuestFlaggedCompleted, id)) == true
end

local function started(id, current)
  return id == current or Storyline.Done(id) or (ns.Hooks and ns.Hooks.activeQuests[id] ~= nil)
end

local function entryName(key)
  local e = key and ns.DB.entries[key]
  return e and e.n
end

local function placeName(zk)
  if not zk then return nil end
  local z = ns.DB.zones and ns.DB.zones[zk]
  return entryName("zone:" .. zk) or (z and z.n)
end

-- The storyline's name: its first quest's title in the player's language (its lore entry's, else the game's own), or
-- nil while that quest isn't started: it could be one the player hasn't met. `current`: the quest on screen, which
-- counts as started.
function Storyline.Name(sl, current)
  local first = sl.c[1]
  if not (S().showSpoilers or started(first, current)) then return nil end
  local QL = _G.C_QuestLog
  local title = QL and try(QL.GetTitleForQuestID, first)
  return entryName(sl.k) or (type(title) == "string" and title ~= "" and title) or sl.n
end

-- "Storyline · Westfall: The Defias Brotherhood" for quest `id` ("Storyline · Westfall" while the name can't show),
-- then the storyline; nil for a quest in no storyline, or with the option off. `short` leaves the zone out where
-- there's a name, for a line with little room (its tooltip has it all).
function Storyline.Line(id, force, short)
  if not (force or Storyline.Shown()) then return nil end
  local sl = Storyline.For(id)
  if not sl then return nil end
  local name, zone = Storyline.Name(sl, id), placeName(sl.z)
  if name and short then zone = nil end
  local what = (name and zone and zone ~= name and (zone .. ": " .. name)) or name or zone
  return what and (L["Storyline"] .. ns.Lang.Dotted(" · ") .. what) or L["Storyline"], sl
end

-- Turning in a storyline quest -----------------------------------------------------------------------------------------

-- What the quest giver said at the turn-in (QUEST_COMPLETE), to tell whether it names who comes next.
local lastReward

function Storyline.OnQuestComplete()
  local id = try(GetQuestID)
  if type(id) == "number" and id > 0 then lastReward = { id = id, text = try(GetRewardText) or "" } end
end

-- The NPC's name in the player's language: their lore entry's (translated) name, else the name as the data has it.
local function npcName(name)
  if type(name) ~= "string" or name == "" then return nil end
  local key = ns.DB.index.name[ns.Engine.lower(name)]
  local e = key and ns.DB.entries[key]
  return (e and e.t == "npc" and e.n) or name
end

-- Where the player met `name`, from the journey's record of people met (the newest), as the subzone or the zone.
local function metAt(name)
  local c = ns.Context.Journey()
  local events = c and type(c.events) == "table" and c.events or {}
  for i = #events, 1, -1 do
    local e = events[i]
    if type(e) == "table" and e.k == "npc" and e.n == name then return e.s or e.z end
  end
end

-- Who gives quest `id` and who takes it in: its lore entry's, else the storyline's own record of them.
local function giverAndEnder(sl, id)
  local e = ns.DB.entries[ns.DB.index.quest[id] or ""]
  if e and e.m then return e.m.start, e.m["end"] end
  local w = sl.who and sl.who[id]
  if w then return w[1], w[2] end
end

-- Who gives the quest after `turnedIn` on the storyline's path (at position `at`), but only when the game has
-- already named them: they're who you just turned it in to (the next one is offered right there), or the turn-in
-- text names them. Then where: here, or where you met them. Returns the name and place, or nil.
function Storyline.NextGiver(sl, at, turnedIn)
  local nextId = sl.c[at + 1]
  local start = nextId and giverAndEnder(sl, nextId)
  if not start or start == "" then return nil end
  local _, ender = giverAndEnder(sl, turnedIn)
  local name = npcName(start)
  if ender == start then
    local p = ns.Context.Place()
    return name, p.subzone or p.zone
  end
  local said = lastReward and lastReward.id == turnedIn and lastReward.text or ""
  if said:find(name, 1, true) or said:find(start, 1, true) then return name, metAt(name) end
end

-- QUEST_TURNED_IN: "The Defias Brotherhood · Next: Gryan Stoutmantle, Sentinel Hill." Only for a storyline quest
-- whose next quest's giver the game has already named; nothing otherwise, and nothing at a storyline's last quest.
function Storyline.OnTurnIn(id)
  if not Storyline.ChatOn() then return end
  local sl, _, at = Storyline.For(id)
  if not sl or at == 0 or at >= #sl.c then return end
  local who, where = Storyline.NextGiver(sl, at, id)
  if not who then return end
  local zone = placeName(sl.z)
  local label = Storyline.Name(sl, id) or (zone and (L["Storyline"] .. ns.Lang.Dotted(" · ") .. zone)) or L["Storyline"]
  local msg = label .. ns.Lang.Dotted(" · ") .. (where and string.format(L["Next: %s, %s."], who, where)
    or string.format(L["Next: %s."], who))
  DEFAULT_CHAT_FRAME:AddMessage(T.CHAT_PREFIX .. msg)
  return msg
end

-- Its own events, whether or not "Remember my journey" is on.
local frame = CreateFrame("Frame")
for _, e in ipairs({ "QUEST_COMPLETE", "QUEST_TURNED_IN" }) do pcall(frame.RegisterEvent, frame, e) end
frame:SetScript("OnEvent", function(_, event, id)
  if not (ns.DB and LoreForeverDB and LoreForeverDB.settings and ns.Hooks) then return end   -- before login
  if event == "QUEST_COMPLETE" then pcall(Storyline.OnQuestComplete)
  elseif event == "QUEST_TURNED_IN" then pcall(Storyline.OnTurnIn, id) end
end)
