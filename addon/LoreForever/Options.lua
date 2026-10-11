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
  storylineChat = true,    -- turning in a storyline quest names who gives the next one (Storyline.OnTurnIn)
  floatPlayer = true,      -- the narration player floats on screen while the panel is closed (UI.UpdateNowPlaying)
  reportCross = true,      -- a cross on the narration player that reports the recording (ClipReport.lua, LOR-232);
                           -- the player's right-click menu offers it either way (turned on once for older installs:
                           -- Log.Init's featuresOn)
  minimap = true,          -- minimap button (turned on once for installs from before it was the default: Log.Init)
  typing = true,           -- answers type in quickly instead of appearing at once
  chatLinks = true,        -- names of other entries in answers are links (UI.Linker), Back / Forward above the chat
  showSpoilers = false,    -- show answers marked as spoilers without asking first
  -- (No "Read aloud": only recordings play, never the game's text-to-speech. Log.Init forgets the old setting.)
  narrateFlights = false,  -- play each zone's recorded story on taxi flights (Voice.OnTaxiCheck)
  onDemand = false,        -- "Narration: only when I press Play" (LOR-138): nothing plays by itself (Voice.OnDemand)
  autoZone = true,         -- play a zone's or place's recorded narration on arriving there (Voice.OnArrive)
  questDialogue = false,   -- opt in to direct quest dialogue, including quest-window Play (Voice.QuestDialogue)
  -- A book, letter or plaque page's recording as it opens (Voice.ReadBookPage). No book has one yet, so Options has no
  -- switch for it; another add-on that reads books turns it off (Voice.CheckSpoken, Voice.CheckQuestVoices).
  readBooks = true,
  skipHeard = true,        -- don't play automatically what this character has heard (LoreForeverDB.heard)
  packHints = true,        -- say (once a session per zone) when its places and people are in a lands pack you lack
  tips = true,             -- one tip at login about a feature (Core.lua loginTip), until they run out
  journey = true,          -- "Remember my journey": record places, people, quests and foes for Journey
  pictureHideUI = true,    -- the journey picture key hides the interface for its picture, out of combat (Journey.lua)
  -- Pictures at milestones (Journey.MilestonePicture): a level, a boss, a first zone or dungeon, with the companion's
  -- picture book on. Never in combat or on a flight, ten a day at most.
  automaticPictures = true,
  capture = true,          -- keep the quest, gossip and book text Forever shows, to share at /contribute (Capture.lua)
  -- Live game info: a tiny block of coloured cells in the top-left corner that the companion app reads (Strip.lua,
  -- LOR-416). Opt-in: it shows on screen, and the companion has its own switch for reading it.
  liveStrip = false,
  -- The small Contribute button on quest, gossip and book windows (Capture.lua). Defaults are written into
  -- SavedVariables, so older installs (saved off) are turned on once by Log.Init's featuresOn.
  contributeButtons = true,
  language = "auto",       -- "auto" (the game client's language), "enUS" or a language pack's locale
  -- Narration voices: voiceOrder (pack add-on names, "auto" = the default pack) and voiceOff (unticked ones) are
  -- set up by Voice.lua, which also moves the old one-voice setting (voicePack) into them.
  voiceGroup = "story",    -- keep one voice per "story" (a story and its questions), per "zone", or pick per "line"
  voiceMatchRace = false,  -- prefer voices that suit the race of the lore (orc lore in an orc voice)
  voiceMatchGender = true, -- quest dialogue: prefer a voice of the quest giver's gender (Voice.QuestClip)
  -- The game's sound channel recordings play on (Play voices on, LOR-315): Dialog, SFX, Music, Ambience or Master.
  -- Voice volume is that channel's own volume in the game's settings, which Lore Forever never keeps a copy of.
  voiceChannel = "Dialog",
  panelScale = 1,          -- Panel size: 0.9, 1, 1.15 or 1.3 (UI.SCALES); scales the whole panel
}

local L = ns.L
local T = ns.Theme

local VOICES_URL = "loreforeverwow.com/downloads"
local LANGUAGES_URL = "loreforeverwow.com/translate"

-- Size a button to its label (German and other languages run longer than the English the sizes were picked for).
local function fit(btn, min)
  local fs = btn.GetFontString and btn:GetFontString()
  local w = fs and fs.GetStringWidth and fs:GetStringWidth()
  if type(w) == "number" and w > 0 then btn:SetWidth(math.max(min or 0, w + 32)) end
end

-- A drop-down: a button showing the current choice with an arrow, and a list that opens under it. Built from plain
-- frames (no UIDropDownMenu), so it doesn't depend on which menu API the client has; the list sits on UIParent, not
-- inside the scroll frame, so the scroll frame can't clip it. Open it with items {value, label, note, why}; items
-- with a `why` can't be chosen and show it greyed.
local ROW = 22
local function dropDown(name, parent, width)
  local btn = CreateFrame("Button", name, parent, "UIPanelButtonTemplate")
  btn:SetSize(width, 24)
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
  -- An opaque background of its own: backdrops aren't available on every client.
  local bg = list:CreateTexture(nil, "BACKGROUND")
  bg:SetAllPoints()
  if bg.SetColorTexture then bg:SetColorTexture(T.rgba(T.color.popup)) else bg:SetTexture(T.rgba(T.color.popup)) end
  if list.SetBackdrop then
    list:SetBackdrop({ edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 12,
      insets = { left = 3, right = 3, top = 3, bottom = 3 } })
  end
  list:EnableMouse(true)
  list:Hide()
  list.rows = {}
  function list.Open(items, current, onChoose)
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
    list:SetSize(math.max(width, 260), #items * ROW + 12)
    list:Show()
  end
  function list.Toggle(items, current, onChoose)
    if list:IsShown() then list:Hide() else list.Open(items, current, onChoose) end
  end
  btn:SetScript("OnHide", function() list:Hide() end)
  return btn, list
end

local function heading(c, text, anchor, gap)
  local h = c:CreateFontString(nil, "ARTWORK", "GameFontNormal")
  h:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -(gap or 20))
  h:SetText(text)
  return h
end

local function note(c, text, anchor, gap, font)
  local n = c:CreateFontString(nil, "ARTWORK", font or "GameFontHighlightSmall")
  if not font then n:SetTextColor(T.rgba(T.color.muted)) end   -- the game's disabled grey is too dim to read here
  n:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -(gap or 6))
  n:SetPoint("RIGHT", c, "RIGHT", -24, 0)
  n:SetJustifyH("LEFT")
  n:SetText(text)
  return n
end

-- "Get more …:" and a read-only, selectable web address next to it, under `anchor` (`gap` below it). Add-ons can't
-- open a browser, so players copy the address. Returns the label (to anchor what comes next), the box and its refill.
local function urlRow(c, label, address, anchor, gap)
  local text = c:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  text:SetTextColor(T.rgba(T.color.muted))
  text:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -gap)
  text:SetText(label)
  local url = CreateFrame("EditBox", nil, c, "InputBoxTemplate")
  url:SetSize(220, 20)
  url:SetPoint("LEFT", text, "RIGHT", 12, 0)
  url:SetAutoFocus(false)
  if url.SetFontObject and _G.ChatFontNormal then url:SetFontObject(ChatFontNormal) end
  url:SetTextColor(T.rgba(T.color.url))
  -- On the Forever client, text set on this box before the settings page is first shown rendered as an empty box
  -- (it's dropped or scrolled out of view). So the address is filled again, with the cursor at the start, every time
  -- the box or the page shows.
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
  return text, url, fill
end

-- At the top of Narration voices: which of the game's sound channels the narrators and quest dialogue play on (Play
-- voices on, LOR-315: Dialog unless the player picks Effects, Music, Ambience or Master Volume, named as the game's
-- Sound settings name them), then how loud they are (Voice volume, LOR-295). The slider is the chosen channel's own
-- volume (Voice.Volume), never a copy of it: it shows what the game has whenever the page opens, the game says a
-- setting changed (Options.OnCVarUpdate) or another channel is picked, and moving it sets the game's setting there and
-- then, as that channel's slider in System > Sound does. So whatever else the game plays on that channel follows it
-- too (the note under it says what), nothing changes while something plays, and only the channel choice is saved. A
-- new channel applies from the next recording: the one playing carries on where it is. Moved with nothing playing,
-- the slider plays the first voice's sample to hear the level by (the sample follows the slider while it plays). With
-- the chosen channel switched off in the game our recordings play on Master, which this leaves alone: the note says
-- so, and no sample plays. Under `anchor`; returns the rows.
local function volumeRow(c, anchor)
  local row = {}
  local pick = c:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
  pick:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -10)
  pick:SetText(L["Play voices on"])
  local channel, channelList = dropDown("LoreForeverVoiceChannel", c, 220)
  channel:SetPoint("TOPLEFT", pick, "BOTTOMLEFT", 2, -4)
  channel:HookScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Play voices on"])
    T.Tip(L["Which of the game's sound channels the narrators and quest dialogue play on. Voice volume below is that channel's volume."],
      "tipText", true)
    GameTooltip:Show()
  end)
  channel:HookScript("OnLeave", function() GameTooltip:Hide() end)
  local label = c:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
  label:SetPoint("TOPLEFT", channel, "BOTTOMLEFT", -2, -12)
  label:SetText(L["Voice volume"])
  local slider = CreateFrame("Slider", "LoreForeverVoiceVolume", c, T.BACKDROP_TEMPLATE)
  slider:SetOrientation("HORIZONTAL")
  slider:SetSize(220, 17)
  slider:SetPoint("TOPLEFT", label, "BOTTOMLEFT", 2, -8)
  slider:SetHitRectInsets(0, 0, -4, -4)
  if slider.SetBackdrop then   -- the game's own slider look, without its template
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
  local value = c:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  value:SetPoint("LEFT", slider, "RIGHT", 10, 0)
  local text = note(c, "", slider, 8)
  text:SetPoint("TOPLEFT", slider, "BOTTOMLEFT", -2, -8)   -- under the label, not the slider's inset

  -- What else the game plays on the chosen channel; or that the game has it switched off, so our voices play on Master.
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
  -- The chosen channel by its game name, and its volume on the slider; nothing is written back.
  local syncing = false
  function row.Sync()
    local V = ns.Voice
    channel:SetText(V.ChannelName(V.ChannelChoice()))
    local pct = V.Volume()
    syncing = true
    slider:SetValue(pct)
    syncing = false
    value:SetText(string.format("%d%%", pct))
    text:SetText(about())
  end
  -- Another channel: from the next recording on (the one playing carries on), with its own volume on the slider.
  channel:SetScript("OnClick", function()
    local items = {}
    for _, key in ipairs(ns.Voice.CHANNELS) do items[#items + 1] = { value = key, label = ns.Voice.ChannelName(key) } end
    channelList.Toggle(items, ns.Voice.ChannelChoice(), function(ch)
      LoreForeverDB.settings.voiceChannel = ch.value
      row.Sync()
    end)
  end)
  -- With nothing playing, the first voice's sample (which plays on as the slider moves).
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
    if not ns.Voice.SetVolume(pct) then return row.Sync() end   -- the game didn't take it: show what it has
    hear()
  end)
  slider:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Voice volume"])
    T.Tip(about(), "tipText", true)
    GameTooltip:Show()
  end)
  slider:SetScript("OnLeave", function() GameTooltip:Hide() end)
  -- "New" after an update whose notes name Options > ... Voice volume or Play voices on (WhatsNew.lua; ShowNew).
  row.new = ns.WhatsNew.Tag(c, label, "LEFT", "RIGHT", 8, 0)
  row.channelNew = ns.WhatsNew.Tag(c, pick, "LEFT", "RIGHT", 8, 0)
  row.label, row.slider, row.value, row.note = label, slider, value, text
  row.pick, row.channel, row.channelList = pick, channel, channelList
  return row
end

-- The Narration voices section: the channel the voices play on and its volume, then the player's voices in order,
-- each with a tick box, its counts, Sample, and arrows to move it (plain clicks only); a voice that isn't installed any
-- more can be forgotten. Then how voices share a story, a status line and where to get more voices. Placed under
-- `anchor`; returns the section and its last line.
local VROW = 38
local MODES = { "story", "line", "zone" }
function Options.VoiceSection(c, anchor)
  local head = heading(c, L["Narration voices"], anchor, 24)
  local volume = volumeRow(c, head)
  local intro = note(c, L["Each narration plays from the first voice in this list that has it. Use the arrows to change the order; untick a voice to stop using it."], volume.note, 14)
  local box = CreateFrame("Frame", nil, c)
  box:SetPoint("TOPLEFT", intro, "BOTTOMLEFT", 0, -6)
  box:SetPoint("RIGHT", c, "RIGHT", -24, 0)
  box:SetHeight(VROW)
  local packsHead = heading(c, L["Installed packs"], box, 14)
  local packsHelp = note(c, L["Several packs add recordings to the same narrator above. Language packs are chosen in Options > Language; reload to change language."], packsHead, 6)
  local packsList = note(c, "", packsHelp, 10)
  local modeLabel = note(c, L["When several voices have a narration:"], packsList, 14, "GameFontNormalSmall")
  local mode, modeList = dropDown("LoreForeverVoiceMode", c, 300)
  mode:SetPoint("TOPLEFT", modeLabel, "BOTTOMLEFT", 2, -4)
  local race = CreateFrame("CheckButton", nil, c, "UICheckButtonTemplate")
  race:SetPoint("TOPLEFT", mode, "BOTTOMLEFT", -4, -6)
  local raceText = type(race.Text) == "table" and race.Text or race:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  raceText:ClearAllPoints()
  raceText:SetPoint("LEFT", race, "RIGHT", 4, 0)
  raceText:SetText(L["Prefer voices that suit the race"])
  local raceNote = note(c, L["Orc lore in an orc voice: a voice that says which races it suits goes first for their stories."],
    race, 2)
  raceNote:SetPoint("TOPLEFT", race, "BOTTOMLEFT", 30, 4)
  race:SetScript("OnClick", function(self)
    LoreForeverDB.settings.voiceMatchRace = self:GetChecked() and true or false
    ns.Voice.Refresh()
    if ns.UI and ns.UI.OnVoiceChanged then ns.UI.OnVoiceChanged() end
  end)
  local gender = CreateFrame("CheckButton", nil, c, "UICheckButtonTemplate")
  gender:SetPoint("TOPLEFT", raceNote, "BOTTOMLEFT", -30, -2)
  local genderText = type(gender.Text) == "table" and gender.Text
    or gender:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  genderText:ClearAllPoints()
  genderText:SetPoint("LEFT", gender, "RIGHT", 4, 0)
  genderText:SetText(L["Match the quest giver's voice"])
  local genderNote = note(c, L["Quest dialogue only: a woman's lines in a woman's voice and a man's in a man's, ahead of the list order, when you have both."],
    gender, 2)
  genderNote:SetPoint("TOPLEFT", gender, "BOTTOMLEFT", 30, 4)
  gender:SetScript("OnClick", function(self)
    LoreForeverDB.settings.voiceMatchGender = self:GetChecked() and true or false
  end)
  -- "New" after an update, when this version's notes name one of the two (WhatsNew.lua; section.ShowNew).
  local raceNew = ns.WhatsNew.Tag(c, raceText, "LEFT", "RIGHT", 8, 0)
  local genderNew = ns.WhatsNew.Tag(c, genderText, "LEFT", "RIGHT", 8, 0)
  local status = note(c, "", genderNote, 8, "GameFontHighlightSmall")
  status:SetPoint("TOPLEFT", genderNote, "BOTTOMLEFT", -26, -8)   -- back under the tick box, not its indented note
  local moreLabel, url, fillUrl = urlRow(c, L["Get more voices:"], VOICES_URL, status, 14)
  local hint = note(c, L["Installed a voice? Type /reload; it's added at the top."],
    moreLabel, 10)

  local section, rows = {}, {}
  function section.ShowNew()
    volume.new:SetShown(ns.WhatsNew.OptionIsNew("Voice volume"))
    volume.channelNew:SetShown(ns.WhatsNew.OptionIsNew("Play voices on"))
    raceNew:SetShown(ns.WhatsNew.OptionIsNew("Prefer voices that suit the race"))
    genderNew:SetShown(ns.WhatsNew.OptionIsNew("Match the quest giver's voice"))
  end
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
    b:SetScript("OnEnter", function(self)
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:AddLine(tip)
      GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function() GameTooltip:Hide() end)
    return b
  end

  -- The panel's themed button (Theme.lua), or the game's own where the theme isn't loaded.
  local function button(parent, label)
    if ns.Theme and ns.Theme.Button then return ns.Theme.Button(parent, label) end
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetText(label)
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
    r.check:SetPoint("LEFT", -4, 0)
    r.check:SetScript("OnClick", function(self)
      ns.Voice.SetOn(r.item.key, self:GetChecked() and true or false)
      section.Update()
    end)
    r.down = small(r, "Interface\\Buttons\\UI-ScrollBar-ScrollDownButton-Up", L["Move down"], function(it)
      ns.Voice.Move(it.key, 1)
      section.Update()
    end)
    r.down:SetPoint("RIGHT", 0, 0)
    r.up = small(r, "Interface\\Buttons\\UI-ScrollBar-ScrollUpButton-Up", L["Move up"], function(it)
      ns.Voice.Move(it.key, -1)
      section.Update()
    end)
    r.up:SetPoint("RIGHT", r.down, "LEFT", -2, 0)
    r.sample = button(r, L["Sample"])
    r.sample:SetSize(70, 22)
    r.sample:SetPoint("RIGHT", r.up, "LEFT", -6, 0)
    fit(r.sample, 70)
    -- Sample plays the voice's sample (stopping whatever played, another sample included); while it plays the
    -- button reads Stop and stops it (Voice.previewing, kept up to date through Options.OnPreviewChanged).
    r.sample:SetScript("OnClick", function()
      if ns.Voice.previewing == r.item.key then return ns.Voice.StopPreview() end
      local ok, why = ns.Voice.Preview(r.item.key)
      if not ok then   -- say why (LOR-136), unless the status line already does
        local st = ns.Voice.Status()
        if why and st:find(why, 1, true) then
          status:SetText(st)
        else
          status:SetText(st .. " " .. T.code.warn .. (why or L["(Nothing to preview.)"]) .. "|r")
        end
      end
    end)
    r.forget = button(r, L["Forget"])
    r.forget:SetSize(70, 22)
    r.forget:SetPoint("RIGHT", r.up, "LEFT", -6, 0)
    fit(r.forget, 70)
    r.forget:SetScript("OnClick", function()
      ns.Voice.Forget(r.item.key)
      section.Update()
    end)
    -- One width for both (only one shows), so a longer translation of either can't run over the name.
    local w1, w2 = r.sample:GetWidth(), r.forget:GetWidth()
    if type(w1) == "number" and type(w2) == "number" then
      r.sample:SetWidth(math.max(w1, w2))
      r.forget:SetWidth(math.max(w1, w2))
    end
    r.name = r:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    r.name:SetPoint("TOPLEFT", r.check, "TOPRIGHT", 2, 3)
    r.name:SetPoint("RIGHT", r.sample, "LEFT", -8, 0)
    r.name:SetJustifyH("LEFT")
    r.stats = r:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    r.stats:SetPoint("TOPLEFT", r.name, "BOTTOMLEFT", 0, -2)
    r.stats:SetPoint("RIGHT", r.sample, "LEFT", -8, 0)
    r.stats:SetJustifyH("LEFT")
    rows[i] = r
    return r
  end

  -- One row: greyed when unticked or unusable (with why in red), counts otherwise. A voice that can't be used can
  -- still be unticked, so it doesn't count as chosen.
  local function fill(r, it, i, n)
    r.item = it
    local usable = not it.why
    r.check:SetChecked(it.on)
    local title = it.label
    r.name:SetText(((it.on and usable) and "" or T.code.faint) .. title .. ((it.on and usable) and "" or "|r"))
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
    r.sample:SetShown(usable)
    r.sample:SetText(ns.Voice.previewing == it.key and L["Stop"] or L["Sample"])
    r.forget:SetShown(it.missing and not it.default)
    if i == 1 then r.up:Disable() else r.up:Enable() end
    if i == n then r.down:Disable() else r.down:Enable() end
    r:Show()
  end

  function section.Update()
    volume.Sync()
    local items = ns.Voice.List()
    for i, it in ipairs(items) do fill(row(i), it, i, #items) end
    for i = #items + 1, #rows do rows[i]:Hide() end
    box:SetHeight(math.max(#items, 1) * VROW)
    local installed, text = ns.Voice.InstalledPacks(), {}
    for _, it in ipairs(installed) do
      local detail = it.language .. ns.Lang.Dotted(" · ") .. it.status
      if it.counts then
        detail = detail .. "\n" .. (it.checked and not it.questPageCheck and L["Current:"] or L["Installed:"]) .. " " .. string.format(L["%d lore recordings · %d quest dialogue · %d lore answers"],
          it.counts.lore, it.counts.quest, it.counts.answer)
        if not it.checked then
          detail = detail .. ns.Lang.Dotted(" · ") .. L["current/outdated: switch language to check"]
        elseif it.stale > 0 then
          detail = detail .. ns.Lang.Dotted(" · ") .. string.format(L["%d outdated"], it.stale)
        end
        if it.counts.unknown > 0 then detail = detail .. ns.Lang.Dotted(" · ") .. string.format(L["%d unrecognized"], it.counts.unknown) end
        if it.questPageCheck then detail = detail .. "\n" .. L["Quest dialogue is checked against the quest page when opened."] end
      elseif it.support then
        detail = detail .. "\n" .. string.format(L["Playback support for %d recordings"], it.support)
      elseif it.entries then
        detail = detail .. "\n" .. string.format(L["%d translated entries · %d translated strings"], it.entries, it.strings)
      else
        detail = detail .. ns.Lang.Dotted(" · ") .. L["Counts not checked"]
      end
      text[#text + 1] = T.code.gold .. it.title .. (it.narrator and (ns.Lang.Dotted(" · ") .. it.narrator) or "") .. "|r\n" .. detail
    end
    packsList:SetText(table.concat(text, "\n\n"))
    section.packs, section.packsList, section.packsHead = installed, packsList, packsHead

    local cur = (LoreForeverDB and LoreForeverDB.settings.voiceGroup) or "story"
    mode:SetText(modeNames[cur] or modeNames.story)
    race:SetChecked(LoreForeverDB and LoreForeverDB.settings.voiceMatchRace and true or false)
    gender:SetChecked(not (LoreForeverDB and LoreForeverDB.settings.voiceMatchGender == false))
    status:SetText(ns.Voice.Status(true))
    fillUrl()
    section.items = items
  end

  -- A sample started or stopped (Voice.Preview, Voice.Stop, or it ended): relabel the Sample buttons.
  function section.UpdateSamples()
    for _, r in ipairs(rows) do
      if r.item then r.sample:SetText(ns.Voice.previewing == r.item.key and L["Stop"] or L["Sample"]) end
    end
  end

  mode:SetScript("OnClick", function()
    local items = {}
    for _, m in ipairs(MODES) do items[#items + 1] = { value = m, label = modeNames[m] } end
    modeList.Toggle(items, (LoreForeverDB and LoreForeverDB.settings.voiceGroup) or "story", function(ch)
      ns.Voice.SetGroup(ch.value)
      section.Update()
    end)
  end)
  section.rows, section.box, section.mode, section.modeList = rows, box, mode, modeList
  section.status, section.url, section.race = status, url, race
  section.volume, section.volumeValue, section.volumeNote = volume.slider, volume.value, volume.note
  section.volumeLabel, section.volumeNew, section.SyncVolume = volume.label, volume.new, volume.Sync
  section.channel, section.channelList, section.channelLabel = volume.channel, volume.channelList, volume.pick
  section.channelNew = volume.channelNew
  return section, hint
end

-- Built when the panel is, after the language pack has loaded.
local function rows()
  local out = {
    { "zoneNudge", L["Zone hints"], L["When you enter a zone, suggest a question about it in chat."] },
    { "dungeonPrimer", L["Dungeon primer prompt"], L["When you enter a dungeon, link its primer in chat, and each boss's story once you beat them."] },
    { "unitTooltips", L["Lore on NPC tooltips"], L["Add a one-line story to the tooltip of NPCs and mobs."] },
    { "itemTooltips", L["Notes on item tooltips"], L["Say when an item is wanted for a quest or starts one."] },
    { "storylines", L["Show storylines on quests"], L["When a quest is part of a storyline, say so under its title and at the top of its story."] },
    { "storylineChat", L["Storyline hints in chat"], L["When you turn in a quest that's part of a storyline, say in chat who to see next."] },
    { "minimap", L["Minimap button"], L["Also show a book button on the minimap."] },
    { "floatPlayer", L["Floating player"], L["While the panel is closed, show the narration player on screen when something plays or is queued. Drag it to move it."] },
    { "reportCross", L["Show the report button on the narration player"], L["A small cross on the player to tell us a narration sounds wrong: a name said wrong, the wrong voice, cut off. Right-clicking the player offers it too."] },
    { "typing", L["Typing animation"], L["Answers type in quickly. Click an answer to show it all at once."] },
    { "chatLinks", L["Clickable names in answers"], L["Names of places, people and events in an answer open their own story. Shift-click one to add it to your playlist."] },
    { "showSpoilers", L["Show spoilers without asking"], L["Answers that give away a quest's twist or ending normally ask before revealing. Tick this to always show them."] },
    { "onDemand", L["Narration: only when I press Play"], L["Nothing plays by itself: not as you arrive, on flights, at quest givers or in books. Play buttons, the Narrate key and your playlist still work."] },
    { "narrateFlights", L["Narrate flights"], L["Read the story of each zone aloud while on a flight path."] },
    { "autoZone", L["Play narrations as you arrive"], L["When you reach a zone or place with a recorded narration, play it. Never during combat or a flight, and never over something already playing."] },
    { "questDialogue", L["Speak quest dialogue"], L["Off by default. Turn on to hear quest pages automatically or use Play beside the quest window. Leave off when another add-on reads quests. Lore Forever's own stories and answers still play."] },
    { "skipHeard", L["Skip what you've heard"], L["Don't play a narration by itself again once this character has heard it. You can still play it any time; the Library ticks the ones you've heard."] },
    { "packHints", L["Narration pack hints"], L["When you enter a zone whose places and people are narrated in a voice pack you don't have, say so once."] },
    { "journey", L["Remember my journey"], L["Keep track of the places you discover, the people you meet, the foes you defeat and the quests you finish, for your journey page. It stays on your PC."] },
    { "liveStrip", L["Live game info for the companion app"], L["Shows a tiny block of colored squares in the top-left corner. The Lore Forever companion app on this PC reads it, so Sam knows where you are, what you're fighting and your tracked quest right away instead of after a /reload. Turn on Live game info in the companion's Settings too. Nothing is sent anywhere, and the companion never presses keys or clicks in the game."] },
    { "pictureHideUI", L["Hide the interface when taking a journey picture"], L["Print Screen takes a normal WoW screenshot. For a journey picture, use /lore picture or set Take a journey picture in Key Bindings, AddOns. This option hides your interface for a moment, except in combat. In the companion, turn on Picture book and connect your profile. Pictures with the interface need On my profile."] },
    { "capture", L["Keep the quest text you see"], L["Keep the quest, gossip and book text Forever shows you, so you can share what Lore Forever doesn't have yet at loreforeverwow.com/contribute. It stays on your PC unless you share it."] },
    { "contributeButtons", L["Contribute buttons"], L["A small button on quest, gossip and book windows whose text Lore Forever doesn't have yet. Click it for a link to share that text."] },
    { "tips", L["Tips at login"], L["Now and then at login, a tip in chat about something Lore Forever can do."] },
  }
  if ns.Journey and ns.Journey.PictureBookOn() then
    for i, row in ipairs(out) do
      if row[1] == "pictureHideUI" then
        table.insert(out, i + 1, { "automaticPictures", L["Automatic journey pictures"],
          L["Take a journey picture when you level up, defeat a boss or first reach a zone or dungeon. At most ten a day, never in combat or on a flight. Turn this off to take pictures only yourself."] })
        break
      end
    end
  end
  return out
end

-- Language: a drop-down of Automatic, English and the installed language packs, under `anchor`. Packs load at login,
-- so a new choice takes a reload. Add-ons can't call ReloadUI (it's protected: "Interface action failed"), so the
-- Reload now button is a secure button that runs /reload as a macro.
local function languageSection(c, p, anchor)
  local head = heading(c, L["Language"], anchor, 18)
  local btn, list = dropDown("LoreForeverLanguagePick", c, 260)
  btn:SetPoint("TOPLEFT", head, "BOTTOMLEFT", 2, -6)
  -- A protected frame can't be anchored to anything positioned by text ("Cannot anchor protected frames to
  -- regions"), so it sits in the page header, anchored to the panel itself (and stays put when the page scrolls).
  local reload = CreateFrame("Button", "LoreForeverReloadButton", p, "SecureActionButtonTemplate, UIPanelButtonTemplate")
  reload:SetSize(120, 24)
  reload:SetPoint("TOPRIGHT", p, "TOPRIGHT", -36, -10)
  reload:SetText(L["Reload now"])
  fit(reload, 120)
  if reload.SetAttribute then
    reload:SetAttribute("type", "macro")
    reload:SetAttribute("macrotext", "/reload")
  end
  reload:RegisterForClicks("AnyUp", "AnyDown")   -- secure buttons act on key-down or key-up depending on a CVar
  reload:Hide()
  local hint = note(c, L["Automatic follows your WoW client's language. A contributor edition switches its text and narration together. Reload to apply your selection."], btn, 6)
  local moreLabel, _, fillUrl = urlRow(c, L["Get more languages:"], LANGUAGES_URL, hint, 10)
  local function items()
    local out, id = {}, ns.Lang.Selected()
    local label
    for _, ch in ipairs(ns.Lang.Choices()) do
      out[#out + 1] = { value = ch.id, label = ch.label, why = ch.reason }
      if ch.id == id then label = ch.label end
    end
    return out, id, label or out[1].label
  end
  local function update()
    local _, _, label = items()
    btn:SetText(label)
    if ns.lang and ns.lang.edition and ns.lang.edition.unavailable then
      hint:SetText(L["Edition unavailable. Install or enable both matching components, then reload, or select another edition or stock language here."])
    end
    fillUrl()
    -- A secure button can't be shown or hidden in combat.
    if InCombatLockdown and InCombatLockdown() then return end
    local pending = ns.Lang.NeedsReload()
    if pending then
      -- Labelled in the language it switches to.
      local ui = ns.Lang.StringsFor(ns.Lang.Resolve())
      reload:SetText(ui and (ui["Reload now"] or "Reload now") or L["Reload now"])
      fit(reload, 120)
    end
    reload:SetShown(pending)
  end
  btn:SetScript("OnClick", function()
    local all, id = items()
    list.Toggle(all, id, function(ch) ns.Lang.Set(ch.value); update() end)
  end)
  p.language, p.languageList, p.reload, p.updateLanguage = btn, list, reload, update
  update()
  return moreLabel
end

-- Panel size: scales the whole Lore Forever panel (text, buttons and all), for bigger text. Under `anchor`; returns
-- the drop-down button (with .Update), for whatever comes next.
local function sizeSection(c, anchor)
  local head = heading(c, L["Panel size"], anchor, 24)
  local btn, list = dropDown("LoreForeverSizePick", c, 200)
  btn:SetPoint("TOPLEFT", head, "BOTTOMLEFT", 2, -6)
  local names = { L["Small"], L["Normal"], L["Large"], L["Larger"] }
  local function items()
    local out, label = {}, nil
    local cur = tonumber(LoreForeverDB.settings.panelScale) or 1
    for i, v in ipairs(ns.UI.SCALES) do
      out[i] = { value = v, label = string.format("%s (%d%%)", names[i] or "", math.floor(v * 100 + 0.5)) }
      if v == cur then label = out[i].label end
    end
    return out, cur, label or out[2].label
  end
  function btn.Update()
    local _, _, label = items()
    btn:SetText(label)
  end
  btn:SetScript("OnClick", function()
    local all, cur = items()
    list.Toggle(all, cur, function(ch)
      LoreForeverDB.settings.panelScale = ch.value
      ns.UI.ApplyScale(ch.value)
      btn.Update()
    end)
  end)
  btn.Update()
  return btn
end

function Options.Create()
  if Options.panel then return Options.panel end
  local p = CreateFrame("Frame", "LoreForeverOptions")
  p:Hide()   -- the settings window shows it when it displays our page
  p.name = "Lore Forever"
  -- Everything sits in a scroll frame: the settings page is shorter than the list of options. The content is as wide
  -- as the frame, and each line hangs off the one above it, so longer (translated) text pushes the rest down.
  local sf = CreateFrame("ScrollFrame", "LoreForeverOptionsScroll", p, "UIPanelScrollFrameTemplate")
  sf:SetPoint("TOPLEFT", 0, -4)
  sf:SetPoint("BOTTOMRIGHT", -28, 4)
  local c = CreateFrame("Frame", nil, sf)
  c:SetSize(600, 900)
  sf:SetScrollChild(c)
  sf:SetScript("OnSizeChanged", function(_, w) if type(w) == "number" and w > 0 then c:SetWidth(w) end end)
  local title = c:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("TOPLEFT", 16, -12)
  title:SetText("Lore Forever")
  local sub = note(c, L["Offline lore for the zones, quests and people around you. Lore adapted from warcraft.wiki.gg (CC BY-SA 4.0)."], title, 6, "GameFontHighlightSmall")
  local last = heading(c, L["General"], languageSection(c, p, sub), 22)
  p.checks = {}
  -- The English label of a translated one, to look for in the notes (WhatsNew.OptionIsNew): ns.L maps English to
  -- the language in use.
  local function english(label)
    for en, tr in pairs(L) do
      if tr == label then return en end
    end
    return label
  end
  for i, row in ipairs(rows()) do
    local key, label, tip = row[1], row[2], row[3]
    local cb = CreateFrame("CheckButton", nil, c, "UICheckButtonTemplate")
    if i == 1 then cb:SetPoint("TOPLEFT", last, "BOTTOMLEFT", -2, -4) else cb:SetPoint("TOPLEFT", last, "BOTTOMLEFT", -30, -4) end
    local text = type(cb.Text) == "table" and cb.Text or nil
    if not text then
      text = cb:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
      text:SetPoint("LEFT", cb, "RIGHT", 4, 0)
    end
    text:SetText(label)
    -- "New" after an update, for an option this version's notes mention (WhatsNew.lua), until Options is next opened.
    cb.newTag = ns.WhatsNew.Tag(c, text, "LEFT", "RIGHT", 8, 0)
    cb.english = english(label)
    local desc = c:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    desc:SetTextColor(T.rgba(T.color.muted))
    desc:SetPoint("TOPLEFT", cb, "BOTTOMLEFT", 30, 4)
    desc:SetPoint("RIGHT", c, "RIGHT", -24, 0)
    desc:SetJustifyH("LEFT")
    desc:SetText(tip)
    cb:SetScript("OnClick", function(self)
      LoreForeverDB.settings[key] = self:GetChecked() and true or false
      if key == "showSpoilers" and ns.UI and ns.UI.UpdateListen then ns.UI.UpdateListen() end
      if key == "minimap" and ns.MinimapButton then ns.MinimapButton() end
      if (key == "floatPlayer" or key == "reportCross") and ns.UI.UpdateNowPlaying then ns.UI.UpdateNowPlaying() end
      if key == "onDemand" then ns.Voice.SetOnDemand(self:GetChecked()) end
      if key == "questDialogue" then ns.Voice.SetQuestDialogue(self:GetChecked()) end
      if key == "journey" and ns.Journey then ns.Journey.OnToggle() end
      if key == "liveStrip" and ns.Strip then ns.Strip.Update() end
      if key == "storylines" and ns.UI and ns.UI.Refresh then ns.UI.Refresh() end
      if key == "storylines" and ns.Hooks and ns.Hooks.RefreshQuestStory then ns.Hooks.RefreshQuestStory() end
      if key == "contributeButtons" and ns.Capture then ns.Capture.UpdateAll() end
    end)
    cb.key = key
    p.checks[#p.checks + 1] = cb
    last = desc
  end
  local keyBtn = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
  keyBtn:SetSize(160, 24)
  keyBtn:SetPoint("TOPLEFT", last, "BOTTOMLEFT", -26, -16)
  keyBtn:SetText(L["Set panel key..."])
  fit(keyBtn, 160)
  keyBtn:SetScript("OnClick", function() ns.Hooks.KeyPrompt("toggle"):Show() end)
  local narrBtn = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
  narrBtn:SetSize(180, 24)
  narrBtn:SetPoint("LEFT", keyBtn, "RIGHT", 10, 0)
  narrBtn:SetText(L["Set narration key..."])
  fit(narrBtn, 180)
  narrBtn:SetScript("OnClick", function() ns.Hooks.KeyPrompt("narrate"):Show() end)
  -- Forget what this character has heard, so narrations and quest text play by themselves again.
  local resetBtn = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
  resetBtn:SetSize(200, 24)
  resetBtn:SetPoint("TOPLEFT", keyBtn, "BOTTOMLEFT", 0, -8)
  resetBtn:SetText(L["Reset heard narrations"])
  fit(resetBtn, 200)
  resetBtn:SetScript("OnClick", function()
    local n = ns.Voice.ResetHeard()
    DEFAULT_CHAT_FRAME:AddMessage(T.CHAT_PREFIX .. string.format(n == 1
      and L["forgot %d narration this character heard; it plays by itself again."]
      or L["forgot %d narrations this character heard; they play by themselves again."], n))
    if ns.UI and ns.UI.UpdateListen and ns.UI.frame then ns.UI.UpdateListen() end
  end)
  p.resetHeard = resetBtn
  -- After sharing your LoreForever.lua at loreforeverwow.com/contribute: what's kept so far counts as shared, so the
  -- next upload only carries new lines (Capture.MarkAllSent). The text itself stays.
  local sentBtn = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
  sentBtn:SetSize(160, 24)
  sentBtn:SetPoint("LEFT", resetBtn, "RIGHT", 10, 0)
  sentBtn:SetText(L["Mark shared text as sent"])
  fit(sentBtn, 160)
  sentBtn:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Mark shared text as sent"])
    T.Tip(L["For optional quest, gossip and book text contributions only. After sharing at loreforeverwow.com/contribute, mark that text as sent so the next upload carries new lines. Your journey syncs automatically in the companion and does not use this button."], "tipText", true)
    GameTooltip:Show()
  end)
  sentBtn:SetScript("OnLeave", function() GameTooltip:Hide() end)
  sentBtn:SetScript("OnClick", function()
    local n = ns.Capture and ns.Capture.MarkAllSent() or 0
    DEFAULT_CHAT_FRAME:AddMessage(T.CHAT_PREFIX .. string.format(n == 1
      and L["%d line marked as sent; your next upload only carries what's new."]
      or L["%d lines marked as sent; your next upload only carries what's new."], n))
  end)
  p.markSent = sentBtn
  -- Every window back where it starts, the floating player and the minimap button shown again (UI.ResetWindows,
  -- LOR-241). Same as /lore reset.
  local windowsBtn = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
  windowsBtn:SetSize(160, 24)
  windowsBtn:SetPoint("TOPLEFT", resetBtn, "BOTTOMLEFT", 0, -8)
  windowsBtn:SetText(L["Reset windows"])
  fit(windowsBtn, 160)
  windowsBtn:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Reset windows"])
    T.Tip(L["Put the panel, the floating player and the minimap button back where they started, and show them again. Your journey and settings stay. Same as /lore reset."], "tipText", true)
    GameTooltip:Show()
  end)
  windowsBtn:SetScript("OnLeave", function() GameTooltip:Hide() end)
  windowsBtn:SetScript("OnClick", function() ns.UI.ResetWindows() end)
  p.resetWindows = windowsBtn
  local sizeBtn = sizeSection(c, windowsBtn)
  p.updateSize = sizeBtn.Update
  local bottom
  p.voice, bottom = Options.VoiceSection(c, sizeBtn)
  p:SetScript("OnShow", function(self)
    for _, cb in ipairs(self.checks) do
      cb:SetChecked(LoreForeverDB.settings[cb.key] and true or false)
      cb.newTag:SetShown(ns.WhatsNew.OptionIsNew(cb.english))
    end
    self.voice.ShowNew()
    ns.WhatsNew.Seen("options")   -- shown this once; gone the next time Options opens
    self.updateLanguage()
    self.updateSize()
    self.voice.Update()
    -- Scroll height: from the top of the content to its last line, once the game has laid the text out.
    local w = sf.GetWidth and sf:GetWidth()
    if type(w) == "number" and w > 0 then c:SetWidth(w) end
    local top, low = c.GetTop and c:GetTop(), bottom.GetBottom and bottom:GetBottom()
    if type(top) == "number" and type(low) == "number" and top > low then c:SetHeight(top - low + 24) end
  end)
  -- Leaving the page (closing the settings window, or another add-on's page) stops a voice sample still playing.
  p:SetScript("OnHide", function() ns.Voice.StopPreview() end)

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
-- otherwise open it there (also when it's open on another add-on's page).
function Options.Toggle()
  local p, win = Options.panel, _G.SettingsPanel or _G.InterfaceOptionsFrame
  -- The window itself must be showing: until it first displays our page, the page has no parent and counts as
  -- visible on its own, which made the first right-click try to close a window that wasn't open.
  if p and win and win:IsShown() and p:IsVisible() and _G.HideUIPanel then return HideUIPanel(win) end
  Options.Open()
end
