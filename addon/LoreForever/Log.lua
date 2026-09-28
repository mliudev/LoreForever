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
    professions = ctx.professions }
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

function Log.Feedback(entry, helpful)
  if entry then entry.helpful = helpful end
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
