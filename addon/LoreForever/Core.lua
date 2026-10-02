-- Wiring: events, slash commands, key binding, minimap button, zone and dungeon nudges.

local addonName, ns = ...
local L = ns.L

-- Key binding names; set again at login once the language pack has loaded.
local function setBindingNames()
  BINDING_HEADER_LOREFOREVER = "Lore Forever"
  BINDING_NAME_LOREFOREVER_TOGGLE = L["Toggle Lore Forever panel"]
  BINDING_NAME_LOREFOREVER_NARRATE = L["Play narration (what you hover, or where you are)"]
  BINDING_NAME_LOREFOREVER_PLAYLIST = L["Play/pause narration playlist"]
  BINDING_NAME_LOREFOREVER_PLAYLIST_NEXT = L["Next narration"]
end
setBindingNames()

local GOLD = "|cffffd100"
-- Goes through the site's /discord redirect, which counts clicks per source and can swap the invite.
local DISCORD_URL = "loreforeverwow.com/discord?src=addon"
local PREFIX = GOLD .. "Lore Forever:|r "
local function say(msg) DEFAULT_CHAT_FRAME:AddMessage(PREFIX .. msg) end
local function S() return LoreForeverDB.settings end

-- The entry for the NPC under the mouse, read when the key is pressed (not from when its tooltip was built, which
-- can be long before, or never with tooltip lore turned off).
local function hoverKey()
  local name = ns.Context.NPCName("mouseover")
  local key = name and ns.engine and ns.engine:KeyForName(name)
  return key and ns.DB.entries[key] and key or nil
end

-- The key binding and the panel toggle. Pressing the key while hovering an NPC with lore opens that NPC's entry;
-- when the conversation is already on that NPC, the key just opens or closes the panel (no second copy of their lore).
-- Opening the panel with a boss or anyone in particular targeted also opens their story (UI.OpenTarget), so
-- "target them, click the book" works; the click itself still only opens the panel.
function LoreForever_Toggle()
  local UI = ns.UI
  if not UI.frame then return end
  local key = hoverKey()
  if key and UI.engine.lastKey ~= key then return UI.Open(key, nil, "hover") end
  if not UI.frame:IsShown() and UI.OpenTarget() then return end
  UI.Toggle()
end

-- Play/pause for the key binding and Shift-click: stop whatever plays, otherwise play the playlist. With nothing
-- queued, queue and play everything narrated where you are; if there's none, say how to fill the playlist.
local function playlistPlayPause()
  local UI = ns.UI
  if not UI.frame then return end
  if UI.IsBusy() then return UI.StopAll() end
  if not UI.PlaylistToggle() and UI.QueueHere() == 0 then
    say(L["nothing here is narrated, and your playlist is empty. Press + on any narration (Narrations tab) to add it."])
  end
end

function LoreForever_PlaylistToggle()
  playlistPlayPause()
end

function LoreForever_PlaylistNext()
  if ns.UI.frame and not ns.UI.PlaylistNext() then
    say(L["your playlist is empty. Press + on any narration (Narrations tab) to add it."])
  end
end

-- The narration key: the NPC you're hovering if it has lore, otherwise the place you're in. Pressing it again while
-- it plays stops it. With the panel open the story also appears in the chat; closed, a chat line says what's playing.
function LoreForever_Narrate()
  local UI = ns.UI
  if not UI.frame then return end
  UI.ctx = ns.Context.Snapshot()
  local key = hoverKey()
  local target = (key and UI.EntryTarget(key)) or UI.ZoneTarget()
  if not target then return say(L["there's no narration for this place yet."]) end
  if UI.speaking and UI.playingId == target.id then return UI.ListenTo(target) end
  local name = ns.DB.entries[target.key].n
  if UI.frame:IsShown() then
    UI.PlayEntry(target.key, string.format(L["Tell me the story of %s"], name))
  else
    UI.ListenTo(target)
    if UI.speaking then
      local k = ns.Hooks.CurrentKey("narrate")
      local link = ns.Hooks.Link(L["Read along"], "entry", target.key)
      say(k and string.format(L["now playing: %s. %s (%s again to stop)"], name, link, k)
        or string.format(L["now playing: %s. %s"], name, link))
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
  ns.Voice.OnZone(zk)   -- its places and people are in a lands pack you don't have: say so, once
  if not e or nudged[zone] then return end
  nudged[zone] = true
  local z = ns.DB.zones[zk]
  local inInstance = IsInInstance and IsInInstance()
  local listen = ns.Voice.HasAudio("zone:" .. zk) and (" " .. ns.Hooks.Link(L["Listen"], "listen", "zone:" .. zk)) or ""
  if z and z.t == "dungeon" and inInstance then
    if S().dungeonPrimer then
      say(string.format(L["Entering %s. %s"], z.n, ns.Hooks.Link(L["Dungeon primer"], "primer", zk)) .. listen)
    end
  elseif S().zoneNudge then
    local fi = ns.Engine.RankedFaq(e, ns.engine.race)[1]   -- the most obvious question about the place
    local f = fi and e.faq[fi]
    say(string.format(L["You've entered %s."], zone)
      .. (f and (" " .. ns.Hooks.Link(f.q, "faq", "zone:" .. zk, fi)) or "") .. listen)
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

-- Clicks on the book and minimap buttons (Mike, 2026-09-30): each click always does the same thing. Plain clicks
-- open things, Shift-clicks are the playlist. Ctrl and Alt are left free.
--   click              open/close Lore Forever
--   right-click        open/close Options
--   shift-click        play/pause: stop whatever plays (a playlist keeps its place), else play the playlist, or with
--                      an empty playlist everything narrated where you are
--   shift-right-click  next narration in the playlist
local function buttonClick(button)
  local UI = ns.UI
  if IsShiftKeyDown and IsShiftKeyDown() then
    if not UI.frame then return end
    if button == "RightButton" then return UI.PlaylistNext() end
    return playlistPlayPause()
  end
  if button == "RightButton" then return ns.Options.Toggle() end
  LoreForever_Toggle()
end

-- The tooltip: what's playing (or where the playlist stopped), then the same four clicks every time.
local function buttonTooltip(self, anchor)
  local UI = ns.UI
  local pl, busy = UI.pl, UI.IsBusy()
  local n, cur = #pl.items, pl.items[pl.pos]
  GameTooltip:SetOwner(self, anchor)
  GameTooltip:AddLine("Lore Forever")
  if busy then
    local ours = pl.state == "playing" and cur
    GameTooltip:AddLine(ours and string.format(L["Now playing: %s (%d of %d)"], cur.label, pl.pos, n)
      or string.format(L["Now playing: %s"], UI.playingLabel or L["narration"]), 0.5, 0.87, 0.5)
    local nxt = ours and pl.items[pl.pos + 1]
    if nxt then GameTooltip:AddLine(string.format(L["Up next: %s"], nxt.label), 0.6, 0.6, 0.6) end
  elseif cur then
    GameTooltip:AddLine(string.format(L["Playlist stopped at: %s (%d of %d)"], cur.label, pl.pos, n), 1, 0.82, 0)
  end
  local key = ns.Hooks.CurrentKey()
  GameTooltip:AddLine(key and string.format(L["Click to open (or press %s). Right-click for options."], key)
    or L["Click to open. Right-click for options."], 1, 1, 1)
  GameTooltip:AddLine(L["Shift-click: play/pause your playlist"], 1, 1, 1)
  GameTooltip:AddLine(L["Shift-right-click: next narration"], 1, 1, 1)
  if n == 0 then
    GameTooltip:AddLine(L["Your playlist is empty: Shift-click plays everything narrated here."], 0.6, 0.6, 0.6, true)
  end
  GameTooltip:AddLine(L["Drag to move."], 0.6, 0.6, 0.6)
  GameTooltip:Show()
end

-- The "something is playing" look. The square book gets a pulsing green glow and a small play arrow in the corner;
-- the round minimap button just turns its ring green (a green copy of the gold ring, laid over it).
local function addPlayingIndicator(b, glowSize, round)
  local glow = b:CreateTexture(nil, "OVERLAY", nil, 1)
  if round then
    glow:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
    if glow.SetDesaturated then glow:SetDesaturated(true) end
    glow:SetVertexColor(0.35, 1, 0.35)
    glow:SetSize(53, 53)
    glow:SetPoint("TOPLEFT")
  else
    glow:SetTexture("Interface\\Buttons\\UI-ActionButton-Border")
    glow:SetBlendMode("ADD")
    glow:SetVertexColor(0.4, 1, 0.4)
    glow:SetSize(glowSize, glowSize)
    glow:SetPoint("CENTER")
  end
  glow:Hide()
  local badge = b:CreateTexture(nil, "OVERLAY", nil, 2)
  badge:SetTexture("Interface\\Buttons\\UI-SpellbookIcon-NextPage-Up")
  badge:SetSize(16, 16)
  badge:SetPoint("BOTTOMRIGHT", 5, -5)
  badge:Hide()
  b.noBadge = round
  local pulse = glow.CreateAnimationGroup and glow:CreateAnimationGroup()
  if pulse then
    pulse:SetLooping("BOUNCE")
    local a = pulse:CreateAnimation("Alpha")
    if a then
      a:SetFromAlpha(1)
      a:SetToAlpha(0.3)
      a:SetDuration(0.8)
    end
  end
  b.glow, b.badge, b.pulse = glow, badge, pulse
  b:SetScript("OnClick", function(_, button) buttonClick(button) end)
end

-- Called whenever playback or the playlist changes (UI.UpdateNowPlaying), whatever caused it. An open tooltip is
-- rebuilt so it never shows a stale "Now playing".
function ns.SetButtonsPlaying(on)
  for _, b in ipairs({ _G.LoreForeverLauncher or false, _G.LoreForeverMinimapButton or false }) do
    if b and b.glow then
      if b.playing ~= on then
        b.playing = on
        b.glow:SetShown(on)
        b.badge:SetShown(on and not b.noBadge)
        if b.pulse then if on then b.pulse:Play() else b.pulse:Stop() end end
      end
      if GameTooltip.IsOwned and GameTooltip:IsOwned(b) then b:GetScript("OnEnter")(b) end
    end
  end
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
  addPlayingIndicator(b, 58)
  b:SetScript("OnEnter", function(self) buttonTooltip(self, "ANCHOR_TOP") end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  -- While anything plays, a Stop button sits on the book, so narration can be stopped with the panel closed.
  local stop = CreateFrame("Button", nil, b, "UIPanelButtonTemplate")
  stop:SetSize(48, 18)
  stop:SetPoint("BOTTOM", b, "TOP", 0, 2)
  stop:SetText(L["Stop"])
  stop:SetScript("OnClick", function() ns.UI.StopAll() end)
  stop:Hide()
  b.stop = stop
  ns.SetButtonsPlaying(ns.UI.IsBusy())
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
  addPlayingIndicator(b, 56, true)
  b:SetScript("OnEnter", function(self) buttonTooltip(self, "ANCHOR_LEFT") end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  ns.SetButtonsPlaying(ns.UI.IsBusy())
end

events:SetScript("OnEvent", function(_, event, arg1, ...)
  if event == "ADDON_LOADED" and arg1 == addonName then
    ns.Log.Init()
  elseif event == "PLAYER_LOGIN" then
    ns.Lang.Init()   -- scans packs; the language pack, if any, goes in before the engine indexes the text
    setBindingNames()
    ns.engine = ns.Engine.new(ns.DB)
    -- Before the voice: chapter recordings join its clip list. Its errors are reported, never fatal to the rest.
    local ok, err = pcall(ns.Journey.Init)
    if not ok and geterrorhandler then geterrorhandler()(err) end
    ns.Voice.Init()
    ns.UI.Create(ns.engine)
    ns.Hooks.Init()
    ns.Options.Create()
    ns.LauncherButton()
    ns.MinimapButton()
    local key, n = ns.Hooks.CurrentKey(), ns.DB.count or 0
    say(key and string.format(L["%d lore entries ready. Press %s, or click the book beside your menu bar."], n,
      GOLD .. key .. "|r") or string.format(L["%d lore entries ready. Type /lore, or click the book beside your menu bar."], n))
    for _, note in ipairs(ns.lang.notes) do say(note) end
    C_Timer.After(6, ns.Hooks.MaybeOnboard)
    C_Timer.After(3, ns.Journey.Announce)
  elseif event == "PLAYER_ENTERING_WORLD" or event == "ZONE_CHANGED_NEW_AREA" then
    C_Timer.After(2, arrive)
    C_Timer.After(1, ns.Voice.OnTaxiCheck)
    refreshSoon()
  elseif event == "QUEST_LOG_UPDATE" then
    ns.Hooks.RefreshQuests()
    ns.Hooks.UpdateQuestLogButton()
    refreshSoon()
  elseif event == "SKILL_LINES_CHANGED" then
    refreshSoon()
  elseif event == "BAG_UPDATE_DELAYED" then
    ns.Hooks.RefreshBags()
    refreshSoon()
  elseif event == "ZONE_CHANGED" or event == "ZONE_CHANGED_INDOORS" or event == "PLAYER_TARGET_CHANGED" then
    refreshSoon()
  elseif event == "PLAYER_REGEN_DISABLED" then
    ns.Hooks.OnCombat()
  elseif event == "PLAYER_REGEN_ENABLED" then
    ns.Voice.OnCombatEnded()
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
  "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED", "PLAYER_LOGOUT" }) do
  listen(e)
end

local function toggleSetting(key, label)
  S()[key] = not S()[key]
  say(string.format(S()[key] and L["%s on"] or L["%s off"], label))
end

-- /lore voice: list the narration voices (numbered, current one marked), or switch by number, name, auto or none.
local function findVoice(arg, choices)
  local want = arg:lower()
  if want == "default" then return choices[1] end
  for i, c in ipairs(choices) do
    if tostring(i) == want or c.value:lower() == want or c.label:lower() == want
      or (c.rec and (c.rec.name:lower() == "loreforever_voice_" .. want or c.rec.title:lower():find(want, 1, true))) then
      return c
    end
  end
end

-- "/lore voice <word>" is always the command; longer text that names no voice is a question ("voices of the dead").
local function isVoiceCommand(cmd, arg)
  if cmd == "voice" or cmd == "voices" then return true end
  if not (arg and cmd:match("^voices? ")) then return false end
  return not arg:find("%s") or findVoice(arg, ns.Voice.Choices()) ~= nil
end

local function voiceCommand(arg)
  local choices = ns.Voice.Choices()
  local current = S().voicePack or "auto"
  if not arg or arg == "" then
    say(L["narration voices (/lore voice <number> to switch):"])
    for i, c in ipairs(choices) do
      local mark = c.value == current and (GOLD .. " " .. L["(current)"] .. "|r") or ""
      local why = c.why or c.note
      say(string.format("  %d. %s%s%s", i, c.label, mark, why and ("|cff888888 - " .. why .. "|r") or ""))
    end
    say(ns.Voice.Status())
    return
  end
  local pick = findVoice(arg, choices)
  if not pick then return say(string.format(L["no voice called \"%s\". Type /lore voice to see the list."], arg)) end
  local ok, why = ns.Voice.SetPack(pick.value)
  if not ok then return say(string.format(L["%s: %s."], pick.label, why)) end
  say(string.format(L["narration voice: %s."], pick.label) .. " " .. ns.Voice.Status())
end

SLASH_LOREFOREVER1 = "/lore"
SLASH_LOREFOREVER2 = "/lf"
SlashCmdList.LOREFOREVER = function(msg)
  msg = (msg or ""):match("^%s*(.-)%s*$")
  local cmd = msg:lower()
  if cmd == "" then
    LoreForever_Toggle()
  elseif cmd == "help" then
    say(L["/lore - open or close the panel (or press your key; press it over an NPC to read about them)"])
    say(L["/lore <question> - ask directly, e.g. /lore why is westfall so poor"])
    say(L["/lore key - choose the key that opens the panel; /lore key narrate - a key that plays narration"])
    say(L["/lore narrations - every recorded narration, grouped (your starting area first)"])
    say(L["/lore journey - what your character has done so far; /lore sync - save it now (reloads)"])
    if ns.Companion.Installed() then
      say(L["/lore ask <question> - ask live answers (the answer appears on your screen)"])
    end
    say(L["/lore options - settings (tooltips, hints, flight narration)"])
    say(L["/lore lang - choose the language (language packs are separate add-ons)"])
    say(L["/lore primer - dungeon primer for where you are"])
    say(L["/lore listen - read the last answer aloud; /lore narrate - narrate flights on/off"])
    say(L["/lore voice - list narration voices; /lore voice <number or name> - switch (auto: default, none: game voice)"])
    say(L["/lore report - tell us the last answer was wrong (or click the cross under any answer)"])
    say(L["/lore ctx | export | visits | stats - what Lore Forever sees, for bug reports and playtests"])
    say(string.format(L["Questions, requests and bug reports: %s"], DISCORD_URL))
  elseif cmd == "key" or cmd == "key narrate" then
    ns.Hooks.KeyPrompt(cmd == "key narrate" and "narrate" or "toggle"):Show()
  elseif cmd == "narrations" then
    if not ns.UI.frame:IsShown() then ns.UI.frame:Show() end
    ns.UI.ShowTab("narrations")
  elseif cmd == "journey" then
    if not ns.UI.frame:IsShown() then ns.UI.frame:Show() end
    ns.UI.ShowTab("journey")
  elseif cmd == "sync" then
    ns.Journey.AskSync()
  elseif cmd == "ask" or cmd:match("^ask%s") then
    -- Live answers once the companion app is installed; until then it's an ordinary question.
    local question = msg:match("^%S+%s*(.-)$")
    if ns.Companion.Installed() then
      ns.Companion.Ask(question)
    else
      if not ns.UI.frame:IsShown() then ns.UI.frame:Show() end
      if question ~= "" then ns.UI.Ask(question, "slash") end
    end
  elseif isVoiceCommand(cmd, msg:match("^%S+%s+(.-)$")) then
    voiceCommand(msg:match("^%S+%s+(.-)$"))
  elseif cmd == "options" or cmd == "config" or cmd == "settings" then
    ns.Options.Open()
  elseif cmd == "primer" then
    local zk = ns.engine:ZoneKey(GetRealZoneText and GetRealZoneText())
    local z = zk and ns.DB.zones[zk]
    if z and z.t == "dungeon" then ns.UI.ShowPrimer(zk, "slash") else say(L["you're not in a dungeon I know yet."]) end
  elseif cmd == "listen" then
    -- The newest answer if there is one, otherwise the area you're in.
    local b = ns.UI.listenButton
    ns.UI.ListenTo((b and b.target) or ns.UI.ZoneTarget())
  elseif cmd == "ttstest" then
    ns.Voice.Test()
  elseif cmd == "stop" then
    ns.UI.StopAll()
  elseif cmd == "narrate" then
    toggleSetting("narrateFlights", L["flight narration"])
  elseif cmd == "nudge" then
    toggleSetting("zoneNudge", L["zone hints"])
  elseif cmd == "tooltips" then
    S().unitTooltips = not S().unitTooltips
    S().itemTooltips = S().unitTooltips
    say(string.format(S().unitTooltips and L["%s on"] or L["%s off"], L["tooltip lore"]))
  elseif cmd == "report" or cmd == "feedback" then
    -- Report the newest answer (the same box as the cross under it). /lore feedback used to turn on test buttons.
    if ns.UI.lastLog then ns.UI.ShowReport(ns.UI.lastLog) else say(L["ask something first, then report the answer."]) end
  elseif cmd == "ctx" then
    local c = ns.Context.Snapshot()
    say(string.format("zone=%s subzone=%s mapID=%s instance=%s target=%s", tostring(c.zone), tostring(c.subzone),
      tostring(c.mapID), tostring(c.instance), tostring(c.targetName)))
    say(string.format("%s %s level %s (%s), professions: %s", tostring(c.raceName), tostring(c.className),
      tostring(c.level), tostring(c.faction), table.concat(c.professions, ", ")))
    for _, q in ipairs(c.quests) do
      local key = ns.DB.index.quest[q.id] or (q.title and ns.DB.index.questTitle[ns.Engine.lower(q.title)])
      say(string.format("  quest %s: %s %s", tostring(q.id), tostring(q.title), key and "(has lore)" or "(no lore)"))
    end
    if #c.questItems > 0 then say("quest items: " .. table.concat(c.questItems, ", ")) end
    local zk = ns.engine:ZoneKey(c.zone)
    say("zone lore: " .. (zk and ("zone:" .. zk) or "none"))
  elseif cmd == "export" then
    local c = ns.Context.Snapshot()
    c.done = nil   -- every quest the character has finished: far too long for a bug report
    showExport(toJSON(c))
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
  elseif cmd == "lang" or cmd:match("^lang ") then
    local want = msg:match("^%S+%s+(%S+)")
    local choices = ns.Lang.Choices()
    local chosen
    for _, c in ipairs(choices) do
      if want and (c.id:lower() == want:lower() or (want:lower() == "en" and c.id == "enUS")) then chosen = c end
    end
    if chosen and not chosen.reason then
      -- Add-ons can't reload the interface themselves (ReloadUI is protected), so the player types /reload.
      ns.Lang.Set(chosen.id)
      say(string.format(L["language: %s."], chosen.label)
        .. (ns.Lang.NeedsReload() and (" " .. L["Type /reload to switch."]) or ""))
    else
      if want then say(string.format(L["no language \"%s\" to choose."], want)) end
      say(string.format(L["language now: %s. Choose with /lore lang <code>:"], ns.Lang.NameOf(ns.lang.locale)))
      for _, c in ipairs(choices) do
        say(string.format("  %s - %s%s", c.id, c.label, c.reason and (" (" .. c.reason .. ")") or ""))
      end
    end
  elseif cmd == "debug" then
    ns.debug = not ns.debug
    say("debug " .. (ns.debug and "on" or "off"))
  else
    if not ns.UI.frame:IsShown() then ns.UI.frame:Show() end
    ns.UI.Ask(msg, "slash")
  end
end
