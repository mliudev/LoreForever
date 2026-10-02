-- Settings page (Esc > Options > AddOns > Lore Forever), with the same toggles as the /lore commands.

local _, ns = ...
local Options = {}
ns.Options = Options

Options.DEFAULTS = {
  zoneNudge = true,        -- chat hint with a clickable question when entering a zone that has lore
  dungeonPrimer = true,    -- chat link to the dungeon primer when entering a dungeon
  unitTooltips = true,     -- one-line lore on NPC and mob tooltips
  itemTooltips = true,     -- quest notes on item tooltips
  launcher = true,         -- book button beside the game's menu bar
  minimap = true,          -- minimap button (turned on once for installs from before it was the default: Log.Init)
  typing = true,           -- answers type in quickly instead of appearing at once
  showSpoilers = false,    -- show answers marked as spoilers without asking first
  readAloud = true,        -- "Read aloud" (the game's text-to-speech) for answers without a recorded narration
  narrateFlights = false,  -- read zone lore aloud on taxi flights
  packHints = true,        -- say (once a session per zone) when its places and people are in a lands pack you lack
  journey = true,          -- "Remember my journey": record places, people, quests and foes for the Journey tab
  language = "auto",       -- "auto" (the game client's language), "enUS" or a language pack's locale
  voicePack = "auto",      -- narration voice: "auto" (default pack), "none" (game voice only) or a pack's add-on name
}

local L = ns.L

local VOICES_URL = "loreforeverwow.com/voices"
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
  if bg.SetColorTexture then bg:SetColorTexture(0.05, 0.05, 0.08, 0.97) else bg:SetTexture(0.05, 0.05, 0.08, 0.97) end
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
      local mark = ch.value == current and "|cffffd100> |r" or "   "
      local extra = (ch.why or ch.note) and ("|cff888888 - " .. (ch.why or ch.note) .. "|r") or ""
      r.text:SetText(mark .. (ch.why and ("|cff888888" .. ch.label .. "|r") or ch.label) .. extra)
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
  local n = c:CreateFontString(nil, "ARTWORK", font or "GameFontDisableSmall")
  n:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -(gap or 6))
  n:SetPoint("RIGHT", c, "RIGHT", -24, 0)
  n:SetJustifyH("LEFT")
  n:SetText(text)
  return n
end

-- "Get more …:" and a read-only, selectable web address next to it, under `anchor` (`gap` below it). Add-ons can't
-- open a browser, so players copy the address. Returns the label (to anchor what comes next), the box and its refill.
local function urlRow(c, label, address, anchor, gap)
  local text = c:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
  text:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -gap)
  text:SetText(label)
  local url = CreateFrame("EditBox", nil, c, "InputBoxTemplate")
  url:SetSize(220, 20)
  url:SetPoint("LEFT", text, "RIGHT", 12, 0)
  url:SetAutoFocus(false)
  if url.SetFontObject and _G.ChatFontNormal then url:SetFontObject(ChatFontNormal) end
  url:SetTextColor(1, 1, 1)
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

-- The Narration voice section: a drop-down of voices, Preview, a status line and where to get more voices.
-- Placed under `anchor`; returns the section and its last line, for whatever comes next.
function Options.VoiceSection(c, anchor)
  local head = heading(c, L["Narration voice"], anchor, 24)
  local pick, list = dropDown("LoreForeverVoicePick", c, 320)
  pick:SetPoint("TOPLEFT", head, "BOTTOMLEFT", 2, -6)
  local preview = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
  preview:SetSize(90, 24)
  preview:SetPoint("LEFT", pick, "RIGHT", 8, 0)
  preview:SetText(L["Preview"])
  fit(preview, 90)
  local status = note(c, "", pick, 8, "GameFontHighlightSmall")
  local moreLabel, url, fillUrl = urlRow(c, L["Get more voices:"], VOICES_URL, status, 14)
  local hint = note(c, L["Installed a voice? Restart the game (a /reload isn't enough), then pick it here."],
    moreLabel, 10)

  local section = {}
  local function current() return (LoreForeverDB and LoreForeverDB.settings.voicePack) or "auto" end

  function section.Update()
    local choices = ns.Voice.Choices()
    local label = choices[1].label
    for _, ch in ipairs(choices) do if ch.value == current() then label = ch.label end end
    pick:SetText(label)
    status:SetText(ns.Voice.Status())
    fillUrl()
    section.choices = choices
  end

  local function choose(ch)
    list:Hide()
    local ok, why = ns.Voice.SetPack(ch.value)
    section.Update()
    if not ok then
      status:SetText("|cffff7070" .. string.format(L["%s: %s."], ch.label, why) .. "|r " .. ns.Voice.Status())
    end
  end

  function section.OpenList()
    section.Update()
    list.Open(section.choices, current(), choose)
  end

  pick:SetScript("OnClick", function() if list:IsShown() then list:Hide() else section.OpenList() end end)
  preview:SetScript("OnClick", function()
    list:Hide()
    if not ns.Voice.Preview(current()) then
      status:SetText(ns.Voice.Status() .. " |cffff7070" .. L["(Nothing to preview.)"] .. "|r")
    end
  end)
  section.pick, section.list, section.status, section.preview, section.url = pick, list, status, preview, url
  return section, hint
end

-- Built when the panel is, after the language pack has loaded.
local function rows()
  return {
    { "zoneNudge", L["Zone hints"], L["When you enter a zone, suggest a question about it in chat."] },
    { "dungeonPrimer", L["Dungeon primer prompt"], L["When you enter a dungeon, link its primer in chat."] },
    { "unitTooltips", L["Lore on NPC tooltips"], L["Add a one-line story to the tooltip of NPCs and mobs."] },
    { "itemTooltips", L["Notes on item tooltips"], L["Say when an item is wanted for a quest or starts one."] },
    { "launcher", L["Menu bar button"], L["Show the book button beside the game's menu bar. Drag it to move it."] },
    { "minimap", L["Minimap button"], L["Also show a book button on the minimap."] },
    { "typing", L["Typing animation"], L["Answers type in quickly. Click an answer to show it all at once."] },
    { "showSpoilers", L["Show spoilers without asking"], L["Answers that give away a quest's twist or ending normally ask before revealing. Tick this to always show them."] },
    { "readAloud", L["Read aloud"], L["Offer \"Read aloud\" with the game's own voice for answers without a recorded narration. Pick the voice in Options > Accessibility > Text to Speech."] },
    { "narrateFlights", L["Narrate flights"], L["Read the story of each zone aloud while on a flight path."] },
    { "packHints", L["Narration pack hints"], L["When you enter a zone whose places and people are narrated in a voice pack you don't have, say so once."] },
    { "journey", L["Remember my journey"], L["Keep track of the places you discover, the people you meet, the foes you defeat and the quests you finish, for the Journey tab. It stays on your PC."] },
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
    local desc = c:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
    desc:SetPoint("TOPLEFT", cb, "BOTTOMLEFT", 30, 4)
    desc:SetPoint("RIGHT", c, "RIGHT", -24, 0)
    desc:SetJustifyH("LEFT")
    desc:SetText(tip)
    cb:SetScript("OnClick", function(self)
      LoreForeverDB.settings[key] = self:GetChecked() and true or false
      if key == "minimap" and ns.MinimapButton then ns.MinimapButton() end
      if key == "launcher" and ns.LauncherButton then ns.LauncherButton() end
      if key == "readAloud" and p.voice then p.voice.Update() end
      if key == "journey" and ns.Journey then ns.Journey.OnToggle() end
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
  local bottom
  p.voice, bottom = Options.VoiceSection(c, keyBtn)
  p:SetScript("OnShow", function(self)
    for _, cb in ipairs(self.checks) do cb:SetChecked(LoreForeverDB.settings[cb.key] and true or false) end
    self.updateLanguage()
    self.voice.Update()
    -- Scroll height: from the top of the content to its last line, once the game has laid the text out.
    local w = sf.GetWidth and sf:GetWidth()
    if type(w) == "number" and w > 0 then c:SetWidth(w) end
    local top, low = c.GetTop and c:GetTop(), bottom.GetBottom and bottom:GetBottom()
    if type(top) == "number" and type(low) == "number" and top > low then c:SetHeight(top - low + 24) end
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

function Options.Open()
  if InCombatLockdown and InCombatLockdown() then
    DEFAULT_CHAT_FRAME:AddMessage("|cffffd100Lore Forever:|r " .. L["options open after combat."])
    return
  end
  local cat = Options.category
  if cat and _G.Settings and Settings.OpenToCategory then
    Settings.OpenToCategory(cat.GetID and cat:GetID() or cat)
  elseif _G.InterfaceOptionsFrame_OpenToCategory and Options.panel then
    InterfaceOptionsFrame_OpenToCategory(Options.panel)
  end
end

-- Right-click on the book and minimap buttons: close the settings window if it's showing Lore Forever's page,
-- otherwise open it there (also when it's open on another add-on's page).
function Options.Toggle()
  local p, win = Options.panel, _G.SettingsPanel or _G.InterfaceOptionsFrame
  -- The window itself must be showing: until it first displays our page, the page has no parent and counts as
  -- visible on its own, which made the first right-click try to close a window that wasn't open.
  if p and win and win:IsShown() and p:IsVisible() and _G.HideUIPanel then return HideUIPanel(win) end
  Options.Open()
end
