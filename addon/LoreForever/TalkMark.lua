-- The talk mark (LOR-910, Mike's pick "A and B", 11/11): players didn't know a character they target can answer them
-- out loud ("it's like a different button that you have to press"). When the target is a character who would answer
-- in person, a small mark sits beside the target frame: the first WORDS times "Hold F7 and ask out loud" (their real
-- key), after that a microphone and the key. Their tooltip gets the same line. Silent: no sound, no pop-up, nothing to
-- click or dismiss (the mark takes no mouse). Options › "Show who can answer you" (talkMark) turns both off.
--
-- A mark on someone who then doesn't answer is a broken promise, so everything here can only take marks away (the
-- Architect's review, 11/11). It shows only when all of these hold:
-- * Willo said lately (Strip.FromWilloLately: her Data.lua under two weeks old) that her plan lets characters answer
--   that key (npcTalk true; false on Free and Hero after the first days, where the key gets "Speaking with NPCs needs
--   the Champion plan or higher."; left out signed out). An older Willo writes neither this nor talkKinds: no mark.
-- * Her key for the one you target (targetKey: what her microphone listens on) is set, and the game has it on Ask who
--   you're targeting, so holding it shows her sky. Another key the player bound to that action shows the sky but she
--   wouldn't hear them, so it's never the one shown.
-- * Live game info is on (Strip.On): with it off she can't see who you target, and the key goes to whoever answered
--   last. The mark never asks for it (that stays an explained yes).
-- * Who would answer is Willo's rule, not a copy of it: she writes the creature types that answer in person
--   (talkKinds, her talk/voices.py KINDS less SILENT) and the add-on reads the target's type the way the sky sends it
--   to her (Strip.CreatureType). Like her answer.stranger: never hostile (reaction 1-3, strip.py's `hostile`), never
--   another player. Two of the add-on's own, which only take marks away: not dead, not a player's pet or minion.
-- Never on a nameplate (the design roast moved it off): beside the target frame, the game's or another add-on's. Our
-- frame is anchored to theirs, never theirs to ours, and only out of combat; in combat it only shows or hides.

local _, ns = ...
local TalkMark = {}
ns.TalkMark = TalkMark
local L = ns.L

local WORDS = 5                      -- targets that show the words before it's just the mark
local MIC = "Interface\\AddOns\\LoreForever\\Media\\Willo\\Mic"   -- scripts/willo_icon_texture.py
local ASK_TARGET = "LOREFOREVER_ASKTARGET"
-- Target frames, the game's first; another add-on's when it has hidden the game's. None showing: no mark.
local FRAMES = { "TargetFrame", "ElvUF_Target", "SUFUnittarget", "PitBull4_Frames_Target", "XPerl_Target",
  "LUFUnittarget", "oUF_Target" }

local function S() return (LoreForeverDB and LoreForeverDB.settings) or {} end
local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b = pcall(fn, ...)
  if ok then return a, b end
end

-- What Willo said, when the mark may show at all (above): her data, or nil.
local function willo()
  if S().talkMark == false or not ns.Companion.Installed() or not ns.Strip.On() then return nil end
  local d = ns.Strip.FromWilloLately()
  if not d or d.npcTalk ~= true or type(d.talkKinds) ~= "table" then return nil end
  if type(d.targetKey) ~= "string" or d.targetKey == "" or try(GetBindingAction, d.targetKey) ~= ASK_TARGET then
    return nil
  end
  return d
end

-- Her key for the one you target, as the game shows it ("F7"), when the mark may show; else nil.
function TalkMark.Key()
  local d = willo()
  if not d then return nil end
  local shown = try(GetBindingText, d.targetKey)
  return (type(shown) == "string" and shown ~= "") and shown or d.targetKey
end

-- Whether `unit` would answer in person (Willo's rule, above).
function TalkMark.Answers(unit)
  local d = willo()
  if not d or try(UnitExists, unit) ~= true then return false end
  if try(UnitIsPlayer, unit) or try(UnitPlayerControlled, unit) or try(UnitIsDead, unit) then return false end
  local reaction = try(UnitReaction, unit, "player")
  if type(reaction) == "number" and reaction >= 1 and reaction <= 3 then return false end
  local kind = ns.Strip.CreatureType(unit)
  for _, k in ipairs(d.talkKinds) do
    if k == kind then return true end
  end
  return false
end

local function line(key)
  return L["Hold %s and ask out loud"]:format("|cffffffff" .. key:gsub("|", "||") .. "|r")
end

-- The tooltip's line for `unit` (Hooks.lua, for the character under the mouse), or nil. The key reaches your target,
-- not whoever the mouse is over, so on someone you haven't targeted it says to target them first (Design Lead, 11/11).
function TalkMark.TooltipLine(unit)
  local key = TalkMark.Key()
  if not (key and TalkMark.Answers(unit)) then return nil end
  local text = try(UnitIsUnit, unit, "target") and line(key)
    or L["Target them, then hold %s and ask out loud"]:format("|cffffffff" .. key:gsub("|", "||") .. "|r")
  return "|T" .. MIC .. ":14:14:0:0:32:32:0:32:0:32:127:224:220|t " .. text
end

local mark, words, shownFor
local function create()
  local f = CreateFrame("Frame", "LoreForeverTalkMark", UIParent)
  f:SetSize(40, 22)
  f:EnableMouse(false)   -- a label, not a button: never in the way of a click
  f:Hide()
  ns.Theme.Area(f, { 0.043, 0.071, 0.157, 0.94 }, "BACKGROUND"):SetAllPoints()
  ns.Theme.Outline(f, "willo", "BORDER")
  local mic = f:CreateTexture(nil, "ARTWORK")
  mic:SetTexture(MIC)
  mic:SetSize(14, 14)
  mic:SetPoint("LEFT", 6, 0)
  mic:SetVertexColor(ns.Theme.rgba(ns.Theme.color.willo))
  local text = f:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  text:SetPoint("LEFT", mic, "RIGHT", 4, 0)
  text:SetJustifyH("LEFT")
  text:SetWordWrap(false)
  text:SetTextColor(0.741, 0.953, 0.925)
  f.mic, f.text = mic, text
  return f
end

local function targetFrame()
  for _, name in ipairs(FRAMES) do
    local f = _G[name]
    if type(f) == "table" and f.IsVisible and try(f.IsVisible, f) then return f end
  end
end

-- Show, change or hide the mark for the target now. counted: this is a new target (PLAYER_TARGET_CHANGED), so one
-- of the first WORDS times when it shows.
function TalkMark.Update(counted)
  local key = TalkMark.Key()
  local at = key and TalkMark.Answers("target") and targetFrame()
  if at and (not mark or mark.at ~= at) and try(InCombatLockdown) then at = nil end   -- placed after combat
  if not at then
    if mark then mark:Hide() end
    if not key or not TalkMark.Answers("target") then shownFor = nil end
    return
  end
  mark = mark or create()
  local guid = try(UnitGUID, "target")
  if counted or not shownFor or guid ~= shownFor then
    local n = tonumber(S().talkMarkWords) or 0
    words = n < WORDS
    if words and LoreForeverDB and LoreForeverDB.settings then S().talkMarkWords = n + 1 end
    ns.Log.Use("talkMark", words and "words" or "mark")
    shownFor = guid or true
  end
  mark.text:SetText(words and line(key) or "|cffffffff" .. key:gsub("|", "||") .. "|r")
  mark:SetWidth(6 + 14 + 4 + math.ceil(ns.Theme.TextWidth(mark.text) or 60) + 8)
  if mark.at ~= at then
    mark:ClearAllPoints()
    mark:SetPoint("LEFT", at, "RIGHT", 4, 0)
    mark:SetFrameStrata(try(at.GetFrameStrata, at) or "MEDIUM")
    mark:SetFrameLevel((tonumber(try(at.GetFrameLevel, at)) or 1) + 5)
    mark.at = at
  end
  mark:Show()
end

-- Events only, no OnUpdate: a new target, the target's faction, the key's binding, and the end of combat (a mark that
-- had to wait to be placed).
local events = CreateFrame("Frame")
for _, e in ipairs({ "PLAYER_TARGET_CHANGED", "PLAYER_ENTERING_WORLD", "UPDATE_BINDINGS", "PLAYER_REGEN_ENABLED" }) do
  pcall(events.RegisterEvent, events, e)
end
pcall(events.RegisterUnitEvent or events.RegisterEvent, events, "UNIT_FACTION", "target")
events:SetScript("OnEvent", function(_, event, unit)
  if event == "UNIT_FACTION" and unit ~= "target" then return end
  TalkMark.Update(event == "PLAYER_TARGET_CHANGED")
end)
