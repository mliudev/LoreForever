-- Wiring: events, slash commands, key binding, minimap button, zone and dungeon nudges.

local addonName, ns = ...

BINDING_HEADER_LOREFOREVER = "Lore Forever"
BINDING_NAME_LOREFOREVER_TOGGLE = "Toggle Lore Forever panel"
BINDING_NAME_LOREFOREVER_NARRATE = "Play narration (what you hover, or where you are)"

local GOLD = "|cffffd100"
local PREFIX = GOLD .. "Lore Forever:|r "
local function say(msg) DEFAULT_CHAT_FRAME:AddMessage(PREFIX .. msg) end
local function S() return LoreForeverDB.settings end

-- The key binding and minimap button. Pressing the key while hovering an NPC with lore opens that NPC's entry.
function LoreForever_Toggle()
  if not ns.UI.frame then return end
  local h = ns.Hooks.hover
  local now = GetTime and GetTime() or 0
  if h and now - h.t < 2 and UnitExists and UnitExists("mouseover") then
    ns.Hooks.hover = nil
    return ns.UI.Open(h.key, nil, "hover")
  end
  ns.UI.Toggle()
end

-- The narration key: the NPC you're hovering if it has lore, otherwise the place you're in. Pressing it again while
-- it plays stops it. With the panel open the story also appears in the chat; closed, a chat line says what's playing.
function LoreForever_Narrate()
  local UI = ns.UI
  if not UI.frame then return end
  UI.ctx = ns.Context.Snapshot()
  local h, now = ns.Hooks.hover, GetTime and GetTime() or 0
  local key = h and now - h.t < 2 and UnitExists and UnitExists("mouseover") and h.key or nil
  local target = (key and UI.EntryTarget(key)) or UI.ZoneTarget()
  if not target then return say("there's no narration for this place yet.") end
  if UI.speaking and UI.playingId == target.id then return UI.ListenTo(target) end
  local name = ns.DB.entries[target.key].n
  if UI.frame:IsShown() then
    UI.PlayEntry(target.key, "Tell me the story of " .. name)
  else
    UI.ListenTo(target)
    if UI.speaking then
      local k = ns.Hooks.CurrentKey("narrate")
      say("now playing: " .. name .. ". " .. ns.Hooks.Link("Read along", "entry", target.key)
        .. (k and (" (" .. k .. " again to stop)") or ""))
    end
  end
end

-- Registering an event the client doesn't know throws on the Forever beta, so guard each one.
local events = CreateFrame("Frame")
local function listen(name)
  local ok = pcall(events.RegisterEvent, events, name)
  if not ok and ns.debug then say("event not available: " .. name) end
end

local nudged = {}
local function arrive()
  local zone = GetRealZoneText and GetRealZoneText()
  if not zone or zone == "" then return end
  local zk = ns.engine:ZoneKey(zone)
  local e = zk and ns.DB.entries["zone:" .. zk]
  ns.Log.Visit(zone, UnitLevel and UnitLevel("player"), e ~= nil)
  if not e or nudged[zone] then return end
  nudged[zone] = true
  local z = ns.DB.zones[zk]
  local inInstance = IsInInstance and IsInInstance()
  local listen = ns.Voice.HasAudio("zone:" .. zk) and (" " .. ns.Hooks.Link("Listen", "listen", "zone:" .. zk)) or ""
  if z and z.t == "dungeon" and inInstance then
    if S().dungeonPrimer then
      say("Entering " .. z.n .. ". " .. ns.Hooks.Link("Dungeon primer", "primer", zk) .. listen)
    end
  elseif S().zoneNudge then
    local f = e.faq and e.faq[1]
    say("You've entered " .. zone .. "." .. (f and (" " .. ns.Hooks.Link(f.q, "faq", "zone:" .. zk, 1)) or "")
      .. listen)
  end
end

local refreshPending = false
local function refreshSoon()
  if refreshPending then return end
  refreshPending = true
  C_Timer.After(0.5, function()
    refreshPending = false
    ns.UI.Refresh()
  end)
end

-- Minimal JSON for /lore export (copy context out for bug reports or live-mode testing).
local function toJSON(v)
  local t = type(v)
  if t == "table" then
    if #v > 0 or next(v) == nil then
      local parts = {}
      for _, x in ipairs(v) do parts[#parts + 1] = toJSON(x) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local parts = {}
    for k, x in pairs(v) do parts[#parts + 1] = string.format("%q:%s", tostring(k), toJSON(x)) end
    return "{" .. table.concat(parts, ",") .. "}"
  elseif t == "string" then
    return string.format("%q", v):gsub("\\\n", "\\n")
  elseif t == "number" or t == "boolean" then
    return tostring(v)
  end
  return "null"
end

local function showExport(text)
  if not LoreForeverExport then
    local f = CreateFrame("Frame", "LoreForeverExport", UIParent, "BasicFrameTemplateWithInset")
    f:SetSize(520, 320)
    f:SetPoint("CENTER")
    f:SetFrameStrata("DIALOG")
    table.insert(UISpecialFrames, "LoreForeverExport")
    local sf = CreateFrame("ScrollFrame", nil, f, "UIPanelScrollFrameTemplate")
    sf:SetPoint("TOPLEFT", 12, -30)
    sf:SetPoint("BOTTOMRIGHT", -32, 12)
    local eb = CreateFrame("EditBox", nil, sf)
    eb:SetMultiLine(true)
    eb:SetFontObject(ChatFontNormal)
    eb:SetWidth(460)
    eb:SetAutoFocus(true)
    eb:SetScript("OnEscapePressed", function() f:Hide() end)
    sf:SetScrollChild(eb)
    f.eb = eb
  end
  LoreForeverExport.eb:SetText(text)
  LoreForeverExport.eb:HighlightText()
  LoreForeverExport:Show()
end

-- The book button beside the game's menu bar (character, spellbook, Dungeon Finder...). It sits next to that bar
-- rather than inside it, since the bar is Blizzard's and managed by Edit Mode. Drag it anywhere.
function ns.LauncherButton()
  local b = LoreForeverLauncher
  if b then return b:SetShown(S().launcher) end
  if not S().launcher then return end
  b = CreateFrame("Button", "LoreForeverLauncher", UIParent)
  b:SetSize(30, 30)
  b:SetFrameStrata("MEDIUM")
  b:SetMovable(true)
  b:SetClampedToScreen(true)
  local icon = b:CreateTexture(nil, "ARTWORK")
  icon:SetTexture("Interface\\Icons\\INV_Misc_Book_09")
  icon:SetAllPoints()
  icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)
  local border = b:CreateTexture(nil, "OVERLAY")
  border:SetTexture("Interface\\Buttons\\UI-Quickslot2")
  border:SetPoint("CENTER")
  border:SetSize(52, 52)
  b:SetHighlightTexture("Interface\\Buttons\\ButtonHilight-Square", "ADD")
  b:SetPushedTexture("Interface\\Buttons\\UI-Quickslot-Depress")
  local pos = S().launcherPos
  local bar = _G.MicroMenuContainer or _G.MicroMenu or (_G.CharacterMicroButton and CharacterMicroButton:GetParent())
  if pos then
    b:SetPoint(pos[1], UIParent, pos[1], pos[2], pos[3])
  elseif bar and bar ~= UIParent then
    b:SetPoint("RIGHT", bar, "LEFT", -6, 0)
  else
    b:SetPoint("BOTTOMRIGHT", UIParent, "BOTTOMRIGHT", -320, 6)
  end
  b:RegisterForDrag("LeftButton")
  b:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  b:SetScript("OnDragStart", b.StartMoving)
  b:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
    local point, _, _, x, y = self:GetPoint()
    S().launcherPos = { point, x, y }
  end)
  b:SetScript("OnClick", function(_, button)
    if button == "RightButton" then ns.Options.Open() else LoreForever_Toggle() end
  end)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_TOP")
    GameTooltip:AddLine("Lore Forever")
    local key = ns.Hooks.CurrentKey()
    GameTooltip:AddLine("Click to open" .. (key and (" (or press " .. key .. ")") or "") .. ". Right-click for options.", 1, 1, 1)
    GameTooltip:AddLine("Drag to move.", 0.6, 0.6, 0.6)
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  -- While anything plays, a Stop button sits on the book, so narration can be stopped with the panel closed.
  local stop = CreateFrame("Button", nil, b, "UIPanelButtonTemplate")
  stop:SetSize(48, 18)
  stop:SetPoint("BOTTOM", b, "TOP", 0, 2)
  stop:SetText("Stop")
  stop:SetScript("OnClick", function() ns.UI.StopAll() end)
  stop:Hide()
  b.stop = stop
end

function ns.MinimapButton()
  if not Minimap then return end
  local b = LoreForeverMinimapButton
  if b then return b:SetShown(S().minimap) end
  if not S().minimap then return end
  b = CreateFrame("Button", "LoreForeverMinimapButton", Minimap)
  b:SetSize(31, 31)
  b:SetFrameStrata("MEDIUM")
  b:SetFrameLevel(8)
  local icon = b:CreateTexture(nil, "BACKGROUND")
  icon:SetTexture("Interface\\Icons\\INV_Misc_Book_09")
  icon:SetSize(20, 20)
  icon:SetPoint("CENTER")
  local border = b:CreateTexture(nil, "OVERLAY")
  border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
  border:SetSize(53, 53)
  border:SetPoint("TOPLEFT")
  b:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")
  local function place()
    local a = math.rad(S().minimapAngle or 200)
    b:ClearAllPoints()
    b:SetPoint("CENTER", Minimap, "CENTER", math.cos(a) * 80, math.sin(a) * 80)
  end
  place()
  b:RegisterForDrag("LeftButton")
  b:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  b:SetScript("OnDragStart", function(self)
    self:SetScript("OnUpdate", function()
      local mx, my = Minimap:GetCenter()
      local cx, cy = GetCursorPosition()
      local s = Minimap:GetEffectiveScale()
      S().minimapAngle = math.deg(math.atan2(cy / s - my, cx / s - mx))
      place()
    end)
  end)
  b:SetScript("OnDragStop", function(self) self:SetScript("OnUpdate", nil) end)
  b:SetScript("OnClick", function(_, button)
    if button == "RightButton" then ns.Options.Open() else LoreForever_Toggle() end
  end)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:AddLine("Lore Forever")
    local key = ns.Hooks.CurrentKey()
    GameTooltip:AddLine("Click to open" .. (key and (" (or press " .. key .. ")") or "") .. ". Right-click for options.", 1, 1, 1)
    GameTooltip:AddLine("Drag to move.", 0.6, 0.6, 0.6)
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
end

events:SetScript("OnEvent", function(_, event, arg1, ...)
  if event == "ADDON_LOADED" and arg1 == addonName then
    ns.Log.Init()
  elseif event == "PLAYER_LOGIN" then
    ns.engine = ns.Engine.new(ns.DB)
    ns.UI.Create(ns.engine)
    ns.Hooks.Init()
    ns.Options.Create()
    ns.LauncherButton()
    ns.MinimapButton()
    local key = ns.Hooks.CurrentKey()
    say(string.format("%d lore entries ready. %s, or click the book beside your menu bar.", ns.DB.count or 0,
      key and ("Press " .. GOLD .. key .. "|r") or "Type /lore"))
    C_Timer.After(6, ns.Hooks.MaybeOnboard)
  elseif event == "PLAYER_ENTERING_WORLD" or event == "ZONE_CHANGED_NEW_AREA" then
    C_Timer.After(2, arrive)
    C_Timer.After(1, ns.Voice.OnTaxiCheck)
    refreshSoon()
  elseif event == "QUEST_LOG_UPDATE" then
    ns.Hooks.RefreshQuests()
    ns.Hooks.UpdateQuestLogButton()
    refreshSoon()
  elseif event == "SKILL_LINES_CHANGED" then
    ns.Hooks.RefreshProfessions()
    refreshSoon()
  elseif event == "BAG_UPDATE_DELAYED" then
    ns.Hooks.RefreshBags()
    refreshSoon()
  elseif event == "ZONE_CHANGED" or event == "ZONE_CHANGED_INDOORS" or event == "PLAYER_TARGET_CHANGED" then
    refreshSoon()
  elseif event == "PLAYER_REGEN_DISABLED" then
    ns.Hooks.OnCombat()
  elseif event == "PLAYER_LOGOUT" then
    if ns.UI.msgs then ns.UI.Archive() end   -- keep the last chat of the session in History
  elseif event == "VOICE_CHAT_TTS_PLAYBACK_STARTED" then
    ns.Voice.OnTTSStarted(arg1, ...)
  elseif event == "VOICE_CHAT_TTS_PLAYBACK_FINISHED" or event == "VOICE_CHAT_TTS_PLAYBACK_FAILED" then
    if ns.Voice.OnTTSFinished(event, arg1, ...) then ns.UI.UpdateListen() end
  elseif event == "PLAYER_CONTROL_LOST" then
    C_Timer.After(1, ns.Voice.OnTaxiCheck)
  elseif event == "QUEST_DETAIL" or event == "QUEST_PROGRESS" or event == "QUEST_COMPLETE" then
    ns.Log.QuestText(event == "QUEST_DETAIL" and "detail" or event == "QUEST_PROGRESS" and "progress" or "complete")
    ns.Hooks.UpdateQuestDialogButton()
  end
end)

for _, e in ipairs({ "ADDON_LOADED", "PLAYER_LOGIN", "PLAYER_ENTERING_WORLD", "ZONE_CHANGED", "ZONE_CHANGED_INDOORS",
  "ZONE_CHANGED_NEW_AREA", "QUEST_LOG_UPDATE", "BAG_UPDATE_DELAYED", "SKILL_LINES_CHANGED", "QUEST_DETAIL",
  "QUEST_PROGRESS", "QUEST_COMPLETE", "PLAYER_TARGET_CHANGED", "PLAYER_CONTROL_LOST",
  "VOICE_CHAT_TTS_PLAYBACK_STARTED", "VOICE_CHAT_TTS_PLAYBACK_FINISHED", "VOICE_CHAT_TTS_PLAYBACK_FAILED",
  "PLAYER_REGEN_DISABLED", "PLAYER_LOGOUT" }) do
  listen(e)
end

local function toggleSetting(key, label)
  S()[key] = not S()[key]
  say(label .. " " .. (S()[key] and "on" or "off"))
end

SLASH_LOREFOREVER1 = "/lore"
SLASH_LOREFOREVER2 = "/lf"
SlashCmdList.LOREFOREVER = function(msg)
  msg = (msg or ""):match("^%s*(.-)%s*$")
  local cmd = msg:lower()
  if cmd == "" then
    LoreForever_Toggle()
  elseif cmd == "help" then
    say("/lore - open or close the panel (or press your key; press it over an NPC to read about them)")
    say("/lore <question> - ask directly, e.g. /lore why is westfall so poor")
    say("/lore key - choose the key that opens the panel; /lore key narrate - a key that plays narration")
    say("/lore narrations - every recorded narration, grouped (your starting area first)")
    say("/lore options - settings (tooltips, hints, flight narration)")
    say("/lore primer - dungeon primer for where you are")
    say("/lore listen - read the last answer aloud; /lore narrate - narrate flights on/off")
    say("/lore ctx | export | visits | stats - what Lore Forever sees, for bug reports and playtests")
  elseif cmd == "key" or cmd == "key narrate" then
    ns.Hooks.KeyPrompt(cmd == "key narrate" and "narrate" or "toggle"):Show()
  elseif cmd == "narrations" then
    if not ns.UI.frame:IsShown() then ns.UI.frame:Show() end
    ns.UI.ShowTab("narrations")
  elseif cmd == "options" or cmd == "config" or cmd == "settings" then
    ns.Options.Open()
  elseif cmd == "primer" then
    local zk = ns.engine:ZoneKey(GetRealZoneText and GetRealZoneText())
    local z = zk and ns.DB.zones[zk]
    if z and z.t == "dungeon" then ns.UI.ShowPrimer(zk, "slash") else say("you're not in a dungeon I know yet.") end
  elseif cmd == "listen" then
    -- The newest answer if there is one, otherwise the area you're in.
    local b = ns.UI.listenButton
    ns.UI.ListenTo((b and b.target) or ns.UI.ZoneTarget())
  elseif cmd == "ttstest" then
    ns.Voice.Test()
  elseif cmd == "stop" then
    ns.UI.StopAll()
  elseif cmd == "narrate" then
    toggleSetting("narrateFlights", "flight narration")
  elseif cmd == "nudge" then
    toggleSetting("zoneNudge", "zone hints")
  elseif cmd == "tooltips" then
    S().unitTooltips = not S().unitTooltips
    S().itemTooltips = S().unitTooltips
    say("tooltip lore " .. (S().unitTooltips and "on" or "off"))
  elseif cmd == "feedback" then
    toggleSetting("feedback", "feedback buttons")
  elseif cmd == "ctx" then
    local c = ns.Context.Snapshot()
    say(string.format("zone=%s subzone=%s mapID=%s instance=%s target=%s", tostring(c.zone), tostring(c.subzone),
      tostring(c.mapID), tostring(c.instance), tostring(c.targetName)))
    say(string.format("%s %s level %s (%s), professions: %s", tostring(c.raceName), tostring(c.className),
      tostring(c.level), tostring(c.faction), table.concat(c.professions, ", ")))
    for _, q in ipairs(c.quests) do
      local key = ns.DB.index.quest[q.id] or (q.title and ns.DB.index.questTitle[q.title:lower()])
      say(string.format("  quest %s: %s %s", tostring(q.id), tostring(q.title), key and "(has lore)" or "(no lore)"))
    end
    if #c.questItems > 0 then say("quest items: " .. table.concat(c.questItems, ", ")) end
    local zk = ns.engine:ZoneKey(c.zone)
    say("zone lore: " .. (zk and ("zone:" .. zk) or "none"))
  elseif cmd == "export" then
    showExport(toJSON(ns.Context.Snapshot()))
  elseif cmd == "visits" then
    local rows = {}
    for zone, v in pairs(LoreForeverDB.visits) do rows[#rows + 1] = { zone = zone, v = v } end
    table.sort(rows, function(a, b) return a.v.n > b.v.n end)
    say(#rows .. " zones visited this session:")
    for _, r in ipairs(rows) do
      say(string.format("  %s x%d (levels %s-%s)%s", r.zone, r.v.n, tostring(r.v.minLevel), tostring(r.v.maxLevel),
        r.v.lore and "" or "  |cff9d9d9dno lore|r"))
    end
  elseif cmd == "stats" then
    local n, known = 0, 0
    for _, q in ipairs(LoreForeverDB.questions) do if q.session == ns.Log.session then n = n + 1 end end
    for _ in pairs(LoreForeverDB.quests) do known = known + 1 end
    say(string.format("%d questions this session; %d quest texts captured. /reload or log out to save them.", n, known))
  elseif cmd == "debug" then
    ns.debug = not ns.debug
    say("debug " .. (ns.debug and "on" or "off"))
  else
    if not ns.UI.frame:IsShown() then ns.UI.frame:Show() end
    ns.UI.Ask(msg, "slash")
  end
end
