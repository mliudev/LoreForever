-- The Forever text players see, kept so they can share what Lore Forever doesn't have yet (LOR-228), and the small
-- Contribute buttons that share one line at a time (LOR-234). The text stays in SavedVariables on the player's PC
-- until they share it: one line through a button's link, or the whole LoreForever.lua at loreforeverwow.com/contribute
-- (site/public/contribute/, which reads the file in the browser). pipeline/lore/harvest.py reads the same tables.
--
-- What's kept (Options › Keep the quest text you see turns all of it off; on by default):
--   LoreForeverDB.quests[questID]          Log.QuestText: title, text, objectives, progress, completion, starter/ender
--   LoreForeverDB.texts.gossip[npc][hash]  Journey.lua onGossip; texts.npcs[npc] = {id, sex, ctype}: who that NPC is
--   LoreForeverDB.texts.books[title][page] Journey.lua onBookPage
--   LoreForeverDB.texts.say[npcID][hash] = {text, kind = "say" | "yell", name, sex, ctype, t}
--                                          CHAT_MSG_MONSTER_SAY/YELL from NPCs known by their GUID, at most SAY_PER_NPC
--                                          lines each and SAY_TOTAL in all; nothing said during a fight outside a
--                                          dungeon (barks), nothing naming someone in your group
--   LoreForeverDB.capture = { v, build, locale, version, install (a random id: one install's uploads count as one
--     sender), missing = { ["quest:123"] = true, ["gossip:<npc>"], ["book:<title>"], ["say:<npcID>"] }: what Lore
--     Forever ships no text for (recomputed at every login against this release's data), by = { [line key] =
--     "Human.WARRIOR.2" }: the race, class and gender of the character who saw each line, sent = { [line key] = true }:
--     shared already ("Mark all as sent" in Options; a file upload leaves these out), copied = { [line key] = true }:
--     its Contribute link was copied (the button hides for it) }
-- Line keys: quest:<id>#<part> (part: title, detail, objectives, progress, complete), gossip:<npc name>#<hash>,
-- book:<title>#<page>, say:<npcID>#<hash>.
-- Text is stored with the character's name, class and race replaced by $N, $C and $R (Capture.Placeholders), as the
-- game's own quest templates have them; older versions wrote <name>, and the site and harvest read both.
-- Size: at most MAX_QUESTS quest records and MAX_TEXTS gossip, book and say lines. Past that, quests whose text a
-- release now ships go first, then lines already sent; if it's still full, new text isn't kept.
--
-- Contribute codes (Capture.Code; decoded by site/public/contribute-code.js, keep the two in step):
--   LFC1~<version>.<locale>~<kind>~<id>~<part>~<speaker>~<player>~<text>~<checksum>
-- speaker "<npc id>.<UnitSex>.<creature type>.<name>" or "o<object id>"; player "Race.CLASS.sex"; checksum the djb2 of
-- everything before it (8 hex digits); % ~ CR LF inside fields as %25 %7E %0D %0A. The button's link is
-- https://loreforeverwow.com/contribute#c=<the code, percent-encoded>; a code over MAX_CODE characters (never seen in
-- practice) gives the page's address instead, with a note to share the file.

local _, ns = ...
local Capture = {}
ns.Capture = Capture
local L = ns.L

local SITE = "https://loreforeverwow.com/contribute"
local V = 1
local MAX_CODE = 8000
local SAY_PER_NPC, SAY_TOTAL = 12, 1500
local MAX_QUESTS, MAX_TEXTS = 3000, 4000
local SAY_KIND = { CHAT_MSG_MONSTER_SAY = "say", CHAT_MSG_MONSTER_YELL = "yell" }
local QUEST_FIELDS = { title = "title", text = "detail", objectives = "objectives", progress = "progress",
  completion = "complete" }
local PART_FP = { detail = 2, progress = 3, complete = 4 }   -- ns.DB.questVoice[id][n]: that part's fingerprint
local QUEST_TEXT = { detail = "GetQuestText", progress = "GetProgressText", complete = "GetRewardText" }
local ICON = "Interface\\Icons\\INV_Misc_Note_01"

local function call(f, ...)
  if type(f) ~= "function" then return nil end
  local ok, a, b, c = pcall(f, ...)
  if ok then return a, b, c end
end
local function usable(v) return ns.Context.Usable(v) and type(v) == "string" and v:find("%S") ~= nil end
local function settings() return (LoreForeverDB and LoreForeverDB.settings) or {} end
local function db() return type(LoreForeverDB) == "table" and LoreForeverDB.capture or nil end
local function count(t) local n = 0 for _ in pairs(type(t) == "table" and t or {}) do n = n + 1 end return n end

-- "Keep the quest text you see" (Options): off keeps nothing new; what's there stays.
function Capture.On() return settings().capture ~= false end
-- "Contribute buttons" (Options): off by default until they've been seen in game (Options.DEFAULTS).
function Capture.ButtonsOn() return settings().contributeButtons == true end

-- A short, stable hash of a text, as 8 hex digits (Lua 5.1 has no bit operations; this stays exact in doubles). The
-- same djb2 as Journey.lua's and the site's checksum.
local function hash(text)
  local h = 5381
  for i = 1, #text do h = (h * 33 + text:byte(i)) % 4294967296 end
  return string.format("%04x%04x", math.floor(h / 65536), h % 65536)
end
Capture.Hash = hash

-- Placeholders --------------------------------------------------------------------------------------------------------

local WORD = "0-9A-Za-z\128-\255"
local function literal(s) return (s:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0")) end
local function anyCase(s) return (literal(s):gsub("%a", function(c) return "[" .. c:upper() .. c:lower() .. "]" end)) end
local function word(p) return "%f[" .. WORD .. "]" .. p .. "(s?)%f[^" .. WORD .. "]" end

-- The player's class as a quest can name it, in every form the language has (Kriegerin, Krieger).
local function classWords()
  local out, seen = {}, {}
  local name, file = call(_G.UnitClass, "player")
  local function add(w)
    if usable(w) and not seen[w:lower()] then seen[w:lower()] = true; out[#out + 1] = w end
  end
  add(name)
  for _, t in ipairs({ _G.LOCALIZED_CLASS_NAMES_MALE, _G.LOCALIZED_CLASS_NAMES_FEMALE }) do
    if type(t) == "table" and file then add(t[file]) end
  end
  return out
end

-- The text with this character's name replaced by $N (as written, and in capitals as a yell has it; anywhere, even
-- glued to a dwarf's "-ama"), and their race and class, as whole words in any case, by $R and $C ("Humans" -> "$Rs").
function Capture.Placeholders(text)
  if type(text) ~= "string" or text == "" then return text end
  local name = call(_G.UnitName, "player")
  if usable(name) and #name >= 2 then
    text = text:gsub(literal(name), "$N"):gsub(literal(name:upper()), "$N")
  end
  local race = call(_G.UnitRace, "player")
  if usable(race) then text = text:gsub(word(anyCase(race)), "$R%1") end
  for _, w in ipairs(classWords()) do text = text:gsub(word(anyCase(w)), "$C%1") end
  return text
end

-- Whether two kept texts are the same words, whoever saw them: placeholders ($N, $C, $R, and 0.7.0's <name>) and this
-- character's own name, class and race don't count (Voice.QuestFingerprints: letters and digits only).
function Capture.SameText(a, b)
  if a == b then return true end
  if type(a) ~= "string" or type(b) ~= "string" or not (ns.Voice and ns.Voice.QuestFingerprints) then return false end
  local function fps(s)
    local set = {}
    for _, f in ipairs(ns.Voice.QuestFingerprints((s:gsub("%$[NnCcRr]", " "):gsub("<name>", " ")))) do set[f] = true end
    return set
  end
  local fa = fps(a)
  for f in pairs(fps(b)) do if fa[f] then return true end end
  return false
end

-- "Human.WARRIOR.2": the race file, class file and UnitSex of this character, or nil.
function Capture.PlayerTag()
  local _, race = call(_G.UnitRace, "player")
  local _, class = call(_G.UnitClass, "player")
  local sex = call(_G.UnitSex, "player")
  if type(race) == "string" and race:match("^%a%a+$") and type(class) == "string" and class:match("^%u%u+$")
      and (sex == 1 or sex == 2 or sex == 3) then
    return race .. "." .. class .. "." .. sex
  end
end

-- What Lore Forever ships -----------------------------------------------------------------------------------------------

-- Whether the add-on's data has this text: a quest part's recorded words (ns.DB.questVoice, a fingerprint per part:
-- Voice.QuestFingerprints) match it. Nothing else ships as game text yet (gossip, books, what NPCs say).
function Capture.Ships(kind, id, part, text)
  if kind ~= "quest" or not PART_FP[part] then return false end
  local q = ns.DB and ns.DB.questVoice and ns.DB.questVoice[tonumber(id)]
  local fp = q and q[PART_FP[part]]
  if type(fp) ~= "string" or fp == "" then return false end
  if type(text) ~= "string" or not ns.Voice or not ns.Voice.QuestFingerprints then return true end
  local plain = text:gsub("%$[NCR]", " ")
  for _, f in ipairs(ns.Voice.QuestFingerprints(plain)) do
    if f == fp then return true end
  end
  return false
end

-- Whether every part of a quest record Lore Forever has is one the add-on ships (and the quest has a lore entry).
local function questShipped(id, rec)
  if not (ns.DB and ns.DB.index and ns.DB.index.quest[tonumber(id)]) then return false end
  for field, part in pairs(QUEST_FIELDS) do
    if PART_FP[part] and usable(rec[field]) and not Capture.Ships("quest", id, part, rec[field]) then return false end
  end
  return true
end

-- Every line kept, as fn(key, kind, ref, part, text, where): where is the table and field holding it.
function Capture.EachLine(fn)
  local d = LoreForeverDB or {}
  for id, rec in pairs(type(d.quests) == "table" and d.quests or {}) do
    if type(rec) == "table" then
      for field, part in pairs(QUEST_FIELDS) do
        if usable(rec[field]) then fn("quest:" .. id .. "#" .. part, "quest", id, part, rec[field], rec, field) end
      end
    end
  end
  local t = type(d.texts) == "table" and d.texts or {}
  for _, kind in ipairs({ "gossip", "books", "say" }) do
    for ref, lines in pairs(type(t[kind]) == "table" and t[kind] or {}) do
      if type(lines) == "table" then
        for part, v in pairs(lines) do
          local text = type(v) == "table" and v.text or v
          if usable(text) then
            local k = kind == "books" and "book" or kind
            fn(k .. ":" .. ref .. "#" .. part, k, ref, part, text, lines, part)
          end
        end
      end
    end
  end
end

-- Size -------------------------------------------------------------------------------------------------------------------

local function sizes()
  local quests, texts = count(LoreForeverDB.quests), 0
  local t = LoreForeverDB.texts or {}
  for _, kind in ipairs({ "gossip", "books", "say" }) do
    for _, lines in pairs(type(t[kind]) == "table" and t[kind] or {}) do texts = texts + count(lines) end
  end
  return quests, texts
end

-- Over the cap: quests a release now ships go first, then lines already sent. Returns whether there's room now.
function Capture.Prune()
  local c = db()
  local quests, texts = sizes()
  local function sentQuest(id, rec)
    if not c then return false end
    for field, part in pairs(QUEST_FIELDS) do
      if usable(rec[field]) and not c.sent["quest:" .. id .. "#" .. part] then return false end
    end
    return true
  end
  -- Down to one under the cap, so the line that asked for room fits.
  for _, gone in ipairs({ questShipped, sentQuest }) do
    if quests < MAX_QUESTS then break end
    for id, rec in pairs(LoreForeverDB.quests) do
      if quests < MAX_QUESTS then break end
      if type(rec) ~= "table" or gone(id, rec) then LoreForeverDB.quests[id] = nil; quests = quests - 1 end
    end
  end
  if c and texts >= MAX_TEXTS then
    local drop = {}
    Capture.EachLine(function(key, kind, ref, part, text, where, field)
      if kind ~= "quest" and c.sent[key] and texts >= MAX_TEXTS then
        drop[#drop + 1] = { where, field }
        texts = texts - 1
      end
    end)
    for _, d in ipairs(drop) do d[1][d[2]] = nil end
  end
  return quests < MAX_QUESTS and texts < MAX_TEXTS
end

local function room(kind)
  local quests, texts = sizes()
  if (kind == "quest" and quests < MAX_QUESTS) or (kind ~= "quest" and texts < MAX_TEXTS) then return true end
  Capture.Prune()
  quests, texts = sizes()
  return (kind == "quest" and quests < MAX_QUESTS) or (kind ~= "quest" and texts < MAX_TEXTS)
end
Capture.Room = room

-- Bookkeeping -------------------------------------------------------------------------------------------------------------

local function randomId()
  local t = {}
  for i = 1, 4 do t[i] = string.format("%04x", math.random(0, 65535)) end
  return table.concat(t)
end

-- Recomputes the missing markers against this release's data and forgets bookkeeping for lines that are gone.
function Capture.Refresh()
  local c = db()
  if not c then return end
  local present, missing = {}, {}
  Capture.EachLine(function(key, kind, ref, part, text)
    present[key] = true
    if kind ~= "quest" then
      missing[kind .. ":" .. ref] = true
    elseif not missing["quest:" .. ref] then
      local idx = ns.DB and ns.DB.index and ns.DB.index.quest[tonumber(ref)]
      if not idx or (PART_FP[part] and not Capture.Ships("quest", ref, part, text)) then missing["quest:" .. ref] = true end
    end
  end)
  c.missing = missing
  for _, t in ipairs({ c.sent, c.by, c.copied }) do
    for k in pairs(t) do if not present[k] then t[k] = nil end end
  end
end

-- 0.7.0 and earlier kept the character's name as <name> in quest, gossip and book text; 0.8.0 keeps $N (and $C, $R).
-- Once, at the first login with capture: the text is rewritten, and each gossip text moves to the hash of its new
-- words, so the same gossip heard again isn't kept twice. Titles and other keys stay as they were (Log.ScrubName).
-- Race and class can't be told apart in old text (which character saw it is unknown), so they stay written out.
function Capture.MigrateNames(d)
  local function fix(s) return type(s) == "string" and (s:gsub("<name>", "$N")) or s end
  local n = 0
  for _, rec in pairs(d.quests) do
    if type(rec) == "table" then
      for field in pairs(QUEST_FIELDS) do
        if field ~= "title" and type(rec[field]) == "string" and rec[field]:find("<name>", 1, true) then
          rec[field], n = fix(rec[field]), n + 1
        end
      end
    end
  end
  for _, pages in pairs(d.texts.books) do
    if type(pages) == "table" then
      for p, t in pairs(pages) do
        if type(t) == "string" and t:find("<name>", 1, true) then pages[p], n = fix(t), n + 1 end
      end
    end
  end
  for _, said in pairs(d.texts.gossip) do
    if type(said) == "table" then
      local moved = {}
      for h, t in pairs(said) do
        if type(t) == "string" and t:find("<name>", 1, true) then moved[h] = fix(t) end
      end
      for h, t in pairs(moved) do
        said[h] = nil
        said[hash(t)] = t
        n = n + 1
      end
    end
  end
  return n
end

-- At login (Journey.Init, before anything is captured this session): the tables, this client's build, language and
-- add-on version, 0.7.0's text moved to $N (once), then the markers and the size cap. Nothing in an older
-- LoreForeverDB needs a reset: every table here is made when it's missing, and old text reads as before.
function Capture.Init()
  local d = LoreForeverDB
  if type(d) ~= "table" then return end
  d.quests = type(d.quests) == "table" and d.quests or {}
  d.texts = type(d.texts) == "table" and d.texts or {}
  for _, k in ipairs({ "gossip", "books", "say", "npcs" }) do
    d.texts[k] = type(d.texts[k]) == "table" and d.texts[k] or {}
  end
  local c = type(d.capture) == "table" and d.capture or {}
  d.capture = c
  if (tonumber(c.names) or 0) < 1 then
    Capture.MigrateNames(d)
    c.names = 1   -- text keeps $N/$C/$R
  end
  c.v = V
  local version, build = call(_G.GetBuildInfo)
  c.build = (type(version) == "string" and version or "") .. (build and ("." .. tostring(build)) or "")
  c.locale = call(_G.GetLocale) or c.locale or "enUS"
  c.version = ns.Log.Version()
  if type(c.install) ~= "string" or not c.install:match("^%x+$") then c.install = randomId() end
  for _, k in ipairs({ "sent", "by", "copied", "missing" }) do c[k] = type(c[k]) == "table" and c[k] or {} end
  Capture.Prune()
  Capture.Refresh()
  Capture.Hook()
end

-- Who saw a line, and whether Lore Forever lacks it (called as each line is kept).
function Capture.Note(key, kind, ref, missing)
  local c = db()
  if not c then return end
  c.by[key] = Capture.PlayerTag()
  if missing then c.missing[kind .. ":" .. ref] = true end
end

-- Log.QuestText and Log.QuestFromLog kept quest text: note who saw each part and whether we lack the quest.
function Capture.NoteQuest(id, rec, parts)
  if not db() then return end
  local lacks = not (ns.DB and ns.DB.index and ns.DB.index.quest[id])
  for _, part in ipairs(parts) do
    local field
    for f, p in pairs(QUEST_FIELDS) do if p == part then field = f end end
    if field and usable(rec[field]) then
      Capture.Note("quest:" .. id .. "#" .. part, "quest", id, false)
      if PART_FP[part] and not Capture.Ships("quest", id, part, rec[field]) then lacks = true end
    end
  end
  if lacks then db().missing["quest:" .. id] = true end
end

-- Journey.lua onGossip kept a gossip text: who the NPC is (its id from the GUID, sex, creature type) and who saw it.
function Capture.NoteGossip(name, h)
  local kind, id = ns.Giver.ParseGUID(call(_G.UnitGUID, "npc"))
  local npcs = LoreForeverDB.texts.npcs
  if npcs and kind == "npc" then
    npcs[name] = { id = id, sex = call(_G.UnitSex, "npc"), ctype = call(_G.UnitCreatureType, "npc") }
  end
  Capture.Note("gossip:" .. name .. "#" .. h, "gossip", name, true)
end

function Capture.NoteBook(title, page)
  Capture.Note("book:" .. title .. "#" .. page, "book", title, true)
end

-- What NPCs say aloud ----------------------------------------------------------------------------------------------------

-- Names of the others in your group, to leave out lines that name them.
local function groupNames()
  local out = {}
  local raid = call(_G.IsInRaid)
  local unit, n = raid and "raid" or "party",
    (raid and call(_G.GetNumGroupMembers)) or call(_G.GetNumSubgroupMembers) or call(_G.GetNumPartyMembers) or 0
  for i = 1, math.min(tonumber(n) or 0, 40) do
    local name = call(_G.UnitName, unit .. i)
    if usable(name) then out[#out + 1] = name end
  end
  return out
end

local sayCount
function Capture.OnSay(event, text, sender, ...)
  if not (Capture.On() and db() and usable(text)) then return end
  local kind, id = ns.Giver.ParseGUID(select(10, ...))   -- the 12th argument is the speaker's GUID
  if kind ~= "npc" then return end
  if call(_G.UnitAffectingCombat, "player") and not call(_G.IsInInstance) then return end   -- barks in a fight
  for _, n in ipairs(groupNames()) do
    if text:find(n, 1, true) then return end
  end
  text = Capture.Placeholders(text)
  local h = hash(text)
  local said = LoreForeverDB.texts.say
  local mine = said[id]
  if mine and mine[h] then return end
  if count(mine) >= SAY_PER_NPC then return end
  if not sayCount then
    sayCount = 0
    for _, lines in pairs(said) do sayCount = sayCount + count(lines) end
  end
  if sayCount >= SAY_TOTAL or not room("say") then return end
  local rec = { text = text, kind = SAY_KIND[event] or "say", name = usable(sender) and sender or nil, t = time() }
  -- Its sex and creature type when it's the unit you're targeting or talking to.
  for _, unit in ipairs({ "target", "npc", "mouseover" }) do
    local _, uid = ns.Giver.ParseGUID(call(_G.UnitGUID, unit))
    if uid == id then
      rec.sex, rec.ctype = call(_G.UnitSex, unit), call(_G.UnitCreatureType, unit)
      break
    end
  end
  said[id] = mine or {}
  said[id][h] = rec
  sayCount = sayCount + 1
  Capture.Note("say:" .. id .. "#" .. h, "say", id, true)
end

-- "Mark all as sent" -----------------------------------------------------------------------------------------------------

-- Every line kept so far counts as shared: the next file upload leaves them out. Returns how many lines that is.
function Capture.MarkAllSent()
  local c = db()
  if not c then return 0 end
  local n = 0
  Capture.EachLine(function(key)
    if not c.sent[key] then n = n + 1 end
    c.sent[key] = true
  end)
  Capture.UpdateAll()
  return n
end

-- Contribute codes --------------------------------------------------------------------------------------------------------

local function esc(s)
  return (tostring(s or ""):gsub("[%%~\r\n]", function(ch) return string.format("%%%02X", ch:byte()) end))
end

local function urlEncode(s)
  return (s:gsub("[^%w%-%._~:,/]", function(ch) return string.format("%%%02X", ch:byte()) end))
end

function Capture.SpeakerField(who)
  if type(who) ~= "table" then return "" end
  if who.kind == "object" then return who.id and ("o" .. who.id) or "" end
  local s = table.concat({ tostring(who.id or ""), tostring(who.sex or ""), tostring(who.ctype or ""),
    tostring(who.name or "") }, ".")
  return (s:gsub("%.+$", ""))
end

-- The code for a line { kind, id, part, text, speaker, player }.
function Capture.Code(line)
  local c = db()
  local locale = (c and c.locale) or call(_G.GetLocale) or "enUS"
  local body = table.concat({ "LFC1", (ns.Log.Version() or "-") .. "." .. locale, line.kind, esc(line.id),
    esc(line.part), esc(Capture.SpeakerField(line.speaker)), esc(line.player or ""), esc(line.text) }, "~")
  return body .. "~" .. hash(body)
end

-- A code read back (for /lore qa and the tests): the fields, or nil when the checksum doesn't match.
function Capture.Decode(code)
  local body, sum = tostring(code or ""):match("^(.*)~(%x%x%x%x%x%x%x%x)$")
  if not body or hash(body) ~= sum then return nil end
  local f = {}
  for part in (body .. "~"):gmatch("([^~]*)~") do f[#f + 1] = part end
  if #f ~= 8 or f[1] ~= "LFC1" then return nil end
  local function un(s) return (s:gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end)) end
  local version, locale = f[2]:match("^(.*)%.(%a%a%a%a)$")
  return { version = version, locale = locale, kind = f[3], id = un(f[4]), part = un(f[5]), speaker = un(f[6]),
    player = un(f[7]), text = un(f[8]) }
end

-- The link a Contribute button gives for a line: the page's address with the code, or (a code too long for a link)
-- the page's address alone, and false.
function Capture.Link(line)
  local code = Capture.Code(line)
  if #code > MAX_CODE then return SITE, false end
  return SITE .. "#c=" .. urlEncode(code), true
end

-- The lines on screen ------------------------------------------------------------------------------------------------------

local function speakerOf(unit)
  local who = ns.Giver and ns.Giver.last
  local kind, id = ns.Giver.ParseGUID(call(_G.UnitGUID, unit))
  if who and kind and who.kind == kind and who.id == id then return who end
  if kind == "object" then return { kind = "object", id = id } end
  if kind == "npc" then
    return { kind = "npc", id = id, name = call(_G.UnitName, unit), sex = call(_G.UnitSex, unit),
      ctype = call(_G.UnitCreatureType, unit) }
  end
end

local function shareable(line)
  local c = db()
  if not (line and c) then return nil end
  if c.sent[line.key] or c.copied[line.key] then return nil end
  return line
end

-- The quest window's page (part: detail, progress or complete), when Lore Forever lacks its text.
function Capture.QuestLine(part)
  local id = call(_G.GetQuestID)
  local raw = QUEST_TEXT[part] and call(_G[QUEST_TEXT[part]])
  if type(id) ~= "number" or id <= 0 or not usable(raw) or Capture.Ships("quest", id, part, raw) then return nil end
  return shareable({ kind = "quest", id = id, part = part, text = Capture.Placeholders(raw), speaker = speakerOf("npc"),
    player = Capture.PlayerTag(), key = "quest:" .. id .. "#" .. part, label = call(_G.GetTitleText) })
end

function Capture.GossipLine()
  local name = call(_G.UnitName, "npc")
  if not usable(name) or call(_G.UnitIsPlayer, "npc") then return nil end
  local G = _G.C_GossipInfo
  local raw = (G and call(G.GetText)) or call(_G.GetGossipText)
  if not usable(raw) then return nil end
  local text = Capture.Placeholders(raw)
  local kind, id = ns.Giver.ParseGUID(call(_G.UnitGUID, "npc"))
  return shareable({ kind = "gossip", id = kind == "npc" and id or ("n:" .. name), part = hash(text), text = text,
    speaker = speakerOf("npc") or { name = name }, player = Capture.PlayerTag(), key = "gossip:" .. name .. "#" .. hash(text),
    label = name })
end

function Capture.BookLine()
  local title = call(_G.ItemTextGetItem)
  if not usable(title) or call(_G.ItemTextGetCreator) then return nil end   -- a letter a player wrote
  local raw, page = call(_G.ItemTextGetText), tonumber(call(_G.ItemTextGetPage)) or 1
  if not usable(raw) then return nil end
  title = ns.Log.ScrubName(title)   -- the key texts.books has it under (Journey.lua)
  return shareable({ kind = "book", id = title, part = page, text = Capture.Placeholders(raw),
    player = Capture.PlayerTag(), key = "book:" .. title .. "#" .. page, label = title })
end

-- The quest log's selected quest (its description), when Lore Forever lacks it.
function Capture.QuestLogLine(questID)
  local QL = _G.C_QuestLog
  if not questID and QL and QL.GetSelectedQuest then questID = call(QL.GetSelectedQuest) end
  if type(questID) ~= "number" or questID <= 0 or not _G.GetQuestLogQuestText then return nil end
  local idx = QL and QL.GetLogIndexForQuestID and call(QL.GetLogIndexForQuestID, questID)
  local raw = call(GetQuestLogQuestText, idx)
  if not usable(raw) or Capture.Ships("quest", questID, "detail", raw) then return nil end
  local rec = LoreForeverDB.quests and LoreForeverDB.quests[questID]
  return shareable({ kind = "quest", id = questID, part = "detail", text = Capture.Placeholders(raw),
    speaker = rec and rec.starter, player = Capture.PlayerTag(), key = "quest:" .. questID .. "#detail",
    label = rec and rec.title })
end

-- Contribute buttons and the share window ----------------------------------------------------------------------------------

local buttons = {}   -- frame key -> button

local function tooltip(self)
  GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
  GameTooltip:AddLine(L["Share this text"])
  ns.Theme.Tip(L["Lore Forever doesn't have this text yet. Click for a link to share it at loreforeverwow.com, so it can go into an update."], "tipText", true)
  ns.Theme.Tip(L["Turn these buttons off in Options."], "tipDim", true)
  GameTooltip:Show()
end

local function button(parent, name)
  local b = CreateFrame("Button", name, parent)
  b:SetSize(16, 16)
  b:SetFrameLevel((parent:GetFrameLevel() or 1) + 6)
  local tex = b:CreateTexture(nil, "ARTWORK")
  tex:SetAllPoints()
  if ns.Theme.HasTexture(ICON) then
    tex:SetTexture(ICON)
    tex:SetTexCoord(0.08, 0.92, 0.08, 0.92)
  else
    ns.Theme.Fill(tex, "gold")
  end
  b.icon = tex
  b:SetHighlightTexture("Interface\\Buttons\\ButtonHilight-Square", "ADD")
  b:SetScript("OnEnter", tooltip)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  b:SetScript("OnClick", function(self) if self.line then Capture.Share(self.line) end end)
  b:Hide()
  return b
end

-- Beside what the add-on already put in that frame's top right corner, or in the corner itself.
local function place(b, parent, ...)
  local beside
  for i = 1, select("#", ...) do
    local o = select(i, ...)
    if o and o.IsShown and o:IsShown() then beside = o break end
  end
  if b.placed and b.beside == beside then return end   -- the book button relabels twice a second: no need to move
  b.placed, b.beside = true, beside
  b:ClearAllPoints()
  if beside then b:SetPoint("RIGHT", beside, "LEFT", -4, 0) else b:SetPoint("TOPRIGHT", parent, "TOPRIGHT", -30, -32) end
end

local function show(key, line, force)
  local b = buttons[key]
  if not b then return end
  b.line = (force or Capture.ButtonsOn()) and line or nil
  b:SetShown(b.line ~= nil)
end

function Capture.PlaceQuest()
  local b = buttons.quest
  if b then place(b, QuestFrame, ns.Hooks.questDialogPlay, ns.Hooks.questDialogButton) end
end

function Capture.PlaceBook()
  local b = buttons.book
  if b then place(b, ItemTextFrame, ns.Hooks.bookButton) end
end

-- The buttons, made the first time they're needed; their places follow the Lore and play buttons (Hooks.lua).
local hooked
function Capture.Hook()
  if hooked or not ns.Hooks then return end
  hooked = true
  local H = ns.Hooks
  local function after(name, fn)
    local orig = H[name]
    if type(orig) ~= "function" then return end
    H[name] = function(...)
      local r = { orig(...) }
      pcall(fn, ...)
      return unpack(r)
    end
  end
  after("UpdateQuestPlayButton", Capture.PlaceQuest)
  after("UpdateBookButton", Capture.PlaceBook)
  after("UpdateQuestLogButton", function(questID) Capture.UpdateQuestLog(questID) end)
end

local function make(key)
  if buttons[key] then return buttons[key] end
  if key == "quest" and _G.QuestFrame then
    buttons.quest = button(QuestFrame, "LoreForeverContributeQuest")
    Capture.PlaceQuest()
  elseif key == "gossip" and _G.GossipFrame then
    buttons.gossip = button(GossipFrame, "LoreForeverContributeGossip")
    buttons.gossip:SetPoint("TOPRIGHT", GossipFrame, "TOPRIGHT", -30, -32)
  elseif key == "book" and _G.ItemTextFrame then
    buttons.book = button(ItemTextFrame, "LoreForeverContributeBook")
    Capture.PlaceBook()
  elseif key == "log" then
    local parent = (_G.QuestMapFrame and QuestMapFrame.DetailsFrame) or _G.QuestLogFrame
    if parent then
      buttons.log = button(parent, "LoreForeverContributeLog")
      buttons.log.parent = parent
    end
  end
  return buttons[key]
end
Capture.buttons = buttons

Capture.questPart = nil
function Capture.UpdateQuest(part)
  Capture.questPart = part or Capture.questPart
  make("quest")
  show("quest", Capture.questPart and Capture.QuestLine(Capture.questPart))
  Capture.PlaceQuest()
end

function Capture.UpdateGossip()
  make("gossip")
  show("gossip", Capture.GossipLine())
end

function Capture.UpdateBook()
  make("book")
  show("book", Capture.BookLine())
  Capture.PlaceBook()
end

function Capture.UpdateQuestLog(questID)
  local b = make("log")
  if not b then return end
  if not (b.parent.IsShown and b.parent:IsShown()) then return show("log", nil) end   -- the log is closed
  show("log", Capture.QuestLogLine(questID))
  local lore = ns.Hooks.questLogButton
  b:ClearAllPoints()
  if lore and lore:IsShown() then
    b:SetPoint("RIGHT", lore, "LEFT", -4, 0)
  elseif _G.QuestMapFrame and b.parent == QuestMapFrame.DetailsFrame then
    b:SetPoint("TOPRIGHT", b.parent, "TOPRIGHT", -8, 26)
  else
    b:SetPoint("TOPRIGHT", b.parent, "TOPRIGHT", -40, -46)
  end
end

-- For /lf qa (and previews): a frame's button ("quest", "gossip", "book", "log") on show for `line` whatever Options
-- say, or (no line) taken away again. Returns the button, or nil when the client has no such frame.
function Capture.TestButton(key, line)
  local b = make(key)
  if not b then return nil end
  show(key, line, true)
  if key == "quest" then Capture.PlaceQuest() elseif key == "book" then Capture.PlaceBook() end
  return b
end

-- After Options or "Mark all as sent": each button for what's on screen now.
function Capture.UpdateAll()
  if _G.QuestFrame and QuestFrame:IsShown() then Capture.UpdateQuest() else show("quest", nil) end
  if _G.GossipFrame and GossipFrame:IsShown() then Capture.UpdateGossip() else show("gossip", nil) end
  if _G.ItemTextFrame and ItemTextFrame:IsShown() then Capture.UpdateBook() else show("book", nil) end
  if buttons.log then Capture.UpdateQuestLog() end
end

-- What a line is, in the share window (looked up when shown, after the language pack has loaded).
local function what(kind) return ({ quest = L["Quest"], gossip = L["Gossip"], book = L["Book"] })[kind] or "" end

local function shareWindow()
  if Capture.window then return Capture.window end
  local T = ns.Theme
  local f = T.Window("LoreForeverShare", UIParent, "Lore Forever")
  f:SetSize(440, 236)
  f:SetPoint("CENTER")
  f:SetFrameStrata("DIALOG")
  f:SetMovable(true)
  f:EnableMouse(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", f.StartMoving)
  f:SetScript("OnDragStop", f.StopMovingOrSizing)
  table.insert(UISpecialFrames, "LoreForeverShare")
  local title = f:CreateFontString(nil, "OVERLAY", T.font.heading)
  title:SetPoint("TOPLEFT", 16, -32)
  title:SetText(L["Share this text with Lore Forever"])
  local what = T.Muted(f:CreateFontString(nil, "OVERLAY", T.font.small))
  what:SetPoint("TOPLEFT", 16, -54)
  what:SetWidth(408)
  what:SetJustifyH("LEFT")
  if what.SetWordWrap then what:SetWordWrap(false) end
  local hint = f:CreateFontString(nil, "OVERLAY", T.font.small)
  hint:SetPoint("TOPLEFT", 16, -76)
  hint:SetWidth(408)
  hint:SetJustifyH("LEFT")
  local link = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
  link:SetSize(396, 22)
  link:SetPoint("TOPLEFT", 22, -160)
  link:SetAutoFocus(false)
  if link.SetMaxLetters then link:SetMaxLetters(0) end
  if link.SetFontObject and _G.ChatFontNormal then link:SetFontObject(ChatFontNormal) end
  -- The link can't be edited: typing puts it back, so a stray key never breaks the code.
  local function fill()
    link:SetText(f.link or "")
    link:SetCursorPosition(0)
    link:HighlightText()
  end
  link:SetScript("OnTextChanged", function(_, userInput) if userInput then fill() end end)
  link:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
  link:SetScript("OnEscapePressed", function() f:Hide() end)
  link:SetScript("OnShow", fill)
  local done = T.Button(f, L["Done"])
  done:SetSize(90, 24)
  done:SetPoint("TOPLEFT", 16, -194)
  done:SetScript("OnClick", function() f:Hide() end)
  f.what, f.hint, f.linkBox, f.fill, f.done = what, hint, link, fill, done
  Capture.window = f
  return f
end

-- The share window for a line: its link, selected, ready for Ctrl+C. The button then hides for that line (no asking
-- twice); the line still goes with a file upload.
function Capture.Share(line)
  local f = shareWindow()
  local link, whole = Capture.Link(line)
  f.link, f.line = link, line
  local preview = (line.text or ""):gsub("%s+", " ")
  f.what:SetText(what(line.kind) .. (line.label and (": " .. line.label) or "")
    .. " - " .. preview:sub(1, 80))
  f.hint:SetText(whole
    and L["Press Ctrl+C to copy this link, then paste it into your browser and press Send there. It carries the text, which quest, NPC or book it's from, and your character's race, class and gender, never your character's name."]
    or L["This text is too long for a link. It's kept in your LoreForever.lua: type /reload, then share the file at this address."])
  f:Show()
  f.fill()   -- again once shown: the Forever client drops text set on a box that isn't visible yet (see Options)
  f.linkBox:SetFocus()
  local c = db()
  if c and line.key then c.copied[line.key] = true end
  Capture.UpdateAll()
  return link
end

-- Events --------------------------------------------------------------------------------------------------------------------

local frame = CreateFrame("Frame")
Capture.frame = frame
for _, e in ipairs({ "CHAT_MSG_MONSTER_SAY", "CHAT_MSG_MONSTER_YELL", "QUEST_DETAIL", "QUEST_PROGRESS", "QUEST_COMPLETE",
  "GOSSIP_SHOW", "ITEM_TEXT_READY" }) do
  pcall(frame.RegisterEvent, frame, e)
end
local PARTS = { QUEST_DETAIL = "detail", QUEST_PROGRESS = "progress", QUEST_COMPLETE = "complete" }
frame:SetScript("OnEvent", function(_, event, ...)
  if not db() then return end   -- before login
  if SAY_KIND[event] then
    pcall(Capture.OnSay, event, ...)
  elseif PARTS[event] then
    pcall(Capture.UpdateQuest, PARTS[event])
  elseif event == "GOSSIP_SHOW" then
    pcall(Capture.UpdateGossip)
  elseif event == "ITEM_TEXT_READY" then
    pcall(Capture.UpdateBook)
  end
end)
