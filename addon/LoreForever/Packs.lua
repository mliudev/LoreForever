-- Packs: separate add-ons that extend Lore Forever (voice packs now, language packs later), shared by both kinds.
-- A pack is a load-on-demand add-on that depends on LoreForever and says what it is in its .toc:
--   ## X-LoreForever-Pack: voice | lang | lang-overlay   ## X-LoreForever-Locale: enUS   ## X-LoreForever-Format: 1
--   (lang-overlay: a translator's test pack from /translate/dashboard, LoreForever_LangTest_<locale>; see Lang.lua)
--   ## X-LoreForever-DataVersion: ...        (optional, ns.DB.version it was built against; a mismatch only warns)
--   ## X-LoreForever-Credit: ...  ## X-LoreForever-Sample: <clip id>   (voice packs, optional)
--   ## X-LoreForever-Extends: <voice pack>   (voice packs, optional: a lands pack that adds clips to that voice; it
--   isn't a voice of its own, and does nothing without its base; see Voice.Refresh)
--   ## X-LoreForever-Races: orc, troll       (voice packs, optional: the races whose stories this voice suits, for
--   "Prefer voices that suit the race"; see Voice.Races)
--   ## X-LoreForever-Gender: male | female   (voice packs, optional: for matching quest givers; see Voice.Gender)
--   A voice pack whose name ends in a locale (LoreForever_Voice_Female_deDE) is that voice in that language: it plays
--   in its place while the add-on shows the language (see Voice.KeyOf, Voice.InLanguage). A quest dialogue pack in
--   another language (LoreForever_Voice_Female_Quests_deDE) also writes P.questVoice: the fingerprints of the game's
--   own quest text in that language, which the add-on's data doesn't have (see Voice.QuestClip), and P.questText: the
--   words each recording reads (["quest:176#detail"] = "..."), shown as subtitles when it plays over the game's
--   English page, and P.questTitle: each quest's title in that language (["176"] = "..."), the subtitles' and player's.
-- Add-ons can't discover files at runtime, so packs are found through the game's add-on list and load when chosen.
-- A pack's only code is `local P = LoreForeverPacks.Begin(...)` followed by writes into P (e.g. P.clips[id] = hash).
--   A voice pack of ours also writes P.len[id] = tenths of a second, how long that clip's recording plays (read from
--   the MP3 when the pack is built), for the subtitles; a clip with none (a story in pieces knows its length from
--   Transport.lua, a community pack's recordings carry none) is timed by the voice's speed.

local _, ns = ...
local Packs = { registry = {}, byName = {}, data = {} }
ns.Packs = Packs

Packs.FORMAT = 1   -- the newest pack format this version understands
local PREFIX = { voice = "LoreForever_Voice_", lang = "LoreForever_Lang_", ["lang-overlay"] = "LoreForever_LangTest_" }

-- What each kind of pack can write. Unknown kinds get nothing.
local WRITERS = {
  ["edition-text"] = function() return { entries = {}, clipHash = {}, answerHash = {} } end,
  ["edition-voice"] = function() return { clips = {} } end,
  voice = function() return { clips = {}, len = {} } end,   -- len: clip id -> how long its recording plays, in tenths of a second
  lang = function() return { ui = {}, entries = {}, names = {}, quests = {}, shown = {}, items = {}, clipHash = {}, answerHash = {} } end,   -- see Lang.lua
  ["lang-overlay"] = function() return { ui = {}, strings = {}, fp = {} } end,
}

-- The add-on API moved into C_AddOns; older clients have the same calls as globals.
local A = _G.C_AddOns or {}
local function results(ok, ...)
  if not ok then return nil end
  return ...
end
local function call(name, ...)
  local f = A[name] or _G[name]
  if not f then return nil end
  return results(pcall(f, ...))
end

local function meta(addon, field)
  local v = call("GetAddOnMetadata", addon, field)
  if type(v) == "string" and v ~= "" then return v end
end

local function plain(s) return (tostring(s or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")) end

-- Narration taken back (LOR-567): pack name -> the newest version of it that must not play. Releases stamp the core's
-- version into every pack they ship, so an installed copy at or below it is the withdrawn recording, and a re-recorded
-- edition (released later, so a higher version) plays again with no change here. Such a pack shows as paused in the
-- voices list and never loads, so its language shows text. The Brazilian Portuguese narrators: the "male" voice was a
-- woman, and both had a European accent; both are back with new native recordings (male 10/19, female 10/21), so their
-- entries stay at the last version that carried the old ones. pipeline/tests/test_release_packs.py keeps each entry at
-- or above the folder's .toc version while the pack is out of the release, and below it once it is back in.
Packs.WITHDRAWN = {
  LoreForever_Voice_Default_ptBR = "0.18.0",
  LoreForever_Voice_Female_ptBR = "0.18.0",
}

local function versionAtMost(v, upto)
  local a, b = {}, {}
  for n in tostring(v):gmatch("%d+") do a[#a + 1] = tonumber(n) end
  for n in tostring(upto):gmatch("%d+") do b[#b + 1] = tonumber(n) end
  for i = 1, math.max(#a, #b) do
    local x, y = a[i] or 0, b[i] or 0
    if x ~= y then return x < y end
  end
  return true
end

-- Whether this copy of a pack is a withdrawn edition. Before loading, a version the client can't read yet doesn't
-- count (it's read again once loaded); once loaded, a pack on the list without a readable version counts.
local function withdrawn(rec, loaded)
  local upto = Packs.WITHDRAWN[rec.name]
  if not upto then return false end
  if not rec.version then return loaded and true or false end
  return versionAtMost(rec.version, upto)
end
Packs.IsWithdrawn = withdrawn

local function kindOf(name)
  -- Playback shards register their receipts on the source narrator, never their own voice writer.
  if meta(name, "X-LoreForever-Transport-For") or (name:sub(1, 18) == "LoreForever_Voice_" and name:find("_Transport_", 1, true)) then return "transport" end
  local k = meta(name, "X-LoreForever-Pack")
  if k then return k end
  for kind, prefix in pairs(PREFIX) do
    if name:sub(1, #prefix) == prefix then return kind end
  end
end

-- Fill in (or refresh) a registry record from the .toc. Metadata of add-ons that aren't loaded yet may be unreadable on
-- some clients; it's read again after loading.
-- Names that show in the player's own font (the Options list of installed packs, the language lists). A client's
-- default font draws only its own script: an English or German client shows Cyrillic, Chinese and Korean as boxes.
-- Packs.Drawable(text) says whether this client's font can draw every letter in text; Packs.LanguageName(locale)
-- gives a language's own name when it can, and the English name when it can't.
Packs.ENGLISH_NAMES = { enUS = "English", enGB = "English", deDE = "German", frFR = "French", esES = "Spanish",
  esMX = "Spanish (Latin America)", ptBR = "Portuguese (Brazil)", itIT = "Italian", ruRU = "Russian",
  koKR = "Korean", zhCN = "Chinese (Simplified)", zhTW = "Chinese (Traditional)", ukUA = "Ukrainian",
  roRO = "Romanian", svSE = "Swedish" }
-- Which scripts each client locale's font covers, besides Latin.
local CLIENT_SCRIPTS = { ruRU = { cyrillic = true }, zhCN = { han = true }, zhTW = { han = true },
  koKR = { han = true, hangul = true } }

function Packs.Drawable(text)
  if type(text) ~= "string" then return true end
  local ok, loc = pcall(_G.GetLocale or function() return "enUS" end)
  local covers = CLIENT_SCRIPTS[ok and loc or "enUS"] or {}
  for i = 1, #text do
    local b = text:byte(i)
    local script
    if b >= 205 and b <= 223 then script = (b >= 208 and b <= 211) and "cyrillic" or "other"   -- Greek ... Arabic, Cyrillic
    elseif b >= 227 and b <= 233 then script = "han"      -- CJK, kana and their punctuation
    elseif b >= 234 and b <= 237 then script = "hangul"
    end
    if script and not covers[script] then return false end
  end
  return true
end

function Packs.LanguageName(locale, native)
  if native and native ~= "" and Packs.Drawable(native) then return native end
  return Packs.ENGLISH_NAMES[locale] or locale
end

local function describe(rec)
  local n = rec.name
  rec.kind = kindOf(n) or rec.kind
  rec.edition = meta(n, "X-LoreForever-Edition")
  rec.editionVersion = meta(n, "X-LoreForever-EditionVersion")
  rec.editionPeer = meta(n, "X-LoreForever-EditionPeer")
  rec.editionAPI = tonumber(meta(n, "X-LoreForever-EditionAPI") or "")
  local prefix = (rec.kind == "lang" or rec.kind == "lang-overlay") and PREFIX[rec.kind]
  -- Before its .toc can be read: a language pack's locale ends its name, and so does a voice pack's in another
  -- language (LoreForever_Voice_Female_deDE, see Voice.KeyOf).
  rec.locale = meta(n, "X-LoreForever-Locale") or rec.locale
    or (prefix and n:sub(1, #prefix) == prefix and n:sub(#prefix + 1))
    or (rec.kind == "voice" and n:match("_(%l%l%u%u)$")) or nil
  rec.format = tonumber(meta(n, "X-LoreForever-Format") or "") or rec.format
  rec.dataVersion = meta(n, "X-LoreForever-DataVersion") or rec.dataVersion
  rec.languageName = meta(n, "X-LoreForever-LanguageName") or rec.languageName
  rec.credit = meta(n, "X-LoreForever-Credit") or rec.credit
  rec.sample = meta(n, "X-LoreForever-Sample") or rec.sample
  rec.extends = meta(n, "X-LoreForever-Extends") or rec.extends
  rec.transportFor = meta(n, "X-LoreForever-Transport-For") or rec.transportFor
  rec.races = meta(n, "X-LoreForever-Races") or rec.races
  rec.gender = meta(n, "X-LoreForever-Gender") or rec.gender
  rec.version = meta(n, "Version") or rec.version
  rec.author = meta(n, "Author") or rec.author
  rec.title = plain(meta(n, "Title") or rec.title or n)
  -- A title or language name this client's font can't draw shows in English (the community packs' .tocs stay as they are).
  if rec.languageName and not Packs.Drawable(rec.languageName) then
    rec.languageName = Packs.ENGLISH_NAMES[rec.locale] or rec.locale
  end
  if not Packs.Drawable(rec.title) then
    local english = Packs.ENGLISH_NAMES[rec.locale] or rec.locale
    if not english then rec.title = n
    elseif rec.kind == "voice" then rec.title = "Lore Forever: " .. english .. " narrator"
    else rec.title = "Lore Forever - " .. english end
  end
  if rec.format and rec.format > Packs.FORMAT then rec.loadable, rec.reason = false, "NEWER_FORMAT" end
  if withdrawn(rec) then rec.loadable, rec.reason = false, "WITHDRAWN" end
  return rec
end

-- Walk the add-on list and record every pack. Safe to call again (e.g. from tests); keeps what's already loaded.
function Packs.Scan()
  local reg, by = {}, {}
  for i = 1, call("GetNumAddOns") or 0 do
    local name, title, _, loadable, reason = call("GetAddOnInfo", i)
    local kind = name and kindOf(name)
    if kind then
      local rec = Packs.byName[name] or { name = name }
      rec.kind, rec.title = kind, title
      if Packs.data[name] and kind ~= "edition-text" and kind ~= "edition-voice" then
        rec.loadable, rec.reason = true, nil
      elseif reason == "DEMAND_LOADED" then   -- load-on-demand and not loaded yet: that's the normal state
        rec.loadable, rec.reason = true, nil
      else
        rec.loadable, rec.reason = loadable and true or false, reason
      end
      describe(rec)
      reg[#reg + 1], by[name] = rec, rec
    end
  end
  table.sort(reg, function(a, b) return a.title:lower() < b.title:lower() end)
  Packs.registry, Packs.byName = reg, by
  return reg
end

function Packs.List(kind)
  local out = {}
  for _, rec in ipairs(Packs.registry) do
    if rec.kind == kind then out[#out + 1] = rec end
  end
  return out
end

function Packs.Get(name) return Packs.byName[name] end

-- Load a pack (once) and return what it registered, or nil and a reason. Loaded packs are never unloaded.
function Packs.Load(name)
  local rec = Packs.byName[name]
  if not rec then return nil, "MISSING" end
  if rec.kind == "edition-text" or rec.kind == "edition-voice" then
    local present, _, _, loadable, reason = call("GetAddOnInfo", name)
    if not present or reason == "DISABLED" or (not loadable and reason ~= "DEMAND_LOADED") then
      return nil, reason or "MISSING"
    end
    describe(rec)
  end
  if Packs.data[name] and not (rec.format and rec.format > Packs.FORMAT) then return Packs.data[name] end
  if rec.format and rec.format > Packs.FORMAT then return nil, "NEWER_FORMAT" end
  if withdrawn(rec) then return nil, "WITHDRAWN" end
  if InCombatLockdown and InCombatLockdown() then return nil, "COMBAT" end
  Packs.loading = name
  local loaded, reason = call("LoadAddOn", name)
  Packs.loading = nil
  describe(rec)
  if not Packs.data[name] then
    rec.loadable, rec.reason = false, (not loaded and reason) or "NO_DATA"
    return nil, rec.reason
  end
  if rec.format and rec.format > Packs.FORMAT then
    Packs.data[name] = nil
    rec.loadable, rec.reason = false, "NEWER_FORMAT"
    return nil, "NEWER_FORMAT"
  end
  if withdrawn(rec, true) then   -- its version could only be read once loaded
    Packs.data[name] = nil
    rec.loadable, rec.reason = false, "WITHDRAWN"
    return nil, "WITHDRAWN"
  end
  rec.loadable, rec.reason = true, nil
  if rec.dataVersion and ns.DB and ns.DB.version and rec.dataVersion ~= ns.DB.version and ns.debug then
    DEFAULT_CHAT_FRAME:AddMessage("|cffffd100Lore Forever:|r " .. rec.title .. " was built for lore data "
      .. rec.dataVersion .. " (this is " .. ns.DB.version .. ").")
  end
  return Packs.data[name]
end


-- Contributor components are an atomic edition, never ordinary language/voice fallbacks.
local function editionRecord(name)
  local rec = Packs.Get(name)
  if not rec then return nil end
  local present, _, _, loadable, reason = call("GetAddOnInfo", name)
  if not present or reason == "DISABLED" or (not loadable and reason ~= "DEMAND_LOADED") then return nil end
  describe(rec) -- do not trust cached identities after an interrupted update
  rec.kind, rec.locale = kindOf(name), meta(name, "X-LoreForever-Locale")
  if rec.format and rec.format > Packs.FORMAT then return nil end
  if rec.editionAPI ~= 1 or not rec.edition or not rec.editionVersion or not rec.editionPeer or not rec.locale then return nil end
  return rec
end

local function editionWriter(rec, writer)
  local e = type(writer) == "table" and writer.edition
  return type(e) == "table" and e.id == rec.edition and e.version == rec.editionVersion
    and e.peer == rec.editionPeer and e.api == 1
end

function Packs.EditionPair(id)
  local text
  for _, rec in ipairs(Packs.List("edition-text")) do
    local fresh = editionRecord(rec.name)
    if fresh and fresh.edition == id then
      if text then return nil, "INCOMPATIBLE" end -- ambiguous IDs cannot select a component by list order
      text = fresh
    end
  end
  if not text then return nil, "MISSING" end
  local voice = editionRecord(text.editionPeer)
  if not voice or voice.kind ~= "edition-voice" or voice.edition ~= id
      or voice.editionPeer ~= text.name or voice.editionVersion ~= text.editionVersion
      or voice.locale ~= text.locale then return nil, "INCOMPATIBLE" end
  local tw, reason = Packs.Load(text.name)
  if not tw then return nil, reason end
  local vw, vReason = Packs.Load(voice.name)
  if not vw then return nil, vReason end
  -- Loading can reveal/change metadata; verify both halves again against the registered writers.
  text, voice = editionRecord(text.name), editionRecord(voice.name)
  if not text or not voice or text.kind ~= "edition-text" or voice.kind ~= "edition-voice"
      or text.edition ~= id or voice.edition ~= id or text.locale ~= voice.locale
      or text.editionPeer ~= voice.name or voice.editionPeer ~= text.name
      or text.editionVersion ~= voice.editionVersion
      or not editionWriter(text, tw) or not editionWriter(voice, vw)
      or type(tw.entries) ~= "table" or type(tw.clipHash) ~= "table" or type(tw.answerHash) ~= "table"
      or type(vw.clips) ~= "table" then return nil, "INCOMPATIBLE" end
  return { id = id, version = text.editionVersion, locale = text.locale,
    textName = text.name, voiceName = voice.name, text = tw, voice = vw,
    name = text.languageName or text.title, credit = text.credit }
end

function Packs.IsLoaded(name)
  local rec = Packs.byName[name]
  if rec and rec.kind == "transport" then return call("IsAddOnLoaded", name) and true or false end
  return Packs.data[name] ~= nil
end
function Packs.GameLoaded(name) return call("IsAddOnLoaded", name) and true or false end

-- Why a pack can't be used, in words for the Options page and /lore voice. This file loads before Lang.lua and the
-- language pack fills ns.L at login, so the words are looked up when asked for, not here.
local L = setmetatable({}, { __index = function(_, k) return ns.L and ns.L[k] or k end })
local REASONS = {
  DISABLED = function() return L["Disabled in the AddOns list"] end,
  NEWER_FORMAT = function() return L["Needs a newer Lore Forever"] end,
  INTERFACE_VERSION = function() return L["Out of date: tick \"Load out of date AddOns\""] end,
  MISSING = function() return L["Not installed"] end,
  DEP_MISSING = function() return L["Lore Forever is missing"] end,
  DEP_DISABLED = function() return L["Lore Forever is disabled"] end,
  CORRUPT = function() return L["Damaged: reinstall it"] end,
  INCOMPATIBLE = function() return L["Not for this game version"] end,
  COMBAT = function() return L["Can't load during combat"] end,
  NO_DATA = function() return L["Didn't load: reinstall it"] end,
  WITHDRAWN = function() return L["Paused"] end,   -- Packs.WITHDRAWN: its language shows text until a new recording
}
function Packs.ReasonText(reason)
  if not reason then return nil end
  local text = REASONS[reason]
  if text then return text() end
  return string.format(L["Can't load (%s)"], tostring(reason))
end

-- The one global. A pack calls LoreForeverPacks.Begin(addonName) and writes into the table it gets back.
LoreForeverPacks = {
  FORMAT = Packs.FORMAT,
  Begin = function(name)
    name = type(name) == "string" and name or Packs.loading
    if not name then return nil end
    local rec = Packs.byName[name]
    if not rec then   -- loaded by the game itself (no LoadOnDemand) before our scan
      rec = describe({ name = name, title = name })
      if not rec.kind then return nil end
      Packs.byName[name] = rec
      Packs.registry[#Packs.registry + 1] = rec
    end
    local make = WRITERS[rec.kind]
    if not make then return nil end
    local w = Packs.data[name] or make()
    Packs.data[name] = w
    return w
  end,
}
