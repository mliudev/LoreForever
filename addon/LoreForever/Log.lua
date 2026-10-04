-- Records questions, answers and feedback, plus quest text the wiki doesn't have yet, into SavedVariables.
-- pipeline/lore/harvest.py reads these back into the eval set and the lore pipeline.
-- Note: the Forever beta reportedly writes SavedVariables on logout/reload but may not read them back, so each
-- session's log can replace the previous one. Harvest after each session.

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
  -- The book button beside the menu bar is gone (Mike, 2026-10-02: the key, the minimap button and /lore all open the
  -- panel, and the floating player stops narration). Forget its settings.
  db.settings.launcher, db.settings.launcherPos, db.settings.launcherOff = nil, nil, nil
  db.questions = db.questions or {}
  db.quests = db.quests or {}       -- harvested quest text by questID
  db.maps = db.maps or {}           -- zone/subzone names seen per mapID
  db.visits = db.visits or {}       -- zone name -> {n, minLevel, maxLevel, first, last, lore}: where players go
  db.sessions = (db.sessions or 0) + 1
  Log.session = db.sessions
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
  while #db.questions > MAX_QUESTIONS do table.remove(db.questions, 1) end
  return entry
end

-- A thumbs up or down on an answer. A thumbs down can say why (Log.REASONS) and carry a short note.
function Log.Feedback(entry, helpful, reason, note)
  if not entry then return end
  entry.helpful = helpful
  entry.reason = (not helpful and Log.REASONS[reason or ""]) and reason or nil
  entry.note = (not helpful and type(note) == "string" and note:match("%S")) and note or nil
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

function Log.Map(ctx)
  if not ctx.mapID then return end
  local m = LoreForeverDB.maps[ctx.mapID] or { zone = ctx.zone, subzones = {} }
  m.zone = ctx.zone or m.zone
  if ctx.subzone then m.subzones[ctx.subzone] = true end
  LoreForeverDB.maps[ctx.mapID] = m
end

-- Quest text as the NPC offers it (QUEST_DETAIL), and progress/completion text later.
-- The game writes the character's name into quest text; keep it out of anything that feeds the lore pipeline.
local function scrub(text)
  if type(text) ~= "string" then return text end
  local me = UnitName and UnitName("player")
  if type(me) == "string" and me ~= "" then
    text = text:gsub(me:gsub("%W", "%%%0"), "<name>")
  end
  return text
end
Log.Scrub = scrub   -- gossip and book text too (Journey.lua)

function Log.QuestText(kind)
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
  q.known = ns.DB and ns.DB.index.quest[id] ~= nil
  LoreForeverDB.quests[id] = q
end

-- Quest text read from the quest log (the panel shows it for quests without lore); keeps what QuestText missed.
function Log.QuestFromLog(q, text, objectives)
  if not (q and q.id) then return end
  local rec = LoreForeverDB.quests[q.id] or { id = q.id }
  rec.title = rec.title or q.title
  rec.text = rec.text or scrub(text)
  rec.objectives = rec.objectives or scrub(objectives)
  rec.zone = rec.zone or (GetRealZoneText and GetRealZoneText())
  rec.known = ns.DB and ns.DB.index.quest[q.id] ~= nil
  LoreForeverDB.quests[q.id] = rec
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
