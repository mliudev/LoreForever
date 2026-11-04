-- The panel's look in one place: colours, fonts, borders and the themed button, so every frame (the panel, the
-- player, the queue, Journey, the report dialog) reads as one window. "Gilded Night": the game's gold dialog border on
-- a dark ground, gold headings, dark gold-rimmed buttons. Only the game's own textures and font objects, nothing
-- bundled; font objects (not font files) so other clients' alphabets still render.
--
-- Readability floors (the accessibility pass): secondary text no darker than 0.78 grey on the dark ground, body text
-- at least GameFontHighlight (12px), click targets at least 22px, Morpheus only for headings of 14px and up. Panel
-- size (Options) scales the whole panel; nothing here calls SetScale.

local _, ns = ...
local T = {}
ns.Theme = T

-- Inline colour codes for text.
T.code = {
  gold = "|cffffd100",    -- stories, headings, what's yours
  grey = "|cff9d9d9d",    -- quest text, done, tags (≈ 6:1 on the panel; don't go darker)
  blue = "|cff88ccff",
  link = "|cff88ccff",    -- clickable names in answers (≈ 9:1 on an answer card); its own role so it can be retuned
  white = "|cffffffff",
  green = "|cff7fdf7f",   -- heard or done, only
  zone = "|cffffd100",    -- a zone's name (a chapter in Found)
  heard = "|cffcccccc",   -- a story you've heard
  faint = "|cff9d9d9d",   -- notes after a choice, a choice you can't pick (Options)
  warn = "|cffff7070",    -- why something can't be used
  stale = "|cffff7070",   -- outdated recordings (warn: it can't be used as it is)
}

-- Colours as {r, g, b, a}.
T.color = {
  gold = { 1, 0.82, 0, 1 },
  muted = { 0.8, 0.8, 0.8, 1 },          -- secondary text (notes, hints, empty states)
  faint = { 0.616, 0.616, 0.616, 1 },       -- a setting that can't be used yet (Options: Willo's, without Willo)
  rim = { 0.80, 0.62, 0.20, 0.95 },      -- button and panel rims
  rimHover = { 1, 0.82, 0, 1 },
  rimOff = { 0.616, 0.616, 0.616, 0.6 },    -- a disabled button's rim
  rule = { 1, 0.82, 0, 0.35 },           -- the line under a heading
  divider = { 1, 0.82, 0, 0.25 },        -- between sidebar and conversation
  hover = { 1, 0.82, 0, 0.14 },          -- row highlight
  select = { 1, 0.82, 0, 0.18 },         -- type-ahead selection
  target = { 1, 0.82, 0, 0.10 },         -- your target's row
  flash = { 1, 0.82, 0, 0.35 },          -- something was added
  window = { 0.059, 0.047, 0.035, 1 },     -- the window's ground where the stone texture is missing
  stoneWash = { 0.08, 0.06, 0.03, 0.40 },-- a warm darkening over the stone, so text stays readable on it
  vignette = { 0, 0, 0, 0.50 },          -- the window's edges, fading to nothing 70px in
  glow = { 0.45, 0.34, 0.16, 0.16 },     -- the warm light from the top left
  tabTop = { 1, 0.82, 0, 0.22 },         -- a selected tab's gold, fading down
  tabText = { 0.8, 0.8, 0.8, 1 },        -- an unselected tab's label
  disc = { 0.800, 0.620, 0.200, 1 },  -- the round play buttons: gilt, the one filled control
  discRing = { 0.478, 0.349, 0.071, 1 },
  discGlyph = { 0.071, 0.039, 0.016, 1 }, -- the play/pause/stop sign on them (ink)
  side = { 0, 0, 0, 0.35 },              -- the sidebar column
  bar = { 0, 0, 0, 0.30 },               -- behind the message box
  tab = { 0.200, 0.161, 0.078, 0.35 },
  tabOn = { 0.200, 0.161, 0.078, 0.9 },
  row = { 0.200, 0.161, 0.078, 0.45 },      -- list rows (Journey, history)
  chip = { 0.200, 0.161, 0.078, 0.60 },     -- suggested replies, "N more"
  button = { 0.102, 0.078, 0.051, 0.95 },
  buttonHi = { 0.200, 0.161, 0.078, 0.9 }, -- the primary button (Play)
  now = { 1, 0.82, 0, 0.22 },               -- what's playing, in the queue: gold, as everything live
  sheet = { 0.059, 0.047, 0.035, 1 },       -- the queue over the sidebar: opaque, or the list underneath shows
  overlay = { 0.059, 0.047, 0.035, 1 },    -- History and Journey over the conversation: opaque, or the chat shows through
  dock = { 0.102, 0.078, 0.051, 0.96 },     -- the player
  track = { 0.200, 0.161, 0.078, 1 },       -- the player's progress line, unfilled
  fill = { 1, 0.82, 0, 0.9 },
  toast = { 0.059, 0.047, 0.035, 0.95 },
  popup = { 0.059, 0.047, 0.035, 0.96 },    -- type-ahead, menus
  bubbleUser = { 0.45, 0.31, 0.12, 0.20 },  -- the conversation is on parchment: your question, a tan strip
  bubbleLore = { 0.949, 0.890, 0.749, 0.55 },  -- an answer, a lighter card
  bubbleHero = { 0.800, 0.620, 0.200, 0.28 },  -- the welcome card, gilt-tinted
  bubbleEdge = { 0.631, 0.478, 0.271, 0.90 },  -- an answer's edge
  none = { 0, 0, 0, 0 },
  -- Tooltip lines (on the game's tooltip, not the panel).
  tipText = { 1, 1, 1, 1 },
  tipDim = { 0.616, 0.616, 0.616, 1 },      -- hints: what a click does
  tipGood = { 0.498, 0.875, 0.498, 1 }, -- heard or done, only
  tipLive = { 1, 0.82, 0, 1 },             -- playing now, or new (gold: everything live)
  -- Elsewhere.
  playing = { 1, 0.82, 0, 1 },             -- the minimap ring while something plays
  mapMark = { 1, 0.92, 0.7, 0.9 },       -- marks on the journey map: the road
  mapEdge = { 0, 0, 0, 0.75 },           -- the road's soft dark edge
  mapBead = { 0, 0, 0, 0.65 },           -- the dark ring around a moment's bead
  mapShine = { 1, 1, 1, 0.55 },          -- the light on a bead, and its glow under the mouse
  mapRing = { 1, 1, 1, 0.9 },            -- the ring around the moment the map shows
  mapCount = { 0.08, 0.06, 0.02, 1 },    -- how many moments a bead stands for, on the bead
  mapPin = { 0.498, 0.878, 0.863, 1 },   -- a spot pinned with Willo (LOR-672): her teal, in a white ring
  willo = { 0.498, 0.878, 0.863, 1 },    -- Willo, on the dark ground
  inkWillo = { 0.114, 0.420, 0.400, 1 }, -- Willo, on parchment
  url = { 1, 1, 1, 1 },                  -- addresses to copy (Options)

  -- Ink on parchment: the book's pages (the "Illuminated Page" look) and what's written on them. Every ink below
  -- holds 4.5:1 or better on the page's darkest corner. What carries meaning (new, heard, sealed, blank) also
  -- differs by shape, never by colour alone.
  -- The paper is aged cream and tan (0.27.x was a brighter yellow, and Mike found it too bright), and the inks sit
  -- darker so each holds the contrast it had on the brighter page.
  parchment = { 0.80, 0.74, 0.62, 1 },   -- the page's ground
  paperTint = { 0.88, 0.90, 0.94, 1 },   -- QuestBG is a saturated orange; this takes it toward a softer parchment
  paperWash = { 0.85, 0.79, 0.67, 0.60 },-- a light veil over the art, so ink stays readable on its darkest parts
  gutter = { 0.27, 0.16, 0.04, 0.40 },   -- the shadow along the spine where two pages meet
  pageEdge = { 0.25, 0.14, 0.05, 0.26 }, -- a page's outer edges darken gently toward the edge (Media/Paper/EdgeX, EdgeY)
  pageGrain = { 0.30, 0.20, 0.10, 0.11 },-- a very light grain and a few fibres (Media/Paper/Grain)
  pageGround = { 0.12, 0.10, 0.07, 1 },  -- the window's ground at a page's rounded corners (Media/Paper/Corners)
  pageFadeTop = { 0.808, 0.714, 0.549, 1 },  -- the page as it looks under the conversation's top edge (its fade)
  pageFadeFoot = { 0.765, 0.671, 0.518, 1 }, -- and above its foot, where the page has darkened a little
  ink = { 0.071, 0.039, 0.016, 1 },     -- body text, names
  inkAccent = { 0.271, 0.067, 0.031, 1 }, -- titles, the row or tab you chose, what's yours (oxblood)
  inkNote = { 0.180, 0.102, 0.035, 1 },  -- sub lines, counts, notes
  inkFaded = { 0.251, 0.161, 0.067, 1 }, -- what isn't there yet (a blank page's kind), a row you can't use
  inkGreen = { 0.037, 0.22, 0.033, 1 },  -- heard or done, only
  inkLight = { 1, 0.929, 0.780, 1 },       -- text on an inked fill (a chosen chip, a ribbon)
  inkLink = { 0.071, 0.200, 0.420, 1 },  -- a lore link in an answer, on parchment
  inkHint = { 0.251, 0.161, 0.067, 1 },    -- a box's placeholder on parchment
  inkWarn = { 0.53, 0.14, 0.085, 1 },    -- why something can't be used, in words
  inkRule = { 0.631, 0.478, 0.271, 0.7 },  -- a line on parchment
  inkRim = { 0.631, 0.478, 0.271, 1 },   -- a card's edge on parchment (the Line)
  inkButton = { 0.180, 0.102, 0.035, 0.7 }, -- a paper button's edge: drawn in ink, so it reads as one to press (11/4)
  inkHover = { 0.271, 0.067, 0.031, 0.12 }, -- a row under the mouse, on parchment
  inkSelect = { 0.271, 0.067, 0.031, 0.12 },-- the row you chose
  inkTarget = { 0.271, 0.067, 0.031, 0.10 },-- your target's row
  inkRow = { 0.45, 0.31, 0.12, 0.14 },   -- list rows on parchment
  inkFlash = { 0.271, 0.067, 0.031, 0.25 }, -- something was added
  inkNow = { 0.800, 0.620, 0.200, 0.25 },          -- what's playing, in the queue on parchment: gilt
  cardFill = { 0.949, 0.890, 0.749, 0.85 }, -- a page's card in Found today (until the cards of V2)
  cardBlank = { 0.949, 0.890, 0.749, 0.45 },
  tileFill = { 0.949, 0.890, 0.749, 0.90 }, -- a found page's card
  tileBlank = { 0.35, 0.16, 0.05, 0.10 },-- a page not found yet
  chipFill = { 0.741, 0.639, 0.439, 0.70 }, -- a filter chip on parchment
  chipOn = { 0.271, 0.067, 0.031, 0.9 },   -- the chosen one
  meterTrack = { 0.35, 0.16, 0.05, 0.15 },
  meterTrackDark = { 0.059, 0.047, 0.035, 1 },
  wax = { 0.620, 0.161, 0.102, 1 },         -- the seal's wax (a sealed passage, every story heard)
  waxHi = { 0.800, 0.302, 0.220, 1 },       -- its highlight
  gilt = { 0.800, 0.620, 0.200, 1 },        -- the gold seal (every place found)
  giltHi = { 0.922, 0.800, 0.439, 1 },
  ringGreen = { 0.180, 0.478, 0.200, 1 },
  newMark = { 0.800, 0.620, 0.200, 1 },     -- new: a card's ring, the count on a bookmark, the New pages row (gilt)
  newMarkText = { 0.071, 0.039, 0.016, 1 }, -- a count on it
  dotGreen = { 0.180, 0.478, 0.200, 1 },  -- a heard page's dot (with a light tick on it)
  dotTick = { 1, 0.929, 0.780, 1 },      -- the tick on it
  ribbon = { 0.48, 0.12, 0.08, 1 },      -- a bookmark's ribbon: red, and gold while it's the open one
  ribbonLo = { 0.35, 0.08, 0.05, 1 },
  ribbonOn = { 0.800, 0.620, 0.200, 1 },
  ribbonOnLo = { 0.478, 0.349, 0.071, 1 },
  ribbonText = { 1, 0.929, 0.780, 1 },
  meterRust = { 0.620, 0.161, 0.102, 1 },   -- pages found, on parchment
  meterRustHi = { 0.800, 0.302, 0.220, 1 },
  meterGreen = { 0.180, 0.478, 0.200, 1 },  -- pages heard
  meterGreenHi = { 0.42, 0.75, 0.35, 1 },
  meterGold = { 0.800, 0.620, 0.200, 1 },   -- on the dark ground
  meterGoldHi = { 1, 0.82, 0, 1 },
}

local function rgba(c) return c[1], c[2], c[3], c[4] or 1 end
T.rgba = rgba

-- Inline colour codes for the inks, made from the colours above (one place to retune them).
for role, code in pairs({ ink = "ink", inkAccent = "inkAccent", inkNote = "inkNote", inkFaded = "inkFaded",
    inkGreen = "inkGreen", inkLink = "inkLink", inkWarn = "inkWarn", wax = "wax" }) do
  local c = T.color[role]
  T.code[code] = string.format("|cff%02x%02x%02x", math.floor(c[1] * 255 + 0.5), math.floor(c[2] * 255 + 0.5),
    math.floor(c[3] * 255 + 0.5))
end

-- Font objects by role. Headings are Morpheus, the game's quest-title face, made from QuestTitleFontBlackShadow so
-- clients in other alphabets get their own version of it; everything else stays Friz Quadrata (GameFont*).
local function morpheus(name, size, fallback)
  local base = _G.QuestTitleFontBlackShadow or _G.QuestTitleFont
  if not (CreateFont and base and base.GetFont) then return fallback end
  local f = _G[name] or CreateFont(name)
  if f.CopyFontObject then f:CopyFontObject(base) elseif f.SetFontObject then f:SetFontObject(base) end
  local file, _, flags = base:GetFont()
  if not file then return fallback end
  f:SetFont(file, size, flags or "")
  f:SetTextColor(rgba(T.color.gold))
  f:SetShadowColor(0, 0, 0, 1)
  f:SetShadowOffset(1, -1)
  return name
end

T.font = {
  title = morpheus("LoreForeverFontTitle", 15, "GameFontNormal"),         -- the window's name in its banner
  place = morpheus("LoreForeverFontPlace", 18, "GameFontNormalLarge"),    -- where you are
  heading = morpheus("LoreForeverFontHeading", 15, "GameFontNormal"),     -- section headers, tabs
  tab14 = morpheus("LoreForeverFontTab14", 14, "GameFontNormal"),         -- tabs whose labels are long (deDE): the
  tab13 = morpheus("LoreForeverFontTab13", 13, "GameFontNormal"),         -- largest of these the four fit the book in
  tab12 = morpheus("LoreForeverFontTab12", 12, "GameFontNormalSmall"),
  tab11 = morpheus("LoreForeverFontTab11", 11, "GameFontNormalSmall"),
  answerTitle = morpheus("LoreForeverFontAnswer", 15, "GameFontNormal"),  -- an answer's first line
  initial = morpheus("LoreForeverFontInitial", 34, "GameFontNormalHuge"),  -- a paragraph's illuminated first letter
  control = "GameFontNormal",        -- gold labels that aren't headings (the player's title)
  body = "GameFontHighlight",
  small = "GameFontHighlightSmall",
  label = "GameFontNormalSmall",
  hint = "GameFontDisable",          -- the message box placeholder only
}
-- The "10" inside the player's 10-second jumps: the game's small face, smaller (it sits inside a 26-unit ring).
do
  local base = _G.GameFontNormalSmall
  if CreateFont and base and base.GetFont then
    local file, _, flags = base:GetFont()
    if file then
      local f = _G.LoreForeverFontDigits or CreateFont("LoreForeverFontDigits")
      if f.CopyFontObject then f:CopyFontObject(base) elseif f.SetFontObject then f:SetFontObject(base) end
      f:SetFont(file, 8, flags or "")
      T.font.digits = "LoreForeverFontDigits"
    end
  end
  T.font.digits = T.font.digits or "GameFontNormalSmall"
end

-- The client's Morpheus Cyrillic face lacks Ukrainian і ї є ґ. Choose its Friz face after the reading language
-- loads; a plain font object also replaces the family variants that CopyFontObject inherited from Morpheus.
function T.SetLanguageFonts(locale)
  if locale ~= "ukUA" or not CreateFont then return end
  for _, role in ipairs({ "title", "place", "heading", "tab14", "tab13", "tab12", "tab11", "answerTitle", "initial" }) do
    local name = T.font[role]
    local f = name:find("^LoreForeverFont") and _G[name]
    if f and f.GetFont then
      local _, size, flags = f:GetFont()
      local plain = _G[name .. "Ukrainian"] or CreateFont(name .. "Ukrainian")
      if plain:SetFont("Fonts\\FRIZQT___CYR.TTF", size or 15, flags or "") ~= false then
        plain:SetTextColor(f:GetTextColor())
        plain:SetShadowColor(f:GetShadowColor())
        plain:SetShadowOffset(f:GetShadowOffset())
        if f.CopyFontObject then f:CopyFontObject(plain) end
        f:SetFont("Fonts\\FRIZQT___CYR.TTF", size or 15, flags or "")
      end
    end
  end
end

-- Whether the client has a texture (GetFileIDFromPath where it exists; otherwise assume it does).
function T.HasTexture(path)
  if not GetFileIDFromPath then return true end
  local ok, id = pcall(GetFileIDFromPath, path)
  return ok and id ~= nil and id ~= 0
end

-- A vertical or horizontal gradient from c1 (bottom/left) to c2 (top/right); a flat average where the client can't.
function T.Gradient(tex, orient, c1, c2)
  c1, c2 = T.color[c1] or c1, T.color[c2] or c2
  tex:SetColorTexture(1, 1, 1, 1)
  if CreateColor and tex.SetGradient
      and pcall(tex.SetGradient, tex, orient, CreateColor(rgba(c1)), CreateColor(rgba(c2))) then
    return tex
  end
  if tex.SetGradientAlpha and pcall(tex.SetGradientAlpha, tex, orient, c1[1], c1[2], c1[3], c1[4] or 1,
      c2[1], c2[2], c2[3], c2[4] or 1) then
    return tex
  end
  tex:SetColorTexture((c1[1] + c2[1]) / 2, (c1[2] + c2[2]) / 2, (c1[3] + c2[3]) / 2, ((c1[4] or 1) + (c2[4] or 1)) / 2)
  return tex
end

-- A flat colour texture in a role.
function T.Fill(tex, role)
  tex:SetColorTexture(rgba(T.color[role] or role))
  return tex
end

function T.Area(parent, role, layer)
  return T.Fill(parent:CreateTexture(nil, layer or "BACKGROUND"), role)
end

-- A line on the game tooltip in a role (tipText, tipDim, tipGood, gold).
function T.Tip(text, role, wrap)
  local r, g, b = rgba(T.color[role] or T.color.tipText)
  GameTooltip:AddLine(text, r, g, b, wrap)
end

-- The chat prefix every Lore Forever message starts with.
T.CHAT_PREFIX = T.code.gold .. "Lore Forever:|r "

function T.Muted(fs)
  fs:SetTextColor(rgba(T.color.muted))
  return fs
end

-- How wide a font string's text is on one line, whatever its box: GetStringWidth can report only what fits in the
-- string's own width (a label measured in a narrow tab comes back cut, so the tab stays too narrow for it).
function T.TextWidth(fs)
  if not fs then return nil end
  if fs.GetUnboundedStringWidth then return tonumber(fs:GetUnboundedStringWidth()) end
  return fs.GetStringWidth and tonumber(fs:GetStringWidth()) or nil
end

-- Borders. window: the game's gold dialog frame; popup: a slim gold-edged box (type-ahead, menus, the floating
-- player); dock: just a gold rim.
local BACKDROPS = {
  -- Just the border: the ground under it is T.Ground (stone).
  window = { edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Gold-Border", edgeSize = 24,
    insets = { left = 7, right = 7, top = 7, bottom = 7 } },
  popup = { bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
    edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", tile = true, tileSize = 16, edgeSize = 12,
    insets = { left = 3, right = 3, top = 3, bottom = 3 } },
  dock = { edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 12,
    insets = { left = 3, right = 3, top = 3, bottom = 3 } },
  -- A field on parchment (the sidebar's search box): just the edge, in ink; fill it with a paper colour.
  paper = { edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 12,
    insets = { left = 3, right = 3, top = 3, bottom = 3 } },
}
T.BACKDROPS = BACKDROPS
T.BACKDROP_TEMPLATE = BackdropTemplateMixin and "BackdropTemplate" or nil

function T.Backdrop(frame, kind)
  if not frame.SetBackdrop then return frame end
  frame:SetBackdrop(BACKDROPS[kind] or BACKDROPS.popup)
  if kind == "popup" and frame.SetBackdropColor then frame:SetBackdropColor(rgba(T.color.popup)) end
  if kind ~= "window" and frame.SetBackdropBorderColor then
    frame:SetBackdropBorderColor(rgba(T.color[kind == "paper" and "inkRim" or "rim"]))
  end
  return frame
end

-- The window's ground, inside its border: dark stone (the game's rock tile, repeated rather than stretched so it holds
-- at any size), a warm wash over it so text stays readable, the edges darkening and a warm light from the top left.
-- Solid all the way through, so nothing behind the window shows. Without the stone texture: a flat dark colour.
T.STONE = "Interface\\FrameGeneral\\UI-Background-Rock"

function T.Ground(f, inset)
  inset = inset or 6
  local function layer(sub)
    local t = f:CreateTexture(nil, "BACKGROUND", nil, sub)
    t:SetPoint("TOPLEFT", inset, -inset)
    t:SetPoint("BOTTOMRIGHT", -inset, inset)
    return t
  end
  local ground = layer(-8)
  local stone = T.HasTexture(T.STONE)
  if stone then
    ground:SetTexture(T.STONE, "REPEAT", "REPEAT")
    if ground.SetHorizTile then ground:SetHorizTile(true) end
    if ground.SetVertTile then ground:SetVertTile(true) end
  else
    T.Fill(ground, "window")
  end
  f.ground, f.stone = ground, stone
  if stone then f.wash = T.Fill(layer(-7), "stoneWash") end
  -- Edges: each side fades from the vignette colour to nothing.
  local clear = { 0, 0, 0, 0 }
  local edges = {}
  local function edge(side, a1, x1, y1, a2, x2, y2, orient, from, to)
    local t = f:CreateTexture(nil, "BACKGROUND", nil, -6)
    t:SetPoint(a1, x1, y1)
    t:SetPoint(a2, x2, y2)
    if orient == "VERTICAL" then t:SetHeight(70) else t:SetWidth(70) end
    T.Gradient(t, orient, from, to)
    edges[side] = t
  end
  edge("top", "TOPLEFT", inset, -inset, "TOPRIGHT", -inset, -inset, "VERTICAL", clear, "vignette")
  edge("bottom", "BOTTOMLEFT", inset, inset, "BOTTOMRIGHT", -inset, inset, "VERTICAL", "vignette", clear)
  edge("left", "TOPLEFT", inset, -inset, "BOTTOMLEFT", inset, inset, "HORIZONTAL", "vignette", clear)
  edge("right", "TOPRIGHT", -inset, -inset, "BOTTOMRIGHT", -inset, inset, "HORIZONTAL", clear, "vignette")
  f.vignette = edges
  local glow = f:CreateTexture(nil, "BACKGROUND", nil, -5)
  glow:SetPoint("TOPLEFT", inset, -inset)
  glow:SetPoint("TOPRIGHT", f, "TOP", 80, -inset)
  glow:SetHeight(160)
  T.Gradient(glow, "VERTICAL", clear, "glow")
  f.glow = glow
  return ground
end

-- A window: the gold dialog frame on stone, a title banner across the top edge (the Game Menu's), and a close button.
-- Returns the frame; frame.titleText is the banner's text.
function T.Window(name, parent, title)
  local f = CreateFrame("Frame", name, parent or UIParent, T.BACKDROP_TEMPLATE)
  T.Backdrop(f, "window")
  T.Ground(f)
  local banner = f:CreateTexture(nil, "ARTWORK")
  banner:SetTexture("Interface\\DialogFrame\\UI-DialogBox-Header")
  banner:SetSize(220, 50)
  banner:SetPoint("TOP", 0, 11)
  local text = f:CreateFontString(nil, "OVERLAY", T.font.title)
  text:SetPoint("TOP", banner, "TOP", 0, -11)
  text:SetText(title or "")
  f.banner, f.titleText = banner, text
  f.TitleText = text   -- the name Blizzard's frame templates use, so callers can set it either way
  -- Small enough to sit in the corner above a header row that starts 30px down.
  local close = CreateFrame("Button", nil, f, "UIPanelCloseButton")
  close:SetSize(24, 24)
  close:SetPoint("TOPRIGHT", -4, -4)
  f.closeButton = close
  return f
end

-- The themed button: a UIPanelButtonTemplate (same text, fonts, sounds, enable/disable and fit-to-text widths) with
-- the red art swapped for a dark fill and a gold rim. kind "primary" is a brighter fill (the player's Play).
local function rimTex(b, layer)
  local t = b:CreateTexture(nil, layer or "BORDER")
  return t
end

local function setRim(b, c)
  for _, t in ipairs(b.rim or {}) do t:SetColorTexture(rgba(c)) end
end

-- A paper button's label: the game's button font in oxblood, no shadow; faded when it can't be pressed.
function T.PaperButtonFont()
  if T.paperFont or not (CreateFont and GameFontNormal) then return T.paperFont end
  local function font(name, role)
    local f = CreateFont(name)
    f:CopyFontObject(GameFontNormal)
    f:SetTextColor(rgba(T.color[role]))
    if f.SetShadowColor then f:SetShadowColor(0, 0, 0, 0) end
    return f
  end
  T.paperFont, T.paperFontOff = font("LoreForeverPaperButton", "inkAccent"), font("LoreForeverPaperButtonOff", "inkHint")
  return T.paperFont
end

-- kind: nil (a dark stone button), "primary" (the raised one), or "paper" (a button with words on the book's page:
-- no fill, a thin ink edge, an oxblood label, a faint oxblood wash under the mouse; the palette of 11/3; the edge in
-- ink, not tan, since 11/4: a tan one read as switched off).
function T.SkinButton(b, kind)
  if not b or b.themed then return b end
  b.themed = true
  local paper = kind == "paper"
  b.paper = paper
  -- The template's three-part art (parentKeys Left/Middle/Right), or its normal/pushed/disabled textures.
  for _, k in ipairs({ "Left", "Middle", "Right" }) do
    local t = rawget(b, k)
    if type(t) == "table" and t.SetAlpha then t:SetAlpha(0) end
  end
  for _, get in ipairs({ "GetNormalTexture", "GetPushedTexture", "GetDisabledTexture" }) do
    local t = b[get] and b[get](b)
    if type(t) == "table" and t.SetAlpha then t:SetAlpha(0) end
  end
  local bg = b:CreateTexture(nil, "BACKGROUND")
  bg:SetPoint("TOPLEFT", 1, -1)
  bg:SetPoint("BOTTOMRIGHT", -1, 1)
  T.Fill(bg, kind == "primary" and "buttonHi" or "button")
  bg:SetShown(not paper)
  b.skinBg = bg
  -- A soft top half, so it reads as raised rather than flat.
  local sheen = b:CreateTexture(nil, "BORDER")
  sheen:SetPoint("TOPLEFT", 1, -1)
  sheen:SetPoint("RIGHT", -1, 0)
  sheen:SetPoint("BOTTOM", b, "CENTER", 0, 0)
  sheen:SetColorTexture(1, 1, 1, 0.04)
  sheen:SetShown(not paper)
  -- A 1px gold rim.
  local top, bottom, left, right = rimTex(b), rimTex(b), rimTex(b), rimTex(b)
  top:SetPoint("TOPLEFT"); top:SetPoint("TOPRIGHT"); top:SetHeight(1)
  bottom:SetPoint("BOTTOMLEFT"); bottom:SetPoint("BOTTOMRIGHT"); bottom:SetHeight(1)
  left:SetPoint("TOPLEFT"); left:SetPoint("BOTTOMLEFT"); left:SetWidth(1)
  right:SetPoint("TOPRIGHT"); right:SetPoint("BOTTOMRIGHT"); right:SetWidth(1)
  b.rim = { top, bottom, left, right }
  local on = paper and T.color.inkButton or (kind == "primary" and T.color.rimHover or T.color.rim)
  local off = paper and T.color.inkRule or T.color.rimOff
  setRim(b, on)
  local hl = b:CreateTexture(nil, "HIGHLIGHT")
  hl:SetPoint("TOPLEFT", 1, -1)
  hl:SetPoint("BOTTOMRIGHT", -1, 1)
  local ox = T.color.inkAccent
  if paper then hl:SetColorTexture(ox[1], ox[2], ox[3], 0.08) else T.Fill(hl, "hover") end
  if b.SetHighlightTexture then b:SetHighlightTexture(hl) end
  -- (the label's font objects, so the game's hover and disabled fonts don't turn it gold or white again)
  if paper and b.SetNormalFontObject and T.PaperButtonFont() then
    b:SetNormalFontObject(T.paperFont)
    if b.SetHighlightFontObject then b:SetHighlightFontObject(T.paperFont) end
    if b.SetDisabledFontObject then b:SetDisabledFontObject(T.paperFontOff) end
  end
  if b.HookScript then
    b:HookScript("OnEnable", function(self) setRim(self, on) end)
    b:HookScript("OnDisable", function(self) setRim(self, off) end)
  end
  return b
end

-- A themed push button with a label.
function T.Button(parent, label, kind)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  if label then b:SetText(label) end
  return T.SkinButton(b, kind)
end

-- A page over the conversation (History, Journey): while it's open the chat underneath is hidden, so nothing of it
-- shows through, and it comes back when no such page is open.
function T.CoverChat(page)
  page:HookScript("OnShow", function()
    local UI = ns.UI
    if UI and UI.scroll then UI.scroll:Hide() end
    if UI and UI.input and UI.input.ClearFocus then UI.input:ClearFocus() end   -- the page covers the message box
  end)
  page:HookScript("OnHide", function()
    local UI = ns.UI
    if not (UI and UI.scroll) then return end
    for _, other in ipairs({ UI.historyFrame, UI.journeyPage, UI.storyPage, UI.foundPage }) do
      if other ~= page and other:IsShown() then return end
    end
    UI.scroll:Show()
  end)
end

-- A list's scroll bar on the book's page (UIPanelScrollFrameTemplate's, redrawn; Design Lead, 11/4): one slim bar in
-- ink, a tan track and a dark thumb, no arrows, `x` px right of the list (4 by default), and hidden while everything
-- fits. The wheel and dragging the thumb work as before.
function T.PaperScroll(sf, x)
  local name = sf and sf.GetName and sf:GetName()
  local bar = sf and (sf.ScrollBar or (name and _G[name .. "ScrollBar"]))
  if type(bar) ~= "table" or bar.paper then return nil end
  bar.paper = true
  local bname = bar.GetName and bar:GetName()
  for _, k in ipairs({ "ScrollUpButton", "ScrollDownButton" }) do
    local b = bar[k] or (bname and _G[bname .. k])
    if b then
      b:SetAlpha(0)
      if b.EnableMouse then b:EnableMouse(false) end
    end
  end
  local thumb = bar.ThumbTexture or (bar.GetThumbTexture and bar:GetThumbTexture())
  for _, r in ipairs({ bar:GetRegions() }) do
    if r ~= thumb and r.GetObjectType and r:GetObjectType() == "Texture" then r:SetAlpha(0) end
  end
  local track = bar:CreateTexture(nil, "BACKGROUND", nil, 1)
  track:SetPoint("TOP")
  track:SetPoint("BOTTOM")
  track:SetWidth(2)
  T.Fill(track, "inkRim")
  if thumb then
    thumb:SetColorTexture(rgba(T.color.inkNote))
    thumb:SetSize(5, 32)
  end
  bar:SetWidth(9)
  bar:ClearAllPoints()
  bar:SetPoint("TOPLEFT", sf, "TOPRIGHT", x or 4, -2)
  bar:SetPoint("BOTTOMLEFT", sf, "BOTTOMRIGHT", x or 4, 2)
  local function fit(self)
    local r = self.GetVerticalScrollRange and tonumber(self:GetVerticalScrollRange()) or 0
    bar:SetShown(r >= 1)
  end
  sf:HookScript("OnScrollRangeChanged", fit)
  fit(sf)
  return bar
end

-- An outline in a role, drawn inside the frame's edges (`thick` px wide, 1 by default). `grow` pushes it out past the
-- edges by that many px, for a ring around a card. Returns something with SetShown and SetColor.
function T.Outline(frame, role, layer, thick, grow)
  thick, grow = thick or 1, grow or 0
  local lines = {}
  for i = 1, 4 do lines[i] = T.Area(frame, role, layer or "BORDER") end
  local top, bottom, left, right = lines[1], lines[2], lines[3], lines[4]
  top:SetPoint("TOPLEFT", -grow, grow); top:SetPoint("TOPRIGHT", grow, grow); top:SetHeight(thick)
  bottom:SetPoint("BOTTOMLEFT", -grow, -grow); bottom:SetPoint("BOTTOMRIGHT", grow, -grow); bottom:SetHeight(thick)
  left:SetPoint("TOPLEFT", -grow, grow); left:SetPoint("BOTTOMLEFT", -grow, -grow); left:SetWidth(thick)
  right:SetPoint("TOPRIGHT", grow, grow); right:SetPoint("BOTTOMRIGHT", grow, -grow); right:SetWidth(thick)
  local o = { lines = lines }
  function o:SetShown(v) for _, t in ipairs(lines) do t:SetShown(v) end end
  function o:SetColor(c) for _, t in ipairs(lines) do T.Fill(t, c) end end
  return o
end

-- Your target's row: a faint gold wash (the returned texture) and a gold bar down its left edge (wash.bar). Show and
-- hide both with T.ShowMark. `ink`: on parchment, in ink red.
function T.TargetMark(row, ink)
  local wash = T.Area(row, ink and "inkTarget" or "target")
  wash:SetAllPoints()
  local bar = T.Area(row, ink and "inkAccent" or "gold", "BORDER")
  bar:SetPoint("TOPLEFT")
  bar:SetPoint("BOTTOMLEFT")
  bar:SetWidth(2)
  wash.bar = bar
  T.ShowMark(wash, false)
  return wash
end

-- The row you chose in a list on parchment (Found's chapters, the Road's zones, Storylines): an oxblood wash and the
-- oxblood bar down its left edge, the same in every list (Design Lead, 11/4). Show and hide it with T.ShowMark.
function T.SelectMark(row)
  local wash = T.Area(row, "inkSelect")
  wash:SetAllPoints()
  local bar = T.Area(row, "inkAccent", "BORDER")
  bar:SetPoint("TOPLEFT")
  bar:SetPoint("BOTTOMLEFT")
  bar:SetWidth(2)
  wash.bar = bar
  T.ShowMark(wash, false)
  return wash
end

-- Where you are, on a list of chapters (Found, Road): a thin tan bar down the row's left edge, no wash, so it never
-- reads as a second selected row (Design Lead, 11/4); its tooltip says "You are here". Show it with T.ShowMark.
function T.HereMark(row)
  local bar = T.Area(row, "inkRim", "BORDER")
  bar:SetPoint("TOPLEFT")
  bar:SetPoint("BOTTOMLEFT")
  bar:SetWidth(2)
  bar:Hide()
  return bar
end

function T.ShowMark(mark, shown)
  mark:SetShown(shown and true or false)
  if mark.bar then mark.bar:SetShown(shown and true or false) end
end

-- Sidebar tabs. Selected: gold fading down from its top, a gold rim and underline, gold text. The others: no fill,
-- muted gold text. T.TabDecor adds the pieces once; T.SetTabSelected switches them. `ink`: a filter chip on
-- parchment, as Found's are (a pick looks the same everywhere, the palette of 11/3): a tan chip, oxblood once picked,
-- its label light on it.
function T.TabDecor(tab, ink)
  if tab.top then return end
  tab.ink = ink and true or false
  local top = tab:CreateTexture(nil, "BACKGROUND", nil, 1)
  top:SetAllPoints()
  if ink then
    T.Fill(top, "chipOn")
    tab.chip = T.Area(tab, "chipFill", "BACKGROUND")
    tab.chip:SetAllPoints()
  else
    T.Gradient(top, "VERTICAL", { 1, 0.82, 0, 0 }, "tabTop")
    tab.rim = T.Outline(tab, "rule")
  end
  tab.top = top
end

function T.SetTabSelected(tab, selected)
  selected = selected and true or false
  if tab.bg then tab.bg:SetShown(false) end
  if tab.top then tab.top:SetShown(selected) end
  if tab.rim then tab.rim:SetShown(selected) end
  if tab.on then tab.on:SetShown(selected) end
  if tab.chip then tab.chip:SetShown(not selected) end
  if tab.text and tab.text.SetTextColor then
    local role = tab.ink and (selected and "inkLight" or "ink") or (selected and "gold" or "tabText")
    tab.text:SetTextColor(rgba(T.color[role]))
  end
  tab.selected = selected
end

-- A themed push button showing that its page is open (Journey, History): the selected tab's gold fill and a bright rim.
function T.SetButtonSelected(b, selected)
  if not (b and b.skinBg) then return end
  selected = selected and true or false
  T.Fill(b.skinBg, selected and "tabOn" or "button")
  setRim(b, selected and T.color.rimHover or T.color.rim)
  b.selected = selected
end

-- The light tick on a heard dot (our own art, Media/Paper/Tick), size px, centred on `parent`, over its green.
-- (T.PAPER_ART is set further down: the path is looked up when a tick is made)
function T.HeardTick(parent, size, layer)
  local t = parent:CreateTexture(nil, layer or "OVERLAY", nil, 3)
  t:SetTexture(T.PAPER_ART .. "Tick")
  t:SetSize(size, size)
  t:SetPoint("CENTER")
  t:SetVertexColor(rgba(T.color.dotTick))
  return t
end

-- A round icon button: a gold disc with a dark sign on it (play, pause or stop; T.SetIcon). The sign is drawn, so
-- nothing but the disc depends on a texture; without that texture it's a gold square. `label` is a hidden text for
-- what it does (its tooltip says it too). look "paper": drawn in the page's ink as the pill's one half is (T.Pill): a
-- thin tan ring, no fill, an oxblood sign, a faint oxblood wash and an oxblood ring under the mouse; gilt with an ink
-- stop square while it plays. look "stone": the pill's round half on the dark ground (the player's previous and next,
-- the quest window's play on its dark title band): a dark fill in the gold rim, a gold sign; gilt with an ink stop
-- square while it plays. The player's own play stays the plain gilt disc, its one filled control.
T.DISC = "Interface\\CHARACTERFRAME\\TempPortraitAlphaMask"
T.STATUSBAR = "Interface\\TargetingFrame\\UI-StatusBar"   -- the player's progress line
T.ARROW = "Interface\\ChatFrame\\ChatFrameExpandArrow"

function T.RoundButton(parent, size, look)
  local b = CreateFrame("Button", nil, parent)
  b:SetSize(size, size)
  b.themed, b.look = true, look
  local hasDisc = T.HasTexture(T.DISC)
  local function circle(layer, sub, inset, role)
    local t = b:CreateTexture(nil, layer, nil, sub)
    t:SetPoint("TOPLEFT", inset, -inset)
    t:SetPoint("BOTTOMRIGHT", -inset, inset)
    if hasDisc then
      t:SetTexture(T.DISC)
      t:SetVertexColor(rgba(T.color[role] or role))
    else
      T.Fill(t, role)
    end
    return t
  end
  b.ring = circle("BACKGROUND", 0, 0, "discRing")
  b.disc = circle("BACKGROUND", 1, 1.5, "disc")
  local hl = circle("HIGHLIGHT", 0, 1.5, { 1, 1, 1, 0.25 })
  if hl.SetBlendMode then hl:SetBlendMode("ADD") end
  -- The signs: an arrow (texture, tinted dark), two bars, a square.
  local s = size
  local arrow = b:CreateTexture(nil, "ARTWORK")
  arrow:SetSize(s * 0.5, s * 0.5)
  arrow:SetPoint("CENTER", s * 0.06, 0)
  if T.HasTexture(T.ARROW) then
    arrow:SetTexture(T.ARROW)
    if arrow.SetDesaturated then arrow:SetDesaturated(true) end
    arrow:SetVertexColor(rgba(T.color.discGlyph))
  else
    T.Fill(arrow, "discGlyph")
    arrow:SetSize(s * 0.3, s * 0.3)
  end
  local bar1, bar2 = T.Area(b, "discGlyph", "ARTWORK"), T.Area(b, "discGlyph", "ARTWORK")
  bar1:SetSize(math.max(2, s * 0.12), s * 0.4); bar1:SetPoint("CENTER", -s * 0.1, 0)
  bar2:SetSize(math.max(2, s * 0.12), s * 0.4); bar2:SetPoint("CENTER", s * 0.1, 0)
  local square = T.Area(b, "discGlyph", "ARTWORK")
  square:SetSize(s * 0.34, s * 0.34)
  square:SetPoint("CENTER")
  b.signs = { play = { arrow }, pause = { bar1, bar2 }, stop = { square } }
  -- Previous and next: the arrow (turned round for previous) against a bar.
  if look == "stone" then
    for _, dir in ipairs({ "prev", "next" }) do
      local back = dir == "prev"
      local a = b:CreateTexture(nil, "ARTWORK")
      a:SetSize(s * 0.42, s * 0.42)
      a:SetPoint("CENTER", (back and 1 or -1) * s * 0.06, 0)
      if T.HasTexture(T.ARROW) then
        a:SetTexture(T.ARROW)
        if back then a:SetTexCoord(1, 0, 0, 1) end
        if a.SetDesaturated then a:SetDesaturated(true) end
        a.file = T.ARROW
      end
      local bar = b:CreateTexture(nil, "ARTWORK")
      bar:SetSize(math.max(2, s * 0.09), s * 0.34)
      bar:SetPoint("CENTER", (back and -1 or 1) * s * 0.17, 0)
      b.signs[dir] = { a, bar }
    end
    -- The 10-second jumps: a curved arrow (ours, Media/Paper/Skip; turned round for forward) around a small "10".
    for _, dir in ipairs({ "back10", "forward10" }) do
      local a = b:CreateTexture(nil, "ARTWORK")
      a:SetSize(s * 0.86, s * 0.86)
      a:SetPoint("CENTER", 0, 0)
      a:SetTexture(T.PAPER_ART .. "Skip")
      if dir == "forward10" then a:SetTexCoord(1, 0, 0, 1) end
      a.file = true
      b.signs[dir] = { a }
    end
  end
  -- What it does, as text (hidden: the sign shows it; read by the tooltip and tests).
  local label = b:CreateFontString(nil, "OVERLAY", T.font.small)
  label:SetAlpha(0)
  if b.SetFontString then b:SetFontString(label) end
  b.labelText = label
  b:SetScript("OnMouseDown", function(self) self.disc:SetPoint("TOPLEFT", 2.5, -2.5) end)
  b:SetScript("OnMouseUp", function(self) self.disc:SetPoint("TOPLEFT", 1.5, -1.5) end)
  if look then
    b.ring:SetTexture(T.RING)
    b.ring:SetPoint("TOPLEFT")
    b.ring:SetPoint("BOTTOMRIGHT")
    b.disc:SetPoint("TOPLEFT", 1, -1)
    b.disc:SetPoint("BOTTOMRIGHT", -1, 1)
    hl:Hide()
    if T.HasTexture(T.ARROW) then b.signs.play[1].file = T.ARROW end
    b:SetScript("OnMouseDown", nil)
    b:SetScript("OnMouseUp", nil)
    b:HookScript("OnEnter", function(self) self.hover = true; T.SetIcon(self, self.icon) end)
    b:HookScript("OnLeave", function(self) self.hover = false; T.SetIcon(self, self.icon) end)
    b:HookScript("OnEnable", function(self) T.SetIcon(self, self.icon) end)
    b:HookScript("OnDisable", function(self) T.SetIcon(self, self.icon) end)
  end
  T.SetIcon(b, look == "stone" and "next" or "play")
  return b
end

function T.SetIcon(b, kind)
  for k, parts in pairs(b.signs or {}) do
    for _, t in ipairs(parts) do t:SetShown(k == kind) end
  end
  b.icon = kind
  if not b.look then return end
  -- Paper: gilt with an ink sign while it plays (a stop), else no fill (a faint wash under the mouse), the page's ink.
  -- Stone: a dark fill, the gold rim (brighter under the mouse), a gold sign, dimmed while it can't be pressed.
  local C = T.color
  local edge, fill, sign
  if b.look == "stone" and kind == "stop" then
    edge, fill, sign = C.discRing, C.gilt, C.ink
  elseif b.look == "stone" then
    edge, fill, sign = b.hover and C.rimHover or C.rim, C.button, C.gold
  else
    local playing, o = kind == "stop", C.inkAccent
    edge = playing and C.ribbonOnLo or (b.hover and o or C.inkRim)
    fill = playing and C.gilt or (b.hover and { o[1], o[2], o[3], 0.08 } or nil)
    sign = playing and C.ink or o
  end
  b.ring:SetVertexColor(rgba(edge))
  b.disc:SetShown(fill ~= nil)
  if fill then b.disc:SetVertexColor(rgba(fill)) end
  local off = b.IsEnabled and not b:IsEnabled()
  for _, parts in pairs(b.signs) do
    for _, t in ipairs(parts) do
      if t.file then t:SetVertexColor(rgba(sign)) else t:SetColorTexture(rgba(sign)) end
      t:SetAlpha(off and 0.35 or 1)
    end
  end
end

-- What a row that opens something ends in: "›" in oxblood. ▶ only ever means play (Design Lead, 11/4).
function T.OpenMark(parent)
  local fs = T.Ink(parent:CreateFontString(nil, "OVERLAY", T.font.body), "inkAccent")
  fs:SetText("\226\128\186")
  return fs
end

-- The book's kit (v2 "Your Chronicle"): parchment pages, ribbons, cards, meters, seals, chips and the illuminated
-- initial, for every view that becomes a page. Nothing here runs until a view calls it, and a view builds its pieces
-- the first time it opens, never at login. Only the game's own textures (by path), nothing bundled. Keep what you
-- click at a low frame level: at the TOOLTIP strata, levels over 10000 take no clicks.

-- Writes text on parchment: ink colour in a role, no shadow. Returns the font string.
function T.Ink(fs, role)
  fs:SetTextColor(rgba(T.color[role or "ink"] or role))
  if fs.SetShadowColor then fs:SetShadowColor(0, 0, 0, 0) end
  return fs
end

-- The inks the add-on writes in on its dark ground, and the ink each one is on parchment. The conversation on the Here
-- page is written once, in the dark ground's codes; T.OnPaper turns them into ink as the text is set (same length, so
-- the typing animation's cuts still land).
local ON_PAPER = {
  ffd100 = T.code.inkAccent,   -- gold: headings, stories
  ["9d9d9d"] = T.code.inkNote, -- grey: notes, tags
  ["88ccff"] = T.code.inkLink, -- lore links
  ffffff = T.code.ink,         -- white: the text itself
  ["7fdf7f"] = T.code.inkGreen,-- heard or done
  e6cc80 = T.code.inkAccent,   -- a zone's name
  d8d8d8 = T.code.ink,         -- a story you've heard
  ["888888"] = T.code.inkFaded,-- what can't be picked
  ff7070 = T.code.inkWarn,     -- why something can't be used
  ffb347 = "|cff694004",       -- outdated recordings
}
function T.OnPaper(text)
  if type(text) ~= "string" or not text:find("|c", 1, true) then return text end
  return (text:gsub("|c[fF][fF](%x%x%x%x%x%x)", function(hex) return ON_PAPER[hex:lower()] end))
end

-- Text on parchment for a font string that gets dark-ground codes (the conversation): in ink, and its codes turned to
-- ink as it's set. Returns the font string.
function T.PaperText(fs, role)
  T.Ink(fs, role or "ink")
  if not fs.paperText then
    fs.paperText = true
    local set = fs.SetText
    fs.SetText = function(self, text, ...) return set(self, T.OnPaper(text), ...) end
  end
  return fs
end

-- A parchment page on `p` (the right page's own ground: QuestBG tinted toward paper, a gilt edge), under everything
-- else drawn on it, made to look like a page of a bound book: aged cream paper, the outer edges darkening gently, a soft
-- shadow along the spine, a very light grain, and corners that are rounded and a little worn (alpha pieces in the window's
-- ground colour over the square corner, so the curve holds at any page size). side "left" or "right" adds the spine's
-- shadow along the edge that meets the other page and keeps that edge's corners square, as they meet; a page with no
-- side is a page of its own: all four corners round. The page is p.paper, its edge p.edge (p.edge:SetShown), the
-- spine p.fold, the darkened edges p.vignette. Calling it again changes nothing. Our own art, Media/Paper
-- (scripts/paper_textures.py); `opts` { round = false, edge = units, radius = units, grain = false } for a note that
-- floats over the game world (no ground to cut the corners in) or is small.
T.PAPER = "Interface\\QuestFrame\\QuestBG"
T.PAPER_ART = "Interface\\AddOns\\LoreForever\\Media\\Paper\\"
local FOLD_W, EDGE_W, CORNER_R = 24, 30, 16
-- Where each corner sits in the Corners and CornerRim sheets (left, right, top, bottom).
local CORNER_UV = { TOPLEFT = { 0, 0.5, 0, 0.5 }, TOPRIGHT = { 0.5, 1, 0, 0.5 },
  BOTTOMLEFT = { 0, 0.5, 0.5, 1 }, BOTTOMRIGHT = { 0.5, 1, 0.5, 1 } }

local function art(p, layer, sub, file, role)
  local t = p:CreateTexture(nil, layer, nil, sub)
  t:SetTexture(T.PAPER_ART .. file)
  t:SetVertexColor(rgba(T.color[role]))
  return t
end

-- A band along one edge of `p`, fading from that edge: `file` is EdgeX (across) or EdgeY (down), `flip` turns it round
-- for the right or bottom edge.
local function band(p, sub, file, role, anchor, size, flip)
  local across = file == "EdgeX"
  local t = art(p, "BACKGROUND", sub, file, role)
  if anchor == "TOP" then t:SetPoint("TOPLEFT"); t:SetPoint("TOPRIGHT")
  elseif anchor == "BOTTOM" then t:SetPoint("BOTTOMLEFT"); t:SetPoint("BOTTOMRIGHT")
  elseif anchor == "LEFT" then t:SetPoint("TOPLEFT"); t:SetPoint("BOTTOMLEFT")
  else t:SetPoint("TOPRIGHT"); t:SetPoint("BOTTOMRIGHT") end
  if across then t:SetWidth(size) else t:SetHeight(size) end
  if across then t:SetTexCoord(flip and 1 or 0, flip and 0 or 1, 0, 1) else t:SetTexCoord(0, 1, flip and 1 or 0, flip and 0 or 1) end
  return t
end

function T.Parchment(p, side, opts)
  if p.isParchment then return p end
  p.isParchment = true
  opts = opts or {}
  local bg = p:CreateTexture(nil, "BACKGROUND")
  bg:SetAllPoints()
  T.Fill(bg, "parchment")
  p.paper = bg
  if T.HasTexture(T.PAPER) then
    local paper = p:CreateTexture(nil, "BACKGROUND", nil, 1)
    paper:SetAllPoints()
    paper:SetTexture(T.PAPER)
    paper:SetTexCoord(0, 0.586, 0, 0.655)   -- the part of QuestBG that is paper
    paper:SetVertexColor(rgba(T.color.paperTint))
    p.paper = paper
    -- The art alone runs dark in places (a 3.0:1 to 3.9:1 for the darkest ink); a light wash over it keeps every ink
    -- at 4.5:1 or better and the paper's grain still shows through.
    local wash = p:CreateTexture(nil, "BACKGROUND", nil, 2)
    wash:SetAllPoints()
    T.Fill(wash, "paperWash")
    p.wash = wash
  end
  p.edge = T.Outline(p, "rim")
  -- The spine: a soft shadow along the edge that meets the other page.
  if side == "left" or side == "right" then
    p.fold = band(p, 3, "EdgeX", "gutter", side == "left" and "RIGHT" or "LEFT", FOLD_W, side == "left")
  end
  -- The outer edges, darker: not along the spine.
  local w = opts.edge or EDGE_W
  p.vignette = {
    top = band(p, 4, "EdgeY", "pageEdge", "TOP", w, false),
    bottom = band(p, 4, "EdgeY", "pageEdge", "BOTTOM", w, true),
  }
  if side ~= "right" then p.vignette.left = band(p, 4, "EdgeX", "pageEdge", "LEFT", w, false) end
  if side ~= "left" then p.vignette.right = band(p, 4, "EdgeX", "pageEdge", "RIGHT", w, true) end
  -- A very light grain, tiled at its own size.
  if opts.grain ~= false then
    local grain = art(p, "BACKGROUND", 5, "Grain", "pageGrain")
    grain:SetAllPoints()
    grain:SetTexture(T.PAPER_ART .. "Grain", "REPEAT", "REPEAT")
    if grain.SetHorizTile then grain:SetHorizTile(true) end
    if grain.SetVertTile then grain:SetVertTile(true) end
    p.grain = grain
  end
  -- Rounded, slightly worn corners, but not along the spine (the pages meet there).
  if opts.round ~= false then
    local r = opts.radius or CORNER_R
    p.corners = {}
    for corner, uv in pairs(CORNER_UV) do
      local atSpine = (side == "left" and corner:find("RIGHT", 1, true)) or (side == "right" and corner:find("LEFT", 1, true))
      if not atSpine then
        local cut = art(p, "BORDER", 5, "Corners", "pageGround")
        local rim = art(p, "BORDER", 6, "CornerRim", "rim")
        for _, t in ipairs({ cut, rim }) do
          t:SetSize(r, r)
          t:SetPoint(corner)
          t:SetTexCoord(uv[1], uv[2], uv[3], uv[4])
        end
        p.corners[#p.corners + 1] = cut
        p.corners[#p.corners + 1] = rim
      end
    end
  end
  return p
end

-- The icons of the five kinds of page. An item and a storyline are the game's own art; a place, a person and a quest are
-- drawn (T.Glyph, below), because the game has no icon for them that stays sharp and readable at card size, so only
-- those two have a texture here. A path the client lacks falls back to the question mark. T.KindIcon(kind) is the
-- texture to draw (a kind's name, or a texture path passed through).
T.KIND_ICON = {
  item = "Interface\\Icons\\INV_Misc_Bag_08",
  storyline = "Interface\\Icons\\INV_Misc_Book_09",
}
local UNKNOWN_ICON = "Interface\\Icons\\INV_Misc_QuestionMark"

function T.KindIcon(kind)
  local path = T.KIND_ICON[kind] or kind
  if type(path) ~= "string" then return UNKNOWN_ICON end
  return T.HasTexture(path) and path or UNKNOWN_ICON
end

-- A bookmark tab on the book's edge (Mike's pick, 11/4, board 2 "Your pick"): the four are one size with even gaps
-- (UI.FitRibbons sets the size), each label centred in the heading face, running down the tab (one line turned
-- sideways; one letter to a line where the client can't turn text, and for CJK). The open one is the page's paper
-- with an oxblood label, and joins the page; the others are stone in a gold rim with muted labels. "New" is one small
-- gold dot near the tab's outer end, never a number, and it never moves the label.
--   r:SetLabel(text)  r:SetOn(bool)  r:SetCount(n)  r:SetLength(px)   (n > 0 shows the dot; the count stays in Found)
-- Anchor it by its top left. `horizontal` writes the label across instead of down (a narrow window).
local RIBBON_PAD, RIBBON_W = 8, 26
T.color.tabPaper = { 0.851, 0.788, 0.671, 1 }   -- the open tab: the page's paper (#d9c9ab)
T.color.tabStone = { 0.200, 0.161, 0.078, 1 }   -- the others: stone (#332914)

local function utf8Chars(s)
  local out = {}
  for ch in tostring(s or ""):gmatch("[%z\1-\127\194-\244][\128-\191]*") do out[#out + 1] = ch end
  return out
end

-- A label turns a quarter clockwise, so it reads top to bottom with the letters' tops to the right: the way the site's
-- tabs run (writing-mode: vertical-rl). (SetRotation counts counter-clockwise.)
local RIBBON_TURN = -math.pi / 2

-- A label of CJK letters alone (UTF-8 lead bytes E3 to ED: kana, Han, Hangul) stays upright, one to a line, as the
-- site's vertical tabs keep them.
local function isUpright(label)
  local s = tostring(label or "")
  if s == "" then return false end
  for ch in s:gmatch("[%z\1-\127\194-\244][\128-\191]*") do
    local lead = ch:byte(1)
    if lead < 0xE3 or lead > 0xED then return false end
  end
  return true
end

local RibbonMixin = {}

-- Lays the label out and returns the length it needs (the tab's height is the set length, or that).
function RibbonMixin:Fit()
  local fs = self.text
  -- The face: the heading's, or the largest smaller one the four fit the book in at one length (UI.FitRibbons). The
  -- ink follows (a new face brings its own colour).
  local face = self.tabFace or T.font.heading
  if self.face ~= face then fs:SetFontObject(face); self.face = face end
  fs:SetTextColor(rgba(T.color[self.on and "inkAccent" or "tabText"]))
  fs:SetShadowColor(0, 0, 0, self.on and 0 or 0.8)
  if self.horizontal then
    fs:SetWidth(0)
    fs:SetText(self.label)
    self:SetSize(math.max(22, math.floor((T.TextWidth(fs) or 30) + 18)), 22)
    fs:ClearAllPoints()
    fs:SetPoint("CENTER")
    return
  end
  local need
  local pad = RIBBON_PAD
  local turned = fs.SetRotation and not isUpright(self.label)
  if turned then
    -- One line of text turned a quarter, like a book's spine tab. The client lays text out unturned, so the tab is
    -- sized by hand: its length from the string's width. The string's own box stays the text's length and turns about
    -- its centre, which is the tab's centre.
    if fs.SetWordWrap then fs:SetWordWrap(false) end
    fs:SetWidth(0)
    fs:SetText(self.label)
    local len = math.ceil(T.TextWidth(fs) or (#self.label * 7))
    fs:SetWidth(len + 2)
    fs:SetRotation(RIBBON_TURN)
    need = len + pad * 2
  else
    -- Letters one to a line: for a client with no SetRotation, and for CJK, whose letters stand upright.
    if fs.SetRotation then fs:SetRotation(0) end
    if fs.SetWordWrap then fs:SetWordWrap(true) end
    fs:SetWidth(RIBBON_W)
    fs:SetText(table.concat(utf8Chars(self.label), "\n"))
    need = math.ceil(fs:GetStringHeight() or (#utf8Chars(self.label) * 13)) + pad * 2
  end
  self.need = need
  self:SetSize(RIBBON_W, math.max(need, self.length or 0))
  fs:ClearAllPoints()
  fs:SetPoint("CENTER", self, "CENTER", 0, 0)
  return need
end

-- The length every tab shares (UI.FitRibbons).
function RibbonMixin:SetLength(px)
  self.length = px
  self:Fit()
end

function RibbonMixin:SetLabel(text)
  self.label = text or ""
  self:Fit()
end

function RibbonMixin:SetOn(on)
  self.on = on and true or false
  T.Fill(self.bg, self.on and "tabPaper" or "tabStone")
  self.join:SetShown(self.on)
  for _, t in ipairs(self.rim) do T.Fill(t, self.on and "inkRim" or "rim") end
  self:Fit()
end

function RibbonMixin:SetCount(n)
  self.countN = tonumber(n) or 0
  self.dot:SetShown(self.countN > 0)
end

-- The "new" dot: small, gold, at the tab's outer corner (its top right), inside the padding above the label, so it
-- never touches or moves it.
function RibbonMixin:NewDot()
  local d = self:CreateTexture(nil, "OVERLAY", nil, 2)
  d:SetSize(5, 5)
  d:SetPoint("TOPRIGHT", -3, -2)
  if T.HasTexture(T.DISC) then
    d:SetTexture(T.DISC)
    d:SetVertexColor(rgba(T.color.newMark))
  else
    T.Fill(d, "newMark")
  end
  d:Hide()
  return d
end

function T.Ribbon(parent, label, horizontal)
  local r = CreateFrame("Button", nil, parent)
  r.horizontal = horizontal and true or false
  r.bg = r:CreateTexture(nil, "BACKGROUND")
  r.bg:SetAllPoints()
  -- The open one joins the page: its paper runs a few px onto the page's edge, over the page's own rim.
  r.join = r:CreateTexture(nil, "BACKGROUND")
  r.join:SetPoint("TOPRIGHT", r, "TOPLEFT", 1, 0)
  r.join:SetPoint("BOTTOMRIGHT", r, "BOTTOMLEFT", 1, 0)
  r.join:SetWidth(4)
  T.Fill(r.join, "tabPaper")
  -- The rim: top, bottom and the free end (not the side that meets the book).
  local top, bottom, right = r:CreateTexture(nil, "BORDER"), r:CreateTexture(nil, "BORDER"), r:CreateTexture(nil, "BORDER")
  top:SetPoint("TOPLEFT"); top:SetPoint("TOPRIGHT"); top:SetHeight(1)
  bottom:SetPoint("BOTTOMLEFT"); bottom:SetPoint("BOTTOMRIGHT"); bottom:SetHeight(1)
  right:SetPoint("TOPRIGHT"); right:SetPoint("BOTTOMRIGHT"); right:SetWidth(1)
  r.rim = { top, bottom, right }
  local hl = r:CreateTexture(nil, "HIGHLIGHT")
  hl:SetAllPoints()
  hl:SetColorTexture(1, 0.95, 0.75, 0.12)
  r.text = r:CreateFontString(nil, "OVERLAY", T.font.heading)
  r.text:SetJustifyH("CENTER")
  if r.text.SetWordWrap then r.text:SetWordWrap(true) end
  r.text:SetShadowOffset(1, -1)
  for k, v in pairs(RibbonMixin) do r[k] = v end
  r.dot = r:NewDot()
  r.label, r.countN, r.on = label or "", 0, false
  r:SetOn(false)
  return r
end

-- Drawn pictures: a place (a map pin), a person (someone standing) and a quest (a gold "!" on a coin), put together from
-- discs and bars, so they stay sharp at any size on parchment, whether the page is found or blank. A piece is
-- { shape, x, y, w, h, slot } in a unit square from its top left: "o" is a disc (an ellipse when w and h differ), "-" a
-- bar; the slot picks its colour from `on` (a found page) or `off` (a blank one, in faded ink with the holes cut
-- through to the card). Colours are roles of T.color or colour tables.
-- Faded ink for a blank page, solid so pieces that overlap don't show; and the colour of a blank card, for the holes (a
-- piece can only cover another, not cut it).
local FADED, CUT = { 0.50, 0.38, 0.22, 1 }, { 0.76, 0.67, 0.52, 1 }
local function pinPieces()
  -- The pin: a ground shadow, the point (bars that narrow, one px or two each, so it ends in a point at any size),
  -- the head and the hole in it.
  local out = { { "o", 0.28, 0.91, 0.44, 0.08, 3 } }
  local steps = 14
  for i = 0, steps - 1 do
    local w = 0.58 * (1 - i / steps)
    out[#out + 1] = { "-", 0.5 - w / 2, 0.46 + 0.44 * i / steps, w, 0.44 / steps, 1 }
  end
  out[#out + 1] = { "o", 0.16, 0.02, 0.68, 0.62, 1 }
  out[#out + 1] = { "o", 0.38, 0.21, 0.24, 0.24, 2 }
  return out
end
local GLYPHS = {
  person = {
    on = { "ink" }, off = { FADED },
    pieces = {
      { "o", 0.37, 0.02, 0.26, 0.26, 1 },    -- the head
      { "o", 0.22, 0.28, 0.56, 0.28, 1 },    -- the shoulders
      { "-", 0.30, 0.40, 0.40, 0.24, 1 },    -- the body
      { "-", 0.20, 0.38, 0.10, 0.28, 1 },    -- the arms
      { "-", 0.70, 0.38, 0.10, 0.28, 1 },
      { "-", 0.32, 0.62, 0.16, 0.36, 1 },    -- the legs
      { "-", 0.52, 0.62, 0.16, 0.36, 1 },
    },
  },
  place = {
    on = { "wax", "inkLight", { 0.18, 0.11, 0.04, 0.30 } }, off = { FADED, CUT, CUT },
    pieces = pinPieces(),
  },
  quest = {
    on = { "ink", "gilt", "ink" }, off = { FADED, CUT, FADED },
    pieces = {
      { "o", 0.02, 0.02, 0.96, 0.96, 1 },    -- the coin's rim
      { "o", 0.10, 0.10, 0.80, 0.80, 2 },    -- the coin
      { "-", 0.41, 0.22, 0.18, 0.18, 3 },    -- the "!": a stem that narrows, and its dot
      { "-", 0.44, 0.39, 0.12, 0.14, 3 },
      { "o", 0.42, 0.62, 0.16, 0.16, 3 },
    },
  },
}

local GlyphMixin = {}

function GlyphMixin:Layout()
  local spec, w, h = self.spec, self.w, self.h
  if not (spec and w > 0 and h > 0) then return end
  local colours = self.blank and spec.off or spec.on
  for i, p in ipairs(spec.pieces) do
    local t = self.parts[i]
    if not t then
      t = self.owner:CreateTexture(nil, "ARTWORK", nil, 1)
      self.parts[i] = t
    end
    local x0, y0 = math.floor(self.x + p[2] * w + 0.5), math.floor(self.y + p[3] * h + 0.5)
    local x1, y1 = math.floor(self.x + (p[2] + p[4]) * w + 0.5), math.floor(self.y + (p[3] + p[5]) * h + 0.5)
    t:ClearAllPoints()
    t:SetPoint("TOPLEFT", self.owner, "TOPLEFT", x0, -y0)
    t:SetSize(math.max(1, x1 - x0), math.max(1, y1 - y0))
    local c = colours[p[6]]
    c = T.color[c] or c
    if p[1] == "o" and self.disc then
      t:SetTexture(T.DISC)
      t:SetVertexColor(rgba(c))
    else
      t:SetColorTexture(rgba(c))
    end
    t:SetShown(self.shown)
  end
  for i = #spec.pieces + 1, #self.parts do self.parts[i]:Hide() end
end

-- Where the picture sits: x, y (px from the owner's top left) and its size.
function GlyphMixin:SetBox(x, y, w, h)
  self.x, self.y, self.w, self.h = x, y, w, h
  self:Layout()
end

-- Draws the kind's picture; true when it has one (a place, person or quest), false (and nothing drawn) for any other.
function GlyphMixin:SetShape(kind)
  self.spec = GLYPHS[kind]
  if not self.spec then self:SetShown(false) return false end
  self:Layout()
  return true
end

function GlyphMixin:SetBlank(blank)
  blank = blank and true or false
  if blank == self.blank then return end
  self.blank = blank
  self:Layout()
end

function GlyphMixin:SetShown(shown)
  self.shown = shown and self.spec ~= nil and true or false
  for _, t in ipairs(self.parts) do t:SetShown(self.shown) end
  if self.shown then self:Layout() end
end

-- The drawn pictures as regions of `owner` (a card, a chip). Give it a place with :SetBox, then :SetShape(kind).
function T.Glyph(owner)
  local g = { owner = owner, parts = {}, x = 0, y = 0, w = 0, h = 0, shown = false, blank = false,
    disc = T.HasTexture(T.DISC) }
  for k, v in pairs(GlyphMixin) do g[k] = v end
  return g
end

-- A person's card shows the whole person, standing: a model in the card, not a head. Models cost, so a card gets one
-- when it asks (card:SetFigure(creature display id)), from a small pool, and gives it back when it is shown nothing
-- (SetFigure(nil)), hidden or blank. Until the model has loaded, and for good when the client has none for that id (a
-- display it doesn't know, a model it hasn't got), the card keeps its drawn figure, so it is never empty.
local FIGURE_MAX = 40   -- models alive at once: a screenful of cards
local figures = { free = {}, made = 0 }

local function ask(m, method, ...)
  local f = m[method]
  if type(f) == "function" then return pcall(f, m, ...) end
  return false
end

-- Whether the model has loaded. A client with no way to ask goes by its loaded event.
local function figureReady(m)
  if type(m.GetModelFileID) == "function" then
    local ok, id = pcall(m.GetModelFileID, m)
    return ok and type(id) == "number" and id > 0
  end
  return m.loadedEvent == true
end

-- The whole body, a little turned toward the viewer, standing still.
local function frameFigure(m)
  ask(m, "SetPortraitZoom", 0)
  ask(m, "SetCamDistanceScale", 1)
  ask(m, "SetPosition", 0, 0, 0)
  ask(m, "SetRotation", 0.5)
end

local function standFigure(m)
  local tile = m.tile
  if not (tile and tile.figureID == m.figureID and figureReady(m)) then return end
  frameFigure(m)
  ask(m, "SetAnimation", 0)
  ask(m, "SetPaused", true)
  m:SetAlpha(1)
  m.standing = true
  tile.glyph:SetShown(false)
end

local function releaseFigure(tile)
  local m = tile.figure
  if not m then return end
  tile.figure, m.tile, m.figureID, m.standing = nil, nil, nil, false
  m:Hide()
  m:SetScript("OnModelLoaded", nil)
  ask(m, "ClearModel")
  m:ClearAllPoints()
  m:SetParent(UIParent)
  figures.free[#figures.free + 1] = m
end

local function takeFigure()
  local m = table.remove(figures.free)
  if m then return m end
  if figures.broken or figures.made >= FIGURE_MAX then return nil end
  local ok, f = pcall(CreateFrame, "PlayerModel", nil, UIParent)
  if not (ok and f and type(f.SetDisplayInfo) == "function") then   -- a client with no way to show one: drawn figures only
    figures.broken = true
    return nil
  end
  figures.made = figures.made + 1
  return f
end

-- A card for one page: the kind's icon on a paper square. Set what it shows with tile:SetState(...):
--   "found"            the page (the default): its icon in colour
--   { new = true }     a green ring round it, not yet opened or heard
--   { heard = true }   a green dot in the corner
--   { sealed = true }  a wax disc at its foot: a passage waits further along a storyline
--   { blank = true }   not found yet: a dashed edge, an icon with no colour in it, and no name (give it none)
-- new, heard and sealed can be set together ({ new = true, sealed = true }); a state name alone ("new") sets just that
-- one. tile:SetKind(kind) changes the picture (place, person, item, quest, storyline, or a texture path): a place, a
-- person and a quest are drawn (tile.glyph), the others are the texture tile.icon. tile:SetFigure(display id) stands a
-- person's model in the card (nil takes it away). tile.over is a frame above the picture, for marks that must show over
-- a figure. Size it with SetSize (36 by default). It is a Button: add OnClick and OnEnter.
local TileMixin = {}

-- The dashed edge: 3px dashes, 3px gaps, laid out for the tile's size.
local function tileDashes(b)
  local w, h = tonumber(b:GetWidth()) or 36, tonumber(b:GetHeight()) or 36
  b.dashes = b.dashes or {}
  local n = 0
  local function dash(x, y, across, len)
    n = n + 1
    local t = b.dashes[n]
    if not t then t = T.Area(b, "inkFaded", "BORDER"); b.dashes[n] = t end
    t:ClearAllPoints()
    t:SetPoint("TOPLEFT", x, -y)
    t:SetSize(across and len or 1, across and 1 or len)
    t:Show()
  end
  for x = 0, w - 1, 6 do
    dash(x, 0, true, math.min(3, w - x))
    dash(x, h - 1, true, math.min(3, w - x))
  end
  for y = 6, h - 1, 6 do
    dash(0, y, false, math.min(3, h - y))
    dash(w - 1, y, false, math.min(3, h - y))
  end
  for i = n + 1, #b.dashes do b.dashes[i]:Hide() end
end

function TileMixin:SetKind(kind)
  self.kind = kind
  if self.picture == kind then return end   -- (a list sets the same kind again at every refresh: keep the figure standing)
  self.picture = kind
  self:SetFigure(nil)
  self.drawn = self.glyph:SetShape(kind)
  self.glyph:SetShown(self.drawn)
  self.icon:SetShown(not self.drawn)
  if not self.drawn then self.icon:SetTexture(T.KindIcon(kind)) end
end

-- Stands the person with this creature display id in the card (nothing, or nil, takes the figure away). A blank card
-- never has one. It keeps the drawn figure when there is no model to show: no free model, no such display in the
-- client, or a model that hasn't loaded.
function TileMixin:SetFigure(id)
  id = tonumber(id)
  if id and (id <= 0 or not self.drawn or (self.state and self.state.blank)) then id = nil end
  if id and self.figure and self.figureID == id then return end
  if not id and not self.figure then self.figureID = nil return end
  releaseFigure(self)
  self.figureID = id
  if self.drawn then self.glyph:SetShown(true) end
  local m = id and takeFigure()
  if not m then return end
  self.figure, m.tile, m.figureID, m.standing = m, self, id, false
  m:SetParent(self)
  m:SetFrameLevel(self:GetFrameLevel() + 1)
  m:ClearAllPoints()
  m:SetPoint("TOPLEFT", self, "TOPLEFT", 3, -3)
  m:SetPoint("BOTTOMRIGHT", self, "BOTTOMRIGHT", -3, 3)
  m:SetAlpha(0)   -- unseen until it has loaded: no half-dressed model, no empty card
  m.loadedEvent = false
  m:SetScript("OnModelLoaded", function(model) model.loadedEvent = true standFigure(model) end)
  m:Show()
  ask(m, "ClearModel")
  ask(m, "SetDisplayInfo", id)
  frameFigure(m)
  standFigure(m)   -- a model the client already had is ready now
end

function TileMixin:SetState(s)
  local flags = type(s) == "table" and s or ((type(s) == "string" and s ~= "found") and { [s] = true } or {})
  self.state = flags
  local blank = flags.blank and true or false
  T.Fill(self.bg, blank and "tileBlank" or "tileFill")
  self.edge:SetShown(not blank)
  self.icon:SetDesaturated(blank)
  self.glyph:SetBlank(blank)
  if blank then
    self:SetFigure(nil)
    self.icon:SetVertexColor(0.45, 0.33, 0.18, 0.55)
    tileDashes(self)
  else
    self.icon:SetVertexColor(1, 1, 1, 1)
    for _, d in ipairs(self.dashes or {}) do d:Hide() end
  end
  self.ring:SetShown(flags.new and not blank and true or false)
  self.dot:SetShown(flags.heard and not blank and true or false)
  self.wax:SetShown(flags.sealed and not blank and true or false)
end

function T.Tile(parent, kind)
  local b = CreateFrame("Button", nil, parent)
  b:SetSize(36, 36)
  b.bg = T.Area(b, "tileFill", "BACKGROUND")
  b.bg:SetAllPoints()
  b.edge = T.Outline(b, "inkRim")
  b.icon = b:CreateTexture(nil, "ARTWORK")
  b.icon:SetPoint("TOPLEFT", 5, -5)
  b.icon:SetPoint("BOTTOMRIGHT", -5, 5)
  b.icon:SetTexCoord(0.08, 0.92, 0.08, 0.92)
  local hl = b:CreateTexture(nil, "HIGHLIGHT")
  hl:SetAllPoints()
  hl:SetColorTexture(1, 0.95, 0.75, 0.30)
  -- New: a 2px gilt ring just outside the card.
  b.ring = T.Outline(b, "newMark", "OVERLAY", 2, 2)
  -- Heard: a green dot with a light tick on it, in the top right corner (T.HeardTick).
  b.dot = CreateFrame("Frame", nil, b)
  b.dot:SetSize(11, 11)
  b.dot:SetPoint("TOPRIGHT", -2, -2)
  local core = b.dot:CreateTexture(nil, "OVERLAY", nil, 1)
  core:SetAllPoints()
  if T.HasTexture(T.DISC) then
    core:SetTexture(T.DISC); core:SetVertexColor(rgba(T.color.dotGreen))
  else
    T.Fill(core, "dotGreen")
  end
  T.HeardTick(b.dot, 9)
  -- Sealed: a wax disc at the foot.
  b.wax = T.Seal(b, "wax", 12)
  b.wax:SetPoint("BOTTOM", 0, 3)
  -- A person's model is a frame, and a frame draws over the card's own textures: the marks that must show over it
  -- (the dot, the wax, and b.over for a caller's own) sit on frames above it.
  b.over = CreateFrame("Frame", nil, b)
  b.over:SetAllPoints()
  local level = b:GetFrameLevel()
  b.over:SetFrameLevel(level + 4)
  b.dot:SetFrameLevel(level + 3)
  b.wax:SetFrameLevel(level + 3)
  -- The drawn picture takes the icon's place.
  b.glyph = T.Glyph(b)
  b.glyph:SetBox(5, 5, 26, 26)
  for k, v in pairs(TileMixin) do b[k] = v end
  b:SetScript("OnSizeChanged", function(self)
    if self.state and self.state.blank then tileDashes(self) end
    self.glyph:SetBox(5, 5, math.max(1, (tonumber(self:GetWidth()) or 36) - 10),
      math.max(1, (tonumber(self:GetHeight()) or 36) - 10))
  end)
  b:HookScript("OnHide", function(self) self:SetFigure(nil) end)   -- a hidden card gives its model back
  b:SetKind(kind)
  b:SetState("found")
  return b
end

-- A progress bar: `kind` "found" (rust) or "heard" (green) on parchment, "gold" on the dark ground, or a pair of
-- colour roles { dark, light }. Size it with SetSize (100 x 8 by default).
--   m:SetProgress(have, total)   how far, e.g. 14 of 21 (total 0: empty)
--   m:SetValue(fraction)         0 to 1
--   m:SetKind(kind)
local METERS = {
  found = { "meterRust", "meterRustHi", "meterTrack", "inkRule" },
  heard = { "meterGreen", "meterGreenHi", "meterTrack", "inkRule" },
  gold = { "meterGold", "meterGoldHi", "meterTrackDark", "rim" },
}

local MeterMixin = {}

function MeterMixin:SetValue(v)
  v = math.max(0, math.min(1, tonumber(v) or 0))
  self.value = v
  local w = (tonumber(self:GetWidth()) or 100) - 2
  self.fill:SetShown(v > 0)
  if v > 0 then self.fill:SetWidth(math.max(2, math.floor(w * v + 0.5))) end
end

function MeterMixin:SetProgress(have, total)
  have, total = tonumber(have) or 0, tonumber(total) or 0
  self:SetValue(total > 0 and have / total or 0)
end

function MeterMixin:SetKind(kind)
  local spec = type(kind) == "table" and { kind[1], kind[2], "meterTrack", "inkRule" } or METERS[kind] or METERS.found
  T.Gradient(self.fill, "HORIZONTAL", spec[1], spec[2])
  T.Fill(self.track, spec[3])
  self.rim:SetColor(spec[4])
end

function T.Meter(parent, kind)
  local m = CreateFrame("Frame", nil, parent)
  m:SetSize(100, 8)
  m.track = T.Area(m, "meterTrack", "BACKGROUND")
  m.track:SetAllPoints()
  m.rim = T.Outline(m, "inkRule")
  m.fill = m:CreateTexture(nil, "ARTWORK")
  m.fill:SetPoint("TOPLEFT", 1, -1)
  m.fill:SetPoint("BOTTOMLEFT", 1, 1)
  for k, v in pairs(MeterMixin) do m[k] = v end
  m:SetKind(kind)
  m:SetValue(0)
  m:SetScript("OnSizeChanged", function(self) self:SetValue(self.value) end)
  return m
end

-- A wax seal: a round disc with a light spot on it when it's filled (earned, or a sealed passage), and a small faint
-- one when it's empty, so the two never differ by colour alone. kind "wax" (red, the default) or "gilt" (gold).
--   s:SetFilled(bool)   s:SetKind("wax" or "gilt")
-- 14 x 14 by default (the third argument, or SetSize, changes it).
local SealMixin = {}

function SealMixin:Layout()
  local size = math.min(tonumber(self:GetWidth()) or 14, tonumber(self:GetHeight()) or 14)
  -- One size, earned or not, so a row's marks don't jump (Design Lead, 11/4): an empty seal is the ring it fills.
  local inset = (self.filled or self.ring) and 0 or math.floor(size * 0.22 + 0.5)
  self.base:ClearAllPoints()
  self.base:SetPoint("TOPLEFT", inset, -inset)
  self.base:SetPoint("BOTTOMRIGHT", -inset, inset)
  self.shine:ClearAllPoints()
  self.shine:SetSize(math.max(2, size * 0.34), math.max(2, size * 0.34))
  self.shine:SetPoint("TOPLEFT", size * 0.2, -size * 0.2)
end

function SealMixin:SetKind(kind)
  self.kind = kind == "gilt" and "gilt" or "wax"
  local base, hi = T.color[self.kind], T.color[self.kind == "gilt" and "giltHi" or "waxHi"]
  if self.filled then
    self.base:SetVertexColor(base[1], base[2], base[3], 1)
  else
    local e = T.color.inkFaded   -- an empty seal is ink-coloured whichever kind: only a full one has its wax or gold
    self.base:SetVertexColor(e[1], e[2], e[3], self.ring and 0.9 or 0.6)
  end
  self.shine:SetVertexColor(hi[1], hi[2], hi[3], 0.9)
end

function SealMixin:SetFilled(filled)
  self.filled = filled and true or false
  self.shine:SetShown(self.filled)
  -- (the ring is our own art; without the disc art an empty seal stays the smaller square it was)
  self.ring = not self.filled and T.HasTexture(T.DISC) and T.RING ~= nil
  if T.HasTexture(T.DISC) then self.base:SetTexture(self.ring and T.RING or T.DISC) end
  self:SetKind(self.kind)
  self:Layout()
end

function T.Seal(parent, kind, size)
  local s = CreateFrame("Frame", nil, parent)
  s:SetSize(size or 14, size or 14)
  s.base = s:CreateTexture(nil, "ARTWORK")
  s.shine = s:CreateTexture(nil, "OVERLAY")
  if T.HasTexture(T.DISC) then
    s.base:SetTexture(T.DISC)
    s.shine:SetTexture(T.DISC)
  else
    s.base:SetColorTexture(1, 1, 1, 1)
    s.shine:SetColorTexture(1, 1, 1, 1)
  end
  for k, v in pairs(SealMixin) do s[k] = v end
  s.kind, s.filled = kind == "gilt" and "gilt" or "wax", true
  s:SetScript("OnSizeChanged", function(self) self:Layout() end)
  s:SetFilled(true)
  return s
end

-- A small pill with an icon and a line: "Sentinel Hill", "Listen · the Chronicler", a filter. `icon` is a kind
-- (place, person, item, quest, storyline), a texture path or nil. It sizes itself to its text.
--   c:SetText(text)  c:SetIcon(icon)  c:SetActive(bool)  (active: inked fill, light text; the chosen filter)
local ChipMixin = {}

function ChipMixin:Fit()
  local pad = self.hasIcon and 28 or 14   -- icon and gap in front, a margin behind
  self:SetWidth(math.max(36, math.ceil((T.TextWidth(self.text) or 30) + pad)))
end

function ChipMixin:SetText(text)
  self.text:SetText(text or "")
  self:Fit()
end

function ChipMixin:SetIcon(icon)
  self.hasIcon = icon ~= nil
  local drawn = self.hasIcon and self.glyph:SetShape(icon)
  self.glyph:SetShown(drawn)
  self.icon:SetShown(self.hasIcon and not drawn)
  if self.hasIcon and not drawn then self.icon:SetTexture(T.KindIcon(icon)) end
  self.text:ClearAllPoints()
  self.text:SetPoint("LEFT", self.hasIcon and 20 or 6, 0)
  self.text:SetPoint("RIGHT", -6, 0)
  self:Fit()
end

function ChipMixin:SetActive(on)
  self.active = on and true or false
  T.Fill(self.bg, self.active and "chipOn" or "chipFill")
  T.Ink(self.text, self.active and "inkLight" or "ink")
end

function T.Chip(parent, icon, text)
  local c = CreateFrame("Button", nil, parent)
  c:SetHeight(20)
  c.bg = T.Area(c, "chipFill", "BACKGROUND")
  c.bg:SetAllPoints()
  c.rim = T.Outline(c, "inkRule")
  local hl = c:CreateTexture(nil, "HIGHLIGHT")
  hl:SetAllPoints()
  hl:SetColorTexture(1, 0.95, 0.75, 0.25)
  c.icon = c:CreateTexture(nil, "ARTWORK")
  c.icon:SetSize(13, 13)
  c.icon:SetPoint("LEFT", 5, 0)
  c.icon:SetTexCoord(0.08, 0.92, 0.08, 0.92)
  c.glyph = T.Glyph(c)   -- a place, person or quest is drawn where the icon would be
  c.glyph:SetBox(5, 3.5, 13, 13)
  c.text = T.Ink(c:CreateFontString(nil, "OVERLAY", T.font.label), "ink")
  c.text:SetJustifyH("LEFT")
  if c.text.SetWordWrap then c.text:SetWordWrap(false) end
  for k, v in pairs(ChipMixin) do c[k] = v end
  c:SetIcon(icon)
  c:SetText(text)
  c:SetActive(false)
  return c
end

-- An illuminated initial: a paragraph whose first letter stands large beside its first `lines` lines, the rest
-- running on under it at full width. A game font string can't wrap round a float, so this lays the paragraph out in
-- three: d.cap (the letter), d.lead (the lines beside it) and d.rest (under it).
--   local d = T.DropCap(parent, bodyFont)
--   d:SetParagraph(text, width, lines)     lays it out and sets d's size; call again for another text or width
--   d:SetInk(role)                         the body's ink (default "ink"); the initial is always inkAccent
-- Anchor d like any frame. For several paragraphs, one DropCap for the first and plain font strings after it.
local DropMixin = {}

function DropMixin:SetInk(role)
  self.ink = role or "ink"
  T.Ink(self.lead, self.ink)
  T.Ink(self.rest, self.ink)
  T.Ink(self.cap, "inkAccent")
end

local function lineHeight(fs)
  fs:SetWidth(2000)
  fs:SetText("Mg")
  return math.max(8, fs:GetStringHeight() or 12)
end

function DropMixin:SetParagraph(text, width, lines)
  lines = lines or 3
  width = math.max(120, width or 300)
  local first, tail = tostring(text or ""):match("^%s*([%z\1-\127\194-\244][\128-\191]*)(.*)$")
  if not first then
    self.cap:SetText(""); self.lead:SetText(""); self.rest:SetText("")
    self:SetSize(width, 1)
    return
  end
  self.cap:SetText(first)
  local capW = math.ceil(T.TextWidth(self.cap) or 24) + 2   -- (close up to the letter: no gap before the word, 11/4)
  local lh = lineHeight(self.lead)
  local room = lines * lh
  self.lead:SetWidth(math.max(60, width - capW))
  -- The rest of the first word follows the initial ("ryan" after its "G"); then the most whole words that fit
  -- beside it.
  local frag, after = tail:match("^(%S*)(.*)$")
  local words = {}
  for w in after:gmatch("%S+") do words[#words + 1] = w end
  local function head(n)
    if n < 1 then return frag end
    return frag .. (frag ~= "" and " " or "") .. table.concat(words, " ", 1, n)
  end
  local lo, hi = 0, #words
  while lo < hi do
    local mid = math.ceil((lo + hi) / 2)
    self.lead:SetText(head(mid))
    if (self.lead:GetStringHeight() or 0) <= room + 1 then lo = mid else hi = mid - 1 end
  end
  self.lead:SetText(head(lo))
  local leadH = self.lead:GetStringHeight() or lh
  local restText = lo < #words and table.concat(words, " ", lo + 1) or ""
  self.rest:SetWidth(width)
  self.rest:SetText(restText)
  local restH = restText ~= "" and (self.rest:GetStringHeight() or 0) or 0
  local topH = math.max(leadH, math.ceil(lh * 2.2))   -- never shorter than the initial
  self.lead:ClearAllPoints()
  self.lead:SetPoint("TOPLEFT", self, "TOPLEFT", capW, 0)
  self.cap:ClearAllPoints()
  self.cap:SetPoint("TOPLEFT", self, "TOPLEFT", 0, 6)
  self.rest:ClearAllPoints()
  self.rest:SetPoint("TOPLEFT", self, "TOPLEFT", 0, -topH)
  self:SetSize(width, topH + restH)
end

function T.DropCap(parent, bodyFont)
  local d = CreateFrame("Frame", nil, parent)
  d.cap = d:CreateFontString(nil, "OVERLAY", T.font.initial)
  d.lead = d:CreateFontString(nil, "OVERLAY", bodyFont or T.font.body)
  d.rest = d:CreateFontString(nil, "OVERLAY", bodyFont or T.font.body)
  for _, fs in ipairs({ d.lead, d.rest }) do
    fs:SetJustifyH("LEFT")
    fs:SetJustifyV("TOP")
    if fs.SetWordWrap then fs:SetWordWrap(true) end
  end
  d.cap:SetJustifyH("LEFT")
  for k, v in pairs(DropMixin) do d[k] = v end
  d:SetInk("ink")
  return d
end


-- The Listen + playlist pill (Design Lead, 11/3, option D; Mike: "the colors are a bit too much"): one round-ended
-- control, play on its left half and the playlist's list-plus on its right, under a thin edge with a divider between.
-- On paper it's drawn in the page's ink: no fill, a tan edge, oxblood signs. On stone: a dark fill, the gold rim, gold
-- signs. Under the mouse it washes faintly and its edge darkens; while its story plays its play half fills gilt with
-- an ink stop square and the playlist half stays (T.SetPill). h: 30 by a heading, 24 on a row; each half at least 28 wide, so
-- both stay easy to hit. p.play and p.add are its buttons: the caller gives them OnClick, and their tooltips as
-- b.onEnter / b.onLeave (the pill keeps OnEnter for its hover). p.play.icon says "play" or "stop" as on T.RoundButton.
-- The edge is our own art (Media/Paper/Ring), cut in halves for the ends.
T.RING = T.PAPER_ART .. "Ring"

-- A card with round corners, as the pages and the pill have (Design Lead, 11/4: one card radius): a fill and a 1px
-- edge, each made of pieces that don't overlap (the corners are quarters of a disc and of our own ring,
-- Media/Paper/CardRing; the rest plain). Returns fill, edge: each with SetColor(role) and SetShown(on).
T.CARD_R = 8
local QUARTERS = { { "TOPLEFT", 0, 0.5, 0, 0.5 }, { "TOPRIGHT", 0.5, 1, 0, 0.5 }, { "BOTTOMLEFT", 0, 0.5, 0.5, 1 },
  { "BOTTOMRIGHT", 0.5, 1, 0.5, 1 } }
function T.RoundBox(frame)
  local r = T.CARD_R
  local disc = T.HasTexture(T.DISC) and T.DISC or nil
  local function group(layer, corner)
    local g = { parts = {} }
    local function piece(file)
      local t = frame:CreateTexture(nil, layer)
      if file then t:SetTexture(file) end
      t.file = file
      g.parts[#g.parts + 1] = t
      return t
    end
    for _, q in ipairs(QUARTERS) do
      local t = piece(corner)
      t:SetSize(r, r)
      t:SetPoint(q[1])
      if corner then t:SetTexCoord(q[2], q[3], q[4], q[5]) end
    end
    g.piece = piece
    function g:SetColor(role)
      local c = T.color[role] or role
      for _, t in ipairs(self.parts) do
        if t.file then t:SetVertexColor(rgba(c)) else t:SetColorTexture(rgba(c)) end
      end
    end
    function g:SetShown(on) for _, t in ipairs(self.parts) do t:SetShown(on and true or false) end end
    return g
  end
  local fill = group("BACKGROUND", disc)
  local mid = fill.piece()
  mid:SetPoint("TOPLEFT", r, 0); mid:SetPoint("BOTTOMRIGHT", -r, 0)
  local left, right = fill.piece(), fill.piece()
  left:SetPoint("TOPLEFT", 0, -r); left:SetPoint("BOTTOMLEFT", 0, r); left:SetWidth(r)
  right:SetPoint("TOPRIGHT", 0, -r); right:SetPoint("BOTTOMRIGHT", 0, r); right:SetWidth(r)
  local edge = group("BORDER", T.PAPER_ART .. "CardRing")
  local top, bottom, l, rr = edge.piece(), edge.piece(), edge.piece(), edge.piece()
  top:SetPoint("TOPLEFT", r, 0); top:SetPoint("TOPRIGHT", -r, 0); top:SetHeight(1)
  bottom:SetPoint("BOTTOMLEFT", r, 0); bottom:SetPoint("BOTTOMRIGHT", -r, 0); bottom:SetHeight(1)
  l:SetPoint("TOPLEFT", 0, -r); l:SetPoint("BOTTOMLEFT", 0, r); l:SetWidth(1)
  rr:SetPoint("TOPRIGHT", 0, -r); rr:SetPoint("BOTTOMRIGHT", 0, r); rr:SetWidth(1)
  return fill, edge
end

-- A close × on the book's page (Design Lead, 11/4): the pill's thin tan ring with an oxblood cross in it (our own art,
-- Media/Paper/Ring and Cross); under the mouse the ring turns oxblood over a faint wash. The game's red × stays on the
-- stone frame and the floating player. The caller gives it OnClick and its tooltip.
function T.InkClose(parent, size)
  size = size or 20
  local b = CreateFrame("Button", nil, parent)
  b:SetSize(size, size)
  local function tex(layer, file, role, inset)
    local t = b:CreateTexture(nil, layer)
    t:SetPoint("TOPLEFT", inset or 0, -(inset or 0))
    t:SetPoint("BOTTOMRIGHT", -(inset or 0), inset or 0)
    t:SetTexture(file)
    t:SetVertexColor(rgba(T.color[role] or role))
    return t
  end
  local o = T.color.inkAccent
  b.ring = tex("BORDER", T.RING, "inkRim")
  b.cross = tex("ARTWORK", T.PAPER_ART .. "Cross", "inkAccent", math.floor(size * 0.27))
  tex("HIGHLIGHT", T.DISC, { o[1], o[2], o[3], 0.08 }, 1)
  tex("HIGHLIGHT", T.RING, "inkAccent")
  return b
end

local PILL_SIGN = { [30] = 14, [24] = 12, [18] = 10 }   -- the signs' box
local function pillTint(t, c, file)
  if file then t:SetVertexColor(rgba(c)) else t:SetColorTexture(rgba(c)) end
  t:Show()
end

function T.Pill(parent, h, stone)
  local p = CreateFrame("Frame", nil, parent)
  p.h, p.half, p.stone = h, h >= 30 and 34 or 28, stone and true or false
  p:SetSize(2 * p.half, h)
  local disc = T.HasTexture(T.DISC) and T.DISC or nil
  local function piece(layer, sub, file, left, right)
    local t = p:CreateTexture(nil, layer, nil, sub)
    if file then t:SetTexture(file); t:SetTexCoord(left, right, 0, 1) end
    t.file = file
    return t
  end
  p.fill = { piece("BACKGROUND", 0, disc, 0, 0.5), piece("BACKGROUND", 0), piece("BACKGROUND", 0, disc, 0.5, 1) }
  -- (the gilt of the play half while it plays, over the fill: its round end, the run to the divider, and the other
  -- round end when the play half is all there is)
  p.lit = { piece("BACKGROUND", 1, disc, 0, 0.5), piece("BACKGROUND", 1), piece("BACKGROUND", 1, disc, 0.5, 1) }
  -- (the straight run is the ring's middle column stretched, so its lines weigh what the round ends do)
  p.edge = { piece("BORDER", 0, T.RING, 0, 0.5), piece("BORDER", 0, T.RING, 0.48, 0.52),piece("BORDER", 0, T.RING, 0.5, 1) }
  p.divider = piece("BORDER", 1)
  local function half()
    local b = CreateFrame("Button", nil, p)
    b:SetSize(p.half, h)
    b:SetScript("OnEnter", function(self) p.hover = true; T.SetPill(p); if self.onEnter then self.onEnter(self) end end)
    b:SetScript("OnLeave", function(self) p.hover = false; T.SetPill(p); if self.onLeave then self.onLeave(self) end end)
    return b
  end
  local s = PILL_SIGN[h] or math.floor(h * 0.47)
  -- Play: the arrow (texture, tinted), and the stop square.
  p.play = half()
  local arrow = p.play:CreateTexture(nil, "ARTWORK")
  arrow:SetSize(s, s)
  if T.HasTexture(T.ARROW) then
    arrow:SetTexture(T.ARROW)
    if arrow.SetDesaturated then arrow:SetDesaturated(true) end
    arrow.file = T.ARROW
  else
    arrow:SetSize(s * 0.6, s * 0.6)
  end
  local square = p.play:CreateTexture(nil, "ARTWORK")
  square:SetSize(math.floor(s * 0.6), math.floor(s * 0.6))
  p.arrow, p.square = arrow, square
  -- The playlist: three lines of a list (the last short) and a + beside them; queued, the + loses its upright (a -).
  p.add = half()
  local u = s / 14
  local function bar(w, bh, x, y)
    local t = p.add:CreateTexture(nil, "ARTWORK")
    t:SetSize(w * u, bh * u)
    t:SetPoint("TOPLEFT", p.add, "CENTER", (x - 7) * u, (7 - y) * u)
    return t
  end
  p.list = { bar(7, 1.6, 1.2, 2.2), bar(7, 1.6, 1.2, 6.2), bar(4, 1.6, 1.2, 10.2), bar(5, 1.6, 7.7, 9.7) }
  p.upright = bar(1.6, 5, 10.2, 7.2)
  -- Queued: a tick where the + was (our own art, Media/Paper/Tick); clicking takes the story out (Design Lead, 11/4).
  p.tick = bar(6.4, 6.4, 7.6, 6.6)
  p.tick:SetTexture(T.PAPER_ART .. "Tick")
  p.tick.file = true
  p.signs = { arrow, square, p.upright, p.tick, unpack(p.list) }
  T.SetPill(p, false, true, false)
  return p
end

-- Sets a pill's state (any argument left out keeps what it was): playing, canAdd (the + is there at all), queued
-- (the + is a tick) and canPlay (the play half is there; a row that can only be queued has none), then lays it out and
-- colours it. Its width is two halves or one. While it plays it keeps its size and shape: its play half fills gilt
-- with an ink stop square, and the playlist half stays (Mike's pick, 11/4, option A).
function T.SetPill(p, playing, canAdd, queued, canPlay)
  if playing ~= nil then p.playing = playing end
  if canAdd ~= nil then p.canAdd = canAdd end
  if queued ~= nil then p.queued = queued end
  if canPlay ~= nil then p.canPlay = canPlay end
  local h, r = p.h, p.h / 2
  local hasPlay = p.playing or p.canPlay ~= false
  local hasAdd = p.canAdd and true or false
  local two = hasPlay and hasAdd
  local w = two and 2 * p.half or p.half
  p:SetWidth(w)
  p.w = w   -- (its width, for callers laying text out beside it)
  p.play:ClearAllPoints()
  p.play:SetPoint("TOPLEFT")
  p.play:SetWidth(p.half)
  p.play:SetShown(hasPlay)
  p.add:ClearAllPoints()
  p.add:SetPoint("TOPRIGHT")
  p.add:SetShown(hasAdd)
  p.play.icon = p.playing and "stop" or "play"
  -- The round ends, the straight run between them, and the divider.
  local fl, fm, fr = p.fill[1], p.fill[2], p.fill[3]
  local el, em, er = p.edge[1], p.edge[2], p.edge[3]
  for _, t in ipairs({ fl, el }) do t:ClearAllPoints(); t:SetPoint("TOPLEFT"); t:SetSize(r, h) end
  for _, t in ipairs({ fr, er }) do t:ClearAllPoints(); t:SetPoint("TOPRIGHT"); t:SetSize(r, h) end
  for _, t in ipairs({ fm, em }) do t:ClearAllPoints(); t:SetPoint("TOPLEFT", r, 0); t:SetPoint("BOTTOMRIGHT", -r, 0) end
  local run = w > h
  p.divider:ClearAllPoints()
  p.divider:SetSize(1, math.floor(h * 0.47 + 0.5))
  p.divider:SetPoint("CENTER", p, "LEFT", p.half, 0)
  -- Colours: the page's ink (paper) or gold on the dark (stone); while it plays, its play half gilt, an ink square.
  local C = T.color
  local edge, fill, sign
  if p.stone then
    edge, fill, sign = p.hover and C.rimHover or C.rim, C.button, C.gold
  else
    local o = C.inkAccent
    edge, sign = p.hover and o or C.inkRim, o
    fill = p.hover and { o[1], o[2], o[3], 0.08 } or nil
  end
  for _, t in ipairs(p.fill) do
    if fill then pillTint(t, fill, t.file) else t:Hide() end
  end
  if not run then fm:Hide() end
  local ll, lm, lr = p.lit[1], p.lit[2], p.lit[3]
  for _, t in ipairs(p.lit) do t:Hide() end
  if p.playing then
    ll:ClearAllPoints(); ll:SetPoint("TOPLEFT"); ll:SetSize(r, h); pillTint(ll, C.gilt, ll.file)
    local reach = two and p.half or w - r   -- (to the divider, or to the far round end)
    if reach > r then
      lm:ClearAllPoints(); lm:SetPoint("TOPLEFT", r, 0); lm:SetSize(reach - r, h); pillTint(lm, C.gilt)
    end
    if not two then
      lr:ClearAllPoints(); lr:SetPoint("TOPRIGHT"); lr:SetSize(r, h); pillTint(lr, C.gilt, lr.file)
    end
  end
  for _, t in ipairs(p.edge) do pillTint(t, edge, t.file) end
  if not run then em:Hide() end
  if two then pillTint(p.divider, edge) else p.divider:Hide() end
  for _, t in ipairs(p.signs) do pillTint(t, sign, t.file) end
  if p.playing then pillTint(p.square, C.ink) end
  p.arrow:ClearAllPoints()
  p.arrow:SetPoint("CENTER", p.play, "CENTER", p.arrow.file and 1 or 0, 0)   -- (the arrow art sits a little left)
  p.square:ClearAllPoints()
  p.square:SetPoint("CENTER", p.play, "CENTER")
  p.arrow:SetShown(not p.playing)
  p.square:SetShown(p.playing)
  p.upright:SetShown(not p.queued)
  p.list[4]:SetShown(not p.queued)
  p.tick:SetShown(p.queued and true or false)
end
