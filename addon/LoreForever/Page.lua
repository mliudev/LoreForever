-- A story's page (v2 "Your Chronicle", slice 2): one page for a place, person, item or quest, opened from every way in
-- (the tooltip keys, the quest window's Lore button, names in answers and chat, the Here list), over the conversation
-- like the Journey page. Parchment, the quest log's own fonts, and on it: the story, Listen, the passages your quests
-- haven't opened yet as seals, your moment with it (when and where you found it), the pages on the same road you've
-- found, and a line to ask about it. The story still goes into the conversation underneath too (UI.ShowEntry), so
-- Back shows it there and nothing that read the chat changes.

local _, ns = ...
local Page = {}
ns.Page = Page
local L, T = ns.L, ns.Theme

-- Opened by these ways in (UI.ShowEntry's via; Found opens pages itself, as "found"); a story the player or the playlist reads aloud stays in the chat.
Page.VIA = { hover = true, questdialog = true, questlog = true, chatlink = true, link = true, here = true,
  quest = true, typed = true, target = true, page = true }

local INK = { 0.18, 0.11, 0.04 }
local ACCENT = { 0.42, 0.11, 0.05 }      -- titles on the page
local NOTE = { 0.20, 0.11, 0.03 }        -- your moment, the seals (dark enough to read on the parchment)
local PARCHMENT = { 0.86, 0.80, 0.66, 1 }
local PAPER_TINT = { 0.90, 0.93, 0.96 }   -- QuestBG is a saturated orange; this takes it toward a softer parchment
local HINT = { 0.96, 0.90, 0.76 }          -- the ask box's placeholder: light, on the box's dark fill
local PAPER = "Interface\\QuestFrame\\QuestBG"
local PAD, GAP, RELATED_MAX = 16, 10, 6
-- What kind of page it is, by entry type (read through L when shown: the language pack loads after this file).
local KIND = { zone = "Zone", city = "City", dungeon = "Dungeon", subzone = "Place", npc = "Person", item = "Item",
  quest = "Quest", topic = "Of Azeroth" }
local KIND_L = { Zone = function() return L["Zone"] end, City = function() return L["City"] end,
  Dungeon = function() return L["Dungeon"] end, Place = function() return L["Place"] end,
  Person = function() return L["Person"] end, Item = function() return L["Item"] end,
  Quest = function() return L["Quest"] end, ["Of Azeroth"] = function() return L["Of Azeroth"] end }

local function esc(s) return (tostring(s or ""):gsub("|", "||")) end
local function settings() return (LoreForeverDB and LoreForeverDB.settings) or {} end
local function entries() return ns.DB and ns.DB.entries or {} end

local function ink(fs, c)
  fs:SetTextColor(c[1], c[2], c[3], 1)
  if fs.SetShadowColor then fs:SetShadowColor(0, 0, 0, 0) end
  fs:SetJustifyH("LEFT")
  if fs.SetWordWrap then fs:SetWordWrap(true) end
  return fs
end

local function fitWidth(b, min)
  b:SetWidth(math.max(min or 60, math.floor((T.TextWidth(b:GetFontString()) or 40) + 24)))
end

-- The pool of text lines and buttons in the scrolling body, reused between pages.
local pool = { text = {}, seal = {}, rel = {} }
local function take(kind, make)
  local list = pool[kind]
  list.n = (list.n or 0) + 1
  local o = list[list.n]
  if not o then o = make(); list[list.n] = o end
  o:ClearAllPoints()
  o:Show()
  return o
end
local function release()
  for _, list in pairs(pool) do
    for i = 1, #list do list[i]:Hide() end
    list.n = 0
  end
end

-- What kind of page an entry type is ("Person"), in the reading language.
function Page.KindLabel(t) return KIND[t] and KIND_L[KIND[t]]() or "" end

-- The book's parchment on a page frame (this one and Found's), with its gold rim.
function Page.Paper(p)
  local bg = p:CreateTexture(nil, "BACKGROUND")
  bg:SetAllPoints()
  bg:SetColorTexture(PARCHMENT[1], PARCHMENT[2], PARCHMENT[3], PARCHMENT[4])
  if T.HasTexture(PAPER) then
    local paper = p:CreateTexture(nil, "BACKGROUND", nil, 1)
    paper:SetAllPoints()
    paper:SetTexture(PAPER)
    paper:SetTexCoord(0, 0.586, 0, 0.655)
    paper:SetVertexColor(PAPER_TINT[1], PAPER_TINT[2], PAPER_TINT[3], 1)
  end
  p.edge = T.Outline(p, "rim")
end

function Page.Create(f)
  local UI = ns.UI
  local p = CreateFrame("Frame", "LoreForeverStoryPage", f)
  p:SetPoint("TOPLEFT", UI.CHAT_X - 4, -60)
  p:SetPoint("BOTTOMRIGHT", -12, 8)   -- over the suggestions and the message box too, like the Journey page
  p:SetFrameLevel((f:GetFrameLevel() or 1) + 20)
  p:EnableMouse(true)
  Page.Paper(p)
  T.CoverChat(p)
  p:Hide()
  Page.frame = p

  local back = T.Button(p, L["Back"])
  back:SetHeight(22)
  back:SetPoint("TOPRIGHT", -8, -8)
  fitWidth(back, 70)
  back:SetScript("OnClick", function() Page.Back() end)
  Page.backButton = back

  local title = ink(p:CreateFontString(nil, "OVERLAY", "QuestTitleFont"), ACCENT)
  title:SetPoint("TOPLEFT", PAD, -12)
  title:SetPoint("RIGHT", back, "LEFT", -8, 0)
  if title.SetMaxLines then title:SetMaxLines(2) end
  Page.title = title
  local sub = ink(p:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
  sub:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -4)
  sub:SetPoint("RIGHT", p, "RIGHT", -PAD, 0)
  Page.sub = sub

  -- Listen: click plays it, Shift-click adds it to the playlist (the same meaning everywhere).
  local listen = T.Button(p, L["Listen"], "primary")
  listen:SetHeight(22)
  listen:SetPoint("TOPLEFT", sub, "BOTTOMLEFT", 0, -6)
  fitWidth(listen, 70)
  listen:RegisterForClicks("LeftButtonUp")
  listen:SetScript("OnClick", function()
    local key = Page.key
    if not key then return end
    if IsShiftKeyDown and IsShiftKeyDown() then return UI.DoQueueAction(key) end
    UI.PlayEntry(key)
  end)
  listen:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
    GameTooltip:AddLine(L["Listen"])
    T.Tip(L["Shift-click: add to your playlist"], "tipDim", true)
    GameTooltip:Show()
  end)
  listen:SetScript("OnLeave", function() GameTooltip:Hide() end)
  Page.listen = listen
  local unvoiced = ink(p:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
  unvoiced:SetPoint("TOPLEFT", sub, "BOTTOMLEFT", 0, -10)
  unvoiced:SetPoint("RIGHT", p, "RIGHT", -PAD, 0)
  Page.unvoiced = unvoiced

  -- The ask line at the foot: the question goes to the conversation, as typed there.
  local ask = CreateFrame("EditBox", nil, p, "InputBoxTemplate")
  ask:SetHeight(22)
  ask:SetPoint("BOTTOMLEFT", PAD + 6, 10)
  ask:SetPoint("BOTTOMRIGHT", -PAD, 10)
  ask:SetAutoFocus(false)
  ask:SetFontObject(ChatFontNormal or "GameFontHighlight")
  ask:SetScript("OnEnterPressed", function(self)
    local q = (self:GetText() or ""):gsub("^%s+", ""):gsub("%s+$", "")
    self:SetText("")
    self:ClearFocus()
    if q == "" then return end
    Page.Hide()
    ns.Book.HidePage()   -- the answer is in the chat, under Found's pages
    UI.Ask(q, "page")
  end)
  ask:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  local hint = ask:CreateFontString(nil, "OVERLAY", T.font.hint)
  hint:SetPoint("LEFT", 2, 0)
  hint:SetPoint("RIGHT", -2, 0)
  hint:SetJustifyH("LEFT")
  hint:SetTextColor(HINT[1], HINT[2], HINT[3], 1)
  ask:SetScript("OnEditFocusGained", function() hint:Hide() end)
  ask:SetScript("OnEditFocusLost", function(self) hint:SetShown((self:GetText() or "") == "") end)
  Page.ask, Page.askHint = ask, hint

  local sf = CreateFrame("ScrollFrame", nil, p, "UIPanelScrollFrameTemplate")
  sf:SetPoint("TOPLEFT", listen, "BOTTOMLEFT", 0, -GAP)
  sf:SetPoint("BOTTOMRIGHT", ask, "TOPRIGHT", -22, GAP)
  local content = CreateFrame("Frame", nil, sf)
  content:SetSize(300, 100)
  sf:SetScrollChild(content)
  Page.scroll, Page.content = sf, content

  p:SetScript("OnSizeChanged", function(self) if self:IsShown() and Page.key then Page.Layout() end end)
  -- Only one page over the conversation at a time.
  p:HookScript("OnShow", function()
    if UI.journeyPage then UI.journeyPage:Hide() end
    if UI.historyFrame then UI.historyFrame:Hide() end
  end)
  for _, other in ipairs({ UI.journeyPage, UI.historyFrame }) do
    if other then other:HookScript("OnShow", function() p:Hide() end) end
  end
  -- Found's page is hidden while a story's page is over it (its chips, tiles and scroll bar sit on levels above this
  -- page's own), and comes back when this one closes, if Found is still the tab and nothing else took the place.
  p:HookScript("OnShow", function()
    if ns.Book and ns.Book.frame then ns.Book.frame:Hide() end
  end)
  p:HookScript("OnHide", function()
    local book = ns.Book
    if not (book and book.frame) or book.frame:IsShown() then return end
    if UI.tab ~= "found" or not (UI.frame and UI.frame:IsShown()) then return end
    if (UI.journeyPage and UI.journeyPage:IsShown()) or (UI.historyFrame and UI.historyFrame:IsShown()) then return end
    book.frame:Show()
    book.RefreshPage()
  end)
  return p
end

-- Your moment with it: the journey's own line ("You first met him at Sentinel Hill, 3 days ago"), else when the
-- chronicle found it.
function Page.Moment(key)
  local ok, line = pcall(ns.UI.YouLine, key)
  if ok and type(line) == "string" and line ~= "" then return line end
  local rec = ns.Collection and ns.Collection.Found(key)
  if not rec then return nil end
  if rec.place and rec.lv then return string.format(L["Found at %s, level %d."], rec.place, rec.lv) end
  if rec.place then return string.format(L["Found at %s."], rec.place) end
  return L["In your chronicle."]
end

-- The pages on the same road: the related entries this character has found (one not found yet stays a secret).
function Page.Related(key)
  local out, e = {}, entries()[key]
  for _, k in ipairs(e and e.rel or {}) do
    if k ~= key and entries()[k] and ns.Collection and ns.Collection.IsFound(k) then out[#out + 1] = k end
    if #out >= RELATED_MAX then break end
  end
  return out
end

local function textLine(content, width, y, text, font, color)
  local fs = take("text", function() return content:CreateFontString(nil, "OVERLAY") end)
  fs:SetFontObject(font)
  ink(fs, color)
  fs:SetWidth(width)
  fs:SetText(text)
  fs:SetPoint("TOPLEFT", 0, y)
  return y - (fs:GetStringHeight() or 14) - GAP
end

function Page.Layout()
  local key = Page.key
  local e = key and entries()[key]
  if not e then return end
  local content, width = Page.content, math.max(200, (Page.scroll:GetWidth() or 300) - 16)
  content:SetWidth(width)
  release()
  local y = 0
  local moment = Page.Moment(key)
  if moment then y = textLine(content, width, y, esc(moment), "GameFontNormalSmall", NOTE) end
  local story = e.t == "quest" and e.m and e.m.id and ns.Storyline.Line(e.m.id)
  if story then y = textLine(content, width, y, esc(story), "GameFontNormalSmall", ACCENT) end
  y = textLine(content, width, y, esc(e.s), T.font.body, INK)
  local all, done = settings().showSpoilers, ns.Context.Done()
  for i, sec in ipairs(e.sec or {}) do
    if all or Page.revealed[i] or ns.UI.engine:Opens(key, sec, done) then
      y = textLine(content, width, y, esc(sec.t), T.font.body, ACCENT) + GAP - 4
      y = textLine(content, width, y, esc(sec.b), T.font.body, INK)
    else
      -- A seal: never the passage's title, only that it waits, and a way to read it anyway.
      local row = take("seal", function()
        local r = CreateFrame("Frame", nil, content)
        r.text = ink(r:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
        r.text:SetPoint("TOPLEFT", 20, 0)
        r.wax = r:CreateTexture(nil, "ARTWORK")
        r.wax:SetSize(14, 14)
        r.wax:SetPoint("TOPLEFT", 0, 0)
        r.wax:SetTexture(T.HasTexture(T.DISC) and T.DISC or "Interface\\Buttons\\WHITE8X8")
        r.wax:SetVertexColor(0.62, 0.16, 0.10, 1)
        r.read = T.Button(r, L["Read it anyway"])
        r.read:SetHeight(20)
        fitWidth(r.read, 60)
        r.read:SetScript("OnClick", function(self) Page.revealed[self.idx] = true; Page.Layout() end)
        return r
      end)
      row:SetWidth(width)
      row.text:SetWidth(width - 20)
      row.text:SetText(L["A passage here opens further along a storyline you're on."])
      row.read.idx = i
      row.read:ClearAllPoints()
      row.read:SetPoint("TOPLEFT", row.text, "BOTTOMLEFT", 0, -4)
      local h = (row.text:GetStringHeight() or 14) + 4 + 20
      row:SetHeight(h)
      row:SetPoint("TOPLEFT", 0, y)
      y = y - h - GAP
    end
  end
  local related = Page.Related(key)
  if #related > 0 then
    y = textLine(content, width, y, L["On the same road"], "GameFontNormalSmall", NOTE) + GAP - 4
    local x, rowH = 0, 22
    for _, k in ipairs(related) do
      local b = take("rel", function()
        local r = T.Button(content)
        r:SetHeight(20)
        r:SetScript("OnClick", function(self) Page.Show(self.key, "page") end)
        return r
      end)
      b.key = k
      b:SetText(esc(entries()[k].n))
      fitWidth(b, 40)
      local w = b:GetWidth() or 80
      if x > 0 and x + w > width then x, y = 0, y - rowH end
      b:SetPoint("TOPLEFT", x, y)
      x = x + w + 6
    end
    y = y - rowH - GAP
  end
  content:SetHeight(math.max(20, -y))
end

function Page.Refresh()
  local key = Page.key
  local e = key and entries()[key]
  if not e then return end
  Page.title:SetText(esc(e.n))
  local zone = e.z and ns.DB.zones and ns.DB.zones[e.z]
  local kind = Page.KindLabel(e.t)
  Page.sub:SetText(esc(zone and zone.n and (kind ~= "" and (kind .. ns.Lang.Dotted(" · ") .. zone.n) or zone.n) or kind))
  local target = ns.UI.EntryTarget(key)
  local voiced = target and ns.Voice.HasAudio(target.key) and true or false
  Page.listen:SetShown(voiced)
  -- A recording planned that this player can't play (not recorded yet, or its voices aren't installed).
  local planned = not voiced and ns.Voice.Current() ~= "none" and (ns.DB.clipHash or {})[key]
  Page.unvoiced:SetText(planned and L["Not in your voices yet: read it here."] or "")
  Page.askHint:SetText(string.format(L["Ask about %s"], esc(e.n)))
  Page.askHint:SetShown((Page.ask:GetText() or "") == "")
  Page.Layout()
  if Page.scroll.SetVerticalScroll then Page.scroll:SetVerticalScroll(0) end
end

-- Opens `key`'s page (and the panel). Pages opened from a page stack up for Back.
function Page.Show(key, via)
  if not (Page.frame and key and entries()[key]) then return end
  local UI = ns.UI
  if UI.frame and not UI.frame:IsShown() then UI.frame:Show() end
  Page.stack = (via == "page" and Page.frame:IsShown()) and Page.stack or {}
  if Page.stack[#Page.stack] ~= key then Page.stack[#Page.stack + 1] = key end
  Page.key, Page.revealed = key, {}
  Page.frame:Show()
  Page.Refresh()
  ns.Log.Use("page")
  if ns.Collection.Read(key) then ns.Book.Changed() end   -- it isn't new any more
end

function Page.Back()
  local stack = Page.stack or {}
  table.remove(stack)
  local prev = stack[#stack]
  if prev then
    Page.key, Page.revealed = prev, {}
    return Page.Refresh()
  end
  Page.Hide()
end

function Page.Hide()
  if Page.frame then Page.frame:Hide() end
end

function Page.IsShown() return Page.frame and Page.frame:IsShown() or false end
