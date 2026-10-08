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
--   own quest text in that language, which the add-on's data doesn't have (see Voice.QuestClip).
-- Add-ons can't discover files at runtime, so packs are found through the game's add-on list and load when chosen.
-- A pack's only code is `local P = LoreForeverPacks.Begin(...)` followed by writes into P (e.g. P.clips[id] = hash).

local _, ns = ...
local Packs = { registry = {}, byName = {}, data = {} }
ns.Packs = Packs

Packs.FORMAT = 1   -- the newest pack format this version understands
local PREFIX = { voice = "LoreForever_Voice_", lang = "LoreForever_Lang_", ["lang-overlay"] = "LoreForever_LangTest_" }

-- What each kind of pack can write. Unknown kinds get nothing.
local WRITERS = {
  voice = function() return { clips = {} } end,
  lang = function() return { ui = {}, entries = {}, names = {}, quests = {}, items = {}, clipHash = {}, answerHash = {} } end,   -- see Lang.lua
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
local function describe(rec)
  local n = rec.name
  rec.kind = kindOf(n) or rec.kind
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
  if rec.format and rec.format > Packs.FORMAT then rec.loadable, rec.reason = false, "NEWER_FORMAT" end
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
      if Packs.data[name] then
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
  if Packs.data[name] then return Packs.data[name] end
  local rec = Packs.byName[name]
  if not rec then return nil, "MISSING" end
  if rec.format and rec.format > Packs.FORMAT then return nil, "NEWER_FORMAT" end
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
  rec.loadable, rec.reason = true, nil
  if rec.dataVersion and ns.DB and ns.DB.version and rec.dataVersion ~= ns.DB.version and ns.debug then
    DEFAULT_CHAT_FRAME:AddMessage("|cffffd100Lore Forever:|r " .. rec.title .. " was built for lore data "
      .. rec.dataVersion .. " (this is " .. ns.DB.version .. ").")
  end
  return Packs.data[name]
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
