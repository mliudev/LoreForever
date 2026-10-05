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

local T = ns.Theme
local GOLD = T.code.gold
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
    say(L["nothing here is narrated, and your playlist is empty. Press + on any narration in the Library to add it."])
  end
end

function LoreForever_PlaylistToggle()
  playlistPlayPause()
end

function LoreForever_PlaylistNext()
  if ns.UI.frame and not ns.UI.PlaylistNext() then
    say(L["your playlist is empty. Press + on any narration in the Library to add it."])
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
  ns.Voice.OnArrive()   -- play its narration, the first time you're here
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

-- A tip at login for features players ask for without knowing they exist (LOR-41): one per login, each shown once,
-- until they run out. Options › Tips at login turns them off. The first login after an update says what's new instead
-- (WhatsNew.lua), so it's still one line.
local function loginTip()
  if not S().tips then return end
  if ns.WhatsNew.LoginLine(say) then return end
  local key = ns.Hooks.CurrentKey()
  local tips = {
    key and string.format(L["Tip: hover over an NPC and press %s to read their story."], GOLD .. key .. "|r")
      or L["Tip: hover over an NPC and press your Lore Forever key (/lore key) to read their story."],
    L["Tip: entering a dungeon links its primer: who you'll face and why it matters. /lore primer brings it back."],
    L["Tip: the lore lines on NPC and item tooltips can be turned off in /lore options."],
    L["Tip: press + on any narration in the Library to build a playlist; the player at the bottom left plays it."],
    L["Tip: your journey can become a page about your character. Open Journey, click Copy my journey record and paste it at loreforeverwow.com/account."],
  }
  local i = (tonumber(S().tipNext) or 1)
  if i > #tips then return end
  S().tipNext = i + 1
  say(tips[i])
end

-- Another add-on can claim /lore too (Chronicle does, since its 1.0.0 betas). The chat then sends /lore to only one
-- of them, whichever its command list happens to hold first, so /lf and /loreforever stay ours alone. The first login
-- with such an add-on says in chat which command opens which, once per add-on.
local OWN_COMMANDS = { "/lf", "/loreforever" }

-- A SlashCmdList entry's commands in lower case: SLASH_<key>1, 2, ... up to the first missing one, as the chat reads them.
local function slashCommands(key)
  local out, i = {}, 1
  while type(_G["SLASH_" .. key .. i]) == "string" do
    out[#out + 1] = _G["SLASH_" .. key .. i]:lower()
    i = i + 1
  end
  return out
end

-- The title of the loaded add-on whose folder or title is a SlashCmdList key (CHRONICLE: "Chronicle"), if any.
local function addOnTitle(key)
  local C = _G.C_AddOns
  local count = (C and C.GetNumAddOns) or _G.GetNumAddOns
  local info = (C and C.GetAddOnInfo) or _G.GetAddOnInfo
  local loaded = (C and C.IsAddOnLoaded) or _G.IsAddOnLoaded
  if not (count and info and loaded) then return nil end
  local function bare(s) return (s:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")) end
  local function letters(s) return (s:upper():gsub("[^%w]", "")) end
  local want = letters(key)
  local okN, n = pcall(count)
  for i = 1, (okN and n) or 0 do
    local ok, name, title = pcall(info, i)
    if ok and type(name) == "string" then
      title = bare(type(title) == "string" and title ~= "" and title or name)
      local okL, isLoaded = pcall(loaded, name)
      if okL and isLoaded and (letters(name) == want or letters(title) == want) then return title end
    end
  end
end

local function checkSlashRivals()
  local ours, taken, rivals = {}, {}, {}
  for _, c in ipairs(slashCommands("LOREFOREVER")) do ours[c] = true end
  for key in pairs(SlashCmdList) do
    if type(key) == "string" and key ~= "LOREFOREVER" then
      local cmds = slashCommands(key)
      for _, c in ipairs(cmds) do
        taken[c] = true
        if c == "/lore" then rivals[#rivals + 1] = { key = key, cmds = cmds } end
      end
    end
  end
  if #rivals == 0 then return end
  local own
  for _, c in ipairs(OWN_COMMANDS) do
    if not own and not taken[c] then own = c end
  end
  own = own or OWN_COMMANDS[#OWN_COMMANDS]
  local s = S()
  local told = type(s.slashRivals) == "table" and s.slashRivals or {}
  for _, r in ipairs(rivals) do
    if not told[r.key] then
      told[r.key] = true
      s.slashRivals = told
      local title, theirs = addOnTitle(r.key), nil
      for _, c in ipairs(r.cmds) do
        if not theirs and c ~= "/lore" and not ours[c] then theirs = c end
      end
      if theirs then
        say(string.format(L["%s also uses /lore, so /lore reaches only one of the two. Type %s for Lore Forever and %s for %s."],
          title or L["Another add-on"], own, theirs, title or L["the other one"]))
      else
        say(string.format(L["%s also uses /lore, so /lore reaches only one of the two. Type %s for Lore Forever."],
          title or L["Another add-on"], own))
      end
    end
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
    local f = T.Window("LoreForeverExport", UIParent, "Lore Forever")
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

-- Clicks on the minimap button (Mike, 2026-09-30): each click always does the same thing. Plain clicks
-- open things, Shift-clicks are the playlist. Ctrl and Alt are left free.
--   click              open/close Lore Forever
--   right-click        a small menu: "Narration: only when I press Play" (LOR-138) and Options
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
  if button == "RightButton" then
    if UI.ButtonMenu and UI.frame then return UI.ButtonMenu(_G.LoreForeverMinimapButton) end
    return ns.Options.Toggle()
  end
  LoreForever_Toggle()
end

-- The tooltip: what's playing (or where the playlist stopped), then the same four clicks every time.
local function buttonTooltip(self, anchor)
  local UI = ns.UI
  local pl, busy = UI.pl, UI.IsBusy()
  local n, cur = #pl.items, pl.items[pl.pos]
  GameTooltip:SetOwner(self, anchor)
  GameTooltip:AddLine("Lore Forever")
  if ns.WhatsNew.Pending("card") then
    T.Tip(string.format(L["New in %s: open Lore Forever to see what's new."], ns.WhatsNew.Version()), "tipGood")
  end
  if busy then
    local ours = pl.state == "playing" and cur
    T.Tip(ours and string.format(L["Now playing: %s (%d of %d)"], cur.label, pl.pos, n)
      or string.format(L["Now playing: %s"], UI.playingLabel or L["narration"]), "tipGood")
    local nxt = ours and pl.items[pl.pos + 1]
    if nxt then T.Tip(string.format(L["Up next: %s"], nxt.label), "tipDim") end
  elseif cur then
    T.Tip(string.format(L["Playlist stopped at: %s (%d of %d)"], cur.label, pl.pos, n), "gold")
  end
  local key = ns.Hooks.CurrentKey()
  T.Tip(key and string.format(L["Click to open (or press %s). Right-click for options."], key)
    or L["Click to open. Right-click for options."], "tipText")
  if ns.Voice.OnDemand() then T.Tip(L["Narration plays only when you press Play."], "tipDim") end
  T.Tip(L["Shift-click: play/pause your playlist"], "tipText")
  T.Tip(L["Shift-right-click: next narration"], "tipText")
  if n == 0 then
    T.Tip(L["Your playlist is empty: Shift-click plays everything narrated here."], "tipDim", true)
  end
  T.Tip(L["Drag to move."], "tipDim")
  GameTooltip:Show()
end

-- The "something is playing" look: the minimap button's ring turns green (a green copy of the gold ring, laid over
-- it), pulsing.
local function addPlayingIndicator(b)
  local glow = b:CreateTexture(nil, "OVERLAY", nil, 1)
  glow:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
  if glow.SetDesaturated then glow:SetDesaturated(true) end
  glow:SetVertexColor(T.rgba(T.color.playing))
  glow:SetSize(53, 53)
  glow:SetPoint("TOPLEFT")
  glow:Hide()
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
  b.glow, b.pulse = glow, pulse
  b:SetScript("OnClick", function(_, button) buttonClick(button) end)
end

-- Called whenever playback or the playlist changes (UI.UpdateNowPlaying), whatever caused it. An open tooltip is
-- rebuilt so it never shows a stale "Now playing".
function ns.SetButtonsPlaying(on)
  local b = _G.LoreForeverMinimapButton
  if b and b.glow then
    if b.playing ~= on then
      b.playing = on
      b.glow:SetShown(on)
      if b.pulse then if on then b.pulse:Play() else b.pulse:Stop() end end
    end
    if GameTooltip.IsOwned and GameTooltip:IsOwned(b) then b:GetScript("OnEnter")(b) end
  end
end

-- Which quarters of the minimap are round, per GetMinimapShape() (LibDBIcon's table): quarter 1 is bottom right,
-- 2 bottom left, 3 top right, 4 top left.
local MINIMAP_SHAPES = {
  ["ROUND"] = { true, true, true, true },
  ["SQUARE"] = { false, false, false, false },
  ["CORNER-TOPLEFT"] = { false, false, false, true },
  ["CORNER-TOPRIGHT"] = { false, false, true, false },
  ["CORNER-BOTTOMLEFT"] = { false, true, false, false },
  ["CORNER-BOTTOMRIGHT"] = { true, false, false, false },
  ["SIDE-LEFT"] = { false, true, false, true },
  ["SIDE-RIGHT"] = { true, false, true, false },
  ["SIDE-TOP"] = { false, false, true, true },
  ["SIDE-BOTTOM"] = { true, true, false, false },
  ["TRICORNER-TOPLEFT"] = { false, true, true, true },
  ["TRICORNER-TOPRIGHT"] = { true, false, true, true },
  ["TRICORNER-BOTTOMLEFT"] = { true, true, false, true },
  ["TRICORNER-BOTTOMRIGHT"] = { true, true, true, false },
}

function ns.MinimapButton()
  if not Minimap then return end
  local b = LoreForeverMinimapButton
  if b then
    if b.place then b.place() end   -- the angle may have changed (UI.ResetWindows)
    return b:SetShown(S().minimap)
  end
  if not S().minimap then return end
  -- Laid out like every other add-on's minimap button (LibDBIcon's Classic layout), so it sits on the ring with the
  -- rest: a 31px button, the tracking ring at its top left, a dark disc and a 17px icon inside it.
  b = CreateFrame("Button", "LoreForeverMinimapButton", Minimap)
  b:SetSize(31, 31)
  b:SetFrameStrata("MEDIUM")
  b:SetFrameLevel(8)
  local disc = b:CreateTexture(nil, "BACKGROUND")
  disc:SetTexture("Interface\\Minimap\\UI-Minimap-Background")
  disc:SetSize(20, 20)
  disc:SetPoint("TOPLEFT", 7, -5)
  local icon = b:CreateTexture(nil, "ARTWORK")
  icon:SetTexture("Interface\\Icons\\INV_Misc_Book_09")
  icon:SetSize(17, 17)
  icon:SetPoint("TOPLEFT", 7, -6)
  -- Trim the icon's square edge; pressed, it shows whole (a slight push).
  local function crop(down)
    local d = down and 0 or 0.05
    icon:SetTexCoord(d, 1 - d, d, 1 - d)
  end
  crop(false)
  local border = b:CreateTexture(nil, "OVERLAY")
  border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
  border:SetSize(53, 53)
  border:SetPoint("TOPLEFT")
  b:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")
  -- On the ring: half the minimap's size out from its centre, plus 5. Square minimaps (GetMinimapShape, set by
  -- minimap add-ons) keep it on their edge instead.
  local function place()
    local a = math.rad(S().minimapAngle or 200)
    local x, y = math.cos(a), math.sin(a)
    local q = 1 + (x < 0 and 1 or 0) + (y > 0 and 2 or 0)
    local shape = MINIMAP_SHAPES[(GetMinimapShape and GetMinimapShape()) or "ROUND"] or MINIMAP_SHAPES.ROUND
    local w = (tonumber(Minimap:GetWidth()) or 140) / 2 + 5
    local h = (tonumber(Minimap:GetHeight()) or 140) / 2 + 5
    if shape[q] then
      x, y = x * w, y * h
    else
      x = math.max(-w, math.min(x * (math.sqrt(2 * w * w) - 10), w))
      y = math.max(-h, math.min(y * (math.sqrt(2 * h * h) - 10), h))
    end
    b:ClearAllPoints()
    b:SetPoint("CENTER", Minimap, "CENTER", x, y)
  end
  place()
  b.place = place
  if Minimap.HookScript then Minimap:HookScript("OnSizeChanged", place) end
  b:RegisterForDrag("LeftButton")
  b:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  b:SetScript("OnMouseDown", function() crop(true) end)
  b:SetScript("OnMouseUp", function() crop(false) end)
  -- Drag it around the ring (the angle is saved per character), e.g. off another add-on's button.
  b:SetScript("OnDragStart", function(self)
    if self.LockHighlight then self:LockHighlight() end
    self:SetScript("OnUpdate", function()
      local mx, my = Minimap:GetCenter()
      local cx, cy = GetCursorPosition()
      local s = Minimap:GetEffectiveScale()
      S().minimapAngle = math.deg(math.atan2(cy / s - my, cx / s - mx)) % 360
      place()
    end)
  end)
  b:SetScript("OnDragStop", function(self)
    self:SetScript("OnUpdate", nil)
    if self.UnlockHighlight then self:UnlockHighlight() end
    crop(false)
  end)
  addPlayingIndicator(b)
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
    ns.WhatsNew.Init()   -- the first login of a new version: what's new in it (WhatsNew.lua)
    ns.UI.Create(ns.engine)
    ns.Hooks.Init()
    ns.Options.Create()
    ns.MinimapButton()
    local key, n = ns.Hooks.CurrentKey(), ns.DB.count or 0
    -- How to open the panel: the key (or /lore), plus the minimap button if it's showing.
    local k = key and (GOLD .. key .. "|r")
    if S().minimap then
      say(k and string.format(L["%d lore entries ready. Press %s, or click the book on your minimap."], n, k)
        or string.format(L["%d lore entries ready. Type /lore, or click the book on your minimap."], n))
    else
      say(k and string.format(L["%d lore entries ready. Press %s or type /lore."], n, k)
        or string.format(L["%d lore entries ready. Type /lore to open them."], n))
    end
    for _, note in ipairs(ns.lang.notes) do say(note) end
    -- Automatic picked up the client's language (LOR-35): say so once per language, with the way back to English.
    local _, auto = ns.Lang.Wanted()
    if auto and ns.lang.locale ~= "enUS" and S().langNoted ~= ns.lang.locale then
      S().langNoted = ns.lang.locale
      say(string.format(L["Lore Forever is in %s, your WoW client's language. To pick another language: /lore lang, or Language in /lore options."],
        ns.lang.name or ns.lang.locale))
    end
    checkSlashRivals()
    C_Timer.After(6, ns.Hooks.MaybeOnboard)
    C_Timer.After(3, ns.Journey.Announce)
    C_Timer.After(12, loginTip)   -- after the key prompt (6 s), once the login chat has settled
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
  elseif event == "ZONE_CHANGED" or event == "ZONE_CHANGED_INDOORS" then
    ns.Voice.OnArrive()   -- a new place within the zone
    refreshSoon()
  elseif event == "PLAYER_TARGET_CHANGED" then
    refreshSoon()
  elseif event == "PLAYER_REGEN_DISABLED" then
    ns.Hooks.OnCombat()
  elseif event == "PLAYER_REGEN_ENABLED" then
    ns.Voice.OnCombatEnded()
    ns.Voice.OnCombatOver()
  elseif event == "PLAYER_LOGOUT" then
    if ns.UI.msgs then ns.UI.Archive() end   -- keep the last chat of the session in History
  elseif event == "VOICE_CHAT_TTS_PLAYBACK_STARTED" then
    ns.Voice.OnTTSStarted(arg1, ...)
  elseif event == "VOICE_CHAT_TTS_PLAYBACK_FINISHED" or event == "VOICE_CHAT_TTS_PLAYBACK_FAILED" then
    if ns.Voice.OnTTSFinished(event, arg1, ...) then ns.UI.UpdateListen() end
  elseif event == "PLAYER_CONTROL_LOST" then
    C_Timer.After(1, ns.Voice.OnTaxiCheck)
  elseif event == "QUEST_DETAIL" or event == "QUEST_PROGRESS" or event == "QUEST_COMPLETE" then
    local kind = event == "QUEST_DETAIL" and "detail" or event == "QUEST_PROGRESS" and "progress" or "complete"
    ns.Log.QuestText(kind)
    ns.Hooks.UpdateQuestDialogButton()
    local b = ns.Hooks.questDialogButton
    ns.Voice.OnQuestFrame(kind, b and b.key)
    ns.Hooks.UpdateQuestPlayButton()
  elseif event == "QUEST_FINISHED" then
    -- Also fires between a quest's pages; only a window that stays closed stops its page.
    C_Timer.After(0.2, function()
      if not (_G.QuestFrame and QuestFrame:IsShown()) then
        ns.Voice.OnQuestClosed()
        ns.Hooks.UpdateQuestPlayButton()
        ns.Voice.OnTalkOver()
      end
    end)
  elseif event == "GOSSIP_CLOSED" then
    C_Timer.After(0.2, ns.Voice.OnTalkOver)
  elseif event == "ITEM_TEXT_READY" then
    ns.Voice.ReadBookPage()   -- a book, letter or plaque page is showing
    ns.Hooks.UpdateBookButton()
  elseif event == "ITEM_TEXT_CLOSED" then
    ns.Voice.OnBookClosed()
  elseif event == "CINEMATIC_START" or event == "PLAY_MOVIE" or event == "TALKINGHEAD_REQUESTED" then
    ns.Voice.OnGameTalk()   -- the game's own cutscene or voiced dialog: what started by itself stops
  elseif event == "CINEMATIC_STOP" or event == "STOP_MOVIE" or event == "TALKINGHEAD_CLOSE" then
    C_Timer.After(0.5, ns.Voice.OnGameTalkOver)
  end
end)

for _, e in ipairs({ "ADDON_LOADED", "PLAYER_LOGIN", "PLAYER_ENTERING_WORLD", "ZONE_CHANGED", "ZONE_CHANGED_INDOORS",
  "ZONE_CHANGED_NEW_AREA", "QUEST_LOG_UPDATE", "BAG_UPDATE_DELAYED", "SKILL_LINES_CHANGED", "QUEST_DETAIL",
  "QUEST_PROGRESS", "QUEST_COMPLETE", "QUEST_FINISHED", "GOSSIP_CLOSED", "ITEM_TEXT_READY", "ITEM_TEXT_CLOSED",
  "PLAYER_TARGET_CHANGED", "PLAYER_CONTROL_LOST",
  "VOICE_CHAT_TTS_PLAYBACK_STARTED", "VOICE_CHAT_TTS_PLAYBACK_FINISHED", "VOICE_CHAT_TTS_PLAYBACK_FAILED",
  "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED", "PLAYER_LOGOUT",
  "CINEMATIC_START", "CINEMATIC_STOP", "PLAY_MOVIE", "STOP_MOVIE", "TALKINGHEAD_REQUESTED", "TALKINGHEAD_CLOSE" }) do
  listen(e)
end

local function toggleSetting(key, label)
  S()[key] = not S()[key]
  say(string.format(S()[key] and L["%s on"] or L["%s off"], label))
end

-- /lore voice: list the narration voices in their order (numbered, unticked ones marked), or put one first by
-- number or name ("default" for the default voice), or "none" for the game's voice only.
local function voiceChoices()
  local out = {}
  for _, it in ipairs(ns.Voice.List()) do
    out[#out + 1] = { value = it.key, item = it, why = it.why, rec = it.name and ns.Packs.Get(it.name),
      label = it.label }
  end
  out[#out + 1] = { value = "none", label = L["Game voice only"] }
  return out
end

local function findVoice(arg, choices)
  local want = arg:lower()
  if want == "default" or want == "auto" then want = "auto" end
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
  return not arg:find("%s") or findVoice(arg, voiceChoices()) ~= nil
end

local function voiceCommand(arg)
  local choices = voiceChoices()
  if not arg or arg == "" then
    say(L["narration voices, first to last (/lore voice <number> puts one first):"])
    for i, c in ipairs(choices) do
      local it, extra = c.item, nil
      if it and it.why then
        extra = it.why
      elseif it and not it.on then
        extra = L["off"]
      elseif it then
        extra = string.format(L["plays %d · has %d"], it.plays, it.have)
      end
      say(string.format("  %d. %s%s", i, c.label, extra and (T.code.faint .. " - " .. extra .. "|r") or ""))
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
SLASH_LOREFOREVER3 = "/loreforever"   -- ours alone, for players whose /lore goes to another add-on (checkSlashRivals)
SlashCmdList.LOREFOREVER = function(msg)
  msg = (msg or ""):match("^%s*(.-)%s*$")
  local cmd = msg:lower()
  if cmd == "" then
    LoreForever_Toggle()
  elseif cmd == "help" then
    say(L["/lore - open or close the panel (or press your key; press it over an NPC to read about them)"])
    say(L["/lore <question> - ask directly, e.g. /lore why is westfall so poor"])
    say(L["/lore key - choose the key that opens the panel; /lore key narrate - a key that plays narration"])
    say(L["/lore library - every recorded narration, grouped (your starting area first)"])
    say(L["/lore journey - what your character has done so far; /lore sync - save it now (reloads)"])
    say(L["/lore quests - every quest you've completed, by zone; click one to read its quest text again"])
    if ns.Companion.Installed() then
      say(L["/lore ask <question> - ask live answers (the answer appears on your screen)"])
    end
    say(L["/lore options - settings (tooltips, hints, flight narration)"])
    say(L["/lore lang - choose the language: English, Deutsch, Español, Français or Português (Automatic follows your WoW client)"])
    say(L["/lore reset - bring back the panel, the floating player and the minimap button (keeps your journey and settings)"])
    say(L["/lore primer - dungeon primer for where you are"])
    say(L["/lore listen - read the last answer aloud; /lore narrate - narrate flights on/off"])
    say(L["/lore autoplay - narrations as you arrive and quest dialogue on/off"])
    say(L["/lore ondemand - narration only when you press Play on/off"])
    say(L["/lore voice - list narration voices; /lore voice <number or name> - switch (auto: default, none: game voice)"])
    say(L["/lore report - tell us the last answer was wrong (or click the cross under any answer)"])
    say(L["/lore ctx | export | visits | stats - what Lore Forever sees, for bug reports and playtests"])
    say(string.format(L["Questions, requests and bug reports: %s"], DISCORD_URL))
  elseif cmd == "key" or cmd == "key narrate" then
    ns.Hooks.KeyPrompt(cmd == "key narrate" and "narrate" or "toggle"):Show()
  elseif cmd == "narrations" or cmd == "library" then
    if not ns.UI.frame:IsShown() then ns.UI.frame:Show() end
    ns.UI.ShowTab("narrations")
  elseif cmd == "journey" then
    if not ns.UI.frame:IsShown() then ns.UI.frame:Show() end
    ns.Journey.Show()
  elseif cmd == "quests" or cmd == "completed" then
    if not ns.UI.frame:IsShown() then ns.UI.frame:Show() end
    ns.Journey.SetFilter("done")
    ns.Journey.Show()
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
  elseif cmd == "reset" or cmd == "reset windows" then
    ns.UI.ResetWindows()
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
  elseif cmd == "autoplay" then
    say(string.format(ns.Voice.ToggleAutoplay() and L["%s on"] or L["%s off"],
      L["narrations as you arrive and quest dialogue"]))
  elseif cmd == "ondemand" then
    say(ns.Voice.SetOnDemand(not ns.Voice.OnDemand()) and L["Narration plays only when you press Play."]
      or L["Narration plays by itself again, as your options say."])
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
        r.v.lore and "" or "  " .. T.code.grey .. "no lore|r"))
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
  elseif cmd == "qa" then
    ns.SelfTest.Run()   -- release QA in the game (SelfTest.lua); not in /lore help
  else
    if not ns.UI.frame:IsShown() then ns.UI.frame:Show() end
    ns.UI.Ask(msg, "slash")
  end
end
