-- Languages. UI strings go through ns.L, keyed by their English text, so a string a pack doesn't translate stays
-- English. A language pack (LoreForever_Lang_<locale>, see Packs.lua) supplies, through its writer P:
--   P.ui[english] = translation            UI strings
--   P.entries[key] = {n, s, h, kw, ang, sec = {{t, b}}, faq = {{q, a, al}}}
--                                          lore text only: spoiler flags, links and metadata stay the English ones
--   P.names[name] = key, P.quests[title] = key
--                                          what the game client calls NPCs, places and quests in that language
--   P.stop = "der die das ..."             extra stop words for questions typed in the language
--   P.search = {...}, P.dataVersion        search index prebuilt over the merged text, and the ns.DB.version it's for
-- A translator's test pack (kind lang-overlay, LoreForever_LangTest_<locale>, made by the site from their own saved
-- edits) loads after the language pack, or alone, when the player reads its locale. It overrides string by string:
--   P.ui[english] = translation
--   P.fp[key] = Lang.Fingerprint of the English the edits were made on
--   P.strings["<key>/<path>"] = text       paths as the translator kits name them (n, s, h, kw, sec/2/b, faq/1/al,
--                                          ang/<target>); lists are one string, items separated by "|"
-- An entry's strings apply only while its fp matches the English; otherwise the language pack's text (or the English)
-- stands. A test pack has no search index: when it changes any entry, the index is rebuilt at login.
-- Everything is applied once at login, before the engine is built; switching language takes a /reload.

local _, ns = ...
local Lang = {}
ns.Lang = Lang

ns.L = setmetatable({}, { __index = function(_, k) return k end })
local L = ns.L

local ENGLISH = { enUS = true, enGB = true }
local ZONE_TYPES = { zone = true, city = true, dungeon = true }

local function settings() return (LoreForeverDB and LoreForeverDB.settings) or {} end
local function lower(s) return ns.Engine and ns.Engine.lower(s) or s:lower() end

function Lang.ClientLocale()
  local ok, loc = pcall(GetLocale or function() return "enUS" end)
  return ok and loc or "enUS"
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
  return ns.lang ~= nil and Lang.Resolve() ~= ns.lang.locale
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
  return out
end

function Lang.Set(id)
  settings().language = id
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
-- stay English and don't make the translation of the rest stale.
function Lang.Fingerprint(e)
  local p = { #(e.n or ""), #(e.s or "") }
  for _, s in ipairs(e.sec or {}) do p[#p + 1] = #s.t .. "." .. #s.b .. "." .. (s.sp or 0) end
  for _, f in ipairs(e.faq or {}) do
    if not f.add then p[#p + 1] = #f.q .. "." .. #f.a .. "." .. (f.sp or 0) end
  end
  return table.concat(p, ",")
end

-- Translated text over the English entries, field by field; spoiler flags, links and metadata stay English. Returns
-- how many entries were skipped because the English changed since the translation.
function Lang.MergeEntries(db, w)
  local skipped = 0
  for key, t in pairs(w.entries or {}) do
    local e = db.entries[key]
    if e and t.fp ~= Lang.Fingerprint(e) then
      skipped = skipped + 1
    elseif e then
      local oldName = e.n
      e.n, e.s, e.h = t.n or e.n, t.s or e.s, t.h or e.h
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
      if ZONE_TYPES[typ or ""] and db.zones and db.zones[rest] then db.zones[rest].n = e.n end
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
    if type(text) ~= "string" or text == "" or not path then
      -- nothing to apply
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
        e.n = text
        if not db.index.name[lower(text)] then db.index.name[lower(text)] = key end
        local typ, rest = key:match("^(%a+):(.+)$")
        if ZONE_TYPES[typ or ""] and db.zones and db.zones[rest] then db.zones[rest].n = text end
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

-- Login: find and load the packs the settings call for, before the engine is built. Leaves ns.lang = {locale, name,
-- client, ttsVoices, notes}; notes are chat lines for Core to print.
local function init(lang)
  local Packs, db = ns.Packs, ns.DB
  Packs.Scan()
  local client = lang.client
  local want, auto = Lang.Wanted()
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

  local overlayOK = ow and Lang.OverlayEntries(db, ow)   -- before the merge: fp is over the English
  for k, v in pairs((tw and tw.ui) or {}) do rawset(L, k, v) end
  for k, v in pairs((ow and ow.ui) or {}) do
    if type(v) == "string" and v ~= "" then rawset(L, k, v) end
  end
  if tw then
    local skipped = Lang.MergeEntries(db, tw)
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
    if applied > 0 then db.search = nil end   -- the prebuilt index is over the pack's text, not the test pack's
    note(L["Your test translations: %d lines in use, %d left out (the English changed)."], applied, stale)
    lang.overlay = orec.name
  end
  -- Voice packs match recordings to the text by clipHash: the pack's hashes (for recordings in this language) replace
  -- the English ones, and Voice only picks packs in the reading language. Voice.Init runs after this.
  db.clipHash = (tw and tw.clipHash) or {}
  lang.locale, lang.name, lang.pack = rec.locale, rec.languageName or rec.locale, rec.name
  ns.readingLocale = rec.locale
  lang.ttsVoices = {}
  for hint in ((tw and trec.ttsVoices) or (tw and tw.ttsVoices) or (orec and orec.ttsVoices) or ""):gmatch("[^|,]+") do
    lang.ttsVoices[#lang.ttsVoices + 1] = lower(hint:match("^%s*(.-)%s*$"))
  end
end

function Lang.Init()
  local lang = { locale = "enUS", client = Lang.ClientLocale(), notes = {} }
  ns.lang = lang
  -- A broken pack must not take the add-on down with it: report it and carry on with what loaded.
  local ok, err = pcall(init, lang)
  if not ok then
    lang.notes[#lang.notes + 1] = string.format(L["The language pack failed to load (%s); some text may be English."],
      tostring(err))
  end
  return lang
end
