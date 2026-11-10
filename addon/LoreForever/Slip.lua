-- The new-page slip (v2 "Your Chronicle", slice 4): when you find a page while playing, a small parchment note at
-- the top of the screen names it for a few seconds: the kind's card with its green "new" ring, "New page", its name and
-- where it sits in your chronicle ("Westfall · People 9 of 20"). Click opens its page, Listen plays it, Shift-click adds
-- it to the playlist, right-click gives the page's options and a way to stop these notes. Never in
-- combat: what you find then waits, and the latest shows once the fight is over. Pages found close together share one
-- slip ("and 2 more"). It sits in the dialog layer, over the windows there and well below the game's level cap, so
-- clicks always land. A left-drag moves it and it keeps its place (Theme.Movable); Options' Move the notes... shows a
-- sample to place. Made the first time a page is found, not at login. Options › New page notes (pageSlip) turns it off.

local _, ns = ...
local Slip = {}
ns.Slip = Slip
local L, T = ns.L, ns.Theme

local SHOW = 6        -- seconds on screen (the mouse over it holds it)
local SAMPLE = 20     -- seconds a sample stays up to be placed, and DROP_ADDS more after each drop
local DROP_ADDS = 5
local W, H = 380, 62
local INK, ACCENT, NOTE = T.color.ink, T.color.inkAccent, T.color.inkNote   -- the book's inks (Theme.lua)

local function S() return (LoreForeverDB and LoreForeverDB.settings) or {} end
local function esc(s) return (tostring(s or ""):gsub("|", "||")) end
local function inCombat()
  local ok, a = pcall(InCombatLockdown)
  if ok and a then return true end
  local ok2, b = pcall(UnitAffectingCombat, "player")
  return ok2 and b and true or false
end
local function ink(fs, c)
  fs:SetTextColor(c[1], c[2], c[3], 1)
  if fs.SetShadowColor then fs:SetShadowColor(0, 0, 0, 0) end
  fs:SetJustifyH("LEFT")
  if fs.SetWordWrap then fs:SetWordWrap(false) end
  return fs
end

Slip.waiting = {}   -- pages found in combat or while a slip is up, newest last

local function create()
  local f = CreateFrame("Button", "LoreForeverPageSlip", UIParent)
  f:SetSize(W, H)
  f:SetFrameStrata("DIALOG")
  f:SetFrameLevel(100)
  f:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  T.Parchment(f, nil, { round = false, edge = 10 })   -- over the game world: no ground to cut round corners in
  -- The kind's card, with the ring of a new page. The slip takes its clicks.
  local tile = T.Tile(f, "place")
  tile:SetSize(40, 40)
  tile:SetPoint("LEFT", 14, 0)
  tile:EnableMouse(false)
  tile:SetState("new")
  -- Listen and the playlist: the pill every story has (11/4). Play plays the page's story now and puts the note away;
  -- the playlist half adds it. Shown only when it has a story.
  local pill = ns.UI.RowPill(f)
  pill:SetPoint("RIGHT", -12, 0)
  pill.play:HookScript("OnClick", function() Slip.Hide() end)
  local label = ink(f:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), ACCENT)
  label:SetPoint("TOPLEFT", tile, "TOPRIGHT", 12, 1)
  label:SetPoint("RIGHT", pill, "LEFT", -8, 0)
  local name = ink(f:CreateFontString(nil, "OVERLAY", "GameFontNormal"), INK)
  name:SetPoint("TOPLEFT", label, "BOTTOMLEFT", 0, -2)
  name:SetPoint("RIGHT", pill, "LEFT", -8, 0)
  local sub = ink(f:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
  sub:SetPoint("TOPLEFT", name, "BOTTOMLEFT", 0, -2)
  sub:SetPoint("RIGHT", pill, "LEFT", -8, 0)
  f.tile, f.pill, f.listen, f.label, f.name, f.sub = tile, pill, pill.play, label, name, sub
  f:SetScript("OnClick", function(self, button)
    local key = self.key
    if not key then return end
    if button == "RightButton" then
      return ns.Book.PageMenu(self, key, "slip", {
        { L["Don't show these notes"], function() Slip.TurnOff() end } })
    end
    if IsShiftKeyDown and IsShiftKeyDown() then
      if ns.UI.CanQueue(key) then ns.UI.DoQueueAction(key) end
      return
    end
    Slip.Hide()
    ns.Page.Show(key, "slip")
  end)
  f:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
    GameTooltip:AddLine(esc(self.name:GetText()))
    T.Tip(self.sample and L["Drag: move it."]
      or L["Click: open its page. Shift-click: add to your playlist. Right-click: options. Drag: move it."], "tipDim", true)
    GameTooltip:Show()
  end)
  f:SetScript("OnLeave", function() GameTooltip:Hide() end)
  -- Counts down while the mouse is away; on screen SHOW seconds in all.
  f:SetScript("OnUpdate", function(self, dt)
    -- An item's rarity is noted just after it's found (Collection.OnItemTooltip): its name takes the colour a tick later.
    if self.reink then self.reink = nil; ns.Book.NameInk(self.name, self.key, INK) end
    if self.held or (self.IsMouseOver and self:IsMouseOver()) then return end
    self.left = (self.left or SHOW) - (dt or 0)
    if self.left <= 0 then Slip.Hide() end
  end)
  -- The fight is over: what was found during it shows now.
  f:SetScript("OnEvent", function() Slip.Flush() end)
  pcall(f.RegisterEvent, f, "PLAYER_REGEN_ENABLED")
  f:SetScript("OnHide", function(self) self.sample = nil end)
  T.Movable(f, "pageSlip", { "TOP", 0, -120 })
  f.onDropped = function(self) if self.sample then self.left = (self.left or 0) + DROP_ADDS end end
  f:Hide()
  Slip.frame = f
  return f
end

-- Shows the newest page waiting, and how many more came with it.
function Slip.Flush()
  local n = #Slip.waiting
  if n == 0 or inCombat() or S().pageSlip == false then return end
  local key = Slip.waiting[n]
  Slip.waiting = {}
  local e = ns.DB and ns.DB.entries[key]
  if not e then return end
  local f = Slip.frame or create()
  local total = n + ((f:IsShown() and f.count) or 0)   -- the pages this slip stands for
  local more = total - 1
  f.key, f.count, f.left, f.reink, f.sample = key, total, SHOW, e.t == "item", nil
  f.label:SetText(more > 0 and string.format(L["New page, and %d more"], more) or L["New page"])
  f.name:SetText(esc(e.n))
  ns.Book.NameInk(f.name, key, INK)   -- an item in its rarity colour, with a thin shadow so the grey reads on paper
  f.tile:SetKind(ns.Book.TileKind(e.t) or "storyline")
  f.tile:SetFigure(e.t == "npc" and ns.Book.Look(key) or nil)   -- someone met: the person standing, not a head
  -- "Westfall · People 9 of 20"; a page Found doesn't list says what it is and where it was found.
  local standing = ns.Book.Standing(key)
  if not standing then
    local rec = ns.Collection.Found(key)
    local kind = ns.Page.KindLabel(e.t)
    standing = rec and rec.place and (kind .. ns.Lang.Dotted(" · ") .. rec.place) or kind
  end
  f.sub:SetText(esc(standing))
  local canListen = ns.UI.StoryAudio(key) and true or false
  ns.UI.SetRowPill(f.pill, key, nil, nil, canListen, key)
  local pill = f.pill:IsShown()
  for _, fs in ipairs({ f.label, f.name, f.sub }) do
    if pill then fs:SetPoint("RIGHT", f.pill, "LEFT", -8, 0) else fs:SetPoint("RIGHT", f, "RIGHT", -14, 0) end
  end
  f:Show()
end

-- A page found while playing (Collection.OnFound).
function Slip.OnFound(key)
  if S().pageSlip == false then return end
  Slip.waiting[#Slip.waiting + 1] = key
  Slip.Flush()
end

function Slip.Hide()
  local f = Slip.frame
  if f then f:Hide(); f.count = nil end
end

-- Options' Move the notes...: a note to place, with no page behind it, so its clicks do nothing.
function Slip.Sample()
  local f = Slip.frame or create()
  f.key, f.count, f.left, f.reink, f.sample = nil, nil, SAMPLE, nil, true
  f.label:SetText(L["New page"])
  f.name:SetText(L["Drag this note where you want it"])
  f.name:SetTextColor(INK[1], INK[2], INK[3], 1)
  f.sub:SetText(L["Sample"])
  f.tile:SetKind("place")
  f.tile:SetFigure(nil)
  f.pill:Hide()
  for _, fs in ipairs({ f.label, f.name, f.sub }) do fs:SetPoint("RIGHT", f, "RIGHT", -14, 0) end
  f:Show()
end

function Slip.IsShown() return Slip.frame and Slip.frame:IsShown() or false end

function Slip.TurnOff()
  S().pageSlip = false
  Slip.Hide()
  Slip.waiting = {}
  DEFAULT_CHAT_FRAME:AddMessage(T.CHAT_PREFIX
    .. L["no more new-page notes. Turn them back on in /lore options (New page notes); Found still marks new pages."])
end

function Slip.Init()
  ns.Collection.OnFound(function(key) Slip.OnFound(key) end)
end
