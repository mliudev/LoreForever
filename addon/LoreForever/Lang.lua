-- Languages. UI strings go through ns.L, keyed by their English text, so a string a pack doesn't translate stays
-- English. A language pack (LoreForever_Lang_<locale>, see Packs.lua) supplies, through its writer P:
--   P.ui[english] = translation            UI strings
--   P.entries[key] = {n, s, h, kw, ang, sec = {{t, b}}, faq = {{q, a, al}}, fx = {[id] = {q, a, al}}}
--                                          lore text only: spoiler flags, links and metadata stay the English ones.
--                                          faq is the entry's own FAQs in order; fx the questions lore.questions
--                                          appended (their add is the id), by id, so they never depend on position
--                                          and an entry may carry fx alone (no fp) while the rest of it is stale
--   P.names[name] = key, P.quests[title] = key
--                                          what the game client calls NPCs, places and quests in that language
--   P.stop = "der die das ..."             extra stop words for questions typed in the language
--   P.search = {...}, P.dataVersion        search index prebuilt over the merged text, and the ns.DB.version it's for
-- A translator's test pack (kind lang-overlay, LoreForever_LangTest_<locale>, made by the site from their own saved
-- edits) loads after the language pack, or alone, when the player reads its locale. It overrides string by string:
--   P.ui[english] = translation
--   P.fp[key] = Lang.Fingerprint of the English the edits were made on
--   P.strings["<key>/<path>"] = text       paths as the translator kits name them (n, s, h, kw, sec/2/b, faq/1/al,
--                                          fx/<id>/q, ang/<target>); lists are one string, items separated by "|"
-- An entry's strings apply only while its fp matches the English; otherwise the language pack's text (or the English)
-- stands. fx strings need only their id. A test pack has no search index: when it changes any entry, the index is
-- rebuilt at login.
-- Everything is applied once at login, before the engine is built; switching language takes a /reload.

local _, ns = ...
local Lang = {}
ns.Lang = Lang

-- The "·" between the parts of a line. The client's Cyrillic Friz face has no "·" (it draws a box), so a Cyrillic
-- reading language or a Russian client gets the bullet operator "∙", which every Friz and Morpheus face has.
-- Lang.Dotted swaps it into a string; UI strings get it through L, the code's own separators call it.
local CYRILLIC = { ruRU = true, ukUA = true }
Lang.dot = "·"
function Lang.Dotted(s)
  if Lang.dot ~= "·" and type(s) == "string" and s:find("·", 1, true) then return (s:gsub("·", Lang.dot)) end
  return s
end

-- Lang.fallbacks: the UI strings looked up that have no translation (in English, all of them), for /lore qa.
Lang.fallbacks = {}
ns.L = setmetatable({}, { __index = function(_, k)
  if k ~= nil then Lang.fallbacks[k] = true end
  return Lang.Dotted(k)
end })
local L = ns.L

local ENGLISH = { enUS = true, enGB = true }
local ZONE_TYPES = { zone = true, city = true, dungeon = true }

local function settings() return (LoreForeverDB and LoreForeverDB.settings) or {} end
local function lower(s) return ns.Engine and ns.Engine.lower(s) or s:lower() end

function Lang.ClientLocale()
  local ok, loc = pcall(GetLocale or function() return "enUS" end)
  return ok and loc or "enUS"
end

-- Called as the reading language is chosen at login (Lang init).
function Lang.SetDot(reading)
  Lang.dot = (CYRILLIC[reading] or CYRILLIC[Lang.ClientLocale()]) and "∙" or "·"
end

local function packFor(locale, kind)
  for _, rec in ipairs(ns.Packs.List(kind or "lang")) do
    if rec.locale == locale then return rec end
  end
end
local function overlayFor(locale) return packFor(locale, "lang-overlay") end

function Lang.NameOf(locale)
  if ENGLISH[locale] then return "English" end
  local rec = packFor(locale) or overlayFor(locale)
  return (rec and rec.languageName) or locale
end

-- The language the settings ask for: "auto" follows the game client.
function Lang.Wanted()
  local s = settings().language or "auto"
  if s == "auto" then return Lang.ClientLocale(), true end
  return s, false
end

-- The locale the current settings would give after a reload.
function Lang.Resolve()
  if settings().edition then
    for _, rec in ipairs(ns.Packs.List("edition-text")) do
      if rec.edition == settings().edition then return rec.locale or "enUS" end
    end
    return (ns.lang and ns.lang.locale) or "enUS"
  end
  local want = Lang.Wanted()
  if ENGLISH[want] then return "enUS" end
  local rec = packFor(want)
  if rec and rec.loadable then return rec.locale end
  rec = overlayFor(want)   -- a test pack alone also gives the language
  return (rec and rec.loadable) and rec.locale or "enUS"
end

-- The UI strings of another language, for the few labels shown before the reload that switches to it ("Reload now"
-- in the language just picked). Loads that language's pack if needed, which also shows it can load. nil means the
-- language in use (read ns.L); an empty table means English or nothing to read, so the English key stands.
function Lang.StringsFor(locale)
  if ns.lang and locale == ns.lang.locale then return nil end
  if ENGLISH[locale] then return {} end
  local rec, orec = packFor(locale), overlayFor(locale)
  local w = rec and ns.Packs.Load(rec.name)
  local o = orec and ns.Packs.Load(orec.name)
  if not (o and o.ui and next(o.ui)) then return (w and w.ui) or {} end
  local out = {}
  for k, v in pairs((w and w.ui) or {}) do out[k] = v end
  for k, v in pairs(o.ui) do out[k] = v end
  return out
end

function Lang.NeedsReload()
  return ns.lang ~= nil and (Lang.Selected() ~= ns.lang.selection or Lang.Resolve() ~= ns.lang.locale
    or (ns.lang.edition and ns.lang.edition.unavailable))
end

function Lang.Reason(reason)
  return ns.Packs.ReasonText(reason) or tostring(reason)
end

-- Choices for Options: automatic, English, then each installed pack.
function Lang.Choices()
  local out = {
    { id = "auto", label = string.format(L["Automatic (%s)"], Lang.NameOf(Lang.ClientLocale())) },
    { id = "enUS", label = "English" },
  }
  local listed = {}
  for _, rec in ipairs(ns.Packs.List("lang")) do
    if rec.locale and not ENGLISH[rec.locale] then
      listed[rec.locale] = true
      out[#out + 1] = { id = rec.locale, label = rec.languageName or rec.locale,
        reason = (not rec.loadable) and Lang.Reason(rec.reason) or nil }
    end
  end
  -- A test pack for a language whose pack isn't installed still offers the language.
  for _, rec in ipairs(ns.Packs.List("lang-overlay")) do
    if rec.locale and not ENGLISH[rec.locale] and not listed[rec.locale] then
      listed[rec.locale] = true
      out[#out + 1] = { id = rec.locale, label = rec.languageName or rec.locale,
        reason = (not rec.loadable) and Lang.Reason(rec.reason) or nil }
    end
  end
  local listedEditions = {}
  for _, rec in ipairs(ns.Packs.List("edition-text")) do
    if rec.edition and not listedEditions[rec.edition] then
      listedEditions[rec.edition] = true
      local pair, reason = ns.Packs.EditionPair(rec.edition)
      out[#out + 1] = { id = "edition:" .. rec.edition, label = rec.languageName or rec.title,
        reason = not pair and L["Edition unavailable: install or enable both matching components"] or nil }
    end
  end
  local selected = settings().edition
  if selected and not listedEditions[selected] then
    out[#out + 1] = { id = "edition:" .. selected, label = selected,
      reason = L["Edition unavailable: reinstall it or choose another edition"] }
  end
  return out
end

function Lang.Set(id)
  local edition = type(id) == "string" and id:match("^edition:(.+)$")
  if edition then settings().edition = edition
  else settings().edition, settings().language = nil, id end
end

-- What the game client calls things, merged into the name indexes. Pure data: no WoW API, so the pipeline runs it.
function Lang.MergeNames(db, w)
  local idx = db.index
  for name, key in pairs(w.names or {}) do
    if db.entries[key] then
      local n = lower(name)
      idx.name[n] = key
      local typ, rest = key:match("^(%a+):(.+)$")
      if ZONE_TYPES[typ or ""] then idx.zone[n] = rest end
    end
  end
  for title, key in pairs(w.quests or {}) do
    if db.entries[key] then idx.questTitle[lower(title)] = key end
  end
  -- Items: the client's name -> the English name, whose quest links the item index already has.
  for name, english in pairs(w.items or {}) do
    local rec = idx.item and idx.item[lower(english)]
    if rec then idx.item[lower(name)] = rec end
  end
end

-- The shape of an English entry: text lengths and spoiler levels, in order. A pack records it for each entry it
-- translates; if the English entry has changed since (sections added, moved or re-flagged), the translation is left
-- out rather than risk German text sitting under the wrong spoiler flag. Lengths are bytes, so the pipeline computes
-- this through this same function. FAQs appended by pipeline/lore/questions.py (add) are a layer of their own: they
-- are translated by id (fx) and don't make the translation of the rest stale.
function Lang.Fingerprint(e)
  local p = { #(e.n or ""), #(e.s or "") }
  for _, s in ipairs(e.sec or {}) do p[#p + 1] = #s.t .. "." .. #s.b .. "." .. (s.sp or 0) end
  for _, f in ipairs(e.faq or {}) do
    if not f.add then p[#p + 1] = #f.q .. "." .. #f.a .. "." .. (f.sp or 0) end
  end
  return table.concat(p, ",")
end

-- The entry's appended FAQ with this id (lore.questions' add), or nil once its English changed.
local function fxFaq(e, id)
  for _, f in ipairs(e.faq or {}) do
    if f.add == id then return f end
  end
end

-- Translations of an entry's appended FAQs, {[id] = {q, a, al}}. tr: the question is in the reading language now.
local function mergeFx(e, fx)
  for _, f in ipairs(e.faq or {}) do
    local t = f.add and fx[f.add]
    if type(t) == "table" then
      f.q, f.a, f.al = t.q or f.q, t.a or f.a, t.al or f.al
      if t.q then f.tr = true end
    end
  end
end

-- Translated text over the English entries, field by field; spoiler flags, links and metadata stay English. Returns
-- how many entries were skipped because the English changed since the translation.
function Lang.MergeEntries(db, w, merged)
  -- The word-piece vectors that re-rank answers by meaning (Engine:VecOf) are English; over translated text they
  -- mislead ("Was ist die Bruderschaft der Defias?" went to a quest), so a merged pack switches them off.
  if next(w.entries or {}) then db.vectors = nil end
  local skipped = 0
  merged = merged or {}
  for key, t in pairs(w.entries or {}) do
    local e = db.entries[key]
    if e and t.fx then mergeFx(e, t.fx) end   -- by id, whatever else changed
    if not e or (t.fp == nil and t.fx) then
      -- gone, or only appended FAQs: the rest of the entry's translation is out of date
    elseif t.fp ~= Lang.Fingerprint(e) then
      skipped = skipped + 1
    else
      merged[key] = true
      local oldName = e.n
      e.n, e.s, e.h = t.n or e.n, t.s or e.s, t.h or e.h
      if e.n ~= oldName then e.en = e.en or oldName end   -- the English name, so a list search finds either
      if t.kw then
        -- Keep the English keywords too, so English names still find the entry.
        local seen, kw = {}, {}
        for _, list in ipairs({ t.kw, e.kw or {} }) do
          for _, k in ipairs(list) do
            if not seen[k] then seen[k] = true; kw[#kw + 1] = k end
          end
        end
        e.kw = kw
      end
      if t.ang and e.ang then
        for target, text in pairs(t.ang) do
          if e.ang[target] then e.ang[target] = text end
        end
      end
      if t.sec and e.sec and #t.sec == #e.sec then
        for i, s in ipairs(t.sec) do
          e.sec[i].t, e.sec[i].b = s.t or e.sec[i].t, s.b or e.sec[i].b
        end
      end
      local own = 0
      for _, f in ipairs(e.faq or {}) do
        if not f.add then own = own + 1 end
      end
      if t.faq and e.faq and #t.faq == own then
        for i, f in ipairs(t.faq) do
          local o = e.faq[i]
          o.q, o.a, o.al = f.q or o.q, f.a or o.a, f.al or o.al
        end
      end
      -- The translated name finds the entry in answer text too (Engine:Mentions), without taking over a name the
      -- client already uses for something else; places also get it in the zone table (primer, "Entering ...").
      if e.n ~= oldName and not db.index.name[lower(e.n)] then db.index.name[lower(e.n)] = key end
      local typ, rest = key:match("^(%a+):(.+)$")
      if ZONE_TYPES[typ or ""] and db.zones and db.zones[rest] then
        local z = db.zones[rest]
        if e.n ~= z.n then z.en = z.en or z.n end
        z.n = e.n
      end
    end
  end
  return skipped
end

-- A test pack, step 1, before the language pack is merged (fp describes the English): {key = {kw = English keywords}}
-- for each of its entries whose English hasn't changed since the edits were made.
function Lang.OverlayEntries(db, ow)
  local ok = {}
  for key, fp in pairs(ow.fp or {}) do
    local e = db.entries[key]
    if e and fp == Lang.Fingerprint(e) then
      local kw = {}
      for i, k in ipairs(e.kw or {}) do kw[i] = k end
      ok[key] = { kw = kw }
    end
  end
  return ok
end

local function splitList(s)
  local out, seen = {}, {}
  for item in s:gmatch("[^|]+") do
    item = item:match("^%s*(.-)%s*$")
    if item ~= "" and not seen[item] then seen[item] = true; out[#out + 1] = item end
  end
  return out
end

-- Step 2, after the language pack: the test pack's strings over the merged entries, one field each. Returns how many
-- strings were applied and how many were left out because their entry's English changed (or is gone).
function Lang.ApplyOverlay(db, ow, ok)
  local applied, stale = 0, 0
  for id, text in pairs(ow.strings or {}) do
    local key, path = tostring(id):match("^([^/]+)/(.+)$")
    local e = key and db.entries[key]
    local fxid, fg = (path or ""):match("^fx/(%x+)/(%a+)$")
    local fq = fxid and e and fxFaq(e, fxid)
    if type(text) ~= "string" or text == "" or not path then
      -- nothing to apply
    elseif fxid then   -- an appended FAQ, by id: it applies whatever else in the entry changed
      if not fq then
        stale = stale + 1
      elseif fg == "q" or fg == "a" then
        fq[fg] = text
        if fg == "q" then fq.tr = true end
        applied = applied + 1
      elseif fg == "al" then
        fq.al = splitList(text)
        applied = applied + 1
      end
    elseif not e or not ok[key] then
      stale = stale + 1
    else
      local f, i, g = path:match("^(%a+)/(%d+)/(%a+)$")
      i = tonumber(i)
      local target = path:match("^ang/(.+)$")
      local own
      if f == "faq" then   -- the i-th of the entry's own FAQs (appended ones stay English, as in Fingerprint)
        local n = 0
        for _, q in ipairs(e.faq or {}) do
          if not q.add then n = n + 1; if n == i then own = q; break end end
        end
      end
      local done = true
      if path == "n" then
        if text ~= e.n then e.en = e.en or e.n end   -- the English name, so a list search finds either
        e.n = text
        if not db.index.name[lower(text)] then db.index.name[lower(text)] = key end
        local typ, rest = key:match("^(%a+):(.+)$")
        if ZONE_TYPES[typ or ""] and db.zones and db.zones[rest] then
          local z = db.zones[rest]
          if text ~= z.n then z.en = z.en or z.n end
          z.n = text
        end
      elseif path == "s" or path == "h" then
        e[path] = text
      elseif path == "kw" then
        local kw, seen = {}, {}
        for _, list in ipairs({ splitList(text), ok[key].kw }) do
          for _, k in ipairs(list) do
            if not seen[k] then seen[k] = true; kw[#kw + 1] = k end
          end
        end
        e.kw = kw
      elseif f == "sec" and e.sec and e.sec[i] and (g == "t" or g == "b") then
        e.sec[i][g] = text
      elseif own and (g == "q" or g == "a") then
        own[g] = text
      elseif own and g == "al" then
        own.al = splitList(text)
      elseif target and e.ang and e.ang[target] then
        e.ang[target] = text
      else
        done = false   -- a path this entry doesn't have
      end
      if done then applied = applied + 1 end
    end
  end
  return applied, stale
end

-- After the merge, in a translated reading language: the appended FAQs whose question is still English get untr, so
-- the engine offers translated questions ahead of them (Engine.RankedFaq) until a translator gets to them.
function Lang.MarkUntranslated(db)
  local n = 0
  for _, e in pairs(db.entries) do
    for _, f in ipairs(e.faq or {}) do
      if f.add and not f.tr then f.untr, n = true, n + 1 end
    end
  end
  return n
end

-- Login: find and load the packs the settings call for, before the engine is built. Leaves ns.lang = {locale, name,
-- client, notes}; notes are chat lines for Core to print.
local function init(lang)
  local Packs, db = ns.Packs, ns.DB
  Packs.Scan()
  local client = lang.client
  local want, auto = Lang.Wanted()
  Lang.SetDot(want)
  local function note(fmt, ...) lang.notes[#lang.notes + 1] = string.format(fmt, ...) end

  -- quiet: say nothing when no pack is installed (automatic on a client nobody has translated for yet, or client
  -- names while the player reads another language). An installed pack for the reading language that can't load is
  -- always worth a line.
  local function load(locale, quiet)
    if ENGLISH[locale] then return nil end
    local rec = packFor(locale)
    if not rec then
      if not quiet then note(L["No %s language pack is installed; using English."], locale) end
      return nil
    end
    local w, reason = Packs.Load(rec.name)
    if not w then
      rec.loadable, rec.reason = false, reason
      if not quiet or locale == want then
        note(L["The %s language pack can't load (%s); using English."], rec.languageName or locale, Lang.Reason(reason))
      end
    end
    return w, rec
  end

  -- A translator's test pack for the reading language; with one, a missing language pack isn't worth a note.
  local orec = not ENGLISH[want] and overlayFor(want) or nil

  -- Client names first: they describe the game client, whichever language the player reads.
  local cw, crec = load(client, auto or want ~= client or orec ~= nil)
  if cw then Lang.MergeNames(db, cw) end
  local tw, trec = cw, crec
  if want ~= client then tw, trec = load(want, orec ~= nil) end
  if ENGLISH[want] then return end
  local ow
  if orec then
    local reason
    ow, reason = Packs.Load(orec.name)
    if not ow then
      orec.loadable, orec.reason = false, reason
      note(L["Your test translations can't load (%s)."], Lang.Reason(reason))
    end
  end
  if not tw and not ow then return end
  local rec = (tw and trec) or orec
  -- A failure halfway through the merge must not leave English complete hashes beside translated text.
  db.fullclips, db.fullclipsLocale = {}, rec.locale

  local overlayOK = ow and Lang.OverlayEntries(db, ow)   -- before the merge: fp is over the English
  for k, v in pairs((tw and tw.ui) or {}) do rawset(L, k, Lang.Dotted(v)) end
  for k, v in pairs((ow and ow.ui) or {}) do
    if type(v) == "string" and v ~= "" then rawset(L, k, Lang.Dotted(v)) end
  end
  local merged = {}
  if tw then
    local skipped = Lang.MergeEntries(db, tw, merged)
    if ns.debug and skipped > 0 then note("%d translated entries skipped: the English changed since", skipped) end
    if tw.stop and ns.Engine then ns.Engine.AddStopWords(tw.stop) end
    local built = tw.dataVersion or trec.dataVersion
    if tw.search and built == db.version then
      db.search = tw.search
    else
      db.search = nil   -- Engine.new rebuilds it over the merged text (slower login)
      if built ~= db.version then
        note(L["The %s language pack was made for a different version of Lore Forever; update it for faster loading."],
          trec.languageName or trec.locale)
      end
    end
  else
    db.search = nil   -- a test pack alone: the English index won't find the translated text
  end
  if ow then
    local applied, stale = Lang.ApplyOverlay(db, ow, overlayOK)
    if applied > 0 then
      db.search = nil    -- the prebuilt index is over the pack's text, not the test pack's
      db.vectors = nil   -- and the English word-piece vectors don't fit translated text (see MergeEntries)
    end
    note(L["Your test translations: %d lines in use, %d left out (the English changed)."], applied, stale)
    lang.overlay = orec.name
  end
  Lang.MarkUntranslated(db)
  -- Voice packs match recordings to the text by clipHash: the pack's hashes (for recordings in this language) replace
  -- the English ones, and Voice only picks packs in the reading language. Voice.Init runs after this. The answers
  -- packs' hashes (answerHash, LOR-227) too.
  db.clipHash = (tw and tw.clipHash) or {}
  db.answerHash = (tw and tw.answerHash) or {}
  -- Complete stories have their own hash. Only translations that actually merged may validate a recording;
  -- an overlay that changes narrated text cannot reuse a built complete-story receipt.
  for key, hash in pairs((tw and tw.fullclips) or {}) do
    local entry, translated = db.entries[key], tw.entries and tw.entries[key]
    if merged[key] and translated and entry and entry.n == translated.n and entry.s == translated.s then
      local same = type(entry.sec) == "table" and type(translated.sec) == "table" and #entry.sec == #translated.sec
      for i, section in ipairs(same and entry.sec or {}) do
        if (section.sp or 0) == 0 and section.b ~= translated.sec[i].b then same = false; break end
      end
      if same then db.fullclips[key] = hash end
    end
  end
  lang.merged = merged   -- scoped contributed recordings require text that actually merged
  lang.locale, lang.name, lang.pack = rec.locale, rec.languageName or rec.locale, rec.name
  ns.readingLocale = rec.locale
end


-- Applied edition identity is frozen at login; changing settings never mixes a live page and another voice.
function Lang.Selected()
  local id = settings().edition
  return type(id) == "string" and id ~= "" and ("edition:" .. id) or (settings().language or "auto")
end

function Lang.EditionKey()
  local e = ns.lang and ns.lang.edition
  return e and (e.id .. ":" .. (e.version or "unavailable")) or "stock"
end

function Lang.FaqID(key, idx)
  local e = ns.DB and ns.DB.entries[key]
  local f = e and e.faq and e.faq[idx]
  return key .. "#faq" .. tostring(f and f.i or idx)
end

function Lang.FaqIndex(key, original)
  original = tonumber(original)
  if not (ns.lang and ns.lang.edition) then return original end
  local e = ns.DB and ns.DB.entries[key]
  for i, f in ipairs(e and e.faq or {}) do if f.i == original then return i end end
end

function Lang.FaqNumber(key, idx)
  local e = ns.DB and ns.DB.entries[key]
  local f = e and e.faq and e.faq[idx]
  return f and f.i or idx
end

local function emptyEdition(db)
  db.entries, db.zones, db.storylines = {}, {}, {}
  db.index = { name = {}, quest = {}, questTitle = {}, area = {}, zone = {}, mob = {}, item = {}, story = {} }
  db.clipHash, db.answerHash, db.clipNarrator, db.fullclips, db.questClip, db.questVoice = {}, {}, {}, {}, {}, {}
  db.search, db.vectors, db.count = nil, nil, 0
end

local function text(s) return type(s) == "string" and s:find("%S") ~= nil end
local function hash(s) return type(s) == "string" and #s == 6 and s:match("^%x+$") ~= nil end

local function exact(a, b, depth)
  if type(a) ~= type(b) then return false end
  if type(a) ~= "table" then return a == b end
  if depth > 16 then return false end
  for k, v in pairs(a) do if not exact(v, b[k], depth + 1) then return false end end
  for k in pairs(b) do if a[k] == nil then return false end end
  return true
end

-- Same text shape as pipeline.lore.i18n.english_text; guards are checked independently of byte lengths.
-- This receipt is compatibility proof only. None of its English prose is copied into the edition DB.
function Lang.EditionSourceMatches(e, source)
  if type(source) ~= "table" or type(source.text) ~= "table" or type(source.sp) ~= "table" then return false end
  local supplied = source.text
  local receipt = { n = supplied.n, s = supplied.s, sec = supplied.sec or {}, faq = {},
    kw = supplied.kw or {}, ang = supplied.ang or {} }
  if supplied.faq ~= nil and type(supplied.faq) ~= "table" then return false end
  for i, f in ipairs(supplied.faq or {}) do
    if type(f) ~= "table" then return false end
    receipt.faq[i] = { q = f.q, a = f.a, al = f.al or {} }
  end
  local wanted = { n = e.n, s = e.s, sec = {}, faq = {}, kw = e.kw or {}, ang = e.ang or {} }
  local guards = { sec = {}, faq = {} }
  for i, s in ipairs(e.sec or {}) do
    wanted.sec[i], guards.sec[i] = { t = s.t, b = s.b }, s.sp or 0
  end
  for _, f in ipairs(e.faq or {}) do
    if not f.add then
      wanted.faq[#wanted.faq + 1] = { q = f.q, a = f.a, al = f.al or {} }
      guards.faq[#guards.faq + 1] = f.sp or 0
    end
  end
  if not exact(wanted, receipt, 0) then return false end
  for field, expected in pairs(guards) do
    local provided = source.sp[field] or {}
    if type(provided) ~= "table" then return false end
    for i, flag in ipairs(expected) do if (provided[i] or 0) ~= flag then return false end end
    for i in pairs(provided) do
      if type(i) ~= "number" or i % 1 ~= 0 or i < 1 or i > #expected then return false end
    end
  end
  return true
end

function Lang.ApplyEdition(db, pair)
  local original, index, oldZones = db.entries, db.index, db.zones or {}
  emptyEdition(db)
  db.fullclipsLocale = pair.locale
  for key, t in pairs(pair.text.entries) do
    local old = original[key]
    if type(t) == "table" and old and t.fp == Lang.Fingerprint(old)
        and Lang.EditionSourceMatches(old, t.source) and text(t.s) then
      -- Only supplied prose belongs to this edition. Metadata is copied separately, never stock prose/FAQ aliases.
      local e = { n = text(t.n) and t.n or L["Story"], s = t.s, sec = {}, faq = {},
        t = old.t, z = old.z, m = old.m, fv = old.fv, src = old.src, rel = {} }
      local seen = {}
      for _, f in ipairs(type(t.faq) == "table" and t.faq or {}) do
        local i = type(f) == "table" and tonumber(f.i)
        local source = i and old.faq and old.faq[i]
        if i and i % 1 == 0 and source and not seen[i] and text(f.a) and f.answerOnly == true then
          seen[i] = true
          local guard = math.max(tonumber(f.sp) or 0, tonumber(source.sp) or 0)
          e.faq[#e.faq + 1] = { q = string.format(L["Answer %d"], i), a = f.a, h = f.h, i = i,
            answerOnly = true, sp = guard > 0 and guard or nil }
          local all = pair.text.answerHash[key]
          local expected = type(all) == "string" and all:sub(i * 6 - 5, i * 6)
          if hash(f.h) and expected == f.h then db.clipHash[key .. "#faq" .. i] = f.h end
        end
      end
      table.sort(e.faq, function(a, b) return a.i < b.i end)
      db.entries[key], db.count = e, db.count + 1
      if hash(t.h) and pair.text.clipHash[key] == t.h then db.clipHash[key] = t.h end
    end
  end
  -- Retain only names/IDs that lead to visible text. Zone groups can retain visible children without a zone story.
  for _, field in ipairs({ "name", "quest", "questTitle", "area", "mob" }) do
    for k, v in pairs(index[field] or {}) do if db.entries[v] then db.index[field][k] = v end end
  end
  for key, e in pairs(db.entries) do
    db.index.name[lower(e.n)] = key
    for _, k in ipairs(original[key].rel or {}) do if db.entries[k] then e.rel[#e.rel + 1] = k end end
    if e.z and oldZones[e.z] then
      local z, ze = oldZones[e.z], db.entries["zone:" .. e.z]
      local bosses = {}
      for _, k in ipairs(z.b or {}) do if db.entries[k] then bosses[#bosses + 1] = k end end
      db.zones[e.z] = { n = ze and ze.n or L["Place"], t = z.t, lv = z.lv, tier = z.tier, fa = z.fa, b = bosses }
    end
  end
  for k, z in pairs(index.zone or {}) do if db.zones[z] then db.index.zone[k] = z end end
  -- Item requirements are mechanical quest IDs; omit IDs whose text is hidden.
  for name, rec in pairs(index.item or {}) do
    local kept = {}
    for field, ids in pairs(rec) do
      if type(ids) == "table" then
        local list = {}
        for _, id in ipairs(ids) do if db.index.quest[id] then list[#list + 1] = id end end
        if #list > 0 then kept[field] = list end
      end
    end
    if next(kept) then db.index.item[name] = kept end
  end
end

function Lang.ValidateEdition()
  local e = ns.lang and ns.lang.edition
  if not e then return true end
  if e.unavailable then return false end
  local pair = ns.Packs.EditionPair(e.id)
  if pair and pair.version == e.version and pair.textName == e.textName and pair.voiceName == e.voiceName then return true end
  if ns.UI and ns.UI.frame and ns.UI.Archive then ns.UI.Archive() end
  e.unavailable = true
  emptyEdition(ns.DB)
  if ns.Voice then
    ns.Voice.Stop()
    ns.Voice.ready, ns.Voice.autoToken, ns.Voice.autoWaiting = false, nil, nil
    ns.Voice.lastClip = nil
  end
  if ns.UI then
    ns.UI.progress, ns.UI.resumeTarget, ns.UI.activeTarget = {}, nil, nil
    ns.UI.speaking, ns.UI.playingId = false, nil
    ns.UI.playToken = nil
    ns.UI.msgs, ns.UI.blocks = {}, {}
    if ns.UI.pl then ns.UI.pl.items, ns.UI.pl.pos, ns.UI.pl.state, ns.UI.pl.token = {}, 0, "paused", nil end
  end
  if ns.engine then
    ns.engine = ns.Engine.new(ns.DB)
    if ns.UI then ns.UI.engine = ns.engine end
  end
  if ns.UI and ns.UI.frame then
    ns.UI.SetNext({})
    ns.UI.NavClear()
    ns.UI.HideCompletion()
    ns.UI.Render()
  end
  return false
end

function Lang.Init()
  local lang = { locale = "enUS", client = Lang.ClientLocale(), notes = {} }
  ns.lang = lang
  Lang.SetDot()   -- the client's own alphabet; init adds the reading language's
  lang.selection = Lang.Selected()
  if settings().edition then
    ns.Packs.Scan()
    lang.edition = { id = settings().edition, unavailable = true }
    lang.locale, lang.name = Lang.Resolve(), settings().edition
    ns.readingLocale = lang.locale
    local ok, pair = pcall(ns.Packs.EditionPair, settings().edition)
    if ok and pair then
      lang.edition, lang.locale, lang.name, lang.pack = pair, pair.locale, pair.name, pair.textName
      ns.readingLocale = pair.locale
      local applied = pcall(Lang.ApplyEdition, ns.DB, pair)
      if applied then return lang end
      lang.edition.unavailable = true
    end
    emptyEdition(ns.DB)
    lang.notes[#lang.notes + 1] = L["Edition unavailable. Reinstall or enable both matching components, or choose another edition in Options and reload."]
    return lang
  end
  -- A broken pack must not take the add-on down with it: report it and carry on with what loaded.
  local ok, err = pcall(init, lang)
  if not ok then
    lang.notes[#lang.notes + 1] = string.format(L["The language pack failed to load (%s); some text may be English."],
      tostring(err))
  end
  if ns.Theme and ns.Theme.SetLanguageFonts then ns.Theme.SetLanguageFonts(lang.locale) end
  return lang
end
