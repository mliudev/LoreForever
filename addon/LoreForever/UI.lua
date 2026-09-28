-- The Lore Forever panel, laid out like a chat app: a sidebar with the place you're in and your quests, and a
-- conversation of question and answer bubbles with suggested replies and a message box with type-ahead.

local _, ns = ...
local UI = {}
ns.UI = UI

local GOLD, GREY, BLUE, WHITE, GREEN = "|cffffd100", "|cff9d9d9d", "|cff88ccff", "|cffffffff", "|cff7fdf7f"
-- Score thresholds. Real lore questions score 15+ with the tuned engine (tests/retrieval_check.py); these only catch
-- matches on a stray common word. Gameplay questions can't be told apart by score (they name real NPCs and quests),
-- so they're caught by wording instead (GAMEPLAY below).
local MIN_SCORE = 2.0          -- at or above: confident enough to answer
local GUESS_SCORE = 0.8        -- between this and MIN_SCORE: offer "did you mean" instead of guessing
local MAX_MESSAGES = 30        -- bubbles kept in the conversation
local W, H, SIDE_W = 820, 560, 250
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
    if f.SetResizeBounds then f:SetResizeBounds(720, 560, 1500, 1100)
    elseif f.SetMinResize then f:SetMinResize(720, 560) end
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
  newChat:SetText("New chat")
  newChat:SetScript("OnClick", function() UI.Clear() end)
  UI.newButton = newChat

  local history = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  history:SetSize(70, 22)
  history:SetPoint("RIGHT", newChat, "LEFT", -6, 0)
  history:SetText("History")
  history:SetScript("OnClick", function() UI.ToggleHistory() end)
  UI.historyButton = history

  -- Narrate where you are, whatever the conversation is showing.
  local zoneListen = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  zoneListen:SetSize(170, 22)
  zoneListen:SetPoint("RIGHT", history, "LEFT", -6, 0)
  zoneListen:SetText("Listen to this area")
  zoneListen:SetScript("OnClick", function()
    local zt = UI.ZoneTarget()
    if zt then UI.PlayEntry(zt.key, "Tell me the story of " .. UI.engine.db.entries[zt.key].n) end
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

  -- Sidebar tabs: "Here" (this place and your quests) and "Narrations" (every recorded story, grouped).
  UI.tabs = {}
  for i, spec in ipairs({ { "here", "Here", 112 }, { "narrations", "Narrations", 118 } }) do
    local tab = TextButton(f, spec[3], 22, "GameFontNormal", { 0.2, 0.16, 0.08, 0.6 })
    tab:SetPoint("TOPLEFT", i == 1 and 12 or 128, -64)
    tab.text:SetJustifyH("CENTER")
    tab.text:SetText(spec[2])
    local on = tab:CreateTexture(nil, "ARTWORK")
    on:SetPoint("BOTTOMLEFT")
    on:SetPoint("BOTTOMRIGHT")
    on:SetHeight(2)
    on:SetColorTexture(1, 0.82, 0, 0.9)
    tab.on = on
    tab.view = spec[1]
    tab:SetScript("OnClick", function(self) UI.ShowTab(self.view) end)
    UI.tabs[#UI.tabs + 1] = tab
  end
  local hereView = CreateFrame("Frame", nil, f)
  hereView:SetAllPoints(f)
  UI.hereView = hereView
  local narrView = CreateFrame("Frame", nil, f)
  narrView:SetAllPoints(f)
  narrView:Hide()
  UI.narrView = narrView
  UI.CreateNarrations(narrView)

  UI.hereHeader = Header(hereView, "Here")
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
    -- Rows with a recorded narration get a play button, so you can tell what has a voice without opening it.
    local play = CreateFrame("Button", nil, b)
    play:SetSize(22, 22)
    play:SetPoint("RIGHT", -2, 0)
    play:SetNormalTexture("Interface\\Buttons\\UI-SpellbookIcon-NextPage-Up")
    play:SetPushedTexture("Interface\\Buttons\\UI-SpellbookIcon-NextPage-Down")
    play:SetHighlightTexture("Interface\\Buttons\\UI-Common-MouseHilight", "ADD")
    play.row = b
    play:SetScript("OnClick", function(self) UI.PlayEntry(self.key, self.row.label) end)
    play:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:AddLine((UI.speaking and UI.playingId == self.key) and "Stop narration" or "Play narration")
      GameTooltip:Show()
    end)
    play:SetScript("OnLeave", function() GameTooltip:Hide() end)
    play:Hide()
    b.play = play
    b:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      if self.primer then GameTooltip:AddLine("Dungeon primer: why you're here and who you'll face")
      elseif self.idx then GameTooltip:AddLine("Ask this question")
      else GameTooltip:AddLine("Open the full story") end
      if self.play and self.play:IsShown() then GameTooltip:AddLine("Narrated: press the arrow to listen", 1, 1, 1) end
      GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function() GameTooltip:Hide() end)
    UI.suggestions[i] = b
  end

  local questHeader = Header(hereView, "Your quests")
  questHeader:SetPoint("TOPLEFT", 16, -112 - 5 * 31 - 10)
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
      GameTooltip:AddLine(self.key and "The story behind this quest" or "No written lore yet")
      if not self.key then GameTooltip:AddLine("Shows the quest's own text and the story of the area.", 1, 1, 1, true) end
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
  hint:SetText(GOLD .. "Gold|r story  " .. WHITE .. "White|r question  " .. GREY .. "Grey|r quest text\n"
    .. "Lore adapted from warcraft.wiki.gg (CC BY-SA)|r")

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
  np.text = np:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  np.text:SetPoint("LEFT", 10, 0)
  np.text:SetPoint("RIGHT", -90, 0)
  np.text:SetJustifyH("LEFT")
  if np.text.SetWordWrap then np.text:SetWordWrap(false) end
  local npStop = CreateFrame("Button", nil, np, "UIPanelButtonTemplate")
  npStop:SetSize(76, 22)
  npStop:SetPoint("RIGHT", -4, 0)
  npStop:SetText("Stop")
  npStop:SetScript("OnClick", function() UI.StopAll() end)
  np.stop = npStop
  np:Hide()
  UI.nowPlaying = np
  UI.CreateHistory(f)

  -- Suggested replies under the conversation
  UI.nextLabel = f:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  UI.nextLabel:SetPoint("BOTTOMLEFT", CHAT_X + 2, 110)
  UI.nextLabel:SetText("Suggested:")
  UI.nextButtons = {}
  for i = 1, N_NEXT do
    local b = TextButton(f, CHAT_W, 20, "GameFontHighlightSmall", { 0.25, 0.20, 0.10, 0.55 })
    b:SetPoint("BOTTOMLEFT", CHAT_X, 108 - i * 22)
    b:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -36, 108 - i * 22)
    b:SetScript("OnClick", function(self)
      if self.section then UI.ShowSection(self.key, self.idx)
      elseif self.key and self.idx then UI.ShowFaq(self.key, self.idx, self.via or "next")
      elseif self.key then UI.ShowEntry(self.key, self.via or "next") end
    end)
    UI.nextButtons[i] = b
  end

  -- Optional feedback (on for playtests: /lore feedback)
  UI.feedbackLabel = f:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  UI.feedbackLabel:SetPoint("BOTTOMRIGHT", -150, 112)
  UI.feedbackLabel:SetText("Helpful?")
  local yes = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  yes:SetSize(48, 18)
  yes:SetPoint("LEFT", UI.feedbackLabel, "RIGHT", 6, 0)
  yes:SetText("Yes")
  local no = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  no:SetSize(48, 18)
  no:SetPoint("LEFT", yes, "RIGHT", 4, 0)
  no:SetText("No")
  local function feedback(helpful)
    if UI.lastLog then
      ns.Log.Feedback(UI.lastLog, helpful)
      UI.feedbackLabel:SetText(helpful and (GREEN .. "Thanks!|r") or (GREY .. "Noted.|r"))
    end
  end
  yes:SetScript("OnClick", function() feedback(true) end)
  no:SetScript("OnClick", function() feedback(false) end)
  UI.feedbackButtons = { yes, no }

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
  hintText:SetText("Ask anything about the world")
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
  send:SetText("Send")
  send:SetScript("OnClick", function() eb:GetScript("OnEnterPressed")(eb) end)
  UI.CreateCompletion(f, eb)

  f:SetScript("OnShow", function() UI.Refresh() end)
  UI.ShowTab("here")
  UI.SetFeedbackVisible(false)
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
  for _, sec in ipairs(e.sec or {}) do
    if (sec.sp or 0) == 0 then parts[#parts + 1] = sec.t .. ". " .. sec.b end
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
  local sub = ctx.subzone and db.index.name[ctx.subzone:lower()]
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
    else
      C_Timer.After(1, check)
    end
  end
  C_Timer.After(1, check)
end

-- Play a target. Pressing the one that's playing stops it; pressing anything else switches to it.
function UI.ListenTo(target)
  if not target then return end
  local same = UI.speaking and UI.playingId == target.id
  ns.Voice.Stop()
  UI.speaking, UI.playingId = false, nil
  if not same and ns.Voice.Narrate(target.key, target.text) then
    UI.speaking, UI.playingId, UI.playingLabel = true, target.id, target.label
    if UI.historyFrame then UI.historyFrame:Hide() end
    watchPlayback(#ns.Voice.Plain(target.text) / 15 + 3)
  end
  UI.UpdateListen()
end

-- Stop any narration or read-aloud, whatever started it.
function UI.StopAll()
  ns.Voice.Stop()
  UI.speaking, UI.playingId = false, nil
  UI.UpdateListen()
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
function UI.UpdateNowPlaying()
  local bar, playing = UI.nowPlaying, UI.speaking
  if bar then
    bar:SetShown(playing)
    if playing then bar.text:SetText(GREEN .. "Now playing:|r " .. WHITE .. esc(UI.playingLabel or "narration") .. "|r") end
    UI.scroll:ClearAllPoints()
    UI.scroll:SetPoint("TOPLEFT", CHAT_X, playing and -92 or -64)
    UI.scroll:SetPoint("BOTTOMRIGHT", -34, 128)
  end
  local l = _G.LoreForeverLauncher
  if l and l.stop then l.stop:SetShown(playing and l:IsShown()) end
end

function UI.UpdateListen()
  UI.UpdateNowPlaying()
  local canTTS = ns.Voice.Available()
  if UI.tab == "narrations" and UI.narrRows then UI.RefreshNarrations() end
  for _, b in ipairs(UI.bubbles or {}) do
    -- Recorded narrations say "Listen"; everything else says "Read aloud" (the game's own voice), so the two are
    -- never confused. Heroes (the welcome card) use their big action button instead.
    local t = b.listen.target
    if b.frame:IsShown() and t and not b.isHero then
      local recorded = ns.Voice.HasAudio(t.key)
      local playing = UI.speaking and UI.playingId == t.id
      b.listen:SetText(playing and "Stop" or (recorded and "Listen" or "Read aloud"))
      b.listen.recorded = recorded
      b.listen:SetShown(recorded or canTTS)
    end
    if b.isHero and b.action.target then
      local playing = UI.speaking and UI.playingId == b.action.target.id
      b.action:SetText(playing and "Stop" or b.action.label)
    end
  end
  local z = UI.zoneListenButton
  if z then
    local zt = UI.ZoneTarget()
    z:SetShown(zt ~= nil and (canTTS or ns.Voice.HasAudio(zt.key)))
    if zt then
      local name = UI.engine.db.entries[zt.key].n
      z:SetText((UI.speaking and UI.playingId == zt.id) and "Stop"
        or ((ns.Voice.HasAudio(zt.key) and "Listen: " or "Read aloud: ") .. name))
      local tw = z.GetTextWidth and tonumber(z:GetTextWidth())
      z:SetWidth(math.max(90, math.min(230, (tw or 150) + 24)))
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
    listen:SetText("Listen")
    listen:SetScript("OnClick", function(self) UI.ListenTo(self.target) end)
    listen:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_TOP")
      if self.recorded then
        GameTooltip:AddLine("Narrated")
        GameTooltip:AddLine("A recorded narration of this answer.", 1, 1, 1, true)
      else
        GameTooltip:AddLine("Read aloud")
        GameTooltip:AddLine("Uses your game's text-to-speech voice. Change it in Options > Accessibility > "
          .. "Text to Speech.", 1, 1, 1, true)
      end
      GameTooltip:Show()
    end)
    listen:SetScript("OnLeave", function() GameTooltip:Hide() end)
    -- The welcome card's big "hear the story" button.
    local action = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
    action:SetSize(300, 26)
    action:SetPoint("BOTTOMLEFT", PAD, 8)
    action:SetScript("OnClick", function(self)
      if self.target then UI.PlayEntry(self.target.key, self.label) end
    end)
    action:Hide()
    b = { frame = f, bg = bg, fs = fs, listen = listen, action = action }
    UI.bubbles[i] = b
  end
  return b
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
    m.y = y
    b.listen.target = m.target
    b.isHero = m.role == "hero"
    b.action.target, b.action.label = nil, nil
    b.action:Hide()
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
function UI.AddMessage(role, text, target, actionLabel)
  msgSeq = msgSeq + 1
  if UI.historyFrame then UI.historyFrame:Hide() end
  if role == "lore" and not target then
    -- Read the body, not the heading line (the title or question is already on screen).
    local heading = text:match("^([^\n]*)\n")
    target = { id = "msg" .. time() .. "-" .. msgSeq, text = text:match("^[^\n]*\n(.+)$") or text,
      label = heading and ns.Voice.Plain(heading):gsub("%s*%(narrated%)", "") or nil }
  end
  finishTyping()
  local animate = role == "lore" and settings().typing ~= false
  table.insert(UI.msgs, { role = role, text = text, target = target, actionLabel = actionLabel, animate = animate })
  table.insert(UI.blocks, text)
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

-- items: { {key, idx?, label?, q?, name?, via?} }
function UI.SetNext(items, label)
  UI.nextLabel:SetText(label or "Suggested:")
  UI.nextLabel:SetShown(#items > 0)
  for i, b in ipairs(UI.nextButtons) do
    local it = items[i]
    if it then
      b.key, b.idx, b.via, b.section = it.key, it.idx, it.via, it.section
      local who = it.name and (GREY .. "  (" .. esc(it.name) .. ")|r") or ""
      b.text:SetText(WHITE .. esc(it.label or it.q) .. "|r" .. who)
      b:Show()
    else
      b:Hide()
    end
  end
end

-- Panel state ----------------------------------------------------------------------------------------------------

function UI.SetFeedbackVisible(show)
  show = show and settings().feedback
  UI.feedbackLabel:SetShown(show)
  for _, b in ipairs(UI.feedbackButtons) do b:SetShown(show) end
  if show then UI.feedbackLabel:SetText("Helpful?") end
end

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

  local here, placeName = UI.HereItems(ctx)
  UI.hereHeader:SetText("Here: " .. esc(placeName or "?"))
  for i, b in ipairs(UI.suggestions) do
    local s = here[i]
    if s then
      b.key, b.idx, b.primer, b.label = s.key, s.idx, s.primer, s.label
      b.text:SetText((s.gold and GOLD or WHITE) .. esc(s.label) .. "|r")
      local narrated = not s.idx and ns.Voice.HasAudio(s.key or (s.primer and "zone:" .. s.primer))
      b.play.key = s.key or (s.primer and "zone:" .. s.primer)
      b.play:SetShown(narrated)
      b.text:SetPoint("BOTTOMRIGHT", narrated and -26 or -6, 2)
      b:Show()
    else
      b:Hide()
    end
  end

  local db, n = UI.engine.db, 0
  for _, q in ipairs(ctx.quests or {}) do
    local key = db.index.quest[q.id] or (q.title and db.index.questTitle and db.index.questTitle[q.title:lower()])
    n = n + 1
    local b = UI.questButtons[n]
    if not b then break end
    b.key, b.quest = key, q
    -- Quests without written lore still open: the game's own quest text plus the area's story.
    b.text:SetText((key and GOLD or GREY) .. esc(q.title) .. "|r")
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
  local text = GOLD .. "Welcome to Lore Forever|r\n" .. WHITE .. "The story behind the places, people and quests "
    .. "around you, told by narrators and ready for your questions.|r"
  if target and (recorded or ns.Voice.Available()) then
    local label = yours and ("Hear your people's story: " .. name) or ("Hear the story of " .. name)
    UI.AddMessage("hero", text, target, label)
  else
    UI.AddMessage("hero", text)
  end
  UI.AddMessage("note", GREY .. "Or ask anything about " .. esc(placeName or "where you are") .. " below. Try one of these:|r")
  local items = {}
  for _, s in ipairs(here or {}) do
    if s.idx then items[#items + 1] = { key = s.key, idx = s.idx, q = s.label } end
    if #items >= N_NEXT then break end
  end
  UI.SetNext(items, "Try asking:")
  if UI.inputHint then
    UI.inputHint:SetText(items[1] and ("Ask anything, e.g. " .. esc(items[1].q)) or "Ask anything about the world")
  end
end

-- The "Here" list: your target, the subzone and zone stories (or the dungeon primer), then their top questions.
function UI.HereItems(ctx)
  local db, eng, items, seen = UI.engine.db, UI.engine, {}, {}
  local function add(it)
    local id = (it.key or "") .. ":" .. tostring(it.idx or it.primer or "")
    if not seen[id] and #items < #UI.suggestions then
      seen[id] = true
      items[#items + 1] = it
    end
  end
  if ctx.targetName then
    local tkey, how = eng:KeyForName(ctx.targetName)
    if tkey then
      add({ key = tkey, label = how == "mob" and ("About the " .. db.entries[tkey].n) or ("Who is " .. ctx.targetName .. "?") })
    end
  end
  local zk = eng:ZoneKey(ctx.zone)
  local z = zk and db.zones and db.zones[zk]
  local zkey = zk and db.entries["zone:" .. zk] and "zone:" .. zk
  local sub = ctx.subzone and ctx.subzone ~= ctx.zone and db.index.name[ctx.subzone:lower()]
  if sub and not (db.entries[sub] and db.entries[sub].t ~= "quest") then sub = nil end
  if z and z.t == "dungeon" and zkey then
    add({ primer = zk, label = "Dungeon primer: " .. z.n, gold = true })
  end
  if sub then add({ key = sub, label = "The story of " .. db.entries[sub].n, gold = true }) end
  if zkey and not (z and z.t == "dungeon") then
    add({ key = zkey, label = "The story of " .. db.entries[zkey].n, gold = true })
  end
  for round = 1, 3 do
    for _, k in ipairs({ sub or false, zkey or false }) do
      local f = k and db.entries[k].faq and db.entries[k].faq[round]
      if f and f.sp then f = nil end
      if f then add({ key = k, idx = round, label = f.q }) end
    end
  end
  local place = (sub and db.entries[sub].n) or (zkey and db.entries[zkey].n) or ctx.subzone or ctx.zone
  if sub and zkey then place = db.entries[sub].n .. ", " .. db.entries[zkey].n end
  return items, place
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
  UI.narrContent, UI.narrRows, UI.narrOpen = content, {}, {}
  local note = view:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  note:SetPoint("BOTTOMLEFT", 16, 16)
  note:SetWidth(SIDE_W - 20)
  note:SetJustifyH("LEFT")
  if note.SetWordWrap then note:SetWordWrap(false) end
  note:SetText("Click to listen. +N: narrated questions.")
end

-- Group headers and rows: { header = "..."} or { key = "...", label = "..." }
function UI.NarrationItems(ctx)
  local db, audio, used, out = UI.engine.db, ns.DB.audio or {}, {}, {}
  local faqs = {}
  for k in pairs(audio) do
    local base = k:match("^(.-)#faq%d+$")
    local fi = tonumber(k:match("#faq(%d+)$"))
    local ent = base and db.entries[base]
    local f = ent and ent.faq and ent.faq[fi]
    if base and f and not f.sp then faqs[base] = (faqs[base] or 0) + 1 end
  end
  local function group(title, keys)
    local rows = {}
    for _, k in ipairs(keys) do
      if audio[k] and db.entries[k] and not used[k] then
        used[k] = true
        rows[#rows + 1] = { key = k, label = db.entries[k].n, faqs = faqs[k] }
      end
    end
    if #rows > 0 then
      out[#out + 1] = { header = title }
      for _, r in ipairs(rows) do out[#out + 1] = r end
    end
  end
  local who = (ctx.raceName or ctx.race or "") .. (ctx.className and (" " .. ctx.className) or "")
  group("For you" .. (who ~= "" and (" (" .. who .. ")") or ""), RACE_HOME[ctx.race or ""] or {})
  group("Starting zones", STARTING)
  local caps, zones, dungeons, other = {}, {}, {}, {}
  for k in pairs(audio) do
    if not k:find("#") and db.entries[k] then
      local t = db.entries[k].t
      local list = (t == "city" and caps) or (t == "dungeon" and dungeons) or (t == "zone" and zones) or other
      list[#list + 1] = k
    end
  end
  local byName = function(a, b) return db.entries[a].n < db.entries[b].n end
  for _, l in ipairs({ caps, zones, dungeons, other }) do table.sort(l, byName) end
  group("Capitals", caps)
  group("The road ahead", zones)
  group("Dungeons", dungeons)
  group("More stories", other)
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

-- Rows: group headers, stories (click to play; "+N" expands their narrated questions), and the questions themselves.
local function narrationRows()
  local audio, rows = ns.DB.audio or {}, {}
  for _, it in ipairs(UI.NarrationItems(UI.ctx or ns.Context.Snapshot())) do
    rows[#rows + 1] = it
    if it.key and it.faqs and UI.narrOpen[it.key] then
      local e = UI.engine.db.entries[it.key]
      for i, f in ipairs(e.faq or {}) do
        if audio[it.key .. "#faq" .. i] and not f.sp then
          rows[#rows + 1] = { key = it.key, idx = i, label = f.q, child = true }
        end
      end
    end
  end
  return rows
end

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
      icon:SetTexture("Interface\\Buttons\\UI-SpellbookIcon-NextPage-Up")
      row.icon = icon
      row:SetScript("OnEnter", function(self)
        if not self.full then return end
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        GameTooltip:AddLine(self.full, 1, 1, 1, true)
        GameTooltip:AddLine(self.idx and "Click to hear the answer" or "Click to hear the story", 0.6, 0.6, 0.6)
        GameTooltip:Show()
      end)
      row:SetScript("OnLeave", function() GameTooltip:Hide() end)
      row:SetScript("OnClick", function(self)
        if self.idx then UI.PlayFaq(self.key, self.idx)
        elseif self.key then UI.PlayEntry(self.key, "Tell me the story of " .. self.name) end
      end)
      -- "+N" / "hide": opens or closes the story's narrated questions.
      local more = TextButton(row, 44, ROW_H - 2, "GameFontNormalSmall", { 0.25, 0.20, 0.10, 0.7 })
      more:SetPoint("RIGHT", -2, 0)
      more.text:SetJustifyH("CENTER")
      more:SetScript("OnClick", function(self)
        UI.narrOpen[self.key] = not UI.narrOpen[self.key] or nil
        UI.RefreshNarrations()
      end)
      more:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        GameTooltip:AddLine(UI.narrOpen[self.key] and "Hide narrated questions" or "Show narrated questions")
        GameTooltip:Show()
      end)
      more:SetScript("OnLeave", function() GameTooltip:Hide() end)
      row.more = more
      UI.narrRows[i] = row
    end
    row:ClearAllPoints()
    row:SetPoint("TOPLEFT", 0, -y)
    row.key, row.idx, row.name = it.key, it.idx, it.label
    row.full = not it.header and it.label or nil
    row:EnableMouse(not it.header)
    row.more.key = it.key
    row.more:Hide()
    if it.header then
      row.key = nil
      row.icon:Hide()
      row.text:SetPoint("TOPLEFT", 4, -2)
      row.text:SetPoint("BOTTOMRIGHT", -4, 2)
      row.text:SetText(GOLD .. esc(it.header) .. "|r")
      y = y + ROW_H + (i > 1 and 4 or 0)
    else
      local id = it.idx and (it.key .. "#faq" .. it.idx) or it.key
      local playing = UI.speaking and UI.playingId == id
      local indent = it.child and 18 or 0
      row.icon:ClearAllPoints()
      row.icon:SetPoint("LEFT", 2 + indent, 0)
      row.icon:SetSize(it.child and 12 or 16, it.child and 12 or 16)
      row.icon:Show()
      row.text:SetPoint("TOPLEFT", 22 + indent, -2)
      row.text:SetPoint("BOTTOMRIGHT", it.faqs and -50 or -4, 2)
      local color = playing and GREEN or (it.child and "|cffd8d8d8" or WHITE)
      row.text:SetText(color .. esc(it.label) .. "|r" .. (playing and (GREY .. "  playing|r") or ""))
      if it.faqs then
        row.more.text:SetText(UI.narrOpen[it.key] and "hide" or ("+" .. it.faqs))
        row.more:Show()
      end
      y = y + ROW_H
    end
    row:Show()
  end
  for i = #items + 1, #UI.narrRows do UI.narrRows[i]:Hide() end
  content:SetHeight(math.max(y, 10))
end

function UI.ShowTab(view)
  UI.tab = view
  UI.hereView:SetShown(view == "here")
  UI.narrView:SetShown(view == "narrations")
  for _, t in ipairs(UI.tabs) do t.on:SetShown(t.view == view) end
  if view == "narrations" then UI.RefreshNarrations() end
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
        target = t and { id = t.id, key = t.key, text = t.text, label = t.label } or nil }
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
  local title = Header(h, "Past chats")
  title:SetPoint("TOPLEFT", 10, -8)
  local close = CreateFrame("Button", nil, h, "UIPanelButtonTemplate")
  close:SetSize(70, 20)
  close:SetPoint("TOPRIGHT", -8, -6)
  close:SetText("Back")
  close:SetScript("OnClick", function() h:Hide() end)
  h.empty = h:CreateFontString(nil, "OVERLAY", "GameFontDisable")
  h.empty:SetPoint("TOPLEFT", 10, -36)
  h.empty:SetText("No past chats yet. A chat is saved here when you start a new one.")
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
  if d < 3600 then return math.max(1, math.floor(d / 60)) .. "m ago" end
  if d < 86400 then return math.floor(d / 3600) .. "h ago" end
  return math.floor(d / 86400) .. "d ago"
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
  ns.Voice.Stop()
  UI.speaking, UI.playingId = false, nil
  UI.msgs, UI.blocks = {}, {}
  for _, m in ipairs(c.msgs) do
    UI.msgs[#UI.msgs + 1] = { role = m.role, text = m.text, target = m.target }
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
  ns.Voice.Stop()
  UI.speaking, UI.playingId = false, nil
  UI.msgs, UI.blocks = {}, {}
  for _, b in ipairs(UI.bubbles) do b.frame:Hide() end
  UI.content:SetHeight(100)
  UI.engine.lastKey = nil
  UI.engine.asked = {}
  UI.SetNext({})
  UI.SetFeedbackVisible(false)
  UI.Refresh()
end

-- Answers ----------------------------------------------------------------------------------------------------------

-- heading and text are plain and get escaped; tag is already-formatted (e.g. the grey "(narrated)") and must not be.
local NARRATED_TAG = "  " .. GREY .. "(narrated)|r"
local function loreText(heading, text, angle, tag)
  local out = heading and (GOLD .. esc(heading) .. "|r" .. (tag or "") .. "\n") or ""
  out = out .. WHITE .. esc(text) .. "|r"
  if angle then
    local who = angle.target:match(":(.+)$") or angle.target
    out = out .. "\n" .. BLUE .. "For you as a " .. esc(who) .. ": " .. esc(angle.text) .. "|r"
  end
  return out
end

local function followUps(key, idx, sameEntryName)
  local items = UI.engine:FollowUps(key, idx, N_NEXT)
  for _, it in ipairs(items) do
    if it.key == key and not sameEntryName then it.name = nil end
  end
  return items
end

-- Spoilers: an answer or section marked as giving away a story isn't shown until you ask for it. Returns true if it
-- gated (and posted a warning with a Reveal chip). Options > "Show spoilers without asking" turns this off.
function UI.SpoilerGate(key, kind, idx)
  if settings().showSpoilers then return false end
  local e = UI.engine.db.entries[key]
  local item = e and ((kind == "faq" and e.faq and e.faq[idx]) or (kind == "section" and e.sec and e.sec[idx]))
  local level = item and ((kind == "faq" and item.sp) or (kind == "section" and item.sp ~= 0 and item.sp))
  if not level then return false end
  UI.AddMessage("note", GREY .. "Spoiler ahead: this answer reveals part of " .. esc(e.n) .. "'s story that you "
    .. "may not have reached yet.|r")
  local items = { { key = key, idx = idx, via = "reveal", section = kind == "section" or nil,
    label = "Reveal it anyway (spoiler)" } }
  for _, s in ipairs(followUps(key, nil)) do
    if #items >= N_NEXT then break end
    items[#items + 1] = s
  end
  UI.SetNext(items, "Your call:")
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
  UI.turn = (UI.turn or 0) + 1
  local results = UI.engine:Ask(question, ctx, 4)
  local top = results[1]
  UI.AddMessage("user", WHITE .. esc(question) .. "|r")
  if top and top.score >= MIN_SCORE and UI.SpoilerGate(top.key, top.kind, top.idx) then
    -- gated: SpoilerGate posted the warning and a Reveal chip
  elseif top and top.score >= MIN_SCORE then
    local heading = top.kind == "faq" and (top.title .. "  -  " .. top.name) or top.name
    local note = isGameplay(question) and (GREY .. "I only know the story side, not mechanics or drops. Here's the "
      .. "lore of " .. esc(top.name) .. ":|r\n") or ""
    local target = top.kind == "faq" and UI.FaqTarget(top.key, top.idx)
      or { id = "ans" .. time() .. "-" .. UI.turn, text = top.text, label = top.name }   -- the answer, not the heading
    local tag = (target and ns.Voice.HasAudio(target.key)) and NARRATED_TAG or nil
    UI.AddMessage("lore", note .. loreText(heading, top.text, top.angle, tag), target)
    UI.SetNext(followUps(top.key, top.kind == "faq" and top.idx or nil))
  elseif top and top.score >= GUESS_SCORE then
    -- Not sure enough to answer: offer the closest pre-written questions instead of a wrong answer.
    UI.engine.lastKey = nil
    UI.AddMessage("note", GREY .. "I'm not sure I have that. Did you mean one of these?|r")
    local items = {}
    for _, r in ipairs(results) do
      local e = UI.engine.db.entries[r.key]
      local fi = r.kind == "faq" and r.idx or 1
      if e.faq and e.faq[fi] then items[#items + 1] = { key = r.key, idx = fi, q = e.faq[fi].q, name = e.n } end
      if #items >= N_NEXT then break end
    end
    UI.SetNext(items, "Did you mean:")
  else
    UI.engine.lastKey = nil
    UI.AddMessage("note", GREY .. "I don't have lore on that yet. Try a place, person or quest nearby, or pick "
      .. "something on the left.|r")
    local items = {}
    for _, s in ipairs(UI.engine:Suggest(ctx, N_NEXT)) do items[#items + 1] = s end
    UI.SetNext(items, "Try:")
  end
  UI.lastLog = ns.Log.Question(question, ctx, results, via, UI.turn)
  UI.SetFeedbackVisible(true)
end

function UI.ShowFaq(key, idx, via)
  local e = UI.engine.db.entries[key]
  if not (e and e.faq and e.faq[idx]) then return UI.ShowEntry(key, via) end
  local f = e.faq[idx]
  UI.engine.lastKey = key
  if via ~= "reveal" then UI.AddMessage("user", WHITE .. esc(f.q) .. "|r") end
  if via ~= "reveal" and UI.SpoilerGate(key, "faq", idx) then return end
  local target = UI.FaqTarget(key, idx)
  UI.AddMessage("lore", loreText(e.n, f.a, nil, ns.Voice.HasAudio(target.key) and NARRATED_TAG or nil), target)
  UI.SetNext(followUps(key, idx))
  UI.lastLog = ns.Log.Question(f.q, UI.ctx or ns.Context.Snapshot(), { { key = key, kind = "faq", idx = idx, title = f.q } }, via)
  UI.SetFeedbackVisible(true)
end

-- Entry overview: summary plus spoiler-free sections; its questions become the suggestions. `asked` is the
-- sidebar label that led here, shown as your side of the conversation.
function UI.ShowEntry(key, via, asked)
  local e = UI.engine.db.entries[key]
  if not e then return end
  UI.engine.lastKey = key
  local parts = { WHITE .. esc(e.s) .. "|r" }
  for _, sec in ipairs(e.sec or {}) do
    if (sec.sp or 0) == 0 then
      parts[#parts + 1] = GOLD .. esc(sec.t) .. "|r\n" .. WHITE .. esc(sec.b) .. "|r"
    else
      parts[#parts + 1] = GREY .. esc(sec.t) .. "  (spoiler - use Reveal below)|r"
    end
  end
  if asked then UI.AddMessage("user", WHITE .. esc(asked) .. "|r") end
  local narrated = ns.Voice.HasAudio(key) and ("  " .. GREY .. "(narrated)|r") or ""
  local text = GOLD .. esc(e.n) .. "|r" .. narrated .. "\n" .. table.concat(parts, "\n\n")
  UI.AddMessage("lore", text, UI.EntryTarget(key))
  UI.SetNext(followUps(key, nil))
  UI.lastLog = ns.Log.Question("[open] " .. e.n, UI.ctx or ns.Context.Snapshot(), { { key = key, kind = "summary", title = e.n } }, via)
  UI.SetFeedbackVisible(true)
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
    parts[#parts + 1] = GOLD .. "Why you're here|r\n" .. WHITE .. table.concat(mine, "\n") .. "|r"
  end
  local who = {}
  for i, bk in ipairs(z.b or {}) do
    local be = db.entries[bk]
    if be then who[#who + 1] = i .. ". " .. GOLD .. esc(be.n) .. "|r " .. WHITE .. esc(be.h or be.s) .. "|r" end
  end
  if #who > 0 then parts[#parts + 1] = GOLD .. "Who you'll face|r\n" .. table.concat(who, "\n") end
  UI.AddMessage("user", WHITE .. "Dungeon primer: " .. esc(z.n) .. "|r")
  local narrated = ns.Voice.HasAudio("zone:" .. zk) and ("  " .. GREY .. "(narrated)|r") or ""
  UI.AddMessage("lore", GOLD .. esc(z.n) .. (z.lv and (" (" .. z.lv .. ")") or "") .. "|r" .. narrated .. "\n"
    .. table.concat(parts, "\n\n"), UI.EntryTarget("zone:" .. zk))
  local items = {}
  -- What beating the final boss means for the story, kept behind a click since it's a spoiler.
  local last = z.b and db.entries[z.b[#z.b]]
  local lastName = last and last.n:lower():gsub("%s*%b()", "")
  for i, fq in ipairs(e.faq or {}) do
    local q = fq.q:lower()
    if (lastName and q:find(lastName, 1, true)) or q:find("final boss") or q:find("defeat") then
      items[1] = { key = "zone:" .. zk, idx = i, label = "Spoiler: " .. fq.q, via = "reveal" }
      break
    end
  end
  for _, bk in ipairs(z.b or {}) do
    local be = db.entries[bk]
    if be and be.faq and be.faq[1] then items[#items + 1] = { key = bk, idx = 1, q = be.faq[1].q, name = be.n } end
    if #items >= N_NEXT then break end
  end
  UI.SetNext(#items > 0 and items or followUps("zone:" .. zk, nil))
  UI.lastLog = ns.Log.Question("[primer] " .. z.n, ctx, { { key = "zone:" .. zk, kind = "summary", title = z.n } }, via)
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
  if obj and obj ~= "" then parts[#parts + 1] = GOLD .. "Objectives|r\n" .. WHITE .. esc(obj) .. "|r" end
  if ze then parts[#parts + 1] = GOLD .. "Where this happens: " .. esc(ze.n) .. "|r\n" .. WHITE .. esc(ze.h or ze.s) .. "|r" end
  if #parts == 0 then parts[1] = GREY .. "Open this quest in your quest log once so its text can be read.|r" end
  UI.AddMessage("user", WHITE .. esc(q.title) .. "|r")
  UI.AddMessage("lore", GOLD .. esc(q.title) .. "|r  " .. GREY .. "(no written lore yet - the quest's own words)|r\n"
    .. table.concat(parts, "\n\n"))
  local items = {}
  if ze then
    for i = 1, 3 do
      if ze.faq and ze.faq[i] then items[#items + 1] = { key = "zone:" .. zk, idx = i, q = ze.faq[i].q } end
    end
  end
  UI.SetNext(items)
end
