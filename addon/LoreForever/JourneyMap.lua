-- The journey map (LOR-171): the game's own map art for a zone or a continent, your moments on it as dots in their
-- filter's colour, joined in time order by a dotted road that draws itself up to the moment you're looking at, and a
-- pulse on that moment. Journey.lua puts it beside the timeline and calls Map.Focus as you hover a moment.
-- Map art, positions and conversions come from C_Map (all there in the 1.60.1 client, checked 2026-10-02). A spot can
-- be on a continent (GetBestMapForUnit says Kalimdor in The Barrens) or a zone; Map.Place gives both. Without map art
-- the map stays dark, with its caption.

local _, ns = ...
local Map = {}
ns.JourneyMap = Map
local L = ns.L

local WORLD, CONTINENT, ZONE = 1, 2, 3   -- UI map types
local DOT, FOCUS_DOT = 6, 9              -- moment dots, and the one you're looking at
local ROAD_GAP, ROAD_MAX = 6, 700        -- pixels between the road's dots, and at most this many of them
local DRAW_TIME = 0.6                    -- seconds the road takes to draw itself up to the hovered moment
local ASPECT = 668 / 1002                -- height / width of the game's map art

local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b, c, d = pcall(fn, ...)
  if ok then return a, b, c, d end
end
local function api(name) return _G.C_Map and _G.C_Map[name] end

-- Places ---------------------------------------------------------------------------------------------------------------

local infos, rects = {}, {}
local function info(m)
  if not m then return nil end
  if infos[m] == nil then infos[m] = try(api("GetMapInfo"), m) or false end
  return infos[m] or nil
end

-- Where map `a` sits on map `b` (an ancestor): minX, maxX, minY, maxY, or nil.
local function rect(a, b)
  local k = a .. ">" .. b
  if rects[k] == nil then
    local minX, maxX, minY, maxY = try(api("GetMapRectOnMap"), a, b)
    local ok = type(minX) == "number" and type(maxX) == "number" and type(minY) == "number" and type(maxY) == "number"
      and maxX ~= minX and maxY ~= minY
    rects[k] = ok and { minX, maxX, minY, maxY } or false
  end
  return rects[k] or nil
end

-- The map of type t that m is in (m itself if it's one), or nil.
local function ancestor(m, t)
  for _ = 1, 8 do
    local i = info(m)
    if not i then return nil end
    if i.mapType == t then return m end
    if (i.mapType or 0) < t then return nil end
    m = i.parentMapID
  end
end

-- The zone under (x, y) on a continent: the game's answer, else the smallest zone whose rectangle holds the spot.
local zonesOf = {}
local function zoneAt(cont, x, y)
  local hit = try(api("GetMapInfoAtPosition"), cont, x, y)
  local z = type(hit) == "table" and ancestor(hit.mapID, ZONE)
  if z then return z end
  if zonesOf[cont] == nil then zonesOf[cont] = try(api("GetMapChildrenInfo"), cont, ZONE, true) or false end
  local best, area
  for _, child in ipairs(zonesOf[cont] or {}) do
    local r = rect(child.mapID, cont)
    if r and x >= r[1] and x <= r[2] and y >= r[3] and y <= r[4] then
      local a = (r[2] - r[1]) * (r[4] - r[3])
      if not area or a < area then best, area = child.mapID, a end
    end
  end
  return best
end

-- A spot (map m, x and y from 0 to 1) as { zone, zx, zy, cont, cx, cy }; any of them can be nil.
function Map.Place(m, x, y)
  local i = info(m)
  if not (i and x and y) then return nil end
  local p = {}
  if (i.mapType or 0) <= CONTINENT then
    p.cont, p.cx, p.cy = m, x, y
    if i.mapType == CONTINENT then
      p.zone = zoneAt(m, x, y)
      local r = p.zone and rect(p.zone, m)
      if r then p.zx, p.zy = (x - r[1]) / (r[2] - r[1]), (y - r[3]) / (r[4] - r[3]) end
    end
  else
    p.zone = ancestor(m, ZONE)
    if p.zone == m then
      p.zx, p.zy = x, y
    elseif p.zone then
      local r = rect(m, p.zone)
      if r then p.zx, p.zy = r[1] + x * (r[2] - r[1]), r[3] + y * (r[4] - r[3]) end
    end
    p.cont = ancestor(m, CONTINENT)
    local r = p.cont and rect(m, p.cont)
    if r then p.cx, p.cy = r[1] + x * (r[2] - r[1]), r[3] + y * (r[4] - r[3]) end
  end
  if not p.zx then p.zone = nil end
  if not p.cx then p.cont = nil end
  return p
end

-- A zone's map by its name (for moments with no spot): every zone in the world, looked up once.
local byName
function Map.ZoneNamed(name)
  if type(name) ~= "string" then return nil end
  if not byName then
    byName = {}
    local here = try(api("GetBestMapForUnit"), "player")
    local world = ancestor(here, WORLD) or 947
    for _, z in ipairs(try(api("GetMapChildrenInfo"), world, ZONE, true) or {}) do
      if type(z.name) == "string" and not byName[z.name] then byName[z.name] = z.mapID end
    end
  end
  return byName[name]
end

function Map.Name(m) local i = info(m) return i and i.name end
function Map.Continent(m) return ancestor(m, CONTINENT) end

-- Drawing --------------------------------------------------------------------------------------------------------------

local function pool(f, list, i, layer, size)
  local t = list[i]
  if not t then
    t = f.canvas:CreateTexture(nil, layer)
    t:SetTexture("Interface\\Buttons\\WHITE8X8")
    list[i] = t
  end
  t:SetSize(size, size)
  return t
end

-- The map's art, tile by tile, filling the canvas. False when the game has none for m.
local function art(f, m)
  if f.mapID == m and f.artW == f.w then return f.hasArt end
  f.mapID, f.artW = m, f.w
  local layers = try(api("GetMapArtLayers"), m)
  local L1 = type(layers) == "table" and layers[1]
  local tex = L1 and try(api("GetMapArtLayerTextures"), m, 1)
  local n = 0
  if L1 and type(tex) == "table" and (L1.layerWidth or 0) > 0 and (L1.tileWidth or 0) > 0 then
    local sx, sy = f.w / L1.layerWidth, f.h / L1.layerHeight
    local cols = math.ceil(L1.layerWidth / L1.tileWidth)
    for i, id in ipairs(tex) do
      local t = f.tiles[i]
      if not t then
        t = f.canvas:CreateTexture(nil, "BORDER")
        f.tiles[i] = t
      end
      t:SetSize(L1.tileWidth * sx, L1.tileHeight * sy)
      t:ClearAllPoints()
      t:SetPoint("TOPLEFT", ((i - 1) % cols) * L1.tileWidth * sx, -math.floor((i - 1) / cols) * L1.tileHeight * sy)
      t:SetTexture(id)
      t:Show()
      n = i
    end
  end
  for i = n + 1, #f.tiles do f.tiles[i]:Hide() end
  f.hasArt = n > 0
  return f.hasArt
end

local function stopDrawing(f)
  f:SetScript("OnUpdate", nil)
  for i = 1, f.roadShown or 0 do f.road[i]:Show() end
end

-- The map beside the timeline. onWhole: called when Whole journey is switched.
function Map.Create(parent, onWhole)
  local f = CreateFrame("Frame", nil, parent)
  local level = (f:GetFrameLevel() or 1)
  f.canvas = CreateFrame("Frame", nil, f)
  f.canvas:SetAllPoints()
  f.canvas:SetFrameLevel(level + 1)
  if f.canvas.SetClipsChildren then f.canvas:SetClipsChildren(true) end
  ns.Theme.Area(f.canvas, "track", "BACKGROUND")
  f.tiles, f.dots, f.road = {}, {}, {}
  -- Above the art: the rim, the caption and Whole journey.
  local top = CreateFrame("Frame", nil, f)
  top:SetAllPoints()
  top:SetFrameLevel(level + 3)
  ns.Theme.Outline(top, "rim", "OVERLAY")
  -- The pulse on the moment you're looking at.
  local ring = f.canvas:CreateTexture(nil, "OVERLAY")
  ring:SetTexture("Interface\\Buttons\\WHITE8X8")
  ring:SetSize(FOCUS_DOT, FOCUS_DOT)
  ring:Hide()
  local ag = ring.CreateAnimationGroup and ring:CreateAnimationGroup()
  if ag then
    local s = ag:CreateAnimation("Scale")
    if s and s.SetScale then s:SetScale(3, 3) elseif s and s.SetScaleTo then s:SetScaleTo(3, 3) end
    if s then s:SetDuration(1) end
    local a = ag:CreateAnimation("Alpha")
    if a and a.SetFromAlpha then a:SetFromAlpha(0.9); a:SetToAlpha(0) end
    if a then a:SetDuration(1) end
    ag:SetLooping("REPEAT")
  end
  f.ring, f.pulse = ring, ag
  -- The caption along the bottom: the place, and the moment.
  local strip = ns.Theme.Area(top, "toast", "ARTWORK")
  strip:SetPoint("BOTTOMLEFT")
  strip:SetPoint("BOTTOMRIGHT")
  strip:SetHeight(20)
  local cap = top:CreateFontString(nil, "OVERLAY", ns.Theme.font.small)
  cap:SetPoint("BOTTOMLEFT", 6, 4)
  cap:SetPoint("RIGHT", -6, 0)
  cap:SetJustifyH("LEFT")
  if cap.SetWordWrap then cap:SetWordWrap(false) end
  f.caption = cap
  local whole = ns.Theme.Button(top, L["Whole journey"])
  whole:SetSize(110, 22)
  whole:SetPoint("TOPRIGHT", -4, -4)
  whole:SetScript("OnClick", function() if onWhole then onWhole() end end)
  f.wholeButton = whole
  f:Hide()
  return f
end

-- Fit the map to width w (the art's own shape sets the height).
function Map.SetWidth(f, w)
  f.w, f.h = math.floor(w), math.floor(w * ASPECT)
  f:SetSize(f.w, f.h)
end

-- Show `moments` (oldest first: { kind, color, spot = Map.Place(...) or nil, zoneName, title }) on the zone of
-- `focus`, or its continent when whole is set. The road draws itself up to the focus when animate is set.
function Map.Focus(f, moments, focus, whole, animate)
  if not (f and f.w and focus) then return end
  f.wholeButton:SetText(whole and L["This zone"] or L["Whole journey"])
  local sp = focus.spot
  local target = whole and (sp and sp.cont or Map.Continent(Map.ZoneNamed(focus.zoneName)))
    or (sp and sp.zone or Map.ZoneNamed(focus.zoneName))
  local key = whole and "cx" or "zx"
  local onTarget = function(m)
    local s = m.spot
    return s and (whole and s.cont or s.zone) == target
  end
  if target then art(f, target) end
  local place = tostring(Map.Name(target) or focus.zoneName or ""):gsub("|", "||")
  local where = (sp and onTarget(focus)) and tostring(focus.title or ""):gsub("|", "||") or L["No exact spot recorded"]
  f.caption:SetText(ns.Theme.code.gold .. place .. "|r  " .. where)

  -- Dots for the moments on this map, in time order; the focus is drawn bigger.
  local pts, fi = {}, nil
  for _, m in ipairs(moments) do
    if target and onTarget(m) then
      local x = m.spot[key] * f.w
      local y = m.spot[key == "cx" and "cy" or "zy"] * f.h
      pts[#pts + 1] = { x = x, y = y, m = m }
      if m == focus then fi = #pts end
    end
  end
  for i, p in ipairs(pts) do
    local d = pool(f, f.dots, i, "OVERLAY", p.m == focus and FOCUS_DOT or DOT)
    d:SetVertexColor(p.m.color[1], p.m.color[2], p.m.color[3], 1)
    d:ClearAllPoints()
    d:SetPoint("CENTER", f.canvas, "TOPLEFT", p.x, -p.y)
    d:Show()
  end
  for i = #pts + 1, #f.dots do f.dots[i]:Hide() end

  -- The road: every ROAD_GAP pixels from one moment to the next, up to the focus (or all of it).
  local upto, n = fi or #pts, 0
  local gap = ROAD_GAP
  local total = 0
  for i = 2, upto do total = total + math.sqrt((pts[i].x - pts[i - 1].x) ^ 2 + (pts[i].y - pts[i - 1].y) ^ 2) end
  if total / gap > ROAD_MAX then gap = total / ROAD_MAX end
  for i = 2, upto do
    local a, b = pts[i - 1], pts[i]
    local len = math.sqrt((b.x - a.x) ^ 2 + (b.y - a.y) ^ 2)
    local steps = math.max(1, math.floor(len / gap))
    for s = 1, steps - 1 do
      n = n + 1
      local t = pool(f, f.road, n, "ARTWORK", 2)
      t:SetVertexColor(ns.Theme.rgba(ns.Theme.color.mapMark))
      t:ClearAllPoints()
      t:SetPoint("CENTER", f.canvas, "TOPLEFT", a.x + (b.x - a.x) * s / steps, -(a.y + (b.y - a.y) * s / steps))
      t:SetShown(not animate)
    end
  end
  for i = n + 1, #f.road do f.road[i]:Hide() end
  f.roadShown = n

  -- The pulse, and the road drawing itself (OnUpdate only while it draws).
  if fi then
    f.ring:ClearAllPoints()
    f.ring:SetPoint("CENTER", f.canvas, "TOPLEFT", pts[fi].x, -pts[fi].y)
    f.ring:SetVertexColor(focus.color[1], focus.color[2], focus.color[3], 1)
    f.ring:Show()
    if f.pulse then f.pulse:Play() end
  else
    f.ring:Hide()
    if f.pulse then f.pulse:Stop() end
  end
  f:SetScript("OnUpdate", nil)
  if animate and n > 0 then
    local elapsed, shown = 0, 0
    f:SetScript("OnUpdate", function(self, dt)
      elapsed = elapsed + (dt or 0)
      local want = math.min(n, math.floor(n * elapsed / DRAW_TIME))
      for i = shown + 1, want do self.road[i]:Show() end
      shown = want
      if shown >= n then stopDrawing(self) end
    end)
  end
  return target
end

-- For the sim: forget cached map info (a test changes C_Map).
function Map.Reset() infos, rects, zonesOf, byName = {}, {}, {}, nil end
