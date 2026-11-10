-- One way to move things (LOR-1367; Mike, 11/9, on 1.5.0: "We shouldn't have 10 different ways of doing something",
-- and "there's no done button for some of these"). The things that aren't windows, the subtitles, the new-page note,
-- the pin card and Willo's sky, move together in one move mode: each shows (a sample if nothing real is up), outlined in
-- gold, and a plain drag moves it. They stay up until Done, Escape, or the same button again. Put them back returns all
-- of them to where they start. Every Move button in Options and /lore move (sky, subtitles) open this. Windows aren't
-- in it: they drag by themselves any time (Theme.Movable).
local _, ns = ...
local L = ns.L

local Move = {}
ns.Move = Move

local bar
local on = false

function Move.On() return on end

-- What takes part now: the subtitles if they're on, the new-page note if those notes are on, the pin card, and the
-- sky if Willo is installed.
local function parts()
  local S = (LoreForeverDB and LoreForeverDB.settings) or {}
  return {
    subtitles = ns.Subtitles and ns.Subtitles.On() or false,
    note = S.pageSlip ~= false,
    pin = true,
    sky = (ns.Companion and ns.Companion.Installed() and ns.Sky) and true or false,
  }
end

local function makeBar()
  local T = ns.Theme
  local f = CreateFrame("Frame", "LoreForeverMoveBar", UIParent, T.BACKDROP_TEMPLATE)
  -- The dialog layer the sky's bar used, whose buttons took clicks over everything (10/18): over Options too.
  f:SetFrameStrata("FULLSCREEN_DIALOG")
  if f.SetToplevel then f:SetToplevel(true) end
  f:SetClampedToScreen(true)
  f:EnableMouse(true)
  local bg = T.Area(f, "dock")
  bg:SetPoint("TOPLEFT", 2, -2)
  bg:SetPoint("BOTTOMRIGHT", -2, 2)
  T.Backdrop(f, "dock")
  f:SetSize(340, 64)
  local text = f:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  text:SetPoint("TOP", 0, -10)
  text:SetWidth(320)
  text:SetText(L["Drag anything outlined in gold where you want it."])
  local function button(label, point, x)
    local b = T.Button(f, label)
    b:SetSize(130, 22)
    b:SetPoint(point, f, "BOTTOM", x, 10)
    return b
  end
  f.done = button(L["Done"], "BOTTOMRIGHT", -4)
  f.done:SetScript("OnClick", function() Move.Stop() end)
  f.back = button(L["Put them back"], "BOTTOMLEFT", 4)
  f.back:SetScript("OnClick", function() Move.PutBack() end)
  f.back:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
    GameTooltip:AddLine(L["Put them back"])
    T.Tip(L["Everything outlined goes back to where it starts."], "tipText", true)
    GameTooltip:Show()
  end)
  f.back:SetScript("OnLeave", function() GameTooltip:Hide() end)
  -- Escape is Done. (Hidden first: a new frame is shown, and hiding it here mustn't end the move it opens for.)
  f:Hide()
  table.insert(UISpecialFrames, "LoreForeverMoveBar")
  f:SetScript("OnHide", function() if on then Move.Stop() end end)
  -- Never under what's being moved: the sky and the subtitles draw over the bar while they move, and a bar under the
  -- sky took no clicks (10/18). A few looks a second.
  local wait = 0
  f:SetScript("OnUpdate", function(_, dt)
    wait = wait + (dt or 0)
    if wait < 0.2 then return end
    wait = 0
    Move.PlaceBar()
  end)
  return f
end

-- Where the bar can go, in order: the top middle, the middle, above the bottom bars. (point, y)
local SPOTS = { { "TOP", -40 }, { "CENTER", 60 }, { "BOTTOM", 220 } }

local function rect(f)
  if not (f and f.IsShown and f:IsShown() and f.GetLeft) then return nil end
  local l, r, b, t = f:GetLeft(), f:GetRight(), f:GetBottom(), f:GetTop()
  if not (l and r and b and t) then return nil end
  local s = (f.GetEffectiveScale and f:GetEffectiveScale() or 1) / (UIParent:GetEffectiveScale() or 1)
  return l * s, r * s, b * s, t * s
end

-- The bar's rect at a spot, in UIParent's units.
local function spotRect(spot)
  local sw, sh = UIParent:GetWidth() or 1024, UIParent:GetHeight() or 768
  local w, h = bar:GetWidth() or 340, bar:GetHeight() or 64
  local top
  if spot[1] == "TOP" then top = sh + spot[2]
  elseif spot[1] == "CENTER" then top = sh / 2 + spot[2] + h / 2
  else top = spot[2] + h end
  return sw / 2 - w / 2, sw / 2 + w / 2, top - h, top
end

-- The first spot clear of everything being moved.
function Move.PlaceBar()
  if not bar then return end
  local others = {}
  for _, f in ipairs({ ns.Sky and ns.Sky.Frame and ns.Sky.Frame(), ns.Subtitles and ns.Subtitles.frame,
      ns.Slip and ns.Slip.frame, ns.PinArrive and ns.PinArrive.Frame and ns.PinArrive.Frame() }) do
    local l, r, b, t = rect(f)
    if l then others[#others + 1] = { l, r, b, t } end
  end
  local pick = SPOTS[1]
  for _, spot in ipairs(SPOTS) do
    local l, r, b, t = spotRect(spot)
    local clear = true
    for _, o in ipairs(others) do
      if l < o[2] and r > o[1] and b < o[4] and t > o[3] then clear = false break end
    end
    if clear then pick = spot break end
  end
  if bar.spot == pick then return end
  bar.spot = pick
  bar:ClearAllPoints()
  bar:SetPoint(pick[1], UIParent, pick[1], 0, pick[2])
end

-- A gold outline on a frame while it can be moved.
local function mark(f, shown)
  if not f then return end
  if shown and not f.moveOutline and ns.Theme.Outline then f.moveOutline = ns.Theme.Outline(f, "gold", "OVERLAY", 2, 3) end
  if f.moveOutline then f.moveOutline:SetShown(shown and true or false) end
end

local function markAll(shown)
  mark(ns.Subtitles and ns.Subtitles.frame, shown)
  mark(ns.Slip and ns.Slip.frame, shown)
  mark(ns.PinArrive and ns.PinArrive.Frame and ns.PinArrive.Frame(), shown)
end

function Move.Start()
  if on then return end
  on = true
  local p = parts()
  Move.parts = p
  if p.subtitles then ns.Subtitles.Move(true) end
  if p.note and not ns.Slip.IsShown() then ns.Slip.Sample() end
  if p.pin and not (ns.PinArrive.Shown() and not ns.PinArrive.IsSample()) then ns.PinArrive.Sample() end
  if p.sky then ns.Sky.Move(true) end
  markAll(true)
  bar = bar or makeBar()
  bar.spot = nil
  Move.PlaceBar()
  bar:Show()
end

function Move.Stop()
  if not on then return end
  on = false
  local p = Move.parts or {}
  markAll(false)
  if p.subtitles then ns.Subtitles.Move(false) end
  ns.Slip.HideSample()
  ns.PinArrive.HideSample()
  if p.sky then ns.Sky.Move(false) end
  if bar and bar:IsShown() then bar:Hide() end
end

-- The same button again, or /lore move again: Done.
function Move.Toggle()
  if on then Move.Stop() else Move.Start() end
end

-- Put them back: everything in it, where it starts.
function Move.PutBack()
  local p = Move.parts or parts()
  if p.subtitles then ns.Subtitles.Reset() end
  ns.Theme.ResetMovable({ "pageSlip", "pinCard" })
  if p.sky then ns.Sky.PutBack() end
end
