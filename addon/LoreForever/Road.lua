-- The Road and Storylines bookmarks (v2 "Your Chronicle", slice 5). The Road is the journey page (Journey.lua) with
-- the zones you've reached as its chapters down the sidebar, in the order you reached them, each with its two seals:
-- every place found, and every story heard. A chapter shows only that zone's moments. Storylines lists the storylines
-- you're on, newest first; one opens on Found's page with the quests of it you've found (never how many it has, or
-- the ones you haven't). Made with the panel, filled the first time a bookmark opens: nothing here runs at login.

local _, ns = ...
local Road = {}
ns.Road = Road
local L, T = ns.L, ns.Theme

local ROW_H = 22
local SEAL = 12
local PLACES = { zone = true, city = true, dungeon = true, subzone = true }
local STORY = "*sl:"                     -- Found's page for a storyline: "*sl:" .. its id (Book.extra)

local function esc(s) return (tostring(s or ""):gsub("|", "||")) end
local function entries() return ns.DB and ns.DB.entries or {} end
local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b = pcall(fn, ...)
  if ok then return a, b end
end
local function foundTime(s) return tonumber(type(s) == "string" and s:match("^(%d+)") or "") or 0 end

-- A zone's two seals: { places = { found, total }, stories = { heard, total } }. Stories counts the pages with a
-- recording this character can play (a page with none can't be heard, so it never holds a seal back).
function Road.Seals(ck)
  local c = ns.Book.Index().chapters[ck]
  local have = (ns.Collection.Store() or {}).found or {}
  local out = { places = { found = 0, total = 0 }, stories = { heard = 0, total = 0 } }
  for _, k in ipairs(c and c.keys or {}) do
    local e = entries()[k]
    if e and PLACES[e.t] then
      out.places.total = out.places.total + 1
      if have[k] then out.places.found = out.places.found + 1 end
    end
    local target = ns.UI.EntryTarget(k)
    if target and ns.Voice.HasAudio(target.key) then
      out.stories.total = out.stories.total + 1
      if have[k] and ns.Voice.Heard(k) then out.stories.heard = out.stories.heard + 1 end
    end
  end
  out.places.done = out.places.total > 0 and out.places.found == out.places.total
  out.stories.done = out.stories.total > 0 and out.stories.heard == out.stories.total
  return out
end

-- The Road's chapters: the zones you've found pages in, in the order you reached them (Of Azeroth isn't a place).
function Road.Chapters()
  local out, here = {}, nil
  for _, row in ipairs(ns.Book.Chapters()) do
    if row.count and row.ck:sub(1, 1) ~= "*" then out[#out + 1] = row end
    if row.here then here = row.ck end
  end
  -- (where you stand, with nothing found there yet, comes last)
  table.sort(out, function(a, b)
    local fa, fb = a.count.first or math.huge, b.count.first or math.huge
    if fa ~= fb then return fa < fb end
    return a.label < b.label
  end)
  return out, here
end

-- The storylines you're on: named (its first quest started, Storyline.Name) and with a quest of it found, the one
-- you were on last first. { id, name, keys = { quest page keys found, in the storyline's order }, last }.
function Road.Storylines()
  local db = ns.DB
  local have = (ns.Collection.Store() or {}).found or {}
  local mine = try(UnitFactionGroup, "player")
  mine = (mine == "Alliance" and "A") or (mine == "Horde" and "H") or nil
  local out = {}
  for id, sl in pairs(db and db.storylines or {}) do
    if type(sl) == "table" and sl.c and (not sl.f or not mine or sl.f == mine) then
      local keys, last = {}, 0
      for _, q in ipairs(sl.c) do
        local k = db.index.quest[q]
        if k and have[k] then
          keys[#keys + 1] = k
          last = math.max(last, foundTime(have[k]))
        end
      end
      local name = #keys > 0 and ns.Storyline.Name(sl)
      if name then out[#out + 1] = { id = id, name = name, keys = keys, last = last } end
    end
  end
  table.sort(out, function(a, b)
    if a.last ~= b.last then return a.last > b.last end
    return a.name < b.name
  end)
  return out
end

-- The sidebar lists ------------------------------------------------------------------------------------------------

-- A seal at the row's right: gold for every place found, wax for every story heard, bright when earned.
local function seal(row, anchor, x, kind)
  local s = T.Seal(row, kind, SEAL)
  s:SetPoint("RIGHT", anchor, "RIGHT", x, 0)
  return s
end

local function list(view, name, top)
  local UI = ns.UI
  local sf = CreateFrame("ScrollFrame", name, view, "UIPanelScrollFrameTemplate")
  sf:SetPoint("TOPLEFT", 10, top)
  sf:SetPoint("BOTTOMRIGHT", view, "BOTTOMLEFT", UI.SIDE_W - 26, UI.DOCK_H + 46)   -- (ClearHint below sets it from the hint)
  local content = CreateFrame("Frame", nil, sf)
  content:SetSize(UI.SIDE_W - 40, 100)
  sf:SetScrollChild(content)
  local note = T.Ink(view:CreateFontString(nil, "OVERLAY", T.font.small), "inkNote")
  note:SetPoint("BOTTOMLEFT", 16, UI.DOCK_H + 8)
  note:SetJustifyH("LEFT")
  ns.Book.ClearHint(view, sf, note)   -- wraps, and the list ends above it (Book.lua)
  return { content = content, rows = {}, note = note, scroll = sf }
end

local function row(l, i, make)
  local r = l.rows[i]
  if r then return r end
  local UI = ns.UI
  r = UI.TextButton(l.content, UI.SIDE_W - 40, ROW_H, T.font.small, nil, true)
  if r.text.SetWordWrap then r.text:SetWordWrap(false) end
  r.text:SetPoint("BOTTOMRIGHT", -44, 2)
  r.sel = T.Area(r, "inkSelect")
  r.sel:SetAllPoints()
  r.mark = T.TargetMark(r, true)
  r:SetScript("OnLeave", function() GameTooltip:Hide() end)
  make(r)
  l.rows[i] = r
  return r
end

local function finish(l, n, y)
  for i = n + 1, #l.rows do l.rows[i]:Hide() end
  l.content:SetHeight(math.max(10, y))
end

-- The Road: "The whole road", then each zone with its two seals.
function Road.CreateSide(view)
  local l = list(view, "LoreForeverRoadScroll", -92)
  l.note:SetText(L["Each zone has two seals: every place found, and every story heard."])
  Road.side = l
end

function Road.RefreshSide()
  local l = Road.side
  if not l then return end
  local chapters, here = Road.Chapters()
  local y, n = 0, 0
  local function add(ck, label, seals, isHere)
    n = n + 1
    local r = row(l, n, function(r)
      r.places = seal(r, r, -22, "gilt")
      r.stories = seal(r, r, -4, "wax")
      r:SetScript("OnClick", function(self)
        Road.Open(self.ck)   -- (turns to the right page itself)
      end)
      r:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        GameTooltip:AddLine(esc(self.label))
        local s = self.seals
        if s then
          T.Tip(string.format(L["Every place found: %d of %d"], s.places.found, s.places.total),
            s.places.done and "tipGood" or "tipText")
          T.Tip(string.format(L["Every story heard: %d of %d"], s.stories.heard, s.stories.total),
            s.stories.done and "tipGood" or "tipText")
        else
          T.Tip(L["Everything you've done, newest first"], "tipText", true)
        end
        if self.here then T.Tip(L["You are here"], "tipDim") end
        GameTooltip:Show()
      end)
    end)
    r:ClearAllPoints()
    r:SetPoint("TOPLEFT", 0, -y)
    r.ck, r.label, r.seals, r.here = ck, label, seals, isHere
    r.text:SetText((ck and T.code.ink or T.code.inkAccent) .. esc(label) .. "|r")
    r.places:SetShown(seals ~= nil)
    r.stories:SetShown(seals ~= nil)
    if seals then
      r.places:SetFilled(seals.places.done)
      r.stories:SetFilled(seals.stories.done)
    end
    r.sel:SetShown(ck == Road.chapter)
    T.ShowMark(r.mark, isHere and true or false)
    r:Show()
    y = y + ROW_H + 2
  end
  add(nil, L["The whole road"], nil, false)
  for _, c in ipairs(chapters) do add(c.ck, c.label, Road.Seals(c.ck), c.ck == here) end
  finish(l, n, y)
end

-- A zone's chapter page ------------------------------------------------------------------------------------------------
-- Picking a zone opens its chapter: a parchment page over the journey page with which chapter of your road it is and
-- when you arrived, how much of it you've found and heard (and by kind), its two seals spelled out, and the zone's map
-- with your road through it. The map is the journey map's (JourneyMap.lua: the zone's own world map art, what you've
-- explored of it, the road you walked), sepia under a parchment wash, with the zone's places on it as dots: heard
-- (green, ringed), found (red), or a place there's a spot for but no page yet (a dashed ring, unnamed). A place gets a
-- dot where the journey recorded you in it; one with no spot isn't on the map (the page says how many). No art for
-- the zone, no map box. "The whole road" keeps the journey page as it was; so does Its moments, for one zone.
-- Made the first time a chapter opens (the map and its art with it), never at login.

local PAD, GAP = 16, 14
local ASPECT = 668 / 1002                 -- the map art's height / width (JourneyMap.lua)
local MAP_MIN, MAP_MAX = 190, 420
local WIDE_FROM = 500                     -- a page this wide puts the map beside the counts, else under them
local LEGEND_H = 76                       -- under the map: its line, the keys (two rows when a label is long), what isn't on it
local DOT_HIT, DASHES = 16, 8
local SEPIA = { 0.96, 0.84, 0.62 }        -- the map art, desaturated and tinted
local WASH = { 0.92, 0.84, 0.64, 0.34 }   -- a parchment veil over it, under the road and the dots
local KINDS = { "places", "people", "items", "quests" }

local function kindLabel(kind)
  return ({ places = L["Places"], people = L["People"], items = L["Items"], quests = L["Quests"] })[kind] or ""
end

local function ink(parent, font, role, justify)
  local fs = T.Ink(parent:CreateFontString(nil, "OVERLAY", font), role)
  fs:SetJustifyH(justify or "LEFT")
  if fs.SetJustifyV then fs:SetJustifyV("TOP") end
  return fs
end

local function textH(fs, fallback)
  local h = fs.GetStringHeight and tonumber(fs:GetStringHeight())
  return (h and h > 0) and h or fallback or 14
end

local function textW(fs, fallback) return T.TextWidth(fs) or fallback or 40 end

-- Text at x, y of the page (w wide when given).
local function put(fs, page, x, y, w)
  fs:ClearAllPoints()
  fs:SetPoint("TOPLEFT", page, "TOPLEFT", x, -y)
  if w then fs:SetWidth(math.max(10, w)) end
end

-- A dot's pieces, on a frame: a dark ring, a light ring (heard), the colour, and a dashed ring (a place not found).
local function dotArt(b)
  local disc = T.HasTexture(T.DISC)
  local function piece(layer, sub, size, role)
    local t = b:CreateTexture(nil, layer, nil, sub)
    if disc then t:SetTexture(T.DISC) else t:SetColorTexture(1, 1, 1, 1) end
    t:SetPoint("CENTER")
    t:SetSize(size, size)
    t:SetVertexColor(T.rgba(T.color[role]))
    return t
  end
  b.shadow = piece("BACKGROUND", 0, 15, "mapBead")
  b.rim = piece("ARTWORK", 0, 13, "dotRim")
  b.core = piece("ARTWORK", 1, 9, "dotGreen")
  b.dashes = {}
  for i = 1, DASHES do
    local d = T.Area(b, "ink", "ARTWORK")
    local a = (i - 1) * 2 * math.pi / DASHES
    d:SetSize(2.5, 2.5)
    d:SetPoint("CENTER", b, "CENTER", math.cos(a) * 6, math.sin(a) * 6)
    b.dashes[i] = d
  end
  return b
end

-- "heard", "found" or "unfound": the three differ by shape (a ringed dot, a plain one, a dashed ring), not by colour
-- alone.
local function setDot(b, state)
  b.state = state
  local heard, found = state == "heard", state == "found"
  b.shadow:SetShown(heard or found)
  b.rim:SetShown(heard)
  b.core:SetShown(heard or found)
  b.core:SetVertexColor(T.rgba(T.color[heard and "dotGreen" or "waxHi"]))
  b.core:SetSize(heard and 9 or 10, heard and 9 or 10)
  for _, d in ipairs(b.dashes) do d:SetShown(state == "unfound") end
end

local function newDot(parent)
  local b = dotArt(CreateFrame("Button", nil, parent))
  b:SetSize(DOT_HIT, DOT_HIT)
  local hl = b:CreateTexture(nil, "HIGHLIGHT")
  hl:SetPoint("CENTER")
  hl:SetSize(22, 22)
  if T.HasTexture(T.DISC) then hl:SetTexture(T.DISC) end
  hl:SetVertexColor(1, 0.95, 0.75, 0.35)
  b:SetScript("OnEnter", function(self)
    if not self.key then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    if self.state == "unfound" then
      GameTooltip:AddLine(L["A place"])
      T.Tip(L["Travel there to find this page."], "tipDim", true)
    else
      local e = entries()[self.key]
      GameTooltip:AddLine(esc(e and e.n or ""))
      T.Tip(self.state == "heard" and L["Heard"] or L["Found"], self.state == "heard" and "tipGood" or "tipText")
      T.Tip(ns.UI.CanQueue(self.key) and L["Click to open. Shift-click adds it to your playlist."]
        or L["Click to open its story"], "tipDim", true)
    end
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  b:SetScript("OnClick", function(self)
    if self.state == "unfound" or not self.key then return end
    ns.Journey.OpenMoment({ key = self.key, title = (entries()[self.key] or {}).n }, IsShiftKeyDown and IsShiftKeyDown())
  end)
  return b
end

-- One zone's chapter, as the page shows it.
function Road.Chapter(ck)
  local chapters = Road.Chapters()
  local n
  for i, c in ipairs(chapters) do if c.ck == ck then n = i end end
  local c = ns.Book.Index().chapters[ck]
  local first, last, level
  for _, k in ipairs(c and c.keys or {}) do
    local f = ns.Collection.Found(k)
    if f and f.t > 0 then
      if not first or f.t < first then first, level = f.t, f.lv end
      if not last or f.t > last then last = f.t end
    end
  end
  return { ck = ck, name = ns.Book.ChapterName(ck), n = n, first = first, last = last, level = level,
    count = ns.Book.Count(ck), seals = Road.Seals(ck) }
end

local function chapterLine(d)
  local parts = {}
  if d.n then parts[#parts + 1] = string.format(L["Chapter %d of your road"], d.n) end
  if d.first then
    local when = string.format(L["arrived %s"], date("%d %b", d.first))
    parts[#parts + 1] = d.level and (when .. ", " .. string.format(L["level %d"], d.level)) or when
  end
  return table.concat(parts, ns.Lang.Dotted(" · "))
end

local function sealText(kind, s)
  if kind == "places" then
    return s.done and L["Every place found: sealed"] or string.format(L["Every place found: %d left"], s.total - s.found)
  end
  if s.total == 0 then return L["Every story heard: nothing recorded here yet"] end
  return s.done and L["Every story heard: sealed"] or string.format(L["Every story heard: %d left"], s.total - s.heard)
end

-- The map's pieces, made when the first chapter with art opens.
local function makeMap(c)
  local Map = ns.JourneyMap
  if c.map or not Map then return c.map end
  local J = ns.Journey
  local m = Map.Create(c.frame, { trail = function() return J.TrailPoints() end })
  -- It is a picture of your road here, not the journey's browser: no Whole journey, no Bigger map, no arrows.
  m.wholeButton:Hide()
  if m.expandButton then m.expandButton:Hide() end
  m.prevButton:Hide()
  m.nextButton:Hide()
  -- Nor its caption strip along the foot, which would hide a place there: the page and its legend name the zone.
  m.caption:Hide()
  if m.captionBar then m.captionBar:Hide() end
  -- The parchment veil, between the art and the road.
  c.wash = m.surface:CreateTexture(nil, "BORDER", nil, 3)
  c.wash:SetAllPoints()
  c.wash:SetColorTexture(T.rgba(WASH))
  c.dots = CreateFrame("Frame", nil, m.surface)
  c.dots:SetAllPoints()
  c.dots:SetFrameLevel((tonumber(m.surface:GetFrameLevel()) or 1) + 5)
  c.dotPool = {}
  c.dots:SetScript("OnSizeChanged", function() Road.PlaceDots() end)
  c.map = m
  return m
end

-- The art in sepia (it is the client's own, in colour): desaturated, then tinted.
local function sepia(m)
  for _, list in ipairs({ m.tiles, m.overlays }) do
    for _, t in ipairs(list) do
      if t.SetDesaturated then t:SetDesaturated(true) end
      t:SetVertexColor(SEPIA[1], SEPIA[2], SEPIA[3], 1)
    end
  end
end

-- The dots where they are at the map's zoom.
function Road.PlaceDots()
  local c = Road.view
  local m = c and c.map
  if not (m and c.dotList) then return end
  local W, H = (m.w or 1) * (m.zoom or 1), (m.h or 1) * (m.zoom or 1)
  for i, p in ipairs(c.dotList) do
    local b = c.dotPool[i] or newDot(c.dots)
    c.dotPool[i] = b
    b.key = p.key
    setDot(b, p.state)
    b:ClearAllPoints()
    b:SetPoint("CENTER", c.dots, "TOPLEFT", p.x * W, -p.y * H)
    b:Show()
  end
  for i = #c.dotList + 1, #c.dotPool do c.dotPool[i]:Hide() end
end

-- Draw the zone's map at width w: false when the client has no art for it (then there's no box at all).
local function showMap(c, d, w)
  local m = makeMap(c)
  if not m then return false end
  local Map, J = ns.JourneyMap, ns.Journey
  if c.mapSig ~= c.sig then
    c.mapSig = c.sig
    c.mm = J.ChapterMap(d.ck)
  end
  local mm = c.mm
  local keys = {}
  for k in pairs(mm.spots) do keys[#keys + 1] = k end
  table.sort(keys)
  local name = mm.zone or d.name
  local t0, t1 = mm.t0 or d.first, mm.t1 or d.last
  -- Only the time they span matters to the road: the journey map draws your walk between these two.
  local moments = t0 and { { zoneName = name, ev = { t = t0 }, title = "" },
    { zoneName = name, ev = { t = t1 or t0 }, title = "" } } or {}
  Map.SetWidth(m, w)
  local focus = { zoneName = name, spot = keys[1] and mm.spots[keys[1]] or nil, ev = { t = t1 or t0 or 0 }, title = "" }
  local target = Map.Focus(m, moments, focus, false, false)
  if not (target and m.hasArt) then return false end
  sepia(m)
  -- The places: found ones with their state, a spot with no page as a dashed ring.
  local have = (ns.Collection.Store() or {}).found or {}
  c.dotList = {}
  c.placed = 0
  for _, k in ipairs(keys) do
    local sp = mm.spots[k]
    if sp.zone == target then
      local state = not have[k] and "unfound" or (ns.Voice.Heard(k) and "heard" or "found")
      c.dotList[#c.dotList + 1] = { key = k, state = state, x = sp.zx, y = sp.zy }
      if state ~= "unfound" then c.placed = c.placed + 1 end
    end
  end
  table.sort(c.dotList, function(a, b)   -- the ones you've heard on top
    local rank = { unfound = 1, found = 2, heard = 3 }
    if a.state ~= b.state then return rank[a.state] < rank[b.state] end
    return a.key < b.key
  end)
  Road.PlaceDots()
  return true
end

local function build()
  local J = ns.Journey
  local p = CreateFrame("Frame", "LoreForeverRoadChapter", J.page)
  p:SetAllPoints()
  p:SetFrameLevel((tonumber(J.page:GetFrameLevel()) or 1) + 5)
  p:EnableMouse(true)   -- the timeline under it takes no clicks
  T.Parchment(p, "right")
  p:Hide()
  local c = { frame = p, kinds = {}, seals = {}, meters = {} }
  c.title = ink(p, T.font.place, "inkAccent")
  if c.title.SetWordWrap then c.title:SetWordWrap(false) end
  c.sub = ink(p, T.font.body, "inkNote")
  c.back = T.Button(p, L["Back"])
  c.back:SetHeight(22)
  c.back:SetWidth(math.max(70, math.floor((T.TextWidth(c.back:GetFontString()) or 50) + 24)))
  c.back:SetScript("OnClick", function() ns.Journey.Hide() end)
  for i, spec in ipairs({ { "found", L["Found"] }, { "heard", L["Heard"] } }) do
    local r = { label = ink(p, T.font.body, "ink"), meter = T.Meter(p, spec[1]), count = ink(p, T.font.body, "ink", "RIGHT") }
    r.label:SetText(spec[2])
    c.meters[i] = r
  end
  for i = 1, #KINDS do
    c.kinds[i] = { label = ink(p, T.font.small, "inkNote", "CENTER"), value = ink(p, T.font.body, "ink", "CENTER") }
  end
  c.sealHead = ink(p, T.font.small, "inkNote")
  c.sealHead:SetText(L["Seals"])
  for i, kind in ipairs({ "gilt", "wax" }) do
    c.seals[i] = { seal = T.Seal(p, kind, 16), text = ink(p, T.font.body, "ink") }
  end
  c.moments = T.Button(p, L["Its moments"])
  c.moments:SetHeight(22)
  c.moments:SetWidth(math.max(90, math.floor((T.TextWidth(c.moments:GetFontString()) or 70) + 24)))
  c.moments:SetScript("OnClick", function()
    local ck = Road.chapter
    if not ck then return end
    Road.moments = true
    ns.Journey.zoneOnly, ns.Journey.zoneTitle = ck, ns.Book.ChapterName(ck)
    p:Hide()
    if ns.Journey.scroll and ns.Journey.scroll.SetVerticalScroll then ns.Journey.scroll:SetVerticalScroll(0) end
    ns.Journey.Refresh()
  end)
  c.moments:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Its moments"])
    T.Tip(L["Every moment of yours in this zone, newest first."], "tipText", true)
    GameTooltip:Show()
  end)
  c.moments:SetScript("OnLeave", function() GameTooltip:Hide() end)
  c.legend = {}
  c.legend.note = ink(p, T.font.small, "inkNote")
  c.legend.swatches = {}
  for i, state in ipairs({ "heard", "found", "unfound" }) do
    local s = dotArt(CreateFrame("Frame", nil, p))
    s:SetSize(14, 14)
    setDot(s, state)
    c.legend.swatches[i] = { dot = s, text = ink(p, T.font.small, "inkNote"), state = state }
  end
  c.legend.missing = ink(p, T.font.small, "inkNote")
  Road.view = c
  return c
end

function Road.ChapterOpen() return Road.chapter ~= nil and not Road.moments end

-- Lay the page out for the journey page's size and fill it in. Cheap enough to run on every refresh (a second apart
-- at most while you play); the map redraws only when something it shows may have changed.
function Road.RefreshChapter()
  local J, ck = ns.Journey, Road.chapter
  if not (ck and J.page and J.PageSize) then return end
  local c = Road.view or build()
  local p = c.frame
  p:Show()
  J.HideTimeline()
  local pw, ph = J.PageSize()
  local inner = pw - 2 * PAD
  local d = Road.Chapter(ck)
  local ch = J.Char()
  c.sig = table.concat({ ck, ch and ch.events and #ch.events or 0, d.count.found, d.count.heard }, "|")

  -- The header: the zone, where it comes in your road.
  local backW = tonumber(c.back:GetWidth()) or 70
  c.back:ClearAllPoints()
  c.back:SetPoint("TOPRIGHT", p, "TOPRIGHT", -12, -10)
  put(c.title, p, PAD, 14, inner - backW - 8)
  c.title:SetText(esc(d.name))
  local y = 14 + math.max(textH(c.title, 22), 22) + 4
  put(c.sub, p, PAD, y, inner)
  c.sub:SetText(esc(chapterLine(d)))
  y = y + textH(c.sub) + 12
  local top = y

  -- The counts, in the left column (all of it when the page is narrow).
  local wide = pw >= WIDE_FROM
  local lw = wide and math.max(200, math.floor(inner * 0.46)) or inner
  local rows = { { d.count.found, d.count.total }, { d.seals.stories.heard, d.seals.stories.total } }
  local labelW, countW = 0, 0
  for i, r in ipairs(c.meters) do
    r.count:SetText(string.format("%d / %d", rows[i][1], rows[i][2]))
    labelW, countW = math.max(labelW, textW(r.label)), math.max(countW, textW(r.count))
  end
  labelW, countW = math.ceil(labelW) + 4, math.ceil(countW) + 6
  for i, r in ipairs(c.meters) do
    put(r.label, p, PAD, y + 3, labelW)
    put(r.count, p, PAD + lw - countW, y + 3, countW)
    r.meter:ClearAllPoints()
    r.meter:SetPoint("TOPLEFT", p, "TOPLEFT", PAD + labelW + 8, -(y + 5))
    r.meter:SetSize(math.max(40, lw - labelW - countW - 16), 10)
    r.meter:SetProgress(rows[i][1], rows[i][2])
    y = y + 22
  end
  y = y + 8
  local shown = {}
  for _, kind in ipairs(KINDS) do
    local k = d.count.kinds[kind]
    if k and k.total > 0 then shown[#shown + 1] = { kind, k } end
  end
  -- Each kind a cell: its name over its count, in one row, or two rows when a name wouldn't fit its cell.
  local widest = 0
  for i, k in ipairs(c.kinds) do
    if shown[i] then
      k.label:SetWidth(400)
      k.label:SetText(kindLabel(shown[i][1]))
      widest = math.max(widest, textW(k.label))
    end
  end
  local cols = math.max(1, #shown)
  if cols > 2 and (widest + 8) * cols > lw then cols = math.ceil(#shown / 2) end
  local cell = math.floor(lw / cols)
  local rowH = 0
  for i, k in ipairs(c.kinds) do
    local s = shown[i]
    k.label:SetShown(s ~= nil)
    k.value:SetShown(s ~= nil)
    if s then
      local x, row = PAD + ((i - 1) % cols) * cell, math.floor((i - 1) / cols)
      local top = y + row * (textH(k.label, 11) + 2 + textH(k.value) + 6)
      put(k.label, p, x, top, cell)
      put(k.value, p, x, top + textH(k.label, 11) + 2, cell)
      k.value:SetText(string.format("%d/%d", s[2].found, s[2].total))
      rowH = math.max(rowH, textH(k.label, 11) + 2 + textH(k.value))
    end
  end
  local rows = math.ceil(#shown / cols)
  y = y + rows * rowH + (rows - 1) * 6 + 12
  put(c.sealHead, p, PAD, y, lw)
  y = y + textH(c.sealHead, 11) + 6
  for i, s in ipairs(c.seals) do
    local info = i == 1 and d.seals.places or d.seals.stories
    put(s.text, p, PAD + 24, y, lw - 24)
    s.text:SetText(sealText(i == 1 and "places" or "stories", info))
    s.seal:ClearAllPoints()
    s.seal:SetPoint("TOPLEFT", p, "TOPLEFT", PAD + 2, -(y - 1))
    s.seal:SetFilled(info.done)
    y = y + math.max(18, textH(s.text)) + 6
  end
  y = y + 6
  c.moments:ClearAllPoints()
  c.moments:SetPoint("TOPLEFT", p, "TOPLEFT", PAD, -y)
  local leftBottom = y + 22

  -- The map: beside the counts, or under them on a narrow page; as large as the room allows.
  local rx, ry, rw = PAD, leftBottom + 12, inner
  if wide then rx, ry, rw = PAD + lw + GAP, top, inner - lw - GAP end
  local mapW = math.min(rw, MAP_MAX, math.floor((ph - ry - LEGEND_H - PAD) / ASPECT))
  local drawn = mapW >= MAP_MIN and ns.JourneyMap and showMap(c, d, mapW)
  if c.map then c.map:SetShown(drawn and true or false) end
  for _, s in ipairs(c.legend.swatches) do s.dot:Hide(); s.text:Hide() end
  c.legend.note:SetShown(drawn and true or false)
  c.legend.missing:Hide()
  if not drawn then return end
  c.map:ClearAllPoints()
  c.map:SetPoint("TOPLEFT", p, "TOPLEFT", rx, -ry)
  local ly = ry + math.floor(mapW * ASPECT) + 8
  put(c.legend.note, p, rx, ly, mapW)
  c.legend.note:SetText(string.format(L["Your road through %s."], esc(ns.JourneyMap.Name(c.map.target) or d.name)))
  ly = ly + textH(c.legend.note, 11) + 6
  local x = rx
  local labels = { heard = L["Heard"], found = L["Found"], unfound = L["Not found yet"] }
  local any = {}
  for _, dot in ipairs(c.dotList or {}) do any[dot.state] = true end
  for _, s in ipairs(c.legend.swatches) do
    if s.state ~= "unfound" or any.unfound then
      s.text:SetText(labels[s.state])
      local w = 17 + math.ceil(textW(s.text)) + 4
      if x > rx and x + w > rx + mapW then x, ly = rx, ly + 18 end   -- a long label starts the next row
      s.dot:ClearAllPoints()
      s.dot:SetPoint("TOPLEFT", p, "TOPLEFT", x, -ly)
      put(s.text, p, x + 17, ly + 1)
      s.text:SetWidth(math.max(20, math.min(w - 17, rx + mapW - x - 17)))
      s.dot:Show()
      s.text:Show()
      x = x + w + 10
    end
  end
  local missing = (d.count.kinds.places and d.count.kinds.places.found or 0) - (c.placed or 0)
  if missing > 0 then
    put(c.legend.missing, p, rx, ly + 18, mapW)
    c.legend.missing:SetText(string.format(L["Not on the map yet: %d"], missing))
    c.legend.missing:Show()
  end
end

-- One zone's chapter page (nil: the whole road, the journey page as it was). The page for a zone shows its chapter;
-- Its moments there shows the journey page filtered to the zone.
function Road.Open(ck)
  local J = ns.Journey
  Road.chapter, Road.moments = ck, false
  J.zoneOnly, J.zoneTitle = nil, nil
  if Road.view then
    Road.view.mapSig = nil   -- (you may have explored more, walked more)
    if not ck then Road.view.frame:Hide() end
  end
  if J.scroll and J.scroll.SetVerticalScroll then J.scroll:SetVerticalScroll(0) end
  if J.IsShown() then J.Refresh() else J.Show() end
  Road.RefreshSide()
end

-- Storylines: the ones you're on, each opening its quests on Found's page.
function Road.CreateStorySide(view)
  local l = list(view, "LoreForeverStoryScroll", -92)
  l.note:SetText(L["The storylines you're on. Click one to see its quests you've found."])
  Road.storySide = l
end

function Road.RefreshStories()
  local l = Road.storySide
  if not l then return end
  local lines = Road.Storylines()
  local extra = ns.Book.extra
  for ck in pairs(extra) do if ck:sub(1, #STORY) == STORY then extra[ck] = nil end end
  local y = 0
  for i, sl in ipairs(lines) do
    local ck = STORY .. sl.id
    extra[ck] = { name = sl.name, keys = sl.keys }
    local r = row(l, i, function(r)
      r.count = T.Ink(r:CreateFontString(nil, "OVERLAY", T.font.small), "inkNote")
      r.count:SetPoint("RIGHT", -4, 0)
      r.count:SetJustifyH("RIGHT")
      r:SetScript("OnClick", function(self)
        Road.story = self.ck
        ns.Book.chapter = self.ck
        ns.Book.ShowPage()
        Road.RefreshStories()
      end)
      r:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        GameTooltip:AddLine(esc(self.label))
        T.Tip(string.format(self.n == 1 and L["%d quest of it found"] or L["%d quests of it found"], self.n), "tipText")
        GameTooltip:Show()
      end)
    end)
    r:ClearAllPoints()
    r:SetPoint("TOPLEFT", 0, -y)
    r.ck, r.label, r.n = ck, sl.name, #sl.keys
    r.text:SetText(T.code.ink .. esc(sl.name) .. "|r")
    r.count:SetText(tostring(#sl.keys))
    r.sel:SetShown(ck == Road.story)
    T.ShowMark(r.mark, false)
    r:Show()
    y = y + ROW_H + 2
  end
  finish(l, #lines, y)
  Road.storyEmpty = #lines == 0
  return lines
end

-- The Storylines bookmark was opened: the one picked last, else the newest, on Found's page.
function Road.ShowStories()
  local lines = Road.RefreshStories()
  local keep = Road.story and ns.Book.extra[Road.story]
  Road.story = keep and Road.story or (lines[1] and (STORY .. lines[1].id)) or nil
  Road.RefreshStories()
  ns.Book.chapter = Road.story or ns.Book.NONE
  ns.Book.ShowPage()
end

-- The Road bookmark was opened (UI.ShowTab): the journey page, on the chapter picked last.
function Road.ShowRoad()
  Road.Open(Road.chapter)
end

-- The page of where you stand: the place (subzone) when it has a page, else the zone's (the Here heading's click).
function Road.HereKey()
  local p = ns.Context.Place()
  local db = ns.DB
  for _, name in ipairs({ p.subzone, p.zone }) do
    local k = type(name) == "string" and name ~= "" and db.index.name[ns.Engine.lower(name)]
    if k and entries()[k] and PLACES[entries()[k].t] then return k end
  end
  local zk = p.zone and ns.UI.engine and ns.UI.engine:ZoneKey(p.zone)
  return zk and entries()["zone:" .. zk] and ("zone:" .. zk) or nil
end
