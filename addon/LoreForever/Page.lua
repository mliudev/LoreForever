-- A story's page (v2 "Your Chronicle", slice 2; the two-page spread, look slice V3): one page for a place, person, item
-- or quest, opened from every way in (the tooltip keys, the quest window's Lore button, names in answers and chat, the
-- Here list), over the conversation like the Journey page. It reads as an open book:
--   left page   the story: where it sits (the breadcrumb), its title, "kind · place · rarity", Listen with the
--               narrator and how long it runs, the story under an illuminated initial, its sections, and the passages
--               your quests haven't opened yet as seals
--   right page  what's yours: when and where you found it (and the quest you were on), for a quest what you read of it
--               (the text the game showed you, kept) with a Listen for what its quest giver said, the pages on the
--               same road you've found with the storyline it belongs to, the questions about it (what you asked, with
--               its answers, and the recorded questions you haven't; Margin.lua), and a line to ask about it, whose
--               answer is written on the page
-- The story still goes into the conversation underneath too (UI.ShowEntry), so Back shows it there and nothing that
-- read the chat changes.

local _, ns = ...
local Page = {}
ns.Page = Page
local L, T = ns.L, ns.Theme

-- Opened by these ways in (UI.ShowEntry's via; Found opens pages itself, as "found"); a story the player or the playlist reads aloud stays in the chat.
Page.VIA = { hover = true, questdialog = true, questlog = true, chatlink = true, link = true, here = true,
  quest = true, typed = true, target = true, page = true }

-- Parchment inks: the book's own (Theme.lua).
local INK, ACCENT, NOTE = T.color.ink, T.color.inkAccent, T.color.inkNote
local HINT = T.color.inkLight                 -- the ask box's placeholder: light, on the box's dark fill
local PAD, GAP, RELATED_MAX = 16, 10, 6
local SCROLL_W = 22                           -- what a scroll bar takes beside its text
-- What kind of page it is, by entry type (read through L when shown: the language pack loads after this file).
local KIND = { zone = "Zone", city = "City", dungeon = "Dungeon", subzone = "Place", npc = "Person", item = "Item",
  quest = "Quest", topic = "Of Azeroth" }
local KIND_L = { Zone = function() return L["Zone"] end, City = function() return L["City"] end,
  Dungeon = function() return L["Dungeon"] end, Place = function() return L["Place"] end,
  Person = function() return L["Person"] end, Item = function() return L["Item"] end,
  Quest = function() return L["Quest"] end, ["Of Azeroth"] = function() return L["Of Azeroth"] end }
-- The icon a page's chip wears (Theme.lua's kinds of page).
local CHIP_KIND = { zone = "place", city = "place", dungeon = "place", subzone = "place", npc = "person", item = "item",
  quest = "quest", topic = "storyline" }

local function esc(s) return (tostring(s or ""):gsub("|", "||")) end
local function settings() return (LoreForeverDB and LoreForeverDB.settings) or {} end
local function entries() return ns.DB and ns.DB.entries or {} end
local function try(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b = pcall(fn, ...)
  if ok then return a, b end
end

local function ink(fs, c)
  fs:SetTextColor(c[1], c[2], c[3], 1)
  if fs.SetShadowColor then fs:SetShadowColor(0, 0, 0, 0) end
  fs:SetJustifyH("LEFT")
  if fs.SetWordWrap then fs:SetWordWrap(true) end
  return fs
end

local function fitWidth(b, min)
  b:SetWidth(math.max(min or 60, math.floor((T.TextWidth(b:GetFontString()) or 40) + 24)))
end

-- The pool of text lines and buttons in the scrolling bodies, reused between pages: per body (the left page's, the
-- right page's), because a font string can't change its parent.
local pools = {}
local function take(content, kind, make)
  local pool = pools[content]
  if not pool then pool = {}; pools[content] = pool end
  local list = pool[kind]
  if not list then list = {}; pool[kind] = list end
  list.n = (list.n or 0) + 1
  local o = list[list.n]
  if not o then o = make(content); list[list.n] = o end
  o:ClearAllPoints()
  o:Show()
  return o
end
local function release()
  for _, pool in pairs(pools) do
    for _, list in pairs(pool) do
      for i = 1, #list do list[i]:Hide() end
      list.n = 0
    end
  end
end

-- What kind of page an entry type is ("Person"), in the reading language.
function Page.KindLabel(t) return KIND[t] and KIND_L[KIND[t]]() or "" end

-- An item page's rarity as ink on the parchment: the game's item colours, darkened to read on paper (slice 6). nil
-- for anything else, and for common items (they keep the page's own ink).
local RARITY = { [0] = { 0.36, 0.34, 0.30 }, [2] = { 0.06, 0.40, 0.02 }, [3] = { 0.00, 0.28, 0.62 },
  [4] = { 0.42, 0.10, 0.62 }, [5] = { 0.70, 0.32, 0.00 }, [6] = { 0.56, 0.44, 0.16 }, [7] = { 0.00, 0.40, 0.56 } }
function Page.RarityInk(key)
  local q = ns.Collection and ns.Collection.Quality(key)
  return q and RARITY[q] or nil
end

-- The rarity as a word in its own ink ("Rare"), for the line under the title: the game's own name for it, nothing for
-- anything that isn't a coloured item.
local function rarityWord(key)
  local q = ns.Collection and ns.Collection.Quality(key)
  local B = ns.Book
  local c = q and ((B and B.RarityInk and B.RarityInk(key)) or RARITY[q])   -- the same ink as the title's
  local name = q and _G["ITEM_QUALITY" .. q .. "_DESC"]
  if not (c and type(name) == "string" and name ~= "") then return nil end
  return string.format("|cff%02x%02x%02x%s|r", math.floor(c[1] * 255 + 0.5), math.floor(c[2] * 255 + 0.5),
    math.floor(c[3] * 255 + 0.5), esc(name))
end

-- "m:ss" for a length in seconds.
local function clock(secs)
  secs = math.max(0, math.floor((tonumber(secs) or 0) + 0.5))
  return string.format("%d:%02d", math.floor(secs / 60), secs % 60)
end

-- A narrator's name from its pack's title: "Lore Forever: item stories (male narrator)" is the male narrator, "Lore
-- Forever male narrator" too, and a community voice keeps its own name.
local function narratorName(title)
  title = tostring(title or "")
  local inner = title:match("%(([^%)]+)%)")
  if inner then return inner end
  local rest = title:gsub("^Lore Forever[%s:%-\226\128\148]*", "")
  return rest ~= "" and rest or nil
end

-- Who reads the page and for how long, as the voices have it: the first recording's pack and its length. Both can be
-- nil (an older pack states no length). Nothing is loaded for this: it reads what the voices already know.
function Page.Narration(key)
  local V = ns.Voice
  local paths = V and V.active and (V.active[key] or (V.questPaths and V.questPaths[key]))
  local path = type(paths) == "table" and paths[1]
  local pack = path and try(V.PackOf, path)
  if not pack then return nil end
  local title = try(V.PackName, pack)
  local length = try(V.PackLength, ns.Packs and ns.Packs.data and ns.Packs.data[pack], key)
  return narratorName(title), length
end

-- The page's own frame is only the book's outline; the two pages are on it. It lies over the whole book while it's
-- open (the sidebar too: the story takes both pages), above the foot player and beside the ribbons.

function Page.Create(f)
  local UI = ns.UI
  local p = CreateFrame("Frame", "LoreForeverStoryPage", f)
  p:SetPoint("TOPLEFT", 8, -60)
  p:SetPoint("BOTTOMRIGHT", -36, UI.DOCK_H or 80)
  p:SetFrameLevel((f:GetFrameLevel() or 1) + 20)
  T.CoverChat(p)
  p:Hide()
  Page.frame = p

  -- The left page: the story. The right page: what's yours.
  local lp = CreateFrame("Frame", nil, p)
  lp:EnableMouse(true)
  T.Parchment(lp, "left")
  local rp = CreateFrame("Frame", nil, p)
  rp:EnableMouse(true)
  T.Parchment(rp, "right")
  Page.left, Page.right = lp, rp

  local crumb = ink(lp:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
  crumb:SetPoint("TOPLEFT", PAD, -14)
  if crumb.SetWordWrap then crumb:SetWordWrap(false) end
  Page.crumb = crumb

  local back = T.Button(lp, L["Back"])
  back:SetHeight(22)
  back:SetPoint("TOPRIGHT", -PAD - 4, -8)
  fitWidth(back, 70)
  back:SetScript("OnClick", function() Page.Back() end)
  Page.backButton = back
  crumb:SetPoint("RIGHT", back, "LEFT", -8, 0)

  local title = ink(lp:CreateFontString(nil, "OVERLAY", "QuestTitleFont"), ACCENT)
  title:SetPoint("TOPLEFT", PAD, -38)
  title:SetPoint("RIGHT", lp, "RIGHT", -PAD - 8, 0)
  if title.SetMaxLines then title:SetMaxLines(2) end
  Page.title = title
  local sub = ink(lp:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
  sub:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -4)
  sub:SetPoint("RIGHT", lp, "RIGHT", -PAD - 8, 0)
  Page.sub = sub

  -- Listen: click plays it, Shift-click adds it to the playlist (the same meaning everywhere). The pill names the
  -- narrator; its length stands beside it.
  local listen = T.Chip(lp, T.ARROW, L["Listen"])
  listen:SetHeight(22)
  listen:SetActive(true)
  listen.icon:SetVertexColor(T.rgba(T.color.inkLight))
  listen:SetPoint("TOPLEFT", sub, "BOTTOMLEFT", 0, -8)
  listen:RegisterForClicks("LeftButtonUp")
  listen:SetScript("OnClick", function()
    local key = Page.key
    if not key then return end
    if IsShiftKeyDown and IsShiftKeyDown() then return UI.DoQueueAction(key) end
    UI.PlayEntry(key)
  end)
  listen:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
    GameTooltip:AddLine(Page.dialogue and L["Listen to the story"] or L["Listen"])   -- (the quest giver's Listen is on the right)
    T.Tip(L["Shift-click: add to your playlist"], "tipDim", true)
    GameTooltip:Show()
  end)
  listen:SetScript("OnLeave", function() GameTooltip:Hide() end)
  Page.listen = listen
  local length = ink(lp:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
  length:SetPoint("LEFT", listen, "RIGHT", 8, 0)
  Page.length = length
  local unvoiced = ink(lp:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
  unvoiced:SetPoint("TOPLEFT", sub, "BOTTOMLEFT", 0, -10)
  unvoiced:SetPoint("RIGHT", lp, "RIGHT", -PAD - 8, 0)
  Page.unvoiced = unvoiced

  -- The ask line at the foot of the right page: asked as in the conversation; an answer about a page is written on
  -- that page, under Questions (anything else, a "did you mean" say, shows in the conversation).
  local ask = CreateFrame("EditBox", nil, rp, "InputBoxTemplate")
  ask:SetHeight(22)
  ask:SetPoint("BOTTOMLEFT", PAD + 6, 10)
  ask:SetPoint("BOTTOMRIGHT", -PAD, 10)
  ask:SetAutoFocus(false)
  ask:SetFontObject(ChatFontNormal or "GameFontHighlight")
  ask:SetScript("OnEnterPressed", function(self)
    local q = (self:GetText() or ""):gsub("^%s+", ""):gsub("%s+$", "")
    self:SetText("")
    self:ClearFocus()
    if q == "" then return end
    ns.Margin.last = nil
    UI.Ask(q, "page", Page.key)   -- "who is this?" means the page's subject, not where you stand
    local m = ns.Margin.last
    if m and entries()[m.key] then return Page.ShowAsked(m.key) end
    Page.Hide()
    ns.Book.HidePage()   -- the answer is in the chat, under Found's pages
  end)
  ask:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  local hint = ask:CreateFontString(nil, "OVERLAY", T.font.hint)
  hint:SetPoint("LEFT", 2, 0)
  hint:SetPoint("RIGHT", -2, 0)
  hint:SetJustifyH("LEFT")
  hint:SetTextColor(HINT[1], HINT[2], HINT[3], 1)
  ask:SetScript("OnEditFocusGained", function() hint:Hide() end)
  ask:SetScript("OnEditFocusLost", function(self) hint:SetShown((self:GetText() or "") == "") end)
  Page.ask, Page.askHint = ask, hint

  -- The two bodies, each scrolling on its own.
  local function body(parent)
    local sf = CreateFrame("ScrollFrame", nil, parent, "UIPanelScrollFrameTemplate")
    local content = CreateFrame("Frame", nil, sf)
    content:SetSize(300, 100)
    sf:SetScrollChild(content)
    return sf, content
  end
  Page.scroll, Page.content = body(lp)       -- the left page's (the story)
  Page.rscroll, Page.rcontent = body(rp)     -- the right page's (what's yours)
  Page.qscroll = Page.rscroll                -- the one that holds the questions

  p:SetScript("OnSizeChanged", function(self) if self:IsShown() and Page.key then Page.Layout() end end)
  -- Only one page over the conversation at a time.
  p:HookScript("OnShow", function()
    if UI.journeyPage then UI.journeyPage:Hide() end
    if UI.historyFrame then UI.historyFrame:Hide() end
  end)
  for _, other in ipairs({ UI.journeyPage, UI.historyFrame }) do
    if other then other:HookScript("OnShow", function() p:Hide() end) end
  end
  -- Found's page is hidden while a story's page is over it (its chips, tiles and scroll bar sit on levels above this
  -- page's own), and comes back when this one closes, if Found is still the tab and nothing else took the place.
  p:HookScript("OnShow", function()
    if ns.Book and ns.Book.frame then ns.Book.frame:Hide() end
  end)
  -- The page has its own ask line: the panel's (message box, its field and Send) isn't shown beside it, and is back
  -- when the page closes, whichever way it closes (UI.pageOpen: PlaceChat and Layout keep it hidden meanwhile).
  p:HookScript("OnShow", function()
    UI.pageOpen = true
    UI.ShowAskRow()
  end)
  p:HookScript("OnHide", function()
    UI.pageOpen = nil
    UI.ShowAskRow()
  end)
  p:HookScript("OnHide", function()
    local book = ns.Book
    if not (book and book.frame) or book.frame:IsShown() then return end
    if not book.OnTab() or not (UI.frame and UI.frame:IsShown()) then return end
    if (UI.journeyPage and UI.journeyPage:IsShown()) or (UI.historyFrame and UI.historyFrame:IsShown()) then return end
    book.frame:Show()
    book.RefreshPage()
  end)
  return p
end

-- Where the pages sit: side by side, half the frame each. Returns the width each page's text has.
function Page.Place()
  local UI, p, lp, rp = ns.UI, Page.frame, Page.left, Page.right
  local pw = tonumber(p:GetWidth()) or 0
  if pw <= 0 then pw = (tonumber(UI.frame and UI.frame:GetWidth()) or 820) - 44 end
  local half = math.floor(pw / 2)
  lp:ClearAllPoints()
  lp:SetPoint("TOPLEFT", p, "TOPLEFT", 0, 0)
  lp:SetPoint("BOTTOMLEFT", p, "BOTTOMLEFT", 0, 0)
  lp:SetWidth(half)
  rp:ClearAllPoints()
  rp:SetPoint("TOPRIGHT", p, "TOPRIGHT", 0, 0)
  rp:SetPoint("BOTTOMRIGHT", p, "BOTTOMRIGHT", 0, 0)
  rp:SetWidth(math.max(1, pw - half))
  return half, pw - half
end

-- Your moment with it, as the chronicle recorded it: "Found 22 Oct at Sentinel Hill, level 14. While on "The People's
-- Militia"." Only what it knows is said; nil when it knows nothing (a page that isn't in the chronicle).
function Page.Chronicle(key)
  local rec = ns.Collection and ns.Collection.Found(key)
  if not rec then return nil end
  local when
  if rec.t and rec.t > 0 then
    local day, month = try(date, "%d", rec.t), try(date, "%b", rec.t)
    when = day and month and string.format("%d %s", tonumber(day) or 0, month) or nil
  end
  local place, lv = rec.place and esc(rec.place), rec.lv
  local line
  if when and place and lv then line = string.format(L["Found %s at %s, level %d."], when, place, lv)
  elseif when and place then line = string.format(L["Found %s at %s."], when, place)
  elseif when and lv then line = string.format(L["Found %s, level %d."], when, lv)
  elseif when then line = string.format(L["Found %s."], when)
  elseif place and lv then line = string.format(L["Found at %s, level %d."], place, lv)
  elseif place then line = string.format(L["Found at %s."], place) end
  if line and rec.quest then line = line .. " " .. string.format(L["While on \"%s\"."], esc(rec.quest)) end
  return line
end

-- The journey's own line for a quest ("You took it at ..., finished it ..."): it says more than the chronicle does.
function Page.Journey(key)
  local e = entries()[key]
  if not (e and e.t == "quest") then return nil end
  local ok, line = pcall(ns.UI.YouLine, key)
  return ok and type(line) == "string" and line ~= "" and line or nil
end

-- The pages on the same road: the related entries this character has found (one not found yet stays a secret).
function Page.Related(key)
  local out, e = {}, entries()[key]
  for _, k in ipairs(e and e.rel or {}) do
    if k ~= key and entries()[k] and ns.Collection and ns.Collection.IsFound(k) then out[#out + 1] = k end
    if #out >= RELATED_MAX then break end
  end
  return out
end

-- The storyline this page belongs to, as { id, name }: a quest's own, else the first of the quests found on the same
-- road. Named only once its first quest is started (Storyline.Name), and not at all while "Show storylines on quests"
-- is off. Only its name, never which step this is or how many there are: Mike's rule of 10/3 (commit 82531523), at the
-- top of Storyline.lua ("It never says which step a quest is, how many there are, or where the storyline starts or
-- ends").
function Page.Storyline(key)
  local S, e = ns.Storyline, entries()[key]
  if not (S and e and S.Shown()) then return nil end
  local ids = {}
  if e.t == "quest" then
    ids[1] = e.m and e.m.id
  else
    for _, k in ipairs(Page.Related(key)) do
      local re = entries()[k]
      if re.t == "quest" and re.m and re.m.id then ids[#ids + 1] = re.m.id end
    end
  end
  for _, qid in ipairs(ids) do
    local sl, sid = S.For(qid)
    local name = sl and S.Name(sl, e.t == "quest" and qid or nil)
    if name then
      return { id = sid, name = name }
    end
  end
  return nil
end

local function textLine(content, width, y, text, font, color)
  local fs = take(content, "text", function(c) return c:CreateFontString(nil, "OVERLAY") end)
  fs:SetFontObject(font)
  ink(fs, color)
  fs:SetWidth(width)
  fs:SetText(text)
  fs:SetPoint("TOPLEFT", 0, y)
  return y - (fs:GetStringHeight() or 14) - GAP
end

-- A thin line across the body, between what's yours and its questions.
local function rule(content, width, y)
  local r = take(content, "rule", function(c)
    local f = CreateFrame("Frame", nil, c)
    f:SetHeight(1)
    f.line = T.Area(f, "inkRule", "ARTWORK")
    f.line:SetAllPoints()
    return f
  end)
  r:SetWidth(width)
  r:SetPoint("TOPLEFT", 0, y - 2)
  return y - 2 - GAP
end

-- Questions in the margin: what you asked about it, the newest first, each with its answer; then the recorded
-- questions you haven't asked (one that would spoil a storyline you're on stays out until you've reached it). Click
-- one to write its answer here, with Listen when it's recorded.
function Page.Questions(key)
  local e = entries()[key]
  local asked, faqs, seen = ns.Margin.List(key), {}, {}
  for _, a in ipairs(asked) do seen[tostring(a.q):lower()] = true end
  for i, f in ipairs(e and e.faq or {}) do
    if type(f.q) == "string" and not f.answerOnly and not seen[f.q:lower()]
        and (not f.sp or ns.UI.SpoilerAllowed(key, "faq", i)) then faqs[#faqs + 1] = i end
  end
  return asked, faqs
end

local function questions(content, width, y, key, e)
  local asked, faqs = Page.Questions(key)
  Page.questionsY = nil
  if #asked == 0 and #faqs == 0 then return y end
  if y < 0 then y = rule(content, width, y) end   -- (a rule under what's above it, never at the very top)
  Page.questionsY = -y
  y = textLine(content, width, y, L["Questions"], "GameFontNormalSmall", NOTE) + GAP - 4
  for _, a in ipairs(asked) do
    y = textLine(content, width, y, L["You asked:"] .. " " .. esc(a.q), "GameFontNormal", ACCENT) + GAP - 6
    if type(a.a) == "string" and a.a ~= "" then y = textLine(content, width, y, esc(a.a), T.font.body, INK) end
  end
  for _, i in ipairs(faqs) do
    local f = e.faq[i]
    local b = take(content, "q", function(c)
      local r = CreateFrame("Button", nil, c)
      r.text = ink(r:CreateFontString(nil, "OVERLAY", "GameFontNormal"), ACCENT)
      r.text:SetPoint("TOPLEFT", 0, 0)
      if r.text.SetWordWrap then r.text:SetWordWrap(true) end
      r:SetScript("OnClick", function(self)
        Page.opened[self.idx] = not Page.opened[self.idx] or nil
        Page.Layout()
      end)
      r:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        T.Tip(Page.opened[self.idx] and L["Click: fold the answer away"] or L["Click: write its answer here"], "tipDim", true)
        GameTooltip:Show()
      end)
      r:SetScript("OnLeave", function() GameTooltip:Hide() end)
      -- A row under the mouse lights up, as every clickable row does (a little wider than the words).
      local hl = r:CreateTexture(nil, "HIGHLIGHT")
      hl:SetPoint("TOPLEFT", -4, 2)
      hl:SetPoint("BOTTOMRIGHT", 4, -2)
      T.Fill(hl, "inkHover")
      return r
    end)
    b.idx = i
    b.text:SetWidth(width)
    b.text:SetText(esc(f.q))
    local h = math.max(18, b.text:GetStringHeight() or 14)   -- easy to click, one line or two
    b:SetSize(width, h)
    b:SetPoint("TOPLEFT", 0, y)
    y = y - h - GAP
    if Page.opened[i] then
      y = textLine(content, width, y + 4, esc(f.a), T.font.body, INK)
      local target = ns.UI.FaqTarget(key, i)
      if target and ns.Voice.HasAudio(target.key) then
        local l = take(content, "listen", function(c)
          local r = T.Button(c, L["Listen"])
          r:SetHeight(20)
          fitWidth(r, 60)
          r:SetScript("OnClick", function(self) ns.UI.PlayFaq(Page.key, self.idx) end)
          return r
        end)
        l.idx = i
        l:SetPoint("TOPLEFT", 0, y + 4)
        y = y - 20 - GAP
      end
    end
  end
  return y
end

-- The story: its first paragraph under an illuminated initial, then its sections, each a heading and its words, or a
-- seal where a passage waits on a storyline you're on.
local function story(content, width, y, key, e)
  local text = tostring(e.s or "")
  local first = text:match("^%s*(.)")
  if first and first ~= "|" and text:find("%S") then
    local d = Page.drop
    if not d then d = T.DropCap(content, T.font.body); Page.drop = d end
    y = y - 8   -- the initial stands a little above its first line
    d:ClearAllPoints()
    d:SetPoint("TOPLEFT", content, "TOPLEFT", 0, y)
    d:SetParagraph(esc(text), width, 3)
    d:Show()
    y = y - (d:GetHeight() or 40) - GAP
  else
    if Page.drop then Page.drop:Hide() end
    y = textLine(content, width, y, esc(text), T.font.body, INK)
  end
  local all, done = settings().showSpoilers, ns.Context.Done()
  for i, sec in ipairs(e.sec or {}) do
    if all or Page.revealed[i] or ns.UI.engine:Opens(key, sec, done) then
      y = textLine(content, width, y, esc(sec.t), T.font.body, ACCENT) + GAP - 4
      y = textLine(content, width, y, esc(sec.b), T.font.body, INK)
    else
      -- A seal: never the passage's title, only that it waits, and a way to read it anyway.
      local row = take(content, "seal", function(c)
        local r = CreateFrame("Frame", nil, c)
        r.text = ink(r:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall"), NOTE)
        r.text:SetPoint("TOPLEFT", 20, 0)
        r.wax = T.Seal(r, "wax", 14)
        r.wax:SetPoint("TOPLEFT", 0, 0)
        r.read = T.Button(r, L["Read it anyway"])
        r.read:SetHeight(20)
        fitWidth(r.read, 60)
        r.read:SetScript("OnClick", function(self) Page.revealed[self.idx] = true; Page.Layout() end)
        return r
      end)
      row:SetWidth(width)
      row.text:SetWidth(width - 20)
      row.text:SetText(L["A passage here opens further along a storyline you're on."])
      row.read.idx = i
      row.read:ClearAllPoints()
      row.read:SetPoint("TOPLEFT", row.text, "BOTTOMLEFT", 0, -4)
      local h = (row.text:GetStringHeight() or 14) + 4 + 20
      row:SetHeight(h)
      row:SetPoint("TOPLEFT", 0, y)
      y = y - h - GAP
    end
  end
  return y
end

-- A quest's id, for a quest's page.
local function questId(e)
  return e and e.t == "quest" and e.m and tonumber(e.m.id) or nil
end

-- A quest page's quest giver: what you read of the quest, as the game showed it and was kept (Journey.KeptText), under
-- a Listen for what they said when a voice recorded it (UI.PlayQuestDialogue: the offer, then the hand-in once done).
-- No kept text leaves only the Listen; neither leaves nothing. None of it is shipped with the add-on: it is the player's.
local function read(content, width, y, key, e)
  local qid = questId(e)
  if not qid then return y end
  local kept = ns.Journey and ns.Journey.KeptText(qid)
  local heard = Page.dialogue
  if not (kept or heard) then return y end
  if y < 0 then y = rule(content, width, y) end
  y = textLine(content, width, y, kept and L["What you read"] or L["What they said"], T.font.heading, ACCENT)
  if heard then
    local b = take(content, "dialogue", function(c)
      local r = T.Button(c, L["Listen to the quest giver"])
      r:SetHeight(20)
      fitWidth(r, 60)
      r:SetScript("OnClick", function() if Page.qid then ns.UI.PlayQuestDialogue(Page.qid) end end)
      r:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        GameTooltip:AddLine(L["Listen to the quest giver"])
        T.Tip(L["What they said when you took the quest, and when you handed it in."], "tipDim", true)
        GameTooltip:Show()
      end)
      r:SetScript("OnLeave", function() GameTooltip:Hide() end)
      return r
    end)
    b:SetPoint("TOPLEFT", 0, y + 2)
    y = y - 20 - GAP + 2
  end
  for _, part in ipairs(kept or {}) do
    y = textLine(content, width, y, part.label, "GameFontNormalSmall", NOTE) + GAP - 4
    y = textLine(content, width, y, esc(part.text), T.font.body, INK)
  end
  return y
end

-- What's yours on the page: your moment, for a quest what you read of it, the pages on the same road with the
-- storyline it belongs to, then the questions.
local function yours(content, width, y, key, e)
  local moment, journey = Page.Chronicle(key), Page.Journey(key)
  if moment or journey then
    y = textLine(content, width, y, L["In your chronicle"], T.font.heading, ACCENT)
    if moment then y = textLine(content, width, y + 2, moment, T.font.body, INK) end
    if journey then y = textLine(content, width, y + (moment and 0 or 2), esc(journey), T.font.body, NOTE) end
  end
  y = read(content, width, y, key, e)
  local related, line = Page.Related(key), Page.Storyline(key)
  if #related > 0 or line then
    y = textLine(content, width, y, L["On the same road"], "GameFontNormalSmall", NOTE) + GAP - 4
    local x, rowH = 0, 26
    local function chip(icon, text, onClick, tip)
      local b = take(content, "rel", function(c)
        local r = T.Chip(c, "place", "")
        r:SetScript("OnClick", function(self) if self.go then self.go(self) end end)
        r:SetScript("OnEnter", function(self)
          if not self.tip then return end
          GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
          GameTooltip:AddLine(self.tipTitle or "")
          T.Tip(self.tip, "tipDim", true)
          GameTooltip:Show()
        end)
        r:SetScript("OnLeave", function() GameTooltip:Hide() end)
        return r
      end)
      b.go, b.tip, b.tipTitle = onClick, tip, tip and L["Storyline"] or nil
      b:SetIcon(icon)
      b:SetText(text)
      b:SetWidth(math.min(b:GetWidth() or 80, width))
      local w = b:GetWidth() or 80
      if x > 0 and x + w > width then x, y = 0, y - rowH end
      b:SetPoint("TOPLEFT", x, y)
      x = x + w + 6
    end
    if line then
      -- "Storyline · The Defias Brotherhood": the name only (see Page.Storyline)
      chip("storyline", L["Storyline"] .. ns.Lang.Dotted(" · ") .. esc(line.name),
        function()
          local R = ns.Road
          if R then R.story = "*sl:" .. tostring(line.id) end
          Page.Hide()
          if ns.UI.ShowTab then ns.UI.ShowTab("story") end
        end, L["Click: see its quests you've found"])
    end
    for _, k in ipairs(related) do
      chip(CHIP_KIND[entries()[k].t] or "place", esc(entries()[k].n), function() Page.Show(k, "page") end)
    end
    y = y - rowH - GAP + 4
  end
  return questions(content, width, y, key, e)
end

function Page.Layout()
  local key = Page.key
  local e = key and entries()[key]
  if not e then return end
  local lw, rw = Page.Place()
  local lcontent, rcontent = Page.content, Page.rcontent
  local left, right = Page.left, Page.right
  -- Where the bodies sit: under the left page's head (the story's), and above the ask line (the right page's).
  local sf, rsf = Page.scroll, Page.rscroll
  sf:ClearAllPoints()
  sf:SetPoint("TOPLEFT", Page.listen, "BOTTOMLEFT", 0, -GAP)
  sf:SetPoint("BOTTOMRIGHT", left, "BOTTOMRIGHT", -PAD - SCROLL_W + 6, 10)
  rsf:ClearAllPoints()
  rsf:SetPoint("TOPLEFT", right, "TOPLEFT", PAD, -14)
  rsf:SetPoint("BOTTOMRIGHT", Page.ask, "TOPRIGHT", -SCROLL_W, GAP)
  -- (a long narrator's name never runs the pill out of its page: the length stands beside it)
  Page.listen:Fit()
  Page.listen:SetWidth(math.min(Page.listen:GetWidth() or 120, math.max(80, lw - PAD * 2 - 70)))
  local width = math.max(160, lw - PAD * 2 - SCROLL_W)
  local rwidth = math.max(160, rw - PAD * 2 - SCROLL_W)
  lcontent:SetWidth(width)
  rcontent:SetWidth(rwidth)
  release()
  local y = story(lcontent, width, 0, key, e)
  local ry = yours(rcontent, rwidth, 0, key, e)
  lcontent:SetHeight(math.max(20, -y))
  rcontent:SetHeight(math.max(20, -ry))
end

function Page.Refresh()
  local key = Page.key
  local e = key and entries()[key]
  if not e then return end
  Page.title:SetText(esc(e.n))
  -- (an item in its rarity colour, darkened for the paper: Book.NameInk, with Page's own set where Book has none)
  local B = ns.Book
  if B and B.NameInk then
    ink(Page.title, ACCENT)
    B.NameInk(Page.title, key, ACCENT)
  else
    ink(Page.title, Page.RarityInk(key) or ACCENT)
  end
  local zone = e.z and ns.DB.zones and ns.DB.zones[e.z]
  local kind = Page.KindLabel(e.t)
  local dot = ns.Lang.Dotted(" · ")
  local parts = {}
  if kind ~= "" then parts[#parts + 1] = kind end
  if zone and zone.n then parts[#parts + 1] = esc(zone.n) end
  parts[#parts + 1] = rarityWord(key)
  Page.sub:SetText(table.concat(parts, dot))
  Page.crumb:SetText("\226\128\185 " .. esc(zone and zone.n and (kind ~= "" and (zone.n .. dot .. kind) or zone.n) or kind))
  Page.qid = questId(e)
  Page.dialogue = Page.qid ~= nil and ns.UI.HasQuestDialogue(Page.qid)   -- a voice recorded its quest giver
  local target = ns.UI.EntryTarget(key)
  local voiced = target and ns.Voice.HasAudio(target.key) and true or false
  Page.listen:SetShown(voiced)
  Page.length:SetShown(voiced)
  if voiced then
    local who, secs = Page.Narration(key)
    Page.listen:SetText(who and (L["Listen"] .. dot .. esc(who)) or L["Listen"])
    Page.length:SetText(secs and clock(secs) or "")
  end
  -- A recording planned that this player can't play (not recorded yet, or its voices aren't installed).
  local planned = not voiced and ns.Voice.Current() ~= "none" and (ns.DB.clipHash or {})[key]
  Page.unvoiced:SetText(planned and L["Not in your voices yet: read it here."] or "")
  Page.askHint:SetText(string.format(L["Ask about %s"], esc(e.n)))
  Page.askHint:SetShown((Page.ask:GetText() or "") == "")
  Page.Layout()
  if Page.scroll.SetVerticalScroll then Page.scroll:SetVerticalScroll(0) end
  if Page.rscroll.SetVerticalScroll then Page.rscroll:SetVerticalScroll(0) end
end

-- Opens `key`'s page (and the panel). Pages opened from a page stack up for Back.
function Page.Show(key, via)
  if not (Page.frame and key and entries()[key]) then return end
  local UI = ns.UI
  if UI.frame and not UI.frame:IsShown() then UI.frame:Show() end
  if not (via == "page" and Page.frame:IsShown()) then Page.backTo = nil end   -- (UI.OpenChronicle sets it after)
  Page.stack = (via == "page" and Page.frame:IsShown()) and Page.stack or {}
  if Page.stack[#Page.stack] ~= key then Page.stack[#Page.stack + 1] = key end
  Page.key, Page.revealed, Page.opened = key, {}, {}
  Page.frame:Show()
  Page.Refresh()
  ns.Log.Use("page")
  if ns.Collection.Read(key) then ns.Book.Changed() end   -- it isn't new any more
end

-- After asking on a page: the page the answer is about, scrolled to its questions (the newest is the one just asked).
function Page.ShowAsked(key)
  if Page.key ~= key or not Page.IsShown() then Page.Show(key, "page") else Page.Layout() end
  local sf, y = Page.qscroll, Page.questionsY
  if y and sf.SetVerticalScroll then
    local range = tonumber(sf.GetVerticalScrollRange and sf:GetVerticalScrollRange()) or y
    sf:SetVerticalScroll(math.min(y, range))
  end
end

function Page.Back()
  local stack = Page.stack or {}
  table.remove(stack)
  local prev = stack[#stack]
  if prev then
    Page.key, Page.revealed, Page.opened = prev, {}, {}
    return Page.Refresh()
  end
  -- Nothing behind it: back to the list, or to the bookmark it was opened from (the Road).
  local to = Page.backTo
  Page.backTo = nil
  Page.Hide()
  if to and ns.UI.ShowTab then ns.UI.ShowTab(to) end
end

-- Which page is open and the pages behind it (for Back), to open it again later (UI.ShowTab); nil if none is.
function Page.Snapshot()
  if not (Page.key and Page.IsShown()) then return nil end
  local stack = {}
  for i, k in ipairs(Page.stack or {}) do stack[i] = k end
  return { key = Page.key, stack = stack, backTo = Page.backTo }
end

function Page.Restore(snap)
  if not (snap and snap.key and entries()[snap.key]) then return end
  Page.Show(snap.key, "found")
  Page.stack, Page.backTo = snap.stack, snap.backTo
end

function Page.Hide()
  if Page.frame then Page.frame:Hide() end
end

function Page.IsShown() return Page.frame and Page.frame:IsShown() or false end
