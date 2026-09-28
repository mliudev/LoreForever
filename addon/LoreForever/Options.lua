-- Settings page (Esc > Options > AddOns > Lore Forever), with the same toggles as the /lore commands.

local _, ns = ...
local Options = {}
ns.Options = Options

Options.DEFAULTS = {
  zoneNudge = true,        -- chat hint with a clickable question when entering a zone that has lore
  dungeonPrimer = true,    -- chat link to the dungeon primer when entering a dungeon
  unitTooltips = true,     -- one-line lore on NPC and mob tooltips
  itemTooltips = true,     -- quest/profession notes on item tooltips
  launcher = true,         -- book button beside the game's menu bar
  minimap = false,         -- minimap button (off: the launcher replaces it)
  typing = true,           -- answers type in quickly instead of appearing at once
  showSpoilers = false,    -- show answers marked as spoilers without asking first
  readAloud = true,        -- "Read aloud" (the game's text-to-speech) for answers without a recorded narration
  narrateFlights = false,  -- read zone lore aloud on taxi flights
  feedback = false,        -- Yes/No feedback buttons in the panel (playtests)
}

local ROWS = {
  { "zoneNudge", "Zone hints", "When you enter a zone, suggest a question about it in chat." },
  { "dungeonPrimer", "Dungeon primer prompt", "When you enter a dungeon, link its primer in chat." },
  { "unitTooltips", "Lore on NPC tooltips", "Add a one-line story to the tooltip of NPCs and mobs." },
  { "itemTooltips", "Notes on item tooltips", "Say when an item is wanted for a quest or your profession." },
  { "launcher", "Menu bar button", "Show the book button beside the game's menu bar. Drag it to move it." },
  { "minimap", "Minimap button", "Also show a book button on the minimap." },
  { "typing", "Typing animation", "Answers type in quickly. Click an answer to show it all at once." },
  { "showSpoilers", "Show spoilers without asking", "Answers that give away a quest's twist or ending normally ask "
    .. "before revealing. Tick this to always show them." },
  { "readAloud", "Read aloud", "Offer \"Read aloud\" with the game's own voice for answers without a recorded "
    .. "narration. Pick the voice in Options > Accessibility > Text to Speech." },
  { "narrateFlights", "Narrate flights", "Read the story of each zone aloud while on a flight path." },
  { "feedback", "Feedback buttons", "Show Yes/No buttons under answers (for playtesting)." },
}

function Options.Create()
  if Options.panel then return Options.panel end
  local p = CreateFrame("Frame", "LoreForeverOptions")
  p.name = "Lore Forever"
  local title = p:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("TOPLEFT", 16, -16)
  title:SetText("Lore Forever")
  local sub = p:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  sub:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -6)
  sub:SetText("Offline lore for the zones, quests and people around you. Lore adapted from warcraft.wiki.gg (CC BY-SA 4.0).")
  p.checks = {}
  local y = -64
  for _, row in ipairs(ROWS) do
    local key, label, tip = row[1], row[2], row[3]
    local cb = CreateFrame("CheckButton", nil, p, "UICheckButtonTemplate")
    cb:SetPoint("TOPLEFT", 14, y)
    local text = type(cb.Text) == "table" and cb.Text or nil
    if not text then
      text = cb:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
      text:SetPoint("LEFT", cb, "RIGHT", 4, 0)
    end
    text:SetText(label)
    local desc = p:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
    desc:SetPoint("TOPLEFT", cb, "BOTTOMLEFT", 30, 4)
    desc:SetWidth(560)
    desc:SetJustifyH("LEFT")
    desc:SetText(tip)
    cb:SetScript("OnClick", function(self)
      LoreForeverDB.settings[key] = self:GetChecked() and true or false
      if key == "minimap" and ns.MinimapButton then ns.MinimapButton() end
      if key == "launcher" and ns.LauncherButton then ns.LauncherButton() end
    end)
    cb.key = key
    p.checks[#p.checks + 1] = cb
    y = y - 44
  end
  local keyBtn = CreateFrame("Button", nil, p, "UIPanelButtonTemplate")
  keyBtn:SetSize(160, 24)
  keyBtn:SetPoint("TOPLEFT", 18, y - 8)
  keyBtn:SetText("Set panel key...")
  keyBtn:SetScript("OnClick", function() ns.Hooks.KeyPrompt("toggle"):Show() end)
  local narrBtn = CreateFrame("Button", nil, p, "UIPanelButtonTemplate")
  narrBtn:SetSize(180, 24)
  narrBtn:SetPoint("LEFT", keyBtn, "RIGHT", 10, 0)
  narrBtn:SetText("Set narration key...")
  narrBtn:SetScript("OnClick", function() ns.Hooks.KeyPrompt("narrate"):Show() end)
  p:SetScript("OnShow", function(self)
    for _, cb in ipairs(self.checks) do cb:SetChecked(LoreForeverDB.settings[cb.key] and true or false) end
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
    DEFAULT_CHAT_FRAME:AddMessage("|cffffd100Lore Forever:|r options open after combat.")
    return
  end
  local cat = Options.category
  if cat and _G.Settings and Settings.OpenToCategory then
    Settings.OpenToCategory(cat.GetID and cat:GetID() or cat)
  elseif _G.InterfaceOptionsFrame_OpenToCategory and Options.panel then
    InterfaceOptionsFrame_OpenToCategory(Options.panel)
  end
end
