-- Live answers from the Lore Forever companion app on this PC (LOR-65). Add-ons can't reach the internet, so the
-- question (with where you are and what you're doing) goes out through the clipboard: the add-on highlights it and the
-- player presses Ctrl+C once. The companion sees it, answers in a small window over the game and can read it aloud.
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
  })
end

local box
local function createBox()
  local f = CreateFrame("Frame", "LoreForeverLiveAnswers", UIParent, "BasicFrameTemplateWithInset")
  f:SetSize(460, 132)
  f:SetPoint("TOP", 0, -140)
  f:SetFrameStrata("DIALOG")
  f:EnableMouse(true)
  table.insert(UISpecialFrames, "LoreForeverLiveAnswers")
  local title = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  title:SetPoint("TOP", 0, -5)
  title:SetText(L["Live answers"])
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
  eb:SetScript("OnEscapePressed", function() f:Hide() end)
  eb:SetScript("OnTextChanged", function(self, user)
    if user then self:SetText(f.payload or ""); self:HighlightText() end   -- keep it exactly as built
  end)
  eb:SetScript("OnKeyDown", function(_, key)
    if key == "C" and IsControlKeyDown() then
      C_Timer.After(0.15, function()   -- after the copy itself
        f:Hide()
        say(L["sent to live answers. The answer appears on your screen."])
      end)
    end
  end)
  local note = f:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  note:SetPoint("BOTTOMLEFT", 16, 12)
  note:SetPoint("BOTTOMRIGHT", -16, 12)
  note:SetJustifyH("LEFT")
  note:SetText(L["Needs the Lore Forever companion app running on this PC. Esc to cancel."])
  f.eb = eb
  return f
end

-- The companion app writes the LoreForever_Journey add-on whenever it runs (even with no chapters yet), so its data
-- means it's installed.
function Companion.Installed()
  return type(_G.LoreForeverJourneyData) == "table"
end

function Companion.Ask(question)
  question = (question or ""):match("^%s*(.-)%s*$")
  if question == "" then return say(L["type a question after /lore ask, e.g. /lore ask who leads the Defias?"]) end
  box = box or createBox()
  box.payload = Companion.Payload(question)
  box:Show()
  box.eb:SetText(box.payload)
  box.eb:SetFocus()
  box.eb:HighlightText()
end
