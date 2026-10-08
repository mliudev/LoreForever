-- Read lore aloud with the recorded narration in the voice packs: as you arrive, at quest givers, on flights and
-- whenever you press play. Recordings only: what no voice has recorded stays as text. The game's own text-to-speech is
-- never used (Mike, 2026-10-05: now that the narrators have recorded everything, players found it jarring).

local _, ns = ...
local Voice = {}
ns.Voice = Voice
local L = ns.L

local function S() return (LoreForeverDB and LoreForeverDB.settings) or {} end

-- WoW playback stays at normal speed. Existing saved preferences are left intact.
Voice.PLAYBACK_RATES = { 1 }
function Voice.PlaybackRate() return 1 end

-- /lore debug: log a recording that won't play to chat, for diagnosing narration on a new client.
local function dbg(...)
  if not ns.debug then return end
  local parts = {}
  for i = 1, select("#", ...) do parts[#parts + 1] = tostring((select(i, ...))) end
  DEFAULT_CHAT_FRAME:AddMessage("|cff88ccffLore Forever voice:|r " .. table.concat(parts, " "))
end
Voice.dbg = dbg

-- Text without colour codes, hyperlinks and escaped pipes (labels, and the length a narration's text runs).
function Voice.Plain(text)
  return (tostring(text or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|H.-|h(.-)|h", "%1")
    :gsub("||", "|"):gsub("%s+", " "))
end

-- Recorded narration comes from voice packs (see Packs.lua). The player keeps an ordered list of voices (voiceOrder,
-- with "auto" standing for the default pack of the reading language) and can untick some (voiceOff). Each clip plays
-- from the first ticked voice that has a current recording of it, then nothing (what no voice recorded stays as
-- text). A pack's clip is used only while it was recorded from the current text (its hash matches
-- ns.DB.clipHash), so a recording never contradicts the page. Packs are partial: most cover only some clips.
local DEFAULT_PACK = "LoreForever_Voice_Default"
local QUEST_GIVERS = "LoreForever_Voice_QuestGivers"   -- the quest givers' voices (LOR-225, see giverClip)
-- Where players get voice packs (the site's Downloads page). Players type it, so keep it short.
Voice.DOWNLOADS = "loreforeverwow.com/downloads"
local AUTO = "auto"
local LANGUAGES = { enUS = "English", enGB = "English", deDE = "Deutsch", frFR = "Français", esES = "Español",
  esMX = "Español (Latinoamérica)", ptBR = "Português", itIT = "Italiano", ruRU = "Русский", koKR = "한국어",
  zhCN = "简体中文", zhTW = "繁體中文" }

local function readingLocale() return ns.readingLocale or "enUS" end
-- Same language, whatever the region: enGB recordings suit English text (the clip hashes still decide per clip).
local function sameLanguage(a, b) return (a or "enUS"):sub(1, 2) == (b or "enUS"):sub(1, 2) end
local function say(msg) DEFAULT_CHAT_FRAME:AddMessage("|cffffd100Lore Forever:|r " .. msg) end

local function cvar(name)
  local get = (_G.C_CVar and C_CVar.GetCVar) or _G.GetCVar
  if not get then return nil end
  local ok, v = pcall(get, name)
  return ok and v or nil
end

-- The game's sound channels a recording can play on (Options > Narration voices > Play voices on, LOR-315; a player on
-- Discord, 2026-10-05: "having the VO come out of the SFX or Music channel ... we can control gain better"), in
-- Options' order. Each has its volume and its switch in System > Sound (Master has no switch of its own: Enable Sound
-- is everything's), and the GlobalStrings its sliders and tick boxes are labelled with there.
local CHANNELS = {
  Dialog = { volume = "Sound_DialogVolume", switch = "Sound_EnableDialog", name = "DIALOG_VOLUME", switchName = "ENABLE_DIALOG" },
  SFX = { volume = "Sound_SFXVolume", switch = "Sound_EnableSFX", name = "FX_VOLUME", switchName = "ENABLE_SOUNDFX" },
  Music = { volume = "Sound_MusicVolume", switch = "Sound_EnableMusic", name = "MUSIC_VOLUME", switchName = "ENABLE_MUSIC" },
  Ambience = { volume = "Sound_AmbienceVolume", switch = "Sound_EnableAmbience", name = "AMBIENCE_VOLUME",
    switchName = "ENABLE_AMBIENCE" },
  Master = { volume = "Sound_MasterVolume", name = "MASTER_VOLUME" },
}
Voice.CHANNELS = { "Dialog", "SFX", "Music", "Ambience", "Master" }

-- The channel recordings are set to play on: a CHANNELS key, Dialog (as before LOR-315) unless Options says another.
function Voice.ChannelChoice()
  local key = S().voiceChannel
  return CHANNELS[key] and key or "Dialog"
end

-- A channel's name as the game's Sound settings show it, in the game's language (its volume slider's label; with
-- `switch`, its on/off tick box's), or ours where the client has none.
function Voice.ChannelName(key, switch)
  local ch = CHANNELS[key] or CHANNELS.Dialog
  local game = _G[switch and ch.switchName or ch.name]
  if type(game) == "string" and game ~= "" then return game end
  local ours = switch and { Dialog = L["Dialog"], SFX = L["Sound Effects"], Music = L["Music"], Ambience = L["Ambient Sounds"] }
    or { Dialog = L["Dialog"], SFX = L["Effects"], Music = L["Music"], Ambience = L["Ambience"], Master = L["Master Volume"] }
  return ours[key] or ours.Dialog
end

-- The game's sound switches (System > Sound): "all" with Enable Sound off (nothing plays), "channel" with the chosen
-- channel's own switch off (the game refuses sounds on it: PlaySoundFile fails, so with Dialog off narration fell back
-- to Read aloud, or silence, without a word: Discord #general, 2026-10-04), else nil.
function Voice.SoundOff()
  if cvar("Sound_EnableAllSound") == "0" then return "all" end
  local switch = CHANNELS[Voice.ChannelChoice()].switch
  if switch and cvar(switch) == "0" then return "channel" end
end

-- The channel a recording plays on: the chosen one, or Master while the game has it switched off (the player
-- installed a narrator, and muting the game's NPC chatter, say, shouldn't silence it). Read as each one starts, so a
-- new choice applies from the next recording and never restarts the one playing.
function Voice.Channel() return Voice.SoundOff() == "channel" and "Master" or Voice.ChannelChoice() end
local function channel() return Voice.Channel() end

-- Options > Voice volume (LOR-295) is the chosen channel's own volume in System > Sound, read and set directly:
-- our recordings follow it, and so does everything else the game plays on that channel. Nothing changes it while a
-- recording plays and only the channel choice is saved, so whatever happens to the add-on (a crash, uninstalling it)
-- the player's settings are the ones they chose. With the chosen channel switched off our recordings play on Master
-- (Voice.Channel), whose volume Lore Forever leaves alone unless Master is the channel chosen.

-- The chosen channel's volume (or `key`'s) as a whole percent, and whether the client said (100, its default, when
-- it doesn't).
function Voice.Volume(key)
  local v = tonumber(cvar((CHANNELS[key or Voice.ChannelChoice()] or CHANNELS.Dialog).volume))
  if not v then return 100, false end
  return math.max(0, math.min(100, math.floor(v * 100 + 0.5))), true
end

-- Set the chosen channel's volume to `pct` percent, for good, as the game's own slider for it does. Returns true if
-- the game took it.
function Voice.SetVolume(pct)
  pct = tonumber(pct)
  local set = (_G.C_CVar and C_CVar.SetCVar) or _G.SetCVar
  if not (pct and set) then return false end
  pct = math.max(0, math.min(100, math.floor(pct + 0.5)))
  local ok, done = pcall(set, CHANNELS[Voice.ChannelChoice()].volume, tostring(pct / 100))
  return ok and done ~= false
end

Voice.active, Voice.chain, Voice.stats, Voice.total, Voice.provided, Voice.servedBy = {}, {}, {}, 0, {}, {}
Voice.questPaths, Voice.questServed = {}, {}   -- quest dialogue picked for an open quest window (Voice.QuestClip)
Voice.answerPaths, Voice.answerServed = {}, {}   -- the answers packs' questions and answers (LOR-227, Refresh)

-- Put a voice first in the list and tick it, along with the default voice (what choosing a voice always meant: that
-- voice, then the default for the rest). "none" unticks every voice.
local function apply(s, value)
  if value == "none" then
    for _, k in ipairs(s.voiceOrder) do s.voiceOff[k] = true end
    return
  end
  for i = #s.voiceOrder, 1, -1 do
    if s.voiceOrder[i] == value then table.remove(s.voiceOrder, i) end
  end
  table.insert(s.voiceOrder, 1, value)
  s.voiceOff[value], s.voiceOff[AUTO] = nil, nil
end

-- The voice settings, set up on first use. Installs from before the list saved one voice (voicePack): it becomes
-- the top of the list, and Voice.migrated tells Init to add the other installed voices quietly at the bottom.
local function prefs()
  local s = S()
  local created = false
  if type(s.voiceOrder) ~= "table" then s.voiceOrder, created = {}, true end
  if type(s.voiceOff) ~= "table" then s.voiceOff = {} end
  -- A saved list with holes, repeats or junk in it (edited by hand, an old bug) becomes a plain list of names.
  local idx, clean, seen = {}, {}, {}
  for i, k in pairs(s.voiceOrder) do
    if type(i) == "number" and type(k) == "string" then idx[#idx + 1] = i end
  end
  table.sort(idx)
  for _, i in ipairs(idx) do
    local k = s.voiceOrder[i]
    if not seen[k] then seen[k], clean[#clean + 1] = true, k end
  end
  if not seen[AUTO] then clean[#clean + 1] = AUTO end   -- the default voice always has a place
  s.voiceOrder = clean
  if s.voicePack ~= nil then
    local old = s.voicePack
    s.voicePack = nil
    apply(s, old)
    if created then Voice.migrated = true end
  end
  return s
end

-- The voice the old one-voice picker shows: the first ticked one in the list ("auto", a pack name), or "none".
function Voice.Current()
  if ns.lang and ns.lang.edition then
    return (S().editionVoiceOff or ns.lang.edition.unavailable) and "none" or ns.lang.edition.voiceName or "none"
  end
  local s = prefs()
  for _, k in ipairs(s.voiceOrder) do
    if not s.voiceOff[k] then return k end
  end
  return "none"
end

-- Where a pack keeps a clip: zone:stormwind -> Audio\zone_stormwind.mp3, zone:stormwind#faq3 -> ...__faq3.mp3,
-- quest:176#detail -> ...\quest_176__detail.mp3 (lore.clips.stem).
function Voice.ClipPath(pack, id, ext)
  local stem = (id:gsub("#", "__"):gsub("[^%w%-_]", "_"))
  return "Interface\\AddOns\\" .. pack .. "\\Audio\\" .. stem .. "." .. (ext or "mp3")
end

-- A quest giver's words (quest:176#detail, #progress, #complete: lore.clips), not a lore narration.
local function isQuestClip(id)
  return type(id) == "string" and id:find("^quest:%d+#%a+$") ~= nil
end

-- The default pack for a language: LoreForever_Voice_Default_<locale>, or LoreForever_Voice_Default for its language.
function Voice.DefaultPack(locale)
  locale = locale or readingLocale()
  for _, name in ipairs({ DEFAULT_PACK .. "_" .. locale, DEFAULT_PACK }) do
    local rec = ns.Packs.Get(name)
    if rec and sameLanguage(rec.locale, locale) then return name end
  end
end

-- Narration in other languages (LOR-177): a voice pack named for a locale (LoreForever_Voice_Female_deDE, the female
-- narrator reading German) stands in for its voice (LoreForever_Voice_Female) while the add-on shows that language, as
-- LoreForever_Voice_Default_<locale> does for the default voice. The list keeps one row per narrator, saved under the
-- voice's own name, so a narrator's place and tick hold in every language. A pack in another language than the one
-- shown never plays (Voice.Unusable), and recordings match the text by hash, the language pack's replacing the English
-- ones (Lang.lua), so English recordings never play over translated text. The rule is the name and the .toc's
-- X-LoreForever-Locale, for any voice (LoreForever_Voice_<name>_<locale>). Packs that extend a voice (lands, quest
-- dialogue) follow it too: one in German that extends LoreForever_Voice_Female (say
-- LoreForever_Voice_Female_Quests_deDE, ## X-LoreForever-Locale: deDE) joins her German voice (Voice.Extensions).
-- Quest dialogue in another language (LOR-226) carries the fingerprints of the game's own text in it (P.questVoice:
-- ns.DB.questVoice and questClip are the English text's), and plays even without her German narration (Refresh).
local LOCALE_SUFFIX = "_(%l%l%u%u)$"

-- The voice a pack speaks for: LoreForever_Voice_Female_deDE -> LoreForever_Voice_Female; other names as they are.
function Voice.KeyOf(name)
  local loc = type(name) == "string" and name:match(LOCALE_SUFFIX)
  return loc and name:sub(1, #name - #loc - 1) or name
end

-- The pack that speaks for a voice (a list key) in a language, by default the one shown: its pack for that locale
-- when installed, else the voice's own pack; with only other languages of it installed, one of those, so the list
-- says which language it's in rather than "not installed".
function Voice.InLanguage(key, locale)
  locale = locale or readingLocale()
  local rec = ns.Packs.Get(key .. "_" .. locale)
  if rec and sameLanguage(rec.locale, locale) then return rec.name end
  if ns.Packs.Get(key) then return key end
  for _, r in ipairs(ns.Packs.List("voice")) do
    if r.name ~= key and Voice.KeyOf(r.name) == key then return r.name end
  end
  return key
end

local function isDefault(name) return name:sub(1, #DEFAULT_PACK) == DEFAULT_PACK end

-- Why a pack can't narrate right now, in words, and the reason code ("MISSING", a Packs reason, or "LANGUAGE"); nil
-- if it can. Compare the code, not the words: they're translated.
function Voice.Unusable(name)
  local rec = ns.Packs.Get(name)
  if not rec then return L["Not installed"], "MISSING" end
  if rec.kind == "edition-voice" or rec.kind == "edition-text" then
    return L["Select this contributor edition in Options and reload"], "EDITION"
  end
  if rec.loadable == false then return ns.Packs.ReasonText(rec.reason) or L["Can't load"], rec.reason end
  if rec.locale and not sameLanguage(rec.locale, readingLocale()) then
    return string.format(L["Recorded in %s"], rec.languageName or LANGUAGES[rec.locale] or rec.locale), "LANGUAGE"
  end
end

-- Load a pack if it can be used; returns what it registered. Packs can't load in combat (e.g. a /reload mid-fight):
-- that's remembered and retried when combat ends.
local function ensure(name)
  if not name or Voice.Unusable(name) then return nil end
  local data, reason = ns.Packs.Load(name)
  if reason == "COMBAT" then Voice.deferred = true end
  if data and not Voice.Unusable(name) then return data end   -- the language may only be known once loaded
end

-- Why the default voice can't play in the language shown: its pack is in another language (loaded to read its .toc
-- if need be), or it isn't installed. Returns the words and the reason code, like Voice.Unusable.
local function defaultWhy()
  if ns.Packs.Get(DEFAULT_PACK) then
    ensure(DEFAULT_PACK)
    local why, code = Voice.Unusable(DEFAULT_PACK)
    if why then return why, code end
  end
  return L["Not installed"], "MISSING"
end

-- No voice can play in the language Lore Forever shows, but voices in another language are installed (LOR-136: a
-- German, French, Spanish or Portuguese game client shows its language, since the language packs come with the
-- add-on, and the English narrators then never play: Read aloud read everything, and Sample had nothing to play).
-- Returns the words that say so and how to hear them, or nil.
function Voice.LanguageGap()
  if Voice.chain[1] or Voice.Current() == "none" then return nil end
  local recorded
  for _, rec in ipairs(ns.Packs.List("voice")) do
    if not rec.locale and not ns.Packs.IsLoaded(rec.name) then ensure(rec.name) end   -- (reads its .toc)
    local _, code = Voice.Unusable(rec.name)
    if code == "LANGUAGE" and (not recorded or sameLanguage(rec.locale, "enUS")) then
      recorded = rec.languageName or LANGUAGES[rec.locale] or rec.locale
    end
  end
  if not recorded then return nil end
  local shown = (ns.lang and ns.lang.locale == readingLocale() and ns.lang.name) or LANGUAGES[readingLocale()]
    or readingLocale()
  return string.format(L["Your narration voices are recorded in %s and Lore Forever shows %s, so they can't play. To hear them, choose %s in Options > Language and reload."],
    recorded, shown, recorded)
end

-- Installed lands packs that add clips to a voice (## X-LoreForever-Extends: <name>), in name order. A lands pack is
-- never a voice of its own, and one whose voice isn't installed or chosen simply isn't used.
-- A lands pack's folder starts with its voice's (LoreForever_Voice_Female_Horde): some clients can't read an add-on's
-- X- fields before it's loaded, so a pack named that way is loaded to find out. In another language (name: the
-- voice's pack for it, LoreForever_Voice_Female_deDE), a pack extends it when it extends that pack or the voice itself
-- and is in the language shown; a pack in another language never does (LOR-177).
function Voice.Extensions(name)
  local out, base = {}, Voice.KeyOf(name)
  for _, rec in ipairs(ns.Packs.List("voice")) do
    if not rec.extends and rec.name ~= name and Voice.KeyOf(rec.name):sub(1, #base + 1) == base .. "_"
      and not ns.Packs.IsLoaded(rec.name) then
      ensure(rec.name)   -- (does nothing for a pack in another language)
    end
    if rec.extends and (rec.extends == name or Voice.InLanguage(rec.extends) == name) and not Voice.Unusable(rec.name) then
      out[#out + 1] = rec.name
    end
  end
  table.sort(out)
  return out
end

-- A voice and its loaded lands packs: the packs whose clips speak in that voice.
local function withExtensions(name)
  local out = { name }
  for _, ext in ipairs(Voice.Extensions(name)) do
    if ensure(ext) then out[#out + 1] = ext end
  end
  return out
end

-- Count distinct lore recording IDs across a narrator's packs. A current copy wins over an outdated duplicate.
function Voice.Count(name)
  local hashes, current, old = (ns.DB and ns.DB.clipHash) or {}, {}, {}
  for _, pack in ipairs(withExtensions(name)) do
    local data = ns.Packs.data[pack]
    for id, h in pairs(data and data.clips or {}) do
      if hashes[id] == h or (hashes[id] and Voice.Transport and Voice.Transport(id, pack, true)) then
        current[id] = true
      elseif hashes[id] then old[id] = true end
    end
  end
  local have, stale = 0, 0
  for _ in pairs(current) do have = have + 1 end
  for id in pairs(old) do if not current[id] then stale = stale + 1 end end
  return have, stale
end

-- LOR-350: every installed pack, separately from narrator priority. Reading voice tables only registers metadata;
-- language tables are never loaded or applied here. Counts describe recording IDs, not verified audio files.
function Voice.InstalledPacks()
  local out, s = {}, prefs()
  for _, rec in ipairs(ns.Packs.registry) do
    local transport = rec.transportFor or rec.name:find("_Transport_", 1, true)
    local it = { name = rec.name, title = rec.title, kind = rec.kind, locale = rec.locale,
      language = rec.languageName or LANGUAGES[rec.locale] or rec.locale or L["Language unknown"],
      transport = transport and true or false }
    local data = ns.Packs.data[rec.name]
    if rec.kind == "voice" and not transport and rec.loadable ~= false and not data then
      data = ns.Packs.Load(rec.name) -- readonly clip lists, including locales we aren't reading
    end
    local source = transport and (rec.transportFor or rec.name:match("^(.-)_Transport_"))
    local sourceRec = source and ns.Packs.Get(source)
    it.locale = rec.locale or (sourceRec and sourceRec.locale)
    it.language = rec.languageName or LANGUAGES[it.locale] or it.locale or L["Language unknown"]
    local loaded = transport and ns.Packs.GameLoaded(rec.name) or data ~= nil
    local other = it.locale and not sameLanguage(it.locale, readingLocale())
    it.checked = not other and data ~= nil
    if rec.loadable == false then
      it.status = ns.Packs.ReasonText(rec.reason) or L["Can't load"]
    elseif other then
      it.status = L["Choose this language in Options > Language and reload"]
    elseif not loaded then
      it.status = InCombatLockdown and InCombatLockdown() and L["Can't load during combat"] or L["Not loaded yet"]
    elseif rec.kind == "lang" or rec.kind == "lang-overlay" then
      it.status = L["In use"]
    else
      local base = rec.transportFor or rec.extends or Voice.KeyOf(rec.name)
      local key = isDefault(base) and AUTO or Voice.KeyOf(base)
      if s.voiceOff[key] then
        it.status = L["Narrator unticked"]
      elseif ns.Packs.Get(Voice.InLanguage(base)) and ns.Packs.Get(Voice.InLanguage(base)).loadable == false then
        it.status = L["Loaded; lore narrator unavailable"] .. ": " .. (ns.Packs.ReasonText(ns.Packs.Get(Voice.InLanguage(base)).reason) or L["Can't load"])
      elseif not ns.Packs.Get(Voice.InLanguage(base)) then
        it.status = L["Loaded; lore narrator not installed"]
      elseif ns.Packs.Get(Voice.InLanguage(base)).locale and not sameLanguage(ns.Packs.Get(Voice.InLanguage(base)).locale, readingLocale()) then
        it.status = L["Loaded; lore narrator uses another language"]
      else
        it.status = transport and L["Playback support loaded"] or L["Loaded"]
      end
    end
    if transport then
      it.title = L["Playback support"]
      local source = rec.transportFor or rec.name:match("^(.-)_Transport_")
      it.narrator = source and Voice.PackName(source)
      local sourceRec = source and ns.Packs.Get(source)
      if sourceRec then it.language = sourceRec.languageName or LANGUAGES[sourceRec.locale] or sourceRec.locale or it.language end
      local sourceData = source and ns.Packs.data[source]
      if sourceData and sourceData.transport then
        local count = 0
        for _, row in pairs(sourceData.transport) do
          if type(row) == "table" and row.assetPack == rec.name then count = count + 1 end
        end
        it.support = count
      end
    elseif rec.kind == "voice" and data then
      it.counts = { lore = 0, quest = 0, answer = 0, unknown = 0 }
      it.stale, it.recorded = 0, 0
      for id, hash in pairs(data.clips or {}) do
        local category, expected
        local entry, n = id:match("^(.-)#faq(%d+)$")
        local answer = entry and ns.DB.answerHash and ns.DB.answerHash[entry]
        if rec.name:find("_Answers_", 1, true) and entry then
          category = "answer"
          expected = type(answer) == "string" and answer:sub(6 * tonumber(n) - 5, 6 * tonumber(n)) or nil
        elseif isQuestClip(id) then
          category, expected = "quest", ns.DB.questClip and ns.DB.questClip[id]
        else
          category, expected = "lore", ns.DB.clipHash and ns.DB.clipHash[id]
        end
        it.recorded = it.recorded + 1
        if other then
          it.counts[category] = it.counts[category] + 1
        elseif category == "quest" and type(data.questVoice) == "table" then
          -- Localized quest packs match the visible game's text when a quest page opens.
          it.counts.quest = it.counts.quest + 1
          it.questPageCheck = true
        elseif expected == hash or (category == "lore" and expected and Voice.Transport and Voice.Transport(id, rec.name, true)) then
          it.counts[category] = it.counts[category] + 1
        elseif expected and expected ~= "" then
          it.stale = it.stale + 1
        else
          it.counts.unknown = it.counts.unknown + 1
        end
      end
    elseif data and (rec.kind == "lang" or rec.kind == "lang-overlay") then
      it.entries, it.strings = 0, 0
      for _ in pairs(data.entries or {}) do it.entries = it.entries + 1 end
      for _ in pairs(data.ui or {}) do it.strings = it.strings + 1 end
      for _ in pairs(data.strings or {}) do it.strings = it.strings + 1 end
    end
    out[#out + 1] = it
  end
  return out
end

-- The clip a voice should keep together with this one (voiceGroup): its story's main clip ("story": the entry, for
-- its #faq clips), its zone's story ("zone": a zone's places and people follow it), or none ("line").
local function storyOf(id) return id:match("^(.-)#faq%d+$") or id end
local function anchorOf(id, mode)
  if mode == "story" then return storyOf(id) end
  if mode == "zone" then
    local e = ns.DB and ns.DB.entries and ns.DB.entries[storyOf(id)]
    return e and e.z and ("zone:" .. e.z) or storyOf(id)
  end
end

-- The races a voice suits, as a set, from its .toc (## X-LoreForever-Races: Orc, Troll). Names are matched loosely
-- ("Night Elf" = nightelf), and "undead" means the Forsaken, as data/clips.json names them.
local RACE_ALIAS = { undead = "forsaken", scourge = "forsaken" }
function Voice.Races(name)
  local rec, out = ns.Packs.Get(name), {}
  for word in tostring(rec and rec.races or ""):gmatch("[^,;/]+") do
    local race = word:lower():gsub("[^%a]", "")
    if race ~= "" then out[RACE_ALIAS[race] or race] = true end
  end
  return out
end

-- The pack behind a key in the list: "auto" is the default pack for the reading language (nil if there's none), a
-- voice its pack in the reading language (Voice.InLanguage).
local function packOf(key)
  if key == AUTO then return Voice.DefaultPack() end
  return Voice.InLanguage(key)
end

-- Rebuild Voice.active (clip id -> the paths to try, in order) from the voice list. Each voice in the chain brings
-- its installed lands packs; their counts go to the voice they extend. For each clip the voices with a current
-- recording are ranked in list order, except that the voice playing the clip's anchor (anchorOf) goes first when it
-- has the clip too, so a story's questions don't switch narrator. The rest stay behind it as fallbacks for a file
-- that won't play. Voice.servedBy[id] is the voice that plays a clip; Voice.stats[voice] = {have, stale, plays}.
-- Voice.provided marks every clip some pack in the chain has (current or not), for the "narrated in a pack you
-- don't have" hint.
function Voice.Refresh()
  local edition = ns.lang and ns.lang.edition
  if edition then
    local valid = ns.Lang.ValidateEdition()
    local active, served, provided, total = {}, {}, {}, 0
    for id, h in pairs(valid and not S().editionVoiceOff and ns.DB.clipHash or {}) do
      total = total + 1
      local recorded = edition.voice.clips[id]
      if recorded then provided[id] = true end
      if recorded == h then
        active[id], served[id] = { Voice.ClipPath(edition.voiceName, id, edition.voice.ext) }, edition.voiceName
      end
    end
    Voice.active, Voice.servedBy, Voice.provided, Voice.total = active, served, provided, total
    Voice.questRanked, Voice.questPaths, Voice.questServed, Voice.answerPaths, Voice.answerServed = {}, {}, {}, {}, {}
    Voice.chain, Voice.stats, Voice.ready, Voice.deferred = valid and { edition.voiceName } or {}, {}, true, nil
    return
  end
  local s = prefs()
  Voice.deferred = nil
  local chain, packsOf, questChain = {}, {}, {}
  for _, key in ipairs(s.voiceOrder) do
    local name = packOf(key)
    if s.voiceOff[key] or (name and packsOf[name]) then
      -- (unticked, or a second key for a voice already in the list)
    elseif name and ensure(name) then
      chain[#chain + 1] = name
      packsOf[name] = withExtensions(name)
      questChain[#questChain + 1] = name
    else
      -- A voice with no pack that can play in the language shown (say no German narration installed) can still have
      -- its quest dialogue in that language (LOR-226): its quest packs in it speak under the voice's own name. Its lore
      -- narration doesn't: only the chain plays that.
      local base = key == AUTO and DEFAULT_PACK or key
      if not packsOf[base] then
        local exts = {}
        for _, ext in ipairs(Voice.Extensions(base)) do
          if ensure(ext) then exts[#exts + 1] = ext end
        end
        if exts[1] then packsOf[base], questChain[#questChain + 1] = exts, base end
      end
    end
  end
  local stats, total, provided, ranked = {}, 0, {}, {}
  for _, name in ipairs(chain) do stats[name] = { have = 0, stale = 0, plays = 0 } end
  for id, hash in pairs((ns.DB and ns.DB.clipHash) or {}) do
    total = total + 1
    for _, name in ipairs(chain) do
      local paths
      for _, pack in ipairs(packsOf[name]) do
        local data = ns.Packs.data[pack]
        local h = data and data.clips[id]
        if h then provided[id] = true end
        local whole = Voice.Transport and Voice.Transport(id, pack, true)
        if h == hash or whole then
          paths = paths or {}
          paths[#paths + 1] = Voice.ClipPath(pack, id, data.ext)
        elseif h then
          stats[name].stale = stats[name].stale + 1
        end
      end
      if paths then
        stats[name].have = stats[name].have + 1
        ranked[id] = ranked[id] or {}
        table.insert(ranked[id], { name, paths })
      end
    end
  end
  -- "Prefer voices that suit the race": for a clip whose story belongs to a race (ns.DB.clipNarrator), the voices
  -- that name that race go first, still in list order among themselves.
  local narrators = s.voiceMatchRace and ns.DB and ns.DB.clipNarrator
  if narrators then
    local suits = {}
    for _, name in ipairs(chain) do suits[name] = Voice.Races(name) end
    for id, list in pairs(ranked) do
      local race = narrators[id]
      if race and #list > 1 then
        local yes, no = {}, {}
        for _, voice in ipairs(list) do
          table.insert(suits[voice[1]][race] and yes or no, voice)
        end
        for _, voice in ipairs(no) do yes[#yes + 1] = voice end
        ranked[id] = yes
      end
    end
  end
  local mode, first = s.voiceGroup or "story", {}
  for id, list in pairs(ranked) do first[id] = list[1][1] end
  local active, servedBy = {}, {}
  for id, list in pairs(ranked) do
    local anchor = anchorOf(id, mode)
    local keep = anchor and anchor ~= id and first[anchor]
    if keep and keep ~= list[1][1] then
      for i = 2, #list do
        if list[i][1] == keep then table.insert(list, 1, table.remove(list, i)) break end
      end
    end
    local paths = {}
    for _, voice in ipairs(list) do
      for _, p in ipairs(voice[2]) do paths[#paths + 1] = p end
    end
    active[id], servedBy[id] = paths, list[1][1]
    stats[list[1][1]].plays = stats[list[1][1]].plays + 1
  end
  -- Quest dialogue (quest:<id>#detail|progress|complete, from the voices' quest packs): each voice with a current
  -- recording, in list order, with the fingerprints of the words it reads ({ voice, path, fingerprint rows }).
  -- Voice.QuestClip picks one when a quest window opens. An English recording is current when its hash is
  -- ns.DB.questClip's, and reads ns.DB.questVoice's words; a quest pack in another language (LOR-226,
  -- LoreForever_Voice_Female_Quests_deDE) brings the fingerprints of the game's own text in its language
  -- (P.questVoice: only the parts it recorded from the current text), since the add-on's data has only the English.
  local questRanked, questHash = {}, (ns.DB and ns.DB.questClip) or {}
  for _, name in ipairs(questChain) do
    local seen = {}
    for _, pack in ipairs(packsOf[name]) do
      local data = ns.Packs.data[pack]
      local own = data and type(data.questVoice) == "table" and data.questVoice or nil
      for id, h in pairs(data and data.clips or {}) do
        if not seen[id] and (own and isQuestClip(id) or questHash[id] == h) then
          seen[id] = true
          questRanked[id] = questRanked[id] or {}
          table.insert(questRanked[id], { name, Voice.ClipPath(pack, id, data.ext), own or ns.DB.questVoice })
        end
      end
    end
  end
  Voice.questRanked = questRanked
  -- Every other question and answer (LOR-227): the answers packs (LoreForever_Voice_<voice>_Answers_<Part>, and
  -- _<locale> in another language) extend a voice like a lands pack, with <entry>#faqN clips ns.DB.clipHash doesn't
  -- list. Their current hashes are ns.DB.answerHash[entry], one string with #faqN's at 6N-5..6N (a language pack's
  -- replaces it: Lang.lua). Each voice with a current recording, in list order, the voice that plays the clip's anchor
  -- first (anchorOf: a story's questions keep its narrator); a voice whose packs in the language shown are only ones
  -- that extend it plays them too, as with quest dialogue. Kept apart from Voice.active / servedBy, so the Listen tab,
  -- the counts and the lands hint stay the lore narrations'.
  local answerHash, answerRanked = (ns.DB and ns.DB.answerHash) or {}, {}
  for _, name in ipairs(questChain) do
    for _, pack in ipairs(packsOf[name]) do
      local data = ns.Packs.data[pack]
      if data and data.clips and pack:find("_Answers_", 1, true) then
        for id, h in pairs(data.clips) do
          local base, n = id:match("^(.-)#faq(%d+)$")
          local all = base and answerHash[base]
          n = tonumber(n)
          if type(all) == "string" and n and all:sub(6 * n - 5, 6 * n) == h then
            answerRanked[id] = answerRanked[id] or {}
            table.insert(answerRanked[id], { name, Voice.ClipPath(pack, id, data.ext) })
          end
        end
      end
    end
  end
  local answerPaths, answerServed = {}, {}
  for id, list in pairs(answerRanked) do
    local anchor = anchorOf(id, mode)
    local keep = anchor and servedBy[anchor]
    if keep and keep ~= list[1][1] then
      for i = 2, #list do
        if list[i][1] == keep then table.insert(list, 1, table.remove(list, i)) break end
      end
    end
    local paths = {}
    for _, voice in ipairs(list) do paths[#paths + 1] = voice[2] end
    answerPaths[id], answerServed[id] = paths, list[1][1]
  end
  Voice.answerPaths, Voice.answerServed = answerPaths, answerServed
  -- Recordings outside the voice packs (journey chapters the companion app narrated: Journey.LoadChapters).
  for id, paths in pairs(Voice.extra or {}) do active[id], servedBy[id] = paths, nil end
  Voice.active, Voice.chain, Voice.stats, Voice.total, Voice.ready = active, chain, stats, total, true
  Voice.provided, Voice.servedBy = provided, servedBy
end

-- The voice (its pack name) that plays a clip and the file it plays first, or nil if no voice has the clip.
function Voice.Resolve(id)
  if not ns.Lang.ValidateEdition() then return nil end
  if not Voice.ready then Voice.Refresh() end
  local paths = Voice.active[id] or Voice.questPaths[id] or Voice.answerPaths[id]
  return Voice.servedBy[id] or Voice.questServed[id] or Voice.answerServed[id], paths and paths[1]
end

-- Voices installed since the last login go to the top of the list (installing one means you want to hear it; a
-- partial pack only takes over the clips it has), with a line in chat. After moving from the one-voice setting
-- they're added unticked at the bottom instead, so nothing changes for the player. A voice that can't be used
-- (another language, disabled, too new) goes to the bottom without a word, to show greyed in the list. Lands packs
-- aren't voices. A pack combat kept from loading waits for OnCombatEnded; returns true if one did.
-- A lands or quest pack extends a voice, or is named after one (LoreForever_Voice_Female_Horde,
-- LoreForever_Voice_Female_Quests_deDE); a voice in another language (LoreForever_Voice_Female_deDE) is named after its
-- voice too, but is that voice (Voice.KeyOf). The name counts when the .toc can't be read yet (a pack in another
-- language isn't loaded to read it), and the quest givers' voices in any language are never a voice.
local function extendsVoice(rec, voices)
  if rec.extends then return true end
  local key = Voice.KeyOf(rec.name)
  if key == QUEST_GIVERS then return true end
  for _, o in ipairs(voices) do
    local okey = Voice.KeyOf(o.name)
    if okey ~= key and key:sub(1, #okey + 1) == okey .. "_" then return true end
  end
end

local function adoptNew(quiet)
  local s = prefs()
  local known, voices, new, unusable, waiting = {}, ns.Packs.List("voice"), {}, {}, false
  for _, k in ipairs(s.voiceOrder) do known[k] = true end
  local function lands(rec) return extendsVoice(rec, voices) end
  -- Each voice once, by its key: the pack that plays it in the language shown, or the one that says why it can't.
  for _, rec in ipairs(voices) do
    local key = Voice.KeyOf(rec.name)
    if not isDefault(key) and not known[key] then
      local name = packOf(key)
      if Voice.Unusable(name) then
        if not lands(rec) then known[key] = true; unusable[#unusable + 1] = key end
      elseif ensure(name) then
        rec = ns.Packs.Get(name)   -- its X- fields may only be readable now it's loaded
        if not lands(rec) then known[key] = true; new[#new + 1] = key end
      else
        waiting = true
      end
    end
  end
  if quiet then
    for _, list in ipairs({ new, unusable }) do
      for _, key in ipairs(list) do
        s.voiceOrder[#s.voiceOrder + 1] = key
        s.voiceOff[key] = true
      end
    end
    return waiting
  end
  for _, key in ipairs(unusable) do s.voiceOrder[#s.voiceOrder + 1] = key end
  for i = #new, 1, -1 do table.insert(s.voiceOrder, 1, new[i]) end
  for _, key in ipairs(new) do
    local name = packOf(key)
    local have = Voice.Count(name)
    say(string.format(L["new voice: %s. It plays first now; you can change the order in Options."],
      string.format(have == 1 and L["%s (%d narration)"] or L["%s (%d narrations)"], Voice.PackName(name), have)))
  end
  return waiting
end

-- Look for new voices (adoptNew), then rebuild. A move from the one-voice setting stays quiet until the voices it
-- adds could all load, and a pack combat kept waiting keeps Voice.deferred set for OnCombatEnded.
local function adoptAndRefresh()
  local waiting = adoptNew(Voice.migrated)
  if not waiting then Voice.migrated = nil end
  Voice.Refresh()
  Voice.deferred = Voice.deferred or waiting
end

-- Entering a zone with narrated places or people that no installed pack has (they're in a lands pack): say where to
-- get them, once per zone per session, unless narration is off or the hint is turned off in Options.
Voice.hinted = {}
function Voice.OnZone(zk)
  if ns.lang and ns.lang.edition then return end
  if not zk or Voice.hinted[zk] or S().packHints == false or Voice.Current() == "none" then return end
  if not Voice.ready then Voice.Refresh() end
  local db = ns.DB or {}
  local zone = db.zones and db.zones[zk]
  if not zone or not Voice.chain[1] then return end
  local missing = false
  for id in pairs(db.clipHash or {}) do
    local e = db.entries and db.entries[id:match("^(.-)#faq%d+$") or id]
    if e and e.z == zk and not Voice.provided[id] then missing = true break end
  end
  if not missing then return end
  Voice.hinted[zk] = true
  local lands = (zone.fa == "alliance" and L["Alliance lands"]) or (zone.fa == "horde" and L["Horde lands"])
    or L["Alliance or Horde lands"]
  say(string.format(L["%s's places and people are narrated in the %s pack: %s"], zone.n, lands, Voice.DOWNLOADS))
end

-- A pack's name for players when it isn't installed (no title to read): LoreForever_Voice_Female_Horde -> "Female Horde".
function Voice.PackName(name)
  local rec = ns.Packs.Get(name)
  if rec and rec.title then return rec.title end
  local short = tostring(name or ""):gsub("^LoreForever_Voice_", ""):gsub("_", " ")
  return short
end

-- Say once if the saved voice can't be used (the saved choice is kept, so reinstalling it brings it back).
-- A missing pack also says where to get it: CurseForge carries only the main download, so a CurseForge update
-- removes voice packs that came from elsewhere, and the add-on would otherwise fall back without a word (LOR-136).
local function noticeMissing()
  local choice = Voice.Current()
  if not choice or choice == "auto" or choice == "none" then return end
  choice = packOf(choice)   -- the voice's pack in the language shown
  if Voice.chain[1] == choice then return end
  local why, code = Voice.Unusable(choice)
  if code == "LANGUAGE" and Voice.LanguageGap() then return end   -- (noticeLanguage says why, and how to hear it)
  local title = Voice.PackName(choice)
  -- What plays instead: the default voice, nothing, or the next voice in the list (named).
  local nextVoice = Voice.chain[1]
  local fallback = (nextVoice and isDefault(nextVoice) and 1) or (nextVoice and 3) or 2
  local nextTitle = nextVoice and Voice.PackName(nextVoice)
  if code == "MISSING" then
    say(string.format(({ L["voice pack %s isn't installed; using the default voice."],
      L["voice pack %s isn't installed; using no narration."],
      L["voice pack %s isn't installed; using %s."] })[fallback], title, nextTitle))
    say(string.format(L["Get it again at %s, then type /reload."], Voice.DOWNLOADS))
  elseif why then
    say(string.format(({ L["voice pack %s can't be used: %s; using the default voice."],
      L["voice pack %s can't be used: %s; using no narration."],
      L["voice pack %s can't be used: %s; using %s."] })[fallback], title, why, nextTitle))
  else
    say(string.format(({ L["voice pack %s didn't load; using the default voice."],
      L["voice pack %s didn't load; using no narration."],
      L["voice pack %s didn't load; using %s."] })[fallback], title, nextTitle))
  end
end

-- Say once a session that the installed voices are in another language than the one shown (Voice.LanguageGap).
-- Before LOR-136 they were only greyed in Options, and the default voice's row even said "Not installed".
local function noticeLanguage()
  if Voice.toldLanguage then return end
  local gap = Voice.LanguageGap()
  if not gap then return end
  Voice.toldLanguage = true
  say(gap)
end

-- At login: find the installed packs and load the chosen voice.
function Voice.Init()
  if not next(ns.Packs.registry) then ns.Packs.Scan() end
  prefs()
  if ns.lang and ns.lang.edition then Voice.Refresh(); return end
  Voice.ForgetQuestPages()
  adoptAndRefresh()
  if not Voice.deferred then
    noticeMissing()
    noticeLanguage()
  end
  Voice.CheckSpoken()
  Voice.CheckQuestVoices()
end

-- Combat ended: load the packs that had to wait, then relabel the panel.
function Voice.OnCombatEnded()
  if not Voice.deferred then return end
  adoptAndRefresh()
  noticeMissing()
  noticeLanguage()
  if ns.UI and ns.UI.OnVoiceChanged then ns.UI.OnVoiceChanged() end
end

-- A recorded narration exists for this entry with the current voice (or quest dialogue Voice.QuestClip picked, or a
-- question and answer from an answers pack).
function Voice.HasAudio(key)
  if not ns.Lang.ValidateEdition() then return false end
  if isQuestClip(key) and not Voice.QuestDialogue() then return false end
  if not Voice.ready then Voice.Refresh() end
  return key ~= nil and (Voice.active[key] or Voice.questPaths[key] or Voice.answerPaths[key]) ~= nil
end

-- Recheck permission at every real audio start, including queues and restored playback targets.
function Voice.CanPlay(key)
  if not ns.Lang.ValidateEdition() then return false end
  if ns.lang and ns.lang.edition then
    local base, original = (type(key) == "string" and key or ""):match("^(.-)#faq(%d+)$")
    local e = ns.DB.entries[base or key]
    if not e or (base and not ns.Lang.FaqIndex(base, original)) then return false end
  end
  if ns.UI and ns.UI.CanPlayClip then return ns.UI.CanPlayClip(key) end
  return type(key) == "string" and not key:match("#faq%d+$") and not key:match("#section%d+$")
end

-- Every clip id the current voice can play (id -> paths), for the Listen tab.
function Voice.Clips()
  if not ns.Lang.ValidateEdition() then return {} end
  if not Voice.ready then Voice.Refresh() end
  return Voice.active
end

-- The choices for the one-voice picker: Default, each installed voice pack, No narration ("none": every voice off; it
-- was "Game voice only" while the game's text-to-speech read what had no recording).
-- Loading a voice pack only reads its list of clips, so all of them are loaded here to show their counts.
function Voice.Choices()
  if ns.lang and ns.lang.edition then
    local e = ns.lang.edition
    return { { value = "edition:" .. e.id, label = e.name or e.id }, { value = "none", label = L["No narration"] } }
  end
  local def = Voice.DefaultPack()
  local defRec = def and ns.Packs.Get(def)
  local defWhy
  if not def then defWhy = defaultWhy() end
  local out = { { value = "auto", label = defRec and string.format(L["Default (%s)"], defRec.title) or L["Default"],
    note = defWhy } }
  local listed, voices = {}, ns.Packs.List("voice")
  for _, r in ipairs(voices) do
    -- One choice per voice (Voice.KeyOf), shown by its pack in the language the add-on shows.
    local key = Voice.KeyOf(r.name)
    local name = packOf(key)
    local rec = ns.Packs.Get(name) or r
    if not isDefault(key) and not listed[key] then ensure(name) end   -- (loading also reads metadata unreadable before it)
    -- Lands and quest packs extend a voice; they aren't one (one in another language isn't loaded: its name says it).
    if not isDefault(key) and not listed[key] and not extendsVoice(rec, voices) then
      listed[key] = true
      local why = Voice.Unusable(name)
      local have = not why and Voice.Count(name)
      out[#out + 1] = { value = key, rec = rec, why = why,
        label = have and string.format(have == 1 and L["%s (%d narration)"] or L["%s (%d narrations)"], rec.title, have)
          or rec.title }
    end
  end
  out[#out + 1] = { value = "none", label = L["No narration"] }
  return out
end

-- The line under the voice list: how many narrations your voices cover together (the rest show as text only), with
-- the first voice's credit. (Each voice's own counts are on its row: Voice.List.)
function Voice.Status(loreCounts)
  if ns.lang and ns.lang.edition and not ns.Lang.ValidateEdition() then
    return L["Edition unavailable: repair both components and reload, or select another edition in Language options."]
  end
  if Voice.Current() == "none" then return L["Recorded narrations are off: tick a voice to hear them."] end
  local lines, first = {}, Voice.chain[1]
  if Voice.deferred then lines[#lines + 1] = L["Some voices load after combat."] end
  if not first then
    lines[#lines + 1] = Voice.LanguageGap()
      or string.format(L["No recorded narrations installed. Get a voice at %s, then type /reload."], Voice.DOWNLOADS)
    return table.concat(lines, " ")
  end
  if Voice.SoundOff() == "all" then lines[#lines + 1] = L["The game's sound is off, so recorded narrations can't play (System > Sound)."] end
  local covered = 0
  for _ in pairs(Voice.servedBy) do covered = covered + 1 end
  local count = covered >= Voice.total and L["%d of %d narrations."] or L["%d of %d narrations; the rest show as text only."]
  if loreCounts then
    count = covered >= Voice.total and L["%d of %d lore recordings."] or L["%d of %d lore recordings; the rest show as text only."]
  end
  local rec = ns.Packs.Get(first)
  lines[#lines + 1] = (rec and rec.credit and (rec.credit:gsub("%.$", "") .. ". ") or "")
    .. string.format(count, covered, Voice.total)
  return table.concat(lines, " ")
end

-- The voice list as Options and /lore voice show it, in order. Each row: key (as saved in voiceOrder), name (its
-- pack, or nil when the default voice isn't installed), title, label (as shown), default (the "auto" row), on
-- (ticked), why it can't be used (nil if it can), missing (not installed), have/stale (its current and outdated
-- recordings), plays (how many narrations it plays with the list as it is) and races (its X-LoreForever-Races text,
-- if any). Packs are loaded to count them.
function Voice.List()
  local edition = ns.lang and ns.lang.edition
  if edition then
    local have = 0
    for _ in pairs(Voice.Clips()) do have = have + 1 end
    return { { key = "edition:" .. edition.id, name = edition.voiceName, title = edition.name or edition.id,
      label = edition.name or edition.id, on = not S().editionVoiceOff, have = have, stale = 0, plays = have,
      why = edition.unavailable and L["Edition unavailable: repair both components and reload"] or nil } }
  end
  local s, out = prefs(), {}
  for _, key in ipairs(s.voiceOrder) do
    local name = packOf(key)
    local why, code
    if name then
      why, code = Voice.Unusable(name)
    else   -- the default voice with no pack in the language shown: in another language, or not installed
      why, code = defaultWhy()
      if code ~= "MISSING" then name = DEFAULT_PACK end
    end
    local have, stale = 0, 0
    if not why then
      if ensure(name) then have, stale = Voice.Count(name) else why, code = Voice.Unusable(name) end
    end
    local st = name and Voice.stats[name]
    local title = name and Voice.PackName(name)
    out[#out + 1] = { key = key, name = name, title = title or L["Default"],
      label = (key == AUTO and title and string.format(L["Default (%s)"], title)) or title or L["Default"],
      default = key == AUTO, on = not s.voiceOff[key], why = why, missing = code == "MISSING",
      have = have, stale = stale, plays = st and st.plays or 0,
      races = name and ns.Packs.Get(name) and ns.Packs.Get(name).races or nil }
  end
  return out
end

-- Changes to the list take effect at once. In combat, packs that aren't loaded yet join when it ends (Refresh sets
-- Voice.deferred), and the status line says so.
local function listChanged()
  Voice.Refresh()
  if ns.UI and ns.UI.OnVoiceChanged then ns.UI.OnVoiceChanged() end
end

-- Move a voice up (-1) or down (1) the list. Returns true if it moved.
function Voice.Move(key, delta)
  local order = prefs().voiceOrder
  for i, k in ipairs(order) do
    if k == key then
      local j = i + delta
      if j < 1 or j > #order then return false end
      order[i], order[j] = order[j], order[i]
      listChanged()
      return true
    end
  end
  return false
end

-- Tick or untick a voice.
function Voice.SetOn(key, on)
  if ns.lang and ns.lang.edition then
    S().editionVoiceOff = not on or nil
    listChanged()
    return
  end
  prefs().voiceOff[key] = (not on) or nil
  listChanged()
end

-- Take a voice that isn't installed off the list (the default voice always stays). Returns true if it went.
function Voice.Forget(key)
  if key == AUTO or ns.Packs.Get(packOf(key)) then return false end
  local s = prefs()
  for i = #s.voiceOrder, 1, -1 do
    if s.voiceOrder[i] == key then table.remove(s.voiceOrder, i) end
  end
  s.voiceOff[key] = nil
  listChanged()
  return true
end

-- How voices share a story: "story" (a story and its questions in one voice), "zone" or "line" (see Refresh).
function Voice.SetGroup(mode)
  prefs().voiceGroup = mode
  listChanged()
end

-- Put a voice ("auto", or a pack's add-on name) at the top of the list, ticked along with the default voice, or
-- untick every voice ("none"): what picking in the one-voice picker means. Returns true, or false and why not.
function Voice.SetPack(value)
  if ns.lang and ns.lang.edition then
    if value ~= "none" and value ~= "auto" and value ~= "edition:" .. ns.lang.edition.id then
      return false, L["Select a contributor edition or stock language in Options and reload"]
    end
    Voice.SetOn("edition:" .. ns.lang.edition.id, value ~= "none")
    return true
  end
  if value ~= "auto" and value ~= "none" then
    if InCombatLockdown and InCombatLockdown() then return false, L["Can't switch voice during combat"] end
    value = Voice.KeyOf(value)   -- a voice is kept by its key; its pack in the language shown is what loads
    local name = packOf(value)
    ensure(name)
    local why = Voice.Unusable(name) or (not ns.Packs.IsLoaded(name) and L["Didn't load"]) or nil
    if why then return false, why end
  end
  apply(prefs(), value)
  Voice.Refresh()
  if ns.UI and ns.UI.OnVoiceChanged then ns.UI.OnVoiceChanged() end
  return true
end

-- The voice whose sample is playing (Voice.Preview, by list key), or nil. Options shows Stop on its row; anything
-- that stops playback (Voice.Stop: the player, global Stop, another narration) ends it, and so does the clip ending.
local function setPreview(key)
  if not key then Voice.previewClip = nil end
  if Voice.previewing == key then return end
  Voice.previewing = key
  if ns.Options and ns.Options.OnPreviewChanged then ns.Options.OnPreviewChanged() end
end

local function watchPreview(handle)
  local started = GetTime and GetTime() or 0
  local function check()
    if Voice.handle ~= handle or not Voice.previewing then return end
    if not Voice.CanPlay(Voice.previewClip) then return Voice.StopPreview() end
    local playing
    if _G.C_Sound and C_Sound.IsPlaying then
      local ok, p = pcall(C_Sound.IsPlaying, handle)
      if ok then playing = p end
    end
    -- Clients that can't tell whether a sound plays: give up after a minute and a half (samples are shorter).
    if playing == false or (GetTime and GetTime() or 0) - started > 90 then
      Voice.handle = nil
      setPreview(nil)
    else
      C_Timer.After(0.5, check)
    end
  end
  C_Timer.After(0.5, check)
end

-- Stop a sample that's playing (closing Options, opening the panel); leaves other playback alone.
function Voice.StopPreview()
  if Voice.previewing then Voice.Stop() end
end

-- Play a voice's sample (its X-LoreForever-Sample clip, else its first clip). Returns true, or false and why not in
-- words for Options (LOR-136: it said only "Nothing to preview"). "none" (no narration) has nothing to play.
function Voice.Preview(value)
  if ns.lang and ns.lang.edition then return false, L["Listen to an entry in this edition"] end
  if ns.UI and ns.UI.StopAll then ns.UI.StopAll() else Voice.Stop() end
  if value == "none" then return false end
  if Voice.SoundOff() == "all" then
    return false, L["The game's sound is off, so recorded narrations can't play (System > Sound)."]
  end
  local name = packOf(value)
  local data = ensure(name)
  local why
  if not data then
    if name then why = Voice.Unusable(name) or L["Didn't load"] else why = defaultWhy() end
    why = Voice.LanguageGap() or why
  end
  if not data and value ~= "auto" then   -- the saved voice can't be used: preview the one that actually plays
    name = Voice.DefaultPack()
    data = ensure(name)
  end
  if not data then return false, why end
  if not _G.PlaySoundFile then return false end
  -- Current clips only, the sample first, then the rest in order, until one plays.
  local rec, hashes, ids = ns.Packs.Get(name), ns.DB.clipHash or {}, {}
  for k, h in pairs(data.clips) do
    if hashes[k] == h and k ~= rec.sample and Voice.CanPlay(k) then ids[#ids + 1] = k end
  end
  table.sort(ids)
  if rec.sample and hashes[rec.sample] and data.clips[rec.sample] == hashes[rec.sample] and Voice.CanPlay(rec.sample) then
    table.insert(ids, 1, rec.sample)
  end
  if not ids[1] then return false, L["None of its recordings match this version of Lore Forever."] end
  for i = 1, math.min(#ids, 5) do
    local ok, willPlay, handle = pcall(PlaySoundFile, Voice.ClipPath(name, ids[i], data.ext), channel())
    if ok and willPlay then
      Voice.handle = handle
      Voice.previewClip = ids[i]
      setPreview(value)
      watchPreview(handle)
      return true
    end
  end
  return false, string.format(L["A recording didn't play (%s). If it keeps happening, reinstall that voice."],
    Voice.ClipPath(name, ids[1], data.ext))
end

-- Say once a session why a recording didn't play, so the player isn't left with silence and no reason.
local function warnCantPlay(path)
  if Voice.warnedCantPlay then return end
  Voice.warnedCantPlay = true
  if Voice.SoundOff() == "all" then
    say(L["The game's sound is off, so recorded narrations can't play (System > Sound)."])
  else
    say(string.format(L["A recording didn't play (%s). If it keeps happening, reinstall that voice."], tostring(path)))
  end
end

local function now() return GetTime and GetTime() or 0 end

function Voice.Stop()
  if Voice.handle and _G.StopSound then pcall(StopSound, Voice.handle) end
  Voice.handle, Voice.transport, Voice.transportToken, Voice.ended, Voice.failed = nil, nil, nil, nil, nil
  setPreview(nil)
end

-- Heard: every narration this character has played, so arriving somewhere again doesn't replay it. Kept per
-- character in LoreForeverDB.heard = { ["Name-Realm"] = { [clip id] = time first heard } }. Quest dialogue isn't
-- kept: a quest giver speaks each time you open the page (Voice.OnQuestFrame).
local function heardStore()
  if type(LoreForeverDB) ~= "table" then return nil end
  if type(LoreForeverDB.heard) ~= "table" then LoreForeverDB.heard = {} end
  local who = (ns.Journey and ns.Journey.CharKey and ns.Journey.CharKey()) or "?"
  local t = LoreForeverDB.heard[who]
  if type(t) ~= "table" then
    t = {}
    LoreForeverDB.heard[who] = t
  end
  return t
end

function Voice.Heard(id)
  local t = id and heardStore()
  return (t and t[id] ~= nil) or false
end

function Voice.MarkHeard(id)
  local t = id and heardStore()
  if t and t[id] == nil then t[id] = (time and time()) or 0 end
end

-- Quest pages that 0.7.0 kept as heard ("questtext:176:detail", "quest:176#detail") go, every character's: they
-- no longer mean anything, and they'd count as narrations in "Reset heard narrations". Voice.Init runs it.
function Voice.ForgetQuestPages()
  local all = type(LoreForeverDB) == "table" and LoreForeverDB.heard
  for _, t in pairs(type(all) == "table" and all or {}) do
    if type(t) == "table" then
      for id in pairs(t) do
        if type(id) == "string" and (id:find("^questtext:") or id:find("^quest:%d+#%a+$")) then t[id] = nil end
      end
    end
  end
end

-- Forget what this character has heard (Options' "Reset heard narrations"). Returns how many were forgotten.
function Voice.ResetHeard()
  local t, n = heardStore(), 0
  for id in pairs(t or {}) do
    t[id] = nil
    n = n + 1
  end
  Voice.autoSession = {}
  return n
end

-- The add-on folder a recording's path is in: Interface\AddOns\<pack>\Audio\... -> <pack>.
function Voice.PackOf(path)
  return type(path) == "string" and path:match("^Interface\\AddOns\\([^\\]+)\\") or nil
end


-- Segmented transport uses real files; the game has no sound pause, seek or rate API.
-- Pack metadata version 1 is optional and bound to the exact source recording (and full-safe script when present).
local function finite(n) return type(n) == "number" and n == n and n > 0 and n < math.huge end
local function transportPath(pack, file)
  if type(file) ~= "string" then return nil end
  file = file:gsub("/", "\\")
  if not file:match("^Audio\\[%w_%.%-%\\]+$") or file:find("..", 1, true) then return nil end
  if not (file:match("%.mp3$") or file:match("%.ogg$")) then return nil end
  return "Interface\\AddOns\\" .. pack .. "\\" .. file
end

local function dense(parts)
  if type(parts) ~= "table" or #parts == 0 or #parts > 4096 then return false end
  local count = 0
  for i in pairs(parts) do
    if type(i) ~= "number" or i % 1 ~= 0 or i < 1 or i > #parts then return false end
    count = count + 1
  end
  return count == #parts
end

Voice.brokenTransport = {}
function Voice.Transport(key, pack, wholeRecording)
  if ns.lang and ns.lang.edition then return nil end -- contributed overviews never become inherited full reads
  -- Starting a new sound every few seconds causes audible gaps in the client. Keep this prototype hidden
  -- until continuous handoffs are verified in game; ordinary listening uses the existing single recording.
  if not wholeRecording and S().experimentalSegmentedPlayback ~= true then return nil end
  if Voice.brokenTransport[tostring(pack) .. ":" .. tostring(key)] then return nil end
  local data = pack and ns.Packs.data[pack]
  local row = data and data.transportVersion == 1 and type(data.transport) == "table" and data.transport[key]
  if type(row) ~= "table" or type(row.hash) ~= "string" or row.hash == ""
      or row.hash ~= (data.clips and data.clips[key])
      or type(row.text) ~= "string" or not row.text:find("%S") or #row.text > 65536 then return nil end
  if row.fullHash ~= nil and ((ns.DB.fullclipsLocale or "enUS") ~= readingLocale()
      or type(row.fullHash) ~= "string" or row.fullHash ~= (ns.DB.fullclips and ns.DB.fullclips[key])) then
    return nil
  end
  local assetPack = row.assetPack == nil and pack or row.assetPack
  if type(assetPack) ~= "string" or not assetPack:match("^[%w_%-]+$") then return nil end
  local base = row["1"]
  if not dense(base) then return nil end
  if wholeRecording and (not row.fullHash or #base ~= 1) then return nil end
  local starts, total = {}, 0
  for i, part in ipairs(base) do
    if type(part) ~= "table" or not finite(part.duration) or part.duration > 600 then return nil end
    local start = part.start ~= nil and part.start or total
    if type(start) ~= "number" or start ~= start or start < 0 or start == math.huge then return nil end
    if (i == 1 and start ~= 0) or (i > 1 and (start <= starts[i - 1] or math.abs(start - total) > 0.5)) then return nil end
    starts[i], total = start, start + part.duration
  end
  local out = { key = key, pack = pack, assetPack = assetPack, hash = row.hash, fullHash = row.fullHash, duration = total,
    text = type(row.text) == "string" and row.text or nil, rates = {} }
  for _, rate in ipairs(Voice.PLAYBACK_RATES) do
    local parts, valid, list = row[tostring(rate)], true, {}
    if not dense(parts) or #parts ~= #base then valid = false end
    for i, part in ipairs(valid and parts or {}) do
      local path = type(part) == "table" and transportPath(assetPack, part.file)
      local duration = type(part) == "table" and part.duration
      local length = (starts[i + 1] or total) - starts[i]
      if not path or not finite(duration) or duration > 600 or math.abs(duration * rate - length) > 0.75
          or (part.start ~= nil and part.start ~= starts[i]) then valid = false break end
      list[i] = { path = path, duration = duration, start = starts[i], finish = starts[i + 1] or total }
    end
    if valid then out.rates[rate] = list end
  end
  return out.rates[1] and out or nil
end

function Voice.TransportFor(key, pack)
  if not Voice.HasAudio(key) then return nil end
  for _, path in ipairs(Voice.active[key] or Voice.questPaths[key] or Voice.answerPaths[key] or {}) do
    local source = Voice.PackOf(path)
    local row = (not pack or source == pack) and Voice.Transport(key, source)
    if row then return row end
  end
end

local function soundPlaying()
  if Voice.handle and _G.C_Sound and C_Sound.IsPlaying then
    local ok, playing = pcall(C_Sound.IsPlaying, Voice.handle)
    if ok then return playing end
  end
end

function Voice.Position()
  local t = Voice.transport
  if not t then return nil end
  local part = t.parts[t.index]
  local elapsed = math.max(0, ((GetTime and GetTime()) or 0) - t.started)
  return t.failedOffset or math.min(part.finish, part.start + elapsed * t.rate), t.row.duration, t.rate
end

local function segment(t, index)
  if not Voice.CanPlay(t.row.key) then return false end
  local part = t.parts[index]
  if not part then return false end
  local ok, plays, handle = pcall(PlaySoundFile, part.path, channel())
  if not (ok and plays) then return false end
  Voice.handle, t.index, t.started, t.seenPlaying = handle, index, (GetTime and GetTime()) or 0, false
  if Voice.lastClip then Voice.lastClip.path = part.path end
  return true
end

local function beginTransport(row, options)
  local rate = 1
  local offset = options and tonumber(options.offset) or 0
  if not offset or offset ~= offset or offset < 0 or offset == math.huge or offset >= row.duration then offset = 0 end
  local parts, index = row.rates[rate], 1
  for i, part in ipairs(parts) do if part.start <= offset then index = i else break end end
  local t = { row = row, parts = parts, rate = rate, index = index }
  if not segment(t, index) then return false end
  Voice.transport, Voice.transportToken = t, {}
  local token = Voice.transportToken
  local function tick()
    if Voice.transportToken ~= token or Voice.transport ~= t then return end
    if not Voice.CanPlay(t.row.key) then
      if ns.UI and ns.UI.StopAll then ns.UI.StopAll() else Voice.Stop() end
      return
    end
    local part = t.parts[t.index]
    local elapsed = ((GetTime and GetTime()) or 0) - t.started
    local playing = soundPlaying()
    local function fail(path, offset)
      if Voice.handle and _G.StopSound then pcall(StopSound, Voice.handle) end
      warnCantPlay(path)
      t.failedOffset = offset
      Voice.handle, Voice.transportToken, Voice.failed = nil, nil, true
    end
    if playing == true then t.seenPlaying = true end
    if elapsed > part.duration + 5 then
      -- A stalled handle is a failure, never successful completion of the story.
      fail(part.path, part.start)
      return
    end
    -- Give an initially delayed sound handle time to start. Once observed playing, no extra gap is needed.
    local stopped = playing == false and (t.seenPlaying or elapsed >= math.min(1, part.duration))
    if stopped and elapsed < part.duration - 0.75 then
      fail(part.path, part.start)
      return
    end
    if stopped or (playing == nil and elapsed >= part.duration) then
      if t.index >= #t.parts then
        Voice.handle, Voice.transport, Voice.transportToken, Voice.ended = nil, nil, nil, true
        return
      end
      local nextPart = t.parts[t.index + 1]
      if not segment(t, t.index + 1) then
        fail(nextPart.path, nextPart.start)
        return
      end
    end
    C_Timer.After(0.05, tick)
  end
  C_Timer.After(0.05, tick)
  return true
end


-- Play an entry's recorded narration: the chosen voice's file, or the next voice's if the game can't play it (e.g.
-- the file is missing from the pack). Returns true if it started. Narrations are marked heard; quest dialogue isn't.
-- An arrival story waiting for its turn that plays some other way (you play it, or your playlist does) stops waiting.
-- Voice.lastClip keeps the recording that played last, after it ends too: its clip id, the pack whose file played
-- and the hash that file was recorded from, for "Report a problem with this narration" (ClipReport.lua, LOR-232).

function Voice.Play(key, options)
  if not Voice.CanPlay(key) then return false end
  local paths = Voice.HasAudio(key) and (Voice.active[key] or Voice.questPaths[key] or Voice.answerPaths[key])
  if not paths or not _G.PlaySoundFile then return false end
  Voice.Stop()
  local continuing = options and type(options.pack) == "string" and finite(options.offset)
  for _, path in ipairs(paths) do
    local pack = Voice.PackOf(path)
    if not continuing or pack == options.pack then
      local data = pack and ns.Packs.data[pack]
      local whole = not continuing and Voice.Transport(key, pack, true)
      local row = not whole and Voice.Transport(key, pack)
      local resume = row and options and options.pack == pack and options.hash == row.hash
        and options.fullHash == row.fullHash
      if continuing and not resume then warnCantPlay(path) return false end
      local wanted = resume and options or { rate = Voice.PlaybackRate() }
      local started = row and beginTransport(row, wanted)
      local handle
      if row and not started then
        Voice.brokenTransport[pack .. ":" .. key] = true
        if resume and (tonumber(options.offset) or 0) > 0 then
          -- A continuation must never quietly jump to the beginning of a whole-file recording.
          warnCantPlay(path)
          return false
        end
      end
      if not started then
        local playbackPath = whole and whole.rates[1][1].path or path
        local ok, willPlay, h = pcall(PlaySoundFile, playbackPath, channel())
        started, handle = ok and willPlay, h
        if whole and not started then
          whole = nil
          if data and data.clips[key] == ((ns.DB and ns.DB.clipHash) or {})[key] then
            ok, willPlay, h = pcall(PlaySoundFile, path, channel())
            started, handle = ok and willPlay, h
          end
        end
      end
      if started then
        if not Voice.transport then Voice.handle = handle end
        if Voice.active[key] or Voice.answerPaths[key] then Voice.MarkHeard(key) end
        if Voice.autoWaiting and Voice.autoWaiting.key == key then Voice.autoWaiting = nil end
        local transport = Voice.transport
        Voice.lastClip = { id = key, pack = pack,
          path = whole and whole.rates[1][1].path or (transport and transport.parts[transport.index].path or path),
          hash = whole and whole.fullHash or (transport and (transport.row.fullHash or transport.row.hash) or (data and data.clips and data.clips[key])),
          text = whole and whole.text or (transport and transport.row.text or nil),
          duration = whole and whole.duration or nil }
        if ns.lang and ns.lang.edition then
          local base, original = key:match("^(.-)#faq(%d+)$")
          local e = ns.DB.entries[base or key]
          local i = base and ns.Lang.FaqIndex(base, original)
          Voice.lastClip.text = i and e.faq[i].a or e.s
        end
        return true
      end
      dbg("can't play", path)
    end
  end
  if not (ns.lang and ns.lang.edition) then warnCantPlay(paths[1]) end
  return false
end


-- Whether the recording that started plays on: true or false when the client can tell (C_Sound.IsPlaying), nil when
-- it can't (UI's watchPlayback then goes by the length of its text).
function Voice.IsPlaying()
  if Voice.failed then return false end
  if Voice.transport then return true end
  if Voice.ended then return false end
  return soundPlaying()
end

-- Play `key`'s recorded narration (Voice.Play): there's no other way to hear it, so what no voice recorded stays as
-- text. When nothing can play because every installed voice is in another language (Voice.LanguageGap), the first try
-- of the session says so in chat: the login line is easy to miss, and nothing else would show why nothing plays
-- (LOR-136). Returns true if it started.
function Voice.Narrate(key, options)
  if Voice.Play(key, options) then return true end
  if ns.lang and ns.lang.edition then return false end
  if not Voice.toldLanguageOnPlay then
    local gap = Voice.LanguageGap()
    if gap then
      Voice.toldLanguageOnPlay = true
      say(gap)
    end
  end
  return false
end

-- Narration: only when I press Play (Options, the minimap button's right-click menu, /lore ondemand; LOR-138): nothing
-- plays by itself (arrivals, flights, quest givers, books), while play buttons, the Narrate key and the playlist work
-- as ever. Off by default; the separate toggles keep their own settings underneath it.
function Voice.OnDemand() return S().onDemand == true end

-- Direct quest pages are independent of Lore Forever's stories and answers, and require an explicit opt-in.
function Voice.QuestDialogue() return S().questDialogue == true end

-- The game's own cutscenes and voiced dialog: a cinematic, a movie, or a talking head (on clients that have one).
-- Nothing starts by itself over them, and what started by itself stops when one begins (Voice.OnGameTalk).
local GAME_TALK_FRAMES = { "CinematicFrame", "MovieFrame", "TalkingHeadFrame" }
function Voice.GameTalking()
  for _, name in ipairs(GAME_TALK_FRAMES) do
    local f = _G[name]
    if type(f) == "table" and f.IsShown and f:IsShown() then return true end
  end
  return false
end

-- What started by itself and still plays ({id, token}): a quest giver's or a book's page, an arrival (also
-- Voice.autoPlaying), or a flight's zone story (a playlist item marked flight = true).
local function markAuto()
  local UI = ns.UI
  if UI and UI.speaking then Voice.autoStarted = { id = UI.playingId, token = UI.playToken } end
end

local function autoPlayingNow()
  local UI, a = ns.UI, Voice.autoStarted
  if not (UI and UI.speaking) then return false end
  if a and UI.playingId == a.id and UI.playToken == a.token then return true end
  local cur = UI.pl and UI.pl.state == "playing" and UI.pl.items[UI.pl.pos]
  return cur and cur.flight and UI.playingId == cur.id or false
end

-- Flight narration: when a taxi flight starts, and each time it crosses into a new zone, play that zone's recorded
-- story (a zone no voice recorded passes in silence). Voice.flying notes a flight with flight narration off too:
-- landing is arriving (Voice.OnLanded).
local narrated = {}
function Voice.OnTaxiCheck()
  local onTaxi = UnitOnTaxi and UnitOnTaxi("player")
  if onTaxi then Voice.flying = true end
  if not S().narrateFlights or Voice.OnDemand() then return end
  if not onTaxi then
    narrated = {}
    return
  end
  if Voice.GameTalking() then return end   -- the next zone line (or PLAYER_CONTROL_LOST) tries again
  local zone = GetRealZoneText and GetRealZoneText()
  local zk = zone and ns.engine and ns.engine:ZoneKey(zone)
  local key = zk and "zone:" .. zk
  local e = key and ns.DB.entries[key]
  if not e or narrated[zk] or Voice.autoSession[key] or (S().skipHeard ~= false and Voice.Heard(key)) then return end
  if ns.UI and ns.UI.speaking and ns.UI.playingId == key then narrated[zk] = true return end
  narrated[zk] = true
  local UI = ns.UI
  if UI and UI.PlaylistAddFlight and UI.CanQueue(key) then
    -- Recorded zone stories go through the playlist, so crossing zones quickly queues them one after another
    -- instead of cutting off the one playing.
    local i = UI.PlaylistAddFlight(key) and UI.PlaylistIndex(key)
    if i then
      UI.pl.items[i].flight = true
      if UI.speaking and UI.playingId == key then Voice.autoSession[key] = true end
    end
  end
end

-- Playing on arrival (Options > Play narrations as you arrive): reaching a zone or a place with a recorded narration
-- plays it, once per character (or once a session with "Skip what you've heard" off). Arrivals settle for a moment
-- first, so a loading screen or hopping back and forth across a zone line plays only where you end up.
--
-- What plays by itself, and when (Mike on stream, 2026-10-04: "the behavior needs to be better specified"). The
-- tests follow these rules one by one: wow_sim.py's arrival_queue_tests and arrival_once_tests.
--   What can cut off what
--   - Whatever you play yourself (a play button, Listen, the Narrate key, your playlist's Play or Next) replaces what
--     plays. Adding to the playlist queues behind it.
--   - A quest giver's page cuts off an arrival story or the last quest's page (Voice.OnQuestFrame). The game's own
--     cutscenes, movies and talking heads stop whatever started by itself (Voice.OnGameTalk).
--   - An arrival story cuts off nothing. Neither does a book page or a flight's zone story (it joins the playlist).
--   What waits
--   - An arrival story waits its turn while anything else plays (or the playlist is between two stories), in combat,
--     while a quest giver's or gossip window is open, during the game's cutscenes and on a flight. One waits at a
--     time: arriving somewhere else replaces it, while a zone's story keeps its place as you cross the zone.
--   - Its turn comes when that ends by itself: what played finishes, the fight ends, the window closes, the cutscene
--     ends, you land (landing is arriving; the zones flown over aren't). Stopping narration yourself never starts it.
--   - Cut off by a quest giver or a cutscene, it waits again and gets one more go from the top, never a second.
--   What expires
--   - When its turn comes, it's dropped if you've left its place (its zone, for a zone's story) or if more than
--     ARRIVAL_WAIT seconds have passed since you arrived.
--   - One that never started can start later: dropped because you left, it plays when you come back; out of time,
--     it doesn't start by itself again this session, but plays next session (it isn't kept as heard).
--   Once
--   - One that started never starts by itself again, whether it played to the end or was cut off (LOR-285: a player
--     heard stories start over each time they came back). It's kept as heard from the moment it starts (Voice.Play),
--     per character, and Voice.autoSession keeps it off for the session with "Skip what you've heard" off. The one
--     more go above is the only second start. Listen, the Narrate key, Shift-click and the playlist play it any time.
local AUTO_SETTLE = 3
-- 90 s: the longest arrival story runs 72 s (median 51 s; the default voice's zone and place stories, 2026-10-05), so
-- one that arrives just as another starts can wait it out, or a fight or a quest giver's page, and still play. Later
-- than that it's out of step with where you are: on stream Duskwood's story started two minutes after Mike landed in
-- Darkshire, and he called it "very much desynced".
local ARRIVAL_WAIT = 90
local TURN_GAP = 1.5   -- from the end of what played to a waiting arrival story (the playlist's gap between two)
Voice.autoSession = {}   -- arrival stories that started by themselves (or ran out of time) this session

local function inCombat()
  return (InCombatLockdown and InCombatLockdown()) or (UnitAffectingCombat and UnitAffectingCombat("player")) or false
end

-- Talking to someone: a quest giver's or a gossip window is open. Arriving in a town usually means walking straight
-- up to its quest givers, and the town's story shouldn't talk over them.
local function talking()
  for _, name in ipairs({ "QuestFrame", "GossipFrame" }) do
    local f = _G[name]
    if f and f.IsShown and f:IsShown() then return true end
  end
  return false
end

local function fresh(id)
  if Voice.autoSession[id] then return false end
  return S().skipHeard == false or not Voice.Heard(id)
end

-- Quest and book pages play once each time their window opens: the game sending the same page again doesn't start it
-- over, or again after you stopped it. Opening the window again plays it again: a quest giver's page always (it isn't
-- kept as heard), a book's unless "Skip what you've heard" is on and this character has heard it (pageFresh). Closing
-- the window forgets its pages (closePages).
Voice.openPages = {}

local function pageFresh(id)
  if Voice.openPages[id] then return false end
  return S().skipHeard == false or not Voice.Heard(id)
end

local function closePages(prefix)
  for id in pairs(Voice.openPages) do
    if id:sub(1, #prefix) == prefix then Voice.openPages[id] = nil end
  end
end

-- Where you are: the zone's key ("duskwood"), the places you're in (a set of subzone entry keys) and the subzone's.
-- Inside some buildings Forever names the building as the zone and gives no subzone ("Darkshire Town Hall"): that's
-- one of the places you're in, and its entry says the zone.
local function where()
  local db, places = ns.DB or {}, {}
  local function place(name)
    local k = type(name) == "string" and name ~= "" and db.index and db.index.name[ns.Engine.lower(name)]
    local e = k and db.entries[k]
    if e and e.t == "subzone" then return k, e end
  end
  local zone = GetRealZoneText and GetRealZoneText()
  local zk = type(zone) == "string" and zone ~= "" and ns.engine and ns.engine:ZoneKey(zone) or nil
  if not zk then
    local k, e = place(zone)
    if k then zk, places[k] = e.z, true end
  end
  local sk = place(GetSubZoneText and GetSubZoneText())
  if sk then places[sk] = true end
  return zk, places, sk
end

-- What to play where you are: the zone's story the first time you're there, then the place's. The one waiting its
-- turn keeps its place in line while you're there.
local function arrivalKey()
  local zk, _, sk = where()
  local w = Voice.autoWaiting
  for _, key in ipairs({ zk and ("zone:" .. zk) or false, sk or false }) do
    if key and Voice.HasAudio(key) and ((w and w.key == key) or fresh(key)) then return key end
  end
end

-- Whether you're still in (or over) what an arrival story is about: its zone, for a zone's story. A zone the data
-- doesn't know (a building it has no entry for) doesn't count as leaving.
local function stillThere(key)
  local zk, places = where()
  local zone = key:match("^zone:(.+)$")
  if zone then return zk == nil or zk == zone end
  return places[key] == true
end

local function onTaxi() return (UnitOnTaxi and UnitOnTaxi("player")) and true or false end

-- Something plays, or the playlist is between two stories or waiting for one to end.
local function busy()
  local UI = ns.UI
  return UI.IsBusy() or UI.pl.state == "waiting"
end

-- Start the arrival story that waited (w: { key, at = when you arrived, again = it was cut off once }). Returns true
-- if it started.
local function startArrival(w)
  local UI, key = ns.UI, w.key
  local target = UI.EntryTarget(key)
  if not target then return false end
  UI.ListenTo(target)
  if not (UI.speaking and UI.playingId == key) then return false end
  Voice.autoSession[key] = true
  -- It started by itself, so a quest giver may take over from it (Voice.OnQuestFrame).
  Voice.autoPlaying = { key = key, token = UI.playToken, at = w.at, again = w.again }
  markAuto()
  if UI.frame:IsShown() then return true end
  local line = string.format(L["now playing: %s. %s"], target.label, ns.Hooks.Link(L["Read along"], "entry", key))
    .. " " .. ns.Hooks.Link(L["Stop"], "listen", key)
  if not S().autoZoneTold then
    S().autoZoneTold = true
    line = line .. " " .. L["(Narrations play as you arrive; Options > Play narrations as you arrive turns this off.)"]
  end
  say(line)
  return true
end

-- Arrival stories are off: Options, "only when I press Play", no recorded voice, or no panel yet.
local function arrivalsOff()
  return S().autoZone == false or Voice.OnDemand() or Voice.Current() == "none" or not (ns.UI and ns.UI.frame)
end

-- The waiting arrival story's turn (the rules above): it starts if nothing stands in its way, keeps waiting if
-- something does, and is dropped once it's out of step. Returns true if it started.
function Voice.ArrivalTurn()
  local w = Voice.autoWaiting
  if not w then return false end
  if arrivalsOff() then
    Voice.autoWaiting = nil
    return false
  end
  if now() - w.at > ARRIVAL_WAIT then
    Voice.autoWaiting, Voice.autoSession[w.key] = nil, true
    return false
  end
  if not (stillThere(w.key) and Voice.HasAudio(w.key)) then   -- (or the voice now playing has no recording of it)
    Voice.autoWaiting = nil
    return false
  end
  if inCombat() or talking() or Voice.GameTalking() or onTaxi() or busy() then return false end
  Voice.autoWaiting = nil
  return startArrival(w)
end

-- You've settled somewhere: what's narrated here becomes the arrival story that waits (unless it already is), then
-- it's that story's turn. On a flight nothing does: flight narration has the zones you fly over, and where you land
-- is an arrival of its own (Voice.OnLanded).
local function autoPlay()
  if arrivalsOff() then
    Voice.autoWaiting = nil
    return
  end
  if onTaxi() then return end
  Voice.flying = nil   -- (landed, if PLAYER_CONTROL_GAINED didn't come)
  local key, w = arrivalKey(), Voice.autoWaiting
  if key and not (w and w.key == key) then Voice.autoWaiting = { key = key, at = now() } end
  Voice.ArrivalTurn()
end

-- Called on every zone or subzone change, and at login.
function Voice.OnArrive()
  if S().autoZone == false or Voice.OnDemand() then return end
  local token = {}
  Voice.autoToken = token
  C_Timer.After(AUTO_SETTLE, function()
    if Voice.autoToken == token then autoPlay() end
  end)
end

-- Combat ended, or you stopped talking to someone: the waiting arrival story's turn (if you're still there). It settles
-- first, so walking from one quest giver to the next doesn't start it.
function Voice.OnCombatOver()
  if Voice.autoWaiting then Voice.OnArrive() end
end
Voice.OnTalkOver = Voice.OnCombatOver

-- What played ended by itself (UI's watchPlayback): the waiting arrival story's turn, after the playlist's gap. The
-- playlist going on to its next story keeps it waiting.
function Voice.OnNarrationEnded()
  if not Voice.autoWaiting then return end
  C_Timer.After(TURN_GAP, function() Voice.ArrivalTurn() end)
end

-- PLAYER_CONTROL_GAINED: off a flight, landing is arriving where you land. Nothing marked it before, so a zone's story
-- waited for the next zone line: on stream (2026-10-04) Duskwood's came two minutes after Mike landed in Darkshire, as
-- he walked out of its town hall.
function Voice.OnLanded()
  if not Voice.flying or onTaxi() then return end
  Voice.flying = nil
  Voice.OnArrive()
end

-- Quest dialogue (Options > Narrate quest dialogue): when a quest giver's window opens a page, the quest giver's
-- recorded words play (Voice.QuestClip); a page no voice recorded stays as text. It plays each time the window opens
-- on the page, heard or not, and once per opening
-- (Voice.openPages). Closing the window or opening another quest stops it, and the play button beside the window's
-- Lore button (Hooks.questDialogPlay) plays it again or stops it.
local QUEST_PREFIX = "questtext:"

local function isQuestText(id) return type(id) == "string" and id:sub(1, #QUEST_PREFIX) == QUEST_PREFIX end

local function questPage(kind)
  local parts = {}
  local function add(fn)
    local f = _G[fn]
    local ok, v = false, nil
    if f then ok, v = pcall(f) end
    if ok and type(v) == "string" and v:find("%S") then parts[#parts + 1] = v end
  end
  if kind == "detail" then
    add("GetTitleText")
    add("GetQuestText")
    add("GetObjectiveText")
  elseif kind == "progress" then
    add("GetProgressText")
  else
    add("GetRewardText")
  end
  return table.concat(parts, " ")
end
Voice.QuestPageText = questPage

-- A voice's gender, for matching quest givers: ## X-LoreForever-Gender (male or female) in its .toc, else read from
-- our own packs' names (LoreForever_Voice_Female..., the default voice is the male narrator). nil if unknown.
function Voice.Gender(name)
  local rec = ns.Packs.Get(name)
  local g = rec and rec.gender and rec.gender:lower()
  if g == "male" or g == "female" then return g end
  if name:find("_Female", 1, true) then return "female" end
  if isDefault(name) then return "male" end
end

-- The fingerprints of a quest text as the add-on's data has them (lore.quest_dialogue.fingerprint): the player's own
-- name, class and race taken out (the game puts them where the text has <name>, <class>, <race>; "<race>s" shows as
-- "Humans", so a plural s stays), then the ASCII letters and digits only, lower-cased, hashed with djb2 mod 2^32.
-- Spacing, punctuation and accented letters never matter. A text can also name a class or race outright ("He's
-- human"), so there's one fingerprint with and one without taking each out; the first takes out all three.
-- Letters are matched as bytes, never by the C library's %w (which can follow the system's locale): ASCII ones, and
-- every byte of a UTF-8 character, so an accented name or class is one word ("Élodie", the Brazilian shaman "Xamã").
-- UTF-8 punctuation (¡ ¿ « » and the no-break space, dashes, curly quotes, …) turns into a space first, so "¡Íñigo!"
-- still has the name as a word of its own. None of it changes the fingerprint: only ASCII letters and digits count.
local WORD = "0-9A-Za-z\128-\255"
local function unpunctuate(s) return (s:gsub("\194[\128-\191]", " "):gsub("\226\128[\128-\191]", " ")) end
local function escapePattern(s) return (s:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0")) end
local function playerWord(fn)
  local f = _G[fn]
  local ok, word = false, nil
  if f then ok, word = pcall(f, "player") end
  return ok and type(word) == "string" and word ~= "" and word:lower() or nil
end
-- The player's class as a quest can name it: in German, French, Spanish and Portuguese a class has a masculine and a
-- feminine name (Krieger/Kriegerin), and either may be the one on screen, so both are taken out.
local function classWords()
  local words, seen = {}, {}
  local function add(w)
    if type(w) == "string" and w ~= "" and not seen[w:lower()] then
      seen[w:lower()] = true
      words[#words + 1] = w:lower()
    end
  end
  local ok, name, file = false, nil, nil
  if _G.UnitClass then ok, name, file = pcall(UnitClass, "player") end
  if not ok then return words end
  add(name)
  for _, t in ipairs({ _G.LOCALIZED_CLASS_NAMES_MALE, _G.LOCALIZED_CLASS_NAMES_FEMALE }) do
    if type(t) == "table" and file then add(t[file]) end
  end
  return words
end
local function djb2(s)
  s = s:gsub("[^0-9a-z]", "")
  local h = 5381
  for i = 1, #s do h = (h * 33 + s:byte(i)) % 4294967296 end
  return string.format("%08x", h)
end
function Voice.QuestFingerprints(text)
  local function without(s, words, loose)
    if type(words) ~= "table" then words = { words } end
    for _, word in ipairs(words) do
      -- loose: the name with a suffix glued on, as a dwarf says it ("<name>ama" shows as "Testerama").
      s = s:gsub("%f[" .. WORD .. "]" .. escapePattern(word) .. (loose and "" or "(s?)%f[^" .. WORD .. "]"),
        loose and "" or "%1")
    end
    return s
  end
  local lower, name = unpunctuate(string.lower(text or "")), playerWord("UnitName")
  local class, race = classWords(), playerWord("UnitRace")
  local out, seen = {}, {}
  for _, base in ipairs({ without(lower, name), without(lower, name, true) }) do
    for _, s in ipairs({ without(without(base, class), race), without(base, race), without(base, class), base }) do
      local fp = djb2(s)
      if not seen[fp] then seen[fp], out[#out + 1] = true, fp end
    end
  end
  return out
end
function Voice.QuestFingerprint(text) return Voice.QuestFingerprints(text)[1] end

local QUEST_PART = { detail = 2, progress = 3, complete = 4 }
local QUEST_TEXT = { detail = "GetQuestText", progress = "GetProgressText", complete = "GetRewardText" }

-- Quest givers' voices (LoreForever_Voice_QuestGivers, LOR-225): quest dialogue in a voice of each quest giver's race
-- and gender, every clip with the voice it's in (P.speaker[id] = "dwarf-male"). It isn't a voice of its own (its
-- X-LoreForever-Extends names the quest dialogue pack, so it's never in the list). With "Match the quest giver's
-- voice" on it plays first, but only when the quest giver in front of you fits the recording: the same gender
-- (UnitSex("npc")) and, when the add-on can tell the race from the model (ns.NpcRace("npc"), LOR-224), the same race.
-- (QUEST_GIVERS, its name, is at the top of the file.)
-- The client's model race (ns.NpcRace: "BloodElf", "Scourge", "NightElf") -> the data's (lore.quest_givers.RACES):
-- before The Burning Crusade blood elf models are high elves, and a playable race's variants count as it.
local SPEAKER_RACE = { undead = "forsaken", scourge = "forsaken", bloodelf = "highelf", voidelf = "highelf",
  thinhuman = "human", kultiran = "human", felorc = "orc", magharorc = "orc", darkirondwarf = "dwarf",
  earthendwarf = "dwarf", nightborne = "nightelf", highmountaintauren = "tauren", taunka = "tauren",
  mechagnome = "gnome", foresttroll = "troll", icetroll = "troll", zandalaritroll = "troll" }

local function npcRace()
  if type(ns.NpcRace) ~= "function" then return nil end
  local ok, race = pcall(ns.NpcRace, "npc")
  race = ok and type(race) == "string" and race:lower():gsub("[^%a]", "") or ""
  if race == "" then return nil end
  return SPEAKER_RACE[race] or race
end

-- The quest givers' recording of a clip for a quest giver of this gender, if it's current and fits them: its path, the
-- fingerprint rows of the words it reads and the pack. window: the quest window's own page, where the NPC in front of
-- you is the speaker, so a model race the add-on can tell must be the one the clip expects: P.model[id] where the
-- quest giver's model isn't of their own race (Skyborne drawn with blood elf models: "highelf"), else the race of the
-- clip's voice. The pack is the one in the language shown: LoreForever_Voice_QuestGivers for English (current when its
-- hash is ns.DB.questClip's), LoreForever_Voice_QuestGivers_<locale> in another language (LOR-226, with its own
-- P.questVoice like the narrators' quest packs in that language); one in another language than the one shown never
-- loads.
local function giverClip(id, want, window)
  local pack = want and Voice.InLanguage(QUEST_GIVERS)
  local data = pack and ensure(pack)
  local own = data and type(data.questVoice) == "table" and data.questVoice or nil
  local hash = ns.DB and ns.DB.questClip and ns.DB.questClip[id]
  local current = data and data.clips[id] ~= nil and (own ~= nil or data.clips[id] == hash)
  local speaker = current and type(data.speaker) == "table" and data.speaker[id]
  local race, gender = tostring(speaker or ""):match("^(%a+)%-(%a+)$")
  if not gender or gender ~= want then return nil end
  if window then
    local seen = npcRace()
    local expect = type(data.model) == "table" and type(data.model[id]) == "string" and data.model[id] or race
    if seen and seen ~= expect then return nil end
  end
  return Voice.ClipPath(pack, id, data.ext), own or ns.DB.questVoice, pack
end

-- The recorded quest dialogue for the open quest window, if a voice has one and its text is exactly what's on screen
-- (ns.DB.questVoice[questID] = { quest the clip is named after, fingerprints of its quest text, progress text and
-- completion text, and who says each when the data knows: "f", "m" or "-", so "fmm" }); nil otherwise, so a quest
-- Forever changed stays as text. With "Match the quest giver's voice" on, the quest givers' voice that fits
-- goes first, then a voice of the quest giver's gender: the NPC you're talking to (UnitSex("npc")) on the quest
-- window's own page when it can tell, else the data's. Fills Voice.questPaths[id] for Voice.Play. Away from the quest
-- window (the quest log and playlist, UI.QuestPageClip): text is the quest log's words to check instead, and unchecked
-- trusts the recording when there are none to check; the quest givers' voice plays there when the data knows the
-- page's speaker is of the clip's gender (no model to look at, so no race check). peek: only whether one would play,
-- leaving Voice.questPaths as it is (a tooltip or the playlist's + asking, UI.QuestPageClip).
local GENDER_CODE = { f = "female", m = "male" }
-- Each recording is checked against the fingerprints of the words it reads: ns.DB.questVoice's for English, a quest
-- pack's own in another language (LOR-226), so an English recording never plays over German text, nor a German one
-- over English. The quest's row in the add-on's data names its clip and who says each page; a quest only a pack in
-- another language has (its English left the data since) goes by its quest ID.
function Voice.QuestClip(qid, kind, text, unchecked, peek)
  if ns.lang and ns.lang.edition then return nil end
  local part = QUEST_PART[kind]
  if not (qid and part) then return nil end
  if not Voice.ready then Voice.Refresh() end
  local rec = ns.DB and ns.DB.questVoice and ns.DB.questVoice[qid]
  local id = "quest:" .. tostring(rec and rec[1] or qid) .. "#" .. kind
  local list = Voice.questRanked and Voice.questRanked[id] or {}
  rec = rec or (list[1] and list[1][3] and list[1][3][qid])
  if not rec then return nil end
  local window = text == nil and not unchecked   -- the quest window's own page, read from the window below
  local want
  if S().voiceMatchGender ~= false then
    -- "npc" is whoever's window is open, so only the window's own page asks it (a story's Listen may be another quest).
    local sex
    if window and _G.UnitSex then
      local ok, s = pcall(UnitSex, "npc")
      sex = ok and s or nil
    end
    local code = type(rec[5]) == "string" and rec[5]:sub(part - 1, part - 1) or ""
    want = (sex == 2 and "male") or (sex == 3 and "female") or GENDER_CODE[code]
  end
  local giver, giverRows, giverPack = giverClip(id, want, window)
  if not list[1] and not giver then return nil end
  local shown   -- the fingerprints of the words on screen (none to check: unchecked)
  if not unchecked then
    if text == nil then
      local f = _G[QUEST_TEXT[kind]]
      local ok, words = false, nil
      if f then ok, words = pcall(f) end
      text = ok and words or nil
    end
    if type(text) ~= "string" or not text:find("%S") then return nil end
    shown = Voice.QuestFingerprints(text)
  end
  -- A recording plays when the data it came with has this page, and (when checked) its words are the ones on screen.
  local function reads(rows)
    local row = type(rows) == "table" and rows[qid]
    local fps = type(row) == "table" and row[part]
    if type(fps) ~= "string" or fps == "" then return false end
    for _, fp in ipairs(shown or {}) do
      if (" " .. fps .. " "):find(" " .. fp .. " ", 1, true) then return true end
    end
    return shown == nil
  end
  if giver and not reads(giverRows) then giver = nil end
  local fits = {}
  for _, v in ipairs(list) do
    if reads(v[3]) then fits[#fits + 1] = v end
  end
  if not fits[1] and not giver then return nil end
  if peek then return id end
  local order = fits
  if want and #fits > 1 then
    local yes, no = {}, {}
    for _, v in ipairs(fits) do table.insert(Voice.Gender(v[1]) == want and yes or no, v) end
    for _, v in ipairs(no) do yes[#yes + 1] = v end
    order = yes
  end
  local paths = { giver }
  for _, v in ipairs(order) do paths[#paths + 1] = v[2] end
  -- Kept apart from Voice.active / servedBy, which list and count the lore narrations (Listen tab, Status).
  Voice.questPaths[id], Voice.questServed[id] = paths, giver and giverPack or order[1][1]
  return id
end

-- The page on screen as something to play ({id, key, label, text, story}): the quest giver's own words when a voice
-- recorded them (Voice.QuestClip); nil when the page has no matching recording (the page stays as text).
-- kind: "detail", "progress" or "complete"; recorded: the quest's lore entry, if it has one (story: what
-- the player's title opens, UI.PlayerOpenStory).
local function questTarget(qid, kind, recorded)
  local voiced = Voice.Current() ~= "none"
  local key = voiced and Voice.QuestClip(qid, kind) or nil
  if not key then return nil end
  local id = QUEST_PREFIX .. qid .. ":" .. kind
  return { id = id, key = key, label = (GetTitleText and GetTitleText()) or L["Quest"], text = questPage(kind),
    story = recorded }
end

local function openQuest()
  local qid = Voice.questKind and GetQuestID and GetQuestID()
  if qid and qid ~= 0 then return qid end
end

-- The narration that started by itself as you arrived (autoPlay) and still plays, if any.
local function arrivalPlaying()
  local a, UI = Voice.autoPlaying, ns.UI
  if a and UI.speaking and UI.playingId == a.key and UI.playToken == a.token then return a end
end

-- An arrival's story makes way (for a quest giver, or the game's own cutscene). The first time it waits for its turn
-- again, its clock still running from when you arrived (unless a newer arrival already waits); cut off again, it's
-- dropped, never started over in a loop. It started, so it stays heard (and in Voice.autoSession): coming back to its
-- place never starts it again by itself (LOR-285; 0.8.0 forgot it here, so every return started it over).
local function yieldArrival(arrival)
  Voice.autoPlaying = nil
  if not (arrival.again or Voice.autoWaiting) then
    Voice.autoWaiting = { key = arrival.key, at = arrival.at or now(), again = true }
  end
end

-- A quest giver's window shows a page (QUEST_DETAIL, QUEST_PROGRESS, QUEST_COMPLETE). Voice.questKind remembers which,
-- for the play button and UI.QuestPageClip.
function Voice.OnQuestFrame(kind, recorded)
  Voice.questKind, Voice.questRecorded = kind, recorded
  local UI = ns.UI
  if not Voice.QuestDialogue() or Voice.OnDemand() or not (UI and UI.frame) then return end
  local qid = openQuest()
  if not qid then return end
  local id = QUEST_PREFIX .. qid .. ":" .. kind
  local ours, arrival = UI.speaking and isQuestText(UI.playingId), arrivalPlaying()
  if UI.IsBusy() and not (ours or arrival) then return end   -- never over something you started
  if UI.playingId == id then return end
  local target = not Voice.openPages[id] and not Voice.GameTalking() and questTarget(qid, kind, recorded) or nil
  if not target then
    if ours then UI.StopAll() end   -- the last quest's page stops all the same
    return
  end
  -- The place's story gives way to the quest giver, and waits to play again once you're done talking (once, and only
  -- while it's still in step: the rules above AUTO_SETTLE).
  if arrival then yieldArrival(arrival) end
  Voice.openPages[id] = true
  UI.ListenTo(target)
  markAuto()
end

-- The game started a cinematic, a movie or a talking head: what started by itself stops (an arrival waits to play
-- again afterwards, once: Voice.OnGameTalkOver). What you started yourself plays on.
function Voice.OnGameTalk()
  local UI = ns.UI
  if not (UI and UI.frame) or not autoPlayingNow() then return end
  local arrival = arrivalPlaying()
  if arrival then yieldArrival(arrival) end
  Voice.autoStarted = nil
  UI.StopAll()
end

-- It ended: the waiting arrival story's turn (after settling, as after combat), unless another one still shows.
function Voice.OnGameTalkOver()
  if not Voice.GameTalking() then Voice.OnCombatOver() end
end

-- The quest window's play button requires the direct quest dialogue opt-in, including manual playback.
-- It plays the page shown, or stops it while it plays. Returns true if it did either.
function Voice.PlayQuestPage()
  if not Voice.QuestDialogue() then return false end
  local UI, qid = ns.UI, openQuest()
  local target = qid and UI and UI.frame and questTarget(qid, Voice.questKind, Voice.questRecorded)
  if not target then return false end
  Voice.openPages[target.id] = true
  UI.ListenTo(target)
  return true
end

-- What the play button does now: "stop" (its page plays, here or from the playlist), "listen" (the quest giver's
-- recorded words), or nil when nothing can play (no recording: the button hides).
function Voice.QuestPageState()
  if not Voice.QuestDialogue() then return nil end
  local UI, qid = ns.UI, openQuest()
  if not (UI and qid) then return nil end
  if UI.speaking and UI.playingId == QUEST_PREFIX .. qid .. ":" .. Voice.questKind then return "stop" end
  local t = questTarget(qid, Voice.questKind, Voice.questRecorded)
  if not t then return nil end
  if UI.IsPlayingTarget and UI.IsPlayingTarget(t) then return "stop" end
  return "listen"
end

local function stopQuestPage()
  local UI = ns.UI
  if UI and UI.speaking and isQuestText(UI.playingId) then UI.StopAll() end
end

-- Turning direct quest dialogue off stops any quest page, including one started from the lore panel or playlist.
function Voice.SetQuestDialogue(on)
  S().questDialogue = on and true or false
  local UI = ns.UI
  if not on and UI and UI.speaking and (isQuestText(UI.playingId) or isQuestClip(UI.playingId)
      or (Voice.lastClip and isQuestClip(Voice.lastClip.id))) then UI.StopAll() end
  if UI and UI.OnVoiceChanged then UI.OnVoiceChanged() end
  if ns.Hooks and ns.Hooks.UpdateQuestPlayButton then ns.Hooks.UpdateQuestPlayButton() end
  return S().questDialogue
end

-- The quest window closed: stop its page, and the next time it opens its pages play again (Voice.openPages).
function Voice.OnQuestClosed()
  closePages(QUEST_PREFIX)
  Voice.questKind, Voice.questRecorded = nil, nil
  stopQuestPage()
end

-- Books, letters and plaques (LOR-49): a page a voice has recorded (a clip under its page id) plays as the book opens
-- (unless the readBooks setting is off), turning the page plays the next, closing it stops. No book has a recording
-- yet, so for now books stay text: nothing plays and the book's button stays hidden (Voice.BookPageClip). Like quest
-- dialogue, a page plays once each time the book opens (pageFresh), one this character has heard doesn't play again
-- by itself while "Skip what you've heard" is on, and nothing cuts off something you started. The book's button plays
-- the page on demand (Voice.ReadBookPage(true)).
local BOOK_PREFIX = "booktext:"

local function isBookText(id) return type(id) == "string" and id:sub(1, #BOOK_PREFIX) == BOOK_PREFIX end
Voice.IsBookText = isBookText

local function bookPage()
  local function get(fn)
    local f = _G[fn]
    if not f then return nil end
    local ok, v = pcall(f)
    return ok and v or nil
  end
  local title, text, page = get("ItemTextGetItem"), get("ItemTextGetText"), get("ItemTextGetPage")
  if type(text) ~= "string" then return nil end
  -- Some books are HTML: read the words, not the markup.
  text = text:gsub("<[^>]+>", " "):gsub("&nbsp;", " "):gsub("&amp;", "&"):gsub("%s+", " "):match("^%s*(.-)%s*$")
  if not text:find("%S") then return nil end
  title = type(title) == "string" and title ~= "" and title or L["Book"]
  local id = BOOK_PREFIX .. ns.Engine.lower(title) .. "#" .. tostring(tonumber(page) or 1)
  return id, title, text
end

-- The recording of the page on screen (its page id), or nil when no voice recorded it: the book's button shows only for
-- a page that can play.
function Voice.BookPageClip()
  local id = bookPage()
  return id and Voice.HasAudio(id) and id or nil
end

-- A page is showing. byHand: the book's button (plays even if heard, stops it if it's this page).
function Voice.ReadBookPage(byHand)
  local UI = ns.UI
  if not (UI and UI.frame) then return end
  if not byHand and (S().readBooks == false or Voice.OnDemand() or Voice.GameTalking()) then return end
  local id, title, text = bookPage()
  if not id then return end
  if byHand and UI.speaking and UI.playingId == id then return UI.StopAll() end
  local ours = UI.speaking and isBookText(UI.playingId)
  if not byHand then
    if UI.IsBusy() and not ours then return end   -- never over something you started
    if UI.playingId == id then return end
  end
  if not Voice.HasAudio(id) or (not byHand and not pageFresh(id)) then
    if ours then UI.StopAll() end   -- the last page stops all the same
    return
  end
  Voice.openPages[id] = true
  UI.ListenTo({ id = id, key = id, label = title, text = text })
  if UI.speaking and UI.playingId == id then Voice.MarkHeard(id) end
  if not byHand then markAuto() end
end

-- The book closed: stop its page.
function Voice.OnBookClosed()
  closePages(BOOK_PREFIX)
  local UI = ns.UI
  if UI and UI.speaking and isBookText(UI.playingId) then UI.StopAll() end
end

-- Whether a loaded add-on's folder name, in lower case, passes match.
local function addOnLoaded(match)
  local C = _G.C_AddOns
  local count = (C and C.GetNumAddOns) or _G.GetNumAddOns
  local info = (C and C.GetAddOnInfo) or _G.GetAddOnInfo
  local loaded = (C and C.IsAddOnLoaded) or _G.IsAddOnLoaded
  if not (count and info and loaded) then return false end
  local okN, n = pcall(count)
  for i = 1, (okN and n) or 0 do
    local ok, name = pcall(info, i)
    if ok and type(name) == "string" and match(name:lower()) then
      local okL, isLoaded = pcall(loaded, name)
      if okL and isLoaded then return true end
    end
  end
  return false
end

-- Spoken's modules cover different text. Only its zone module competes with arrival lore; quest-only Spoken
-- must leave Lore Forever's own stories playing. Books are left to its book module quietly.
function Voice.CheckSpoken()
  local s = S()
  if not s.spokenBooks and addOnLoaded(function(name) return name:find("^spokenbook") end) then
    s.readBooks, s.spokenBooks = false, true
  end
  if s.spokenZonesChecked or not addOnLoaded(function(name) return name:find("^spokenzone") end) then return end
  s.spokenZonesChecked = true
  if s.autoZone == false then return end
  s.autoZone = false
  say(L["Spoken Zones is running, so Lore Forever's stories won't play automatically as you arrive. Type /lore autoplay (or use Options) to turn that back on."])
end

-- Other add-ons that voice quest dialogue (LOR-182), by the core folder their Forever builds install (their voice packs
-- depend on it). folders: lower case, any one loaded counts; books: it reads books aloud too. None plays on arrival.
local QUEST_VOICES = {
  { id = "spokenquest", title = "Spoken Quest", match = function(name) return name:find("^spokenquest") end },
  { id = "forevervo", title = "Forever Voiceover", folders = { forevervo = true } },
  { id = "chronicle", title = "Chronicle", folders = { foreverchronicle = true }, books = true },
  { id = "speakstone", title = "SpeakStone Forever", folders = { speakstone_forever_main = true }, books = true },
  -- VoiceOver Forever and the original VoiceOver share this folder.
  { id = "voiceover", title = "VoiceOver", folders = { ai_voiceover = true } },
  { id = "voiceovercontinued", title = "VoiceOver Continued",
    folders = { voiceover_continued = true, ai_voiceover_continued = true } },
  { id = "chatty", title = "Chatty Little NPC", folders = { chattylittlenpc = true }, books = true },
}

-- Players who run one of those would hear a quest page twice. The first time Lore Forever finds one loaded, it leaves
-- quest dialogue to it and says how to turn that back on; after that the player's choice in Options stands. Each
-- add-on is checked once, so one installed later gets the same. Books, if that add-on reads them, are left to it
-- without a word (as with Spoken: no book has a recording yet).
function Voice.CheckQuestVoices()
  local s = S()
  local checked = type(s.questVoicesChecked) == "table" and s.questVoicesChecked or {}
  for _, v in ipairs(QUEST_VOICES) do
    if not checked[v.id] and addOnLoaded(function(name) return v.match and v.match(name) or v.folders and v.folders[name] end) then
      checked[v.id] = true
      s.questVoicesChecked = checked
      if v.books and s.readBooks ~= false then s.readBooks = false end
      if Voice.QuestDialogue() then
        Voice.SetQuestDialogue(false)
        say(string.format(L["%s is running, so direct quest dialogue is off. Lore Forever's stories and answers still play. Options > Speak quest dialogue turns it back on."], v.title))
      end
    end
  end
end

-- /lore autoplay toggles arrival narration and clears on-demand mode when enabling it.
-- Direct quest dialogue keeps its separate opt-in. Returns the new arrival state.
function Voice.ToggleAutoplay()
  local s = S()
  local on = s.autoZone == false or Voice.OnDemand()
  s.autoZone = on
  if on and Voice.OnDemand() then Voice.SetOnDemand(false) end
  if not on then
    Voice.autoToken, Voice.autoWaiting = nil, nil
  end
  return on
end

-- Narration: only when I press Play, on or off. Turning it on cancels an arrival waiting to play and stops whatever
-- started by itself; something you started plays on. Returns the new state.
function Voice.SetOnDemand(on)
  S().onDemand = on and true or false
  if on then
    Voice.autoToken, Voice.autoWaiting = nil, nil
    if autoPlayingNow() then
      Voice.autoStarted, Voice.autoPlaying = nil, nil
      ns.UI.StopAll()
    end
  end
  local p = ns.Options and ns.Options.panel
  for _, cb in ipairs(p and p.checks or {}) do
    if cb.key == "onDemand" then cb:SetChecked(S().onDemand) end
  end
  return S().onDemand
end
