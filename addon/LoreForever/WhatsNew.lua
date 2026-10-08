-- What's new (LOR-222): after an update, the new version's notes (Notes.lua, written from CHANGELOG.md at each
-- release) reach the player without nagging, each in one place and once:
--   - one chat line at the first login after the update, with a [What's new] link. It takes that login's tip slot,
--     and Options > Tips at login turns it off too;
--   - a card at the top of the conversation the first time the panel opens: the headline changes, everything else
--     one click away, and a close button;
--   - a green "New" on each option the notes name ("Options > ..."), until Options has been opened once, and on the
--     Journey button, the Library tab or History when the headline changes mention them, until that page has been
--     opened once;
--   - a line in the minimap button's tooltip, until the card has been seen.
-- A fresh install starts with all of it seen: everything is new to a new player, and the welcome card covers that.
-- State: LoreForeverDB.settings.news = { version = "0.8.0", line = true, card = true, options = true, ... }, the
-- version the news is about and what of it has been seen (done = true: nothing to show, a new install).

local _, ns = ...
local WN = {}
ns.WhatsNew = WN
local L = ns.L
local T = ns.Theme
local GOLD = T.code.gold

local HIGHLIGHTS = 3   -- the headline changes: the first ones with a lead-in, as on the website
-- The pages a "New" can sit on, and the word in the headline changes that puts it there (the notes are English).
local PAGES = { journey = "Journey", narrations = "Library", history = "History" }
local NEW_COLOR = { 0.12, 1, 0, 1 }   -- the game's uncommon green, as the site's "New" tags

local function S() return LoreForeverDB.settings end

-- This version's news while there's something left of it to show, else nil.
local function news()
  local n, v = S().news, ns.Notes and ns.Notes.version
  if type(n) ~= "table" or not v or n.version ~= v or n.done then return nil end
  return n
end

-- At login, before the panel is built: the first login of a version starts its news (seen already on a new install).
-- Notes.lua must be about the version running: a copy from another version shows nothing.
function WN.Init()
  local notes, v = ns.Notes, ns.Log.Version()
  if not (notes and notes.version == v and type(notes.items) == "table") then return end
  local n = S().news
  if type(n) == "table" and n.version == v then return end
  S().news = { version = v, done = (ns.Log.session == 1) or nil }
end

function WN.Version() return ns.Notes and ns.Notes.version end

-- Whether `what` ("line", "card", "options", "journey", "narrations", "history") still has news to show.
function WN.Pending(what)
  local n = news()
  return n ~= nil and not n[what]
end

function WN.Seen(what)
  local n = news()
  if n then n[what] = true end
end

-- The headline changes: { lead, rest, lead as written }, the first HIGHLIGHTS with a lead-in.
function WN.Highlights()
  local out = {}
  for _, it in ipairs(ns.Notes and ns.Notes.items or {}) do
    if it[1] and it[1] ~= "" then out[#out + 1] = it end
    if #out == HIGHLIGHTS then break end
  end
  return out
end

-- A change's first sentence, capitalised: what the card shows of it.
local function firstSentence(text)
  local s = text:match("^(.-[%.!%?])%s+%u") or text
  return s:sub(1, 1):upper() .. s:sub(2)
end

local function english()
  local loc = ns.lang and ns.lang.locale
  return not loc or loc == "enUS" or loc == "enGB"
end

-- The login line, once per version: "updated to 0.8.0: A, B and C. [What's new]" (the headline changes are in
-- English, so other languages get just the version and the link). Returns whether it said anything; Core skips
-- that login's tip then, so it's still one line.
function WN.LoginLine(say)
  if not (WN.Pending("line") and S().tips) then return false end
  WN.Seen("line")
  local link = ns.Hooks.Link(L["What's new"], "whatsnew")
  local leads = {}
  for _, it in ipairs(WN.Highlights()) do leads[#leads + 1] = it[1] end
  if english() and #leads > 0 then
    local list = #leads == 1 and leads[1] or (table.concat(leads, ", ", 1, #leads - 1) .. " and " .. leads[#leads])
    say(string.format("updated to %s: %s. %s", WN.Version(), list, link))
  else
    say(string.format(L["updated to %s. %s"], WN.Version(), link))
  end
  return true
end

-- The card's text: its title, then each headline change's lead-in in gold and its first sentence.
function WN.CardText()
  local lines = { GOLD .. string.format(L["What's new in %s"], WN.Version()) .. "|r" }
  for _, it in ipairs(WN.Highlights()) do
    lines[#lines + 1] = GOLD .. it[1] .. ":|r " .. firstSentence(it[2])
  end
  return table.concat(lines, "\n")
end

-- Every change in this version, as one answer in the conversation (the card's button).
function WN.ShowAll()
  local parts = {}
  for _, it in ipairs(ns.Notes and ns.Notes.items or {}) do
    parts[#parts + 1] = (it[3] and it[3] ~= "") and (GOLD .. it[3] .. "|r " .. it[2]) or it[2]
  end
  if #parts == 0 then return end
  ns.UI.AddMessage("lore", GOLD .. string.format(L["Everything new in %s"], WN.Version()) .. "|r\n"
    .. table.concat(parts, "\n\n"))
end

-- The card, at the end of the conversation (at its start when the panel opens on the welcome card). Shown from the
-- login line's link it comes back even after it's been closed.
function WN.AddCard(first)
  if not (ns.Notes and #WN.Highlights() > 0) then return false end
  WN.Seen("card")
  ns.UI.AddCard(WN.CardText(), string.format(L["Everything new in %s"], WN.Version()), WN.ShowAll, first)
  return true
end

-- The login line's [What's new]: open the panel on the card.
function WN.Show()
  local UI = ns.UI
  if not UI.frame then return end
  if not UI.frame:IsShown() then UI.frame:Show() end
  for _, m in ipairs(UI.msgs or {}) do
    if m.news then return UI.Render() end   -- already there
  end
  WN.AddCard()
end

-- Whether a page's button or tab gets a "New": the headline changes mention it and it hasn't been opened since.
function WN.PageIsNew(page)
  local word = PAGES[page]
  if not (word and WN.Pending(page)) then return false end
  for _, it in ipairs(WN.Highlights()) do
    if (it[1] .. " " .. it[2]):find(word, 1, true) then return true end
  end
  return false
end

-- Whether `clause` (the words after an "Options > " in the notes) names `label`: at its start, or after a " > " (a
-- page inside Options) or an " and " that joins another option ("Options > Show storylines on quests and Storyline
-- hints in chat").
local function names(clause, label)
  if clause:sub(1, #label) == label then return true end
  for _, sep in ipairs({ " > ", " and " }) do
    local i = 1
    while true do
      local s, e = clause:find(sep, i, true)
      if not s then break end
      if clause:sub(e + 1, e + #label) == label then return true end
      i = e + 1
    end
  end
  return false
end

-- Whether an option gets a "New": the notes name it (by its English label) the way CHANGELOG.md names options,
-- "Options > <label>" (written as Options › there), and Options hasn't been opened since the update. A label that
-- only turns up in passing ("still use Read aloud") isn't news about that option.
function WN.OptionIsNew(label)
  if not (label and label ~= "" and WN.Pending("options")) then return false end
  for _, it in ipairs(ns.Notes and ns.Notes.items or {}) do
    local text = (it[3] or "") .. " " .. (it[2] or "")
    local i = 1
    while true do
      local _, e = text:find("Options > ", i, true)
      if not e then break end
      if names(text:sub(e + 1):match("^[^%.;:%(%)]*"), label) then return true end
      i = e + 1
    end
  end
  return false
end

-- A small green "New" on `parent`, anchored with `point` to `relPoint` of `anchor`; hidden until shown.
function WN.Tag(parent, anchor, point, relPoint, x, y)
  local t = parent:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  t:SetText(L["New"])
  t:SetTextColor(NEW_COLOR[1], NEW_COLOR[2], NEW_COLOR[3], NEW_COLOR[4])
  t:SetPoint(point, anchor, relPoint, x or 0, y or 0)
  t:Hide()
  return t
end

-- A green dot at a tab's top right corner (a tab's label fills it, so a word wouldn't fit); hidden until shown.
function WN.Dot(tab)
  local d = tab:CreateTexture(nil, "OVERLAY")
  d:SetTexture("Interface\\Buttons\\WHITE8X8")
  d:SetVertexColor(NEW_COLOR[1], NEW_COLOR[2], NEW_COLOR[3], NEW_COLOR[4])
  d:SetSize(6, 6)
  d:SetPoint("TOPRIGHT", -3, -3)
  d:Hide()
  return d
end
