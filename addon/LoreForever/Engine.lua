-- Offline lore engine: ranks the prebuilt lore entries against a question and the player's context.
-- Pure Lua 5.1 with no WoW API calls, so the eval harness can run this exact file outside the game.

local _, ns = ...
ns = ns or {}

local Engine = {}
Engine.__index = Engine

local STOP = {}
for w in ([[a an the of to in on at for from by with about and or but is are was were be been being am do does did
  doing has have had having i me my mine we our you your he him his she her it its they them their this that these
  those there here what whats which who whos whom whose why how when where can could would should will shall may
  might must just so than then too very really tell know explain story lore deal anything something some any
  more much many please want wanna like get got going go s t im ive thats hey okay ok well also whats
  wait lol um uh hmm actually guys dude bro yeah yea anyway kinda sorta basically literally mean guy stuff
  thing things]]):gmatch("%a+") do
  STOP[w] = true
end

-- Language packs add their own stop words, lowercased the same way as questions.
function Engine.AddStopWords(text)
  for w in Engine.lower(text or ""):gmatch("[%w\128-\255]+") do STOP[w] = true end
end

-- Words that point back at something: the current target for people, the last answer otherwise.
local PRONOUN = { he = true, him = true, his = true, she = true, her = true, they = true, them = true,
  their = true, it = true, this = true, that = true, there = true, these = true, those = true }
local PERSON = { he = true, him = true, his = true, she = true, her = true, guy = true, npc = true }

-- Situational questions, recognized by their wording before stop words are dropped ("how did I get here?" is nothing
-- but stop words). Each names FAQ intents (tagged by pipeline/lore/questions.py) and where the answer lives: the
-- place the player is in, the quest in front of them, the subject (the creature, person or item the question names,
-- else the target) or the player themselves. Words come from tokenize, so "what's" reads "what". First match wins,
-- so the more specific phrases come first.
local INTENT_PHRASES = {
  { "arrival", "place", { "how did i get", "how did i end up", "how i got here", "how did i arrive", "how did i come",
    "start here", "starting here", "started here", "why do i start", "why did i start", "where did i come from" } },
  { "purpose", "place", { "what am i doing", "what am i supposed", "what am i meant", "what am i here for",
    "why am i here", "why am i in", "what should i be doing", "what do i do here", "what my purpose",
    "what is my purpose", "what my role", "what is my role" } },
  { "place", "place", { "what is this place", "what this place", "what place is this", "where am i",
    "what is this town", "what this town", "what is this village", "what this village", "what is this camp",
    "what this camp", "what is this area", "what this area" } },
  { "leader", "subject", { "who leads them", "who is their leader", "who their leader", "who is in charge of them",
    "who their boss", "who is their boss", "who commands them" } },
  { "history", "place", { "what happened here", "what happened to this place", "what happened to this town",
    "history of this place", "history here", "what is the history here" } },
  { "ruin", "place", { "why is this place ruined", "why is it ruined", "why is this ruined", "why is this abandoned",
    "why is it abandoned", "why is this place abandoned", "why is everything destroyed", "why is this place destroyed",
    "why is this town empty", "why is it so empty" } },
  { "residents", "place", { "who lives here", "who lived here" } },
  { "danger", "place", { "is it safe here", "is this place safe", "is this place dangerous", "is it dangerous here",
    "is this area dangerous", "is this area safe" } },
  { "name", "place", { "why is it called", "why is this place called", "why is this called", "where does the name",
    "where did the name", "what does the name" } },
  { "in_charge", "place", { "in charge", "who runs", "who leads here", "who rules here", "who the boss",
    "who is the boss", "who commands here" } },
  { "self_race", "self", { "my race", "my people", "my kind", "my ancestors", "my kin" } },
  { "self_class", "self", { "my class", "my powers", "my power", "my magic", "my abilities", "my spells",
    "why can i use", "how can i use" } },
  { "self_faction", "self", { "why do we fight", "why are we fighting", "why are we at war", "why do we hate",
    "my faction" } },
  { "hostile", "subject", { "why are they attacking", "why is he attacking", "why is she attacking",
    "why is it attacking", "attacking me", "attacking us", "why are they hostile", "why is he hostile",
    "why are they aggressive", "why do they hate", "why are they angry" } },
  { "allies", "subject", { "allied with", "working with", "working for", "who are they with", "their allies" } },
  { "side", "subject", { "whose side", "which side", "is he friendly", "is she friendly", "are they friendly",
    "is he an enemy", "is she an enemy", "are they enemies", "can i trust", "friend or foe", "good guy", "bad guy" } },
  { "wants", "subject", { "what does he want", "what does she want", "what do they want" } },
  { "why_here", "subject", { "why is he here", "why is she here", "why are they here", "why are these here",
    "what are they doing here", "what is he doing here", "what is she doing here" } },
  { "fame", "subject", { "why is he famous", "why is she famous", "why is he feared", "why is she feared",
    "why is everyone afraid", "why is he so famous", "why is he so feared" } },
  { "origin", "subject", { "where does this come from", "where did this come from", "who made this",
    "where do these come from" } },
  { "identity", "subject", { "who is this", "who this", "who is that", "who is he", "who is she", "what is this thing",
    "what are these", "what are those", "what is that thing", "lore for", "lore on", "lore of", "lore about",
    "tell me about", "history of", "story of", "story behind" } },
  { "why_me", "quest", { "why me", "why cant he", "why cant she", "why cant they", "why dont they", "why doesnt he",
    "why doesnt she", "why cant the guards", "do it himself", "do it herself", "do it themselves" } },
  { "motive", "quest", { "why do i have to", "why do i need to", "why should i", "what the point", "what is the point",
    "why am i killing", "why am i collecting", "why am i hunting", "why am i fetching", "why am i gathering" } },
}
local WANT = { want = true, wants = true, wanted = true, need = true, needs = true }
-- Intents to look for, in order, for each recognized intent.
local INTENT_FAQ = { arrival = { "arrival", "purpose" }, purpose = { "purpose", "arrival" }, place = { "place" },
  in_charge = { "in_charge", "residents" }, motive = { "motive" }, item = { "item", "motive" },
  why_me = { "why_me", "motive" }, threat = { "threat" }, history = { "history", "ruin" }, ruin = { "ruin", "history" },
  residents = { "residents", "in_charge" }, danger = { "danger", "threat" }, name = { "name" },
  identity = { "identity" }, hostile = { "hostile", "threat" }, leader = { "leader" }, allies = { "allies" },
  side = { "side" }, wants = { "wants", "motive" }, why_here = { "why_here" }, fame = { "fame" },
  origin = { "origin" }, self_race = { "for_you", "identity", "today" }, self_class = { "power", "for_you", "identity" },
  self_faction = { "conflict", "identity" } }
-- Where to look next when the subject has no such answer: "why are they attacking?" with nothing targeted is about
-- the place's threats; "what does he want?" about the quest.
local INTENT_FALLBACK = { hostile = { "threat", "place" }, why_here = { "threat", "place" },
  wants = { "motive", "quest" } }
-- Order FAQs are offered in: the situational and core questions first. Untagged FAQs keep their order after these.
local INTENT_RANK = { arrival = 1, purpose = 2, motive = 1, item = 2, why_me = 3, place = 3, in_charge = 4,
  target = 4, threat = 5, people = 6, history = 6, next_step = 7, identity = 2, for_you = 2, conflict = 2, power = 3,
  wants = 3, hostile = 3, fame = 3, origin = 3, why_wanted = 3, side = 4, why_here = 4, today = 4, leader = 5,
  allies = 5, residents = 5, ruin = 5, danger = 6, ties = 6, name = 7 }
-- The player's own race, class and faction -> their lore topics ("my people", "why do we fight the Horde?").
local SELF_TOPIC = {
  self_race = function(ctx)
    local r = ctx.race and Engine.lower(ctx.race)
    local map = { human = "human", dwarf = "dwarf", gnome = "gnome", nightelf = "night-elf", orc = "orc",
      troll = "troll", tauren = "tauren", undead = "forsaken", scourge = "forsaken", skyborne = "skyborne" }
    return r and map[r] and "topic:" .. map[r]
  end,
  self_class = function(ctx) return ctx.class and "topic:" .. Engine.lower(ctx.class) end,
  self_faction = function(ctx) return ctx.faction and "topic:" .. Engine.lower(ctx.faction) end,
}

-- lower() that also folds accented Latin capitals (U+00C0-00DE) and Cyrillic capitals (U+0400-042F) in UTF-8.
function Engine.lower(s)
  s = (s or ""):lower()
  if not s:find("[\195\208]") then return s end
  s = s:gsub("\195([\128-\158])", function(c)
    local b = c:byte()
    if b ~= 0x97 then return "\195" .. string.char(b + 32) end   -- not the multiplication sign
  end)
  return (s:gsub("\208([\128-\175])", function(c)
    local b = c:byte()
    if b < 0x90 then return "\209" .. string.char(b + 0x10) end
    if b < 0xA0 then return "\208" .. string.char(b + 0x20) end
    return "\209" .. string.char(b - 0x20)
  end))
end

-- UTF-8 punctuation (the general punctuation block: dashes, curly quotes, zero-width space; and Latin-1 symbols such
-- as the non-breaking space, guillemets and inverted marks, plus × and ÷) becomes a space; every other non-ASCII byte
-- is a letter.
local function unpunct(s)
  if not s:find("[\194\195\226]") then return s end
  return (s:gsub("\226[\128\129][\128-\191]", " "):gsub("\194[\160-\191]", " "):gsub("\195[\151\183]", " "))
end

local function stem(w)
  if #w > 4 then
    w = w:gsub("ies$", "y"):gsub("([^s])s$", "%1")
  end
  return w
end

local function tokenize(text, keepStop, noBigrams)
  local out, raw = {}, {}
  text = unpunct(Engine.lower(text)):gsub("'s%f[%A]", ""):gsub("'", ""):gsub("[^%w%s\128-\255]", " ")
  for w in text:gmatch("[%w\128-\255]+") do
    raw[#raw + 1] = w
    if keepStop or not STOP[w] then
      out[#out + 1] = stem(w)
    end
  end
  -- Joined bigrams catch "van cleef" -> "vancleef", "sentinel hill" -> "sentinelhill".
  for i = 1, noBigrams and 0 or #raw - 1 do
    if not STOP[raw[i]] and not STOP[raw[i + 1]] then
      out[#out + 1] = raw[i] .. raw[i + 1]
    end
  end
  return out, raw
end
Engine.tokenize = tokenize

local function counts(tokens)
  local c = {}
  for _, t in ipairs(tokens) do c[t] = (c[t] or 0) + 1 end
  return c
end

-- Levenshtein distance, giving up (returning max+1) once it can't come in at or under `max`.
local function editDistance(a, b, max)
  local la, lb = #a, #b
  if math.abs(la - lb) > max then return max + 1 end
  local prev, cur = {}, {}
  for j = 0, lb do prev[j] = j end
  for i = 1, la do
    cur[0] = i
    local best = i
    local ca = a:byte(i)
    for j = 1, lb do
      local cost = (ca == b:byte(j)) and 0 or 1
      local v = math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      cur[j] = v
      if v < best then best = v end
    end
    if best > max then return max + 1 end
    prev, cur = cur, prev
  end
  return prev[lb]
end
Engine.editDistance = editDistance


-- Packed search index -------------------------------------------------------------------------------------------
-- BM25 postings kept as base-64 strings instead of Lua tables: about a tenth of the memory, and nothing to build at
-- login. pipeline/lore/compile_lua.py runs BuildSearch (this file's own tokenizer, under lupa) and writes the result
-- to Data/Search_*.lua; if those files are missing, Engine.new builds it here instead.
--   docs:       7 chars per doc: entry number (3), kind (1: 0 summary, 1 faq, 2 section), idx (1), length (2)
--   entryDocs:  4 chars per entry: first doc (3), doc count (1)
--   post[t]:    4 chars per doc containing token t: doc number (3), term frequency (1)

local ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local B64 = {}
for i = 1, 64 do B64[ALPHA:byte(i)] = i - 1 end
local KIND = { [0] = "summary", [1] = "faq", [2] = "section" }
local KIND_WEIGHT = { [0] = 0.75, [1] = 1.0, [2] = 0.6 }

-- Ask() ranking knobs (fields, so the eval harness can vary them).
-- Score multiplier by entry type, for entries the player's context doesn't point at.
Engine.TYPE_PRIOR = { topic = 1.0, zone = 1.0, city = 1.0, dungeon = 1.0, npc = 0.9, subzone = 0.75, quest = 0.7,
  item = 0.7 }
-- Added per unit of (share of the entry's title words in the question x their idf). The eval plateaus from 4 to 6.
Engine.TITLE_BONUS = 5.0
-- Entries the player's context points at get their score multiplied by 1 + weight x this (weight 0.3 to 1.1).
Engine.CTX_BOOST = 1.0
-- A title word counts fully once this share of its docs belong to entries it names (see NameShare).
Engine.NAME_SHARE_FULL = 0.5
-- The FAQ that answers a situational question ("why does he want this?") scores x1.3 plus this. Vague questions score
-- under ~25, so this decides them; a question that names something else scores far higher and goes by its words.
Engine.INTENT_BONUS = 12
-- An entry named like one in the player's zone ("Canals" in the Undercity, asked in Stormwind) scores x this.
Engine.ELSEWHERE = 0.5

local function enc(n, width)
  local t = {}
  for i = width, 1, -1 do
    local d = n % 64
    t[i] = ALPHA:sub(d + 1, d + 1)
    n = (n - d) / 64
  end
  return table.concat(t)
end

local function dec(s, p, width)
  local n = 0
  for i = p, p + width - 1 do n = n * 64 + B64[s:byte(i)] end
  return n
end

-- The texts an entry is searched by: {kind, idx, head, body}. Heads (names, questions, aliases, titles) also get
-- joined bigrams; bodies only single words, since body bigrams are nearly all unique and would bloat the index.
function Engine.DocTexts(e)
  local out = { { 0, 0, e.n .. " " .. e.n .. " " .. table.concat(e.kw or {}, " "), e.s } }
  for i, f in ipairs(e.faq or {}) do
    -- Question and aliases count double; the answer text adds vocabulary the question lacks.
    local qa = f.q .. " " .. table.concat(f.al or {}, " ")
    out[#out + 1] = { 1, i, qa .. " " .. qa .. " " .. e.n, f.a }
  end
  for i, sec in ipairs(e.sec or {}) do
    out[#out + 1] = { 2, i, sec.t, sec.b }
  end
  return out
end

function Engine.BuildSearch(db)
  local keys = {}
  for k in pairs(db.entries) do keys[#keys + 1] = k end
  table.sort(keys)
  local docs, entryDocs, lists, total, n = {}, {}, {}, 0, 0
  for ki, key in ipairs(keys) do
    local first = n + 1
    for _, d in ipairs(Engine.DocTexts(db.entries[key])) do
      n = n + 1
      local toks = tokenize(d[3])
      for _, w in ipairs((tokenize(d[4], false, true))) do toks[#toks + 1] = w end
      total = total + #toks
      docs[n] = enc(ki, 3) .. enc(d[1], 1) .. enc(math.min(d[2], 63), 1) .. enc(math.min(#toks, 4095), 2)
      local dn = enc(n, 3)
      for t, f in pairs(counts(toks)) do
        local l = lists[t]
        if not l then l = {}; lists[t] = l end
        l[#l + 1] = dn .. enc(math.min(f, 63), 1)
      end
    end
    entryDocs[ki] = enc(first, 3) .. enc(n - first + 1, 1)
  end
  local post = {}
  for t, l in pairs(lists) do post[t] = table.concat(l) end
  return { keys = keys, docs = table.concat(docs), entryDocs = table.concat(entryDocs), post = post, N = n,
    avgLen = total / math.max(1, n) }
end

function Engine.new(db)
  local self = setmetatable({ db = db, nameIndex = {}, titleIndex = {}, titleLen = {}, keyId = {}, lastKey = nil,
    asked = {} }, Engine)
  db.search = db.search or Engine.BuildSearch(db)
  local s = db.search
  self.search, self.post, self.N, self.avgLen = s, s.post, s.N, s.avgLen
  for i, k in ipairs(s.keys) do self.keyId[k] = i end
  for key, e in pairs(db.entries) do self:IndexNames(key, e) end
  -- Entries that share their name with one in another zone ("Canals (Stormwind City)", "Canals (Undercity)"), so Ask
  -- can tell them apart by zone. Zones themselves are left out: the city Undercity isn't a namesake of its entrance.
  local groups, groupOf = {}, {}
  for key, e in pairs(db.entries) do
    if e.z and e.t ~= "zone" and e.t ~= "city" and e.t ~= "dungeon" then
      local name = Engine.lower((e.n:gsub("%b()", ""))):match("^%s*(.-)%s*$")
      local g = groups[name]
      if not g then g = { name = name, zones = {}, n = 0 }; groups[name] = g end
      if not g.zones[e.z] then g.zones[e.z], g.n = true, g.n + 1 end
      groupOf[key] = g
    end
  end
  self.namesakes = {}
  for key, g in pairs(groupOf) do
    if g.n > 1 then self.namesakes[key] = g end
  end
  -- Quests by giver, for "why does this guy want me to do this?" before the quest is in the log.
  self.giverQuests = {}
  for key, e in pairs(db.entries) do
    if e.t == "quest" and e.m and e.m.start then
      local g = Engine.lower(e.m.start)
      self.giverQuests[g] = self.giverQuests[g] or {}
      table.insert(self.giverQuests[g], key)
    end
  end
  for _, list in pairs(self.giverQuests) do table.sort(list) end
  -- Single-word name vocabulary, for typo-tolerant name matching.
  local vocab = {}
  for t in pairs(self.nameIndex) do
    if #t >= 4 and not t:find("%d") then vocab[#vocab + 1] = t end
  end
  table.sort(vocab)
  self.nameVocab = vocab
  self.built = true
  return self
end

-- Entity name tokens -> key, for detecting which entity a question is about.
function Engine:IndexNames(key, e)
  local bare = e.n:gsub("%b()", "")
  local nameToks = tokenize(bare)
  -- Title words without joined bigrams, so "VanCleef" alone covers half of "Edwin VanCleef", not a third. A question
  -- written "van cleef" still matches a one-word title through its own joined bigram.
  self.titleLen[key] = 0
  for _, t in ipairs((tokenize(bare, false, true))) do
    local list = self.titleIndex[t]
    if not list then list = {}; self.titleIndex[t] = list end
    if not list[key] then self.titleLen[key] = self.titleLen[key] + 1 end
    list[key] = true
  end
  for _, kw in ipairs(e.kw or {}) do
    for _, t in ipairs(tokenize(kw)) do nameToks[#nameToks + 1] = t end
  end
  for _, t in ipairs(nameToks) do
    local list = self.nameIndex[t]
    if not list then list = { n = 0 }; self.nameIndex[t] = list end
    if not list[key] then list[key] = true; list.n = list.n + 1 end
  end
end

-- key, kind (0/1/2), idx, length of doc number di.
function Engine:Doc(di)
  local s, p = self.search.docs, (di - 1) * 7 + 1
  return self.search.keys[dec(s, p, 3)], dec(s, p + 3, 1), dec(s, p + 4, 1), dec(s, p + 5, 2)
end

-- First doc number and doc count for an entry.
function Engine:EntryDocs(key)
  local ki = self.keyId[key]
  if not ki then return 1, 0 end
  local s, p = self.search.entryDocs, (ki - 1) * 4 + 1
  return dec(s, p, 3), dec(s, p + 3, 1)
end

function Engine:df(t)
  local pl = self.post[t]
  return pl and #pl / 4 or 0
end

function Engine:idf(t)
  local df = self:df(t)
  return math.log(1 + (self.N - df + 0.5) / (df + 0.5))
end

-- Share of the docs containing word t that belong to entries named or keyworded by it. Near 1 for names ("vancleef",
-- "hogger", "defias"), near 0 for ordinary words that happen to start a title ("mad" in Mad Magus Tirth, "dead" in
-- Dead Acre). One pass over t's postings; only asked for words that appear in some title.
function Engine:NameShare(t)
  local pl, names = self.post[t], self.nameIndex[t]
  if not (pl and names) then return 0 end
  local docs, keys, hits = self.search.docs, self.search.keys, 0
  for p = 1, #pl, 4 do
    if names[keys[dec(docs, (dec(pl, p, 3) - 1) * 7 + 1, 3)]] then hits = hits + 1 end
  end
  return hits / (#pl / 4)
end

-- The question/answer text a doc stands for.
function Engine:DocText(key, kind, idx)
  local e = self.db.entries[key]
  if kind == 1 then
    local f = e.faq[idx]
    return f.q, f.a
  elseif kind == 2 then
    local sec = e.sec[idx]
    return e.n .. ": " .. sec.t, sec.b
  end
  return e.n, e.s
end

-- Entry key for a name seen in the game (NPC, zone, or a mob named after a lore topic).
function Engine:KeyForName(name)
  if not name or name == "" then return nil end
  local idx = self.db.index
  local lower = Engine.lower(name)
  local k = idx.name[lower]
  if k then return k, "exact" end
  -- "Deputy Willem", "Captain Danuvin": the person's entry may be under the name without the title.
  local rest = lower:match("^%S+ (.+)$")
  k = rest and idx.name[rest]
  if k and k:find("^npc:") then return k, "exact" end
  if idx.mob then
    for w in lower:gmatch("[%a'\128-\255]+") do
      local m = idx.mob[w] or idx.mob[w:gsub("s$", "")]
      if m then return m, "mob" end
    end
  end
  return nil
end

-- Zone key ("deadmines") for an in-game zone name.
function Engine:ZoneKey(zoneName)
  return zoneName and self.db.index.zone and self.db.index.zone[Engine.lower(zoneName)] or nil
end

-- Zones a question names by their in-game names or short forms ("stormwind", "the barrens"): {name, zone key} each.
function Engine:ZonesNamed(raw)
  if not self.zoneNames then
    self.zoneNames = {}
    for name, z in pairs(self.db.index.zone or {}) do
      local _, w = tokenize(name)
      self.zoneNames[#self.zoneNames + 1] = { " " .. table.concat(w, " ") .. " ", z }
    end
  end
  local s, out = " " .. table.concat(raw, " ") .. " ", {}
  for _, zn in ipairs(self.zoneNames) do
    if s:find(zn[1], 1, true) then out[#out + 1] = zn end
  end
  return out
end

-- Entries relevant to the player's current situation, most specific first.
function Engine:ContextKeys(ctx)
  local db, keys, seen = self.db, {}, {}
  local function add(k, w)
    if k and db.entries[k] and not seen[k] then
      seen[k] = w
      keys[#keys + 1] = k
    end
  end
  ctx = ctx or {}
  local function questKey(q)
    return db.index.quest[q.id] or (q.title and db.index.questTitle and db.index.questTitle[Engine.lower(q.title)])
  end
  if ctx.targetName then add(self:KeyForName(ctx.targetName), 1.1) end
  for _, q in ipairs(ctx.quests or {}) do add(questKey(q), 1.0) end
  if ctx.subzone then
    local sub = Engine.lower(ctx.subzone)
    add(db.index.name[sub] or db.index.name[(sub:gsub("^the ", ""))], 0.9)   -- "The Crossroads" is "Crossroads"
    add(db.index.area and db.index.area[Engine.lower(ctx.subzone)], 0.85)   -- Northshire Abbey -> Northshire Valley
  end
  local zk = self:ZoneKey(ctx.zone)
  if zk then add("zone:" .. zk, 0.8) end
  if ctx.zone then add(db.index.name[Engine.lower(ctx.zone)], 0.8) end
  local z = zk and db.zones and db.zones[zk]
  if z and z.b then
    for _, b in ipairs(z.b) do add(b, 0.7) end
  end
  for _, q in ipairs(ctx.quests or {}) do
    local e = db.entries[questKey(q) or ""]
    if e and e.m then
      add(db.index.name[Engine.lower(e.m.start)], 0.6)
      add(db.index.name[Engine.lower(e.m["end"])], 0.6)
    end
  end
  local n = #keys
  -- Your journey (LOR-129): people you met this session, and quests you've finished in this zone. Their related
  -- entries aren't pulled in.
  for _, name in ipairs(ctx.met or {}) do
    local k, how = self:KeyForName(name)
    if how == "exact" then add(k, 0.5) end
  end
  if zk and ctx.done then
    for _, k in ipairs(self:ZoneQuests(zk)) do
      if self:Finished(k, ctx.done) then add(k, 0.4) end
    end
  end
  for i = 1, n do
    for _, r in ipairs(db.entries[keys[i]].rel or {}) do add(r, 0.3) end
  end
  return keys, seen
end

-- Quest entries set in zone `zk`, in key order (built once per zone).
function Engine:ZoneQuests(zk)
  self.zoneQuests = self.zoneQuests or {}
  local list = self.zoneQuests[zk]
  if not list then
    list = {}
    for key, e in pairs(self.db.entries) do
      if e.t == "quest" and e.z == zk then list[#list + 1] = key end
    end
    table.sort(list)
    self.zoneQuests[zk] = list
  end
  return list
end

-- Whether the character has finished quest entry `key`: one of its quest IDs (a quest can have one per faction) is
-- in `done`, the set of completed quest IDs (ctx.done).
function Engine:Finished(key, done)
  local e = done and key and self.db.entries[key]
  if not (e and e.t == "quest") then return false end
  if not self.questIds then
    self.questIds = {}
    for id, k in pairs(self.db.index.quest or {}) do
      self.questIds[k] = self.questIds[k] or {}
      table.insert(self.questIds[k], id)
    end
  end
  for _, id in ipairs(self.questIds[key] or {}) do
    if done[id] then return true end
  end
  return false
end

-- Replace unknown words with the closest entity-name word ("vancleaf" -> "vancleef").
function Engine:CorrectTokens(qtoks)
  local out, fixed = {}, {}
  for _, t in ipairs(qtoks) do
    if not self.post[t] and #t >= 5 and not t:find("%d") then
      local max = #t >= 8 and 2 or 1
      local best, bestD
      for _, v in ipairs(self.nameVocab or {}) do
        local d = editDistance(t, v, max)
        if d <= max and (not bestD or d < bestD) then best, bestD = v, d end
      end
      if best then
        out[#out + 1] = best
        fixed[#fixed + 1] = best
      else
        out[#out + 1] = t
      end
    else
      out[#out + 1] = t
    end
  end
  return out, fixed
end

-- Chat spellings, so "wat do i do here" and "whats this place" read like the phrases above.
local SPELLING = { wat = "what", wut = "what", whats = "what", whos = "who", wheres = "where", hes = "he", shes = "she",
  im = "i am", ur = "your", u = "you", r = "are", y = "why", dis = "this", da = "the", theyre = "they are" }

-- Which situational question this is, from the raw words: intent and scope ("place", "quest", "subject" or
-- "self"), or nil.
function Engine.Intent(raw)
  local words = {}
  for i, w in ipairs(raw) do words[i] = SPELLING[w] or w end
  local s = " " .. table.concat(words, " ") .. " "
  local first, last = s:match("^ (%S+)"), words[#words]
  -- "what is this for?", "what are these for?", "what am I fetching these for?"
  if first == "what" and last == "for" then return "item", "quest" end
  for _, p in ipairs(INTENT_PHRASES) do
    for _, ph in ipairs(p[3]) do
      if s:find(" " .. ph .. " ", 1, true) then return p[1], p[2] end
    end
  end
  if first == "why" or first == "what" then
    for _, w in ipairs(words) do
      if WANT[w] then return "motive", "quest" end
    end
  end
  return nil
end

-- A race-specific answer ("why is my troll starting in an orc camp?") is only offered to that race.
local function raceKey(r)
  return (Engine.lower(r):gsub("%s", ""):gsub("^scourge$", "undead"))
end
local function forRace(f, race)
  return not f.rc or not race or raceKey(f.rc) == raceKey(race)
end

-- Index of the first FAQ tagged with one of `intents` (in that order), the player's own race's version first,
-- skipping gameplay filler and spoilers (unless `open`: a quest you've finished).
local function taggedFaq(e, intents, race, open)
  for _, it in ipairs(intents) do
    local generic
    for i, f in ipairs(e.faq or {}) do
      if f.it == it and (open or not f.sp) and not f.gp and forRace(f, race) then
        if f.rc then return i end
        generic = generic or i
      end
    end
    if generic then return generic end
  end
end

-- The entry and FAQ (0 for the overview) that answer a situational question. Place questions go to the most specific
-- place the player is in that has an answer. Quest questions go to a quest whose item the question names, then one
-- whose items are in the bags or whose giver is targeted, then an active quest. Subject questions go to the entry
-- the question names (`namedKey`), else the target ("Riverpaw Gnoll" -> gnolls); self questions to the player's
-- own race, class or faction. With no answer there, INTENT_FALLBACK says where to look next.
function Engine:IntentTarget(intent, scope, ctx, raw, namedKey)
  local db, intents = self.db, INTENT_FAQ[intent]
  local keys, weight = self:ContextKeys(ctx)
  if scope == "subject" or scope == "self" then
    local k
    if scope == "self" then
      k = SELF_TOPIC[intent](ctx)
    else
      k = namedKey or (ctx.targetName and self:KeyForName(ctx.targetName))
    end
    local e = k and db.entries[k]
    -- The subject's own answer, else its overview ("who leads them?" about a creature whose leader isn't known).
    if e then return k, taggedFaq(e, intents, ctx.race, self:Finished(k, ctx.done)) or 0 end
    -- A target with no entry of its own (a young wolf): the question is still about it, so Ask searches by its name
    -- rather than answering about the place.
    if not e and scope == "subject" and not namedKey and ctx.targetName then return nil end
    local fb = INTENT_FALLBACK[intent]
    if fb then return self:IntentTarget(fb[1], fb[2], ctx, raw) end
    return nil
  end
  if scope == "place" then
    -- "Where does the name Defias come from?" is about the Defias, not the place the player stands in.
    local named = namedKey and db.entries[namedKey]
    local ni = named and taggedFaq(named, intents, ctx.race, self:Finished(namedKey, ctx.done))
    if ni then return namedKey, ni end
    for _, k in ipairs(keys) do
      local t = db.entries[k].t
      if weight[k] >= 0.8 and (t == "subzone" or t == "zone" or t == "city" or t == "dungeon") then
        local i = taggedFaq(db.entries[k], intents, ctx.race)
        -- "What is this place?", "what happened here?": the overview of the most specific place, when it has no
        -- such FAQ.
        if i or intent == "place" or intent == "history" then return k, i or 0 end
      end
    end
    return nil
  end
  local cands, score = {}, {}
  local function add(k, s)
    local e = db.entries[k]
    if e and e.t == "quest" then
      if not score[k] then cands[#cands + 1] = k end
      score[k] = (score[k] or 0) + s
    end
  end
  for _, k in ipairs(keys) do
    if weight[k] == 1.0 then add(k, 1) end   -- in the quest log
  end
  local target = ctx.targetName and Engine.lower(ctx.targetName)
  for _, k in ipairs(target and self.giverQuests[target] or {}) do add(k, 2) end
  local words, bags = {}, {}
  for _, w in ipairs(raw) do
    if #w >= 4 and not STOP[w] then words[stem(w)] = true end
  end
  for _, name in ipairs(ctx.questItems or {}) do bags[Engine.lower(name)] = true end
  for _, k in ipairs(cands) do
    local named, carried = false, false
    for _, item in ipairs(db.entries[k].m and db.entries[k].m.ri or {}) do
      for _, t in ipairs((tokenize(item, false, true))) do
        if words[t] then named = true end
      end
      if bags[Engine.lower(item)] then carried = true end
    end
    -- An item the question names beats one in the bags ("what are these for?" means what you're carrying).
    score[k] = score[k] + (named and 3 or 0) + (carried and 2 or 0)
  end
  table.sort(cands, function(a, b2)
    if score[a] ~= score[b2] then return score[a] > score[b2] end
    return a < b2
  end)
  for _, k in ipairs(cands) do
    local i = taggedFaq(db.entries[k], intents, ctx.race, self:Finished(k, ctx.done))
    if i then return k, i end
  end
end

-- Rank answer units. Returns up to `limit` results with distinct entries: {key, kind, idx, title, text, score}.
function Engine:Ask(question, ctx, limit)
  limit = limit or 3
  self.race = ctx and ctx.race or self.race   -- for FollowUps, which get no context
  local qtoks, raw = tokenize(question)
  qtoks = self:CorrectTokens(qtoks)
  local _, ctxWeight = self:ContextKeys(ctx)

  -- Which entities does the question name?
  local named = {}
  for _, t in ipairs(qtoks) do
    local list = self.nameIndex[t]
    if list then
      local w = self:idf(t) / list.n
      for k in pairs(list) do
        if k ~= "n" then named[k] = (named[k] or 0) + w end
      end
    end
  end
  -- Fraction of each entity's own name that the question contains ("stormwind" covers all of
  -- "Stormwind (kingdom)" but only half of "Stormwind City"), and that fraction weighted by how rare and how
  -- name-like each covered word is.
  local titled, titledIdf = {}, {}
  for t in pairs(counts(qtoks)) do
    local list = self.titleIndex[t]
    if list then
      local idf = self:idf(t) * math.min(1, self:NameShare(t) / self.NAME_SHARE_FULL)
      for k in pairs(list) do
        local len = math.max(1, self.titleLen[k])
        titled[k] = (titled[k] or 0) + 1 / len
        titledIdf[k] = (titledIdf[k] or 0) + idf / len
      end
    end
  end
  -- A name shared by entries in several zones ("Canals" in Stormwind and the Undercity), spelled out in the question:
  -- when the question also names one of their zones ("the canals of Stormwind"), the others are out; otherwise the
  -- player's own zone's comes first. A zone named in the shared name itself ("Messenger to Stormwind") doesn't count.
  -- The one the zone picks is then as good as pointed at by the player's situation (zonePicked), so the type prior
  -- doesn't hold it back.
  local here, zonesNamed, zoneFactor, zonePicked = ctx and self:ZoneKey(ctx.zone), nil, {}, {}
  local function inZone(key)
    local g = self.namesakes[key]
    if not g or (titled[key] or 0) < 0.99 then return 1 end
    if zoneFactor[key] then return zoneFactor[key] end
    zonesNamed = zonesNamed or self:ZonesNamed(raw)
    if not g.words then
      local _, w = tokenize(g.name)
      g.words = " " .. table.concat(w, " ") .. " "
    end
    local z, asked, other = self.db.entries[key].z, false, false
    for _, zn in ipairs(zonesNamed) do
      if g.zones[zn[2]] and not g.words:find(zn[1], 1, true) then
        if zn[2] == z then asked = true else other = true end
      end
    end
    local f = 1
    if other and not asked then
      f = 0
    elseif not asked and here and here ~= z and g.zones[here] then
      f = self.ELSEWHERE
    end
    zoneFactor[key], zonePicked[key] = f, asked or (not other and here == z)
    return f
  end
  local mentionsPronoun, mentionsPerson, namesAnything = false, false, next(named) ~= nil
  local asksType = {}   -- "the Kobold Candles quest": don't hold quests back
  for _, w in ipairs(raw) do
    local singular = w:gsub("s$", "")
    if self.TYPE_PRIOR[singular] then asksType[singular] = true end
    if PRONOUN[w] then mentionsPronoun = true end
    if PERSON[w] or w == "this" or w == "that" then mentionsPerson = true end
  end
  -- "how did I get here?", "why does he want this?": the FAQ tagged for that, at the player's place or quest.
  local intentKey, intentDoc, intentBonus, aboutTarget
  local intent, scope = Engine.Intent(raw)
  if intent and ctx then
    -- The entry whose whole name the question spells out, rarest words first ("lore for Hogger").
    local namedKey, best = nil, 0
    for k, v in pairs(titled) do
      local w = titledIdf[k] or 0
      if v >= 0.99 and inZone(k) == 1 and (w > best or (w == best and namedKey and k < namedKey)) then
        namedKey, best = k, w
      end
    end
    local k, i = self:IntentTarget(intent, scope, ctx, raw, namedKey)
    if k then intentKey, intentDoc = k, self:EntryDocs(k) + i end   -- the entry's docs: summary, then each FAQ
    if not k and scope == "subject" and ctx.targetName then
      for _, t in ipairs((tokenize(ctx.targetName))) do qtoks[#qtoks + 1] = t end
      aboutTarget = true
    end
    -- "Why can I use the Light?": the player's own class outranks the Light topic the words point at.
    intentBonus = self.INTENT_BONUS * (scope == "self" and 2 or 1)
  end
  local followKey
  if not intentKey and not aboutTarget and not namesAnything and (mentionsPronoun or #qtoks <= 2) then
    -- "who is this guy?" with an NPC targeted means the target; otherwise continue the conversation.
    local targetKey = ctx and ctx.targetName and self:KeyForName(ctx.targetName)
    followKey = (mentionsPerson and targetKey) or self.lastKey or targetKey
  end

  local wh = raw[1]
  -- "who is X" / "what are X": the entity overview (summary) is the best answer for a named entity.
  local defining = (wh == "who" or wh == "what") and (raw[2] == "is" or raw[2] == "are" or raw[2] == "was"
    or raw[2] == "were" or raw[2] == "s") and #qtoks <= 3
  local k1, b = 1.2, 0.6
  local avg, docs = self.avgLen, self.search.docs
  local base = {}
  for t in pairs(counts(qtoks)) do
    local pl = self.post[t]
    if pl then
      local idf = self:idf(t)
      for p = 1, #pl, 4 do
        local di = dec(pl, p, 3)
        local f = B64[pl:byte(p + 3)]
        local len = dec(docs, (di - 1) * 7 + 6, 2)
        base[di] = (base[di] or 0) + idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * len / avg))
      end
    end
  end
  local function include(key)
    local first, n = self:EntryDocs(key)
    for di = first, first + n - 1 do base[di] = base[di] or 0 end
  end
  -- The player's target, quests, subzone, zone and its bosses are candidates even when their text doesn't match
  -- ("what happened here?"), as long as some word of the question is known at all (gibberish still gets nothing).
  if next(base) ~= nil then
    for k, w in pairs(ctxWeight) do
      if w >= 0.7 then include(k) end
    end
  end
  for k in pairs(named) do include(k) end
  if followKey then include(followKey) end
  if intentKey then include(intentKey) end

  local scored = {}
  for di, s in pairs(base) do
    local key, kind, idx = self:Doc(di)
    s = s * KIND_WEIGHT[kind]
    if kind == 1 then
      local first = self.db.entries[key].faq[idx].q:match("^%s*(%a+)")
      if first and first:lower() == wh then s = s + 0.8 end
    end
    if defining and kind == 0 and titled[key] then s = s + 3 * math.min(1, titled[key]) end
    s = s + (named[key] or 0) * 0.8
    -- The entry's own name, spelled out in the question: rare words count for more, and the whole name for more than
    -- part of it. Keywords (the `named` bonus above) are shared by dozens of entries; a title mostly isn't.
    s = s + (titledIdf[key] or 0) * self.TITLE_BONUS
    -- Context scales with the match as well as adding to it, so it still counts when word scores run high.
    s = s * (1 + (ctxWeight[key] or 0) * self.CTX_BOOST) + (ctxWeight[key] or 0) * 1.5
    if di == intentDoc then
      s = s * 1.3 + intentBonus
    elseif intentDoc and kind == 1 and self.db.entries[key].faq[idx].gp then
      s = s * 0.5   -- asked why, not where: gameplay filler ("where are cactus apples found?") steps back
    end
    local zf = inZone(key)
    if key == followKey then
      s = s + 3
    elseif not ctxWeight[key] and not zonePicked[key] then
      -- Nothing in the player's situation points here: prefer the broad entries (topics, zones, major NPCs) that
      -- general questions are usually about over the thousands of subzones and one-off quests.
      local t = self.db.entries[key].t
      if not asksType[t] then s = s * (self.TYPE_PRIOR[t] or 1) end
    end
    if zf > 0 then scored[#scored + 1] = { di = di, key = key, kind = kind, idx = idx, score = s * zf } end
  end
  table.sort(scored, function(a, b2)
    if a.score ~= b2.score then return a.score > b2.score end
    return a.di < b2.di   -- deterministic ties
  end)

  local results, usedKeys = {}, {}
  for _, r in ipairs(scored) do
    if not usedKeys[r.key] then
      usedKeys[r.key] = true
      local title, text = self:DocText(r.key, r.kind, r.idx)
      results[#results + 1] = { key = r.key, kind = KIND[r.kind], idx = r.idx, title = title, text = text,
        score = r.score, name = self.db.entries[r.key].n }
      if #results >= limit then break end
    end
  end
  if results[1] then
    local angle = self:Angle(results[1].key, ctx, raw)
    if angle then results[1].angle = angle end
    self.lastKey = results[1].key
  end
  return results
end

-- Type-ahead: pre-written questions matching what the player has typed so far (the last word may be partial).
function Engine:Complete(text, ctx, limit)
  limit = limit or 5
  local toks, raw = tokenize(text)
  if #raw == 0 then return {} end
  local partial = not text:match("%s$") and raw[#raw] or nil
  local weights = {}
  for _, t in ipairs(toks) do weights[t] = 1 end
  if partial and #partial >= 2 then
    -- Expand the partial last word to indexed words that start with it (most common first, capped).
    local exp = {}
    for t, pl in pairs(self.post) do
      if #t > #partial and t:sub(1, #partial) == partial and not t:find("%d") then exp[#exp + 1] = t end
    end
    table.sort(exp, function(a, b2) return #self.post[a] > #self.post[b2] end)
    for i = 1, math.min(#exp, 25) do weights[exp[i]] = math.max(weights[exp[i]] or 0, 0.7) end
  end
  local _, ctxWeight = self:ContextKeys(ctx)
  local docs, scores = self.search.docs, {}
  for t, w in pairs(weights) do
    local pl = self.post[t]
    if pl then
      local idf = self:idf(t) * w
      for p = 1, #pl, 4 do
        local di = dec(pl, p, 3)
        if B64[docs:byte((di - 1) * 7 + 4)] == 1 then scores[di] = (scores[di] or 0) + idf end
      end
    end
  end
  local ranked = {}
  for di, s in pairs(scores) do
    local key, _, idx = self:Doc(di)
    ranked[#ranked + 1] = { di = di, key = key, idx = idx, score = s + (ctxWeight[key] or 0) * 2 }
  end
  table.sort(ranked, function(a, b2)
    if a.score ~= b2.score then return a.score > b2.score end
    return a.di < b2.di
  end)
  local out, seenQ = {}, {}
  for _, r in ipairs(ranked) do
    local f = self.db.entries[r.key].faq[r.idx]
    local q = f.q
    -- Never suggest a spoiler answer, unless it's about a quest you've finished.
    if not seenQ[q] and (not f.sp or self:Finished(r.key, ctx and ctx.done)) then
      seenQ[q] = true
      out[#out + 1] = { key = r.key, idx = r.idx, q = q, name = self.db.entries[r.key].n, score = r.score }
      if #out >= limit then break end
    end
  end
  return out
end


-- Entities mentioned by name in a piece of text, in order of appearance (longest name wins at each spot).
function Engine:Mentions(text, exclude)
  local words, caps = {}, {}
  for w in unpunct(text or ""):gmatch("[%w'%-\128-\255]+") do
    local low = Engine.lower(w)
    words[#words + 1] = low:gsub("'s$", "")
    -- Capitalized: an ASCII capital, or a first letter that lower() changes (Ä, Д).
    caps[#caps + 1] = w:sub(1, 1):match("%u") ~= nil or (w:byte(1) > 127 and low:sub(1, 2) ~= w:sub(1, 2))
  end
  local names, out, seen = self.db.index.name, {}, { [exclude or ""] = true }
  local i = 1
  while i <= #words do
    local hit
    for n = 4, 1, -1 do
      if i + n - 1 <= #words then
        local phrase = table.concat(words, " ", i, i + n - 1)
        local k = names[phrase]
        -- Single words only count when capitalized, so "light" in a sentence doesn't mean the Holy Light.
        if k and (n > 1 or (caps[i] and #phrase >= 4)) then hit = { k = k, n = n }; break end
      end
    end
    if hit then
      if not seen[hit.k] then seen[hit.k] = true; out[#out + 1] = hit.k end
      i = i + hit.n
    else
      i = i + 1
    end
  end
  return out
end

-- "Ask next" questions after showing entry `key` (FAQ `idx`, or the overview when idx is nil). `done`: the
-- character's completed quest IDs (ctx.done), whose own spoiler answers can be offered.
function Engine:FollowUps(key, idx, limit, done)
  limit = limit or 3
  local e = self.db.entries[key]
  if not e then return {} end
  if idx then self.asked[key .. ":" .. idx] = true end
  local out, used = {}, {}
  local function push(k, i)
    local q = self.db.entries[k] and self.db.entries[k].faq and self.db.entries[k].faq[i]
    local id = k .. ":" .. i
    if q and (not q.sp or self:Finished(k, done)) and not q.gp and not used[id] and not self.asked[id]
      and #out < limit then
      used[id] = true
      out[#out + 1] = { key = k, idx = i, q = q.q, name = self.db.entries[k].n }
      return true
    end
  end
  local own = Engine.RankedFaq(e, self.race, self:Finished(key, done))
  local function nextOwn()
    for _, i in ipairs(own) do
      if push(key, i) then return end
    end
  end
  local text = (idx and e.faq and e.faq[idx] and e.faq[idx].a) or e.s
  -- The follow-ups written for this question come first.
  for _, i in ipairs(idx and e.faq and e.faq[idx] and e.faq[idx].nx or {}) do push(key, i) end
  nextOwn()
  -- Then people and places the answer itself mentions, then more about this entry.
  for _, k in ipairs(self:Mentions(text, key)) do
    for _, i in ipairs(Engine.RankedFaq(self.db.entries[k], self.race, self:Finished(k, done))) do
      if push(k, i) then break end
    end
    if #out >= limit then break end
  end
  while #out < limit do
    local before = #out
    nextOwn()
    if #out == before then break end
  end
  return out
end

-- A race/class/profession note for this entry, if the player asked about themselves.
function Engine:Angle(key, ctx, rawWords)
  local e = self.db.entries[key]
  if not (e and e.ang and ctx) then return nil end
  local personal = false
  for _, w in ipairs(rawWords or {}) do
    if w == "i" or w == "me" or w == "my" or w == "mine" or w == "myself" then personal = true end
  end
  if not personal then return nil end
  local targets = { "race:" .. (ctx.race or ""), "class:" .. (ctx.class or ""), "faction:" .. (ctx.faction or "") }
  for _, p in ipairs(ctx.professions or {}) do targets[#targets + 1] = "profession:" .. p end
  for _, t in ipairs(targets) do
    if e.ang[t] then return { target = t, text = e.ang[t] } end
  end
  return nil
end

-- An entry's FAQ indices in the order to offer them: situational questions first (INTENT_RANK), then the rest in
-- their own order. Spoiler answers (unless `open`: a quest you've finished), gameplay filler ("where are the
-- wolves?") and other races' answers are left out.
function Engine.RankedFaq(e, race, open)
  local out, faq = {}, e and e.faq or {}
  for i, f in ipairs(faq) do
    if (open or not f.sp) and not f.gp and forRace(f, race) then out[#out + 1] = i end
  end
  table.sort(out, function(a, b2)
    local ra, rb = INTENT_RANK[faq[a].it] or 9, INTENT_RANK[faq[b2].it] or 9
    if ra ~= rb then return ra < rb end
    return a < b2
  end)
  return out
end

-- Suggested questions for the panel: target and current quests first, then subzone, zone and bosses.
function Engine:Suggest(ctx, limit)
  limit = limit or 6
  local keys = self:ContextKeys(ctx)
  local out, seen, ranked, pos = {}, {}, {}, {}
  -- Round-robin across relevant entries so one quest doesn't take every slot; the same question on two entries
  -- ("Who is Salma Saldean?" on her and on her quest) is offered once.
  for round = 1, 3 do
    for _, key in ipairs(keys) do
      local e = self.db.entries[key]
      ranked[key] = ranked[key] or Engine.RankedFaq(e, ctx and ctx.race, self:Finished(key, ctx and ctx.done))
      local list, p = ranked[key], pos[key] or 1
      while list[p] and seen[Engine.lower(e.faq[list[p]].q)] do p = p + 1 end
      if list[p] and #out < limit then
        seen[Engine.lower(e.faq[list[p]].q)] = true
        out[#out + 1] = { key = key, idx = list[p], q = e.faq[list[p]].q }
        p = p + 1
      end
      pos[key] = p
    end
  end
  return out
end

function Engine:Answer(key, idx)
  local e = self.db.entries[key]
  if not e then return nil end
  self.lastKey = key
  if idx and e.faq and e.faq[idx] then return e.faq[idx].a, e.faq[idx].q end
  return e.s, e.n
end

ns.Engine = Engine
return Engine
