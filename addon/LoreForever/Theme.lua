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
  green = "|cff7fdf7f",   -- playing, queued
  zone = "|cffe6cc80",    -- a zone's name in the Library
  heard = "|cffd8d8d8",   -- a story you've heard, or a question under one, in the Library
  faint = "|cff888888",   -- notes after a choice, a choice you can't pick (Options)
  warn = "|cffff7070",    -- why something can't be used
  stale = "|cffffb347",   -- outdated recordings
}

-- Colours as {r, g, b, a}.
T.color = {
  gold = { 1, 0.82, 0, 1 },
  muted = { 0.8, 0.8, 0.8, 1 },          -- secondary text (notes, hints, empty states)
  rim = { 0.80, 0.62, 0.20, 0.95 },      -- button and panel rims
  rimHover = { 1, 0.85, 0.35, 1 },
  rimOff = { 0.45, 0.40, 0.32, 0.8 },    -- a disabled button's rim
  rule = { 1, 0.82, 0, 0.35 },           -- the line under a heading
  divider = { 1, 0.82, 0, 0.25 },        -- between sidebar and conversation
  hover = { 1, 0.82, 0, 0.14 },          -- row highlight
  select = { 1, 0.82, 0, 0.18 },         -- type-ahead selection
  target = { 1, 0.82, 0, 0.10 },         -- your target's row
  flash = { 1, 0.82, 0, 0.35 },          -- something was added
  window = { 0.07, 0.06, 0.045, 1 },     -- the window's ground where the stone texture is missing
  stoneWash = { 0.08, 0.06, 0.03, 0.40 },-- a warm darkening over the stone, so text stays readable on it
  vignette = { 0, 0, 0, 0.50 },          -- the window's edges, fading to nothing 70px in
  glow = { 0.45, 0.34, 0.16, 0.16 },     -- the warm light from the top left
  tabTop = { 1, 0.82, 0, 0.22 },         -- a selected tab's gold, fading down
  tabText = { 0.85, 0.74, 0.48, 1 },     -- an unselected tab's label
  disc = { 0.98, 0.76, 0.20, 1 },        -- the round play buttons
  discRing = { 0.40, 0.26, 0.04, 1 },
  discGlyph = { 0.16, 0.09, 0.01, 1 },   -- the play/pause/stop sign on them
  side = { 0, 0, 0, 0.35 },              -- the sidebar column
  bar = { 0, 0, 0, 0.30 },               -- behind the message box
  tab = { 0.20, 0.16, 0.08, 0.35 },
  tabOn = { 0.32, 0.24, 0.06, 0.75 },
  row = { 0.20, 0.16, 0.08, 0.45 },      -- list rows (Journey, history)
  chip = { 0.22, 0.17, 0.08, 0.60 },     -- suggested replies, "N more"
  button = { 0.13, 0.10, 0.05, 0.95 },
  buttonHi = { 0.30, 0.22, 0.06, 0.95 }, -- the primary button (Play)
  add = { 0.20, 0.42, 0.14, 0.9 },       -- the green +
  added = { 0.12, 0.12, 0.12, 0.9 },     -- the + once it's in
  glyph = { 1, 1, 1, 0.9 },              -- the - and stop square drawn on it then
  now = { 0.15, 0.35, 0.17, 0.45 },      -- what's playing, in the queue
  sheet = { 0.07, 0.06, 0.04, 1 },       -- the queue over the sidebar: opaque, or the list underneath shows
  overlay = { 0.04, 0.035, 0.03, 1 },    -- History and Journey over the conversation: opaque, or the chat shows through
  dock = { 0.10, 0.08, 0.05, 0.96 },     -- the player
  track = { 0.25, 0.20, 0.12, 1 },       -- the player's progress line, unfilled
  fill = { 1, 0.82, 0, 0.9 },
  toast = { 0.05, 0.04, 0.03, 0.95 },
  popup = { 0.06, 0.05, 0.04, 0.96 },    -- type-ahead, menus
  bubbleUser = { 0.13, 0.22, 0.38, 0.85 },
  bubbleLore = { 0.12, 0.10, 0.06, 0.92 },
  bubbleHero = { 0.30, 0.22, 0.06, 0.55 },
  bubbleEdge = { 1, 0.82, 0, 0.16 },
  none = { 0, 0, 0, 0 },
  -- Tooltip lines (on the game's tooltip, not the panel).
  tipText = { 1, 1, 1, 1 },
  tipDim = { 0.62, 0.62, 0.62, 1 },      -- hints: what a click does
  tipGood = { 0.5, 0.87, 0.5, 1 },       -- narrated, heard, playing
  -- Elsewhere.
  playing = { 0.35, 1, 0.35, 1 },        -- the minimap ring while something plays
  mapMark = { 1, 0.92, 0.7, 0.9 },       -- marks on the journey map
  url = { 1, 1, 1, 1 },                  -- addresses to copy (Options)
}

local function rgba(c) return c[1], c[2], c[3], c[4] or 1 end
T.rgba = rgba

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
  answerTitle = morpheus("LoreForeverFontAnswer", 15, "GameFontNormal"),  -- an answer's first line
  control = "GameFontNormal",        -- gold labels that aren't headings (the player's title)
  body = "GameFontHighlight",
  small = "GameFontHighlightSmall",
  label = "GameFontNormalSmall",
  hint = "GameFontDisable",          -- the message box placeholder only
}

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
}
T.BACKDROPS = BACKDROPS
T.BACKDROP_TEMPLATE = BackdropTemplateMixin and "BackdropTemplate" or nil

function T.Backdrop(frame, kind)
  if not frame.SetBackdrop then return frame end
  frame:SetBackdrop(BACKDROPS[kind] or BACKDROPS.popup)
  if kind == "popup" and frame.SetBackdropColor then frame:SetBackdropColor(rgba(T.color.popup)) end
  if kind ~= "window" and frame.SetBackdropBorderColor then frame:SetBackdropBorderColor(rgba(T.color.rim)) end
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

function T.SkinButton(b, kind)
  if not b or b.themed then return b end
  b.themed = true
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
  b.skinBg = bg
  -- A soft top half, so it reads as raised rather than flat.
  local sheen = b:CreateTexture(nil, "BORDER")
  sheen:SetPoint("TOPLEFT", 1, -1)
  sheen:SetPoint("RIGHT", -1, 0)
  sheen:SetPoint("BOTTOM", b, "CENTER", 0, 0)
  sheen:SetColorTexture(1, 1, 1, 0.04)
  -- A 1px gold rim.
  local top, bottom, left, right = rimTex(b), rimTex(b), rimTex(b), rimTex(b)
  top:SetPoint("TOPLEFT"); top:SetPoint("TOPRIGHT"); top:SetHeight(1)
  bottom:SetPoint("BOTTOMLEFT"); bottom:SetPoint("BOTTOMRIGHT"); bottom:SetHeight(1)
  left:SetPoint("TOPLEFT"); left:SetPoint("BOTTOMLEFT"); left:SetWidth(1)
  right:SetPoint("TOPRIGHT"); right:SetPoint("BOTTOMRIGHT"); right:SetWidth(1)
  b.rim = { top, bottom, left, right }
  setRim(b, T.color.rim)
  local hl = b:CreateTexture(nil, "HIGHLIGHT")
  hl:SetPoint("TOPLEFT", 1, -1)
  hl:SetPoint("BOTTOMRIGHT", -1, 1)
  T.Fill(hl, "hover")
  if b.SetHighlightTexture then b:SetHighlightTexture(hl) end
  if b.HookScript then
    b:HookScript("OnEnable", function(self) setRim(self, T.color.rim) end)
    b:HookScript("OnDisable", function(self) setRim(self, T.color.rimOff) end)
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
    local h, j = UI.historyFrame, UI.journeyPage
    if (h and h ~= page and h:IsShown()) or (j and j ~= page and j:IsShown()) then return end
    UI.scroll:Show()
  end)
end

-- A 1px outline in a role, drawn inside the frame's edges. Returns something with SetShown.
function T.Outline(frame, role, layer)
  local lines = {}
  for i = 1, 4 do lines[i] = T.Area(frame, role, layer or "BORDER") end
  local top, bottom, left, right = lines[1], lines[2], lines[3], lines[4]
  top:SetPoint("TOPLEFT"); top:SetPoint("TOPRIGHT"); top:SetHeight(1)
  bottom:SetPoint("BOTTOMLEFT"); bottom:SetPoint("BOTTOMRIGHT"); bottom:SetHeight(1)
  left:SetPoint("TOPLEFT"); left:SetPoint("BOTTOMLEFT"); left:SetWidth(1)
  right:SetPoint("TOPRIGHT"); right:SetPoint("BOTTOMRIGHT"); right:SetWidth(1)
  local o = { lines = lines }
  function o:SetShown(v) for _, t in ipairs(lines) do t:SetShown(v) end end
  return o
end

-- Your target's row: a faint gold wash (the returned texture) and a gold bar down its left edge (wash.bar). Show and
-- hide both with T.ShowMark.
function T.TargetMark(row)
  local wash = T.Area(row, "target")
  wash:SetAllPoints()
  local bar = T.Area(row, "gold", "BORDER")
  bar:SetPoint("TOPLEFT")
  bar:SetPoint("BOTTOMLEFT")
  bar:SetWidth(2)
  wash.bar = bar
  T.ShowMark(wash, false)
  return wash
end

function T.ShowMark(mark, shown)
  mark:SetShown(shown and true or false)
  if mark.bar then mark.bar:SetShown(shown and true or false) end
end

-- Sidebar tabs. Selected: gold fading down from its top, a gold rim and underline, gold text. The others: no fill,
-- muted gold text. T.TabDecor adds the pieces once; T.SetTabSelected switches them.
function T.TabDecor(tab)
  if tab.top then return end
  local top = tab:CreateTexture(nil, "BACKGROUND", nil, 1)
  top:SetAllPoints()
  T.Gradient(top, "VERTICAL", { 1, 0.82, 0, 0 }, "tabTop")
  tab.top = top
  tab.rim = T.Outline(tab, "rule")
end

function T.SetTabSelected(tab, selected)
  selected = selected and true or false
  if tab.bg then tab.bg:SetShown(false) end
  if tab.top then tab.top:SetShown(selected) end
  if tab.rim then tab.rim:SetShown(selected) end
  if tab.on then tab.on:SetShown(selected) end
  if tab.text and tab.text.SetTextColor then tab.text:SetTextColor(rgba(T.color[selected and "gold" or "tabText"])) end
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

-- A round icon button: a gold disc with a dark sign on it (play, pause or stop; T.SetIcon). The sign is drawn, so
-- nothing but the disc depends on a texture; without that texture it's a gold square. `label` is a hidden text for
-- what it does (its tooltip says it too).
T.DISC = "Interface\\CHARACTERFRAME\\TempPortraitAlphaMask"
T.STATUSBAR = "Interface\\TargetingFrame\\UI-StatusBar"   -- the player's progress line
T.ARROW = "Interface\\ChatFrame\\ChatFrameExpandArrow"

function T.RoundButton(parent, size)
  local b = CreateFrame("Button", nil, parent)
  b:SetSize(size, size)
  b.themed = true
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
  -- What it does, as text (hidden: the sign shows it; read by the tooltip and tests).
  local label = b:CreateFontString(nil, "OVERLAY", T.font.small)
  label:SetAlpha(0)
  if b.SetFontString then b:SetFontString(label) end
  b.labelText = label
  b:SetScript("OnMouseDown", function(self) self.disc:SetPoint("TOPLEFT", 2.5, -2.5) end)
  b:SetScript("OnMouseUp", function(self) self.disc:SetPoint("TOPLEFT", 1.5, -1.5) end)
  T.SetIcon(b, "play")
  return b
end

function T.SetIcon(b, kind)
  for k, parts in pairs(b.signs or {}) do
    for _, t in ipairs(parts) do t:SetShown(k == kind) end
  end
  b.icon = kind
end
