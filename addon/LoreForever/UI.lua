-- The Lore Forever panel, laid out like a chat app: a sidebar with the place you're in and your quests, and a
-- conversation of question and answer bubbles with suggested replies and a message box with type-ahead.

local _, ns = ...
local UI = {}
ns.UI = UI
local L = ns.L
local function faqID(key, idx) return ns.Lang.FaqID(key, idx) end
local function faqIndex(key, original) return ns.Lang.FaqIndex(key, original) end
local T = ns.Theme   -- colours, fonts, borders and the themed button (Theme.lua)

local GOLD, GREY, BLUE, WHITE, GREEN = T.code.gold, T.code.grey, T.code.blue, T.code.white, T.code.green
-- The sidebar's inks: its pages are parchment now, so names are written in ink, not light on dark.
local INK, INK_ACCENT, INK_FADED, INK_GREEN = T.code.ink, T.code.inkAccent, T.code.inkFaded, T.code.inkGreen
-- Score thresholds. Real lore questions score 15+ with the tuned engine (tests/retrieval_check.py); these only catch
-- matches on a stray common word. Gameplay questions can't be told apart by score (they name real NPCs and quests),
-- so they're caught by wording instead (GAMEPLAY below).
local MIN_SCORE = 2.0          -- at or above: confident enough to answer
local GUESS_SCORE = 0.8        -- between this and MIN_SCORE: offer "did you mean" instead of guessing
local MAX_MESSAGES = 30        -- bubbles kept in the conversation
local W, H, SIDE_W = 820, 560, 250
local MIN_W = 800                           -- narrowest the panel can be dragged: wide enough for both pages in full (the Road's map beside its counts)
local CHAT_X = SIDE_W + 14                  -- left edge of the conversation
local BOOK_R = 36                           -- the book's right edge, from the window's: the ribbons stand in the room it leaves
local SHIFT_R = BOOK_R - 12                 -- how far that pulls in what used to reach the window's right edge
local CHAT_W = W - CHAT_X - 40 - SHIFT_R    -- conversation width (the scroll bar takes the rest)
local PAD = 8                               -- bubble padding
local PLAYER_H = 72                         -- the floating player (a box of its own, two rows)
local DOCK_PLAYER_H = 40                    -- the docked player: one row across the foot of the book
local DOCK_H = DOCK_PLAYER_H + 8            -- what the book keeps free for it (its bottom inset included)
local FOOT = DOCK_H - 8                     -- how far the foot raises everything that sat on the window's bottom edge
local BOOK_TOP = 60                         -- the book's top edge, under the title bar

local HERE_ROW, HERE_STEP = 22, 24          -- the Here list's one-line rows, and row to row (a dungeon's 9 bosses fit)
local HERE_INDENT = 26                      -- where Here names start: after the play arrow's slot
local HERE_TOP = 70                         -- the Here heading's top, from the window's top (the page starts at 60)
local N_NEXT, N_COMPLETE = 3, 6

-- Words that mark a mechanics question ("how many runs for the hammer?"). The answer is still the entry's lore,
-- introduced honestly rather than pretending to answer the mechanics.
local GAMEPLAY = {}
for w in ([[level levels drop drops loot solo stun dps tank healer spec talent talents xp experience reward rewards
  farm farming respawn spawn spawns coords coordinates bugged bug buggy price cost vendor sell runs group gear
  item items damage]]):gmatch("%a+") do GAMEPLAY[w] = true end

-- A mechanics question whose best match covers less of it than this is left unanswered (UI.Ask): the lore can't
-- answer "what's the best talent build for a hunter?".
local GAMEPLAY_COVER = 0.5

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
-- `ink`: on parchment, its text in ink and its highlight in ink red.
local function TextButton(parent, width, height, fontObject, fill, ink)
  local b = CreateFrame("Button", nil, parent)
  b:SetSize(width, height)
  if fill then
    local bg = b:CreateTexture(nil, "BACKGROUND")
    bg:SetAllPoints()
    bg:SetColorTexture(fill[1], fill[2], fill[3], fill[4])
    b.bg = bg
  end
  local hl = b:CreateTexture(nil, "HIGHLIGHT")
  hl:SetAllPoints()
  T.Fill(hl, ink and "inkHover" or "hover")
  local fs = b:CreateFontString(nil, "OVERLAY", fontObject or T.font.small)
  fs:SetPoint("TOPLEFT", 6, -2)
  fs:SetPoint("BOTTOMRIGHT", -6, 2)
  fs:SetJustifyH("LEFT")
  fs:SetJustifyV("MIDDLE")
  if fs.SetWordWrap then fs:SetWordWrap(true) end
  if ink then T.PaperText(fs, "ink") end
  b.text = fs
  return b
end

-- What the playlist button does for a story or answer right now (Mike, 2026-10-02: it always names an action, never
-- a state like "In playlist"): "add" it, "remove" it, or "stop" it when it's the one playing.
function UI.QueueAction(id)
  if not UI.PlaylistIndex(id) then return "add" end
  return (UI.speaking and UI.playingId == id) and "stop" or "remove"
end

function UI.DoQueueAction(key, idx, deferStart)
  local id = idx and (faqID(key, idx)) or key
  local action = UI.QueueAction(id)
  if action == "add" then UI.QueueLink(key, idx, deferStart)   -- (a note if it can't go in after all: a quest Forever rewrote)
  elseif action == "stop" then UI.StopAll()
  else UI.PlaylistRemove(UI.PlaylistIndex(id)) end
end

-- The tooltip for that action.
local function queueTooltip(id)
  local action = UI.QueueAction(id)
  if action == "stop" then
    GameTooltip:AddLine(L["Stop narration"])
  elseif action == "remove" then
    GameTooltip:AddLine(L["Remove from playlist"])
  else
    GameTooltip:AddLine(L["Add to playlist"])
    T.Tip(L["Adds this narration after the others in your playlist (Playlist, bottom left)."], "tipText", true)
  end
end

-- The small playlist button on a row: a green "+" adds a recorded story or answer; once it's queued a "-" takes it
-- out again, and while it plays a square stops it. SetQueueButton points it at a story (idx nil) or answer and
-- returns whether it can be queued at all.
local function QueueButton(parent, height, deferStart)
  local add = TextButton(parent, 20, height, T.font.body, T.color.add)
  add.text:SetJustifyH("CENTER")
  add.text:SetText("+")
  local minus = T.Area(add, "glyph", "OVERLAY")
  minus:SetSize(10, 2)
  minus:SetPoint("CENTER")
  add.minus = minus
  local stop = T.Area(add, "glyph", "OVERLAY")
  stop:SetSize(8, 8)
  stop:SetPoint("CENTER")
  add.stop = stop
  add:SetScript("OnClick", function(self) UI.DoQueueAction(self.key, self.idx, deferStart) end)
  add:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    queueTooltip(self.id)
    GameTooltip:Show()
  end)
  add:SetScript("OnLeave", function() GameTooltip:Hide() end)
  add:Hide()
  return add
end

local function SetQueueButton(add, key, idx)
  local can = UI.CanQueue(key, idx) and true or false
  add:SetShown(can)
  if not can then return false end
  add.id, add.key, add.idx = idx and (faqID(key, idx)) or key, key, idx
  local action = UI.QueueAction(add.id)
  add.action = action
  add.text:SetShown(action == "add")
  add.minus:SetShown(action == "remove")
  add.stop:SetShown(action == "stop")
  -- Green while it can be added; a plain dark square once it's in.
  T.Fill(add.bg, action == "add" and "add" or "added")
  return true
end

-- The small play arrow on rows with a recorded story or answer (play.idx set): plays it (and posts it in the chat),
-- or stops it.
local function PlayButton(parent)
  local play = T.RoundButton(parent, 22)   -- a gold disc with a dark arrow
  play:SetScript("OnClick", function(self)
    if self.idx then UI.PlayFaq(self.key, self.idx) else UI.PlayEntry(self.key, self.label) end
  end)
  play:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    local id = self.idx and (faqID(self.key, self.idx)) or self.key
    GameTooltip:AddLine((UI.speaking and UI.playingId == id) and L["Stop narration"] or L["Play narration"])
    GameTooltip:Show()
  end)
  play:SetScript("OnLeave", function() GameTooltip:Hide() end)
  play:Hide()
  return play
end

-- A boss's name as players know it ("Ghamoo-ra (Classic)" is "Ghamoo-ra").
local function bossName(e)
  return (e.n:gsub("%s*%b()$", ""))
end

-- A section header: gold, with a thin gold rule under it so sections read as sections. `ink`: on parchment, in ink red
-- with an ink rule.
local function Header(parent, text, ink)
  local fs = parent:CreateFontString(nil, "OVERLAY", T.font.heading)
  fs:SetText(text)
  fs:SetJustifyH("LEFT")
  if ink then T.Ink(fs, "inkAccent") end
  local rule = T.Area(parent, ink and "inkRule" or "rule", "ARTWORK")
  rule:SetHeight(1)
  rule:SetPoint("TOPLEFT", fs, "BOTTOMLEFT", 0, -3)
  rule:SetWidth(SIDE_W - 28)
  fs.rule = rule
  return fs
end

local Area = T.Area

-- Secondary text (notes, hints, empty states): light grey. The game's "disabled" grey is too dim to read on the dark
-- panel at small sizes, so keep that for the message box placeholder.
local Muted = T.Muted
-- The same on the sidebar's parchment: ink, not light grey.
local function Faint(fs) return T.Ink(fs, "inkNote") end

-- A push button in the panel's style (UIPanelButtonTemplate behaviour, gold-rimmed dark art).
local function PanelButton(parent, kind)
  return T.SkinButton(CreateFrame("Button", nil, parent, "UIPanelButtonTemplate"), kind)
end

local function settings()
  return (LoreForeverDB and LoreForeverDB.settings) or {}
end

-- Search -----------------------------------------------------------------------------------------------------------
-- One search box for every long list (Found, your quests, the queue, History, the journey page). Matching folds
-- case and accents (é = e, ß = ss) and ignores apostrophes and hyphens, so "kelthuzad" finds Kel'Thuzad; every word
-- typed has to appear in the row's text (its name, zone or quest title; with a language pack, the English name too).
local FOLD = { ["\195\159"] = "ss" }
for c, plain in pairs({ [0xA0] = "a", [0xA1] = "a", [0xA2] = "a", [0xA3] = "a", [0xA4] = "a", [0xA5] = "a",
  [0xA6] = "ae", [0xA7] = "c", [0xA8] = "e", [0xA9] = "e", [0xAA] = "e", [0xAB] = "e", [0xAC] = "i", [0xAD] = "i",
  [0xAE] = "i", [0xAF] = "i", [0xB1] = "n", [0xB2] = "o", [0xB3] = "o", [0xB4] = "o", [0xB5] = "o", [0xB6] = "o",
  [0xB8] = "o", [0xB9] = "u", [0xBA] = "u", [0xBB] = "u", [0xBC] = "u", [0xBD] = "y", [0xBF] = "y" }) do
  FOLD["\195" .. string.char(c)] = plain
end
local folded, nFolded = {}, 0

function UI.Fold(s)
  s = tostring(s or "")
  local hit = folded[s]
  if hit then return hit end
  local out = ns.Engine.lower(s:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""))
  out = out:gsub("\195[\128-\191]", FOLD):gsub("\197[\146\147]", "oe"):gsub("\226\128[\152\153]", ""):gsub("['%-]", "")
  if nFolded > 5000 then folded, nFolded = {}, 0 end
  folded[s], nFolded = out, nFolded + 1
  return out
end

-- The words of a search, folded (an empty table for no search).
function UI.SearchWords(text)
  local words = {}
  for w in UI.Fold(text):gmatch("%S+") do words[#words + 1] = w end
  return words
end

-- Whether every word in `words` appears in one of the strings given (nils are skipped). No words: everything matches.
function UI.SearchMatch(words, ...)
  if not words or #words == 0 then return true end
  local hay = {}
  for i = 1, select("#", ...) do
    local v = select(i, ...)
    if v ~= nil then hay[#hay + 1] = UI.Fold(v) end
  end
  local s = table.concat(hay, "\n")
  for _, w in ipairs(words) do
    if not s:find(w, 1, true) then return false end
  end
  return true
end

-- What an empty search result says.
function UI.NoMatchText(box)
  return string.format(L["Nothing matches '%s'."], esc(box and box.text or ""))
end

-- The box: a slim gold-edged field reading "Search..." until you type, and an × that clears it. onChange(words, box)
-- runs a moment after you stop typing, and at once when it's cleared. Escape clears it first; empty, Escape closes the
-- panel, like the message box. Enter leaves the box. It never takes focus on its own, so the panel key and the message
-- box work as before. With `scroll` (the list's scroll frame), a new search starts at the top of the list and clearing
-- it goes back to where you were. `ink`: on parchment, a paper field in ink.
function UI.SearchBox(parent, width, onChange, scroll, ink)
  local box = T.Backdrop(CreateFrame("Frame", nil, parent, T.BACKDROP_TEMPLATE), ink and "paper" or "popup")
  box:SetSize(width, 22)
  box.words, box.text = {}, ""
  if ink then
    local field = T.Area(box, "tileFill", "BACKGROUND")
    field:SetPoint("TOPLEFT", 3, -3)
    field:SetPoint("BOTTOMRIGHT", -3, 3)
  end
  local eb = CreateFrame("EditBox", nil, box)
  eb:SetPoint("TOPLEFT", 7, -2)
  eb:SetPoint("BOTTOMRIGHT", -22, 2)
  eb:SetFontObject(T.font.small)
  if ink then eb:SetTextColor(T.rgba(T.color.ink)) end
  eb:SetAutoFocus(false)
  eb:SetMaxLetters(40)
  box.edit = eb
  local hint = (ink and function(fs) return T.Ink(fs, "inkHint") end or Muted)(box:CreateFontString(nil, "OVERLAY", T.font.small))
  hint:SetPoint("LEFT", 8, 0)
  hint:SetPoint("RIGHT", -24, 0)
  hint:SetJustifyH("LEFT")
  if hint.SetWordWrap then hint:SetWordWrap(false) end
  hint:SetText(L["Search..."])
  local x = TextButton(box, 20, 20, T.font.body, nil, ink)
  x:SetPoint("RIGHT", -1, 0)
  x:SetHitRectInsets(-2, -1, -1, -1)
  x.text:ClearAllPoints()
  x.text:SetAllPoints()
  x.text:SetJustifyH("CENTER")
  x.text:SetText("\195\151")   -- ×
  x:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Clear search"])
    GameTooltip:Show()
  end)
  x:SetScript("OnLeave", function() GameTooltip:Hide() end)
  x:Hide()
  local token = 0
  local function apply()
    local text = eb:GetText() or ""
    local was = box.text
    box.text, box.words = text, UI.SearchWords(text)
    if scroll and scroll.SetVerticalScroll then
      if was == "" and text ~= "" then box.savedScroll = scroll.GetVerticalScroll and scroll:GetVerticalScroll() end
      if text == "" then
        local back = box.savedScroll
        box.savedScroll = nil
        onChange(box.words, box)
        if back then scroll:SetVerticalScroll(back) end
        return
      end
      scroll:SetVerticalScroll(0)
    end
    onChange(box.words, box)
  end
  local function update()
    local empty = (eb:GetText() or "") == ""
    hint:SetShown(empty and not (eb.HasFocus and eb:HasFocus()))
    x:SetShown(not empty)
  end
  function box:Clear()
    token = token + 1
    eb:SetText("")
    update()
    if box.text ~= "" then apply() end
  end
  function box:Active() return box.text ~= "" end
  -- Links into Found set a search without pretending the edit came from the keyboard.
  function box:SetText(text)
    token = token + 1
    eb:SetText(text or "")
    update()
    apply()
  end
  x:SetScript("OnClick", function() box:Clear() end)
  eb:SetScript("OnTextChanged", function(self, userInput)
    update()
    if not userInput then return end
    token = token + 1
    local mine = token
    C_Timer.After(0.15, function() if mine == token then apply() end end)
  end)
  eb:SetScript("OnEditFocusGained", update)
  eb:SetScript("OnEditFocusLost", update)
  eb:SetScript("OnEnterPressed", function(self) self:ClearFocus() end)
  eb:SetScript("OnEscapePressed", function(self)
    if (self:GetText() or "") ~= "" then
      box:Clear()
      self:ClearFocus()
      return
    end
    self:ClearFocus()
    if UI.frame then UI.frame:Hide() end
  end)
  box:EnableMouse(true)
  box:SetScript("OnMouseDown", function() eb:SetFocus() end)
  update()
  return box
end

-- Where the panel was and how big, so it opens the way you left it: LoreForeverDB.window = {x, y, w, h}, the top
-- left corner in UIParent units (the same at any Panel size) and the size in the panel's own units.
function UI.SaveWindow()
  local f = UI.frame
  if not (f and LoreForeverDB) then return end
  local left, top, s = f:GetLeft(), f:GetTop(), f:GetScale() or 1
  local w, h = f:GetWidth(), f:GetHeight()
  if type(left) ~= "number" or type(top) ~= "number" then return end
  LoreForeverDB.window = { x = left * s, y = top * s, w = tonumber(w), h = tonumber(h) }
end

-- Panel size (Options): scales the whole panel, text and buttons alike. Keeps the top left corner where it was.
UI.SCALES = { 0.9, 1, 1.15, 1.3 }
function UI.ApplyScale(scale)
  local f = UI.frame
  if not f then return end
  scale = tonumber(scale) or 1
  local left, top, s = f:GetLeft(), f:GetTop(), f:GetScale() or 1
  local x, y = type(left) == "number" and left * s, type(top) == "number" and top * s
  -- Not laid out yet (not opened this session): go by where it was saved.
  local win = LoreForeverDB and LoreForeverDB.window
  if not (x and y) and type(win) == "table" then x, y = tonumber(win.x), tonumber(win.y) end
  f:SetScale(scale)
  if x and y then
    f:ClearAllPoints()
    f:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", x / scale, y / scale)
    UI.SaveWindow()
  end
end

-- The screen in UIParent units, or nil when the client can't say (saved places are then used as they are).
local function screenSize()
  local w = UIParent.GetWidth and tonumber(UIParent:GetWidth())
  local h = UIParent.GetHeight and tonumber(UIParent:GetHeight())
  if w and h and w > 0 and h > 0 then return w, h end
end

-- A w x h box's left and bottom (UIParent units), moved just enough to sit wholly on the screen; one bigger than the
-- screen keeps its top left corner on it. Saved places go through this at login (LOR-241): one saved at another
-- resolution or UI scale could leave a window off the screen for good, and reinstalling keeps SavedVariables.
function UI.ClampToScreen(left, bottom, w, h)
  local sw, sh = screenSize()
  if not sw then return left, bottom end
  return math.max(0, math.min(left, sw - w)), math.min(math.max(bottom, 0), sh - h)
end

function UI.RestoreWindow()
  local f = UI.frame
  local scale = tonumber(settings().panelScale) or 1
  f:SetScale(scale)
  local win = LoreForeverDB and LoreForeverDB.window
  if type(win) ~= "table" then return end
  local w, h = tonumber(win.w), tonumber(win.h)
  if w and h then f:SetSize(math.max(MIN_W, math.min(1500, w)), math.max(560, math.min(1100, h))) end
  local x, y = tonumber(win.x), tonumber(win.y)
  if x and y then
    local fw, fh = (tonumber(f:GetWidth()) or W) * scale, (tonumber(f:GetHeight()) or H) * scale
    local left, bottom = UI.ClampToScreen(x, y - fh, fw, fh)
    if left ~= x or bottom + fh ~= y then
      x, y = left, bottom + fh
      win.x, win.y = x, y
    end
    f:ClearAllPoints()
    f:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", x / scale, y / scale)
  end
end

-- Shared with the journey page (Journey.lua), so its rows and headers look like the rest of the panel.
UI.TextButton, UI.Header, UI.SIDE_W, UI.CHAT_X, UI.DOCK_H = TextButton, Header, SIDE_W, CHAT_X, DOCK_H
UI.BOOK_TOP, UI.BOOK_R, UI.MIN_W = BOOK_TOP, BOOK_R, MIN_W
UI.QueueButton, UI.SetQueueButton = QueueButton, SetQueueButton

-- The playlist (see "Playlist" below): items {id, key, idx, label}, pos = the current item, and state:
--   "playing"  the clip playing is items[pos] (or it's in the short gap before the next one)
--   "waiting"  started while something else played; items[pos] begins when that ends
--   "paused"   stopped at items[pos]; Play starts it again from the top (WoW can't resume a sound)
-- Session only: /reload and logging out clear it.
UI.pl = { items = {}, pos = 0, state = "paused" }

function UI.Create(engine)
  if UI.frame then return UI.frame end
  UI.engine = engine
  UI.msgs, UI.blocks, UI.bubbles = {}, {}, {}

  -- The game's gold dialog frame with a title banner (Theme.Window): the window is the open book, "Your Chronicle".
  local f = T.Window("LoreForeverFrame", UIParent, L["Your Chronicle"])
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
  f:SetScript("OnDragStop", function() f:StopMovingOrSizing(); UI.SaveWindow() end)
  -- Resizable from the bottom-right corner; the sidebar keeps its width and the conversation takes the rest.
  if f.SetResizable then
    f:SetResizable(true)
    if f.SetResizeBounds then f:SetResizeBounds(MIN_W, 560, 1500, 1100)
    elseif f.SetMinResize then f:SetMinResize(MIN_W, 560) end
    local grip = CreateFrame("Button", nil, f)
    grip:SetSize(16, 16)
    grip:SetHitRectInsets(-6, -4, -6, -4)   -- easier to grab than the 16px corner it draws
    grip:SetPoint("BOTTOMRIGHT", -6, 6)
    grip:SetFrameLevel((f:GetFrameLevel() or 1) + 30)   -- above History and Journey, which reach the bottom edge
    grip:SetNormalTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Up")
    grip:SetHighlightTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Highlight")
    grip:SetPushedTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Down")
    grip:SetScript("OnMouseDown", function() GameTooltip:Hide(); f:StartSizing("BOTTOMRIGHT") end)
    grip:SetScript("OnMouseUp", function() f:StopMovingOrSizing(); UI.SaveWindow() end)
    grip:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:AddLine(L["Drag to resize"])
      T.Tip(L["Options > Panel size makes the text bigger."], "tipText", true)
      GameTooltip:Show()
    end)
    grip:SetScript("OnLeave", function() GameTooltip:Hide() end)
  end
  -- Re-flow after the drag settles rather than on every size tick.
  f:SetScript("OnSizeChanged", function()
    UI.FitRibbons()   -- (every page hangs from the window's edges, so it follows the drag by itself)
    UI.layoutToken = (UI.layoutToken or 0) + 1
    local token = UI.layoutToken
    C_Timer.After(0.1, function() if token == UI.layoutToken then UI.Layout() end end)
  end)
  UI.RestoreWindow()
  f:Hide()
  table.insert(UISpecialFrames, "LoreForeverFrame")   -- Escape closes it, like the map

  -- Header: where you are, then the panel-wide actions (Journey, History, New chat, Options), each sized to its label
  -- so German and Portuguese fit. Narrating the area is the player's Play (bottom left).
  local function headerButton(label, onClick, anchor, kind)
    local b = PanelButton(f, kind)
    b:SetHeight(22)
    b:SetText(label)
    local tw = b.GetTextWidth and tonumber(b:GetTextWidth())
    b:SetWidth(math.max(64, (tw or 50) + 24))
    if anchor then b:SetPoint("RIGHT", anchor, "LEFT", -6, 0) else b:SetPoint("TOPRIGHT", -14, -30) end
    b:SetScript("OnClick", onClick)
    return b
  end
  -- Options (the PM's pick, LOR-673): a gear at the end of the title bar opens them on click, as a right-click on the
  -- minimap button does. Before, only that, the add-on menu and /lore options reached them, and players who hide the
  -- minimap button had no way to see there was any.
  local gear = PanelButton(f)
  gear:SetSize(26, 22)
  gear:SetPoint("TOPRIGHT", -14, -30)
  local cog = gear:CreateTexture(nil, "ARTWORK")
  cog:SetTexture("Interface\\Icons\\INV_Misc_Gear_01")
  cog:SetTexCoord(0.08, 0.92, 0.08, 0.92)
  cog:SetSize(16, 16)
  cog:SetPoint("CENTER")
  gear:SetScript("OnClick", function() ns.Options.Open() end)
  gear:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_BOTTOMLEFT")
    GameTooltip:AddLine(L["Options"])
    T.Tip(L["Narration, voices, sizes and what plays by itself."], "tipDim", true)
    GameTooltip:Show()
  end)
  gear:SetScript("OnLeave", function() GameTooltip:Hide() end)
  UI.optionsButton = gear
  UI.newButton = headerButton(L["New chat"], function() UI.Clear() end, gear)
  UI.historyButton = headerButton(L["History"], function() UI.ToggleHistory() end, UI.newButton)
  -- Journey opens a page over the conversation, like History. Since slice 5 the Road bookmark opens it, and this
  -- button stays hidden (made, for what anchors to it).
  UI.journeyButton = headerButton(L["Journey"], function()
    if not ns.Journey.IsShown() then ns.Log.Use("tab", "journey") end   -- usage counts (LOR-435)
    ns.Journey.Toggle()
  end, UI.historyButton)
  UI.journeyButton:Hide()

  -- The title bar reads "Your Chronicle" (the banner) and where you stand: a small book, then the place and who you are.
  local bookIcon = f:CreateTexture(nil, "ARTWORK")
  bookIcon:SetTexture(T.KindIcon("storyline"))
  bookIcon:SetTexCoord(0.08, 0.92, 0.08, 0.92)
  bookIcon:SetSize(22, 22)
  bookIcon:SetPoint("TOPLEFT", 16, -33)
  UI.bookIcon = bookIcon
  UI.contextLine = f:CreateFontString(nil, "OVERLAY", T.font.place)
  UI.contextLine:SetPoint("TOPLEFT", 44, -34)
  UI.contextLine:SetPoint("RIGHT", UI.historyButton, "LEFT", -10, 0)
  UI.contextLine:SetJustifyH("LEFT")
  if UI.contextLine.SetWordWrap then UI.contextLine:SetWordWrap(false) end
  -- Willo's icon (LOR-601, Mike's pick: the title bar, in a gold ring), left of Journey for players without her
  -- (Companion.CreateIcon); the place name ends before it while it shows (UI.UpdateWilloIcon).
  UI.willoIcon = ns.Companion.CreateIcon(f, 24)
  UI.willoIcon:SetPoint("RIGHT", UI.historyButton, "LEFT", -10, 0)
  UI.UpdateWilloIcon()

  -- The book. Its left page is the sidebar: a parchment page of its own, with the fold's shadow along the edge where it
  -- meets the right page, and everything the sidebar holds hangs from this frame.
  local book = CreateFrame("Frame", nil, f)
  book:SetPoint("TOPLEFT", 8, -BOOK_TOP)
  book:SetPoint("BOTTOMRIGHT", f, "BOTTOMLEFT", CHAT_X - 4, DOCK_H)
  T.Parchment(book, "left")
  UI.sidePage = book
  -- The right page, under the conversation (Here's welcome, the questions and answers): parchment like every other
  -- page, with the conversation written on it in ink.
  local chatPage = CreateFrame("Frame", nil, f)
  chatPage:SetPoint("TOPLEFT", f, "TOPLEFT", CHAT_X - 4, -BOOK_TOP)
  chatPage:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -BOOK_R, DOCK_H)
  T.Parchment(chatPage, "right")
  UI.chatPage = chatPage
  -- What the window itself draws on that page (the suggestions' label, the message box's band) goes on a frame over
  -- it: a frame covers its parent's own text and textures.
  local chatDecor = CreateFrame("Frame", nil, f)
  chatDecor:SetAllPoints(f)
  UI.chatDecor = chatDecor

  -- The bookmarks: ribbons down the right edge of the book, on the window's ground beside it. "Here" (this place and
  -- your quests), "Found" (your chronicle's pages by chapter, Book.lua; it took the Library's place), "Road" (the journey
  -- page, zones as chapters, Road.lua) and "Storylines" (the storylines you're on). The open one is gold and a little
  -- longer; Found carries how many pages are new. The playlist is the player's (the foot of the book), not a bookmark.
  UI.tabs = {}
  local specs = { { "here", L["Here"] }, { "found", L["Found"] }, { "road", L["Road"] }, { "story", L["Storylines"] } }
  for i, spec in ipairs(specs) do
    local tab = T.Ribbon(f, spec[2])
    tab:SetFrameLevel((f:GetFrameLevel() or 1) + 26)
    -- The open one is a lighter gold with a dark label (cream on the kit's gold read at 3:1).
    local setOn = tab.SetOn
    function tab:SetOn(on)
      setOn(self, on)
      T.StyleOpenRibbon(self, self.on)
    end
    if i == 1 then tab:SetPoint("TOPLEFT", f, "TOPRIGHT", -BOOK_R, -(BOOK_TOP + 10))
    else tab:SetPoint("TOPLEFT", UI.tabs[i - 1], "BOTTOMLEFT", 0, -6) end
    tab.view = spec[1]
    -- Found counts as "narrations", the Library's name, and the Road as "journey": the names Willo forwards and the
    -- site reads.
    tab:SetScript("OnClick", function(self)
      local v = self.view
      ns.Log.Use("tab", (v == "found" and "narrations") or (v == "road" and "journey") or (v == "story" and "storylines") or v)
      UI.ShowTab(self.view)
    end)
    UI.tabs[i] = tab
  end
  -- After an update, a green "New" over History and a green dot on the Journey (Road) and Found ribbons when the headline
  -- changes mention them, each until that page has been opened (WhatsNew.lua; UI.UpdateNewMarks shows them).
  UI.newMarks = {
    journey = ns.WhatsNew.Dot(UI.tabs[3]),
    history = ns.WhatsNew.Tag(f, UI.historyButton, "BOTTOMRIGHT", "TOPRIGHT", -2, 2),
    found = ns.WhatsNew.Dot(UI.tabs[2]),
  }
  -- How many pages are new: Book.UpdateBadge writes it to the Found ribbon's count.
  local foundRibbon = UI.tabs[2]
  ns.Book.badge = {
    bg = { SetShown = function() end, SetWidth = function() end },
    SetText = function(_, text)
      foundRibbon:SetCount(tonumber(text) or ((text or "") ~= "" and 100) or 0)
      UI.FitRibbons()
    end,
    SetShown = function(_, on) if not on then foundRibbon:SetCount(0); UI.FitRibbons() end end,
  }
  ns.Book.UpdateBadge()
  local hereView = CreateFrame("Frame", nil, book)
  hereView:SetAllPoints(f)
  UI.hereView = hereView
  local foundView = CreateFrame("Frame", nil, book)
  foundView:SetAllPoints(f)
  foundView:Hide()
  UI.foundView = foundView
  ns.Book.CreateSide(foundView)
  local roadView = CreateFrame("Frame", nil, book)
  roadView:SetAllPoints(f)
  roadView:Hide()
  UI.roadView = roadView
  ns.Road.CreateSide(roadView)
  local storyView = CreateFrame("Frame", nil, book)
  storyView:SetAllPoints(f)
  storyView:Hide()
  UI.storyView = storyView
  ns.Road.CreateStorySide(storyView)
  -- The queue: opens from the player, over the left page, so the conversation stays readable while you reorder.
  local plView = CreateFrame("Frame", nil, f)
  plView:SetAllPoints(f)
  plView:SetFrameLevel((f:GetFrameLevel() or 1) + 16)   -- over the left page's own frames
  plView:Hide()
  UI.plView = plView
  UI.CreatePlaylist(plView)
  UI.dock = UI.CreatePlayer(f, false)
  UI.journeyPage = ns.Journey.CreatePage(f)   -- what this character has done, over the chat (Journey.lua)
  -- The journey page is the Road's: opened any way (the welcome back, /lore journey), the Road bookmark shows.
  UI.journeyPage:HookScript("OnShow", function() if UI.tab ~= "road" then UI.ShowTab("road", true) end end)

  -- The Here list, as in the mockups Mike picked (navigation option A, Gilded Night look): one-line rows, the play
  -- arrow on the left of anything narrated, a + on the right of anything that can be queued, then your quests.
  -- Names line up after the play arrow's slot whether or not a row has one.
  local function hereRow()
    local b = TextButton(hereView, SIDE_W - 16, HERE_ROW, nil, T.color.inkRow, true)
    if b.text.SetWordWrap then b.text:SetWordWrap(false) end
    b.text:SetPoint("TOPLEFT", HERE_INDENT, -2)
    b.play = PlayButton(b)
    b.play:SetSize(20, 20)
    b.play:SetPoint("LEFT", 2, 0)
    b.add = QueueButton(b, HERE_ROW - 4)
    b.add:SetPoint("RIGHT", -2, 0)
    -- Your target (or the boss you're on): a gold wash and bar, so it's clear why it leads the list.
    b.mark = T.TargetMark(b, true)
    b:SetScript("OnLeave", function() GameTooltip:Hide() end)
    return b
  end
  -- The heading names where you stand; clicking it tells that place's story in the conversation.
  local hereOpen = CreateFrame("Button", nil, hereView)
  hereOpen:SetPoint("TOPLEFT", 14, -HERE_TOP)
  hereOpen:SetSize(SIDE_W - 16, 18)
  UI.hereHeader = Header(hereOpen, L["Here"], true)
  UI.hereHeader:SetPoint("TOPLEFT", 2, -2)
  UI.hereHeader:SetWidth(SIDE_W - 20)
  if UI.hereHeader.SetWordWrap then UI.hereHeader:SetWordWrap(false) end
  hereOpen:SetScript("OnClick", function()
    local key = ns.Road.HereKey()
    local e = key and UI.engine.db.entries[key]
    if e then UI.ShowEntry(key, "here", UI.TellMeAbout(e)) end
  end)
  hereOpen:SetScript("OnEnter", function(self)
    if not ns.Road.HereKey() then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    T.Tip(L["Tell me about this place"], "tipDim", true)
    GameTooltip:Show()
  end)
  hereOpen:SetScript("OnLeave", function() GameTooltip:Hide() end)
  UI.hereOpen = hereOpen
  UI.suggestions = {}
  for i = 1, 5 do
    local b = hereRow()
    b:SetPoint("TOPLEFT", 12, -(HERE_TOP + 20) - (i - 1) * HERE_STEP)
    b:SetScript("OnClick", function(self)
      if self.primer then UI.ShowPrimer(self.primer, "here")
      elseif self.key and self.idx then UI.ShowFaq(self.key, self.idx, "here")
      elseif self.key then UI.ShowEntry(self.key, "here", self.label) end
    end)
    b:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      -- The whole row first: one-line rows cut long questions off.
      if self.full then T.Tip(self.full, "tipText", true) end
      local how = (self.primer and L["Dungeon primer: why you're here and who you'll face"])
        or (self.target and L["Your target: open their story"])
        or (self.idx and L["Ask this question"]) or L["Open the full story"]
      T.Tip(how, "tipDim")
      if self.play and self.play:IsShown() then
        T.Tip(L["Narrated: press the arrow to listen"], "tipDim")
      end
      GameTooltip:Show()
    end)
    UI.suggestions[i] = b
  end

  -- Inside a dungeon: its bosses in encounter order, each opening its story, with play, + and "Add all".
  UI.bossHeader = Header(hereView, L["Bosses, in order"], true)
  local queueAll = TextButton(hereView, 70, 16, T.font.small, T.color.add)
  queueAll.text:SetJustifyH("CENTER")
  queueAll.text:SetPoint("TOPLEFT", 2, -1)
  queueAll.text:SetPoint("BOTTOMRIGHT", -2, 1)
  if queueAll.text.SetWordWrap then queueAll.text:SetWordWrap(false) end
  queueAll.text:SetText(L["Add all"])
  local qaw = T.TextWidth(queueAll.text)
  if qaw and qaw > 0 then queueAll:SetWidth(math.max(70, math.min(130, qaw + 10))) end
  queueAll:SetPoint("BOTTOMRIGHT", UI.bossHeader.rule, "TOPRIGHT", 0, 2)
  queueAll:SetScript("OnClick", function() UI.QueueBosses(UI.hereBosses) end)
  queueAll:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Add all to your playlist"])
    T.Tip(L["Adds each narrated boss's story to your playlist, in order. Spoilers stay out."], "tipText", true)
    GameTooltip:Show()
  end)
  queueAll:SetScript("OnLeave", function() GameTooltip:Hide() end)
  UI.queueAllButton = queueAll
  UI.bossButtons = {}
  for i = 1, 12 do
    local b = hereRow()
    b:SetScript("OnClick", function(self) UI.ShowEntry(self.key, "here", self.asked) end)
    b:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:AddLine(self.name)
      if self.hook then T.Tip(self.hook, "tipText", true) end
      T.Tip(L["Click to open their story"], "tipDim")
      GameTooltip:Show()
    end)
    b:Hide()
    UI.bossButtons[i] = b
  end

  local questHeader = Header(hereView, L["Your quests"], true)
  questHeader:SetPoint("TOPLEFT", 16, -(HERE_TOP + 20) - 5 * HERE_STEP - 10)
  UI.questHeader = questHeader
  -- How many quests are in your log, small at the header's right.
  local questCount = Faint(hereView:CreateFontString(nil, "OVERLAY", T.font.small))
  questCount:SetPoint("BOTTOMRIGHT", questHeader.rule, "TOPRIGHT", 0, 3)
  questCount:SetJustifyH("RIGHT")
  UI.questCount = questCount
  -- With an empty quest log, say what will show here instead of a bare header.
  local noQuests = Faint(hereView:CreateFontString(nil, "OVERLAY", T.font.small))
  noQuests:SetWidth(SIDE_W - 32)
  noQuests:SetJustifyH("LEFT")
  noQuests:SetText(L["No quests in your log. Pick one up and the story behind it shows here."])
  noQuests:Hide()
  UI.noQuests = noQuests
  -- Under the header when your log holds more quests than fit (UI.Refresh): by title, zone or the story's name.
  UI.questSearch = UI.SearchBox(hereView, SIDE_W - 22, function() UI.Refresh() end, nil, true)
  UI.questSearch:Hide()
  UI.questButtons = {}
  for i = 1, 10 do
    local b = hereRow()
    b:SetPoint("TOPLEFT", 12, -(HERE_TOP + 20) - 5 * HERE_STEP - 28 - (i - 1) * HERE_STEP)
    b:SetScript("OnClick", function(self)
      -- Shift-click: the quest's narration joins the playlist (UI.QueueQuest).
      local name = self.shown or (self.quest and self.quest.title)
      if IsShiftKeyDown() and self.quest then return UI.QueueQuest(self.quest.id, name) end
      if self.key then UI.ShowEntry(self.key, "quest", name)
      elseif self.quest then UI.ShowQuestText(self.quest) end
    end)
    b:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      local name = self.shown or (self.quest and self.quest.title)
      if name then T.Tip(name, "tipText", true) end
      local story = self.quest and ns.Storyline.Line(self.quest.id)
      if story then T.Tip(story, "gold", true) end
      GameTooltip:AddLine(self.key and L["The story behind this quest"] or L["No written lore yet"])
      if not self.key then
        T.Tip(L["Shows the quest's own text and the story of the area."], "tipText", true)
      end
      if self.play:IsShown() then T.Tip(L["Narrated: press the arrow to listen"], "tipText") end
      if self.quest and UI.CanQueueQuest(self.quest.id) then
        T.Tip(L["Click to open. Shift-click adds it to your playlist."], "tipDim", true)
      end
      GameTooltip:Show()
    end)
    UI.questButtons[i] = b
  end
  -- (Where the lore comes from is credited out of the game: CREDITS.txt in the download, the CurseForge page and the
  -- site's /credits. Mike, 10/25.)

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
  sf:SetPoint("BOTTOMRIGHT", -34 - SHIFT_R, 128 + FOOT)
  local content = CreateFrame("Frame", nil, sf)
  content:SetSize(CHAT_W, 100)
  sf:SetScrollChild(content)
  UI.scroll, UI.content = sf, content

  UI.CreateHistory(f)
  -- The Journey and History buttons look selected exactly while their page is open, whatever opened or closed it.
  for _, page in ipairs({ UI.journeyPage, UI.historyFrame }) do
    page:HookScript("OnShow", UI.SyncPageButtons)
    page:HookScript("OnHide", UI.SyncPageButtons)
  end
  UI.storyPage = ns.Page.Create(f)   -- a story's own page, over the chat (Page.lua)
  UI.foundPage = ns.Book.Create(f)   -- the Found bookmark's pages, under a story's page (Book.lua)

  -- "Added to your playlist: ..." for a few seconds over the bottom of the conversation.
  local toast = CreateFrame("Frame", nil, f)
  toast:SetPoint("BOTTOMLEFT", sf, "BOTTOMLEFT", 0, 4)
  toast:SetPoint("BOTTOMRIGHT", sf, "BOTTOMRIGHT", 0, 4)
  toast:SetHeight(24)
  toast:SetFrameLevel((f:GetFrameLevel() or 1) + 10)
  local tbg = T.Area(toast, "toast")
  tbg:SetAllPoints()
  local tedge = T.Area(toast, "rule", "BORDER")
  tedge:SetPoint("TOPLEFT")
  tedge:SetPoint("TOPRIGHT")
  tedge:SetHeight(1)
  toast.text = toast:CreateFontString(nil, "OVERLAY", T.font.small)
  toast.text:SetPoint("LEFT", 8, 0)
  toast.text:SetPoint("RIGHT", -8, 0)
  toast.text:SetJustifyH("LEFT")
  if toast.text.SetWordWrap then toast.text:SetWordWrap(false) end
  toast:Hide()
  UI.toast = toast

  -- Suggested replies under the conversation
  UI.nextLabel = T.PaperText(UI.chatDecor:CreateFontString(nil, "OVERLAY", T.font.label), "inkAccent")
  UI.nextLabel:SetPoint("BOTTOMLEFT", CHAT_X + 2, 110 + FOOT)
  UI.nextLabel:SetText(L["Suggested:"])
  UI.nextButtons = {}
  for i = 1, N_NEXT do
    local b = TextButton(f, CHAT_W, 20, T.font.small, T.color.inkRow, true)
    b:SetPoint("BOTTOMLEFT", CHAT_X, 108 - i * 22 + FOOT)
    b:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -36 - SHIFT_R, 108 - i * 22 + FOOT)
    b:SetScript("OnClick", function(self)
      if self.live then UI.AskWillo(self.live)
      elseif self.everything then UI.TellEverything()
      elseif self.section then UI.ShowSection(self.key, self.idx)
      elseif self.key and self.idx then UI.ShowFaq(self.key, self.idx, self.via or "next")
      elseif self.key then UI.ShowEntry(self.key, self.via or "next") end
    end)
    UI.nextButtons[i] = b
  end

  -- Message box
  local bar = Area(UI.chatDecor, "inkRow")
  bar:SetPoint("BOTTOMLEFT", CHAT_X - 4, 10 + FOOT)
  bar:SetPoint("TOPRIGHT", f, "BOTTOMRIGHT", -BOOK_R, 44 + FOOT)
  UI.msgBar = bar
  local eb = CreateFrame("EditBox", "LoreForeverInput", f, "InputBoxTemplate")
  eb:SetPoint("BOTTOMLEFT", CHAT_X + 8, 16 + FOOT)
  eb:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -96 - SHIFT_R, 16 + FOOT)
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
      UI.OpenCompletion(pick)
    elseif q and q:match("%S") then
      if UI.ctx then UI.ctx.done = ns.Context.Done() end
      local key = UI.engine:StoryForName(q, UI.ctx)
      if key then ns.Log.Use("ask"); ns.Log.Asked("typed"); UI.ShowEntry(key, "typed", q) else UI.Ask(q, "typed") end
    end
  end)
  -- Escape closes the type-ahead first; otherwise it closes the panel, as Escape does with the box unfocused.
  eb:SetScript("OnEscapePressed", function(self)
    if UI.completion and UI.completion:IsShown() then return UI.HideCompletion() end
    self:ClearFocus()
    f:Hide()
  end)
  -- Placeholder hint inside the box while it's empty.
  local hintText = eb:CreateFontString(nil, "OVERLAY", T.font.hint)
  hintText:SetPoint("LEFT", 4, 0)
  hintText:SetPoint("RIGHT", -4, 0)
  hintText:SetJustifyH("LEFT")
  if hintText.SetWordWrap then hintText:SetWordWrap(false) end
  hintText:SetText(L["Ask anything about the world"])
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
  local send = PanelButton(f)
  send:SetSize(56, 24)
  send:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -30 - SHIFT_R, 16 + FOOT)
  UI.sendButton = send
  send:SetText(L["Send"])
  send:SetScript("OnClick", function() eb:GetScript("OnEnterPressed")(eb) end)
  UI.CreateCompletion(f, eb)

  f:SetScript("OnShow", function()   -- a voice sample from Options ends; live game info shows while the panel is open
    ns.Voice.StopPreview(); UI.Refresh(); ns.Log.Use("panel")
    if ns.Strip then ns.Strip.Update() end
  end)
  -- The floating player stands in for the docked one while the panel is closed.
  -- Closing the panel closes its Journey and History pages too, so it opens on the chat next time.
  f:HookScript("OnHide", function()
    UI.ShowQueue(false)
    if UI.journeyPage then UI.journeyPage:Hide() end
    if UI.historyFrame then UI.historyFrame:Hide() end
    UI.SyncPageButtons()
    UI.UpdateNowPlaying()
    if ns.Strip then ns.Strip.Update() end
  end)
  UI.mini = UI.CreatePlayer(UIParent, true)
  UI.CreateBook()
  UI.ShowTab("here")
  UI.SetNext({})
  UI.UpdateNewMarks()
  return f
end

-- The book's pages ----------------------------------------------------------------------------------------------------
-- One layout at every size: the left page (what you choose from) beside the right one (what you chose), which takes
-- what the window adds. The window can't be made narrower than MIN_W, so there's no thin, one-page shape. The right
-- pages are other modules' (Page.lua, Book.lua, Journey.lua) and keep their names; each hangs from the window's edges,
-- so a resize needs nothing re-placed.

function UI.CreateBook()
  local f, book = UI.frame, UI.sidePage
  -- The left page's title: which bookmark is open (Here has its own heading).
  UI.pageTitle = Header(book, "", true)
  UI.pageTitle:SetPoint("TOPLEFT", book, "TOPLEFT", 10, -8)
  UI.FitRibbons()
end

-- The ribbons run down the book's edge from the top: when a language's labels are long enough that the four don't fit
-- the book's height with their usual gap, the gap closes up (to 1px) rather than a ribbon running off the foot.
function UI.FitRibbons()
  local f, tabs = UI.frame, UI.tabs
  if not (f and tabs and #tabs > 1) then return end
  local fh = tonumber(f:GetHeight()) or H
  local room = fh - (BOOK_TOP + 10) - DOCK_H - 4
  local sum = 0
  for _, t in ipairs(tabs) do sum = sum + (tonumber(t:GetHeight()) or 0) end
  local gap = math.max(1, math.min(6, math.floor((room - sum) / (#tabs - 1))))
  for i = 2, #tabs do
    tabs[i]:ClearAllPoints()
    tabs[i]:SetPoint("TOPLEFT", tabs[i - 1], "BOTTOMLEFT", 0, -gap)
  end
end

-- The "New" marks: shown while the page they sit on has news it hasn't been opened for (WhatsNew.PageIsNew).
function UI.UpdateNewMarks()
  for page, mark in pairs(UI.newMarks or {}) do mark:SetShown(ns.WhatsNew.PageIsNew(page)) end
end

-- A page with a "New" mark was opened: its news is seen.
function UI.SeenPage(page)
  if not ns.WhatsNew.Pending(page) then return end
  ns.WhatsNew.Seen(page)
  UI.UpdateNewMarks()
end

-- Type-ahead ---------------------------------------------------------------------------------------------------

function UI.CreateCompletion(parent, eb)
  local c = T.Backdrop(CreateFrame("Frame", nil, parent, T.BACKDROP_TEMPLATE), "popup")
  local bg = T.Area(c, "popup")
  bg:SetPoint("TOPLEFT", 2, -2)
  bg:SetPoint("BOTTOMRIGHT", -2, 2)
  c:SetPoint("BOTTOMLEFT", parent, "BOTTOMLEFT", CHAT_X, 48 + FOOT)
  c:SetSize(CHAT_W, N_COMPLETE * 20 + 10)
  c:SetFrameStrata("DIALOG")
  c.rows = {}
  c.headers = {}
  for _, kind in ipairs({ "story", "faq" }) do
    local head = c:CreateFontString(nil, "OVERLAY", T.font.label)
    head:SetJustifyH("LEFT")
    c.headers[kind] = head
  end
  c.browse = TextButton(c, CHAT_W - 10, 24, T.font.small, T.color.chip)
  c.browse.text:SetText(L["Browse narrations"])
  c.browse:SetScript("OnClick", function() UI.BrowseNarrations(c.subject) end)
  for i = 1, N_COMPLETE do
    local b = TextButton(c, CHAT_W - 10, 20, T.font.small)
    b:SetPoint("TOPLEFT", 5, -5 - (i - 1) * 20)
    local sel = T.Area(b, "select")
    sel:SetAllPoints()
    sel:Hide()
    b.sel = sel
    b.read = TextButton(b, 62, 22, T.font.small, T.color.chip)
    b.read.text:SetText(L["Read"])
    b.read.text:SetJustifyH("CENTER")
    b.read:SetScript("OnClick", function() UI.OpenCompletion(b) end)
    b.listen = PanelButton(b)
    b.listen:SetSize(84, 22)
    b.listen:SetScript("OnClick", function()
      if UI.StoryAudio(b.key) then UI.ListenTo(UI.EntryTarget(b.key)) end
    end)
    b.add = QueueButton(b, 22, true)
    b:SetScript("OnClick", function(self)
      UI.OpenCompletion(self)
    end)
    c.rows[i] = b
    b:Hide()
  end
  c:Hide()
  UI.completion = c
end

function UI.OpenCompletion(row)
  UI.input:SetText("")
  UI.HideCompletion()
  if not row.key then return end
  if row.kind == "story" then UI.ShowEntry(row.key, "complete")
  else UI.ShowFaq(row.key, row.idx, "complete") end
end

function UI.BrowseNarrations(subject)
  UI.HideCompletion()
  UI.ShowTab("found")
  if ns.Book.search then ns.Book.search:SetText(subject or "") end
end

-- Recording availability and permission are rechecked before exposing an audio action.
function UI.StoryAudio(key)
  return ns.Voice.HasAudio(key) and ns.Voice.CanPlay(key)
end

-- Each story keeps a separate action line so long titles and translated buttons fit a narrow chat.
function UI.LayoutCompletion()
  local c = UI.completion
  if not c then return end
  local width = math.max(240, (tonumber(UI.frame:GetWidth()) or W) - CHAT_X - 40 - SHIFT_R)
  c:SetWidth(width)
  c:ClearAllPoints()
  c:SetPoint("BOTTOMLEFT", UI.frame, "BOTTOMLEFT", CHAT_X, 48 + FOOT)
  local y, seen, stories, clipped = 6, {}, false, false
  local maxHeight = (tonumber(UI.frame:GetHeight()) or H) - 84
  for _, head in pairs(c.headers) do head:Hide() end
  for i, b in ipairs(c.rows) do b:SetShown(i <= (c.itemCount or 0)) end
  for _, b in ipairs(c.rows) do
    if b:IsShown() then
      if clipped then b:Hide() else
      local kind = b.kind
      local groupStart = y
      if not seen[kind] then
        local head = c.headers[kind]
        head:ClearAllPoints()
        head:SetPoint("TOPLEFT", 10, -y)
        head:SetWidth(width - 20)
        head:SetText(GOLD .. (kind == "story" and L["Stories"] or L["Related questions"]) .. "|r")
        head:Show()
        seen[kind], y = true, y + 20
      end
      b:ClearAllPoints()
      b:SetPoint("TOPLEFT", 5, -y)
      b:SetWidth(width - 10)
      b.text:ClearAllPoints()
      b.text:SetPoint("TOPLEFT", 6, -3)
      b.text:SetWidth(width - 22)
      local playable = kind == "story" and UI.StoryAudio(b.key)
      local subtitle = kind == "story" and (playable and ("\n" .. GREY .. esc(L["Narration"]) .. "|r") or "")
        or ("  " .. GREY .. esc(b.name) .. "|r")
      b.text:SetText(WHITE .. esc(b.q) .. "|r" .. subtitle)
      local th = tonumber(b.text:GetStringHeight()) or 28
      local rowHeight = th + (kind == "story" and 34 or 8)
      if kind == "story" then
        b.read:SetWidth(math.max(54, (tonumber(b.read.text:GetStringWidth()) or 42) + 16))
        b.read:ClearAllPoints()
        b.read:SetPoint("TOPLEFT", 6, -th - 6)
        b.read:Show()
        b.listen:ClearAllPoints()
        b.listen:SetPoint("LEFT", b.read, "RIGHT", 6, 0)
        b.listen:SetText(UI.IsPlayingTarget(UI.EntryTarget(b.key)) and L["Stop"] or L["Listen"])
        b.listen:SetWidth(math.max(72, (tonumber(b.listen:GetTextWidth()) or 52) + 20))
        b.listen:SetShown(playable)
        b.add:ClearAllPoints()
        b.add:SetPoint("LEFT", playable and b.listen or b.read, "RIGHT", 6, 0)
        SetQueueButton(b.add, b.key)
      else
        b.read:Hide(); b.listen:Hide(); b.add:Hide()
      end
      b:SetHeight(rowHeight)
      if y + rowHeight + 36 > maxHeight then
        b:Hide()
        clipped = true
        if not seen[kind .. "Row"] then c.headers[kind]:Hide(); y = groupStart end
      else
        seen[kind .. "Row"] = true
        stories = stories or kind == "story"
        y = y + rowHeight + 2
      end
      end
    end
  end
  c.browse:SetShown(stories)
  if stories then
    c.browse:ClearAllPoints()
    c.browse:SetPoint("TOPLEFT", 5, -y - 2)
    c.browse:SetWidth(width - 10)
    y = y + 28
  end
  c:SetHeight(y + 6)
  if UI.completionSel and not c.rows[UI.completionSel]:IsShown() then
    c.rows[UI.completionSel].sel:Hide()
    UI.completionSel = nil
  end
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
  if not ns.Lang.ValidateEdition() then return UI.HideCompletion() end
  local c = UI.completion
  if not c then return end
  if not text or #text:gsub("%s", "") < 3 then return UI.HideCompletion() end
  if UI.ctx then UI.ctx.done = ns.Context.Done() end
  local items = UI.engine:Complete(text, UI.ctx, N_COMPLETE)
  if #items == 0 then return UI.HideCompletion() end
  c.itemCount = #items
  c.subject = text
  local firstStory = true
  for i, b in ipairs(c.rows) do
    local it = items[i]
    if it then
      b.key, b.idx, b.kind, b.q, b.name = it.key, it.idx, it.kind or "faq", it.q, it.name
      if it.kind == "story" and firstStory then c.subject, firstStory = it.name, false end
      b.sel:Hide()
      b:Show()
    else
      b:Hide()
    end
  end
  UI.completionSel = nil
  UI.LayoutCompletion()
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
-- An answer bubble whose story a voice recorded has its own Listen button, and the header narrates the area. A target
-- is {id, key, text}: key picks the recorded narration (overviews, primers, FAQ answers, quest pages); what no voice
-- recorded has nothing to play and stays as text. text is what plays, for its length.

-- An entry's overview as something to play: its recording if it has one, else its summary and first section.
-- The id is the entry key, so the sidebar, the header and an answer bubble all agree on what's playing. A quest's
-- lore answer and its quest giver's words are separate recordings. story: the entry the player's title opens
-- (UI.PlayerOpenStory).
function UI.EntryTarget(key)
  local e = key and UI.engine.db.entries[key]
  if not e then return nil end
  if ns.lang and ns.lang.edition then
    return { id = key, key = key, label = e.n, text = e.s, story = key }
  end
  local parts = { e.n .. ".", e.s }
  local done, all = ns.Context.Done(), settings().showSpoilers
  local passages = {}
  for i, sec in ipairs(e.sec or {}) do
    if all or UI.engine:Opens(key, sec, done) then
      parts[#parts + 1] = sec.t .. ". " .. sec.b
      -- A hidden section you've reached plays after the story, from its own recording (lore.passages).
      local pid = key .. "#section" .. i
      if (sec.sp or 0) ~= 0 and ns.Voice.HasAudio(pid) then passages[#passages + 1] = { id = pid, text = sec.b } end
    end
  end
  return { id = key, key = key, label = e.n, text = table.concat(parts, " "), story = key,
    passages = passages[1] and passages or nil }
end

-- The next opened passage of a story target (UI.EntryTarget) as a target of its own, or nil when none is left: the
-- same story to the player (its id, label and Stop button), playing the passage's recording.
local function nextPassage(target)
  local list, i = target and target.passages, (target and target.passage or 0) + 1
  local p = list and list[i]
  if not p or not ns.Voice.CanPlay(p.id) then return nil end
  return { id = target.id, key = p.id, label = target.label, text = p.text, story = target.story, passages = list,
    passage = i, started = target.started }
end

-- A FAQ answer as something to play; the starting zones and capitals have these recorded ("zone:elwynn#faq2").
function UI.FaqTarget(key, idx)
  local e = key and UI.engine.db.entries[key]
  local f = e and e.faq and e.faq[idx]
  if not f then return nil end
  local akey = faqID(key, idx)
  return { id = akey, key = akey, label = f.q, text = f.a }   -- read the answer only; the question is on screen
end

-- Audio follows the same spoiler permission as the text. An explicit reveal belongs to its displayed message,
-- so clearing the conversation or reloading cannot grant permission to a saved recording target.
function UI.SpoilerAllowed(key, kind, idx)
  local db = UI.engine and UI.engine.db
  local e = db and db.entries and db.entries[key]
  local item = e and ((kind == "faq" and e.faq and e.faq[idx]) or (kind == "section" and e.sec and e.sec[idx]))
  if not item then return false end
  if not item.sp or item.sp == 0 then return true end
  if settings().showSpoilers or UI.engine:Opens(key, item, ns.Context.Done()) then return true end
  local text = kind == "faq" and item.a or item.b
  for _, m in ipairs(UI.msgs or {}) do
    local shown = m.spoiler
    if shown and shown.key == key and shown.kind == kind and shown.idx == idx and shown.text == text then return true end
    if shown and shown.key == key and shown.kind == kind and shown.list and shown.list[idx] == text then return true end
  end
  return false
end

function UI.CanPlayClip(clip)
  if type(clip) ~= "string" then return false end
  local key, idx = clip:match("^(.-)#faq(%d+)$")
  if key then return UI.SpoilerAllowed(key, "faq", faqIndex(key, idx)) end
  if ns.lang and ns.lang.edition and not UI.engine.db.entries[clip] then return false end
  key, idx = clip:match("^(.-)#section(%d+)$")
  return not key or UI.SpoilerAllowed(key, "section", tonumber(idx))
end

function UI.ZoneTarget()
  local ctx = (UI.frame and UI.frame:IsShown() and UI.ctx) or ns.Context.Snapshot()
  local db = UI.engine.db
  local zk = UI.engine:ZoneKey(ctx.zone)
  local sub = UI.engine:SubzoneKey(ctx.subzone, ctx.zone)
  -- The zone when it's narrated; otherwise the most specific place with lore.
  local key = (zk and ns.Voice.HasAudio("zone:" .. zk) and "zone:" .. zk)
    or (sub and db.entries[sub] and db.entries[sub].t == "subzone" and sub) or (zk and "zone:" .. zk)
  return UI.EntryTarget(key)
end

-- Reset the buttons once playback ends, checked each second. Recordings report when they stop (Voice.IsPlaying); on a
-- client that can't tell, estimate the length from the text (about 15 characters a second). Ending by itself moves
-- the playlist on, then gives an arrival story waiting for it its turn (Voice.OnNarrationEnded).
local function watchPlayback(estimate)
  local wholeDuration = ns.Voice.lastClip and ns.Voice.lastClip.duration
  if type(wholeDuration) ~= "number" or wholeDuration <= 0 or wholeDuration > 600 then wholeDuration = nil end
  if wholeDuration then estimate = wholeDuration + 2 end
  local limit = wholeDuration and wholeDuration + 5 or 300
  local started = GetTime and GetTime() or 0
  local token = {}
  UI.playToken = token
  local function check()
    if UI.playToken ~= token or not UI.speaking then return end
    if ns.Voice.failed then
      UI.StopAll()   -- preserves the failed segment boundary and pauses the queue
      return
    end
    local playing = ns.Voice.IsPlaying()
    local elapsed = (GetTime and GetTime() or 0) - started
    if playing == false or (playing == nil and elapsed > estimate) or (not ns.Voice.transport and elapsed > limit) then
      local target = UI.activeTarget
      -- A story with opened passages goes straight on to the next one, as one story (no gap, no playlist step).
      local more = target and nextPassage(target)
      if more then
        UI.progress[target.key] = nil
        if UI.StartPassage(more, target.fromPlaylist) then return end
      end
      if target then
        UI.progress[target.key] = nil
        ns.Log.Use("done", ns.Log.NarrationKind(target.key))   -- heard to the end (LOR-413)
        -- ... and the same split as its start (LOR-420: startTarget's target.started)
        if target.started then ns.Log.Use(target.started .. "done", ns.Log.NarrationKind(target.key)) end
      end
      UI.activeTarget, UI.resumeTarget, UI.stoppedTarget = nil, nil, nil
      UI.speaking, UI.playingId = false, nil
      UI.UpdateListen()
      UI.OnClipEnded()
      ns.Voice.OnNarrationEnded(target)
    else
      if ns.Voice.transport then UI.UpdateNowPlaying() end
      C_Timer.After(ns.Voice.transport and 0.25 or 1, check)
    end
  end
  C_Timer.After(ns.Voice.transport and 0.25 or 1, check)
end


-- Listening progress belongs to the recording and its exact pack/hash, separately from queue position.
UI.progress = {}

local function validProgress(p, key)
  if type(p) ~= "table" or type(p.pack) ~= "string" or type(p.offset) ~= "number" or p.offset ~= p.offset
      or p.offset < 0 or p.offset == math.huge then return nil end
  local row = ns.Voice.TransportFor(key, p.pack)
  if row and row.hash == p.hash and row.fullHash == p.fullHash and p.offset < row.duration then return row end
end

function UI.RememberProgress()
  local V, target = ns.Voice, UI.activeTarget
  local offset, _, rate = V.Position()
  local t = V.transport
  if not (t and target and offset) then return end
  UI.progress[target.key] = { offset = offset, rate = rate, pack = t.row.pack, hash = t.row.hash,
    fullHash = t.row.fullHash, started = target.started }
  UI.resumeTarget = target
end

function UI.TransportState()
  local V = ns.Voice
  if UI.speaking and V.transport then
    if not V.CanPlay(V.transport.row.key) then return end
    local offset, duration, rate = V.Position()
    return { target = UI.activeTarget, row = V.transport.row, offset = offset, duration = duration, rate = rate }
  end
  local target = UI.resumeTarget
  if target and not V.CanPlay(target.key) then return end
  local p = target and UI.progress[target.key]
  local row = target and validProgress(p, target.key)
  if row then
    local rate = ns.Voice.PlaybackRate()
    return { target = target, row = row, offset = p.offset, duration = row.duration, rate = row.rates[rate] and rate or 1 }
  end
end

-- −10s / +10s: a recording plays from the start of a piece, so a skip lands on the start of the piece holding the
-- time it aims at. Pieces run 9-16 s, and +10s often landed on the piece already playing and restarted it (LOR-579:
-- "the forward and back things don't work"): forward always goes on to a later piece. One recording (no pieces) has
-- nowhere to skip to.
function UI.Seek(seconds)
  local state = UI.TransportState()
  if not state then return false end
  local target, wasPlaying = state.target, UI.speaking
  local want = math.max(0, math.min(state.duration - 0.001, state.offset + seconds))
  local parts = state.row.rates[1]
  if #parts < 2 then return false end
  local at, to = 1, 1   -- the piece playing (or paused in), and the one holding the time aimed at
  for i, part in ipairs(parts) do
    if part.start <= state.offset then at = i end
    if part.start <= want then to = i end
  end
  if seconds > 0 and to <= at then to = at + 1 end
  if to > #parts then return false end   -- already in the last piece
  local offset = parts[to].start
  UI.RememberProgress()
  UI.progress[target.key] = { offset = offset, rate = state.rate, pack = state.row.pack, hash = state.row.hash,
    fullHash = state.row.fullHash, started = target.started }
  UI.resumeTarget = target
  if wasPlaying then
    UI.RestartTransport(target)
  else
    UI.UpdateNowPlaying()
  end
  return true
end

-- Kept as no-op compatibility calls; in-game recordings only play at 1x.
function UI.SetPlaybackRate() return false end
function UI.CyclePlaybackRate() return false end


local function playbackStore()
  if type(LoreForeverDB) ~= "table" then return nil end
  if type(LoreForeverDB.playback) ~= "table" then LoreForeverDB.playback = {} end
  local who = ns.Journey and ns.Journey.CharKey and ns.Journey.CharKey() or "?"
  return LoreForeverDB.playback, who
end

function UI.SavePlayback()
  UI.RememberProgress()
  local store, who = playbackStore()
  if not store then return end
  local progress, any = {}, false
  for key, p in pairs(UI.progress) do
    if validProgress(p, key) then progress[key], any = p, true end
  end
  local edition = ns.lang and ns.lang.edition
  if edition and not edition.unavailable and (#UI.pl.items > 0 or UI.activeTarget) then any = true end
  if UI.miniClosed and #UI.pl.items > 0 then any = true end   -- keep the queue behind a closed player
  if not any then store[who] = nil return end
  local target = UI.resumeTarget or (edition and UI.activeTarget)
  store[who] = { version = 1, edition = ns.Lang.EditionKey(), progress = progress, target = target and {
    id = target.id, key = target.key, label = target.label, story = target.story, text = target.text,
    fromPlaylist = target.fromPlaylist }, items = UI.pl.items, pos = UI.pl.pos, closed = UI.miniClosed or nil }
end

function UI.RestorePlayback()
  local store, who = playbackStore()
  local saved = store and store[who]
  if type(saved) ~= "table" or saved.version ~= 1 or type(saved.progress) ~= "table" then return end
  if (saved.edition or "stock") ~= ns.Lang.EditionKey() then return end
  UI.miniClosed = saved.closed == true or nil
  for key, p in pairs(saved.progress) do
    local qid, kind
    if type(key) == "string" then qid, kind = key:match("^quest:(%d+)#(%a+)$") end
    if qid then ns.Voice.QuestClip(tonumber(qid), kind, nil, true) end
    if type(key) == "string" and validProgress(p, key) then UI.progress[key] = p end
  end
  local target = saved.target
  if type(target) == "table" and type(target.key) == "string" and type(target.id) == "string"
      and type(target.label) == "string" and type(target.text) == "string" and #target.text < 65536
      and (validProgress(UI.progress[target.key], target.key)
        or (ns.lang and ns.lang.edition and ns.Voice.HasAudio(target.key) and ns.Voice.CanPlay(target.key))) then
    target.fromPlaylist = target.fromPlaylist == true
    if ns.lang and ns.lang.edition then
      local key, original = target.key:match("^(.-)#faq(%d+)$")
      target = key and UI.FaqTarget(key, faqIndex(key, original)) or UI.EntryTarget(target.key)
    end
    UI.resumeTarget = target
  end
  if type(saved.items) == "table" and #saved.items <= 256 and type(saved.pos) == "number"
      and saved.pos >= 1 and saved.pos <= #saved.items and saved.pos % 1 == 0 then
    for _, it in ipairs(saved.items) do
      if type(it) ~= "table" or type(it.id) ~= "string" or type(it.label) ~= "string"
          or (it.key ~= nil and type(it.key) ~= "string") then return UI.UpdateNowPlaying() end
      if it.pages ~= nil then
        if type(it.quest) ~= "number" or type(it.pages) ~= "table" or #it.pages > 3 then return UI.UpdateNowPlaying() end
        if it.page ~= nil and (type(it.page) ~= "number" or it.page % 1 ~= 0 or it.page < 1 or it.page > #it.pages) then return UI.UpdateNowPlaying() end
        for _, kind in ipairs(it.pages) do
          if kind ~= "detail" and kind ~= "progress" and kind ~= "complete" then return UI.UpdateNowPlaying() end
        end
      end
    end
    local items, pos = saved.items, saved.pos
    if ns.lang and ns.lang.edition then
      items, pos = {}, nil
      for i, it in ipairs(saved.items) do
        local base, original = it.id:match("^(.-)#faq(%d+)$")
        local idx = base and faqIndex(base, original)
        local target = base and idx and UI.FaqTarget(base, idx) or (not base and UI.EntryTarget(it.id))
        if target and ns.Voice.HasAudio(target.key) and ns.Voice.CanPlay(target.key) then
          items[#items + 1] = { id = target.key, key = base or target.key, idx = idx, label = target.label }
          if i >= saved.pos and not pos then pos = #items end
        end
      end
      pos = pos or (#items > 0 and 1 or 0)
    end
    UI.pl.items, UI.pl.pos, UI.pl.state = items, pos, "paused"
    UI.PlaylistVoiceChanged()
  end
  UI.UpdateNowPlaying()
end


-- A recording of the current safe story can use the entry's headings, links and spoiler controls. Other
-- recordings keep their own transcript; matching a key alone must never substitute different story text.
local function recordedStoryMatches(key, text)
  local e = UI.engine.db.entries[key]
  if not e then return false end
  local parts = { e.n .. ". " .. e.s }
  for _, sec in ipairs(e.sec or {}) do
    if (sec.sp or 0) == 0 then parts[#parts + 1] = sec.b end
  end
  return ns.Voice.Plain(table.concat(parts, " ")) == ns.Voice.Plain(text)
end

-- Every recording that really starts adds its matching words to the conversation, even with the panel closed.
-- A Listen button on the current answer already has those words on screen. Quest dialogue has its own target
-- text: never substitute the quest's lore summary for what its giver says.
function UI.ReadAlong(target, fromPlaylist)
  local history = fromPlaylist and UI.historyFrame and UI.historyFrame:IsShown()
  local journey = fromPlaylist and UI.journeyPage and UI.journeyPage:IsShown()
  local last = UI.msgs[#UI.msgs]
  local key, idx = target.key:match("^(.-)#faq(%d+)$")
  local canonical = ns.Voice.lastClip and ns.Voice.lastClip.id == target.key and ns.Voice.lastClip.text
  if canonical == "" then canonical = nil end
  local story = canonical and recordedStoryMatches(target.key, canonical)
  local shownText = story and UI.EntryTarget(target.key).text or canonical or target.text
  if not target.asked and last and last.target and last.target.key == target.key
      and last.target.text == shownText and (not story or last.entry == true) then return end
  if story then
    UI.ShowEntry(target.key, "listen", target.asked)
  elseif canonical then
    if idx and not (ns.lang and ns.lang.edition) then UI.AddMessage("user", WHITE .. esc(target.label or "") .. "|r")
    elseif target.asked then UI.AddMessage("user", WHITE .. esc(target.asked) .. "|r") end
    UI.AddMessage("lore", GOLD .. esc(target.label or "") .. "|r\n" .. WHITE .. esc(canonical) .. "|r", target)
  elseif key and UI.engine.db.entries[key] then
    UI.ShowFaq(key, faqIndex(key, idx), "listen")
  elseif target.id == target.key and UI.engine.db.entries[target.key] then
    UI.ShowEntry(target.key, "listen", target.asked)
  else
    local text = GOLD .. esc(target.label or "") .. "|r"
    if target.text and target.text ~= "" then text = text .. "\n" .. WHITE .. esc(target.text) .. "|r" end
    UI.AddMessage("lore", text, target)
  end
  if history then UI.historyFrame:Show() end
  if journey then UI.journeyPage:Show() end
end

-- Start a target's recording, replacing whatever plays now. Returns true if it started; without a recording nothing
-- plays (Voice.Narrate). The playlist leaves an open History list alone (it moves on by itself; you didn't just press
-- anything).
local function startTarget(target, fromPlaylist, keepProgress)
  if not target or not ns.Voice.CanPlay(target.key) then return false end
  -- Whether it starts by itself (LOR-420): an arrival, a quest giver's or a book's page say so on their target (Voice
  -- sets target.byItself before UI.ListenTo; its markAuto only comes after this has counted the start), and a flight's
  -- zone story is its playlist item's. Read once: the same target played again later is the player's doing.
  local byItself = target.byItself
  target.byItself = nil
  if not byItself then ns.Voice.questWaiting = nil end   -- what you start outranks a quest giver's page waiting
  if fromPlaylist then
    local cur = UI.pl.items[UI.pl.pos]
    byItself = byItself or (cur and cur.flight)
  end
  if ns.lang and ns.lang.edition then
    local key, original = target.key:match("^(.-)#faq(%d+)$")
    local canonical = key and UI.FaqTarget(key, faqIndex(key, original)) or UI.EntryTarget(target.key)
    if not canonical then return false end
    canonical.asked, canonical.fromPlaylist = target.asked, target.fromPlaylist
    target = canonical
  end
  if not keepProgress then UI.RememberProgress() end
  ns.Voice.Stop()
  UI.speaking, UI.playingId = false, nil
  local progress = target and UI.progress[target.key]
  local options = target and validProgress(progress, target.key) and progress
  if options then
    local copy = {}
    for k, v in pairs(options) do copy[k] = v end
    copy.rate = ns.Voice.PlaybackRate()
    options = copy
  end
  local started = target and (fromPlaylist and ns.Voice.Play(target.key, options) or ns.Voice.Narrate(target.key, options))
  if not started then return false end
  if not (keepProgress or options) then   -- from its start
    local kind = ns.Log.NarrationKind(target.key)
    target.started = byItself and "auto" or "user"   -- (watchPlayback counts its end the same way)
    ns.Log.Use("play", kind)
    ns.Log.Use(target.started .. "play", kind)
  elseif options and not target.started and (options.started == "auto" or options.started == "user") then
    target.started = options.started   -- picked up where it paused: as it started then (UI.RememberProgress)
  end
  UI.speaking, UI.playingId, UI.playingLabel = true, target.id, target.label
  UI.playingKey, UI.playingStory = target.key, target.story
  target.fromPlaylist = fromPlaylist == true
  UI.activeTarget, UI.stoppedTarget = target, nil
  if ns.Voice.transport then UI.resumeTarget = target
  else UI.progress[target.key], UI.resumeTarget = nil, nil end
  local clip = ns.Voice.lastClip   -- a recording started: name it in its report box (ClipReport.lua)
  if clip and clip.id == target.key then
    clip.label = target.label
    if clip.text then
      local copy = {}
      for k, v in pairs(target) do copy[k] = v end
      -- A community recording's own words, and the name or question it was recorded with (Voice.ScopedClip).
      copy.text, copy.label, target = clip.text, clip.title or copy.label, copy
      UI.activeTarget, UI.resumeTarget = target, target
    end
  end
  if UI.historyFrame and not fromPlaylist then UI.historyFrame:Hide() end
  watchPlayback(#ns.Voice.Plain(target.text) / 15 + 3)
  if fromPlaylist then
    local cur = UI.pl.items[UI.pl.pos]
    if cur and cur.flight then ns.Voice.autoSession[target.key] = true end
  end
  if not keepProgress then UI.ReadAlong(target, fromPlaylist) end
  target.asked = nil
  return true
end

-- A story's next passage, right after its recording ends (watchPlayback): keeps the story's read-along and counts.
function UI.StartPassage(target, fromPlaylist)
  return startTarget(target, fromPlaylist, true)
end

-- A seek/rate change restarts an actual segment, keeping queue position and one read-along item.
function UI.RestartTransport(target)
  local started = startTarget(target, target.fromPlaylist, true)
  if not started and target.fromPlaylist then UI.pl.state = "paused" end
  UI.UpdateListen()
  return started
end

-- Whether a target is what plays now: the same recording, started here or somewhere else. A quest's playlist item
-- shares its lore entry's id, but plays the quest giver's words: those must not turn the lore answer's Listen to Stop.
function UI.IsPlayingTarget(t)
  if not (UI.speaking and t) then return false end
  if UI.playingKey and UI.playingKey ~= t.key then return false end
  if UI.playingId == t.id then return true end
  return t.key ~= t.id and UI.playingKey == t.key and ns.Voice.HasAudio(t.key)
end

-- Play a target. Pressing the one that's playing stops it; pressing anything else switches to it. Playing
-- something by hand pauses a playing playlist, except the playlist's own current item, which resumes it.
function UI.ListenTo(target)
  if not target then return end
  local pl = UI.pl
  if UI.IsPlayingTarget(target) then return UI.StopAll() end
  local cur = pl.items[pl.pos]
  -- A quest page's playlist item has its lore entry's id, but pressing Listen on that lore starts another recording.
  if cur and cur.id == target.id and not cur.pages then
    pl.state = "playing"
    if not startTarget(target) then pl.state = "paused" end
  else
    if pl.state == "playing" then pl.state = "paused" end
    startTarget(target)
  end
  UI.UpdateListen()
end

-- Stop any narration, whatever started it. A playlist pauses at the item it was on. A whole recording played by hand
-- (no saved position) is remembered so Shift-click can play it again (UI.ResumeStopped).
function UI.StopAll()
  ns.Voice.questWaiting, ns.Voice.questLeftover = nil, nil   -- a quest giver's page waiting its turn goes too
  UI.RememberProgress()
  local t = UI.activeTarget
  if UI.speaking and t and not t.fromPlaylist and not ns.Voice.transport then UI.stoppedTarget = t end
  ns.Voice.Stop()
  UI.playToken, UI.pl.token = nil, nil
  UI.speaking, UI.playingId = false, nil
  if UI.pl.state ~= "paused" then UI.pl.state = "paused" end
  UI.UpdateListen()
end

-- Pick up what was stopped, before anything new (Shift-click, the play/pause key and the player's Play; Mike,
-- 2026-10-09: "I expect shift-clicking to simply play and pause and play again"). A story played by hand resumes from
-- its saved place (or, without one, starts again). One stopped with at least 90% played counts as done ("only remove
-- it if you've listened to most of it"): a story played by hand isn't picked up again, and the playlist moves on to
-- its next item. Returns true when it handled the click, even if the recording couldn't start (a missing segment
-- never falls through to something else); false leaves it to the playlist.
local DONE_SHARE = 0.9
function UI.ResumeStopped()
  if UI.IsBusy() then return false end
  local state = UI.TransportState()
  if state and state.duration and state.duration > 0 and state.offset >= DONE_SHARE * state.duration then
    UI.progress[state.target.key], UI.resumeTarget = nil, nil
    if state.target.fromPlaylist then
      UI.PlaylistNext()
      return UI.IsBusy()
    end
    state = nil
  end
  if state and not state.target.fromPlaylist then
    UI.stoppedTarget = nil
    UI.ListenTo(state.target)
    return true
  end
  local t = UI.stoppedTarget
  if t and not state then
    UI.stoppedTarget = nil
    UI.ListenTo(t)
    return true
  end
  return false
end

-- Whether Shift-click would pick something up again (UI.ResumeStopped) rather than start the playlist or what's here.
function UI.HasStopped()
  if UI.IsBusy() then return false end
  local state = UI.TransportState()
  if state then
    return not state.target.fromPlaylist and not (state.duration and state.duration > 0
      and state.offset >= DONE_SHARE * state.duration)
  end
  return UI.stoppedTarget ~= nil
end

-- Whether anything is playing, or a playlist is between two items.
function UI.IsBusy()
  return UI.speaking or UI.pl.state == "playing"
end

-- Play an entry's narration and show its story in the chat, so what you hear is always on screen. Pressing it
-- again while it plays stops it (without posting the story twice).
function UI.PlayEntry(key, asked)
  local t = UI.EntryTarget(key)
  if not t then return end
  if UI.IsPlayingTarget(t) then return UI.ListenTo(t) end
  t.asked = asked
  UI.ListenTo(t)
end

function UI.UpdateListen()
  if ns.Voice.previewing and not ns.Voice.CanPlay(ns.Voice.previewClip) then ns.Voice.StopPreview() end
  if UI.speaking and UI.playingKey and not ns.Voice.CanPlay(UI.playingKey) then return UI.StopAll() end
  UI.UpdateNowPlaying()
  if UI.completion and UI.completion:IsShown() then UI.LayoutCompletion() end
  ns.Book.Changed()   -- heard: not new any more
  -- The Here tab's playlist buttons follow the playlist (+, then -, or a stop square while it plays).
  for _, b in ipairs(UI.bossButtons or {}) do
    if b:IsShown() and b.add:IsShown() then SetQueueButton(b.add, b.key) end
  end
  for _, list in ipairs({ UI.suggestions or {}, UI.questButtons or {} }) do
    for _, b in ipairs(list) do
      if b:IsShown() and b.add:IsShown() then SetQueueButton(b.add, b.add.key, b.add.idx) end
    end
  end
  for _, b in ipairs(UI.bubbles or {}) do
    for _, r in ipairs(b.rows) do
      if r:IsShown() then SetQueueButton(r.add, r.key) end
    end
  end
  for _, b in ipairs(UI.bubbles or {}) do
    -- Listen only where a voice recorded the answer: the rest stays as text (no game voice, Mike 2026-10-05). Heroes
    -- (the welcome card) use their big action button instead.
    local t = b.listen.target
    if b.frame:IsShown() and t and not b.isHero then
      local recorded = ns.Voice.HasAudio(t.key) and ns.Voice.CanPlay(t.key)
      local playing = UI.IsPlayingTarget(t)
      b.listen:SetText(playing and L["Stop"] or L["Listen"])
      local lw = b.listen.GetTextWidth and tonumber(b.listen:GetTextWidth())
      b.listen:SetWidth(math.max(84, (lw or 64) + 20))   -- a translation can run wider than the English
      -- An answer with no recording stays text: no Listen, and Willo isn't asked to read it (Mike, 10/23: "hide listen").
      b.listen:SetShown(recorded)
      -- "Add to playlist" beside Listen on recorded stories and answers.
      local qk, qi = UI.QueueRef(t)
      local can = recorded and qk and UI.CanQueue(qk, qi)
      -- While this item plays, Listen already says Stop: no second Stop beside it.
      local action = can and UI.QueueAction(t.id)
      can = can and action ~= "stop"
      b.queue:SetShown(can and b.listen:IsShown() or false)
      if can then
        b.queue:SetText(action == "remove" and L["Remove from playlist"] or L["Add to playlist"])
        local qw = b.queue.GetTextWidth and tonumber(b.queue:GetTextWidth())
        b.queue:SetWidth(math.max(90, (qw or 90) + 20))
      end
    elseif b.queue then
      b.queue:Hide()
    end
    if b.isHero and b.action.target then
      local playing = UI.IsPlayingTarget(b.action.target)
      b.action:SetText(playing and L["Stop"] or b.action.label)
    end
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
  ty.fs:SetText(ty.m.body or ty.m.text)
  if ty.chips and #UI.OffTextLinks(ty.m) > 0 then ty.chips:Show() end
end
UI.FinishTyping = finishTyping

local function startTyping(fs, m, chips)
  finishTyping()
  local toks, visible = typeTokens(m.body or m.text), 0   -- body: the text under an answer's title (Render)
  for _, tk in ipairs(toks) do visible = visible + tk[2] end
  local steps = math.max(1, math.floor(math.min(TYPE_MAX, visible / TYPE_CPS) / TYPE_TICK))
  local per = math.max(1, math.ceil(visible / steps))
  local ty = { fs = fs, m = m, chips = chips }
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

-- Rating an answer (LOR-120): a faint wax seal (a good answer) and a quill (not right) at the bottom left of every
-- answer, in sepia until the mouse is on one; your answer's mark keeps its own colours, the seal stamped in red wax
-- (Mike, 10/14: the green check and red cross broke immersion). The quill also opens the report box (UI.ShowReport),
-- which asks why and can copy a report code to send. Ratings are saved with the logged question.
-- The marks are the game's own icons: the wax seal on a note, cut round by a mask (the square crop where the client
-- has no masks), and a feather, its black ground dropped by ADD.
local MARKS = {
  seal = { tex = "Interface\\Icons\\INV_Misc_Note_02", coords = { 15 / 64, 31 / 64, 20 / 64, 36 / 64 }, rest = 0.42 },
  quill = { tex = "Interface\\Icons\\INV_Feather_01", coords = { 0.08, 0.92, 0.08, 0.92 }, blend = "ADD", rest = 0.5 },
}
local SEPIA = { 0.85, 0.78, 0.66 }

-- A mark ("seal" or "quill") as button b's icon, size square in its middle.
local function Mark(b, kind, size)
  local m = MARKS[kind]
  local icon = b:CreateTexture(nil, "ARTWORK")
  icon:SetSize(size, size)
  icon:SetPoint("CENTER")
  icon:SetTexture(m.tex)
  icon:SetTexCoord(unpack(m.coords))
  if m.blend then icon:SetBlendMode(m.blend) end
  local mask = kind == "seal" and b.CreateMaskTexture and icon.AddMaskTexture and b:CreateMaskTexture()
  if mask then
    mask:SetTexture(T.DISC, "CLAMPTOBLACKADDITIVE", "CLAMPTOBLACKADDITIVE")
    mask:SetAllPoints(icon)
    icon:AddMaskTexture(mask)
  end
  b.icon, b.mark = icon, m
  return icon
end

-- Faint sepia, or (lit: under the mouse, or your answer) the mark's own colours.
local function MarkLit(b, lit)
  b.icon:SetDesaturated(not lit)
  b.icon:SetVertexColor(lit and 1 or SEPIA[1], lit and 1 or SEPIA[2], lit and 1 or SEPIA[3], 1)
  b.icon:SetAlpha(lit and 0.9 or b.mark.rest)
end

local function SetRating(b, log)
  local show = log ~= nil
  b.up:SetShown(show)
  b.down:SetShown(show)
  b.up.label:SetShown(show)
  b.up.log, b.down.log = log, log
  if not show then return end
  b.up.lit, b.down.lit = log.helpful == true, log.helpful == false
  MarkLit(b.up, b.up.lit)
  MarkLit(b.down, b.down.lit)
end

local function RateButtons(parent)
  local function button(kind, onClick, title, tip)
    local b = CreateFrame("Button", nil, parent)
    b:SetSize(18, 18)
    b:SetHitRectInsets(-3, -3, -4, -4)   -- a 24px target around the 18px button (the two sit 6px apart)
    -- A dark disc under the mark, so it reads on parchment.
    local back = b:CreateTexture(nil, "BACKGROUND")
    back:SetSize(21, 21)
    back:SetPoint("CENTER")
    back:SetColorTexture(0.14, 0.10, 0.05, 0.9)
    local round = b.CreateMaskTexture and back.AddMaskTexture and b:CreateMaskTexture()
    if round then
      round:SetTexture(T.DISC, "CLAMPTOBLACKADDITIVE", "CLAMPTOBLACKADDITIVE")
      round:SetAllPoints(back)
      back:AddMaskTexture(round)
    end
    Mark(b, kind, 16)
    b:SetScript("OnClick", onClick)
    b:SetScript("OnEnter", function(self)
      MarkLit(self, true)
      GameTooltip:SetOwner(self, "ANCHOR_TOP")
      GameTooltip:AddLine(title)
      T.Tip(tip, "tipText", true)
      GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function(self)
      MarkLit(self, self.lit)
      GameTooltip:Hide()
    end)
    b:Hide()
    return b
  end
  local up, down
  up = button("seal", function(self)
    ns.Log.Feedback(self.log, true)
    SetRating({ up = up, down = down }, self.log)
  end, L["Good answer"], L["Tells us this answer was right."])
  down = button("quill", function(self)
    if self.log.helpful ~= false then ns.Log.Feedback(self.log, false) end   -- keeps a reason given earlier
    SetRating({ up = up, down = down }, self.log)
    UI.ShowReport(self.log)
    UI.SuggestWilloLine(self.log.q)   -- a wrong answer is when live answers help most (once a play session)
  end, L["Not right?"], L["Tell us what was wrong, and copy a short report to send us."])
  -- What the two marks ask, in words beside them (Design Lead, 10/25: round icons alone read as decoration).
  local label = T.PaperText(parent:CreateFontString(nil, "OVERLAY", T.font.small), "inkNote")
  label:SetText(L["Right answer?"])
  label:SetPoint("BOTTOMLEFT", PAD, 9)
  label:Hide()
  up.label = label
  up:SetPoint("LEFT", label, "RIGHT", 6, 0)
  down:SetPoint("LEFT", up, "RIGHT", 6, 0)
  return up, down
end

local function bubbleAt(i)
  local b = UI.bubbles[i]
  if not b then
    local f = CreateFrame("Frame", nil, UI.content)
    f:EnableMouse(true)
    f:SetScript("OnMouseDown", function() finishTyping() end)
    -- Lore links in the answer text (UI.Linker): click opens the entry, Shift-click queues it, hover explains.
    if f.SetHyperlinksEnabled then f:SetHyperlinksEnabled(true) end
    f:SetScript("OnHyperlinkClick", function(self, link, _, button) UI.OnLoreLink(self, link, button) end)
    f:SetScript("OnHyperlinkEnter", function(self, link) UI.LoreLinkTooltip(self, link) end)
    f:SetScript("OnHyperlinkLeave", function() GameTooltip:Hide() end)
    local bg = f:CreateTexture(nil, "BACKGROUND")
    bg:SetAllPoints()
    local edge = T.Outline(f, "bubbleEdge")   -- answers only (Render)
    -- An answer's first line (its gold title) in the heading face, above the text (Render, splitHead).
    local head = T.PaperText(f:CreateFontString(nil, "OVERLAY", T.font.answerTitle), "inkAccent")
    head:SetJustifyH("LEFT")
    head:SetJustifyV("TOP")
    head:Hide()
    -- "In this answer: [name] [name]": the names the answer links, again in one line under it (chipText).
    local chips = T.PaperText(f:CreateFontString(nil, "OVERLAY", T.font.small), "inkNote")
    chips:SetJustifyH("LEFT")
    chips:SetJustifyV("TOP")
    if chips.SetSpacing then chips:SetSpacing(3) end
    chips:Hide()
    local fs = T.PaperText(f:CreateFontString(nil, "OVERLAY", T.font.body), "ink")
    fs:SetJustifyH("LEFT")
    fs:SetJustifyV("TOP")
    if fs.SetSpacing then fs:SetSpacing(2) end
    local listen = PanelButton(f)
    listen:SetSize(84, 18)
    listen:SetPoint("BOTTOMRIGHT", -6, 6)
    listen:SetText(L["Listen"])
    listen:SetScript("OnClick", function(self) UI.ListenTo(self.target) end)
    listen:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_TOP")
      GameTooltip:AddLine(L["Narrated"])
      T.Tip(L["A recorded narration of this answer."], "tipText", true)
      GameTooltip:Show()
    end)
    listen:SetScript("OnLeave", function() GameTooltip:Hide() end)
    local queue = PanelButton(f)
    queue:SetSize(110, 18)
    queue:SetPoint("RIGHT", listen, "LEFT", -4, 0)
    queue:SetText(L["Add to playlist"])
    -- Works like the + in Found: Add to playlist, then Remove from playlist (Stop while it plays).
    queue:SetScript("OnClick", function()
      local t = listen.target
      if t then UI.DoQueueAction(UI.QueueRef(t)) end
    end)
    queue:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_TOP")
      queueTooltip(listen.target and listen.target.id)
      GameTooltip:Show()
    end)
    queue:SetScript("OnLeave", function() GameTooltip:Hide() end)
    queue:Hide()
    -- The welcome card's big "hear the story" button; on a card from UI.AddCard, its own action.
    local action = PanelButton(f, "primary")
    action:SetSize(300, 26)
    action:SetPoint("BOTTOMLEFT", PAD, 8)
    action:SetScript("OnClick", function(self)
      if self.onAction then self.onAction()
      elseif self.target then UI.PlayEntry(self.target.key, self.label) end
    end)
    action:Hide()
    -- A card that can be put away (the What's new card): × at its top right.
    local close = PanelButton(f)
    close:SetSize(22, 22)
    close:SetPoint("TOPRIGHT", -6, -6)
    close:SetText("\195\151")   -- ×
    close:SetScript("OnClick", function() UI.RemoveMessage(f.msg) end)
    close:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_TOP")
      GameTooltip:AddLine(L["Close"])
      GameTooltip:Show()
    end)
    close:SetScript("OnLeave", function() GameTooltip:Hide() end)
    close:Hide()
    b = { frame = f, bg = bg, edge = edge, head = head, chips = chips, fs = fs, listen = listen, queue = queue, action = action,
      close = close, rows = {} }
    b.up, b.down = RateButtons(f)
    UI.bubbles[i] = b
  end
  return b
end

-- A clickable boss row inside a bubble (the primer's "Who you'll face"): opens that boss's story, with play and +.
local function bossRow(parent)
  local r = TextButton(parent, 100, 20, nil, nil, true)
  r.text:ClearAllPoints()
  r.text:SetPoint("TOPLEFT", 6, -3)
  r:SetScript("OnClick", function(self) UI.ShowEntry(self.key, "primer", self.asked) end)
  r:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Click to open their story"])
    GameTooltip:Show()
  end)
  r:SetScript("OnLeave", function() GameTooltip:Hide() end)
  r.play = PlayButton(r)
  r.play:SetPoint("TOPRIGHT", -2, 0)
  r.add = QueueButton(r, 16)
  r.add:SetPoint("TOPRIGHT", -26, -2)
  return r
end

-- Lay out a message's boss rows under its text; returns the bubble's new height.
local function layoutRows(b, m, w, h)
  local y = h - PAD + 4
  for j, row in ipairs(m.rows or {}) do
    local r = b.rows[j] or bossRow(b.frame)
    b.rows[j] = r
    r.key, r.asked = row.key, string.format(L["Who is %s?"], row.name)
    r:SetWidth(w - 2 * PAD + 8)
    r.text:SetWidth(w - 2 * PAD - 52)
    r.text:SetText(GREY .. j .. ".|r " .. GOLD .. esc(row.name) .. "|r " .. WHITE .. esc(row.hook or "") .. "|r")
    local rh = math.max(22, (tonumber(r.text:GetStringHeight()) or 14) + 6)
    r:SetHeight(rh)
    r:ClearAllPoints()
    r:SetPoint("TOPLEFT", b.frame, "TOPLEFT", PAD - 6, -y)
    r.play.key, r.play.label = row.key, r.asked
    r.play:SetShown(ns.Voice.HasAudio(row.key))
    SetQueueButton(r.add, row.key)
    r:Show()
    y = y + rh
  end
  for j = #(m.rows or {}) + 1, #b.rows do b.rows[j]:Hide() end
  return m.rows and (y + PAD) or h
end

-- Lay out every message as a bubble: your questions on the right, lore on the left, notes centred in grey.
-- Conversation width for the current window size.
local function chatW()
  local w = UI.frame and UI.frame.GetWidth and tonumber(UI.frame:GetWidth())
  return (w and w > 0) and (w - CHAT_X - 40 - SHIFT_R) or CHAT_W
end

-- Re-fit everything that depends on the window width, then re-flow the bubbles.
function UI.Layout()
  local w = chatW()
  if UI.content then UI.content:SetWidth(w) end
  if UI.completion then UI.LayoutCompletion() end
  for _, b in ipairs(UI.historyFrame and UI.historyFrame.rows or {}) do b:SetWidth(w) end
  if UI.msgs then UI.Render(true) end
  if UI.msgs and #UI.msgs > 0 then UI.Refresh() end   -- a taller panel fits more of the Here list
  UI.ShowAskRow()
end

-- An answer whose first line is its gold title ("Who is Thrall?  -  Thrall"): that line, and the text under it.
local function splitHead(text)
  if type(text) ~= "string" or text:sub(1, #GOLD):lower() ~= GOLD then return nil end
  local nl = text:find("\n", 1, true)
  if not nl or nl > 200 then return nil end
  local body = text:sub(nl + 1)
  if not body:find("%S") then return nil end
  return text:sub(1, nl - 1), body
end

function UI.Render(keepScroll)
  local y, latestListen = 6, nil
  local CHAT_W = chatW()
  for i, m in ipairs(UI.msgs) do
    local b = bubbleAt(i)
    local f, fs = b.frame, b.fs
    f.msg = m   -- the message a clicked link came from (UI.FollowLink)
    f:ClearAllPoints()
    fs:ClearAllPoints()
    local head, body
    if m.role == "lore" or m.role == "hero" then head, body = splitHead(m.text) end
    m.body = body   -- what types in under the title (startTyping, finishTyping)
    fs:SetText(body or m.text)
    local w
    if m.role == "user" then
      local maxW = math.floor(CHAT_W * 0.72)
      fs:SetWidth(maxW - 2 * PAD)
      local tw = fs.GetStringWidth and fs:GetStringWidth()
      w = math.min(maxW, (tonumber(tw) or maxW) + 2 * PAD + 4)
      fs:SetWidth(w - 2 * PAD)
      f:SetPoint("TOPRIGHT", UI.content, "TOPRIGHT", -4, -y)
      T.Fill(b.bg, "bubbleUser")
    elseif m.role == "lore" then
      w = CHAT_W - 28
      fs:SetWidth(w - 2 * PAD)
      f:SetPoint("TOPLEFT", UI.content, "TOPLEFT", 2, -y)
      T.Fill(b.bg, "bubbleLore")
    elseif m.role == "hero" then
      w = CHAT_W - 8
      fs:SetWidth(w - 2 * PAD)
      f:SetPoint("TOPLEFT", UI.content, "TOPLEFT", 2, -y)
      T.Fill(b.bg, "bubbleHero")
    else
      w = CHAT_W - 8
      fs:SetWidth(w - 2 * PAD)
      f:SetPoint("TOPLEFT", UI.content, "TOPLEFT", 2, -y)
      T.Fill(b.bg, "none")
    end
    -- A faint edge sets answers off from the page; your questions and notes don't need one.
    b.edge:SetShown(m.role == "lore" or m.role == "hero")
    local top = PAD
    local story = m.role == "lore" and m.target and m.target.story == m.target.key
    local canPlay = m.target and ns.Voice.HasAudio(m.target.key) and ns.Voice.CanPlay(m.target.key)
    b.listen:ClearAllPoints()
    if head then
      b.head:SetWidth(w - 2 * PAD)
      b.head:SetText(head)
      b.head:ClearAllPoints()
      b.head:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, -PAD)
      b.head:Show()
      top = PAD + (tonumber(b.head:GetStringHeight()) or 16) + 4
      if story and canPlay then
        b.listen:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, -top)
        b.listen:SetHeight(24)
        top = top + 30
      end
    else
      b.head:Hide()
    end
    if not story or not head then
      b.listen:SetPoint("BOTTOMRIGHT", -6, 6)
      b.listen:SetHeight(18)
    end
    b.queue:ClearAllPoints()
    if story and head then b.queue:SetPoint("BOTTOMRIGHT", -6, 6)
    else b.queue:SetPoint("RIGHT", b.listen, "LEFT", -4, 0) end
    fs:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, -top)
    local h = (fs:GetStringHeight() or 14) + top + PAD
    -- The names the answer links that its text doesn't show ("In this answer: ..."), shown once it has typed in. A
    -- name linked in the text isn't repeated under it (Design Lead, 10/25).
    local chips = b.chips
    chips:ClearAllPoints()
    local off = UI.OffTextLinks(m)
    if #off > 0 then
      chips:SetWidth(w - 2 * PAD)
      chips:SetText(UI.ChipText(off))
      chips:SetPoint("TOPLEFT", f, "TOPLEFT", PAD, -(h - PAD + 6))
      h = h + (tonumber(chips:GetStringHeight()) or 12) + 6
      chips:SetShown(not (m.animate and not m.revealed))
    else
      chips:Hide()
    end
    if m.rows or #b.rows > 0 then h = layoutRows(b, m, w, h) end
    m.y = y
    b.listen.target = m.target
    b.isHero = m.role == "hero"
    b.action.target, b.action.label, b.action.onAction = nil, nil, nil
    b.action:Hide()
    b.close:SetShown(m.closable and true or false)
    b.queue:Hide()   -- UpdateListen shows it on recorded answers
    -- Only reserve room for Listen when a voice recorded the answer (the rest stays as text).
    if m.role == "lore" and canPlay then
      h = h + 22   -- queue and rating retain their familiar footer below the story
      b.listen:Show()
      latestListen = b.listen
    elseif b.isHero and (m.target or m.onAction) then
      h = h + 36
      b.listen:Hide()
      b.action.target, b.action.label, b.action.onAction = m.target, m.actionLabel, m.onAction
      b.action:SetText(m.actionLabel)
      b.action:Show()
    else
      b.listen:Hide()
    end
    -- Answers (and "I don't have that" replies) can be rated; they share the bottom row with Listen.
    local rate = m.log and (m.role == "lore" or m.role == "note") and m.log or nil
    if rate and not (m.role == "lore" and canPlay) then h = h + 22 end
    SetRating(b, rate)
    f:SetSize(w, h)
    f:Show()
    if m.animate and not m.revealed then
      if UI.typing and UI.typing.m == m then
        UI.typing.fs, UI.typing.chips = fs, chips   -- re-layout mid-animation: keep typing into the same bubble
      else
        startTyping(fs, m, chips)
      end
    end
    y = y + h + 10
  end
  for i = #UI.msgs + 1, #UI.bubbles do UI.bubbles[i].frame:Hide() end
  UI.content:SetHeight(y + 8)
  UI.PlaceNext()
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

-- Add a message. role: "user" | "lore" | "note". target: what its Listen button plays (lore only: a story's or an
-- answer's recording), shown only when a voice recorded it. Left out (the welcome back), the message has none: what no
-- voice recorded stays as text, never read out by the game's voice (Mike, 2026-10-05).
-- rows (lore only): clickable boss rows under the text, { {key, name, hook}, ... } (the dungeon primer).
-- log: the logged question this message answers (Log.Question), so it can be rated and reported.
-- subject: the entry key the message is about (Back goes to it); linked: the keys its lore links point to, in order,
-- for the "In this answer" line (UI.Linker).
-- entry: the full formatted entry, so replaying it can reuse this message; a primer or FAQ is not that story.
function UI.AddMessage(role, text, target, actionLabel, rows, log, subject, linked, entry)
  -- Something new in the conversation: the answer Willo was to read isn't the one on screen any more (LOR-547; an
  -- answer that follows names itself again, UI.AfterAnswer).
  if role ~= "note" then ns.Companion.ClearRead() end
  if UI.historyFrame then UI.historyFrame:Hide() end
  if UI.journeyPage then UI.journeyPage:Hide() end
  finishTyping()
  local animate = role == "lore" and settings().typing ~= false
  table.insert(UI.msgs, { role = role, text = text, target = target, actionLabel = actionLabel, animate = animate,
    rows = rows, log = log, subject = subject, linked = linked and #linked > 0 and linked or nil, entry = entry })
  if ns.HistoryArchive and ns.HistoryArchive.On() and (role == "user" or role == "lore" or role == "note") then
    UI.historyId = UI.historyId or ns.HistoryArchive.ChatId()
    ns.HistoryArchive.Record("account", "chat_message", { chatId = UI.historyId, message = UI.msgs[#UI.msgs] })
  end
  local lines = {}
  for i, r in ipairs(rows or {}) do lines[#lines + 1] = i .. ". " .. esc(r.name) .. " " .. esc(r.hook or "") end
  table.insert(UI.blocks, #lines > 0 and (text .. "\n" .. table.concat(lines, "\n")) or text)
  while #UI.msgs > MAX_MESSAGES do
    table.remove(UI.msgs, 1)
    table.remove(UI.blocks, 1)
  end
  UI.Render()
end

-- A card in the conversation, like the welcome card but with its own button (actionLabel, onAction) and a × that puts
-- it away: the What's new card (WhatsNew.lua). Its text is a gold first line, then the body.
function UI.AddCard(text, actionLabel, onAction, first)
  UI.AddMessage("hero", text, nil, actionLabel)
  local m = UI.msgs[#UI.msgs]
  m.onAction, m.closable, m.news = onAction, true, true
  if first then
    table.insert(UI.msgs, 1, table.remove(UI.msgs))
    table.insert(UI.blocks, 1, table.remove(UI.blocks))
  end
  UI.Render()
  if first then
    -- After layout and the ordinary newest-message scroll: the update card must actually be in view.
    C_Timer.After(0, function() UI.scroll:SetVerticalScroll(0) end)
  end
end

-- Take one message out of the conversation (the × on a card).
function UI.RemoveMessage(m)
  for i, x in ipairs(UI.msgs) do
    if x == m then
      table.remove(UI.msgs, i)
      table.remove(UI.blocks, i)
      UI.UpdateListen()
      GameTooltip:Hide()
      if #UI.msgs == 0 then return UI.Refresh() end   -- nothing left: the welcome card comes back
      return UI.Render(true)
    end
  end
end

-- A grey note in the conversation (kept for callers from before the chat layout).
function UI.Append(text)
  UI.AddMessage("note", text)
end

-- items: { {key, idx?, label?, q?, name?, via?} }, or { live = question, label } to ask live answers
function UI.SetNext(items, label)
  local available = {}
  for _, it in ipairs(items) do
    local e = it.key and UI.engine.db.entries[it.key]
    local f = e and e.faq and e.faq[it.idx]
    -- Explicit reveal actions still open answer-only spoilers; question chips require real questions.
    if not it.idx or it.via == "reveal" or ns.Engine.HasQuestion(f) then
      available[#available + 1] = it
    end
  end
  items = available
  UI.nextFull = label or L["Suggested:"]   -- UI.PlaceNext fits it to the column
  UI.nextLabel:SetText(UI.nextFull)
  UI.nextLabel:SetShown(#items > 0)
  for i, b in ipairs(UI.nextButtons) do
    local it = items[i]
    if it then
      b.key, b.idx, b.via, b.section, b.live = it.key, it.idx, it.via, it.section, it.live
      b.everything = it.everything
      local who = it.name and (GREY .. "  (" .. esc(it.name) .. ")|r") or ""
      b.text:SetText(WHITE .. esc(it.label or it.q) .. "|r" .. who)
      b:Show()
    else
      b:Hide()
    end
  end
  UI.PlaceNext()
end

-- The suggestions sit right under the last message while the conversation is shorter than its space, so no empty
-- stretch reads as something missing (Mike, 10/13); once it fills the space, at the bottom above the message box.
function UI.PlaceNext()
  local label, sf, content = UI.nextLabel, UI.scroll, UI.content
  if not (label and sf and content and UI.frame) then return end
  local gap = math.floor(math.max(0, (tonumber(sf:GetHeight()) or 0) - (tonumber(content:GetHeight()) or 0)))
  label:ClearAllPoints()
  label:SetPoint("BOTTOMLEFT", CHAT_X + 2, 110 + FOOT + gap)
  -- The invitation over the welcome's questions is a long sentence, longer still in some languages: where it doesn't
  -- fit the column (a narrow panel), the short heading stands in rather than running off the panel (ptBR, 10/18).
  if UI.nextFull then
    label:SetText(UI.nextFull)
    local w, room = T.TextWidth(label), (tonumber(UI.frame:GetWidth()) or W) - CHAT_X - 40 - SHIFT_R
    if w and w > room then label:SetText(L["Suggested:"]) end
  end
  local level = (tonumber(content:GetFrameLevel()) or 0) + 2   -- over the chat's empty space they now sit in
  for i, b in ipairs(UI.nextButtons) do
    b:ClearAllPoints()
    b:SetPoint("BOTTOMLEFT", UI.frame, "BOTTOMLEFT", CHAT_X, 108 - i * 22 + FOOT + gap)
    b:SetPoint("BOTTOMRIGHT", UI.frame, "BOTTOMRIGHT", -36 - SHIFT_R, 108 - i * 22 + FOOT + gap)
    b:SetFrameLevel(level)
  end
end

-- Panel state ----------------------------------------------------------------------------------------------------

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
  ns.Lang.ValidateEdition()
  if not (UI.frame and UI.frame:IsShown()) then return end
  local ctx = ns.Context.Snapshot()
  UI.ctx = ctx
  ns.Log.Map(ctx)
  UI.contextLine:SetText(esc(ns.Context.Describe(ctx)):gsub("||c", "|c"):gsub("||r", "|r"))
  UI.UpdateWilloIcon()

  local here, placeName, bosses, targetKey = UI.HereItems(ctx)
  UI.hereHeader:SetText(string.format(L["Here: %s"], esc(placeName or "?")))
  -- The Here list flows top to bottom: stories and questions, the dungeon's bosses, then your quests, stopping
  -- just above the player at the bottom (the panel can be resized taller for more).
  local fh = tonumber(UI.frame:GetHeight()) or H
  local bottom = -(fh - 8 - DOCK_H)
  local y = -(HERE_TOP + 20)
  for i, b in ipairs(UI.suggestions) do
    local s = here[i]
    if s then
      b.key, b.idx, b.primer, b.label, b.target = s.key, s.idx, s.primer, s.label, s.target
      b.full = s.name or s.label
      b.text:SetText((s.gold and INK_ACCENT or INK) .. esc(b.full) .. "|r")
      -- Play on the left of anything narrated (stories and recorded answers), + on the right of what can be queued.
      local story = s.key or (s.primer and "zone:" .. s.primer)
      local clip = s.idx and (faqID(s.key, s.idx)) or story
      b.play.key, b.play.idx, b.play.label = s.idx and s.key or story, s.idx, s.label
      b.play:SetShown(ns.Voice.HasAudio(clip) and true or false)
      local queue = s.key and SetQueueButton(b.add, s.key, s.idx)
      if not queue then b.add:Hide() end
      T.ShowMark(b.mark, s.target)
      b.text:SetPoint("BOTTOMRIGHT", queue and -26 or -6, 2)
      b:ClearAllPoints()
      b:SetPoint("TOPLEFT", 12, y)
      y = y - HERE_STEP
      b:Show()
    else
      b:Hide()
    end
  end

  UI.hereBosses = bosses
  local nb = 0
  if bosses and #bosses > 0 then
    UI.bossHeader:ClearAllPoints()
    UI.bossHeader:SetPoint("TOPLEFT", 16, y - 6)
    y = y - 26
    local anyQueue = false
    for i, bk in ipairs(bosses) do
      local b = UI.bossButtons[i]
      if not b or y - HERE_ROW < bottom then break end
      local e = UI.engine.db.entries[bk]
      local name = bossName(e)
      b.key, b.name, b.hook = bk, name, e.h or e.s
      b.asked = string.format(L["Who is %s?"], name)
      b.text:SetText(INK_FADED .. i .. ".|r " .. (bk == targetKey and INK_ACCENT or INK) .. esc(name) .. "|r")
      b.play.key, b.play.idx, b.play.label = bk, nil, b.asked
      b.play:SetShown(ns.Voice.HasAudio(bk) and true or false)
      local queue = SetQueueButton(b.add, bk)
      anyQueue = anyQueue or queue
      T.ShowMark(b.mark, bk == targetKey)
      b.text:SetPoint("BOTTOMRIGHT", queue and -26 or -6, 2)
      b:ClearAllPoints()
      b:SetPoint("TOPLEFT", 12, y)
      y = y - HERE_STEP
      b:Show()
      nb = i
    end
    UI.queueAllButton:SetShown(anyQueue)
    y = y - 6
  end
  UI.bossHeader:SetShown(nb > 0)
  UI.bossHeader.rule:SetShown(nb > 0)
  if nb == 0 then UI.queueAllButton:Hide() end
  for i = nb + 1, #UI.bossButtons do UI.bossButtons[i]:Hide() end

  local db, n = UI.engine.db, 0
  UI.questHeader:ClearAllPoints()
  UI.questHeader:SetPoint("TOPLEFT", 16, y - 10)
  y = y - 28
  -- Quests from where you are come first: with a full log the list runs out of room long before the end, and the
  -- log's own order is alphabetical by zone.
  local quests, rest = {}, {}
  for _, q in ipairs(ctx.quests or {}) do
    local inZone = q.header and (q.header == ctx.zone or q.header == ctx.subzone)
    table.insert(inZone and quests or rest, q)
  end
  for _, q in ipairs(rest) do quests[#quests + 1] = q end
  local function questKey(q)
    return db.index.quest[q.id] or (q.title and db.index.questTitle and db.index.questTitle[ns.Engine.lower(q.title)])
  end
  -- What the list calls a quest: the reading language's own client name where the client gives another (Lang.Shown),
  -- else the client's title. Display only: the quest log's title stays what everything matches on.
  local function questShown(q, key)
    return (key and ns.Lang.Shown(key)) or q.title
  end
  -- A search box when the log has more quests than fit (or while you're searching), taking the first row's place.
  local qs, total = UI.questSearch, #quests
  local fits = math.min(#UI.questButtons, math.floor((y - HERE_ROW - bottom) / HERE_STEP) + 1)
  local searchShown = qs:Active() or (qs.edit.HasFocus and qs.edit:HasFocus()) or total > fits
  qs:SetShown(searchShown and total > 0 and y - HERE_STEP - HERE_ROW >= bottom)
  if qs:IsShown() then
    qs:ClearAllPoints()
    qs:SetPoint("TOPLEFT", 12, y)
    y = y - HERE_STEP
  end
  if qs:Active() then
    local hits = {}
    for _, q in ipairs(quests) do
      local key = questKey(q)
      local e = key and db.entries[key]
      if UI.SearchMatch(qs.words, q.title, q.header, e and e.n, e and e.en, questShown(q, key)) then
        hits[#hits + 1] = q
      end
    end
    quests = hits
    UI.questCount:SetText(string.format(L["%d of %d"], #quests, total))
  else
    UI.questCount:SetText(total > 0 and tostring(total) or "")
  end
  for _, q in ipairs(quests) do
    local key = questKey(q)
    local b = UI.questButtons[n + 1]
    if not b or y - HERE_ROW < bottom then break end
    n = n + 1
    b.key, b.quest, b.shown = key, q, questShown(q, key)
    -- Quests without written lore still open: the game's own quest text plus the area's story.
    b.text:SetText((key and INK_ACCENT or INK_FADED) .. esc(b.shown) .. "|r")
    b.play.key, b.play.idx, b.play.label = key, nil, b.shown
    b.play:SetShown(key and ns.Voice.HasAudio(key) and true or false)
    local queue = key and SetQueueButton(b.add, key)
    if not queue then b.add:Hide() end
    b.text:SetPoint("BOTTOMRIGHT", queue and -26 or -6, 2)
    b:ClearAllPoints()
    b:SetPoint("TOPLEFT", 12, y)
    y = y - HERE_STEP
    b:Show()
  end
  for i = n + 1, #UI.questButtons do UI.questButtons[i]:Hide() end
  -- An empty log says what the list is for; a search with no match says so.
  local noQuests = #quests == 0 and y - 24 >= bottom
  if noQuests then
    UI.noQuests:ClearAllPoints()
    UI.noQuests:SetPoint("TOPLEFT", 18, y - 2)
    UI.noQuests:SetText(total > 0 and UI.NoMatchText(qs)
      or L["No quests in your log. Pick one up and the story behind it shows here."])
  end
  UI.noQuests:SetShown(noQuests)
  UI.UpdateListen()

  -- The welcome card follows you until you ask something: opened on a flight over Northshire, it shouldn't still
  -- offer Northshire's questions in Redridge an hour later.
  local where = (ctx.zone or "") .. "|" .. (placeName or "")
  if #UI.msgs == 0 then
    UI.ShowWelcome(ctx, placeName, here)
  elseif UI.welcomeFor and UI.welcomeFor ~= where and UI.WelcomeOnly() then
    -- The What's new card above it stays.
    local card = UI.msgs[1].news and { UI.msgs[1], UI.blocks[1] }
    UI.msgs, UI.blocks = {}, {}
    if card then UI.msgs[1], UI.blocks[1] = card[1], card[2] end
    UI.ShowWelcome(ctx, placeName, here)
  end
  -- Autoplay can fill the closed panel before its first open. Pending update notes still belong above that story.
  if ns.WhatsNew.Pending("card") then ns.WhatsNew.AddCard(true) end
  UI.welcomeFor = UI.WelcomeOnly() and where or nil
  -- Short enough to fit the box in every language: the zone's name, not an example question (Design Lead, 10/25).
  if UI.inputHint then
    local zone = type(ctx.zone) == "string" and ctx.zone ~= "" and ctx.zone or nil
    UI.inputHint:SetText(zone and string.format(L["Ask anything about %s"], esc(zone)) or L["Ask anything about the world"])
  end
end

-- Whether the conversation is still just the welcome card (nothing asked or played since).
function UI.WelcomeOnly()
  if #UI.msgs == 0 then return false end
  for _, m in ipairs(UI.msgs) do
    if not m.welcome then return false end
  end
  return true
end

-- Each people's starting zone, for the welcome card when where you are has no recorded narration.
local RACE_START = { Human = "zone:elwynn", Dwarf = "zone:dunmorogh", Gnome = "zone:dunmorogh",
  NightElf = "zone:teldrassil", Orc = "zone:durotar", Troll = "zone:durotar", Tauren = "zone:mulgore",
  Undead = "zone:tirisfal", Scourge = "zone:tirisfal", Skyborne = "zone:zephras" }

-- The first thing you see: a narrated story to press play on, and questions to ask. It leads with the two things
-- the add-on does best (voiced lore and answering questions) instead of an empty chat.
-- Back for another session, the card is what you did last time instead (Journey.Recap), once per session.
function UI.ShowWelcome(ctx, placeName, here)
  UI.welcoming = true
  -- After an update, the first time the panel opens: the What's new card, above the welcome (WhatsNew.lua).
  if ns.WhatsNew.Pending("card") then ns.WhatsNew.AddCard() end
  local recap = ns.Journey.Recap()
  local target, yours = UI.ZoneTarget(), false
  if not (target and ns.Voice.HasAudio(target.key)) then
    local start = RACE_START[ctx.race or ""]
    if start and ns.Voice.HasAudio(start) then target, yours = UI.EntryTarget(start), true end
  end
  local name = target and UI.engine.db.entries[target.key].n
  local recorded = target and ns.Voice.HasAudio(target.key)
  local text = GOLD .. L["Welcome to Lore Forever"] .. "|r\n" .. WHITE
    .. L["The story behind the places, people and quests around you, told by narrators and ready for your questions."] .. "|r"
  if recap then
    UI.AddMessage("lore", recap.text)   -- never read aloud: no Listen
  elseif target and recorded then
    local label = yours and string.format(L["Hear your people's story: %s"], name)
      or string.format(L["Hear the story of %s"], name)
    UI.AddMessage("hero", text, target, label)
  else
    UI.AddMessage("hero", text)
  end
  local items = {}
  for _, s in ipairs(here or {}) do
    if s.idx then items[#items + 1] = { key = s.key, idx = s.idx, q = s.label } end
    if #items >= N_NEXT then break end
  end
  -- The invitation heads the questions it points at, not the conversation: as a line in the chat it was left behind
  -- between the card and the first question (Mike, 10/13).
  local try = placeName and string.format(L["Or ask anything about %s below. Try one of these:"], esc(placeName))
    or L["Or ask anything about where you are below. Try one of these:"]
  UI.SetNext(items, try)
  -- The card moves with you (UI.Refresh); last session's recap stays put.
  for _, m in ipairs(UI.msgs) do
    if m.role ~= "lore" then m.welcome = true end
  end
  UI.welcoming = nil
end

-- The "Here" list: your target, the subzone and zone stories (or the dungeon primer), then their top questions.
-- Also returns the dungeon's bosses in encounter order (inside a dungeon), and your target's key when it's someone
-- in particular (UI.TargetKey).
-- Where you are, as entries: the zone key, its zones[] record, its story's key, and the subzone's story's key (a
-- place, not a quest). Any of them can be nil.
local function herePlace(ctx)
  local db = UI.engine.db
  local zk = UI.engine:ZoneKey(ctx.zone)
  local z = zk and db.zones and db.zones[zk]
  local zkey = zk and db.entries["zone:" .. zk] and "zone:" .. zk
  local sub = ctx.subzone and ctx.subzone ~= ctx.zone and UI.engine:SubzoneKey(ctx.subzone, ctx.zone)
  if sub and not (db.entries[sub] and db.entries[sub].t ~= "quest") then sub = nil end
  -- Named as the header names them (Lang.Shown: the reading language's own client name, else the entry's).
  local function named(k) return ns.Lang.Shown(k) or db.entries[k].n end
  local place = (sub and named(sub)) or (zkey and named(zkey)) or ctx.subzone or ctx.zone
  if sub and zkey then place = named(sub) .. ", " .. named(zkey) end
  return zk, z, zkey, sub, place
end

function UI.HereItems(ctx)
  local db, eng, items, seen = UI.engine.db, UI.engine, {}, {}
  local zk, z, zkey, sub, place = herePlace(ctx)
  local bosses = {}
  if z and z.t == "dungeon" then
    for _, bk in ipairs(z.b or {}) do
      if db.entries[bk] then bosses[#bosses + 1] = bk end
    end
  end
  -- With a boss list below, fewer rows above it, so the bosses and your quests still fit.
  local cap = #bosses > 0 and 3 or #UI.suggestions
  local function add(it)
    local id = (it.key or "") .. ":" .. tostring(it.idx or it.primer or "")
    if not seen[id] and #items < cap then
      seen[id] = true
      items[#items + 1] = it
    end
  end
  local targetKey = ctx.targetName and UI.TargetKey(ctx.targetName)
  -- label: your side of the chat when a row is clicked; name: what the row shows (the mockups list stories by name).
  if targetKey then
    add({ key = targetKey, label = string.format(L["Who is %s?"], bossName(db.entries[targetKey])),
      name = bossName(db.entries[targetKey]), gold = true, target = true })
  elseif ctx.targetName then
    local tkey, how = eng:KeyForName(ctx.targetName)
    if tkey then
      add({ key = tkey, label = how == "mob" and string.format(L["About the %s"], db.entries[tkey].n)
        or string.format(L["Who is %s?"], ctx.targetName) })
    end
  end
  if z and z.t == "dungeon" and zkey then
    add({ primer = zk, label = string.format(L["Dungeon primer: %s"], z.n), gold = true })
  end
  if sub then
    add({ key = sub, label = string.format(L["The story of %s"], db.entries[sub].n), name = db.entries[sub].n,
      gold = true })
  end
  if zkey and not (z and z.t == "dungeon") then
    add({ key = zkey, label = string.format(L["The story of %s"], db.entries[zkey].n), name = db.entries[zkey].n,
      gold = true })
  end
  -- The place's questions in the engine's order: the obvious ones first ("How did I end up here?"), no spoilers
  -- or gameplay filler.
  -- Questions still in English in a translated reading language go last (the first one is the ask box's hint).
  local ranked, asks = {}, {}
  for _, k in ipairs({ sub or false, zkey or false }) do
    if k then ranked[k] = ns.Engine.RankedFaq(db.entries[k], ctx.race) end
  end
  for round = 1, 3 do
    for _, k in ipairs({ sub or false, zkey or false }) do
      local i = k and ranked[k][round]
      if i then asks[#asks + 1] = { key = k, idx = i, label = db.entries[k].faq[i].q } end
    end
  end
  for _, it in ipairs(ns.Engine.TranslatedFirst(db, asks)) do add(it) end
  return items, place, bosses, targetKey
end

-- Dungeon bosses ---------------------------------------------------------------------------------------------------
-- Each dungeon lists its bosses in encounter order (zones[zk].b). They're the main characters of a dungeon, so
-- they're easy to reach: target one and open the panel, click one in the primer or the Here tab, or queue them all.

-- Where a key sits in a dungeon's boss list: { zk = "deadmines", i = 8 }, or nil if it isn't a boss.
function UI.BossOf(key)
  if not UI.bossIndex then
    UI.bossIndex = {}
    for zk, z in pairs(UI.engine.db.zones or {}) do
      for i, bk in ipairs(z.b or {}) do UI.bossIndex[bk] = { zk = zk, i = i } end
    end
  end
  return key and UI.bossIndex[key]
end

-- The entry for a targeted NPC when it's someone in particular: a boss, or anyone with an entry of their own.
-- Creature types ("About the gnolls") don't count; those would open on every mob you fight.
function UI.TargetKey(name)
  local key, how = UI.engine:KeyForName(name)
  local e = key and how ~= "mob" and UI.engine.db.entries[key]
  if e and (e.t == "npc" or UI.BossOf(key)) then return key end
end

-- Opening the panel (book, minimap button, key, /lore) with someone in particular targeted also opens their story,
-- once per target: reopening with the same target doesn't post it again. Returns true if it did.
function UI.OpenTarget()
  if not UI.frame then return false end
  local name = ns.Context.NPCName("target")
  local key = name and UI.TargetKey(name)
  if not key or key == UI.targetOpened or UI.engine.lastKey == key then return false end
  UI.targetOpened = key
  if not UI.frame:IsShown() then UI.frame:Show() end
  UI.ShowEntry(key, "target", string.format(L["Who is %s?"], bossName(UI.engine.db.entries[key])))
  return true
end

-- Add each boss's story to the playlist in order: recorded ones only, overviews only (never a spoiler section).
function UI.QueueBosses(bosses)
  local n = 0
  for _, bk in ipairs(bosses or {}) do
    if UI.CanQueue(bk) and not UI.PlaylistIndex(bk) and UI.PlaylistAdd(bk) then n = n + 1 end
  end
  return n
end

-- Narrations ---------------------------------------------------------------------------------------------------------
-- The narration voice changed (Options or /lore voice): relabel Listen buttons and the lists that depend on it.
-- Chat already posted keeps its "(narrated)" tags; new answers follow the new voice.
function UI.OnVoiceChanged()
  UI.StopAll()
  UI.progress, UI.resumeTarget = {}, nil
  if not UI.frame then return end
  UI.PlaylistVoiceChanged()
  if UI.completion and UI.completion:IsShown() then UI.ShowCompletion(UI.input:GetText()) end
  UI.Render(true)
  UI.UpdateListen()
  UI.Refresh()
end

-- Play one recorded FAQ answer and show the question and answer in the chat (pressing it again stops it).
function UI.PlayFaq(key, idx)
  if UI.SpoilerGate(key, "faq", idx) then return end
  local target = UI.FaqTarget(key, idx)
  if not target then return end
  if UI.speaking and UI.playingId == target.id then return UI.ListenTo(target) end
  UI.ListenTo(target)
end

-- The sidebar's view, the book's bookmark: "here", "found" (Book.lua; "narrations" and "library", its old names, open
-- it too), "road" (the journey page with its zone chapters, Road.lua; "journey" is its old name) or "story" (the
-- storylines you're on). Older callers: "playlist" opens the queue above the player. `quiet`: the journey page opened
-- by itself (it's shown already).
function UI.ShowTab(view, quiet)
  if view == "playlist" then return UI.ShowQueue(true) end
  if not quiet and ns.Book and ns.Book.backTo then ns.Book.SetBackTo(nil) end   -- (a jump's way back lasts until you move on)
  if view == "narrations" or view == "library" then view = "found" end
  if view == "journey" then view = "road" end
  UI.ShowQueue(false)
  local was = UI.tab
  -- A page open on Found or Storylines is remembered when you leave, so coming back to that bookmark finds it where
  -- you left it. The other bookmarks (Here, Road) close it: the ribbon you pick is what you see.
  local P = ns.Page
  if not quiet and (was == "found" or was == "story") and was ~= view and P.IsShown() then
    UI.pageResume = UI.pageResume or {}
    UI.pageResume[was] = P.Snapshot()
  end
  UI.tab = view
  UI.hereView:SetShown(view == "here")
  UI.foundView:SetShown(view == "found")
  UI.roadView:SetShown(view == "road")
  UI.storyView:SetShown(view == "story")
  -- History and New chat are the conversation's, so only Here shows them; the place line and Willo's icon then end
  -- before the gear instead.
  local here = view == "here"
  UI.historyButton:SetShown(here)
  UI.newButton:SetShown(here)
  if not here and UI.historyFrame then UI.historyFrame:Hide() end
  UI.willoIcon:ClearAllPoints()
  UI.willoIcon:SetPoint("RIGHT", here and UI.historyButton or UI.optionsButton, "LEFT", -10, 0)
  UI.UpdateWilloIcon()
  local label
  for _, t in ipairs(UI.tabs) do
    t:SetOn(t.view == view)
    if t.view == view then label = t.label end
  end
  if UI.pageTitle then
    UI.pageTitle:SetText(label or "")
    UI.pageTitle:SetShown(view ~= "here" and true or false)
    UI.pageTitle.rule:SetShown(view ~= "here")
  end
  if view == "found" then
    ns.Book.Show()
    if UI.frame:IsShown() then UI.SeenPage("found") end
  elseif view == "story" then
    ns.Road.ShowStories()
  else
    ns.Book.HidePage()
  end
  if view == "road" then
    if quiet then ns.Road.RefreshSide() else ns.Road.ShowRoad() end
  elseif was == "road" and ns.Journey.IsShown() then
    ns.Journey.Hide()
  end
  -- Here and Road show their own pages, not the one that was open.
  if not quiet and (view == "here" or view == "road") then P.Hide() end
  -- Back on a bookmark that was left with a page open: that page, not the list (Page.Restore turns to it).
  local resume = UI.pageResume and UI.pageResume[view]
  if UI.pageResume then UI.pageResume[view] = nil end
  if not quiet and resume and was ~= view and (view == "found" or view == "story") then P.Restore(resume) end
end

-- A page of the Chronicle opened from another bookmark (a click on the Road): Found lights and the page opens on it.
-- `backTo` is the bookmark its Back arrow returns to once no page is behind it (Page.Back), so a click on the Road is
-- one step out and one step back. False when there's no such page.
function UI.OpenChronicle(key, backTo)
  local entry = key and UI.engine and UI.engine.db.entries[key]
  if not (UI.frame and entry) then return false end
  if not UI.frame:IsShown() then UI.frame:Show() end
  if UI.pageResume then UI.pageResume.found = nil end   -- (the page you chose, not the one you left on Found)
  UI.ShowTab("found")
  ns.Page.Show(key, "found")
  ns.Page.SetBackTo(backTo)
  return true
end

-- Found on chapter `ck` with `filters` ({ kind, pages, story }), from bookmark `from` ("road"): what a Road count opens,
-- with a gold "‹ Back to the Road" at its top right.
local FOUND_BACK = { road = "Back to the Road" }
function UI.OpenFound(ck, filters, from)
  local B = ns.Book
  if not (UI.frame and B and B.frame) then return end
  if not UI.frame:IsShown() then UI.frame:Show() end
  if UI.pageResume then UI.pageResume.found = nil end   -- (the list you asked for, not the page you left on Found)
  UI.ShowTab("found")
  if B.search and B.search:Active() then B.search:Clear() end
  filters = filters or {}
  B.chapter = ck
  B.kind, B.pages, B.story, B.rarity = filters.kind, filters.pages or "all", filters.story or "any", "any"
  if B.sort == "rarity" and B.kind ~= "items" then B.sort = "found" end
  B.RefreshSide()
  B.SetBackTo(from and FOUND_BACK[from] and { tab = from, label = L[FOUND_BACK[from]] } or nil)
end

-- "Tell me about the Defias Brotherhood": what a click on a name writes in the conversation as your question. An
-- English name its own story opens with "The" ("The Defias Brotherhood is ...") reads with "the" there (Design
-- Lead, 10/25); in another language the name stays as it is.
function UI.TellMeAbout(e)
  local n = tostring(e and e.n or "")
  local loc = ns.readingLocale
  if (loc == nil or loc == "enUS" or loc == "enGB") and not n:lower():find("^the ") then
    local story = tostring(e.s or ""):gsub("^%s+", "")
    if story:sub(1, #n + 4):lower() == "the " .. n:lower() then n = "the " .. n end
  end
  return string.format(L["Tell me about %s"], n)
end

-- "Ask about it in Here" (Found's page and a card's options): Here, with the page's story told in the conversation,
-- its questions under it, and the ask box about it. Asking is Here's job; Found's pages only show.
function UI.AskInHere(key)
  local e = key and UI.engine and UI.engine.db.entries[key]
  if not (UI.frame and e) then return end
  if not UI.frame:IsShown() then UI.frame:Show() end
  UI.ShowTab("here")
  UI.ShowEntry(key, "here", UI.TellMeAbout(e))
  if UI.inputHint then UI.inputHint:SetText(string.format(L["Ask about %s"], esc(e.n))) end
end

-- Playlist ---------------------------------------------------------------------------------------------------------
-- A queue of recorded narrations you build with + (Found, Here) or "Add to playlist" (chat). It plays them in
-- order with a short gap between. Stop anywhere pauses it at the current item; playing something by hand pauses it;
-- flight narration waits for it. State is in UI.pl (top of the file).
-- A quest is one item (UI.QueueQuest; on Mike's stream, 2026-10-04, only place stories would go in): its quest giver's
-- recorded pages one after another (it.quest, it.pages, and it.page, the one it's on), else its story's recording.

local GAP = 1.5   -- seconds between two items

-- The entry key and FAQ index behind a play target ("zone:elwynn#faq2" -> "zone:elwynn", 2), or nil for targets
-- that aren't a recorded story or answer (read-aloud answers have no key). A story's target names its entry (story):
-- a quest's plays its quest giver's words, under another key.
function UI.QueueRef(t)
  local key = t and (t.story or t.key)
  if not key then return nil end
  local base, fi = key:match("^(.-)#faq(%d+)$")
  if base then return base, faqIndex(base, fi) end
  return key, nil
end

-- Whether a story or answer can go in the playlist: it's recorded, and not a spoiler you haven't chosen to see. A
-- quest's story can when its quest giver's words are recorded, too (UI.CanQueueQuest).
function UI.CanQueue(key, idx)
  if not key then return false end
  local e = UI.engine and UI.engine.db.entries[key]
  if not e then return false end
  if not (ns.lang and ns.lang.edition) and not idx and e.t == "quest" and e.m
      and UI.CanQueueQuest(tonumber(e.m.id)) then return true end
  if not ns.Voice.HasAudio(idx and (faqID(key, idx)) or key) then return false end
  local f = idx and e.faq and e.faq[idx]
  if idx and not f then return false end
  return ns.Voice.CanPlay(idx and (faqID(key, idx)) or key)
end

function UI.PlaylistIndex(id)
  for i, it in ipairs(UI.pl.items) do
    if it.id == id then return i end
  end
end

-- What item `it` plays now, as a target, or nil when nothing of it can (the voice changed since it was queued, say): a
-- story's or answer's recording, or a quest's page it.page (else the next one that plays: it.page moves on to it).
local function itemTarget(it)
  if not it.pages then
    if not ns.Voice.HasAudio(it.id) or not UI.CanQueue(it.key, it.idx) then return nil end
    return it.idx and UI.FaqTarget(it.key, it.idx) or UI.EntryTarget(it.key)
  end
  for p = it.page or 1, #it.pages do
    local clip = UI.QuestPageClip(it.quest, it.pages[p], nil, it.asked)
    if clip then
      it.page = p
      local e = it.key and UI.engine.db.entries[it.key]
      return { id = it.id, key = clip, label = ns.Voice.questTitles[clip] or it.label,   -- (its language's, Voice.QuestClip)
        text = UI.QuestPageText(it.quest, it.pages[p]), story = it.key }
    end
  end
end

-- Whether item `it` can still play with the voices you have (UI.PlaylistVoiceChanged): a quest one of its pages.
local function playable(it)
  if not it.pages then return ns.Voice.HasAudio(it.id) end
  for _, kind in ipairs(it.pages) do
    if UI.QuestPageClip(it.quest, kind, true, it.asked) then return true end
  end
  return false
end

-- Go to item i, from its start (a quest from its first page).
local function goTo(i, replacing)
  if replacing then
    UI.RememberProgress()
    ns.Voice.Stop()
    UI.speaking, UI.playingId, UI.playToken, UI.activeTarget = false, nil, nil, nil
  end
  local pl = UI.pl
  pl.pos = i
  if pl.items[i] then
    local it = pl.items[i]
    it.page = nil
    UI.progress[it.id] = nil
    if it.pages then
      for _, kind in ipairs(it.pages) do
        local clip = UI.QuestPageClip(it.quest, kind, nil, it.asked)
        if clip then UI.progress[clip] = nil end
      end
    end
  end
end

-- Play items[pos]; startTarget posts the matching words only after its recording starts.
local function playCurrent(byHand)
  local pl = UI.pl
  local it = pl.items[pl.pos]
  -- A flight story may have been heard another way while waiting. Its automatic turn skips it, while the
  -- player's explicit Play/Next/Previous/Jump still replays whatever they choose.
  while it and it.flight and not byHand and (ns.Voice.autoSession[it.id]
      or (settings().skipHeard ~= false and ns.Voice.Heard(it.id))) do
    goTo(pl.pos + 1)
    it = pl.items[pl.pos]
  end
  if not it then return UI.PlaylistClear() end
  pl.token = nil
  -- Recorded narrations only (the voice may have changed since it was queued: then it has nothing to play).
  local target = itemTarget(it)
  if not target then
    pl.state = "paused"
    return UI.UpdateListen()
  end
  -- State first: if the clip ends at once, its end handler must see the playlist as playing.
  pl.state = "playing"
  if not startTarget(target, true) then pl.state = "paused" end
  UI.UpdateListen()
end

-- A clip ended on its own (watchPlayback). Move the playlist on after a short gap, unless something else starts first:
-- to a quest's next page, else the next item.
function UI.OnClipEnded()
  local pl = UI.pl
  if pl.state ~= "playing" and pl.state ~= "waiting" then return end
  if pl.state == "playing" then
    local it = pl.items[pl.pos]
    if it and it.pages and (it.page or 1) < #it.pages then
      it.page = (it.page or 1) + 1
    else
      if pl.pos >= #pl.items then return UI.PlaylistClear() end   -- that was the last one: the playlist is done
      goTo(pl.pos + 1)
    end
    UI.UpdateListen()
  end
  local token = {}
  pl.token = token
  C_Timer.After(GAP, function()
    if pl.token ~= token or UI.speaking or (pl.state ~= "playing" and pl.state ~= "waiting") then return end
    playCurrent()
  end)
end

local function showToast(text)
  local t = UI.toast
  if not t then return end
  local token = {}
  t.token = token
  t.text:SetText(text)
  t:Show()
  C_Timer.After(3, function() if t.token == token then t:Hide() end end)
end

-- A short note about the playlist: over the conversation while the panel is open, else in the chat window (the quest
-- log's Lore button, the floating player).
local function note(text)
  if UI.frame and UI.frame:IsShown() then return showToast(GREY .. text .. "|r") end
  DEFAULT_CHAT_FRAME:AddMessage(T.CHAT_PREFIX .. text)
end

-- A quest's name when the caller has none: its story's, the one you read, the game's, else "Quest 123".
local function questName(qid, key)
  local e = key and UI.engine.db.entries[key]
  if e then return e.n end
  local kept = LoreForeverDB and type(LoreForeverDB.quests) == "table" and LoreForeverDB.quests[qid]
  if type(kept) == "table" and type(kept.title) == "string" and kept.title ~= "" then return kept.title end
  local QL = _G.C_QuestLog
  local ok, t = false, nil
  if QL and QL.GetTitleForQuestID then ok, t = pcall(QL.GetTitleForQuestID, qid) end
  if ok and type(t) == "string" and t ~= "" then return t end
  return string.format(L["Quest %d"], qid)
end

-- The playlist item for quest qid, or nil when nothing of it is recorded: its quest giver's pages (UI.QuestPages) when
-- a voice has them, else its story when that's narrated. key: its lore entry (by default the quest's); title: its name
-- as the game shows it. asked: the player pressed Listen for its quest giver's words (UI.PlayQuestDialogue): only those.
local function questItem(qid, title, key, asked)
  local db = UI.engine.db
  key = key or db.index.quest[qid]
  if not (key and db.entries[key]) then key = nil end
  local it = { id = key or ("quest:" .. qid), key = key, quest = qid, label = title or questName(qid, key) }
  local pages = UI.QuestPages(qid, false, asked)
  if #pages > 0 then
    it.pages = pages
    it.asked = asked or nil
    return it
  end
  if not asked and key and ns.Voice.HasAudio(key) then return it end
end

-- A new item for a story (idx nil) or narrated answer, or nil when it can't be queued (a quest's story is its quest).
local function newItem(key, idx)
  local e = key and UI.engine.db.entries[key]
  if not e then return nil end
  local qid = not (ns.lang and ns.lang.edition) and not idx and e.t == "quest" and e.m and tonumber(e.m.id)
  if qid then return questItem(qid, nil, key) end
  if not UI.CanQueue(key, idx) then return nil end
  return { id = idx and (faqID(key, idx)) or key, key = key, idx = idx, label = idx and e.faq[idx].q or e.n }
end

-- Add item `it` to the end. The first item normally starts now or after what's playing; with a story paused outside the
-- queue it waits under that one (UI.RefreshPlaylist), which Play picks up first (UI.ResumeStopped).
-- deferStart keeps a stopped player paused when queuing from the composer. quiet omits the flash and note.
local function addItem(it, quiet, deferStart)
  local pl = UI.pl
  if not it or UI.PlaylistIndex(it.id) then return false end
  pl.items[#pl.items + 1] = it
  UI.miniClosed = nil   -- the floating player's X put it away until something joins the queue (UI.ClosePlayer)
  if not quiet then
    UI.FlashPlayer()
    showToast(GREEN .. L["Added to your playlist:"] .. "|r " .. WHITE .. esc(it.label) .. "|r"
      .. GREY .. "  (" .. string.format(L["%d of %d"], #pl.items, #pl.items) .. ")|r")
  end
  if #pl.items == 1 then
    pl.pos = 1
    if UI.speaking then pl.state = "waiting"
    elseif deferStart or UI.PlayerSolo() then pl.state = "paused"
    else return playCurrent() or true end
  end
  UI.UpdateListen()
  return true
end

-- Add a story (idx nil) or narrated answer to the end (addItem). Returns true if it was added.
function UI.PlaylistAdd(key, idx, quiet, deferStart)
  if not key or UI.PlaylistIndex(idx and (faqID(key, idx)) or key) then return false end
  local added = addItem(newItem(key, idx), quiet, deferStart)
  if added and not quiet then ns.Log.Use("pl", "add") end   -- usage counts (LOR-435); QueueHere counts its own
  return added
end

-- Shift-click on a quest wherever the add-on lists one (its Lore button in the quest log and the quest window, Your
-- quests, the Journey page and its Completed list, the player while its quest giver speaks): its narration joins the
-- playlist (questItem), or a short note says it's there already, or that nothing of it is recorded: never a silent
-- item, since the playlist plays recordings only. title: its name as the game shows it. Returns true if it was added.
function UI.QueueQuest(qid, title)
  qid = tonumber(qid)
  if not (qid and UI.engine) then return false end
  local key = UI.engine.db.index.quest[qid]
  if not UI.engine.db.entries[key or ""] then key = nil end
  local label = title or questName(qid, key)
  if UI.PlaylistIndex(key or ("quest:" .. qid)) then
    note(string.format(L["%s is already in your playlist."], esc(label)))
    return false
  end
  local it = questItem(qid, title, key)
  if not (it and addItem(it)) then
    note(string.format(L["%s isn't narrated yet."], esc(label)))
    return false
  end
  ns.Log.Use("pl", "quest")
  -- With the panel closed the note over the conversation can't show: the chat says it.
  if not (UI.frame and UI.frame:IsShown()) then
    DEFAULT_CHAT_FRAME:AddMessage(T.CHAT_PREFIX .. L["Added to your playlist:"] .. " " .. WHITE .. esc(it.label)
      .. "|r")
  end
  return true
end

-- Whether quest qid can go in the playlist, at a quick look (tooltips and the +; adding checks its words against the
-- game's too, UI.QueueQuest): a voice recorded its quest giver's words, or its story.
function UI.CanQueueQuest(qid)
  qid = tonumber(qid)
  if not (qid and UI.engine) then return false end
  if #UI.QuestPages(qid, true) > 0 then return true end
  local key = UI.engine.db.index.quest[qid]
  return key ~= nil and ns.Voice.HasAudio(key) or false
end

-- Whether a voice recorded what quest qid's giver said, so its Chronicle page has a Listen for it (and so
-- UI.PlayQuestDialogue plays): whatever Speak quest dialogue says. Never on a contributor's edition (no quest dialogue).
function UI.HasQuestDialogue(qid)
  qid = tonumber(qid)
  return qid ~= nil and UI.engine ~= nil and #UI.QuestPages(qid, true, true) > 0
end

-- Listen on a quest's Chronicle page, for what its quest giver said: the recorded offer, then what they said when you
-- handed it in once you have, as one playlist item that plays now, after the item you were on. Pressed on purpose, so it
-- plays with Speak quest dialogue off (that setting is for what plays by itself): UI.QuestPageClip, asked. Pressing it
-- while it plays stops it. Returns true when it plays or stopped; false when nothing of it is recorded.
function UI.PlayQuestDialogue(qid)
  qid = tonumber(qid)
  if not (qid and UI.engine) then return false end
  local pl = UI.pl
  local key = UI.engine.db.index.quest[qid]
  local id = key or ("quest:" .. qid)
  local cur = pl.items[pl.pos]
  if UI.speaking and UI.playingId == id and cur and cur.id == id and cur.pages and cur.asked then
    UI.StopAll()
    return true
  end
  local it = questItem(qid, nil, key, true)
  if not (it and it.pages) then return false end
  local at = UI.PlaylistIndex(id)
  if at then
    pl.items[at] = it   -- (its pages as they stand now)
  else
    at = math.min(pl.pos, #pl.items) + 1
    table.insert(pl.items, at, it)
  end
  UI.miniClosed = nil
  goTo(at, true)
  playCurrent(true)
  return pl.state == "playing"
end

-- Flight narration: a zone's recorded story joins the playlist instead of cutting into what's playing, so zones
-- crossed quickly play one after another. If the playlist was stopped partway, the zone story goes in at that
-- place and plays now (you turned flight narration on), and your list carries on after it.
function UI.PlaylistAddFlight(key)
  local pl = UI.pl
  if not UI.CanQueue(key) or UI.PlaylistIndex(key) then return false end
  -- A flight's item says so before it can start (it may start at once): it starts by itself (LOR-420, startTarget).
  if #pl.items > 0 and pl.state == "paused" and not UI.IsBusy() then
    table.insert(pl.items, pl.pos, { id = key, key = key, label = UI.engine.db.entries[key].n, flight = true })
    UI.FlashPlayer()
    playCurrent()
    return true
  end
  local it = newItem(key)
  if it then it.flight = true end
  return addItem(it)
end

-- Shift-click or the play key with an empty playlist (Mike, 2026-09-30): queue everything narrated where you are
-- and start it. The area's story, then its answers; the zone's story, then its answers; in a dungeon, its bosses in
-- encounter order. A story playing already isn't queued again: the rest waits for it to end (Core's
-- playlistPlayPause). Returns how many were queued (0: nothing else here is narrated).
function UI.QueueHere()
  local db, n = UI.engine.db, 0
  local _, z, zkey, sub, place = herePlace(ns.Context.Snapshot())
  local function add(key, idx)
    if UI.speaking and UI.playingId == (idx and (faqID(key, idx)) or key) then return end
    if UI.PlaylistAdd(key, idx, true) then n = n + 1 end
  end
  for _, k in ipairs({ sub or false, zkey or false }) do
    if k then
      add(k)
      for i in ipairs(db.entries[k].faq or {}) do add(k, i) end
    end
  end
  for _, bk in ipairs(z and z.t == "dungeon" and z.b or {}) do add(bk) end
  if n > 0 then
    ns.Log.Use("pl", "here")
    UI.FlashPlayer()
    showToast(GREEN .. L["Playing everything narrated here:"] .. "|r " .. WHITE .. esc(place or "") .. "|r"
      .. GREY .. "  (" .. string.format(n == 1 and L["%d narration"] or L["%d narrations"], n) .. ")|r")
  end
  return n
end

-- A chapter's green + in Found (LOR-582, Mike on stream: "I kinda wanna have an ability to queue all of these"): the
-- stories join the playlist in that order, a dungeon's bosses right after its own story (as QueueHere does) unless
-- `exact` (Found lists only the bosses you've met). Spoilers and what's queued already stay out; the first one starts
-- if nothing plays. Returns how many joined.
function UI.QueueGroup(keys, label, exact)
  local zones, n = UI.engine.db.zones, 0
  local function add(k)
    if UI.CanQueue(k) and not UI.PlaylistIndex(k) and UI.PlaylistAdd(k, nil, true) then n = n + 1 end
  end
  for _, k in ipairs(keys or {}) do
    add(k)
    local z = zones[k:match("^zone:(.+)$") or ""]
    for _, bk in ipairs(not exact and z and z.t == "dungeon" and z.b or {}) do add(bk) end
  end
  if n > 0 then
    ns.Log.Use("pl", "add")
    UI.FlashPlayer()
    showToast(GREEN .. L["Added to your playlist:"] .. "|r " .. WHITE .. esc(label or "") .. "|r"
      .. GREY .. "  (" .. string.format(n == 1 and L["%d narration"] or L["%d narrations"], n) .. ")|r")
  else
    note(L["Everything here is already in your playlist."])
  end
  if ns.Book.OnTab() then ns.Book.Changed() end
  return n
end

-- Play or pause the playlist. Segmented clips retain their boundary; whole files restart the current item,
-- replacing anything played by hand. Returns false with nothing queued.
function UI.PlaylistToggle()
  if #UI.pl.items == 0 then return false end
  if UI.pl.state == "playing" then UI.StopAll() else ns.Log.Use("pl", "play"); playCurrent(true) end
  return true
end

-- The next item; after the last one the playlist ends. Returns false with nothing queued.
function UI.PlaylistNext()
  local pl = UI.pl
  if #pl.items == 0 then return false end
  ns.Log.Use("pl", "next")
  if pl.pos >= #pl.items then
    UI.PlaylistClear()
  else
    goTo(pl.pos + 1, true)
    playCurrent(true)
  end
  return true
end

-- The previous item (the first one starts again).
function UI.PlaylistPrev()
  local pl = UI.pl
  if #pl.items == 0 then return false end
  ns.Log.Use("pl", "prev")
  goTo(math.max(1, pl.pos - 1), true)
  playCurrent(true)
  return true
end

function UI.PlaylistJump(i)
  local pl = UI.pl
  if not pl.items[i] then return end
  ns.Log.Use("pl", "jump")
  goTo(i, true)
  playCurrent(true)
end

-- Empty the playlist. Stops the playlist's own clip, not something you played by hand.
function UI.PlaylistClear()
  local pl = UI.pl
  if pl.state == "playing" and UI.speaking then
    ns.Voice.Stop()
    UI.speaking, UI.playingId = false, nil
  end
  if UI.resumeTarget and UI.resumeTarget.fromPlaylist then
    UI.progress[UI.resumeTarget.key], UI.resumeTarget = nil, nil
  end
  if UI.activeTarget and UI.activeTarget.fromPlaylist then UI.activeTarget = nil end
  pl.items, pl.pos, pl.state, pl.token = {}, 0, "paused", nil
  UI.UpdateListen()
end

-- The queue's Clear all and the player's Clear playlist: the playlist empties, and a story played outside it, playing
-- or paused, goes too (the queue shows it on top, UI.RefreshPlaylist). Nothing is left to come back after /reload
-- (UI.SavePlayback), and Play doesn't pick a stopped one up again.
function UI.QueueClearAll()
  UI.PlaylistClear()   -- first: the playlist paused, a story ahead of it can't hand over to it
  UI.PlayerClearStory()
  local t = UI.resumeTarget   -- one the player can't show now (its voice turned off) goes too
  if t and not UI.speaking then UI.progress[t.key], UI.resumeTarget = nil, nil end
  UI.stoppedTarget = nil
  UI.UpdateListen()
end

-- Take item i out. Removing the one that's playing moves on to the next.
function UI.PlaylistRemove(i)
  local pl = UI.pl
  if not pl.items[i] then return end
  local wasPlaying = i == pl.pos and pl.state == "playing"
  if #pl.items == 1 then return UI.PlaylistClear() end
  if i == pl.pos and i == #pl.items then return UI.PlaylistClear() end   -- nothing after it: the playlist is done
  table.remove(pl.items, i)
  if i < pl.pos then
    pl.pos = pl.pos - 1
  elseif i == pl.pos then
    goTo(pl.pos, wasPlaying)   -- the next one takes its place, from its start
    if wasPlaying then return playCurrent() end
  end
  UI.UpdateListen()
end

-- The voice changed (Options or /lore voice): drop what the new voice has no recording of, so the playlist never
-- holds something it can't play.
function UI.PlaylistVoiceChanged()
  local pl = UI.pl
  local kept, pos, dropped, curDropped = {}, nil, 0, false
  for i, it in ipairs(pl.items) do
    if playable(it) then
      kept[#kept + 1] = it
      if i >= pl.pos and not pos then pos = #kept end
    else
      dropped = dropped + 1
      curDropped = curDropped or i == pl.pos
    end
  end
  if dropped == 0 then return end
  if curDropped and pl.state == "playing" then UI.StopAll() end
  if #kept == 0 or not pos then
    UI.PlaylistClear()
  else
    pl.items, pl.pos = kept, pos
    if curDropped then goTo(pos) end
  end
  showToast(GREY .. string.format(L["%d left your playlist: this voice has no recording of them."], dropped) .. "|r")
end

-- Move item i up (-1) or down (+1) among the ones still to come.
function UI.PlaylistMove(i, delta)
  local pl = UI.pl
  local j = i + delta
  if i <= pl.pos or j <= pl.pos or not pl.items[i] or not pl.items[j] then return end
  pl.items[i], pl.items[j] = pl.items[j], pl.items[i]
  UI.UpdateListen()
end

-- The queue: opens above the player, over the sidebar. What's playing, what's next (reorder, remove, Clear), what
-- already played.
local PL_ROW = 24
local QUEUE_SEARCH_FROM = 6   -- the queue gets a search box once it holds more than this

function UI.CreatePlaylist(view)
  -- An opaque parchment sheet over the sidebar that takes the clicks, so the list underneath can't be pressed
  -- through it.
  local sheet = CreateFrame("Frame", nil, view)
  sheet:SetPoint("TOPLEFT", 8, -60)
  sheet:SetPoint("BOTTOMRIGHT", view, "BOTTOMLEFT", SIDE_W, DOCK_H)
  sheet:SetFrameLevel(view:GetFrameLevel() or 1)
  sheet:EnableMouse(true)
  T.Parchment(sheet, "left")
  -- What's written on it goes on a frame over it (a frame's own text and lines draw under its child frames).
  local page = CreateFrame("Frame", nil, view)
  page:SetAllPoints(view)
  local close = CreateFrame("Button", nil, view, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", view, "TOPLEFT", SIDE_W + 2, -58)
  close:SetScript("OnClick", function() UI.ShowQueue(false) end)

  local head = Header(page, L["Now playing"], true)
  head:SetPoint("TOPLEFT", 16, -72)
  local count = Faint(page:CreateFontString(nil, "OVERLAY", T.font.small))
  count:SetPoint("LEFT", head, "RIGHT", 6, 0)
  local now = TextButton(view, SIDE_W - 20, 26, T.font.body, T.color.inkNow, true)
  now:SetPoint("TOPLEFT", 10, -92)
  now.text:SetPoint("TOPLEFT", 26, -2)
  if now.text.SetWordWrap then now.text:SetWordWrap(false) end
  local icon = now:CreateTexture(nil, "ARTWORK")
  icon:SetSize(18, 18)
  icon:SetPoint("LEFT", 4, 0)
  icon:SetTexture("Interface\\Buttons\\UI-SpellbookIcon-NextPage-Up")
  -- A story outside the queue on top (UI.RefreshPlaylist): pause it or pick it up again, as the player's Play does.
  now:SetScript("OnClick", function()
    if UI.PlayerSolo() then UI.PlayerPlay() else UI.PlaylistToggle() end
  end)
  now:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    T.Tip(self.full or "", "tipText", true)
    local solo = UI.PlayerSolo()
    T.Tip(solo and (UI.speaking and L["Click to pause"] or L["Resume starts at the previous audio segment."])
      or (UI.pl.state == "playing" and L["Click to pause"] or L["Click to play it from the start"]), "tipDim")
    GameTooltip:Show()
  end)
  now:SetScript("OnLeave", function() GameTooltip:Hide() end)

  local upHead = Header(page, L["Up next"], true)
  upHead:SetPoint("TOPLEFT", 16, -130)
  local clear = PanelButton(view)
  clear:SetHeight(20)
  clear:SetText(L["Clear all"])
  local cw = clear.GetTextWidth and tonumber(clear:GetTextWidth())
  clear:SetWidth(math.max(66, math.min(120, (cw or 46) + 20)))   -- "Alles löschen" runs wider than the English
  clear:SetPoint("TOPRIGHT", view, "TOPLEFT", SIDE_W - 10, -126)
  clear:SetScript("OnClick", function() UI.QueueClearAll() end)
  clear:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Empty the playlist"])
    GameTooltip:Show()
  end)
  clear:SetScript("OnLeave", function() GameTooltip:Hide() end)

  local sf = CreateFrame("ScrollFrame", "LoreForeverPlaylistScroll", view, "UIPanelScrollFrameTemplate")
  sf:SetPoint("TOPLEFT", 10, -152)
  sf:SetPoint("BOTTOMRIGHT", view, "BOTTOMLEFT", SIDE_W - 26, DOCK_H + 30)   -- room for a two-line note under it
  local content = CreateFrame("Frame", nil, sf)
  content:SetSize(SIDE_W - 40, 100)
  sf:SetScrollChild(content)

  -- Empty state: what the queue is for and how to fill it.
  local empty = CreateFrame("Frame", nil, view)
  empty:SetPoint("TOPLEFT", 16, -76)
  empty:SetPoint("BOTTOMRIGHT", view, "BOTTOMLEFT", SIDE_W - 8, DOCK_H + 20)
  local e1 = T.Ink(empty:CreateFontString(nil, "OVERLAY", T.font.heading), "inkAccent")
  e1:SetPoint("TOP", 0, -20)
  e1:SetText(L["Your playlist is empty."])
  local e2 = Faint(empty:CreateFontString(nil, "OVERLAY", T.font.small))
  e2:SetPoint("TOP", e1, "BOTTOM", 0, -10)
  e2:SetWidth(SIDE_W - 40)
  e2:SetJustifyH("CENTER")
  e2:SetText(L["Press + on any narration to add it here, or Shift-click it. They play in order, one after another."])
  local go = PanelButton(empty)
  go:SetHeight(22)
  go:SetText(L["Open Found"])
  local gw = go.GetTextWidth and tonumber(go:GetTextWidth())
  go:SetWidth(math.max(150, math.min(SIDE_W - 30, (gw or 120) + 24)))
  go:SetPoint("TOP", e2, "BOTTOM", 0, -14)
  go:SetScript("OnClick", function() UI.ShowTab("found") end)

  local note = Faint(page:CreateFontString(nil, "OVERLAY", T.font.small))
  note:SetPoint("BOTTOMLEFT", 16, DOCK_H + 8)
  note:SetWidth(SIDE_W - 20)
  note:SetJustifyH("LEFT")   -- two lines in some languages, growing upwards
  note:SetText(L["Add more with + on the pages in Found."])

  -- Over "Up next" once the queue is long (UI.RefreshPlaylist): filters Up next and Earlier by title.
  local search = UI.SearchBox(view, SIDE_W - 24, function() UI.RefreshPlaylist() end, sf, true)
  search:SetPoint("TOPLEFT", 12, -124)
  search:Hide()

  UI.plUI = { head = head, count = count, now = now, upHead = upHead, clear = clear, scroll = sf,
    content = content, empty = empty, note = note, close = close, go = go, search = search, view = view, rows = {} }
end

local function playlistRow(i)
  local P = UI.plUI
  local row = P.rows[i]
  if row then return row end
  row = TextButton(P.content, SIDE_W - 40, PL_ROW, T.font.small, nil, true)
  if row.text.SetWordWrap then row.text:SetWordWrap(false) end
  row.num = Faint(row:CreateFontString(nil, "OVERLAY", T.font.small))
  row.num:SetPoint("LEFT", 2, 0)
  row.num:SetWidth(16)
  row.num:SetJustifyH("RIGHT")
  row:SetScript("OnClick", function(self) if self.index then UI.PlaylistJump(self.index) end end)
  row:SetScript("OnEnter", function(self)
    if not self.index then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    T.Tip(self.full, "tipText", true)
    T.Tip(L["Click to play this now"], "tipDim")
    GameTooltip:Show()
  end)
  row:SetScript("OnLeave", function() GameTooltip:Hide() end)
  local function small(texture, onClick, tip)
    local b = CreateFrame("Button", nil, row)
    b:SetSize(20, 20)
    b:SetNormalTexture(texture)
    b:SetHighlightTexture("Interface\\Buttons\\UI-Common-MouseHilight", "ADD")
    b:SetScript("OnClick", function(self) onClick(self.index) end)
    b:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:AddLine(tip)
      GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function() GameTooltip:Hide() end)
    return b
  end
  row.remove = small("Interface\\Buttons\\UI-GroupLoot-Pass-Up", function(at) UI.PlaylistRemove(at) end,
    L["Remove from playlist"])
  row.remove:SetPoint("RIGHT", -2, 0)
  row.down = small("Interface\\Buttons\\UI-ScrollBar-ScrollDownButton-Up", function(at) UI.PlaylistMove(at, 1) end,
    L["Move down"])
  row.down:SetPoint("RIGHT", row.remove, "LEFT", -2, 0)
  row.up = small("Interface\\Buttons\\UI-ScrollBar-ScrollUpButton-Up", function(at) UI.PlaylistMove(at, -1) end,
    L["Move up"])
  row.up:SetPoint("RIGHT", row.down, "LEFT", -2, 0)
  P.rows[i] = row
  return row
end

function UI.RefreshPlaylist()
  local P, pl = UI.plUI, UI.pl
  if not P then return end
  local n, cur = #pl.items, pl.items[pl.pos]
  -- A story outside the queue, playing or paused, is on top as what plays (Mike, 2026-10-19: "show the current
  -- narration in the queue and to be able to clear the queue"); the queue's own current item waits under Up next.
  local solo = UI.PlayerSolo()
  local list = n > 0 or solo ~= nil
  for _, w in ipairs({ P.head, P.head.rule, P.count, P.now, P.upHead, P.upHead.rule, P.clear, P.scroll }) do
    w:SetShown(list)
  end
  P.note:SetShown(list)
  P.empty:SetShown(not list)
  -- A search box over "Up next" when the queue is long, or while it's in use; the list moves down for it.
  local search = P.search
  local searching = list and search:Active()
  local boxShown = list and (searching or n > QUEUE_SEARCH_FROM)
  search:SetShown(boxShown)
  local drop = boxShown and 28 or 0
  P.upHead:SetPoint("TOPLEFT", 16, -130 - drop)
  P.clear:SetPoint("TOPRIGHT", P.view, "TOPLEFT", SIDE_W - 10, -126 - drop)
  P.scroll:SetPoint("TOPLEFT", 10, -152 - drop)
  if not list then
    if search:Active() then search:Clear() end
    for _, r in ipairs(P.rows) do r:Hide() end
    return
  end
  if solo then
    P.head:SetText(UI.speaking and L["Now playing"] or L["Paused"])
    P.count:SetText("")
    P.now.full = solo.label
    P.now.text:SetText((UI.speaking and INK_GREEN or INK) .. esc(solo.label) .. "|r")
  else
    local ours = pl.state == "playing" or pl.state == "waiting"
    P.head:SetText(pl.state == "playing" and L["Now playing"] or (pl.state == "waiting" and L["Plays next"] or L["Paused"]))
    P.count:SetText(string.format(L["%d of %d"], pl.pos, n))
    P.now.full = cur.label
    P.now.text:SetText((ours and INK_GREEN or INK) .. esc(cur.label) .. "|r")
  end

  -- Up next (numbered, with reorder and remove), then the earlier ones, played or skipped (greyed; click to hear one).
  -- While searching, only matching items show (Earlier only if one of them matches), and the move arrows hide: moving
  -- past items you can't see would be guesswork.
  local function hit(i) return not searching or UI.SearchMatch(search.words, pl.items[i].label) end
  local specs = {}
  for i = math.max(1, solo and pl.pos or pl.pos + 1), n do
    if hit(i) then specs[#specs + 1] = { index = i } end
  end
  local earlier = {}
  for i = 1, pl.pos - 1 do
    if hit(i) then earlier[#earlier + 1] = { index = i, done = true } end
  end
  if #earlier > 0 then
    specs[#specs + 1] = { header = L["Earlier"] }
    for _, s in ipairs(earlier) do specs[#specs + 1] = s end
  end
  if searching and #specs == 0 then specs[1] = { note = UI.NoMatchText(search) }
  elseif not searching and (solo and n == 0 or not solo and pl.pos == n) then
    table.insert(specs, 1, { note = L["Nothing after this one."] })
  end
  local y = 0
  for r, s in ipairs(specs) do
    local row = playlistRow(r)
    row:ClearAllPoints()
    row:SetPoint("TOPLEFT", 0, -y)
    row.index = s.index
    local item = s.index and pl.items[s.index]
    row.full = item and item.label
    row:EnableMouse(item ~= nil)
    local upcoming = item and not s.done
    -- Arrows only where they can move something (the first can't go above what's playing, the last can't go lower).
    row.up:SetShown(upcoming and not searching and s.index > pl.pos + 1 or false)
    row.down:SetShown(upcoming and not searching and s.index < n or false)
    row.remove:SetShown(upcoming or false)
    row.up.index, row.down.index, row.remove.index = s.index, s.index, s.index
    row.num:SetText(item and tostring(s.index) or "")
    row.text:SetPoint("TOPLEFT", item and 22 or 4, -2)
    row.text:SetPoint("BOTTOMRIGHT", upcoming and -70 or -4, 2)
    if s.header then
      row.text:SetText(INK_ACCENT .. esc(s.header) .. "|r")
    elseif s.note then
      row.text:SetText(INK_FADED .. esc(s.note) .. "|r")
    else
      row.text:SetText((s.done and INK_FADED or INK) .. esc(item.label) .. "|r")
    end
    row:Show()
    y = y + PL_ROW + (s.header and 4 or 0)
  end
  for r = #specs + 1, #P.rows do P.rows[r]:Hide() end
  P.content:SetHeight(math.max(y, 10))
end

-- The player -------------------------------------------------------------------------------------------------------
-- Narration has its own player: docked at the bottom of the sidebar while the panel is open, and floating on screen
-- while it's closed (when something plays or is queued; Options can turn the floating one off). Both show the same:
--   title           what plays, what the playlist stopped at, or "Nothing playing"; click to open its story,
--                   Shift-click to add what you're hearing to the playlist (UI.PlayerQueue)
--   Queue           opens the playlist above the docked player (from the floating one: opens the panel on it)
--   a thin line     how far through the playlist you are
--   Prev · Play/Pause/Stop · Next, and "2 of 4"
--   X               the floating one only: stop, and hide it until something plays or is queued (UI.ClosePlayer)
-- Play with nothing queued plays everything narrated where you are (the same as Shift-clicking the minimap button).
-- Right-click the player for its options.

local function playerButton(parent, label, onClick, tip, kind)
  local b = PanelButton(parent, kind)
  b:SetHeight(22)
  b:SetText(label)
  b:SetScript("OnClick", onClick)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_TOP")
    GameTooltip:AddLine(self.tip or tip)
    if self.tip2 then T.Tip(self.tip2, "tipText", true) end
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  return b
end

-- Fit a button to its label, at least `min` wide.
local function fitButton(b, min)
  local tw = b.GetTextWidth and tonumber(b:GetTextWidth())
  b:SetWidth(math.max(min, (tw or min - 20) + 20))
end

local function arrowButton(parent, dir, tip, onClick)
  local b = CreateFrame("Button", nil, parent)
  b:SetSize(26, 26)
  b:SetNormalTexture("Interface\\Buttons\\UI-SpellbookIcon-" .. dir .. "Page-Up")
  b:SetPushedTexture("Interface\\Buttons\\UI-SpellbookIcon-" .. dir .. "Page-Down")
  b:SetDisabledTexture("Interface\\Buttons\\UI-SpellbookIcon-" .. dir .. "Page-Disabled")
  b:SetHighlightTexture("Interface\\Buttons\\UI-Common-MouseHilight", "ADD")
  b:SetScript("OnClick", onClick)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_TOP")
    GameTooltip:AddLine(tip)
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  return b
end

-- Play/Pause/Stop: what the middle button does right now.
--   something played by hand   Stop it (a waiting playlist stays where it is)
--   something stopped          pick it up again (UI.ResumeStopped)
--   a playlist                 Pause it, or Play it from its current item
--   nothing queued             play everything narrated where you are, else the area's story if it's narrated
function UI.PlayerPlay()
  local pl = UI.pl
  if UI.speaking and pl.state ~= "playing" then return UI.StopAll() end
  if UI.ResumeStopped() then return end
  if UI.PlaylistToggle() then return end
  if UI.QueueHere() > 0 then return end
  local zt = UI.ZoneTarget()
  if zt and ns.Voice.HasAudio(zt.key) then
    if UI.frame and UI.frame:IsShown() then
      UI.PlayEntry(zt.key, string.format(L["Tell me the story of %s"], zt.label))
    else
      UI.ListenTo(zt)
    end
  else
    showToast(GREY .. L["Nothing here is narrated yet. Shift-click any page in Found to add it to your playlist."] .. "|r")
  end
end

-- Next: skips ahead in the playlist; while something played by hand waits in front of it, starts the playlist.
function UI.PlayerNext()
  local pl = UI.pl
  if #pl.items > 0 and pl.state ~= "playing" and UI.speaking then return UI.PlaylistToggle() end
  UI.PlaylistNext()
end

-- The story in the player that isn't your queue's: played by hand or on arriving, playing or paused. nil if none.
function UI.PlayerSolo()
  if UI.speaking then return UI.pl.state ~= "playing" and UI.activeTarget or nil end
  local state = UI.TransportState()
  if state and not state.target.fromPlaylist then return state.target end
end

-- The player's right-click "Clear this story" (LOR-579; Mike on stream: "need a way to clear just the solo one"): that
-- story stops and leaves the player, its place forgotten. The queue stays: one waiting for it goes on as if it ended.
function UI.PlayerClearStory()
  local t = UI.PlayerSolo()
  if not t then return false end
  if UI.speaking then
    ns.Voice.Stop()
    UI.playToken, UI.speaking, UI.playingId = nil, false, nil
  end
  UI.progress[t.key] = nil
  UI.activeTarget, UI.resumeTarget, UI.stoppedTarget = nil, nil, nil
  UI.UpdateListen()
  if UI.pl.state == "waiting" then UI.OnClipEnded() end
  return true
end

-- The story behind what the player shows, in the chat (opening the panel if it's closed).
function UI.PlayerOpenStory()
  local pl = UI.pl
  local cur = pl.items[pl.pos]
  local key, idx
  if UI.speaking and pl.state ~= "playing" then
    key, idx = UI.QueueRef({ key = UI.playingStory or UI.playingId })   -- a quest page: its quest's story
  elseif cur then
    key, idx = cur.key, cur.idx
  end
  if not UI.frame:IsShown() then UI.frame:Show() end
  if key and UI.engine.db.entries[key] then
    if idx then UI.ShowFaq(key, idx, "player") else UI.ShowEntry(key, "player") end
  end
end

-- What a player shows that Shift-click on its title adds (UI.PlayerQueue), or nil: the quest whose quest giver
-- speaks ({ quest = id }), or a story or answer played by hand ({ key, idx }). The playlist's own item is in it.
local function playerShows()
  if not (UI.speaking and UI.pl.state ~= "playing") then return nil end
  local qid = tonumber(tostring(UI.playingId or ""):match("^questtext:(%d+):"))
  if qid then return { quest = qid } end
  local key, idx = UI.QueueRef({ key = UI.playingId, story = UI.playingStory })
  if key and UI.engine.db.entries[key] then return { key = key, idx = idx } end
end

-- Shift-click on a player's title: what it shows joins the playlist, a quest giver's words as their quest
-- (UI.QueueQuest), or a note says why not.
function UI.PlayerQueue()
  local s = playerShows()
  if s and s.quest then return UI.QueueQuest(s.quest, UI.playingLabel) end
  if s then return UI.QueueLink(s.key, s.idx) end
  local cur = UI.pl.items[UI.pl.pos]
  if cur then note(string.format(L["%s is already in your playlist."], esc(cur.label))) end
end

-- The recording a player can report (ClipReport.lua, LOR-232): the one playing, or the last one if nothing plays now.
-- nil while read-aloud speaks, or before any recording has played this session.
function UI.ReportableClip()
  local c = ns.Voice.lastClip
  if not (c and type(c.pack) == "string" and c.pack:find("^LoreForever_Voice_")) then return nil end
  if UI.speaking and UI.playingKey ~= c.id then return nil end
  return c
end

-- Right-click on a player: Clear queue, whether the floating player shows while the panel is closed, and reporting
-- the narration.
local function playerMenu(p)
  local m = p.menu
  if not m then
    m = T.Backdrop(CreateFrame("Frame", nil, p, T.BACKDROP_TEMPLATE), "popup")
    m:SetSize(SIDE_W - 8, 5 * 24 + 12)
    m:SetFrameStrata("DIALOG")
    local function item(i, onClick)
      local b = TextButton(m, SIDE_W - 20, 24, T.font.small)
      b:SetPoint("TOPLEFT", 6, -6 - (i - 1) * 24)
      if b.text.SetWordWrap then b.text:SetWordWrap(false) end
      b:SetScript("OnClick", function() m:Hide(); onClick() end)
      return b
    end
    m.clear = item(1, function() UI.QueueClearAll() end)
    m.clear.text:SetText(L["Clear playlist"])
    m.story = item(2, function()
      if UI.PlayerClearStory() then return end
      showToast(GREY .. L["Nothing to clear: no story is playing outside your playlist."] .. "|r")
    end)
    m.float = item(3, function()
      if LoreForeverDB and LoreForeverDB.settings then
        LoreForeverDB.settings.floatPlayer = not (settings().floatPlayer ~= false)
      end
      UI.UpdateNowPlaying()
      -- Unticked, the player is gone until it's ticked again, and reinstalling keeps that (LOR-241): say how.
      if settings().floatPlayer == false then
        DEFAULT_CHAT_FRAME:AddMessage(T.CHAT_PREFIX
          .. L["floating player off. Turn it back on in /lore options (Floating player), or type /lore reset."])
      end
    end)
    m.report = item(4, function()
      if UI.ReportableClip() then return UI.ShowClipReport() end
      showToast(GREY .. L["Play a narration first, then report it from the player."] .. "|r")
    end)
    -- Subtitles: the words of what plays, at the bottom of the screen (Subtitles.lua, LOR-344). Options has the same tick.
    m.subtitles = item(5, function() ns.Subtitles.Set(not ns.Subtitles.On()) end)
    m:SetScript("OnHide", nil)
    m:Hide()   -- a new frame starts shown, which made the first right-click only close it
    p.menu = m
  end
  if m:IsShown() then return m:Hide() end
  m:ClearAllPoints()
  m:SetPoint("BOTTOMLEFT", p, "TOPLEFT", 0, 2)
  local on = settings().floatPlayer ~= false
  m.story.text:SetText((UI.PlayerSolo() and "" or GREY) .. L["Clear this story"] .. (UI.PlayerSolo() and "" or "|r"))
  m.float.text:SetText((on and "|TInterface\\Buttons\\UI-CheckBox-Check:14|t " or "") .. L["Show the player when the panel is closed"])
  m.report.text:SetText((UI.ReportableClip() and "" or GREY) .. L["Report a problem with this narration"]
    .. (UI.ReportableClip() and "" or "|r"))
  m.subtitles.text:SetText((ns.Subtitles.On() and "|TInterface\\Buttons\\UI-CheckBox-Check:14|t " or "") .. L["Show subtitles"])
  m:Show()
end

-- Where an anchor point sits across and up a box: 0 its left or bottom edge, 0.5 the middle, 1 its right or top.
local function pointFraction(point)
  point = tostring(point or "CENTER")
  return point:find("LEFT") and 0 or point:find("RIGHT") and 1 or 0.5,
    point:find("BOTTOM") and 0 or point:find("TOP") and 1 or 0.5
end

-- The floating player's own place: where it was dragged to, or its first one, above the default chat window. A
-- saved place that's off the screen now is moved back onto it (and saved there).
local function placeMini(p)
  p:ClearAllPoints()
  local pos = settings().miniPlayerPos
  if type(pos) == "table" and pos[1] then
    local point, rel, x, y = pos[1], pos[2] or pos[1], tonumber(pos[3]) or 0, tonumber(pos[4]) or 0
    local sw, sh = screenSize()
    if sw then
      local w, h = tonumber(p:GetWidth()) or SIDE_W - 8, tonumber(p:GetHeight()) or PLAYER_H
      local rx, ry = pointFraction(rel)
      local px, py = pointFraction(point)
      local left, bottom = rx * sw + x - px * w, ry * sh + y - py * h
      local cl, cb = UI.ClampToScreen(left, bottom, w, h)
      if math.abs(cl - left) > 0.5 or math.abs(cb - bottom) > 0.5 then
        point, rel, x, y = "BOTTOMLEFT", "BOTTOMLEFT", cl, cb
        settings().miniPlayerPos = { point, rel, x, y }
      end
    end
    p:SetPoint(point, UIParent, rel, x, y)
  else
    p:SetPoint("BOTTOMLEFT", UIParent, "BOTTOMLEFT", 24, 260)
  end
end

-- A frame's left, right, top and bottom on screen, or nil before it has a place. inset: only the part its hit rect
-- covers (the quest window's art has see-through edges).
local function screenRect(f, inset)
  local l, r, t, b = f:GetLeft(), f:GetRight(), f:GetTop(), f:GetBottom()
  if not (l and r and t and b) then return nil end
  local il, ir, it, ib = 0, 0, 0, 0
  if inset and f.GetHitRectInsets then il, ir, it, ib = f:GetHitRectInsets() end
  local s = (f.GetEffectiveScale and f:GetEffectiveScale()) or 1
  return (l + (il or 0)) * s, (r - (ir or 0)) * s, (t - (it or 0)) * s, (b + (ib or 0)) * s
end

-- The quest window opens on the left of the screen, in the floating player's layer and over it, which is where the
-- player sits by default at the default UI scale: the quest giver's words played with the player's Stop hidden. While
-- the open quest window covers the player, the player waits beside it, and goes back when the window closes (unless
-- you drag it somewhere meanwhile). Called when the player shows and when the quest window opens or closes.
function UI.KeepPlayerClear()
  local p, qf = UI.mini, _G.QuestFrame
  if not p then return end
  if not (qf and qf:IsShown()) then p.stay = nil end
  if not (qf and qf:IsShown() and p:IsShown()) then
    if p.aside then
      p.aside = nil
      placeMini(p)
    end
    return
  end
  if p.aside or p.stay then return end
  local pl, pr, pt, pb = screenRect(p)
  local ql, qr, qt, qb = screenRect(qf, true)
  if not (pl and ql) or not (pl < qr and ql < pr and pb < qt and qb < pt) then return end
  local ir, it = 0, 0
  if qf.GetHitRectInsets then
    local _, r, t = qf:GetHitRectInsets()
    ir, it = r or 0, t or 0
  end
  p.aside = true
  p:ClearAllPoints()
  p:SetPoint("TOPLEFT", qf, "TOPRIGHT", 4 - ir, -it)
end

-- The docked player is one row across the foot of the book (the floating one keeps its box of two rows): Prev, Play and
-- Next (and the 10-second jumps, when the recording has them), then what plays with its line under it and "2 of 4"
-- beside it, the report quill and the Playlist button. Placed again when the jumps appear or go.
local DOCK_LEFT, DOCK_LEFT_JUMPS = 96, 172   -- where the controls end (without and with the jumps)

local function dockLayout(p, jumps)
  p.dockJumps = jumps and true or false
  p.prev:ClearAllPoints()
  p.prev:SetPoint("LEFT", p, "LEFT", 8, 0)
  p.play:ClearAllPoints()
  p.play:SetPoint("LEFT", p.prev, "RIGHT", 4, 0)
  p.next:ClearAllPoints()
  p.next:SetPoint("LEFT", p.play, "RIGHT", 4, 0)
  p.back:ClearAllPoints()
  p.back:SetPoint("LEFT", p.next, "RIGHT", 6, 0)
  p.forward:ClearAllPoints()
  p.forward:SetPoint("LEFT", p.back, "RIGHT", 2, 0)
  local mid = p.mid
  mid:ClearAllPoints()
  mid:SetPoint("TOPLEFT", p, "TOPLEFT", (jumps and DOCK_LEFT_JUMPS or DOCK_LEFT) + 10, -4)
  mid:SetPoint("BOTTOMRIGHT", p.queue, "BOTTOMLEFT", -36, -5)   -- room for the report quill
  p.state:ClearAllPoints()
  p.state:SetPoint("TOPRIGHT", mid, "TOPRIGHT", 0, -3)
  p.title:ClearAllPoints()
  p.title:SetHeight(20)
  p.title:SetPoint("TOPLEFT", mid, "TOPLEFT", 0, 0)
  p.title:SetPoint("RIGHT", p.state, "LEFT", -6, 0)
  p.track:ClearAllPoints()
  p.track:SetPoint("TOPLEFT", mid, "TOPLEFT", 0, -26)
  p.track:SetPoint("TOPRIGHT", mid, "TOPRIGHT", 0, -26)
  p.progress:ClearAllPoints()
  p.progress:SetPoint("TOPLEFT", p.track, "TOPLEFT", 0, 3)
  p.progress:SetPoint("TOPRIGHT", p.track, "TOPRIGHT", 0, 3)
  p.report:ClearAllPoints()
  p.report:SetPoint("RIGHT", p.queue, "LEFT", -10, 0)
end

function UI.CreatePlayer(parent, floating)
  local p = CreateFrame("Frame", floating and "LoreForeverMiniPlayer" or nil, parent, T.BACKDROP_TEMPLATE)
  p:SetSize(SIDE_W - 8, floating and PLAYER_H or DOCK_PLAYER_H)
  p.floating = floating
  local bg = T.Area(p, "dock")
  bg:SetAllPoints()
  p.bg = bg
  -- Docked: a gold line along its top edge; floating: a gold-rimmed box, the same look on its own.
  local rule = T.Area(p, "rim", "ARTWORK")
  rule:SetPoint("TOPLEFT")
  rule:SetPoint("TOPRIGHT")
  rule:SetHeight(1)
  if floating then
    T.Backdrop(p, "dock")
    rule:Hide()
    bg:SetPoint("TOPLEFT", 2, -2)
    bg:SetPoint("BOTTOMRIGHT", -2, 2)
    p:SetFrameStrata("MEDIUM")
    p:SetClampedToScreen(true)
    p:SetMovable(true)
    p:RegisterForDrag("LeftButton")
    p:SetScript("OnDragStart", p.StartMoving)
    p:SetScript("OnDragStop", function(self)
      self:StopMovingOrSizing()
      -- Dragged while the quest window is open: it stays where you put it, even over the window.
      self.aside, self.stay = nil, (_G.QuestFrame and QuestFrame:IsShown()) or nil
      local point, _, rel, x, y = self:GetPoint()
      if LoreForeverDB and LoreForeverDB.settings then LoreForeverDB.settings.miniPlayerPos = { point, rel, x, y } end
    end)
    placeMini(p)
    p:Hide()
  else
    p:SetPoint("BOTTOMLEFT", parent, "BOTTOMLEFT", 8, 8)
    p:SetPoint("BOTTOMRIGHT", parent, "BOTTOMRIGHT", -8, 8)
    p:SetFrameLevel((parent:GetFrameLevel() or 1) + 12)
  end
  p:EnableMouse(true)
  if not floating then p:SetHitRectInsets(0, 30, 0, 0) end   -- the window's resize corner is there
  p:SetScript("OnMouseUp", function(self, button) if button == "RightButton" then playerMenu(self) end end)

  -- Floating: an X in the top right corner stops what plays and puts the player away (UI.ClosePlayer; Mike,
  -- 2026-10-15: "Maybe a minus or an X on the player as well to hide it"). The client's X art fills its button, so it
  -- keeps the title bar's 6 px from the edge (inside the gold rim) and sits level with Queue.
  if floating then
    local close = CreateFrame("Button", nil, p, "UIPanelCloseButton")
    close:SetSize(20, 20)
    close:SetPoint("TOPRIGHT", -6, -7)
    close:SetScript("OnClick", function() UI.ClosePlayer() end)
    close:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_TOP")
      GameTooltip:AddLine(L["Stop and close"])
      T.Tip(L["Hides the player until something plays again. Your playlist stays."], "tipText", true)
      GameTooltip:Show()
    end)
    close:SetScript("OnLeave", function() GameTooltip:Hide() end)
    p.close = close
  end

  -- Playlist (top right, beside the floating player's X) and the title beside it.
  p.queue = playerButton(p, L["Playlist"], function()
    if floating then
      if not UI.frame:IsShown() then UI.frame:Show() end
      UI.ShowQueue(true)
    else
      UI.ShowQueue(not (UI.plView and UI.plView:IsShown()))
    end
  end, L["Your playlist"])
  p.queue.tip2 = L["What's playing and what's next: reorder, remove or clear. Add with + or Shift-click."]
  if floating then p.queue:SetPoint("TOPRIGHT", -32, -6)   -- 6 px clear of the X
  else p.queue:SetPoint("RIGHT", p, "RIGHT", -30, 0) end     -- clear of the window's resize corner
  -- A small list sign before "Playlist": three gold lines.
  p.queue.lines = {}
  for i = 1, 3 do
    local ln = T.Area(p.queue, "gold", "ARTWORK")
    ln:SetSize(8, 1.5)
    ln:SetPoint("LEFT", 7, 4 - (i - 1) * 4)
    p.queue.lines[i] = ln
  end
  local qfs = p.queue.GetFontString and p.queue:GetFontString()
  if qfs then qfs:ClearAllPoints(); qfs:SetPoint("CENTER", 6, 0) end
  local title = TextButton(p, 100, 22, T.font.control)
  title:SetPoint("TOPLEFT", 4, -6)
  title:SetPoint("RIGHT", p.queue, "LEFT", -4, 0)
  title.text:SetPoint("TOPLEFT", 4, -2)
  if title.text.SetWordWrap then title.text:SetWordWrap(false) end
  title:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  title:SetScript("OnClick", function(self, button)
    if button == "RightButton" then return playerMenu(p) end
    if IsShiftKeyDown() then return UI.PlayerQueue() end
    UI.PlayerOpenStory()
  end)
  if floating then
    title:RegisterForDrag("LeftButton")
    title:SetScript("OnDragStart", function() p:StartMoving() end)
    title:SetScript("OnDragStop", function() p:GetScript("OnDragStop")(p) end)
  end
  title:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_TOP")
    T.Tip(self.full or L["Nothing playing"], "tipText", true)
    local s = self.full and playerShows()
    if s and (s.quest and UI.CanQueueQuest(s.quest) or (s.key and UI.CanQueue(s.key, s.idx))) then
      T.Tip(L["Click to open. Shift-click adds it to your playlist."], "tipDim", true)
    elseif self.full then
      T.Tip(L["Click to open its story"], "tipDim")
    end
    T.Tip(floating and L["Drag to move. Right-click for options."] or L["Right-click for options."], "tipDim")
    GameTooltip:Show()
  end)
  title:SetScript("OnLeave", function() GameTooltip:Hide() end)
  p.title = title

  -- How far through the playlist: a thin gold status bar under the title, in a gold-rimmed track.
  local track = T.Area(p, "track", "ARTWORK")
  track:SetPoint("TOPLEFT", 9, -32)
  track:SetPoint("TOPRIGHT", -9, -32)
  track:SetHeight(5)
  p.track = track
  local trackRim = CreateFrame("Frame", nil, p)
  trackRim:SetAllPoints(track)
  T.Outline(trackRim, "rule")
  local fill = p:CreateTexture(nil, "OVERLAY")
  if T.HasTexture(T.STATUSBAR) then
    fill:SetTexture(T.STATUSBAR)
    fill:SetVertexColor(T.rgba(T.color.fill))
  else
    T.Fill(fill, "fill")
  end
  fill:SetPoint("TOPLEFT", track, "TOPLEFT", 1, -1)
  fill:SetHeight(3)
  fill:SetWidth(1)
  fill:Hide()
  p.fill = fill

  -- Prev · Play/Pause/Stop (a round gold button) · Next, then where you are in the playlist.
  p.prev = arrowButton(p, "Prev", L["Previous narration"], function() UI.PlaylistPrev() end)
  p.prev:SetPoint("BOTTOMLEFT", 5, 5)
  p.play = T.RoundButton(p, 28)
  p.play:SetScript("OnClick", function() UI.PlayerPlay() end)
  p.play:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_TOP")
    GameTooltip:AddLine(self.tip or L["Play"])
    GameTooltip:Show()
  end)
  p.play:SetScript("OnLeave", function() GameTooltip:Hide() end)
  p.play:SetText(L["Play"])
  p.play:SetPoint("LEFT", p.prev, "RIGHT", 4, 0)
  p.next = arrowButton(p, "Next", L["Next narration"], function() UI.PlayerNext() end)
  p.next:SetPoint("LEFT", p.play, "RIGHT", 4, 0)
  -- Bottom right: the quill from under answers, to report the recording (ClipReport.lua, LOR-232). With
  -- Options > Show the report button on the narration player (reportCross, on by default), it shows while a
  -- recording plays, or after one played (UI.ReportableClip). The right-click menu offers the same box either way.
  local report = CreateFrame("Button", nil, p)
  report:SetSize(14, 14)
  report:SetHitRectInsets(-4, -4, -5, -5)
  report:SetPoint("BOTTOMRIGHT", -7, 11)
  Mark(report, "quill", 14)
  MarkLit(report, false)
  report:SetScript("OnClick", function() UI.ShowClipReport() end)
  report:SetScript("OnEnter", function(self)
    MarkLit(self, true)
    GameTooltip:SetOwner(self, "ANCHOR_TOP")
    GameTooltip:AddLine(L["Problem with this narration?"])
    T.Tip(L["A name said wrong, the wrong voice, cut off: tell us, and it's recorded again."], "tipText", true)
    GameTooltip:Show()
  end)
  report:SetScript("OnLeave", function(self)
    MarkLit(self, false)
    GameTooltip:Hide()
  end)
  report:Hide()
  p.report = report
  -- These buttons exist only for recordings with validated real segment files.
  p.back = playerButton(p, "−10s", function() UI.Seek(-10) end, L["Back 10 seconds"])
  p.back:SetSize(34, 22)
  p.back:SetPoint("LEFT", p.next, "RIGHT", 4, 0)
  p.forward = playerButton(p, "+10s", function() UI.Seek(10) end, L["Forward 10 seconds"])
  p.forward:SetSize(34, 22)
  p.forward:SetPoint("LEFT", p.back, "RIGHT", 2, 0)
  for _, b in ipairs({ p.back, p.forward }) do b:Hide() end
  local progress = CreateFrame("Frame", nil, p)
  progress:SetPoint("TOPLEFT", 9, -30)
  progress:SetPoint("TOPRIGHT", -9, -30)
  progress:SetHeight(10)
  progress:EnableMouse(true)
  progress:SetScript("OnEnter", function(self)
    local state = UI.TransportState()
    if not state then return end
    local function stamp(seconds) return string.format("%d:%02d", math.floor(seconds / 60), math.floor(seconds % 60)) end
    GameTooltip:SetOwner(self, "ANCHOR_TOP")
    GameTooltip:AddLine(stamp(state.offset) .. " / " .. stamp(state.duration))
    T.Tip(L["Resume starts at the previous audio segment."], "tipDim", true)
    GameTooltip:Show()
  end)
  progress:SetScript("OnLeave", function() GameTooltip:Hide() end)
  progress:Hide()
  p.progress = progress
  p.state = Muted(p:CreateFontString(nil, "OVERLAY", T.font.small))
  p.state:SetPoint("LEFT", p.next, "RIGHT", 6, 0)
  p.state:SetPoint("RIGHT", report, "LEFT", -4, 0)
  p.state:SetJustifyH("RIGHT")
  if p.state.SetWordWrap then p.state:SetWordWrap(false) end
  if not floating then
    p.mid = CreateFrame("Frame", nil, p)   -- the room between the controls and the Playlist button
    dockLayout(p, false)
  end

  -- A brief gold flash when something is added to the playlist.
  local flash = T.Area(p, "flash", "OVERLAY")
  flash:SetAllPoints()
  flash:Hide()
  p.flash = flash
  return p
end

-- Fill a player in from the playlist and what plays.
local function updatePlayer(p)
  local pl, playing = UI.pl, UI.speaking
  local n, cur = #pl.items, pl.items[pl.pos]
  local list = n > 0
  local oneOff = playing and pl.state ~= "playing"
  local transport = UI.TransportState()
  local title, full, state, button, tip
  if oneOff then
    full = UI.playingLabel or L["narration"]
    title = GREEN .. esc(full) .. "|r"
    state = list and (pl.state == "waiting" and L["then your playlist"] or L["playlist paused"]) or ""
    button, tip = transport and L["Pause"] or L["Stop"], transport and L["Pause"] or L["Stop narration"]
  elseif not playing and transport and not transport.target.fromPlaylist then
    full = transport.target.label
    title, state = WHITE .. esc(full) .. "|r", L["Paused"]
    button, tip = L["Play"], L["Resume starts at the previous audio segment."]
  elseif list then
    full = cur.label
    local ours = pl.state == "playing" or pl.state == "waiting"
    title = (ours and GOLD or WHITE) .. esc(full) .. "|r"
    state = string.format(L["%d of %d"], pl.pos, n)
    if not ours then state = L["Paused"] .. "  " .. state end
    if pl.state == "playing" then
      button, tip = transport and L["Pause"] or L["Stop"], transport and L["Pause your playlist"] or L["Stop narration"]
    else
      button, tip = transport and L["Play"] or L["Restart"],
        transport and L["Resume starts at the previous audio segment."] or L["Click to play it from the start"]
    end
  else
    title = GREY .. L["Nothing playing"] .. "|r"
    state = ""
    button, tip = L["Play"], L["Play everything narrated here"]
  end
  -- The title in its own font; in the small one when it doesn't fit ("Aucune lecture en cours" beside "File
  -- d'attente"), on two lines if it still doesn't. Only a title too long even for that is cut.
  if not p.floating and p.dockJumps ~= (transport ~= nil) then dockLayout(p, transport ~= nil) end
  local tfs = p.title.text
  tfs:SetFontObject(T.font.control)
  tfs:SetText(title)
  local tw, room = T.TextWidth(tfs), tonumber(tfs:GetWidth())
  local small = tw and room and room > 0 and tw > room
  if small then tfs:SetFontObject(T.font.label) end
  local twoLines = small and (T.TextWidth(tfs) or 0) > room
  if tfs.SetWordWrap then tfs:SetWordWrap(twoLines and true or false) end
  tfs:SetPoint("TOPLEFT", 4, twoLines and 0 or -2)   -- two small lines need the row's full height
  tfs:SetPoint("BOTTOMRIGHT", -6, twoLines and 0 or 2)
  p.title.full = full
  p.state:SetText(state)
  p.state:SetShown(transport == nil)
  for _, b in ipairs({ p.back, p.forward, p.progress }) do b:SetShown(transport ~= nil) end
  if transport then
    p.back.tip2, p.forward.tip2 = L["Resume starts at the previous audio segment."], L["Resume starts at the previous audio segment."]
  end
  p.play:SetText(button)   -- hidden; the sign shows it
  p.play.tip = tip
  T.SetIcon(p.play, button == L["Pause"] and "pause" or (button == L["Stop"] and "stop" or "play"))
  p.queue:SetText(list and (L["Playlist"] .. " " .. GREEN .. n .. "|r") or L["Playlist"])
  fitButton(p.queue, 58)
  p.queue:SetWidth((tonumber(p.queue:GetWidth()) or 58) + 12)   -- room for the list sign
  local open = not p.floating and UI.plView and UI.plView:IsShown()
  if p.queue.LockHighlight then
    if open then p.queue:LockHighlight() else p.queue:UnlockHighlight() end
  end
  if p.prev.SetEnabled then p.prev:SetEnabled(list) end
  if p.next.SetEnabled then p.next:SetEnabled(list) end
  p.report:SetShown(settings().reportCross ~= false and UI.ReportableClip() ~= nil)
  local w = (tonumber(p:GetWidth()) or SIDE_W - 8) - 18
  if p.mid then w = (tonumber(p.mid:GetWidth()) or 0) > 2 and tonumber(p.mid:GetWidth()) - 2 or w - 270 end
  p.fill:SetShown(transport ~= nil or (list and not oneOff))
  if transport then p.fill:SetWidth(math.max(1, w * transport.offset / transport.duration))
  elseif list then p.fill:SetWidth(math.max(1, w * pl.pos / n)) end
end

local function flashPlayer()
  for _, p in ipairs({ UI.dock or false, UI.mini or false }) do
    local fl = p and p:IsShown() and p.flash
    if fl then
      local token, step = {}, 0
      fl.token = token
      fl:SetAlpha(1)
      fl:Show()
      local function fade()
        if fl.token ~= token then return end
        step = step + 1
        if step >= 12 then return fl:Hide() end
        fl:SetAlpha(1 - step / 12)
        C_Timer.After(0.08, fade)
      end
      C_Timer.After(0.08, fade)
    end
  end
end
UI.FlashPlayer = flashPlayer

-- Open or close the queue above the docked player. Picking a tab closes it too.
function UI.ShowQueue(show)
  if not UI.plView then return end
  if show and not UI.plView:IsShown() then ns.Log.Use("tab", "queue") end   -- usage counts (LOR-435)
  UI.plView:SetShown(show and true or false)
  if show then UI.RefreshPlaylist() end
  if UI.dock then updatePlayer(UI.dock) end
end

-- X forgets the current narration and closes the player across /reload. Queued stories stay for later;
-- playing or adding a story opens the player again. Pause still keeps the current narration's place.
function UI.ClosePlayer()
  UI.miniClosed = true
  UI.StopAll()
  local target = UI.resumeTarget or UI.activeTarget or UI.stoppedTarget
  if target then UI.progress[target.key] = nil end
  UI.activeTarget, UI.resumeTarget, UI.stoppedTarget = nil, nil, nil
  UI.SavePlayback()
  UI.UpdateListen()
end

-- Both players and the minimap button's ring: whenever something plays or the playlist changes. The floating
-- player shows only with the panel closed, while something plays or is queued, unless its X put it away.
function UI.UpdateNowPlaying()
  local pl = UI.pl
  if UI.dock then updatePlayer(UI.dock) end
  local mini = UI.mini
  if mini then
    if UI.IsBusy() then UI.miniClosed = nil end
    local want = settings().floatPlayer ~= false and not (UI.frame and UI.frame:IsShown()) and not UI.miniClosed
      and (UI.IsBusy() or UI.TransportState() ~= nil or #pl.items > 0)
    mini:SetShown(want and true or false)
    updatePlayer(mini)
    if not want and mini.menu then mini.menu:Hide() end
    UI.KeepPlayerClear()
  end
  if ns.SetButtonsPlaying then ns.SetButtonsPlaying(UI.IsBusy()) end
  if ns.Hooks and ns.Hooks.UpdateQuestPlayButton then ns.Hooks.UpdateQuestPlayButton() end
  if UI.plView and UI.plView:IsShown() then UI.RefreshPlaylist() end
  if ns.Subtitles then ns.Subtitles.Wake() end   -- the words of what plays (Subtitles.lua)
end

-- Options > Reset windows and /lore reset (LOR-241): every window back to where it starts, and the floating player and
-- the minimap button shown again. What's saved about them goes (the panel's place and size, the player's place, the
-- button's angle); the journey, history and every other setting, Panel size included, stay. Reinstalling the add-on
-- keeps SavedVariables, so this is the way back from a window hidden or moved out of reach.
local OTHER_WINDOWS = { "LoreForeverExport", "LoreForeverReport", "LoreForeverClipReport", "LoreForeverShare",
  "LoreForeverJourneyRecordBox", "LoreForeverLiveAnswers", "LoreForeverKeyPrompt" }

local function recentre(f, w, h)
  if not f then return end
  if f.SetUserPlaced then f:SetUserPlaced(false) end   -- the game's own layout cache mustn't put it back
  if w then f:SetSize(w, h) end
  f:ClearAllPoints()
  f:SetPoint("CENTER")
end

function UI.ResetWindows()
  local s = LoreForeverDB and LoreForeverDB.settings
  if not s then return end
  LoreForeverDB.window = nil
  s.miniPlayerPos, s.floatPlayer = nil, true
  UI.miniClosed = nil
  s.minimap, s.minimapAngle = true, nil
  recentre(UI.frame, W, H)
  for _, name in ipairs(OTHER_WINDOWS) do recentre(_G[name]) end
  local p = UI.mini
  if p then
    if p.SetUserPlaced then p:SetUserPlaced(false) end
    p.aside, p.stay = nil, nil
    placeMini(p)
  end
  if ns.MinimapButton then ns.MinimapButton() end
  if UI.buttonMenu then UI.buttonMenu:Hide() end   -- it hangs off the minimap button, which may have moved
  if ns.Subtitles then ns.Subtitles.Reset() end   -- (Shift-dragged somewhere: back above the action bars)
  UI.UpdateNowPlaying()
  local op = ns.Options and ns.Options.panel   -- open on our page: its ticks follow
  if op and op:IsVisible() and op:GetScript("OnShow") then op:GetScript("OnShow")(op) end
  DEFAULT_CHAT_FRAME:AddMessage(T.CHAT_PREFIX .. L["windows reset: the panel, the floating player and the minimap button are back where they started. The player shows while the panel is closed and something plays or waits in your playlist."])
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
        target = t and { id = t.id, key = t.key, text = t.text, label = t.label } or nil, rows = m.rows,
        subject = m.subject, linked = m.linked, entry = m.entry }
    end
  end
  local ctx = UI.ctx or {}
  local store = historyStore()
  -- A reopened chat is updated in place (and moves to the top) instead of being saved twice.
  for i = #store, 1, -1 do
    if UI.historyId and store[i].id == UI.historyId then table.remove(store, i) end
  end
  UI.historyId = UI.historyId or (time() .. "-" .. math.random(1000, 9999))
  local chat = { id = UI.historyId, edition = ns.Lang.EditionKey(), t = time(), zone = ctx.subzone or ctx.zone,
    title = title:sub(1, 60), msgs = msgs }
  if ns.HistoryArchive then ns.HistoryArchive.Record("account", "chat", { chat = chat, revision = "saved" }, chat.t) end
  table.insert(store, 1, chat)
  while #store > MAX_HISTORY do table.remove(store) end
end

function UI.CreateHistory(f)
  local h = CreateFrame("Frame", nil, f)
  h:SetPoint("TOPLEFT", CHAT_X - 4, -BOOK_TOP)
  h:SetPoint("BOTTOMRIGHT", -BOOK_R, DOCK_H)   -- down over the suggestions and message box, so none of the chat shows
  h:SetFrameLevel((f:GetFrameLevel() or 1) + 20)
  h:EnableMouse(true)
  local bg = T.Area(h, "overlay")
  bg:SetAllPoints()
  T.CoverChat(h)
  local title = Header(h, L["Past chats"])
  title:SetPoint("TOPLEFT", 10, -8)
  local close = PanelButton(h)
  close:SetSize(70, 20)
  close:SetPoint("TOPRIGHT", -8, -6)
  close:SetText(L["Back"])
  close:SetScript("OnClick", function() h:Hide() end)
  h.back = close   -- /lore qa presses it (SelfTest.lua)
  -- Search past chats: what you asked, where, and what the answers said.
  h.search = UI.SearchBox(h, 170, function() UI.RefreshHistory() end)
  h.search:SetPoint("RIGHT", close, "LEFT", -8, 0)
  h.empty = Muted(h:CreateFontString(nil, "OVERLAY", T.font.body))
  h.empty:SetPoint("TOPLEFT", 10, -36)
  h.empty:SetPoint("RIGHT", -10, 0)
  h.empty:SetJustifyH("LEFT")
  h.rows = {}
  for i = 1, HISTORY_ROWS do
    local b = TextButton(h, CHAT_W, 24, T.font.small, T.color.row)
    b:SetPoint("TOPLEFT", 8, -32 - (i - 1) * 26)
    b:SetScript("OnClick", function(self) UI.RestoreHistory(self.index) end)
    h.rows[i] = b
  end
  h:Hide()
  UI.historyFrame = h
end

local function ago(t)
  local d = time() - (t or 0)
  if d < 3600 then return string.format(L["%dm ago"], math.max(1, math.floor(d / 60))) end
  if d < 86400 then return string.format(L["%dh ago"], math.floor(d / 3600)) end
  return string.format(L["%dd ago"], math.floor(d / 86400))
end

function UI.SyncPageButtons()
  T.SetButtonSelected(UI.journeyButton, UI.journeyPage and UI.journeyPage:IsShown())
  T.SetButtonSelected(UI.historyButton, UI.historyFrame and UI.historyFrame:IsShown())
end

-- Whether a saved chat matches the History search: its title, where it was, or any of its questions and answers.
local function chatMatches(words, c)
  if UI.SearchMatch(words, c.title, c.zone) then return true end
  for _, m in ipairs(c.msgs or {}) do
    if UI.SearchMatch(words, c.title, c.zone, plain(m.text)) then return true end
  end
  return false
end

local function chatAvailable(c)
  if (c.edition or "stock") ~= ns.Lang.EditionKey() then return false end
  if not (ns.lang and ns.lang.edition) then return true end
  if not ns.Lang.ValidateEdition() then return false end
  for _, m in ipairs(c.msgs or {}) do
    local key = m.target and m.target.key or m.subject
    if key and not ns.Voice.CanPlay(key) then return false end
    -- Saved primers and inline links also reference contributed entries, beyond the primary subject.
    for _, row in ipairs(m.rows or {}) do
      if not ns.DB.entries[row.key] then return false end
    end
    for _, linked in ipairs(m.linked or {}) do
      if not ns.DB.entries[linked] then return false end
    end
    -- Older saved primers contain inline links without a separate dependency list.
    for linked in (m.text or ""):gmatch("|Haddon:LoreForever:entry::([^|]+)|h") do
      if not ns.DB.entries[linked] then return false end
    end
  end
  return true
end

function UI.RefreshHistory()
  local h = UI.historyFrame
  local store, search = historyStore(), h.search
  local shown = {}
  for i, c in ipairs(store) do
    if chatAvailable(c) and (not search:Active() or chatMatches(search.words, c)) then shown[#shown + 1] = i end
  end
  for r, b in ipairs(h.rows) do
    local i = shown[r]
    local c = i and store[i]
    if c then
      b.index = i
      b.text:SetText(WHITE .. esc(c.title) .. "|r  " .. GREY .. esc(c.zone or "") .. " - " .. ago(c.t) .. "|r")
      b:Show()
    else
      b:Hide()
    end
  end
  h.empty:SetText(#store > 0 and UI.NoMatchText(search)
    or L["No past chats yet. A chat is saved here when you start a new one."])
  h.empty:SetShown(#shown == 0)
end

function UI.ToggleHistory()
  local h = UI.historyFrame
  if h:IsShown() then return h:Hide() end
  UI.RefreshHistory()
  if UI.journeyPage then UI.journeyPage:Hide() end
  h:Show()
  UI.SeenPage("history")
  ns.Log.Use("tab", "history")   -- usage counts (LOR-435)
end

-- Reopen a past chat. The one you were in is saved first, so nothing is lost. What plays carries on (UI.Clear).
function UI.RestoreHistory(i)
  local store = historyStore()
  local c = store[i]
  if not c or not chatAvailable(c) then return end
  UI.Archive()   -- save (or update) the chat you're leaving
  UI.historyId = c.id
  UI.msgs, UI.blocks = {}, {}
  UI.UpdateListen()
  for _, m in ipairs(c.msgs) do
    UI.msgs[#UI.msgs + 1] = { role = m.role, text = m.text, target = m.target, rows = m.rows, subject = m.subject,
      linked = type(m.linked) == "table" and m.linked or nil, entry = m.entry }
    UI.blocks[#UI.blocks + 1] = m.text
  end
  UI.historyFrame:Hide()
  UI.SetNext({})
  UI.Render()
end

-- New chat: save this one to history, then clear the conversation and follow-up state. What plays carries on, with
-- its Stop on the player: it used to stop, and on stream (2026-10-04) a quest giver's words went quiet mid-sentence
-- when Mike started a new chat to look up the next quest.
function UI.Clear()
  finishTyping()
  UI.Archive()
  UI.historyId = nil
  if UI.historyFrame then UI.historyFrame:Hide() end
  if UI.journeyPage then UI.journeyPage:Hide() end
  if UI.storyPage then UI.storyPage:Hide() end
  if ns.Book then ns.Book.HidePage() end   -- a new chat shows the chat (Found's sidebar stays)
  UI.msgs, UI.blocks = {}, {}
  UI.UpdateListen()
  for _, b in ipairs(UI.bubbles) do b.frame:Hide() end
  UI.content:SetHeight(100)
  UI.engine.lastKey = nil
  UI.unanswered = nil
  UI.engine.asked = {}
  UI.SetNext({})
  UI.Refresh()
end

-- Answers ----------------------------------------------------------------------------------------------------------

-- Whether entry `key` is a quest this character has finished. Spoilers open by Engine:Opens: a quest's own once it's
-- finished, and any tagged with story beats once those are open (lore.beats; the progress tags LOR-29 asked for).
function UI.Unlocked(key)
  return UI.engine:Finished(key, ns.Context.Done())
end

-- Your journey: a grey line on an entry or answer about something you've done, from what Journey.lua recorded
-- (see Context.Journey). None when there's no record, or "Remember my journey" is off.
local function ago(t)
  local s = time() - t
  if s < 120 then return L["just now"] end
  if s < 3600 then return string.format(L["%d minutes ago"], math.floor(s / 60)) end
  if s < 7200 then return L["an hour ago"] end
  if s < 86400 then return string.format(L["%d hours ago"], math.floor(s / 3600)) end
  if s < 172800 then return L["yesterday"] end
  return string.format(L["%d days ago"], math.floor(s / 86400))
end

local function stamp(v) return type(v) == "number" and v or nil end

-- "You finished this at level 12, 3 days ago, in a group.": the quest's turn-in, if it's still in the event log.
local function questLine(key, events)
  local index = UI.engine.db.index.quest or {}
  for i = #events, 1, -1 do
    local e = events[i]
    if type(e) == "table" and e.k == "qt" and e.id and index[e.id] == key and stamp(e.t) then
      local lv = tonumber(e.lv)
      if not lv then return string.format(L["You finished this %s."], ago(e.t)) end
      return string.format(type(e.pt) == "table" and L["You finished this at level %d, %s, in a group."]
        or L["You finished this solo at level %d, %s."], lv, ago(e.t))
    end
  end
  return L["You've finished this quest."]
end

-- The people met, by entry key: {name, t} for the first name the game showed for each. Rebuilt only when someone
-- new is met, since looking up every name again on each answer adds up over a long journey.
local metCache = {}
local function metByKey(seen)
  local n = 0
  for _ in pairs(seen) do n = n + 1 end
  if metCache.seen ~= seen or metCache.n ~= n then
    local map = {}
    for name, v in pairs(seen) do
      if type(name) == "string" and stamp(v) then
        local k, how = UI.engine:KeyForName(name)
        if k and how == "exact" and not (map[k] and map[k].t <= v) then map[k] = { name = name, t = v } end
      end
    end
    metCache.seen, metCache.n, metCache.map = seen, n, map
  end
  return metCache.map
end

-- "You first met Gryan Stoutmantle at Sentinel Hill, 3 days ago.", under the name the game showed.
local function personLine(key, seen, events)
  local name = bossName(UI.engine.db.entries[key])
  local t = stamp(seen[name])
  if not t then
    local m = metByKey(seen)[key]
    if not m then return nil end
    name, t = m.name, m.t
  end
  for i = #events, 1, -1 do
    local e = events[i]
    if type(e) == "table" and e.k == "npc" and e.n == name then
      local where = (e.s ~= "" and e.s) or e.z
      if type(where) == "string" and where ~= "" then
        return string.format(L["You first met %s at %s, %s."], name, where, ago(t))
      end
      break
    end
  end
  return string.format(L["You first met %s %s."], name, ago(t))
end

-- "You first came here at level 10, 3 days ago.": when the place (the zone, or this subzone of it) was first seen,
-- with the level from that visit's new-place event while the log still has it. The oldest events get trimmed, so a
-- later new-place event in the zone isn't taken for the first visit.
local function placeLine(key, e, c, events)
  local eng, idx = UI.engine, UI.engine.db.index
  local zk = e.t == "subzone" and e.z or key:match("^zone:(.+)$")
  if not zk then return nil end
  local bare = e.t == "subzone" and ns.Engine.lower(bossName(e)):gsub("^the ", "")
  local function here(z, s)
    if type(z) ~= "string" or eng:ZoneKey(z) ~= zk then return false end
    if not bare then return true end
    if type(s) ~= "string" or s == "" then return false end
    -- The subzone the way ContextKeys finds it ("The Crossroads"; Northshire Abbey is in Northshire Valley), or by
    -- name for one that shares its name with another zone's.
    local l = ns.Engine.lower(s)
    local nl = l:gsub("^the ", "")
    return idx.name[l] == key or idx.name[nl] == key or (idx.area and idx.area[l] == key) or nl == bare
  end
  local first
  for place, v in pairs(type(c.seen) == "table" and type(c.seen.place) == "table" and c.seen.place or {}) do
    local z, s = tostring(place):match("^(.-)|(.*)$")
    if stamp(v) and (not first or v < first) and here(z, s) then first = v end
  end
  for _, ev in ipairs(events) do
    if type(ev) == "table" and ev.k == "zone" and stamp(ev.t) and here(ev.z, ev.s) then
      -- Journey.lua stamps the place and its event in the same second.
      if first and math.abs(ev.t - first) > 2 then break end
      first = ev.t
      local lv = tonumber(ev.lv)
      if lv then return string.format(L["You first came here at level %d, %s."], lv, ago(first)) end
      break
    end
  end
  return first and string.format(L["You first came here %s."], ago(first)) or nil
end

local PLACE_TYPES = { zone = true, city = true, dungeon = true, subzone = true }

-- The "you" line for entry `key` (plain text), or nil.
function UI.YouLine(key)
  local e = key and UI.engine.db.entries[key]
  local c = e and ns.Context.Journey()
  if not c then return nil end
  local events = type(c.events) == "table" and c.events or {}
  if e.t == "quest" then
    return UI.Unlocked(key) and questLine(key, events) or nil
  end
  -- "You first met / first came here" is only true when the record covers the character's whole life. A character
  -- that played before the update has a record that starts mid-life: say nothing rather than claim a first.
  local J = ns.Journey
  if not (J and J.Whole and J.Whole(c)) then return nil end
  if e.t == "npc" then
    local seen = type(c.seen) == "table" and c.seen.npc
    return type(seen) == "table" and personLine(key, seen, events) or nil
  elseif PLACE_TYPES[e.t] then
    return placeLine(key, e, c, events)
  end
end

-- The "you" line ready to go under a heading: grey, escaped, with its line break; "" when there's none.
local function youText(key)
  local ok, line = pcall(UI.YouLine, key)
  return (ok and line) and (GREY .. esc(line) .. "|r\n") or ""
end

-- Lore links ---------------------------------------------------------------------------------------------------------
-- Names of other entries inside an answer become links (Options > "Clickable names in answers"): click opens that
-- entry as if you'd asked, Shift-click adds its narration to your playlist, hovering shows its one-line summary.
-- They're found when the answer is shown (Engine:Linkify), so translated names and quest log text link too.
local LORE_LINK = "addon:LoreForever:entry::"
UI.LINK_COLOUR = T.code.link   -- every lore link (Theme.lua)

-- Which names may link: quests only once you have them (in your log, or finished), like item tooltips, and items
-- only when they belong to no quest or to one you have.
local function linkAllow()
  local db, ctx = UI.engine.db, UI.ctx or ns.Context.Snapshot()
  local done, log, logKeys = ns.Context.Done() or {}, {}, {}
  for _, q in ipairs(ctx.quests or {}) do
    if q.id then
      log[q.id] = true
      if db.index.quest[q.id] then logKeys[db.index.quest[q.id]] = true end
    end
  end
  return function(key, e)
    if e.t == "quest" then return logKeys[key] or UI.engine:Finished(key, done) end
    if e.t == "item" then
      local rec = db.index.item and db.index.item[ns.Engine.lower(e.n)]
      if not rec then return true end
      local any = false
      for _, list in ipairs({ rec.p or {}, rec.r or {}, rec.w or {} }) do
        for _, id in ipairs(list) do
          if log[id] or done[id] then return true end
          any = true
        end
      end
      return not any
    end
    return true
  end
end

-- A linker for one message about entry `key` (nil: about nothing in particular): call it on each piece of escaped
-- answer text in the default white; a name links on its first mention in the message only. Also returns the list
-- the keys it linked go into, in order (AddMessage's `linked`, for the "In this answer" line).
function UI.Linker(key)
  local linked = {}
  if settings().chatLinks == false or not UI.engine then return function(s) return s end, linked end
  local seen, allow = {}, linkAllow()
  local opts = { self = key, seen = seen, allow = allow, wrap = function(k, shown)
    linked[#linked + 1] = k
    return UI.LINK_COLOUR .. "|H" .. LORE_LINK .. k .. "|h" .. shown .. "|h|r"
  end }
  return function(s)
    -- Fail safe: whatever goes wrong while finding names, the answer still shows, just without links.
    local before = #linked
    local ok, out = pcall(UI.engine.Linkify, UI.engine, s, opts)
    if ok and type(out) == "string" then return out end
    for i = #linked, before + 1, -1 do
      seen[linked[i]] = nil
      linked[i] = nil
    end
    return s
  end, linked
end

-- The keys a message links that aren't linked in its own text (none, with links off).
function UI.OffTextLinks(m)
  local out = {}
  if not (m and m.linked) or settings().chatLinks == false then return out end
  local text = m.text or ""
  for _, k in ipairs(m.linked) do
    if not text:find("|H" .. LORE_LINK .. k .. "|h", 1, true) then out[#out + 1] = k end
  end
  return out
end

-- "In this answer: [Westfall]  [Defias Brotherhood] ...": the linked names under an answer, the first few.
local CHIPS_MAX = 8
function UI.ChipText(keys)
  local parts, entries = {}, UI.engine.db.entries
  for _, k in ipairs(keys) do
    local e = entries[k]
    if e then parts[#parts + 1] = UI.LINK_COLOUR .. "|H" .. LORE_LINK .. k .. "|h[" .. esc(e.n) .. "]|h|r" end
    if #parts >= CHIPS_MAX then break end
  end
  return GREY .. L["In this answer:"] .. "|r  " .. table.concat(parts, "  ")
end

-- "Show spoiler" on a hidden section of an entry's overview: a click shows that section (UI.ShowSection).
local REVEAL_LINK = "addon:LoreForever:reveal:"
local function revealLink(key, idx)
  return UI.LINK_COLOUR .. "|H" .. REVEAL_LINK .. idx .. ":" .. key .. "|h" .. L["Show"] .. "|h|r"
end
function UI.RevealLinkTarget(link)
  local idx, key = (type(link) == "string" and link or ""):match("^addon:LoreForever:reveal:(%d+):(.+)$")
  return key, tonumber(idx)
end

-- Willo's line under a question the add-on can't answer (LOR-459): once a play session, only without the companion
-- (Companion.SuggestWillo). In the same voice as the answers; a click opens the link to get it, naming the question.
local WILLO_LINK = "addon:LoreForever:willo"
local function willoLine()
  return "\n\n" .. UI.LINK_COLOUR .. "|H" .. WILLO_LINK .. "|h"
    .. string.format(L["Want live answers? %s, Lore Forever's free companion app, can answer this out loud."],
      ns.COMPANION_NAME) .. "|h|r"
end

-- A short answer just shown: the add-on doesn't ask Willo to read it (LOR-547 did; Mike, 10/23: "drop it actually"), so
-- it only takes the last reading she was asked for out of the sky's ring (Companion.ClearRead).
function UI.AfterAnswer(target)
  ns.Companion.ClearRead()
end

-- "Ask Willo" on a question the add-on couldn't answer (LOR-560), and /lore ask: it goes to her through the sky, and
-- the book says so (in chat, with the panel closed); when she can't hear it that way (Live game info off, another
-- language), the Ctrl+C box as before.
function UI.AskWillo(question)
  local C = ns.Companion
  if not C.SendQuestion(question) then return C.Ask(question) end
  local note = string.format(L["Asked %s."], ns.COMPANION_NAME)
  UI.AddMessage("note", GREY .. note .. "|r")
  if not (UI.frame and UI.frame:IsShown()) then DEFAULT_CHAT_FRAME:AddMessage(T.CHAT_PREFIX .. note) end
end

-- Willo's icon shows while the add-on may suggest her (Companion.OfferWillo: not once she's installed, nor with
-- Options › Suggest Willo unticked); without it, the place name has its room back.
function UI.UpdateWilloIcon()
  local icon = UI.willoIcon
  if not icon then return end
  local on = ns.Companion.OfferWillo() and true or false
  icon:SetShown(on)
  local edge = (UI.tab == nil or UI.tab == "here") and UI.historyButton or UI.optionsButton
  UI.contextLine:SetPoint("RIGHT", on and icon or edge, "LEFT", -10, 0)
end

-- What Willo's icon talks about (Companion.IconLine): the story or answer on screen ({ name = }), the question the
-- add-on just couldn't answer ({ question = }), or else where you are ({ place = }). A page over the chat (Journey,
-- History) hides what's in it, so then only the place.
function UI.WilloTopic()
  local ctx = UI.ctx
  local place = ctx and (ctx.subzone ~= "" and ctx.subzone or ctx.zone) or nil
  local over = (UI.journeyPage and UI.journeyPage:IsShown()) or (UI.historyFrame and UI.historyFrame:IsShown())
  local key = not over and UI.engine and UI.engine.lastKey
  local e = key and UI.engine.db.entries[key]
  if e and e.n then return { name = e.n } end
  if not over and UI.unanswered then return { question = UI.unanswered } end
  return { place = place ~= "" and place or nil }
end

-- The line on its own, after the red cross on an answer: same rules (Companion.SuggestWillo).
function UI.SuggestWilloLine(question)
  if ns.Companion.Installed() or not ns.Companion.SuggestWillo() then return end
  UI.AddMessage("note", (willoLine():gsub("^\n+", "")))
  UI.msgs[#UI.msgs].willo = question
end

-- heading and text are plain and get escaped; tag is already-formatted (e.g. the grey "(narrated)") and must not be.
-- `key`: the entry it's about, for the "you" line under the heading; `subject`: the entry the text isn't to link to
-- (defaults to key). Returns the text and the keys it links.
local function narratedTag() return "  " .. GREY .. L["(narrated)"] .. "|r" end
local function loreText(heading, text, angle, tag, key, subject)
  local link, linked = UI.Linker(subject or key)
  local out = heading and (GOLD .. esc(heading) .. "|r" .. (tag or "") .. "\n" .. youText(key)) or ""
  out = out .. WHITE .. link(esc(text)) .. "|r"
  if angle then
    -- "race:NightElf" -> "Night Elf"; the wording needs no article, so Alliance and Undead read right (LOR-113).
    -- Not linked: the line is already the link colour.
    local who = (angle.target:match(":(.+)$") or angle.target):gsub("(%l)(%u)", "%1 %2")
    out = out .. "\n" .. BLUE .. string.format(L["For %s players: %s"], esc(who), esc(angle.text)) .. "|r"
  end
  return out, linked
end

local function followUps(key, idx, sameEntryName)
  local items = UI.engine:FollowUps(key, idx, N_NEXT, ns.Context.Done())
  for _, it in ipairs(items) do
    if it.key == key and not sameEntryName then it.name = nil end
  end
  return items
end

-- Spoilers: an answer or section marked as giving away a story isn't shown until you ask for it. Returns true if it
-- gated (and posted a warning with a Reveal chip). Options > "Show spoilers without asking" turns this off, and a
-- quest's own spoilers open once you've finished it, and any tagged with story beats once those are open
-- (Engine:Opens).
function UI.SpoilerGate(key, kind, idx)
  if UI.SpoilerAllowed(key, kind, idx) then return false end
  local e = UI.engine.db.entries[key]
  local item = e and ((kind == "faq" and e.faq and e.faq[idx]) or (kind == "section" and e.sec and e.sec[idx]))
  local level = item and ((kind == "faq" and item.sp) or (kind == "section" and item.sp ~= 0 and item.sp))
  if not level then return false end
  UI.AddMessage("note", GREY
    .. string.format(L["Spoiler ahead: this answer reveals part of %s's story that you may not have reached yet."], esc(e.n)) .. "|r")
  local items = { { key = key, idx = idx, via = "reveal", section = kind == "section" or nil,
    label = L["Reveal it anyway (spoiler)"] } }
  -- The first time something is held back, offer "Tell me everything" once (story as you play: safe by default).
  local s = LoreForeverDB and LoreForeverDB.settings
  if s and not s.spoilerOffer then
    s.spoilerOffer = true
    items[#items + 1] = { everything = true, label = L["Tell me everything from now on"] }
  end
  for _, s in ipairs(followUps(key, nil)) do
    if #items >= N_NEXT then break end
    items[#items + 1] = s
  end
  UI.SetNext(items, L["Your call:"])
  return true
end

-- "Tell me everything from now on": the Options switch, from the chip the first held-back spoiler offers.
function UI.TellEverything()
  local s = LoreForeverDB and LoreForeverDB.settings
  if not s then return end
  s.showSpoilers = true
  UI.AddMessage("note", GREY .. L["From now on you'll see and hear the whole story. Options > Tell me everything turns this off."] .. "|r")
  UI.UpdateListen()
  UI.SetNext(followUps(UI.engine.lastKey, nil))
end

-- idx 0: every part of the story still held back (the one "Show" under a story in the conversation).
function UI.ShowSection(key, idx)
  local e = UI.engine.db.entries[key]
  local list = {}
  if idx == 0 then
    local done = ns.Context.Done()
    for i, s in ipairs(e and e.sec or {}) do
      if not UI.engine:Opens(key, s, done) then list[#list + 1] = i end
    end
  elseif e and e.sec and e.sec[idx] then
    list[1] = idx
  end
  if #list == 0 then return end
  local text, linked
  if #list == 1 then
    local sec = e.sec[list[1]]
    text, linked = loreText(e.n .. ": " .. sec.t, sec.b, nil, nil, nil, key)
  else
    local link
    link, linked = UI.Linker(key)
    local parts = { GOLD .. esc(e.n) .. "|r" }
    for _, i in ipairs(list) do
      parts[#parts + 1] = GOLD .. esc(e.sec[i].t) .. "|r\n" .. WHITE .. link(esc(e.sec[i].b)) .. "|r"
    end
    text = table.concat(parts, "\n\n")
  end
  UI.AddMessage("lore", text, nil, nil, nil, nil, key, linked)
  local m = UI.msgs[#UI.msgs]
  local shown = {}
  for _, i in ipairs(list) do shown[i] = e.sec[i].b end
  if m then m.spoiler = { key = key, kind = "section", idx = list[1], text = e.sec[list[1]].b, list = shown } end
  UI.UpdateListen()
  UI.SetNext(followUps(key, nil))
end

-- `about`: the entry the question is asked on (a page's ask line): "who is this?", "why does he want it?" mean it.
function UI.Ask(question, via, about)
  if not ns.Lang.ValidateEdition() then return end
  ns.Log.Use("ask")
  ns.Log.Asked(via)
  local ctx = UI.ctx or ns.Context.Snapshot()
  ctx.done = ns.Context.Done()   -- a quest turned in since the last snapshot counts right away
  if about then
    local c = {}
    for k, v in pairs(ctx) do c[k] = v end
    c.about, ctx = about, c
  end
  UI.turn = (UI.turn or 0) + 1
  -- Chat that isn't a question ("thanks", "that's not the right answer") never pulls a random answer.
  local chat = ns.Engine.Chatter(question)
  local results = chat and {} or UI.engine:Ask(question, ctx, 4)
  local top = results[1]
  local log = ns.Log.Question(question, ctx, results, via, UI.turn)
  UI.lastLog = log
  local live = ns.Companion.Installed()   -- live answers are offered only once the companion app is installed
  UI.unanswered = nil   -- the question Willo's icon offers her for (UI.WilloTopic)
  -- Until then, a question the add-on can't answer gets one line about Willo, once a play session (LOR-459).
  local function unanswered(text)
    UI.unanswered = question
    local willo = not live and ns.Companion.SuggestWillo()
    UI.AddMessage("note", GREY .. text .. "|r" .. (willo and willoLine() or ""), nil, nil, nil, log)
    if willo then UI.msgs[#UI.msgs].willo = question end
  end
  -- A high score on a match that leaves most of the question out (Engine:Weak), or a mechanics question the lore
  -- barely touches, is a guess: "did you mean", not an answer.
  local weak = top and top.score >= MIN_SCORE
    and (UI.engine:Weak(top) or (isGameplay(question) and (top.cover or 1) < GAMEPLAY_COVER))
  UI.AddMessage("user", WHITE .. esc(question) .. "|r")
  if chat then
    log.shown = "n"
    local items = {}
    if chat == "wrong" then
      UI.engine.lastKey = nil
      unanswered(L["Sorry, that wasn't it. Try asking another way, or pick something on the left."])
    else
      UI.AddMessage("note", GREY .. (chat == "thanks" and L["You're welcome. Ask about anything else around you."]
        or L["Ask about the places, people and quests around you, or pick something on the left."]) .. "|r",
        nil, nil, nil, log)
    end
    for _, s in ipairs(UI.engine:Suggest(ctx, N_NEXT - #items)) do items[#items + 1] = s end
    UI.SetNext(items, L["Try:"])
  elseif top and top.score >= MIN_SCORE and not weak and UI.SpoilerGate(top.key, top.kind, top.idx) then
    -- gated: SpoilerGate posted the warning and a Reveal chip (the revealed answer is logged and rated on its own)
    log.shown = "p"
  elseif top and top.score >= MIN_SCORE and not weak then
    local heading = top.name
    local note = isGameplay(question) and (GREY
      .. string.format(L["I only know the story side, not mechanics or drops. Here's the lore of %s:"], esc(top.name)) .. "|r\n")
      or ""
    -- A FAQ answer can have its own recording; any other answer stays as text.
    local target = top.kind == "faq" and UI.FaqTarget(top.key, top.idx) or nil
    local tag = (target and ns.Voice.HasAudio(target.key)) and narratedTag() or nil
    local text, linked = loreText(heading, top.text, top.angle, tag, top.key)
    UI.AddMessage("lore", note .. text, target, nil, nil, log, top.key, linked)
    if target then UI.AfterAnswer(target) end
    local items = followUps(top.key, top.kind == "faq" and top.idx or nil)
    -- A confident match can still be the wrong one (Stormwind's canals answered with the Undercity's): with the
    -- companion app installed, the last suggestion is always a way to ask Willo instead.
    if live then
      items[math.min(#items + 1, N_NEXT)] = { live = question,
        label = string.format(L["Not what you asked? Ask %s"], ns.COMPANION_NAME) }
    end
    UI.SetNext(items)
  elseif top and top.score >= GUESS_SCORE then
    -- Not sure enough to answer (a low score, or a weak match): offer the closest pre-written questions instead of a
    -- wrong answer.
    UI.engine.lastKey = nil
    log.shown = "g"
    unanswered(L["I'm not sure I have that. Did you mean one of these?"])
    -- Off script: Willo can answer it (one Ctrl+C), so that's offered first.
    local items = live and { { live = question, label = string.format(L["Ask %s instead"], ns.COMPANION_NAME) } } or {}
    for _, r in ipairs(results) do
      local e = UI.engine.db.entries[r.key]
      local fi = r.kind == "faq" and r.idx or 1
      if e.faq and e.faq[fi] then items[#items + 1] = { key = r.key, idx = fi, q = e.faq[fi].q, name = e.n } end
      if #items >= N_NEXT then break end
    end
    UI.SetNext(items, L["Did you mean:"])
  else
    UI.engine.lastKey = nil
    log.shown = "n"
    unanswered(L["I don't have lore on that yet. Try a place, person or quest nearby, or pick something on the left."])
    local items = live and { { live = question, label = string.format(L["Ask %s"], ns.COMPANION_NAME) } } or {}
    for _, s in ipairs(UI.engine:Suggest(ctx, N_NEXT - #items)) do items[#items + 1] = s end
    UI.SetNext(items, L["Try:"])
  end
  if ns.HistoryArchive then ns.HistoryArchive.Question(log, "shown") end
end

function UI.ShowFaq(key, idx, via)
  if not ns.Lang.ValidateEdition() then return end
  local e = UI.engine.db.entries[key]
  if not (e and e.faq and e.faq[idx]) then return UI.ShowEntry(key, via) end
  local f = e.faq[idx]
  UI.engine.lastKey = key
  if via ~= "reveal" and not f.answerOnly then UI.AddMessage("user", WHITE .. esc(f.q) .. "|r") end
  if via ~= "reveal" and UI.SpoilerGate(key, "faq", idx) then return end
  local target = UI.FaqTarget(key, idx)
  -- A question picked (suggested, in the sidebar, typed ahead or linked), not an answer shown for what plays
  if via ~= "reveal" and via ~= "listen" and via ~= "player" then ns.Log.Use("faq"); ns.Log.Asked(via) end
  UI.lastLog = ns.Log.Question(f.q, UI.ctx or ns.Context.Snapshot(), { { key = key, kind = "faq", idx = idx, title = f.q } }, via)
  local heading = f.answerOnly and (e.n .. ns.Lang.Dotted(" · ") .. f.q) or e.n
  local text, linked = loreText(heading, f.a, nil, ns.Voice.HasAudio(target.key) and narratedTag() or nil, key)
  UI.AddMessage("lore", text, target, nil, nil, UI.lastLog, key, linked)
  local m = UI.msgs[#UI.msgs]
  if via == "reveal" and m then m.spoiler = { key = key, kind = "faq", idx = idx, text = f.a } end
  if via ~= "listen" and via ~= "player" then UI.AfterAnswer(target) end
  UI.UpdateListen()
  UI.SetNext(followUps(key, idx))
end

-- The ways in a player opens a story by (a click on Here, a lore link, the tooltip key, the quest window's Lore button,
-- a name in chat, the target key, a suggestion, a name typed): its story card goes into the conversation, on Here, and
-- nothing covers it (Mike's pick, 10/25: "Here A"). What the playlist or the player reads aloud ("player", "listen")
-- stays where you are. A story's own page is Found's (Page.lua), one click away under the card.
UI.HERE_VIA = { hover = true, questdialog = true, questlog = true, chatlink = true, link = true, here = true,
  quest = true, typed = true, target = true, next = true }
local FOUND_LINK = "addon:LoreForever:found:"

-- The page Found has for an entry ("Its page in Found"), or nil for one it doesn't list.
local function foundLink(key)
  if not (ns.Book and ns.Book.ChapterOf(key)) then return nil end
  return UI.LINK_COLOUR .. "|H" .. FOUND_LINK .. key .. "|h" .. L["Its page in Found"] .. " \226\128\186|h|r"
end
function UI.FoundLinkTarget(link)
  return (type(link) == "string" and link or ""):match("^addon:LoreForever:found:(.+)$")
end

-- Entry overview: summary plus spoiler-free sections; its questions become the suggestions. `asked` is the
-- sidebar label that led here, shown as your side of the conversation. The parts still held back are one line with no
-- titles (a title can spoil: Design Lead, 10/25), and one Show shows them all.
function UI.ShowEntry(key, via, asked)
  if not ns.Lang.ValidateEdition() then return end
  local e = UI.engine.db.entries[key]
  if not e then return end
  if UI.HERE_VIA[via] and UI.tab ~= "here" and UI.ShowTab then UI.ShowTab("here") end
  UI.engine.lastKey = key
  local link, linked = UI.Linker(key)
  local parts = { WHITE .. link(esc(e.s)) .. "|r" }
  local all, done = settings().showSpoilers, ns.Context.Done()
  local held = 0
  for _, sec in ipairs(e.sec or {}) do
    if all or UI.engine:Opens(key, sec, done) then
      parts[#parts + 1] = GOLD .. esc(sec.t) .. "|r\n" .. WHITE .. link(esc(sec.b)) .. "|r"
    else
      held = held + 1
    end
  end
  if held > 0 then
    parts[#parts + 1] = GREY .. string.format(held == 1 and L["%d more part, held back until you reach it"]
      or L["%d more parts, held back until you reach them"], held) .. ns.Lang.Dotted(" · ") .. "|r" .. revealLink(key, 0)
  end
  parts[#parts + 1] = foundLink(key)
  if asked then UI.AddMessage("user", WHITE .. esc(asked) .. "|r") end
  local target = UI.EntryTarget(key)
  -- A quest in a storyline: where it sits, first (Storyline.Line; nothing for other quests).
  local story = e.t == "quest" and e.m and e.m.id and ns.Storyline.Line(e.m.id)
  story = story and (GOLD .. esc(story) .. "|r\n") or ""
  local text = GOLD .. esc(e.n) .. "|r\n" .. story .. youText(key) .. table.concat(parts, "\n\n")
  UI.lastLog = ns.Log.Question("[open] " .. e.n, UI.ctx or ns.Context.Snapshot(), { { key = key, kind = "summary", title = e.n } }, via)
  UI.AddMessage("lore", text, target, nil, nil, UI.lastLog, key, linked, true)
  UI.SetNext(followUps(key, nil))
end

-- Dungeon primer: what the place is, why you're here (your quests for it), and who you'll meet, in order.
function UI.ShowPrimer(zk, via)
  if not ns.Lang.ValidateEdition() then return end
  local db = UI.engine.db
  local z, e = db.zones and db.zones[zk], db.entries["zone:" .. zk]
  if not (z and e) then return end
  if UI.frame and not UI.frame:IsShown() then UI.frame:Show() end
  UI.engine.lastKey = "zone:" .. zk
  -- Links in the summary, but no "In this answer" line: it would come between "Who you'll face" and the bosses.
  local parts = { WHITE .. UI.Linker("zone:" .. zk)(esc(e.s)) .. "|r" }
  local ctx = UI.ctx or ns.Context.Snapshot()
  local mine = {}
  for _, q in ipairs(ctx.quests or {}) do
    local qk = db.index.quest[q.id]
    local qe = qk and db.entries[qk]
    if qe and qe.z == zk then mine[#mine + 1] = "- " .. esc(qe.n) .. ": " .. esc(qe.h or qe.s) end
  end
  if #mine > 0 then
    parts[#parts + 1] = GOLD .. L["Why you're here"] .. "|r\n" .. WHITE .. table.concat(mine, "\n") .. "|r"
  end
  -- Who you'll face, in order: each row opens that boss's story (with play and + when it's narrated).
  local who = {}
  for _, bk in ipairs(z.b or {}) do
    local be = db.entries[bk]
    if be then who[#who + 1] = { key = bk, name = bossName(be), hook = be.h or be.s } end
  end
  if #who > 0 then parts[#parts + 1] = GOLD .. L["Who you'll face"] .. "|r" end
  UI.AddMessage("user", WHITE .. string.format(L["Dungeon primer: %s"], esc(z.n)) .. "|r")
  local narrated = ns.Voice.HasAudio("zone:" .. zk) and narratedTag() or ""
  UI.lastLog = ns.Log.Question("[primer] " .. z.n, ctx, { { key = "zone:" .. zk, kind = "summary", title = z.n } }, via)
  UI.AddMessage("lore", GOLD .. esc(z.n) .. (z.lv and (" (" .. z.lv .. ")") or "") .. "|r" .. narrated .. "\n"
    .. youText("zone:" .. zk) .. table.concat(parts, "\n\n"), UI.EntryTarget("zone:" .. zk), nil, #who > 0 and who or nil, UI.lastLog,
    "zone:" .. zk)
  local items = {}
  -- What beating the final boss means for the story, kept behind a click since it's a spoiler.
  local last = z.b and db.entries[z.b[#z.b]]
  local lastName = last and ns.Engine.lower(last.n):gsub("%s*%b()", "")
  for i, fq in ipairs(e.faq or {}) do
    local q = ns.Engine.lower(fq.q)
    if (lastName and q:find(lastName, 1, true)) or q:find("final boss") or q:find("defeat") then
      items[1] = { key = "zone:" .. zk, idx = i, label = string.format(L["Spoiler: %s"], fq.q), via = "reveal" }
      break
    end
  end
  for _, bk in ipairs(z.b or {}) do
    local be = db.entries[bk]
    local bi = be and ns.Engine.RankedFaq(be, UI.engine.race)[1]
    if bi then items[#items + 1] = { key = bk, idx = bi, q = be.faq[bi].q, name = be.n } end
    if #items >= N_NEXT then break end
  end
  UI.SetNext(#items > 0 and items or followUps("zone:" .. zk, nil))
end

-- The quest log's description and objectives for a quest in your log, as the game shows them; nil if it isn't there.
-- The third value says the log had that quest selected while it was read, so the text is surely that quest's (a
-- client whose GetQuestLogQuestText ignores the index reads the selected one).
local function logText(id)
  local QL = _G.C_QuestLog
  if not (QL and QL.GetLogIndexForQuestID and _G.GetQuestLogQuestText) then return nil end
  local ok, idx = pcall(QL.GetLogIndexForQuestID, id)
  if not (ok and idx) then return nil end
  local selected = QL.GetSelectedQuest or function() end
  local okSel, prev = pcall(selected)
  local change = not (okSel and prev == id)
  if change and QL.SetSelectedQuest then pcall(QL.SetSelectedQuest, id) end
  UI.restoreQuest = change and okSel and prev or nil
  local okNow, now = pcall(selected)
  local ok2, d, o = pcall(GetQuestLogQuestText, idx)
  if UI.restoreQuest and QL.SetSelectedQuest then pcall(QL.SetSelectedQuest, UI.restoreQuest) end
  if ok2 then return d, o, okNow and now == id end
end

-- The quest log's selected page as something to play. Check the words it actually shows, without selecting another
-- quest or using an unchecked recording. A stale button or missing/rewritten page has nothing to play. Its Listen is
-- pressed on purpose, so it plays with Speak quest dialogue off too (Hooks' questPlayButton marks it asked).
function UI.QuestLogTarget(qid)
  local QL, V = _G.C_QuestLog, ns.Voice
  if not (qid and QL and QL.GetSelectedQuest) or V.Current() == "none" then return nil end
  local ok, selected = pcall(QL.GetSelectedQuest)
  if not (ok and selected == qid) then return nil end
  local desc, obj, sure = logText(qid)
  if not (sure and type(desc) == "string" and desc:find("%S")) then return nil end
  local clip = V.QuestClip(qid, "detail", desc)
  if not clip then return nil end
  local key = UI.engine.db.index.quest[qid]
  local e = key and UI.engine.db.entries[key]
  local title
  if QL.GetTitleForQuestID then
    local got, name = pcall(QL.GetTitleForQuestID, qid)
    if got and type(name) == "string" and name ~= "" then title = name end
  end
  title = title or (e and e.n) or string.format(L["Quest %d"], qid)
  return { id = "questlog:" .. qid .. ":detail", key = clip, label = title,
    text = title .. ". " .. desc .. " " .. (type(obj) == "string" and obj or ""), story = key }
end

-- A quest giver's recorded page of quest qid ("detail": what they say when they offer it, "complete": when you hand it
-- in; Voice.QuestClip), checked against the quest window when it shows that page, else (the offer) against the quest
-- log; a quest in neither plays the recording as it is. nil if no voice recorded it, or the words differ (a quest
-- Forever rewrote is read aloud instead, as in the quest window). peek: whether one would play, at a quick look that
-- checks no words (tooltips and the +, UI.CanQueueQuest). asked: the player pressed Listen for it (a quest's Chronicle
-- page, UI.PlayQuestDialogue), so it plays with Speak quest dialogue off too: that setting is for what plays by itself.
function UI.QuestPageClip(qid, kind, peek, asked)
  local V = ns.Voice
  if not qid or not (asked or V.QuestDialogue()) or V.Current() == "none" then return nil end
  local function got(clip)
    if clip and asked then V.askedClips[clip] = true end
    return clip
  end
  if peek then return got(V.QuestClip(qid, kind, nil, true, true)) end
  local QF = _G.QuestFrame
  if QF and QF:IsShown() and V.questKind == kind and GetQuestID and GetQuestID() == qid then
    return got(V.QuestClip(qid, kind))
  end
  if kind == "detail" then
    local desc, _, sure = logText(qid)
    if sure and type(desc) == "string" and desc:find("%S") then return got(V.QuestClip(qid, kind, desc)) end
  end
  return got(V.QuestClip(qid, kind, nil, true))
end

-- The words behind a queued quest page: the open page, checked quest-log offer, or captured page.
-- An unavailable page has no substitute lore text: its title still identifies the recording.
function UI.QuestPageText(qid, kind)
  if _G.QuestFrame and QuestFrame:IsShown() and ns.Voice.questKind == kind and GetQuestID and GetQuestID() == qid then
    return ns.Voice.QuestPageText(kind)
  end
  if kind == "detail" then
    local desc, obj, sure = logText(qid)
    if sure and type(desc) == "string" and desc ~= "" then return desc .. " " .. (obj or "") end
  end
  local q = LoreForeverDB and LoreForeverDB.quests and LoreForeverDB.quests[qid]
  local field = ({ detail = "text", progress = "progress", complete = "completion" })[kind]
  local text = q and field and q[field]
  if type(text) == "string" and ns.Voice.QuestClip(qid, kind, text, false, true) then return text end
  return ""
end

-- Whether you've handed quest qid in (the server's list, or this character's), or have its reward page open now.
local function handedIn(qid)
  local QL = _G.C_QuestLog
  if QL and QL.IsQuestFlaggedCompleted then
    local ok, done = pcall(QL.IsQuestFlaggedCompleted, qid)
    if ok and done == true then return true end
  end
  local c = ns.Journey.Char()
  for _, id in ipairs(c and type(c.completed) == "table" and c.completed or {}) do
    if id == qid then return true end
  end
  local QF = _G.QuestFrame
  return (QF and QF:IsShown() and ns.Voice.questKind == "complete" and GetQuestID and GetQuestID() == qid) or false
end

-- The quest giver's pages of quest qid the playlist plays, in order (UI.QueueQuest): the offer, then what they said
-- when you handed it in, once you have (before, it would give the end away; their "have you done it yet?" never).
-- Only the pages a voice recorded (UI.QuestPageClip; peek and asked as there).
function UI.QuestPages(qid, peek, asked)
  local out = {}
  for _, kind in ipairs({ "detail", "complete" }) do
    if (kind == "detail" or handedIn(qid)) and UI.QuestPageClip(qid, kind, peek, asked) then out[#out + 1] = kind end
  end
  return out
end

-- The quest log's own text for a quest (and remember it for the harvest, so it can become lore later).
local function questLogText(q)
  local desc, obj = logText(q.id)
  local saved = LoreForeverDB and LoreForeverDB.quests and LoreForeverDB.quests[q.id]
  desc = (desc and desc ~= "" and desc) or (saved and saved.text)
  obj = (obj and obj ~= "" and obj) or (saved and saved.objectives) or table.concat(q.objectives or {}, "\n")
  if desc and ns.Log.QuestFromLog then ns.Log.QuestFromLog(q, desc, obj) end
  return desc, obj
end

-- A quest with no written lore: what the quest itself says, and the story of where it happens.
function UI.ShowQuestText(q)
  local desc, obj
  if q.text then desc, obj = q.text, q.objectives else desc, obj = questLogText(q) end
  local ctx = UI.ctx or ns.Context.Snapshot()
  local zk = UI.engine:ZoneKey(ctx.zone)
  local ze = zk and UI.engine.db.entries["zone:" .. zk]
  local link, linked = UI.Linker(nil)
  local parts = {}
  if desc and desc ~= "" then parts[#parts + 1] = WHITE .. link(esc(desc)) .. "|r" end
  if obj and obj ~= "" then parts[#parts + 1] = GOLD .. L["Objectives"] .. "|r\n" .. WHITE .. link(esc(obj)) .. "|r" end
  if ze then
    parts[#parts + 1] = GOLD .. string.format(L["Where this happens: %s"], esc(ze.n)) .. "|r\n" .. WHITE
      .. link(esc(ze.h or ze.s)) .. "|r"
  end
  if #parts == 0 then
    parts[1] = GREY .. L["Open this quest in your quest log once so its text can be read."] .. "|r"
  end
  UI.AddMessage("user", WHITE .. esc(q.title) .. "|r")
  UI.AddMessage("lore", GOLD .. esc(q.title) .. "|r  " .. GREY .. L["(no written lore yet - the quest's own words)"]
    .. "|r\n" .. table.concat(parts, "\n\n"), nil, nil, nil, nil, nil, linked)
  local items = {}
  if ze then
    local ranked = ns.Engine.RankedFaq(ze, UI.engine.race)
    for n = 1, math.min(3, #ranked) do
      items[#items + 1] = { key = "zone:" .. zk, idx = ranked[n], q = ze.faq[ranked[n]].q }
    end
  end
  UI.SetNext(items)
end

-- Reporting an answer (LOR-120) ------------------------------------------------------------------------------------
-- The cross under an answer opens this box: why it was wrong (optional), a note (optional), and "Copy report", which
-- shows the feedback page's address with a report code in it (Log.ReportLink) to copy into a browser or Discord.
-- Everything is saved with the logged question as you go; closing the box keeps it.
local REPORT_H, REPORT_COPY_H = 300, 392

local function createReport()
  local f = T.Window("LoreForeverReport", UIParent, "Lore Forever")
  f:SetSize(400, REPORT_H)
  f:SetPoint("CENTER")
  f:SetFrameStrata("DIALOG")
  f:SetMovable(true)
  f:EnableMouse(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", f.StartMoving)
  f:SetScript("OnDragStop", f.StopMovingOrSizing)
  table.insert(UISpecialFrames, "LoreForeverReport")
  local title = f:CreateFontString(nil, "OVERLAY", T.font.heading)
  title:SetPoint("TOPLEFT", 16, -32)
  title:SetText(L["What was wrong with this answer?"])
  local asked = Muted(f:CreateFontString(nil, "OVERLAY", T.font.small))
  asked:SetPoint("TOPLEFT", 16, -52)
  asked:SetWidth(368)
  asked:SetJustifyH("LEFT")
  if asked.SetWordWrap then asked:SetWordWrap(false) end
  f.asked = asked

  local reasons = {
    { "wrong", L["It's wrong"] },
    { "unanswered", L["It didn't answer my question"] },
    { "spoiler", L["It spoiled something I haven't reached"] },
    { "future", L["It talks about later expansions"] },
    { "other", L["Something else"] },
  }

  local function save()
    if f.log then ns.Log.Feedback(f.log, false, f.reason, f.note:GetText()) end
  end
  f.checks = {}
  for i, r in ipairs(reasons) do
    local cb = CreateFrame("CheckButton", nil, f, "UICheckButtonTemplate")
    cb:SetSize(24, 24)
    cb:SetPoint("TOPLEFT", 12, -66 - (i - 1) * 26)
    local text = cb:CreateFontString(nil, "ARTWORK", T.font.body)
    text:SetPoint("LEFT", cb, "RIGHT", 4, 0)
    text:SetText(r[2])
    cb.reason = r[1]
    -- One reason at a time: ticking one clears the others; ticking it again clears it.
    cb:SetScript("OnClick", function(self)
      f.reason = self:GetChecked() and self.reason or nil
      for _, other in ipairs(f.checks) do other:SetChecked(other.reason == f.reason) end
      save()
    end)
    f.checks[i] = cb
  end

  local noteLabel = f:CreateFontString(nil, "OVERLAY", T.font.label)
  noteLabel:SetPoint("TOPLEFT", 16, -204)
  noteLabel:SetText(L["Anything to add? (optional)"])
  local note = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
  note:SetSize(360, 22)
  note:SetPoint("TOPLEFT", 22, -220)
  note:SetAutoFocus(false)
  note:SetMaxLetters(200)
  note:SetScript("OnTextChanged", function(_, userInput) if userInput then save() end end)
  note:SetScript("OnEnterPressed", function(self) self:ClearFocus() end)
  note:SetScript("OnEscapePressed", function() f:Hide() end)
  f.note = note

  local copy = PanelButton(f, "primary")
  copy:SetSize(130, 24)
  copy:SetPoint("TOPLEFT", 16, -254)
  copy:SetText(L["Copy report"])
  local done = PanelButton(f)
  done:SetSize(90, 24)
  done:SetPoint("LEFT", copy, "RIGHT", 8, 0)
  done:SetText(L["Done"])
  done:SetScript("OnClick", function() save(); f:Hide() end)
  f.copy, f.done = copy, done

  -- The address to copy. It can't be edited: typing puts it back, so a stray key never breaks the code.
  local hint = f:CreateFontString(nil, "OVERLAY", T.font.small)
  hint:SetPoint("TOPLEFT", 16, -288)
  hint:SetWidth(368)
  hint:SetJustifyH("LEFT")
  hint:SetText(L["Press Ctrl+C to copy this link, then paste it into your browser to send it, or post it on our Discord. It has your question, where you were and the answer you got, but not your character's name."])
  local link = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
  link:SetSize(360, 22)
  link:SetPoint("TOPLEFT", 22, -344)
  link:SetAutoFocus(false)
  if link.SetFontObject and _G.ChatFontNormal then link:SetFontObject(ChatFontNormal) end
  local function fill()
    link:SetText(f.link or "")
    link:SetCursorPosition(0)
    link:HighlightText()
  end
  link:SetScript("OnTextChanged", function(_, userInput) if userInput then fill() end end)
  link:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
  link:SetScript("OnEscapePressed", function() f:Hide() end)
  link:SetScript("OnShow", fill)
  f.hint, f.linkBox, f.fillLink = hint, link, fill

  copy:SetScript("OnClick", function()
    save()
    f.link = ns.Log.ReportLink(f.log)
    f:SetHeight(REPORT_COPY_H)
    hint:Show()
    link:Show()
    fill()   -- again once shown: the Forever client drops text set on a box that isn't visible yet (see Options)
    link:SetFocus()
  end)
  return f
end

function UI.ShowReport(log)
  if not log then return end
  local f = LoreForeverReport or createReport()
  UI.report = f
  f.log, f.link = log, nil
  f.reason = log.reason
  f.asked:SetText(esc(log.q or ""))
  for _, cb in ipairs(f.checks) do cb:SetChecked(cb.reason == f.reason) end
  f:SetHeight(REPORT_H)
  f.hint:Hide()
  f.linkBox:Hide()
  f:Show()
  f.note:SetText(log.note or "")
end

-- Lore links: clicks, hover and Back / Forward ----------------------------------------------------------------
-- Fixed meanings: a click opens the entry, Shift-click adds its narration to the playlist, right-click does nothing.

local LINK_PATTERN = "^" .. LORE_LINK:gsub("%p", "%%%0") .. "(.+)$"
local function linkKey(link)
  return type(link) == "string" and link:match(LINK_PATTERN) or nil
end

local LINK_KINDS = { zone = "Place", city = "Place", dungeon = "Place", subzone = "Place", npc = "Person",
  topic = "History", quest = "Quest", item = "Item" }

function UI.LoreLinkTooltip(owner, link)
  if link == WILLO_LINK then
    GameTooltip:SetOwner(owner, "ANCHOR_CURSOR")
    T.Tip(string.format(L["Get %s"], ns.COMPANION_NAME), "gold")
    T.Tip(L["Click for the link."], "tipDim", true)
    return GameTooltip:Show()
  end
  local db = UI.engine and UI.engine.db
  local rk, ri = UI.RevealLinkTarget(link)
  if rk then
    GameTooltip:SetOwner(owner, "ANCHOR_CURSOR")
    T.Tip(L["Show spoiler"], "gold")
    T.Tip(ri == 0 and L["Shows the parts of the story held back, which may give away what happens."]
      or L["Shows this part of the story, which may give away what happens."], "tipText", true)
    return GameTooltip:Show()
  end
  if UI.FoundLinkTarget(link) then
    GameTooltip:SetOwner(owner, "ANCHOR_CURSOR")
    T.Tip(L["Its page in Found"], "gold")
    T.Tip(L["Opens its page in your chronicle: when you found it, and the pages on the same road."], "tipText", true)
    return GameTooltip:Show()
  end
  local key = linkKey(link)
  local e = key and db.entries[key]
  if not e then return end
  GameTooltip:SetOwner(owner, "ANCHOR_CURSOR")
  T.Tip(e.n, "gold")
  local kind = L[LINK_KINDS[e.t] or "Lore"]
  local z = db.zones and db.zones[e.z]
  local where = z and z.n ~= e.n and z.n or nil
  T.Tip(where and (kind .. " - " .. where) or kind, "tipDim")
  T.Tip(e.h or e.s, "tipText", true)
  if ns.Voice.HasAudio(key) then T.Tip(L["Narrated"], "tipGood") end
  T.Tip(L["Click to open. Shift-click adds it to your playlist."], "tipDim", true)
  GameTooltip:Show()
end

function UI.OnLoreLink(frame, link, button)
  if button == "RightButton" then return end
  if link == WILLO_LINK then
    GameTooltip:Hide()
    return ns.Companion.ShowGetWillo(frame and frame.msg and frame.msg.willo)
  end
  local rk, ri = UI.RevealLinkTarget(link)
  if rk then
    GameTooltip:Hide()
    return UI.ShowSection(rk, ri)
  end
  local fk = UI.FoundLinkTarget(link)
  if fk then
    GameTooltip:Hide()
    return UI.OpenChronicle(fk, "here")   -- its Back comes back to the conversation, as it was
  end
  local key = linkKey(link)
  if not (key and UI.engine.db.entries[key]) then return end
  GameTooltip:Hide()
  if IsShiftKeyDown() then return UI.QueueLink(key) end
  UI.FollowLink(key, frame and frame.msg)
end

-- Shift-click: the entry's narration (or answer idx's) joins the playlist, or a note says why it can't.
function UI.QueueLink(key, idx, deferStart)
  local e = key and UI.engine.db.entries[key]
  if not e then return end
  local label = idx and e.faq and e.faq[idx] and e.faq[idx].q or e.n
  if UI.PlaylistIndex(idx and (faqID(key, idx)) or key) then
    return note(string.format(L["%s is already in your playlist."], esc(label)))
  end
  if not UI.PlaylistAdd(key, idx, nil, deferStart) then note(string.format(L["%s isn't narrated yet."], esc(label))) end
end

-- A lore link followed: its story card goes into the conversation as if you'd asked. There's no Back and Forward: the
-- conversation is the history, and what came before is just above (Here A, 10/25). `from`: the message it was in.
function UI.FollowLink(key, from)
  local e = UI.engine.db.entries[key]
  if not e then return end
  UI.ShowEntry(key, "link", UI.TellMeAbout(e))
end

-- Where the conversation starts: `top` (default -64, under the header).
-- The panel's ask row: the message box, its field and Send. A story's page has its own ask line, so while one is open
-- (UI.pageOpen, set and cleared by Page.lua) the row stays hidden, whatever re-flows the chat: PlaceChat and Layout call
-- this last.
function UI.ShowAskRow()
  local on = not UI.pageOpen
  for _, w in ipairs({ UI.msgBar, UI.input, UI.sendButton }) do
    if w then w:SetShown(on) end
  end
end

function UI.PlaceChat(top)
  if not UI.scroll then return end
  UI.chatTop = top or UI.chatTop or -64
  UI.scroll:ClearAllPoints()
  UI.scroll:SetPoint("TOPLEFT", UI.frame, "TOPLEFT", CHAT_X, UI.chatTop)
  UI.scroll:SetPoint("BOTTOMRIGHT", UI.frame, "BOTTOMRIGHT", -34 - SHIFT_R, 128 + FOOT)
  -- The message box starts where the conversation does.
  local f = UI.frame
  if UI.msgBar then
    UI.msgBar:ClearAllPoints()
    UI.msgBar:SetPoint("BOTTOMLEFT", f, "BOTTOMLEFT", CHAT_X - 4, 10 + FOOT)
    UI.msgBar:SetPoint("TOPRIGHT", f, "BOTTOMRIGHT", -BOOK_R, 44 + FOOT)
  end
  if UI.input then
    UI.input:ClearAllPoints()
    UI.input:SetPoint("BOTTOMLEFT", f, "BOTTOMLEFT", CHAT_X + 8, 16 + FOOT)
    UI.input:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -96 - SHIFT_R, 16 + FOOT)
  end
  if UI.sendButton then
    UI.sendButton:ClearAllPoints()
    UI.sendButton:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -30 - SHIFT_R, 16 + FOOT)
  end
  UI.ShowAskRow()
  UI.PlaceNext()
end
