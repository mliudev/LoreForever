-- /lore qa: Lore Forever tests itself inside the game client, for release QA (LOR-189). /lore help doesn't list it.
--
-- Clicking through the panel from outside is slow and unreliable (synthetic clicks miss small buttons, and the game
-- window loses focus), so this does it from the inside, through the add-on's own functions and the buttons' own click
-- handlers: it opens the panel, both tabs, the queue, History, the journey page and Options, closes each with its own
-- Back or close button, follows a lore link and goes Back and Forward; plays one short narration through the add-on's
-- own play path, queues a second while it plays and takes it out again, then stops; and checks the lore data, the
-- voice and language packs (their versions against the core's), the UI strings, the minimap button and the saved
-- settings. Each step runs in xpcall, so a Lua error fails that check with its stack and the rest still run. At the
-- end everything goes back the way it was: the panel and its pages, the conversation, the playlist, the settings, what
-- this character has heard, the logged questions, and what of this version's What's new is still to see.
--
-- The summary goes to chat ("Lore Forever QA 0.7.0: 23/24 passed, 1 skipped. FAIL: ..."); the full results go to
-- LoreForeverDB.qa = { version, time, date, locale, client, build, zone, seconds, summary, passed, failed, skipped,
-- failures = { "name: detail", ... }, packs = { core, voices, list = { {name, kind, version, loaded}, ... } },
-- results = { { name, status = "pass" | "fail" | "skip", detail, stack }, ... } }, which the game writes to
-- WTF\Account\<account>\SavedVariables\LoreForever.lua on /reload or logout. tests/selftest_sim.py runs it offline;
-- there, sizes and positions are only checked under the layout layer (without one they're skipped, not failed).

local addonName, ns = ...
local SelfTest = {}
ns.SelfTest = SelfTest

local WAIT = 0.25         -- seconds between steps, so the client shows and lays out what the step before opened
local JOURNEY_V = 2       -- LoreForeverDB.journey.v (Journey.lua)
-- Our own packs, by name: they ship with every release, stamped with the core's version (scripts/release.sh).
local OWN = { "LoreForever_Voice_Default", "LoreForever_Voice_Female", "LoreForever_Lang_" }

local run                 -- the run in progress: { results, ctx, state, errors, started, geometry, packs }

local function S() return LoreForeverDB.settings end
local function count(t) local n = 0 for _ in pairs(t or {}) do n = n + 1 end return n end
local function cut(s, n)
  s = tostring(s or "")
  return #s > n and (s:sub(1, n - 3) .. "...") or s
end

local function meta(name, field)
  local get = (_G.C_AddOns and C_AddOns.GetAddOnMetadata) or _G.GetAddOnMetadata
  if not get then return nil end
  local ok, v = pcall(get, name, field)
  return (ok and type(v) == "string" and v ~= "") and v or nil
end

local function isOwn(name)
  for _, p in ipairs(OWN) do
    if name:sub(1, #p) == p then return true end
  end
  return false
end

-- Copies and comparisons of saved data (settings, the window, what was heard), a few levels deep.
local function copy(v, depth)
  if type(v) ~= "table" or (depth or 0) > 8 then return v end
  local out = {}
  for k, x in pairs(v) do out[k] = copy(x, (depth or 0) + 1) end
  return out
end

local function same(a, b, depth)
  if type(a) ~= type(b) then return false end
  if type(a) ~= "table" or (depth or 0) > 8 then return a == b end
  for k, x in pairs(a) do
    if not same(x, b[k], (depth or 0) + 1) then return false end
  end
  for k in pairs(b) do
    if a[k] == nil then return false end
  end
  return true
end

local function list(t)
  local out = {}
  for i, v in ipairs(t or {}) do out[i] = v end
  return out
end

-- Results ----------------------------------------------------------------------------------------------------------

local function record(name, status, detail, stack)
  run.results[#run.results + 1] = { name = name, status = status, detail = detail and cut(detail, 400) or nil,
    stack = stack and cut(stack, 1500) or nil }
end
local function pass(name, detail) record(name, "pass", detail) end
local function fail(name, detail) record(name, "fail", detail) end
local function skip(name, detail) record(name, "skip", detail) end
-- Pass or fail by `ok`; the detail says what was found either way.
local function expect(name, ok, detail)
  record(name, ok and "pass" or "fail", detail)
  return ok
end

local function traceback(err)
  local stack = (_G.debugstack and debugstack(2, 12, 0)) or (debug and debug.traceback and debug.traceback("", 2))
  return { msg = tostring(err), stack = stack }
end

-- Run fn(ctx) in xpcall. A Lua error fails "<name>: Lua error" with its message and stack. Returns ok, fn's result.
local function protect(name, fn)
  local ok, res = xpcall(function() return fn(run.ctx) end, traceback)
  if ok then return true, res end
  local e = type(res) == "table" and res or { msg = tostring(res) }
  record(name .. ": Lua error", "fail", e.msg, e.stack)
  return false
end

-- Errors outside our own calls (a timer the add-on set, a script a step fired) reach the game's error handler: while
-- the run lasts, a handler in front of it notes the ones from Lore Forever and passes everything on. An add-on that
-- keeps the handler to itself (BugGrabber can) has them in its own list instead (/bugsack).
local function hookErrors()
  if not (_G.geterrorhandler and _G.seterrorhandler) then return end
  local prev = geterrorhandler()
  local mine = run
  local function handler(msg, ...)
    if run == mine and tostring(msg):find("LoreForever", 1, true) then mine.errors[#mine.errors + 1] = tostring(msg) end
    if prev then return prev(msg, ...) end
  end
  pcall(seterrorhandler, handler)
  if geterrorhandler() == handler then mine.prevHandler, mine.handler = prev, handler end
end

local function unhookErrors()
  if run.handler and geterrorhandler() == run.handler then pcall(seterrorhandler, run.prevHandler) end
end

-- Widgets on screen ------------------------------------------------------------------------------------------------

-- A region's rectangle on screen ({left, bottom, right, top} in the UI's pixels), or nil when it has none: not laid
-- out, or no layout at all (the offline sim; then UIParent has none either and positions aren't checked).
local function rect(r)
  if not (r and r.GetRect) then return nil end
  local ok, l, b, w, h = pcall(r.GetRect, r)
  if not (ok and type(l) == "number" and type(b) == "number" and type(w) == "number" and type(h) == "number") then
    return nil
  end
  local s = r.GetEffectiveScale and tonumber(r:GetEffectiveScale()) or 1
  return { l * s, b * s, (l + w) * s, (b + h) * s }
end

local function fmt(r) return string.format("%d,%d %dx%d", r[1], r[2], r[3] - r[1], r[4] - r[2]) end

local function inside(inner, outer)
  return inner[1] >= outer[1] - 2 and inner[2] >= outer[2] - 2 and inner[3] <= outer[3] + 2 and inner[4] <= outer[4] + 2
end

-- Why a widget isn't properly on show, or nil if it is: missing, hidden (it or a parent), no size, or outside `box`.
local function problem(w, box)
  if not w then return "missing" end
  if not (w.IsVisible and w:IsVisible()) then return "not shown" end
  local r = rect(w)
  if not r then return run.geometry and "not laid out" or nil end
  if r[3] - r[1] < 1 or r[4] - r[2] < 1 then return "no size (" .. fmt(r) .. ")" end
  if box and not inside(r, box) then return "outside its window (" .. fmt(r) .. " in " .. fmt(box) .. ")" end
end

local function textOf(w)
  local fs = type(w) == "table" and type(w.text) == "table" and w.text or nil
  local t = (fs and fs.GetText and fs:GetText()) or (w and w.GetText and w:GetText())
  return type(t) == "string" and t or ""
end

-- One result for a group of widgets { label, widget, has a label?, anywhere? }: each on show, inside `box` (unless
-- anywhere: a row of a list that may be scrolled); `extra` adds problems.
local function widgets(name, items, box, extra)
  local bad = {}
  for _, it in ipairs(items) do
    local why = problem(it[2], not it[4] and box or nil)
    if not why and it[3] and not textOf(it[2]):find("%S") then why = "no label" end
    if why then bad[#bad + 1] = it[1] .. ": " .. why end
  end
  for _, why in ipairs(extra or {}) do bad[#bad + 1] = why end
  return expect(name, #bad == 0, #bad == 0 and (#items .. " parts on show") or table.concat(bad, "; "))
end

-- Press a button the way a click does: its own OnClick handler.
local function press(b)
  local fn = b and b.GetScript and b:GetScript("OnClick")
  if not fn then return false end
  fn(b, "LeftButton")
  return true
end

local function charRecord() return ns.Journey.Char() end

local function heard()
  local h = type(LoreForeverDB.heard) == "table" and LoreForeverDB.heard
  return h and h[(ns.Journey.CharKey())] or nil
end

-- Narrations to play: one short one (an answer to a question is shorter than a story), where you are if it can be.
local function clipIds()
  local ids = {}
  for id in pairs(ns.Voice.Clips()) do
    local base = id:match("^(.-)#faq%d+$") or id
    if ns.DB.entries[base] then ids[#ids + 1] = id end
  end
  table.sort(ids)
  return ids
end

local function pickClip()
  local V = ns.Voice
  local zone = GetRealZoneText and GetRealZoneText()
  local zk = zone and zone ~= "" and ns.engine:ZoneKey(zone)
  if zk then
    for i = 1, 9 do
      if V.HasAudio("zone:" .. zk .. "#faq" .. i) then return "zone:" .. zk .. "#faq" .. i, "here" end
    end
    if V.HasAudio("zone:" .. zk) then return "zone:" .. zk, "here" end
  end
  local ids = clipIds()
  for _, id in ipairs(ids) do
    if id:find("#faq", 1, true) then return id, "elsewhere" end
  end
  return ids[1], "elsewhere"
end

local function targetOf(id)
  local key, idx = ns.UI.QueueRef({ key = id })
  return idx and ns.UI.FaqTarget(key, idx) or ns.UI.EntryTarget(key)
end

-- A narration to queue that isn't `other` and isn't in the playlist yet.
local function queueable(other)
  local UI = ns.UI
  for _, id in ipairs(clipIds()) do
    local key, idx = UI.QueueRef({ key = id })
    if id ~= other and not UI.PlaylistIndex(id) and UI.CanQueue(key, idx) then return id, key, idx end
  end
end

-- Why no voice plays, when that's how it should be: narration turned off, or every installed voice recorded in
-- another language than the one you read (a German client with the English voices). nil otherwise.
local function noVoice()
  local V = ns.Voice
  if V.Current() == "none" then return "voices are off (/lore voice none)" end
  if V.chain[1] then return nil end
  local voices = ns.Packs.List("voice")
  for _, rec in ipairs(voices) do
    local _, code = V.Unusable(rec.name)
    if code ~= "LANGUAGE" then return nil end
  end
  return #voices > 0 and string.format("no voice installed for %s (the voices are in another language)",
    tostring(ns.lang and ns.lang.locale)) or nil
end

-- Format specifiers in order ("%d of %d" -> "d d"), so a translation that would break string.format shows.
local function specs(s)
  local out = {}
  for c in (s:gsub("%%%%", "")):gmatch("%%[%-+ #0]*%d*%.?%d*(%a)") do out[#out + 1] = c end
  return table.concat(out, " ")
end

-- The checks -------------------------------------------------------------------------------------------------------
-- Each: a name, steps run WAIT apart (a step returning false ends the check early, a number waits that many seconds
-- before the next), and a cleanup that always runs.

local CHECKS = {}
local function check(name, steps, cleanup) CHECKS[#CHECKS + 1] = { name = name, steps = steps, cleanup = cleanup } end

-- The lore data, its search index, where you are.
check("data", {
  function(c)
    local db = ns.DB
    local n = count(db and db.entries)
    expect("lore data loaded", n > 0 and n == db.count,
      string.format("%d entries (the index says %s), data of %s", n, tostring(db and db.count), tostring(db and db.version)))
    expect("search index built", ns.engine and ns.engine.built and true or false,
      ns.engine and ns.engine.built and "built at login" or "Engine.new didn't finish")
    local zone = GetRealZoneText and GetRealZoneText()
    local zk = zone and zone ~= "" and ns.engine:ZoneKey(zone)
    local e = zk and db.entries["zone:" .. zk]
    if not zone or zone == "" then
      skip("where you are has lore", "the game gave no zone name")
    else
      expect("where you are has lore", e ~= nil,
        e and string.format("%s: zone:%s", zone, zk) or string.format("no lore entry for %s", zone))
    end
    -- A question about it finds an answer; the engine's follow-up state is left as it was.
    local q = (e and e.n) or "Stormwind"
    local eng = ns.engine
    local lastKey, race = eng.lastKey, eng.race
    local ok, res = pcall(eng.Ask, eng, q, ns.Context.Snapshot())
    eng.lastKey, eng.race = lastKey, race
    local top = ok and type(res) == "table" and res[1]
    expect("a question finds an answer", top and true or false,
      ok and string.format("\"%s\": %s", q, top and top.key or "nothing") or tostring(res))
  end,
})

-- SavedVariables: the tables the add-on keeps and their shape.
check("saved", {
  function(c)
    local db, bad = LoreForeverDB, {}
    local s = db.settings
    for k, v in pairs(ns.Options.DEFAULTS) do
      if type(s[k]) ~= type(v) then bad[#bad + 1] = string.format("settings.%s is %s", k, type(s[k])) end
    end
    if type(s.voiceOrder) ~= "table" or type(s.voiceOff) ~= "table" then bad[#bad + 1] = "no voice list" end
    for _, k in ipairs({ "questions", "quests", "maps", "visits", "journey", "texts" }) do
      if type(db[k]) ~= "table" then bad[#bad + 1] = k .. " is " .. type(db[k]) end
    end
    for _, k in ipairs({ "heard", "history", "window" }) do
      if db[k] ~= nil and type(db[k]) ~= "table" then bad[#bad + 1] = k .. " is " .. type(db[k]) end
    end
    if type(db.sessions) ~= "number" then bad[#bad + 1] = "no session count" end
    local j = type(db.journey) == "table" and db.journey or {}
    if j.v ~= JOURNEY_V then bad[#bad + 1] = string.format("journey.v is %s, not %d", tostring(j.v), JOURNEY_V) end
    if type(j.chars) ~= "table" then bad[#bad + 1] = "no journey.chars" end
    local t = type(db.texts) == "table" and db.texts or {}
    if type(t.gossip) ~= "table" or type(t.books) ~= "table" then bad[#bad + 1] = "texts lacks gossip or books" end
    expect("saved variables: tables and schema", #bad == 0, #bad == 0
      and string.format("journey v%d, %d settings, session %d, %d logged questions", JOURNEY_V, count(s),
        db.sessions, #db.questions)
      or table.concat(bad, "; "))
    if not ns.Journey.On() then
      skip("journey: this character's record", "Remember my journey is off")
    else
      local ch = charRecord()
      local n = ch and type(ch.events) == "table" and #ch.events or 0
      local st = ns.Journey.Stats()
      expect("journey: this character's record", n > 0, ch and string.format("%d events, %d quests done, %d places",
        n, st.quests or 0, st.places or 0) or "no record for this character")
    end
  end,
})

-- Shared Forever text (Capture.lua, LOR-228/234): the capture's bookkeeping, and a Contribute code that reads back
-- whole (what loreforeverwow.com/contribute decodes).
check("contribute", {
  function(c)
    local C, cap = ns.Capture, LoreForeverDB.capture
    if not C.On() then
      skip("captured text: bookkeeping", "Options › Keep the quest text you see is off")
    else
      local ok = type(cap) == "table" and cap.v == 1 and type(cap.sent) == "table" and type(cap.missing) == "table"
        and type(cap.by) == "table" and type(cap.install) == "string" and type(LoreForeverDB.texts.say) == "table"
      local lines = 0
      C.EachLine(function() lines = lines + 1 end)
      expect("captured text: bookkeeping", ok, ok and string.format("%d lines kept, %d marked as sent, client %s %s",
        lines, count(cap.sent), tostring(cap.build), tostring(cap.locale)) or "LoreForeverDB.capture is missing or malformed")
    end
    local line = { kind = "quest", id = 99999, part = "detail", text = "Line one\nwith ~ and 100% $N", player = C.PlayerTag(),
      speaker = { kind = "npc", id = 197, name = "Test Npc", sex = 2, ctype = "Humanoid" } }
    local code = C.Code(line)
    local back = C.Decode(code)
    expect("contribute code reads back", back ~= nil and back.text == line.text and back.kind == "quest" and back.id == "99999"
      and back.speaker == "197.2.Humanoid.Test Npc", cut(code, 80))
    local link, whole = C.Link(line)
    expect("contribute link", whole and link:find("^https://loreforeverwow%.com/contribute#c=LFC1~") ~= nil
      and not link:find("%s"), cut(link, 80))
  end,
  -- The quest window's button and its share window, whatever Options › Contribute buttons says (off by default).
  function(c)
    local C = ns.Capture
    c.contributeLine = { kind = "quest", id = 99999, part = "detail", text = "A quest text for the self-test.",
      key = "qa:contribute", label = "Lore Forever QA" }
    local b = C.TestButton("quest", c.contributeLine)
    if not b then return skip("contribute button opens the share window", "this client has no quest window") end
    local shown = b:IsShown()
    press(b)
    local w = C.window
    local text = w and w.linkBox and textOf(w.linkBox) or ""
    expect("contribute button opens the share window", shown and w ~= nil and w:IsShown()
      and text:find("^https://loreforeverwow%.com/contribute#c=LFC1~") ~= nil,
      string.format("button %s, Options › Contribute buttons %s; %s", shown and "on show" or "hidden",
        C.ButtonsOn() and "on" or "off", text ~= "" and cut(text, 60) or "no link"))
  end,
}, function(c)
  local C = ns.Capture
  if c.contributeLine then
    C.TestButton("quest", nil)
    if C.window then C.window:Hide() end
    if LoreForeverDB.capture and LoreForeverDB.capture.copied then LoreForeverDB.capture.copied["qa:contribute"] = nil end
    C.UpdateAll()
    c.contributeLine = nil
  end
end)

-- Voice and language packs: what's installed and loaded, and that our own packs match the core's version.
check("packs", {
  function(c)
    local core = meta(addonName, "Version")
    local rows, bad, voices, langs, support = {}, {}, {}, {}, {}
    for _, rec in ipairs(ns.Packs.registry) do
      local v = meta(rec.name, "Version") or rec.version
      local loaded = ns.Packs.IsLoaded(rec.name)
      rows[#rows + 1] = { name = rec.name, kind = rec.kind, version = v, loaded = loaded,
        reason = rec.loadable == false and rec.reason or nil }
      local label = rec.name:gsub("^LoreForever_", "") .. " " .. (v or "?") .. (loaded and "" or " (not loaded)")
      table.insert((rec.kind == "voice") and voices or (rec.kind == "transport") and support or langs, label)
      if isOwn(rec.name) then
        if core and v and v ~= core then bad[#bad + 1] = string.format("%s is %s", rec.name, v) end
        if rec.loadable == false and rec.reason ~= "DISABLED" then
          bad[#bad + 1] = string.format("%s can't load (%s)", rec.name, tostring(rec.reason))
        end
      end
    end
    run.packs = { core = core, voices = list(ns.Voice.chain), list = rows }
    local found = string.format("voices: %s; languages: %s", #voices > 0 and table.concat(voices, ", ") or "none",
      #langs > 0 and table.concat(langs, ", ") or "none")
    if #support > 0 then found = found .. "; playback support: " .. table.concat(support, ", ") end
    if not core then
      fail("packs match the core's version", "can't read Lore Forever's own version; " .. found)
    else
      expect("packs match the core's version", #bad == 0, (#bad > 0 and (table.concat(bad, "; ") .. ". ") or "")
        .. "core " .. core .. "; " .. found)
    end
    -- The voices that play, and how much of the catalog they cover.
    local V = ns.Voice
    if noVoice() then
      skip("narration voices", noVoice())
    else
      local covered = count(V.servedBy)
      expect("narration voices", V.chain[1] ~= nil and covered > 0, string.format("%s; %d of %d narrations",
        #V.chain > 0 and table.concat(V.chain, ", ") or "no voice pack loaded", covered, V.total or 0))
    end
    -- The language: the one the settings ask for is the one in use, from its pack.
    local lang, want = ns.lang or {}, ns.Lang.Wanted()
    local wanted
    for _, rec in ipairs(ns.Packs.List("lang")) do
      if rec.locale == want then wanted = rec end
    end
    local why
    if ns.Lang.NeedsReload() then
      why = nil   -- changed in Options since login: it takes a /reload
    elseif lang.locale ~= "enUS" and not (ns.Packs.IsLoaded(lang.pack or "") or ns.Packs.IsLoaded(lang.overlay or "")) then
      why = string.format("reading %s, but its pack isn't loaded", tostring(lang.locale))
    elseif wanted and lang.locale ~= want and wanted.reason ~= "DISABLED" then
      why = string.format("the %s pack is installed but didn't load (%s)", want, tostring(wanted.reason))
    end
    expect("language in use", not why, why or string.format("%s (client %s, settings: %s)%s", tostring(lang.locale),
      tostring(lang.client), tostring(S().language), lang.pack and (", from " .. lang.pack) or ""))
  end,
})

-- The panel, and the Here tab.
check("panel", {
  function(c)
    local UI = ns.UI
    if not UI.frame:IsShown() then UI.frame:Show() end
    UI.ShowTab("here")
  end,
  function(c)
    local UI, f = ns.UI, ns.UI.frame
    local why = problem(f, rect(UIParent))
    local w, h = tonumber(f:GetWidth()), tonumber(f:GetHeight())
    if not why and w and h and (w < 400 or h < 400 or w > 1600 or h > 1200) then
      why = string.format("odd size %dx%d", w, h)
    end
    c.box = rect(f)
    expect("panel opens on screen", not why, why or (c.box and ("at " .. fmt(c.box)) or "shown"))
    widgets("panel: header, tabs, conversation, message box, player", {
      { "Here tab", UI.tabs[1], true }, { "Library tab", UI.tabs[2], true }, { "New chat", UI.newButton, true },
      { "History", UI.historyButton, true }, { "Journey", UI.journeyButton, true }, { "where you are", UI.contextLine, true },
      { "conversation", UI.scroll }, { "message box", UI.input }, { "player", UI.dock },
      { "player's Play", UI.dock and UI.dock.play }, { "player's Queue", UI.dock and UI.dock.queue, true },
    }, c.box)
    local extra = {}
    if UI.tab ~= "here" or UI.narrView:IsShown() then extra[1] = "the Library shows instead" end
    widgets("Here tab", { { "list", UI.hereView }, { "heading", UI.hereHeader, true },
      { "Your quests", UI.questHeader, true } }, c.box, extra)
  end,
})

check("Library tab", {
  function(c)
    if not ns.UI.frame:IsShown() then ns.UI.frame:Show() end
    ns.UI.ShowTab("narrations")
  end,
  function(c)
    local UI = ns.UI
    local first
    for _, r in ipairs(UI.narrRows or {}) do
      if r:IsShown() then first = r break end
    end
    local extra = {}
    if UI.tab ~= "narrations" or UI.hereView:IsShown() then extra[#extra + 1] = "the Here list shows instead" end
    if not first and next(ns.Voice.Clips()) then extra[#extra + 1] = "no rows, though narrations are installed" end
    local items = { { "list", UI.narrView }, { "search box", UI.narrSearch } }
    items[#items + 1] = first and { "first row", first, true, true } or { "note", UI.narrEmpty, true }
    widgets("Library tab", items, c.box, extra)
    UI.ShowTab("here")
  end,
})

-- The queue over the sidebar, closed with its own close button.
check("queue", {
  function(c)
    if not ns.UI.frame:IsShown() then ns.UI.frame:Show() end
    ns.UI.ShowQueue(true)
  end,
  function(c)
    local UI, P = ns.UI, ns.UI.plUI or {}
    widgets("queue opens", { { "queue", UI.plView }, { "close button", P.close } }, c.box)
    press(P.close)
    expect("queue: its close button closes it", not UI.plView:IsShown(),
      UI.plView:IsShown() and "still open after its close button" or "closed")
  end,
})

-- History, closed with its Back button.
check("History", {
  function(c)
    local UI = ns.UI
    if not UI.frame:IsShown() then UI.frame:Show() end
    if not UI.historyFrame:IsShown() then UI.ToggleHistory() end
  end,
  function(c)
    local h = ns.UI.historyFrame
    local first = h.rows and h.rows[1]
    widgets("History opens", { { "page", h }, { "Back", h.back, true },
      (first and first:IsShown()) and { "first chat", first, true } or { "note", h.empty, true } }, c.box)
    press(h.back)
    expect("History: Back closes it", not h:IsShown(), h:IsShown() and "still open after Back" or "closed")
  end,
})

-- The journey page, closed with its Back button.
check("Journey page", {
  function(c)
    if not ns.UI.frame:IsShown() then ns.UI.frame:Show() end
    ns.Journey.Show()
  end,
  function(c)
    local J = ns.Journey
    widgets("Journey page opens", { { "page", J.page }, { "Back", J.closeButton, true },
      { "Update my journey", J.syncButton, true }, { "search box", J.search } }, c.box)
    press(J.closeButton)
    expect("Journey page: Back closes it", not J.IsShown(), J.IsShown() and "still open after Back" or "closed")
  end,
})

-- The journey map (LOR-242): + zooms it, the circular arrow shows all of it again, Bigger map opens the large map
-- on screen and its close button closes it, after which Escape closes the panel again. Skipped when the page has no map
-- (no moment with a spot yet, or a narrow panel).
local function panelEscapes()
  for _, name in ipairs(UISpecialFrames or {}) do
    if name == "LoreForeverFrame" then return true end
  end
  return false
end

check("journey map", {
  function(c)
    if not ns.UI.frame:IsShown() then ns.UI.frame:Show() end
    ns.Journey.Show()
  end,
  function(c)
    local m = ns.Journey.map
    if not (m and m:IsShown() and m.target and m.zoomIn) then
      skip("journey map: zoom and Bigger map", "no map on the page (no moment with a spot yet, or the panel is narrow)")
      return false
    end
    press(m.zoomIn)
    c.zoomTo = (m.anim and m.anim.z1) or m.zoom
    ns.JourneyMap.ResetZoom(m)
    expect("journey map: zoom in, and back", c.zoomTo > 1.001 and m.zoom <= 1.001,
      string.format("+ zooms to %.2f; the circular arrow back to %.2f", c.zoomTo, m.zoom))
    press(m.expandButton)
  end,
  function(c)
    local win = ns.Journey.bigWin
    local ok = widgets("journey map: Bigger map opens", { { "large map", win }, { "its map", win and win.map },
      { "its close button", win and win.closeButton } }, rect(UIParent))
    if not ok then return false end
    c.escapes = panelEscapes()
    press(win.closeButton)
  end,
  function(c)   -- a step later: the panel takes Escape again a frame after the large map closes
    local win = ns.Journey.bigWin
    expect("journey map: Esc closes only the large map", not c.escapes and not win:IsShown() and panelEscapes(),
      (c.escapes and "the panel would close with it") or (win:IsShown() and "still open after its close button")
        or (not panelEscapes() and "Escape no longer closes the panel") or "closed; Escape closes the panel again")
  end,
}, function()
  ns.Journey.HideBigMap()
  ns.Journey.Hide()
end)

-- An answer, a lore link in it, then Back and Forward (their buttons' own handlers).
check("lore links", {
  function(c)
    local UI = ns.UI
    if S().chatLinks == false then
      skip("lore links: Back and Forward", "Clickable names in answers is off")
      return false
    end
    if not UI.frame:IsShown() then UI.frame:Show() end
    local zone = GetRealZoneText and GetRealZoneText()
    local zk = zone and zone ~= "" and ns.engine:ZoneKey(zone)
    local start
    for _, key in ipairs({ zk and ("zone:" .. zk) or false, "zone:westfall", "zone:elwynn", "zone:durotar" }) do
      if key and ns.DB.entries[key] then
        UI.ShowEntry(key, "qa")
        local m = UI.msgs[#UI.msgs]
        if m and m.linked and m.linked[1] then start = m break end
      end
    end
    if not start then
      skip("lore links: Back and Forward", "no answer with a lore link to follow")
      return false
    end
    c.from, c.to = start.subject, start.linked[1]
    UI.FollowLink(c.to, start)
  end,
  function(c)
    local UI = ns.UI
    local bar = UI.navBar
    local ok = widgets("lore links: Back and Forward shown", { { "Back", bar and bar.back, true },
      { "Forward", bar and bar.fwd, true } }, c.box)
    if not ok then return false end
    local function subject() local m = UI.msgs[#UI.msgs] return m and m.subject end
    local function enabled(b) return not b.IsEnabled or b:IsEnabled() ~= false end
    local followed, backOn = subject(), enabled(bar.back)
    press(bar.back)
    local back, fwdOn = subject(), enabled(bar.fwd)
    press(bar.fwd)
    local fwd = subject()
    expect("lore links: Back and Forward", followed == c.to and back == c.from and fwd == c.to and backOn and fwdOn,
      string.format("%s, link to %s, Back%s: %s, Forward%s: %s", c.from, tostring(followed),
        backOn and "" or " (disabled)", tostring(back), fwdOn and "" or " (disabled)", tostring(fwd)))
  end,
})

-- Escape closes the panel (it's in UISpecialFrames), and closing it closes its pages.
check("panel closes", {
  function(c)
    local UI, special = ns.UI, false
    for _, name in ipairs(UISpecialFrames or {}) do
      if name == "LoreForeverFrame" then special = true end
    end
    UI.ShowQueue(true)
    UI.frame:Hide()
    local open = (UI.plView:IsShown() and "queue") or (ns.Journey.IsShown() and "journey page")
      or (UI.historyFrame:IsShown() and "History") or nil
    expect("panel closes (and Escape closes it)", special and not UI.frame:IsShown() and not open,
      (not special and "not in UISpecialFrames") or (UI.frame:IsShown() and "still shown")
        or (open and (open .. " still open")) or "closed, with its pages")
  end,
})

-- The Options page in the game's settings window.
check("Options", {
  function(c)
    local p = ns.Options.panel
    if not p then
      fail("Options opens", "the page wasn't made (Options.Create)")
      return false
    end
    local win = _G.SettingsPanel or _G.InterfaceOptionsFrame
    c.optionsOpen = win and win:IsShown() or false
    ns.Options.Open()
  end,
  function(c)
    local p = ns.Options.panel
    local why = problem(p, rect(UIParent))
    expect("Options opens", not why, why or "shown in the settings window")
    if why then return false end
    local wrong, unknown = {}, {}
    for _, cb in ipairs(p.checks or {}) do
      if ns.Options.DEFAULTS[cb.key] == nil then unknown[#unknown + 1] = cb.key end
      if (cb:GetChecked() and true or false) ~= (S()[cb.key] and true or false) then wrong[#wrong + 1] = cb.key end
    end
    expect("Options: tick boxes show the settings", #wrong == 0 and #unknown == 0 and #(p.checks or {}) > 0,
      (#wrong > 0 and ("wrong: " .. table.concat(wrong, ", ")) or "")
        .. (#unknown > 0 and (" unknown: " .. table.concat(unknown, ", ")) or "")
        .. ((#wrong + #unknown == 0) and (#p.checks .. " tick boxes") or ""))
    local v = p.voice
    local row = v and v.rows and v.rows[1]
    widgets("Options: narration voices", { { "first voice", row }, { "its name", row and row.name, true },
      { "Play voices on", v and v.channel, true }, { "Voice volume", v and v.volume } }, nil,
      (v and v.items and #v.items > 0) and {} or { "no voices listed" })
    -- Play voices on (LOR-315): the saved channel is one of the game's, and the drop-down names it. Voice volume
    -- (LOR-295) is that channel's own volume: its slider shows what the game has. Only read here.
    local V = ns.Voice
    local key, saved = V.ChannelChoice(), S().voiceChannel
    local named = v and v.channel and v.channel.GetText and v.channel:GetText()
    expect("Options: Play voices on", saved == key and named == V.ChannelName(key),
      string.format("saved %s, shows %s; recordings play on %s%s", tostring(saved), tostring(named), V.Channel(),
        V.SoundOff() == "channel" and " (the game has " .. key .. " switched off)" or ""))
    local pct, known = V.Volume()
    local shown = v and v.volume and v.volume.GetValue and tonumber(v.volume:GetValue())
    expect("Options: Voice volume is that channel's volume", known and shown ~= nil and math.floor(shown + 0.5) == pct,
      known and string.format("slider at %s%%, the game's %s %d%%", tostring(shown), tostring(named), pct)
        or ("the game doesn't say its " .. key .. " volume"))
  end,
}, function(c)
  local win = _G.SettingsPanel or _G.InterfaceOptionsFrame
  if win and win:IsShown() and not c.optionsOpen then
    if _G.HideUIPanel then HideUIPanel(win) else win:Hide() end
  end
end)

-- The minimap button, the buttons on the game's windows, the floating player, the key bindings.
check("buttons", {
  function(c)
    local s, b = S(), _G.LoreForeverMinimapButton
    if s.minimap == false then
      expect("minimap button: where Options put it", not (b and b:IsShown()), "off in Options, and not shown")
    else
      local why, where = problem(b, rect(UIParent)), "shown"
      if not why and b.GetPoint then
        local _, rel, _, x, y = b:GetPoint(1)
        local shape = (_G.GetMinimapShape and GetMinimapShape()) or "ROUND"
        if type(x) == "number" and type(y) == "number" then
          -- On a round minimap: the saved angle, half the minimap's size out from its centre plus 5 (Core.lua).
          local want = tonumber(s.minimapAngle) or 200
          local a = math.rad(want)
          local wx = math.cos(a) * ((tonumber(Minimap:GetWidth()) or 140) / 2 + 5)
          local wy = math.sin(a) * ((tonumber(Minimap:GetHeight()) or 140) / 2 + 5)
          where = string.format("at %d degrees (saved: %d), %d,%d from the minimap's centre",
            math.deg(math.atan2(y, x)) % 360, want, x, y)
          if rel ~= Minimap then
            why = "not on the minimap"
          elseif shape == "ROUND" and (math.abs(x - wx) > 1 or math.abs(y - wy) > 1) then
            why = string.format("not where the settings put it (%d,%d): %s", wx, wy, where)
          end
        end
      end
      expect("minimap button: where Options put it", not why, why or where)
    end
    -- The buttons on the quest, quest log and book windows (hidden until those open): Lore and play on both quest windows.
    local missing, H = {}, ns.Hooks
    if _G.QuestFrame and not (H.questDialogButton and H.questDialogPlay) then missing[#missing + 1] = "quest window" end
    if (_G.QuestMapFrame or _G.QuestLogFrame) and not (H.questLogButton and H.questLogPlay) then missing[#missing + 1] = "quest log" end
    if _G.ItemTextFrame and not H.bookButton then missing[#missing + 1] = "book" end
    expect("buttons on the quest, quest log and book windows", #missing == 0,
      #missing == 0 and "made" or ("missing on: " .. table.concat(missing, ", ")))
    -- Storylines (Storyline.lua): the data, its line in the quest's text (hooked on the game's QuestInfo_Display), and
    -- the line for the first chapter of a storyline this character's faction sees, in id order.
    local sls, ids, line = ns.DB.storylines or {}, {}, nil
    for id in pairs(sls) do ids[#ids + 1] = id end
    table.sort(ids)
    for _, id in ipairs(ids) do
      line = ns.Storyline.Line(sls[id].c[1], true)
      if line then break end
    end
    expect("storylines", #ids > 0 and line ~= nil and (not _G.QuestInfo_Display or H.storyHooked == true),
      string.format("%d storylines; %s", #ids, line or "no line for a first chapter"))
    -- The floating player: where it was dragged to (or its first place, above the chat window).
    local mini, pos = ns.UI.mini, s.miniPlayerPos
    local p, x, y, _
    if mini and mini.GetPoint then p, _, _, x, y = mini:GetPoint(1) end
    if not mini then
      fail("floating player: where it was left", "missing")
    elseif mini.aside then
      skip("floating player: where it was left", "beside the quest window while it's open")
    elseif type(x) ~= "number" then
      skip("floating player: where it was left", "no positions here")
    else
      local want = type(pos) == "table" and pos[1] and { pos[1], tonumber(pos[3]) or 0, tonumber(pos[4]) or 0 }
        or { "BOTTOMLEFT", 24, 260 }
      expect("floating player: where it was left", p == want[1] and math.abs(x - want[2]) < 1 and math.abs(y - want[3]) < 1,
        string.format("%s %d,%d (saved: %s %d,%d)", tostring(p), x, y, want[1], want[2], want[3]))
    end
    local key = ns.Hooks.CurrentKey()
    local picture = _G.GetBindingKey and GetBindingKey("LOREFOREVER_PICTURE")
    expect("key bindings", type(_G.BINDING_NAME_LOREFOREVER_TOGGLE) == "string" and BINDING_NAME_LOREFOREVER_TOGGLE ~= ""
      and type(_G.BINDING_NAME_LOREFOREVER_PICTURE) == "string",
      "panel key: " .. (key or "not bound") .. ", narration key: " .. (ns.Hooks.CurrentKey("narrate") or "not bound")
        .. ", picture key: " .. (picture or "not bound"))
  end,
})

-- One short narration through the add-on's own play path; a second one queued while it plays and taken out again.
check("narration", {
  function(c)
    local V, UI = ns.Voice, ns.UI
    if noVoice() then
      skip("narration plays", noVoice())
      return false
    end
    local id, where = pickClip()
    if not id then
      fail("narration plays", "no voice pack has a current recording")
      return false
    end
    local voice, path = V.Resolve(id)
    local pack = path and path:match("^Interface\\AddOns\\([^\\]+)\\")
    expect("narration: its file is in a loaded voice pack", pack and ns.Packs.IsLoaded(pack) or false,
      string.format("%s (%s): %s, from %s", id, where, tostring(path), tostring(voice)))
    -- Recordings only (nothing else plays): a file that won't play leaves nothing playing.
    if UI.IsBusy() then UI.StopAll() end
    local target = targetOf(id)
    UI.ListenTo(target)
    c.clip, c.target, c.handle = id, target, V.handle
    local ok = UI.speaking and UI.playingId == target.id and V.handle ~= nil
    expect("narration plays", ok and true or false, ok and string.format("%s (%s), sound %s on %s", target.label, id,
      tostring(V.handle), V.Channel()) or ("PlaySoundFile didn't start " .. tostring(path)
      .. (V.SoundOff() and (" (game sound off: " .. V.SoundOff() .. ")") or "")))
    if not ok then return false end
  end,
  function(c)
    local V, UI = ns.Voice, ns.UI
    local CS = _G.C_Sound
    if CS and CS.IsPlaying then
      local ok, playing = pcall(CS.IsPlaying, c.handle)
      expect("narration: the game says it's playing", ok and playing and true or false,
        ok and ("C_Sound.IsPlaying: " .. tostring(playing)) or tostring(playing))
    else
      skip("narration: the game says it's playing", "no C_Sound.IsPlaying on this client")
    end
    -- The player says what plays: the docked one in the open panel, else the floating one (unless it's turned off).
    local p = UI.frame:IsShown() and UI.dock or UI.mini
    if p == UI.mini and S().floatPlayer == false then
      skip("narration: the player shows it", "the panel is closed and Floating player is off")
    else
      local title = p and p.title and p.title.full
      local shown = p and p:IsVisible()
      expect("narration: the player shows it", shown and title == c.target.label or false,
        string.format("%s player%s: %s", p == UI.mini and "floating" or "docked", shown and "" or " (hidden)",
          tostring(title)))
    end
    -- What plays can be reported (LOR-232): the report box opens for it (from the player's right-click menu, or its
    -- cross when Options shows it), the cross follows that option, and the link carries the clip, its hash, the pack
    -- and a checksum the site accepts.
    local clip = UI.ReportableClip()
    local code = clip and ns.Log.ClipReportCode({ clip = clip.id, hash = clip.hash, voice = clip.pack, reason = "cut" })
    local fields, start = {}, 1
    while code do
      local i = code:find("~", start, true)
      fields[#fields + 1] = code:sub(start, i and i - 1 or nil)
      if not i then break end
      start = i + 1
    end
    local body = code and code:match("^(.*)~%x+$")
    local want = S().reportCross ~= false
    local shown = (UI.dock and UI.dock.report and UI.dock.report:IsShown()) and true or false
    local open = (_G.LoreForeverClipReport and LoreForeverClipReport:IsShown()) and true or false
    local box = clip and UI.ShowClipReport(clip)
    local opened = box and box:IsShown() and box.r and box.r.clip == clip.id and true or false
    if box and not open then box:Hide() end
    local good = clip and clip.id == c.clip and #fields == 9 and body and fields[9] == ns.Log.ClipChecksum(body)
      and fields[4] == clip.id .. "@" .. tostring(clip.hash)
    expect("narration: it can be reported", (good and opened and shown == want) and true or false,
      string.format("%s from %s: %s; report box %s; cross %s (Options: %s)", tostring(clip and clip.id),
        tostring(clip and clip.pack), tostring(code), opened and "opens" or "didn't open", shown and "on" or "off",
        want and "on" or "off"))
    local b = _G.LoreForeverMinimapButton
    if b and S().minimap ~= false and b.glow then
      expect("narration: the minimap button glows", b.glow:IsShown() and true or false,
        b.glow:IsShown() and "green ring on" or "no green ring")
    end
    -- The playlist: one more narration queued while this one plays (it waits for it), then taken out.
    local id, key, idx = queueable(c.clip)
    if not id then
      skip("playlist: add and remove", "no second narration to queue")
    else
      local pl = UI.pl
      local n0 = #pl.items
      local added = UI.PlaylistAdd(key, idx)
      local i = UI.PlaylistIndex(id)
      local queued = added and i ~= nil and #pl.items == n0 + 1 and UI.speaking and UI.playingId == c.target.id
      if i then UI.PlaylistRemove(i) end
      local gone = UI.PlaylistIndex(id) == nil and #pl.items == n0
      expect("playlist: add and remove", queued and gone or false, string.format("%s: %s, then %s (playlist of %d)",
        id, queued and "queued behind what plays" or "not queued", gone and "removed" or "still there", n0))
    end
    UI.StopAll()
  end,
  function(c)
    local V, UI = ns.Voice, ns.UI
    local CS = _G.C_Sound
    local playing
    if CS and CS.IsPlaying then
      local ok, p = pcall(CS.IsPlaying, c.handle)
      playing = ok and p or nil
    end
    local b = _G.LoreForeverMinimapButton
    local glow = b and b.glow and b.glow:IsShown()
    expect("narration stops", not UI.speaking and V.handle == nil and not playing and not glow,
      (UI.speaking and "still playing") or (playing and "the game still plays it") or (glow and "the minimap still glows")
        or "stopped")
  end,
}, function(c)
  if ns.UI.speaking and ns.UI.playingId == (c.target and c.target.id) then ns.UI.StopAll() end
end)

-- Pause and resume (LOR-346): a recording shipped in pieces (cut inside its pauses) hands over to its next piece on
-- time in this client, pausing keeps the place and playing again picks up there. Once for a complete story, once for
-- an answer or overview: its later pieces open with silent frames that carry the bytes their first frame needs
-- (transport_assets.bridge), so this also shows the game plays those. Each uses the recording whose first piece is
-- shortest; a build without one skips it. How the handoff sounds is still for a listener.
local function pauseResume(name, story, what)
  check(name, {
    function(c)
      local V, UI = ns.Voice, ns.UI
      if noVoice() then
        skip(name, noVoice())
        return false
      end
      local best
      for _, data in pairs(ns.Packs.data or {}) do
        for key, r in pairs(type(data) == "table" and type(data.transport) == "table" and data.transport or {}) do
          -- The pack that plays it: with a mix of builds installed, another voice's pack may come first.
          local pack = type(r) == "table" and r.chain == true and (r.fullHash ~= nil) == story and V.HasAudio(key)
            and V.CanPlay(key) and V.PackOf((V.active[key] or V.answerPaths[key] or {})[1])
          local row = pack and V.Transport(key, pack, story)
          local first = row and row.chain and row.rates[1][1]
          if first and (not best or first.duration < best.first.duration) then
            best = { key = key, pack = pack, first = first }
          end
        end
      end
      if not best then
        skip(name, "no " .. what .. " ships in pieces in this build")
        return false
      end
      if UI.IsBusy() then UI.StopAll() end
      c.key, c.target = best.key, targetOf(best.key)
      c.saved, c.resume = UI.progress[best.key], UI.resumeTarget
      UI.progress[best.key] = nil
      UI.ListenTo(c.target)
      local t = V.transport
      local ok = UI.speaking and t and t.row.chain and t.index == 1
      expect(name .. ": " .. what .. " in pieces plays", ok and true or false, string.format("%s from %s: %s",
        best.key, best.pack, ok and string.format("piece 1 of %d (%.1f s)", #t.parts, t.parts[1].duration)
          or "didn't start in pieces"))
      if not ok then return false end
      c.at, c.first = GetTime(), t.parts[1].duration
      return c.first + 0.5
    end,
    function(c)
      local V, UI = ns.Voice, ns.UI
      local t = V.transport
      local step = name .. ": the next piece takes over on time"
      if GetTime() - c.at < c.first then
        skip(step, string.format("only %.1f s passed", GetTime() - c.at))   -- a client whose clock didn't move
      else
        local on = UI.speaking and t and t.index == 2
        local playing
        if on and _G.C_Sound and C_Sound.IsPlaying then
          local ok, p = pcall(C_Sound.IsPlaying, V.handle)
          playing = ok and p
        end
        -- Within a slow frame: an unfocused game window draws a few frames a second.
        expect(step, (on and playing ~= false and t.late and t.late < 0.25) and true or false,
          on and string.format("piece 2 started %d ms after piece 1 was due to end%s",
            math.floor((t.late or 0) * 1000 + 0.5), playing == false and ", but the game says it isn't playing" or "")
          or "piece 2 didn't start")
      end
      local piece = UI.speaking and t and t.parts[t.index]
      if not piece then return false end
      UI.StopAll()
      local state = UI.TransportState()
      local offset = state and state.offset
      expect(name .. ": pausing keeps the place", (not UI.speaking and offset and offset >= piece.start)
        and true or false, string.format("paused at %s s", offset and string.format("%.1f", offset) or "?"))
      UI.ListenTo(c.target)
      local r = V.transport
      expect(name .. ": playing again picks up there",
        (UI.speaking and r and r.parts[r.index].start == piece.start and V.Position() == piece.start) and true or false,
        r and string.format("resumed at %.1f s (piece %d)", V.Position(), r.index) or "didn't resume")
      UI.StopAll()
    end,
  }, function(c)
    local UI = ns.UI
    if UI.speaking and c.target and UI.playingId == c.target.id then UI.StopAll() end
    if c.key then UI.progress[c.key], UI.resumeTarget = c.saved, c.resume end
  end)
end
pauseResume("pause and resume", true, "a complete story")
pauseResume("pause and resume (answers and overviews)", false, "an answer or overview")

-- Quest givers (Giver.lua, LOR-224): the model -> race table, and this client reading a model's file id, checked on
-- your own character (its model's race and gender should be yours).
check("quest givers", {
  function(c)
    local G, n = ns.Giver, count(ns.MODEL_RACES)
    local f = next(ns.MODEL_RACES or {})
    local race, gender = G.RaceOf(f)
    local kind, id = G.ParseGUID("Creature-0-1-0-1-197-0000000001")
    expect("quest givers: model races", n > 0 and race ~= nil and gender ~= nil and kind == "npc" and id == 197,
      string.format("%d player-race models; %s is %s %s", n, tostring(f), tostring(race), tostring(gender)))
    c.giverModel = nil
    G.ModelOf("player", function(fileID) c.giverModel = fileID end)
  end,
  function(c)
    local name = "quest givers: your model's race and gender"
    if not c.giverModel then
      skip(name, "this client gave no model file id for your character (PlayerModel:GetModelFileID)")
      return
    end
    local race, gender = ns.Giver.RaceOf(c.giverModel)
    if not race then   -- shapeshifted, or a model the table doesn't know: say which, for the next table build
      skip(name, string.format("model %d isn't in the player-race table (shapeshifted?)", c.giverModel))
      return
    end
    local _, want = UnitRace("player")
    local sex = UnitSex and UnitSex("player")
    local wantG = sex == 2 and "male" or sex == 3 and "female" or nil
    expect(name, race == want and gender == wantG, string.format("model %d: %s %s (you: %s %s)", c.giverModel,
      tostring(race), tostring(gender), tostring(want), tostring(wantG)))
  end,
})

-- UI strings: the language in use translates without breaking a format; in English, every string has text.
check("strings", {
  function(c)
    local locale = (ns.lang and ns.lang.locale) or "enUS"
    -- Looked up with no translation (some before the language pack loaded at login, like the key binding names).
    local used, empty, english = 0, 0, {}
    for k in pairs(ns.Lang.fallbacks or {}) do
      if rawget(ns.L, k) == nil then
        used = used + 1
        if type(k) ~= "string" or not k:find("%S") then empty = empty + 1 else english[#english + 1] = k end
      end
    end
    local n, bad = 0, {}
    for k, v in pairs(ns.L) do
      n = n + 1
      if type(v) ~= "string" or not v:find("%S") then
        bad[#bad + 1] = string.format("\"%s\" is empty", cut(k, 40))
      elseif specs(v) ~= specs(k) then
        bad[#bad + 1] = string.format("\"%s\" has %s, the English %s", cut(v, 40), specs(v), specs(k))
      end
    end
    expect("UI strings: English", empty == 0 and used + n > 0, string.format("%d UI strings, %d empty", used + n, empty))
    if locale == "enUS" then
      skip("UI strings: translation", "English")
      return
    end
    table.sort(english)
    for i = 6, #english do english[i] = nil end
    expect("UI strings: " .. locale, n > 0 and #bad == 0, (#bad > 0 and (table.concat(bad, "; ") .. ". ") or "")
      .. string.format("%d translated; %d shown in English so far%s", n, used,
        used > 0 and (": " .. table.concat(english, " | ")) or ""))
  end,
})

-- Running it ---------------------------------------------------------------------------------------------------------

-- What the run may touch, to put back afterwards.
local function snapshot()
  local UI, J = ns.UI, ns.Journey
  local ch = charRecord()
  local win = _G.SettingsPanel or _G.InterfaceOptionsFrame
  local suggested = {}   -- the suggested questions under the chat (UI.SetNext)
  for i, b in ipairs(UI.nextButtons or {}) do
    suggested[i] = { key = b.key, idx = b.idx, via = b.via, section = b.section, live = b.live, text = b.text:GetText(),
      shown = b:IsShown() }
  end
  run.state = {
    suggested = suggested, suggestedLabel = { UI.nextLabel:GetText(), UI.nextLabel:IsShown() },
    listenButton = UI.listenButton,
    settings = copy(LoreForeverDB.settings), window = copy(LoreForeverDB.window), heard = copy(heard()),
    usage = copy(LoreForeverDB.usage),
    questions = list(LoreForeverDB.questions), lastLog = UI.lastLog,
    recapped = ch and ch.recapped, lastRead = ch and ch.lastRead,
    shown = UI.frame:IsShown(), tab = UI.tab, queue = UI.plView:IsShown(), history = UI.historyFrame:IsShown(),
    journey = J.IsShown(), msgs = list(UI.msgs), blocks = list(UI.blocks), welcomeFor = UI.welcomeFor,
    nav = { keys = list(UI.nav.keys), pos = UI.nav.pos }, lastKey = UI.engine.lastKey, race = UI.engine.race,
    pl = { items = list(UI.pl.items), pos = UI.pl.pos, state = UI.pl.state },
    options = win and win:IsShown() or false,
  }
end

-- Put it all back. Returns what had changed in the saved data (put back too). Something that played before the run
-- stays stopped: a sound can't be resumed.
local function putBack()
  local st, UI, J = run.state, ns.UI, ns.Journey
  if not st then return {} end
  local changed = {}
  if UI.speaking or UI.pl.state ~= "paused" then UI.StopAll() end
  local pl = UI.pl
  pl.items, pl.pos, pl.token = list(st.pl.items), st.pl.pos, nil
  pl.state = (st.pl.state == "playing" or st.pl.state == "waiting") and "paused" or st.pl.state
  -- The conversation (opening the panel shows the welcome card; the link check posts answers) and Back/Forward.
  local same_msgs = #UI.msgs == #st.msgs
  for i, m in ipairs(st.msgs) do
    if UI.msgs[i] ~= m then same_msgs = false end
  end
  if not same_msgs then
    if UI.FinishTyping then UI.FinishTyping() end
    UI.msgs, UI.blocks, UI.welcomeFor = list(st.msgs), list(st.blocks), st.welcomeFor
    UI.Render(true)
    UI.listenButton = st.listenButton
    for i, b in ipairs(UI.nextButtons or {}) do
      local was = st.suggested[i] or {}
      b.key, b.idx, b.via, b.section, b.live = was.key, was.idx, was.via, was.section, was.live
      b.text:SetText(was.text or "")
      b:SetShown(was.shown and true or false)
    end
    UI.nextLabel:SetText(st.suggestedLabel[1] or "")
    UI.nextLabel:SetShown(st.suggestedLabel[2] and true or false)
  end
  UI.nav = { keys = list(st.nav.keys), pos = st.nav.pos }
  UI.UpdateNav()
  UI.engine.lastKey, UI.engine.race, UI.lastLog = st.lastKey, st.race, st.lastLog
  -- The panel, its tab and pages.
  if st.tab and UI.tab ~= st.tab then UI.ShowTab(st.tab) end
  if st.shown then
    if not UI.frame:IsShown() then UI.frame:Show() end
    UI.ShowQueue(st.queue)
    if st.journey then J.Show() else J.Hide() end
    if st.history and not UI.historyFrame:IsShown() then
      UI.RefreshHistory()
      UI.historyFrame:Show()
    elseif not st.history then
      UI.historyFrame:Hide()
    end
  elseif UI.frame:IsShown() then
    UI.frame:Hide()
  end
  local win = _G.SettingsPanel or _G.InterfaceOptionsFrame
  if win and win:IsShown() and not st.options then
    if _G.HideUIPanel then HideUIPanel(win) else win:Hide() end
  end
  -- Saved data: the journey's welcome-back state, the logged questions, settings, the window, what was heard.
  local ch = charRecord()
  if ch then ch.recapped, ch.lastRead = st.recapped, st.lastRead end
  LoreForeverDB.questions = list(st.questions)
  local s = LoreForeverDB.settings
  -- Opening the panel and its pages marks this version's What's new seen (its card, the "New" marks; WhatsNew.lua).
  -- That's the run's doing, like the narration it played: it goes back without counting as a change, so a player who
  -- hasn't looked yet still gets the card and the marks.
  s.news = copy(st.settings.news)
  UI.UpdateNewMarks()
  for k in pairs(s) do
    if st.settings[k] == nil then changed[#changed + 1] = "settings." .. k end
  end
  for k, v in pairs(st.settings) do
    if not same(v, s[k]) then changed[#changed + 1] = "settings." .. k end
  end
  if #changed > 0 then
    for k in pairs(s) do s[k] = nil end
    for k, v in pairs(st.settings) do s[k] = copy(v) end
    ns.Voice.Refresh()
  end
  if not same(st.window, LoreForeverDB.window) then
    changed[#changed + 1] = "window"
    LoreForeverDB.window = copy(st.window)
  end
  if not same(st.heard, heard()) then
    -- Playing marks a narration heard (so it won't play again by itself): forget the one the run played.
    if type(LoreForeverDB.heard) == "table" then LoreForeverDB.heard[(J.CharKey())] = copy(st.heard) end
  end
  LoreForeverDB.usage = copy(st.usage)   -- the run's plays and opens aren't the player's (LOR-413)
  UI.UpdateListen()
  return changed
end

local function summarize(r)
  local passed, failed, skipped, failures, names = 0, 0, 0, {}, {}
  for _, x in ipairs(r.results) do
    if x.status == "pass" then
      passed = passed + 1
    elseif x.status == "fail" then
      failed = failed + 1
      failures[#failures + 1] = x.name .. (x.detail and (": " .. x.detail) or "")
      names[#names + 1] = x.name
    else
      skipped = skipped + 1
    end
  end
  local version = meta(addonName, "Version") or "?"
  local summary = string.format("Lore Forever QA %s: %d/%d passed", version, passed, passed + failed)
    .. (skipped > 0 and string.format(", %d skipped", skipped) or "")
    .. (failed > 0 and (". FAIL: " .. table.concat(names, "; ")) or "")
  local build, buildNo
  if _G.GetBuildInfo then build, buildNo = GetBuildInfo() end
  local zone = GetRealZoneText and GetRealZoneText()
  LoreForeverDB.qa = { version = version, time = time(), date = date("%Y-%m-%d %H:%M:%S"),
    locale = ns.lang and ns.lang.locale, client = ns.lang and ns.lang.client,
    build = build and (tostring(build) .. (buildNo and ("." .. tostring(buildNo)) or "")) or nil,
    zone = zone, seconds = math.floor(((GetTime and GetTime() or 0) - r.started) * 10 + 0.5) / 10,
    summary = summary, passed = passed, failed = failed, skipped = skipped, failures = failures,
    packs = r.packs, results = r.results }
  return LoreForeverDB.qa
end

local function report(qa)
  local T = ns.Theme.code
  local function line(s) DEFAULT_CHAT_FRAME:AddMessage(s) end
  local esc = function(s) return (tostring(s):gsub("|", "||")) end
  line(T.gold .. "Lore Forever QA " .. esc(qa.version) .. ":|r "
    .. string.format("%d/%d passed", qa.passed, qa.passed + qa.failed)
    .. (qa.skipped > 0 and string.format(", %d skipped", qa.skipped) or "") .. ".")
  for i, f in ipairs(qa.failures) do
    if i > 6 then
      line(T.warn .. string.format("  ... and %d more", #qa.failures - 6) .. "|r")
      break
    end
    line(T.warn .. "  FAIL|r " .. esc(cut(f, 220)))
  end
  line(T.grey .. "  Full results: LoreForeverDB.qa in SavedVariables\\LoreForever.lua (written on /reload).|r")
end

local function finish()
  local r = run
  unhookErrors()
  local ok, changed = protect("put back", putBack)
  local st, UI, wrong = r.state or {}, ns.UI, {}
  for _, k in ipairs(ok and changed or {}) do wrong[#wrong + 1] = k .. " changed (put back)" end
  if UI.frame:IsShown() ~= (st.shown and true or false) then wrong[#wrong + 1] = "the panel" end
  if UI.speaking then wrong[#wrong + 1] = "something still plays" end
  local items = st.pl and st.pl.items or {}
  local plSame = #UI.pl.items == #items
  for i, it in ipairs(items) do
    if UI.pl.items[i] ~= it then plSame = false end
  end
  if not plSame then wrong[#wrong + 1] = "the playlist" end
  if not same(st.heard, heard()) then wrong[#wrong + 1] = "heard narrations" end
  expect("put back as it was", ok and #wrong == 0, #wrong == 0 and "panel, playlist, settings and heard as before"
    or table.concat(wrong, "; "))
  expect("no Lua errors from Lore Forever", #r.errors == 0, #r.errors == 0
    and (r.handler and "none reached the error handler"
      or "none in the checks (another add-on keeps the error handler: /bugsack lists any others)")
    or cut(table.concat(r.errors, " || "), 400))
  local qa = summarize(r)
  SelfTest.last, SelfTest.running, run = qa, nil, nil
  report(qa)
end

local function runCheck(i)
  local c = CHECKS[i]
  if not c then return finish() end
  local step = 0
  local function nextCheck()
    if c.cleanup then protect(c.name .. " cleanup", c.cleanup) end
    C_Timer.After(WAIT, function() runCheck(i + 1) end)
  end
  local function nextStep()
    step = step + 1
    local fn = c.steps[step]
    if not fn then return nextCheck() end
    local ok, res = protect(c.name, fn)
    if not ok or res == false then return nextCheck() end
    C_Timer.After(type(res) == "number" and res or WAIT, nextStep)
  end
  nextStep()
end

-- /lore qa
function SelfTest.Run()
  local say = function(msg) DEFAULT_CHAT_FRAME:AddMessage(ns.Theme.CHAT_PREFIX .. msg) end
  if SelfTest.running then return say("QA is already running.") end
  if InCombatLockdown and InCombatLockdown() then return say("QA runs out of combat.") end
  if not (ns.UI and ns.UI.frame and ns.engine and type(LoreForeverDB) == "table") then
    return say("QA can run once Lore Forever has loaded.")
  end
  run = { results = {}, ctx = {}, errors = {}, started = GetTime and GetTime() or 0 }
  SelfTest.running = run
  run.geometry = rect(UIParent) ~= nil
  say("QA running (a few seconds): the panel and its pages, Options, one narration, the playlist, the data.")
  if not protect("setup", snapshot) then   -- nothing to put things back from: stop here, with the error saved
    local qa = summarize(run)
    SelfTest.last, SelfTest.running, run = qa, nil, nil
    return report(qa)
  end
  hookErrors()
  runCheck(1)
end
