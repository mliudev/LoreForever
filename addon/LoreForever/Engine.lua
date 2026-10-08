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
-- Meaning re-rank (word-piece vectors, Data/Vectors_*.lua): the docs of the top VEC_ENTRIES entries are re-scored by
-- cosine to the question, minus VEC_RANK per place an entry ranks below the first, plus VEC_PICK for the doc the word
-- match picked. Fitted on real players' questions (eval/questions/players_answerable.jsonl, dev split).
Engine.VEC_ENTRIES = 4
Engine.VEC_RANK = 0.1
Engine.VEC_PICK = 0.05

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
      if not g then g = { name = name, zones = {}, keys = {}, n = 0 }; groups[name] = g end
      if not g.zones[e.z] then g.zones[e.z], g.n = true, g.n + 1 end
      g.keys[#g.keys + 1] = key
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

-- Unit identity aliases are deliberately separate from search keywords: a place, a weapon or a class mentioned
-- by a topic does not identify a member of it. The compiler reads this same table; runtime matching also uses it
-- directly so an older generated mob index cannot bring the broad keyword matches back.
-- Tribe aliases come from the species entries and local quest/zone sources (Bluegill: quest:279, Mosshide: quest:277).
Engine.MOB_ALIASES = {
  ["topic:gnoll"] = { "gnoll", "riverpaw", "mosshide", "mudsnout", "palemane", "shadowhide", "woodpaw" },
  ["topic:murloc"] = { "murloc", "bluegill", "mur'ghoul", "mur'gul" },
  ["topic:kobold"] = { "kobold" },
  ["topic:furbolg"] = { "furbolg", "deadwood", "foulweald", "gnarlpine", "thistlefur", "winterfall" },
  ["topic:harpy"] = { "harpy", "bloodfeather", "dustwind", "windfury", "witchwing" },
  ["topic:centaur"] = { "centaur" },
  ["topic:kolkar-clan"] = { "kolkar" },
  ["topic:quilboar"] = { "quilboar", "quillboar", "bristleback", "razormane" },
  ["topic:trogg"] = { "trogg", "caverndeep", "rockjaw", "stonesplinter" },
  ["topic:naga"] = { "naga" },
  ["topic:satyr"] = { "satyr", "jadefire", "sargeron", "xavian" },
  ["topic:worgen"] = { "worgen" },
  ["topic:gnome"] = { "gnome", "mechagnome" },
  ["topic:leper-gnome"] = { "leper gnome" },
  ["topic:goblin"] = { "goblin" },
  ["topic:dwarf"] = { "dwarf", "dwarves" },
  ["topic:dark-iron-dwarf"] = { "dark iron" },
  ["topic:night-elf"] = { "night elf", "kaldorei" },
  ["topic:troll"] = { "troll", "amani", "drakkari", "zandalari" },
  ["topic:tauren"] = { "tauren" },
  ["topic:orc"] = { "orc" },
  ["topic:forsaken"] = { "forsaken" },
  ["topic:highborne"] = { "highborne", "shen'dralar" },
  ["topic:skyborne"] = { "skyborne", "shen'dorei" },
  ["topic:elemental-plane"] = { "elemental" },
  ["topic:defias-brotherhood"] = { "defias" },
  ["topic:dragonmaw-clan"] = { "dragonmaw" },
  ["topic:blackrock-clan"] = { "blackrock" },
  ["topic:bronzebeard-clan"] = { "bronzebeard" },
  ["topic:burning-blade-clan"] = { "burning blade" },
  ["topic:darkspear-tribe"] = { "darkspear" },
  ["topic:frostmane-tribe"] = { "frostmane" },
  ["topic:grimtotem-tribe"] = { "grimtotem" },
  ["topic:wildhammer-clan"] = { "wildhammer" },
  ["topic:warsong-clan"] = { "warsong" },
  ["topic:scarlet-crusade"] = { "scarlet" },
  ["topic:sentinels"] = { "sentinel", "silverwing" },
  ["topic:syndicate"] = { "syndicate" },
  ["topic:venture-company"] = { "venture" },
  ["topic:steamwheedle-cartel"] = { "steamwheedle" },
  ["topic:argent-dawn"] = { "argent" },
  ["topic:cenarion-circle"] = { "cenarion" },
  ["topic:twilight-s-hammer"] = { "twilight's hammer" },
  ["topic:pirate"] = { "pirate", "bloodsail", "buccaneer", "corsair", "freebooter", "southsea" },
}
local CLASS_TOPIC = { ["topic:warrior"] = true, ["topic:paladin"] = true, ["topic:hunter"] = true,
  ["topic:rogue"] = true, ["topic:priest"] = true, ["topic:shaman"] = true, ["topic:mage"] = true,
  ["topic:warlock"] = true, ["topic:druid"] = true }

-- Whole words/phrases only. Normalize singular/plural unit labels, preserving names ending in ss.
local function unitWords(name)
  local words = {}
  for w in Engine.lower(name):gmatch("[%a'\128-\255]+") do
    if not w:match("ss$") then w = w:gsub("s$", "") end
    words[#words + 1] = w
  end
  return " " .. table.concat(words, " ") .. " "
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
  local words, best, width = unitWords(name), nil, 0
  for key, aliases in pairs(Engine.MOB_ALIASES) do
    if self.db.entries[key] then
      for _, alias in ipairs(aliases) do
        local phrase = unitWords(alias)
        if words:find(phrase, 1, true) and (#phrase > width or (#phrase == width and (not best or key < best))) then
          best, width = key, #phrase
        end
      end
    end
  end
  if best then return best, "mob" end
  return nil
end

-- Zone key ("deadmines") for an in-game zone name.
function Engine:ZoneKey(zoneName)
  return zoneName and self.db.index.zone and self.db.index.zone[Engine.lower(zoneName)] or nil
end

-- Entry key for the subzone you're in. A name shared across zones resolves to your zone's entry: "Canals" in the
-- Undercity is the Undercity's, not Stormwind's, and none when no namesake is in your zone.
function Engine:SubzoneKey(subzone, zone)
  if not subzone then return nil end
  local idx, sub = self.db.index, Engine.lower(subzone)
  local key = idx.name[sub] or idx.name[(sub:gsub("^the ", ""))]   -- "The Crossroads" is "Crossroads"
  local g = key and self.namesakes and self.namesakes[key]
  local zk = g and self:ZoneKey(zone)
  if not zk or self.db.entries[key].z == zk then return key end
  for _, k in ipairs(g.keys) do
    if self.db.entries[k].z == zk then return k end
  end
  return nil
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
    add(self:SubzoneKey(ctx.subzone, ctx.zone), 0.9)
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

-- Word-piece vectors ---------------------------------------------------------------------------------------------
-- Matching words misses answers worded differently from the question ("Who was the leader of the black dragonflight?"
-- vs "Who leads the black dragonflight?"). Data/Vectors_*.lua (pipeline/lore/vectors.py) holds a static embedding
-- model's word-piece vectors: a text's vector is the mean of its pieces' rows, cut to 128 dimensions, one base64
-- character (-31..31) per dimension and a log-scale factor per row. Tokenizing follows BERT-uncased: lowercase,
-- accents stripped, punctuation split off, then the longest known pieces ("##" continues a word), unknown words left
-- out. English only: a language pack switches it off (Lang.lua).

-- Lowercase Latin-1 letters with accents -> the plain letter (BERT strips accents; æ, ø, ð, þ stay).
local UNACCENT = {}
for c, plain in pairs({ [0xA0] = "a", [0xA1] = "a", [0xA2] = "a", [0xA3] = "a", [0xA4] = "a", [0xA5] = "a",
  [0xA7] = "c", [0xA8] = "e", [0xA9] = "e", [0xAA] = "e", [0xAB] = "e", [0xAC] = "i", [0xAD] = "i", [0xAE] = "i",
  [0xAF] = "i", [0xB1] = "n", [0xB2] = "o", [0xB3] = "o", [0xB4] = "o", [0xB5] = "o", [0xB6] = "o", [0xB9] = "u",
  [0xBA] = "u", [0xBB] = "u", [0xBC] = "u", [0xBD] = "y", [0xBF] = "y" }) do
  UNACCENT["\195" .. string.char(c)] = plain
end

-- Words and punctuation marks, BERT-style: whitespace splits, and every punctuation character is its own token
-- (ASCII !-/ :-@ [-` {-~, and the UTF-8 general punctuation block: curly quotes, dashes).
local function vecTokens(text)
  local s = Engine.lower(text):gsub("\195[\160-\191]", function(ch) return UNACCENT[ch] end)
  local out = {}
  for w in s:gmatch("%S+") do
    local cur, i, n = "", 1, #w
    while i <= n do
      local c = w:byte(i)
      local len = c < 0x80 and 1 or c < 0xE0 and 2 or c < 0xF0 and 3 or 4
      local ch = w:sub(i, i + len - 1)
      local punct = len == 1 and ((c >= 33 and c <= 47) or (c >= 58 and c <= 64) or (c >= 91 and c <= 96)
        or (c >= 123 and c <= 126)) or (len == 3 and c == 0xE2 and (w:byte(i + 1) == 0x80 or w:byte(i + 1) == 0x81))
      if punct then
        if cur ~= "" then out[#out + 1] = cur; cur = "" end
        out[#out + 1] = ch
      else
        cur = cur .. ch
      end
      i = i + len
    end
    if cur ~= "" then out[#out + 1] = cur end
  end
  return out
end

-- Greedy longest-match word pieces of one word, appended to `ids`; a word with an unknown piece is left out whole.
local function wordPieces(vocab, word, ids)
  local starts = {}
  for p in word:gmatch("()[%z\1-\127\194-\244][\128-\191]*") do starts[#starts + 1] = p end
  local n = #starts
  if n == 0 or n > 100 then return end
  starts[n + 1] = #word + 1
  local pieces, i = {}, 1
  while i <= n do
    local found
    for j = n, i, -1 do
      local piece = word:sub(starts[i], starts[j + 1] - 1)
      local id = vocab[i > 1 and ("##" .. piece) or piece]
      if id then
        pieces[#pieces + 1], found, i = id, true, j + 1
        break
      end
    end
    if not found then return end
  end
  for _, id in ipairs(pieces) do ids[#ids + 1] = id end
end

-- Unit vector (a table of dim numbers) of a text, or nil without vectors or known pieces.
function Engine:VecOf(text)
  local V = self.db.vectors
  if not V then return nil end
  if not self.vecVocab then
    local vocab, id = {}, 0
    for piece in (V.vocab .. "\n"):gmatch("(.-)\n") do
      id = id + 1
      vocab[piece] = id
    end
    self.vecVocab, self.vecScale = vocab, {}
  end
  local ids = {}
  for _, w in ipairs(vecTokens(text)) do wordPieces(self.vecVocab, w, ids) end
  if #ids == 0 then return nil end
  local dim, per, lo, span = V.dim, V.rowsPerChunk, V.scaleLo, V.scaleHi - V.scaleLo
  local acc = {}
  for d = 1, dim do acc[d] = 0 end
  for _, id in ipairs(ids) do
    local sc = self.vecScale[id]
    if not sc then
      local code = B64[V.scale:byte(2 * id - 1)] * 64 + B64[V.scale:byte(2 * id)]
      sc = 2 ^ (lo + code / 4095 * span)
      self.vecScale[id] = sc
    end
    local off = ((id - 1) % per) * dim
    local b = { V.rows[math.floor((id - 1) / per) + 1]:byte(off + 1, off + dim) }
    for d = 1, dim do acc[d] = acc[d] + (B64[b[d]] - 32) * sc end
  end
  local norm = 0
  for d = 1, dim do norm = norm + acc[d] * acc[d] end
  norm = math.sqrt(norm)
  if norm == 0 then return nil end
  for d = 1, dim do acc[d] = acc[d] / norm end
  return acc
end

-- The text a doc is compared by: a FAQ's question, aliases and the start of its answer; an overview's name and
-- summary; a section's title and the start of its body.
function Engine:VecText(key, kind, idx)
  local e = self.db.entries[key]
  local name = e.n:gsub("%s*%b()", "")
  if kind == 0 then return name .. ". " .. (e.s or "") end
  if kind == 2 then
    local sec = e.sec[idx]
    return name .. ": " .. sec.t .. ". " .. sec.b:sub(1, 300)
  end
  local f = e.faq[idx]
  return f.q .. " " .. table.concat(f.al or {}, " ") .. " " .. f.a:sub(1, 300)
end

-- Doc vectors are worked out when first needed and kept (a few thousand at most; the cache starts over past that).
function Engine:DocVec(di)
  self.docVecs = self.docVecs or { n = 0 }
  local v = self.docVecs[di]
  if v == nil then
    local key, kind, idx = self:Doc(di)
    v = self:VecOf(self:VecText(key, kind, idx)) or false
    if self.docVecs.n >= 4000 then self.docVecs = { n = 0 } end
    self.docVecs[di], self.docVecs.n = v, self.docVecs.n + 1
  end
  return v or nil
end

-- Re-rank `results` (ranked distinct entries) in place by meaning: the best doc of the top VEC_ENTRIES entries comes
-- first, keeping the first result's score so the panel's confidence check is unchanged. An entry the zone rules
-- held back (a namesake in another zone, `elsewhere`) can't be moved up.
function Engine:Rerank(results, question)
  local qv = self:VecOf(question)
  if not qv or not results[1] then return end
  local bestRank, bestKind, bestIdx, bestScore
  for rank = 1, math.min(#results, self.VEC_ENTRIES) do
    local r = results[rank]
    local first, n = self:EntryDocs(r.key)
    if rank > 1 and r.elsewhere then n = 0 end
    for di = first, first + n - 1 do
      local dv = self:DocVec(di)
      if dv then
        local _, kind, idx = self:Doc(di)
        local c = 0
        for d = 1, #qv do c = c + qv[d] * dv[d] end
        c = c - (rank - 1) * self.VEC_RANK + ((KIND[kind] == r.kind and idx == r.idx) and self.VEC_PICK or 0)
        if not bestScore or c > bestScore then bestRank, bestKind, bestIdx, bestScore = rank, kind, idx, c end
      end
    end
  end
  if not bestRank then return end
  local topScore, r = results[1].score, table.remove(results, bestRank)
  r.kind, r.idx = KIND[bestKind], bestIdx
  r.title, r.text = self:DocText(r.key, bestKind, bestIdx)
  r.score = math.max(r.score, topScore)
  table.insert(results, 1, r)
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
  local intentKey, intentDoc, intentBonus, aboutTarget, mobSubject
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
    if scope == "subject" then
      -- Some quest titles reduce to a class word after stop words ("A Rogue's Deal"). Keep a whole title or an
      -- explicitly requested quest; otherwise use the exact class identity before checking a creature's role suffix.
      local _, literalName = tokenize(namedKey and self.db.entries[namedKey].n or "")
      local namesQuest = namedKey and (" " .. table.concat(raw, " ") .. " "):find(
        " " .. table.concat(literalName, " ") .. " ", 1, true)
      if namedKey and self.db.entries[namedKey].t == "quest" and not asksType.quest and not namesQuest then
        for classKey in pairs(CLASS_TOPIC) do
          if (titled[classKey] or 0) >= 0.99 and self.titleLen[namedKey] == self.titleLen[classKey] then
            namedKey = classKey
            break
          end
        end
      end
      local mobKey, how = self:KeyForName(table.concat(raw, " "))
      -- A role in a creature's name ("Mosshide Warrior") must not turn a species question into class lore.
      if how == "mob" and (not namedKey or CLASS_TOPIC[namedKey]) then
        namedKey, mobSubject = mobKey, true
        -- A tribe alias may not occur in its species title. Search the resolved identity as well as the role.
        for _, t in ipairs((tokenize(self.db.entries[mobKey].n))) do qtoks[#qtoks + 1] = t end
      end
    end
    local k, i = self:IntentTarget(intent, scope, ctx, raw, namedKey)
    if k then intentKey, intentDoc = k, self:EntryDocs(k) + i end   -- the entry's docs: summary, then each FAQ
    if not k and scope == "subject" and ctx.targetName then
      for _, t in ipairs((tokenize(ctx.targetName))) do qtoks[#qtoks + 1] = t end
      aboutTarget = true
    end
    -- "Why can I use the Light?": the player's own class outranks the Light topic the words point at.
    intentBonus = self.INTENT_BONUS * ((scope == "self" or mobSubject) and 2 or 1)
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
    if zf > 0 then scored[#scored + 1] = { di = di, key = key, kind = kind, idx = idx, score = s * zf, zf = zf } end
  end
  table.sort(scored, function(a, b2)
    if a.score ~= b2.score then return a.score > b2.score end
    return a.di < b2.di   -- deterministic ties
  end)

  -- Meaning re-rank, except where the word match already knows better: situational questions ("how did I get
  -- here?" goes by intent), plain "who is X" (the overview), and questions that name nothing (they lean on context).
  local rerank = self.db.vectors and not intent and not defining and namesAnything
  local want = rerank and math.max(limit, self.VEC_ENTRIES) or limit
  local results, usedKeys = {}, {}
  for _, r in ipairs(scored) do
    if not usedKeys[r.key] then
      usedKeys[r.key] = true
      local title, text = self:DocText(r.key, r.kind, r.idx)
      results[#results + 1] = { key = r.key, kind = KIND[r.kind], idx = r.idx, title = title, text = text,
        score = r.score, name = self.db.entries[r.key].n, elsewhere = r.zf < 1 or nil }
      if #results >= want then break end
    end
  end
  -- ...and when the top answer comes from the player's own situation (quest, target, subzone, zone), which the word
  -- match weighs and the vectors don't: a blind judge found those answers no better re-ranked.
  if rerank and results[1] and not ctxWeight[results[1].key] then self:Rerank(results, question) end
  for i = #results, limit + 1, -1 do results[i] = nil end
  if results[1] then
    local angle = self:Angle(results[1].key, ctx, raw)
    if angle then results[1].angle = angle end
    self.lastKey = results[1].key
  end
  return results
end

local function storyName(text)
  return Engine.lower(text or ""):gsub("%s+", " "):match("^%s*(.-)%s*$")
end

-- A city can also have a subzone overview under the same display name. The zone entry is the canonical story;
-- keep this independent of installed voices so reading and submission agree even when audio is unavailable.
function Engine:CanonicalStoryKey(key)
  local e = key and self.db.entries[key]
  if not e then return nil end
  if e.t == "subzone" then
    local z = self:ZoneKey(storyName(e.n)) or (e.en and self:ZoneKey(storyName(e.en)))
    if z and self.db.entries["zone:" .. z] then return "zone:" .. z end
  end
  return key
end

-- Full typed phrases must match a name, rather than merely contain its tokens: "Who rules Stormwind?" stays a
-- question. Prefixes and later words of a name are useful while typing ("Stormwind Ci", "VanCleef").
local function storyNameScore(query, name, exact)
  name = storyName(name)
  if name == query then return 100 end
  if exact or #query < 2 then return nil end
  if name:sub(1, #query) == query then return 80 end
  if (" " .. name):find(" " .. query, 1, true) then return 60 end
end

function Engine:StoryMatches(text, ctx, exact)
  local query = storyName(text)
  if query == "" then return {} end
  local scores, candidates = {}, {}
  local function add(key, score)
    if not score then return end
    key = self:CanonicalStoryKey(key)
    if key then scores[key] = math.max(scores[key] or 0, score) end
  end
  -- These indexes include client names and zone aliases, including those supplied by language packs. A zone
  -- alias wins a collision with another entry (Stormwind's kingdom topic or the duplicate city subzone).
  local z = self:ZoneKey(query)
  if z then add("zone:" .. z, 120) end
  local named = self.db.index.name[query]
  -- Honor the game's NPC title aliases (Deputy Willem -> Willem), while question
  -- and command words such as "Who" or "Tell" must not become an NPC title.
  if not named and not STOP[query:match("^%S+")] then
    local key, how = self:KeyForName(query)
    if how == "exact" then named = key end
  end
  if named then add(self:SubzoneKey(query, ctx and ctx.zone) or named, z and 100 or 110) end
  if not exact then
    for name, key in pairs(self.db.index.name) do add(key, storyNameScore(query, name)) end
    for name, zone in pairs(self.db.index.zone or {}) do add("zone:" .. zone, storyNameScore(query, name)) end
  end
  for key, aliases in pairs(Engine.MOB_ALIASES) do
    for _, alias in ipairs(aliases) do add(key, storyNameScore(query, alias, exact)) end
  end
  -- The title index also covers translated display names which differ from the client's localized name. Reuse
  -- its vocabulary and only inspect matching entries; no extra database-wide name index is built or mutated.
  local tokens = tokenize(query)
  local first = tokens[1]
  if first then
    for token, keys in pairs(self.titleIndex) do
      if token == first or (not exact and #first >= 2 and token:sub(1, #first) == first) then
        for key in pairs(keys) do candidates[key] = true end
      end
    end
    local names = self.nameIndex[first]
    for key in pairs(names or {}) do if key ~= "n" then candidates[key] = true end end
  end
  for key in pairs(candidates) do
    local e = self.db.entries[key]
    add(key, storyNameScore(query, e.n, exact))
    add(key, storyNameScore(query, e.n:gsub("%s*%b()", ""), exact))
    if e.en then add(key, storyNameScore(query, e.en, exact)) end
  end
  local _, ctxWeight = self:ContextKeys(ctx)
  local out = {}
  for key, score in pairs(scores) do
    local e = self.db.entries[key]
    local name = e.n
    local place = e.t == "city" and 6 or ((e.t == "zone" or e.t == "dungeon") and 4 or 0)
    out[#out + 1] = { kind = "story", key = key, name = name, label = name, q = name,
      score = score + place + (ctxWeight[key] or 0) * 2 }
  end
  table.sort(out, function(a, b)
    if a.score ~= b.score then return a.score > b.score end
    if a.name ~= b.name then return a.name < b.name end
    return a.key < b.key
  end)
  return out
end

-- Immediate Enter/Send does not have to wait for the type-ahead debounce. Only an exact bare name opens a story.
function Engine:StoryForName(text, ctx)
  local matches = self:StoryMatches(text, ctx, true)
  return matches[1] and matches[1].key or nil
end

-- Type-ahead: matching stories first for name searches, followed by the existing pre-written question ranking.
function Engine:Complete(text, ctx, limit)
  limit = math.max(0, math.floor(limit or 5))
  if limit == 0 then return {} end
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
  local out, seenQ = self:StoryMatches(text, ctx), {}
  -- Leave space for related questions in the same bounded dropdown even for broad partial names.
  local storyLimit = limit > 1 and math.min(3, limit - 1) or 1
  for i = #out, storyLimit + 1, -1 do out[i] = nil end
  if #out >= limit then return out end
  for _, r in ipairs(ranked) do
    local f = self.db.entries[r.key].faq[r.idx]
    local q = f.q
    -- Never suggest a spoiler answer, unless it's about a quest you've finished.
    if not seenQ[q] and (not f.sp or self:Finished(r.key, ctx and ctx.done)) then
      seenQ[q] = true
      out[#out + 1] = { kind = "faq", key = r.key, idx = r.idx, q = q, name = self.db.entries[r.key].n, score = r.score }
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

-- Lore links: names of other entries inside answer text, found when the answer is shown (see UI.Linkify). The same
-- greedy longest-name match as Mentions, but it keeps positions so the names can be wrapped in place.
-- Punctuation that unpunct turns into a space, replaced by spaces of the same byte length so positions don't move.
local function blank(s)
  if not s:find("[\194\195\226]") then return s end
  return (s:gsub("\226[\128\129][\128-\191]", "   "):gsub("\194[\160-\191]", "  "):gsub("\195[\151\183]", "  "))
end

-- Leading articles a quest title can have over the name of what it's about (English, German, Portuguese).
local ARTICLES = {}
for _, a in ipairs({ "the", "der", "die", "das", "den", "o", "a", "os", "as" }) do ARTICLES[a .. " "] = "" end

-- First word of every name -> the most words a name starting with it has, so most words are passed over at once.
function Engine:LinkStarts()
  local names = self.db.index.name
  if self.linkStarts and self.linkStartsFor == names then return self.linkStarts end
  local starts = {}
  for name in pairs(names) do
    local n, first = 0, nil
    for w in name:gmatch("%S+") do
      n = n + 1
      first = first or w
    end
    if first and n <= 4 and n > (starts[first] or 0) then starts[first] = n end
  end
  self.linkStarts, self.linkStartsFor = starts, names
  return starts
end

-- Wrap names of entries in `text` (already escaped for display). opts:
--   self   the key the text is about (never linked, nor another entry with the same name)
--   seen   keys already linked in this message (filled in): each name links on its first mention only
--   allow  function(key, e) -> false to leave that name as plain text (quests you don't have, ...)
--   wrap   function(key, shown) -> the replacement for the matched text `shown`
function Engine:Linkify(text, opts)
  if not text or text == "" then return text end
  local names, entries, starts = self.db.index.name, self.db.entries, self:LinkStarts()
  local seen, self_ = opts.seen or {}, opts.self
  local selfName = self_ and entries[self_] and Engine.lower(entries[self_].n)
  local m = blank(text)
  local toks = {}
  for st, w, en in m:gmatch("()([%w'%-\128-\255]+)()") do
    local lead = #w:match("^'*")   -- an opening quote: 'Stormwind'
    st, w = st + lead, w:sub(lead + 1)
    local core = w:gsub("'s$", ""):gsub("'$", "")
    -- A lone closing quote ("Sleep.'") is no word at all.
    if core ~= "" then
      local low = Engine.lower(core)
      toks[#toks + 1] = { a = st, b = st + #core - 1, e = en, low = low, full = Engine.lower(w), whole = #core == #w,
        cap = w:sub(1, 1):match("%u") ~= nil or (w:byte(1) > 127 and low:sub(1, 2) ~= w:sub(1, 2)) }
    end
  end
  local function spaced(t) return toks[t + 1] and m:sub(toks[t].e, toks[t + 1].a - 1) == " " end
  -- A capitalized word next to the single-word name makes it part of a longer name we don't know ("Light Leather",
  -- "Vice Admiral", "Wizard's Sanctum"), unless that word only starts the sentence.
  local function inLonger(i)
    if toks[i].whole and spaced(i) and toks[i + 1].cap then return true end
    local p = toks[i - 1]
    if not (p and p.cap and spaced(i - 1)) then return false end
    if i <= 2 then return false end
    local gap = text:sub(toks[i - 2].e, p.a - 1)
    return not (gap:find("[%.!%?:;\n]") or gap:find("\226\128\166"))   -- ... or an ellipsis ends a sentence
  end
  local out, last, i = {}, 1, 1
  local function find(i)
    local most = starts[toks[i].low] or starts[toks[i].full]
    if not most then return nil end
    for n = math.min(most, #toks - i + 1), 1, -1 do
      local j, ok = i + n - 1, true
      -- The words of a name are separated by single spaces; a possessive inside one counts as part of it.
      for t = i, j - 1 do
        if not spaced(t) then ok = false; break end
      end
      if ok then
        local parts = {}
        for t = i, j - 1 do parts[#parts + 1] = toks[t].full end
        parts[#parts + 1] = toks[j].low
        local phrase = table.concat(parts, " ")
        local key = names[phrase]
        local e = key and entries[key]
        -- Single words only count when capitalized, so "light" in a sentence doesn't mean the Holy Light.
        if e and (n > 1 or (toks[i].cap and #phrase >= 4 and not inLonger(i))) then
          -- Quests lose to another entry of the same name ("the Defias Brotherhood" is the faction, not the quest).
          local other = e.t == "quest" and names[(phrase:gsub("^%S+ ", ARTICLES))]
          local tie = other and other ~= key
          if not tie and (not opts.allow or opts.allow(key, e)) then return key, j end
        end
      end
    end
  end
  while i <= #toks do
    local key, j = find(i)
    if key then
      if not seen[key] and key ~= self_ and Engine.lower(entries[key].n) ~= selfName then
        seen[key] = true
        local a, b = toks[i].a, toks[j].b
        out[#out + 1] = text:sub(last, a - 1)
        out[#out + 1] = opts.wrap(key, text:sub(a, b))
        last = b + 1
      end
      i = j + 1
    else
      i = i + 1
    end
  end
  if last == 1 then return text end
  out[#out + 1] = text:sub(last)
  return table.concat(out)
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
