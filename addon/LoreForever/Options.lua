-- Settings page (Esc > Options > AddOns > Lore Forever), with the same toggles as the /lore commands.

local _, ns = ...
local Options = {}
ns.Options = Options

Options.DEFAULTS = {
  zoneNudge = true,        -- chat hint with a clickable question when entering a zone that has lore
  dungeonPrimer = true,    -- chat link to the dungeon primer when entering a dungeon
  unitTooltips = true,     -- one-line lore on NPC and mob tooltips
  itemTooltips = true,     -- quest notes on item tooltips
  storylines = true,       -- say a quest is part of a storyline, under its Lore button and on its entry (Storyline.lua)
  storylineChat = true,    -- turning in a storyline quest names who gives the next one (Storyline.OnTurnIn)
  floatPlayer = true,      -- the narration player floats on screen while the panel is closed (UI.UpdateNowPlaying)
  minimap = true,          -- minimap button (turned on once for installs from before it was the default: Log.Init)
  typing = true,           -- answers type in quickly instead of appearing at once
  chatLinks = true,        -- names of other entries in answers are links (UI.Linker), Back / Forward above the chat
  showSpoilers = false,    -- show answers marked as spoilers without asking first
  readAloud = true,        -- "Read aloud" (the game's text-to-speech) for answers without a recorded narration
  narrateFlights = false,  -- read zone lore aloud on taxi flights
  autoZone = true,         -- play a zone's or place's recorded narration on arriving there (Voice.OnArrive)
  autoQuest = true,        -- narrate the quest giver's window: its recording, else Read aloud (Voice.OnQuestFrame)
  readBooks = true,        -- read book, letter and plaque pages aloud as they open (Voice.ReadBookPage)
  skipHeard = true,        -- don't play automatically what this character has heard (LoreForeverDB.heard)
  packHints = true,        -- say (once a session per zone) when its places and people are in a lands pack you lack
  tips = true,             -- one tip at login about a feature (Core.lua loginTip), until they run out
  journey = true,          -- "Remember my journey": record places, people, quests and foes for Journey
  language = "auto",       -- "auto" (the game client's language), "enUS" or a language pack's locale
  -- Narration voices: voiceOrder (pack add-on names, "auto" = the default pack) and voiceOff (unticked ones) are
  -- set up by Voice.lua, which also moves the old one-voice setting (voicePack) into them.
  voiceGroup = "story",    -- keep one voice per "story" (a story and its questions), per "zone", or pick per "line"
  voiceMatchRace = false,  -- prefer voices that suit the race of the lore (orc lore in an orc voice)
  voiceMatchGender = true, -- quest dialogue: prefer a voice of the quest giver's gender (Voice.QuestClip)
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

-- The Narration voices section: the player's voices in order, each with a tick box, its counts, Sample, and arrows
-- to move it (plain clicks only); a voice that isn't installed any more can be forgotten. Then how voices share a
-- story, a status line and where to get more voices. Placed under `anchor`; returns the section and its last line.
local VROW = 38
local MODES = { "story", "line", "zone" }
function Options.VoiceSection(c, anchor)
  local head = heading(c, L["Narration voices"], anchor, 24)
  local intro = note(c, L["Each narration plays from the first voice in this list that has it. Use the arrows to change the order; untick a voice to stop using it."], head, 6)
  local box = CreateFrame("Frame", nil, c)
  box:SetPoint("TOPLEFT", intro, "BOTTOMLEFT", 0, -6)
  box:SetPoint("RIGHT", c, "RIGHT", -24, 0)
  box:SetHeight(VROW)
  local modeLabel = note(c, L["When several voices have a narration:"], box, 10, "GameFontNormalSmall")
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
  local status = note(c, "", genderNote, 8, "GameFontHighlightSmall")
  status:SetPoint("TOPLEFT", genderNote, "BOTTOMLEFT", -26, -8)   -- back under the tick box, not its indented note
  local moreLabel, url, fillUrl = urlRow(c, L["Get more voices:"], VOICES_URL, status, 14)
  local hint = note(c, L["Installed a voice? Type /reload; it's added at the top."],
    moreLabel, 10)

  local section, rows = {}, {}
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
      if not ns.Voice.Preview(r.item.key) then
        status:SetText(ns.Voice.Status() .. " " .. T.code.warn .. L["(Nothing to preview.)"] .. "|r")
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
      stats = string.format(L["plays %d · has %d"], it.plays, it.have) .. (it.races and (" · " .. it.races) or "")
    else
      stats = string.format(L["not used · has %d"], it.have)
    end
    if usable and it.stale > 0 then stats = stats .. " · " .. T.code.stale .. string.format(L["%d outdated"], it.stale) .. "|r" end
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
    local items = ns.Voice.List()
    for i, it in ipairs(items) do fill(row(i), it, i, #items) end
    for i = #items + 1, #rows do rows[i]:Hide() end
    box:SetHeight(math.max(#items, 1) * VROW)
    local cur = (LoreForeverDB and LoreForeverDB.settings.voiceGroup) or "story"
    mode:SetText(modeNames[cur] or modeNames.story)
    race:SetChecked(LoreForeverDB and LoreForeverDB.settings.voiceMatchRace and true or false)
    gender:SetChecked(not (LoreForeverDB and LoreForeverDB.settings.voiceMatchGender == false))
    status:SetText(ns.Voice.Status())
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
  return section, hint
end

-- Built when the panel is, after the language pack has loaded.
local function rows()
  return {
    { "zoneNudge", L["Zone hints"], L["When you enter a zone, suggest a question about it in chat."] },
    { "dungeonPrimer", L["Dungeon primer prompt"], L["When you enter a dungeon, link its primer in chat, and each boss's story once you beat them."] },
    { "unitTooltips", L["Lore on NPC tooltips"], L["Add a one-line story to the tooltip of NPCs and mobs."] },
    { "itemTooltips", L["Notes on item tooltips"], L["Say when an item is wanted for a quest or starts one."] },
    { "storylines", L["Show storylines on quests"], L["When a quest is part of a storyline, say so under its Lore button and at the top of its story."] },
    { "storylineChat", L["Storyline hints in chat"], L["When you turn in a quest that's part of a storyline, say in chat who to see next."] },
    { "minimap", L["Minimap button"], L["Also show a book button on the minimap."] },
    { "floatPlayer", L["Floating player"], L["While the panel is closed, show the narration player on screen when something plays or is queued. Drag it to move it."] },
    { "typing", L["Typing animation"], L["Answers type in quickly. Click an answer to show it all at once."] },
    { "chatLinks", L["Clickable names in answers"], L["Names of places, people and events in an answer open their own story. Shift-click one to add it to your playlist."] },
    { "showSpoilers", L["Show spoilers without asking"], L["Answers that give away a quest's twist or ending normally ask before revealing. Tick this to always show them."] },
    { "readAloud", L["Read aloud"], L["Offer \"Read aloud\" with the game's own voice for answers without a recorded narration. Pick its voice and speed in Options > Accessibility > Text to Speech."] },
    { "narrateFlights", L["Narrate flights"], L["Read the story of each zone aloud while on a flight path."] },
    { "autoZone", L["Play narrations as you arrive"], L["When you reach a zone or place with a recorded narration, play it. Never during combat or a flight, and never over something already playing."] },
    { "autoQuest", L["Narrate quest dialogue"], L["When a quest giver's window opens, play the quest's narration, or read the quest text aloud if Read aloud is on. It stops when the window closes."] },
    { "readBooks", L["Read books aloud"], L["When you open a book, letter or plaque, read the page aloud with the game's voice if Read aloud is on. Turning the page reads the next one; closing it stops."] },
    { "skipHeard", L["Skip what you've heard"], L["Don't play a narration or quest text by itself again once this character has heard it. You can still play it any time; the Library ticks the ones you've heard."] },
    { "packHints", L["Narration pack hints"], L["When you enter a zone whose places and people are narrated in a voice pack you don't have, say so once."] },
    { "journey", L["Remember my journey"], L["Keep track of the places you discover, the people you meet, the foes you defeat and the quests you finish, for your journey page. It stays on your PC."] },
    { "tips", L["Tips at login"], L["Now and then at login, a tip in chat about something Lore Forever can do."] },
  }
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
  local hint = note(c, L["Language packs are separate add-ons. After choosing a language, reload to switch."], btn, 6)
  local moreLabel, _, fillUrl = urlRow(c, L["Get more languages:"], LANGUAGES_URL, hint, 10)
  local function items()
    local out, id = {}, LoreForeverDB.settings.language or "auto"
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
    local desc = c:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    desc:SetTextColor(T.rgba(T.color.muted))
    desc:SetPoint("TOPLEFT", cb, "BOTTOMLEFT", 30, 4)
    desc:SetPoint("RIGHT", c, "RIGHT", -24, 0)
    desc:SetJustifyH("LEFT")
    desc:SetText(tip)
    cb:SetScript("OnClick", function(self)
      LoreForeverDB.settings[key] = self:GetChecked() and true or false
      if key == "minimap" and ns.MinimapButton then ns.MinimapButton() end
      if key == "floatPlayer" and ns.UI.UpdateNowPlaying then ns.UI.UpdateNowPlaying() end
      if key == "readAloud" and p.voice then p.voice.Update() end
      if key == "journey" and ns.Journey then ns.Journey.OnToggle() end
      if key == "storylines" and ns.UI and ns.UI.Refresh then ns.UI.Refresh() end
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
  local sizeBtn = sizeSection(c, resetBtn)
  p.updateSize = sizeBtn.Update
  local bottom
  p.voice, bottom = Options.VoiceSection(c, sizeBtn)
  p:SetScript("OnShow", function(self)
    for _, cb in ipairs(self.checks) do cb:SetChecked(LoreForeverDB.settings[cb.key] and true or false) end
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
