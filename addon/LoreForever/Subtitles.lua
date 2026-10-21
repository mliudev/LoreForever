-- Subtitles (LOR-344, LOR-183): the words of the narration that plays, on screen in step with the voice, while the
-- panel is closed (open, its chat already shows them). Players asked twice (a commenter who reads quests for a
-- dyslexic friend; "on-screen subtitles while lore is read aloud, so I can keep moving"), and Mike, 2026-10-18:
-- "Definitely need some nice subtitles. I think the spoken player does a pretty good job so let's get parity with it."
--
-- Like Spoken's subtitle (rusty-key/spoken-wow, UI/Subtitle.lua; nothing of it copied): a dark band low in the middle
-- of the screen with the story's name in gold above its words, a page of one or two sentences (three lines at most)
-- at a time, and a thin progress line under them. The words the voice has reached turn from parchment to white, the
-- one being said is gold. Our own look (Theme.lua's gold on dark, the game's font objects, no bundled art), and it
-- never takes a click: no frame in the middle of the screen eats the clicks that turn the camera. Shift-drag moves it
-- (the mouse goes to it only while Shift is held over it), Options has the switch and the size, the floating player's
-- right-click menu the switch, and Reset windows puts it back.
--
-- It only follows what plays (UI.speaking, UI.activeTarget, Voice.lastClip, Voice.Position): it never starts, stops
-- or holds a recording, so the queue, arrivals and "only when I press Play" stay as they are. Stop, pause, skip, a new
-- story or the panel opening hide it; the next story replaces it.
--
-- Timing: a recording with pieces (Voice.transport) says exactly where it is, and a complete story knows its length
-- (Voice.lastClip.duration). Other recordings carry no length, so it comes from the words: characters a second for that
-- voice, measured on its complete stories (their text and length are in its Transport.lua) and learned from every
-- recording heard to its end (LoreForeverDB.subtitleRates). Within a story each word gets a share of the time by its
-- length, with a little more after a comma or a full stop.

local _, ns = ...
local Sub = {}
ns.Subtitles = Sub
local L = ns.L
local T = ns.Theme

local MAX_W = 620            -- the band's width, at most 60% of the screen's
local FADE = 40              -- the band's ends fade out over this much, outside the words
local PAD = FADE + 6         -- the words' inset from the band's sides
local TOP_PAD, ROW_GAP, BAR_GAP, BOTTOM_PAD = 8, 4, 7, 9
local MAX_LINES, MAX_SENTENCES = 3, 2
local FONT_SIZE = 16
local BAR_SHARE, BAR_H = 0.42, 2
local DEFAULT_Y = 210        -- the band's bottom edge above the screen's, until it's dragged (or bars sit higher)
local BAR_CLEAR = 18         -- room kept above the action bars and the cast bar
local SHOW_IN, SHOW_OUT, PAGE_IN = 0.25, 0.4, 0.18
local DEFAULT_CPS = 16.5     -- characters a second, for a voice with nothing to go by (our narrators: 16.2-17.8)
local LEARN = 0.35           -- how far one recording heard to its end moves a voice's learned speed
Sub.SCALES = { 0.85, 1, 1.25, 1.5 }

-- On the dark band: what the voice has reached, the word it's on, and what's still to come (no darker than Theme's
-- 0.78 floor for text on the dark ground).
local SAID, NOW, AHEAD = "|cffffffff", "|cffffd100", "|cffd2c7ac"
local UTF8 = "[%z\1-\127\194-\244][\128-\191]*"

local function S() return (LoreForeverDB and LoreForeverDB.settings) or {} end
local function now() return GetTime and GetTime() or 0 end
local function chars(s)
  local _, n = tostring(s or ""):gsub(UTF8, "")
  return n
end
local function trim(s) return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", "")) end

function Sub.On() return S().subtitles ~= false end

function Sub.Scale()
  local v = tonumber(S().subtitleScale) or 1
  for _, s in ipairs(Sub.SCALES) do if math.abs(s - v) < 0.001 then return s end end
  return 1
end

-- Text -------------------------------------------------------------------------------------------------------------

-- What a narrator leaves out (lore.clips.spoken): a short stage direction in <...>, an emote between asterisks
-- (*hic*); other words between asterisks are emphasis and stay.
local EMOTES = {}
for w in ([[ahem belch burp chuckle chuckles cough coughs cries gasp gasps giggle giggles grin grins groan groans
  growl growls grumble grumbles grunt grunts hic hiccup hmph laugh laughs mumble mumbles mutter mutters sigh sighs
  sneeze sniff sniffs snicker snickers snort snorts sob sobs whistle whistles wink winks yawn yawns shrug shrugs nod
  nods smile smiles cackle cackles]]):gmatch("%a+") do EMOTES[w] = true end

function Sub.Spoken(text)
  local original = tostring(text or "")
  if not (original:find("<", 1, true) or original:find("*", 1, true)) then return original end
  text = original:gsub("[ \t]*<([^<>]*)>", function(inner)
    local n = chars(inner)
    if n >= 1 and n <= 60 then return "" end
  end)
  text = text:gsub("%*([^*\n]+)%*", function(inner)
    if chars(inner) > 60 then return nil end
    local first = inner:match("^%s*(%a+)")
    return (first and EMOTES[first:lower()]) and "" or trim(inner)
  end)
  if text == original then return original end
  text = text:gsub("[ \t][ \t]+", " "):gsub("%.%.%.[ \t]*%.%.%.", "...")
  text = ("\0" .. text):gsub("([^%.])([%.!%?])[ \t]+%.%.%.", "%1%2"):sub(2)       -- "reward. ... What?"
  text = text:gsub("[ \t]+([,!%?;:])", "%1"):gsub("[ \t]+%.([^%.])", ".%1"):gsub("[ \t]+%.$", ".")
  local lines = {}
  for line in (text .. "\n"):gmatch("([^\n]*)\n") do lines[#lines + 1] = trim(line) end
  return trim(table.concat(lines, "\n"))
end

local function entries() return (ns.UI and ns.UI.engine and ns.UI.engine.db and ns.UI.engine.db.entries) or {} end

-- What an entry's own recording reads (lore.clips.script, and localized_text in a language pack): its name, its
-- summary and its first spoiler-free section, cut at a full stop within 1900 characters.
local MAX_CHARS = 1900
function Sub.Overview(e)
  local parts = { (e.n or "") .. ".", e.s or "" }
  for _, sec in ipairs(e.sec or {}) do
    if (sec.sp or 0) == 0 then
      if sec.b and sec.b ~= "" then parts[#parts + 1] = sec.b end
      break
    end
  end
  local text = Sub.Spoken(table.concat(parts, " "))
  if chars(text) > MAX_CHARS then   -- the first MAX_CHARS characters, to the last full stop in them
    local n, stop = 0, #text
    for at in text:gmatch("()" .. UTF8) do
      n = n + 1
      if n > MAX_CHARS then stop = at - 1 break end
    end
    local cut, last = text:sub(1, stop), nil
    for at in cut:gmatch("()%. ") do last = at end
    text = last and cut:sub(1, last) or (cut .. ".")
  end
  return text
end

-- A quest giver's page as the game shows it: the open quest window's, else what the quest log or a past visit kept
-- (the recording reads the quest's text alone, never its title or objectives).
local QUEST_TEXT = { detail = "GetQuestText", progress = "GetProgressText", complete = "GetRewardText" }
local QUEST_FIELD = { detail = "text", progress = "progress", complete = "completion" }
local function questText(target, kind)
  local open = target.id and target.id:match("^questtext:(%d+):")
  local QF = _G.QuestFrame
  if open and QF and QF:IsShown() and ns.Voice.questKind == kind then
    local f = _G[QUEST_TEXT[kind]]
    local ok, words = false, nil
    if f then ok, words = pcall(f) end
    if ok and type(words) == "string" and words:find("%S") then return words end
  end
  local qid = tonumber(open) or tonumber(target.id and target.id:match("^questlog:(%d+):"))
  if not qid and ns.UI and ns.UI.pl then
    local cur = ns.UI.pl.items[ns.UI.pl.pos]
    qid = cur and cur.pages and tonumber(cur.quest)
  end
  local saved = qid and LoreForeverDB and type(LoreForeverDB.quests) == "table" and LoreForeverDB.quests[qid]
  local text = type(saved) == "table" and saved[QUEST_FIELD[kind]]
  if type(text) == "string" and text:find("%S") then return text end
  -- The target's own words: the quest log's offer is its text and then its objectives.
  return target.text
end

-- (title, words) for what `target` plays, `clip` its recording (Voice.lastClip): the words the recording was made
-- from when it carries them (a complete story, a community voice, an edition), else the ones its clip reads. The
-- story's name shows as the title, so a lead-in "Westfall." is left out of the words.
function Sub.TextFor(target, clip)
  if not target then return nil end
  local key = target.key or ""
  local title, text = target.label, nil
  local base, faq = key:match("^(.-)#faq(%d+)$")
  local e = entries()[base or key]
  if clip and clip.id == key and type(clip.text) == "string" and clip.text:find("%S") then
    text = clip.text
    title = clip.title or title
  end
  local qkind = key:match("^quest:%d+#(%a+)$")
  if not text and qkind then
    -- A recording in Lore Forever's language over the game's English page shows its own words (Voice.QuestClip);
    -- false: an older pack without them, so no subtitles rather than English words that aren't the ones heard.
    local own = ns.Voice.questWords and ns.Voice.questWords[key]
    if own == false then return nil end
    text = own or questText(target, qkind)
  end
  if not text and base and e and e.faq then
    local f = e.faq[ns.Lang.FaqIndex(base, faq) or tonumber(faq)]
    if f then text = Sub.Spoken(trim(f.q)) .. "\n\n" .. Sub.Spoken(trim(f.a)) end
  end
  if not text and e then text = Sub.Overview(e) end
  text = Sub.Spoken(text or target.text or "")
  if e then
    if base then title = e.n or title
    elseif not qkind then title = e.n or title end
    local lead = (e.n or "") .. "."
    if e.n and text:sub(1, #lead) == lead then text = trim(text:sub(#lead + 1)) end
  end
  if not text:find("%S") then return nil end
  return ns.Voice.Plain(title or ""), text
end

-- Words, sentences and pages ---------------------------------------------------------------------------------------

local STOPS = { ["."] = true, ["!"] = true, ["?"] = true, ["\226\128\166"] = true,   -- … (and 。！？ below)
  ["\227\128\130"] = true, ["\239\188\129"] = true, ["\239\188\159"] = true }
local PHRASE = { [","] = true, [";"] = true, [":"] = true, ["\226\128\148"] = true, ["\226\128\147"] = true,
  ["\239\188\140"] = true, ["\227\128\129"] = true }
local CLOSERS = "[\"'%)%]\226\128\157\226\128\153\194\187]"
local TITLES = { ["Mr."] = true, ["Mrs."] = true, ["Dr."] = true, ["St."] = true, ["Mt."] = true, ["Jr."] = true,
  ["Sr."] = true, ["vs."] = true }

-- The last character of a word that isn't a closing quote or bracket.
local function lastMark(word)
  local w = word
  for _ = 1, 3 do
    local stripped = w:gsub(CLOSERS .. "$", "")
    if stripped == w then break end
    w = stripped
  end
  local last
  for c in w:gmatch(UTF8) do last = c end
  return last
end

-- The words of `text`, each one's share of the time, and where sentences and phrases end. Shown, they're joined by
-- single spaces (a quest's paragraphs and an answer's question run on in the band).
function Sub.Words(text)
  local words, total = {}, 0
  for space, run in text:gmatch("(%s*)(%S+)") do
    local mark = lastMark(run)
    local stop = STOPS[mark] or false
    -- "Dr." and "St." end no sentence; neither do initials ("A.").
    if mark == "." and (run:match("^%u%.$") or TITLES[run]) then stop = false end
    local phrase = PHRASE[mark] or run == "--" or false
    local weight = 0.6 + chars(run) * 0.12 + (stop and 0.9 or (phrase and 0.45 or 0))
    if space:find("\n") and words[#words] then words[#words].weight = words[#words].weight + 0.5 end
    words[#words + 1] = { text = run, stop = stop, phrase = phrase, weight = weight }
  end
  for _, w in ipairs(words) do
    w.t0 = total
    total = total + w.weight
    w.t1 = total
  end
  return words, total
end

-- Pages of whole sentences, MAX_SENTENCES and MAX_LINES lines at most; a sentence too long for a page turns at its
-- phrases (commas, semicolons, dashes), and a phrase too long at a word. fits(a, b): words a..b fit one page.
function Sub.Paginate(words, fits)
  local pieces, a = {}, 1
  for i, w in ipairs(words) do
    if w.stop or i == #words then
      pieces[#pieces + 1] = { a, i }
      a = i + 1
    end
  end
  local function split(p)
    if fits(p[1], p[2]) then return { p } end
    local out, start = {}, p[1]
    local phrases = {}
    for i = p[1], p[2] do
      if words[i].phrase or i == p[2] then phrases[#phrases + 1] = { start, i }; start = i + 1 end
    end
    for _, ph in ipairs(phrases) do
      if fits(ph[1], ph[2]) then
        local prev = out[#out]
        if prev and fits(prev[1], ph[2]) then prev[2] = ph[2] else out[#out + 1] = { ph[1], ph[2] } end
      else
        local from = ph[1]
        for i = ph[1], ph[2] do
          if i > from and not fits(from, i) then
            out[#out + 1] = { from, i - 1 }
            from = i
          end
        end
        out[#out + 1] = { from, ph[2] }
      end
    end
    for _, o in ipairs(out) do o.part = true end
    return out
  end
  local pages, page = {}, nil
  for _, p in ipairs(pieces) do
    for _, part in ipairs(split(p)) do
      if page and not part.part and not page.part and page.n < MAX_SENTENCES and fits(page[1], part[2]) then
        page[2], page.n = part[2], page.n + 1
      else
        page = { part[1], part[2], n = 1, part = part.part }
        pages[#pages + 1] = page
      end
    end
  end
  return pages
end

-- Timing ----------------------------------------------------------------------------------------------------------

local function ratesStore()
  if type(LoreForeverDB) ~= "table" then return {} end
  if type(LoreForeverDB.subtitleRates) ~= "table" then LoreForeverDB.subtitleRates = {} end
  return LoreForeverDB.subtitleRates
end

-- A voice's characters a second from its complete stories' text and length (its Transport.lua), cached.
local measured = {}
local function fromTransport(pack)
  if measured[pack] ~= nil then return measured[pack] or nil end
  local data = ns.Packs and ns.Packs.data and ns.Packs.data[pack]
  local rows = data and type(data.transport) == "table" and data.transport
  local n, seconds, count = 0, 0, 0
  for _, row in pairs(rows or {}) do
    local parts = type(row) == "table" and type(row.text) == "string" and row["1"]
    if type(parts) == "table" then
      local d = 0
      for _, part in ipairs(parts) do d = d + (tonumber(type(part) == "table" and part.duration) or 0) end
      if d > 5 then n, seconds, count = n + chars(row.text), seconds + d, count + 1 end
    end
  end
  measured[pack] = count >= 3 and seconds > 0 and n / seconds or false
  return measured[pack] or nil
end

-- How fast a voice reads: what it was heard doing, else its own complete stories, else those of the voice it belongs
-- to (LoreForever_Voice_Female_Quests: LoreForever_Voice_Female; never across languages), else DEFAULT_CPS.
function Sub.Speed(pack)
  if type(pack) ~= "string" then return DEFAULT_CPS end
  local learned = tonumber(ratesStore()[pack])
  if learned and learned > 4 and learned < 40 then return learned end
  local name = pack
  while name do
    local cps = fromTransport(name)
    if cps then return cps end
    local parent, suffix = name:match("^(LoreForever_Voice_.+)_([^_]+)$")
    if not parent or suffix:match("^%l%l%u%u$") then break end
    name = parent
  end
  return DEFAULT_CPS
end

function Sub.Learn(pack, cps)
  if type(pack) ~= "string" or not (cps and cps > 4 and cps < 40) then return end
  local store = ratesStore()
  local old = tonumber(store[pack]) or Sub.Speed(pack)
  store[pack] = math.floor((old + (cps - old) * LEARN) * 100 + 0.5) / 100
end

-- The frame -------------------------------------------------------------------------------------------------------

local function gradient(tex, orient, from, to) return T.Gradient(tex, orient, from, to) end

local function subtitleFont()
  local name = "LoreForeverFontSubtitle"
  local base = _G.GameFontHighlight
  if not (CreateFont and base and base.GetFont) then return "GameFontHighlightLarge" end
  local f = _G[name] or CreateFont(name)
  if f.CopyFontObject then f:CopyFontObject(base) elseif f.SetFontObject then f:SetFontObject(base) end
  local file, _, flags = base:GetFont()
  if not file then return "GameFontHighlightLarge" end
  f:SetFont(file, FONT_SIZE, flags or "")
  f:SetTextColor(1, 1, 1, 1)
  f:SetShadowColor(0, 0, 0, 1)
  f:SetShadowOffset(1, -1)
  return name
end

local BAND = { 0.05, 0.04, 0.03, 0.9 }   -- Theme's dark ground: the words stay readable over any zone
local CLEAR = { 0, 0, 0, 0 }
local RULE = { 1, 0.82, 0, 0.55 }
local RULE_OFF = { 1, 0.82, 0, 0 }

function Sub.Create()
  if Sub.frame then return Sub.frame end
  local f = CreateFrame("Frame", "LoreForeverSubtitles", UIParent)
  f:SetFrameStrata("LOW")   -- under every window: the map or a quest window opened over it covers it
  f:SetClampedToScreen(true)
  f:SetMovable(true)
  f:EnableMouse(false)
  f:SetSize(MAX_W, 80)
  f:SetAlpha(0)
  f:Hide()

  -- The band: dark in the middle, fading out over FADE at each end, a thin gold rule along its top doing the same.
  local mid = f:CreateTexture(nil, "BACKGROUND")
  mid:SetPoint("TOPLEFT", FADE, 0)
  mid:SetPoint("BOTTOMRIGHT", -FADE, 0)
  T.Fill(mid, BAND)
  local left = gradient(f:CreateTexture(nil, "BACKGROUND"), "HORIZONTAL", CLEAR, BAND)
  left:SetPoint("TOPLEFT")
  left:SetPoint("BOTTOMRIGHT", mid, "BOTTOMLEFT")
  local right = gradient(f:CreateTexture(nil, "BACKGROUND"), "HORIZONTAL", BAND, CLEAR)
  right:SetPoint("TOPRIGHT")
  right:SetPoint("BOTTOMLEFT", mid, "BOTTOMRIGHT")
  local ruleL = gradient(f:CreateTexture(nil, "BORDER"), "HORIZONTAL", RULE_OFF, RULE)
  ruleL:SetPoint("TOPLEFT", FADE / 2, 0)
  ruleL:SetPoint("BOTTOMRIGHT", f, "TOP", 0, -1)
  local ruleR = gradient(f:CreateTexture(nil, "BORDER"), "HORIZONTAL", RULE, RULE_OFF)
  ruleR:SetPoint("TOPRIGHT", -FADE / 2, 0)
  ruleR:SetPoint("BOTTOMLEFT", f, "TOP", 0, -1)
  f.band = { mid, left, right, ruleL, ruleR }

  -- The story's name in gold, and after a dot who speaks (a quest giver), in grey.
  local title = f:CreateFontString(nil, "OVERLAY", T.font.heading)
  title:SetPoint("TOP", 0, -TOP_PAD)
  if title.SetWordWrap then title:SetWordWrap(false) end
  title:SetJustifyH("CENTER")
  f.title = title

  local words = f:CreateFontString(nil, "OVERLAY", subtitleFont())
  words:SetPoint("TOP", title, "BOTTOM", 0, -ROW_GAP)
  words:SetJustifyH("CENTER")
  words:SetJustifyV("MIDDLE")   -- a shorter page sits in the middle of the band, which keeps the tallest page's height
  if words.SetWordWrap then words:SetWordWrap(true) end
  if words.SetSpacing then words:SetSpacing(2) end
  f.words = words
  -- The same font, unseen, to measure pages with.
  local measure = f:CreateFontString(nil, "OVERLAY", subtitleFont())
  measure:SetPoint("TOPLEFT")
  measure:SetJustifyH("CENTER")
  if measure.SetWordWrap then measure:SetWordWrap(true) end
  if measure.SetSpacing then measure:SetSpacing(2) end
  measure:SetAlpha(0)
  f.measure = measure

  local track = f:CreateTexture(nil, "ARTWORK")
  T.Fill(track, { 1, 0.82, 0, 0.18 })
  track:SetHeight(BAR_H)
  track:SetPoint("BOTTOM", 0, BOTTOM_PAD)
  local fill = f:CreateTexture(nil, "OVERLAY")
  T.Fill(fill, { 1, 0.82, 0, 0.85 })
  fill:SetHeight(BAR_H)
  fill:SetPoint("LEFT", track, "LEFT")
  fill:SetWidth(1)
  f.track, f.fill = track, fill

  -- Shift-drag moves it. The mouse is taken only while Shift is held over it, so it never stops a click from
  -- turning the camera. After Options' Move the subtitles... (or /lore subtitles) a plain drag moves it too, for a
  -- while (Sub.Moving), and a few seconds more after each drop.
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", function(self)
    local plain = Sub.Moving()
    if not (plain or IsShiftKeyDown()) then return end
    self.dragging, self.plainDrag = true, plain
    self:StartMoving()
  end)
  f:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
    self.dragging = nil
    if self.plainDrag then Sub.moveUntil = math.max(Sub.moveUntil or 0, now() + 5) end
    self.plainDrag = nil
    Sub.Drop()
  end)
  Sub.frame = f

  -- Every frame while the band shows or fades, a few times a second while something plays out of sight (the panel or
  -- one of our windows open), nothing otherwise: UI.UpdateNowPlaying wakes it whenever what plays changes (Sub.Wake).
  local driver = CreateFrame("Frame")
  local waited = 0
  driver.tick = function(_, elapsed)
    waited = waited + (elapsed or 0)
    if not f:IsShown() and waited < 0.1 then return end   -- (hidden: a few looks a second are enough)
    Sub.Tick(waited)
    waited = 0
  end
  Sub.driver = driver
  return f
end

-- Placing it ------------------------------------------------------------------------------------------------------

local BARS = { "MainMenuBar", "MultiBarBottomLeft", "MultiBarBottomRight", "PetActionBarFrame", "StanceBarFrame",
  "PossessBarFrame", "MainMenuBarVehicleLeaveButton", "CastingBarFrame", "PlayerCastingBarFrame", "MainActionBar",
  "MultiBar1", "MultiBar2", "MultiBar3", "OverrideActionBar" }

local CAST = { CastingBarFrame = true, PlayerCastingBarFrame = true }

-- The highest top edge of what the game draws along the bottom middle of the screen (action bars, the cast bar: where
-- it shows when you cast, even while it's hidden), in UIParent's units.
local function barsTop()
  local top = 0
  local sw = (UIParent.GetWidth and UIParent:GetWidth()) or 1024
  for _, name in ipairs(BARS) do
    local b = _G[name]
    if type(b) == "table" and b.IsShown and (b:IsShown() or CAST[name]) and b.GetTop then
      local t, l, r = b:GetTop(), b:GetLeft(), b:GetRight()
      local s = (b.GetEffectiveScale and b:GetEffectiveScale() or 1) / (UIParent:GetEffectiveScale() or 1)
      if t and l and r and l * s < sw * 0.7 and r * s > sw * 0.3 then top = math.max(top, t * s) end
    end
  end
  return top
end

local function screen()
  return (UIParent.GetWidth and UIParent:GetWidth()) or 1024, (UIParent.GetHeight and UIParent:GetHeight()) or 768
end

-- Where its bottom middle goes: (across from the screen's middle, up from its bottom), in UIParent's units.
function Sub.Spot()
  local pos = S().subtitlePos
  if type(pos) == "table" and tonumber(pos.x) and tonumber(pos.y) then return tonumber(pos.x), tonumber(pos.y), true end
  return 0, math.max(DEFAULT_Y, barsTop() + BAR_CLEAR), false
end

-- A frame's left, right, bottom and top in UIParent's units, or nil when it has no place.
local function rect(fr)
  if not (fr and fr.IsShown and fr:IsShown() and fr.GetLeft) then return nil end
  local l, r, b, t = fr:GetLeft(), fr:GetRight(), fr:GetBottom(), fr:GetTop()
  if not (l and r and b and t) then return nil end
  local s = (fr.GetEffectiveScale and fr:GetEffectiveScale() or 1) / (UIParent:GetEffectiveScale() or 1)
  local il, ir, it, ib = 0, 0, 0, 0
  if fr.GetHitRectInsets then il, ir, it, ib = fr:GetHitRectInsets() end
  return (l + (il or 0)) * s, (r - (ir or 0)) * s, (b + (ib or 0)) * s, (t - (it or 0)) * s
end

-- Its size: the player's Subtitle size, and as wide as MAX_W or 60% of the screen.
local function size()
  local f = Sub.frame
  local scale = Sub.Scale()
  f:SetScale(scale)
  local sw = screen()
  f:SetWidth(math.floor(math.min(MAX_W, sw * 0.6 / scale)))
end

-- What it keeps clear of while open: the quest giver's window, gossip, a book, the floating player and our small boxes
-- near the top of the screen (Sub.Tick places it again when one opens or closes).
local AVOID = { "QuestFrame", "GossipFrame", "ItemTextFrame", "LoreForeverMiniPlayer", "LoreForeverKeyPrompt",
  "LoreForeverLiveAnswers", "LoreForeverGetWillo" }
local function avoiding()
  local out = ""
  for i, name in ipairs(AVOID) do
    local fr = _G[name]
    if type(fr) == "table" and fr.IsShown and fr:IsShown() then out = out .. i end
  end
  return out
end

function Sub.Place()
  local f = Sub.frame
  if not f then return end
  size()
  local scale = f:GetScale() or 1
  local sw, sh = screen()
  local x, y = Sub.Spot()
  local w = (f:GetWidth() or MAX_W) * scale
  local h = (f:GetHeight() or 80) * scale
  local left, bottom = sw / 2 + x - w / 2, math.max(0, math.min(y, sh - h))
  -- Never over those: beside one (to its right, else its left), else above it.
  for _, name in ipairs(AVOID) do
    local l, r, b, t = rect(_G[name])
    if l and left < r and left + w > l and bottom < t and bottom + h > b then
      if r + 8 + w <= sw then left = r + 8
      elseif l - 8 - w >= 0 then left = l - 8 - w
      elseif t + 8 + h <= sh then bottom = t + 8 end
    end
  end
  left = math.max(0, math.min(left, sw - w))
  f:ClearAllPoints()
  f:SetPoint("BOTTOMLEFT", UIParent, "BOTTOMLEFT", left / scale, bottom / scale)
  f.placedFor = avoiding()
end

-- Dragged: keep its bottom middle, from the screen's middle and bottom.
function Sub.Drop()
  local f = Sub.frame
  local l, r, b = f:GetLeft(), f:GetRight(), f:GetBottom()
  if not (l and r and b) then return end
  local scale = f:GetScale() or 1
  local sw = screen()
  S().subtitlePos = { x = math.floor(((l + r) / 2) * scale - sw / 2 + 0.5), y = math.floor(b * scale + 0.5) }
  Sub.Place()
end

-- Options' Reset windows and /lore reset.
function Sub.Reset()
  S().subtitlePos = nil
  Sub.Place()
end

-- Showing a story ------------------------------------------------------------------------------------------------

local function esc(s) return (s:gsub("|", "||")) end

-- Words a..b as the band shows them.
local function join(words, a, b)
  local out = {}
  for i = a, b do out[#out + 1] = words[i].text end
  return table.concat(out, " ")
end

-- Lay out `story` (Sub.Begin's): pages measured at the band's width, its height fixed for the whole story to its
-- tallest page, so the band doesn't jump as pages turn.
local function layout(story)
  local f = Sub.frame
  size()
  local inner = (f:GetWidth() or MAX_W) - PAD * 2
  local words, m = story.words, f.measure
  m:SetWidth(inner)
  f.words:SetWidth(inner)
  m:SetText("Ag")
  local lineH = tonumber(m:GetStringHeight()) or FONT_SIZE
  if lineH <= 0 then lineH = FONT_SIZE end
  local function lines(a, b)
    m:SetText(esc(join(words, a, b)))
    local n = m.GetNumLines and tonumber(m:GetNumLines())
    if not n or n < 1 then n = math.floor((tonumber(m:GetStringHeight()) or lineH) / lineH + 0.5) end
    return n
  end
  story.pages = Sub.Paginate(words, function(a, b) return lines(a, b) <= MAX_LINES end)
  local most = 1
  for _, p in ipairs(story.pages) do most = math.max(most, lines(p[1], p[2])) end
  m:SetText(string.rep("Ag\n", most - 1) .. "Ag")
  local wordsH = tonumber(m:GetStringHeight()) or most * lineH
  f.title:SetWidth(inner)
  f.title:SetText(T.code.gold .. esc(story.title or "") .. "|r" .. (story.speaker
    and (T.code.grey .. "  " .. (ns.Lang and ns.Lang.dot or "·") .. "  " .. esc(story.speaker) .. "|r") or ""))
  local titleH = (story.title or "") ~= "" and (tonumber(f.title:GetStringHeight()) or 15) or 0
  f.title:SetShown(titleH > 0)
  f.words:ClearAllPoints()
  if titleH > 0 then f.words:SetPoint("TOP", f.title, "BOTTOM", 0, -ROW_GAP)
  else f.words:SetPoint("TOP", 0, -TOP_PAD) end
  f.words:SetHeight(wordsH)
  f:SetHeight(math.floor(TOP_PAD + titleH + (titleH > 0 and ROW_GAP or 0) + wordsH + BAR_GAP + BAR_H + BOTTOM_PAD + 0.5))
  f.track:SetWidth(math.floor((f:GetWidth() or MAX_W) * BAR_SHARE))
  story.page, story.word = nil, nil
end

-- A recording started: its words, its timing and its pages.
function Sub.Begin(target, clip)
  local title, text = Sub.TextFor(target, clip)
  if not text then return nil end
  local words, weight = Sub.Words(text)
  if #words == 0 then return nil end
  local V = ns.Voice
  local story = { key = target.key, target = target, clip = clip, title = title, text = text, words = words,
    weight = weight, started = (clip and clip.started) or now(), handle = V.handle, pack = clip and clip.pack }
  if V.transport and V.transport.row and V.transport.row.key == target.key then
    story.transport, story.duration = true, V.transport.row.duration
  elseif clip and tonumber(clip.duration) and clip.duration > 0 then
    story.duration = clip.duration
  else
    story.estimated = true
    story.duration = math.max(1.5, chars(text) / Sub.Speed(story.pack))
  end
  -- A quest giver's page: who says it, while you're talking to them.
  if (target.key or ""):find("^quest:%d+#") and (target.id or ""):find("^questtext:")
      and _G.QuestFrame and QuestFrame:IsShown() and UnitName then
    local ok, name = pcall(UnitName, "npc")
    if ok and type(name) == "string" and name ~= "" then story.speaker = name end
  end
  Sub.story = story
  layout(story)
  return story
end

-- How far into the story the voice is, in seconds.
local function position(story)
  local V = ns.Voice
  if story.transport and V.transport then
    local offset = V.Position()
    if offset then return offset end
  end
  return math.max(0, now() - story.started)
end

-- Draw the page holding word `i`: the words before it said, it lit, the rest to come.
local function draw(story, i)
  local f = Sub.frame
  local pages, pageNo = story.pages, #story.pages
  for n, p in ipairs(pages) do
    if i <= p[2] then pageNo = n break end
  end
  if story.page == pageNo and story.word == i then return end
  local p = pages[pageNo]
  local words = story.words
  local cur = math.max(p[1], math.min(p[2], i))
  local said = cur > p[1] and (esc(join(words, p[1], cur - 1)) .. " ") or ""
  local ahead = cur < p[2] and (" " .. esc(join(words, cur + 1, p[2]))) or ""
  f.words:SetText(SAID .. said .. "|r" .. NOW .. esc(words[cur].text) .. "|r" .. AHEAD .. ahead .. "|r")
  if story.page ~= pageNo then
    story.page = pageNo
    f.wordsIn = 0
    f.words:SetAlpha(0)
  end
  story.word = i
end

-- Our own windows that open in the middle of the screen while the panel is closed: the band steps out of their way
-- while one is open (the narration report box and the link it copies, a lore report, export and sharing, the
-- journey's map, picture and record box) and comes back, where the voice is, when it closes. The small boxes near the
-- top of the screen (the key prompt, Willo's) are in AVOID instead: the band only moves if it was dragged up to them.
local DIALOGS = { "LoreForeverClipReport", "LoreForeverReport", "LoreForeverExport", "LoreForeverShare",
  "LoreForeverJourneyRecordBox", "LoreForeverJourneyMapWindow", "LoreForeverPictureViewer" }
local function dialogOpen()
  for _, name in ipairs(DIALOGS) do
    local d = _G[name]
    if type(d) == "table" and d.IsShown and d:IsShown() then return true end
  end
  return false
end
Sub.DIALOGS = DIALOGS

-- What plays, when the band should show it: subtitles on, a recording playing, the panel closed (it shows the words
-- itself) and none of our windows open over it. Not the recording that already ended (Sub.ended) while the player
-- catches up.
local function wanted()
  local UI, V = ns.UI, ns.Voice
  if not (Sub.On() and UI and UI.speaking and UI.activeTarget) then return nil end
  if (UI.frame and UI.frame:IsShown()) or dialogOpen() then return nil end
  local clip = V.lastClip
  if clip and clip.id ~= UI.activeTarget.key then clip = nil end
  local done = Sub.ended
  if done and done.target == UI.activeTarget and (not clip or done.clip == clip) then return nil end
  return UI.activeTarget, clip
end

-- The recording ended on its own (the game says its sound stopped while it's still the one we started): learn the
-- voice's speed from it, and fade out now rather than when the player notices (up to a second later).
local function checkEnd(story)
  local V = ns.Voice
  if story.measuredEnd or story.transport or not story.handle or V.handle ~= story.handle then return end
  if not (_G.C_Sound and C_Sound.IsPlaying) then return end
  local ok, playing = pcall(C_Sound.IsPlaying, story.handle)
  if not ok or playing == nil then return end
  local t = now() - story.started
  if playing then story.seen = true return end
  if not (story.seen or t > 1) then return end
  story.measuredEnd = true
  Sub.ended = story
  if story.estimated and t > 3 and t > story.duration * 0.5 and t < story.duration * 2 then
    Sub.Learn(story.pack, chars(story.text) / t)
  end
end

function Sub.Tick(elapsed)
  local f = Sub.frame
  if not f then return end
  local target, clip = wanted()
  local story = Sub.story
  if Sub.sample and not target then
    -- (A sample stays while it's being moved, and while Move the subtitles... is on.)
    if now() < Sub.sample.untilT or f.dragging or Sub.Moving() then target, story = Sub.sample.target, Sub.sample
    else Sub.sample = nil end
  elseif target and (not story or story.target ~= target or story.clip ~= clip) then
    Sub.sample = nil
    story = Sub.Begin(target, clip)
    if story then Sub.Place() end
  end
  local show = target and story and story.target == target
  if show and story ~= Sub.sample then
    checkEnd(story)
    show = Sub.ended ~= story
  end
  if show then
    if not f:IsShown() then
      f:SetAlpha(0)
      f:Show()
    end
    if avoiding() ~= f.placedFor and not f.dragging then Sub.Place() end
    local share = story.share or math.max(0, math.min(1, position(story) / story.duration))
    local at, words = share * story.weight, story.words
    local i = story.word or 1
    if at < words[i].t0 then i = 1 end
    while i < #words and words[i].t1 <= at do i = i + 1 end
    draw(story, i)
    f.fill:SetWidth(math.max(1, (tonumber(f.track:GetWidth()) or 1) * share))
    f:SetAlpha(math.min(1, (f:GetAlpha() or 0) + elapsed / SHOW_IN))
    if f.wordsIn then
      f.wordsIn = f.wordsIn + elapsed
      f.words:SetAlpha(math.min(1, f.wordsIn / PAGE_IN))
      if f.wordsIn >= PAGE_IN then f.wordsIn = nil end
    end
  elseif f:IsShown() then
    local a = (f:GetAlpha() or 0) - elapsed / SHOW_OUT
    if a <= 0 or not Sub.On() then
      f:SetAlpha(0)
      f:Hide()
      if not target and Sub.story and Sub.story ~= Sub.sample then Sub.story = nil end
    else
      f:SetAlpha(a)
    end
  end
  -- The mouse only while Shift is held over it (to drag it), or while it's being moved (Sub.Moving); never otherwise.
  local grab = f:IsShown() and (f.dragging or Sub.Moving()
    or (IsShiftKeyDown and IsShiftKeyDown() and f:IsMouseOver())) or false
  if grab ~= (f.grabbing or false) then
    f.grabbing = grab
    f:EnableMouse(grab)
  end
  -- Over every window (Options' covers the middle of the screen) while a sample shows or it's being moved.
  local high = (Sub.sample or Sub.Moving()) and true or false
  if high ~= (f.high or false) then
    f.high = high
    f:SetFrameStrata(high and "FULLSCREEN_DIALOG" or "LOW")
  end
  -- Nothing playing (or subtitles off) and nothing left to fade: asleep until UI.UpdateNowPlaying wakes it. While
  -- something plays behind the panel or one of our windows, it looks a few times a second for the way to clear.
  local UI = ns.UI
  if not (f:IsShown() or Sub.sample or target or (Sub.On() and UI and UI.speaking)) then
    Sub.driver:SetScript("OnUpdate", nil)
  end
end

-- A sample over everything for a few seconds, after the size changes in Options (nothing may be playing, and the
-- settings window covers the middle of the screen): how big the words are, where they go.
function Sub.Sample(seconds, text)
  Sub.Create()
  local target = { key = "", id = "subtitle-sample", label = L["Subtitles"],
    text = text or L["The words of a narration show here as the voice reads them. Shift-drag them to move them."] }
  local words, weight = Sub.Words(target.text)
  local story = { target = target, title = target.label, text = target.text, words = words, weight = weight,
    share = 0.45, untilT = now() + (seconds or 6) }
  Sub.sample, Sub.story = story, story
  layout(story)
  Sub.Place()
  Sub.Wake()
  return story
end

-- Options' Move the subtitles... and /lore subtitles: for 30 seconds a plain drag moves the band (a few seconds more
-- after each drop). It's the one playing if one shows; otherwise a sample says where to drag. Dropping keeps the place.
local MOVE_FOR = 30
function Sub.Moving() return (Sub.moveUntil or 0) > now() end
function Sub.Move()
  Sub.moveUntil = now() + MOVE_FOR
  if not wanted() then
    Sub.Sample(MOVE_FOR, L["Drag these words where you want them. Let go and they stay there."])
  end
  Sub.Wake()
end

-- Options' Put them back and /lore subtitles reset: the usual place, with a sample there when nothing shows.
function Sub.PutBack()
  Sub.Reset()
  if not (wanted() or Sub.sample) then Sub.Sample() end
end

function Sub.Wake()
  local d = Sub.driver
  if d and not d:GetScript("OnUpdate") then d:SetScript("OnUpdate", d.tick) end
end

-- Options: the switch, from the tick box or the floating player's menu.
function Sub.Set(on)
  S().subtitles = on and true or false
  if Sub.frame and not on then
    Sub.frame:SetAlpha(0)
    Sub.frame:Hide()
  end
  Sub.Wake()
  return S().subtitles
end

function Sub.SetScale(v)
  S().subtitleScale = v
  if Sub.frame and Sub.story then layout(Sub.story) end
  Sub.Place()
end

Sub.Create()
