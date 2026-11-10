-- Clear pin, offered when you reach one (LOR-1292, Mike, 11/7, in Goldshire: "I need a way to quickly remove the pin
-- once I go to Goldshire... it needs to be removed somehow more easily"; it took two asks of Willo). WorldPins notices
-- the player reaching a pin they'd been away from and calls Reached: a small card at the top of the screen names it,
-- with its note, and two buttons. Clear pin takes it off the maps at once (Journey.ClearPin), and Willo takes it out of
-- their notebook after their next save; Keep, Escape or SHOW seconds of nothing leave it be. The floating player's
-- look (Hooks.KeyPrompt): solid, a gold rim, buttons sized to their labels. Never in combat: a fight first, then the card.


local _, ns = ...
local L = ns.L

local PinArrive = {}
ns.PinArrive = PinArrive

local SHOW = 30
local SAMPLE, DROP_ADDS = 20, 5   -- seconds a sample stays up to be placed, and more after each drop
local GOLD = "|cffffd100"

local card, waiting

local function say(msg) DEFAULT_CHAT_FRAME:AddMessage(GOLD .. "Lore Forever:|r " .. msg) end

local function build()
  local T = ns.Theme
  local f = CreateFrame("Frame", "LoreForeverPinArrive", UIParent, T.BACKDROP_TEMPLATE)
  f:SetSize(360, 92)
  f:SetFrameStrata("DIALOG")   -- with the new-page note: over the windows, and well below the game's level cap
  f:SetFrameLevel(100)
  local bg = T.Area(f, "dock")
  bg:SetPoint("TOPLEFT", 2, -2)
  bg:SetPoint("BOTTOMRIGHT", -2, 2)
  T.Backdrop(f, "dock")
  f.title = f:CreateFontString(nil, "OVERLAY", T.font.body)
  f.title:SetPoint("TOPLEFT", 16, -14)
  f.title:SetPoint("TOPRIGHT", -16, -14)
  f.title:SetJustifyH("LEFT")
  f.note = f:CreateFontString(nil, "OVERLAY", T.font.small)
  f.note:SetPoint("TOPLEFT", f.title, "BOTTOMLEFT", 0, -4)
  f.note:SetPoint("TOPRIGHT", f.title, "BOTTOMRIGHT", 0, -4)
  f.note:SetJustifyH("LEFT")
  local function button(label, least)
    local b = T.Button(f, label)
    b:SetSize(math.max(least, (T.TextWidth(b:GetFontString()) or 0) + 24), 22)
    return b
  end
  f.clear = button(L["Clear pin"], 100)
  f.clear:SetPoint("BOTTOMLEFT", 16, 14)
  f.keep = button(L["Keep"], 80)
  f.keep:SetPoint("BOTTOMRIGHT", -16, 14)
  f.clear:SetScript("OnClick", function() if f.pin then PinArrive.Clear(f.pin) else f:Hide() end end)   -- (no pin: a sample)
  f.keep:SetScript("OnClick", function() f:Hide() end)
  table.insert(UISpecialFrames, "LoreForeverPinArrive")   -- Escape closes it
  -- Counts down while the mouse is away, like the new-page note.
  f:SetScript("OnUpdate", function(self, dt)
    if self.held or (self.IsMouseOver and self:IsMouseOver()) then return end
    self.left = (self.left or SHOW) - (dt or 0)
    if self.left <= 0 then self:Hide() end
  end)
  f:SetScript("OnHide", function(self) self.pin, self.sample = nil, nil end)
  f:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
    T.Tip(L["Drag: move it."], "tipDim")
    GameTooltip:Show()
  end)
  f:SetScript("OnLeave", function() GameTooltip:Hide() end)
  T.Movable(f, "pinCard", { "TOP", 0, -190 })   -- (under the new-page note, so the two never overlap where they start)
  f.onDropped = function(self) if self.sample then self.left = (self.left or 0) + DROP_ADDS end end
  f:Hide()
  return f
end

-- The card's words, and its height to fit them.
local function fill(title, note)
  card.title:SetText(GOLD .. string.format(L["You reached %s's pin: %s"], ns.COMPANION_NAME or "Willo", title) .. "|r")
  card.note:SetText(note or "")
  local h = 14 + (tonumber(card.title:GetStringHeight()) or 14) + (note and 4 + (tonumber(card.note:GetStringHeight()) or 12) or 0)
  card:SetHeight(math.max(92, h + 14 + 22 + 14))
end

-- Show the card for pin (a Journey.Pins entry). True when it showed (or will, once the fight is over).
function PinArrive.Reached(pin)
  if type(pin) ~= "table" or not pin.key then return false end
  if InCombatLockdown and InCombatLockdown() then waiting = pin; return true end
  card = card or build()
  card.pin, card.sample = pin, nil
  fill(pin.title or "", pin.note)
  card.left = SHOW
  card:Show()
  return true
end

-- Options' Move the notes...: a card to place, with no pin behind it, so both its buttons just put it away.
function PinArrive.Sample()
  card = card or build()
  card.pin, card.sample = nil, true
  fill(L["Drag this card too"], nil)
  card.left = SAMPLE
  card:Show()
end

-- Clear pin: off the maps now; Willo takes it out of the notebook after the next save.
function PinArrive.Clear(pin)
  if card and card.pin and card.pin.key == pin.key then card:Hide() end
  if not (ns.Journey and ns.Journey.ClearPin and ns.Journey.ClearPin(pin)) then return false end
  if ns.WorldPins and ns.WorldPins.Update then pcall(ns.WorldPins.Update) end
  local J = ns.Journey
  if J.FocusMap and J.focus then pcall(J.FocusMap, J.focus) end
  say(string.format(L["Cleared the pin: %s."], pin.title or ""))
  return true
end

-- Right-clicking one of Willo's pins takes it off, on any map, every time (Mike, 11/8: "right clicking the pin to remove
-- it"). A pin frame's OnMouseUp, self.pin its Journey.Pins entry. Only our own frames and saved data, so safe in a fight.
function PinArrive.PinMouseUp(self, button)
  if button ~= "RightButton" or not self.pin or not self:IsMouseOver() then return end
  if GameTooltip:IsOwned(self) then GameTooltip:Hide() end
  PinArrive.Clear(self.pin)
end

-- What the sims read: the card, if it's up ({title, note}).
function PinArrive.Shown()
  if not (card and card:IsShown()) then return nil end
  return { title = card.title:GetText(), note = card.note:GetText(), key = card.pin and card.pin.key }
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_REGEN_ENABLED")
events:SetScript("OnEvent", function()
  local pin = waiting
  waiting = nil
  if pin then PinArrive.Reached(pin) end
end)
