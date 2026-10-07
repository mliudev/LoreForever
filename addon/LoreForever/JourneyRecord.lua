-- "Copy my journey record": this character's journey as plain, readable text, in a highlighted box the player copies
-- with Ctrl+C (a highlighted edit box copies out up to 256 KB on these clients). The record is built from what
-- Journey.lua keeps (Journey.Char()): the character sheet, new places in order, quests done, people met, bosses and
-- notable kills, loot and quest rewards, level-ups, spells, mounts, profession milestones, reputation, deaths, books
-- read and screenshots, and first the journey in numbers ("Journey stats": yards walked by land, foes slain by kind and
-- rank, deaths, hours played; Journey.lua's tally, LOR-246). Not the map trail. Kept under LIMIT; when it's longer,
-- the oldest entries go.
-- Journey.CreateView puts the button beside "Update my journey" (JourneyRecord.Attach) and, above them, the line to
-- the record's page on loreforeverwow.com (JourneyRecord.WebLine): pasted at /account, the record becomes a page about
-- the character (LOR-181, LOR-222).

local _, ns = ...
local JR = {}
ns.JourneyRecord = JR
local L = ns.L

local LIMIT = 30000              -- bytes of text: comfortable to paste anywhere
local MOST_FOUGHT = 10
local MOST_WALKED, MOST_KINDS = 30, 12   -- lands and creature types in the Journey stats lists
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
    local cause = e.how == "drown" and L["drowned"] or e.how == "fatigue" and L["lost in deep water"] or nil
    return "deaths", join(" · ", place(e) ~= "" and place(e) or L["Died"],
      e.by and string.format(L["slain by %s"], e.by) or cause, party(e))
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

-- Distance walked is shown as steps (Mike, 2026-10-04): a step of 2.5 feet, 1.2 to the yard. The website counts them
-- the same way (site/lib/profile-stats.js STEPS).
local STEPS = 1.2
function JR.Steps(yards) return math.floor((tonumber(yards) or 0) * STEPS + 0.5) end

-- { name = n } as a list { { name, n }, ... }, the biggest first, without the empty ones.
local function ranked(t)
  local out = {}
  for name, n in pairs(type(t) == "table" and t or {}) do
    n = math.floor((tonumber(n) or 0) + 0.5)
    if type(name) == "string" and name ~= "" and n > 0 then out[#out + 1] = { name = name, n = n } end
  end
  table.sort(out, function(a, b) if a.n ~= b.n then return a.n > b.n end return a.name < b.name end)
  return out
end

-- The journey in numbers (Journey.lua's tally, LOR-246), from the character's record alone: the desktop app's profile
-- sync makes the record too, without the game (LOR-148). { yards, lands = { { name, n = yards }, ... },
-- slain, kinds = { { name, n }, ... }, elites, rares, deaths, online, played } (seconds; played only after a /played).
function JR.Numbers(char)
  local t = type(char.tally) == "table" and char.tally or {}
  local out = { yards = 0, lands = ranked(t.walk), slain = 0, kinds = ranked(t.kinds), elites = 0, rares = 0 }
  for _, l in ipairs(out.lands) do out.yards = out.yards + l.n end
  for _, n in pairs(type(char.kills) == "table" and char.kills or {}) do out.slain = out.slain + (tonumber(n) or 0) end
  local r = type(t.ranks) == "table" and t.ranks or {}
  local function rk(k) return tonumber(r[k]) or 0 end
  out.elites = rk("elite") + rk("rareelite") + rk("worldboss")
  out.rares = rk("rare") + rk("rareelite")
  out.deaths = tonumber(t.deaths)
  if not out.deaths then   -- a record from before the tally: the deaths it kept
    out.deaths = 0
    for _, e in ipairs(type(char.events) == "table" and char.events or {}) do
      if type(e) == "table" and e.k == "death" then out.deaths = out.deaths + 1 end
    end
  end
  local J = ns.Journey
  local live = J and J.Char and J.Online and J.Char() == char   -- in the game: this session so far counts too
  out.online = live and J.Online() or tonumber(t.online) or 0
  if tonumber(t.played) then out.played = t.played + math.max(0, out.online - (tonumber(t.playedAt) or out.online)) end
  -- LOR-262: how you traveled, your patrons, homes and flights, time per zone, fish, days played, your story's length.
  local function num(k) return math.floor((tonumber(t[k]) or 0) + 0.5) end
  out.ride, out.swim, out.flown, out.boats, out.fish = num("ride"), num("swim"), num("flown"), num("boats"), num("fish")
  out.days, out.best, out.words, out.heard = num("days"), num("best"), num("words"), num("heard")
  out.patrons, out.inns, out.flights, out.time = ranked(t.patrons), ranked(t.inns), ranked(t.flights), ranked(t.time)
  out.flown_n = 0
  for _, f in ipairs(out.flights) do out.flown_n = out.flown_n + f.n end
  -- What slew you, from the deaths kept: only creatures you've slain too (Journey.lua records only creatures, and this
  -- keeps any other name out of the list the website trusts).
  local killers, kills = {}, type(char.kills) == "table" and char.kills or {}
  for _, e in ipairs(type(char.events) == "table" and char.events or {}) do
    if type(e) == "table" and e.k == "death" and type(e.by) == "string" and kills[e.by] then
      killers[e.by] = (killers[e.by] or 0) + 1
    end
  end
  out.killers = ranked(killers)
  return out
end

-- The record's "Journey stats": its lines, then its "Name: n" lists, each { title, line }. The first six lines are
-- always there, in this order, so the website can read them by place when a language pack words them in a way it
-- doesn't know yet (site/lib/journey.js); the others (hours played after a /played, and LOR-262's) only when they
-- have something, read by their words.
local function numbers(char)
  local s = JR.Numbers(char)
  local lines = {}
  local function add(fmt, v) lines[#lines + 1] = "- " .. string.format(fmt, v) end
  local function some(fmt, v) if v and v > 0 then add(fmt, v) end end
  local function hours(sec) return string.format("%.1f", sec / 3600) end
  if s.yards > 0 or s.slain > 0 or s.deaths > 0 or s.online >= 360 or s.played then
    add(L["Yards walked: %d"], s.yards)
    add(L["Foes slain: %d"], s.slain)
    add(L["Elites slain: %d"], s.elites)
    add(L["Rares slain: %d"], s.rares)
    add(L["Deaths: %d"], s.deaths)
    add(L["Hours recorded: %s"], hours(s.online))
    if s.played then add(L["Hours played: %s"], hours(s.played)) end
    some(L["Yards ridden: %d"], s.ride)
    some(L["Yards swum: %d"], s.swim)
    some(L["Yards flown: %d"], s.flown)
    some(L["Flights taken: %d"], s.flown_n)
    some(L["Places flown to: %d"], #s.flights)
    some(L["Boat trips: %d"], s.boats)
    some(L["Fish caught: %d"], s.fish)
    some(L["Days played: %d"], s.days)
    some(L["Longest play streak: %d"], s.best)
    some(L["Words of lore: %d"], s.words)
    some(L["Narrations heard: %d"], s.heard)
  end
  local function list(items, most, scale)
    local out = {}
    for i = 1, math.min(most, #items) do
      out[i] = string.format("%s: %d", items[i].name, math.floor(items[i].n / (scale or 1) + 0.5))
    end
    return table.concat(out, ", ")
  end
  local lists = {}
  for _, l in ipairs({
    { L["Yards walked, by land"], list(s.lands, MOST_WALKED) },
    { L["Foes slain, by kind"], list(s.kinds, MOST_KINDS) },
    { L["Slain by"], list(s.killers, 10) },
    { L["Most loyal patrons"], list(s.patrons, 10) },
    { L["Inns you've called home"], list(s.inns, 10) },
    { L["Flights, by destination"], list(s.flights, 10) },
    { L["Minutes spent, by land"], list(s.time, MOST_WALKED, 60) },
  }) do
    if l[2] ~= "" then lists[#lists + 1] = l end
  end
  return lines, lists
end

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
  local stats, lists = numbers(char)
  local function render(keep, cut)
    local out = { table.concat(head, "\n") }
    if #keep == 0 and #fought == 0 and #stats == 0 then out[#out + 1] = "\n" .. L["Nothing recorded yet."] end
    -- The journey in numbers first (LOR-246). A site from before them skips these lines.
    if #stats > 0 then out[#out + 1] = "\n" .. L["Journey stats"] .. "\n" .. table.concat(stats, "\n") end
    for _, l in ipairs(lists) do out[#out + 1] = "\n" .. l[1] .. "\n" .. l[2] end
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
  hint:SetText(L["Press Ctrl+C to copy it, then paste it at loreforeverwow.com/account to see your page."])
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
  -- Ctrl+C copies the selection; then the box closes by itself and the chat says where it makes a page, with what's
  -- on it (loreforeverwow.com/account, LOR-181).
  eb:SetScript("OnKeyDown", function(_, key)
    if key == "C" and IsControlKeyDown() then
      C_Timer.After(0.2, function()
        if f:IsShown() then
          f:Hide()
          JR.Copied()
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

-- The record was copied: say where it becomes a page, and what the page will show ("166 quests done, 5 bosses and
-- the road you took"). Remembered, so the web line then talks about updating the page.
function JR.Copied()
  if LoreForeverDB and LoreForeverDB.settings then LoreForeverDB.settings.recordCopied = true end
  local s = ns.Journey and ns.Journey.Stats and ns.Journey.Stats() or {}
  local function n(count, one, many) return string.format(count == 1 and one or many, count) end
  local quests, bosses = tonumber(s.quests) or 0, tonumber(s.bosses) or 0
  if quests > 0 and bosses > 0 then
    say(string.format(L["Journey record copied. Paste it at loreforeverwow.com/account to see your page: %s, %s and the road you took."],
      n(quests, L["%d quest done"], L["%d quests done"]), n(bosses, L["%d boss"], L["%d bosses"])))
  elseif quests > 0 then
    say(string.format(L["Journey record copied. Paste it at loreforeverwow.com/account to see your page: %s and the road you took."],
      n(quests, L["%d quest done"], L["%d quests done"])))
  else
    say(L["Journey record copied. Paste it at loreforeverwow.com/account to see your page: your stats, the road you took and your story."])
  end
  if ns.Journey and ns.Journey.webLine then ns.Journey.webLine:Update(true) end
end

-- Called by Journey.CreateView: the line above the footer's buttons that leads to the record's page on the website.
-- Clicking it opens the copy box, as Copy my journey record does. Update(shown) sets its text: once a record has been
-- copied, it's about pasting a newer one.
function JR.WebLine(view)
  local T = ns.Theme
  local b = CreateFrame("Button", "LoreForeverJourneyWeb", view)
  b:SetHeight(18)
  local icon = b:CreateTexture(nil, "ARTWORK")
  icon:SetSize(14, 14)
  icon:SetPoint("LEFT", 4, 0)
  local tex = "Interface\\Icons\\INV_Misc_Note_01"
  if T.HasTexture(tex) then icon:SetTexture(tex) else icon:Hide() end
  local text = b:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  text:SetPoint("LEFT", icon, "RIGHT", 6, 0)
  text:SetPoint("RIGHT", -2, 0)
  text:SetJustifyH("LEFT")
  if text.SetWordWrap then text:SetWordWrap(false) end
  b.text = text
  b:SetHighlightTexture("Interface\\Buttons\\UI-Common-MouseHilight", "ADD")
  b:SetScript("OnClick", function() JR.Copy() end)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_TOP")
    GameTooltip:AddLine(L["Your page on loreforeverwow.com"])
    T.Tip(L["Copy your journey record, then paste it at loreforeverwow.com/account: your stats, the road you took, the bosses you beat and your story, on a page you can share. It stays private until you make it public."], "tipText", true)
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  function b:Update(shown)
    local again = LoreForeverDB and LoreForeverDB.settings and LoreForeverDB.settings.recordCopied
      and type(_G.LoreForeverJourneyData) ~= "table"
    text:SetText(again and (T.code.gold .. L["Played some more?"] .. "|r " .. L["Paste a newer record at loreforeverwow.com/account to update your page."])
      or (T.code.gold .. L["Your page on loreforeverwow.com:"] .. "|r " .. L["your stats, the road you took and your story"]))
    self:SetShown(shown ~= false)
  end
  b:Update()
  return b
end

-- Called by Journey.CreateView: the button, as wide as Update my journey and just above it. It's the page's main
-- action, so it wears the primary look.
function JR.Attach(view, sync, width)
  local b = ns.Theme.SkinButton(CreateFrame("Button", "LoreForeverJourneyRecord", view, "UIPanelButtonTemplate"), "primary")
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
