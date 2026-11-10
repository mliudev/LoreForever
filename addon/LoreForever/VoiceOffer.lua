-- The quiet voice button (LOR-1348; Mike, 11/9: "Build both"): where a free download has the voice for a quest page or a
-- story, its play button shows dimmed with a small gold arrow (T.SetPillOffer), and goes by itself once the voice is in
-- the add-on list. Players who came through CurseForge never see the site's Downloads page, and a voice they don't have
-- is otherwise just missing. Voice.QuestDownload and Voice.StoryDownload decide whether a download really has it, so
-- the button never promises a recording that isn't out. Add-ons can't open web pages: a click shows the link to copy.
-- Right-click hides them all for good; a tick beside Get more voices in Options brings them back. One chat line, once
-- per account, says what it is, the first time one shows outside a fight or an instance.
local _, ns = ...
local L = ns.L

local VoiceOffer = {}
ns.VoiceOffer = VoiceOffer

local function S() return LoreForeverDB.settings end

function VoiceOffer.Enabled() return S().voiceOffers ~= false end

-- "quest" for a quest page a download has (qid, its page kind and game level; text: the words to check, the quest
-- window's when left out), else nil.
function VoiceOffer.ForQuest(qid, kind, level, text)
  if not VoiceOffer.Enabled() then return nil end
  local ok, has = pcall(ns.Voice.QuestDownload, qid, kind, level, text)
  return ok and has and "quest" or nil
end

-- "story" for a story a download has, else nil.
function VoiceOffer.ForStory(key)
  if not VoiceOffer.Enabled() then return nil end
  local ok, has = pcall(ns.Voice.StoryDownload, key)
  return ok and has and "story" or nil
end

-- A button of this kind is on screen: the one explaining line, unless it's been said.
function VoiceOffer.Showing(kind)
  local s = S()
  if s.voiceOfferExplained then return end
  if InCombatLockdown and InCombatLockdown() then return end
  if IsInInstance then
    local ok, inside = pcall(IsInInstance)
    if ok and inside then return end
  end
  s.voiceOfferExplained = true
  DEFAULT_CHAT_FRAME:AddMessage("|cffffd100Lore Forever:|r " .. (kind == "quest"
    and L["A dimmed play button means that quest has a free voice to download. Hover it for the link."]
    or L["A dimmed play button means that story has a free voice to download. Hover it for the link."]))
end

-- Every button on screen looks again (Right-click, the Options tick). Nothing that's playing stops.
local function refresh()
  if ns.Hooks and ns.Hooks.UpdateQuestPlayButton then ns.Hooks.UpdateQuestPlayButton() end
  if ns.UI and ns.UI.frame and ns.UI.UpdateListen then ns.UI.UpdateListen() end
  if ns.Page and ns.Page.RefreshOffer then ns.Page.RefreshOffer() end
end

function VoiceOffer.SetEnabled(on)
  S().voiceOffers = on and true or false
  if not on and VoiceOffer.box then VoiceOffer.box:Hide() end
  refresh()
end

local box
local function createBox()
  local T = ns.Theme
  local f = T.Window("LoreForeverMoreVoices", UIParent, L["More voices"])
  f:SetSize(420, 130)
  f:SetFrameStrata("DIALOG")
  table.insert(UISpecialFrames, "LoreForeverMoreVoices")
  local how = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  how:SetPoint("TOPLEFT", 18, -34)
  how:SetPoint("RIGHT", -18, 0)
  how:SetJustifyH("LEFT")
  -- The link can't be edited: typing puts it back, so a stray key never breaks it.
  local eb = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
  eb:SetSize(376, 24)
  eb:SetPoint("TOPLEFT", how, "BOTTOMLEFT", 6, -8)
  eb:SetAutoFocus(false)
  local function fill()
    eb:SetText(ns.Voice.DOWNLOADS)
    eb:SetCursorPosition(0)
    eb:HighlightText()
  end
  eb:SetScript("OnTextChanged", function(_, user) if user then fill() end end)
  eb:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
  eb:SetScript("OnMouseUp", function(self) self:HighlightText() end)
  eb:SetScript("OnEscapePressed", function() f:Hide() end)
  local after = f:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  after:SetPoint("BOTTOMLEFT", 18, 14)
  after:SetText(L["Installed it? Type /reload."])
  f:SetScript("OnShow", function()
    fill()
    eb:SetFocus()
  end)
  f:SetScript("OnHide", function() eb:ClearFocus() end)
  T.Movable(f, "moreVoices", { "TOP", 0, -140 })
  f.how = how
  f:Hide()
  return f
end

local function showBox()
  box = box or createBox()
  VoiceOffer.box = box
  local mac = IsMacClient and IsMacClient()
  box.how:SetText(mac and L["Press Cmd+C, then paste it into your browser."]
    or L["Press Ctrl+C, then paste it into your browser."])
  box:Show()
end

function VoiceOffer.Click(button)
  GameTooltip:Hide()
  if button == "RightButton" then return VoiceOffer.SetEnabled(false) end
  showBox()
end

function VoiceOffer.Tip(owner, kind)
  GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
  GameTooltip:AddLine("Lore Forever")
  GameTooltip:AddLine(kind == "quest" and L["A voice for this quest is a free download."]
    or L["A voice for this story is a free download."], 1, 1, 1)
  ns.Theme.Tip(L["Click for the link. Right-click to hide these."], "tipDim", true)
  GameTooltip:Show()
end
