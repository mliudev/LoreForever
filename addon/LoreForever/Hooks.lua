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

-- Nothing of ours covers the quest's text (LOR-284). In WoW Forever's client the quest giver's window (QuestFrame) has
-- a dark band between its title bar (its edge reaches about 25 down) and the parchment the text is on (from 62 down):
-- one row there with the Lore button at its right end and the play and Contribute buttons to its left. The map's quest
-- log (QuestMapFrame.DetailsFrame) has a bar above the quest's text with the game's Back button at its left end
-- (BackFrame): the Lore button at its right end level with Back, play and Contribute beside it. The map's title bar
-- above that bar draws over anything of ours. The storyline is part of the quest's text (Hooks.QuestInfoStory).
local QUEST_END, QUEST_MID = -28, -35   -- the quest window's row: its right end and middle, from the top right corner
local LOG_END = -11                     -- the log's bar: our row ends as far in as Back starts (LEFT 11, 4)

-- The bar the map's quest log shows the game's Back button on, and the details frame; nil without one.
local function logBar()
  local details = _G.QuestMapFrame and QuestMapFrame.DetailsFrame
  local bar = type(details) == "table" and details.BackFrame
  return type(bar) == "table" and bar or nil, details
end

-- `b` at the right end of the quest window's row, or of the quest log's bar: where the Lore button goes, and the play
-- or Contribute button when the quest has no lore.
function Hooks.AtQuestRow(b)
  b:ClearAllPoints()
  b:SetPoint("RIGHT", QuestFrame, "TOPRIGHT", QUEST_END, QUEST_MID)
end

function Hooks.AtLogRow(b)
  local bar, details = logBar()
  b:ClearAllPoints()
  if bar then
    b:SetPoint("RIGHT", bar, "RIGHT", LOG_END, 4)
  elseif type(details) == "table" then
    b:SetPoint("TOPRIGHT", details, "TOPRIGHT", LOG_END, -12)
  elseif _G.QuestLogFrame then
    b:SetPoint("TOPRIGHT", QuestLogFrame, "TOPRIGHT", -40, -44)
  end
end

local function questKeyFor(id, title)
  local idx = ns.DB.index
  return (id and idx.quest[id]) or (title and idx.questTitle[ns.Engine.lower(title)])
end

-- A quest's Lore button: a click opens its story; Shift-click adds its narration to your playlist (UI.QueueQuest).
-- key: its entry, quest: its quest ID, title: its name on screen (UpdateQuestDialogButton, UpdateQuestLogButton).
local function loreButton(parent, name)
  local b = CreateFrame("Button", name, parent, "UIPanelButtonTemplate")
  b:SetSize(60, 20)
  b:SetText(L["Lore"])
  b:SetFrameLevel((parent:GetFrameLevel() or 1) + 5)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine("Lore Forever")
    GameTooltip:AddLine(L["The story behind this quest."], 1, 1, 1)
    if ns.UI.CanQueueQuest(self.quest) then
      ns.Theme.Tip(L["Click to open. Shift-click adds it to your playlist."], "tipDim", true)
    end
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  b:SetScript("OnClick", function(self)
    if IsShiftKeyDown and IsShiftKeyDown() then return ns.UI.QueueQuest(self.quest, self.title) end
    if self.key then
      ns.UI.Open(self.key, nil, self.via)
    elseif self.quest and self.title then
      ns.UI.Open()
      if self.via == "questdialog" then
        ns.UI.ShowQuestText({ id = self.quest, title = self.title,
          text = ns.Voice.QuestPageText(ns.Voice.questKind), objectives = "" })
      else
        ns.UI.ShowQuestText({ id = self.quest, title = self.title })
      end
    end
  end)
  b:Hide()
  return b
end

-- The play button beside the quest window's Lore button (Voice.PlayQuestPage): the gold play sign plays what the quest
-- giver says on this page again, a stop square stops it. Its tooltip says what plays: the quest giver's recorded words,
-- checked against this page's words. A page no voice recorded has no button. The quest log uses the same control.
local function questPlayButton(parent, fromLog)
  local T = ns.Theme
  local b = T.RoundButton(parent, 20)
  b:SetFrameLevel((parent:GetFrameLevel() or 1) + 5)
  b:SetScript("OnClick", function()
    if fromLog then ns.UI.ListenTo(ns.UI.QuestLogTarget(Hooks.questLogButton.quest))
    else ns.Voice.PlayQuestPage() end
    Hooks.UpdateQuestPlayButton()
  end)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    local state
    if fromLog then state = Hooks.QuestLogPageState() else state = ns.Voice.QuestPageState() end
    if state == "stop" then
      GameTooltip:AddLine(L["Stop narration"])
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

-- The storyline in the quest's own text (LOR-198, LOR-284): "Storyline · Tirisfal Glades: At War With The Scarlet
-- Crusade" in gold right under the quest's title, at full length and wrapped as needed, the rest of the quest's text
-- moved down under it: it scrolls with the text, and nothing covers or cuts it. The game lays a quest's text out in
-- QuestInfo_Display (the quest giver's offer and turn-in, the map's quest log, the quest log's pop-up): each block
-- anchored under the one before, the title first. After it runs, the line goes under the title and the block that was
-- under the title under the line, with the gap it had there; the game's next QuestInfo_Display lays the blocks out
-- afresh. The progress page has a title and text of its own (QuestFrameProgressPanel): the same there, as it shows. A
-- quest in no storyline (or Options › Show storylines on quests off) has no line, and the block goes back under the
-- title. Nothing of the game's is replaced: the line is our own font string, and only that one block moves.
local STORY_GAP = 2
local story = {}   -- frame the quest's text is in -> { fs = its line, title = the title, quest = ID, moved = {...} }

-- The line's gold, readable on the page: dark gold on the parchment (its title is dark), the game's gold on a dark page
-- (Quest Text Contrast, a dark material).
local function storyGold(title)
  local r, g, b = 0, 0, 0
  if title.GetTextColor then r, g, b = title:GetTextColor() end
  if 0.3 * (r or 0) + 0.59 * (g or 0) + 0.11 * (b or 0) > 0.5 then return 1, 0.82, 0 end
  return 0.36, 0.24, 0
end

-- The block the line moved down goes back to where the game had it, if it's still under the line.
local function restoreBlock(s)
  local m = s.moved
  s.moved = nil
  if not (m and m[1].GetNumPoints and m[1]:GetNumPoints() > 0) then return end
  local _, rel = m[1]:GetPoint(1)
  if rel == s.fs then m[1]:SetPoint(m[2], m[3], m[4], m[5], m[6]) end
end

-- The block the game anchored right under `title` in `parent` (its top left to the title's bottom left), not our line.
local function blockUnder(parent, title, fs)
  local function find(...)
    for i = 1, select("#", ...) do
      local o = select(i, ...)
      if type(o) == "table" and o ~= fs and o.GetNumPoints and (o:GetNumPoints() or 0) > 0 then
        local point, rel, relPoint = o:GetPoint(1)
        if rel == title and point == "TOPLEFT" and relPoint == "BOTTOMLEFT" then return o end
      end
    end
  end
  return find(parent:GetRegions()) or find(parent:GetChildren())
end

-- Quest `id`'s storyline under `title` in `parent`, the frame the quest's text is in; none for a quest in no storyline.
local function placeStory(parent, title, id)
  for p, o in pairs(story) do   -- the game moved this title here: a line left under it elsewhere goes
    if p ~= parent and o.title == title and o.fs then
      restoreBlock(o)
      o.fs:Hide()
    end
  end
  local s = story[parent] or {}
  story[parent] = s
  s.title, s.quest = title, id
  restoreBlock(s)   -- (a page that lays its text out once, like the progress page, may still have it under the line)
  local text = id and ns.Storyline and ns.Storyline.Line(id)
  if not text then
    if s.fs then s.fs:Hide() end
    return
  end
  if not s.fs then
    s.fs = parent:CreateFontString(nil, "ARTWORK", _G.QuestFontNormalSmall and "QuestFontNormalSmall" or "QuestFont")
    s.fs:SetJustifyH("LEFT")
    if s.fs.SetWordWrap then s.fs:SetWordWrap(true) end
  end
  local fs = s.fs
  fs:SetTextColor(storyGold(title))
  fs:SetWidth(tonumber(title:GetWidth()) or 285)
  fs:SetText(text)
  fs:ClearAllPoints()
  fs:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -STORY_GAP)
  fs:Show()
  local block = blockUnder(parent, title, fs)
  if block then
    local point, rel, relPoint, x, y = block:GetPoint(1)
    s.moved = { block, point, rel, relPoint, x, y }
    block:SetPoint("TOPLEFT", fs, "BOTTOMLEFT", x, y)
  end
end

-- The quest on the quest giver's window: the game's ID, else its title's entry's (a client that reports 0).
local function giverQuest()
  local id = GetQuestID and GetQuestID()
  if type(id) == "number" and id > 0 then return id end
  local key = questKeyFor(nil, GetTitleText and GetTitleText())
  local e = key and ns.DB.entries[key]
  return e and e.m and e.m.id
end

-- After QuestInfo_Display(template, parent): the storyline under the title, when the template showed it in `parent`.
-- A template that shows a quest log's quest (questLog) shows the selected one, as the game's QuestInfo does.
function Hooks.QuestInfoStory(template, parent)
  local title = _G.QuestInfoTitleHeader
  if type(template) ~= "table" or not (title and parent and parent.CreateFontString) then return end
  if not title.GetParent or title:GetParent() ~= parent then return end
  local id
  if template.questLog then
    local QL = _G.C_QuestLog
    if QL and QL.GetSelectedQuest then
      local ok, q = pcall(QL.GetSelectedQuest)
      id = ok and q or nil
    end
  else
    id = giverQuest()
  end
  placeStory(parent, title, id)
end

-- The quest giver's progress page, as it shows.
function Hooks.ProgressStory()
  local title = _G.QuestProgressTitleText
  local parent = title and title.GetParent and title:GetParent()
  if parent and parent.CreateFontString then placeStory(parent, title, giverQuest()) end
end

-- After Options › Show storylines on quests: the line in each quest's text the game still shows, again.
function Hooks.RefreshQuestStory()
  for parent, s in pairs(story) do
    if s.title and s.title:GetParent() == parent then placeStory(parent, s.title, s.quest) end
  end
end

-- For tests: the line in the frame `parent` (QuestDetailScrollChildFrame, the map's details), if one was made there.
function Hooks.StoryLine(parent) return story[parent] and story[parent].fs end

function Hooks.QuestFrames()
  -- The NPC quest dialog (accept / progress / complete).
  if _G.QuestFrame and not Hooks.questDialogButton then
    Hooks.questDialogButton = loreButton(QuestFrame, "LoreForeverQuestDialogButton")
    Hooks.AtQuestRow(Hooks.questDialogButton)
    Hooks.questDialogButton.via = "questdialog"
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
    Hooks.questLogButton = loreButton(details, "LoreForeverQuestLogButton")
    Hooks.AtLogRow(Hooks.questLogButton)
    Hooks.questLogButton.via = "questlog"
    Hooks.questLogPlay = questPlayButton(details, true)
    if hooksecurefunc and _G.QuestMapFrame_ShowQuestDetails then
      hooksecurefunc("QuestMapFrame_ShowQuestDetails", function(questID) Hooks.UpdateQuestLogButton(questID) end)
    end
  elseif _G.QuestLogFrame and not Hooks.questLogButton then
    Hooks.questLogButton = loreButton(QuestLogFrame, "LoreForeverQuestLogButton")
    Hooks.questLogButton:SetPoint("TOPRIGHT", QuestLogFrame, "TOPRIGHT", -40, -44)
    Hooks.questLogButton.via = "questlog"
    Hooks.questLogPlay = questPlayButton(QuestLogFrame, true)
    if hooksecurefunc and _G.SelectQuestLogEntry then
      hooksecurefunc("SelectQuestLogEntry", function() Hooks.UpdateQuestLogButton() end)
    end
  end
  -- The storyline in the quest's text (Hooks.QuestInfoStory): after the game lays a quest's text out, and as the
  -- progress page shows (its OnShow is bound in the game's XML, so it's hooked on the frame, not by name).
  if hooksecurefunc and _G.QuestInfo_Display and _G.QuestInfoTitleHeader and not Hooks.storyHooked then
    hooksecurefunc("QuestInfo_Display", function(template, parent) Hooks.QuestInfoStory(template, parent) end)
    Hooks.storyHooked = true
  end
  local progress = _G.QuestFrameProgressPanel
  if progress and progress.HookScript and _G.QuestProgressTitleText and not Hooks.progressHooked then
    progress:HookScript("OnShow", function() Hooks.ProgressStory() end)
    Hooks.progressHooked = true
  end
end

-- The quest ID behind a Lore button: the one the game gave, else its entry's (a client that reports 0).
local function buttonQuest(b, id)
  if type(id) == "number" and id > 0 then return id end
  local e = b.key and ns.DB.entries[b.key]
  return e and e.m and e.m.id
end

-- The book reader (books, letters, plaques): a Listen button that plays the page's recording, or stops it (LOR-49).
-- Shown only for a page a voice recorded (Voice.BookPageClip; none has one yet, so books stay text); its label follows
-- what's playing.
function Hooks.BookFrame()
  local f = _G.ItemTextFrame
  if not f or Hooks.bookButton then return end
  local T = ns.Theme
  local b = (T and T.Button) and T.Button(f, L["Listen"])
    or CreateFrame("Button", "LoreForeverBookButton", f, "UIPanelButtonTemplate")
  b:SetSize(96, 20)
  b:SetPoint("TOPRIGHT", f, "TOPRIGHT", -28, -30)
  b:SetFrameLevel((f:GetFrameLevel() or 1) + 5)
  b:SetText(L["Listen"])
  b:SetScript("OnClick", function()
    ns.Voice.ReadBookPage(true)
    Hooks.UpdateBookButton()
  end)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    local UI = ns.UI
    local reading = UI and UI.speaking and ns.Voice.IsBookText(UI.playingId)
    GameTooltip:AddLine(reading and L["Stop narration"] or L["Play narration"])
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
  b:SetText(reading and L["Stop"] or L["Listen"])
  -- As wide as its label needs (a translation can run past 96), growing leftward from the corner.
  local fs = b.GetFontString and b:GetFontString()
  local w = fs and ns.Theme.TextWidth(fs)
  if type(w) == "number" and w > 0 then b:SetWidth(math.max(96, w + 24)) end
  b:SetShown((reading or ns.Voice.BookPageClip() ~= nil) and true or false)
end

function Hooks.UpdateQuestDialogButton()
  local b = Hooks.questDialogButton
  if not b then return end
  local id = GetQuestID and GetQuestID()
  local title = GetTitleText and GetTitleText()
  b.key = questKeyFor(id ~= 0 and id or nil, title)
  b.quest, b.title = buttonQuest(b, id), type(title) == "string" and title ~= "" and title or nil
  b:SetShown(b.key ~= nil or (b.quest ~= nil and b.title ~= nil))
end

-- The play button follows the page and what plays (UI.UpdateNowPlaying calls this): beside Lore, or in its place when
-- the quest has no story; hidden when nothing can play.
function Hooks.UpdateQuestPlayButton()
  Hooks.UpdateQuestLogPlayButton()
  local b, lore = Hooks.questDialogPlay, Hooks.questDialogButton
  if not b then return end
  local state = _G.QuestFrame and QuestFrame:IsShown() and ns.Voice.QuestPageState() or nil
  b:SetShown(state ~= nil)
  if not state then return end
  ns.Theme.SetIcon(b, state == "stop" and "stop" or "play")
  b:SetText(state == "stop" and L["Stop"] or L["Listen"])   -- hidden; the sign shows it
  if lore and lore:IsShown() then
    b:ClearAllPoints()
    b:SetPoint("RIGHT", lore, "LEFT", -4, 0)
  else
    Hooks.AtQuestRow(b)
  end
end

-- Play/Stop for the page currently selected in the quest log. The target rechecks selection and words on every click,
-- so an old button never reads another quest or a recording of text Forever changed.
function Hooks.QuestLogPageState()
  local lore = Hooks.questLogButton
  local target = lore and ns.UI.QuestLogTarget(lore.quest)
  if target then return ns.UI.IsPlayingTarget(target) and "stop" or "listen" end
end

function Hooks.UpdateQuestLogPlayButton()
  local b, lore = Hooks.questLogPlay, Hooks.questLogButton
  if not b then return end
  local parent = (_G.QuestMapFrame and QuestMapFrame.DetailsFrame) or _G.QuestLogFrame
  local state = parent and parent:IsShown() and Hooks.QuestLogPageState() or nil
  b:SetShown(state ~= nil)
  if not state then return end
  ns.Theme.SetIcon(b, state == "stop" and "stop" or "play")
  b:SetText(state == "stop" and L["Stop"] or L["Listen"])
  if lore and lore:IsShown() then
    b:ClearAllPoints()
    b:SetPoint("RIGHT", lore, "LEFT", -4, 0)
  else
    Hooks.AtLogRow(b)
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
  b.quest = buttonQuest(b, questID)
  b:SetShown(b.key ~= nil)
  Hooks.UpdateQuestLogPlayButton()
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
