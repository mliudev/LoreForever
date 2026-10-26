-- The Found bookmark (v2 "Your Chronicle", slice 3, picture cards in the look's V2): the pages this character has
-- found, by chapter, in place of the Library. The left page lists the chapters (where you are first, then the zones
-- in the order you reached them, then "Of Azeroth" for the world's own stories), each with a found meter and a seal
-- once it's earned; the page over the conversation shows a chapter's pages as picture cards, a row for each kind of
-- page ("Places 14 of 21"). A card is the kind's icon: a green ring while the page is new, a green dot once heard, a
-- wax drop when a passage on it is sealed; one not found yet is blank (a dashed edge), so nothing is spoiled. A name
-- shows in the tooltip (and the line at the foot) on hover. Search reads only found pages, in every chapter.
-- Everywhere, above the chapters, is every page you've found. Filters in labelled rows (Kind, Pages, Story, and Rarity
-- for items) and a sort narrow what shows. Click opens a page, Shift-click adds it to the playlist, right-click gives
-- options.
-- The chapters are worked out the first time Found opens, not at login.

local _, ns = ...
local Book = {}
ns.Book = Book
local L, T = ns.L, ns.Theme

local AZEROTH, NEW, SEARCH, ALL = "*azeroth", "*new", "*search", "*all"
Book.ALL = ALL
-- Chapters that aren't zones: a storyline's quests you've found (Road.lua), { [ck] = { name, keys } }. Only found
-- pages are in them, and their counts never say how many the storyline has. NONE: an empty page (no storylines yet).
Book.extra = {}
Book.NONE = "*none"
local KIND = { zone = "places", city = "places", dungeon = "places", subzone = "places", npc = "people",
  item = "items", quest = "quests", topic = "topics" }
local KIND_ORDER = { places = 1, people = 2, items = 3, quests = 4, topics = 5 }
-- The filter rows, each a group of chips with one picked: { group, { values } }. Kind's "all" is every kind
-- (Book.kind nil); Lore is Of Azeroth's own pages. Rarity shows while Items is picked.
local FILTERS = {
  { "kind", { "all", "places", "people", "quests", "items", "topics" } },
  { "pages", { "all", "found", "blank", "new" } },
  { "story", { "any", "rec", "heard", "unheard" } },
  { "rarity", { "any", "2", "3", "4" } },
}
local SORTS = { "found", "name", "rarity" }   -- (Rarity for items only, last)
-- What a filter row and its chips say (read through L when shown: the language pack loads after this file).
local function rowLabel(group)
  return ({ kind = L["Kind"], pages = L["Pages"], story = L["Story"], rarity = L["Rarity"], sort = L["Sort"] })[group]
end
local function chipLabel(group, v)
  if group == "kind" then
    return ({ all = L["Everything"], places = L["Places"], people = L["People"], quests = L["Quests"], items = L["Items"],
      topics = L["Lore"] })[v]
  elseif group == "pages" then
    return ({ all = L["All"], found = L["Found"], blank = L["Not yet"], new = L["New"] })[v]
  elseif group == "story" then
    return ({ any = L["Any"], rec = L["Can listen"], heard = L["Heard"], unheard = L["Not heard"] })[v]
  elseif group == "rarity" then
    return ({ any = L["Any"], ["2"] = L["Uncommon+"], ["3"] = L["Rare+"], ["4"] = L["Epic"] })[v]
  end
  return ({ rarity = L["Rarity"], name = L["Name"], found = L["Order found"] })[v]
end
local TILE_SIZE, GAP, PAD, ROW_H = 36, 6, 16, 32
local HEAD_H, SECTION_GAP, EDGE = 18, 10, 3   -- a kind's heading, the space after its cards, room for a ring
local SEARCH_CAP = 200   -- tiles a search shows at most
-- The card's picture for each kind of page (Theme.lua's T.KIND_ICON): a topic is a book.
local TILE_KIND = { places = "place", people = "person", items = "item", quests = "quest", topics = "storyline" }

-- Parchment inks (as on a story's page): the book's own (Theme.lua).
local INK, ACCENT, NOTE = T.color.ink, T.color.inkAccent, T.color.inkNote
local CHIP, CHIP_ON = T.color.chipFill, T.color.chipOn

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

-- The game's item colours (grey poor, green uncommon, blue rare, purple epic, orange legendary, artifact, heirloom),
-- darkened so each reads on parchment: 4.5:1 or better against the page's darker patches (measured on the render; Page.lua's
-- own set is only 3.3:1 for the grey and green). Still the hue players read rarity from. nil for a common item, or none.
local RARITY = { [0] = { 0.25, 0.24, 0.22 }, [2] = { 0.02, 0.27, 0.02 }, [3] = { 0.00, 0.22, 0.52 },
  [4] = { 0.36, 0.08, 0.54 }, [5] = { 0.44, 0.16, 0.00 }, [6] = { 0.34, 0.24, 0.03 }, [7] = { 0.00, 0.28, 0.40 } }
function Book.RarityInk(key)
  local q = key and ns.Collection.Quality(key)
  return q and RARITY[q] or nil
end

-- A page's name on parchment. An item in one of the game's rarity colours keeps that hue (players read rarity from it),
-- in a parchment-dark tone, and gets a thin dark shadow on top (Software Architect, 10/24). Anything else is
-- `fallback` (an ink), with no shadow.
function Book.NameInk(fs, key, fallback)
  local c = Book.RarityInk(key)
  local ink = c or fallback or INK
  fs:SetTextColor(ink[1], ink[2], ink[3], 1)
  if fs.SetShadowColor then
    fs:SetShadowColor(0.06, 0.03, 0, c and 0.8 or 0)
    if c and fs.SetShadowOffset then fs:SetShadowOffset(1, -1) end
  end
  return fs
end

local function kindLabel(kind)
  return ({ places = L["Places"], people = L["People"], items = L["Items"], quests = L["Quests"],
    topics = L["Of Azeroth"] })[kind] or ""
end
Book.KindLabel = kindLabel   -- the page kind's plural ("People"), for the new-page slip (Slip.lua)
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
  if ck == ALL then return L["Everywhere"] end
  if ck == AZEROTH then return L["Of Azeroth"] end
  if ck == NEW then return L["New pages"] end
  if ck == SEARCH then return L["Search"] end
  if ck == Book.NONE then return L["Storylines"] end
  if Book.extra[ck] then return Book.extra[ck].name end
  local z = zones()[ck]
  return z and z.n or ck
end

-- One chapter's counts: { found, total, heard, first, kinds = { places = { found, total }, ... } }.
local function chapterKeys(ck)
  if ck ~= ALL then
    local c = Book.Index().chapters[ck]
    return c and c.keys or {}
  end
  local keys = {}
  for _, c in pairs(Book.Index().chapters) do
    for _, k in ipairs(c.keys) do keys[#keys + 1] = k end
  end
  return keys
end

function Book.Count(ck)
  local have, out = found(), { found = 0, total = 0, heard = 0, kinds = {} }
  for _, k in ipairs(chapterKeys(ck)) do
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

-- Which chapter a page belongs to, and the kind of card it is (its icon in Theme.lua).
function Book.ChapterOf(key)
  local e = entries()[key]
  return e and ((e.t ~= "topic" and e.z and zones()[e.z]) and e.z or AZEROTH) or nil
end
function Book.TileKind(t) return TILE_KIND[KIND[t]] end

-- "Westfall · People 9 of 20": where a page sits in your chronicle, for the new-page slip. nil for a page Found doesn't list.
function Book.Standing(key)
  local e = entries()[key]
  local kind = e and KIND[e.t]
  local ck = kind and Book.ChapterOf(key)
  if not ck then return nil end
  local n = Book.Count(ck)
  local kc = n.kinds[kind]
  local name = Book.ChapterName(ck)
  if not kc then return name end
  return name .. ns.Lang.Dotted(" · ") .. string.format(L["%s %d of %d"], kindLabel(kind), kc.found, kc.total)
end

-- Whether a passage on a found page is still sealed: it waits on a storyline you're on (what a card's wax drop says;
-- Page.lua shows the passage's seal the same way).
function Book.Sealed(key, done)
  local e = entries()[key]
  if not (e and e.sec and e.sec[1]) then return false end
  local s = LoreForeverDB and LoreForeverDB.settings
  if s and s.showSpoilers then return false end
  local engine = ns.UI.engine
  if not engine then return false end
  for _, sec in ipairs(e.sec) do
    if try(engine.Opens, engine, key, sec, done) == false then return true end
  end
  return false
end

local function hereChapter()
  local zone = ns.Context.Place().zone
  local zk = zone and ns.UI.engine and ns.UI.engine:ZoneKey(zone)
  return zk and Book.Index().chapters[zk] and zk or nil
end

-- The sidebar's rows: { ck, label, count, here }. Everywhere (every page you've found), where you are, then New pages
-- (when there are any), then the chapters you've found pages in, in the order you reached them, and Of Azeroth last.
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
  local every = Book.Count(ALL)
  if every.found > 0 then out[1] = { ck = ALL, label = L["Everywhere"], count = every } end
  if here then out[#out + 1] = { ck = here, label = Book.ChapterName(here), count = Book.Count(here), here = true } end
  local new = ns.Collection.NewCount()
  if new > 0 then out[#out + 1] = { ck = NEW, label = L["New pages"], new = new } end
  for _, row in ipairs(list) do out[#out + 1] = row end
  local az = Book.Count(AZEROTH)
  if az.found > 0 then out[#out + 1] = { ck = AZEROTH, label = L["Of Azeroth"], count = az } end
  return out
end

-- A chapter's tiles, as filtered and sorted: { key, kind, found = true/nil }. `f` is the filters ({ kind, pages,
-- story, rarity, sort }, Found's own when nil; an empty table is everything). Everywhere, New pages, a search and a
-- storyline list only found pages: a blank page belongs to its zone's chapter.
function Book.Tiles(ck, f)
  f = f or Book.Filters()
  local kindF, pages, storyF = f.kind, f.pages or "all", f.story or "any"
  local rarity, sort = tonumber(f.rarity), f.sort or "found"
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
  elseif Book.extra[ck] then
    keys = Book.extra[ck].keys
  else
    keys = chapterKeys(ck)
  end
  local blanks = ck ~= ALL and ck ~= NEW and ck ~= SEARCH and not Book.extra[ck]
  for _, k in ipairs(keys) do
    local e, s = db[k], have[k]
    local kind = e and KIND[e.t]
    local ok = kind and (not kindF or kindF == kind)
    if not blanks and (pages == "found" or pages == "blank") then pages = "all" end   -- (no chip for them here)
    if ok and not s then
      ok = blanks and (pages == "all" or pages == "blank") and storyF == "any" and not rarity
    elseif ok then
      if pages == "blank" then ok = false
      elseif pages == "new" then ok = ns.Collection.IsNew(k) end
      if ok and storyF == "rec" then ok = ns.UI.StoryAudio(k) and true or false
      elseif ok and storyF == "heard" then ok = heard(k)
      elseif ok and storyF == "unheard" then ok = not heard(k) end
      if ok and rarity then ok = (ns.Collection.Quality(k) or 1) >= rarity end
    end
    if ok then out[#out + 1] = { key = k, kind = kind, found = s and true or nil, t = s and foundTime(s) or 0 } end
  end
  local q = {}
  if sort == "rarity" then
    for _, it in ipairs(out) do q[it.key] = it.found and ns.Collection.Quality(it.key) or 1 end
  end
  table.sort(out, function(a, b)
    if (a.found or false) ~= (b.found or false) then return a.found or false end
    if not a.found then
      if a.kind ~= b.kind then return KIND_ORDER[a.kind] < KIND_ORDER[b.kind] end
      return a.key < b.key
    end
    if sort == "rarity" and q[a.key] ~= q[b.key] then return q[a.key] > q[b.key] end
    if sort ~= "name" and a.t ~= b.t then return a.t < b.t end
    local na, nb = db[a.key].n, db[b.key].n
    if na ~= nb then return na < nb end
    return a.key < b.key
  end)
  if ck == SEARCH and #out > SEARCH_CAP then
    for i = #out, SEARCH_CAP + 1, -1 do out[i] = nil end
  end
  return out
end

-- Found's filters now, as Book.Tiles reads them.
function Book.Filters()
  return { kind = Book.kind, pages = Book.pages, story = Book.story, rarity = Book.kind == "items" and Book.rarity or nil,
    sort = Book.sort }
end

-- What a chapter's green + adds: its found pages, places first, then people, items and quests, each in the order
-- found (what can't be played or is queued already is skipped by UI.QueueGroup).
function Book.QueueKeys(ck)
  local tiles = Book.Tiles(ck, {})
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
  end, sf, true)
  search:SetPoint("TOPLEFT", 12, -92)
  Book.search = search
  local note = T.Ink(view:CreateFontString(nil, "OVERLAY", T.font.small), "inkNote")
  note:SetPoint("BOTTOMLEFT", 16, UI.DOCK_H + 8)
  note:SetWidth(SIDE_W - 40)
  note:SetJustifyH("LEFT")
  if note.SetWordWrap then note:SetWordWrap(true) end
  note:SetText(L["Click a chapter to see its pages. Green + adds its stories to your playlist."])
  Book.sideScroll, Book.sideNote = sf, note
  Book.ClearHint(view, sf, note)
end

-- A list's hint at the foot of its page: it wraps (to three or four lines in some languages) and the list ends above it,
-- so the hint never runs into the list's scroll-down arrow. Works from the list's own view being shown, once its text is
-- set (Found's and the Road's and Storylines' lists all use it).
function Book.ClearHint(view, sf, note)
  if note.SetWordWrap then note:SetWordWrap(true) end
  note:SetWidth(ns.UI.SIDE_W - 40)
  local function layout()
    local h = tonumber(note:GetStringHeight()) or 0
    if h < 14 then h = 14 end
    sf:SetPoint("BOTTOMRIGHT", view, "BOTTOMLEFT", ns.UI.SIDE_W - 26, ns.UI.DOCK_H + 8 + math.ceil(h) + 8)
  end
  sf.layoutHint = layout
  local setText = note.SetText   -- a new text (its length) moves the list's foot with it
  note.SetText = function(self, ...) setText(self, ...); layout() end
  layout()
  if view.HookScript then view:HookScript("OnShow", layout) end
end

-- A zone's row on the left page: its name and "found/total", a found meter under them, and a seal for each earned
-- (gold: every place found; wax: every story heard, as Road.Seals counts them). The page you're on is marked and first.
local function sideRow(i)
  local UI = ns.UI
  local row = Book.sideRows[i]
  if row then return row end
  row = UI.TextButton(Book.sideContent, UI.SIDE_W - 40, ROW_H, T.font.small, nil, true)
  row.text:ClearAllPoints()
  row.text:SetPoint("TOPLEFT", 6, -3)
  row.text:SetPoint("TOPRIGHT", -78, -3)
  row.text:SetJustifyV("TOP")
  if row.text.SetWordWrap then row.text:SetWordWrap(false) end
  local count = T.Ink(row:CreateFontString(nil, "OVERLAY", T.font.small), "inkNote")
  count:SetPoint("TOPRIGHT", -28, -3)
  count:SetJustifyH("RIGHT")
  row.count = count
  row.sel = T.Area(row, "inkSelect")
  row.sel:SetAllPoints()
  row.mark = T.TargetMark(row, true)
  row.meter = T.Meter(row, "found")
  row.meter:SetHeight(6)
  row.meter:SetPoint("BOTTOMLEFT", 6, 5)
  row.meter:SetPoint("BOTTOMRIGHT", -58, 5)
  row.gilt = T.Seal(row, "gilt", 12)
  row.gilt:SetPoint("BOTTOMRIGHT", -40, 3)
  row.wax = T.Seal(row, "wax", 12)
  row.wax:SetPoint("BOTTOMRIGHT", -26, 3)
  row.newBg = T.Area(row, "newMark", "ARTWORK")
  row.newBg:SetHeight(14)
  row.newBg:SetPoint("CENTER", count, "CENTER", 0, 0)
  row.newBg:Hide()
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
    Book.backTo = nil
    if Book.backButton then Book.backButton:Hide() end
    Book.Refresh()
    Book.ShowPage()
  end)
  row:SetScript("OnEnter", function(self)
    if not self.c then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(esc(self.label))
    T.Tip(string.format(L["%d of %d pages found"], self.c.found, self.c.total), "tipText")
    if self.c.heard > 0 then T.Tip(string.format(L["%d heard"], self.c.heard), "tipGood") end
    local s = self.seals
    if s then   -- the two seals, as the Road spells them out
      T.Tip(string.format(L["Every place found: %d of %d"], s.places.found, s.places.total),
        s.places.done and "tipGood" or "tipText")
      T.Tip(string.format(L["Every story heard: %d of %d"], s.stories.heard, s.stories.total),
        s.stories.done and "tipGood" or "tipText")
    end
    if self.here then T.Tip(L["You are here"], "tipDim") end
    GameTooltip:Show()
  end)
  row:SetScript("OnLeave", function() GameTooltip:Hide() end)
  Book.sideRows[i] = row
  return row
end

function Book.RefreshSide()
  if not Book.sideContent then return end
  if Book.sideScroll then Book.sideScroll.layoutHint() end
  local rows, y = Book.Chapters(), 0
  for i, it in ipairs(rows) do
    local row = sideRow(i)
    row:ClearAllPoints()
    row:SetPoint("TOPLEFT", 0, -y)
    row.ck, row.label, row.c, row.here = it.ck, it.label, it.count, it.here
    row.all.ck, row.all.label = it.ck, it.label
    local h = ROW_H
    if it.new then
      h = 22
      row.seals = nil
      row.text:SetText(T.code.ink .. esc(it.label) .. "|r")
      row.count:SetText(it.new)
      row.count:SetTextColor(T.rgba(T.color.newMarkText))
      row.newBg:SetWidth(math.max(16, math.ceil((T.TextWidth(row.count) or 8) + 10)))
      row.newBg:Show()
      row.all:Hide()
      row.meter:Hide()
      row.gilt:Hide()
      row.wax:Hide()
    else
      local n = it.count
      local seals = ns.Road and try(ns.Road.Seals, it.ck)   -- (Road.lua: the zone's gold and wax seals)
      row.seals = seals
      row.text:SetText(T.code.ink .. esc(it.label) .. "|r")
      row.count:SetText(n.found .. "/" .. n.total)
      row.count:SetTextColor(T.rgba(NOTE))
      row.newBg:Hide()
      row.all:Show()
      row.meter:Show()
      row.meter:SetProgress(n.found, n.total)
      row.gilt:SetShown(seals and seals.places.done or false)
      row.wax:SetShown(seals and seals.stories.done or false)
    end
    row:SetHeight(h)
    row.sel:SetShown(it.ck == Book.chapter)
    T.ShowMark(row.mark, it.here)
    row:Show()
    y = y + h + 2
  end
  for i = #rows + 1, #Book.sideRows do Book.sideRows[i]:Hide() end
  Book.sideContent:SetHeight(math.max(10, y))
  Book.UpdateBadge()
end

-- The count of new pages on the Found bookmark: a gilt pill on the tab's top right corner (its own fill, so it reads
-- on the parchment and on the dark frame behind it).
function Book.UpdateBadge()
  local badge = Book.badge
  if not badge then return end
  local n = ns.Collection.NewCount()
  if ns.SetButtonNew then ns.SetButtonNew(n) end   -- the minimap book glows while there are new pages (Core.lua)
  badge:SetText(n > 0 and (n > 99 and "99+" or tostring(n)) or "")
  badge:SetShown(n > 0)
  if badge.bg then
    badge.bg:SetShown(n > 0)
    badge.bg:SetWidth(math.max(14, math.ceil((T.TextWidth(badge) or 6) + 8)))
  end
end

function Book.CreateBadge(tab)
  local bg = T.Area(tab, "newMark", "ARTWORK")
  bg:SetHeight(14)
  bg:SetPoint("TOPRIGHT", tab, "TOPRIGHT", 5, 8)
  bg:Hide()
  local fs = tab:CreateFontString(nil, "OVERLAY", T.font.label)
  fs:SetTextColor(T.rgba(T.color.newMarkText))
  fs:SetPoint("CENTER", bg, "CENTER", 0, 0)
  fs:Hide()
  fs.bg = bg
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
  p:SetPoint("BOTTOMRIGHT", -UI.BOOK_R, UI.DOCK_H)
  p:SetFrameLevel((f:GetFrameLevel() or 1) + 18)   -- a story's page opens over it (+20) and hides it; closing the story shows it again (Page.lua)
  p:EnableMouse(true)
  T.Parchment(p, "right")
  T.CoverChat(p)
  p:Hide()
  Book.frame = p
  Book.kind, Book.pages, Book.story, Book.rarity, Book.sort = nil, "all", "any", "any", "found"

  -- After a jump from another bookmark (a Road count, a page's storyline): a gold "‹ Back to ..." at the top right,
  -- the sort to its left (Book.SetBackTo).
  local back = T.Button(p, "", "primary")
  back:SetHeight(22)
  back:SetPoint("TOPRIGHT", -8, -8)
  back:SetScript("OnClick", function() Book.GoBack() end)
  back:Hide()
  Book.backButton = back

  -- Storylines: "Listen to the story so far" over the list of its quests you've taken (Book.RefreshStoryline).
  Book.storyRows = {}

  -- Sort: small chips at the title's right ("Sort  Name  Order found", Rarity first while Items is picked).
  Book.sortChips = {}
  for _, v in ipairs(SORTS) do
    Book.sortChips[v] = chip(p, function() Book.sort = v; Book.RefreshPage() end)
  end
  Book.sortLabel = ink(p:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
  Book.sortLabel:SetPoint("TOPRIGHT", -8, -14)   -- (the title ends at it: placed before the first layout, and in Storylines)

  -- Play these: the found pages listed (as filtered) join the playlist and it plays from the first of them. Play
  -- what's new: the same for every New page. Shown when there's something to play, after the filters (made with
  -- them, below).
  local function playButton(label, tip, keysOf)
    local b = T.Button(Book.chips, label, "primary")
    b:SetHeight(22)
    b:SetWidth(math.max(70, math.floor((T.TextWidth(b:GetFontString()) or 60) + 24)))
    b:SetScript("OnClick", function() Book.Play(keysOf()) end)
    b:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
      GameTooltip:AddLine(label)
      T.Tip(tip, "tipDim", true)
      GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function() GameTooltip:Hide() end)
    return b
  end

  local title = ink(p:CreateFontString(nil, "OVERLAY", "QuestTitleFont"), ACCENT)
  title:SetPoint("TOPLEFT", PAD, -12)
  title:SetPoint("RIGHT", Book.sortLabel, "LEFT", -8, 0)
  if title.SetWordWrap then title:SetWordWrap(false) end
  Book.title = title
  local sub = ink(p:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
  sub:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -4)
  sub:SetPoint("RIGHT", p, "RIGHT", -PAD, 0)
  Book.sub = sub

  -- Filters: a labelled row for each, one chip picked in each row.
  local chips = CreateFrame("Frame", nil, p)
  chips:SetPoint("TOPLEFT", sub, "BOTTOMLEFT", 0, -8)
  chips:SetPoint("RIGHT", p, "RIGHT", -PAD, 0)
  chips:SetHeight(20)
  Book.chips, Book.filterChips, Book.filterLabels = chips, {}, {}
  for _, row in ipairs(FILTERS) do
    local group = row[1]
    Book.filterLabels[group] = ink(chips:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
    Book.filterChips[group] = {}
    for _, v in ipairs(row[2]) do
      Book.filterChips[group][v] = chip(chips, function() Book.SetFilter(group, v) end)
    end
  end
  Book.playThese = playButton(L["Play these"], L["Adds the found pages listed here to your playlist and plays them."],
    function() return Book.ListedKeys(), Book.ChapterName(Book.chapter) end)
  Book.playNew = playButton(L["Play what's new"], L["Adds every new page to your playlist and plays them."],
    function() return ns.Collection.NewKeys(), L["New pages"] end)
  Book.playStory = playButton(L["Listen to the story so far"],
    L["Adds the quests of it you've taken to your playlist, in the order you took them, and plays them."],
    function() return Book.StoryKeys(true), Book.ChapterName(Book.chapter) end)

  local sf = CreateFrame("ScrollFrame", nil, p, "UIPanelScrollFrameTemplate")
  sf:SetPoint("TOPLEFT", chips, "BOTTOMLEFT", 0, -8)
  sf:SetPoint("BOTTOMRIGHT", -30, 30)   -- clear of the window's resize corner and the line at the foot
  local content = CreateFrame("Frame", nil, sf)
  content:SetSize(300, 100)
  sf:SetScrollChild(content)
  Book.scroll, Book.content, Book.tiles, Book.heads = sf, content, {}, {}
  sf:HookScript("OnVerticalScroll", function() Book.UpdateFigures() end)
  -- The line at the foot of the page: how to read the cards, and the name of the card under the mouse.
  local foot = ink(p:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
  foot:SetPoint("BOTTOMLEFT", PAD, 10)
  foot:SetPoint("RIGHT", p, "RIGHT", -44, 0)
  if foot.SetWordWrap then foot:SetWordWrap(false) end
  foot:SetText(L["Hover a page for its name. A blank page is still out there."])
  Book.foot = foot
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
        if Book.OnTab() and not p:IsShown() then p:Show(); Book.RefreshPage() end
      end)
    end
  end
  ns.Collection.OnFound(function() Book.Changed() end)
  return p
end

-- A page's options (right-click on a tile or the new-page slip): open it, listen, add to or take out of the playlist,
-- then `extra` ({ label, fn } rows), and ask about it in Here. On UIParent in the dialog layer, so it works with the panel closed too.
function Book.PageMenu(anchor, key, via, extra)
  local UI = ns.UI
  local m = Book.menu
  if not m then
    m = T.Backdrop(CreateFrame("Frame", nil, UIParent, T.BACKDROP_TEMPLATE), "popup")
    m:SetFrameStrata("DIALOG")
    m:SetSize(190, 6 * 22 + 12)
    m.items = {}
    for i = 1, 6 do
      local b = UI.TextButton(m, 178, 22, T.font.small)
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
  local list = {}
  list[#list + 1] = { L["Open the page"], function() ns.Page.Show(key, via) end }
  if UI.StoryAudio(key) then list[#list + 1] = { L["Listen"], function() UI.PlayEntry(key) end } end
  if UI.CanQueue(key) then
    local action = UI.QueueAction(key)
    list[#list + 1] = { action == "add" and L["Add to playlist"] or (action == "stop" and L["Stop narration"])
      or L["Remove from playlist"], function() UI.DoQueueAction(key) end }
  end
  for _, it in ipairs(extra or {}) do list[#list + 1] = it end
  list[#list + 1] = { L["Ask about it in Here"], function() UI.AskInHere(key) end }
  for i, b in ipairs(m.items) do
    local it = list[i]
    b:SetShown(it ~= nil)
    if it then b.text:SetText(it[1]); b.run = it[2] end
  end
  m:SetHeight(#list * 22 + 12)
  m:ClearAllPoints()
  m:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 8, 4)
  m.away = 0
  m:Show()
end

-- The line at the foot of the page: how to read the cards, or (the mouse over a found one) its name, as the tooltip
-- gives it but at once and in the rarity colour (an item's, on parchment: Book.NameInk keeps it readable).
local function footHint(key)
  local foot = Book.foot
  if not foot then return end
  local e = key and entries()[key]
  if e then
    foot:SetText(esc(e.n) .. ns.Lang.Dotted(" · ") .. esc(ns.Page.KindLabel(e.t)))
    Book.NameInk(foot, key, INK)
  else
    foot:SetText(L["Hover a page for its name. A blank page is still out there."])
    Book.NameInk(foot, nil, NOTE)
  end
end

-- A card: the kind's picture, in the state of its page. Click opens the page, Shift-click adds it to the playlist,
-- right-click gives options; hovering names it. A card for a page not found yet is blank, and only says what kind of
-- page it is and how it is found.
local function makeTile(i)
  local UI = ns.UI
  local b = T.Tile(Book.content, "place")
  b:SetSize(TILE_SIZE, TILE_SIZE)
  b:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  -- In your playlist: a small green square at the top left (a ring, a dot, a drop and a dashed edge say the rest).
  -- (On the card's top frame: a person's figure is a frame of its own and draws over the card's textures.)
  b.queuedRim = b.over:CreateTexture(nil, "OVERLAY", nil, 1)
  b.queuedRim:SetSize(9, 9)
  b.queuedRim:SetPoint("TOPLEFT", 2, -2)
  T.Fill(b.queuedRim, "dotRim")
  b.queued = b.over:CreateTexture(nil, "OVERLAY", nil, 2)
  b.queued:SetSize(7, 7)
  b.queued:SetPoint("TOPLEFT", 3, -3)
  T.Fill(b.queued, "add")
  b.rarityEdge = T.Outline(b, "inkRim", "OVERLAY", 3)
  b.rarityEdge:SetShown(false)
  b:SetScript("OnClick", function(self, button)
    if not self.found then return end
    if button == "RightButton" then return Book.PageMenu(self, self.key, "found") end
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
      local e = entries()[self.key]
      GameTooltip:AddLine(esc(e.n))
      T.Tip(ns.Page.KindLabel(e.t), "tipText")
      local rec = ns.Collection.Found(self.key)
      if rec and rec.place then T.Tip(string.format(L["Found at %s."], esc(rec.place)), "tipText") end
      if heard(self.key) then T.Tip(L["You've heard this."], "tipGood") end
      if self.state and self.state.sealed then
        T.Tip(L["A passage here opens further along a storyline you're on."], "tipDim", true)
      end
      T.Tip(L["Click: open its page. Shift-click: add to your playlist. Right-click: options."], "tipDim", true)
      footHint(self.key)
    end
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide(); footHint(nil) end)
  Book.tiles[i] = b
  return b
end

local function setTile(b, it, done)
  b:SetKind(TILE_KIND[it.kind])   -- (sets b.kind to the picture's kind: the page's kind, "people", goes after it)
  b.key, b.kind, b.found = it.key, it.kind, it.found
  if it.found then
    b:SetState({ new = ns.Collection.IsNew(it.key), heard = heard(it.key), sealed = Book.Sealed(it.key, done) })
    -- An item's rarity colours its edge, 3px (as well as its name, in the tooltip and at the foot).
    local c = Book.RarityInk(it.key)
    b.edge:SetColor("inkRim")
    if c then b.rarityEdge:SetColor({ c[1] * 0.85, c[2] * 0.85, c[3] * 0.85, 1 }) end
    b.rarityEdge:SetShown(c ~= nil)
    local queued = ns.UI.PlaylistIndex(it.key) ~= nil
    b.queued:SetShown(queued)
    b.queuedRim:SetShown(queued)
  else
    b:SetState("blank")
    b.rarityEdge:SetShown(false)
    b.queued:Hide()
    b.queuedRim:Hide()
  end
  b:Show()
end

local function makeHead(i)
  local fs = ink(Book.content:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
  if fs.SetWordWrap then fs:SetWordWrap(false) end
  Book.heads[i] = fs
  return fs
end

local KIND_LIST = { "places", "people", "items", "quests", "topics" }

-- The creature display id of a person's page (Looks.lua), or nil: their card keeps the drawn figure.
function Book.Look(key)
  local looks = ns.NPC_LOOK
  return looks and looks[key] or nil
end

-- A person's card stands them up (the whole body, in a model) while it is wholly in view: a model costs, and a card
-- cut off by the edge of the scrolling list would draw it over the edge. Run after the cards are laid out and as the
-- list scrolls.
function Book.UpdateFigures()
  local sf = Book.scroll
  if not (sf and Book.frame and Book.frame:IsShown()) then return end
  local top = tonumber(sf:GetVerticalScroll()) or 0
  local height = tonumber(sf:GetHeight()) or 0
  local bottom = height > 0 and top + height or math.huge
  for _, b in ipairs(Book.tiles) do
    if b:IsShown() and b.kind == "people" and b.found and b.y then
      b:SetFigure((b.y >= top and b.y + TILE_SIZE <= bottom) and Book.Look(b.key) or nil)
    else
      b:SetFigure(nil)
    end
  end
end

-- Pick `value` in a filter row. Rarity sorts and filters items only: leaving Items leaves them.
function Book.SetFilter(group, value)
  if group == "kind" then
    Book.kind = value ~= "all" and value or nil
    if Book.kind ~= "items" and Book.sort == "rarity" then Book.sort = "found" end
  else
    Book[group] = value
  end
  Book.RefreshPage()
end

-- The kinds of page a chapter has (its Kind row offers only those).
local function kindsIn(ck)
  local out = {}
  for _, t in ipairs(Book.Tiles(ck, {})) do out[t.kind] = true end
  return out
end

-- The filter rows and the sort, laid out for the chapter: a row's label, then its chips, flowing on when narrow.
local function layoutFilters(ck)
  local width = math.max(200, (Book.chips:GetWidth() or 300))
  local plainList = ck == NEW or ck == SEARCH or ck == ALL or Book.extra[ck] or ck == Book.NONE
  local storyline = Book.extra[ck] or ck == Book.NONE
  local present = kindsIn(ck)
  local labelW = 0
  for _, row in ipairs(FILTERS) do
    local fs = Book.filterLabels[row[1]]
    fs:SetText(rowLabel(row[1]))
    labelW = math.max(labelW, math.ceil(T.TextWidth(fs) or 40))
  end
  labelW = labelW + 10
  local x, y = 0, 0
  for _, row in ipairs(FILTERS) do
    local group, fs = row[1], Book.filterLabels[row[1]]
    local show = not (group == "kind" and storyline) and not (group == "rarity" and Book.kind ~= "items")
    fs:SetShown(show)
    local picked = group == "kind" and (Book.kind or "all") or Book[group]
    if group == "pages" and plainList and (picked == "found" or picked == "blank") then picked = "all" end
    for _, v in ipairs(row[2]) do
      local b = Book.filterChips[group][v]
      local on = show
      if on and group == "kind" and v ~= "all" then on = present[v] or Book.kind == v end
      if on and group == "pages" and (v == "blank" or v == "found") then on = not plainList end
      b:SetShown(on and true or false)
    end
    if show then
      if x > 0 or y < 0 then y = y - 24 end
      x = 0
      fs:ClearAllPoints()
      fs:SetPoint("TOPLEFT", 0, y - 4)
      x = labelW
      for _, v in ipairs(row[2]) do
        local b = Book.filterChips[group][v]
        if b:IsShown() then
          setChip(b, chipLabel(group, v), picked == v)
          local w = b:GetWidth() or 40
          if x > labelW and x + w > width then x, y = labelW, y - 24 end
          b:ClearAllPoints()
          b:SetPoint("TOPLEFT", x, y)
          x = x + w + 4
        end
      end
    end
  end
  -- Play these / Play what's new, on a line of their own under the filters.
  local px, any = 0, false
  for _, b in ipairs({ Book.playThese, Book.playNew }) do
    if b:IsShown() then
      if not any then y = y - 26; any = true end
      b:ClearAllPoints()
      b:SetPoint("TOPLEFT", px, y)
      px = px + (b:GetWidth() or 80) + 6
    end
  end
  Book.chips:SetHeight(22 - y)
  -- The sort chips, left to right, ending at the page's top right corner (left of a Back there) with room for every
  -- one of them, so Rarity appearing for items moves nothing; their label before them.
  local right = -8
  if Book.backButton:IsShown() then right = right - (Book.backButton:GetWidth() or 120) - 8 end
  local total = 0
  for _, v in ipairs(SORTS) do
    setChip(Book.sortChips[v], chipLabel("sort", v), Book.sort == v)
    total = total + (Book.sortChips[v]:GetWidth() or 40) + 4
  end
  local sx = right - total + 4
  for _, v in ipairs(SORTS) do
    local b = Book.sortChips[v]
    local show = v ~= "rarity" or Book.kind == "items"
    b:SetShown(show)
    b:ClearAllPoints()
    b:SetPoint("TOPLEFT", Book.frame, "TOPRIGHT", sx, -10)
    sx = sx + (b:GetWidth() or 40) + 4
  end
  Book.sortLabel:SetText(rowLabel("sort"))
  Book.sortLabel:ClearAllPoints()
  Book.sortLabel:SetPoint("TOPRIGHT", Book.frame, "TOPRIGHT", right - total - 2, -14)
end

-- Where a jump from another bookmark goes back to: { tab, label, page = a page's Snapshot to open there } or nil.
-- Cleared by any move to another bookmark or chapter (UI.ShowTab, a chapter's row).
function Book.SetBackTo(to)
  Book.backTo = to
  local b = Book.backButton
  if b then
    b:SetShown(to ~= nil)
    if to then
      b:SetText("\226\128\185 " .. to.label)
      b:SetWidth(math.max(70, math.floor((T.TextWidth(b:GetFontString()) or 100) + 24)))
    end
  end
  Book.RefreshPage()
end

function Book.GoBack()
  local to = Book.backTo
  if not to then return end
  Book.SetBackTo(nil)
  if to.tab then ns.UI.ShowTab(to.tab) end
  if to.page then ns.Page.Restore(to.page) end
end

-- A storyline's quests you've taken, in the order you took them (`playable`: only those that can play).
function Book.StoryKeys(playable)
  local x = Book.extra[Book.chapter]
  local have, out = found(), {}
  for _, k in ipairs(x and x.keys or {}) do
    if not playable or ns.UI.CanQueue(k) then out[#out + 1] = k end
  end
  table.sort(out, function(a, b)
    local ta, tb = foundTime(have[a]), foundTime(have[b])
    if ta ~= tb then return ta < tb end
    return a < b
  end)
  return out
end

-- Where a quest of the storyline stands for you: done, or in your quest log; nil for one taken and left (saying
-- more would hint at how the story goes, Design Lead 10/25).
local function questState(key, done, inLog)
  local e = entries()[key]
  local qid = e and e.m and tonumber(e.m.id)
  if qid and done and done[qid] then return L["Done"] end
  if qid and inLog[qid] then return L["In your quest log"] end
  return nil
end

local function storyRow(i)
  local UI = ns.UI
  local r = Book.storyRows[i]
  if r then return r end
  r = UI.TextButton(Book.content, 300, 42, T.font.body, nil, true)
  r:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  r.tile = T.Tile(r, "quest")
  r.tile:SetSize(30, 30)
  r.tile:SetPoint("LEFT", 4, 0)
  r.tile:EnableMouse(false)
  r.text:ClearAllPoints()
  r.text:SetPoint("TOPLEFT", 44, -5)
  r.text:SetPoint("RIGHT", -90, 0)
  if r.text.SetWordWrap then r.text:SetWordWrap(false) end
  r.sub = ink(r:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
  r.sub:SetPoint("TOPLEFT", 44, -23)
  r.sub:SetPoint("RIGHT", -90, 0)
  if r.sub.SetWordWrap then r.sub:SetWordWrap(false) end
  r.listen = T.Button(r, L["Listen"])
  r.listen:SetHeight(22)
  r.listen:SetWidth(math.max(70, math.floor((T.TextWidth(r.listen:GetFontString()) or 50) + 24)))
  r.listen:SetPoint("RIGHT", -4, 0)
  r.listen:SetScript("OnClick", function(self)
    if IsShiftKeyDown and IsShiftKeyDown() then return UI.DoQueueAction(self.key) end
    UI.PlayEntry(self.key)
  end)
  -- Click opens its page (Back comes back to this list), Shift-click adds it to the playlist, right-click: options.
  r:SetScript("OnClick", function(self, button)
    if button == "RightButton" then return Book.PageMenu(self, self.key, "found") end
    if IsShiftKeyDown and IsShiftKeyDown() then
      if UI.CanQueue(self.key) then UI.DoQueueAction(self.key) end
      return
    end
    ns.Page.Show(self.key, "found")
    ns.Page.SetBackTo("storyline")
  end)
  r:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(esc(entries()[self.key].n))
    T.Tip(L["Click: open its page. Shift-click: add to your playlist. Right-click: options."], "tipDim", true)
    GameTooltip:Show()
  end)
  r:SetScript("OnLeave", function() GameTooltip:Hide() end)
  Book.storyRows[i] = r
  return r
end

-- A storyline on Found's page (the Storylines bookmark): its quests you've taken as a named list, in the order you
-- took them, each with where it stands and a Listen; "Listen to the story so far" over it. It never says how many
-- quests the storyline has or which step one is (Storyline.lua's rule).
local function refreshStoryline(ck)
  for _, b in ipairs(Book.tiles) do b:Hide() end
  for _, h in ipairs(Book.heads) do h:Hide() end
  for _, row in ipairs(FILTERS) do
    Book.filterLabels[row[1]]:Hide()
    for _, b in pairs(Book.filterChips[row[1]]) do b:Hide() end
  end
  for _, b in pairs(Book.sortChips) do b:Hide() end
  Book.sortLabel:SetText("")
  Book.playThese:Hide()
  Book.playNew:Hide()
  local keys = ck ~= Book.NONE and Book.StoryKeys() or {}
  Book.listed = {}
  for i, k in ipairs(keys) do Book.listed[i] = { key = k, kind = "quests", found = true } end
  Book.sub:SetText(#keys > 0 and L["Quests you take from this story are written here, in order."] or "")
  local playable = #Book.StoryKeys(true) > 0
  Book.playStory:SetShown(playable)
  if playable then
    Book.playStory:ClearAllPoints()
    Book.playStory:SetPoint("TOPLEFT", 0, 0)
  end
  Book.chips:SetHeight(playable and 24 or 1)
  local cw = math.max(200, (Book.scroll:GetWidth() or 300) - 4)
  Book.content:SetWidth(cw)
  local done = try(ns.Context.Done)
  local inLog = {}
  for _, q in ipairs(try(ns.Context.Quests) or {}) do if q.id then inLog[q.id] = true end end
  local y = 0
  for i, k in ipairs(keys) do
    local e = entries()[k]
    local r = storyRow(i)
    r.key, r.listen.key = k, k
    r:SetWidth(cw)
    r:ClearAllPoints()
    r:SetPoint("TOPLEFT", 0, -y)
    r.tile:SetKind("quest")
    r.tile:SetState({ new = ns.Collection.IsNew(k), heard = heard(k) })
    r.text:SetText(T.code.inkAccent .. esc(e.n) .. "|r")
    local z = e.z and zones()[e.z]
    local state = questState(k, done, inLog)
    r.sub:SetText(table.concat({ z and esc(z.n) or nil, state }, ns.Lang.Dotted(" · ")))
    r.listen:SetShown(ns.UI.StoryAudio(k) and true or false)
    r:Show()
    y = y + 46
  end
  for i = #keys + 1, #Book.storyRows do Book.storyRows[i]:Hide() end
  Book.content:SetHeight(math.max(20, y))
  Book.foot:SetText("")   -- (the line under the title says how the list reads)
  local emptyText = ck == Book.NONE and L["No storylines yet. Take quests, and the storylines you're on are listed here."] or nil
  Book.empty:SetWidth(cw)
  Book.empty:SetText(emptyText or "")
  Book.empty:SetShown(emptyText ~= nil)
end

function Book.RefreshPage()
  if not (Book.frame and Book.frame:IsShown()) then return end
  local ck = Book.chapter
  Book.title:SetText(esc(Book.ChapterName(ck)))
  local storyline = Book.extra[ck] or ck == Book.NONE
  Book.playStory:SetShown(false)
  if storyline then return refreshStoryline(ck) end
  for _, r in ipairs(Book.storyRows) do r:Hide() end
  footHint(nil)
  local tiles = Book.Tiles(ck)
  Book.listed = tiles
  local playable = false
  for _, t in ipairs(tiles) do
    if t.found and ns.UI.CanQueue(t.key) then playable = true; break end
  end
  Book.playThese:SetShown(playable)
  local newOnes = ck ~= NEW and ns.Collection.NewCount() > 0
  Book.playNew:SetShown(newOnes)
  -- Counts: the chapter's here, and per kind above each row of cards (a search, New pages or a storyline: what's
  -- listed, since a storyline never says how many pages it has).
  local plain = ck == SEARCH or ck == NEW or ck == Book.NONE or Book.extra[ck]
  local counts
  if plain then
    Book.sub:SetText(string.format(#tiles == 1 and L["%d page"] or L["%d pages"], #tiles))
  else
    counts = Book.Count(ck)
    Book.sub:SetText(string.format(L["%d of %d pages found"], counts.found, counts.total)
      .. (counts.heard > 0 and (ns.Lang.Dotted(" · ") .. string.format(L["%d heard"], counts.heard)) or ""))
  end
  layoutFilters(ck)
  -- The cards, a row for each kind of page and as many to a line as fit.
  local cw = math.max(TILE_SIZE + 2 * EDGE, (Book.scroll:GetWidth() or 300) - 4)
  local cols = math.max(1, math.floor((cw - 2 * EDGE + GAP) / (TILE_SIZE + GAP)))
  Book.content:SetWidth(cw)
  local groups = {}
  for _, it in ipairs(tiles) do
    local g = groups[it.kind]
    if not g then g = {}; groups[it.kind] = g end
    g[#g + 1] = it
  end
  local done = try(ns.Context.Done)
  local top, ti, hi = 0, 0, 0
  for _, kind in ipairs(KIND_LIST) do
    local g = groups[kind]
    if g then
      hi = hi + 1
      local head = Book.heads[hi] or makeHead(hi)
      head:ClearAllPoints()
      head:SetPoint("TOPLEFT", EDGE, -top)
      head:SetWidth(cw - EDGE)
      local kc = counts and counts.kinds[kind]
      head:SetText(kc and string.format(L["%s %d of %d"], kindLabel(kind), kc.found, kc.total)
        or (kindLabel(kind) .. " " .. #g))
      head:Show()
      top = top + HEAD_H
      for j, it in ipairs(g) do
        ti = ti + 1
        local b = Book.tiles[ti] or makeTile(ti)
        local col, row = (j - 1) % cols, math.floor((j - 1) / cols)
        b.y = top + EDGE + row * (TILE_SIZE + GAP)
        b:ClearAllPoints()
        b:SetPoint("TOPLEFT", EDGE + col * (TILE_SIZE + GAP), -b.y)
        setTile(b, it, done)
      end
      top = top + EDGE * 2 + math.ceil(#g / cols) * (TILE_SIZE + GAP) - GAP + SECTION_GAP
    end
  end
  for i = ti + 1, #Book.tiles do Book.tiles[i]:Hide() end
  for i = hi + 1, #Book.heads do Book.heads[i]:Hide() end
  Book.content:SetHeight(math.max(20, top))
  Book.UpdateFigures()
  local emptyText
  if #tiles == 0 then
    if ck == SEARCH then emptyText = ns.UI.NoMatchText(Book.search) .. " " .. L["Search reads only the pages you've found."]
    elseif ck == Book.NONE then
      emptyText = L["No storylines yet. Take quests, and the storylines you're on are listed here."]
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
  local ck = Book.chapter
  if ck and (ck == NEW or ck == SEARCH or ck == ALL or Book.Index().chapters[ck]) then
    if ck ~= NEW or ns.Collection.NewCount() > 0 then return ck end
  end
  local here = hereChapter()
  if here then return here end
  for _, row in ipairs(Book.Chapters()) do
    if row.ck ~= ALL then return row.ck end
  end
  return AZEROTH
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

-- The found pages Found lists now, in its order.
function Book.ListedKeys()
  local out = {}
  for _, t in ipairs(Book.listed or {}) do if t.found then out[#out + 1] = t.key end end
  return out
end

-- Play these / Play what's new: `keys` join the playlist (what's there already stays where it is) and, unless it's
-- playing, it plays from the first of them.
function Book.Play(keys, label)
  local UI = ns.UI
  UI.QueueGroup(keys, label, true)
  local first
  for _, k in ipairs(keys or {}) do
    local i = UI.PlaylistIndex(k)
    if i and (not first or i < first) then first = i end
  end
  if first and UI.pl.state ~= "playing" then UI.PlaylistJump(first) end
  return first ~= nil
end

-- Whether the bookmark picked shows this page: Found, or Storylines (a storyline's quests, Road.lua).
function Book.OnTab()
  local tab = ns.UI.tab
  return tab == "found" or tab == "story"
end

-- A page found, opened or heard: the bookmark's count now, the lists a moment later (many can arrive at once).
local pending
function Book.Changed()
  Book.UpdateBadge()
  local UI = ns.UI
  if pending or not (UI.frame and UI.frame:IsShown() and Book.OnTab()) then return end
  pending = true
  C_Timer.After(0.3, function()
    pending = nil
    if UI.tab == "story" then pcall(ns.Road.RefreshStories) end
    pcall(Book.Refresh)
  end)
end
