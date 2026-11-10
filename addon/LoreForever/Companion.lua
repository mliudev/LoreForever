-- Live answers from the Lore Forever companion app on this PC (LOR-65). Add-ons can't reach the internet, so the
-- question (with where you are and what you're doing) goes out through the clipboard: the add-on highlights it and the
-- player presses Ctrl+C once. The companion sees it and answers in a small window over the game.
-- (LOR-57 spike, 2026-09-30: the clipboard carries 256 KB intact; the chat log is written minutes late.)
-- Nothing here shows until the companion is installed (Companion.Installed).

local _, ns = ...
local Companion = {}
ns.Companion = Companion
local L = ns.L

local PREFIX = "LFQ1:"   -- companion/lore_companion/clipboard.py reads only clipboard text that starts with this

local function say(msg) DEFAULT_CHAT_FRAME:AddMessage("|cffffd100Lore Forever:|r " .. msg) end

local function json(v)
  local t = type(v)
  if t == "table" then
    local parts = {}
    if #v > 0 or next(v) == nil then
      for _, x in ipairs(v) do parts[#parts + 1] = json(x) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    for k, x in pairs(v) do parts[#parts + 1] = json(tostring(k)) .. ":" .. json(x) end
    return "{" .. table.concat(parts, ",") .. "}"
  elseif t == "string" then
    -- One line and no pipes: the edit box would read pipes as escape codes.
    return '"' .. v:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("%c", " "):gsub("|", "/") .. '"'
  elseif t == "number" or t == "boolean" then
    return tostring(v)
  end
  return "null"
end

-- What goes to the companion: the question, the place, the character and their quests (the keys
-- companion/lore_companion/core.py and answer.py read).
function Companion.Payload(question, ctx)
  ctx = ctx or ns.Context.Snapshot()
  local quests = {}
  for i, q in ipairs(ctx.quests or {}) do
    if i > 8 then break end
    quests[#quests + 1] = { id = q.id, title = q.title }
  end
  return PREFIX .. json({
    q = question, zone = ctx.zone, sub = ctx.subzone, target = ctx.targetName, race = ctx.raceName,
    class = ctx.className, level = ctx.level, faction = ctx.faction, quests = quests,
    char = ns.Journey and ns.Journey.CharKey() or nil, t = time(),
    -- Where you stand on the map ("mapID:x:y", thousandths), for "pin this spot" (LOR-664); nil in a dungeon or on a
    -- flight.
    at = ns.Journey and ns.Journey.Here and ns.Journey.Here() or nil,
    -- This add-on's version ("0.25.0"), so Willo knows which add-on asked. A key of its own: Willo 0.25.0 and older
    -- read only the keys above and pass over it, so this LFQ1 still reaches them.
    ver = ns.Log and ns.Log.Version and ns.Log.Version() or nil,
  })
end

local box
local function createBox()
  local f = CreateFrame("Frame", "LoreForeverLiveAnswers", UIParent, "BasicFrameTemplateWithInset")
  f:SetSize(460, 132)
  f:SetFrameStrata("DIALOG")
  ns.Theme.Movable(f, "askWillo", { "TOP", 0, -140 })
  table.insert(UISpecialFrames, "LoreForeverLiveAnswers")
  local title = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  title:SetPoint("TOP", 0, -5)
  title:SetText(string.format(L["Ask %s"], ns.COMPANION_NAME))
  local tip = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  tip:SetPoint("TOPLEFT", 16, -34)
  tip:SetPoint("TOPRIGHT", -16, -34)
  tip:SetJustifyH("LEFT")
  tip:SetText(L["Press Ctrl+C to send your question. The answer appears on your screen in a few seconds."])
  local eb = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
  eb:SetSize(420, 24)
  eb:SetPoint("TOP", 0, -70)
  eb:SetAutoFocus(true)
  eb:SetMaxLetters(0)
  eb:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
  eb:SetScript("OnMouseUp", function(self) self:HighlightText() end)
  eb:SetScript("OnEscapePressed", function() f:Hide() end)
  eb:SetScript("OnTextChanged", function(self, user)
    if user then self:SetText(f.payload or ""); self:HighlightText() end   -- keep it exactly as built
  end)
  eb:SetScript("OnKeyDown", function(self, key)
    if key == "C" and IsControlKeyDown() then
      self:HighlightText()   -- clicking in the box must not turn a copy into an empty selection
      C_Timer.After(0.15, function()   -- after the copy itself
        f:Hide()
      end)
      -- A pin she makes from it reaches the maps without a /reload (LOR-1292).
      if ns.PinsLive then pcall(ns.PinsLive.Talked) end
    end
  end)
  local note = f:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  note:SetPoint("BOTTOMLEFT", 16, 12)
  note:SetPoint("BOTTOMRIGHT", -16, 12)
  note:SetJustifyH("LEFT")
  note:SetText(string.format(L["Needs %s running on this PC. Esc to cancel."], ns.COMPANION_NAME))
  f.eb = eb
  return f
end

-- The companion app writes its LoreForever_Willo add-on (LoreForever_Journey before 0.20) whenever it runs (even with no pictures yet), so its data
-- means it's installed.
function Companion.Installed()
  return type(_G.LoreForeverJourneyData) == "table"
end

-- Get Willo (LOR-459): players without the companion meet it as her icon in the panel's title bar (LOR-601,
-- Companion.CreateIcon), one line in the chat when the add-on has no answer (UI.Ask, once a play session), in Options
-- above the settings that need it, and with /lore willo. Add-ons can't open web pages, so it's a link to copy. The free
-- download only; never plans, prices or sign-in (Blizzard's add-on policy, LOR-491). Options › Suggest Willo turns the
-- icon and the chat line off.
Companion.WILLO_URL = "loreforeverwow.com/willo"
-- Off until Willo launches: no chat line, /lore willo, Suggest Willo checkbox or Options Willo section (that one still
-- shows to players who have Willo). true brings back all the entry points.
Companion.OFFER_WILLO = true

function Companion.OfferWillo()
  return Companion.OFFER_WILLO and not Companion.Installed() and (LoreForeverDB and LoreForeverDB.settings or {}).getWillo ~= false
end

-- The chat line: true the first time in this play session that it may show, then never again until a /reload or the
-- next login. Never with Willo installed or the option off.
function Companion.SuggestWillo()
  if Companion.suggested or not Companion.OfferWillo() then return false end
  Companion.suggested = true
  return true
end

-- The add-on does not ask Willo to read its short answers (LOR-547 asked her to; dropped by Mike, 2026-10-23, release
-- QA: "I don't think Willo should read answers out loud automatically. Usually, the expectation is you click Listen,
-- and then that reads it." and then "hide listen", "drop it actually"): an answer with no recording stays text, with no
-- Listen button, and nothing names it in the sky's outer ring. What still goes round the ring: a question to Willo
-- (Companion.SendQuestion). Willo is English only, so another language or a contributor's edition stays text. A quest
-- page with no recording stays text too (LOR-1157, Mike, 11/5: "remove it"): naming it here meant a reading that came
-- whenever the sky next showed, so it arrived when the player next pressed the talk key.
local sending = nil      -- the question going round to Willo now (Companion.SendQuestion), its token

local function english()
  local lang = ns.lang
  return not lang or (lang.locale == "enUS" and not lang.edition)
end
Companion.English = english
-- Whether a question is going round to Willo now (her big moments wait for it, Moments.lua).
function Companion.Sending() return sending ~= nil end

-- Willo can be sent a question through the sky now: she's installed, Live game info is on (so
-- the sky shows), the sky has its outer ring, and the add-on reads in English.
function Companion.ReadsAnswers()
  local Strip = ns.Strip
  return Companion.Installed() and Strip ~= nil and Strip.SetRing ~= nil and Strip.On() and english()
end

-- Nothing for her to read: another question or answer shown, an entry's overview, the panel cleared. A question
-- still going round to her stops too (the newest wins).
function Companion.ClearRead()
  if sending and ns.Strip and ns.Strip.SetRing then ns.Strip.SetRing(nil) end
  sending = nil
end

-- "Ask Willo" in one click (LOR-560, Mike's pick 4C): the question goes to Willo through the same outer ring, a few
-- letters a page, with no Ctrl+C. Page 0: kind 2 and page 0 (byte 1), a counter for the question, its letter count and
-- the CRC-8 (Strip.CRC8) of the pages after it; then pages 1..n: kind 2 and the page's number, 4 bytes of letters, 5
-- bits each, high bit first (1-26 a-z, 27 a space, 28 ', 29 ',', 30 ?, 31 .; anything else becomes a space). Each page
-- shows PAGE_SECONDS, and the pages go round for a few seconds, as Willo can't say she has it. English only, like her.
local Q_MAX, PAGE_SECONDS, Q_SECONDS = 120, 0.3, 5
local questionCounter = 0

local function letterCode(ch)
  local b = ch:byte()
  if b >= 97 and b <= 122 then return b - 96 end
  return (ch == "'" and 28) or (ch == "," and 29) or (ch == "?" and 30) or (ch == "." and 31) or 27
end

-- The question's pages, each a list of 5 bytes.
function Companion.QuestionPages(q)
  q = (q or ""):lower():gsub("%s+", " "):gsub("^ ", ""):gsub(" $", ""):sub(1, Q_MAX)
  local bytes, acc, nbits = {}, 0, 0
  for i = 1, #q do
    local c = letterCode(q:sub(i, i))
    for k = 4, 0, -1 do
      acc, nbits = acc * 2 + math.floor(c / 2 ^ k) % 2, nbits + 1
      if nbits == 8 then bytes[#bytes + 1], acc, nbits = acc, 0, 0 end
    end
  end
  if nbits > 0 then bytes[#bytes + 1] = acc * 2 ^ (8 - nbits) end
  while #bytes % 4 ~= 0 do bytes[#bytes + 1] = 0 end
  questionCounter = (questionCounter + 1) % 256
  local pages = { { 0x80, questionCounter, #q, ns.Strip.CRC8(bytes), 0 } }
  for p = 1, #bytes / 4 do
    local i = (p - 1) * 4
    pages[#pages + 1] = { 0x80 + p, bytes[i + 1], bytes[i + 2], bytes[i + 3], bytes[i + 4] }
  end
  return pages
end

-- Send a question the add-on couldn't answer to Willo through the sky. False when she can't hear it that way (not
-- installed, Live game info off, no outer ring yet, another language): then the Ctrl+C box, as before.
function Companion.SendQuestion(q)
  if not Companion.ReadsAnswers() or type(q) ~= "string" or not q:find("%a") then return false end
  local pages = Companion.QuestionPages(q)
  local mine = {}
  sending = mine
  local rounds = math.max(Q_SECONDS, 2 * #pages * PAGE_SECONDS) / PAGE_SECONDS
  local n = 0
  local function step()
    if sending ~= mine then return end
    if n >= rounds then
      sending = nil
      ns.Strip.SetRing(nil)
      return
    end
    ns.Strip.SetRing(pages[n % #pages + 1])
    n = n + 1
    C_Timer.After(PAGE_SECONDS, step)
  end
  step()
  return true
end

local willo
local function createWillo()
  local f = CreateFrame("Frame", "LoreForeverGetWillo", UIParent, "BasicFrameTemplateWithInset")
  f:SetSize(420, 170)
  f:SetFrameStrata("DIALOG")
  ns.Theme.Movable(f, "getWillo", { "TOP", 0, -140 })
  table.insert(UISpecialFrames, "LoreForeverGetWillo")
  local title = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  title:SetPoint("TOP", 0, -5)
  title:SetText(string.format(L["Get %s"], ns.COMPANION_NAME))
  local text = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  text:SetPoint("TOPLEFT", 16, -32)
  text:SetPoint("TOPRIGHT", -16, -32)
  text:SetJustifyH("LEFT")
  local hint = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  hint:SetPoint("TOPLEFT", text, "BOTTOMLEFT", 0, -10)
  hint:SetPoint("RIGHT", -16, 0)
  hint:SetJustifyH("LEFT")
  hint:SetText(L["Press Ctrl+C to copy the link, then paste it into your browser."])
  -- The link can't be edited: typing puts it back, so a stray key never breaks it.
  local eb = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
  eb:SetSize(380, 24)
  eb:SetPoint("TOPLEFT", hint, "BOTTOMLEFT", 6, -8)
  eb:SetAutoFocus(false)
  local function fill()
    eb:SetText("https://" .. Companion.WILLO_URL)
    eb:SetCursorPosition(0)
    eb:HighlightText()
  end
  eb:SetScript("OnTextChanged", function(_, user) if user then fill() end end)
  eb:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
  eb:SetScript("OnMouseUp", function(self) self:HighlightText() end)
  eb:SetScript("OnEscapePressed", function() f:Hide() end)
  eb:SetScript("OnKeyDown", function(self, key)
    if key == "C" and IsControlKeyDown() then C_Timer.After(0.15, function() f:Hide() end) end
  end)
  local off = f:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  off:SetPoint("BOTTOMLEFT", 16, 12)
  off:SetPoint("BOTTOMRIGHT", -16, 12)
  off:SetJustifyH("LEFT")
  off:SetText(string.format(L["Not interested? Untick Suggest %s in /lore options."], ns.COMPANION_NAME))
  f.text, f.hint, f.eb, f.fill = text, hint, eb, fill
  return f
end

-- question: what the player just asked that the add-on couldn't answer (nil from /lore willo). via: where it was
-- opened from, for the usage counts ("icon"; default chat with a question, else slash).
function Companion.ShowGetWillo(question, via)
  ns.Log.Use("getWillo", via or (question and "chat" or "slash"))
  willo = willo or createWillo()
  local name = ns.COMPANION_NAME
  question = question and question:match("^%s*(.-)%s*$")
  if question and question ~= "" then
    willo.text:SetText(string.format(L["%s, Lore Forever's free companion app, can answer \"%s\" for you, out loud, knowing where you are in the game."], name, question))
  else
    willo.text:SetText(string.format(L["%s is Lore Forever's free companion app for Windows: a little wisp beside your game that answers anything you ask about WoW: Forever, out loud, knowing where you are."], name))
  end
  -- Title bar, the two paragraphs, the link and the note under it.
  willo:SetHeight(100 + (tonumber(willo.text:GetStringHeight()) or 30) + (tonumber(willo.hint:GetStringHeight()) or 24))
  willo:Show()
  willo.fill()   -- again once shown: the Forever client drops text set on a box that isn't visible yet
  willo.eb:SetFocus()
end

-- Willo's icon (LOR-601, Mike's design 10/17): her wisp in a small gold ring, glowing softly, always in the panel for
-- players without her. The mouse over it gets one line from her, matched to what's on screen (UI.WilloTopic); a click
-- opens the Get Willo box above. Shown when the chat line may be (Companion.OfferWillo: not with Willo installed, nor
-- with Options › Suggest Willo unticked), but not once a session: it's quiet, so it stays. Our own art
-- (scripts/willo_icon_texture.py) and the sky's soft glow, tinted her blue.
local MEDIA = "Interface\\AddOns\\LoreForever\\Media\\"
local GLOW = { 0.42, 0.66, 1 }

-- Her line for the tooltip: about the story on screen, the question the add-on couldn't answer, or else one of a few
-- in turn. topic: UI.WilloTopic()'s { name = } or { question = }, or nil.
local LINES = {
  function(name, place)
    return place and string.format(L["%s could tell you more about %s, out loud."], name, place)
  end,
  function(name) return string.format(L["Ask %s anything about Azeroth, and she answers out loud."], name) end,
  function(name) return string.format(L["%s knows where you are and what you're after, and talks you through it."], name) end,
}
function Companion.IconLine(topic, turn)
  local name = ns.COMPANION_NAME
  if topic and topic.question then return string.format(L["%s can answer this, out loud."], name) end
  if topic and topic.name then return string.format(L["%s could tell you more about %s, out loud."], name, topic.name) end
  local place = topic and topic.place
  for i = 0, #LINES - 1 do
    local line = LINES[((turn or 1) - 1 + i) % #LINES + 1](name, place)
    if line then return line end
  end
end

function Companion.CreateIcon(parent, size)
  local b = CreateFrame("Button", nil, parent)
  b:SetSize(size, size)
  local glow = b:CreateTexture(nil, "BACKGROUND")
  glow:SetTexture(MEDIA .. "Sky\\Glow")
  if glow.SetBlendMode then glow:SetBlendMode("ADD") end
  glow:SetVertexColor(GLOW[1], GLOW[2], GLOW[3], 0.8)
  glow:SetSize(size * 2.1, size * 2.1)
  glow:SetPoint("CENTER")
  local art = b:CreateTexture(nil, "ARTWORK")
  art:SetTexture(MEDIA .. "Willo\\Icon")
  art:SetAllPoints()
  local hi = b:CreateTexture(nil, "HIGHLIGHT")
  hi:SetTexture(MEDIA .. "Sky\\Glow")
  if hi.SetBlendMode then hi:SetBlendMode("ADD") end
  hi:SetVertexColor(0.75, 0.9, 1, 0.6)
  hi:SetSize(size * 1.2, size * 1.2)
  hi:SetPoint("CENTER")
  -- A slow breath, not a blink: the glow fades to a third and back every few seconds.
  local pulse = glow.CreateAnimationGroup and glow:CreateAnimationGroup()
  if pulse then
    local a = pulse:CreateAnimation("Alpha")
    if a and a.SetFromAlpha then
      a:SetFromAlpha(1)
      a:SetToAlpha(0.35)
      a:SetDuration(2.2)
      if a.SetSmoothing then a:SetSmoothing("IN_OUT") end
    end
    pulse:SetLooping("BOUNCE")
    b:SetScript("OnShow", function() pulse:Play() end)
    pulse:Play()
  end
  b.turn = 0
  b:SetScript("OnEnter", function(self)
    self.turn = self.turn + 1
    ns.Log.Use("willoIcon", "hover")
    local topic = ns.UI and ns.UI.WilloTopic and ns.UI.WilloTopic() or nil
    GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
    GameTooltip:AddLine(ns.COMPANION_NAME)
    ns.Theme.Tip(Companion.IconLine(topic, self.turn), "tipText", true)
    ns.Theme.Tip(L["She's Lore Forever's free companion app: a little wisp beside your game."], "tipText", true)
    ns.Theme.Tip(L["Click for the link to get her."], "tipDim")
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  b:SetScript("OnClick", function()
    GameTooltip:Hide()
    local topic = ns.UI and ns.UI.WilloTopic and ns.UI.WilloTopic() or nil
    Companion.ShowGetWillo(topic and topic.question, "icon")
  end)
  return b
end

function Companion.Ask(question)
  question = (question or ""):match("^%s*(.-)%s*$")
  if question == "" then return say(L["type a question after /lore ask, e.g. /lore ask who leads the Defias?"]) end
  ns.Log.Use("live")
  box = box or createBox()
  box.payload = Companion.Payload(question)
  box:Show()
  box.eb:SetText(box.payload)
  box.eb:SetFocus()
  box.eb:HighlightText()
end
