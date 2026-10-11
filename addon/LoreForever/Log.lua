-- Records questions, answers and feedback, plus quest text the wiki doesn't have yet, into SavedVariables.
-- pipeline/lore/harvest.py reads these back into the eval set and the lore pipeline.
-- SavedVariables write on logout/reload. HistoryArchive preserves captured records until a local archive receipt.

local _, ns = ...
local Log = {}
ns.Log = Log

local MAX_QUESTIONS = 500

function Log.Init()
  LoreForeverDB = type(LoreForeverDB) == "table" and LoreForeverDB or {}
  local db = LoreForeverDB
  db.settings = db.settings or {}
  for k, v in pairs(ns.Options and ns.Options.DEFAULTS or {}) do
    if db.settings[k] == nil then db.settings[k] = v end
  end
  -- The minimap button used to be off by default, and defaults are written into SavedVariables, so older installs
  -- have minimap = false saved. Turn it on once; after that, switching it off in Options sticks.
  if not db.settings.minimapOn then
    db.settings.minimap = true
    db.settings.minimapOn = 1
  end
  -- The report cross and the Contribute buttons were off by default until 2026-10-10 (Mike: finished features ship on),
  -- so older installs have them saved off. Turn them on once; after that, switching one off in Options sticks. The
  -- hidden picture switches (key offer, milestone pictures, journey row thumbnails) are gone: always on.
  if not db.settings.featuresOn then
    db.settings.reportCross = true
    db.settings.contributeButtons = true
    db.settings.featuresOn = 1
  end
  db.settings.pictureShortcuts, db.settings.pictureMilestones, db.settings.journeyPictureThumbnails = nil, nil, nil
  -- Read aloud, the game's text-to-speech for what had no recording, is gone (Mike, 2026-10-05: only the narrators'
  -- recordings play). Forget its setting and the one-time switch that turned it off (readAloudOff). Narration set to
  -- "Game voice only" (every voice unticked, or the old voicePack = "none") loads as it was: no narration.
  db.settings.readAloud, db.settings.readAloudOff = nil, nil
  -- Direct quest dialogue is a fresh opt-in, even when an older install saved autoQuest = true.
  -- The new questDialogue choice persists; the old automatic-only setting cannot enable it.
  db.settings.autoQuest = nil
  -- The book button beside the menu bar is gone (Mike, 2026-10-02: the key, the minimap button and /lore all open the
  -- panel, and the floating player stops narration). Forget its settings.
  db.settings.launcher, db.settings.launcherPos, db.settings.launcherOff = nil, nil, nil
  db.questions = db.questions or {}
  db.quests = db.quests or {}       -- harvested quest text by questID
  db.maps = db.maps or {}           -- zone/subzone names seen per mapID
  db.visits = db.visits or {}       -- zone name -> {n, minLevel, maxLevel, first, last, lore}: where players go
  db.sessions = (db.sessions or 0) + 1
  Log.session = db.sessions
  if ns.HistoryArchive then ns.HistoryArchive.Init() end
end

-- Usage counts (LOR-413) --------------------------------------------------------------------------------------------
-- How often each feature gets used, per day, so Mike can see what players actually use. Only numbers: no text, no
-- names, no entry or quest ids. The companion app sends them with the profile sync, and only for players who keep
-- their profile up to date (site/public/privacy.html). Nothing shows in game.
--   LoreForeverDB.usage["2026-10-10"] = { play = { zone = 3, answer = 1 }, done = { zone = 2 }, ask = 2, faq = 1,
--     live = 0, panel = 4, journey = 1, pic = 1 }
-- play: narrations started from their beginning (a resume isn't a new start); done: heard to the end, by kind.
local USAGE_DAYS = 30
local DAY = "^%d%d%d%d%-%d%d%-%d%d$"
local KINDS = { zone = "zone", subzone = "place", npc = "person", quest = "quest", topic = "topic" }

-- A recording's kind from its key: zone, place, person, quest (a quest's lore), dialogue (a quest giver's words),
-- answer (a question's recorded answer), topic or other.
function Log.NarrationKind(key)
  if type(key) ~= "string" then return "other" end
  if key:find("#faq%d+$") then return "answer" end
  if key:find("^quest:%d+#%a+$") then return "dialogue" end
  return KINDS[key:match("^(%a+):") or ""] or "other"
end

-- Today's counts, made on the first use of a day; only the newest USAGE_DAYS days are kept.
local function usageToday()
  local db = LoreForeverDB
  if type(db) ~= "table" then return nil end
  local u = type(db.usage) == "table" and db.usage or {}
  db.usage = u
  local today = date("%Y-%m-%d")
  if type(u[today]) == "table" then return u[today] end
  u[today] = {}
  local days = {}
  for k in pairs(u) do
    if type(k) == "string" and k:find(DAY) then days[#days + 1] = k else u[k] = nil end
  end
  table.sort(days)
  for i = 1, #days - USAGE_DAYS do u[days[i]] = nil end
  return u[today]
end

-- Count one use of what (a kind for play and done). Never lets a counting error reach the feature it counts.
function Log.Use(what, kind)
  pcall(function()
    local d = usageToday()
    if not d then return end
    if kind then
      local by = type(d[what]) == "table" and d[what] or {}
      d[what] = by
      by[kind] = (tonumber(by[kind]) or 0) + 1
    else
      d[what] = (tonumber(d[what]) or 0) + 1
    end
  end)
end

local function compactCtx(ctx)
  local quests = {}
  for _, q in ipairs(ctx.quests or {}) do quests[#quests + 1] = { id = q.id, title = q.title } end
  return { zone = ctx.zone, subzone = ctx.subzone, mapID = ctx.mapID, level = ctx.level, race = ctx.race,
    class = ctx.class, faction = ctx.faction, quests = quests, questItems = ctx.questItems,
    professions = ctx.professions, target = ctx.targetName }
end

-- Returns the log entry so feedback can be attached to it later.
function Log.Question(question, ctx, results, via, turn)
  local db = LoreForeverDB
  local top = {}
  for i, r in ipairs(results or {}) do
    top[i] = { key = r.key, kind = r.kind, idx = r.idx, title = r.title, score = r.score and math.floor(r.score * 100) / 100 }
  end
  local entry = { t = time(), session = Log.session, q = question, via = via, turn = turn, ctx = compactCtx(ctx),
    results = top }
  table.insert(db.questions, entry)
  if ns.HistoryArchive then ns.HistoryArchive.Question(entry) end
  while #db.questions > MAX_QUESTIONS do table.remove(db.questions, 1) end
  return entry
end

-- A thumbs up or down on an answer. A thumbs down can say why (Log.REASONS) and carry a short note.
function Log.Feedback(entry, helpful, reason, note)
  if not entry then return end
  entry.helpful = helpful
  entry.reason = (not helpful and Log.REASONS[reason or ""]) and reason or nil
  entry.note = (not helpful and type(note) == "string" and note:match("%S")) and note or nil
  if ns.HistoryArchive then ns.HistoryArchive.Question(entry, "feedback") end
end

-- Report codes (LOR-120) --------------------------------------------------------------------------------------------
-- "Copy report" turns a logged answer into a short code players paste on loreforeverwow.com/feedback (its Entry code
-- field, 120 characters) or in Discord. site/public/report-code.js decodes it; keep the two in step. Fields, split by ~:
--   LF1 ~ add-on version[.locale] ~ reason ~ via+shown ~ entry key[.f<faq>|.s<section>] ~ score ~ zone[/subzone]
--       ~ target ~ quest ids (comma-separated) ~ question (spaces as _)
-- Never the character's name: it's taken out of the question too. Quests with lore come first; quests, then the
-- target, then the end of the question are dropped to fit.
Log.REASONS = { wrong = "w", unanswered = "a", spoiler = "s", future = "f", other = "o" }
local VIA = { typed = "t", slash = "s", hover = "h", quest = "q", next = "n", complete = "c", reveal = "r",
  primer = "p", link = "l" }
local CODE_MAX = 120

-- Free text as a code field: no field separators, escapes or characters a web address would mangle.
local function field(s)
  s = tostring(s or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
  s = s:gsub("[%c~|#&%%%+=?\"<>\\`]", " "):gsub("_", " ")
  return (s:match("^%s*(.-)%s*$"):gsub("%s+", "_"))
end

local function slug(s)
  return (field(s):lower():gsub("'", ""):gsub("_", "-"))
end

-- Cut a UTF-8 string to at most n bytes without splitting a character.
local function cut(s, n)
  if #s <= n then return s end
  s = s:sub(1, math.max(0, n))
  local last = #s
  while last > 0 do
    local b = s:byte(last)
    if b < 128 then break end
    if b >= 192 then   -- a lead byte: keep it only when its whole character fits
      local need = (b >= 240 and 4) or (b >= 224 and 3) or 2
      if #s - last + 1 < need then s = s:sub(1, last - 1) end
      break
    end
    last = last - 1
  end
  return s
end

local function addonVersion()
  local get = (_G.C_AddOns and C_AddOns.GetAddOnMetadata) or _G.GetAddOnMetadata
  local ok, v = pcall(get or function() end, "LoreForever", "Version")
  return (ok and type(v) == "string" and v ~= "") and field(v) or "-"
end

-- This add-on's version, from its .toc ("-" when the client doesn't say).
function Log.Version() return addonVersion() end

function Log.ReportCode(entry)
  if not entry then return nil end
  local ctx, top = entry.ctx or {}, (entry.results or {})[1] or {}
  local locale = ns.lang and ns.lang.locale
  local version = addonVersion() .. ((locale and locale ~= "enUS") and ("." .. locale:sub(1, 2):lower()) or "")
  local answer = "-"
  if top.key then
    answer = top.key .. ((top.kind == "faq" and top.idx and (".f" .. top.idx))
      or (top.kind == "section" and top.idx and (".s" .. top.idx)) or "")
  end
  local zk = ns.engine and ctx.zone and ns.engine:ZoneKey(ctx.zone)
  local place = zk or slug(ctx.zone)
  if ctx.subzone and ctx.subzone ~= ctx.zone then place = place .. "/" .. slug(ctx.subzone) end
  local quests, later = {}, {}
  for _, q in ipairs(ctx.quests or {}) do
    if q.id then
      local known = ns.DB and ns.DB.index and ns.DB.index.quest[q.id]
      table.insert(known and quests or later, tostring(q.id))
    end
  end
  for _, id in ipairs(later) do quests[#quests + 1] = id end
  local question = entry.q or ""
  local me = UnitName and UnitName("player")
  if type(me) == "string" and me ~= "" then question = question:gsub(me:gsub("%W", "%%%0"), "[me]") end
  local fields = { "LF1", version, entry.reason and Log.REASONS[entry.reason] or "-",
    (VIA[entry.via or ""] or "o") .. (entry.shown or "a"), answer,
    top.score and tostring(math.floor(top.score)) or "", place, slug(ctx.target), "", field(question) }
  local function build()
    fields[9] = table.concat(quests, ",")
    return table.concat(fields, "~")
  end
  local code = build()
  while #code > CODE_MAX and #quests > 0 do
    table.remove(quests)
    code = build()
  end
  if #code > CODE_MAX then
    fields[8] = ""
    code = build()
  end
  if #code > CODE_MAX then
    fields[10] = cut(fields[10], #fields[10] - (#code - CODE_MAX))
    code = build()
  end
  return cut(code, CODE_MAX)
end

-- The feedback page's address with the code (and the note) filled in, for pasting into a browser.
local function urlEncode(s)
  return (s:gsub("[^%w%-%._~:,/]", function(c) return string.format("%%%02X", c:byte()) end))
end

function Log.ReportLink(entry)
  local code = Log.ReportCode(entry)
  if not code then return nil end
  local link = "https://loreforeverwow.com/feedback?kind=lore&code=" .. urlEncode(code)
  if entry.note then link = link .. "&note=" .. urlEncode(cut(entry.note, 300)) end
  return link
end

-- Clip reports (LOR-232) --------------------------------------------------------------------------------------------
-- "Report a problem with this narration" (ClipReport.lua) turns the recording that played into a link to
-- loreforeverwow.com/clip-report, which sends it in one click, no sign-in. site/public/clip-report-code.js decodes it;
-- keep the two in step. Fields, split by ~:
--   LCR1 ~ add-on version.locale ~ voice pack (without LoreForever_Voice_) ~ clip id@hash ~ reason ~ name
--        ~ how the name should sound ~ note ~ checksum
-- Name, sound and note are percent-encoded (%, ~ and control characters) and cut to Log.CLIP_MAX characters; name and
-- sound only go with the "name" reason. The checksum is 6 hex digits of a djb2 hash of everything before it, so a copy
-- that lost its end is caught. Never the character's name: it's taken out of the note.
Log.CLIP_REASONS = { "name", "voice", "cut", "quality", "stage", "text", "other" }
Log.CLIP_MAX = { name = 60, sayAs = 80, note = 300 }
local CLIP_REASON = {}
for _, r in ipairs(Log.CLIP_REASONS) do CLIP_REASON[r] = true end
local VOICE_PREFIX = "LoreForever_Voice_"

-- The first n characters (not bytes) of a UTF-8 string.
local function chars(s, n)
  local count, i = 0, 1
  while i <= #s do
    count = count + 1
    if count > n then return s:sub(1, i - 1) end
    local b = s:byte(i)
    i = i + ((b >= 240 and 4) or (b >= 224 and 3) or (b >= 192 and 2) or 1)
  end
  return s
end

local function freeText(s, n, scrubName)
  s = tostring(s or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
  if scrubName then
    local me = UnitName and UnitName("player")
    if type(me) == "string" and me ~= "" then s = s:gsub(me:gsub("%W", "%%%0"), "[me]") end
  end
  s = chars(s:gsub("%s+", " "):match("^%s*(.-)%s*$"), n)
  return (s:gsub("[%%~%c]", function(c) return string.format("%%%02X", c:byte()) end))
end

-- 6 hex digits: djb2 over the bytes, kept to 32 bits (site/public/clip-report-code.js checksum does the same).
function Log.ClipChecksum(s)
  local h = 5381
  for i = 1, #s do h = (h * 33 + s:byte(i)) % 4294967296 end
  return string.format("%06x", h % 16777216)
end

-- r = { clip = "zone:stormwind#faq3", hash = "1a2b3c", voice = "LoreForever_Voice_Default", reason = "name",
--       name = "Teldrassil", sayAs = "tel-DRASS-il", note = "..." }
function Log.ClipReportCode(r)
  if not (r and type(r.clip) == "string" and r.clip ~= "") then return nil end
  local locale = tostring(ns.readingLocale or (ns.lang and ns.lang.locale) or "enUS"):gsub("[^%a]", "")
  local voice = tostring(r.voice or "")
  if voice:sub(1, #VOICE_PREFIX) == VOICE_PREFIX then voice = voice:sub(#VOICE_PREFIX + 1) end
  voice = voice:gsub("[^%w_]", "")
  local reason = CLIP_REASON[r.reason or ""] and r.reason or "other"
  local named = reason == "name"
  local fields = { "LCR1", addonVersion() .. "." .. (locale ~= "" and locale or "enUS"), voice ~= "" and voice or "-",
    r.clip:gsub("[^%w:#%-]", "") .. "@" .. tostring(r.hash or ""):gsub("[^%x]", ""):lower(), reason,
    named and freeText(r.name, Log.CLIP_MAX.name) or "", named and freeText(r.sayAs, Log.CLIP_MAX.sayAs) or "",
    freeText(r.note, Log.CLIP_MAX.note, true) }
  local body = table.concat(fields, "~")
  return body .. "~" .. Log.ClipChecksum(body)
end

function Log.ClipReportLink(r)
  local code = Log.ClipReportCode(r)
  return code and ("https://loreforeverwow.com/clip-report#c=" .. urlEncode(code)) or nil
end

function Log.Map(ctx)
  if not ctx.mapID then return end
  local m = LoreForeverDB.maps[ctx.mapID] or { zone = ctx.zone, subzones = {} }
  m.zone = ctx.zone or m.zone
  if ctx.subzone then m.subzones[ctx.subzone] = true end
  LoreForeverDB.maps[ctx.mapID] = m
end

-- Quest text as the NPC offers it (QUEST_DETAIL), and progress/completion text later.
-- The game writes the character's name, class and race into quest text; they're kept as $N, $C and $R
-- (Capture.Placeholders), so nothing that feeds the lore pipeline or is shared at /contribute carries the name.
local function nameOut(text, token)
  if type(text) ~= "string" then return text end
  local me = UnitName and UnitName("player")
  if type(me) == "string" and me ~= "" then
    text = text:gsub(me:gsub("%W", "%%%0"), token)
  end
  return text
end
local function scrub(text)
  if type(text) == "string" and ns.Capture then return ns.Capture.Placeholders(text) end
  return nameOut(text, "$N")
end
Log.Scrub = scrub   -- gossip and book text too (Journey.lua)

-- Titles (a book's, a letter's) keep the form 0.7.0 gave them, the name only, as <name>: they're keys (texts.books,
-- the journey's seen.book and its events), so they stay the same across versions and characters.
function Log.ScrubName(text) return nameOut(text, "<name>") end

-- Options › Keep the quest text you see (Capture.lua): off keeps no new quest text.
local function keeping() return not ns.Capture or ns.Capture.On() end

local PARTS = { detail = { "title", "detail", "objectives" }, progress = { "title", "progress" },
  complete = { "title", "complete" } }

function Log.QuestText(kind)
  if not keeping() then return end
  local id = GetQuestID and GetQuestID()
  if not id or id == 0 then return end
  local q = LoreForeverDB.quests[id] or { id = id }
  q.title = (GetTitleText and GetTitleText()) or q.title
  if kind == "detail" then
    q.text = scrub(GetQuestText and GetQuestText()) or q.text
    q.objectives = scrub(GetObjectiveText and GetObjectiveText()) or q.objectives
    q.zone = GetRealZoneText and GetRealZoneText() or q.zone
  elseif kind == "progress" then
    q.progress = scrub(GetProgressText and GetProgressText()) or q.progress
  elseif kind == "complete" then
    q.completion = scrub(GetRewardText and GetRewardText()) or q.completion
  end
  -- Who gives the quest (detail) and who takes it (progress, complete): the NPC's or object's id, name, sex and model
  -- (Giver.lua, LOR-224). Never a player: a quest shared by another player, or started from an item, records nobody.
  local ok, who = pcall(function() return ns.Giver and ns.Giver.Identify("npc") end)
  if ok and who then
    if kind == "detail" then q.starter = who else q.ender = who end
  end
  q.known = ns.DB and ns.DB.index.quest[id] ~= nil
  if ns.HistoryArchive then ns.HistoryArchive.Text("quest", id, kind, q) end
  if not LoreForeverDB.quests[id] and ns.Capture and not ns.Capture.Room("quest") then return end
  LoreForeverDB.quests[id] = q
  if ns.Capture then pcall(ns.Capture.NoteQuest, id, q, PARTS[kind] or {}) end
end

-- Quest text read from the quest log (the panel shows it for quests without lore); keeps what QuestText missed.
function Log.QuestFromLog(q, text, objectives)
  if not (q and q.id) or not keeping() then return end
  local rec = LoreForeverDB.quests[q.id] or { id = q.id }
  local had = { title = rec.title, detail = rec.text, objectives = rec.objectives }
  rec.title = rec.title or q.title
  rec.text = rec.text or scrub(text)
  rec.objectives = rec.objectives or scrub(objectives)
  rec.zone = rec.zone or (GetRealZoneText and GetRealZoneText())
  rec.known = ns.DB and ns.DB.index.quest[q.id] ~= nil
  if ns.HistoryArchive then ns.HistoryArchive.Text("quest", q.id, "log", rec) end
  if not LoreForeverDB.quests[q.id] and ns.Capture and not ns.Capture.Room("quest") then return end
  LoreForeverDB.quests[q.id] = rec
  local new = {}
  for part, v in pairs(had) do if v == nil then new[#new + 1] = part end end
  if ns.Capture and #new > 0 then pcall(ns.Capture.NoteQuest, q.id, rec, new) end
end

-- Zone visits with the level on arrival, so playtests show where people wander (often above their level).
function Log.Visit(zone, level, hasLore)
  if not zone or zone == "" then return end
  local v = LoreForeverDB.visits[zone] or { n = 0, first = time() }
  v.n = v.n + 1
  v.last = time()
  if level then
    v.minLevel = math.min(v.minLevel or level, level)
    v.maxLevel = math.max(v.maxLevel or level, level)
  end
  v.lore = hasLore and true or false
  LoreForeverDB.visits[zone] = v
end
