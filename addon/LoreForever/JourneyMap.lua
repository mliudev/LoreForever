-- The journey map (LOR-171; polished in LOR-242): the game's own map art for a zone or a continent, your moments on it
-- as beads in their filter's colour, and the road you took between them. The road follows the map trail (where you
-- walked, Journey.lua) as a bright line with a soft dark edge, older stretches fainter, bright up to the moment you're
-- looking at and drawing itself there; dashed where you travelled or were away (a flight, a hearth, a boat, a long
-- gap), and only its shadow past the moment you're looking at. Only that moment moves: a soft glow that breathes and a
-- ring that widens and fades, drawn smoothly (no pixel snapping). Your first and latest moments here wear a ring.
-- Moments closer than a marker's width share one marker with a count; zooming in pulls them apart.
--
-- Zoom: the mouse wheel over the map (around the cursor), or + and -; drag to look around once zoomed; the circular
-- arrow shows the whole map again. Markers and lines keep their size at every zoom. Hovering a marker says what
-- happened there (Journey.MomentTip) and shows the road to it; clicking opens its lore (Journey.OpenMoment), Shift adds
-- its narration to the playlist, and a marker that stands for several zooms in on them. The arrows under the map step
-- through your moments in time order. Journey.lua puts the map beside the timeline and, larger, in a window of its own
-- (the Bigger map button).
--
-- Map art, positions and conversions come from C_Map (all there in the 1.60.1 client, checked 2026-10-02). A spot can
-- be on a continent (GetBestMapForUnit says Kalimdor in The Barrens) or a zone; Map.Place gives both. Without map art
-- the map stays dark, with its caption. Without CreateLine the road is a row of small round dots, as before.

local _, ns = ...
local Map = {}
ns.JourneyMap = Map
local L = ns.L
local T = ns.Theme

local WORLD, CONTINENT, ZONE = 1, 2, 3   -- UI map types
local ASPECT = 668 / 1002                -- height / width of the game's map art
local ART_W = 1002                       -- the art's own width in pixels
local DOT, DOT_FOCUS, HIT = 9, 12, 16    -- a bead, the one you're looking at, and the area that takes the mouse
local CLUSTER = 14                       -- moments closer than this (either way, in pixels) share a marker
local STEP = 3                           -- the road keeps a point at least every STEP pixels
local MAX_SEGMENTS = 450                 -- the road's most pieces; past that it keeps fewer points
local DOT_GAP = 6                        -- without CreateLine: pixels between the road's dots
local DASH, DASH_GAP, MAX_DASHES = 5, 4, 24
local JUMP_GAP, JUMP_FAR = 600, 0.03     -- this many seconds and this much of the map between two points: elsewhere
local DRAW_TIME, ZOOM_TIME, PAN_TIME = 0.6, 0.18, 0.25
local WHEEL_STEP, BUTTON_STEP = 1.25, 1.6
local MAX_ART_SCALE = 3                  -- zoom no further than three times the art's own pixels
local TRAVEL = { flight = true, hearth = true, portal = true, boat = true }

-- The game's own art. TempPortraitAlphaMask is a crisp white disc, GenericGlow64 a soft round glow (its middle column
-- gives a line soft edges), ping4 a thin white ring on black (drawn with ADD), GoldRing the portraits' gold ring.
local WHITE = "Interface\\Buttons\\WHITE8X8"
local DISC = "Interface\\CHARACTERFRAME\\TempPortraitAlphaMask"
local GLOW = "Interface\\GLUES\\Models\\UI_Draenei\\GenericGlow64"
local RING = "Interface\\Cooldown\\ping4"
local GOLD_RING = "Interface\\Common\\GoldRing"
local RESET_ICON = "Interface\\Buttons\\UI-RefreshButton"
local ARROW = "Interface\\Buttons\\UI-SpellbookIcon-"   -- .. "PrevPage-Up" and the rest, as the player's arrows

local ROAD, EDGE = T.color.mapMark, T.color.mapEdge   -- the road, and its soft dark edge

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

-- The map trail's points, placed once each (they don't change).
local placed = {}
local function placeOf(m, x, y)
  local k = m .. ":" .. x .. ":" .. y
  if placed[k] == nil then placed[k] = Map.Place(m, x, y) or false end
  return placed[k] or nil
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

-- Art --------------------------------------------------------------------------------------------------------------------

local have = {}
-- The texture at path when the client has it, else the fallback (checked once per path).
local function pick(path, fallback)
  if have[path] == nil then have[path] = T.HasTexture(path) and true or false end
  return have[path] and path or fallback
end

-- Animated and sub-pixel placed textures draw smoothly instead of snapping to whole pixels as they move and scale.
local function smooth(t)
  if t.SetSnapToPixelGrid then t:SetSnapToPixelGrid(false) end
  if t.SetTexelSnappingBias then t:SetTexelSnappingBias(0) end
  return t
end

local function texture(parent, layer, sub, path, fallback, blend)
  local t = parent:CreateTexture(nil, layer, nil, sub or 0)
  t:SetTexture(pick(path, fallback or WHITE))
  if blend and t.SetBlendMode then t:SetBlendMode(blend) end
  return t
end

-- The parts of map m this character has explored, over its base art, the way the world map draws them
-- (MapExplorationPinMixin): each piece is a grid of tiles placed in the art layer's pixels, the last column and row
-- cut from a power-of-two file. Pieces the world map shows only under the mouse are left out. No pieces (a continent,
-- or a client without C_MapExplorationInfo): just the base art.
local function explored(f, m, L1, sx, sy)
  local E = _G.C_MapExplorationInfo
  local list = E and try(E.GetExploredMapTextures, m)
  local n = 0
  local TW, TH = L1.tileWidth, L1.tileHeight or L1.tileWidth
  for _, o in ipairs(type(list) == "table" and list or {}) do
    local ids = type(o) == "table" and type(o.fileDataIDs) == "table" and o.fileDataIDs
    local w, h = ids and tonumber(o.textureWidth) or 0, ids and tonumber(o.textureHeight) or 0
    if w > 0 and h > 0 and not o.isShownByMouseOver then
      local wide, tall = math.ceil(w / TW), math.ceil(h / TH)
      for j = 1, tall do
        local ph, fh = TH, TH
        if j == tall then
          ph = h % TH
          if ph == 0 then ph = TH end
          fh = 16
          while fh < ph do fh = fh * 2 end
        end
        for k = 1, wide do
          local pw, fw = TW, TW
          if k == wide then
            pw = w % TW
            if pw == 0 then pw = TW end
            fw = 16
            while fw < pw do fw = fw * 2 end
          end
          local id = ids[(j - 1) * wide + k]
          if id then
            n = n + 1
            local t = f.overlays[n]
            if not t then
              t = f.surface:CreateTexture(nil, "BORDER", nil, 1)
              f.overlays[n] = t
            end
            t:SetDrawLayer("BORDER", o.isDrawOnTop and 2 or 1)
            t:SetSize(pw * sx, ph * sy)
            t:SetTexCoord(0, pw / fw, 0, ph / fh)
            t:ClearAllPoints()
            t:SetPoint("TOPLEFT", ((o.offsetX or 0) + TW * (k - 1)) * sx, -((o.offsetY or 0) + TH * (j - 1)) * sy)
            t:SetTexture(id)
            t:Show()
            t.piece = { id = id, x = (o.offsetX or 0) + TW * (k - 1), y = (o.offsetY or 0) + TH * (j - 1), w = pw, h = ph,
              u = pw / fw, v = ph / fh }   -- where it went, in the layer's pixels (for the sim)
          end
        end
      end
    end
  end
  for i = n + 1, #f.overlays do f.overlays[i]:Hide() end
  return n
end

-- The map's art, tile by tile, filling the surface (W x H: the map at its zoom), with what you've explored drawn over
-- it. False when the game has no art for m. Drawn again on every Refresh (Map.Forget), since you explore as you play.
local function art(f, m, W, H)
  if f.mapID == m and f.artW == W then return f.hasArt end
  f.mapID, f.artW = m, W
  local layers = try(api("GetMapArtLayers"), m)
  local L1 = type(layers) == "table" and layers[1]
  local tex = L1 and try(api("GetMapArtLayerTextures"), m, 1)
  local n, pieces = 0, 0
  if L1 and type(tex) == "table" and (L1.layerWidth or 0) > 0 and (L1.tileWidth or 0) > 0 then
    local sx, sy = W / L1.layerWidth, H / L1.layerHeight
    local cols = math.ceil(L1.layerWidth / L1.tileWidth)
    for i, id in ipairs(tex) do
      local t = f.tiles[i]
      if not t then
        t = f.surface:CreateTexture(nil, "BORDER")
        f.tiles[i] = t
      end
      t:SetSize(L1.tileWidth * sx, L1.tileHeight * sy)
      t:ClearAllPoints()
      t:SetPoint("TOPLEFT", ((i - 1) % cols) * L1.tileWidth * sx, -math.floor((i - 1) / cols) * L1.tileHeight * sy)
      t:SetTexture(id)
      t:Show()
      n = i
    end
    if n > 0 then pieces = explored(f, m, L1, sx, sy) end
  end
  for i = n + 1, #f.tiles do f.tiles[i]:Hide() end
  if pieces == 0 then
    for i = 1, #f.overlays do f.overlays[i]:Hide() end
  end
  f.hasArt = n > 0
  return f.hasArt
end

local function noArt(f)
  f.mapID, f.hasArt = nil, false
  for _, t in ipairs(f.tiles) do t:Hide() end
  for _, t in ipairs(f.overlays) do t:Hide() end
end

-- Draw the art and the markers again next time (what you've explored may have grown).
function Map.Forget(f) if f then f.mapID, f.dirty = nil, true end end

-- The view: zoom and pan ---------------------------------------------------------------------------------------------
-- f.zoom (1 = the whole map in view), and f.ox, f.oy: the surface's pixels left of and above the view.

local function maxZoom(f)
  return math.max(2, math.min(6, MAX_ART_SCALE * ART_W / math.max(1, f.w or ART_W)))
end

local function clampPan(f, ox, oy)
  local z = f.zoom or 1
  ox = math.max(0, math.min(ox or 0, f.w * z - f.w))
  oy = math.max(0, math.min(oy or 0, f.h * z - f.h))
  return ox, oy
end

-- Markers out of view are hidden, so nothing clipped away takes the mouse.
local function markersInView(f)
  for _, b in ipairs(f.markers) do
    if b.cluster then
      local x, y = b.cluster.x - f.ox, b.cluster.y - f.oy
      b:SetShown(x > -4 and x < f.w + 4 and y > -4 and y < f.h + 4)
    end
  end
end

local function setPan(f, ox, oy)
  f.ox, f.oy = clampPan(f, ox, oy)
  f.surface:ClearAllPoints()
  f.surface:SetPoint("TOPLEFT", f.canvas, "TOPLEFT", -f.ox, f.oy)
  markersInView(f)
end

local function enable(b, on)
  b:SetEnabled(on and true or false)
  for _, t in ipairs(b.glyph or {}) do t:SetAlpha(on and 1 or 0.35) end
end

local function zoomButtons(f)
  if not f.zoomIn then return end
  local z = f.zoom or 1
  local can = f.target ~= nil
  enable(f.zoomIn, can and z < maxZoom(f) - 0.001)
  enable(f.zoomOut, can and z > 1.001)
  f.resetButton:SetShown(z > 1.001)
end

-- Pieces of the road -----------------------------------------------------------------------------------------------

local function line(f, pool, i, sub, path, coords)
  local l = pool[i]
  if l == nil then
    l = f.canLine and f.surface:CreateLine(nil, "ARTWORK", nil, sub) or false
    if l then
      l:SetTexture(pick(path, WHITE))
      if coords then l:SetTexCoord(coords[1], coords[2], coords[3], coords[4]) end
    end
    pool[i] = l
  end
  return l or nil
end

local function setLine(f, l, x1, y1, x2, y2, thick, c, a)
  l:SetStartPoint("TOPLEFT", f.surface, x1, -y1)
  l:SetEndPoint("TOPLEFT", f.surface, x2, -y2)
  l:SetThickness(thick)
  l:SetVertexColor(c[1], c[2], c[3], a)
  l:Show()
end

local GLOW_COLUMN = { 0.48, 0.52, 0, 1 }   -- a soft edge across the line, even along it

-- A small round dot from `pool` (the road without CreateLine).
local function dot(f, pool, i, size)
  local d = pool[i]
  if not d then
    d = smooth(texture(f.surface, "ARTWORK", 1, DISC, WHITE))
    pool[i] = d
  end
  d:SetSize(size, size)
  return d
end

-- Dashes from (x1, y1) to (x2, y2): lines from `pool` (dots from pool.dots without CreateLine), from index n + 1.
-- Returns the new count; hide the rest with hideFrom.
local function dashes(f, pool, n, x1, y1, x2, y2, thick, c, a, seg)
  local len = math.sqrt((x2 - x1) ^ 2 + (y2 - y1) ^ 2)
  if len < 1 then return n end
  local period = math.max(DASH + DASH_GAP, len / MAX_DASHES)
  local dash = period * DASH / (DASH + DASH_GAP)
  local s = 0
  while s < len do
    local e = math.min(len, s + dash)
    n = n + 1
    local ax, ay = x1 + (x2 - x1) * s / len, y1 + (y2 - y1) * s / len
    local bx, by = x1 + (x2 - x1) * e / len, y1 + (y2 - y1) * e / len
    local l = line(f, pool, n, 3, WHITE)
    if l then
      setLine(f, l, ax, ay, bx, by, thick, c, a)
    else
      pool.dots = pool.dots or {}
      l = dot(f, pool.dots, n, thick + 0.5)
      l:ClearAllPoints()
      l:SetPoint("CENTER", f.surface, "TOPLEFT", (ax + bx) / 2, -(ay + by) / 2)
      l:SetVertexColor(c[1], c[2], c[3], a)
      l:Show()
    end
    l.seg = seg
    s = s + period
  end
  return n
end

local function hideFrom(pool, n)
  for i = n + 1, #pool do if pool[i] then pool[i]:Hide() end end
  for i = n + 1, #(pool.dots or {}) do pool.dots[i]:Hide() end
end

-- Building: what's on this map ------------------------------------------------------------------------------------------

-- Where a placed spot is on the map shown (0 to 1), or nil.
local function onMap(f, p)
  if not (p and f.target) then return nil end
  if f.whole then
    if p.cont == f.target and p.cx then return p.cx, p.cy end
  elseif p.zone == f.target and p.zx then
    return p.zx, p.zy
  end
end

-- f.pts: the moments on this map { x, y (0 to 1), m, t }, oldest first; f.path: the road, every point in time order
-- (the trail's and the moments'), each { x, y, t, m, jump }: jump when you got there some other way than walking.
local function build(f)
  local pts, seq, tmin, tmax = {}, {}, nil, nil
  for i, m in ipairs(f.moments or {}) do
    local t = m.ev and tonumber(m.ev.t)
    if t then tmin, tmax = math.min(tmin or t, t), math.max(tmax or t, t) end
    local x, y = onMap(f, m.spot)
    if x then
      pts[#pts + 1] = { x = x, y = y, m = m, t = t or 0 }
      seq[#seq + 1] = { x = x, y = y, m = m, t = t or 0, o = 1 + i / 100000 }
    elseif m.spot and t then
      seq[#seq + 1] = { t = t, o = 1 + i / 100000 }   -- somewhere else: the road breaks
    end
  end
  if tmin and f.opts.trail then
    for _, q in ipairs(f.opts.trail() or {}) do
      local t = tonumber(q.t)
      if t and t >= tmin and t <= tmax then
        local x, y = onMap(f, placeOf(q.m, q.x, q.y))
        seq[#seq + 1] = { x = x, y = y, t = t, o = 0 }
      end
    end
  end
  table.sort(seq, function(a, b) if a.t ~= b.t then return a.t < b.t end return a.o < b.o end)
  local path, away = {}, false
  for _, s in ipairs(seq) do
    if s.x then
      local last = path[#path]
      -- (A long wait in one place, then a few steps on, is still walking.)
      local far = last and (s.x - last.x) ^ 2 + (s.y - last.y) ^ 2 > JUMP_FAR * JUMP_FAR
      local jump = last and (away or (far and s.t - last.t > JUMP_GAP) or (s.m and s.m.ev and TRAVEL[s.m.ev.how]))
        or nil
      path[#path + 1] = { x = s.x, y = s.y, t = s.t, m = s.m, jump = jump and true or nil }
      away = false
    else
      away = #path > 0
    end
  end
  f.pts, f.path = pts, path
end

-- Layout at the current zoom ---------------------------------------------------------------------------------------------

local function look(f, b, focused)
  local list = b.cluster and b.cluster.list or {}
  local many = #list > 1
  local size = (many and 13 or DOT) + (focused and 3 or 0)
  b.dot:SetSize(size, size)
  b.shadow:SetSize(size + 4, size + 4)
  b.shine:SetSize(math.max(2, size * 0.34), math.max(2, size * 0.34))
  b.shine:SetPoint("CENTER", -size * 0.17, size * 0.17)
  b.count:SetText(many and tostring(#list) or "")
  b.shine:SetShown(not many)
end

local function marker(f, i)
  local b = f.markers[i]
  if b then return b end
  b = CreateFrame("Button", nil, f.pins)
  b:SetSize(HIT, HIT)
  b.shadow = smooth(texture(b, "BACKGROUND", 0, DISC, WHITE))
  b.shadow:SetPoint("CENTER")
  b.shadow:SetVertexColor(T.rgba(T.color.mapBead))
  b.dot = smooth(texture(b, "ARTWORK", 0, DISC, WHITE))
  b.dot:SetPoint("CENTER")
  b.shine = smooth(texture(b, "ARTWORK", 1, DISC, WHITE))   -- a small light on the bead
  b.shine:SetVertexColor(T.rgba(T.color.mapShine))
  local hl = smooth(texture(b, "HIGHLIGHT", 0, GLOW, DISC, "ADD"))
  hl:SetPoint("CENTER")
  hl:SetSize(26, 26)
  hl:SetVertexColor(T.rgba(T.color.mapShine))
  b.count = b:CreateFontString(nil, "OVERLAY", T.font.small)
  b.count:SetPoint("CENTER", 0, 0)
  b.count:SetTextColor(T.rgba(T.color.mapCount))
  if b.count.SetShadowOffset then b.count:SetShadowOffset(0, 0) end
  b:SetScript("OnEnter", function(self)
    local c = self.cluster
    if not c then return end
    if f.opts.tooltip then f.opts.tooltip(c.list, self, #c.list > 1 and f.zoom < maxZoom(f) - 0.01) end
    if f.opts.onFocus and c.list[1] ~= f.focus then f.opts.onFocus(c.list[1]) end
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  b:SetScript("OnClick", function(self)
    local c = self.cluster
    if not c then return end
    if #c.list > 1 and f.zoom < maxZoom(f) - 0.01 then
      GameTooltip:Hide()
      Map.ZoomTo(f, f.zoom * 2, c.x - f.ox, c.y - f.oy, true)
      return
    end
    if f.opts.onOpen then f.opts.onOpen(c.list[1], IsShiftKeyDown and IsShiftKeyDown()) end
  end)
  f.markers[i] = b
  return b
end

-- The markers: moments that would touch share one (the newest stands for them, and they're listed newest first).
local function placeMarkers(f)
  local z, cells, clusters, of = f.zoom, {}, {}, {}
  for i = #f.pts, 1, -1 do
    local p = f.pts[i]
    local x, y = p.x * f.w * z, p.y * f.h * z
    local gx, gy = math.floor(x / CLUSTER), math.floor(y / CLUSTER)
    local hit
    for dx = -1, 1 do
      for dy = -1, 1 do
        for _, c in ipairs(cells[(gx + dx) .. ":" .. (gy + dy)] or {}) do
          if not hit and math.abs(c.x - x) < CLUSTER and math.abs(c.y - y) < CLUSTER then hit = c end
        end
      end
    end
    if hit then
      hit.list[#hit.list + 1] = p.m
    else
      hit = { x = x, y = y, list = { p.m } }
      clusters[#clusters + 1] = hit
      local k = gx .. ":" .. gy
      cells[k] = cells[k] or {}
      table.insert(cells[k], hit)
    end
    of[p.m] = hit
  end
  -- Created oldest last, so the newest draw on top.
  for i, c in ipairs(clusters) do
    local b = marker(f, #clusters - i + 1)
    b.cluster = c
    c.button = b
    local col = c.list[1].color or ROAD
    b.dot:SetVertexColor(col[1], col[2], col[3], 1)
    look(f, b, false)
    b:ClearAllPoints()
    b:SetPoint("CENTER", f.surface, "TOPLEFT", c.x, -c.y)
    b:Show()
  end
  for i = #clusters + 1, #f.markers do
    f.markers[i].cluster = nil
    f.markers[i]:Hide()
  end
  f.clusters, f.clusterOf, f.focusMarker = clusters, of, nil
end

-- The road at this zoom: every moment, and the trail's points STEP pixels apart (more apart when there are too many).
local function placeRoad(f)
  local z, keep, step = f.zoom, {}, STEP
  local path = f.path or {}
  for _ = 1, 6 do
    keep = {}
    local lx, ly, jump
    for k, p in ipairs(path) do
      local x, y = p.x * f.w * z, p.y * f.h * z
      jump = jump or p.jump
      local last = keep[#keep]
      if p.m and last and not last.m and not jump and (x - lx) ^ 2 + (y - ly) ^ 2 < 1 then
        last.m, last.t, last.x, last.y = p.m, p.t, x, y   -- a moment where the trail already was: one point
        lx, ly = x, y
      elseif not lx or p.m or jump or k == #path or (x - lx) ^ 2 + (y - ly) ^ 2 >= step * step then
        keep[#keep + 1] = { x = x, y = y, t = p.t, m = p.m, jump = jump }
        lx, ly, jump = x, y, nil
      end
    end
    if #keep - 1 <= MAX_SEGMENTS then break end
    step = step * 2
  end
  f.road, f.roadAt = keep, {}
  for i, p in ipairs(keep) do if p.m then f.roadAt[p.m] = i end end
  -- The dark soft edge under every walked stretch, and the dashes of every jump.
  local nc, nd = 0, 0
  for s = 2, #keep do
    local a, b = keep[s - 1], keep[s]
    if b.jump then
      nd = dashes(f, f.dashes, nd, a.x, a.y, b.x, b.y, 1.5, ROAD, 0.5, s)
    else
      nc = nc + 1
      local l = line(f, f.casings, nc, 0, GLOW, GLOW_COLUMN)
      if l then setLine(f, l, a.x, a.y, b.x, b.y, 7, EDGE, EDGE[4]) end
    end
  end
  hideFrom(f.casings, nc)
  hideFrom(f.dashes, nd)
  f.nDashes = nd
  -- Where the road starts away from a marker: a small round end, so it doesn't just stop.
  local first = keep[1]
  if first and not first.m and #keep > 1 then
    f.cap:ClearAllPoints()
    f.cap:SetPoint("CENTER", f.surface, "TOPLEFT", first.x, -first.y)
    f.cap:Show()
  else
    f.cap:Hide()
  end
end

-- The bright road up to f.progress (an index into f.road; fractional while it draws), older stretches fainter. Past
-- it, only the dark edge (and faint dashes) say where you went next.
local function drawRoad(f)
  local road, p = f.road or {}, f.progress or 0
  local full = math.max(1, math.floor(f.drawTo or p))
  local nc, ndots, shown = 0, 0, 0
  for s = 2, #road do
    local a, b = road[s - 1], road[s]
    if not b.jump then
      nc = nc + 1
      local alpha = 0.45 + 0.55 * math.min(1, (s - 1) / math.max(1, full - 1))
      local frac = math.max(0, math.min(1, p - (s - 1)))
      local l = f.canLine and line(f, f.cores, nc, 2, WHITE)
      if l then
        if frac > 0 then
          setLine(f, l, a.x, a.y, a.x + (b.x - a.x) * frac, a.y + (b.y - a.y) * frac, 2, ROAD, alpha)
          shown = shown + 1
        else
          l:Hide()
        end
      elseif frac > 0 then
        local len = math.sqrt((b.x - a.x) ^ 2 + (b.y - a.y) ^ 2)
        for k = 1, math.max(1, math.floor(len * frac / DOT_GAP)) do
          ndots = ndots + 1
          local d = dot(f, f.roadDots, ndots, 2.5)
          local u = math.min(frac, k * DOT_GAP / math.max(len, 1))
          d:ClearAllPoints()
          d:SetPoint("CENTER", f.surface, "TOPLEFT", a.x + (b.x - a.x) * u, -(a.y + (b.y - a.y) * u))
          d:SetVertexColor(ROAD[1], ROAD[2], ROAD[3], alpha)
          d:Show()
        end
      end
    end
  end
  hideFrom(f.cores, f.canLine and nc or 0)
  for i = ndots + 1, #f.roadDots do f.roadDots[i]:Hide() end
  for i = 1, f.nDashes or 0 do
    local l = f.dashes[i] or (f.dashes.dots and f.dashes.dots[i])
    if l then l:SetAlpha((l.seg or 0) <= p + 0.001 and 1 or 0.45) end
  end
  f.roadShown = f.canLine and shown or ndots
end

-- The decorations of the moment you're looking at, your first and latest moments here, and the way to a related
-- moment (where a quest you finished began).
local function place(t, f, x, y)
  t:ClearAllPoints()
  t:SetPoint("CENTER", f.surface, "TOPLEFT", x, -y)
  t:Show()
end

local function placeFocus(f)
  local c = f.focus and f.clusterOf and f.clusterOf[f.focus]
  if f.focusMarker and f.focusMarker.cluster then look(f, f.focusMarker, false) end
  f.focusMarker = c and c.button or nil
  if c then
    look(f, c.button, true)
    local col = f.focus.color or ROAD
    for _, t in ipairs({ f.glow, f.ring, f.pulseRing }) do
      place(t, f, c.x, c.y)
      t:SetVertexColor(col[1], col[2], col[3], 1)
    end
    f.ring:SetVertexColor(T.rgba(T.color.mapRing))
  else
    f.glow:Hide(); f.ring:Hide(); f.pulseRing:Hide()
  end
  -- The first and latest moments on this map.
  local first, last = f.pts[1], f.pts[#f.pts]
  local cf, cl = first and f.clusterOf[first.m], last and f.clusterOf[last.m]
  if cf and cf ~= cl and cf ~= c then place(f.startRing, f, cf.x, cf.y) else f.startRing:Hide() end
  if cl and cl ~= c then place(f.endRing, f, cl.x, cl.y) else f.endRing:Hide() end
  -- Where a quest began (or ended): a dashed way in the quest colour, and a ring there.
  local n = 0
  local rel = f.related
  if rel and c then
    local x, y = onMap(f, rel.spot)
    if x then
      local rx, ry = x * f.w * f.zoom, y * f.h * f.zoom
      n = dashes(f, f.links, 0, rx, ry, c.x, c.y, 1.5, rel.color or ROAD, 0.9, 0)
      place(f.linkRing, f, rx, ry)
      f.linkRing:SetVertexColor((rel.color or ROAD)[1], (rel.color or ROAD)[2], (rel.color or ROAD)[3], 1)
    end
  end
  if n == 0 then f.linkRing:Hide() end
  hideFrom(f.links, n)
end

local function layout(f)
  local z = f.zoom or 1
  local W, H = f.w * z, f.h * z
  f.surface:SetSize(W, H)
  if f.target then art(f, f.target, W, H) else noArt(f) end
  placeMarkers(f)
  placeRoad(f)
  drawRoad(f)
  placeFocus(f)
  setPan(f, f.ox, f.oy)
  zoomButtons(f)
end

-- Animation: one OnUpdate while something moves (the road drawing, a zoom, a pan, a drag), none otherwise ------------

local function ease(t) return 1 - (1 - t) ^ 3 end

local function cursorIn(f)
  local x, y = try(GetCursorPosition)
  local s = tonumber(f.canvas:GetEffectiveScale()) or 1
  local left, top = tonumber(f.canvas:GetLeft()), tonumber(f.canvas:GetTop())
  if not (x and y and left and top and s > 0) then return nil end
  return x / s - left, top - y / s
end

local function tick(f, dt)
  dt = tonumber(dt) or 0
  local busy = false
  local a = f.anim
  if a then
    a.t = math.min(1, a.t + dt / a.time)
    local k = ease(a.t)
    if a.zoom then
      f.zoom = a.z0 + (a.z1 - a.z0) * k
      f.ox, f.oy = clampPan(f, a.u * f.w * f.zoom - a.vx, a.v * f.h * f.zoom - a.vy)
      layout(f)
    else
      setPan(f, a.ox0 + (a.ox1 - a.ox0) * k, a.oy0 + (a.oy1 - a.oy0) * k)
    end
    if a.t >= 1 then f.anim = nil else busy = true end
  end
  local d = f.drawing
  if d then
    d.t = math.min(1, d.t + dt / d.time)
    f.progress = d.from + (d.to - d.from) * ease(d.t)
    if d.t >= 1 then f.drawing, f.progress, f.drawTo = nil, d.to, nil end
    drawRoad(f)
    busy = busy or f.drawing ~= nil
  end
  local g = f.drag
  if g then
    local x, y = cursorIn(f)
    if x then
      if math.abs(x - g.x) + math.abs(y - g.y) > 3 then g.moved = true end
      setPan(f, g.ox - (x - g.x), g.oy - (y - g.y))
    end
    busy = true
  end
  if not busy then f:SetScript("OnUpdate", nil) end
end

local function wake(f) f:SetScript("OnUpdate", tick) end

-- Zoom to z (clamped), keeping the point at (vx, vy) in the view (default: its middle) where it is.
function Map.ZoomTo(f, z, vx, vy, animate)
  if not (f and f.w and f.target) then return end
  z = math.max(1, math.min(maxZoom(f), z or 1))
  if math.abs(z - f.zoom) < 0.001 and not f.anim then return end
  vx, vy = vx or f.w / 2, vy or f.h / 2
  local u, v = (f.ox + vx) / (f.w * f.zoom), (f.oy + vy) / (f.h * f.zoom)
  if animate then
    f.anim = { zoom = true, z0 = f.zoom, z1 = z, u = u, v = v, vx = vx, vy = vy, t = 0, time = ZOOM_TIME }
    wake(f)
  else
    f.anim = nil
    f.zoom = z
    f.ox, f.oy = clampPan(f, u * f.w * z - vx, v * f.h * z - vy)
    layout(f)
  end
end

-- Zoom by a factor around the cursor (the mouse wheel) or the middle.
function Map.Zoom(f, factor, atCursor, animate)
  if not (f and f.zoom) then return end
  local vx, vy
  if atCursor then vx, vy = cursorIn(f) end
  local target = (f.anim and f.anim.zoom and f.anim.z1) or f.zoom
  Map.ZoomTo(f, target * factor, vx, vy, animate)
end

function Map.ResetZoom(f, animate) if f and f.zoom then Map.ZoomTo(f, 1, nil, nil, animate) end end

-- Center the view on (x, y), fractions of the map (as far as the map's edges let it).
function Map.CenterOn(f, x, y, animate)
  if not (f and f.w and f.zoom) then return end
  local ox, oy = clampPan(f, x * f.w * f.zoom - f.w / 2, y * f.h * f.zoom - f.h / 2)
  if animate then
    f.anim = { ox0 = f.ox, oy0 = f.oy, ox1 = ox, oy1 = oy, t = 0, time = PAN_TIME }
    wake(f)
  else
    setPan(f, ox, oy)
  end
end

-- Bring the point (x, y) of the surface into view when it's out of it (an arrow stepped to it, a row hovered). A
-- marker you can see, and so one under the mouse, never moves the map.
local function follow(f, x, y)
  if (f.zoom or 1) <= 1.001 then return end
  local vx, vy = x - f.ox, y - f.oy
  if vx >= 0 and vx <= f.w and vy >= 0 and vy <= f.h then return end
  local ox, oy = clampPan(f, x - f.w / 2, y - f.h / 2)
  f.anim = { ox0 = f.ox, oy0 = f.oy, ox1 = ox, oy1 = oy, t = 0, time = PAN_TIME }
  wake(f)
end

-- Making the map --------------------------------------------------------------------------------------------------------

local function tip(self)
  GameTooltip:SetOwner(self, "ANCHOR_LEFT")
  GameTooltip:AddLine(self.tip)
  if self.tip2 then T.Tip(self.tip2, "tipText", true) end
  GameTooltip:Show()
end

-- A small square button in the panel's style, with a sign drawn on it (b.glyph: its parts, dimmed when it's off).
local function iconButton(parent, label, more, onClick)
  local b = T.SkinButton(CreateFrame("Button", nil, parent))
  b:SetSize(20, 20)
  b.tip, b.tip2, b.glyph = label, more, {}
  b:SetScript("OnClick", onClick)
  b:SetScript("OnEnter", tip)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  return b
end

local function bar(b, w, h, x, y)
  local t = T.Area(b, "gold", "ARTWORK")
  t:SetSize(w, h)
  t:SetPoint("CENTER", x or 0, y or 0)
  b.glyph[#b.glyph + 1] = t
  return t
end

local function arrow(parent, dir, label, onClick)
  local b = CreateFrame("Button", nil, parent)
  b:SetSize(20, 20)
  b:SetNormalTexture(ARROW .. dir .. "Page-Up")
  b:SetPushedTexture(ARROW .. dir .. "Page-Down")
  b:SetDisabledTexture(ARROW .. dir .. "Page-Disabled")
  b:SetHighlightTexture("Interface\\Buttons\\UI-Common-MouseHilight", "ADD")
  b.tip = label
  b:SetScript("OnClick", onClick)
  b:SetScript("OnEnter", tip)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  return b
end

local function pulse(t, ring)
  local ag = t.CreateAnimationGroup and t:CreateAnimationGroup()
  if not ag then return nil end
  local a = ag:CreateAnimation("Alpha")
  if ring then
    local s = ag:CreateAnimation("Scale")
    if s then
      if s.SetScaleFrom then s:SetScaleFrom(1, 1); s:SetScaleTo(2.6, 2.6) elseif s.SetScale then s:SetScale(2.6, 2.6) end
      s:SetDuration(1.4)
      if s.SetSmoothing then s:SetSmoothing("OUT") end
    end
    if a then
      if a.SetFromAlpha then a:SetFromAlpha(0.9); a:SetToAlpha(0) end
      a:SetDuration(1.4)
      if a.SetSmoothing then a:SetSmoothing("IN") end
      if a.SetEndDelay then a:SetEndDelay(0.6) end
    end
    ag:SetLooping("REPEAT")
  else
    if a then
      if a.SetFromAlpha then a:SetFromAlpha(0.35); a:SetToAlpha(0.85) end
      a:SetDuration(1.1)
      if a.SetSmoothing then a:SetSmoothing("IN_OUT") end
    end
    ag:SetLooping("BOUNCE")
  end
  return ag
end

-- Fit a text button to its label.
local function fit(b, min)
  local w = T.TextWidth(b:GetFontString())
  b:SetWidth(math.max(min, math.floor((w or min - 20) + 20)))
end

-- A map. opts: onWhole() (the Whole journey button), onFocus(moment) (a marker hovered), onOpen(moment, shift) (one
-- clicked), onStep(dir) (the arrows under it, -1 or 1), onExpand() (Bigger map: none in the large window, opts.large),
-- trail() (the map trail's points, oldest first), related(moment) (a moment to link it to, with a spot), and
-- tooltip(moments, owner, canZoom). A function in place of opts is onWhole.
function Map.Create(parent, opts)
  if type(opts) == "function" then opts = { onWhole = opts } end
  opts = opts or {}
  local f = CreateFrame("Frame", nil, parent)
  f.opts = opts
  local level = (f:GetFrameLevel() or 1)
  -- The view: clips what's zoomed past its edges, takes the wheel and the drag.
  local view = CreateFrame("Frame", nil, f)
  view:SetAllPoints()
  view:SetFrameLevel(level + 1)
  if view.SetClipsChildren then view:SetClipsChildren(true) end
  T.Area(view, "track", "BACKGROUND"):SetAllPoints()   -- the ground where there's no art
  view:EnableMouse(true)
  if view.EnableMouseWheel then view:EnableMouseWheel(true) end
  view:SetScript("OnMouseWheel", function(_, delta)
    Map.Zoom(f, (tonumber(delta) or 0) > 0 and WHEEL_STEP or 1 / WHEEL_STEP, true, true)
  end)
  view:SetScript("OnMouseDown", function(_, button)
    if button ~= "LeftButton" or (f.zoom or 1) <= 1.001 then return end
    local x, y = cursorIn(f)
    if x then
      f.drag = { x = x, y = y, ox = f.ox, oy = f.oy }
      wake(f)
    end
  end)
  view:SetScript("OnMouseUp", function() f.drag = nil end)
  view:SetScript("OnHide", function() f.drag = nil end)
  f.canvas = view
  -- The surface: the map at its zoom, moved by the pan. Its art and road; above it the focus's glow, then the markers.
  local surface = CreateFrame("Frame", nil, view)
  surface:SetPoint("TOPLEFT")
  surface:SetSize(1, 1)
  surface:SetFrameLevel(level + 2)
  f.surface = surface
  f.tiles, f.overlays, f.markers, f.casings, f.cores, f.dashes, f.links, f.roadDots = {}, {}, {}, {}, {}, {}, {}, {}
  -- Lines where the client has them (the first one made here is the road's first bright stretch).
  local probe = surface.CreateLine and surface:CreateLine(nil, "ARTWORK", nil, 2)
  f.canLine = probe and true or false
  if probe then
    probe:SetTexture(WHITE)
    probe:Hide()
    f.cores[1] = probe
  end
  local fx = CreateFrame("Frame", nil, surface)
  fx:SetAllPoints()
  fx:SetFrameLevel(level + 3)
  local pins = CreateFrame("Frame", nil, surface)
  pins:SetAllPoints()
  pins:SetFrameLevel(level + 4)
  f.fx, f.pins = fx, pins
  f.zoom, f.ox, f.oy = 1, 0, 0
  f.cap = smooth(texture(surface, "ARTWORK", 4, DISC, WHITE))
  f.cap:SetSize(6, 6)
  f.cap:SetVertexColor(ROAD[1], ROAD[2], ROAD[3], 0.8)
  f.cap:Hide()
  -- The moment you're looking at: a soft glow that breathes, a white ring, and a ring that widens and fades.
  f.glow = smooth(texture(fx, "BACKGROUND", 0, GLOW, DISC, "ADD"))
  f.glow:SetSize(34, 34)
  f.ring = smooth(texture(fx, "ARTWORK", 0, RING, DISC, "ADD"))
  f.ring:SetSize(20, 20)
  f.pulseRing = smooth(texture(fx, "ARTWORK", 1, RING, DISC, "ADD"))
  f.pulseRing:SetSize(16, 16)
  f.breath, f.pulse = pulse(f.glow, false), pulse(f.pulseRing, true)
  -- Your first moment here (a silver ring) and your latest (a gold one); where a related moment was (a ring in its
  -- colour).
  local function goldRing(size)
    local gold = T.HasTexture(GOLD_RING)   -- else the thin white ring, which is drawn with ADD (it's on black)
    local t = smooth(texture(fx, "ARTWORK", 2, gold and GOLD_RING or RING, DISC, not gold and "ADD" or nil))
    t:SetSize(size, size)
    return t
  end
  f.startRing, f.endRing, f.linkRing = goldRing(18), goldRing(19), goldRing(15)
  if f.startRing.SetDesaturated then f.startRing:SetDesaturated(true) end
  for _, t in ipairs({ f.glow, f.ring, f.pulseRing, f.startRing, f.endRing, f.linkRing }) do t:Hide() end

  -- Above it all (still inside the view, so it's one control with it): the rim, the caption, the buttons.
  local hud = CreateFrame("Frame", nil, view)
  hud:SetAllPoints()
  hud:SetFrameLevel(level + 8)
  T.Outline(hud, "rim", "OVERLAY")
  f.hud = hud
  -- The caption along the bottom: the place and the moment, and the arrows that step through your moments.
  local strip = T.Area(hud, "toast", "ARTWORK")
  strip:SetPoint("BOTTOMLEFT")
  strip:SetPoint("BOTTOMRIGHT")
  strip:SetHeight(20)
  f.nextButton = arrow(hud, "Next", L["Next moment"], function() if opts.onStep then opts.onStep(1) end end)
  f.nextButton:SetPoint("BOTTOMRIGHT", -2, 0)
  f.prevButton = arrow(hud, "Prev", L["Previous moment"], function() if opts.onStep then opts.onStep(-1) end end)
  f.prevButton:SetPoint("RIGHT", f.nextButton, "LEFT", 0, 0)
  local cap = hud:CreateFontString(nil, "OVERLAY", T.font.small)
  cap:SetPoint("BOTTOMLEFT", 6, 4)
  cap:SetPoint("RIGHT", f.prevButton, "LEFT", -4, 0)
  cap:SetJustifyH("LEFT")
  if cap.SetWordWrap then cap:SetWordWrap(false) end
  f.caption = cap
  local whole = T.Button(hud, L["Whole journey"])
  whole:SetHeight(22)
  fit(whole, 60)
  whole:SetPoint("TOPRIGHT", -4, -4)
  whole:SetScript("OnClick", function() if opts.onWhole then opts.onWhole() end end)
  f.wholeButton = whole
  -- Zoom, under Whole journey; Bigger map in the top left corner.
  local zin = iconButton(hud, L["Zoom in"], L["Or scroll over the map. Drag it to look around."],
    function() Map.Zoom(f, BUTTON_STEP, false, true) end)
  bar(zin, 10, 2)
  bar(zin, 2, 10)
  zin:SetPoint("TOPRIGHT", -5, -30)
  local zout = iconButton(hud, L["Zoom out"], nil, function() Map.Zoom(f, 1 / BUTTON_STEP, false, true) end)
  bar(zout, 10, 2)
  zout:SetPoint("TOP", zin, "BOTTOM", 0, -3)
  local reset = iconButton(hud, L["Show the whole map"], nil, function() Map.ResetZoom(f, true) end)
  if T.HasTexture(RESET_ICON) then
    local t = reset:CreateTexture(nil, "ARTWORK")
    t:SetTexture(RESET_ICON)
    t:SetSize(14, 14)
    t:SetPoint("CENTER")
    reset.glyph[1] = t
  else
    bar(reset, 10, 2, 0, 4); bar(reset, 10, 2, 0, -4); bar(reset, 2, 10, -4, 0); bar(reset, 2, 10, 4, 0)
  end
  reset:SetPoint("TOP", zout, "BOTTOM", 0, -3)
  f.zoomIn, f.zoomOut, f.resetButton = zin, zout, reset
  if not opts.large then
    local big = iconButton(hud, L["Bigger map"], L["Opens the map large. Esc closes it."],
      function() if opts.onExpand then opts.onExpand() end end)
    for _, s in ipairs({ { -1, 1 }, { 1, 1 }, { -1, -1 }, { 1, -1 } }) do
      bar(big, 4, 2, s[1] * 4, s[2] * 5)
      bar(big, 2, 4, s[1] * 5, s[2] * 4)
    end
    big:SetPoint("TOPLEFT", 5, -5)
    f.expandButton = big
  end
  zoomButtons(f)
  f:Hide()
  return f
end

-- Fit the map to width w (the art's own shape sets the height).
function Map.SetWidth(f, w)
  w = math.floor(w)
  if f.w and f.w ~= w then
    f.ox, f.oy = (f.ox or 0) * w / f.w, (f.oy or 0) * w / f.w
    f.dirty = true
  end
  f.w, f.h = w, math.floor(w * ASPECT)
  f:SetSize(f.w, f.h)
end

-- Enable the arrows under the map: whether there's an earlier and a later moment to step to.
function Map.SetSteps(f, earlier, later)
  if not (f and f.prevButton) then return end
  f.prevButton:SetEnabled(earlier and true or false)
  f.nextButton:SetEnabled(later and true or false)
end

-- Show `moments` (oldest first: { kind, color, spot = Map.Place(...) or nil, zoneName, title, ev }) on the zone of
-- `focus`, or its continent when whole is set. The road draws itself on to the focus when animate is set. Moving to
-- another map shows all of it again; on the same map the zoom stays, and follows the focus when it's out of view.
function Map.Focus(f, moments, focus, whole, animate)
  if not (f and f.w and focus) then return end
  f.wholeButton:SetText(whole and L["This zone"] or L["Whole journey"])
  fit(f.wholeButton, 60)
  local sp = focus.spot
  local cont = whole and (sp and sp.cont or Map.Continent(Map.ZoneNamed(focus.zoneName)))
  whole = cont and true or false   -- no continent to show: the zone, as it is
  local target = cont or (sp and sp.zone or Map.ZoneNamed(focus.zoneName))
  local fresh = target ~= f.target or (whole and true or false) ~= (f.whole and true or false)
  if fresh then
    f.zoom, f.ox, f.oy, f.progress, f.anim, f.drawing, f.drag = 1, 0, 0, nil, nil, nil, nil
  end
  if fresh or moments ~= f.moments or f.dirty then
    f.target, f.whole, f.moments, f.dirty = target, whole and true or false, moments, nil
    build(f)
    f.focus = nil
    layout(f)
  end
  -- Another moment (not the same one again after the page refreshed as you play).
  local moved = fresh or focus.ev ~= f.focusEv or (focus.ev == nil and focus ~= f.focus)
  f.focus, f.focusEv = focus, focus.ev
  local c = f.clusterOf[focus]
  local place = tostring(Map.Name(target) or focus.zoneName or ""):gsub("|", "||")
  local what = c and tostring(focus.title or ""):gsub("|", "||") or L["No exact spot recorded"]
  f.caption:SetText(T.code.gold .. place .. "|r  " .. what)
  -- The road reaches the focus, or the last point before it when it has no spot here.
  local to = f.roadAt[focus]
  if not to then
    local t = focus.ev and tonumber(focus.ev.t) or 0
    to = 0
    for i, p in ipairs(f.road) do if p.t <= t then to = i end end
  end
  f.related = f.opts.related and f.opts.related(focus) or nil
  placeFocus(f)
  if c and f.pulse then
    if moved or not (f.pulse.IsPlaying and f.pulse:IsPlaying()) then
      f.pulse:Stop()
      f.pulse:Play()
    end
    if f.breath and not (f.breath.IsPlaying and f.breath:IsPlaying()) then f.breath:Play() end
  elseif f.pulse then
    f.pulse:Stop()
    if f.breath then f.breath:Stop() end
  end
  if animate and to > (f.progress or 1) then
    f.drawing = { from = f.progress or 1, to = to, t = 0, time = DRAW_TIME }
    f.drawTo = to
    f.progress = f.drawing.from
    drawRoad(f)
    wake(f)
  else
    f.drawing, f.drawTo, f.progress = nil, nil, to
    drawRoad(f)
  end
  if c and moved and not (f.anim and f.anim.zoom) then follow(f, c.x, c.y) end
  zoomButtons(f)
  return target
end

-- For the sim: forget cached map info (a test changes C_Map).
function Map.Reset() infos, rects, zonesOf, byName, placed = {}, {}, {}, nil, {} end
