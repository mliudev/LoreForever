-- Willo's pins on the game's own world map and minimap (LOR-1247, Mike, 11/7: "pins on the world map"). Players asked
-- her to "mark it on my map" and looked at the map they open in the game, where nothing showed: her pins were only on
-- the add-on's journey map. The same pins (Journey.Pins: what Willo wrote for this character, read at login or
-- /reload, and handed over during play since LOR-1292: PinsLive) now show there too, as the journey map draws them, a teal bead in a white ring, named on mouse-over:
--
--   world map  on the pin's zone, its continent and the whole-world view, kept the same size on screen however far the
--              map is zoomed;
--   minimap    while the player is on the pin's continent, where it lies around them (on the rim, dimmed, when it's
--              further than the minimap shows), turning with the minimap when it turns.
--
-- Our own frames on the map's canvas and on the minimap, placed by the client's map API (C_Map: the zone's place on its
-- continent, the continent's size in yards, the player's spot on it), so no embedded library (the Architect, 11/7) and
-- no map pin template that a client may not have. A right-click takes a pin off (PinArrive.PinMouseUp), and nothing is
-- above the game's frame-level cap.

local _, ns = ...
local T = ns.Theme
local L = ns.L

local WorldPins = {}
ns.WorldPins = WorldPins

local DISC = "Interface\\CHARACTERFRAME\\TempPortraitAlphaMask"
local DOT, RING = 11, 15            -- the bead and its ring, in pixels on screen (the journey map's PIN)
local MINI_DOT, MINI_RING = 8, 11   -- smaller on the minimap
local EVERY = 0.2                   -- seconds between the minimap's looks while the player moves
-- The minimap's width in yards at each zoom (0 = furthest out), outdoors and in: the game's own steps.
local OUTDOOR = { [0] = 466 + 2 / 3, 400, 333 + 1 / 3, 266 + 2 / 3, 200, 133 + 1 / 3 }
local INDOOR = { [0] = 300, 240, 180, 120, 80, 50 }

local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b, c, d = pcall(fn, ...)
  if ok then return a, b, c, d end
end

local function bead(parent, dot, ring)
  local b = CreateFrame("Frame", nil, parent)
  local hit = math.max(ring + 4, 16)   -- the smallest thing we ask a player to click
  b:SetSize(hit, hit)
  b.ring = b:CreateTexture(nil, "ARTWORK", nil, 0)
  b.ring:SetTexture(DISC)
  b.ring:SetPoint("CENTER")
  b.ring:SetSize(ring, ring)
  b.ring:SetVertexColor(T.rgba(T.color.mapRing))
  b.dot = b:CreateTexture(nil, "ARTWORK", nil, 1)
  b.dot:SetTexture(DISC)
  b.dot:SetPoint("CENTER")
  b.dot:SetSize(dot, dot)
  b.dot:SetVertexColor(T.rgba(T.color.mapPin))
  if b.EnableMouse then b:EnableMouse(true) end
  b:SetScript("OnEnter", function(self)
    local pin = self.pin
    if not (pin and GameTooltip) then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(pin.title or "")
    if pin.sub and pin.sub ~= "" then T.Tip(pin.sub, "tipText", true) end
    if pin.foot and pin.foot ~= "" then T.Tip(pin.foot, "tipDim", true) end
    T.Tip(L["Right-click to remove"], "tipDim", true)
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
  b:SetScript("OnMouseUp", function(self, button) if ns.PinArrive then ns.PinArrive.PinMouseUp(self, button) end end)
  b:Hide()
  return b
end

-- The pins to show: Journey.Pins' list ({spot = JourneyMap.Place: zone, zx, zy, cont, cx, cy; title, sub, foot}).
local function pins()
  local list = ns.Journey and ns.Journey.Pins and try(ns.Journey.Pins)
  return type(list) == "table" and list or {}
end

-- ---- The world map -----------------------------------------------------------------------------------------------

local world = { beads = {}, mapID = nil, scale = nil, w = nil, h = nil }

local function canvas()
  local f = _G.WorldMapFrame
  if not f then return nil end
  local c = f.GetCanvas and try(f.GetCanvas, f) or (f.ScrollContainer and f.ScrollContainer.Child)
  return c, f
end

-- Where a pin lies on map m, 0..1 each way, or nil when m isn't its zone, its continent or the whole-world view.
local function onWorldMap(spot, m)
  if type(spot) ~= "table" or not m then return nil end
  if spot.zone == m and spot.zx then return spot.zx, spot.zy end
  if spot.cont == m and spot.cx then return spot.cx, spot.cy end
  local world, x, y
  if ns.JourneyMap and ns.JourneyMap.OnWorld then world, x, y = ns.JourneyMap.OnWorld(spot) end
  if world == m then return x, y end
end

-- The frame level a bead takes on the world map: the map's own for a waypoint the player set, above the explored-area
-- overlay, the quest areas and the town icons, under the player's arrow (Blizzard_WorldMap's pin levels, 2000 and up).
-- Mike's QA 11/11: the canvas's level + 20 was under the overlay that covers an explored zone, so Goldshire's tooltip
-- came up on Elwynn's map with no dot (a continent has no overlay, so it showed there). A map without the levels
-- manager: above everything on its canvas.
local function beadLevel(c, f)
  local manager = f.GetPinFrameLevelsManager and try(f.GetPinFrameLevelsManager, f)
  local level = manager and manager.GetValidFrameLevel and tonumber((try(manager.GetValidFrameLevel, manager,
    "PIN_FRAME_LEVEL_WAYPOINT_LOCATION")))
  if not level then
    level = (tonumber(c:GetFrameLevel()) or 1) + 20
    for _, child in ipairs({ c:GetChildren() }) do
      if not child.pin then level = math.max(level, (tonumber(child:GetFrameLevel()) or 0) + 1) end
    end
  end
  return math.min(level, 9000)   -- under the game's cap (10000), where nothing takes a click
end

function WorldPins.RefreshWorld()
  local c, f = canvas()
  if not c then return 0 end
  local m = f.GetMapID and try(f.GetMapID, f)
  local w, h = tonumber(c:GetWidth()) or 0, tonumber(c:GetHeight()) or 0
  local scale = f.GetCanvasScale and tonumber(try(f.GetCanvasScale, f)) or 1
  if scale <= 0 then scale = 1 end
  world.mapID, world.scale, world.w, world.h = m, scale, w, h
  local level = beadLevel(c, f)
  local n = 0
  if w > 0 and h > 0 then
    for _, pin in ipairs(pins()) do
      local x, y = onWorldMap(pin.spot, m)
      if x then
        n = n + 1
        local b = world.beads[n] or bead(c, DOT, RING)
        world.beads[n] = b
        b.pin = pin
        -- Kept the same size on screen: the canvas grows as the map zooms in, so the bead shrinks by as much,
        -- and its offset (in its own, scaled units) grows by the same.
        b:SetScale(1 / scale)
        b:SetFrameLevel(level)
        b:ClearAllPoints()
        b:SetPoint("CENTER", c, "TOPLEFT", x * w * scale, -y * h * scale)
        b:Show()
      end
    end
  end
  for i = n + 1, #world.beads do world.beads[i].pin = nil; world.beads[i]:Hide() end
  world.shown = n
  return n
end

-- The world map changes its map and zoom without telling an add-on that has no provider of the client's kind, so a
-- small frame on its canvas looks each frame it's open, and redraws only when the map, the zoom or the size changed.
local function watchWorld()
  local c, f = canvas()
  if not c or world.driver then return end
  world.driver = CreateFrame("Frame", nil, c)
  world.driver:SetScript("OnUpdate", function()
    local m = f.GetMapID and try(f.GetMapID, f)
    local scale = f.GetCanvasScale and tonumber(try(f.GetCanvasScale, f)) or 1
    if m ~= world.mapID or scale ~= world.scale or (tonumber(c:GetWidth()) or 0) ~= world.w
        or (tonumber(c:GetHeight()) or 0) ~= world.h then
      WorldPins.RefreshWorld()
    end
  end)
end

-- ---- The minimap -------------------------------------------------------------------------------------------------

local mini = { beads = {}, wait = 0 }
local yardsOf = {}

-- A continent's size in yards (its map's width and height), or nil when the client doesn't say.
local function yards(m)
  local v = yardsOf[m]
  if v == nil then
    v = false
    local M = _G.C_Map
    local w, h
    if M then w, h = try(M.GetMapWorldSize, m) end   -- (an `and` would keep only the width)
    if not (type(w) == "number" and type(h) == "number" and w > 0 and h > 0) and M and M.GetWorldPosFromMapPos then
      local vec = _G.CreateVector2D or function(x, y) return { x = x, y = y } end
      local _, a = try(M.GetWorldPosFromMapPos, m, vec(0, 0))
      local _, b = try(M.GetWorldPosFromMapPos, m, vec(1, 1))
      local ax, ay = type(a) == "table" and tonumber(a.x), type(a) == "table" and tonumber(a.y)
      local bx, by = type(b) == "table" and tonumber(b.x), type(b) == "table" and tonumber(b.y)
      if ax and ay and bx and by then w, h = math.abs(ay - by), math.abs(ax - bx) end
    end
    if type(w) == "number" and type(h) == "number" and w > 0 and h > 0 then v = { w, h } end
    yardsOf[m] = v
  end
  if v then return v[1], v[2] end
end

-- The player's spot on continent m, 0..1 each way, or nil (another continent, an instance, no position).
local function playerOn(m)
  local M = _G.C_Map
  local pos = M and try(M.GetPlayerMapPosition, m, "player")
  if type(pos) ~= "table" then return nil end
  local x, y
  if pos.GetXY then x, y = try(pos.GetXY, pos) else x, y = pos.x, pos.y end
  x, y = tonumber(x), tonumber(y)
  if x and y and (x ~= 0 or y ~= 0) then return x, y end
end

-- Where a pin lies on the minimap, in pixels from its centre (x east, y north), and whether it's past the rim:
-- nil when the player isn't on its continent.
local function onMinimap(spot, size)
  if type(spot) ~= "table" or not (spot.cont and spot.cx) then return nil end
  local px, py = playerOn(spot.cont)
  local w, h = yards(spot.cont)
  if not (px and w) then return nil end
  local east, north = (spot.cx - px) * w, (py - spot.cy) * h   -- yards: the map's y runs south
  local zoom = tonumber(Minimap.GetZoom and try(Minimap.GetZoom, Minimap)) or 0
  local steps = (_G.IsIndoors and try(_G.IsIndoors)) and INDOOR or OUTDOOR
  local across = steps[zoom] or steps[0]
  if _G.GetCVar and try(_G.GetCVar, "rotateMinimap") == "1" then
    local f = tonumber(_G.GetPlayerFacing and try(_G.GetPlayerFacing)) or 0
    local c, s = math.cos(f), math.sin(f)
    east, north = east * c + north * s, north * c - east * s
  end
  local x, y = east * size / across, north * size / across
  local d, rim = math.sqrt(x * x + y * y), size / 2 - MINI_RING / 2
  if d > rim and d > 0 then return x * rim / d, y * rim / d, true end
  return x, y, false
end

-- How far the player is from a pin, in yards, or nil (not on its continent, no position).
local function yardsTo(spot)
  if type(spot) ~= "table" or not (spot.cont and spot.cx) then return nil end
  local px, py = playerOn(spot.cont)
  local w, h = yards(spot.cont)
  if not (px and w) then return nil end
  local east, north = (spot.cx - px) * w, (py - spot.cy) * h
  return math.sqrt(east * east + north * north)
end

-- Reaching a pin (LOR-1292, Mike, 11/7: "I need a way to quickly remove the pin once I go to Goldshire"): once the player
-- has been away from it, coming within ARRIVE yards, or into its subzone within NEAR, offers Clear pin (PinArrive).
-- A pin made where they stand ("pin this spot") isn't offered until they've left it. Once a pin a session.
local ARRIVE, NEAR, AWAY = 40, 150, 120
local arrive = { away = {}, offered = {} }

local function subzone()
  local s = _G.GetSubZoneText and try(_G.GetSubZoneText)
  return type(s) == "string" and s ~= "" and s:lower() or nil
end

function WorldPins.CheckArrival()
  local sub
  for _, pin in ipairs(pins()) do
    local key = pin.key
    local d = key and not arrive.offered[key] and yardsTo(pin.spot)
    if d then
      if d > AWAY then
        arrive.away[key] = true
      elseif arrive.away[key] then
        sub = sub or subzone() or false
        local inPlace = sub and pin.place and pin.place:lower() == sub
        if (d <= ARRIVE or (inPlace and d <= NEAR)) and ns.PinArrive and ns.PinArrive.Reached(pin) then
          arrive.offered[key] = true
        end
      end
    end
  end
end

function WorldPins.RefreshMinimap()
  if not Minimap then return 0 end
  local size = tonumber(Minimap:GetWidth()) or 140
  local n = 0
  for _, pin in ipairs(pins()) do
    local x, y, far = onMinimap(pin.spot, size)
    if x then
      n = n + 1
      local b = mini.beads[n] or bead(Minimap, MINI_DOT, MINI_RING)
      mini.beads[n] = b
      b.pin = pin
      b:SetFrameLevel((tonumber(Minimap:GetFrameLevel()) or 1) + 5)
      b:ClearAllPoints()
      b:SetPoint("CENTER", Minimap, "CENTER", x, y)
      b:SetAlpha(far and 0.6 or 1)
      b:Show()
    end
  end
  for i = n + 1, #mini.beads do mini.beads[i].pin = nil; mini.beads[i]:Hide() end
  mini.shown = n
  return n
end

local function watchMinimap()
  if not Minimap or mini.driver then return end
  mini.driver = CreateFrame("Frame", nil, Minimap)
  mini.driver:SetScript("OnUpdate", function(_, elapsed)
    mini.wait = mini.wait - (tonumber(elapsed) or 0)
    if mini.wait > 0 then return end
    mini.wait = EVERY
    WorldPins.RefreshMinimap()
    WorldPins.CheckArrival()
  end)
end

-- What's shown now, for the sims and the self-test: {world = beads on the world map, minimap = beads on the minimap}.
function WorldPins.Shown() return { world = world.shown or 0, minimap = mini.shown or 0 } end

-- Once the game has the character (Journey.Pins reads their pins by it): watch both maps.
function WorldPins.Start()
  if #pins() == 0 then return end
  watchWorld()
  watchMinimap()
  WorldPins.RefreshWorld()
  WorldPins.RefreshMinimap()
end

-- Her pins changed during play (PinsLive's hand-over, or Clear pin): both maps again, and watching them if this is the
-- first pin of the session.
function WorldPins.Update()
  if #pins() > 0 then return WorldPins.Start() end
  WorldPins.RefreshWorld()
  WorldPins.RefreshMinimap()
end

local starter = CreateFrame("Frame")
starter:RegisterEvent("PLAYER_ENTERING_WORLD")
starter:SetScript("OnEvent", function()
  -- Pins cleared here that Willo has since taken out (her Data.lua written after the clear) aren't kept any longer.
  local data = _G.LoreForeverJourneyData
  if ns.Journey and ns.Journey.PrunePinsCleared and type(data) == "table" then
    pcall(ns.Journey.PrunePinsCleared, tonumber(data.pinsAt) or tonumber(data.generated))
  end
  WorldPins.Start()
end)
