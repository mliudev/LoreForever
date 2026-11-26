-- Settings page (Esc > Options > AddOns > Lore Forever), with the same toggles as the /lore commands.

local _, ns = ...
local Options = {}
ns.Options = Options

Options.DEFAULTS = {
  zoneNudge = true,        -- chat hint with a clickable question when entering a zone that has lore
  dungeonPrimer = true,    -- chat link to the dungeon primer when entering a dungeon
  unitTooltips = true,     -- one-line lore on NPC and mob tooltips
  itemTooltips = true,     -- quest notes on item tooltips
  storylines = true,       -- say a quest is part of a storyline, under its title and on its entry (Storyline.lua)
  storylineChat = true,    -- turning in a storyline quest names who gives the next one (Storyline.NextPart)
  recaps = true,           -- a storyline's recap at its turning points (Storyline.OnRecap; lore.recaps)
  floatPlayer = true,      -- the narration player floats on screen while the panel is closed (UI.UpdateNowPlaying)
  -- The words of the narration playing, on screen in step with the voice while the panel is closed (Subtitles.lua,
  -- LOR-344); subtitleScale is Subtitle size (Subtitles.SCALES), subtitlePos where it was Shift-dragged to.
  subtitles = true,
  subtitleScale = 1,
  reportCross = true,      -- a cross on the narration player that reports the recording (ClipReport.lua, LOR-232);
                           -- the player's right-click menu offers it either way (turned on once for older installs:
                           -- Log.Init's featuresOn)
  pageSlip = true,         -- a note at the top of the screen when you find a new page (Slip.lua)
  minimap = true,          -- minimap button (turned on once for installs from before it was the default: Log.Init)
  -- The Lore button on the quest giver's window (Hooks.lua). Shift-drag moves it; where to is questButtonPos, which
  -- Options › Reset quest button forgets (Hooks.ResetQuestButton).
  questButton = true,
  typing = true,           -- answers type in quickly instead of appearing at once
  chatLinks = true,        -- names of other entries in answers are links (UI.Linker), Back / Forward above the chat
  showSpoilers = false,    -- "Tell me everything": spoilers show without waiting for your quests (story beats)
  spoilerOffer = false,    -- "Tell me everything" was offered once, the first time a spoiler was held back
  -- (No "Read aloud": only recordings play, never the game's text-to-speech. Log.Init forgets the old setting.)
  narrateFlights = false,  -- play each zone's recorded story on taxi flights (Voice.OnTaxiCheck)
  onDemand = false,        -- "Narration: only when I press Play" (LOR-138): nothing plays by itself (Voice.OnDemand)
  autoZone = true,         -- play a zone's or place's recorded narration on arriving there (Voice.OnArrive)
  -- Quest voices as a quest window opens (Voice.QuestDialogue), on since LOR-1408 (Mike, 11/10: "I want to default to
  -- quest giver voices"); older installs are switched on once (Voice.SwitchQuestVoicesOnce).
  questDialogue = true,
  questObjectives = true,  -- narrate quest objectives right after the quest text (Voice.QuestObjectives)
  -- A book, letter or plaque page's recording as it opens (Voice.ReadBookPage). Options has no switch for it; another
  -- add-on that reads books turns it off (Voice.CheckSpoken, Voice.CheckQuestVoices).
  readBooks = true,
  skipHeard = true,        -- don't play automatically what this character has heard (LoreForeverDB.heard)
  playInCombat = false,    -- keep Lore Forever narration playing and advancing through combat (LOR-1652)
  packHints = true,        -- say (once a session per zone, or per quest download) when its narration is in a pack you lack
  voiceOffers = true,      -- the dimmed play button where a free download has that voice (VoiceOffer.lua)
  tips = true,             -- one tip at login about a feature (Core.lua loginTip), until they run out
  updateNotice = true,     -- say once when a newer Lore Forever is out, and on the minimap button (Updates.lua)
  journey = true,          -- "Remember my journey": record places, people, quests and foes for Journey
  pictureHideUI = true,    -- the journey picture key hides the interface for its picture, out of combat (Journey.lua)
  -- Pictures at milestones (Journey.MilestonePicture): a level, a boss, a first zone or dungeon, with the companion's
  -- picture book on. Never in combat or on a flight, ten a day at most.
  automaticPictures = true,
  capture = true,          -- keep the quest, gossip and book text Forever shows, to share at /contribute (Capture.lua)
  -- Live game info: Willo's sky, star rings over the minimap that the companion app reads (Strip.lua, Sky.lua,
  -- LOR-416). Opt-in: on only after an explained yes, in Willo (her liveGame: one switch for both apps, LOR-544) or
  -- with /lore live, which says what it is; a choice made here (liveStripChosen) wins over hers (Strip.On). It shows
  -- only when it's needed, unless liveStripAlways (Strip.Showing).
  liveStrip = false,
  liveStripAlways = false,
  -- The small Contribute button on quest, gossip and book windows (Capture.lua). Defaults are written into
  -- SavedVariables, so older installs (saved off) are turned on once by Log.Init's featuresOn.
  contributeButtons = true,
  -- "Suggest Willo": until the companion app is installed, her icon by Journey (LOR-601) and one line about her when
  -- the add-on has no answer, once a play session (Companion.SuggestWillo, LOR-459).
  getWillo = true,
  -- "Show who can answer you" (TalkMark.lua, LOR-910): the mark by your target, and the tooltip line, on a character
  -- who'd answer you out loud with Willo's key for them. talkMarkWords counts the targets that showed its words.
  talkMark = true,
  language = "auto",     -- "auto" (the game client's language), "enUS" or a language pack's locale
  -- Narration voices: voiceOrder (pack add-on names, "auto" = the default pack) and voiceOff (unticked ones) are
  -- set up by Voice.lua, which also moves the old one-voice setting (voicePack) into them.
  voiceGroup = "story",    -- keep one voice per "story" (a story and its questions), per "zone", or pick per "line"
  voiceMatchRace = false,  -- prefer voices that suit the race of the lore (orc lore in an orc voice)
  voiceMatchGender = true, -- quest dialogue: the quest givers' race and gender voices (Voice.QuestClip)
  -- A narrator of the other gender fills in for a story the player's own hasn't recorded (Mike, 11/1: the other
  -- narrator beats silence; turned on once for older installs: Log.Init's fillGenderOn). Never a narrator in another
  -- language: a story's voice and its text are the same language and words (Mike, 11/14; an older save's
  -- voiceFillLanguage is ignored).
  voiceFillGender = true,
  -- The game's sound channel recordings play on (Play voices on, LOR-315): Dialog, SFX, Music, Ambience or Master.
  -- Voice volume is that channel's own volume in the game's settings, which Lore Forever never keeps a copy of.
  voiceChannel = "Dialog",
  panelScale = 1,          -- Panel size: 0.9, 1, 1.15 or 1.3 (UI.SCALES); scales the whole panel
}

local L = ns.L
local T = ns.Theme

local VOICES_URL = "loreforeverwow.com/downloads"
local LANGUAGES_URL = "loreforeverwow.com/translate"

-- Session-only tab memory: Audio opens on first entry; reopening Settings in the same play session returns to the
-- last tab. Never stored in LoreForeverDB so opening/switching tabs causes zero SavedVariables mutation.
Options.TABS = { "audio", "packs", "screen", "keys", "willo", "general" }
Options.activeTab = Options.activeTab or "audio"

local PALETTE = {
  headerTop = { 0.161, 0.125, 0.086, 0.96 },
  headerBot = { 0.098, 0.078, 0.067, 0.96 },
  tabBar = { 0.110, 0.086, 0.067, 0.96 },
  tabActive = { 0.941, 0.804, 0.502, 0.08 },
  tabHover = { 1, 1, 1, 0.05 },
  rule = { 0.286, 0.231, 0.176, 1 },
  ruleSoft = { 0.212, 0.173, 0.141, 1 },
  bookBg = { 0.208, 0.153, 0.086, 1 },
  bookRim = { 0.459, 0.341, 0.192, 1 },
  kbdBg = { 0.063, 0.055, 0.047, 1 },
  kbdRim = { 0.365, 0.294, 0.227, 1 },
  text = { 0.980, 0.941, 0.875, 1 },
  sub = { 0.831, 0.776, 0.710, 1 },
  tones = {
    teal = { bg = { 0.141, 0.176, 0.153, 1 }, rim = { 0.282, 0.341, 0.290, 1 }, accent = { 0.569, 0.780, 0.702, 1 } },
    warm = { bg = { 0.196, 0.153, 0.106, 1 }, rim = { 0.475, 0.369, 0.235, 1 }, accent = { 0.941, 0.804, 0.502, 1 } },
    neutral = { bg = { 0.125, 0.102, 0.082, 1 }, rim = { 0.286, 0.231, 0.176, 1 }, accent = { 0.286, 0.231, 0.176, 1 } },
  },
}

local function fillColor(tex, c)
  if tex.SetColorTexture then tex:SetColorTexture(c[1], c[2], c[3], c[4] or 1)
  else tex:SetTexture(c[1], c[2], c[3], c[4] or 1) end
  return tex
end

local function makeBorder(frame, c, thick)
  thick = thick or 1
  local lines = {}
  for i = 1, 4 do lines[i] = fillColor(frame:CreateTexture(nil, "BORDER"), c) end
  local top, bot, left, right = lines[1], lines[2], lines[3], lines[4]
  top:SetPoint("TOPLEFT"); top:SetPoint("TOPRIGHT"); top:SetHeight(thick)
  bot:SetPoint("BOTTOMLEFT"); bot:SetPoint("BOTTOMRIGHT"); bot:SetHeight(thick)
  left:SetPoint("TOPLEFT"); left:SetPoint("BOTTOMLEFT"); left:SetWidth(thick)
  right:SetPoint("TOPRIGHT"); right:SetPoint("BOTTOMRIGHT"); right:SetWidth(thick)
  return lines
end

local function setBorderColor(lines, c)
  for _, t in ipairs(lines or {}) do fillColor(t, c) end
end

local function strHeight(fs, fallback)
  local h = fs and fs.GetStringHeight and tonumber(fs:GetStringHeight())
  if h and h > 0 then return h end
  return fallback or 14
end

local function strWidth(fs, fallback)
  local w = T.TextWidth and T.TextWidth(fs) or (fs and fs.GetStringWidth and tonumber(fs:GetStringWidth()))
  if w and w > 0 then return w end
  return fallback or 80
end

local function wrapRegion(fs)
  if fs and fs.SetJustifyH then fs:SetJustifyH("LEFT") end
  if fs and fs.SetWordWrap then fs:SetWordWrap(true) end
  return fs
end

-- Size a button to its label (German and other languages run longer than the English the sizes were picked for).
local function fit(btn, min)
  local fs = btn.GetFontString and btn:GetFontString()
  local w = fs and (T.TextWidth and T.TextWidth(fs) or (fs.GetStringWidth and fs:GetStringWidth()))
  if type(w) == "number" and w > 0 then btn:SetWidth(math.max(min or 0, w + 28)) end
end

local function themedButton(parent, label, kind)
  if T and T.Button then return T.Button(parent, label, kind) end
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  if label then b:SetText(label) end
  return b
end

local function setTip(widget, title, body)
  if not (widget and body and body ~= "") then return end
  widget:HookScript("OnEnter", function(self)
    if not _G.GameTooltip then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(title)
    T.Tip(body, "tipText", true)
    GameTooltip:Show()
  end)
  widget:HookScript("OnLeave", function()
    if _G.GameTooltip then GameTooltip:Hide() end
  end)
end

-- Localize reworded UI strings safely: packs that haven't translated the concise wording keep their existing
-- translated string instead of mixing English.
local function tr(new, ...)
  if ns.Lang and ns.Lang.Reworded then
    local old = ns.Lang.Reworded(new, ...)
    if old then return old end
  end
  return L[new]
end

local function englishOf(label)
  for en, val in pairs(L) do
    if val == label then return en end
  end
  return label
end

-- A drop-down: a button showing the current choice with an arrow, and a list that opens under it. Built from plain
-- frames (no UIDropDownMenu), so it doesn't depend on which menu API the client has; the list sits on UIParent, not
-- inside the scroll frame, so the scroll frame can't clip it. Open it with items {value, label, note, why}; items
-- with a `why` can't be chosen and show it greyed.
local ROW = 22
local openLists = {}
local function closeAllLists(except)
  for _, list in ipairs(openLists) do
    if list ~= except and list.IsShown and list:IsShown() then list:Hide() end
  end
end

local function dropDown(name, parent, width)
  local btn = CreateFrame("Button", name, parent, "UIPanelButtonTemplate")
  btn:SetSize(width, 24)
  if T and T.SkinButton then T.SkinButton(btn) end
  local fs = btn.GetFontString and btn:GetFontString()
  if fs then
    fs:ClearAllPoints()
    fs:SetPoint("LEFT", 10, 0)
    fs:SetPoint("RIGHT", -24, 0)
    fs:SetJustifyH("LEFT")
  end
  local arrow = btn:CreateTexture(nil, "OVERLAY")
  arrow:SetTexture("Interface\\ChatFrame\\UI-ChatIcon-ScrollDown-Up")
  arrow:SetSize(18, 18)
  arrow:SetPoint("RIGHT", -4, 0)

  local list = CreateFrame("Frame", name .. "List", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  list:SetPoint("TOPLEFT", btn, "BOTTOMLEFT", 0, -2)
  list:SetFrameStrata("FULLSCREEN_DIALOG")
  list:SetClampedToScreen(true)
  local bg = list:CreateTexture(nil, "BACKGROUND")
  bg:SetAllPoints()
  if bg.SetColorTexture then bg:SetColorTexture(T.rgba(T.color.popup)) else bg:SetTexture(T.rgba(T.color.popup)) end
  if list.SetBackdrop then
    list:SetBackdrop({ edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 12,
      insets = { left = 3, right = 3, top = 3, bottom = 3 } })
    if list.SetBackdropBorderColor then list:SetBackdropBorderColor(T.rgba(T.color.rim)) end
  end
  list:EnableMouse(true)
  list:Hide()
  list.rows = {}
  openLists[#openLists + 1] = list
  function list.Open(items, current, onChoose)
    closeAllLists(list)
    for i, ch in ipairs(items) do
      local r = list.rows[i]
      if not r then
        r = CreateFrame("Button", nil, list)
        r:SetHeight(ROW)
        r:SetPoint("TOPLEFT", 6, -6 - (i - 1) * ROW)
        r:SetPoint("TOPRIGHT", -6, -6 - (i - 1) * ROW)
        r:SetHighlightTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight", "ADD")
        r.text = r:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
        r.text:SetPoint("LEFT", 6, 0)
        r.text:SetPoint("RIGHT", -6, 0)
        r.text:SetJustifyH("LEFT")
        r:SetScript("OnClick", function(self)
          if not self.choice.why then list:Hide(); list.onChoose(self.choice) end
        end)
        list.rows[i] = r
      end
      r.choice = ch
      local mark = ch.value == current and T.code.gold .. "> |r" or "   "
      local extra = (ch.why or ch.note) and (T.code.faint .. " - " .. (ch.why or ch.note) .. "|r") or ""
      r.text:SetText(mark .. (ch.why and (T.code.faint .. ch.label .. "|r") or ch.label) .. extra)
      r:Show()
    end
    for i = #items + 1, #list.rows do list.rows[i]:Hide() end
    list.onChoose = onChoose
    list:SetSize(math.max(btn:GetWidth() or width, 240), #items * ROW + 12)
    list:Show()
  end
  function list.Toggle(items, current, onChoose)
    if list:IsShown() then list:Hide() else list.Open(items, current, onChoose) end
  end
  btn:SetScript("OnHide", function() list:Hide() end)
  return btn, list
end

local function makeHeading(parent, text)
  local h = parent:CreateFontString(nil, "ARTWORK", T and T.font and T.font.heading or "GameFontNormal")
  h:SetTextColor(T.rgba(T.color.gold))
  wrapRegion(h)
  h:SetText(text)
  return h
end

local function makeNote(parent, text, font, color)
  local n = parent:CreateFontString(nil, "ARTWORK", font or "GameFontHighlightSmall")
  n:SetTextColor(T.rgba(color or T.color.muted))
  wrapRegion(n)
  n:SetText(text or "")
  return n
end

local function makeStatusCard(parent)
  local card = CreateFrame("Frame", nil, parent)
  card.bg = fillColor(card:CreateTexture(nil, "BACKGROUND"), PALETTE.tones.neutral.bg)
  card.bg:SetAllPoints()
  card.border = makeBorder(card, PALETTE.tones.neutral.rim, 1)
  card.accent = fillColor(card:CreateTexture(nil, "ARTWORK"), PALETTE.tones.neutral.accent)
  card.accent:SetPoint("TOPLEFT", 1, -1)
  card.accent:SetPoint("BOTTOMLEFT", 1, 1)
  card.accent:SetWidth(3)
  card.title = card:CreateFontString(nil, "ARTWORK", "GameFontNormal")
  card.title:SetTextColor(T.rgba(PALETTE.text))
  wrapRegion(card.title)
  card.title:SetPoint("TOPLEFT", 12, -9)
  card.title:SetPoint("RIGHT", card, "RIGHT", -10, 0)
  card.copy = card:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  card.copy:SetTextColor(T.rgba(PALETTE.sub))
  wrapRegion(card.copy)
  card.copy:SetPoint("TOPLEFT", card.title, "BOTTOMLEFT", 0, -4)
  card.copy:SetPoint("RIGHT", card, "RIGHT", -10, 0)
  function card.SetState(tone, titleText, copyText)
    local t = PALETTE.tones[tone] or PALETTE.tones.neutral
    fillColor(card.bg, t.bg)
    setBorderColor(card.border, t.rim)
    fillColor(card.accent, t.accent)
    card.title:SetText(titleText or "")
    card.copy:SetText(copyText or "")
    card.copy:SetShown(copyText ~= nil and copyText ~= "")
  end
  function card.Layout(w)
    local inner = math.max(120, w - 22)
    card.title:SetWidth(inner)
    local th = strHeight(card.title, 16)
    local ch = 0
    if card.copy:IsShown() then
      card.copy:SetWidth(inner)
      ch = strHeight(card.copy, 14) + 4
    end
    local h = math.max(36, 18 + th + ch)
    card:SetSize(w, h)
    return h
  end
  return card
end

-- Native WoW radio button built on CheckButton + UI-RadioButton so it works across 1.12, Classic, and Modern.
local function makeRadio(parent, label)
  local rb = CreateFrame("CheckButton", nil, parent)
  rb:SetSize(20, 20)
  rb:SetNormalTexture("Interface\\Buttons\\UI-RadioButton")
  local norm = rb.GetNormalTexture and rb:GetNormalTexture()
  if norm and norm.SetTexCoord then norm:SetTexCoord(0, 0.25, 0, 1) end
  rb:SetCheckedTexture("Interface\\Buttons\\UI-RadioButton")
  local chk = rb.GetCheckedTexture and rb:GetCheckedTexture()
  if chk and chk.SetTexCoord then chk:SetTexCoord(0.25, 0.5, 0, 1) end
  rb:SetHighlightTexture("Interface\\Buttons\\UI-RadioButton", "ADD")
  local hi = rb.GetHighlightTexture and rb:GetHighlightTexture()
  if hi and hi.SetTexCoord then hi:SetTexCoord(0.5, 0.75, 0, 1) end
  local text = rb:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  wrapRegion(text)
  text:SetPoint("LEFT", rb, "RIGHT", 4, 0)
  text:SetText(label)
  rb.label = text
  return rb
end

-- Selectable read-only URL row; refills on show for Forever client EditBox quirks.
local function urlRow(parent, label, address)
  local row = CreateFrame("Frame", nil, parent)
  local text = row:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  text:SetTextColor(T.rgba(T.color.muted))
  wrapRegion(text)
  text:SetPoint("TOPLEFT", 0, -3)
  text:SetText(label)
  local url = CreateFrame("EditBox", nil, row, "InputBoxTemplate")
  url:SetSize(210, 20)
  url:SetAutoFocus(false)
  if url.SetFontObject and _G.ChatFontNormal then url:SetFontObject(ChatFontNormal) end
  url:SetTextColor(T.rgba(T.color.url))
  local function fill()
    url:SetText(address)
    url:SetCursorPosition(0)
  end
  fill()
  url:SetScript("OnTextChanged", function(self) if self:GetText() ~= address then self:SetText(address) end end)
  url:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
  url:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  url:HookScript("OnShow", fill)
  url:HookScript("OnEditFocusLost", function(self) self:HighlightText(0, 0); fill() end)
  row.label, row.url, row.fill = text, url, fill
  function row.Layout(w)
    local lw = strWidth(text, 100)
    url:ClearAllPoints()
    if lw + 12 + 190 <= w then
      text:SetWidth(lw + 4)
      url:SetPoint("LEFT", text, "RIGHT", 10, 0)
      url:SetWidth(math.max(150, math.min(230, w - lw - 14)))
      row:SetSize(w, math.max(24, strHeight(text, 14) + 6))
      return math.max(24, strHeight(text, 14) + 6)
    else
      text:SetWidth(w)
      local th = strHeight(text, 14)
      url:SetPoint("TOPLEFT", text, "BOTTOMLEFT", 4, -4)
      url:SetWidth(math.max(150, math.min(240, w - 8)))
      local h = th + 28
      row:SetSize(w, h)
      return h
    end
  end
  return row
end

-- Checkbutton row with label, optional inline blocked/help reason (only shown when set), and hover/focus tooltip.
local function makeCheckRow(parent, key, label, tip, english, onClick)
  local row = CreateFrame("Frame", nil, parent)
  local cb = CreateFrame("CheckButton", nil, row, "UICheckButtonTemplate")
  cb:SetPoint("TOPLEFT", -4, 0)
  local text = type(cb.Text) == "table" and cb.Text or nil
  if not text then
    text = cb:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    text:SetPoint("LEFT", cb, "RIGHT", 4, 0)
  else
    text:ClearAllPoints()
    text:SetPoint("LEFT", cb, "RIGHT", 4, 0)
  end
  wrapRegion(text)
  text:SetText(label)
  cb.label = text
  cb.color = { text:GetTextColor() }
  cb.newTag = ns.WhatsNew and ns.WhatsNew.Tag and ns.WhatsNew.Tag(row, text, "LEFT", "RIGHT", 6, 0) or nil
  cb.english = english or englishOf(label)
  cb.key = key
  cb.tip = tip

  local desc = row:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  desc:SetTextColor(T.rgba(T.color.muted))
  wrapRegion(desc)
  desc:SetPoint("TOPLEFT", cb, "BOTTOMLEFT", 30, 2)
  desc:Hide()
  cb.desc = desc
  cb.row = row

  setTip(cb, label, tip)
  cb:SetScript("OnClick", function(self)
    if self.IsEnabled and not self:IsEnabled() then
      self:SetChecked(LoreForeverDB.settings[key] and true or false)
      return
    end
    LoreForeverDB.settings[key] = self:GetChecked() and true or false
    if onClick then onClick(self) end
  end)

  function row.SetBlocked(why, persistNote)
    local disabled = why ~= nil and why ~= ""
    cb:SetEnabled(not disabled)
    if disabled then
      cb.label:SetTextColor(T.rgba(T.color.faint))
    else
      cb.label:SetTextColor(unpack(cb.color))
    end
    local shownText = (disabled and why) or persistNote
    if shownText and shownText ~= "" then
      desc:SetText(shownText)
      desc:Show()
    else
      desc:SetText("")
      desc:Hide()
    end
  end

  function row.Layout(w)
    local tagW = (cb.newTag and cb.newTag:IsShown()) and 34 or 0
    local textW = math.max(100, w - 32 - tagW)
    text:SetWidth(textW)
    local topH = math.max(26, strHeight(text, 16) + 6)
    local descH = 0
    if desc:IsShown() then
      local dw = math.max(100, w - 30)
      desc:SetWidth(dw)
      descH = strHeight(desc, 13) + 4
    end
    local h = topH + descH
    row:SetSize(w, h)
    return h
  end

  return row, cb
end

-- Volume + sound channel block (shared API surface kept intact for SelfTest and OnCVarUpdate/OnPreviewChanged).
local function buildVolumeControls(parent, onPreviewMsg)
  local row = {}
  local head = makeHeading(parent, L["Volume"])
  local sliderRow = CreateFrame("Frame", nil, parent)
  local slider = CreateFrame("Slider", "LoreForeverVoiceVolume", sliderRow, T.BACKDROP_TEMPLATE)
  slider:SetOrientation("HORIZONTAL")
  slider:SetSize(160, 17)
  slider:SetPoint("LEFT", 0, 0)
  slider:SetHitRectInsets(0, 0, -4, -4)
  if slider.SetBackdrop then
    slider:SetBackdrop({ bgFile = "Interface\\Buttons\\UI-SliderBar-Background",
      edgeFile = "Interface\\Buttons\\UI-SliderBar-Border", tile = true, tileSize = 8, edgeSize = 8,
      insets = { left = 3, right = 3, top = 6, bottom = 6 } })
  end
  slider:SetThumbTexture("Interface\\Buttons\\UI-SliderBar-Button-Horizontal")
  local thumb = slider.GetThumbTexture and slider:GetThumbTexture()
  if thumb and thumb.SetSize then thumb:SetSize(32, 32) end
  slider:SetMinMaxValues(0, 100)
  slider:SetValueStep(1)
  if slider.SetObeyStepOnDrag then slider:SetObeyStepOnDrag(true) end

  local sampleBtn = themedButton(sliderRow, L["Sample"])
  sampleBtn:SetSize(74, 24)
  fit(sampleBtn, 70)
  sampleBtn:SetPoint("RIGHT", 0, 0)

  local value = sliderRow:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  value:SetPoint("RIGHT", sampleBtn, "LEFT", -10, 0)
  value:SetJustifyH("RIGHT")

  local label = parent:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
  label:SetText(L["Narration and game voices"])
  label:Hide()   -- (kept for WhatsNew / SelfTest references)

  local chanRow = CreateFrame("Frame", nil, parent)
  local pick = chanRow:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  wrapRegion(pick)
  pick:SetPoint("LEFT", 0, 0)
  pick:SetText(tr("Sound channel", "Play voices on"))
  local channel, channelList = dropDown("LoreForeverVoiceChannel", chanRow, 150)
  channel:SetPoint("RIGHT", 0, 0)
  setTip(channel, L["Play voices on"],
    L["Which of the game's sound channels the narrators and quest dialogue play on. Narration and game voices below is that channel's volume."])

  local noteFs = makeNote(parent, "")

  local function about()
    local V = ns.Voice
    local key = V.ChannelChoice()
    if V.SoundOff() == "channel" then
      return T.code.warn .. string.format(L["The game's %s option is off (System > Sound), so Lore Forever's voices play at your Master volume. Turn it on to use this slider."],
        V.ChannelName(key, true)) .. "|r"
    elseif key == "SFX" then
      return L["How loud the narrators and quest dialogue are. It's the game's own Effects volume, so the game's sound effects follow it too."]
    elseif key == "Music" then
      return L["How loud the narrators and quest dialogue are. It's the game's own Music volume: the game's music plays on it too."]
    elseif key == "Ambience" then
      return L["How loud the narrators and quest dialogue are. It's the game's own Ambience volume: the game's ambient sounds play on it too."]
    elseif key == "Master" then
      return L["How loud the narrators and quest dialogue are. It's the game's Master volume, so every game sound follows it too."]
    end
    return L["How loud the narrators and quest dialogue are. It's the game's own Dialog volume, so NPC voices follow it too."]
  end

  local syncing = false
  function row.Sync()
    local V = ns.Voice
    channel:SetText(V.ChannelName(V.ChannelChoice()))
    local pct = V.Volume()
    syncing = true
    slider:SetValue(pct)
    syncing = false
    value:SetText(string.format("%d%%", pct))
    local off = V.SoundOff() == "channel"
    if off then
      noteFs:SetText(about())
      noteFs:Show()
    else
      noteFs:SetText("")
      noteFs:Hide()
    end
    sampleBtn:SetText(V.previewing and L["Stop"] or L["Sample"])
    fit(sampleBtn, 70)
  end

  channel:SetScript("OnClick", function()
    local items = {}
    for _, key in ipairs(ns.Voice.CHANNELS) do items[#items + 1] = { value = key, label = ns.Voice.ChannelName(key) } end
    channelList.Toggle(items, ns.Voice.ChannelChoice(), function(ch)
      LoreForeverDB.settings.voiceChannel = ch.value
      row.Sync()
      if row.onLayout then row.onLayout() end
    end)
  end)

  local function hear()
    local V, UI = ns.Voice, ns.UI
    if V.previewing or V.SoundOff() then return end
    if UI and ((UI.IsBusy and UI.IsBusy()) or (UI.pl and UI.pl.state == "waiting")) then return end
    V.Preview(V.Current())
  end

  slider:SetScript("OnValueChanged", function(_, v)
    local pct = math.max(0, math.min(100, math.floor((tonumber(v) or 0) + 0.5)))
    value:SetText(string.format("%d%%", pct))
    if syncing or pct == ns.Voice.Volume() then return end
    if not ns.Voice.SetVolume(pct) then return row.Sync() end
    hear()
  end)
  slider:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Narration and game voices"])
    T.Tip(about(), "tipText", true)
    GameTooltip:Show()
  end)
  slider:SetScript("OnLeave", function() GameTooltip:Hide() end)

  sampleBtn:SetScript("OnClick", function()
    if ns.Voice.previewing then
      ns.Voice.StopPreview()
      return
    end
    local ok, why = ns.Voice.Preview(ns.Voice.Current())
    if not ok and onPreviewMsg then onPreviewMsg(why) end
  end)

  function row.Layout(w)
    local sw = math.max(80, w - (sampleBtn:GetWidth() or 74) - 52)
    slider:SetWidth(sw)
    sliderRow:SetSize(w, 28)

    local cw = math.max(120, math.min(165, math.floor(w * 0.48)))
    channel:SetWidth(cw)
    pick:ClearAllPoints()
    channel:ClearAllPoints()
    local pw = strWidth(pick, 90)
    local chanH
    if pw + 12 + cw <= w then
      pick:SetPoint("LEFT", 0, 0)
      pick:SetWidth(w - cw - 10)
      channel:SetPoint("RIGHT", 0, 0)
      chanH = math.max(28, strHeight(pick, 14) + 8)
    else
      pick:SetPoint("TOPLEFT", 0, 0)
      pick:SetWidth(w)
      channel:SetPoint("TOPLEFT", pick, "BOTTOMLEFT", 0, -4)
      chanH = strHeight(pick, 14) + 32
    end
    chanRow:SetSize(w, chanH)
    row.chanHeight = chanH
    if noteFs:IsShown() then noteFs:SetWidth(w) end
  end

  row.new = ns.WhatsNew.Tag(sliderRow, head, "LEFT", "RIGHT", 8, 0)
  row.channelNew = ns.WhatsNew.Tag(chanRow, pick, "LEFT", "RIGHT", 8, 0)
  row.head, row.sliderRow, row.chanRow = head, sliderRow, chanRow
  row.label, row.slider, row.value, row.note, row.sampleBtn = label, slider, value, noteFs, sampleBtn
  row.pick, row.channel, row.channelList = pick, channel, channelList
  return row
end

-- Narrator and voices details block (lives inside the collapsible fold on Audio).
local VROW = 38
local MODES = { "story", "line", "zone" }
function Options.VoiceSection(parent, onLayout, onPreviewError)
  local section, rows = {}, {}
  local container = CreateFrame("Frame", nil, parent)

  local narratorHead = makeHeading(container, L["Narrator: stories, places and people"])
  local intro = makeNote(container, L["Each story plays from the first narrator here that has it. Use the arrows to reorder; untick one to stop using it."])
  local box = CreateFrame("Frame", nil, container)
  box:SetHeight(VROW)

  local function revoice()
    ns.Voice.Refresh(true)
    if ns.UI and ns.UI.OnVoiceChanged then ns.UI.OnVoiceChanged() end
  end

  local function voiceCheck(label, words, key, onClick)
    local r = CreateFrame("Frame", nil, container)
    local b = CreateFrame("CheckButton", nil, r, "UICheckButtonTemplate")
    b:SetPoint("TOPLEFT", -4, 0)
    local text = type(b.Text) == "table" and b.Text or b:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    text:ClearAllPoints()
    text:SetPoint("LEFT", b, "RIGHT", 4, 0)
    wrapRegion(text)
    text:SetText(label)
    b.label = text
    setTip(b, label, words)
    b:SetScript("OnClick", function(self)
      LoreForeverDB.settings[key] = self:GetChecked() and true or false
      if onClick then onClick(self) end
    end)
    r.cb, r.text = b, text
    function r.Layout(w)
      text:SetWidth(math.max(100, w - 32))
      local h = math.max(26, strHeight(text, 16) + 6)
      r:SetSize(w, h)
      return h
    end
    return r, b, text
  end

  local fillGenderRow, fillGender = voiceCheck(L["Let a man's and a woman's narrator fill in for each other"],
    L["Off: a story your top narrator hasn't recorded shows as text, rather than switching to a narrator of the other gender."],
    "voiceFillGender", revoice)

  local modeLabel = makeNote(container, L["When several voices have a narration:"], "GameFontNormalSmall", T.color.gold)
  local mode, modeList = dropDown("LoreForeverVoiceMode", container, 260)

  local raceRow, race, raceText = voiceCheck(L["Prefer voices that suit the race"],
    L["Orc lore in an orc voice: a voice that says which races it suits goes first for their stories."],
    "voiceMatchRace", revoice)
  local genderRow, gender, genderText = voiceCheck(L["Match the quest giver's voice"],
    L["Quest dialogue in a voice of the quest giver's race and gender. Your narrator reads any quest that voice hasn't recorded."],
    "voiceMatchGender")

  local raceNew = ns.WhatsNew.Tag(raceRow, raceText, "LEFT", "RIGHT", 8, 0)
  local genderNew = ns.WhatsNew.Tag(genderRow, genderText, "LEFT", "RIGHT", 8, 0)

  local willoHead = makeHeading(container, L["Willo's voice"])
  local willoNote = makeNote(container, L["Willo speaks in her own voice, picked in Willo."])
  local status = makeNote(container, "", "GameFontHighlightSmall")
  local moreUrl = urlRow(container, L["Get more voices:"], VOICES_URL)

  local offersRow = CreateFrame("Frame", nil, container)
  local offers = CreateFrame("CheckButton", nil, offersRow, "UICheckButtonTemplate")
  offers:SetPoint("TOPLEFT", -4, 0)
  local offersText = type(offers.Text) == "table" and offers.Text
    or offers:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  offersText:ClearAllPoints()
  offersText:SetPoint("LEFT", offers, "RIGHT", 4, 0)
  wrapRegion(offersText)
  offersText:SetText(L["Show download buttons"])
  setTip(offers, L["Show download buttons"], L["A dimmed play button where a free download has the voice for that quest or story."])
  offers:SetScript("OnClick", function(self) ns.VoiceOffer.SetEnabled(self:GetChecked()) end)
  offers:HookScript("OnShow", function(self) self:SetChecked(ns.VoiceOffer.Enabled()) end)
  offersRow.cb = offers
  function offersRow.Layout(w)
    offersText:SetWidth(math.max(100, w - 32))
    local h = math.max(26, strHeight(offersText, 16) + 6)
    offersRow:SetSize(w, h)
    return h
  end

  local packHintsRow, packHintsCb = makeCheckRow(container, "packHints", L["Narration pack hints"],
    L["When you enter a zone whose places and people are narrated in a voice pack you don't have, say so once."])

  local hint = makeNote(container,
    tr("Installed a voice? Type /reload; it's added at the bottom of the narrator list in Audio.",
      "Installed a voice? Type /reload; it's added at the bottom of the narrator list."))

  local modeNames = { story = L["Keep one voice per story"], line = L["Use the first voice for each narration"],
    zone = L["Keep one voice per zone"] }

  local function small(r, texture, tip, onClick)
    local b = CreateFrame("Button", nil, r)
    b:SetSize(20, 20)
    b:SetNormalTexture(texture)
    b:SetDisabledTexture(texture)
    local t = b.GetDisabledTexture and b:GetDisabledTexture()
    if t and t.SetDesaturated then t:SetDesaturated(true) end
    b:SetHighlightTexture("Interface\\Buttons\\UI-Common-MouseHilight", "ADD")
    b:SetScript("OnClick", function() onClick(r.item) end)
    setTip(b, tip, tip)
    return b
  end

  local function row(i)
    if rows[i] then return rows[i] end
    local r = CreateFrame("Frame", nil, box)
    r:SetHeight(VROW)
    r:SetPoint("TOPLEFT", 0, -(i - 1) * VROW)
    r:SetPoint("RIGHT", box, "RIGHT", 0, 0)
    r.check = CreateFrame("CheckButton", nil, r, "UICheckButtonTemplate")
    r.check:SetSize(26, 26)
    r.check:SetPoint("TOPLEFT", -4, -(VROW - 26) / 2)
    r.check:SetScript("OnClick", function(self)
      ns.Voice.SetOn(r.item.key, self:GetChecked() and true or false)
      section.Update()
      if onLayout then onLayout() end
    end)
    r.down = small(r, "Interface\\Buttons\\UI-ScrollBar-ScrollDownButton-Up", L["Move down"], function(it)
      ns.Voice.Move(it.key, 1)
      section.Update()
      if onLayout then onLayout() end
    end)
    r.down:SetPoint("TOPRIGHT", 0, -(VROW - 20) / 2)
    r.up = small(r, "Interface\\Buttons\\UI-ScrollBar-ScrollUpButton-Up", L["Move up"], function(it)
      ns.Voice.Move(it.key, -1)
      section.Update()
      if onLayout then onLayout() end
    end)
    r.up:SetPoint("RIGHT", r.down, "LEFT", -2, 0)
    r.sample = themedButton(r, L["Sample"])
    r.sample:SetSize(70, 22)
    r.sample:SetPoint("RIGHT", r.up, "LEFT", -6, 0)
    fit(r.sample, 70)
    r.sample:SetScript("OnClick", function()
      if ns.Voice.previewing == r.item.key then return ns.Voice.StopPreview() end
      local ok, why = ns.Voice.Preview(r.item.key)
      if not ok then
        local st = ns.Voice.Status(true)
        if why and st:find(why, 1, true) then
          status:SetText(st)
        else
          status:SetText(st .. " " .. T.code.warn .. (why or L["(Nothing to preview.)"]) .. "|r")
        end
        if onPreviewError then onPreviewError(why) end
      end
    end)
    r.forget = themedButton(r, L["Forget"])
    r.forget:SetSize(70, 22)
    r.forget:SetPoint("RIGHT", r.up, "LEFT", -6, 0)
    fit(r.forget, 70)
    r.forget:SetScript("OnClick", function()
      ns.Voice.Forget(r.item.key)
      section.Update()
      if onLayout then onLayout() end
    end)
    local w1, w2 = r.sample:GetWidth(), r.forget:GetWidth()
    if type(w1) == "number" and type(w2) == "number" then
      r.sample:SetWidth(math.max(w1, w2))
      r.forget:SetWidth(math.max(w1, w2))
    end
    r.name = r:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    r.name:SetPoint("TOPLEFT", r.check, "TOPRIGHT", 2, 3)
    r.name:SetPoint("RIGHT", r.sample, "LEFT", -8, 0)
    wrapRegion(r.name)
    r.stats = r:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    r.stats:SetPoint("TOPLEFT", r.name, "BOTTOMLEFT", 0, -2)
    r.stats:SetPoint("RIGHT", r.sample, "LEFT", -8, 0)
    wrapRegion(r.stats)
    r.packs = r:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    r.packs:SetPoint("TOPLEFT", r.check, "BOTTOMRIGHT", 2, 0)
    r.packs:SetPoint("TOPRIGHT", r, "TOPRIGHT", 0, -(VROW - 26) / 2 - 26)
    wrapRegion(r.packs)
    function r.Layout(w)
      w = (type(w) == "number" and w > 0) and w or (tonumber(box:GetWidth()) or 260)
      r:SetWidth(w)
      local hasBtn = (r.sample and r.sample:IsShown()) or (r.forget and r.forget:IsShown())
      local rightAnchor = hasBtn and r.sample or r.up
      r.name:ClearAllPoints()
      r.name:SetPoint("TOPLEFT", r.check, "TOPRIGHT", 2, 3)
      r.name:SetPoint("RIGHT", rightAnchor, "LEFT", -8, 0)
      r.stats:ClearAllPoints()
      r.stats:SetPoint("TOPLEFT", r.name, "BOTTOMLEFT", 0, -2)
      r.stats:SetPoint("RIGHT", rightAnchor, "LEFT", -8, 0)
      local btnW = hasBtn and ((tonumber(r.sample:GetWidth()) or 70) + 6) or 0
      local textW = math.max(80, w - 24 - (42 + btnW + 8))
      r.name:SetWidth(textW)
      r.stats:SetWidth(textW)
      local textBot = 3 + strHeight(r.name, 14) + 2 + strHeight(r.stats, 12) + 4
      local topH = math.max(VROW, textBot)
      local height = topH
      if r.packs:IsShown() then
        r.packs:ClearAllPoints()
        r.packs:SetPoint("TOPLEFT", r, "TOPLEFT", 24, -topH)
        r.packs:SetPoint("TOPRIGHT", r, "TOPRIGHT", 0, -topH)
        r.packs:SetWidth(math.max(80, w - 24))
        height = topH + strHeight(r.packs, 12) + 4
      end
      r.height = height
      r:SetSize(w, height)
      return height
    end
    rows[i] = r
    return r
  end

  local function downloads(it)
    if not it.lacking then return nil end
    if #it.lacking == 0 then return T.code.green .. L["Complete"] .. "|r" end
    local line = T.code.stale .. L["Missing:"] .. "|r " .. table.concat(it.lacking, ns.Lang.Dotted(" · "))
    if it.complete then line = line .. "\n" .. string.format(L["%s installs them all."], it.complete) end
    return line
  end

  local function fill(r, it, i, n)
    r.item = it
    local usable = not it.why
    r.check:SetChecked(it.on)
    r.name:SetText(((it.on and usable) and "" or T.code.faint) .. it.label .. ((it.on and usable) and "" or "|r"))
    local stats
    if it.why then
      stats = T.code.warn .. it.why .. "|r"
    elseif it.on then
      stats = string.format(L["%d lore recordings available"], it.have) .. (it.races and (ns.Lang.Dotted(" · ") .. it.races) or "")
    else
      stats = string.format(L["not used · %d lore recordings available"], it.have)
    end
    if usable and it.stale > 0 then stats = stats .. ns.Lang.Dotted(" · ") .. T.code.stale .. string.format(L["%d outdated"], it.stale) .. "|r" end
    r.stats:SetText(stats)
    r.stats:SetTextColor(T.rgba(T.color.muted))
    r.sample:SetShown(usable and not it.extOnly)
    r.sample:SetText(ns.Voice.previewing == it.key and L["Stop"] or L["Sample"])
    r.forget:SetShown(it.missing and not it.default)
    if i == 1 then r.up:Disable() else r.up:Enable() end
    if i == n then r.down:Disable() else r.down:Enable() end
    local line = downloads(it)
    r.packs:SetText(line or "")
    r.packs:SetTextColor(T.rgba(T.color.muted))
    r.packs:SetShown(line ~= nil)
    r:Show()
    return r.Layout(tonumber(box:GetWidth()) or 260)
  end

  function section.Update()
    if section.SyncVolume then section.SyncVolume() end
    local items = ns.Voice.List()
    local y = 0
    for i, it in ipairs(items) do
      local r = row(i)
      r:SetPoint("TOPLEFT", 0, -y)
      y = y + fill(r, it, i, #items)
    end
    for i = #items + 1, #rows do rows[i]:Hide() end
    box:SetHeight(math.max(y, VROW))

    local cur = (LoreForeverDB and LoreForeverDB.settings.voiceGroup) or "story"
    mode:SetText(modeNames[cur] or modeNames.story)
    race:SetChecked(LoreForeverDB and LoreForeverDB.settings.voiceMatchRace and true or false)
    fillGender:SetChecked(LoreForeverDB and LoreForeverDB.settings.voiceFillGender and true or false)
    gender:SetChecked(not (LoreForeverDB and LoreForeverDB.settings.voiceMatchGender == false))
    offers:SetChecked(ns.VoiceOffer.Enabled())
    status:SetText(ns.Voice.Status(true))
    moreUrl.fill()
    section.items = items
  end

  function section.MakeRows(n)
    for i = 1, n do row(i):Hide() end
  end

  function section.UpdateSamples()
    if section.SyncVolume then section.SyncVolume() end
    for _, r in ipairs(rows) do
      if r.item then r.sample:SetText(ns.Voice.previewing == r.item.key and L["Stop"] or L["Sample"]) end
    end
  end

  function section.ShowNew()
    if section.volumeNew then section.volumeNew:SetShown(ns.WhatsNew.OptionIsNew("Narration and game voices")) end
    if section.channelNew then section.channelNew:SetShown(ns.WhatsNew.OptionIsNew("Play voices on")) end
    raceNew:SetShown(ns.WhatsNew.OptionIsNew("Prefer voices that suit the race"))
    genderNew:SetShown(ns.WhatsNew.OptionIsNew("Match the quest giver's voice"))
  end

  function section.Layout(w)
    local gutter = 28
    local twoCol = w >= 540
    local colW = twoCol and math.floor((w - gutter) / 2) or w
    local xR = twoCol and (colW + gutter) or 0
    local function put(f, x, y, cw)
      f:Show()
      f:ClearAllPoints()
      f:SetPoint("TOPLEFT", x, -y)
      if cw then f:SetWidth(cw) end
    end
    local yl = 0
    put(narratorHead, 0, yl, colW); yl = yl + strHeight(narratorHead, 14) + 4
    put(intro, 0, yl, colW); yl = yl + strHeight(intro, 14) + 8
    box:ClearAllPoints()
    box:SetPoint("TOPLEFT", 0, -yl)
    box:SetWidth(colW)
    local listH = 0
    for _, r in ipairs(rows) do
      if r:IsShown() then
        r:ClearAllPoints()
        r:SetPoint("TOPLEFT", 0, -listH)
        listH = listH + r.Layout(colW)
      end
    end
    box:SetHeight(math.max(listH, VROW))
    yl = yl + math.max(listH, VROW) + 8

    local yr = twoCol and 0 or (yl + 6)
    put(fillGenderRow, xR, yr); yr = yr + fillGenderRow.Layout(colW) + 6
    put(modeLabel, xR, yr, colW); yr = yr + strHeight(modeLabel, 14) + 4
    put(mode, xR, yr); mode:SetWidth(math.min(colW, 280)); yr = yr + 30
    put(raceRow, xR, yr); yr = yr + raceRow.Layout(colW) + 4
    put(genderRow, xR, yr); yr = yr + genderRow.Layout(colW) + 12
    put(willoHead, xR, yr, colW); yr = yr + strHeight(willoHead, 14) + 4
    put(willoNote, xR, yr, colW); yr = yr + strHeight(willoNote, 14) + 8
    local h = twoCol and math.max(yl, yr) or yr
    container:SetSize(w, h)
    return h
  end

  mode:SetScript("OnClick", function()
    local items = {}
    for _, m in ipairs(MODES) do items[#items + 1] = { value = m, label = modeNames[m] } end
    modeList.Toggle(items, (LoreForeverDB and LoreForeverDB.settings.voiceGroup) or "story", function(ch)
      ns.Voice.SetGroup(ch.value)
      section.Update()
      if onLayout then onLayout() end
    end)
  end)

  section.container = container
  section.rows, section.box, section.mode, section.modeList = rows, box, mode, modeList
  section.status, section.url, section.race = status, moreUrl.url, race
  section.fillGender, section.gender = fillGender, gender
  section.packHintsCb = packHintsCb
  section.packsControls = { status = status, moreUrl = moreUrl, offersRow = offersRow,
    packHintsRow = packHintsRow, hint = hint }
  return section, container
end

-- Compact installed-packs list grouped by narrator and language, with full counts on hover.
local LANG_KIND = { lang = true, ["lang-overlay"] = true, ["edition-text"] = true, ["edition-voice"] = true }
function Options.PackList(parent)
  local list = { rows = {}, heads = {}, order = {}, groups = {}, showHead = true }
  local c = CreateFrame("Frame", nil, parent)
  list.container = c
  local head = makeHeading(c, L["Installed packs"])
  local help = makeNote(c, L["Each voice pack adds recordings to one of your narrators. Language packs are picked in General > Language."])
  local empty = makeNote(c, L["None yet."])
  empty:Hide()
  list.head, list.help, list.empty = head, help, empty

  local function plain(title)
    local s = tostring(title or "")
    s = s:gsub("^Lore Forever: ", ""):gsub(" %(female narrator%)$", ""):gsub(" %(male narrator%)$", "")
    s = s:gsub(" %(original male narrator%)$", ""):gsub("^quest givers' voices, ", "")
    if s:match("^Lore Forever .*narrator$") then s = L["Core stories"] end
    return (s:gsub("^%l", string.upper))
  end

  local function groupOf(it)
    local n = it.name or ""
    local rec = ns.Packs.Get(n)
    local kind = (rec and rec.kind) or it.kind
    if LANG_KIND[kind] then
      return "lang", L["Language packs"]
    end
    local key, title
    if n:find("QuestGivers", 1, true) then
      key, title = "givers", L["Quest givers' voices"]
    elseif n:find("_Female", 1, true) then
      key, title = "female", (ns.Packs.Get("LoreForever_Voice_Female") or {}).title or "Lore Forever female narrator"
    elseif n:find("_Original", 1, true) then
      key, title = "original", (ns.Packs.Get("LoreForever_Voice_Original") or {}).title or "Lore Forever original male narrator"
    elseif n:find("^LoreForever_Voice_Default") then
      key, title = "male", (ns.Packs.Get("LoreForever_Voice_Default") or {}).title or "Lore Forever male narrator"
    elseif kind == "voice" or kind == "transport" then
      local base = (rec and (rec.transportFor or rec.extends)) or (ns.Voice and ns.Voice.KeyOf and ns.Voice.KeyOf(n)) or n
      key = "voice:" .. base
      title = (ns.Packs.Get(base) or {}).title or it.narrator or it.title
    else
      key, title = "other:" .. n, it.narrator or it.title
    end
    return key .. "|" .. tostring(it.language), title .. ns.Lang.Dotted(" · ") .. tostring(it.language)
  end

  local function detail(it)
    local d = it.language .. ns.Lang.Dotted(" · ") .. it.status
    if it.counts then
      local countsLine = it.counts.answer > 0
        and string.format(L["%d lore recordings · %d quest dialogue · %d lore answers"],
          it.counts.lore, it.counts.quest, it.counts.answer)
        or string.format(L["%d lore recordings · %d quest dialogue"],
          it.counts.lore, it.counts.quest)
      d = d .. "\n" .. (it.checked and not it.questPageCheck and L["Current:"] or L["Installed:"]) .. " " .. countsLine
      if not it.checked then
        d = d .. ns.Lang.Dotted(" · ") .. L["current/outdated: switch language to check"]
      elseif it.stale > 0 then
        d = d .. ns.Lang.Dotted(" · ") .. string.format(L["%d outdated"], it.stale)
      end
      if it.counts.unknown > 0 then
        d = d .. ns.Lang.Dotted(" · ") .. string.format(L["%d unrecognized"], it.counts.unknown)
      end
      if it.questPageCheck then
        d = d .. "\n" .. L["Quest dialogue is checked against the quest page when opened."]
      end
    elseif it.support then
      d = d .. "\n" .. string.format(L["Playback support for %d recordings"], it.support)
    elseif it.entries then
      d = d .. "\n" .. string.format(L["%d translated entries · %d translated strings"], it.entries, it.strings)
    elseif not LANG_KIND[it.kind] then
      d = d .. ns.Lang.Dotted(" · ") .. L["Counts not checked"]
    end
    return d
  end

  local function short(it)
    local loaded = it.status == L["Loaded"] or it.status == L["In use"] or it.status == L["Playback support loaded"]
    local calm = loaded or it.status == L["Pick it in General > Language"]
    local state = calm and it.status or (T.code.warn .. it.status .. "|r")
    local n
    if it.counts then n = string.format(L["%d recordings"], it.counts.lore + it.counts.quest + it.counts.answer)
    elseif it.support then n = string.format(L["%d recordings"], it.support)
    elseif it.entries and it.entries > 0 then n = string.format(L["%d entries"], it.entries) end
    return state .. (n and (ns.Lang.Dotted(" · ") .. n) or ""), loaded
  end

  local function row(i)
    if list.rows[i] then return list.rows[i] end
    local r = CreateFrame("Frame", nil, c)
    r:EnableMouse(true)
    local hl = r:CreateTexture(nil, "HIGHLIGHT")
    hl:SetAllPoints()
    hl:SetColorTexture(1, 1, 1, 0.06)
    r.name = r:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    r.name:SetPoint("LEFT", 12, 0)
    wrapRegion(r.name)
    r.right = r:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    r.right:SetPoint("RIGHT", -4, 0)
    r.right:SetJustifyH("RIGHT")
    if r.right.SetWordWrap then r.right:SetWordWrap(true) end
    r.right:SetTextColor(T.rgba(T.color.muted))
    r:SetScript("OnEnter", function(self)
      if not (_G.GameTooltip and self.item) then return end
      GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
      GameTooltip:AddLine(self.item.title)
      T.Tip(self.detail, "tipText", true)
      GameTooltip:Show()
    end)
    r:SetScript("OnLeave", function() if _G.GameTooltip then GameTooltip:Hide() end end)
    list.rows[i] = r
    return r
  end

  local function headFor(i)
    if list.heads[i] then return list.heads[i] end
    local h = makeNote(c, "", "GameFontNormalSmall", T.color.gold)
    list.heads[i] = h
    return h
  end

  function list.MakeRows(n)
    for i = 1, n do
      row(i):Hide()
      headFor(i):Hide()
    end
  end

  function list.Update()
    local items = ns.Voice.InstalledPacks()
    local groups, order, langGroup = {}, {}, nil
    for _, it in ipairs(items) do
      local key, title = groupOf(it)
      if key == "lang" then
        langGroup = langGroup or { title = title, items = {} }
        table.insert(langGroup.items, it)
      else
        if not groups[key] then
          groups[key] = { title = title, items = {} }
          order[#order + 1] = key
        end
        table.insert(groups[key].items, it)
      end
    end
    if langGroup then
      table.sort(langGroup.items, function(a, b)
        local la, lb = tostring(a.language or ""):lower(), tostring(b.language or ""):lower()
        if la ~= lb then return la < lb end
        return tostring(a.name or "") < tostring(b.name or "")
      end)
      groups["lang"] = langGroup
      order[#order + 1] = "lang"
    end
    local ri, allLoaded = 0, true
    for gi, key in ipairs(order) do
      local h = headFor(gi)
      local g = groups[key]
      h:SetText(g.title .. ns.Lang.Dotted(" · ") .. string.format(#g.items == 1 and L["%d pack"] or L["%d packs"], #g.items))
      for _, it in ipairs(g.items) do
        ri = ri + 1
        local r = row(ri)
        r.item, r.detail = it, detail(it)
        r.name:SetText(LANG_KIND[it.kind] and (it.language or plain(it.title)) or plain(it.title))
        local text, loaded = short(it)
        r.right:SetText(text)
        allLoaded = allLoaded and loaded
      end
    end
    for i = ri + 1, #list.rows do list.rows[i]:Hide() end
    for i = #order + 1, #list.heads do list.heads[i]:Hide() end
    list.groups, list.order, list.n = groups, order, ri
    list.summary = string.format(#items == 1 and L["%d pack"] or L["%d packs"], #items)
      .. (allLoaded and (ns.Lang.Dotted(" · ") .. L["all loaded"]) or "")
    return list.summary
  end

  function list.Layout(w)
    local y = 0
    if list.showHead then
      head:Show(); head:ClearAllPoints(); head:SetPoint("TOPLEFT", 0, -y); head:SetWidth(w)
      y = y + strHeight(head, 16) + 4
    else
      head:Hide()
    end
    help:ClearAllPoints(); help:SetPoint("TOPLEFT", 0, -y); help:SetWidth(w)
    y = y + strHeight(help, 14) + 10
    if #list.order == 0 then
      empty:Show(); empty:ClearAllPoints(); empty:SetPoint("TOPLEFT", 0, -y); empty:SetWidth(w)
      y = y + strHeight(empty, 14) + 6
    else
      empty:Hide()
    end
    local ri = 0
    for gi, key in ipairs(list.order) do
      local h = list.heads[gi]
      h:Show(); h:ClearAllPoints(); h:SetPoint("TOPLEFT", 0, -y); h:SetWidth(w)
      y = y + strHeight(h, 14) + 3
      for _ in ipairs(list.groups[key].items) do
        ri = ri + 1
        local r = list.rows[ri]
        local rw = math.max(186, math.min(math.floor(w * 0.6), strWidth(r.right, 100) + 8))
        local nw = math.max(100, w - 12 - rw - 8)
        r.name:SetWidth(nw)
        r.right:SetWidth(rw)
        local textH = math.max(strHeight(r.name, 14), strHeight(r.right, 14))
        local rh = textH > 15 and (textH + 6) or 17
        r:Show(); r:ClearAllPoints(); r:SetPoint("TOPLEFT", 0, -y); r:SetSize(w, rh)
        y = y + rh
      end
      y = y + 10
    end
    c:SetSize(w, y)
    return y
  end

  return list
end

-- Reset heard narrations row with in-place Undo while Options remains open (no modal popup; safe on controller UI).
local function makeResetHeardRow(parent, relayoutFn)
  local resetBtn = themedButton(parent, L["Reset heard narrations"])
  resetBtn:SetSize(180, 22)
  fit(resetBtn, 170)
  setTip(resetBtn, L["Reset heard narrations"],
    L["This character forgets what it has heard, so narrations play by themselves again."])

  local note = parent:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  wrapRegion(note)
  note:Hide()

  local undoBtn = themedButton(parent, L["Undo"])
  undoBtn:SetSize(70, 22)
  fit(undoBtn, 60)
  undoBtn:Hide()

  local undo, emptyMsg
  local function say(msg) DEFAULT_CHAT_FRAME:AddMessage(T.CHAT_PREFIX .. msg) end

  resetBtn:SetScript("OnClick", function()
    local n, snap = ns.Voice.ResetHeard()
    if n == 0 then
      undo, emptyMsg = nil, L["Nothing heard yet on this character."]
      note:SetText(emptyMsg)
      say(emptyMsg)
      relayoutFn()
      return
    end
    emptyMsg = nil
    undo = { n = n, snap = snap }
    local msg = string.format(n == 1 and L["Reset. %d narration will play again."]
      or L["Reset. %d narrations will play again."], n)
    note:SetText(msg)
    say(msg)
    if ns.UI and ns.UI.UpdateListen and ns.UI.frame then ns.UI.UpdateListen() end
    relayoutFn()
  end)

  undoBtn:SetScript("OnClick", function()
    if not undo then return end
    ns.Voice.RestoreHeard(undo.snap)
    local msg = string.format(undo.n == 1 and L["Put back: %d narration heard."]
      or L["Put back: %d narrations heard."], undo.n)
    say(msg)
    undo = nil
    if ns.UI and ns.UI.UpdateListen and ns.UI.frame then ns.UI.UpdateListen() end
    relayoutFn()
  end)

  local entry = {
    frame = resetBtn,
    button = resetBtn,
    note = note,
    undoButton = undoBtn,
    gapBefore = 0,
    gapAfter = 8,
    clear = function()
      if undo or emptyMsg then
        undo, emptyMsg = nil, nil
        relayoutFn()
      end
    end,
    place = function(y, w)
      if not undo and not emptyMsg then
        note:Hide(); undoBtn:Hide()
        resetBtn:Show(); resetBtn:ClearAllPoints(); resetBtn:SetPoint("TOPLEFT", 30, -y)
        return 22
      end
      resetBtn:Hide()
      local bw = tonumber(undoBtn:GetWidth()) or 60
      local nw = undo and math.max(80, math.min(130, w - 30 - bw - 10)) or math.max(80, w - 30 - 16)
      note:Show(); note:ClearAllPoints(); note:SetWidth(nw)
      local h = math.max(12, strHeight(note, 12))
      local rowH = math.max(22, h + 4)
      note:SetPoint("TOPLEFT", 30, -y - math.floor((rowH - h) / 2))
      if undo then
        undoBtn:Show(); undoBtn:ClearAllPoints()
        undoBtn:SetPoint("TOPLEFT", 30 + nw + 10, -y - math.floor((rowH - 22) / 2))
      else
        undoBtn:Hide()
      end
      return rowH
    end,
  }
  return entry
end

-- Populate the Packs tab with top status/links/switches and the grouped Installed packs list below.
local function buildPacksTab(packsTab, voiceSection, packList)
  local pc = packsTab.child
  local d = voiceSection.packsControls
  for _, f in ipairs({ d.status, d.moreUrl, d.offersRow, d.packHintsRow, d.hint }) do f:SetParent(pc) end
  packsTab.layout = function(w)
    w = math.max(260, (type(w) == "number" and w > 0) and w or 580)
    pc:SetWidth(w)
    local pad, gutter = 16, 28
    local twoCol = w >= 540
    local colW = twoCol and math.floor((w - pad * 2 - gutter) / 2) or (w - pad * 2)
    local xR = twoCol and (pad + colW + gutter) or pad
    local function put(f, x, y, cw)
      f:Show(); f:ClearAllPoints(); f:SetPoint("TOPLEFT", pc, "TOPLEFT", x, -y)
      if cw then f:SetWidth(cw) end
    end
    local yl = 14
    put(d.status, pad, yl, colW); yl = yl + strHeight(d.status, 14) + 8
    put(d.moreUrl, pad, yl); yl = yl + d.moreUrl.Layout(colW) + 8
    put(d.hint, pad, yl, colW); yl = yl + strHeight(d.hint, 14)

    local yr = twoCol and 14 or (yl + 12)
    put(d.offersRow, xR, yr); yr = yr + d.offersRow.Layout(colW) + 4
    put(d.packHintsRow, xR, yr); yr = yr + d.packHintsRow.Layout(colW)

    local y = (twoCol and math.max(yl, yr) or yr) + 18
    put(packList.container, pad, y)
    y = y + packList.Layout(w - pad * 2)
    pc:SetHeight(y + 16)
  end
end

function Options.Create()
  if Options.panel then return Options.panel end

  local p = CreateFrame("Frame", "LoreForeverOptions")
  p:Hide()
  p.name = "Lore Forever"
  p.checks = {}
  p.willoChecks = {}

  -- Header ----------------------------------------------------------------------------------------------------------
  local header = CreateFrame("Frame", nil, p)
  header:SetPoint("TOPLEFT", 0, 0)
  header:SetPoint("TOPRIGHT", 0, 0)
  header:SetHeight(56)
  local headerBg = header:CreateTexture(nil, "BACKGROUND")
  headerBg:SetAllPoints()
  if T and T.Gradient then T.Gradient(headerBg, "VERTICAL", PALETTE.headerBot, PALETTE.headerTop)
  else fillColor(headerBg, PALETTE.headerTop) end
  local headerRule = fillColor(header:CreateTexture(nil, "BORDER"), PALETTE.rule)
  headerRule:SetPoint("BOTTOMLEFT"); headerRule:SetPoint("BOTTOMRIGHT"); headerRule:SetHeight(1)

  local badge = CreateFrame("Frame", nil, header)
  badge:SetSize(34, 34)
  badge:SetPoint("LEFT", 16, 0)
  fillColor(badge:CreateTexture(nil, "BACKGROUND"), PALETTE.bookBg):SetAllPoints()
  makeBorder(badge, PALETTE.bookRim, 1)
  local bookIcon = badge:CreateTexture(nil, "ARTWORK")
  bookIcon:SetTexture((T and T.KindIcon and T.KindIcon("storyline")) or "Interface\\Icons\\INV_Misc_Book_09")
  bookIcon:SetTexCoord(0.08, 0.92, 0.08, 0.92)
  bookIcon:SetSize(22, 22)
  bookIcon:SetPoint("CENTER")

  local brand = header:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
  brand:SetPoint("TOPLEFT", badge, "TOPRIGHT", 10, -2)
  brand:SetTextColor(T.rgba(T.color.gold))
  brand:SetText("LORE FOREVER")

  local headerTitle = header:CreateFontString(nil, "ARTWORK", (T and T.font and T.font.place) or "GameFontNormalLarge")
  headerTitle:SetPoint("TOPLEFT", brand, "BOTTOMLEFT", 0, -1)
  headerTitle:SetTextColor(T.rgba(PALETTE.text))
  headerTitle:SetText(L["Settings"])

  -- Protected frame anchored directly to p (never to text regions).
  local reload = CreateFrame("Button", "LoreForeverReloadButton", p, "SecureActionButtonTemplate, UIPanelButtonTemplate")
  reload:SetSize(120, 24)
  reload:SetPoint("TOPRIGHT", p, "TOPRIGHT", -16, -16)
  reload:SetText(L["Reload now"])
  fit(reload, 120)
  if reload.SetAttribute then
    reload:SetAttribute("type", "macro")
    reload:SetAttribute("macrotext", "/reload")
  end
  reload:RegisterForClicks("AnyUp", "AnyDown")
  reload:Hide()
  p.reload = reload

  -- 6-Tab Bar -------------------------------------------------------------------------------------------------------
  local tabBar = CreateFrame("Frame", nil, p)
  tabBar:SetPoint("TOPLEFT", header, "BOTTOMLEFT", 0, 0)
  tabBar:SetPoint("TOPRIGHT", header, "BOTTOMRIGHT", 0, 0)
  tabBar:SetHeight(34)
  fillColor(tabBar:CreateTexture(nil, "BACKGROUND"), PALETTE.tabBar):SetAllPoints()
  local tabBarRule = fillColor(tabBar:CreateTexture(nil, "BORDER"), PALETTE.rule)
  tabBarRule:SetPoint("BOTTOMLEFT"); tabBarRule:SetPoint("BOTTOMRIGHT"); tabBarRule:SetHeight(1)

  local tabSpecs = {
    { key = "audio", label = L["Audio"], scrollName = "LoreForeverOptionsScroll" },
    { key = "packs", label = L["Packs"], scrollName = "LoreForeverOptionsScrollPacks" },
    { key = "screen", label = L["On Screen"], scrollName = "LoreForeverOptionsScrollScreen" },
    { key = "keys", label = L["Keys"], scrollName = "LoreForeverOptionsScrollKeys" },
    { key = "willo", label = ns.COMPANION_NAME, scrollName = "LoreForeverOptionsScrollWillo" },
    { key = "general", label = L["General"], scrollName = "LoreForeverOptionsScrollGeneral" },
  }

  p.tabs, p.tabList, p.tabFrames = {}, {}, {}

  local function layoutTabs(barW)
    local w = (type(barW) == "number" and barW > 0) and barW or (tabBar.GetWidth and tonumber(tabBar:GetWidth())) or 600
    if not w or w <= 0 then w = 600 end
    local n = #p.tabList
    local each = math.max(56, math.floor((w - 16) / n))
    for i, btn in ipairs(p.tabList) do
      btn:ClearAllPoints()
      btn:SetPoint("TOPLEFT", tabBar, "TOPLEFT", 8 + (i - 1) * each, 0)
      btn:SetSize(each, 33)
      if btn.label then btn.label:SetWidth(math.max(44, each - 8)) end
    end
  end

  local function makeTabScroll(scrollName)
    local sf = CreateFrame("ScrollFrame", scrollName, p, "UIPanelScrollFrameTemplate")
    sf:SetPoint("TOPLEFT", tabBar, "BOTTOMLEFT", 0, -4)
    sf:SetPoint("BOTTOMRIGHT", p, "BOTTOMRIGHT", -28, 6)
    sf:Hide()
    local child = CreateFrame("Frame", nil, sf)
    child:SetSize(580, 500)
    sf:SetScrollChild(child)
    local leftCol = CreateFrame("Frame", nil, child)
    local rightCol = CreateFrame("Frame", nil, child)
    local divider = fillColor(child:CreateTexture(nil, "BORDER"), PALETTE.ruleSoft)
    divider:SetWidth(1)
    return { sf = sf, child = child, leftCol = leftCol, rightCol = rightCol, divider = divider }
  end

  local function layoutColumns(tab, w, leftFn, rightFn)
    w = math.max(260, (type(w) == "number" and w > 0) and w or 580)
    tab.child:SetWidth(w)
    local twoCol = w >= 540
    local pad = 16
    local gutter = 28
    local colW = twoCol and math.floor((w - pad * 2 - gutter) / 2) or (w - pad * 2)
    colW = math.max(180, colW)

    local lh = leftFn(colW)
    local rh = rightFn(colW)

    tab.leftCol:ClearAllPoints()
    tab.leftCol:SetPoint("TOPLEFT", tab.child, "TOPLEFT", pad, -14)
    tab.leftCol:SetSize(colW, math.max(lh, 20))

    tab.rightCol:ClearAllPoints()
    if twoCol then
      local divX = pad + colW + math.floor(gutter / 2)
      tab.divider:Show()
      tab.divider:ClearAllPoints()
      tab.divider:SetPoint("TOPLEFT", tab.child, "TOPLEFT", divX, -14)
      tab.divider:SetHeight(math.max(lh, rh, 120))
      tab.rightCol:SetPoint("TOPLEFT", tab.child, "TOPLEFT", pad + colW + gutter, -14)
      tab.rightCol:SetSize(colW, math.max(rh, 20))
      tab.child:SetHeight(math.max(lh, rh) + 32)
    else
      tab.divider:Hide()
      tab.rightCol:SetPoint("TOPLEFT", tab.leftCol, "BOTTOMLEFT", 0, -18)
      tab.rightCol:SetSize(colW, math.max(rh, 20))
      tab.child:SetHeight(lh + rh + 50)
    end
  end

  local function addCheck(parent, key, label, tip, english, onClick)
    local r, cb = makeCheckRow(parent, key, label, tip, english, onClick)
    p.checks[#p.checks + 1] = cb
    return r, cb
  end

  local function layoutStack(col, entries, w)
    local y = 0
    for _, e in ipairs(entries) do
      if not e.shown or e.shown() then
        if e.gapBefore and y > 0 then y = y + e.gapBefore end
        local h = e.place(y, w)
        y = y + h + (e.gapAfter or 0)
      else
        if e.frame then e.frame:Hide() end
      end
    end
    return y
  end

  local function headingEntry(fs, gapBefore)
    return {
      gapBefore = gapBefore or 16,
      gapAfter = 6,
      place = function(y, w)
        fs:Show()
        fs:ClearAllPoints()
        fs:SetPoint("TOPLEFT", 0, -y)
        fs:SetWidth(w)
        return strHeight(fs, 16)
      end,
    }
  end

  local function noteEntry(fs, gapBefore, gapAfter, shownFn)
    return {
      frame = fs,
      gapBefore = gapBefore or 0,
      gapAfter = gapAfter or 6,
      shown = function() return (not shownFn or shownFn()) and fs:GetText() ~= nil and fs:GetText() ~= "" end,
      place = function(y, w)
        fs:Show()
        fs:ClearAllPoints()
        fs:SetPoint("TOPLEFT", 0, -y)
        fs:SetWidth(w)
        return strHeight(fs, 14)
      end,
    }
  end

  local function rowEntry(r, shownFn, gapBefore, gapAfter)
    return {
      frame = r,
      gapBefore = gapBefore or 0,
      gapAfter = gapAfter or 4,
      shown = shownFn,
      place = function(y, w)
        r:Show()
        r:ClearAllPoints()
        r:SetPoint("TOPLEFT", 0, -y)
        return r.Layout(w)
      end,
    }
  end

  local function buttonsRow(parent, btns)
    local wrap = CreateFrame("Frame", nil, parent)
    for _, b in ipairs(btns) do b:SetParent(wrap) end
    function wrap.Layout(w)
      local x, y, rowH = 0, 0, 24
      for _, b in ipairs(btns) do
        if b:IsShown() then
          local bw = tonumber(b:GetWidth()) or 120
          if x > 0 and x + bw > w then
            x = 0
            y = y + rowH + 6
          end
          b:ClearAllPoints()
          b:SetPoint("TOPLEFT", x, -y)
          x = x + bw + 8
        end
      end
      local h = (x > 0 or y > 0) and (y + rowH) or 0
      wrap:SetSize(w, math.max(1, h))
      return h
    end
    return wrap
  end

  -- Forward declaration for layout trigger
  local function relayout(key)
    local tab = p.tabFrames[key]
    if not tab or not tab.layout then return end
    local w = tab.sf.GetWidth and tonumber(tab.sf:GetWidth())
    if not w or w <= 0 then w = 580 end
    tab.layout(w)
  end

  -- =================================================================================================================
  -- TAB 1: AUDIO
  -- =================================================================================================================
  local audioTab = makeTabScroll("LoreForeverOptionsScroll")
  p.tabFrames.audio = audioTab
  local aL, aR = audioTab.leftCol, audioTab.rightCol

  local previewWarn = makeNote(aL, "")
  previewWarn:Hide()
  local vol = buildVolumeControls(aL, function(why)
    previewWarn:SetText(T.code.warn .. (why or L["(Nothing to preview.)"]) .. "|r")
    previewWarn:Show()
    relayout("audio")
  end)
  vol.onLayout = function() relayout("audio") end

  local playbackHead = makeHeading(aL, L["Playback"])
  local radioWrap = CreateFrame("Frame", nil, aL)
  local radioAuto = makeRadio(radioWrap, L["Automatic"])
  local radioManual = makeRadio(radioWrap, tr("Only when I press Play", "Narration: only when I press Play"))
  radioManual.key = "onDemand"
  radioManual.labelRef = radioManual.label
  radioManual.english = "Narration: only when I press Play"
  radioManual.color = { radioManual.label:GetTextColor() }
  radioManual.newTag = ns.WhatsNew.Tag(radioWrap, radioManual.label, "LEFT", "RIGHT", 6, 0)
  local baseManualChecked = radioManual.SetChecked
  radioManual.SetChecked = function(self, v)
    baseManualChecked(self, v)
    radioAuto:SetChecked(not (v and true or false))
  end
  p.checks[#p.checks + 1] = radioManual
  setTip(radioAuto, L["Automatic"], L["Stories, flights and quest dialogue follow your choices below."])
  setTip(radioManual, L["Only when I press Play"],
    L["Nothing plays by itself. Play buttons, the Narrate key and your playlist still work."])

  local autoZoneRow, autoZoneCb = addCheck(aL, "autoZone", L["Play stories as you find them"],
    L["Stories for the places and pages you find join your playlist and play in turn. Never in combat or on a flight."])
  local flightsRow, flightsCb = addCheck(aL, "narrateFlights", L["Narrate flights"],
    L["Read the story of each zone aloud while on a flight path."])
  local skipHeardRow = addCheck(aL, "skipHeard", L["Skip what you've heard"],
    L["Don't replay a narration by itself once this character has heard it. You can still play it any time."])
  local resetEntry = makeResetHeardRow(aL, function() relayout("audio") end)
  local recapsRow = addCheck(aL, "recaps", L["Storyline recaps"],
    L["At a storyline's turning points, the narrator retells what you've done so far. Never during a fight."])
  local playInCombatRow, playInCombatCb = addCheck(aL, "playInCombat", L["Keep narration playing in combat"],
    L["Keep Lore Forever narration playing and advancing through combat, including in dungeons and raids."], nil,
    function(self)
      if self:GetChecked() then
        if ns.Voice then ns.Voice.fightRelease = nil end
        if ns.UI and ns.UI.pl and ns.UI.pl.holds and ns.UI.pl.holds.fight then
          ns.UI.Release("fight")
        elseif ns.UI and ns.UI.Kick then
          ns.UI.Kick()
        end
      end
    end)
  local manualNote = makeNote(aL, L["You can still press Play or use your playlist."])
  p.manualNote = manualNote

  local questHead = makeHeading(aR, L["Quest dialogue"])
  local spokenCard = makeStatusCard(aR)
  local questVoicesLabel = tr("Lore Forever quest voices", "Speak quest dialogue")
  local questVoicesTip = rawget(L, "Hear each quest read aloud as you open it. If another add-on reads quests, this turns itself off.")
    or rawget(L, "Hear each quest page as you open it. When it's off, press the play button next to Lore on the quest window. Leave it off if another add-on reads your quests.")
    or L["Hear each quest read aloud as you open it. If another add-on reads quests, this turns itself off."]
  local questVoicesRow, questVoicesCb = addCheck(aR, "questDialogue", questVoicesLabel, questVoicesTip,
    "Speak quest dialogue", function(self)
      LoreForeverDB.settings.questDialogueTouched = true
      ns.Voice.SetQuestDialogue(self:GetChecked())
      p.Waiting()
      relayout("audio")
    end)
  local questObjectivesRow = addCheck(aR, "questObjectives", L["Narrate quest objectives"],
    L["Read quest objectives aloud right after the quest text, in the narrator's voice."],
    nil, function(self)
      if ns.Voice and ns.Voice.SetQuestObjectives then ns.Voice.SetQuestObjectives(self:GetChecked()) end
    end)

  -- Collapsible fold: Narrator and voices (full width under both columns on Audio)
  local voiceToggle = CreateFrame("Button", nil, audioTab.child)
  voiceToggle:SetHeight(26)
  local vtTopRule = fillColor(voiceToggle:CreateTexture(nil, "BORDER"), PALETTE.ruleSoft)
  vtTopRule:SetPoint("TOPLEFT"); vtTopRule:SetPoint("TOPRIGHT"); vtTopRule:SetHeight(1)
  local vtIcon = voiceToggle:CreateTexture(nil, "ARTWORK")
  vtIcon:SetSize(14, 14)
  vtIcon:SetPoint("LEFT", 2, -2)
  local vtText = voiceToggle:CreateFontString(nil, "ARTWORK", "GameFontNormal")
  vtText:SetTextColor(T.rgba(T.color.gold))
  vtText:SetPoint("LEFT", vtIcon, "RIGHT", 6, 0)
  wrapRegion(vtText)
  voiceToggle:SetHighlightTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight", "ADD")
  voiceToggle.icon = vtIcon
  voiceToggle.text = vtText

  local voiceSection, voiceContainer = Options.VoiceSection(audioTab.child, function() relayout("audio") end, function() relayout("audio") end)
  voiceSection.volume, voiceSection.volumeValue, voiceSection.volumeNote = vol.slider, vol.value, vol.note
  voiceSection.volumeLabel, voiceSection.volumeNew, voiceSection.SyncVolume = vol.label, vol.new, vol.Sync
  voiceSection.channel, voiceSection.channelList, voiceSection.channelLabel = vol.channel, vol.channelList, vol.pick
  voiceSection.channelNew = vol.channelNew
  voiceSection.toggle = voiceToggle
  voiceSection.details = voiceSection.container
  voiceSection.spokenCard = spokenCard
  voiceSection.expanded = false
  -- Move packHints checkbox from voiceSection into p.checks so SelfTest/OnShow keeps all DEFAULTS synced.
  if voiceSection.packHintsCb then
    voiceSection.packHintsCb.english = "Narration pack hints"
    voiceSection.packHintsCb.newTag = ns.WhatsNew.Tag(voiceSection.packHintsCb.row, voiceSection.packHintsCb.label, "LEFT", "RIGHT", 6, 0)
    p.checks[#p.checks + 1] = voiceSection.packHintsCb
  end
  p.voice = voiceSection
  p.resetHeard = resetEntry.button
  p.resetHeardRow = resetEntry
  voiceSection.resetHeard = resetEntry.button

  function voiceSection.SetExpanded(on)
    voiceSection.expanded = on and true or false
    vtIcon:SetTexture(voiceSection.expanded
      and "Interface\\ChatFrame\\UI-ChatIcon-ScrollDown-Up"
      or (T and T.ARROW or "Interface\\ChatFrame\\ChatFrameExpandArrow"))
    vtText:SetText(L["Narrator and voices"])
    voiceContainer:SetShown(voiceSection.expanded)
    if voiceSection.expanded then voiceSection.Update() end
    relayout("audio")
  end
  voiceToggle:SetScript("OnClick", function() voiceSection.SetExpanded(not voiceSection.expanded) end)
  voiceSection.SetExpanded(false)

  local function syncPlaybackRadios()
    local manual = LoreForeverDB and LoreForeverDB.settings and LoreForeverDB.settings.onDemand == true
    radioAuto:SetChecked(not manual)
    radioManual:SetChecked(manual)
    manualNote:SetShown(manual)
  end

  radioAuto:SetScript("OnClick", function()
    ns.Voice.SetOnDemand(false)
    syncPlaybackRadios()
    p.Waiting()
    relayout("audio")
  end)
  radioManual:SetScript("OnClick", function()
    ns.Voice.SetOnDemand(true)
    syncPlaybackRadios()
    p.Waiting()
    relayout("audio")
  end)

  local audioLeftEntries = {
    headingEntry(vol.head, 0),
    { frame = vol.sliderRow, gapAfter = 4, place = function(y, w) vol.Layout(w); vol.sliderRow:Show(); vol.sliderRow:ClearAllPoints(); vol.sliderRow:SetPoint("TOPLEFT", 0, -y); return 28 end },
    { frame = vol.chanRow, gapAfter = 4, place = function(y, w) vol.chanRow:Show(); vol.chanRow:ClearAllPoints(); vol.chanRow:SetPoint("TOPLEFT", 0, -y); return vol.chanHeight or 28 end },
    noteEntry(vol.note, 2, 6),
    noteEntry(previewWarn, 2, 6),
    headingEntry(playbackHead, 14),
    {
      frame = radioWrap,
      gapAfter = 6,
      place = function(y, w)
        radioWrap:Show()
        radioWrap:ClearAllPoints()
        radioWrap:SetPoint("TOPLEFT", 0, -y)
        local aw = strWidth(radioAuto.label, 70)
        local mw = strWidth(radioManual.label, 140)
        radioAuto:ClearAllPoints()
        radioManual:ClearAllPoints()
        if 24 + aw + 14 + 24 + mw <= w then
          radioAuto:SetPoint("TOPLEFT", 0, 0)
          radioAuto.label:SetWidth(aw + 4)
          radioManual:SetPoint("LEFT", radioAuto.label, "RIGHT", 14, 0)
          radioManual.label:SetWidth(mw + 4)
          local h = math.max(24, strHeight(radioAuto.label, 14), strHeight(radioManual.label, 14))
          radioWrap:SetSize(w, h)
          return h
        else
          radioAuto:SetPoint("TOPLEFT", 0, 0)
          radioAuto.label:SetWidth(w - 28)
          local h1 = math.max(24, strHeight(radioAuto.label, 14) + 4)
          radioManual:SetPoint("TOPLEFT", 0, -h1)
          radioManual.label:SetWidth(w - 28)
          local h2 = math.max(24, strHeight(radioManual.label, 14) + 4)
          radioWrap:SetSize(w, h1 + h2)
          return h1 + h2
        end
      end,
    },
    rowEntry(autoZoneRow),
    rowEntry(flightsRow),
    rowEntry(skipHeardRow),
    resetEntry,
    rowEntry(recapsRow),
    rowEntry(playInCombatRow),
    noteEntry(manualNote, 4, 6, function()
      return LoreForeverDB and LoreForeverDB.settings and LoreForeverDB.settings.onDemand == true
    end),
  }
  local audioRightEntries = {
    headingEntry(questHead, 0),
    {
      frame = spokenCard,
      gapAfter = 8,
      place = function(y, w)
        spokenCard:Show()
        spokenCard:ClearAllPoints()
        spokenCard:SetPoint("TOPLEFT", 0, -y)
        return spokenCard.Layout(w)
      end,
    },
    rowEntry(questVoicesRow, nil, 0, 4),
    rowEntry(questObjectivesRow, nil, 0, 4),
  }
  audioTab.layout = function(w)
    layoutColumns(audioTab, w,
      function(cw) return layoutStack(aL, audioLeftEntries, cw) end,
      function(cw) return layoutStack(aR, audioRightEntries, cw) end)
    local ww = math.max(260, (type(w) == "number" and w > 0) and w or 580)
    local fw = ww - 32
    local y = audioTab.child:GetHeight() - 8
    voiceToggle:Show()
    voiceToggle:ClearAllPoints()
    voiceToggle:SetPoint("TOPLEFT", audioTab.child, "TOPLEFT", 16, -y)
    vtText:SetWidth(math.max(120, fw - 24))
    local th = math.max(28, strHeight(vtText, 16) + 12)
    voiceToggle:SetSize(fw, th)
    y = y + th + 8
    if voiceSection.expanded then
      voiceContainer:Show()
      voiceContainer:ClearAllPoints()
      voiceContainer:SetPoint("TOPLEFT", audioTab.child, "TOPLEFT", 16, -y)
      y = y + voiceSection.Layout(fw) + 14
    else
      voiceContainer:Hide()
    end
    audioTab.child:SetHeight(y + 12)
  end

  -- =================================================================================================================
  -- TAB 2: PACKS
  -- =================================================================================================================
  local packsTab = makeTabScroll("LoreForeverOptionsScrollPacks")
  p.tabFrames.packs = packsTab
  p.packList = Options.PackList(packsTab.child)
  voiceSection.packsList = p.packList.container
  buildPacksTab(packsTab, voiceSection, p.packList)

  -- =================================================================================================================
  -- TAB 2: ON SCREEN
  -- =================================================================================================================
  local screenTab = makeTabScroll("LoreForeverOptionsScrollScreen")
  p.tabFrames.screen = screenTab
  local sL, sR = screenTab.leftCol, screenTab.rightCol

  local readingHead = makeHeading(sL, L["Reading"])
  local sizeRow = CreateFrame("Frame", nil, sL)
  local sizeLabel = sizeRow:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  wrapRegion(sizeLabel)
  sizeLabel:SetText(L["Panel size"])
  local sizeBtn, sizeList = dropDown("LoreForeverSizePick", sizeRow, 155)
  local sizeNames = { L["Small"], L["Normal"], L["Large"], L["Larger"] }
  local function sizeItems()
    local out, label = {}, nil
    local cur = tonumber(LoreForeverDB.settings.panelScale) or 1
    for i, v in ipairs(ns.UI.SCALES) do
      out[i] = { value = v, label = string.format("%s (%d%%)", sizeNames[i] or "", math.floor(v * 100 + 0.5)) }
      if v == cur then label = out[i].label end
    end
    return out, cur, label or out[2].label
  end
  function sizeBtn.Update()
    local _, _, label = sizeItems()
    sizeBtn:SetText(label)
  end
  sizeBtn:SetScript("OnClick", function()
    local all, cur = sizeItems()
    sizeList.Toggle(all, cur, function(ch)
      LoreForeverDB.settings.panelScale = ch.value
      ns.UI.ApplyScale(ch.value)
      sizeBtn.Update()
    end)
  end)
  sizeBtn.Update()

  local subtitlesRow = addCheck(sL, "subtitles", L["Subtitles"],
    L["Shows a narration's words at the bottom of the screen while the panel is closed. Shift-drag to move them."],
    nil, function(self) if ns.Subtitles then ns.Subtitles.Set(self:GetChecked()) end end)

  local subSizeRow = CreateFrame("Frame", nil, sL)
  local subSizeLabel = subSizeRow:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  wrapRegion(subSizeLabel)
  subSizeLabel:SetText(L["Subtitle size"])
  local subSizeBtn, subSizeList = dropDown("LoreForeverSubtitleSizePick", subSizeRow, 155)
  local function subSizeItems()
    local out, label = {}, nil
    local cur = ns.Subtitles.Scale()
    for i, v in ipairs(ns.Subtitles.SCALES) do
      out[i] = { value = v, label = string.format("%s (%d%%)", sizeNames[i] or "", math.floor(v * 100 + 0.5)) }
      if v == cur then label = out[i].label end
    end
    return out, cur, label or out[2].label
  end
  function subSizeBtn.Update()
    local _, _, label = subSizeItems()
    subSizeBtn:SetText(label)
  end
  subSizeBtn:SetScript("OnClick", function()
    local all, cur = subSizeItems()
    subSizeList.Toggle(all, cur, function(ch)
      ns.Subtitles.SetScale(ch.value)
      ns.Subtitles.Sample()
      subSizeBtn.Update()
    end)
  end)
  subSizeBtn.Update()

  local moveSubsBtn = themedButton(sL, L["Move subtitles"])
  moveSubsBtn:SetSize(130, 24)
  fit(moveSubsBtn, 120)
  setTip(moveSubsBtn, L["Move subtitles"], L["Drag the subtitles, the new-page note and the pin card where you want them, then click Done."])
  moveSubsBtn:SetScript("OnClick", function() ns.Move.Toggle() end)

  local resetSubsBtn = themedButton(sL, tr("Reset position", "Put them back"))
  resetSubsBtn:SetSize(130, 24)
  fit(resetSubsBtn, 120)
  resetSubsBtn:SetScript("OnClick", function() ns.Subtitles.PutBack() end)
  local subActionsRow = buttonsRow(sL, { moveSubsBtn, resetSubsBtn })
  p.moveSubtitles, p.putSubtitlesBack = moveSubsBtn, resetSubsBtn
  p.updateSize = function() sizeBtn.Update(); subSizeBtn.Update() end

  local playerHead = makeHeading(sL, L["Player"])
  local floatRow = addCheck(sL, "floatPlayer", L["Floating player"],
    L["While the panel is closed, show the narration player on screen when something plays or waits in your playlist. Drag it to move it."],
    nil, function() if ns.UI.UpdateNowPlaying then ns.UI.UpdateNowPlaying() end end)
  local reportRow = addCheck(sL, "reportCross", tr("Report button on the player", "Show the report button on the narration player"),
    L["A small cross on the player to tell us a narration sounds wrong. Right-clicking the player offers it too."],
    "Show the report button on the narration player",
    function() if ns.UI.UpdateNowPlaying then ns.UI.UpdateNowPlaying() end end)

  local inGameHead = makeHeading(sR, L["In the game"])
  local minimapRow = addCheck(sR, "minimap", L["Minimap button"],
    L["Also show a book button on the minimap. It glows green while you have new pages."],
    nil, function() if ns.MinimapButton then ns.MinimapButton() end end)
  local questBtnRow = addCheck(sR, "questButton", L["Lore button on the quest window"],
    L["A Lore button on the quest window opens the quest's story. Shift-drag it to move it."],
    nil, function()
      if ns.Hooks then
        ns.Hooks.UpdateQuestDialogButton()
        ns.Hooks.UpdateQuestPlayButton()
      end
    end)
  local pageSlipRow = addCheck(sR, "pageSlip", L["New page notes"],
    L["A short note at the top of the screen names each new page you find. Click it to open the page."])
  local moveAllBtn = themedButton(sR, L["Move things on screen..."])
  moveAllBtn:SetSize(190, 24)
  fit(moveAllBtn, 170)
  setTip(moveAllBtn, L["Move things on screen..."],
    L["Drag the subtitles, the new-page note and the pin card where you want them, then click Done."])
  moveAllBtn:SetScript("OnClick", function() ns.Move.Toggle() end)
  local moveAllRow = buttonsRow(sR, { moveAllBtn })

  local restoreHead = makeHeading(sR, L["Restore layout"])
  local windowsBtn = themedButton(sR, L["Reset windows"])
  windowsBtn:SetSize(140, 24)
  fit(windowsBtn, 120)
  setTip(windowsBtn, L["Reset windows"],
    L["Puts the panel, the player, the minimap button and every pop-up back where they started. Your journey and settings stay."])
  windowsBtn:SetScript("OnClick", function() ns.UI.ResetWindows() end)
  p.resetWindows = windowsBtn

  local questResetBtn = themedButton(sR, L["Reset quest button"])
  questResetBtn:SetSize(150, 24)
  fit(questResetBtn, 130)
  setTip(questResetBtn, L["Reset quest button"],
    L["Put the quest window's Lore button back in its own place, clear of other add-ons' buttons, after you Shift-dragged it somewhere else."])
  questResetBtn:SetScript("OnClick", function() ns.Hooks.ResetQuestButton() end)
  p.resetQuestButton = questResetBtn
  local restoreRow = buttonsRow(sR, { windowsBtn, questResetBtn })

  local function dropRowLayout(row, lbl, dd, w)
    local cw = math.max(120, math.min(165, math.floor(w * 0.48)))
    dd:SetWidth(cw)
    lbl:ClearAllPoints()
    dd:ClearAllPoints()
    local lw = strWidth(lbl, 90)
    if lw + 12 + cw <= w then
      lbl:SetPoint("LEFT", 0, 0)
      lbl:SetWidth(w - cw - 10)
      dd:SetPoint("RIGHT", 0, 0)
      local h = math.max(28, strHeight(lbl, 14) + 8)
      row:SetSize(w, h)
      return h
    else
      lbl:SetPoint("TOPLEFT", 0, 0)
      lbl:SetWidth(w)
      dd:SetPoint("TOPLEFT", lbl, "BOTTOMLEFT", 0, -4)
      local h = strHeight(lbl, 14) + 32
      row:SetSize(w, h)
      return h
    end
  end

  local screenLeftEntries = {
    headingEntry(readingHead, 0),
    { frame = sizeRow, gapAfter = 4, place = function(y, w) sizeRow:Show(); sizeRow:ClearAllPoints(); sizeRow:SetPoint("TOPLEFT", 0, -y); return dropRowLayout(sizeRow, sizeLabel, sizeBtn, w) end },
    rowEntry(subtitlesRow),
    { frame = subSizeRow, gapAfter = 6, place = function(y, w) subSizeRow:Show(); subSizeRow:ClearAllPoints(); subSizeRow:SetPoint("TOPLEFT", 0, -y); return dropRowLayout(subSizeRow, subSizeLabel, subSizeBtn, w) end },
    { frame = subActionsRow, gapAfter = 10, place = function(y, w) subActionsRow:Show(); subActionsRow:ClearAllPoints(); subActionsRow:SetPoint("TOPLEFT", 0, -y); return subActionsRow.Layout(w) end },
    headingEntry(playerHead, 10),
    rowEntry(floatRow),
    rowEntry(reportRow),
  }
  local screenRightEntries = {
    headingEntry(inGameHead, 0),
    rowEntry(minimapRow),
    rowEntry(questBtnRow),
    rowEntry(pageSlipRow, nil, 0, 6),
    { frame = moveAllRow, gapAfter = 10, place = function(y, w) moveAllRow:Show(); moveAllRow:ClearAllPoints(); moveAllRow:SetPoint("TOPLEFT", 0, -y); return moveAllRow.Layout(w) end },
    headingEntry(restoreHead, 10),
    { frame = restoreRow, gapAfter = 6, place = function(y, w) restoreRow:Show(); restoreRow:ClearAllPoints(); restoreRow:SetPoint("TOPLEFT", 0, -y); return restoreRow.Layout(w) end },
  }
  screenTab.layout = function(w)
    layoutColumns(screenTab, w,
      function(cw) return layoutStack(sL, screenLeftEntries, cw) end,
      function(cw) return layoutStack(sR, screenRightEntries, cw) end)
  end

  -- =================================================================================================================
  -- TAB 3: KEYS
  -- =================================================================================================================
  local keysTab = makeTabScroll("LoreForeverOptionsScrollKeys")
  p.tabFrames.keys = keysTab
  local kL, kR = keysTab.leftCol, keysTab.rightCol

  local keyPanelHead = makeHeading(kL, L["Panel"])
  local keyNarrationHead = makeHeading(kL, L["Narration"])
  local keyJourneyHead = makeHeading(kR, L["Journey"])
  local keyWilloHead = makeHeading(kR, ns.COMPANION_NAME)

  local keyRows = {}
  local function makeKeyRow(parent, label, binding, which, willoOnly, subtext)
    local row = CreateFrame("Frame", nil, parent)
    local actionCol
    if which then
      actionCol = themedButton(row, L["Set..."])
      actionCol:SetSize(66, 22)
      fit(actionCol, 64)
      actionCol:SetScript("OnClick", function() ns.Hooks.KeyPrompt(which):Show() end)
    else
      actionCol = row:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
      actionCol:SetTextColor(T.rgba(T.color.muted))
      actionCol:SetText(L["Set in %s"]:format(ns.COMPANION_NAME))
      actionCol:SetJustifyH("RIGHT")
    end
    actionCol:SetPoint("TOPRIGHT", 0, -2)

    local badge = CreateFrame("Frame", nil, row)
    fillColor(badge:CreateTexture(nil, "BACKGROUND"), PALETTE.kbdBg):SetAllPoints()
    makeBorder(badge, PALETTE.kbdRim, 1)
    local shown = badge:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    shown:SetPoint("CENTER", 0, 0)
    shown:SetJustifyH("CENTER")
    badge:SetSize(64, 22)
    badge:SetPoint("RIGHT", actionCol, "LEFT", -8, 0)

    local name = row:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    wrapRegion(name)
    name:SetPoint("TOPLEFT", 0, -3)
    name:SetText(label)

    local sub
    if subtext and subtext ~= "" then
      sub = row:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
      sub:SetTextColor(T.rgba(T.color.muted))
      wrapRegion(sub)
      sub:SetPoint("TOPLEFT", name, "BOTTOMLEFT", 0, -2)
      sub:SetText(subtext)
    end

    local entry = {
      frame = row,
      name = name,
      sub = sub,
      badge = badge,
      shown = shown,
      set = actionCol,
      binding = binding,
      willoOnly = willoOnly,
    }
    function entry.Layout(w)
      local aw = which and (tonumber(actionCol:GetWidth()) or 66) or math.min(math.max(60, w - 70), strWidth(actionCol, 76))
      local kw = math.max(54, math.min(115, strWidth(shown, 42) + 16))
      badge:SetSize(kw, 22)
      local sideLw = w - aw - kw - 18
      if name.SetNonSpaceWrap then name:SetNonSpaceWrap(false) end
      if sub and sub.SetNonSpaceWrap then sub:SetNonSpaceWrap(false) end

      local sideFits = sideLw >= 100
      if sideFits then
        name:SetWidth(sideLw)
        if name.IsTruncated and name:IsTruncated() then sideFits = false end
        if sideFits and sub then
          sub:SetWidth(sideLw)
          if sub.IsTruncated and sub:IsTruncated() then sideFits = false end
        end
      end

      if sideFits then
        name:ClearAllPoints()
        name:SetPoint("TOPLEFT", 0, -3)
        name:SetWidth(sideLw)
        actionCol:ClearAllPoints()
        actionCol:SetPoint("TOPRIGHT", row, "TOPRIGHT", 0, which and -2 or -6)
        badge:ClearAllPoints()
        badge:SetPoint("TOPRIGHT", row, "TOPRIGHT", -(aw + 8), -2)
        local h = strHeight(name, 14) + 6
        if sub then
          sub:SetWidth(sideLw)
          h = h + strHeight(sub, 12) + 3
        end
        h = math.max(28, h)
        row:SetSize(w, h)
        return h
      else
        name:ClearAllPoints()
        name:SetPoint("TOPLEFT", 0, -3)
        name:SetWidth(w)
        if name.IsTruncated and name:IsTruncated() and name.SetNonSpaceWrap then
          name:SetNonSpaceWrap(true)
        end
        local textH = strHeight(name, 14) + 4
        if sub then
          sub:SetWidth(w)
          if sub.IsTruncated and sub:IsTruncated() and sub.SetNonSpaceWrap then
            sub:SetNonSpaceWrap(true)
          end
          textH = textH + strHeight(sub, 12) + 3
        end
        local ctrlY = textH + 2
        actionCol:ClearAllPoints()
        actionCol:SetPoint("TOPRIGHT", row, "TOPRIGHT", 0, which and -ctrlY or -(ctrlY + 4))
        badge:ClearAllPoints()
        badge:SetPoint("TOPRIGHT", row, "TOPRIGHT", -(aw + 8), -ctrlY)
        local h = ctrlY + 24
        row:SetSize(w, h)
        return h
      end
    end
    keyRows[#keyRows + 1] = entry
    return entry
  end

  local rToggle = makeKeyRow(kL, L["Toggle Lore Forever panel"], "LOREFOREVER_TOGGLE", "toggle")
  local rNarrate = makeKeyRow(kL, L["Play narration"], "LOREFOREVER_NARRATE", "narrate")
  local rPlaylist = makeKeyRow(kL, tr("Play or pause playlist", "Play/pause narration playlist"), "LOREFOREVER_PLAYLIST", "playlist")
  local rNext = makeKeyRow(kL, L["Next narration"], "LOREFOREVER_PLAYLIST_NEXT", "playlistNext")
  local rStop = makeKeyRow(kL, L["Stop narration"], "LOREFOREVER_STOP", "stop")
  local rClear = makeKeyRow(kL, tr("Clear waiting narration", "Clear waiting narration (keeps what you added)"),
    "LOREFOREVER_CLEARWAITING", "clearWaiting", false, L["Keeps what you added"])
  local rPicture = makeKeyRow(kR, L["Take a journey picture"], "LOREFOREVER_PICTURE", "picture")
  local rSky = makeKeyRow(kR, L["Show %s's sky"]:format(ns.COMPANION_NAME), "LOREFOREVER_SKY", "sky", true)
  local rTalk = makeKeyRow(kR, L["Talk to %s"]:format(ns.COMPANION_NAME), "LOREFOREVER_ASKWILLO", nil, true)
  local rTarget = makeKeyRow(kR, L["Their key"], "LOREFOREVER_ASKTARGET", nil, true)

  local function keyEntry(kr)
    return {
      frame = kr.frame,
      gapAfter = 4,
      shown = function() return ns.Companion.Installed() or not kr.willoOnly end,
      place = function(y, w)
        kr.frame:Show()
        kr.frame:ClearAllPoints()
        kr.frame:SetPoint("TOPLEFT", 0, -y)
        return kr.Layout(w)
      end,
    }
  end

  local keysLeftEntries = {
    headingEntry(keyPanelHead, 0),
    keyEntry(rToggle),
    headingEntry(keyNarrationHead, 14),
    keyEntry(rNarrate),
    keyEntry(rPlaylist),
    keyEntry(rNext),
    keyEntry(rStop),
    keyEntry(rClear),
  }
  local keysRightEntries = {
    headingEntry(keyJourneyHead, 0),
    keyEntry(rPicture),
    {
      frame = keyWilloHead,
      gapBefore = 14,
      gapAfter = 6,
      shown = function() return ns.Companion.Installed() end,
      place = function(y, w)
        keyWilloHead:Show()
        keyWilloHead:ClearAllPoints()
        keyWilloHead:SetPoint("TOPLEFT", 0, -y)
        keyWilloHead:SetWidth(w)
        return strHeight(keyWilloHead, 16)
      end,
    },
    keyEntry(rSky),
    keyEntry(rTalk),
    keyEntry(rTarget),
  }
  keysTab.layout = function(w)
    layoutColumns(keysTab, w,
      function(cw) return layoutStack(kL, keysLeftEntries, cw) end,
      function(cw) return layoutStack(kR, keysRightEntries, cw) end)
  end

  function p.updateKeys()
    local installed = ns.Companion.Installed()
    for _, kr in ipairs(keyRows) do
      local on = installed or not kr.willoOnly
      kr.frame:SetShown(on)
      kr.name:SetShown(on)
      kr.shown:SetShown(on)
      kr.set:SetShown(on)
      local key = GetBindingKey and GetBindingKey(kr.binding, true)
      local text = key and GetBindingText and GetBindingText(key) or key
      kr.shown:SetText(text and text:gsub("|", "||") or L["None"])
      kr.shown:SetTextColor(T.rgba(key and T.color.tipText or T.color.muted))
    end
    relayout("keys")
  end

  -- =================================================================================================================
  -- TAB 4: WILLO
  -- =================================================================================================================
  local willoTab = makeTabScroll("LoreForeverOptionsScrollWillo")
  p.tabFrames.willo = willoTab
  local wL, wR = willoTab.leftCol, willoTab.rightCol

  local willoIntroNote = makeNote(wL, "")
  local liveHead = makeHeading(wL, L["Live game info"])
  local liveCard = makeStatusCard(wL)
  -- SelfTest checks p.liveLine:GetText() against the Live game info status string.
  p.liveLine = liveCard.title
  p.liveWhere = liveCard.copy

  local liveBtn = themedButton(wL, L["Turn off live game info"])
  liveBtn:SetSize(160, 24)
  fit(liveBtn, 150)
  liveBtn:SetScript("OnClick", function()
    ns.Strip.Choose(not ns.Strip.On())
    p.updateWillo()
  end)
  liveBtn:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(self:GetText())
    T.Tip(ns.Strip.On()
      and L["Live game info off: %s's sky no longer shows in the game. Same as /lore live."]:format(ns.COMPANION_NAME)
      or L["Live game info on again, as you said yes to it in %s."]:format(ns.COMPANION_NAME), "tipText", true)
    GameTooltip:Show()
  end)
  liveBtn:SetScript("OnLeave", function() GameTooltip:Hide() end)
  p.liveButton = liveBtn
  local liveBtnRow = buttonsRow(wL, { liveBtn })

  local skyHead = makeHeading(wL, L["%s's sky"]:format(ns.COMPANION_NAME))
  local skyRow, updateSkyRow = ns.Sky.OptionsRow(wL, skyHead)
  skyRow:ClearAllPoints()
  if skyRow.move then skyRow.move:SetParent(skyRow) end
  if skyRow.back then skyRow.back:SetParent(skyRow) end
  local talkMarkRow, talkMarkCb = addCheck(wL, "talkMark", L["Show who can answer you"],
    L["When you target someone who can answer, a small mark shows which key to hold to ask them. Right-click it to hide it."],
    nil, function() if ns.TalkMark then ns.TalkMark.Update() end end)
  p.willoChecks[#p.willoChecks + 1] = talkMarkCb

  local picsHead = makeHeading(wR, L["Journey pictures"])
  local hideUIRow, hideUICb = addCheck(wR, "pictureHideUI",
    tr("Hide the interface for journey pictures", "Hide the interface when taking a journey picture"),
    L["Hides your interface for a moment when a journey picture is taken. Turn on Picture book in %s to keep them."]:format(ns.COMPANION_NAME)
      .. " " .. L["Print Screen takes a normal WoW screenshot. For a journey picture, use /lore picture or give Take a journey picture a key under Keys. Except in combat."],
    "Hide the interface when taking a journey picture")
  p.willoChecks[#p.willoChecks + 1] = hideUICb

  local autoPicsRow, autoPicsCb = addCheck(wR, "automaticPictures", L["Automatic journey pictures"],
    L["Takes a journey picture when you level up, beat a boss or reach a new zone. At most ten a day."])
  p.willoChecks[#p.willoChecks + 1] = autoPicsCb

  local picsHelp = makeNote(wR, L["Picture book in Willo keeps your journey pictures."])

  local getWilloRow, getWilloCb
  if ns.Companion and ns.Companion.OFFER_WILLO then
    getWilloRow, getWilloCb = addCheck(wR, "getWillo", L["Suggest %s"]:format(ns.COMPANION_NAME),
      L["Until you install %s, shows her icon beside Journey and a chat line about her when Lore Forever has no answer. Untick to hide both."]:format(ns.COMPANION_NAME),
      nil, function() if ns.UI.UpdateWilloIcon then ns.UI.UpdateWilloIcon() end end)
  end

  local willoLeftEntries = {
    noteEntry(willoIntroNote, 0, 10),
    headingEntry(liveHead, 4),
    {
      frame = liveCard,
      gapAfter = 8,
      shown = function() return ns.Companion.Installed() or ns.Companion.OFFER_WILLO end,
      place = function(y, w)
        liveCard:Show()
        liveCard:ClearAllPoints()
        liveCard:SetPoint("TOPLEFT", 0, -y)
        return liveCard.Layout(w)
      end,
    },
    {
      frame = liveBtnRow,
      gapAfter = 10,
      shown = function() return liveBtn:IsShown() end,
      place = function(y, w)
        liveBtnRow:Show()
        liveBtnRow:ClearAllPoints()
        liveBtnRow:SetPoint("TOPLEFT", 0, -y)
        return liveBtnRow.Layout(w)
      end,
    },
    headingEntry(skyHead, 10),
    {
      frame = skyRow,
      gapAfter = 6,
      shown = function() return ns.Companion.Installed() or ns.Companion.OFFER_WILLO end,
      place = function(y, w)
        skyRow:Show()
        skyRow:ClearAllPoints()
        skyRow:SetPoint("TOPLEFT", 0, -y)
        local sh = 28
        if skyRow.move and skyRow.back then
          local mw = tonumber(skyRow.move.GetWidth and skyRow.move:GetWidth()) or 190
          local bw = tonumber(skyRow.back.GetWidth and skyRow.back:GetWidth()) or 130
          skyRow.move:ClearAllPoints()
          skyRow.move:SetPoint("TOPLEFT", skyRow, "TOPLEFT", 0, 0)
          skyRow.back:ClearAllPoints()
          if mw + 10 + bw <= w then
            skyRow.back:SetPoint("LEFT", skyRow.move, "RIGHT", 10, 0)
          else
            skyRow.back:SetPoint("TOPLEFT", skyRow.move, "BOTTOMLEFT", 0, -6)
            sh = 58
          end
        end
        skyRow:SetSize(w, sh)
        return sh
      end,
    },
    rowEntry(talkMarkRow, function() return ns.Companion.Installed() or ns.Companion.OFFER_WILLO end),
  }
  local willoRightEntries = {
    headingEntry(picsHead, 0),
    rowEntry(hideUIRow, function() return ns.Companion.Installed() or ns.Companion.OFFER_WILLO end),
    rowEntry(autoPicsRow, function()
      return (ns.Companion.Installed() or ns.Companion.OFFER_WILLO) and ns.Journey and ns.Journey.PictureBookOn and ns.Journey.PictureBookOn()
    end),
    noteEntry(picsHelp, 2, 10),
  }
  if getWilloRow then
    willoRightEntries[#willoRightEntries + 1] = rowEntry(getWilloRow, function() return ns.Companion.OFFER_WILLO and true or false end, 8, 4)
  end
  willoTab.layout = function(w)
    layoutColumns(willoTab, w,
      function(cw) return layoutStack(wL, willoLeftEntries, cw) end,
      function(cw) return layoutStack(wR, willoRightEntries, cw) end)
  end

  function p.updateWillo()
    local on = ns.Companion.Installed()
    local shown = on or (ns.Companion.OFFER_WILLO and true or false)
    if on then
      willoIntroNote:SetText(string.format(L["These work with %s, Lore Forever's companion app on this PC."], ns.COMPANION_NAME))
    elseif ns.Companion.OFFER_WILLO then
      willoIntroNote:SetText(string.format(L["Needs %s, Lore Forever's free companion app (%s). Installed it? Type /reload."],
        ns.COMPANION_NAME, ns.Companion.WILLO_URL))
    else
      willoIntroNote:SetText(string.format(L["%s is not installed on this PC."], ns.COMPANION_NAME))
    end

    local live = ns.Strip.On()
    local liveText = not live and L["Live game info: off"]
      or ns.Strip.Always() and L["Live game info: on, sky kept up"]
      or L["Live game info: on, sky hidden until you talk to %s"]:format(ns.COMPANION_NAME)
    local here = live and (not on or not ns.Strip.OnFromWillo()) or not live and ns.Strip.OnFromWillo()
    local whereText = live and here and ""
      or not live and here and L["You turned it off in the game."]
      or L["You set this in %s: Settings › What she can see."]:format(ns.COMPANION_NAME)

    liveCard.SetState(live and "teal" or "neutral", liveText, whereText)
    liveCard:SetShown(shown)
    liveBtn:SetText(live and L["Turn off live game info"] or L["Turn live game info back on"])
    fit(liveBtn, 150)
    liveBtn:SetShown(shown and (live or here) and true or false)

    updateSkyRow(shown, on)
    local blockedByWillo = not on and string.format(L["Needs %s."], ns.COMPANION_NAME) or nil
    talkMarkRow.SetBlocked(blockedByWillo)
    hideUIRow.SetBlocked(blockedByWillo)
    autoPicsRow.SetBlocked(blockedByWillo)
    local showAutoPics = shown and ns.Journey and ns.Journey.PictureBookOn and ns.Journey.PictureBookOn()
    autoPicsRow:SetShown(showAutoPics and true or false)
    picsHelp:SetShown(shown)
    if getWilloRow then getWilloRow.SetBlocked(nil) end
    relayout("willo")
  end
  p.willoNote = willoIntroNote

  -- =================================================================================================================
  -- TAB 5: GENERAL
  -- =================================================================================================================
  local generalTab = makeTabScroll("LoreForeverOptionsScrollGeneral")
  p.tabFrames.general = generalTab
  local gL, gR = generalTab.leftCol, generalTab.rightCol

  local langHead = makeHeading(gL, L["Language"])
  local langPickRow = CreateFrame("Frame", nil, gL)
  local langLabel = langPickRow:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  wrapRegion(langLabel)
  langLabel:SetText(L["Add-on language"])
  local langBtn, langList = dropDown("LoreForeverLanguagePick", langPickRow, 175)
  local langHint = makeNote(gL, L["Automatic follows your WoW client's language. A contributor edition switches its text and narration together. Reload to apply your selection."])
  local langUrl = urlRow(gL, L["Get more languages:"], LANGUAGES_URL)

  local function langItems()
    local out, id = {}, ns.Lang.Selected()
    local label
    for _, ch in ipairs(ns.Lang.Choices()) do
      out[#out + 1] = { value = ch.id, label = ch.label, why = ch.reason }
      if ch.id == id then label = ch.label end
    end
    return out, id, label or (out[1] and out[1].label) or ""
  end
  function p.updateLanguage()
    local _, _, label = langItems()
    langBtn:SetText(label)
    if ns.lang and ns.lang.editionUnavailable then
      langHint:SetText(L["Edition unavailable. Install or enable both matching components, then reload, or select another edition or stock language here."])
    end
    langUrl.fill()
    if InCombatLockdown and InCombatLockdown() then return end
    local pending = ns.Lang.NeedsReload()
    if pending then
      local ui = ns.Lang.StringsFor(ns.Lang.Resolve())
      reload:SetText(ui and (ui["Reload now"] or "Reload now") or L["Reload now"])
      fit(reload, 120)
    end
    reload:SetShown(pending)
  end
  langBtn:SetScript("OnClick", function()
    local all, id = langItems()
    langList.Toggle(all, id, function(ch)
      ns.Lang.Set(ch.value)
      p.updateLanguage()
    end)
  end)
  p.language, p.languageList = langBtn, langList

  local storiesHead = makeHeading(gL, L["Stories and hints"])
  local storylinesRow = addCheck(gL, "storylines", L["Show storylines on quests"],
    L["When a quest is part of a storyline, say so under its title and at the top of its story."],
    nil, function()
      if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end
      if ns.Hooks and ns.Hooks.RefreshQuestStory then ns.Hooks.RefreshQuestStory() end
    end)
  local storylineChatRow = addCheck(gL, "storylineChat", L["Storyline hints in chat"],
    L["When you turn in a storyline quest, chat says who to see next."])
  local zoneNudgeRow = addCheck(gL, "zoneNudge", L["Zone hints"],
    L["When you enter a zone, suggest a question about it in chat."])
  local dungeonRow = addCheck(gL, "dungeonPrimer", L["Dungeon primer prompt"],
    L["When you enter a dungeon, link its primer in chat, and each boss's story once you beat them."])
  local spoilersRow = addCheck(gL, "showSpoilers", L["Tell me everything"],
    L["Story passages and answers that give away what's ahead wait until your quests reach them. Tick this to see and hear the whole story now."],
    nil, function() if ns.UI and ns.UI.UpdateListen then ns.UI.UpdateListen() end end)
  local npcTipRow = addCheck(gL, "unitTooltips", L["Lore on NPC tooltips"],
    L["Add a one-line story to the tooltip of NPCs and mobs."])
  local itemTipRow = addCheck(gL, "itemTooltips", L["Notes on item tooltips"],
    L["Say when an item is wanted for a quest or starts one."])

  local journeyHead = makeHeading(gR, L["Journey and contributions"])
  local journeyRow = addCheck(gR, "journey", L["Remember my journey"],
    L["Keeps track of the places, people, foes and quests of your journey, for your journey page. It stays on your PC."],
    nil, function() if ns.Journey then ns.Journey.OnToggle() end end)
  local captureRow = addCheck(gR, "capture", L["Keep the quest text you see"],
    L["Keeps the quest and book text you see, so you can share what we're missing at loreforeverwow.com/contribute. It stays on your PC until then."])
  local contribRow = addCheck(gR, "contributeButtons", L["Contribute buttons"],
    L["A small button on quest, gossip and book windows whose text Lore Forever doesn't have yet. Click it for a link to share that text."],
    nil, function() if ns.Capture then ns.Capture.UpdateAll() end end)
  local captureNote = makeNote(gR, L["Saved text stays on your computer until you share it."])
  local sentBtn = themedButton(gR, L["Mark shared text as sent"])
  sentBtn:SetSize(180, 24)
  fit(sentBtn, 160)
  setTip(sentBtn, L["Mark shared text as sent"],
    L["After sharing text at loreforeverwow.com/contribute, mark it as sent so the next upload carries only new lines."]:format(ns.COMPANION_NAME))
  sentBtn:SetScript("OnClick", function()
    local n = ns.Capture and ns.Capture.MarkAllSent() or 0
    DEFAULT_CHAT_FRAME:AddMessage(T.CHAT_PREFIX .. string.format(n == 1
      and L["%d line marked as sent; your next upload only carries what's new."]
      or L["%d lines marked as sent; your next upload only carries what's new."], n))
  end)
  p.markSent = sentBtn
  local sentRow = buttonsRow(gR, { sentBtn })

  local noticesHead = makeHeading(gR, L["Answers and notices"])
  local typingRow = addCheck(gR, "typing", L["Typing animation"],
    L["Answers type in quickly. Click an answer to show it all at once."])
  local chatLinksRow = addCheck(gR, "chatLinks", L["Clickable names in answers"],
    L["Names of places, people and events in an answer open their own story. Shift-click one to add it to your playlist."])
  local tipsRow = addCheck(gR, "tips", L["Tips at login"],
    L["Now and then at login, a tip in chat about something Lore Forever can do."])
  local updateRow = addCheck(gR, "updateNotice", L["Tell me when a new version is out"],
    L["One chat line when a newer Lore Forever is out, with how to update. At most once every two weeks."]:format(ns.COMPANION_NAME))

  local generalLeftEntries = {
    headingEntry(langHead, 0),
    { frame = langPickRow, gapAfter = 4, place = function(y, w) langPickRow:Show(); langPickRow:ClearAllPoints(); langPickRow:SetPoint("TOPLEFT", 0, -y); return dropRowLayout(langPickRow, langLabel, langBtn, w) end },
    noteEntry(langHint, 2, 6),
    { frame = langUrl, gapAfter = 10, place = function(y, w) langUrl:Show(); langUrl:ClearAllPoints(); langUrl:SetPoint("TOPLEFT", 0, -y); return langUrl.Layout(w) end },
    headingEntry(storiesHead, 10),
    rowEntry(storylinesRow),
    rowEntry(storylineChatRow),
    rowEntry(zoneNudgeRow),
    rowEntry(dungeonRow),
    rowEntry(spoilersRow),
    rowEntry(npcTipRow),
    rowEntry(itemTipRow),
  }
  local generalRightEntries = {
    headingEntry(journeyHead, 0),
    rowEntry(journeyRow),
    rowEntry(captureRow),
    rowEntry(contribRow),
    noteEntry(captureNote, 2, 6),
    { frame = sentRow, gapAfter = 10, place = function(y, w) sentRow:Show(); sentRow:ClearAllPoints(); sentRow:SetPoint("TOPLEFT", 0, -y); return sentRow.Layout(w) end },
    headingEntry(noticesHead, 10),
    rowEntry(typingRow),
    rowEntry(chatLinksRow),
    rowEntry(tipsRow),
    rowEntry(updateRow),
  }
  generalTab.layout = function(w)
    layoutColumns(generalTab, w,
      function(cw) return layoutStack(gL, generalLeftEntries, cw) end,
      function(cw) return layoutStack(gR, generalRightEntries, cw) end)
  end

  -- =================================================================================================================
  -- WAITING / SPOKEN STATUS / TAB SELECTION
  -- =================================================================================================================
  function p.Waiting()
    local manual = LoreForeverDB and LoreForeverDB.settings and LoreForeverDB.settings.onDemand == true
    local autoReason = manual and L["Available with Automatic playback."] or nil
    autoZoneRow.SetBlocked(autoReason)
    flightsRow.SetBlocked(autoReason)

    local qStatus = ns.Voice and ns.Voice.QuestDialogueStatus and ns.Voice.QuestDialogueStatus()
    local objReason
    if qStatus then
      spokenCard.SetState(qStatus.tone, qStatus.title, qStatus.copy)
      questVoicesRow.SetBlocked(qStatus.blockedReason)
      objReason = qStatus.blockedReason
    else
      questVoicesRow.SetBlocked(autoReason)
      objReason = autoReason
    end
    if not objReason and not (ns.Voice and ns.Voice.QuestDialogue and ns.Voice.QuestDialogue()) then
      objReason = string.format(L["Available with %s."], questVoicesLabel)
    end
    questObjectivesRow.SetBlocked(objReason)

    local willoKeeps = ns.Updates and ns.Updates.WilloKeeps and ns.Updates.WilloKeeps()
    updateRow.SetBlocked(willoKeeps and L["%s keeps this up to date."]:format(ns.COMPANION_NAME) or nil)
    syncPlaybackRadios()
  end

  local function styleTab(btn, selected)
    if btn.bg then btn.bg:SetShown(selected) end
    if btn.bar then btn.bar:SetShown(selected) end
    if btn.label then
      btn.label:SetTextColor(T.rgba(selected and T.color.gold or PALETTE.sub))
    end
    btn.selected = selected and true or false
  end

  function p.SelectTab(key)
    local valid = false
    for _, spec in ipairs(tabSpecs) do
      if spec.key == key then valid = true break end
    end
    if not valid then key = "audio" end

    local prev = Options.activeTab
    if prev == "audio" and key ~= "audio" and ns.Voice and ns.Voice.StopPreview then
      ns.Voice.StopPreview()
    end
    closeAllLists()
    Options.activeTab = key

    for _, spec in ipairs(tabSpecs) do
      local active = spec.key == key
      local btn = p.tabs[spec.key]
      local tf = p.tabFrames[spec.key]
      styleTab(btn, active)
      tf.sf:SetShown(active)
      if active then
        if spec.key == "audio" then
          vol.Sync()
          p.Waiting()
          if voiceSection.expanded then voiceSection.Update() end
        elseif spec.key == "packs" then
          voiceSection.Update()
          p.packList.Update()
        elseif spec.key == "screen" then
          p.updateSize()
        elseif spec.key == "keys" then
          p.updateKeys()
        elseif spec.key == "willo" then
          p.updateWillo()
        elseif spec.key == "general" then
          p.updateLanguage()
          p.Waiting()
        end
        relayout(spec.key)
      end
    end
  end
  Options.SelectTab = function(key)
    if Options.panel then Options.panel.SelectTab(key) else Options.activeTab = key end
  end
  Options.CurrentTab = function() return Options.activeTab or "audio" end

  for i, spec in ipairs(tabSpecs) do
    local btn = CreateFrame("Button", nil, tabBar)
    btn.key = spec.key
    btn.bg = fillColor(btn:CreateTexture(nil, "BACKGROUND"), PALETTE.tabActive)
    btn.bg:SetAllPoints()
    btn.bg:Hide()
    btn.bar = fillColor(btn:CreateTexture(nil, "OVERLAY"), T.color.gold)
    btn.bar:SetPoint("BOTTOMLEFT"); btn.bar:SetPoint("BOTTOMRIGHT"); btn.bar:SetHeight(2)
    btn.bar:Hide()
    local hi = fillColor(btn:CreateTexture(nil, "HIGHLIGHT"), PALETTE.tabHover)
    hi:SetAllPoints()
    local lbl = btn:CreateFontString(nil, "ARTWORK", "GameFontNormal")
    lbl:SetPoint("CENTER", 0, 0)
    lbl:SetJustifyH("CENTER")
    lbl:SetText(spec.label)
    btn.label = lbl
    btn:SetScript("OnClick", function() p.SelectTab(spec.key) end)
    p.tabs[spec.key] = btn
    p.tabList[i] = btn

    local tf = p.tabFrames[spec.key]
    tf.sf:SetScript("OnSizeChanged", function(_, w)
      if tf.sf:IsShown() and type(w) == "number" and w > 0 then relayout(spec.key) end
    end)
  end
  layoutTabs(600)

  p:SetScript("OnSizeChanged", function(_, w)
    layoutTabs(w)
    relayout(Options.CurrentTab())
  end)

  -- Pre-make voice and pack rows at login (never on an open window: LOR-481 gamepad taint).
  p.voice.MakeRows(#ns.Packs.List("voice") + 1)
  p.packList.MakeRows(#ns.Packs.registry + 1)
  p.updateWillo()

  p:SetScript("OnShow", function(self)
    for _, cb in ipairs(self.checks) do
      cb:SetChecked(LoreForeverDB.settings[cb.key] and true or false)
      if cb.newTag then cb.newTag:SetShown(ns.WhatsNew.OptionIsNew(cb.english)) end
    end
    self.Waiting()
    self.updateWillo()
    self.updateKeys()
    self.voice.ShowNew()
    ns.WhatsNew.Seen("options")
    self.updateLanguage()
    self.updateSize()
    self.voice.Update()
    layoutTabs(tonumber(self.GetWidth and self:GetWidth()) or 600)
    self.SelectTab(Options.activeTab or "audio")
  end)

  p:SetScript("OnHide", function()
    closeAllLists()
    if ns.Voice and ns.Voice.StopPreview then ns.Voice.StopPreview() end
    resetEntry.clear()
  end)

  if _G.Settings and Settings.RegisterCanvasLayoutCategory then
    local cat = Settings.RegisterCanvasLayoutCategory(p, "Lore Forever")
    Settings.RegisterAddOnCategory(cat)
    Options.category = cat
  elseif _G.InterfaceOptions_AddCategory then
    InterfaceOptions_AddCategory(p)
  end
  Options.panel = p
  return p
end

-- Voice.Preview / Voice.Stop: a sample started or stopped. Relabels the Sample buttons if the page exists.
function Options.OnPreviewChanged()
  local voice = Options.panel and Options.panel.voice
  if voice and voice.UpdateSamples then voice.UpdateSamples() end
end

-- The game changed one of its settings (CVAR_UPDATE: System > Sound, a /console command, another add-on, or our own
-- slider). Which one isn't read, since clients pass different arguments: the Voice volume slider shows the chosen
-- channel's volume again, and whether the game has that channel switched on.
function Options.OnCVarUpdate()
  local voice = Options.panel and Options.panel.voice
  if voice and voice.SyncVolume then voice.SyncVolume() end
end

function Options.Open()
  if InCombatLockdown and InCombatLockdown() then
    DEFAULT_CHAT_FRAME:AddMessage(T.CHAT_PREFIX .. L["options open after combat."])
    return
  end
  local cat = Options.category
  if cat and _G.Settings and Settings.OpenToCategory then
    Settings.OpenToCategory(cat.GetID and cat:GetID() or cat)
  elseif _G.InterfaceOptionsFrame_OpenToCategory and Options.panel then
    InterfaceOptionsFrame_OpenToCategory(Options.panel)
  end
end

-- Right-click on the minimap button: close the settings window if it's showing Lore Forever's page,
-- otherwise open it there (also when it's open on another add-on's page). With the controller interface on it only
-- opens (the controller's Back closes it): a window closed from our code taints the controller (LOR-481). Opening is
-- safe either way, as the game opens the window itself (SETTINGS_PANEL_OPEN).
function Options.Toggle()
  local p, win = Options.panel, _G.SettingsPanel or _G.InterfaceOptionsFrame
  if p and win and win:IsShown() and p:IsVisible() and _G.HideUIPanel and not ns.Context.GamepadUI() then
    return HideUIPanel(win)
  end
  Options.Open()
end
