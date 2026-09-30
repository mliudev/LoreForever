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
  wait lol um uh hmm actually guys dude bro yeah yea anyway kinda sorta basically literally mean guy]]):gmatch("%a+") do
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
Engine.TYPE_PRIOR = { topic = 1.0, zone = 1.0, city = 1.0, dungeon = 1.0, npc = 0.9, subzone = 0.75, quest = 0.7 }
-- Added per unit of (share of the entry's title words in the question x their idf). The eval plateaus from 4 to 6.
Engine.TITLE_BONUS = 5.0
-- Entries the player's context points at get their score multiplied by 1 + weight x this (weight 0.3 to 1.1).
Engine.CTX_BOOST = 1.0
-- A title word counts fully once this share of its docs belong to entries it names (see NameShare).
Engine.NAME_SHARE_FULL = 0.5

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
  if ctx.subzone then add(db.index.name[Engine.lower(ctx.subzone)], 0.9) end
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
  for i = 1, n do
    for _, r in ipairs(db.entries[keys[i]].rel or {}) do add(r, 0.3) end
  end
  return keys, seen
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

-- Rank answer units. Returns up to `limit` results with distinct entries: {key, kind, idx, title, text, score}.
function Engine:Ask(question, ctx, limit)
  limit = limit or 3
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
  local mentionsPronoun, mentionsPerson, namesAnything = false, false, next(named) ~= nil
  local asksType = {}   -- "the Kobold Candles quest": don't hold quests back
  for _, w in ipairs(raw) do
    local singular = w:gsub("s$", "")
    if self.TYPE_PRIOR[singular] then asksType[singular] = true end
    if PRONOUN[w] then mentionsPronoun = true end
    if PERSON[w] or w == "this" or w == "that" then mentionsPerson = true end
  end
  local followKey
  if not namesAnything and (mentionsPronoun or #qtoks <= 2) then
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
    if key == followKey then
      s = s + 3
    elseif not ctxWeight[key] then
      -- Nothing in the player's situation points here: prefer the broad entries (topics, zones, major NPCs) that
      -- general questions are usually about over the thousands of subzones and one-off quests.
      local t = self.db.entries[key].t
      if not asksType[t] then s = s * (self.TYPE_PRIOR[t] or 1) end
    end
    scored[#scored + 1] = { di = di, key = key, kind = kind, idx = idx, score = s }
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
    if not seenQ[q] and not f.sp then   -- never suggest a spoiler answer
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

-- "Ask next" questions after showing entry `key` (FAQ `idx`, or the overview when idx is nil).
function Engine:FollowUps(key, idx, limit)
  limit = limit or 3
  local e = self.db.entries[key]
  if not e then return {} end
  if idx then self.asked[key .. ":" .. idx] = true end
  local out, used = {}, {}
  local function push(k, i)
    local q = self.db.entries[k] and self.db.entries[k].faq and self.db.entries[k].faq[i]
    local id = k .. ":" .. i
    if q and not q.sp and not used[id] and not self.asked[id] and #out < limit then
      used[id] = true
      out[#out + 1] = { key = k, idx = i, q = q.q, name = self.db.entries[k].n }
      return true
    end
  end
  local function nextOwn()
    for i = 1, #(e.faq or {}) do
      if push(key, i) then return end
    end
  end
  local text = (idx and e.faq and e.faq[idx] and e.faq[idx].a) or e.s
  nextOwn()
  -- Then people and places the answer itself mentions, then more about this entry.
  for _, k in ipairs(self:Mentions(text, key)) do
    local f = self.db.entries[k].faq
    for i = 1, #(f or {}) do
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

-- Suggested questions for the panel: target and current quests first, then subzone, zone and bosses.
function Engine:Suggest(ctx, limit)
  limit = limit or 6
  local keys = self:ContextKeys(ctx)
  local out = {}
  -- Round-robin across relevant entries so one quest doesn't take every slot.
  for round = 1, 3 do
    for _, key in ipairs(keys) do
      local e = self.db.entries[key]
      local f = e.faq and e.faq[round]
      if f and f.sp then f = nil end   -- spoiler answers aren't suggested
      if f and #out < limit then
        out[#out + 1] = { key = key, idx = round, q = f.q }
      end
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
