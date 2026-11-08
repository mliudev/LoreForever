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
local GOLD = "|cffffd100"

local card, waiting

local function say(msg) DEFAULT_CHAT_FRAME:AddMessage(GOLD .. "Lore Forever:|r " .. msg) end

local function build()
  local T = ns.Theme
  local f = CreateFrame("Frame", "LoreForeverPinArrive", UIParent, T.BACKDROP_TEMPLATE)
  f:SetSize(360, 92)
  f:SetPoint("TOP", 0, -170)
  f:SetFrameStrata("HIGH")
  f:EnableMouse(true)
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
  f.clear:SetScript("OnClick", function() PinArrive.Clear(f.pin) end)
  f.keep:SetScript("OnClick", function() f:Hide() end)
  table.insert(UISpecialFrames, "LoreForeverPinArrive")   -- Escape closes it
  f:SetScript("OnUpdate", function(self)
    if GetTime() >= (self.untilT or 0) then self:Hide() end
  end)
  f:SetScript("OnHide", function(self) self.pin = nil end)
  f:Hide()
  return f
end

-- Show the card for pin (a Journey.Pins entry). True when it showed (or will, once the fight is over).
function PinArrive.Reached(pin)
  if type(pin) ~= "table" or not pin.key then return false end
  if InCombatLockdown and InCombatLockdown() then waiting = pin; return true end
  card = card or build()
  card.pin = pin
  card.title:SetText(GOLD .. string.format(L["You reached %s's pin: %s"], ns.COMPANION_NAME or "Willo", pin.title or "")
    .. "|r")
  card.note:SetText(pin.note or "")
  local h = 14 + (tonumber(card.title:GetStringHeight()) or 14) + (pin.note and 4 + (tonumber(card.note:GetStringHeight()) or 12) or 0)
  card:SetHeight(math.max(92, h + 14 + 22 + 14))
  card.untilT = GetTime() + SHOW
  card:Show()
  return true
end

-- Clear pin: off the maps now; Willo takes it out of the notebook after the next save.
function PinArrive.Clear(pin)
  if card then card:Hide() end
  if not (ns.Journey and ns.Journey.ClearPin and ns.Journey.ClearPin(pin)) then return false end
  if ns.WorldPins and ns.WorldPins.Update then pcall(ns.WorldPins.Update) end
  local J = ns.Journey
  if J.FocusMap and J.focus then pcall(J.FocusMap, J.focus) end
  say(string.format(L["Cleared the pin: %s."], pin.title or ""))
  return true
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
