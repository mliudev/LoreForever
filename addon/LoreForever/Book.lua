-- The Found bookmark (v2 "Your Chronicle", slice 3): the pages this character has found, by chapter, in place of the
-- Library. The sidebar lists the chapters (where you are first, then the zones in the order you reached them, then
-- "Of Azeroth" for the world's own stories), each with how many of its pages you've found; the page over the
-- conversation shows a chapter's pages as tiles. A found page shows its name, a green "New" until you open or hear it
-- and a tick once heard; one not found yet is blank, with only what kind of page it is, so nothing is spoiled.
-- Search reads only found pages. Click opens a page, Shift-click (or its green +) adds it to the playlist, right-click
-- gives options.
-- The chapters are worked out the first time Found opens, not at login.

local _, ns = ...
local Book = {}
ns.Book = Book
local L, T = ns.L, ns.Theme

local AZEROTH, NEW, SEARCH = "*azeroth", "*new", "*search"
local KIND = { zone = "places", city = "places", dungeon = "places", subzone = "places", npc = "people",
  item = "items", quest = "quests", topic = "topics" }
local KIND_ORDER = { places = 1, people = 2, items = 3, quests = 4, topics = 5 }
local KINDS = { "places", "people", "items", "quests" }
local STATES = { "all", "new", "unheard", "heard" }
local TILE_H, TILE_W, GAP, PAD, ROW_H = 40, 168, 6, 16, 22
local SEARCH_CAP = 200   -- tiles a search shows at most

-- Parchment inks (as on a story's page).
local INK = { 0.18, 0.11, 0.04 }
local ACCENT = { 0.42, 0.11, 0.05 }
local NOTE = { 0.30, 0.18, 0.06 }
local FADED = { 0.45, 0.36, 0.22 }
local NEW_INK = { 0.08, 0.42, 0.04 }
local TILE = { 0.80, 0.71, 0.52, 0.85 }
local TILE_BLANK = { 0.86, 0.79, 0.62, 0.45 }
local CHIP = { 0.74, 0.64, 0.44, 0.7 }
local CHIP_ON = { 0.42, 0.11, 0.05, 0.85 }

local function esc(s) return (tostring(s or ""):gsub("|", "||")) end
local function entries() return ns.DB and ns.DB.entries or {} end
local function zones() return ns.DB and ns.DB.zones or {} end
local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b = pcall(fn, ...)
  if ok then return a, b end
end
local function ink(fs, c)
  fs:SetTextColor(c[1], c[2], c[3], 1)
  if fs.SetShadowColor then fs:SetShadowColor(0, 0, 0, 0) end
  fs:SetJustifyH("LEFT")
  return fs
end

local function kindLabel(kind)
  return ({ places = L["Places"], people = L["People"], items = L["Items"], quests = L["Quests"],
    topics = L["Of Azeroth"] })[kind] or ""
end
local function stateLabel(s)
  return ({ all = L["All"], new = L["New"], unheard = L["Not heard"], heard = L["Heard"] })[s]
end
-- A page not found yet says only what kind of page it is, and how pages like it are found.
local function blankLabel(kind)
  return ({ places = L["A place"], people = L["Someone"], items = L["An item"], quests = L["A quest"],
    topics = L["Of Azeroth"] })[kind] or ""
end
local function blankHint(kind)
  return ({ places = L["Travel there to find this page."], people = L["Meet them to find this page."],
    items = L["Loot it, or hover it anywhere, to find this page."], quests = L["Take the quest to find this page."],
    topics = L["It turns up as you play."] })[kind] or ""
end

-- Chapters ------------------------------------------------------------------------------------------------------

-- Quests for the other faction stay out of the totals, so every "41 of 98" can be reached.
local function reachable(e, mine)
  local f = e.t == "quest" and e.m and e.m.faction
  f = type(f) == "string" and f:lower() or nil
  return not (mine and (f == "alliance" or f == "horde") and f ~= mine)
end

local index   -- { db, chapters = { [chapter] = { keys } } }, built the first time Found opens
function Book.Index()
  local db = ns.DB and ns.DB.entries
  if index and index.db == db then return index end
  local mine = try(UnitFactionGroup, "player")
  mine = type(mine) == "string" and mine:lower() or nil
  local chapters, zs = {}, zones()
  for key, e in pairs(db or {}) do
    if KIND[e.t] and reachable(e, mine) then
      local ck = (e.t ~= "topic" and e.z and zs[e.z]) and e.z or AZEROTH
      local c = chapters[ck]
      if not c then c = { keys = {} }; chapters[ck] = c end
      c.keys[#c.keys + 1] = key
    end
  end
  index = { db = db, chapters = chapters }
  return index
end

local function found() local r = ns.Collection.Store(); return r and r.found or {} end
local function foundTime(s) return tonumber(type(s) == "string" and s:match("^(%d+)") or "") or 0 end
local function heard(key) return ns.Voice.Heard(key) end

function Book.ChapterName(ck)
  if ck == AZEROTH then return L["Of Azeroth"] end
  if ck == NEW then return L["New pages"] end
  if ck == SEARCH then return L["Search"] end
  local z = zones()[ck]
  return z and z.n or ck
end

-- One chapter's counts: { found, total, heard, first, kinds = { places = { found, total }, ... } }.
function Book.Count(ck)
  local c = Book.Index().chapters[ck]
  local have, out = found(), { found = 0, total = 0, heard = 0, kinds = {} }
  for _, k in ipairs(c and c.keys or {}) do
    local kind = KIND[entries()[k].t]
    local kc = out.kinds[kind] or { found = 0, total = 0 }
    out.kinds[kind] = kc
    kc.total, out.total = kc.total + 1, out.total + 1
    local s = have[k]
    if s then
      kc.found, out.found = kc.found + 1, out.found + 1
      if heard(k) then out.heard = out.heard + 1 end
      local t = foundTime(s)
      if not out.first or t < out.first then out.first = t end
    end
  end
  return out
end

local function hereChapter()
  local zone = ns.Context.Place().zone
  local zk = zone and ns.UI.engine and ns.UI.engine:ZoneKey(zone)
  return zk and Book.Index().chapters[zk] and zk or nil
end

-- The sidebar's rows: { ck, label, count, here }. Where you are first, then New pages (when there are any), then the
-- chapters you've found pages in, in the order you reached them, and Of Azeroth last.
function Book.Chapters()
  local out, here, list = {}, hereChapter(), {}
  for ck in pairs(Book.Index().chapters) do
    if ck ~= AZEROTH and ck ~= here then
      local n = Book.Count(ck)
      if n.found > 0 then list[#list + 1] = { ck = ck, label = Book.ChapterName(ck), count = n } end
    end
  end
  table.sort(list, function(a, b)
    if a.count.first ~= b.count.first then return a.count.first < b.count.first end
    return a.label < b.label
  end)
  if here then out[1] = { ck = here, label = Book.ChapterName(here), count = Book.Count(here), here = true } end
  local new = ns.Collection.NewCount()
  if new > 0 then out[#out + 1] = { ck = NEW, label = L["New pages"], new = new } end
  for _, row in ipairs(list) do out[#out + 1] = row end
  local az = Book.Count(AZEROTH)
  if az.found > 0 then out[#out + 1] = { ck = AZEROTH, label = L["Of Azeroth"], count = az } end
  return out
end

-- A chapter's tiles, as filtered and sorted: { key, kind, found = true/nil }.
function Book.Tiles(ck, state, kindFilter, byName)
  local have, db, out = found(), entries(), {}
  local keys = {}
  if ck == NEW then
    for _, k in ipairs(ns.Collection.NewKeys()) do keys[#keys + 1] = k end
  elseif ck == SEARCH then
    local words = Book.search and Book.search.words or {}
    for k in pairs(have) do
      local e = db[k]
      local z = e and e.z and zones()[e.z]
      if e and KIND[e.t] and ns.UI.SearchMatch(words, e.n, e.en, z and z.n) then keys[#keys + 1] = k end
    end
  else
    local c = Book.Index().chapters[ck]
    keys = c and c.keys or {}
  end
  for _, k in ipairs(keys) do
    local e, s = db[k], have[k]
    local kind = e and KIND[e.t]
    local ok = kind and (not kindFilter or kindFilter == kind)
    if ok and not s then ok = state == "all" end
    if ok and s then
      if state == "new" then ok = ns.Collection.IsNew(k)
      elseif state == "unheard" then ok = not heard(k)
      elseif state == "heard" then ok = heard(k) end
    end
    if ok then out[#out + 1] = { key = k, kind = kind, found = s and true or nil, t = s and foundTime(s) or 0 } end
  end
  table.sort(out, function(a, b)
    if (a.found or false) ~= (b.found or false) then return a.found or false end
    if not a.found then
      if a.kind ~= b.kind then return KIND_ORDER[a.kind] < KIND_ORDER[b.kind] end
      return a.key < b.key
    end
    if not byName and a.t ~= b.t then return a.t < b.t end
    local na, nb = db[a.key].n, db[b.key].n
    if na ~= nb then return na < nb end
    return a.key < b.key
  end)
  if ck == SEARCH and #out > SEARCH_CAP then
    for i = #out, SEARCH_CAP + 1, -1 do out[i] = nil end
  end
  return out
end

-- What a chapter's green + adds: its found pages, places first, then people, items and quests, each in the order
-- found (what can't be played or is queued already is skipped by UI.QueueGroup).
function Book.QueueKeys(ck)
  local tiles = Book.Tiles(ck, "all", nil, false)
  local keys = {}
  for _, t in ipairs(tiles) do if t.found then keys[#keys + 1] = t end end
  table.sort(keys, function(a, b)
    if a.kind ~= b.kind then return KIND_ORDER[a.kind] < KIND_ORDER[b.kind] end
    if a.t ~= b.t then return a.t < b.t end
    return a.key < b.key
  end)
  for i, t in ipairs(keys) do keys[i] = t.key end
  return keys
end

-- The sidebar view ------------------------------------------------------------------------------------------------

function Book.CreateSide(view)
  local UI = ns.UI
  local SIDE_W = UI.SIDE_W
  local sf = CreateFrame("ScrollFrame", "LoreForeverFoundScroll", view, "UIPanelScrollFrameTemplate")
  sf:SetPoint("TOPLEFT", 10, -120)
  sf:SetPoint("BOTTOMRIGHT", view, "BOTTOMLEFT", SIDE_W - 26, UI.DOCK_H + 30)
  local content = CreateFrame("Frame", nil, sf)
  content:SetSize(SIDE_W - 40, 100)
  sf:SetScrollChild(content)
  Book.sideContent, Book.sideRows = content, {}
  -- Search reads only the pages you've found: a name typed can never confirm a page you haven't.
  local search = UI.SearchBox(view, SIDE_W - 22, function(words)
    if #words > 0 then
      if Book.chapter ~= SEARCH then Book.beforeSearch = Book.chapter end
      Book.chapter = SEARCH
    elseif Book.chapter == SEARCH then
      Book.chapter = Book.beforeSearch
    end
    Book.Refresh()
  end, sf)
  search:SetPoint("TOPLEFT", 12, -92)
  Book.search = search
  local note = T.Muted(view:CreateFontString(nil, "OVERLAY", T.font.small))
  note:SetPoint("BOTTOMLEFT", 16, UI.DOCK_H + 8)
  note:SetWidth(SIDE_W - 20)
  note:SetJustifyH("LEFT")
  note:SetText(L["Click a chapter to see its pages. Green + adds its stories to your playlist."])
end

local function sideRow(i)
  local UI = ns.UI
  local row = Book.sideRows[i]
  if row then return row end
  row = UI.TextButton(Book.sideContent, UI.SIDE_W - 40, ROW_H, T.font.small)
  if row.text.SetWordWrap then row.text:SetWordWrap(false) end
  row.text:SetPoint("BOTTOMRIGHT", -78, 2)
  local count = T.Muted(row:CreateFontString(nil, "OVERLAY", T.font.small))
  count:SetPoint("RIGHT", -26, 0)
  count:SetJustifyH("RIGHT")
  row.count = count
  row.sel = T.Area(row, "select")
  row.sel:SetAllPoints()
  row.mark = T.TargetMark(row)
  local all = UI.TextButton(row, 20, ROW_H - 4, T.font.body, T.color.add)
  all.text:SetJustifyH("CENTER")
  all.text:SetText("+")
  all:SetPoint("RIGHT", -2, 0)
  all:SetScript("OnClick", function(self) UI.QueueGroup(Book.QueueKeys(self.ck), self.label, true) end)
  all:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Add all to your playlist"])
    T.Tip(L["Adds the stories of the pages you've found here, places first, then people, items and quests."],
      "tipText", true)
    GameTooltip:Show()
  end)
  all:SetScript("OnLeave", function() GameTooltip:Hide() end)
  row.all = all
  row:SetScript("OnClick", function(self)
    if Book.search and Book.search:Active() then Book.search:Clear() end
    Book.chapter = self.ck
    Book.Refresh()
    Book.ShowPage()
  end)
  row:SetScript("OnEnter", function(self)
    if not self.c then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(esc(self.label))
    T.Tip(string.format(L["%d of %d pages found"], self.c.found, self.c.total), "tipText")
    if self.c.heard > 0 then T.Tip(string.format(L["%d heard"], self.c.heard), "tipGood") end
    if self.here then T.Tip(L["You are here"], "tipDim") end
    GameTooltip:Show()
  end)
  row:SetScript("OnLeave", function() GameTooltip:Hide() end)
  Book.sideRows[i] = row
  return row
end

function Book.RefreshSide()
  if not Book.sideContent then return end
  local rows, y = Book.Chapters(), 0
  for i, it in ipairs(rows) do
    local row = sideRow(i)
    row:ClearAllPoints()
    row:SetPoint("TOPLEFT", 0, -y)
    row.ck, row.label, row.c, row.here = it.ck, it.label, it.count, it.here
    row.all.ck, row.all.label = it.ck, it.label
    if it.new then
      row.text:SetText(T.code.green .. esc(it.label) .. "|r")
      row.count:SetText(T.code.green .. it.new .. "|r")
      row.all:Hide()
    else
      row.text:SetText(T.code.zone .. esc(it.label) .. "|r")
      row.count:SetText(it.count.found .. "/" .. it.count.total)
      row.all:Show()
    end
    row.sel:SetShown(it.ck == Book.chapter)
    T.ShowMark(row.mark, it.here)
    row:Show()
    y = y + ROW_H + 2
  end
  for i = #rows + 1, #Book.sideRows do Book.sideRows[i]:Hide() end
  Book.sideContent:SetHeight(math.max(10, y))
  Book.UpdateBadge()
end

-- The count of new pages on the Found bookmark.
function Book.UpdateBadge()
  local badge = Book.badge
  if not badge then return end
  local n = ns.Collection.NewCount()
  badge:SetText(n > 0 and (n > 99 and "99+" or tostring(n)) or "")
  badge:SetShown(n > 0)
end

function Book.CreateBadge(tab)
  local fs = tab:CreateFontString(nil, "OVERLAY", T.font.label)
  fs:SetTextColor(T.rgba(T.color.tipGood))
  fs:SetPoint("TOPRIGHT", tab, "TOPRIGHT", 2, 7)
  fs:Hide()
  Book.badge = fs
  Book.UpdateBadge()
end

-- The page over the conversation ------------------------------------------------------------------------------------

local function chip(parent, onClick)
  local b = ns.UI.TextButton(parent, 40, 20, T.font.label)
  local bg = b:CreateTexture(nil, "BACKGROUND")
  bg:SetAllPoints()
  b.bg = bg
  b.text:SetJustifyH("CENTER")
  b.text:SetPoint("TOPLEFT", 4, -1)
  b.text:SetPoint("BOTTOMRIGHT", -4, 1)
  if b.text.SetWordWrap then b.text:SetWordWrap(false) end
  b:SetScript("OnClick", onClick)
  return b
end
local function setChip(b, label, on)
  b.text:SetText(label)
  b:SetWidth(math.max(36, math.floor((T.TextWidth(b.text) or 30) + 16)))
  local c = on and CHIP_ON or CHIP
  b.bg:SetColorTexture(c[1], c[2], c[3], c[4])
  local t = on and { 1, 0.93, 0.78 } or INK
  b.text:SetTextColor(t[1], t[2], t[3], 1)
  if b.text.SetShadowColor then b.text:SetShadowColor(0, 0, 0, 0) end
end

function Book.Create(f)
  local UI = ns.UI
  local p = CreateFrame("Frame", "LoreForeverFoundPage", f)
  p:SetPoint("TOPLEFT", UI.CHAT_X - 4, -60)
  p:SetPoint("BOTTOMRIGHT", -12, 8)
  p:SetFrameLevel((f:GetFrameLevel() or 1) + 18)   -- a story's page opens over it (+20) and hides it; closing the story shows it again (Page.lua)
  p:EnableMouse(true)
  ns.Page.Paper(p)
  T.CoverChat(p)
  p:Hide()
  Book.frame = p
  Book.state, Book.kind, Book.byName = "all", nil, false

  local sort = T.Button(p)
  sort:SetHeight(22)
  sort:SetPoint("TOPRIGHT", -8, -8)
  sort:SetScript("OnClick", function() Book.byName = not Book.byName; Book.RefreshPage() end)
  sort:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
    GameTooltip:AddLine(Book.byName and L["Sort in the order you found them"] or L["Sort by name"])
    GameTooltip:Show()
  end)
  sort:SetScript("OnLeave", function() GameTooltip:Hide() end)
  Book.sortButton = sort

  local title = ink(p:CreateFontString(nil, "OVERLAY", "QuestTitleFont"), ACCENT)
  title:SetPoint("TOPLEFT", PAD, -12)
  title:SetPoint("RIGHT", sort, "LEFT", -8, 0)
  if title.SetWordWrap then title:SetWordWrap(false) end
  Book.title = title
  local sub = ink(p:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
  sub:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -4)
  sub:SetPoint("RIGHT", p, "RIGHT", -PAD, 0)
  Book.sub = sub
  local kinds = ink(p:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), INK)
  kinds:SetPoint("TOPLEFT", sub, "BOTTOMLEFT", 0, -3)
  kinds:SetPoint("RIGHT", p, "RIGHT", -PAD, 0)
  if kinds.SetWordWrap then kinds:SetWordWrap(true) end
  Book.kinds = kinds

  -- Filters: one of All / New / Not heard / Heard, and one kind (click it again for every kind).
  local chips = CreateFrame("Frame", nil, p)
  chips:SetPoint("TOPLEFT", kinds, "BOTTOMLEFT", 0, -6)
  chips:SetPoint("RIGHT", p, "RIGHT", -PAD, 0)
  chips:SetHeight(20)
  Book.chips, Book.stateChips, Book.kindChips = chips, {}, {}
  for _, s in ipairs(STATES) do
    local b = chip(chips, function() Book.state = s; Book.RefreshPage() end)
    Book.stateChips[s] = b
  end
  for _, k in ipairs(KINDS) do
    local b = chip(chips, function() Book.kind = (Book.kind ~= k) and k or nil; Book.RefreshPage() end)
    Book.kindChips[k] = b
  end

  local sf = CreateFrame("ScrollFrame", nil, p, "UIPanelScrollFrameTemplate")
  sf:SetPoint("TOPLEFT", chips, "BOTTOMLEFT", 0, -8)
  sf:SetPoint("BOTTOMRIGHT", -30, 26)   -- clear of the window's resize corner
  local content = CreateFrame("Frame", nil, sf)
  content:SetSize(300, 100)
  sf:SetScrollChild(content)
  Book.scroll, Book.content, Book.tiles = sf, content, {}
  local empty = ink(content:CreateFontString(nil, "OVERLAY", T.font.body), NOTE)
  empty:SetPoint("TOPLEFT", 0, -4)
  if empty.SetWordWrap then empty:SetWordWrap(true) end
  empty:Hide()
  Book.empty = empty

  p:SetScript("OnSizeChanged", function(self) if self:IsShown() then Book.RefreshPage() end end)
  -- One page over the conversation at a time; a story's page may open over this one.
  p:HookScript("OnShow", function()
    if UI.journeyPage then UI.journeyPage:Hide() end
    if UI.historyFrame then UI.historyFrame:Hide() end
  end)
  p:HookScript("OnHide", function() if Book.menu then Book.menu:Hide() end end)
  -- Journey and History open over it; closing them comes back to it while the Found tab is picked.
  for _, other in ipairs({ UI.journeyPage, UI.historyFrame }) do
    if other then
      other:HookScript("OnShow", function() p:Hide() end)
      other:HookScript("OnHide", function()
        if UI.tab == "found" and not p:IsShown() then p:Show(); Book.RefreshPage() end
      end)
    end
  end
  ns.Collection.OnFound(function() Book.Changed() end)
  return p
end

-- Options on a tile (right-click): open it, listen, add to or take out of the playlist.
local function tileMenu(tile)
  local UI = ns.UI
  local m = Book.menu
  if not m then
    m = T.Backdrop(CreateFrame("Frame", nil, Book.frame, T.BACKDROP_TEMPLATE), "popup")
    m:SetFrameStrata("DIALOG")
    m:SetSize(170, 3 * 22 + 12)
    m.items = {}
    for i = 1, 3 do
      local b = UI.TextButton(m, 158, 22, T.font.small)
      b:SetPoint("TOPLEFT", 6, -6 - (i - 1) * 22)
      if b.text.SetWordWrap then b.text:SetWordWrap(false) end
      b:SetScript("OnClick", function(self) m:Hide(); if self.run then self.run() end end)
      m.items[i] = b
    end
    m:SetScript("OnUpdate", function(self, dt)
      if self.IsMouseOver and self:IsMouseOver() then self.away = 0 return end
      self.away = (self.away or 0) + (dt or 0)
      if self.away > 1.5 then self:Hide() end
    end)
    Book.menu = m
  end
  local key, list = tile.key, {}
  list[#list + 1] = { L["Open the page"], function() ns.Page.Show(key, "found") end }
  if UI.StoryAudio(key) then list[#list + 1] = { L["Listen"], function() UI.PlayEntry(key) end } end
  if UI.CanQueue(key) then
    local action = UI.QueueAction(key)
    list[#list + 1] = { action == "add" and L["Add to playlist"] or (action == "stop" and L["Stop narration"])
      or L["Remove from playlist"], function() UI.DoQueueAction(key) end }
  end
  for i, b in ipairs(m.items) do
    local it = list[i]
    b:SetShown(it ~= nil)
    if it then b.text:SetText(it[1]); b.run = it[2] end
  end
  m:SetHeight(#list * 22 + 12)
  m:ClearAllPoints()
  m:SetPoint("TOPLEFT", tile, "BOTTOMLEFT", 8, 4)
  m.away = 0
  m:Show()
end

local function makeTile(i)
  local UI = ns.UI
  local b = CreateFrame("Button", nil, Book.content)
  b:SetSize(TILE_W, TILE_H)
  b:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  b.bg = b:CreateTexture(nil, "BACKGROUND")
  b.bg:SetAllPoints()
  b.rim = T.Outline(b, "rimOff")
  local hl = b:CreateTexture(nil, "HIGHLIGHT")
  hl:SetAllPoints()
  hl:SetColorTexture(1, 0.95, 0.75, 0.25)
  b.name = ink(b:CreateFontString(nil, "OVERLAY", "GameFontNormal"), INK)
  b.name:SetPoint("TOPLEFT", 8, -5)
  b.name:SetPoint("RIGHT", -30, 0)
  if b.name.SetWordWrap then b.name:SetWordWrap(false) end
  b.sub = ink(b:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
  b.sub:SetPoint("BOTTOMLEFT", 8, 5)
  b.sub:SetPoint("RIGHT", -8, 0)
  if b.sub.SetWordWrap then b.sub:SetWordWrap(false) end
  b.new = ink(b:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NEW_INK)
  b.new:SetPoint("TOPRIGHT", -6, -5)
  b.new:SetText(L["New"])
  b.tick = b:CreateTexture(nil, "OVERLAY")
  b.tick:SetSize(16, 16)
  b.tick:SetPoint("TOPRIGHT", -6, -3)
  b.tick:SetTexture("Interface\\Buttons\\UI-CheckBox-Check")
  b.add = UI.QueueButton(b, 18)   -- the green + of every list: add it to the playlist, then take it out
  b.add:SetPoint("BOTTOMRIGHT", -4, 4)
  b:SetScript("OnClick", function(self, button)
    if not self.found then return end
    if button == "RightButton" then return tileMenu(self) end
    if IsShiftKeyDown and IsShiftKeyDown() then
      if UI.CanQueue(self.key) then UI.DoQueueAction(self.key) end
      return Book.RefreshPage()
    end
    ns.Page.Show(self.key, "found")
  end)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    if not self.found then
      GameTooltip:AddLine(L["Not found yet"])
      T.Tip(blankHint(self.kind), "tipDim", true)
    else
      GameTooltip:AddLine(esc(entries()[self.key].n))
      local rec = ns.Collection.Found(self.key)
      if rec and rec.place then T.Tip(string.format(L["Found at %s."], esc(rec.place)), "tipText") end
      if heard(self.key) then T.Tip(L["You've heard this."], "tipGood") end
      T.Tip(L["Click: open its page. Shift-click: add to your playlist. Right-click: options."], "tipDim", true)
    end
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  Book.tiles[i] = b
  return b
end

local function setTile(b, it)
  b.key, b.kind, b.found = it.key, it.kind, it.found
  local c = it.found and TILE or TILE_BLANK
  b.bg:SetColorTexture(c[1], c[2], c[3], c[4])
  if it.found then
    local e = entries()[it.key]
    local isNew, wasHeard = ns.Collection.IsNew(it.key), heard(it.key)
    b.name:SetText(esc(e.n))
    ink(b.name, INK)
    local kind = ns.Page.KindLabel(e.t)
    b.sub:SetText(esc(kind) .. (wasHeard and (ns.Lang.Dotted(" · ") .. L["heard"]) or ""))
    b.new:SetShown(isNew)
    b.tick:SetShown(wasHeard and not isNew)
    b.name:SetPoint("RIGHT", (isNew or wasHeard) and -40 or -8, 0)
    b.sub:SetPoint("RIGHT", ns.UI.SetQueueButton(b.add, it.key) and -28 or -8, 0)
  else
    b.add:Hide()
    b.name:SetText(blankLabel(it.kind))
    ink(b.name, FADED)
    b.sub:SetText("")
    b.new:Hide()
    b.tick:Hide()
    b.name:SetPoint("RIGHT", -8, 0)
  end
  b:Show()
end

function Book.RefreshPage()
  if not (Book.frame and Book.frame:IsShown()) then return end
  local ck = Book.chapter
  Book.sortButton:SetText(Book.byName and L["By name"] or L["In order found"])
  Book.sortButton:SetWidth(math.max(70, math.floor((T.TextWidth(Book.sortButton:GetFontString()) or 60) + 24)))
  Book.title:SetText(esc(Book.ChapterName(ck)))
  local tiles = Book.Tiles(ck, Book.state, Book.kind, Book.byName)
  -- Counts: the chapter's, and per kind (a search or New pages: what's listed).
  if ck == SEARCH or ck == NEW then
    Book.sub:SetText(string.format(#tiles == 1 and L["%d page"] or L["%d pages"], #tiles))
    Book.kinds:SetText("")
  else
    local n = Book.Count(ck)
    Book.sub:SetText(string.format(L["%d of %d pages found"], n.found, n.total)
      .. (n.heard > 0 and (ns.Lang.Dotted(" · ") .. string.format(L["%d heard"], n.heard)) or ""))
    local parts = {}
    for _, kind in ipairs({ "places", "people", "items", "quests", "topics" }) do
      local kc = n.kinds[kind]
      if kc then parts[#parts + 1] = string.format(L["%s %d of %d"], kindLabel(kind), kc.found, kc.total) end
    end
    Book.kinds:SetText(table.concat(parts, ns.Lang.Dotted(" · ")))
  end
  -- The chips, flowing onto a second line when the page is narrow.
  local width = math.max(200, (Book.chips:GetWidth() or 300))
  local x, y = 0, 0
  local function place(b)
    local w = b:GetWidth() or 40
    if x > 0 and x + w > width then x, y = 0, y - 24 end
    b:ClearAllPoints()
    b:SetPoint("TOPLEFT", x, y)
    x = x + w + 4
  end
  for _, s in ipairs(STATES) do
    setChip(Book.stateChips[s], stateLabel(s), Book.state == s)
    place(Book.stateChips[s])
  end
  x = x + 8
  for _, k in ipairs(KINDS) do
    local b = Book.kindChips[k]
    local show = ck ~= AZEROTH
    b:SetShown(show)
    if show then
      setChip(b, kindLabel(k), Book.kind == k)
      place(b)
    end
  end
  Book.chips:SetHeight(20 - y)
  -- The tiles, as many to a row as fit.
  local cw = math.max(TILE_W, (Book.scroll:GetWidth() or 300) - 4)
  local cols = math.max(1, math.floor((cw + GAP) / (TILE_W + GAP)))
  local tw = math.floor((cw - (cols - 1) * GAP) / cols)
  Book.content:SetWidth(cw)
  for i, it in ipairs(tiles) do
    local b = Book.tiles[i] or makeTile(i)
    b:SetWidth(tw)
    b:ClearAllPoints()
    local col, row = (i - 1) % cols, math.floor((i - 1) / cols)
    b:SetPoint("TOPLEFT", col * (tw + GAP), -row * (TILE_H + GAP))
    setTile(b, it)
  end
  for i = #tiles + 1, #Book.tiles do Book.tiles[i]:Hide() end
  local rows = math.ceil(#tiles / cols)
  Book.content:SetHeight(math.max(20, rows * (TILE_H + GAP)))
  local emptyText
  if #tiles == 0 then
    if ck == SEARCH then emptyText = ns.UI.NoMatchText(Book.search) .. " " .. L["Search reads only the pages you've found."]
    elseif ns.Collection.Counts() == 0 then
      emptyText = L["Your chronicle is still blank. Pages fill in as you travel, meet people, take quests and find things."]
    else emptyText = L["No pages like that here yet."] end
  end
  Book.empty:SetWidth(cw)
  Book.empty:SetText(emptyText or "")
  Book.empty:SetShown(emptyText ~= nil)
end

function Book.Refresh()
  Book.RefreshSide()
  Book.RefreshPage()
end

-- The chapter Found opens on: the one picked last, else where you are, else the first one.
local function defaultChapter()
  if Book.chapter and (Book.chapter == NEW or Book.chapter == SEARCH or Book.Index().chapters[Book.chapter]) then
    if Book.chapter ~= NEW or ns.Collection.NewCount() > 0 then return Book.chapter end
  end
  local rows = Book.Chapters()
  return rows[1] and rows[1].ck or hereChapter() or AZEROTH
end

function Book.ShowPage()
  if not Book.frame then return end
  Book.frame:Show()
  ns.Page.Hide()   -- after Found shows: closing a story's page brings Found back itself, and only when it's hidden
  Book.RefreshPage()
end

-- The Found bookmark was opened (UI.ShowTab).
function Book.Show()
  if not Book.frame then return end
  Book.chapter = defaultChapter()
  Book.RefreshSide()
  Book.ShowPage()
end

function Book.HidePage()
  if Book.frame then Book.frame:Hide() end
end

function Book.IsShown() return Book.frame and Book.frame:IsShown() or false end

-- A page found, opened or heard: the bookmark's count now, the lists a moment later (many can arrive at once).
local pending
function Book.Changed()
  Book.UpdateBadge()
  local UI = ns.UI
  if pending or not (UI.frame and UI.frame:IsShown() and UI.tab == "found") then return end
  pending = true
  C_Timer.After(0.3, function()
    pending = nil
    pcall(Book.Refresh)
  end)
end
