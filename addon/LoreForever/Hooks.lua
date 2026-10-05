-- Ways in that don't need /lore: tooltip lines on NPCs and items, a Lore button on quest frames, clickable chat
-- links, the addon compartment, and a one-time prompt to bind a key.
-- Everything here touches Blizzard frames that may differ on the Forever client, so each hook checks first.

local _, ns = ...
local Hooks = {}
ns.Hooks = Hooks
local L = ns.L

local GOLD, GREY = "|cffffd100", "|cff9d9d9d"
local function loreTag() return "|cffd4a017" .. L["Lore:"] .. "|r " end
local LINK = "addon:LoreForever:"

local function S() return (LoreForeverDB and LoreForeverDB.settings) or {} end
local function say(msg) DEFAULT_CHAT_FRAME:AddMessage(GOLD .. "Lore Forever:|r " .. msg) end
local function esc(s) return (tostring(s or ""):gsub("|", "||")) end

-- Quest state the item notes need, refreshed on QUEST_LOG_UPDATE rather than per tooltip.
Hooks.activeQuests = {}
function Hooks.RefreshQuests()
  local active = {}
  for _, q in ipairs(ns.Context.Quests()) do if q.id then active[q.id] = q end end
  Hooks.activeQuests = active
end

local function questDone(id)
  local QL = _G.C_QuestLog
  if QL and QL.IsQuestFlaggedCompleted then
    local ok, done = pcall(QL.IsQuestFlaggedCompleted, id)
    return ok and done
  end
  return false
end

local function questEntry(id)
  local k = ns.DB.index.quest[id]
  return k and ns.DB.entries[k], k
end

-- Tooltip lines for an item: why you might want to keep it, then its story. At most two lines, often none.
-- What the game itself says about quest items in your bags (itemID -> {questID, isActive, isQuestItem}). This covers
-- delivery items and quest starters the wiki data misses, refreshed on BAG_UPDATE_DELAYED.
Hooks.bagInfo = {}
function Hooks.RefreshBags()
  local CC, info = _G.C_Container, {}
  if CC and CC.GetContainerNumSlots and CC.GetContainerItemInfo and CC.GetContainerItemQuestInfo then
    for bag = 0, (NUM_BAG_SLOTS or 4) do
      local okN, n = pcall(CC.GetContainerNumSlots, bag)
      for slot = 1, (okN and n or 0) do
        local ok, ii = pcall(CC.GetContainerItemInfo, bag, slot)
        if ok and ii and ii.itemID then
          local okQ, qi = pcall(CC.GetContainerItemQuestInfo, bag, slot)
          if okQ and qi and (qi.isQuestItem or qi.questID) then
            info[ii.itemID] = { questID = qi.questID, isActive = qi.isActive, isQuestItem = qi.isQuestItem }
          end
        end
      end
    end
  end
  Hooks.bagInfo = info
end

local function questTitle(id)
  local e = questEntry(id)
  if e then return e.n, e end
  local q = Hooks.activeQuests[id]
  if q and q.title then return q.title end
  local QL = _G.C_QuestLog
  if QL and QL.GetTitleForQuestID then
    local ok, t = pcall(QL.GetTitleForQuestID, id)
    if ok and t and t ~= "" then return t end
  end
  return nil
end

-- The active quest whose objectives mention this item, for quest items the data doesn't link.
local function questNeeding(name)
  local lname = ns.Engine.lower(name)
  for id, q in pairs(Hooks.activeQuests) do
    for _, o in ipairs(q.objectives or {}) do
      if ns.Engine.lower(o):find(lname, 1, true) then return id, q.title end
    end
  end
  return nil
end

-- Lines from the game's own quest flags for an item in your bags.
local function bagLines(name, itemID, out)
  local bi = itemID and Hooks.bagInfo[itemID]
  if not bi then return end
  if bi.questID and not bi.isActive then
    -- The game already says the item begins a quest; name it, but don't tell its story before you've read it.
    local title = questTitle(bi.questID)
    out[#out + 1] = { text = title and string.format(L["Starts a quest: %s"], title) or L["Starts a quest"],
      r = 0.85, g = 0.85, b = 0.85 }
  elseif bi.questID or bi.isQuestItem then
    local id, title = bi.questID, nil
    if id then title = questTitle(id) else id, title = questNeeding(name) end
    if title then
      out[#out + 1] = { text = string.format(L["Needed for your quest: %s"], title), r = 0.5, g = 0.9, b = 0.5 }
    end
  end
end

function Hooks.ItemLines(name, itemID)
  local out = {}
  if not name then return out end
  bagLines(name, itemID, out)
  local rec = ns.DB.index.item and ns.DB.index.item[ns.Engine.lower(name)]
  if rec and #out == 0 then
    for _, id in ipairs(rec.p or {}) do
      if Hooks.activeQuests[id] then
        local e = questEntry(id)
        out[#out + 1] = { text = string.format(L["Carry this for your quest: %s"], e.n), r = 0.5, g = 0.9, b = 0.5 }
        break
      end
    end
  end
  if rec and #out == 0 then
    for _, id in ipairs(rec.r or {}) do
      if Hooks.activeQuests[id] then
        local e = questEntry(id)
        out[#out + 1] = { text = string.format(L["Needed for your quest: %s"], e.n), r = 0.5, g = 0.9, b = 0.5 }
        break
      end
    end
    -- No spoilers: quests you don't have yet are never named. Only the game's own "starts a quest" flag (bagLines,
    -- title only) and rewards from quests you've already turned in are mentioned.
    if #out == 0 and rec.w then
      for _, id in ipairs(rec.w) do
        local e = questEntry(id)
        if e and questDone(id) then
          out[#out + 1] = { text = loreTag() .. string.format(L["earned from %s."], e.n), r = 0.8, g = 0.8, b = 0.8 }
          break
        end
      end
    end
  end
  while #out > 2 do table.remove(out) end
  return out
end

-- Lore line for an NPC or mob name, plus the entry key it came from.
function Hooks.UnitLine(name)
  if not (name and ns.engine) then return nil end
  local key, how = ns.engine:KeyForName(name)
  local e = key and ns.DB.entries[key]
  if not e then return nil end
  local text = e.h or e.s
  if how == "mob" then text = e.n .. ": " .. text end
  return loreTag() .. text, key
end

local function bindHint(tooltip)
  local k = GetBindingKey and GetBindingKey("LOREFOREVER_TOGGLE")
  local n = GetBindingKey and GetBindingKey("LOREFOREVER_NARRATE")
  local line = (k and n and string.format(L["Press %s for more, %s to listen"], k, n))
    or (k and string.format(L["Press %s for more"], k)) or (n and string.format(L["Press %s to listen"], n))
  if line then tooltip:AddLine(line, 0.5, 0.5, 0.5) end
end

local function onUnitTooltip(tooltip)
  if tooltip ~= GameTooltip or not S().unitTooltips then return end
  local ok, _, unit = pcall(tooltip.GetUnit, tooltip)
  if not ok or not unit then return end
  local name = ns.Context.NPCName(unit)
  local line = Hooks.UnitLine(name)
  if not line then return end
  tooltip:AddLine(line, 0.85, 0.85, 0.85, true)
  bindHint(tooltip)
  tooltip:Show()
end

local function onItemTooltip(tooltip)
  -- Only the main and chat-link tooltips, not the side-by-side comparison ones.
  if not S().itemTooltips or (tooltip ~= GameTooltip and tooltip ~= _G.ItemRefTooltip) then return end
  local name, id
  if _G.TooltipUtil and TooltipUtil.GetDisplayedItem then
    local ok, n, _, i = pcall(TooltipUtil.GetDisplayedItem, tooltip)
    if ok then name, id = n, i end
  elseif tooltip.GetItem then
    local ok, n, link = pcall(tooltip.GetItem, tooltip)
    if ok then
      name = n
      id = link and tonumber(link:match("item:(%d+)"))
    end
  end
  if not ns.Context.Usable(name) then return end
  local lines = Hooks.ItemLines(name, id)
  for _, l in ipairs(lines) do tooltip:AddLine(l.text, l.r, l.g, l.b, true) end
  if #lines > 0 then tooltip:Show() end
end

function Hooks.Tooltips()
  local TDP, E = _G.TooltipDataProcessor, _G.Enum and Enum.TooltipDataType
  if TDP and TDP.AddTooltipPostCall and E then
    TDP.AddTooltipPostCall(E.Unit, onUnitTooltip)
    TDP.AddTooltipPostCall(E.Item, onItemTooltip)
  elseif GameTooltip and GameTooltip.HookScript then   -- older clients
    pcall(GameTooltip.HookScript, GameTooltip, "OnTooltipSetUnit", onUnitTooltip)
    pcall(GameTooltip.HookScript, GameTooltip, "OnTooltipSetItem", onItemTooltip)
  end
end

-- Quest frames ---------------------------------------------------------------------------------------------------

local function questKeyFor(id, title)
  local idx = ns.DB.index
  return (id and idx.quest[id]) or (title and idx.questTitle[ns.Engine.lower(title)])
end

local function loreButton(parent, name, anchor)
  local b = CreateFrame("Button", name, parent, "UIPanelButtonTemplate")
  b:SetSize(60, 20)
  b:SetText(L["Lore"])
  b:SetPoint(unpack(anchor))
  b:SetFrameLevel((parent:GetFrameLevel() or 1) + 5)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine("Lore Forever")
    GameTooltip:AddLine(L["The story behind this quest."], 1, 1, 1)
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  b:SetScript("OnClick", function(self)
    if self.key then ns.UI.Open(self.key, nil, self.via) end
  end)
  b:Hide()
  return b
end

-- The play button beside the quest window's Lore button (Voice.PlayQuestPage): the gold play sign plays what the quest
-- giver says on this page again, a stop square stops it. Its tooltip says what plays: the quest giver's recorded words,
-- or the game's voice reading the page. Hooks.UpdateQuestPlayButton keeps it current.
local function questPlayButton(parent)
  local T = ns.Theme
  local b = T.RoundButton(parent, 20)
  b:SetFrameLevel((parent:GetFrameLevel() or 1) + 5)
  b:SetScript("OnClick", function()
    ns.Voice.PlayQuestPage()
    Hooks.UpdateQuestPlayButton()
  end)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    local state = ns.Voice.QuestPageState()
    if state == "stop" then
      GameTooltip:AddLine(L["Stop narration"])
    elseif state == "read" then
      GameTooltip:AddLine(L["Read aloud"])
      T.Tip(L["Uses your game's text-to-speech voice. Change it in Options > Accessibility > Text to Speech."], "tipText", true)
    else
      GameTooltip:AddLine(L["Play narration"])
      if state == "listen" then T.Tip(L["What the quest giver says, in the narrator's voice."], "tipText", true) end
    end
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  b:Hide()
  return b
end

-- The storyline line under a Lore button (Storyline.Line): one line on a dark strip, so it reads on the parchment
-- too, cut to fit with the whole line in its tooltip.
local STORY_MAX_W = 340
local function storyLine(parent, name, button)
  local f = CreateFrame("Button", name, parent)
  f:SetSize(STORY_MAX_W, 16)
  f:SetPoint("TOPRIGHT", button, "BOTTOMRIGHT", 0, -3)
  f:SetFrameLevel((parent:GetFrameLevel() or 1) + 5)
  local bg = f:CreateTexture(nil, "BACKGROUND")
  bg:SetAllPoints()
  bg:SetColorTexture(0, 0, 0, 0.6)
  local text = f:CreateFontString(nil, "OVERLAY", ns.Theme.font.label)
  text:SetPoint("LEFT", 5, 0)
  text:SetPoint("RIGHT", -5, 0)
  text:SetJustifyH("RIGHT")
  if text.SetWordWrap then text:SetWordWrap(false) end
  f.text = text
  f:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    if self.questID and ns.Storyline.AddTooltip(self.questID) then GameTooltip:Show() end
  end)
  f:SetScript("OnLeave", function() GameTooltip:Hide() end)
  f:SetScript("OnClick", function() if button.key then ns.UI.Open(button.key, nil, button.via) end end)
  f:Hide()
  return f
end

-- Show quest `id`'s storyline on `line`, as wide as it needs up to the most the frame leaves room for. When the
-- whole line doesn't fit, it leaves out the zone (Storyline.Line).
local function setStoryLine(line, id)
  if not line then return end
  local text = id and ns.Storyline and ns.Storyline.Line(id)
  line.questID = text and id or nil
  if not text then line:Hide() return end
  local pw = tonumber(line:GetParent() and line:GetParent():GetWidth()) or 0
  local max = pw > 120 and math.min(STORY_MAX_W, pw - 44) or STORY_MAX_W
  line.text:SetText(text)
  local w = ns.Theme.TextWidth(line.text)
  if w and w + 12 > max then
    line.text:SetText(ns.Storyline.Line(id, false, true))
    w = ns.Theme.TextWidth(line.text)
  end
  line:SetWidth(math.min(max, (w and w > 0) and (w + 12) or max))
  line:Show()
end

function Hooks.QuestFrames()
  -- The NPC quest dialog (accept / progress / complete).
  if _G.QuestFrame and not Hooks.questDialogButton then
    Hooks.questDialogButton = loreButton(QuestFrame, "LoreForeverQuestDialogButton",
      { "TOPRIGHT", QuestFrame, "TOPRIGHT", -28, -30 })
    Hooks.questDialogButton.via = "questdialog"
    Hooks.questDialogStory = storyLine(QuestFrame, "LoreForeverQuestDialogStory", Hooks.questDialogButton)
    Hooks.questDialogPlay = questPlayButton(QuestFrame)
    -- The floating player steps out from under the quest window while it's open (UI.KeepPlayerClear).
    if QuestFrame.HookScript then
      local function clear() if ns.UI.KeepPlayerClear then ns.UI.KeepPlayerClear() end end
      QuestFrame:HookScript("OnShow", clear)
      QuestFrame:HookScript("OnHide", clear)
    end
  end
  -- The quest log: modern map-side details panel, or the classic standalone log.
  local details = _G.QuestMapFrame and QuestMapFrame.DetailsFrame
  if details and not Hooks.questLogButton then
    Hooks.questLogButton = loreButton(details, "LoreForeverQuestLogButton", { "TOPRIGHT", details, "TOPRIGHT", -8, 28 })
    Hooks.questLogButton.via = "questlog"
    Hooks.questLogStory = storyLine(details, "LoreForeverQuestLogStory", Hooks.questLogButton)
    if hooksecurefunc and _G.QuestMapFrame_ShowQuestDetails then
      hooksecurefunc("QuestMapFrame_ShowQuestDetails", function(questID) Hooks.UpdateQuestLogButton(questID) end)
    end
  elseif _G.QuestLogFrame and not Hooks.questLogButton then
    Hooks.questLogButton = loreButton(QuestLogFrame, "LoreForeverQuestLogButton",
      { "TOPRIGHT", QuestLogFrame, "TOPRIGHT", -40, -44 })
    Hooks.questLogButton.via = "questlog"
    Hooks.questLogStory = storyLine(QuestLogFrame, "LoreForeverQuestLogStory", Hooks.questLogButton)
    if hooksecurefunc and _G.SelectQuestLogEntry then
      hooksecurefunc("SelectQuestLogEntry", function() Hooks.UpdateQuestLogButton() end)
    end
  end
end

-- The quest ID behind a Lore button: the one the game gave, else its entry's (a client that reports 0).
local function buttonQuest(b, id)
  if type(id) == "number" and id > 0 then return id end
  local e = b.key and ns.DB.entries[b.key]
  return e and e.m and e.m.id
end

-- The book reader (books, letters, plaques): a Read aloud button that reads the page shown, or stops it (LOR-49).
-- Shown only while Read aloud can speak; its label follows what's playing.
function Hooks.BookFrame()
  local f = _G.ItemTextFrame
  if not f or Hooks.bookButton then return end
  local T = ns.Theme
  local b = (T and T.Button) and T.Button(f, L["Read aloud"])
    or CreateFrame("Button", "LoreForeverBookButton", f, "UIPanelButtonTemplate")
  b:SetSize(96, 20)
  b:SetPoint("TOPRIGHT", f, "TOPRIGHT", -28, -30)
  b:SetFrameLevel((f:GetFrameLevel() or 1) + 5)
  b:SetText(L["Read aloud"])
  b:SetScript("OnClick", function()
    ns.Voice.ReadBookPage(true)
    Hooks.UpdateBookButton()
  end)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Read this page aloud with the game's voice. Click again to stop."], 1, 1, 1, true)
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  local wait = 0
  b:SetScript("OnUpdate", function(_, elapsed)   -- the page can finish by itself: relabel twice a second
    wait = wait + (elapsed or 0)
    if wait < 0.5 then return end
    wait = 0
    Hooks.UpdateBookButton()
  end)
  Hooks.bookButton = b
end

function Hooks.UpdateBookButton()
  local b = Hooks.bookButton
  if not b then return end
  local UI = ns.UI
  local reading = UI and UI.speaking and ns.Voice.IsBookText(UI.playingId)
  b:SetText(reading and L["Stop"] or L["Read aloud"])
  -- As wide as its label needs ("Lecture à voix haute" runs past 96), growing leftward from the corner.
  local fs = b.GetFontString and b:GetFontString()
  local w = fs and ns.Theme.TextWidth(fs)
  if type(w) == "number" and w > 0 then b:SetWidth(math.max(96, w + 24)) end
  b:SetShown(reading or ns.Voice.Available())
end

function Hooks.UpdateQuestDialogButton()
  local b = Hooks.questDialogButton
  if not b then return end
  local id = GetQuestID and GetQuestID()
  b.key = questKeyFor(id ~= 0 and id or nil, GetTitleText and GetTitleText())
  b:SetShown(b.key ~= nil)
  setStoryLine(Hooks.questDialogStory, buttonQuest(b, id))
end

-- The play button follows the page and what plays (UI.UpdateNowPlaying calls this): beside Lore, or in its place when
-- the quest has no story; hidden when nothing can play.
function Hooks.UpdateQuestPlayButton()
  local b, lore = Hooks.questDialogPlay, Hooks.questDialogButton
  if not b then return end
  local state = _G.QuestFrame and QuestFrame:IsShown() and ns.Voice.QuestPageState() or nil
  b:SetShown(state ~= nil)
  if not state then return end
  ns.Theme.SetIcon(b, state == "stop" and "stop" or "play")
  b:SetText(state == "stop" and L["Stop"] or (state == "read" and L["Read aloud"] or L["Listen"]))   -- hidden; the sign shows it
  b:ClearAllPoints()
  if lore and lore:IsShown() then
    b:SetPoint("RIGHT", lore, "LEFT", -4, 0)
  else
    b:SetPoint("TOPRIGHT", QuestFrame, "TOPRIGHT", -28, -30)
  end
end

function Hooks.UpdateQuestLogButton(questID)
  local b = Hooks.questLogButton
  if not b then return end
  if not questID and _G.C_QuestLog and C_QuestLog.GetSelectedQuest then
    local ok, id = pcall(C_QuestLog.GetSelectedQuest)
    questID = ok and id or nil
  end
  b.key = questKeyFor(questID)
  b:SetShown(b.key ~= nil)
  setStoryLine(Hooks.questLogStory, buttonQuest(b, questID))
end

-- Chat links -------------------------------------------------------------------------------------------------------

-- A clickable chat link. kind: "faq" (key + idx), "entry" (key), "primer" (zone key), "listen" (key), "open",
-- "journey" / "journeylisten" (a journey chapter id).
function Hooks.Link(text, kind, key, idx)
  return GOLD .. "|H" .. LINK .. kind .. ":" .. (idx or "") .. ":" .. (key or "") .. "|h[" .. esc(text) .. "]|h|r"
end

local lastLink, lastLinkAt = nil, 0
function Hooks.HandleLink(link)
  if type(link) ~= "string" or link:sub(1, #LINK) ~= LINK then return false end
  local now = GetTime and GetTime() or 0
  if link == lastLink and now - lastLinkAt < 0.3 then return true end   -- both handlers fired
  lastLink, lastLinkAt = link, now
  local kind, idx, key = link:sub(#LINK + 1):match("^(%a+):(%d*):(.*)$")
  if kind == "faq" then ns.UI.Open(key, tonumber(idx), "chatlink")
  elseif kind == "entry" then ns.UI.Open(key, nil, "chatlink")
  elseif kind == "primer" then ns.UI.ShowPrimer(key, "chatlink")
  elseif kind == "listen" then ns.UI.ListenTo(ns.UI.EntryTarget(key))
  elseif kind == "journey" or kind == "journeylisten" then ns.Journey.Open(key, kind == "journeylisten")
  elseif kind == "open" then ns.UI.Open(nil, nil, "chatlink")
  elseif kind == "whatsnew" then ns.WhatsNew.Show() end
  return true
end

function Hooks.ChatLinks()
  if _G.EventRegistry and EventRegistry.RegisterCallback then
    pcall(EventRegistry.RegisterCallback, EventRegistry, "SetItemRef", function(_, link) Hooks.HandleLink(link) end, Hooks)
  end
  if hooksecurefunc and _G.SetItemRef then
    hooksecurefunc("SetItemRef", function(link) Hooks.HandleLink(link) end)
  end
end

-- Key binding prompt -------------------------------------------------------------------------------------------------

local MODIFIER = { LSHIFT = true, RSHIFT = true, LCTRL = true, RCTRL = true, LALT = true, RALT = true,
  LMETA = true, RMETA = true }

-- The two bindable actions: open the panel, and play the narration for what you hover or where you are.
-- Their texts are looked up when shown, after the language pack has loaded.
local ACTIONS = {
  toggle = {
    binding = "LOREFOREVER_TOGGLE",
    ask = function() return L["Pick a key to open the lore panel from anywhere, like M for the map."] end,
    done = function(key)
      return string.format(L["press %s to open the lore panel. Change it any time with /lore key."], key)
    end,
  },
  narrate = {
    binding = "LOREFOREVER_NARRATE",
    ask = function() return L["Pick a key to play the narration for where you are, or for what you're hovering."] end,
    done = function(key)
      return string.format(L["press %s to hear the narration for where you are or what you hover. Change it any time with /lore key narrate."], key)
    end,
  },
}

function Hooks.CurrentKey(which)
  return GetBindingKey and GetBindingKey(ACTIONS[which or "toggle"].binding)
end

local function bind(combo, which)
  local a = ACTIONS[which]
  if InCombatLockdown and InCombatLockdown() then
    say(L["can't change key bindings in combat - try again after the fight."])
    return false
  end
  local old = Hooks.CurrentKey(which)
  if old and old ~= combo then SetBinding(old) end
  SetBinding(combo, a.binding)
  if SaveBindings and GetCurrentBindingSet then SaveBindings(GetCurrentBindingSet()) end
  say(a.done(GOLD .. combo .. "|r"))
  -- Gamepad players can't click chat links: point them at the narration key once the panel key is set (LOR-89).
  if which == "toggle" and not Hooks.CurrentKey("narrate") then
    say(L["Tip: a second key can play the narration for where you are or what you hover, handy on a controller. Set it with /lore key narrate."])
  end
  return true
end

-- which: "toggle" (default) or "narrate".
function Hooks.KeyPrompt(which)
  which = which or "toggle"
  if Hooks.keyFrame then
    Hooks.keyFrame.which = which
    if Hooks.keyFrame:IsShown() then Hooks.keyFrame.idle() end
    return Hooks.keyFrame
  end
  local f = CreateFrame("Frame", "LoreForeverKeyPrompt", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  f.which = which
  f:SetSize(380, 118)
  f:SetPoint("TOP", 0, -140)
  f:SetFrameStrata("DIALOG")
  if f.SetBackdrop then
    f:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background-Dark",
      edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border", tile = true, tileSize = 32, edgeSize = 24,
      insets = { left = 6, right = 6, top = 6, bottom = 6 } })
  end
  local text = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  text:SetPoint("TOPLEFT", 18, -18)
  text:SetPoint("TOPRIGHT", -18, -18)
  text:SetJustifyH("LEFT")
  f.text = text
  local choose = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  choose:SetSize(120, 22)
  choose:SetPoint("BOTTOMLEFT", 18, 16)
  choose:SetText(L["Choose a key"])
  local later = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  later:SetSize(90, 22)
  later:SetPoint("BOTTOMRIGHT", -18, 16)
  later:SetText(L["Not now"])
  f.choose, f.later = choose, later

  local function idle()
    f.capturing, f.pending = false, nil
    if f.EnableKeyboard then f:EnableKeyboard(false) end
    choose:Show()
    local cur = Hooks.CurrentKey(f.which)
    text:SetText(GOLD .. "Lore Forever|r\n" .. ACTIONS[f.which].ask()
      .. (cur and ("\n" .. string.format(L["Currently: %s"], GOLD .. cur .. "|r")) or ""))
  end
  f.idle = idle
  choose:SetScript("OnClick", function()
    if InCombatLockdown and InCombatLockdown() then
      text:SetText(GOLD .. "Lore Forever|r\n" .. L["You're in combat - choose a key once the fight is over."])
      return
    end
    f.capturing = true
    choose:Hide()
    if f.EnableKeyboard then f:EnableKeyboard(true) end
    if f.SetPropagateKeyboardInput then f:SetPropagateKeyboardInput(false) end
    text:SetText(string.format(L["%sPress a key|r (with Shift/Ctrl/Alt if you like)."], GOLD) .. "\n"
      .. L["Escape to cancel."])
  end)
  later:SetScript("OnClick", function()
    S().onboarded = true
    f:Hide()
  end)
  f:SetScript("OnKeyDown", function(self, key)
    if not self.capturing or MODIFIER[key] then return end
    if key == "ESCAPE" then return idle() end
    local combo = (IsAltKeyDown() and "ALT-" or "") .. (IsControlKeyDown() and "CTRL-" or "")
      .. (IsShiftKeyDown() and "SHIFT-" or "") .. key
    local action = GetBindingAction and GetBindingAction(combo) or ""
    if action ~= "" and action ~= ACTIONS[self.which].binding and self.pending ~= combo then
      self.pending = combo
      local what = _G["BINDING_NAME_" .. action] or action
      text:SetText(string.format(L["%s is already used for %s."], GOLD .. combo .. "|r", esc(what)) .. "\n"
        .. L["Press it again to use it anyway, or press a different key."])
      return
    end
    if bind(combo, self.which) then
      if self.which == "toggle" then S().onboarded = true end
      self:Hide()
    end
  end)
  f:SetScript("OnShow", idle)
  f:Hide()
  Hooks.keyFrame = f
  return f
end

-- Once per session, if no key is bound. (Bindings persist even though the beta may drop SavedVariables.)
-- Combat started: stop capturing keys so they reach the action bars.
function Hooks.OnCombat()
  local f = Hooks.keyFrame
  if f and f.capturing and f.idle then f.idle() end
end

function Hooks.MaybeOnboard()
  if Hooks.CurrentKey() or S().onboarded or Hooks.onboardShown then return end
  Hooks.onboardShown = true
  Hooks.KeyPrompt():Show()
end

-- Setup ----------------------------------------------------------------------------------------------------------------

function Hooks.Init()
  Hooks.RefreshQuests()
  Hooks.RefreshBags()
  for _, fn in ipairs({ Hooks.Tooltips, Hooks.QuestFrames, Hooks.BookFrame, Hooks.ChatLinks }) do
    local ok, err = pcall(fn)
    if not ok and ns.debug then say("hook failed: " .. tostring(err)) end
  end
end

-- Addon compartment (the minimap's add-on menu), declared in the .toc.
function LoreForever_OnAddonCompartmentClick()
  LoreForever_Toggle()
end
