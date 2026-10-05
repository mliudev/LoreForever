-- Reporting a recording (LOR-232): the narration player's right-click menu (and its cross, with Options > Show the
-- report button on the narration player) opens this box for the recording that's playing, or the last one played
-- (UI.ReportableClip). Pick what's wrong; "A name is said wrong"
-- asks which name and how it should sound. "Copy report link" shows a loreforeverwow.com/clip-report link
-- (Log.ClipReportLink) to open in a browser, where one click sends it, no sign-in. Once a recording has two reports
-- (or one from a signed-in player) it's recorded again overnight, and a name's sound fixes every recording with that
-- name. What you pick and type is kept per recording until you /reload, so closing the box loses nothing.

local _, ns = ...
local UI = ns.UI
local L = ns.L
local T = ns.Theme
local WARN = T.code.warn

local WIDTH = 420
local REASON_STEP = 24
local NAME_ROW = 54                 -- the name and how it should sound, shown for "A name is said wrong"
local drafts = {}                   -- clip id .. "|" .. pack -> what was picked and typed for it

local function esc(s) return (tostring(s or ""):gsub("|", "||")) end

local function PanelButton(parent, kind)
  return T.SkinButton(CreateFrame("Button", nil, parent, "UIPanelButtonTemplate"), kind)
end

local function Input(parent, width, maxLetters, onChange, onEscape)
  local box = CreateFrame("EditBox", nil, parent, "InputBoxTemplate")
  box:SetSize(width, 22)
  box:SetAutoFocus(false)
  box:SetMaxLetters(maxLetters)
  box:SetScript("OnTextChanged", function(self, userInput) if userInput then onChange(self:GetText()) end end)
  box:SetScript("OnEnterPressed", function(self) self:ClearFocus() end)
  box:SetScript("OnEscapePressed", onEscape)
  return box
end

-- What players see for a recording: its title when it played from the panel, else the entry's name (an answer's
-- question for #faqN), else the clip id.
local function clipLabel(c)
  if c.label and c.label ~= "" then return c.label end
  local db = ns.DB or {}
  local entries = db.entries or {}
  local base, n = c.id:match("^(.-)#faq(%d+)$")
  local e = entries[base or c.id:match("^(.-)#") or c.id]
  if e and n then
    local f = e.faq and e.faq[tonumber(n)]
    return f and f.q or e.n
  end
  return e and e.n or c.id
end

local function createClipReport()
  local f = T.Window("LoreForeverClipReport", UIParent, "Lore Forever")
  f:SetSize(WIDTH, 360)
  f:SetPoint("CENTER")
  f:SetFrameStrata("DIALOG")
  f:SetMovable(true)
  f:EnableMouse(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", f.StartMoving)
  f:SetScript("OnDragStop", f.StopMovingOrSizing)
  table.insert(UISpecialFrames, "LoreForeverClipReport")
  local close = function() f:Hide() end

  local title = f:CreateFontString(nil, "OVERLAY", T.font.heading)
  title:SetPoint("TOPLEFT", 16, -32)
  title:SetText(L["What's wrong with this narration?"])
  local about = T.Muted(f:CreateFontString(nil, "OVERLAY", T.font.small))
  about:SetPoint("TOPLEFT", 16, -52)
  about:SetWidth(WIDTH - 32)
  about:SetJustifyH("LEFT")
  if about.SetWordWrap then about:SetWordWrap(false) end
  f.about = about

  local reasons = {
    { "name", L["A name is said wrong"] },
    { "voice", L["Wrong voice or gender"] },
    { "cut", L["Cut off, garbled or words missing"] },
    { "quality", L["Poor sound: noise, echo or too quiet"] },
    { "stage", L["It reads out a stage direction"] },
    { "text", L["The words don't match the text"] },
    { "other", L["Something else"] },
  }
  f.checks = {}
  for i, r in ipairs(reasons) do
    local cb = CreateFrame("CheckButton", nil, f, "UICheckButtonTemplate")
    cb:SetSize(24, 24)
    cb:SetPoint("TOPLEFT", 12, -66 - (i - 1) * REASON_STEP)
    local text = cb:CreateFontString(nil, "ARTWORK", T.font.body)
    text:SetPoint("LEFT", cb, "RIGHT", 4, 0)
    text:SetText(r[2])
    cb.reason = r[1]
    -- One reason at a time: ticking one clears the others; ticking it again clears it.
    cb:SetScript("OnClick", function(self)
      f.r.reason = self:GetChecked() and self.reason or nil
      for _, other in ipairs(f.checks) do other:SetChecked(other.reason == f.r.reason) end
      f.Layout()
    end)
    f.checks[i] = cb
  end
  local below = -66 - #reasons * REASON_STEP - 4   -- where the rows under the reasons start

  -- "A name is said wrong": which name, and how it should sound.
  local half = math.floor((WIDTH - 52) / 2)
  f.nameLabel = f:CreateFontString(nil, "OVERLAY", T.font.label)
  f.nameLabel:SetText(L["Which name?"])
  f.sayLabel = f:CreateFontString(nil, "OVERLAY", T.font.label)
  f.sayLabel:SetText(L["How should it sound?"])
  f.name = Input(f, half, ns.Log.CLIP_MAX.name, function(t) f.r.name = t end, close)
  f.say = Input(f, half, ns.Log.CLIP_MAX.sayAs, function(t) f.r.sayAs = t end, close)
  f.sayHint = T.Muted(f:CreateFontString(nil, "OVERLAY", T.font.small))
  f.sayHint:SetText(L["e.g. Teldrassil, said tel-DRASS-il"])

  f.noteLabel = f:CreateFontString(nil, "OVERLAY", T.font.label)
  f.noteLabel:SetText(L["Anything to add? (optional)"])
  f.note = Input(f, WIDTH - 40, ns.Log.CLIP_MAX.note, function(t) f.r.note = t end, close)

  f.copy = PanelButton(f, "primary")
  f.copy:SetSize(150, 24)
  f.copy:SetText(L["Copy report link"])
  -- As wide as its label needs in every language (frFR: "Copier le lien du signalement").
  local copyW = T.TextWidth(f.copy:GetFontString())
  if copyW then f.copy:SetWidth(math.max(150, math.ceil(copyW) + 24)) end
  f.done = PanelButton(f)
  f.done:SetSize(90, 24)
  f.done:SetText(L["Done"])
  f.done:SetPoint("LEFT", f.copy, "RIGHT", 8, 0)
  f.done:SetScript("OnClick", close)

  -- After "Copy report link": what to do with it, and the link. It can't be edited: typing puts it back, so a stray
  -- key never breaks the code.
  f.hint = f:CreateFontString(nil, "OVERLAY", T.font.small)
  f.hint:SetWidth(WIDTH - 32)
  f.hint:SetJustifyH("LEFT")
  local link = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
  link:SetSize(WIDTH - 40, 22)
  link:SetAutoFocus(false)
  if link.SetFontObject and _G.ChatFontNormal then link:SetFontObject(ChatFontNormal) end
  local function fill()
    link:SetText(f.link or "")
    link:SetCursorPosition(0)
    link:HighlightText()
  end
  link:SetScript("OnTextChanged", function(_, userInput) if userInput then fill() end end)
  link:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
  link:SetScript("OnEscapePressed", close)
  link:SetScript("OnShow", fill)
  f.linkBox, f.fillLink = link, fill

  -- Rows under the reasons, from the top: the name row (for a name), the note, the buttons, then the link once copied.
  function f.Layout()
    local named = f.r.reason == "name"
    local y = below
    for _, w in ipairs({ f.nameLabel, f.sayLabel, f.name, f.say, f.sayHint }) do w:SetShown(named) end
    if named then
      f.nameLabel:ClearAllPoints(); f.nameLabel:SetPoint("TOPLEFT", 16, y)
      f.sayLabel:ClearAllPoints(); f.sayLabel:SetPoint("TOPLEFT", 26 + half, y)
      f.name:ClearAllPoints(); f.name:SetPoint("TOPLEFT", 22, y - 16)
      f.say:ClearAllPoints(); f.say:SetPoint("TOPLEFT", 32 + half, y - 16)
      f.sayHint:ClearAllPoints(); f.sayHint:SetPoint("TOPLEFT", 26 + half, y - 40)
      y = y - NAME_ROW
    end
    f.noteLabel:ClearAllPoints(); f.noteLabel:SetPoint("TOPLEFT", 16, y)
    f.note:ClearAllPoints(); f.note:SetPoint("TOPLEFT", 22, y - 16)
    y = y - 50
    f.copy:ClearAllPoints(); f.copy:SetPoint("TOPLEFT", 16, y)
    y = y - 34
    local copied = f.link ~= nil or f.why ~= nil
    f.hint:SetShown(copied)
    f.linkBox:SetShown(f.link ~= nil)
    if copied then
      f.hint:ClearAllPoints(); f.hint:SetPoint("TOPLEFT", 16, y)
      y = y - (f.link and 52 or 22)
      if f.link then
        f.linkBox:ClearAllPoints(); f.linkBox:SetPoint("TOPLEFT", 22, y + 4)
        y = y - 26
      end
    end
    f:SetHeight(-y + 12)
  end

  f.copy:SetScript("OnClick", function()
    if not f.r.reason then
      f.link, f.why = nil, true
      f.hint:SetText(WARN .. L["Pick what's wrong first."] .. "|r")
      return f.Layout()
    end
    f.why = nil
    f.link = ns.Log.ClipReportLink({ clip = f.r.clip, hash = f.r.hash, voice = f.r.voice, reason = f.r.reason,
      name = f.r.name, sayAs = f.r.sayAs, note = f.r.note })
    f.hint:SetText(L["Press Ctrl+C to copy this link, then open it in your browser and press Send report. No sign-in needed. It says which narration and voice, never your character's name."])
    f.Layout()
    fill()   -- again once shown: the Forever client drops text set on a box that isn't visible yet (see Options)
    link:SetFocus()
  end)
  return f
end

-- Open the box for a recording: `clip` from Voice.lastClip ({id, pack, hash, label}), by default the one the player
-- can report now. Returns the box, or nil when there's nothing to report.
function UI.ShowClipReport(clip)
  clip = clip or UI.ReportableClip()
  if not (clip and clip.id and clip.pack) then return nil end
  local f = LoreForeverClipReport or createClipReport()
  UI.clipReport = f
  local key = clip.id .. "|" .. clip.pack
  local r = drafts[key] or { clip = clip.id, voice = clip.pack }
  r.hash = clip.hash or r.hash
  drafts[key] = r
  f.r, f.link, f.why = r, nil, nil
  f.about:SetText(esc(clipLabel(clip)) .. " - " .. esc(ns.Voice.PackName(clip.pack)))
  for _, cb in ipairs(f.checks) do cb:SetChecked(cb.reason == r.reason) end
  f:Show()
  f.Layout()
  -- Text after the boxes show: the Forever client drops text set on a box that isn't visible yet.
  f.name:SetText(r.name or "")
  f.say:SetText(r.sayAs or "")
  f.note:SetText(r.note or "")
  return f
end
