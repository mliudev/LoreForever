-- The Lore Forever panel, laid out like a chat app: a sidebar with the place you're in and your quests, and a
-- conversation of question and answer bubbles with suggested replies and a message box with type-ahead.

local _, ns = ...
local UI = {}
ns.UI = UI
local L = ns.L

local GOLD, GREY, BLUE, WHITE, GREEN = "|cffffd100", "|cff9d9d9d", "|cff88ccff", "|cffffffff", "|cff7fdf7f"
-- Score thresholds. Real lore questions score 15+ with the tuned engine (tests/retrieval_check.py); these only catch
-- matches on a stray common word. Gameplay questions can't be told apart by score (they name real NPCs and quests),
-- so they're caught by wording instead (GAMEPLAY below).
local MIN_SCORE = 2.0          -- at or above: confident enough to answer
local GUESS_SCORE = 0.8        -- between this and MIN_SCORE: offer "did you mean" instead of guessing
local MAX_MESSAGES = 30        -- bubbles kept in the conversation
local W, H, SIDE_W = 820, 560, 250
local MIN_W = 600                           -- narrowest the panel can be dragged (the conversation gets ~300)
local CHAT_X = SIDE_W + 14                  -- left edge of the conversation
local CHAT_W = W - CHAT_X - 40              -- conversation width (the scroll bar takes the rest)
local PAD = 8                               -- bubble padding
local N_NEXT, N_COMPLETE = 3, 6

-- Words that mark a mechanics question ("how many runs for the hammer?"). The answer is still the entry's lore,
-- introduced honestly rather than pretending to answer the mechanics.
local GAMEPLAY = {}
for w in ([[level levels drop drops loot solo stun dps tank healer spec talent talents xp experience reward rewards
  farm farming respawn spawn spawns coords coordinates bugged bug buggy price cost vendor sell runs group gear
  item items damage]]):gmatch("%a+") do GAMEPLAY[w] = true end

local function isGameplay(question)
  for w in question:lower():gmatch("%a+") do
    if GAMEPLAY[w] then return true end
  end
  return question:lower():find("how many") ~= nil
end

local function esc(s)
  return (tostring(s or ""):gsub("|", "||"))
end

-- A flat text button (the default UIPanelButtonTemplate can't wrap long text). `fill` gives it a pill background.
local function TextButton(parent, width, height, fontObject, fill)
  local b = CreateFrame("Button", nil, parent)
  b:SetSize(width, height)
  if fill then
    local bg = b:CreateTexture(nil, "BACKGROUND")
    bg:SetAllPoints()
    bg:SetColorTexture(fill[1], fill[2], fill[3], fill[4])
    b.bg = bg
  end
  local hl = b:CreateTexture(nil, "HIGHLIGHT")
  hl:SetAllPoints()
  hl:SetColorTexture(1, 0.82, 0, 0.14)
  local fs = b:CreateFontString(nil, "OVERLAY", fontObject or "GameFontHighlightSmall")
  fs:SetPoint("TOPLEFT", 6, -2)
  fs:SetPoint("BOTTOMRIGHT", -6, 2)
  fs:SetJustifyH("LEFT")
  fs:SetJustifyV("MIDDLE")
  if fs.SetWordWrap then fs:SetWordWrap(true) end
  b.text = fs
  return b
end

-- Green "+": add a recorded story or answer to the playlist. Once queued it shows a check; clicking that takes it
-- out again. SetQueueButton points it at a story (idx nil) or answer and returns whether it can be queued at all.
local function QueueButton(parent, height)
  local add = TextButton(parent, 20, height, "GameFontHighlight", { 0.20, 0.42, 0.14, 0.9 })
  add.text:SetJustifyH("CENTER")
  add.text:SetText("+")
  local tick = add:CreateTexture(nil, "OVERLAY")
  tick:SetSize(14, 14)
  tick:SetPoint("CENTER")
  tick:SetTexture("Interface\\RaidFrame\\ReadyCheck-Ready")
  add.tick = tick
  add:SetScript("OnClick", function(self)
    local at = UI.PlaylistIndex(self.id)
    if at then UI.PlaylistRemove(at) else UI.PlaylistAdd(self.key, self.idx) end
  end)
  add:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    if UI.PlaylistIndex(self.id) then
      GameTooltip:AddLine(L["In your playlist"])
      GameTooltip:AddLine(L["Click to take it out."], 1, 1, 1)
    else
      GameTooltip:AddLine(L["Add to playlist"])
      GameTooltip:AddLine(L["Queues this narration after the others in your playlist (Playlist tab)."], 1, 1, 1, true)
    end
    GameTooltip:Show()
  end)
  add:SetScript("OnLeave", function() GameTooltip:Hide() end)
  add:Hide()
  return add
end

local function SetQueueButton(add, key, idx)
  local can = UI.CanQueue(key, idx) and true or false
  add:SetShown(can)
  if not can then return false end
  add.id, add.key, add.idx = idx and (key .. "#faq" .. idx) or key, key, idx
  local queued = UI.PlaylistIndex(add.id) ~= nil
  add.text:SetShown(not queued)
  add.tick:SetShown(queued)
  -- Green while it can be added; a plain dark square behind the check once it's in.
  if queued then add.bg:SetColorTexture(0.12, 0.12, 0.12, 0.9) else add.bg:SetColorTexture(0.20, 0.42, 0.14, 0.9) end
  return true
end

-- The small play arrow on rows with a recorded story: plays it (and posts it in the chat), or stops it.
local function PlayButton(parent)
  local play = CreateFrame("Button", nil, parent)
  play:SetSize(22, 22)
  play:SetNormalTexture("Interface\\Buttons\\UI-SpellbookIcon-NextPage-Up")
  play:SetPushedTexture("Interface\\Buttons\\UI-SpellbookIcon-NextPage-Down")
  play:SetHighlightTexture("Interface\\Buttons\\UI-Common-MouseHilight", "ADD")
  play:SetScript("OnClick", function(self) UI.PlayEntry(self.key, self.label) end)
  play:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine((UI.speaking and UI.playingId == self.key) and L["Stop narration"] or L["Play narration"])
    GameTooltip:Show()
  end)
  play:SetScript("OnLeave", function() GameTooltip:Hide() end)
  play:Hide()
  return play
end

-- A boss's name as players know it ("Ghamoo-ra (Classic)" is "Ghamoo-ra").
local function bossName(e)
  return (e.n:gsub("%s*%b()$", ""))
end

-- A section header: gold, with a thin gold rule under it so sections read as sections.
local function Header(parent, text)
  local fs = parent:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  fs:SetText(text)
  fs:SetJustifyH("LEFT")
  local rule = parent:CreateTexture(nil, "ARTWORK")
  rule:SetColorTexture(1, 0.82, 0, 0.35)
  rule:SetHeight(1)
  rule:SetPoint("TOPLEFT", fs, "BOTTOMLEFT", 0, -3)
  rule:SetWidth(SIDE_W - 28)
  fs.rule = rule
  return fs
end

local function Area(parent, r, g, b, a)
  local t = parent:CreateTexture(nil, "BACKGROUND")
  t:SetColorTexture(r, g, b, a)
  return t
end

local function settings()
  return (LoreForeverDB and LoreForeverDB.settings) or {}
end

-- Shared with the Journey tab (Journey.lua), so its rows and headers look like the rest of the sidebar.
UI.TextButton, UI.Header, UI.SIDE_W = TextButton, Header, SIDE_W

-- The playlist (see "Playlist" below): items {id, key, idx, label}, pos = the current item, and state:
--   "playing"  the clip playing is items[pos] (or it's in the short gap before the next one)
--   "waiting"  started while something else played; items[pos] begins when that ends
--   "paused"   stopped at items[pos]; Play starts it again from the top (WoW can't resume a sound)
-- Session only: /reload and logging out clear it.
UI.pl = { items = {}, pos = 0, state = "paused" }

function UI.Create(engine)
  if UI.frame then return UI.frame end
  UI.engine = engine
  UI.msgs, UI.blocks, UI.bubbles = {}, {}, {}

  local ok, f = pcall(CreateFrame, "Frame", "LoreForeverFrame", UIParent, "BasicFrameTemplateWithInset")
  if not ok or not f then
    f = CreateFrame("Frame", "LoreForeverFrame", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
    if f.SetBackdrop then
      f:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background-Dark",
        edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border", tile = true, tileSize = 32, edgeSize = 32,
        insets = { left = 8, right = 8, top = 8, bottom = 8 } })
    end
    local close = CreateFrame("Button", nil, f, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", -4, -4)
  end
  UI.frame = f
  f:SetSize(W, H)
  f:SetPoint("CENTER")
  f:SetFrameStrata("HIGH")
  f:SetToplevel(true)
  f:SetClampedToScreen(true)
  f:SetMovable(true)
  f:EnableMouse(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", f.StartMoving)
  f:SetScript("OnDragStop", f.StopMovingOrSizing)
  -- Resizable from the bottom-right corner; the sidebar keeps its width and the conversation takes the rest.
  if f.SetResizable then
    f:SetResizable(true)
    if f.SetResizeBounds then f:SetResizeBounds(MIN_W, 560, 1500, 1100)
    elseif f.SetMinResize then f:SetMinResize(MIN_W, 560) end
    local grip = CreateFrame("Button", nil, f)
    grip:SetSize(16, 16)
    grip:SetPoint("BOTTOMRIGHT", -4, 4)
    grip:SetNormalTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Up")
    grip:SetHighlightTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Highlight")
    grip:SetPushedTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Down")
    grip:SetScript("OnMouseDown", function() f:StartSizing("BOTTOMRIGHT") end)
    grip:SetScript("OnMouseUp", function() f:StopMovingOrSizing() end)
  end
  -- Re-flow after the drag settles rather than on every size tick.
  f:SetScript("OnSizeChanged", function()
    UI.layoutToken = (UI.layoutToken or 0) + 1
    local token = UI.layoutToken
    C_Timer.After(0.1, function() if token == UI.layoutToken then UI.Layout() end end)
  end)
  f:Hide()
  table.insert(UISpecialFrames, "LoreForeverFrame")   -- Escape closes it, like the map

  local title = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  title:SetPoint("TOP", 0, -5)
  title:SetText("Lore Forever")

  -- Header: where you are, then the panel-wide actions.
  UI.contextLine = f:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
  UI.contextLine:SetPoint("TOPLEFT", 16, -34)
  UI.contextLine:SetPoint("TOPRIGHT", -350, -34)
  UI.contextLine:SetJustifyH("LEFT")
  if UI.contextLine.SetWordWrap then UI.contextLine:SetWordWrap(false) end

  local newChat = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  newChat:SetSize(82, 22)
  newChat:SetPoint("TOPRIGHT", -14, -30)
  newChat:SetText(L["New chat"])
  newChat:SetScript("OnClick", function() UI.Clear() end)
  UI.newButton = newChat

  local history = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  history:SetSize(70, 22)
  history:SetPoint("RIGHT", newChat, "LEFT", -6, 0)
  history:SetText(L["History"])
  history:SetScript("OnClick", function() UI.ToggleHistory() end)
  UI.historyButton = history

  -- Narrate where you are, whatever the conversation is showing.
  local zoneListen = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  zoneListen:SetSize(170, 22)
  zoneListen:SetPoint("RIGHT", history, "LEFT", -6, 0)
  zoneListen:SetText(L["Listen to this area"])
  zoneListen:SetScript("OnClick", function()
    local zt = UI.ZoneTarget()
    if zt then UI.PlayEntry(zt.key, string.format(L["Tell me the story of %s"], UI.engine.db.entries[zt.key].n)) end
  end)
  UI.zoneListenButton = zoneListen

  -- Sidebar: its own tinted column with a divider, so it reads as navigation rather than conversation.
  local side = Area(f, 0, 0, 0, 0.35)
  side:SetPoint("TOPLEFT", 8, -60)
  side:SetPoint("BOTTOMRIGHT", f, "BOTTOMLEFT", SIDE_W, 8)
  local divider = f:CreateTexture(nil, "ARTWORK")
  divider:SetColorTexture(1, 0.82, 0, 0.25)
  divider:SetPoint("TOPLEFT", SIDE_W, -60)
  divider:SetPoint("BOTTOMLEFT", SIDE_W, 8)
  divider:SetWidth(1)

  -- Sidebar tabs: "Here" (this place and your quests), "Narrations" (every recorded story, grouped), "Playlist"
  -- (what you've queued; its count shows from any tab) and "Journey" (what this character has done, and chapters).
  UI.tabs = {}
  for _, spec in ipairs({ { "here", L["Here"], 44, 8 }, { "narrations", L["Narrations"], 74, 54 },
      { "playlist", L["Playlist"], 62, 130 }, { "journey", L["Journey"], 54, 194 } }) do
    local tab = TextButton(f, spec[3], 22, "GameFontNormal", { 0.2, 0.16, 0.08, 0.6 })
    tab:SetPoint("TOPLEFT", spec[4], -64)
    tab.text:SetPoint("TOPLEFT", 2, -2)
    tab.text:SetPoint("BOTTOMRIGHT", -2, 2)
    tab.text:SetJustifyH("CENTER")
    if tab.text.SetWordWrap then tab.text:SetWordWrap(false) end
    tab.text:SetText(spec[2])
    local on = tab:CreateTexture(nil, "ARTWORK")
    on:SetPoint("BOTTOMLEFT")
    on:SetPoint("BOTTOMRIGHT")
    on:SetHeight(2)
    on:SetColorTexture(1, 0.82, 0, 0.9)
    tab.on = on
    -- A brief gold flash when something is added to the playlist.
    local flash = tab:CreateTexture(nil, "OVERLAY")
    flash:SetAllPoints()
    flash:SetColorTexture(1, 0.82, 0, 0.45)
    flash:Hide()
    tab.flash = flash
    tab.view = spec[1]
    tab:SetScript("OnClick", function(self) UI.ShowTab(self.view) end)
    UI.tabs[#UI.tabs + 1] = tab
    if spec[1] == "playlist" then
      tab.count = tab:CreateFontString(nil, "OVERLAY", "GameFontNormal")
      tab.count:SetPoint("RIGHT", -4, 0)
      UI.playlistTab = tab
    end
  end
  local hereView = CreateFrame("Frame", nil, f)
  hereView:SetAllPoints(f)
  UI.hereView = hereView
  local narrView = CreateFrame("Frame", nil, f)
  narrView:SetAllPoints(f)
  narrView:Hide()
  UI.narrView = narrView
  UI.CreateNarrations(narrView)
  local plView = CreateFrame("Frame", nil, f)
  plView:SetAllPoints(f)
  plView:Hide()
  UI.plView = plView
  UI.CreatePlaylist(plView)
  local journeyView = CreateFrame("Frame", nil, f)
  journeyView:SetAllPoints(f)
  journeyView:Hide()
  UI.journeyView = journeyView
  ns.Journey.CreateView(journeyView)

  UI.hereHeader = Header(hereView, L["Here"])
  UI.hereHeader:SetPoint("TOPLEFT", 16, -94)
  UI.hereHeader:SetWidth(SIDE_W - 20)
  if UI.hereHeader.SetWordWrap then UI.hereHeader:SetWordWrap(false) end
  UI.suggestions = {}
  for i = 1, 5 do
    local b = TextButton(hereView, SIDE_W - 16, 30)
    b:SetPoint("TOPLEFT", 12, -112 - (i - 1) * 31)
    b:SetScript("OnClick", function(self)
      if self.primer then UI.ShowPrimer(self.primer, "here")
      elseif self.key and self.idx then UI.ShowFaq(self.key, self.idx, "here")
      elseif self.key then UI.ShowEntry(self.key, "here", self.label) end
    end)
    -- Rows with a recorded narration get a play button, so you can tell what has a voice without opening it, and
    -- your target's story also gets a + to queue it.
    b.play = PlayButton(b)
    b.play:SetPoint("RIGHT", -2, 0)
    b.add = QueueButton(b, 18)
    b.add:SetPoint("RIGHT", b.play, "LEFT", -2, 0)
    -- Your target: a gold outline, so it's clear why it leads the list.
    local mark = b:CreateTexture(nil, "BACKGROUND")
    mark:SetAllPoints()
    mark:SetColorTexture(1, 0.82, 0, 0.12)
    mark:Hide()
    b.mark = mark
    b:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      if self.primer then GameTooltip:AddLine(L["Dungeon primer: why you're here and who you'll face"])
      elseif self.target then GameTooltip:AddLine(L["Your target: open their story"])
      elseif self.idx then GameTooltip:AddLine(L["Ask this question"])
      else GameTooltip:AddLine(L["Open the full story"]) end
      if self.play and self.play:IsShown() then
        GameTooltip:AddLine(L["Narrated: press the arrow to listen"], 1, 1, 1)
      end
      GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function() GameTooltip:Hide() end)
    UI.suggestions[i] = b
  end

  -- Inside a dungeon: its bosses in encounter order, each opening its story, with play, + and "Queue all".
  UI.bossHeader = Header(hereView, L["Bosses, in order"])
  local queueAll = TextButton(hereView, 70, 16, "GameFontHighlightSmall", { 0.20, 0.42, 0.14, 0.9 })
  queueAll.text:SetJustifyH("CENTER")
  queueAll.text:SetPoint("TOPLEFT", 2, -1)
  queueAll.text:SetPoint("BOTTOMRIGHT", -2, 1)
  if queueAll.text.SetWordWrap then queueAll.text:SetWordWrap(false) end
  queueAll.text:SetText(L["Queue all"])
  queueAll:SetPoint("BOTTOMRIGHT", UI.bossHeader.rule, "TOPRIGHT", 0, 2)
  queueAll:SetScript("OnClick", function() UI.QueueBosses(UI.hereBosses) end)
  queueAll:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Queue all"])
    GameTooltip:AddLine(L["Adds each narrated boss's story to your playlist, in order. Spoilers stay out."], 1, 1, 1, true)
    GameTooltip:Show()
  end)
  queueAll:SetScript("OnLeave", function() GameTooltip:Hide() end)
  UI.queueAllButton = queueAll
  UI.bossButtons = {}
  for i = 1, 12 do
    local b = TextButton(hereView, SIDE_W - 16, 22)
    if b.text.SetWordWrap then b.text:SetWordWrap(false) end
    b:SetScript("OnClick", function(self) UI.ShowEntry(self.key, "here", self.asked) end)
    b:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:AddLine(self.name)
      if self.hook then GameTooltip:AddLine(self.hook, 1, 1, 1, true) end
      GameTooltip:AddLine(L["Click to open their story"], 0.6, 0.6, 0.6)
      GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function() GameTooltip:Hide() end)
    b.play = PlayButton(b)
    b.play:SetPoint("RIGHT", -2, 0)
    b.add = QueueButton(b, 16)
    b.add:SetPoint("RIGHT", b.play, "LEFT", -2, 0)
    local mark = b:CreateTexture(nil, "BACKGROUND")
    mark:SetAllPoints()
    mark:SetColorTexture(1, 0.82, 0, 0.12)
    mark:Hide()
    b.mark = mark
    b:Hide()
    UI.bossButtons[i] = b
  end

  local questHeader = Header(hereView, L["Your quests"])
  questHeader:SetPoint("TOPLEFT", 16, -112 - 5 * 31 - 10)
  UI.questHeader = questHeader
  UI.questButtons = {}
  for i = 1, 8 do
    local b = TextButton(hereView, SIDE_W - 16, 22)
    b:SetPoint("TOPLEFT", 12, -112 - 5 * 31 - 28 - (i - 1) * 23)
    b:SetScript("OnClick", function(self)
      if self.key then UI.ShowEntry(self.key, "quest", self.quest and self.quest.title)
      elseif self.quest then UI.ShowQuestText(self.quest) end
    end)
    b:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:AddLine(self.key and L["The story behind this quest"] or L["No written lore yet"])
      if not self.key then
        GameTooltip:AddLine(L["Shows the quest's own text and the story of the area."], 1, 1, 1, true)
      end
      GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function() GameTooltip:Hide() end)
    UI.questButtons[i] = b
  end

  -- What the colours mean (Here tab only), so gold / white / grey never have to be guessed.
  local hint = hereView:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  hint:SetPoint("BOTTOMLEFT", 16, 14)
  hint:SetWidth(SIDE_W - 20)
  hint:SetJustifyH("LEFT")
  if hint.SetWordWrap then hint:SetWordWrap(false) end
  hint:SetText(string.format(L["%s story  %s question  %s quest text"], GOLD .. L["Gold"] .. "|r",
    WHITE .. L["White"] .. "|r", GREY .. L["Grey"] .. "|r") .. "\n"
    .. L["Lore adapted from warcraft.wiki.gg (CC BY-SA)"] .. "|r")

  -- Conversation
  local sfOk, sf = pcall(CreateFrame, "ScrollFrame", "LoreForeverScroll", f, "UIPanelScrollFrameTemplate")
  if not sfOk or not sf then
    sf = CreateFrame("ScrollFrame", "LoreForeverScroll", f)
    sf:EnableMouseWheel(true)
    sf:SetScript("OnMouseWheel", function(self, delta)
      local cur, max = self:GetVerticalScroll(), self:GetVerticalScrollRange()
      self:SetVerticalScroll(math.max(0, math.min(max, cur - delta * 40)))
    end)
  end
  sf:SetPoint("TOPLEFT", CHAT_X, -64)
  sf:SetPoint("BOTTOMRIGHT", -34, 128)
  local content = CreateFrame("Frame", nil, sf)
  content:SetSize(CHAT_W, 100)
  sf:SetScrollChild(content)
  UI.scroll, UI.content = sf, content

  local np = CreateFrame("Frame", nil, f)
  np:SetPoint("TOPLEFT", CHAT_X - 4, -60)
  np:SetPoint("TOPRIGHT", f, "TOPRIGHT", -12, -60)
  np:SetHeight(28)
  local npbg = np:CreateTexture(nil, "BACKGROUND")
  npbg:SetAllPoints()
  npbg:SetColorTexture(0.08, 0.22, 0.10, 0.9)
  np.bg = npbg
  np.text = np:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  np.text:SetJustifyH("LEFT")
  if np.text.SetWordWrap then np.text:SetWordWrap(false) end
  -- With a playlist, a second line says what's next, so it's visible from every tab.
  np.upNext = np:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  np.upNext:SetJustifyH("LEFT")
  if np.upNext.SetWordWrap then np.upNext:SetWordWrap(false) end
  local function npButton(label, width, onClick)
    local b = CreateFrame("Button", nil, np, "UIPanelButtonTemplate")
    b:SetSize(width, 22)
    b:SetText(label)
    b:SetScript("OnClick", onClick)
    return b
  end
  np.stop = npButton(L["Stop"], 76, function() UI.StopAll() end)
  np.stop:SetPoint("RIGHT", -4, 0)
  -- Playlist transport: Prev · Pause/Play · Next, in place of Stop (Pause is the playlist's Stop). Prev and Next are
  -- the game's page arrows, so the bar still leaves room for the title on a narrow panel.
  local function arrowButton(dir, tip, onClick)
    local b = CreateFrame("Button", nil, np)
    b:SetSize(26, 26)
    b:SetNormalTexture("Interface\\Buttons\\UI-SpellbookIcon-" .. dir .. "Page-Up")
    b:SetPushedTexture("Interface\\Buttons\\UI-SpellbookIcon-" .. dir .. "Page-Down")
    b:SetDisabledTexture("Interface\\Buttons\\UI-SpellbookIcon-" .. dir .. "Page-Disabled")
    b:SetHighlightTexture("Interface\\Buttons\\UI-Common-MouseHilight", "ADD")
    b:SetScript("OnClick", onClick)
    b:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
      GameTooltip:AddLine(tip)
      GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function() GameTooltip:Hide() end)
    return b
  end
  np.next = arrowButton("Next", L["Next narration"], function() UI.PlaylistNext() end)
  np.next:SetPoint("RIGHT", -4, 0)
  np.play = npButton(L["Pause"], 62, function() UI.PlaylistToggle() end)
  np.play:SetPoint("RIGHT", np.next, "LEFT", -2, 0)
  np.prev = arrowButton("Prev", L["Previous narration"], function() UI.PlaylistPrev() end)
  np.prev:SetPoint("RIGHT", np.play, "LEFT", -2, 0)
  np:Hide()
  UI.nowPlaying = np
  UI.CreateHistory(f)

  -- "Added to your playlist: ..." for a few seconds over the bottom of the conversation.
  local toast = CreateFrame("Frame", nil, f)
  toast:SetPoint("BOTTOMLEFT", sf, "BOTTOMLEFT", 0, 4)
  toast:SetPoint("BOTTOMRIGHT", sf, "BOTTOMRIGHT", 0, 4)
  toast:SetHeight(24)
  toast:SetFrameLevel((f:GetFrameLevel() or 1) + 10)
  local tbg = toast:CreateTexture(nil, "BACKGROUND")
  tbg:SetAllPoints()
  tbg:SetColorTexture(0.03, 0.03, 0.06, 0.94)
  toast.text = toast:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  toast.text:SetPoint("LEFT", 8, 0)
  toast.text:SetPoint("RIGHT", -8, 0)
  toast.text:SetJustifyH("LEFT")
  if toast.text.SetWordWrap then toast.text:SetWordWrap(false) end
  toast:Hide()
  UI.toast = toast

  -- Suggested replies under the conversation
  UI.nextLabel = f:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  UI.nextLabel:SetPoint("BOTTOMLEFT", CHAT_X + 2, 110)
  UI.nextLabel:SetText(L["Suggested:"])
  UI.nextButtons = {}
  for i = 1, N_NEXT do
    local b = TextButton(f, CHAT_W, 20, "GameFontHighlightSmall", { 0.25, 0.20, 0.10, 0.55 })
    b:SetPoint("BOTTOMLEFT", CHAT_X, 108 - i * 22)
    b:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -36, 108 - i * 22)
    b:SetScript("OnClick", function(self)
      if self.live then ns.Companion.Ask(self.live)
      elseif self.section then UI.ShowSection(self.key, self.idx)
      elseif self.key and self.idx then UI.ShowFaq(self.key, self.idx, self.via or "next")
      elseif self.key then UI.ShowEntry(self.key, self.via or "next") end
    end)
    UI.nextButtons[i] = b
  end

  -- Message box
  local bar = Area(f, 0, 0, 0, 0.3)
  bar:SetPoint("BOTTOMLEFT", CHAT_X - 4, 10)
  bar:SetPoint("TOPRIGHT", f, "BOTTOMRIGHT", -12, 44)
  local eb = CreateFrame("EditBox", "LoreForeverInput", f, "InputBoxTemplate")
  eb:SetPoint("BOTTOMLEFT", CHAT_X + 8, 16)
  eb:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -96, 16)
  eb:SetHeight(24)
  eb:SetAutoFocus(false)
  eb:SetMaxLetters(240)
  eb:SetScript("OnEnterPressed", function(self)
    local c = UI.completion
    local pick = c and c:IsShown() and UI.completionSel and c.rows[UI.completionSel]
    local q = self:GetText()
    self:SetText("")
    UI.HideCompletion()
    if pick and pick:IsShown() and pick.key then
      UI.ShowFaq(pick.key, pick.idx, "complete")
    elseif q and q:match("%S") then
      UI.Ask(q, "typed")
    end
  end)
  eb:SetScript("OnEscapePressed", function(self)
    if UI.completion and UI.completion:IsShown() then UI.HideCompletion() else self:ClearFocus() end
  end)
  -- Placeholder hint inside the box while it's empty.
  local hintText = eb:CreateFontString(nil, "OVERLAY", "GameFontDisable")
  hintText:SetPoint("LEFT", 4, 0)
  hintText:SetPoint("RIGHT", -4, 0)
  hintText:SetJustifyH("LEFT")
  if hintText.SetWordWrap then hintText:SetWordWrap(false) end
  hintText:SetText(L["Ask anything about the world"])
  UI.inputHint = hintText
  local function updateHint(self)
    hintText:SetShown((self:GetText() or "") == "" and not (self.HasFocus and self:HasFocus()))
  end
  eb:SetScript("OnEditFocusGained", function(self) hintText:Hide() end)
  eb:SetScript("OnTextChanged", function(self, userInput)
    updateHint(self)
    if userInput then UI.QueueCompletion(self:GetText()) end
  end)
  eb:SetScript("OnArrowPressed", function(_, key)
    if key == "UP" then UI.MoveCompletion(-1) elseif key == "DOWN" then UI.MoveCompletion(1) end
  end)
  eb:SetScript("OnTabPressed", function() UI.MoveCompletion(1) end)
  eb:SetScript("OnEditFocusLost", function(self)
    updateHint(self)
    C_Timer.After(0.2, UI.HideCompletion)
  end)
  UI.input = eb
  local send = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  send:SetSize(56, 24)
  send:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -30, 16)
  send:SetText(L["Send"])
  send:SetScript("OnClick", function() eb:GetScript("OnEnterPressed")(eb) end)
  UI.CreateCompletion(f, eb)

  f:SetScript("OnShow", function() UI.Refresh() end)
  UI.ShowTab("here")
  UI.SetNext({})
  return f
end

-- Type-ahead ---------------------------------------------------------------------------------------------------

function UI.CreateCompletion(parent, eb)
  local c = CreateFrame("Frame", nil, parent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  c:SetPoint("BOTTOMLEFT", eb, "TOPLEFT", -6, 4)
  c:SetSize(CHAT_W, N_COMPLETE * 20 + 10)
  c:SetFrameStrata("DIALOG")
  if c.SetBackdrop then
    c:SetBackdrop({ bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
      edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", tile = true, tileSize = 16, edgeSize = 12,
      insets = { left = 3, right = 3, top = 3, bottom = 3 } })
    if c.SetBackdropColor then c:SetBackdropColor(0.05, 0.05, 0.08, 0.95) end
  end
  c.rows = {}
  for i = 1, N_COMPLETE do
    local b = TextButton(c, CHAT_W - 10, 20, "GameFontHighlightSmall")
    b:SetPoint("TOPLEFT", 5, -5 - (i - 1) * 20)
    local sel = b:CreateTexture(nil, "BACKGROUND")
    sel:SetAllPoints()
    sel:SetColorTexture(1, 0.82, 0, 0.18)
    sel:Hide()
    b.sel = sel
    b:SetScript("OnClick", function(self)
      UI.input:SetText("")
      UI.HideCompletion()
      if self.key then UI.ShowFaq(self.key, self.idx, "complete") end
    end)
    c.rows[i] = b
  end
  c:Hide()
  UI.completion = c
end

function UI.HideCompletion()
  UI.completeToken = (UI.completeToken or 0) + 1
  UI.completionSel = nil
  if UI.completion then UI.completion:Hide() end
end

function UI.QueueCompletion(text)
  UI.completeToken = (UI.completeToken or 0) + 1
  local token = UI.completeToken
  C_Timer.After(0.12, function()
    if token == UI.completeToken then UI.ShowCompletion(text) end
  end)
end

function UI.ShowCompletion(text)
  local c = UI.completion
  if not c then return end
  if not text or #text:gsub("%s", "") < 3 then return UI.HideCompletion() end
  if UI.ctx then UI.ctx.done = ns.Context.Done() end
  local items = UI.engine:Complete(text, UI.ctx, N_COMPLETE)
  if #items == 0 then return UI.HideCompletion() end
  for i, b in ipairs(c.rows) do
    local it = items[i]
    if it then
      b.key, b.idx = it.key, it.idx
      b.text:SetText(WHITE .. esc(it.q) .. "|r  " .. GREY .. esc(it.name) .. "|r")
      b.sel:Hide()
      b:Show()
    else
      b:Hide()
    end
  end
  UI.completionSel = nil
  c:SetHeight(#items * 20 + 10)
  c:Show()
end

function UI.MoveCompletion(delta)
  local c = UI.completion
  if not (c and c:IsShown()) then return end
  local n = 0
  for _, b in ipairs(c.rows) do if b:IsShown() then n = n + 1 end end
  if n == 0 then return end
  local i = ((UI.completionSel or 0) + delta - 1) % n + 1
  for j, b in ipairs(c.rows) do b.sel:SetShown(j == i) end
  UI.completionSel = i
end

-- Listening ------------------------------------------------------------------------------------------------------
-- Every answer bubble has its own Listen button, and the header narrates the area. A target is {id, key, text}:
-- key picks a recorded narration when there is one (overviews and primers), text is read aloud otherwise.

-- An entry's overview as something to play: its recording if it has one, else its summary and first section.
-- The id is the entry key, so the sidebar, the header and an answer bubble all agree on what's playing.
function UI.EntryTarget(key)
  local e = key and UI.engine.db.entries[key]
  if not e then return nil end
  local first = e.sec and e.sec[1]
  local parts = { e.n .. ".", e.s }
  local open = UI.Unlocked(key)
  for _, sec in ipairs(e.sec or {}) do
    if (sec.sp or 0) == 0 or open then parts[#parts + 1] = sec.t .. ". " .. sec.b end
  end
  return { id = key, key = key, label = e.n, text = table.concat(parts, " ") }
end

-- A FAQ answer as something to play; the starting zones and capitals have these recorded ("zone:elwynn#faq2").
function UI.FaqTarget(key, idx)
  local e = key and UI.engine.db.entries[key]
  local f = e and e.faq and e.faq[idx]
  if not f then return nil end
  local akey = key .. "#faq" .. idx
  return { id = akey, key = akey, label = f.q, text = f.a }   -- read the answer only; the question is on screen
end

function UI.ZoneTarget()
  local ctx = (UI.frame and UI.frame:IsShown() and UI.ctx) or ns.Context.Snapshot()
  local db = UI.engine.db
  local zk = UI.engine:ZoneKey(ctx.zone)
  local sub = ctx.subzone and db.index.name[ns.Engine.lower(ctx.subzone)]
  -- The zone when it's narrated; otherwise the most specific place with lore.
  local key = (zk and ns.Voice.HasAudio("zone:" .. zk) and "zone:" .. zk)
    or (sub and db.entries[sub] and db.entries[sub].t == "subzone" and sub) or (zk and "zone:" .. zk)
  return UI.EntryTarget(key)
end

-- Reset the buttons once playback ends, checked each second. Recordings report when they stop; text-to-speech
-- doesn't, so estimate its length from the text (about 15 characters a second).
local function watchPlayback(estimate)
  local started = GetTime and GetTime() or 0
  local token = {}
  UI.playToken = token
  local function check()
    if UI.playToken ~= token or not UI.speaking then return end
    local playing = ns.Voice.IsPlaying()
    local elapsed = (GetTime and GetTime() or 0) - started
    if playing == false or (playing == nil and elapsed > estimate) or elapsed > 300 then
      UI.speaking, UI.playingId = false, nil
      UI.UpdateListen()
      UI.OnClipEnded()
    else
      C_Timer.After(1, check)
    end
  end
  C_Timer.After(1, check)
end

-- Start a target playing, replacing whatever plays now. Returns true if it started. The playlist plays recordings
-- only and leaves an open History list alone (it moves on by itself; you didn't just press anything).
local function startTarget(target, fromPlaylist)
  ns.Voice.Stop()
  UI.speaking, UI.playingId = false, nil
  local started = target and (fromPlaylist and ns.Voice.Play(target.key) or ns.Voice.Narrate(target.key, target.text))
  if not started then return false end
  UI.speaking, UI.playingId, UI.playingLabel = true, target.id, target.label
  if UI.historyFrame and not fromPlaylist then UI.historyFrame:Hide() end
  watchPlayback(#ns.Voice.Plain(target.text) / 15 + 3)
  return true
end

-- Play a target. Pressing the one that's playing stops it; pressing anything else switches to it. Playing
-- something by hand pauses a playing playlist, except the playlist's own current item, which resumes it.
function UI.ListenTo(target)
  if not target then return end
  local pl = UI.pl
  if UI.speaking and UI.playingId == target.id then return UI.StopAll() end
  local cur = pl.items[pl.pos]
  if cur and cur.id == target.id then
    pl.state = "playing"
    if not startTarget(target) then pl.state = "paused" end
  else
    if pl.state == "playing" then pl.state = "paused" end
    startTarget(target)
  end
  UI.UpdateListen()
end

-- Stop any narration or read-aloud, whatever started it. A playlist pauses at the item it was on.
function UI.StopAll()
  ns.Voice.Stop()
  UI.speaking, UI.playingId = false, nil
  if UI.pl.state ~= "paused" then UI.pl.state = "paused" end
  UI.UpdateListen()
end

-- Whether anything is playing, or a playlist is between two items.
function UI.IsBusy()
  return UI.speaking or UI.pl.state == "playing"
end

-- Play an entry's narration and show its story in the chat, so what you hear is always on screen. Pressing it
-- again while it plays stops it (without posting the story twice).
function UI.PlayEntry(key, asked)
  local t = UI.EntryTarget(key)
  if not t then return end
  if UI.speaking and UI.playingId == t.id then return UI.ListenTo(t) end
  UI.ShowEntry(key, "listen", asked)
  UI.ListenTo(t)
end

-- The "Now playing" bar pinned above the conversation, and the Stop button on the menu-bar book: both visible
-- whenever something plays, so stopping never means scrolling back to the bubble that started it.
-- With a playlist the bar has two lines and Prev · Pause/Play · Next in place of Stop, and it stays up while the
-- playlist is paused so it can be resumed from any tab.
function UI.UpdateNowPlaying()
  local bar, playing, pl = UI.nowPlaying, UI.speaking, UI.pl
  local n = #pl.items
  local list, cur = n > 0, pl.items[pl.pos]
  if bar then
    local show = playing or list
    bar:SetShown(show)
    bar:SetHeight(list and 38 or 28)
    bar.bg:SetColorTexture(0.08, 0.22, 0.10, 0.9)
    bar.stop:SetShown(not list)
    bar.prev:SetShown(list)
    bar.play:SetShown(list)
    bar.next:SetShown(list)
    bar.upNext:SetShown(list)
    bar.text:ClearAllPoints()
    if list then
      -- Play/Pause fits its label (German runs longer); the text gets the rest of the width.
      bar.play:SetText(pl.state == "playing" and L["Pause"] or L["Play"])
      local tw = bar.play.GetTextWidth and tonumber(bar.play:GetTextWidth())
      local pw = math.max(56, (tw or 40) + 22)
      bar.play:SetWidth(pw)
      local right = -(4 + 26 + 2 + pw + 2 + 26 + 8)
      bar.text:SetPoint("TOPLEFT", 10, -5)
      bar.text:SetPoint("TOPRIGHT", bar, "TOPRIGHT", right, -5)
      bar.upNext:ClearAllPoints()
      bar.upNext:SetPoint("TOPLEFT", 10, -21)
      bar.upNext:SetPoint("TOPRIGHT", bar, "TOPRIGHT", right, -21)
      -- The count leads the second line, so a narrow panel cuts the next title, not the count.
      local count = GREY .. string.format(L["%d of %d"], pl.pos, n) .. "  |r"
      local nxt = pl.items[pl.pos + 1]
      local upNext = count .. (nxt and (GOLD .. L["Up next:"] .. "|r " .. esc(nxt.label))
        or (GREY .. L["Last in your playlist"] .. "|r"))
      if pl.state == "playing" or (pl.state == "waiting" and not playing) then
        bar.text:SetText(GREEN .. L["Now playing:"] .. "|r " .. WHITE .. esc(cur.label) .. "|r")
        bar.upNext:SetText(upNext)
      elseif playing then
        -- Something played by hand while the playlist waits.
        bar.text:SetText(GREEN .. L["Now playing:"] .. "|r " .. WHITE .. esc(UI.playingLabel or L["narration"]) .. "|r")
        bar.upNext:SetText(count .. GOLD .. (pl.state == "waiting" and L["Then your playlist:"] or L["Playlist paused at:"])
          .. "|r " .. esc(cur.label))
      else
        bar.bg:SetColorTexture(0.16, 0.14, 0.10, 0.92)
        bar.text:SetText(GOLD .. L["Paused:"] .. "|r " .. WHITE .. esc(cur.label) .. "|r")
        bar.upNext:SetText(upNext)
      end
    else
      bar.text:SetPoint("LEFT", 10, 0)
      bar.text:SetPoint("RIGHT", -90, 0)
      if playing then
        bar.text:SetText(GREEN .. L["Now playing:"] .. "|r " .. WHITE .. esc(UI.playingLabel or L["narration"]) .. "|r")
      end
    end
    UI.scroll:ClearAllPoints()
    UI.scroll:SetPoint("TOPLEFT", CHAT_X, show and (list and -102 or -92) or -64)
    UI.scroll:SetPoint("BOTTOMRIGHT", -34, 128)
  end
  local l = _G.LoreForeverLauncher
  if l and l.stop then l.stop:SetShown(UI.IsBusy() and l:IsShown()) end
  if ns.SetButtonsPlaying then ns.SetButtonsPlaying(UI.IsBusy()) end
  local tab = UI.playlistTab
  if tab then
    -- The count sits on its own at the tab's right edge, so a long translation cuts the label, not the count.
    tab.count:SetText(list and (GREEN .. n .. "|r") or "")
    tab.text:SetPoint("BOTTOMRIGHT", list and -18 or -2, 2)
  end
  if UI.tab == "playlist" and UI.plView then UI.RefreshPlaylist() end
end

function UI.UpdateListen()
  UI.UpdateNowPlaying()
  local canTTS = ns.Voice.Available()
  if UI.tab == "narrations" and UI.narrRows then UI.RefreshNarrations() end
  -- The Here tab's + buttons follow the playlist (a check once queued).
  for _, b in ipairs(UI.bossButtons or {}) do
    if b:IsShown() and b.add:IsShown() then SetQueueButton(b.add, b.key) end
  end
  for _, b in ipairs(UI.suggestions or {}) do
    if b:IsShown() and b.target and b.add:IsShown() then SetQueueButton(b.add, b.key) end
  end
  for _, b in ipairs(UI.bubbles or {}) do
    for _, r in ipairs(b.rows) do
      if r:IsShown() then SetQueueButton(r.add, r.key) end
    end
  end
  for _, b in ipairs(UI.bubbles or {}) do
    -- Recorded narrations say "Listen"; everything else says "Read aloud" (the game's own voice), so the two are
    -- never confused. Heroes (the welcome card) use their big action button instead.
    local t = b.listen.target
    if b.frame:IsShown() and t and not b.isHero then
      local recorded = ns.Voice.HasAudio(t.key)
      local playing = UI.speaking and UI.playingId == t.id
      b.listen:SetText(playing and L["Stop"] or (recorded and L["Listen"] or L["Read aloud"]))
      b.listen.recorded = recorded
      b.listen:SetShown(recorded or canTTS)
      -- "Add to playlist" beside Listen on recorded stories and answers.
      local qk, qi = UI.QueueRef(t)
      local can = recorded and qk and UI.CanQueue(qk, qi)
      b.queue:SetShown(can and b.listen:IsShown() or false)
      if can then
        local queued = UI.PlaylistIndex(t.id) ~= nil
        b.queue:SetText(queued and L["In playlist"] or L["Add to playlist"])
        local qw = b.queue.GetTextWidth and tonumber(b.queue:GetTextWidth())
        b.queue:SetWidth(math.max(90, (qw or 90) + 20))
      end
    elseif b.queue then
      b.queue:Hide()
    end
    if b.isHero and b.action.target then
      local playing = UI.speaking and UI.playingId == b.action.target.id
      b.action:SetText(playing and L["Stop"] or b.action.label)
    end
  end
  local z = UI.zoneListenButton
  if z then
    local zt = UI.ZoneTarget()
    z:SetShown(zt ~= nil and (canTTS or ns.Voice.HasAudio(zt.key)))
    if zt then
      local name = UI.engine.db.entries[zt.key].n
      z:SetText((UI.speaking and UI.playingId == zt.id) and L["Stop"]
        or string.format(ns.Voice.HasAudio(zt.key) and L["Listen: %s"] or L["Read aloud: %s"], name))
      local tw = z.GetTextWidth and tonumber(z:GetTextWidth())
      -- Narrower on a narrow panel, so the place line keeps some room.
      local fw = UI.frame and tonumber(UI.frame:GetWidth()) or W
      z:SetWidth(math.max(90, math.min(230, fw - SIDE_W - 200, (tw or 150) + 24)))
    end
    UI.contextLine:ClearAllPoints()
    UI.contextLine:SetPoint("TOPLEFT", 16, -34)
    -- The place line stops just before the header buttons, whatever width the Listen button has.
    UI.contextLine:SetPoint("RIGHT", z:IsShown() and z or UI.historyButton, "LEFT", -10, 0)
  end
end

-- Conversation ---------------------------------------------------------------------------------------------------

-- Typing animation ------------------------------------------------------------------------------------------------
-- New answers type in quickly (about 600 characters a second, never more than 1.2s) instead of appearing at once.
-- The bubble is sized for the full text first, so nothing jumps; escape codes are revealed whole, never cut in half.
local TYPE_CPS, TYPE_MAX, TYPE_TICK = 600, 1.2, 0.03

local function typeTokens(s)
  local toks, i, n = {}, 1, #s
  while i <= n do
    local c = s:sub(i, i)
    if c == "|" then
      local nx = s:sub(i + 1, i + 1)
      if nx == "c" then toks[#toks + 1] = { s:sub(i, i + 9), 0 }; i = i + 10
      elseif nx == "|" then toks[#toks + 1] = { "||", 1 }; i = i + 2
      elseif nx == "H" then   -- a whole hyperlink (|H...|h text |h) counts as one step
        local j = s:find("|h", i + 2, true)
        local k = j and s:find("|h", j + 2, true)
        if k then toks[#toks + 1] = { s:sub(i, k + 1), 1 }; i = k + 2
        else toks[#toks + 1] = { c, 1 }; i = i + 1 end
      else toks[#toks + 1] = { s:sub(i, i + 1), 0 }; i = i + 2 end   -- |r and friends
    else
      local byte = c:byte()
      local len = (byte >= 240 and 4) or (byte >= 224 and 3) or (byte >= 192 and 2) or 1   -- UTF-8
      toks[#toks + 1] = { s:sub(i, i + len - 1), 1 }; i = i + len
    end
  end
  return toks
end

local function finishTyping()
  local ty = UI.typing
  if not ty then return end
  UI.typing = nil
  if ty.ticker then ty.ticker:Cancel() end
  ty.m.revealed = true
  ty.fs:SetText(ty.m.text)
end
UI.FinishTyping = finishTyping

local function startTyping(fs, m)
  finishTyping()
  local toks, visible = typeTokens(m.text), 0
  for _, tk in ipairs(toks) do visible = visible + tk[2] end
  local steps = math.max(1, math.floor(math.min(TYPE_MAX, visible / TYPE_CPS) / TYPE_TICK))
  local per = math.max(1, math.ceil(visible / steps))
  local ty = { fs = fs, m = m }
  local shown, j, parts = 0, 0, {}
  fs:SetText("")
  UI.typing = ty
  ty.ticker = C_Timer.NewTicker(TYPE_TICK, function()
    if UI.typing ~= ty then return end
    local goal = shown + per
    while j < #toks and shown < goal do
      j = j + 1
      parts[#parts + 1] = toks[j][1]
      shown = shown + toks[j][2]
    end
    if j >= #toks then return finishTyping() end
    fs:SetText(table.concat(parts))
  end)
end

-- Rating an answer (LOR-120): a check and a cross at the bottom left of every answer. The cross also opens the report
-- box (UI.ShowReport), which asks why and can copy a report code to send. Ratings are saved with the logged question.
local function SetRating(b, log)
  local show = log ~= nil
  b.up:SetShown(show)
  b.down:SetShown(show)
  b.rated:SetShown(show)
  b.up.log, b.down.log = log, log
  if not show then return end
  local h = log.helpful
  b.up.icon:SetAlpha((h == nil or h == true) and 1 or 0.3)
  b.down.icon:SetAlpha((h == nil or h == false) and 1 or 0.3)
  b.rated:SetText(h == true and (GREEN .. L["Thanks!"] .. "|r") or h == false and (GREY .. L["Noted."] .. "|r") or "")
end

local function RateButtons(parent)
  local function button(texture, onClick, title, tip)
    local b = CreateFrame("Button", nil, parent)
    b:SetSize(18, 18)
    local icon = b:CreateTexture(nil, "ARTWORK")
    icon:SetAllPoints()
    icon:SetTexture(texture)
    b.icon = icon
    b:SetHighlightTexture("Interface\\Buttons\\UI-Common-MouseHilight", "ADD")
    b:SetScript("OnClick", onClick)
    b:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_TOP")
      GameTooltip:AddLine(title)
      GameTooltip:AddLine(tip, 1, 1, 1, true)
      GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function() GameTooltip:Hide() end)
    b:Hide()
    return b
  end
  local rated = parent:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  local up, down
  up = button("Interface\\RaidFrame\\ReadyCheck-Ready", function(self)
    ns.Log.Feedback(self.log, true)
    SetRating({ up = up, down = down, rated = rated }, self.log)
  end, L["Good answer"], L["Tells us this answer was right."])
  down = button("Interface\\RaidFrame\\ReadyCheck-NotReady", function(self)
    if self.log.helpful ~= false then ns.Log.Feedback(self.log, false) end   -- keeps a reason given earlier
    SetRating({ up = up, down = down, rated = rated }, self.log)
    UI.ShowReport(self.log)
  end, L["Not right?"], L["Tell us what was wrong, and copy a short report to send us."])
  up:SetPoint("BOTTOMLEFT", PAD - 2, 6)
  down:SetPoint("LEFT", up, "RIGHT", 6, 0)
  rated:SetPoint("LEFT", down, "RIGHT", 8, 0)
  rated:Hide()
  return up, down, rated
end

local function bubbleAt(i)
  local b = UI.bubbles[i]
  if not b then
    local f = CreateFrame("Frame", nil, UI.content)
    f:EnableMouse(true)
    f:SetScript("OnMouseDown", function() finishTyping() end)
    local bg = f:CreateTexture(nil, "BACKGROUND")
    bg:SetAllPoints()
    local fs = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    fs:SetJustifyH("LEFT")
    fs:SetJustifyV("TOP")
    if fs.SetSpacing then fs:SetSpacing(2) end
    local listen = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
    listen:SetSize(84, 18)
    listen:SetPoint("BOTTOMRIGHT", -6, 6)
    listen:SetText(L["Listen"])
    listen:SetScript("OnClick", function(self) UI.ListenTo(self.target) end)
    listen:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_TOP")
      if self.recorded then
        GameTooltip:AddLine(L["Narrated"])
        GameTooltip:AddLine(L["A recorded narration of this answer."], 1, 1, 1, true)
      else
        GameTooltip:AddLine(L["Read aloud"])
        GameTooltip:AddLine(L["Uses your game's text-to-speech voice. Change it in Options > Accessibility > Text to Speech."],
          1, 1, 1, true)
      end
      GameTooltip:Show()
    end)
    listen:SetScript("OnLeave", function() GameTooltip:Hide() end)
    local queue = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
    queue:SetSize(110, 18)
    queue:SetPoint("RIGHT", listen, "LEFT", -4, 0)
    queue:SetText(L["Add to playlist"])
    -- Works like the + on the Narrations tab: adds, and once added, takes it out again.
    queue:SetScript("OnClick", function()
      local t = listen.target
      local at = t and UI.PlaylistIndex(t.id)
      if at then UI.PlaylistRemove(at) else UI.PlaylistAdd(UI.QueueRef(t)) end
    end)
    queue:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_TOP")
      if listen.target and UI.PlaylistIndex(listen.target.id) then
        GameTooltip:AddLine(L["In your playlist"])
        GameTooltip:AddLine(L["Click to take it out."], 1, 1, 1)
      else
        GameTooltip:AddLine(L["Add to playlist"])
        GameTooltip:AddLine(L["Queues this narration after the others in your playlist (Playlist tab)."], 1, 1, 1, true)
      end
      GameTooltip:Show()
    end)
    queue:SetScript("OnLeave", function() GameTooltip:Hide() end)
    queue:Hide()
    -- The welcome card's big "hear the story" button.
    local action = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
    action:SetSize(300, 26)
    action:SetPoint("BOTTOMLEFT", PAD, 8)
    action:SetScript("OnClick", function(self)
      if self.target then UI.PlayEntry(self.target.key, self.label) end
    end)
    action:Hide()
    b = { frame = f, bg = bg, fs = fs, listen = listen, queue = queue, action = action, rows = {} }
    b.up, b.down, b.rated = RateButtons(f)
    UI.bubbles[i] = b
  end
  return b
end

-- A clickable boss row inside a bubble (the primer's "Who you'll face"): opens that boss's story, with play and +.
local function bossRow(parent)
  local r = TextButton(parent, 100, 20)
  r.text:ClearAllPoints()
  r.text:SetPoint("TOPLEFT", 6, -3)
  r:SetScript("OnClick", function(self) UI.ShowEntry(self.key, "primer", self.asked) end)
  r:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Click to open their story"])
    GameTooltip:Show()
  end)
  r:SetScript("OnLeave", function() GameTooltip:Hide() end)
  r.play = PlayButton(r)
  r.play:SetPoint("TOPRIGHT", -2, 0)
  r.add = QueueButton(r, 16)
  r.add:SetPoint("TOPRIGHT", -26, -2)
  return r
end

-- Lay out a message's boss rows under its text; returns the bubble's new height.
local function layoutRows(b, m, w, h)
  local y = h - PAD + 4
  for j, row in ipairs(m.rows or {}) do
    local r = b.rows[j] or bossRow(b.frame)
    b.rows[j] = r
    r.key, r.asked = row.key, string.format(L["Who is %s?"], row.name)
    r:SetWidth(w - 2 * PAD + 8)
    r.text:SetWidth(w - 2 * PAD - 52)
    r.text:SetText(GREY .. j .. ".|r " .. GOLD .. esc(row.name) .. "|r " .. WHITE .. esc(row.hook or "") .. "|r")
    local rh = math.max(22, (tonumber(r.text:GetStringHeight()) or 14) + 6)
    r:SetHeight(rh)
    r:ClearAllPoints()
    r:SetPoint("TOPLEFT", b.frame, "TOPLEFT", PAD - 6, -y)
    r.play.key, r.play.label = row.key, r.asked
    r.play:SetShown(ns.Voice.HasAudio(row.key))
    SetQueueButton(r.add, row.key)
    r:Show()
    y = y + rh
  end
  for j = #(m.rows or {}) + 1, #b.rows do b.rows[j]:Hide() end
  return m.rows and (y + PAD) or h
end

-- Lay out every message as a bubble: your questions on the right, lore on the left, notes centred in grey.
-- Conversation width for the current window size.
local function chatW()
  local w = UI.frame and UI.frame.GetWidth and tonumber(UI.frame:GetWidth())
  return (w and w > 0) and (w - CHAT_X - 40) or CHAT_W
end

-- Re-fit everything that depends on the window width, then re-flow the bubbles.
function UI.Layout()
  local w = chatW()
  if UI.content then UI.content:SetWidth(w) end
  if UI.completion then UI.completion:SetWidth(w) end
  for _, b in ipairs(UI.completion and UI.completion.rows or {}) do b:SetWidth(w - 10) end
  for _, b in ipairs(UI.historyFrame and UI.historyFrame.rows or {}) do b:SetWidth(w) end
  if UI.msgs then UI.Render(true) end
  if UI.msgs and #UI.msgs > 0 then UI.Refresh() end   -- a taller panel fits more of the Here list
end

function UI.Render(keepScroll)
  local y, latestListen = 6, nil
  local CHAT_W = chatW()
  for i, m in ipairs(UI.msgs) do
    local b = bubbleAt(i)
    local f, fs = b.frame, b.fs
    f:ClearAllPoints()
    fs:ClearAllPoints()
    fs:SetText(m.text)
    local w
    if m.role == "user" then
      local maxW = math.floor(CHAT_W * 0.72)
      fs:SetWidth(maxW - 2 * PAD)
      local tw = fs.GetStringWidth and fs:GetStringWidth()
      w = math.min(maxW, (tonumber(tw) or maxW) + 2 * PAD + 4)
      fs:SetWidth(w - 2 * PAD)
      f:SetPoint("TOPRIGHT", UI.content, "TOPRIGHT", -4, -y)
      b.bg:SetColorTexture(0.16, 0.30, 0.55, 0.7)
    elseif m.role == "lore" then
      w = CHAT_W - 28
      fs:SetWidth(w - 2 * PAD)
      f:SetPoint("TOPLEFT", UI.content, "TOPLEFT", 2, -y)
      b.bg:SetColorTexture(0.11, 0.09, 0.05, 0.9)
    elseif m.role == "hero" then
      w = CHAT_W - 8
      fs:SetWidth(w - 2 * PAD)
      f:SetPoint("TOPLEFT", UI.content, "TOPLEFT", 2, -y)
      b.bg:SetColorTexture(0.30, 0.22, 0.06, 0.55)
    else
      w = CHAT_W - 8
      fs:SetWidth(w - 2 * PAD)
      f:SetPoint("TOPLEFT", UI.content, "TOPLEFT", 2, -y)
      b.bg:SetColorTexture(0, 0, 0, 0)
    end
    fs:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, -PAD)
    local h = (fs:GetStringHeight() or 14) + 2 * PAD
    if m.rows or #b.rows > 0 then h = layoutRows(b, m, w, h) end
    m.y = y
    b.listen.target = m.target
    b.isHero = m.role == "hero"
    b.action.target, b.action.label = nil, nil
    b.action:Hide()
    b.queue:Hide()   -- UpdateListen shows it on recorded answers
    -- Only reserve room for Listen when there's something to play (a recording, or Read aloud turned on).
    local canPlay = m.target and (ns.Voice.HasAudio(m.target.key) or ns.Voice.Available())
    if m.role == "lore" and canPlay then
      h = h + 22
      b.listen:Show()
      latestListen = b.listen
    elseif b.isHero and m.target then
      h = h + 36
      b.listen:Hide()
      b.action.target, b.action.label = m.target, m.actionLabel
      b.action:SetText(m.actionLabel)
      b.action:Show()
    else
      b.listen:Hide()
    end
    -- Answers (and "I don't have that" replies) can be rated; they share the bottom row with Listen.
    local rate = m.log and (m.role == "lore" or m.role == "note") and m.log or nil
    if rate and not (m.role == "lore" and canPlay) then h = h + 22 end
    SetRating(b, rate)
    f:SetSize(w, h)
    f:Show()
    if m.animate and not m.revealed then
      if UI.typing and UI.typing.m == m then
        UI.typing.fs = fs   -- re-layout mid-animation: keep typing into the same bubble
      else
        startTyping(fs, m)
      end
    end
    y = y + h + 10
  end
  for i = #UI.msgs + 1, #UI.bubbles do UI.bubbles[i].frame:Hide() end
  UI.content:SetHeight(y + 8)
  UI.listenButton = latestListen or UI.listenButton   -- the newest answer's Listen (used by /lore listen)
  UI.UpdateListen()
  if keepScroll then return end
  -- Bring the newest exchange into view from its start: your question (or the newest message) at the top, so a
  -- long story reads from its first line instead of opening at its end.
  local top = #UI.msgs
  if top > 1 and UI.msgs[top - 1].role == "user" then top = top - 1 end
  local startY = UI.msgs[top] and UI.msgs[top].y or 0
  C_Timer.After(0, function()
    local range = UI.scroll:GetVerticalScrollRange() or 0
    UI.scroll:SetVerticalScroll(math.max(0, math.min(range, startY - 4)))
  end)
end

-- Add a message. role: "user" | "lore" | "note". target: what its Listen button plays (lore only).
local msgSeq = 0
-- rows (lore only): clickable boss rows under the text, { {key, name, hook}, ... } (the dungeon primer).
-- log: the logged question this message answers (Log.Question), so it can be rated and reported.
function UI.AddMessage(role, text, target, actionLabel, rows, log)
  msgSeq = msgSeq + 1
  if UI.historyFrame then UI.historyFrame:Hide() end
  if role == "lore" and not target then
    -- Read the body, not the heading line (the title or question is already on screen).
    local heading = text:match("^([^\n]*)\n")
    target = { id = "msg" .. time() .. "-" .. msgSeq, text = text:match("^[^\n]*\n(.+)$") or text,
      label = heading and ns.Voice.Plain(heading):gsub("%s*" .. L["(narrated)"]:gsub("%p", "%%%0"), "") or nil }
  end
  finishTyping()
  local animate = role == "lore" and settings().typing ~= false
  table.insert(UI.msgs, { role = role, text = text, target = target, actionLabel = actionLabel, animate = animate,
    rows = rows, log = log })
  local lines = {}
  for i, r in ipairs(rows or {}) do lines[#lines + 1] = i .. ". " .. esc(r.name) .. " " .. esc(r.hook or "") end
  table.insert(UI.blocks, #lines > 0 and (text .. "\n" .. table.concat(lines, "\n")) or text)
  while #UI.msgs > MAX_MESSAGES do
    table.remove(UI.msgs, 1)
    table.remove(UI.blocks, 1)
  end
  UI.Render()
end

-- A grey note in the conversation (kept for callers from before the chat layout).
function UI.Append(text)
  UI.AddMessage("note", text)
end

-- items: { {key, idx?, label?, q?, name?, via?} }, or { live = question, label } to ask live answers
function UI.SetNext(items, label)
  UI.nextLabel:SetText(label or L["Suggested:"])
  UI.nextLabel:SetShown(#items > 0)
  for i, b in ipairs(UI.nextButtons) do
    local it = items[i]
    if it then
      b.key, b.idx, b.via, b.section, b.live = it.key, it.idx, it.via, it.section, it.live
      local who = it.name and (GREY .. "  (" .. esc(it.name) .. ")|r") or ""
      b.text:SetText(WHITE .. esc(it.label or it.q) .. "|r" .. who)
      b:Show()
    else
      b:Hide()
    end
  end
end

-- Panel state ----------------------------------------------------------------------------------------------------

function UI.Toggle()
  if not UI.frame then return end
  UI.frame:SetShown(not UI.frame:IsShown())
end

-- Show the panel (without toggling it closed) on an entry, a FAQ, or just open.
function UI.Open(key, idx, via)
  if not UI.frame then return end
  if not UI.frame:IsShown() then UI.frame:Show() end
  if idx then UI.ShowFaq(key, idx, via) elseif key then UI.ShowEntry(key, via) end
end

-- Re-read context and rebuild the sidebar.
function UI.Refresh()
  if not (UI.frame and UI.frame:IsShown()) then return end
  local ctx = ns.Context.Snapshot()
  UI.ctx = ctx
  ns.Log.Map(ctx)
  UI.contextLine:SetText(esc(ns.Context.Describe(ctx)):gsub("||c", "|c"):gsub("||r", "|r"))

  local here, placeName, bosses, targetKey = UI.HereItems(ctx)
  UI.hereHeader:SetText(string.format(L["Here: %s"], esc(placeName or "?")))
  -- The Here list flows top to bottom: stories and questions, the dungeon's bosses, then your quests, stopping
  -- above the colour hint at the bottom (the panel can be resized taller for more).
  local fh = tonumber(UI.frame:GetHeight()) or H
  local bottom = -(fh - 44)
  local y = -112
  for i, b in ipairs(UI.suggestions) do
    local s = here[i]
    if s then
      b.key, b.idx, b.primer, b.label, b.target = s.key, s.idx, s.primer, s.label, s.target
      b.text:SetText((s.gold and GOLD or WHITE) .. esc(s.label) .. "|r")
      local story = s.key or (s.primer and "zone:" .. s.primer)
      local narrated = not s.idx and ns.Voice.HasAudio(story)
      b.play.key, b.play.label = story, s.label
      b.play:SetShown(narrated)
      local queued = s.target and SetQueueButton(b.add, s.key)
      if not s.target then b.add:Hide() end
      b.mark:SetShown(s.target or false)
      b.text:SetPoint("BOTTOMRIGHT", (narrated and -26 or -6) - (queued and 22 or 0), 2)
      b:ClearAllPoints()
      b:SetPoint("TOPLEFT", 12, y)
      y = y - 31
      b:Show()
    else
      b:Hide()
    end
  end

  UI.hereBosses = bosses
  local nb = 0
  if bosses and #bosses > 0 then
    UI.bossHeader:ClearAllPoints()
    UI.bossHeader:SetPoint("TOPLEFT", 16, y - 6)
    y = y - 26
    local anyQueue = false
    for i, bk in ipairs(bosses) do
      local b = UI.bossButtons[i]
      if not b or y - 22 < bottom then break end
      local e = UI.engine.db.entries[bk]
      local name = bossName(e)
      b.key, b.name, b.hook = bk, name, e.h or e.s
      b.asked = string.format(L["Who is %s?"], name)
      b.text:SetText(GREY .. i .. ".|r " .. (bk == targetKey and GOLD or WHITE) .. esc(name) .. "|r")
      local narrated = ns.Voice.HasAudio(bk)
      b.play.key, b.play.label = bk, b.asked
      b.play:SetShown(narrated)
      local queued = SetQueueButton(b.add, bk)
      anyQueue = anyQueue or queued
      b.mark:SetShown(bk == targetKey)
      b.text:SetPoint("BOTTOMRIGHT", (narrated and -26 or -6) - (queued and 22 or 0), 2)
      b:ClearAllPoints()
      b:SetPoint("TOPLEFT", 12, y)
      y = y - 22
      b:Show()
      nb = i
    end
    UI.queueAllButton:SetShown(anyQueue)
    y = y - 6
  end
  UI.bossHeader:SetShown(nb > 0)
  UI.bossHeader.rule:SetShown(nb > 0)
  if nb == 0 then UI.queueAllButton:Hide() end
  for i = nb + 1, #UI.bossButtons do UI.bossButtons[i]:Hide() end

  local db, n = UI.engine.db, 0
  UI.questHeader:ClearAllPoints()
  UI.questHeader:SetPoint("TOPLEFT", 16, y - 10)
  y = y - 28
  for _, q in ipairs(ctx.quests or {}) do
    local key = db.index.quest[q.id] or (q.title and db.index.questTitle and db.index.questTitle[ns.Engine.lower(q.title)])
    local b = UI.questButtons[n + 1]
    if not b or y - 22 < bottom then break end
    n = n + 1
    b.key, b.quest = key, q
    -- Quests without written lore still open: the game's own quest text plus the area's story.
    b.text:SetText((key and GOLD or GREY) .. esc(q.title) .. "|r")
    b:ClearAllPoints()
    b:SetPoint("TOPLEFT", 12, y)
    y = y - 23
    b:Show()
  end
  for i = n + 1, #UI.questButtons do UI.questButtons[i]:Hide() end
  UI.UpdateListen()

  if #UI.msgs == 0 then UI.ShowWelcome(ctx, placeName, here) end
end

-- Each people's starting zone, for the welcome card when where you are has no recorded narration.
local RACE_START = { Human = "zone:elwynn", Dwarf = "zone:dunmorogh", Gnome = "zone:dunmorogh",
  NightElf = "zone:teldrassil", Orc = "zone:durotar", Troll = "zone:durotar", Tauren = "zone:mulgore",
  Undead = "zone:tirisfal", Scourge = "zone:tirisfal", Skyborne = "zone:zephras" }

-- The first thing you see: a narrated story to press play on, and questions to ask. It leads with the two things
-- the add-on does best (voiced lore and answering questions) instead of an empty chat.
function UI.ShowWelcome(ctx, placeName, here)
  local target, yours = UI.ZoneTarget(), false
  if not (target and ns.Voice.HasAudio(target.key)) then
    local start = RACE_START[ctx.race or ""]
    if start and ns.Voice.HasAudio(start) then target, yours = UI.EntryTarget(start), true end
  end
  local name = target and UI.engine.db.entries[target.key].n
  local recorded = target and ns.Voice.HasAudio(target.key)
  local text = GOLD .. L["Welcome to Lore Forever"] .. "|r\n" .. WHITE
    .. L["The story behind the places, people and quests around you, told by narrators and ready for your questions."] .. "|r"
  if target and (recorded or ns.Voice.Available()) then
    local label = yours and string.format(L["Hear your people's story: %s"], name)
      or string.format(L["Hear the story of %s"], name)
    UI.AddMessage("hero", text, target, label)
  else
    UI.AddMessage("hero", text)
  end
  local try = placeName and string.format(L["Or ask anything about %s below. Try one of these:"], esc(placeName))
    or L["Or ask anything about where you are below. Try one of these:"]
  UI.AddMessage("note", GREY .. try .. "|r")
  local items = {}
  for _, s in ipairs(here or {}) do
    if s.idx then items[#items + 1] = { key = s.key, idx = s.idx, q = s.label } end
    if #items >= N_NEXT then break end
  end
  UI.SetNext(items, L["Try asking:"])
  if UI.inputHint then
    UI.inputHint:SetText(items[1] and string.format(L["Ask anything, e.g. %s"], esc(items[1].q))
      or L["Ask anything about the world"])
  end
end

-- The "Here" list: your target, the subzone and zone stories (or the dungeon primer), then their top questions.
-- Also returns the dungeon's bosses in encounter order (inside a dungeon), and your target's key when it's someone
-- in particular (UI.TargetKey).
-- Where you are, as entries: the zone key, its zones[] record, its story's key, and the subzone's story's key (a
-- place, not a quest). Any of them can be nil.
local function herePlace(ctx)
  local db = UI.engine.db
  local zk = UI.engine:ZoneKey(ctx.zone)
  local z = zk and db.zones and db.zones[zk]
  local zkey = zk and db.entries["zone:" .. zk] and "zone:" .. zk
  local sub = ctx.subzone and ctx.subzone ~= ctx.zone and db.index.name[ns.Engine.lower(ctx.subzone)]
  if sub and not (db.entries[sub] and db.entries[sub].t ~= "quest") then sub = nil end
  local place = (sub and db.entries[sub].n) or (zkey and db.entries[zkey].n) or ctx.subzone or ctx.zone
  if sub and zkey then place = db.entries[sub].n .. ", " .. db.entries[zkey].n end
  return zk, z, zkey, sub, place
end

function UI.HereItems(ctx)
  local db, eng, items, seen = UI.engine.db, UI.engine, {}, {}
  local zk, z, zkey, sub, place = herePlace(ctx)
  local bosses = {}
  if z and z.t == "dungeon" then
    for _, bk in ipairs(z.b or {}) do
      if db.entries[bk] then bosses[#bosses + 1] = bk end
    end
  end
  -- With a boss list below, fewer rows above it, so the bosses and your quests still fit.
  local cap = #bosses > 0 and 3 or #UI.suggestions
  local function add(it)
    local id = (it.key or "") .. ":" .. tostring(it.idx or it.primer or "")
    if not seen[id] and #items < cap then
      seen[id] = true
      items[#items + 1] = it
    end
  end
  local targetKey = ctx.targetName and UI.TargetKey(ctx.targetName)
  if targetKey then
    add({ key = targetKey, label = string.format(L["Who is %s?"], bossName(db.entries[targetKey])), gold = true,
      target = true })
  elseif ctx.targetName then
    local tkey, how = eng:KeyForName(ctx.targetName)
    if tkey then
      add({ key = tkey, label = how == "mob" and string.format(L["About the %s"], db.entries[tkey].n)
        or string.format(L["Who is %s?"], ctx.targetName) })
    end
  end
  if z and z.t == "dungeon" and zkey then
    add({ primer = zk, label = string.format(L["Dungeon primer: %s"], z.n), gold = true })
  end
  if sub then add({ key = sub, label = string.format(L["The story of %s"], db.entries[sub].n), gold = true }) end
  if zkey and not (z and z.t == "dungeon") then
    add({ key = zkey, label = string.format(L["The story of %s"], db.entries[zkey].n), gold = true })
  end
  -- The place's questions in the engine's order: the obvious ones first ("How did I end up here?"), no spoilers
  -- or gameplay filler.
  local ranked = {}
  for _, k in ipairs({ sub or false, zkey or false }) do
    if k then ranked[k] = ns.Engine.RankedFaq(db.entries[k], ctx.race) end
  end
  for round = 1, 3 do
    for _, k in ipairs({ sub or false, zkey or false }) do
      local i = k and ranked[k][round]
      if i then add({ key = k, idx = i, label = db.entries[k].faq[i].q }) end
    end
  end
  return items, place, bosses, targetKey
end

-- Dungeon bosses ---------------------------------------------------------------------------------------------------
-- Each dungeon lists its bosses in encounter order (zones[zk].b). They're the main characters of a dungeon, so
-- they're easy to reach: target one and open the panel, click one in the primer or the Here tab, or queue them all.

-- Where a key sits in a dungeon's boss list: { zk = "deadmines", i = 8 }, or nil if it isn't a boss.
function UI.BossOf(key)
  if not UI.bossIndex then
    UI.bossIndex = {}
    for zk, z in pairs(UI.engine.db.zones or {}) do
      for i, bk in ipairs(z.b or {}) do UI.bossIndex[bk] = { zk = zk, i = i } end
    end
  end
  return key and UI.bossIndex[key]
end

-- The entry for a targeted NPC when it's someone in particular: a boss, or anyone with an entry of their own.
-- Creature types ("About the gnolls") don't count; those would open on every mob you fight.
function UI.TargetKey(name)
  local key, how = UI.engine:KeyForName(name)
  local e = key and how ~= "mob" and UI.engine.db.entries[key]
  if e and (e.t == "npc" or UI.BossOf(key)) then return key end
end

-- Opening the panel (book, minimap button, key, /lore) with someone in particular targeted also opens their story,
-- once per target: reopening with the same target doesn't post it again. Returns true if it did.
function UI.OpenTarget()
  if not UI.frame then return false end
  local name = ns.Context.NPCName("target")
  local key = name and UI.TargetKey(name)
  if not key or key == UI.targetOpened or UI.engine.lastKey == key then return false end
  UI.targetOpened = key
  if not UI.frame:IsShown() then UI.frame:Show() end
  UI.ShowEntry(key, "target", string.format(L["Who is %s?"], bossName(UI.engine.db.entries[key])))
  return true
end

-- Add each boss's story to the playlist in order: recorded ones only, overviews only (never a spoiler section).
function UI.QueueBosses(bosses)
  local n = 0
  for _, bk in ipairs(bosses or {}) do
    if UI.CanQueue(bk) and not UI.PlaylistIndex(bk) and UI.PlaylistAdd(bk) then n = n + 1 end
  end
  return n
end

-- Narrations tab -----------------------------------------------------------------------------------------------------
-- Every recorded story in one place, grouped so your own starting area is at the top.

-- Each people's starting zone, first area, and capital.
local RACE_HOME = {
  Human = { "subzone:northshire-abbey", "zone:elwynn", "zone:stormwind" },
  Dwarf = { "subzone:coldridge-valley", "zone:dunmorogh", "zone:ironforge" },
  Gnome = { "subzone:coldridge-valley", "zone:dunmorogh", "zone:ironforge" },
  NightElf = { "subzone:shadowglen", "zone:teldrassil", "zone:darnassus" },
  Orc = { "subzone:valley-of-trials", "zone:durotar", "zone:orgrimmar" },
  Troll = { "subzone:valley-of-trials", "subzone:sen-jin-village", "zone:durotar", "zone:orgrimmar" },
  Tauren = { "subzone:camp-narache", "zone:mulgore", "zone:thunderbluff" },
  Undead = { "subzone:deathknell", "zone:tirisfal", "zone:undercity" },
  Scourge = { "subzone:deathknell", "zone:tirisfal", "zone:undercity" },
  Skyborne = { "zone:zephras", "topic:skyborne" },
}
local STARTING = { "zone:elwynn", "subzone:northshire-abbey", "zone:dunmorogh", "subzone:coldridge-valley",
  "zone:teldrassil", "subzone:shadowglen", "zone:durotar", "subzone:valley-of-trials", "subzone:sen-jin-village",
  "zone:mulgore", "subzone:camp-narache", "zone:tirisfal", "subzone:deathknell", "zone:zephras", "topic:skyborne" }
local ROW_H = 22

function UI.CreateNarrations(view)
  local sf = CreateFrame("ScrollFrame", "LoreForeverNarrScroll", view, "UIPanelScrollFrameTemplate")
  sf:SetPoint("TOPLEFT", 10, -92)
  sf:SetPoint("BOTTOMRIGHT", view, "BOTTOMLEFT", SIDE_W - 26, 44)
  local content = CreateFrame("Frame", nil, sf)
  content:SetSize(SIDE_W - 40, 100)
  sf:SetScrollChild(content)
  UI.narrContent, UI.narrRows, UI.narrOpen, UI.narrZone = content, {}, {}, {}
  local note = view:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  note:SetPoint("BOTTOMLEFT", 16, 16)
  note:SetWidth(SIDE_W - 20)
  note:SetJustifyH("LEFT")
  if note.SetWordWrap then note:SetWordWrap(false) end
  note:SetText(L["Click to listen. Green + adds to your playlist."])
  local empty = content:CreateFontString(nil, "OVERLAY", "GameFontDisable")
  empty:SetPoint("TOPLEFT", 4, -8)
  empty:SetWidth(SIDE_W - 50)
  empty:SetJustifyH("LEFT")
  empty:SetText(L["No recorded narrations with this voice. Pick a voice in Options (/lore options)."])
  empty:Hide()
  UI.narrEmpty = empty
end

-- The narration voice changed (Options or /lore voice): relabel Listen buttons and the lists that depend on it.
-- Chat already posted keeps its "(narrated)" tags; new answers follow the new voice.
function UI.OnVoiceChanged()
  if not UI.frame then return end
  UI.PlaylistVoiceChanged()
  UI.UpdateListen()
  UI.Refresh()
end

-- The list, by zone, so hundreds of places and people stay easy to browse. Items:
--   { section = "Capitals" }                                              a heading over zone groups
--   { zone = zk, label = "Elwynn Forest", count = 31, open = true, tag = "you are here" }   a zone to open or close
--   { key = "zone:elwynn", label = "Elwynn Forest", faqs = 2, bosses = 3, depth = 1 }       a story in it
-- Where you are and your own starting zone come first and start open; every other zone starts closed. Within a
-- zone: its own story first, then its places, then its people, by name. Clicking a zone header flips it
-- (UI.narrZone remembers that for the session).
local KIND_ORDER = { zone = 0, city = 0, dungeon = 0, subzone = 1, npc = 2 }

local function minLevel(z)
  return tonumber(tostring(z and z.lv or ""):match("^(%d+)")) or 99
end

function UI.NarrationItems(ctx)
  local db, audio, out = UI.engine.db, ns.Voice.Clips(), {}
  local zones, toggles = db.zones or {}, UI.narrZone or {}
  local faqs, bosses, isBoss = {}, {}, {}
  for k in pairs(audio) do
    local base = k:match("^(.-)#faq%d+$")
    local fi = tonumber(k:match("#faq(%d+)$"))
    local ent = base and db.entries[base]
    local f = ent and ent.faq and ent.faq[fi]
    if base and f and not f.sp then faqs[base] = (faqs[base] or 0) + 1 end
    -- Recorded bosses go under their dungeon's story (its count button), not in the zone's list.
    local at = not k:find("#") and db.entries[k] and UI.BossOf(k)
    if at then
      bosses["zone:" .. at.zk] = (bosses["zone:" .. at.zk] or 0) + 1
      isBoss[k] = true
    end
  end
  local byZone, loose = {}, {}
  for k in pairs(audio) do
    local e = not k:find("#") and not isBoss[k] and db.entries[k]
    if e and e.z and zones[e.z] then
      byZone[e.z] = byZone[e.z] or {}
      table.insert(byZone[e.z], k)
    elseif e then
      loose[#loose + 1] = k
    end
  end
  local function order(a, b)
    local ea, eb = db.entries[a], db.entries[b]
    local ra, rb = KIND_ORDER[ea.t] or 3, KIND_ORDER[eb.t] or 3
    if ra ~= rb then return ra < rb end
    return ea.n < eb.n
  end
  local function zoneName(zk) return zones[zk] and zones[zk].n or zk end
  local here = ctx.zone and UI.engine:ZoneKey(ctx.zone)
  local home
  for _, k in ipairs(RACE_HOME[ctx.race or ""] or {}) do
    local e = db.entries[k]
    if e and e.z and byZone[e.z] then home = e.z break end
  end
  local done = {}
  local function zoneGroup(zk, list, label, tag)
    if done[zk] or not list or #list == 0 then return end
    done[zk] = true
    table.sort(list, order)
    local open = toggles[zk]
    if open == nil then open = (zk == here or zk == home) end
    out[#out + 1] = { zone = zk, label = label, count = #list + (bosses["zone:" .. zk] or 0), open = open, tag = tag }
    if not open then return end
    for _, k in ipairs(list) do
      out[#out + 1] = { key = k, label = db.entries[k].n, faqs = faqs[k], bosses = bosses[k], depth = 1 }
    end
  end
  if here then zoneGroup(here, byZone[here], zoneName(here), L["you are here"]) end
  if home then zoneGroup(home, byZone[home], zoneName(home), L["your starting zone"]) end
  local function section(title, zks)
    local first = true
    for _, zk in ipairs(zks) do
      if byZone[zk] and not done[zk] then
        if first then out[#out + 1] = { section = title } first = false end
        zoneGroup(zk, byZone[zk], zoneName(zk))
      end
    end
  end
  local starting, seen = {}, {}
  for _, k in ipairs(STARTING) do
    local e = db.entries[k]
    if e and e.z and not seen[e.z] then seen[e.z] = true starting[#starting + 1] = e.z end
  end
  section(L["Starting zones"], starting)
  local caps, roads, dungeons = {}, {}, {}
  for zk in pairs(byZone) do
    local t = zones[zk].t
    local list = (t == "city" and caps) or (t == "dungeon" and dungeons) or roads
    list[#list + 1] = zk
  end
  local byLevel = function(a, b)
    local la, lb = minLevel(zones[a]), minLevel(zones[b])
    if la ~= lb then return la < lb end
    return zoneName(a) < zoneName(b)
  end
  table.sort(caps, function(a, b) return zoneName(a) < zoneName(b) end)
  table.sort(roads, byLevel)
  table.sort(dungeons, byLevel)
  section(L["Capitals"], caps)
  section(L["The road ahead"], roads)
  section(L["Dungeons"], dungeons)
  if #loose > 0 then
    out[#out + 1] = { section = L["More stories"] }
    zoneGroup("*more", loose, L["Other stories"])
  end
  return out
end

-- Play one recorded FAQ answer and show the question and answer in the chat (pressing it again stops it).
function UI.PlayFaq(key, idx)
  local target = UI.FaqTarget(key, idx)
  if not target then return end
  if UI.speaking and UI.playingId == target.id then return UI.ListenTo(target) end
  UI.ShowFaq(key, idx, "listen")
  UI.ListenTo(target)
end

-- Rows: section headings, zone headers (click to open or close), stories (click to play; the count button expands a
-- dungeon's bosses and a story's narrated questions), and the bosses and questions themselves.
local function narrationRows()
  local audio, rows = ns.Voice.Clips(), {}
  for _, it in ipairs(UI.NarrationItems(UI.ctx or ns.Context.Snapshot())) do
    rows[#rows + 1] = it
    it.more = it.key and ((it.faqs or 0) + (it.bosses or 0)) or 0
    if it.more == 0 then it.more = nil end
    if it.more and UI.narrOpen[it.key] then
      local e = UI.engine.db.entries[it.key]
      local z = it.bosses and UI.engine.db.zones[it.key:match("^zone:(.+)$") or ""]
      local depth = (it.depth or 0) + 1
      for i, bk in ipairs(z and z.b or {}) do
        if audio[bk] and UI.engine.db.entries[bk] then
          local name = bossName(UI.engine.db.entries[bk])
          rows[#rows + 1] = { key = bk, label = i .. ". " .. name, name = name, child = true, depth = depth }
        end
      end
      for i, f in ipairs(e.faq or {}) do
        if audio[it.key .. "#faq" .. i] and not f.sp then
          rows[#rows + 1] = { key = it.key, idx = i, label = f.q, child = true, depth = depth }
        end
      end
    end
  end
  return rows
end

local STORY_ICON = "Interface\\Buttons\\UI-SpellbookIcon-NextPage-Up"

function UI.RefreshNarrations()
  local items = narrationRows()
  local content, y = UI.narrContent, 0
  for i, it in ipairs(items) do
    local row = UI.narrRows[i]
    if not row then
      row = TextButton(content, SIDE_W - 40, ROW_H, "GameFontHighlightSmall")
      if row.text.SetWordWrap then row.text:SetWordWrap(false) end
      local icon = row:CreateTexture(nil, "ARTWORK")
      icon:SetSize(16, 16)
      icon:SetTexture(STORY_ICON)
      row.icon = icon
      row:SetScript("OnEnter", function(self)
        if self.zone then
          GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
          GameTooltip:AddLine(self.open and L["Hide this zone's narrations"] or L["Show this zone's narrations"])
          GameTooltip:Show()
          return
        end
        if not self.full then return end
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        GameTooltip:AddLine(self.full, 1, 1, 1, true)
        GameTooltip:AddLine(self.idx and L["Click to hear the answer"] or L["Click to hear the story"], 0.6, 0.6, 0.6)
        GameTooltip:Show()
      end)
      row:SetScript("OnLeave", function() GameTooltip:Hide() end)
      row:SetScript("OnClick", function(self)
        if self.zone then
          UI.narrZone[self.zone] = not self.open
          UI.RefreshNarrations()
        elseif self.idx then UI.PlayFaq(self.key, self.idx)
        elseif self.key then UI.PlayEntry(self.key, string.format(L["Tell me the story of %s"], self.name)) end
      end)
      -- "N" and an arrow: opens or closes the story's N narrated questions. (Not "+N": the green + adds to the playlist.)
      local more = TextButton(row, 44, ROW_H - 2, "GameFontNormalSmall", { 0.25, 0.20, 0.10, 0.7 })
      more:SetPoint("RIGHT", -2, 0)
      more.text:SetJustifyH("CENTER")
      more.text:SetPoint("BOTTOMRIGHT", -16, 2)
      local arrow = more:CreateTexture(nil, "ARTWORK")
      arrow:SetSize(20, 20)
      arrow:SetPoint("RIGHT", -3, 0)
      more.arrow = arrow
      more:SetScript("OnClick", function(self)
        UI.narrOpen[self.key] = not UI.narrOpen[self.key] or nil
        UI.RefreshNarrations()
      end)
      more:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        local open = UI.narrOpen[self.key]
        if self.bosses then
          GameTooltip:AddLine(open and L["Hide its bosses and narrated questions"] or L["Show its bosses and narrated questions"])
        else
          GameTooltip:AddLine(open and L["Hide narrated questions"] or L["Show narrated questions"])
        end
        GameTooltip:AddLine(L["Each has its own + to add it to your playlist."], 1, 1, 1, true)
        GameTooltip:Show()
      end)
      more:SetScript("OnLeave", function() GameTooltip:Hide() end)
      row.more = more
      row.add = QueueButton(row, ROW_H - 4)
      UI.narrRows[i] = row
    end
    row:ClearAllPoints()
    row:SetPoint("TOPLEFT", 0, -y)
    row.key, row.idx, row.name, row.zone, row.open = it.key, it.idx, it.name or it.label, it.zone, it.open
    row.full = it.key and (it.name or it.label) or nil
    row:EnableMouse(not it.section)
    row.more.key, row.more.bosses = it.key, it.bosses
    row.more:Hide()
    row.add:Hide()
    if it.section then
      row.icon:Hide()
      row.text:SetPoint("TOPLEFT", 4, -2)
      row.text:SetPoint("BOTTOMRIGHT", -4, 2)
      row.text:SetText(GOLD .. esc(it.section) .. "|r")
      y = y + ROW_H + (i > 1 and 4 or 0)
    elseif it.zone then
      -- A zone: + or - like the quest log's headers, its name, how many stories it holds, and why it's open.
      row.icon:ClearAllPoints()
      row.icon:SetPoint("LEFT", 2, 0)
      row.icon:SetSize(14, 14)
      row.icon:SetTexture(it.open and "Interface\\Buttons\\UI-MinusButton-Up" or "Interface\\Buttons\\UI-PlusButton-Up")
      row.icon:Show()
      row.text:SetPoint("TOPLEFT", 20, -2)
      row.text:SetPoint("BOTTOMRIGHT", -4, 2)
      row.text:SetText("|cffe6cc80" .. esc(it.label) .. "|r" .. GREY .. "  " .. it.count
        .. (it.tag and ("  " .. esc(it.tag)) or "") .. "|r")
      y = y + ROW_H
    else
      local id = it.idx and (it.key .. "#faq" .. it.idx) or it.key
      local playing = UI.speaking and UI.playingId == id
      local indent = (it.depth or 0) * 14
      row.icon:ClearAllPoints()
      row.icon:SetPoint("LEFT", 2 + indent, 0)
      row.icon:SetSize(it.child and 12 or 16, it.child and 12 or 16)
      row.icon:SetTexture(STORY_ICON)
      row.icon:Show()
      local canQueue = SetQueueButton(row.add, it.key, it.idx)
      row.text:SetPoint("TOPLEFT", 22 + indent, -2)
      row.text:SetPoint("BOTTOMRIGHT", (it.more and -50 or -4) - (canQueue and 24 or 0), 2)
      local color = playing and GREEN or (it.child and "|cffd8d8d8" or WHITE)
      row.text:SetText(color .. esc(it.label) .. "|r" .. (playing and (GREY .. "  " .. L["playing"] .. "|r") or ""))
      if it.more then
        row.more.text:SetText(tostring(it.more))
        row.more.arrow:SetTexture(UI.narrOpen[it.key] and "Interface\\Buttons\\UI-ScrollBar-ScrollUpButton-Up"
          or "Interface\\Buttons\\UI-ScrollBar-ScrollDownButton-Up")
        row.more:Show()
      end
      if canQueue then
        row.add:ClearAllPoints()
        if it.more then row.add:SetPoint("RIGHT", row.more, "LEFT", -4, 0) else row.add:SetPoint("RIGHT", -2, 0) end
      end
      y = y + ROW_H
    end
    row:Show()
  end
  for i = #items + 1, #UI.narrRows do UI.narrRows[i]:Hide() end
  if UI.narrEmpty then UI.narrEmpty:SetShown(#items == 0) end
  content:SetHeight(math.max(y, 10))
end

function UI.ShowTab(view)
  UI.tab = view
  UI.hereView:SetShown(view == "here")
  UI.narrView:SetShown(view == "narrations")
  UI.plView:SetShown(view == "playlist")
  UI.journeyView:SetShown(view == "journey")
  for _, t in ipairs(UI.tabs) do t.on:SetShown(t.view == view) end
  if view == "narrations" then UI.RefreshNarrations() end
  if view == "playlist" then UI.RefreshPlaylist() end
  if view == "journey" then ns.Journey.Refresh() end
end

-- Playlist ---------------------------------------------------------------------------------------------------------
-- A queue of recorded narrations you build with + (Narrations tab) or "Add to playlist" (chat). It plays them in
-- order with a short gap between. Stop anywhere pauses it at the current item; playing something by hand pauses it;
-- flight narration waits for it. State is in UI.pl (top of the file).

local GAP = 1.5   -- seconds between two items

-- The entry key and FAQ index behind a play target ("zone:elwynn#faq2" -> "zone:elwynn", 2), or nil for targets
-- that aren't a recorded story or answer (read-aloud answers have no key).
function UI.QueueRef(t)
  local key = t and t.key
  if not key then return nil end
  local base, fi = key:match("^(.-)#faq(%d+)$")
  if base then return base, tonumber(fi) end
  return key, nil
end

-- Whether a story or answer can go in the playlist: it's recorded, and not a spoiler you haven't chosen to see.
function UI.CanQueue(key, idx)
  if not key then return false end
  local e = UI.engine and UI.engine.db.entries[key]
  if not e or not ns.Voice.HasAudio(idx and (key .. "#faq" .. idx) or key) then return false end
  local f = idx and e.faq and e.faq[idx]
  if idx and not f then return false end
  return not (f and f.sp and not settings().showSpoilers and not UI.Unlocked(key))
end

function UI.PlaylistIndex(id)
  for i, it in ipairs(UI.pl.items) do
    if it.id == id then return i end
  end
end

-- Play items[pos], posting its story or Q&A in the chat when the panel is open (read along); closed, nothing is posted.
local function playCurrent()
  local pl = UI.pl
  local it = pl.items[pl.pos]
  if not it then return end
  pl.token = nil
  -- Recorded narrations only: never the game's text-to-speech (the voice may have changed since it was queued).
  if not ns.Voice.HasAudio(it.id) then
    pl.state = "paused"
    return UI.UpdateListen()
  end
  -- Read along in the chat, unless you're looking through past chats.
  if UI.frame and UI.frame:IsShown() and not (UI.historyFrame and UI.historyFrame:IsShown()) then
    if it.idx then UI.ShowFaq(it.key, it.idx, "playlist")
    else UI.ShowEntry(it.key, "playlist", string.format(L["Tell me the story of %s"], it.label)) end
  end
  local target = it.idx and UI.FaqTarget(it.key, it.idx) or UI.EntryTarget(it.key)
  -- State first: if the clip ends at once, its end handler must see the playlist as playing.
  pl.state = "playing"
  if not startTarget(target, true) then pl.state = "paused" end
  UI.UpdateListen()
end

-- A clip ended on its own (watchPlayback). Move the playlist on after a short gap, unless something else starts first.
function UI.OnClipEnded()
  local pl = UI.pl
  if pl.state ~= "playing" and pl.state ~= "waiting" then return end
  if pl.state == "playing" then
    if pl.pos >= #pl.items then return UI.PlaylistClear() end   -- that was the last one: the playlist is done
    pl.pos = pl.pos + 1
    UI.UpdateListen()
  end
  local token = {}
  pl.token = token
  C_Timer.After(GAP, function()
    if pl.token ~= token or UI.speaking or (pl.state ~= "playing" and pl.state ~= "waiting") then return end
    playCurrent()
  end)
end

local function flashTab(tab)
  local fl = tab and tab.flash
  if not fl then return end
  local token, step = {}, 0
  fl.token = token
  fl:SetAlpha(1)
  fl:Show()
  local function fade()
    if fl.token ~= token then return end
    step = step + 1
    if step >= 12 then return fl:Hide() end
    fl:SetAlpha(1 - step / 12)
    C_Timer.After(0.08, fade)
  end
  C_Timer.After(0.08, fade)
end

local function showToast(text)
  local t = UI.toast
  if not t then return end
  local token = {}
  t.token = token
  t.text:SetText(text)
  t:Show()
  C_Timer.After(3, function() if t.token == token then t:Hide() end end)
end

-- Add a story (idx nil) or narrated answer to the end. The first item starts right away, or when what's playing
-- now ends. Returns true if it was added. quiet: no flash or note (the caller adds several and says so once).
function UI.PlaylistAdd(key, idx, quiet)
  local pl = UI.pl
  if not UI.CanQueue(key, idx) then return false end
  local e = UI.engine.db.entries[key]
  local it = { id = idx and (key .. "#faq" .. idx) or key, key = key, idx = idx, label = idx and e.faq[idx].q or e.n }
  if UI.PlaylistIndex(it.id) then return false end
  pl.items[#pl.items + 1] = it
  if not quiet then
    flashTab(UI.playlistTab)
    showToast(GREEN .. L["Added to your playlist:"] .. "|r " .. WHITE .. esc(it.label) .. "|r"
      .. GREY .. "  (" .. string.format(L["%d of %d"], #pl.items, #pl.items) .. ")|r")
  end
  if #pl.items == 1 then
    pl.pos = 1
    if UI.speaking then pl.state = "waiting" else return playCurrent() or true end
  end
  UI.UpdateListen()
  return true
end

-- Flight narration: a zone's recorded story joins the playlist instead of cutting into what's playing, so zones
-- crossed quickly play one after another. If the playlist was stopped partway, the zone story goes in at that
-- place and plays now (you turned flight narration on), and your list carries on after it.
function UI.PlaylistAddFlight(key)
  local pl = UI.pl
  if not UI.CanQueue(key) or UI.PlaylistIndex(key) then return false end
  if #pl.items > 0 and pl.state == "paused" and not UI.IsBusy() then
    table.insert(pl.items, pl.pos, { id = key, key = key, label = UI.engine.db.entries[key].n })
    flashTab(UI.playlistTab)
    playCurrent()
    return true
  end
  return UI.PlaylistAdd(key)
end

-- Shift-click or the play key with an empty playlist (Mike, 2026-09-30): queue everything narrated where you are
-- and start it. The area's story, then its answers; the zone's story, then its answers; in a dungeon, its bosses in
-- encounter order. Returns how many were queued (0: nothing here is narrated).
function UI.QueueHere()
  local db, n = UI.engine.db, 0
  local _, z, zkey, sub, place = herePlace(ns.Context.Snapshot())
  local function add(key, idx)
    if UI.PlaylistAdd(key, idx, true) then n = n + 1 end
  end
  for _, k in ipairs({ sub or false, zkey or false }) do
    if k then
      add(k)
      for i in ipairs(db.entries[k].faq or {}) do add(k, i) end
    end
  end
  for _, bk in ipairs(z and z.t == "dungeon" and z.b or {}) do add(bk) end
  if n > 0 then
    flashTab(UI.playlistTab)
    showToast(GREEN .. L["Playing everything narrated here:"] .. "|r " .. WHITE .. esc(place or "") .. "|r"
      .. GREY .. "  (" .. string.format(n == 1 and L["%d narration"] or L["%d narrations"], n) .. ")|r")
  end
  return n
end

-- Play or pause the playlist. Pausing stops its clip; Play starts the current item again (replacing anything played
-- by hand). Returns false with nothing queued.
function UI.PlaylistToggle()
  if #UI.pl.items == 0 then return false end
  if UI.pl.state == "playing" then UI.StopAll() else playCurrent() end
  return true
end

-- The next item; after the last one the playlist ends. Returns false with nothing queued.
function UI.PlaylistNext()
  local pl = UI.pl
  if #pl.items == 0 then return false end
  if pl.pos >= #pl.items then
    UI.PlaylistClear()
  else
    pl.pos = pl.pos + 1
    playCurrent()
  end
  return true
end

-- The previous item (the first one starts again).
function UI.PlaylistPrev()
  local pl = UI.pl
  if #pl.items == 0 then return false end
  pl.pos = math.max(1, pl.pos - 1)
  playCurrent()
  return true
end

function UI.PlaylistJump(i)
  local pl = UI.pl
  if not pl.items[i] then return end
  pl.pos = i
  playCurrent()
end

-- Empty the playlist. Stops the playlist's own clip, not something you played by hand.
function UI.PlaylistClear()
  local pl = UI.pl
  if pl.state == "playing" and UI.speaking then
    ns.Voice.Stop()
    UI.speaking, UI.playingId = false, nil
  end
  pl.items, pl.pos, pl.state, pl.token = {}, 0, "paused", nil
  UI.UpdateListen()
end

-- Take item i out. Removing the one that's playing moves on to the next.
function UI.PlaylistRemove(i)
  local pl = UI.pl
  if not pl.items[i] then return end
  local wasPlaying = i == pl.pos and pl.state == "playing"
  if #pl.items == 1 then return UI.PlaylistClear() end
  if i == pl.pos and i == #pl.items then return UI.PlaylistClear() end   -- nothing after it: the playlist is done
  table.remove(pl.items, i)
  if i < pl.pos then
    pl.pos = pl.pos - 1
  elseif i == pl.pos and wasPlaying then
    return playCurrent()
  end
  UI.UpdateListen()
end

-- The voice changed (Options or /lore voice): drop what the new voice has no recording of, so the playlist never
-- falls back to the game's text-to-speech.
function UI.PlaylistVoiceChanged()
  local pl = UI.pl
  local kept, pos, dropped, curDropped = {}, nil, 0, false
  for i, it in ipairs(pl.items) do
    if ns.Voice.HasAudio(it.id) then
      kept[#kept + 1] = it
      if i >= pl.pos and not pos then pos = #kept end
    else
      dropped = dropped + 1
      curDropped = curDropped or i == pl.pos
    end
  end
  if dropped == 0 then return end
  if curDropped and pl.state == "playing" then UI.StopAll() end
  if #kept == 0 or not pos then
    UI.PlaylistClear()
  else
    pl.items, pl.pos = kept, pos
  end
  showToast(GREY .. string.format(L["%d left your playlist: this voice has no recording of them."], dropped) .. "|r")
end

-- Move item i up (-1) or down (+1) among the ones still to come.
function UI.PlaylistMove(i, delta)
  local pl = UI.pl
  local j = i + delta
  if i <= pl.pos or j <= pl.pos or not pl.items[i] or not pl.items[j] then return end
  pl.items[i], pl.items[j] = pl.items[j], pl.items[i]
  UI.UpdateListen()
end

-- The Playlist tab: what's playing, what's next (reorder, remove, Clear), what already played.
local PL_ROW = 24

function UI.CreatePlaylist(view)
  local head = Header(view, L["Now playing"])
  head:SetPoint("TOPLEFT", 16, -96)
  local count = view:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  count:SetPoint("LEFT", head, "RIGHT", 6, 0)
  local now = TextButton(view, SIDE_W - 20, 26, "GameFontHighlight", { 0.15, 0.35, 0.17, 0.45 })
  now:SetPoint("TOPLEFT", 10, -116)
  now.text:SetPoint("TOPLEFT", 26, -2)
  if now.text.SetWordWrap then now.text:SetWordWrap(false) end
  local icon = now:CreateTexture(nil, "ARTWORK")
  icon:SetSize(18, 18)
  icon:SetPoint("LEFT", 4, 0)
  icon:SetTexture("Interface\\Buttons\\UI-SpellbookIcon-NextPage-Up")
  now:SetScript("OnClick", function() UI.PlaylistToggle() end)
  now:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(self.full or "", 1, 1, 1, true)
    GameTooltip:AddLine(UI.pl.state == "playing" and L["Click to pause"] or L["Click to play it from the start"],
      0.6, 0.6, 0.6)
    GameTooltip:Show()
  end)
  now:SetScript("OnLeave", function() GameTooltip:Hide() end)

  local upHead = Header(view, L["Up next"])
  upHead:SetPoint("TOPLEFT", 16, -154)
  local clear = CreateFrame("Button", nil, view, "UIPanelButtonTemplate")
  clear:SetSize(66, 18)
  clear:SetPoint("TOPRIGHT", view, "TOPLEFT", SIDE_W - 10, -150)
  clear:SetText(L["Clear all"])
  clear:SetScript("OnClick", function() UI.PlaylistClear() end)
  clear:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Empty the playlist"])
    GameTooltip:Show()
  end)
  clear:SetScript("OnLeave", function() GameTooltip:Hide() end)

  local sf = CreateFrame("ScrollFrame", "LoreForeverPlaylistScroll", view, "UIPanelScrollFrameTemplate")
  sf:SetPoint("TOPLEFT", 10, -174)
  sf:SetPoint("BOTTOMRIGHT", view, "BOTTOMLEFT", SIDE_W - 26, 44)
  local content = CreateFrame("Frame", nil, sf)
  content:SetSize(SIDE_W - 40, 100)
  sf:SetScrollChild(content)

  -- Empty state: what the tab is for and how to fill it.
  local empty = CreateFrame("Frame", nil, view)
  empty:SetPoint("TOPLEFT", 16, -100)
  empty:SetPoint("BOTTOMRIGHT", view, "BOTTOMLEFT", SIDE_W - 8, 60)
  local e1 = empty:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  e1:SetPoint("TOP", 0, -20)
  e1:SetText(L["Your playlist is empty."])
  local e2 = empty:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  e2:SetPoint("TOP", e1, "BOTTOM", 0, -10)
  e2:SetWidth(SIDE_W - 40)
  e2:SetJustifyH("CENTER")
  e2:SetText(L["Press + on any narration to add it here. They play in order, one after another."])
  local go = CreateFrame("Button", nil, empty, "UIPanelButtonTemplate")
  go:SetSize(150, 22)
  go:SetPoint("TOP", e2, "BOTTOM", 0, -14)
  go:SetText(L["Go to Narrations"])
  go:SetScript("OnClick", function() UI.ShowTab("narrations") end)

  local note = view:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  note:SetPoint("BOTTOMLEFT", 16, 16)
  note:SetWidth(SIDE_W - 20)
  note:SetJustifyH("LEFT")
  if note.SetWordWrap then note:SetWordWrap(false) end
  note:SetText(L["Add more with + on the Narrations tab."])

  UI.plUI = { head = head, count = count, now = now, upHead = upHead, clear = clear, scroll = sf,
    content = content, empty = empty, note = note, rows = {} }
end

local function playlistRow(i)
  local P = UI.plUI
  local row = P.rows[i]
  if row then return row end
  row = TextButton(P.content, SIDE_W - 40, PL_ROW, "GameFontHighlightSmall")
  if row.text.SetWordWrap then row.text:SetWordWrap(false) end
  row.num = row:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  row.num:SetPoint("LEFT", 2, 0)
  row.num:SetWidth(16)
  row.num:SetJustifyH("RIGHT")
  row:SetScript("OnClick", function(self) if self.index then UI.PlaylistJump(self.index) end end)
  row:SetScript("OnEnter", function(self)
    if not self.index then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(self.full, 1, 1, 1, true)
    GameTooltip:AddLine(L["Click to play this now"], 0.6, 0.6, 0.6)
    GameTooltip:Show()
  end)
  row:SetScript("OnLeave", function() GameTooltip:Hide() end)
  local function small(texture, onClick, tip)
    local b = CreateFrame("Button", nil, row)
    b:SetSize(20, 20)
    b:SetNormalTexture(texture)
    b:SetHighlightTexture("Interface\\Buttons\\UI-Common-MouseHilight", "ADD")
    b:SetScript("OnClick", function(self) onClick(self.index) end)
    b:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:AddLine(tip)
      GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function() GameTooltip:Hide() end)
    return b
  end
  row.remove = small("Interface\\Buttons\\UI-GroupLoot-Pass-Up", function(at) UI.PlaylistRemove(at) end,
    L["Remove from playlist"])
  row.remove:SetPoint("RIGHT", -2, 0)
  row.down = small("Interface\\Buttons\\UI-ScrollBar-ScrollDownButton-Up", function(at) UI.PlaylistMove(at, 1) end,
    L["Move down"])
  row.down:SetPoint("RIGHT", row.remove, "LEFT", -2, 0)
  row.up = small("Interface\\Buttons\\UI-ScrollBar-ScrollUpButton-Up", function(at) UI.PlaylistMove(at, -1) end,
    L["Move up"])
  row.up:SetPoint("RIGHT", row.down, "LEFT", -2, 0)
  P.rows[i] = row
  return row
end

function UI.RefreshPlaylist()
  local P, pl = UI.plUI, UI.pl
  if not P then return end
  local n, cur = #pl.items, pl.items[pl.pos]
  local list = n > 0
  for _, w in ipairs({ P.head, P.head.rule, P.count, P.now, P.upHead, P.upHead.rule, P.clear, P.scroll }) do
    w:SetShown(list)
  end
  P.note:SetShown(list)
  P.empty:SetShown(not list)
  if not list then
    for _, r in ipairs(P.rows) do r:Hide() end
    return
  end
  local ours = pl.state == "playing" or pl.state == "waiting"
  P.head:SetText(pl.state == "playing" and L["Now playing"] or (pl.state == "waiting" and L["Plays next"] or L["Paused"]))
  P.count:SetText(string.format(L["%d of %d"], pl.pos, n))
  P.now.full = cur.label
  P.now.text:SetText((ours and GREEN or WHITE) .. esc(cur.label) .. "|r")

  -- Up next (numbered, with reorder and remove), then the earlier ones, played or skipped (greyed; click to hear one).
  local specs = {}
  for i = pl.pos + 1, n do specs[#specs + 1] = { index = i } end
  if pl.pos > 1 then
    specs[#specs + 1] = { header = L["Earlier"] }
    for i = 1, pl.pos - 1 do specs[#specs + 1] = { index = i, done = true } end
  end
  if pl.pos == n then table.insert(specs, 1, { note = L["Nothing after this one."] }) end
  local y = 0
  for r, s in ipairs(specs) do
    local row = playlistRow(r)
    row:ClearAllPoints()
    row:SetPoint("TOPLEFT", 0, -y)
    row.index = s.index
    local item = s.index and pl.items[s.index]
    row.full = item and item.label
    row:EnableMouse(item ~= nil)
    local upcoming = item and not s.done
    -- Arrows only where they can move something (the first can't go above what's playing, the last can't go lower).
    row.up:SetShown(upcoming and s.index > pl.pos + 1 or false)
    row.down:SetShown(upcoming and s.index < n or false)
    row.remove:SetShown(upcoming or false)
    row.up.index, row.down.index, row.remove.index = s.index, s.index, s.index
    row.num:SetText(item and tostring(s.index) or "")
    row.text:SetPoint("TOPLEFT", item and 22 or 4, -2)
    row.text:SetPoint("BOTTOMRIGHT", upcoming and -70 or -4, 2)
    if s.header then
      row.text:SetText(GOLD .. esc(s.header) .. "|r")
    elseif s.note then
      row.text:SetText(GREY .. esc(s.note) .. "|r")
    else
      row.text:SetText((s.done and GREY or WHITE) .. esc(item.label) .. "|r")
    end
    row:Show()
    y = y + PL_ROW + (s.header and 4 or 0)
  end
  for r = #specs + 1, #P.rows do P.rows[r]:Hide() end
  P.content:SetHeight(math.max(y, 10))
end

-- History ----------------------------------------------------------------------------------------------------------
-- Conversations are saved when you start a new chat (or open an old one), newest first, in LoreForeverDB.history.

local MAX_HISTORY, HISTORY_ROWS = 12, 12

local function historyStore()
  if not LoreForeverDB then return {} end
  LoreForeverDB.history = LoreForeverDB.history or {}
  return LoreForeverDB.history
end

local function plain(s)
  return (tostring(s or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("||", "|"))
end

-- Save the current conversation if you actually asked something in it.
function UI.Archive()
  local title
  for _, m in ipairs(UI.msgs) do
    if m.role == "user" then title = plain(m.text); break end
  end
  if not title then return end
  local msgs = {}
  for _, m in ipairs(UI.msgs) do
    if m.role == "user" or m.role == "lore" then
      local t = m.target
      msgs[#msgs + 1] = { role = m.role, text = m.text,
        target = t and { id = t.id, key = t.key, text = t.text, label = t.label } or nil, rows = m.rows }
    end
  end
  local ctx = UI.ctx or {}
  local store = historyStore()
  -- A reopened chat is updated in place (and moves to the top) instead of being saved twice.
  for i = #store, 1, -1 do
    if UI.historyId and store[i].id == UI.historyId then table.remove(store, i) end
  end
  UI.historyId = UI.historyId or (time() .. "-" .. math.random(1000, 9999))
  table.insert(store, 1, { id = UI.historyId, t = time(), zone = ctx.subzone or ctx.zone, title = title:sub(1, 60),
    msgs = msgs })
  while #store > MAX_HISTORY do table.remove(store) end
end

function UI.CreateHistory(f)
  local h = CreateFrame("Frame", nil, f)
  h:SetPoint("TOPLEFT", CHAT_X - 4, -60)
  h:SetPoint("BOTTOMRIGHT", -12, 48)
  h:SetFrameLevel((f:GetFrameLevel() or 1) + 20)
  h:EnableMouse(true)
  local bg = h:CreateTexture(nil, "BACKGROUND")
  bg:SetAllPoints()
  bg:SetColorTexture(0.03, 0.03, 0.05, 0.97)
  local title = Header(h, L["Past chats"])
  title:SetPoint("TOPLEFT", 10, -8)
  local close = CreateFrame("Button", nil, h, "UIPanelButtonTemplate")
  close:SetSize(70, 20)
  close:SetPoint("TOPRIGHT", -8, -6)
  close:SetText(L["Back"])
  close:SetScript("OnClick", function() h:Hide() end)
  h.empty = h:CreateFontString(nil, "OVERLAY", "GameFontDisable")
  h.empty:SetPoint("TOPLEFT", 10, -36)
  h.empty:SetText(L["No past chats yet. A chat is saved here when you start a new one."])
  h.rows = {}
  for i = 1, HISTORY_ROWS do
    local b = TextButton(h, CHAT_W, 24, "GameFontHighlightSmall", { 0.2, 0.16, 0.08, 0.5 })
    b:SetPoint("TOPLEFT", 8, -32 - (i - 1) * 26)
    b:SetScript("OnClick", function(self) UI.RestoreHistory(self.index) end)
    h.rows[i] = b
  end
  h:Hide()
  UI.historyFrame = h
end

local function ago(t)
  local d = time() - (t or 0)
  if d < 3600 then return string.format(L["%dm ago"], math.max(1, math.floor(d / 60))) end
  if d < 86400 then return string.format(L["%dh ago"], math.floor(d / 3600)) end
  return string.format(L["%dd ago"], math.floor(d / 86400))
end

function UI.ToggleHistory()
  local h = UI.historyFrame
  if h:IsShown() then return h:Hide() end
  local store = historyStore()
  for i, b in ipairs(h.rows) do
    local c = store[i]
    if c then
      b.index = i
      b.text:SetText(WHITE .. esc(c.title) .. "|r  " .. GREY .. esc(c.zone or "") .. " - " .. ago(c.t) .. "|r")
      b:Show()
    else
      b:Hide()
    end
  end
  h.empty:SetShown(#store == 0)
  h:Show()
end

-- Reopen a past chat. The one you were in is saved first, so nothing is lost.
function UI.RestoreHistory(i)
  local store = historyStore()
  local c = store[i]
  if not c then return end
  UI.Archive()   -- save (or update) the chat you're leaving
  UI.historyId = c.id
  if UI.pl.state ~= "playing" then UI.StopAll() end   -- a playing playlist carries on
  UI.msgs, UI.blocks = {}, {}
  for _, m in ipairs(c.msgs) do
    UI.msgs[#UI.msgs + 1] = { role = m.role, text = m.text, target = m.target, rows = m.rows }
    UI.blocks[#UI.blocks + 1] = m.text
  end
  UI.historyFrame:Hide()
  UI.SetNext({})
  UI.Render()
end

-- New chat: save this one to history, then clear the conversation, follow-up state, and anything playing.
function UI.Clear()
  finishTyping()
  UI.Archive()
  UI.historyId = nil
  if UI.historyFrame then UI.historyFrame:Hide() end
  if UI.pl.state ~= "playing" then UI.StopAll() end   -- a playing playlist carries on
  UI.msgs, UI.blocks = {}, {}
  for _, b in ipairs(UI.bubbles) do b.frame:Hide() end
  UI.content:SetHeight(100)
  UI.engine.lastKey = nil
  UI.engine.asked = {}
  UI.SetNext({})
  UI.Refresh()
end

-- Answers ----------------------------------------------------------------------------------------------------------

-- Whether entry `key` is a quest this character has finished, so its own spoiler answers and sections show without
-- asking. Spoilers that span several quests wait on progress tags (LOR-29).
function UI.Unlocked(key)
  return UI.engine:Finished(key, ns.Context.Done())
end

-- Your journey: a grey line on an entry or answer about something you've done, from what Journey.lua recorded
-- (see Context.Journey). None when there's no record, or "Remember my journey" is off.
local function ago(t)
  local s = time() - t
  if s < 120 then return L["just now"] end
  if s < 3600 then return string.format(L["%d minutes ago"], math.floor(s / 60)) end
  if s < 7200 then return L["an hour ago"] end
  if s < 86400 then return string.format(L["%d hours ago"], math.floor(s / 3600)) end
  if s < 172800 then return L["yesterday"] end
  return string.format(L["%d days ago"], math.floor(s / 86400))
end

local function stamp(v) return type(v) == "number" and v or nil end

-- "You finished this at level 12, 3 days ago, in a group.": the quest's turn-in, if it's still in the event log.
local function questLine(key, events)
  local index = UI.engine.db.index.quest or {}
  for i = #events, 1, -1 do
    local e = events[i]
    if type(e) == "table" and e.k == "qt" and e.id and index[e.id] == key and stamp(e.t) then
      local lv = tonumber(e.lv)
      if not lv then return string.format(L["You finished this %s."], ago(e.t)) end
      return string.format(type(e.pt) == "table" and L["You finished this at level %d, %s, in a group."]
        or L["You finished this solo at level %d, %s."], lv, ago(e.t))
    end
  end
  return L["You've finished this quest."]
end

-- The people met, by entry key: {name, t} for the first name the game showed for each. Rebuilt only when someone
-- new is met, since looking up every name again on each answer adds up over a long journey.
local metCache = {}
local function metByKey(seen)
  local n = 0
  for _ in pairs(seen) do n = n + 1 end
  if metCache.seen ~= seen or metCache.n ~= n then
    local map = {}
    for name, v in pairs(seen) do
      if type(name) == "string" and stamp(v) then
        local k, how = UI.engine:KeyForName(name)
        if k and how == "exact" and not (map[k] and map[k].t <= v) then map[k] = { name = name, t = v } end
      end
    end
    metCache.seen, metCache.n, metCache.map = seen, n, map
  end
  return metCache.map
end

-- "You first met Gryan Stoutmantle at Sentinel Hill, 3 days ago.", under the name the game showed.
local function personLine(key, seen, events)
  local name = bossName(UI.engine.db.entries[key])
  local t = stamp(seen[name])
  if not t then
    local m = metByKey(seen)[key]
    if not m then return nil end
    name, t = m.name, m.t
  end
  for i = #events, 1, -1 do
    local e = events[i]
    if type(e) == "table" and e.k == "npc" and e.n == name then
      local where = (e.s ~= "" and e.s) or e.z
      if type(where) == "string" and where ~= "" then
        return string.format(L["You first met %s at %s, %s."], name, where, ago(t))
      end
      break
    end
  end
  return string.format(L["You first met %s %s."], name, ago(t))
end

-- "You first came here at level 10, 3 days ago.": when the place (the zone, or this subzone of it) was first seen,
-- with the level from that visit's new-place event while the log still has it. The oldest events get trimmed, so a
-- later new-place event in the zone isn't taken for the first visit.
local function placeLine(key, e, c, events)
  local eng, idx = UI.engine, UI.engine.db.index
  local zk = e.t == "subzone" and e.z or key:match("^zone:(.+)$")
  if not zk then return nil end
  local bare = e.t == "subzone" and ns.Engine.lower(bossName(e)):gsub("^the ", "")
  local function here(z, s)
    if type(z) ~= "string" or eng:ZoneKey(z) ~= zk then return false end
    if not bare then return true end
    if type(s) ~= "string" or s == "" then return false end
    -- The subzone the way ContextKeys finds it ("The Crossroads"; Northshire Abbey is in Northshire Valley), or by
    -- name for one that shares its name with another zone's.
    local l = ns.Engine.lower(s)
    local nl = l:gsub("^the ", "")
    return idx.name[l] == key or idx.name[nl] == key or (idx.area and idx.area[l] == key) or nl == bare
  end
  local first
  for place, v in pairs(type(c.seen) == "table" and type(c.seen.place) == "table" and c.seen.place or {}) do
    local z, s = tostring(place):match("^(.-)|(.*)$")
    if stamp(v) and (not first or v < first) and here(z, s) then first = v end
  end
  for _, ev in ipairs(events) do
    if type(ev) == "table" and ev.k == "zone" and stamp(ev.t) and here(ev.z, ev.s) then
      -- Journey.lua stamps the place and its event in the same second.
      if first and math.abs(ev.t - first) > 2 then break end
      first = ev.t
      local lv = tonumber(ev.lv)
      if lv then return string.format(L["You first came here at level %d, %s."], lv, ago(first)) end
      break
    end
  end
  return first and string.format(L["You first came here %s."], ago(first)) or nil
end

local PLACE_TYPES = { zone = true, city = true, dungeon = true, subzone = true }

-- The "you" line for entry `key` (plain text), or nil.
function UI.YouLine(key)
  local e = key and UI.engine.db.entries[key]
  local c = e and ns.Context.Journey()
  if not c then return nil end
  local events = type(c.events) == "table" and c.events or {}
  if e.t == "quest" then
    return UI.Unlocked(key) and questLine(key, events) or nil
  end
  -- "You first met / first came here" is only true when the record covers the character's whole life. A character
  -- that played before the update has a record that starts mid-life: say nothing rather than claim a first.
  local J = ns.Journey
  if not (J and J.Whole and J.Whole(c)) then return nil end
  if e.t == "npc" then
    local seen = type(c.seen) == "table" and c.seen.npc
    return type(seen) == "table" and personLine(key, seen, events) or nil
  elseif PLACE_TYPES[e.t] then
    return placeLine(key, e, c, events)
  end
end

-- The "you" line ready to go under a heading: grey, escaped, with its line break; "" when there's none.
local function youText(key)
  local ok, line = pcall(UI.YouLine, key)
  return (ok and line) and (GREY .. esc(line) .. "|r\n") or ""
end

-- heading and text are plain and get escaped; tag is already-formatted (e.g. the grey "(narrated)") and must not be.
-- `key`: the entry it's about, for the "you" line under the heading.
local function narratedTag() return "  " .. GREY .. L["(narrated)"] .. "|r" end
local function loreText(heading, text, angle, tag, key)
  local out = heading and (GOLD .. esc(heading) .. "|r" .. (tag or "") .. "\n" .. youText(key)) or ""
  out = out .. WHITE .. esc(text) .. "|r"
  if angle then
    local who = angle.target:match(":(.+)$") or angle.target
    out = out .. "\n" .. BLUE .. string.format(L["For you as a %s: %s"], esc(who), esc(angle.text)) .. "|r"
  end
  return out
end

local function followUps(key, idx, sameEntryName)
  local items = UI.engine:FollowUps(key, idx, N_NEXT, ns.Context.Done())
  for _, it in ipairs(items) do
    if it.key == key and not sameEntryName then it.name = nil end
  end
  return items
end

-- Spoilers: an answer or section marked as giving away a story isn't shown until you ask for it. Returns true if it
-- gated (and posted a warning with a Reveal chip). Options > "Show spoilers without asking" turns this off, and a
-- quest's own spoilers open once you've finished it (UI.Unlocked).
function UI.SpoilerGate(key, kind, idx)
  if settings().showSpoilers or UI.Unlocked(key) then return false end
  local e = UI.engine.db.entries[key]
  local item = e and ((kind == "faq" and e.faq and e.faq[idx]) or (kind == "section" and e.sec and e.sec[idx]))
  local level = item and ((kind == "faq" and item.sp) or (kind == "section" and item.sp ~= 0 and item.sp))
  if not level then return false end
  UI.AddMessage("note", GREY
    .. string.format(L["Spoiler ahead: this answer reveals part of %s's story that you may not have reached yet."], esc(e.n)) .. "|r")
  local items = { { key = key, idx = idx, via = "reveal", section = kind == "section" or nil,
    label = L["Reveal it anyway (spoiler)"] } }
  for _, s in ipairs(followUps(key, nil)) do
    if #items >= N_NEXT then break end
    items[#items + 1] = s
  end
  UI.SetNext(items, L["Your call:"])
  return true
end

function UI.ShowSection(key, idx)
  local e = UI.engine.db.entries[key]
  local sec = e and e.sec and e.sec[idx]
  if not sec then return end
  UI.AddMessage("lore", loreText(e.n .. ": " .. sec.t, sec.b))
  UI.SetNext(followUps(key, nil))
end

function UI.Ask(question, via)
  local ctx = UI.ctx or ns.Context.Snapshot()
  ctx.done = ns.Context.Done()   -- a quest turned in since the last snapshot counts right away
  UI.turn = (UI.turn or 0) + 1
  local results = UI.engine:Ask(question, ctx, 4)
  local top = results[1]
  local log = ns.Log.Question(question, ctx, results, via, UI.turn)
  UI.lastLog = log
  local live = ns.Companion.Installed()   -- live answers are offered only once the companion app is installed
  UI.AddMessage("user", WHITE .. esc(question) .. "|r")
  if top and top.score >= MIN_SCORE and UI.SpoilerGate(top.key, top.kind, top.idx) then
    -- gated: SpoilerGate posted the warning and a Reveal chip (the revealed answer is logged and rated on its own)
    log.shown = "p"
  elseif top and top.score >= MIN_SCORE then
    local heading = top.kind == "faq" and (top.title .. "  -  " .. top.name) or top.name
    local note = isGameplay(question) and (GREY
      .. string.format(L["I only know the story side, not mechanics or drops. Here's the lore of %s:"], esc(top.name)) .. "|r\n")
      or ""
    local target = top.kind == "faq" and UI.FaqTarget(top.key, top.idx)
      or { id = "ans" .. time() .. "-" .. UI.turn, text = top.text, label = top.name }   -- the answer, not the heading
    local tag = (target and ns.Voice.HasAudio(target.key)) and narratedTag() or nil
    UI.AddMessage("lore", note .. loreText(heading, top.text, top.angle, tag, top.key), target, nil, nil, log)
    local items = followUps(top.key, top.kind == "faq" and top.idx or nil)
    -- A confident match can still be the wrong one (Stormwind's canals answered with the Undercity's): with the
    -- companion app installed, the last suggestion is always a way to ask live answers instead.
    if live then
      items[math.min(#items + 1, N_NEXT)] = { live = question, label = L["Not what you asked? Ask live answers"] }
    end
    UI.SetNext(items)
  elseif top and top.score >= GUESS_SCORE then
    -- Not sure enough to answer: offer the closest pre-written questions instead of a wrong answer.
    UI.engine.lastKey = nil
    log.shown = "g"
    UI.AddMessage("note", GREY .. L["I'm not sure I have that. Did you mean one of these?"] .. "|r", nil, nil, nil, log)
    -- Off script: live answers can answer it (one Ctrl+C), so that's offered first.
    local items = live and { { live = question, label = L["Ask live answers instead"] } } or {}
    for _, r in ipairs(results) do
      local e = UI.engine.db.entries[r.key]
      local fi = r.kind == "faq" and r.idx or 1
      if e.faq and e.faq[fi] then items[#items + 1] = { key = r.key, idx = fi, q = e.faq[fi].q, name = e.n } end
      if #items >= N_NEXT then break end
    end
    UI.SetNext(items, L["Did you mean:"])
  else
    UI.engine.lastKey = nil
    log.shown = "n"
    UI.AddMessage("note", GREY
      .. L["I don't have lore on that yet. Try a place, person or quest nearby, or pick something on the left."] .. "|r",
      nil, nil, nil, log)
    local items = live and { { live = question, label = L["Ask live answers"] } } or {}
    for _, s in ipairs(UI.engine:Suggest(ctx, N_NEXT - #items)) do items[#items + 1] = s end
    UI.SetNext(items, L["Try:"])
  end
end

function UI.ShowFaq(key, idx, via)
  local e = UI.engine.db.entries[key]
  if not (e and e.faq and e.faq[idx]) then return UI.ShowEntry(key, via) end
  local f = e.faq[idx]
  UI.engine.lastKey = key
  if via ~= "reveal" then UI.AddMessage("user", WHITE .. esc(f.q) .. "|r") end
  if via ~= "reveal" and UI.SpoilerGate(key, "faq", idx) then return end
  local target = UI.FaqTarget(key, idx)
  UI.lastLog = ns.Log.Question(f.q, UI.ctx or ns.Context.Snapshot(), { { key = key, kind = "faq", idx = idx, title = f.q } }, via)
  UI.AddMessage("lore", loreText(e.n, f.a, nil, ns.Voice.HasAudio(target.key) and narratedTag() or nil, key), target, nil,
    nil, UI.lastLog)
  UI.SetNext(followUps(key, idx))
end

-- Entry overview: summary plus spoiler-free sections; its questions become the suggestions. `asked` is the
-- sidebar label that led here, shown as your side of the conversation.
function UI.ShowEntry(key, via, asked)
  local e = UI.engine.db.entries[key]
  if not e then return end
  UI.engine.lastKey = key
  local parts = { WHITE .. esc(e.s) .. "|r" }
  local open = UI.Unlocked(key)
  for _, sec in ipairs(e.sec or {}) do
    if (sec.sp or 0) == 0 or open then
      parts[#parts + 1] = GOLD .. esc(sec.t) .. "|r\n" .. WHITE .. esc(sec.b) .. "|r"
    else
      parts[#parts + 1] = GREY .. esc(sec.t) .. "  " .. L["(spoiler - use Reveal below)"] .. "|r"
    end
  end
  if asked then UI.AddMessage("user", WHITE .. esc(asked) .. "|r") end
  local narrated = ns.Voice.HasAudio(key) and narratedTag() or ""
  local text = GOLD .. esc(e.n) .. "|r" .. narrated .. "\n" .. youText(key) .. table.concat(parts, "\n\n")
  UI.lastLog = ns.Log.Question("[open] " .. e.n, UI.ctx or ns.Context.Snapshot(), { { key = key, kind = "summary", title = e.n } }, via)
  UI.AddMessage("lore", text, UI.EntryTarget(key), nil, nil, UI.lastLog)
  UI.SetNext(followUps(key, nil))
end

-- Dungeon primer: what the place is, why you're here (your quests for it), and who you'll meet, in order.
function UI.ShowPrimer(zk, via)
  local db = UI.engine.db
  local z, e = db.zones and db.zones[zk], db.entries["zone:" .. zk]
  if not (z and e) then return end
  if UI.frame and not UI.frame:IsShown() then UI.frame:Show() end
  UI.engine.lastKey = "zone:" .. zk
  local parts = { WHITE .. esc(e.s) .. "|r" }
  local ctx = UI.ctx or ns.Context.Snapshot()
  local mine = {}
  for _, q in ipairs(ctx.quests or {}) do
    local qk = db.index.quest[q.id]
    local qe = qk and db.entries[qk]
    if qe and qe.z == zk then mine[#mine + 1] = "- " .. esc(qe.n) .. ": " .. esc(qe.h or qe.s) end
  end
  if #mine > 0 then
    parts[#parts + 1] = GOLD .. L["Why you're here"] .. "|r\n" .. WHITE .. table.concat(mine, "\n") .. "|r"
  end
  -- Who you'll face, in order: each row opens that boss's story (with play and + when it's narrated).
  local who = {}
  for _, bk in ipairs(z.b or {}) do
    local be = db.entries[bk]
    if be then who[#who + 1] = { key = bk, name = bossName(be), hook = be.h or be.s } end
  end
  if #who > 0 then parts[#parts + 1] = GOLD .. L["Who you'll face"] .. "|r" end
  UI.AddMessage("user", WHITE .. string.format(L["Dungeon primer: %s"], esc(z.n)) .. "|r")
  local narrated = ns.Voice.HasAudio("zone:" .. zk) and narratedTag() or ""
  UI.lastLog = ns.Log.Question("[primer] " .. z.n, ctx, { { key = "zone:" .. zk, kind = "summary", title = z.n } }, via)
  UI.AddMessage("lore", GOLD .. esc(z.n) .. (z.lv and (" (" .. z.lv .. ")") or "") .. "|r" .. narrated .. "\n"
    .. youText("zone:" .. zk) .. table.concat(parts, "\n\n"), UI.EntryTarget("zone:" .. zk), nil, #who > 0 and who or nil, UI.lastLog)
  local items = {}
  -- What beating the final boss means for the story, kept behind a click since it's a spoiler.
  local last = z.b and db.entries[z.b[#z.b]]
  local lastName = last and ns.Engine.lower(last.n):gsub("%s*%b()", "")
  for i, fq in ipairs(e.faq or {}) do
    local q = ns.Engine.lower(fq.q)
    if (lastName and q:find(lastName, 1, true)) or q:find("final boss") or q:find("defeat") then
      items[1] = { key = "zone:" .. zk, idx = i, label = string.format(L["Spoiler: %s"], fq.q), via = "reveal" }
      break
    end
  end
  for _, bk in ipairs(z.b or {}) do
    local be = db.entries[bk]
    local bi = be and ns.Engine.RankedFaq(be, UI.engine.race)[1]
    if bi then items[#items + 1] = { key = bk, idx = bi, q = be.faq[bi].q, name = be.n } end
    if #items >= N_NEXT then break end
  end
  UI.SetNext(#items > 0 and items or followUps("zone:" .. zk, nil))
end

-- The quest log's own text for a quest (and remember it for the harvest, so it can become lore later).
local function questLogText(q)
  local QL = _G.C_QuestLog
  local desc, obj
  if QL and QL.GetLogIndexForQuestID and _G.GetQuestLogQuestText then
    local ok, idx = pcall(QL.GetLogIndexForQuestID, q.id)
    if ok and idx then
      local okSel, prev = pcall(QL.GetSelectedQuest or function() end)
      if QL.SetSelectedQuest then pcall(QL.SetSelectedQuest, q.id) end
      UI.restoreQuest = okSel and prev or nil
      local ok2, d, o = pcall(GetQuestLogQuestText, idx)
      if ok2 then desc, obj = d, o end
      if UI.restoreQuest and QL.SetSelectedQuest then pcall(QL.SetSelectedQuest, UI.restoreQuest) end
    end
  end
  local saved = LoreForeverDB and LoreForeverDB.quests and LoreForeverDB.quests[q.id]
  desc = (desc and desc ~= "" and desc) or (saved and saved.text)
  obj = (obj and obj ~= "" and obj) or (saved and saved.objectives) or table.concat(q.objectives or {}, "\n")
  if desc and ns.Log.QuestFromLog then ns.Log.QuestFromLog(q, desc, obj) end
  return desc, obj
end

-- A quest with no written lore: what the quest itself says, and the story of where it happens.
function UI.ShowQuestText(q)
  local desc, obj = questLogText(q)
  local ctx = UI.ctx or ns.Context.Snapshot()
  local zk = UI.engine:ZoneKey(ctx.zone)
  local ze = zk and UI.engine.db.entries["zone:" .. zk]
  local parts = {}
  if desc and desc ~= "" then parts[#parts + 1] = WHITE .. esc(desc) .. "|r" end
  if obj and obj ~= "" then parts[#parts + 1] = GOLD .. L["Objectives"] .. "|r\n" .. WHITE .. esc(obj) .. "|r" end
  if ze then
    parts[#parts + 1] = GOLD .. string.format(L["Where this happens: %s"], esc(ze.n)) .. "|r\n" .. WHITE
      .. esc(ze.h or ze.s) .. "|r"
  end
  if #parts == 0 then
    parts[1] = GREY .. L["Open this quest in your quest log once so its text can be read."] .. "|r"
  end
  UI.AddMessage("user", WHITE .. esc(q.title) .. "|r")
  UI.AddMessage("lore", GOLD .. esc(q.title) .. "|r  " .. GREY .. L["(no written lore yet - the quest's own words)"]
    .. "|r\n" .. table.concat(parts, "\n\n"))
  local items = {}
  if ze then
    local ranked = ns.Engine.RankedFaq(ze, UI.engine.race)
    for n = 1, math.min(3, #ranked) do
      items[#items + 1] = { key = "zone:" .. zk, idx = ranked[n], q = ze.faq[ranked[n]].q }
    end
  end
  UI.SetNext(items)
end

-- Reporting an answer (LOR-120) ------------------------------------------------------------------------------------
-- The cross under an answer opens this box: why it was wrong (optional), a note (optional), and "Copy report", which
-- shows the feedback page's address with a report code in it (Log.ReportLink) to copy into a browser or Discord.
-- Everything is saved with the logged question as you go; closing the box keeps it.
local REPORT_H, REPORT_COPY_H = 300, 392

local function createReport()
  local f = CreateFrame("Frame", "LoreForeverReport", UIParent, "BasicFrameTemplateWithInset")
  f:SetSize(400, REPORT_H)
  f:SetPoint("CENTER")
  f:SetFrameStrata("DIALOG")
  f:SetMovable(true)
  f:EnableMouse(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", f.StartMoving)
  f:SetScript("OnDragStop", f.StopMovingOrSizing)
  table.insert(UISpecialFrames, "LoreForeverReport")
  local title = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  title:SetPoint("TOPLEFT", 16, -32)
  title:SetText(L["What was wrong with this answer?"])
  local asked = f:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  asked:SetPoint("TOPLEFT", 16, -52)
  asked:SetWidth(368)
  asked:SetJustifyH("LEFT")
  if asked.SetWordWrap then asked:SetWordWrap(false) end
  f.asked = asked

  local reasons = {
    { "wrong", L["It's wrong"] },
    { "unanswered", L["It didn't answer my question"] },
    { "spoiler", L["It spoiled something I haven't reached"] },
    { "future", L["It talks about later expansions"] },
    { "other", L["Something else"] },
  }

  local function save()
    if f.log then ns.Log.Feedback(f.log, false, f.reason, f.note:GetText()) end
  end
  f.checks = {}
  for i, r in ipairs(reasons) do
    local cb = CreateFrame("CheckButton", nil, f, "UICheckButtonTemplate")
    cb:SetSize(24, 24)
    cb:SetPoint("TOPLEFT", 12, -66 - (i - 1) * 26)
    local text = cb:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    text:SetPoint("LEFT", cb, "RIGHT", 4, 0)
    text:SetText(r[2])
    cb.reason = r[1]
    -- One reason at a time: ticking one clears the others; ticking it again clears it.
    cb:SetScript("OnClick", function(self)
      f.reason = self:GetChecked() and self.reason or nil
      for _, other in ipairs(f.checks) do other:SetChecked(other.reason == f.reason) end
      save()
    end)
    f.checks[i] = cb
  end

  local noteLabel = f:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  noteLabel:SetPoint("TOPLEFT", 16, -204)
  noteLabel:SetText(L["Anything to add? (optional)"])
  local note = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
  note:SetSize(360, 22)
  note:SetPoint("TOPLEFT", 22, -220)
  note:SetAutoFocus(false)
  note:SetMaxLetters(200)
  note:SetScript("OnTextChanged", function(_, userInput) if userInput then save() end end)
  note:SetScript("OnEnterPressed", function(self) self:ClearFocus() end)
  note:SetScript("OnEscapePressed", function() f:Hide() end)
  f.note = note

  local copy = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  copy:SetSize(130, 24)
  copy:SetPoint("TOPLEFT", 16, -254)
  copy:SetText(L["Copy report"])
  local done = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  done:SetSize(90, 24)
  done:SetPoint("LEFT", copy, "RIGHT", 8, 0)
  done:SetText(L["Done"])
  done:SetScript("OnClick", function() save(); f:Hide() end)
  f.copy, f.done = copy, done

  -- The address to copy. It can't be edited: typing puts it back, so a stray key never breaks the code.
  local hint = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  hint:SetPoint("TOPLEFT", 16, -288)
  hint:SetWidth(368)
  hint:SetJustifyH("LEFT")
  hint:SetText(L["Press Ctrl+C to copy this link, then paste it into your browser to send it, or post it on our Discord. It has your question, where you were and the answer you got, but not your character's name."])
  local link = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
  link:SetSize(360, 22)
  link:SetPoint("TOPLEFT", 22, -344)
  link:SetAutoFocus(false)
  if link.SetFontObject and _G.ChatFontNormal then link:SetFontObject(ChatFontNormal) end
  local function fill()
    link:SetText(f.link or "")
    link:SetCursorPosition(0)
    link:HighlightText()
  end
  link:SetScript("OnTextChanged", function(_, userInput) if userInput then fill() end end)
  link:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
  link:SetScript("OnEscapePressed", function() f:Hide() end)
  link:SetScript("OnShow", fill)
  f.hint, f.linkBox, f.fillLink = hint, link, fill

  copy:SetScript("OnClick", function()
    save()
    f.link = ns.Log.ReportLink(f.log)
    f:SetHeight(REPORT_COPY_H)
    hint:Show()
    link:Show()
    fill()   -- again once shown: the Forever client drops text set on a box that isn't visible yet (see Options)
    link:SetFocus()
  end)
  return f
end

function UI.ShowReport(log)
  if not log then return end
  local f = LoreForeverReport or createReport()
  UI.report = f
  f.log, f.link = log, nil
  f.reason = log.reason
  f.asked:SetText(esc(log.q or ""))
  for _, cb in ipairs(f.checks) do cb:SetChecked(cb.reason == f.reason) end
  f:SetHeight(REPORT_H)
  f.hint:Hide()
  f.linkBox:Hide()
  f:Show()
  f.note:SetText(log.note or "")
end
