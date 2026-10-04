-- "Copy my journey record": this character's journey as plain, readable text, in a highlighted box the player copies
-- with Ctrl+C (a highlighted edit box copies out up to 256 KB on these clients). The record is built from what
-- Journey.lua keeps (Journey.Char()): the character sheet, new places in order, quests done, people met, bosses and
-- notable kills, loot and quest rewards, level-ups, spells, mounts, profession milestones, reputation, deaths, books
-- read and screenshots. Not the map trail. Kept under LIMIT; when it's longer, the oldest entries go.
-- Journey.CreateView puts the button above "Update my journey" (JourneyRecord.Attach).

local _, ns = ...
local JR = {}
ns.JourneyRecord = JR
local L = ns.L

local LIMIT = 30000              -- bytes of text: comfortable to paste anywhere
local MOST_FOUGHT = 10
local NOTABLE = { elite = true, rare = true, rareelite = true, worldboss = true }

local function say(msg) DEFAULT_CHAT_FRAME:AddMessage(ns.Theme.CHAT_PREFIX .. msg) end
local function when(t) return type(t) == "number" and date("%b %d %H:%M", t) or "" end
local function day(t) return type(t) == "number" and date("%b %d, %Y", t) or nil end

-- The non-empty ones of ..., joined with sep (a nil anywhere is skipped, not the end of the list).
local function join(sep, ...)
  local out = {}
  for i = 1, select("#", ...) do
    local p = select(i, ...)
    if p and p ~= "" then out[#out + 1] = p end
  end
  return table.concat(out, sep)
end

local function place(e)
  return join(", ", e.s ~= e.z and e.s or nil, e.z)
end

local function party(e)
  if type(e.pt) ~= "table" or #e.pt == 0 then return nil end
  return string.format(L["with %s"], table.concat(e.pt, ", "))
end

-- Strings are looked up when the record is built: language packs load after this file.
local function howText(how)
  if how == "flight" then return L["by flight"]
  elseif how == "hearth" then return L["by hearthstone"]
  elseif how == "boat" then return L["by boat"]
  elseif how == "corpse" then return L["as a spirit"]
  elseif how == "portal" then return L["by portal"] end
end

local function rank(cls)
  if cls == "worldboss" then return L["world boss"]
  elseif cls == "rareelite" then return L["rare elite"]
  elseif cls == "rare" then return L["rare"] end
  return L["elite"]
end

-- The item quality in the game's own words ("Rare", "Epic"), if it has them.
local function quality(ql)
  local word = type(ql) == "number" and _G["ITEM_QUALITY" .. ql .. "_DESC"]
  return type(word) == "string" and word ~= "" and word or nil
end

local function standing(st)
  local J = ns.Journey
  return J and J.StandingText and J.StandingText(st) or tostring(st or "?")
end

-- The sections, in the order they're shown, and how an event becomes a line in one (nil: not in the record).
local SECTIONS = { "places", "quests", "people", "bosses", "kills", "loot", "levels", "spells", "mounts", "profs",
  "rep", "deaths", "books", "shots" }
local function titles(whole)
  -- A record that starts mid-life lists the places it recorded, not new ones (Journey.Whole).
  return { places = whole and L["New places, in order"] or L["Places recorded, in order"], quests = L["Quests done"],
    people = L["People met"],
    bosses = L["Bosses defeated"], kills = L["Notable kills"], loot = L["Loot and quest rewards"],
    levels = L["Level-ups"], spells = L["Spells learned"], mounts = L["Mounts"], profs = L["Profession milestones"],
    rep = L["Reputation"], deaths = L["Deaths"], books = L["Books read"], shots = L["Screenshots"] }
end

-- quests: quest ID -> title, from the record's turn-ins (a reward names its quest).
local function entry(e, quests)
  local k = e.k
  if k == "zone" and (e.new or e.inst) then
    local dungeon = e.inst and (e.how == "instance" or not e.new)
    return "places", join(" · ", place(e), dungeon and L["dungeon"] or nil, howText(e.how))
  elseif k == "qt" then
    return "quests", join(" · ", e.q or string.format(L["Quest %d"], e.id or 0), place(e), party(e))
  elseif k == "npc" and e.n then
    return "people", join(" · ", e.n, place(e))
  elseif k == "boss" and e.n then
    return "bosses", join(" · ", e.n, place(e), party(e))
  elseif k == "kill" and e.n and NOTABLE[e.cls or ""] then
    return "kills", join(" · ", e.n, rank(e.cls), place(e), party(e))
  elseif k == "lvl" then
    return "levels", join(" · ", string.format(L["Reached level %d"], e.lv or 0), place(e))
  elseif k == "death" then
    return "deaths", join(" · ", place(e) ~= "" and place(e) or L["Died"],
      e.by and string.format(L["slain by %s"], e.by) or nil, party(e))
  elseif k == "book" and e.n then
    return "books", join(" · ", "\"" .. e.n .. "\"", place(e))
  elseif k == "loot" and e.n then
    local reward = e.qid and (quests[e.qid] and string.format(L["reward for %s"], quests[e.qid]) or L["Quest reward"])
    return "loot", join(" · ", e.n, quality(e.ql), reward, place(e))
  elseif k == "spell" and e.n then
    return "spells", join(" · ", e.n, place(e))
  elseif k == "mount" then
    return "mounts", join(" · ", e.n or L["A new mount"], place(e))
  elseif k == "prof" and e.n then
    return "profs", join(" · ", e.n .. " " .. (e.r or 0), place(e))
  elseif k == "rep" and e.n then
    return "rep", join(" · ", string.format(L["%s with %s"], standing(e.st), e.n), place(e))
  elseif k == "shot" then
    return "shots", place(e) ~= "" and place(e) or L["Screenshot"]
  end
end

local function count(t) local n = 0 for _ in pairs(t or {}) do n = n + 1 end return n end

-- The record as text, at most `limit` bytes (default LIMIT), and whether older entries were left out.
function JR.Text(char, limit)
  limit = limit or LIMIT
  local head = {
    string.format(L["Journey record: %s"], join(" - ", char.name, char.realm)),
    join(", ", join(" ", char.level and string.format(L["Level %d"], char.level) or nil,   -- the character sheet
      char.raceName or char.race, char.className or char.class), char.faction),
  }
  local since = day(char.first)
  local J = ns.Journey
  -- A record that started mid-life (the character played before the update) says from which level.
  local whole = J and J.Whole and J.Whole(char)
  local from = tonumber(char.startLevel)
  if since and not whole and from and from > 1 then
    head[#head + 1] = string.format(L["Recorded since %s, from level %d."], since, from)
  elseif since then
    head[#head + 1] = string.format(L["Recorded since %s."], since)
  end
  local s = char.seen or {}
  local function n(c, one, many) return string.format(c == 1 and one or many, c) end
  head[#head + 1] = join(" · ",
    n(#(char.completed or {}), L["%d quest done"], L["%d quests done"]),
    n(count(s.place), L["%d place"], L["%d places"]), n(count(s.npc), L["%d person met"], L["%d people met"]),
    n(count(s.mob), L["%d foe"], L["%d foes"]), n(count(s.boss), L["%d boss"], L["%d bosses"]))
  if J and J.On and not J.On() then
    head[#head + 1] = L["Remember my journey is off, so nothing new is being added."]
  end

  local entries, bossSeen, quests = {}, {}, {}
  for _, e in ipairs(char.events or {}) do
    if e.k == "qt" and e.id and e.q then quests[e.id] = e.q end
  end
  for i, e in ipairs(char.events or {}) do
    local sec, text = entry(e, quests)
    if sec and text ~= "" then
      entries[#entries + 1] = { i = i, t = e.t, sec = sec, line = "- " .. when(e.t) .. "  " .. text }
      if sec == "bosses" then bossSeen[e.n] = true end
    end
  end
  -- Bosses from before the oldest kept event are still in seen.boss.
  for name, t in pairs(s.boss or {}) do
    if not bossSeen[name] then
      entries[#entries + 1] = { i = 0, t = t, sec = "bosses", line = "- " .. when(t) .. "  " .. name }
    end
  end
  local foes = {}
  for name, n in pairs(char.kills or {}) do foes[#foes + 1] = { name = name, n = n } end
  table.sort(foes, function(a, b) if a.n ~= b.n then return a.n > b.n end return a.name < b.name end)
  local fought = {}
  for i = 1, math.min(MOST_FOUGHT, #foes) do fought[i] = string.format("%s: %d", foes[i].name, foes[i].n) end

  local TITLES = titles(whole)
  local function render(keep, cut)
    local out = { table.concat(head, "\n") }
    if #keep == 0 and #fought == 0 then out[#out + 1] = "\n" .. L["Nothing recorded yet."] end
    for _, sec in ipairs(SECTIONS) do
      local lines = {}
      for _, en in ipairs(keep) do if en.sec == sec then lines[#lines + 1] = en.line end end
      if #lines > 0 then out[#out + 1] = "\n" .. TITLES[sec] .. "\n" .. table.concat(lines, "\n") end
    end
    if #fought > 0 then out[#out + 1] = "\n" .. L["Most fought"] .. "\n" .. table.concat(fought, ", ") end
    if cut then out[#out + 1] = "\n" .. L["Older entries were left out to keep this record short."] end
    return table.concat(out, "\n") .. "\n"
  end

  table.sort(entries, function(a, b)
    if (a.t or 0) ~= (b.t or 0) then return (a.t or 0) < (b.t or 0) end
    return a.i < b.i
  end)
  local text = render(entries, false)
  if #text <= limit then return text, false end
  -- Too long: keep the newest entries that fit (the headings and the note cost about 400 bytes).
  local budget, used, keep = limit - #render({}, true) - 40 * #SECTIONS, 0, {}
  for i = #entries, 1, -1 do
    local cost = #entries[i].line + 1
    if used + cost > budget then break end
    used = used + cost
    keep[#keep + 1] = entries[i]
  end
  local kept = {}
  for i = #keep, 1, -1 do kept[#kept + 1] = keep[i] end
  return render(kept, true), true
end

-- The copy box -------------------------------------------------------------------------------------------------------

local function createBox()
  local f = ns.Theme.Window("LoreForeverJourneyRecordBox", UIParent)
  f:SetSize(540, 420)
  f:SetPoint("CENTER")
  f:SetFrameStrata("DIALOG")
  f:SetClampedToScreen(true)
  f:SetMovable(true)
  f:EnableMouse(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", f.StartMoving)
  f:SetScript("OnDragStop", f.StopMovingOrSizing)
  table.insert(UISpecialFrames, "LoreForeverJourneyRecordBox")
  if type(f.TitleText) == "table" and f.TitleText.SetText then f.TitleText:SetText(L["Your journey record"]) end
  local hint = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  hint:SetPoint("TOPLEFT", 16, -32)
  hint:SetPoint("RIGHT", f, "RIGHT", -16, 0)
  hint:SetJustifyH("LEFT")
  hint:SetText(L["Press Ctrl+C to copy it, then paste it anywhere with Ctrl+V."])
  local sf = CreateFrame("ScrollFrame", nil, f, "UIPanelScrollFrameTemplate")
  sf:SetPoint("TOPLEFT", 14, -56)
  sf:SetPoint("BOTTOMRIGHT", -34, 42)
  local eb = CreateFrame("EditBox", nil, sf)
  eb:SetMultiLine(true)
  eb:SetFontObject(ChatFontNormal)
  eb:SetWidth(480)
  eb:SetAutoFocus(false)
  if eb.SetMaxLetters then eb:SetMaxLetters(0) end
  if eb.SetMaxBytes then pcall(eb.SetMaxBytes, eb, 0) end
  sf:SetScrollChild(eb)
  -- Read-only and always all selected. The Forever client drops text set on a box that isn't shown yet, so it's
  -- filled again once shown (as the report link box does).
  local function fill()
    eb:SetText(f.text or "")
    eb:SetCursorPosition(0)
    eb:HighlightText()
  end
  eb:SetScript("OnTextChanged", function(_, userInput) if userInput then fill() end end)
  eb:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
  eb:SetScript("OnEscapePressed", function() f:Hide() end)
  -- Ctrl+C copies the selection; then the box closes by itself and the chat says where it makes a profile page
  -- (loreforeverwow.com/account, LOR-181).
  eb:SetScript("OnKeyDown", function(_, key)
    if key == "C" and IsControlKeyDown() then
      C_Timer.After(0.2, function()
        if f:IsShown() then
          f:Hide()
          say(L["Journey record copied. Paste it at loreforeverwow.com/account to get your profile page."])
        end
      end)
    end
  end)
  local done = ns.Theme.Button(f)
  done:SetSize(90, 22)
  done:SetPoint("BOTTOMRIGHT", -14, 12)
  done:SetText(L["Done"])
  done:SetScript("OnClick", function() f:Hide() end)
  f.eb, f.fill, f.done = eb, fill, done
  return f
end

-- Shows this character's record, all selected; nil (with a chat line) when there's none.
function JR.Copy()
  local J = ns.Journey
  local char = J and J.Char and J.Char()
  if not char then
    say(L["There's no journey record for this character yet."])
    return nil
  end
  local f = LoreForeverJourneyRecordBox or createBox()
  f.text = (JR.Text(char):gsub("|", "/"))   -- | starts a WoW escape code; the copy shows / instead
  f.fill()
  f:Show()
  f.fill()
  f.eb:SetFocus()
  return f
end

-- Called by Journey.CreateView: the button, as wide as Update my journey and just above it.
function JR.Attach(view, sync, width)
  local b = ns.Theme.SkinButton(CreateFrame("Button", "LoreForeverJourneyRecord", view, "UIPanelButtonTemplate"))
  b:SetSize(width, 24)
  b:SetPoint("BOTTOMLEFT", sync, "TOPLEFT", 0, 4)
  b:SetText(L["Copy my journey record"])
  local tw = ns.Theme and ns.Theme.TextWidth and ns.Theme.TextWidth(b:GetFontString())
  if tw then b:SetWidth(math.max(width, tw + 24)) end   -- "Copier le journal de mon périple" runs past 170
  b:SetScript("OnClick", function() JR.Copy() end)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(L["Copy my journey record"])
    ns.Theme.Tip(L["You can copy and paste your journey record."], "tipText", true)
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  JR.button = b
  return b
end
