-- Languages. UI strings go through ns.L, keyed by their English text, so a string a pack doesn't translate stays
-- English. A language pack (LoreForever_Lang_<locale>, see Packs.lua) supplies, through its writer P:
--   P.ui[english] = translation            UI strings
--   P.entries[key] = {n, s, h, kw, ang, sec = {{t, b}}, faq = {{q, a, al}}}
--                                          lore text only: spoiler flags, links and metadata stay the English ones
--   P.names[name] = key, P.quests[title] = key
--                                          what the game client calls NPCs, places and quests in that language
--   P.stop = "der die das ..."             extra stop words for questions typed in the language
--   P.search = {...}, P.dataVersion        search index prebuilt over the merged text, and the ns.DB.version it's for
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

local function packFor(locale)
  for _, rec in ipairs(ns.Packs.List("lang")) do
    if rec.locale == locale then return rec end
  end
end

function Lang.NameOf(locale)
  if ENGLISH[locale] then return "English" end
  local rec = packFor(locale)
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
  return (rec and rec.loadable) and rec.locale or "enUS"
end

-- The UI strings of another language, for the few labels shown before the reload that switches to it ("Reload now"
-- in the language just picked). Loads that language's pack if needed, which also shows it can load. nil means the
-- language in use (read ns.L); an empty table means English or nothing to read, so the English key stands.
function Lang.StringsFor(locale)
  if ns.lang and locale == ns.lang.locale then return nil end
  if ENGLISH[locale] then return {} end
  local rec = packFor(locale)
  local w = rec and ns.Packs.Load(rec.name)
  return (w and w.ui) or {}
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
  for _, rec in ipairs(ns.Packs.List("lang")) do
    if rec.locale and not ENGLISH[rec.locale] then
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
-- this through this same function.
function Lang.Fingerprint(e)
  local p = { #(e.n or ""), #(e.s or "") }
  for _, s in ipairs(e.sec or {}) do p[#p + 1] = #s.t .. "." .. #s.b .. "." .. (s.sp or 0) end
  for _, f in ipairs(e.faq or {}) do p[#p + 1] = #f.q .. "." .. #f.a .. "." .. (f.sp or 0) end
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
      if t.faq and e.faq and #t.faq == #e.faq then
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

  -- Client names first: they describe the game client, whichever language the player reads.
  local cw, crec = load(client, auto or want ~= client)
  if cw then Lang.MergeNames(db, cw) end
  local tw, trec = cw, crec
  if want ~= client then tw, trec = load(want, false) end
  if not tw or ENGLISH[want] then return end

  for k, v in pairs(tw.ui or {}) do rawset(L, k, v) end
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
  -- Voice packs match recordings to the text by clipHash: the pack's hashes (for recordings in this language) replace
  -- the English ones, and Voice only picks packs in the reading language. Voice.Init runs after this.
  db.clipHash = tw.clipHash or {}
  lang.locale, lang.name, lang.pack = trec.locale, trec.languageName or trec.locale, trec.name
  ns.readingLocale = trec.locale
  lang.ttsVoices = {}
  for hint in (trec.ttsVoices or tw.ttsVoices or ""):gmatch("[^|,]+") do
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
